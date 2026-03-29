/**
 * DeckSidebarEntry - 卡组侧边栏中的单张卡牌行
 */

import { Plus, Minus } from 'lucide-react';
import { Card } from '@/components/card/Card';
import type { AnyCardData } from '@game/domain/entities/card';

interface DeckSidebarEntryProps {
  cardData: AnyCardData;
  imagePath: string;
  count: number;
  onAdd: () => void;
  onRemove: () => void;
  onViewDetail: () => void;
}

export function DeckSidebarEntry({ cardData, imagePath, count, onAdd, onRemove, onViewDetail }: DeckSidebarEntryProps) {
  return (
    <div
      className="surface-panel flex items-center rounded-2xl p-2 transition-all duration-200 hover:-translate-y-[1px] hover:border-[var(--border-active)] hover:shadow-[var(--shadow-sm)]"
      onContextMenu={(e) => {
        e.preventDefault();
        onViewDetail();
      }}
    >
      {/* 缩略图 */}
      <div
        className="w-14 h-20 flex-shrink-0 mr-3 relative cursor-pointer"
        onClick={onViewDetail}
      >
        <Card
          cardData={cardData}
          imagePath={imagePath}
          size="responsive"
          interactive={false}
          showHover={false}
          className="rounded"
        />
      </div>

      {/* 卡名 & 编号 */}
      <div className="flex-1 min-w-0">
        <div className="truncate text-sm font-medium text-[var(--text-primary)]">
          {cardData.name}
        </div>
        <div className="truncate text-xs text-[var(--text-muted)]">
          {cardData.cardCode}
        </div>
      </div>

      {/* 常驻 +/- 按钮 & 数量 */}
      <div className="flex items-center gap-1 ml-2 flex-shrink-0">
        <button
          onClick={onRemove}
          className="flex h-6 w-6 items-center justify-center rounded-full border border-[var(--semantic-error)]/25 bg-[var(--semantic-error)]/12 text-[var(--semantic-error)]"
        >
          <Minus size={12} />
        </button>
        <span className="min-w-[20px] text-center text-sm font-bold text-[var(--text-primary)]">{count}</span>
        <button
          onClick={onAdd}
          className="flex h-6 w-6 items-center justify-center rounded-full border border-[var(--semantic-success)]/25 bg-[var(--semantic-success)]/12 text-[var(--semantic-success)]"
        >
          <Plus size={12} />
        </button>
      </div>
    </div>
  );
}
