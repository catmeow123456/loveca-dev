/**
 * SearchBar - 搜索输入框
 */

import { Search, X } from 'lucide-react';

interface SearchBarProps {
  value: string;
  onChange: (value: string) => void;
  resultCount: number;
}

export function SearchBar({ value, onChange, resultCount }: SearchBarProps) {
  return (
    <div className="relative">
      <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
      <input
        type="text"
        placeholder="搜索卡牌名称或编号..."
        className="input-field w-full py-2.5 pl-10 pr-20 text-sm"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-2">
        <span className="text-xs text-[var(--text-muted)]">{resultCount} 张</span>
        {value && (
          <button
            onClick={() => onChange('')}
            className="text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)]"
          >
            <X size={14} />
          </button>
        )}
      </div>
    </div>
  );
}
