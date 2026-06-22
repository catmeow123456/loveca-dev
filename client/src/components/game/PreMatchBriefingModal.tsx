import { memo, useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';
import {
  BookOpen,
  Hand,
  MessageCircle,
  MousePointer2,
  RotateCcw,
  type LucideIcon,
  X,
  Zap,
} from 'lucide-react';

export type PreMatchBriefingMode = 'online' | 'solitaire';

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
  const [activePageIndex, setActivePageIndex] = useState(0);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onClose]);

  useEffect(() => {
    if (isOpen) {
      setActivePageIndex(0);
    }
  }, [isOpen, mode]);

  if (!isOpen) return null;

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

  const modalContent = (
    <>
      <div className="modal-backdrop z-[190]" />

      <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
        <motion.div
          className="modal-surface modal-accent-indigo flex w-[min(94vw,760px)] max-h-[88vh] flex-col overflow-hidden"
          initial={{ opacity: 0, scale: 0.96, y: 12 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.96, y: 12 }}
        >
          <div className="modal-header flex items-center justify-between gap-3 px-6 py-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full border border-[var(--border-default)] bg-[color:color-mix(in_srgb,var(--accent-primary)_12%,var(--bg-surface))] text-[var(--accent-primary)]">
                <BookOpen size={18} />
              </div>
              <div>
                <div className="text-base font-semibold text-[var(--text-primary)]">
                  {content.title}
                </div>
                <div className="text-xs text-[var(--text-secondary)]">
                  {content.subtitle}
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="button-icon h-8 w-8"
              title="关闭"
              aria-label="关闭玩前须知"
            >
              <X size={14} />
            </button>
          </div>

          <div className="cute-scrollbar flex-1 overflow-y-auto px-6 py-5 text-sm leading-relaxed text-[var(--text-primary)]">
            <div className="mb-4 grid grid-cols-3 gap-2 rounded-lg border border-[var(--border-subtle)] bg-[color:color-mix(in_srgb,var(--bg-surface)_72%,transparent)] p-1.5">
              {content.pages.map((page, index) => {
                const isActive = index === currentPageIndex;
                return (
                  <button
                    key={page.title}
                    type="button"
                    onClick={() => setActivePageIndex(index)}
                    className={`min-h-9 rounded-md px-2 text-xs font-semibold transition-colors ${
                      isActive
                        ? 'bg-[color:color-mix(in_srgb,var(--accent-primary)_16%,var(--bg-surface))] text-[var(--text-primary)] shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--accent-primary)_38%,transparent)]'
                        : 'text-[var(--text-secondary)] hover:bg-[var(--bg-overlay)] hover:text-[var(--text-primary)]'
                    }`}
                  >
                    {page.title}
                  </button>
                );
              })}
            </div>

            <div className="mb-2">
              <div className="text-base font-bold text-[var(--text-primary)]">
                {currentPage.title}
              </div>
              <div className="mt-1 text-xs leading-relaxed text-[var(--text-muted)]">
                {currentPage.summary}
              </div>
            </div>

            <div className="divide-y divide-[var(--border-subtle)]">
              {currentPage.sections.map((section) => {
                const Icon = section.icon;
                return (
                  <section key={section.title} className="py-4 first:pt-0 last:pb-0">
                    <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)]">
                      <Icon size={14} className="text-[var(--accent-primary)]" />
                      {section.title}
                    </div>
                    <ul className="list-disc space-y-1.5 pl-5 text-[var(--text-secondary)]">
                      {section.items.map((item, index) => (
                        <li key={index}>{item}</li>
                      ))}
                    </ul>
                  </section>
                );
              })}
            </div>
          </div>

          <div className="flex justify-end border-t border-[var(--border-subtle)] bg-[color:color-mix(in_srgb,var(--accent-primary)_6%,transparent)] px-6 py-4">
            <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={onClose}
                className="button-ghost inline-flex min-h-10 w-full items-center justify-center gap-2 border border-[var(--border-default)] px-4 text-sm font-semibold sm:w-auto"
              >
                跳过提示
              </button>
              {currentPageIndex > 0 && (
                <button
                  type="button"
                  onClick={goToPreviousPage}
                  className="button-ghost inline-flex min-h-10 w-full items-center justify-center gap-2 border border-[var(--border-default)] px-4 text-sm font-semibold sm:w-auto"
                >
                  上一页
                </button>
              )}
              <button
                type="button"
                onClick={goToNextPageOrClose}
                className="button-primary inline-flex min-h-10 w-full items-center justify-center gap-2 px-5 text-sm font-semibold sm:w-auto sm:shrink-0"
              >
                {nextPage ? `下一页：${nextPage.title}` : content.actionLabel}
              </button>
            </div>
          </div>
        </motion.div>
      </div>
    </>
  );

  if (typeof document === 'undefined') {
    return modalContent;
  }

  return createPortal(modalContent, document.body);
});

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
    <strong className="mx-0.5 inline-flex items-center rounded-[4px] bg-[color:color-mix(in_srgb,var(--semantic-warning)_18%,var(--bg-surface))] px-1.5 py-[1px] align-baseline font-extrabold leading-5 text-[var(--text-primary)] shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--semantic-warning)_42%,transparent)]">
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
      items: [
        '活跃、能量、抽卡这几步大多由系统自动处理；正常情况下确认当前手牌和能量状态即可。',
      ],
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
          <RuleTerm>能量区</RuleTerm>
          上方的“全活”“全待”可以一次处理全部能量，适合活跃阶段、支付费用后快速整理局面。
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
  '部分卡还没有实现效果自动化；按卡文处理后，可以用自由移动、免费登场或区域操作把结果人工补齐。',
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
        '进入对局后可在左上角请求重开或离开房间；重开需要对手同意后才会创建新对局。',
      ],
    });
  }

  return {
    title: mode === 'online' ? '效果和协作' : '效果和模拟',
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
