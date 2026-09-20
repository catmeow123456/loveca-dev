import { describe, expect, it } from 'vitest';
import { SlotPosition } from '../../src/shared/types/enums';
import {
  isActiveEffectSelectionValid,
  queryCardSelection,
  queryOptionSelection,
  type ActiveEffectSelection,
} from '../../src/application/card-effects/runtime/selection-query';
import {
  registerActiveEffectStepHandler,
  resolveActiveEffectStepWithRegistry,
  type ActiveEffectStepHandlerContext,
  type ActiveEffectStepHandlerInput,
} from '../../src/application/card-effects/runtime/step-registry';
import { PUBLIC_EFFECT_CHOICE_CONFIRMATION_STEP_ID } from '../../src/application/card-effects/runtime/public-effect-choice-confirmation';
import {
  createGameState,
  type ActiveEffectState,
  type GameState,
} from '../../src/domain/entities/game';

const P1 = 'player1';

function structuredSingle(canSkip = false): Extract<ActiveEffectSelection, { kind: 'OPTIONS' }> {
  return {
    kind: 'OPTIONS',
    options: [
      { id: 'draw', text: '抽1张牌。' },
      { id: 'score', text: '此LIVE分数+1。' },
    ],
    structured: true,
    min: 1,
    max: 1,
    canSkip,
  };
}

function structuredMulti(canSkip = false): Extract<ActiveEffectSelection, { kind: 'OPTIONS' }> {
  return {
    kind: 'OPTIONS',
    options: [
      { id: 'a', text: 'A' },
      { id: 'b', text: 'B' },
      { id: 'c', text: 'C' },
    ],
    structured: true,
    min: 2,
    max: 2,
    canSkip,
  };
}

function unstructuredSingle(): Extract<ActiveEffectSelection, { kind: 'OPTIONS' }> {
  return {
    kind: 'OPTIONS',
    options: [{ id: 'pay', text: '支付[E]' }],
    structured: false,
    min: 1,
    max: 1,
    canSkip: false,
  };
}

function cards(
  min: number,
  max: number,
  canSkip = false
): Extract<ActiveEffectSelection, { kind: 'CARDS' }> {
  return {
    kind: 'CARDS',
    cardIds: ['c1', 'c2', 'c3'],
    mode: 'ORDERED_MULTI',
    min,
    max,
    canSkip,
    groups: [{ cardIds: ['c1'], min: 1, max: 1 }],
  };
}

describe('isActiveEffectSelectionValid option contract', () => {
  it('accepts only one currently offered stage slot, with no mixed input', () => {
    const selection: ActiveEffectSelection = {
      kind: 'SLOTS',
      slots: [SlotPosition.LEFT],
      canSkip: false,
    };
    expect(isActiveEffectSelectionValid(selection, { selectedSlot: SlotPosition.LEFT })).toBe(true);
    expect(isActiveEffectSelectionValid(selection, { selectedSlot: SlotPosition.CENTER })).toBe(
      false
    );
    expect(isActiveEffectSelectionValid(selection, {})).toBe(false);
    expect(
      isActiveEffectSelectionValid(selection, {
        selectedSlot: SlotPosition.LEFT,
        selectedCardId: 'foreign',
      })
    ).toBe(false);
    expect(
      isActiveEffectSelectionValid({ ...selection, canSkip: true }, { selectedSlot: null })
    ).toBe(true);
  });
  it('accepts the legacy selectedOptionId submission for an exact-one structured choice', () => {
    // game-session.ts normalizes selectedOptionId to [id] for SINGLE effectChoice;
    // the gate must accept the same shape instead of silently returning game.
    expect(isActiveEffectSelectionValid(structuredSingle(), { selectedOptionId: 'draw' })).toBe(
      true
    );
    expect(
      isActiveEffectSelectionValid(structuredSingle(), {
        selectedCardId: null,
        selectedOptionId: 'draw',
      })
    ).toBe(true);
    expect(isActiveEffectSelectionValid(structuredSingle(), { selectedOptionId: 'unknown' })).toBe(
      false
    );
  });

  it('accepts the new structured shape and the card-option two-key shape', () => {
    expect(
      isActiveEffectSelectionValid(structuredSingle(), { selectedEffectOptionIds: ['draw'] })
    ).toBe(true);
    // createConfirmEffectChoiceCommand may carry selectedCardId + selectedEffectOptionIds.
    expect(
      isActiveEffectSelectionValid(structuredSingle(), {
        selectedCardId: 'card-token-1',
        selectedEffectOptionIds: ['draw'],
      })
    ).toBe(true);
    expect(
      isActiveEffectSelectionValid(unstructuredSingle(), {
        selectedCardId: 'card-token-1',
        selectedOptionId: 'pay',
      })
    ).toBe(true);
  });

  it('still rejects illegal structured selections', () => {
    // Submitting both shapes at once is rejected by the command layer.
    expect(
      isActiveEffectSelectionValid(structuredSingle(), {
        selectedOptionId: 'draw',
        selectedEffectOptionIds: ['draw'],
      })
    ).toBe(false);
    // Over max / unknown ids / duplicates.
    expect(
      isActiveEffectSelectionValid(structuredSingle(), {
        selectedEffectOptionIds: ['draw', 'score'],
      })
    ).toBe(false);
    expect(
      isActiveEffectSelectionValid(structuredSingle(), { selectedEffectOptionIds: ['nope'] })
    ).toBe(false);
    expect(
      isActiveEffectSelectionValid(structuredMulti(), { selectedEffectOptionIds: ['a', 'a'] })
    ).toBe(false);
    expect(
      isActiveEffectSelectionValid(structuredMulti(), { selectedEffectOptionIds: ['a'] })
    ).toBe(false);
    expect(
      isActiveEffectSelectionValid(structuredMulti(), { selectedEffectOptionIds: ['a', 'b', 'c'] })
    ).toBe(false);
    expect(
      isActiveEffectSelectionValid(structuredMulti(), { selectedEffectOptionIds: ['a', 'b'] })
    ).toBe(true);
    // Unstructured windows do not accept the structured key.
    expect(
      isActiveEffectSelectionValid(unstructuredSingle(), { selectedEffectOptionIds: ['pay'] })
    ).toBe(false);
  });

  it('treats a legacy-only submission to a multi structured choice as the command layer decline', () => {
    // game-session.ts accepts {selectedCardId:null, selectedOptionId} on a MULTI choice
    // solely as a skip; the gate mirrors that instead of dead-ending the window.
    expect(isActiveEffectSelectionValid(structuredMulti(true), { selectedOptionId: 'a' })).toBe(
      true
    );
    expect(isActiveEffectSelectionValid(structuredMulti(false), { selectedOptionId: 'a' })).toBe(
      false
    );
  });

  it('keeps empty-input semantics aligned with the pre-gate behavior', () => {
    // Decline windows: empty input follows canSkip only.
    expect(isActiveEffectSelectionValid(structuredSingle(false), {})).toBe(false);
    expect(isActiveEffectSelectionValid(structuredSingle(true), {})).toBe(true);
    expect(isActiveEffectSelectionValid(unstructuredSingle(), { selectedOptionId: null })).toBe(
      false
    );
    // min-0 ordered card windows historically accepted an omitted selection
    // (handler default `input.selectedCardIds ?? []`), e.g. arrange-inspected-deck-edge.
    expect(isActiveEffectSelectionValid(cards(0, 2, false), {})).toBe(true);
    // An explicit empty list is still checked against the group constraints.
    expect(isActiveEffectSelectionValid(cards(0, 2, false), { selectedCardIds: [] })).toBe(false);
    expect(
      isActiveEffectSelectionValid({ ...cards(0, 2, false), groups: [] }, { selectedCardIds: [] })
    ).toBe(true);
    expect(isActiveEffectSelectionValid(cards(1, 2, false), {})).toBe(false);
    expect(isActiveEffectSelectionValid(cards(1, 2, true), {})).toBe(true);
    expect(isActiveEffectSelectionValid({ kind: 'CONFIRM' }, {})).toBe(true);
    expect(isActiveEffectSelectionValid({ kind: 'CONFIRM' }, { selectedCardId: 'c1' })).toBe(false);
  });

  it('still rejects illegal card selections', () => {
    expect(isActiveEffectSelectionValid(cards(1, 2), { selectedCardIds: ['c9'] })).toBe(false);
    expect(isActiveEffectSelectionValid(cards(1, 2), { selectedCardIds: ['c2', 'c3'] })).toBe(
      false
    ); // group {c1: min 1} unsatisfied
    expect(isActiveEffectSelectionValid(cards(1, 3), { selectedCardIds: ['c1', 'c1'] })).toBe(
      false
    );
    expect(isActiveEffectSelectionValid(cards(1, 2), { selectedCardIds: ['c1', 'c2', 'c3'] })).toBe(
      false
    ); // over max
    expect(isActiveEffectSelectionValid(cards(1, 2), { selectedCardIds: ['c1', 'c2'] })).toBe(true);
  });
});

describe('active effect step gate progression', () => {
  const context: ActiveEffectStepHandlerContext = {
    continuePendingCardEffects: (game) => game,
    delegatePendingAbility: (game) => game,
    resolveActivatedAbility: () => null,
    resolvePendingAbilityStarter: () => null,
  };

  function gameWithEffect(effect: ActiveEffectState): GameState {
    return {
      ...createGameState('selection-gate-game', P1, 'P1', 'player2', 'P2'),
      activeEffect: effect,
    };
  }

  function choiceEffect(overrides: Partial<ActiveEffectState> = {}): ActiveEffectState {
    return {
      id: 'choice-effect',
      abilityId: 'test:selection-gate-choice',
      sourceCardId: 'source-1',
      controllerId: P1,
      effectText: '从以下选择1项。',
      stepId: 'CHOOSE_STEP',
      stepText: '请选择要执行的效果。',
      awaitingPlayerId: P1,
      effectChoice: {
        mode: 'SINGLE',
        options: [
          { id: 'draw', text: '抽1张牌。', selectable: true },
          { id: 'score', text: '此LIVE分数+1。', selectable: true },
        ],
        minSelections: 1,
        maxSelections: 1,
      },
      ...overrides,
    };
  }

  it('advances a structured single choice submitted with the legacy selectedOptionId key', () => {
    const seen: ActiveEffectStepHandlerInput[] = [];
    registerActiveEffectStepHandler(
      'test:selection-gate-choice',
      'CHOOSE_STEP',
      (game, input) => {
        seen.push(input);
        return { ...game, activeEffect: null };
      },
      queryOptionSelection
    );
    const game = gameWithEffect(choiceEffect());
    const result = resolveActiveEffectStepWithRegistry(game, { selectedOptionId: 'draw' }, context);
    expect(result).not.toBe(game);
    expect(result?.activeEffect).toBeNull();
    expect(seen[0]?.selectedOptionId).toBe('draw');

    // An illegal option is still refused without advancing the step.
    const invalid = resolveActiveEffectStepWithRegistry(
      game,
      { selectedOptionId: 'nope' },
      context
    );
    expect(invalid).toBe(game);
    expect(seen).toHaveLength(1);
  });

  it('routes the legacy submission into the public effect-choice confirmation window', () => {
    registerActiveEffectStepHandler(
      'test:selection-gate-choice',
      'CHOOSE_STEP',
      (game) => ({ ...game, activeEffect: null }),
      queryOptionSelection
    );
    const effect = choiceEffect({
      canSkipSelection: true,
      effectChoice: {
        mode: 'SINGLE',
        options: [{ id: 'draw', text: '抽1张牌。', selectable: true }],
        minSelections: 1,
        maxSelections: 1,
        publicConfirmation: true,
      },
    });
    // A legacy choice carrying selectedCardId:null must not be misclassified as a decline.
    const chosen = resolveActiveEffectStepWithRegistry(
      gameWithEffect(effect),
      { selectedCardId: null, selectedOptionId: 'draw' },
      context
    );
    expect(chosen?.activeEffect?.stepId).toBe(PUBLIC_EFFECT_CHOICE_CONFIRMATION_STEP_ID);
    expect(chosen?.activeEffect?.effectChoice?.selectedOptionIds).toEqual(['draw']);

    // A real decline (no option key) still skips straight through the handler.
    const declined = resolveActiveEffectStepWithRegistry(
      gameWithEffect(effect),
      { selectedCardId: null },
      context
    );
    expect(declined?.activeEffect).toBeNull();
  });

  it('accepts an omitted selection on a min-0 ordered multi window and rejects over-max input', () => {
    const seen: ActiveEffectStepHandlerInput[] = [];
    registerActiveEffectStepHandler(
      'test:selection-gate-arrange',
      'ARRANGE_STEP',
      (game, input) => {
        seen.push(input);
        return { ...game, activeEffect: null };
      },
      queryCardSelection
    );
    const game = gameWithEffect({
      id: 'arrange-effect',
      abilityId: 'test:selection-gate-arrange',
      sourceCardId: 'source-1',
      controllerId: P1,
      effectText: '检视卡组顶2张。',
      stepId: 'ARRANGE_STEP',
      stepText: '按选择顺序放回卡组顶。',
      awaitingPlayerId: P1,
      selectableCardIds: ['c1', 'c2'],
      selectableCardMode: 'ORDERED_MULTI',
      minSelectableCards: 0,
      maxSelectableCards: 2,
    });
    // arrange-inspected-deck-edge handlers default to `input.selectedCardIds ?? []`.
    const empty = resolveActiveEffectStepWithRegistry(game, {}, context);
    expect(empty).not.toBe(game);
    expect(empty?.activeEffect).toBeNull();
    expect(seen[0]?.selectedCardIds).toBeUndefined();

    const overMax = resolveActiveEffectStepWithRegistry(
      game,
      { selectedCardIds: ['c1', 'c2', 'c3'] },
      context
    );
    expect(overMax).toBe(game);
    expect(seen).toHaveLength(1);
  });
});
