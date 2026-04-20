import { memo, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';
import { BookOpen, Phone, Swords, X } from 'lucide-react';

interface PreMatchBriefingModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const PreMatchBriefingModal = memo(function PreMatchBriefingModal({
  isOpen,
  onClose,
}: PreMatchBriefingModalProps) {
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

  if (!isOpen) return null;

  const modalContent = (
    <>
      <div className="modal-backdrop z-[190]" />

      <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
        <motion.div
          className="modal-surface modal-accent-indigo flex w-[min(92vw,720px)] max-h-[88vh] flex-col overflow-hidden"
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
                <div className="text-base font-semibold text-[var(--text-primary)]">玩前须知</div>
                <div className="text-xs text-[var(--text-secondary)]">
                  先过一眼基本操作和推荐玩法，再愉快开局
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
            <section>
              <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)]">
                <Phone size={14} className="text-[var(--accent-primary)]" />
                推荐玩法
              </div>
              <ul className="list-disc space-y-1.5 pl-5 text-[var(--text-secondary)]">
                <li>
                  推荐双方在游玩时开一个 QQ 或微信语音通话，部分效果需要口头告知对方才能顺畅进行
                  （例如效果发动时机、是否选择接受、手动判定成功/失败等）。
                </li>
                <li>
                  本系统沿用&ldquo;信任玩家&rdquo;原则：系统只负责规则处理，具体卡牌效果由玩家自己执行；
                  遇到需要沟通的情况，语音协商优于反复点按。
                </li>
              </ul>
            </section>

            <section className="mt-5">
              <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)]">
                <Swords size={14} className="text-[var(--accent-primary)]" />
                基本操作
              </div>
              <ul className="list-disc space-y-1.5 pl-5 text-[var(--text-secondary)]">
                <li>
                  <span className="font-medium text-[var(--text-primary)]">双击成员卡</span>
                  ：在正常状态和待机状态之间切换；在主要阶段和表演阶段，即使不是自己的回合，
                  也可以双击自己的成员卡让它进入待机状态。
                </li>
                <li>
                  <span className="font-medium text-[var(--text-primary)]">查看休息区</span>
                  ：可以点击自己和对方的休息区查看其中的卡牌详情，了解对手已经用过哪些卡。
                </li>
                <li>
                  <span className="font-medium text-[var(--text-primary)]">休息区拖出</span>
                  ：在主要阶段或效果发动阶段，可以直接把休息区里的卡拖到需要的区域，
                  系统不会自动裁判——按你触发的卡牌文本判断是否合法即可。
                </li>
                <li>
                  <span className="font-medium text-[var(--text-primary)]">卡牌 hover</span>
                  ：把鼠标悬停在任意一张正面卡上可以看到放大详情、心数和分数；
                  拖拽时会临时关闭悬浮以免遮挡。
                </li>
                <li>
                  <span className="font-medium text-[var(--text-primary)]">阶段推进</span>
                  ：右下角按钮会根据当前阶段切换成&ldquo;结束主要阶段&rdquo;、&ldquo;Live Start!&rdquo;、
                  &ldquo;Live 判定&rdquo;等文案，点它进入下一步。
                </li>
                <li>
                  <span className="font-medium text-[var(--text-primary)]">检视/置顶/置底</span>
                  ：涉及检视卡组的效果会弹出检视面板，在面板里选择送往公开区/置顶/置底，完成后点确认提交。
                </li>
                <li>
                  <span className="font-medium text-[var(--text-primary)]">Live 分数确认</span>
                  ：Live 结算阶段两人都要在弹窗里确认自己的分数，才会进入下一回合。
                </li>
              </ul>
            </section>

            <section className="mt-5">
              <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)]">
                <BookOpen size={14} className="text-[var(--accent-primary)]" />
                小提示
              </div>
              <ul className="list-disc space-y-1.5 pl-5 text-[var(--text-secondary)]">
                <li>
                  遇到画面状态异常时，可以尝试刷新页面；房间会根据你的用户身份自动恢复到对局现场。
                </li>
                <li>
                  如果对局出现争议，直接语音沟通确认后再继续操作；本系统不会强制阻断你对己方区域的合法操作。
                </li>
              </ul>
            </section>
          </div>

          <div className="flex items-center justify-between gap-3 border-t border-[var(--border-subtle)] bg-[color:color-mix(in_srgb,var(--accent-primary)_6%,transparent)] px-6 py-4">
            <div className="text-xs text-[var(--text-secondary)]">
              提示：关闭后即可开始对局，本提示每次进入对局都会出现。
            </div>
            <button
              type="button"
              onClick={onClose}
              className="button-primary inline-flex min-h-10 items-center justify-center gap-2 px-5 text-sm font-semibold"
            >
              我知道了，开始对局
            </button>
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
