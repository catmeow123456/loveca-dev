/**
 * FilterChipGroup - 通用筛选按钮行
 */

interface FilterChipOption {
  value: string;
  label: string;
  colorClass?: string;
  icon?: string;
}

interface FilterChipGroupProps {
  options: readonly FilterChipOption[];
  selected: string | null;
  onSelect: (value: string | null) => void;
}

export function FilterChipGroup({ options, selected, onSelect }: FilterChipGroupProps) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((opt) => (
        <button
          key={opt.value}
          onClick={() => onSelect(selected === opt.value ? null : opt.value)}
          className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs transition-all duration-200 ${
            selected === opt.value
              ? 'border-[color:color-mix(in_srgb,var(--accent-primary)_40%,transparent)] bg-[color:color-mix(in_srgb,var(--accent-primary)_16%,transparent)] text-[var(--text-primary)] shadow-[var(--shadow-sm)]'
              : 'border-[var(--border-subtle)] bg-[color:color-mix(in_srgb,var(--bg-surface)_74%,transparent)] text-[var(--text-secondary)] hover:border-[var(--border-default)] hover:text-[var(--text-primary)]'
          }`}
        >
          {opt.colorClass && (
            <span className={`inline-block w-2.5 h-2.5 rounded-full ${opt.colorClass}`} />
          )}
          {opt.icon && <span>{opt.icon}</span>}
          {opt.label}
        </button>
      ))}
    </div>
  );
}
