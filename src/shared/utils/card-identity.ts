export interface CardIdentityLike {
  readonly cardCode?: string;
  readonly name?: string;
  readonly workNames?: readonly string[];
  readonly groupNames?: readonly string[];
  readonly unitName?: string;
}

export type GroupIdentityName =
  | "μ's"
  | '蓮ノ空'
  | 'Liella!'
  | '虹ヶ咲'
  | 'Aqours'
  | 'SunnyPassion'
  | 'A-RISE'
  | 'SaintSnow'
  | 'いきづらい部！';

export type GroupIdentityKey =
  | 'muse'
  | 'hasunosora'
  | 'liella'
  | 'nijigasaki'
  | 'aqours'
  | 'sunny-passion'
  | 'a-rise'
  | 'saint-snow'
  | 'ikizurai';

export interface DifferentNamedCardMatch<T> {
  readonly item: T;
  readonly name: string;
  readonly normalizedName: string;
}

export interface DifferentStructuredUnitCardMatch<T> {
  readonly item: T;
  readonly unitName: string;
  readonly normalizedUnitName: string;
}

const CARD_NAME_ALIAS_GROUPS: readonly (readonly string[])[] = [
  ['高坂穂乃果', '高坂穗乃果'],
  ['絢瀬絵里', '绚濑绘里'],
  ['南ことり', '南琴梨'],
  ['園田海未', '园田海未'],
  ['星空凛'],
  ['西木野真姫', '西木野真姬'],
  ['東條希', '东条希'],
  ['小泉花陽', '小泉花阳'],
  ['矢澤にこ', '矢泽日香'],
  ['高海千歌'],
  ['桜内梨子', '樱内梨子'],
  ['松浦果南'],
  ['黒澤ダイヤ', '黑泽黛雅'],
  ['渡辺曜', '渡边曜'],
  ['津島善子', '津岛善子'],
  ['国木田花丸'],
  ['小原鞠莉'],
  ['黒澤ルビィ', '黑泽露比'],
  ['上原歩夢', '上原步梦'],
  ['中須かすみ', '中须霞'],
  ['桜坂しずく', '樱坂雫'],
  ['朝香果林'],
  ['宮下愛', '宫下爱'],
  ['近江彼方'],
  ['優木せつ菜', '优木雪菜'],
  ['エマ・ヴェルデ', '艾玛·维尔德'],
  ['天王寺璃奈'],
  ['三船栞子'],
  ['ミア・テイラー', '米娅·泰勒'],
  ['鐘嵐珠', '钟岚珠'],
  ['澁谷かのん', '渋谷かのん', '涩谷香音', '涉谷香音'],
  ['唐可可'],
  ['嵐千砂都', '岚千砂都'],
  ['平安名すみれ', '平安名堇'],
  ['葉月恋', '叶月恋'],
  ['桜小路きな子', '樱小路希奈子'],
  ['米女メイ', '米女芽衣'],
  ['若菜四季'],
  ['鬼塚夏美', '鬼冢夏美'],
  ['ウィーン・マルガレーテ', '薇恩・玛格丽特'],
  ['鬼塚冬毬', '鬼冢冬毬'],
  ['日野下花帆'],
  ['村野さやか', '村野沙耶香'],
  ['乙宗梢'],
  ['夕霧綴理', '夕雾缀理'],
  ['大沢瑠璃乃', '大泽瑠璃乃', '大泽琉璃乃'],
  ['藤島慈', '藤岛慈'],
  ['百生吟子'],
  ['徒町小鈴', '徒町小铃'],
  ['安養寺姫芽', '安养寺姬芽'],
  [
    'セラス柳田リリエンフェルト',
    'セラス 柳田 リリエンフェルト',
    '赛拉丝柳田利林费尔德',
    '赛拉丝·柳田·利林费尔德',
  ],
  ['桂城泉'],
  ['綺羅ツバサ', '绮罗翼'],
  ['優木あんじゅ', '优木杏树'],
  ['統堂英玲奈', '统堂英玲奈'],
  ['鹿角聖良', '鹿角圣良'],
  ['鹿角理亞', '鹿角理亚'],
  ['柊摩央'],
  ['聖澤悠奈', '圣泽悠奈'],
];

const GROUP_IDENTITY_GROUPS: readonly {
  readonly canonicalName: GroupIdentityName;
  readonly key: GroupIdentityKey;
  readonly aliases: readonly string[];
}[] = [
  { canonicalName: "μ's", key: 'muse', aliases: ["μ's", 'μ', 'muse', 'ラブライブ！'] },
  {
    canonicalName: '蓮ノ空',
    key: 'hasunosora',
    aliases: ['蓮ノ空', '莲之空', 'Hasunosora'],
  },
  {
    canonicalName: 'Liella!',
    key: 'liella',
    aliases: [
      'Liella!',
      'Liella',
      'リエラ',
      'スーパースター',
      'superstar',
      'ラブライブ！スーパースター!!',
    ],
  },
  {
    canonicalName: 'SunnyPassion',
    key: 'sunny-passion',
    aliases: ['SunnyPassion', 'Sunny Passion', 'サニーパッション'],
  },
  {
    canonicalName: '虹ヶ咲',
    key: 'nijigasaki',
    aliases: [
      '虹咲',
      '虹ヶ咲',
      'Nijigasaki',
      'ラブライブ！虹ヶ咲学園スクールアイドル同好会',
    ],
  },
  {
    canonicalName: 'Aqours',
    key: 'aqours',
    aliases: ['Aqours', 'ラブライブ！サンシャイン!!'],
  },
  {
    canonicalName: 'A-RISE',
    key: 'a-rise',
    aliases: ['A-RISE', 'ARISE', 'A RISE'],
  },
  {
    canonicalName: 'SaintSnow',
    key: 'saint-snow',
    aliases: ['SaintSnow', 'Saint Snow'],
  },
  {
    canonicalName: 'いきづらい部！',
    key: 'ikizurai',
    aliases: [
      'いきづらい部！',
      'いきづらい部!',
      'いきづらい部',
      'イキヅライブ！LOVELIVE!BLUEBIRD',
      'イキヅライブ!LOVELIVE!BLUEBIRD',
      'イキヅライブ',
      'LOVELIVE!BLUEBIRD',
      'IKZL',
      'Ikizurai',
    ],
  },
];

export const KNOWN_GROUP_IDENTITY_NAMES: readonly GroupIdentityName[] = Object.freeze(
  GROUP_IDENTITY_GROUPS.map((group) => group.canonicalName)
);

const HASUNOSORA_TRIPLE_UNIT_CARD_CODES = new Set([
  'PL!HS-bp2-020-L',
  'PL!HS-bp5-018-L',
  'PL!HS-sd1-020-SD',
]);

const HASUNOSORA_TRIPLE_UNIT_ALIAS_GROUPS: readonly (readonly string[])[] = [
  ['cerise-bouquet', 'Cerise Bouquet', 'スリーズブーケ'],
  ['dollchestra', 'DOLLCHESTRA'],
  ['mira-cra-park', 'Mira-Cra Park!', 'みらくらぱーく！', 'みらくらぱーく!'],
];

export function cardBelongsToUnit(card: CardIdentityLike, unitName: string): boolean {
  if (cardHasHasunosoraTripleUnitIdentity(card, unitName)) {
    return true;
  }

  const normalizedAliases = getNormalizedHasunosoraUnitAliases(unitName);
  return matchesAnyNormalizedAlias(card.unitName, normalizedAliases);
}

export function cardBelongsToGroup(card: CardIdentityLike, groupName: string): boolean {
  if (cardHasHasunosoraTripleUnitIdentity(card, groupName)) {
    return true;
  }

  const groupIdentity = getGroupIdentity(groupName);
  if (!groupIdentity) {
    return false;
  }

  return cardMatchesGroupIdentity(card, groupIdentity);
}

export function getKnownCardGroupIdentityName(card: CardIdentityLike): GroupIdentityName | null {
  return (
    GROUP_IDENTITY_GROUPS.find((group) => cardMatchesGroupIdentity(card, group))?.canonicalName ??
    null
  );
}

export function getCardGroupIdentityKeys(card: CardIdentityLike): readonly GroupIdentityKey[] {
  return [
    ...new Set(getStructuredGroupIdentityNames(card).map((name) => getGroupIdentityKey(name))),
  ].sort();
}

export function getGroupIdentityKey(groupName: GroupIdentityName): GroupIdentityKey {
  const group = GROUP_IDENTITY_GROUPS.find((candidate) => candidate.canonicalName === groupName);
  if (!group) {
    throw new Error(`Unknown group identity: ${groupName}`);
  }
  return group.key;
}

export function getCardNameCandidates(
  card: CardIdentityLike,
  options: { readonly groupName?: string } = {}
): readonly string[] {
  const nameCandidates = splitCardNameCandidates(card.name);
  if (!options.groupName) {
    return nameCandidates;
  }

  const groupIdentity = getGroupIdentity(options.groupName);
  if (!groupIdentity || !cardMatchesGroupIdentity(card, groupIdentity)) {
    return [];
  }

  const groupNames = getGroupIdentityNamesForNameMapping(card, nameCandidates.length);
  if (nameCandidates.length > 1 && groupNames.length === nameCandidates.length) {
    return nameCandidates.filter((_, index) => groupNames[index] === groupIdentity.canonicalName);
  }

  return nameCandidates;
}

export function getNormalizedCardNameCandidates(
  card: CardIdentityLike,
  options: { readonly groupName?: string } = {}
): readonly string[] {
  return [...new Set(getCardNameCandidates(card, options).map(normalizeCardName).filter(Boolean))];
}

export function normalizeCardName(value: string | undefined): string {
  return value?.replace(/[\s・·]/g, '') ?? '';
}

export function cardNameAliasMatches(card: CardIdentityLike, name: string): boolean {
  const normalizedAliases = getNormalizedCardNameAliases(name);
  return getNormalizedCardNameCandidates(card).some((candidate) =>
    normalizedAliases.includes(candidate)
  );
}

export function cardNameMatchesAnyAlias(
  card: CardIdentityLike,
  names: readonly string[]
): boolean {
  return names.some((name) => cardNameAliasMatches(card, name));
}

function getNormalizedCardNameAliases(name: string): readonly string[] {
  const normalizedName = normalizeCardName(name);
  const aliasGroup = CARD_NAME_ALIAS_GROUPS.find((aliases) =>
    aliases.some((alias) => normalizeCardName(alias) === normalizedName)
  );
  return (aliasGroup ?? [name]).map((alias) => normalizeCardName(alias));
}

export function selectDifferentNamedCards<T>(
  items: readonly T[],
  getCard: (item: T) => CardIdentityLike | null | undefined,
  options: {
    readonly groupName?: string;
    readonly minCount?: number;
    readonly maxCount?: number;
    readonly excludedNormalizedNames?: readonly string[];
    readonly getSecondaryKey?: (item: T) => string | number | null | undefined;
  } = {}
): readonly DifferentNamedCardMatch<T>[] {
  const candidates = items.flatMap((item) => {
    const card = getCard(item);
    if (!card) {
      return [];
    }
    const names = getCardNameCandidates(card, { groupName: options.groupName });
    if (names.length === 0) {
      return [];
    }
    const secondaryKey = options.getSecondaryKey?.(item);
    return [
      {
        item,
        names,
        secondaryKey:
          secondaryKey === null || secondaryKey === undefined ? null : String(secondaryKey),
      },
    ];
  });
  const maxCount = Math.min(options.maxCount ?? candidates.length, candidates.length);
  const minCount = Math.min(options.minCount ?? maxCount, maxCount);
  const selected = findDifferentNameAssignment(
    candidates,
    maxCount,
    new Set(options.excludedNormalizedNames ?? []),
    new Set()
  );
  return selected.length >= minCount ? selected : [];
}

export function hasAtLeastDifferentNamedCards<T>(
  items: readonly T[],
  minCount: number,
  getCard: (item: T) => CardIdentityLike | null | undefined,
  options: {
    readonly groupName?: string;
    readonly excludedNormalizedNames?: readonly string[];
    readonly getSecondaryKey?: (item: T) => string | number | null | undefined;
  } = {}
): boolean {
  return (
    selectDifferentNamedCards(items, getCard, {
      ...options,
      minCount,
      maxCount: minCount,
    }).length >= minCount
  );
}

export function selectDifferentStructuredUnitCardsWithGroup<T>(
  items: readonly T[],
  getCard: (item: T) => CardIdentityLike | null | undefined,
  options: {
    readonly groupName: string;
    readonly minCount?: number;
  }
): readonly DifferentStructuredUnitCardMatch<T>[] {
  const candidates = items.flatMap((item) => {
    const card = getCard(item);
    const unitName = card?.unitName?.trim();
    const normalizedUnitName = normalizeStructuredUnitName(unitName);
    if (!card || !unitName || !normalizedUnitName) {
      return [];
    }
    return [
      {
        item,
        unitName,
        normalizedUnitName,
        belongsToGroup: cardBelongsToGroup(card, options.groupName),
      },
    ];
  });
  const minCount = options.minCount ?? 2;
  const selected = findDifferentStructuredUnitAssignment(
    candidates,
    minCount,
    new Set()
  );
  return selected.length >= minCount && selected.some((match) => match.belongsToGroup)
    ? selected.map(({ belongsToGroup: _belongsToGroup, ...match }) => match)
    : [];
}

export function cardHasHasunosoraTripleUnitIdentity(
  card: CardIdentityLike,
  unitName: string
): boolean {
  if (!card.cardCode || !HASUNOSORA_TRIPLE_UNIT_CARD_CODES.has(card.cardCode)) {
    return false;
  }

  const normalizedUnitName = normalizeGroupIdentityText(unitName);
  return HASUNOSORA_TRIPLE_UNIT_ALIAS_GROUPS.some((aliases) =>
    aliases.some((alias) => normalizeGroupIdentityText(alias) === normalizedUnitName)
  );
}

function getNormalizedHasunosoraUnitAliases(unitName: string): readonly string[] {
  const normalizedUnitName = normalizeGroupIdentityText(unitName);
  const aliasGroup = HASUNOSORA_TRIPLE_UNIT_ALIAS_GROUPS.find((aliases) =>
    aliases.some((alias) => normalizeGroupIdentityText(alias) === normalizedUnitName)
  );
  return (aliasGroup ?? [unitName]).map((alias) => normalizeGroupIdentityText(alias));
}

function getGroupIdentity(groupName: string):
  | {
      readonly canonicalName: GroupIdentityName;
      readonly key: GroupIdentityKey;
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
    readonly key: GroupIdentityKey;
    readonly aliases: readonly string[];
  }
): boolean {
  const structuredGroupNames = getStructuredGroupIdentityNames(card);
  if (structuredGroupNames.length > 0) {
    return structuredGroupNames.includes(groupIdentity.canonicalName);
  }

  const normalizedAliases = groupIdentity.aliases.map((alias) => normalizeGroupIdentityText(alias));
  return getStructuredIdentityTextCandidates(card).some((value) =>
    matchesAnyNormalizedAlias(value, normalizedAliases)
  );
}

function getStructuredGroupIdentityNames(card: CardIdentityLike): readonly GroupIdentityName[] {
  return [...new Set(getStructuredGroupIdentityNamesInOrder(card))];
}

function getStructuredGroupIdentityNamesInOrder(
  card: CardIdentityLike
): readonly GroupIdentityName[] {
  return getIdentityNamesFromTexts(getStructuredIdentityTextCandidates(card));
}

function getGroupIdentityNamesForNameMapping(
  card: CardIdentityLike,
  expectedNameCount: number
): readonly GroupIdentityName[] {
  const fromGroupNames = getIdentityNamesFromTexts(card.groupNames ?? []);
  if (fromGroupNames.length === expectedNameCount) {
    return fromGroupNames;
  }

  const fromWorkNames = getIdentityNamesFromTexts(card.workNames ?? []);
  if (fromWorkNames.length === expectedNameCount) {
    return fromWorkNames;
  }

  return [];
}

function getIdentityNamesFromTexts(texts: readonly (string | undefined)[]): readonly GroupIdentityName[] {
  return texts.flatMap((text) =>
    (text ?? '').split(/\n/g).flatMap((value) => {
      const normalizedAliasesByGroup = GROUP_IDENTITY_GROUPS.map((group) => ({
        group,
        normalizedAliases: group.aliases.map((alias) => normalizeGroupIdentityText(alias)),
      }));
      return normalizedAliasesByGroup
        .filter(({ normalizedAliases }) => matchesAnyNormalizedAlias(value, normalizedAliases))
        .map(({ group }) => group.canonicalName);
    })
  );
}

function getStructuredIdentityTextCandidates(
  card: CardIdentityLike
): readonly (string | undefined)[] {
  return [...(card.groupNames ?? []), ...(card.workNames ?? [])].flatMap((value) =>
    value.split(/\n/g)
  );
}

function matchesAnyNormalizedAlias(
  value: string | undefined,
  normalizedAliases: readonly string[]
): boolean {
  const normalizedValue = normalizeGroupIdentityText(value);
  return normalizedAliases.some(
    (alias) =>
      normalizedValue === alias || (alias !== 'ラブライブ!' && normalizedValue.includes(alias))
  );
}

function normalizeGroupIdentityText(value: string | undefined): string {
  return (
    value
      ?.replace(/[『』「」'’]/g, '')
      .replace(/！/g, '!')
      .toLowerCase() ?? ''
  );
}

function normalizeStructuredUnitName(value: string | undefined): string {
  const normalizedValue = normalizeGroupIdentityText(value);
  const hasunosoraAliasGroup = HASUNOSORA_TRIPLE_UNIT_ALIAS_GROUPS.find((aliases) =>
    aliases.some((alias) => normalizeGroupIdentityText(alias) === normalizedValue)
  );
  return hasunosoraAliasGroup
    ? normalizeGroupIdentityText(hasunosoraAliasGroup[0])
    : normalizedValue;
}

function splitCardNameCandidates(value: string | undefined): readonly string[] {
  if (!value) {
    return [];
  }
  return [...new Set(value.split(/[&＆]/g).map((name) => name.trim()).filter(Boolean))];
}

function findDifferentNameAssignment<T>(
  candidates: readonly {
    readonly item: T;
    readonly names: readonly string[];
    readonly secondaryKey: string | null;
  }[],
  maxCount: number,
  usedNames: ReadonlySet<string>,
  usedSecondaryKeys: ReadonlySet<string>
): readonly DifferentNamedCardMatch<T>[] {
  if (maxCount === 0 || candidates.length === 0) {
    return [];
  }

  let best: readonly DifferentNamedCardMatch<T>[] = [];
  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index]!;
    if (candidate.secondaryKey !== null && usedSecondaryKeys.has(candidate.secondaryKey)) {
      continue;
    }
    for (const name of candidate.names) {
      const normalizedName = normalizeCardName(name);
      if (!normalizedName || usedNames.has(normalizedName)) {
        continue;
      }
      const nextUsedNames = new Set(usedNames);
      nextUsedNames.add(normalizedName);
      const nextUsedSecondaryKeys = new Set(usedSecondaryKeys);
      if (candidate.secondaryKey !== null) {
        nextUsedSecondaryKeys.add(candidate.secondaryKey);
      }
      const rest = findDifferentNameAssignment(
        candidates.slice(index + 1),
        maxCount - 1,
        nextUsedNames,
        nextUsedSecondaryKeys
      );
      const match = { item: candidate.item, name, normalizedName };
      if (rest.length === maxCount - 1) {
        return [match, ...rest];
      }
      const selected = [match, ...rest];
      if (selected.length > best.length) {
        best = selected;
      }
    }
  }

  return best;
}

function findDifferentStructuredUnitAssignment<T>(
  candidates: readonly {
    readonly item: T;
    readonly unitName: string;
    readonly normalizedUnitName: string;
    readonly belongsToGroup: boolean;
  }[],
  minCount: number,
  usedUnitNames: ReadonlySet<string>
): readonly (DifferentStructuredUnitCardMatch<T> & { readonly belongsToGroup: boolean })[] {
  if (minCount === 0) {
    return [];
  }

  let best: readonly (DifferentStructuredUnitCardMatch<T> & {
    readonly belongsToGroup: boolean;
  })[] = [];
  for (const [index, candidate] of candidates.entries()) {
    if (usedUnitNames.has(candidate.normalizedUnitName)) {
      continue;
    }
    const nextUsedUnitNames = new Set(usedUnitNames);
    nextUsedUnitNames.add(candidate.normalizedUnitName);
    const rest = findDifferentStructuredUnitAssignment(
      candidates.slice(index + 1),
      minCount - 1,
      nextUsedUnitNames
    );
    const selected = [candidate, ...rest];
    if (selected.length >= minCount && selected.some((match) => match.belongsToGroup)) {
      return selected;
    }
    if (
      selected.length > best.length ||
      (selected.length === best.length &&
        selected.some((match) => match.belongsToGroup) &&
        !best.some((match) => match.belongsToGroup))
    ) {
      best = selected;
    }
  }

  return best;
}
