import { describe, expect, it } from 'vitest';
import {
  RANKED_DOUBLE_DISCONNECT_NO_CONTEST_WINDOW_MS,
  RANKED_RATING_ALGORITHM_NOTICE,
  RANKED_RECONNECT_GRACE_PERIOD_MS,
  RANKED_SEASON_DISCONNECT_NOTICE,
  RANKED_STALL_NOTICE_AFTER_MS,
  RANKED_STALL_TIMEOUT_MS,
} from '../../src/online/ranked-policy';

describe('排位断线政策', () => {
  it('使用一分钟重连期限和五秒双方超时无结果窗口', () => {
    expect(RANKED_RECONNECT_GRACE_PERIOD_MS).toBe(60_000);
    expect(RANKED_DOUBLE_DISCONNECT_NO_CONTEST_WINDOW_MS).toBe(5_000);
    expect(RANKED_STALL_TIMEOUT_MS).toBe(180_000);
    expect(RANKED_STALL_NOTICE_AFTER_MS).toBe(120_000);
  });

  it('赛季公告简要说明积分算法和断线裁定', () => {
    expect(RANKED_RATING_ALGORITHM_NOTICE.name).toBe('Glicko-1');
    expect(RANKED_SEASON_DISCONNECT_NOTICE.summary).toBe(
      '断线后可在 1 分钟内重连。单方断线超时由超时方判负；双方都超时，最后在线相差不超过 5 秒时本局无结果、不计胜者与积分，超过 5 秒时较早离线方判负。对局明确等待一名玩家操作时，连续 3 分钟没有成功操作也会判负。'
    );
  });
});
