/**
 * HomePage - 入口大厅
 * 登录后的主界面，突出开始入口、卡组准备状态和联机入口。
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowRight,
  Bell,
  BookOpen,
  CalendarClock,
  CheckCircle2,
  Cloud,
  Database,
  DoorOpen,
  Gamepad2,
  Globe2,
  History,
  LogOut,
  MonitorCog,
  RefreshCw,
  Settings,
  ShieldAlert,
  Swords,
  TriangleAlert,
  WifiOff,
  X,
} from 'lucide-react';
import { AppCredits, ThemeToggle, DeckStatsRow, formatRelativeTime } from '@/components/common';
import { useAuthStore } from '@/store/authStore';
import { useDeckStore } from '@/store/deckStore';
import { useGameStore } from '@/store/gameStore';
import { isApiConfigured } from '@/lib/apiClient';
import {
  createDeckRecordCardTypeResolver,
  isDeckRecordValidForCurrentCardPool,
} from '@/lib/deckRecordUtils';
import { buildDeckDisplayItems, type DeckDisplayItem } from '@/lib/deckDisplay';
import type {
  PublicSiteAnnouncement,
  PublicSiteMaintenanceStatus,
  PublicSiteStatus,
  SiteAnnouncementType,
  SiteStatusLifecycle,
} from '@/lib/appConfig';
import { buildAnnouncementUnreadKey } from '@/lib/appConfig';

const ONLINE_ROOM_STORAGE_KEY = 'loveca.online.room';
const ANNOUNCEMENT_SEEN_STORAGE_KEY = 'loveca.home.announcements.seen.v1';
const ANNOUNCEMENT_AUTO_OPEN_DELAY_MS = 720;

const LIFECYCLE_LABELS: Record<SiteStatusLifecycle, string> = {
  NORMAL: '正常',
  SCHEDULED: '计划维护',
  RESTRICTING_NEW_GAMES: '限制新开局',
  MAINTENANCE: '维护中',
  COMPLETED: '已完成',
  POSTPONED: '已延期',
  CANCELLED: '已取消',
};

const ANNOUNCEMENT_TYPE_LABELS: Record<SiteAnnouncementType, string> = {
  MAINTENANCE: '维护',
  UPDATE: '更新',
  NEWS: '动态',
};

interface HomePageProps {
  onNavigateToDeckManager: () => void;
  onNavigateToGameSetup: () => void;
  onNavigateToOnlineRoom: () => void;
  onNavigateToMatchRecords: () => void;
  onNavigateToOnlineDebug: () => void;
  onNavigateToCardAdmin: () => void;
  onNavigateToOnlineAdmin: () => void;
  onNavigateToAnnouncementAdmin: () => void;
  siteStatus: PublicSiteStatus;
}

interface ActionTileProps {
  title: string;
  description: string;
  icon: ComponentType<{ size?: number | string; className?: string }>;
  onClick: () => void;
  disabled?: boolean;
  compact?: boolean;
  status?: string;
  tone?: 'primary' | 'blue' | 'green' | 'warning' | 'muted';
}

type DeckSourceStatus = 'online' | 'offline' | 'unconfigured';

type PrimaryActionState = 'saved-room' | 'ready' | 'loading' | 'needs-deck' | 'source-unavailable';

interface PrimaryActionConfig {
  state: PrimaryActionState;
  title: string;
  description: string;
  cta: string;
  icon: ComponentType<{ size?: number | string; className?: string }>;
  onClick: () => void;
  supportAction?: { label: string; onClick: () => void };
  notice?: string;
}

interface AnnouncementDisplayItem {
  id: string;
  label: string;
  title: string;
  summary: string;
  detail: string | null;
  timestamp: string | null;
  timestampLabel: '开始' | '发布';
  endsAt: string | null;
  impactScopes: readonly string[];
  action: string | null;
  tone: 'default' | 'info' | 'warning';
}

export function HomePage({
  onNavigateToDeckManager,
  onNavigateToGameSetup,
  onNavigateToOnlineRoom,
  onNavigateToMatchRecords,
  onNavigateToOnlineDebug,
  onNavigateToCardAdmin,
  onNavigateToOnlineAdmin,
  onNavigateToAnnouncementAdmin,
  siteStatus,
}: HomePageProps) {
  const { profile, offlineMode, offlineUser, signOut } = useAuthStore();
  const cloudDecks = useDeckStore((s) => s.cloudDecks);
  const isLoadingCloud = useDeckStore((s) => s.isLoadingCloud);
  const cloudError = useDeckStore((s) => s.cloudError);
  const fetchCloudDecks = useDeckStore((s) => s.fetchCloudDecks);
  const cardDataRegistry = useGameStore((s) => s.cardDataRegistry);
  const [savedRoomCode] = useState(() => window.sessionStorage.getItem(ONLINE_ROOM_STORAGE_KEY));

  const hasOnlineDebugEntry = Boolean(import.meta.env.VITE_DEBUG_SEAT);
  const isAdmin = profile?.role === 'admin';
  const deckSourceStatus: DeckSourceStatus = offlineMode
    ? 'offline'
    : isApiConfigured
      ? 'online'
      : 'unconfigured';
  const canUseCloudDecks = deckSourceStatus === 'online';
  const canUseOnlineRoom = canUseCloudDecks;
  const canReturnSavedRoom = Boolean(savedRoomCode && canUseOnlineRoom);
  const announcementItems = useMemo(() => buildAnnouncementDisplayItems(siteStatus), [siteStatus]);
  const announcementSeenKey = useMemo(() => buildAnnouncementUnreadKey(siteStatus), [siteStatus]);
  const [isAnnouncementsOpen, setIsAnnouncementsOpen] = useState(false);
  const [hasUnreadAnnouncements, setHasUnreadAnnouncements] = useState(false);
  const [announcementStatusMessage, setAnnouncementStatusMessage] = useState('');

  useEffect(() => {
    if (!canUseCloudDecks) {
      return;
    }

    void fetchCloudDecks();
  }, [canUseCloudDecks, fetchCloudDecks]);

  useEffect(() => {
    if (!announcementSeenKey || announcementItems.length === 0) {
      setHasUnreadAnnouncements(false);
      return;
    }

    setHasUnreadAnnouncements(readAnnouncementSeenKey() !== announcementSeenKey);
  }, [announcementItems.length, announcementSeenKey]);

  useEffect(() => {
    setAnnouncementStatusMessage(hasUnreadAnnouncements ? '公告已更新' : '');
  }, [announcementSeenKey, hasUnreadAnnouncements]);

  const markCurrentAnnouncementsSeen = useCallback(() => {
    if (!announcementSeenKey) {
      return;
    }

    writeAnnouncementSeenKey(announcementSeenKey);
    setHasUnreadAnnouncements(false);
  }, [announcementSeenKey]);

  const openAnnouncements = useCallback(() => {
    setIsAnnouncementsOpen(true);
    markCurrentAnnouncementsSeen();
  }, [markCurrentAnnouncementsSeen]);

  const closeAnnouncements = useCallback(() => {
    setIsAnnouncementsOpen(false);
  }, []);

  useEffect(() => {
    if (!hasUnreadAnnouncements || !announcementSeenKey || announcementItems.length === 0) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setIsAnnouncementsOpen(true);
      writeAnnouncementSeenKey(announcementSeenKey);
      setHasUnreadAnnouncements(false);
    }, ANNOUNCEMENT_AUTO_OPEN_DELAY_MS);

    return () => window.clearTimeout(timeoutId);
  }, [announcementItems.length, announcementSeenKey, hasUnreadAnnouncements]);

  const displayUsername = offlineMode
    ? offlineUser?.displayName || 'Guest'
    : profile?.display_name || profile?.username || 'User';

  const connectionStatus = offlineMode
    ? {
        icon: WifiOff,
        label: '离线模式',
        tone: 'text-[var(--semantic-warning)]',
      }
    : isApiConfigured
      ? {
          icon: Cloud,
          label: '云端可用',
          tone: 'text-[var(--semantic-success)]',
        }
      : {
          icon: Database,
          label: '本地服务未配置',
          tone: 'text-[var(--text-secondary)]',
        };

  const resolveDeckRecordCardType = useMemo(
    () => createDeckRecordCardTypeResolver(cardDataRegistry),
    [cardDataRegistry]
  );

  const validCloudDecks = useMemo(
    () =>
      !canUseCloudDecks
        ? []
        : cloudDecks.filter((deck) => isDeckRecordValidForCurrentCardPool(deck, cardDataRegistry)),
    [canUseCloudDecks, cardDataRegistry, cloudDecks]
  );

  const deckItems = useMemo(
    () =>
      !canUseCloudDecks
        ? []
        : buildDeckDisplayItems({
            cloudDecks,
            resolveDeckRecordCardType,
          }),
    [canUseCloudDecks, cloudDecks, resolveDeckRecordCardType]
  );

  const latestDeck = deckItems[0] ?? null;
  const validDeckItems = useMemo(
    () =>
      buildDeckDisplayItems({
        cloudDecks: validCloudDecks,
        resolveDeckRecordCardType,
      }),
    [resolveDeckRecordCardType, validCloudDecks]
  );

  const hasLegalDeck = validCloudDecks.length > 0;
  const isInitialDeckLoading = canUseCloudDecks && isLoadingCloud && cloudDecks.length === 0;

  const primaryAction: PrimaryActionConfig = canReturnSavedRoom
    ? {
        state: 'saved-room' as PrimaryActionState,
        title: '返回房间',
        description: `已保存房间 ${savedRoomCode}，进入后会恢复房间状态与对局同步。`,
        cta: '返回房间',
        icon: DoorOpen,
        onClick: onNavigateToOnlineRoom,
        supportAction: {
          label: '另开本地对局',
          onClick: onNavigateToGameSetup,
        },
        notice: '保存房间仍会保留，可稍后返回；另开本地对局不会清除它。',
      }
    : deckSourceStatus !== 'online'
      ? {
          state: 'source-unavailable' as PrimaryActionState,
          title: '卡组来源不可用',
          description:
            deckSourceStatus === 'offline'
              ? '离线模式无法读取云端卡组；可先查看准备页，或登录后同步卡组。'
              : '当前没有可用 API 服务，无法同步云端卡组与房间信息。',
          cta: '查看准备页',
          icon: deckSourceStatus === 'offline' ? WifiOff : Database,
          onClick: onNavigateToGameSetup,
        }
      : isInitialDeckLoading
        ? {
            state: 'loading' as PrimaryActionState,
            title: '正在读取卡组',
            description: '正在同步云端卡组列表；读取期间可以先查看准备页。',
            cta: '查看准备页',
            icon: RefreshCw,
            onClick: onNavigateToGameSetup,
          }
        : hasLegalDeck
          ? {
              state: 'ready' as PrimaryActionState,
              title: '开始游戏',
              description: '选择模式和卡组，进入对墙打模拟、正式联机或本地调试流程。',
              cta: '开始游戏',
              icon: Gamepad2,
              onClick: onNavigateToGameSetup,
            }
          : {
              state: 'needs-deck' as PrimaryActionState,
              title: '准备卡组',
              description: '还没有可用于开局的合法卡组。先创建或修正一副卡组。',
              cta: '去卡组管理',
              icon: BookOpen,
              onClick: onNavigateToDeckManager,
              supportAction: {
                label: '进入准备页',
                onClick: onNavigateToGameSetup,
              },
            };

  const secondaryActions: ActionTileProps[] = [
    {
      title: '正式联机',
      description: canUseOnlineRoom
        ? '创建或加入房间，锁定云端卡组。'
        : deckSourceStatus === 'offline'
          ? '登录并连接服务后可创建或加入房间。'
          : 'API 服务可用后可创建或加入房间。',
      icon: Globe2,
      onClick: onNavigateToOnlineRoom,
      disabled: !canUseOnlineRoom,
      compact: !canUseOnlineRoom,
      status: canUseOnlineRoom
        ? '房间对战'
        : deckSourceStatus === 'offline'
          ? '连接后可用'
          : '服务未配置',
      tone: canUseOnlineRoom ? 'blue' : 'muted',
    },
    {
      title: '历史对局',
      description: canUseCloudDecks
        ? '查看历史记录、timeline 与只读回放节点。'
        : '连接服务后可读取历史对局记录。',
      icon: History,
      onClick: onNavigateToMatchRecords,
      disabled: !canUseCloudDecks,
      compact: !canUseCloudDecks,
      status: canUseCloudDecks ? '只读回放' : '连接后可用',
      tone: canUseCloudDecks ? 'green' : 'muted',
    },
  ];

  if (hasOnlineDebugEntry) {
    secondaryActions.push({
      title: '联机调试',
      description: '固定 seat 的双端同步测试入口。',
      icon: Swords,
      onClick: onNavigateToOnlineDebug,
      disabled: !canUseOnlineRoom,
      compact: !canUseOnlineRoom,
      status: canUseOnlineRoom ? '调试入口' : '连接后可用',
      tone: canUseOnlineRoom ? 'warning' : 'muted',
    });
  }

  return (
    <div className="app-shell flex min-h-screen flex-col overflow-x-hidden">
      <EntryPageHeader
        displayUsername={displayUsername}
        connectionStatus={connectionStatus}
        announcementCount={announcementItems.length}
        hasUnreadAnnouncements={hasUnreadAnnouncements}
        onOpenAnnouncements={openAnnouncements}
        onSignOut={signOut}
      />

      <main className="relative z-10 flex-1 px-4 py-5 sm:px-6 sm:py-6 lg:px-8">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-4">
          <motion.section
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35 }}
          >
            <SiteStatusBanner siteStatus={siteStatus} />
            <HomeActionBar
              title={primaryAction.title}
              description={primaryAction.description}
              cta={primaryAction.cta}
              icon={primaryAction.icon}
              onClick={primaryAction.onClick}
              supportAction={primaryAction.supportAction}
              state={primaryAction.state}
              notice={primaryAction.notice}
            />
          </motion.section>

          <motion.section
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, delay: 0.06 }}
            className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_320px]"
          >
            <DeckWorkspacePanel
              cloudDeckCount={canUseCloudDecks ? cloudDecks.length : 0}
              validDeckCount={validCloudDecks.length}
              latestDeck={latestDeck}
              validDecks={validDeckItems.slice(0, 5)}
              recentDecks={deckItems.slice(0, 3)}
              isLoading={isLoadingCloud}
              hasError={Boolean(canUseCloudDecks && cloudError)}
              deckSourceStatus={deckSourceStatus}
              onRefresh={fetchCloudDecks}
              onManageDecks={onNavigateToDeckManager}
            />

            <div className="grid gap-4">
              <SecondaryEntryPanel actions={secondaryActions} />
              <div className="hidden md:block">
                <SiteAnnouncementsPanel siteStatus={siteStatus} />
              </div>
            </div>
          </motion.section>

          {isAdmin && (
            <motion.section
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.35, delay: 0.14 }}
              className="border-t border-[var(--border-subtle)] pt-4"
            >
              <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-[var(--text-secondary)]">
                <ShieldAlert size={16} className="text-[var(--accent-secondary)]" />
                管理工具
              </div>
              <div className="grid gap-3 md:grid-cols-3">
                <ActionTile
                  title="卡牌数据管理"
                  description="维护卡牌数据、发布状态和资源信息。"
                  icon={Settings}
                  onClick={onNavigateToCardAdmin}
                  status="管理员"
                  tone="warning"
                  compact
                />
                <ActionTile
                  title="平台配置"
                  description="打开维护开关，管理维护公告与更新通知。"
                  icon={Bell}
                  onClick={onNavigateToAnnouncementAdmin}
                  status="管理员"
                  tone="green"
                  compact
                />
                <ActionTile
                  title="联机房间监控"
                  description="查看活跃房间、玩家在线状态和进行中对局。"
                  icon={MonitorCog}
                  onClick={onNavigateToOnlineAdmin}
                  status="管理员"
                  tone="blue"
                  compact
                />
              </div>
            </motion.section>
          )}
        </div>
      </main>

      <AnnouncementCenterDrawer
        isOpen={isAnnouncementsOpen}
        items={announcementItems}
        onClose={closeAnnouncements}
      />
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {announcementStatusMessage}
      </div>

      <footer className="safe-bottom relative z-10 border-t border-[var(--border-subtle)] px-4 py-3">
        <AppCredits version={__APP_VERSION__} />
      </footer>
    </div>
  );
}

function AnnouncementCenterDrawer({
  isOpen,
  items,
  onClose,
}: {
  isOpen: boolean;
  items: readonly AnnouncementDisplayItem[];
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const previouslyFocusedElementRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    previouslyFocusedElementRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    document.body.style.overflow = 'hidden';
    const focusFrame = window.requestAnimationFrame(() => {
      closeButtonRef.current?.focus();
    });

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
        return;
      }

      if (event.key === 'Tab' && dialogRef.current) {
        trapFocusInDialog(event, dialogRef.current);
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
      const previousElement = previouslyFocusedElementRef.current;
      previouslyFocusedElementRef.current = null;
      if (previousElement && document.contains(previousElement)) {
        previousElement.focus();
      }
    };
  }, [isOpen, onClose]);

  return (
    <AnimatePresence>
      {isOpen ? (
        <motion.div
          className="fixed inset-0 z-[80] flex items-end justify-center bg-black/45 px-0 backdrop-blur-[2px] sm:items-center sm:px-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              onClose();
            }
          }}
        >
          <motion.section
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="announcement-center-title"
            tabIndex={-1}
            className="safe-bottom flex max-h-[88dvh] w-full flex-col overflow-hidden rounded-t-[24px] border border-b-0 border-[var(--border-default)] bg-[var(--bg-surface)] shadow-[var(--shadow-lg)] sm:max-w-2xl sm:rounded-lg sm:border"
            initial={{ y: 42, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 28, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 360, damping: 34 }}
          >
            <header className="flex shrink-0 items-start justify-between gap-3 border-b border-[var(--border-subtle)] bg-[color:color-mix(in_srgb,var(--bg-overlay)_58%,transparent)] px-4 py-3 sm:px-5">
              <div className="flex min-w-0 items-start gap-3">
                <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[var(--accent-primary)]">
                  <Bell size={18} />
                </div>
                <div className="min-w-0">
                  <h2
                    id="announcement-center-title"
                    className="text-base font-bold text-[var(--text-primary)]"
                  >
                    公告栏
                  </h2>
                  <p className="mt-0.5 text-xs leading-5 text-[var(--text-muted)]">
                    {items.length > 0
                      ? `${items.length} 条维护、更新与动态`
                      : `当前版本 ${__APP_VERSION__}`}
                  </p>
                </div>
              </div>
              <button
                ref={closeButtonRef}
                type="button"
                className="button-icon h-9 w-9 shrink-0"
                onClick={onClose}
                aria-label="关闭公告栏"
                title="关闭公告栏"
              >
                <X size={16} />
              </button>
            </header>

            <div className="touch-scroll max-h-[calc(88dvh-5.25rem)] overflow-y-auto px-4 py-3 sm:max-h-[64vh] sm:px-5">
              {items.length > 0 ? (
                <div className="grid gap-3">
                  {items.map((item) => (
                    <AnnouncementDetailCard key={item.id} item={item} />
                  ))}
                </div>
              ) : (
                <InlineEmptyState
                  icon={Bell}
                  title="暂无公告"
                  detail="可正常进入对局；新的维护、更新和动态会显示在这里。"
                  tone="muted"
                />
              )}
            </div>
          </motion.section>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

function AnnouncementDetailCard({ item }: { item: AnnouncementDisplayItem }) {
  const metaParts = [
    item.timestamp ? `${item.timestampLabel} ${formatStatusDateTime(item.timestamp)}` : null,
    item.endsAt ? `结束 ${formatStatusDateTime(item.endsAt)}` : null,
    item.impactScopes.length > 0 ? `影响 ${item.impactScopes.join('、')}` : null,
  ].filter((part): part is string => part !== null);
  const toneClass = {
    default: 'text-[var(--accent-primary)]',
    info: 'text-[var(--semantic-info)]',
    warning: 'text-[var(--semantic-warning)]',
  }[item.tone];

  return (
    <article className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-overlay)] px-3.5 py-3 shadow-[var(--shadow-sm)]">
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <span
              className={`shrink-0 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2 py-0.5 text-[11px] font-semibold ${toneClass}`}
            >
              {item.label}
            </span>
            <h3 className="min-w-0 text-sm font-bold leading-5 text-[var(--text-primary)]">
              {item.title}
            </h3>
          </div>
          <p className="mt-2 text-sm leading-6 text-[var(--text-secondary)]">{item.summary}</p>
          {item.detail ? (
            <p className="mt-2 whitespace-pre-wrap text-xs leading-5 text-[var(--text-muted)]">
              {item.detail}
            </p>
          ) : null}
        </div>
        {item.action ? (
          <span className="shrink-0 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2 py-1 text-[11px] font-semibold text-[var(--text-primary)]">
            {item.action}
          </span>
        ) : null}
      </div>
      {metaParts.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 border-t border-[var(--border-subtle)] pt-2 text-[11px] leading-5 text-[var(--text-muted)]">
          {metaParts.map((part) => (
            <span key={part}>{part}</span>
          ))}
        </div>
      ) : null}
    </article>
  );
}

function SiteStatusBanner({ siteStatus }: { siteStatus: PublicSiteStatus }) {
  const maintenance = siteStatus.maintenance;
  if (!maintenance || !shouldHighlightSiteStatus(siteStatus.lifecycle)) {
    return null;
  }

  const isCritical =
    siteStatus.lifecycle === 'MAINTENANCE' || siteStatus.lifecycle === 'RESTRICTING_NEW_GAMES';

  return (
    <div
      className={`mb-4 rounded-lg border px-4 py-3 ${
        isCritical
          ? 'border-[color:var(--semantic-warning)]/50 bg-[color:var(--semantic-warning)]/12'
          : 'border-[color:var(--semantic-info)]/45 bg-[color:var(--semantic-info)]/10'
      }`}
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <CalendarClock
            size={18}
            className={`mt-0.5 shrink-0 ${
              isCritical ? 'text-[var(--semantic-warning)]' : 'text-[var(--semantic-info)]'
            }`}
          />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2 py-0.5 text-xs font-semibold text-[var(--text-secondary)]">
                {LIFECYCLE_LABELS[siteStatus.lifecycle]}
              </span>
              <h2 className="text-sm font-bold text-[var(--text-primary)]">{maintenance.title}</h2>
            </div>
            <p className="mt-1 text-sm leading-5 text-[var(--text-secondary)]">
              {maintenance.summary}
            </p>
            <MaintenanceMeta maintenance={maintenance} compact />
          </div>
        </div>
        {maintenance.action ? (
          <div className="shrink-0 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-1.5 text-xs font-semibold text-[var(--text-primary)]">
            {maintenance.action}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function SiteAnnouncementsPanel({ siteStatus }: { siteStatus: PublicSiteStatus }) {
  const announcements = siteStatus.announcements.slice(0, 3);
  const maintenance = siteStatus.maintenance;

  return (
    <aside className="surface-panel rounded-lg p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Bell size={16} className="text-[var(--accent-primary)]" />
            <h3 className="text-sm font-bold text-[var(--text-primary)]">公告 / 更新</h3>
          </div>
          <p className="mt-0.5 text-xs text-[var(--text-muted)]">
            {maintenance ? '维护状态与近期更新' : `当前版本 ${__APP_VERSION__}`}
          </p>
        </div>
      </div>

      <div className="grid gap-2">
        {maintenance ? (
          <AnnouncementRow
            label={LIFECYCLE_LABELS[siteStatus.lifecycle]}
            title={maintenance.title}
            summary={maintenance.summary}
            startsAt={maintenance.startsAt}
            tone={siteStatus.lifecycle === 'MAINTENANCE' ? 'warning' : 'info'}
          />
        ) : null}

        {announcements.map((announcement) => (
          <AnnouncementRow
            key={announcement.id}
            label={ANNOUNCEMENT_TYPE_LABELS[announcement.type]}
            title={announcement.title}
            summary={announcement.summary}
            startsAt={announcement.startsAt ?? announcement.publishedAt}
            tone={announcement.type === 'MAINTENANCE' ? 'warning' : 'default'}
          />
        ))}

        {!maintenance && announcements.length === 0 ? (
          <div className="rounded-lg border border-dashed border-[var(--border-subtle)] bg-[var(--bg-overlay)] px-3 py-3">
            <div className="text-sm font-semibold text-[var(--text-primary)]">暂无新的维护通知</div>
            <div className="mt-1 text-xs leading-5 text-[var(--text-secondary)]">
              可正常进入对局；近期版本与发布摘要会在这里显示。
            </div>
          </div>
        ) : null}
      </div>
    </aside>
  );
}

function AnnouncementRow({
  label,
  title,
  summary,
  startsAt,
  tone,
}: {
  label: string;
  title: string;
  summary: string;
  startsAt: string | null;
  tone: 'default' | 'info' | 'warning';
}) {
  const toneClass = {
    default: 'text-[var(--accent-primary)]',
    info: 'text-[var(--semantic-info)]',
    warning: 'text-[var(--semantic-warning)]',
  }[tone];

  return (
    <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2.5">
      <div className="flex min-w-0 items-center gap-2">
        <span
          className={`shrink-0 rounded-md border border-[var(--border-subtle)] px-2 py-0.5 text-[11px] font-semibold ${toneClass}`}
        >
          {label}
        </span>
        <h4 className="min-w-0 truncate text-sm font-bold text-[var(--text-primary)]">{title}</h4>
      </div>
      <p className="mt-1 line-clamp-2 text-xs leading-5 text-[var(--text-secondary)]">{summary}</p>
      {startsAt ? (
        <div className="mt-1 text-[11px] text-[var(--text-muted)]">
          {formatStatusDateTime(startsAt)}
        </div>
      ) : null}
    </div>
  );
}

function MaintenanceMeta({
  maintenance,
  compact = false,
}: {
  maintenance: PublicSiteMaintenanceStatus;
  compact?: boolean;
}) {
  const parts = [
    maintenance.startsAt ? `开始 ${formatStatusDateTime(maintenance.startsAt)}` : null,
    maintenance.estimatedEndsAt
      ? `预计结束 ${formatStatusDateTime(maintenance.estimatedEndsAt)}`
      : null,
    maintenance.restrictsNewGamesAt
      ? `限制新开局 ${formatStatusDateTime(maintenance.restrictsNewGamesAt)}`
      : null,
    maintenance.impactScopes.length > 0 ? `影响 ${maintenance.impactScopes.join('、')}` : null,
  ].filter((part): part is string => part !== null);

  if (parts.length === 0) {
    return null;
  }

  return (
    <div
      className={`mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs leading-5 text-[var(--text-muted)] ${
        compact ? '' : 'pt-1'
      }`}
    >
      {parts.map((part) => (
        <span key={part}>{part}</span>
      ))}
    </div>
  );
}

function shouldHighlightSiteStatus(lifecycle: SiteStatusLifecycle): boolean {
  return (
    lifecycle === 'SCHEDULED' ||
    lifecycle === 'RESTRICTING_NEW_GAMES' ||
    lifecycle === 'MAINTENANCE'
  );
}

function formatStatusDateTime(value: string): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    return value;
  }

  const date = new Date(timestamp);
  const pad = (part: number) => String(part).padStart(2, '0');
  const timezoneOffsetMinutes = -date.getTimezoneOffset();
  const offsetSign = timezoneOffsetMinutes >= 0 ? '+' : '-';
  const absoluteOffset = Math.abs(timezoneOffsetMinutes);
  const offsetHours = Math.floor(absoluteOffset / 60);
  const offsetMinutes = absoluteOffset % 60;
  const offset =
    offsetMinutes === 0
      ? `UTC${offsetSign}${offsetHours}`
      : `UTC${offsetSign}${offsetHours}:${pad(offsetMinutes)}`;

  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
    date.getHours()
  )}:${pad(date.getMinutes())} ${offset}`;
}

function buildAnnouncementDisplayItems(siteStatus: PublicSiteStatus): AnnouncementDisplayItem[] {
  const items: AnnouncementDisplayItem[] = [];
  const maintenance = siteStatus.maintenance;

  if (maintenance) {
    const isWarning =
      siteStatus.lifecycle === 'MAINTENANCE' || siteStatus.lifecycle === 'RESTRICTING_NEW_GAMES';
    items.push({
      id: `maintenance:${maintenance.id}`,
      label: LIFECYCLE_LABELS[siteStatus.lifecycle],
      title: maintenance.title,
      summary: maintenance.summary,
      detail: maintenance.detail,
      timestamp: maintenance.startsAt,
      timestampLabel: '开始',
      endsAt: maintenance.estimatedEndsAt,
      impactScopes: maintenance.impactScopes,
      action: maintenance.action,
      tone: isWarning ? 'warning' : 'info',
    });
  }

  for (const announcement of siteStatus.announcements) {
    items.push(buildAnnouncementDisplayItem(announcement));
  }

  return items;
}

function buildAnnouncementDisplayItem(
  announcement: PublicSiteAnnouncement
): AnnouncementDisplayItem {
  return {
    id: `announcement:${announcement.id}`,
    label: ANNOUNCEMENT_TYPE_LABELS[announcement.type],
    title: announcement.title,
    summary: announcement.summary,
    detail: announcement.detail,
    timestamp: announcement.startsAt ?? announcement.publishedAt,
    timestampLabel: announcement.startsAt ? '开始' : '发布',
    endsAt: announcement.endsAt,
    impactScopes: announcement.impactScopes,
    action: null,
    tone: announcement.type === 'MAINTENANCE' ? 'warning' : 'default',
  };
}

function readAnnouncementSeenKey(): string | null {
  try {
    return window.localStorage.getItem(ANNOUNCEMENT_SEEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeAnnouncementSeenKey(value: string): void {
  try {
    window.localStorage.setItem(ANNOUNCEMENT_SEEN_STORAGE_KEY, value);
  } catch {
    // localStorage can be unavailable in private or restricted contexts.
  }
}

const DIALOG_FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'textarea:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

function trapFocusInDialog(event: KeyboardEvent, dialog: HTMLElement): void {
  const focusableElements = Array.from(
    dialog.querySelectorAll<HTMLElement>(DIALOG_FOCUSABLE_SELECTOR)
  ).filter(
    (element) => !element.hasAttribute('disabled') && element.getAttribute('aria-hidden') !== 'true'
  );

  if (focusableElements.length === 0) {
    event.preventDefault();
    dialog.focus();
    return;
  }

  const firstElement = focusableElements[0];
  const lastElement = focusableElements[focusableElements.length - 1];
  const activeElement = document.activeElement;

  if (event.shiftKey && activeElement === firstElement) {
    event.preventDefault();
    lastElement.focus();
    return;
  }

  if (!event.shiftKey && activeElement === lastElement) {
    event.preventDefault();
    firstElement.focus();
  }
}

function EntryPageHeader({
  displayUsername,
  connectionStatus,
  announcementCount,
  hasUnreadAnnouncements,
  onOpenAnnouncements,
  onSignOut,
}: {
  displayUsername: string;
  connectionStatus: {
    icon: ComponentType<{ size?: number | string; className?: string }>;
    label: string;
    detail?: string;
    tone: string;
  };
  announcementCount: number;
  hasUnreadAnnouncements: boolean;
  onOpenAnnouncements: () => void;
  onSignOut: () => void;
}) {
  return (
    <header className="relative z-10 border-b border-[var(--border-subtle)] bg-[color:color-mix(in_srgb,var(--bg-surface)_72%,transparent)] px-4 pb-2.5 pt-[calc(env(safe-area-inset-top)+0.625rem)] backdrop-blur-sm sm:px-6 lg:px-8">
      <div className="mx-auto flex min-h-10 max-w-6xl items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <img
            src="/icon.jpg"
            alt="Loveca"
            className="h-9 w-9 shrink-0 rounded-md border border-[var(--border-subtle)] object-cover"
          />
          <div className="flex min-w-0 items-center gap-2">
            <h1 className="truncate text-sm font-bold text-[var(--text-primary)] sm:text-base">
              Loveca
            </h1>
            <span className="hidden h-4 w-px bg-[var(--border-subtle)] sm:block" />
            <div
              className="hidden min-w-0 items-center gap-1.5 text-xs text-[var(--text-muted)] sm:flex"
              title={connectionStatus.label}
            >
              <span
                className={`h-1.5 w-1.5 shrink-0 rounded-full bg-current ${connectionStatus.tone}`}
              />
              <span className="truncate">{connectionStatus.label}</span>
            </div>
          </div>
        </div>

        <div className="flex min-w-0 items-center justify-end gap-1.5 sm:gap-2">
          <span className="hidden max-w-36 truncate text-xs font-medium text-[var(--text-secondary)] sm:block">
            {displayUsername}
          </span>
          <button
            type="button"
            onClick={onOpenAnnouncements}
            className="button-icon relative"
            title="公告栏"
            aria-label={
              hasUnreadAnnouncements
                ? `公告栏，${announcementCount} 条未读公告`
                : `公告栏，${announcementCount} 条公告`
            }
          >
            <Bell size={16} />
            {hasUnreadAnnouncements ? (
              <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full border border-[var(--bg-surface)] bg-[var(--semantic-warning)]" />
            ) : null}
          </button>
          <ThemeToggle />
          <button
            type="button"
            onClick={onSignOut}
            className="button-icon"
            title="登出"
            aria-label="登出"
          >
            <LogOut size={16} />
          </button>
        </div>
      </div>
    </header>
  );
}

function SecondaryEntryPanel({ actions }: { actions: ActionTileProps[] }) {
  return (
    <aside className="surface-panel rounded-lg p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-bold text-[var(--text-primary)]">对局入口</h3>
          <p className="mt-0.5 text-xs text-[var(--text-muted)]">正式联机、历史回放与调试入口</p>
        </div>
      </div>
      <div className="grid gap-2">
        {actions.map((action) => (
          <ActionTile key={action.title} {...action} compact />
        ))}
      </div>
    </aside>
  );
}

function HomeActionBar({
  title,
  description,
  cta,
  icon: Icon,
  onClick,
  supportAction,
  state,
  notice,
}: {
  title: string;
  description: string;
  cta: string;
  icon: ComponentType<{ size?: number | string; className?: string }>;
  onClick: () => void;
  supportAction?: { label: string; onClick: () => void };
  state: PrimaryActionState;
  notice?: string;
}) {
  return (
    <div className="surface-panel rounded-lg px-4 py-4 sm:px-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-overlay)] text-[var(--accent-primary)]">
            <Icon size={18} className={state === 'loading' ? 'animate-spin' : ''} />
          </div>
          <div className="min-w-0">
            <h2 className="truncate text-xl font-bold tracking-normal text-[var(--text-primary)] sm:text-2xl">
              {title}
            </h2>
            <p className="mt-1 max-w-3xl text-sm leading-5 text-[var(--text-secondary)]">
              {description}
            </p>
            {notice && <p className="mt-1 text-xs leading-5 text-[var(--text-muted)]">{notice}</p>}
          </div>
        </div>

        <div className="flex shrink-0 flex-col gap-2 sm:flex-row lg:justify-end">
          <motion.button
            whileTap={{ scale: 0.99 }}
            type="button"
            onClick={onClick}
            className="inline-flex min-h-11 w-full items-center justify-center gap-2 whitespace-nowrap rounded-[var(--radius-md)] bg-[var(--accent-primary)] px-5 text-sm font-bold text-white shadow-[0_10px_22px_color-mix(in_srgb,var(--accent-primary)_18%,transparent)] transition hover:-translate-y-0.5 hover:bg-[var(--accent-primary-hover)] sm:w-auto"
          >
            {cta}
            <ArrowRight size={16} />
          </motion.button>
          {supportAction && (
            <button
              type="button"
              onClick={supportAction.onClick}
              className="button-secondary inline-flex min-h-11 w-full items-center justify-center gap-2 px-4 text-sm font-semibold sm:w-auto"
            >
              {supportAction.label}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function DeckWorkspacePanel({
  cloudDeckCount,
  validDeckCount,
  latestDeck,
  validDecks,
  recentDecks,
  isLoading,
  hasError,
  deckSourceStatus,
  onRefresh,
  onManageDecks,
}: {
  cloudDeckCount: number;
  validDeckCount: number;
  latestDeck: DeckDisplayItem | null;
  validDecks: DeckDisplayItem[];
  recentDecks: DeckDisplayItem[];
  isLoading: boolean;
  hasError: boolean;
  deckSourceStatus: DeckSourceStatus;
  onRefresh: () => void;
  onManageDecks: () => void;
}) {
  const isOnline = deckSourceStatus === 'online';
  const isInitialLoading = isOnline && isLoading && cloudDeckCount === 0;
  const workspaceTitle = validDeckCount > 0 ? '可用卡组' : '卡组准备';
  const sourceSummary =
    deckSourceStatus === 'offline'
      ? '当前没有云端卡组来源。'
      : deckSourceStatus === 'unconfigured'
        ? '本地服务未配置。'
        : isInitialLoading
          ? '正在同步云端卡组列表。'
          : validDeckCount > 0
            ? cloudDeckCount === validDeckCount
              ? `${validDeckCount} 副云端卡组可直接开局。`
              : `${validDeckCount} / ${cloudDeckCount} 副云端卡组可直接开局。`
            : `共 ${cloudDeckCount} 副云端卡组，暂无可直接开局的合法卡组。`;

  const emptyState = isInitialLoading
    ? {
        icon: Cloud,
        title: '正在读取卡组',
        detail: '正在同步云端卡组列表，读取完成前不会判断为空。',
        tone: 'info' as const,
      }
    : deckSourceStatus === 'offline'
      ? {
          icon: WifiOff,
          title: '云端卡组不可用',
          detail: '登录后可同步卡组；离线开局能力未补齐本地卡组来源。',
          tone: 'warning' as const,
        }
      : deckSourceStatus === 'unconfigured'
        ? {
            icon: Database,
            title: '本地服务未配置',
            detail: 'API 服务可用后才能同步云端卡组与房间信息。',
            tone: 'warning' as const,
          }
        : hasError
          ? {
              icon: TriangleAlert,
              title: '暂时无法读取卡组',
              detail: '可以刷新列表，或进入卡组管理检查登录和卡组状态。',
              tone: 'warning' as const,
            }
          : {
              icon: BookOpen,
              title: '暂无合法卡组',
              detail: '先创建或修正一副合法卡组，再开始对局。',
              tone: 'warning' as const,
            };
  const hasVisibleValidDecks = !isInitialLoading && validDecks.length > 0;
  const invalidRecentDecks = recentDecks.filter((deck) => !deck.isValid).slice(0, 3);
  const showLatestInvalidDeck =
    hasVisibleValidDecks && latestDeck
      ? !validDecks.some((deck) => deck.id === latestDeck.id)
      : false;

  return (
    <div className="surface-panel flex min-h-full flex-col rounded-lg p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3 border-b border-[var(--border-subtle)] pb-4 sm:items-center">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <BookOpen size={17} className="text-[var(--accent-primary)]" />
            <h3 className="text-lg font-bold text-[var(--text-primary)]">{workspaceTitle}</h3>
          </div>
          <div className="mt-1 text-sm leading-5 text-[var(--text-secondary)]">{sourceSummary}</div>
        </div>
        <div className="flex shrink-0 items-center justify-end gap-2 sm:self-center">
          <button
            type="button"
            onClick={onManageDecks}
            className="button-secondary inline-flex h-10 w-10 items-center justify-center gap-2 px-0 text-sm font-semibold sm:w-auto sm:px-3"
            title="管理卡组"
            aria-label="管理卡组"
          >
            <BookOpen size={15} />
            <span className="hidden sm:inline">管理卡组</span>
          </button>
          <button
            type="button"
            onClick={onRefresh}
            disabled={!isOnline || isLoading}
            className="button-icon h-10 w-10 disabled:cursor-not-allowed disabled:opacity-45"
            title="刷新卡组"
          >
            <RefreshCw size={15} className={isLoading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      <div className="mt-4 grid gap-3">
        {hasVisibleValidDecks ? (
          <div className="grid gap-2">
            {validDecks.map((deck) => (
              <DeckReadinessRow key={deck.id} deck={deck} />
            ))}
            {validDeckCount > validDecks.length && (
              <div className="rounded-lg border border-dashed border-[var(--border-subtle)] px-3 py-2 text-xs text-[var(--text-secondary)]">
                还有 {validDeckCount - validDecks.length} 副可用卡组，可在卡组管理中查看。
              </div>
            )}
          </div>
        ) : (
          <InlineEmptyState
            icon={emptyState.icon}
            title={emptyState.title}
            detail={emptyState.detail}
            tone={emptyState.tone}
          />
        )}

        {showLatestInvalidDeck && latestDeck && (
          <InvalidDeckRow deck={latestDeck} label="最近更新但暂不可用" />
        )}

        {!hasVisibleValidDecks && invalidRecentDecks.length > 0 && (
          <div className="grid gap-2">
            {invalidRecentDecks.map((deck) => (
              <InvalidDeckRow key={deck.id} deck={deck} label="最近更新但暂不可用" />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function DeckReadinessRow({ deck }: { deck: DeckDisplayItem }) {
  return (
    <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-overlay)] px-3 py-2.5">
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div className="flex min-w-0 items-start gap-2">
          <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-[var(--semantic-success)]" />
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-[var(--text-primary)]">
              {deck.name}
            </div>
            <div className="mt-0.5 text-xs text-[var(--text-muted)]">
              {formatRelativeTime(deck.updatedAt)}
            </div>
          </div>
        </div>
        <DeckStatsRow stats={deck} size="sm" className="shrink-0 text-[var(--text-secondary)]" />
      </div>
    </div>
  );
}

function InvalidDeckRow({ deck, label }: { deck: DeckDisplayItem; label: string }) {
  return (
    <div className="rounded-lg border border-dashed border-[var(--border-subtle)] px-3 py-2 text-xs text-[var(--text-secondary)]">
      {label}：<span className="font-medium text-[var(--text-primary)]">{deck.name}</span>
      <span className="text-[var(--text-muted)]"> · {formatRelativeTime(deck.updatedAt)}</span>
    </div>
  );
}

function InlineEmptyState({
  icon: Icon,
  title,
  detail,
  tone = 'warning',
}: {
  icon: ComponentType<{ size?: number | string; className?: string }>;
  title: string;
  detail: string;
  tone?: 'info' | 'warning' | 'muted';
}) {
  const toneClass = {
    info: 'text-[var(--semantic-info)]',
    warning: 'text-[var(--semantic-warning)]',
    muted: 'text-[var(--text-muted)]',
  }[tone];

  return (
    <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-overlay)] p-4">
      <div className="flex items-start gap-3">
        <Icon size={18} className={`mt-0.5 shrink-0 ${toneClass}`} />
        <div>
          <div className="font-semibold text-[var(--text-primary)]">{title}</div>
          <div className="mt-1 text-sm leading-5 text-[var(--text-secondary)]">{detail}</div>
        </div>
      </div>
    </div>
  );
}

function ActionTile({
  title,
  description,
  icon: Icon,
  onClick,
  disabled = false,
  compact = false,
  status,
  tone = 'primary',
}: ActionTileProps) {
  const toneClass = {
    primary: 'text-[var(--accent-primary)]',
    blue: 'text-[var(--semantic-info)]',
    green: 'text-[var(--semantic-success)]',
    warning: 'text-[var(--semantic-warning)]',
    muted: 'text-[var(--text-muted)]',
  }[tone];

  if (compact) {
    return (
      <motion.button
        whileTap={disabled ? undefined : { scale: 0.99 }}
        type="button"
        onClick={disabled ? undefined : onClick}
        disabled={disabled}
        className={`group flex min-h-[68px] w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition ${
          disabled
            ? 'cursor-not-allowed border-[var(--border-subtle)] bg-[color:color-mix(in_srgb,var(--bg-overlay)_42%,transparent)] opacity-60'
            : 'border-[var(--border-default)] bg-[var(--bg-surface)] shadow-[var(--shadow-sm)] hover:border-[color:color-mix(in_srgb,var(--accent-primary)_30%,var(--border-default))]'
        }`}
      >
        <div
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-overlay)] ${toneClass}`}
        >
          <Icon size={17} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <h3 className="truncate text-sm font-bold text-[var(--text-primary)]">{title}</h3>
            {status && (
              <span className="shrink-0 rounded-md border border-[var(--border-subtle)] px-2 py-0.5 text-[11px] text-[var(--text-secondary)]">
                {status}
              </span>
            )}
          </div>
          <p className="mt-0.5 line-clamp-1 text-xs leading-5 text-[var(--text-secondary)]">
            {description}
          </p>
        </div>
      </motion.button>
    );
  }

  return (
    <motion.button
      whileHover={disabled ? undefined : { y: -2 }}
      whileTap={disabled ? undefined : { scale: 0.99 }}
      type="button"
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      className={`group flex min-h-[128px] w-full flex-col justify-between rounded-lg border p-4 text-left transition ${
        disabled
          ? 'cursor-not-allowed border-[var(--border-subtle)] bg-[color:color-mix(in_srgb,var(--bg-overlay)_54%,transparent)] opacity-70'
          : 'border-[var(--border-default)] bg-[var(--bg-surface)] shadow-[var(--shadow-sm)] hover:border-[color:color-mix(in_srgb,var(--accent-primary)_36%,var(--border-default))] hover:shadow-[var(--shadow-md)]'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-overlay)] ${toneClass}`}
        >
          <Icon size={19} />
        </div>
        {status && (
          <span className="shrink-0 rounded-md border border-[var(--border-subtle)] px-2 py-1 text-xs text-[var(--text-secondary)]">
            {status}
          </span>
        )}
      </div>

      <div className="mt-4">
        <div className="flex min-w-0 items-center gap-2">
          <h3 className="min-w-0 truncate text-base font-bold text-[var(--text-primary)]">
            {title}
          </h3>
          {!disabled && (
            <ArrowRight
              size={15}
              className="text-[var(--text-muted)] transition-transform group-hover:translate-x-0.5"
            />
          )}
        </div>
        <p className="mt-1 line-clamp-2 text-sm leading-5 text-[var(--text-secondary)]">
          {description}
        </p>
      </div>
    </motion.button>
  );
}
