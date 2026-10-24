import { getPresentationPortalRoot } from '@/lib/appPresentation';
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
 * - 手机端：成员与 LIVE 槽位在左、卡组与休息室在右；成功 LIVE 与能量横排位于成员和手牌之间。
 */

import { memo, useEffect, useLayoutEffect, useRef, useState, type MouseEvent } from 'react';
import { SortableContext, horizontalListSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { motion, useReducedMotion } from 'framer-motion';
import { createPortal } from 'react-dom';
import { useShallow } from 'zustand/react/shallow';
import { cn } from '@/lib/utils';
import {
  buildBattleActionIntents,
  canUseLegacyManualDropFallback,
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
import { shouldShowLimitedActivatedAbilityHighlight } from '@/lib/limitedActivatedAbilityVisuals';
import { getCardLocalizedInfo } from '@/lib/cardLocalization';
import {
  getEnergyBelowCardZIndex,
  getMainMemberCardZIndex,
  getMemberBelowCardZIndex,
} from '@/lib/memberStackLayout';
import { HEART_REQUIREMENT_ICON_SOURCE_BY_COLOR } from '@/lib/modifierIconAssets';
import {
  collectWaitingRoomJudgmentStats,
  hasWaitingRoomJudgmentStats,
} from '@/lib/waitingRoomJudgmentStats';
import { createScopedZoneId, createZoneId } from '@/lib/zoneUtils';
import {
  BATTLE_UI_ANCHORS,
  getBattleDeckAnchor,
  getBattleEnergyZoneAnchor,
  getBattleHandAnchor,
  getBattleLiveZoneAnchor,
  getBattlePlayerAreaAnchor,
  getBattleStageAnchor,
  getBattleSuccessLiveZoneAnchor,
  getBattleWaitingRoomAnchor,
  type BattleUiAnchorId,
} from '@/lib/battleUiAnchors';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { useGameStore } from '@/store/gameStore';
import { useAbilityActivationMotion } from './AbilityActivationMotion';
import { GameCommandType } from '@game/application/game-commands';
import { isOwnDeskFreeDragWindow } from '@game/application/command-availability';
import {
  CardAbilitySourceZone,
  getActivatedAbilityUiConfigs,
  isActivatedAbilityUiConfigAvailableForOrientation,
} from '@game/application/card-effect-runner';
import { Card } from '@/components/card/Card';
import { CardEffectText } from '@/components/card/CardEffectText';
import { CardModifierBadgeStack } from '@/components/card/CardModifierBadgeStack';
import { CardDetailPressTarget } from './CardDetailPressTarget';
import { HandLayout } from './HandLayout';
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
  EyeOff,
  Hand,
  Layers3,
  Maximize2,
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

export interface SelectedHandCardAction {
  readonly id: string;
  readonly text: string;
  readonly title?: string;
  readonly align?: 'left' | 'center';
}

interface PlayerAreaProps {
  playerSeat: Seat;
  isOpponent: boolean;
  isActive: boolean;
  suppressActiveEffectVisuals?: boolean;
  interactionSuspended?: boolean;
  isInspectionZoneCollapsed: boolean;
  onInspectionZoneCollapsedChange: (collapsed: boolean) => void;
  selectedHandCardActionCardId?: string | null;
  selectedHandCardActions?: readonly SelectedHandCardAction[];
  suppressSelectedHandCardActionMenu?: boolean;
  onSelectedHandCardAction?: (cardId: string, actionId: string) => void;
  onPlayMemberToSlot?: (cardId: string, targetSlot: SlotPosition) => void;
}

const INSPECTION_TARGET_IDS = {
  hand: 'inspection-target-hand',
  waitingRoom: 'inspection-target-waiting-room',
  mainDeckTop: 'inspection-target-main-deck-top',
  mainDeckBottom: 'inspection-target-main-deck-bottom',
  blocker: 'inspection-target-blocker',
} as const;
const DISABLE_ORDINARY_DROP_FROM_INSPECTION = [ZoneType.INSPECTION_ZONE] as const;
const ZONE_LABEL_CLASS = 'battle-zone-label';

interface CardActionMenuItem {
  readonly id: string;
  readonly text: string;
  readonly title?: string;
  readonly align?: 'left' | 'center';
  readonly execute: () => void;
}

const CardActionMenu = memo(function CardActionMenu({
  items,
  suspended = false,
  placement = 'above',
  layer = 'battle',
  anchor,
}: {
  readonly items: readonly CardActionMenuItem[];
  readonly suspended?: boolean;
  readonly placement?: 'above' | 'below';
  readonly layer?: 'battle' | 'modal';
  readonly anchor?: BattleUiAnchorId;
}) {
  const preferredWidth = Math.min(
    420,
    Math.max(
      100,
      items.reduce((longest, item) => Math.max(longest, Array.from(item.text).length), 0) * 14 + 32
    )
  );
  const anchorRef = useRef<HTMLSpanElement>(null);
  const [layout, setLayout] = useState<{
    readonly left: number;
    readonly top: number;
    readonly width: number;
    readonly maxHeight: number;
  } | null>(null);

  useEffect(() => {
    if (suspended || items.length === 0) {
      setLayout(null);
      return;
    }

    const updateLayout = () => {
      const anchor = anchorRef.current;
      if (!anchor) return;
      const rect = anchor.getBoundingClientRect();
      const viewportPadding = 8;
      const gap = 4;
      const width = Math.max(1, Math.min(preferredWidth, window.innerWidth - viewportPadding * 2));
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
  }, [items.length, placement, preferredWidth, suspended]);

  if (suspended || items.length === 0) return null;
  return (
    <>
      <span ref={anchorRef} className="pointer-events-none absolute inset-0" aria-hidden="true" />
      {layout &&
        createPortal(
          <div
            data-battle-animation-ignore="true"
            data-battle-ui-anchor={anchor}
            className={cn(
              'battle-table fixed flex flex-col gap-1 overflow-y-auto overscroll-contain',
              layer === 'modal'
                ? 'z-[var(--z-battle-modal-action-menu)]'
                : 'z-[var(--z-battle-action-menu)]'
            )}
            style={{
              left: layout.left,
              top: layout.top,
              width: layout.width,
              maxHeight: layout.maxHeight,
              transform: placement === 'above' ? 'translate(-50%, -100%)' : 'translate(-50%, 0)',
            }}
          >
            {items.map((item) => (
              <button
                key={item.id}
                type="button"
                className={cn(
                  'w-full shrink-0 rounded-md border border-rose-300/70 bg-white/95 px-3 py-1.5 font-semibold text-rose-600 shadow-lg',
                  item.align === 'center' ? 'text-center' : 'text-left',
                  'transition-colors hover:bg-rose-50 active:scale-[0.99]'
                )}
                style={{ fontSize: '12px', lineHeight: 1.25 }}
                onClick={(event) => {
                  event.stopPropagation();
                  item.execute();
                }}
                title={item.title}
              >
                <CardEffectText as="span" text={item.text} />
              </button>
            ))}
          </div>,
          getPresentationPortalRoot()
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
            'battle-card-face aspect-[5/7] w-[60px] touch-none select-none overflow-hidden border border-[var(--border-default)] bg-[var(--bg-overlay)] shadow-[var(--shadow-md)] sm:w-[68px]',
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
  interactionSuspended = false,
  isInspectionZoneCollapsed,
  onInspectionZoneCollapsedChange,
  selectedHandCardActionCardId = null,
  selectedHandCardActions = [],
  suppressSelectedHandCardActionMenu = false,
  onSelectedHandCardAction,
  onPlayMemberToSlot,
}: PlayerAreaProps) {
  const { activateCardAbility, activatingCardId } = useAbilityActivationMotion();
  const battlePlayerSide = isOpponent ? 'opponent' : 'self';
  const playerIdentity = useGameStore((s) => s.getPlayerIdentityForSeat(playerSeat));
  const viewerSeat = useGameStore((s) => s.getViewerSeat());
  const matchView = useGameStore((s) => s.getMatchView());
  const hasOwnedInspectionContext = useGameStore((s) => s.isInspectionOpenForViewer());
  const currentPhase = useGameStore((s) => s.getCurrentPhaseView());
  const currentSubPhase = useGameStore((s) => s.getCurrentSubPhaseView()) ?? SubPhase.NONE;
  const isMobileBoard = useMediaQuery('(max-width: 767px)');
  const desktopCoreRef = useRef<HTMLDivElement>(null);
  const desktopHandRowRef = useRef<HTMLDivElement>(null);
  const hasPlayerIdentity = playerIdentity !== null;
  useLayoutEffect(() => {
    const row = desktopHandRowRef.current;
    if (isMobileBoard || !hasPlayerIdentity || !row) return;
    const hand = row.querySelector<HTMLElement>('.battle-hand-zone');
    const energy = row.querySelector<HTMLElement>('[data-battle-ui-anchor="self-energy-zone"]');
    let phase = row
      .closest('[data-battle-ui-anchor="battle-board"]')
      ?.querySelector<HTMLElement>('[data-battle-ui-anchor="phase-controls"]');
    const summary = row.parentElement?.querySelector<HTMLElement>('[data-hand-owner-summary]');
    if (!hand || !energy) return;
    const measure = () => {
      const bounds = row.getBoundingClientRect();
      const start = Math.max(16, energy.getBoundingClientRect().right - bounds.left + 12);
      const end = phase ? Math.max(16, bounds.right - phase.getBoundingClientRect().left + 12) : 16;
      // A narrow desktop puts cards above the fixed phase toolbar instead of
      // collapsing the browsing window between two large sets of controls.
      const stacked = bounds.width - start - end < 180;
      hand.style.setProperty('--battle-hand-start', `${start}px`);
      hand.style.setProperty(
        '--battle-hand-end',
        `${stacked && summary ? Math.max(16, bounds.right - summary.getBoundingClientRect().left + 12) : stacked ? 16 : end}px`
      );
      hand.style.setProperty(
        '--battle-hand-clearance',
        stacked && phase ? `${phase.getBoundingClientRect().height + 8}px` : '0px'
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(row);
    observer.observe(energy);
    if (phase) observer.observe(phase);
    if (summary) observer.observe(summary);
    // The phase controls are portalled into a later sibling's ref on first mount.
    // Bind after that commit, while keeping all geometry scoped to this board.
    let mounted = true;
    queueMicrotask(() => {
      if (!mounted) return;
      const controls = row
        .closest('[data-battle-ui-anchor="battle-board"]')
        ?.querySelector<HTMLElement>('[data-battle-ui-anchor="phase-controls"]');
      if (controls && controls !== phase) {
        phase = controls;
        observer.observe(controls);
        measure();
      }
    });
    window.addEventListener('resize', measure);
    return () => {
      mounted = false;
      observer.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [isMobileBoard, hasPlayerIdentity]);

  useLayoutEffect(() => {
    const core = desktopCoreRef.current;
    if (isMobileBoard || !hasPlayerIdentity || !core) return;
    const measure = () => {
      const liveZone = core.querySelector<HTMLElement>('.battle-live-zone');
      if (!liveZone) return;
      // 成员优先占用主战场；LIVE 向 VS 延伸的部分由负外边距收回，不挤占成员高度。
      // 两侧资源各 150px、边距共 32px、两段列间距各 60px。
      const columnWidth = Math.max(80, Math.min(140, (core.clientWidth - 332 - 120) / 3));
      const availableHeight = Math.floor(core.getBoundingClientRect().height);
      const liveStyle = getComputedStyle(liveZone);
      const liveLayoutHeight =
        liveZone.getBoundingClientRect().height +
        parseFloat(liveStyle.marginTop) +
        parseFloat(liveStyle.marginBottom);
      const memberHeight = availableHeight - liveLayoutHeight - 8;
      const width = Math.max(56, Math.min(columnWidth, memberHeight / (7 / 5)));
      core.style.setProperty('--battle-stage-column-width', `${columnWidth}px`);
      core.style.setProperty('--battle-stage-card-width', `${width}px`);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(core);
    return () => observer.disconnect();
  }, [isMobileBoard, hasPlayerIdentity]);
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
  const canUnsetLiveCard = useGameStore((s) => s.canUseAction(GameCommandType.UNSET_LIVE_CARD));
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
    moveMemberToSlot,
    attachEnergyToMember,
    setLiveCard,
    unsetLiveCard,
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
    isCardInCommandScope,
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
      moveMemberToSlot: s.moveMemberToSlot,
      attachEnergyToMember: s.attachEnergyToMember,
      setLiveCard: s.setLiveCard,
      unsetLiveCard: s.unsetLiveCard,
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
      isCardInCommandScope: s.isCardInCommandScope,
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
  const [isChoosingHandCardToReturn, setIsChoosingHandCardToReturn] = useState(false);
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
    setIsChoosingHandCardToReturn(false);
    returningHandCardToTopRef.current = false;
    setIsReturningHandCardToTop(false);
    if (returningHandCardToTopTimeoutRef.current !== null) {
      window.clearTimeout(returningHandCardToTopTimeoutRef.current);
      returningHandCardToTopTimeoutRef.current = null;
    }
  }, [handCardSignature, matchView?.seq]);

  useEffect(() => {
    setIsChoosingHandCardToReturn(false);
  }, [
    matchView?.manualOperation?.mode,
    currentPhase,
    currentSubPhase,
    playerSeat,
    viewerSeat,
    canReturnHandCardToTop,
  ]);

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
  const isFreeOperationMode = canUseLegacyManualDropFallback(matchView?.manualOperation?.mode);
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
  if (
    canUnsetLiveCard &&
    selectedCardId &&
    isCardInCommandScope(GameCommandType.UNSET_LIVE_CARD, selectedCardId)
  ) {
    availableBattleActionCommandTypes.push(GameCommandType.UNSET_LIVE_CARD);
  }
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
    isFreeOperationMode &&
    !isOpponent &&
    mainDeckCardIds.length > 0 &&
    allowGeneralOwnZoneInteraction &&
    canDrawCardToHand;
  const canStartReturningHandCard =
    isFreeOperationMode &&
    handCardIds.length > 0 &&
    allowGeneralOwnZoneInteraction &&
    canReturnHandCardToTop &&
    !isReturningHandCardToTop;

  const handleDrawFromMainDeck = () => {
    if (!canDrawFromMainDeck) return;
    drawCardToHand();
  };

  const handleReturnHandCard = (cardId: string) => {
    if (
      !handCardIds.includes(cardId) ||
      returningHandCardToTopRef.current ||
      !canStartReturningHandCard
    ) {
      return;
    }

    setIsChoosingHandCardToReturn(false);
    returningHandCardToTopRef.current = true;
    setIsReturningHandCardToTop(true);
    const result = returnHandCardToTop(cardId);
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

  const returnSelectedHandCardTitle = !canStartReturningHandCard
    ? handCardIds.length === 0
      ? '没有可放回的手牌'
      : '当前不能放回牌库顶'
    : isChoosingHandCardToReturn
      ? '取消选择要放回的手牌'
      : selectedHandCardId
        ? '将所选手牌放回主卡组顶'
        : '点击后选择一张手牌放回主卡组顶';

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
        className={cn('battle-mini-action', isMobileHandAction ? 'w-10 px-1' : 'w-16 px-2')}
        aria-label="从主卡组抽一张牌"
        title={canDrawFromMainDeck ? '抽 1 张：主卡组顶 → 手牌' : '当前不能抽牌'}
      >
        {isMobileHandAction ? '抽 1' : '抽 1 张'}
      </button>
    );
  };

  const returnHandCardPrompt = isChoosingHandCardToReturn ? (
    <span
      role="status"
      className={cn(
        'battle-zone-label pointer-events-none absolute bottom-full z-30 mb-1',
        isMobileBoard ? 'right-0' : 'right-4'
      )}
    >
      点选一张手牌放回卡组顶
    </span>
  ) : null;

  const renderReturnSelectedHandCardButton = (placement: 'DESKTOP_DECK' | 'MOBILE_HAND') => {
    const isMobileHandAction = placement === 'MOBILE_HAND';

    return (
      <>
        <button
          type="button"
          data-return-selected-hand-card
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            if (selectedHandCardId) {
              handleReturnHandCard(selectedHandCardId);
            } else {
              setIsChoosingHandCardToReturn((choosing) => !choosing);
            }
          }}
          disabled={!canStartReturningHandCard}
          className={cn(
            'battle-mini-action min-w-0',
            isMobileHandAction ? 'gap-1 px-2' : 'w-20 px-1'
          )}
          aria-label={isChoosingHandCardToReturn ? '取消放回卡组顶' : '将所选手牌放回牌库顶'}
          aria-pressed={isChoosingHandCardToReturn}
          title={returnSelectedHandCardTitle}
        >
          {isMobileHandAction && (
            <ArrowUpToLine size={12} className="shrink-0" aria-hidden="true" />
          )}
          <span className="whitespace-nowrap">
            {isChoosingHandCardToReturn
              ? '取消放回'
              : isMobileHandAction
                ? '放回卡组顶'
                : '放回牌库顶'}
          </span>
        </button>
        {isMobileHandAction && returnHandCardPrompt}
      </>
    );
  };

  const executeBattleActionTarget = (target: BattleActionTarget) => {
    const payload = target.commandPayload;
    if (!payload) {
      return;
    }
    executeBattleActionPayload(payload, {
      playMemberToSlot: onPlayMemberToSlot ?? playMemberToSlot,
      moveMemberToSlot,
      attachEnergyToMember,
      setLiveCard,
      unsetLiveCard,
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
    const activatedAbilityConfigs = (
      cardViewObject?.activatedAbilityUiConfigs ??
      (cardViewObject?.activatedAbilityUiConfig
        ? [cardViewObject.activatedAbilityUiConfig]
        : getActivatedAbilityUiConfigs(card?.cardCode, CardAbilitySourceZone.STAGE_MEMBER))
    ).filter((config) => isActivatedAbilityUiConfigAvailableForOrientation(config, orientation));
    const canActivateAbility =
      card !== null &&
      activatedAbilityConfigs.length > 0 &&
      selectedCardId === card.instanceId &&
      !isOpponent &&
      viewerSeat === playerSeat &&
      canActivateAbilityCommand;
    const limitedActivatedHighlight = shouldShowLimitedActivatedAbilityHighlight({
      hasRemainingLimitedActivatedAbility:
        cardViewObject?.hasRemainingLimitedActivatedAbility === true,
      isOpponent,
      viewerSeat,
      playerSeat,
      activeSeat: matchView?.activeSeat ?? null,
      currentPhase,
      currentSubPhase,
      canActivateAbilityCommand,
      hasActiveEffect: activeEffect !== null,
    });
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
      <div
        key={position}
        data-battle-ui-anchor={getBattleStageAnchor(
          battlePlayerSide,
          position === SlotPosition.LEFT
            ? 'left'
            : position === SlotPosition.CENTER
              ? 'center'
              : 'right'
        )}
        className={cn(
          'relative flex flex-col items-center md:w-[var(--battle-stage-column-width,140px)]',
          cardId !== null && activatingCardId === cardId && 'z-20'
        )}
      >
        {/* 卡牌堆叠容器 - 使用 relative 定位实现重叠效果 */}
        <div className="relative aspect-[5/7] w-[var(--battle-mobile-stage-card-width,clamp(56px,17vw,78px))] md:w-[var(--battle-stage-card-width,140px)]">
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
                  zIndex: getEnergyBelowCardZIndex(reverseIndex),
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
                      'battle-card-face w-full h-full overflow-hidden shadow-md cursor-grab active:cursor-grabbing',
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
                  zIndex: getMemberBelowCardZIndex(energyBelowIds.length, reverseIndex),
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
                      'battle-card-face w-full h-full overflow-hidden shadow-md cursor-grab active:cursor-grabbing',
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
              // 桌面尺寸由成员与 LIVE 区共同可用的高度决定。
              'w-[var(--battle-mobile-stage-card-width,clamp(56px,17vw,78px))] aspect-[5/7] battle-card-slot md:w-[var(--battle-stage-card-width,140px)]',
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
              // 确保成员卡在所有下方卡之上
              'relative'
            )}
            style={{
              zIndex: getMainMemberCardZIndex(energyBelowIds.length, memberBelowIds.length),
            }}
            activeClassName="ring-2 ring-rose-500 bg-rose-500/20 border-rose-500"
            title={selectedSlotAction?.target.label}
            onClick={handleSlotClick}
          >
            {card && (
              <DraggableCard
                id={card.instanceId}
                disabled={!allowGeneralOwnZoneInteraction}
                className="h-full w-full"
                data={{
                  cardId: card.instanceId,
                  cardCode: card.cardCode,
                  fromZone: ZoneType.MEMBER_SLOT,
                }}
                onDoubleClick={handleDoubleClick}
              >
                <CardDetailPressTarget
                  cardId={card.instanceId}
                  className={cn(
                    'h-full w-full',
                    isMobileBoard && 'flex items-center justify-center'
                  )}
                >
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
                    limitedActivatedHighlight={limitedActivatedHighlight}
                    className={cn(
                      isMobileBoard && 'aspect-[5/7] h-auto',
                      isMobileBoard &&
                        orientation === OrientationState.WAITING &&
                        'mx-auto w-[min(100%,calc((var(--battle-mobile-stage-column-width)_-_2px)*5/7))]',
                      getActiveEffectTaskCardClass(card.instanceId)
                    )}
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
              <CardActionMenu
                suspended={interactionSuspended || activatingCardId === card.instanceId}
                anchor={BATTLE_UI_ANCHORS.ACTIVATED_ABILITY_MENU}
                items={activatedAbilityConfigs.map((config) => ({
                  id: config.abilityInstanceId ?? config.abilityId,
                  text: config.text,
                  title: config.title,
                  execute: () =>
                    activateCardAbility(
                      card.instanceId,
                      config.abilityId,
                      config.abilityInstanceId
                    ),
                }))}
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

  const renderEnergyOrientationControls = () => {
    const activeCount = energyZoneCardIds.filter((id) => {
      return getEnergyCardOrientation(id) === OrientationState.ACTIVE;
    }).length;
    const canUseEnergyControls =
      allowGeneralOwnZoneInteraction && canTapEnergy && energyZoneCardIds.length > 0;
    const hasWaitingEnergy = energyZoneCardIds.some((id) => {
      return getEnergyCardOrientation(id) !== OrientationState.ACTIVE;
    });
    const hasActiveEnergy = activeCount > 0;

    return (
      <div className="battle-mini-action-group" role="group" aria-label="批量调整能量状态">
        <button
          type="button"
          className="battle-mini-action px-1"
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
          className="battle-mini-action px-1"
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
          <div className="battle-card-mini absolute inset-0 transform translate-x-0.5 translate-y-0.5 opacity-50 overflow-hidden">
            <img src="/back.jpg" alt="" className="w-full h-full object-cover" />
          </div>
        )}
        {/* 顶层卡牌 */}
        <div
          data-object-id={topCardId ? `obj_${topCardId}` : undefined}
          className="battle-card-mini absolute inset-0 overflow-hidden shadow-md"
        >
          <img src="/back.jpg" alt={label} className="w-full h-full object-cover" />
        </div>
      </>
    );

    return (
      <DroppableZone
        id={deckDroppableId}
        zoneId={zoneId}
        battleUiAnchor={getBattleDeckAnchor(battlePlayerSide, deckType)}
        disabled={!allowGeneralOwnZoneInteraction && !(isMainDeck && canReceiveInspectionDrop)}
        disabledForDragFromZones={DISABLE_ORDINARY_DROP_FROM_INSPECTION}
        className="flex flex-col items-center gap-0.5"
        activeClassName="ring-2 ring-amber-500 bg-amber-500/20"
      >
        <span className={cn(ZONE_LABEL_CLASS, 'battle-resource-label')}>{label}</span>
        <div
          data-animation-zone-id={deckDroppableId}
          className={cn(
            'battle-deck-pile battle-resource-pile relative',
            isMainDeck &&
              canClickMainDeck &&
              'battle-card-mini cursor-pointer hover:ring-2 hover:ring-purple-400'
          )}
          onClick={handleClick}
        >
          {count > 0 && (
            <>
              {/* 能量卡组：顶层卡牌可拖拽 */}
              {!isMainDeck && topCardId ? (
                <DraggableCard
                  id={topCardId}
                  className="relative block h-full w-full"
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
          <div className="battle-zone-label battle-zone-count battle-zone-count-overlay absolute -bottom-1 left-1/2 z-10 -translate-x-1/2">
            {count}
          </div>
        </div>
        {isMainDeck && isFreeOperationMode && !isOpponent && !isReadOnly && !isMobileBoard && (
          <div className="relative mt-1 h-[60px] w-10">
            <div className="absolute right-0 top-0 flex flex-col items-end gap-1">
              {renderDrawActionButton('DESKTOP_DECK')}
              {renderReturnSelectedHandCardButton('DESKTOP_DECK')}
            </div>
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
        battleUiAnchor={getBattleWaitingRoomAnchor(battlePlayerSide)}
        disabled={!allowGeneralOwnZoneInteraction && !canReceiveInspectionDrop}
        disabledForDragFromZones={DISABLE_ORDINARY_DROP_FROM_INSPECTION}
        className="relative flex flex-col items-center gap-0.5"
        activeClassName="ring-2 ring-slate-500 bg-slate-500/20"
      >
        <span className={cn(ZONE_LABEL_CLASS, 'battle-resource-label')}>休息室</span>

        {count === 0 ? (
          // 空休息室占位
          <div
            data-animation-zone-id={waitingRoomDroppableId}
            className="battle-waiting-room-pile battle-resource-pile flex items-center justify-center border border-dashed border-[var(--border-default)] bg-[color:color-mix(in_srgb,var(--bg-overlay)_40%,transparent)]"
          >
            <span className="battle-zone-label battle-zone-count battle-zone-count-overlay">0</span>
          </div>
        ) : (
          // 卡片叠放显示，点击展开
          <>
            <div
              data-animation-zone-id={waitingRoomDroppableId}
              className="battle-waiting-room-pile battle-resource-pile relative cursor-pointer transition-transform duration-200 hover:-translate-y-0.5"
              onClick={() => setWaitingRoomExpanded(true)}
            >
              {/* 叠放的迷你卡片 */}
              {waitingRoomCards.slice(0, 5).map(({ cardId, card }, idx: number) => {
                return (
                  <div
                    key={cardId}
                    className="absolute flex h-full w-full items-center justify-center overflow-hidden battle-card-mini border border-[var(--border-default)] bg-[var(--bg-overlay)] shadow-[var(--shadow-sm)]"
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
              <div className="battle-zone-label battle-zone-count battle-zone-count-overlay absolute -bottom-1 left-1/2 z-10 -translate-x-1/2">
                {count}
              </div>
            </div>

            {/* 展开的浮窗 */}
            {!interactionSuspended &&
              waitingRoomExpanded &&
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
                      className="battle-table pointer-events-auto fixed inset-0 z-[var(--z-battle-modal)] flex items-end justify-center p-2 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-[max(0.75rem,env(safe-area-inset-top))] sm:p-4 md:items-center"
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
                            // Leave room for a parallel activation lift at the first/last row.
                            'touch-scroll cute-scrollbar min-h-0 flex-1 overflow-y-auto px-6 pt-8 md:pt-10',
                            canMoveWaitingRoomCardToHandFromModal ? 'pb-28' : 'pb-10'
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
                                  className={cn(
                                    'relative flex min-w-0 flex-col items-center',
                                    activatingCardId === cardId && 'z-20'
                                  )}
                                >
                                  {waitingRoomCardContent}
                                  {canActivateWaitingRoomAbility && (
                                    <CardActionMenu
                                      suspended={
                                        interactionSuspended || activatingCardId === card.instanceId
                                      }
                                      layer="modal"
                                      items={activatedAbilityConfigs.map((config) => ({
                                        id: config.abilityInstanceId ?? config.abilityId,
                                        text: config.text,
                                        title: config.title,
                                        execute: () => {
                                          activateCardAbility(
                                            card.instanceId,
                                            config.abilityId,
                                            config.abilityInstanceId,
                                            closeWaitingRoom
                                          );
                                        },
                                      }))}
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
                              <div className="flex h-12 w-[34px] shrink-0 items-center justify-center overflow-hidden battle-card-mini border border-[var(--border-default)] bg-[var(--bg-overlay)] shadow-[var(--shadow-sm)]">
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
                                <div className="text-[10px] font-semibold text-[var(--text-muted)]">
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
                  : createPortal(waitingRoomModal, getPresentationPortalRoot());
              })()}
          </>
        )}
      </DroppableZone>
    );
  };

  // 成功 LIVE 在两端共用横置牌面与叠放逻辑，尺寸由牌桌样式统一分配。
  const renderSuccessZone = () => (
    <DroppableZone
      id={getDroppableId(ZoneType.SUCCESS_ZONE)}
      zoneId={createZoneId(ZoneType.SUCCESS_ZONE)}
      battleUiAnchor={getBattleSuccessLiveZoneAnchor(battlePlayerSide)}
      disabled={isReadOnly || isOpponent}
      disabledForDragFromZones={DISABLE_ORDINARY_DROP_FROM_INSPECTION}
      className={cn(
        'battle-success-zone relative flex shrink-0 flex-col items-center gap-0.5',
        isMobileBoard && 'battle-support-zone px-1 py-1'
      )}
      activeClassName="ring-2 ring-green-500 bg-green-500/20"
    >
      <div className="battle-zone-header">
        <span className={ZONE_LABEL_CLASS}>{isMobileBoard ? '成功 Live' : '成功 Live 卡区'}</span>
      </div>
      <div className="battle-success-stack relative">
        {[0, 1, 2].map((slotIndex) => {
          const cardId = successCardIds[slotIndex];
          const card = cardId ? getVisibleCardPresentation(cardId) : null;

          return (
            <div
              key={slotIndex}
              className="battle-success-slot absolute flex items-center justify-center"
              style={{
                top: `calc(var(--battle-success-step-y) * ${slotIndex})`,
                left: 0,
                zIndex: 2 - slotIndex,
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
                          'battle-success-card',
                          getActiveEffectTaskCardClass(card.instanceId)
                        )}
                        onClick={() => confirmActiveEffectCardFromTable(card.instanceId)}
                      />
                    </div>
                  </CardDetailPressTarget>
                </DraggableCard>
              ) : (
                <div className="battle-card-face flex h-full w-full items-center justify-center border border-dashed border-slate-600/60 bg-slate-800/20">
                  <span className="text-[9px] text-slate-600">♪</span>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </DroppableZone>
  );

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

    return <div className="flex shrink-0 items-start gap-2">{content}</div>;
  };

  const renderMobileSupportRow = () => (
    <div
      className="flex w-full min-w-0 shrink-0 items-stretch gap-2"
      data-mobile-battle-support-row
    >
      {renderSuccessZone()}
      {renderEnergyZone()}
    </div>
  );

  const renderMobileResourcesRail = () => (
    <div
      className="battle-mobile-resources flex w-16 flex-col items-center gap-1 rounded-lg border border-[color:color-mix(in_srgb,var(--border-default)_28%,transparent)] bg-[color:color-mix(in_srgb,var(--bg-frosted)_8%,transparent)] px-1 py-0.5"
      data-mobile-battle-resources-rail
    >
      {renderDeck(mainDeckZoneView?.count ?? mainDeckCardIds.length, '主卡组', 'main')}
      {renderWaitingRoom()}
      {renderDeck(energyDeckZoneView?.count ?? energyDeckCardIds.length, '能量卡组', 'energy')}
    </div>
  );

  const renderEnergyZone = () => {
    // 保留区域中的原有顺序；状态切换只改变该牌的朝向与视觉反馈。
    const energyCards = energyZoneCardIds.slice(0, 12);
    const energyCount = energyZoneView?.count ?? energyZoneCardIds.length;
    const activeCount = energyZoneCardIds.filter((id) => {
      return getEnergyCardOrientation(id) === OrientationState.ACTIVE;
    }).length;
    const showEnergyControls = !isReadOnly && !isOpponent && isFreeOperationMode;
    const canToggleEnergy = allowGeneralOwnZoneInteraction && canTapEnergy;

    return (
      <DroppableZone
        id={getDroppableId(ZoneType.ENERGY_ZONE)}
        zoneId={createZoneId(ZoneType.ENERGY_ZONE)}
        battleUiAnchor={getBattleEnergyZoneAnchor(battlePlayerSide)}
        disabled={!allowGeneralOwnZoneInteraction}
        disabledForDragFromZones={DISABLE_ORDINARY_DROP_FROM_INSPECTION}
        className={cn(
          'battle-support-zone flex h-[92px] min-w-0 flex-col gap-0.5 rounded-lg border border-indigo-300/20 bg-indigo-500/[0.055] px-1 py-1',
          isMobileBoard ? 'flex-1' : 'w-[clamp(172px,24vw,300px)]'
        )}
        activeClassName="ring-2 ring-indigo-500 bg-indigo-500/20"
      >
        <div className="battle-zone-header justify-between gap-1">
          <div className={ZONE_LABEL_CLASS}>
            <span>能量区</span>
            <span className="battle-zone-count">
              {activeCount}/{energyCount}
            </span>
          </div>
          {showEnergyControls && renderEnergyOrientationControls()}
        </div>
        <div className="relative grid min-h-0 min-w-0 max-w-[280px] flex-1 grid-cols-[repeat(11,minmax(0,1fr))_50.4px] items-center px-1">
          {energyCards.map((cardId, index) => {
            const card = getVisibleCardPresentation(cardId);
            const imagePath = card?.imagePath ?? null;
            const isActive = getEnergyCardOrientation(cardId) === OrientationState.ACTIVE;
            const skipsNextActivePhase = getCardViewObject(cardId)?.skipsNextActivePhase === true;

            return (
              <div key={cardId} className="relative h-[52px] min-w-0" style={{ zIndex: index + 1 }}>
                <DraggableCard
                  id={cardId}
                  disabled={!allowGeneralOwnZoneInteraction}
                  hasInteractiveChild
                  data={{ cardId, cardCode: card?.cardCode, fromZone: ZoneType.ENERGY_ZONE }}
                  className={cn(
                    'absolute left-0 top-0 flex h-full items-center justify-center',
                    isActive ? 'w-9' : 'w-[50.4px]'
                  )}
                >
                  <CardDetailPressTarget cardId={card?.instanceId ?? null} disabled={!card}>
                    <button
                      type="button"
                      data-card-id={card?.instanceId}
                      data-object-id={card ? `obj_${card.instanceId}` : undefined}
                      aria-label={`能量 ${index + 1}，${isActive ? '活跃' : '待机'}`}
                      aria-pressed={!isActive}
                      aria-disabled={!canToggleEnergy}
                      tabIndex={canToggleEnergy ? 0 : -1}
                      className={cn(
                        'relative block h-[50.4px] w-9 overflow-hidden battle-card-mini border border-indigo-200/40 shadow-sm transition-[rotate,scale,transform,filter,opacity] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:duration-75 focus-visible:outline-2 focus-visible:outline-indigo-400',
                        canToggleEnergy && !isDragging
                          ? 'cursor-pointer active:scale-95'
                          : 'cursor-default',
                        !isActive && 'rotate-90 opacity-45 grayscale',
                        skipsNextActivePhase &&
                          'ring-2 ring-red-500 ring-offset-1 ring-offset-slate-950',
                        card && getActiveEffectTaskCardClass(card.instanceId)
                      )}
                      onClick={() => {
                        if (canToggleEnergy && !isDragging) {
                          tapEnergy(cardId);
                        }
                      }}
                      title={
                        skipsNextActivePhase
                          ? '下次活跃阶段不会自动变为活跃'
                          : canToggleEnergy
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
                    </button>
                  </CardDetailPressTarget>
                </DraggableCard>
              </div>
            );
          })}
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
          className="relative flex h-[var(--battle-live-height)] w-[var(--battle-live-width)] shrink-0 items-center justify-center"
        >
          <CardDetailPressTarget
            cardId={shouldShowFront && card ? card.instanceId : null}
            disabled={!shouldShowFront || !card}
            className="-rotate-90 origin-center shrink-0"
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
                  'h-[var(--battle-live-width)] w-[var(--battle-live-height)]',
                  getActiveEffectTaskCardClass(card.instanceId)
                )}
                onClick={() => confirmActiveEffectCardFromTable(card.instanceId)}
              />
            ) : (
              <div className="h-[var(--battle-live-width)] w-[var(--battle-live-height)] overflow-hidden battle-card-face shadow-md">
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
            <div
              data-live-heart-requirements
              className={cn(
                'battle-live-requirements absolute -bottom-3 left-1/2 -translate-x-1/2 flex items-center gap-0.5 text-[8px] whitespace-nowrap md:-bottom-2.5',
                getBattleAnimationOcclusionClass(cardId)
              )}
            >
              {getHeartRequirementEntries(liveData.requirements?.colorRequirements).map(
                ([color, count], i) => (
                  <span key={i} className="inline-flex items-center gap-0.5">
                    <img
                      src={HEART_REQUIREMENT_ICON_SOURCE_BY_COLOR[color as HeartColor]}
                      alt=""
                      className="h-3 w-3 object-contain drop-shadow md:h-2.5 md:w-2.5"
                      draggable={false}
                    />
                    {(count as number) > 1 && (
                      <span className="text-[8px] font-bold text-white drop-shadow md:leading-none">
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

  // 桌面空槽保留成员列宽，LIVE 实卡在槽位中保持横牌比例并居中。
  const renderLiveSlot = (slotIndex: number) => {
    const cardId = liveCardIds[slotIndex];
    return (
      <div
        key={slotIndex}
        data-battle-live-slot={slotIndex}
        className={cn(
          'h-[var(--battle-live-slot-height)] w-[var(--battle-live-width)] shrink-0 md:w-[var(--battle-stage-column-width,140px)]',
          'battle-card-slot flex items-center justify-center',
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
      <div className="flex w-full items-center justify-between gap-1.5 sm:gap-4 md:justify-center md:gap-15">
        {slotOrder.map((idx) => renderLiveSlot(idx))}
      </div>
    );

    // 己方 Live 区可放置
    if (!isOpponent) {
      return (
        <DroppableZone
          id={getDroppableId(ZoneType.LIVE_ZONE)}
          zoneId={createZoneId(ZoneType.LIVE_ZONE)}
          battleUiAnchor={getBattleLiveZoneAnchor(battlePlayerSide)}
          disabled={!canDropToLiveZone || liveZoneIsFull}
          disabledForDragFromZones={DISABLE_ORDINARY_DROP_FROM_INSPECTION}
          className={cn(
            'battle-live-zone relative rounded-lg p-1',
            'border',
            isMobileBoard
              ? 'w-full bg-[color:color-mix(in_srgb,var(--bg-frosted)_8%,transparent)]'
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
        data-battle-ui-anchor={getBattleLiveZoneAnchor(battlePlayerSide)}
        className={cn(
          'battle-live-zone battle-live-zone-opponent relative rounded-lg p-1',
          isMobileBoard
            ? 'w-full border border-slate-300/20 bg-[color:color-mix(in_srgb,var(--bg-frosted)_8%,transparent)]'
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
    const inspectionZoneDomId = getDroppableId(ZoneType.INSPECTION_ZONE);

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
          {isInspectionZoneCollapsed ? (
            <div
              id={inspectionZoneDomId}
              data-animation-zone-id={inspectionZoneDomId}
              data-inspection-zone-collapsed="true"
              className="flex w-[min(92vw,360px)] items-center justify-between gap-3 overflow-hidden rounded-xl border border-[color:color-mix(in_srgb,var(--accent-primary)_30%,var(--border-default))] bg-[color:color-mix(in_srgb,var(--bg-frosted)_94%,transparent)] px-3 py-2.5 shadow-[var(--shadow-lg)] backdrop-blur-xl sm:w-[min(82vw,360px)]"
            >
              <div className="flex min-w-0 items-center gap-2">
                <span className="truncate text-[11px] font-semibold text-[var(--text-secondary)]">
                  检视区
                </span>
                <div className="battle-zone-count shrink-0 text-xs font-medium text-[var(--text-primary)]">
                  {inspectionZoneView?.count ?? inspectionCardIds.length}
                </div>
              </div>
              <button
                type="button"
                aria-label="展开检视区"
                aria-expanded={false}
                aria-controls={inspectionZoneDomId}
                onClick={() => onInspectionZoneCollapsedChange(false)}
                className="button-primary inline-flex min-h-9 shrink-0 items-center justify-center gap-1.5 px-3 text-xs font-semibold"
              >
                <Maximize2 className="h-4 w-4" aria-hidden="true" />
                展开检视区
              </button>
            </div>
          ) : (
            <div
              data-inspection-zone-collapsed="false"
              className="flex w-[min(92vw,780px)] flex-col gap-2.5 overflow-hidden rounded-xl border border-[color:color-mix(in_srgb,var(--accent-primary)_30%,var(--border-default))] bg-[color:color-mix(in_srgb,var(--bg-frosted)_94%,transparent)] px-3 py-2.5 shadow-[var(--shadow-lg)] backdrop-blur-xl sm:w-[min(82vw,780px)]"
            >
              <DroppableZone
                id={`${INSPECTION_TARGET_IDS.blocker}-header`}
                className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3"
                activeClassName=""
              >
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-[var(--text-secondary)]">检视区</span>
                  <div className="battle-zone-count text-xs font-medium text-[var(--text-primary)]">
                    {inspectionZoneView?.count ?? inspectionCardIds.length}
                  </div>
                </div>
                <div
                  className={cn(
                    'battle-inspection-actions grid w-full gap-2 sm:flex sm:w-auto sm:items-center',
                    canUseInspectionActions ? 'grid-cols-3' : 'grid-cols-1'
                  )}
                >
                  {canUseInspectionActions ? (
                    <>
                      <button
                        type="button"
                        disabled={
                          !canBatchArrangeInspection ||
                          !canUseInspectionActions ||
                          inspectionCardIds.length === 0 ||
                          inspectionBatchAction !== null
                        }
                        onClick={moveAllInspectionCardsToWaitingRoom}
                        className="battle-mini-action min-w-0"
                        title="将检视区全部移入休息室"
                      >
                        <Trash2 size={12} className="hidden min-[380px]:block" />
                        全放休息室
                      </button>
                      <button
                        type="button"
                        disabled={!canCloseInspection}
                        onClick={closeInspectionByReturningCardsToTop}
                        className="battle-mini-action min-w-0"
                        title="关闭检视区并按当前顺序把牌放回主卡组顶"
                      >
                        <Check size={12} />
                        关闭回顶
                      </button>
                    </>
                  ) : null}
                  <button
                    type="button"
                    aria-label="隐藏检视区"
                    aria-expanded={true}
                    aria-controls={inspectionZoneDomId}
                    onClick={() => {
                      setHoveredCard(null);
                      onInspectionZoneCollapsedChange(true);
                    }}
                    className="button-secondary inline-flex min-h-8 min-w-0 items-center justify-center gap-1.5 whitespace-nowrap px-2 text-[11px] font-semibold"
                  >
                    <EyeOff className="h-3.5 w-3.5" aria-hidden="true" />
                    隐藏
                  </button>
                </div>
              </DroppableZone>

              {hasVisibleInspectionCards ? (
                <div className="grid min-w-0 gap-2 md:grid-cols-[minmax(0,1fr)_3.75rem]">
                  <SortableContext
                    items={inspectionCardIds}
                    strategy={horizontalListSortingStrategy}
                  >
                    <DroppableZone
                      id={inspectionZoneDomId}
                      zoneId={createZoneId(ZoneType.INSPECTION_ZONE)}
                      disabled={!canUseInspectionActions}
                      className="relative min-h-[112px] min-w-0 overflow-x-auto rounded-lg border border-dashed border-[color:color-mix(in_srgb,var(--accent-primary)_34%,transparent)] bg-[color:color-mix(in_srgb,var(--bg-overlay)_22%,transparent)] px-2 py-2 sm:min-h-[124px]"
                      activeClassName="outline outline-2 outline-purple-400 bg-purple-500/15"
                      dropTargetClassName="outline outline-2 outline-dashed outline-purple-400/80 bg-purple-500/10"
                    >
                      <div
                        data-animation-zone-id={getDroppableId(ZoneType.INSPECTION_ZONE)}
                        className="battle-card-face pointer-events-none absolute left-2 top-2 aspect-[5/7] w-[60px] opacity-0 sm:w-[68px]"
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
                  id={inspectionZoneDomId}
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
          )}
        </div>
      </>
    );
  };

  // 判断手牌是否可拖拽
  // FREE 的己方整理与当前检视流程可以拖手牌；RULES 的最终合法性仍由 intent/命令政策决定
  const canDragFromHand = allowGeneralOwnZoneInteraction || canReceiveInspectionDrop;

  const renderHandContextActions = () => {
    if (
      isOpponent ||
      isReadOnly ||
      !isMobileBoard ||
      (!isFreeOperationMode && !selectedHandCardId)
    ) {
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
        className="battle-hand-context-actions relative ml-auto flex shrink-0 items-center gap-1 rounded-lg border border-[var(--border-subtle)] bg-[color:color-mix(in_srgb,var(--bg-frosted)_76%,transparent)] p-0.5 shadow-[var(--shadow-sm)] backdrop-blur"
      >
        {isFreeOperationMode ? renderDrawActionButton('MOBILE_HAND') : null}
        {isFreeOperationMode ? renderReturnSelectedHandCardButton('MOBILE_HAND') : null}
        {selectedHandCardId && (
          <button
            type="button"
            onClick={() => selectCard(null)}
            className="battle-mini-action w-7 px-0"
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
      return (
        <div
          data-animation-zone-id={getDroppableId(ZoneType.HAND)}
          data-battle-ui-anchor={getBattleHandAnchor(battlePlayerSide)}
          className="battle-hand-zone relative h-[88px] w-full overflow-visible py-1"
        >
          {Array.from({ length: visibleBackCount }, (_, idx) => (
            <div
              key={`opponent-hand-back-${idx}`}
              className="absolute bottom-1 h-[84px] w-[60px] overflow-hidden battle-card-face shadow-md md:h-[var(--battle-hand-card-height)] md:w-[var(--battle-hand-card-width)]"
              style={{
                left: `calc(50% + ${(idx - (visibleBackCount - 1) / 2) * backStep}px)`,
                transform: `translateX(-50%) scale(${backScale})`,
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
    const renderHandCard = (cardId: string) => {
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
      const contextualActions =
        !suppressSelectedHandCardActionMenu &&
        isHandCardSelected &&
        selectedHandCardActionCardId === card.instanceId &&
        onSelectedHandCardAction
          ? selectedHandCardActions
          : [];
      const handCardMenuItems: readonly CardActionMenuItem[] = [
        ...(canActivateHandAbility
          ? activatedAbilityConfigs.map((config) => ({
              id: `ability:${config.abilityInstanceId ?? config.abilityId}`,
              text: config.text,
              title: config.title,
              execute: () =>
                activateCardAbility(card.instanceId, config.abilityId, config.abilityInstanceId),
            }))
          : []),
        ...contextualActions.map((action) => ({
          id: `context:${action.id}`,
          text: action.text,
          title: action.title,
          align: action.align,
          execute: () => onSelectedHandCardAction?.(card.instanceId, action.id),
        })),
      ];
      const canShowHandCardActionMenu =
        !suppressSelectedHandCardActionMenu && handCardMenuItems.length > 0;

      return (
        <div key={cardId} className="relative">
          <div
            className={cn(
              isDragging
                ? 'transition-none'
                : 'transition-transform duration-200 motion-reduce:transition-none md:hover:-translate-y-1'
            )}
          >
            <DraggableCard
              id={cardId}
              disabled={!isDraggable}
              className="touch-pan-x"
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
                    isActionableNow: canShowHandCardActionMenu,
                  })}
                  className={cn(
                    'h-[var(--battle-hand-card-height,105px)] w-[var(--battle-hand-card-width,75px)]',
                    getActiveEffectTaskCardClass(card.instanceId)
                  )}
                  onClick={() => {
                    if (isChoosingHandCardToReturn) {
                      handleReturnHandCard(card.instanceId);
                      return;
                    }
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
            {canShowHandCardActionMenu && (
              <CardActionMenu
                suspended={interactionSuspended || activatingCardId === card.instanceId}
                items={handCardMenuItems}
                placement={isOpponent ? 'below' : 'above'}
              />
            )}
          </div>
        </div>
      );
    };

    return (
      <DroppableZone
        id={getDroppableId(ZoneType.HAND)}
        zoneId={createZoneId(ZoneType.HAND)}
        battleUiAnchor={getBattleHandAnchor(battlePlayerSide)}
        disabled={!allowGeneralOwnZoneInteraction && !canReceiveInspectionDrop}
        disabledForDragFromZones={DISABLE_ORDINARY_DROP_FROM_INSPECTION}
        className="battle-hand-zone relative h-[118px] w-full overflow-visible"
        activeClassName="ring-2 ring-cyan-500 bg-cyan-500/20"
      >
        <HandLayout
          cardIds={handCardIds}
          selectedCardId={selectedCardId}
          suspended={interactionSuspended || isDragging}
          renderCard={renderHandCard}
        />
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
          <div
            className="flex w-full items-end justify-between gap-1.5 px-[5px] sm:gap-3"
            data-mobile-member-row
          >
            {renderMemberSlot(SlotPosition.RIGHT)}
            {renderMemberSlot(SlotPosition.CENTER)}
            {renderMemberSlot(SlotPosition.LEFT)}
          </div>
          {renderLiveZone(true)}
        </>
      ) : (
        <>
          {renderLiveZone()}
          <div
            className="flex w-full items-start justify-between gap-1.5 px-[5px] sm:gap-3"
            data-mobile-member-row
          >
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
      className="battle-mobile-tabletop h-full min-h-0 overflow-y-auto overscroll-contain"
      data-mobile-tabletop
    >
      <div className="battle-mobile-tabletop-content flex h-full min-h-0 flex-col gap-1 px-0.5 py-1">
        {reversed && renderMobileSupportRow()}
        {/* 保留两列的内容高度；矮屏在战场内滚动，不将资源列挤入下方区域。 */}
        <div className="grid min-h-min flex-1 grid-cols-[minmax(0,1fr)_4rem] items-start gap-2">
          <div className="min-w-0 overflow-visible">{renderMobileBattleCore(reversed)}</div>
          {renderMobileResourcesRail()}
        </div>
        {!reversed && renderMobileSupportRow()}
      </div>
    </div>
  );

  if (isMobileBoard) {
    if (isOpponent) {
      return (
        <div
          data-battle-ui-anchor={getBattlePlayerAreaAnchor(battlePlayerSide)}
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
                data-player-identity-seat={playerSeat}
                className={cn(
                  'rounded-full px-2 py-0.5 text-xs font-bold',
                  isActive
                    ? 'bg-rose-500/80 text-white'
                    : 'bg-[color:color-mix(in_srgb,var(--bg-surface)_48%,transparent)] text-slate-300'
                )}
              >
                {playerIdentity.name}
              </div>
              <div className={ZONE_LABEL_CLASS}>手牌: {displayedHandCount}</div>
            </div>

            <div className="min-h-0 flex-1 overflow-visible">{renderMobileTabletop(true)}</div>
          </div>
          {renderInspectionZone()}
        </div>
      );
    }

    return (
      <div
        data-battle-ui-anchor={getBattlePlayerAreaAnchor(battlePlayerSide)}
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
              data-player-identity-seat={playerSeat}
              className={cn(
                'min-w-0 truncate rounded-full px-2 py-0.5 text-xs font-bold',
                isActive
                  ? 'bg-rose-500/80 text-white'
                  : 'bg-[color:color-mix(in_srgb,var(--bg-surface)_48%,transparent)] text-slate-300'
              )}
            >
              {playerIdentity.name}
            </div>
            <div
              data-player-communication-seat={playerSeat}
              className="battle-mobile-player-communication h-10 w-10 shrink-0"
            />
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
        data-battle-ui-anchor={getBattlePlayerAreaAnchor(battlePlayerSide)}
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
        <div className="absolute left-4 top-4 z-20 flex max-w-[240px] items-center gap-2">
          <div
            data-player-identity-seat={playerSeat}
            className={cn(
              'px-2 py-0.5 rounded-full text-xs font-bold',
              isActive ? 'bg-rose-500 text-white' : 'bg-slate-700 text-slate-300'
            )}
          >
            {playerIdentity.name}
          </div>
          <div className={ZONE_LABEL_CLASS}>手牌: {displayedHandCount}</div>
        </div>

        {/* 主区域 - 绝对定位布局（成员槽和Live区在底部，靠近中央分隔线） */}
        {/* 对手区域镜像显示：左右交换，成员槽位顺序反转 */}
        {/* 工具栏节省的 9px 中，双方各分配 4px 给成员，余下各 0.5px 留在手牌侧。 */}
        <div ref={desktopCoreRef} className="relative z-10 mt-[0.5px] min-h-0 flex-1 px-2">
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
      data-battle-ui-anchor={getBattlePlayerAreaAnchor(battlePlayerSide)}
      className={cn(
        'relative h-full flex flex-col p-2 transition-colors overflow-x-hidden',
        isActive && 'bg-rose-500/10',
        'border-t border-slate-700'
      )}
    >
      {/* 主区域 - 绝对定位布局（成员槽和Live区在顶部，靠近中央分隔线） */}
      <div ref={desktopCoreRef} className="relative mb-[0.5px] min-h-0 flex-1 px-2">
        {/* 左侧区域 - 绝对定位固定在左边 */}
        <div className="absolute left-2 top-0 flex w-[92px] justify-center sm:w-[120px] md:w-[150px]">
          {renderSuccessZone()}
        </div>

        {/* 中间区域 - 绝对居中（Live 区 + 成员槽位） */}
        <div
          className={cn(
            'absolute left-1/2 -translate-x-1/2 top-0 overflow-visible',
            activatingCardId !== null &&
              memberSlotSnapshots.some((slot) => slot.cardId === activatingCardId) &&
              'z-20'
          )}
        >
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
      <div
        data-hand-owner-summary
        className="absolute right-4 bottom-[72px] z-20 flex max-w-[240px] items-center gap-2"
      >
        <div
          data-player-identity-seat={playerSeat}
          className={cn(
            'px-2 py-0.5 rounded-full text-xs font-bold',
            isActive ? 'bg-rose-500 text-white' : 'bg-slate-700 text-slate-300'
          )}
        >
          {playerIdentity.name}
        </div>
        <div data-player-communication-seat={playerSeat} className="h-10 w-10 shrink-0" />
        <div className={ZONE_LABEL_CLASS}>手牌: {displayedHandCount}</div>
        {renderHandContextActions()}
        {returnHandCardPrompt}
      </div>

      {/* 己方：手牌和能量区在最下方 */}
      <div
        ref={desktopHandRowRef}
        className="relative z-10 flex w-full flex-shrink-0 items-center gap-2"
      >
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
