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

export function getOnlineRoomLeaveConfirmCopy(
  status: OnlineRoomStatus | null | undefined,
  originKind?: MatchOriginKind
): LeaveConfirmCopy {
  if (status === 'OPENING' && originKind === 'PUBLIC_TABLE') {
    return {
      title: '放弃这次配对？',
      message: '这次配对会结束；如果只是想暂时离开页面，请选择“返回主页”。',
      confirmLabel: '放弃配对',
    };
  }

  if (status === 'OPENING' || status === 'IN_GAME') {
    return {
      title: '退出房间？',
      message: '你的位置会暂时保留，稍后可以回来继续；双方都离开太久时，本局会自动结束。',
      confirmLabel: '退出房间',
    };
  }

  return {
    title: '退出房间？',
    message: '离开后不会保留你的位置，之后仍可用房间号重新加入。',
    confirmLabel: '退出房间',
  };
}
