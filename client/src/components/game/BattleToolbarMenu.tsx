import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { BookOpen, Settings2 } from 'lucide-react';
import { ThemeToggle } from '@/components/common';
import { PresentationModeButton } from '@/components/common/PresentationModeButton';
import { BattleEffectsToggle } from './BattleEffectsToggle';
import { MemberOverwriteToggle } from './MemberOverwriteToggle';

export function BattleToolbarMenu({
  label,
  icon,
  compact = false,
  children,
}: {
  label: string;
  icon: ReactNode;
  compact?: boolean;
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
        className={
          compact
            ? 'button-icon h-10 w-10'
            : 'battle-toolbar-control button-ghost inline-flex h-11 items-center justify-center gap-2 px-3 text-sm'
        }
        title={compact ? label : undefined}
        aria-label={label}
        aria-expanded={open}
        aria-controls={id}
        aria-haspopup="dialog"
        onClick={() => setOpen((value) => !value)}
      >
        {icon}
        {!compact && <span>{label}</span>}
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
  compact = false,
  showMemberOverwrite,
  askMemberOverwrite,
  onAskMemberOverwriteChange,
  showBattleEffects,
  battleEffectsEnabled,
  onBattleEffectsChange,
  onShowHelp,
}: {
  compact?: boolean;
  showMemberOverwrite: boolean;
  askMemberOverwrite: boolean;
  onAskMemberOverwriteChange: (enabled: boolean) => void;
  showBattleEffects: boolean;
  battleEffectsEnabled: boolean;
  onBattleEffectsChange: (enabled: boolean) => void;
  onShowHelp?: () => void;
}) {
  return (
    <div className="battle-toolbar-settings ml-auto shrink-0">
      <BattleToolbarMenu label="对战设置" icon={<Settings2 size={16} />} compact={compact}>
        {(close) => (
          <>
            {onShowHelp && (
              <button
                type="button"
                className="button-ghost flex min-h-11 w-full items-center gap-2 px-2"
                onClick={() => {
                  close();
                  onShowHelp();
                }}
              >
                <BookOpen size={16} aria-hidden="true" />
                操作提示
              </button>
            )}
            <div className="flex min-h-12 items-center justify-between gap-4 px-2">
              <span>Excel 模式</span>
              <PresentationModeButton compact />
            </div>
            {showMemberOverwrite && (
              <div className="flex min-h-12 items-center justify-between gap-4 px-2">
                <span>覆盖登场时询问</span>
                <MemberOverwriteToggle
                  enabled={askMemberOverwrite}
                  onChange={onAskMemberOverwriteChange}
                />
              </div>
            )}
            <div className="flex min-h-12 items-center justify-between gap-4 px-2">
              <span>界面主题</span>
              <ThemeToggle />
            </div>
            {showBattleEffects && (
              <div className="flex min-h-12 items-center justify-between gap-4 px-2">
                <span>对战特效</span>
                <BattleEffectsToggle
                  enabled={battleEffectsEnabled}
                  onChange={onBattleEffectsChange}
                />
              </div>
            )}
          </>
        )}
      </BattleToolbarMenu>
    </div>
  );
}
