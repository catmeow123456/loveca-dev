import type { ReactNode } from 'react';

interface PageHeaderProps {
  title: ReactNode;
  icon?: ReactNode;
  left?: ReactNode;
  right?: ReactNode;
  className?: string;
}

export function PageHeader({ title, icon, left, right, className = '' }: PageHeaderProps) {
  return (
    <header
      className={`page-header relative z-10 border-b border-[var(--border-subtle)] bg-[color:color-mix(in_srgb,var(--bg-frosted)_94%,transparent)] px-4 pb-3 pt-[calc(env(safe-area-inset-top)+0.75rem)] backdrop-blur-xl sm:px-6 sm:pb-3.5 sm:pt-[calc(env(safe-area-inset-top)+0.875rem)] ${className}`.trim()}
    >
      <div className="mx-auto grid min-h-10 w-full max-w-[1440px] grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 sm:gap-3">
        <div className="flex min-w-0 items-center justify-start gap-2">{left}</div>

        <div className="flex min-w-0 items-center justify-center gap-2.5 px-1 text-center">
          {icon ? <span className="shrink-0 text-[var(--accent-primary)]">{icon}</span> : null}
          <div className="min-w-0 truncate text-[15px] font-bold tracking-[-0.01em] text-[var(--text-primary)] sm:text-base">
            {title}
          </div>
        </div>

        <div className="flex min-w-0 items-center justify-end gap-2">{right}</div>
      </div>
    </header>
  );
}
