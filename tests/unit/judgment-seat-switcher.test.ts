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

function renderSwitcher(activeSeat: 'FIRST' | 'SECOND', viewingSeat: 'FIRST' | 'SECOND'): string {
  return renderToStaticMarkup(
    createElement(JudgmentSeatSwitcher, {
      activeSeat,
      viewingSeat,
      playerNames: {
        FIRST: '先攻玩家',
        SECOND: '后攻玩家',
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
    const html = renderSwitcher('SECOND', 'FIRST');

    expect(html).toContain('aria-label="切换判定查看玩家"');
    expect(html).toContain('aria-label="查看先攻玩家 先攻玩家 的判定"');
    expect(html).toContain('aria-label="查看后攻玩家 后攻玩家 的判定"');
    expect(html).toContain('aria-pressed="true" aria-label="查看先攻玩家 先攻玩家 的判定"');
    expect(html).toContain('aria-pressed="false" aria-label="查看后攻玩家 后攻玩家 的判定"');
    expect(html.match(/>当前<\/span>/g)).toHaveLength(1);
  });

  it('系统切换行动方后可将新的行动方呈现为选中状态', () => {
    const html = renderSwitcher('SECOND', 'SECOND');

    expect(html).toContain('aria-pressed="true" aria-label="查看后攻玩家 后攻玩家 的判定"');
  });

  it('将字号应用在内部文字上，避免被全局按钮字体继承覆盖', () => {
    const html = renderSwitcher('FIRST', 'FIRST');

    expect(html).toContain('class="text-[14px] leading-none">先攻</span>');
    expect(html).toContain('text-[9px] leading-none');
  });
});
