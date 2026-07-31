import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { ProductFrame } from '../../client/src/components/common/ProductFrame';

const requireFromClient = createRequire(new URL('../../client/package.json', import.meta.url));
const { createElement } = requireFromClient('react') as {
  readonly createElement: (
    type: unknown,
    props?: Record<string, unknown> | null,
    ...children: readonly unknown[]
  ) => unknown;
};
const { renderToStaticMarkup } = requireFromClient('react-dom/server') as {
  readonly renderToStaticMarkup: (element: unknown) => string;
};

function renderFrame(immersive: boolean): string {
  return renderToStaticMarkup(
    createElement(
      ProductFrame,
      {
        active: 'battle',
        navigation: {
          onHome: () => undefined,
          onDecks: () => undefined,
          onBattle: () => undefined,
          onSpectate: () => undefined,
          onHistory: () => undefined,
        },
        footer: createElement('footer', { id: 'frame-footer' }, 'Footer'),
        immersive,
      },
      createElement('div', { id: 'battle-content' }, 'Battle')
    )
  );
}

describe('ProductFrame immersive layout', () => {
  it('keeps navigation and places the footer after content inside the scrollable workspace', () => {
    const html = renderFrame(false);

    expect(html).toContain('product-header');
    expect(html).toContain('overflow-y-auto');
    expect(html).toContain('id="frame-footer"');
    expect(html).toContain('id="battle-content"');
    expect(html).toContain(
      '<div id="battle-content">Battle</div><footer id="frame-footer">Footer</footer>'
    );
  });

  it('removes product chrome and disables workspace scrolling for a full-viewport battle', () => {
    const html = renderFrame(true);

    expect(html).not.toContain('product-header');
    expect(html).not.toContain('overflow-y-auto');
    expect(html).toContain('overflow-hidden');
    expect(html).not.toContain('id="frame-footer"');
    expect(html).toContain('id="battle-content"');
  });
});
