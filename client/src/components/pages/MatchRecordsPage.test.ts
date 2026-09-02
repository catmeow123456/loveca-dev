import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { MatchRecordReplayView } from '@game/online';

vi.mock('@/components/game', () => ({
  GameBoard: () => createElement('div', { 'data-testid': 'game-board' }),
}));

import { ReplayBoardSurface } from './MatchRecordsPage';

describe('ReplayBoardSurface', () => {
  it('keeps the last replay board visible and exposes a retry action after node failure', () => {
    const html = renderToStaticMarkup(
      createElement(ReplayBoardSurface, {
        replay: { partialReasonSummary: null } as MatchRecordReplayView,
        currentCheckpointIndex: 2,
        checkpointCount: 8,
        canGoPrevious: true,
        canGoNext: true,
        isLoadingNode: false,
        nodeLoadError: '网络连接已中断',
        onStep: vi.fn(),
        onRetryNode: vi.fn(),
        onClose: vi.fn(),
      })
    );

    expect(html).toContain('data-testid="game-board"');
    expect(html).toContain('role="alert"');
    expect(html).toContain('回放节点加载失败');
    expect(html).toContain('网络连接已中断');
    expect(html).toContain('重试');
  });
});
