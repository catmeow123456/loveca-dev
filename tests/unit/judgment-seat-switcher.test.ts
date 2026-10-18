import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';
import {
  JudgmentSeatSwitcher,
  resolveJudgmentViewingSeat,
} from '../../client/src/components/game/JudgmentSeatSwitcher';

type TestSeat = 'FIRST' | 'SECOND';
const resolveViewingSeat = resolveJudgmentViewingSeat as unknown as (
  selection: {
    activeSeat: TestSeat | null;
    viewingSeat: TestSeat | null;
  },
  activeSeat: TestSeat | null
) => TestSeat | null;

const requireFromClient = createRequire(new URL('../../client/package.json', import.meta.url));
const { createElement } = requireFromClient('react') as {
  readonly createElement: (...args: readonly unknown[]) => unknown;
};
const { renderToStaticMarkup } = requireFromClient('react-dom/server') as {
  readonly renderToStaticMarkup: (element: unknown) => string;
};

function renderSwitcher(
  firstSeat: 'FIRST' | 'SECOND',
  activeSeat: 'FIRST' | 'SECOND',
  viewingSeat: 'FIRST' | 'SECOND'
): string {
  return renderToStaticMarkup(
    createElement(JudgmentSeatSwitcher, {
      firstSeat,
      activeSeat,
      viewingSeat,
      playerNames: {
        FIRST: '玩家 A',
        SECOND: '玩家 B',
      },
      onSelect: vi.fn(),
    })
  );
}

describe('JudgmentSeatSwitcher', () => {
  it('系统行动方变化时覆盖旧的手动查看选择', () => {
    expect(
      resolveViewingSeat(
        {
          activeSeat: 'FIRST',
          viewingSeat: 'SECOND',
        },
        'SECOND'
      )
    ).toBe('SECOND');
  });

  it('系统行动方未变化时保留玩家的手动查看选择', () => {
    expect(
      resolveViewingSeat(
        {
          activeSeat: 'FIRST',
          viewingSeat: 'SECOND',
        },
        'FIRST'
      )
    ).toBe('SECOND');
  });

  it('区分系统当前行动方与玩家正在查看的一方', () => {
    const html = renderSwitcher('FIRST', 'SECOND', 'FIRST');

    expect(html).toContain('aria-label="切换判定查看玩家"');
    expect(html).toContain('aria-label="查看先攻玩家 玩家 A 的判定"');
    expect(html).toContain('aria-label="查看后攻玩家 玩家 B 的判定"');
    expect(html).toContain('aria-pressed="true" aria-label="查看先攻玩家 玩家 A 的判定"');
    expect(html).toContain('aria-pressed="false" aria-label="查看后攻玩家 玩家 B 的判定"');
    const buttons = html.match(/<button\b[^>]*>/g) ?? [];
    expect(buttons).toHaveLength(2);
    expect(buttons[0]).not.toContain('aria-description="当前行动方"');
    expect(buttons[1]).toContain('aria-description="当前行动方"');
  });

  it('系统切换行动方后可将新的行动方呈现为选中状态', () => {
    const html = renderSwitcher('FIRST', 'SECOND', 'SECOND');

    expect(html).toContain('aria-pressed="true" aria-label="查看后攻玩家 玩家 B 的判定"');
  });

  it('先攻权交换后按实时角色显示，并保持先攻按钮在前', () => {
    const html = renderSwitcher('SECOND', 'SECOND', 'SECOND');
    const firstRoleIndex = html.indexOf('>先攻</span>');
    const secondRoleIndex = html.indexOf('>后攻</span>');

    expect(firstRoleIndex).toBeGreaterThan(-1);
    expect(secondRoleIndex).toBeGreaterThan(firstRoleIndex);
    expect(html).toContain('aria-pressed="true" aria-label="查看先攻玩家 玩家 B 的判定"');
    expect(html).toContain('aria-pressed="false" aria-label="查看后攻玩家 玩家 A 的判定"');
  });
});
