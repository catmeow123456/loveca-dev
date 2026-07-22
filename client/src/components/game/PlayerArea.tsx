/**
 * 玩家区域组件
 * 显示成员槽位、能量区、卡组、手牌、成功 Live 区、Live 区等
 *
 * 布局说明（中心对称）：
 * - 己方 (底部): 左边=成功Live区, 中间=[L成员][C成员][R成员]+Live区, 右边=资源区(卡组+能量)
 * - 对手 (顶部): 左边=资源区(卡组+能量), 中间=[R成员][C成员][L成员]+Live区, 右边=成功Live区
 *   （对手区域镜像显示：成员槽位顺序反转，左右侧组件位置交换）
 *
 * 中心对称原理：
 * - 成员区域的 LEFT/CENTER/RIGHT 是相对于每个玩家自身视角定义的
 * - 双方玩家面对面坐着，卡组和能量区都在各自的右手边（画布左右两侧）
 * - 己方的 LEFT 成员对应对手视角的 RIGHT 成员，反之亦然
 * - 资源区和成功Live区在画布上呈现镜像对称
 */

import { memo, useEffect, useRef, useState, type MouseEvent } from 'react';
import { SortableContext, horizontalListSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { motion, useReducedMotion } from 'framer-motion';
import { createPortal } from 'react-dom';
import { useShallow } from 'zustand/react/shallow';
import { cn } from '@/lib/utils';
import {
  buildBattleActionIntents,
  findEnabledBattleActionTargetByTargetId,
  findEnabledBattleActionSlotTarget,
  findEnabledBattleActionZoneTarget,
  type BattleActionTarget,
} from '@/lib/battleActionIntent';
import { executeBattleActionPayload } from '@/lib/battleActionExecutor';
import {
  getCardEffectVisualState,
  type CardEffectVisualState,
} from '@/lib/cardEffectAutomationVisuals';
import { getHeartRequirementEntries } from '@/lib/heartRequirementUtils';
import { getCardLocalizedInfo } from '@/lib/cardLocalization';
import { HEART_REQUIREMENT_ICON_SOURCE_BY_COLOR } from '@/lib/modifierIconAssets';
import {
  collectWaitingRoomJudgmentStats,
  hasWaitingRoomJudgmentStats,
} from '@/lib/waitingRoomJudgmentStats';
import { createScopedZoneId, createZoneId } from '@/lib/zoneUtils';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { useGameStore } from '@/store/gameStore';
import { GameCommandType } from '@game/application/game-commands';
import { isOwnDeskFreeDragWindow } from '@game/application/command-availability';
import {
  CardAbilitySourceZone,
  getActivatedAbilityUiConfigs,
  type ActivatedAbilityUiConfig,
} from '@game/application/card-effect-runner';
import { Card } from '@/components/card/Card';
import { CardEffectText } from '@/components/card/CardEffectText';
import { CardModifierBadgeStack } from '@/components/card/CardModifierBadgeStack';
import { CardDetailPressTarget } from './CardDetailPressTarget';
import { DraggableCard, DroppableZone } from './interaction';
import {
  WaitingRoomJudgmentStatsDetail,
  WaitingRoomJudgmentSummaryChips,
} from './WaitingRoomJudgmentStats';
import {
  ArrowDownToLine,
  ArrowUpToLine,
  BarChart3,
  Check,
  Hand,
  Layers3,
  Megaphone,
  Trash2,
  X,
} from 'lucide-react';
import type { AnyCardData, LiveCardData } from '@game/domain/entities/card';
import { isLiveCardData } from '@game/domain/entities/card';
import {
  SlotPosition,
  OrientationState,
  HeartColor,
  ZoneType,
  SubPhase,
} from '@game/shared/types/enums';
import type { Seat } from '@game/online';

interface PlayerAreaProps {
  playerSeat: Seat;
  isOpponent: boolean;
  isActive: boolean;
  suppressActiveEffectVisuals?: boolean;
}

const INSPECTION_TARGET_IDS = {
  hand: 'inspection-target-hand',
  waitingRoom: 'inspection-target-waiting-room',
  mainDeckTop: 'inspection-target-main-deck-top',
  mainDeckBottom: 'inspection-target-main-deck-bottom',
  blocker: 'inspection-target-blocker',
} as const;
const DISABLE_ORDINARY_DROP_FROM_INSPECTION = [ZoneType.INSPECTION_ZONE] as const;

const ActivatedAbilityMenu = memo(function ActivatedAbilityMenu({
  configs,
  onActivate,
  placement = 'above',
}: {
  readonly configs: readonly ActivatedAbilityUiConfig[];
  readonly onActivate: (config: ActivatedAbilityUiConfig) => void;
  readonly placement?: 'above' | 'below';
}) {
  const anchorRef = useRef<HTMLSpanElement>(null);
  const [layout, setLayout] = useState<{
    readonly left: number;
    readonly top: number;
    readonly width: number;
    readonly maxHeight: number;
  } | null>(null);

  useEffect(() => {
    if (configs.length === 0) {
      setLayout(null);
      return;
    }

    const updateLayout = () => {
      const anchor = anchorRef.current;
      if (!anchor) return;
      const rect = anchor.getBoundingClientRect();
      const viewportPadding = 8;
      const gap = 4;
      const width = Math.max(1, Math.min(420, window.innerWidth - viewportPadding * 2));
      const unclampedCenter = rect.left + rect.width / 2;
      const left = Math.min(
        window.innerWidth - viewportPadding - width / 2,
        Math.max(viewportPadding + width / 2, unclampedCenter)
      );
      const top = placement === 'above' ? rect.top - gap : rect.bottom + gap;
      const maxHeight = Math.max(
        1,
        placement === 'above' ? top - viewportPadding : window.innerHeight - top - viewportPadding
      );
      setLayout((current) =>
        current &&
        current.left === left &&
        current.top === top &&
        current.width === width &&
        current.maxHeight === maxHeight
          ? current
          : { left, top, width, maxHeight }
      );
    };

    updateLayout();
    const animationTrackingDeadline = window.performance.now() + 1_000;
    let animationFrameId = window.requestAnimationFrame(function trackAnimatedLayout(timestamp) {
      updateLayout();
      if (timestamp < animationTrackingDeadline) {
        animationFrameId = window.requestAnimationFrame(trackAnimatedLayout);
      }
    });
    window.addEventListener('resize', updateLayout);
    window.addEventListener('scroll', updateLayout, true);
    const resizeObserver =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(updateLayout);
    if (anchorRef.current) resizeObserver?.observe(anchorRef.current);
    return () => {
      window.cancelAnimationFrame(animationFrameId);
      window.removeEventListener('resize', updateLayout);
      window.removeEventListener('scroll', updateLayout, true);
      resizeObserver?.disconnect();
    };
  }, [configs.length, placement]);

  if (configs.length === 0) return null;
  return (
    <>
      <span ref={anchorRef} className="pointer-events-none absolute inset-0" aria-hidden="true" />
      {layout &&
        createPortal(
          <div
            data-battle-animation-ignore="true"
            className="fixed z-[140] flex flex-col gap-1 overflow-y-auto overscroll-contain"
            style={{
              left: layout.left,
              top: layout.top,
              width: layout.width,
              maxHeight: layout.maxHeight,
              transform: placement === 'above' ? 'translate(-50%, -100%)' : 'translate(-50%, 0)',
            }}
          >
            {configs.map((config) => (
              <button
                key={config.abilityId}
                type="button"
                className={cn(
                  'w-full shrink-0 rounded-lg border border-rose-300/70 bg-white/95 px-3 py-1.5 text-left font-semibold text-rose-600 shadow-lg',
                  'transition-colors hover:bg-rose-50 active:scale-[0.99]'
                )}
                style={{ fontSize: '12px', lineHeight: 1.25 }}
                onClick={(event) => {
                  event.stopPropagation();
                  onActivate(config);
                }}
                title={config.title}
              >
                <CardEffectText as="span" text={config.text} />
              </button>
            ))}
          </div>,
          document.body
        )}
    </>
  );
});

const SortableInspectionCard = memo(function SortableInspectionCard({
  cardId,
  imagePath,
  className,
  containerClassName,
  disabled = false,
  showActions = false,
  canReveal = false,
  isRevealed = false,
  revealIndex = 0,
  onReveal,
  onClick,
  onMouseEnter,
  onMouseLeave,
}: {
  cardId: string;
  imagePath: string;
  className?: string;
  containerClassName?: string;
  disabled?: boolean;
  showActions?: boolean;
  canReveal?: boolean;
  isRevealed?: boolean;
  revealIndex?: number;
  onReveal?: (cardId: string) => void;
  onClick?: () => void;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
}) {
  const reduceMotion = useReducedMotion();
  const { attributes, listeners, setNodeRef, transform, isDragging } = useSortable({
    id: cardId,
    disabled,
    data: {
      cardId,
      fromZone: ZoneType.INSPECTION_ZONE,
    },
  });

  const style = {
    transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
    zIndex: isDragging ? 50 : undefined,
    touchAction: 'none',
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn('group relative flex shrink-0 flex-col items-center gap-1', containerClassName)}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <motion.div
        className="flex flex-col items-center gap-1"
        initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 7, scale: 0.965 }}
        animate={reduceMotion ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 }}
        transition={{
          duration: reduceMotion ? 0.08 : 0.18,
          delay: reduceMotion ? 0 : Math.min(revealIndex * 0.035, 0.14),
          ease: [0.22, 1, 0.36, 1],
        }}
      >
        <div
          {...attributes}
          {...listeners}
          data-card-id={cardId}
          data-object-id={`obj_${cardId}`}
          onClick={onClick}
          className={cn(
            'h-[84px] w-[60px] touch-none select-none overflow-hidden rounded-lg border border-[var(--border-default)] bg-[var(--bg-overlay)] shadow-[var(--shadow-md)] sm:h-[96px] sm:w-[68px]',
            disabled ? 'cursor-default' : 'cursor-grab active:cursor-grabbing',
            isDragging && 'ring-2 ring-amber-400 shadow-[var(--shadow-lg)]',
            className
          )}
        >
          <img src={imagePath} alt="" className="h-full w-full object-cover" draggable={false} />
        </div>
        {showActions ? (
          <div className="flex flex-wrap justify-center gap-1 opacity-100 transition-opacity md:opacity-0 md:group-hover:opacity-100">
            <button
              type="button"
              disabled={!canReveal || isRevealed}
              onClick={() => onReveal?.(cardId)}
              className={cn(
                'rounded px-1.5 py-0.5 text-[10px] font-medium text-white',
                canReveal && !isRevealed
                  ? 'bg-emerald-600 hover:bg-emerald-500'
                  : 'cursor-not-allowed bg-slate-600'
              )}
              title="公开给对手"
            >
              <span className="inline-flex items-center gap-1">
                <Megaphone size={10} />
                公开
              </span>
            </button>
          </div>
        ) : null}
      </motion.div>
    </div>
  );
});

export const PlayerArea = memo(function PlayerArea({
  playerSeat,
  isOpponent,
  isActive,
  suppressActiveEffectVisuals = false,
}: PlayerAreaProps) {
  const playerIdentity = useGameStore((s) => s.getPlayerIdentityForSeat(playerSeat));
  const viewerSeat = useGameStore((s) => s.getViewerSeat());
  const matchView = useGameStore((s) => s.getMatchView());
  const hasOwnedInspectionContext = useGameStore((s) => s.isInspectionOpenForViewer());
  const currentPhase = useGameStore((s) => s.getCurrentPhaseView());
  const currentSubPhase = useGameStore((s) => s.getCurrentSubPhaseView()) ?? SubPhase.NONE;
  const isMobileBoard = useMediaQuery('(max-width: 767px)');
  const reduceMotion = useReducedMotion();
  const activeEffect = useGameStore((s) => s.playerViewState?.activeEffect ?? null);
  const battleAnimationOcclusions = useGameStore((s) => s.ui.battleAnimationOcclusions);

  // UI 状态选择器（使用 useShallow 合并多个属性）
  const { selectedCardId } = useGameStore(
    useShallow((s) => ({
      selectedCardId: s.ui.selectedCardId,
    }))
  );
  const isDragging = useGameStore((s) => s.ui.isDragging);
  const capabilities = useGameStore(useShallow((s) => s.getBattleSurfaceCapabilities()));
  const isReadOnly = capabilities.isReadOnly;
  const canOpenInspection = useGameStore((s) => s.canUseAction(GameCommandType.OPEN_INSPECTION));
  const canRevealInspectedCard = useGameStore((s) =>
    s.canUseAction(GameCommandType.REVEAL_INSPECTED_CARD)
  );
  const canMoveInspectedToTop = useGameStore((s) =>
    s.canUseAction(GameCommandType.MOVE_INSPECTED_CARD_TO_TOP)
  );
  const canMoveInspectedToBottom = useGameStore((s) =>
    s.canUseAction(GameCommandType.MOVE_INSPECTED_CARD_TO_BOTTOM)
  );
  const canMoveInspectedToZone = useGameStore((s) =>
    s.canUseAction(GameCommandType.MOVE_INSPECTED_CARD_TO_ZONE)
  );
  const canReorderInspectedCard = useGameStore((s) =>
    s.canUseAction(GameCommandType.REORDER_INSPECTED_CARD)
  );
  const canFinishInspectionWithArrangement = useGameStore((s) =>
    s.canUseAction(GameCommandType.FINISH_INSPECTION_WITH_ARRANGEMENT)
  );
  const canMoveInspectedCardToZone = useGameStore((s) =>
    s.canUseAction(GameCommandType.MOVE_INSPECTED_CARD_TO_ZONE)
  );
  const canMoveInspectedCardToTop = useGameStore((s) =>
    s.canUseAction(GameCommandType.MOVE_INSPECTED_CARD_TO_TOP)
  );
  const canMoveInspectedCardToBottom = useGameStore((s) =>
    s.canUseAction(GameCommandType.MOVE_INSPECTED_CARD_TO_BOTTOM)
  );
  const canTapMember = useGameStore((s) => s.canUseAction(GameCommandType.TAP_MEMBER));
  const canPlayMemberToSlot = useGameStore((s) =>
    s.canUseAction(GameCommandType.PLAY_MEMBER_TO_SLOT)
  );
  const canMoveMemberToSlot = useGameStore((s) =>
    s.canUseAction(GameCommandType.MOVE_MEMBER_TO_SLOT)
  );
  const canAttachEnergyToMember = useGameStore((s) =>
    s.canUseAction(GameCommandType.ATTACH_ENERGY_TO_MEMBER)
  );
  const canSetLiveCard = useGameStore((s) => s.canUseAction(GameCommandType.SET_LIVE_CARD));
  const canMovePublicCardToHand = useGameStore((s) =>
    s.canUseAction(GameCommandType.MOVE_PUBLIC_CARD_TO_HAND)
  );
  const canMovePublicCardToWaitingRoom = useGameStore((s) =>
    s.canUseAction(GameCommandType.MOVE_PUBLIC_CARD_TO_WAITING_ROOM)
  );
  const canMovePublicCardToEnergyDeck = useGameStore((s) =>
    s.canUseAction(GameCommandType.MOVE_PUBLIC_CARD_TO_ENERGY_DECK)
  );
  const canConfirmEffectCommand = useGameStore((s) =>
    s.canUseAction(GameCommandType.CONFIRM_EFFECT_STEP)
  );
  const canActivateAbilityCommand = useGameStore((s) =>
    s.canUseAction(GameCommandType.ACTIVATE_ABILITY)
  );
  const canTapEnergy = useGameStore((s) => s.canUseAction(GameCommandType.TAP_ENERGY));
  const canDrawCardToHand = useGameStore((s) => s.canUseAction(GameCommandType.DRAW_CARD_TO_HAND));
  const canReturnHandCardToTop = useGameStore((s) =>
    s.canUseAction(GameCommandType.RETURN_HAND_CARD_TO_TOP)
  );
  const hasFinishInspectionCommand = useGameStore(
    (s) => s.getCommandHint(GameCommandType.FINISH_INSPECTION) !== null
  );

  // 方法选择器（使用 useShallow 保持引用稳定）
  const {
    getVisibleCardPresentation,
    selectCard,
    setHoveredCard,
    playMemberToSlot,
    activateCardAbility,
    moveMemberToSlot,
    attachEnergyToMember,
    setLiveCard,
    confirmEffectStep,
    movePublicCardToHand,
    movePublicCardToWaitingRoom,
    movePublicCardToEnergyDeck,
    moveInspectedCardToZone,
    moveInspectedCardToTop,
    moveInspectedCardToBottom,
    tapMember,
    tapEnergy,
    drawCardToHand,
    returnHandCardToTop,
    getCardViewObject,
    getSeatZone,
    getSeatZoneCardIds,
    getSeatMemberSlotCardId,
    getSeatMemberOverlayCardIds,
    getSeatMemberBelowCardIds,
    getLiveResultForCard,
    findViewerCardZone,
    getKnownCardType,
    getCardSlotPosition,
    openInspection,
    revealInspectedCard,
    finishInspectionWithArrangement,
    finishInspection,
    isInspectionCardPubliclyRevealed,
  } = useGameStore(
    useShallow((s) => ({
      getVisibleCardPresentation: s.getVisibleCardPresentation,
      selectCard: s.selectCard,
      setHoveredCard: s.setHoveredCard,
      playMemberToSlot: s.playMemberToSlot,
      activateCardAbility: s.activateCardAbility,
      moveMemberToSlot: s.moveMemberToSlot,
      attachEnergyToMember: s.attachEnergyToMember,
      setLiveCard: s.setLiveCard,
      confirmEffectStep: s.confirmEffectStep,
      movePublicCardToHand: s.movePublicCardToHand,
      movePublicCardToWaitingRoom: s.movePublicCardToWaitingRoom,
      movePublicCardToEnergyDeck: s.movePublicCardToEnergyDeck,
      moveInspectedCardToZone: s.moveInspectedCardToZone,
      moveInspectedCardToTop: s.moveInspectedCardToTop,
      moveInspectedCardToBottom: s.moveInspectedCardToBottom,
      tapMember: s.tapMember,
      tapEnergy: s.tapEnergy,
      drawCardToHand: s.drawCardToHand,
      returnHandCardToTop: s.returnHandCardToTop,
      getCardViewObject: s.getCardViewObject,
      getSeatZone: s.getSeatZone,
      getSeatZoneCardIds: s.getSeatZoneCardIds,
      getSeatMemberSlotCardId: s.getSeatMemberSlotCardId,
      getSeatMemberOverlayCardIds: s.getSeatMemberOverlayCardIds,
      getSeatMemberBelowCardIds: s.getSeatMemberBelowCardIds,
      getLiveResultForCard: s.getLiveResultForCard,
      findViewerCardZone: s.findViewerCardZone,
      getKnownCardType: s.getKnownCardType,
      getCardSlotPosition: s.getCardSlotPosition,
      openInspection: s.openInspection,
      revealInspectedCard: s.revealInspectedCard,
      finishInspectionWithArrangement: s.finishInspectionWithArrangement,
      finishInspection: s.finishInspection,
      isInspectionCardPubliclyRevealed: s.isInspectionCardPubliclyRevealed,
    }))
  );
  const [waitingRoomExpanded, setWaitingRoomExpanded] = useState(false);
  const [waitingRoomStatsExpanded, setWaitingRoomStatsExpanded] = useState(false);
  const [waitingRoomStatsHover, setWaitingRoomStatsHover] = useState(false);
  const [inspectionBatchAction, setInspectionBatchAction] = useState<
    'waiting-room' | 'close' | null
  >(null);
  const [isReturningHandCardToTop, setIsReturningHandCardToTop] = useState(false);
  const returningHandCardToTopRef = useRef(false);
  const returningHandCardToTopTimeoutRef = useRef<number | null>(null);

  const handZoneView = getSeatZone(playerSeat, 'HAND');
  const mainDeckZoneView = getSeatZone(playerSeat, 'MAIN_DECK');
  const energyDeckZoneView = getSeatZone(playerSeat, 'ENERGY_DECK');
  const energyZoneView = getSeatZone(playerSeat, 'ENERGY_ZONE');
  const liveZoneView = getSeatZone(playerSeat, 'LIVE_ZONE');
  const waitingRoomZoneView = getSeatZone(playerSeat, 'WAITING_ROOM');
  const inspectionZoneView = getSeatZone(playerSeat, 'INSPECTION_ZONE');
  const handCardIds = getSeatZoneCardIds(playerSeat, 'HAND');
  const mainDeckCardIds = getSeatZoneCardIds(playerSeat, 'MAIN_DECK');
  const energyDeckCardIds = getSeatZoneCardIds(playerSeat, 'ENERGY_DECK');
  const energyZoneCardIds = getSeatZoneCardIds(playerSeat, 'ENERGY_ZONE');
  const liveCardIds = getSeatZoneCardIds(playerSeat, 'LIVE_ZONE');
  const waitingRoomCardIds = getSeatZoneCardIds(playerSeat, 'WAITING_ROOM');
  const successCardIds = getSeatZoneCardIds(playerSeat, 'SUCCESS_ZONE');
  const inspectionCardIds = getSeatZoneCardIds(playerSeat, 'INSPECTION_ZONE');
  const handCardSignature = handCardIds.join('|');

  useEffect(() => {
    returningHandCardToTopRef.current = false;
    setIsReturningHandCardToTop(false);
    if (returningHandCardToTopTimeoutRef.current !== null) {
      window.clearTimeout(returningHandCardToTopTimeoutRef.current);
      returningHandCardToTopTimeoutRef.current = null;
    }
  }, [handCardSignature, matchView?.seq]);

  useEffect(
    () => () => {
      if (returningHandCardToTopTimeoutRef.current !== null) {
        window.clearTimeout(returningHandCardToTopTimeoutRef.current);
      }
    },
    []
  );

  if (!playerIdentity) {
    return null;
  }
  const displayedHandCount = handZoneView?.count ?? handCardIds.length;
  const closeWaitingRoom = () => {
    setWaitingRoomExpanded(false);
    setWaitingRoomStatsExpanded(false);
    setWaitingRoomStatsHover(false);
  };

  // ========================================
  // 拖拽权限控制 - RULES/FREE 操作模式
  // ========================================
  // RULES 只提交当前权限投影允许的语义化命令；FREE 保留己方桌面整理。
  // 无论 UI 是否允许拖起，权威命令政策都会重新校验模式、阶段与 pending flow。
  // ========================================

  const allowGeneralOwnZoneInteraction =
    !isReadOnly &&
    !isOpponent &&
    currentPhase !== null &&
    isOwnDeskFreeDragWindow(currentPhase, currentSubPhase);
  const allowLiveZoneDeskInteraction = !isReadOnly && !isOpponent;
  const dropScope = `seat-${playerSeat}`;
  const getDroppableId = (zoneType: ZoneType, slotPosition?: SlotPosition) =>
    createScopedZoneId(dropScope, zoneType, slotPosition);
  const inspectionSourceZone =
    matchView?.window?.windowType === 'INSPECTION'
      ? ((matchView.window.context?.sourceZone as ZoneType | undefined) ?? null)
      : null;
  const isActiveEffectInspectionWindow =
    matchView?.window?.windowType === 'INSPECTION' &&
    typeof matchView.window.context?.activeEffectId === 'string';
  const canClickMainDeck =
    !isReadOnly &&
    !isOpponent &&
    canOpenInspection &&
    !activeEffect &&
    !isActiveEffectInspectionWindow &&
    (!hasOwnedInspectionContext || inspectionSourceZone === ZoneType.MAIN_DECK);

  const canDropToLiveZone = allowGeneralOwnZoneInteraction || allowLiveZoneDeskInteraction;
  const canReceiveInspectionDrop =
    !isReadOnly && !isOpponent && hasOwnedInspectionContext && !isActiveEffectInspectionWindow;
  // 检查 Live 区是否已达上限（最多3张）
  const liveZoneIsFull = (liveZoneView?.count ?? liveCardIds.length) >= 3;

  const canDropMember = allowGeneralOwnZoneInteraction;
  const canDragInspectionCard =
    !isReadOnly &&
    !isActiveEffectInspectionWindow &&
    (canMoveInspectedToZone ||
      canMoveInspectedToTop ||
      canMoveInspectedToBottom ||
      canReorderInspectedCard);
  const visibleActiveEffect = suppressActiveEffectVisuals ? null : activeEffect;
  const activeEffectSourceCardId = visibleActiveEffect?.sourceObjectId.replace(/^obj_/, '') ?? null;
  const activeEffectSelectableCardIdSet = new Set(
    visibleActiveEffect?.selectableObjectIds?.map((objectId) => objectId.replace(/^obj_/, '')) ?? []
  );
  const activeEffectSelectableSlotSet = new Set(visibleActiveEffect?.selectableSlots ?? []);
  const battleAnimationOccludedObjectIds = new Set(
    battleAnimationOcclusions.map((occlusion) => occlusion.objectId)
  );
  const getBattleAnimationOcclusionClass = (cardId: string): string =>
    battleAnimationOccludedObjectIds.has(`obj_${cardId}`) ? 'invisible pointer-events-none' : '';
  const getActiveEffectTaskCardClass = (cardId: string): string =>
    cn(
      activeEffectSelectableCardIdSet.has(cardId) &&
        'ring-2 ring-emerald-300 ring-offset-2 ring-offset-slate-950 shadow-[0_0_18px_rgba(52,211,153,0.72)]',
      getBattleAnimationOcclusionClass(cardId)
    );
  const getEffectVisualState = (
    card: { readonly cardCode: string; readonly instanceId: string },
    options: {
      readonly faceUp?: boolean;
      readonly isActionableNow?: boolean;
    } = {}
  ): CardEffectVisualState =>
    getCardEffectVisualState({
      cardCode: card.cardCode,
      isFaceUp: options.faceUp ?? true,
      isActionableNow:
        options.isActionableNow === true || activeEffectSourceCardId === card.instanceId,
    });

  const activeEffectCanConfirmFromTable =
    !isReadOnly &&
    canConfirmEffectCommand &&
    !!visibleActiveEffect &&
    !!viewerSeat &&
    visibleActiveEffect.waitingSeat === viewerSeat;
  const toggleSelectedCard = (cardId: string) => {
    selectCard(selectedCardId === cardId ? null : cardId);
  };
  const selectedCardZone = selectedCardId ? findViewerCardZone(selectedCardId) : null;
  const selectedHandCardId =
    !isOpponent && selectedCardZone === ZoneType.HAND && selectedCardId ? selectedCardId : null;
  const selectedCardType = selectedCardId ? getKnownCardType(selectedCardId) : null;
  const selectedCardSourceSlot = selectedCardId ? getCardSlotPosition(selectedCardId) : null;
  const availableBattleActionCommandTypes: GameCommandType[] = [];
  if (canPlayMemberToSlot)
    availableBattleActionCommandTypes.push(GameCommandType.PLAY_MEMBER_TO_SLOT);
  if (canMoveMemberToSlot)
    availableBattleActionCommandTypes.push(GameCommandType.MOVE_MEMBER_TO_SLOT);
  if (canAttachEnergyToMember) {
    availableBattleActionCommandTypes.push(GameCommandType.ATTACH_ENERGY_TO_MEMBER);
  }
  if (canSetLiveCard) availableBattleActionCommandTypes.push(GameCommandType.SET_LIVE_CARD);
  if (canMovePublicCardToHand) {
    availableBattleActionCommandTypes.push(GameCommandType.MOVE_PUBLIC_CARD_TO_HAND);
  }
  if (canMovePublicCardToWaitingRoom) {
    availableBattleActionCommandTypes.push(GameCommandType.MOVE_PUBLIC_CARD_TO_WAITING_ROOM);
  }
  if (canMovePublicCardToEnergyDeck) {
    availableBattleActionCommandTypes.push(GameCommandType.MOVE_PUBLIC_CARD_TO_ENERGY_DECK);
  }
  if (canMoveInspectedCardToZone && !isActiveEffectInspectionWindow) {
    availableBattleActionCommandTypes.push(GameCommandType.MOVE_INSPECTED_CARD_TO_ZONE);
  }
  if (canMoveInspectedCardToTop && !isActiveEffectInspectionWindow) {
    availableBattleActionCommandTypes.push(GameCommandType.MOVE_INSPECTED_CARD_TO_TOP);
  }
  if (canMoveInspectedCardToBottom && !isActiveEffectInspectionWindow) {
    availableBattleActionCommandTypes.push(GameCommandType.MOVE_INSPECTED_CARD_TO_BOTTOM);
  }
  if (canConfirmEffectCommand) {
    availableBattleActionCommandTypes.push(GameCommandType.CONFIRM_EFFECT_STEP);
  }
  const memberSlotSnapshots = [
    {
      seat: playerSeat,
      slot: SlotPosition.LEFT,
      cardId: getSeatMemberSlotCardId(playerSeat, SlotPosition.LEFT),
      enteredStageThisTurn:
        getCardViewObject(getSeatMemberSlotCardId(playerSeat, SlotPosition.LEFT) ?? '')
          ?.enteredStageThisTurn === true,
    },
    {
      seat: playerSeat,
      slot: SlotPosition.CENTER,
      cardId: getSeatMemberSlotCardId(playerSeat, SlotPosition.CENTER),
      enteredStageThisTurn:
        getCardViewObject(getSeatMemberSlotCardId(playerSeat, SlotPosition.CENTER) ?? '')
          ?.enteredStageThisTurn === true,
    },
    {
      seat: playerSeat,
      slot: SlotPosition.RIGHT,
      cardId: getSeatMemberSlotCardId(playerSeat, SlotPosition.RIGHT),
      enteredStageThisTurn:
        getCardViewObject(getSeatMemberSlotCardId(playerSeat, SlotPosition.RIGHT) ?? '')
          ?.enteredStageThisTurn === true,
    },
  ] as const;
  const selectedBattleActionIntents =
    !isOpponent && viewerSeat === playerSeat && selectedCardId
      ? buildBattleActionIntents({
          sourceCardId: selectedCardId,
          sourceZone: selectedCardZone,
          sourceCardType: selectedCardType,
          sourceSlot: selectedCardSourceSlot,
          currentPhase,
          currentSubPhase,
          actorSeat: viewerSeat,
          viewerSeat,
          sourceSeat: playerSeat,
          surface: capabilities.surface,
          isReadOnly,
          availableCommandTypes: availableBattleActionCommandTypes,
          manualOperationMode: matchView?.manualOperation?.mode,
          memberSlots: memberSlotSnapshots,
          liveZoneCount: liveZoneView?.count ?? liveCardIds.length,
          activeEffect: visibleActiveEffect,
          activeEffectCanConfirm: activeEffectCanConfirmFromTable,
        })
      : [];

  const canDrawFromMainDeck =
    !isOpponent &&
    mainDeckCardIds.length > 0 &&
    allowGeneralOwnZoneInteraction &&
    canDrawCardToHand;
  const canReturnSelectedHandCard =
    !!selectedHandCardId &&
    allowGeneralOwnZoneInteraction &&
    canReturnHandCardToTop &&
    !isReturningHandCardToTop;

  const handleDrawFromMainDeck = () => {
    if (!canDrawFromMainDeck) return;
    drawCardToHand();
  };

  const handleReturnSelectedHandCard = () => {
    if (!selectedHandCardId || returningHandCardToTopRef.current || !canReturnSelectedHandCard) {
      return;
    }

    returningHandCardToTopRef.current = true;
    setIsReturningHandCardToTop(true);
    const result = returnHandCardToTop(selectedHandCardId);
    returningHandCardToTopTimeoutRef.current = window.setTimeout(() => {
      returningHandCardToTopRef.current = false;
      setIsReturningHandCardToTop(false);
      returningHandCardToTopTimeoutRef.current = null;
    }, 2000);

    if (!result.success && !result.pending) {
      returningHandCardToTopRef.current = false;
      setIsReturningHandCardToTop(false);
      if (returningHandCardToTopTimeoutRef.current !== null) {
        window.clearTimeout(returningHandCardToTopTimeoutRef.current);
        returningHandCardToTopTimeoutRef.current = null;
      }
    }
  };

  const returnSelectedHandCardTitle = selectedHandCardId
    ? canReturnSelectedHandCard
      ? '将所选手牌放回主卡组顶'
      : '当前不能放回牌库顶'
    : '先选择一张要放回牌库顶的手牌';

  const renderDrawActionButton = (placement: 'DESKTOP_DECK' | 'MOBILE_HAND') => {
    const isMobileHandAction = placement === 'MOBILE_HAND';

    return (
      <button
        type="button"
        data-main-deck-draw-action
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          handleDrawFromMainDeck();
        }}
        disabled={!canDrawFromMainDeck}
        className={cn(
          'inline-flex shrink-0 items-center justify-center rounded-md border font-semibold leading-none transition-[transform,background-color,border-color,color] duration-100 active:scale-[0.97]',
          isMobileHandAction ? 'h-7 w-10 px-1' : 'h-7 w-16 px-2',
          canDrawFromMainDeck
            ? 'border-cyan-300/45 bg-cyan-500/12 text-cyan-100 shadow-[0_0_12px_rgba(34,211,238,0.08)] hover:border-cyan-200/70 hover:bg-cyan-500/22'
            : 'cursor-not-allowed border-[var(--border-subtle)] bg-[var(--bg-overlay)] text-[var(--text-muted)] opacity-45'
        )}
        style={{ fontSize: isMobileHandAction ? '10px' : '11px' }}
        aria-label="从主卡组抽一张牌"
        title={canDrawFromMainDeck ? '抽 1 张：主卡组顶 → 手牌' : '当前不能抽牌'}
      >
        {isMobileHandAction ? '抽 1' : '抽 1 张'}
      </button>
    );
  };

  const renderReturnSelectedHandCardButton = (placement: 'DESKTOP_DECK' | 'MOBILE_HAND') => {
    const isMobileHandAction = placement === 'MOBILE_HAND';

    return (
      <button
        type="button"
        data-return-selected-hand-card
        onClick={handleReturnSelectedHandCard}
        disabled={!canReturnSelectedHandCard}
        className={cn(
          'inline-flex h-7 min-w-0 items-center justify-center rounded-md border font-semibold leading-none transition-[transform,background-color,border-color,color,opacity] duration-100 active:scale-[0.97]',
          isMobileHandAction ? 'gap-1 px-2' : 'w-16 px-1',
          canReturnSelectedHandCard
            ? 'border-amber-300/40 bg-amber-500/10 text-amber-100 hover:border-amber-200/65 hover:bg-amber-500/20'
            : 'cursor-not-allowed border-[var(--border-subtle)] bg-[var(--bg-overlay)] text-[var(--text-muted)] opacity-45'
        )}
        style={{ fontSize: isMobileHandAction ? '10px' : '9px' }}
        aria-label="将所选手牌放回牌库顶"
        title={returnSelectedHandCardTitle}
      >
        {isMobileHandAction && <ArrowUpToLine size={12} className="shrink-0" aria-hidden="true" />}
        <span className="whitespace-nowrap">
          {isMobileHandAction ? '放回卡组顶' : '放回牌库顶'}
        </span>
      </button>
    );
  };

  const executeBattleActionTarget = (target: BattleActionTarget) => {
    const payload = target.commandPayload;
    if (!payload) {
      return;
    }
    executeBattleActionPayload(payload, {
      playMemberToSlot,
      moveMemberToSlot,
      attachEnergyToMember,
      setLiveCard,
      movePublicCardToHand,
      movePublicCardToWaitingRoom,
      movePublicCardToEnergyDeck,
      moveInspectedCardToZone,
      moveInspectedCardToTop,
      moveInspectedCardToBottom,
      confirmEffectStep,
    });
  };
  const canConfirmSingleActiveEffectCardFromTable =
    activeEffectCanConfirmFromTable &&
    visibleActiveEffect?.selectableObjectMode !== 'ORDERED_MULTI';
  const confirmActiveEffectCardFromTable = (cardId: string): boolean => {
    if (
      !visibleActiveEffect ||
      !canConfirmSingleActiveEffectCardFromTable ||
      !activeEffectSelectableCardIdSet.has(cardId)
    ) {
      return false;
    }
    confirmEffectStep(visibleActiveEffect.id, cardId);
    return true;
  };

  // 渲染成员槽位 - 使用响应式尺寸
  // 能量卡重叠设计：能量卡与成员卡同等大小，向左下方偏移 10% * n 的卡牌尺寸
  const renderMemberSlot = (position: SlotPosition) => {
    const cardId = getSeatMemberSlotCardId(playerSeat, position);
    const card = cardId ? getVisibleCardPresentation(cardId) : null;
    const slotId = getDroppableId(ZoneType.MEMBER_SLOT, position);

    // 获取卡牌的方向状态
    const cardViewObject = cardId ? getCardViewObject(cardId) : null;
    const orientation = cardViewObject?.orientation ?? OrientationState.ACTIVE;

    // 规则 9.6.2.1.2.1 由后端校验（Trust the Player）；此处不在 UI 层阻断 drop，
    // 否则会连同合法的能量附加一起拦截，且无高亮反馈。
    const slotDisabled = !canDropMember;

    // 双击切换状态（活跃 ↔ 等待）
    const handleDoubleClick = () => {
      if (allowGeneralOwnZoneInteraction && canTapMember && cardId) {
        tapMember(cardId, position);
      }
    };

    // 该槽位下方的能量卡（规则 4.5.5）
    const energyBelowIds = getSeatMemberOverlayCardIds(playerSeat, position);

    // 该槽位主成员下方由卡牌效果堆叠的成员卡
    const memberBelowIds = getSeatMemberBelowCardIds(playerSeat, position);

    // 能量卡偏移量：每张能量卡向左下方偏移 10% 的卡牌尺寸
    const energyOffsetPercent = 10;

    // 堆叠成员卡偏移量：向右下方偏移
    const memberBelowOffsetPercent = 8;
    const activatedAbilityConfigs =
      cardViewObject?.activatedAbilityUiConfigs ??
      (cardViewObject?.activatedAbilityUiConfig
        ? [cardViewObject.activatedAbilityUiConfig]
        : getActivatedAbilityUiConfigs(card?.cardCode, CardAbilitySourceZone.STAGE_MEMBER));
    const canActivateAbility =
      card !== null &&
      activatedAbilityConfigs.length > 0 &&
      selectedCardId === card.instanceId &&
      !isOpponent &&
      viewerSeat === playerSeat &&
      canActivateAbilityCommand;
    const isActiveEffectSlotTarget =
      !isOpponent && viewerSeat === playerSeat && activeEffectSelectableSlotSet.has(position);
    const selectedSlotAction = findEnabledBattleActionSlotTarget(
      selectedBattleActionIntents,
      ZoneType.MEMBER_SLOT,
      position
    );
    const isBattleActionSlotTarget = selectedSlotAction !== null;
    const handleSlotClick = (event: MouseEvent<HTMLDivElement>) => {
      const targetElement = event.target instanceof HTMLElement ? event.target : null;
      const clickedCardElement = targetElement?.closest('[data-card-id]');
      if (clickedCardElement && !isActiveEffectSlotTarget && !isBattleActionSlotTarget) {
        return;
      }
      if (isActiveEffectSlotTarget && visibleActiveEffect && activeEffectCanConfirmFromTable) {
        confirmEffectStep(visibleActiveEffect.id, undefined, position);
        return;
      }
      if (selectedSlotAction) {
        executeBattleActionTarget(selectedSlotAction.target);
      }
    };

    return (
      // 外层容器：包含成员卡和重叠的能量卡
      <div key={position} className="relative flex flex-col items-center">
        {/* 卡牌堆叠容器 - 使用 relative 定位实现重叠效果 */}
        <div className="relative aspect-[5/7] w-[clamp(56px,17vw,78px)] md:w-[clamp(80px,10vw,140px)]">
          {/* 能量卡层 - 在成员卡下方（Z-index 较低） */}
          {/* 渲染顺序：从最后一张开始（最大偏移），确保第 i+1 张在第 i 张下方 */}
          {[...energyBelowIds].reverse().map((energyCardId, reverseIndex) => {
            const energyCard = getVisibleCardPresentation(energyCardId);
            const imagePath = energyCard?.imagePath ?? null;
            // 计算原始索引（reverse 前）
            const originalIndex = energyBelowIds.length - 1 - reverseIndex;
            // 偏移量：(index + 1) * 10%，因为第一张能量卡在成员卡正下方
            const offsetPercent = (originalIndex + 1) * energyOffsetPercent;

            return (
              <div
                key={energyCardId}
                className="absolute inset-0"
                style={{
                  transform: `translate(-${offsetPercent}%, ${offsetPercent}%)`,
                  // 越后渲染的在越上层，所以 reverseIndex 越大 z-index 越高
                  // 原始第1张能量卡 (originalIndex=0) 应该在最上层
                  zIndex: 5 + reverseIndex,
                }}
              >
                <DraggableCard
                  id={energyCardId}
                  disabled={!allowGeneralOwnZoneInteraction}
                  data={{
                    cardId: energyCardId,
                    cardCode: energyCard?.cardCode,
                    fromZone: ZoneType.MEMBER_SLOT,
                  }}
                >
                  <CardDetailPressTarget
                    cardId={energyCard?.instanceId ?? null}
                    disabled={!energyCard}
                    title={`附加能量 #${originalIndex + 1}（可拖走）`}
                    className={cn(
                      'w-full h-full rounded-lg overflow-hidden shadow-md cursor-grab active:cursor-grabbing',
                      isDragging
                        ? 'transition-none'
                        : 'transition-[transform,box-shadow] duration-200 hover:scale-105 hover:z-50 hover:shadow-xl',
                      'border-2 border-indigo-400/50 bg-slate-800'
                    )}
                  >
                    {imagePath ? (
                      <img src={imagePath} alt="附加能量" className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-xs text-white/70">
                        E
                      </div>
                    )}
                  </CardDetailPressTarget>
                </DraggableCard>
              </div>
            );
          })}

          {/* 堆叠成员卡层 - 在成员卡下方、能量卡上方 */}
          {/* 渲染顺序：从最后一张开始（最大偏移），确保第 i+1 张在第 i 张下方 */}
          {[...memberBelowIds].reverse().map((memberCardId, reverseIndex) => {
            const memberCard = getVisibleCardPresentation(memberCardId);
            const imagePath = memberCard?.imagePath ?? null;
            const originalIndex = memberBelowIds.length - 1 - reverseIndex;
            const offsetPercent = (originalIndex + 1) * memberBelowOffsetPercent;

            return (
              <div
                key={memberCardId}
                className="absolute inset-0"
                style={{
                  transform: `translate(${offsetPercent}%, ${offsetPercent}%)`,
                  zIndex: 5 + energyBelowIds.length + reverseIndex,
                }}
              >
                <DraggableCard
                  id={memberCardId}
                  disabled={!allowGeneralOwnZoneInteraction}
                  data={{
                    cardId: memberCardId,
                    cardCode: memberCard?.cardCode,
                    fromZone: ZoneType.MEMBER_SLOT,
                  }}
                >
                  <CardDetailPressTarget
                    cardId={memberCard?.instanceId ?? null}
                    disabled={!memberCard}
                    title={`堆叠成员 #${originalIndex + 1}（可拖走）`}
                    className={cn(
                      'w-full h-full rounded-lg overflow-hidden shadow-md cursor-grab active:cursor-grabbing',
                      isDragging
                        ? 'transition-none'
                        : 'transition-[transform,box-shadow] duration-200 hover:scale-105 hover:z-50 hover:shadow-xl',
                      'border-2 border-amber-400/60 bg-slate-800'
                    )}
                  >
                    {imagePath ? (
                      <img src={imagePath} alt="堆叠成员" className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center text-xs text-white/70">
                        M
                      </div>
                    )}
                  </CardDetailPressTarget>
                </DraggableCard>
              </div>
            );
          })}

          {/* 成员卡层 - 最上层（Z-index 最高） */}
          <DroppableZone
            id={slotId}
            zoneId={createZoneId(ZoneType.MEMBER_SLOT, position)}
            disabled={slotDisabled}
            disabledForDragFromZones={[ZoneType.INSPECTION_ZONE]}
            className={cn(
              // 响应式尺寸：使用 clamp 确保在合理范围内
              'w-[clamp(56px,17vw,78px)] aspect-[5/7] rounded-lg md:w-[clamp(80px,10vw,140px)]',
              isDragging
                ? 'border-2 border-dashed transition-none'
                : 'border-2 border-dashed transition-[border-color,background-color,outline-color] duration-150',
              cardId
                ? 'border-transparent'
                : isMobileBoard
                  ? 'border-rose-300/25'
                  : 'border-rose-500/30',
              'flex items-center justify-center',
              isMobileBoard
                ? 'bg-[color:color-mix(in_srgb,var(--bg-frosted)_8%,transparent)]'
                : 'bg-slate-800/50',
              // 有卡且可换手时显示特殊边框
              canDropMember && cardId && 'border-amber-500/30 hover:border-amber-500/50',
              isBattleActionSlotTarget &&
                'cursor-pointer border-cyan-300 bg-cyan-500/15 shadow-[0_0_18px_rgba(34,211,238,0.34)] hover:border-cyan-100',
              isActiveEffectSlotTarget &&
                'border-emerald-300 bg-emerald-500/15 shadow-[0_0_18px_rgba(52,211,153,0.34)]',
              // 确保成员卡在能量卡上方
              'relative z-10'
            )}
            activeClassName="ring-2 ring-rose-500 bg-rose-500/20 border-rose-500"
            title={selectedSlotAction?.target.label}
            onClick={handleSlotClick}
          >
            {card && (
              <DraggableCard
                id={card.instanceId}
                disabled={!allowGeneralOwnZoneInteraction}
                data={{
                  cardId: card.instanceId,
                  cardCode: card.cardCode,
                  fromZone: ZoneType.MEMBER_SLOT,
                }}
                onDoubleClick={handleDoubleClick}
              >
                <CardDetailPressTarget cardId={card.instanceId} className="h-full w-full">
                  <Card
                    cardData={card.cardData as AnyCardData}
                    instanceId={card.instanceId}
                    imagePath={card.imagePath}
                    size="responsive"
                    faceUp={true}
                    orientation={orientation}
                    selected={selectedCardId === card.instanceId}
                    effectVisualState={getEffectVisualState(card, {
                      isActionableNow: canActivateAbility,
                    })}
                    className={getActiveEffectTaskCardClass(card.instanceId)}
                    onClick={() => {
                      if (confirmActiveEffectCardFromTable(card.instanceId)) {
                        return;
                      }
                      if (isActiveEffectSlotTarget || isBattleActionSlotTarget) {
                        return;
                      }
                      if (allowGeneralOwnZoneInteraction) {
                        toggleSelectedCard(card.instanceId);
                      }
                    }}
                  />
                </CardDetailPressTarget>
              </DraggableCard>
            )}
            {isBattleActionSlotTarget && (
              <span className="pointer-events-none absolute left-1 top-1 z-20 rounded bg-cyan-300 px-1.5 py-0.5 text-[9px] font-bold text-slate-950 shadow">
                {selectedSlotAction.target.label}
              </span>
            )}
            {isActiveEffectSlotTarget && (
              <span className="pointer-events-none absolute right-1 top-1 z-20 rounded bg-[var(--semantic-success)] px-1.5 py-0.5 text-[9px] font-bold text-[var(--bg-surface)] shadow">
                可选
              </span>
            )}
            {card && <CardModifierBadgeStack modifierDelta={card.modifierDelta} />}
            {card && canActivateAbility && (
              <ActivatedAbilityMenu
                configs={activatedAbilityConfigs}
                onActivate={(config) => activateCardAbility(card.instanceId, config.abilityId)}
              />
            )}
            {!cardId && <span className="text-slate-600 text-xs">{position}</span>}
          </DroppableZone>
        </div>

        {/* 堆叠成员卡数量指示器 */}
        {memberBelowIds.length > 0 && (
          <div className="pointer-events-none absolute right-1 top-full z-30 -mt-1 rounded-full border border-amber-300/45 bg-amber-950/85 px-1.5 py-0.5 shadow-sm backdrop-blur">
            <span className="text-[10px] text-amber-400 font-medium">
              M×{memberBelowIds.length}
            </span>
          </div>
        )}
      </div>
    );
  };

  const setEnergyCardsOrientation = (targetOrientation: OrientationState) => {
    if (!allowGeneralOwnZoneInteraction || !canTapEnergy || isDragging) return;

    for (const cardId of energyZoneCardIds) {
      const currentOrientation = getEnergyCardOrientation(cardId);
      if (currentOrientation !== targetOrientation) {
        tapEnergy(cardId);
      }
    }
  };

  const getEnergyCardOrientation = (cardId: string) => {
    return getCardViewObject(cardId)?.orientation ?? OrientationState.ACTIVE;
  };

  const renderEnergyOrientationControls = (density: 'desktop' | 'mobile') => {
    const activeCount = energyZoneCardIds.filter((id) => {
      return getEnergyCardOrientation(id) === OrientationState.ACTIVE;
    }).length;
    const canUseEnergyControls =
      allowGeneralOwnZoneInteraction && canTapEnergy && energyZoneCardIds.length > 0;
    const hasWaitingEnergy = energyZoneCardIds.some((id) => {
      return getEnergyCardOrientation(id) !== OrientationState.ACTIVE;
    });
    const hasActiveEnergy = activeCount > 0;
    const isDesktop = density === 'desktop';

    return (
      <div
        className={cn(
          'grid min-w-0 shrink-0 grid-cols-2 divide-x divide-[var(--border-subtle)] border border-[var(--border-subtle)] bg-[color:color-mix(in_srgb,var(--bg-surface)_72%,transparent)] shadow-inner',
          isDesktop ? 'h-[22px] w-[58px] rounded-md p-px' : 'h-8 w-full rounded-lg p-0.5'
        )}
        role="group"
        aria-label="批量调整能量状态"
      >
        <button
          type="button"
          style={{ fontSize: '10px', fontWeight: 500, letterSpacing: '-0.02em' }}
          className={cn(
            'inline-flex min-w-0 items-center justify-center overflow-hidden text-[10px] font-medium leading-none tracking-[-0.02em] text-[var(--semantic-success)] transition-colors hover:bg-[color:color-mix(in_srgb,var(--semantic-success)_12%,transparent)] disabled:cursor-not-allowed disabled:text-[var(--text-muted)] disabled:opacity-45 disabled:hover:bg-transparent',
            isDesktop ? 'h-[18px] rounded-[4px]' : 'h-7 rounded-md'
          )}
          disabled={!canUseEnergyControls || isDragging || !hasWaitingEnergy}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            setEnergyCardsOrientation(OrientationState.ACTIVE);
          }}
          aria-label="全部能量变为活跃"
          title="全部能量变为活跃"
        >
          <span className="whitespace-nowrap">全活</span>
        </button>
        <button
          type="button"
          style={{ fontSize: '10px', fontWeight: 500, letterSpacing: '-0.02em' }}
          className={cn(
            'inline-flex min-w-0 items-center justify-center overflow-hidden text-[10px] font-medium leading-none tracking-[-0.02em] text-[var(--accent-secondary)] transition-colors hover:bg-[color:color-mix(in_srgb,var(--accent-secondary)_12%,transparent)] disabled:cursor-not-allowed disabled:text-[var(--text-muted)] disabled:opacity-45 disabled:hover:bg-transparent',
            isDesktop ? 'h-[18px] rounded-[4px]' : 'h-7 rounded-md'
          )}
          disabled={!canUseEnergyControls || isDragging || !hasActiveEnergy}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            setEnergyCardsOrientation(OrientationState.WAITING);
          }}
          aria-label="全部能量变为待机"
          title="全部能量变为待机"
        >
          <span className="whitespace-nowrap">全待</span>
        </button>
      </div>
    );
  };

  // 渲染能量区 - 横向一排显示，最多显示12张
  const renderEnergyZone = () => {
    const energyCards = energyZoneCardIds.slice(0, 12); // 最多12张
    const energyCount = energyZoneView?.count ?? energyZoneCardIds.length;
    const activeCount = energyZoneCardIds.filter((id) => {
      return getEnergyCardOrientation(id) === OrientationState.ACTIVE;
    }).length;
    const canUseEnergyControls =
      allowGeneralOwnZoneInteraction && canTapEnergy && energyZoneCardIds.length > 0;

    return (
      <DroppableZone
        id={getDroppableId(ZoneType.ENERGY_ZONE)}
        zoneId={createZoneId(ZoneType.ENERGY_ZONE)}
        disabled={!allowGeneralOwnZoneInteraction}
        disabledForDragFromZones={DISABLE_ORDINARY_DROP_FROM_INSPECTION}
        className="flex flex-col items-start gap-0.5"
        activeClassName="ring-2 ring-indigo-500 bg-indigo-500/20"
      >
        <div className="flex items-center gap-1">
          <span className="text-[10px] text-slate-600 font-medium">
            能量区 ({activeCount}/{energyCount})
          </span>
          {canUseEnergyControls && renderEnergyOrientationControls('desktop')}
        </div>
        {/* 横向布局 */}
        <div className="flex gap-1 flex-wrap max-w-[300px]">
          {energyCards.map((cardId) => {
            const card = getVisibleCardPresentation(cardId);
            const isActive = getEnergyCardOrientation(cardId) === OrientationState.ACTIVE;
            const imagePath = card?.imagePath ?? null;
            const skipsNextActivePhase = getCardViewObject(cardId)?.skipsNextActivePhase === true;

            return (
              <div
                key={cardId}
                className={cn(
                  'relative flex h-8 items-center justify-center',
                  'transition-[width] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:duration-75',
                  isActive ? 'w-5' : 'w-7'
                )}
              >
                <DraggableCard
                  id={cardId}
                  disabled={!allowGeneralOwnZoneInteraction}
                  data={{ cardId, cardCode: card?.cardCode, fromZone: ZoneType.ENERGY_ZONE }}
                  className={cn(
                    'absolute inset-0 flex items-center justify-center',
                    !isActive && 'z-10'
                  )}
                >
                  <CardDetailPressTarget cardId={card?.instanceId ?? null} disabled={!card}>
                    <div
                      data-card-id={card?.instanceId}
                      data-object-id={card ? `obj_${card.instanceId}` : undefined}
                      className={cn(
                        'h-7 w-5 rounded overflow-hidden shadow-sm cursor-pointer',
                        isDragging
                          ? 'transition-none'
                          : 'transition-[rotate,scale,transform,filter,opacity] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] hover:scale-110 hover:z-10 motion-reduce:duration-75',
                        !isActive && 'rotate-90 opacity-55 grayscale',
                        skipsNextActivePhase &&
                          'ring-2 ring-red-500 ring-offset-1 ring-offset-slate-950',
                        card && getActiveEffectTaskCardClass(card.instanceId)
                      )}
                      onClick={() => {
                        if (allowGeneralOwnZoneInteraction && canTapEnergy && !isDragging) {
                          tapEnergy(cardId);
                        }
                      }}
                      title={
                        skipsNextActivePhase
                          ? '下次活跃阶段不会自动变为活跃'
                          : isOpponent
                            ? isActive
                              ? '活跃'
                              : '等待'
                            : allowGeneralOwnZoneInteraction && canTapEnergy
                              ? '单击切换活跃/等待'
                              : '当前阶段不可操作'
                      }
                    >
                      {imagePath ? (
                        <img src={imagePath} alt="能量" className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-[8px] text-white/70">
                          E
                        </div>
                      )}
                      {skipsNextActivePhase && (
                        <span
                          aria-label="下次活跃阶段不会自动变为活跃"
                          className="absolute right-0 top-0 rounded-bl bg-red-600 px-0.5 text-[7px] font-bold text-white"
                        >
                          !
                        </span>
                      )}
                    </div>
                  </CardDetailPressTarget>
                </DraggableCard>
              </div>
            );
          })}
        </div>
      </DroppableZone>
    );
  };

  // 渲染卡组（紧凑版）- 使用真实卡背图片
  // 点击己方主卡组会直接执行正式检视命令
  const renderDeck = (count: number, label: string, deckType: 'main' | 'energy') => {
    const zoneId = deckType === 'main' ? 'main-deck' : 'energy-deck';
    const isMainDeck = deckType === 'main';
    const deckZoneType = isMainDeck ? ZoneType.MAIN_DECK : ZoneType.ENERGY_DECK;
    const deckDroppableId = getDroppableId(deckZoneType);
    const topCardId = count > 0 ? (isMainDeck ? mainDeckCardIds[0] : energyDeckCardIds[0]) : null;

    // 点击主卡组：翻顶 1 张到检视区
    const handleClick = () => {
      if (isMainDeck && canClickMainDeck) {
        openInspection(ZoneType.MAIN_DECK, 1);
      }
    };

    // 渲染顶层卡牌内容
    const renderTopCard = () => (
      <>
        {/* 叠放效果 - 底层阴影 */}
        {count > 1 && (
          <div className="absolute inset-0 rounded transform translate-x-0.5 translate-y-0.5 opacity-50 overflow-hidden">
            <img src="/back.jpg" alt="" className="w-full h-full object-cover" />
          </div>
        )}
        {/* 顶层卡牌 */}
        <div
          data-object-id={topCardId ? `obj_${topCardId}` : undefined}
          className="absolute inset-0 rounded overflow-hidden shadow-md"
        >
          <img src="/back.jpg" alt={label} className="w-full h-full object-cover" />
        </div>
      </>
    );

    return (
      <DroppableZone
        id={deckDroppableId}
        zoneId={zoneId}
        disabled={!allowGeneralOwnZoneInteraction && !(isMainDeck && canReceiveInspectionDrop)}
        disabledForDragFromZones={DISABLE_ORDINARY_DROP_FROM_INSPECTION}
        className="flex flex-col items-center gap-0.5"
        activeClassName="ring-2 ring-amber-500 bg-amber-500/20"
      >
        <span className="flex h-5 shrink-0 items-center justify-center text-[10px] font-medium leading-none text-[var(--text-muted)]">
          {label}
        </span>
        <div
          data-animation-zone-id={deckDroppableId}
          className={cn(
            'relative w-[40px] h-[56px]',
            isMainDeck &&
              canClickMainDeck &&
              'cursor-pointer hover:ring-2 hover:ring-purple-400 rounded'
          )}
          onClick={handleClick}
        >
          {count > 0 && (
            <>
              {/* 能量卡组：顶层卡牌可拖拽 */}
              {!isMainDeck && topCardId ? (
                <DraggableCard
                  id={topCardId}
                  className="relative block h-[56px] w-[40px]"
                  disabled={!allowGeneralOwnZoneInteraction}
                  data={{ cardId: topCardId, fromZone: ZoneType.ENERGY_DECK }}
                >
                  <div className="absolute inset-0 cursor-grab active:cursor-grabbing">
                    {renderTopCard()}
                  </div>
                </DraggableCard>
              ) : (
                /* 主卡组：不可拖拽 */
                renderTopCard()
              )}
            </>
          )}
          <div className="absolute -bottom-1 left-1/2 z-10 -translate-x-1/2 rounded-full border border-[var(--border-default)] bg-[var(--bg-surface)] px-1.5 py-0.5 text-[10px] font-bold text-[var(--text-primary)] shadow-[var(--shadow-sm)]">
            {count}
          </div>
        </div>
        {isMainDeck && !isOpponent && !isReadOnly && !isMobileBoard && (
          <div className="mt-1 flex flex-col items-center gap-1">
            {renderDrawActionButton('DESKTOP_DECK')}
            {renderReturnSelectedHandCardButton('DESKTOP_DECK')}
          </div>
        )}
      </DroppableZone>
    );
  };

  // 渲染休息室 - 卡片公开显示，叠放在一起，点击展开浮窗
  const renderWaitingRoom = () => {
    const count = waitingRoomZoneView?.count ?? waitingRoomCardIds.length;
    const waitingRoomDroppableId = getDroppableId(ZoneType.WAITING_ROOM);
    const waitingRoomCards = waitingRoomCardIds.flatMap((cardId: string) => {
      const card = getVisibleCardPresentation(cardId);
      return card ? [{ cardId, card }] : [];
    });
    const waitingRoomJudgmentStats = collectWaitingRoomJudgmentStats(
      waitingRoomCards.map(({ card }) => card.cardData as AnyCardData)
    );
    const hasJudgmentStats = hasWaitingRoomJudgmentStats(waitingRoomJudgmentStats);
    const showWaitingRoomStatsDetail =
      hasJudgmentStats &&
      (isMobileBoard
        ? waitingRoomStatsExpanded
        : waitingRoomStatsExpanded || waitingRoomStatsHover);
    const canMoveWaitingRoomCardToHandFromModal =
      !isReadOnly &&
      !isOpponent &&
      viewerSeat === playerSeat &&
      allowGeneralOwnZoneInteraction &&
      canMovePublicCardToHand &&
      !visibleActiveEffect;
    const selectedWaitingRoomCard = canMoveWaitingRoomCardToHandFromModal
      ? (waitingRoomCards.find(({ card }) => card.instanceId === selectedCardId) ?? null)
      : null;
    const selectedWaitingRoomCardTitle = selectedWaitingRoomCard
      ? getCardLocalizedInfo(selectedWaitingRoomCard.card.cardData).title
      : null;

    return (
      <DroppableZone
        id={waitingRoomDroppableId}
        zoneId={createZoneId(ZoneType.WAITING_ROOM)}
        disabled={!allowGeneralOwnZoneInteraction && !canReceiveInspectionDrop}
        disabledForDragFromZones={DISABLE_ORDINARY_DROP_FROM_INSPECTION}
        className="relative flex flex-col items-center gap-0.5"
        activeClassName="ring-2 ring-slate-500 bg-slate-500/20"
      >
        <span className="flex h-5 shrink-0 items-center justify-center text-[10px] font-medium leading-none text-[var(--text-muted)]">
          休息室
        </span>

        {count === 0 ? (
          // 空休息室占位
          <div
            data-animation-zone-id={waitingRoomDroppableId}
            className="flex h-[63px] w-[45px] items-center justify-center rounded border border-dashed border-[var(--border-default)] bg-[color:color-mix(in_srgb,var(--bg-overlay)_40%,transparent)]"
          >
            <span className="text-[10px] text-[var(--text-muted)]">0</span>
          </div>
        ) : (
          // 卡片叠放显示，点击展开
          <>
            <div
              data-animation-zone-id={waitingRoomDroppableId}
              className="relative h-[63px] w-[45px] cursor-pointer transition-transform duration-200 hover:-translate-y-0.5"
              onClick={() => setWaitingRoomExpanded(true)}
            >
              {/* 叠放的迷你卡片 */}
              {waitingRoomCards.slice(0, 5).map(({ cardId, card }, idx: number) => {
                return (
                  <div
                    key={cardId}
                    className="absolute flex h-[63px] w-[45px] items-center justify-center overflow-hidden rounded border border-[var(--border-default)] bg-[var(--bg-overlay)] shadow-[var(--shadow-sm)]"
                    style={{
                      left: Math.min(idx * 2, 8),
                      top: Math.min(idx * 1.5, 6),
                      zIndex: idx,
                    }}
                  >
                    {card.imagePath ? (
                      <img src={card.imagePath} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <span className="text-[8px] text-[var(--text-muted)]">♪</span>
                    )}
                  </div>
                );
              })}

              {/* 数量标签 */}
              <div className="absolute -bottom-1 left-1/2 z-10 -translate-x-1/2 rounded-full border border-[var(--border-default)] bg-[var(--bg-surface)] px-1.5 py-0.5 text-[10px] font-bold text-[var(--text-primary)] shadow-[var(--shadow-sm)]">
                {count}
              </div>
            </div>

            {/* 展开的浮窗 */}
            {waitingRoomExpanded &&
              (() => {
                const waitingRoomModal = (
                  <>
                    <div
                      className={cn(
                        'modal-backdrop z-[var(--z-battle-modal-backdrop)]',
                        isDragging && 'pointer-events-none'
                      )}
                      onClick={closeWaitingRoom}
                    />

                    <div
                      className="pointer-events-auto fixed inset-0 z-[var(--z-battle-modal)] flex items-end justify-center p-2 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-[max(0.75rem,env(safe-area-inset-top))] sm:p-4 md:items-center"
                      role="dialog"
                      aria-modal="true"
                      aria-label="休息室"
                    >
                      <motion.div
                        className="modal-surface modal-accent-amber relative flex max-h-[calc(var(--battle-viewport-height)_-_env(safe-area-inset-top)_-_env(safe-area-inset-bottom)_-_1.5rem)] w-full flex-col overflow-hidden md:max-h-[82vh] md:w-[min(92vw,720px)]"
                        initial={{ opacity: 0, scale: 0.94 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.94 }}
                      >
                        <div className="modal-header flex shrink-0 items-center justify-between gap-3 px-4 py-3 md:px-5 md:py-4">
                          <div className="flex min-w-0 items-center gap-3">
                            <div className="flex h-9 w-9 items-center justify-center rounded-full border border-[var(--border-default)] bg-[color:color-mix(in_srgb,var(--bg-surface)_84%,transparent)] text-[var(--accent-secondary)]">
                              <Layers3 size={16} />
                            </div>
                            <div className="min-w-0">
                              <div className="text-sm font-semibold text-[var(--text-primary)]">
                                休息室
                              </div>
                              <div className="text-xs text-[var(--text-secondary)]">
                                共 {count} 张卡牌
                              </div>
                            </div>
                          </div>
                          <div className="flex min-w-0 shrink-0 items-center gap-2">
                            <div
                              className="relative flex min-w-0 items-center justify-end gap-1.5"
                              onMouseEnter={() => setWaitingRoomStatsHover(true)}
                              onMouseLeave={() => setWaitingRoomStatsHover(false)}
                              onFocus={() => setWaitingRoomStatsHover(true)}
                              onBlur={() => setWaitingRoomStatsHover(false)}
                            >
                              <WaitingRoomJudgmentSummaryChips stats={waitingRoomJudgmentStats} />
                              <button
                                type="button"
                                disabled={!hasJudgmentStats}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  setWaitingRoomStatsExpanded((value) => !value);
                                }}
                                className={cn(
                                  'button-icon h-8 w-8',
                                  hasJudgmentStats
                                    ? showWaitingRoomStatsDetail &&
                                        'border-[var(--accent-secondary)] text-[var(--accent-secondary)]'
                                    : 'cursor-not-allowed opacity-45'
                                )}
                                aria-label="查看休息室判心统计"
                                aria-expanded={showWaitingRoomStatsDetail}
                                title={hasJudgmentStats ? '查看休息室判心统计' : '休息室没有判心标'}
                              >
                                <BarChart3 size={14} />
                              </button>
                              {!isMobileBoard && showWaitingRoomStatsDetail && (
                                <WaitingRoomJudgmentStatsDetail
                                  stats={waitingRoomJudgmentStats}
                                  className="absolute right-0 top-[calc(100%+0.5rem)] z-50 w-[min(23rem,calc(100vw-2rem))]"
                                />
                              )}
                            </div>
                            <button
                              type="button"
                              onClick={closeWaitingRoom}
                              className="button-icon h-8 w-8"
                              title="关闭休息室"
                            >
                              <X size={14} />
                            </button>
                          </div>
                        </div>

                        {isMobileBoard && showWaitingRoomStatsDetail && (
                          <div className="shrink-0 border-b border-[var(--border-subtle)] bg-[color:color-mix(in_srgb,var(--bg-overlay)_50%,transparent)] px-3 py-2">
                            <WaitingRoomJudgmentStatsDetail
                              stats={waitingRoomJudgmentStats}
                              className="border-[var(--border-subtle)] bg-[color:color-mix(in_srgb,var(--bg-surface)_88%,transparent)] shadow-none"
                            />
                          </div>
                        )}

                        <div
                          className={cn(
                            'touch-scroll cute-scrollbar min-h-0 flex-1 overflow-y-auto px-3 pt-3 md:px-5 md:pt-5',
                            canMoveWaitingRoomCardToHandFromModal
                              ? 'pb-20 md:pb-20'
                              : 'pb-3 md:pb-5'
                          )}
                        >
                          <div className="grid grid-cols-[repeat(auto-fill,minmax(64px,1fr))] gap-2 sm:grid-cols-5 md:grid-cols-6 md:gap-3">
                            {waitingRoomCards.map(({ cardId, card }) => {
                              const isWaitingRoomCardSelected = selectedCardId === card.instanceId;
                              const activatedAbilityConfigs = getActivatedAbilityUiConfigs(
                                card.cardCode,
                                CardAbilitySourceZone.WAITING_ROOM
                              );
                              const canActivateWaitingRoomAbility =
                                activatedAbilityConfigs.length > 0 &&
                                !isOpponent &&
                                viewerSeat === playerSeat &&
                                canActivateAbilityCommand &&
                                isWaitingRoomCardSelected;
                              const waitingRoomCardContent = (
                                <CardDetailPressTarget
                                  cardId={card.instanceId}
                                  title={getCardLocalizedInfo(card.cardData).title}
                                >
                                  <Card
                                    cardData={card.cardData as AnyCardData}
                                    instanceId={card.instanceId}
                                    imagePath={card.imagePath}
                                    size="sm"
                                    faceUp={true}
                                    selected={isWaitingRoomCardSelected}
                                    effectVisualState={getEffectVisualState(card, {
                                      isActionableNow: canActivateWaitingRoomAbility,
                                    })}
                                    onClick={() => {
                                      if (confirmActiveEffectCardFromTable(card.instanceId)) {
                                        return;
                                      }
                                      if (allowGeneralOwnZoneInteraction) {
                                        toggleSelectedCard(card.instanceId);
                                      }
                                    }}
                                    showHover={true}
                                    className={cn(
                                      'h-[90px] w-[64px] md:h-[105px] md:w-[75px]',
                                      getActiveEffectTaskCardClass(card.instanceId)
                                    )}
                                  />
                                </CardDetailPressTarget>
                              );

                              return (
                                <div
                                  key={cardId}
                                  className="relative flex min-w-0 flex-col items-center"
                                >
                                  {waitingRoomCardContent}
                                  {canActivateWaitingRoomAbility && (
                                    <ActivatedAbilityMenu
                                      configs={activatedAbilityConfigs}
                                      onActivate={(config) => {
                                        activateCardAbility(card.instanceId, config.abilityId);
                                        closeWaitingRoom();
                                      }}
                                    />
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                        {selectedWaitingRoomCard && (
                          <div className="absolute inset-x-0 bottom-0 z-20 border-t border-[var(--border-subtle)] bg-[color:color-mix(in_srgb,var(--bg-surface)_94%,transparent)] px-3 py-2 shadow-[0_-10px_22px_rgba(15,23,42,0.22)] backdrop-blur-xl md:px-5">
                            <div className="flex min-w-0 items-center gap-2">
                              <div className="flex h-12 w-[34px] shrink-0 items-center justify-center overflow-hidden rounded border border-[var(--border-default)] bg-[var(--bg-overlay)] shadow-[var(--shadow-sm)]">
                                {selectedWaitingRoomCard.card.imagePath ? (
                                  <img
                                    src={selectedWaitingRoomCard.card.imagePath}
                                    alt=""
                                    className="h-full w-full object-cover"
                                    draggable={false}
                                  />
                                ) : (
                                  <span className="text-[10px] text-[var(--text-muted)]">♪</span>
                                )}
                              </div>
                              <div className="min-w-0 flex-1">
                                <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--text-muted)]">
                                  已选卡牌
                                </div>
                                <div className="truncate text-xs font-semibold text-[var(--text-primary)]">
                                  {selectedWaitingRoomCardTitle}
                                </div>
                              </div>
                              <button
                                type="button"
                                className="button-primary inline-flex min-h-10 shrink-0 items-center justify-center gap-1.5 px-3 text-xs font-semibold"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  movePublicCardToHand(
                                    selectedWaitingRoomCard.card.instanceId,
                                    ZoneType.WAITING_ROOM
                                  );
                                }}
                                title="加入手牌"
                                aria-label="将选中的休息室卡牌加入手牌"
                              >
                                <Hand size={14} className="shrink-0" />
                                加入手牌
                              </button>
                            </div>
                          </div>
                        )}
                      </motion.div>
                    </div>
                  </>
                );

                return typeof document === 'undefined'
                  ? waitingRoomModal
                  : createPortal(waitingRoomModal, document.body);
              })()}
          </>
        )}
      </DroppableZone>
    );
  };

  // 渲染成功 Live 区 - 显示实际的 Live 卡片（正面朝上公开，叠放显示，无浮窗）
  const renderSuccessZone = () => {
    // 固定3个槽位，容器高度固定
    const containerHeight = 68 + 2 * 45; // 294px

    return (
      <DroppableZone
        id={getDroppableId(ZoneType.SUCCESS_ZONE)}
        zoneId={createZoneId(ZoneType.SUCCESS_ZONE)}
        disabled={isReadOnly || isOpponent}
        disabledForDragFromZones={DISABLE_ORDINARY_DROP_FROM_INSPECTION}
        className="flex flex-col items-center gap-1 relative"
        activeClassName="ring-2 ring-green-500 bg-green-500/20"
      >
        <span className="text-xs text-slate-600 font-medium">成功 Live 卡区</span>

        {/* 卡片区域 - 固定3个槽位，竖向叠放显示 */}
        <div className="relative w-[105px]" style={{ height: `${containerHeight}px` }}>
          {[0, 1, 2].map((slotIndex) => {
            const cardId = successCardIds[slotIndex];
            const card = cardId ? getVisibleCardPresentation(cardId) : null;

            return (
              <div
                key={slotIndex}
                className="absolute w-[105px] h-[68px]"
                style={{
                  top: slotIndex * 45,
                  left: 0,
                  zIndex: 2 - slotIndex, // 上面的框盖住下面的框
                }}
              >
                {card ? (
                  <DraggableCard
                    id={cardId}
                    disabled={!allowGeneralOwnZoneInteraction}
                    data={{ cardId, cardCode: card.cardCode, fromZone: ZoneType.SUCCESS_ZONE }}
                    className="absolute inset-0 flex items-center justify-center"
                  >
                    <CardDetailPressTarget
                      cardId={card.instanceId}
                      className="flex h-full w-full cursor-pointer items-center justify-center transition-transform hover:scale-105"
                    >
                      <div className="-rotate-90 origin-center">
                        <Card
                          cardData={card.cardData as AnyCardData}
                          instanceId={card.instanceId}
                          imagePath={card.imagePath}
                          size="sm"
                          faceUp={true}
                          effectVisualState={getEffectVisualState(card)}
                          interactive={!isReadOnly && !isOpponent}
                          showHover={false}
                          className={cn(
                            'w-[80px] h-[112px]',
                            getActiveEffectTaskCardClass(card.instanceId)
                          )}
                          onClick={() => confirmActiveEffectCardFromTable(card.instanceId)}
                        />
                      </div>
                    </CardDetailPressTarget>
                  </DraggableCard>
                ) : (
                  // 无卡片 - 显示虚线框占位符
                  <div className="w-full h-full rounded border border-dashed border-slate-600 flex items-center justify-center">
                    <span className="text-slate-600 text-[10px]">♪</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </DroppableZone>
    );
  };

  const renderSuccessZoneCompact = () => {
    const slotHeight = 44;
    const slotOffset = 18;
    const containerHeight = slotHeight + slotOffset * 2;

    return (
      <DroppableZone
        id={getDroppableId(ZoneType.SUCCESS_ZONE)}
        zoneId={createZoneId(ZoneType.SUCCESS_ZONE)}
        disabled={isReadOnly || isOpponent}
        disabledForDragFromZones={DISABLE_ORDINARY_DROP_FROM_INSPECTION}
        className="flex h-[92px] w-full flex-col items-center justify-start gap-1 overflow-hidden"
        activeClassName="ring-2 ring-green-500 bg-green-500/20"
      >
        <span className="text-[10px] font-medium text-[var(--text-muted)]">成功 Live</span>
        <div className="relative w-16" style={{ height: `${containerHeight}px` }}>
          {[0, 1, 2].map((slotIndex) => {
            const cardId = successCardIds[slotIndex];
            const card = cardId ? getVisibleCardPresentation(cardId) : null;

            return (
              <div
                key={slotIndex}
                className="absolute flex h-11 w-16 items-center justify-center"
                style={{
                  top: slotIndex * slotOffset,
                  left: 0,
                  zIndex: 2 - slotIndex,
                }}
              >
                {card ? (
                  <DraggableCard
                    id={cardId}
                    disabled={!allowGeneralOwnZoneInteraction}
                    data={{ cardId, cardCode: card.cardCode, fromZone: ZoneType.SUCCESS_ZONE }}
                  >
                    <CardDetailPressTarget
                      cardId={card.instanceId}
                      className="flex h-full w-full cursor-pointer items-center justify-center transition-transform hover:scale-105"
                    >
                      <div className="-rotate-90 origin-center">
                        <Card
                          cardData={card.cardData as AnyCardData}
                          instanceId={card.instanceId}
                          imagePath={card.imagePath}
                          size="sm"
                          faceUp={true}
                          interactive={!isReadOnly && !isOpponent}
                          showHover={false}
                          className={cn(
                            'h-16 w-[46px]',
                            getActiveEffectTaskCardClass(card.instanceId)
                          )}
                          onClick={() => confirmActiveEffectCardFromTable(card.instanceId)}
                        />
                      </div>
                    </CardDetailPressTarget>
                  </DraggableCard>
                ) : (
                  <div className="flex h-full w-full items-center justify-center rounded border border-dashed border-slate-600/60 bg-slate-800/20">
                    <span className="text-[9px] text-slate-600">♪</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </DroppableZone>
    );
  };

  // 渲染资源区（主卡组 + 休息室 + 能量卡组）- 紧凑横向布局
  // reversed: 对手区域需要反转顺序以呈现镜像效果
  const renderResources = (reversed: boolean = false) => {
    // 己方顺序：主卡组 → 休息室 → 能量卡组
    // 对手方顺序（镜像）：能量卡组 → 休息室 → 主卡组
    const content = reversed
      ? [
          <div key="energy-deck">
            {renderDeck(
              energyDeckZoneView?.count ?? energyDeckCardIds.length,
              '能量卡组',
              'energy'
            )}
          </div>,
          <div key="waiting-room">{renderWaitingRoom()}</div>,
          <div key="main-deck">
            {renderDeck(mainDeckZoneView?.count ?? mainDeckCardIds.length, '主卡组', 'main')}
          </div>,
        ]
      : [
          <div key="main-deck">
            {renderDeck(mainDeckZoneView?.count ?? mainDeckCardIds.length, '主卡组', 'main')}
          </div>,
          <div key="waiting-room">{renderWaitingRoom()}</div>,
          <div key="energy-deck">
            {renderDeck(
              energyDeckZoneView?.count ?? energyDeckCardIds.length,
              '能量卡组',
              'energy'
            )}
          </div>,
        ];

    return <div className="flex items-start gap-2">{content}</div>;
  };

  const renderMobileLeftRail = () => (
    <div
      className="flex w-[clamp(68px,18vw,76px)] min-w-0 flex-col items-center justify-center gap-1.5"
      data-mobile-battle-left-rail
    >
      {renderSuccessZoneCompact()}
      {renderMobileEnergyZone()}
    </div>
  );

  const renderMobileResourcesRail = () => (
    <div
      className="flex w-[54px] flex-col items-center gap-1.5 rounded-lg border border-[color:color-mix(in_srgb,var(--border-default)_28%,transparent)] bg-[color:color-mix(in_srgb,var(--bg-frosted)_8%,transparent)] px-1 py-1.5"
      data-mobile-battle-resources-rail
    >
      {renderDeck(mainDeckZoneView?.count ?? mainDeckCardIds.length, '主卡组', 'main')}
      {renderWaitingRoom()}
      {renderDeck(energyDeckZoneView?.count ?? energyDeckCardIds.length, '能量卡组', 'energy')}
    </div>
  );

  const renderMobileEnergyZone = () => {
    const energyCards = energyZoneCardIds.slice(0, 12);
    const energyCount = energyZoneView?.count ?? energyZoneCardIds.length;
    const activeCount = energyZoneCardIds.filter((id) => {
      return getEnergyCardOrientation(id) === OrientationState.ACTIVE;
    }).length;
    const showMobileEnergyControls = !isReadOnly && !isOpponent;

    return (
      <DroppableZone
        id={getDroppableId(ZoneType.ENERGY_ZONE)}
        zoneId={createZoneId(ZoneType.ENERGY_ZONE)}
        disabled={!allowGeneralOwnZoneInteraction}
        disabledForDragFromZones={DISABLE_ORDINARY_DROP_FROM_INSPECTION}
        className={cn(
          'flex w-full min-w-0 flex-col items-stretch gap-1 overflow-hidden rounded-lg border border-indigo-300/20 bg-indigo-500/[0.055] px-1 py-1',
          showMobileEnergyControls ? 'h-[120px]' : 'h-[94px]'
        )}
        activeClassName="ring-2 ring-indigo-500 bg-indigo-500/20"
      >
        <span className="w-full truncate text-center text-[10px] font-semibold leading-none text-[var(--text-muted)] tabular-nums">
          能量 {activeCount}/{energyCount}
        </span>
        {showMobileEnergyControls && renderEnergyOrientationControls('mobile')}
        <div className="relative grid min-h-0 w-full min-w-0 flex-1 grid-cols-4 grid-rows-3 gap-px overflow-hidden rounded border border-dashed border-indigo-300/24 bg-indigo-500/[0.04] p-px">
          {Array.from({ length: 12 }, (_, slotIndex) => {
            const cardId = energyCards[slotIndex];
            if (!cardId) {
              return (
                <div
                  key={`empty-energy-${slotIndex}`}
                  className="flex min-h-0 min-w-0 items-center justify-center rounded-[3px] border border-indigo-300/10 bg-indigo-500/[0.035]"
                />
              );
            }

            const card = getVisibleCardPresentation(cardId);
            const imagePath = card?.imagePath ?? null;
            const isActive = getEnergyCardOrientation(cardId) === OrientationState.ACTIVE;
            const skipsNextActivePhase = getCardViewObject(cardId)?.skipsNextActivePhase === true;

            return (
              <div
                key={cardId}
                className={cn(
                  'relative flex min-h-0 min-w-0 items-center justify-center',
                  !isActive && 'z-10'
                )}
              >
                <DraggableCard
                  id={cardId}
                  disabled={!allowGeneralOwnZoneInteraction}
                  data={{ cardId, cardCode: card?.cardCode, fromZone: ZoneType.ENERGY_ZONE }}
                >
                  <CardDetailPressTarget cardId={card?.instanceId ?? null} disabled={!card}>
                    <div
                      data-card-id={card?.instanceId}
                      data-object-id={card ? `obj_${card.instanceId}` : undefined}
                      className={cn(
                        'h-6 w-4 overflow-hidden rounded-[3px] shadow-sm transition-[rotate,scale,transform,filter,opacity] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:duration-75',
                        allowGeneralOwnZoneInteraction && canTapEnergy && !isDragging
                          ? 'cursor-pointer active:scale-95'
                          : 'cursor-default',
                        !isActive && 'rotate-90 opacity-45 grayscale',
                        skipsNextActivePhase &&
                          'ring-2 ring-red-500 ring-offset-1 ring-offset-slate-950',
                        card && getActiveEffectTaskCardClass(card.instanceId)
                      )}
                      onClick={() => {
                        if (allowGeneralOwnZoneInteraction && canTapEnergy && !isDragging) {
                          tapEnergy(cardId);
                        }
                      }}
                      title={
                        skipsNextActivePhase
                          ? '下次活跃阶段不会自动变为活跃'
                          : allowGeneralOwnZoneInteraction && canTapEnergy
                            ? '点按切换活跃/待机'
                            : '能量区'
                      }
                    >
                      {imagePath ? (
                        <img src={imagePath} alt="能量" className="h-full w-full object-cover" />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-indigo-500 to-purple-600 text-[8px] text-white/70">
                          E
                        </div>
                      )}
                      {skipsNextActivePhase && (
                        <span
                          aria-label="下次活跃阶段不会自动变为活跃"
                          className="absolute right-0 top-0 rounded-bl bg-red-600 px-0.5 text-[6px] font-bold text-white"
                        >
                          !
                        </span>
                      )}
                    </div>
                  </CardDetailPressTarget>
                </DraggableCard>
              </div>
            );
          })}
          {energyZoneCardIds.length > energyCards.length && (
            <div className="absolute right-0.5 top-0.5 flex h-5 min-w-5 items-center justify-center rounded border border-indigo-300/30 bg-indigo-900/85 px-1 text-[9px] font-bold text-indigo-100">
              +{energyZoneCardIds.length - energyCards.length}
            </div>
          )}
        </div>
      </DroppableZone>
    );
  };

  // 渲染单个 Live 卡（横置）
  const renderLiveCard = (cardId: string) => {
    const viewObject = getCardViewObject(cardId);
    const card = getVisibleCardPresentation(cardId);
    const isFaceUp = viewObject ? viewObject.surface === 'FRONT' : false;
    if (!card && isFaceUp) return null;
    if (!viewObject && !card) return null;

    // 联机视图优先决定当前观察者看到 FRONT 还是 BACK。
    const shouldShowFront = viewObject?.surface === 'FRONT';

    // 获取判定结果
    const judgmentResult = getLiveResultForCard(cardId);
    const showJudgment = shouldShowFront && judgmentResult !== undefined;

    // 获取 Live 卡所需心数
    const liveData = card && isLiveCardData(card.cardData) ? (card.cardData as LiveCardData) : null;

    return (
      <DraggableCard
        id={cardId}
        disabled={isReadOnly || isOpponent}
        data={{ cardId, cardCode: card?.cardCode, fromZone: ZoneType.LIVE_ZONE }}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.9 }}
          // 横置卡牌的容器：需要调整尺寸以适应旋转后的卡牌
          className="relative flex h-[50px] w-[70px] items-center justify-center md:h-[68px] md:w-[105px]"
        >
          <CardDetailPressTarget
            cardId={shouldShowFront && card ? card.instanceId : null}
            disabled={!shouldShowFront || !card}
            className="-rotate-90 origin-center"
          >
            {card ? (
              <Card
                cardData={card.cardData as AnyCardData}
                instanceId={card.instanceId}
                imagePath={card.imagePath}
                size="sm"
                faceUp={shouldShowFront}
                effectVisualState={getEffectVisualState(card, { faceUp: shouldShowFront })}
                interactive={!isReadOnly && !isOpponent}
                showHover={false}
                className={cn(
                  'h-[80px] w-[57px] md:h-[112px] md:w-[80px]',
                  getActiveEffectTaskCardClass(card.instanceId)
                )}
                onClick={() => confirmActiveEffectCardFromTable(card.instanceId)}
              />
            ) : (
              <div className="h-[80px] w-[57px] overflow-hidden rounded-lg shadow-md md:h-[112px] md:w-[80px]">
                <img src="/back.jpg" alt="Card Back" className="h-full w-full object-cover" />
              </div>
            )}
          </CardDetailPressTarget>

          {/* 判定结果指示器 */}
          {showJudgment && (
            <motion.div
              initial={{ opacity: 0, scale: 0.5 }}
              animate={{ opacity: 1, scale: 1 }}
              className={cn(
                'absolute -top-1 -right-1 w-5 h-5 rounded-full',
                'flex items-center justify-center text-xs font-bold',
                'shadow-lg z-10',
                judgmentResult ? 'bg-green-500 text-white' : 'bg-red-500 text-white'
              )}
            >
              {judgmentResult ? '✓' : '✗'}
            </motion.div>
          )}

          {/* Live 卡所需心展示 */}
          {shouldShowFront && liveData && (
            <div className="absolute -bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-0.5 text-[8px] whitespace-nowrap">
              {getHeartRequirementEntries(liveData.requirements?.colorRequirements).map(
                ([color, count], i) => (
                  <span key={i} className="inline-flex items-center gap-0.5">
                    <img
                      src={HEART_REQUIREMENT_ICON_SOURCE_BY_COLOR[color as HeartColor]}
                      alt=""
                      className="h-3 w-3 object-contain drop-shadow"
                      draggable={false}
                    />
                    {(count as number) > 1 && (
                      <span className="text-[8px] font-bold text-white drop-shadow">
                        ×{count as number}
                      </span>
                    )}
                  </span>
                )
              )}
            </div>
          )}
        </motion.div>
      </DraggableCard>
    );
  };

  // 渲染单个 Live 槽位 - 与成员槽位尺寸对齐
  const renderLiveSlot = (slotIndex: number) => {
    const cardId = liveCardIds[slotIndex];
    return (
      <div
        key={slotIndex}
        className={cn(
          // 与成员槽位相同的宽度，但高度固定为横置卡牌的高度
          'h-12 w-[clamp(56px,17vw,78px)] md:h-[60px] md:w-[clamp(80px,10vw,140px)]',
          'rounded-lg flex items-center justify-center',
          'border border-dashed',
          cardId
            ? 'border-transparent bg-transparent'
            : isMobileBoard
              ? 'border-slate-300/20 bg-[color:color-mix(in_srgb,var(--bg-frosted)_8%,transparent)]'
              : 'border-slate-600/30 bg-slate-800/30'
        )}
      >
        {cardId ? (
          renderLiveCard(cardId)
        ) : (
          <span className="text-slate-600 text-[8px]">{'LIVE 卡区'}</span>
        )}
      </div>
    );
  };

  // 渲染 Live 区域 - 三个固定槽位与成员槽位对齐
  // reversed: 对手区域需要镜像显示（RIGHT-CENTER-LEFT）
  const renderLiveZone = (reversed: boolean = false) => {
    // 使用三个固定槽位，与成员槽位 LEFT/CENTER/RIGHT 对应
    // 对手区域需要反转显示顺序以呈现镜像效果
    const slotOrder = reversed ? [2, 1, 0] : [0, 1, 2];
    const liveZoneAction = findEnabledBattleActionZoneTarget(
      selectedBattleActionIntents,
      ZoneType.LIVE_ZONE
    );
    const handleLiveZoneClick = (event: MouseEvent<HTMLDivElement>) => {
      const targetElement = event.target instanceof HTMLElement ? event.target : null;
      if (targetElement?.closest('[data-card-id]')) {
        return;
      }
      if (liveZoneAction) {
        executeBattleActionTarget(liveZoneAction.target);
      }
    };
    const content = (
      <div className="flex w-full items-center justify-center gap-1 sm:gap-4 md:gap-15">
        {slotOrder.map((idx) => renderLiveSlot(idx))}
      </div>
    );

    // 己方 Live 区可放置
    if (!isOpponent) {
      return (
        <DroppableZone
          id={getDroppableId(ZoneType.LIVE_ZONE)}
          zoneId={createZoneId(ZoneType.LIVE_ZONE)}
          disabled={!canDropToLiveZone || liveZoneIsFull}
          disabledForDragFromZones={DISABLE_ORDINARY_DROP_FROM_INSPECTION}
          className={cn(
            'relative rounded-lg px-1 py-2',
            'border',
            isMobileBoard
              ? 'bg-[color:color-mix(in_srgb,var(--bg-frosted)_8%,transparent)]'
              : 'bg-slate-800/40',
            canDropToLiveZone && !liveZoneIsFull
              ? 'border-rose-500/50 hover:border-rose-500'
              : isMobileBoard
                ? 'border-slate-300/20'
                : 'border-slate-600/30',
            liveZoneAction &&
              'cursor-pointer border-cyan-300 bg-cyan-500/15 shadow-[0_0_18px_rgba(34,211,238,0.26)] hover:border-cyan-100',
            'flex flex-col items-center justify-center'
          )}
          activeClassName="ring-2 ring-rose-500 bg-rose-500/20 border-rose-500"
          title={liveZoneAction?.target.label}
          onClick={handleLiveZoneClick}
        >
          {content}
          {liveZoneAction && (
            <span className="pointer-events-none absolute right-1 top-1 rounded bg-cyan-300 px-1.5 py-0.5 text-[9px] font-bold leading-none text-slate-950 shadow">
              {liveZoneAction.target.label}
            </span>
          )}
        </DroppableZone>
      );
    }

    // 对手 Live 区只显示
    return (
      <div
        className={cn(
          'rounded-lg px-1 py-2',
          isMobileBoard
            ? 'border border-slate-300/20 bg-[color:color-mix(in_srgb,var(--bg-frosted)_8%,transparent)]'
            : 'border border-slate-600/30 bg-slate-800/40',
          'flex flex-col items-center justify-center'
        )}
      >
        {content}
      </div>
    );
  };

  const renderInspectionZone = () => {
    const isViewerInspectionZone = viewerSeat === playerSeat && hasOwnedInspectionContext;
    const canUseInspectionActions =
      !isReadOnly && isViewerInspectionZone && !isActiveEffectInspectionWindow;
    const hasVisibleInspectionCards = inspectionCardIds.length > 0;
    const canBatchArrangeInspection =
      canFinishInspectionWithArrangement && inspectionCardIds.length > 0;
    const canCloseInspection =
      canUseInspectionActions &&
      hasFinishInspectionCommand &&
      inspectionBatchAction === null &&
      (!hasVisibleInspectionCards || canBatchArrangeInspection);
    const shouldRenderInspectionZone =
      !!inspectionZoneView && (inspectionZoneView.count > 0 || isViewerInspectionZone);
    const suppressInspectionForEffectEntry =
      suppressActiveEffectVisuals && matchView?.window?.windowType === 'INSPECTION';
    const suppressInspectionSurface = suppressInspectionForEffectEntry;

    const waitForInspectionZoneChange = (previousCardIds: readonly string[]) =>
      new Promise<void>((resolve) => {
        const unsubscribe = useGameStore.subscribe((state) => {
          const nextCardIds = state.getSeatZoneCardIds(playerSeat, 'INSPECTION_ZONE');
          const sameLength = nextCardIds.length === previousCardIds.length;
          const sameCards =
            sameLength && nextCardIds.every((cardId, index) => cardId === previousCardIds[index]);
          if (!sameCards) {
            clearTimeout(timeoutId);
            unsubscribe();
            resolve();
          }
        });

        const timeoutId = window.setTimeout(() => {
          unsubscribe();
          resolve();
        }, 1500);
      });

    const moveAllInspectionCardsToWaitingRoom = async () => {
      if (!canUseInspectionActions || inspectionBatchAction) {
        return;
      }

      setInspectionBatchAction('waiting-room');
      try {
        const latestInspectionCardIds = useGameStore
          .getState()
          .getSeatZoneCardIds(playerSeat, 'INSPECTION_ZONE');
        if (latestInspectionCardIds.length === 0) {
          return;
        }
        const result = finishInspectionWithArrangement(
          latestInspectionCardIds,
          ZoneType.WAITING_ROOM
        );
        if (result.success || result.pending) {
          setHoveredCard(null);
        }
        if (result.pending) {
          await waitForInspectionZoneChange(latestInspectionCardIds);
        }
      } finally {
        setInspectionBatchAction(null);
      }
    };

    const closeInspectionByReturningCardsToTop = async () => {
      if (!canUseInspectionActions || inspectionBatchAction) {
        return;
      }

      setInspectionBatchAction('close');
      try {
        const latestInspectionCardIds = useGameStore
          .getState()
          .getSeatZoneCardIds(playerSeat, 'INSPECTION_ZONE');
        if (latestInspectionCardIds.length > 0) {
          const sourceDeckZone =
            inspectionSourceZone === ZoneType.ENERGY_DECK
              ? ZoneType.ENERGY_DECK
              : ZoneType.MAIN_DECK;
          const arrangeResult = finishInspectionWithArrangement(
            latestInspectionCardIds,
            sourceDeckZone,
            { position: 'TOP' }
          );
          if (!arrangeResult.success && !arrangeResult.pending) {
            return;
          }
          if (arrangeResult.pending) {
            await waitForInspectionZoneChange(latestInspectionCardIds);
          }
        } else {
          const finishResult = finishInspection();
          if (!finishResult.success && !finishResult.pending) {
            return;
          }
          if (finishResult.pending) {
            await waitForInspectionZoneChange(latestInspectionCardIds);
          }
        }
        setHoveredCard(null);
      } finally {
        setInspectionBatchAction(null);
      }
    };

    if (!shouldRenderInspectionZone) {
      return null;
    }

    const inspectionTargetById = (targetId: string) =>
      findEnabledBattleActionTargetByTargetId(selectedBattleActionIntents, targetId);
    const inspectionHandTarget = inspectionTargetById(INSPECTION_TARGET_IDS.hand);
    const inspectionWaitingRoomTarget = inspectionTargetById(INSPECTION_TARGET_IDS.waitingRoom);
    const inspectionMainDeckTopTarget = inspectionTargetById(INSPECTION_TARGET_IDS.mainDeckTop);
    const inspectionMainDeckBottomTarget = inspectionTargetById(
      INSPECTION_TARGET_IDS.mainDeckBottom
    );
    const executeInspectionTarget = (
      target: { readonly target: BattleActionTarget } | null
    ): void => {
      if (!target) {
        return;
      }
      executeBattleActionTarget(target.target);
    };

    const inspectionSurfacePositionClass = isOpponent ? 'bottom-[88px]' : 'top-[88px]';

    return (
      <>
        {suppressInspectionForEffectEntry ? (
          <div
            className={cn(
              'pointer-events-none absolute left-1/2 z-[60] -translate-x-1/2 rounded-full border border-[var(--border-active)] bg-[color:color-mix(in_srgb,var(--bg-frosted)_92%,transparent)] px-3 py-1.5 text-[11px] font-semibold text-[var(--text-secondary)] shadow-[var(--shadow-md)] backdrop-blur-xl',
              inspectionSurfacePositionClass
            )}
          >
            检视区等待动画完成
          </div>
        ) : null}
        <div
          aria-hidden={suppressInspectionSurface ? true : undefined}
          data-effect-surface-suppressed={suppressInspectionSurface ? 'true' : undefined}
          className={cn(
            'absolute left-1/2 z-[60] -translate-x-1/2 transition-opacity duration-150',
            suppressInspectionSurface && 'pointer-events-none opacity-0',
            inspectionSurfacePositionClass
          )}
        >
          <div className="flex w-[min(92vw,780px)] flex-col gap-2.5 overflow-hidden rounded-xl border border-[color:color-mix(in_srgb,var(--accent-primary)_30%,var(--border-default))] bg-[color:color-mix(in_srgb,var(--bg-frosted)_94%,transparent)] px-3 py-2.5 shadow-[var(--shadow-lg)] backdrop-blur-xl sm:w-[min(82vw,780px)]">
            <DroppableZone
              id={`${INSPECTION_TARGET_IDS.blocker}-header`}
              className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3"
              activeClassName=""
            >
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--text-secondary)]">
                  检视区
                </span>
                <div className="rounded-full border border-[var(--border-default)] bg-[color:color-mix(in_srgb,var(--bg-surface)_88%,transparent)] px-2 py-1 text-[11px] font-semibold text-[var(--text-secondary)] shadow-[var(--shadow-sm)]">
                  {inspectionZoneView?.count ?? inspectionCardIds.length}
                </div>
              </div>
              {canUseInspectionActions ? (
                <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto sm:items-center">
                  <button
                    type="button"
                    disabled={
                      !canBatchArrangeInspection ||
                      !canUseInspectionActions ||
                      inspectionCardIds.length === 0 ||
                      inspectionBatchAction !== null
                    }
                    onClick={moveAllInspectionCardsToWaitingRoom}
                    className={cn(
                      'inline-flex min-h-8 min-w-0 items-center justify-center gap-1 whitespace-nowrap rounded px-2 py-1 text-[11px] font-medium text-white',
                      canBatchArrangeInspection &&
                        canUseInspectionActions &&
                        inspectionCardIds.length > 0 &&
                        inspectionBatchAction === null
                        ? 'bg-slate-700 hover:bg-slate-600'
                        : 'cursor-not-allowed bg-slate-600'
                    )}
                    title="将检视区全部移入休息室"
                  >
                    <Trash2 size={12} />
                    全放休息室
                  </button>
                  <button
                    type="button"
                    disabled={!canCloseInspection}
                    onClick={closeInspectionByReturningCardsToTop}
                    className={cn(
                      'inline-flex min-h-8 min-w-0 items-center justify-center gap-1 whitespace-nowrap rounded px-2 py-1 text-[11px] font-medium text-white',
                      canCloseInspection
                        ? 'bg-emerald-600 hover:bg-emerald-500'
                        : 'cursor-not-allowed bg-slate-600'
                    )}
                    title="关闭检视区并按当前顺序把牌放回主卡组顶"
                  >
                    <Check size={12} />
                    关闭回顶
                  </button>
                </div>
              ) : null}
            </DroppableZone>

            {hasVisibleInspectionCards ? (
              <div className="grid min-w-0 gap-2 md:grid-cols-[minmax(0,1fr)_3.75rem]">
                <SortableContext items={inspectionCardIds} strategy={horizontalListSortingStrategy}>
                  <DroppableZone
                    id={getDroppableId(ZoneType.INSPECTION_ZONE)}
                    zoneId={createZoneId(ZoneType.INSPECTION_ZONE)}
                    disabled={!canUseInspectionActions}
                    className="relative min-h-[112px] min-w-0 overflow-x-auto rounded-xl border border-dashed border-[color:color-mix(in_srgb,var(--accent-primary)_34%,transparent)] bg-[color:color-mix(in_srgb,var(--bg-overlay)_22%,transparent)] px-2 py-2 sm:min-h-[124px]"
                    activeClassName="outline outline-2 outline-purple-400 bg-purple-500/15"
                    dropTargetClassName="outline outline-2 outline-dashed outline-purple-400/80 bg-purple-500/10"
                  >
                    <div
                      data-animation-zone-id={getDroppableId(ZoneType.INSPECTION_ZONE)}
                      className="pointer-events-none absolute left-2 top-2 h-[84px] w-[60px] rounded-lg opacity-0 sm:h-[96px] sm:w-[68px]"
                    />
                    <div className="flex w-max min-w-full items-start gap-3">
                      {inspectionCardIds.map((cardId, index) => {
                        const viewObject = getCardViewObject(cardId);
                        const card = getVisibleCardPresentation(cardId);
                        const showFront = viewObject?.surface === 'FRONT' && !!card;
                        const imagePath = showFront && card ? card.imagePath : '/back.jpg';

                        return (
                          <CardDetailPressTarget
                            key={cardId}
                            cardId={showFront && card ? card.instanceId : null}
                            disabled={!showFront || !card}
                            className="shrink-0"
                          >
                            <SortableInspectionCard
                              cardId={cardId}
                              imagePath={imagePath}
                              containerClassName={getBattleAnimationOcclusionClass(cardId)}
                              className={cn(
                                getActiveEffectTaskCardClass(cardId),
                                selectedCardId === cardId &&
                                  'ring-2 ring-cyan-300 ring-offset-2 ring-offset-slate-950 shadow-[0_0_18px_rgba(34,211,238,0.68)]'
                              )}
                              disabled={!canUseInspectionActions || !canDragInspectionCard}
                              showActions={canUseInspectionActions}
                              canReveal={canUseInspectionActions && canRevealInspectedCard}
                              isRevealed={isInspectionCardPubliclyRevealed(cardId)}
                              revealIndex={index}
                              onReveal={(targetCardId) => {
                                revealInspectedCard(targetCardId);
                              }}
                              onClick={() => {
                                if (confirmActiveEffectCardFromTable(cardId)) {
                                  return;
                                }
                                if (canUseInspectionActions) {
                                  toggleSelectedCard(cardId);
                                }
                              }}
                            />
                          </CardDetailPressTarget>
                        );
                      })}
                    </div>
                  </DroppableZone>
                </SortableContext>

                {canUseInspectionActions ? (
                  <div
                    className={cn(
                      'grid grid-cols-4 gap-1 md:grid-cols-1',
                      isDragging ? 'opacity-100' : 'opacity-70'
                    )}
                  >
                    <DroppableZone
                      id={INSPECTION_TARGET_IDS.hand}
                      disabled={!canMoveInspectedToZone}
                      title={inspectionHandTarget?.target.label ?? '加入手牌'}
                      ariaLabel="加入手牌"
                      onClick={() => executeInspectionTarget(inspectionHandTarget)}
                      className={cn(
                        'flex min-h-9 items-center justify-center gap-1 rounded-md border border-[var(--border-default)] bg-[color:color-mix(in_srgb,var(--bg-overlay)_38%,transparent)] px-1 text-[10px] font-semibold text-[var(--text-secondary)] md:h-9 md:px-1',
                        inspectionHandTarget &&
                          'cursor-pointer border-cyan-300 bg-cyan-500/15 text-cyan-50 shadow-[0_0_14px_rgba(34,211,238,0.24)]'
                      )}
                      activeClassName="ring-2 ring-inset ring-cyan-300 bg-cyan-500/15 text-cyan-50"
                      dropTargetClassName="ring-2 ring-inset ring-cyan-300/80 bg-cyan-500/10 text-cyan-50"
                    >
                      <Layers3 size={13} className="shrink-0" />
                      <span className="whitespace-nowrap leading-none">手牌</span>
                    </DroppableZone>
                    <DroppableZone
                      id={INSPECTION_TARGET_IDS.waitingRoom}
                      disabled={!canMoveInspectedToZone}
                      title={inspectionWaitingRoomTarget?.target.label ?? '放入休息室'}
                      ariaLabel="放入休息室"
                      onClick={() => executeInspectionTarget(inspectionWaitingRoomTarget)}
                      className={cn(
                        'flex min-h-9 items-center justify-center gap-1 rounded-md border border-[var(--border-default)] bg-[color:color-mix(in_srgb,var(--bg-overlay)_38%,transparent)] px-1 text-[10px] font-semibold text-[var(--text-secondary)] md:h-9 md:px-1',
                        inspectionWaitingRoomTarget &&
                          'cursor-pointer border-slate-200 bg-slate-500/15 text-slate-50 shadow-[0_0_14px_rgba(226,232,240,0.18)]'
                      )}
                      activeClassName="ring-2 ring-inset ring-[color:color-mix(in_srgb,var(--text-secondary)_70%,white)] bg-[color:color-mix(in_srgb,var(--bg-overlay)_58%,transparent)] text-[var(--text-primary)]"
                      dropTargetClassName="ring-2 ring-inset ring-[color:color-mix(in_srgb,var(--text-secondary)_65%,white)] bg-[color:color-mix(in_srgb,var(--bg-overlay)_48%,transparent)] text-[var(--text-primary)]"
                    >
                      <Trash2 size={13} className="shrink-0" />
                      <span className="whitespace-nowrap leading-none">休息</span>
                    </DroppableZone>
                    <DroppableZone
                      id={INSPECTION_TARGET_IDS.mainDeckTop}
                      disabled={!canMoveInspectedToTop}
                      title={inspectionMainDeckTopTarget?.target.label ?? '回卡组顶'}
                      ariaLabel="回卡组顶"
                      onClick={() => executeInspectionTarget(inspectionMainDeckTopTarget)}
                      className={cn(
                        'flex min-h-9 items-center justify-center gap-1 rounded-md border border-[var(--border-default)] bg-[color:color-mix(in_srgb,var(--bg-overlay)_38%,transparent)] px-1 text-[10px] font-semibold text-[var(--text-secondary)] md:h-9 md:px-1',
                        inspectionMainDeckTopTarget &&
                          'cursor-pointer border-amber-300 bg-amber-500/15 text-amber-50 shadow-[0_0_14px_rgba(251,191,36,0.22)]'
                      )}
                      activeClassName="ring-2 ring-inset ring-amber-300 bg-amber-500/15 text-amber-50"
                      dropTargetClassName="ring-2 ring-inset ring-amber-300/80 bg-amber-500/10 text-amber-50"
                    >
                      <ArrowUpToLine size={13} className="shrink-0" />
                      <span className="whitespace-nowrap leading-none">顶</span>
                    </DroppableZone>
                    <DroppableZone
                      id={INSPECTION_TARGET_IDS.mainDeckBottom}
                      disabled={!canMoveInspectedToBottom}
                      title={inspectionMainDeckBottomTarget?.target.label ?? '放卡组底'}
                      ariaLabel="放卡组底"
                      onClick={() => executeInspectionTarget(inspectionMainDeckBottomTarget)}
                      className={cn(
                        'flex min-h-9 items-center justify-center gap-1 rounded-md border border-[var(--border-default)] bg-[color:color-mix(in_srgb,var(--bg-overlay)_38%,transparent)] px-1 text-[10px] font-semibold text-[var(--text-secondary)] md:h-9 md:px-1',
                        inspectionMainDeckBottomTarget &&
                          'cursor-pointer border-[var(--accent-gold)] bg-[color:color-mix(in_srgb,var(--accent-gold)_16%,transparent)] text-[var(--accent-gold-light)] shadow-[0_0_14px_color-mix(in_srgb,var(--accent-gold)_18%,transparent)]'
                      )}
                      activeClassName="ring-2 ring-inset ring-[var(--accent-gold)] bg-[color:color-mix(in_srgb,var(--accent-gold)_16%,transparent)] text-[var(--accent-gold-light)]"
                      dropTargetClassName="ring-2 ring-inset ring-[var(--accent-gold)] bg-[color:color-mix(in_srgb,var(--accent-gold)_10%,transparent)] text-[var(--accent-gold-light)]"
                    >
                      <ArrowDownToLine size={13} className="shrink-0" />
                      <span className="whitespace-nowrap leading-none">底</span>
                    </DroppableZone>
                  </div>
                ) : null}
              </div>
            ) : (
              <DroppableZone
                id={getDroppableId(ZoneType.INSPECTION_ZONE)}
                zoneId={createZoneId(ZoneType.INSPECTION_ZONE)}
                disabled={!canUseInspectionActions}
                className="rounded-lg border border-dashed border-[var(--border-default)] bg-[color:color-mix(in_srgb,var(--bg-overlay)_36%,transparent)] px-4 py-3 text-center text-xs text-[var(--text-muted)]"
                activeClassName="outline outline-2 outline-purple-400 bg-purple-500/15"
                dropTargetClassName="outline outline-2 outline-dashed outline-purple-400/80 bg-purple-500/10"
              >
                {canUseInspectionActions
                  ? '拖到这里移入检视区。检视区已清空时，也可直接关闭。'
                  : '当前检视区暂无可见卡牌。'}
              </DroppableZone>
            )}
          </div>
        </div>
      </>
    );
  };

  // 判断手牌是否可拖拽
  // FREE 的己方整理与当前检视流程可以拖手牌；RULES 的最终合法性仍由 intent/命令政策决定
  const canDragFromHand = allowGeneralOwnZoneInteraction || canReceiveInspectionDrop;

  const renderHandContextActions = () => {
    if (isOpponent || isReadOnly || !isMobileBoard) {
      return null;
    }

    return (
      <motion.div
        data-hand-context-actions
        initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 4, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{
          duration: reduceMotion ? 0.08 : 0.16,
          ease: [0.22, 1, 0.36, 1],
        }}
        className="ml-auto flex min-w-0 items-center gap-1 rounded-lg border border-[var(--border-subtle)] bg-[color:color-mix(in_srgb,var(--bg-frosted)_76%,transparent)] p-0.5 shadow-[var(--shadow-sm)] backdrop-blur"
      >
        {renderDrawActionButton('MOBILE_HAND')}
        {renderReturnSelectedHandCardButton('MOBILE_HAND')}
        {selectedHandCardId && (
          <button
            type="button"
            onClick={() => selectCard(null)}
            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-overlay)] hover:text-[var(--text-primary)]"
            aria-label="取消手牌选择"
            title="取消选择"
          >
            <X size={13} aria-hidden="true" />
          </button>
        )}
      </motion.div>
    );
  };

  // 渲染手牌
  const renderHand = () => {
    if (isOpponent) {
      // 对手手牌显示背面 - 使用真实卡背图片，无动画以避免回合切换时的跳动
      const visibleBackCount = Math.min(displayedHandCount, isMobileBoard ? 8 : 10);
      const backScale =
        visibleBackCount > 7 ? (isMobileBoard ? 0.78 : 0.84) : isMobileBoard ? 0.88 : 0.94;
      const backSpread = isMobileBoard ? 164 : 440;
      const backStep =
        visibleBackCount <= 1
          ? 0
          : Math.min(isMobileBoard ? 24 : 52, backSpread / (visibleBackCount - 1));
      const maxBackRotation = isMobileBoard ? 12 : 18;
      const backRotationStep =
        visibleBackCount <= 1 ? 0 : Math.min(3, maxBackRotation / ((visibleBackCount - 1) / 2));
      return (
        <div
          data-animation-zone-id={getDroppableId(ZoneType.HAND)}
          className="relative h-[88px] w-full overflow-visible py-1 md:h-[104px]"
        >
          {Array.from({ length: visibleBackCount }, (_, idx) => (
            <div
              key={`opponent-hand-back-${idx}`}
              className="absolute bottom-1 h-[84px] w-[60px] overflow-hidden rounded-lg shadow-md"
              style={{
                left: `calc(50% + ${(idx - (visibleBackCount - 1) / 2) * backStep}px)`,
                transform: `translateX(-50%) rotate(${(idx - (visibleBackCount - 1) / 2) * backRotationStep}deg) scale(${backScale})`,
                zIndex: idx,
              }}
            >
              <img src="/back.jpg" alt="Card Back" className="w-full h-full object-cover" />
            </div>
          ))}
          {displayedHandCount > visibleBackCount && (
            <span className="absolute right-2 top-2 rounded-full border border-slate-600 bg-slate-900/80 px-2 py-0.5 text-xs font-bold text-slate-300">
              +{displayedHandCount - visibleBackCount}
            </span>
          )}
        </div>
      );
    }

    // 己方手牌显示正面 (带拖拽，使用纯 CSS 避免动画导致的布局问题)
    const handCount = handCardIds.length;
    const handScale =
      handCount > 14
        ? isMobileBoard
          ? 0.68
          : 0.78
        : handCount > 10
          ? isMobileBoard
            ? 0.76
            : 0.86
          : handCount > 6
            ? isMobileBoard
              ? 0.84
              : 0.94
            : isMobileBoard
              ? 0.96
              : 1;
    const handSpread = isMobileBoard ? 320 : 720;
    const handMaxStep = isMobileBoard
      ? handCount <= 6
        ? 40
        : handCount <= 10
          ? 32
          : 24
      : handCount <= 6
        ? 64
        : handCount <= 10
          ? 54
          : 42;
    const handStep = handCount <= 1 ? 0 : Math.min(handMaxStep, handSpread / (handCount - 1));
    const maxHandRotation = 25;
    const handRotationStep =
      handCount <= 1 ? 0 : Math.min(4, maxHandRotation / ((handCount - 1) / 2));

    return (
      <DroppableZone
        id={getDroppableId(ZoneType.HAND)}
        zoneId={createZoneId(ZoneType.HAND)}
        disabled={!allowGeneralOwnZoneInteraction && !canReceiveInspectionDrop}
        disabledForDragFromZones={DISABLE_ORDINARY_DROP_FROM_INSPECTION}
        className="relative h-[118px] w-full overflow-visible px-3 py-2 md:h-[138px] md:px-4 md:pr-72"
        activeClassName="ring-2 ring-cyan-500 bg-cyan-500/20"
      >
        {handCardIds.map((cardId, idx) => {
          const card = getVisibleCardPresentation(cardId);
          if (!card) return null;

          // 结果阶段切走后，这里会自动退化为只读展示。
          const isDraggable = canDragFromHand;
          const isHandCardSelected = selectedCardId === card.instanceId;
          const activatedAbilityConfigs = getActivatedAbilityUiConfigs(
            card.cardCode,
            CardAbilitySourceZone.HAND
          );
          const canActivateHandAbility =
            activatedAbilityConfigs.length > 0 &&
            viewerSeat === playerSeat &&
            canActivateAbilityCommand &&
            isHandCardSelected;

          return (
            <div
              key={cardId}
              className={cn(
                'absolute bottom-3',
                isDragging ? 'transition-none' : 'transition-[left,transform] duration-300 ease-out'
              )}
              style={{
                left: `calc(50% + ${(idx - (handCount - 1) / 2) * handStep}px)`,
                transform: `translateX(-50%) rotate(${(idx - (handCount - 1) / 2) * handRotationStep}deg) scale(${handScale})`,
                zIndex: idx,
              }}
            >
              <div
                className={cn(
                  isDragging
                    ? 'transition-none'
                    : 'transition-transform duration-200 hover:-translate-y-5 hover:scale-105'
                )}
              >
                <DraggableCard
                  id={cardId}
                  disabled={!isDraggable}
                  data={{ cardId, cardCode: card.cardCode, fromZone: ZoneType.HAND }}
                >
                  <CardDetailPressTarget cardId={card.instanceId}>
                    <Card
                      cardData={card.cardData as AnyCardData}
                      instanceId={card.instanceId}
                      imagePath={card.imagePath}
                      size="sm"
                      faceUp={true}
                      selected={isHandCardSelected}
                      effectVisualState={getEffectVisualState(card, {
                        isActionableNow: canActivateHandAbility,
                      })}
                      className={getActiveEffectTaskCardClass(card.instanceId)}
                      onClick={() => {
                        if (confirmActiveEffectCardFromTable(card.instanceId)) {
                          return;
                        }
                        if (allowGeneralOwnZoneInteraction) {
                          toggleSelectedCard(card.instanceId);
                        }
                      }}
                      showHover={false}
                    />
                  </CardDetailPressTarget>
                </DraggableCard>
                {canActivateHandAbility && (
                  <ActivatedAbilityMenu
                    configs={activatedAbilityConfigs}
                    placement={isOpponent ? 'below' : 'above'}
                    onActivate={(config) => activateCardAbility(card.instanceId, config.abilityId)}
                  />
                )}
              </div>
            </div>
          );
        })}
      </DroppableZone>
    );
  };

  const renderMobileBattleCore = (reversed: boolean = false) => (
    <div
      className="mx-auto flex w-full min-w-0 flex-col items-center gap-2 py-1"
      data-mobile-battle-core
    >
      {reversed ? (
        <>
          <div className="flex items-end gap-1.5 sm:gap-3" data-mobile-member-row>
            {renderMemberSlot(SlotPosition.RIGHT)}
            {renderMemberSlot(SlotPosition.CENTER)}
            {renderMemberSlot(SlotPosition.LEFT)}
          </div>
          {renderLiveZone(true)}
        </>
      ) : (
        <>
          {renderLiveZone()}
          <div className="flex items-start gap-1.5 sm:gap-3" data-mobile-member-row>
            {renderMemberSlot(SlotPosition.LEFT)}
            {renderMemberSlot(SlotPosition.CENTER)}
            {renderMemberSlot(SlotPosition.RIGHT)}
          </div>
        </>
      )}
    </div>
  );

  const renderMobileTabletop = (reversed: boolean = false) => (
    <div
      className="grid h-full min-h-0 grid-cols-[clamp(68px,18vw,76px)_minmax(0,1fr)_clamp(68px,18vw,76px)] items-center gap-1 overflow-visible px-0.5 py-1"
      data-mobile-tabletop
    >
      <div className="self-center justify-self-start">{renderMobileLeftRail()}</div>
      <div className="min-w-0 self-center justify-self-center overflow-visible">
        {renderMobileBattleCore(reversed)}
      </div>
      <div className="self-center justify-self-end">{renderMobileResourcesRail()}</div>
    </div>
  );

  if (isMobileBoard) {
    if (isOpponent) {
      return (
        <div
          className={cn(
            'relative h-full min-h-0 overflow-hidden p-2 transition-colors',
            isActive && 'bg-rose-500/[0.06]',
            'border-b border-slate-700/30'
          )}
        >
          <div className="flex h-full min-h-0 flex-col overflow-hidden">
            <div className="shrink-0">{renderHand()}</div>

            <div className="flex shrink-0 flex-row-reverse items-center gap-2 border-b border-slate-700/30 pb-1">
              <div
                className={cn(
                  'rounded-full px-2 py-0.5 text-xs font-bold',
                  isActive
                    ? 'bg-rose-500/80 text-white'
                    : 'bg-[color:color-mix(in_srgb,var(--bg-surface)_48%,transparent)] text-slate-300'
                )}
              >
                {playerIdentity.name}
              </div>
              <div className="text-[10px] font-medium text-slate-500">
                手牌: {displayedHandCount}
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-visible">{renderMobileTabletop(true)}</div>
          </div>
          {renderInspectionZone()}
        </div>
      );
    }

    return (
      <div
        className={cn(
          'relative h-full min-h-0 overflow-hidden p-2 transition-colors',
          isActive && 'bg-rose-500/[0.06]',
          'border-t border-slate-700/30'
        )}
      >
        <div className="flex h-full min-h-0 flex-col overflow-hidden">
          <div className="min-h-0 flex-1 overflow-visible">{renderMobileTabletop()}</div>

          <div className="flex min-w-0 shrink-0 items-center gap-2 border-t border-slate-700/30 pt-1">
            <div
              className={cn(
                'rounded-full px-2 py-0.5 text-xs font-bold',
                isActive
                  ? 'bg-rose-500/80 text-white'
                  : 'bg-[color:color-mix(in_srgb,var(--bg-surface)_48%,transparent)] text-slate-300'
              )}
            >
              {playerIdentity.name}
            </div>
            <div className="text-[10px] font-medium text-slate-500">手牌: {displayedHandCount}</div>
            {renderHandContextActions()}
          </div>

          <div className="shrink-0">{renderHand()}</div>
        </div>
        {renderInspectionZone()}
      </div>
    );
  }

  // 对手区域：手牌在顶部，成员槽在底部（靠近Live区）
  // 己方区域：成员槽在顶部（靠近Live区），手牌在底部
  // 这样双方成员区中心对称，中间只隔着Live区

  if (isOpponent) {
    return (
      <div
        className={cn(
          'relative h-full flex flex-col p-2 transition-colors',
          isActive && 'bg-rose-500/10',
          'border-b border-slate-700'
        )}
      >
        {/* 对手：手牌和能量区在最上方 */}
        <div className="relative z-0 flex w-full flex-shrink-0 items-center gap-2">
          {/* 能量区 - 右上角 */}
          <div className="absolute right-2 top-2 z-50">{renderEnergyZone()}</div>
          {/* 手牌区 - 居中 */}
          {renderHand()}
        </div>

        {/* 玩家信息 - 紧凑 */}
        <div className="flex items-center gap-2 my-1 flex-shrink-0 flex-row-reverse">
          <div
            className={cn(
              'px-2 py-0.5 rounded-full text-xs font-bold',
              isActive ? 'bg-rose-500 text-white' : 'bg-slate-700 text-slate-300'
            )}
          >
            {playerIdentity.name}
          </div>
          <div className="text-[10px] text-slate-600 font-medium">手牌: {displayedHandCount}</div>
        </div>

        {/* 主区域 - 绝对定位布局（成员槽和Live区在底部，靠近中央分隔线） */}
        {/* 对手区域镜像显示：左右交换，成员槽位顺序反转 */}
        <div className="relative z-10 min-h-0 flex-1 px-2">
          {/* 左侧区域 - 对手的资源区（镜像后在左边，对手的右手边） */}
          <div className="absolute bottom-0 left-2 flex w-[92px] justify-center sm:w-[120px] md:w-[150px]">
            {renderResources(true)}
          </div>

          {/* 中间区域 - 绝对居中（成员槽位 + Live 区） */}
          <div className="absolute left-1/2 -translate-x-1/2 bottom-0">
            <div className="flex flex-col justify-end items-center gap-2">
              {/* 成员槽位 - 镜像顺序：RIGHT → CENTER → LEFT */}
              <div className="flex items-end gap-3 sm:gap-8 md:gap-15">
                {renderMemberSlot(SlotPosition.RIGHT)}
                {renderMemberSlot(SlotPosition.CENTER)}
                {renderMemberSlot(SlotPosition.LEFT)}
              </div>
              {/* Live 区 - 在成员槽位下方，启用镜像 */}
              {renderLiveZone(true)}
            </div>
          </div>

          {/* 右侧区域 - 对手的成功Live区（镜像后在右边，对手的左手边） */}
          <div className="absolute bottom-0 right-2 flex w-[92px] justify-center sm:w-[120px] md:w-[150px]">
            {renderSuccessZone()}
          </div>
        </div>
        {renderInspectionZone()}
      </div>
    );
  }

  // 己方区域：成员槽和Live区在顶部（靠近中央分隔线），手牌在底部
  return (
    <div
      className={cn(
        'relative h-full flex flex-col p-2 transition-colors overflow-x-hidden',
        isActive && 'bg-rose-500/10',
        'border-t border-slate-700'
      )}
    >
      {/* 主区域 - 绝对定位布局（成员槽和Live区在顶部，靠近中央分隔线） */}
      <div className="relative min-h-0 flex-1 px-2">
        {/* 左侧区域 - 绝对定位固定在左边 */}
        <div className="absolute left-2 top-0 flex w-[92px] justify-center sm:w-[120px] md:w-[150px]">
          {renderSuccessZone()}
        </div>

        {/* 中间区域 - 绝对居中（Live 区 + 成员槽位） */}
        <div className="absolute left-1/2 -translate-x-1/2 top-0 overflow-visible">
          <div className="flex flex-col justify-start items-center gap-2">
            {/* Live 区 - 在成员槽位上方 */}
            {renderLiveZone()}
            {/* 成员槽位 */}
            <div className="flex items-start gap-3 sm:gap-8 md:gap-15">
              {renderMemberSlot(SlotPosition.LEFT)}
              {renderMemberSlot(SlotPosition.CENTER)}
              {renderMemberSlot(SlotPosition.RIGHT)}
            </div>
          </div>
        </div>

        {/* 右侧区域 - 绝对定位固定在右边 */}
        <div className="absolute right-2 top-0 flex w-[92px] justify-center sm:w-[120px] md:w-[150px]">
          {renderResources()}
        </div>
      </div>

      {/* 玩家信息 - 紧凑 */}
      <div className="flex items-center gap-2 my-1 flex-shrink-0">
        <div
          className={cn(
            'px-2 py-0.5 rounded-full text-xs font-bold',
            isActive ? 'bg-rose-500 text-white' : 'bg-slate-700 text-slate-300'
          )}
        >
          {playerIdentity.name}
        </div>
        <div className="text-[10px] text-slate-600 font-medium">手牌: {displayedHandCount}</div>
        {renderHandContextActions()}
      </div>

      {/* 己方：手牌和能量区在最下方 */}
      <div className="relative z-10 flex w-full flex-shrink-0 items-center gap-2">
        {/* 能量区 - 左下角 */}
        <div className="absolute left-2 bottom-2 z-50">{renderEnergyZone()}</div>
        {/* 手牌区 - 居中 */}
        {renderHand()}
      </div>

      {renderInspectionZone()}
    </div>
  );
});

export default PlayerArea;
