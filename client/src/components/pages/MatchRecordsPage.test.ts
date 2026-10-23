import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type {
  MatchRecordReplayView,
  MatchRecordSummaryView,
  MatchRecordTimelineEntryView,
} from '@game/online';

vi.mock('@/components/game', () => ({
  GameBoard: () => createElement('div', { 'data-testid': 'game-board' }),
}));

import { ReplayBoardSurface, formatPersonalResult, TimelineRow } from './MatchRecordsPage';

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

describe('personal match result', () => {
  const finished = {
    status: 'COMPLETED',
    winnerSeat: 'SECOND',
    viewerSeat: 'FIRST',
    endReason: 'VICTORY_CONDITION',
    matchMode: 'ONLINE',
  } as const;
  it.each([
    [{}, '失败'],
    [{ viewerSeat: 'SECOND' }, '胜利'],
    [{ winnerSeat: 'FIRST', status: 'SURRENDERED', endReason: 'OPPONENT_SURRENDER' }, '胜利'],
    [{ winnerSeat: null, endReason: 'DRAW' }, '平局'],
    [{ status: 'INTERRUPTED' }, '中断'],
    [{ status: 'CORRUPTED' }, '异常'],
    [{ winnerSeat: null }, '已结束'],
  ])('uses the viewer seat and preserves incomplete outcomes: %j', (changes, expected) => {
    expect(formatPersonalResult({ ...finished, ...changes } as MatchRecordSummaryView)).toBe(
      expected
    );
  });
});

describe('timeline navigation', () => {
  it('exposes the permitted action summary as readable content and keeps unlinked events noninteractive', () => {
    const html = renderToStaticMarkup(
      createElement(TimelineRow, {
        entry: {
          timelineSeq: 3,
          relatedCheckpointSeq: null,
          frameType: 'COMMAND_ACCEPTED',
          summary: '玩家宣言开始 LIVE',
          phase: 'MAIN_PHASE',
          turnCount: 2,
        } as MatchRecordTimelineEntryView,
        selected: false,
        onClick: vi.fn(),
      })
    );
    expect(html).toContain('>玩家宣言开始 LIVE<');
    expect(html).toContain('disabled=""');
  });
});
