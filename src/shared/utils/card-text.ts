export function hasStrictNoAbilityCardText(cardText: string | undefined | null): boolean {
  return (cardText ?? '').trim().length === 0;
}
