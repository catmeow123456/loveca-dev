import type {
  OnlineMatchChatMessage,
  OnlineMatchChatMessagesResponse,
  OnlineMatchSystemNotice,
  OnlineMatchSystemNoticeCode,
  Seat,
  SendOnlineMatchChatMessageInput,
} from '../../online/index.js';

const CHAT_MESSAGE_LIMIT = 500;
const CHAT_PAGE_LIMIT = 100;
const CHAT_MAX_CODE_POINTS = 200;
const CHAT_MAX_LINES = 3;
const CHAT_RATE_WINDOW_MS = 10_000;
const CHAT_RATE_WINDOW_LIMIT = 5;
const CHAT_BURST_WINDOW_MS = 1_000;
const CHAT_BURST_LIMIT = 3;

interface StoredOnlineMatchPlayerChatMessage {
  readonly messageType: 'PLAYER';
  readonly messageSeq: number;
  readonly senderUserId: string;
  readonly senderSeat: Seat;
  readonly senderDisplayName: string;
  readonly clientMessageId: string;
  readonly text: string;
  readonly sentAt: number;
}

interface StoredOnlineMatchSystemNotice extends OnlineMatchSystemNotice {
  readonly dedupeKey: string;
}

type StoredOnlineMatchChatMessage =
  StoredOnlineMatchPlayerChatMessage | StoredOnlineMatchSystemNotice;

interface ChatRateWindow {
  readonly acceptedAt: number[];
}

export interface OnlineMatchChatRuntimeState {
  nextMessageSeq: number;
  readonly messages: StoredOnlineMatchChatMessage[];
  readonly messageSeqByIdempotencyKey: Map<string, number>;
  readonly systemNoticeSeqByDedupeKey: Map<string, number>;
  readonly rateWindowsByUserId: Map<string, ChatRateWindow>;
}

export interface OnlineMatchChatSender {
  readonly userId: string;
  readonly seat: Seat;
  readonly displayName: string;
}

export class OnlineMatchChatRuntimeError extends Error {
  readonly code: string;
  readonly statusCode: number;
  readonly retryAfterMs?: number;

  constructor(code: string, message: string, statusCode = 400, retryAfterMs?: number) {
    super(message);
    this.name = 'OnlineMatchChatRuntimeError';
    this.code = code;
    this.statusCode = statusCode;
    this.retryAfterMs = retryAfterMs;
  }
}

export function createOnlineMatchChatRuntime(): OnlineMatchChatRuntimeState {
  return {
    nextMessageSeq: 1,
    messages: [],
    messageSeqByIdempotencyKey: new Map<string, number>(),
    systemNoticeSeqByDedupeKey: new Map<string, number>(),
    rateWindowsByUserId: new Map<string, ChatRateWindow>(),
  };
}

export function appendOnlineMatchChatMessage(
  runtime: OnlineMatchChatRuntimeState,
  sender: OnlineMatchChatSender,
  input: SendOnlineMatchChatMessageInput,
  options: {
    readonly now: number;
    readonly blockedTerms: readonly string[];
  }
): OnlineMatchChatMessage {
  const clientMessageId = normalizeClientMessageId(input.clientMessageId);
  const text = normalizeChatText(input.text);
  const idempotencyKey = buildIdempotencyKey(sender.userId, clientMessageId);
  const existingMessageSeq = runtime.messageSeqByIdempotencyKey.get(idempotencyKey);

  if (existingMessageSeq !== undefined) {
    const existing = runtime.messages.find(
      (message): message is StoredOnlineMatchPlayerChatMessage =>
        message.messageType === 'PLAYER' &&
        message.messageSeq === existingMessageSeq &&
        message.senderUserId === sender.userId &&
        message.clientMessageId === clientMessageId
    );
    if (existing && existing.text === text) {
      return toMessageView(existing);
    }
    throw new OnlineMatchChatRuntimeError(
      'ONLINE_CHAT_IDEMPOTENCY_CONFLICT',
      '这条消息的提交标识已经被其他内容使用',
      409
    );
  }

  assertTextAllowed(text, options.blockedTerms);
  consumeChatRateLimit(runtime, sender.userId, options.now);

  const stored: StoredOnlineMatchChatMessage = {
    messageType: 'PLAYER',
    messageSeq: runtime.nextMessageSeq,
    senderUserId: sender.userId,
    senderSeat: sender.seat,
    senderDisplayName: sender.displayName,
    clientMessageId,
    text,
    sentAt: options.now,
  };
  runtime.nextMessageSeq += 1;
  runtime.messages.push(stored);
  runtime.messageSeqByIdempotencyKey.set(idempotencyKey, stored.messageSeq);

  while (runtime.messages.length > CHAT_MESSAGE_LIMIT) {
    removeOldestMessage(runtime);
  }

  return toMessageView(stored);
}

export function appendOnlineMatchSystemNotice(
  runtime: OnlineMatchChatRuntimeState,
  input: {
    readonly dedupeKey: string;
    readonly noticeCode: OnlineMatchSystemNoticeCode;
    readonly text: string;
  },
  options: { readonly now: number }
): OnlineMatchSystemNotice {
  const dedupeKey = normalizeSystemDedupeKey(input.dedupeKey);
  const existingMessageSeq = runtime.systemNoticeSeqByDedupeKey.get(dedupeKey);
  if (existingMessageSeq !== undefined) {
    const existing = runtime.messages.find(
      (message): message is StoredOnlineMatchSystemNotice =>
        message.messageType === 'SYSTEM_NOTICE' &&
        message.messageSeq === existingMessageSeq &&
        message.dedupeKey === dedupeKey
    );
    if (existing) return toSystemNoticeView(existing);
  }
  const stored: StoredOnlineMatchSystemNotice = {
    messageType: 'SYSTEM_NOTICE',
    messageSeq: runtime.nextMessageSeq,
    dedupeKey,
    noticeCode: input.noticeCode,
    text: normalizeChatText(input.text),
    sentAt: options.now,
  };
  runtime.nextMessageSeq += 1;
  runtime.messages.push(stored);
  runtime.systemNoticeSeqByDedupeKey.set(dedupeKey, stored.messageSeq);
  while (runtime.messages.length > CHAT_MESSAGE_LIMIT) {
    removeOldestMessage(runtime);
  }
  return toSystemNoticeView(stored);
}

export function readOnlineMatchChatMessages(
  runtime: OnlineMatchChatRuntimeState,
  matchId: string,
  afterSeqInput = 0
): OnlineMatchChatMessagesResponse {
  const currentSeq = runtime.nextMessageSeq - 1;
  const afterSeq = Math.min(
    Number.isSafeInteger(afterSeqInput) && afterSeqInput >= 0 ? afterSeqInput : 0,
    currentSeq
  );
  const oldestAvailableSeq = runtime.messages[0]?.messageSeq ?? runtime.nextMessageSeq;
  const truncated = runtime.messages.length > 0 && afterSeq < Math.max(0, oldestAvailableSeq - 1);
  const effectiveAfterSeq = truncated ? oldestAvailableSeq - 1 : afterSeq;
  const available = runtime.messages.filter((message) => message.messageSeq > effectiveAfterSeq);
  const page = available.slice(0, CHAT_PAGE_LIMIT);
  const nextAfterSeq = page.at(-1)?.messageSeq ?? effectiveAfterSeq;

  return {
    matchId,
    messages: page.map(toMessageView),
    currentSeq,
    nextAfterSeq,
    oldestAvailableSeq,
    truncated,
    hasMore: available.length > page.length,
  };
}

export function readOnlineMatchChatBlockedTerms(
  raw = process.env.ONLINE_CHAT_BLOCKED_TERMS
): readonly string[] {
  const defaults = ['操你妈', '草你妈', '傻逼', '去死', '死全家'];
  const configured =
    raw
      ?.split(',')
      .map((term) => term.trim())
      .filter(Boolean) ?? [];
  return [...new Set([...defaults, ...configured].map(normalizeComparableText).filter(Boolean))];
}

function normalizeClientMessageId(value: string): string {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized || normalized.length > 128) {
    throw new OnlineMatchChatRuntimeError(
      'ONLINE_CHAT_INVALID_CLIENT_MESSAGE_ID',
      '消息提交标识非法'
    );
  }
  return normalized;
}

function normalizeChatText(value: string): string {
  if (typeof value !== 'string') {
    throw new OnlineMatchChatRuntimeError('ONLINE_CHAT_INVALID_TEXT', '请输入聊天内容');
  }
  const normalized = value.normalize('NFC').replace(/\r\n?/gu, '\n').trim();
  if (!normalized) {
    throw new OnlineMatchChatRuntimeError('ONLINE_CHAT_EMPTY_MESSAGE', '请输入聊天内容');
  }
  if ([...normalized].some(hasDisallowedControlCharacter)) {
    throw new OnlineMatchChatRuntimeError(
      'ONLINE_CHAT_INVALID_CONTROL_CHARACTER',
      '聊天内容包含不支持的控制字符'
    );
  }
  if (normalized.split('\n').length > CHAT_MAX_LINES) {
    throw new OnlineMatchChatRuntimeError(
      'ONLINE_CHAT_TOO_MANY_LINES',
      `聊天内容最多 ${CHAT_MAX_LINES} 行`
    );
  }
  if ([...normalized].length > CHAT_MAX_CODE_POINTS) {
    throw new OnlineMatchChatRuntimeError(
      'ONLINE_CHAT_MESSAGE_TOO_LONG',
      `聊天内容最多 ${CHAT_MAX_CODE_POINTS} 个字符`
    );
  }
  return normalized;
}

function assertTextAllowed(text: string, blockedTerms: readonly string[]): void {
  const comparableText = normalizeComparableText(text);
  if (
    blockedTerms.some((term) => {
      const comparableTerm = normalizeComparableText(term);
      return comparableTerm.length > 0 && comparableText.includes(comparableTerm);
    })
  ) {
    throw new OnlineMatchChatRuntimeError(
      'ONLINE_CHAT_CONTENT_BLOCKED',
      '聊天内容包含不适合发送的文字，请修改后重试',
      422
    );
  }
}

function normalizeComparableText(value: string): string {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase('zh-CN')
    .replace(/[\s\u200B-\u200D\uFEFF._\-*]+/gu, '');
}

function consumeChatRateLimit(
  runtime: OnlineMatchChatRuntimeState,
  userId: string,
  now: number
): void {
  const current = runtime.rateWindowsByUserId.get(userId) ?? { acceptedAt: [] };
  const acceptedAt = current.acceptedAt.filter(
    (timestamp) => now - timestamp < CHAT_RATE_WINDOW_MS
  );
  const inBurstWindow = acceptedAt.filter((timestamp) => now - timestamp < CHAT_BURST_WINDOW_MS);

  if (acceptedAt.length >= CHAT_RATE_WINDOW_LIMIT || inBurstWindow.length >= CHAT_BURST_LIMIT) {
    const windowRetryAfter =
      acceptedAt.length >= CHAT_RATE_WINDOW_LIMIT
        ? CHAT_RATE_WINDOW_MS - (now - acceptedAt[0]!)
        : 0;
    const burstRetryAfter =
      inBurstWindow.length >= CHAT_BURST_LIMIT
        ? CHAT_BURST_WINDOW_MS - (now - inBurstWindow[0]!)
        : 0;
    throw new OnlineMatchChatRuntimeError(
      'ONLINE_CHAT_RATE_LIMITED',
      '消息发送太快，请稍后再试',
      429,
      Math.max(1, windowRetryAfter, burstRetryAfter)
    );
  }

  acceptedAt.push(now);
  runtime.rateWindowsByUserId.set(userId, { acceptedAt });
}

function hasDisallowedControlCharacter(character: string): boolean {
  const codePoint = character.codePointAt(0);
  return (
    codePoint !== undefined &&
    ((codePoint >= 0 && codePoint <= 9) ||
      (codePoint >= 11 && codePoint <= 31) ||
      (codePoint >= 127 && codePoint <= 159))
  );
}

function buildIdempotencyKey(userId: string, clientMessageId: string): string {
  return JSON.stringify([userId, clientMessageId]);
}

function toMessageView(message: StoredOnlineMatchChatMessage): OnlineMatchChatMessage {
  return message.messageType === 'PLAYER'
    ? {
        messageType: 'PLAYER',
        messageSeq: message.messageSeq,
        senderSeat: message.senderSeat,
        senderDisplayName: message.senderDisplayName,
        text: message.text,
        sentAt: message.sentAt,
      }
    : {
        messageType: 'SYSTEM_NOTICE',
        messageSeq: message.messageSeq,
        noticeCode: message.noticeCode,
        text: message.text,
        sentAt: message.sentAt,
      };
}

function toSystemNoticeView(message: StoredOnlineMatchSystemNotice): OnlineMatchSystemNotice {
  return {
    messageType: 'SYSTEM_NOTICE',
    messageSeq: message.messageSeq,
    noticeCode: message.noticeCode,
    text: message.text,
    sentAt: message.sentAt,
  };
}

function normalizeSystemDedupeKey(value: string): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > 160) {
    throw new OnlineMatchChatRuntimeError(
      'ONLINE_CHAT_INVALID_SYSTEM_DEDUPE_KEY',
      '系统消息去重标识非法'
    );
  }
  return normalized;
}

function removeOldestMessage(runtime: OnlineMatchChatRuntimeState): void {
  const removed = runtime.messages.shift();
  if (!removed) return;
  if (removed.messageType === 'PLAYER') {
    runtime.messageSeqByIdempotencyKey.delete(
      buildIdempotencyKey(removed.senderUserId, removed.clientMessageId)
    );
  } else {
    runtime.systemNoticeSeqByDedupeKey.delete(removed.dedupeKey);
  }
}
