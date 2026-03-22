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
import { motion } from 'framer-motion';
import { useShallow } from 'zustand/react/shallow';
import { cn } from '@/lib/utils';
import { useGameStore } from '@/store/gameStore';
import { Card } from '@/components/card/Card';
import { DraggableCard, DroppableZone } from './interaction';
import { DeckPeekModal } from './DeckPeekModal';
import type { PlayerState } from '@game/domain/entities/player';
import type { AnyCardData, LiveCardData } from '@game/domain/entities/card';
import { isLiveCardData } from '@game/domain/entities/card';
import type { StatefulZoneState } from '@game/domain/entities/zone';
import { SlotPosition, OrientationState, FaceState, HeartColor, ZoneType } from '@game/shared/types/enums';

interface PlayerAreaProps {
  player: PlayerState;
  isOpponent: boolean;
  isActive: boolean;
  liveZone: StatefulZoneState;
}

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
  player,
  isOpponent,
  isActive,
  liveZone,
}: PlayerAreaProps) {
  // 状态选择器
  const gameState = useGameStore((s) => s.gameState);

  // UI 状态选择器（使用 useShallow 合并多个属性）
  const { selectedCardId } = useGameStore(
    useShallow((s) => ({
      selectedCardId: s.ui.selectedCardId,
    }))
  );

  // 方法选择器（使用 useShallow 保持引用稳定）
  const { getCardInstance, getCardImagePath, selectCard, setHoveredCard, tapMember, manualMoveCard } = useGameStore(
    useShallow((s) => ({
      getCardInstance: s.getCardInstance,
      getCardImagePath: s.getCardImagePath,
      selectCard: s.selectCard,
      setHoveredCard: s.setHoveredCard,
      tapMember: s.tapMember,
      manualMoveCard: s.manualMoveCard,
    }))
  );

  // 获取 Live 判定结果
  const liveResults = gameState?.liveResolution.liveResults;

  // ========================================
  // 拖拽权限控制 - "信任玩家"原则
  // ========================================
  // 核心原则：允许自由拖拽，系统会自动纠正非法状态
  // 唯一硬性限制：不能操作对方的区域
  // ========================================

  // 己方区域可以自由操作（不限制阶段）
  const canOperateOwnZone = !isOpponent;

  // 判断是否可以放置卡牌到 Live 区（己方可操作）
  const canDropToLiveZone = canOperateOwnZone;
  // 检查 Live 区是否已达上限（最多3张）
  const liveZoneIsFull = liveZone.cardIds.length >= 3;

  // 判断是否可以放置成员（己方可操作）
  const canDropMember = canOperateOwnZone;

  // 休息室展开状态
  const [waitingRoomExpanded, setWaitingRoomExpanded] = useState(false);

  // 卡组检视面板状态
  const [deckPeekModalOpen, setDeckPeekModalOpen] = useState(false);

  // 渲染成员槽位 - 使用响应式尺寸
  // 能量卡重叠设计：能量卡与成员卡同等大小，向左下方偏移 10% * n 的卡牌尺寸
  const renderMemberSlot = (position: SlotPosition) => {
    const cardId = player.memberSlots.slots[position];
    const card = cardId ? getCardInstance(cardId) : null;
    const slotId = `slot-${position}`;

    // 获取卡牌的方向状态
    const cardState = cardId ? player.memberSlots.cardStates.get(cardId) : null;
    const orientation = cardState?.orientation ?? OrientationState.ACTIVE;

    // 检查该槽位的成员是否是本回合刚登场的（规则 9.6.2.1.2.1）
    const isNewlyPlaced = cardId ? player.movedToStageThisTurn.includes(cardId) : false;

    // 允许换手：有卡但不是本回合刚登场的槽位也可以放置
    const slotDisabled = !canDropMember || isNewlyPlaced;

    // 双击切换状态（活跃 ↔ 等待）
    const handleDoubleClick = () => {
      if (!isOpponent && cardId) {
        tapMember(cardId, position);
      }
    };

    // 该槽位下方的能量卡（规则 4.5.5）
    const energyBelowIds = player.memberSlots.energyBelow?.[position] ?? [];

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
            const energyCard = getCardInstance(energyCardId);
            const imagePath = energyCard ? getCardImagePath(energyCard.data.cardCode) : null;
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
                  disabled={isOpponent}
                  data={{ cardId: energyCardId, cardCode: energyCard?.data.cardCode, fromZone: ZoneType.MEMBER_SLOT }}
                >
                  <div
                    className={cn(
                      'w-full h-full rounded-lg overflow-hidden shadow-md cursor-grab active:cursor-grabbing',
                      'transition-all duration-200 hover:scale-105 hover:z-50 hover:shadow-xl',
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
            disabled={slotDisabled}
            className={cn(
              // 响应式尺寸：使用 clamp 确保在合理范围内
              'w-[clamp(80px,10vw,140px)] aspect-[5/7] rounded-lg',
              'border-2 border-dashed transition-all',
              cardId ? 'border-transparent' : 'border-rose-500/30',
              'flex items-center justify-center',
              'bg-slate-800/50',
              // 有卡且可换手时显示特殊边框
              canDropMember && cardId && !isNewlyPlaced && 'border-amber-500/30 hover:border-amber-500/50',
              // 确保成员卡在能量卡上方
              'relative z-10'
            )}
            activeClassName="ring-2 ring-rose-500 bg-rose-500/20 border-rose-500"
          >
            {card && (
              <DraggableCard
                id={card.instanceId}
                disabled={isOpponent}
                data={{ cardId: card.instanceId, cardCode: card.data.cardCode, fromZone: ZoneType.MEMBER_SLOT }}
                onDoubleClick={handleDoubleClick}
              >
                <Card
                  cardData={card.data as AnyCardData}
                  instanceId={card.instanceId}
                  imagePath={getCardImagePath(card.data.cardCode)}
                  size="responsive"
                  faceUp={true}
                  orientation={orientation}
                  selected={selectedCardId === card.instanceId}
                  onClick={() => !isOpponent && selectCard(card.instanceId)}
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
    const energyCards = player.energyZone.cardIds.slice(0, 12); // 最多12张
    const energyCount = player.energyZone.cardIds.length;
    const activeCount = player.energyZone.cardIds.filter((id) => {
      const state = player.energyZone.cardStates.get(id);
      return state?.orientation === OrientationState.ACTIVE;
    }).length;

    return (
      <DroppableZone
        id="energy-zone"
        disabled={isOpponent}
        className="flex flex-col items-start gap-0.5"
        activeClassName="ring-2 ring-indigo-500 bg-indigo-500/20"
      >
        <span className="text-[10px] text-slate-600 font-medium">能量区 ({activeCount}/{energyCount})</span>
        {/* 横向布局 */}
        <div className="flex gap-0.5 flex-wrap max-w-[300px]">
          {energyCards.map((cardId) => {
            const card = getCardInstance(cardId);
            const state = player.energyZone.cardStates.get(cardId);
            const isActive = state?.orientation === OrientationState.ACTIVE;
            const imagePath = card ? getCardImagePath(card.data.cardCode) : null;

            return (
              <DraggableCard
                key={cardId}
                id={cardId}
                disabled={isOpponent}
                data={{ cardId, cardCode: card?.data.cardCode, fromZone: ZoneType.ENERGY_ZONE }}
              >
                <div
                  className={cn(
                    'w-5 h-7 rounded overflow-hidden shadow-sm cursor-pointer transition-transform hover:scale-110 hover:z-10',
                    !isActive && 'opacity-40 grayscale'
                  )}
                  onMouseEnter={() => card && setHoveredCard(card.instanceId)}
                  onMouseLeave={() => setHoveredCard(null)}
                  title={isActive ? '活跃' : '等待'}
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
  // 点击主卡组打开检视面板
  const renderDeck = (count: number, label: string, deckType: 'main' | 'energy') => {
    const zoneId = deckType === 'main' ? 'main-deck' : 'energy-deck';
    const isMainDeck = deckType === 'main';

    // 获取能量卡组顶层卡牌（用于拖拽）
    const topCardId = !isMainDeck && count > 0 ? player.energyDeck.cardIds[count - 1] : null;
    const topCard = topCardId ? getCardInstance(topCardId) : null;

    // 点击主卡组打开检视面板（演出阶段时打开应援面板）
    const handleClick = () => {
      if (isMainDeck && !isOpponent) {
        setDeckPeekModalOpen(true);
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
        id={zoneId}
        disabled={isOpponent}
        className="flex flex-col items-center gap-0.5"
        activeClassName="ring-2 ring-amber-500 bg-amber-500/20"
      >
        <span className="text-[10px] text-slate-600 font-medium">{label}</span>
        <div
          className={cn(
            'relative w-[40px] h-[56px]',
            isMainDeck && !isOpponent && 'cursor-pointer hover:ring-2 hover:ring-purple-400 rounded'
          )}
          onClick={handleClick}
        >
          {count > 0 && (
            <>
              {/* 能量卡组：顶层卡牌可拖拽 */}
              {!isMainDeck && topCard && topCardId ? (
                <DraggableCard
                  id={topCardId}
                  disabled={isOpponent}
                  data={{ cardId: topCardId, cardCode: topCard.data.cardCode, fromZone: ZoneType.ENERGY_DECK }}
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
          <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 bg-slate-800 px-1.5 py-0.5 rounded text-[10px] font-bold z-10">
            {count}
          </div>
        </div>
      </DroppableZone>
    );
  };

  // 渲染休息室 - 卡片公开显示，叠放在一起，点击展开浮窗
  const renderWaitingRoom = () => {
    const waitingCardIds = player.waitingRoom.cardIds;
    const count = waitingCardIds.length;

    return (
      <DroppableZone
        id="waiting-room"
        disabled={isOpponent}
        className="flex flex-col items-center gap-1 relative"
        activeClassName="ring-2 ring-slate-500 bg-slate-500/20"
      >
        <span className="text-xs text-slate-600 font-medium">休息室</span>

        {count === 0 ? (
          // 空休息室占位
          <div className="w-[45px] h-[63px] rounded border border-dashed border-slate-600 flex items-center justify-center">
            <span className="text-slate-600 text-[10px]">0</span>
          </div>
        ) : (
          // 卡片叠放显示，点击展开
          <>
            <div
              className="relative w-[45px] h-[63px] cursor-pointer"
              onClick={() => setWaitingRoomExpanded(true)}
            >
              {/* 叠放的迷你卡片 */}
              {waitingCardIds.slice(0, 5).map((cardId: string, idx: number) => {
                const card = getCardInstance(cardId);
                if (!card) return null;

                return (
                  <div
                    key={cardId}
                    className="absolute w-[45px] h-[63px] rounded bg-gradient-to-br from-slate-600 to-slate-700 border border-slate-500/50 flex items-center justify-center overflow-hidden"
                    style={{
                      left: Math.min(idx * 2, 8),
                      top: Math.min(idx * 1.5, 6),
                      zIndex: idx,
                    }}
                  >
                    {getCardImagePath(card.data.cardCode) ? (
                      <img
                        src={getCardImagePath(card.data.cardCode)}
                        alt=""
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <span className="text-slate-400 text-[8px]">♪</span>
                    )}
                  </div>
                );
              })}

              {/* 数量标签 */}
              <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 bg-slate-700 px-1.5 py-0.5 rounded text-[10px] font-bold text-slate-300 z-10">
                {count}
              </div>
            </div>

            {/* 展开的浮窗 */}
            {waitingRoomExpanded && (
              <>
                {/* 背景遮罩 - 点击关闭 */}
                <div
                  className="fixed inset-0 bg-black/50 z-[90]"
                  onClick={() => setWaitingRoomExpanded(false)}
                />

                {/* 卡片浮窗 */}
                <motion.div
                  className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-slate-800/95 rounded-lg p-4 shadow-xl border border-slate-600 z-[100] flex flex-wrap gap-2 max-w-[500px] max-h-[80vh] overflow-auto"
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.9 }}
                >
                  {/* 标题 */}
                  <div className="w-full text-center text-sm text-slate-300 mb-2 pb-2 border-b border-slate-600">
                    休息室 ({count} 张) - 点击外部关闭
                  </div>

                  {waitingCardIds.map((cardId: string) => {
                    const card = getCardInstance(cardId);
                    if (!card) return null;

                    return (
                      <DraggableCard
                        key={cardId}
                        id={cardId}
                        disabled={isOpponent}
                        data={{ cardId, cardCode: card.data.cardCode, fromZone: ZoneType.WAITING_ROOM }}
                      >
                        <Card
                          cardData={card.data as AnyCardData}
                          instanceId={card.instanceId}
                          imagePath={getCardImagePath(card.data.cardCode)}
                          size="sm"
                          faceUp={true}
                          showHover={true}
                          onMouseEnter={() => setHoveredCard(card.instanceId)}
                          onMouseLeave={() => setHoveredCard(null)}
                        />
                      </DraggableCard>
                    );
                  })}
                </motion.div>
              </>
            )}
          </>
        )}
      </DroppableZone>
    );
  };

  // 渲染成功 Live 区 - 显示实际的 Live 卡片（正面朝上公开，叠放显示，无浮窗）
  const renderSuccessZone = () => {
    const successCardIds = player.successZone.cardIds;

    // 固定3个槽位，容器高度固定
    const containerHeight = 68 + 2 * 45; // 294px

    return (
      <DroppableZone
        id="success-zone"
        disabled={isOpponent}
        className="flex flex-col items-center gap-1 relative"
        activeClassName="ring-2 ring-green-500 bg-green-500/20"
      >
        <span className="text-xs text-slate-600 font-medium">成功 Live 卡区</span>

        {/* 卡片区域 - 固定3个槽位，竖向叠放显示 */}
        <div className="relative w-[105px]" style={{ height: `${containerHeight}px` }}>
          {[0, 1, 2].map((slotIndex) => {
            const cardId = successCardIds[slotIndex];
            const card = cardId ? getCardInstance(cardId) : null;

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
                    disabled={isOpponent}
                    data={{ cardId, cardCode: card.data.cardCode, fromZone: ZoneType.SUCCESS_ZONE }}
                  >
                    <div
                      className="w-full h-full flex items-center justify-center cursor-pointer transition-transform hover:scale-105"
                      onMouseEnter={() => setHoveredCard(card.instanceId)}
                      onMouseLeave={() => setHoveredCard(null)}
                    >
                      {/* 横置卡牌 - 逆时针旋转90度 */}
                      <div className="-rotate-90 origin-center">
                        <Card
                          cardData={card.data as AnyCardData}
                          instanceId={card.instanceId}
                          imagePath={getCardImagePath(card.data.cardCode)}
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
      <div key="energy-deck">{renderDeck(player.energyDeck.cardIds.length, '能量卡组', 'energy')}</div>,
      <div key="waiting-room">{renderWaitingRoom()}</div>,
      <div key="main-deck">{renderDeck(player.mainDeck.cardIds.length, '主卡组', 'main')}</div>,
    ] : [
      <div key="main-deck">{renderDeck(player.mainDeck.cardIds.length, '主卡组', 'main')}</div>,
      <div key="waiting-room">{renderWaitingRoom()}</div>,
      <div key="energy-deck">{renderDeck(player.energyDeck.cardIds.length, '能量卡组', 'energy')}</div>,
    ];

    return (
      <div className="flex items-center gap-2">
        {content}
      </div>
    );
  };

  // 渲染单个 Live 卡（横置）
  const renderLiveCard = (cardId: string) => {
    const card = getCardInstance(cardId);
    if (!card) return null;

    const state = liveZone.cardStates.get(cardId);
    // 根据卡牌状态决定是否正面显示（由后端 revealLiveCards 控制）
    const isFaceUp = state?.face !== FaceState.FACE_DOWN;

    // 获取判定结果
    const judgmentResult = liveResults?.get(cardId);
    const showJudgment = isFaceUp && judgmentResult !== undefined;

    // 获取 Live 卡所需心数
    const liveData = isLiveCardData(card.data) ? card.data as LiveCardData : null;

    return (
      <DraggableCard
        id={cardId}
        disabled={isOpponent}
        data={{ cardId, cardCode: card.data.cardCode, fromZone: ZoneType.LIVE_ZONE }}
      >
        <motion.div
          layout
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.9 }}
          // 横置卡牌的容器：需要调整尺寸以适应旋转后的卡牌
          className="relative w-[105px] h-[68px] flex items-center justify-center"
        >
          {/* 横置卡牌 - 逆时针旋转90度 */}
          <div className="-rotate-90 origin-center">
            <Card
              cardData={card.data as AnyCardData}
              instanceId={card.instanceId}
              imagePath={getCardImagePath(card.data.cardCode)}
              size="sm"
              faceUp={isFaceUp}
              interactive={!isOpponent}
              showHover={false}
              onMouseEnter={() => isFaceUp && setHoveredCard(card.instanceId)}
              onMouseLeave={() => setHoveredCard(null)}
              className="w-[80px] h-[112px]"
            />
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
          {isFaceUp && liveData && (
            <div className="absolute -bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-0.5 text-[8px] whitespace-nowrap">
              {Array.from(liveData.requirements.colorRequirements.entries()).map(([color, count], i) => (
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
    const cardId = liveZone.cardIds[slotIndex];
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
          id="live-zone"
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

  // 判断手牌是否可拖拽
  // "信任玩家"原则：己方区域允许自由拖拽，系统自动纠正非法状态
  const canDragFromHand = canOperateOwnZone;

  // 渲染手牌
  const renderHand = () => {
    if (isOpponent) {
      // 对手手牌显示背面 - 使用真实卡背图片，无动画以避免回合切换时的跳动
      return (
        <div className="flex justify-center gap-1 py-2 w-full">
          {player.hand.cardIds.slice(0, 10).map((cardId, idx) => (
            <div
              key={cardId}
              className="w-[60px] h-[84px] rounded-lg overflow-hidden shadow-md"
              style={{
                transform: `rotate(${(idx - player.hand.cardIds.length / 2) * 3}deg)`,
              }}
            >
              <img src="/back.jpg" alt="Card Back" className="w-full h-full object-cover" />
            </div>
          ))}
          {player.hand.cardIds.length > 10 && (
            <span className="text-slate-400 text-xs self-center ml-2">
              +{player.hand.cardIds.length - 10}
            </span>
          )}
        </div>
      );
    }

    // 己方手牌显示正面 (带拖拽，使用纯 CSS 避免动画导致的布局问题)
    return (
      <DroppableZone
        id="hand"
        disabled={isOpponent}
        className="flex justify-center py-2 px-4 w-full"
        activeClassName="ring-2 ring-cyan-500 bg-cyan-500/20"
      >
        {player.hand.cardIds.map((cardId, idx) => {
          const card = getCardInstance(cardId);
          if (!card) return null;

          // "信任玩家"原则：允许自由拖拽任意卡牌
          const isDraggable = canDragFromHand;

          return (
            <div
              key={cardId}
              className="transition-transform duration-200 hover:-translate-y-5 hover:scale-105 hover:z-50"
              style={{
                marginLeft: idx > 0 ? '-15px' : 0,
                transform: `rotate(${(idx - player.hand.cardIds.length / 2) * 5}deg)`,
                zIndex: idx,
              }}
            >
              <DraggableCard
                id={cardId}
                disabled={!isDraggable}
                data={{ cardId, cardCode: card.data.cardCode, fromZone: ZoneType.HAND }}
              >
                <Card
                  cardData={card.data as AnyCardData}
                  instanceId={card.instanceId}
                  imagePath={getCardImagePath(card.data.cardCode)}
                  size="sm"
                  faceUp={true}
                  selected={selectedCardId === card.instanceId}
                  onClick={() => selectCard(card.instanceId)}
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
              const topCardId = player.mainDeck.cardIds[0];
              if (!topCardId) return;
              manualMoveCard(topCardId, ZoneType.MAIN_DECK, ZoneType.HAND);
            }}
            disabled={player.mainDeck.cardIds.length === 0}
            className={cn(
              'w-7 h-7 rounded text-xs font-bold',
              'transition-colors',
              player.mainDeck.cardIds.length > 0
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
              const rightmostHandCardId = player.hand.cardIds[player.hand.cardIds.length - 1];
              if (!rightmostHandCardId) return;
              manualMoveCard(rightmostHandCardId, ZoneType.HAND, ZoneType.MAIN_DECK, { position: 'TOP' });
            }}
            disabled={player.hand.cardIds.length === 0}
            className={cn(
              'w-7 h-7 rounded text-xs font-bold',
              'transition-colors',
              player.hand.cardIds.length > 0
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
          'h-full flex flex-col p-2 transition-colors',
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
            {player.name}
          </div>
          <div className="text-[10px] text-slate-600 font-medium">
            手牌: {player.hand.cardIds.length}
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
      </div>
    );
  }

  // 己方区域：成员槽和Live区在顶部（靠近中央分隔线），手牌在底部
  return (
    <div
      className={cn(
        'h-full flex flex-col p-2 transition-colors overflow-x-hidden',
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
          {player.name}
        </div>
        <div className="text-[10px] text-slate-600 font-medium">
          手牌: {player.hand.cardIds.length}
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

      {/* 卡组检视面板 */}
      <DeckPeekModal
        isOpen={deckPeekModalOpen}
        onClose={() => setDeckPeekModalOpen(false)}
        playerId={player.id}
      />
    </div>
  );
});

export default PlayerArea;
