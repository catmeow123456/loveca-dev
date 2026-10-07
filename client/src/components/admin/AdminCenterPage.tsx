import { useState, type ComponentType } from 'react';
import {
  Bell,
  Bot,
  ChevronDown,
  ChevronRight,
  Images,
  Loader2,
  Medal,
  MonitorCog,
  PieChart,
  Save,
  Scale,
  Settings,
  Sparkles,
  Users,
} from 'lucide-react';
import {
  hasPermission,
  type ManagementPermission,
  type UserRole,
} from '@game/shared/auth/permissions';
import { PageHeader } from '@/components/common';
import { useKeyedState } from '@/hooks/useKeyedState';
import type { PlayerBattleEntryVisibility } from '@/lib/appConfig';
import { updatePlayerBattleEntryVisibility } from '@/lib/siteAnnouncementClient';
import { ASSET_CATALOG_PERMISSIONS } from '@/lib/assetCatalogPermissions';

interface AdminCenterPageProps {
  readonly role: UserRole;
  readonly onBack: () => void;
  readonly onOpenAnnouncements: () => void;
  readonly onOpenCards: () => void;
  readonly onOpenAssets: () => void;
  readonly onOpenAiBattle: () => void;
  readonly onOpenDeckPoints: () => void;
  readonly onOpenOnlineRooms: () => void;
  readonly onOpenPlatformOperations: () => void;
  readonly onOpenRanked: () => void;
  readonly onOpenDeckClassifier: () => void;
  readonly onOpenThemeTable: () => void;
  readonly onOpenUsers: () => void;
  readonly battleEntryVisibility: PlayerBattleEntryVisibility;
  readonly onBattleEntryVisibilityChanged?: () => void | Promise<void>;
}

interface AdminModule {
  readonly title: string;
  readonly description: string;
  readonly icon: ComponentType<{ size?: number }>;
  readonly onOpen: () => void;
  readonly permission: ManagementPermission | readonly ManagementPermission[];
}

interface AdminCategory {
  readonly id: string;
  readonly title: string;
  readonly modules: readonly AdminModule[];
}

export function AdminCenterPage(props: AdminCenterPageProps) {
  const visibilityKey = `${props.battleEntryVisibility.ranked}:${props.battleEntryVisibility.themeTable}`;
  const [entryVisibility, setEntryVisibility] = useKeyedState(
    visibilityKey,
    props.battleEntryVisibility
  );
  const [isSavingEntryVisibility, setIsSavingEntryVisibility] = useState(false);
  const [entryVisibilityMessage, setEntryVisibilityMessage] = useState<string | null>(null);
  const hasEntryVisibilityChanges =
    entryVisibility.ranked !== props.battleEntryVisibility.ranked ||
    entryVisibility.themeTable !== props.battleEntryVisibility.themeTable;

  const handleSaveEntryVisibility = async () => {
    setIsSavingEntryVisibility(true);
    setEntryVisibilityMessage(null);
    try {
      const saved = await updatePlayerBattleEntryVisibility(entryVisibility);
      setEntryVisibility(saved);
      await props.onBattleEntryVisibilityChanged?.();
      setEntryVisibilityMessage('入口设置已保存');
    } catch (error) {
      setEntryVisibilityMessage(error instanceof Error ? error.message : '保存玩家对战入口失败');
    } finally {
      setIsSavingEntryVisibility(false);
    }
  };

  const allCategories: readonly AdminCategory[] = [
    {
      id: 'resources-data',
      title: '资源与数据',
      modules: [
        {
          title: '卡牌数据',
          description: '编辑发布、新卡同步与 AI 配置',
          icon: Settings,
          onOpen: props.onOpenCards,
          permission: 'cards.manage',
        },
        {
          title: '公共资产目录',
          description: '浏览与下载卡图、图片、表情和音乐',
          icon: Images,
          onOpen: props.onOpenAssets,
          permission: ASSET_CATALOG_PERMISSIONS,
        },
        {
          title: '卡组分类',
          description: '分类样板、规则与重分类',
          icon: PieChart,
          onOpen: props.onOpenDeckClassifier,
          permission: 'season.deck_classifier.manage',
        },
        {
          title: '卡组规则',
          description: 'PT 限制与规则生效时间',
          icon: Scale,
          onOpen: props.onOpenDeckPoints,
          permission: 'rules.manage',
        },
      ],
    },
    {
      id: 'matches-seasons',
      title: '对局与赛季',
      modules: [
        {
          title: 'AI 对战调试',
          description: '用精选构筑对战，查看 AI 决定与实际执行',
          icon: Bot,
          onOpen: props.onOpenAiBattle,
          permission: 'rules.manage',
        },
        {
          title: '联机房间',
          description: '查看在线玩家、等待房间和进行中对局',
          icon: MonitorCog,
          onOpen: props.onOpenOnlineRooms,
          permission: 'platform.manage',
        },
        {
          title: '赛季排位',
          description: '管理赛季、排位配置和异常结算',
          icon: Medal,
          onOpen: props.onOpenRanked,
          permission: 'season.ranked.manage',
        },
        {
          title: '娱乐模式',
          description: '管理开放时段与平台卡组池',
          icon: Sparkles,
          onOpen: props.onOpenThemeTable,
          permission: 'season.theme.manage',
        },
      ],
    },
    {
      id: 'platform-operations',
      title: '平台运营',
      modules: [
        {
          title: '平台配置',
          description: '平台状态、维护窗口与公告',
          icon: Bell,
          onOpen: props.onOpenAnnouncements,
          permission: 'platform.manage',
        },
        {
          title: '数据维护',
          description: '回放清理与赛季数据导出',
          icon: MonitorCog,
          onOpen: props.onOpenPlatformOperations,
          permission: 'platform.manage',
        },
        {
          title: '用户管理',
          description: '分页检索账号并授予或撤销平台角色',
          icon: Users,
          onOpen: props.onOpenUsers,
          permission: 'users.list',
        },
      ],
    },
  ];
  const categories = allCategories
    .map((category) => ({
      ...category,
      modules: category.modules.filter((module) =>
        typeof module.permission === 'string'
          ? hasPermission(props.role, module.permission)
          : module.permission.some((permission) => hasPermission(props.role, permission))
      ),
    }))
    .filter((category) => category.modules.length > 0);
  const isSeasonAdmin = props.role === 'season_admin';

  return (
    <div className="app-shell min-h-screen">
      <PageHeader
        title={isSeasonAdmin ? '赛季运营中心' : '运营管理中心'}
        onBack={props.onBack}
        backLabel="返回大厅"
        className="[&_.page-header-inner]:min-h-0 [&_.page-header-inner]:py-2 [&_.page-header-title]:text-lg"
      />

      <main className="product-page-main">
        <div className="mx-auto max-w-5xl">
          <div className="space-y-4">
            {categories.map((category) => (
              <section
                key={category.id}
                aria-labelledby={`${category.id}-title`}
                className="overflow-hidden border border-[var(--border-subtle)] bg-[var(--bg-surface)]"
              >
                <h2
                  id={`${category.id}-title`}
                  className="border-b border-[var(--border-subtle)] px-4 py-2 text-xs font-semibold text-[var(--text-muted)]"
                >
                  {category.title}
                </h2>
                <div className="grid gap-px bg-[var(--border-subtle)] md:grid-cols-2">
                  {category.modules.map((module, index) => (
                    <AdminModuleRow
                      key={module.title}
                      module={module}
                      fullWidth={
                        category.modules.length % 2 === 1 && index === category.modules.length - 1
                      }
                    />
                  ))}
                </div>
              </section>
            ))}
          </div>

          {hasPermission(props.role, 'season.entry_visibility.manage') ? (
            <details
              aria-labelledby="player-battle-entry-title"
              className="group mt-4 overflow-hidden border border-[var(--border-subtle)] bg-[var(--bg-surface)]"
            >
              <summary className="flex min-h-12 cursor-pointer list-none items-center gap-3 px-4 py-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--accent-primary)] [&::-webkit-details-marker]:hidden">
                <span
                  id="player-battle-entry-title"
                  className="font-medium text-[var(--text-primary)]"
                >
                  玩家入口设置
                </span>
                <span className="ml-auto text-xs text-[var(--text-muted)]">
                  {hasEntryVisibilityChanges
                    ? '有未保存修改'
                    : `排位${entryVisibility.ranked ? '已显示' : '已隐藏'} · 娱乐${entryVisibility.themeTable ? '已显示' : '已隐藏'}`}
                </span>
                <ChevronDown
                  size={15}
                  aria-hidden="true"
                  className="shrink-0 text-[var(--text-muted)] group-open:rotate-180"
                />
              </summary>
              <header className="flex flex-col gap-3 border-b border-[var(--border-subtle)] px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
                <div>
                  <p className="text-xs leading-5 text-[var(--text-muted)]">
                    关闭后，玩家大厅和对局准备页不再显示对应入口。
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void handleSaveEntryVisibility()}
                  disabled={isSavingEntryVisibility || !hasEntryVisibilityChanges}
                  className="button-primary inline-flex min-h-10 shrink-0 items-center justify-center gap-2 px-4 text-sm disabled:cursor-not-allowed disabled:opacity-45"
                >
                  {isSavingEntryVisibility ? (
                    <Loader2 size={15} className="animate-spin" aria-hidden="true" />
                  ) : (
                    <Save size={15} aria-hidden="true" />
                  )}
                  保存入口
                </button>
              </header>

              <div className="grid divide-y divide-[var(--border-subtle)] sm:grid-cols-2 sm:divide-x sm:divide-y-0">
                <BattleEntrySwitch
                  title="赛季排位"
                  detail="使用玩家卡组，计入赛季积分"
                  checked={entryVisibility.ranked}
                  onChange={(checked) => {
                    setEntryVisibility((current) => ({ ...current, ranked: checked }));
                    setEntryVisibilityMessage(null);
                  }}
                />
                <BattleEntrySwitch
                  title="娱乐模式"
                  detail="随机分配一副娱乐模式卡组"
                  checked={entryVisibility.themeTable}
                  onChange={(checked) => {
                    setEntryVisibility((current) => ({ ...current, themeTable: checked }));
                    setEntryVisibilityMessage(null);
                  }}
                />
              </div>

              <footer className="flex flex-col gap-1 border-t border-[var(--border-subtle)] px-4 py-3 text-xs sm:flex-row sm:items-center sm:justify-between sm:px-5">
                <span className="text-[var(--text-muted)]">暂停匹配请前往对应模式管理。</span>
                {entryVisibilityMessage ? (
                  <span
                    role="status"
                    className={
                      entryVisibilityMessage === '入口设置已保存'
                        ? 'text-[var(--semantic-success)]'
                        : 'text-[var(--semantic-error)]'
                    }
                  >
                    {entryVisibilityMessage}
                  </span>
                ) : null}
              </footer>
            </details>
          ) : null}
        </div>
      </main>
    </div>
  );
}

function BattleEntrySwitch({
  title,
  detail,
  checked,
  onChange,
}: {
  readonly title: string;
  readonly detail: string;
  readonly checked: boolean;
  readonly onChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-4 sm:px-5">
      <div className="min-w-0">
        <div className="text-sm font-semibold text-[var(--text-primary)]">{title}</div>
        <div className="mt-0.5 text-xs leading-5 text-[var(--text-secondary)]">{detail}</div>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={`${title}玩家入口`}
        onClick={() => onChange(!checked)}
        className={`relative h-7 w-12 shrink-0 rounded-full border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-deep)] ${
          checked
            ? 'border-[var(--accent-primary)] bg-[var(--accent-primary)]'
            : 'border-[var(--border-default)] bg-[var(--bg-elevated)]'
        }`}
      >
        <span
          aria-hidden="true"
          className={`absolute left-1 top-1 h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${
            checked ? 'translate-x-5' : 'translate-x-0'
          }`}
        />
      </button>
    </div>
  );
}

function AdminModuleRow({
  module,
  fullWidth = false,
}: {
  module: AdminModule;
  fullWidth?: boolean;
}) {
  const Icon = module.icon;
  return (
    <button
      type="button"
      onClick={module.onOpen}
      className={`group flex min-h-18 w-full items-center gap-3 bg-[var(--bg-surface)] px-4 py-3 text-left transition-colors hover:bg-[var(--bg-elevated)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--accent-primary)] ${fullWidth ? 'md:col-span-2' : ''}`}
    >
      <span className="shrink-0 text-[var(--accent-primary)]">
        <Icon size={18} aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-[var(--text-primary)]">
          {module.title}
        </span>
        <span className="mt-0.5 block text-xs leading-5 text-[var(--text-secondary)]">
          {module.description}
        </span>
      </span>
      <ChevronRight
        size={16}
        aria-hidden="true"
        className="shrink-0 text-[var(--text-muted)] transition-transform group-hover:translate-x-0.5 group-hover:text-[var(--accent-primary)]"
      />
    </button>
  );
}
