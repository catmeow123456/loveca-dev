import type { OnlineMatchChatEntry, Seat } from '@game/online';

export function findLatestOpponentChatMessage(
  messages: readonly OnlineMatchChatEntry[],
  viewerSeat: Seat
): OnlineMatchChatEntry | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message && (message.messageType === 'SYSTEM_NOTICE' || message.senderSeat !== viewerSeat)) {
      return message;
    }
  }
  return null;
}

export function formatMatchChatPreviewText(text: string): string {
  return text.replace(/\s+/gu, ' ').trim();
}
