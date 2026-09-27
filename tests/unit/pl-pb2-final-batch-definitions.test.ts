import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { getCardAbilityDefinitionsForCardCode } from '../../src/application/card-effects/definitions/lookup';

// Complete, independent literals from cards_export_2026-09-09.json.
const cases = [
  {
    base: 'PL!-pb2-012',
    abilityId: 'PL!-pb2-012:continuous-play-wait-two-printemps-cost-minus-two',
    category: 'CONTINUOUS',
    sourceZone: 'HAND',
    queued: false,
    expectedText:
      '【常时】打出此卡时，可以将存在于自己的舞台的2名名称互不相同的『Printemps』的成员变为待机状态。如此做时，此卡的费用减少2。',
  },
  {
    base: 'PL!-pb2-012',
    abilityId: 'PL!-pb2-012:activated-wait-self-additional-cost-recover-printemps-live',
    category: 'ACTIVATED',
    sourceZone: 'STAGE_MEMBER',
    queued: false,
    expectedText:
      '【起动】【1回合1次】将此成员变为待机状态：作为起动此能力的追加费用，将2张手牌放置入休息室，或将2名『Printemps』的成员变为待机状态。从自己的休息室将1张『Printemps』的LIVE卡加入手牌。',
  },
  {
    base: 'PL!-pb2-013',
    abilityId: 'PL!-pb2-013:on-enter-reveal-four-all-lily-white-recover-live',
    category: 'ON_ENTER',
    sourceZone: 'PLAYED_MEMBER',
    queued: true,
    expectedText:
      '【登场】公开自己的卡组顶的4张卡片。那些卡片全部是『lily white』的卡片的场合，从公开的卡片中将1张『lily white』的LIVE卡加入手牌，其余的放置入休息室。',
  },
  {
    base: 'PL!-pb2-017',
    abilityId: 'PL!-pb2-017:on-enter-stack-four-printemps-members',
    category: 'ON_ENTER',
    sourceZone: 'PLAYED_MEMBER',
    queued: true,
    expectedText: '【登场】将存在于自己的休息室的4张『Printemps』的成员卡放置于此成员的下方。',
  },
  {
    base: 'PL!-pb2-017',
    abilityId: 'PL!-pb2-017:live-start-discard-below-repeat-member-state',
    category: 'LIVE_START',
    sourceZone: 'STAGE_MEMBER',
    queued: true,
    expectedText:
      '【LIVE开始时】可以将存在于此成员的下方的至多3张卡片放置入休息室。每有1张因此放置入休息室的卡片，将存在于自己的舞台的1名『Printemps』的成员变为活跃状态或变为待机状态。',
  },
  {
    base: 'PL!-pb2-018',
    abilityId: 'PL!-pb2-018:on-enter-activate-opponent-members-draw',
    category: 'ON_ENTER',
    sourceZone: 'PLAYED_MEMBER',
    queued: true,
    expectedText:
      '【登场】可以将至多3名存在于对方的舞台的待机状态的成员变为活跃状态。如此做时，每有1名因此变为活跃状态的成员，抽1张卡。',
  },
  {
    base: 'PL!-pb2-018',
    abilityId: 'PL!-pb2-018:on-enter-discard-three-different-bibi-wait-opponent',
    category: 'ON_ENTER',
    sourceZone: 'PLAYED_MEMBER',
    queued: true,
    expectedText:
      '【登场】/【LIVE开始时】可以将手牌的3张名称各不相同的『BiBi』的成员卡放置入休息室：自己的舞台上仅存在『BiBi』的成员的场合，将存在于对方的舞台的1名成员变为待机状态。',
  },
  {
    base: 'PL!-pb2-018',
    abilityId: 'PL!-pb2-018:live-start-discard-three-different-bibi-wait-opponent',
    category: 'LIVE_START',
    sourceZone: 'STAGE_MEMBER',
    queued: true,
    expectedText:
      '【登场】/【LIVE开始时】可以将手牌的3张名称各不相同的『BiBi』的成员卡放置入休息室：自己的舞台上仅存在『BiBi』的成员的场合，将存在于对方的舞台的1名成员变为待机状态。',
  },
  {
    base: 'PL!-pb2-038',
    abilityId: 'PL!-pb2-038:continuous-two-muse-non-stacking-live-score',
    category: 'CONTINUOUS',
    sourceZone: 'ANYWHERE',
    queued: false,
    expectedText:
      '【常时】此卡存在于自己的LIVE卡区或成功LIVE卡区，且自己的舞台上仅存在2名『μ’s』的成员的场合，LIVE的合计分数+1。此效果不会重复。',
  },
  {
    base: 'PL!-pb2-040',
    abilityId: 'PL!-pb2-040:live-start-printemps-activated-members-reduce-requirement',
    category: 'LIVE_START',
    sourceZone: 'LIVE_CARD',
    queued: true,
    expectedText:
      '【LIVE开始时】自己的舞台上，存在大于等于1名此回合中因自己的『Printemps』的卡片的效果从待机状态变为活跃状态的成员的场合，此卡的需求HEART减少[無ハート][無ハート][無ハート]。存在大于等于2名的场合，再减少[無ハート][無ハート]。存在大于等于3名的场合，再减少[無ハート]。',
  },
  {
    base: 'PL!-pb2-041',
    abilityId: 'PL!-pb2-041:continuous-success-counts-as-two-for-lily-white',
    category: 'CONTINUOUS',
    sourceZone: 'SUCCESS_LIVE_CARD',
    queued: false,
    expectedText:
      '【常时】只要此卡存在于自己的成功LIVE卡区，因自己的『lily white』的卡片，计算存在于自己的成功LIVE卡区的卡片的张数时，此卡当作2张计算。',
  },
  {
    base: 'PL!-pb2-041',
    abilityId: 'PL!-pb2-041:live-start-two-lily-white-success-score',
    category: 'LIVE_START',
    sourceZone: 'LIVE_CARD',
    queued: true,
    expectedText:
      '【LIVE开始时】存在于自己的成功LIVE卡区的『lily white』的卡片大于等于2张的场合，此卡的分数+1。',
  },
] as const;

describe('PL pb2 final batch definitions and complete player text', () => {
  it.each(cases)('$abilityId covers every rarity with its full ability paragraph', (sample) => {
    for (const rarity of ['P+', 'L', 'R', 'UNSEEN']) {
      const matches = getCardAbilityDefinitionsForCardCode(`${sample.base}-${rarity}`).filter(
        (definition) => definition.abilityId === sample.abilityId
      );
      expect(matches).toHaveLength(1);
      const definition = matches[0]!;
      expect(definition).toMatchObject({
        baseCardCodes: [sample.base],
        category: sample.category,
        sourceZone: sample.sourceZone,
        queued: sample.queued,
        implemented: true,
      });
      expect(definition.cardCodes).toBeUndefined();
      expect(definition.effectText).toBe(sample.expectedText);
      expect(definition.triggerCondition).toBe(
        sample.category === 'ON_ENTER'
          ? 'ON_ENTER_STAGE'
          : sample.category === 'LIVE_START'
            ? 'ON_LIVE_START'
            : undefined
      );
      if (sample.category === 'ACTIVATED') {
        expect(definition.activatedUi?.text).toBe(sample.expectedText);
        expect(definition.perTurnLimit).toBe(1);
        expect(definition.requiredSourceOrientation).toBe('ACTIVE');
      }
    }
  });

  it.each([
    ['012', 2],
    ['013', 1],
    ['017', 2],
    ['018', 3],
    ['038', 1],
    ['040', 1],
    ['041', 2],
  ] as const)('%s keeps every independent ability separate', (number, count) => {
    const definitions = getCardAbilityDefinitionsForCardCode(`PL!-pb2-${number}-UNSEEN`);
    expect(definitions).toHaveLength(count);
    expect(new Set(definitions.map((definition) => definition.abilityId)).size).toBe(count);
  });

  it('registers 037 after the authoritative export resolves its LIVE identity', () => {
    expect(getCardAbilityDefinitionsForCardCode('PL!-pb2-037-L')).toMatchObject([
      { category: 'LIVE_SUCCESS', sourceZone: 'LIVE_CARD', implemented: true },
    ]);
  });

  it('012 activated UI directly reuses the definition text constant', () => {
    const file = ts.createSourceFile(
      'definitions.ts',
      readFileSync('src/application/card-effects/definitions/index.ts', 'utf8'),
      ts.ScriptTarget.Latest,
      true
    );
    const objects: ts.ObjectLiteralExpression[] = [];
    const visit = (node: ts.Node) => {
      if (ts.isObjectLiteralExpression(node)) objects.push(node);
      ts.forEachChild(node, visit);
    };
    visit(file);
    const property = (node: ts.ObjectLiteralExpression, name: string) =>
      node.properties.find(
        (p): p is ts.PropertyAssignment =>
          ts.isPropertyAssignment(p) && p.name.getText(file) === name
      )?.initializer;
    const definition = objects.find(
      (node) =>
        property(node, 'baseCardCodes')?.getText(file).includes('PL!-pb2-012') &&
        property(node, 'activatedUi')
    )!;
    const text = property(definition, 'effectText')!;
    const uiText = property(
      property(definition, 'activatedUi') as ts.ObjectLiteralExpression,
      'text'
    )!;
    expect(ts.isIdentifier(text)).toBe(true);
    expect(ts.isIdentifier(uiText)).toBe(true);
    expect(uiText.getText(file)).toBe(text.getText(file));
  });
});
