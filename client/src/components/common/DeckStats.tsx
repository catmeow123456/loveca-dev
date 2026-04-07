/**
 * DeckStats - 卡组统计组件
 * 显示卡组的成员卡、Live卡、能量卡数量统计
 */

import { Check, Cloud, Database, Layers3, Star, UserRound, Zap } from 'lucide-react';
import type { DeckRecord } from '@/lib/apiClient';
import { calculateDeckPointTotal, DECK_POINT_LIMIT } from '@game/domain/rules/deck-construction';

// 卡组统计数据
export interface DeckStatsData {
  memberCount: number;
  liveCount: number;
  energyCount: number;
  pointTotal: number;
}

// 从云端卡组计算统计数据
export function calculateDeckStats(deck: DeckRecord): DeckStatsData {
  const mainDeck = deck.main_deck || [];
  let memberCount = 0;
  let liveCount = 0;
  
  for (const entry of mainDeck) {
    // 使用 card_type 字段判断卡牌类型
    if (entry.card_type === 'LIVE') {
      liveCount += entry.count;
    } else if (entry.card_type === 'MEMBER') {
      memberCount += entry.count;
    }
    // 忽略没有 card_type 的旧数据
  }
  
  const energyCount = (deck.energy_deck || []).reduce((sum, e) => sum + e.count, 0);
  const pointTotal = calculateDeckPointTotal([...mainDeck, ...(deck.energy_deck || [])]);
  
  return { memberCount, liveCount, energyCount, pointTotal };
}

export function isDeckStatsValid(stats: DeckStatsData): boolean {
  return (
    stats.memberCount === 48 &&
    stats.liveCount === 12 &&
    stats.energyCount === 12 &&
    stats.pointTotal <= DECK_POINT_LIMIT
  );
}

export function getDeckPointTextClass(pointTotal: number): string {
  return pointTotal > DECK_POINT_LIMIT ? 'text-[var(--semantic-error)]' : 'text-[var(--text-secondary)]';
}

// 格式化时间的辅助函数
export function formatRelativeTime(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes} 分钟前`;
  if (hours < 24) return `${hours} 小时前`;
  if (days < 7) return `${days} 天前`;
  return d.toLocaleDateString('zh-CN');
}

// 统计行组件 Props
interface DeckStatsRowProps {
  stats: DeckStatsData;
  /** 是否显示最大值（默认为 true） */
  showMax?: boolean;
  /** 自定义样式 */
  className?: string;
  /** 尺寸：sm | md */
  size?: 'sm' | 'md';
  /** 是否显示时间 */
  updatedAt?: Date | string;
}

/**
 * DeckStatsRow - 卡组统计行组件
 * 显示成员卡、Live卡、能量卡数量
 */
export function DeckStatsRow({ 
  stats, 
  showMax = true, 
  className = '', 
  size = 'sm',
  updatedAt,
}: DeckStatsRowProps) {
  const textSize = size === 'sm' ? 'text-xs' : 'text-sm';
  const gapSize = size === 'sm' ? 'gap-4' : 'gap-5';
  
  return (
    <div className={`flex flex-wrap items-center ${gapSize} ${textSize} ${className}`}>
      <div className="flex items-center gap-1.5 text-[var(--text-secondary)]">
        <UserRound size={size === 'sm' ? 12 : 14} />
        <span>{stats.memberCount}{showMax && '/48'}</span>
      </div>
      <div className="flex items-center gap-1.5 text-[var(--text-secondary)]">
        <Layers3 size={size === 'sm' ? 12 : 14} />
        <span>{stats.liveCount}{showMax && '/12'}</span>
      </div>
      <div className="flex items-center gap-1.5 text-[var(--text-secondary)]">
        <Zap size={size === 'sm' ? 12 : 14} />
        <span>{stats.energyCount}{showMax && '/12'}</span>
      </div>
      <div className={`flex items-center gap-1.5 ${getDeckPointTextClass(stats.pointTotal)}`}>
        <Star size={size === 'sm' ? 12 : 14} />
        <span>{stats.pointTotal}{showMax && `/${DECK_POINT_LIMIT}`}pt</span>
      </div>
      {updatedAt && (
        <>
          <div className="hidden min-[480px]:flex-1" />
          <div className="w-full text-[var(--text-muted)] min-[480px]:w-auto">
            {formatRelativeTime(updatedAt)}
          </div>
        </>
      )}
    </div>
  );
}

// 完整性指示器组件 Props
interface DeckValidityBadgeProps {
  stats: DeckStatsData;
  /** 自定义样式 */
  className?: string;
}

/**
 * DeckValidityBadge - 卡组完整性徽章
 * 显示卡组是否完整（48+12+12）
 */
export function DeckValidityBadge({ stats, className = '' }: DeckValidityBadgeProps) {
  const isValid = isDeckStatsValid(stats);
  
  return isValid ? (
    <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 bg-green-500/20 text-green-300 rounded-full border border-green-400/30 ${className}`}>
      <Check size={11} /> 完整
    </span>
  ) : (
    <span className={`text-xs px-2 py-0.5 bg-red-500/20 text-red-300 rounded-full border border-red-400/30 ${className}`}>
      ○ 不完整
    </span>
  );
}

// 完整的卡组卡片组件 Props
interface DeckCardProps {
  name: string;
  description?: string;
  stats: DeckStatsData;
  isCloud?: boolean;
  isValid?: boolean;
  updatedAt?: Date | string;
  isSelected?: boolean;
  onClick?: () => void;
  /** 自定义操作按钮 */
  actions?: React.ReactNode;
}

/**
 * DeckCard - 卡组卡片组件
 * 完整的卡组信息展示卡片
 */
export function DeckCard({
  name,
  description,
  stats,
  isCloud = true,
  isValid,
  updatedAt,
  isSelected = false,
  onClick,
  actions,
}: DeckCardProps) {
  const validity = isValid ?? (
    isDeckStatsValid(stats)
  );

  const CardContent = (
    <>
      {/* Top Row */}
      <div className="flex items-start justify-between mb-2">
        <div className="flex items-center gap-2">
          {isSelected && (
            <Check size={14} className="text-[var(--accent-primary)]" />
          )}
          <h3 className={`font-bold ${
            isSelected ? 'text-orange-200' : 'text-orange-100'
          }`}>
            {name}
          </h3>
        </div>
        <div className="flex items-center gap-2">
          {isCloud ? (
            <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 bg-blue-500/20 text-blue-300 rounded-full border border-blue-400/30">
              <Cloud size={11} /> 云端
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 bg-gray-500/20 text-gray-300 rounded-full border border-gray-400/30">
              <Database size={11} /> 本地
            </span>
          )}
          {validity ? (
            <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 bg-green-500/20 text-green-300 rounded-full border border-green-400/30">
              <Check size={11} /> 完整
            </span>
          ) : (
            <span className="text-xs px-2 py-0.5 bg-red-500/20 text-red-300 rounded-full border border-red-400/30">
              ○ 不完整
            </span>
          )}
        </div>
      </div>

      {/* Description */}
      {description && (
        <p className="text-sm text-orange-300/60 mb-3 line-clamp-2">
          {description}
        </p>
      )}

      {/* Stats Row */}
      <div className="flex items-center justify-between">
        <DeckStatsRow stats={stats} updatedAt={updatedAt} />
        {actions && (
          <div className="flex items-center gap-2">
            {actions}
          </div>
        )}
      </div>
    </>
  );

  if (onClick) {
    return (
      <button
        onClick={onClick}
        className={`w-full text-left p-4 rounded-xl transition-all duration-300 border ${
          isSelected
            ? 'bg-gradient-to-r from-orange-500/20 to-amber-500/20 border-orange-400/50 shadow-lg shadow-orange-500/10'
            : 'bg-[#3d3020]/60 border-transparent hover:bg-orange-500/10 hover:border-orange-300/30'
        }`}
      >
        {CardContent}
      </button>
    );
  }

  return (
    <div className={`p-4 rounded-xl border ${
      isSelected
        ? 'bg-gradient-to-r from-orange-500/20 to-amber-500/20 border-orange-400/50 shadow-lg shadow-orange-500/10'
        : 'bg-[#3d3020]/60 border-orange-300/20'
    }`}>
      {CardContent}
    </div>
  );
}
