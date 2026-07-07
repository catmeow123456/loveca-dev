/**
 * 换牌面板 (Mulligan Panel)
 * 游戏开始时，玩家可选择要换的牌
 * 选中的牌洗入牌库，然后重新抽取相同数量的牌
 */

import { memo, useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowRightLeft, Check, Sparkles } from 'lucide-react';
import { GameCommandType } from '@game/application/game-commands';
import { useShallow } from 'zustand/react/shallow';
import { cn } from '@/lib/utils';
import { GamePhase, SubPhase } from '@game/shared/types/enums';
import { useGameStore } from '@/store/gameStore';
import { Card } from '@/components/card/Card';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import {
  hasBattleViewportSignatureChanged,
  readBattleViewportSignature,
  subscribeToBattleViewportChanges,
  type BattleViewportSignature,
} from '@/lib/battleViewport';
import type { AnyCardData } from '@game/domain/entities/card';
import type { ViewZoneKey } from '@game/online';

interface MulliganPanelProps {
  /** 是否显示 */
  isOpen: boolean;
}

const EMPTY_PUBLIC_OBJECT_IDS: readonly string[] = [];
const LONG_PRESS_DETAIL_MS = 420;

export const MulliganPanel = memo(function MulliganPanel({ isOpen }: MulliganPanelProps) {
  // 状态选择器
  const currentPhase = useGameStore((s) => s.getCurrentPhaseView());
  const currentSubPhase = useGameStore((s) => s.getCurrentSubPhaseView());
  const viewerSeat = useGameStore((s) => s.getViewerSeat());
  const canMulligan = useGameStore((s) => s.canUseAction(GameCommandType.MULLIGAN));
  const currentPlayerIdentity = useGameStore((s) => s.getViewingPlayerIdentity());
  const shouldUseTapDetail = useMediaQuery('(max-width: 1023px)');
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
  const { mulligan, getVisibleCardPresentation, setHoveredCard } = useGameStore(
    useShallow((s) => ({
      mulligan: s.mulligan,
      getVisibleCardPresentation: s.getVisibleCardPresentation,
      setHoveredCard: s.setHoveredCard,
    }))
  );

  // 选中要换的卡牌 ID
  const [selectedCardIds, setSelectedCardIds] = useState<Set<string>>(new Set());
  const longPressTimerRef = useRef<number | null>(null);
  const longPressViewportStartRef = useRef<BattleViewportSignature | null>(null);
  const longPressViewportInvalidatedRef = useRef(false);
  const longPressTriggeredRef = useRef(false);
  const suppressNextClickRef = useRef(false);

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

  const clearLongPressTimer = useCallback(() => {
    if (longPressTimerRef.current) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }, []);

  const cancelLongPressForViewportChange = useCallback(() => {
    const startSignature = longPressViewportStartRef.current;
    if (!startSignature) {
      return;
    }

    if (!hasBattleViewportSignatureChanged(startSignature, readBattleViewportSignature())) {
      return;
    }

    clearLongPressTimer();
    longPressViewportStartRef.current = null;
    longPressViewportInvalidatedRef.current = true;
    longPressTriggeredRef.current = false;
    suppressNextClickRef.current = true;
  }, [clearLongPressTimer]);

  useEffect(() => subscribeToBattleViewportChanges(cancelLongPressForViewportChange), [
    cancelLongPressForViewportChange,
  ]);

  const startLongPressDetail = useCallback(
    (cardId: string) => {
      if (!shouldUseTapDetail) {
        return;
      }

      clearLongPressTimer();
      longPressViewportStartRef.current = readBattleViewportSignature();
      longPressViewportInvalidatedRef.current = false;
      longPressTriggeredRef.current = false;
      longPressTimerRef.current = window.setTimeout(() => {
        longPressTriggeredRef.current = true;
        setHoveredCard(cardId);
      }, LONG_PRESS_DETAIL_MS);
    },
    [clearLongPressTimer, setHoveredCard, shouldUseTapDetail]
  );

  const finishCardPress = useCallback(
    (cardId: string) => {
      clearLongPressTimer();
      longPressViewportStartRef.current = null;
      if (longPressViewportInvalidatedRef.current) {
        longPressViewportInvalidatedRef.current = false;
        longPressTriggeredRef.current = false;
        return;
      }
      if (longPressTriggeredRef.current) {
        longPressTriggeredRef.current = false;
        return;
      }
      if (isMyMulliganTurn) {
        toggleCardSelection(cardId);
      }
    },
    [clearLongPressTimer, isMyMulliganTurn, toggleCardSelection]
  );

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

          <div className="fixed inset-0 z-[101] flex items-center justify-center px-2 sm:px-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              transition={{ type: 'spring', damping: 25, stiffness: 300 }}
              className="w-full max-w-[980px]"
            >
              <div className="modal-surface modal-accent-amber flex max-h-[var(--battle-viewport-height-88)] flex-col">
                <div className="modal-header shrink-0 px-4 py-4 sm:px-6">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <ArrowRightLeft size={22} className="text-[var(--accent-secondary)]" />
                      <div className="min-w-0">
                        <h2 className="text-lg font-bold text-[var(--text-primary)]">换牌阶段</h2>
                        <p className="text-sm text-[var(--text-secondary)]">
                          {playerName} ({isFirstPlayer ? '先攻' : '后攻'})
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      {isMyMulliganTurn ? (
                        <span className="shrink-0 rounded-lg border border-[color:color-mix(in_srgb,var(--semantic-success)_35%,transparent)] bg-[color:color-mix(in_srgb,var(--semantic-success)_14%,transparent)] px-2.5 py-1 text-xs font-semibold text-[var(--semantic-success)] sm:text-sm">
                          轮到你换牌
                        </span>
                      ) : (
                        <span className="shrink-0 rounded-lg border border-[var(--border-default)] bg-[var(--bg-overlay)] px-2.5 py-1 text-xs font-semibold text-[var(--text-muted)] sm:text-sm">
                          等待对手...
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="shrink-0 border-b border-[var(--border-subtle)] bg-[color:color-mix(in_srgb,var(--accent-secondary)_8%,transparent)] px-4 py-3 sm:px-6">
                  <p className="text-sm text-[var(--text-secondary)]">
                    点击选择要换掉的卡牌（可选 0-6
                    张），确认后将这些牌洗入牌库并重新抽取相同数量的牌
                  </p>
                </div>

                <div className="cute-scrollbar min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6">
                  <div className="mb-4 text-sm font-medium text-[var(--text-secondary)]">
                    你的手牌 ({handCardIds.length} 张)
                    {selectedCardIds.size > 0 && (
                      <span className="ml-2 text-[var(--accent-secondary)]">
                        - 已选择 {selectedCardIds.size} 张要换的牌
                      </span>
                    )}
                  </div>

                  <div className="mx-auto grid max-w-[720px] grid-cols-3 gap-2 sm:grid-cols-6 sm:gap-3">
                    {handCardIds.map((cardId) => {
                      const card = getVisibleCardPresentation(cardId);
                      if (!card) return null;

                      const isSelected = selectedCardIds.has(cardId);
                      const cardData = card.cardData;
                      const imagePath = card.imagePath;

                      return (
                        <motion.button
                          key={cardId}
                          type="button"
                          whileHover={isMyMulliganTurn ? { y: -4 } : undefined}
                          whileTap={isMyMulliganTurn ? { scale: 0.98 } : undefined}
                          onPointerDown={(event) => {
                            if (event.pointerType !== 'mouse') {
                              startLongPressDetail(card.instanceId);
                            }
                          }}
                          onPointerUp={(event) => {
                            if (event.pointerType !== 'mouse') {
                              cancelLongPressForViewportChange();
                              suppressNextClickRef.current = true;
                              finishCardPress(cardId);
                            }
                          }}
                          onPointerCancel={() => {
                            clearLongPressTimer();
                            longPressViewportStartRef.current = null;
                            longPressViewportInvalidatedRef.current = false;
                            longPressTriggeredRef.current = false;
                            suppressNextClickRef.current = true;
                          }}
                          onClick={(event) => {
                            if (suppressNextClickRef.current) {
                              suppressNextClickRef.current = false;
                              return;
                            }
                            if (
                              'pointerType' in event.nativeEvent &&
                              event.nativeEvent.pointerType !== 'mouse'
                            ) {
                              return;
                            }
                            if (isMyMulliganTurn) {
                              toggleCardSelection(cardId);
                            }
                          }}
                          onContextMenu={(event) => {
                            event.preventDefault();
                            setHoveredCard(card.instanceId);
                          }}
                          onMouseEnter={() => {
                            if (!shouldUseTapDetail) {
                              setHoveredCard(card.instanceId);
                            }
                          }}
                          onMouseLeave={() => {
                            if (!shouldUseTapDetail) {
                              setHoveredCard(null);
                            }
                          }}
                          aria-pressed={isSelected}
                          aria-disabled={!isMyMulliganTurn}
                          className={cn(
                            'group flex min-w-0 items-center justify-center rounded-lg border p-1.5 transition sm:p-2',
                            isMyMulliganTurn
                              ? 'border-[var(--border-subtle)] bg-[color:color-mix(in_srgb,var(--bg-surface)_82%,transparent)] hover:border-[color:color-mix(in_srgb,var(--accent-secondary)_42%,var(--border-default))]'
                              : 'cursor-zoom-in border-[var(--border-subtle)] bg-[var(--bg-overlay)] opacity-70',
                            isSelected &&
                              'border-[var(--accent-secondary)] bg-[color:color-mix(in_srgb,var(--accent-secondary)_14%,var(--bg-surface))] shadow-[0_0_0_1px_color-mix(in_srgb,var(--accent-secondary)_45%,transparent)]'
                          )}
                        >
                          <div className="relative aspect-[5/7] w-full max-w-[94px] overflow-visible rounded-lg sm:max-w-[106px]">
                            <Card
                              cardData={cardData as AnyCardData}
                              instanceId={card.instanceId}
                              imagePath={imagePath}
                              size="responsive"
                              faceUp={true}
                              interactive={false}
                              showHover={false}
                              showInfoOverlay={false}
                            />

                            {isSelected && (
                              <motion.div
                                initial={{ scale: 0 }}
                                animate={{ scale: 1 }}
                                className="absolute -right-2 -top-2 flex h-7 w-7 items-center justify-center rounded-full bg-[var(--accent-secondary)] shadow-[var(--shadow-md)]"
                              >
                                <Check size={15} className="text-white" />
                              </motion.div>
                            )}
                          </div>
                        </motion.button>
                      );
                    })}
                  </div>

                  {handCardIds.length === 0 && (
                    <div className="py-8 text-center text-[var(--text-muted)]">手牌为空</div>
                  )}
                </div>

                <div className="modal-footer safe-bottom shrink-0 px-4 py-3 sm:px-6">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex items-center justify-between gap-3 rounded-lg border border-[var(--border-subtle)] bg-[color:color-mix(in_srgb,var(--bg-overlay)_42%,transparent)] px-3 py-2 text-xs text-[var(--text-secondary)] sm:min-w-[180px] sm:justify-start">
                      <span>已选择</span>
                      <span className="font-bold text-[var(--accent-secondary)]">
                        {selectedCardIds.size}
                      </span>
                      <span>张</span>
                    </div>

                    <div className="flex items-center justify-end gap-2">
                      <motion.button
                        whileHover={{ scale: isMyMulliganTurn ? 1.01 : 1 }}
                        whileTap={{ scale: isMyMulliganTurn ? 0.98 : 1 }}
                        onClick={handleSkip}
                        disabled={!isMyMulliganTurn}
                        className={cn(
                          'inline-flex min-h-10 items-center justify-center rounded-lg px-4 py-2 text-sm font-semibold transition-colors',
                          isMyMulliganTurn
                            ? 'button-ghost border border-[var(--border-default)]'
                            : 'cursor-not-allowed bg-[var(--bg-overlay)] text-[var(--text-muted)]'
                        )}
                      >
                        保留手牌
                      </motion.button>

                      <motion.button
                        whileHover={{
                          scale: isMyMulliganTurn && selectedCardIds.size > 0 ? 1.01 : 1,
                        }}
                        whileTap={{
                          scale: isMyMulliganTurn && selectedCardIds.size > 0 ? 0.98 : 1,
                        }}
                        onClick={handleConfirm}
                        disabled={!isMyMulliganTurn || selectedCardIds.size === 0}
                        className={cn(
                          'inline-flex min-h-10 items-center justify-center gap-1.5 rounded-lg px-4 py-2 text-sm font-bold transition-colors',
                          isMyMulliganTurn && selectedCardIds.size > 0
                            ? 'button-gold'
                            : 'cursor-not-allowed bg-[var(--bg-overlay)] text-[var(--text-muted)]'
                        )}
                      >
                        <Sparkles size={15} />换 {selectedCardIds.size} 张
                      </motion.button>
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>
  );
});

export default MulliganPanel;
