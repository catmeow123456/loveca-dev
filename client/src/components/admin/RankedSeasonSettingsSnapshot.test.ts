import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { RankedAdminSeason } from '@/lib/rankedAdminClient';
import { SeasonPanel } from './RankedAdminPage';
import { RankedSeasonSettingsSnapshot } from './RankedSeasonSettingsSnapshot';

const CLOSED_SEASON: RankedAdminSeason = {
  id: '11111111-1111-4111-8111-111111111111',
  seasonKey: 'ranked-2026-summer',
  name: '2026 夏季赛',
  announcement: '赛季公告\n第二行',
  lifecycle: 'CLOSED',
  queueAdmission: 'PAUSED',
  competitiveEnvironmentId: 'sha256:frozen-environment',
  platformTimeZone: 'Asia/Shanghai',
  openWindows: [{ weekdays: [6, 7], startMinute: 1200, endMinute: 1380 }],
  startsAt: '2026-07-01T00:00:00.000Z',
  scheduledEndsAt: '2026-08-01T00:00:00.000Z',
  finalizingDeadlineAt: '2026-08-03T00:00:00.000Z',
  closedAt: '2026-08-02T10:00:00.000Z',
  rulesVersion: 'RULES_V5',
  cardCatalogVersion: 'CATALOG_2026_07',
  cardCatalogHash: 'sha256:frozen-catalog',
  deckPolicyVersion: 'DECK_POLICY_V2',
  ratingAlgorithmVersion: 'GLICKO1_PER_MATCH_V4',
  ratingConfig: {
    algorithmVersion: 'GLICKO1_PER_MATCH_V4',
    ratingScale: 800,
    initialRating: 1600,
    initialRatingDeviation: 300,
    minimumRatingDeviation: 80,
    maximumRatingDeviation: 350,
    placementMatchCount: 12,
    softResetMode: 'RETAIN_TOWARD_CENTER',
    softResetCenter: 1600,
    softResetRetention: 0.25,
    softResetMinimumDeviation: 220,
    growthPool: {
      mode: 'POST_PLACEMENT_AVERAGE_CENTERED',
      enabled: true,
      centerRating: 1800,
      maximumTotalAdjustment: 16,
      transitionWidth: 250,
      positiveSplitMode: 'EQUAL',
      negativeWinnerShare: 0.75,
    },
    parameterRevision: {
      mode: 'ADMIN_SEASON_RECALCULATION',
      revisionId: '22222222-2222-4222-8222-222222222222',
      baseAlgorithmVersion: 'GLICKO1_PER_MATCH_V4',
      sourceSoftResetMode: 'RETAIN_TOWARD_CENTER',
      sourceSoftResetCenter: 1600,
      sourceSoftResetRetention: 0.25,
      sourceSoftResetMinimumDeviation: 220,
    },
  },
  leaderboardMinimumMatchCount: 12,
  ledgerRevision: 37,
  withinOpenWindow: false,
  effectiveQueueOpen: false,
};

describe('RankedSeasonSettingsSnapshot', () => {
  it('keeps a closed season full configuration visible as a read-only snapshot', () => {
    const html = renderToStaticMarkup(
      createElement(RankedSeasonSettingsSnapshot, { season: CLOSED_SEASON })
    );

    expect(html).toContain('赛季封存配置');
    expect(html).toContain('赛季已结束，以下为最终保存的只读设置。');
    expect(html).toContain('ranked-2026-summer');
    expect(html).toContain('GLICKO1_PER_MATCH_V4');
    expect(html).toContain('进入排行榜门槛');
    expect(html).toContain('12 场');
    expect(html).toContain('向中心值保留');
    expect(html).toContain('25%');
    expect(html).toContain('75%');
    expect(html).toContain('RULES_V5');
    expect(html).toContain('sha256:frozen-environment');
    expect(html).toContain('sha256:frozen-catalog');
    expect(html).toContain('赛季公告');
    expect(html).not.toMatch(/<(?:input|textarea|button)\b/);
  });

  it('keeps the closed-season action row compact until management is requested', () => {
    const html = renderToStaticMarkup(
      createElement(SeasonPanel, {
        seasons: [CLOSED_SEASON],
        formalAlgorithm: CLOSED_SEASON.ratingAlgorithmVersion,
        formalRatingConfig: CLOSED_SEASON.ratingConfig,
        creating: false,
        editingSeason: null,
        busy: false,
        onToggleCreate: vi.fn(),
        onEdit: vi.fn(),
        onCancelEdit: vi.fn(),
        onCreate: vi.fn(),
        onUpdate: vi.fn(),
        onUpdateActive: vi.fn(),
        onAction: vi.fn(),
        onDelete: vi.fn(),
        onRequestFinalize: vi.fn(),
        onAdmission: vi.fn(),
        onOpenSeasonNotice: vi.fn(),
        onOpenCover: vi.fn(),
        onOpenBadge: vi.fn(),
        onOpenRatingRevision: vi.fn(),
      })
    );

    expect(html).toContain('查看设置');
    expect(html).toContain('赛季公告');
    expect(html).toContain('>管理<');
    expect(html).toContain('已结束');
    expect(html).not.toContain('活动封面');
    expect(html).not.toContain('赛季徽章');
    expect(html).not.toContain('编辑赛季与公告');
  });
});
