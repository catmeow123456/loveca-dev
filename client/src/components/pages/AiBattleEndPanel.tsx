import { Bot, LoaderCircle, RotateCcw, Trophy } from 'lucide-react';
import type { MatchEndView, Seat } from '@game/online';
import { GameEndReason } from '@game/shared/types/enums';

interface AiBattleEndPanelProps {
  readonly endInfo: MatchEndView;
  readonly viewerSeat: Seat;
  readonly isRestarting: boolean;
  readonly isReturning: boolean;
  readonly error: string | null;
  readonly onRestart: () => void;
  readonly onReturn: () => void;
}

export function AiBattleEndPanel({
  endInfo,
  viewerSeat,
  isRestarting,
  isReturning,
  error,
  onRestart,
  onReturn,
}: AiBattleEndPanelProps) {
  const copy = getAiBattleEndCopy(endInfo, viewerSeat);
  const isBusy = isRestarting || isReturning;

  return (
    <div className="modal-backdrop fixed inset-0 z-[140] flex items-center justify-center px-4 py-6">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="ai-battle-end-title"
        className="w-full max-w-md overflow-hidden rounded-2xl border border-[var(--border-default)] bg-[var(--bg-frosted)] shadow-[var(--shadow-xl)] backdrop-blur-xl"
      >
        <div className="border-b border-[var(--border-subtle)] px-5 py-5 sm:px-6">
          <div className="flex items-center gap-2 text-xs font-bold tracking-[0.14em] text-[var(--accent-primary)]">
            <Bot size={15} />
            LOVECA AI · 对局结果
          </div>
          <div className="mt-4 flex items-start gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-[color:color-mix(in_srgb,var(--accent-primary)_38%,var(--border-default))] bg-[color:color-mix(in_srgb,var(--accent-primary)_12%,var(--bg-surface))] text-[var(--accent-primary)]">
              <Trophy size={22} />
            </div>
            <div className="min-w-0">
              <h2
                id="ai-battle-end-title"
                className="text-xl font-black tracking-tight text-[var(--text-primary)]"
              >
                {copy.title}
              </h2>
              <p className="mt-1.5 text-sm leading-6 text-[var(--text-secondary)]">{copy.detail}</p>
            </div>
          </div>
        </div>

        <div className="px-5 py-4 sm:px-6">
          {error && (
            <div
              role="alert"
              className="mb-3 rounded-lg border border-[color:color-mix(in_srgb,var(--semantic-error)_35%,var(--border-default))] bg-[color:color-mix(in_srgb,var(--semantic-error)_8%,var(--bg-surface))] px-3 py-2 text-xs leading-5 text-[var(--semantic-error)]"
            >
              {error}
            </div>
          )}
          <div className="grid gap-2 sm:grid-cols-2">
            <button
              type="button"
              onClick={onReturn}
              disabled={isBusy}
              className="button-ghost inline-flex min-h-11 items-center justify-center border border-[var(--border-default)] px-4 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-55"
            >
              {isReturning && <LoaderCircle size={16} className="mr-2 animate-spin" />}
              返回 AI 对战
            </button>
            <button
              type="button"
              onClick={onRestart}
              disabled={isBusy}
              className="button-primary inline-flex min-h-11 items-center justify-center px-4 text-sm font-bold disabled:cursor-not-allowed disabled:opacity-55"
            >
              {isRestarting ? (
                <LoaderCircle size={16} className="mr-2 animate-spin" />
              ) : (
                <RotateCcw size={16} className="mr-2" />
              )}
              同配置再来一局
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}

export function getAiBattleEndCopy(
  endInfo: MatchEndView,
  viewerSeat: Seat
): { readonly title: string; readonly detail: string } {
  if (endInfo.winnerSeat === viewerSeat) {
    if (endInfo.reason === GameEndReason.SYSTEM_LIVENESS_CONCEDE) {
      return {
        title: '本局获胜',
        detail: 'AI 长时间无法让牌局继续推进，已按活性保护规则认输。',
      };
    }
    if (endInfo.reason === GameEndReason.SYSTEM_MACHINE_FAILURE) {
      return {
        title: '本局获胜',
        detail: 'AI 遇到无法恢复的操作异常，本局已安全结束。',
      };
    }
    return { title: '本局获胜', detail: '你已达成胜利条件。' };
  }
  if (endInfo.loserSeat === viewerSeat) {
    return { title: '本局结束', detail: 'Loveca AI 已达成胜利条件。' };
  }
  return { title: '本局结束', detail: '双方在同一结算时点达成了平局。' };
}
