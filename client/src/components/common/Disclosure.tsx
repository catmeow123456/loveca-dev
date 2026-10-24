import {
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type DetailsHTMLAttributes,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { getPresentationPortalRoot } from '@/lib/appPresentation';
import { cn } from '@/lib/utils';
import './disclosure.css';

export interface DisclosureProps extends DetailsHTMLAttributes<HTMLDetailsElement> {
  summary: ReactNode;
  variant?: 'inline' | 'popover';
}

export function Disclosure({
  summary,
  children,
  className,
  variant = 'inline',
  onToggle,
  ...props
}: DisclosureProps) {
  const id = useId();
  const rootRef = useRef<HTMLDetailsElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  useLayoutEffect(() => {
    if (variant !== 'popover' || !open) return;
    const position = () => {
      const trigger = rootRef.current?.querySelector('summary');
      const panel = panelRef.current;
      if (!trigger || !panel) return;
      const rect = trigger.getBoundingClientRect();
      const bounds = panel.getBoundingClientRect();
      panel.style.left = `${Math.min(Math.max(12, rect.left), window.innerWidth - bounds.width - 12)}px`;
      const below = rect.bottom + 8;
      panel.style.top = `${below + bounds.height <= window.innerHeight - 12 ? below : Math.max(12, rect.top - bounds.height - 8)}px`;
      panel.style.visibility = 'visible';
    };
    const close = (restoreFocus: boolean) => {
      if (rootRef.current) rootRef.current.open = false;
      setOpen(false);
      if (restoreFocus) rootRef.current?.querySelector('summary')?.focus({ preventScroll: true });
    };
    const outside = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !rootRef.current?.contains(event.target) &&
        !panelRef.current?.contains(event.target)
      )
        close(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented) {
        event.preventDefault();
        close(true);
      }
    };
    position();
    window.addEventListener('resize', position);
    window.addEventListener('scroll', position, true);
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => {
      window.removeEventListener('resize', position);
      window.removeEventListener('scroll', position, true);
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
    };
  }, [open, variant]);
  return (
    <details
      {...props}
      ref={rootRef}
      className={cn('ui-disclosure', className)}
      onToggle={(event) => {
        setOpen(event.currentTarget.open);
        onToggle?.(event);
      }}
    >
      <summary id={`${id}-trigger`} aria-controls={variant === 'popover' && open ? id : undefined}>
        {summary}
      </summary>
      {variant === 'inline' ? (
        <div className="ui-disclosure-content">{children}</div>
      ) : (
        open &&
        createPortal(
          <div
            ref={panelRef}
            id={id}
            role="note"
            aria-labelledby={`${id}-trigger`}
            className="ui-disclosure-popover"
          >
            {children}
          </div>,
          getPresentationPortalRoot()
        )
      )}
    </details>
  );
}
