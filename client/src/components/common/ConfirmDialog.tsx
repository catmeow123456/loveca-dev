import { memo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';
import { AlertTriangle, Loader2, X } from 'lucide-react';
import { useDialogAccessibility } from '@/hooks/useDialogAccessibility';

interface ConfirmDialogProps {
  readonly isOpen: boolean;
  readonly title: string;
  readonly message: string;
  readonly confirmLabel: string;
  readonly cancelLabel?: string;
  readonly isConfirming?: boolean;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
}

export const ConfirmDialog = memo(function ConfirmDialog({
  isOpen,
  title,
  message,
  confirmLabel,
  cancelLabel = '取消',
  isConfirming = false,
  onCancel,
  onConfirm,
}: ConfirmDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  useDialogAccessibility({
    isOpen,
    dialogRef,
    initialFocusRef: cancelButtonRef,
    onEscape: onCancel,
    closeOnEscape: !isConfirming,
  });

  if (!isOpen) {
    return null;
  }

  const dialog = (
    <>
      <button
        type="button"
        tabIndex={-1}
        aria-label="关闭确认框"
        className="modal-backdrop z-[190] cursor-default"
        onClick={() => {
          if (!isConfirming) {
            onCancel();
          }
        }}
      />

      <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
        <motion.div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="confirm-dialog-title"
          tabIndex={-1}
          className="modal-surface flex w-[min(92vw,420px)] flex-col overflow-hidden"
          initial={{ opacity: 0, scale: 0.96, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.96, y: 10 }}
        >
          <div className="modal-header flex items-start justify-between gap-3 px-5 py-4">
            <div className="flex min-w-0 items-start gap-3">
              <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[color:color-mix(in_srgb,var(--semantic-warning)_35%,transparent)] bg-[color:color-mix(in_srgb,var(--semantic-warning)_12%,transparent)] text-[var(--semantic-warning)]">
                <AlertTriangle size={16} />
              </div>
              <div className="min-w-0">
                <div
                  id="confirm-dialog-title"
                  className="text-base font-semibold text-[var(--text-primary)]"
                >
                  {title}
                </div>
                <div className="mt-1 text-sm leading-6 text-[var(--text-secondary)]">{message}</div>
              </div>
            </div>
            <button
              ref={cancelButtonRef}
              type="button"
              onClick={onCancel}
              disabled={isConfirming}
              className="button-icon h-8 w-8 shrink-0"
              title="关闭"
              aria-label="关闭"
            >
              <X size={14} />
            </button>
          </div>

          <div className="flex justify-end gap-2 border-t border-[var(--border-subtle)] bg-[var(--bg-surface)] px-5 py-4">
            <button
              type="button"
              onClick={onCancel}
              disabled={isConfirming}
              className="button-ghost inline-flex min-h-10 items-center justify-center gap-2 border border-[var(--border-default)] px-4 text-sm font-semibold"
            >
              {cancelLabel}
            </button>
            <button
              type="button"
              onClick={onConfirm}
              disabled={isConfirming}
              className="button-ghost inline-flex min-h-10 items-center justify-center gap-2 border border-[color:color-mix(in_srgb,var(--semantic-error)_35%,transparent)] px-4 text-sm font-semibold text-[var(--semantic-error)]"
            >
              {isConfirming ? <Loader2 size={15} className="animate-spin" /> : null}
              {confirmLabel}
            </button>
          </div>
        </motion.div>
      </div>
    </>
  );

  if (typeof document === 'undefined') {
    return dialog;
  }

  return createPortal(dialog, document.body);
});

export default ConfirmDialog;
