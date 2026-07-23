import type {
  ActiveEffectState,
  GameAction,
  GameState,
  PendingAbilityState,
} from '../../../domain/entities/game.js';
import { TriggerCondition, ZoneType } from '../../../shared/types/enums.js';
import { CardAbilitySourceZone } from '../ability-definition-types.js';
import { findCardAbilityDefinitionById } from '../definitions/lookup.js';

const SOURCE_LIFECYCLE_PREFIX = 'source-lifecycle';

interface AbilitySourceContext {
  readonly abilityId: string;
  readonly sourceCardId: string;
  readonly sourceLifecycleId?: string;
  readonly pendingAbilityId?: string;
  readonly eventIds?: readonly string[];
}

function getLifecycleEntryKind(abilityId: string): 'STAGE_MEMBER' | 'LIVE_CARD' | null {
  const sourceZone = findCardAbilityDefinitionById(abilityId)?.sourceZone;
  if (
    sourceZone === CardAbilitySourceZone.STAGE_MEMBER ||
    sourceZone === CardAbilitySourceZone.PLAYED_MEMBER
  ) {
    return 'STAGE_MEMBER';
  }
  if (sourceZone === CardAbilitySourceZone.LIVE_CARD) {
    return 'LIVE_CARD';
  }
  return null;
}

function getReferenceEventSequence(
  game: GameState,
  eventIds: readonly string[] | undefined
): number | undefined {
  if (!eventIds || eventIds.length === 0) {
    return undefined;
  }
  const eventIdSet = new Set(eventIds);
  const sequences = game.eventLog
    .filter((entry) => eventIdSet.has(entry.event.eventId))
    .map((entry) => entry.sequence);
  return sequences.length > 0 ? Math.min(...sequences) : undefined;
}

/**
 * Returns the rules-object lifecycle for a per-turn-limited ability source.
 *
 * A physical CardInstance keeps its instanceId while moving between zones. Rules
 * 4.1.4 instead treat a cross-zone card as a new card, so the latest qualifying
 * entry event identifies the current rules object. Intra-stage and intra-LIVE
 * moves deliberately do not create a new lifecycle. Test fixtures that place a
 * card directly in its source zone use a deterministic initial sentinel.
 */
export function getAbilitySourceLifecycleId(
  game: GameState,
  abilityId: string,
  sourceCardId: string,
  eventIds?: readonly string[]
): string {
  const entryKind = getLifecycleEntryKind(abilityId);
  const referenceSequence = getReferenceEventSequence(game, eventIds);
  const entry = [...game.eventLog].reverse().find((candidate) => {
    if (referenceSequence !== undefined && candidate.sequence > referenceSequence) {
      return false;
    }
    const event = candidate.event;
    if (entryKind === 'STAGE_MEMBER') {
      return (
        event.eventType === TriggerCondition.ON_ENTER_STAGE &&
        event.cardInstanceId === sourceCardId &&
        event.fromZone !== ZoneType.MEMBER_SLOT
      );
    }
    if (entryKind === 'LIVE_CARD') {
      return (
        event.eventType === TriggerCondition.ON_ENTER_LIVE_ZONE &&
        event.cardInstanceId === sourceCardId &&
        event.fromZone !== ZoneType.LIVE_ZONE
      );
    }
    return false;
  });

  return entry
    ? `${SOURCE_LIFECYCLE_PREFIX}:event:${entry.event.eventId}`
    : `${SOURCE_LIFECYCLE_PREFIX}:initial:${entryKind ?? 'OTHER'}:${sourceCardId}`;
}

export function getPendingAbilitySourceLifecycleId(
  game: GameState,
  ability: Pick<
    PendingAbilityState,
    'abilityId' | 'sourceCardId' | 'sourceLifecycleId' | 'eventIds'
  >
): string {
  return (
    ability.sourceLifecycleId ??
    getAbilitySourceLifecycleId(game, ability.abilityId, ability.sourceCardId, ability.eventIds)
  );
}

export function getActiveEffectSourceLifecycleId(
  game: GameState,
  effect: Pick<ActiveEffectState, 'abilityId' | 'sourceCardId' | 'sourceLifecycleId'>
): string {
  return (
    effect.sourceLifecycleId ??
    getAbilitySourceLifecycleId(game, effect.abilityId, effect.sourceCardId)
  );
}

function hasPerTurnLimit(abilityId: string): boolean {
  return findCardAbilityDefinitionById(abilityId)?.perTurnLimit !== undefined;
}

/**
 * Captures the source lifecycle when triggered abilities enter the pending pool.
 * eventIds pin the lookup to the trigger/check timing, so an old pending ability
 * cannot be reassigned to a later re-entry of the same physical card.
 */
export function capturePendingAbilitySourceLifecycles(game: GameState): GameState {
  const capturedByPendingId = new Map<string, string>();
  let pendingChanged = false;
  const pendingAbilities = game.pendingAbilities.map((ability) => {
    if (!hasPerTurnLimit(ability.abilityId)) {
      return ability;
    }
    const sourceLifecycleId = getPendingAbilitySourceLifecycleId(game, ability);
    capturedByPendingId.set(ability.id, sourceLifecycleId);
    if (ability.sourceLifecycleId === sourceLifecycleId) {
      return ability;
    }
    pendingChanged = true;
    return { ...ability, sourceLifecycleId };
  });
  if (capturedByPendingId.size === 0) {
    return game;
  }

  let historyChanged = false;
  const actionHistory = game.actionHistory.map((action) => {
    if (action.type !== 'TRIGGER_ABILITY') {
      return action;
    }
    const pendingAbilityId = action.payload.pendingAbilityId;
    if (typeof pendingAbilityId !== 'string') {
      return action;
    }
    const sourceLifecycleId = capturedByPendingId.get(pendingAbilityId);
    if (!sourceLifecycleId || action.payload.sourceLifecycleId === sourceLifecycleId) {
      return action;
    }
    historyChanged = true;
    return {
      ...action,
      payload: {
        ...action.payload,
        sourceLifecycleId,
      },
    };
  });

  return pendingChanged || historyChanged
    ? {
        ...game,
        pendingAbilities,
        actionHistory,
      }
    : game;
}

function patchAbilityUseAction(
  action: GameAction,
  context: AbilitySourceContext,
  sourceLifecycleId: string
): { readonly action: GameAction; readonly matched: boolean } {
  if (
    action.type !== 'RESOLVE_ABILITY' ||
    action.payload.abilityId !== context.abilityId ||
    action.payload.sourceCardId !== context.sourceCardId ||
    (action.payload.step !== 'ABILITY_USE' && action.payload.step !== 'ACTIVATED_ABILITY_USE')
  ) {
    return { action, matched: false };
  }
  const actionPendingAbilityId = action.payload.pendingAbilityId;
  if (
    context.pendingAbilityId !== undefined
      ? typeof actionPendingAbilityId === 'string' &&
        actionPendingAbilityId !== context.pendingAbilityId
      : typeof actionPendingAbilityId === 'string'
  ) {
    return { action, matched: false };
  }
  return {
    matched: true,
    action: {
      ...action,
      payload: {
        ...action.payload,
        sourceLifecycleId,
        ...(context.pendingAbilityId ? { pendingAbilityId: context.pendingAbilityId } : {}),
      },
    },
  };
}

/**
 * Propagates the selected pending/active/activated source lifecycle across one
 * thin dispatch boundary. This corrects only the first matching ABILITY_USE
 * owned by the current pending (or the first unowned use for active/activated
 * dispatch) and only fills an untagged activeEffect. Nested continuation
 * results may already belong to a later lifecycle and must remain untouched.
 */
export function propagateAbilitySourceLifecycle(
  before: GameState,
  after: GameState,
  context: AbilitySourceContext
): GameState {
  if (!hasPerTurnLimit(context.abilityId)) {
    return after;
  }
  const sourceLifecycleId =
    context.sourceLifecycleId ??
    getAbilitySourceLifecycleId(before, context.abilityId, context.sourceCardId, context.eventIds);

  let activeEffect = after.activeEffect;
  if (
    activeEffect &&
    activeEffect.abilityId === context.abilityId &&
    activeEffect.sourceCardId === context.sourceCardId &&
    activeEffect.sourceLifecycleId === undefined
  ) {
    activeEffect = {
      ...activeEffect,
      sourceLifecycleId,
    };
  }

  const historyStartIndex = Math.min(before.actionHistory.length, after.actionHistory.length);
  let historyChanged = false;
  let currentUsePatched = false;
  const actionHistory = after.actionHistory.map((action, index) => {
    if (index < historyStartIndex || currentUsePatched) {
      return action;
    }
    const patched = patchAbilityUseAction(action, context, sourceLifecycleId);
    currentUsePatched = patched.matched;
    historyChanged ||= patched.action !== action;
    return patched.action;
  });

  return activeEffect !== after.activeEffect || historyChanged
    ? {
        ...after,
        activeEffect,
        actionHistory,
      }
    : after;
}
