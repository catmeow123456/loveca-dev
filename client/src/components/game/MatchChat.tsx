import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Bell, BellOff, Eye, Loader2, MessageCircle, Send, SmilePlus, X } from 'lucide-react';
import type {
  OnlineMatchChatEntry,
  OnlineMatchChatMessagesResponse,
  OnlineMatchEmoteCatalog,
  OnlineMatchEmoteDefinition,
  OnlineMatchEmoteId,
  Seat,
} from '@game/online';
import {
  fetchOnlineMatchChatMessages,
  fetchOnlineSpectatorChatMessages,
  sendOnlineMatchChatMessage,
} from '@/lib/onlineClient';
import { ApiClientError } from '@/lib/apiClient';
import { findLatestOpponentChatMessage, formatMatchChatPreviewText } from '@/lib/matchChatPreview';
import { SpectatorPollingScheduler } from '@/lib/spectatorPolling';
import { cn } from '@/lib/utils';
import { MatchEmoteVisual } from './MatchEmoteVisual';

const CHAT_POLL_INTERVAL_MS = 1_000;
const TEXT_PREVIEW_DURATION_MS = 5_000;
const EMOTE_PREVIEW_DURATION_MS = 3_500;
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
  readonly emoteCatalog: OnlineMatchEmoteCatalog | null;
  readonly compact?: boolean;
  readonly onEmoteCatalogStale?: () => void | Promise<void>;
}

export const MatchChat = memo(function MatchChat({
  access,
  emoteCatalog,
  compact = false,
  onEmoteCatalogStale,
}: MatchChatProps) {
  const [messages, setMessages] = useState<readonly OnlineMatchChatEntry[]>([]);
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [isEmoteMenuOpen, setIsEmoteMenuOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isMuted, setIsMuted] = useState(() => readMutedState(access.matchId));
  const [draft, setDraft] = useState('');
  const [isSendingText, setIsSendingText] = useState(false);
  const [sendingEmoteId, setSendingEmoteId] = useState<OnlineMatchEmoteId | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [emoteSendError, setEmoteSendError] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [previewMessage, setPreviewMessage] = useState<OnlineMatchChatEntry | null>(null);
  const cursorRef = useRef(0);
  const hydratedRef = useRef(false);
  const isChatOpenRef = useRef(isChatOpen);
  const isMutedRef = useRef(isMuted);
  const previewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingTextClientMessageIdRef = useRef<string | null>(null);
  const pendingEmoteRef = useRef<{
    readonly emoteId: OnlineMatchEmoteId;
    readonly clientMessageId: string;
  } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const emoteAnchorRootRef = useRef<HTMLDivElement>(null);
  const chatButtonRef = useRef<HTMLButtonElement>(null);
  const emoteLauncherButtonRef = useRef<HTMLButtonElement>(null);
  const firstEmoteButtonRef = useRef<HTMLButtonElement>(null);
  const chatReturnFocusRef = useRef<HTMLElement | null>(null);
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

  const showPreviewMessage = useCallback((message: OnlineMatchChatEntry) => {
    if (previewTimerRef.current !== null) {
      clearTimeout(previewTimerRef.current);
    }
    setPreviewMessage(message);
    previewTimerRef.current = setTimeout(
      () => {
        previewTimerRef.current = null;
        setPreviewMessage(null);
      },
      message.kind === 'EMOTE' ? EMOTE_PREVIEW_DURATION_MS : TEXT_PREVIEW_DURATION_MS
    );
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
      const incoming: OnlineMatchChatEntry[] = [];

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

      if (hydratedRef.current && !isChatOpenRef.current && incoming.length > 0) {
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
      onSuccess: () => setSyncError(null),
      onError: ({ error }) => setSyncError(readSyncError(error)),
    });
    scheduler.start();
    return () => scheduler.dispose();
  }, [syncMessages]);

  useEffect(() => {
    if (isChatOpen && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [isChatOpen, messages.length]);

  useEffect(() => {
    if (!isEmoteMenuOpen) {
      return;
    }
    const focusTimer = window.setTimeout(() => firstEmoteButtonRef.current?.focus(), 0);
    const closeFromOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !emoteAnchorRootRef.current?.contains(event.target)) {
        setIsEmoteMenuOpen(false);
      }
    };
    document.addEventListener('pointerdown', closeFromOutside);
    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener('pointerdown', closeFromOutside);
    };
  }, [isEmoteMenuOpen]);

  const draftCodePoints = useMemo(() => [...draft].length, [draft]);
  const draftLineCount = useMemo(() => draft.replace(/\r\n?/gu, '\n').split('\n').length, [draft]);
  const canSendText =
    !isSpectator &&
    !isSendingText &&
    sendingEmoteId === null &&
    draft.trim().length > 0 &&
    draftCodePoints <= CHAT_MAX_CODE_POINTS &&
    draftLineCount <= CHAT_MAX_LINES;

  const handleDraftChange = (value: string) => {
    pendingTextClientMessageIdRef.current = null;
    setDraft(value);
    setSendError(null);
  };

  const handleSendText = async () => {
    if (!canSendText || isSpectator) {
      return;
    }
    const text = draft;
    const clientMessageId = pendingTextClientMessageIdRef.current ?? createClientMessageId();
    pendingTextClientMessageIdRef.current = clientMessageId;
    setIsSendingText(true);
    setSendError(null);
    try {
      const message = await sendOnlineMatchChatMessage(matchId, {
        kind: 'TEXT',
        clientMessageId,
        text,
      });
      setMessages((current) => mergeChatMessages(current, [message]));
      setDraft('');
      pendingTextClientMessageIdRef.current = null;
    } catch (error) {
      setSendError(readTextSendError(error));
    } finally {
      setIsSendingText(false);
    }
  };

  const handleSendEmote = async (emoteId: OnlineMatchEmoteId) => {
    if (isSpectator || !emoteCatalog || sendingEmoteId !== null || isSendingText) {
      return;
    }
    const pending = pendingEmoteRef.current;
    const clientMessageId =
      pending?.emoteId === emoteId ? pending.clientMessageId : createClientMessageId();
    pendingEmoteRef.current = { emoteId, clientMessageId };
    setSendingEmoteId(emoteId);
    setEmoteSendError(null);
    try {
      const message = await sendOnlineMatchChatMessage(matchId, {
        kind: 'EMOTE',
        clientMessageId,
        emoteId,
        catalogVersion: emoteCatalog.version,
      });
      setMessages((current) => mergeChatMessages(current, [message]));
      pendingEmoteRef.current = null;
      setIsEmoteMenuOpen(false);
      emoteLauncherButtonRef.current?.focus();
    } catch (error) {
      setEmoteSendError(readEmoteSendError(error));
      if (error instanceof ApiClientError && error.code === 'ONLINE_CHAT_EMOTE_UNAVAILABLE') {
        setIsEmoteMenuOpen(false);
        await onEmoteCatalogStale?.();
      }
    } finally {
      setSendingEmoteId(null);
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

  const openChat = (returnFocus: HTMLElement | null) => {
    chatReturnFocusRef.current = returnFocus;
    isChatOpenRef.current = true;
    setIsChatOpen(true);
    setIsEmoteMenuOpen(false);
    setUnreadCount(0);
    clearPreviewMessage();
  };

  const handleChatButton = () => {
    if (isChatOpen) {
      handleCloseChat();
    } else {
      openChat(chatButtonRef.current);
    }
  };

  const handleCloseChat = () => {
    isChatOpenRef.current = false;
    setIsChatOpen(false);
    window.setTimeout(() => chatReturnFocusRef.current?.focus(), 0);
  };

  return (
    <div className="relative">
      <button
        ref={chatButtonRef}
        data-match-chat-trigger
        type="button"
        onClick={handleChatButton}
        className={cn(
          'button-ghost relative inline-flex items-center justify-center border border-[var(--border-default)] bg-[var(--bg-frosted)] shadow-[var(--shadow-md)] backdrop-blur-xl',
          compact ? 'h-9 w-9 p-0' : 'min-h-10 gap-2 px-3 sm:min-h-11'
        )}
        aria-label={isSpectator ? '观战聊天' : '局内聊天'}
        aria-expanded={isChatOpen}
        title={isSpectator ? '观战聊天' : '局内聊天'}
      >
        <MessageCircle size={16} />
        {!compact ? (
          <span className="hidden text-sm font-semibold sm:inline">
            {isSpectator ? '聊天' : '局内聊天'}
          </span>
        ) : null}
        {unreadCount > 0 ? <UnreadBadge count={unreadCount} /> : null}
      </button>

      {!isSpectator && emoteCatalog && emoteCatalog.items.length > 0 ? (
        <IdentityAnchorPortal seat={viewerSeat} kind="launcher">
          <div ref={emoteAnchorRootRef} className="relative">
            <button
              ref={emoteLauncherButtonRef}
              data-match-emote-launcher
              type="button"
              onClick={() => {
                setEmoteSendError(null);
                setIsEmoteMenuOpen((open) => !open);
              }}
              className="button-ghost inline-flex h-9 w-9 items-center justify-center rounded-full border border-[color:color-mix(in_srgb,var(--accent-primary)_42%,var(--border-default))] bg-[var(--bg-frosted)] p-0 text-[var(--accent-primary)] shadow-[var(--shadow-md)] backdrop-blur-xl"
              aria-label="快捷表情"
              aria-expanded={isEmoteMenuOpen}
              title="快捷表情"
            >
              <SmilePlus size={17} />
            </button>

            <AnimatePresence initial={false}>
              {isEmoteMenuOpen ? (
                <motion.div
                  role="dialog"
                  aria-label="快捷表情"
                  initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 5, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 4, scale: 0.99 }}
                  transition={{ duration: reduceMotion ? 0.08 : 0.14, ease: 'easeOut' }}
                  onKeyDown={(event) => {
                    if (event.key === 'Escape') {
                      event.preventDefault();
                      setIsEmoteMenuOpen(false);
                      emoteLauncherButtonRef.current?.focus();
                    }
                  }}
                  className="fixed inset-x-2 bottom-[max(0.5rem,env(safe-area-inset-bottom))] z-[var(--z-battle-action-menu)] rounded-xl border border-[var(--border-default)] bg-[var(--bg-frosted)] p-2.5 shadow-[var(--shadow-lg)] backdrop-blur-xl md:absolute md:inset-x-auto md:bottom-[calc(100%+0.5rem)] md:left-0 md:w-[360px]"
                >
                  <div className="mb-2 flex items-center justify-between px-1">
                    <div className="text-xs font-bold text-[var(--text-primary)]">选择快捷表情</div>
                    <button
                      type="button"
                      onClick={() => {
                        setIsEmoteMenuOpen(false);
                        emoteLauncherButtonRef.current?.focus();
                      }}
                      className="button-icon h-8 w-8"
                      aria-label="关闭快捷表情"
                    >
                      <X size={14} />
                    </button>
                  </div>
                  <EmoteGrid
                    emotes={emoteCatalog.items}
                    sendingEmoteId={sendingEmoteId}
                    disabled={isSendingText}
                    firstButtonRef={firstEmoteButtonRef}
                    onSend={handleSendEmote}
                  />
                  <InlineEmoteError error={emoteSendError} />
                </motion.div>
              ) : null}
            </AnimatePresence>
          </div>
        </IdentityAnchorPortal>
      ) : null}

      {typeof document !== 'undefined'
        ? createPortal(
            <AnimatePresence initial={false}>
              {previewMessage && !isChatOpen && !isSpectator ? (
                previewMessage.kind === 'EMOTE' ? (
                  <IdentityEmotePreview
                    message={previewMessage}
                    reduceMotion={reduceMotion === true}
                    onOpen={() => openChat(chatButtonRef.current)}
                  />
                ) : (
                  <TextMessagePreview
                    message={previewMessage}
                    reduceMotion={reduceMotion === true}
                    onOpen={() => openChat(chatButtonRef.current)}
                  />
                )
              ) : null}
            </AnimatePresence>,
            document.body
          )
        : null}

      {isChatOpen && typeof document !== 'undefined'
        ? createPortal(
            <aside
              aria-label={isSpectator ? '观战聊天面板' : '局内聊天面板'}
              className="fixed bottom-[max(0.5rem,env(safe-area-inset-bottom))] left-2 right-2 z-[var(--z-battle-chat)] flex h-[min(68dvh,560px)] min-h-0 flex-col overflow-hidden rounded-xl border border-[var(--border-default)] bg-[var(--bg-frosted)] shadow-[var(--shadow-lg)] backdrop-blur-xl md:bottom-4 md:left-auto md:right-4 md:top-20 md:h-auto md:w-[min(390px,calc(100vw-2rem))]"
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
                      {isSpectator ? '对局双方的公开交流' : '聊天记录包含本局快捷表情'}
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
                    onClick={handleCloseChat}
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
                      {isSpectator ? '对局双方发送内容后会显示在这里。' : '可以先打个招呼。'}
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
                  观战者只能查看，不能发送消息或表情
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
                          void handleSendText();
                        }
                      }}
                      rows={2}
                      placeholder="输入本局消息"
                      className="cute-scrollbar min-h-11 flex-1 resize-none rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface)] px-3 py-2 text-sm leading-5 text-[var(--text-primary)] outline-none transition focus:border-[var(--accent-primary)] focus:ring-2 focus:ring-[color:color-mix(in_srgb,var(--accent-primary)_18%,transparent)]"
                      aria-label="聊天内容"
                    />
                    <button
                      type="button"
                      onClick={() => void handleSendText()}
                      disabled={!canSendText}
                      className="button-primary inline-flex h-11 w-11 shrink-0 items-center justify-center p-0"
                      aria-label="发送消息"
                      title="发送"
                    >
                      {isSendingText ? (
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
    </div>
  );
});

function IdentityAnchorPortal({
  seat,
  kind,
  children,
}: {
  readonly seat: Seat;
  readonly kind: 'launcher' | 'preview';
  readonly children: ReactNode;
}) {
  const style = useIdentityAnchorStyle(seat, kind);
  if (!style || typeof document === 'undefined') {
    return null;
  }
  return createPortal(
    <div
      className={cn(
        'fixed z-[var(--z-battle-communication-preview)]',
        kind === 'launcher' && 'z-[var(--z-battle-chat)]'
      )}
      style={style}
    >
      {children}
    </div>,
    document.body
  );
}

function useIdentityAnchorStyle(seat: Seat, kind: 'launcher' | 'preview'): CSSProperties | null {
  const [style, setStyle] = useState<CSSProperties | null>(null);

  useEffect(() => {
    let frame = 0;
    let resizeObserver: ResizeObserver | null = null;
    const update = () => {
      const anchorSelector =
        kind === 'launcher'
          ? `[data-player-communication-seat="${seat}"]`
          : `[data-player-identity-seat="${seat}"]`;
      const anchor = document.querySelector<HTMLElement>(anchorSelector);
      if (!anchor) {
        setStyle(null);
        return;
      }
      const rect = anchor.getBoundingClientRect();
      if (kind === 'launcher') {
        setStyle({
          left: Math.min(window.innerWidth - 48, Math.max(8, rect.left)),
          top: Math.max(8, rect.top + 2),
        });
      } else {
        const showBelow = rect.top < window.innerHeight / 2;
        setStyle({
          left: Math.min(window.innerWidth - 236, Math.max(8, rect.left)),
          top: showBelow ? rect.bottom + 6 : rect.top - 6,
          transform: showBelow ? undefined : 'translateY(-100%)',
        });
      }
      resizeObserver?.disconnect();
      resizeObserver = new ResizeObserver(scheduleUpdate);
      resizeObserver.observe(anchor);
    };
    const scheduleUpdate = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(update);
    };
    scheduleUpdate();
    window.addEventListener('resize', scheduleUpdate);
    window.addEventListener('scroll', scheduleUpdate, true);
    return () => {
      window.cancelAnimationFrame(frame);
      resizeObserver?.disconnect();
      window.removeEventListener('resize', scheduleUpdate);
      window.removeEventListener('scroll', scheduleUpdate, true);
    };
  }, [kind, seat]);

  return style;
}

function EmoteGrid({
  emotes,
  sendingEmoteId,
  disabled,
  firstButtonRef,
  onSend,
}: {
  readonly emotes: readonly OnlineMatchEmoteDefinition[];
  readonly sendingEmoteId: OnlineMatchEmoteId | null;
  readonly disabled: boolean;
  readonly firstButtonRef?: RefObject<HTMLButtonElement | null>;
  readonly onSend: (emoteId: OnlineMatchEmoteId) => Promise<void>;
}) {
  return (
    <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3" onKeyDown={handleEmoteGridKeyDown}>
      {emotes.map((emote, index) => {
        const isSending = sendingEmoteId === emote.id;
        return (
          <button
            key={emote.id}
            ref={index === 0 ? firstButtonRef : undefined}
            type="button"
            onClick={() => void onSend(emote.id)}
            disabled={disabled || sendingEmoteId !== null}
            className="group relative flex min-h-[76px] min-w-0 flex-col items-center justify-center rounded-lg border border-[var(--border-subtle)] bg-[color:color-mix(in_srgb,var(--bg-surface)_82%,transparent)] px-1.5 py-1.5 text-center transition duration-150 hover:border-[color:color-mix(in_srgb,var(--accent-primary)_52%,var(--border-default))] hover:bg-[color:color-mix(in_srgb,var(--accent-primary)_9%,var(--bg-surface))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)] disabled:cursor-not-allowed disabled:opacity-60"
            aria-label={`发送表情：${emote.label.replace(/[…！]/gu, '')}`}
          >
            <MatchEmoteVisual
              emote={emote}
              className="h-11 w-11 transition-transform duration-150 group-hover:-translate-y-0.5"
            />
            <span className="mt-0.5 max-w-full text-[11px] font-semibold leading-4 text-[var(--text-secondary)]">
              {emote.shortLabel}
            </span>
            {isSending ? (
              <span className="absolute inset-0 flex items-center justify-center rounded-lg bg-[color:color-mix(in_srgb,var(--bg-surface)_78%,transparent)]">
                <Loader2 size={18} className="animate-spin text-[var(--accent-primary)]" />
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

function ChatMessage({
  message,
  viewerSeat,
  spectator,
}: {
  readonly message: OnlineMatchChatEntry;
  readonly viewerSeat: Seat;
  readonly spectator: boolean;
}) {
  const isOwn = !spectator && message.senderSeat === viewerSeat;
  const isEmote = message.kind === 'EMOTE';
  return (
    <div className={cn('flex', isOwn ? 'justify-end' : 'justify-start')}>
      <div
        className={cn(
          'max-w-[86%] rounded-lg border px-2.5 py-2',
          isEmote && 'min-w-[168px] py-2.5',
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
        {message.kind === 'TEXT' ? (
          <div className="whitespace-pre-wrap break-words text-sm leading-5 text-[var(--text-primary)]">
            {message.text}
          </div>
        ) : (
          <div className="flex items-center gap-2.5">
            <MatchEmoteVisual emote={message.emote} className="h-[70px] w-[70px] shrink-0" />
            <span className="text-sm font-bold leading-5 text-[var(--text-primary)]">
              {message.emote.label}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

function IdentityEmotePreview({
  message,
  reduceMotion,
  onOpen,
}: {
  readonly message: Extract<OnlineMatchChatEntry, { kind: 'EMOTE' }>;
  readonly reduceMotion: boolean;
  readonly onOpen: () => void;
}) {
  return (
    <IdentityAnchorPortal seat={message.senderSeat} kind="preview">
      <motion.button
        key={message.messageSeq}
        type="button"
        onClick={onOpen}
        initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 5, scale: 0.94 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 3, scale: 0.97 }}
        transition={{ duration: reduceMotion ? 0.08 : 0.18, ease: 'easeOut' }}
        className="flex w-[228px] items-center gap-2 overflow-hidden rounded-xl border border-[color:color-mix(in_srgb,var(--accent-primary)_34%,var(--border-default))] bg-[var(--bg-frosted)] px-2.5 py-2 text-left shadow-[var(--shadow-lg)] backdrop-blur-xl"
        aria-label={`打开聊天查看 ${message.senderDisplayName} 的表情：${message.emote.label}`}
      >
        <MatchEmoteVisual emote={message.emote} className="h-[72px] w-[72px] shrink-0" />
        <span className="min-w-0">
          <span className="block text-[10px] font-semibold text-[var(--text-muted)]">
            {message.senderDisplayName}
          </span>
          <span className="mt-0.5 block text-sm font-bold text-[var(--text-primary)]">
            {message.emote.label}
          </span>
        </span>
      </motion.button>
    </IdentityAnchorPortal>
  );
}

function TextMessagePreview({
  message,
  reduceMotion,
  onOpen,
}: {
  readonly message: Extract<OnlineMatchChatEntry, { kind: 'TEXT' }>;
  readonly reduceMotion: boolean;
  readonly onOpen: () => void;
}) {
  return (
    <motion.button
      key={message.messageSeq}
      type="button"
      onClick={onOpen}
      initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -8, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -5, scale: 0.99 }}
      transition={{ duration: reduceMotion ? 0.08 : 0.18, ease: 'easeOut' }}
      className="fixed right-2 top-20 z-[var(--z-battle-communication-preview)] flex w-[min(360px,calc(100vw-1rem))] items-center gap-3 overflow-hidden rounded-xl border border-[color:color-mix(in_srgb,var(--accent-primary)_30%,var(--border-default))] bg-[var(--bg-frosted)] px-3 py-2.5 text-left shadow-[var(--shadow-lg)] backdrop-blur-xl md:right-4"
      aria-label={`打开聊天查看 ${message.senderDisplayName} 的消息`}
    >
      <span
        className="h-8 w-1 shrink-0 rounded-full bg-gradient-to-b from-[var(--accent-primary)] to-[var(--accent-secondary)]"
        aria-hidden="true"
      />
      <span className="min-w-0 flex-1 truncate text-sm text-[var(--text-primary)]">
        <span className="font-bold">{message.senderDisplayName}：</span>
        {formatMatchChatPreviewText(message.text)}
      </span>
      <MessageCircle size={15} className="shrink-0 text-[var(--text-muted)]" aria-hidden="true" />
    </motion.button>
  );
}

function InlineEmoteError({ error }: { readonly error: string | null }) {
  return (
    <div
      className={cn(
        'min-h-5 px-1 pt-1.5 text-[11px] text-[var(--semantic-error)]',
        !error && 'invisible'
      )}
      role="status"
    >
      {error ?? '无错误'}
    </div>
  );
}

function UnreadBadge({ count }: { readonly count: number }) {
  return (
    <span className="absolute -right-1.5 -top-1.5 min-w-5 rounded-full bg-[var(--semantic-error)] px-1.5 py-0.5 text-center text-[10px] font-bold leading-none text-white shadow">
      {count > 99 ? '99+' : count}
    </span>
  );
}

function handleEmoteGridKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
  if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
    return;
  }
  const buttons = [
    ...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'),
  ];
  const currentIndex = buttons.indexOf(document.activeElement as HTMLButtonElement);
  if (currentIndex < 0 || buttons.length === 0) {
    return;
  }
  event.preventDefault();
  const direction = event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1;
  buttons[(currentIndex + direction + buttons.length) % buttons.length]?.focus();
}

function mergeChatMessages(
  current: readonly OnlineMatchChatEntry[],
  incoming: readonly OnlineMatchChatEntry[]
): readonly OnlineMatchChatEntry[] {
  const bySeq = new Map<number, OnlineMatchChatEntry>();
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

function readTextSendError(error: unknown): string {
  if (error instanceof ApiClientError && error.code === 'ONLINE_CHAT_RATE_LIMITED') {
    return formatRetryAfter(error);
  }
  return error instanceof Error ? error.message : '发送消息失败';
}

function readEmoteSendError(error: unknown): string {
  if (
    error instanceof ApiClientError &&
    (error.code === 'ONLINE_CHAT_RATE_LIMITED' || error.code === 'ONLINE_CHAT_EMOTE_COOLDOWN')
  ) {
    return formatRetryAfter(error);
  }
  if (error instanceof ApiClientError && error.code === 'ONLINE_CHAT_EMOTE_UNAVAILABLE') {
    return '这个表情暂时不可用';
  }
  return error instanceof Error ? error.message : '表情发送失败，请重试';
}

function formatRetryAfter(error: ApiClientError): string {
  const seconds = Math.max(1, Math.ceil((error.retryAfterMs ?? 1_000) / 1_000));
  return `发送太快，请 ${seconds} 秒后重试`;
}

function readSyncError(error: unknown): string {
  if (error instanceof ApiClientError && error.code === 'ONLINE_SPECTATOR_RATE_LIMITED') {
    return '聊天同步稍慢，正在自动恢复';
  }
  return '聊天暂时未同步，正在重试';
}
