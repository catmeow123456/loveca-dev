import { memo, useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { CheckCircle2, ShieldCheck } from 'lucide-react';
import { useGameStore } from '@/store/gameStore';
import { GameMode, GamePhase, SubPhase } from '@game/shared/types/enums';

export const ScoreConfirmModal = memo(function ScoreConfirmModal() {
  const currentPhase = useGameStore((s) => s.getCurrentPhaseView());
  const currentSubPhase = useGameStore((s) => s.getCurrentSubPhaseView());
  const permissionView = useGameStore((s) => s.getPermissionView());
  const selfPlayer = useGameStore((s) => s.getViewingPlayerState());
  const opponentPlayer = useGameStore((s) => s.getOpponentPlayerState());
  const confirmedScoreCount = useGameStore((s) => s.getConfirmedScoreCount());
  const gameMode = useGameStore((s) => s.gameMode);
  const confirmScore = useGameStore((s) => s.confirmScore);
  const selfPlayerId = selfPlayer?.id ?? null;
  const opponentPlayerId = opponentPlayer?.id ?? null;
  const selfScore = useGameStore((s) => (selfPlayerId ? s.getLiveScoreForPlayer(selfPlayerId) : 0));
  const opponentScore = useGameStore((s) =>
    opponentPlayerId ? s.getLiveScoreForPlayer(opponentPlayerId) : 0
  );
  const selfConfirmed = useGameStore((s) =>
    selfPlayerId ? s.isScoreConfirmed(selfPlayerId) : false
  );
  const opponentConfirmed = useGameStore((s) =>
    opponentPlayerId ? s.isScoreConfirmed(opponentPlayerId) : false
  );

  const shouldShow = useMemo(() => {
    return (
      currentPhase === GamePhase.LIVE_RESULT_PHASE &&
      currentSubPhase === SubPhase.RESULT_SETTLEMENT &&
      confirmedScoreCount < 2
    );
  }, [confirmedScoreCount, currentPhase, currentSubPhase]);

  const [adjustedScore, setAdjustedScore] = useState(0);

  useEffect(() => {
    if (!shouldShow) return;
    setAdjustedScore(selfScore);
  }, [shouldShow, selfScore]);

  if (!shouldShow || !selfPlayer || !opponentPlayer) return null;

  const isDebugMode = gameMode === GameMode.DEBUG;
  const canAct = permissionView?.canAct ?? true;
  const canConfirm = canAct && !selfConfirmed;

  return (
    <AnimatePresence>
      <motion.div
        className={`fixed inset-0 z-[110] flex items-center justify-center ${
          isDebugMode
            ? 'pointer-events-none bg-black/20 backdrop-blur-[1px]'
            : 'modal-backdrop'
        }`}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
      >
        <motion.div
          className="modal-surface modal-accent-emerald pointer-events-auto w-[min(92vw,640px)] p-5"
          initial={{ y: 16, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 12, opacity: 0 }}
        >
          <div className="mb-4 text-center">
            <div className="inline-flex items-center gap-2 text-sm font-semibold text-[var(--semantic-success)]">
              <ShieldCheck size={16} />
              Live 分数最终确认
            </div>
            <div className="mt-1 text-xs text-[var(--text-secondary)]">双方都确认后将自动判定胜负并进入下一回合</div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-lg border border-[color:color-mix(in_srgb,var(--semantic-success)_35%,transparent)] bg-[color:color-mix(in_srgb,var(--semantic-success)_12%,transparent)] p-3">
              <div className="text-xs text-[var(--semantic-success)]">己方玩家分数</div>
              <div className="mt-1 text-2xl font-bold text-[var(--text-primary)]">{selfScore}</div>
              <div className="mt-1 text-[11px] text-[var(--text-secondary)]">{selfConfirmed ? '已确认' : '待确认'}</div>
            </div>
            <div className="rounded-lg border border-[color:color-mix(in_srgb,var(--accent-primary)_35%,transparent)] bg-[color:color-mix(in_srgb,var(--accent-primary)_12%,transparent)] p-3">
              <div className="text-xs text-[var(--accent-primary)]">对手方玩家分数</div>
              <div className="mt-1 text-2xl font-bold text-[var(--text-primary)]">{opponentScore}</div>
              <div className="mt-1 text-[11px] text-[var(--text-secondary)]">
                {opponentConfirmed ? '已确认' : '待确认'}
              </div>
            </div>
          </div>

          <div className="mt-4 flex items-center gap-2">
            <span className="whitespace-nowrap text-xs text-[var(--text-secondary)]">调整己方分数</span>
            <input
              type="number"
              min={0}
              value={adjustedScore}
              onChange={(e) =>
                setAdjustedScore(Math.max(0, Number.parseInt(e.target.value || '0', 10) || 0))
              }
              disabled={!canConfirm}
              className="input-field w-full px-2 py-1.5 text-sm disabled:opacity-50"
            />
          </div>

          <button
            type="button"
            onClick={() => confirmScore(adjustedScore)}
            disabled={!canConfirm}
            className={
              !canConfirm
                ? 'mt-4 w-full cursor-not-allowed rounded-lg bg-[var(--bg-overlay)] py-2 text-sm font-semibold text-[var(--text-muted)]'
                : 'button-primary mt-4 flex w-full items-center justify-center gap-2 py-2 text-sm font-semibold'
            }
          >
            {!canAct
              ? '等待对手操作'
              : selfConfirmed
                ? '已确认我的分数'
                : <><CheckCircle2 size={16} />确认我的分数</>}
          </button>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
});

export default ScoreConfirmModal;
