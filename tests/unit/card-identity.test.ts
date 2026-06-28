import { describe, expect, it } from 'vitest';
import {
  cardBelongsToGroup,
  getKnownCardGroupIdentityName,
  type CardIdentityLike,
  type GroupIdentityName,
} from '../../src/shared/utils/card-identity';

describe('card identity helpers', () => {
  it('matches group aliases through structured groupNames with normalized punctuation', () => {
    const cases: readonly {
      readonly groupName: GroupIdentityName;
      readonly card: CardIdentityLike;
    }[] = [
      { groupName: "μ's", card: { groupNames: ['『μ』'] } },
      { groupName: '蓮ノ空', card: { groupNames: ['莲之空女学院スクールアイドルクラブ'] } },
      { groupName: 'Liella!', card: { groupNames: ['Liella！'] } },
      { groupName: 'SunnyPassion', card: { groupNames: ['Sunny Passion'] } },
      { groupName: '虹ヶ咲', card: { groupNames: ['Nijigasaki'] } },
      { groupName: 'Aqours', card: { groupNames: ['Aqours'] } },
      { groupName: 'A-RISE', card: { groupNames: ['A-RISE'] } },
      { groupName: 'SaintSnow', card: { groupNames: ['Saint Snow'] } },
    ];

    for (const { groupName, card } of cases) {
      expect(cardBelongsToGroup(card, groupName)).toBe(true);
    }
  });

  it('does not infer group identity from card code prefixes or card text', () => {
    expect(cardBelongsToGroup({}, "μ's")).toBe(false);
    expect(cardBelongsToGroup({}, '蓮ノ空')).toBe(false);
    expect(cardBelongsToGroup({}, 'Liella!')).toBe(false);
    expect(cardBelongsToGroup({}, '虹ヶ咲')).toBe(false);
    expect(cardBelongsToGroup({}, 'Aqours')).toBe(false);
  });

  it('matches LL-bp2-001 mixed series as each represented group', () => {
    const mixedSeriesCard: CardIdentityLike = {
      groupNames: [
        'ラブライブ！サンシャイン!!',
        'ラブライブ！スーパースター!!',
        '蓮ノ空女学院スクールアイドルクラブ',
      ],
    };

    expect(cardBelongsToGroup(mixedSeriesCard, 'Aqours')).toBe(true);
    expect(cardBelongsToGroup(mixedSeriesCard, 'Liella!')).toBe(true);
    expect(cardBelongsToGroup(mixedSeriesCard, '蓮ノ空')).toBe(true);
    expect(cardBelongsToGroup(mixedSeriesCard, "μ's")).toBe(false);
    expect(cardBelongsToGroup(mixedSeriesCard, '虹ヶ咲')).toBe(false);
  });

  it('normalizes known group identity from structured groupNames', () => {
    expect(getKnownCardGroupIdentityName({ groupNames: ["μ's"] })).toBe("μ's");
    expect(getKnownCardGroupIdentityName({ groupNames: ['蓮ノ空女学院スクールアイドルクラブ'] })).toBe(
      '蓮ノ空'
    );
    expect(getKnownCardGroupIdentityName({ groupNames: ['SunnyPassion'] })).toBe('SunnyPassion');
    expect(getKnownCardGroupIdentityName({ groupNames: ['Nijigasaki'] })).toBe('虹ヶ咲');
    expect(getKnownCardGroupIdentityName({ groupNames: ['A-RISE'] })).toBe('A-RISE');
    expect(getKnownCardGroupIdentityName({ groupNames: ['SaintSnow'] })).toBe('SaintSnow');
    expect(getKnownCardGroupIdentityName({ groupNames: ['Custom'] })).toBeNull();
  });

  it('keeps structured rival groups within groupNames boundaries', () => {
    const sunnyPassion = { groupNames: ['SunnyPassion'] };
    const arise = { groupNames: ['A-RISE'] };
    const saintSnow = { groupNames: ['SaintSnow'] };
    const aqoursAndSaintSnow = { groupNames: ['Aqours/SaintSnow'] };

    expect(cardBelongsToGroup(sunnyPassion, 'SunnyPassion')).toBe(true);
    expect(cardBelongsToGroup(sunnyPassion, 'Liella!')).toBe(false);
    expect(cardBelongsToGroup(arise, 'A-RISE')).toBe(true);
    expect(cardBelongsToGroup(arise, "μ's")).toBe(false);
    expect(cardBelongsToGroup(saintSnow, 'SaintSnow')).toBe(true);
    expect(cardBelongsToGroup(saintSnow, 'Aqours')).toBe(false);
    expect(cardBelongsToGroup(aqoursAndSaintSnow, 'Aqours')).toBe(true);
    expect(cardBelongsToGroup(aqoursAndSaintSnow, 'SaintSnow')).toBe(true);
  });

  it('does not match unrelated groups or unknown identities', () => {
    expect(cardBelongsToGroup({ groupNames: ['Aqours'] }, "μ's")).toBe(false);
    expect(cardBelongsToGroup({ groupNames: ['Liella'] }, 'Unknown')).toBe(false);
  });

  it('does not match when identity fields are absent', () => {
    expect(cardBelongsToGroup({}, "μ's")).toBe(false);
    expect(cardBelongsToGroup({}, '蓮ノ空')).toBe(false);
    expect(cardBelongsToGroup({}, 'Liella!')).toBe(false);
    expect(cardBelongsToGroup({}, '虹ヶ咲')).toBe(false);
    expect(cardBelongsToGroup({}, 'Aqours')).toBe(false);
  });
});
