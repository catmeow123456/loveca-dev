import { useRef, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import './tabs.css';

export interface TabOption<Value extends string> {
  value: Value;
  label: ReactNode;
}
export interface TabsProps<Value extends string> {
  label: string;
  value: Value;
  options: readonly TabOption<Value>[];
  onChange: (value: Value) => void;
  className?: string;
}

export function Tabs<Value extends string>({
  label,
  value,
  options,
  onChange,
  className,
  id,
  panelId,
}: TabsProps<Value> & { id: string; panelId: string }) {
  const rootRef = useRef<HTMLDivElement>(null);
  return (
    <div
      ref={rootRef}
      className={cn('ui-choice-control', className)}
      role="tablist"
      aria-label={label}
    >
      {options.map((option, index) => (
        <button
          key={option.value}
          type="button"
          role="tab"
          id={`${id}-${option.value}`}
          aria-controls={panelId}
          aria-selected={value === option.value}
          tabIndex={value === option.value ? 0 : -1}
          className="ui-choice-label"
          onClick={() => onChange(option.value)}
          onKeyDown={(event) => {
            const next =
              event.key === 'ArrowRight'
                ? (index + 1) % options.length
                : event.key === 'ArrowLeft'
                  ? (index + options.length - 1) % options.length
                  : event.key === 'Home'
                    ? 0
                    : event.key === 'End'
                      ? options.length - 1
                      : null;
            if (next === null) return;
            event.preventDefault();
            onChange(options[next].value);
            rootRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
          }}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
