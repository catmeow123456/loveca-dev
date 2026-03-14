/**
 * 卡组检视面板组件
 *
 * 功能：
 * - 点击主卡组后弹出
 * - 从卡组顶抽牌到检视区
 * - 把检视区的牌放回卡组顶
 * - 检视区内卡牌可拖拽排序
 * - 可从检视区拖拽卡牌到其他区域（手牌、休息室等）
 */

import { useState, useCallback, memo } from 'react';
import { motion } from 'framer-motion';
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  horizontalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { cn } from '@/lib/utils';
import { useGameStore } from '@/store/gameStore';
import { ZoneType } from '@game/shared/types/enums';
import type { CardInstance } from '@game/domain/entities/card';

interface DeckPeekModalProps {
  isOpen: boolean;
  onClose: () => void;
  playerId: string;
}

/**
 * 可排序的卡牌项 - 简化版，不使用 DragOverlay
 */
const SortableCard = memo(function SortableCard({
  cardId,
  imagePath,
}: {
  cardId: string;
  imagePath: string;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    isDragging,
  } = useSortable({ id: cardId });

  // 直接在元素上应用变换
  const style: React.CSSProperties = {
    transform: transform
      ? `translate3d(${transform.x}px, ${transform.y}px, 0)`
      : undefined,
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
        'w-[90px] h-[126px] rounded-lg overflow-hidden shadow-md cursor-grab',
        isDragging && 'shadow-xl ring-2 ring-purple-400'
      )}
    >
      <img
        src={imagePath}
        alt=""
        className="w-full h-full object-cover"
        draggable={false}
      />
    </div>
  );
});

export function DeckPeekModal({ isOpen, onClose, playerId }: DeckPeekModalProps) {
  const gameState = useGameStore((s) => s.gameState);
  const getCardInstance = useGameStore((s) => s.getCardInstance);
  const getCardImagePath = useGameStore((s) => s.getCardImagePath);
  const setHoveredCard = useGameStore((s) => s.setHoveredCard);
  const manualMoveCard = useGameStore((s) => s.manualMoveCard);

  // 检视区卡牌 ID 列表（本地状态，用于排序）
  const [peekCardIds, setPeekCardIds] = useState<string[]>([]);

  // 获取当前玩家
  const player = gameState?.players.find((p) => p.id === playerId);
  const mainDeckCount = player?.mainDeck.cardIds.length ?? 0;

  // 拖拽传感器
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    })
  );

  // 从卡组顶抽一张牌到检视区
  const drawFromDeck = useCallback(() => {
    if (!player || mainDeckCount === 0) return;

    const topCardId = player.mainDeck.cardIds[0];
    if (!topCardId) return;

    // 移动到解决区域
    const result = manualMoveCard(topCardId, ZoneType.MAIN_DECK, ZoneType.RESOLUTION_ZONE);
    if (result.success) {
      // 添加到本地检视列表尾部
      setPeekCardIds((prev) => [...prev, topCardId]);
    }
  }, [player, mainDeckCount, manualMoveCard]);

  // 把检视区尾部的牌放回卡组顶
  const returnToDeck = useCallback(() => {
    if (peekCardIds.length === 0) return;

    const lastCardId = peekCardIds[peekCardIds.length - 1];

    // 移动回主卡组
    const result = manualMoveCard(lastCardId, ZoneType.RESOLUTION_ZONE, ZoneType.MAIN_DECK, {
      position: 'TOP',
    });
    if (result.success) {
      // 从本地检视列表移除
      setPeekCardIds((prev) => prev.slice(0, -1));
    }
  }, [peekCardIds, manualMoveCard]);

  // 把所有检视区的牌按顺序放回卡组顶
  const returnAllToDeck = useCallback(() => {
    if (peekCardIds.length === 0) return;

    // 从尾部开始逐一放回，这样顺序会保持（最后放回的在最上面）
    const reversedIds = [...peekCardIds].reverse();
    for (const cardId of reversedIds) {
      manualMoveCard(cardId, ZoneType.RESOLUTION_ZONE, ZoneType.MAIN_DECK, {
        position: 'TOP',
      });
    }
    setPeekCardIds([]);
  }, [peekCardIds, manualMoveCard]);

  // 移动卡牌到手牌
  const moveToHand = useCallback((cardId: string) => {
    const result = manualMoveCard(cardId, ZoneType.RESOLUTION_ZONE, ZoneType.HAND);
    if (result.success) {
      setPeekCardIds((prev) => prev.filter((id) => id !== cardId));
    }
  }, [manualMoveCard]);

  // 移动卡牌到休息室
  const moveToWaitingRoom = useCallback((cardId: string) => {
    const result = manualMoveCard(cardId, ZoneType.RESOLUTION_ZONE, ZoneType.WAITING_ROOM);
    if (result.success) {
      setPeekCardIds((prev) => prev.filter((id) => id !== cardId));
    }
  }, [manualMoveCard]);

  // 移动卡牌到卡组底
  const moveToDeckBottom = useCallback((cardId: string) => {
    const result = manualMoveCard(cardId, ZoneType.RESOLUTION_ZONE, ZoneType.MAIN_DECK, {
      position: 'BOTTOM',
    });
    if (result.success) {
      setPeekCardIds((prev) => prev.filter((id) => id !== cardId));
    }
  }, [manualMoveCard]);

  // 处理拖拽排序结束
  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;

    if (over && active.id !== over.id) {
      setPeekCardIds((items) => {
        const oldIndex = items.indexOf(active.id as string);
        const newIndex = items.indexOf(over.id as string);
        return arrayMove(items, oldIndex, newIndex);
      });
    }
  }, []);

  // 关闭面板时，把所有牌放回卡组
  const handleClose = useCallback(() => {
    returnAllToDeck();
    onClose();
  }, [returnAllToDeck, onClose]);

  if (!isOpen) return null;

  // 获取检视区的卡牌实例
  const peekCards = peekCardIds
    .map((id) => getCardInstance(id))
    .filter((card): card is CardInstance => card !== null);

  return (
    <>
      {/* 背景遮罩 */}
      <div
        className="fixed inset-0 bg-black/60 z-[90]"
        onClick={handleClose}
      />

      {/* 面板 */}
      <motion.div
        className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-slate-800/95 rounded-lg p-4 shadow-xl border border-purple-500/50 z-[100] min-w-[400px] max-w-[700px]"
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.9 }}
      >
        {/* 标题栏 */}
        <div className="flex items-center justify-between mb-3 pb-2 border-b border-slate-600">
          <span className="text-sm text-purple-300 font-medium">
            检视卡组顶 ({peekCards.length} 张)
          </span>
          <span className="text-xs text-slate-400">
            主卡组剩余: {mainDeckCount} 张
          </span>
        </div>

        {/* 操作按钮 */}
        <div className="flex gap-2 mb-3">
          <button
            onClick={drawFromDeck}
            disabled={mainDeckCount === 0}
            className={cn(
              'px-3 py-1.5 rounded text-xs font-medium',
              mainDeckCount > 0
                ? 'bg-purple-600 hover:bg-purple-500 text-white'
                : 'bg-slate-700 text-slate-500 cursor-not-allowed'
            )}
          >
            ↓ 翻开一张
          </button>
          <button
            onClick={returnToDeck}
            disabled={peekCards.length === 0}
            className={cn(
              'px-3 py-1.5 rounded text-xs font-medium',
              peekCards.length > 0
                ? 'bg-amber-600 hover:bg-amber-500 text-white'
                : 'bg-slate-700 text-slate-500 cursor-not-allowed'
            )}
          >
            ↑ 放回顶部
          </button>
          <button
            onClick={returnAllToDeck}
            disabled={peekCards.length === 0}
            className={cn(
              'px-3 py-1.5 rounded text-xs font-medium',
              peekCards.length > 0
                ? 'bg-slate-600 hover:bg-slate-500 text-white'
                : 'bg-slate-700 text-slate-500 cursor-not-allowed'
            )}
          >
            全部放回
          </button>
        </div>

        {/* 检视区卡牌（可拖拽排序） */}
        <div className="min-h-[150px] p-3 rounded bg-slate-900/50 border border-dashed border-purple-500/30 overflow-hidden">
          {peekCards.length === 0 ? (
            <div className="h-[126px] flex items-center justify-center text-slate-500 text-sm">
              点击「翻开一张」从卡组顶检视卡牌
            </div>
          ) : (
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <SortableContext
                items={peekCardIds}
                strategy={horizontalListSortingStrategy}
              >
                <div className="flex gap-2 flex-wrap">
                  {peekCards.map((card) => (
                    <div
                      key={card.instanceId}
                      className="relative group"
                      onMouseEnter={() => setHoveredCard(card.instanceId)}
                      onMouseLeave={() => setHoveredCard(null)}
                    >
                      <SortableCard
                        cardId={card.instanceId}
                        imagePath={getCardImagePath(card.data.cardCode)}
                      />
                      {/* 卡牌操作菜单 */}
                      <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100 flex gap-0.5 bg-slate-800/90 rounded px-1 py-0.5 z-10">
                        <button
                          onClick={() => moveToHand(card.instanceId)}
                          className="text-[10px] px-1.5 py-0.5 bg-cyan-600 hover:bg-cyan-500 rounded text-white"
                          title="加入手牌"
                        >
                          手牌
                        </button>
                        <button
                          onClick={() => moveToWaitingRoom(card.instanceId)}
                          className="text-[10px] px-1.5 py-0.5 bg-slate-600 hover:bg-slate-500 rounded text-white"
                          title="放入休息室"
                        >
                          弃置
                        </button>
                        <button
                          onClick={() => moveToDeckBottom(card.instanceId)}
                          className="text-[10px] px-1.5 py-0.5 bg-amber-600 hover:bg-amber-500 rounded text-white"
                          title="放到卡组底"
                        >
                          底部
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          )}
        </div>

        {/* 提示文字 */}
        <div className="mt-2 text-[10px] text-slate-500 text-center">
          拖拽卡牌可调整顺序 · 悬停卡牌显示操作菜单 · 点击外部关闭并放回所有卡牌
        </div>
      </motion.div>
    </>
  );
}

export default DeckPeekModal;
