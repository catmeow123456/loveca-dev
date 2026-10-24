import { getPresentationPortalRoot, useTextPresentation } from '@/lib/appPresentation';
import { memo, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import {
  BookOpen,
  Hand,
  MessageCircle,
  MousePointer2,
  RotateCcw,
  type LucideIcon,
  Zap,
} from 'lucide-react';
import { useDialogAccessibility } from '@/hooks/useDialogAccessibility';
import { ActionButton, DialogShell, Tabs } from '@/components/common';

export type PreMatchBriefingMode = 'online' | 'solitaire' | 'debug';

interface PreMatchBriefingModalProps {
  isOpen: boolean;
  mode: PreMatchBriefingMode;
  onClose: () => void;
}

interface BriefingSection {
  title: string;
  icon: LucideIcon;
  items: readonly ReactNode[];
}

interface BriefingPage {
  title: string;
  summary: string;
  sections: readonly BriefingSection[];
}

interface BriefingContent {
  title: string;
  subtitle: string;
  pages: readonly BriefingPage[];
  actionLabel: string;
}

export const PreMatchBriefingModal = memo(function PreMatchBriefingModal({
  isOpen,
  mode,
  onClose,
}: PreMatchBriefingModalProps) {
  if (!isOpen) {
    return null;
  }

  return <PreMatchBriefingContent key={mode} mode={mode} onClose={onClose} />;
});

function PreMatchBriefingContent({
  mode,
  onClose,
}: Pick<PreMatchBriefingModalProps, 'mode' | 'onClose'>) {
  const textOnly = useTextPresentation();
  const [activePageIndex, setActivePageIndex] = useState(0);
  const tabsId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  useDialogAccessibility({
    isOpen: textOnly,
    dialogRef,
    initialFocusRef: closeButtonRef,
    onEscape: onClose,
  });

  const content = getBriefingContent(mode);
  const lastPageIndex = content.pages.length - 1;
  const currentPageIndex = Math.min(activePageIndex, lastPageIndex);
  const currentPage = content.pages[currentPageIndex];
  const nextPage = content.pages[currentPageIndex + 1];
  const goToPreviousPage = () => setActivePageIndex((index) => Math.max(0, index - 1));
  const goToNextPageOrClose = () => {
    if (nextPage) {
      setActivePageIndex((index) => Math.min(lastPageIndex, index + 1));
      return;
    }
    onClose();
  };

  if (textOnly)
    return createPortal(
      <div className="excel-modal-backdrop">
        <section
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="excel-briefing-title"
          className="excel-modal"
        >
          <h2 id="excel-briefing-title">表格操作说明</h2>
          <p>双方场面、我方手牌与 LIVE 摘要在左侧，当前选择和确认在右侧。</p>
          <p>
            点选手牌或区域中的卡牌行，在右侧阅读完整卡效和选择可用操作；效果候选的“查看”只展开卡文。
          </p>
          <p>有序选择使用序号及上移、下移按钮；Tab、Enter 和空格可以操作按钮和选择框。</p>
          <p>遮挡工作区期间继续同步和计时，需要玩家确认的选择不会自动提交。</p>
          <button ref={closeButtonRef} onClick={onClose}>
            跳过提示
          </button>
        </section>
      </div>,
      getPresentationPortalRoot()
    );

  return (
    <DialogShell
      isOpen
      title={content.title}
      description={content.subtitle}
      icon={<BookOpen size={20} />}
      onClose={onClose}
      closeLabel="关闭玩前须知"
      closeOnBackdrop={false}
      contentKey={currentPageIndex}
      navigation={
        <Tabs
          id={tabsId}
          panelId={`${tabsId}-panel`}
          label="提示主题"
          value={String(currentPageIndex)}
          options={content.pages.map((page, index) => ({
            value: String(index),
            label: page.title,
          }))}
          onChange={(value) => setActivePageIndex(Number(value))}
        />
      }
      footer={
        <>
          <ActionButton variant="ghost" onClick={onClose} className="mr-auto">
            跳过提示
          </ActionButton>
          {currentPageIndex > 0 && (
            <ActionButton variant="ghost" onClick={goToPreviousPage}>
              上一页
            </ActionButton>
          )}
          <ActionButton
            onClick={goToNextPageOrClose}
            aria-label={nextPage ? `下一页：${nextPage.title}` : content.actionLabel}
          >
            {nextPage ? '下一页' : mode === 'solitaire' ? '开始模拟' : '进入对局'}
          </ActionButton>
        </>
      }
    >
      <section
        id={`${tabsId}-panel`}
        role="tabpanel"
        aria-labelledby={`${tabsId}-${currentPageIndex}`}
        tabIndex={0}
      >
        <p className="mb-4 text-sm text-[var(--text-secondary)]">{currentPage.summary}</p>
        <div className="divide-y divide-[var(--border-subtle)]">
          {currentPage.sections.map((section) => {
            const Icon = section.icon;
            return (
              <section key={section.title} className="py-4 first:pt-0 last:pb-0">
                <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)]">
                  <Icon size={16} className="text-[var(--accent-primary)]" aria-hidden="true" />
                  {section.title}
                </h3>
                <ul className="list-disc space-y-2 pl-5 text-[var(--text-secondary)]">
                  {section.items.map((item, index) => (
                    <li key={index}>{item}</li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      </section>
    </DialogShell>
  );
}

export default PreMatchBriefingModal;

function RuleTerm({ children }: { readonly children: ReactNode }) {
  return (
    <span className="mx-0.5 inline-flex items-center rounded-[4px] border border-[color:color-mix(in_srgb,var(--accent-primary)_34%,var(--border-subtle))] bg-[color:color-mix(in_srgb,var(--accent-primary)_9%,var(--bg-surface))] px-1.5 py-[1px] align-baseline text-[0.82em] font-semibold leading-5 text-[var(--accent-primary)] shadow-[0_0_0_1px_color-mix(in_srgb,var(--bg-surface)_48%,transparent)]">
      {children}
    </span>
  );
}

function PhaseTerm({ children }: { readonly children: ReactNode }) {
  return (
    <strong className="mx-0.5 inline-flex items-center rounded-[4px] bg-[color:color-mix(in_srgb,var(--semantic-warning)_18%,var(--bg-surface))] px-1.5 py-[1px] align-baseline font-semibold leading-5 text-[var(--text-primary)] shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--semantic-warning)_42%,transparent)]">
      {children}
    </strong>
  );
}

const PHASE_PAGE: BriefingPage = {
  title: '阶段重点',
  summary: '活跃、能量、抽卡会自动推进；真正需要你判断和操作的是主要阶段与 LIVE 阶段。',
  sections: [
    {
      title: '自动阶段',
      icon: Zap,
      items: ['活跃、能量、抽卡这几步大多由系统自动处理；正常情况下确认当前手牌和能量状态即可。'],
    },
    {
      title: '主要阶段',
      icon: MousePointer2,
      items: [
        <>
          <PhaseTerm>主要阶段</PhaseTerm>
          是出成员、换手、发动起动效果、整理休息室回收和人工补齐卡效结果的主要窗口。
        </>,
        '拖拽和点按是主要操作。拖拽时出现的高亮只是提醒，不代表任何时候都一定能放过去。',
        '双击成员可以在活跃状态和等待状态之间切换，方便处理支付费用、效果或手动调整。',
      ],
    },
    {
      title: 'LIVE 阶段',
      icon: BookOpen,
      items: [
        <>
          <PhaseTerm>LIVE 阶段</PhaseTerm>
          会依次处理 LIVE 放置、LIVE 开始效果、声援 / 判定、成功与分数确认。
        </>,
        '同一时点有多个效果时，先确认发动顺序，再继续点下一步；联机时尤其要先和对手说清楚。',
      ],
    },
  ],
};

const AREA_PAGE: BriefingPage = {
  title: '区域操作',
  summary: '这些区域最容易在手动处理和效果结算时用到，先记住点击与拖拽边界。',
  sections: [
    {
      title: '公开与处理区',
      icon: BookOpen,
      items: [
        <>
          <RuleTerm>休息室</RuleTerm>
          是公开区域，可以点开查看。需要从休息室回收或移动卡牌时，按当前卡文和阶段窗口处理。
        </>,
        <>
          需要检视卡组时，点击
          <RuleTerm>主卡组</RuleTerm>
          图标打开
          <RuleTerm>检视区</RuleTerm>
          ；不要直接拖拽卡组顶的卡来代替检视。
        </>,
        <>
          <RuleTerm>检视区</RuleTerm>
          是正式处理区。公开、加入手牌、回卡组顶/底、其余进休息室，都以窗口确认后的结果为准。
        </>,
        <>
          <RuleTerm>判定区</RuleTerm>
          用来显示声援 / 判定过程中的卡。自动判定结果可以检查，必要时再按规则人工调整。
        </>,
      ],
    },
    {
      title: '舞台和 LIVE',
      icon: Hand,
      items: [
        <>
          <RuleTerm>成员区</RuleTerm>
          有左 / 中 / 右 3 个槽位，是成员登场、换手、移动位置和发动能力的主要区域。
        </>,
        <>
          双击
          <RuleTerm>成员区</RuleTerm>
          的成员，可以在活跃和待机状态之间切换，常用于支付费用或手动处理卡文结果。
        </>,
        <>
          某些卡牌已经实现效果自动化；点击这些成员时，会出现效果弹窗来处理登场效果、自动效果或起动效果。
        </>,
        <>
          <RuleTerm>LIVE 区</RuleTerm>
          放置当前要表演的 LIVE 卡；成功与否应走 LIVE 阶段的判定和确认流程，不要直接跳到成功区。
        </>,
        <>
          <RuleTerm>成功 LIVE 区</RuleTerm>
          记录已经成功的 LIVE。胜利条件和部分卡效会读取这里的张数。
        </>,
      ],
    },
    {
      title: '能量',
      icon: Zap,
      items: [
        <>
          <RuleTerm>能量区</RuleTerm>
          的能量有活跃和等待两种状态。点按一张能量，可以在两种状态之间切换。
        </>,
        <>
          自由操作模式下，
          <RuleTerm>能量区</RuleTerm>
          上方的“全活”“全待”可以一次处理全部能量；规则模式会隐藏这组整理按钮。
        </>,
        <>
          需要模拟“跳费”或处理从
          <RuleTerm>能量卡组</RuleTerm>
          放置能量的效果时，可以把
          <RuleTerm>能量卡组</RuleTerm>
          最上方那张能量拖到
          <RuleTerm>能量区</RuleTerm>。
        </>,
      ],
    },
  ],
};

const EFFECT_WINDOW_ITEMS: readonly ReactNode[] = [
  '正在处理的效果会出现在中央窗口，先看来源卡和卡文，再选择目标、支付费用或确认继续。',
  '部分卡还没有实现效果自动化；需要人工补齐时，请先切换到自由模式，再按卡文用自由移动、免费登场或区域操作处理。',
];

function createEffectPage(mode: PreMatchBriefingMode): BriefingPage {
  const communicationSection: BriefingSection =
    mode === 'online'
      ? {
          title: '双方怎么配合',
          icon: MessageCircle,
          items: [
            '双方各自操作自己这一侧。公开领域会给双方看见，手牌、卡组顶等非公开信息只给该看的玩家看。',
            '同一时点有多个效果时，先用语音或文字说清楚发动顺序、是否发动和选择结果，再继续操作。',
            '页面卡住或刷新后，一般可以回到原来的房间和对局；如果状态有争议，先和对手确认再继续。',
          ],
        }
      : mode === 'debug'
        ? {
            title: '双人调试',
            icon: Hand,
            items: [
              '在同一设备操作双方；规则模式会在命令完成后跟随当前操作方，也可用视角入口切换。',
              '每个视角仍只显示该玩家可见的信息；调试对局不会保存到历史。',
            ],
          }
        : {
            title: '单人模拟',
            icon: Hand,
            items: [
              '对手侧会自动处理一部分无输入流程；如果你要验证某段卡效，可以用手动区域操作把局面摆到需要的位置。',
              '手动处理完一段卡文后，确认各区域和卡牌状态都符合文本，再继续推进下一步。',
            ],
          };

  const sections: BriefingSection[] = [
    {
      title: '效果处理',
      icon: BookOpen,
      items: EFFECT_WINDOW_ITEMS,
    },
    communicationSection,
  ];

  if (mode === 'online') {
    sections.push({
      title: '异常与重开',
      icon: RotateCcw,
      items: [
        '正式联机的撤销需要对手同意。已经看见的信息不会因为撤销而变成没看见。',
        '进入对局后可在左上角请求重开或离开房间；重开需要对手同意，同意后会回到准备页重新锁组或直接准备。',
      ],
    });
  }

  return {
    title: mode === 'online' ? '效果和协作' : mode === 'debug' ? '效果和调试' : '效果和模拟',
    summary:
      mode === 'online'
        ? '自动化未覆盖的卡文先沟通，再用共享桌面把结果落实。'
        : '自动化未覆盖的卡文按文本处理，再用桌面操作补齐局面。',
    sections,
  };
}

function getBriefingPages(mode: PreMatchBriefingMode): readonly BriefingPage[] {
  return [PHASE_PAGE, AREA_PAGE, createEffectPage(mode)];
}

function getBriefingContent(mode: PreMatchBriefingMode): BriefingContent {
  if (mode === 'debug') {
    return {
      title: '双人调试操作提示',
      subtitle: '阶段、区域和双方视角操作',
      pages: getBriefingPages(mode),
      actionLabel: '我知道了，继续调试',
    };
  }
  if (mode === 'solitaire') {
    return {
      title: '对墙打模拟提示',
      subtitle: '开始前确认阶段重点、区域操作和卡牌效果处理方式',
      pages: getBriefingPages(mode),
      actionLabel: '我知道了，开始模拟',
    };
  }

  return {
    title: '联机对局提示',
    subtitle: '正式对局前，先确认双方怎么操作、怎么沟通',
    pages: getBriefingPages(mode),
    actionLabel: '我知道了，进入对局',
  };
}
