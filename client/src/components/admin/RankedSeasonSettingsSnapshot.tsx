import type { ReactNode } from 'react';
import type { RankedAdminSeason } from '@/lib/rankedAdminClient';
import { formatRankedOpenWindows } from '@/lib/rankedOpenWindows';

export function RankedSeasonSettingsSnapshot({ season }: { season: RankedAdminSeason }) {
  const rating = season.ratingConfig;
  const isArchived = season.lifecycle === 'CLOSED';

  return (
    <section
      id={`ranked-season-settings-${season.id}`}
      className="mt-4 overflow-hidden rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-subtle)]"
      aria-label={`${season.name}赛季设置`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--border-subtle)] px-4 py-3">
        <div>
          <h3 className="text-sm font-semibold text-[var(--text-primary)]">
            {isArchived ? '赛季封存配置' : '赛季配置快照'}
          </h3>
          <p className="mt-1 text-xs leading-5 text-[var(--text-muted)]">
            {isArchived
              ? '赛季已结束，以下为最终保存的只读设置。'
              : '以下为当前保存的设置；请使用对应管理操作进行修改。'}
          </p>
        </div>
        <span className="rounded-full bg-[var(--bg-overlay)] px-2.5 py-1 text-xs font-semibold text-[var(--text-muted)]">
          只读
        </span>
      </div>

      <div className="grid gap-px bg-[var(--border-subtle)] lg:grid-cols-3">
        <SnapshotGroup title="赛程与开放">
          <SnapshotItem label="赛季标识" value={season.seasonKey} mono />
          <SnapshotItem label="赛季状态" value={lifecycleLabel(season.lifecycle)} />
          <SnapshotItem
            label="匹配开关"
            value={season.queueAdmission === 'OPEN' ? '开放' : '暂停'}
          />
          <SnapshotItem label="平台时区" value={season.platformTimeZone} mono />
          <SnapshotItem
            label="开始时间"
            value={formatSeasonDate(season.startsAt, season.platformTimeZone)}
          />
          <SnapshotItem
            label="计划结束"
            value={formatSeasonDate(season.scheduledEndsAt, season.platformTimeZone)}
          />
          <SnapshotItem
            label="最晚结算"
            value={formatSeasonDate(season.finalizingDeadlineAt, season.platformTimeZone)}
          />
          <SnapshotItem
            label="实际关闭"
            value={
              season.closedAt
                ? formatSeasonDate(season.closedAt, season.platformTimeZone)
                : '尚未关闭'
            }
          />
          <SnapshotItem label="开放时段" value={formatRankedOpenWindows(season.openWindows)} wide />
        </SnapshotGroup>

        <SnapshotGroup title="排行榜与积分">
          <SnapshotItem
            label="进入排行榜门槛"
            value={`${season.leaderboardMinimumMatchCount} 场`}
          />
          <SnapshotItem label="评分算法" value={season.ratingAlgorithmVersion} mono />
          <SnapshotItem label="配置算法身份" value={rating.algorithmVersion} mono />
          <SnapshotItem label="Rating Scale" value={formatNumber(rating.ratingScale)} />
          <SnapshotItem label="初始积分" value={formatNumber(rating.initialRating)} />
          <SnapshotItem label="初始 RD" value={formatNumber(rating.initialRatingDeviation)} />
          <SnapshotItem label="最低 RD" value={formatNumber(rating.minimumRatingDeviation)} />
          <SnapshotItem label="最高 RD" value={formatNumber(rating.maximumRatingDeviation)} />
          <SnapshotItem label="定级场次" value={`${rating.placementMatchCount} 场`} />
          <SnapshotItem
            label="参数来源"
            value={rating.parameterRevision ? '赛季内参数修订' : '赛季初始冻结参数'}
          />
          {rating.parameterRevision ? (
            <SnapshotItem
              label="当前参数修订 ID"
              value={rating.parameterRevision.revisionId}
              mono
              wide
            />
          ) : null}
        </SnapshotGroup>

        <SnapshotGroup title="重置与成长补偿">
          <SnapshotItem label="新赛季积分重置" value={softResetModeLabel(rating.softResetMode)} />
          <SnapshotItem label="重置中心值" value={formatNumber(rating.softResetCenter)} />
          <SnapshotItem
            label="原积分保留比例"
            value={formatPercentage(rating.softResetRetention)}
          />
          <SnapshotItem
            label="重置后最小 RD"
            value={formatNumber(rating.softResetMinimumDeviation)}
          />
          <SnapshotItem
            label="成长补偿"
            value={
              rating.growthPool ? (rating.growthPool.enabled ? '启用' : '关闭') : '此算法不使用'
            }
          />
          {rating.growthPool ? (
            <>
              <SnapshotItem label="成长补偿模式" value={growthModeLabel(rating.growthPool.mode)} />
              <SnapshotItem
                label="成长基准分"
                value={formatNumber(rating.growthPool.centerRating)}
              />
              <SnapshotItem
                label="单局最大注入/回收"
                value={formatNumber(rating.growthPool.maximumTotalAdjustment)}
              />
              <SnapshotItem
                label="高分局胜方回收比例"
                value={formatPercentage(rating.growthPool.negativeWinnerShare)}
              />
              <SnapshotItem
                label="正向调整分配"
                value={positiveSplitModeLabel(rating.growthPool.positiveSplitMode)}
              />
              <SnapshotItem
                label="过渡宽度"
                value={formatNumber(rating.growthPool.transitionWidth)}
              />
            </>
          ) : null}
        </SnapshotGroup>
      </div>

      <div className="border-t border-[var(--border-subtle)] px-4 py-3">
        <h4 className="text-xs font-semibold tracking-wide text-[var(--text-secondary)]">
          冻结环境与审计身份
        </h4>
        <dl className="mt-3 grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
          <SnapshotItem label="规则版本" value={season.rulesVersion} mono />
          <SnapshotItem label="卡牌目录版本" value={season.cardCatalogVersion} mono />
          <SnapshotItem label="卡组政策版本" value={season.deckPolicyVersion} mono />
          <SnapshotItem label="积分流水修订" value={String(season.ledgerRevision)} />
          {rating.parameterRevision ? (
            <>
              <SnapshotItem
                label="修订基础算法"
                value={rating.parameterRevision.baseAlgorithmVersion}
                mono
              />
              <SnapshotItem
                label="修订前软重置"
                value={formatSourceSoftReset(rating.parameterRevision)}
                wide
              />
            </>
          ) : null}
          <SnapshotItem label="竞技环境 ID" value={season.competitiveEnvironmentId} mono wide />
          <SnapshotItem label="卡牌目录哈希" value={season.cardCatalogHash} mono wide />
        </dl>
      </div>

      <div className="border-t border-[var(--border-subtle)] px-4 py-3">
        <h4 className="text-xs font-semibold tracking-wide text-[var(--text-secondary)]">
          赛季公告
        </h4>
        <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-[var(--text-secondary)]">
          {season.announcement || '未设置赛季公告'}
        </p>
      </div>
    </section>
  );
}

function SnapshotGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="bg-[var(--bg-surface)] p-4">
      <h4 className="text-xs font-semibold tracking-wide text-[var(--text-secondary)]">{title}</h4>
      <dl className="mt-3 grid gap-x-4 gap-y-3 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
        {children}
      </dl>
    </section>
  );
}

function SnapshotItem({
  label,
  value,
  mono = false,
  wide = false,
}: {
  label: string;
  value: ReactNode;
  mono?: boolean;
  wide?: boolean;
}) {
  return (
    <div className={wide ? 'sm:col-span-2 lg:col-span-1 xl:col-span-2' : undefined}>
      <dt className="text-[11px] text-[var(--text-muted)]">{label}</dt>
      <dd
        className={`mt-0.5 break-words text-sm text-[var(--text-primary)] ${mono ? 'font-mono text-xs' : ''}`}
      >
        {value}
      </dd>
    </div>
  );
}

function lifecycleLabel(value: RankedAdminSeason['lifecycle']): string {
  return { DRAFT: '未开始', ACTIVE: '开放中', FINALIZING: '结算中', CLOSED: '已结束' }[value];
}

function softResetModeLabel(value: RankedAdminSeason['ratingConfig']['softResetMode']): string {
  return value === 'RESET_TO_INITIAL' ? '重置为默认值' : '向中心值保留';
}

function growthModeLabel(
  value: NonNullable<RankedAdminSeason['ratingConfig']['growthPool']>['mode']
): string {
  return value === 'POST_PLACEMENT_AVERAGE_CENTERED' ? '定级后按对局均值调节' : value;
}

function positiveSplitModeLabel(
  value: NonNullable<RankedAdminSeason['ratingConfig']['growthPool']>['positiveSplitMode']
): string {
  return value === 'EQUAL' ? '双方等分' : value;
}

function formatSourceSoftReset(
  revision: NonNullable<RankedAdminSeason['ratingConfig']['parameterRevision']>
): string {
  return `${softResetModeLabel(revision.sourceSoftResetMode)} · 中心 ${formatNumber(revision.sourceSoftResetCenter)} · 保留 ${formatPercentage(revision.sourceSoftResetRetention)} · 最小 RD ${formatNumber(revision.sourceSoftResetMinimumDeviation)}`;
}

function formatSeasonDate(value: string, timeZone: string): string {
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(value));
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 }).format(value);
}

function formatPercentage(value: number): string {
  return new Intl.NumberFormat('zh-CN', {
    style: 'percent',
    maximumFractionDigits: 2,
  }).format(value);
}
