import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { CARD_ABILITY_DEFINITIONS } from '../../src/application/card-effects/definitions/index.js';
import { getCardAbilityDefinitionsForCardCode } from '../../src/application/card-effects/definitions/lookup.js';

const EXACT_ACTIVATED_CARD_TEXT_CASES = [
  {
    cardCode: 'PL!-bp3-001-P',
    abilityId: 'PL!-bp3-001:activated-wait-self-draw-one-discard-one',
    expected:
      '【起动】【1回合1次】将此成员变为待机状态：抽1张卡，将1张手牌放置入休息室。(待机状态的成员持有的[ブレード]，不会使因声援公开的张数增加。)',
  },
  {
    cardCode: 'PL!-bp3-009-P',
    abilityId: 'PL!-bp3-009:activated-wait-self-choose-heart',
    expected:
      '【起动】【1回合1次】将此成员变为待机状态：选择[桃ハート]或[黄ハート]或[紫ハート]中的1种。LIVE结束时为止，获得1个选择了的HEART。',
  },
  {
    cardCode: 'PL!-bp4-002-P',
    abilityId: 'PL!-bp4-002:activated-discard-two-recover-muse-live-if-success-score',
    expected:
      "【起动】【1回合1次】将2张手牌放置入休息室：从自己的休息室将1张『μ's』的LIVE卡加入手牌。此能力仅可在存在于自己的成功LIVE卡区的卡片的分数合计大于等于6的场合起动。",
  },
  {
    cardCode: 'PL!-bp5-003-AR',
    abilityId: 'PL!-bp5-003:activated-pay-two-energy-discard-branch',
    expected:
      "【起动】【1回合1次】[E][E]将1张手牌放置入休息室：因此放置入休息室的卡片为『μ's』的卡片的场合，检视自己卡组顶的4张卡。从其中将2张卡片加入手牌。其余的卡片放置入休息室。『μ's』的卡片以外的场合，从自己的休息室将1张LIVE卡加入手牌。",
  },
  {
    cardCode: 'PL!-bp5-004-AR',
    abilityId: 'PL!-bp5-004:activated-stage-group-dynamic-cost-wait-opponent-cost-ten',
    expected:
      '【起动】[E][E][E][E]：将存在于对方的舞台的1名费用小于等于10的成员变为待机状态。每有1种存在于自己的舞台的成员中持有的团体名，发动此能力所需的费用减少[E]。',
  },
  {
    cardCode: 'PL!-bp5-009-AR',
    abilityId: 'PL!-bp5-009:activated-discard-two-recover-purple-requirement-live',
    expected:
      '【起动】【1回合1次】将2张手牌放置入休息室：从自己的休息室将1张必要HEART中含有大于等于3个[紫ハート]的LIVE卡加入手牌。',
  },
  {
    cardCode: 'PL!-bp5-111-P+',
    abilityId: 'PL!-bp5-111:activated-discard-activate-waiting-member-recover-live',
    expected:
      '【起动】【1回合1次】将1张手牌放置入休息室：将1名待机状态的成员变为活跃状态。因此将存在于对方舞台的成员变为活跃状态的场合，从自己的休息室将1张LIVE卡加入手牌。',
  },
  {
    cardCode: 'PL!-bp6-006-P',
    abilityId: 'PL!-bp6-006:activated-discard-choose-color-reveal-five-muse-hand-blade',
    expected:
      '【起动】【1回合1次】将1张手牌放置入休息室：指定1个任意HEART的颜色。此后，公开自己的卡组顶的5张卡片。因此被公开的卡片中包含持有指定颜色HEART的成员卡和必要HEART包含指定颜色HEART的LIVE卡合计5张的场合，从中将1张『μ’s』的卡片加入手牌，LIVE结束时为止，获得[ブレード][ブレード][ブレード]。被公开的其余卡牌放置入休息室。',
  },
  {
    cardCode: 'PL!-bp6-008-P',
    abilityId: 'PL!-bp6-008:activated-wait-self-activate-other-member',
    expected:
      '【起动】【1回合1次】将此成员变为待机状态：将存在于自己的舞台的1名其他成员变为活跃状态。',
  },
  {
    cardCode: 'PL!-bp6-010-N',
    abilityId: 'PL!-bp6-010:activated-send-self-wait-opponent-cost-lte-four-member',
    expected:
      '【起动】将此成员放置入休息室：将存在于对方舞台的1名费用小于等于4的成员变为待机状态。',
  },
  {
    cardCode: 'PL!-pb1-001-P+',
    abilityId: 'PL!-pb1-001:activated-wait-self-discard-reveal-until-chosen',
    expected:
      '【起动】【中央】【1回合1次】将此成员变为待机状态，将1张手牌放置入休息室：选择LIVE卡或费用大于等于10的成员卡其中1项。直到选择了的卡被公开为止，依次公开1张自己卡组顶的卡。将该卡加入手牌，将因此效果被公开的其他所有卡放置入休息室。',
  },
  {
    cardCode: 'PL!-pb1-013-P+',
    abilityId: 'PL!-pb1-013:activated-pay-two-energy-reveal-hand-live-score',
    expected:
      '【起动】【1回合1次】[E][E]：对手在不查看的情况下，从自己的手牌中选出1张并公开。因此被公开的卡片为LIVE卡的场合，LIVE结束时为止，此成员获得「【常时】LIVE的合计分数+1。」。',
  },
  {
    cardCode: 'PL!-PR-017-PR',
    abilityId: 'PL!-PR-017-PR:activated-send-self-recover-muse-live-activate-energy',
    expected:
      "【起动】将此成员从舞台放置入休息室：从自己的休息室将1张『μ's』的LIVE卡加入手牌。自己的成功LIVE卡区中的卡片的分数合计大于等于9的场合，将2张能量变为活跃状态。",
  },
  {
    cardCode: 'PL!-sd1-008-SD',
    abilityId: 'PL!-sd1-008-SD:activated-pay-two-mill-ten',
    expected: '【起动】【1回合1次】[E][E]：将自己卡组顶的10张卡放置入休息室。',
  },
  {
    cardCode: 'PL!HS-bp1-003-P',
    abilityId: 'PL!HS-bp1-003-SEC:activated-pay-one-recover-low-cost-hasunosora-member',
    expected:
      '【起动】【1回合1次】[E]：从自己的休息室将1张费用小于等于4的『莲之空』的成员卡加入手牌。',
  },
  {
    cardCode: 'PL!HS-bp2-001-P',
    abilityId: 'PL!HS-bp2-001:activated-pay-two-energy-recover-low-score-hasunosora-live',
    expected:
      '【起动】【1回合1次】[E][E]：从自己的休息室将1张费用小于等于3的『莲之空』的LIVE卡加入手牌。',
  },
  {
    cardCode: 'PL!HS-bp5-001-AR',
    abilityId: 'PL!HS-bp5-001-SEC:activated-pay-two-reveal-hand-live-recover-same-name-live',
    expected:
      '【起动】【1回合1次】[E][E]公开1张手牌的LIVE卡：从自己的休息室，将1张包含所有因此公开的卡的卡名的LIVE卡加入手牌。',
  },
  {
    cardCode: 'PL!HS-bp5-002-AR',
    abilityId: 'PL!HS-bp5-002:activated-pay-two-energy-play-low-cost-member',
    expected:
      '【起动】【1回合1次】[E][E]：从自己的休息室将1张费用小于等于2的成员卡，登场至不存在成员的区域。',
  },
  {
    cardCode: 'PL!HS-bp6-014-R',
    abilityId: 'PL!HS-bp6-014-R:activated-hand-discard-self-draw-target-megu-rurino-blade',
    expected:
      '【起动】将此卡从手牌放置入休息室：抽1张卡，LIVE结束时为止，存在于自己的舞台的「藤岛慈」或「大泽瑠璃乃」的其中1人获得[ブレード]。此能力仅可在此卡存在于手牌的场合起动。',
  },
  {
    cardCode: 'PL!HS-bp6-016-R',
    abilityId:
      'PL!HS-bp6-016-R:activated-turn-once-pay-four-energy-play-low-cost-hasunosora-member',
    expected:
      '【起动】【1回合1次】[E][E][E][E]：从自己的休息室将1名费用小于等于4的『莲之空』的成员，登场到不存在成员的区域。',
  },
  {
    cardCode: 'PL!HS-cl1-003-CL',
    abilityId: 'PL!HS-cl1-003-CL:activated-wait-self-miracra-member-gain-blade',
    expected:
      '【起动】【1回合1次】将此成员变为待机状态：LIVE结束时为止，存在于自己的舞台上的1名『Mira-Cra Park!』的成员，获得[ブレード]。',
  },
  {
    cardCode: 'PL!HS-cl1-008-CL',
    abilityId: 'PL!HS-cl1-008-CL:activated-send-self-to-waiting-room-add-hasunosora-card',
    expected: '【起动】将此成员从舞台放置入休息室：从自己的休息室将1张『莲之空』的卡片加入手牌。',
  },
  {
    cardCode: 'PL!HS-pb1-002-P+',
    abilityId: 'PL!HS-pb1-002:activated-reveal-sayaka-member-stack-below',
    expected:
      '【起动】【1回合1次】公开1张手牌的「村野沙耶香」的成员卡：将因此公开的卡片放置入此成员下方。',
  },
  {
    cardCode: 'PL!N-bp3-007-P',
    abilityId: 'PL!N-bp3-007:activated-pay-two-send-self-play-setsuna-attach-energy',
    expected:
      '【起动】[E][E]将此成员从舞台放置入休息室：将1张自己的手牌中费用小于等于13的「优木雪菜」，登场至此成员曾存在的区域。之后，将1张存在于自己的能量区的能量放置于此成员下方。(被放置于成员下方的能量卡不能用来支付费用。成员离开舞台时，将被放置于成员下方的能量卡放置入能量卡组。)',
  },
  {
    cardCode: 'PL!N-bp4-008-P',
    abilityId: 'PL!N-bp4-008:activated-discard-activate-energy-or-nijigasaki-member',
    expected:
      '【起动】【1回合1次】将1张手牌放置入休息室：将1张能量或1名『虹咲』的成员变为活跃状态。',
  },
  {
    cardCode: 'PL!N-bp5-003-AR',
    abilityId: 'PL!N-bp5-003:activated-discard-pay-score-recover-live',
    expected:
      '【起动】【1回合1次】将1张手牌放置入休息室：选择1张存在于自己休息室的LIVE卡，可以支付与该卡的分数相同数量的[E]。如此做的场合，将该LIVE卡加入手牌。',
  },
  {
    cardCode: 'PL!N-bp5-008-AR',
    abilityId: 'PL!N-bp5-008:activated-stack-energy-below-activate-two-energy',
    expected:
      '【起动】【1回合1次】将1张存在于能量区的能量放置于此成员下方：将2张能量变为活跃状态。',
  },
  {
    cardCode: 'PL!N-bp5-012-AR',
    abilityId: 'PL!N-bp5-012:activated-stack-energy-below-draw-gain-pink-heart',
    expected:
      '【起动】【1回合1次】将1张存在于能量区的能量放置于此成员下方：抽1张卡，LIVE结束时为止，获得[桃ハート]。',
  },
  {
    cardCode: 'PL!N-bp5-014-N',
    abilityId: 'PL!N-bp5-014-N:activated-pay-two-energy-discard-recover-nijigasaki-live',
    expected:
      '【起动】【1回合1次】[E][E]将1张手牌放置入休息室：从自己的休息室将1张『虹咲』的LIVE卡加入手牌。',
  },
  {
    cardCode: 'PL!N-bp7-004-P',
    abilityId: 'PL!N-bp7-004-P:activated-stack-energy-below-wait-original-blade',
    expected:
      '【起动】【1回合1次】将能量卡组的1张能量卡放置于此卡的下方：将存在于对方的舞台的1名，原本持有的[ブレード]的数量小于等于此卡下方的能量卡的张数+1的成员变为待机状态。',
  },
  {
    cardCode: 'PL!N-pb1-011-P+',
    abilityId: 'PL!N-pb1-011:activated-stack-energy-below-recover-nijigasaki-live',
    expected:
      '【起动】【1回合1次】将1张存在于自己的能量区的能量卡放置于此成员下方：从自己的休息室将1张『虹咲』的LIVE卡加入手牌。\n\n(成员离开舞台时，将被放置于成员下方的能量卡返回能量卡组。)',
  },
  {
    cardCode: 'PL!N-PR-003-PR',
    abilityId: 'PL!N-PR:activated-turn-once-reveal-hand-no-live-look-top-five-take-live',
    expected:
      '【起动】【1回合1次】公开所有手牌：自己的舞台上存在其他的成员，且因支付此费用公开的手牌中不存在LIVE卡的场合，检视自己卡组顶的5张卡。可以将1张其中的LIVE卡公开并加入手牌。其余的卡片放置入休息室。',
  },
  {
    cardCode: 'PL!N-PR-008-PR',
    abilityId: 'PL!N-PR:activated-turn-once-reveal-hand-no-live-look-top-five-take-live',
    expected:
      '【起动】【1回合1次】公开所有手牌：自己的舞台上存在其他的成员，且因支付此费用公开的手牌中不存在LIVE卡的场合，检视自己卡组顶的5张卡。可以将1张其中的LIVE卡公开并加入手牌。其余的卡片放置入休息室。',
  },
  {
    cardCode: 'PL!N-PR-010-PR',
    abilityId: 'PL!N-PR:activated-turn-once-reveal-hand-no-live-look-top-five-take-live',
    expected:
      '【起动】【1回合1次】公开所有手牌：自己的舞台上存在其他的成员，且因支付此费用公开的手牌中不存在LIVE卡的场合，检视自己卡组顶的5张卡。可以将1张其中的LIVE卡公开并加入手牌。其余的卡片放置入休息室。',
  },
  {
    cardCode: 'PL!S-bp3-006-P',
    abilityId: 'PL!S-bp3-006:activated-wait-self-upgrade-other-aqours-member',
    expected:
      '【起动】【中央】【1回合1次】将此成员变为待机状态，将1张手牌放置入休息室：将1名此成员以外的『Aqours』的成员从自己的舞台放置入休息室。如此做的场合，从自己的休息室，将1张费用与此成员的费用加2相等的『Aqours』的成员卡，登场至该成员曾存在的区域。(此能力仅可在中央区域登场的场合起动)',
  },
  {
    cardCode: 'PL!S-bp3-007-P',
    abilityId: 'PL!S-bp3-007:activated-pay-energy-bottom-waiting-live-draw',
    expected:
      '【起动】【1回合1次】[E]：选择自己或对方。自己将该玩家存在于休息室的1张LIVE卡放置于该玩家的卡组底。如此做的场合，自己抽1张卡。',
  },
  {
    cardCode: 'PL!S-bp3-008-P',
    abilityId: 'PL!S-bp3-008:activated-self-sacrifice-recover-aqours-live-activate-energy',
    expected:
      '【起动】将此成员从舞台放置入休息室：从自己的休息室将1张LIVE卡加入手牌。其为分数大于等于6的『Aqours』的LIVE卡的场合，将4张能量变为活跃状态。',
  },
  {
    cardCode: 'PL!S-bp5-111-P+',
    abilityId: 'PL!S-bp5-111:activated-pay-energy-position-change-to-aqours-or-saintsnow-member',
    expected:
      '【起动】【1回合1次】[E]：将此成员站位变换至『Aqours』或『Saint Snow』的成员存在的区域。',
  },
  {
    cardCode: 'PL!S-bp5-222-P+',
    abilityId: 'PL!S-bp5-222:activated-pay-energy-position-change-to-aqours-or-saintsnow-member',
    expected:
      '【起动】【1回合1次】[E]：将此成员站位变换至『Aqours』或『Saint Snow』的成员存在的区域。',
  },
  {
    cardCode: 'PL!S-bp6-003-P',
    abilityId: 'PL!S-bp6-003:activated-upgrade-other-aqours-member',
    expected:
      '【起动】【1回合1次】[E][E]将1张手牌放置入休息室：将1名此成员以外的『Aqours』的成员从自己的舞台放置入休息室。如此做的场合，从自己的休息室，将1张费用与此成员的费用加2相等的『Aqours』的成员卡，登场至该成员曾存在的区域。',
  },
  {
    cardCode: 'PL!S-bp6-008-P',
    abilityId: 'PL!S-bp6-008:activated-pay-two-send-self-play-aqours-member',
    expected:
      '【起动】[E][E]将此成员放置入休息室：从自己的休息室将1名费用小于等于17的『Aqours』的成员卡，登场至此成员所在的区域。',
  },
  {
    cardCode: 'PL!S-pb1-006-P+',
    abilityId: 'PL!S-pb1-006:activated-reveal-hand-live-opponent-discard-or-gain-four-blade',
    expected:
      '【起动】【1回合1次】从手牌中将1张LIVE卡公开：对手可以将1张手牌放置入休息室。未如此做的场合，LIVE结束时为止，获得[ブレード][ブレード][ブレード][ブレード]。',
  },
  {
    cardCode: 'PL!S-sd1-005-SD',
    abilityId: 'PL!S-sd1-005-SD:activated-pay-two-energy-discard-recover-aqours-live',
    expected:
      '【起动】【1回合1次】[E][E]将1张手牌放置入休息室：从自己的休息室将1张『Aqours』的LIVE卡加入手牌。',
  },
  {
    cardCode: 'PL!S-sd1-007-SD',
    abilityId: 'PL!S-sd1-007:activated-discard-two-recover-score-aqours-live',
    expected:
      '【起动】【1回合1次】将2张手牌放置入休息室：从自己的休息室将1张持有[スコア]的『Aqours』的LIVE卡加入手牌。',
  },
  {
    cardCode: 'PL!SP-bp1-003-P',
    abilityId: 'PL!SP-bp1-003:activated-reveal-hand-members-cost-total-gain-score',
    expected:
      '【起动】【1回合1次】公开任意张存在于手牌的成员卡：公开的卡片的费用的合计为，10、20、30、40、50中的任意值的场合，LIVE结束时为止，获得「【常时】LIVE的合计分数+1。」。',
  },
  {
    cardCode: 'PL!SP-bp2-008-P',
    abilityId: 'PL!SP-bp2-008:activated-pay-energy-self-position-change',
    expected:
      '【起动】【1回合1次】[E]：选择1个此成员所在区域不同的自己的区域。将此成员移动至该区域。选择的区域存在成员的场合，将该成员移动至此成员曾存在的区域。',
  },
  {
    cardCode: 'PL!SP-bp4-010-P',
    abilityId: 'PL!SP-bp4-010:activated-pay-energy-wait-self-place-waiting-energy',
    expected:
      '【起动】【1回合1次】[E]将此成员变为待机状态：从自己的能量卡组，将1张能量卡以待机状态放置入能量区。',
  },
  {
    cardCode: 'PL!SP-bp4-018-N',
    abilityId: 'PL!SP-bp4-018:activated-send-self-to-waiting-room-add-liella-card',
    expected: '【起动】将此成员从舞台放置入休息室：从自己的休息室将1张『Liella!』的卡片加入手牌。',
  },
  {
    cardCode: 'PL!SP-bp5-002-AR',
    abilityId: 'PL!SP-bp5-002:activated-wait-draw-three-discard-two-no-blade-heart-reward',
    expected:
      '【起动】【左侧】【1回合1次】将此成员变为待机状态：抽3张卡，将2张手牌放置入休息室。因此放置入休息室的卡片中存在大于等于1张不持有BLADE HEART的成员卡的场合，将此成员变为活跃状态。存在2张的场合，LIVE结束时为止，再获得[ブレード][ブレード]。',
  },
  {
    cardCode: 'PL!SP-bp5-005-AR',
    abilityId: 'PL!SP-bp5-005:activated-mill-three-gain-blade-by-liella-member',
    expected:
      '【起动】【1回合1次】从卡组顶将3张卡放置入休息室：LIVE结束时为止，每有1张因此放置入休息室的『Liella!』的成员卡，获得[ブレード]。',
  },
  {
    cardCode: 'PL!SP-bp5-006-AR',
    abilityId: 'PL!SP-bp5-006:activated-mill-three-self-position-change',
    expected:
      '【起动】【1回合1次】从卡组顶将3张卡放置入休息室：此成员进行站位变换。(将此成员移动至当前区域以外的区域。该区域存在成员的场合，将该成员移动至此成员曾存在的区域。)',
  },
  {
    cardCode: 'PL!SP-bp5-021-N',
    abilityId: 'PL!SP-bp5-021:activated-self-sacrifice-energy-six-place-waiting-energy',
    expected:
      '【起动】将此成员从舞台放置入休息室：自己的能量存在大于等于6张的场合，从自己的能量卡组，将1张能量卡以待机状态放置入能量区。',
  },
  {
    cardCode: 'PL!SP-bp7-003-SEC',
    abilityId: 'PL!SP-bp7-003-SEC:activated-reveal-cost-ten-or-twenty-member-stack-draw-two',
    expected:
      '【起动】【1回合1次】公开手牌的1张费用为10或20的成员卡：将因此公开的卡片放置于此成员的下方。此后，抽2张卡。',
  },
  {
    cardCode: 'PL!SP-pb2-002-PP',
    abilityId: 'PL!SP-pb2-002:activated-discard-liella-option-energy-or-heart',
    expected:
      '【起动】【1回合1次】将手牌的1张『Liella!』的卡片放置入休息室：从以下选择1项。因此将不持有BLADE HEART的成员卡放置入休息室的场合，作为代替选择1项以上。\n\n·从自己的能量卡组，将1张能量卡以待机状态放置入能量区。\n\n·LIVE结束时为止，存在于自己的舞台的1名此成员以外的『Liella!』的成员，获得[紫ハート][紫ハート]。',
  },
  {
    cardCode: 'PL!SP-sd2-002-P',
    abilityId: 'PL!SP-sd2-002:activated-pay-two-energy-self-position-change',
    expected: '【起动】【1回合1次】[E][E]：将此成员站位变换。',
  },
  {
    cardCode: 'PL!SP-sd2-006-SD2',
    abilityId: 'PL!SP-sd2-006:activated-pay-two-energy-discard-recover-liella-live',
    expected:
      '【起动】【1回合1次】[E][E]将1张手牌放置入休息室：从自己的休息室将1张『Liella!』的LIVE卡加入手牌。',
  },
] as const;

describe('activatedUi player-visible card text exact regressions', () => {
  it.each(EXACT_ACTIVATED_CARD_TEXT_CASES)(
    '$cardCode $abilityId uses the complete ordinary-player API paragraph',
    ({ cardCode, abilityId, expected }) => {
      const definition = getCardAbilityDefinitionsForCardCode(cardCode).find(
        (candidate) => candidate.abilityId === abilityId
      );

      expect(definition?.effectText).toBe(expected);
      expect(definition?.activatedUi?.text).toBe(expected);
    }
  );

  it('directly reuses every effectText identifier in activatedUi.text source', () => {
    const definitionsPath = join(
      process.cwd(),
      'src/application/card-effects/definitions/index.ts'
    );
    const source = readFileSync(definitionsPath, 'utf8');
    const sourceFile = ts.createSourceFile(
      definitionsPath,
      source,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS
    );
    const activatedObjects: ts.ObjectLiteralExpression[] = [];
    const visit = (node: ts.Node): void => {
      if (
        ts.isObjectLiteralExpression(node) &&
        node.properties.some(
          (property) =>
            ts.isPropertyAssignment(property) && property.name.getText(sourceFile) === 'activatedUi'
        )
      ) {
        activatedObjects.push(node);
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);

    const violations = activatedObjects.flatMap((definitionObject) => {
      const effectText = definitionObject.properties.find(
        (property): property is ts.PropertyAssignment =>
          ts.isPropertyAssignment(property) && property.name.getText(sourceFile) === 'effectText'
      );
      const activatedUi = definitionObject.properties.find(
        (property): property is ts.PropertyAssignment =>
          ts.isPropertyAssignment(property) && property.name.getText(sourceFile) === 'activatedUi'
      );
      if (
        !effectText ||
        !activatedUi ||
        !ts.isIdentifier(effectText.initializer) ||
        !ts.isObjectLiteralExpression(activatedUi.initializer)
      ) {
        return [definitionObject.getText(sourceFile).slice(0, 160)];
      }
      const uiText = activatedUi.initializer.properties.find(
        (property): property is ts.PropertyAssignment =>
          ts.isPropertyAssignment(property) && property.name.getText(sourceFile) === 'text'
      );
      return uiText?.initializer.getText(sourceFile) === effectText.initializer.text
        ? []
        : [definitionObject.getText(sourceFile).slice(0, 160)];
    });

    expect(activatedObjects).toHaveLength(
      CARD_ABILITY_DEFINITIONS.filter((definition) => definition.activatedUi).length
    );
    expect(violations).toEqual([]);
  });
});
