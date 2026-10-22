/**
 * 可拖拽卡牌包装器
 * 使用 @dnd-kit 实现拖拽功能
 */

import { useDraggable } from '@dnd-kit/core';
import { cn } from '@/lib/utils';
import type { ReactNode } from 'react';

export interface DraggableCardProps {
  /** 唯一标识符 (卡牌 instanceId) */
  id: string;
  /** 卡牌数据，传递给 DragOverlay */
  data?: Record<string, unknown>;
  /** 是否禁用拖拽 */
  disabled?: boolean;
  /** 子控件提供交互语义时，外层仅处理指针拖拽，避免嵌套按钮与重复焦点 */
  hasInteractiveChild?: boolean;
  /** 子元素 */
  children: ReactNode;
  /** 额外的类名 */
  className?: string;
  /** 双击事件处理 */
  onDoubleClick?: () => void;
}

export function DraggableCard({
  id,
  data,
  disabled = false,
  hasInteractiveChild = false,
  children,
  className,
  onDoubleClick,
}: DraggableCardProps) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id,
    data,
    disabled,
  });

  return (
    <div
      ref={setNodeRef}
      className={cn(
        'touch-none select-none',
        // 拖拽时完全隐藏原始元素（DragOverlay 会显示副本）
        // 避免transform导致父容器布局变化
        isDragging && 'opacity-0',
        disabled && 'cursor-default',
        !disabled && 'cursor-grab active:cursor-grabbing',
        className
      )}
      {...listeners}
      {...(hasInteractiveChild ? {} : attributes)}
      onDoubleClick={onDoubleClick}
    >
      {children}
    </div>
  );
}

export default DraggableCard;
