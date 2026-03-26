import { memo, useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useGameStore } from '@/store/gameStore';
import { GameMode, GamePhase, SubPhase } from '@game/shared/types/enums';

export const ScoreConfirmModal = memo(function ScoreConfirmModal() {
  const gameState = useGameStore((s) => s.gameState);
  const viewingPlayerId = useGameStore((s) => s.viewingPlayerId);
  const gameMode = useGameStore((s) => s.gameMode);
  const confirmScore = useGameStore((s) => s.confirmScore);

  const shouldShow = useMemo(() => {
    if (!gameState) return false;
    return (
      gameState.currentPhase === GamePhase.LIVE_RESULT_PHASE &&
      gameState.currentSubPhase === SubPhase.RESULT_SETTLEMENT &&
      gameState.liveResolution.scoreConfirmedBy.length < 2
    );
  }, [gameState]);

  const selfPlayer = useMemo(() => {
    if (!gameState || !viewingPlayerId) return null;
    return gameState.players.find((p) => p.id === viewingPlayerId) ?? null;
  }, [gameState, viewingPlayerId]);

  const opponentPlayer = useMemo(() => {
    if (!gameState || !viewingPlayerId) return null;
    return gameState.players.find((p) => p.id !== viewingPlayerId) ?? null;
  }, [gameState, viewingPlayerId]);

  const selfScore = selfPlayer ? gameState?.liveResolution.playerScores.get(selfPlayer.id) ?? 0 : 0;
  const opponentScore = opponentPlayer
    ? gameState?.liveResolution.playerScores.get(opponentPlayer.id) ?? 0
    : 0;

  const selfConfirmed = !!(
    selfPlayer && gameState?.liveResolution.scoreConfirmedBy.includes(selfPlayer.id)
  );
  const opponentConfirmed = !!(
    opponentPlayer && gameState?.liveResolution.scoreConfirmedBy.includes(opponentPlayer.id)
  );

  const [adjustedScore, setAdjustedScore] = useState(0);

  useEffect(() => {
    if (!shouldShow) return;
    setAdjustedScore(selfScore);
  }, [shouldShow, selfScore]);

  if (!shouldShow || !selfPlayer || !opponentPlayer) return null;

  const isDebugMode = gameMode === GameMode.DEBUG;

  return (
    <AnimatePresence>
      <motion.div
        className={`fixed inset-0 z-[110] flex items-center justify-center ${
          isDebugMode
            ? 'pointer-events-none bg-black/20 backdrop-blur-[1px]'
            : 'bg-black/45 backdrop-blur-[1px]'
        }`}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
      >
        <motion.div
          className="pointer-events-auto w-[min(92vw,640px)] rounded-xl border border-emerald-400/30 bg-slate-900/95 p-5 shadow-2xl"
          initial={{ y: 16, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 12, opacity: 0 }}
        >
          <div className="mb-4 text-center">
            <div className="text-sm font-semibold text-emerald-300">Live 分数最终确认</div>
            <div className="mt-1 text-xs text-slate-400">双方都确认后将自动判定胜负并进入下一回合</div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-lg border border-emerald-500/35 bg-emerald-900/20 p-3">
              <div className="text-xs text-emerald-300">己方玩家分数</div>
              <div className="mt-1 text-2xl font-bold text-white">{selfScore}</div>
              <div className="mt-1 text-[11px] text-slate-300">{selfConfirmed ? '已确认' : '待确认'}</div>
            </div>
            <div className="rounded-lg border border-rose-500/35 bg-rose-900/20 p-3">
              <div className="text-xs text-rose-300">对手方玩家分数</div>
              <div className="mt-1 text-2xl font-bold text-white">{opponentScore}</div>
              <div className="mt-1 text-[11px] text-slate-300">
                {opponentConfirmed ? '已确认' : '待确认'}
              </div>
            </div>
          </div>

          <div className="mt-4 flex items-center gap-2">
            <span className="text-xs text-slate-300 whitespace-nowrap">调整己方分数</span>
            <input
              type="number"
              min={0}
              value={adjustedScore}
              onChange={(e) =>
                setAdjustedScore(Math.max(0, Number.parseInt(e.target.value || '0', 10) || 0))
              }
              disabled={selfConfirmed}
              className="w-full rounded border border-slate-600 bg-slate-800 px-2 py-1.5 text-sm text-white focus:border-emerald-500 focus:outline-none disabled:opacity-50"
            />
          </div>

          <button
            type="button"
            onClick={() => confirmScore(adjustedScore)}
            disabled={selfConfirmed}
            className={
              selfConfirmed
                ? 'mt-4 w-full rounded-lg bg-slate-700 py-2 text-sm font-semibold text-slate-400 cursor-not-allowed'
                : 'mt-4 w-full rounded-lg bg-gradient-to-r from-emerald-600 to-green-500 py-2 text-sm font-semibold text-white hover:from-emerald-500 hover:to-green-400'
            }
          >
            {selfConfirmed ? '已确认我的分数' : '确认我的分数'}
          </button>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
});

export default ScoreConfirmModal;
