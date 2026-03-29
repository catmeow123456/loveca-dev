/**
 * CardDetailDrawer - 卡牌详情侧边抽屉
 * 纯查看，不含增删操作
 */

import { useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { useGameStore } from '@/store/gameStore';
import { Card } from '@/components/card/Card';
import { MemberCardDetails, LiveCardDetails } from '@/components/game/CardDetailOverlay';
import type { AnyCardData } from '@game/domain/entities/card';
import { isMemberCardData, isLiveCardData } from '@game/domain/entities/card';

interface CardDetailDrawerProps {
  card: AnyCardData | null;
  onClose: () => void;
}

export function CardDetailDrawer({ card, onClose }: CardDetailDrawerProps) {
  const { getCardImagePath } = useGameStore(
    useShallow((s) => ({ getCardImagePath: s.getCardImagePath }))
  );

  // ESC 关闭
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    if (card) {
      document.addEventListener('keydown', handleKeyDown);
      return () => document.removeEventListener('keydown', handleKeyDown);
    }
  }, [card, onClose]);

  return (
    <AnimatePresence>
      {card && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="modal-backdrop fixed inset-0 z-40"
            onClick={onClose}
          />

          <motion.div
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 30, stiffness: 300 }}
            className="workspace-sidebar fixed bottom-0 right-0 top-0 z-50 flex w-[400px] flex-col border-l border-[var(--border-default)] shadow-[var(--shadow-lg)]"
            onClick={(e) => e.stopPropagation()}
          >
            {/* 头部 */}
            <div className="workspace-toolbar flex items-center justify-between px-5 py-3">
              <h3 className="text-sm font-semibold text-[var(--text-primary)]">卡牌详情</h3>
              <button
                onClick={onClose}
                className="button-icon h-7 w-7"
              >
                <X size={16} />
              </button>
            </div>

            {/* 内容区域 */}
            <div className="flex-1 overflow-y-auto p-5 cute-scrollbar">
              {/* 卡牌图片 */}
              <div className="flex justify-center mb-5">
                <Card
                  cardData={card}
                  imagePath={getCardImagePath(card.cardCode)}
                  size="lg"
                  faceUp={true}
                  interactive={false}
                  showHover={false}
                  className="rounded-lg ring-1 ring-[var(--border-default)]"
                />
              </div>

              {/* 卡牌名称 & 编号 */}
              <h3 className="mb-1 text-center text-xl font-bold text-[var(--text-primary)]">
                {card.name}
              </h3>
              <div className="mb-5 text-center text-xs text-[var(--text-muted)]">
                {card.cardCode}
              </div>

              {/* 分隔线 */}
              <div className="mb-5 h-px bg-gradient-to-r from-transparent via-[var(--border-default)] to-transparent" />

              {/* 卡牌详情 */}
              <div className="space-y-4">
                {isMemberCardData(card) && <MemberCardDetails data={card} />}
                {isLiveCardData(card) && <LiveCardDetails data={card} />}
              </div>

              {/* 卡牌效果描述 */}
              {card.cardText && (
                <div className="surface-panel mt-5 rounded-2xl p-3">
                  <div className="mb-2 text-xs text-[var(--text-muted)]">效果描述</div>
                  <p className="text-sm leading-relaxed text-[var(--text-secondary)]">
                    {card.cardText}
                  </p>
                </div>
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
