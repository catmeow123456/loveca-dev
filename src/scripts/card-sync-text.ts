export function normalizeCardSyncTextLineEndings(value: string): string {
  return value.replace(/\r\n?/g, '\n');
}

export function cardSyncTextValuesEqual(left: unknown, right: unknown): boolean {
  if (typeof left !== 'string' || typeof right !== 'string') {
    return left === right;
  }
  return normalizeCardSyncTextLineEndings(left) === normalizeCardSyncTextLineEndings(right);
}
