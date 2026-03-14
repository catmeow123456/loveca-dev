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
      className="flex items-center bg-[#3d3020]/50 hover:bg-orange-500/10 rounded-xl p-2 transition-all duration-200 border border-transparent hover:border-orange-300/15"
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
        <div className="text-sm font-medium truncate text-orange-100">
          {cardData.name}
        </div>
        <div className="text-xs text-orange-300/40 truncate">
          {cardData.cardCode}
        </div>
      </div>

      {/* 常驻 +/- 按钮 & 数量 */}
      <div className="flex items-center gap-1 ml-2 flex-shrink-0">
        <button
          onClick={onRemove}
          className="w-6 h-6 flex items-center justify-center rounded-full bg-red-500/15 text-red-300/70 border border-red-400/20"
        >
          <Minus size={12} />
        </button>
        <span className="text-sm font-bold text-orange-200 min-w-[20px] text-center">{count}</span>
        <button
          onClick={onAdd}
          className="w-6 h-6 flex items-center justify-center rounded-full bg-green-500/15 text-green-300/70 border border-green-400/20"
        >
          <Plus size={12} />
        </button>
      </div>
    </div>
  );
}
