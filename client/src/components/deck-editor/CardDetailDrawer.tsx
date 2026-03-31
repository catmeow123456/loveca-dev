/**
 * CardDetailDrawer - 卡牌详情侧边抽屉
 * 纯查看，不含增删操作
 */

import { useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Layers3, Package, Sparkles, Tag, X } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { cn } from '@/lib/utils';
import { useGameStore } from '@/store/gameStore';
import { Card } from '@/components/card/Card';
import { MemberCardDetails, LiveCardDetails } from '@/components/game/CardDetailOverlay';
import type { AnyCardData } from '@game/domain/entities/card';
import { isMemberCardData, isLiveCardData } from '@game/domain/entities/card';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { getCardPoint } from '@game/domain/rules/deck-construction';

interface CardDetailDrawerProps {
  card: AnyCardData | null;
  onClose: () => void;
}

function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-[var(--border-subtle)] py-2 last:border-b-0 last:pb-0">
      <span className="text-xs font-medium text-[var(--text-muted)]">{label}</span>
      <span className="text-right text-sm text-[var(--text-primary)]">{value}</span>
    </div>
  );
}

export function CardDetailDrawer({ card, onClose }: CardDetailDrawerProps) {
  const isMobile = useMediaQuery('(max-width: 767px)');
  const { getCardImagePath } = useGameStore(
    useShallow((s) => ({ getCardImagePath: s.getCardImagePath }))
  );
  const point = card ? getCardPoint(card.cardCode) : 0;
  const isLivePreview = !!card && isLiveCardData(card);

  useEffect(() => {
    if (!card) return;

    const { body, documentElement } = document;
    const previousOverflow = body.style.overflow;
    const previousPaddingRight = body.style.paddingRight;
    const scrollbarWidth = window.innerWidth - documentElement.clientWidth;

    body.style.overflow = 'hidden';
    if (scrollbarWidth > 0) {
      body.style.paddingRight = `${scrollbarWidth}px`;
    }

    return () => {
      body.style.overflow = previousOverflow;
      body.style.paddingRight = previousPaddingRight;
    };
  }, [card]);

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
            initial={isMobile ? { y: '100%' } : { x: '100%' }}
            animate={isMobile ? { y: 0 } : { x: 0 }}
            exit={isMobile ? { y: '100%' } : { x: '100%' }}
            transition={isMobile
              ? { type: 'tween', duration: 0.22, ease: [0.2, 0.8, 0.2, 1] }
              : { type: 'tween', duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
            className="workspace-sidebar safe-bottom fixed inset-x-0 bottom-0 top-auto z-50 flex max-h-[88dvh] transform-gpu flex-col rounded-t-[28px] border-t border-[var(--border-default)] shadow-[var(--shadow-lg)] will-change-transform md:inset-y-0 md:left-auto md:right-0 md:top-0 md:max-h-none md:w-[min(92vw,760px)] md:rounded-none md:border-l md:border-t-0"
            onClick={(e) => e.stopPropagation()}
          >
            {/* 头部 */}
            <div className="workspace-toolbar flex items-center justify-between px-4 py-3 sm:px-5">
              <h3 className="text-sm font-semibold text-[var(--text-primary)]">卡牌详情</h3>
              <button
                onClick={onClose}
                className="button-icon h-7 w-7"
              >
                <X size={16} />
              </button>
            </div>

            {/* 内容区域 */}
            <div className="flex-1 overflow-y-auto p-4 cute-scrollbar sm:p-5">
              <div className="grid gap-4 lg:gap-5 xl:grid-cols-[280px_minmax(0,1fr)]">
                <div className="space-y-4">
                  <div className="surface-panel-gradient rounded-[28px] p-4">
                    <div className="flex justify-center overflow-visible">
                      <div
                        className={cn(
                          'flex items-center justify-center overflow-visible',
                          isLivePreview ? 'h-[180px] w-[252px]' : 'h-[252px] w-[180px]',
                          isMobile && isLivePreview && 'max-w-full scale-[0.92]'
                        )}
                      >
                        <Card
                          cardData={card}
                          imagePath={getCardImagePath(card.cardCode)}
                          size="lg"
                          faceUp={true}
                          interactive={false}
                          showHover={false}
                          showInfoOverlay={false}
                          className={cn(
                            'rounded-lg ring-1 ring-[var(--border-default)]',
                            isLivePreview && '-rotate-90 origin-center'
                          )}
                        />
                      </div>
                    </div>

                    <div className="mt-4 border-t border-[var(--border-subtle)] pt-4">
                      <div className="mb-1 text-lg font-bold text-[var(--text-primary)]">
                        {card.name}
                      </div>
                      <div className="mb-3 text-xs text-[var(--text-muted)]">
                        {card.cardCode}
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <span className="chip-badge px-2.5 py-1 text-xs">
                          <Tag size={12} />
                          {card.cardType}
                        </span>
                        <span className="chip-badge px-2.5 py-1 text-xs">
                          <Sparkles size={12} />
                          {point}pt
                        </span>
                        {card.rare && (
                          <span className="chip-badge px-2.5 py-1 text-xs">
                            <Sparkles size={12} />
                            {card.rare}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="surface-panel rounded-2xl p-4">
                    <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)]">
                      <Layers3 size={15} className="text-[var(--accent-secondary)]" />
                      基本信息
                    </div>
                    <div>
                      {card.groupName && <MetaRow label="作品" value={card.groupName} />}
                      {card.unitName && <MetaRow label="小组" value={card.unitName} />}
                      {card.product && <MetaRow label="商品" value={card.product} />}
                      {!card.groupName && !card.unitName && !card.product && (
                        <div className="text-sm text-[var(--text-muted)]">暂无额外信息</div>
                      )}
                    </div>
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="surface-panel rounded-2xl p-4">
                    <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)]">
                      <Sparkles size={15} className="text-[var(--accent-primary)]" />
                      效果描述
                    </div>
                    {card.cardText ? (
                      <p className="text-sm leading-relaxed text-[var(--text-secondary)]">
                        {card.cardText}
                      </p>
                    ) : (
                      <p className="text-sm leading-relaxed text-[var(--text-muted)]">
                        该卡牌没有效果描述。
                      </p>
                    )}
                  </div>

                  <div className="surface-panel h-full rounded-2xl p-4">
                    <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)]">
                      <Package size={15} className="text-[var(--semantic-info)]" />
                      判定与属性
                    </div>
                    <div className="space-y-4">
                      {isMemberCardData(card) && <MemberCardDetails data={card} />}
                      {isLiveCardData(card) && <LiveCardDetails data={card} />}
                      {!isMemberCardData(card) && !isLiveCardData(card) && (
                        <div className="text-sm text-[var(--text-muted)]">该卡牌没有额外判定属性</div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
