import type { DeckAnalysis, DistributionBucket } from '@/lib/deckAnalysis';
import { HeartColor } from '@game/shared/types/enums';

const HEART_COLOR_HEX: Record<HeartColor, string> = {
  [HeartColor.PINK]: 'var(--heart-pink)',
  [HeartColor.RED]: 'var(--heart-red)',
  [HeartColor.YELLOW]: 'var(--heart-yellow)',
  [HeartColor.GREEN]: 'var(--heart-green)',
  [HeartColor.BLUE]: 'var(--heart-blue)',
  [HeartColor.PURPLE]: 'var(--heart-purple)',
  [HeartColor.ORANGE]: 'var(--heart-orange)',
  [HeartColor.GRAY]: 'var(--heart-gray)',
  [HeartColor.RAINBOW]: 'var(--heart-yellow)',
};

const HEART_COLOR_LABEL: Record<HeartColor, string> = {
  [HeartColor.PINK]: '粉',
  [HeartColor.RED]: '红',
  [HeartColor.YELLOW]: '黄',
  [HeartColor.GREEN]: '绿',
  [HeartColor.BLUE]: '蓝',
  [HeartColor.PURPLE]: '紫',
  [HeartColor.ORANGE]: '橙',
  [HeartColor.GRAY]: '无色',
  [HeartColor.RAINBOW]: '虹',
};

interface BarDatum {
  label: string;
  value: number;
  color: string;
}

function BarChart({
  data,
  label,
  emptyText = '暂无数据',
}: {
  data: BarDatum[];
  label: string;
  emptyText?: string;
}) {
  if (data.length === 0 || data.every((d) => d.value === 0)) {
    return (
      <div className="flex h-14 items-center justify-center text-xs text-[var(--text-muted)]">
        {emptyText}
      </div>
    );
  }

  const maxValue = Math.max(...data.map((d) => d.value), 1);
  const viewW = 320;
  const mL = 26,
    mR = 8,
    mT = 18,
    mB = 28;
  const innerW = viewW - mL - mR;
  const innerH = 80;
  const viewH = mT + innerH + mB;

  const barGroupW = innerW / data.length;
  const barW = Math.min(barGroupW * 0.6, 32);

  // 3 y-ticks at 0, half, max
  const yTicks = [0, Math.ceil(maxValue / 2), maxValue].filter((v, i, arr) => arr.indexOf(v) === i);

  return (
    <svg
      role="img"
      aria-label={label}
      width="100%"
      viewBox={`0 0 ${viewW} ${viewH}`}
      className="overflow-visible"
    >
      {/* axes */}
      <line
        x1={mL}
        y1={mT}
        x2={mL}
        y2={mT + innerH}
        stroke="color-mix(in srgb, var(--border-default) 70%, transparent)"
        strokeWidth="1"
      />
      <line
        x1={mL}
        y1={mT + innerH}
        x2={mL + innerW}
        y2={mT + innerH}
        stroke="color-mix(in srgb, var(--border-default) 70%, transparent)"
        strokeWidth="1"
      />

      {/* y-axis ticks */}
      {yTicks.map((tick) => {
        const y = mT + innerH - (tick / maxValue) * innerH;
        return (
          <g key={tick}>
            <line
              x1={mL - 3}
              y1={y}
              x2={mL}
              y2={y}
              stroke="color-mix(in srgb, var(--border-default) 70%, transparent)"
              strokeWidth="1"
            />
            <text x={mL - 5} y={y + 3.5} textAnchor="end" fontSize="11" fill="var(--text-muted)">
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
            <title>{`${d.label}：${d.value} 张`}</title>
            <rect x={x} y={y} width={barW} height={barH} fill={d.color} fillOpacity={0.82} rx="2" />
            {d.value > 0 && (
              <text
                x={x + barW / 2}
                y={y - 3}
                textAnchor="middle"
                fontSize="12.5"
                fill="var(--text-secondary)"
              >
                {d.value}
              </text>
            )}
            <text
              x={x + barW / 2}
              y={mT + innerH + 14}
              textAnchor="middle"
              fontSize="12"
              fill="var(--text-muted)"
            >
              {d.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export function DeckAnalysisCharts({
  analysis,
  sealed = false,
}: {
  analysis: DeckAnalysis;
  sealed?: boolean;
}) {
  const bars = (buckets: DistributionBucket[], color: string): BarDatum[] => {
    if (!buckets.length) return [];
    const counts = new Map(buckets.map((bucket) => [bucket.value, bucket.count]));
    return Array.from({ length: buckets.at(-1)!.value + 1 }, (_, value) => ({
      label: String(value),
      value: counts.get(value) ?? 0,
      color,
    }));
  };
  return (
    <div className="space-y-4">
      <section aria-label="成员卡费用统计">
        <h4 className="mb-2 text-xs font-semibold">成员卡费用分布</h4>
        <div className="surface-panel rounded-2xl border border-[var(--border-subtle)] px-2 py-1">
          <BarChart
            data={bars(analysis.costs, 'var(--accent-secondary)')}
            label="成员卡费用分布"
            emptyText="尚未选择成员卡"
          />
        </div>
        <p className="mt-1 text-xs text-[var(--text-secondary)]">
          共 {analysis.memberCount} 张 · 平均费用 {analysis.averageCost?.toFixed(1) ?? '—'}
          {analysis.unknownCostCount > 0 &&
            ` · ${analysis.unknownCostCount} 张费用未知，未计入均值`}
        </p>
      </section>
      <section aria-label="判定分布">
        <h4 className="mb-2 text-xs font-semibold">判定分布</h4>
        <div className="surface-panel rounded-2xl border border-[var(--border-subtle)] p-3">
          <div className="mb-2 flex justify-between text-[10px] text-[var(--text-muted)]">
            <span>类型</span>
            <span>卡牌张数 / 效果数量</span>
          </div>
          <ul className="space-y-2">
            {analysis.judgments.map((bucket) => {
              const color =
                bucket.kind === 'draw'
                  ? 'var(--semantic-info)'
                  : bucket.kind === 'score'
                    ? 'var(--semantic-warning)'
                    : bucket.kind === 'none'
                      ? 'var(--heart-gray)'
                      : HEART_COLOR_HEX[bucket.kind];
              const label =
                bucket.kind === 'draw'
                  ? '抽卡'
                  : bucket.kind === 'score'
                    ? '加分'
                    : bucket.kind === 'none'
                      ? '无判'
                      : `${HEART_COLOR_LABEL[bucket.kind]}心`;
              const unit = bucket.kind === 'draw' || bucket.kind === 'score' ? '次' : '心';
              const text = `${bucket.cards} 张${bucket.kind === 'none' ? '' : ` / ${bucket.effects} ${unit}`}`;
              return (
                <li key={bucket.kind} aria-label={`${label}：${text}`} className="text-xs">
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <span className="flex items-center gap-1.5">
                      <span className="h-1.5 w-1.5 rounded-full" style={{ background: color }} />
                      {label}
                    </span>
                    <span className="tabular-nums text-[var(--text-secondary)]">{text}</span>
                  </div>
                  <div
                    aria-hidden="true"
                    className="h-1 overflow-hidden rounded-full bg-[var(--bg-elevated)]"
                  >
                    <div
                      className="h-full rounded-full"
                      style={{
                        background: color,
                        width: `${(100 * bucket.cards) / Math.max(1, analysis.memberCount + analysis.liveCount)}%`,
                      }}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
          {!analysis.judgments.length && (
            <p className="text-xs text-[var(--text-muted)]">尚未加入卡牌</p>
          )}
        </div>
        <p className="mt-1 text-[10px] leading-relaxed text-[var(--text-muted)]">
          双心计 1 张、2 心；同一卡可计入多种判定。{sealed && '判定心保持原色。'}
        </p>
      </section>
      <section aria-label="Live 分数统计">
        <h4 className="mb-2 text-xs font-semibold">Live 分数分布 · {analysis.liveCount} 张</h4>
        <div className="surface-panel rounded-2xl border border-[var(--border-subtle)] px-2 py-1">
          <BarChart
            data={bars(analysis.scores, 'var(--semantic-info)')}
            label="Live 分数分布"
            emptyText="尚未加入 Live"
          />
        </div>
      </section>
      {sealed && (
        <section aria-label="Live 灰心需求统计">
          <h4 className="mb-2 text-xs font-semibold">Live 基础灰心需求</h4>
          <div className="surface-panel rounded-2xl border border-[var(--border-subtle)] px-2 py-1">
            <BarChart
              data={bars(analysis.requirements, 'var(--heart-gray)')}
              label="Live 基础灰心需求分布"
            />
          </div>
          <p className="mt-1 text-[10px] text-[var(--text-muted)]">
            按印刷需求转灰，不含对战中的卡效增减。
          </p>
        </section>
      )}
    </div>
  );
}
