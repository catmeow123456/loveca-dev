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
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none bg-blue-500/25 rounded-lg">
            <span className="text-blue-100 text-5xl font-bold opacity-50 drop-shadow-md">
              {baseCount}
            </span>
          </div>
        )}

        {/* [-] 数量 [+] 固定在底部 */}
        <div
          className="absolute bottom-0 inset-x-0 z-10 flex items-center justify-center gap-1 py-1 bg-gradient-to-t from-black/60 to-transparent rounded-b-lg"
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={exactCount > 0 ? onRemove : undefined}
            disabled={exactCount === 0}
            className={`w-6 h-6 flex items-center justify-center rounded-full shadow-sm ${
              exactCount > 0
                ? 'bg-red-500/80 text-white'
                : 'bg-gray-500/40 text-gray-400 cursor-default'
            }`}
          >
            <Minus size={12} />
          </button>
          <span className="text-white text-xs font-bold min-w-[20px] text-center">
            {exactCount}
          </span>
          <button
            onClick={onAdd}
            className="w-6 h-6 flex items-center justify-center rounded-full bg-green-500/80 text-white shadow-sm"
          >
            <Plus size={12} />
          </button>
        </div>
      </div>

      <span
        className="mt-1.5 text-xs text-orange-300/50 truncate max-w-full"
        title={card.cardCode}
      >
        {card.name}
      </span>
    </div>
  );
});
