import { useTextPresentation } from '@/lib/appPresentation';
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
  const textOnly = useTextPresentation();
  if (textOnly)
    return (
      <main className="excel-auth">
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
        {onBackHome && <button onClick={onBackHome}>返回首页</button>}
        {children}
      </main>
    );

  return (
    <div className="app-shell fixed inset-0 overflow-y-auto">
      <ProductHeader
        brandAriaLabel={onBackHome ? '返回首页' : 'Loveca'}
        onBrandClick={onBackHome}
        actions={
          <>
            {onBackHome ? (
              <ActionButton variant="ghost" size="compact" onClick={onBackHome}>
                <ArrowLeft size={16} />
                返回首页
              </ActionButton>
            ) : null}
            <ThemeToggle />
          </>
        }
      />

      <div className="safe-bottom relative mx-auto grid w-full max-w-6xl items-start lg:min-h-[calc(100dvh-4rem)] lg:items-stretch lg:grid-cols-[minmax(0,0.92fr)_minmax(420px,0.78fr)]">
        <motion.section
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.35 }}
          className="relative flex flex-col justify-center overflow-hidden px-5 pb-1 pt-5 sm:px-8 lg:border-r lg:border-[var(--border-subtle)] lg:px-10 lg:py-10"
        >
          <div className="relative z-10 max-w-lg">
            <div className="hidden text-[11px] font-semibold text-[var(--accent-secondary)] lg:block">
              {eyebrow}
            </div>
            <h1 className="text-2xl font-semibold leading-tight tracking-normal text-[var(--text-primary)] sm:text-3xl lg:mt-3 lg:text-5xl">
              {title}
            </h1>
            {subtitle ? (
              <p className="mt-2 max-w-md text-sm leading-6 text-[var(--text-secondary)] lg:mt-4 lg:text-base lg:leading-7">
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
          className="flex min-w-0 flex-col justify-center px-4 pb-5 pt-3 sm:px-8 lg:px-12 lg:py-10"
        >
          <Panel padding="spacious" className="w-full">
            {children}
          </Panel>
          <AppCredits className="mt-5 px-1" />
        </motion.div>
      </div>
    </div>
  );
}
