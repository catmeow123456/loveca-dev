/**
 * Live 判定面板（含应援区）
 *
 * 统一面板，上方为应援区（翻牌、操作、光棒心统计），
 * 下方为 Live 卡判定区（总心数汇总 + 成功/失败切换）。
 * 风格与 CheerPeekModal 保持一致（悬浮窗风格）。
 *
 * 每位玩家的应援牌独立追踪（per-player），
 * 最终在 RESULT_SETTLEMENT 阶段统一清理到各自休息室。
 */

import { memo, useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { motion } from 'framer-motion';
import { BarChart3, ChevronLeft, Mic, Sparkles } from 'lucide-react';
import {
  SortableContext,
  horizontalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { GameCommandType } from '@game/application/game-commands';
import { useShallow } from 'zustand/react/shallow';
import { cn } from '@/lib/utils';
import { getHeartRequirementEntries } from '@/lib/heartRequirementUtils';
import { SubPhase, HeartColor, ZoneType, BladeHeartEffect, SlotPosition } from '@game/shared/types/enums';
import { isSuccessEffectSubPhase } from '@game/shared/phase-config';
import { useGameStore } from '@/store/gameStore';
import { DroppableZone } from './interaction';
import type { BladeHearts, MemberCardData, LiveCardData } from '@game/domain/entities/card';
import { Heart } from 'lucide-react';

interface JudgmentPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

// ============================================
// 工具函数
// ============================================

const heartColorConfig: Record<HeartColor, { colorClass: string; fill: string; name: string }> = {
  [HeartColor.PINK]: { colorClass: 'text-pink-400', fill: 'fill-pink-400', name: '粉' },
  [HeartColor.RED]: { colorClass: 'text-red-400', fill: 'fill-red-400', name: '红' },
  [HeartColor.YELLOW]: { colorClass: 'text-yellow-400', fill: 'fill-yellow-400', name: '黄' },
  [HeartColor.GREEN]: { colorClass: 'text-green-400', fill: 'fill-green-400', name: '绿' },
  [HeartColor.BLUE]: { colorClass: 'text-blue-400', fill: 'fill-blue-400', name: '蓝' },
  [HeartColor.PURPLE]: { colorClass: 'text-purple-400', fill: 'fill-purple-400', name: '紫' },
  [HeartColor.RAINBOW]: { colorClass: 'text-pink-400', fill: 'fill-pink-400', name: 'All' },
};

function getHeartColorClass(color: HeartColor): string {
  const colorMap: Record<HeartColor, string> = {
    [HeartColor.PINK]: 'text-pink-400',
    [HeartColor.RED]: 'text-red-400',
    [HeartColor.YELLOW]: 'text-yellow-400',
    [HeartColor.GREEN]: 'text-green-400',
    [HeartColor.BLUE]: 'text-blue-400',
    [HeartColor.PURPLE]: 'text-purple-400',
    [HeartColor.RAINBOW]: 'text-pink-400',
  };
  return colorMap[color] || 'text-slate-400';
}

function calculateCheerEffects(bladeHearts?: BladeHearts): {
  penLightHearts: { color: HeartColor; count: number }[];
  drawBonus: number;
  scoreBonus: number;
} {
  const penLightHearts: { color: HeartColor; count: number }[] = [];
  let drawBonus = 0;
  let scoreBonus = 0;

  // 处理 bladeHearts 数组
  if (bladeHearts) {
    for (const item of bladeHearts) {
      switch (item.effect) {
        case BladeHeartEffect.DRAW:
          drawBonus += 1;
          break;
        case BladeHeartEffect.SCORE:
          scoreBonus += 1;
          break;
        case BladeHeartEffect.HEART:
          if (item.heartColor) {
            penLightHearts.push({ color: item.heartColor, count: 1 });
          }
          break;
      }
    }
  }
  return { penLightHearts, drawBonus, scoreBonus };
}

// ============================================
// 子组件
// ============================================

/** 可排序的应援卡牌 */
const SortableCheerCard = memo(function SortableCheerCard({
  cardId,
  imagePath,
  disabled = false,
}: {
  cardId: string;
  imagePath: string;
  disabled?: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useSortable({
    id: cardId,
    disabled,
    data: {
      cardId,
      fromZone: ZoneType.RESOLUTION_ZONE,
    },
  });
  const style: React.CSSProperties = {
    transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
    zIndex: isDragging ? 50 : undefined,
    position: 'relative' as const,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className={cn(
        'w-[72px] h-[100px] rounded-lg overflow-hidden shadow-md cursor-grab',
        isDragging && 'shadow-xl ring-2 ring-amber-400'
      )}
    >
      <img src={imagePath} alt="" className="w-full h-full object-cover" draggable={false} />
    </div>
  );
});

/** Live 卡展示行（只读） */
const LiveCardJudgmentRow = memo(function LiveCardJudgmentRow({
  cardName,
  requiredHearts,
}: {
  cardName: string;
  requiredHearts: { color: HeartColor; count: number }[];
}) {
  return (
    <div className="flex items-center gap-3 p-2 bg-slate-800/30 rounded-lg border border-slate-700/30">
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-white truncate">{cardName}</div>
        <div className="flex gap-1 mt-0.5">
          {requiredHearts.map((req, idx) => (
            <span key={idx} className={cn('inline-flex items-center gap-0.5 text-xs', heartColorConfig[req.color].colorClass)}>
              <Heart className={cn('w-3 h-3', heartColorConfig[req.color].fill)} />{req.count}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
});

// ============================================
// 主组件
// ============================================

export const JudgmentPanel = memo(function JudgmentPanel({
  isOpen,
  onClose,
}: JudgmentPanelProps) {
  const activeSeat = useGameStore((s) => s.getActiveSeatView());
  const currentSubPhase = useGameStore((s) => s.getCurrentSubPhaseView()) ?? SubPhase.NONE;
  const canRevealCheerCard = useGameStore((s) =>
    s.canUseAction(GameCommandType.REVEAL_CHEER_CARD)
  );
  const canMoveResolutionCardToZone = useGameStore((s) =>
    s.canUseAction(GameCommandType.MOVE_RESOLUTION_CARD_TO_ZONE)
  );
  const canConfirmPerformanceOutcome = useGameStore((s) =>
    s.canUseAction(GameCommandType.CONFIRM_PERFORMANCE_OUTCOME)
  );
  const canConfirmStep = useGameStore((s) => s.canUseAction(GameCommandType.CONFIRM_STEP));
  const getCardFrontInfo = useGameStore((s) => s.getCardFrontInfo);
  const getPlayerIdentityForSeat = useGameStore((s) => s.getPlayerIdentityForSeat);
  const getSeatZone = useGameStore((s) => s.getSeatZone);
  const getSeatZoneCardIds = useGameStore((s) => s.getSeatZoneCardIds);
  const getSeatMemberSlotCardId = useGameStore((s) => s.getSeatMemberSlotCardId);
  const {
    confirmSubPhase,
    confirmPerformanceOutcome,
    getCardImagePath,
    moveResolutionCardToZone,
    revealCheerCard,
    setHoveredCard,
  } =
      useGameStore(
      useShallow((s) => ({
        confirmSubPhase: s.confirmSubPhase,
        confirmPerformanceOutcome: s.confirmPerformanceOutcome,
        getCardImagePath: s.getCardImagePath,
        moveResolutionCardToZone: s.moveResolutionCardToZone,
        revealCheerCard: s.revealCheerCard,
        setHoveredCard: s.setHoveredCard,
      }))
    );

  const currentPlayer = activeSeat ? getPlayerIdentityForSeat(activeSeat) : null;
  const mainDeckCount = activeSeat ? (getSeatZone(activeSeat, 'MAIN_DECK')?.count ?? 0) : 0;
  const liveCardIds = activeSeat ? getSeatZoneCardIds(activeSeat, 'LIVE_ZONE') : [];

  // 直接从 store 订阅解决区卡牌 ID，确保数据变化时触发重渲染
  const cheerCardIds = useGameStore(
    useShallow((s) => {
      if (!activeSeat || !currentPlayer) {
        return [] as string[];
      }
      return s.getResolutionCardIdsForSeat(activeSeat);
    })
  );

  // UI 阶段：judge=显示 LIVE失败/LIVE成功；success=显示成功后处理提示
  const [uiStage, setUiStage] = useState<'judge' | 'success'>('judge');
  const previousWindowStateRef = useRef<{
    playerId: string | null;
    subPhase: SubPhase;
  }>({
    playerId: null,
    subPhase: SubPhase.NONE,
  });
  const closeAfterRemoteAdvanceRef = useRef(false);

  // 仅在真正进入新的判定窗口时重置阶段；折叠/展开抽屉只影响可见性，不重置内部状态。
  useEffect(() => {
    const previousWindowState = previousWindowStateRef.current;
    const currentPlayerId = currentPlayer?.id ?? null;
    const enteringPerformanceJudgment =
      currentSubPhase === SubPhase.PERFORMANCE_JUDGMENT &&
      previousWindowState.subPhase !== SubPhase.PERFORMANCE_JUDGMENT;
    const performingPlayerChanged =
      currentSubPhase === SubPhase.PERFORMANCE_JUDGMENT &&
      previousWindowState.playerId !== null &&
      previousWindowState.playerId !== currentPlayerId;
    const leavingLiveJudgmentFlow =
      previousWindowState.subPhase !== currentSubPhase &&
      currentSubPhase !== SubPhase.PERFORMANCE_JUDGMENT &&
      !isSuccessEffectSubPhase(currentSubPhase);

    if (enteringPerformanceJudgment || performingPlayerChanged || leavingLiveJudgmentFlow) {
      setUiStage('judge');
    }

    previousWindowStateRef.current = {
      playerId: currentPlayerId,
      subPhase: currentSubPhase,
    };
  }, [currentPlayer?.id, currentSubPhase]);

  useEffect(() => {
    if (!closeAfterRemoteAdvanceRef.current || currentSubPhase === SubPhase.PERFORMANCE_JUDGMENT) {
      return;
    }

    closeAfterRemoteAdvanceRef.current = false;
    onClose();
  }, [currentSubPhase, onClose]);

  // ---- 应援区操作 ----
  // 前端应援区列表会自动从共享解决区视图同步

  const drawCheerCard = useCallback(() => {
    if (!currentPlayer || !canRevealCheerCard || mainDeckCount === 0) return;
    revealCheerCard();
  }, [canRevealCheerCard, currentPlayer, mainDeckCount, revealCheerCard]);

  const moveToHand = useCallback(
    (cardId: string) => {
      if (!canMoveResolutionCardToZone) {
        return;
      }
      const result = moveResolutionCardToZone(cardId, ZoneType.HAND);
      if (result.success) {
        setHoveredCard(null);
      }
    },
    [canMoveResolutionCardToZone, moveResolutionCardToZone, setHoveredCard]
  );

  const moveToWaitingRoom = useCallback(
    (cardId: string) => {
      if (!canMoveResolutionCardToZone) {
        return;
      }
      const result = moveResolutionCardToZone(cardId, ZoneType.WAITING_ROOM);
      if (result.success) {
        setHoveredCard(null);
      }
    },
    [canMoveResolutionCardToZone, moveResolutionCardToZone, setHoveredCard]
  );

  const returnToDeckTop = useCallback(
    (cardId: string) => {
      if (!canMoveResolutionCardToZone) {
        return;
      }
      const result = moveResolutionCardToZone(cardId, ZoneType.MAIN_DECK, { position: 'TOP' });
      if (result.success) {
        setHoveredCard(null);
      }
    },
    [canMoveResolutionCardToZone, moveResolutionCardToZone, setHoveredCard]
  );

  // 应援卡牌实例 — cheerCardIds 已通过 store selector 响应式更新，
  // 当解决区卡牌增减时 useMemo 会重新计算
  const cheerCards = useMemo(() => {
    const state = useGameStore.getState();
    return cheerCardIds.map((id) => {
      const viewObject = state.getCardViewObject(id);
      const frontInfo = viewObject?.frontInfo ?? null;
      return {
        id,
        frontInfo,
        viewObject,
      };
    });
  }, [cheerCardIds]);

  // ---- 心数汇总（成员心 + 光棒心） ----

  const { memberHearts, bladeHearts, totalHearts } = useMemo(() => {
    const members = new Map<HeartColor, number>();
    const blades = new Map<HeartColor, number>();
    Object.values(HeartColor).forEach((c) => { members.set(c, 0); blades.set(c, 0); });

    if (!activeSeat) return { memberHearts: members, bladeHearts: blades, totalHearts: members };

    // 成员心
    Object.values(SlotPosition).forEach((slot) => {
      const cardId = getSeatMemberSlotCardId(activeSeat, slot);
      if (!cardId) return;
      const frontInfo = getCardFrontInfo(cardId);
      if (frontInfo?.cardType === 'MEMBER' && Array.isArray(frontInfo.hearts)) {
        const hearts = frontInfo.hearts as MemberCardData['hearts'];
        hearts.forEach((heart) => {
          members.set(heart.color, (members.get(heart.color) ?? 0) + heart.count);
        });
      }
    });

    // 光棒心（从应援牌 - 包括成员卡和 Live 卡）
    for (const { frontInfo } of cheerCards) {
      if (!frontInfo) {
        continue;
      }
      const effects = calculateCheerEffects(frontInfo.bladeHearts as BladeHearts | undefined);
      for (const heart of effects.penLightHearts) {
        blades.set(heart.color, (blades.get(heart.color) ?? 0) + heart.count);
      }
    }

    // 合计
    const total = new Map<HeartColor, number>();
    Object.values(HeartColor).forEach((c) => {
      total.set(c, (members.get(c) ?? 0) + (blades.get(c) ?? 0));
    });

    return { memberHearts: members, bladeHearts: blades, totalHearts: total };
  }, [activeSeat, getCardFrontInfo, getSeatMemberSlotCardId, cheerCards]);

  // 光棒心抽卡加成和分数加成（包括应援牌和 Live 区的 Live 卡）
  const { totalDrawBonus } = useMemo(() => {
    let drawBonus = 0;

    // 从应援牌获取
    for (const { frontInfo } of cheerCards) {
      if (!frontInfo) {
        continue;
      }
      const effects = calculateCheerEffects(frontInfo.bladeHearts as BladeHearts | undefined);
      drawBonus += effects.drawBonus;
    }

    return { totalDrawBonus: drawBonus };
  }, [cheerCards]);

  const isPerformanceJudgment = currentSubPhase === SubPhase.PERFORMANCE_JUDGMENT;
  const isLiveSuccessWindow = isSuccessEffectSubPhase(currentSubPhase);
  const isResultScoreConfirm = currentSubPhase === SubPhase.RESULT_SCORE_CONFIRM;
  const isResultAnimation = currentSubPhase === SubPhase.RESULT_ANIMATION;
  const isResultSettlement = currentSubPhase === SubPhase.RESULT_SETTLEMENT;
  // ---- 判定操作 ----

  const handleLiveFailed = useCallback(() => {
    if (!currentPlayer || !canConfirmPerformanceOutcome) return;
    const result = confirmPerformanceOutcome(false);
    setHoveredCard(null);
    if (result.pending) {
      closeAfterRemoteAdvanceRef.current = true;
      return;
    }
    if (!result.success) {
      return;
    }
    onClose();
  }, [
    currentPlayer,
    canConfirmPerformanceOutcome,
    confirmPerformanceOutcome,
    onClose,
    setHoveredCard,
  ]);

  const handleLiveSuccess = useCallback(() => {
    if (!canConfirmPerformanceOutcome) {
      return;
    }
    setUiStage('success');
  }, [canConfirmPerformanceOutcome]);

  const handleFinishPerformanceSuccess = useCallback(() => {
    if (!currentPlayer || !canConfirmPerformanceOutcome) return;
    const result = confirmPerformanceOutcome(true);
    if (result.pending) {
      closeAfterRemoteAdvanceRef.current = true;
      return;
    }
    if (!result.success) {
      return;
    }
    onClose();
  }, [currentPlayer, canConfirmPerformanceOutcome, confirmPerformanceOutcome, onClose]);

  const handleSuccessEffectsDone = useCallback(() => {
    if (!isSuccessEffectSubPhase(currentSubPhase) || !canConfirmStep) {
      return;
    }
    confirmSubPhase(currentSubPhase);
  }, [canConfirmStep, confirmSubPhase, currentSubPhase]);

  // ESC 关闭
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    if (isOpen) {
      window.addEventListener('keydown', handleKeyDown);
      return () => window.removeEventListener('keydown', handleKeyDown);
    }
  }, [isOpen, onClose]);

  if (!isOpen || !currentPlayer) return null;

  const totalHeartsCount = Array.from(totalHearts.values()).reduce((s, c) => s + c, 0);

  return (
    <motion.aside
      className="fixed left-0 top-0 z-[90] h-full w-full max-w-[420px] overflow-visible border-r border-[var(--border-default)] bg-[var(--bg-frosted)] p-4 shadow-[var(--shadow-lg)] backdrop-blur-xl"
      initial={{ x: -460, opacity: 0.8 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: -460, opacity: 0.8 }}
      transition={{ type: 'spring', stiffness: 320, damping: 30 }}
    >
      <button
        type="button"
        onClick={onClose}
        className="absolute -right-8 top-1/2 z-10 flex h-16 w-8 -translate-y-1/2 items-center justify-center rounded-r-2xl border border-l-0 border-[var(--border-default)] bg-[color:color-mix(in_srgb,var(--bg-frosted)_94%,transparent)] text-[var(--accent-primary)] shadow-[var(--shadow-md)] backdrop-blur-xl transition-all hover:w-9 hover:text-[var(--text-primary)]"
        aria-label="收起判定区"
        title="收起判定区"
      >
        <ChevronLeft size={16} />
      </button>

      <div className="mb-3 flex items-start justify-between border-b border-[var(--border-default)] pb-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)]">
            <BarChart3 size={16} className="text-[var(--accent-primary)]" />
            判定区 / 应援操作窗
          </div>
          <div className="mt-0.5 text-[11px] text-[var(--text-secondary)]">
            {isPerformanceJudgment
              ? `当前为 ${currentPlayer?.name ?? '当前玩家'} 的 Live 判定阶段`
              : isLiveSuccessWindow
                ? '当前为 Live 成功效果窗口（可继续操作判定区）'
                : isResultScoreConfirm
                  ? '当前为分数最终确认阶段'
                  : isResultAnimation
                    ? '当前为胜者结果动画阶段'
                    : isResultSettlement
                      ? '当前为成功 Live 结算阶段'
                      : '可随时查看并操作判定区卡牌'}
          </div>
        </div>
      </div>

      <div className="cute-scrollbar h-[calc(100%-4rem)] overflow-y-auto pr-1">
      <div className="mb-4">
              <div className="mb-2 flex items-center justify-between border-b border-[color:color-mix(in_srgb,var(--accent-secondary)_35%,transparent)] pb-2">
                <span className="flex items-center gap-2 text-sm font-medium text-[var(--accent-secondary)]">
                  <Mic size={15} />
                  {currentPlayer.name} 的应援 ({cheerCards.length} 张)
                </span>
                <span className="text-xs text-[var(--text-muted)]">
                  主卡组剩余: {mainDeckCount}
                </span>
              </div>

              <div className="flex gap-2 mb-2">
                <button
                  onClick={drawCheerCard}
                  disabled={!canRevealCheerCard || mainDeckCount === 0}
                  className={cn(
                    'px-3 py-1.5 rounded text-xs font-medium',
                    canRevealCheerCard && mainDeckCount > 0
                      ? 'button-gold'
                      : 'bg-[var(--bg-overlay)] text-[var(--text-muted)] cursor-not-allowed'
                  )}
                >
                  ↓ 翻开一张
                </button>
              </div>

              <div className="mb-2 grid grid-cols-3 gap-2">
                <DroppableZone
                  id="resolution-target-hand"
                  disabled={!canMoveResolutionCardToZone}
                  className="rounded-lg border border-[var(--border-default)] bg-[color:color-mix(in_srgb,var(--bg-overlay)_44%,transparent)] px-3 py-2 text-center text-[11px] font-medium text-[var(--text-secondary)]"
                  activeClassName="outline outline-2 outline-cyan-400 bg-cyan-500/15"
                >
                  拖到这里回手
                </DroppableZone>
                <DroppableZone
                  id="resolution-target-waiting-room"
                  disabled={!canMoveResolutionCardToZone}
                  className="rounded-lg border border-[var(--border-default)] bg-[color:color-mix(in_srgb,var(--bg-overlay)_44%,transparent)] px-3 py-2 text-center text-[11px] font-medium text-[var(--text-secondary)]"
                  activeClassName="outline outline-2 outline-slate-300 bg-slate-500/15"
                >
                  拖到这里弃置
                </DroppableZone>
                <DroppableZone
                  id="resolution-target-main-deck-top"
                  disabled={!canMoveResolutionCardToZone}
                  className="rounded-lg border border-[var(--border-default)] bg-[color:color-mix(in_srgb,var(--bg-overlay)_44%,transparent)] px-3 py-2 text-center text-[11px] font-medium text-[var(--text-secondary)]"
                  activeClassName="outline outline-2 outline-amber-400 bg-amber-500/15"
                >
                  拖到这里回卡组顶
                </DroppableZone>
              </div>

              <div className="cute-scrollbar h-[140px] overflow-x-auto overflow-y-hidden rounded border border-[var(--border-default)] bg-[color:color-mix(in_srgb,var(--bg-overlay)_56%,transparent)] p-2">
                {cheerCards.length === 0 ? (
                  <div className="flex h-full items-center justify-center text-xs text-[var(--text-muted)]">
                    点击「翻开一张」从卡组顶翻开应援牌
                  </div>
                ) : (
                  <SortableContext items={cheerCardIds} strategy={horizontalListSortingStrategy}>
                    <div className="flex gap-2 items-start" style={{ minWidth: 'min-content' }}>
                      {cheerCards.map(({ id, frontInfo, viewObject }) => {
                        const effects = frontInfo ? calculateCheerEffects(frontInfo.bladeHearts as BladeHearts | undefined) : {
                          penLightHearts: [],
                          drawBonus: 0,
                          scoreBonus: 0,
                        };
                        const canInspectFront = viewObject?.surface === 'FRONT' && frontInfo !== null;
                        return (
                          <div
                            key={id}
                            className="relative group flex flex-col items-center gap-0.5"
                            onMouseEnter={() => canInspectFront && setHoveredCard(id)}
                            onMouseLeave={() => setHoveredCard(null)}
                          >
                            {canInspectFront && frontInfo ? (
                              <SortableCheerCard
                                cardId={id}
                                imagePath={getCardImagePath(frontInfo.cardCode)}
                                disabled={!canMoveResolutionCardToZone}
                              />
                            ) : (
                              <div className="h-[100px] w-[72px] overflow-hidden rounded-lg shadow-md">
                                <img src="/back.jpg" alt="" className="h-full w-full object-cover" draggable={false} />
                              </div>
                            )}
                            <div className="flex gap-0.5 text-[10px]">
                              {effects.penLightHearts.map((heart, i) => (
                                <span key={i} className={getHeartColorClass(heart.color)}>
                                  {'♥'.repeat(heart.count)}
                                </span>
                              ))}
                              {effects.drawBonus > 0 && (
                                <span className="text-cyan-400">📄+{effects.drawBonus}</span>
                              )}
                            </div>
                            <div className="absolute -bottom-1 left-1/2 z-10 flex -translate-x-1/2 gap-0.5 whitespace-nowrap rounded bg-[var(--bg-elevated)] px-1 py-0.5 opacity-0 shadow-[var(--shadow-md)] group-hover:opacity-100">
                              <button
                                disabled={!canMoveResolutionCardToZone || !canInspectFront}
                                onClick={() => moveToHand(id)}
                                className={cn(
                                  'text-[10px] px-1.5 py-0.5 rounded text-white',
                                  canMoveResolutionCardToZone && canInspectFront
                                    ? 'bg-cyan-600 hover:bg-cyan-500'
                                    : 'bg-slate-600 cursor-not-allowed'
                                )}
                              >
                                手牌
                              </button>
                              <button
                                disabled={!canMoveResolutionCardToZone || !canInspectFront}
                                onClick={() => moveToWaitingRoom(id)}
                                className={cn(
                                  'text-[10px] px-1.5 py-0.5 rounded text-white',
                                  canMoveResolutionCardToZone && canInspectFront
                                    ? 'bg-slate-600 hover:bg-slate-500'
                                    : 'bg-slate-600 cursor-not-allowed'
                                )}
                              >
                                弃置
                              </button>
                              <button
                                disabled={!canMoveResolutionCardToZone || !canInspectFront}
                                onClick={() => returnToDeckTop(id)}
                                className={cn(
                                  'text-[10px] px-1.5 py-0.5 rounded text-white',
                                  canMoveResolutionCardToZone && canInspectFront
                                    ? 'bg-amber-600 hover:bg-amber-500'
                                    : 'bg-slate-600 cursor-not-allowed'
                                )}
                              >
                                放回
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </SortableContext>
                )}
              </div>
      </div>

            {/* ======== 下方：Live 判定区 ======== */}
      <div className="border-t border-[var(--border-subtle)] pt-3">
              <div className="mb-3 rounded-lg border border-[var(--border-default)] bg-[color:color-mix(in_srgb,var(--bg-overlay)_54%,transparent)] p-3">
                <div className="mb-2 flex items-center gap-2 text-sm font-medium text-[var(--text-primary)]">
                  <BarChart3 size={15} className="text-[var(--accent-primary)]" />
                  Live 所有心 (总计: {totalHeartsCount})
                </div>
                <div className="flex flex-wrap gap-2">
                  {Array.from(totalHearts.entries()).map(([color, count]) => {
                    if (count === 0) return null;
                    const memberCount = memberHearts.get(color) ?? 0;
                    const bladeCount = bladeHearts.get(color) ?? 0;
                    const config = heartColorConfig[color];
                    return (
                      <div key={color} className="flex items-center gap-1 rounded bg-[color:color-mix(in_srgb,var(--bg-surface)_82%,transparent)] px-2 py-1">
                        <Heart className={cn('h-4 w-4', config.colorClass, config.fill)} />
                        <span className="font-bold text-[var(--text-primary)]">{count}</span>
                        {bladeCount > 0 && (
                          <span className="text-[10px] text-[var(--accent-secondary)]">
                            ({memberCount}+{bladeCount})
                          </span>
                        )}
                      </div>
                    );
                  })}
                  {totalDrawBonus > 0 && (
                    <div className="flex items-center gap-1 px-2 py-1 bg-slate-700/50 rounded">
                      <span className="text-sm text-cyan-400">📄 +{totalDrawBonus}</span>
                    </div>
                  )}
                </div>
                <div className="mt-1.5 flex items-center gap-1 text-[10px] text-[var(--text-muted)]">
                  <Heart className="w-3 h-3 text-pink-400 fill-pink-400 inline" /> All 心可视为任意颜色
                  {cheerCards.length > 0 && ' · 括号内为 (成员心 + 光棒心)'}
                </div>
              </div>

              <div className="space-y-2">
                <div className="text-sm font-medium text-[var(--text-primary)]">Live 卡判定结果</div>
                {liveCardIds.map((cardId) => {
                  const frontInfo = getCardFrontInfo(cardId);
                  if (!frontInfo || frontInfo.cardType !== 'LIVE') {
                    return (
                      <LiveCardJudgmentRow
                        key={cardId}
                        cardName="里侧 Live"
                        requiredHearts={[]}
                      />
                    );
                  }
                  const liveData = {
                    name: frontInfo.name,
                    requirements: frontInfo.requiredHearts,
                  } as Pick<LiveCardData, 'name' | 'requirements'>;
                  const requiredHearts = getHeartRequirementEntries(
                    liveData.requirements?.colorRequirements
                  ).map(([color, count]) => ({ color, count }));
                  return (
                    <LiveCardJudgmentRow
                      key={cardId}
                      cardName={liveData.name}
                      requiredHearts={requiredHearts}
                    />
                  );
                })}
              </div>

              <div className="mt-3 rounded-lg border border-[color:color-mix(in_srgb,var(--accent-secondary)_35%,transparent)] bg-[color:color-mix(in_srgb,var(--accent-secondary)_12%,transparent)] p-2">
                <div className="space-y-0.5 text-[10px] text-[var(--accent-secondary)]">
                  {isPerformanceJudgment && uiStage === 'judge' ? (
                    <>
                      <div>💡 选择「LIVE失败」会立即结束当前判定，且本次无 Live 分数</div>
                      <div>💡 选择「LIVE成功」后先进入成功效果发动窗口</div>
                    </>
                  ) : isResultScoreConfirm ? (
                    <>
                      <div>💡 分数最终确认已移到页面中央确认框</div>
                      <div>💡 双方确认后将判定胜者，并进入胜者动画与 Live 结算</div>
                    </>
                  ) : isResultAnimation ? (
                    <>
                      <div>💡 当前正在播放本轮 Live 胜者动画</div>
                      <div>💡 动画结束后会进入成功 Live 结算阶段</div>
                    </>
                  ) : isResultSettlement ? (
                    <>
                      <div>💡 当前为成功 Live 结算阶段</div>
                      <div>💡 胜者需要将 1 张 Live 拖入成功 Live 区后确认结算</div>
                    </>
                  ) : isLiveSuccessWindow ? (
                    <>
                      <div>💡 当前为 Live 成功效果发动窗口</div>
                      <div>💡 发动完成后点击下方「成功效果发动完毕」</div>
                    </>
                  ) : (
                    <>
                      <div>💡 当前为辅助查看窗口，可随时操作判定区卡牌</div>
                    </>
                  )}
                  <div>🎤 上方应援区可翻开卡组顶牌，悬停卡牌显示操作菜单</div>
                  {isLiveSuccessWindow && (
                    <div>🪄 当前窗口可继续发动 Live 成功效果，同时仍可操作主桌面的手牌/卡组/休息室</div>
                  )}
                </div>
              </div>
      </div>

            {/* ======== 底部按钮 ======== */}
      {isPerformanceJudgment ? (
        uiStage === 'judge' ? (
          <div className="mt-4 flex gap-3 border-t border-[var(--border-subtle)] pt-3">
            <button
              onClick={handleLiveFailed}
              disabled={!canConfirmPerformanceOutcome}
              className={cn(
                canConfirmPerformanceOutcome
                  ? 'button-secondary flex-1 py-2 rounded-lg text-sm font-bold'
                  : 'flex-1 py-2 rounded-lg text-sm font-bold bg-[var(--bg-overlay)] text-[var(--text-muted)] cursor-not-allowed'
              )}
            >
              LIVE失败
            </button>
            <button
              onClick={handleLiveSuccess}
              disabled={!canConfirmPerformanceOutcome}
              className={cn(
                canConfirmPerformanceOutcome
                  ? 'button-gold flex-1 py-2 rounded-lg text-sm font-bold'
                  : 'flex-1 py-2 rounded-lg text-sm font-bold bg-[var(--bg-overlay)] text-[var(--text-muted)] cursor-not-allowed'
              )}
            >
              LIVE成功
            </button>
          </div>
        ) : (
          <div className="mt-4 border-t border-[var(--border-subtle)] pt-3">
            <button
              onClick={handleFinishPerformanceSuccess}
              disabled={!canConfirmPerformanceOutcome}
              className={cn(
                canConfirmPerformanceOutcome
                  ? 'button-primary inline-flex w-full items-center justify-center gap-2 py-2 rounded-lg text-sm font-bold'
                  : 'inline-flex w-full items-center justify-center gap-2 py-2 rounded-lg text-sm font-bold bg-[var(--bg-overlay)] text-[var(--text-muted)] cursor-not-allowed'
              )}
            >
              <Sparkles size={16} />
              成功效果发动完毕
            </button>
          </div>
        )
      ) : isLiveSuccessWindow ? (
        <div className="mt-4 border-t border-[var(--border-subtle)] pt-3">
          <button
            onClick={handleSuccessEffectsDone}
            disabled={!canConfirmStep}
            className={cn(
              canConfirmStep
                ? 'button-primary inline-flex w-full items-center justify-center gap-2 py-2 rounded-lg text-sm font-bold'
                : 'inline-flex w-full items-center justify-center gap-2 py-2 rounded-lg text-sm font-bold bg-[var(--bg-overlay)] text-[var(--text-muted)] cursor-not-allowed'
            )}
          >
            <Sparkles size={16} />
            成功效果发动完毕
          </button>
        </div>
      ) : (
        <div className="mt-4 border-t border-[var(--border-subtle)] pt-3 text-xs text-[var(--text-secondary)]">
          当前不在 Live 判定确认子阶段，本面板保持为辅助操作窗口。
        </div>
      )}
      </div>
    </motion.aside>
  );
});

export default JudgmentPanel;
