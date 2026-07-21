import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ActiveEffectViewState } from '../../src/online/types';
import {
  canConfirmEffectChoiceSelection,
  getSelectedEffectChoiceOptions,
  isPublicEffectChoiceAutoAdvanceView,
  normalizeEffectChoiceSelection,
  schedulePublicEffectChoiceAutoAdvance,
  toggleEffectChoiceSelection,
} from '../../client/src/lib/effectChoiceUi';

function effect(overrides: Partial<ActiveEffectViewState> = {}): ActiveEffectViewState {
  return {
    id: 'effect-choice-1',
    abilityId: 'test:effect-choice',
    sourceObjectId: 'obj_source',
    controllerSeat: 'FIRST',
    effectText: '从以下选择一项。',
    stepId: 'TEST_EFFECT_CHOICE',
    stepText: '请选择要发动的效果。',
    waitingSeat: 'FIRST',
    effectChoice: {
      mode: 'MULTI',
      options: [
        { id: 'draw', text: '抽1张。' },
        { id: 'blade', text: '获得[BLADE]。', selectable: false },
        { id: 'heart', text: '获得[桃ハート]。' },
      ],
      minSelections: 1,
      maxSelections: 2,
      publicConfirmation: true,
    },
    ...overrides,
  };
}

describe('effect choice UI model', () => {
  afterEach(() => vi.useRealTimers());

  it('keeps legal multi-selection in printed order and ignores disabled or excess options', () => {
    const choice = effect().effectChoice!;
    expect(normalizeEffectChoiceSelection(choice, ['heart', 'blade', 'draw'])).toEqual([
      'draw',
      'heart',
    ]);
    expect(toggleEffectChoiceSelection(choice, [], 'blade')).toEqual([]);
    expect(toggleEffectChoiceSelection(choice, ['heart'], 'draw')).toEqual(['draw', 'heart']);
    expect(toggleEffectChoiceSelection(choice, ['heart', 'draw'], 'heart')).toEqual(['draw']);
    expect(canConfirmEffectChoiceSelection(choice, [])).toBe(false);
    expect(canConfirmEffectChoiceSelection(choice, ['heart'])).toBe(true);
    expect(canConfirmEffectChoiceSelection(choice, ['blade'])).toBe(false);
    expect(canConfirmEffectChoiceSelection(choice, ['draw', 'draw'])).toBe(false);
  });

  it('shows only server-projected selected text during the public stage', () => {
    const view = effect({
      effectChoice: {
        ...effect().effectChoice!,
        selectedOptionIds: ['heart', 'draw'],
      },
      publicEffectChoiceAutoAdvanceAt: 11_500,
      publicEffectChoiceAutoAdvanceAfterMs: 1_500,
    });
    expect(isPublicEffectChoiceAutoAdvanceView(view)).toBe(true);
    expect(getSelectedEffectChoiceOptions(view.effectChoice!).map((option) => option.id)).toEqual([
      'draw',
      'heart',
    ]);
    expect(
      isPublicEffectChoiceAutoAdvanceView(effect({ publicEffectChoiceAutoAdvanceAt: 11_500 }))
    ).toBe(false);
  });

  it('requests automatic advance once and cancels a stale effect timer', () => {
    vi.useFakeTimers();
    const advance = vi.fn();
    const cancel = schedulePublicEffectChoiceAutoAdvance(1_500, advance);

    vi.advanceTimersByTime(1_499);
    expect(advance).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(advance).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(10_000);
    expect(advance).toHaveBeenCalledTimes(1);

    const staleAdvance = vi.fn();
    const cancelStale = schedulePublicEffectChoiceAutoAdvance(1_500, staleAdvance);
    cancelStale();
    vi.advanceTimersByTime(1_500);
    expect(staleAdvance).not.toHaveBeenCalled();
    cancel();
  });
});
