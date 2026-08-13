import { describe, expect, it, vi } from 'vitest';
import type { OnlineMatchEmoteSnapshot } from '../../src/online/chat-types';
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
const CATALOG_VERSION = '00000000-0000-4000-8000-000000000201';
const EMOTE_IDS = [
  'DEEP_THINKING',
  'THANK_YOU',
  'NICE_TO_MEET_YOU',
  'NICE_PLAY',
  'GOOD_GAME',
  'SORRY_TO_KEEP_YOU_WAITING',
] as const;
const EMOTE_ID_SET = new Set<string>(EMOTE_IDS);

describe('online match chat runtime', () => {
  it('按服务端序号追加消息并支持游标分页', async () => {
    const runtime = createOnlineMatchChatRuntime();

    for (let index = 0; index < 105; index += 1) {
      await appendOnlineMatchChatMessage(
        runtime,
        FIRST_SENDER,
        { kind: 'TEXT', clientMessageId: `message-${index}`, text: `消息 ${index}` },
        runtimeOptions(index * 2_001)
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

  it('相同提交标识与正文幂等，冲突正文被拒绝', async () => {
    const runtime = createOnlineMatchChatRuntime();
    const input = { kind: 'TEXT' as const, clientMessageId: 'stable-message', text: '  好局  ' };

    const first = await appendOnlineMatchChatMessage(
      runtime,
      FIRST_SENDER,
      input,
      runtimeOptions(1_000)
    );
    const repeated = await appendOnlineMatchChatMessage(
      runtime,
      FIRST_SENDER,
      input,
      runtimeOptions(1_001)
    );

    expect(repeated).toEqual(first);
    expect(runtime.messages).toHaveLength(1);
    await expectRuntimeError(
      () =>
        appendOnlineMatchChatMessage(
          runtime,
          FIRST_SENDER,
          { kind: 'TEXT', clientMessageId: 'stable-message', text: '不同正文' },
          runtimeOptions(1_002)
        ),
      { code: 'ONLINE_CHAT_IDEMPOTENCY_CONFLICT', statusCode: 409 }
    );
  });

  it('按动态目录接受表情并把发送时资源快照写入消息', async () => {
    const runtime = createOnlineMatchChatRuntime();

    for (const [index, emoteId] of EMOTE_IDS.entries()) {
      await appendOnlineMatchChatMessage(
        runtime,
        FIRST_SENDER,
        {
          kind: 'EMOTE',
          clientMessageId: `emote-${index}`,
          emoteId,
          catalogVersion: CATALOG_VERSION,
        },
        runtimeOptions(index * 2_001)
      );
    }

    expect(readOnlineMatchChatMessages(runtime, 'match-1').messages).toEqual(
      EMOTE_IDS.map((emoteId, index) => ({
        kind: 'EMOTE',
        messageSeq: index + 1,
        senderSeat: 'FIRST',
        senderDisplayName: 'Alpha',
        emoteId,
        emote: snapshotFor(emoteId),
        sentAt: index * 2_001,
      }))
    );
    await expectRuntimeError(
      () =>
        appendOnlineMatchChatMessage(
          runtime,
          FIRST_SENDER,
          {
            kind: 'EMOTE',
            clientMessageId: 'unknown-emote',
            emoteId: 'TAUNT',
            catalogVersion: CATALOG_VERSION,
          },
          runtimeOptions(20_000)
        ),
      { code: 'ONLINE_CHAT_EMOTE_UNAVAILABLE', statusCode: 422 }
    );
  });

  it('已接受表情的幂等重试不重新读取已经变化的目录', async () => {
    const runtime = createOnlineMatchChatRuntime();
    const input = {
      kind: 'EMOTE' as const,
      clientMessageId: 'stable-emote',
      emoteId: 'GOOD_GAME',
      catalogVersion: CATALOG_VERSION,
    };
    let available = true;
    const resolveEmote = (id: string) => Promise.resolve(available ? snapshotFor(id) : null);
    const first = await appendOnlineMatchChatMessage(runtime, FIRST_SENDER, input, {
      ...runtimeOptions(1_000),
      resolveEmote,
    });
    available = false;
    const repeated = await appendOnlineMatchChatMessage(runtime, FIRST_SENDER, input, {
      ...runtimeOptions(1_001),
      resolveEmote,
    });

    expect(repeated).toEqual(first);
    expect(runtime.messages).toHaveLength(1);
  });

  it('并发的同一表情幂等提交只写入一条消息', async () => {
    const runtime = createOnlineMatchChatRuntime();
    const input = emoteInput('concurrent-emote', 'GOOD_GAME');
    let releaseCatalog!: (snapshot: OnlineMatchEmoteSnapshot) => void;
    const catalogGate = new Promise<OnlineMatchEmoteSnapshot>((resolve) => {
      releaseCatalog = resolve;
    });
    const options = {
      ...runtimeOptions(1_000),
      resolveEmote: () => catalogGate,
    };

    const first = appendOnlineMatchChatMessage(runtime, FIRST_SENDER, input, options);
    const second = appendOnlineMatchChatMessage(runtime, FIRST_SENDER, input, options);
    releaseCatalog(snapshotFor('GOOD_GAME'));

    const [firstResult, secondResult] = await Promise.all([first, second]);
    expect(secondResult).toEqual(firstResult);
    expect(runtime.messages).toHaveLength(1);
    expect(runtime.nextMessageSeq).toBe(2);
  });

  it('表情额外遵守两秒冷却，文字仍与表情共用综合限频', async () => {
    const runtime = createOnlineMatchChatRuntime();
    await appendOnlineMatchChatMessage(
      runtime,
      FIRST_SENDER,
      emoteInput('thinking', 'DEEP_THINKING'),
      runtimeOptions(1_000)
    );

    await expectRuntimeError(
      () =>
        appendOnlineMatchChatMessage(
          runtime,
          FIRST_SENDER,
          emoteInput('thanks-too-soon', 'THANK_YOU'),
          runtimeOptions(2_250)
        ),
      { code: 'ONLINE_CHAT_EMOTE_COOLDOWN', statusCode: 429, retryAfterMs: 750 }
    );
    await appendOnlineMatchChatMessage(
      runtime,
      FIRST_SENDER,
      { kind: 'TEXT', clientMessageId: 'text-between', text: '还在看卡文' },
      runtimeOptions(2_250)
    );
    const accepted = await appendOnlineMatchChatMessage(
      runtime,
      FIRST_SENDER,
      emoteInput('thanks-later', 'THANK_YOU'),
      runtimeOptions(3_000)
    );
    expect(accepted).toMatchObject({ kind: 'EMOTE', messageSeq: 3, emoteId: 'THANK_YOU' });
  });

  it('幂等提交同时比较条目种类和表情编号', async () => {
    const runtime = createOnlineMatchChatRuntime();
    const input = emoteInput('stable-emote', 'GOOD_GAME');
    const first = await appendOnlineMatchChatMessage(
      runtime,
      FIRST_SENDER,
      input,
      runtimeOptions(1_000)
    );
    expect(
      await appendOnlineMatchChatMessage(runtime, FIRST_SENDER, input, runtimeOptions(1_001))
    ).toEqual(first);
    await expectRuntimeError(
      () =>
        appendOnlineMatchChatMessage(
          runtime,
          FIRST_SENDER,
          emoteInput('stable-emote', 'THANK_YOU'),
          runtimeOptions(3_001)
        ),
      { code: 'ONLINE_CHAT_IDEMPOTENCY_CONFLICT', statusCode: 409 }
    );
    await expectRuntimeError(
      () =>
        appendOnlineMatchChatMessage(
          runtime,
          FIRST_SENDER,
          { kind: 'TEXT', clientMessageId: 'stable-emote', text: '好局！' },
          runtimeOptions(3_001)
        ),
      { code: 'ONLINE_CHAT_IDEMPOTENCY_CONFLICT', statusCode: 409 }
    );
  });

  it('限制短时突发、十秒窗口并返回等待时间', async () => {
    const runtime = createOnlineMatchChatRuntime();
    for (let index = 0; index < 3; index += 1) {
      await appendOnlineMatchChatMessage(
        runtime,
        FIRST_SENDER,
        { kind: 'TEXT', clientMessageId: `burst-${index}`, text: `消息 ${index}` },
        runtimeOptions(2_000)
      );
    }

    await expectRuntimeError(
      () =>
        appendOnlineMatchChatMessage(
          runtime,
          FIRST_SENDER,
          { kind: 'TEXT', clientMessageId: 'burst-blocked', text: '第四条' },
          runtimeOptions(2_000)
        ),
      { code: 'ONLINE_CHAT_RATE_LIMITED', statusCode: 429, retryAfterMs: 1_000 }
    );

    await appendOnlineMatchChatMessage(
      runtime,
      FIRST_SENDER,
      { kind: 'TEXT', clientMessageId: 'window-four', text: '第四条' },
      runtimeOptions(3_000)
    );
    await appendOnlineMatchChatMessage(
      runtime,
      FIRST_SENDER,
      { kind: 'TEXT', clientMessageId: 'window-five', text: '第五条' },
      runtimeOptions(3_000)
    );
    await expectRuntimeError(
      () =>
        appendOnlineMatchChatMessage(
          runtime,
          FIRST_SENDER,
          { kind: 'TEXT', clientMessageId: 'window-blocked', text: '第六条' },
          runtimeOptions(3_000)
        ),
      { code: 'ONLINE_CHAT_RATE_LIMITED', statusCode: 429, retryAfterMs: 9_000 }
    );
  });

  it('达到综合限频时不再查询动态表情目录', async () => {
    const runtime = createOnlineMatchChatRuntime();
    for (let index = 0; index < 5; index += 1) {
      await appendOnlineMatchChatMessage(
        runtime,
        FIRST_SENDER,
        { kind: 'TEXT', clientMessageId: `rate-${index}`, text: `消息 ${index}` },
        runtimeOptions(index * 1_001)
      );
    }
    const resolveEmote = vi.fn(() => Promise.resolve(snapshotFor('GOOD_GAME')));

    await expectRuntimeError(
      () =>
        appendOnlineMatchChatMessage(runtime, FIRST_SENDER, emoteInput('rate-emote', 'GOOD_GAME'), {
          ...runtimeOptions(5_005),
          resolveEmote,
        }),
      { code: 'ONLINE_CHAT_RATE_LIMITED', statusCode: 429 }
    );
    expect(resolveEmote).not.toHaveBeenCalled();
  });

  it('拒绝超长、多行、控制字符和命中过滤的文本', async () => {
    const cases = [
      { text: 'x'.repeat(201), code: 'ONLINE_CHAT_MESSAGE_TOO_LONG' },
      { text: '一\n二\n三\n四', code: 'ONLINE_CHAT_TOO_MANY_LINES' },
      { text: '控制\u0000字符', code: 'ONLINE_CHAT_INVALID_CONTROL_CHARACTER' },
      {
        text: '这是一段禁 止_词内容',
        code: 'ONLINE_CHAT_CONTENT_BLOCKED',
        blockedTerms: ['禁止词'],
      },
    ];

    for (const [index, testCase] of cases.entries()) {
      const runtime = createOnlineMatchChatRuntime();
      await expectRuntimeError(
        () =>
          appendOnlineMatchChatMessage(
            runtime,
            FIRST_SENDER,
            { kind: 'TEXT', clientMessageId: `invalid-${index}`, text: testCase.text },
            runtimeOptions(1_000, testCase.blockedTerms ?? [])
          ),
        { code: testCase.code }
      );
    }
  });

  it('只保留最近五百条并向落后游标报告截断', async () => {
    const runtime = createOnlineMatchChatRuntime();
    for (let index = 0; index < 501; index += 1) {
      await appendOnlineMatchChatMessage(
        runtime,
        FIRST_SENDER,
        { kind: 'TEXT', clientMessageId: `retained-${index}`, text: `消息 ${index}` },
        runtimeOptions(index * 2_001)
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

function emoteInput(clientMessageId: string, emoteId: string) {
  return { kind: 'EMOTE' as const, clientMessageId, emoteId, catalogVersion: CATALOG_VERSION };
}

function snapshotFor(emoteId: string): OnlineMatchEmoteSnapshot {
  return {
    label: emoteId,
    staticImageUrl: `/images/emotes/${'a'.repeat(64)}.webp`,
    animatedImageUrl: emoteId === 'DEEP_THINKING' ? `/images/emotes/${'b'.repeat(64)}.webp` : null,
    assetRevision: `sha256:${'c'.repeat(64)}`,
  };
}

function runtimeOptions(now: number, blockedTerms: readonly string[] = []) {
  return {
    now,
    blockedTerms,
    resolveEmote: (emoteId: string, catalogVersion: string) =>
      Promise.resolve(
        catalogVersion === CATALOG_VERSION && EMOTE_ID_SET.has(emoteId)
          ? snapshotFor(emoteId)
          : null
      ),
  };
}

async function expectRuntimeError(
  callback: () => Promise<unknown>,
  expected: Partial<OnlineMatchChatRuntimeError>
): Promise<void> {
  try {
    await callback();
  } catch (error) {
    expect(error).toBeInstanceOf(OnlineMatchChatRuntimeError);
    expect(error).toMatchObject(expected);
    return;
  }
  throw new Error('预期聊天运行态抛出错误');
}
