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

  return (
    <div className="flex items-center gap-3">
      <select
        value={min}
        onChange={(e) => {
          const val = Number(e.target.value);
          onMinChange(val);
          if (val > max) onMaxChange(val);
        }}
        className="px-3 py-1.5 bg-[#3d3020]/40 border border-orange-300/20 rounded-lg text-orange-200 text-sm focus:outline-none focus:border-orange-400/50"
      >
        {options.map((v) => (
          <option key={v} value={v}>{v}</option>
        ))}
      </select>
      <span className="text-orange-300/50">~</span>
      <select
        value={max}
        onChange={(e) => {
          const val = Number(e.target.value);
          onMaxChange(val);
          if (val < min) onMinChange(val);
        }}
        className="px-3 py-1.5 bg-[#3d3020]/40 border border-orange-300/20 rounded-lg text-orange-200 text-sm focus:outline-none focus:border-orange-400/50"
      >
        {options.map((v) => (
          <option key={v} value={v}>{v}</option>
        ))}
      </select>
    </div>
  );
}
