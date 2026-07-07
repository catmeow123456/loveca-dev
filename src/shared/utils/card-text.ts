export function hasStrictNoAbilityCardText(cardText: string | undefined | null): boolean {
  const normalized = (cardText ?? '').trim();
  return normalized.length === 0 || /^[-ー－—−]+$/.test(normalized);
}
