import { Check } from 'lucide-react';
import { CardEffectText } from '@/components/card/CardEffectText';
import { cn } from '@/lib/utils';

/** Presentation only; callers retain their single/multi-selection and command semantics. */
export function BattleEffectOptionList({
  label,
  options,
  readOnly = false,
  onSelect,
}: {
  label: string;
  options: readonly {
    id: string;
    text: string;
    selected?: boolean;
    disabled?: boolean;
  }[];
  readOnly?: boolean;
  onSelect: (id: string) => void;
}) {
  return (
    <div role="group" aria-label={label} className="grid grid-cols-1 gap-2">
      {options.map(({ id, text, selected, disabled }) => {
        const content = (
          <>
            <span className="mt-[0.1em] shrink-0 text-[var(--accent-primary)]" aria-hidden="true">
              ·
            </span>
            <CardEffectText
              as="span"
              text={text}
              className="min-w-0 whitespace-pre-line break-words leading-relaxed"
            />
            {selected && (
              <span className="ml-auto flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--accent-primary)] text-white">
                <Check className="h-3.5 w-3.5" aria-hidden="true" />
              </span>
            )}
          </>
        );
        const classes = cn(
          'flex min-h-12 w-full items-start gap-2 rounded-md border px-3 py-2.5 text-left text-[13px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)] md:text-sm',
          selected
            ? 'border-[var(--border-active)] bg-[color:color-mix(in_srgb,var(--accent-primary)_16%,var(--bg-surface))] text-[var(--text-primary)]'
            : 'border-[var(--border-subtle)] bg-[color:color-mix(in_srgb,var(--bg-surface)_72%,transparent)] text-[var(--text-secondary)]',
          !readOnly &&
            !disabled &&
            'hover:border-[var(--border-active)] hover:bg-[color:color-mix(in_srgb,var(--accent-primary)_10%,var(--bg-surface))]',
          disabled && !readOnly && 'cursor-not-allowed opacity-50'
        );
        return readOnly ? (
          <div key={id} className={classes}>
            {content}
          </div>
        ) : (
          <button
            key={id}
            type="button"
            disabled={disabled}
            aria-pressed={selected}
            onClick={() => onSelect(id)}
            className={classes}
          >
            {content}
          </button>
        );
      })}
    </div>
  );
}
