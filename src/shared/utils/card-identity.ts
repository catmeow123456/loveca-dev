export interface CardIdentityLike {
  readonly cardCode?: string;
  readonly groupName?: string;
  readonly cardText?: string;
}

export type GroupIdentityName = "μ's" | '蓮ノ空' | 'Liella!' | '虹ヶ咲' | 'Aqours';

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
  { canonicalName: 'Aqours', aliases: ['Aqours'], cardCodePrefixes: ['PL!S-'] },
];

export function cardBelongsToGroup(
  card: CardIdentityLike,
  groupName: string
): boolean {
  const groupIdentity = getGroupIdentity(groupName);
  if (!groupIdentity) {
    return false;
  }

  const normalizedAliases = groupIdentity.aliases.map((alias) => normalizeGroupIdentityText(alias));
  return (
    matchesAnyNormalizedAlias(card.groupName, normalizedAliases) ||
    matchesAnyNormalizedAlias(card.cardText, normalizedAliases) ||
    groupIdentity.cardCodePrefixes.some((prefix) => card.cardCode?.startsWith(prefix) === true)
  );
}

function getGroupIdentity(groupName: string):
  | {
      readonly aliases: readonly string[];
      readonly cardCodePrefixes: readonly string[];
    }
  | undefined {
  const normalizedGroupName = normalizeGroupIdentityText(groupName);
  return GROUP_IDENTITY_GROUPS.find((group) =>
    group.aliases.some((alias) => normalizeGroupIdentityText(alias) === normalizedGroupName)
  );
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
