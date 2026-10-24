import { memo, useRef } from 'react';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { DialogShell } from './DialogShell';
import { ActionButton } from './VisualPrimitives';

interface ConfirmDialogProps {
  readonly isOpen: boolean;
  readonly title: string;
  readonly message: string;
  readonly confirmLabel: string;
  readonly cancelLabel?: string;
  readonly isConfirming?: boolean;
  readonly tone?: 'primary' | 'danger';
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
  tone = 'danger',
  onCancel,
  onConfirm,
}: ConfirmDialogProps) {
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  return (
    <DialogShell
      isOpen={isOpen}
      title={title}
      description={message}
      size="compact"
      icon={<AlertTriangle size={18} />}
      onClose={onCancel}
      dismissDisabled={isConfirming}
      initialFocusRef={cancelButtonRef}
      footer={
        <>
          <ActionButton
            ref={cancelButtonRef}
            variant="ghost"
            onClick={onCancel}
            disabled={isConfirming}
          >
            {cancelLabel}
          </ActionButton>
          <ActionButton
            onClick={onConfirm}
            disabled={isConfirming}
            variant={tone === 'primary' ? 'primary' : 'danger'}
          >
            {isConfirming && <Loader2 size={15} className="animate-spin" aria-hidden="true" />}
            {confirmLabel}
          </ActionButton>
        </>
      }
    />
  );
});

export default ConfirmDialog;
