import { useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useDialogAccessibility } from '@/hooks/useDialogAccessibility';
import type { MemberOverwritePaymentChoice } from '@/lib/memberOverwriteChoice';
import { CardEffectText } from '@/components/card/CardEffectText';

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
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  useDialogAccessibility({
    isOpen: true,
    dialogRef,
    initialFocusRef: cancelRef,
    onEscape: onCancel,
  });
  return createPortal(
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
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
        className="modal-surface relative flex max-h-[90dvh] w-[min(92vw,420px)] flex-col overflow-y-auto p-5 text-[var(--text-primary)]"
      >
        <h2 id={titleId} className="text-base font-semibold">
          选择登场方式
        </h2>
        <p className="mt-2 text-sm text-[var(--text-secondary)]">{cardLabel}</p>
        <div className="mt-4 flex flex-col gap-2">
          {choices.map(({ relayMode, energyCost }) => (
            <button
              key={relayMode}
              type="button"
              className="button-ghost min-h-12 border border-[var(--border-default)] px-3 py-3 text-left"
              onClick={() => onChoose(relayMode)}
            >
              <div className="font-semibold">
                {relayMode === 'SINGLE' ? '换手登场' : '全款登场（不换手）'}
              </div>
              <CardEffectText
                text={`支付${energyCost}个[E]`}
                className="mt-1 text-sm"
              />
            </button>
          ))}
        </div>
        <p className="mt-3 text-xs leading-5 text-[var(--text-secondary)]">
          全款按当前登场费用支付，不使用换手减费。
        </p>
        <button
          ref={cancelRef}
          type="button"
          className="button-ghost mt-4 min-h-11 self-end px-4"
          onClick={onCancel}
        >
          取消
        </button>
      </div>
    </div>,
    document.body
  );
}
