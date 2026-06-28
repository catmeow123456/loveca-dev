interface AppCreditsProps {
  version?: string;
  className?: string;
}

const creditLinkClass =
  'font-medium text-[var(--text-secondary)] underline-offset-4 transition-colors hover:text-[var(--text-primary)] hover:underline';

export function AppCredits({ version, className = '' }: AppCreditsProps) {
  return (
    <div
      className={`space-y-1 text-center text-xs leading-relaxed text-[var(--text-muted)] sm:text-sm ${className}`.trim()}
    >
      <div>Loveca Card Game{version ? ` v${version}` : ''}</div>
      <div>
        开发者:{' '}
        <a
          className={creditLinkClass}
          href="https://github.com/catmeow123456"
          target="_blank"
          rel="noreferrer"
        >
          Eden
        </a>
        {' / '}
        <a
          className={creditLinkClass}
          href="https://github.com/meiyikai001"
          target="_blank"
          rel="noreferrer"
        >
          aya
        </a>
        <span className="mx-2 text-[var(--border-default)]">|</span>
        卡牌数据源:{' '}
        <a
          className={creditLinkClass}
          href="https://github.com/wlt233/llocg_db"
          target="_blank"
          rel="noreferrer"
        >
          wlt233
        </a>
        {' / '}
        <span className="text-[var(--text-secondary)]">鬼箱</span>
        <span> (小能苗)</span>
      </div>
    </div>
  );
}
