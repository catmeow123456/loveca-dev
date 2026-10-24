/** Player-facing names; format and card identifiers keep their original codes. */
export const SEALED_MODE_NAME = '开盒战';
// Booster labels use Chinese ordinals (BP7 → 七弹); premium packs use 团体简称＋高＋序号
// (for example, PL!-pb2 → 缪高2). Register each supported pool's label here.
export const SEALED_BP7_PRODUCT_LABEL = '七弹';
export const SEALED_BP7_DECK_NAME = `${SEALED_MODE_NAME} · ${SEALED_BP7_PRODUCT_LABEL}`;
