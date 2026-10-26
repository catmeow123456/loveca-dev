import { getPresentationPortalRoot, useTextPresentation } from '@/lib/appPresentation';
import { useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useDialogAccessibility } from '@/hooks/useDialogAccessibility';
import type { MemberOverwritePaymentChoice } from '@/lib/memberOverwriteChoice';
import { CardEffectText } from '@/components/card/CardEffectText';
import { ChevronRight } from 'lucide-react';

export function MemberOverwriteDialog({
  cardLabel,
  choices,
  onChoose,
  onCancel,
}: {
  cardLabel: string;
  choices: readonly MemberOverwritePaymentChoice[];
  onChoose: (mode: MemberOverwritePaymentChoice['relayMode']) => void;
  onCancel: () => void;
}) {
  const textOnly = useTextPresentation();
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  useDialogAccessibility({
    isOpen: !textOnly,
    dialogRef,
    initialFocusRef: cancelRef,
    onEscape: onCancel,
  });
  const dialog = (
    <div className="battle-table fixed inset-0 z-[200] flex items-center justify-center px-3 py-[max(0.75rem,env(safe-area-inset-top),env(safe-area-inset-bottom))]">
      <button
        type="button"
        tabIndex={-1}
        aria-label="取消覆盖登场"
        className="modal-backdrop absolute inset-0"
        onClick={onCancel}
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="modal-surface relative flex max-h-[calc(var(--battle-viewport-height,100dvh)_-_max(0.75rem,env(safe-area-inset-top),env(safe-area-inset-bottom))*2)] w-full max-w-[420px] flex-col overflow-hidden text-[var(--text-primary)]"
      >
        <div className="shrink-0 border-b border-[var(--border-subtle)] p-4">
          <h2 id={titleId} className="text-sm font-semibold">
            选择登场方式
          </h2>
          <p className="mt-1 text-xs text-[var(--text-secondary)]">{cardLabel}</p>
        </div>
        <div className="touch-scroll cute-scrollbar min-h-0 overflow-y-auto p-4">
          <p className="mb-3 text-xs text-[var(--text-secondary)]">选择后支付费用并登场</p>
          <div className="flex flex-col gap-2">
            {choices.map(({ relayMode, energyCost }) => (
              <button
                key={relayMode}
                type="button"
                className="group flex min-h-16 items-center justify-between gap-3 rounded-md border border-[var(--border-default)] bg-[var(--bg-surface)] px-3 py-3 text-left hover:border-[var(--border-active)] hover:bg-[var(--bg-overlay)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]"
                onClick={() => onChoose(relayMode)}
              >
                <div className="min-w-0">
                  <div className="text-sm font-semibold">
                    {relayMode === 'SINGLE' ? '换手登场' : '全款登场（不换手）'}
                  </div>
                  <CardEffectText
                    text={energyCost === 0 ? '支付0个[E]' : `支付${'[E]'.repeat(energyCost)}`}
                    className="mt-1 text-xs text-[var(--text-secondary)]"
                  />
                </div>
                <ChevronRight
                  className="h-4 w-4 shrink-0 text-[var(--text-muted)] group-hover:text-[var(--accent-primary)]"
                  aria-hidden="true"
                />
              </button>
            ))}
          </div>
        </div>
        <div className="flex shrink-0 justify-end border-t border-[var(--border-subtle)] p-3">
          <button
            ref={cancelRef}
            type="button"
            className="button-secondary min-h-10 px-4 text-sm font-semibold"
            onClick={onCancel}
          >
            取消
          </button>
        </div>
      </div>
    </div>
  );
  return textOnly ? dialog : createPortal(dialog, getPresentationPortalRoot());
}
