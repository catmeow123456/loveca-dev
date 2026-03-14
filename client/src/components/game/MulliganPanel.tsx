/**
 * 换牌面板 (Mulligan Panel)
 * 游戏开始时，玩家可选择要换的牌
 * 选中的牌洗入牌库，然后重新抽取相同数量的牌
 */

import { memo, useState, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useShallow } from 'zustand/react/shallow';
import { cn } from '@/lib/utils';
import { GamePhase, SubPhase } from '@game/shared/types/enums';
import { useGameStore } from '@/store/gameStore';
import { Card } from '@/components/card/Card';
import type { MemberCardData, AnyCardData } from '@game/domain/entities/card';

interface MulliganPanelProps {
  /** 是否显示 */
  isOpen: boolean;
}

export const MulliganPanel = memo(function MulliganPanel({ isOpen }: MulliganPanelProps) {
  // 状态选择器
  const gameState = useGameStore((s) => s.gameState);
  const viewingPlayerId = useGameStore((s) => s.viewingPlayerId);

  // 方法选择器（使用 useShallow 保持引用稳定）
  const { mulligan, getCardInstance, getCardImagePath } = useGameStore(
    useShallow((s) => ({
      mulligan: s.mulligan,
      getCardInstance: s.getCardInstance,
      getCardImagePath: s.getCardImagePath,
    }))
  );

  // 选中要换的卡牌 ID
  const [selectedCardIds, setSelectedCardIds] = useState<Set<string>>(new Set());

  // 获取当前玩家
  const currentPlayer = useMemo(() => {
    if (!gameState || !viewingPlayerId) return null;
    return gameState.players.find((p) => p.id === viewingPlayerId);
  }, [gameState, viewingPlayerId]);

  // 检查是否已完成换牌
  const hasCompletedMulligan = useMemo(() => {
    if (!gameState || !viewingPlayerId) return false;
    return gameState.mulliganCompletedPlayers.includes(viewingPlayerId);
  }, [gameState, viewingPlayerId]);

  // 检查当前是否轮到该玩家换牌
  const isMyMulliganTurn = useMemo(() => {
    if (!gameState || !viewingPlayerId) return false;

    const firstPlayerId = gameState.players[gameState.firstPlayerIndex].id;
    const secondPlayerId = gameState.players[gameState.firstPlayerIndex === 0 ? 1 : 0].id;

    // 先攻子阶段时，只有先攻玩家可以换牌
    if (gameState.currentSubPhase === SubPhase.MULLIGAN_FIRST_PLAYER) {
      return viewingPlayerId === firstPlayerId;
    }

    // 后攻子阶段时，只有后攻玩家可以换牌
    if (gameState.currentSubPhase === SubPhase.MULLIGAN_SECOND_PLAYER) {
      return viewingPlayerId === secondPlayerId;
    }

    return false;
  }, [gameState, viewingPlayerId]);

  // 切换卡牌选中状态
  const toggleCardSelection = useCallback((cardId: string) => {
    setSelectedCardIds((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(cardId)) {
        newSet.delete(cardId);
      } else {
        newSet.add(cardId);
      }
      return newSet;
    });
  }, []);

  // 确认换牌
  const handleConfirm = useCallback(() => {
    const cardIds = Array.from(selectedCardIds);
    mulligan(cardIds);
    setSelectedCardIds(new Set()); // 重置选择
  }, [mulligan, selectedCardIds]);

  // 不换牌（直接确认）
  const handleSkip = useCallback(() => {
    mulligan([]);
    setSelectedCardIds(new Set());
  }, [mulligan]);

  // 判断是否应该显示面板
  const shouldShow = useMemo(() => {
    if (!isOpen || !gameState) return false;
    if (gameState.currentPhase !== GamePhase.MULLIGAN_PHASE) return false;
    if (hasCompletedMulligan) return false;
    return true;
  }, [isOpen, gameState, hasCompletedMulligan]);

  if (!shouldShow || !currentPlayer || !gameState) return null;

  // 获取玩家名称用于显示
  const playerName = currentPlayer.name;
  const isFirstPlayer = currentPlayer.id === gameState.players[gameState.firstPlayerIndex].id;

  return (
    <AnimatePresence>
      {shouldShow && (
        <>
          {/* 背景遮罩 */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/70 z-[100]"
          />

          {/* 弹窗内容 */}
          <motion.div
            initial={{ opacity: 0, scale: 0.9, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 20 }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-[101] w-full max-w-4xl px-4"
          >
            <div className="bg-slate-900 rounded-xl border border-slate-700 shadow-2xl overflow-hidden">
              {/* 标题栏 */}
              <div className="px-6 py-4 border-b border-slate-700 bg-gradient-to-r from-amber-500/20 to-orange-500/20">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className="text-2xl">🔄</span>
                    <div>
                      <h2 className="text-lg font-bold text-white">换牌阶段</h2>
                      <p className="text-sm text-slate-400">
                        {playerName} ({isFirstPlayer ? '先攻' : '后攻'})
                      </p>
                    </div>
                  </div>

                  {/* 状态指示 */}
                  <div className="flex items-center gap-2">
                    {isMyMulliganTurn ? (
                      <span className="px-3 py-1 bg-emerald-500/20 text-emerald-400 text-sm rounded-full border border-emerald-500/30">
                        轮到你换牌
                      </span>
                    ) : (
                      <span className="px-3 py-1 bg-slate-500/20 text-slate-400 text-sm rounded-full border border-slate-500/30">
                        等待对手...
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* 提示区域 */}
              <div className="px-6 py-3 bg-slate-800/50 border-b border-slate-700/50">
                <p className="text-sm text-slate-300">
                  💡 点击选择要换掉的卡牌（可选 0-6 张），确认后将这些牌洗入牌库并重新抽取相同数量的牌
                </p>
              </div>

              {/* 手牌区域 */}
              <div className="px-6 py-6">
                <div className="text-sm font-medium text-slate-300 mb-4">
                  📜 你的手牌 ({currentPlayer.hand.cardIds.length} 张)
                  {selectedCardIds.size > 0 && (
                    <span className="ml-2 text-amber-400">
                      - 已选择 {selectedCardIds.size} 张要换的牌
                    </span>
                  )}
                </div>

                {/* 卡牌网格 */}
                <div className="flex flex-wrap gap-4 justify-center">
                  {currentPlayer.hand.cardIds.map((cardId) => {
                    const card = getCardInstance(cardId);
                    if (!card) return null;

                    const isSelected = selectedCardIds.has(cardId);
                    const cardData = card.data;
                    const imagePath = getCardImagePath(cardData.cardCode);

                    return (
                      <motion.div
                        key={cardId}
                        whileHover={{ scale: isMyMulliganTurn ? 1.05 : 1 }}
                        whileTap={{ scale: isMyMulliganTurn ? 0.95 : 1 }}
                        onClick={() => isMyMulliganTurn && toggleCardSelection(cardId)}
                        className={cn(
                          'relative cursor-pointer transition-all duration-200',
                          !isMyMulliganTurn && 'cursor-not-allowed opacity-50',
                          isSelected && 'ring-4 ring-amber-400 ring-offset-2 ring-offset-slate-900 rounded-lg'
                        )}
                      >
                        <Card
                          cardData={cardData as AnyCardData}
                          imagePath={imagePath}
                          size="md"
                        />

                        {/* 选中标记 */}
                        {isSelected && (
                          <motion.div
                            initial={{ scale: 0 }}
                            animate={{ scale: 1 }}
                            className="absolute -top-2 -right-2 w-8 h-8 bg-amber-500 rounded-full flex items-center justify-center shadow-lg"
                          >
                            <span className="text-white font-bold">✓</span>
                          </motion.div>
                        )}

                        {/* 卡牌信息覆盖层 */}
                        <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-2 rounded-b-lg">
                          <p className="text-xs text-white truncate font-medium">{cardData.name}</p>
                          {cardData.cardType === 'MEMBER' && (
                            <p className="text-xs text-slate-300">
                              Cost: {(cardData as MemberCardData).cost}
                            </p>
                          )}
                          {cardData.cardType === 'LIVE' && (
                            <p className="text-xs text-pink-300">Live</p>
                          )}
                        </div>
                      </motion.div>
                    );
                  })}
                </div>

                {/* 空手牌提示 */}
                {currentPlayer.hand.cardIds.length === 0 && (
                  <div className="text-center text-slate-500 py-8">
                    手牌为空
                  </div>
                )}
              </div>

              {/* 按钮区域 */}
              <div className="px-6 py-4 bg-slate-800/50 border-t border-slate-700 flex gap-3">
                <motion.button
                  whileHover={{ scale: isMyMulliganTurn ? 1.02 : 1 }}
                  whileTap={{ scale: isMyMulliganTurn ? 0.98 : 1 }}
                  onClick={handleSkip}
                  disabled={!isMyMulliganTurn}
                  className={cn(
                    'flex-1 py-3 rounded-lg text-sm font-medium transition-colors',
                    isMyMulliganTurn
                      ? 'bg-slate-700 hover:bg-slate-600 text-white'
                      : 'bg-slate-800 text-slate-500 cursor-not-allowed'
                  )}
                >
                  不换牌
                </motion.button>

                <motion.button
                  whileHover={{ scale: isMyMulliganTurn ? 1.02 : 1 }}
                  whileTap={{ scale: isMyMulliganTurn ? 0.98 : 1 }}
                  onClick={handleConfirm}
                  disabled={!isMyMulliganTurn || selectedCardIds.size === 0}
                  className={cn(
                    'flex-1 py-3 rounded-lg text-sm font-bold transition-colors',
                    isMyMulliganTurn && selectedCardIds.size > 0
                      ? 'bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-white shadow-lg'
                      : 'bg-slate-800 text-slate-500 cursor-not-allowed'
                  )}
                >
                  🔄 确认换牌 ({selectedCardIds.size} 张)
                </motion.button>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
});

export default MulliganPanel;
