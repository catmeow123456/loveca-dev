import { describe, expect, it } from 'vitest';
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

function collectRegistryDisplayTexts(): DisplayTextSource[] {
  return CARD_ABILITY_DEFINITIONS.flatMap((ability) => {
    if (!ability.implemented) {
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
});
