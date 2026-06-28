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

import { memo, useCallback, useEffect, useMemo, useRef } from 'react';
import { motion } from 'framer-motion';
import { BarChart3, ChevronLeft, Mic } from 'lucide-react';
import { SortableContext, horizontalListSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { GameCommandType } from '@game/application/game-commands';
import { applyHeartRequirementModifiers } from '@game/domain/rules/live-requirement-modifiers';
import { useShallow } from 'zustand/react/shallow';
import { cn } from '@/lib/utils';
import { getCardLocalizedInfo } from '@/lib/cardLocalization';
import { HEART_ICON_SOURCE_BY_COLOR } from '@/lib/modifierIconAssets';
import {
  buildBattleActionIntents,
  findEnabledBattleActionTargetByTargetId,
} from '@/lib/battleActionIntent';
import { executeBattleActionPayload } from '@/lib/battleActionExecutor';
import { getHeartRequirementEntries } from '@/lib/heartRequirementUtils';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import {
  SubPhase,
  HeartColor,
  ZoneType,
  BladeHeartEffect,
  SlotPosition,
  CardType,
} from '@game/shared/types/enums';
import { isSuccessEffectSubPhase } from '@game/shared/phase-config';
import { useGameStore } from '@/store/gameStore';
import { DroppableZone } from './interaction';
import { CardDetailPressTarget } from './CardDetailPressTarget';
import type {
  BladeHearts,
  HeartRequirement,
  MemberCardData,
  LiveCardData,
} from '@game/domain/entities/card';

interface JudgmentPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

// ============================================
// 工具函数
// ============================================

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

function HeartIconValue({
  color,
  count,
  iconClassName,
}: {
  color: HeartColor;
  count: number;
  iconClassName?: string;
}) {
  return (
    <span className="inline-flex items-center gap-0.5">
      <img
        src={HEART_ICON_SOURCE_BY_COLOR[color]}
        alt=""
        className={cn('h-4 w-4 object-contain', iconClassName)}
        draggable={false}
      />
      <span className="text-xs font-bold text-[var(--text-primary)]">{count}</span>
    </span>
  );
}

function cloneHeartCounts(source: Map<HeartColor, number>): Map<HeartColor, number> {
  const result = new Map<HeartColor, number>();
  Object.values(HeartColor).forEach((color) => {
    result.set(color, source.get(color) ?? 0);
  });
  return result;
}

function getRequirementTotal(
  requirements: unknown,
  entries: { color: HeartColor; count: number }[]
): number {
  const totalRequired =
    typeof requirements === 'object' &&
    requirements !== null &&
    'totalRequired' in requirements &&
    typeof (requirements as { totalRequired?: unknown }).totalRequired === 'number'
      ? (requirements as { totalRequired: number }).totalRequired
      : null;

  return totalRequired ?? entries.reduce((total, req) => total + req.count, 0);
}

function judgeLiveWithHeartCounts(
  hearts: Map<HeartColor, number>,
  requirements: unknown
): { success: boolean; remaining: Map<HeartColor, number> } {
  const remaining = cloneHeartCounts(hearts);
  const colorRequirements = (requirements as { colorRequirements?: unknown } | undefined)
    ?.colorRequirements as Parameters<typeof getHeartRequirementEntries>[0];
  const requiredHearts = getHeartRequirementEntries(colorRequirements).map(([color, count]) => ({
    color,
    count,
  }));
  const totalRequired = getRequirementTotal(requirements, requiredHearts);
  let rainbowAvailable = remaining.get(HeartColor.RAINBOW) ?? 0;
  let consumedCount = 0;

  for (const req of requiredHearts) {
    if (req.color === HeartColor.RAINBOW) {
      continue;
    }

    const available = remaining.get(req.color) ?? 0;
    const normalUsed = Math.min(available, req.count);
    const rainbowUsed = req.count - normalUsed;
    if (rainbowUsed > rainbowAvailable) {
      return { success: false, remaining: hearts };
    }

    remaining.set(req.color, available - normalUsed);
    rainbowAvailable -= rainbowUsed;
    consumedCount += normalUsed + rainbowUsed;
  }

  if (consumedCount < totalRequired) {
    let genericNeeded = totalRequired - consumedCount;
    for (const color of Object.values(HeartColor)) {
      if (genericNeeded <= 0 || color === HeartColor.RAINBOW) {
        continue;
      }
      const available = remaining.get(color) ?? 0;
      const used = Math.min(available, genericNeeded);
      remaining.set(color, available - used);
      genericNeeded -= used;
    }
    const rainbowUsed = Math.min(rainbowAvailable, genericNeeded);
    rainbowAvailable -= rainbowUsed;
    genericNeeded -= rainbowUsed;
    if (genericNeeded > 0) {
      return { success: false, remaining: hearts };
    }
  }

  remaining.set(HeartColor.RAINBOW, rainbowAvailable);
  return { success: true, remaining };
}

function mergeLiveRequirementsForPreview(requirementsList: unknown[]): unknown {
  const colorRequirements = new Map<HeartColor, number>();
  let totalRequired = 0;

  for (const requirements of requirementsList) {
    const source = requirements as
      | { colorRequirements?: unknown; totalRequired?: unknown }
      | null
      | undefined;
    const entries = getHeartRequirementEntries(
      source?.colorRequirements as Parameters<typeof getHeartRequirementEntries>[0]
    );
    for (const [color, count] of entries) {
      colorRequirements.set(color, (colorRequirements.get(color) ?? 0) + count);
    }
    totalRequired += getRequirementTotal(
      requirements,
      entries.map(([color, count]) => ({ color, count }))
    );
  }

  return {
    colorRequirements,
    totalRequired,
  };
}

function getAdjustedLiveRequirements(
  requirements: unknown,
  modifiers: readonly { color: HeartColor; countDelta: number }[]
): unknown {
  if (modifiers.length === 0) {
    return requirements;
  }

  const source = requirements as
    | { colorRequirements?: unknown; totalRequired?: unknown }
    | null
    | undefined;
  const colorRequirements = source?.colorRequirements as
    | Map<HeartColor, number>
    | Partial<Record<HeartColor, number>>
    | undefined;
  const entries = getHeartRequirementEntries(colorRequirements);
  const normalizedRequirement: HeartRequirement = {
    colorRequirements: new Map(entries),
    totalRequired: getRequirementTotal(
      requirements,
      entries.map(([color, count]) => ({ color, count }))
    ),
  };

  return applyHeartRequirementModifiers(normalizedRequirement, modifiers);
}

function getPublicObjectId(cardId: string): string {
  return cardId.startsWith('obj_') ? cardId : `obj_${cardId}`;
}

// ============================================
// 子组件
// ============================================

/** 可排序的应援卡牌 */
const SortableCheerCard = memo(function SortableCheerCard({
  cardId,
  imagePath,
  disabled = false,
  selected = false,
  onClick,
}: {
  cardId: string;
  imagePath: string;
  disabled?: boolean;
  selected?: boolean;
  onClick?: () => void;
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
      onClick={onClick}
      className={cn(
        'w-[72px] h-[100px] rounded-lg overflow-hidden shadow-md cursor-grab',
        isDragging && 'shadow-xl ring-2 ring-amber-400',
        selected && 'ring-2 ring-cyan-300 ring-offset-2 ring-offset-slate-950'
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
  score,
  success,
}: {
  cardName: string;
  requiredHearts: { color: HeartColor; count: number }[];
  score?: number;
  success?: boolean;
}) {
  return (
    <div className="flex items-center gap-3 p-2 bg-slate-800/30 rounded-lg border border-slate-700/30">
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-white truncate">{cardName}</div>
        <div className="flex gap-1 mt-0.5">
          {requiredHearts.map((req, idx) => (
            <HeartIconValue
              key={idx}
              color={req.color}
              count={req.count}
              iconClassName="h-3.5 w-3.5"
            />
          ))}
        </div>
      </div>
      {typeof success === 'boolean' && (
        <div
          className={cn(
            'shrink-0 rounded px-2 py-1 text-xs font-bold',
            success ? 'bg-emerald-500/15 text-emerald-300' : 'bg-rose-500/15 text-rose-300'
          )}
        >
          {success ? `成功｜分数 ${score ?? 0}` : '失败'}
        </div>
      )}
    </div>
  );
});

// ============================================
// 主组件
// ============================================

export const JudgmentPanel = memo(function JudgmentPanel({ isOpen, onClose }: JudgmentPanelProps) {
  const activeSeat = useGameStore((s) => s.getActiveSeatView());
  const currentSubPhase = useGameStore((s) => s.getCurrentSubPhaseView()) ?? SubPhase.NONE;
  const canRevealCheerCard = useGameStore((s) => s.canUseAction(GameCommandType.REVEAL_CHEER_CARD));
  const canMoveResolutionCardToZone = useGameStore((s) =>
    s.canUseAction(GameCommandType.MOVE_RESOLUTION_CARD_TO_ZONE)
  );
  const canConfirmPerformanceOutcome = useGameStore((s) =>
    s.canUseAction(GameCommandType.CONFIRM_PERFORMANCE_OUTCOME)
  );
  const canSubmitJudgment = useGameStore((s) => s.canUseAction(GameCommandType.SUBMIT_JUDGMENT));
  const getCardFrontInfo = useGameStore((s) => s.getCardFrontInfo);
  const getPlayerIdentityForSeat = useGameStore((s) => s.getPlayerIdentityForSeat);
  const getSeatZone = useGameStore((s) => s.getSeatZone);
  const getSeatZoneCardIds = useGameStore((s) => s.getSeatZoneCardIds);
  const getSeatMemberSlotCardId = useGameStore((s) => s.getSeatMemberSlotCardId);
  const selectedCardId = useGameStore((s) => s.ui.selectedCardId);
  const battleSurface = useGameStore((s) => s.getBattleSurfaceCapabilities().surface);
  const liveHeartBonuses = useGameStore((s) => {
    const active = s.getActiveSeatView();
    return active ? (s.playerViewState?.match.liveResult?.heartBonuses[active] ?? []) : [];
  });
  const liveRequirementReductions = useGameStore(
    (s) => s.playerViewState?.match.liveResult?.requirementReductions ?? {}
  );
  const liveRequirementModifiers = useGameStore(
    (s) => s.playerViewState?.match.liveResult?.requirementModifiers ?? {}
  );
  const liveScoreModifiers = useGameStore(
    (s) => s.playerViewState?.match.liveResult?.scoreModifiers ?? { FIRST: 0, SECOND: 0 }
  );
  const liveCardScoreModifiers = useGameStore(
    (s) => s.playerViewState?.match.liveResult?.liveCardScoreModifiers ?? {}
  );
  const shouldUseHoverPreview = useMediaQuery('(min-width: 1024px)');
  const {
    acceptAutomaticJudgment,
    confirmPerformanceOutcome,
    getCardImagePath,
    moveResolutionCardToZone,
    revealCheerCard,
    selectCard,
    setHoveredCard,
  } = useGameStore(
    useShallow((s) => ({
      acceptAutomaticJudgment: s.acceptAutomaticJudgment,
      confirmPerformanceOutcome: s.confirmPerformanceOutcome,
      getCardImagePath: s.getCardImagePath,
      moveResolutionCardToZone: s.moveResolutionCardToZone,
      revealCheerCard: s.revealCheerCard,
      selectCard: s.selectCard,
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
  const selectedResolutionCardId =
    selectedCardId && cheerCardIds.includes(selectedCardId) ? selectedCardId : null;
  const selectedResolutionCardFrontInfo = selectedResolutionCardId
    ? (getCardFrontInfo(selectedResolutionCardId) ?? null)
    : null;
  const resolutionActionIntents = selectedResolutionCardId
    ? buildBattleActionIntents({
        sourceCardId: selectedResolutionCardId,
        sourceZone: ZoneType.RESOLUTION_ZONE,
        sourceCardType: selectedResolutionCardFrontInfo?.cardType ?? CardType.MEMBER,
        currentPhase: null,
        currentSubPhase,
        actorSeat: activeSeat,
        viewerSeat: activeSeat,
        sourceSeat: activeSeat,
        surface: battleSurface,
        isReadOnly: false,
        availableCommandTypes: canMoveResolutionCardToZone
          ? [GameCommandType.MOVE_RESOLUTION_CARD_TO_ZONE]
          : [],
        memberSlots: [],
      })
    : [];
  const resolutionTargetById = (targetId: string) =>
    findEnabledBattleActionTargetByTargetId(resolutionActionIntents, targetId);
  const resolutionHandTarget = resolutionTargetById('resolution-target-hand');
  const resolutionWaitingRoomTarget = resolutionTargetById('resolution-target-waiting-room');
  const resolutionMainDeckTopTarget = resolutionTargetById('resolution-target-main-deck-top');

  const closeAfterRemoteAdvanceRef = useRef(false);

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

  const toggleSelectedResolutionCard = useCallback(
    (cardId: string) => {
      selectCard(selectedCardId === cardId ? null : cardId);
    },
    [selectCard, selectedCardId]
  );

  const executeResolutionTarget = useCallback(
    (target: ReturnType<typeof findEnabledBattleActionTargetByTargetId>) => {
      const payload = target?.target.commandPayload;
      if (!payload) {
        return;
      }
      executeBattleActionPayload(payload, { moveResolutionCardToZone });
    },
    [moveResolutionCardToZone]
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
    Object.values(HeartColor).forEach((c) => {
      members.set(c, 0);
      blades.set(c, 0);
    });

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
    for (const heart of liveHeartBonuses) {
      blades.set(heart.color, (blades.get(heart.color) ?? 0) + heart.count);
    }

    // 合计
    const total = new Map<HeartColor, number>();
    Object.values(HeartColor).forEach((c) => {
      total.set(c, (members.get(c) ?? 0) + (blades.get(c) ?? 0));
    });

    return { memberHearts: members, bladeHearts: blades, totalHearts: total };
  }, [activeSeat, getCardFrontInfo, getSeatMemberSlotCardId, cheerCards, liveHeartBonuses]);

  // 光棒心抽卡加成和分数加成（包括应援牌和 Live 区的 Live 卡）
  const { totalDrawBonus, totalCheerScoreBonus } = useMemo(() => {
    let drawBonus = 0;
    let scoreBonus = 0;

    // 从应援牌获取
    for (const { frontInfo } of cheerCards) {
      if (!frontInfo) {
        continue;
      }
      const effects = calculateCheerEffects(frontInfo.bladeHearts as BladeHearts | undefined);
      drawBonus += effects.drawBonus;
      scoreBonus += effects.scoreBonus;
    }

    return { totalDrawBonus: drawBonus, totalCheerScoreBonus: scoreBonus };
  }, [cheerCards]);

  const liveJudgmentPreview = useMemo(() => {
    const rows = liveCardIds.map((cardId) => {
      const frontInfo = getCardFrontInfo(cardId);
      if (!frontInfo || frontInfo.cardType !== 'LIVE') {
        return {
          cardId,
          cardName: '里侧 Live',
          score: 0,
          success: false,
          requiredHearts: [] as { color: HeartColor; count: number }[],
          adjustedRequirements: null as unknown,
        };
      }

      const requirementModifiers =
        liveRequirementModifiers[cardId] ?? liveRequirementModifiers[getPublicObjectId(cardId)];
      const requirementReduction =
        liveRequirementReductions[cardId] ?? liveRequirementReductions[getPublicObjectId(cardId)];
      const adjustedRequirementModifiers =
        requirementModifiers ??
        ((requirementReduction ?? 0) > 0
          ? [{ color: HeartColor.RAINBOW, countDelta: -(requirementReduction ?? 0) }]
          : []);
      const adjustedRequirements = getAdjustedLiveRequirements(
        frontInfo.requiredHearts,
        adjustedRequirementModifiers
      );
      const colorRequirements = (
        adjustedRequirements as { colorRequirements?: unknown } | undefined
      )?.colorRequirements as Parameters<typeof getHeartRequirementEntries>[0];
      const requiredHearts = getHeartRequirementEntries(colorRequirements).map(
        ([color, count]) => ({ color, count })
      );
      const scoreModifier =
        liveCardScoreModifiers[cardId] ?? liveCardScoreModifiers[getPublicObjectId(cardId)] ?? 0;

      return {
        cardId,
        cardName: getCardLocalizedInfo(frontInfo).title,
        score: Math.max(0, (frontInfo.score ?? 0) + scoreModifier),
        success: false,
        requiredHearts,
        adjustedRequirements,
      };
    });

    const totalLiveScoreModifier = activeSeat ? (liveScoreModifiers[activeSeat] ?? 0) : 0;
    const faceUpLiveRows = rows.filter((row) => row.adjustedRequirements !== null);
    const mergedRequirements = mergeLiveRequirementsForPreview(
      faceUpLiveRows.map((row) => row.adjustedRequirements)
    );
    const isOverallSuccess =
      faceUpLiveRows.length > 0 &&
      judgeLiveWithHeartCounts(totalHearts, mergedRequirements).success;
    const displayRows = isOverallSuccess
      ? rows
          .filter((row) => row.adjustedRequirements !== null)
          .map((row) => ({
            ...row,
            success: true,
          }))
      : rows.map((row) => ({
          ...row,
          success: false,
        }));
    const liveScore = isOverallSuccess
      ? faceUpLiveRows.reduce((total, row) => total + row.score, 0)
      : 0;
    const totalScore = isOverallSuccess
      ? liveScore + totalCheerScoreBonus + totalLiveScoreModifier
      : 0;

    return {
      rows: displayRows,
      successCount: isOverallSuccess ? rows.length : 0,
      failureCount: isOverallSuccess ? 0 : rows.length,
      drawBonus: totalDrawBonus,
      cheerScoreBonus: isOverallSuccess ? totalCheerScoreBonus : 0,
      effectScoreBonus: isOverallSuccess ? totalLiveScoreModifier : 0,
      totalScore,
    };
  }, [
    activeSeat,
    getCardFrontInfo,
    liveCardIds,
    liveRequirementModifiers,
    liveRequirementReductions,
    liveScoreModifiers,
    liveCardScoreModifiers,
    totalCheerScoreBonus,
    totalDrawBonus,
    totalHearts,
  ]);

  const isPerformanceJudgment = currentSubPhase === SubPhase.PERFORMANCE_JUDGMENT;
  const isLiveSuccessWindow = isSuccessEffectSubPhase(currentSubPhase);
  const isResultScoreConfirm = currentSubPhase === SubPhase.RESULT_SCORE_CONFIRM;
  const isResultAnimation = currentSubPhase === SubPhase.RESULT_ANIMATION;
  const isResultSettlement = currentSubPhase === SubPhase.RESULT_SETTLEMENT;
  // ---- 判定操作 ----

  const handleAcceptAutoJudgment = useCallback(() => {
    if (!currentPlayer || !canSubmitJudgment) return;
    const judgmentResult = acceptAutomaticJudgment();
    if (judgmentResult.pending) {
      closeAfterRemoteAdvanceRef.current = true;
      return;
    }
    if (!judgmentResult.success) {
      return;
    }
    onClose();
  }, [acceptAutomaticJudgment, canSubmitJudgment, currentPlayer, onClose]);

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
      className="safe-bottom safe-top fixed inset-0 z-[90] h-dvh w-full max-w-none overflow-hidden border-[var(--border-default)] bg-[var(--bg-frosted)] p-3 shadow-[var(--shadow-lg)] backdrop-blur-xl md:left-0 md:top-0 md:h-full md:max-w-[420px] md:overflow-visible md:border-r md:p-4"
      initial={{ x: -460, opacity: 0.8 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: -460, opacity: 0.8 }}
      transition={{ type: 'spring', stiffness: 320, damping: 30 }}
    >
      <button
        type="button"
        onClick={onClose}
        className="absolute right-3 top-3 z-10 flex h-9 w-9 items-center justify-center rounded-xl border border-[var(--border-default)] bg-[color:color-mix(in_srgb,var(--bg-frosted)_94%,transparent)] text-[var(--accent-primary)] shadow-[var(--shadow-md)] backdrop-blur-xl transition-all hover:text-[var(--text-primary)] md:-right-8 md:top-1/2 md:h-16 md:w-8 md:-translate-y-1/2 md:rounded-r-2xl md:border-l-0 md:hover:w-9"
        aria-label="收起判定区"
        title="收起判定区"
      >
        <ChevronLeft size={16} />
      </button>

      <div className="mb-3 flex items-start justify-between border-b border-[var(--border-default)] pb-2 pr-11 md:pr-0">
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

      <div className="cute-scrollbar touch-scroll h-[calc(100%-4rem)] overflow-y-auto pr-1">
        <div className="mb-4">
          <div className="mb-2 flex items-center justify-between border-b border-[color:color-mix(in_srgb,var(--accent-secondary)_35%,transparent)] pb-2">
            <span className="flex items-center gap-2 text-sm font-medium text-[var(--accent-secondary)]">
              <Mic size={15} />
              {currentPlayer.name} 的应援 ({cheerCards.length} 张)
            </span>
            <span className="text-xs text-[var(--text-muted)]">主卡组剩余: {mainDeckCount}</span>
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
              title={resolutionHandTarget?.target.label ?? '加入手牌'}
              onClick={() => executeResolutionTarget(resolutionHandTarget)}
              className={cn(
                'rounded-lg border border-[var(--border-default)] bg-[color:color-mix(in_srgb,var(--bg-overlay)_44%,transparent)] px-3 py-2 text-center text-[11px] font-medium text-[var(--text-secondary)]',
                resolutionHandTarget &&
                  'cursor-pointer border-cyan-300 bg-cyan-500/15 text-cyan-50 shadow-[0_0_14px_rgba(34,211,238,0.24)]'
              )}
              activeClassName="outline outline-2 outline-cyan-400 bg-cyan-500/15"
            >
              {resolutionHandTarget ? resolutionHandTarget.target.label : '拖到这里回手'}
            </DroppableZone>
            <DroppableZone
              id="resolution-target-waiting-room"
              disabled={!canMoveResolutionCardToZone}
              title={resolutionWaitingRoomTarget?.target.label ?? '放入休息室'}
              onClick={() => executeResolutionTarget(resolutionWaitingRoomTarget)}
              className={cn(
                'rounded-lg border border-[var(--border-default)] bg-[color:color-mix(in_srgb,var(--bg-overlay)_44%,transparent)] px-3 py-2 text-center text-[11px] font-medium text-[var(--text-secondary)]',
                resolutionWaitingRoomTarget &&
                  'cursor-pointer border-slate-200 bg-slate-500/15 text-slate-50 shadow-[0_0_14px_rgba(226,232,240,0.18)]'
              )}
              activeClassName="outline outline-2 outline-slate-300 bg-slate-500/15"
            >
              {resolutionWaitingRoomTarget
                ? resolutionWaitingRoomTarget.target.label
                : '拖到这里弃置'}
            </DroppableZone>
            <DroppableZone
              id="resolution-target-main-deck-top"
              disabled={!canMoveResolutionCardToZone}
              title={resolutionMainDeckTopTarget?.target.label ?? '回卡组顶'}
              onClick={() => executeResolutionTarget(resolutionMainDeckTopTarget)}
              className={cn(
                'rounded-lg border border-[var(--border-default)] bg-[color:color-mix(in_srgb,var(--bg-overlay)_44%,transparent)] px-3 py-2 text-center text-[11px] font-medium text-[var(--text-secondary)]',
                resolutionMainDeckTopTarget &&
                  'cursor-pointer border-amber-300 bg-amber-500/15 text-amber-50 shadow-[0_0_14px_rgba(251,191,36,0.22)]'
              )}
              activeClassName="outline outline-2 outline-amber-400 bg-amber-500/15"
            >
              {resolutionMainDeckTopTarget
                ? resolutionMainDeckTopTarget.target.label
                : '拖到这里回卡组顶'}
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
                    const effects = frontInfo
                      ? calculateCheerEffects(frontInfo.bladeHearts as BladeHearts | undefined)
                      : {
                          penLightHearts: [],
                          drawBonus: 0,
                          scoreBonus: 0,
                        };
                    const canInspectFront = viewObject?.surface === 'FRONT' && frontInfo !== null;
                    return (
                      <CardDetailPressTarget
                        key={id}
                        cardId={canInspectFront ? id : null}
                        disabled={!canInspectFront}
                        className="relative group flex flex-col items-center gap-0.5"
                        enableHover={shouldUseHoverPreview}
                      >
                        {canInspectFront && frontInfo ? (
                          <SortableCheerCard
                            cardId={id}
                            imagePath={getCardImagePath(frontInfo.cardCode)}
                            disabled={!canMoveResolutionCardToZone}
                            selected={selectedCardId === id}
                            onClick={() => toggleSelectedResolutionCard(id)}
                          />
                        ) : (
                          <div className="h-[100px] w-[72px] overflow-hidden rounded-lg shadow-md">
                            <img
                              src="/back.jpg"
                              alt=""
                              className="h-full w-full object-cover"
                              draggable={false}
                            />
                          </div>
                        )}
                        <div className="flex gap-0.5 text-[10px]">
                          {effects.penLightHearts.map((heart, i) => (
                            <HeartIconValue
                              key={i}
                              color={heart.color}
                              count={heart.count}
                              iconClassName="h-3.5 w-3.5"
                            />
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
                      </CardDetailPressTarget>
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
                return (
                  <div
                    key={color}
                    className="flex items-center gap-1 rounded bg-[color:color-mix(in_srgb,var(--bg-surface)_82%,transparent)] px-2 py-1"
                  >
                    <img
                      src={HEART_ICON_SOURCE_BY_COLOR[color]}
                      alt=""
                      className="h-4 w-4 object-contain"
                      draggable={false}
                    />
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
              <img
                src={HEART_ICON_SOURCE_BY_COLOR[HeartColor.RAINBOW]}
                alt=""
                className="h-3 w-3 object-contain"
                draggable={false}
              />
              All 心可视为任意颜色
              {cheerCards.length > 0 && ' · 括号内为 (成员心 + 光棒心)'}
            </div>
          </div>

          <div className="space-y-2">
            <div className="text-sm font-medium text-[var(--text-primary)]">Live 卡判定结果</div>
            {liveJudgmentPreview.rows.map((row) => {
              return (
                <LiveCardJudgmentRow
                  key={row.cardId}
                  cardName={row.cardName}
                  requiredHearts={row.requiredHearts}
                  score={row.score}
                  success={row.success}
                />
              );
            })}
          </div>

          <div className="mt-3 rounded-lg border border-[color:color-mix(in_srgb,var(--accent-primary)_32%,transparent)] bg-[color:color-mix(in_srgb,var(--accent-primary)_10%,transparent)] p-3">
            <div className="mb-2 flex items-center gap-2 text-sm font-medium text-[var(--text-primary)]">
              <BarChart3 size={15} className="text-[var(--accent-primary)]" />
              接受后预计结果
            </div>
            <div className="grid grid-cols-3 gap-2 text-center text-xs">
              <div className="rounded bg-[var(--bg-overlay)] px-2 py-2">
                <div className="text-[var(--text-muted)]">Live</div>
                <div className="font-bold text-[var(--text-primary)]">
                  {liveJudgmentPreview.successCount} 成功 / {liveJudgmentPreview.failureCount} 失败
                </div>
              </div>
              <div className="rounded bg-[var(--bg-overlay)] px-2 py-2">
                <div className="text-[var(--text-muted)]">抽卡</div>
                <div className="font-bold text-cyan-300">+{liveJudgmentPreview.drawBonus}</div>
              </div>
              <div className="rounded bg-[var(--bg-overlay)] px-2 py-2">
                <div className="text-[var(--text-muted)]">分数</div>
                <div className="font-bold text-amber-300">{liveJudgmentPreview.totalScore}</div>
              </div>
            </div>
            {(liveJudgmentPreview.cheerScoreBonus > 0 ||
              liveJudgmentPreview.effectScoreBonus > 0) && (
              <div className="mt-2 text-[10px] text-[var(--text-secondary)]">
                分数加成：
                {liveJudgmentPreview.cheerScoreBonus > 0 &&
                  ` 应援音符 +${liveJudgmentPreview.cheerScoreBonus}`}
                {liveJudgmentPreview.effectScoreBonus > 0 &&
                  ` 卡牌效果 +${liveJudgmentPreview.effectScoreBonus}`}
              </div>
            )}
          </div>

          <div className="mt-3 rounded-lg border border-[color:color-mix(in_srgb,var(--accent-secondary)_35%,transparent)] bg-[color:color-mix(in_srgb,var(--accent-secondary)_12%,transparent)] p-2">
            <div className="space-y-0.5 text-[10px] text-[var(--accent-secondary)]">
              {isPerformanceJudgment ? (
                <>
                  <div>💡 系统已按当前光棒数翻开推荐应援牌，可先手动调整判定区</div>
                  <div>💡 选择「接受自动判定」后，会按当前判定区计算成功、抽卡与分数草案</div>
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
                  <div>💡 胜者请在弹窗中选择成功 Live</div>
                </>
              ) : isLiveSuccessWindow ? (
                <>
                  <div>💡 当前为 Live 成功效果发动窗口</div>
                  <div>💡 本窗口仅用于查看和操作判定区卡牌</div>
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
          <div className="mt-4 space-y-2 border-t border-[var(--border-subtle)] pt-3">
            <button
              onClick={handleAcceptAutoJudgment}
              disabled={!canSubmitJudgment}
              className={cn(
                canSubmitJudgment
                  ? 'button-gold w-full rounded-lg py-2 text-sm font-bold'
                  : 'w-full rounded-lg bg-[var(--bg-overlay)] py-2 text-sm font-bold text-[var(--text-muted)] cursor-not-allowed'
              )}
            >
              接受自动判定
            </button>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={handleLiveFailed}
                disabled={!canConfirmPerformanceOutcome}
                className={cn(
                  canConfirmPerformanceOutcome
                    ? 'button-secondary rounded-lg py-1.5 text-xs font-bold'
                    : 'rounded-lg bg-[var(--bg-overlay)] py-1.5 text-xs font-bold text-[var(--text-muted)] cursor-not-allowed'
                )}
              >
                强制失败
              </button>
              <button
                onClick={handleLiveSuccess}
                disabled={!canConfirmPerformanceOutcome}
                className={cn(
                  canConfirmPerformanceOutcome
                    ? 'button-secondary rounded-lg py-1.5 text-xs font-bold'
                    : 'rounded-lg bg-[var(--bg-overlay)] py-1.5 text-xs font-bold text-[var(--text-muted)] cursor-not-allowed'
                )}
              >
                强制成功
              </button>
            </div>
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
