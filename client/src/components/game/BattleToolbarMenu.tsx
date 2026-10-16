import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Settings2 } from 'lucide-react';
import { ThemeToggle } from '@/components/common';
import { CardEntranceToggle } from './card-entrance/CardEntranceToggle';

export function BattleToolbarMenu({
  label,
  icon,
  children,
}: {
  label: string;
  icon: ReactNode;
  children: (close: () => void) => ReactNode;
}) {
  const id = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    panelRef.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
    const dismiss = (event: PointerEvent) => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) {
        setOpen(false);
      }
    };
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, [open]);

  return (
    <div
      ref={rootRef}
      className="relative shrink-0"
      onBlur={(event) => {
        if (
          event.relatedTarget instanceof Node &&
          !event.currentTarget.contains(event.relatedTarget)
        ) {
          setOpen(false);
        }
      }}
      onKeyDown={(event) => {
        if (open && event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          setOpen(false);
          triggerRef.current?.focus();
        }
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        className="button-ghost inline-flex h-11 items-center justify-center gap-2 px-3 text-sm"
        aria-label={label}
        aria-expanded={open}
        aria-controls={id}
        aria-haspopup="dialog"
        onClick={() => setOpen((value) => !value)}
      >
        {icon}
        <span>{label}</span>
      </button>
      {open && (
        <div
          ref={panelRef}
          id={id}
          role="dialog"
          aria-label={label}
          className="battle-toolbar-menu absolute top-full z-[var(--z-battle-action-menu)] mt-2 w-64 rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface)] p-2 text-sm shadow-[var(--shadow-lg)]"
        >
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

export function BattleSettingsMenu({
  showCardEntrance,
  cardEntranceEnabled,
  onCardEntranceChange,
}: {
  showCardEntrance: boolean;
  cardEntranceEnabled: boolean;
  onCardEntranceChange: (enabled: boolean) => void;
}) {
  return (
    <div className="battle-toolbar-settings ml-auto shrink-0">
      <BattleToolbarMenu label="对战设置" icon={<Settings2 size={16} />}>
        {() => (
          <>
            <div className="flex min-h-12 items-center justify-between gap-4 px-2">
              <span>界面主题</span>
              <ThemeToggle />
            </div>
            {showCardEntrance && (
              <div className="flex min-h-12 items-center justify-between gap-4 px-2">
                <span>登场动画</span>
                <CardEntranceToggle enabled={cardEntranceEnabled} onChange={onCardEntranceChange} />
              </div>
            )}
          </>
        )}
      </BattleToolbarMenu>
    </div>
  );
}
