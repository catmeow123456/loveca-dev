import { describe, expect, it } from 'vitest';
import {
  findLatestOpponentChatMessage,
  formatMatchChatPreviewText,
} from '../../client/src/lib/matchChatPreview';
import type { OnlineMatchChatEntry } from '../../src/online/chat-types';

function createMessage(
  messageSeq: number,
  senderSeat: OnlineMatchChatEntry['senderSeat'],
  text: string
): OnlineMatchChatEntry {
  return {
    kind: 'TEXT',
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

  it('同一时间流中也能选择最新的对手表情', () => {
    const ownText = createMessage(1, 'FIRST', '自己的消息');
    const opponentEmote: OnlineMatchChatEntry = {
      kind: 'EMOTE',
      messageSeq: 2,
      senderSeat: 'SECOND',
      senderDisplayName: 'Beta',
      emoteId: 'DEEP_THINKING',
      emote: {
        label: '深度思考中…',
        staticImageUrl: `/images/emotes/${'a'.repeat(64)}.webp`,
        animatedImageUrl: `/images/emotes/${'b'.repeat(64)}.webp`,
        assetRevision: `sha256:${'c'.repeat(64)}`,
      },
      sentAt: 2,
    };

    expect(findLatestOpponentChatMessage([ownText, opponentEmote], 'FIRST')).toEqual(opponentEmote);
  });
});
