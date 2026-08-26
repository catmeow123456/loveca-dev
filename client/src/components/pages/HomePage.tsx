/**
 * HomePage - 入口大厅
 * 登录后的主界面，突出开始入口、卡组准备状态和联机入口。
 */

import { useEffect, useMemo, useState, type ComponentType, type ReactNode } from 'react';
import {
  ArrowRight,
  BookOpen,
  CalendarClock,
  CheckCircle2,
  Cloud,
  Database,
  DoorOpen,
  Eye,
  Gamepad2,
  History,
  Medal,
  RefreshCw,
  Sparkles,
  ShieldAlert,
  Swords,
  School,
  TriangleAlert,
  WifiOff,
} from 'lucide-react';
import {
  AppCredits,
  ProductFrame,
  DeckStatsRow,
  formatRelativeTime,
  type ProductNavigationHandlers,
} from '@/components/common';
import { useAuthStore } from '@/store/authStore';
import { useDeckStore } from '@/store/deckStore';
import { useGameStore } from '@/store/gameStore';
import { isApiConfigured } from '@/lib/apiClient';
import type { DeckDisplayItem } from '@/lib/deckDisplay';
import { useDeckPointTableRules } from '@/hooks/useDeckPointTable';
import { buildHomeDeckProjection } from '@/lib/homeDeckProjection';
import type {
  PlayerBattleEntryVisibility,
  PublicSiteMaintenanceStatus,
  PublicSiteStatus,
  SiteStatusLifecycle,
} from '@/lib/appConfig';
import './home-page.css';
import { hasAnyManagementPermission } from '@game/shared/auth/permissions';

const ONLINE_ROOM_STORAGE_KEY = 'loveca.online.room';

const LIFECYCLE_LABELS: Record<SiteStatusLifecycle, string> = {
  NORMAL: '正常',
  RESTRICTING_NEW_GAMES: '限制新开局',
  MAINTENANCE: '维护中',
};

interface HomePageProps {
  navigation: ProductNavigationHandlers;
  headerActions: ReactNode;
  mobileMenuActions: ReactNode;
  onNavigateToDeckManager: () => void;
  onNavigateToGameSetup: () => void;
  onAbandonSavedRoomForLocalGame: () => Promise<void>;
  onNavigateToOnlineRoom: () => void;
  onNavigateToRanked: () => void;
  onNavigateToThemeTable: () => void;
  onNavigateToOnlineSpectator: () => void;
  onNavigateToMatchRecords: () => void;
  onNavigateToOnlineDebug: () => void;
  onNavigateToAdminCenter: () => void;
  onNavigateToTutorial: () => void;
  battleEntryVisibility: PlayerBattleEntryVisibility;
  siteStatus: PublicSiteStatus;
}

interface ActionTileProps {
  title: string;
  description?: string;
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
  supportAction?: { label: string; onClick: () => void; disabled?: boolean };
  notice?: string;
}

export function HomePage({
  navigation,
  headerActions,
  mobileMenuActions,
  onNavigateToDeckManager,
  onNavigateToGameSetup,
  onAbandonSavedRoomForLocalGame,
  onNavigateToOnlineRoom,
  onNavigateToRanked,
  onNavigateToThemeTable,
  onNavigateToOnlineSpectator,
  onNavigateToMatchRecords,
  onNavigateToOnlineDebug,
  onNavigateToAdminCenter,
  onNavigateToTutorial,
  battleEntryVisibility,
  siteStatus,
}: HomePageProps) {
  const { profile, offlineMode, offlineUser } = useAuthStore();
  const cloudDecks = useDeckStore((s) => s.cloudDecks);
  const cloudDecksLoadedAt = useDeckStore((s) => s.cloudDecksLoadedAt);
  const localDecks = useDeckStore((s) => s.localDecks);
  const cloudDeckLoadState = useDeckStore((s) => s.cloudDeckLoadState);
  const cloudError = useDeckStore((s) => s.cloudError);
  const ensureCloudDecks = useDeckStore((s) => s.ensureCloudDecks);
  const refreshCloudDecks = useDeckStore((s) => s.refreshCloudDecks);
  const cardDataRegistry = useGameStore((s) => s.cardDataRegistry);
  const pointTable = useDeckPointTableRules();
  const [savedRoomCode] = useState(() => window.sessionStorage.getItem(ONLINE_ROOM_STORAGE_KEY));
  const [isAbandoningSavedRoom, setIsAbandoningSavedRoom] = useState(false);
  const [savedRoomActionError, setSavedRoomActionError] = useState<string | null>(null);

  const hasOnlineDebugEntry = Boolean(import.meta.env.VITE_DEBUG_SEAT);
  const hasManagementAccess = profile ? hasAnyManagementPermission(profile.role) : false;
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

    void ensureCloudDecks();
  }, [canUseCloudDecks, ensureCloudDecks]);

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
  const ConnectionStatusIcon = connectionStatus.icon;

  const { deckItems, validDeckItems } = useMemo(
    () =>
      buildHomeDeckProjection({
        cloudDecks: canUseCloudDecks ? cloudDecks : [],
        localDecks: offlineMode ? localDecks : [],
        cardDataRegistry,
        pointTable,
      }),
    [canUseCloudDecks, cardDataRegistry, cloudDecks, localDecks, offlineMode, pointTable]
  );

  const latestDeck = deckItems[0] ?? null;
  const hasLegalDeck = validDeckItems.length > 0;
  const isInitialDeckLoading = canUseCloudDecks && cloudDeckLoadState === 'LOADING';
  const isRefreshingDecks = canUseCloudDecks && cloudDeckLoadState === 'REFRESHING';

  const handleAbandonSavedRoomForLocalGame = async () => {
    setIsAbandoningSavedRoom(true);
    setSavedRoomActionError(null);
    try {
      await onAbandonSavedRoomForLocalGame();
    } catch (error) {
      setSavedRoomActionError(error instanceof Error ? error.message : '放弃联机对局失败');
    } finally {
      setIsAbandoningSavedRoom(false);
    }
  };

  const primaryAction: PrimaryActionConfig = canReturnSavedRoom
    ? {
        state: 'saved-room' as PrimaryActionState,
        title: '返回房间',
        description: `已保存房间 ${savedRoomCode}，进入后会恢复房间状态与对局同步。`,
        cta: '返回房间',
        icon: DoorOpen,
        onClick: onNavigateToOnlineRoom,
        supportAction: {
          label: isAbandoningSavedRoom ? '正在放弃联机对局...' : '另开本地对局',
          disabled: isAbandoningSavedRoom,
          onClick: () => {
            void handleAbandonSavedRoomForLocalGame();
          },
        },
        notice: savedRoomActionError ?? '另开本地对局会放弃当前联机对局，且不保留原房间恢复入口。',
      }
    : deckSourceStatus === 'unconfigured'
      ? {
          state: 'source-unavailable' as PrimaryActionState,
          title: '卡组来源不可用',
          description: '当前没有可用 API 服务，无法同步云端卡组与房间信息。',
          cta: '查看准备页',
          icon: Database,
          onClick: onNavigateToGameSetup,
        }
      : deckSourceStatus === 'offline' && hasLegalDeck
        ? {
            state: 'ready' as PrimaryActionState,
            title: '开始本地对战',
            description: '选择对墙打或双人调试，使用当前浏览器中的合法卡组开始对局。',
            cta: '开始本地对战',
            icon: Gamepad2,
            onClick: onNavigateToGameSetup,
          }
        : deckSourceStatus === 'offline'
          ? {
              state: 'needs-deck' as PrimaryActionState,
              title: '构筑本地卡组',
              description: '当前浏览器还没有符合构筑规则的卡组。',
              cta: '去卡组管理',
              icon: BookOpen,
              onClick: onNavigateToDeckManager,
              supportAction: {
                label: '进入准备页',
                onClick: onNavigateToGameSetup,
              },
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
            : cloudDeckLoadState === 'ERROR' && cloudDecksLoadedAt === null
              ? {
                  state: 'source-unavailable' as PrimaryActionState,
                  title: '暂时无法读取卡组',
                  description: '首次读取云端卡组失败，请重试后再开始对战。',
                  cta: '重新读取',
                  icon: RefreshCw,
                  onClick: () => void refreshCloudDecks(),
                }
              : hasLegalDeck
                ? {
                    state: 'ready' as PrimaryActionState,
                    title: '开始对战',
                    description: '选择本局的对战方式并完成准备。',
                    cta: '开始对战',
                    icon: Gamepad2,
                    onClick: onNavigateToGameSetup,
                  }
                : {
                    state: 'needs-deck' as PrimaryActionState,
                    title: '构筑卡组',
                    description: '还没有符合构筑规则的卡组。请先创建或调整一副卡组。',
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
      title: '新手教程',
      icon: School,
      onClick: onNavigateToTutorial,
      status: '无需卡组 · 约 5 分钟',
      tone: 'blue',
    },
  ];

  if (battleEntryVisibility.ranked) {
    secondaryActions.push({
      title: '赛季排位',
      icon: Medal,
      onClick: onNavigateToRanked,
      disabled: !canUseOnlineRoom || !hasLegalDeck,
      status: !canUseOnlineRoom
        ? '连接后可用'
        : !hasLegalDeck
          ? '需要符合规则的卡组'
          : '固定时段 · 计入积分',
      tone: canUseOnlineRoom && hasLegalDeck ? 'warning' : 'muted',
    });
  }

  if (battleEntryVisibility.themeTable) {
    secondaryActions.push({
      title: '娱乐模式',
      icon: Sparkles,
      onClick: onNavigateToThemeTable,
      disabled: !canUseOnlineRoom,
      status: canUseOnlineRoom ? '平台预组 · 记录胜负' : '连接后可用',
      tone: canUseOnlineRoom ? 'blue' : 'muted',
    });
  }

  secondaryActions.push(
    {
      title: '房间观战',
      icon: Eye,
      onClick: onNavigateToOnlineSpectator,
      disabled: !canUseOnlineRoom,
      compact: !canUseOnlineRoom,
      status: canUseOnlineRoom ? '输入房间号' : '连接后可用',
      tone: canUseOnlineRoom ? 'green' : 'muted',
    },
    {
      title: '历史对局',
      icon: History,
      onClick: onNavigateToMatchRecords,
      disabled: !canUseCloudDecks,
      compact: !canUseCloudDecks,
      status: canUseCloudDecks ? '只读回放' : '连接后可用',
      tone: canUseCloudDecks ? 'green' : 'muted',
    }
  );

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
    <ProductFrame
      active="home"
      navigation={navigation}
      className="lobby-page"
      actions={headerActions}
      mobileMenuActions={mobileMenuActions}
      footer={
        <footer className="safe-bottom relative z-10 px-4 py-3">
          <AppCredits version={__APP_VERSION__} />
        </footer>
      }
    >
      <main className="lobby-main">
        <div className="lobby-content">
          <header className="lobby-intro">
            <div>
              <span className="lobby-intro__eyebrow">PLAYER LOBBY</span>
              <h1>欢迎回来，{displayUsername}</h1>
            </div>
            <div className={`lobby-connection ${connectionStatus.tone}`}>
              <ConnectionStatusIcon size={15} aria-hidden="true" />
              <span>{connectionStatus.label}</span>
            </div>
          </header>

          <section className="lobby-primary">
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
          </section>

          <section className="lobby-workspace">
            <DeckWorkspacePanel
              deckCount={canUseCloudDecks ? cloudDecks.length : localDecks.length}
              validDeckCount={validDeckItems.length}
              latestDeck={latestDeck}
              validDecks={validDeckItems.slice(0, 5)}
              recentDecks={deckItems.slice(0, 3)}
              isLoading={isInitialDeckLoading}
              isRefreshing={isRefreshingDecks}
              hasError={Boolean(canUseCloudDecks && cloudError)}
              deckSourceStatus={deckSourceStatus}
              onRefresh={refreshCloudDecks}
              onManageDecks={onNavigateToDeckManager}
            />

            <SecondaryEntryPanel actions={secondaryActions} />
          </section>

          {hasManagementAccess && profile ? (
            <section className="border-t border-[var(--border-subtle)] pt-4">
              <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-[var(--text-secondary)]">
                <ShieldAlert size={16} className="text-[var(--accent-secondary)]" />
                运营工具
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <ActionTile
                  title={profile.role === 'season_admin' ? '赛季运营中心' : '运营管理中心'}
                  description={
                    profile.role === 'season_admin'
                      ? '管理排位、娱乐模式与玩家入口。'
                      : '统一进入内容、卡牌规则、用户权限、联机房间与赛季管理。'
                  }
                  icon={ShieldAlert}
                  onClick={onNavigateToAdminCenter}
                  status={profile.role === 'season_admin' ? '赛季管理员' : '平台管理员'}
                  tone="primary"
                  compact
                />
              </div>
            </section>
          ) : null}
        </div>
      </main>
    </ProductFrame>
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
              <h2 className="text-sm font-semibold text-[var(--text-primary)]">
                {maintenance.title}
              </h2>
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
  return lifecycle === 'RESTRICTING_NEW_GAMES' || lifecycle === 'MAINTENANCE';
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

function SecondaryEntryPanel({ actions }: { actions: ActionTileProps[] }) {
  return (
    <aside className="lobby-entry-panel">
      <div className="lobby-section-heading">
        <h2>常用入口</h2>
      </div>
      <div className="lobby-entry-grid">
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
  supportAction?: { label: string; onClick: () => void; disabled?: boolean };
  state: PrimaryActionState;
  notice?: string;
}) {
  return (
    <div className="lobby-action-bar">
      <span className="lobby-action-bar__label">NEXT ACTION</span>
      <div className="lobby-action-bar__content">
        <div className="lobby-action-bar__copy">
          <div className="lobby-action-bar__icon">
            <Icon size={18} className={state === 'loading' ? 'animate-spin' : ''} />
          </div>
          <div className="min-w-0">
            <h2>{title}</h2>
            <p>{description}</p>
            {notice && <small>{notice}</small>}
          </div>
        </div>

        <div className="lobby-action-bar__actions">
          <button type="button" onClick={onClick} className="lobby-action-bar__primary">
            {cta}
            <ArrowRight size={16} />
          </button>
          {supportAction && (
            <button
              type="button"
              onClick={supportAction.onClick}
              disabled={supportAction.disabled}
              className="lobby-action-bar__secondary"
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
  deckCount,
  validDeckCount,
  latestDeck,
  validDecks,
  recentDecks,
  isLoading,
  isRefreshing,
  hasError,
  deckSourceStatus,
  onRefresh,
  onManageDecks,
}: {
  deckCount: number;
  validDeckCount: number;
  latestDeck: DeckDisplayItem | null;
  validDecks: DeckDisplayItem[];
  recentDecks: DeckDisplayItem[];
  isLoading: boolean;
  isRefreshing: boolean;
  hasError: boolean;
  deckSourceStatus: DeckSourceStatus;
  onRefresh: () => void;
  onManageDecks: () => void;
}) {
  const isOnline = deckSourceStatus === 'online';
  const isInitialLoading = isOnline && isLoading && deckCount === 0;
  const workspaceTitle = validDeckCount > 0 ? '可用卡组' : '卡组准备';
  const sourceSummary =
    deckSourceStatus === 'offline'
      ? validDeckCount > 0
        ? deckCount === validDeckCount
          ? `${validDeckCount} 副本地卡组可用于对局。`
          : `${validDeckCount} / ${deckCount} 副本地卡组可用于对局。`
        : `共 ${deckCount} 副本地卡组，暂无符合构筑规则的卡组。`
      : deckSourceStatus === 'unconfigured'
        ? '本地服务未配置。'
        : isInitialLoading
          ? '正在同步云端卡组列表。'
          : validDeckCount > 0
            ? deckCount === validDeckCount
              ? `${validDeckCount} 副云端卡组可用于对局。`
              : `${validDeckCount} / ${deckCount} 副云端卡组可用于对局。`
            : `共 ${deckCount} 副云端卡组，暂无符合构筑规则的卡组。`;

  const emptyState = isInitialLoading
    ? {
        icon: Cloud,
        title: '正在读取卡组',
        detail: '正在同步云端卡组列表，读取完成前不会判断为空。',
        tone: 'info' as const,
      }
    : deckSourceStatus === 'offline'
      ? {
          icon: BookOpen,
          title: '暂无可用本地卡组',
          detail: '可从空白、YAML 或内置示例创建卡组，保存后即可用于本地对局。',
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
              title: '暂无可用卡组',
              detail: '请先创建或调整一副符合构筑规则的卡组，再开始对局。',
              tone: 'warning' as const,
            };
  const hasVisibleValidDecks = !isInitialLoading && validDecks.length > 0;
  const invalidRecentDecks = recentDecks.filter((deck) => !deck.isValid).slice(0, 3);
  const showLatestInvalidDeck =
    hasVisibleValidDecks && latestDeck
      ? !validDecks.some((deck) => deck.id === latestDeck.id)
      : false;

  return (
    <section className="lobby-deck-panel">
      <div className="lobby-deck-panel__header">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <BookOpen size={17} className="text-[var(--accent-primary)]" />
            <h3 className="text-lg font-semibold text-[var(--text-primary)]">{workspaceTitle}</h3>
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
            disabled={!isOnline || isLoading || isRefreshing}
            className="button-icon h-10 w-10 disabled:cursor-not-allowed disabled:opacity-45"
            title="刷新卡组"
          >
            <RefreshCw size={15} className={isLoading || isRefreshing ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      <div className="mt-4 grid gap-3">
        {hasError && hasVisibleValidDecks && (
          <div
            role="status"
            className="flex items-start gap-2 rounded-lg border border-[color:color-mix(in_srgb,var(--semantic-warning)_32%,transparent)] bg-[color:color-mix(in_srgb,var(--semantic-warning)_8%,transparent)] px-3 py-2 text-xs leading-5 text-[var(--text-secondary)]"
          >
            <TriangleAlert size={15} className="mt-0.5 shrink-0 text-[var(--semantic-warning)]" />
            后台更新失败，当前卡组列表仍可继续使用。
          </div>
        )}

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
    </section>
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
      <button
        type="button"
        onClick={disabled ? undefined : onClick}
        disabled={disabled}
        aria-label={status ? `${title}，${status}` : title}
        className={`group flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition ${
          compact ? 'lobby-entry-tile' : ''
        } ${description ? 'min-h-[68px]' : 'min-h-14'} ${
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
            <h3 className="truncate text-sm font-semibold text-[var(--text-primary)]">{title}</h3>
            {status && (
              <span className="lobby-entry-tile__status shrink-0 rounded-md border border-[var(--border-subtle)] px-2 py-0.5 text-[11px] text-[var(--text-secondary)]">
                {status}
              </span>
            )}
          </div>
          {description && (
            <p className="mt-0.5 line-clamp-1 text-xs leading-5 text-[var(--text-secondary)]">
              {description}
            </p>
          )}
        </div>
      </button>
    );
  }

  return (
    <button
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
          <h3 className="min-w-0 truncate text-base font-semibold text-[var(--text-primary)]">
            {title}
          </h3>
          {!disabled && (
            <ArrowRight
              size={15}
              className="text-[var(--text-muted)] transition-transform group-hover:translate-x-0.5"
            />
          )}
        </div>
        {description && (
          <p className="mt-1 line-clamp-2 text-sm leading-5 text-[var(--text-secondary)]">
            {description}
          </p>
        )}
      </div>
    </button>
  );
}
