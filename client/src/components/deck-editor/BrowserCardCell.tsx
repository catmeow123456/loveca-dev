/**
 * BrowserCardCell - 卡牌网格中的单张卡牌
 * 点击卡图查看详情，底部 [-] 数量 [+] 始终可见
 *
 * baseCount: 同基础编号卡在卡组中的总数（遮罩数字）
 * exactCount: 这个精确编号的数量（+/- 中间的数字）
 */

import { memo } from 'react';
import { Plus, Minus } from 'lucide-react';
import { Card } from '@/components/card/Card';
import type { AnyCardData } from '@game/domain/entities/card';

interface BrowserCardCellProps {
  card: AnyCardData;
  imagePath: string;
  baseCount: number;
  exactCount: number;
  onAdd: () => void;
  onRemove: () => void;
  onViewDetail: () => void;
}

export const BrowserCardCell = memo(function BrowserCardCell({
  card, imagePath, baseCount, exactCount, onAdd, onRemove, onViewDetail,
}: BrowserCardCellProps) {
  return (
    <div className="flex flex-col items-center group/card">
      <div
        className="relative w-full cursor-pointer transition-[filter] duration-200 group-hover/card:brightness-110"
        style={{ aspectRatio: '63/88' }}
        onClick={onViewDetail}
      >
        <Card
          cardData={card}
          imagePath={imagePath}
          size="responsive"
          interactive={false}
          showHover={false}
          className="rounded-lg"
        />

        {/* 同类卡数量遮罩 */}
        {baseCount > 0 && (
          <div className="absolute inset-0 flex items-center justify-center rounded-lg bg-[color:color-mix(in_srgb,var(--semantic-info)_18%,transparent)] pointer-events-none">
            <span className="text-5xl font-bold text-[var(--semantic-info)] opacity-55 drop-shadow-md">
              {baseCount}
            </span>
          </div>
        )}

        {/* [-] 数量 [+] 固定在底部 */}
        <div
          className="absolute inset-x-0 bottom-0 z-10 flex items-center justify-center gap-1 rounded-b-lg bg-gradient-to-t from-black/75 via-black/35 to-transparent px-1 py-1.5"
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={exactCount > 0 ? onRemove : undefined}
            disabled={exactCount === 0}
            className={`flex h-8 w-8 items-center justify-center rounded-full shadow-sm sm:h-7 sm:w-7 ${
              exactCount > 0
                ? 'border border-white/15 bg-[var(--semantic-error)]/85 text-white'
                : 'cursor-default border border-white/10 bg-black/35 text-white/35'
            }`}
          >
            <Minus size={12} />
          </button>
          <span className="min-w-[24px] text-center text-xs font-bold text-white">
            {exactCount}
          </span>
          <button
            onClick={onAdd}
            className="flex h-8 w-8 items-center justify-center rounded-full border border-white/15 bg-[var(--semantic-success)]/85 text-white shadow-sm sm:h-7 sm:w-7"
          >
            <Plus size={12} />
          </button>
        </div>
      </div>

      <span
        className="mt-1.5 line-clamp-2 max-w-full text-center text-[11px] leading-snug text-[var(--text-muted)] sm:truncate sm:text-xs"
        title={card.cardCode}
      >
        {card.name}
      </span>
    </div>
  );
});
