export interface CardIdentityLike {
  readonly cardCode?: string;
  readonly groupName?: string;
  readonly groupNames?: readonly string[];
  readonly unitName?: string;
  readonly unitNameRaw?: string;
  readonly cardText?: string;
  readonly cardTextJp?: string;
  readonly cardTextCn?: string;
}

export type GroupIdentityName = "μ's" | '蓮ノ空' | 'Liella!' | '虹ヶ咲' | 'Aqours' | 'SaintSnow';

const GROUP_IDENTITY_GROUPS: readonly {
  readonly canonicalName: GroupIdentityName;
  readonly aliases: readonly string[];
  readonly cardCodePrefixes: readonly string[];
}[] = [
  { canonicalName: "μ's", aliases: ["μ's", 'μ'], cardCodePrefixes: ['PL!-'] },
  {
    canonicalName: '蓮ノ空',
    aliases: ['蓮ノ空', '莲之空', 'Hasunosora'],
    cardCodePrefixes: ['PL!HS-'],
  },
  {
    canonicalName: 'Liella!',
    aliases: ['Liella!', 'Liella', 'リエラ', 'スーパースター', 'superstar'],
    cardCodePrefixes: ['PL!SP-'],
  },
  { canonicalName: '虹ヶ咲', aliases: ['虹咲', '虹ヶ咲', 'Nijigasaki'], cardCodePrefixes: ['PL!N-'] },
  {
    canonicalName: 'Aqours',
    aliases: ['Aqours', 'ラブライブ！サンシャイン!!'],
    cardCodePrefixes: ['PL!S-'],
  },
  {
    canonicalName: 'SaintSnow',
    aliases: ['SaintSnow', 'Saint Snow'],
    cardCodePrefixes: [],
  },
];

export function cardBelongsToGroup(
  card: CardIdentityLike,
  groupName: string
): boolean {
  const groupIdentity = getGroupIdentity(groupName);
  if (!groupIdentity) {
    return false;
  }

  return cardMatchesGroupIdentity(card, groupIdentity);
}

export function getKnownCardGroupIdentityName(
  card: CardIdentityLike
): GroupIdentityName | null {
  return (
    GROUP_IDENTITY_GROUPS.find((group) => cardMatchesGroupIdentity(card, group))
      ?.canonicalName ?? null
  );
}

function getGroupIdentity(groupName: string):
  | {
      readonly canonicalName: GroupIdentityName;
      readonly aliases: readonly string[];
      readonly cardCodePrefixes: readonly string[];
    }
  | undefined {
  const normalizedGroupName = normalizeGroupIdentityText(groupName);
  return GROUP_IDENTITY_GROUPS.find((group) =>
    group.aliases.some((alias) => normalizeGroupIdentityText(alias) === normalizedGroupName)
  );
}

function cardMatchesGroupIdentity(
  card: CardIdentityLike,
  groupIdentity: {
    readonly canonicalName: GroupIdentityName;
    readonly aliases: readonly string[];
    readonly cardCodePrefixes: readonly string[];
  }
): boolean {
  if (
    groupIdentity.canonicalName === 'Aqours' &&
    hasStructuredGroupIdentity(card, 'SaintSnow') &&
    !hasStructuredGroupIdentity(card, 'Aqours')
  ) {
    return false;
  }

  const normalizedAliases = groupIdentity.aliases.map((alias) => normalizeGroupIdentityText(alias));
  return (
    getCardIdentityTextCandidates(card).some((value) =>
      matchesAnyNormalizedAlias(value, normalizedAliases)
    ) ||
    groupIdentity.cardCodePrefixes.some((prefix) => card.cardCode?.startsWith(prefix) === true)
  );
}

function hasStructuredGroupIdentity(card: CardIdentityLike, groupName: string): boolean {
  const groupIdentity = getGroupIdentity(groupName);
  if (!groupIdentity) {
    return false;
  }
  const normalizedAliases = groupIdentity.aliases.map((alias) => normalizeGroupIdentityText(alias));
  return getStructuredIdentityTextCandidates(card).some((value) =>
    matchesAnyNormalizedAlias(value, normalizedAliases)
  );
}

function getCardIdentityTextCandidates(card: CardIdentityLike): readonly (string | undefined)[] {
  return [
    ...getStructuredIdentityTextCandidates(card),
    card.cardText,
    card.cardTextJp,
    card.cardTextCn,
  ];
}

function getStructuredIdentityTextCandidates(
  card: CardIdentityLike
): readonly (string | undefined)[] {
  return [card.groupName, ...(card.groupNames ?? []), card.unitName, card.unitNameRaw];
}

function matchesAnyNormalizedAlias(
  value: string | undefined,
  normalizedAliases: readonly string[]
): boolean {
  const normalizedValue = normalizeGroupIdentityText(value);
  return normalizedAliases.some((alias) => normalizedValue.includes(alias));
}

function normalizeGroupIdentityText(value: string | undefined): string {
  return value?.replace(/[『』「」'’]/g, '').replace(/！/g, '!').toLowerCase() ?? '';
}
