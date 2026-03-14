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
            className="fixed inset-0 z-40 bg-black/30"
            onClick={onClose}
          />

          <motion.div
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 30, stiffness: 300 }}
            className="fixed right-0 top-0 bottom-0 z-50 w-[400px] bg-gradient-to-b from-[#3d3020] to-[#2d2820] shadow-2xl shadow-black/50 flex flex-col border-l border-orange-300/20"
            onClick={(e) => e.stopPropagation()}
          >
            {/* 头部 */}
            <div className="flex items-center justify-between px-5 py-3 border-b border-orange-300/15">
              <h3 className="text-sm font-semibold text-orange-200">卡牌详情</h3>
              <button
                onClick={onClose}
                className="w-7 h-7 flex items-center justify-center rounded-full text-orange-300/60 hover:text-orange-300 hover:bg-orange-500/15 transition-all"
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
                  className="ring-1 ring-orange-300/30 rounded-lg"
                />
              </div>

              {/* 卡牌名称 & 编号 */}
              <h3 className="text-xl font-bold text-orange-100 text-center mb-1">
                {card.name}
              </h3>
              <div className="text-center text-xs text-orange-300/40 mb-5">
                {card.cardCode}
              </div>

              {/* 分隔线 */}
              <div className="h-px bg-gradient-to-r from-transparent via-orange-300/20 to-transparent mb-5" />

              {/* 卡牌详情 */}
              <div className="space-y-4">
                {isMemberCardData(card) && <MemberCardDetails data={card} />}
                {isLiveCardData(card) && <LiveCardDetails data={card} />}
              </div>

              {/* 卡牌效果描述 */}
              {card.cardText && (
                <div className="mt-5 p-3 bg-[#2d2820]/80 rounded-xl border border-orange-300/15">
                  <div className="text-xs text-orange-300/60 mb-2">效果描述</div>
                  <p className="text-orange-100/90 text-sm leading-relaxed">
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
