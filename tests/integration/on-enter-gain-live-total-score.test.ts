import { describe, expect, it } from 'vitest';
import { createPlayMemberToSlotCommand } from '../../src/application/game-commands';
import { createGameSession } from '../../src/application/game-session';
import { GameService } from '../../src/application/game-service';
import {
  confirmActiveEffectStep,
  enqueueTriggeredCardEffects,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import {
  PL_BP4_007_ON_ENTER_SUCCESS_LIVE_EXISTS_SCORE_AT_MOST_ONE_GAIN_SCORE_ABILITY_ID as ABILITY,
  SP_SD1_004_ON_ENTER_GAIN_LIVE_TOTAL_SCORE_ONE_ABILITY_ID as SP_ABILITY,
} from '../../src/application/card-effects/ability-ids';
import { getCardAbilityDefinitionsForCardCode } from '../../src/application/card-effects/definitions/lookup';
import { sendStageMemberToWaitingRoomAndEnqueueLeaveStageTriggers } from '../../src/application/card-effects/runtime/leave-stage-triggers';
import { moveMemberBetweenSlots } from '../../src/application/effects/member-state';
import {
  createCardInstance,
  createHeartIcon,
  createHeartRequirement,
  type LiveCardData,
  type MemberCardData,
} from '../../src/domain/entities/card';
import {
  createGameState,
  registerCards,
  updatePlayer,
  type GameState,
  type PendingAbilityState,
} from '../../src/domain/entities/game';
import {
  addCardToStatefulZone,
  addMemberBelowMember,
  placeCardInSlot,
  removeCardFromSlot,
} from '../../src/domain/entities/zone';
import { getPlayerLiveScoreModifier } from '../../src/domain/rules/live-modifiers';
import { sumSuccessfulLiveScore } from '../../src/domain/rules/success-live-score';
import {
  CardType,
  FaceState,
  GamePhase,
  HeartColor,
  OrientationState,
  SlotPosition,
  SubPhase,
  TriggerCondition,
  TurnType,
} from '../../src/shared/types/enums';

const P1 = 'p1';
const P2 = 'p2';
const EFFECT_TEXT =
  '【登场】自己的成功LIVE卡区存在大于等于1张卡片，且分数合计小于等于1的场合，LIVE结束时为止，获得「【常时】LIVE的合计分数+1。」。';

function member(
  cardCode = 'PL!-bp4-007-R',
  name = '東條 希',
  groupNames: readonly string[] = ["μ's"]
): MemberCardData {
  return {
    cardCode,
    name,
    groupNames,
    cardType: CardType.MEMBER,
    cost: 11,
    blade: 3,
    hearts: [createHeartIcon(HeartColor.PINK, 2)],
  };
}

function live(cardCode: string, score: number): LiveCardData {
  return {
    cardCode,
    name: cardCode,
    groupNames: ["μ's"],
    cardType: CardType.LIVE,
    score,
    requirements: createHeartRequirement({}),
  };
}

function pending(
  id: string,
  sourceCardId: string,
  sourceSlot: SlotPosition = SlotPosition.CENTER,
  abilityId = ABILITY
): PendingAbilityState {
  return {
    id,
    abilityId,
    sourceCardId,
    controllerId: P1,
    mandatory: true,
    timingId: TriggerCondition.ON_ENTER_STAGE,
    sourceSlot,
    eventIds: [`event-${id}`],
  };
}

interface ScenarioOptions {
  readonly successScores?: readonly number[];
  readonly sourceCardCode?: string;
  readonly sourceOwnerId?: string;
  readonly sourceOrientation?: OrientationState;
  readonly sourceLocation?: 'STAGE' | 'MEMBER_BELOW' | 'HAND' | 'WAITING_ROOM' | 'FORGED_SLOT';
  readonly sourceIsLive?: boolean;
  readonly extraStageMembers?: readonly ReturnType<typeof createCardInstance<MemberCardData>>[];
}

function setup(options: ScenarioOptions = {}) {
  const source = options.sourceIsLive
    ? createCardInstance(live(options.sourceCardCode ?? 'PL!-bp4-007-R', 1), options.sourceOwnerId ?? P1, 'nozomi')
    : createCardInstance(
        member(options.sourceCardCode ?? 'PL!-bp4-007-R'),
        options.sourceOwnerId ?? P1,
        'nozomi'
      );
  const successLives = (options.successScores ?? [1]).map((score, index) =>
    createCardInstance(live(`SUCCESS-${index}`, score), P1, `success-${index}`)
  );
  const extraStageMembers = options.extraStageMembers ?? [];
  let game = createGameState('pl-bp4-007', P1, 'P1', P2, 'P2');
  game = registerCards(game, [source, ...successLives, ...extraStageMembers]);
  game = updatePlayer(game, P1, (player) => {
    let memberSlots = player.memberSlots;
    const sourceLocation = options.sourceLocation ?? 'STAGE';
    if (sourceLocation === 'STAGE') {
      memberSlots = placeCardInSlot(memberSlots, SlotPosition.CENTER, source.instanceId, {
        orientation: options.sourceOrientation ?? OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      });
    } else if (sourceLocation === 'MEMBER_BELOW') {
      memberSlots = addMemberBelowMember(memberSlots, SlotPosition.CENTER, source.instanceId);
    } else if (sourceLocation === 'FORGED_SLOT') {
      memberSlots = placeCardInSlot(memberSlots, SlotPosition.CENTER, 'forged-source');
    }
    extraStageMembers.forEach((card, index) => {
      memberSlots = placeCardInSlot(
        memberSlots,
        index === 0 ? SlotPosition.LEFT : SlotPosition.RIGHT,
        card.instanceId
      );
    });
    return {
      ...player,
      memberSlots,
      hand:
        sourceLocation === 'HAND'
          ? { ...player.hand, cardIds: [source.instanceId] }
          : player.hand,
      waitingRoom:
        sourceLocation === 'WAITING_ROOM'
          ? { ...player.waitingRoom, cardIds: [source.instanceId] }
          : player.waitingRoom,
      successZone: {
        ...player.successZone,
        cardIds: successLives.map((card) => card.instanceId),
      },
    };
  });
  return { game, source, successLives };
}

function resolveOne(game: GameState, sourceCardId = 'nozomi', abilityId = ABILITY): GameState {
  return resolvePendingCardEffects({
    ...game,
    pendingAbilities: [pending('pending-score', sourceCardId, SlotPosition.CENTER, abilityId)],
  }).gameState;
}

function scoreModifiers(game: GameState, abilityId = ABILITY) {
  return game.liveResolution.liveModifiers.filter(
    (modifier) => modifier.kind === 'SCORE' && modifier.abilityId === abilityId
  );
}

describe('PL!-bp4-007-R / P 費用11 東條 希', () => {
  it.each(['PL!-bp4-007-R', 'PL!-bp4-007-P'])('%s maps to the unique implemented base definition with exact text', (cardCode) => {
    const definitions = getCardAbilityDefinitionsForCardCode(cardCode).filter(
      (definition) => definition.abilityId === ABILITY && definition.implemented
    );
    expect(definitions).toHaveLength(1);
    expect(definitions[0]).toMatchObject({
      baseCardCodes: ['PL!-bp4-007'],
      category: 'ON_ENTER',
      sourceZone: 'STAGE_MEMBER',
      triggerCondition: TriggerCondition.ON_ENTER_STAGE,
      queued: true,
      effectText: EFFECT_TEXT,
    });
  });

  it('uses real PLAY_MEMBER -> ON_ENTER_STAGE with exact source instance, slot, timing, and ability id', () => {
    const session = createGameSession();
    session.createGame('pl-bp4-007-real-enter', P1, 'P1', P2, 'P2');
    const source = createCardInstance(member('PL!-bp4-007-R'), P1, 'real-nozomi');
    const success = createCardInstance(live('SUCCESS-ONE', 1), P1, 'real-success');
    let game = registerCards(session.state!, [source, success]);
    game = updatePlayer(game, P1, (player) => ({
      ...player,
      hand: { ...player.hand, cardIds: [source.instanceId] },
      successZone: { ...player.successZone, cardIds: [success.instanceId] },
    }));
    (session as unknown as { authorityState: GameState }).authorityState = {
      ...game,
      currentPhase: GamePhase.MAIN_PHASE,
      currentSubPhase: SubPhase.NONE,
      activePlayerIndex: 0,
    };

    session.setManualOperationMode('FREE');
    const result = session.executeCommand(
      createPlayMemberToSlotCommand(P1, source.instanceId, SlotPosition.LEFT, { freePlay: true })
    );
    expect(result.success, result.error).toBe(true);
    const trigger = session.state!.actionHistory.find(
      (action) => action.type === 'TRIGGER_ABILITY' && action.payload.abilityId === ABILITY
    );
    expect(trigger?.payload).toMatchObject({
      abilityId: ABILITY,
      sourceCardId: source.instanceId,
      sourceSlot: SlotPosition.LEFT,
      timingId: TriggerCondition.ON_ENTER_STAGE,
    });
    expect(scoreModifiers(session.state!)).toContainEqual(
      expect.objectContaining({ sourceCardId: source.instanceId, targetMemberCardId: source.instanceId })
    );
    expect(session.state!.activeEffect).toBeNull();
  });

  it.each([
    { scores: [], expected: false, count: 0, score: 0 },
    { scores: [0], expected: true, count: 1, score: 0 },
    { scores: [1], expected: true, count: 1, score: 1 },
    { scores: [2], expected: false, count: 1, score: 2 },
    { scores: [0, 1], expected: true, count: 2, score: 1 },
    { scores: [1, 1], expected: false, count: 2, score: 2 },
  ])('checks success count and effective score independently: $scores', ({ scores, expected, count, score }) => {
    const resolved = resolveOne(setup({ successScores: scores }).game);
    expect(scoreModifiers(resolved)).toHaveLength(expected ? 1 : 0);
    const action = resolved.actionHistory.find(
      (candidate) => candidate.type === 'RESOLVE_ABILITY' && candidate.payload.abilityId === ABILITY
    );
    expect(action?.payload).toMatchObject({
      successfulLiveCardCount: count,
      successfulLiveScore: score,
      conditionMet: expected,
      modifierApplied: expected,
    });
    expect(resolved.activeEffect).toBeNull();
  });

  it('reads PL!-bp4-019-L as effective score 9 while the entering 007 is a stage μ\'s member', () => {
    const scenario = setup({ successScores: [] });
    const angelic = createCardInstance(live('PL!-bp4-019-L', 4), P1, 'angelic');
    let game = registerCards(scenario.game, [angelic]);
    game = updatePlayer(game, P1, (player) => ({
      ...player,
      successZone: { ...player.successZone, cardIds: [angelic.instanceId] },
    }));
    expect(sumSuccessfulLiveScore(game, P1)).toBe(9);
    const resolved = resolveOne(game);
    expect(scoreModifiers(resolved)).toEqual([]);
    expect(resolved.actionHistory.at(-1)?.payload).toMatchObject({
      successfulLiveCardCount: 1,
      successfulLiveScore: 9,
      conditionMet: false,
    });
  });

  it.each([OrientationState.ACTIVE, OrientationState.WAITING])('allows a %s source to receive the granted ability', (orientation) => {
    const { game, source } = setup({ sourceOrientation: orientation });
    const resolved = resolveOne(game);
    expect(scoreModifiers(resolved)).toContainEqual(
      expect.objectContaining({
        kind: 'SCORE',
        playerId: P1,
        countDelta: 1,
        sourceCardId: source.instanceId,
        targetMemberCardId: source.instanceId,
        abilityId: ABILITY,
      })
    );
  });

  it.each([
    ['wrong owner', { sourceOwnerId: P2 }],
    ['memberBelow', { sourceLocation: 'MEMBER_BELOW' as const }],
    ['hand', { sourceLocation: 'HAND' as const }],
    ['waiting room', { sourceLocation: 'WAITING_ROOM' as const }],
    ['non-member', { sourceIsLive: true }],
    ['wrong base', { sourceCardCode: 'PL!-bp4-008-R' }],
  ])('rejects %s as a source and consumes the pending', (_label, options) => {
    const resolved = resolveOne(setup(options).game);
    expect(scoreModifiers(resolved)).toEqual([]);
    expect(resolved.pendingAbilities).toEqual([]);
    expect(resolved.actionHistory.at(-1)?.payload).toMatchObject({
      step: 'SOURCE_NOT_VALID_ON_STAGE',
      conditionMet: false,
      modifierApplied: false,
      resultText: '来源成员不在自己的舞台，本能力没有效果。',
    });
  });

  it('rejects a forged unregistered instance even when its id is placed in a main stage slot', () => {
    const resolved = resolveOne(setup({ sourceLocation: 'FORGED_SLOT' }).game, 'forged-source');
    expect(scoreModifiers(resolved)).toEqual([]);
    expect(resolved.pendingAbilities).toEqual([]);
    expect(resolved.actionHistory.at(-1)?.payload).toMatchObject({
      sourceCardId: 'forged-source',
      step: 'SOURCE_NOT_VALID_ON_STAGE',
      modifierApplied: false,
    });
  });

  it('consumes a stale source that leaves after pending creation and continues resolution', () => {
    const { game, source } = setup();
    const queued = { ...game, pendingAbilities: [pending('pending-007', source.instanceId)] };
    const left = updatePlayer(queued, P1, (player) => ({
      ...player,
      memberSlots: removeCardFromSlot(player.memberSlots, SlotPosition.CENTER),
      waitingRoom: { ...player.waitingRoom, cardIds: [source.instanceId] },
    }));
    const resolved = resolvePendingCardEffects(left).gameState;
    expect(resolved.pendingAbilities).toEqual([]);
    expect(scoreModifiers(resolved)).toEqual([]);
    expect(resolved.activeEffect).toBeNull();
  });

  it('keeps the modifier across stage movement and removes it through the standard target-bound leave path', () => {
    const { game, source } = setup();
    const granted = resolveOne(game);
    const moved = moveMemberBetweenSlots(granted, P1, source.instanceId, SlotPosition.LEFT);
    expect(moved).not.toBeNull();
    expect(scoreModifiers(moved!.gameState)).toHaveLength(1);
    const left = sendStageMemberToWaitingRoomAndEnqueueLeaveStageTriggers(
      moved!.gameState,
      P1,
      source.instanceId,
      enqueueTriggeredCardEffects
    );
    expect(left).not.toBeNull();
    expect(scoreModifiers(left!.gameState)).toEqual([]);
    expect(getPlayerLiveScoreModifier(left!.gameState.liveResolution, P1)).toBe(0);
  });

  it('does not dynamically revoke the granted modifier after success-zone facts change', () => {
    const { game, successLives } = setup({ successScores: [1] });
    const granted = resolveOne(game);
    const highScore = createCardInstance(live('HIGH-SCORE', 8), P1, 'high-score');
    let changed = registerCards(granted, [highScore]);
    changed = updatePlayer(changed, P1, (player) => ({
      ...player,
      successZone: {
        ...player.successZone,
        cardIds: [successLives[0].instanceId, highScore.instanceId],
      },
    }));
    expect(sumSuccessfulLiveScore(changed, P1)).toBe(9);
    expect(scoreModifiers(changed)).toHaveLength(1);
  });

  it('stacks two different 007 instances, resolves both pending, and removes only the instance that leaves', () => {
    const first = createCardInstance(member('PL!-bp4-007-R'), P1, 'nozomi-r');
    const second = createCardInstance(member('PL!-bp4-007-P'), P1, 'nozomi-p');
    const success = createCardInstance(live('SUCCESS', 1), P1, 'success');
    let game = registerCards(createGameState('two-nozomi', P1, 'P1', P2, 'P2'), [first, second, success]);
    game = updatePlayer(game, P1, (player) => ({
      ...player,
      memberSlots: placeCardInSlot(
        placeCardInSlot(player.memberSlots, SlotPosition.LEFT, first.instanceId),
        SlotPosition.RIGHT,
        second.instanceId
      ),
      successZone: { ...player.successZone, cardIds: [success.instanceId] },
    }));
    let resolving = resolvePendingCardEffects({
      ...game,
      pendingAbilities: [
        pending('pending-r', first.instanceId, SlotPosition.LEFT),
        pending('pending-p', second.instanceId, SlotPosition.RIGHT),
      ],
    }).gameState;
    expect(resolving.activeEffect).not.toBeNull();
    resolving = confirmActiveEffectStep(
      resolving,
      P1,
      resolving.activeEffect!.id,
      null,
      null,
      true
    );
    expect(resolving.pendingAbilities).toEqual([]);
    expect(resolving.activeEffect).toBeNull();
    expect(scoreModifiers(resolving)).toHaveLength(2);
    expect(getPlayerLiveScoreModifier(resolving.liveResolution, P1)).toBe(2);

    const afterFirstLeaves = sendStageMemberToWaitingRoomAndEnqueueLeaveStageTriggers(
      resolving,
      P1,
      first.instanceId,
      enqueueTriggeredCardEffects
    )!.gameState;
    expect(scoreModifiers(afterFirstLeaves)).toEqual([
      expect.objectContaining({ sourceCardId: second.instanceId, targetMemberCardId: second.instanceId }),
    ]);
    expect(getPlayerLiveScoreModifier(afterFirstLeaves.liveResolution, P1)).toBe(1);
  });

  it('is consumed by the real LIVE score calculation without directly pre-writing playerScores', () => {
    const { game } = setup({ successScores: [1] });
    const currentLive = createCardInstance(live('CURRENT-LIVE', 1), P1, 'current-live');
    let granted = registerCards(resolveOne(game), [currentLive]);
    expect(granted.liveResolution.playerScores.size).toBe(0);
    granted = updatePlayer(granted, P1, (player) => ({
      ...player,
      liveZone: addCardToStatefulZone(player.liveZone, currentLive.instanceId),
    }));
    granted = {
      ...granted,
      currentPhase: GamePhase.PERFORMANCE_PHASE,
      currentSubPhase: SubPhase.PERFORMANCE_JUDGMENT,
      currentTurnType: TurnType.FIRST_PLAYER_TURN,
      activePlayerIndex: 0,
      liveResolution: {
        ...granted.liveResolution,
        isInLive: true,
        performingPlayerId: P1,
      },
    };
    const result = new GameService().processAction(granted, {
      type: 'CONFIRM_JUDGMENT',
      playerId: P1,
      judgmentResults: new Map(),
      timestamp: Date.now(),
    });
    expect(result.success, result.error).toBe(true);
    expect(result.gameState.liveResolution.playerScores.get(P1)).toBe(2);
    expect(
      result.gameState.actionHistory.find(
        (action) => action.type === 'LIVE_JUDGMENT' && action.payload.action === 'AUTO_PERFORMANCE_JUDGMENT'
      )?.payload
    ).toMatchObject({ scoreDraft: 2, effectScoreBonus: 1 });
  });
});

describe('PL!SP-sd1-004-SD 费用11 平安名すみれ', () => {
  it('maps only the SD printing to the exact independent implemented definition', () => {
    expect(getCardAbilityDefinitionsForCardCode('PL!SP-sd1-004-SD')).toEqual([
      expect.objectContaining({
        abilityId: SP_ABILITY,
        baseCardCodes: ['PL!SP-sd1-004'],
        category: 'ON_ENTER',
        sourceZone: 'PLAYED_MEMBER',
        triggerCondition: TriggerCondition.ON_ENTER_STAGE,
        queued: true,
        implemented: true,
        effectText: '【登场】LIVE结束时为止，获得「【常时】LIVE的合计分数+1。」。',
      }),
    ]);
  });

  it('uses real PLAY_MEMBER -> ON_ENTER_STAGE and gains score with no successful LIVE cards', () => {
    const session = createGameSession();
    session.createGame('sp-sd1-004-real-enter', P1, 'P1', P2, 'P2');
    const source = createCardInstance(member('PL!SP-sd1-004-SD', '平安名すみれ'), P1, 'real-sumire');
    let game = registerCards(session.state!, [source]);
    game = updatePlayer(game, P1, (player) => ({
      ...player,
      hand: { ...player.hand, cardIds: [source.instanceId] },
    }));
    (session as unknown as { authorityState: GameState }).authorityState = {
      ...game,
      currentPhase: GamePhase.MAIN_PHASE,
      currentSubPhase: SubPhase.NONE,
      activePlayerIndex: 0,
    };

    session.setManualOperationMode('FREE');
    const result = session.executeCommand(
      createPlayMemberToSlotCommand(P1, source.instanceId, SlotPosition.RIGHT, { freePlay: true })
    );
    expect(result.success, result.error).toBe(true);
    expect(
      session.state!.actionHistory.find(
        (action) => action.type === 'TRIGGER_ABILITY' && action.payload.abilityId === SP_ABILITY
      )?.payload
    ).toMatchObject({
      sourceCardId: source.instanceId,
      sourceSlot: SlotPosition.RIGHT,
      timingId: TriggerCondition.ON_ENTER_STAGE,
    });
    expect(scoreModifiers(session.state!, SP_ABILITY)).toEqual([
      expect.objectContaining({
        playerId: P1,
        countDelta: 1,
        sourceCardId: source.instanceId,
        targetMemberCardId: source.instanceId,
      }),
    ]);
    expect(session.state!.activeEffect).toBeNull();
  });

  it.each([OrientationState.ACTIVE, OrientationState.WAITING])(
    'grants the unconditional score ability to a %s source',
    (orientation) => {
      const { game, source } = setup({
        sourceCardCode: 'PL!SP-sd1-004-SD',
        sourceOrientation: orientation,
        successScores: [],
      });
      const resolved = resolveOne(game, source.instanceId, SP_ABILITY);
      expect(scoreModifiers(resolved, SP_ABILITY)).toEqual([
        expect.objectContaining({ sourceCardId: source.instanceId, targetMemberCardId: source.instanceId }),
      ]);
      expect(resolved.actionHistory.at(-1)?.payload).toMatchObject({
        abilityId: SP_ABILITY,
        step: 'GAIN_TARGET_BOUND_PLAYER_SCORE',
        conditionMet: true,
        modifierApplied: true,
      });
      expect(resolved.actionHistory.at(-1)?.payload).not.toHaveProperty('successfulLiveCardCount');
    }
  );

  it.each([
    ['wrong owner', { sourceOwnerId: P2 }],
    ['wrong base', { sourceCardCode: 'PL!SP-sd1-003-SD' }],
    ['non-member', { sourceIsLive: true, sourceCardCode: 'PL!SP-sd1-004-SD' }],
    ['hand', { sourceLocation: 'HAND' as const }],
    ['waiting room', { sourceLocation: 'WAITING_ROOM' as const }],
    ['memberBelow', { sourceLocation: 'MEMBER_BELOW' as const }],
  ])('consumes the pending without a modifier for %s', (_label, options) => {
    const { game, source } = setup({
      ...options,
      sourceCardCode: options.sourceCardCode ?? 'PL!SP-sd1-004-SD',
      successScores: [],
    });
    const resolved = resolveOne(game, source.instanceId, SP_ABILITY);
    expect(resolved.pendingAbilities).toEqual([]);
    expect(scoreModifiers(resolved, SP_ABILITY)).toEqual([]);
    expect(resolved.actionHistory.at(-1)?.payload).toMatchObject({
      abilityId: SP_ABILITY,
      step: 'SOURCE_NOT_VALID_ON_STAGE',
      modifierApplied: false,
    });
  });

  it('rejects a forged slot id and safely consumes a source that leaves after pending creation', () => {
    const forged = resolveOne(
      setup({ sourceLocation: 'FORGED_SLOT', sourceCardCode: 'PL!SP-sd1-004-SD' }).game,
      'forged-source',
      SP_ABILITY
    );
    expect(forged.pendingAbilities).toEqual([]);
    expect(scoreModifiers(forged, SP_ABILITY)).toEqual([]);

    const { game, source } = setup({ sourceCardCode: 'PL!SP-sd1-004-SD', successScores: [] });
    const queued = {
      ...game,
      pendingAbilities: [pending('pending-004', source.instanceId, SlotPosition.CENTER, SP_ABILITY)],
    };
    const left = updatePlayer(queued, P1, (player) => ({
      ...player,
      memberSlots: removeCardFromSlot(player.memberSlots, SlotPosition.CENTER),
      waitingRoom: { ...player.waitingRoom, cardIds: [source.instanceId] },
    }));
    const resolved = resolvePendingCardEffects(left).gameState;
    expect(resolved.pendingAbilities).toEqual([]);
    expect(scoreModifiers(resolved, SP_ABILITY)).toEqual([]);
    expect(resolved.activeEffect).toBeNull();
  });

  it('keeps the modifier across movement and removes only the leaving source instance', () => {
    const first = createCardInstance(member('PL!SP-sd1-004-SD', '平安名すみれ'), P1, 'sumire-1');
    const second = createCardInstance(member('PL!SP-sd1-004-SD', '平安名すみれ'), P1, 'sumire-2');
    let game = registerCards(createGameState('two-sumire', P1, 'P1', P2, 'P2'), [first, second]);
    game = updatePlayer(game, P1, (player) => ({
      ...player,
      memberSlots: placeCardInSlot(
        placeCardInSlot(player.memberSlots, SlotPosition.LEFT, first.instanceId),
        SlotPosition.RIGHT,
        second.instanceId
      ),
    }));
    let resolving = resolvePendingCardEffects({
      ...game,
      pendingAbilities: [
        pending('sumire-1', first.instanceId, SlotPosition.LEFT, SP_ABILITY),
        pending('sumire-2', second.instanceId, SlotPosition.RIGHT, SP_ABILITY),
      ],
    }).gameState;
    resolving = confirmActiveEffectStep(
      resolving,
      P1,
      resolving.activeEffect!.id,
      null,
      null,
      true
    );
    expect(scoreModifiers(resolving, SP_ABILITY)).toHaveLength(2);
    expect(getPlayerLiveScoreModifier(resolving.liveResolution, P1)).toBe(2);

    const moved = moveMemberBetweenSlots(resolving, P1, first.instanceId, SlotPosition.CENTER)!;
    expect(scoreModifiers(moved.gameState, SP_ABILITY)).toHaveLength(2);
    const left = sendStageMemberToWaitingRoomAndEnqueueLeaveStageTriggers(
      moved.gameState,
      P1,
      first.instanceId,
      enqueueTriggeredCardEffects
    )!.gameState;
    expect(scoreModifiers(left, SP_ABILITY)).toEqual([
      expect.objectContaining({ sourceCardId: second.instanceId, targetMemberCardId: second.instanceId }),
    ]);
    expect(getPlayerLiveScoreModifier(left.liveResolution, P1)).toBe(1);
  });

  it('does not duplicate a modifier when the same source and ability resolve twice', () => {
    const { game, source } = setup({ sourceCardCode: 'PL!SP-sd1-004-SD', successScores: [] });
    const once = resolveOne(game, source.instanceId, SP_ABILITY);
    const twice = resolvePendingCardEffects({
      ...once,
      pendingAbilities: [pending('repeat-004', source.instanceId, SlotPosition.CENTER, SP_ABILITY)],
    }).gameState;
    expect(scoreModifiers(twice, SP_ABILITY)).toHaveLength(1);
    expect(twice.actionHistory.at(-1)?.payload).toMatchObject({
      modifierApplied: false,
      modifierAlreadyPresent: true,
    });
  });

  it('feeds real LIVE judgment without pre-writing playerScores and clears at LIVE settlement', () => {
    const { game, source } = setup({ sourceCardCode: 'PL!SP-sd1-004-SD', successScores: [] });
    const currentLive = createCardInstance(live('CURRENT-SP-LIVE', 1), P1, 'current-sp-live');
    let granted = registerCards(resolveOne(game, source.instanceId, SP_ABILITY), [currentLive]);
    expect(granted.liveResolution.playerScores.size).toBe(0);
    granted = updatePlayer(granted, P1, (player) => ({
      ...player,
      liveZone: addCardToStatefulZone(player.liveZone, currentLive.instanceId),
    }));
    granted = {
      ...granted,
      currentPhase: GamePhase.PERFORMANCE_PHASE,
      currentSubPhase: SubPhase.PERFORMANCE_JUDGMENT,
      currentTurnType: TurnType.FIRST_PLAYER_TURN,
      activePlayerIndex: 0,
      liveResolution: { ...granted.liveResolution, isInLive: true, performingPlayerId: P1 },
    };
    const judged = new GameService().processAction(granted, {
      type: 'CONFIRM_JUDGMENT',
      playerId: P1,
      judgmentResults: new Map(),
      timestamp: Date.now(),
    });
    expect(judged.success, judged.error).toBe(true);
    expect(judged.gameState.liveResolution.playerScores.get(P1)).toBe(2);

    const finalized = new GameService().finalizeLiveResult({
      ...judged.gameState,
      currentPhase: GamePhase.LIVE_RESULT_PHASE,
      currentSubPhase: SubPhase.RESULT_SETTLEMENT,
    });
    expect(finalized.success).toBe(true);
    expect(finalized.gameState.liveResolution.liveModifiers).toEqual([]);
  });
});
