import { describe, expect, it } from 'vitest';
import type {
  AnyCardData,
  EnergyCardData,
  LiveCardData,
  MemberCardData,
} from '../../src/domain/entities/card';
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
  type PendingAbilityState,
} from '../../src/domain/entities/game';
import { createEnterStageEvent, type EnterStageEvent } from '../../src/domain/events/game-events';
import { addCardToZone, placeCardInSlot, removeCardFromSlot } from '../../src/domain/entities/zone';
import {
  ABILITY_ORDER_SELECTION_ID,
  confirmActiveEffectStep,
  enqueueTriggeredCardEffects,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import { createGameSession } from '../../src/application/game-session';
import { createPlayMemberToSlotCommand } from '../../src/application/game-commands';
import { playMemberFromZoneToEmptySlot } from '../../src/application/card-effects/runtime/play-member-to-stage';
import {
  PL_N_PB1_012_AUTO_TURN_ONCE_OTHER_COST_ELEVEN_MEMBER_ENTER_PLACE_WAITING_ENERGY_ABILITY_ID,
  SP_BP4_016_AUTO_CARD_EFFECT_PLACE_ENERGY_GAIN_PURPLE_HEART_ABILITY_ID,
  SP_PB1_005_ON_ENTER_PLACE_WAITING_ENERGY_ABILITY_ID,
} from '../../src/application/card-effects/ability-ids';
import { addLiveModifier } from '../../src/domain/rules/live-modifiers';
import { getMemberEffectiveCost } from '../../src/domain/rules/member-effective-cost';
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

const P1 = 'p1';
const P2 = 'p2';
const LANZHU_EFFECT_TEXT =
  '【自动】【1回合1次】此成员以外的费用为11的成员登场至自己的舞台时，从自己的能量卡组，将1张能量卡以待机状态放置入能量区。';

function member(
  cardCode: string,
  id: string,
  cost = 11,
  ownerId = P1
): ReturnType<typeof createCardInstance> {
  return createCardInstance(
    {
      cardCode,
      name: id,
      groupNames: ['虹ヶ咲'],
      cardType: CardType.MEMBER,
      cost,
      blade: 1,
      hearts: [createHeartIcon(HeartColor.PURPLE, 1)],
    },
    ownerId,
    id
  );
}

function energy(id: string): ReturnType<typeof createCardInstance> {
  const data: EnergyCardData = { cardCode: id, name: id, cardType: CardType.ENERGY };
  return createCardInstance(data, P1, id);
}

function liveWithForgedCost(id: string, cost: number): AnyCardData {
  const data: LiveCardData = {
    cardCode: id,
    name: id,
    groupNames: ['虹ヶ咲'],
    cardType: CardType.LIVE,
    score: 1,
    requirements: createHeartRequirement({ [HeartColor.PURPLE]: 1 }),
  };
  return { ...data, cost } as unknown as AnyCardData;
}

function pending(
  abilityId: string,
  sourceCardId: string,
  id: string,
  sourceSlot = SlotPosition.CENTER
): PendingAbilityState {
  return {
    id,
    abilityId,
    sourceCardId,
    controllerId: P1,
    mandatory: true,
    timingId: TriggerCondition.ON_ENTER_STAGE,
    eventIds: [`event-${id}`],
    sourceSlot,
  };
}

function lanzhuPending(sourceCardId: string, id: string, sourceSlot = SlotPosition.CENTER) {
  return pending(
    PL_N_PB1_012_AUTO_TURN_ONCE_OTHER_COST_ELEVEN_MEMBER_ENTER_PLACE_WAITING_ENERGY_ABILITY_ID,
    sourceCardId,
    id,
    sourceSlot
  );
}

function setupLanzhu(
  options: {
    sourceCount?: number;
    enteredCost?: number;
    energyCount?: number;
    enteredOwnerId?: string;
    enteredData?: AnyCardData;
  } = {}
) {
  const sources = Array.from({ length: options.sourceCount ?? 1 }, (_, index) =>
    member(index % 2 === 0 ? 'PL!N-pb1-012-P＋' : 'PL!N-pb1-012-R', `lanzhu-${index}`)
  );
  const enteredOwnerId = options.enteredOwnerId ?? P1;
  const entered = options.enteredData
    ? createCardInstance(options.enteredData, enteredOwnerId, 'entered')
    : member('TEST-ENTERED', 'entered', options.enteredCost ?? 11, enteredOwnerId);
  const energies = Array.from({ length: options.energyCount ?? 8 }, (_, index) =>
    energy(`energy-${index}`)
  );
  let game = registerCards(createGameState('n-pb1-012-energy', P1, 'P1', P2, 'P2'), [
    ...sources,
    entered,
    ...energies,
  ]);
  game = updatePlayer(game, P1, (player) => {
    let memberSlots = player.memberSlots;
    const slots = [SlotPosition.CENTER, SlotPosition.RIGHT, SlotPosition.LEFT];
    for (const [index, source] of sources.entries()) {
      memberSlots = placeCardInSlot(memberSlots, slots[index]!, source.instanceId, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      });
    }
    return {
      ...player,
      memberSlots,
      energyDeck: energies.reduce(
        (zone, card) => addCardToZone(zone, card.instanceId),
        player.energyDeck
      ),
    };
  });
  return { game, sources, entered, energies };
}

function normalEnterEvent(
  enteredCardId: string,
  controllerId = P1,
  fromZone = ZoneType.HAND,
  slot = SlotPosition.LEFT
): EnterStageEvent {
  return createEnterStageEvent(enteredCardId, fromZone, slot, controllerId, controllerId);
}

function enqueueEnter(game: GameState, event: EnterStageEvent): GameState {
  const withEvent = emitGameEvent(game, event);
  return enqueueTriggeredCardEffects(withEvent, [TriggerCondition.ON_ENTER_STAGE], {
    enterStageEvents: [event],
  });
}

function abilityActions(game: GameState, abilityId: string, step?: string) {
  return game.actionHistory.filter(
    (action) =>
      action.type === 'RESOLVE_ABILITY' &&
      action.payload.abilityId === abilityId &&
      (step === undefined || action.payload.step === step)
  );
}

function forceMainPhase(session: ReturnType<typeof createGameSession>): void {
  const state = session.state as unknown as {
    currentPhase: GamePhase;
    currentSubPhase: SubPhase;
    currentTurnType: TurnType;
    activePlayerIndex: number;
    waitingPlayerId: string | null;
  };
  state.currentPhase = GamePhase.MAIN_PHASE;
  state.currentSubPhase = SubPhase.MAIN_FREE;
  state.currentTurnType = TurnType.NORMAL;
  state.activePlayerIndex = 0;
  state.waitingPlayerId = null;
}

describe('shared place-waiting-energy keeps PL!SP-pb1-005-P＋ / R 费用13「葉月 恋」 behavior', () => {
  function setupRen(options: { energyDeckCount: number; listener?: boolean; followup?: boolean }) {
    const ren = member('PL!SP-pb1-005-R', 'ren-005', 13);
    const listener = member('PL!SP-bp4-016-N', 'ren-listener', 13);
    const energies = Array.from({ length: options.energyDeckCount }, (_, index) =>
      energy(`ren-energy-${index}`)
    );
    let game = registerCards(createGameState('sp-pb1-005', P1, 'P1', P2, 'P2'), [
      ren,
      listener,
      ...energies,
    ]);
    game = updatePlayer(game, P1, (player) => ({
      ...player,
      energyDeck: { ...player.energyDeck, cardIds: energies.map((card) => card.instanceId) },
      memberSlots: placeCardInSlot(
        options.listener
          ? placeCardInSlot(player.memberSlots, SlotPosition.LEFT, listener.instanceId, {
              orientation: OrientationState.ACTIVE,
              face: FaceState.FACE_UP,
            })
          : player.memberSlots,
        SlotPosition.CENTER,
        ren.instanceId,
        { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }
      ),
    }));
    const first = pending(
      SP_PB1_005_ON_ENTER_PLACE_WAITING_ENERGY_ABILITY_ID,
      ren.instanceId,
      'pending-005'
    );
    game = {
      ...game,
      pendingAbilities: options.followup
        ? [first, { ...first, id: 'pending-005-followup', sourceCardId: listener.instanceId }]
        : [first],
    };
    return { game, ren, energies };
  }

  it('preserves real WAITING placement, complete event cause, and action payload', () => {
    const scenario = setupRen({ energyDeckCount: 1 });
    const result = resolvePendingCardEffects(scenario.game).gameState;
    const energyId = scenario.energies[0]!.instanceId;
    expect(result.players[0].energyZone.cardIds).toEqual([energyId]);
    expect(result.players[0].energyZone.cardStates.get(energyId)?.orientation).toBe(
      OrientationState.WAITING
    );
    expect(
      result.eventLog.find(
        (entry) => entry.event.eventType === TriggerCondition.ON_ENERGY_PLACED_BY_CARD_EFFECT
      )?.event
    ).toMatchObject({
      targetPlayerId: P1,
      placedEnergyCardIds: [energyId],
      orientation: OrientationState.WAITING,
      cause: {
        playerId: P1,
        sourceCardId: scenario.ren.instanceId,
        abilityId: SP_PB1_005_ON_ENTER_PLACE_WAITING_ENERGY_ABILITY_ID,
        pendingAbilityId: 'pending-005',
      },
    });
    expect(
      abilityActions(
        result,
        SP_PB1_005_ON_ENTER_PLACE_WAITING_ENERGY_ABILITY_ID,
        'PLACE_WAITING_ENERGY'
      )[0]?.payload.placedEnergyCardIds
    ).toEqual([energyId]);
  });

  it('preserves empty-deck consumption and downstream continuation', () => {
    const empty = resolvePendingCardEffects(setupRen({ energyDeckCount: 0 }).game).gameState;
    expect(empty.pendingAbilities).toEqual([]);
    expect(
      empty.eventLog.some(
        (entry) => entry.event.eventType === TriggerCondition.ON_ENERGY_PLACED_BY_CARD_EFFECT
      )
    ).toBe(false);
    expect(
      abilityActions(
        empty,
        SP_PB1_005_ON_ENTER_PLACE_WAITING_ENERGY_ABILITY_ID,
        'PLACE_WAITING_ENERGY'
      )[0]?.payload.placedEnergyCardIds
    ).toEqual([]);

    const listener = setupRen({ energyDeckCount: 1, listener: true });
    const continued = resolvePendingCardEffects(listener.game).gameState;
    expect(
      abilityActions(
        continued,
        SP_BP4_016_AUTO_CARD_EFFECT_PLACE_ENERGY_GAIN_PURPLE_HEART_ABILITY_ID
      )
    ).toHaveLength(1);
  });

  it('preserves single auto resolution, ordered batch, and one manual confirm bridge', () => {
    const scenario = setupRen({ energyDeckCount: 4 });
    const first = scenario.game.pendingAbilities[0]!;
    const single = resolvePendingCardEffects(scenario.game).gameState;
    expect(single.activeEffect).toBeNull();

    const order = resolvePendingCardEffects({
      ...scenario.game,
      pendingAbilities: [first, { ...first, id: 'ordered-2' }],
    }).gameState;
    expect(order.activeEffect?.abilityId).toBe(ABILITY_ORDER_SELECTION_ID);
    const ordered = confirmActiveEffectStep(order, P1, order.activeEffect!.id, null, null, true);
    expect(ordered.activeEffect).toBeNull();
    expect(
      abilityActions(
        ordered,
        SP_PB1_005_ON_ENTER_PLACE_WAITING_ENERGY_ABILITY_ID,
        'PLACE_WAITING_ENERGY'
      )
    ).toHaveLength(2);

    const manualSelection = resolvePendingCardEffects({
      ...scenario.game,
      pendingAbilities: [first, { ...first, id: 'manual-2' }, { ...first, id: 'manual-3' }],
    }).gameState;
    const bridge = confirmActiveEffectStep(
      manualSelection,
      P1,
      manualSelection.activeEffect!.id,
      first.sourceCardId
    );
    expect(bridge.activeEffect).toMatchObject({
      id: first.id,
      stepText: '确认后结算此效果。',
      metadata: { confirmOnlyPendingAbility: true },
    });
    const confirmed = confirmActiveEffectStep(bridge, P1, bridge.activeEffect!.id);
    expect(
      abilityActions(
        confirmed,
        SP_PB1_005_ON_ENTER_PLACE_WAITING_ENERGY_ABILITY_ID,
        'PLACE_WAITING_ENERGY'
      )
    ).toHaveLength(1);
    expect(confirmed.activeEffect?.abilityId).toBe(ABILITY_ORDER_SELECTION_ID);
  });
});

describe('PL!N-pb1-012-P＋ / R 费用11「鐘 嵐珠」 AUTO', () => {
  const abilityId =
    PL_N_PB1_012_AUTO_TURN_ONCE_OTHER_COST_ELEVEN_MEMBER_ENTER_PLACE_WAITING_ENERGY_ABILITY_ID;

  it('uses real PLAY_MEMBER -> ON_ENTER_STAGE and places one WAITING energy', () => {
    const session = createGameSession();
    session.createGame('n-pb1-012-production', P1, 'P1', P2, 'P2');
    forceMainPhase(session);
    const source = member('PL!N-pb1-012-P＋', 'production-source');
    const incoming = member('TEST-COST-ELEVEN', 'production-incoming');
    const placedEnergy = energy('production-energy');
    let game = registerCards(session.state!, [source, incoming, placedEnergy]);
    game = updatePlayer(game, P1, (player) => ({
      ...player,
      hand: { ...player.hand, cardIds: [incoming.instanceId] },
      energyDeck: { ...player.energyDeck, cardIds: [placedEnergy.instanceId] },
      memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, source.instanceId, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      }),
    }));
    (session as unknown as { authorityState: GameState }).authorityState = game;

    const result = session.executeCommand(
      createPlayMemberToSlotCommand(P1, incoming.instanceId, SlotPosition.LEFT, { freePlay: true })
    );
    expect(result.success, result.error).toBe(true);
    expect(session.state?.players[0].energyZone.cardIds).toEqual([placedEnergy.instanceId]);
    expect(
      session.state?.players[0].energyZone.cardStates.get(placedEnergy.instanceId)?.orientation
    ).toBe(OrientationState.WAITING);
    expect(abilityActions(session.state!, abilityId, 'ABILITY_USE')).toHaveLength(1);
  });

  it('matches a real card-effect entry from a non-hand zone', () => {
    const scenario = setupLanzhu({ energyCount: 1 });
    const withInspectionCard = {
      ...scenario.game,
      inspectionZone: { ...scenario.game.inspectionZone, cardIds: [scenario.entered.instanceId] },
    };
    const played = playMemberFromZoneToEmptySlot(withInspectionCard, P1, {
      cardId: scenario.entered.instanceId,
      sourceZone: ZoneType.INSPECTION_ZONE,
      toSlot: SlotPosition.LEFT,
    });
    const event = played?.gameState.eventLog.at(-1)?.event as EnterStageEvent;
    expect(event.fromZone).toBe(ZoneType.INSPECTION_ZONE);
    const queued = enqueueTriggeredCardEffects(
      played!.gameState,
      [TriggerCondition.ON_ENTER_STAGE],
      {
        enterStageEvents: [event],
      }
    );
    const result = resolvePendingCardEffects(queued).gameState;
    expect(result.players[0].energyZone.cardIds).toEqual([scenario.energies[0]!.instanceId]);
  });

  it.each([
    ['费用10成员', 10],
    ['费用12成员', 12],
  ])('%s does not match', (_label, enteredCost) => {
    const scenario = setupLanzhu({ enteredCost, energyCount: 1 });
    expect(
      enqueueEnter(scenario.game, normalEnterEvent(scenario.entered.instanceId)).pendingAbilities
    ).toEqual([]);
  });

  it('rejects a LIVE card with forged cost and an opponent member', () => {
    const forged = setupLanzhu({ enteredData: liveWithForgedCost('FORGED-LIVE', 11) });
    expect(
      enqueueEnter(forged.game, normalEnterEvent(forged.entered.instanceId)).pendingAbilities
    ).toEqual([]);
    const opponent = setupLanzhu({ enteredOwnerId: P2 });
    expect(
      enqueueEnter(opponent.game, normalEnterEvent(opponent.entered.instanceId, P2))
        .pendingAbilities
    ).toEqual([]);
  });

  it('compares printed cost even when effective cost is modified', () => {
    const scenario = setupLanzhu();
    const modified = addLiveModifier(scenario.game, {
      kind: 'MEMBER_COST',
      playerId: P1,
      memberCardId: scenario.entered.instanceId,
      sourceCardId: scenario.sources[0]!.instanceId,
      abilityId: 'test:effective-cost-change',
      countDelta: -7,
    });
    expect(getMemberEffectiveCost(modified, P1, scenario.entered.instanceId)).toBe(4);
    expect(
      enqueueEnter(modified, normalEnterEvent(scenario.entered.instanceId)).pendingAbilities
    ).toHaveLength(1);
  });

  it('excludes only the entered source instance, not another copy', () => {
    const single = setupLanzhu({ sourceCount: 1 });
    expect(
      enqueueEnter(single.game, normalEnterEvent(single.sources[0]!.instanceId)).pendingAbilities
    ).toEqual([]);

    const copies = setupLanzhu({ sourceCount: 2 });
    const queued = enqueueEnter(
      copies.game,
      normalEnterEvent(copies.sources[1]!.instanceId, P1, ZoneType.HAND, SlotPosition.RIGHT)
    );
    expect(queued.pendingAbilities.map((ability) => ability.sourceCardId)).toEqual([
      copies.sources[0]!.instanceId,
    ]);
  });

  it('reserves pending use, limits each source independently, and resets next turn', () => {
    const scenario = setupLanzhu({ sourceCount: 2, energyCount: 5 });
    let game = enqueueEnter(scenario.game, normalEnterEvent(scenario.entered.instanceId));
    expect(game.pendingAbilities).toHaveLength(2);
    game = enqueueEnter(game, normalEnterEvent(scenario.entered.instanceId));
    expect(game.pendingAbilities).toHaveLength(2);
    const ordered = resolvePendingCardEffects(game).gameState;
    game = confirmActiveEffectStep(ordered, P1, ordered.activeEffect!.id, null, null, true);
    expect(abilityActions(game, abilityId, 'ABILITY_USE')).toHaveLength(2);
    expect(
      enqueueEnter(game, normalEnterEvent(scenario.entered.instanceId)).pendingAbilities
    ).toEqual([]);
    game = { ...game, turnCount: game.turnCount + 1 };
    expect(
      enqueueEnter(game, normalEnterEvent(scenario.entered.instanceId)).pendingAbilities
    ).toHaveLength(2);
  });

  it('records use, consumes pending, and continues with an empty energy deck', () => {
    const scenario = setupLanzhu({ energyCount: 0 });
    const resolved = resolvePendingCardEffects(
      enqueueEnter(scenario.game, normalEnterEvent(scenario.entered.instanceId))
    ).gameState;
    expect(resolved.pendingAbilities).toEqual([]);
    expect(abilityActions(resolved, abilityId, 'ABILITY_USE')).toHaveLength(1);
    expect(
      abilityActions(
        resolved,
        abilityId,
        'PLACE_WAITING_ENERGY_AFTER_OTHER_COST_ELEVEN_MEMBER_ENTER'
      )[0]?.payload.placedEnergyCardIds
    ).toEqual([]);
  });

  it('still resolves after the source leaves and emits exact cause/card IDs', () => {
    const scenario = setupLanzhu({ energyCount: 1 });
    const queued = enqueueEnter(scenario.game, normalEnterEvent(scenario.entered.instanceId));
    const withoutSource = updatePlayer(queued, P1, (player) => ({
      ...player,
      memberSlots: removeCardFromSlot(player.memberSlots, SlotPosition.CENTER),
    }));
    const resolved = resolvePendingCardEffects(withoutSource).gameState;
    const placedId = scenario.energies[0]!.instanceId;
    expect(resolved.players[0].energyDeck.cardIds).not.toContain(placedId);
    expect(resolved.players[0].energyZone.cardIds).toContain(placedId);
    expect(
      resolved.eventLog.find(
        (entry) => entry.event.eventType === TriggerCondition.ON_ENERGY_PLACED_BY_CARD_EFFECT
      )?.event
    ).toMatchObject({
      placedEnergyCardIds: [placedId],
      orientation: OrientationState.WAITING,
      cause: {
        playerId: P1,
        sourceCardId: scenario.sources[0]!.instanceId,
        abilityId,
        pendingAbilityId: queued.pendingAbilities[0]!.id,
      },
    });
  });

  it('auto-resolves single/ordered and uses exactly one confirm-only bridge for manual selection', () => {
    const scenario = setupLanzhu({ sourceCount: 3, energyCount: 8 });
    const directPending = scenario.sources.map((source, index) =>
      lanzhuPending(
        source.instanceId,
        `manual-${index}`,
        [SlotPosition.CENTER, SlotPosition.RIGHT, SlotPosition.LEFT][index]!
      )
    );
    const single = resolvePendingCardEffects({
      ...scenario.game,
      pendingAbilities: [directPending[0]!],
    }).gameState;
    expect(single.activeEffect).toBeNull();

    const order = resolvePendingCardEffects({
      ...scenario.game,
      pendingAbilities: directPending.slice(0, 2),
    }).gameState;
    const ordered = confirmActiveEffectStep(order, P1, order.activeEffect!.id, null, null, true);
    expect(ordered.activeEffect).toBeNull();
    expect(
      abilityActions(
        ordered,
        abilityId,
        'PLACE_WAITING_ENERGY_AFTER_OTHER_COST_ELEVEN_MEMBER_ENTER'
      )
    ).toHaveLength(2);

    const selection = resolvePendingCardEffects({
      ...scenario.game,
      pendingAbilities: directPending,
    }).gameState;
    const bridge = confirmActiveEffectStep(
      selection,
      P1,
      selection.activeEffect!.id,
      scenario.sources[0]!.instanceId
    );
    expect(bridge.activeEffect).toMatchObject({
      id: 'manual-0',
      effectText: LANZHU_EFFECT_TEXT,
      stepText: '确认后结算此效果。',
      metadata: { confirmOnlyPendingAbility: true },
    });
    const afterConfirm = confirmActiveEffectStep(bridge, P1, bridge.activeEffect!.id);
    expect(
      abilityActions(
        afterConfirm,
        abilityId,
        'PLACE_WAITING_ENERGY_AFTER_OTHER_COST_ELEVEN_MEMBER_ENTER'
      )
    ).toHaveLength(1);
    expect(afterConfirm.activeEffect?.abilityId).toBe(ABILITY_ORDER_SELECTION_ID);
    expect(afterConfirm.pendingAbilities).toHaveLength(2);
  });
});
