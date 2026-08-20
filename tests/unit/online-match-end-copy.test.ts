import { describe, expect, it } from 'vitest';
import { getOnlineMatchEndCopy } from '../../client/src/lib/onlineMatchEndCopy';
import type { MatchEndView } from '../../src/online/types';
import { GameEndReason } from '../../src/shared/types/enums';

const SURRENDER_END: MatchEndView = {
  reason: GameEndReason.OPPONENT_SURRENDER,
  winnerSeat: 'SECOND',
  loserSeat: 'FIRST',
};

describe('联机终局文案', () => {
  it('明确区分操作超时与玩家主动认输', () => {
    const timeoutEnd: MatchEndView = {
      ...SURRENDER_END,
      rankedForfeitCause: 'STALL_TIMEOUT',
    };

    expect(getOnlineMatchEndCopy(timeoutEnd, 'FIRST')).toEqual({
      title: '操作超时判负',
      detail: '你连续 3 分钟没有完成对局操作，本局已结束。',
    });
    expect(getOnlineMatchEndCopy(timeoutEnd, 'SECOND')).toEqual({
      title: '本局获胜',
      detail: '对手操作超时，本局已结束。',
    });
    expect(getOnlineMatchEndCopy(SURRENDER_END, 'FIRST').title).toBe('你已认输');
  });

  it('断线判负显示重连期限语义', () => {
    const disconnectEnd: MatchEndView = {
      ...SURRENDER_END,
      rankedForfeitCause: 'DISCONNECT_TIMEOUT',
    };

    expect(getOnlineMatchEndCopy(disconnectEnd, 'FIRST')).toEqual({
      title: '断线超时判负',
      detail: '你未在重连期限内返回，本局已结束。',
    });
    expect(getOnlineMatchEndCopy(disconnectEnd, 'SECOND').detail).toBe(
      '对手断线超时，本局已结束。'
    );
  });
});
