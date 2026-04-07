/**
 * 分数确认面板 (Modal)
 * 显示双方 Live 分数对比，允许用户调整最终分数
 * 
 * 核心设计：信任用户手动操作
 */

import { memo, useState, useCallback, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useShallow } from 'zustand/react/shallow';
import { cn } from '@/lib/utils';
import { SubPhase, GameMode } from '@game/shared/types/enums';
import { useGameStore } from '@/store/gameStore';

interface ScorePanelProps {
  /** 是否显示 */
  isOpen: boolean;
  /** 关闭回调 */
  onClose: () => void;
}

/**
 * 玩家分数卡片组件
 */
const PlayerScoreCard = memo(function PlayerScoreCard({
  playerName,
  baseScore,
  bonusScore,
  adjustedScore,
  isWinner,
  canEdit,
  onScoreChange,
}: {
  playerName: string;
  baseScore: number;
  bonusScore: number;
  adjustedScore: number;
  isWinner: boolean;
  canEdit: boolean;
  onScoreChange?: (score: number) => void;
}) {
  const totalScore = adjustedScore;

  return (
    <div
      className={cn(
        'flex-1 p-4 rounded-lg border',
        isWinner
          ? 'bg-emerald-500/10 border-emerald-500/50'
          : 'bg-slate-800/50 border-slate-700/50'
      )}
    >
      <div className="text-center">
        <div className="text-sm text-slate-400 mb-1">{playerName}</div>
        
        {/* 分数显示 */}
        <div className="text-3xl font-bold text-white mb-2">
          {canEdit ? (
            <input
              type="number"
              value={adjustedScore}
              onChange={(e) => onScoreChange?.(parseInt(e.target.value) || 0)}
              className="w-20 text-center bg-slate-700 rounded border border-slate-600 focus:border-pink-500 focus:outline-none"
            />
          ) : (
            totalScore
          )}
        </div>

        {/* 胜利标记 */}
        {isWinner && (
          <div className="mt-1 text-emerald-400 font-bold text-xs">
            🏆 胜
          </div>
        )}
      </div>
    </div>
  );
});

/**
 * 胜者选择组件（简化版 - 四选项一行）
 */
const WinnerSelection = memo(function WinnerSelection({
  player1Name,
  player2Name,
  winner,
  onWinnerChange,
}: {
  player1Name: string;
  player2Name: string;
  winner: 'player1' | 'player2' | 'both' | 'none';
  onWinnerChange: (winner: 'player1' | 'player2' | 'both' | 'none') => void;
}) {
  return (
    <div className="mt-3 flex gap-2">
      <button
        onClick={() => onWinnerChange('player1')}
        className={cn(
          'flex-1 py-1.5 px-2 rounded text-xs font-medium transition-all truncate',
          winner === 'player1'
            ? 'bg-emerald-500 text-white'
            : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
        )}
      >
        {player1Name}胜
      </button>
      <button
        onClick={() => onWinnerChange('player2')}
        className={cn(
          'flex-1 py-1.5 px-2 rounded text-xs font-medium transition-all truncate',
          winner === 'player2'
            ? 'bg-emerald-500 text-white'
            : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
        )}
      >
        {player2Name}胜
      </button>
      <button
        onClick={() => onWinnerChange('both')}
        className={cn(
          'flex-1 py-1.5 px-2 rounded text-xs font-medium transition-all',
          winner === 'both'
            ? 'bg-amber-500 text-white'
            : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
        )}
      >
        双胜
      </button>
      <button
        onClick={() => onWinnerChange('none')}
        className={cn(
          'flex-1 py-1.5 px-2 rounded text-xs font-medium transition-all',
          winner === 'none'
            ? 'bg-slate-500 text-white'
            : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
        )}
      >
        无
      </button>
    </div>
  );
});

export const ScorePanel = memo(function ScorePanel({
  isOpen,
  onClose,
}: ScorePanelProps) {
  // 状态选择器
  const currentSubPhase = useGameStore((s) => s.getCurrentSubPhaseView());
  const permissionView = useGameStore((s) => s.getPermissionView());
  const viewingPlayer = useGameStore((s) => s.getViewingPlayerState());
  const firstPlayer = useGameStore((s) => s.getFirstPlayerState());
  const secondPlayer = useGameStore((s) => s.getSecondPlayerState());
  const viewingPlayerId = useGameStore((s) => s.viewingPlayerId);
  const gameMode = useGameStore((s) => s.gameMode);

  // 方法选择器（使用 useShallow 保持引用稳定）
  const { confirmScore, confirmSubPhase } = useGameStore(
    useShallow((s) => ({
      confirmScore: s.confirmScore,
      confirmSubPhase: s.confirmSubPhase,
    }))
  );

  // 获取双方玩家
  const [player1, player2] = useMemo(() => {
    return [firstPlayer, secondPlayer];
  }, [firstPlayer, secondPlayer]);
  const player1Id = player1?.id ?? null;
  const player2Id = player2?.id ?? null;
  const player1BaseScore = useGameStore((s) => (player1Id ? s.getLiveScoreForPlayer(player1Id) : 0));
  const player2BaseScore = useGameStore((s) => (player2Id ? s.getLiveScoreForPlayer(player2Id) : 0));
  const player1Won = useGameStore((s) => (player1Id ? s.isLiveWinner(player1Id) : false));
  const player2Won = useGameStore((s) => (player2Id ? s.isLiveWinner(player2Id) : false));
  const isDraw = useGameStore((s) => s.isLiveDraw());

  // 计算基础分数
  const calculateBaseScore = useCallback(
    (playerId: string): number => {
      if (playerId === player1Id) {
        return player1BaseScore;
      }
      if (playerId === player2Id) {
        return player2BaseScore;
      }
      return 0;
    },
    [player1BaseScore, player1Id, player2BaseScore, player2Id]
  );

  // 计算应援加分（音符+1效果）
  const calculateBonusScore = useCallback(
    (_playerId: string): number => {
      // TODO: 从联机结算 selector 中补齐应援加分
      // 目前简化为0
      return 0;
    },
    []
  );

  // 分数状态
  const [player1Score, setPlayer1Score] = useState(0);
  const [player2Score, setPlayer2Score] = useState(0);
  const [winner, setWinner] = useState<'player1' | 'player2' | 'both' | 'none'>('none');

  // 初始化分数
  useEffect(() => {
    if (player1 && player2 && isOpen) {
      const base1 = calculateBaseScore(player1.id);
      const bonus1 = calculateBonusScore(player1.id);
      const base2 = calculateBaseScore(player2.id);
      const bonus2 = calculateBonusScore(player2.id);

      const total1 = base1 + bonus1;
      const total2 = base2 + bonus2;

      setPlayer1Score(total1);
      setPlayer2Score(total2);

      // 自动判断胜者
      if (isDraw) {
        setWinner('both');
      } else if (player1Won) {
        setWinner('player1');
      } else if (player2Won) {
        setWinner('player2');
      } else if (total1 > total2) {
        setWinner('player1');
      } else if (total2 > total1) {
        setWinner('player2');
      } else {
        setWinner('none');
      }
    }
  }, [player1, player2, isOpen, calculateBaseScore, calculateBonusScore, isDraw, player1Won, player2Won]);

  // 确认分数
  const handleConfirm = useCallback(() => {
    const myScore = viewingPlayerId === player1?.id ? player1Score : player2Score;
    confirmScore(myScore);
    confirmSubPhase(SubPhase.RESULT_SETTLEMENT);
    onClose();
  }, [confirmScore, confirmSubPhase, onClose, viewingPlayerId, player1, player2, player1Score, player2Score]);

  // ESC 键关闭
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    if (isOpen) {
      window.addEventListener('keydown', handleKeyDown);
      return () => window.removeEventListener('keydown', handleKeyDown);
    }
  }, [isOpen, onClose]);

  // 检查是否应该显示
  const shouldShow =
    isOpen && currentSubPhase === SubPhase.RESULT_SETTLEMENT;

  if (!shouldShow || !player1 || !player2) return null;

  const isMyTurn = permissionView?.canAct ?? (viewingPlayerId === player1.id || viewingPlayerId === player2.id);
  const isSolitaire = gameMode === GameMode.SOLITAIRE;

  // 对墙打模式：确定己方玩家
  const selfPlayer = isSolitaire
    ? (viewingPlayer?.id === player1.id ? player1 : player2)
    : null;
  const selfScore = selfPlayer
    ? viewingPlayerId === player1.id
      ? player1Score
      : player2Score
    : 0;
  const selfWinner = isSolitaire && (winner === 'player1' || winner === 'both')
    ? viewingPlayerId === player1.id
    : isSolitaire && (winner === 'player2' || winner === 'both')
    ? viewingPlayerId === player2.id
    : false;

  return (
    <AnimatePresence>
      {shouldShow && (
        <>
          {/* 背景遮罩 */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 z-[100]"
            onClick={onClose}
          />

          {/* 弹窗内容 */}
          <motion.div
            initial={{ opacity: 0, scale: 0.9, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 20 }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-[101] w-full max-w-md"
          >
            <div className={cn(
              'rounded-xl border shadow-2xl overflow-hidden',
              isSolitaire
                ? 'bg-purple-950 border-purple-700'
                : 'bg-slate-900 border-slate-700'
            )}>
              {/* 标题栏 */}
              <div className={cn(
                'px-6 py-4 border-b',
                isSolitaire
                  ? 'border-purple-700 bg-purple-500/10'
                  : 'border-slate-700 bg-rose-500/10'
              )}>
                <div className="flex items-center gap-3">
                  <span className="text-2xl">{isSolitaire ? '🎯' : '🧮'}</span>
                  <h2 className="text-lg font-bold text-white">
                    {isSolitaire ? 'Live 判定结果' : 'Live 分数确认'}
                  </h2>
                </div>
              </div>

              {/* 内容区域 */}
              <div className="px-6 py-4">
                {isSolitaire && selfPlayer ? (
                  /* ===== 对墙打模式简化版 ===== */
                  <div>
                    {/* 己方分数（居中显示） */}
                    <div className="flex justify-center">
                      <div className={cn(
                        'w-48 p-5 rounded-lg border text-center',
                        selfWinner
                          ? 'bg-emerald-500/10 border-emerald-500/50'
                          : 'bg-slate-800/50 border-slate-700/50'
                      )}>
                        <div className="text-sm text-slate-400 mb-1">{selfPlayer.name}</div>
                        <div className="text-4xl font-bold text-white mb-2">
                          <input
                            type="number"
                            value={selfScore}
                            onChange={(e) => {
                              const val = parseInt(e.target.value) || 0;
                              if (viewingPlayerId === player1.id) setPlayer1Score(val);
                              else setPlayer2Score(val);
                            }}
                            className="w-24 text-center bg-slate-700 rounded border border-slate-600 focus:border-purple-500 focus:outline-none"
                          />
                        </div>
                        {selfWinner && (
                          <div className="text-emerald-400 font-bold text-sm">
                            🏆 自动胜出
                          </div>
                        )}
                      </div>
                    </div>

                    {/* 提示 */}
                    <div className="mt-4 p-3 bg-purple-500/10 rounded-lg border border-purple-500/30">
                      <div className="text-xs text-purple-300">
                        💡 分数可手动调整（因卡牌效果可能影响分数）。有成功 Live 卡则自动判定胜出。
                      </div>
                    </div>
                  </div>
                ) : (
                  /* ===== 调试模式完整版 ===== */
                  <div>
                    {/* 分数对比 */}
                    <div className="flex gap-4">
                      <PlayerScoreCard
                        playerName={player1.name}
                        baseScore={calculateBaseScore(player1.id)}
                        bonusScore={calculateBonusScore(player1.id)}
                        adjustedScore={player1Score}
                        isWinner={winner === 'player1' || winner === 'both'}
                        canEdit={isMyTurn && viewingPlayerId === player1.id}
                        onScoreChange={setPlayer1Score}
                      />
                      <div className="flex items-center text-2xl font-bold text-slate-500">
                        VS
                      </div>
                      <PlayerScoreCard
                        playerName={player2.name}
                        baseScore={calculateBaseScore(player2.id)}
                        bonusScore={calculateBonusScore(player2.id)}
                        adjustedScore={player2Score}
                        isWinner={winner === 'player2' || winner === 'both'}
                        canEdit={isMyTurn && viewingPlayerId === player2.id}
                        onScoreChange={setPlayer2Score}
                      />
                    </div>

                    {/* 胜者选择 */}
                    <WinnerSelection
                      player1Name={player1.name}
                      player2Name={player2.name}
                      winner={winner}
                      onWinnerChange={setWinner}
                    />

                    {/* 提示 */}
                    <div className="mt-4 p-3 bg-amber-500/10 rounded-lg border border-amber-500/30">
                      <div className="text-xs text-amber-400">
                        💡 分数可手动调整（因卡牌效果可能影响分数）
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* 按钮区域 */}
              <div className="px-6 py-4 bg-slate-800/50 border-t border-slate-700 flex gap-3">
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={onClose}
                  className="flex-1 py-2.5 rounded-lg text-sm font-medium bg-slate-700 hover:bg-slate-600 text-slate-300 transition-colors"
                >
                  取消
                </motion.button>
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={handleConfirm}
                  disabled={!isMyTurn}
                  className={cn(
                    'flex-1 py-2.5 rounded-lg text-sm font-bold',
                    isMyTurn
                      ? [
                          'text-white shadow-lg transition-colors',
                          isSolitaire
                            ? 'bg-gradient-to-r from-purple-500 to-violet-500 hover:from-purple-400 hover:to-violet-400'
                            : 'bg-gradient-to-r from-rose-500 to-pink-500 hover:from-rose-400 hover:to-pink-400',
                        ]
                      : 'bg-slate-700 text-slate-500 cursor-not-allowed'
                  )}
                >
                  ✅ 确认分数
                </motion.button>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
});

export default ScorePanel;
