import { describe, expect, it } from 'vitest';
import type { LiveCardData, MemberCardData } from '../../src/domain/entities/card';
import {
  createCardInstance,
  createHeartIcon,
  createHeartRequirement,
} from '../../src/domain/entities/card';
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
import { PL_BP5_014_ON_ENTER_DISCARD_LOOK_TOP_BLUE_OR_PURPLE_HEART_MEMBER_ABILITY_ID } from '../../src/application/card-effects/ability-ids';
import {
  BladeHeartEffect,
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
    readonly hearts?: readonly ReturnType<typeof createHeartIcon>[];
    readonly bladeHeart?: boolean;
  } = {}
): MemberCardData {
  return {
    cardCode,
    name: options.name ?? cardCode,
    groupNames: ["μ's"],
    cardType: CardType.MEMBER,
    cost: 4,
    blade: 1,
    hearts: options.hearts ?? [createHeartIcon(HeartColor.PINK, 1)],
    bladeHearts:
      options.bladeHeart === true
        ? [{ effect: BladeHeartEffect.HEART, heartColor: HeartColor.BLUE }]
        : [],
  };
}

function createLiveCard(cardCode: string): LiveCardData {
  return {
    cardCode,
    name: cardCode,
    groupNames: ["μ's"],
    cardType: CardType.LIVE,
    score: 3,
    requirements: createHeartRequirement({ [HeartColor.BLUE]: 1 }),
  };
}

function createPendingAbility(sourceCardId: string): PendingAbilityState {
  return {
    id: `${PL_BP5_014_ON_ENTER_DISCARD_LOOK_TOP_BLUE_OR_PURPLE_HEART_MEMBER_ABILITY_ID}:${sourceCardId}:pending`,
    abilityId: PL_BP5_014_ON_ENTER_DISCARD_LOOK_TOP_BLUE_OR_PURPLE_HEART_MEMBER_ABILITY_ID,
    sourceCardId,
    controllerId: PLAYER1,
    mandatory: true,
    timingId: TriggerCondition.ON_ENTER_STAGE,
    eventIds: ['pl-bp5-014:event'],
    sourceSlot: SlotPosition.CENTER,
  };
}

function createSessionFromGame(game: GameState, gameId: string) {
  const session = createGameSession();
  session.createGame(gameId, PLAYER1, 'P1', PLAYER2, 'P2');
  (session as unknown as { authorityState: GameState }).authorityState = game;
  return session;
}

describe('PL!-bp5-014 discard look-top blue or purple Heart member workflow', () => {
  it('selects only members with printed blue or purple Heart and ignores BLADE HEART', () => {
    const source = createCardInstance(
      createMemberCard('PL!-bp5-014-N', { name: '星空凛' }),
      PLAYER1,
      'bp5-014-source'
    );
    const discard = createCardInstance(createMemberCard('PL!-hand-cost'), PLAYER1, 'bp5-014-discard');
    const blueMember = createCardInstance(
      createMemberCard('PL!-blue-member', {
        hearts: [createHeartIcon(HeartColor.BLUE, 1)],
      }),
      PLAYER1,
      'bp5-014-blue'
    );
    const purpleMember = createCardInstance(
      createMemberCard('PL!-purple-member', {
        hearts: [createHeartIcon(HeartColor.PURPLE, 1)],
      }),
      PLAYER1,
      'bp5-014-purple'
    );
    const bladeHeartOnly = createCardInstance(
      createMemberCard('PL!-blade-heart-member', { bladeHeart: true }),
      PLAYER1,
      'bp5-014-blade-heart'
    );
    const blueLive = createCardInstance(createLiveCard('PL!-blue-live'), PLAYER1, 'bp5-014-live');
    const extra = createCardInstance(createMemberCard('PL!-extra'), PLAYER1, 'bp5-014-extra');
    let game = registerCards(createGameState('bp5-014', PLAYER1, 'P1', PLAYER2, 'P2'), [
      source,
      discard,
      blueMember,
      purpleMember,
      bladeHeartOnly,
      blueLive,
      extra,
    ]);
    game = updatePlayer(game, PLAYER1, (player) => ({
      ...player,
      hand: { ...player.hand, cardIds: [discard.instanceId] },
      mainDeck: {
        ...player.mainDeck,
        cardIds: [
          blueMember.instanceId,
          bladeHeartOnly.instanceId,
          blueLive.instanceId,
          purpleMember.instanceId,
          extra.instanceId,
        ],
      },
      waitingRoom: { ...player.waitingRoom, cardIds: [] },
      memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, source.instanceId, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      }),
    }));
    game = { ...game, pendingAbilities: [createPendingAbility(source.instanceId)] };
    const session = createSessionFromGame(resolvePendingCardEffects(game).gameState, 'bp5-014');

    expect(session.state?.activeEffect?.selectableCardIds).toEqual([discard.instanceId]);
    expect(
      session.executeCommand(
        createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id, discard.instanceId)
      ).success
    ).toBe(true);
    expect(session.state?.activeEffect?.inspectionCardIds).toEqual([
      blueMember.instanceId,
      bladeHeartOnly.instanceId,
      blueLive.instanceId,
      purpleMember.instanceId,
    ]);
    expect(session.state?.activeEffect?.selectableCardIds).toEqual([
      blueMember.instanceId,
      purpleMember.instanceId,
    ]);
    expect(
      session.state?.players[0].memberSlots.cardStates.get(source.instanceId)?.orientation
    ).toBe(OrientationState.ACTIVE);

    expect(
      session.executeCommand(
        createConfirmEffectStepCommand(
          PLAYER1,
          session.state!.activeEffect!.id,
          purpleMember.instanceId
        )
      ).success
    ).toBe(true);
    expect(session.state?.inspectionZone.revealedCardIds).toContain(purpleMember.instanceId);
    expect(
      session.executeCommand(createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id))
        .success
    ).toBe(true);
    expect(session.state?.players[0].hand.cardIds).toEqual([purpleMember.instanceId]);
    expect(session.state?.players[0].mainDeck.cardIds).toEqual([extra.instanceId]);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual(
      expect.arrayContaining([
        discard.instanceId,
        blueMember.instanceId,
        bladeHeartOnly.instanceId,
        blueLive.instanceId,
      ])
    );
  });

  it('can decline before paying the discard cost', () => {
    const source = createCardInstance(
      createMemberCard('PL!-bp5-014-N', { name: '星空凛' }),
      PLAYER1,
      'bp5-014-decline-source'
    );
    const discard = createCardInstance(
      createMemberCard('PL!-hand-cost'),
      PLAYER1,
      'bp5-014-decline-discard'
    );
    const blueMember = createCardInstance(
      createMemberCard('PL!-blue-member', {
        hearts: [createHeartIcon(HeartColor.BLUE, 1)],
      }),
      PLAYER1,
      'bp5-014-decline-blue'
    );
    let game = registerCards(createGameState('bp5-014-decline', PLAYER1, 'P1', PLAYER2, 'P2'), [
      source,
      discard,
      blueMember,
    ]);
    game = updatePlayer(game, PLAYER1, (player) => ({
      ...player,
      hand: { ...player.hand, cardIds: [discard.instanceId] },
      mainDeck: { ...player.mainDeck, cardIds: [blueMember.instanceId] },
      waitingRoom: { ...player.waitingRoom, cardIds: [] },
      memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, source.instanceId, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      }),
    }));
    game = { ...game, pendingAbilities: [createPendingAbility(source.instanceId)] };
    const session = createSessionFromGame(resolvePendingCardEffects(game).gameState, 'bp5-014-decline');

    expect(
      session.executeCommand(createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id))
        .success
    ).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].hand.cardIds).toEqual([discard.instanceId]);
    expect(session.state?.players[0].mainDeck.cardIds).toEqual([blueMember.instanceId]);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([]);
  });
});
