import type { ReactNode } from 'react';
import { ArrowLeft } from 'lucide-react';

interface PageHeaderProps {
  title: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  left?: ReactNode;
  right?: ReactNode;
  backLabel?: string;
  onBack?: () => void;
  className?: string;
}

export function PageHeader({
  title,
  description,
  icon,
  left,
  right,
  backLabel = '返回',
  onBack,
  className = '',
}: PageHeaderProps) {
  const leading =
    left ??
    (onBack ? (
      <button
        type="button"
        onClick={onBack}
        className="button-ghost inline-flex h-10 items-center justify-center gap-1.5 px-2.5 py-2 text-sm sm:px-3"
        aria-label={backLabel}
      >
        <ArrowLeft size={16} />
        <span className="hidden sm:inline">{backLabel}</span>
      </button>
    ) : null);

  return (
    <header className={`page-header product-titlebar relative z-20 ${className}`.trim()}>
      <div className="page-header-inner">
        {leading ? <div className="page-header-leading">{leading}</div> : null}

        <div className="page-header-heading">
          <div className="flex min-w-0 items-center gap-2.5">
            {icon ? <span className="shrink-0 text-[var(--accent-primary)]">{icon}</span> : null}
            <h1 className="page-header-title min-w-0 truncate">{title}</h1>
          </div>
          {description ? (
            <p className="page-header-description mt-0.5 truncate">{description}</p>
          ) : null}
        </div>

        {right ? <div className="page-header-actions">{right}</div> : null}
      </div>
    </header>
  );
}
