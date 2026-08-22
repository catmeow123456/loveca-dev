import { useState, type ComponentType } from 'react';
import {
  Bell,
  Bot,
  ChevronRight,
  Loader2,
  Medal,
  MonitorCog,
  Save,
  Scale,
  Settings,
  SmilePlus,
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

interface AdminCenterPageProps {
  readonly role: UserRole;
  readonly onBack: () => void;
  readonly onOpenMatchEmotes: () => void;
  readonly onOpenAnnouncements: () => void;
  readonly onOpenCards: () => void;
  readonly onOpenAiExtraction: () => void;
  readonly onOpenDeckPoints: () => void;
  readonly onOpenOnlineRooms: () => void;
  readonly onOpenPlatformOperations: () => void;
  readonly onOpenRanked: () => void;
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
  readonly permission: ManagementPermission;
}

interface AdminCategory {
  readonly id: string;
  readonly title: string;
  readonly description: string;
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
      id: 'content-platform',
      title: '内容与平台',
      description: '玩家可见内容和平台状态',
      modules: [
        {
          title: '快捷表情',
          description: '编辑对局表情、显示顺序和发送状态',
          icon: SmilePlus,
          onOpen: props.onOpenMatchEmotes,
          permission: 'platform.manage',
        },
        {
          title: '平台配置',
          description: '维护平台状态、维护窗口和公告',
          icon: Bell,
          onOpen: props.onOpenAnnouncements,
          permission: 'platform.manage',
        },
        {
          title: '数据维护',
          description: '清理过期回放并导出赛季积分报告',
          icon: MonitorCog,
          onOpen: props.onOpenPlatformOperations,
          permission: 'platform.manage',
        },
      ],
    },
    {
      id: 'cards-rules',
      title: '卡牌与规则',
      description: '卡牌资料、录入工具和构筑规则',
      modules: [
        {
          title: '卡牌数据',
          description: '检索、编辑和发布卡牌资料',
          icon: Settings,
          onOpen: props.onOpenCards,
          permission: 'cards.manage',
        },
        {
          title: '卡牌效果 AI 提取',
          description: '配置提取服务、模型和私密凭据',
          icon: Bot,
          onOpen: props.onOpenAiExtraction,
          permission: 'cards.manage',
        },
        {
          title: '卡组规则',
          description: '维护 PT 限制表和规则生效时间',
          icon: Scale,
          onOpen: props.onOpenDeckPoints,
          permission: 'rules.manage',
        },
      ],
    },
    {
      id: 'matches-seasons',
      title: '对局与赛季',
      description: '联机运行状态和竞技运营',
      modules: [
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
      id: 'users-permissions',
      title: '用户与权限',
      description: '账号查询与角色委派',
      modules: [
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
      modules: category.modules.filter((module) => hasPermission(props.role, module.permission)),
    }))
    .filter((category) => category.modules.length > 0);
  const toolCount = categories.reduce((sum, category) => sum + category.modules.length, 0);
  const isSeasonAdmin = props.role === 'season_admin';

  return (
    <div className="app-shell min-h-screen">
      <PageHeader
        title={isSeasonAdmin ? '赛季运营中心' : '运营管理中心'}
        description={isSeasonAdmin ? '排位、娱乐模式与玩家入口' : '选择一项工作'}
        onBack={props.onBack}
        backLabel="返回大厅"
      />

      <main className="product-page-main">
        <div className="mx-auto max-w-5xl">
          {hasPermission(props.role, 'season.entry_visibility.manage') ? (
            <section
              aria-labelledby="player-battle-entry-title"
              className="product-workbench mb-5 overflow-hidden"
            >
              <header className="flex flex-col gap-3 border-b border-[var(--border-subtle)] px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
                <div>
                  <h2
                    id="player-battle-entry-title"
                    className="text-sm font-semibold text-[var(--text-primary)]"
                  >
                    玩家对战入口
                  </h2>
                  <p className="mt-1 text-xs leading-5 text-[var(--text-muted)]">
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
            </section>
          ) : null}

          <div className="mb-4 flex items-center justify-between gap-4 px-1">
            <p className="text-sm text-[var(--text-secondary)]">
              {isSeasonAdmin
                ? '管理本期排位、娱乐模式和玩家入口。'
                : '管理公开内容、卡牌规则、用户权限与联机运营。'}
            </p>
            <span className="shrink-0 text-xs tabular-nums text-[var(--text-muted)]">
              {toolCount} 项工具
            </span>
          </div>

          <div className="product-workbench divide-y divide-[var(--border-subtle)]">
            {categories.map((category) => (
              <section
                key={category.id}
                id={category.id}
                aria-labelledby={`${category.id}-title`}
                className="grid md:grid-cols-[12rem_minmax(0,1fr)]"
              >
                <header className="relative px-4 py-4 sm:px-5 md:py-5">
                  <span
                    aria-hidden="true"
                    className="absolute bottom-4 left-0 top-4 w-0.5 rounded-full bg-[var(--accent-primary)]"
                  />
                  <h2
                    id={`${category.id}-title`}
                    className="text-sm font-semibold text-[var(--text-primary)]"
                  >
                    {category.title}
                  </h2>
                  <p className="mt-1 text-xs leading-5 text-[var(--text-muted)]">
                    {category.description}
                  </p>
                </header>

                <div className="divide-y divide-[var(--border-subtle)] md:border-l md:border-[var(--border-subtle)]">
                  {category.modules.map((module) => (
                    <AdminModuleRow key={module.title} module={module} />
                  ))}
                </div>
              </section>
            ))}
          </div>
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

function AdminModuleRow({ module }: { module: AdminModule }) {
  const Icon = module.icon;
  return (
    <button
      type="button"
      onClick={module.onOpen}
      className="group flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-[var(--bg-elevated)] focus-visible:bg-[var(--bg-elevated)] sm:px-5"
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[color:color-mix(in_srgb,var(--accent-primary)_10%,transparent)] text-[var(--accent-primary)]">
        <Icon size={17} />
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
