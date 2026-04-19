/**
 * 换牌面板 (Mulligan Panel)
 * 游戏开始时，玩家可选择要换的牌
 * 选中的牌洗入牌库，然后重新抽取相同数量的牌
 */

import { memo, useState, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowRightLeft, Check, Sparkles } from 'lucide-react';
import { GameCommandType } from '@game/application/game-commands';
import { useShallow } from 'zustand/react/shallow';
import { cn } from '@/lib/utils';
import { GamePhase, SubPhase } from '@game/shared/types/enums';
import { useGameStore } from '@/store/gameStore';
import { Card } from '@/components/card/Card';
import type { MemberCardData, AnyCardData } from '@game/domain/entities/card';
import type { ViewZoneKey } from '@game/online';

interface MulliganPanelProps {
  /** 是否显示 */
  isOpen: boolean;
}

const EMPTY_PUBLIC_OBJECT_IDS: readonly string[] = [];

export const MulliganPanel = memo(function MulliganPanel({ isOpen }: MulliganPanelProps) {
  // 状态选择器
  const currentPhase = useGameStore((s) => s.getCurrentPhaseView());
  const currentSubPhase = useGameStore((s) => s.getCurrentSubPhaseView());
  const viewerSeat = useGameStore((s) => s.getViewerSeat());
  const canMulligan = useGameStore((s) => s.canUseAction(GameCommandType.MULLIGAN));
  const currentPlayerIdentity = useGameStore((s) => s.getViewingPlayerIdentity());
  const handObjectIds = useGameStore((s) =>
    viewerSeat
      ? s.getZonePublicObjectIds(`${viewerSeat}_HAND` as ViewZoneKey)
      : EMPTY_PUBLIC_OBJECT_IDS
  );
  const hasViewerCompletedMulligan = useGameStore((s) => s.hasViewerCompletedMulligan());

  const handCardIds = useMemo(() => {
    return handObjectIds.map((publicObjectId) =>
      publicObjectId.startsWith('obj_') ? publicObjectId.slice(4) : publicObjectId
    );
  }, [handObjectIds]);

  // 方法选择器（使用 useShallow 保持引用稳定）
  const { mulligan, getVisibleCardPresentation } = useGameStore(
    useShallow((s) => ({
      mulligan: s.mulligan,
      getVisibleCardPresentation: s.getVisibleCardPresentation,
    }))
  );

  // 选中要换的卡牌 ID
  const [selectedCardIds, setSelectedCardIds] = useState<Set<string>>(new Set());

  // 检查是否已完成换牌
  // 检查当前是否轮到该玩家换牌
  const isMyMulliganTurn = useMemo(() => {
    return (
      (currentSubPhase === SubPhase.MULLIGAN_FIRST_PLAYER ||
        currentSubPhase === SubPhase.MULLIGAN_SECOND_PLAYER) &&
      canMulligan
    );
  }, [canMulligan, currentSubPhase]);

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
    if (!isOpen || !currentPhase) return false;
    if (currentPhase !== GamePhase.MULLIGAN_PHASE) return false;
    if (hasViewerCompletedMulligan) return false;
    return true;
  }, [currentPhase, hasViewerCompletedMulligan, isOpen]);

  if (!shouldShow || !currentPlayerIdentity || !viewerSeat) return null;

  // 获取玩家名称用于显示
  const playerName = currentPlayerIdentity.name;
  const isFirstPlayer = viewerSeat === 'FIRST';

  return (
    <AnimatePresence>
      {shouldShow && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="modal-backdrop z-[100]"
          />

          <motion.div
            initial={{ opacity: 0, scale: 0.9, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 20 }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-[101] w-full max-w-4xl px-4"
          >
            <div className="modal-surface modal-accent-amber">
              <div className="modal-header px-6 py-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <ArrowRightLeft size={22} className="text-[var(--accent-secondary)]" />
                    <div>
                      <h2 className="text-lg font-bold text-[var(--text-primary)]">换牌阶段</h2>
                      <p className="text-sm text-[var(--text-secondary)]">
                        {playerName} ({isFirstPlayer ? '先攻' : '后攻'})
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    {isMyMulliganTurn ? (
                      <span className="rounded-full border border-[color:color-mix(in_srgb,var(--semantic-success)_35%,transparent)] bg-[color:color-mix(in_srgb,var(--semantic-success)_14%,transparent)] px-3 py-1 text-sm text-[var(--semantic-success)]">
                        轮到你换牌
                      </span>
                    ) : (
                      <span className="rounded-full border border-[var(--border-default)] bg-[var(--bg-overlay)] px-3 py-1 text-sm text-[var(--text-muted)]">
                        等待对手...
                      </span>
                    )}
                  </div>
                </div>
              </div>

              <div className="px-6 py-3 border-b border-[var(--border-subtle)] bg-[color:color-mix(in_srgb,var(--accent-secondary)_8%,transparent)]">
                <p className="text-sm text-[var(--text-secondary)]">
                  点击选择要换掉的卡牌（可选 0-6 张），确认后将这些牌洗入牌库并重新抽取相同数量的牌
                </p>
              </div>

              <div className="px-6 py-6">
                <div className="mb-4 text-sm font-medium text-[var(--text-secondary)]">
                  你的手牌 ({handCardIds.length} 张)
                  {selectedCardIds.size > 0 && (
                    <span className="ml-2 text-[var(--accent-secondary)]">
                      - 已选择 {selectedCardIds.size} 张要换的牌
                    </span>
                  )}
                </div>

                <div className="flex flex-wrap gap-4 justify-center">
                  {handCardIds.map((cardId) => {
                    const card = getVisibleCardPresentation(cardId);
                    if (!card) return null;

                    const isSelected = selectedCardIds.has(cardId);
                    const cardData = card.cardData;
                    const imagePath = card.imagePath;

                    return (
                      <motion.div
                        key={cardId}
                        whileHover={{ scale: isMyMulliganTurn ? 1.05 : 1 }}
                        whileTap={{ scale: isMyMulliganTurn ? 0.95 : 1 }}
                        onClick={() => isMyMulliganTurn && toggleCardSelection(cardId)}
                        className={cn(
                          'relative cursor-pointer transition-all duration-200',
                          !isMyMulliganTurn && 'cursor-not-allowed opacity-50',
                          isSelected && 'ring-4 ring-[var(--accent-secondary)] ring-offset-2 ring-offset-[var(--bg-elevated)] rounded-lg'
                        )}
                      >
                        <Card
                          cardData={cardData as AnyCardData}
                          imagePath={imagePath}
                          size="md"
                        />

                        {isSelected && (
                          <motion.div
                            initial={{ scale: 0 }}
                            animate={{ scale: 1 }}
                            className="absolute -right-2 -top-2 flex h-8 w-8 items-center justify-center rounded-full bg-[var(--accent-secondary)] shadow-[var(--shadow-md)]"
                          >
                            <Check size={16} className="text-white" />
                          </motion.div>
                        )}

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

                {handCardIds.length === 0 && (
                  <div className="py-8 text-center text-[var(--text-muted)]">
                    手牌为空
                  </div>
                )}
              </div>

              <div className="modal-footer flex gap-3 px-6 py-4">
                <motion.button
                  whileHover={{ scale: isMyMulliganTurn ? 1.02 : 1 }}
                  whileTap={{ scale: isMyMulliganTurn ? 0.98 : 1 }}
                  onClick={handleSkip}
                  disabled={!isMyMulliganTurn}
                  className={cn(
                    'flex-1 py-3 rounded-lg text-sm font-medium transition-colors',
                    isMyMulliganTurn
                      ? 'button-secondary'
                      : 'bg-[var(--bg-overlay)] text-[var(--text-muted)] cursor-not-allowed'
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
                    'flex-1 py-3 rounded-lg text-sm font-bold transition-colors inline-flex items-center justify-center gap-2',
                    isMyMulliganTurn && selectedCardIds.size > 0
                      ? 'button-gold'
                      : 'bg-[var(--bg-overlay)] text-[var(--text-muted)] cursor-not-allowed'
                  )}
                >
                  <Sparkles size={16} />
                  确认换牌 ({selectedCardIds.size} 张)
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
