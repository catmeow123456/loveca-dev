/**
 * DeckAnalysisPanel - 卡组数据分析面板
 * 显示成员卡费用分布柱状图和 Blade Heart 效果统计图
 */

import { useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useGameStore } from '@/store/gameStore';
import { isMemberCardData, isLiveCardData } from '@game/domain/entities/card';
import { BladeHeartEffect, HeartColor } from '@game/shared/types/enums';
import type { DeckConfig } from '@game/domain/card-data/deck-loader';

interface DeckAnalysisPanelProps {
  deck: DeckConfig;
}

const HEART_COLOR_HEX: Record<HeartColor, string> = {
  [HeartColor.PINK]: '#f9a8d4',
  [HeartColor.RED]: '#f87171',
  [HeartColor.YELLOW]: '#fde047',
  [HeartColor.GREEN]: '#86efac',
  [HeartColor.BLUE]: '#60a5fa',
  [HeartColor.PURPLE]: '#c084fc',
  [HeartColor.RAINBOW]: '#fbbf24',
};

const HEART_COLOR_LABEL: Record<HeartColor, string> = {
  [HeartColor.PINK]: '粉',
  [HeartColor.RED]: '红',
  [HeartColor.YELLOW]: '黄',
  [HeartColor.GREEN]: '绿',
  [HeartColor.BLUE]: '蓝',
  [HeartColor.PURPLE]: '紫',
  [HeartColor.RAINBOW]: '虹',
};

interface BarDatum {
  label: string;
  value: number;
  color: string;
}

function BarChart({ data, emptyText = '暂无数据' }: { data: BarDatum[]; emptyText?: string }) {
  if (data.length === 0 || data.every(d => d.value === 0)) {
    return (
      <div className="flex h-14 items-center justify-center text-xs text-[var(--text-muted)]">
        {emptyText}
      </div>
    );
  }

  const maxValue = Math.max(...data.map(d => d.value), 1);
  const viewW = 440;
  const mL = 26, mR = 8, mT = 18, mB = 28;
  const innerW = viewW - mL - mR;
  const innerH = 80;
  const viewH = mT + innerH + mB;

  const barGroupW = innerW / data.length;
  const barW = Math.min(barGroupW * 0.6, 32);

  // 3 y-ticks at 0, half, max
  const yTicks = [0, Math.ceil(maxValue / 2), maxValue].filter(
    (v, i, arr) => arr.indexOf(v) === i
  );

  return (
    <svg width="100%" viewBox={`0 0 ${viewW} ${viewH}`} className="overflow-visible">
      {/* axes */}
      <line x1={mL} y1={mT} x2={mL} y2={mT + innerH} stroke="color-mix(in srgb, var(--border-default) 70%, transparent)" strokeWidth="1" />
      <line x1={mL} y1={mT + innerH} x2={mL + innerW} y2={mT + innerH} stroke="color-mix(in srgb, var(--border-default) 70%, transparent)" strokeWidth="1" />

      {/* y-axis ticks */}
      {yTicks.map(tick => {
        const y = mT + innerH - (tick / maxValue) * innerH;
        return (
          <g key={tick}>
            <line x1={mL - 3} y1={y} x2={mL} y2={y} stroke="color-mix(in srgb, var(--border-default) 70%, transparent)" strokeWidth="1" />
            <text x={mL - 5} y={y + 3.5} textAnchor="end" fontSize="8" fill="var(--text-muted)">
              {tick}
            </text>
          </g>
        );
      })}

      {/* bars */}
      {data.map((d, i) => {
        const barH = Math.max((d.value / maxValue) * innerH, d.value > 0 ? 2 : 0);
        const x = mL + i * barGroupW + (barGroupW - barW) / 2;
        const y = mT + innerH - barH;
        return (
          <g key={`${d.label}-${i}`}>
            <rect x={x} y={y} width={barW} height={barH} fill={d.color} fillOpacity={0.82} rx="2" />
            {d.value > 0 && (
              <text x={x + barW / 2} y={y - 3} textAnchor="middle" fontSize="8.5" fill="var(--text-secondary)">
                {d.value}
              </text>
            )}
            <text x={x + barW / 2} y={mT + innerH + 14} textAnchor="middle" fontSize="9" fill="var(--text-muted)">
              {d.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export function DeckAnalysisPanel({ deck }: DeckAnalysisPanelProps) {
  const { getCardData } = useGameStore(
    useShallow((s) => ({ getCardData: s.getCardData }))
  );

  const { costData, liveScoreData, bladeData } = useMemo(() => {
    // 费用分布（成员卡）
    const costMap = new Map<number, number>();
    for (const entry of deck.main_deck.members) {
      const card = getCardData(entry.card_code);
      if (card && isMemberCardData(card)) {
        costMap.set(card.cost, (costMap.get(card.cost) ?? 0) + entry.count);
      }
    }

    // 补全费用区间（0 到最大费用），保证 X 轴连续
    const maxCost = costMap.size > 0 ? Math.max(...costMap.keys()) : 0;
    const costData: BarDatum[] = [];
    for (let c = 0; c <= maxCost; c++) {
      costData.push({
        label: String(c),
        value: costMap.get(c) ?? 0,
        color: '#fb923c',
      });
    }

    // Live 分数分布
    const liveScoreMap = new Map<number, number>();
    for (const entry of deck.main_deck.lives) {
      const card = getCardData(entry.card_code);
      if (card && isLiveCardData(card)) {
        liveScoreMap.set(card.score, (liveScoreMap.get(card.score) ?? 0) + entry.count);
      }
    }

    const maxLiveScore = liveScoreMap.size > 0 ? Math.max(...liveScoreMap.keys()) : 0;
    const liveScoreData: BarDatum[] = [];
    for (let score = 0; score <= maxLiveScore; score++) {
      liveScoreData.push({
        label: String(score),
        value: liveScoreMap.get(score) ?? 0,
        color: '#38bdf8',
      });
    }

    // Blade Heart 效果统计（成员卡 + Live 卡）
    const effectCounts: Record<BladeHeartEffect, number> = {
      [BladeHeartEffect.DRAW]: 0,
      [BladeHeartEffect.HEART]: 0,
      [BladeHeartEffect.SCORE]: 0,
    };
    let noJudgmentCount = 0;
    const colorCounts = new Map<HeartColor, number>();

    const allEntries = [...deck.main_deck.members, ...deck.main_deck.lives];
    for (const entry of allEntries) {
      const card = getCardData(entry.card_code);
      if (!card || (!isMemberCardData(card) && !isLiveCardData(card))) continue;
      if (!card.bladeHearts || card.bladeHearts.length === 0) {
        noJudgmentCount += entry.count;
        continue;
      }
      for (const item of card.bladeHearts) {
        effectCounts[item.effect] += entry.count;
        if (item.effect === BladeHeartEffect.HEART && item.heartColor) {
          colorCounts.set(item.heartColor, (colorCounts.get(item.heartColor) ?? 0) + entry.count);
        }
      }
    }

    const colorBars: BarDatum[] = Array.from(colorCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([color, count]) => ({
        label: HEART_COLOR_LABEL[color],
        value: count,
        color: HEART_COLOR_HEX[color],
      }));

    const bladeData: BarDatum[] = [
      { label: '抽卡', value: effectCounts[BladeHeartEffect.DRAW], color: '#38bdf8' },
      { label: '加分', value: effectCounts[BladeHeartEffect.SCORE], color: '#fbbf24' },
      { label: '无判', value: noJudgmentCount, color: '#94a3b8' },
      ...colorBars,
    ];

    return { costData, liveScoreData, bladeData };
  }, [deck, getCardData]);

  return (
    <div className="no-scrollbar flex-1 space-y-4 overflow-y-auto p-3">
      {/* 费用分布 */}
      <section>
        <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-[var(--text-primary)]">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-[var(--accent-secondary)]" />
          成员卡费用分布
        </h4>
        <div className="surface-panel rounded-2xl border border-[var(--border-subtle)] px-2 py-1">
          <BarChart data={costData} emptyText="尚未添加成员卡" />
        </div>
        <p className="mt-1 text-right text-[10px] text-[var(--text-muted)]">X 轴：费用值 · Y 轴：张数</p>
      </section>

      {/* Live 分数分布 */}
      <section>
        <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-[var(--text-primary)]">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-sky-400" />
          LIVE 分数分布
        </h4>
        <div className="surface-panel rounded-2xl border border-[var(--border-subtle)] px-2 py-1">
          <BarChart data={liveScoreData} emptyText="尚未添加 Live 卡" />
        </div>
        <p className="mt-1 text-right text-[10px] text-[var(--text-muted)]">X 轴：分数值 · Y 轴：张数</p>
      </section>

      {/* Blade Heart 效果统计 */}
      <section>
        <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-[var(--text-primary)]">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-[var(--accent-primary)]" />
          Blade Heart 效果统计
        </h4>
        <div className="surface-panel rounded-2xl border border-[var(--border-subtle)] px-2 py-1">
          <BarChart data={bladeData} emptyText="卡组中暂无 Blade Heart 效果" />
        </div>
        <p className="mt-1 text-right text-[10px] text-[var(--text-muted)]">抽卡 · 加分 · 无判 · ♥各色</p>
      </section>
    </div>
  );
}
