import { describe, expect, it } from 'vitest';
import {
  N_BP7_001_AUTO_TURN_ONCE_ENERGY_PLACED_BELOW_PLACE_WAITING_ENERGY_ABILITY_ID,
  N_BP7_010_ACTIVATED_STACK_ENERGY_PLAY_LOW_COST_NIJIGASAKI_FROM_WAITING_ABILITY_ID,
  SP_BP7_009_CONTINUOUS_SIDE_RED_HEART_ABILITY_ID,
  SP_BP7_009_LIVE_START_WAIT_LOW_PRINTED_BLADE_OPPONENT_ABILITY_ID,
} from '../../src/application/card-effects/ability-ids';
import {
  CardAbilityCategory,
  CardAbilitySourceZone,
} from '../../src/application/card-effects/ability-definition-types';
import { getCardAbilityDefinitionsForCardCode } from '../../src/application/card-effects/definitions/lookup';
import { getActivatedAbilityUiConfig } from '../../src/application/card-effects/runtime/activated-ability-ui';
import { SlotPosition, TriggerCondition } from '../../src/shared/types/enums';

const N001_TEXT =
  '【自动】【1回合1次】存在于自己的能量区的能量被放置于成员的下方时，从自己的能量卡组，将1张能量以待机状态放置到能量区。';
const N010_TEXT =
  '【起动】【1回合1次】将存在于能量区的1张能量放置于此成员的下方：从自己的休息室将1张费用小于等于2的『虹咲』的成员卡，以待机状态登场至不存在成员的区域。（因此效果登场了的成员所在的区域，此回合不能登场成员。）';
const SP009_CONTINUOUS_TEXT = '【常时】【左侧】【右侧】获得[赤ハート]。';
const SP009_LIVE_START_TEXT =
  '【LIVE开始时】【中央】将存在于对方的舞台的1名原本持有的[ブレード]的数量小于等于2的成员变为待机状态。';

describe('2026-07-27 API-only BP7 definitions', () => {
  it('registers Ayumu AUTO by base code with exact PUBLISHED card text', () => {
    expect(getCardAbilityDefinitionsForCardCode('PL!N-bp7-001-P')).toEqual([
      expect.objectContaining({
        abilityId:
          N_BP7_001_AUTO_TURN_ONCE_ENERGY_PLACED_BELOW_PLACE_WAITING_ENERGY_ABILITY_ID,
        baseCardCodes: ['PL!N-bp7-001'],
        category: CardAbilityCategory.AUTO,
        sourceZone: CardAbilitySourceZone.STAGE_MEMBER,
        triggerCondition: TriggerCondition.ON_ENERGY_PLACED_BELOW_MEMBER,
        queued: true,
        implemented: true,
        perTurnLimit: 1,
        skipQueueWhenTurnLimitReached: true,
        effectText: N001_TEXT,
      }),
    ]);
    expect(getCardAbilityDefinitionsForCardCode('PL!N-bp7-001-UNSEEN')).toHaveLength(1);
  });

  it('registers Shioriko ACTIVATED UI with one shared exact card-text source', () => {
    expect(getCardAbilityDefinitionsForCardCode('PL!N-bp7-010-P')).toEqual([
      expect.objectContaining({
        abilityId:
          N_BP7_010_ACTIVATED_STACK_ENERGY_PLAY_LOW_COST_NIJIGASAKI_FROM_WAITING_ABILITY_ID,
        baseCardCodes: ['PL!N-bp7-010'],
        category: CardAbilityCategory.ACTIVATED,
        sourceZone: CardAbilitySourceZone.STAGE_MEMBER,
        queued: false,
        implemented: true,
        perTurnLimit: 1,
        effectText: N010_TEXT,
        activatedUi: {
          abilityId:
            N_BP7_010_ACTIVATED_STACK_ENERGY_PLAY_LOW_COST_NIJIGASAKI_FROM_WAITING_ABILITY_ID,
          title: '放置能量并从休息室登场成员',
          text: N010_TEXT,
        },
      }),
    ]);
    expect(getActivatedAbilityUiConfig('PL!N-bp7-010-P')).toEqual({
      abilityId:
        N_BP7_010_ACTIVATED_STACK_ENERGY_PLAY_LOW_COST_NIJIGASAKI_FROM_WAITING_ABILITY_ID,
      title: '放置能量并从休息室登场成员',
      text: N010_TEXT,
      requiredSourceOrientation: undefined,
    });
    expect(getCardAbilityDefinitionsForCardCode('PL!N-bp7-010-UNSEEN')).toHaveLength(1);
  });

  it('registers both Natsumi segments with their printed slot restrictions and exact text', () => {
    expect(getCardAbilityDefinitionsForCardCode('PL!SP-bp7-009-P')).toEqual([
      expect.objectContaining({
        abilityId: SP_BP7_009_CONTINUOUS_SIDE_RED_HEART_ABILITY_ID,
        baseCardCodes: ['PL!SP-bp7-009'],
        category: CardAbilityCategory.CONTINUOUS,
        sourceZone: CardAbilitySourceZone.STAGE_MEMBER,
        requiredSourceSlots: [SlotPosition.LEFT, SlotPosition.RIGHT],
        queued: false,
        implemented: true,
        effectText: SP009_CONTINUOUS_TEXT,
      }),
      expect.objectContaining({
        abilityId: SP_BP7_009_LIVE_START_WAIT_LOW_PRINTED_BLADE_OPPONENT_ABILITY_ID,
        baseCardCodes: ['PL!SP-bp7-009'],
        category: CardAbilityCategory.LIVE_START,
        sourceZone: CardAbilitySourceZone.STAGE_MEMBER,
        triggerCondition: TriggerCondition.ON_LIVE_START,
        requiredSourceSlots: [SlotPosition.CENTER],
        queued: true,
        implemented: true,
        effectText: SP009_LIVE_START_TEXT,
      }),
    ]);
    expect(getCardAbilityDefinitionsForCardCode('PL!SP-bp7-009-UNSEEN')).toHaveLength(2);
  });
});
