import { Check } from 'lucide-react';
import type { ActiveEffectViewState } from '@game/online/types';
import { CardEffectText } from '@/components/card/CardEffectText';
import {
  getSelectedEffectChoiceOptions,
  isPublicEffectChoiceAutoAdvanceView,
} from '@/lib/effectChoiceUi';
import { cn } from '@/lib/utils';

type EffectChoiceView = NonNullable<ActiveEffectViewState['effectChoice']>;

interface EffectChoicePanelProps {
  readonly activeEffect: ActiveEffectViewState;
  readonly selectedOptionIds: readonly string[];
  readonly canChoose: boolean;
  readonly canConfirmMulti: boolean;
  readonly onSelectSingle: (optionId: string) => void;
  readonly onToggleMulti: (optionId: string) => void;
  readonly onConfirmMulti: () => void;
  readonly onSkip: () => void;
}

function EffectChoiceOption({
  option,
  selected,
  disabled,
  publicResult,
  onClick,
}: {
  readonly option: EffectChoiceView['options'][number];
  readonly selected: boolean;
  readonly disabled: boolean;
  readonly publicResult: boolean;
  readonly onClick?: () => void;
}) {
  const content = (
    <>
      <span className="mt-[0.1em] shrink-0 text-[var(--accent-primary)]" aria-hidden="true">
        ·
      </span>
      <CardEffectText as="span" text={option.text} className="min-w-0 leading-relaxed" />
      {selected && (
        <span className="ml-auto flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--accent-primary)] text-white">
          <Check className="h-3.5 w-3.5" aria-hidden="true" />
        </span>
      )}
    </>
  );

  const classes = cn(
    'flex min-h-12 w-full items-start gap-2 rounded-lg border px-3 py-2.5 text-left text-[13px] font-semibold transition-colors md:text-sm',
    selected
      ? 'border-[var(--border-active)] bg-[color:color-mix(in_srgb,var(--accent-primary)_16%,var(--bg-surface))] text-[var(--text-primary)]'
      : 'border-[var(--border-subtle)] bg-[color:color-mix(in_srgb,var(--bg-surface)_72%,transparent)] text-[var(--text-secondary)]',
    !publicResult &&
      !disabled &&
      'hover:border-[var(--border-active)] hover:bg-[color:color-mix(in_srgb,var(--accent-primary)_10%,var(--bg-surface))]',
    disabled && !publicResult && 'cursor-not-allowed opacity-50'
  );

  if (publicResult) {
    return <div className={classes}>{content}</div>;
  }

  return (
    <button
      type="button"
      disabled={disabled}
      aria-pressed={selected}
      onClick={onClick}
      className={classes}
    >
      {content}
    </button>
  );
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
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs font-semibold text-[var(--text-secondary)]">
        <span>{publicResult ? '已选择的效果' : (activeEffect.selectionLabel ?? '选择效果')}</span>
        {!publicResult && effectChoice.mode === 'MULTI' && (
          <span className="rounded border border-[var(--border-default)] bg-[color:color-mix(in_srgb,var(--bg-surface)_76%,transparent)] px-2 py-1 text-[11px] text-[var(--text-primary)]">
            已选 {selectionCount} / {effectChoice.maxSelections}
            {effectChoice.minSelections > 0 ? `｜至少 ${effectChoice.minSelections}` : ''}
          </span>
        )}
      </div>
      <div className="grid grid-cols-1 gap-2">
        {options.map((option) => {
          const selected = selectedIdSet.has(option.id);
          return (
            <EffectChoiceOption
              key={option.id}
              option={option}
              selected={selected}
              publicResult={publicResult}
              disabled={!canChoose || option.selectable === false}
              onClick={() =>
                effectChoice.mode === 'SINGLE'
                  ? onSelectSingle(option.id)
                  : onToggleMulti(option.id)
              }
            />
          );
        })}
      </div>
      {!publicResult &&
        (effectChoice.mode === 'MULTI' || activeEffect.canSkipSelection === true) && (
          <div className="mt-3 flex flex-wrap justify-end gap-2">
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
