import type { HeartColor } from '@game/shared/types/enums';
import type { HeartRangeBoundary, HeartRangeFilters } from './heart-range-filter';

interface HeartColorOption {
  readonly value: HeartColor;
  readonly label: string;
}

interface HeartRangeFilterProps {
  options: readonly HeartColorOption[];
  ranges: HeartRangeFilters;
  iconSourceByColor: Readonly<Record<HeartColor, string>>;
  onToggleColor: (color: HeartColor) => void;
  onBoundaryChange: (color: HeartColor, boundary: HeartRangeBoundary, value: number | null) => void;
}

function parseOptionalCount(value: string): number | null {
  if (value.trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function HeartRangeFilter({
  options,
  ranges,
  iconSourceByColor,
  onToggleColor,
  onBoundaryChange,
}: HeartRangeFilterProps) {
  const selectedOptions = options.filter((option) => ranges[option.value] !== undefined);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5">
        {options.map((option) => {
          const selected = ranges[option.value] !== undefined;
          return (
            <button
              type="button"
              key={option.value}
              onClick={() => onToggleColor(option.value)}
              aria-label={`${option.label} Heart`}
              aria-pressed={selected}
              className={`flex min-h-9 items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs transition-colors duration-150 ${
                selected
                  ? 'border-[color:color-mix(in_srgb,var(--accent-primary)_40%,transparent)] bg-[color:color-mix(in_srgb,var(--accent-primary)_16%,transparent)] text-[var(--text-primary)]'
                  : 'border-[var(--border-subtle)] bg-[color:color-mix(in_srgb,var(--bg-surface)_74%,transparent)] text-[var(--text-secondary)] hover:border-[var(--border-default)] hover:text-[var(--text-primary)]'
              }`}
            >
              <img
                src={iconSourceByColor[option.value]}
                alt=""
                className="h-4 w-4 object-contain"
              />
              {option.label}
            </button>
          );
        })}
      </div>

      {selectedOptions.length > 0 && (
        <div className="space-y-2">
          <div className="grid gap-2 sm:grid-cols-2">
            {selectedOptions.map((option) => {
              const range = ranges[option.value];
              if (!range) return null;
              return (
                <div
                  key={option.value}
                  className="grid grid-cols-[minmax(4.5rem,auto)_minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 rounded-lg border border-[var(--border-subtle)] bg-[color:color-mix(in_srgb,var(--bg-surface)_76%,transparent)] p-2"
                >
                  <span className="flex min-w-0 items-center gap-1.5 text-xs font-medium text-[var(--text-primary)]">
                    <img
                      src={iconSourceByColor[option.value]}
                      alt=""
                      className="h-5 w-5 shrink-0 object-contain"
                    />
                    <span className="truncate">{option.label}</span>
                  </span>
                  <input
                    type="number"
                    min={0}
                    step={1}
                    inputMode="numeric"
                    value={range.min ?? ''}
                    placeholder="最小"
                    aria-label={`${option.label} Heart 最小数量`}
                    onChange={(event) =>
                      onBoundaryChange(option.value, 'min', parseOptionalCount(event.target.value))
                    }
                    className="input-field min-w-0 rounded-lg px-2 py-1.5 text-center text-sm"
                  />
                  <span className="text-xs text-[var(--text-muted)]">~</span>
                  <input
                    type="number"
                    min={0}
                    step={1}
                    inputMode="numeric"
                    value={range.max ?? ''}
                    placeholder="最大"
                    aria-label={`${option.label} Heart 最大数量`}
                    onChange={(event) =>
                      onBoundaryChange(option.value, 'max', parseOptionalCount(event.target.value))
                    }
                    className="input-field min-w-0 rounded-lg px-2 py-1.5 text-center text-sm"
                  />
                </div>
              );
            })}
          </div>
          <p className="text-[11px] text-[var(--text-muted)]">
            多种颜色需同时满足；数量留空表示不限，最大数量填 0 可排除该颜色。
          </p>
        </div>
      )}
    </div>
  );
}
