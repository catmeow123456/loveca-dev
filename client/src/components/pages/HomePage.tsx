/**
 * HomePage - 入口大厅
 * 登录后的主界面，突出开始入口、卡组准备状态和联机入口。
 */

import { useEffect, useMemo, useState, type ComponentType } from 'react';
import { motion } from 'framer-motion';
import {
  ArrowRight,
  BookOpen,
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
} from 'lucide-react';
import { ThemeToggle, DeckStatsRow, formatRelativeTime } from '@/components/common';
import { useAuthStore } from '@/store/authStore';
import { useDeckStore } from '@/store/deckStore';
import { useGameStore } from '@/store/gameStore';
import { isApiConfigured } from '@/lib/apiClient';
import {
  createDeckRecordCardTypeResolver,
  isDeckRecordValidForCurrentCardPool,
} from '@/lib/deckRecordUtils';
import { buildDeckDisplayItems, type DeckDisplayItem } from '@/lib/deckDisplay';

const ONLINE_ROOM_STORAGE_KEY = 'loveca.online.room';

interface HomePageProps {
  onNavigateToDeckManager: () => void;
  onNavigateToGameSetup: () => void;
  onNavigateToOnlineRoom: () => void;
  onNavigateToMatchRecords: () => void;
  onNavigateToOnlineDebug: () => void;
  onNavigateToCardAdmin: () => void;
  onNavigateToOnlineAdmin: () => void;
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

export function HomePage({
  onNavigateToDeckManager,
  onNavigateToGameSetup,
  onNavigateToOnlineRoom,
  onNavigateToMatchRecords,
  onNavigateToOnlineDebug,
  onNavigateToCardAdmin,
  onNavigateToOnlineAdmin,
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

  useEffect(() => {
    if (!canUseCloudDecks) {
      return;
    }

    void fetchCloudDecks();
  }, [canUseCloudDecks, fetchCloudDecks]);

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
              description: '选择模式和卡组，进入本地测试、对墙打或联机流程。',
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
        onSignOut={signOut}
      />

      <main className="relative z-10 flex-1 px-4 py-5 sm:px-6 sm:py-6 lg:px-8">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-4">
          <motion.section
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35 }}
          >
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

            <SecondaryEntryPanel actions={secondaryActions} />
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
              <div className="grid gap-3 md:grid-cols-2">
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

      <footer className="safe-bottom relative z-10 border-t border-[var(--border-subtle)] px-4 py-3 text-center text-xs text-[var(--text-muted)] sm:text-sm">
        Loveca Card Game v{__APP_VERSION__}
      </footer>
    </div>
  );
}

function EntryPageHeader({
  displayUsername,
  connectionStatus,
  onSignOut,
}: {
  displayUsername: string;
  connectionStatus: {
    icon: ComponentType<{ size?: number | string; className?: string }>;
    label: string;
    detail?: string;
    tone: string;
  };
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
          <p className="mt-0.5 text-xs text-[var(--text-muted)]">房间对战、卡组与调试入口</p>
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
