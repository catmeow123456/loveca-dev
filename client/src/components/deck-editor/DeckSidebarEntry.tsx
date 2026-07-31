/**
 * DeckSidebarEntry - 卡组侧边栏中的单张卡牌行
 */

import { Plus, Minus } from 'lucide-react';
import { Card } from '@/components/card/Card';
import { getCardLocalizedInfo } from '@/lib/cardLocalization';
import type { AnyCardData } from '@game/domain/entities/card';

interface DeckSidebarEntryProps {
  cardData: AnyCardData;
  imagePath: string;
  count: number;
  onAdd: () => void;
  onRemove: () => void;
  onViewDetail: () => void;
}

export function DeckSidebarEntry({
  cardData,
  imagePath,
  count,
  onAdd,
  onRemove,
  onViewDetail,
}: DeckSidebarEntryProps) {
  const localizedName = getCardLocalizedInfo(cardData);

  return (
    <div
      className="flex items-center border-b border-[var(--border-subtle)] px-1 py-2 transition-colors duration-150 last:border-b-0 hover:bg-[var(--bg-overlay)]"
      onContextMenu={(e) => {
        e.preventDefault();
        onViewDetail();
      }}
    >
      {/* 缩略图 */}
      <button
        type="button"
        className="relative mr-3 h-20 w-14 flex-shrink-0 cursor-pointer"
        onClick={onViewDetail}
        aria-label={`查看 ${localizedName.displayNameCn} 详情`}
      >
        <Card
          cardData={cardData}
          imagePath={imagePath}
          size="responsive"
          interactive={false}
          showHover={false}
          className="rounded"
        />
      </button>

      {/* 卡名 & 编号 */}
      <div className="flex-1 min-w-0">
        <div
          className="truncate text-sm font-medium text-[var(--text-primary)]"
          title={localizedName.title}
        >
          {localizedName.displayNameCn}
        </div>
        {localizedName.nameJp && (
          <div className="truncate text-xs text-[var(--text-muted)]">{localizedName.nameJp}</div>
        )}
        <div className="truncate text-xs text-[var(--text-muted)]">{cardData.cardCode}</div>
      </div>

      {/* 常驻 +/- 按钮 & 数量 */}
      <div className="flex items-center gap-1 ml-2 flex-shrink-0">
        <button
          type="button"
          onClick={onRemove}
          className="flex h-6 w-6 items-center justify-center rounded-full border border-[var(--semantic-error)]/25 bg-[var(--semantic-error)]/12 text-[var(--semantic-error)]"
          aria-label={`从卡组移除 ${localizedName.displayNameCn}`}
        >
          <Minus size={12} />
        </button>
        <span className="min-w-[20px] text-center text-sm font-bold text-[var(--text-primary)]">
          {count}
        </span>
        <button
          type="button"
          onClick={onAdd}
          className="flex h-6 w-6 items-center justify-center rounded-full border border-[var(--semantic-success)]/25 bg-[var(--semantic-success)]/12 text-[var(--semantic-success)]"
          aria-label={`向卡组添加 ${localizedName.displayNameCn}`}
        >
          <Plus size={12} />
        </button>
      </div>
    </div>
  );
}
