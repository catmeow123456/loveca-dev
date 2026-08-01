import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';
import type { ActiveEffectViewState } from '../../src/online/types';
import { EffectChoicePanel } from '../../client/src/components/game/EffectChoicePanel';
import { shouldMountEffectChoicePanel } from '../../client/src/lib/effectChoiceUi';

const requireFromClient = createRequire(new URL('../../client/package.json', import.meta.url));
const { createElement } = requireFromClient('react') as {
  readonly createElement: (...args: readonly unknown[]) => unknown;
};
const { renderToStaticMarkup } = requireFromClient('react-dom/server') as {
  readonly renderToStaticMarkup: (element: unknown) => string;
};

function effect(overrides: Partial<ActiveEffectViewState> = {}): ActiveEffectViewState {
  return {
    id: 'effect-choice-panel',
    abilityId: 'test:effect-choice-panel',
    sourceObjectId: 'obj_source',
    controllerSeat: 'FIRST',
    effectText: '从以下选择效果。',
    stepId: 'TEST_EFFECT_CHOICE_PANEL',
    stepText: '请选择效果。',
    selectionLabel: '选择要获得的效果',
    confirmSelectionLabel: '获得已选效果',
    waitingSeat: 'FIRST',
    effectChoice: {
      mode: 'MULTI',
      options: [
        { id: 'draw', text: '抽1张。' },
        { id: 'blade', text: '获得[BLADE]。' },
      ],
      minSelections: 1,
      maxSelections: 2,
      publicConfirmation: true,
    },
    ...overrides,
  };
}

function renderPanel(
  activeEffect: ActiveEffectViewState,
  selectedOptionIds: readonly string[] = [],
  options: {
    readonly canChoose?: boolean;
    readonly isOrderSelectionWindow?: boolean;
    readonly showOrdinaryActiveEffectControls?: boolean;
  } = {}
): string {
  if (
    !shouldMountEffectChoicePanel(
      activeEffect,
      options.isOrderSelectionWindow === true,
      options.showOrdinaryActiveEffectControls ?? true
    )
  ) {
    return '';
  }
  return renderToStaticMarkup(
    createElement(EffectChoicePanel, {
      activeEffect,
      selectedOptionIds,
      canChoose: options.canChoose ?? true,
      canConfirmMulti: selectedOptionIds.length > 0,
      onSelectSingle: vi.fn(),
      onToggleMulti: vi.fn(),
      onConfirmMulti: vi.fn(),
      onSkip: vi.fn(),
    })
  );
}

describe('EffectChoicePanel', () => {
  it('在原效果下以整行选项渲染 token 并使用具体确认文案', () => {
    const html = renderPanel(effect(), ['blade']);
    expect(html).toContain('选择要获得的效果');
    expect(html).toContain('获得已选效果（1项）');
    expect(html).toContain('aria-label="BLADE"');
    expect(html).toContain('aria-pressed="true"');
  });

  it('可选结构化效果单独显示负向次按钮', () => {
    const optionalEffect = effect({
      canSkipSelection: true,
      skipSelectionLabel: '不改变必要Heart',
    });
    const html = renderPanel(optionalEffect);
    expect(html).toContain('不改变必要Heart');
    expect(
      optionalEffect.effectChoice?.options.map((option) => option.text).join(' ')
    ).not.toContain('不改变');
  });

  it('公开阶段保持挂载并只显示服务端选中的非交互效果', () => {
    const publicEffect = effect({
      effectChoice: {
        ...effect().effectChoice!,
        selectedOptionIds: ['blade'],
      },
      publicEffectChoiceAutoAdvanceAt: 11_500,
      publicEffectChoiceAutoAdvanceAfterMs: 1_500,
    });
    expect(shouldMountEffectChoicePanel(publicEffect, false, false)).toBe(true);

    const html = renderPanel(publicEffect, [], {
      canChoose: false,
      showOrdinaryActiveEffectControls: false,
    });
    expect(html).toContain('已选择的效果');
    expect(html).toContain('获得');
    expect(html).toContain('aria-label="BLADE"');
    expect(html).not.toContain('抽1张。');
    expect(html).not.toContain('获得已选效果');
    expect(html).not.toContain('<button');
  });

  it('只在普通控件可见或公开结果阶段挂载选项面板', () => {
    const activeEffect = effect();
    expect(shouldMountEffectChoicePanel(activeEffect, false, true)).toBe(true);
    expect(shouldMountEffectChoicePanel(activeEffect, false, false)).toBe(false);
  });

  it('队列顺序选择窗口不挂载卡牌效果选项面板', () => {
    const activeEffect = effect({
      effectChoice: {
        ...effect().effectChoice!,
        selectedOptionIds: ['blade'],
      },
      publicEffectChoiceAutoAdvanceAt: 11_500,
      publicEffectChoiceAutoAdvanceAfterMs: 1_500,
    });
    expect(shouldMountEffectChoicePanel(activeEffect, true, false)).toBe(false);
    expect(renderPanel(activeEffect, [], { isOrderSelectionWindow: true })).toBe('');
  });
});
