import type { MatchOriginKind, OnlineRoomStatus } from '@game/online';

export interface LeaveConfirmCopy {
  readonly title: string;
  readonly message: string;
  readonly confirmLabel: string;
}

export function getSolitaireLeaveConfirmCopy(): LeaveConfirmCopy {
  return {
    title: '退出对墙打？',
    message: '这局会直接结束，当前进度不会保留。',
    confirmLabel: '退出并结束',
  };
}

export function getAiBattleLeaveConfirmCopy(): LeaveConfirmCopy {
  return {
    title: '结束 AI 对战？',
    message: '离开会按认输结束当前对局，并清除本次恢复入口。',
    confirmLabel: '认输并离开',
  };
}

export function getOnlineRoomLeaveConfirmCopy(
  status: OnlineRoomStatus | null | undefined,
  originKind?: MatchOriginKind,
  isMatchCompleted = false
): LeaveConfirmCopy | null {
  if (status === 'IN_GAME') {
    if ((originKind === 'ONLINE_ROOM' || originKind === 'PUBLIC_TABLE') && isMatchCompleted) {
      return {
        title: '要离开这个房间吗？',
        message: '离开后将无法返回当前房间，也无法与当前对手再次对局。',
        confirmLabel: '离开房间',
      };
    }
    return null;
  }

  if (status === 'OPENING' && originKind === 'PUBLIC_TABLE') {
    return {
      title: '放弃本次配对？',
      message: '放弃后本次配对结束，双方都需要重新寻找对手。',
      confirmLabel: '放弃配对',
    };
  }

  if (status === 'OPENING' && originKind === 'RANKED') {
    return {
      title: '退出房间？',
      message: '你的位置会暂时保留，稍后可以回来继续。',
      confirmLabel: '退出房间',
    };
  }

  return {
    title: '退出房间？',
    message: '离开后不会保留你的位置，之后仍可用房间号重新加入。',
    confirmLabel: '退出房间',
  };
}
