/**
 * 认证页面布局
 * 提供统一的登录/注册页面样式
 * 橙色轻亮色调主题
 */

import { ShieldCheck } from 'lucide-react';
import { motion } from 'framer-motion';
import { ThemeToggle } from '@/components/common';

interface AuthLayoutProps {
  children: React.ReactNode;
  title: string;
  subtitle?: string;
}

export function AuthLayout({ children, title, subtitle }: AuthLayoutProps) {
  return (
    <div className="app-shell safe-top fixed inset-0 overflow-y-auto">
      <div className="absolute right-3 top-3 z-10 sm:right-4 sm:top-4">
        <ThemeToggle />
      </div>
      <div className="safe-bottom relative flex min-h-screen min-h-dvh items-start justify-center px-4 pb-6 pt-20 sm:items-center sm:p-8">
        <motion.div
          initial={{ opacity: 0, y: 20, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.5, ease: 'easeOut' }}
          className="relative w-full max-w-md sm:max-w-lg"
        >
          <div className="mb-5 flex flex-col items-center justify-center gap-3 text-center sm:mb-6 sm:flex-row sm:items-center sm:justify-center sm:gap-4 sm:text-left">
            <img
              src="/icon.jpg"
              alt="Loveca Logo"
              className="h-16 w-16 rounded-[20px] border border-[var(--border-default)] object-cover shadow-[var(--shadow-md)] sm:h-18 sm:w-18 sm:rounded-[22px]"
            />
            <div className="text-center sm:text-left">
              <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-[var(--border-subtle)] bg-[color:var(--bg-overlay)] px-3 py-1 text-[11px] font-semibold tracking-[0.12em] text-[var(--text-secondary)] uppercase sm:mb-1 sm:text-xs">
                <ShieldCheck size={14} />
                Account Portal
              </div>
              <motion.h1
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.2 }}
                className="text-2xl font-bold tracking-[-0.02em] text-[var(--text-primary)] sm:text-3xl"
              >
                {title}
              </motion.h1>
              {subtitle && (
                <motion.p
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.3 }}
                  className="mt-2 text-sm leading-relaxed text-[var(--text-secondary)]"
                >
                  {subtitle}
                </motion.p>
              )}
            </div>
          </div>

          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.25 }}
            className="surface-panel p-5 sm:p-8"
          >
            {children}
          </motion.div>

          <div className="mt-4 px-2 text-center text-xs text-[var(--text-muted)] sm:mt-5 sm:text-sm">
            Loveca Card Game · ラブライブ！
          </div>
        </motion.div>
      </div>
    </div>
  );
}
