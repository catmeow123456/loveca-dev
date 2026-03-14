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
          className={`px-2.5 py-1 text-xs rounded-lg border transition-all duration-200 flex items-center gap-1.5 ${
            selected === opt.value
              ? 'bg-orange-500/30 border-orange-400/60 text-orange-200'
              : 'bg-[#3d3020]/40 border-orange-300/20 text-orange-300/60 hover:border-orange-300/40 hover:text-orange-300'
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
