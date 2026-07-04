import { describe, expect, it } from 'vitest';
import type { MemberCardData } from '../../src/domain/entities/card';
import { createCardInstance, createHeartIcon } from '../../src/domain/entities/card';
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
  SP_BP5_007_ON_ENTER_DISCARD_LOOK_TOP_DISTINCT_GROUPS_ABILITY_ID,
  SP_BP5_008_ON_ENTER_WAIT_DISCARD_LOOK_TOP_ABILITY_ID,
  SP_BP5_013_ON_ENTER_DISCARD_LOOK_TOP_SUNNYPASSION_OR_BLADE_HEART_LIELLA_ABILITY_ID,
} from '../../src/application/card-effects/ability-ids';
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
    readonly cost?: number;
    readonly groupNames?: readonly string[];
    readonly unitName?: string;
    readonly bladeHeart?: boolean;
  } = {}
): MemberCardData {
  return {
    cardCode,
    name: options.name ?? cardCode,
    groupNames: options.groupNames ?? ['Liella!'],
    unitName: options.unitName,
    cardType: CardType.MEMBER,
    cost: options.cost ?? 4,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.YELLOW, 1)],
    bladeHearts:
      options.bladeHeart === true
        ? [{ effect: BladeHeartEffect.HEART, heartColor: HeartColor.YELLOW }]
        : [],
  };
}

function createPendingAbility(
  abilityId: string,
  sourceCardId: string,
  sourceSlot = SlotPosition.CENTER
): PendingAbilityState {
  return {
    id: `${abilityId}:${sourceCardId}:pending`,
    abilityId,
    sourceCardId,
    controllerId: PLAYER1,
    mandatory: true,
    timingId: TriggerCondition.ON_ENTER_STAGE,
    eventIds: [`${abilityId}:event`],
    sourceSlot,
  };
}

function createSessionFromGame(game: GameState, gameId: string) {
  const session = createGameSession();
  session.createGame(gameId, PLAYER1, 'P1', PLAYER2, 'P2');
  (session as unknown as { authorityState: GameState }).authorityState = game;
  return session;
}

describe('PL!SP-bp5 first look-top on-enter batch', () => {
  it('PL!SP-bp5-008 waits source, discards, and takes one high-cost Liella member', () => {
    const source = createCardInstance(
      createMemberCard('PL!SP-bp5-008-R', { name: '若菜四季', cost: 4 }),
      PLAYER1,
      'bp5-008-source'
    );
    const discard = createCardInstance(
      createMemberCard('PL!SP-hand-cost'),
      PLAYER1,
      'bp5-008-discard'
    );
    const target = createCardInstance(
      createMemberCard('PL!SP-high-liella', { cost: 9 }),
      PLAYER1,
      'bp5-008-target'
    );
    const lowLiella = createCardInstance(
      createMemberCard('PL!SP-low-liella', { cost: 8 }),
      PLAYER1,
      'bp5-008-low'
    );
    const highAqours = createCardInstance(
      createMemberCard('PL!S-high-aqours', { cost: 11, groupNames: ['Aqours'] }),
      PLAYER1,
      'bp5-008-aqours'
    );
    let game = registerCards(createGameState('bp5-008', PLAYER1, 'P1', PLAYER2, 'P2'), [
      source,
      discard,
      target,
      lowLiella,
      highAqours,
    ]);
    game = updatePlayer(game, PLAYER1, (player) => ({
      ...player,
      hand: { ...player.hand, cardIds: [discard.instanceId] },
      mainDeck: {
        ...player.mainDeck,
        cardIds: [target.instanceId, lowLiella.instanceId, highAqours.instanceId],
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
          SP_BP5_008_ON_ENTER_WAIT_DISCARD_LOOK_TOP_ABILITY_ID,
          source.instanceId
        ),
      ],
    };
    const session = createSessionFromGame(resolvePendingCardEffects(game).gameState, 'bp5-008');

    expect(session.state?.activeEffect?.selectableCardIds).toEqual([discard.instanceId]);
    const beforeCostSeq = session.getCurrentPublicEventSeq();
    expect(
      session.executeCommand(
        createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id, discard.instanceId)
      ).success
    ).toBe(true);
    expect(session.state?.activeEffect?.selectableCardIds).toEqual([target.instanceId]);
    expect(
      session.state?.players[0].memberSlots.cardStates.get(source.instanceId)?.orientation
    ).toBe(OrientationState.WAITING);
    const startedSummary = session
      .getPublicEventsSince(beforeCostSeq)
      .find((event) => event.type === 'CardEffectSummary' && event.summaryStatus === 'STARTED');
    expect(startedSummary?.type).toBe('CardEffectSummary');
    if (startedSummary?.type === 'CardEffectSummary') {
      expect(startedSummary.abilityId).toBe(SP_BP5_008_ON_ENTER_WAIT_DISCARD_LOOK_TOP_ABILITY_ID);
      expect(startedSummary.effectKind).toBe('DISCARD_LOOK_TOP_SELECT_TO_HAND');
      expect(startedSummary.summaryStatus).toBe('STARTED');
      expect(startedSummary.sourceOrientationCost).toBe('WAITING');
      expect(startedSummary.sourceCard?.publicObjectId).toBe(`obj_${source.instanceId}`);
      expect(startedSummary.discardedCostCards?.map((card) => card.publicObjectId)).toEqual([
        `obj_${discard.instanceId}`,
      ]);
      expect(startedSummary.requestedInspectCount).toBe(5);
      expect(startedSummary.actualInspectedCount).toBe(3);
    }

    expect(
      session.executeCommand(
        createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id, target.instanceId)
      ).success
    ).toBe(true);
    expect(
      session.executeCommand(
        createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id)
      ).success
    ).toBe(true);
    expect(session.state?.players[0].hand.cardIds).toEqual([target.instanceId]);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([
      discard.instanceId,
      lowLiella.instanceId,
      highAqours.instanceId,
    ]);
    const completedSummary = session
      .getPublicEventsSince(beforeCostSeq)
      .find((event) => event.type === 'CardEffectSummary' && event.summaryStatus === 'COMPLETED');
    expect(completedSummary?.type).toBe('CardEffectSummary');
    if (completedSummary?.type === 'CardEffectSummary') {
      expect(completedSummary.abilityId).toBe(
        SP_BP5_008_ON_ENTER_WAIT_DISCARD_LOOK_TOP_ABILITY_ID
      );
      expect(completedSummary.effectKind).toBe('DISCARD_LOOK_TOP_SELECT_TO_HAND');
      expect(completedSummary.summaryStatus).toBe('COMPLETED');
      expect(completedSummary.sourceOrientationCost).toBe('WAITING');
      expect(completedSummary.selectedCards?.map((card) => card.publicObjectId)).toEqual([
        `obj_${target.instanceId}`,
      ]);
      expect(completedSummary.waitingRoomCardCount).toBe(2);
    }
  });

  it('PL!SP-bp5-013 takes SunnyPassion or blade-heart Liella members after discard', () => {
    const source = createCardInstance(
      createMemberCard('PL!SP-bp5-013-N', { name: '唐 可可', cost: 4 }),
      PLAYER1,
      'bp5-013-source'
    );
    const discard = createCardInstance(
      createMemberCard('PL!SP-hand-cost'),
      PLAYER1,
      'bp5-013-discard'
    );
    const sunny = createCardInstance(
      createMemberCard('PL!SP-sunny-member', { unitName: 'SunnyPassion' }),
      PLAYER1,
      'bp5-013-sunny'
    );
    const bladeHeartLiella = createCardInstance(
      createMemberCard('PL!SP-blade-heart-liella', { bladeHeart: true }),
      PLAYER1,
      'bp5-013-blade-heart'
    );
    const plainLiella = createCardInstance(
      createMemberCard('PL!SP-plain-liella'),
      PLAYER1,
      'bp5-013-plain'
    );
    let game = registerCards(createGameState('bp5-013', PLAYER1, 'P1', PLAYER2, 'P2'), [
      source,
      discard,
      sunny,
      bladeHeartLiella,
      plainLiella,
    ]);
    game = updatePlayer(game, PLAYER1, (player) => ({
      ...player,
      hand: { ...player.hand, cardIds: [discard.instanceId] },
      mainDeck: {
        ...player.mainDeck,
        cardIds: [plainLiella.instanceId, sunny.instanceId, bladeHeartLiella.instanceId],
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
          SP_BP5_013_ON_ENTER_DISCARD_LOOK_TOP_SUNNYPASSION_OR_BLADE_HEART_LIELLA_ABILITY_ID,
          source.instanceId
        ),
      ],
    };
    const session = createSessionFromGame(resolvePendingCardEffects(game).gameState, 'bp5-013');

    expect(
      session.executeCommand(
        createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id, discard.instanceId)
      ).success
    ).toBe(true);
    expect(session.state?.activeEffect?.selectableCardIds).toEqual([
      sunny.instanceId,
      bladeHeartLiella.instanceId,
    ]);

    expect(
      session.executeCommand(
        createConfirmEffectStepCommand(
          PLAYER1,
          session.state!.activeEffect!.id,
          bladeHeartLiella.instanceId
        )
      ).success
    ).toBe(true);
    expect(
      session.executeCommand(
        createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id)
      ).success
    ).toBe(true);
    expect(session.state?.players[0].hand.cardIds).toEqual([bladeHeartLiella.instanceId]);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([
      discard.instanceId,
      plainLiella.instanceId,
      sunny.instanceId,
    ]);
  });

  it('PL!SP-bp5-007 takes up to three cards across Liella, rival groups, and rejects duplicate groups', () => {
    const source = createCardInstance(
      createMemberCard('PL!SP-bp5-007-R', { name: '米女メイ', cost: 15 }),
      PLAYER1,
      'bp5-007-source'
    );
    const discard = createCardInstance(
      createMemberCard('PL!SP-hand-cost'),
      PLAYER1,
      'bp5-007-discard'
    );
    const liellaOne = createCardInstance(
      createMemberCard('PL!SP-liella-one'),
      PLAYER1,
      'liella-one'
    );
    const liellaTwo = createCardInstance(
      createMemberCard('PL!SP-liella-two'),
      PLAYER1,
      'liella-two'
    );
    const sunnyPassion = createCardInstance(
      createMemberCard('PL!SP-sunny-passion', { groupNames: ['SunnyPassion'] }),
      PLAYER1,
      'sunny-passion'
    );
    const arise = createCardInstance(
      createMemberCard('PL!-a-rise', { groupNames: ['A-RISE'] }),
      PLAYER1,
      'a-rise'
    );
    const saintSnow = createCardInstance(
      createMemberCard('PL!S-saint-snow', { groupNames: ['SaintSnow'] }),
      PLAYER1,
      'saint-snow'
    );
    let game = registerCards(createGameState('bp5-007', PLAYER1, 'P1', PLAYER2, 'P2'), [
      source,
      discard,
      liellaOne,
      liellaTwo,
      sunnyPassion,
      arise,
      saintSnow,
    ]);
    game = updatePlayer(game, PLAYER1, (player) => ({
      ...player,
      hand: { ...player.hand, cardIds: [discard.instanceId] },
      mainDeck: {
        ...player.mainDeck,
        cardIds: [
          liellaOne.instanceId,
          liellaTwo.instanceId,
          sunnyPassion.instanceId,
          arise.instanceId,
          saintSnow.instanceId,
        ],
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
          SP_BP5_007_ON_ENTER_DISCARD_LOOK_TOP_DISTINCT_GROUPS_ABILITY_ID,
          source.instanceId
        ),
      ],
    };
    const session = createSessionFromGame(resolvePendingCardEffects(game).gameState, 'bp5-007');

    expect(
      session.executeCommand(
        createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id, discard.instanceId)
      ).success
    ).toBe(true);
    expect(session.state?.activeEffect?.selectableCardIds).toEqual([
      liellaOne.instanceId,
      liellaTwo.instanceId,
      sunnyPassion.instanceId,
      arise.instanceId,
      saintSnow.instanceId,
    ]);

    const invalidSameGroup = session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        session.state!.activeEffect!.id,
        undefined,
        null,
        undefined,
        null,
        [liellaOne.instanceId, liellaTwo.instanceId]
      )
    );
    expect(invalidSameGroup.success).toBe(false);
    expect(session.state?.activeEffect?.stepId).toBe('SP_BP5_007_SELECT_DISTINCT_GROUP_CARDS');

    expect(
      session.executeCommand(
        createConfirmEffectStepCommand(
          PLAYER1,
          session.state!.activeEffect!.id,
          undefined,
          null,
          undefined,
          null,
          [liellaTwo.instanceId, sunnyPassion.instanceId, arise.instanceId]
        )
      ).success
    ).toBe(true);
    expect(session.state?.activeEffect).toMatchObject({
      stepId: 'SP_BP5_007_REVEAL_SELECTED_GROUP_CARDS',
      selectableCardIds: [],
      canSkipSelection: false,
    });
    expect(session.state?.activeEffect?.selectableCardMode).toBeUndefined();
    expect(session.state?.activeEffect?.minSelectableCards).toBeUndefined();
    expect(session.state?.activeEffect?.maxSelectableCards).toBeUndefined();
    expect(session.state?.activeEffect?.confirmSelectionLabel).toBeUndefined();
    expect(session.state?.inspectionZone.revealedCardIds).toEqual([
      liellaTwo.instanceId,
      sunnyPassion.instanceId,
      arise.instanceId,
    ]);
    expect(
      session.executeCommand(
        createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id)
      ).success
    ).toBe(true);
    expect(session.state?.players[0].hand.cardIds).toEqual([
      liellaTwo.instanceId,
      sunnyPassion.instanceId,
      arise.instanceId,
    ]);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([
      discard.instanceId,
      liellaOne.instanceId,
      saintSnow.instanceId,
    ]);
  });
});
