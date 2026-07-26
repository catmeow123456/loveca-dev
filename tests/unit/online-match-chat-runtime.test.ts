import { describe, expect, it } from 'vitest';
import {
  appendOnlineMatchChatMessage,
  createOnlineMatchChatRuntime,
  OnlineMatchChatRuntimeError,
  readOnlineMatchChatMessages,
} from '../../src/server/services/online-match-chat-runtime';

const FIRST_SENDER = {
  userId: 'u1',
  seat: 'FIRST' as const,
  displayName: 'Alpha',
};

describe('online match chat runtime', () => {
  it('按服务端序号追加消息并支持游标分页', () => {
    const runtime = createOnlineMatchChatRuntime();

    for (let index = 0; index < 105; index += 1) {
      appendOnlineMatchChatMessage(
        runtime,
        FIRST_SENDER,
        { clientMessageId: `message-${index}`, text: `消息 ${index}` },
        { now: index * 2_001, blockedTerms: [] }
      );
    }

    const firstPage = readOnlineMatchChatMessages(runtime, 'match-1', 0);
    expect(firstPage).toMatchObject({
      matchId: 'match-1',
      currentSeq: 105,
      nextAfterSeq: 100,
      oldestAvailableSeq: 1,
      truncated: false,
      hasMore: true,
    });
    expect(firstPage.messages).toHaveLength(100);

    const secondPage = readOnlineMatchChatMessages(runtime, 'match-1', firstPage.nextAfterSeq);
    expect(secondPage.messages.map((message) => message.messageSeq)).toEqual([
      101, 102, 103, 104, 105,
    ]);
    expect(secondPage.hasMore).toBe(false);
  });

  it('相同提交标识与正文幂等，冲突正文被拒绝', () => {
    const runtime = createOnlineMatchChatRuntime();
    const input = { clientMessageId: 'stable-message', text: '  好局  ' };

    const first = appendOnlineMatchChatMessage(runtime, FIRST_SENDER, input, {
      now: 1_000,
      blockedTerms: [],
    });
    const repeated = appendOnlineMatchChatMessage(runtime, FIRST_SENDER, input, {
      now: 1_001,
      blockedTerms: [],
    });

    expect(repeated).toEqual(first);
    expect(runtime.messages).toHaveLength(1);
    expectRuntimeError(
      () =>
        appendOnlineMatchChatMessage(
          runtime,
          FIRST_SENDER,
          { clientMessageId: 'stable-message', text: '不同正文' },
          { now: 1_002, blockedTerms: [] }
        ),
      {
        code: 'ONLINE_CHAT_IDEMPOTENCY_CONFLICT',
        statusCode: 409,
      }
    );
  });

  it('限制短时突发、十秒窗口并返回等待时间', () => {
    const runtime = createOnlineMatchChatRuntime();
    for (let index = 0; index < 3; index += 1) {
      appendOnlineMatchChatMessage(
        runtime,
        FIRST_SENDER,
        { clientMessageId: `burst-${index}`, text: `消息 ${index}` },
        { now: 2_000, blockedTerms: [] }
      );
    }

    expectRuntimeError(
      () =>
        appendOnlineMatchChatMessage(
          runtime,
          FIRST_SENDER,
          { clientMessageId: 'burst-blocked', text: '第四条' },
          { now: 2_000, blockedTerms: [] }
        ),
      {
        code: 'ONLINE_CHAT_RATE_LIMITED',
        statusCode: 429,
        retryAfterMs: 1_000,
      }
    );

    appendOnlineMatchChatMessage(
      runtime,
      FIRST_SENDER,
      { clientMessageId: 'window-four', text: '第四条' },
      { now: 3_000, blockedTerms: [] }
    );
    appendOnlineMatchChatMessage(
      runtime,
      FIRST_SENDER,
      { clientMessageId: 'window-five', text: '第五条' },
      { now: 3_000, blockedTerms: [] }
    );
    expectRuntimeError(
      () =>
        appendOnlineMatchChatMessage(
          runtime,
          FIRST_SENDER,
          { clientMessageId: 'window-blocked', text: '第六条' },
          { now: 3_000, blockedTerms: [] }
        ),
      {
        code: 'ONLINE_CHAT_RATE_LIMITED',
        statusCode: 429,
        retryAfterMs: 9_000,
      }
    );
  });

  it('拒绝超长、多行、控制字符和命中过滤的文本', () => {
    const cases = [
      {
        text: 'x'.repeat(201),
        code: 'ONLINE_CHAT_MESSAGE_TOO_LONG',
      },
      {
        text: '一\n二\n三\n四',
        code: 'ONLINE_CHAT_TOO_MANY_LINES',
      },
      {
        text: '控制\u0000字符',
        code: 'ONLINE_CHAT_INVALID_CONTROL_CHARACTER',
      },
      {
        text: '这是一段禁 止_词内容',
        code: 'ONLINE_CHAT_CONTENT_BLOCKED',
        blockedTerms: ['禁止词'],
      },
    ];

    cases.forEach((testCase, index) => {
      const runtime = createOnlineMatchChatRuntime();
      expectRuntimeError(
        () =>
          appendOnlineMatchChatMessage(
            runtime,
            FIRST_SENDER,
            { clientMessageId: `invalid-${index}`, text: testCase.text },
            { now: 1_000, blockedTerms: testCase.blockedTerms ?? [] }
          ),
        {
          code: testCase.code,
        }
      );
    });
  });

  it('只保留最近五百条并向落后游标报告截断', () => {
    const runtime = createOnlineMatchChatRuntime();
    for (let index = 0; index < 501; index += 1) {
      appendOnlineMatchChatMessage(
        runtime,
        FIRST_SENDER,
        { clientMessageId: `retained-${index}`, text: `消息 ${index}` },
        { now: index * 2_001, blockedTerms: [] }
      );
    }

    const response = readOnlineMatchChatMessages(runtime, 'match-1', 0);
    expect(runtime.messages).toHaveLength(500);
    expect(response).toMatchObject({
      currentSeq: 501,
      oldestAvailableSeq: 2,
      truncated: true,
      nextAfterSeq: 101,
      hasMore: true,
    });
    expect(response.messages[0]?.messageSeq).toBe(2);
  });
});

function expectRuntimeError(
  callback: () => unknown,
  expected: Partial<OnlineMatchChatRuntimeError>
): void {
  try {
    callback();
  } catch (error) {
    expect(error).toBeInstanceOf(OnlineMatchChatRuntimeError);
    expect(error).toMatchObject(expected);
    return;
  }
  throw new Error('预期聊天运行态抛出错误');
}
