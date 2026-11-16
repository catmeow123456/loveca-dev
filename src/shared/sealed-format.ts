/** Player-facing names; format and card identifiers keep their original codes. */
export const SEALED_MODE_NAME = '开盒战';
// Booster labels use Chinese ordinals (BP8 → 八弹); premium packs use 团体简称＋高＋序号
// (for example, PL!-pb2 → 缪高2). Register each supported pool's label here.
export const SEALED_BP8_PRODUCT_LABEL = '八弹';
export const SEALED_BP8_DECK_NAME = `${SEALED_MODE_NAME} · ${SEALED_BP8_PRODUCT_LABEL}`;
