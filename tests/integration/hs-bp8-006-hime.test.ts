import { describe, expect, it } from 'vitest';
import {
  createCardInstance,
  createHeartIcon,
  createHeartRequirement,
  type AnyCardData,
  type MemberCardData,
} from '../../src/domain/entities/card';
import {
  createGameState,
  emitGameEvent,
  registerCards,
  updatePlayer,
  type GameState,
} from '../../src/domain/entities/game';
import { placeCardInSlot, removeCardFromSlot } from '../../src/domain/entities/zone';
import { createEnterStageEvent } from '../../src/domain/events/game-events';
import {
  getMemberEffectiveHeartIcons,
  getPlayerLiveHeartModifiers,
} from '../../src/domain/rules/live-modifiers';
import {
  createAutoAdvancePublicEffectChoiceCommand,
  createConfirmEffectChoiceCommand,
  createConfirmEffectStepCommand,
  createPlayMemberToSlotCommand,
} from '../../src/application/game-commands';
import { createGameSession } from '../../src/application/game-session';
import {
  HS_BP8_006_ON_ENTER_DISCARD_HASUNOSORA_CHOOSE_HEART_OR_ARRANGE_ABILITY_ID,
  HS_PB1_003_AUTO_HAND_TO_WAITING_GAIN_HEART_BLADE_ABILITY_ID,
} from '../../src/application/card-effects/ability-ids';
import { findCardAbilityDefinitionById } from '../../src/application/card-effects/definitions/lookup';
import { PUBLIC_EFFECT_CHOICE_CONFIRMATION_STEP_ID } from '../../src/application/card-effects/runtime/public-effect-choice-confirmation';
import { getStageMemberLifecycleId } from '../../src/application/card-effects/runtime/ability-source-lifecycle';
import { createPublicObjectId, projectPlayerViewState } from '../../src/online/projector';
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
  ZoneType,
} from '../../src/shared/types/enums';

const P1 = 'player1';
const P2 = 'player2';
const ABILITY_ID = HS_BP8_006_ON_ENTER_DISCARD_HASUNOSORA_CHOOSE_HEART_OR_ARRANGE_ABILITY_ID;
const EFFECT_TEXT =
  '【登场】可以将手牌的１张『莲之空』的卡片放置入休息室：从以下选择１项。\n・选择[桃ハート]或[緑ハート]或[青ハート]或[紫ハート]中的１种。LIVE结束时为止，获得１个选中的HEART。\n・检视自己的卡组顶的3张卡片。可以将其中的任意张按任意顺序放置于卡组顶，其余的放置入休息室。';
const DISCARD = 'HS_BP8_006_DISCARD_HASUNOSORA_HAND_CARD';
const BRANCH = 'HS_BP8_006_CHOOSE_HEART_OR_ARRANGE';
const COLOR = 'HS_BP8_006_CHOOSE_HEART';
const ARRANGE = 'HS_BP8_006_ARRANGE_TOP_THREE';

function member(cardCode: string, groupNames: readonly string[] = ['蓮ノ空']): MemberCardData {
  return {
    cardCode,
    name: cardCode,
    groupNames,
    cardType: CardType.MEMBER,
    cost: 4,
    blade: 2,
    hearts: [createHeartIcon(HeartColor.PURPLE, 1)],
  };
}
function card(data: AnyCardData, id: string, ownerId = P1) {
  return createCardInstance(data, ownerId, id);
}
function live(id: string, groups = ['莲之空']) {
  return card(
    {
      cardCode: id,
      name: id,
      cardType: CardType.LIVE,
      groupNames: groups,
      score: 1,
      requirements: createHeartRequirement({ [HeartColor.PURPLE]: 1 }),
    },
    id
  );
}
function setup(
  options: {
    readonly sourceCode?: string;
    readonly hand?: readonly ReturnType<typeof card>[];
    readonly deck?: readonly ReturnType<typeof card>[];
    readonly waiting?: readonly ReturnType<typeof card>[];
    readonly watcher?: boolean;
  } = {}
) {
  let now = 10_000;
  const session = createGameSession({ now: () => now });
  session.createGame('hs-bp8-006', P1, 'P1', P2, 'P2');
  const source = card(member(options.sourceCode ?? 'PL!HS-bp8-006-R'), 'hime');
  const hand = options.hand ?? [live('cost-live')];
  const deck = options.deck ?? [
    card(member('TOP-1'), 'top-1'),
    card(member('TOP-2'), 'top-2'),
    live('top-3'),
    card(member('FILLER'), 'filler'),
  ];
  const waiting = options.waiting ?? [];
  const watcher = options.watcher ? card(member('PL!HS-pb1-003-R'), 'watcher') : null;
  let game = registerCards(createGameState('hs-bp8-006', P1, 'P1', P2, 'P2'), [
    source,
    ...hand,
    ...deck,
    ...waiting,
    ...(watcher ? [watcher] : []),
  ]);
  game = {
    ...game,
    currentPhase: GamePhase.MAIN_PHASE,
    currentSubPhase: SubPhase.MAIN_FREE,
    currentTurnType: TurnType.NORMAL,
    activePlayerIndex: 0,
    waitingPlayerId: null,
  };
  game = updatePlayer(game, P1, (player) => ({
    ...player,
    hand: {
      ...player.hand,
      cardIds: [source.instanceId, ...hand.map((entry) => entry.instanceId)],
    },
    mainDeck: { ...player.mainDeck, cardIds: deck.map((entry) => entry.instanceId) },
    waitingRoom: { ...player.waitingRoom, cardIds: waiting.map((entry) => entry.instanceId) },
    memberSlots: watcher
      ? placeCardInSlot(player.memberSlots, SlotPosition.LEFT, watcher.instanceId, {
          face: FaceState.FACE_UP,
          orientation: OrientationState.ACTIVE,
        })
      : player.memberSlots,
  }));
  function setState(state: GameState) {
    (session as unknown as { authorityState: GameState }).authorityState = state;
  }
  setState(game);
  session.setManualOperationMode('FREE');
  const result = session.executeCommand(
    createPlayMemberToSlotCommand(P1, source.instanceId, SlotPosition.CENTER, { freePlay: true })
  );
  expect(result.success, result.error).toBe(true);
  return {
    session,
    source,
    hand,
    cost: hand[0],
    deck,
    watcher,
    setState,
    setNow: (value: number) => {
      now = value;
    },
  };
}
type Scenario = ReturnType<typeof setup>;
function discard(scenario: Scenario, cardId = scenario.cost!.instanceId) {
  return scenario.session.executeCommand(
    createConfirmEffectStepCommand(P1, scenario.session.state!.activeEffect!.id, cardId)
  );
}
function choose(scenario: Scenario, optionIds: readonly string[]) {
  return scenario.session.executeCommand(
    createConfirmEffectChoiceCommand(P1, scenario.session.state!.activeEffect!.id, {
      selectedEffectOptionIds: optionIds,
    })
  );
}
function advanceChoice(scenario: Scenario) {
  const effect = scenario.session.state!.activeEffect!;
  expect(effect.stepId).toBe(PUBLIC_EFFECT_CHOICE_CONFIRMATION_STEP_ID);
  const command = createAutoAdvancePublicEffectChoiceCommand(
    P2,
    effect.id,
    effect.publicEffectChoiceAutoAdvanceAt!
  );
  scenario.setNow(command.publicEffectChoiceAutoAdvanceAt!);
  const result = scenario.session.executeCommand(command);
  expect(result.success, result.error).toBe(true);
}
function chooseAndAdvance(scenario: Scenario, id: string) {
  const result = choose(scenario, [id]);
  expect(result.success, result.error).toBe(true);
  advanceChoice(scenario);
}
function inspect(scenario: Scenario) {
  expect(discard(scenario).success).toBe(true);
  chooseAndAdvance(scenario, 'arrange-top-three');
}
function arrange(scenario: Scenario, ids: readonly string[]) {
  return scenario.session.executeCommand(
    createConfirmEffectStepCommand(
      P1,
      scenario.session.state!.activeEffect!.id,
      undefined,
      undefined,
      undefined,
      undefined,
      ids
    )
  );
}
function leaveSource(scenario: Scenario) {
  scenario.setState(
    updatePlayer(scenario.session.state!, P1, (player) => ({
      ...player,
      memberSlots: removeCardFromSlot(player.memberSlots, SlotPosition.CENTER),
      waitingRoom: {
        ...player.waitingRoom,
        cardIds: [...player.waitingRoom.cardIds, scenario.source.instanceId],
      },
    }))
  );
}
function reenterSource(scenario: Scenario) {
  leaveSource(scenario);
  let state = updatePlayer(scenario.session.state!, P1, (player) => ({
    ...player,
    waitingRoom: {
      ...player.waitingRoom,
      cardIds: player.waitingRoom.cardIds.filter((id) => id !== scenario.source.instanceId),
    },
    memberSlots: placeCardInSlot(
      player.memberSlots,
      SlotPosition.CENTER,
      scenario.source.instanceId,
      { face: FaceState.FACE_UP, orientation: OrientationState.ACTIVE }
    ),
  }));
  state = emitGameEvent(
    state,
    createEnterStageEvent(
      scenario.source.instanceId,
      ZoneType.WAITING_ROOM,
      SlotPosition.CENTER,
      P1,
      P1
    )
  );
  scenario.setState(state);
}
function waitingEvents(state: GameState, fromZone: ZoneType) {
  return state.eventLog
    .map((entry) => entry.event)
    .filter(
      (event) =>
        event.eventType === TriggerCondition.ON_ENTER_WAITING_ROOM && event.fromZone === fromZone
    );
}

describe('PL!HS-bp8-006 费用4 安养寺姬芽', () => {
  it.each(['PL!HS-bp8-006-R', 'PL!HS-bp8-006-P+', 'PL!HS-bp8-006-SEC'])(
    'uses real ON_ENTER and preserves the whole three-paragraph Chinese ability for %s',
    (sourceCode) => {
      const scenario = setup({ sourceCode });
      expect(findCardAbilityDefinitionById(ABILITY_ID)?.effectText).toBe(EFFECT_TEXT);
      expect(scenario.session.state!.activeEffect).toMatchObject({
        abilityId: ABILITY_ID,
        stepId: DISCARD,
        effectText: EFFECT_TEXT,
        confirmSelectionLabel: '放置入休息室',
        skipSelectionLabel: '不发动',
      });
      const entered = scenario.session.state!.eventLog.find(
        (entry) =>
          entry.event.eventType === TriggerCondition.ON_ENTER_STAGE &&
          entry.event.cardInstanceId === scenario.source.instanceId
      )!.event;
      expect(scenario.session.state!.activeEffect?.sourceLifecycleId).toBe(
        getStageMemberLifecycleId(scenario.session.state!, scenario.source.instanceId)
      );
      expect(entered.eventType).toBe(TriggerCondition.ON_ENTER_STAGE);
      expect(
        scenario.session.state!.actionHistory.find(
          (action) => action.type === 'TRIGGER_ABILITY' && action.payload.abilityId === ABILITY_ID
        )?.payload
      ).toMatchObject({
        sourceCardId: scenario.source.instanceId,
        sourceSlot: SlotPosition.CENTER,
        timingId: TriggerCondition.ON_ENTER_STAGE,
      });
    }
  );

  it('offers owned structured Hasunosora MEMBER and LIVE aliases, and pays one exact hand event', () => {
    const hand = [
      card(member('MEMBER', ['蓮ノ空女学院スクールアイドルクラブ']), 'member-cost'),
      live('live-cost'),
      card(member('OTHER', ['μ’s']), 'other'),
      card(member('OTHER-OWNER'), 'other-owner', P2),
    ];
    const scenario = setup({ hand });
    expect(scenario.session.state!.activeEffect?.selectableCardIds).toEqual([
      'member-cost',
      'live-cost',
    ]);
    expect(
      projectPlayerViewState(scenario.session.state!, P2).activeEffect?.selectableObjectIds
    ).toBeUndefined();
    expect(discard(scenario, 'other').success).toBe(false);
    expect(discard(scenario, 'live-cost').success).toBe(true);
    expect(scenario.session.state!.activeEffect).toMatchObject({
      stepId: BRANCH,
      canSkipSelection: false,
      effectChoice: { minSelections: 1, maxSelections: 1 },
    });
    expect(scenario.session.state!.players[0].waitingRoom.cardIds).toEqual(['live-cost']);
    expect(waitingEvents(scenario.session.state!, ZoneType.HAND)).toMatchObject([
      { cardInstanceIds: ['live-cost'], toZone: ZoneType.WAITING_ROOM },
    ]);
    expect(
      scenario.session.state!.actionHistory.filter(
        (action) => action.type === 'PAY_COST' && action.payload.abilityId === ABILITY_ID
      )
    ).toHaveLength(1);
    expect(scenario.session.state!.activeEffect?.selectableCardIds).toBeUndefined();
    expect(scenario.session.state!.activeEffect?.skipSelectionLabel).toBeUndefined();
  });

  it.each([HeartColor.PINK, HeartColor.GREEN, HeartColor.BLUE, HeartColor.PURPLE])(
    'grants one %s Heart to the original source member only through structured choices',
    (color) => {
      const scenario = setup();
      expect(discard(scenario).success).toBe(true);
      chooseAndAdvance(scenario, 'gain-heart');
      expect(scenario.session.state!.activeEffect?.stepId).toBe(COLOR);
      expect(
        scenario.session.state!.activeEffect?.effectChoice?.options.map((option) => option.id)
      ).toEqual([HeartColor.PINK, HeartColor.GREEN, HeartColor.BLUE, HeartColor.PURPLE]);
      const beforeChoice = scenario.session.state!;
      expect(choose(scenario, [color]).success).toBe(true);
      expect(scenario.session.state!.liveResolution.liveModifiers).toEqual(
        beforeChoice.liveResolution.liveModifiers
      );
      advanceChoice(scenario);
      expect(scenario.session.state!.activeEffect).toBeNull();
      expect(scenario.session.state!.liveResolution.liveModifiers).toMatchObject([
        {
          kind: 'HEART',
          target: 'SOURCE_MEMBER',
          sourceCardId: scenario.source.instanceId,
          abilityId: ABILITY_ID,
          hearts: [{ color, count: 1 }],
        },
      ]);
      const actual = getMemberEffectiveHeartIcons(
        scenario.session.state!,
        P1,
        scenario.source.instanceId
      );
      expect(
        actual.filter((heart) => heart.color === color).reduce((sum, heart) => sum + heart.count, 0)
      ).toBe(color === HeartColor.PURPLE ? 2 : 1);
      expect(getPlayerLiveHeartModifiers(scenario.session.state!.liveResolution, P1)).toEqual([]);
      expect(scenario.session.state!.players[0].mainDeck.cardIds).toEqual(
        scenario.deck.map((entry) => entry.instanceId)
      );
      expect(scenario.session.state!.inspectionZone.cardIds).toEqual([]);
    }
  );

  it('rejects empty, duplicate, oversized or unknown branch/color choices without a second fee or premature continuation', () => {
    const scenario = setup();
    expect(discard(scenario).success).toBe(true);
    for (const ids of [
      [],
      ['gain-heart', 'gain-heart'],
      ['gain-heart', 'arrange-top-three'],
      ['unknown'],
    ]) {
      expect(choose(scenario, ids).success).toBe(false);
      expect(scenario.session.state!.activeEffect?.stepId).toBe(BRANCH);
    }
    chooseAndAdvance(scenario, 'gain-heart');
    for (const ids of [
      [],
      [HeartColor.RED],
      [HeartColor.YELLOW],
      [HeartColor.GRAY],
      [HeartColor.ORANGE],
      [HeartColor.RAINBOW],
      [HeartColor.PINK, HeartColor.BLUE],
    ]) {
      expect(choose(scenario, ids).success).toBe(false);
      expect(scenario.session.state!.activeEffect?.stepId).toBe(COLOR);
    }
    expect(scenario.session.state!.players[0].waitingRoom.cardIds).toEqual([
      scenario.cost!.instanceId,
    ]);
    expect(
      scenario.session.state!.actionHistory.filter(
        (action) => action.type === 'PAY_COST' && action.payload.abilityId === ABILITY_ID
      )
    ).toHaveLength(1);
  });

  it.each([
    { selectedIds: [] },
    { selectedIds: ['top-3', 'top-1'] },
    { selectedIds: ['top-3', 'top-2', 'top-1'] },
  ])(
    'privately inspects three and uses selected order and an exact discarded batch for %j',
    ({ selectedIds }) => {
      const scenario = setup();
      inspect(scenario);
      expect(scenario.session.state!.activeEffect).toMatchObject({
        stepId: ARRANGE,
        minSelectableCards: 0,
        maxSelectableCards: 3,
        selectableCardMode: 'ORDERED_MULTI',
        confirmSelectionLabel: '按此顺序放置于卡组顶',
        skipSelectionLabel: '全部放置入休息室',
      });
      for (const playerId of [P1, P2]) {
        const view = projectPlayerViewState(scenario.session.state!, playerId);
        expect(view.objects[createPublicObjectId('top-1')]?.surface).toBe(
          playerId === P1 ? 'FRONT' : 'BACK'
        );
      }
      const unselected = ['top-1', 'top-2', 'top-3'].filter((id) => !selectedIds.includes(id));
      expect(arrange(scenario, selectedIds).success).toBe(true);
      expect(
        scenario.session.state!.players[0].mainDeck.cardIds.slice(0, selectedIds.length)
      ).toEqual(selectedIds);
      expect(scenario.session.state!.players[0].waitingRoom.cardIds).toEqual([
        scenario.cost!.instanceId,
        ...unselected,
      ]);
      expect(waitingEvents(scenario.session.state!, ZoneType.MAIN_DECK)).toHaveLength(
        unselected.length ? 1 : 0
      );
      if (unselected.length)
        expect(waitingEvents(scenario.session.state!, ZoneType.MAIN_DECK)).toMatchObject([
          {
            cardInstanceIds: unselected,
            cause: { sourceCardId: scenario.source.instanceId, abilityId: ABILITY_ID },
          },
        ]);
      expect(scenario.session.state!.inspectionZone.cardIds).toEqual([]);
      expect(scenario.session.state!.liveResolution.liveModifiers).toEqual([]);
    }
  );

  it('rejects stale costs and duplicate, excessive, foreign or stale arrange inputs', () => {
    const scenario = setup();
    const initial = scenario.session.state!;
    scenario.setState(
      updatePlayer(initial, P1, (player) => ({ ...player, hand: { ...player.hand, cardIds: [] } }))
    );
    expect(discard(scenario).success).toBe(false);
    expect(scenario.session.state!.activeEffect?.stepId).toBe(DISCARD);
    scenario.setState(registerCards(initial, [live(scenario.cost!.instanceId, ['μ’s'])]));
    expect(discard(scenario).success).toBe(false);
    scenario.setState(initial);
    inspect(scenario);
    const inspected = scenario.session.state!;
    for (const ids of [['top-1', 'top-1'], ['top-1', 'top-2', 'top-3', 'filler'], ['filler']])
      expect(arrange(scenario, ids).success).toBe(false);
    scenario.setState({
      ...inspected,
      inspectionZone: {
        ...inspected.inspectionZone,
        cardIds: inspected.inspectionZone.cardIds.filter((id) => id !== 'top-1'),
      },
    });
    expect(arrange(scenario, ['top-1']).success).toBe(false);
    expect(scenario.session.state!.activeEffect?.stepId).toBe(ARRANGE);
  });

  it('allows decline, and finishes no-target costs without inspecting or granting Heart', () => {
    const scenario = setup();
    const before = scenario.session.state!;
    expect(
      scenario.session.executeCommand(
        createConfirmEffectStepCommand(P1, before.activeEffect!.id, null)
      ).success
    ).toBe(true);
    expect(scenario.session.state!.players[0].hand.cardIds).toEqual(before.players[0].hand.cardIds);
    expect(scenario.session.state!.players[0].waitingRoom.cardIds).toEqual([]);
    expect(scenario.session.state!.activeEffect).toBeNull();
    const noTarget = setup({ hand: [card(member('OTHER', ['μ’s']), 'other')] });
    expect(noTarget.session.state!.activeEffect).toBeNull();
    expect(noTarget.session.state!.pendingAbilities).toEqual([]);
    expect(noTarget.session.state!.inspectionZone.cardIds).toEqual([]);
  });

  it.each(['left-before-cost', 'left-after-cost', 'reentered-before-reward'])(
    'keeps the fee but never gives a Heart to an expired source object: %s',
    (caseName) => {
      const scenario = setup();
      if (caseName === 'left-before-cost') leaveSource(scenario);
      expect(discard(scenario).success).toBe(true);
      chooseAndAdvance(scenario, 'gain-heart');
      const lifecycle = scenario.session.state!.activeEffect!.sourceLifecycleId;
      if (caseName === 'left-after-cost') leaveSource(scenario);
      if (caseName === 'reentered-before-reward') reenterSource(scenario);
      expect(scenario.session.state!.activeEffect!.sourceLifecycleId).toBe(lifecycle);
      chooseAndAdvance(scenario, HeartColor.GREEN);
      expect(scenario.session.state!.activeEffect).toBeNull();
      expect(scenario.session.state!.liveResolution.liveModifiers).toEqual([]);
      expect(scenario.session.state!.players[0].waitingRoom.cardIds).toContain(
        scenario.cost!.instanceId
      );
    }
  );

  it('still performs the independent deck branch after the source left before paying the legal fee', () => {
    const scenario = setup();
    leaveSource(scenario);
    inspect(scenario);
    expect(arrange(scenario, ['top-2', 'top-1']).success).toBe(true);
    expect(scenario.session.state!.players[0].mainDeck.cardIds.slice(0, 2)).toEqual([
      'top-2',
      'top-1',
    ]);
    expect(scenario.session.state!.players[0].waitingRoom.cardIds).toContain(
      scenario.cost!.instanceId
    );
  });

  it('clamps short decks and refreshes the already discarded fee into the actual inspected set when needed', () => {
    const short = setup({ deck: [card(member('ONLY'), 'only')], waiting: [] });
    inspect(short);
    expect(short.session.state!.activeEffect?.inspectionCardIds).toHaveLength(2);
    expect(short.session.state!.activeEffect?.inspectionCardIds).toContain(short.cost!.instanceId);
    expect(short.session.state!.activeEffect?.maxSelectableCards).toBe(2);
    expect(arrange(short, []).success).toBe(true);
    const empty = setup({ deck: [], waiting: [] });
    inspect(empty);
    expect(empty.session.state!.activeEffect?.inspectionCardIds).toEqual([empty.cost!.instanceId]);
    expect(arrange(empty, []).success).toBe(true);
    expect(empty.session.state!.activeEffect).toBeNull();
  });

  it('queues a fee-induced ability immediately but resolves it only after Hime completes her chosen branch', () => {
    const scenario = setup({ watcher: true });
    expect(discard(scenario).success).toBe(true);
    expect(
      scenario.session.state!.pendingAbilities.some(
        (ability) =>
          ability.abilityId === HS_PB1_003_AUTO_HAND_TO_WAITING_GAIN_HEART_BLADE_ABILITY_ID
      )
    ).toBe(true);
    expect(scenario.session.state!.activeEffect?.abilityId).toBe(ABILITY_ID);
    chooseAndAdvance(scenario, 'gain-heart');
    expect(
      scenario.session.state!.actionHistory.some(
        (action) => action.payload.step === 'GAIN_PINK_HEART_AND_BLADE_FROM_HAND_TO_WAITING'
      )
    ).toBe(false);
    chooseAndAdvance(scenario, HeartColor.BLUE);
    const actions = scenario.session.state!.actionHistory;
    const himeIndex = actions.findIndex(
      (action) =>
        action.payload.abilityId === ABILITY_ID && action.payload.step === 'GAIN_SELECTED_HEART'
    );
    const watcherIndex = actions.findIndex(
      (action) =>
        action.payload.abilityId === HS_PB1_003_AUTO_HAND_TO_WAITING_GAIN_HEART_BLADE_ABILITY_ID &&
        action.payload.step === 'GAIN_PINK_HEART_AND_BLADE_FROM_HAND_TO_WAITING'
    );
    expect(himeIndex).toBeGreaterThanOrEqual(0);
    expect(watcherIndex).toBeGreaterThan(himeIndex);
    expect(waitingEvents(scenario.session.state!, ZoneType.HAND)).toHaveLength(1);
    expect(scenario.session.state!.pendingAbilities).toEqual([]);
  });
});
