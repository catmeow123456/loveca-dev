/**
 * RangeSelector - 通用 min-max 区间选择器
 */

interface RangeSelectorProps {
  min: number;
  max: number;
  rangeMin: number;
  rangeMax: number;
  onMinChange: (v: number) => void;
  onMaxChange: (v: number) => void;
}

export function RangeSelector({ min, max, rangeMin, rangeMax, onMinChange, onMaxChange }: RangeSelectorProps) {
  const options = Array.from({ length: rangeMax - rangeMin + 1 }, (_, i) => rangeMin + i);
  const selectClass = 'input-field rounded-lg px-3 py-1.5 text-sm';

  return (
    <div className="flex items-center gap-3">
      <select
        value={min}
        onChange={(e) => {
          const val = Number(e.target.value);
          onMinChange(val);
          if (val > max) onMaxChange(val);
        }}
        className={selectClass}
      >
        {options.map((v) => (
          <option key={v} value={v}>{v}</option>
        ))}
      </select>
      <span className="text-[var(--text-muted)]">~</span>
      <select
        value={max}
        onChange={(e) => {
          const val = Number(e.target.value);
          onMaxChange(val);
          if (val < min) onMinChange(val);
        }}
        className={selectClass}
      >
        {options.map((v) => (
          <option key={v} value={v}>{v}</option>
        ))}
      </select>
    </div>
  );
}
