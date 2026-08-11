import { describe, expect, it } from 'vitest';
import {
  findLatestOpponentChatMessage,
  formatMatchChatPreviewText,
} from '../../client/src/lib/matchChatPreview';
import type { OnlineMatchChatEntry } from '../../src/online/chat-types';
import type { Seat } from '../../src/online/types';

function createMessage(messageSeq: number, senderSeat: Seat, text: string): OnlineMatchChatEntry {
  return {
    messageType: 'PLAYER',
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
      messageType: 'PLAYER',
      kind: 'EMOTE',
      messageSeq: 2,
      senderSeat: 'SECOND',
      senderDisplayName: 'Beta',
      emoteId: 'DEEP_THINKING',
      sentAt: 2,
    };

    expect(findLatestOpponentChatMessage([ownText, opponentEmote], 'FIRST')).toEqual(opponentEmote);
  });

  it('系统通知不伪装成任一玩家消息并仍可进入预览', () => {
    const notice: OnlineMatchChatEntry = {
      kind: 'SYSTEM_NOTICE',
      messageType: 'SYSTEM_NOTICE',
      messageSeq: 4,
      noticeCode: 'AI_FALLBACK_ENABLED',
      text: 'AI 已使用保守策略继续本局。',
      sentAt: 4,
    };

    expect(findLatestOpponentChatMessage([notice], 'FIRST')).toEqual(notice);
    expect('senderSeat' in notice).toBe(false);
  });
});
