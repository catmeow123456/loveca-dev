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

import { useState, useCallback, memo, useMemo, useEffect } from 'react';
import { motion } from 'framer-motion';
import { createPortal } from 'react-dom';
import { ArrowDownToLine, ArrowUpToLine, Eye, Layers3, Megaphone, Trash2, X } from 'lucide-react';
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
  const permissionView = useGameStore((s) => s.getPermissionView());
  const gameState = useGameStore((s) => s.gameState);
  const viewerSeat = useGameStore((s) => s.getViewerSeat());
  const player = useGameStore((s) => s.getPlayerStateById(playerId));
  const getSeatZone = useGameStore((s) => s.getSeatZone);
  const getZoneCardIds = useGameStore((s) => s.getZoneCardIds);
  const getCardInstance = useGameStore((s) => s.getCardInstance);
  const getCardImagePath = useGameStore((s) => s.getCardImagePath);
  const setHoveredCard = useGameStore((s) => s.setHoveredCard);
  const openInspection = useGameStore((s) => s.openInspection);
  const moveInspectedCardToTop = useGameStore((s) => s.moveInspectedCardToTop);
  const revealInspectedCard = useGameStore((s) => s.revealInspectedCard);
  const moveInspectedCardToBottom = useGameStore((s) => s.moveInspectedCardToBottom);
  const moveInspectedCardToZone = useGameStore((s) => s.moveInspectedCardToZone);
  const reorderInspectedCard = useGameStore((s) => s.reorderInspectedCard);
  const finishInspection = useGameStore((s) => s.finishInspection);

  // 检视区卡牌 ID 列表（本地状态，用于排序）
  const [peekCardIds, setPeekCardIds] = useState<string[]>([]);

  const mainDeckCount = player?.mainDeck.cardIds.length ?? 0;
  const inspectionZone = viewerSeat ? getSeatZone(viewerSeat, 'INSPECTION_ZONE') : null;
  const resolutionCardIds = useMemo(() => {
    if (viewerSeat && inspectionZone?.objectIds) {
      return getZoneCardIds(`${viewerSeat}_INSPECTION_ZONE`);
    }

    return [];
  }, [getZoneCardIds, inspectionZone?.objectIds, viewerSeat]);
  const canAct = permissionView?.canAct ?? true;
  const revealedInspectionCardIds = gameState?.inspectionZone.revealedCardIds ?? [];

  // 拖拽传感器
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    })
  );

  useEffect(() => {
    setPeekCardIds((prev) => {
      const next = prev.filter((cardId) => resolutionCardIds.includes(cardId));
      for (const cardId of resolutionCardIds) {
        if (!next.includes(cardId)) {
          next.push(cardId);
        }
      }
      return next;
    });
  }, [resolutionCardIds]);

  // 从卡组顶抽一张牌到检视区
  const drawFromDeck = useCallback(() => {
    if (!player || mainDeckCount === 0) return;

    const topCardId = player.mainDeck.cardIds[0];
    if (!topCardId) return;

    // 移动到解决区域
    const result = openInspection(ZoneType.MAIN_DECK, 1);
    if (result.success) {
      // 添加到本地检视列表尾部
      setPeekCardIds((prev) => [...prev, topCardId]);
    }
  }, [player, mainDeckCount, openInspection]);

  // 把检视区尾部的牌放回卡组顶
  const returnToDeck = useCallback(() => {
    if (peekCardIds.length === 0) return;

    const lastCardId = peekCardIds[peekCardIds.length - 1];

    // 移动回主卡组
    const result = moveInspectedCardToTop(lastCardId);
    if (result.success) {
      // 从本地检视列表移除
      setPeekCardIds((prev) => prev.slice(0, -1));
    }
  }, [peekCardIds, moveInspectedCardToTop]);

  // 把所有检视区的牌按顺序放回卡组顶
  const returnAllToDeck = useCallback(() => {
    if (peekCardIds.length === 0) return;

    // 从尾部开始逐一放回，这样顺序会保持（最后放回的在最上面）
    const reversedIds = [...peekCardIds].reverse();
    for (const cardId of reversedIds) {
      moveInspectedCardToTop(cardId);
    }
    setPeekCardIds([]);
  }, [peekCardIds, moveInspectedCardToTop]);

  // 把所有检视区的牌放入休息室
  const moveAllToWaitingRoom = useCallback(() => {
    if (peekCardIds.length === 0) return;

    const remainingIds: string[] = [];
    for (const cardId of peekCardIds) {
      const result = moveInspectedCardToZone(cardId, ZoneType.WAITING_ROOM);
      if (!result.success) {
        remainingIds.push(cardId);
      }
    }

    setHoveredCard(null);
    setPeekCardIds(remainingIds);
  }, [peekCardIds, moveInspectedCardToZone, setHoveredCard]);

  // 移动卡牌到手牌
  const moveToHand = useCallback((cardId: string) => {
    const result = moveInspectedCardToZone(cardId, ZoneType.HAND);
    if (result.success) {
      setHoveredCard(null);
      setPeekCardIds((prev) => prev.filter((id) => id !== cardId));
    }
  }, [moveInspectedCardToZone, setHoveredCard]);

  const revealToOpponent = useCallback((cardId: string) => {
    const result = revealInspectedCard(cardId);
    if (result.success) {
      setHoveredCard(null);
    }
  }, [revealInspectedCard, setHoveredCard]);

  // 移动卡牌到休息室
  const moveToWaitingRoom = useCallback((cardId: string) => {
    const result = moveInspectedCardToZone(cardId, ZoneType.WAITING_ROOM);
    if (result.success) {
      setHoveredCard(null);
      setPeekCardIds((prev) => prev.filter((id) => id !== cardId));
    }
  }, [moveInspectedCardToZone, setHoveredCard]);

  // 移动卡牌到卡组底
  const moveToDeckBottom = useCallback((cardId: string) => {
    const result = moveInspectedCardToBottom(cardId);
    if (result.success) {
      setHoveredCard(null);
      setPeekCardIds((prev) => prev.filter((id) => id !== cardId));
    }
  }, [moveInspectedCardToBottom, setHoveredCard]);

  // 处理拖拽排序结束
  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;

    if (over && active.id !== over.id) {
      setPeekCardIds((items) => {
        const oldIndex = items.indexOf(active.id as string);
        const newIndex = items.indexOf(over.id as string);
        if (oldIndex < 0 || newIndex < 0) {
          return items;
        }

        const result = reorderInspectedCard(active.id as string, newIndex);
        if (!result.success) {
          return items;
        }

        return arrayMove(items, oldIndex, newIndex);
      });
    }
  }, [reorderInspectedCard]);

  // 关闭面板时，把所有牌放回卡组
  const handleClose = useCallback(() => {
    returnAllToDeck();
    finishInspection();
    onClose();
  }, [returnAllToDeck, finishInspection, onClose]);

  if (!isOpen) return null;

  // 获取检视区的卡牌实例
  const peekCards = peekCardIds
    .map((id) => getCardInstance(id))
    .filter((card): card is CardInstance => card !== null);

  const modalContent = (
    <>
      <div
        className="modal-backdrop z-[90]"
        onClick={handleClose}
      />

      <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
        <motion.div
          className="modal-surface modal-accent-indigo w-[560px] max-w-[calc(100vw-2rem)] p-4"
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.9 }}
        >
          <div className="modal-header -mx-4 -mt-4 mb-3 flex items-center justify-between px-4 py-3">
            <div className="flex items-center gap-2">
              <Eye size={16} className="text-[var(--heart-purple)]" />
              <span className="text-sm font-medium text-[var(--text-primary)]">检视卡组顶 ({peekCards.length} 张)</span>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-xs text-[var(--text-secondary)]">主卡组剩余: {mainDeckCount} 张</span>
              <button onClick={handleClose} className="button-icon h-8 w-8">
                <X size={14} />
              </button>
            </div>
          </div>

          <div className="mb-3 flex gap-2">
            <button
              onClick={drawFromDeck}
              disabled={!canAct || mainDeckCount === 0}
              className={cn(
                'inline-flex items-center gap-1 rounded px-3 py-1.5 text-xs font-medium',
                canAct && mainDeckCount > 0
                  ? 'button-primary'
                  : 'cursor-not-allowed bg-[var(--bg-overlay)] text-[var(--text-muted)]'
              )}
            >
              <ArrowDownToLine size={14} />
              翻开一张
            </button>
            <button
              onClick={returnToDeck}
              disabled={!canAct || peekCards.length === 0}
              className={cn(
                'inline-flex items-center gap-1 rounded px-3 py-1.5 text-xs font-medium',
                canAct && peekCards.length > 0
                  ? 'button-gold'
                  : 'cursor-not-allowed bg-[var(--bg-overlay)] text-[var(--text-muted)]'
              )}
            >
              <ArrowUpToLine size={14} />
              放回顶部
            </button>
            <button
              onClick={returnAllToDeck}
              disabled={!canAct || peekCards.length === 0}
              className={cn(
                'inline-flex items-center gap-1 rounded px-3 py-1.5 text-xs font-medium',
                canAct && peekCards.length > 0
                  ? 'button-secondary'
                  : 'cursor-not-allowed bg-[var(--bg-overlay)] text-[var(--text-muted)]'
              )}
            >
              <Layers3 size={14} />
              全部放回
            </button>
            <button
              onClick={moveAllToWaitingRoom}
              disabled={!canAct || peekCards.length === 0}
              className={cn(
                'inline-flex items-center gap-1 rounded px-3 py-1.5 text-xs font-medium',
                canAct && peekCards.length > 0
                  ? 'rounded border border-[color:color-mix(in_srgb,var(--semantic-error)_40%,transparent)] bg-[color:color-mix(in_srgb,var(--semantic-error)_16%,transparent)] text-[var(--semantic-error)]'
                  : 'cursor-not-allowed bg-[var(--bg-overlay)] text-[var(--text-muted)]'
              )}
            >
              <Trash2 size={14} />
              全部放入休息室
            </button>
          </div>

          <div className="h-[150px] overflow-hidden rounded border border-[var(--border-default)] bg-[color:color-mix(in_srgb,var(--bg-overlay)_56%,transparent)] p-3">
            {peekCards.length === 0 ? (
              <div className="flex h-[126px] items-center justify-center text-sm text-[var(--text-muted)]">
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
                  <div className="h-full overflow-x-auto overflow-y-hidden pb-1">
                    <div className="flex w-max flex-nowrap gap-2">
                    {peekCards.map((card) => (
                      <div
                        key={card.instanceId}
                        className="group relative"
                        onMouseEnter={() => setHoveredCard(card.instanceId)}
                        onMouseLeave={() => setHoveredCard(null)}
                      >
                        {revealedInspectionCardIds.includes(card.instanceId) ? (
                          <div className="pointer-events-none absolute left-2 top-2 z-10 rounded-full bg-[color:color-mix(in_srgb,var(--semantic-success)_88%,black_12%)] px-2 py-0.5 text-[10px] font-semibold text-white shadow-[var(--shadow-md)]">
                            已公开
                          </div>
                        ) : null}
                        <SortableCard
                          cardId={card.instanceId}
                          imagePath={getCardImagePath(card.data.cardCode)}
                        />
                        <div className="absolute -bottom-1 left-1/2 z-10 flex -translate-x-1/2 gap-0.5 rounded bg-[var(--bg-elevated)] px-1 py-0.5 opacity-0 shadow-[var(--shadow-md)] group-hover:opacity-100">
                          <button
                            disabled={!canAct || revealedInspectionCardIds.includes(card.instanceId)}
                            onClick={() => revealToOpponent(card.instanceId)}
                            className={cn(
                              'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-white',
                              canAct && !revealedInspectionCardIds.includes(card.instanceId)
                                ? 'bg-emerald-600 hover:bg-emerald-500'
                                : 'cursor-not-allowed bg-slate-600'
                            )}
                            title="公开给对手"
                          >
                            <Megaphone size={10} />
                            公开
                          </button>
                          <button
                            disabled={!canAct}
                            onClick={() => moveToHand(card.instanceId)}
                            className={cn(
                              'text-[10px] px-1.5 py-0.5 rounded text-white',
                              canAct ? 'bg-cyan-600 hover:bg-cyan-500' : 'bg-slate-600 cursor-not-allowed'
                            )}
                            title="加入手牌"
                          >
                            手牌
                          </button>
                          <button
                            disabled={!canAct}
                            onClick={() => moveToWaitingRoom(card.instanceId)}
                            className={cn(
                              'text-[10px] px-1.5 py-0.5 rounded text-white',
                              canAct ? 'bg-slate-600 hover:bg-slate-500' : 'bg-slate-600 cursor-not-allowed'
                            )}
                            title="放入休息室"
                          >
                            弃置
                          </button>
                          <button
                            disabled={!canAct}
                            onClick={() => moveToDeckBottom(card.instanceId)}
                            className={cn(
                              'text-[10px] px-1.5 py-0.5 rounded text-white',
                              canAct ? 'bg-amber-600 hover:bg-amber-500' : 'bg-slate-600 cursor-not-allowed'
                            )}
                            title="放到卡组底"
                          >
                            底部
                          </button>
                        </div>
                      </div>
                    ))}
                    </div>
                  </div>
                </SortableContext>
              </DndContext>
            )}
          </div>

          <div className="mt-2 text-center text-[10px] text-[var(--text-muted)]">
            拖拽卡牌可调整顺序 · 可单独公开检视牌 · 点击外部关闭并放回所有卡牌
          </div>
        </motion.div>
      </div>
    </>
  );

  if (typeof document === 'undefined') {
    return modalContent;
  }

  return createPortal(modalContent, document.body);
}

export default DeckPeekModal;
