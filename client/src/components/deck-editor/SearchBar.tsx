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
      <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-orange-300/40" />
      <input
        type="text"
        placeholder="搜索卡牌名称或编号..."
        className="w-full pl-10 pr-20 py-2.5 bg-[#2d2820]/80 border border-orange-300/20 rounded-xl text-orange-100 text-sm placeholder-orange-300/40 focus:outline-none focus:border-orange-400/50 transition-all duration-200"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-2">
        <span className="text-xs text-orange-300/40">{resultCount} 张</span>
        {value && (
          <button
            onClick={() => onChange('')}
            className="text-orange-300/50 hover:text-orange-300 transition-colors"
          >
            <X size={14} />
          </button>
        )}
      </div>
    </div>
  );
}
