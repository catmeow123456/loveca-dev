import { describe, expect, it } from 'vitest';
import { getOnlineRoomLeaveConfirmCopy } from '../../client/src/lib/leaveConfirmCopy';

describe('联机房间离开文案', () => {
  it('进行中对局不提供直接退出房间动作', () => {
    expect(getOnlineRoomLeaveConfirmCopy('IN_GAME', 'ONLINE_ROOM')).toBeNull();
    expect(getOnlineRoomLeaveConfirmCopy('IN_GAME', 'PUBLIC_TABLE')).toBeNull();
  });

  it('公共牌桌开局使用终结本次匹配的放弃配对语义', () => {
    expect(getOnlineRoomLeaveConfirmCopy('OPENING', 'PUBLIC_TABLE')).toEqual({
      title: '放弃本次配对？',
      message: '放弃后本次配对结束，双方都需要重新寻找对手。',
      confirmLabel: '放弃配对',
    });
  });

  it('普通房间开局退出不再保留成员位置', () => {
    expect(getOnlineRoomLeaveConfirmCopy('OPENING', 'ONLINE_ROOM')).toEqual({
      title: '退出房间？',
      message: '离开后不会保留你的位置，之后仍可用房间号重新加入。',
      confirmLabel: '退出房间',
    });
  });

  it('排位开局暂时保留现有恢复语义', () => {
    expect(getOnlineRoomLeaveConfirmCopy('OPENING', 'RANKED')).toEqual({
      title: '退出房间？',
      message: '你的位置会暂时保留，稍后可以回来继续。',
      confirmLabel: '退出房间',
    });
  });
});
