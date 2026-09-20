import type { ActiveEffectState, GameState } from '../../../domain/entities/game.js';
import type { ActiveEffectStepHandlerInput } from './step-registry.js';
import type { SlotPosition } from '../../../shared/types/enums.js';

/** A current input contract, supplied by the workflow that owns the step. */
export type ActiveEffectSelection =
  | { readonly kind: 'SLOTS'; readonly slots: readonly SlotPosition[]; readonly canSkip: boolean }
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

/** Opt in for a single stage-slot choice with no simultaneous card/number input. */
export function querySlotSelection(game: GameState): ActiveEffectSelection | undefined {
  const effect = game.activeEffect;
  return effect?.selectableSlots
    ? { kind: 'SLOTS', slots: effect.selectableSlots, canSkip: effect.canSkipSelection === true }
    : undefined;
}

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
  // An omitted card selection additionally defaults to the empty list inside the handlers
  // of min-0 ordered windows, so empty input stays a valid zero-card selection there.
  if (keys.length === 0) {
    return selection.canSkip || (selection.kind === 'CARDS' && selection.min === 0);
  }
  if (selection.kind === 'SLOTS')
    return (
      keys.length === 1 &&
      keys[0] === 'selectedSlot' &&
      input.selectedSlot !== undefined &&
      input.selectedSlot !== null &&
      selection.slots.includes(input.selectedSlot)
    );
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
  // Card-option effect choices submit the chosen card token alongside the option
  // selection (createConfirmEffectChoiceCommand); the command layer validates that
  // membership itself, so only the choice keys are gated here.
  const choiceKeys = keys.filter((key) => key !== 'selectedCardId');
  const optionIds = selection.options.map((option) => option.id);
  if (!selection.structured) {
    if (choiceKeys.length !== 1 || choiceKeys[0] !== 'selectedOptionId') return false;
    const ids = typeof input.selectedOptionId === 'string' ? [input.selectedOptionId] : [];
    return validSubset(optionIds, ids, selection.min, selection.max);
  }
  // The command layer accepts the legacy single-option key for an exact-one structured
  // choice and normalizes it to a one-element list (same as getStructuredEffectChoiceSelection).
  const legacyOptionId =
    selection.min === 1 &&
    selection.max === 1 &&
    input.selectedEffectOptionIds === undefined &&
    input.selectedOptionId
      ? input.selectedOptionId
      : undefined;
  if (legacyOptionId !== undefined) {
    return (
      choiceKeys.length === 1 &&
      choiceKeys[0] === 'selectedOptionId' &&
      validSubset(optionIds, [legacyOptionId], selection.min, selection.max)
    );
  }
  if (choiceKeys.length !== 1 || choiceKeys[0] !== 'selectedEffectOptionIds') {
    // A multi structured choice receiving only the legacy key carries no usable
    // selection; the command layer accepts that submission solely as a decline.
    return (
      choiceKeys.length === 1 &&
      choiceKeys[0] === 'selectedOptionId' &&
      typeof input.selectedOptionId === 'string' &&
      selection.canSkip
    );
  }
  return validSubset(optionIds, input.selectedEffectOptionIds ?? [], selection.min, selection.max);
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
