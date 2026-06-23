/**
 * 可放置区域包装器
 * 使用 @dnd-kit 实现放置目标功能
 *
 * 高亮模式：
 * 1. 拖拽进行中：仅高亮“推荐目标”（由 GameBoard 计算并写入 store）
 * 2. 拖拽进行中：若存在推荐目标，其余区域会被轻微变暗（仍可放置）
 * 3. 悬停时：当前悬停区域显示 "悬停" 高亮（activeClassName）
 */

import { useDndContext, useDroppable } from '@dnd-kit/core';
import { cn } from '@/lib/utils';
import type { MouseEventHandler, ReactNode } from 'react';
import { useGameStore } from '@/store/gameStore';

export interface DroppableZoneProps {
  /** 唯一标识符 (如槽位 ID) */
  id: string;
  /** 可选的 DOM id，用于调试或测试定位 */
  domId?: string;
  /** 逻辑区域 ID，用于测试和语义标记 */
  zoneId?: string;
  /** 可选的数据 */
  data?: Record<string, unknown>;
  /** 是否禁用放置 */
  disabled?: boolean;
  /** 当当前拖拽来源来自这些区域时，临时禁用放置 */
  disabledForDragFromZones?: readonly string[];
  /** 子元素 */
  children: ReactNode;
  /** 基础类名 */
  className?: string;
  /** 悬停时的高亮类名（鼠标在上方） */
  activeClassName?: string;
  /** 拖拽进行时的高亮类名（标识可放置目标） */
  dropTargetClassName?: string;
  /** 拖拽时变暗其他区域（有推荐目标时才启用） */
  dimOthersClassName?: string;
  /** 浏览器 tooltip */
  title?: string;
  /** 无障碍标签 */
  ariaLabel?: string;
  /** 点击当前放置目标 */
  onClick?: MouseEventHandler<HTMLDivElement>;
}

export function DroppableZone({
  id,
  domId,
  zoneId,
  data,
  disabled = false,
  disabledForDragFromZones = [],
  children,
  className,
  // Prefer `outline` over `ring` here: Tailwind `ring` is box-shadow based and can be
  // noticeably more expensive to repaint during drag hover updates.
  activeClassName = 'outline outline-2 outline-rose-500 bg-rose-500/20',
  dropTargetClassName = 'outline outline-2 outline-dashed outline-amber-400/70 bg-amber-500/10',
  dimOthersClassName = 'opacity-35 saturate-50',
  title,
  ariaLabel,
  onClick,
}: DroppableZoneProps) {
  const { active } = useDndContext();
  const activeDragData = active?.data.current as { fromZone?: unknown } | undefined;
  const activeFromZone =
    activeDragData?.fromZone === undefined ? null : String(activeDragData.fromZone);
  const isDisabledForActiveDrag =
    activeFromZone !== null && disabledForDragFromZones.includes(activeFromZone);
  const effectiveDisabled = disabled || isDisabledForActiveDrag;
  const { isOver, setNodeRef } = useDroppable({
    id,
    data,
    disabled: effectiveDisabled,
  });

  const isDragging = useGameStore((s) => s.ui.isDragging);
  const highlightedZones = useGameStore((s) => s.ui.highlightedZones);
  const highlightKey = zoneId ?? id;

  const hasSuggestedTargets = highlightedZones.length > 0;
  const isSuggested = hasSuggestedTargets && highlightedZones.includes(highlightKey);

  // 判断是否应该显示 “推荐目标” 高亮
  const showDropTarget = isDragging && !effectiveDisabled && !isOver && isSuggested;
  // 判断是否应该显示 "悬停" 高亮
  const showActive = isOver && !effectiveDisabled;
  // 拖拽时有推荐目标，其他区域变暗（仍可放置）
  const showDimOthers =
    isDragging && hasSuggestedTargets && !isSuggested && !isOver && !effectiveDisabled;

  return (
    <div
      ref={setNodeRef}
      id={domId ?? id}
      data-zone-id={zoneId ?? domId ?? id}
      title={title}
      aria-label={ariaLabel}
      onClick={onClick}
      className={cn(
        // During drag, avoid transitions (they stack with frequent hover updates and can feel "laggy").
        isDragging
          ? 'transition-none'
          : 'transition-[opacity,outline-color,background-color] duration-150',
        className,
        showDropTarget && dropTargetClassName,
        showDimOthers && dimOthersClassName,
        showActive && activeClassName
      )}
    >
      {children}
    </div>
  );
}

export default DroppableZone;
