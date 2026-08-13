import { type ComponentType } from 'react';
import {
  Bell,
  Bot,
  ChevronRight,
  Medal,
  MonitorCog,
  Scale,
  Settings,
  SmilePlus,
} from 'lucide-react';
import { PageHeader } from '@/components/common';

interface AdminCenterPageProps {
  readonly onBack: () => void;
  readonly onOpenMatchEmotes: () => void;
  readonly onOpenAnnouncements: () => void;
  readonly onOpenCards: () => void;
  readonly onOpenAiExtraction: () => void;
  readonly onOpenDeckPoints: () => void;
  readonly onOpenOnlineRooms: () => void;
  readonly onOpenRanked: () => void;
}

interface AdminModule {
  readonly title: string;
  readonly description: string;
  readonly icon: ComponentType<{ size?: number }>;
  readonly onOpen: () => void;
}

interface AdminCategory {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly modules: readonly AdminModule[];
}

export function AdminCenterPage(props: AdminCenterPageProps) {
  const categories: readonly AdminCategory[] = [
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
        },
        {
          title: '平台配置',
          description: '维护平台状态、维护窗口和公告',
          icon: Bell,
          onOpen: props.onOpenAnnouncements,
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
        },
        {
          title: '卡牌效果 AI 提取',
          description: '配置提取服务、模型和私密凭据',
          icon: Bot,
          onOpen: props.onOpenAiExtraction,
        },
        {
          title: '卡组规则',
          description: '维护 PT 限制表和规则生效时间',
          icon: Scale,
          onOpen: props.onOpenDeckPoints,
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
        },
        {
          title: '赛季排位',
          description: '管理赛季、排位配置和异常结算',
          icon: Medal,
          onOpen: props.onOpenRanked,
        },
      ],
    },
  ];

  return (
    <div className="app-shell min-h-screen">
      <PageHeader
        title="运营管理中心"
        description="选择一项工作"
        onBack={props.onBack}
        backLabel="返回大厅"
      />

      <main className="product-page-main">
        <div className="mx-auto max-w-5xl">
          <div className="mb-4 flex items-center justify-between gap-4 px-1">
            <p className="text-sm text-[var(--text-secondary)]">
              管理公开内容、卡牌规则与联机运营。
            </p>
            <span className="shrink-0 text-xs tabular-nums text-[var(--text-muted)]">7 项工具</span>
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
