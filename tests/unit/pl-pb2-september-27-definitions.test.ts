import { describe, expect, it } from 'vitest';
import { getCardAbilityDefinitionsForCardCode } from '../../src/application/card-effects/definitions/lookup';

// Independent complete text from the authorized cards_export_2026-09-27.json.
const cases = [
  {
    base: 'PL!-pb2-024',
    printed: 'PL!-pb2-024-N',
    text: '【LIVE开始时】自己的舞台上仅存在『BiBi』的成员的场合，将存在于对方的舞台的1名费用小于等于2的成员变为待机状态。',
    category: 'LIVE_START',
  },
  {
    base: 'PL!-pb2-027',
    printed: 'PL!-pb2-027-N',
    text: '【起动】将此成员从舞台放置入休息室：从自己的休息室将1张成员卡加入手牌。',
    category: 'ACTIVATED',
  },
  {
    base: 'PL!-pb2-028',
    printed: 'PL!-pb2-028-N',
    text: '【LIVE开始时】可以将此成员变为待机状态：LIVE结束时为止，获得[黄ハート]。（待机状态的成员持有的[ブレード]，不会使因声援公开的张数增加。）',
    category: 'LIVE_START',
  },
  {
    base: 'PL!-pb2-031',
    printed: 'PL!-pb2-031-N',
    text: '【LIVE开始时】可以将手牌的1张『μ’s』的卡片放置入休息室：LIVE结束时为止，获得[紫ハート]。',
    category: 'LIVE_START',
  },
  {
    base: 'PL!-pb2-032',
    printed: 'PL!-pb2-032-N',
    text: '【登场】将1张手牌放置入休息室：检视自己的卡组顶的5张卡片。可以将其中的1张不持有BLADE HEART的『μ’s』的成员卡公开并加入手牌。其余的放置入休息室。',
    category: 'ON_ENTER',
  },
  {
    base: 'PL!-pb2-035',
    printed: 'PL!-pb2-035-N',
    text: '【起动】将此成员从舞台放置入休息室：从自己的休息室将1张LIVE卡加入手牌。',
    category: 'ACTIVATED',
  },
  {
    base: 'PL!-pb2-037',
    printed: 'PL!-pb2-037-L',
    text: '【LIVE成功时】因声援被公开的自己的成员卡全部为『Printemps』，或全部为『lily white』，或全部为『BiBi』的场合，从因声援被公开的自己的卡片中将1张成员卡加入手牌。',
    category: 'LIVE_SUCCESS',
  },
] as const;

describe('PL!-pb2 September 27 remaining ability definitions', () => {
  it.each(cases)(
    '$base covers printed and future rarities with complete text',
    ({ base, printed, text, category }) => {
      for (const code of [printed, `${base}-SEC`, `${base}-FUTURE`]) {
        const definitions = getCardAbilityDefinitionsForCardCode(code);
        expect(definitions).toHaveLength(1);
        const definition = definitions[0]!;
        expect(definition).toMatchObject({ category, implemented: true, effectText: text });
        expect(definition).toMatchObject({
          sourceZone:
            category === 'LIVE_SUCCESS'
              ? 'LIVE_CARD'
              : category === 'ON_ENTER'
                ? 'PLAYED_MEMBER'
                : 'STAGE_MEMBER',
          queued: category !== 'ACTIVATED',
        });
        expect(definition.triggerCondition).toBe(
          category === 'ACTIVATED'
            ? undefined
            : category === 'LIVE_SUCCESS'
              ? 'ON_LIVE_SUCCESS'
              : category === 'ON_ENTER'
                ? 'ON_ENTER_STAGE'
                : 'ON_LIVE_START'
        );
        expect(definition.baseCardCodes).toContain(base);
        expect(definition.cardCodes).toBeUndefined();
        if (category === 'ACTIVATED') expect(definition.activatedUi?.text).toBe(text);
      }
    }
  );
});
