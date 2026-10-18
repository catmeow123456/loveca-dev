import { ListChecks } from 'lucide-react';

export function MemberOverwriteToggle({
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
      aria-label="覆盖登场时询问"
      aria-checked={enabled}
      title={`覆盖登场时询问：${enabled ? '已开启，点击关闭' : '已关闭，点击开启'}`}
      className={`button-icon relative ${className}`.trim()}
      style={{ color: enabled ? 'var(--accent-primary)' : 'var(--text-muted)' }}
      onClick={(event) => {
        event.stopPropagation();
        onChange(!enabled);
      }}
    >
      <ListChecks size={18} aria-hidden="true" />
      {enabled && (
        <span
          aria-hidden="true"
          className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-current"
        />
      )}
    </button>
  );
}
