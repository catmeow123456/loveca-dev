/**
 * DeckSidebar - 卡组预览右侧面板
 */

import { useState } from 'react';
import { Users, Music, Zap, AlertTriangle, CheckCircle, BarChart2, List } from 'lucide-react';
import { DeckSectionList } from './DeckSectionList';
import { DeckAnalysisPanel } from './DeckAnalysisPanel';
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
  const [showAnalysis, setShowAnalysis] = useState(false);
  const memberCount = deck.main_deck.members.reduce((sum, e) => sum + e.count, 0);
  const liveCount = deck.main_deck.lives.reduce((sum, e) => sum + e.count, 0);
  const energyCount = deck.energy_deck.reduce((sum, e) => sum + e.count, 0);

  return (
    <div className="workspace-sidebar flex h-full w-[480px] flex-col">
      <div className="workspace-toolbar px-4 py-3">
        <div className="flex items-center justify-between text-xs">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-1.5">
              <Users size={12} className="text-[var(--accent-primary)]" />
              <span className={memberCount === 48 ? 'text-[var(--semantic-success)]' : 'text-[var(--text-secondary)]'}>
                {memberCount}/48
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <Music size={12} className="text-[var(--heart-pink)]" />
              <span className={liveCount === 12 ? 'text-[var(--semantic-success)]' : 'text-[var(--text-secondary)]'}>
                {liveCount}/12
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <Zap size={12} className="text-[var(--heart-blue)]" />
              <span className={energyCount === 12 ? 'text-[var(--semantic-success)]' : 'text-[var(--text-secondary)]'}>
                {energyCount}/12
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className={`rounded-full border px-2 py-0.5 text-xs ${
              validation.valid
                ? 'border-[color:color-mix(in_srgb,var(--semantic-success)_35%,transparent)] bg-[color:color-mix(in_srgb,var(--semantic-success)_14%,transparent)] text-[var(--semantic-success)]'
                : 'border-[color:color-mix(in_srgb,var(--accent-secondary)_35%,transparent)] bg-[color:color-mix(in_srgb,var(--accent-secondary)_14%,transparent)] text-[var(--accent-secondary)]'
            }`}>
              {validation.valid ? '完整' : '未完成'}
            </span>
            <button
              onClick={() => setShowAnalysis(v => !v)}
              className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs transition-colors duration-150 ${
                showAnalysis
                  ? 'border-[color:color-mix(in_srgb,var(--accent-primary)_40%,transparent)] bg-[color:color-mix(in_srgb,var(--accent-primary)_14%,transparent)] text-[var(--text-primary)]'
                  : 'border-[var(--border-subtle)] bg-[color:color-mix(in_srgb,var(--bg-surface)_72%,transparent)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--border-default)]'
              }`}
            >
              {showAnalysis ? <List size={11} /> : <BarChart2 size={11} />}
              <span>{showAnalysis ? '卡牌列表' : '数据分析'}</span>
            </button>
          </div>
        </div>
      </div>

      {/* 内容区：卡牌列表 / 数据分析 */}
      {showAnalysis ? (
        <DeckAnalysisPanel deck={deck} />
      ) : (
        <div className="no-scrollbar flex-1 overflow-y-auto p-3">
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
            <div className="mt-3 rounded-xl border border-[color:color-mix(in_srgb,var(--semantic-error)_35%,transparent)] bg-[color:color-mix(in_srgb,var(--semantic-error)_12%,transparent)] p-3">
              <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-[var(--semantic-error)]">
                <AlertTriangle size={12} />
                <span>卡组不完整</span>
              </div>
              <ul className="space-y-1">
                {validation.errors.map((err, i) => (
                  <li key={i} className="relative pl-4 text-xs text-[var(--semantic-error)]/80 before:absolute before:left-1 before:content-['•'] before:text-[var(--semantic-error)]/60">
                    {err}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* 验证成功 */}
          {validation.valid && (
            <div className="mt-3 rounded-xl border border-[color:color-mix(in_srgb,var(--semantic-success)_35%,transparent)] bg-[color:color-mix(in_srgb,var(--semantic-success)_12%,transparent)] p-3">
              <div className="flex items-center gap-2 text-xs font-medium text-[var(--semantic-success)]">
                <CheckCircle size={12} />
                <span>卡组完整！</span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
