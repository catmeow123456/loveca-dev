import { cardCodeMatchesBase } from '@game/shared/utils/card-code';

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

const COLOR_BLADE_TO_HEART_SOURCE_CORRECTIONS = [
  ['[桃ブレード]', '[桃ハート]'],
  ['[赤ブレード]', '[赤ハート]'],
  ['[黄ブレード]', '[黄ハート]'],
  ['[緑ブレード]', '[緑ハート]'],
  ['[青ブレード]', '[青ハート]'],
  ['[紫ブレード]', '[紫ハート]'],
] as const;

/**
 * Pure display-time correction for a confirmed upstream card-text error. This does not mutate
 * registry/API data and applies to every rarity sharing the verified base card identity.
 */
export function correctKnownLocalizedCardText(
  cardCode: string,
  value?: string | null
): string | null {
  const text = cleanLocalizedText(value);
  if (text === null || !cardCodeMatchesBase(cardCode, 'PL!N-bp7-025')) {
    return text;
  }
  return COLOR_BLADE_TO_HEART_SOURCE_CORRECTIONS.reduce(
    (corrected, [from, to]) => corrected.replaceAll(from, to),
    text
  );
}

export function getCardLocalizedInfo(card: LocalizedCardLike) {
  const nameJp = cleanLocalizedText(card.nameJp);
  const nameCn = cleanLocalizedText(card.nameCn);
  const effectJp = correctKnownLocalizedCardText(card.cardCode, card.cardTextJp);
  const effectCn = correctKnownLocalizedCardText(card.cardCode, card.cardTextCn);
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
  const groups = card.groupNames
    ?.map(cleanLocalizedText)
    .filter((value): value is string => Boolean(value));
  return groups && groups.length > 0 ? groups.join('\n') : null;
}
