import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getUnknownCardEffectPlaceholders } from '../../client/src/lib/cardEffectTokens';
import { CARD_ABILITY_DEFINITIONS } from '../../src/application/card-effects/definitions';

interface DisplayTextSource {
  readonly abilityId: string;
  readonly field: string;
  readonly text: string;
}

interface GovernanceViolation extends DisplayTextSource {
  readonly issue: string;
}

const JAPANESE_RULE_TEXT_PATTERN =
  /(ライブ開始時|ライブ成功時|常時|登場|自分の|相手の|ステージ|メンバー|カード|エネルギー|デッキ|控え室|置き場|支払|選ぶ|扱う|場合|このカード|スコア|ユニット名|ライブ終了時|手札|名前|コスト|異なる|得る)/;

const TERMINOLOGY_RULES: readonly {
  readonly issue: string;
  readonly pattern: RegExp;
}[] = [
  { issue: 'use 【中央】 instead of 【センター】', pattern: /【センター】/ },
  { issue: 'use 中央声援 instead of 中心声援', pattern: /中心声援/ },
  { issue: 'use 成功LIVE卡区 instead of 成功LIVE区', pattern: /成功LIVE区/ },
  { issue: 'use 小队名 instead of unit 名 / unit成员', pattern: /unit\s*名|unit成员|不同unit/ },
];

const LEGACY_ENERGY_PAYMENT_PATTERN =
  /支付(?:\d+|\$\{[^}]+\})(?:张|个)?(?:活跃)?能量|支付(?:[1-9]\d*|\$\{[^}]+\})(?:个)?\[E\]/;

const PLAYER_VISIBLE_SOURCE_FIELDS = [
  'stepText',
  'selectionLabel',
  'confirmSelectionLabel',
  'skipSelectionLabel',
  'label',
  'confirmLabel',
] as const;

const PLAYER_VISIBLE_SOURCE_ROOTS = [
  'src/application/card-effects/runtime',
  'src/application/card-effects/workflows',
  'src/application/effects',
];

function listTypeScriptFiles(relativeDirectory: string): string[] {
  return readdirSync(join(process.cwd(), relativeDirectory), { withFileTypes: true }).flatMap(
    (entry) => {
      const relativePath = join(relativeDirectory, entry.name);
      if (entry.isDirectory()) {
        return listTypeScriptFiles(relativePath);
      }
      return entry.isFile() && entry.name.endsWith('.ts') ? [relativePath] : [];
    }
  );
}

function collectPlayerVisibleSourceTexts(): DisplayTextSource[] {
  return PLAYER_VISIBLE_SOURCE_ROOTS.flatMap(listTypeScriptFiles).flatMap((relativePath) => {
    const source = readFileSync(join(process.cwd(), relativePath), 'utf8');
    return PLAYER_VISIBLE_SOURCE_FIELDS.flatMap((field) => {
      const pattern = new RegExp(`\\b${field}\\s*:\\s*(['\\\"\x60])([\\s\\S]*?)\\1`, 'g');
      return [...source.matchAll(pattern)].map((match, index) => ({
        abilityId: relativePath,
        field: `${field}[${index}]`,
        text: match[2] ?? '',
      }));
    });
  });
}

function collectRegistryDisplayTexts(
  options: { readonly implementedOnly?: boolean } = {}
): DisplayTextSource[] {
  return CARD_ABILITY_DEFINITIONS.flatMap((ability) => {
    if (options.implementedOnly !== false && !ability.implemented) {
      return [];
    }

    const texts: DisplayTextSource[] = [
      {
        abilityId: ability.abilityId,
        field: 'effectText',
        text: ability.effectText,
      },
    ];

    if (ability.activatedUi) {
      texts.push(
        {
          abilityId: ability.abilityId,
          field: 'activatedUi.title',
          text: ability.activatedUi.title,
        },
        {
          abilityId: ability.abilityId,
          field: 'activatedUi.text',
          text: ability.activatedUi.text,
        }
      );
    }

    return texts;
  });
}

function stripIconPlaceholdersAndQuotedNames(text: string): string {
  return text
    .replace(/\[[^\]\r\n]+\]/g, '')
    .replace(/『[^』\r\n]+』/g, '')
    .replace(/「[^」\r\n]{1,24}」/g, '');
}

function formatViolations(violations: readonly GovernanceViolation[]): string {
  const preview = violations
    .slice(0, 80)
    .map(
      (violation, index) =>
        `${index + 1}. ${violation.abilityId} ${violation.field}: ${violation.issue}\n   ${violation.text}`
    )
    .join('\n');
  const suffix =
    violations.length > 80 ? `\n...and ${violations.length - 80} more violation(s)` : '';
  return `${violations.length} violation(s)\n${preview}${suffix}`;
}

describe('card effect display text governance', () => {
  it('keeps the shared activated and Echoes Beyond texts at their Excel Chinese source', () => {
    expect(
      CARD_ABILITY_DEFINITIONS.find(
        (ability) => ability.abilityId === 'PL!SP-bp5-020:activated-pay-two-energy-draw-one'
      )?.effectText
    ).toBe('【起动】【1回合1次】[E][E]：抽1张卡。');
    expect(
      CARD_ABILITY_DEFINITIONS.find(
        (ability) =>
          ability.abilityId === 'PL!HS-PR-028:live-success-extra-effective-heart-member-draw-one'
      )?.effectText
    ).toBe(
      '【LIVE成功时】自己的舞台中，存在持有的HEART数量比原本持有的HEART数量多的成员的场合，抽1张卡。'
    );
    expect(
      CARD_ABILITY_DEFINITIONS.find(
        (ability) => ability.abilityId === 'PL!N-bp5-003:activated-discard-pay-score-recover-live'
      )?.effectText
    ).toBe(
      '【起动】【1回合1次】将1张手牌放置入休息室：选择自己休息室1张LIVE卡。可以支付与该卡分数相同数量的[E]；如此做时将该LIVE加入手牌。'
    );
    expect(
      CARD_ABILITY_DEFINITIONS.find(
        (ability) =>
          ability.abilityId ===
          'PL!-bp4-013:live-start-discard-target-other-member-gain-pink-heart'
      )?.effectText
    ).toBe(
      '【LIVE开始时】可以将1张手牌放置入休息室：LIVE结束时为止，1名存在于自己的舞台的此成员以外的成员，获得[桃ハート]。'
    );
    expect(
      CARD_ABILITY_DEFINITIONS.find((ability) =>
        ability.abilityId.startsWith('PL!-bp4-014:live-start-live-without-timing')
      )?.effectText
    ).toBe(
      '【LIVE开始时】自己的LIVE中的LIVE卡，存在不持有【LIVE开始时】能力与【LIVE成功时】能力的卡片的场合，LIVE结束时为止，1名存在于自己的舞台的此成员以外的成员，获得[ブレード][ブレード]。'
    );
    expect(
      CARD_ABILITY_DEFINITIONS.find(
        (ability) => ability.abilityId === 'PL!-bp4-024:live-start-target-muse-member-gain-one-blade'
      )?.effectText
    ).toBe("【LIVE开始时】LIVE结束时为止，存在于自己的舞台的1名『μ's』的成员，获得[ブレード]。");
  });

  it('uses only mapped card effect placeholders in registry display text', () => {
    const violations = collectRegistryDisplayTexts().flatMap((source) =>
      getUnknownCardEffectPlaceholders(source.text).map((placeholder) => ({
        ...source,
        issue: `unknown placeholder ${placeholder}`,
      }))
    );

    expect(violations, formatViolations(violations)).toHaveLength(0);
  });

  it('does not leave Japanese rule sentences in registry display text', () => {
    const violations = collectRegistryDisplayTexts()
      .map((source) => ({
        ...source,
        normalizedText: stripIconPlaceholdersAndQuotedNames(source.text),
      }))
      .filter((source) => JAPANESE_RULE_TEXT_PATTERN.test(source.normalizedText))
      .map(({ normalizedText: _normalizedText, ...source }) => ({
        ...source,
        issue: 'Japanese rule sentence residue',
      }));

    expect(violations, formatViolations(violations)).toHaveLength(0);
  });

  it('uses project terminology in registry display text', () => {
    const violations = collectRegistryDisplayTexts().flatMap((source) =>
      TERMINOLOGY_RULES.filter((rule) => rule.pattern.test(source.text)).map((rule) => ({
        ...source,
        issue: rule.issue,
      }))
    );

    expect(violations, formatViolations(violations)).toHaveLength(0);
  });

  it('uses repeated [E] tokens for fixed energy payments in player-visible fields', () => {
    const sources = [
      ...collectRegistryDisplayTexts({ implementedOnly: false }),
      ...collectPlayerVisibleSourceTexts(),
    ];
    const violations = sources
      .filter((source) => LEGACY_ENERGY_PAYMENT_PATTERN.test(source.text))
      .map((source) => ({ ...source, issue: 'legacy or mixed energy payment text' }));

    expect(violations, formatViolations(violations)).toHaveLength(0);
  });

  it('does not confuse ordinary energy-card operations with payment text', () => {
    const ordinaryEnergyTexts = [
      '将2张能量变为活跃状态。',
      '从能量卡组放置1张能量。',
      '自己的能量为10张以上。',
      '将能量放回能量卡组。',
      '成员下方的能量不能用于支付费用。',
    ];

    expect(ordinaryEnergyTexts.filter((text) => LEGACY_ENERGY_PAYMENT_PATTERN.test(text))).toEqual(
      []
    );
  });
});
