import { memo } from 'react';
import { motion } from 'framer-motion';
import { createPortal } from 'react-dom';
import { Layers3, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { DraggableCard } from './interaction';
import { ZoneType } from '@game/shared/types/enums';

interface HiddenDeckBrowserModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  zoneType: ZoneType.MAIN_DECK | ZoneType.ENERGY_DECK;
  cardIds: readonly string[];
  canDragCards: boolean;
  draggableCardIds?: readonly string[];
  isDragging: boolean;
}

export const HiddenDeckBrowserModal = memo(function HiddenDeckBrowserModal({
  isOpen,
  onClose,
  title,
  zoneType,
  cardIds,
  canDragCards,
  draggableCardIds,
  isDragging,
}: HiddenDeckBrowserModalProps) {
  if (!isOpen) {
    return null;
  }

  const modalContent = (
    <>
      <div
        className={cn('modal-backdrop z-[90]', isDragging && 'pointer-events-none')}
        onClick={!isDragging ? onClose : undefined}
      />

      <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
        <motion.div
          className="modal-surface modal-accent-indigo w-[min(92vw,860px)] max-h-[84vh] overflow-hidden"
          initial={{ opacity: 0, scale: 0.96, y: 12 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.96, y: 12 }}
        >
          <div className="modal-header flex items-center justify-between px-5 py-4">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-full border border-[var(--border-default)] bg-[color:color-mix(in_srgb,var(--bg-surface)_84%,transparent)] text-[var(--accent-primary)]">
                <Layers3 size={16} />
              </div>
              <div>
                <div className="text-sm font-semibold text-[var(--text-primary)]">{title}</div>
                <div className="text-xs text-[var(--text-secondary)]">
                  共 {cardIds.length} 张，顶部在最左侧。拖拽任意一张到主桌即可提交正式移动。
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="button-icon h-8 w-8"
              title="关闭"
            >
              <X size={14} />
            </button>
          </div>

          <div className="border-b border-[var(--border-subtle)] bg-[color:color-mix(in_srgb,var(--accent-primary)_8%,transparent)] px-5 py-3 text-xs text-[var(--text-secondary)]">
            {canDragCards
              ? '当前窗口允许从隐藏区直接拖到公开区或其他允许区域。'
              : '当前窗口不允许正式移动隐藏区卡牌；你仍可查看顺序，但不能拖拽提交。'}
          </div>

          <div className="cute-scrollbar max-h-[calc(84vh-112px)] overflow-y-auto p-5">
            {cardIds.length === 0 ? (
              <div className="flex h-40 items-center justify-center text-sm text-[var(--text-muted)]">
                该牌堆为空
              </div>
            ) : (
              <div className="grid grid-cols-4 gap-3 sm:grid-cols-5 md:grid-cols-6 lg:grid-cols-7">
                {cardIds.map((cardId, index) => (
                  <DraggableCard
                    key={cardId}
                    id={cardId}
                    disabled={
                      !canDragCards ||
                      (Array.isArray(draggableCardIds) &&
                        !draggableCardIds.includes(cardId))
                    }
                    data={{ cardId, fromZone: zoneType }}
                  >
                    <div
                      className={cn(
                        'group relative overflow-hidden rounded-lg border border-[var(--border-default)] bg-[var(--bg-overlay)] shadow-[var(--shadow-sm)]',
                        canDragCards
                          ? 'cursor-grab active:cursor-grabbing'
                          : 'cursor-default opacity-70',
                        isDragging
                          ? 'transition-none'
                          : 'transition-[transform,box-shadow] duration-200 hover:-translate-y-1 hover:shadow-[var(--shadow-md)]'
                      )}
                    >
                      {index === 0 ? (
                        <div className="pointer-events-none absolute left-2 top-2 z-10 rounded-full bg-[color:color-mix(in_srgb,var(--accent-secondary)_88%,black_12%)] px-2 py-0.5 text-[10px] font-semibold text-white shadow-[var(--shadow-md)]">
                          TOP
                        </div>
                      ) : null}
                      <div className="aspect-[5/7] w-full overflow-hidden">
                        <img src="/back.jpg" alt="" className="h-full w-full object-cover" draggable={false} />
                      </div>
                      <div className="flex items-center justify-between border-t border-[var(--border-subtle)] px-2 py-1 text-[10px] text-[var(--text-secondary)]">
                        <span>#{index + 1}</span>
                        <span>{zoneType === ZoneType.ENERGY_DECK ? 'ENERGY' : 'DECK'}</span>
                      </div>
                    </div>
                  </DraggableCard>
                ))}
              </div>
            )}
          </div>
        </motion.div>
      </div>
    </>
  );

  if (typeof document === 'undefined') {
    return modalContent;
  }

  return createPortal(modalContent, document.body);
});

export default HiddenDeckBrowserModal;
