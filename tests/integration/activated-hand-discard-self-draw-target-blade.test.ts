import { describe, expect, it } from 'vitest';
import type { EnergyCardData, MemberCardData } from '../../src/domain/entities/card';
import { createCardInstance, createHeartIcon } from '../../src/domain/entities/card';
import {
  createGameState,
  getPlayerById,
  registerCards,
  setActivePlayer,
  setPhase,
  updatePlayer,
  type GameState,
} from '../../src/domain/entities/game';
import {
  addCardToStatefulZone,
  addCardToZone,
  placeCardInSlot,
  removeCardFromSlot,
} from '../../src/domain/entities/zone';
import {
  activateCardAbility,
  confirmActiveEffectStep,
  enqueueTriggeredCardEffects,
} from '../../src/application/card-effect-runner';
import {
  HS_BP6_014_ACTIVATED_HAND_DISCARD_SELF_DRAW_TARGET_MEGU_RURINO_BLADE_ABILITY_ID,
  PL_N_PB1_003_ACTIVATED_PAY_TWO_ENERGY_HAND_DISCARD_SELF_DRAW_TARGET_NIJIGASAKI_BLADE_ABILITY_ID,
} from '../../src/application/card-effects/ability-ids';
import { sendStageMemberToWaitingRoomAndEnqueueLeaveStageTriggers } from '../../src/application/card-effects/runtime/leave-stage-triggers';
import { moveMemberBetweenSlotsAndEnqueueTriggers } from '../../src/application/card-effects/runtime/member-slot-moved-triggers';
import { createActivateAbilityCommand } from '../../src/application/game-commands';
import { createGameSession } from '../../src/application/game-session';
import { getMemberEffectiveBladeCount } from '../../src/domain/rules/live-modifiers';
import { createPublicObjectId, projectPlayerViewState } from '../../src/online/projector';
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

const P1 = 'player1';
const P2 = 'player2';
const N_ABILITY =
  PL_N_PB1_003_ACTIVATED_PAY_TWO_ENERGY_HAND_DISCARD_SELF_DRAW_TARGET_NIJIGASAKI_BLADE_ABILITY_ID;
const HS_ABILITY = HS_BP6_014_ACTIVATED_HAND_DISCARD_SELF_DRAW_TARGET_MEGU_RURINO_BLADE_ABILITY_ID;

function member(
  cardCode: string,
  name = cardCode,
  groupNames: readonly string[] = ['虹ヶ咲学園スクールアイドル同好会']
): MemberCardData {
  return {
    cardCode,
    name,
    groupNames,
    cardType: CardType.MEMBER,
    cost: 4,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.BLUE, 1)],
  };
}

function energy(cardCode: string): EnergyCardData {
  return { cardCode, name: cardCode, cardType: CardType.ENERGY };
}

interface Scenario {
  readonly game: GameState;
  readonly sourceId: string;
  readonly drawId: string;
  readonly targetIds: readonly string[];
  readonly energyIds: readonly string[];
}

function setupN(
  options: {
    readonly targetCount?: number;
    readonly deckCount?: number;
    readonly energyCount?: number;
    readonly activeEnergyCount?: number;
    readonly markedEnergyIndices?: readonly number[];
    readonly sourceOwnerId?: string;
    readonly includeNonNijigasakiTopMember?: boolean;
    readonly includeMemberBelow?: boolean;
    readonly includeOpponentTarget?: boolean;
    readonly includeDiscardTriggerListener?: boolean;
  } = {}
): Scenario {
  const source = createCardInstance(
    member('PL!N-pb1-003-P＋', '桜坂しずく'),
    options.sourceOwnerId ?? P1,
    'n-pb1-003-source'
  );
  const deckCards = Array.from({ length: options.deckCount ?? 2 }, (_, index) =>
    createCardInstance(member(`DRAW-${index}`, `Draw ${index}`), P1, `draw-${index}`)
  );
  const targetCards = Array.from({ length: options.targetCount ?? 1 }, (_, index) =>
    createCardInstance(
      member(`NIJI-TARGET-${index}`, `虹咲 target ${index}`),
      P1,
      `target-${index}`
    )
  );
  const energies = Array.from({ length: options.energyCount ?? 2 }, (_, index) =>
    createCardInstance(energy(`ENERGY-${index}`), P1, `energy-${index}`)
  );
  const nonNiji = options.includeNonNijigasakiTopMember
    ? createCardInstance(member('OTHER-GROUP', 'Other', ["μ's"]), P1, 'other-group')
    : null;
  const below = options.includeMemberBelow
    ? createCardInstance(member('NIJI-BELOW', 'Below'), P1, 'member-below')
    : null;
  const opponentTarget = options.includeOpponentTarget
    ? createCardInstance(member('OPPONENT-NIJI', 'Opponent'), P2, 'opponent-target')
    : null;
  const listener = options.includeDiscardTriggerListener
    ? createCardInstance(
        member('PL!SP-bp5-005-P', '平安名すみれ', ['Liella!']),
        P1,
        'discard-listener'
      )
    : null;

  let game = registerCards(
    setPhase(
      createGameState('activated-hand-discard-target-blade', P1, 'P1', P2, 'P2'),
      GamePhase.MAIN_PHASE
    ),
    [
      source,
      ...deckCards,
      ...targetCards,
      ...energies,
      ...(nonNiji ? [nonNiji] : []),
      ...(below ? [below] : []),
      ...(opponentTarget ? [opponentTarget] : []),
      ...(listener ? [listener] : []),
    ]
  );
  game = updatePlayer(game, P1, (player) => {
    let slots = player.memberSlots;
    targetCards.forEach((card, index) => {
      slots = placeCardInSlot(
        slots,
        [SlotPosition.LEFT, SlotPosition.CENTER, SlotPosition.RIGHT][index]!,
        card.instanceId,
        {
          orientation: OrientationState.ACTIVE,
          face: FaceState.FACE_UP,
        }
      );
    });
    if (nonNiji) {
      const slot = targetCards.length === 0 ? SlotPosition.LEFT : SlotPosition.RIGHT;
      slots = placeCardInSlot(slots, slot, nonNiji.instanceId, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      });
    }
    if (listener) {
      slots = placeCardInSlot(slots, SlotPosition.CENTER, listener.instanceId, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      });
    }
    if (below) {
      slots = {
        ...slots,
        memberBelow: { ...slots.memberBelow, [SlotPosition.RIGHT]: [below.instanceId] },
      };
    }
    return {
      ...player,
      hand: addCardToZone(player.hand, source.instanceId),
      mainDeck: { ...player.mainDeck, cardIds: deckCards.map((card) => card.instanceId) },
      energyZone: energies.reduce(
        (zone, card, index) =>
          addCardToStatefulZone(zone, card.instanceId, {
            orientation:
              index < (options.activeEnergyCount ?? options.energyCount ?? 2)
                ? OrientationState.ACTIVE
                : OrientationState.WAITING,
            face: FaceState.FACE_UP,
          }),
        player.energyZone
      ),
      memberSlots: slots,
    };
  });
  if (opponentTarget) {
    game = updatePlayer(game, P2, (player) => ({
      ...player,
      memberSlots: placeCardInSlot(
        player.memberSlots,
        SlotPosition.LEFT,
        opponentTarget.instanceId
      ),
    }));
  }
  game = {
    ...game,
    energyActivePhaseSkips: (options.markedEnergyIndices ?? []).map((index) => ({
      playerId: P1,
      energyCardId: energies[index]!.instanceId,
      sourceCardId: 'marker-source',
      abilityId: 'marker-ability',
    })),
  };
  return {
    game,
    sourceId: source.instanceId,
    drawId: deckCards[0]?.instanceId ?? '',
    targetIds: targetCards.map((card) => card.instanceId),
    energyIds: energies.map((card) => card.instanceId),
  };
}

function setupHs(includeTarget: boolean): Scenario {
  const source = createCardInstance(
    member('PL!HS-bp6-014-R', '安養寺 姫芽', ['蓮ノ空']),
    P1,
    'hime'
  );
  const draw = createCardInstance(member('HS-DRAW', 'Draw', ['蓮ノ空']), P1, 'hs-draw');
  const remaining = createCardInstance(
    member('HS-REMAINING', 'Remaining', ['蓮ノ空']),
    P1,
    'hs-remaining'
  );
  const target = includeTarget
    ? createCardInstance(member('HS-TARGET', '藤島慈', ['蓮ノ空']), P1, 'hs-target')
    : null;
  let game = registerCards(
    setPhase(createGameState('hs-regression', P1, 'P1', P2, 'P2'), GamePhase.MAIN_PHASE),
    [source, draw, remaining, ...(target ? [target] : [])]
  );
  game = updatePlayer(game, P1, (player) => ({
    ...player,
    hand: addCardToZone(player.hand, source.instanceId),
    mainDeck: { ...player.mainDeck, cardIds: [draw.instanceId, remaining.instanceId] },
    memberSlots: target
      ? placeCardInSlot(player.memberSlots, SlotPosition.LEFT, target.instanceId)
      : player.memberSlots,
  }));
  return {
    game,
    sourceId: source.instanceId,
    drawId: draw.instanceId,
    targetIds: target ? [target.instanceId] : [],
    energyIds: [],
  };
}

function activate(scenario: Scenario, abilityId = N_ABILITY, playerId = P1): GameState {
  return activateCardAbility(scenario.game, playerId, scenario.sourceId, abilityId);
}

function selectCards(game: GameState, cardIds: readonly string[]): GameState {
  return confirmActiveEffectStep(
    game,
    P1,
    game.activeEffect!.id,
    undefined,
    undefined,
    undefined,
    undefined,
    cardIds
  );
}

describe('activated hand-discard-self draw target BLADE shared family', () => {
  it('preserves PL!HS-bp6-014: no energy cost, discard/draw, target restriction and Q258 no-target', () => {
    const withTarget = setupHs(true);
    const started = activate(withTarget, HS_ABILITY);
    expect(started.players[0].waitingRoom.cardIds).toEqual([withTarget.sourceId]);
    expect(started.players[0].hand.cardIds).toEqual([withTarget.drawId]);
    expect(started.activeEffect).toMatchObject({
      selectableCardIds: withTarget.targetIds,
      stepText: '请选择自己舞台上的1名「藤岛慈」或「大泽瑠璃乃」，LIVE结束时为止获得[BLADE]。',
      confirmSelectionLabel: '获得[BLADE]',
    });
    expect(started.actionHistory.some((action) => action.type === 'PAY_COST')).toBe(false);
    const done = confirmActiveEffectStep(
      started,
      P1,
      started.activeEffect!.id,
      withTarget.targetIds[0]
    );
    expect(getMemberEffectiveBladeCount(done, P1, withTarget.targetIds[0]!)).toBe(2);

    const noTarget = setupHs(false);
    const resolved = activate(noTarget, HS_ABILITY);
    expect(resolved.activeEffect).toBeNull();
    expect(resolved.players[0].waitingRoom.cardIds).toEqual([noTarget.sourceId]);
    expect(resolved.players[0].hand.cardIds).toEqual([noTarget.drawId]);
    expect(resolved.actionHistory.at(-1)?.payload).toMatchObject({
      step: 'DISCARD_SELF_DRAW_ONE_NO_TARGET',
      bladeBonus: 0,
    });
  });

  it('pays exactly two ordinary ACTIVE energy, discards the source, draws, and records auditable actions', () => {
    const scenario = setupN();
    const state = activate(scenario);
    const player = getPlayerById(state, P1)!;
    expect(
      scenario.energyIds.map((id) => player.energyZone.cardStates.get(id)?.orientation)
    ).toEqual([OrientationState.WAITING, OrientationState.WAITING]);
    expect(player.waitingRoom.cardIds).toContain(scenario.sourceId);
    expect(player.hand.cardIds).toContain(scenario.drawId);
    const enterEvent = state.eventLog.find(
      ({ event }) =>
        event.eventType === TriggerCondition.ON_ENTER_WAITING_ROOM &&
        event.cardInstanceId === scenario.sourceId
    )?.event;
    expect(enterEvent).toMatchObject({
      cardInstanceIds: [scenario.sourceId],
      fromZone: ZoneType.HAND,
      toZone: ZoneType.WAITING_ROOM,
      ownerId: P1,
      controllerId: P1,
    });
    const payCost = state.actionHistory.find((action) => action.type === 'PAY_COST');
    expect(payCost?.payload).toMatchObject({
      abilityId: N_ABILITY,
      sourceCardId: scenario.sourceId,
      paidEnergyCardIds: scenario.energyIds,
      discardedCardIds: [scenario.sourceId],
      movedToWaitingRoomCardIds: [scenario.sourceId],
      cause: { kind: 'CARD_EFFECT', abilityId: N_ABILITY, sourceCardId: scenario.sourceId },
    });
    const useIndex = state.actionHistory.findIndex(
      (action) =>
        action.type === 'RESOLVE_ABILITY' &&
        action.payload.abilityId === N_ABILITY &&
        action.payload.step === 'ABILITY_USE'
    );
    const payIndex = state.actionHistory.findIndex((action) => action.type === 'PAY_COST');
    expect(useIndex).toBeGreaterThan(payIndex);
    expect(state.actionHistory.at(-1)?.payload).toMatchObject({
      paidEnergyCardIds: scenario.energyIds,
      discardedCardIds: [scenario.sourceId],
      drawnCardIds: [scenario.drawId],
      targetCardIds: scenario.targetIds,
    });
  });

  it('rejects insufficient energy atomically without moving, drawing, or recording use', () => {
    const scenario = setupN({ energyCount: 1 });
    const result = activate(scenario);
    expect(result).toBe(scenario.game);
    expect(result.actionHistory).toEqual(scenario.game.actionHistory);
    expect(result.players[0].hand.cardIds).toContain(scenario.sourceId);
    expect(result.players[0].waitingRoom.cardIds).not.toContain(scenario.sourceId);
    expect(result.players[0].mainDeck.cardIds).toContain(scenario.drawId);
  });

  it('uses the standard marked-energy selection window and rejects wrong count, duplicate, outsider, WAITING and stale ids', () => {
    const scenario = setupN({ energyCount: 3, markedEnergyIndices: [1] });
    const window = activate(scenario);
    expect(window.activeEffect).toMatchObject({
      stepId: 'COMMON_ENERGY_OPERATION_SELECTION',
      stepText: '请选择用于支付[E][E]的活跃能量卡。',
      selectionLabel: '选择用于支付费用的能量卡',
      confirmSelectionLabel: '支付费用',
      selectableCardIds: scenario.energyIds,
      minSelectableCards: 2,
      maxSelectableCards: 2,
      canSkipSelection: false,
    });
    for (const ids of [
      [scenario.energyIds[0]!],
      [scenario.energyIds[0]!, scenario.energyIds[0]!],
      [scenario.energyIds[0]!, 'outsider'],
    ]) {
      expect(selectCards(window, ids)).toBe(window);
    }
    const withWaitingCandidate = updatePlayer(window, P1, (player) => ({
      ...player,
      energyZone: {
        ...player.energyZone,
        cardStates: new Map(player.energyZone.cardStates).set(scenario.energyIds[1]!, {
          orientation: OrientationState.WAITING,
          face: FaceState.FACE_UP,
        }),
      },
    }));
    expect(
      selectCards(withWaitingCandidate, [scenario.energyIds[0]!, scenario.energyIds[1]!])
    ).toBe(withWaitingCandidate);
    const withoutStaleEnergy = updatePlayer(window, P1, (player) => ({
      ...player,
      energyZone: {
        ...player.energyZone,
        cardIds: player.energyZone.cardIds.filter((id) => id !== scenario.energyIds[2]),
      },
    }));
    expect(selectCards(withoutStaleEnergy, [scenario.energyIds[0]!, scenario.energyIds[2]!])).toBe(
      withoutStaleEnergy
    );

    const selectedEnergyIds = [scenario.energyIds[1]!, scenario.energyIds[2]!];
    const paid = selectCards(window, selectedEnergyIds);
    expect(paid.activeEffect?.abilityId).toBe(N_ABILITY);
    expect(
      selectedEnergyIds.map((id) => paid.players[0].energyZone.cardStates.get(id)?.orientation)
    ).toEqual([OrientationState.WAITING, OrientationState.WAITING]);
    expect(paid.actionHistory.find((action) => action.type === 'PAY_COST')?.payload).toMatchObject({
      paidEnergyCardIds: selectedEnergyIds,
      energyCardIds: selectedEnergyIds,
    });
  });

  it('revalidates the hand source while waiting for energy selection and commits no partial cost when it is stale', () => {
    const scenario = setupN({ energyCount: 3, markedEnergyIndices: [0] });
    const window = activate(scenario);
    const sourceGone = updatePlayer(window, P1, (player) => ({
      ...player,
      hand: {
        ...player.hand,
        cardIds: player.hand.cardIds.filter((id) => id !== scenario.sourceId),
      },
      waitingRoom: addCardToZone(player.waitingRoom, scenario.sourceId),
    }));
    const result = selectCards(sourceGone, scenario.energyIds.slice(0, 2));
    expect(result.activeEffect).toBeNull();
    expect(result.players[0].energyZone.cardStates.get(scenario.energyIds[0]!)?.orientation).toBe(
      OrientationState.ACTIVE
    );
    expect(result.players[0].mainDeck.cardIds).toContain(scenario.drawId);
    expect(result.actionHistory.some((action) => action.type === 'PAY_COST')).toBe(false);
    expect(
      result.actionHistory.some(
        (action) => action.type === 'RESOLVE_ABILITY' && action.payload.step === 'ABILITY_USE'
      )
    ).toBe(false);
  });

  it('only starts for the active player in MAIN from their real hand with no conflicting effect', () => {
    const scenario = setupN();
    expect(activate(scenario)).not.toBe(scenario.game);
    const wrongPhase = setPhase(scenario.game, GamePhase.DRAW_PHASE);
    expect(activate({ ...scenario, game: wrongPhase })).toBe(wrongPhase);
    const nonActive = setActivePlayer(scenario.game, 1);
    expect(activate({ ...scenario, game: nonActive })).toBe(nonActive);
    expect(activate(scenario, N_ABILITY, P2)).toBe(scenario.game);
    const notInHand = updatePlayer(scenario.game, P1, (player) => ({
      ...player,
      hand: { ...player.hand, cardIds: [] },
      waitingRoom: addCardToZone(player.waitingRoom, scenario.sourceId),
    }));
    expect(activate({ ...scenario, game: notInHand })).toBe(notInHand);
    const opponentOwned = setupN({ sourceOwnerId: P2 });
    expect(activate(opponentOwned)).toBe(opponentOwned.game);
    const conflict: GameState = {
      ...scenario.game,
      activeEffect: {
        id: 'conflict',
        abilityId: 'other',
        sourceCardId: 'other',
        controllerId: P1,
        effectText: 'other',
        stepId: 'other',
        stepText: 'other',
        awaitingPlayerId: P1,
      },
    };
    expect(activate({ ...scenario, game: conflict })).toBe(conflict);
  });

  it('the official command discovers the HAND ability and rejects a source outside hand', () => {
    const scenario = setupN();
    const session = createGameSession();
    (session as unknown as { authorityState: GameState }).authorityState = scenario.game;
    expect(
      session.executeCommand(createActivateAbilityCommand(P1, scenario.sourceId, N_ABILITY)).success
    ).toBe(true);

    const outside = updatePlayer(scenario.game, P1, (player) => ({
      ...player,
      hand: { ...player.hand, cardIds: [] },
      waitingRoom: addCardToZone(player.waitingRoom, scenario.sourceId),
    }));
    const outsideSession = createGameSession();
    (outsideSession as unknown as { authorityState: GameState }).authorityState = outside;
    const result = outsideSession.executeCommand(
      createActivateAbilityCommand(P1, scenario.sourceId, N_ABILITY)
    );
    expect(result.success).toBe(false);
    expect(result.error).toBe('起动效果来源卡当前不在自己的手牌');
  });

  it('draws zero from an empty deck but still opens the mandatory legal target selection', () => {
    const scenario = setupN({ deckCount: 0 });
    const state = activate(scenario);
    expect(state.activeEffect?.selectableCardIds).toEqual(scenario.targetIds);
    expect(state.activeEffect?.canSkipSelection).toBe(false);
    expect(state.actionHistory.at(-1)?.payload.drawnCardIds).toEqual([]);
  });

  it('implements FAQ Q196: zero stage members still pays both costs, draws, opens no empty window and continues safely', () => {
    const scenario = setupN({ targetCount: 0 });
    const state = activate(scenario);
    expect(state.activeEffect).toBeNull();
    expect(state.players[0].waitingRoom.cardIds).toContain(scenario.sourceId);
    expect(state.players[0].hand.cardIds).toContain(scenario.drawId);
    expect(
      scenario.energyIds.every(
        (id) =>
          state.players[0].energyZone.cardStates.get(id)?.orientation === OrientationState.WAITING
      )
    ).toBe(true);
    expect(state.liveResolution.liveModifiers).toEqual([]);
    expect(state.actionHistory.at(-1)?.payload).toMatchObject({
      step: 'PAY_COST_DRAW_ONE_NO_NIJIGASAKI_TARGET',
      targetCardIds: [],
      bladeBonus: 0,
    });
  });

  it('offers only own top-level Nijigasaki MEMBER targets and projects only their public object ids to both players', () => {
    const scenario = setupN({
      includeNonNijigasakiTopMember: true,
      includeMemberBelow: true,
      includeOpponentTarget: true,
    });
    const state = activate(scenario);
    expect(state.activeEffect).toMatchObject({
      selectableCardIds: scenario.targetIds,
      selectableCardMode: 'SINGLE',
      minSelectableCards: 1,
      maxSelectableCards: 1,
      selectionLabel: '选择获得[BLADE]的虹咲成员',
      confirmSelectionLabel: '获得[BLADE]',
      canSkipSelection: false,
    });
    const expectedObjectIds = scenario.targetIds.map(createPublicObjectId);
    const p1View = projectPlayerViewState(state, P1);
    const p2View = projectPlayerViewState(state, P2);
    expect(p1View.activeEffect?.selectableObjectIds).toEqual(expectedObjectIds);
    expect(p2View.activeEffect?.selectableObjectIds).toEqual(expectedObjectIds);
    expect(p2View.activeEffect?.selectableObjectIds).not.toContain(
      createPublicObjectId(scenario.sourceId)
    );
    expect(p2View.activeEffect?.sourceObjectId).toBe(createPublicObjectId(scenario.sourceId));
    expect(state.activeEffect?.id).not.toContain(scenario.sourceId);
  });

  it('requires exactly one target, rejects skipping, and applies BLADE only to the chosen member', () => {
    const scenario = setupN({ targetCount: 2 });
    const state = activate(scenario);
    expect(confirmActiveEffectStep(state, P1, state.activeEffect!.id, null)).toBe(state);
    const result = confirmActiveEffectStep(
      state,
      P1,
      state.activeEffect!.id,
      scenario.targetIds[1]
    );
    expect(result.activeEffect).toBeNull();
    expect(getMemberEffectiveBladeCount(result, P1, scenario.targetIds[0]!)).toBe(1);
    expect(getMemberEffectiveBladeCount(result, P1, scenario.targetIds[1]!)).toBe(2);
    expect(result.actionHistory.at(-1)?.payload).toMatchObject({
      targetCardId: scenario.targetIds[1],
      paidEnergyCardIds: scenario.energyIds,
      discardedCardIds: [scenario.sourceId],
      drawnCardIds: [scenario.drawId],
      bladeBonus: 1,
    });
  });

  it('refreshes current candidates after a stale selection, or safely consumes the window if none remain', () => {
    const scenario = setupN({ targetCount: 2 });
    const started = activate(scenario);
    const oneLeft = updatePlayer(started, P1, (player) => ({
      ...player,
      memberSlots: removeCardFromSlot(player.memberSlots, SlotPosition.LEFT),
      waitingRoom: addCardToZone(player.waitingRoom, scenario.targetIds[0]!),
    }));
    const refreshed = confirmActiveEffectStep(
      oneLeft,
      P1,
      oneLeft.activeEffect!.id,
      scenario.targetIds[0]
    );
    expect(refreshed.activeEffect?.selectableCardIds).toEqual([scenario.targetIds[1]]);
    expect(refreshed.liveResolution.liveModifiers).toEqual([]);

    const noneLeft = updatePlayer(oneLeft, P1, (player) => ({
      ...player,
      memberSlots: removeCardFromSlot(player.memberSlots, SlotPosition.CENTER),
      waitingRoom: addCardToZone(player.waitingRoom, scenario.targetIds[1]!),
    }));
    const noOp = confirmActiveEffectStep(
      noneLeft,
      P1,
      noneLeft.activeEffect!.id,
      scenario.targetIds[0]
    );
    expect(noOp.activeEffect).toBeNull();
    expect(noOp.liveResolution.liveModifiers).toEqual([]);
    expect(noOp.actionHistory.at(-1)?.payload.bladeBonus).toBe(0);
  });

  it('keeps the target-bound modifier across slot movement, removes it when the target leaves, and ignores the discarded source lifecycle', () => {
    const scenario = setupN();
    const started = activate(scenario);
    const granted = confirmActiveEffectStep(
      started,
      P1,
      started.activeEffect!.id,
      scenario.targetIds[0]
    );
    expect(granted.players[0].waitingRoom.cardIds).toContain(scenario.sourceId);
    expect(getMemberEffectiveBladeCount(granted, P1, scenario.targetIds[0]!)).toBe(2);

    const moved = moveMemberBetweenSlotsAndEnqueueTriggers(
      granted,
      P1,
      scenario.targetIds[0]!,
      SlotPosition.RIGHT,
      enqueueTriggeredCardEffects,
      {
        cause: {
          kind: 'CARD_EFFECT',
          playerId: P1,
          sourceCardId: scenario.sourceId,
          abilityId: N_ABILITY,
        },
      }
    )!;
    expect(getMemberEffectiveBladeCount(moved.gameState, P1, scenario.targetIds[0]!)).toBe(2);

    const left = sendStageMemberToWaitingRoomAndEnqueueLeaveStageTriggers(
      moved.gameState,
      P1,
      scenario.targetIds[0]!,
      enqueueTriggeredCardEffects
    )!;
    expect(
      left.gameState.liveResolution.liveModifiers.some(
        (modifier) => modifier.kind === 'BLADE' && modifier.sourceCardId === scenario.targetIds[0]
      )
    ).toBe(false);
  });

  it('lets two independent source instances stack without overwriting each other', () => {
    const scenario = setupN({ energyCount: 4 });
    const secondSource = createCardInstance(
      member('PL!N-pb1-003-R', '桜坂しずく'),
      P1,
      'second-source'
    );
    let game = registerCards(scenario.game, [secondSource]);
    game = updatePlayer(game, P1, (player) => ({
      ...player,
      hand: addCardToZone(player.hand, secondSource.instanceId),
    }));
    let first = activateCardAbility(game, P1, scenario.sourceId, N_ABILITY);
    first = confirmActiveEffectStep(first, P1, first.activeEffect!.id, scenario.targetIds[0]);
    let second = activateCardAbility(first, P1, secondSource.instanceId, N_ABILITY);
    second = confirmActiveEffectStep(second, P1, second.activeEffect!.id, scenario.targetIds[0]);
    expect(getMemberEffectiveBladeCount(second, P1, scenario.targetIds[0]!)).toBe(3);
    expect(
      second.liveResolution.liveModifiers.filter(
        (modifier) =>
          modifier.kind === 'BLADE' &&
          modifier.abilityId === N_ABILITY &&
          modifier.sourceCardId === scenario.targetIds[0]
      )
    ).toHaveLength(2);
  });

  it('queues discard triggers without allowing them to interrupt the parent draw and target window', () => {
    const scenario = setupN({ includeDiscardTriggerListener: true });
    const state = activate(scenario);
    expect(state.players[0].hand.cardIds).toContain(scenario.drawId);
    expect(state.activeEffect?.abilityId).toBe(N_ABILITY);
    expect(state.pendingAbilities.length).toBeGreaterThan(0);
    expect(state.pendingAbilities.some((ability) => ability.abilityId !== N_ABILITY)).toBe(true);
  });
});
