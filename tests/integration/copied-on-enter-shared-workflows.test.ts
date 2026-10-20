import {
  getMemberEffectiveBladeCount,
  getMemberEffectiveHeartIcons,
} from '../../src/domain/rules/live-modifiers';
import { getCardById } from '../../src/domain/entities/game';
import {
  SHARED_COPY_SOURCE_CASES,
  SHARED_COPY_SOURCE_VARIANT_CASES,
} from '../helpers/copied-on-enter-shared-workflow-cases';
import { describe, expect, it } from 'vitest';
import * as IDs from '../../src/application/card-effects/ability-ids';
import { resolvePendingCardEffects } from '../../src/application/card-effect-runner';
import { queryActiveEffectSelection } from '../../src/application/card-effects/runtime/step-registry';
import {
  createCardInstance,
  createHeartRequirement,
  type MemberCardData,
} from '../../src/domain/entities/card';
import {
  createGameState,
  emitGameEvent,
  registerCards,
  updatePlayer,
  type GameState,
  type PendingAbilityState,
} from '../../src/domain/entities/game';
import { createEnterStageEvent } from '../../src/domain/events/game-events';
import { addCardToStatefulZone, placeCardInSlot } from '../../src/domain/entities/zone';
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
import { sourceCardFixture } from '../helpers/card-effect-zone-fixture';
import { confirmActiveEffectStepThroughPublicReveal } from '../helpers/public-card-selection-confirmation';

const P1 = 'p1',
  P2 = 'p2';
const CASES = [...SHARED_COPY_SOURCE_CASES, ...SHARED_COPY_SOURCE_VARIANT_CASES];
type Case = (typeof CASES)[number];
function setup(
  entry: Case,
  mode: 'NATIVE' | 'HOST' | 'FREE',
  options: {
    handCount?: number;
    fromZone?: ZoneType;
    sourceWaiting?: boolean;
    deckLive?: boolean;
  } = {}
): GameState {
  const data = sourceCardFixture(
    mode === 'NATIVE' ? entry.code : 'PL!HS-bp8-004-SEC'
  ) as MemberCardData;
  expect(data.cost).toBeGreaterThan(0);
  const source = createCardInstance(data, P1, 'actor');
  // All other objects are explicitly synthetic, to control selector boundaries without guessing source export fields.
  const member = (id: string, cost = 13, owner = P1) =>
    createCardInstance(
      {
        cardCode: `SYNTHETIC-${id}`,
        name: `合成${id}`,
        cardType: CardType.MEMBER,
        cost,
        blade: 1,
        hearts: [
          HeartColor.PINK,
          HeartColor.RED,
          HeartColor.YELLOW,
          HeartColor.GREEN,
          HeartColor.BLUE,
          HeartColor.PURPLE,
        ].map((color) => ({ color, count: 1 })),
        groupNames: ['蓮ノ空'],
        unitName: 'スリーズブーケ',
      },
      owner,
      id
    );
  const live = (id: string) =>
    createCardInstance(
      {
        cardCode: `SYNTHETIC-${id}`,
        name: `合成${id}`,
        cardType: CardType.LIVE,
        score: 3,
        requirements: createHeartRequirement({ [HeartColor.GREEN]: 1 }),
        groupNames: ['蓮ノ空'],
      },
      P1,
      id
    );
  const hand = Array.from({ length: options.handCount ?? 3 }, (_, i) => member(`hand-${i}`));
  const waiting = Array.from({ length: 10 }, (_, i) =>
    i < 5 ? member(`waiting-${i}`, 2) : live(`waiting-${i}`)
  );
  const deck = Array.from({ length: 20 }, (_, i) =>
    options.deckLive !== false &&
    (entry.abilityId === IDs.HS_BP5_001_ON_ENTER_MILL_GAIN_BLADE_ABILITY_ID ||
      entry.abilityId === IDs.BP3_010_ON_ENTER_LOOK_LIVE_EFFECT_ID) &&
    i === 0
      ? live(`deck-${i}`)
      : member(`deck-${i}`)
  );
  const energies = Array.from({ length: 4 }, (_, i) =>
    createCardInstance(
      { cardCode: `SYNTHETIC-ENERGY-${i}`, name: '合成能量', cardType: CardType.ENERGY },
      P1,
      `energy-${i}`
    )
  );
  const others = [member('other-left'), member('other-right'), member('opponent', 2, P2)];
  let game = registerCards(createGameState('copied-on-enter-shared', P1, 'P1', P2, 'P2'), [
    source,
    ...hand,
    ...waiting,
    ...deck,
    ...energies,
    ...others,
  ]);
  game = updatePlayer(game, P1, (p) => ({
    ...p,
    memberSlots: placeCardInSlot(
      placeCardInSlot(
        placeCardInSlot(p.memberSlots, SlotPosition.CENTER, 'actor', {
          orientation: options.sourceWaiting ? OrientationState.WAITING : OrientationState.ACTIVE,
          face: FaceState.FACE_UP,
        }),
        SlotPosition.LEFT,
        'other-left'
      ),
      SlotPosition.RIGHT,
      'other-right'
    ),
    hand: { ...p.hand, cardIds: hand.map(({ instanceId }) => instanceId) },
    waitingRoom: {
      ...p.waitingRoom,
      cardIds:
        entry.abilityId ===
        IDs.PR_FILL_WAITING_ROOM_TO_EIGHT_OPTIONAL_MILLED_LIVE_TO_DECK_TOP_ABILITY_ID
          ? []
          : waiting.map(({ instanceId }) => instanceId),
    },
    mainDeck: { ...p.mainDeck, cardIds: deck.map(({ instanceId }) => instanceId) },
    energyZone: energies.reduce(
      (zone, card) =>
        addCardToStatefulZone(zone, card.instanceId, {
          orientation: OrientationState.WAITING,
          face: FaceState.FACE_UP,
        }),
      p.energyZone
    ),
  }));
  game = updatePlayer(game, P2, (p) => ({
    ...p,
    memberSlots: placeCardInSlot(p.memberSlots, SlotPosition.CENTER, 'opponent'),
  }));
  const pending: PendingAbilityState = {
    id: 'copy-child',
    abilityId: entry.abilityId,
    sourceCardId: 'actor',
    controllerId: P1,
    mandatory: true,
    timingId: TriggerCondition.ON_ENTER_STAGE,
    eventIds: [],
    sourceSlot: SlotPosition.CENTER,
    metadata: { fromZone: options.fromZone ?? ZoneType.WAITING_ROOM },
    ...(mode === 'NATIVE'
      ? {}
      : {
          onEnterInvocation: {
            definitionSourceCardCode: entry.code,
            waiveActivationCosts: mode === 'FREE',
            grantId: 'synthetic-grant',
          },
        }),
  };
  return { ...game, currentPhase: GamePhase.MAIN_PHASE, pendingAbilities: [pending] };
}
function step(game: GameState): GameState {
  const e = game.activeEffect!;
  const selection = queryActiveEffectSelection(game);
  let selectedIds: readonly string[] | undefined;
  let selectedId: string | undefined;
  let selectedOption: string | undefined;
  if (selection?.kind === 'CARDS') {
    if (selection.mode === 'SINGLE') selectedId = selection.cardIds[0];
    else if (selection.groups) {
      const ids = new Set<string>();
      for (const group of selection.groups) {
        const count = group.min || Math.min(1, group.max);
        for (const id of group.cardIds.filter((id) => !ids.has(id)).slice(0, count)) ids.add(id);
      }
      selectedIds = [...ids].slice(0, selection.max);
    } else
      selectedIds = selection.cardIds.slice(0, Math.max(selection.min, Math.min(1, selection.max)));
  } else if (selection?.kind === 'OPTIONS') selectedOption = selection.options[0]?.id;
  else if (e.selectableOptions?.length) selectedOption = e.selectableOptions[0].id;
  else if (e.effectChoice?.options.length) selectedOption = e.effectChoice.options[0].id;
  else if (e.selectableCardIds?.length) {
    if (e.selectableCardMode === 'ORDERED_MULTI')
      selectedIds = e.selectableCardIds.slice(0, Math.max(e.minSelectableCards ?? 1, 1));
    else selectedId = e.selectableCardIds[0];
  }
  return confirmActiveEffectStepThroughPublicReveal(
    game,
    e.awaitingPlayerId ?? P1,
    e.id,
    selectedId,
    undefined,
    undefined,
    selectedOption,
    selectedIds
  );
}
function settle(game: GameState): GameState {
  let state = resolvePendingCardEffects(game).gameState;
  for (let i = 0; i < 30 && state.activeEffect; i++) {
    const next = step(state);
    if (next === state)
      throw new Error(`Unresolved ${state.activeEffect?.abilityId} ${state.activeEffect?.stepId}`);
    state = next;
  }
  expect(state.activeEffect).toBeNull();
  expect(state.pendingAbilities).toEqual([]);
  return state;
}
function outcome(game: GameState, abilityId: string) {
  return {
    hand: game.players[0].hand.cardIds,
    waiting: game.players[0].waitingRoom.cardIds,
    deck: game.players[0].mainDeck.cardIds,
    actorOrientation: game.players[0].memberSlots.cardStates.get('actor')?.orientation,
    opponentOrientation: game.players[1].memberSlots.cardStates.get('opponent')?.orientation,
    energy: game.players[0].energyZone.cardIds.map(
      (id) => game.players[0].energyZone.cardStates.get(id)?.orientation
    ),
    modifiers: game.liveResolution.liveModifiers.filter(
      (modifier) => modifier.abilityId === abilityId
    ),
  };
}

// [hand count, deck count, waiting-room count] after the concrete positive path.
const RESOURCE_RESULTS: Readonly<
  Record<string, { normal: readonly number[]; free?: readonly number[] }>
> = {
  [IDs.GENERIC_DISCARD_LOOK_TOP_ABILITY_ID]: { normal: [3, 17, 13], free: [4, 17, 12] },
  [IDs.BP3_010_ON_ENTER_LOOK_LIVE_EFFECT_ID]: { normal: [3, 15, 15], free: [4, 15, 14] },
  [IDs.HS_PR_019_ON_ENTER_MILL_GAIN_GREEN_HEART_ABILITY_ID]: { normal: [3, 17, 13] },
  [IDs.HS_PR_021_ON_ENTER_MILL_GAIN_PINK_HEART_ABILITY_ID]: { normal: [3, 17, 13] },
  [IDs.HS_SD1_013_ON_ENTER_MILL_GAIN_BLUE_HEART_ABILITY_ID]: { normal: [3, 17, 13] },
  [IDs.HS_BP5_001_ON_ENTER_MILL_GAIN_BLADE_ABILITY_ID]: { normal: [3, 16, 14] },
  [IDs.HS_PR_031_ON_ENTER_DISCARD_TWO_DRAW_TO_FIVE_ABILITY_ID]: {
    normal: [5, 16, 12],
    free: [5, 18, 10],
  },
  [IDs.PR_FILL_WAITING_ROOM_TO_EIGHT_OPTIONAL_MILLED_LIVE_TO_DECK_TOP_ABILITY_ID]: {
    normal: [3, 12, 8],
  },
  [IDs.HS_PR_038_ON_ENTER_NON_HAND_GAIN_PURPLE_HEART_ABILITY_ID]: { normal: [3, 20, 10] },
  [IDs.MEMBER_ON_ENTER_ACTIVATE_TWO_WAITING_ENERGY_ABILITY_ID]: { normal: [3, 20, 10] },
  [IDs.HS_BP1_005_ON_ENTER_DISCARD_UP_TO_THREE_DRAW_SAME_COUNT_ABILITY_ID]: {
    normal: [3, 19, 11],
    free: [3, 20, 10],
  },
  [IDs.HS_BP1_006_ON_ENTER_DRAW_DISCARD_ABILITY_ID]: { normal: [4, 18, 11] },
  [IDs.HS_BP1_006_ON_ENTER_DRAW_ONE_DISCARD_ONE_ABILITY_ID]: { normal: [3, 19, 11] },
  [IDs.HS_SD1_008_ON_ENTER_DRAW_TWO_DISCARD_ONE_ABILITY_ID]: { normal: [4, 18, 11] },
  [IDs.HS_BP2_002_ON_ENTER_RECOVER_LOW_COST_MEMBER_ABILITY_ID]: { normal: [4, 20, 9] },
  [IDs.HS_BP2_011_ON_ENTER_MILL_TOP_FIVE_ABILITY_ID]: { normal: [3, 15, 15] },
  [IDs.HS_PB1_024_ON_ENTER_LOOK_TOP_TWO_ARRANGE_ABILITY_ID]: { normal: [3, 19, 11] },
  [IDs.HS_BP2_017_ON_ENTER_WAITING_ROOM_TEN_DRAW_ONE_ABILITY_ID]: { normal: [4, 19, 10] },
  [IDs.HS_BP5_008_ON_ENTER_WAIT_DISCARD_LOOK_TOP_ABILITY_ID]: {
    normal: [3, 15, 15],
    free: [4, 15, 14],
  },
  [IDs.MEMBER_ON_ENTER_DRAW_ONE_ABILITY_ID]: { normal: [4, 19, 10] },
  [IDs.HS_BP6_001_ON_ENTER_LOOK_STAGE_PLUS_TWO_ABILITY_ID]: { normal: [3, 16, 14] },
  [IDs.HS_BP6_004_ON_ENTER_WAIT_OPPONENT_LOW_COST_MEMBER_ABILITY_ID]: { normal: [3, 20, 10] },
  [IDs.HS_BP6_012_ON_ENTER_OTHER_CERISE_BOUQUET_ACTIVATE_ENERGY_ABILITY_ID]: {
    normal: [3, 20, 10],
  },
  [IDs.HS_CL1_006_ON_ENTER_GAIN_THREE_BLADE_ABILITY_ID]: { normal: [3, 20, 10] },
  [IDs.HS_PB1_010_ON_ENTER_WAIT_OPPONENT_LOW_COST_MEMBER_ABILITY_ID]: { normal: [3, 20, 10] },
  [IDs.HS_PB1_020_ON_ENTER_DISCARD_TWO_RECOVER_CERISE_MEMBER_AND_HASUNOSORA_LIVE_ABILITY_ID]: {
    normal: [3, 20, 10],
  },
  [IDs.HS_SD1_014_ON_ENTER_DISCARD_RECOVER_HASUNOSORA_CARD_ABILITY_ID]: {
    normal: [3, 20, 10],
    free: [4, 20, 9],
  },
};
function assertConcreteResult(game: GameState, entry: Case, free: boolean) {
  const expected = RESOURCE_RESULTS[entry.abilityId];
  let resources = free ? (expected.free ?? expected.normal) : expected.normal;
  if (entry.code === 'PL!HS-bp2-010-N') resources = free ? [4, 15, 14] : [3, 15, 15];
  expect([
    game.players[0].hand.cardIds.length,
    game.players[0].mainDeck.cardIds.length,
    game.players[0].waitingRoom.cardIds.length,
  ]).toEqual(resources);
  const modifier = game.liveResolution.liveModifiers.find(
    (modifier) => modifier.abilityId === entry.abilityId
  );
  const heartColors: Readonly<Record<string, HeartColor>> = {
    [IDs.HS_PR_019_ON_ENTER_MILL_GAIN_GREEN_HEART_ABILITY_ID]: HeartColor.GREEN,
    [IDs.HS_PR_021_ON_ENTER_MILL_GAIN_PINK_HEART_ABILITY_ID]: HeartColor.PINK,
    [IDs.HS_SD1_013_ON_ENTER_MILL_GAIN_BLUE_HEART_ABILITY_ID]: HeartColor.BLUE,
    [IDs.HS_PR_038_ON_ENTER_NON_HAND_GAIN_PURPLE_HEART_ABILITY_ID]: HeartColor.PURPLE,
  };
  if (heartColors[entry.abilityId])
    expect(modifier).toMatchObject({
      kind: 'HEART',
      sourceCardId: 'actor',
      target: 'SOURCE_MEMBER',
      hearts: [{ color: heartColors[entry.abilityId], count: 1 }],
    });
  if (
    [
      IDs.HS_CL1_006_ON_ENTER_GAIN_THREE_BLADE_ABILITY_ID,
      IDs.HS_BP5_001_ON_ENTER_MILL_GAIN_BLADE_ABILITY_ID,
    ].includes(entry.abilityId)
  )
    expect(modifier).toMatchObject({
      kind: 'BLADE',
      sourceCardId: 'actor',
      countDelta: entry.abilityId === IDs.HS_CL1_006_ON_ENTER_GAIN_THREE_BLADE_ABILITY_ID ? 3 : 2,
    });
  const sourceData = getCardById(game, 'actor')!.data as MemberCardData;
  if (heartColors[entry.abilityId]) {
    const color = heartColors[entry.abilityId];
    const printed = sourceData.hearts
      .filter((heart) => heart.color === color)
      .reduce((sum, heart) => sum + heart.count, 0);
    const actual = getMemberEffectiveHeartIcons(game, P1, 'actor')
      .filter((heart) => heart.color === color)
      .reduce((sum, heart) => sum + heart.count, 0);
    expect(actual).toBe(printed + 1);
  }
  if (
    [
      IDs.HS_CL1_006_ON_ENTER_GAIN_THREE_BLADE_ABILITY_ID,
      IDs.HS_BP5_001_ON_ENTER_MILL_GAIN_BLADE_ABILITY_ID,
    ].includes(entry.abilityId)
  ) {
    expect(getMemberEffectiveBladeCount(game, P1, 'actor')).toBe(
      sourceData.blade +
        (entry.abilityId === IDs.HS_CL1_006_ON_ENTER_GAIN_THREE_BLADE_ABILITY_ID ? 3 : 2)
    );
  }
  if (
    [
      IDs.HS_BP6_004_ON_ENTER_WAIT_OPPONENT_LOW_COST_MEMBER_ABILITY_ID,
      IDs.HS_PB1_010_ON_ENTER_WAIT_OPPONENT_LOW_COST_MEMBER_ABILITY_ID,
    ].includes(entry.abilityId)
  )
    expect(game.players[1].memberSlots.cardStates.get('opponent')?.orientation).toBe(
      OrientationState.WAITING
    );
  if (
    [
      IDs.MEMBER_ON_ENTER_ACTIVATE_TWO_WAITING_ENERGY_ABILITY_ID,
      IDs.HS_BP6_012_ON_ENTER_OTHER_CERISE_BOUQUET_ACTIVATE_ENERGY_ABILITY_ID,
    ].includes(entry.abilityId)
  )
    expect(
      game.players[0].energyZone.cardIds.filter(
        (id) =>
          game.players[0].energyZone.cardStates.get(id)?.orientation === OrientationState.ACTIVE
      )
    ).toHaveLength(
      entry.abilityId === IDs.MEMBER_ON_ENTER_ACTIVATE_TWO_WAITING_ENERGY_ABILITY_ID ? 2 : 1
    );
}

describe('shared ON_ENTER native/template identity and real host source', () => {
  it.each(CASES)(
    '$code $abilityId resolves identically on a native source and a granted host paying normal costs',
    (entry) => {
      const native = settle(setup(entry, 'NATIVE'));
      const host = settle(setup(entry, 'HOST'));
      assertConcreteResult(native, entry, false);
      assertConcreteResult(host, entry, false);
      expect(outcome(host, entry.abilityId)).toEqual(outcome(native, entry.abilityId));
      const resolves = host.actionHistory.filter(
        (action) =>
          action.type === 'RESOLVE_ABILITY' && action.payload.abilityId === entry.abilityId
      );
      expect(resolves.length).toBeGreaterThan(0);
      expect(resolves.every((action) => action.payload.sourceCardId === 'actor')).toBe(true);
    }
  );
  it.each(CASES)(
    '$code $abilityId supports the initial waived-cost invocation without inventing paid actions',
    (entry) => {
      const done = settle(setup(entry, 'FREE'));
      assertConcreteResult(done, entry, true);
      expect(
        done.actionHistory.filter(
          (action) => action.type === 'PAY_COST' && action.payload.abilityId === entry.abilityId
        )
      ).toEqual([]);
      const moves = done.eventLog.filter(
        ({ event }) => event.eventType === TriggerCondition.ON_ENTER_WAITING_ROOM
      );
      const costMoves = moves.filter(
        ({ event }) =>
          event.eventType === TriggerCondition.ON_ENTER_WAITING_ROOM &&
          event.fromZone === ZoneType.HAND
      );
      const drawDiscardEffects = [
        IDs.HS_PB1_020_ON_ENTER_DISCARD_TWO_RECOVER_CERISE_MEMBER_AND_HASUNOSORA_LIVE_ABILITY_ID,
        IDs.HS_BP1_006_ON_ENTER_DRAW_DISCARD_ABILITY_ID,
        IDs.HS_BP1_006_ON_ENTER_DRAW_ONE_DISCARD_ONE_ABILITY_ID,
        IDs.HS_SD1_008_ON_ENTER_DRAW_TWO_DISCARD_ONE_ABILITY_ID,
      ];
      if (!drawDiscardEffects.includes(entry.abilityId)) expect(costMoves).toEqual([]);
      else expect(costMoves).toHaveLength(1);
    }
  );
  it('waiving discard-to-draw uses the actual zero discarded count, while draw-to-five still draws to five', () => {
    const sameCount = CASES.find(
      ({ abilityId }) =>
        abilityId === IDs.HS_BP1_005_ON_ENTER_DISCARD_UP_TO_THREE_DRAW_SAME_COUNT_ABILITY_ID
    )!;
    const zero = settle(setup(sameCount, 'FREE', { handCount: 0 }));
    expect(zero.players[0].hand.cardIds).toEqual([]);
    expect(zero.players[0].mainDeck.cardIds).toHaveLength(20);
    const toFive = CASES.find(
      ({ abilityId }) => abilityId === IDs.HS_PR_031_ON_ENTER_DISCARD_TWO_DRAW_TO_FIVE_ABILITY_ID
    )!;
    const five = settle(setup(toFive, 'FREE', { handCount: 0 }));
    expect(five.players[0].hand.cardIds).toHaveLength(5);
    expect(five.players[0].mainDeck.cardIds).toHaveLength(15);
  });
  it('waiving waiting-self and discard needs no ACTIVE source or hand, but normal later invocation pays both', () => {
    const entry = CASES.find(
      ({ abilityId }) => abilityId === IDs.HS_BP5_008_ON_ENTER_WAIT_DISCARD_LOOK_TOP_ABILITY_ID
    )!;
    const free = settle(setup(entry, 'FREE', { handCount: 0, sourceWaiting: true }));
    expect(free.players[0].mainDeck.cardIds).toHaveLength(15);
    expect(free.players[0].hand.cardIds).toHaveLength(1);
    const paid = settle(setup(entry, 'HOST'));
    expect(paid.players[0].memberSlots.cardStates.get('actor')?.orientation).toBe(
      OrientationState.WAITING
    );
    expect(
      paid.eventLog.filter(
        ({ event }) => event.eventType === TriggerCondition.ON_MEMBER_STATE_CHANGED
      )
    ).toHaveLength(1);
  });
  it('a normally paid copied waiting-self cost cannot tap a host that left and re-entered during hand selection', () => {
    const entry = CASES.find(
      ({ abilityId }) => abilityId === IDs.HS_BP5_008_ON_ENTER_WAIT_DISCARD_LOOK_TOP_ABILITY_ID
    )!;
    const window = resolvePendingCardEffects(setup(entry, 'HOST')).gameState;
    expect(window.activeEffect?.sourceLifecycleId).toBeDefined();
    const reentered = emitGameEvent(
      window,
      createEnterStageEvent('actor', ZoneType.WAITING_ROOM, SlotPosition.CENTER, P1, P1)
    );
    const done = step(reentered);
    expect(done.activeEffect).toBeNull();
    expect(done.players[0].memberSlots.cardStates.get('actor')?.orientation).toBe(
      OrientationState.ACTIVE
    );
    expect(done.players[0].hand.cardIds).toEqual(['hand-0', 'hand-1', 'hand-2']);
    expect(done.players[0].mainDeck.cardIds).toHaveLength(20);
    expect(done.eventLog.map(({ event }) => event.eventType)).toEqual([
      TriggerCondition.ON_ENTER_STAGE,
    ]);
    expect(done.actionHistory.some((action) => action.type === 'PAY_COST')).toBe(false);
  });
  it('a waived waiting-self cost still inspects and recovers when its original host is absent', () => {
    const entry = CASES.find(
      ({ abilityId }) => abilityId === IDs.HS_BP5_008_ON_ENTER_WAIT_DISCARD_LOOK_TOP_ABILITY_ID
    )!;
    const absent = updatePlayer(setup(entry, 'FREE', { handCount: 0 }), P1, (player) => ({
      ...player,
      memberSlots: {
        ...player.memberSlots,
        slots: { ...player.memberSlots.slots, [SlotPosition.CENTER]: null },
      },
    }));
    const done = settle(absent);
    expect(done.players[0].hand.cardIds).toEqual(['deck-0']);
    expect(done.players[0].mainDeck.cardIds).toHaveLength(15);
    expect(done.players[0].waitingRoom.cardIds).toContain('deck-1');
    expect(done.actionHistory.some((action) => action.type === 'PAY_COST')).toBe(false);
    expect(
      done.eventLog.some(
        ({ event }) => event.eventType === TriggerCondition.ON_MEMBER_STATE_CHANGED
      )
    ).toBe(false);
  });
  it('waived unit recovery works with no hand and keeps its independent prerequisite', () => {
    for (const ability of [IDs.HS_SD1_014_ON_ENTER_DISCARD_RECOVER_HASUNOSORA_CARD_ABILITY_ID]) {
      const entry = CASES.find(({ abilityId }) => abilityId === ability)!;
      const done = settle(setup(entry, 'FREE', { handCount: 0 }));
      expect(done.players[0].hand.cardIds.length).toBeGreaterThan(0);
      expect(
        done.eventLog.filter(
          ({ event }) => event.eventType === TriggerCondition.ON_ENTER_WAITING_ROOM
        )
      ).toEqual([]);
    }
  });
  it('HS-pb1-020 keeps its optional discard-two effect when copied and never labels it as a paid cost', () => {
    const entry = CASES.find(
      ({ abilityId }) =>
        abilityId ===
        IDs.HS_PB1_020_ON_ENTER_DISCARD_TWO_RECOVER_CERISE_MEMBER_AND_HASUNOSORA_LIVE_ABILITY_ID
    )!;
    const window = resolvePendingCardEffects(setup(entry, 'FREE')).gameState;
    expect(window.activeEffect).toMatchObject({
      minSelectableCards: 2,
      maxSelectableCards: 2,
      canSkipSelection: true,
    });
    expect(window.activeEffect?.metadata?.effectCosts).toBeUndefined();
    const skipped = confirmActiveEffectStepThroughPublicReveal(window, P1, window.activeEffect!.id);
    expect(skipped.players[0].hand.cardIds).toEqual(['hand-0', 'hand-1', 'hand-2']);
    expect(
      skipped.eventLog.filter(
        ({ event }) => event.eventType === TriggerCondition.ON_ENTER_WAITING_ROOM
      )
    ).toEqual([]);
    const done = settle(setup(entry, 'FREE'));
    expect(
      done.eventLog.filter(
        ({ event }) => event.eventType === TriggerCondition.ON_ENTER_WAITING_ROOM
      )
    ).toMatchObject([
      { event: { fromZone: ZoneType.HAND, cardInstanceIds: ['hand-0', 'hand-1'] } },
    ]);
    expect(
      done.actionHistory.some(
        (action) => action.type === 'PAY_COST' && action.payload.abilityId === entry.abilityId
      )
    ).toBe(false);
    const noHand = settle(setup(entry, 'FREE', { handCount: 0 }));
    expect(noHand.players[0].hand.cardIds).toEqual([]);
  });
  it('conditional mills still move their full batch when reward conditions fail on the host', () => {
    const livePresence = CASES.find(
      ({ abilityId }) => abilityId === IDs.HS_BP5_001_ON_ENTER_MILL_GAIN_BLADE_ABILITY_ID
    )!;
    const noLive = settle(setup(livePresence, 'FREE', { deckLive: false }));
    expect(noLive.players[0].mainDeck.cardIds).toHaveLength(16);
    expect(noLive.liveResolution.liveModifiers).toEqual([]);
    for (const ability of [
      IDs.HS_PR_019_ON_ENTER_MILL_GAIN_GREEN_HEART_ABILITY_ID,
      IDs.HS_PR_021_ON_ENTER_MILL_GAIN_PINK_HEART_ABILITY_ID,
      IDs.HS_SD1_013_ON_ENTER_MILL_GAIN_BLUE_HEART_ABILITY_ID,
    ]) {
      const entry = CASES.find(({ abilityId }) => abilityId === ability)!;
      let game = setup(entry, 'FREE');
      const miss = createCardInstance(
        {
          cardCode: 'SYNTHETIC-COLOR-MISS',
          name: '合成无指定色成员',
          cardType: CardType.MEMBER,
          cost: 3,
          blade: 0,
          hearts: [],
        },
        P1,
        'color-miss'
      );
      game = registerCards(game, [miss]);
      game = updatePlayer(game, P1, (p) => ({
        ...p,
        mainDeck: { ...p.mainDeck, cardIds: ['color-miss', ...p.mainDeck.cardIds.slice(1)] },
      }));
      const done = settle(game);
      expect(done.players[0].mainDeck.cardIds).toHaveLength(17);
      expect(done.liveResolution.liveModifiers).toEqual([]);
    }
  });
  it.each([
    IDs.HS_PR_019_ON_ENTER_MILL_GAIN_GREEN_HEART_ABILITY_ID,
    IDs.HS_PR_021_ON_ENTER_MILL_GAIN_PINK_HEART_ABILITY_ID,
    IDs.HS_SD1_013_ON_ENTER_MILL_GAIN_BLUE_HEART_ABILITY_ID,
    IDs.HS_BP5_001_ON_ENTER_MILL_GAIN_BLADE_ABILITY_ID,
  ])(
    '%s keeps its milled cards but cannot reward a host re-entered during public confirmation',
    (abilityId) => {
      const entry = CASES.find((entry) => entry.abilityId === abilityId)!;
      const window = resolvePendingCardEffects(setup(entry, 'FREE')).gameState;
      const millCount = abilityId === IDs.HS_BP5_001_ON_ENTER_MILL_GAIN_BLADE_ABILITY_ID ? 4 : 3;
      expect(window.players[0].mainDeck.cardIds).toHaveLength(20 - millCount);
      expect(window.activeEffect?.sourceLifecycleId).toBeDefined();
      const reentered = emitGameEvent(
        window,
        createEnterStageEvent('actor', ZoneType.WAITING_ROOM, SlotPosition.CENTER, P1, P1)
      );
      const done = settle(reentered);
      expect(done.players[0].mainDeck.cardIds).toHaveLength(20 - millCount);
      expect(done.players[0].waitingRoom.cardIds).toEqual(window.players[0].waitingRoom.cardIds);
      expect(
        done.liveResolution.liveModifiers.filter((modifier) => modifier.abilityId === abilityId)
      ).toEqual([]);
      expect(done.actionHistory.some((action) => action.type === 'PAY_COST')).toBe(false);
    }
  );
  it('independent waiting-room and other-member conditions are not waived by copied activation', () => {
    const draw = CASES.find(
      ({ abilityId }) => abilityId === IDs.HS_BP2_017_ON_ENTER_WAITING_ROOM_TEN_DRAW_ONE_ABILITY_ID
    )!;
    let fewer = setup(draw, 'FREE');
    fewer = updatePlayer(fewer, P1, (p) => ({
      ...p,
      waitingRoom: { ...p.waitingRoom, cardIds: p.waitingRoom.cardIds.slice(0, 9) },
    }));
    expect(settle(fewer).players[0].hand.cardIds).toHaveLength(3);
    const energy = CASES.find(
      ({ abilityId }) =>
        abilityId === IDs.HS_BP6_012_ON_ENTER_OTHER_CERISE_BOUQUET_ACTIVATE_ENERGY_ABILITY_ID
    )!;
    let alone = setup(energy, 'FREE');
    alone = updatePlayer(alone, P1, (p) => ({
      ...p,
      memberSlots: {
        ...p.memberSlots,
        slots: { ...p.memberSlots.slots, [SlotPosition.LEFT]: null, [SlotPosition.RIGHT]: null },
      },
    }));
    const unchanged = settle(alone);
    expect(
      unchanged.players[0].energyZone.cardIds.every(
        (id) =>
          unchanged.players[0].energyZone.cardStates.get(id)?.orientation ===
          OrientationState.WAITING
      )
    ).toBe(true);
    const grouped = CASES.find(
      ({ abilityId }) =>
        abilityId ===
        IDs.HS_PB1_020_ON_ENTER_DISCARD_TWO_RECOVER_CERISE_MEMBER_AND_HASUNOSORA_LIVE_ABILITY_ID
    )!;
    let noThree = setup(grouped, 'FREE');
    noThree = updatePlayer(noThree, P1, (p) => ({
      ...p,
      waitingRoom: { ...p.waitingRoom, cardIds: p.waitingRoom.cardIds.slice(0, 7) },
    }));
    const skipped = settle(noThree);
    expect(skipped.players[0].hand.cardIds).toEqual(['hand-0', 'hand-1', 'hand-2']);
    expect(skipped.eventLog).toEqual([]);
  });
  it('the copied non-HAND entry condition belongs to the host entry, even with costs waived', () => {
    const entry = CASES.find(
      ({ abilityId }) => abilityId === IDs.HS_PR_038_ON_ENTER_NON_HAND_GAIN_PURPLE_HEART_ABILITY_ID
    )!;
    expect(
      settle(setup(entry, 'FREE', { fromZone: ZoneType.HAND })).liveResolution.liveModifiers
    ).toEqual([]);
    const nonHand = settle(setup(entry, 'FREE', { fromZone: ZoneType.WAITING_ROOM }));
    expect(nonHand.liveResolution.liveModifiers).toContainEqual(
      expect.objectContaining({
        sourceCardId: 'actor',
        hearts: [{ color: HeartColor.PURPLE, count: 1 }],
      })
    );
  });
});
