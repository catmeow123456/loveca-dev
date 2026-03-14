/**
 * 认证页面布局
 * 提供统一的登录/注册页面样式
 * 橙色轻亮色调主题
 */

import { useMemo } from 'react';
import { motion } from 'framer-motion';

interface AuthLayoutProps {
  children: React.ReactNode;
  title: string;
  subtitle?: string;
}

// 预生成星星位置数据
const generateStars = () =>
  [...Array(20)].map((_, i) => ({
    id: i,
    left: Math.random() * 100,
    top: Math.random() * 100,
    duration: 2 + Math.random() * 2,
    delay: Math.random() * 2,
  }));

export function AuthLayout({ children, title, subtitle }: AuthLayoutProps) {
  // 使用 useMemo 确保星星位置在组件生命周期内保持稳定
  const stars = useMemo(() => generateStars(), []);

  return (
    <div className="fixed inset-0 overflow-y-auto bg-gradient-to-br from-amber-50 via-orange-50 to-yellow-50 flex items-center justify-center p-4">
      {/* 背景装饰 */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        {/* 渐变光效 */}
        <div className="absolute top-1/4 -left-20 w-96 h-96 bg-orange-300/30 rounded-full blur-3xl" />
        <div className="absolute bottom-1/4 -right-20 w-96 h-96 bg-amber-300/30 rounded-full blur-3xl" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-yellow-300/20 rounded-full blur-3xl" />
        
        {/* 装饰星星 */}
        {stars.map((star) => (
          <motion.div
            key={star.id}
            className="absolute w-1 h-1 bg-orange-400/50 rounded-full"
            style={{
              left: `${star.left}%`,
              top: `${star.top}%`,
            }}
            animate={{
              opacity: [0.3, 0.8, 0.3],
              scale: [1, 1.2, 1],
            }}
            transition={{
              duration: star.duration,
              repeat: Infinity,
              delay: star.delay,
            }}
          />
        ))}
      </div>

      {/* 主内容卡片 */}
      <motion.div
        initial={{ opacity: 0, y: 20, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.5, ease: 'easeOut' }}
        className="relative w-full max-w-md"
      >
        {/* Logo 和标题 */}
        <div className="text-center mb-8">
          <img 
            src="/icon.jpg" 
            alt="Loveca Logo" 
            className="w-24 h-24 mx-auto mb-4 rounded-2xl shadow-lg shadow-orange-400/30"
          />
          
          <motion.h1
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.3 }}
            className="text-3xl font-bold bg-gradient-to-r from-orange-500 via-amber-500 to-yellow-600 bg-clip-text text-transparent"
          >
            {title}
          </motion.h1>
          
          {subtitle && (
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.4 }}
              className="text-orange-600/70 mt-2"
            >
              {subtitle}
            </motion.p>
          )}
        </div>

        {/* 表单容器 */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.3 }}
          className="bg-white/70 backdrop-blur-xl border border-orange-300/40 rounded-2xl p-8 shadow-2xl shadow-orange-200/30"
        >
          {children}
        </motion.div>

        {/* 底部装饰 */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.5 }}
          className="text-center mt-6 text-orange-500/60 text-sm"
        >
          <span>Loveca Card Game</span>
          <span className="mx-2">✨</span>
          <span>ラブライブ！</span>
        </motion.div>
      </motion.div>
    </div>
  );
}
