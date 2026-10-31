import { describe, expect, it, vi } from 'vitest';
import { validateCardCode } from '../../src/shared/utils/card-code';
import {
  buildCardSyncReviewEntries,
  forceReviewCandidate,
  reviewBlockedItem,
} from '../../src/server/services/card-sync-review-plan';
import { CardSyncImageChecker } from '../../src/server/services/card-sync-image-check';
import type { CloudBaseApp } from '../../src/scripts/sync-cards-cloudbase-new';

const member = {
  card_code: 'PL!HS-ad2-001-AD',
  name_cn: '测试成员',
  type: 'MEMBER',
  cost: 2,
  blade: 1,
  hearts: [],
  image_source_uri: 'https://example.com/card.png',
};

describe('card sync manual review', () => {
  it('accepts AD products and rarities through the shared validation and normal sync plan', () => {
    expect(validateCardCode(member.card_code).valid).toBe(true);
    const { entries } = buildCardSyncReviewEntries([member], []);
    expect(entries[0].issues).toEqual([]);
    expect(entries[0].candidate.record.card_code).toBe(member.card_code);
  });
  it('retains full identity and specific errors for unknown formats', () => {
    const { entries } = buildCardSyncReviewEntries(
      [{ ...member, card_code: 'FUTURE-extra-001-XYZ' }],
      []
    );
    const item = reviewBlockedItem(entries[0]);
    expect(item).toMatchObject({
      cardCode: 'FUTURE-extra-001-XYZ',
      name: '测试成员',
      sourceKey: 'row:1',
    });
    expect(item.message).toContain('未知系列前缀');
    const forced = forceReviewCandidate(entries[0], {
      sourceKey: 'row:1',
      cardCode: item.cardCode!,
      name: item.name!,
      cardType: 'MEMBER',
    });
    expect(forced.record.card_code).toBe(item.cardCode);
    expect(forced.record.status).toBe('DRAFT');
    expect(forced.record.source_flags?.forceImported).toBe(true);
  });
  it('allows missing identity, invalid type and invalid numbers to become editable incomplete drafts', () => {
    const { entries } = buildCardSyncReviewEntries([{ type: 'unknown', cost: -5, blade: -1 }], []);
    expect(reviewBlockedItem(entries[0])).toMatchObject({
      cardCode: null,
      name: null,
      imageIssue: true,
    });
    const candidate = forceReviewCandidate(entries[0], {
      sourceKey: 'row:1',
      cardCode: 'MY-CARD',
      name: '人工名称',
      cardType: 'MEMBER',
    });
    expect(candidate.record).toMatchObject({
      card_code: 'MY-CARD',
      name_cn: '人工名称',
      cost: null,
      blade: null,
      status: 'DRAFT',
    });
    expect(candidate.record.source_flags?.parseWarnings).toEqual(
      expect.arrayContaining([expect.stringContaining('non-negative')])
    );
    expect(candidate.record.source_flags?.missingRuleFields).toContain('cost');
  });
  it('keeps duplicate source rows individually selectable and derives safe isolated image names', () => {
    const { entries } = buildCardSyncReviewEntries(
      [member, { ...member, name_cn: '另一记录' }],
      []
    );
    expect(entries).toHaveLength(2);
    expect(entries.map((entry) => entry.sourceKey)).toEqual(['row:1', 'row:2']);
    expect(entries.every((entry) => entry.issues.some((issue) => issue.includes('重复编号')))).toBe(
      true
    );
    expect(entries[0].candidate.imagePlan.imageBaseName).not.toBe(
      entries[1].candidate.imagePlan.imageBaseName
    );
    const forced = forceReviewCandidate(entries[1], {
      sourceKey: 'row:2',
      cardCode: '../different-card',
      name: '另一记录',
      cardType: 'MEMBER',
    });
    expect(forced.record.card_code).toBe('../different-card');
    expect(forced.imagePlan.imageBaseName).toMatch(/^sync-[a-f0-9]{24}$/);
  });
  it('does not let old image metadata or shared upstream filenames block unrelated new cards', () => {
    const { entries, existingCount } = buildCardSyncReviewEntries(
      [member, { ...member, card_code: 'PL!HS-ad2-002-AD' }],
      [
        {
          card_code: 'OLD',
          image_filename: 'card.webp',
          source_flags: { imageObjectVersioned: true },
        },
      ]
    );
    expect(existingCount).toBe(0);
    expect(entries.every((entry) => entry.issues.length === 0)).toBe(true);
    expect(new Set(entries.map((entry) => entry.candidate.imagePlan.imageBaseName)).size).toBe(2);
  });
});

describe('bounded image checks', () => {
  const app = {} as CloudBaseApp;
  it('checks 200 distinct images with at most four concurrent requests and caches outcomes without image bodies', async () => {
    let active = 0;
    let peak = 0;
    const probe = vi.fn(async () => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 1));
      active--;
    });
    const checker = new CardSyncImageChecker(probe);
    const urls = Array.from({ length: 200 }, (_, i) => `https://example.com/${i}.png`);
    const result = await Promise.all(urls.map((url) => checker.check(app, url, 'LINK')));
    expect(result.every((item) => item.state === 'OK')).toBe(true);
    expect(peak).toBe(4);
    expect(probe).toHaveBeenCalledTimes(200);
    await Promise.all(urls.map((url) => checker.check(app, url, 'LINK')));
    expect(probe).toHaveBeenCalledTimes(200);
  });
  it('shares in-flight probes for repeated addresses and separates optional full decoding', async () => {
    const probe = vi.fn(() => Promise.resolve());
    const checker = new CardSyncImageChecker(probe);
    await Promise.all(Array.from({ length: 200 }, () => checker.check(app, 'same', 'LINK')));
    expect(probe).toHaveBeenCalledTimes(1);
    await checker.check(app, 'same', 'DECODE');
    expect(probe).toHaveBeenCalledTimes(2);
    expect(probe.mock.calls[1]?.[2]).toBe('DECODE');
  });
  it.each([
    ['HTTP 404', 'UNAVAILABLE'],
    ['non-image content', 'UNAVAILABLE'],
    ['request timeout', 'UNCERTAIN'],
    ['HTTP 405', 'UNCERTAIN'],
  ])('distinguishes %s without calling every failure a placeholder', async (error, state) => {
    const checker = new CardSyncImageChecker(() => Promise.reject(new Error(error)));
    expect((await checker.check(app, 'uri', 'LINK')).state).toBe(state);
  });
});
