import { confirmActiveEffectStepThroughPublicReveal } from '../helpers/public-card-selection-confirmation';
import { describe, expect, it } from 'vitest';
import type { LiveCardData, MemberCardData } from '../../src/domain/entities/card';
import {
  createCardInstance,
  createHeartIcon,
  createHeartRequirement,
} from '../../src/domain/entities/card';
import {
  createGameState,
  emitGameEvent,
  registerCards,
  updatePlayer,
  type GameState,
} from '../../src/domain/entities/game';
import { createEnterStageEvent } from '../../src/domain/events/game-events';
import { addCardToStatefulZone, placeCardInSlot } from '../../src/domain/entities/zone';
import {
  activateCardAbility,
  confirmActiveEffectStep,
  enqueueTriggeredCardEffects,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import { GameService } from '../../src/application/game-service';
import {
  PL_BP5_015_ON_ENTER_SUCCESS_LIVE_SCORE_THREE_DRAW_ABILITY_ID,
  PL_BP5_024_LIVE_START_PRIVATE_WARS_CHOICE_ABILITY_ID,
  PL_BP5_111_ACTIVATED_DISCARD_ACTIVATE_WAITING_MEMBER_RECOVER_LIVE_ABILITY_ID,
  PL_BP5_111_CONTINUOUS_OTHER_ARISE_BLUE_HEART_ABILITY_ID,
  PL_BP5_333_CONTINUOUS_WAITING_BLUE_HEART_ABILITY_ID,
  PL_BP5_333_ON_ENTER_WAIT_SELF_WAIT_OPPONENT_LOW_COST_ABILITY_ID,
} from '../../src/application/card-effects/ability-ids';
import { getMemberEffectiveBladeCount, getMemberEffectiveHeartIcons } from '../../src/domain/rules/live-modifiers';
import {
  CardType,
  FaceState,
  GamePhase,
  HeartColor,
  OrientationState,
  SlotPosition,
  TriggerCondition,
  ZoneType,
} from '../../src/shared/types/enums';

const PLAYER1 = 'player1';
const PLAYER2 = 'player2';

function member(
  cardCode: string,
  name: string,
  options: {
    readonly groupNames?: readonly string[];
    readonly cost?: number;
    readonly blade?: number;
    readonly heartColor?: HeartColor;
  } = {}
): MemberCardData {
  return {
    cardCode,
    name,
    groupNames: options.groupNames ?? ["μ's"],
    cardType: CardType.MEMBER,
    cost: options.cost ?? 1,
    blade: options.blade ?? 1,
    hearts: [createHeartIcon(options.heartColor ?? HeartColor.PINK, 1)],
  };
}

function live(cardCode: string, score: number): LiveCardData {
  return {
    cardCode,
    name: cardCode,
    groupNames: ["μ's"],
    cardType: CardType.LIVE,
    score,
    requirements: createHeartRequirement({ [HeartColor.PINK]: 1 }),
  };
}

function baseGame(testId: string): GameState {
  return {
    ...createGameState(testId, PLAYER1, 'P1', PLAYER2, 'P2'),
    currentPhase: GamePhase.MAIN_PHASE,
  };
}

function placeMember(
  game: GameState,
  playerId: string,
  cardId: string,
  slot: SlotPosition,
  orientation: OrientationState
): GameState {
  return updatePlayer(game, playerId, (player) => ({
    ...player,
    memberSlots: placeCardInSlot(player.memberSlots, slot, cardId, {
      orientation,
      face: FaceState.FACE_UP,
    }),
  }));
}

function addToZone(
  game: GameState,
  playerId: string,
  zone: ZoneType.HAND | ZoneType.MAIN_DECK | ZoneType.SUCCESS_ZONE | ZoneType.LIVE_ZONE | ZoneType.WAITING_ROOM,
  cardIds: readonly string[]
): GameState {
  return updatePlayer(game, playerId, (player) => {
    const nextZone = cardIds.reduce(
      (current, cardId) =>
        addCardToStatefulZone(current, cardId, {
          orientation: OrientationState.ACTIVE,
          face: zone === ZoneType.LIVE_ZONE ? FaceState.FACE_DOWN : FaceState.FACE_UP,
        }),
      player[zoneToPlayerKey(zone)]
    );
    return {
      ...player,
      [zoneToPlayerKey(zone)]: nextZone,
    };
  });
}

function zoneToPlayerKey(
  zone: ZoneType.HAND | ZoneType.MAIN_DECK | ZoneType.SUCCESS_ZONE | ZoneType.LIVE_ZONE | ZoneType.WAITING_ROOM
): 'hand' | 'mainDeck' | 'successZone' | 'liveZone' | 'waitingRoom' {
  switch (zone) {
    case ZoneType.HAND:
      return 'hand';
    case ZoneType.MAIN_DECK:
      return 'mainDeck';
    case ZoneType.SUCCESS_ZONE:
      return 'successZone';
    case ZoneType.LIVE_ZONE:
      return 'liveZone';
    case ZoneType.WAITING_ROOM:
      return 'waitingRoom';
  }
}

function resolveOnEnter(game: GameState, sourceCardId: string): GameState {
  const entered = emitGameEvent(
    game,
    createEnterStageEvent(sourceCardId, ZoneType.HAND, SlotPosition.CENTER, PLAYER1, PLAYER1)
  );
  return resolvePendingCardEffects(
    enqueueTriggeredCardEffects(entered, [TriggerCondition.ON_ENTER_STAGE])
  ).gameState;
}

function startLiveStart(game: GameState): GameState {
  const result = new GameService().executeCheckTiming(game, [TriggerCondition.ON_LIVE_START]);
  expect(result.success).toBe(true);
  return result.gameState;
}

function latestPayload(game: GameState, abilityId: string) {
  return game.actionHistory
    .filter((action) => action.type === 'RESOLVE_ABILITY' && action.payload.abilityId === abilityId)
    .at(-1)?.payload;
}

function setupPrivateWars(options: {
  readonly ownArise?: boolean;
  readonly opponentWaiting?: boolean;
  readonly opponentBlade?: number;
}): {
  readonly game: GameState;
  readonly liveCardId: string;
  readonly opponentTargetId: string;
} {
  const privateWars = createCardInstance(live('PL!-bp5-024-L', 5), PLAYER1, 'private-wars');
  const ownMember = createCardInstance(
    member('PL!-bp5-111-R', '綺羅ツバサ', {
      groupNames: options.ownArise === false ? ["μ's"] : ['A-RISE'],
    }),
    PLAYER1,
    'own-member'
  );
  const opponentTarget = createCardInstance(
    member('opponent-member', 'Opponent', {
      groupNames: ['A-RISE'],
      blade: options.opponentBlade ?? 3,
    }),
    PLAYER2,
    'opponent-target'
  );
  let game = baseGame('private-wars');
  game = registerCards(game, [privateWars, ownMember, opponentTarget]);
  game = placeMember(game, PLAYER1, ownMember.instanceId, SlotPosition.CENTER, OrientationState.ACTIVE);
  game = placeMember(
    game,
    PLAYER2,
    opponentTarget.instanceId,
    SlotPosition.CENTER,
    options.opponentWaiting === true ? OrientationState.WAITING : OrientationState.ACTIVE
  );
  game = addToZone(game, PLAYER1, ZoneType.LIVE_ZONE, [privateWars.instanceId]);
  game = {
    ...game,
    liveResolution: {
      ...game.liveResolution,
      performingPlayerId: PLAYER1,
    },
  };
  return { game, liveCardId: privateWars.instanceId, opponentTargetId: opponentTarget.instanceId };
}

describe('PL!-bp5 first confirmed batch effects', () => {
  it('PL!-bp5-015 draws one when success LIVE score total is at least 3', () => {
    const source = createCardInstance(member('PL!-bp5-015-N', '西木野真姫', { cost: 4 }), PLAYER1, 'bp5-015');
    const successLive = createCardInstance(live('success-live', 3), PLAYER1, 'success-live');
    const drawCard = createCardInstance(member('draw-card', 'Draw'), PLAYER1, 'draw-card');
    let game = baseGame('bp5-015-draw');
    game = registerCards(game, [source, successLive, drawCard]);
    game = placeMember(game, PLAYER1, source.instanceId, SlotPosition.CENTER, OrientationState.ACTIVE);
    game = addToZone(game, PLAYER1, ZoneType.SUCCESS_ZONE, [successLive.instanceId]);
    game = addToZone(game, PLAYER1, ZoneType.MAIN_DECK, [drawCard.instanceId]);

    const resolved = resolveOnEnter(game, source.instanceId);

    expect(resolved.activeEffect).toBeNull();
    expect(resolved.players[0].hand.cardIds).toEqual([drawCard.instanceId]);
    expect(latestPayload(resolved, PL_BP5_015_ON_ENTER_SUCCESS_LIVE_SCORE_THREE_DRAW_ABILITY_ID)).toMatchObject({
      step: 'ON_ENTER_SUCCESS_LIVE_SCORE_THREE_DRAW_ONE',
      successLiveScore: 3,
      drawnCardIds: [drawCard.instanceId],
    });
  });

  it('PL!-bp5-015 consumes pending without drawing when success LIVE score is below 3', () => {
    const source = createCardInstance(member('PL!-bp5-015-N', '西木野真姫', { cost: 4 }), PLAYER1, 'bp5-015');
    const successLive = createCardInstance(live('success-live', 2), PLAYER1, 'success-live');
    const drawCard = createCardInstance(member('draw-card', 'Draw'), PLAYER1, 'draw-card');
    let game = baseGame('bp5-015-noop');
    game = registerCards(game, [source, successLive, drawCard]);
    game = placeMember(game, PLAYER1, source.instanceId, SlotPosition.CENTER, OrientationState.ACTIVE);
    game = addToZone(game, PLAYER1, ZoneType.SUCCESS_ZONE, [successLive.instanceId]);
    game = addToZone(game, PLAYER1, ZoneType.MAIN_DECK, [drawCard.instanceId]);

    const resolved = resolveOnEnter(game, source.instanceId);

    expect(resolved.activeEffect).toBeNull();
    expect(resolved.players[0].hand.cardIds).toEqual([]);
    expect(latestPayload(resolved, PL_BP5_015_ON_ENTER_SUCCESS_LIVE_SCORE_THREE_DRAW_ABILITY_ID)).toMatchObject({
      step: 'SUCCESS_LIVE_SCORE_CONDITION_NOT_MET',
      successLiveScore: 2,
      requiredSuccessLiveScore: 3,
    });
  });

  it('PL!-bp5-024 no-ops with realtime confirm text when own stage has no A-RISE member', () => {
    const { game } = setupPrivateWars({ ownArise: false, opponentWaiting: true });

    const started = startLiveStart(game);

    expect(started.activeEffect).toMatchObject({
      abilityId: PL_BP5_024_LIVE_START_PRIVATE_WARS_CHOICE_ABILITY_ID,
      metadata: { confirmOnlyPendingAbility: true },
    });
    expect(started.activeEffect?.effectText).toContain('自己舞台没有『A-RISE』成员');

    const resolved = confirmActiveEffectStepThroughPublicReveal(started, PLAYER1, started.activeEffect!.id);

    expect(resolved.activeEffect).toBeNull();
    expect(latestPayload(resolved, PL_BP5_024_LIVE_START_PRIVATE_WARS_CHOICE_ABILITY_ID)).toMatchObject({
      step: 'NO_OWN_ARISE_STAGE_MEMBER',
      hasOwnAriseMember: false,
    });
  });

  it('PL!-bp5-024 activates a waiting member from either stage and gives that member BLADE', () => {
    const { game, opponentTargetId } = setupPrivateWars({ opponentWaiting: true });
    const started = startLiveStart(game);

    const branch = confirmActiveEffectStepThroughPublicReveal(
      started,
      PLAYER1,
      started.activeEffect!.id,
      null,
      null,
      false,
      'activate-waiting-member'
    );
    const resolved = confirmActiveEffectStepThroughPublicReveal(branch, PLAYER1, branch.activeEffect!.id, opponentTargetId);

    expect(resolved.players[1].memberSlots.cardStates.get(opponentTargetId)?.orientation).toBe(
      OrientationState.ACTIVE
    );
    expect(getMemberEffectiveBladeCount(resolved, PLAYER2, opponentTargetId)).toBe(4);
    expect(latestPayload(resolved, PL_BP5_024_LIVE_START_PRIVATE_WARS_CHOICE_ABILITY_ID)).toMatchObject({
      step: 'PRIVATE_WARS_ACTIVATE_WAITING_MEMBER_GAIN_BLADE',
      targetPlayerId: PLAYER2,
      targetCardId: opponentTargetId,
      bladeBonus: 1,
    });
  });

  it('PL!-bp5-024 waits an opponent member with printed BLADE at most 3', () => {
    const { game, opponentTargetId } = setupPrivateWars({ opponentBlade: 3 });
    const started = startLiveStart(game);

    const branch = confirmActiveEffectStepThroughPublicReveal(
      started,
      PLAYER1,
      started.activeEffect!.id,
      null,
      null,
      false,
      'wait-opponent-low-blade-member'
    );
    const resolved = confirmActiveEffectStepThroughPublicReveal(branch, PLAYER1, branch.activeEffect!.id, opponentTargetId);

    expect(resolved.players[1].memberSlots.cardStates.get(opponentTargetId)?.orientation).toBe(
      OrientationState.WAITING
    );
    expect(latestPayload(resolved, PL_BP5_024_LIVE_START_PRIVATE_WARS_CHOICE_ABILITY_ID)).toMatchObject({
      step: 'PRIVATE_WARS_WAIT_OPPONENT_LOW_BLADE_MEMBER',
      targetCardId: opponentTargetId,
    });
  });

  it('PL!-bp5-024 stale waiting-member target leaves state unchanged', () => {
    const { game, opponentTargetId } = setupPrivateWars({ opponentWaiting: true });
    const started = startLiveStart(game);
    const branch = confirmActiveEffectStepThroughPublicReveal(
      started,
      PLAYER1,
      started.activeEffect!.id,
      null,
      null,
      false,
      'activate-waiting-member'
    );
    const stale = updatePlayer(branch, PLAYER2, (player) => {
      const cardStates = new Map(player.memberSlots.cardStates);
      cardStates.set(opponentTargetId, {
        ...cardStates.get(opponentTargetId)!,
        orientation: OrientationState.ACTIVE,
      });
      return { ...player, memberSlots: { ...player.memberSlots, cardStates } };
    });
    const resolved = confirmActiveEffectStepThroughPublicReveal(stale, PLAYER1, stale.activeEffect!.id, opponentTargetId);

    expect(getMemberEffectiveBladeCount(resolved, PLAYER2, opponentTargetId)).toBe(3);
    expect(latestPayload(resolved, PL_BP5_024_LIVE_START_PRIVATE_WARS_CHOICE_ABILITY_ID)).toMatchObject({
      step: 'PRIVATE_WARS_ACTIVATE_TARGET_UNAVAILABLE',
      selectedCardId: opponentTargetId,
    });
  });

  it('PL!-bp5-111 continuous Heart scales with other A-RISE members', () => {
    const source = createCardInstance(
      member('PL!-bp5-111-R', '綺羅ツバサ', { groupNames: ['A-RISE'] }),
      PLAYER1,
      'tsubasa'
    );
    const arise1 = createCardInstance(member('arise-1', 'A1', { groupNames: ['A-RISE'] }), PLAYER1, 'a1');
    const arise2 = createCardInstance(member('arise-2', 'A2', { groupNames: ['A-RISE'] }), PLAYER1, 'a2');
    let game = baseGame('tsubasa-continuous');
    game = registerCards(game, [source, arise1, arise2]);
    game = placeMember(game, PLAYER1, source.instanceId, SlotPosition.CENTER, OrientationState.ACTIVE);
    game = placeMember(game, PLAYER1, arise1.instanceId, SlotPosition.LEFT, OrientationState.ACTIVE);
    game = placeMember(game, PLAYER1, arise2.instanceId, SlotPosition.RIGHT, OrientationState.ACTIVE);

    const blueHeart = getMemberEffectiveHeartIcons(game, PLAYER1, source.instanceId).find(
      (heart) => heart.color === HeartColor.BLUE
    );

    expect(blueHeart?.count).toBe(2);
    expect(getMemberEffectiveHeartIcons(game, PLAYER1, source.instanceId)).toContainEqual({
      color: HeartColor.BLUE,
      count: 2,
    });
  });

  it('PL!-bp5-111 discards the selected hand card and activates own waiting member without recovery', () => {
    const { game, sourceId, ownTargetId, hand2, liveId } = setupTsubasaActivated({
      targetPlayer: PLAYER1,
      includeWaitingRoomLive: true,
    });
    const started = activateCardAbility(
      game,
      PLAYER1,
      sourceId,
      PL_BP5_111_ACTIVATED_DISCARD_ACTIVATE_WAITING_MEMBER_RECOVER_LIVE_ABILITY_ID
    );

    const discarded = confirmActiveEffectStepThroughPublicReveal(started, PLAYER1, started.activeEffect!.id, hand2);
    const resolved = confirmActiveEffectStepThroughPublicReveal(discarded, PLAYER1, discarded.activeEffect!.id, ownTargetId);

    expect(resolved.players[0].waitingRoom.cardIds).toContain(hand2);
    expect(resolved.players[0].hand.cardIds).not.toContain(liveId);
    expect(resolved.players[0].memberSlots.cardStates.get(ownTargetId)?.orientation).toBe(
      OrientationState.ACTIVE
    );
  });

  it('PL!-bp5-111 recovers a LIVE after activating an opponent waiting member', () => {
    const { game, sourceId, opponentTargetId, hand1, liveId } = setupTsubasaActivated({
      targetPlayer: PLAYER2,
      includeWaitingRoomLive: true,
    });
    const started = activateCardAbility(
      game,
      PLAYER1,
      sourceId,
      PL_BP5_111_ACTIVATED_DISCARD_ACTIVATE_WAITING_MEMBER_RECOVER_LIVE_ABILITY_ID
    );
    const discarded = confirmActiveEffectStepThroughPublicReveal(started, PLAYER1, started.activeEffect!.id, hand1);
    const activated = confirmActiveEffectStepThroughPublicReveal(discarded, PLAYER1, discarded.activeEffect!.id, opponentTargetId);
    const recovered = confirmActiveEffectStepThroughPublicReveal(activated, PLAYER1, activated.activeEffect!.id, liveId);

    expect(recovered.players[1].memberSlots.cardStates.get(opponentTargetId)?.orientation).toBe(
      OrientationState.ACTIVE
    );
    expect(recovered.players[0].hand.cardIds).toContain(liveId);
    expect(latestPayload(recovered, PL_BP5_111_ACTIVATED_DISCARD_ACTIVATE_WAITING_MEMBER_RECOVER_LIVE_ABILITY_ID)).toMatchObject({
      step: 'RECOVER_LIVE_AFTER_ACTIVATING_OPPONENT_MEMBER',
      recoveredCardIds: [liveId],
    });
  });

  it('PL!-bp5-111 keeps cost and activation when no LIVE recovery target exists', () => {
    const { game, sourceId, opponentTargetId, hand1 } = setupTsubasaActivated({
      targetPlayer: PLAYER2,
      includeWaitingRoomLive: false,
    });
    const started = activateCardAbility(
      game,
      PLAYER1,
      sourceId,
      PL_BP5_111_ACTIVATED_DISCARD_ACTIVATE_WAITING_MEMBER_RECOVER_LIVE_ABILITY_ID
    );
    const discarded = confirmActiveEffectStepThroughPublicReveal(started, PLAYER1, started.activeEffect!.id, hand1);
    const resolved = confirmActiveEffectStepThroughPublicReveal(discarded, PLAYER1, discarded.activeEffect!.id, opponentTargetId);

    expect(resolved.activeEffect).toBeNull();
    expect(resolved.players[1].memberSlots.cardStates.get(opponentTargetId)?.orientation).toBe(
      OrientationState.ACTIVE
    );
    expect(latestPayload(resolved, PL_BP5_111_ACTIVATED_DISCARD_ACTIVATE_WAITING_MEMBER_RECOVER_LIVE_ABILITY_ID)).toMatchObject({
      step: 'ACTIVATE_OPPONENT_WAITING_MEMBER_NO_LIVE_TARGET',
      recoveredCardIds: [],
    });
  });

  it('PL!-bp5-111 does not consume turn limit when illegal activation cannot start', () => {
    const source = createCardInstance(
      member('PL!-bp5-111-R', '綺羅ツバサ', { groupNames: ['A-RISE'] }),
      PLAYER1,
      'tsubasa'
    );
    let game = baseGame('tsubasa-illegal');
    game = registerCards(game, [source]);
    game = placeMember(game, PLAYER1, source.instanceId, SlotPosition.CENTER, OrientationState.ACTIVE);

    const result = activateCardAbility(
      game,
      PLAYER1,
      source.instanceId,
      PL_BP5_111_ACTIVATED_DISCARD_ACTIVATE_WAITING_MEMBER_RECOVER_LIVE_ABILITY_ID
    );

    expect(result.activeEffect).toBeNull();
    expect(
      result.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId ===
            PL_BP5_111_ACTIVATED_DISCARD_ACTIVATE_WAITING_MEMBER_RECOVER_LIVE_ABILITY_ID
      )
    ).toBe(false);
  });

  it('PL!-bp5-333 continuous Heart only applies while source is waiting', () => {
    const source = createCardInstance(member('PL!-bp5-333-R', '統堂英玲奈'), PLAYER1, 'erena');
    let game = baseGame('erena-continuous');
    game = registerCards(game, [source]);
    game = placeMember(game, PLAYER1, source.instanceId, SlotPosition.CENTER, OrientationState.ACTIVE);
    expect(
      getMemberEffectiveHeartIcons(game, PLAYER1, source.instanceId).some(
        (heart) => heart.color === HeartColor.BLUE
      )
    ).toBe(false);

    game = placeMember(game, PLAYER1, source.instanceId, SlotPosition.CENTER, OrientationState.WAITING);
    expect(getMemberEffectiveHeartIcons(game, PLAYER1, source.instanceId)).toContainEqual({
      color: HeartColor.BLUE,
      count: 1,
    });
  });

  it('PL!-bp5-333 decline leaves both members unchanged', () => {
    const { game, sourceId, opponentTargetId } = setupErenaOnEnter({ opponentCost: 9 });
    const started = resolveOnEnter(game, sourceId);
    const resolved = confirmActiveEffectStepThroughPublicReveal(started, PLAYER1, started.activeEffect!.id);

    expect(resolved.players[0].memberSlots.cardStates.get(sourceId)?.orientation).toBe(
      OrientationState.ACTIVE
    );
    expect(resolved.players[1].memberSlots.cardStates.get(opponentTargetId)?.orientation).toBe(
      OrientationState.ACTIVE
    );
  });

  it('PL!-bp5-333 keeps self waiting after paying when no opponent target exists', () => {
    const { game, sourceId } = setupErenaOnEnter({ opponentCost: 10 });
    const started = resolveOnEnter(game, sourceId);
    const resolved = confirmActiveEffectStepThroughPublicReveal(
      started,
      PLAYER1,
      started.activeEffect!.id,
      null,
      null,
      false,
      'pay-wait-self'
    );

    expect(resolved.activeEffect).toBeNull();
    expect(resolved.players[0].memberSlots.cardStates.get(sourceId)?.orientation).toBe(
      OrientationState.WAITING
    );
    expect(latestPayload(resolved, PL_BP5_333_ON_ENTER_WAIT_SELF_WAIT_OPPONENT_LOW_COST_ABILITY_ID)).toMatchObject({
      step: 'WAIT_SELF_NO_OPPONENT_TARGET',
      waitedMemberCardId: sourceId,
    });
  });

  it('PL!-bp5-333 pays self waiting then waits opponent cost 9 or lower member', () => {
    const { game, sourceId, opponentTargetId } = setupErenaOnEnter({ opponentCost: 9 });
    const started = resolveOnEnter(game, sourceId);
    const paid = confirmActiveEffectStepThroughPublicReveal(
      started,
      PLAYER1,
      started.activeEffect!.id,
      null,
      null,
      false,
      'pay-wait-self'
    );
    const resolved = confirmActiveEffectStepThroughPublicReveal(paid, PLAYER1, paid.activeEffect!.id, opponentTargetId);

    expect(resolved.players[0].memberSlots.cardStates.get(sourceId)?.orientation).toBe(
      OrientationState.WAITING
    );
    expect(resolved.players[1].memberSlots.cardStates.get(opponentTargetId)?.orientation).toBe(
      OrientationState.WAITING
    );
    expect(latestPayload(resolved, PL_BP5_333_ON_ENTER_WAIT_SELF_WAIT_OPPONENT_LOW_COST_ABILITY_ID)).toMatchObject({
      step: 'WAIT_SELF_WAIT_OPPONENT_LOW_COST_MEMBER',
      targetCardId: opponentTargetId,
    });
  });
});

function setupTsubasaActivated(options: {
  readonly targetPlayer: typeof PLAYER1 | typeof PLAYER2;
  readonly includeWaitingRoomLive: boolean;
}): {
  readonly game: GameState;
  readonly sourceId: string;
  readonly ownTargetId: string;
  readonly opponentTargetId: string;
  readonly hand1: string;
  readonly hand2: string;
  readonly liveId: string;
} {
  const source = createCardInstance(
    member('PL!-bp5-111-R', '綺羅ツバサ', { groupNames: ['A-RISE'] }),
    PLAYER1,
    'tsubasa'
  );
  const ownTarget = createCardInstance(member('own-waiting', 'Own Waiting'), PLAYER1, 'own-waiting');
  const opponentTarget = createCardInstance(
    member('opponent-waiting', 'Opponent Waiting'),
    PLAYER2,
    'opponent-waiting'
  );
  const hand1 = createCardInstance(member('hand-1', 'Hand 1'), PLAYER1, 'hand-1');
  const hand2 = createCardInstance(member('hand-2', 'Hand 2'), PLAYER1, 'hand-2');
  const recoverLive = createCardInstance(live('recover-live', 1), PLAYER1, 'recover-live');
  let game = baseGame('tsubasa-activated');
  game = registerCards(game, [source, ownTarget, opponentTarget, hand1, hand2, recoverLive]);
  game = placeMember(game, PLAYER1, source.instanceId, SlotPosition.CENTER, OrientationState.ACTIVE);
  game = placeMember(
    game,
    PLAYER1,
    ownTarget.instanceId,
    SlotPosition.LEFT,
    options.targetPlayer === PLAYER1 ? OrientationState.WAITING : OrientationState.ACTIVE
  );
  game = placeMember(
    game,
    PLAYER2,
    opponentTarget.instanceId,
    SlotPosition.CENTER,
    options.targetPlayer === PLAYER2 ? OrientationState.WAITING : OrientationState.ACTIVE
  );
  game = addToZone(game, PLAYER1, ZoneType.HAND, [hand1.instanceId, hand2.instanceId]);
  if (options.includeWaitingRoomLive) {
    game = addToZone(game, PLAYER1, ZoneType.WAITING_ROOM, [recoverLive.instanceId]);
  }
  return {
    game,
    sourceId: source.instanceId,
    ownTargetId: ownTarget.instanceId,
    opponentTargetId: opponentTarget.instanceId,
    hand1: hand1.instanceId,
    hand2: hand2.instanceId,
    liveId: recoverLive.instanceId,
  };
}

function setupErenaOnEnter(options: {
  readonly opponentCost: number;
}): { readonly game: GameState; readonly sourceId: string; readonly opponentTargetId: string } {
  const source = createCardInstance(member('PL!-bp5-333-R', '統堂英玲奈', { cost: 7 }), PLAYER1, 'erena');
  const opponentTarget = createCardInstance(
    member('opponent-target', 'Opponent', { cost: options.opponentCost }),
    PLAYER2,
    'erena-opponent-target'
  );
  let game = baseGame('erena-on-enter');
  game = registerCards(game, [source, opponentTarget]);
  game = placeMember(game, PLAYER1, source.instanceId, SlotPosition.CENTER, OrientationState.ACTIVE);
  game = placeMember(game, PLAYER2, opponentTarget.instanceId, SlotPosition.CENTER, OrientationState.ACTIVE);
  return { game, sourceId: source.instanceId, opponentTargetId: opponentTarget.instanceId };
}
