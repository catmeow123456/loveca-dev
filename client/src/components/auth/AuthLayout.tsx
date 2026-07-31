import type { ReactNode } from 'react';
import { ArrowLeft, CircleDot, Layers3, Radio } from 'lucide-react';
import { motion } from 'framer-motion';
import { AppCredits, ProductHeader, ThemeToggle } from '@/components/common';

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
              <button
                type="button"
                onClick={onBackHome}
                className="button-ghost hidden min-h-10 items-center gap-2 px-3 text-sm sm:inline-flex"
              >
                <ArrowLeft size={16} />
                返回首页
              </button>
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
          className="relative flex min-h-[250px] flex-col justify-between overflow-hidden border-b border-[var(--border-subtle)] px-5 py-8 sm:px-8 sm:py-10 lg:min-h-0 lg:border-b-0 lg:border-r lg:px-12 lg:py-16"
        >
          <div className="relative z-10 max-w-lg">
            <div className="font-mono text-[11px] font-bold tracking-[0.14em] text-[var(--accent-secondary)] uppercase">
              {eyebrow}
            </div>
            <h1 className="mt-4 text-3xl font-black leading-[1.08] tracking-[-0.04em] text-[var(--text-primary)] sm:text-4xl lg:text-5xl">
              {title}
            </h1>
            {subtitle ? (
              <p className="mt-4 max-w-md text-sm leading-7 text-[var(--text-secondary)] sm:text-base">
                {subtitle}
              </p>
            ) : null}
          </div>

          <div
            className="relative z-10 mt-8 hidden max-w-lg border-y border-[var(--border-subtle)] py-5 sm:block"
            aria-hidden="true"
          >
            <div className="mb-3 flex items-center justify-between font-mono text-[10px] tracking-[0.12em] text-[var(--text-muted)] uppercase">
              <span>Deck ready</span>
              <span>Table route</span>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {['左侧', '中央', '右侧'].map((label, index) => (
                <div key={label}>
                  <div className="mb-2 aspect-[1.45] border border-[var(--border-default)] bg-[color:color-mix(in_srgb,var(--accent-primary)_7%,var(--bg-surface))]">
                    <div
                      className="h-1 bg-[var(--accent-primary)]"
                      style={{ opacity: 0.35 + index * 0.2 }}
                    />
                  </div>
                  <div className="flex items-center gap-1.5 text-[10px] font-semibold text-[var(--text-muted)]">
                    <CircleDot size={10} />
                    {label}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="relative z-10 mt-8 hidden items-center gap-5 text-xs text-[var(--text-muted)] lg:flex">
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
          <div className="w-full border border-[var(--border-default)] border-t-2 border-t-[var(--accent-primary)] bg-[var(--bg-surface)] px-5 py-6 sm:px-7 sm:py-8">
            {children}
          </div>
          <AppCredits className="mt-5 px-1" />
        </motion.div>
      </div>
    </div>
  );
}
