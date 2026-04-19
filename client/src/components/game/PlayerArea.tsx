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

import { memo, useState } from 'react';
import {
  SortableContext,
  horizontalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { motion } from 'framer-motion';
import { createPortal } from 'react-dom';
import { useShallow } from 'zustand/react/shallow';
import { cn } from '@/lib/utils';
import { getHeartRequirementEntries } from '@/lib/heartRequirementUtils';
import { createScopedZoneId, createZoneId } from '@/lib/zoneUtils';
import { useGameStore } from '@/store/gameStore';
import { GameCommandType } from '@game/application/game-commands';
import { Card } from '@/components/card/Card';
import { DraggableCard, DroppableZone } from './interaction';
import { HiddenDeckBrowserModal } from './HiddenDeckBrowserModal';
import { ArrowDownToLine, ArrowUpToLine, Check, Layers3, Megaphone, Trash2, X } from 'lucide-react';
import type { AnyCardData, LiveCardData } from '@game/domain/entities/card';
import { isLiveCardData } from '@game/domain/entities/card';
import {
  SlotPosition,
  OrientationState,
  HeartColor,
  ZoneType,
  GamePhase,
  SubPhase,
} from '@game/shared/types/enums';
import type { Seat, ViewZoneKey } from '@game/online';

interface PlayerAreaProps {
  playerSeat: Seat;
  isOpponent: boolean;
  isActive: boolean;
}

const INSPECTION_TARGET_IDS = {
  hand: 'inspection-target-hand',
  waitingRoom: 'inspection-target-waiting-room',
  mainDeckTop: 'inspection-target-main-deck-top',
  mainDeckBottom: 'inspection-target-main-deck-bottom',
} as const;

const SortableInspectionCard = memo(function SortableInspectionCard({
  cardId,
  imagePath,
  disabled = false,
  showActions = false,
  canReveal = false,
  isRevealed = false,
  onReveal,
  onMouseEnter,
  onMouseLeave,
}: {
  cardId: string;
  imagePath: string;
  disabled?: boolean;
  showActions?: boolean;
  canReveal?: boolean;
  isRevealed?: boolean;
  onReveal?: (cardId: string) => void;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
}) {
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
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="group relative flex shrink-0 flex-col items-center gap-1"
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <div
        {...attributes}
        {...listeners}
        className={cn(
          'h-[84px] w-[60px] overflow-hidden rounded-lg border border-[var(--border-default)] bg-[var(--bg-overlay)] shadow-[var(--shadow-md)]',
          disabled ? 'cursor-default' : 'cursor-grab active:cursor-grabbing',
          isDragging && 'ring-2 ring-amber-400 shadow-[var(--shadow-lg)]'
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
    </div>
  );
});

/**
 * 获取心颜色的显示类名
 */
function getHeartColorClass(color: HeartColor): string {
  const colorMap: Record<string, string> = {
    [HeartColor.PINK]: 'text-pink-400',
    [HeartColor.RED]: 'text-red-400',
    [HeartColor.YELLOW]: 'text-yellow-400',
    [HeartColor.GREEN]: 'text-green-400',
    [HeartColor.BLUE]: 'text-blue-400',
    [HeartColor.PURPLE]: 'text-purple-400',
    [HeartColor.RAINBOW]: 'text-gray-400',
  };
  return colorMap[color] || 'text-slate-400';
}

export const PlayerArea = memo(function PlayerArea({
  playerSeat,
  isOpponent,
  isActive,
}: PlayerAreaProps) {
  const playerIdentity = useGameStore((s) => s.getPlayerIdentityForSeat(playerSeat));
  const viewerSeat = useGameStore((s) => s.getViewerSeat());
  const matchView = useGameStore((s) => s.getMatchView());
  const hasOwnedInspectionContext = useGameStore((s) => s.isInspectionOpenForViewer());
  const currentPhase = useGameStore((s) => s.getCurrentPhaseView());
  const currentSubPhase = useGameStore((s) => s.getCurrentSubPhaseView()) ?? SubPhase.NONE;

  // UI 状态选择器（使用 useShallow 合并多个属性）
  const { selectedCardId } = useGameStore(
    useShallow((s) => ({
      selectedCardId: s.ui.selectedCardId,
    }))
  );
  const isDragging = useGameStore((s) => s.ui.isDragging);
  const isRemoteDebugMode = useGameStore((s) => s.isRemoteDebugMode());
  const canOpenInspection = useGameStore((s) =>
    s.canUseAction(GameCommandType.OPEN_INSPECTION)
  );
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
  const canTapMember = useGameStore((s) => s.canUseAction(GameCommandType.TAP_MEMBER));
  const canTapEnergy = useGameStore((s) => s.canUseAction(GameCommandType.TAP_ENERGY));
  const canDrawCardToHand = useGameStore((s) =>
    s.canUseAction(GameCommandType.DRAW_CARD_TO_HAND)
  );
  const canReturnHandCardToTop = useGameStore((s) =>
    s.canUseAction(GameCommandType.RETURN_HAND_CARD_TO_TOP)
  );
  const canSelectSuccessLive = useGameStore((s) =>
    s.canUseAction(GameCommandType.SELECT_SUCCESS_LIVE)
  );
  const hasFinishInspectionCommand = useGameStore(
    (s) => s.getCommandHint(GameCommandType.FINISH_INSPECTION) !== null
  );

  // 方法选择器（使用 useShallow 保持引用稳定）
  const { getVisibleCardPresentation, selectCard, setHoveredCard, tapMember, tapEnergy, drawCardToHand, returnHandCardToTop, getCardViewObject, getSeatZone, getSeatZoneCardIds, getSeatMemberSlotCardId, getSeatMemberOverlayCardIds, getLiveResultForCard, openInspection, revealInspectedCard, moveInspectedCardToZone, moveInspectedCardToTop, moveInspectedCardToBottom, finishInspection, isInspectionCardPubliclyRevealed, isZoneInCommandScope, isCardInCommandScope, getCommandHint } = useGameStore(
    useShallow((s) => ({
      getVisibleCardPresentation: s.getVisibleCardPresentation,
      selectCard: s.selectCard,
      setHoveredCard: s.setHoveredCard,
      tapMember: s.tapMember,
      tapEnergy: s.tapEnergy,
      drawCardToHand: s.drawCardToHand,
      returnHandCardToTop: s.returnHandCardToTop,
      getCardViewObject: s.getCardViewObject,
      getSeatZone: s.getSeatZone,
      getSeatZoneCardIds: s.getSeatZoneCardIds,
      getSeatMemberSlotCardId: s.getSeatMemberSlotCardId,
      getSeatMemberOverlayCardIds: s.getSeatMemberOverlayCardIds,
      getLiveResultForCard: s.getLiveResultForCard,
      openInspection: s.openInspection,
      revealInspectedCard: s.revealInspectedCard,
      moveInspectedCardToZone: s.moveInspectedCardToZone,
      moveInspectedCardToTop: s.moveInspectedCardToTop,
      moveInspectedCardToBottom: s.moveInspectedCardToBottom,
      finishInspection: s.finishInspection,
      isInspectionCardPubliclyRevealed: s.isInspectionCardPubliclyRevealed,
      isZoneInCommandScope: s.isZoneInCommandScope,
      isCardInCommandScope: s.isCardInCommandScope,
      getCommandHint: s.getCommandHint,
    }))
  );

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
  if (!playerIdentity) {
    return null;
  }
  const displayedHandCount = handZoneView?.count ?? handCardIds.length;

  // ========================================
  // 拖拽权限控制 - "信任玩家"原则
  // ========================================
  // 核心原则：常规阶段维持较自由的桌面操作；进入 Live 结果阶段后，前端只保留当前子阶段允许的动作。
  // ========================================

  const isLiveResultPhase = currentPhase === GamePhase.LIVE_RESULT_PHASE;
  const allowGeneralOwnZoneInteraction = !isOpponent && !isLiveResultPhase;
  const allowLiveSettlementInteraction =
    !isOpponent &&
    currentPhase === GamePhase.LIVE_RESULT_PHASE &&
    currentSubPhase === SubPhase.RESULT_SETTLEMENT &&
    canSelectSuccessLive;
  const dropScope = `seat-${playerSeat}`;
  const getDroppableId = (zoneType: ZoneType, slotPosition?: SlotPosition) =>
    createScopedZoneId(dropScope, zoneType, slotPosition);
  const inspectionSourceZone =
    matchView?.window?.windowType === 'INSPECTION'
      ? (matchView.window.context?.sourceZone as ZoneType | undefined) ?? null
      : null;
  const canClickMainDeck =
    !isOpponent &&
    canOpenInspection &&
    (!hasOwnedInspectionContext || inspectionSourceZone === ZoneType.MAIN_DECK);
  const mainDeckZoneKey = `${playerSeat}_MAIN_DECK` as ViewZoneKey;
  const energyDeckZoneKey = `${playerSeat}_ENERGY_DECK` as ViewZoneKey;
  const canDragMainDeckFromBrowser = isZoneInCommandScope(
    GameCommandType.MOVE_OWNED_CARD_TO_ZONE,
    mainDeckZoneKey
  );
  const canDragEnergyDeckFromBrowser = isZoneInCommandScope(
    GameCommandType.MOVE_OWNED_CARD_TO_ZONE,
    energyDeckZoneKey
  );
  const moveOwnedCardHint = getCommandHint(GameCommandType.MOVE_OWNED_CARD_TO_ZONE);
  const mainDeckScopedCardIds =
    moveOwnedCardHint?.scope?.objectIds && moveOwnedCardHint.scope.objectIds.length > 0
      ? mainDeckCardIds.filter((cardId) =>
          isCardInCommandScope(GameCommandType.MOVE_OWNED_CARD_TO_ZONE, cardId)
        )
      : undefined;
  const energyDeckScopedCardIds =
    moveOwnedCardHint?.scope?.objectIds && moveOwnedCardHint.scope.objectIds.length > 0
      ? energyDeckCardIds.filter((cardId) =>
          isCardInCommandScope(GameCommandType.MOVE_OWNED_CARD_TO_ZONE, cardId)
        )
      : undefined;

  // Live 结算阶段只允许胜者执行 Live -> 成功区，不再开放通用区拖拽。
  const canDropToLiveZone = allowGeneralOwnZoneInteraction;
  // 检查 Live 区是否已达上限（最多3张）
  const liveZoneIsFull = (liveZoneView?.count ?? liveCardIds.length) >= 3;

  const canDropMember = allowGeneralOwnZoneInteraction;

  // 休息室展开状态
  const [waitingRoomExpanded, setWaitingRoomExpanded] = useState(false);
  const [inspectionBatchAction, setInspectionBatchAction] = useState<
    'waiting-room' | 'close' | null
  >(null);
  const [hiddenDeckBrowser, setHiddenDeckBrowser] = useState<'main' | 'energy' | null>(null);

  // 渲染成员槽位 - 使用响应式尺寸
  // 能量卡重叠设计：能量卡与成员卡同等大小，向左下方偏移 10% * n 的卡牌尺寸
  const renderMemberSlot = (position: SlotPosition) => {
    const cardId = getSeatMemberSlotCardId(playerSeat, position);
    const card = cardId ? getVisibleCardPresentation(cardId) : null;
    const slotId = getDroppableId(ZoneType.MEMBER_SLOT, position);

    // 获取卡牌的方向状态
    const orientation = cardId
      ? getCardViewObject(cardId)?.orientation ?? OrientationState.ACTIVE
      : OrientationState.ACTIVE;

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

    // 能量卡偏移量：每张能量卡向左下方偏移 10% 的卡牌尺寸
    const energyOffsetPercent = 10;

    return (
      // 外层容器：包含成员卡和重叠的能量卡
      <div key={position} className="flex flex-col items-center">
        {/* 卡牌堆叠容器 - 使用 relative 定位实现重叠效果 */}
        <div
          className="relative"
          style={{
            // 容器尺寸与单张卡牌相同
            width: 'clamp(80px, 10vw, 140px)',
            aspectRatio: '5/7',
          }}
        >
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
                  data={{ cardId: energyCardId, cardCode: energyCard?.cardCode, fromZone: ZoneType.MEMBER_SLOT }}
                >
                  <div
                    className={cn(
                      'w-full h-full rounded-lg overflow-hidden shadow-md cursor-grab active:cursor-grabbing',
                      isDragging
                        ? 'transition-none'
                        : 'transition-[transform,box-shadow] duration-200 hover:scale-105 hover:z-50 hover:shadow-xl',
                      'border-2 border-indigo-400/50 bg-slate-800'
                    )}
                    onMouseEnter={() => energyCard && setHoveredCard(energyCard.instanceId)}
                    onMouseLeave={() => setHoveredCard(null)}
                    title={`附加能量 #${originalIndex + 1}（可拖走）`}
                  >
                    {imagePath ? (
                      <img src={imagePath} alt="附加能量" className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-xs text-white/70">
                        E
                      </div>
                    )}
                  </div>
                </DraggableCard>
              </div>
            );
          })}

          {/* 成员卡层 - 最上层（Z-index 最高） */}
          <DroppableZone
            id={slotId}
            zoneId={createZoneId(ZoneType.MEMBER_SLOT, position)}
            disabled={slotDisabled}
            className={cn(
              // 响应式尺寸：使用 clamp 确保在合理范围内
              'w-[clamp(80px,10vw,140px)] aspect-[5/7] rounded-lg',
              isDragging
                ? 'border-2 border-dashed transition-none'
                : 'border-2 border-dashed transition-[border-color,background-color,outline-color] duration-150',
              cardId ? 'border-transparent' : 'border-rose-500/30',
              'flex items-center justify-center',
              'bg-slate-800/50',
              // 有卡且可换手时显示特殊边框
              canDropMember && cardId && 'border-amber-500/30 hover:border-amber-500/50',
              // 确保成员卡在能量卡上方
              'relative z-10'
            )}
            activeClassName="ring-2 ring-rose-500 bg-rose-500/20 border-rose-500"
          >
            {card && (
              <DraggableCard
                id={card.instanceId}
                disabled={!allowGeneralOwnZoneInteraction}
                data={{ cardId: card.instanceId, cardCode: card.cardCode, fromZone: ZoneType.MEMBER_SLOT }}
                onDoubleClick={handleDoubleClick}
              >
                <Card
                  cardData={card.cardData as AnyCardData}
                  instanceId={card.instanceId}
                  imagePath={card.imagePath}
                  size="responsive"
                  faceUp={true}
                  orientation={orientation}
                  selected={selectedCardId === card.instanceId}
                  onClick={() => allowGeneralOwnZoneInteraction && selectCard(card.instanceId)}
                  onMouseEnter={() => setHoveredCard(card.instanceId)}
                  onMouseLeave={() => setHoveredCard(null)}
                />
              </DraggableCard>
            )}
            {!cardId && (
              <span className="text-slate-600 text-xs">{position}</span>
            )}
          </DroppableZone>
        </div>

        {/* 能量卡数量指示器 */}
        {energyBelowIds.length > 0 && (
          <div className="mt-1 px-2 py-0.5 bg-indigo-500/20 rounded-full">
            <span className="text-[10px] text-indigo-400 font-medium">
              附加能量 ×{energyBelowIds.length}
            </span>
          </div>
        )}
      </div>
    );
  };

  // 渲染能量区 - 横向一排显示，最多显示12张
  const renderEnergyZone = () => {
    const energyCards = energyZoneCardIds.slice(0, 12); // 最多12张
    const energyCount = energyZoneView?.count ?? energyZoneCardIds.length;
    const activeCount = energyZoneCardIds.filter((id) => {
      return getCardViewObject(id)?.orientation === OrientationState.ACTIVE;
    }).length;

    return (
      <DroppableZone
        id={getDroppableId(ZoneType.ENERGY_ZONE)}
        zoneId={createZoneId(ZoneType.ENERGY_ZONE)}
        disabled={!allowGeneralOwnZoneInteraction}
        className="flex flex-col items-start gap-0.5"
        activeClassName="ring-2 ring-indigo-500 bg-indigo-500/20"
      >
        <span className="text-[10px] text-slate-600 font-medium">能量区 ({activeCount}/{energyCount})</span>
        {/* 横向布局 */}
        <div className="flex gap-0.5 flex-wrap max-w-[300px]">
          {energyCards.map((cardId) => {
            const card = getVisibleCardPresentation(cardId);
            const isActive = getCardViewObject(cardId)?.orientation === OrientationState.ACTIVE;
            const imagePath = card?.imagePath ?? null;

            return (
              <DraggableCard
                key={cardId}
                id={cardId}
                disabled={!allowGeneralOwnZoneInteraction}
                data={{ cardId, cardCode: card?.cardCode, fromZone: ZoneType.ENERGY_ZONE }}
              >
                <div
                  className={cn(
                    isDragging
                      ? 'w-5 h-7 rounded overflow-hidden shadow-sm cursor-pointer transition-none'
                      : 'w-5 h-7 rounded overflow-hidden shadow-sm cursor-pointer transition-transform hover:scale-110 hover:z-10',
                    !isActive && 'opacity-40 grayscale'
                  )}
                  onClick={() => {
                    if (allowGeneralOwnZoneInteraction && canTapEnergy && !isDragging) {
                      tapEnergy(cardId);
                    }
                  }}
                  onMouseEnter={() => card && setHoveredCard(card.instanceId)}
                  onMouseLeave={() => setHoveredCard(null)}
                  title={
                    isOpponent
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
                </div>
              </DraggableCard>
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
    const isBrowserOpen = hiddenDeckBrowser === deckType;
    // 获取能量卡组顶层卡牌（用于拖拽）
    const topCardId = !isMainDeck && count > 0 ? energyDeckCardIds[0] : null;

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
        <div className="absolute inset-0 rounded overflow-hidden shadow-md">
          <img src="/back.jpg" alt={label} className="w-full h-full object-cover" />
        </div>
      </>
    );

    return (
      <DroppableZone
        id={getDroppableId(isMainDeck ? ZoneType.MAIN_DECK : ZoneType.ENERGY_DECK)}
        zoneId={zoneId}
        disabled={!allowGeneralOwnZoneInteraction}
        className="flex flex-col items-center gap-0.5"
        activeClassName="ring-2 ring-amber-500 bg-amber-500/20"
      >
        <span className="text-[10px] font-medium text-[var(--text-muted)]">{label}</span>
        <div
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
              {!isMainDeck && topCardId && !isBrowserOpen ? (
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
          {!isOpponent && count > 0 && allowGeneralOwnZoneInteraction && (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                setHiddenDeckBrowser(deckType);
              }}
              className="button-icon absolute -right-2 -top-2 z-20 h-6 w-6 border border-[var(--border-default)] bg-[var(--bg-frosted)] text-[var(--accent-primary)] shadow-[var(--shadow-md)]"
              title={`浏览${label}顺序`}
            >
              <Layers3 size={12} />
            </button>
          )}
        </div>
      </DroppableZone>
    );
  };

  // 渲染休息室 - 卡片公开显示，叠放在一起，点击展开浮窗
  const renderWaitingRoom = () => {
    const count = waitingRoomZoneView?.count ?? waitingRoomCardIds.length;

    return (
      <DroppableZone
        id={getDroppableId(ZoneType.WAITING_ROOM)}
        zoneId={createZoneId(ZoneType.WAITING_ROOM)}
        disabled={!allowGeneralOwnZoneInteraction}
        className="flex flex-col items-center gap-1 relative"
        activeClassName="ring-2 ring-slate-500 bg-slate-500/20"
      >
        <span className="text-xs font-medium text-[var(--text-muted)]">休息室</span>

        {count === 0 ? (
          // 空休息室占位
          <div className="flex h-[63px] w-[45px] items-center justify-center rounded border border-dashed border-[var(--border-default)] bg-[color:color-mix(in_srgb,var(--bg-overlay)_40%,transparent)]">
            <span className="text-[10px] text-[var(--text-muted)]">0</span>
          </div>
        ) : (
          // 卡片叠放显示，点击展开
          <>
            <div
              className="relative h-[63px] w-[45px] cursor-pointer transition-transform duration-200 hover:-translate-y-0.5"
              onClick={() => setWaitingRoomExpanded(true)}
            >
              {/* 叠放的迷你卡片 */}
              {waitingRoomCardIds.slice(0, 5).map((cardId: string, idx: number) => {
                const card = getVisibleCardPresentation(cardId);
                if (!card) return null;

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
                      <img
                        src={card.imagePath}
                        alt=""
                        className="w-full h-full object-cover"
                      />
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
            {waitingRoomExpanded && (() => {
              const waitingRoomModal = (
                <>
                  <div
                    className={cn('modal-backdrop z-[90]', isDragging && 'pointer-events-none')}
                    onClick={() => setWaitingRoomExpanded(false)}
                  />

                  <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
                    <motion.div
                      className="modal-surface modal-accent-amber w-[min(92vw,720px)] max-h-[82vh] overflow-hidden"
                      initial={{ opacity: 0, scale: 0.94 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.94 }}
                    >
                      <div className="modal-header flex items-center justify-between px-5 py-4">
                        <div className="flex items-center gap-3">
                          <div className="flex h-9 w-9 items-center justify-center rounded-full border border-[var(--border-default)] bg-[color:color-mix(in_srgb,var(--bg-surface)_84%,transparent)] text-[var(--accent-secondary)]">
                            <Layers3 size={16} />
                          </div>
                          <div>
                            <div className="text-sm font-semibold text-[var(--text-primary)]">休息室</div>
                            <div className="text-xs text-[var(--text-secondary)]">共 {count} 张卡牌</div>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => setWaitingRoomExpanded(false)}
                          className="button-icon h-8 w-8"
                          title="关闭休息室"
                        >
                          <X size={14} />
                        </button>
                      </div>

                      <div className="cute-scrollbar max-h-[calc(82vh-76px)] overflow-y-auto p-5">
                        <div className="grid grid-cols-4 gap-3 sm:grid-cols-5 md:grid-cols-6">
                          {waitingRoomCardIds.map((cardId: string) => {
                            const card = getVisibleCardPresentation(cardId);
                            if (!card) return null;

                            return (
                              <DraggableCard
                                key={cardId}
                                id={cardId}
                                disabled={!allowGeneralOwnZoneInteraction}
                                data={{ cardId, cardCode: card.cardCode, fromZone: ZoneType.WAITING_ROOM }}
                              >
                                <Card
                                  cardData={card.cardData as AnyCardData}
                                  instanceId={card.instanceId}
                                  imagePath={card.imagePath}
                                  size="sm"
                                  faceUp={true}
                                  showHover={true}
                                  onMouseEnter={() => setHoveredCard(card.instanceId)}
                                  onMouseLeave={() => setHoveredCard(null)}
                                />
                              </DraggableCard>
                            );
                          })}
                        </div>
                      </div>
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
        disabled={isOpponent || !allowLiveSettlementInteraction}
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
                  // 有卡片 - 横置卡片显示
                  <DraggableCard
                    id={cardId}
                    disabled={!allowGeneralOwnZoneInteraction}
                    data={{ cardId, cardCode: card.cardCode, fromZone: ZoneType.SUCCESS_ZONE }}
                  >
                    <div
                      className="w-full h-full flex items-center justify-center cursor-pointer transition-transform hover:scale-105"
                      onMouseEnter={() => setHoveredCard(card.instanceId)}
                      onMouseLeave={() => setHoveredCard(null)}
                    >
                      {/* 横置卡牌 - 逆时针旋转90度 */}
                      <div className="-rotate-90 origin-center">
                        <Card
                          cardData={card.cardData as AnyCardData}
                          instanceId={card.instanceId}
                          imagePath={card.imagePath}
                          size="sm"
                          faceUp={true}
                          interactive={!isOpponent}
                          showHover={false}
                          className="w-[80px] h-[112px]"
                        />
                      </div>
                    </div>
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

  // 渲染资源区（主卡组 + 休息室 + 能量卡组）- 紧凑横向布局
  // reversed: 对手区域需要反转顺序以呈现镜像效果
  const renderResources = (reversed: boolean = false) => {
    // 己方顺序：主卡组 → 休息室 → 能量卡组
    // 对手方顺序（镜像）：能量卡组 → 休息室 → 主卡组
    const content = reversed ? [
      <div key="energy-deck">{renderDeck(energyDeckZoneView?.count ?? energyDeckCardIds.length, '能量卡组', 'energy')}</div>,
      <div key="waiting-room">{renderWaitingRoom()}</div>,
      <div key="main-deck">{renderDeck(mainDeckZoneView?.count ?? mainDeckCardIds.length, '主卡组', 'main')}</div>,
    ] : [
      <div key="main-deck">{renderDeck(mainDeckZoneView?.count ?? mainDeckCardIds.length, '主卡组', 'main')}</div>,
      <div key="waiting-room">{renderWaitingRoom()}</div>,
      <div key="energy-deck">{renderDeck(energyDeckZoneView?.count ?? energyDeckCardIds.length, '能量卡组', 'energy')}</div>,
    ];

    return (
      <div className="flex items-center gap-2">
        {content}
      </div>
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
    const liveData = card && isLiveCardData(card.cardData) ? card.cardData as LiveCardData : null;

    return (
      <DraggableCard
        id={cardId}
        disabled={!allowGeneralOwnZoneInteraction && !allowLiveSettlementInteraction}
        data={{ cardId, cardCode: card?.cardCode, fromZone: ZoneType.LIVE_ZONE }}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.9 }}
          // 横置卡牌的容器：需要调整尺寸以适应旋转后的卡牌
          className="relative w-[105px] h-[68px] flex items-center justify-center"
        >
          {/* 横置卡牌 - 逆时针旋转90度 */}
          <div className="-rotate-90 origin-center">
            {card ? (
              <Card
                cardData={card.cardData as AnyCardData}
                instanceId={card.instanceId}
                imagePath={card.imagePath}
                size="sm"
                faceUp={shouldShowFront}
                interactive={!isOpponent}
                showHover={false}
                onMouseEnter={() => shouldShowFront && setHoveredCard(card.instanceId)}
                onMouseLeave={() => setHoveredCard(null)}
                className="w-[80px] h-[112px]"
              />
            ) : (
              <div className="h-[112px] w-[80px] overflow-hidden rounded-lg shadow-md">
                <img src="/back.jpg" alt="Card Back" className="h-full w-full object-cover" />
              </div>
            )}
          </div>

          {/* 判定结果指示器 */}
          {showJudgment && (
            <motion.div
              initial={{ opacity: 0, scale: 0.5 }}
              animate={{ opacity: 1, scale: 1 }}
              className={cn(
                'absolute -top-1 -right-1 w-5 h-5 rounded-full',
                'flex items-center justify-center text-xs font-bold',
                'shadow-lg z-10',
                judgmentResult
                  ? 'bg-green-500 text-white'
                  : 'bg-red-500 text-white'
              )}
            >
              {judgmentResult ? '✓' : '✗'}
            </motion.div>
          )}

          {/* Live 卡所需心展示 */}
          {shouldShowFront && liveData && (
            <div className="absolute -bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-0.5 text-[8px] whitespace-nowrap">
              {getHeartRequirementEntries(liveData.requirements?.colorRequirements).map(([color, count], i) => (
                <span key={i} className={getHeartColorClass(color as HeartColor)}>
                  {'♥'.repeat(count as number)}
                </span>
              ))}
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
          'w-[clamp(80px,10vw,140px)] h-[60px]',
          'rounded-lg flex items-center justify-center',
          'border border-dashed',
          cardId ? 'border-transparent bg-transparent' : 'border-slate-600/30 bg-slate-800/30'
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
    const content = (
      <div className="flex gap-15 justify-center items-center w-full">
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
          className={cn(
            'rounded-lg px-1 py-2',
            'bg-slate-800/40 border',
            canDropToLiveZone && !liveZoneIsFull
              ? 'border-rose-500/50 hover:border-rose-500'
              : 'border-slate-600/30',
            'flex flex-col items-center justify-center'
          )}
          activeClassName="ring-2 ring-rose-500 bg-rose-500/20 border-rose-500"
        >
          {content}
        </DroppableZone>
      );
    }

    // 对手 Live 区只显示
    return (
      <div className={cn(
        'rounded-lg px-1 py-2',
        'bg-slate-800/40 border border-slate-600/30',
        'flex flex-col items-center justify-center'
      )}>
        {content}
      </div>
    );
  };

  const renderInspectionZone = () => {
    const isViewerInspectionZone = viewerSeat === playerSeat && hasOwnedInspectionContext;
    const hasVisibleInspectionCards = inspectionCardIds.length > 0;
    const shouldRenderInspectionZone =
      !!inspectionZoneView && (inspectionZoneView.count > 0 || isViewerInspectionZone);

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
      if (inspectionBatchAction) {
        return;
      }

      setInspectionBatchAction('waiting-room');
      try {
        while (true) {
          const latestInspectionCardIds = useGameStore
            .getState()
            .getSeatZoneCardIds(playerSeat, 'INSPECTION_ZONE');
          const nextCardId = latestInspectionCardIds[0];
          if (!nextCardId) {
            break;
          }
          const result = moveInspectedCardToZone(nextCardId, ZoneType.WAITING_ROOM);
          if (!result.success && !result.pending) {
            break;
          }
          if (result.pending || isRemoteDebugMode) {
            await waitForInspectionZoneChange(latestInspectionCardIds);
          }
        }
        setHoveredCard(null);
      } finally {
        setInspectionBatchAction(null);
      }
    };

    const closeInspectionByReturningCardsToTop = async () => {
      if (inspectionBatchAction) {
        return;
      }

      setInspectionBatchAction('close');
      try {
        while (true) {
          const latestInspectionCardIds = useGameStore
            .getState()
            .getSeatZoneCardIds(playerSeat, 'INSPECTION_ZONE');
          const nextCardId = latestInspectionCardIds[latestInspectionCardIds.length - 1];
          if (!nextCardId) {
            break;
          }
          const result = moveInspectedCardToTop(nextCardId);
          if (!result.success && !result.pending) {
            return;
          }
          if (result.pending || isRemoteDebugMode) {
            await waitForInspectionZoneChange(latestInspectionCardIds);
          }
        }
        setHoveredCard(null);
        finishInspection();
      } finally {
        setInspectionBatchAction(null);
      }
    };

    if (!shouldRenderInspectionZone) {
      return null;
    }

    return (
      <div
        className={cn(
          'absolute left-1/2 z-30 -translate-x-1/2',
          isOpponent ? 'bottom-[88px]' : 'top-[88px]'
        )}
      >
        <div className="flex max-w-[min(76vw,720px)] flex-col gap-3 rounded-2xl border border-[var(--border-default)] bg-[color:color-mix(in_srgb,var(--bg-frosted)_92%,transparent)] px-4 py-3 shadow-[var(--shadow-lg)] backdrop-blur-xl">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--text-secondary)]">
                检视区
              </span>
              <div className="rounded-full border border-[var(--border-default)] bg-[color:color-mix(in_srgb,var(--bg-surface)_88%,transparent)] px-2 py-1 text-[11px] font-semibold text-[var(--text-secondary)] shadow-[var(--shadow-sm)]">
                {inspectionZoneView?.count ?? inspectionCardIds.length}
              </div>
            </div>
            {isViewerInspectionZone ? (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={
                    !canMoveInspectedToZone ||
                    inspectionCardIds.length === 0 ||
                    inspectionBatchAction !== null
                  }
                  onClick={moveAllInspectionCardsToWaitingRoom}
                  className={cn(
                    'inline-flex items-center gap-1 rounded px-2.5 py-1 text-[11px] font-medium text-white',
                    canMoveInspectedToZone &&
                    inspectionCardIds.length > 0 &&
                    inspectionBatchAction === null
                      ? 'bg-slate-700 hover:bg-slate-600'
                      : 'cursor-not-allowed bg-slate-600'
                  )}
                  title="将检视区全部移入休息室"
                >
                  <Trash2 size={12} />
                  全部放入休息区
                </button>
                <button
                  type="button"
                  disabled={
                    !canMoveInspectedToTop ||
                    !hasFinishInspectionCommand ||
                    inspectionBatchAction !== null
                  }
                  onClick={closeInspectionByReturningCardsToTop}
                  className={cn(
                    'inline-flex items-center gap-1 rounded px-2.5 py-1 text-[11px] font-medium text-white',
                    canMoveInspectedToTop &&
                    hasFinishInspectionCommand &&
                    inspectionBatchAction === null
                      ? 'bg-emerald-600 hover:bg-emerald-500'
                      : 'cursor-not-allowed bg-slate-600'
                  )}
                  title="关闭检视区并按当前顺序把牌放回主卡组顶"
                >
                  <Check size={12} />
                  关闭（检视区的牌全部回到卡组顶）
                </button>
              </div>
            ) : null}
          </div>

          {isViewerInspectionZone && hasVisibleInspectionCards ? (
            <div className="overflow-x-auto pb-1">
              <div className="flex min-w-max flex-nowrap gap-2">
              <DroppableZone
                id={INSPECTION_TARGET_IDS.hand}
                disabled={!canMoveInspectedToZone}
                className="rounded-lg border border-[var(--border-default)] bg-[color:color-mix(in_srgb,var(--bg-overlay)_44%,transparent)] px-3 py-2 text-center text-[11px] font-medium text-[var(--text-secondary)] whitespace-nowrap"
                activeClassName="outline outline-2 outline-cyan-400 bg-cyan-500/15"
              >
                拖到这里加入手牌
              </DroppableZone>
              <DroppableZone
                id={INSPECTION_TARGET_IDS.waitingRoom}
                disabled={!canMoveInspectedToZone}
                className="rounded-lg border border-[var(--border-default)] bg-[color:color-mix(in_srgb,var(--bg-overlay)_44%,transparent)] px-3 py-2 text-center text-[11px] font-medium text-[var(--text-secondary)] whitespace-nowrap"
                activeClassName="outline outline-2 outline-slate-300 bg-slate-500/15"
              >
                <span className="inline-flex items-center gap-1">
                  <Trash2 size={12} />
                  拖到这里放入休息室
                </span>
              </DroppableZone>
              <DroppableZone
                id={INSPECTION_TARGET_IDS.mainDeckTop}
                disabled={!canMoveInspectedToTop}
                className="rounded-lg border border-[var(--border-default)] bg-[color:color-mix(in_srgb,var(--bg-overlay)_44%,transparent)] px-3 py-2 text-center text-[11px] font-medium text-[var(--text-secondary)] whitespace-nowrap"
                activeClassName="outline outline-2 outline-amber-400 bg-amber-500/15"
              >
                <span className="inline-flex items-center gap-1">
                  <ArrowUpToLine size={12} />
                  拖到这里回卡组顶
                </span>
              </DroppableZone>
              <DroppableZone
                id={INSPECTION_TARGET_IDS.mainDeckBottom}
                disabled={!canMoveInspectedToBottom}
                className="rounded-lg border border-[var(--border-default)] bg-[color:color-mix(in_srgb,var(--bg-overlay)_44%,transparent)] px-3 py-2 text-center text-[11px] font-medium text-[var(--text-secondary)] whitespace-nowrap"
                activeClassName="outline outline-2 outline-orange-500 bg-orange-500/15"
              >
                <span className="inline-flex items-center gap-1">
                  <ArrowDownToLine size={12} />
                  拖到这里放卡组底
                </span>
              </DroppableZone>
              </div>
            </div>
          ) : null}

          {hasVisibleInspectionCards ? (
            <SortableContext
              items={inspectionCardIds}
              strategy={horizontalListSortingStrategy}
            >
              <div className="overflow-x-auto pb-1">
                <div className="flex w-max min-w-full items-start gap-3">
                  {inspectionCardIds.map((cardId) => {
                    const viewObject = getCardViewObject(cardId);
                    const card = getVisibleCardPresentation(cardId);
                    const showFront = viewObject?.surface === 'FRONT' && !!card;
                    const imagePath = showFront && card ? card.imagePath : '/back.jpg';

                    return (
                      <SortableInspectionCard
                        key={cardId}
                        cardId={cardId}
                        imagePath={imagePath}
                        disabled={!isViewerInspectionZone || !canReorderInspectedCard}
                        showActions={isViewerInspectionZone}
                        canReveal={canRevealInspectedCard}
                        isRevealed={isInspectionCardPubliclyRevealed(cardId)}
                        onReveal={(targetCardId) => {
                          revealInspectedCard(targetCardId);
                        }}
                        onMouseEnter={() => {
                          if (showFront && card) {
                            setHoveredCard(card.instanceId);
                          }
                        }}
                        onMouseLeave={() => setHoveredCard(null)}
                      />
                    );
                  })}
                </div>
              </div>
            </SortableContext>
          ) : (
            <div className="rounded-lg border border-dashed border-[var(--border-default)] bg-[color:color-mix(in_srgb,var(--bg-overlay)_36%,transparent)] px-4 py-3 text-center text-xs text-[var(--text-muted)]">
              {isViewerInspectionZone
                ? '检视区已清空，可直接关闭检视区。'
                : '当前检视区暂无可见卡牌。'}
            </div>
          )}
        </div>
      </div>
    );
  };

  // 判断手牌是否可拖拽
  // "信任玩家"原则：己方区域允许自由拖拽，系统自动纠正非法状态
  const canDragFromHand = allowGeneralOwnZoneInteraction;

  // 渲染手牌
  const renderHand = () => {
    if (isOpponent) {
      // 对手手牌显示背面 - 使用真实卡背图片，无动画以避免回合切换时的跳动
      const visibleBackCount = Math.min(displayedHandCount, 10);
      return (
        <div className="flex justify-center gap-1 py-2 w-full">
          {Array.from({ length: visibleBackCount }, (_, idx) => (
            <div
              key={`opponent-hand-back-${idx}`}
              className="w-[60px] h-[84px] rounded-lg overflow-hidden shadow-md"
              style={{
                transform: `rotate(${(idx - displayedHandCount / 2) * 3}deg)`,
              }}
            >
              <img src="/back.jpg" alt="Card Back" className="w-full h-full object-cover" />
            </div>
          ))}
          {displayedHandCount > 10 && (
            <span className="text-slate-400 text-xs self-center ml-2">
              +{displayedHandCount - 10}
            </span>
          )}
        </div>
      );
    }

    // 己方手牌显示正面 (带拖拽，使用纯 CSS 避免动画导致的布局问题)
    return (
      <DroppableZone
        id={getDroppableId(ZoneType.HAND)}
        zoneId={createZoneId(ZoneType.HAND)}
        disabled={!allowGeneralOwnZoneInteraction}
        className="flex justify-center py-2 px-4 w-full"
        activeClassName="ring-2 ring-cyan-500 bg-cyan-500/20"
      >
        {handCardIds.map((cardId, idx) => {
          const card = getVisibleCardPresentation(cardId);
          if (!card) return null;

          // 结果阶段切走后，这里会自动退化为只读展示。
          const isDraggable = canDragFromHand;

          return (
            <div
              key={cardId}
              className={cn(
                isDragging
                  ? 'transition-none'
                  : 'transition-transform duration-200 hover:-translate-y-5 hover:scale-105 hover:z-50'
              )}
              style={{
                marginLeft: idx > 0 ? '-15px' : 0,
                transform: `rotate(${(idx - handCardIds.length / 2) * 5}deg)`,
                zIndex: idx,
              }}
            >
              <DraggableCard
                id={cardId}
                disabled={!isDraggable}
                data={{ cardId, cardCode: card.cardCode, fromZone: ZoneType.HAND }}
              >
                <Card
                  cardData={card.cardData as AnyCardData}
                  instanceId={card.instanceId}
                  imagePath={card.imagePath}
                  size="sm"
                  faceUp={true}
                  selected={selectedCardId === card.instanceId}
                  onClick={() => allowGeneralOwnZoneInteraction && selectCard(card.instanceId)}
                  onMouseEnter={() => setHoveredCard(card.instanceId)}
                  onMouseLeave={() => setHoveredCard(null)}
                  showHover={false}
                />
              </DraggableCard>
            </div>
          );
        })}
        {/* 手牌快捷操作 - 贴着手牌扇形右边缘 */}
        <div className="ml-2 flex flex-col gap-1 self-end mb-2">
          <button
            type="button"
            onClick={() => {
              if (!allowGeneralOwnZoneInteraction || !canDrawCardToHand) return;
              const topCardId = mainDeckCardIds[0];
              if (!topCardId) return;
              drawCardToHand();
            }}
            disabled={
              mainDeckCardIds.length === 0 ||
              !allowGeneralOwnZoneInteraction ||
              !canDrawCardToHand
            }
            className={cn(
              'w-7 h-7 rounded text-xs font-bold',
              'transition-colors',
              mainDeckCardIds.length > 0 &&
              allowGeneralOwnZoneInteraction &&
              canDrawCardToHand
                ? 'bg-cyan-700 hover:bg-cyan-600 text-white'
                : 'bg-slate-700 text-slate-500 cursor-not-allowed'
            )}
            title="抽一张（主卡组顶 → 手牌）"
          >
            ←
          </button>
          <button
            type="button"
            onClick={() => {
              if (!allowGeneralOwnZoneInteraction || !canReturnHandCardToTop) return;
              const rightmostHandCardId = handCardIds[handCardIds.length - 1];
              if (!rightmostHandCardId) return;
              returnHandCardToTop(rightmostHandCardId);
            }}
            disabled={
              handCardIds.length === 0 ||
              !allowGeneralOwnZoneInteraction ||
              !canReturnHandCardToTop
            }
            className={cn(
              'w-7 h-7 rounded text-xs font-bold',
              'transition-colors',
              handCardIds.length > 0 &&
              allowGeneralOwnZoneInteraction &&
              canReturnHandCardToTop
                ? 'bg-amber-700 hover:bg-amber-600 text-white'
                : 'bg-slate-700 text-slate-500 cursor-not-allowed'
            )}
            title="放回顶部（手牌最右 → 主卡组顶）"
          >
            →
          </button>
        </div>
      </DroppableZone>
    );
  };

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
        <div className="flex-shrink-0 w-full flex items-center gap-2 relative">
          {/* 能量区 - 右上角 */}
          <div className="absolute right-2 top-2">
            {renderEnergyZone()}
          </div>
          {/* 手牌区 - 居中 */}
          {renderHand()}
        </div>

        {/* 玩家信息 - 紧凑 */}
        <div className="flex items-center gap-2 my-1 flex-shrink-0 flex-row-reverse">
          <div className={cn(
            'px-2 py-0.5 rounded-full text-xs font-bold',
            isActive ? 'bg-rose-500 text-white' : 'bg-slate-700 text-slate-300'
          )}>
            {playerIdentity.name}
          </div>
        <div className="text-[10px] text-slate-600 font-medium">
            手牌: {displayedHandCount}
        </div>
        </div>

        {/* 主区域 - 绝对定位布局（成员槽和Live区在底部，靠近中央分隔线） */}
        {/* 对手区域镜像显示：左右交换，成员槽位顺序反转 */}
        <div className="flex-1 min-h-0 relative px-2">
          {/* 左侧区域 - 对手的资源区（镜像后在左边，对手的右手边） */}
          <div className="absolute left-2 bottom-0 w-[150px] flex justify-center">
            {renderResources(true)}
          </div>

          {/* 中间区域 - 绝对居中（成员槽位 + Live 区） */}
          <div className="absolute left-1/2 -translate-x-1/2 bottom-0">
            <div className="flex flex-col justify-end items-center gap-2">
              {/* 成员槽位 - 镜像顺序：RIGHT → CENTER → LEFT */}
              <div className="flex gap-15 items-end">
                {renderMemberSlot(SlotPosition.RIGHT)}
                {renderMemberSlot(SlotPosition.CENTER)}
                {renderMemberSlot(SlotPosition.LEFT)}
              </div>
              {/* Live 区 - 在成员槽位下方，启用镜像 */}
              {renderLiveZone(true)}
            </div>
          </div>

          {/* 右侧区域 - 对手的成功Live区（镜像后在右边，对手的左手边） */}
          <div className="absolute right-2 bottom-0 w-[150px] flex justify-center">
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
      <div className="flex-1 min-h-0 relative px-2">
        {/* 左侧区域 - 绝对定位固定在左边 */}
        <div className="absolute left-2 top-0 w-[150px] flex justify-center">
          {renderSuccessZone()}
        </div>

        {/* 中间区域 - 绝对居中（Live 区 + 成员槽位） */}
        <div className="absolute left-1/2 -translate-x-1/2 top-0 overflow-visible">
          <div className="flex flex-col justify-start items-center gap-2">
            {/* Live 区 - 在成员槽位上方 */}
            {renderLiveZone()}
            {/* 成员槽位 */}
            <div className="flex gap-15 items-start">
              {renderMemberSlot(SlotPosition.LEFT)}
              {renderMemberSlot(SlotPosition.CENTER)}
              {renderMemberSlot(SlotPosition.RIGHT)}
            </div>
          </div>
        </div>

        {/* 右侧区域 - 绝对定位固定在右边 */}
        <div className="absolute right-2 top-0 w-[150px] flex justify-center">
          {renderResources()}
        </div>
      </div>

      {/* 玩家信息 - 紧凑 */}
      <div className="flex items-center gap-2 my-1 flex-shrink-0">
        <div className={cn(
          'px-2 py-0.5 rounded-full text-xs font-bold',
          isActive ? 'bg-rose-500 text-white' : 'bg-slate-700 text-slate-300'
        )}>
          {playerIdentity.name}
        </div>
        <div className="text-[10px] text-slate-600 font-medium">
          手牌: {displayedHandCount}
        </div>
      </div>

      {/* 己方：手牌和能量区在最下方 */}
      <div className="flex-shrink-0 w-full flex items-center gap-2 relative">
        {/* 能量区 - 左下角 */}
          <div className="absolute left-2 bottom-2">
            {renderEnergyZone()}
          </div>
          {/* 手牌区 - 居中 */}
          {renderHand()}
        </div>

      {renderInspectionZone()}

      <HiddenDeckBrowserModal
        isOpen={hiddenDeckBrowser === 'main'}
        onClose={() => setHiddenDeckBrowser(null)}
        title="主卡组顺序浏览"
        zoneType={ZoneType.MAIN_DECK}
        cardIds={mainDeckCardIds}
        canDragCards={canDragMainDeckFromBrowser}
        draggableCardIds={mainDeckScopedCardIds}
        isDragging={isDragging}
      />
      <HiddenDeckBrowserModal
        isOpen={hiddenDeckBrowser === 'energy'}
        onClose={() => setHiddenDeckBrowser(null)}
        title="能量卡组顺序浏览"
        zoneType={ZoneType.ENERGY_DECK}
        cardIds={energyDeckCardIds}
        canDragCards={canDragEnergyDeckFromBrowser}
        draggableCardIds={energyDeckScopedCardIds}
        isDragging={isDragging}
      />
    </div>
  );
});

export default PlayerArea;
