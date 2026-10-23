import type { OnlineRoomEndReason } from '@game/online';

export function getOpeningEndMessage(reason: OnlineRoomEndReason, themeRequeued = false): string {
  if (reason === 'DECK_POINT_TABLE_CHANGED')
    return '开局前卡组已不符合当前 PT 限制，本轮已关闭，请重新选组。';
  if (reason === 'OPENING_TIMEOUT') return '未在开局期限内完成猜拳和先后手选择，本轮已关闭。';
  return themeRequeued
    ? '本次配对未能开始；你没有造成中断，已保留原候场顺序并自动返回主题牌桌队列。'
    : '等待 60 秒后仍未等到双方进入房间，本次配对已取消。';
}

export function getCasualClosureMessage(reason: string): string {
  switch (reason) {
    case 'OPENING_ARRIVAL_TIMEOUT':
    case 'OPENING_TIMEOUT':
    case 'DECK_POINT_TABLE_CHANGED':
      return getOpeningEndMessage(reason);
    case 'PLAYER_LEFT_OPENING':
      return '本轮开局已被退出，双方席位已释放。';
    case 'HEARTBEAT_EXPIRED':
      return '等待期间连接已失效，席位已释放，可以重新找人。';
    case 'CONFIRMATION_EXPIRED':
      return '未在期限内完成双方确认，本次配对已结束。';
    case 'DECK_NO_LONGER_LEGAL':
    case 'BOOTSTRAP_INPUT_INVALID':
      return '本轮准备信息已失效，席位已释放，请重新选组。';
    case 'BOOTSTRAP_ATTEMPTS_EXHAUSTED':
      return '本轮开局未能完成，席位已释放，可以重新找人。';
    case 'RUNTIME_UNAVAILABLE':
      return '对局运行态无法恢复，席位已释放。';
    default:
      return '上一次房间已关闭，可以重新找人或创建房间。';
  }
}
