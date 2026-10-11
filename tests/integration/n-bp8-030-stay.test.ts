import { describe, expect, it } from 'vitest';
import {
  ABILITY_ORDER_SELECTION_ID,
  confirmActiveEffectStep,
  enqueueTriggeredCardEffects,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import {
  N_BP7_031_AUTO_OWN_LIVE_SUCCESS_MILL_RECOVER_NIJIGASAKI_LIVE_SCORE_ABILITY_ID,
  N_BP8_030_AUTO_FROM_WAITING_ROOM_REDUCE_REQUIREMENT_ABILITY_ID,
  N_BP8_030_LIVE_SUCCESS_MILL_FIVE_GAIN_SCORE_ABILITY_ID,
  S_PR_016_ON_ENTER_GAIN_ONE_BLADE_ABILITY_ID,
} from '../../src/application/card-effects/ability-ids';
import { getCardAbilityDefinitionsForCardCode } from '../../src/application/card-effects/definitions/lookup';
import {
  placeHandLiveCardInLiveZoneForPlayer,
  placeWaitingRoomLiveCardInLiveZoneForPlayer,
  returnLiveZoneCardToHandForPlayer,
} from '../../src/application/card-effects/runtime/actions';
import { PUBLIC_REVEAL_DWELL_STEP_ID } from '../../src/application/card-effects/runtime/public-reveal-dwell';
import {
  createCardInstance,
  createHeartIcon,
  createHeartRequirement,
  type LiveCardData,
  type MemberCardData,
} from '../../src/domain/entities/card';
import {
  createGameState,
  emitGameEvent,
  registerCards,
  updatePlayer,
  type GameState,
} from '../../src/domain/entities/game';
import {
  addCardToStatefulZone,
  addCardToZone,
  removeCardFromStatefulZone,
  placeCardInSlot,
} from '../../src/domain/entities/zone';
import {
  createEnterLiveZoneEvent,
  createEnterStageEvent,
  createLiveSuccessEvent,
} from '../../src/domain/events/game-events';
import {
  getLiveCardRequirementModifiers,
  getMemberEffectiveBladeCount,
} from '../../src/domain/rules/live-modifiers';
import { applyHeartRequirementModifiers } from '../../src/domain/rules/live-requirement-modifiers';
import { createPublicObjectId, projectPlayerViewState } from '../../src/online/projector';
import {
  BladeHeartEffect,
  CardType,
  FaceState,
  HeartColor,
  OrientationState,
  SlotPosition,
  TriggerCondition,
  ZoneType,
} from '../../src/shared/types/enums';

const P1 = 'p1';
const P2 = 'p2';
const SOURCE_ID = 'stay';
const AUTO_ID = N_BP8_030_AUTO_FROM_WAITING_ROOM_REDUCE_REQUIREMENT_ABILITY_ID;
const SUCCESS_ID = N_BP8_030_LIVE_SUCCESS_MILL_FIVE_GAIN_SCORE_ABILITY_ID;
const AUTO_TEXT =
  '【自动】此卡从休息室被放置于LIVE卡区时，此卡的必要HEART减少[無ハート][無ハート][無ハート]。';
const SUCCESS_TEXT =
  '【LIVE成功时】将自己的卡组顶的５张卡片放置入休息室。那些卡片中存在费用大于等于9的不持有BLADE HEART的『虹咲』的成员卡的场合，此卡的分数＋１。';

function liveData(cardCode = 'PL!N-bp8-030-L', name = 'Stay'): LiveCardData {
  return {
    cardCode,
    name,
    groupNames: ['虹ヶ咲'],
    cardType: CardType.LIVE,
    score: 6,
    bladeHearts: [{ effect: BladeHeartEffect.HEART, heartColor: HeartColor.RAINBOW }],
    requirements: createHeartRequirement({
      [HeartColor.PINK]: 3,
      [HeartColor.GREEN]: 2,
      [HeartColor.YELLOW]: 3,
      [HeartColor.RAINBOW]: 6,
    }),
  };
}

function member(id: string, changes: Partial<MemberCardData> = {}) {
  return createCardInstance(
    {
      cardCode: `PL!N-test-${id}`,
      name: id,
      cardType: CardType.MEMBER,
      groupNames: ['虹ヶ咲'],
      cost: 9,
      blade: 1,
      hearts: [createHeartIcon(HeartColor.PINK, 1)],
      ...changes,
    },
    P1,
    id
  );
}

function filler(id: string) {
  return member(id, { cost: 1 });
}

function setup(
  options: {
    readonly code?: string;
    readonly sourceZone?: 'LIVE' | 'WAITING_ROOM';
    readonly topCards?: readonly ReturnType<typeof createCardInstance>[];
    readonly waitingCards?: readonly ReturnType<typeof createCardInstance>[];
  } = {}
) {
  const source = createCardInstance(liveData(options.code), P1, SOURCE_ID);
  const topCards = options.topCards ?? [];
  const waitingCards = options.waitingCards ?? [];
  let game = registerCards(createGameState('n-bp8-030-stay', P1, 'P1', P2, 'P2'), [
    source,
    ...topCards,
    ...waitingCards,
  ]);
  game = updatePlayer(game, P1, (player) => ({
    ...player,
    liveZone:
      options.sourceZone === 'WAITING_ROOM'
        ? player.liveZone
        : addCardToStatefulZone(player.liveZone, SOURCE_ID, {
            face: FaceState.FACE_UP,
            orientation: OrientationState.ACTIVE,
          }),
    mainDeck: { ...player.mainDeck, cardIds: topCards.map((card) => card.instanceId) },
    waitingRoom: {
      ...player.waitingRoom,
      cardIds: [
        ...(options.sourceZone === 'WAITING_ROOM' ? [SOURCE_ID] : []),
        ...waitingCards.map((card) => card.instanceId),
      ],
    },
  }));
  game = { ...game, liveResolution: { ...game.liveResolution, playerScores: new Map([[P1, 6]]) } };
  return { game, source };
}

function resolve(game: GameState): GameState {
  return resolvePendingCardEffects(game).gameState;
}

function enqueueSuccess(game: GameState): GameState {
  const event = createLiveSuccessEvent(P1, [SOURCE_ID], 6);
  return enqueueTriggeredCardEffects(
    emitGameEvent(game, event),
    [TriggerCondition.ON_LIVE_SUCCESS],
    {
      liveSuccessEvents: [event],
    }
  );
}

function placeFromWaitingRoom(game: GameState, face = FaceState.FACE_UP): GameState {
  return placeWaitingRoomLiveCardInLiveZoneForPlayer(game, P1, SOURCE_ID, {
    candidateCardIds: [SOURCE_ID],
    face,
  })!.gameState;
}

function requirementReduction(game: GameState): number {
  return getLiveCardRequirementModifiers(game.liveResolution, SOURCE_ID)
    .filter((modifier) => modifier.color === HeartColor.RAINBOW)
    .reduce((total, modifier) => total - modifier.countDelta, 0);
}

function finishDwell(game: GameState): GameState {
  expect(game.activeEffect?.stepId).toBe(PUBLIC_REVEAL_DWELL_STEP_ID);
  return confirmActiveEffectStep(game, P1, game.activeEffect!.id);
}

function scoreBonuses(game: GameState) {
  return game.liveResolution.liveModifiers.filter(
    (modifier) => modifier.kind === 'SCORE' && modifier.abilityId === SUCCESS_ID
  );
}

function millPayload(game: GameState) {
  return game.actionHistory.find(
    (action) => action.payload.abilityId === SUCCESS_ID && action.payload.step === 'MILL_TOP_CARDS'
  )?.payload;
}

describe('PL!N-bp8-030 分数6「Stay」', () => {
  it.each(['PL!N-bp8-030-L', 'PL!N-bp8-030-P', 'PL!N-bp8-030-SEC'])(
    'covers %s with the full two paragraphs and real WR-to-LIVE AUTO',
    (code) => {
      const definitions = getCardAbilityDefinitionsForCardCode(code);
      expect(definitions.find((definition) => definition.abilityId === AUTO_ID)?.effectText).toBe(
        AUTO_TEXT
      );
      expect(
        definitions.find((definition) => definition.abilityId === SUCCESS_ID)?.effectText
      ).toBe(SUCCESS_TEXT);
      const { source, game: initial } = setup({ code, sourceZone: 'WAITING_ROOM' });
      const entered = placeFromWaitingRoom(initial);
      const entry = entered.eventLog.at(-1)!.event;
      expect(entry).toMatchObject({
        eventType: TriggerCondition.ON_ENTER_LIVE_ZONE,
        fromZone: ZoneType.WAITING_ROOM,
        toZone: ZoneType.LIVE_ZONE,
        face: FaceState.FACE_UP,
      });
      let game = enqueueTriggeredCardEffects(entered, [TriggerCondition.ON_ENTER_LIVE_ZONE]);
      expect(game.pendingAbilities).toHaveLength(1);
      game = resolve(game);
      expect(game.activeEffect).toBeNull();
      expect(game.pendingAbilities).toEqual([]);
      expect(requirementReduction(game)).toBe(3);
      const effective = applyHeartRequirementModifiers(
        liveData(code).requirements,
        getLiveCardRequirementModifiers(game.liveResolution, SOURCE_ID)
      );
      expect(effective.colorRequirements.get(HeartColor.RAINBOW)).toBe(3);
      expect(effective.totalRequired).toBe(11);
      expect(effective.colorRequirements.get(HeartColor.PINK)).toBe(3);
      expect(game.liveResolution.playerScores.get(P1)).toBe(6);
      expect(requirementReduction(resolve(game))).toBe(3);
    }
  );

  it.each([
    ['different base', 'PL!N-bp8-031-L', ZoneType.WAITING_ROOM, FaceState.FACE_UP],
    ['hand entry', 'PL!N-bp8-030-L', ZoneType.HAND, FaceState.FACE_UP],
    ['deck entry', 'PL!N-bp8-030-L', ZoneType.MAIN_DECK, FaceState.FACE_UP],
    ['same LIVE zone', 'PL!N-bp8-030-L', ZoneType.LIVE_ZONE, FaceState.FACE_UP],
    ['face down', 'PL!N-bp8-030-L', ZoneType.WAITING_ROOM, FaceState.FACE_DOWN],
  ] as const)('does not enqueue AUTO for %s', (_label, code, fromZone, face) => {
    const { game: initial } = setup({ code });
    let game = updatePlayer(initial, P1, (player) => ({
      ...player,
      liveZone: addCardToStatefulZone(
        removeCardFromStatefulZone(player.liveZone, SOURCE_ID),
        SOURCE_ID,
        { face, orientation: OrientationState.ACTIVE }
      ),
    }));
    const event = createEnterLiveZoneEvent(SOURCE_ID, fromZone, P1, P1, face);
    game = enqueueTriggeredCardEffects(
      emitGameEvent(game, event),
      [TriggerCondition.ON_ENTER_LIVE_ZONE],
      { enterLiveZoneEvents: [event] }
    );
    expect(game.pendingAbilities).toEqual([]);
    expect(requirementReduction(resolve(game))).toBe(0);
  });

  it('does not give an old queued AUTO to a re-entered LIVE object; the new event gets only its own reduction', () => {
    let game = enqueueTriggeredCardEffects(
      placeFromWaitingRoom(setup({ sourceZone: 'WAITING_ROOM' }).game),
      [TriggerCondition.ON_ENTER_LIVE_ZONE]
    );
    const oldPendingId = game.pendingAbilities[0]!.id;
    game = updatePlayer(game, P1, (player) => ({
      ...player,
      liveZone: removeCardFromStatefulZone(player.liveZone, SOURCE_ID),
      waitingRoom: addCardToZone(player.waitingRoom, SOURCE_ID),
    }));
    game = resolve(placeFromWaitingRoom(game));
    expect(
      game.actionHistory.find(
        (action) =>
          action.payload.pendingAbilityId === oldPendingId && action.type === 'RESOLVE_ABILITY'
      )?.payload
    ).toMatchObject({
      rewardApplied: false,
      requirementReduction: 0,
    });
    expect(requirementReduction(game)).toBe(3);
    expect(game.pendingAbilities).toEqual([]);
  });

  it('consumes a queued AUTO without reducing requirements when its source has left LIVE', () => {
    let game = enqueueTriggeredCardEffects(
      placeFromWaitingRoom(setup({ sourceZone: 'WAITING_ROOM' }).game),
      [TriggerCondition.ON_ENTER_LIVE_ZONE]
    );
    game = resolve(returnLiveZoneCardToHandForPlayer(game, P1, SOURCE_ID)!.gameState);
    expect(requirementReduction(game)).toBe(0);
    expect(game.pendingAbilities).toEqual([]);
    expect(game.activeEffect).toBeNull();
    expect(game.actionHistory.at(-1)?.payload).toMatchObject({ rewardApplied: false });
  });

  it('mills the actual top five, waits publicly, then awards this LIVE score once with a grouped causal event', () => {
    const top = [
      member('matching-cost-9'),
      ...Array.from({ length: 4 }, (_, index) => filler(`top-${index}`)),
    ];
    let game = resolve(enqueueSuccess(setup({ topCards: [...top, filler('remaining')] }).game));
    expect(game.activeEffect).toMatchObject({
      abilityId: SUCCESS_ID,
      effectText: SUCCESS_TEXT,
      stepId: PUBLIC_REVEAL_DWELL_STEP_ID,
      revealedCardIds: top.map((card) => card.instanceId),
      sourceLifecycleId: expect.any(String),
    });
    expect(game.activeEffect?.stepText).toContain('展示结束后，此卡的分数＋１。');
    expect(game.liveResolution.playerScores.get(P1)).toBe(6);
    expect(scoreBonuses(game)).toEqual([]);
    for (const viewer of [P1, P2]) {
      expect(projectPlayerViewState(game, viewer).activeEffect?.revealedObjectIds).toEqual(
        top.map((card) => createPublicObjectId(card.instanceId))
      );
    }
    const events = game.eventLog
      .map((entry) => entry.event)
      .filter((event) => event.eventType === TriggerCondition.ON_ENTER_WAITING_ROOM);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      cardInstanceIds: top.map((card) => card.instanceId),
      cause: { kind: 'CARD_EFFECT', playerId: P1, sourceCardId: SOURCE_ID, abilityId: SUCCESS_ID },
    });
    const effectId = game.activeEffect!.id;
    game = finishDwell(game);
    expect(game.players[0].mainDeck.cardIds).toEqual(['remaining']);
    expect(game.players[0].waitingRoom.cardIds).toEqual(top.map((card) => card.instanceId));
    expect(game.liveResolution.playerScores.get(P1)).toBe(7);
    expect(scoreBonuses(game)).toEqual([
      expect.objectContaining({ liveCardId: SOURCE_ID, sourceCardId: SOURCE_ID, countDelta: 1 }),
    ]);
    expect(game.activeEffect).toBeNull();
    expect(confirmActiveEffectStep(game, P1, effectId)).toBe(game);
  });

  it.each([
    ['cost below 9', { cost: 8 }],
    ['another group', { groupNames: ['Aqours'] }],
    [
      'Heart BLADE HEART',
      { bladeHearts: [{ effect: BladeHeartEffect.HEART, heartColor: HeartColor.PINK }] },
    ],
    ['non-Heart BLADE HEART', { bladeHearts: [{ effect: BladeHeartEffect.SCORE }] }],
    ['DRAW BLADE HEART', { bladeHearts: [{ effect: BladeHeartEffect.DRAW }] }],
  ] as const)('does not award for %s or an unrelated old waiting-room match', (_label, changes) => {
    const top = [
      member('negative-candidate', changes),
      ...Array.from({ length: 4 }, (_, index) => filler(`negative-${index}`)),
    ];
    let game = resolve(
      enqueueSuccess(
        setup({
          topCards: [...top, filler('negative-remaining')],
          waitingCards: [member('old-waiting-match')],
        }).game
      )
    );
    expect(millPayload(game)?.conditionMet).toBe(false);
    game = finishDwell(game);
    expect(scoreBonuses(game)).toEqual([]);
    expect(game.liveResolution.playerScores.get(P1)).toBe(6);
  });

  it('counts a matching actual move even when refresh has moved that card out of the waiting room', () => {
    const top = [
      member('refreshed-match', { cost: 10, groupNames: ['虹咲'], bladeHearts: [] }),
      ...Array.from({ length: 4 }, (_, index) => filler(`refresh-${index}`)),
    ];
    let game = resolve(enqueueSuccess(setup({ topCards: top }).game));
    expect(millPayload(game)).toMatchObject({
      milledCardIds: top.map((card) => card.instanceId),
      conditionMet: true,
      refreshCount: 1,
    });
    expect(game.players[0].waitingRoom.cardIds).toEqual([]);
    expect(game.players[0].mainDeck.cardIds).toContain('refreshed-match');
    game = finishDwell(game);
    expect(game.liveResolution.playerScores.get(P1)).toBe(7);
  });

  it('requires a MEMBER even when a moved LIVE has a synthetic cost of 9 and no BLADE HEART', () => {
    const nonMemberData = {
      ...liveData('PL!N-test-non-member', '非成员'),
      cost: 9,
      bladeHearts: [],
    };
    const nonMember = createCardInstance(nonMemberData, P1, 'non-member');
    let game = resolve(
      enqueueSuccess(
        setup({
          topCards: [
            nonMember,
            filler('type-1'),
            filler('type-2'),
            filler('type-3'),
            filler('type-4'),
            filler('type-remain'),
          ],
        }).game
      )
    );
    expect(millPayload(game)?.conditionMet).toBe(false);
    game = finishDwell(game);
    expect(game.liveResolution.playerScores.get(P1)).toBe(6);
  });

  it('handles a one-card pool through repeated refreshes, publicly shows its actual unique set, and awards only +1', () => {
    let game = resolve(enqueueSuccess(setup({ topCards: [member('single-card-match')] }).game));
    expect(millPayload(game)).toMatchObject({
      milledCardIds: Array.from({ length: 5 }, () => 'single-card-match'),
      conditionMet: true,
      refreshCount: 5,
    });
    expect(game.activeEffect?.revealedCardIds).toEqual(['single-card-match']);
    expect(game.players[0].mainDeck.cardIds).toEqual(['single-card-match']);
    expect(game.players[0].waitingRoom.cardIds).toEqual([]);
    game = finishDwell(game);
    expect(game.liveResolution.playerScores.get(P1)).toBe(7);
    expect(scoreBonuses(game)).toEqual([expect.objectContaining({ countDelta: 1 })]);
  });

  it.each([
    'before-start',
    're-enter-before-start',
    'during-display',
    're-enter-during-display',
  ] as const)('still mills but does not award to an invalid source %s', (when) => {
    const top = [
      member('departed-match'),
      ...Array.from({ length: 4 }, (_, index) => filler(`departed-${index}`)),
      filler('departed-remain'),
    ];
    let game = enqueueSuccess(setup({ topCards: top }).game);
    if (when === 'before-start' || when === 're-enter-before-start')
      game = returnLiveZoneCardToHandForPlayer(game, P1, SOURCE_ID)!.gameState;
    if (when === 're-enter-before-start')
      game = placeHandLiveCardInLiveZoneForPlayer(game, P1, SOURCE_ID, {
        candidateCardIds: [SOURCE_ID],
        face: FaceState.FACE_UP,
      })!.gameState;
    game = resolve(game);
    expect(millPayload(game)?.milledCardIds).toHaveLength(5);
    if (when === 'during-display' || when === 're-enter-during-display')
      game = returnLiveZoneCardToHandForPlayer(game, P1, SOURCE_ID)!.gameState;
    if (when === 're-enter-during-display')
      game = placeHandLiveCardInLiveZoneForPlayer(game, P1, SOURCE_ID, {
        candidateCardIds: [SOURCE_ID],
        face: FaceState.FACE_UP,
      })!.gameState;
    game = finishDwell(game);
    expect(game.players[0].waitingRoom.cardIds).toContain('departed-match');
    expect(scoreBonuses(game)).toEqual([]);
    expect(game.liveResolution.playerScores.get(P1)).toBe(6);
    expect(game.activeEffect).toBeNull();
  });

  it('finishes without an empty display, movement event, or reward when both deck and waiting room are empty', () => {
    const game = resolve(enqueueSuccess(setup().game));
    expect(game.activeEffect).toBeNull();
    expect(game.pendingAbilities).toEqual([]);
    expect(scoreBonuses(game)).toEqual([]);
    expect(game.liveResolution.playerScores.get(P1)).toBe(6);
    expect(
      game.eventLog.some(
        (entry) => entry.event.eventType === TriggerCondition.ON_ENTER_WAITING_ROOM
      )
    ).toBe(false);
    expect(game.actionHistory.at(-1)?.payload).toMatchObject({
      milledCardIds: [],
      rewardApplied: false,
      scoreBonus: 0,
    });
  });

  it('retains both an existing pending and the causal Treasure AUTO until Stay finishes its display and score reward', () => {
    const treasureData: LiveCardData = {
      ...liveData('PL!N-bp7-031-L', 'Like a Treasure'),
      score: 5,
    };
    const treasure = createCardInstance(treasureData, P1, 'treasure');
    const milledLive = createCardInstance(
      liveData('PL!N-test-live', '虹咲LIVE'),
      P1,
      'milled-niji-live'
    );
    const existingSource = member('already-pending-member', {
      cardCode: 'PL!S-PR-016-PR',
      groupNames: ['Aqours'],
    });
    let game = setup({
      topCards: [
        member('causal-match'),
        milledLive,
        filler('causal-1'),
        filler('causal-2'),
        filler('causal-3'),
        filler('causal-remain'),
      ],
    }).game;
    game = updatePlayer(registerCards(game, [treasure, existingSource]), P1, (player) => ({
      ...player,
      liveZone: addCardToStatefulZone(player.liveZone, treasure.instanceId, {
        face: FaceState.FACE_UP,
        orientation: OrientationState.ACTIVE,
      }),
      memberSlots: placeCardInSlot(
        player.memberSlots,
        SlotPosition.LEFT,
        existingSource.instanceId
      ),
    }));
    const entry = createEnterStageEvent(
      existingSource.instanceId,
      ZoneType.HAND,
      SlotPosition.LEFT,
      P1,
      P1
    );
    game = enqueueTriggeredCardEffects(
      emitGameEvent(game, entry),
      [TriggerCondition.ON_ENTER_STAGE],
      {
        enterStageEvents: [entry],
      }
    );
    const existingPendingId = game.pendingAbilities[0]!.id;
    expect(game.pendingAbilities).toEqual([
      expect.objectContaining({ abilityId: S_PR_016_ON_ENTER_GAIN_ONE_BLADE_ABILITY_ID }),
    ]);
    game = resolve(enqueueSuccess(game));
    expect(game.activeEffect?.abilityId).toBe(ABILITY_ORDER_SELECTION_ID);
    game = confirmActiveEffectStep(game, P1, game.activeEffect!.id, SOURCE_ID);
    expect(game.activeEffect?.abilityId).toBe(SUCCESS_ID);
    expect(game.pendingAbilities).toEqual([
      expect.objectContaining({ id: existingPendingId, sourceCardId: existingSource.instanceId }),
      expect.objectContaining({
        abilityId: N_BP7_031_AUTO_OWN_LIVE_SUCCESS_MILL_RECOVER_NIJIGASAKI_LIVE_SCORE_ABILITY_ID,
        sourceCardId: treasure.instanceId,
      }),
    ]);
    expect(game.liveResolution.playerScores.get(P1)).toBe(6);
    expect(getMemberEffectiveBladeCount(game, P1, existingSource.instanceId)).toBe(1);
    game = finishDwell(game);
    expect(game.liveResolution.playerScores.get(P1)).toBe(7);
    expect(game.activeEffect?.abilityId).toBe(ABILITY_ORDER_SELECTION_ID);
    expect(game.pendingAbilities).toHaveLength(2);
    game = confirmActiveEffectStep(game, P1, game.activeEffect!.id, existingSource.instanceId);
    expect(getMemberEffectiveBladeCount(game, P1, existingSource.instanceId)).toBe(2);
    expect(game.activeEffect).toMatchObject({
      abilityId: N_BP7_031_AUTO_OWN_LIVE_SUCCESS_MILL_RECOVER_NIJIGASAKI_LIVE_SCORE_ABILITY_ID,
      selectableCardIds: [milledLive.instanceId],
    });
    expect(
      game.actionHistory.filter(
        (action) =>
          action.type === 'RESOLVE_ABILITY' && action.payload.pendingAbilityId === existingPendingId
      )
    ).toHaveLength(1);
    game = confirmActiveEffectStep(game, P1, game.activeEffect!.id, null);
    expect(game.activeEffect).toBeNull();
    expect(game.pendingAbilities).toEqual([]);
    expect(game.actionHistory.at(-1)?.payload).toMatchObject({
      abilityId: N_BP7_031_AUTO_OWN_LIVE_SUCCESS_MILL_RECOVER_NIJIGASAKI_LIVE_SCORE_ABILITY_ID,
      step: 'DECLINE_RECOVERY',
    });
  });
});
