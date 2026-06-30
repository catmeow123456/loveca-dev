export interface LocalizedCardLike {
  readonly cardCode: string;
  readonly nameJp?: string | null;
  readonly nameCn?: string | null;
  readonly cardTextJp?: string | null;
  readonly cardTextCn?: string | null;
  readonly groupNames?: readonly string[] | null;
}

export function cleanLocalizedText(value?: string | null): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export function getCardLocalizedInfo(card: LocalizedCardLike) {
  const nameJp = cleanLocalizedText(card.nameJp);
  const nameCn = cleanLocalizedText(card.nameCn);
  const effectJp = cleanLocalizedText(card.cardTextJp);
  const effectCn = cleanLocalizedText(card.cardTextCn);
  const title = [nameCn, nameJp].filter(Boolean).join(' / ') || card.cardCode;

  return {
    nameCn,
    nameJp,
    displayNameCn: nameCn ?? card.cardCode,
    title,
    effectCn,
    effectJp,
    hasEffect: Boolean(effectCn || effectJp),
  };
}

export function getCardGroupDisplayText(card: LocalizedCardLike): string | null {
  const groups = card.groupNames?.map(cleanLocalizedText).filter((value): value is string =>
    Boolean(value)
  );
  return groups && groups.length > 0 ? groups.join('\n') : null;
}
