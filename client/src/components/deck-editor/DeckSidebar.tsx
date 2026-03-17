/**
 * DeckSidebar - 卡组预览右侧面板
 */

import { Users, Music, Zap, AlertTriangle, CheckCircle } from 'lucide-react';
import { DeckSectionList } from './DeckSectionList';
import type { AnyCardData } from '@game/domain/entities/card';
import type { DeckConfig } from '@game/domain/card-data/deck-loader';

interface DeckSidebarProps {
  deck: DeckConfig;
  validation: { valid: boolean; errors: string[] };
  onAddCard: (card: AnyCardData) => void;
  onRemoveCard: (card: AnyCardData) => void;
  onViewDetail: (card: AnyCardData) => void;
}

export function DeckSidebar({ deck, validation, onAddCard, onRemoveCard, onViewDetail }: DeckSidebarProps) {
  const memberCount = deck.main_deck.members.reduce((sum, e) => sum + e.count, 0);
  const liveCount = deck.main_deck.lives.reduce((sum, e) => sum + e.count, 0);
  const energyCount = deck.energy_deck.reduce((sum, e) => sum + e.count, 0);

  return (
    <div className="h-full w-[480px] flex flex-col bg-gradient-to-b from-[#332c22] to-[#2a2420] border-l border-orange-300/10">
      {/* 紧凑统计汇总 */}
      <div className="px-4 py-3 border-b border-orange-300/10 bg-[#3d3020]/50">
        <div className="flex items-center justify-between text-xs">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-1.5">
              <Users size={12} className="text-orange-400" />
              <span className={memberCount === 48 ? 'text-green-300' : 'text-orange-300/70'}>
                {memberCount}/48
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <Music size={12} className="text-rose-400" />
              <span className={liveCount === 12 ? 'text-green-300' : 'text-orange-300/70'}>
                {liveCount}/12
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <Zap size={12} className="text-sky-400" />
              <span className={energyCount === 12 ? 'text-green-300' : 'text-orange-300/70'}>
                {energyCount}/12
              </span>
            </div>
          </div>
          <span className={`text-xs px-2 py-0.5 rounded-full border ${
            validation.valid
              ? 'bg-green-500/15 text-green-300 border-green-400/30'
              : 'bg-orange-500/15 text-orange-300 border-orange-400/30'
          }`}>
            {validation.valid ? '完整' : '未完成'}
          </span>
        </div>
      </div>

      {/* 卡牌列表 */}
      <div className="flex-1 overflow-y-auto p-3 no-scrollbar">
        <DeckSectionList
          entries={deck.main_deck.members}
          title="成员卡"
          expectedCount={48}
          accentColor="orange"
          onAddCard={onAddCard}
          onRemoveCard={onRemoveCard}
          onViewDetail={onViewDetail}
        />
        <DeckSectionList
          entries={deck.main_deck.lives}
          title="Live 卡"
          expectedCount={12}
          accentColor="rose"
          onAddCard={onAddCard}
          onRemoveCard={onRemoveCard}
          onViewDetail={onViewDetail}
        />
        <DeckSectionList
          entries={deck.energy_deck}
          title="能量卡"
          expectedCount={12}
          accentColor="sky"
          onAddCard={onAddCard}
          onRemoveCard={onRemoveCard}
          onViewDetail={onViewDetail}
        />

        {/* 验证错误 */}
        {validation.errors.length > 0 && (
          <div className="mt-3 p-3 bg-red-500/10 border border-red-400/20 rounded-xl">
            <div className="flex items-center gap-2 text-red-300 text-xs font-semibold mb-2">
              <AlertTriangle size={12} />
              <span>卡组不完整</span>
            </div>
            <ul className="space-y-1">
              {validation.errors.map((err, i) => (
                <li key={i} className="text-xs text-red-300/70 pl-4 relative before:content-['•'] before:absolute before:left-1 before:text-red-400/50">
                  {err}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* 验证成功 */}
        {validation.valid && (
          <div className="mt-3 p-3 bg-green-500/10 border border-green-400/20 rounded-xl">
            <div className="flex items-center gap-2 text-green-300 text-xs font-medium">
              <CheckCircle size={12} />
              <span>卡组完整！</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
