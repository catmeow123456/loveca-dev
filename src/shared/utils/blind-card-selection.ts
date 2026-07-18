const BLIND_CARD_SELECTION_TOKEN_PREFIX = 'blind-card-';

export function createBlindCardSelectionToken(index: number, version?: number): string {
  return version === undefined
    ? `${BLIND_CARD_SELECTION_TOKEN_PREFIX}${index}`
    : `${BLIND_CARD_SELECTION_TOKEN_PREFIX}v${version}-${index}`;
}

export function resolveBlindCardSelectionToken(
  candidateCardIds: readonly string[],
  token: string | null | undefined,
  version?: number
): string | null {
  if (version !== undefined) {
    const expectedPrefix = `${BLIND_CARD_SELECTION_TOKEN_PREFIX}v${version}-`;
    if (!token?.startsWith(expectedPrefix)) return null;
    const indexText = token.slice(expectedPrefix.length);
    if (!/^\d+$/.test(indexText)) return null;
    return candidateCardIds[Number(indexText)] ?? null;
  }
  if (!token?.startsWith(BLIND_CARD_SELECTION_TOKEN_PREFIX)) {
    return null;
  }

  const indexText = token.slice(BLIND_CARD_SELECTION_TOKEN_PREFIX.length);
  if (!/^\d+$/.test(indexText)) {
    return null;
  }

  return candidateCardIds[Number(indexText)] ?? null;
}
