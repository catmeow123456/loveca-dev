import { describe, expect, it } from 'vitest';
import { getOnlineRoomPostMatchActionState } from '../../client/src/lib/onlineRoomPostMatch';

describe('联机房间赛后动作', () => {
  it('私有房间保留大厅恢复入口并提供明确离房动作', () => {
    expect(
      getOnlineRoomPostMatchActionState({
        originKind: 'ONLINE_ROOM',
        restartRole: 'NONE',
        opponentActive: true,
      })
    ).toEqual({
      kind: 'REPLAYABLE_ROOM',
      preserveRoomOnLobbyReturn: true,
      showExplicitLeaveRoom: true,
      restartAction: 'REQUEST',
      restartDisabledReason: null,
    });
  });

  it('公共牌桌与私有房间提供相同的赛后动作', () => {
    expect(
      getOnlineRoomPostMatchActionState({
        originKind: 'PUBLIC_TABLE',
        restartRole: 'NONE',
        opponentActive: true,
      })
    ).toEqual({
      kind: 'REPLAYABLE_ROOM',
      preserveRoomOnLobbyReturn: true,
      showExplicitLeaveRoom: true,
      restartAction: 'REQUEST',
      restartDisabledReason: null,
    });
  });

  it('私有房间重开请求双方得到对应动作', () => {
    expect(
      getOnlineRoomPostMatchActionState({
        originKind: 'ONLINE_ROOM',
        restartRole: 'REQUESTER',
        opponentActive: true,
      }).restartAction
    ).toBe('WAITING');
    expect(
      getOnlineRoomPostMatchActionState({
        originKind: 'ONLINE_ROOM',
        restartRole: 'RESPONDER',
        opponentActive: true,
      }).restartAction
    ).toBe('RESPOND');
  });

  it('对手暂时离开时保留重开入口并说明阻塞原因', () => {
    expect(
      getOnlineRoomPostMatchActionState({
        originKind: 'ONLINE_ROOM',
        restartRole: 'NONE',
        opponentActive: false,
      })
    ).toMatchObject({
      restartAction: 'REQUEST',
      restartDisabledReason: '对手回到房间后可以再来一局。',
    });
  });

  it('排位赛后继续释放房间并返回大厅', () => {
    expect(
      getOnlineRoomPostMatchActionState({
        originKind: 'RANKED',
        restartRole: 'NONE',
        opponentActive: true,
      })
    ).toEqual({
      kind: 'RANKED_ROOM',
      preserveRoomOnLobbyReturn: false,
      showExplicitLeaveRoom: false,
      restartAction: null,
      restartDisabledReason: null,
    });
  });
});
