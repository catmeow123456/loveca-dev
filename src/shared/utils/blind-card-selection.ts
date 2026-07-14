const BLIND_CARD_SELECTION_TOKEN_PREFIX = 'blind-card-';

export function createBlindCardSelectionToken(index: number): string {
  return `${BLIND_CARD_SELECTION_TOKEN_PREFIX}${index}`;
}

export function resolveBlindCardSelectionToken(
  candidateCardIds: readonly string[],
  token: string | null | undefined
): string | null {
  if (!token?.startsWith(BLIND_CARD_SELECTION_TOKEN_PREFIX)) {
    return null;
  }

  const indexText = token.slice(BLIND_CARD_SELECTION_TOKEN_PREFIX.length);
  if (!/^\d+$/.test(indexText)) {
    return null;
  }

  return candidateCardIds[Number(indexText)] ?? null;
}
