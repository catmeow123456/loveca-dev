import type { OnlineRoomStatus } from '@game/online';

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

export function getOnlineRoomLeaveConfirmCopy(
  status: OnlineRoomStatus | null | undefined
): LeaveConfirmCopy {
  if (status === 'OPENING' || status === 'IN_GAME') {
    return {
      title: '离开房间？',
      message: '你的位置会暂时保留，稍后可以回来继续；双方都离开太久时，本局会自动结束。',
      confirmLabel: '离开房间',
    };
  }

  return {
    title: '离开房间？',
    message: '离开后不会保留你的位置，之后仍可用房间号重新加入。',
    confirmLabel: '离开房间',
  };
}
