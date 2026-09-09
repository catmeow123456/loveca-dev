import type { ActiveEffectState, GameState } from '../../../domain/entities/game.js';
import type { ActiveEffectStepHandlerInput } from './step-registry.js';

/** A current input contract, supplied by the workflow that owns the step. */
export type ActiveEffectSelection =
  | {
      readonly kind: 'CARDS';
      readonly cardIds: readonly string[];
      readonly mode: 'SINGLE' | 'ORDERED_MULTI';
      readonly min: number;
      readonly max: number;
      readonly canSkip: boolean;
      /** Each selected card counts in every group it belongs to. */
      readonly groups?: readonly {
        readonly cardIds: readonly string[];
        readonly min: number;
        readonly max: number;
      }[];
    }
  | {
      readonly kind: 'OPTIONS';
      readonly options: readonly { readonly id: string; readonly text: string }[];
      readonly structured: boolean;
      readonly min: number;
      readonly max: number;
      readonly canSkip: boolean;
    }
  | { readonly kind: 'CONFIRM' };

export type ActiveEffectSelectionQuery = (game: GameState) => ActiveEffectSelection | undefined;

/** Opt in only when membership and cardinality fully describe this workflow's selection. */
export function queryCardSelection(game: GameState): ActiveEffectSelection | undefined {
  const effect = game.activeEffect;
  if (!effect?.selectableCardIds) return undefined;
  if (effect.selectableCardVisibility === 'AWAITING_PLAYER_BLIND') return undefined;
  const mode = effect.selectableCardMode ?? 'SINGLE';
  return {
    kind: 'CARDS',
    cardIds: effect.selectableCardIds,
    mode,
    min: mode === 'SINGLE' ? 1 : (effect.minSelectableCards ?? 0),
    max: mode === 'SINGLE' ? 1 : (effect.maxSelectableCards ?? effect.selectableCardIds.length),
    canSkip: effect.canSkipSelection === true,
  };
}

export function queryOptionSelection(game: GameState): ActiveEffectSelection | undefined {
  const effect = game.activeEffect;
  if (!effect) return undefined;
  if (effect.effectChoice)
    return {
      kind: 'OPTIONS',
      options: effect.effectChoice.options.filter((option) => option.selectable !== false),
      structured: true,
      min: effect.effectChoice.minSelections,
      max: effect.effectChoice.maxSelections,
      canSkip: effect.canSkipSelection === true,
    };
  if (!effect.selectableOptions) return undefined;
  return {
    kind: 'OPTIONS',
    options: effect.selectableOptions.map((option) => ({ id: option.id, text: option.label })),
    structured: false,
    min: 1,
    max: 1,
    canSkip: effect.canSkipSelection === true,
  };
}

export function queryConfirmSelection(): ActiveEffectSelection {
  return { kind: 'CONFIRM' };
}

/** Used before the normal handler/public confirmation, without executing or simulating the effect. */
export function isActiveEffectSelectionValid(
  selection: ActiveEffectSelection,
  input: ActiveEffectStepHandlerInput
): boolean {
  // Nullable choice fields and a false ordering flag express no selection in the command API.
  // Count only actual choices, so neutral fields cannot make a valid card input conflict.
  const keys = Object.keys(input).filter((key) => {
    const value = input[key as keyof ActiveEffectStepHandlerInput];
    return value !== undefined && value !== null && !(key === 'resolveInOrder' && value === false);
  });
  if (selection.kind === 'CONFIRM') return keys.length === 0;
  // Omitting the optional choice is also the normal command API's decline operation.
  if (keys.length === 0) return selection.canSkip;
  if (selection.kind === 'CARDS') {
    const key = selection.mode === 'ORDERED_MULTI' ? 'selectedCardIds' : 'selectedCardId';
    // Existing clients may submit the single object form to an exact-one multi step.
    const single = keys.length === 1 && keys[0] === 'selectedCardId';
    if (keys.length !== 1 || (!single && keys[0] !== key)) return false;
    const ids = single
      ? typeof input.selectedCardId === 'string'
        ? [input.selectedCardId]
        : []
      : (input.selectedCardIds ?? []);
    return (
      validSubset(selection.cardIds, ids, selection.min, selection.max) &&
      (selection.groups ?? []).every((group) => {
        const count = ids.filter((id) => group.cardIds.includes(id)).length;
        return count >= group.min && count <= group.max;
      })
    );
  }
  const key = selection.structured ? 'selectedEffectOptionIds' : 'selectedOptionId';
  if (keys.length !== 1 || keys[0] !== key) return false;
  const ids = selection.structured
    ? (input.selectedEffectOptionIds ?? [])
    : typeof input.selectedOptionId === 'string'
      ? [input.selectedOptionId]
      : [];
  return validSubset(
    selection.options.map((option) => option.id),
    ids,
    selection.min,
    selection.max
  );
}

function validSubset(
  candidates: readonly string[],
  ids: readonly string[],
  min: number,
  max: number
): boolean {
  return (
    ids.length >= min &&
    ids.length <= max &&
    new Set(ids).size === ids.length &&
    ids.every((id) => candidates.includes(id))
  );
}

export function isConfirmOnlyPendingSelection(effect: ActiveEffectState): boolean {
  return effect.metadata?.confirmOnlyPendingAbility === true;
}
