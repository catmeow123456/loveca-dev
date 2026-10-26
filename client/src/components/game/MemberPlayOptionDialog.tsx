import { useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Repeat2 } from 'lucide-react';
import type { AnyCardData } from '@game/domain/entities/card';
import type { SlotPosition } from '@game/shared/types/enums';
import type { VisibleCardPresentation } from '@/store/gameStore';
import type { MemberPlayOptionView } from '@/lib/memberPlayOptions';
import { cn } from '@/lib/utils';
import { getPresentationPortalRoot, useTextPresentation } from '@/lib/appPresentation';
import { useDialogAccessibility } from '@/hooks/useDialogAccessibility';
import { Card } from '@/components/card/Card';
import { CardDetailPressTarget } from './CardDetailPressTarget';

export function MemberPlayOptionDialog({
  option,
  cardLabel,
  slots,
  selectedSlots,
  canConfirm,
  onSelectSlot,
  onConfirm,
  onCancel,
}: {
  option: MemberPlayOptionView;
  cardLabel: string;
  slots: readonly {
    slot: SlotPosition;
    label: string;
    cardLabel: string;
    card: VisibleCardPresentation | null;
  }[];
  selectedSlots: readonly SlotPosition[];
  canConfirm: boolean;
  onSelectSlot: (slot: SlotPosition) => void;
  onConfirm: () => void;
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
  const doubleRelay = option.kind === 'DOUBLE_RELAY';
  const dialog = (
    <div className="battle-table fixed inset-0 z-[94] flex items-center justify-center px-3 py-[max(0.75rem,env(safe-area-inset-top),env(safe-area-inset-bottom))]">
      <button
        type="button"
        tabIndex={-1}
        aria-label={`取消${option.label}`}
        className="modal-backdrop absolute inset-0"
        onClick={onCancel}
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={option.title}
        aria-labelledby={titleId}
        tabIndex={-1}
        className="battle-overlay-surface relative flex max-h-[calc(var(--battle-viewport-height,100dvh)_-_max(0.75rem,env(safe-area-inset-top),env(safe-area-inset-bottom))*2)] w-full max-w-[520px] flex-col overflow-hidden border border-[var(--border-active)] bg-[var(--bg-surface)] text-[var(--text-primary)] shadow-[var(--shadow-lg)]"
      >
        <div className="shrink-0 border-b border-[var(--border-subtle)] p-3 md:p-4">
          <h2 id={titleId} className="text-sm font-semibold">
            {option.title}
          </h2>
          <p className="mt-1 text-xs text-[var(--text-secondary)]">{cardLabel}</p>
          {doubleRelay && (
            <p role="status" className="mt-2 text-xs font-semibold text-[var(--accent-primary)]">
              已选 {selectedSlots.length} / {option.selection.maxTargets}
            </p>
          )}
        </div>
        <div className="touch-scroll cute-scrollbar min-h-0 overflow-y-auto p-3 md:p-4">
          <p className="mb-3 text-xs leading-relaxed text-[var(--text-secondary)]">
            {option.description}
          </p>
          <div className="grid grid-cols-3 gap-2">
            {slots.map(({ slot, label, card, cardLabel: memberLabel }) => {
              const order = selectedSlots.indexOf(slot);
              const selected = order >= 0;
              const disabled =
                !option.targetSlots.includes(slot) ||
                (doubleRelay && !selected && selectedSlots.length >= option.selection.maxTargets);
              const role = selected ? (order === 0 ? '登场位置' : '追加换手') : null;
              return (
                <button
                  key={slot}
                  type="button"
                  disabled={disabled}
                  aria-label={`${label}，${memberLabel}${role ? `，${role}` : ''}`}
                  aria-pressed={doubleRelay ? selected : undefined}
                  onClick={() => onSelectSlot(slot)}
                  className={cn(
                    'relative flex min-w-0 flex-col items-center gap-1.5 rounded-md border p-1.5 text-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]',
                    selected
                      ? 'border-[var(--border-active)] bg-[color:color-mix(in_srgb,var(--accent-primary)_10%,var(--bg-surface))]'
                      : 'border-[var(--border-default)] bg-[var(--bg-overlay)]',
                    disabled
                      ? 'cursor-not-allowed opacity-40'
                      : 'hover:border-[var(--border-active)]'
                  )}
                >
                  <span className="text-xs font-semibold">{label}</span>
                  {card ? (
                    <CardDetailPressTarget cardId={card.instanceId} title={memberLabel}>
                      <Card
                        cardData={card.cardData as AnyCardData}
                        instanceId={card.instanceId}
                        imagePath={card.imagePath}
                        size="sm"
                        faceUp
                        showHover={false}
                        className="h-[90px] w-[64px] md:h-[105px] md:w-[75px]"
                      />
                    </CardDetailPressTarget>
                  ) : (
                    <span className="flex h-[90px] w-[64px] items-center justify-center rounded border border-dashed border-[var(--border-default)] text-xs text-[var(--text-muted)] md:h-[105px] md:w-[75px]">
                      空位
                    </span>
                  )}
                  <span className="line-clamp-2 min-h-8 text-[11px] leading-4 text-[var(--text-secondary)]">
                    {memberLabel}
                  </span>
                  <span
                    className={cn(
                      'min-h-4 text-[10px] font-semibold',
                      selected ? 'text-[var(--accent-primary)]' : 'text-[var(--text-muted)]'
                    )}
                  >
                    {role ?? (disabled ? '不可选择' : '可选择')}
                  </span>
                  {selected && (
                    <span
                      aria-hidden="true"
                      className="absolute right-1 top-7 flex h-5 w-5 items-center justify-center rounded-full bg-[var(--accent-primary)] text-[11px] font-semibold text-white"
                    >
                      {order + 1}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
        <div className="flex shrink-0 items-center justify-between gap-2 border-t border-[var(--border-subtle)] p-3">
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            className="button-secondary min-h-10 px-4 text-sm font-semibold"
          >
            取消
          </button>
          {doubleRelay && (
            <button
              type="button"
              disabled={!canConfirm}
              onClick={onConfirm}
              className={cn(
                'button-primary inline-flex min-h-10 items-center justify-center gap-1.5 px-3 text-sm font-semibold',
                !canConfirm && 'cursor-not-allowed opacity-50'
              )}
            >
              <Repeat2 className="h-4 w-4" aria-hidden="true" />
              {option.label}登场
            </button>
          )}
        </div>
      </div>
    </div>
  );
  return textOnly ? dialog : createPortal(dialog, getPresentationPortalRoot());
}
