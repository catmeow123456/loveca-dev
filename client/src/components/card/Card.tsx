/**
 * 卡牌组件
 * 
 * 显示成员卡、Live 卡、能量卡的通用组件
 */

import { memo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/lib/utils';
import { HeartColor, OrientationState } from '@game/shared/types/enums';
import type { AnyCardData, MemberCardData, LiveCardData } from '@game/domain/entities/card';
import { isMemberCardData, isLiveCardData, isEnergyCardData } from '@game/domain/entities/card';

// ============================================
// 类型定义
// ============================================

export interface CardProps {
  /** 卡牌数据 */
  cardData: AnyCardData;
  /** 卡牌实例 ID */
  instanceId?: string;
  /** 卡牌图片路径 */
  imagePath?: string;
  /** 大小变体 (responsive 会填满父容器) */
  size?: 'sm' | 'md' | 'lg' | 'responsive';
  /** 是否正面朝上 */
  faceUp?: boolean;
  /** 方向状态（活跃/等待） */
  orientation?: OrientationState;
  /** 是否被选中 */
  selected?: boolean;
  /** 是否可交互 */
  interactive?: boolean;
  /** 是否显示悬停效果 */
  showHover?: boolean;
  /** 是否显示卡面覆盖层信息 */
  showInfoOverlay?: boolean;
  /** 数量提示 */
  count?: number;
  /** 点击事件 */
  onClick?: () => void;
  /** 双击事件 */
  onDoubleClick?: () => void;
  /** 鼠标进入回调（用于详情浮窗） */
  onMouseEnter?: () => void;
  /** 鼠标离开回调（用于详情浮窗） */
  onMouseLeave?: () => void;
  /** 自定义 className */
  className?: string;
  /** 是否启用 framer-motion 的 layout 动画（默认关闭以减少大范围重排抖动） */
  enableLayoutAnimation?: boolean;
}

// ============================================
// 辅助组件
// ============================================

/** Heart 图标组件 */
const HeartIcon = memo(function HeartIcon({ 
  color, 
  count = 1,
  size = 'md'
}: { 
  color: HeartColor; 
  count?: number;
  size?: 'sm' | 'md' | 'lg';
}) {
  const colorClasses: Record<HeartColor, string> = {
    [HeartColor.PINK]: 'text-pink-400',
    [HeartColor.RED]: 'text-red-500',
    [HeartColor.YELLOW]: 'text-yellow-400',
    [HeartColor.GREEN]: 'text-green-500',
    [HeartColor.BLUE]: 'text-blue-500',
    [HeartColor.PURPLE]: 'text-purple-500',
    [HeartColor.RAINBOW]: 'text-gray-400',
  };

  const sizeClasses = {
    sm: 'text-xs',
    md: 'text-sm',
    lg: 'text-base',
  };

  return (
    <span className={cn('inline-flex items-center gap-0.5', sizeClasses[size])}>
      <span className={colorClasses[color]}>♥</span>
      {count > 1 && <span className="text-white text-[0.6em]">×{count}</span>}
    </span>
  );
});

/** 成员卡信息覆盖层 */
const MemberCardOverlay = memo(function MemberCardOverlay({ 
  data,
  size = 'md'
}: { 
  data: MemberCardData;
  size?: 'sm' | 'md' | 'lg';
}) {
  const showDetails = size !== 'sm';

  return (
    <>
      {/* Hearts */}
      {showDetails && data.hearts && data.hearts.length > 0 && (
        <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-1.5">
          <div className="flex flex-wrap gap-0.5 justify-center">
            {data.hearts.map((heart, idx) => (
              <HeartIcon 
                key={idx} 
                color={heart.color} 
                count={heart.count}
                size={size === 'lg' ? 'md' : 'sm'}
              />
            ))}
          </div>
        </div>
      )}
    </>
  );
});

/** Live 卡信息覆盖层 */
const LiveCardOverlay = memo(function LiveCardOverlay({ 
  data,
  size = 'md'
}: { 
  data: LiveCardData;
  size?: 'sm' | 'md' | 'lg';
}) {
  const showDetails = size !== 'sm';

  return (
    <>
      {/* 需求 Hearts */}
      {showDetails && (
        <div className="absolute bottom-0 left-0 right-0 bg-linear-to-t from-black/80 to-transparent p-1.5">
          <div className="flex flex-wrap gap-0.5 justify-center">
            {Object.entries(data.requirements.colorRequirements).map(([color, count]) => (
              <HeartIcon 
                key={color} 
                color={color as HeartColor} 
                count={count as number}
                size={size === 'lg' ? 'md' : 'sm'}
              />
            ))}
          </div>
          <div className="text-center text-[10px] text-gray-300 mt-0.5">
            需要 {data.requirements.totalRequired} 心
          </div>
        </div>
      )}
    </>
  );
});

/** 能量卡覆盖层 */
const EnergyCardOverlay = memo(function EnergyCardOverlay({ 
  size = 'md'
}: { 
  size?: 'sm' | 'md' | 'lg';
}) {
  return (
    <>
      {/* 能量标识 */}
      <div className={cn(
        'absolute top-1 right-1 rounded-full bg-emerald-500 text-white font-bold',
        'flex items-center justify-center shadow-md',
        size === 'sm' ? 'w-4 h-4 text-[10px]' : 'w-6 h-6 text-xs'
      )}>
        ⚡
      </div>
    </>
  );
});

/** 卡背图片路径常量 */
const CARD_BACK_IMAGE_PATH = '/back.jpg';

/** 卡背 */
const CardBack = memo(function CardBack({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' }) {
  const [imageError, setImageError] = useState(false);

  // 如果有卡背图片，显示图片
  if (!imageError) {
    return (
      <img
        src={CARD_BACK_IMAGE_PATH}
        alt="Card Back"
        className="w-full h-full object-cover rounded-lg"
        onError={() => setImageError(true)}
        loading="lazy"
      />
    );
  }

  // 降级：显示渐变色占位符
  return (
    <div className={cn(
      'w-full h-full rounded-lg',
      'bg-gradient-to-br from-indigo-600 to-purple-700',
      'flex items-center justify-center',
      'border-2 border-purple-400/50'
    )}>
      <span className={cn(
        'text-white/50',
        size === 'sm' ? 'text-xl' : size === 'lg' ? 'text-4xl' : 'text-2xl'
      )}>
        ♪
      </span>
    </div>
  );
});

// ============================================
// 主组件
// ============================================

export const Card = memo(function Card({
  cardData,
  instanceId,
  imagePath,
  size = 'md',
  faceUp = true,
  orientation = OrientationState.ACTIVE,
  selected = false,
  interactive = true,
  showHover = true,
  showInfoOverlay = true,
  count = undefined,
  onClick,
  onDoubleClick,
  onMouseEnter,
  onMouseLeave,
  className,
  enableLayoutAnimation = false,
}: CardProps) {
  const [isHovered, setIsHovered] = useState(false);
  const [imageError, setImageError] = useState(false);

  // 尺寸映射
  // responsive: 填满父容器，保持卡牌比例
  const sizeClasses: Record<string, string> = {
    sm: 'w-[75px] h-[105px]',
    md: 'w-[110px] h-[154px]',
    lg: 'w-[180px] h-[252px]',
    responsive: 'w-full h-full',
  };

  // 对于子组件，将 responsive 转换为 sm（显示最少的细节）
  const overlaySize: 'sm' | 'md' | 'lg' = size === 'responsive' ? 'sm' : size;

  // 是否显示休息状态
  const isResting = orientation === OrientationState.WAITING;

  return (
    <motion.div
      className={cn(
        'relative rounded-lg overflow-hidden cursor-pointer',
        'shadow-lg transition-shadow duration-200',
        sizeClasses[size],
        selected && 'ring-2 ring-yellow-400 ring-offset-2 ring-offset-slate-900',
        isResting && 'rotate-90',
        !interactive && 'pointer-events-none',
        className
      )}
      onClick={interactive ? onClick : undefined}
      onDoubleClick={interactive ? onDoubleClick : undefined}
      onMouseEnter={() => {
        if (showHover) setIsHovered(true);
        onMouseEnter?.();
      }}
      onMouseLeave={() => {
        setIsHovered(false);
        onMouseLeave?.();
      }}
      whileHover={showHover && interactive ? { 
        y: -8, 
        scale: 1.05,
        zIndex: 100,
      } : undefined}
      whileTap={interactive ? { scale: 0.98 } : undefined}
      layout={enableLayoutAnimation}
      data-card-id={instanceId}
    >
      <AnimatePresence mode="wait">
        {faceUp ? (
          <motion.div
            key="front"
            className="w-full h-full"
            initial={{ rotateY: 90 }}
            animate={{ rotateY: 0 }}
            exit={{ rotateY: -90 }}
            transition={{ duration: 0.2 }}
          >
            {/* 卡牌图片 */}
            {imagePath && !imageError ? (
              <img
                src={imagePath}
                alt={cardData.name}
                className="w-full h-full object-cover"
                onError={() => setImageError(true)}
                loading="lazy"
              />
            ) : (
              <div className={cn(
                'w-full h-full flex items-center justify-center',
                'bg-linear-to-br from-slate-700 to-slate-800',
                'text-slate-400 text-xs text-center p-2'
              )}>
                {cardData.name}
              </div>
            )}

            {/* 覆盖层信息 */}
            {showInfoOverlay && isMemberCardData(cardData) && (
              <MemberCardOverlay data={cardData} size={overlaySize} />
            )}
            {showInfoOverlay && isLiveCardData(cardData) && (
              <LiveCardOverlay data={cardData} size={overlaySize} />
            )}
            {showInfoOverlay && isEnergyCardData(cardData) && (
              <EnergyCardOverlay size={overlaySize} />
            )}
          </motion.div>
        ) : (
          <motion.div
            key="back"
            className="w-full h-full"
            initial={{ rotateY: -90 }}
            animate={{ rotateY: 0 }}
            exit={{ rotateY: 90 }}
            transition={{ duration: 0.2 }}
          >
            <CardBack size={overlaySize} />
          </motion.div>
        )}
      </AnimatePresence>

      {/* 半透明数量提示 */}
      {count && count > 0 && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none bg-blue-500/30">
          <span className="text-blue-800 text-8xl font-bold opacity-50 drop-shadow-md">
            {count}
          </span>
        </div>
      )}

      {/* 选中高亮 */}
      {selected && (
        <motion.div
          className="absolute inset-0 bg-yellow-400/20 pointer-events-none"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        />
      )}

      {/* 悬停提示（仅在大尺寸时显示） */}
      {isHovered && size !== 'sm' && (
        <motion.div
          className="absolute -bottom-1 left-1/2 -translate-x-1/2 translate-y-full z-50"
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
        >
          <div className="bg-slate-900/95 text-white text-xs px-2 py-1 rounded whitespace-nowrap">
            {cardData.name}
          </div>
        </motion.div>
      )}
    </motion.div>
  );
});

export default Card;
