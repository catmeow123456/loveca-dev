/**
 * 卡牌列表通用搜索框。
 *
 * 只负责输入与结果数量展示；筛选发生在本地还是服务端由调用方决定。
 */

import { Search, X } from 'lucide-react';

interface CardSearchInputProps {
  value: string;
  onChange: (value: string) => void;
  resultCount?: number;
  placeholder?: string;
  ariaLabel?: string;
}

export function CardSearchInput({
  value,
  onChange,
  resultCount,
  placeholder = '搜索卡牌名称或编号...',
  ariaLabel = '搜索卡牌名称或编号',
}: CardSearchInputProps) {
  return (
    <div className="relative">
      <Search
        size={15}
        className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]"
      />
      <input
        type="text"
        aria-label={ariaLabel}
        placeholder={placeholder}
        className="input-field w-full py-2.5 pl-9 pr-12 text-sm sm:pr-18"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      <div className="absolute right-3 top-1/2 flex -translate-y-1/2 items-center gap-1.5">
        {resultCount !== undefined && (
          <span className="hidden text-xs text-[var(--text-muted)] sm:inline">
            {resultCount} 张
          </span>
        )}
        {value && (
          <button
            type="button"
            aria-label="清除卡牌搜索"
            onClick={() => onChange('')}
            className="rounded-full p-1 text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-overlay)] hover:text-[var(--text-primary)]"
          >
            <X size={14} />
          </button>
        )}
      </div>
    </div>
  );
}
