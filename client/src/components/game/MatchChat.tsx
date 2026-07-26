import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Bell, BellOff, Eye, Loader2, MessageCircle, Send, X } from 'lucide-react';
import type { OnlineMatchChatMessage, OnlineMatchChatMessagesResponse, Seat } from '@game/online';
import {
  fetchOnlineMatchChatMessages,
  fetchOnlineSpectatorChatMessages,
  sendOnlineMatchChatMessage,
} from '@/lib/onlineClient';
import { ApiClientError } from '@/lib/apiClient';
import { findLatestOpponentChatMessage, formatMatchChatPreviewText } from '@/lib/matchChatPreview';
import { SpectatorPollingScheduler } from '@/lib/spectatorPolling';
import { cn } from '@/lib/utils';

const CHAT_POLL_INTERVAL_MS = 1_000;
const CHAT_PREVIEW_DURATION_MS = 5_000;
const CHAT_MAX_CODE_POINTS = 200;
const CHAT_MAX_LINES = 3;
const CHAT_MUTED_STORAGE_PREFIX = 'loveca.match-chat.muted.';

type MatchChatAccess =
  | {
      readonly kind: 'PARTICIPANT';
      readonly matchId: string;
      readonly viewerSeat: Seat;
    }
  | {
      readonly kind: 'SPECTATOR';
      readonly matchId: string;
      readonly viewerSeat: Seat;
      readonly token: string;
      readonly sessionId: string;
      readonly roomGeneration?: string | null;
      readonly attachmentGeneration?: number;
    };

interface MatchChatProps {
  readonly access: MatchChatAccess;
}

export const MatchChat = memo(function MatchChat({ access }: MatchChatProps) {
  const [messages, setMessages] = useState<readonly OnlineMatchChatMessage[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isMuted, setIsMuted] = useState(() => readMutedState(access.matchId));
  const [draft, setDraft] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [previewMessage, setPreviewMessage] = useState<OnlineMatchChatMessage | null>(null);
  const cursorRef = useRef(0);
  const hydratedRef = useRef(false);
  const isOpenRef = useRef(isOpen);
  const isMutedRef = useRef(isMuted);
  const previewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingClientMessageIdRef = useRef<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const reduceMotion = useReducedMotion();

  const isSpectator = access.kind === 'SPECTATOR';
  const accessKind = access.kind;
  const matchId = access.matchId;
  const viewerSeat = access.viewerSeat;
  const spectatorToken = access.kind === 'SPECTATOR' ? access.token : null;
  const spectatorSessionId = access.kind === 'SPECTATOR' ? access.sessionId : null;
  const spectatorRoomGeneration = access.kind === 'SPECTATOR' ? access.roomGeneration : undefined;
  const spectatorAttachmentGeneration =
    access.kind === 'SPECTATOR' ? access.attachmentGeneration : undefined;

  useEffect(() => {
    isMutedRef.current = isMuted;
  }, [isMuted]);

  const clearPreviewMessage = useCallback(() => {
    if (previewTimerRef.current !== null) {
      clearTimeout(previewTimerRef.current);
      previewTimerRef.current = null;
    }
    setPreviewMessage(null);
  }, []);

  const showPreviewMessage = useCallback((message: OnlineMatchChatMessage) => {
    if (previewTimerRef.current !== null) {
      clearTimeout(previewTimerRef.current);
    }
    setPreviewMessage(message);
    previewTimerRef.current = setTimeout(() => {
      previewTimerRef.current = null;
      setPreviewMessage(null);
    }, CHAT_PREVIEW_DURATION_MS);
  }, []);

  useEffect(
    () => () => {
      if (previewTimerRef.current !== null) {
        clearTimeout(previewTimerRef.current);
      }
    },
    []
  );

  const fetchPage = useCallback(
    (afterSeq: number): Promise<OnlineMatchChatMessagesResponse> => {
      if (accessKind === 'SPECTATOR' && spectatorToken && spectatorSessionId) {
        return fetchOnlineSpectatorChatMessages(
          spectatorToken,
          spectatorSessionId,
          afterSeq,
          spectatorRoomGeneration,
          spectatorAttachmentGeneration
        );
      }
      return fetchOnlineMatchChatMessages(matchId, afterSeq);
    },
    [
      accessKind,
      matchId,
      spectatorAttachmentGeneration,
      spectatorRoomGeneration,
      spectatorSessionId,
      spectatorToken,
    ]
  );

  const syncMessages = useCallback(
    async (isCurrent: () => boolean) => {
      let nextCursor = cursorRef.current;
      let shouldReplace = false;
      const incoming: OnlineMatchChatMessage[] = [];

      for (let pageIndex = 0; pageIndex < 5; pageIndex += 1) {
        const response = await fetchPage(nextCursor);
        if (!isCurrent() || response.matchId !== matchId) {
          return;
        }
        shouldReplace ||= response.truncated;
        incoming.push(...response.messages);
        nextCursor = response.nextAfterSeq;
        if (!response.hasMore) {
          break;
        }
      }

      if (!isCurrent()) {
        return;
      }
      if (incoming.length > 0 || shouldReplace) {
        setMessages((current) => mergeChatMessages(shouldReplace ? [] : current, incoming));
      }
      cursorRef.current = nextCursor;

      if (hydratedRef.current && !isOpenRef.current && incoming.length > 0) {
        const unreadIncoming = incoming.filter((message) => {
          if (isSpectator) {
            return true;
          }
          return message.senderSeat !== viewerSeat && !isMutedRef.current;
        }).length;
        if (unreadIncoming > 0) {
          setUnreadCount((current) => current + unreadIncoming);
        }
        if (!isSpectator && !isMutedRef.current) {
          const latestOpponentMessage = findLatestOpponentChatMessage(incoming, viewerSeat);
          if (latestOpponentMessage) {
            showPreviewMessage(latestOpponentMessage);
          }
        }
      }
      hydratedRef.current = true;
    },
    [fetchPage, isSpectator, matchId, showPreviewMessage, viewerSeat]
  );

  useEffect(() => {
    const scheduler = new SpectatorPollingScheduler({
      intervalMs: CHAT_POLL_INTERVAL_MS,
      poll: syncMessages,
      onSuccess: () => {
        setSyncError(null);
      },
      onError: ({ error }) => {
        setSyncError(readSyncError(error));
      },
    });
    scheduler.start();
    return () => scheduler.dispose();
  }, [syncMessages]);

  useEffect(() => {
    if (isOpen && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [isOpen, messages.length]);

  const draftCodePoints = useMemo(() => [...draft].length, [draft]);
  const draftLineCount = useMemo(() => draft.replace(/\r\n?/gu, '\n').split('\n').length, [draft]);
  const canSend =
    !isSpectator &&
    !isSending &&
    draft.trim().length > 0 &&
    draftCodePoints <= CHAT_MAX_CODE_POINTS &&
    draftLineCount <= CHAT_MAX_LINES;

  const handleDraftChange = (value: string) => {
    pendingClientMessageIdRef.current = null;
    setDraft(value);
    setSendError(null);
  };

  const handleSend = async () => {
    if (!canSend || isSpectator) {
      return;
    }
    const text = draft;
    const clientMessageId = pendingClientMessageIdRef.current ?? createClientMessageId();
    pendingClientMessageIdRef.current = clientMessageId;
    setIsSending(true);
    setSendError(null);
    try {
      const message = await sendOnlineMatchChatMessage(matchId, {
        clientMessageId,
        text,
      });
      setMessages((current) => mergeChatMessages(current, [message]));
      setDraft('');
      pendingClientMessageIdRef.current = null;
    } catch (error) {
      setSendError(readSendError(error));
    } finally {
      setIsSending(false);
    }
  };

  const handleToggleMuted = () => {
    if (isSpectator) {
      return;
    }
    const next = !isMuted;
    isMutedRef.current = next;
    setIsMuted(next);
    writeMutedState(matchId, next);
    if (next) {
      setUnreadCount(0);
      clearPreviewMessage();
    }
  };

  const handleToggleOpen = () => {
    const next = !isOpen;
    isOpenRef.current = next;
    setIsOpen(next);
    if (next) {
      setUnreadCount(0);
      clearPreviewMessage();
    }
  };

  const handleOpenFromPreview = () => {
    isOpenRef.current = true;
    setIsOpen(true);
    setUnreadCount(0);
    clearPreviewMessage();
  };

  const handleClose = () => {
    isOpenRef.current = false;
    setIsOpen(false);
  };

  return (
    <>
      <button
        type="button"
        onClick={handleToggleOpen}
        className="button-ghost relative inline-flex min-h-10 items-center justify-center gap-2 border border-[var(--border-default)] bg-[var(--bg-frosted)] px-3 shadow-[var(--shadow-md)] backdrop-blur-xl sm:min-h-11"
        aria-label={isSpectator ? '观战聊天' : '局内聊天'}
        aria-expanded={isOpen}
        title={isSpectator ? '观战聊天' : '局内聊天'}
      >
        <MessageCircle size={16} />
        <span className="hidden text-sm font-semibold sm:inline">
          {isSpectator ? '聊天' : '局内聊天'}
        </span>
        {unreadCount > 0 ? (
          <span className="absolute -right-1.5 -top-1.5 min-w-5 rounded-full bg-[var(--semantic-error)] px-1.5 py-0.5 text-center text-[10px] font-bold leading-none text-white shadow">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        ) : null}
      </button>

      {typeof document !== 'undefined'
        ? createPortal(
            <AnimatePresence initial={false}>
              {previewMessage && !isOpen && !isSpectator ? (
                <motion.button
                  key={previewMessage.messageSeq}
                  type="button"
                  onClick={handleOpenFromPreview}
                  initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -8, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -5, scale: 0.99 }}
                  transition={{ duration: reduceMotion ? 0.08 : 0.18, ease: 'easeOut' }}
                  className="fixed right-2 top-20 z-[var(--z-battle-chrome)] flex w-[min(360px,calc(100vw-1rem))] items-center gap-3 overflow-hidden rounded-xl border border-[color:color-mix(in_srgb,var(--accent-primary)_30%,var(--border-default))] bg-[var(--bg-frosted)] px-3 py-2.5 text-left shadow-[var(--shadow-lg)] backdrop-blur-xl md:right-4"
                  aria-label={`打开聊天查看 ${previewMessage.senderDisplayName} 的消息`}
                >
                  <span
                    className="h-8 w-1 shrink-0 rounded-full bg-gradient-to-b from-[var(--accent-primary)] to-[var(--accent-secondary)]"
                    aria-hidden="true"
                  />
                  <span className="min-w-0 flex-1 truncate text-sm text-[var(--text-primary)]">
                    <span className="font-bold">{previewMessage.senderDisplayName}：</span>
                    {formatMatchChatPreviewText(previewMessage.text)}
                  </span>
                  <MessageCircle
                    size={15}
                    className="shrink-0 text-[var(--text-muted)]"
                    aria-hidden="true"
                  />
                </motion.button>
              ) : null}
            </AnimatePresence>,
            document.body
          )
        : null}

      {isOpen && typeof document !== 'undefined'
        ? createPortal(
            <aside
              aria-label={isSpectator ? '观战聊天面板' : '局内聊天面板'}
              className="fixed bottom-[max(0.5rem,env(safe-area-inset-bottom))] left-2 right-2 z-[var(--z-battle-chat)] flex h-[min(68dvh,560px)] min-h-0 flex-col overflow-hidden rounded-xl border border-[var(--border-default)] bg-[var(--bg-frosted)] shadow-[var(--shadow-xl)] backdrop-blur-xl md:bottom-4 md:left-auto md:right-4 md:top-20 md:h-auto md:w-[min(370px,calc(100vw-2rem))]"
            >
              <div className="flex shrink-0 items-center justify-between gap-3 border-b border-[var(--border-subtle)] px-3 py-2.5">
                <div className="flex min-w-0 items-center gap-2.5">
                  <span className="h-7 w-1 shrink-0 rounded-full bg-gradient-to-b from-[var(--accent-primary)] to-[var(--accent-secondary)]" />
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-bold text-[var(--text-primary)]">
                        {isSpectator ? '观战聊天' : '局内聊天'}
                      </span>
                      {isSpectator ? (
                        <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-[var(--text-muted)]">
                          <Eye size={11} />
                          只读
                        </span>
                      ) : null}
                    </div>
                    <div className="mt-0.5 text-[10px] text-[var(--text-muted)]">
                      {isSpectator ? '对局双方的公开交流' : '聊天内容对本局观战者可见'}
                    </div>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {!isSpectator ? (
                    <button
                      type="button"
                      onClick={handleToggleMuted}
                      className={cn(
                        'button-icon h-8 w-8 text-[var(--text-muted)]',
                        isMuted && 'text-[var(--semantic-warning)]'
                      )}
                      aria-label={isMuted ? '取消静音对手' : '静音对手'}
                      title={isMuted ? '取消静音对手' : '静音对手'}
                    >
                      {isMuted ? <BellOff size={14} /> : <Bell size={14} />}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={handleClose}
                    className="button-icon h-8 w-8"
                    aria-label="关闭聊天"
                    title="关闭"
                  >
                    <X size={15} />
                  </button>
                </div>
              </div>

              <div
                ref={scrollRef}
                className="cute-scrollbar min-h-0 flex-1 space-y-2 overflow-y-auto px-3 py-3"
                aria-live="polite"
              >
                {messages.length === 0 ? (
                  <div className="flex h-full min-h-32 flex-col items-center justify-center px-6 text-center">
                    <MessageCircle size={22} className="text-[var(--text-muted)]" />
                    <div className="mt-2 text-sm font-semibold text-[var(--text-secondary)]">
                      还没有消息
                    </div>
                    <div className="mt-1 text-xs leading-5 text-[var(--text-muted)]">
                      {isSpectator ? '对局双方发送消息后会显示在这里。' : '可以先打个招呼。'}
                    </div>
                  </div>
                ) : (
                  messages.map((message) => (
                    <ChatMessage
                      key={message.messageSeq}
                      message={message}
                      viewerSeat={viewerSeat}
                      spectator={isSpectator}
                    />
                  ))
                )}
              </div>

              {syncError ? (
                <div className="shrink-0 border-t border-[var(--border-subtle)] px-3 py-1.5 text-[11px] text-[var(--semantic-warning)]">
                  {syncError}
                </div>
              ) : null}

              {isSpectator ? (
                <div className="shrink-0 border-t border-[var(--border-subtle)] px-3 py-2 text-center text-[11px] text-[var(--text-muted)]">
                  观战者只能查看，不能发送消息
                </div>
              ) : (
                <div className="shrink-0 border-t border-[var(--border-subtle)] p-2.5">
                  <div className="flex items-end gap-2">
                    <textarea
                      value={draft}
                      onChange={(event) => handleDraftChange(event.target.value)}
                      onKeyDown={(event) => {
                        if (
                          event.key === 'Enter' &&
                          !event.shiftKey &&
                          !event.nativeEvent.isComposing
                        ) {
                          event.preventDefault();
                          void handleSend();
                        }
                      }}
                      rows={2}
                      placeholder="输入本局消息"
                      className="cute-scrollbar min-h-11 flex-1 resize-none rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface)] px-3 py-2 text-sm leading-5 text-[var(--text-primary)] outline-none transition focus:border-[var(--accent-primary)] focus:ring-2 focus:ring-[color:color-mix(in_srgb,var(--accent-primary)_18%,transparent)]"
                      aria-label="聊天内容"
                    />
                    <button
                      type="button"
                      onClick={() => void handleSend()}
                      disabled={!canSend}
                      className="button-primary inline-flex h-11 w-11 shrink-0 items-center justify-center p-0"
                      aria-label="发送消息"
                      title="发送"
                    >
                      {isSending ? (
                        <Loader2 size={16} className="animate-spin" />
                      ) : (
                        <Send size={16} />
                      )}
                    </button>
                  </div>
                  <div className="mt-1.5 flex items-start justify-between gap-3 text-[10px]">
                    <span
                      className={cn(
                        'min-h-4 text-[var(--semantic-error)]',
                        !sendError && 'invisible'
                      )}
                      role="status"
                    >
                      {sendError ?? '无错误'}
                    </span>
                    <span
                      className={cn(
                        'shrink-0 tabular-nums text-[var(--text-muted)]',
                        (draftCodePoints > CHAT_MAX_CODE_POINTS ||
                          draftLineCount > CHAT_MAX_LINES) &&
                          'text-[var(--semantic-error)]'
                      )}
                    >
                      {draftLineCount > CHAT_MAX_LINES
                        ? `最多 ${CHAT_MAX_LINES} 行`
                        : `${draftCodePoints}/${CHAT_MAX_CODE_POINTS}`}
                    </span>
                  </div>
                </div>
              )}
            </aside>,
            document.body
          )
        : null}
    </>
  );
});

function ChatMessage({
  message,
  viewerSeat,
  spectator,
}: {
  readonly message: OnlineMatchChatMessage;
  readonly viewerSeat: Seat;
  readonly spectator: boolean;
}) {
  const isOwn = !spectator && message.senderSeat === viewerSeat;
  return (
    <div className={cn('flex', isOwn ? 'justify-end' : 'justify-start')}>
      <div
        className={cn(
          'max-w-[86%] rounded-lg border px-2.5 py-2',
          isOwn
            ? 'border-[color:color-mix(in_srgb,var(--accent-primary)_38%,transparent)] bg-[color:color-mix(in_srgb,var(--accent-primary)_13%,var(--bg-surface))]'
            : 'border-[var(--border-subtle)] bg-[color:color-mix(in_srgb,var(--bg-surface)_82%,transparent)]',
          spectator &&
            (message.senderSeat === 'FIRST'
              ? 'border-l-2 border-l-[var(--accent-primary)]'
              : 'border-l-2 border-l-[var(--accent-secondary)]')
        )}
      >
        <div className="mb-1 flex items-center justify-between gap-3 text-[10px] text-[var(--text-muted)]">
          <span className="min-w-0 truncate font-semibold">
            {isOwn ? '你' : message.senderDisplayName}
          </span>
          <time className="shrink-0 tabular-nums">
            {new Date(message.sentAt).toLocaleTimeString('zh-CN', {
              hour12: false,
              hour: '2-digit',
              minute: '2-digit',
            })}
          </time>
        </div>
        <div className="whitespace-pre-wrap break-words text-sm leading-5 text-[var(--text-primary)]">
          {message.text}
        </div>
      </div>
    </div>
  );
}

function mergeChatMessages(
  current: readonly OnlineMatchChatMessage[],
  incoming: readonly OnlineMatchChatMessage[]
): readonly OnlineMatchChatMessage[] {
  const bySeq = new Map<number, OnlineMatchChatMessage>();
  current.forEach((message) => bySeq.set(message.messageSeq, message));
  incoming.forEach((message) => bySeq.set(message.messageSeq, message));
  return [...bySeq.values()].sort((left, right) => left.messageSeq - right.messageSeq).slice(-500);
}

function readMutedState(matchId: string): boolean {
  try {
    return window.sessionStorage.getItem(`${CHAT_MUTED_STORAGE_PREFIX}${matchId}`) === '1';
  } catch {
    return false;
  }
}

function writeMutedState(matchId: string, muted: boolean): void {
  try {
    const key = `${CHAT_MUTED_STORAGE_PREFIX}${matchId}`;
    if (muted) {
      window.sessionStorage.setItem(key, '1');
    } else {
      window.sessionStorage.removeItem(key);
    }
  } catch {
    // sessionStorage 不可用时保留当前组件内状态。
  }
}

function createClientMessageId(): string {
  if (window.crypto?.randomUUID) {
    return window.crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function readSendError(error: unknown): string {
  if (error instanceof ApiClientError && error.code === 'ONLINE_CHAT_RATE_LIMITED') {
    const seconds = Math.max(1, Math.ceil((error.retryAfterMs ?? 1_000) / 1_000));
    return `发送太快，请 ${seconds} 秒后重试`;
  }
  return error instanceof Error ? error.message : '发送消息失败';
}

function readSyncError(error: unknown): string {
  if (error instanceof ApiClientError && error.code === 'ONLINE_SPECTATOR_RATE_LIMITED') {
    return '聊天同步稍慢，正在自动恢复';
  }
  return '聊天暂时未同步，正在重试';
}
