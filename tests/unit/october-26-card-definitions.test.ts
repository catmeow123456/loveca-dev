import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import {
  CardAbilityCategory,
  CardAbilitySourceZone,
} from '../../src/application/card-effects/ability-definition-types';
import { getCardAbilityDefinitionsForCardCode } from '../../src/application/card-effects/definitions/lookup';
import { VALID_RARITIES } from '../../src/shared/utils/card-code';
import sourceRows from '../fixtures/october-26-card-effects.json';
import { getOctober26CardData } from '../helpers/october-26-card-effects';

const CASES = [
  ['PL!-bp8-004-P', ['ACTIVATED']],
  ['PL!-bp8-006-P', ['ACTIVATED']],
  ['PL!-bp8-010-N', ['ACTIVATED']],
  ['PL!-bp8-018-N', ['LIVE_START']],
  ['PL!HS-bp8-014-N', ['ON_ENTER', 'AUTO']],
  ['PL!N-bp8-006-R', ['ON_ENTER']],
  ['PL!N-bp8-012-R', ['LIVE_SUCCESS']],
  ['PL!N-bp8-018-N', ['LIVE_START']],
  ['PL!N-bp8-031-SECL', ['LIVE_SUCCESS']],
  ['PL!S-cl1-013-CL', ['LIVE_START']],
] as const;

describe('October 26 authorized ten cards and eleven ability paragraphs', () => {
  it.each(CASES)(
    '%s preserves complete paragraphs, timing and every rarity',
    (cardCode, categories) => {
      const row = sourceRows[cardCode];
      const base = cardCode.replace(/-[^-]+$/, '');
      const paragraphs = row.cardTextCn
        .replace(/\r\n?/g, '\n')
        .split(/\n\s*\n/)
        .map((text) => text.trim());
      const definitions = getCardAbilityDefinitionsForCardCode(cardCode);
      expect(definitions.map(({ category }) => category)).toEqual(categories);
      expect(definitions.map(({ effectText }) => effectText)).toEqual(paragraphs);
      for (const rarity of VALID_RARITIES) {
        const variants = getCardAbilityDefinitionsForCardCode(`${base}-${rarity}`);
        expect(variants.map(({ abilityId }) => abilityId)).toEqual(
          definitions.map(({ abilityId }) => abilityId)
        );
        variants.forEach((definition, index) => {
          expect(definition.baseCardCodes).toEqual([base]);
          expect(definition.cardCodes).toBeUndefined();
          expect(definition.implemented).toBe(true);
          expect(definition.effectText).toBe(paragraphs[index]);
          expect(definition.queued).toBe(definition.category !== CardAbilityCategory.ACTIVATED);
          if (definition.category === CardAbilityCategory.ACTIVATED) {
            expect(definition.activatedUi?.text).toBe(paragraphs[index]);
            expect(definition.activatedUi?.abilityId).toBe(definition.abilityId);
          }
        });
      }
    }
  );

  it('has eleven distinct abilities, three activated UI paragraphs and the correct waiting-room source', () => {
    const definitions = CASES.flatMap(([cardCode]) =>
      getCardAbilityDefinitionsForCardCode(cardCode)
    );
    expect(definitions).toHaveLength(11);
    expect(new Set(definitions.map(({ abilityId }) => abilityId)).size).toBe(11);
    expect(definitions.filter(({ activatedUi }) => activatedUi)).toHaveLength(3);
    const maki = getCardAbilityDefinitionsForCardCode('PL!-bp8-006-P')[0]!;
    expect(maki.sourceZone).toBe(CardAbilitySourceZone.WAITING_ROOM);
    expect(maki.perTurnLimit).toBeUndefined();
    for (const code of ['PL!-bp8-004-P', 'PL!-bp8-010-N']) {
      expect(getCardAbilityDefinitionsForCardCode(code)[0]).toMatchObject({
        sourceZone: CardAbilitySourceZone.STAGE_MEMBER,
        perTurnLimit: 1,
      });
    }
  });

  it('references the same source constant in each activated definition and its UI', () => {
    const file = ts.createSourceFile(
      'definitions.ts',
      readFileSync(
        new URL('../../src/application/card-effects/definitions/index.ts', import.meta.url),
        'utf8'
      ),
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS
    );
    const activatedBases = new Set(['PL!-bp8-004', 'PL!-bp8-006', 'PL!-bp8-010']);
    const checked: string[] = [];
    const property = (object: ts.ObjectLiteralExpression, key: string) =>
      object.properties.find(
        (entry): entry is ts.PropertyAssignment =>
          ts.isPropertyAssignment(entry) && entry.name.getText(file) === key
      )?.initializer;
    const visit = (node: ts.Node) => {
      if (ts.isObjectLiteralExpression(node)) {
        const bases = property(node, 'baseCardCodes');
        const selected =
          bases && ts.isArrayLiteralExpression(bases)
            ? bases.elements.find(
                (value): value is ts.StringLiteral =>
                  ts.isStringLiteral(value) && activatedBases.has(value.text)
              )
            : undefined;
        if (selected) {
          const text = property(node, 'effectText');
          const ui = property(node, 'activatedUi');
          expect(text && ts.isIdentifier(text)).toBe(true);
          expect(ui && ts.isObjectLiteralExpression(ui)).toBe(true);
          if (text && ui && ts.isObjectLiteralExpression(ui)) {
            const uiText = property(ui, 'text');
            expect(uiText && ts.isIdentifier(uiText)).toBe(true);
            expect(uiText?.getText(file)).toBe(text.getText(file));
          }
          checked.push(selected.text);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(file);
    expect(checked.sort()).toEqual([...activatedBases].sort());
  });

  it('keeps the original data diagnostic separate from the WBNW rules fields', () => {
    const card = getOctober26CardData('PL!S-cl1-013-CL');
    expect(card.sourceFlags?.parseWarnings).toEqual(
      sourceRows['PL!S-cl1-013-CL'].sourceFlags.parseWarnings
    );
    expect(card.bladeHearts).toEqual([
      { effect: 'HEART', heartColor: 'GRAY' },
      { effect: 'HEART', heartColor: 'GRAY' },
    ]);
  });
});
