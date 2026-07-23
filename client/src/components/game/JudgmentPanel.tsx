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

import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { motion } from 'framer-motion';
import { BarChart3, ChevronLeft, Mic } from 'lucide-react';
import { SortableContext, horizontalListSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { GameCommandType } from '@game/application/game-commands';
import { useShallow } from 'zustand/react/shallow';
import { cn } from '@/lib/utils';
import { getCardLocalizedInfo } from '@/lib/cardLocalization';
import {
  buildLiveJudgmentPreview,
  getAdjustedLiveRequirements,
  getRequirementEntriesForDisplay,
  type HeartRequirementDisplayEntry,
  type LiveJudgmentPreviewStatus,
} from '@/lib/liveJudgmentPreview';
import {
  HEART_ICON_SOURCE_BY_COLOR,
  HEART_REQUIREMENT_ICON_SOURCE_BY_COLOR,
} from '@/lib/modifierIconAssets';
import {
  buildBattleActionIntents,
  findEnabledBattleActionTargetByTargetId,
} from '@/lib/battleActionIntent';
import { executeBattleActionPayload } from '@/lib/battleActionExecutor';
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
import type { BladeHearts, MemberCardData, LiveCardData } from '@game/domain/entities/card';
import type { LiveResultViewState, Seat } from '@game/online';

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

function applyCheerHeartColorReplacement(
  bladeHearts: BladeHearts | undefined,
  replacement: LiveResultViewState['cheerHeartColorReplacements'][Seat] | null
): BladeHearts | undefined {
  if (!bladeHearts || !replacement) {
    return bladeHearts;
  }

  const fromColors = new Set(replacement.fromColors);
  return bladeHearts.map((item) =>
    item.effect === BladeHeartEffect.HEART &&
    item.heartColor !== undefined &&
    fromColors.has(item.heartColor)
      ? { ...item, heartColor: replacement.toColor }
      : item
  );
}

function HeartIconValue({
  color,
  count,
  iconClassName,
  iconSrc,
}: {
  color: HeartColor;
  count: number;
  iconClassName?: string;
  iconSrc?: string;
}) {
  return (
    <span className="inline-flex items-center gap-0.5">
      <img
        src={iconSrc ?? HEART_ICON_SOURCE_BY_COLOR[color]}
        alt=""
        className={cn('h-4 w-4 object-contain', iconClassName)}
        draggable={false}
      />
      <span className="text-xs font-bold text-[var(--text-primary)]">{count}</span>
    </span>
  );
}

function getPublicObjectId(cardId: string): string {
  return cardId.startsWith('obj_') ? cardId : `obj_${cardId}`;
}

const JUDGMENT_INFO_BLOCK_CLASS =
  'rounded-lg border border-[var(--border-default)] bg-[color:color-mix(in_srgb,var(--bg-overlay)_54%,transparent)] p-3';
const JUDGMENT_CHIP_CLASS =
  'inline-flex min-h-7 items-center gap-1 rounded bg-[color:color-mix(in_srgb,var(--bg-surface)_82%,transparent)] px-2 py-1 text-xs';
const JUDGMENT_DRAW_CHIP_CLASS = 'text-[var(--semantic-info)]';

const HEART_LABEL_BY_COLOR: Record<HeartColor, string> = {
  [HeartColor.PINK]: '粉',
  [HeartColor.RED]: '红',
  [HeartColor.YELLOW]: '黄',
  [HeartColor.GREEN]: '绿',
  [HeartColor.BLUE]: '蓝',
  [HeartColor.PURPLE]: '紫',
  [HeartColor.GRAY]: '无色',
  [HeartColor.RAINBOW]: 'All',
};

function getHeartRequirementLabel(color: HeartColor): string {
  return color === HeartColor.RAINBOW || color === HeartColor.GRAY
    ? '无色'
    : HEART_LABEL_BY_COLOR[color];
}

function getPreviewStatusLabel(status: LiveJudgmentPreviewStatus): string {
  switch (status) {
    case 'SUCCESS':
      return '判定成功';
    case 'FAILURE':
      return '判定失败';
    case 'WAITING_LIVE':
      return '等待 LIVE';
    case 'UNKNOWN':
      return '无法预览';
  }
}

function getPreviewStatusClass(status: LiveJudgmentPreviewStatus): string {
  switch (status) {
    case 'SUCCESS':
      return 'border-[color:color-mix(in_srgb,var(--semantic-success)_42%,transparent)] bg-[color:color-mix(in_srgb,var(--semantic-success)_13%,transparent)] text-[var(--semantic-success)]';
    case 'FAILURE':
      return 'border-[color:color-mix(in_srgb,var(--semantic-error)_58%,transparent)] bg-[color:color-mix(in_srgb,var(--semantic-error)_16%,transparent)] text-[var(--semantic-error)] ring-1 ring-[color:color-mix(in_srgb,var(--semantic-error)_24%,transparent)]';
    case 'WAITING_LIVE':
      return 'border-[var(--border-subtle)] bg-[color:color-mix(in_srgb,var(--bg-surface)_74%,transparent)] text-[var(--text-secondary)]';
    case 'UNKNOWN':
      return 'border-[color:color-mix(in_srgb,var(--semantic-warning)_42%,transparent)] bg-[color:color-mix(in_srgb,var(--semantic-warning)_13%,transparent)] text-[var(--semantic-warning)]';
  }
}

function getJudgmentPanelHint({
  isPerformanceJudgment,
  isResultScoreConfirm,
  isResultAnimation,
  isResultSettlement,
  isLiveSuccessWindow,
}: {
  isPerformanceJudgment: boolean;
  isResultScoreConfirm: boolean;
  isResultAnimation: boolean;
  isResultSettlement: boolean;
  isLiveSuccessWindow: boolean;
}): string {
  if (isPerformanceJudgment) {
    return '可调整判定区卡牌后接受自动判定。';
  }
  if (isResultScoreConfirm) {
    return '分数最终确认在中央弹窗处理。';
  }
  if (isResultAnimation) {
    return '当前正在播放本轮 Live 胜者动画。';
  }
  if (isResultSettlement) {
    return '成功 Live 结算在中央弹窗处理。';
  }
  if (isLiveSuccessWindow) {
    return '可继续查看和操作判定区卡牌。';
  }
  return '当前面板可用于查看和操作判定区卡牌。';
}

// ============================================
// 子组件
// ============================================

function JudgmentInfoBlock({
  title,
  badge,
  children,
  className,
}: {
  title: string;
  badge?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn(JUDGMENT_INFO_BLOCK_CLASS, className)}>
      <div className="mb-2 flex min-w-0 items-center justify-between gap-2">
        <div className="min-w-0 text-sm font-medium text-[var(--text-primary)]">{title}</div>
        {badge ? (
          <div className="shrink-0 text-[11px] text-[var(--text-secondary)]">{badge}</div>
        ) : null}
      </div>
      {children}
    </section>
  );
}

function HeartRequirementIcons({
  entries,
  emptyText = '无需求',
  iconClassName = 'h-3.5 w-3.5',
}: {
  entries: readonly HeartRequirementDisplayEntry[];
  emptyText?: string;
  iconClassName?: string;
}) {
  if (entries.length === 0) {
    return <span className="text-[10px] text-[var(--text-muted)]">{emptyText}</span>;
  }

  return (
    <>
      {entries.map((req) => (
        <span
          key={req.color}
          className="inline-flex items-center gap-0.5"
          title={`${getHeartRequirementLabel(req.color)}需求 ${req.count}`}
          aria-label={`${getHeartRequirementLabel(req.color)}需求 ${req.count}`}
        >
          <img
            src={HEART_REQUIREMENT_ICON_SOURCE_BY_COLOR[req.color]}
            alt=""
            className={cn('object-contain', iconClassName)}
            draggable={false}
          />
          <span className="text-[10px] font-bold text-[var(--text-primary)]">{req.count}</span>
        </span>
      ))}
    </>
  );
}

function RequirementDeficitBadge({
  entries,
}: {
  entries: readonly HeartRequirementDisplayEntry[];
}) {
  return (
    <span className="inline-flex items-center gap-1">
      <span>还差</span>
      {entries.map((entry) => (
        <span
          key={entry.color}
          className="inline-flex items-center gap-0.5 rounded bg-[color:color-mix(in_srgb,var(--bg-surface)_72%,transparent)] px-1 py-0.5"
          title={`${getHeartRequirementLabel(entry.color)}需求还差 ${entry.count}`}
          aria-label={`${getHeartRequirementLabel(entry.color)}需求还差 ${entry.count}`}
        >
          <img
            src={HEART_REQUIREMENT_ICON_SOURCE_BY_COLOR[entry.color]}
            alt=""
            className="h-3 w-3 object-contain"
            draggable={false}
          />
          <span className="font-bold text-[var(--text-primary)]">{entry.count}</span>
        </span>
      ))}
    </span>
  );
}

function LiveRequirementCard({
  card,
  enableHover,
}: {
  card: {
    readonly cardId: string;
    readonly cardName: string | null;
    readonly imagePath: string | null;
    readonly isVisible: boolean;
    readonly requiredHearts: readonly HeartRequirementDisplayEntry[];
  } | null;
  enableHover: boolean;
}) {
  if (!card) {
    return <div className="min-h-[76px]" aria-hidden="true" />;
  }

  const canShowFront = card.isVisible && card.imagePath !== null;
  const imagePath = canShowFront ? card.imagePath! : '/back.jpg';

  return (
    <div className="min-w-0">
      <CardDetailPressTarget
        cardId={canShowFront ? card.cardId : null}
        disabled={!canShowFront}
        enableHover={enableHover}
        title={canShowFront ? (card.cardName ?? undefined) : undefined}
        className="mx-auto block w-full max-w-[96px]"
      >
        <div className="relative mx-auto flex h-[56px] w-full max-w-[96px] items-center justify-center overflow-visible rounded-md border border-[color:color-mix(in_srgb,var(--border-subtle)_72%,transparent)] bg-[color:color-mix(in_srgb,var(--bg-overlay)_42%,transparent)] shadow-sm">
          <div className="h-[82px] w-[58px] -rotate-90 overflow-hidden rounded-md">
            <img
              src={imagePath}
              alt={canShowFront ? (card.cardName ?? '') : ''}
              className="h-full w-full object-cover"
              draggable={false}
            />
          </div>
        </div>
      </CardDetailPressTarget>
      <div className="mt-1 flex min-h-[18px] flex-wrap items-center justify-center gap-0.5 text-center">
        {canShowFront ? (
          <HeartRequirementIcons entries={card.requiredHearts} iconClassName="h-3 w-3" />
        ) : (
          <span className="text-[10px] text-[var(--text-muted)]">需求不可见</span>
        )}
      </div>
    </div>
  );
}

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
  const style: CSSProperties = {
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
  const getCardViewObject = useGameStore((s) => s.getCardViewObject);
  const getCardFrontInfo = useGameStore((s) => s.getCardFrontInfo);
  const getPlayerIdentityForSeat = useGameStore((s) => s.getPlayerIdentityForSeat);
  const getSeatZone = useGameStore((s) => s.getSeatZone);
  const getSeatZoneCardIds = useGameStore((s) => s.getSeatZoneCardIds);
  const getSeatMemberSlotCardId = useGameStore((s) => s.getSeatMemberSlotCardId);
  const selectedCardId = useGameStore((s) => s.ui.selectedCardId);
  const battleSurface = useGameStore((s) => s.getBattleSurfaceCapabilities().surface);
  const isReadOnly = useGameStore((s) => s.getBattleSurfaceCapabilities().isReadOnly);
  const liveHeartBonuses = useGameStore((s) => {
    const active = s.getActiveSeatView();
    return active ? (s.playerViewState?.match.liveResult?.heartBonuses[active] ?? []) : [];
  });
  const cheerHeartColorReplacement = useGameStore((s) => {
    const active = s.getActiveSeatView();
    return active
      ? (s.playerViewState?.match.liveResult?.cheerHeartColorReplacements?.[active] ?? null)
      : null;
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
  const isMobilePanel = useMediaQuery('(max-width: 767px)');
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
        isReadOnly,
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
      const effects = calculateCheerEffects(
        applyCheerHeartColorReplacement(
          frontInfo.bladeHearts as BladeHearts | undefined,
          cheerHeartColorReplacement
        )
      );
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
  }, [
    activeSeat,
    getCardFrontInfo,
    getSeatMemberSlotCardId,
    cheerCards,
    cheerHeartColorReplacement,
    liveHeartBonuses,
  ]);

  // 光棒心抽卡加成和分数加成（包括应援牌和 Live 区的 Live 卡）
  const { totalDrawBonus, totalCheerScoreBonus } = useMemo(() => {
    let drawBonus = 0;
    let scoreBonus = 0;

    // 从应援牌获取
    for (const { frontInfo } of cheerCards) {
      if (!frontInfo) {
        continue;
      }
      const effects = calculateCheerEffects(
        applyCheerHeartColorReplacement(
          frontInfo.bladeHearts as BladeHearts | undefined,
          cheerHeartColorReplacement
        )
      );
      drawBonus += effects.drawBonus;
      scoreBonus += effects.scoreBonus;
    }

    return { totalDrawBonus: drawBonus, totalCheerScoreBonus: scoreBonus };
  }, [cheerCards, cheerHeartColorReplacement]);

  const liveJudgmentPreview = useMemo(() => {
    const rows = liveCardIds.map((cardId) => {
      const viewObject = getCardViewObject(cardId);
      const frontInfo = viewObject?.surface === 'FRONT' ? getCardFrontInfo(cardId) : null;
      if (!frontInfo || frontInfo.cardType !== CardType.LIVE) {
        return {
          cardId,
          cardName: null as string | null,
          imagePath: null as string | null,
          isVisible: false,
          score: 0,
          requiredHearts: [] as HeartRequirementDisplayEntry[],
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
      const requiredHearts = getRequirementEntriesForDisplay(adjustedRequirements);
      const scoreModifier =
        liveCardScoreModifiers[cardId] ?? liveCardScoreModifiers[getPublicObjectId(cardId)] ?? 0;

      return {
        cardId,
        cardName: getCardLocalizedInfo(frontInfo).title,
        imagePath: getCardImagePath(frontInfo.cardCode),
        isVisible: true,
        score: Math.max(0, (frontInfo.score ?? 0) + scoreModifier),
        requiredHearts,
        adjustedRequirements,
      };
    });

    const totalLiveScoreModifier = activeSeat ? (liveScoreModifiers[activeSeat] ?? 0) : 0;
    const preview = buildLiveJudgmentPreview({
      liveCards: rows.map((row) => ({
        cardId: row.cardId,
        adjustedRequirements: row.adjustedRequirements,
        score: row.score,
      })),
      hearts: totalHearts,
      drawBonus: totalDrawBonus,
      cheerScoreBonus: totalCheerScoreBonus,
      effectScoreBonus: totalLiveScoreModifier,
    });

    return {
      rows,
      ...preview,
    };
  }, [
    activeSeat,
    getCardImagePath,
    getCardFrontInfo,
    getCardViewObject,
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
  const hasJudgmentResources = totalHeartsCount > 0 || totalDrawBonus > 0;
  const requirementSummary: ReactNode =
    liveJudgmentPreview.status === 'WAITING_LIVE' ? (
      '当前没有 LIVE 卡'
    ) : liveJudgmentPreview.status === 'UNKNOWN' ? (
      '完整需求不可见'
    ) : liveJudgmentPreview.requirementDeficit &&
      liveJudgmentPreview.requirementDeficit.length > 0 ? (
      <RequirementDeficitBadge entries={liveJudgmentPreview.requirementDeficit} />
    ) : (
      '需求满足'
    );
  const previewStatusLabel = getPreviewStatusLabel(liveJudgmentPreview.status);
  const previewScoreText =
    liveJudgmentPreview.totalScore === null ? '--' : String(liveJudgmentPreview.totalScore);
  const judgmentPanelHint = getJudgmentPanelHint({
    isPerformanceJudgment,
    isResultScoreConfirm,
    isResultAnimation,
    isResultSettlement,
    isLiveSuccessWindow,
  });

  return (
    <motion.aside
      className="safe-bottom safe-top pointer-events-auto fixed inset-0 z-[var(--z-battle-modal)] h-[var(--battle-viewport-height)] w-full max-w-none overflow-hidden border-[var(--border-default)] bg-[var(--bg-frosted)] p-3 shadow-[var(--shadow-lg)] backdrop-blur-xl md:left-0 md:top-0 md:h-full md:max-w-[420px] md:overflow-visible md:border-r md:p-4"
      role="dialog"
      aria-modal={isMobilePanel}
      aria-label="判定区"
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

          <div className={cn('flex gap-2 mb-2', isReadOnly && 'hidden')}>
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

          <div className={cn('mb-2 grid grid-cols-3 gap-2', isReadOnly && 'hidden')}>
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
                      ? calculateCheerEffects(
                          applyCheerHeartColorReplacement(
                            frontInfo.bladeHearts as BladeHearts | undefined,
                            cheerHeartColorReplacement
                          )
                        )
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
                            disabled={isReadOnly || !canMoveResolutionCardToZone}
                            selected={!isReadOnly && selectedCardId === id}
                            onClick={() => {
                              if (!isReadOnly) toggleSelectedResolutionCard(id);
                            }}
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
                        <div
                          className={cn(
                            'absolute -bottom-1 left-1/2 z-10 flex -translate-x-1/2 gap-0.5 whitespace-nowrap rounded bg-[var(--bg-elevated)] px-1 py-0.5 opacity-0 shadow-[var(--shadow-md)] group-hover:opacity-100',
                            isReadOnly && 'hidden'
                          )}
                        >
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
          <div className="space-y-3">
            <JudgmentInfoBlock
              title="判定 Heart"
              badge={<span>成员心 + 判心 · 总计 {totalHeartsCount}</span>}
            >
              {hasJudgmentResources ? (
                <div className="flex flex-wrap gap-2">
                  {Array.from(totalHearts.entries()).map(([color, count]) => {
                    if (count === 0) return null;
                    const memberCount = memberHearts.get(color) ?? 0;
                    const bladeCount = bladeHearts.get(color) ?? 0;
                    const sourceLabel = `成员 ${memberCount} / 判心 ${bladeCount}`;
                    const isRainbow = color === HeartColor.RAINBOW;
                    return (
                      <div
                        key={color}
                        className={JUDGMENT_CHIP_CLASS}
                        title={
                          isRainbow ? `All Heart，可作为任意颜色使用；${sourceLabel}` : sourceLabel
                        }
                        aria-label={`${HEART_LABEL_BY_COLOR[color]} Heart ${count}，${sourceLabel}`}
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
                            成员 {memberCount} / 判心 {bladeCount}
                          </span>
                        )}
                      </div>
                    );
                  })}
                  {totalDrawBonus > 0 && (
                    <div className={cn(JUDGMENT_CHIP_CLASS, JUDGMENT_DRAW_CHIP_CLASS)}>
                      <span className="font-semibold">抽卡 +{totalDrawBonus}</span>
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-xs text-[var(--text-muted)]">当前没有可用于判定的 Heart。</div>
              )}
            </JudgmentInfoBlock>

            <JudgmentInfoBlock title="LIVE 需求" badge={requirementSummary}>
              <div className="grid grid-cols-3 gap-1.5">
                {[0, 1, 2].map((slot) => (
                  <LiveRequirementCard
                    key={slot}
                    card={liveJudgmentPreview.rows[slot] ?? null}
                    enableHover={shouldUseHoverPreview}
                  />
                ))}
              </div>
            </JudgmentInfoBlock>

            <JudgmentInfoBlock title="接受后预计" className="p-2.5">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <div
                  className={cn(
                    'inline-flex min-h-7 items-center rounded border px-2.5 py-1 font-bold',
                    getPreviewStatusClass(liveJudgmentPreview.status)
                  )}
                >
                  {previewStatusLabel}
                </div>
                <div className={cn(JUDGMENT_CHIP_CLASS, JUDGMENT_DRAW_CHIP_CLASS)}>
                  <span className="text-[var(--text-muted)]">抽卡</span>
                  <span className="font-bold">+{liveJudgmentPreview.drawBonus}</span>
                </div>
                <div className={cn(JUDGMENT_CHIP_CLASS, 'text-[var(--accent-gold)]')}>
                  <span className="text-[var(--text-muted)]">分数</span>
                  <span className="font-bold">{previewScoreText}</span>
                </div>
                {(liveJudgmentPreview.cheerScoreBonus > 0 ||
                  liveJudgmentPreview.effectScoreBonus > 0) && (
                  <div className="inline-flex min-h-7 items-center rounded bg-[color:color-mix(in_srgb,var(--bg-surface)_72%,transparent)] px-2 py-1 text-[10px] text-[var(--text-secondary)]">
                    分数加成：
                    {liveJudgmentPreview.cheerScoreBonus > 0 &&
                      ` 应援音符 +${liveJudgmentPreview.cheerScoreBonus}`}
                    {liveJudgmentPreview.effectScoreBonus > 0 &&
                      ` 卡牌效果 +${liveJudgmentPreview.effectScoreBonus}`}
                  </div>
                )}
              </div>
            </JudgmentInfoBlock>

            <JudgmentInfoBlock title="提示">
              <div className="text-[11px] leading-relaxed text-[var(--text-secondary)]">
                {judgmentPanelHint}
              </div>
            </JudgmentInfoBlock>
          </div>
        </div>

        {/* ======== 底部按钮 ======== */}
        {isPerformanceJudgment ? (
          <div
            className={cn(
              'mt-4 space-y-2 border-t border-[var(--border-subtle)] pt-3',
              isReadOnly && 'hidden'
            )}
          >
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
          <div
            className={cn(
              'mt-4 border-t border-[var(--border-subtle)] pt-3 text-xs text-[var(--text-secondary)]',
              isReadOnly && 'hidden'
            )}
          >
            当前不在 Live 判定确认子阶段，本面板保持为辅助操作窗口。
          </div>
        )}
      </div>
    </motion.aside>
  );
});

export default JudgmentPanel;
