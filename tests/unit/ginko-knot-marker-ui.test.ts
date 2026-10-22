import { createRequire } from 'node:module';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PlayerViewState } from '../../src/online/types';
import { prepareGinkoScenario } from '../helpers/ginko-entrance-fixture';
import { createConfirmEffectStepCommand } from '../../src/application/game-commands';
import { GameService } from '../../src/application/game-service';
import { projectPlayerViewState } from '../../src/online/projector';
import { CardEffectsEnabledContext } from '../../client/src/lib/cardEffectsContext';
import { GinkoKnotMarker } from '../../client/src/components/card/GinkoKnotMarker';
import { CardEntranceToggle } from '../../client/src/components/game/card-entrance/CardEntranceToggle';

let view: PlayerViewState | null = null;
let reducedMotion = false;
vi.mock('@/store/gameStore', () => ({
  useGameStore: (selector: (state: { playerViewState: PlayerViewState | null }) => unknown) =>
    selector({ playerViewState: view }),
}));
vi.mock('../../client/node_modules/framer-motion', () => ({
  useReducedMotion: () => reducedMotion,
}));

const requireFromClient = createRequire(new URL('../../client/package.json', import.meta.url));
const { createElement } = requireFromClient('react') as {
  readonly createElement: (...args: readonly unknown[]) => unknown;
};
const { renderToStaticMarkup } = requireFromClient('react-dom/server') as {
  readonly renderToStaticMarkup: (element: unknown) => string;
};

function renderMarker(enabled: boolean) {
  return renderToStaticMarkup(
    createElement(
      CardEffectsEnabledContext.Provider,
      { value: enabled },
      createElement(GinkoKnotMarker, { objectId: 'obj_ginko' })
    )
  );
}

afterEach(() => {
  view = null;
  reducedMotion = false;
});

describe('卡牌特效开关与吟子心意结', () => {
  it.each([
    ['p1', false],
    ['p2', false],
    ['p1', true],
    ['p2', true],
  ] as const)('在%s视角、减少动态=%s时隐藏整枚角标并保留真实能力', (viewer, reduced) => {
    reducedMotion = reduced;
    const f = prepareGinkoScenario({ mode: 'LOCAL' });
    expect(f.play().success).toBe(true);
    expect(f.ack().success).toBe(true);
    view = f.session.getPlayerViewState(viewer)!;
    expect(renderMarker(true)).toBe('');

    expect(f.activate().success).toBe(true);
    expect(f.discard().success).toBe(true);
    view = f.session.getPlayerViewState(viewer)!;
    expect(view.objects.obj_ginko?.hasTemporaryOnEnterAbility).toBe(true);
    expect(renderMarker(false)).toBe('');

    // Skipping presentation still releases the existing barrier and invokes the ability.
    expect(f.ack().success).toBe(true);
    const effect = f.session.state!.activeEffect!;
    expect(
      f.session.executeCommand(
        createConfirmEffectStepCommand('p1', effect.id, effect.selectableCardIds![0]!)
      ).success
    ).toBe(true);
    view = f.session.getPlayerViewState(viewer)!;
    const authority = f.session.state;
    const visible = renderMarker(true);
    expect(visible).toContain('data-ginko-knot-marker="obj_ginko"');
    expect(visible).toContain(`data-reduced-motion="${reduced}"`);
    expect(visible).toContain('opacity:1');
    expect(renderMarker(false)).toBe('');
    expect(f.session.state).toBe(authority);
    expect(view.objects.obj_ginko?.hasTemporaryOnEnterAbility).toBe(true);
    expect(renderMarker(true)).toBe(visible);

    const ended = new GameService().finalizeLiveResult(f.session.state!);
    expect(ended.success).toBe(true);
    view = projectPlayerViewState(ended.gameState, viewer);
    expect(renderMarker(false)).toBe('');
    expect(renderMarker(true)).toBe('');
  });

  it.each([false, true])('共用按钮以卡牌特效名称公开开关状态 %s', (enabled) => {
    const html = renderToStaticMarkup(
      createElement(CardEntranceToggle, { enabled, onChange: vi.fn() })
    );
    expect(html).toContain('role="switch"');
    expect(html).toContain('aria-label="卡牌特效"');
    expect(html).toContain(`aria-checked="${enabled}"`);
  });
});
