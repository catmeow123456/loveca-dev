import { SEALED_BP7_PRODUCT_LABEL, SEALED_MODE_NAME } from '@game/shared/sealed-format';

export function SealedFormatLabel({ suffix = '' }: { suffix?: string }) {
  return (
    <span className="sealed-format-label">
      <span>
        {SEALED_MODE_NAME}
        {suffix}
      </span>{' '}
      <span className="sealed-product-tag">{SEALED_BP7_PRODUCT_LABEL}</span>
    </span>
  );
}
