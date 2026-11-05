import { describe, expect, it } from 'vitest';
import {
  HS_BP8_016_LIVE_SUCCESS_DISCARD_TWO_RECOVER_LOW_SCORE_HASUNOSORA_LIVE_ABILITY_ID,
  HS_BP8_021_LIVE_START_RETURN_MIRACRA_MEMBER_PLAY_SAME_COST_ABILITY_ID,
  PL_BP8_020_LIVE_START_ACTIVATE_KOTORI_WAIT_OPPONENT_ABILITY_ID,
} from '../../src/application/card-effects/ability-ids';
import {
  CardAbilityCategory,
  CardAbilitySourceZone,
} from '../../src/application/card-effects/ability-definition-types';
import {
  getCardAbilityDefinitionsForCardCode,
  getImplementedQueuedAbilityDefinitionsForCardCode,
} from '../../src/application/card-effects/definitions/lookup';
import { TriggerCondition } from '../../src/shared/types/enums';
import { getNovember04DraftRow } from '../helpers/november-04-draft-effects';

// Literal expectations transcribed from the November 04 export.
const cards = [
  {
    base: 'PL!-bp8-020',
    rare: 'L',
    otherRare: 'SECL',
    abilityId: PL_BP8_020_LIVE_START_ACTIVATE_KOTORI_WAIT_OPPONENT_ABILITY_ID,
    category: CardAbilityCategory.LIVE_START,
    sourceZone: CardAbilitySourceZone.LIVE_CARD,
    triggerCondition: TriggerCondition.ON_LIVE_START,
    effectText:
      '【LIVE开始时】将存在于自己的舞台的１名待机状态的「南琴梨（南小鸟）」变为活跃状态。如此做时，将存在于对方的舞台的１名费用小于等于４的成员变为待机状态。',
  },
  {
    base: 'PL!HS-bp8-016',
    rare: 'N',
    otherRare: 'P',
    abilityId: HS_BP8_016_LIVE_SUCCESS_DISCARD_TWO_RECOVER_LOW_SCORE_HASUNOSORA_LIVE_ABILITY_ID,
    category: CardAbilityCategory.LIVE_SUCCESS,
    sourceZone: CardAbilitySourceZone.STAGE_MEMBER,
    triggerCondition: TriggerCondition.ON_LIVE_SUCCESS,
    effectText:
      '【LIVE成功时】可以将２张手牌放置入休息室：从自己的休息室将１张分数小于等于３的『莲之空』的LIVE卡加入手牌。',
  },
  {
    base: 'PL!HS-bp8-021',
    rare: 'SECL',
    otherRare: 'L',
    abilityId: HS_BP8_021_LIVE_START_RETURN_MIRACRA_MEMBER_PLAY_SAME_COST_ABILITY_ID,
    category: CardAbilityCategory.LIVE_START,
    sourceZone: CardAbilitySourceZone.LIVE_CARD,
    triggerCondition: TriggerCondition.ON_LIVE_START,
    effectText:
      '【LIVE开始时】可以将存在于自己的舞台的１名『Mira-Cra Park!』的成员放回手牌。如此做时，从自己的手牌，将１张与因此放回手牌的成员持有相同费用的『Mira-Cra Park!』的成员卡，登场至自己的舞台上不存在成员的区域。因此登场的成员的【登场】能力不会发动。',
  },
] as const;

describe('November 04 card definitions', () => {
  it.each(cards)('registers $base at its printed timing for all rarities', (card) => {
    const { base, rare, otherRare, abilityId, category, sourceZone, triggerCondition, effectText } =
      card;
    expect(getNovember04DraftRow(base)).toMatchObject({
      rare,
      status: 'DRAFT',
      cardTextCn: effectText,
    });
    for (const cardCode of [base, base + '-' + rare, base + '-' + otherRare]) {
      const definitions = getCardAbilityDefinitionsForCardCode(cardCode);
      expect(definitions).toEqual([
        expect.objectContaining({
          abilityId,
          baseCardCodes: [base],
          category,
          sourceZone,
          triggerCondition,
          queued: true,
          implemented: true,
          effectText,
        }),
      ]);
      expect(
        getImplementedQueuedAbilityDefinitionsForCardCode(cardCode, {
          category,
          sourceZone,
          triggerCondition,
        })
      ).toEqual(definitions);
    }
  });
});
