import type { ActiveEffectViewState } from '@game/online/types';
import { BattleEffectOptionList } from './BattleEffectOptionList';
import {
  getSelectedEffectChoiceOptions,
  isPublicEffectChoiceAutoAdvanceView,
} from '@/lib/effectChoiceUi';
import { cn } from '@/lib/utils';

interface EffectChoicePanelProps {
  readonly activeEffect: ActiveEffectViewState;
  readonly selectedOptionIds: readonly string[];
  readonly canChoose: boolean;
  readonly canConfirmMulti: boolean;
  readonly onSelectSingle: (optionId: string) => void;
  readonly onToggleMulti: (optionId: string) => void;
  readonly onConfirmMulti: () => void;
  readonly onSkip: () => void;
  readonly showSelectionSummary?: boolean;
  readonly showActions?: boolean;
  readonly readOnly?: boolean;
}

export function EffectChoicePanel({
  activeEffect,
  selectedOptionIds,
  canChoose,
  canConfirmMulti,
  onSelectSingle,
  onToggleMulti,
  onConfirmMulti,
  onSkip,
  showSelectionSummary = true,
  showActions = true,
  readOnly = false,
}: EffectChoicePanelProps) {
  const effectChoice = activeEffect.effectChoice;
  if (!effectChoice) return null;

  const publicResult = isPublicEffectChoiceAutoAdvanceView(activeEffect);
  const options = publicResult
    ? getSelectedEffectChoiceOptions(effectChoice)
    : effectChoice.options;
  const selectedIdSet = new Set(publicResult ? effectChoice.selectedOptionIds : selectedOptionIds);
  const selectionCount = selectedIdSet.size;

  return (
    <div className="mt-3 border-t border-[var(--border-subtle)] pt-3">
      {(showSelectionSummary || publicResult) && (
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs font-semibold text-[var(--text-secondary)]">
          <span>{publicResult ? '已选择的效果' : (activeEffect.selectionLabel ?? '选择效果')}</span>
          {!publicResult && effectChoice.mode === 'MULTI' && (
            <span className="rounded border border-[var(--border-default)] bg-[color:color-mix(in_srgb,var(--bg-surface)_76%,transparent)] px-2 py-1 text-[11px] text-[var(--text-primary)]">
              已选 {selectionCount} / {effectChoice.maxSelections}
              {effectChoice.minSelections > 0 ? `｜至少 ${effectChoice.minSelections}` : ''}
            </span>
          )}
        </div>
      )}
      <BattleEffectOptionList
        label={publicResult ? '已选择的效果' : '效果选项'}
        readOnly={publicResult || readOnly}
        options={options.map((option) => ({
          id: option.id,
          text: option.text,
          selected: selectedIdSet.has(option.id),
          disabled: !canChoose || option.selectable === false,
        }))}
        onSelect={effectChoice.mode === 'SINGLE' ? onSelectSingle : onToggleMulti}
      />
      {showActions && (
        <div className="mt-3 flex flex-wrap justify-end gap-2 empty:hidden">
          <EffectChoiceActions
            activeEffect={activeEffect}
            selectedOptionIds={selectedOptionIds}
            canChoose={canChoose}
            canConfirmMulti={canConfirmMulti}
            onConfirmMulti={onConfirmMulti}
            onSkip={onSkip}
          />
        </div>
      )}
      {publicResult && (
        <div className="mt-2 text-center text-[11px] font-semibold text-[var(--text-secondary)]">
          即将自动继续处理
        </div>
      )}
    </div>
  );
}

export function EffectChoiceActions({
  activeEffect,
  selectedOptionIds,
  canChoose,
  canConfirmMulti,
  onConfirmMulti,
  onSkip,
}: Pick<
  EffectChoicePanelProps,
  | 'activeEffect'
  | 'selectedOptionIds'
  | 'canChoose'
  | 'canConfirmMulti'
  | 'onConfirmMulti'
  | 'onSkip'
>) {
  const effectChoice = activeEffect.effectChoice;
  if (!effectChoice || isPublicEffectChoiceAutoAdvanceView(activeEffect)) return null;
  const selectionCount = new Set(selectedOptionIds).size;
  return (
    <>
      {activeEffect.canSkipSelection && (
        <button
          type="button"
          disabled={!canChoose}
          onClick={onSkip}
          className={cn(
            'button-secondary inline-flex min-h-10 items-center justify-center px-3 text-sm font-semibold',
            canChoose ? '' : 'cursor-not-allowed opacity-50'
          )}
        >
          {activeEffect.skipSelectionLabel ?? '不发动'}
        </button>
      )}
      {effectChoice.mode === 'MULTI' && (
        <button
          type="button"
          disabled={!canConfirmMulti}
          onClick={onConfirmMulti}
          className={cn(
            'button-primary inline-flex min-h-10 items-center justify-center px-4 text-sm font-semibold',
            canConfirmMulti ? '' : 'cursor-not-allowed opacity-50'
          )}
        >
          {activeEffect.confirmSelectionLabel ?? '按所选效果结算'}（{selectionCount}项）
        </button>
      )}
    </>
  );
}
