import { cardCodeMatchesBase } from '../utils/card-code.js';

export const DOUBLE_RELAY_MEMBER_BASE_CODES = ['PL!SP-bp4-004', 'PL!SP-pb2-000'] as const;

export interface DoubleRelayCardLike {
  readonly cardCode?: string;
}

export function canUseDoubleRelayForCardCode(cardCode: string | undefined): boolean {
  if (!cardCode) {
    return false;
  }
  return DOUBLE_RELAY_MEMBER_BASE_CODES.some((baseCode) =>
    cardCodeMatchesBase(cardCode, baseCode)
  );
}

export function canUseDoubleRelay(cardData: DoubleRelayCardLike | null | undefined): boolean {
  return canUseDoubleRelayForCardCode(cardData?.cardCode);
}
