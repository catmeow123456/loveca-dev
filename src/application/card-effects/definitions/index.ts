import { SlotPosition, TriggerCondition } from '../../../shared/types/enums.js';
import {
  NOZOMI_ON_ENTER_ABILITY_ID,
  UMI_ON_ENTER_ABILITY_ID,
  HONOKA_ON_ENTER_ABILITY_ID,
  KOTORI_ON_ENTER_ABILITY_ID,
  MAKI_ON_ENTER_ABILITY_ID,
  GENERIC_DISCARD_LOOK_TOP_ABILITY_ID,
  LL_BP1_001_ON_ENTER_RECOVER_MEMBER_ABILITY_ID,
  LL_BP1_001_LIVE_START_DISCARD_SCORE_ABILITY_ID,
  LL_BP2_001_LIVE_START_DISCARD_BLADE_ABILITY_ID,
  HS_BP1_006_ON_ENTER_DRAW_DISCARD_ABILITY_ID,
  HS_BP1_006_ON_ENTER_DRAW_ONE_DISCARD_ONE_ABILITY_ID,
  MEMBER_ON_ENTER_DRAW_DISCARD_ABILITY_ID,
  MEMBER_ON_ENTER_DRAW_DISCARD_ONE_ABILITY_ID,
  HS_BP1_006_LIVE_START_DISCARD_GAIN_HEART_ABILITY_ID,
  HS_BP1_004_ACTIVATED_RECOVER_HASUNOSORA_LIVE_ABILITY_ID,
  HS_BP1_004_LIVE_START_PAY_ENERGY_GAIN_BLADE_ABILITY_ID,
  KARIN_LIVE_START_ABILITY_ID,
  KOTORI_LIVE_START_HEART_ABILITY_ID,
  NICO_LIVE_START_SCORE_ABILITY_ID,
  BOKUIMA_LIVE_START_REQUIREMENT_ABILITY_ID,
  HS_BP5_019_LIVE_START_REQUIREMENT_ABILITY_ID,
  HS_BP2_022_LIVE_START_SCORE_ABILITY_ID,
  BP4_021_LIVE_START_SUCCESS_SCORE_REQUIREMENT_AND_SCORE_ABILITY_ID,
  HS_SD1_006_ON_ENTER_ACTIVATE_ENERGY_RECOVER_LIVE_ABILITY_ID,
  HS_SD1_006_LIVE_START_PAY_ENERGY_GAIN_BLADE_ABILITY_ID,
  BP4_010_LIVE_START_PAY_ENERGY_GAIN_BLADE_ABILITY_ID,
  HS_PR_001_LIVE_START_PAY_TWO_ENERGY_GAIN_BLADE_ABILITY_ID,
  HS_BP5_008_ON_ENTER_WAIT_DISCARD_LOOK_TOP_ABILITY_ID,
  HS_PB1_004_ON_ENTER_PAY_ENERGY_DISCARD_MILL_RECOVER_CERISE_LIVE_ABILITY_ID,
  HS_PR_019_ON_ENTER_MILL_GAIN_GREEN_HEART_ABILITY_ID,
  ELI_ACTIVATED_ABILITY_ID,
  RIN_ACTIVATED_ABILITY_ID,
  PR_017_ACTIVATED_RECOVER_MUSE_LIVE_ACTIVATE_ENERGY_ABILITY_ID,
  BP4_002_ACTIVATED_DISCARD_RECOVER_MUSE_LIVE_ABILITY_ID,
  BP4_003_ACTIVATED_ABILITY_ID,
  PB1_019_ACTIVATED_ABILITY_ID,
  HANAYO_ACTIVATED_ABILITY_ID,
  START_DASH_LIVE_SUCCESS_ABILITY_ID,
  KEKE_ON_ENTER_PLACE_WAITING_ENERGY_ABILITY_ID,
  BP3_010_ON_ENTER_LOOK_LIVE_EFFECT_ID,
  BP5_005_ON_ENTER_SUCCESS_SCORE_PLACE_ACTIVE_ENERGY_ABILITY_ID,
  SP_BP2_002_ON_ENTER_LOOK_HIGH_COST_CARD_ABILITY_ID,
  BP6_002_ON_ENTER_LOOK_NO_ABILITY_OR_CONTINUOUS_MUSE_CARD_ABILITY_ID,
  BP6_005_ON_ENTER_DISCARD_TWO_RECOVER_YELLOW_HEART_CARDS_ABILITY_ID,
  PR_018_ON_ENTER_RECOVER_HIGH_SCORE_LIVE_ABILITY_ID,
  SHIKI_ON_ENTER_LEFT_DRAW_DISCARD_ABILITY_ID,
  SHIKI_ON_ENTER_RIGHT_ACTIVATE_ENERGY_ABILITY_ID,
  SHIKI_LIVE_START_POSITION_CHANGE_ABILITY_ID,
  SP_BP4_011_ENTER_OR_MOVE_WAIT_OPPONENT_LOW_BLADE_MEMBER_ABILITY_ID,
  HS_BP2_002_ON_ENTER_RECOVER_LOW_COST_MEMBER_ABILITY_ID,
  HS_BP2_012_LEAVE_STAGE_LOOK_TOP_MEMBER_ABILITY_ID,
  HS_BP6_017_LEAVE_STAGE_RECOVER_LIVE_AND_MEMBER_ABILITY_ID,
  HS_SD1_001_RELAY_REPLACED_ACTIVATE_ENERGY_ABILITY_ID,
  HS_PB1_020_ON_ENTER_DISCARD_TWO_RECOVER_CERISE_MEMBER_AND_HASUNOSORA_LIVE_ABILITY_ID,
  HS_PB1_009_ON_HASUNOSORA_ENTER_GAIN_BLADE_ABILITY_ID,
  HS_PB1_009_LIVE_START_DRAW_DISCARD_ABILITY_ID,
  HS_BP6_004_ON_ENTER_WAIT_OPPONENT_LOW_COST_MEMBER_ABILITY_ID,
  HS_BP6_004_LIVE_START_WAIT_OPPONENT_LOW_COST_MEMBER_ABILITY_ID,
  HS_BP6_004_LIVE_START_DISCARD_GAIN_BLADE_ABILITY_ID,
  CHISATO_LIVE_START_ACTIVATE_LIELLA_AND_ENERGY_ABILITY_ID,
  EMMA_ON_ENTER_ACTIVATE_MEMBER_OR_ENERGY_ABILITY_ID,
  YOSHIKO_ON_ENTER_PLAY_LOW_COST_MEMBERS_ABILITY_ID,
  HS_BP5_001_ON_ENTER_MILL_GAIN_BLADE_ABILITY_ID,
  HS_BP5_001_ACTIVATED_REVEAL_HAND_LIVE_RECOVER_SAME_NAME_LIVE_ABILITY_ID,
  PL_BP3_014_ON_ENTER_LOOK_TOP_TWO_ARRANGE_TO_TOP_ABILITY_ID,
  HS_BP1_003_ACTIVATED_RECOVER_LOW_COST_HASUNOSORA_MEMBER_ABILITY_ID,
  HS_BP1_003_CONTINUOUS_THREE_DIFFERENT_HASUNOSORA_SCORE_ABILITY_ID,
  HS_BP1_002_ACTIVATED_PLAY_HASUNOSORA_MEMBER_TO_SOURCE_SLOT_ABILITY_ID,
  HS_BP6_001_ON_ENTER_LOOK_STAGE_PLUS_TWO_ABILITY_ID,
  HS_BP6_001_LIVE_SUCCESS_CHEER_TO_TOP_ABILITY_ID,
  HS_CL1_009_LIVE_SUCCESS_CHEER_MEMBER_TO_HAND_ABILITY_ID,
  HS_BP6_027_ON_CHEER_ADDITIONAL_CHEER_ABILITY_ID,
  HS_BP6_031_LIVE_START_RECYCLE_MIRACRA_MEMBERS_GAIN_BLADE_ABILITY_ID,
  HS_PB1_012_ON_ENTER_RECYCLE_MEMBERS_RECOVER_LIVE_GAIN_BLADE_ABILITY_ID,
  N_BP4_018_MAIN_PHASE_ACTIVE_TO_WAITING_DRAW_DISCARD_ABILITY_ID,
  PB1_015_OWN_EFFECT_WAIT_OPPONENT_LOW_COST_DRAW_ABILITY_ID,
} from '../ability-ids.js';
import {
  CardAbilityCategory,
  CardAbilitySourceZone,
  type CardAbilityDefinition,
} from '../ability-definition-types.js';
import {
  PB1_019_LIKE_SELF_SACRIFICE_MEMBER_BASE_CARD_CODES,
  RIN_LIKE_SELF_SACRIFICE_MEMBER_BASE_CARD_CODES,
} from './shared-abilities.js';

const NOZOMI_EFFECT_TEXT = '【登场】将自己卡组顶的5张卡放置入休息室。其中有LIVE卡的场合，抽1张卡。';
const UMI_EFFECT_TEXT =
  "【登场】检视自己卡组顶的5张卡。可以将1张其中的『μ's』的LIVE卡公开并加入手牌。其余的卡片放置入休息室。";
const HONOKA_ON_ENTER_EFFECT_TEXT =
  '【登场】自己的成功LIVE卡区中的卡片大于等于2张的场合，从自己的休息室将1张LIVE卡加入手牌。';
const KOTORI_ON_ENTER_EFFECT_TEXT =
  "【登场】从自己的休息室将1张费用小于等于4的『μ's』的成员卡加入手牌。";
const LL_BP1_001_ON_ENTER_EFFECT_TEXT = '【登场】从自己的休息室将1张成员卡加入手牌。';
const LL_BP1_001_LIVE_START_EFFECT_TEXT =
  '【LIVE开始时】可以将手牌的合计3张「上原步梦」与「涩谷香音」与「日野下花帆」，以任意组合放置入休息室：LIVE结束时为止，获得「【常时】LIVE的合计分数＋３。」。';
const LL_BP2_001_LIVE_START_EFFECT_TEXT =
  '【LIVE开始时】可以将手牌的任意张数的「渡边 曜」与「鬼冢夏美」与「大泽瑠璃乃」放置入休息室：LIVE结束时为止，因支付此费用被放置入休息室的卡片每有1张，获得[BLADE]。';
const HS_BP1_006_ON_ENTER_EFFECT_TEXT = '【登场】抽2张卡，将1张手牌放置入休息室。';
const HS_BP1_006_ON_ENTER_DRAW_ONE_DISCARD_EFFECT_TEXT = '【登场】抽1张卡，将1张手牌放置入休息室。';
const HS_BP1_006_LIVE_START_EFFECT_TEXT =
  '【LIVE开始时】可以将1张手牌放置入休息室：自己的舞台上存在其他的成员的场合，指定1个任意Heart的颜色。LIVE结束时为止，获得1个指定颜色的Heart。';
const HS_BP1_004_ACTIVATED_EFFECT_TEXT =
  '【起动】[1回合1次][E][E][E]：从自己的休息室将1张『莲之空』的LIVE卡加入手牌。';
const HS_BP1_004_LIVE_START_EFFECT_TEXT =
  '【LIVE开始时】可以支付[E]：LIVE结束时为止，每存在1张自己的LIVE中的卡片，获得[BLADE]。';
const KOTORI_LIVE_START_EFFECT_TEXT =
  '【LIVE开始时】可以将1张手牌放置入休息室：选择[桃ハート]或[黄ハート]或[紫ハート]中的1种，LIVE结束时为止，获得1个选择了的Heart。';
const MAKI_EFFECT_TEXT =
  '【登场】可以将1张手牌中的LIVE卡公开：将1张自己的成功LIVE卡区中的卡片加入手牌。如此做的场合，将因此公开的卡放置入自己的成功LIVE卡区。';
const HS_BP2_002_ON_ENTER_EFFECT_TEXT =
  '【登场】从自己的休息室将至多2张费用小于等于2的成员卡加入手牌。';
const HS_BP2_012_LEAVE_STAGE_EFFECT_TEXT =
  '【自动】此成员从舞台被放置入休息室时，检视自己卡组顶的5张卡。可以将1张其中的成员卡公开并加入手牌。其余的卡片放置入休息室。';
const HS_BP6_017_LEAVE_STAGE_EFFECT_TEXT =
  '【自动】将此成员从舞台放置入休息室时，可以将1张手牌放置入休息室。如此做的场合，从休息室将LIVE卡和成员卡至多各1张加入手牌。';
const HS_SD1_001_RELAY_REPLACED_EFFECT_TEXT =
  '【自动】此成员被从舞台放置入休息室时，此成员曾与费用大于等于10的『莲之空』成员换手的场合，将2张能量变为活跃状态。';
const HS_PB1_020_ON_ENTER_EFFECT_TEXT =
  '【登场】自己的休息室存在大于等于3张LIVE卡的场合，可以将2张手牌放置入休息室。如此做的场合，从自己的休息室将1张『Cerise Bouquet』成员卡与1张『莲之空』LIVE卡加入手牌。';
const HS_PB1_009_ON_HASUNOSORA_ENTER_EFFECT_TEXT =
  '【自动】【中央】[1回合2次]每当「莲之空」的成员登场至自己的舞台，LIVE结束时为止，获得[BLADE][BLADE]。';
const HS_PB1_009_LIVE_START_EFFECT_TEXT =
  '【LIVE开始时】此成员持有的[BLADE]的数量大于等于8个的场合，抽2张卡，将1张手牌放置入休息室。';
const HS_BP6_004_WAIT_OPPONENT_LOW_COST_MEMBER_EFFECT_TEXT =
  '【登场】/【LIVE开始时】将存在于对方舞台的1名费用小于等于9的成员变为待机状态。';
const SP_BP4_011_ENTER_OR_MOVE_WAIT_OPPONENT_LOW_BLADE_MEMBER_EFFECT_TEXT =
  '【自动】此成员登场或移动区域时，将1名存在于对方的舞台的原本持有的[BLADE]数量小于等于3个的成员变为待机状态。';
const HS_BP6_004_LIVE_START_DISCARD_GAIN_BLADE_EFFECT_TEXT =
  '【LIVE开始时】可以将1张手牌放置入休息室：LIVE结束时为止，获得[BLADE]。因此将[百生吟子]的成员卡放置入休息室的场合，再获得[BLADE]。';
const GENERIC_DISCARD_LOOK_TOP_EFFECT_TEXT =
  '【登场】可以将1张手牌放置入休息室：检视自己卡组顶的卡。将1张其中的卡片加入手牌，其余的卡片放置入休息室。';
const KARIN_EFFECT_TEXT =
  '【LIVE开始时】公开自己卡组顶的卡片。公开的卡片为费用小于等于9的成员卡的场合，将公开的卡片加入手牌，此成员进行站位变换。除此之外的场合，将公开的卡片放置入休息室。';
const NICO_EFFECT_TEXT =
  "【LIVE开始时】自己的休息室中存在大于等于25张『μ's』的卡片的场合，LIVE结束时为止，获得「【常时】LIVE的合计分数＋１。」。";
const BOKUIMA_EFFECT_TEXT =
  '【LIVE开始时】每存在1张自己的成功LIVE卡区中的卡片，使此卡成功的必要HEART减少[無ハート][無ハート]。';
const HS_BP5_019_LIVE_START_EFFECT_TEXT =
  '【LIVE开始时】自己的LIVE卡区每存在1张此卡以外的『莲之空』的卡片，此卡所需的必要HEART减少[緑ハート][緑ハート]。';
const HS_BP2_022_LIVE_START_EFFECT_TEXT =
  '【LIVE开始时】自己的休息室存在大于等于3张『Cerise Bouquet』的LIVE卡的场合，此卡的分数＋１。';
const BP4_021_LIVE_START_EFFECT_TEXT =
  '【LIVE开始时】存在于自己的成功LIVE卡区的卡片的分数合计大于等于6的场合，使此卡成功的必要[無ハート]减少1；分数合计大于等于9的场合，此卡的分数再＋1。';
const HS_SD1_006_ON_ENTER_EFFECT_TEXT =
  '【登场】自己的舞台中存在「大泽瑠璃乃」或「百生吟子」或「徒町小铃」的场合，将1张能量变为活跃状态，从自己的休息室将1张『莲之空』的LIVE卡加入手牌。';
const HS_SD1_006_LIVE_START_EFFECT_TEXT =
  '【LIVE开始时】可以支付[E]：LIVE结束时为止，获得[BLADE][BLADE]。';
const BP4_010_LIVE_START_EFFECT_TEXT =
  '【LIVE开始时】可以支付[E]：LIVE结束时为止，获得[BLADE][BLADE]。';
const HS_PR_001_LIVE_START_EFFECT_TEXT =
  '【LIVE开始时】可以支付[E][E]：LIVE结束时为止，获得[BLADE]。';
const HS_BP5_008_ON_ENTER_EFFECT_TEXT =
  '【登场】可以将此成员变为待机状态，将1张手牌放置入休息室：检视自己卡组顶的5张卡。可以从其中将1张费用大于等于9的『莲之空』的成员卡公开并加入手牌。其余的卡片放置入休息室。';
const HS_PB1_004_ON_ENTER_EFFECT_TEXT =
  '【登场】[E]可以将1张手牌放置入休息室：将自己卡组顶的3张卡放置入休息室。之后，从自己的休息室将1张『Cerise Bouquet』的LIVE卡加入手牌。';
const HS_PR_019_ON_ENTER_EFFECT_TEXT =
  '【登场】将自己卡组顶的3张卡放置入休息室。那些卡均为持有[緑ハート]的成员卡的场合，LIVE结束时为止，获得[緑ハート]。';
const ELI_EFFECT_TEXT = '【起动】将此成员从舞台放置入休息室：从自己的休息室将1张成员卡加入手牌。';
const RIN_EFFECT_TEXT = '【起动】将此成员从舞台放置入休息室：从自己的休息室将1张LIVE卡加入手牌。';
const PR_017_ACTIVATED_EFFECT_TEXT =
  "【起动】将此成员从舞台放置入休息室：从自己的休息室将1张『μ's』的LIVE卡加入手牌。自己的成功LIVE卡区分数合计大于等于9的场合，将2张能量变为活跃。";
const BP4_002_ACTIVATED_EFFECT_TEXT =
  "【起动】[1回合1次]将2张手牌放置入休息室：从自己的休息室将1张『μ's』的LIVE卡加入手牌。此能力仅可在成功LIVE卡区分数合计大于等于6的场合起动。";
const BP4_003_EFFECT_TEXT =
  '【起动】将此成员从舞台放置入休息室：从自己的休息室将1张LIVE卡加入手牌。';
const PB1_019_EFFECT_TEXT =
  '【起动】将此成员从舞台放置入休息室：从自己的休息室将1张成员卡加入手牌。';
const HANAYO_EFFECT_TEXT = '【起动】[1回合1次][E][E]：将自己卡组顶的10张卡放置入休息室。';
const START_DASH_EFFECT_TEXT =
  '【LIVE成功时】检视自己卡组顶的3张卡。将任意张按任意顺序放置于卡组顶，其余放置入休息室。';
const KEKE_EFFECT_TEXT =
  '【登场】可以将1张手牌放置入休息室：从自己的能量卡组，将1张能量卡以待机状态放置入能量区。';
const BP3_010_ON_ENTER_EFFECT_TEXT =
  '【登场】可以将1张手牌放置入休息室：检视自己卡组顶的5张卡。可以将1张其中的LIVE卡公开并加入手牌。其余放置入休息室。';
const BP5_005_ON_ENTER_EFFECT_TEXT =
  '【登场】存在于自己的成功LIVE卡区的卡片的分数合计大于等于6的场合，从自己的能量卡组，将1张能量卡以活跃状态放置入能量区。';
const SP_BP2_002_ON_ENTER_EFFECT_TEXT =
  '【登场】检视自己卡组顶的3张卡。可以将1张其中的费用大于等于11的卡片公开并加入手牌。其余的卡片放置入休息室。';
const BP6_002_ON_ENTER_EFFECT_TEXT =
  "【登场】检视自己卡组顶的2张卡。可以从其中将1张不持有能力的[μ's]的卡片或持有【常时】能力的[μ's]的卡片公开并加入手牌。其余的卡片放置入休息室。";
const BP6_005_ON_ENTER_EFFECT_TEXT =
  '【登场】可以将2张手牌放置入休息室：从自己的休息室将至多1张持有[黄HEART]的成员，与至多1张必要HEART中含有[黄HEART]的LIVE卡加入手牌。';
const PR_018_ON_ENTER_EFFECT_TEXT = '【登场】从自己的休息室将1张分数大于等于6的LIVE卡加入手牌。';
const PL_BP3_014_ON_ENTER_EFFECT_TEXT =
  '【登场】可以将此成员变为待机状态：检视自己卡组顶的2张卡。将其中任意张数的卡片按任意顺序放置于卡组顶，其余的卡片放置入休息室。';
const SHIKI_LEFT_DRAW_DISCARD_EFFECT_TEXT = '【登场】【左サイド】抽2张卡，将1张手牌放置入休息室。';
const SHIKI_RIGHT_ENERGY_EFFECT_TEXT = '【登场】【右サイド】将2张能量变为活跃状态。';
const SHIKI_LIVE_START_POSITION_CHANGE_EFFECT_TEXT =
  '【LIVE开始时】可以使此成员进行站位变换。(将此成员移动至当前区域以外的区域。该区域存在成员的场合，将该成员移动至此成员曾存在的区域。)';
const CHISATO_LIVE_START_ACTIVATE_EFFECT_TEXT =
  '【LIVE开始时】【センター】将自己舞台上所有『Liella!』成员和自己的所有能量变为活跃状态。';
const EMMA_ON_ENTER_ACTIVATE_MEMBER_OR_ENERGY_EFFECT_TEXT =
  '【登场】将1名存在于自己的舞台的成员或2张能量变为活跃状态。';
const YOSHIKO_ON_ENTER_PLAY_LOW_COST_MEMBERS_EFFECT_TEXT =
  '【登场】可以支付[E][E][E][E]：从自己的休息室选择至多2张费用合计小于等于4的成员卡登场到舞台。';
const HS_BP5_001_ON_ENTER_EFFECT_TEXT =
  '【登场】将自己卡组顶的4张卡放置入休息室。那些卡片中存在LIVE卡的场合，LIVE结束时为止，获得[BLADE][BLADE]。';
const HS_BP5_001_ACTIVATED_EFFECT_TEXT =
  '【起动】[1回合1次][E][E]公开1张手牌的LIVE卡：从自己的休息室，将1张包含所有因此公开的卡的卡名的LIVE卡加入手牌。';
const HS_BP1_003_ACTIVATED_EFFECT_TEXT =
  '【起动】[1回合1次][E]：从自己的休息室将1张费用小于等于4的『莲之空』的成员卡加入手牌。';
const HS_BP1_003_CONTINUOUS_EFFECT_TEXT =
  '【常时】所有自己舞台的区域均有「莲之空」成员登场，且名称不同的场合，获得「【常时】LIVE的合计分数+1」。';
const HS_BP1_002_ACTIVATED_EFFECT_TEXT =
  '【起动】[E][E]将此成员从舞台放置入休息室：从自己的休息室将1张费用小于等于15的『莲之空』的成员卡，登场至此成员所在的区域。';
const HS_BP6_001_ON_ENTER_EFFECT_TEXT =
  '【登场】从自己的卡组顶，检视等于存在于自己的舞台上的成员的数量加2的张数的卡片。从其中将1张卡片放置于卡组顶，其余的卡片放置入休息室。';
const HS_BP6_001_LIVE_SUCCESS_EFFECT_TEXT =
  '【LIVE成功时】可以从因声援被公开的自己的卡片中，将1张放置到卡组顶。';
const HS_CL1_009_LIVE_SUCCESS_EFFECT_TEXT =
  '【LIVE成功时】从因声援被公开的自己的卡片中，将1张费用大于等于4小于等于9的成员卡加入手牌。';
const HS_BP6_027_ON_CHEER_EFFECT_TEXT =
  '【自动】【1回合1次】自己进行声援时，可以将至多3张因声援被公开的自己的不持有BLADE HEART的「莲之空」卡片放置入休息室。如此做的场合，额外进行等于因此放置入休息室的卡片张数的次数的声援。';
const HS_BP6_031_LIVE_START_EFFECT_TEXT =
  '【LIVE开始时】可以将自己休息室所有成员卡洗牌后放到卡组底。若因此将15张以上『みらくらぱーく！』成员卡放到卡组底，LIVE结束时为止，自己舞台1名「安养寺姬芽」获得BLADE +3。';
const HS_PB1_012_ON_ENTER_EFFECT_TEXT =
  '【登场】自己和对方分别将存在于自身休息室的所有成员卡洗牌，放置入自身的卡组底。合计大于等于20张自己与对方的卡片因此被放置入卡组底的场合，从自己的休息室将1张LIVE卡加入手牌，LIVE结束时为止，获得[BLADE][BLADE]。';
const N_BP4_018_ACTIVE_TO_WAITING_EFFECT_TEXT =
  '【自动】自己主要阶段中，此成员从活跃状态变为待机状态时，抽1张卡，将1张手牌放置入休息室。';
const PB1_015_OWN_EFFECT_WAIT_OPPONENT_LOW_COST_EFFECT_TEXT =
  '【自动】[1回合1次]因自己的卡片效果，使对方舞台活跃状态且费用小于等于4的成员变为待机状态时，抽1张卡。';

export const CARD_ABILITY_DEFINITIONS: readonly CardAbilityDefinition[] = [
  {
    abilityId: `${HONOKA_ON_ENTER_ABILITY_ID}:continuous-extra-blade`,
    cardCodes: ['PL!-sd1-001-SD'],
    category: CardAbilityCategory.CONTINUOUS,
    sourceZone: CardAbilitySourceZone.STAGE_MEMBER,
    queued: false,
    implemented: true,
    effectText: '【常时】LIVE判定时，每有1张自己的成功LIVE卡，因声援公开的张数+1。',
    notes: '持续修正不进队列，由 collectLiveModifiers 动态收集为 BLADE modifier。',
  },
  {
    abilityId: HONOKA_ON_ENTER_ABILITY_ID,
    cardCodes: ['PL!-sd1-001-SD'],
    category: CardAbilityCategory.ON_ENTER,
    sourceZone: CardAbilitySourceZone.PLAYED_MEMBER,
    triggerCondition: TriggerCondition.ON_ENTER_STAGE,
    queued: true,
    implemented: true,
    effectText: HONOKA_ON_ENTER_EFFECT_TEXT,
  },
  {
    abilityId: ELI_ACTIVATED_ABILITY_ID,
    cardCodes: ['PL!-sd1-002-SD'],
    category: CardAbilityCategory.ACTIVATED,
    sourceZone: CardAbilitySourceZone.STAGE_MEMBER,
    queued: false,
    implemented: true,
    effectText: ELI_EFFECT_TEXT,
    activatedUi: {
      abilityId: ELI_ACTIVATED_ABILITY_ID,
      text: '起动：将此成员从舞台放置入休息室：从自己的休息室将1张成员卡加入手牌。',
      title: '将此成员从舞台放置入休息室，从自己的休息室将1张成员卡加入手牌',
    },
  },
  {
    abilityId: KOTORI_ON_ENTER_ABILITY_ID,
    cardCodes: ['PL!-sd1-003-SD'],
    category: CardAbilityCategory.ON_ENTER,
    sourceZone: CardAbilitySourceZone.PLAYED_MEMBER,
    triggerCondition: TriggerCondition.ON_ENTER_STAGE,
    queued: true,
    implemented: true,
    effectText: KOTORI_ON_ENTER_EFFECT_TEXT,
  },
  {
    abilityId: KOTORI_LIVE_START_HEART_ABILITY_ID,
    cardCodes: ['PL!-sd1-003-SD'],
    category: CardAbilityCategory.LIVE_START,
    sourceZone: CardAbilitySourceZone.STAGE_MEMBER,
    triggerCondition: TriggerCondition.ON_LIVE_START,
    queued: true,
    implemented: true,
    effectText: KOTORI_LIVE_START_EFFECT_TEXT,
  },
  {
    abilityId: UMI_ON_ENTER_ABILITY_ID,
    cardCodes: ['PL!-sd1-004-SD'],
    category: CardAbilityCategory.ON_ENTER,
    sourceZone: CardAbilitySourceZone.PLAYED_MEMBER,
    triggerCondition: TriggerCondition.ON_ENTER_STAGE,
    queued: true,
    implemented: true,
    effectText: UMI_EFFECT_TEXT,
  },
  {
    abilityId: RIN_ACTIVATED_ABILITY_ID,
    baseCardCodes: RIN_LIKE_SELF_SACRIFICE_MEMBER_BASE_CARD_CODES,
    category: CardAbilityCategory.ACTIVATED,
    sourceZone: CardAbilitySourceZone.STAGE_MEMBER,
    queued: false,
    implemented: true,
    effectText: RIN_EFFECT_TEXT,
    activatedUi: {
      abilityId: RIN_ACTIVATED_ABILITY_ID,
      text: '起动：将此成员从舞台放置入休息室：从自己的休息室将1张LIVE卡加入手牌。',
      title: '将此成员从舞台放置入休息室，从自己的休息室将1张LIVE卡加入手牌',
    },
  },
  {
    abilityId: PR_017_ACTIVATED_RECOVER_MUSE_LIVE_ACTIVATE_ENERGY_ABILITY_ID,
    cardCodes: ['PL!-PR-017-PR'],
    category: CardAbilityCategory.ACTIVATED,
    sourceZone: CardAbilitySourceZone.STAGE_MEMBER,
    queued: false,
    implemented: true,
    effectText: PR_017_ACTIVATED_EFFECT_TEXT,
    notes:
      "复用自送休息室起动费用与 WAITING_ROOM -> HAND；回收 μ's LIVE 后按成功 LIVE 分数合计 >=9 自动活跃2张能量。",
    activatedUi: {
      abilityId: PR_017_ACTIVATED_RECOVER_MUSE_LIVE_ACTIVATE_ENERGY_ABILITY_ID,
      text: "起动：将此成员从舞台放置入休息室：从自己的休息室将1张『μ's』LIVE卡加入手牌。成功LIVE分数合计>=9时，将2张能量变为活跃。",
      title: "将此成员从舞台放置入休息室，回收1张『μ's』LIVE卡，条件满足时活跃2张能量",
    },
  },
  {
    abilityId: BP4_002_ACTIVATED_DISCARD_RECOVER_MUSE_LIVE_ABILITY_ID,
    baseCardCodes: ['PL!-bp4-002'],
    category: CardAbilityCategory.ACTIVATED,
    sourceZone: CardAbilitySourceZone.STAGE_MEMBER,
    queued: false,
    implemented: true,
    effectText: BP4_002_ACTIVATED_EFFECT_TEXT,
    perTurnLimit: 1,
    notes:
      "仅实现起动段：成功 LIVE 分数合计 >=6 时可弃2手回收1张 μ's LIVE；常时获得紫 Heart +2 暂未实现。",
    activatedUi: {
      abilityId: BP4_002_ACTIVATED_DISCARD_RECOVER_MUSE_LIVE_ABILITY_ID,
      text: "起动：[1回合1次]将2张手牌放置入休息室：从自己的休息室将1张『μ's』LIVE卡加入手牌。仅可在成功LIVE分数合计>=6时起动。",
      title: "弃2张手牌，从休息室回收1张『μ's』LIVE卡",
    },
  },
  {
    abilityId: BP4_003_ACTIVATED_ABILITY_ID,
    baseCardCodes: ['PL!-bp4-003'],
    category: CardAbilityCategory.ACTIVATED,
    sourceZone: CardAbilitySourceZone.STAGE_MEMBER,
    queued: false,
    implemented: true,
    effectText: BP4_003_EFFECT_TEXT,
    activatedUi: {
      abilityId: BP4_003_ACTIVATED_ABILITY_ID,
      text: '起动：将此成员从舞台放置入休息室：从自己的休息室将1张LIVE卡加入手牌。',
      title: '将此成员从舞台放置入休息室，从自己的休息室将1张LIVE卡加入手牌',
    },
  },
  {
    abilityId: PB1_019_ACTIVATED_ABILITY_ID,
    baseCardCodes: PB1_019_LIKE_SELF_SACRIFICE_MEMBER_BASE_CARD_CODES,
    category: CardAbilityCategory.ACTIVATED,
    sourceZone: CardAbilitySourceZone.STAGE_MEMBER,
    queued: false,
    implemented: true,
    effectText: PB1_019_EFFECT_TEXT,
    activatedUi: {
      abilityId: PB1_019_ACTIVATED_ABILITY_ID,
      text: '起动：将此成员从舞台放置入休息室：从自己的休息室将1张成员卡加入手牌。',
      title: '将此成员从舞台放置入休息室，从自己的休息室将1张成员卡加入手牌',
    },
  },
  {
    abilityId: MAKI_ON_ENTER_ABILITY_ID,
    cardCodes: ['PL!-sd1-006-SD'],
    category: CardAbilityCategory.ON_ENTER,
    sourceZone: CardAbilitySourceZone.PLAYED_MEMBER,
    triggerCondition: TriggerCondition.ON_ENTER_STAGE,
    queued: true,
    implemented: true,
    effectText: MAKI_EFFECT_TEXT,
  },
  {
    abilityId: NOZOMI_ON_ENTER_ABILITY_ID,
    cardCodes: ['PL!-sd1-007-SD'],
    category: CardAbilityCategory.ON_ENTER,
    sourceZone: CardAbilitySourceZone.PLAYED_MEMBER,
    triggerCondition: TriggerCondition.ON_ENTER_STAGE,
    queued: true,
    implemented: true,
    effectText: NOZOMI_EFFECT_TEXT,
  },
  {
    abilityId: HANAYO_ACTIVATED_ABILITY_ID,
    cardCodes: ['PL!-sd1-008-SD'],
    category: CardAbilityCategory.ACTIVATED,
    sourceZone: CardAbilitySourceZone.STAGE_MEMBER,
    queued: false,
    implemented: true,
    effectText: HANAYO_EFFECT_TEXT,
    perTurnLimit: 1,
    activatedUi: {
      abilityId: HANAYO_ACTIVATED_ABILITY_ID,
      text: '起动：[E][E]：将自己卡组顶的10张卡放置入休息室。',
      title: '支付2能量，将自己卡组顶的10张卡放置入休息室',
    },
  },
  {
    abilityId: NICO_LIVE_START_SCORE_ABILITY_ID,
    cardCodes: ['PL!-sd1-009-SD'],
    category: CardAbilityCategory.LIVE_START,
    sourceZone: CardAbilitySourceZone.STAGE_MEMBER,
    triggerCondition: TriggerCondition.ON_LIVE_START,
    queued: true,
    implemented: true,
    effectText: NICO_EFFECT_TEXT,
  },
  {
    abilityId: GENERIC_DISCARD_LOOK_TOP_ABILITY_ID,
    baseCardCodes: [
      'PL!-sd1-011',
      'PL!-sd1-012',
      'PL!-sd1-015',
      'PL!-sd1-016',
      'PL!HS-PR-001',
      'PL!HS-cl1-007',
      'PL!HS-pb1-011',
      'PL!N-PR-004',
      'PL!N-PR-006',
      'PL!N-PR-013',
      'PL!N-bp1-007',
      'PL!N-bp1-010',
      'PL!N-sd1-002',
      'PL!N-sd1-003',
    ],
    category: CardAbilityCategory.ON_ENTER,
    sourceZone: CardAbilitySourceZone.PLAYED_MEMBER,
    triggerCondition: TriggerCondition.ON_ENTER_STAGE,
    queued: true,
    implemented: true,
    effectText: GENERIC_DISCARD_LOOK_TOP_EFFECT_TEXT,
  },
  {
    abilityId: START_DASH_LIVE_SUCCESS_ABILITY_ID,
    cardCodes: ['PL!-sd1-019-SD'],
    category: CardAbilityCategory.LIVE_SUCCESS,
    sourceZone: CardAbilitySourceZone.LIVE_CARD,
    triggerCondition: TriggerCondition.ON_LIVE_SUCCESS,
    queued: true,
    implemented: true,
    effectText: START_DASH_EFFECT_TEXT,
    notes: '使用通用检视卡组顶、选任意张排序放回卡组顶、其余入休息室流程。',
  },
  {
    abilityId: LL_BP1_001_ON_ENTER_RECOVER_MEMBER_ABILITY_ID,
    cardCodes: ['LL-bp1-001-R+'],
    category: CardAbilityCategory.ON_ENTER,
    sourceZone: CardAbilitySourceZone.PLAYED_MEMBER,
    triggerCondition: TriggerCondition.ON_ENTER_STAGE,
    queued: true,
    implemented: true,
    effectText: LL_BP1_001_ON_ENTER_EFFECT_TEXT,
    notes: '复用 zone-selection + card-selectors，从休息室筛选成员卡。',
  },
  {
    abilityId: LL_BP1_001_LIVE_START_DISCARD_SCORE_ABILITY_ID,
    cardCodes: ['LL-bp1-001-R+'],
    category: CardAbilityCategory.LIVE_START,
    sourceZone: CardAbilitySourceZone.STAGE_MEMBER,
    triggerCondition: TriggerCondition.ON_LIVE_START,
    queued: true,
    implemented: true,
    effectText: LL_BP1_001_LIVE_START_EFFECT_TEXT,
    notes: '复用指定姓名手牌弃置费用流程，合计弃3张上原步梦/涩谷香音/日野下花帆后写入 SCORE +3。',
  },
  {
    abilityId: LL_BP2_001_LIVE_START_DISCARD_BLADE_ABILITY_ID,
    cardCodes: ['LL-bp2-001-R+'],
    category: CardAbilityCategory.LIVE_START,
    sourceZone: CardAbilitySourceZone.STAGE_MEMBER,
    triggerCondition: TriggerCondition.ON_LIVE_START,
    queued: true,
    implemented: true,
    effectText: LL_BP2_001_LIVE_START_EFFECT_TEXT,
    notes:
      '复用指定姓名手牌弃置费用流程，弃任意张渡边曜/鬼冢夏美/大泽瑠璃乃后按弃置张数写入 BLADE。',
  },
  {
    abilityId: KEKE_ON_ENTER_PLACE_WAITING_ENERGY_ABILITY_ID,
    baseCardCodes: [
      'PL!SP-PR-004',
      'PL!SP-PR-006',
      'PL!SP-PR-013',
      'PL!SP-bp1-021',
      'PL!SP-sd1-014',
      'PL!SP-sd1-016',
    ],
    category: CardAbilityCategory.ON_ENTER,
    sourceZone: CardAbilitySourceZone.PLAYED_MEMBER,
    triggerCondition: TriggerCondition.ON_ENTER_STAGE,
    queued: true,
    implemented: true,
    effectText: KEKE_EFFECT_TEXT,
    notes: '复用 C01 弃手步骤，并通过 E03 helper 从能量卡组放置待机能量。',
  },
  {
    abilityId: BP3_010_ON_ENTER_LOOK_LIVE_EFFECT_ID,
    cardCodes: ['PL!-bp3-010-N'],
    category: CardAbilityCategory.ON_ENTER,
    sourceZone: CardAbilitySourceZone.PLAYED_MEMBER,
    triggerCondition: TriggerCondition.ON_ENTER_STAGE,
    queued: true,
    implemented: true,
    effectText: BP3_010_ON_ENTER_EFFECT_TEXT,
    notes: '复用 C01 + look-top 流程；检视5张、可选公开LIVE加入手牌，其余进休息室。',
  },
  {
    abilityId: BP5_005_ON_ENTER_SUCCESS_SCORE_PLACE_ACTIVE_ENERGY_ABILITY_ID,
    baseCardCodes: ['PL!-bp5-005'],
    category: CardAbilityCategory.ON_ENTER,
    sourceZone: CardAbilitySourceZone.PLAYED_MEMBER,
    triggerCondition: TriggerCondition.ON_ENTER_STAGE,
    queued: true,
    implemented: true,
    effectText: BP5_005_ON_ENTER_EFFECT_TEXT,
    notes:
      '成功 LIVE 分数合计条件走 conditions.ts，只满足时复用 energy.ts 从能量卡组放置活跃能量。',
  },
  {
    abilityId: SP_BP2_002_ON_ENTER_LOOK_HIGH_COST_CARD_ABILITY_ID,
    baseCardCodes: ['PL!SP-bp2-002'],
    category: CardAbilityCategory.ON_ENTER,
    sourceZone: CardAbilitySourceZone.PLAYED_MEMBER,
    triggerCondition: TriggerCondition.ON_ENTER_STAGE,
    queued: true,
    implemented: true,
    effectText: SP_BP2_002_ON_ENTER_EFFECT_TEXT,
    notes: '复用 look-top 检视/公开/入手流程；检视3张，可公开费用>=11的卡加入手牌，其余进休息室。',
  },
  {
    abilityId: BP6_002_ON_ENTER_LOOK_NO_ABILITY_OR_CONTINUOUS_MUSE_CARD_ABILITY_ID,
    baseCardCodes: ['PL!-bp6-002'],
    category: CardAbilityCategory.ON_ENTER,
    sourceZone: CardAbilitySourceZone.PLAYED_MEMBER,
    triggerCondition: TriggerCondition.ON_ENTER_STAGE,
    queued: true,
    implemented: true,
    effectText: BP6_002_ON_ENTER_EFFECT_TEXT,
    notes:
      '复用 look-top 检视/公开/入手流程；selector 只读 CardData.cardText，匹配无能力文本或含【常时/常時】能力的 μ’s 卡。',
  },
  {
    abilityId: BP6_005_ON_ENTER_DISCARD_TWO_RECOVER_YELLOW_HEART_CARDS_ABILITY_ID,
    baseCardCodes: ['PL!-bp6-005'],
    category: CardAbilityCategory.ON_ENTER,
    sourceZone: CardAbilitySourceZone.PLAYED_MEMBER,
    triggerCondition: TriggerCondition.ON_ENTER_STAGE,
    queued: true,
    implemented: true,
    effectText: BP6_005_ON_ENTER_EFFECT_TEXT,
    notes:
      '复用弃手费用与 WAITING_ROOM -> HAND；支付可选弃2手后，按持有黄 Heart 成员/必要 Heart 含黄 Heart LIVE 两组各至多1张回收。',
  },
  {
    abilityId: PR_018_ON_ENTER_RECOVER_HIGH_SCORE_LIVE_ABILITY_ID,
    baseCardCodes: ['PL!-PR-018'],
    category: CardAbilityCategory.ON_ENTER,
    sourceZone: CardAbilitySourceZone.PLAYED_MEMBER,
    triggerCondition: TriggerCondition.ON_ENTER_STAGE,
    queued: true,
    implemented: true,
    effectText: PR_018_ON_ENTER_EFFECT_TEXT,
    notes: '复用 zone-selection + card-selectors，从休息室筛选分数>=6的 LIVE 卡。',
  },
  {
    abilityId: HS_BP2_002_ON_ENTER_RECOVER_LOW_COST_MEMBER_ABILITY_ID,
    baseCardCodes: ['PL!HS-bp2-002'],
    category: CardAbilityCategory.ON_ENTER,
    sourceZone: CardAbilitySourceZone.PLAYED_MEMBER,
    triggerCondition: TriggerCondition.ON_ENTER_STAGE,
    queued: true,
    implemented: true,
    effectText: HS_BP2_002_ON_ENTER_EFFECT_TEXT,
    notes: '复用 zone-selection + card-selectors，从休息室筛选低费(<=2)成员卡，最多2张。',
  },
  {
    abilityId: HS_BP5_001_ON_ENTER_MILL_GAIN_BLADE_ABILITY_ID,
    baseCardCodes: ['PL!HS-bp5-001'],
    category: CardAbilityCategory.ON_ENTER,
    sourceZone: CardAbilitySourceZone.PLAYED_MEMBER,
    triggerCondition: TriggerCondition.ON_ENTER_STAGE,
    queued: true,
    implemented: true,
    effectText: HS_BP5_001_ON_ENTER_EFFECT_TEXT,
    notes: '第一批仅实现登场段；起动公开手牌 LIVE 并按同名回收 LIVE 留到 C07 批次。',
  },
  {
    abilityId: HS_BP5_001_ACTIVATED_REVEAL_HAND_LIVE_RECOVER_SAME_NAME_LIVE_ABILITY_ID,
    baseCardCodes: ['PL!HS-bp5-001'],
    category: CardAbilityCategory.ACTIVATED,
    sourceZone: CardAbilitySourceZone.STAGE_MEMBER,
    queued: false,
    implemented: true,
    effectText: HS_BP5_001_ACTIVATED_EFFECT_TEXT,
    perTurnLimit: 1,
    activatedUi: {
      abilityId: HS_BP5_001_ACTIVATED_REVEAL_HAND_LIVE_RECOVER_SAME_NAME_LIVE_ABILITY_ID,
      text: '起动：[1回合1次][E][E]公开1张手牌LIVE：从自己的休息室将1张同名LIVE加入手牌。',
      title: '支付2能量并公开手牌LIVE，从休息室回收同名LIVE',
    },
    notes: '起动段以 bespoke C07 手札公开步骤衔接 WAITING_ROOM -> HAND；未抽新公开手牌模块。',
  },
  {
    abilityId: HS_BP2_012_LEAVE_STAGE_LOOK_TOP_MEMBER_ABILITY_ID,
    cardCodes: ['PL!HS-bp2-012-N'],
    category: CardAbilityCategory.AUTO,
    sourceZone: CardAbilitySourceZone.STAGE_MEMBER,
    triggerCondition: TriggerCondition.ON_LEAVE_STAGE,
    queued: true,
    implemented: true,
    effectText: HS_BP2_012_LEAVE_STAGE_EFFECT_TEXT,
    notes:
      '首个 AUTO proving card：由舞台到休息室事件入队，复用 look-top inspection 选择成员公开入手、其余进休息室。',
  },
  {
    abilityId: HS_BP6_017_LEAVE_STAGE_RECOVER_LIVE_AND_MEMBER_ABILITY_ID,
    cardCodes: ['PL!HS-bp6-017-N'],
    category: CardAbilityCategory.AUTO,
    sourceZone: CardAbilitySourceZone.STAGE_MEMBER,
    triggerCondition: TriggerCondition.ON_LEAVE_STAGE,
    queued: true,
    implemented: true,
    effectText: HS_BP6_017_LEAVE_STAGE_EFFECT_TEXT,
    notes:
      '复用 ON_LEAVE_STAGE AUTO 入队、弃手费用与休息室选择移动；选择约束为 LIVE 和成员至多各1张。',
  },
  {
    abilityId: HS_SD1_001_RELAY_REPLACED_ACTIVATE_ENERGY_ABILITY_ID,
    cardCodes: ['PL!HS-sd1-001-SD'],
    category: CardAbilityCategory.AUTO,
    sourceZone: CardAbilitySourceZone.STAGE_MEMBER,
    triggerCondition: TriggerCondition.ON_LEAVE_STAGE,
    queued: true,
    implemented: true,
    effectText: HS_SD1_001_RELAY_REPLACED_EFFECT_TEXT,
    notes: '离场 AUTO 仅在本成员被费用>=10的莲之空成员换手替换时入队，解决时活跃2张待机能量。',
  },
  {
    abilityId: HS_PB1_020_ON_ENTER_DISCARD_TWO_RECOVER_CERISE_MEMBER_AND_HASUNOSORA_LIVE_ABILITY_ID,
    cardCodes: ['PL!HS-pb1-020-N'],
    category: CardAbilityCategory.ON_ENTER,
    sourceZone: CardAbilitySourceZone.PLAYED_MEMBER,
    triggerCondition: TriggerCondition.ON_ENTER_STAGE,
    queued: true,
    implemented: true,
    effectText: HS_PB1_020_ON_ENTER_EFFECT_TEXT,
    notes: '复用弃手费用与 WAITING_ROOM -> HAND 分组选择；条件为自己休息室 LIVE >=3。',
  },
  {
    abilityId: HS_PB1_009_ON_HASUNOSORA_ENTER_GAIN_BLADE_ABILITY_ID,
    baseCardCodes: ['PL!HS-pb1-009'],
    category: CardAbilityCategory.AUTO,
    sourceZone: CardAbilitySourceZone.STAGE_MEMBER,
    triggerCondition: TriggerCondition.ON_ENTER_STAGE,
    queued: true,
    implemented: true,
    effectText: HS_PB1_009_ON_HASUNOSORA_ENTER_EFFECT_TEXT,
    requiredSourceSlots: [SlotPosition.CENTER],
    perTurnLimit: 2,
    notes:
      '监听己方「莲之空」成员登场事件；每回合次数按来源卡实例计算，效果段写入 BLADE live modifier。',
  },
  {
    abilityId: HS_PB1_009_LIVE_START_DRAW_DISCARD_ABILITY_ID,
    baseCardCodes: ['PL!HS-pb1-009'],
    category: CardAbilityCategory.LIVE_START,
    sourceZone: CardAbilitySourceZone.STAGE_MEMBER,
    triggerCondition: TriggerCondition.ON_LIVE_START,
    queued: true,
    implemented: true,
    effectText: HS_PB1_009_LIVE_START_EFFECT_TEXT,
    notes:
      'LIVE 开始时用成员有效 BLADE helper 判断印刷 BLADE + 来源归属 BLADE modifier 是否大于等于 8；满足时复用 F02 抽 2 弃 1。',
  },
  {
    abilityId: HS_BP6_004_ON_ENTER_WAIT_OPPONENT_LOW_COST_MEMBER_ABILITY_ID,
    baseCardCodes: ['PL!HS-bp6-004'],
    category: CardAbilityCategory.ON_ENTER,
    sourceZone: CardAbilitySourceZone.PLAYED_MEMBER,
    triggerCondition: TriggerCondition.ON_ENTER_STAGE,
    queued: true,
    implemented: true,
    effectText: HS_BP6_004_WAIT_OPPONENT_LOW_COST_MEMBER_EFFECT_TEXT,
    notes: '复用对手舞台成员目标筛选与成员方向 helper，将对方费用<=9成员变为待机状态。',
  },
  {
    abilityId: HS_BP6_004_LIVE_START_WAIT_OPPONENT_LOW_COST_MEMBER_ABILITY_ID,
    baseCardCodes: ['PL!HS-bp6-004'],
    category: CardAbilityCategory.LIVE_START,
    sourceZone: CardAbilitySourceZone.STAGE_MEMBER,
    triggerCondition: TriggerCondition.ON_LIVE_START,
    queued: true,
    implemented: true,
    effectText: HS_BP6_004_WAIT_OPPONENT_LOW_COST_MEMBER_EFFECT_TEXT,
    notes: '同一文本的 LIVE 开始段复用对手舞台成员目标筛选与成员方向 helper。',
  },
  {
    abilityId: HS_BP6_004_LIVE_START_DISCARD_GAIN_BLADE_ABILITY_ID,
    baseCardCodes: ['PL!HS-bp6-004'],
    category: CardAbilityCategory.LIVE_START,
    sourceZone: CardAbilitySourceZone.STAGE_MEMBER,
    triggerCondition: TriggerCondition.ON_LIVE_START,
    queued: true,
    implemented: true,
    effectText: HS_BP6_004_LIVE_START_DISCARD_GAIN_BLADE_EFFECT_TEXT,
    notes:
      '复用可选弃手费用与 BLADE live modifier；弃置的成员姓名归一化为「百生吟子」时额外获得1个 BLADE。',
  },
  {
    abilityId: SP_BP4_011_ENTER_OR_MOVE_WAIT_OPPONENT_LOW_BLADE_MEMBER_ABILITY_ID,
    baseCardCodes: ['PL!SP-bp4-011'],
    category: CardAbilityCategory.ON_ENTER,
    sourceZone: CardAbilitySourceZone.PLAYED_MEMBER,
    triggerCondition: TriggerCondition.ON_ENTER_STAGE,
    queued: true,
    implemented: true,
    effectText: SP_BP4_011_ENTER_OR_MOVE_WAIT_OPPONENT_LOW_BLADE_MEMBER_EFFECT_TEXT,
    notes: '登场段走自身 ON_ENTER 入队；目标筛选为对方舞台原本 BLADE <= 3 的成员。',
  },
  {
    abilityId: SP_BP4_011_ENTER_OR_MOVE_WAIT_OPPONENT_LOW_BLADE_MEMBER_ABILITY_ID,
    baseCardCodes: ['PL!SP-bp4-011'],
    category: CardAbilityCategory.AUTO,
    sourceZone: CardAbilitySourceZone.STAGE_MEMBER,
    triggerCondition: TriggerCondition.ON_MEMBER_SLOT_MOVED,
    queued: true,
    implemented: true,
    effectText: SP_BP4_011_ENTER_OR_MOVE_WAIT_OPPONENT_LOW_BLADE_MEMBER_EFFECT_TEXT,
    notes:
      '成员区槽位移动/交换段消费 ON_MEMBER_SLOT_MOVED eventLog；同一次登场不作为移动重复触发。',
  },
  {
    abilityId: SHIKI_ON_ENTER_LEFT_DRAW_DISCARD_ABILITY_ID,
    baseCardCodes: ['PL!SP-bp4-008'],
    category: CardAbilityCategory.ON_ENTER,
    sourceZone: CardAbilitySourceZone.PLAYED_MEMBER,
    triggerCondition: TriggerCondition.ON_ENTER_STAGE,
    queued: true,
    implemented: true,
    effectText: SHIKI_LEFT_DRAW_DISCARD_EFFECT_TEXT,
    requiredSourceSlots: [SlotPosition.LEFT],
    notes:
      '来源槽位条件通过 requiredSourceSlots 过滤；复用 F01 draw helper 与手牌进休息室 helper 组成 F02 抽弃。',
  },
  {
    abilityId: SHIKI_ON_ENTER_RIGHT_ACTIVATE_ENERGY_ABILITY_ID,
    baseCardCodes: ['PL!SP-bp4-008'],
    category: CardAbilityCategory.ON_ENTER,
    sourceZone: CardAbilitySourceZone.PLAYED_MEMBER,
    triggerCondition: TriggerCondition.ON_ENTER_STAGE,
    queued: true,
    implemented: true,
    effectText: SHIKI_RIGHT_ENERGY_EFFECT_TEXT,
    requiredSourceSlots: [SlotPosition.RIGHT],
    notes: '来源槽位条件通过 requiredSourceSlots 过滤；当前只接右侧登场 E02 能量活跃段。',
  },
  {
    abilityId: SHIKI_LIVE_START_POSITION_CHANGE_ABILITY_ID,
    baseCardCodes: ['PL!SP-bp4-008'],
    category: CardAbilityCategory.LIVE_START,
    sourceZone: CardAbilitySourceZone.STAGE_MEMBER,
    triggerCondition: TriggerCondition.ON_LIVE_START,
    queued: true,
    implemented: true,
    effectText: SHIKI_LIVE_START_POSITION_CHANGE_EFFECT_TEXT,
    notes: '复用 S05 member-state position change helper；该段为可选站位变换。',
  },
  {
    abilityId: CHISATO_LIVE_START_ACTIVATE_LIELLA_AND_ENERGY_ABILITY_ID,
    baseCardCodes: ['PL!SP-bp5-003'],
    category: CardAbilityCategory.LIVE_START,
    sourceZone: CardAbilitySourceZone.STAGE_MEMBER,
    triggerCondition: TriggerCondition.ON_LIVE_START,
    queued: true,
    implemented: true,
    effectText: CHISATO_LIVE_START_ACTIVATE_EFFECT_TEXT,
    requiredSourceSlots: [SlotPosition.CENTER],
    notes:
      '复用 member-state 与 energy 方向 helper；批量将舞台上的 Liella! 成员和能量区全部能量变为活跃状态。',
  },
  {
    abilityId: EMMA_ON_ENTER_ACTIVATE_MEMBER_OR_ENERGY_ABILITY_ID,
    baseCardCodes: ['PL!N-pb1-008'],
    category: CardAbilityCategory.ON_ENTER,
    sourceZone: CardAbilitySourceZone.PLAYED_MEMBER,
    triggerCondition: TriggerCondition.ON_ENTER_STAGE,
    queued: true,
    implemented: true,
    effectText: EMMA_ON_ENTER_ACTIVATE_MEMBER_OR_ENERGY_EFFECT_TEXT,
    notes:
      '复用 selectableOptions 选择成员/能量分支；成员分支选择舞台成员，能量分支按能量区顺序自动处理，再调用方向 helper 变为活跃。',
  },
  {
    abilityId: YOSHIKO_ON_ENTER_PLAY_LOW_COST_MEMBERS_ABILITY_ID,
    baseCardCodes: ['PL!S-bp2-006'],
    category: CardAbilityCategory.ON_ENTER,
    sourceZone: CardAbilitySourceZone.PLAYED_MEMBER,
    triggerCondition: TriggerCondition.ON_ENTER_STAGE,
    queued: true,
    implemented: true,
    effectText: YOSHIKO_ON_ENTER_PLAY_LOW_COST_MEMBERS_EFFECT_TEXT,
    notes:
      '先支付4能量，再从休息室选择至多2张费用合计<=4的成员，逐张选择空槽登场；不走普通登场费用/换手。',
  },
  {
    abilityId: HS_BP1_006_ON_ENTER_DRAW_DISCARD_ABILITY_ID,
    baseCardCodes: ['PL!HS-bp1-006'],
    category: CardAbilityCategory.ON_ENTER,
    sourceZone: CardAbilitySourceZone.PLAYED_MEMBER,
    triggerCondition: TriggerCondition.ON_ENTER_STAGE,
    queued: true,
    implemented: true,
    effectText: HS_BP1_006_ON_ENTER_EFFECT_TEXT,
    notes: '登场后抽2张卡并将1张手牌放置入休息室；复用 draw helper 与 discard helper。',
  },
  {
    abilityId: HS_BP1_006_ON_ENTER_DRAW_ONE_DISCARD_ONE_ABILITY_ID,
    baseCardCodes: [
      'PL!HS-bp1-010',
      'PL!HS-bp1-014',
      'PL!HS-bp6-020',
      'PL!N-bp1-014',
      'PL!N-bp1-015',
      'PL!N-bp1-019',
      'PL!N-sd1-013',
      'PL!N-sd1-021',
      'PL!N-sd1-022',
    ],
    category: CardAbilityCategory.ON_ENTER,
    sourceZone: CardAbilitySourceZone.PLAYED_MEMBER,
    triggerCondition: TriggerCondition.ON_ENTER_STAGE,
    queued: true,
    implemented: true,
    effectText: HS_BP1_006_ON_ENTER_DRAW_ONE_DISCARD_EFFECT_TEXT,
    notes: '登场后抽1张卡并将1张手牌放置入休息室；复用 draw helper 与 discard helper。',
  },
  {
    abilityId: HS_BP1_006_LIVE_START_DISCARD_GAIN_HEART_ABILITY_ID,
    baseCardCodes: ['PL!HS-bp1-006'],
    category: CardAbilityCategory.LIVE_START,
    sourceZone: CardAbilitySourceZone.STAGE_MEMBER,
    triggerCondition: TriggerCondition.ON_LIVE_START,
    queued: true,
    implemented: true,
    effectText: HS_BP1_006_LIVE_START_EFFECT_TEXT,
    notes:
      'LIVE开始时可弃1手牌；若自己舞台存在其他成员，复用 Heart 颜色选择与 liveModifiers 写入路径。',
  },
  {
    abilityId: HS_BP1_004_ACTIVATED_RECOVER_HASUNOSORA_LIVE_ABILITY_ID,
    baseCardCodes: ['PL!HS-bp1-004'],
    category: CardAbilityCategory.ACTIVATED,
    sourceZone: CardAbilitySourceZone.STAGE_MEMBER,
    queued: false,
    implemented: true,
    effectText: HS_BP1_004_ACTIVATED_EFFECT_TEXT,
    perTurnLimit: 1,
    activatedUi: {
      abilityId: HS_BP1_004_ACTIVATED_RECOVER_HASUNOSORA_LIVE_ABILITY_ID,
      text: '起动：[1回合1次][E][E][E]：从自己的休息室将1张『莲之空』的LIVE卡加入手牌。',
      title: '支付3能量，从自己的休息室将1张莲之空LIVE卡加入手牌',
    },
    notes: '起动每回合1次；复用 TAP_ACTIVE_ENERGY 费用与 WAITING_ROOM -> HAND zone-selection。',
  },
  {
    abilityId: HS_BP1_003_ACTIVATED_RECOVER_LOW_COST_HASUNOSORA_MEMBER_ABILITY_ID,
    baseCardCodes: ['PL!HS-bp1-003'],
    category: CardAbilityCategory.ACTIVATED,
    sourceZone: CardAbilitySourceZone.STAGE_MEMBER,
    queued: false,
    implemented: true,
    effectText: HS_BP1_003_ACTIVATED_EFFECT_TEXT,
    perTurnLimit: 1,
    activatedUi: {
      abilityId: HS_BP1_003_ACTIVATED_RECOVER_LOW_COST_HASUNOSORA_MEMBER_ABILITY_ID,
      text: '起动：[1回合1次][E]：从自己的休息室将1张费用小于等于4的『莲之空』成员卡加入手牌。',
      title: '支付1能量，从自己的休息室将1张低费用莲之空成员加入手牌',
    },
    notes: '起动段复用 TAP_ACTIVE_ENERGY 与 zone-selection。',
  },
  {
    abilityId: HS_BP1_003_CONTINUOUS_THREE_DIFFERENT_HASUNOSORA_SCORE_ABILITY_ID,
    baseCardCodes: ['PL!HS-bp1-003'],
    category: CardAbilityCategory.CONTINUOUS,
    sourceZone: CardAbilitySourceZone.STAGE_MEMBER,
    queued: false,
    implemented: true,
    effectText: HS_BP1_003_CONTINUOUS_EFFECT_TEXT,
    notes:
      '持续修正不进队列；三面均为不同名「莲之空」成员时由 collectLiveModifiers 动态收集为目标玩家 SCORE modifier。',
  },
  {
    abilityId: HS_BP1_004_LIVE_START_PAY_ENERGY_GAIN_BLADE_ABILITY_ID,
    baseCardCodes: ['PL!HS-bp1-004'],
    category: CardAbilityCategory.LIVE_START,
    sourceZone: CardAbilitySourceZone.STAGE_MEMBER,
    triggerCondition: TriggerCondition.ON_LIVE_START,
    queued: true,
    implemented: true,
    effectText: HS_BP1_004_LIVE_START_EFFECT_TEXT,
    notes: 'LIVE开始时可支付1能量；按自己的LIVE区卡牌数量通过 liveModifiers 写入 BLADE。',
  },
  {
    abilityId: BOKUIMA_LIVE_START_REQUIREMENT_ABILITY_ID,
    cardCodes: ['PL!-sd1-022-SD'],
    category: CardAbilityCategory.LIVE_START,
    sourceZone: CardAbilitySourceZone.LIVE_CARD,
    triggerCondition: TriggerCondition.ON_LIVE_START,
    queued: true,
    implemented: true,
    effectText: BOKUIMA_EFFECT_TEXT,
  },
  {
    abilityId: HS_BP5_019_LIVE_START_REQUIREMENT_ABILITY_ID,
    baseCardCodes: ['PL!HS-bp5-019'],
    category: CardAbilityCategory.LIVE_START,
    sourceZone: CardAbilitySourceZone.LIVE_CARD,
    triggerCondition: TriggerCondition.ON_LIVE_START,
    queued: true,
    implemented: true,
    effectText: HS_BP5_019_LIVE_START_EFFECT_TEXT,
    notes:
      'LIVE开始时按自己LIVE卡区中此卡以外的「莲之空」卡数量，通过 REQUIREMENT live modifier 减少绿色必要Heart。',
  },
  {
    abilityId: HS_BP2_022_LIVE_START_SCORE_ABILITY_ID,
    baseCardCodes: ['PL!HS-bp2-022'],
    category: CardAbilityCategory.LIVE_START,
    sourceZone: CardAbilitySourceZone.LIVE_CARD,
    triggerCondition: TriggerCondition.ON_LIVE_START,
    queued: true,
    implemented: true,
    effectText: HS_BP2_022_LIVE_START_EFFECT_TEXT,
    notes: 'LIVE开始时检查休息室「Cerise Bouquet」LIVE数量，满足3张时写入 SCORE live modifier。',
  },
  {
    abilityId: BP4_021_LIVE_START_SUCCESS_SCORE_REQUIREMENT_AND_SCORE_ABILITY_ID,
    cardCodes: ['PL!-bp4-021-L'],
    category: CardAbilityCategory.LIVE_START,
    sourceZone: CardAbilitySourceZone.LIVE_CARD,
    triggerCondition: TriggerCondition.ON_LIVE_START,
    queued: true,
    implemented: true,
    effectText: BP4_021_LIVE_START_EFFECT_TEXT,
    notes:
      'LIVE开始时复用成功 LIVE 分数合计条件；>=6 写入 REQUIREMENT 無Heart -1，>=9 再写入带 liveCardId 的 SCORE +1。',
  },
  {
    abilityId: HS_SD1_006_ON_ENTER_ACTIVATE_ENERGY_RECOVER_LIVE_ABILITY_ID,
    baseCardCodes: ['PL!HS-sd1-006'],
    category: CardAbilityCategory.ON_ENTER,
    sourceZone: CardAbilitySourceZone.PLAYED_MEMBER,
    triggerCondition: TriggerCondition.ON_ENTER_STAGE,
    queued: true,
    implemented: true,
    effectText: HS_SD1_006_ON_ENTER_EFFECT_TEXT,
    notes:
      '登场时用 cardNameAliasIs 判断己方舞台是否存在大泽瑠璃乃/百生吟子/徒町小铃；满足后活跃1张能量并复用 WAITING_ROOM -> HAND 回收「莲之空」LIVE。',
  },
  {
    abilityId: HS_SD1_006_LIVE_START_PAY_ENERGY_GAIN_BLADE_ABILITY_ID,
    baseCardCodes: ['PL!HS-sd1-006'],
    category: CardAbilityCategory.LIVE_START,
    sourceZone: CardAbilitySourceZone.STAGE_MEMBER,
    triggerCondition: TriggerCondition.ON_LIVE_START,
    queued: true,
    implemented: true,
    effectText: HS_SD1_006_LIVE_START_EFFECT_TEXT,
    notes: 'LIVE开始时可支付1能量，通过 liveModifiers 写入 BLADE +2。',
  },
  {
    abilityId: BP4_010_LIVE_START_PAY_ENERGY_GAIN_BLADE_ABILITY_ID,
    baseCardCodes: [
      'PL!-bp4-010',
      'PL!HS-PR-018',
      'PL!HS-cl1-005',
      'PL!N-bp4-013',
      'PL!S-pb1-016',
      'PL!S-pb1-017',
      'PL!S-pb1-018',
      'PL!SP-bp1-006',
      'PL!SP-bp2-019',
      'PL!SP-bp2-022',
    ],
    category: CardAbilityCategory.LIVE_START,
    sourceZone: CardAbilitySourceZone.STAGE_MEMBER,
    triggerCondition: TriggerCondition.ON_LIVE_START,
    queued: true,
    implemented: true,
    effectText: BP4_010_LIVE_START_EFFECT_TEXT,
    notes: 'LIVE开始时可支付1能量，通过 liveModifiers 写入 BLADE +2。',
  },
  {
    abilityId: HS_PR_001_LIVE_START_PAY_TWO_ENERGY_GAIN_BLADE_ABILITY_ID,
    baseCardCodes: ['PL!HS-PR-001'],
    category: CardAbilityCategory.LIVE_START,
    sourceZone: CardAbilitySourceZone.STAGE_MEMBER,
    triggerCondition: TriggerCondition.ON_LIVE_START,
    queued: true,
    implemented: true,
    effectText: HS_PR_001_LIVE_START_EFFECT_TEXT,
    notes: 'LIVE开始时可支付2能量，通过 liveModifiers 写入 BLADE +1。',
  },
  {
    abilityId: HS_BP1_002_ACTIVATED_PLAY_HASUNOSORA_MEMBER_TO_SOURCE_SLOT_ABILITY_ID,
    baseCardCodes: ['PL!HS-bp1-002'],
    category: CardAbilityCategory.ACTIVATED,
    sourceZone: CardAbilitySourceZone.STAGE_MEMBER,
    queued: false,
    implemented: true,
    effectText: HS_BP1_002_ACTIVATED_EFFECT_TEXT,
    activatedUi: {
      abilityId: HS_BP1_002_ACTIVATED_PLAY_HASUNOSORA_MEMBER_TO_SOURCE_SLOT_ABILITY_ID,
      text: '起动：[E][E]并将此成员从舞台放置入休息室：从自己的休息室将1张费用小于等于15的『莲之空』成员登场至原区域。',
      title: '支付2能量并自送，从休息室登场1张莲之空成员到原区域',
    },
    notes: 'P/R 与 RM 文本为“所在区域/曾存在的区域”措辞差异，当前规则行为等价，按基础编号同步。',
  },
  {
    abilityId: HS_BP6_001_ON_ENTER_LOOK_STAGE_PLUS_TWO_ABILITY_ID,
    baseCardCodes: ['PL!HS-bp6-001'],
    category: CardAbilityCategory.ON_ENTER,
    sourceZone: CardAbilitySourceZone.PLAYED_MEMBER,
    triggerCondition: TriggerCondition.ON_ENTER_STAGE,
    queued: true,
    implemented: true,
    effectText: HS_BP6_001_ON_ENTER_EFFECT_TEXT,
    notes: '动态检视张数为结算时己方舞台成员数+2；按基础编号覆盖 P/P+/R+/SEC，含本地全角 R＋。',
  },
  {
    abilityId: PL_BP3_014_ON_ENTER_LOOK_TOP_TWO_ARRANGE_TO_TOP_ABILITY_ID,
    baseCardCodes: [
      'PL!-bp3-014',
      'PL!-bp3-017',
      'PL!-bp3-018',
      'PL!N-bp3-022',
      'PL!N-bp4-016',
      'PL!S-bp6-018',
    ],
    category: CardAbilityCategory.ON_ENTER,
    sourceZone: CardAbilitySourceZone.PLAYED_MEMBER,
    triggerCondition: TriggerCondition.ON_ENTER_STAGE,
    queued: true,
    implemented: true,
    effectText: PL_BP3_014_ON_ENTER_EFFECT_TEXT,
    notes:
      '登场时可选发动；可以将来源成员变为待机状态，检视卡组顶2张，按顺序放回任意张到卡组顶，其余放入休息室。',
  },
  {
    abilityId: HS_BP6_001_LIVE_SUCCESS_CHEER_TO_TOP_ABILITY_ID,
    baseCardCodes: ['PL!HS-bp6-001'],
    category: CardAbilityCategory.LIVE_SUCCESS,
    sourceZone: CardAbilitySourceZone.STAGE_MEMBER,
    triggerCondition: TriggerCondition.ON_LIVE_SUCCESS,
    queued: true,
    implemented: true,
    effectText: HS_BP6_001_LIVE_SUCCESS_EFFECT_TEXT,
    notes:
      '首个舞台成员来源 LIVE_SUCCESS；复用声援公开卡选择 helper，将仍在处理区的公开声援卡可选放回卡组顶。',
  },
  {
    abilityId: HS_CL1_009_LIVE_SUCCESS_CHEER_MEMBER_TO_HAND_ABILITY_ID,
    cardCodes: ['PL!HS-cl1-009-CL'],
    category: CardAbilityCategory.LIVE_SUCCESS,
    sourceZone: CardAbilitySourceZone.LIVE_CARD,
    triggerCondition: TriggerCondition.ON_LIVE_SUCCESS,
    queued: true,
    implemented: true,
    effectText: HS_CL1_009_LIVE_SUCCESS_EFFECT_TEXT,
    notes: '复用声援公开卡选择 helper，从仍在处理区的公开声援卡中筛选费用4-9成员加入手牌。',
  },
  {
    abilityId: HS_BP6_027_ON_CHEER_ADDITIONAL_CHEER_ABILITY_ID,
    cardCodes: ['PL!HS-bp6-027-L'],
    category: CardAbilityCategory.AUTO,
    sourceZone: CardAbilitySourceZone.LIVE_CARD,
    triggerCondition: TriggerCondition.ON_CHEER,
    queued: true,
    implemented: true,
    effectText: HS_BP6_027_ON_CHEER_EFFECT_TEXT,
    perTurnLimit: 1,
    notes:
      '新增 ON_CHEER 边界；选择至多3张本次声援公开且仍在处理区的无 BLADE HEART「莲之空」卡入休息室，并追加等量声援。追加声援不再二次触发 ON_CHEER。',
  },
  {
    abilityId: HS_BP6_031_LIVE_START_RECYCLE_MIRACRA_MEMBERS_GAIN_BLADE_ABILITY_ID,
    baseCardCodes: ['PL!HS-bp6-031'],
    category: CardAbilityCategory.LIVE_START,
    sourceZone: CardAbilitySourceZone.LIVE_CARD,
    triggerCondition: TriggerCondition.ON_LIVE_START,
    queued: true,
    implemented: true,
    effectText: HS_BP6_031_LIVE_START_EFFECT_TEXT,
    notes:
      'LIVE 开始时可将自己休息室全部成员洗回主卡组底；若其中みらくらぱーく！成员>=15，则选择舞台安养寺姬芽写入 BLADE live modifier。',
  },
  {
    abilityId: HS_PB1_012_ON_ENTER_RECYCLE_MEMBERS_RECOVER_LIVE_GAIN_BLADE_ABILITY_ID,
    baseCardCodes: ['PL!HS-pb1-012'],
    category: CardAbilityCategory.ON_ENTER,
    sourceZone: CardAbilitySourceZone.PLAYED_MEMBER,
    triggerCondition: TriggerCondition.ON_ENTER_STAGE,
    queued: true,
    implemented: true,
    effectText: HS_PB1_012_ON_ENTER_EFFECT_TEXT,
    notes:
      '登场时双方各自将休息室成员洗回主卡组底；合计>=20时复用 WAITING_ROOM -> HAND 回收自己休息室LIVE，并通过 BLADE live modifier 获得+2。无LIVE目标时仍获得BLADE。',
  },
  {
    abilityId: N_BP4_018_MAIN_PHASE_ACTIVE_TO_WAITING_DRAW_DISCARD_ABILITY_ID,
    cardCodes: ['PL!N-bp4-018-N'],
    category: CardAbilityCategory.AUTO,
    sourceZone: CardAbilitySourceZone.STAGE_MEMBER,
    triggerCondition: TriggerCondition.ON_MEMBER_STATE_CHANGED,
    queued: true,
    implemented: true,
    perTurnLimit: 1,
    effectText: N_BP4_018_ACTIVE_TO_WAITING_EFFECT_TEXT,
    notes:
      '消费 ON_MEMBER_STATE_CHANGED；仅自己主要阶段中此成员自身从 ACTIVE -> WAITING 时入队，效果复用抽1弃1 helper。',
  },
  {
    abilityId: PB1_015_OWN_EFFECT_WAIT_OPPONENT_LOW_COST_DRAW_ABILITY_ID,
    baseCardCodes: ['PL!-pb1-015'],
    category: CardAbilityCategory.AUTO,
    sourceZone: CardAbilitySourceZone.STAGE_MEMBER,
    triggerCondition: TriggerCondition.ON_MEMBER_STATE_CHANGED,
    queued: true,
    implemented: true,
    effectText: PB1_015_OWN_EFFECT_WAIT_OPPONENT_LOW_COST_EFFECT_TEXT,
    perTurnLimit: 1,
    notes:
      '消费带 CARD_EFFECT cause 的 ON_MEMBER_STATE_CHANGED；自己的卡效使对方费用<=4成员 ACTIVE -> WAITING 时抽1。',
  },
  {
    abilityId: HS_BP5_008_ON_ENTER_WAIT_DISCARD_LOOK_TOP_ABILITY_ID,
    baseCardCodes: ['PL!HS-bp5-008'],
    category: CardAbilityCategory.ON_ENTER,
    sourceZone: CardAbilitySourceZone.PLAYED_MEMBER,
    triggerCondition: TriggerCondition.ON_ENTER_STAGE,
    queued: true,
    implemented: true,
    effectText: HS_BP5_008_ON_ENTER_EFFECT_TEXT,
    notes:
      '登场时可将来源成员变为待机状态并弃1手牌；看顶5张，用 costGte(9)+「莲之空」成员 selector 公开加入手牌，其余放置入休息室。',
  },
  {
    abilityId: HS_PB1_004_ON_ENTER_PAY_ENERGY_DISCARD_MILL_RECOVER_CERISE_LIVE_ABILITY_ID,
    baseCardCodes: ['PL!HS-pb1-004'],
    category: CardAbilityCategory.ON_ENTER,
    sourceZone: CardAbilitySourceZone.PLAYED_MEMBER,
    triggerCondition: TriggerCondition.ON_ENTER_STAGE,
    queued: true,
    implemented: true,
    effectText: HS_PB1_004_ON_ENTER_EFFECT_TEXT,
    notes:
      '登场时可支付1能量并弃1手牌；堆顶3后复用 unitAliasIs(Cerise Bouquet)+WAITING_ROOM -> HAND 回收LIVE。',
  },
  {
    abilityId: HS_PR_019_ON_ENTER_MILL_GAIN_GREEN_HEART_ABILITY_ID,
    baseCardCodes: ['PL!HS-PR-019'],
    category: CardAbilityCategory.ON_ENTER,
    sourceZone: CardAbilitySourceZone.PLAYED_MEMBER,
    triggerCondition: TriggerCondition.ON_ENTER_STAGE,
    queued: true,
    implemented: true,
    effectText: HS_PR_019_ON_ENTER_EFFECT_TEXT,
    notes:
      '登场堆顶3；若堆入的3张均为持有绿色Heart的成员，则通过 liveModifiers 获得绿色Heart。PR/RM中文措辞不同但按同一基础编号同步。',
  },
  {
    abilityId: KARIN_LIVE_START_ABILITY_ID,
    baseCardCodes: ['PL!N-pb1-004'],
    category: CardAbilityCategory.LIVE_START,
    sourceZone: CardAbilitySourceZone.STAGE_MEMBER,
    triggerCondition: TriggerCondition.ON_LIVE_START,
    queued: true,
    implemented: true,
    effectText: KARIN_EFFECT_TEXT,
    notes: '测试用虹咲样例卡，保留在同一分类表中验证 LIVE开始队列共性。',
  },
];
