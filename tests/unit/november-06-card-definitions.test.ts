import { describe, expect, it } from 'vitest';
import {
  HS_BP8_018_AUTO_REVEALED_CHEER_MOVED_SOURCE_SCORE_ABILITY_ID,
  N_BP8_008_ACTIVATED_REVEAL_SELF_HAND_BOTTOM_WAIT_OPPONENT_ABILITY_ID,
} from '../../src/application/card-effects/ability-ids';
import {
  CardAbilityCategory,
  CardAbilitySourceZone,
} from '../../src/application/card-effects/ability-definition-types';
import {
  getCardAbilityDefinitionsForCardCode,
  getImplementedQueuedAbilityDefinitionsForCardCode,
} from '../../src/application/card-effects/definitions/lookup';
import { getActivatedAbilityUiConfigs } from '../../src/application/card-effects/runtime/activated-ability-ui';
import { CardType, TriggerCondition } from '../../src/shared/types/enums';
import { VALID_RARITIES } from '../../src/shared/utils/card-code';
import {
  getNovember06DraftRow,
  getNovember06LiveData,
  getNovember06MemberData,
} from '../helpers/november-06-draft-effects';

const EMMA_BASE = 'PL!N-bp8-008';
const HOLIDAY_BASE = 'PL!HS-bp8-018';
const rarities = new Set([
  ...VALID_RARITIES,
  ...VALID_RARITIES.map((rare) => rare.replaceAll('+', '＋')),
]);

describe('November 06 card definitions', () => {
  it('registers Emma’s complete hand-activated ability and menu text for every print', () => {
    const printed = getNovember06DraftRow(EMMA_BASE);
    expect(printed).toMatchObject({
      cardCode: 'PL!N-bp8-008-P',
      cardType: CardType.MEMBER,
      nameCn: '艾玛·维尔德',
      cost: 13,
      status: 'DRAFT',
      cardTextJp:
        '【起動】このカードを手札から公開する：このカードをデッキの一番下に置く。その後、自分のステージに『虹ヶ咲』のメンバーがいる場合、相手のステージにいるコスト２以下のメンバー１人をウェイトにする。この能力は、このカードが手札にある場合のみ起動できる。',
    });
    const effectText = printed.cardTextCn;
    expect(getNovember06MemberData(EMMA_BASE)).toMatchObject({
      cardTextCn: effectText,
      cardTextJp: printed.cardTextJp,
    });
    const abilityId = N_BP8_008_ACTIVATED_REVEAL_SELF_HAND_BOTTOM_WAIT_OPPONENT_ABILITY_ID;
    for (const cardCode of [EMMA_BASE, ...Array.from(rarities, (rare) => `${EMMA_BASE}-${rare}`)]) {
      const definitions = getCardAbilityDefinitionsForCardCode(cardCode);
      expect(definitions, cardCode).toEqual([
        expect.objectContaining({
          abilityId,
          baseCardCodes: [EMMA_BASE],
          category: CardAbilityCategory.ACTIVATED,
          sourceZone: CardAbilitySourceZone.HAND,
          queued: false,
          implemented: true,
          effectText,
          activatedUi: expect.objectContaining({ abilityId, text: effectText }),
        }),
      ]);
      expect(definitions[0]?.triggerCondition).toBeUndefined();
      expect(definitions[0]?.perTurnLimit).toBeUndefined();
      expect(getActivatedAbilityUiConfigs(cardCode, CardAbilitySourceZone.HAND), cardCode).toEqual([
        expect.objectContaining({ abilityId, text: effectText }),
      ]);
      expect(getActivatedAbilityUiConfigs(cardCode, CardAbilitySourceZone.STAGE_MEMBER)).toEqual(
        []
      );
    }
  });

  it('registers Holiday’s complete once-per-turn automatic LIVE ability for every print', () => {
    const printed = getNovember06DraftRow(HOLIDAY_BASE);
    expect(printed).toMatchObject({
      cardCode: 'PL!HS-bp8-018-SECL',
      cardType: CardType.LIVE,
      nameCn: 'Holiday∞Holiday',
      score: 3,
      status: 'DRAFT',
      cardTextJp:
        '【自動】【ターン１回】エールによって公開された自分のカードが、自分のカードの効果によっていずれかの領域に移動したとき、このカードのスコアを＋１する。',
    });
    const effectText = printed.cardTextCn;
    expect(getNovember06LiveData(HOLIDAY_BASE)).toMatchObject({
      cardTextCn: effectText,
      cardTextJp: printed.cardTextJp,
    });
    const timing = {
      category: CardAbilityCategory.AUTO,
      sourceZone: CardAbilitySourceZone.LIVE_CARD,
      triggerCondition: TriggerCondition.ON_REVEALED_CHEER_CARDS_MOVED,
    };
    for (const cardCode of [
      HOLIDAY_BASE,
      ...Array.from(rarities, (rare) => `${HOLIDAY_BASE}-${rare}`),
    ]) {
      const definitions = getCardAbilityDefinitionsForCardCode(cardCode);
      expect(definitions, cardCode).toEqual([
        expect.objectContaining({
          abilityId: HS_BP8_018_AUTO_REVEALED_CHEER_MOVED_SOURCE_SCORE_ABILITY_ID,
          baseCardCodes: [HOLIDAY_BASE],
          ...timing,
          queued: true,
          implemented: true,
          perTurnLimit: 1,
          skipQueueWhenTurnLimitReached: true,
          effectText,
        }),
      ]);
      expect(getImplementedQueuedAbilityDefinitionsForCardCode(cardCode, timing), cardCode).toEqual(
        definitions
      );
      expect(definitions[0]?.activatedUi).toBeUndefined();
    }
  });
});
