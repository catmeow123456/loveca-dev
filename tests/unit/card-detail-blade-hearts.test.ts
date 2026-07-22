import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import {
  MemberCardDetails,
  LiveCardDetails,
} from '../../client/src/components/game/CardDetailOverlay';
import { createHeartRequirement } from '../../src/domain/entities/card';
import type { LiveCardData, MemberCardData } from '../../src/domain/entities/card';
import { BladeHeartEffect, CardType, HeartColor } from '../../src/shared/types/enums';

const requireFromClient = createRequire(new URL('../../client/package.json', import.meta.url));
const { createElement } = requireFromClient('react') as {
  readonly createElement: (...args: readonly unknown[]) => unknown;
};
const { renderToStaticMarkup } = requireFromClient('react-dom/server') as {
  readonly renderToStaticMarkup: (element: unknown) => string;
};

const doubleGrayBladeHearts = [
  { effect: BladeHeartEffect.HEART, heartColor: HeartColor.GRAY },
  { effect: BladeHeartEffect.HEART, heartColor: HeartColor.GRAY },
  { effect: BladeHeartEffect.DRAW },
  { effect: BladeHeartEffect.SCORE },
] as const;

describe('card detail Blade Heart rendering', () => {
  it('renders double as two gray Hearts in member details', () => {
    const data: MemberCardData = {
      cardCode: 'PL!TEST-double-member',
      name: 'Double Member',
      cardType: CardType.MEMBER,
      cost: 1,
      blade: 1,
      hearts: [],
      bladeHearts: doubleGrayBladeHearts,
    };

    const html = renderToStaticMarkup(createElement(MemberCardDetails, { data }));
    expect(html).toContain('判心');
    expect(html).toContain('aria-label="无色 Heart 2"');
    expect(html).toContain('aria-label="抽卡判心 1"');
    expect(html).toContain('aria-label="分数判心 1"');
  });

  it('uses the same structured Blade Heart rendering in Live details', () => {
    const data: LiveCardData = {
      cardCode: 'PL!TEST-double-live',
      name: 'Double Live',
      cardType: CardType.LIVE,
      score: 8,
      requirements: createHeartRequirement({ [HeartColor.RAINBOW]: 2 }),
      bladeHearts: doubleGrayBladeHearts,
    };

    const html = renderToStaticMarkup(createElement(LiveCardDetails, { data }));
    expect(html).toContain('判心');
    expect(html).toContain('aria-label="无色 Heart 2"');
    expect(html).toContain('合计 2');
    expect(html).not.toContain('aria-label="All Heart 2"');
  });
});
