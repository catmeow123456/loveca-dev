import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { CardType, OrientationState } from '../../src/shared/types/enums';
import type { VisibleCardPresentation } from '../../client/src/store/gameStore';
import { BattleCardCandidateGrid } from '../../client/src/components/game/BattleCardCandidateGrid';

const requireFromClient = createRequire(new URL('../../client/package.json', import.meta.url));
const { createElement } = requireFromClient('react');
const { renderToStaticMarkup } = requireFromClient('react-dom/server');

const secret: VisibleCardPresentation = {
  instanceId: 'secret-instance',
  imagePath: '/secret-art.webp',
  cardData: {
    cardCode: 'SECRET-CODE',
    name: '秘密牌面',
    cardType: CardType.MEMBER,
    cost: 3,
    blade: 1,
    hearts: [],
  },
};
const energy: VisibleCardPresentation = {
  instanceId: 'energy',
  imagePath: '/energy.webp',
  cardData: { cardCode: 'ENERGY', name: '能量', cardType: CardType.ENERGY },
};
const render = (
  candidates: Parameters<typeof BattleCardCandidateGrid>[0]['candidates'],
  readOnly = false
) =>
  renderToStaticMarkup(
    createElement(BattleCardCandidateGrid, {
      label: '测试候选',
      candidates,
      readOnly,
      onSelect: () => {},
    })
  ) as string;

describe('shared battle card candidates', () => {
  it('concealed choices ignore even a supplied front, label and energy metadata', () => {
    const html = render([
      {
        id: 'blind-card-0',
        label: '秘密牌面',
        presentation: secret,
        concealed: true,
        orientation: OrientationState.WAITING,
        skipsNextActivePhase: true,
      },
    ]);
    for (const privateValue of ['secret-instance', 'SECRET-CODE', '秘密牌面', '/secret-art.webp']) {
      expect(html).not.toContain(privateValue);
    }
    expect(html).toContain('aria-label="第1张手牌"');
    expect(html).toContain('alt="不可见的手牌"');
    expect(html).not.toContain('disabled=""');
    expect(html).not.toContain('下次活跃');
  });

  it('an unavailable non-concealed card cannot be submitted', () => {
    expect(render([{ id: 'missing', label: '不可见', presentation: null }])).toContain(
      'disabled=""'
    );
  });

  it('readonly known cards keep the projected face without selection buttons', () => {
    const html = render([{ id: 'known', label: '已公开卡牌', presentation: secret }], true);
    expect(html).toContain('/secret-art.webp');
    expect(html).toContain('data-card-id="secret-instance"');
    expect(html).not.toContain('<button');
    expect(html).not.toContain('aria-pressed');
  });

  it('energy status remains readable in active and waiting states', () => {
    const html = render([
      { id: 'active', label: '能量甲', presentation: energy, orientation: OrientationState.ACTIVE },
      {
        id: 'waiting',
        label: '能量乙',
        presentation: energy,
        orientation: OrientationState.WAITING,
        skipsNextActivePhase: true,
      },
    ]);
    expect(html).toContain('aria-label="能量甲；当前状态：活跃"');
    expect(html).toContain('aria-label="能量乙；当前状态：等待；下次活跃阶段不会自动变为活跃"');
    expect(html).toContain('待机');
    expect(html).toContain('下次不自动活跃');
  });

  it('a public energy preview without projected orientation does not invent an active state', () => {
    const html = render([{ id: 'public-energy', label: '公开能量', presentation: energy }], true);
    expect(html).toContain('/energy.webp');
    expect(html).not.toContain('当前状态');
    expect(html).not.toContain('活跃');
    expect(html).not.toContain('待机');
  });
});
