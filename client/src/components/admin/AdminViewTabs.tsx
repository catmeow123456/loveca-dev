interface AdminViewTab<Value extends string> {
  readonly value: Value;
  readonly label: string;
}

export function AdminViewTabs<Value extends string>({
  label,
  value,
  tabs,
  onChange,
}: {
  label: string;
  value: Value;
  tabs: readonly AdminViewTab<Value>[];
  onChange: (value: Value) => void;
}) {
  return (
    <div
      className="mb-4 flex gap-1 border-b border-[var(--border-subtle)] pb-1"
      role="tablist"
      aria-label={label}
    >
      {tabs.map((tab) => (
        <button
          key={tab.value}
          type="button"
          role="tab"
          aria-selected={value === tab.value}
          className={`flex-1 rounded-lg px-4 py-2 text-sm font-semibold ${
            value === tab.value
              ? 'bg-[var(--bg-overlay)] text-[var(--text-primary)]'
              : 'text-[var(--text-muted)]'
          }`}
          onClick={() => onChange(tab.value)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
