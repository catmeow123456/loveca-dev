import { afterEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AiBillingCost } from './AiBillingCost';
import type { AiBillingSummary } from '@game/online/ai-battle-billing-types';

afterEach(() => vi.unstubAllGlobals());
const billing: AiBillingSummary = {
  attempts: 1,
  reportedAttempts: 1,
  pendingAttempts: 0,
  unreportedAttempts: 0,
  estimatedCny: null,
  saveFailed: false,
  usage: {
    inputTokens: 10,
    implicitCachedTokens: 2,
    explicitCachedTokens: 0,
    cacheCreationTokens: 0,
    outputTokens: 3,
  },
};
function render(value: AiBillingSummary) {
  vi.stubGlobal('window', { innerWidth: 1000 });
  return renderToStaticMarkup(createElement(AiBillingCost, { billing: value, label: '本局' }));
}
describe('AI subscription usage display', () => {
  it('does not present a subscription as zero CNY before or after a call', () => {
    for (const value of [billing, { ...billing, attempts: 0, reportedAttempts: 0 }]) {
      expect(render(value)).toContain('ChatGPT 订阅');
      expect(render(value)).not.toContain('¥');
    }
  });
  it('preserves unknown usage and the Qwen money display', () => {
    expect(render({ ...billing, reportedAttempts: 0, unreportedAttempts: 1 })).toContain(
      '用量未确认'
    );
    expect(render({ ...billing, estimatedCny: '0.00100000' })).toContain('≈¥0.0010');
  });
});
