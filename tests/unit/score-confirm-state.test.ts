import { describe, expect, it } from 'vitest';
import { buildScoreConfirmStateKey } from '../../client/src/lib/scoreConfirmState';

describe('score confirm state key', () => {
  it('切换调试视角时为另一玩家创建独立的分数输入状态', () => {
    const firstPlayerKey = buildScoreConfirmStateKey('debug-match', 3, 'FIRST');
    const secondPlayerKey = buildScoreConfirmStateKey('debug-match', 3, 'SECOND');

    expect(firstPlayerKey).not.toBe(secondPlayerKey);
    expect(firstPlayerKey).toContain(':FIRST');
    expect(secondPlayerKey).toContain(':SECOND');
  });
});
