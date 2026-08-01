import type { ReactNode } from 'react';
import { ArrowLeft, Layers3, Radio } from 'lucide-react';
import { motion } from 'framer-motion';
import { ActionButton, AppCredits, Panel, ProductHeader, ThemeToggle } from '@/components/common';

interface AuthLayoutProps {
  children: ReactNode;
  title: string;
  subtitle?: string;
  eyebrow?: string;
  onBackHome?: () => void;
}

export function AuthLayout({
  children,
  title,
  subtitle,
  eyebrow = 'Loveca 账户',
  onBackHome,
}: AuthLayoutProps) {
  return (
    <div className="app-shell fixed inset-0 overflow-y-auto">
      <ProductHeader
        brandAriaLabel={onBackHome ? '返回首页' : 'Loveca'}
        onBrandClick={onBackHome}
        actions={
          <>
            {onBackHome ? (
              <ActionButton
                variant="ghost"
                size="compact"
                onClick={onBackHome}
                className="hidden sm:inline-flex"
              >
                <ArrowLeft size={16} />
                返回首页
              </ActionButton>
            ) : null}
            <ThemeToggle />
          </>
        }
      />

      <div className="safe-bottom relative mx-auto grid min-h-[calc(100dvh-4rem)] w-full max-w-6xl items-stretch lg:grid-cols-[minmax(0,0.92fr)_minmax(420px,0.78fr)]">
        <motion.section
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.35 }}
          className="relative flex min-h-[220px] flex-col justify-center overflow-hidden border-b border-[var(--border-subtle)] px-5 py-7 sm:px-8 sm:py-9 lg:min-h-0 lg:border-b-0 lg:border-r lg:px-10 lg:py-10"
        >
          <div className="relative z-10 max-w-lg">
            <div className="text-[11px] font-semibold text-[var(--accent-secondary)]">
              {eyebrow}
            </div>
            <h1 className="mt-3 text-3xl font-semibold leading-[1.08] tracking-normal text-[var(--text-primary)] sm:text-4xl lg:text-5xl">
              {title}
            </h1>
            {subtitle ? (
              <p className="mt-4 max-w-md text-sm leading-7 text-[var(--text-secondary)] sm:text-base">
                {subtitle}
              </p>
            ) : null}
          </div>

          <div className="relative z-10 mt-6 hidden items-center gap-5 text-xs text-[var(--text-muted)] lg:flex">
            <span className="inline-flex items-center gap-1.5">
              <Layers3 size={13} />
              云端卡组
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Radio size={13} />
              联机对局
            </span>
          </div>
        </motion.section>

        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.08 }}
          className="flex min-w-0 flex-col justify-center px-4 py-7 sm:px-8 sm:py-10 lg:px-12"
        >
          <div className="mb-5 lg:hidden">
            {onBackHome ? (
              <button type="button" onClick={onBackHome} className="product-back-link min-h-9">
                <ArrowLeft size={14} />
                返回首页
              </button>
            ) : null}
          </div>
          <Panel padding="spacious" className="w-full">
            {children}
          </Panel>
          <AppCredits className="mt-5 px-1" />
        </motion.div>
      </div>
    </div>
  );
}
