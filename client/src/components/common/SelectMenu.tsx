import { useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, Loader2 } from 'lucide-react';

export interface SelectMenuOption<Value extends string> {
  readonly value: Value;
  readonly label: string;
  readonly description?: string;
  readonly leading?: ReactNode;
  readonly disabled?: boolean;
}

export interface SelectMenuProps<Value extends string> {
  readonly label: string;
  readonly value: Value;
  readonly options: readonly SelectMenuOption<Value>[];
  readonly onChange: (value: Value) => void;
  readonly disabled?: boolean;
  readonly loading?: boolean;
  readonly className?: string;
  readonly menuMinWidth?: number;
}

export function SelectMenu<Value extends string>({
  label,
  value,
  options,
  onChange,
  disabled = false,
  loading = false,
  className = '',
  menuMinWidth = 208,
}: SelectMenuProps<Value>) {
  const generatedId = useId();
  const menuId = `select-menu-${generatedId.replace(/:/g, '')}`;
  const [isOpen, setIsOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const selectedIndex = options.findIndex((option) => option.value === value);
  const selectedOption = selectedIndex >= 0 ? options[selectedIndex] : options[0];

  useLayoutEffect(() => {
    if (!isOpen) return;

    const positionMenu = () => {
      const trigger = triggerRef.current;
      const menu = menuRef.current;
      if (!trigger || !menu) return;

      const triggerRect = trigger.getBoundingClientRect();
      const menuRect = menu.getBoundingClientRect();
      const viewportGap = 8;
      const menuGap = 6;
      const menuWidth = Math.min(
        Math.max(triggerRect.width, menuMinWidth),
        window.innerWidth - viewportGap * 2
      );
      const spaceBelow = window.innerHeight - triggerRect.bottom;
      const top =
        spaceBelow >= menuRect.height + menuGap + viewportGap
          ? triggerRect.bottom + menuGap
          : Math.max(viewportGap, triggerRect.top - menuRect.height - menuGap);
      const left = Math.min(
        Math.max(viewportGap, triggerRect.left),
        window.innerWidth - menuWidth - viewportGap
      );

      menu.style.top = `${top}px`;
      menu.style.left = `${left}px`;
      menu.style.width = `${menuWidth}px`;
      menu.style.visibility = 'visible';
    };

    const closeForOutsidePointer = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setIsOpen(false);
    };

    positionMenu();
    const selectedRef = optionRefs.current[Math.max(0, selectedIndex)];
    if (selectedRef && !selectedRef.disabled) {
      selectedRef.focus();
    } else {
      optionRefs.current.find((item) => item && !item.disabled)?.focus();
    }
    window.addEventListener('resize', positionMenu);
    window.addEventListener('scroll', positionMenu, true);
    document.addEventListener('pointerdown', closeForOutsidePointer);
    return () => {
      window.removeEventListener('resize', positionMenu);
      window.removeEventListener('scroll', positionMenu, true);
      document.removeEventListener('pointerdown', closeForOutsidePointer);
    };
  }, [isOpen, menuMinWidth, selectedIndex]);

  const focusRelativeOption = (currentIndex: number, direction: 1 | -1) => {
    for (let step = 1; step <= options.length; step += 1) {
      const nextIndex = (currentIndex + direction * step + options.length) % options.length;
      if (!options[nextIndex]?.disabled) {
        optionRefs.current[nextIndex]?.focus();
        return;
      }
    }
  };

  const chooseOption = (option: SelectMenuOption<Value>) => {
    if (option.disabled) return;
    setIsOpen(false);
    triggerRef.current?.focus();
    if (option.value !== value) onChange(option.value);
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-controls={isOpen ? menuId : undefined}
        disabled={disabled || loading || options.length === 0}
        onClick={() => setIsOpen((current) => !current)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            setIsOpen(true);
          }
        }}
        className={`group inline-flex h-10 min-w-0 items-center justify-between gap-3 rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface)] px-3 text-left text-sm font-medium text-[var(--text-primary)] shadow-sm transition-[border-color,box-shadow,background-color] hover:border-[color:color-mix(in_srgb,var(--accent-primary)_45%,var(--border-default))] hover:bg-[var(--bg-elevated)] focus-visible:border-[var(--accent-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:color-mix(in_srgb,var(--accent-primary)_18%,transparent)] disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
      >
        <span className="flex min-w-0 items-center gap-2">
          {selectedOption?.leading ? (
            <span className="shrink-0">{selectedOption.leading}</span>
          ) : null}
          <span className="truncate">{selectedOption?.label ?? '暂无选项'}</span>
        </span>
        {loading ? (
          <Loader2 size={14} className="shrink-0 animate-spin text-[var(--accent-primary)]" />
        ) : (
          <ChevronDown
            size={14}
            className={`shrink-0 text-[var(--text-muted)] transition-transform ${isOpen ? 'rotate-180' : ''}`}
          />
        )}
      </button>

      {isOpen && typeof document !== 'undefined'
        ? createPortal(
            <div
              ref={menuRef}
              id={menuId}
              role="listbox"
              aria-label={label}
              onBlur={(event) => {
                const nextTarget = event.relatedTarget;
                if (
                  nextTarget instanceof Node &&
                  (menuRef.current?.contains(nextTarget) ||
                    triggerRef.current?.contains(nextTarget))
                ) {
                  return;
                }
                setIsOpen(false);
              }}
              className="fixed z-[220] max-h-72 overflow-y-auto rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] p-1.5 shadow-[0_16px_40px_rgba(12,18,32,0.2)]"
              style={{ top: 0, left: 0, visibility: 'hidden' }}
            >
              {options.map((option, index) => {
                const selected = option.value === value;
                return (
                  <button
                    key={option.value}
                    ref={(element) => {
                      optionRefs.current[index] = element;
                    }}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    disabled={option.disabled}
                    onClick={() => chooseOption(option)}
                    onKeyDown={(event) => {
                      if (event.key === 'ArrowDown') {
                        event.preventDefault();
                        focusRelativeOption(index, 1);
                      } else if (event.key === 'ArrowUp') {
                        event.preventDefault();
                        focusRelativeOption(index, -1);
                      } else if (event.key === 'Home') {
                        event.preventDefault();
                        optionRefs.current.find((item) => item && !item.disabled)?.focus();
                      } else if (event.key === 'End') {
                        event.preventDefault();
                        optionRefs.current
                          .slice()
                          .reverse()
                          .find((item) => item && !item.disabled)
                          ?.focus();
                      } else if (event.key === 'Escape') {
                        event.preventDefault();
                        setIsOpen(false);
                        triggerRef.current?.focus();
                      }
                    }}
                    className={`flex min-h-10 w-full items-center justify-between gap-3 rounded-lg px-2.5 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[color:color-mix(in_srgb,var(--accent-primary)_24%,transparent)] disabled:cursor-not-allowed disabled:opacity-45 ${
                      selected
                        ? 'bg-[color:color-mix(in_srgb,var(--accent-primary)_10%,var(--bg-surface))] text-[var(--accent-primary)]'
                        : 'text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]'
                    }`}
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      {option.leading ? <span className="shrink-0">{option.leading}</span> : null}
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium">{option.label}</span>
                        {option.description ? (
                          <span className="mt-0.5 block truncate text-[11px] font-normal text-[var(--text-muted)]">
                            {option.description}
                          </span>
                        ) : null}
                      </span>
                    </span>
                    {selected ? <Check size={14} className="shrink-0" /> : null}
                  </button>
                );
              })}
            </div>,
            document.body
          )
        : null}
    </>
  );
}
