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
      className={`relative z-10 mx-3 mt-[calc(env(safe-area-inset-top)+0.75rem)] rounded-lg border border-[var(--border-default)] bg-[color:color-mix(in_srgb,var(--bg-frosted)_92%,transparent)] px-3 py-2 shadow-[var(--shadow-sm)] backdrop-blur-xl sm:mx-4 sm:mt-[calc(env(safe-area-inset-top)+1rem)] sm:px-5 ${className}`.trim()}
    >
      <div className="grid min-h-10 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 sm:gap-3">
        <div className="flex min-w-0 items-center justify-start gap-2">{left}</div>

        <div className="flex min-w-0 items-center justify-center gap-2.5 px-1 text-center">
          {icon ? <span className="shrink-0 text-[var(--accent-primary)]">{icon}</span> : null}
          <div className="min-w-0 truncate text-base font-bold text-[var(--text-primary)] sm:text-lg">
            {title}
          </div>
        </div>

        <div className="flex min-w-0 items-center justify-end gap-2">{right}</div>
      </div>
    </header>
  );
}
