import { useId, useRef, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { getPresentationPortalRoot } from '@/lib/appPresentation';
import { useDialogAccessibility } from '@/hooks/useDialogAccessibility';
import { cn } from '@/lib/utils';
import { ActionButton } from './VisualPrimitives';
import './dialog-shell.css';

export interface DialogShellProps {
  isOpen: boolean;
  title: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  navigation?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  onClose: () => void;
  closeLabel?: string;
  dismissDisabled?: boolean;
  closeOnBackdrop?: boolean;
  size?: 'compact' | 'default' | 'wide';
  initialFocusRef?: RefObject<HTMLElement | null>;
  returnFocusRef?: RefObject<HTMLElement | null>;
  contentKey?: string | number;
}

export function DialogShell({
  isOpen,
  title,
  description,
  icon,
  navigation,
  children,
  footer,
  onClose,
  closeLabel = '关闭',
  dismissDisabled = false,
  closeOnBackdrop = true,
  size = 'default',
  initialFocusRef,
  returnFocusRef,
  contentKey,
}: DialogShellProps) {
  const id = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  useDialogAccessibility({
    isOpen,
    dialogRef,
    initialFocusRef: initialFocusRef ?? closeRef,
    returnFocusRef,
    onEscape: onClose,
    closeOnEscape: !dismissDisabled,
  });
  if (!isOpen) return null;
  return createPortal(
    <div className="ui-dialog-layer">
      <div
        className="modal-backdrop ui-dialog-backdrop"
        onClick={() => {
          if (closeOnBackdrop && !dismissDisabled) onClose();
        }}
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        tabIndex={-1}
        className={cn('modal-surface ui-dialog', `ui-dialog--${size}`)}
      >
        <header className="modal-header ui-dialog-header">
          {icon && (
            <span className="ui-dialog-icon" aria-hidden="true">
              {icon}
            </span>
          )}
          <div className="min-w-0 flex-1">
            <h2 id={`${id}-title`} className="ui-dialog-title">
              {title}
            </h2>
            {description && <div className="ui-dialog-description">{description}</div>}
          </div>
          <ActionButton
            ref={closeRef}
            variant="icon"
            onClick={onClose}
            disabled={dismissDisabled}
            aria-label={closeLabel}
            className="shrink-0"
          >
            <X size={16} aria-hidden="true" />
          </ActionButton>
        </header>
        {navigation && <div className="ui-dialog-navigation">{navigation}</div>}
        {children && (
          <div key={contentKey} className="ui-dialog-body cute-scrollbar">
            {children}
          </div>
        )}
        {footer && <footer className="modal-footer ui-dialog-footer">{footer}</footer>}
      </div>
    </div>,
    getPresentationPortalRoot()
  );
}
