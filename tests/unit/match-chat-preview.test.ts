import { describe, expect, it } from 'vitest';
import {
  findLatestOpponentChatMessage,
  formatMatchChatPreviewText,
} from '../../client/src/lib/matchChatPreview';
import type { OnlineMatchChatMessage } from '../../src/online/chat-types';

function createMessage(
  messageSeq: number,
  senderSeat: OnlineMatchChatMessage['senderSeat'],
  text: string
): OnlineMatchChatMessage {
  return {
    messageSeq,
    senderSeat,
    senderDisplayName: senderSeat === 'FIRST' ? 'Alpha' : 'Beta',
    text,
    sentAt: messageSeq,
  };
}

describe('match chat preview', () => {
  it('只选择最新一条对手消息作为短暂预览', () => {
    const messages = [
      createMessage(1, 'SECOND', '较早的对手消息'),
      createMessage(2, 'FIRST', '自己的消息'),
      createMessage(3, 'SECOND', '最新的对手消息'),
    ];

    expect(findLatestOpponentChatMessage(messages, 'FIRST')).toEqual(messages[2]);
    expect(findLatestOpponentChatMessage([messages[1]!], 'FIRST')).toBeNull();
  });

  it('将多行和连续空白收敛为单行预览', () => {
    expect(formatMatchChatPreviewText('  等一下\n我看下   卡文  ')).toBe('等一下 我看下 卡文');
  });
});
