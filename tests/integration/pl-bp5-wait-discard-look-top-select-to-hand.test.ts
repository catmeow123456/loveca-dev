import { describe, expect, it } from 'vitest';
import type { LiveCardData, MemberCardData } from '../../src/domain/entities/card';
import { createCardInstance, createHeartIcon, createHeartRequirement } from '../../src/domain/entities/card';
import {
  createGameState,
  registerCards,
  updatePlayer,
  type GameState,
  type PendingAbilityState,
} from '../../src/domain/entities/game';
import { placeCardInSlot } from '../../src/domain/entities/zone';
import { createConfirmEffectStepCommand } from '../../src/application/game-commands';
import { createGameSession } from '../../src/application/game-session';
import { resolvePendingCardEffects } from '../../src/application/card-effect-runner';
import {
  PL_BP5_002_ON_ENTER_WAIT_DISCARD_LOOK_TOP_HIGH_COST_MUSE_MEMBER_ABILITY_ID,
  PL_BP5_222_ON_ENTER_WAIT_DISCARD_LOOK_TOP_ANY_CARD_ABILITY_ID,
} from '../../src/application/card-effects/ability-ids';
import {
  CardType,
  FaceState,
  HeartColor,
  OrientationState,
  SlotPosition,
  TriggerCondition,
} from '../../src/shared/types/enums';

const PLAYER1 = 'player1';
const PLAYER2 = 'player2';

function createMemberCard(
  cardCode: string,
  options: {
    readonly name?: string;
    readonly cost?: number;
    readonly groupNames?: readonly string[];
  } = {}
): MemberCardData {
  return {
    cardCode,
    name: options.name ?? cardCode,
    groupNames: options.groupNames ?? ["μ's"],
    cardType: CardType.MEMBER,
    cost: options.cost ?? 4,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.PINK, 1)],
  };
}

function createLiveCard(cardCode: string, groupNames: readonly string[] = ["μ's"]): LiveCardData {
  return {
    cardCode,
    name: cardCode,
    groupNames,
    cardType: CardType.LIVE,
    score: 3,
    requirements: createHeartRequirement({ [HeartColor.PINK]: 1 }),
  };
}

function createPendingAbility(abilityId: string, sourceCardId: string): PendingAbilityState {
  return {
    id: `${abilityId}:${sourceCardId}:pending`,
    abilityId,
    sourceCardId,
    controllerId: PLAYER1,
    mandatory: true,
    timingId: TriggerCondition.ON_ENTER_STAGE,
    eventIds: [`${abilityId}:event`],
    sourceSlot: SlotPosition.CENTER,
  };
}

function createSessionFromGame(game: GameState, gameId: string) {
  const session = createGameSession();
  session.createGame(gameId, PLAYER1, 'P1', PLAYER2, 'P2');
  (session as unknown as { authorityState: GameState }).authorityState = game;
  return session;
}

describe('PL!-bp5 wait-discard look-top shared workflow', () => {
  it('PL!-bp5-002 waits source, discards, and takes a high-cost μs member', () => {
    const source = createCardInstance(
      createMemberCard('PL!-bp5-002-R', { name: '絢瀬絵里', cost: 4 }),
      PLAYER1,
      'bp5-002-source'
    );
    const discard = createCardInstance(createMemberCard('PL!-hand-cost'), PLAYER1, 'bp5-002-discard');
    const target = createCardInstance(
      createMemberCard('PL!-high-muse', { cost: 9 }),
      PLAYER1,
      'bp5-002-target'
    );
    const lowMuse = createCardInstance(
      createMemberCard('PL!-low-muse', { cost: 8 }),
      PLAYER1,
      'bp5-002-low'
    );
    const highAqours = createCardInstance(
      createMemberCard('PL!S-high-aqours', { cost: 11, groupNames: ['Aqours'] }),
      PLAYER1,
      'bp5-002-aqours'
    );
    const museLive = createCardInstance(createLiveCard('PL!-muse-live'), PLAYER1, 'bp5-002-live');
    let game = registerCards(createGameState('bp5-002', PLAYER1, 'P1', PLAYER2, 'P2'), [
      source,
      discard,
      target,
      lowMuse,
      highAqours,
      museLive,
    ]);
    game = updatePlayer(game, PLAYER1, (player) => ({
      ...player,
      hand: { ...player.hand, cardIds: [discard.instanceId] },
      mainDeck: {
        ...player.mainDeck,
        cardIds: [target.instanceId, lowMuse.instanceId, highAqours.instanceId, museLive.instanceId],
      },
      waitingRoom: { ...player.waitingRoom, cardIds: [] },
      memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, source.instanceId, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      }),
    }));
    game = {
      ...game,
      pendingAbilities: [
        createPendingAbility(
          PL_BP5_002_ON_ENTER_WAIT_DISCARD_LOOK_TOP_HIGH_COST_MUSE_MEMBER_ABILITY_ID,
          source.instanceId
        ),
      ],
    };
    const session = createSessionFromGame(resolvePendingCardEffects(game).gameState, 'bp5-002');

    expect(session.state?.activeEffect?.selectableCardIds).toEqual([discard.instanceId]);
    expect(
      session.executeCommand(
        createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id, discard.instanceId)
      ).success
    ).toBe(true);
    expect(session.state?.activeEffect?.selectableCardIds).toEqual([target.instanceId]);
    expect(
      session.state?.players[0].memberSlots.cardStates.get(source.instanceId)?.orientation
    ).toBe(OrientationState.WAITING);

    expect(
      session.executeCommand(
        createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id, target.instanceId)
      ).success
    ).toBe(true);
    expect(session.state?.inspectionZone.revealedCardIds).toContain(target.instanceId);
    expect(
      session.executeCommand(createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id))
        .success
    ).toBe(true);
    expect(session.state?.players[0].hand.cardIds).toEqual([target.instanceId]);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual(
      expect.arrayContaining([
        discard.instanceId,
        lowMuse.instanceId,
        highAqours.instanceId,
        museLive.instanceId,
      ])
    );
  });

  it('PL!-bp5-222 takes one card without reveal after wait and discard', () => {
    const source = createCardInstance(
      createMemberCard('PL!-bp5-222-P＋', { name: '優木あんじゅ', cost: 4 }),
      PLAYER1,
      'bp5-222-source'
    );
    const discard = createCardInstance(createMemberCard('PL!-hand-cost'), PLAYER1, 'bp5-222-discard');
    const topCards = [
      createCardInstance(createMemberCard('PL!-top-member-0'), PLAYER1, 'bp5-222-top-0'),
      createCardInstance(createLiveCard('PL!-top-live-1'), PLAYER1, 'bp5-222-top-1'),
      createCardInstance(createMemberCard('PL!S-top-aqours-2', { groupNames: ['Aqours'] }), PLAYER1, 'bp5-222-top-2'),
      createCardInstance(createMemberCard('PL!-top-extra-3'), PLAYER1, 'bp5-222-top-3'),
    ];
    let game = registerCards(createGameState('bp5-222', PLAYER1, 'P1', PLAYER2, 'P2'), [
      source,
      discard,
      ...topCards,
    ]);
    game = updatePlayer(game, PLAYER1, (player) => ({
      ...player,
      hand: { ...player.hand, cardIds: [discard.instanceId] },
      mainDeck: { ...player.mainDeck, cardIds: topCards.map((card) => card.instanceId) },
      waitingRoom: { ...player.waitingRoom, cardIds: [] },
      memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, source.instanceId, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      }),
    }));
    game = {
      ...game,
      pendingAbilities: [
        createPendingAbility(
          PL_BP5_222_ON_ENTER_WAIT_DISCARD_LOOK_TOP_ANY_CARD_ABILITY_ID,
          source.instanceId
        ),
      ],
    };
    const session = createSessionFromGame(resolvePendingCardEffects(game).gameState, 'bp5-222');

    expect(
      session.executeCommand(
        createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id, discard.instanceId)
      ).success
    ).toBe(true);
    expect(session.state?.activeEffect?.selectableCardIds).toEqual(
      topCards.slice(0, 3).map((card) => card.instanceId)
    );
    expect(session.state?.activeEffect?.canSkipSelection).toBe(false);

    expect(
      session.executeCommand(
        createConfirmEffectStepCommand(
          PLAYER1,
          session.state!.activeEffect!.id,
          topCards[1]!.instanceId
        )
      ).success
    ).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.inspectionZone.revealedCardIds).not.toContain(topCards[1]!.instanceId);
    expect(session.state?.players[0].hand.cardIds).toEqual([topCards[1]!.instanceId]);
    expect(session.state?.players[0].mainDeck.cardIds).toEqual([topCards[3]!.instanceId]);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual(
      expect.arrayContaining([discard.instanceId, topCards[0]!.instanceId, topCards[2]!.instanceId])
    );
  });
});
