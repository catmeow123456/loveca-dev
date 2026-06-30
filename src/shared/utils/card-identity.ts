export interface CardIdentityLike {
  readonly groupNames?: readonly string[];
}

export type GroupIdentityName = "μ's" | '蓮ノ空' | 'Liella!' | '虹ヶ咲' | 'Aqours' | 'SaintSnow';

const GROUP_IDENTITY_GROUPS: readonly {
  readonly canonicalName: GroupIdentityName;
  readonly aliases: readonly string[];
}[] = [
  { canonicalName: "μ's", aliases: ["μ's", 'μ'] },
  {
    canonicalName: '蓮ノ空',
    aliases: ['蓮ノ空', '莲之空', 'Hasunosora'],
  },
  {
    canonicalName: 'Liella!',
    aliases: ['Liella!', 'Liella', 'リエラ', 'スーパースター', 'superstar'],
  },
  { canonicalName: '虹ヶ咲', aliases: ['虹咲', '虹ヶ咲', 'Nijigasaki'] },
  {
    canonicalName: 'Aqours',
    aliases: ['Aqours', 'ラブライブ！サンシャイン!!'],
  },
  {
    canonicalName: 'SaintSnow',
    aliases: ['SaintSnow', 'Saint Snow'],
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
  return getStructuredIdentityTextCandidates(card).some((value) =>
    matchesAnyNormalizedAlias(value, normalizedAliases)
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

function getStructuredIdentityTextCandidates(
  card: CardIdentityLike
): readonly (string | undefined)[] {
  return card.groupNames ?? [];
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
