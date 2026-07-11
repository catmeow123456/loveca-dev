import {
  addAction,
  getOpponent,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { findMemberSlot } from '../../../../domain/entities/player.js';
import { addEnergyActivePhaseSkips } from '../../../../domain/rules/energy-active-skips.js';
import { OrientationState, TriggerCondition } from '../../../../shared/types/enums.js';
import {
  placeEnergyFromDeckToZoneByCardEffect,
  setEnergyOrientation,
} from '../../../effects/energy.js';
import { shouldSelectEnergyForOperation } from '../../../effects/energy-selection.js';
import {
  SP_BP7_007_LIVE_START_RETURN_TWO_GAIN_THREE_BLADE_ABILITY_ID,
  SP_BP7_007_LIVE_SUCCESS_MORE_ENERGY_ACTIVATE_FIVE_ABILITY_ID,
  SP_BP7_007_LIVE_SUCCESS_PLACE_TWO_SKIPPED_ENERGY_ABILITY_ID,
} from '../../ability-ids.js';
import {
  activateWaitingEnergyCardsForPlayer,
  addBladeLiveModifierForSourceMember,
} from '../../runtime/actions.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import type { PendingAbilityStarterOptions } from '../../runtime/starter-registry.js';
import {
  getAbilityEffectText,
  maybeStartConfirmablePendingAbilityConfirmation,
} from '../../runtime/workflow-helpers.js';
import {
  createOptionalEnergyReturnWindow,
  resolveOptionalEnergyReturn,
} from '../../runtime/optional-energy-return.js';

const SELECT_RETURN = 'SP_BP7_007_SELECT_TWO_ENERGY';
const SELECT_ACTIVATE = 'SP_BP7_007_SELECT_FIVE_WAITING_ENERGY';
type Continue = (g: GameState, o: boolean) => GameState;
type Enqueue = (g: GameState, t: readonly TriggerCondition[]) => GameState;
export function registerSpBp7007MeiWorkflowHandlers(deps: {
  enqueueTriggeredCardEffects: Enqueue;
}): void {
  registerPendingAbilityStarterHandler(
    SP_BP7_007_LIVE_START_RETURN_TWO_GAIN_THREE_BLADE_ABILITY_ID,
    (g, a, o, c) =>
      start(
        g,
        a,
        o.orderedResolution === true,
        c.continuePendingCardEffects,
        deps.enqueueTriggeredCardEffects
      )
  );
  registerActiveEffectStepHandler(
    SP_BP7_007_LIVE_START_RETURN_TWO_GAIN_THREE_BLADE_ABILITY_ID,
    SELECT_RETURN,
    (g, i, c) =>
      select(
        g,
        i.selectedCardIds ?? [],
        i.selectedOptionId ?? null,
        c.continuePendingCardEffects,
        deps.enqueueTriggeredCardEffects
      )
  );
  registerPendingAbilityStarterHandler(
    SP_BP7_007_LIVE_SUCCESS_PLACE_TWO_SKIPPED_ENERGY_ABILITY_ID,
    (g, a, o, c) => {
      const confirmation = maybeStartConfirmablePendingAbilityConfirmation(g, a, o, {
        stepText: '确认后结算此效果。',
      });
      return (
        confirmation ??
        place(
          g,
          a,
          o.orderedResolution === true,
          c.continuePendingCardEffects,
          deps.enqueueTriggeredCardEffects
        )
      );
    }
  );
  registerPendingAbilityStarterHandler(
    SP_BP7_007_LIVE_SUCCESS_MORE_ENERGY_ACTIVATE_FIVE_ABILITY_ID,
    (g, a, o, c) => startActivate(g, a, o, c.continuePendingCardEffects)
  );
  registerActiveEffectStepHandler(
    SP_BP7_007_LIVE_SUCCESS_MORE_ENERGY_ACTIVATE_FIVE_ABILITY_ID,
    SELECT_ACTIVATE,
    (g, i, c) => finishActivateSelection(g, i.selectedCardIds ?? [], c.continuePendingCardEffects)
  );
}
function finish(
  g: GameState,
  a: PendingAbilityState,
  o: boolean,
  n: Continue,
  p: Record<string, unknown>
) {
  return n(
    addAction(
      {
        ...g,
        activeEffect: null,
        pendingAbilities: g.pendingAbilities.filter((x) => x.id !== a.id),
      },
      'RESOLVE_ABILITY',
      a.controllerId,
      { pendingAbilityId: a.id, abilityId: a.abilityId, sourceCardId: a.sourceCardId, ...p }
    ),
    o
  );
}
function pending(e: NonNullable<GameState['activeEffect']>): PendingAbilityState {
  return {
    id: e.id,
    abilityId: e.abilityId,
    sourceCardId: e.sourceCardId,
    controllerId: e.controllerId,
    mandatory: true,
    timingId: '',
    eventIds: [],
  };
}
function start(
  g: GameState,
  a: PendingAbilityState,
  o: boolean,
  n: Continue,
  enq: Enqueue
): GameState {
  const p = getPlayerById(g, a.controllerId);
  if (!p || findMemberSlot(p, a.sourceCardId) === null || p.energyZone.cardIds.length < 2)
    return finish(g, a, o, n, { step: 'NO_VALID_COST' });
  return (
    createOptionalEnergyReturnWindow(g, {
      ability: a,
      requiredCount: 2,
      effectText: getAbilityEffectText(a.abilityId),
      stepId: SELECT_RETURN,
      stepText: '可以将2张能量放回能量卡组并发动此效果。',
      orderedResolution: o,
    }) ?? g
  );
}
function select(
  g: GameState,
  ids: readonly string[],
  option: string | null,
  n: Continue,
  enq: Enqueue
): GameState {
  const e = g.activeEffect;
  if (!e) return g;
  const player = getPlayerById(g, e.controllerId);
  if (!player || findMemberSlot(player, e.sourceCardId) === null)
    return finish(g, pending(e), e.metadata?.orderedResolution === true, n, {
      step: 'SOURCE_INVALID',
    });
  const payment = resolveOptionalEnergyReturn(g, {
    selectedCardIds: ids,
    selectedOptionId: option,
    enqueueTriggeredCardEffects: enq,
  });
  if (!payment) return g;
  if (payment.declined)
    return finish(g, pending(e), e.metadata?.orderedResolution === true, n, { step: 'DECLINED' });
  return afterPay(
    payment.gameState,
    pending(e),
    payment.movedEnergyCardIds,
    e.metadata?.orderedResolution === true,
    n
  );
}
function afterPay(
  g: GameState,
  a: PendingAbilityState,
  ids: readonly string[],
  o: boolean,
  n: Continue
): GameState {
  const p = getPlayerById(g, a.controllerId);
  if (!p || findMemberSlot(p, a.sourceCardId) === null || ids.length !== 2)
    return finish(g, a, o, n, { step: 'SOURCE_INVALID' });
  let state = g;
  state =
    addBladeLiveModifierForSourceMember(state, {
      playerId: p.id,
      sourceCardId: a.sourceCardId,
      abilityId: a.abilityId,
      amount: 3,
    })?.gameState ?? state;
  return finish(state, a, o, n, {
    step: 'PAID_AND_GAINED_BLADE',
    movedEnergyCardIds: ids,
    bladeBonus: 3,
  });
}
function place(
  g: GameState,
  a: PendingAbilityState,
  o: boolean,
  n: Continue,
  enq: Enqueue
): GameState {
  const p = getPlayerById(g, a.controllerId);
  let state = g;
  let ids: readonly string[] = [];
  if (p && findMemberSlot(p, a.sourceCardId) !== null) {
    const r = placeEnergyFromDeckToZoneByCardEffect(g, p.id, 2, OrientationState.WAITING, {
      kind: 'CARD_EFFECT',
      playerId: p.id,
      sourceCardId: a.sourceCardId,
      abilityId: a.abilityId,
      pendingAbilityId: a.id,
    });
    if (r) {
      ids = r.placedEnergyCardIds;
      state = addEnergyActivePhaseSkips(
        r.gameState,
        ids.map((energyCardId) => ({
          playerId: p.id,
          energyCardId,
          sourceCardId: a.sourceCardId,
          abilityId: a.abilityId,
        }))
      );
      if (ids.length) state = enq(state, [TriggerCondition.ON_ENERGY_PLACED_BY_CARD_EFFECT]);
    }
  }
  return finish(state, a, o, n, { placedEnergyCardIds: ids });
}
function getActivationSnapshot(game: GameState, ability: PendingAbilityState) {
  const player = getPlayerById(game, ability.controllerId);
  const opponent = player ? getOpponent(game, player.id) : null;
  const waitingEnergyCardIds =
    player?.energyZone.cardIds.filter(
      (id) => player.energyZone.cardStates.get(id)?.orientation === OrientationState.WAITING
    ) ?? [];
  const conditionMet =
    player !== null &&
    opponent !== null &&
    player.energyZone.cardIds.length > opponent.energyZone.cardIds.length;
  return {
    player,
    opponent,
    waitingEnergyCardIds,
    conditionMet,
    actualCount: conditionMet ? Math.min(5, waitingEnergyCardIds.length) : 0,
  };
}

function getActivationConfirmationText(game: GameState, ability: PendingAbilityState): string {
  const snapshot = getActivationSnapshot(game, ability);
  return `${getAbilityEffectText(ability.abilityId)}\n（当前自己能量${snapshot.player?.energyZone.cardIds.length ?? 0}张，对方能量${snapshot.opponent?.energyZone.cardIds.length ?? 0}张，条件${snapshot.conditionMet ? '满足' : '未满足'}，实际将${snapshot.actualCount}张能量变为活跃状态。）`;
}

function startActivate(
  game: GameState,
  ability: PendingAbilityState,
  options: PendingAbilityStarterOptions,
  next: Continue
): GameState {
  const snapshot = getActivationSnapshot(game, ability);
  const sourceValid =
    snapshot.player !== null && findMemberSlot(snapshot.player, ability.sourceCardId) !== null;
  const requiresSelection =
    sourceValid &&
    snapshot.conditionMet &&
    snapshot.waitingEnergyCardIds.length > 5 &&
    shouldSelectEnergyForOperation(game, ability.controllerId, 'ACTIVATE_WAITING_ENERGY', 5);
  if (requiresSelection) {
    return {
      ...game,
      activeEffect: {
        id: ability.id,
        abilityId: ability.abilityId,
        sourceCardId: ability.sourceCardId,
        controllerId: ability.controllerId,
        effectText: getAbilityEffectText(ability.abilityId),
        stepId: SELECT_ACTIVATE,
        stepText: '请选择5张待机能量变为活跃状态。',
        awaitingPlayerId: ability.controllerId,
        selectableCardIds: snapshot.waitingEnergyCardIds,
        selectableCardMode: 'ORDERED_MULTI',
        selectionLabel: '选择要变为活跃的能量',
        minSelectableCards: 5,
        maxSelectableCards: 5,
        confirmSelectionLabel: '变为活跃',
        canSkipSelection: false,
        metadata: { orderedResolution: options.orderedResolution === true },
      },
    };
  }
  const confirmation = maybeStartConfirmablePendingAbilityConfirmation(game, ability, options, {
    effectText: getActivationConfirmationText(game, ability),
    stepText: '确认后结算此效果。',
  });
  return (
    confirmation ??
    resolveAutomaticActivation(game, ability, options.orderedResolution === true, next)
  );
}

function resolveAutomaticActivation(
  game: GameState,
  ability: PendingAbilityState,
  ordered: boolean,
  next: Continue
): GameState {
  const snapshot = getActivationSnapshot(game, ability);
  const sourceValid =
    snapshot.player !== null && findMemberSlot(snapshot.player, ability.sourceCardId) !== null;
  const count = sourceValid ? snapshot.actualCount : 0;
  const result =
    snapshot.player && count > 0
      ? activateWaitingEnergyCardsForPlayer(game, snapshot.player.id, count)
      : null;
  return finish(result?.gameState ?? game, ability, ordered, next, {
    activatedEnergyCardIds: result?.activatedEnergyCardIds ?? [],
    activatedCount: result?.activatedEnergyCardIds.length ?? 0,
    ownEnergyCount: snapshot.player?.energyZone.cardIds.length ?? 0,
    opponentEnergyCount: snapshot.opponent?.energyZone.cardIds.length ?? 0,
    waitingEnergyCount: snapshot.waitingEnergyCardIds.length,
    conditionMet: snapshot.conditionMet,
  });
}

function finishActivateSelection(
  game: GameState,
  selectedCardIds: readonly string[],
  next: Continue
): GameState {
  const effect = game.activeEffect;
  if (!effect || effect.stepId !== SELECT_ACTIVATE || selectedCardIds.length !== 5) return game;
  const player = getPlayerById(game, effect.controllerId);
  if (!player || findMemberSlot(player, effect.sourceCardId) === null) return game;
  const opponent = getOpponent(game, player.id);
  if (!opponent || player.energyZone.cardIds.length <= opponent.energyZone.cardIds.length)
    return game;
  const unique = new Set(selectedCardIds);
  if (
    unique.size !== 5 ||
    selectedCardIds.some(
      (id) =>
        effect.selectableCardIds?.includes(id) !== true ||
        player.energyZone.cardStates.get(id)?.orientation !== OrientationState.WAITING
    )
  )
    return game;
  if (!shouldSelectEnergyForOperation(game, player.id, 'ACTIVATE_WAITING_ENERGY', 5)) return game;
  const result = setEnergyOrientation(game, player.id, selectedCardIds, OrientationState.ACTIVE);
  if (!result) return game;
  return finish(
    result.gameState,
    pending(effect),
    effect.metadata?.orderedResolution === true,
    next,
    {
      activatedEnergyCardIds: result.updatedEnergyCardIds,
      activatedCount: result.updatedEnergyCardIds.length,
      ownEnergyCount: player.energyZone.cardIds.length,
      opponentEnergyCount: opponent.energyZone.cardIds.length,
      waitingEnergyCount: effect.selectableCardIds?.length ?? 0,
      conditionMet: true,
    }
  );
}
