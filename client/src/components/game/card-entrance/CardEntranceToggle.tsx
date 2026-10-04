import { Sparkles } from 'lucide-react';

export function CardEntranceToggle({
  enabled,
  onChange,
  className = '',
}: {
  enabled: boolean;
  onChange: (enabled: boolean) => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-label="登场动画"
      aria-checked={enabled}
      title={`登场动画：${enabled ? '已开启，点击关闭' : '已关闭，点击开启'}`}
      className={`button-icon relative ${className}`.trim()}
      style={{ color: enabled ? 'var(--accent-primary)' : 'var(--text-muted)' }}
      onClick={(event) => {
        event.stopPropagation();
        onChange(!enabled);
      }}
    >
      <Sparkles size={18} aria-hidden="true" />
      {enabled ? (
        <span
          aria-hidden="true"
          className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-current"
        />
      ) : (
        <svg
          aria-hidden="true"
          className="pointer-events-none absolute h-6 w-6"
          viewBox="0 0 24 24"
        >
          <path d="M4 20L20 4" stroke="var(--bg-frosted)" strokeWidth="4" />
          <path d="M4 20L20 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      )}
    </button>
  );
}
