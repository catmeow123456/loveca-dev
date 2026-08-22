import { memo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';
import { BookOpen, Clock3, X } from 'lucide-react';
import { useDialogAccessibility } from '@/hooks/useDialogAccessibility';
import {
  buildRankedSeasonDisconnectNotice,
  DEFAULT_BATTLE_TIMEOUT_CONFIG,
  RANKED_RATING_ALGORITHM_NOTICE,
  type BattleTimeoutConfig,
} from '@game/online/ranked-policy';

interface RankedSeasonNoticeDialogProps {
  readonly isOpen: boolean;
  readonly seasonName?: string | null;
  readonly announcement?: string | null;
  readonly leaderboardMatchCount?: number | null;
  readonly battleTimeouts?: BattleTimeoutConfig;
  readonly onClose: () => void;
}

export const RankedSeasonNoticeDialog = memo(function RankedSeasonNoticeDialog({
  isOpen,
  seasonName,
  announcement,
  leaderboardMatchCount,
  battleTimeouts = DEFAULT_BATTLE_TIMEOUT_CONFIG,
  onClose,
}: RankedSeasonNoticeDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  useDialogAccessibility({
    isOpen,
    dialogRef,
    initialFocusRef: closeButtonRef,
    onEscape: onClose,
  });

  if (!isOpen) {
    return null;
  }

  const disconnectNotice = buildRankedSeasonDisconnectNotice(battleTimeouts);

  const dialog = (
    <>
      <button
        type="button"
        tabIndex={-1}
        aria-label="关闭赛季公告"
        className="modal-backdrop z-[210] cursor-default"
        onClick={onClose}
      />

      <div className="fixed inset-0 z-[220] flex items-center justify-center p-4">
        <motion.div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="ranked-season-notice-title"
          tabIndex={-1}
          className="modal-surface modal-accent-indigo flex max-h-[88vh] w-[min(94vw,620px)] flex-col overflow-hidden"
          initial={{ opacity: 0, scale: 0.96, y: 12 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.96, y: 12 }}
        >
          <div className="modal-header flex items-start justify-between gap-3 px-5 py-4 sm:px-6">
            <div className="flex min-w-0 items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-[color:color-mix(in_srgb,var(--accent-primary)_34%,var(--border-default))] bg-[color:color-mix(in_srgb,var(--accent-primary)_12%,var(--bg-surface))] text-[var(--accent-primary)]">
                <BookOpen size={18} />
              </div>
              <div className="min-w-0">
                <h2
                  id="ranked-season-notice-title"
                  className="text-base font-bold text-[var(--text-primary)]"
                >
                  赛季公告
                </h2>
                <p className="mt-0.5 truncate text-xs text-[var(--text-secondary)]">
                  {seasonName ?? '当前赛季'} · 赛季说明、积分、排行榜与断线规则
                </p>
              </div>
            </div>
            <button
              ref={closeButtonRef}
              type="button"
              onClick={onClose}
              className="button-icon h-8 w-8 shrink-0"
              title="关闭"
              aria-label="关闭赛季公告"
            >
              <X size={14} />
            </button>
          </div>

          <div className="cute-scrollbar flex-1 overflow-y-auto px-5 py-5 sm:px-6">
            {announcement?.trim() ? (
              <section className="mb-4 rounded-xl border border-[var(--border-default)] bg-[var(--bg-overlay)] p-4">
                <div className="text-xs font-semibold text-[var(--text-muted)]">赛季说明</div>
                <p className="mt-1.5 whitespace-pre-wrap break-words text-sm leading-6 text-[var(--text-secondary)]">
                  {announcement.trim()}
                </p>
              </section>
            ) : null}
            <div className="grid gap-3 sm:grid-cols-2">
              <section className="rounded-xl border border-[color:color-mix(in_srgb,var(--accent-primary)_30%,var(--border-default))] bg-[color:color-mix(in_srgb,var(--accent-primary)_7%,var(--bg-surface))] p-4">
                <div className="text-xs font-semibold text-[var(--text-muted)]">积分算法</div>
                <div className="mt-1 text-xl font-black tracking-tight text-[var(--text-primary)]">
                  {RANKED_RATING_ALGORITHM_NOTICE.name}
                </div>
                <p className="mt-1 text-xs leading-5 text-[var(--text-secondary)]">
                  {RANKED_RATING_ALGORITHM_NOTICE.summary}
                </p>
              </section>

              <section className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-overlay)] p-4">
                <div className="text-xs font-semibold text-[var(--text-muted)]">排行榜资格</div>
                <div className="mt-1 text-xl font-black tracking-tight text-[var(--text-primary)]">
                  {leaderboardMatchCount ? `${leaderboardMatchCount} 场` : '以赛季配置为准'}
                </div>
                <p className="mt-1 text-xs leading-5 text-[var(--text-secondary)]">
                  {leaderboardMatchCount
                    ? `排位可直接参加；完成 ${leaderboardMatchCount} 场计分对局后显示排名。`
                    : '排位可直接参加；达到当前赛季场次门槛后显示排名。'}
                </p>
              </section>
            </div>

            <section className="mt-4 border-t border-[var(--border-subtle)] pt-4">
              <div className="flex items-center gap-2 text-sm font-bold text-[var(--text-primary)]">
                <Clock3 size={15} className="text-[var(--accent-primary)]" />
                {disconnectNotice.title}
              </div>
              <p className="mt-1.5 text-sm leading-6 text-[var(--text-secondary)]">
                {disconnectNotice.summary}
              </p>
            </section>
          </div>

          <div className="flex justify-end border-t border-[var(--border-subtle)] bg-[var(--bg-surface)] px-5 py-4 sm:px-6">
            <button
              type="button"
              onClick={onClose}
              className="button-primary inline-flex min-h-10 items-center justify-center px-5 text-sm font-semibold"
            >
              我知道了
            </button>
          </div>
        </motion.div>
      </div>
    </>
  );

  if (typeof document === 'undefined') {
    return dialog;
  }

  return createPortal(dialog, document.body);
});

export default RankedSeasonNoticeDialog;
