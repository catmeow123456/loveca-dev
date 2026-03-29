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
    <div className="app-shell fixed inset-0 overflow-y-auto">
      <div className="absolute right-4 top-4 z-10">
        <ThemeToggle />
      </div>
      <div className="relative flex min-h-screen items-center justify-center p-4 sm:p-8">
        <motion.div
          initial={{ opacity: 0, y: 20, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.5, ease: 'easeOut' }}
          className="relative w-full max-w-md"
        >
          <div className="mb-6 flex items-center justify-center gap-4">
            <img
              src="/icon.jpg"
              alt="Loveca Logo"
              className="h-18 w-18 rounded-[22px] border border-[var(--border-default)] object-cover shadow-[var(--shadow-md)]"
            />
            <div className="text-left">
              <div className="mb-1 inline-flex items-center gap-2 rounded-full border border-[var(--border-subtle)] bg-[color:var(--bg-overlay)] px-3 py-1 text-xs font-semibold tracking-[0.12em] text-[var(--text-secondary)] uppercase">
                <ShieldCheck size={14} />
                Account Portal
              </div>
              <motion.h1
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.2 }}
                className="text-3xl font-bold tracking-[-0.02em] text-[var(--text-primary)]"
              >
                {title}
              </motion.h1>
              {subtitle && (
                <motion.p
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.3 }}
                  className="mt-2 text-sm text-[var(--text-secondary)]"
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
            className="surface-panel p-8"
          >
            {children}
          </motion.div>

          <div className="mt-5 text-center text-sm text-[var(--text-muted)]">
            Loveca Card Game · ラブライブ！
          </div>
        </motion.div>
      </div>
    </div>
  );
}
