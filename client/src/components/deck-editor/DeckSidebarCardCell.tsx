/**
 * DeckSidebarCardCell - 卡组预览网格中的单张卡牌
 * 紧凑版卡片单元，显示卡图、数量遮罩和 +/- 控制
 */

import { memo } from 'react';
import { Plus, Minus } from 'lucide-react';
import { Card } from '@/components/card/Card';
import type { AnyCardData } from '@game/domain/entities/card';

interface DeckSidebarCardCellProps {
  cardData: AnyCardData;
  imagePath: string;
  count: number;
  onAdd: () => void;
  onRemove: () => void;
  onViewDetail: () => void;
}

export const DeckSidebarCardCell = memo(function DeckSidebarCardCell({
  cardData, imagePath, count, onAdd, onRemove, onViewDetail,
}: DeckSidebarCardCellProps) {
  return (
    <div
      className="relative w-full cursor-pointer transition-[filter] duration-200 hover:brightness-110"
      style={{ aspectRatio: '63/88' }}
      onClick={onViewDetail}
      onContextMenu={(e) => { e.preventDefault(); onViewDetail(); }}
    >
      <Card
        cardData={cardData}
        imagePath={imagePath}
        size="responsive"
        interactive={false}
        showHover={false}
        className="rounded"
      />

      {/* 数量遮罩 */}
      {count > 0 && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none bg-blue-500/20 rounded">
          <span className="text-blue-100 text-2xl font-bold opacity-60 drop-shadow-md">
            {count}
          </span>
        </div>
      )}

      {/* [-] 数量 [+] 固定在底部 */}
      <div
        className="absolute bottom-0 inset-x-0 z-10 flex items-center justify-center gap-0.5 py-0.5 bg-gradient-to-t from-black/70 to-transparent rounded-b"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={count > 0 ? onRemove : undefined}
          disabled={count === 0}
          className={`w-5 h-5 flex items-center justify-center rounded-full shadow-sm ${
            count > 0
              ? 'bg-red-500/80 text-white'
              : 'bg-gray-500/40 text-gray-400 cursor-default'
          }`}
        >
          <Minus size={10} />
        </button>
        <span className="text-white text-xs font-bold min-w-[14px] text-center">
          {count}
        </span>
        <button
          onClick={onAdd}
          className="w-5 h-5 flex items-center justify-center rounded-full bg-green-500/80 text-white shadow-sm"
        >
          <Plus size={10} />
        </button>
      </div>
    </div>
  );
});
