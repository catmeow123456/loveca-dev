import { useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { useDialogAccessibility } from '@/hooks/useDialogAccessibility';

export function HomeDialog({
  title,
  children,
  onClose,
  action,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  action?: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const id = useId();
  useDialogAccessibility({
    isOpen: true,
    dialogRef: ref,
    initialFocusRef: closeButton,
    onEscape: onClose,
  });

  return createPortal(
    <div
      className="home-dialog-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby={id} className="home-dialog">
        <header className="home-dialog-heading">
          <h2 id={id}>{title}</h2>
          <div className="home-dialog-heading-actions">
            {action}
            <button
              ref={closeButton}
              type="button"
              className="home-icon-button"
              aria-label="关闭弹层"
              onClick={onClose}
            >
              <X size={20} aria-hidden="true" />
            </button>
          </div>
        </header>
        <div className="home-dialog-body">{children}</div>
      </div>
    </div>,
    document.body
  );
}
