import {
  AI_BATTLE_PHASE_ZERO_DECKS,
  type AiBattlePhaseZeroDeckKey,
} from './phase-zero-baseline.js';
import { AI_BATTLE_PROTOCOL_VERSIONS } from '../../shared/ai-battle-protocol-versions.js';

export const AI_COMPACT_RULES_VERSION = AI_BATTLE_PROTOCOL_VERSIONS.knowledge.compactRules;
export const AI_MUSE_STARTER_PLAYBOOK_VERSION =
  AI_BATTLE_PROTOCOL_VERSIONS.knowledge.museStarterPlaybook;
export const AI_GREEN_HASUNOSORA_B6_PLAYBOOK_VERSION =
  AI_BATTLE_PROTOCOL_VERSIONS.knowledge.greenHasunosoraB6Playbook;

export interface AiStrategyDirective {
  readonly directiveId: string;
  readonly text: string;
}

export interface AiCompactRules {
  readonly version: typeof AI_COMPACT_RULES_VERSION;
  readonly authorityBoundary: readonly AiStrategyDirective[];
  readonly turnFlow: readonly AiStrategyDirective[];
  readonly decisionRules: readonly AiStrategyDirective[];
  readonly victoryRules: readonly AiStrategyDirective[];
}

export interface AiPlaybookCardRole {
  readonly cardCode: string;
  readonly label: string;
  /** Stable machine tags used by deterministic policy; never parse display prose for behavior. */
  readonly roleTags: readonly string[];
  /** Plain player-language descriptions sent to the model. */
  readonly roles: readonly string[];
}

export interface AiDeckPlaybook {
  readonly version:
    typeof AI_MUSE_STARTER_PLAYBOOK_VERSION | typeof AI_GREEN_HASUNOSORA_B6_PLAYBOOK_VERSION;
  readonly deckKey: AiBattlePhaseZeroDeckKey;
  readonly certifiedContentHash: string;
  readonly archetype: string;
  readonly primaryPlan: readonly AiStrategyDirective[];
  readonly mulliganPlan: readonly AiStrategyDirective[];
  readonly mainPhasePlan: readonly AiStrategyDirective[];
  readonly livePlan: readonly AiStrategyDirective[];
  readonly optionalEffectPlan: readonly AiStrategyDirective[];
  readonly recoveryPlan: readonly AiStrategyDirective[];
  readonly cardRoles: readonly AiPlaybookCardRole[];
}

export const AI_COMPACT_RULES: AiCompactRules = {
  version: AI_COMPACT_RULES_VERSION,
  authorityBoundary: [
    directive(
      'AUTHORITY_ONLY',
      '是否合法、支付多少费用、效果如何处理、卡牌如何移动、分数和胜负，都以游戏系统给出的结果为准。'
    ),
    directive(
      'CONTRACT_ONLY',
      '每次只从当前列表里已有的卡牌、动作、选项、位置或数字中选择，不要自己编造选项。'
    ),
    directive(
      'NO_RAW_COMMANDS',
      '不要自己编造游戏指令、卡牌内部编号、移动结果、费用结果或规则解释。'
    ),
    directive(
      'LATEST_OBSERVATION',
      '先看当前局面和眼前这次选择；旧记录和卡组打法都不能覆盖当前事实。'
    ),
  ],
  turnFlow: [
    directive('PENDING_FIRST', '存在待处理效果、费用或确认窗口时，必须先完成当前窗口。'),
    directive('ACTIVE_PHASE', '每名玩家进入自己的活跃阶段时，规则会恢复符合条件的成员和能量。'),
    directive(
      'ENERGY_PHASE',
      '每名玩家进入自己的能量阶段时，规则会从能量卡组放置能量；具体结果以当前状态为准。'
    ),
    directive(
      'MAIN_PHASE',
      '主要阶段每完成一个动作后，只要阶段仍未结束，系统会根据新局面重新给出合法动作。选择结束主要阶段后，本阶段不能再登场成员或发动起动能力。'
    ),
    directive(
      'LIVE_SET',
      'LIVE 放置阶段只能使用当前列表中的 LIVE；放好本次真正想演出的卡后再确认。'
    ),
    directive(
      'PERFORMANCE',
      'LIVE 翻开后，依次处理 LIVE 开始效果、声援、判定、LIVE 成功效果、分数确认和回合结束。'
    ),
  ],
  decisionRules: [
    directive(
      'ENERGY',
      '只有活跃能量可以支付费用；待机能量要先被效果或活跃阶段恢复。活跃能量不会因为留到下个自己的活跃阶段而额外增加。'
    ),
    directive(
      'ABILITY_COSTS',
      '卡效中，时点图标后、冒号“：”前的行动是发动费用；必须按文本顺序完整支付后，才能处理冒号后的效果。无法完整支付时不能发动；费用写“可以”时可以选择不发动，但不能只支付其中一部分。'
    ),
    directive(
      'ENERGY_COST_TOKEN',
      '卡文费用中的每个[E]或{{icon_energy.png|E}}都表示将自己能量区1张活跃能量变为待机，多个能量图标要支付对应张数。例如“【登场】[E]可以将1张手牌放置入休息室：……”若选择发动，必须支付1张活跃能量并将1张手牌放入休息室。'
    ),
    directive(
      'STAGE',
      '舞台有左、中央、右三个成员区。舞台成员在 LIVE 中提供当前有效 HEART、BLADE 和卡效；费用也会影响以后换手能减少多少支付。'
    ),
    directive(
      'MEMBER_STATS',
      '成员的费用、BLADE、HEART、卡文和站位是不同信息。成员数量相同不代表场面强度相同。'
    ),
    directive(
      'RELAY',
      '登场成员时，如果当前合法动作写明换手，会把指定舞台成员放入休息室，并按该成员当前有效费用减少本次需要支付的能量。换手后的基础支付量＝登场成员当前有效费用－换手成员当前有效费用，结果最低为0；例如费用9的成员换手费用4的成员，仍须支付5张活跃能量。实际支付与替换对象以动作说明为准。'
    ),
    directive(
      'STAGE_SLOT_LOCK',
      '本回合刚从非舞台区域登场到某成员区的成员，会使该成员区在本回合不能再次用于普通成员登场；系统已经从合法动作中排除这种选择。'
    ),
    directive(
      'COMPLETE_CURRENT_CHOICES',
      '当前选择列表是这个窗口的完整合法选择。手牌中没有对应登场动作的成员当前不能登场；局面改变后，系统会重新计算下一次选择列表。'
    ),
    directive('HEARTS', '只有当前场面提供的 HEART 在修正后满足颜色和总数要求，LIVE 才会成功。'),
    directive(
      'TIMING_EFFECTS',
      '登场、LIVE 开始、LIVE 成功等时点能力只能在对应窗口处理。当前窗口跳过或完成后，不能把同一次时点能力留到以后再次发动。'
    ),
    directive(
      'HIDDEN_INFORMATION',
      '不要猜测背面卡牌的身份和顺序；没有公开区别的背面卡，在策略上按同等处理。'
    ),
    directive('ONE_DECISION', '每次只提交一个当前允许的选择，处理完成后再根据新局面继续判断。'),
  ],
  victoryRules: [
    directive(
      'LIVE_ROUND_WINNER',
      '系统比较双方本次 LIVE 总分，由获胜方把一张成功的 LIVE 放入成功 LIVE 区。'
    ),
    directive('THREE_SUCCESS_LIVES', '核心胜利目标是在对方之前，让自己的成功 LIVE 区达到 3 张。'),
  ],
};

export const AI_DECK_PLAYBOOKS: Readonly<Record<AiBattlePhaseZeroDeckKey, AiDeckPlaybook>> = {
  MUSE_STARTER: {
    version: AI_MUSE_STARTER_PLAYBOOK_VERSION,
    deckKey: 'MUSE_STARTER',
    certifiedContentHash: AI_BATTLE_PHASE_ZERO_DECKS.MUSE_STARTER.contentHash,
    archetype:
      "μ's 均衡卡组：用低费成员建立舞台，通过检视和休息室回收维持手牌，再利用成功 LIVE 区获得后期收益。",
    primaryPlan: [
      directive(
        'MUSE_BUILD_STAGE',
        '先用负担得起的成员填充舞台，再逐步换成 BLADE 更高的成员；不要为了单次展开耗尽手牌。'
      ),
      directive(
        'MUSE_FIND_LIVES',
        '通过检视卡组顶和休息室回收，让手里尽量保留至少 1 张下一回合可演出的 LIVE。'
      ),
      directive(
        'MUSE_SCALE_SUCCESS',
        '成功 LIVE 区有卡后，优先考虑会随成功 LIVE 数量变强的穗乃果和后期 LIVE。'
      ),
      directive(
        'MUSE_FILL_WAITING',
        '把有计划的堆墓和弃置低价值卡当作回收准备，但不要为了增加休息室数量破坏当前场面。'
      ),
    ],
    mulliganPlan: [
      directive(
        'MUSE_KEEP_EARLY_MEMBER',
        '至少保留 1 张费用 2 或费用 4 的成员，确保前几个主要阶段能建立舞台。'
      ),
      directive(
        'MUSE_KEEP_LIVE',
        '保留 1 张近期有机会成功的 LIVE；没有前期成员时，不要留下多张高要求 LIVE。'
      ),
      directive(
        'MUSE_RETURN_REDUNDANT_TOP_END',
        '优先换回重复的费用 11 以上成员和重复的后期 LIVE，不要先换掉唯一的前期成员。'
      ),
    ],
    mainPhasePlan: [
      directive(
        'MUSE_OCCUPY_EMPTY_SLOTS',
        '优先用低费成员填空成员区，不要先替换仍有用的场上成员。'
      ),
      directive(
        'MUSE_LOOK_TOP_VALUE',
        '手牌质量较差，或检视能明显改善下一次登场和 LIVE 时，再使用海未等检视卡组顶的成员。'
      ),
      directive(
        'MUSE_RECOVERY_VALUE',
        '只有休息室里已有比当前场上成员更值得拿回的目标时，才使用费用 2 绘里或花阳的自送回收能力。'
      ),
      directive(
        'MUSE_LATE_NICO',
        '休息室达到 25 张后再重视费用 15 妮可；条件未满足时优先用更便宜的成员建设舞台。'
      ),
    ],
    livePlan: [
      directive(
        'MUSE_EARLY_LIVE',
        '前期优先选择当前 HEART 能满足的低要求 LIVE，不要勉强演出明显无法成功的高要求 LIVE。'
      ),
      directive(
        'MUSE_START_DASH',
        '前期没有更好选择时，用 START:DASH!! 争取一次容易成功的演出，并利用成功后的卡组顶整理。'
      ),
      directive(
        'MUSE_LATE_BOKURA',
        '成功 LIVE 已经足够降低 HEART 要求时，再优先演出「僕らは今のなかで」。'
      ),
      directive(
        'MUSE_MULTI_SET',
        '可以放多张 LIVE 时，至少保留一条当前能成功的路线；不要没有收益地把以后要用的 LIVE 全部押上。'
      ),
    ],
    optionalEffectPlan: [
      directive(
        'MUSE_DISCARD_FOR_SELECTION',
        '只有弃牌后仍有足够手牌支持下一次成员登场和 LIVE，才支付检视效果的可选弃牌费用。'
      ),
      directive(
        'MUSE_HEART_COLOR',
        '处理小鸟的 LIVE 开始 HEART 选择时，补当前最重要 LIVE 仍缺少的颜色。'
      ),
      directive(
        'MUSE_SUCCESS_SWAP',
        '只有公开的手牌 LIVE 放进成功区后不比被换回的卡差，才使用真姬的 LIVE 交换。'
      ),
    ],
    recoveryPlan: [
      directive(
        'MUSE_NO_LIVE',
        '手里没有 LIVE 时，优先用海未、绘里、花阳或其他检索补充 LIVE，不要先把资源花在收益很小的换人上。'
      ),
      directive(
        'MUSE_LOW_HAND',
        '手牌较少时，除非弃牌后能马上拿到需要的卡，否则不要支付可选弃牌费用。'
      ),
    ],
    cardRoles: [
      cardRole(
        'PL!-sd1-002-SD',
        '费用 2「絢瀬 絵里」',
        ['EARLY_MEMBER', 'MEMBER_RECOVERY'],
        ['前期低费成员', '从休息室回收成员']
      ),
      cardRole(
        'PL!-sd1-004-SD',
        '费用 11「園田海未」',
        ['LIVE_SEARCH', 'MIDGAME_BLADE'],
        ['寻找 LIVE', '中期 BLADE']
      ),
      cardRole(
        'PL!-sd1-005-SD',
        '费用 2「星空 凛」',
        ['EARLY_MEMBER', 'LIVE_RECOVERY'],
        ['前期低费成员', '从休息室回收 LIVE']
      ),
      cardRole(
        'PL!-sd1-009-SD',
        '费用 15「矢澤 にこ」',
        ['LATE_WAITING_ROOM_PAYOFF', 'LIVE_SCORE_MODIFIER'],
        ['后期休息室收益', 'LIVE 分数增加']
      ),
      cardRole(
        'PL!-sd1-001-SD',
        '费用 11「高坂 穂乃果」',
        ['SUCCESS_ZONE_PAYOFF', 'HIGH_BLADE'],
        ['成功 LIVE 区收益', '高 BLADE']
      ),
      cardRole(
        'PL!-sd1-019-SD',
        '分数 1「START:DASH!!」',
        ['EARLY_ACHIEVABLE_LIVE', 'TOP_DECK_SETUP'],
        ['前期易成功 LIVE', '整理卡组顶']
      ),
      cardRole(
        'PL!-sd1-022-SD',
        '分数 4「僕らは今のなかで」',
        ['LATE_HIGH_SCORE_LIVE', 'SUCCESS_ZONE_REQUIREMENT_SCALING'],
        ['后期高分 LIVE', '随成功 LIVE 区降低要求']
      ),
    ],
  },
  GREEN_HASUNOSORA_B6: {
    version: AI_GREEN_HASUNOSORA_B6_PLAYBOOK_VERSION,
    deckKey: 'GREEN_HASUNOSORA_B6',
    certifiedContentHash: AI_BATTLE_PHASE_ZERO_DECKS.GREEN_HASUNOSORA_B6.contentHash,
    archetype:
      '绿色莲之空卡组：一边保持舞台成员，一边有计划地增加休息室资源，通过多次登场、回收和 BLADE 支持高分 LIVE。',
    primaryPlan: [
      directive(
        'GREEN_FILL_WAITING',
        '有计划地增加休息室资源，让成员/LIVE 回收和条件 LIVE 能稳定发挥；不要为了堆休息室而白白清空舞台。'
      ),
      directive(
        'GREEN_REPEAT_ENTRIES',
        '用换手、自送、回收和效果登场增加莲之空成员的登场次数，但要保证效果处理后舞台仍有足够成员。'
      ),
      directive(
        'GREEN_CENTER_KAHO',
        '能负担时，将费用 15 花帆登场到中央，再用之后的莲之空成员登场触发最多两次 BLADE 增加。'
      ),
      directive(
        'GREEN_DISTINCT_STAGE',
        '条件允许时，舞台保留 3 名不同名字的莲之空成员，为梓的 LIVE 总分增加做准备。'
      ),
    ],
    mulliganPlan: [
      directive(
        'GREEN_KEEP_LOW_COST',
        '至少保留 1 张费用 2 或费用 4 的成员，优先保留能在不丢失场面的前提下建立休息室的卡。'
      ),
      directive(
        'GREEN_KEEP_LIVE',
        '保留 1 张近期有机会成功的 LIVE，尤其是「水彩世界」，或条件能达成时的「アオクハルカ」。'
      ),
      directive(
        'GREEN_RETURN_TOP_END',
        '除非已有前期登场路线和足够的后续能量，否则优先换回重复的费用 11～15 成员。'
      ),
    ],
    mainPhasePlan: [
      directive(
        'GREEN_SEED_WITH_LOW_COST',
        '先用低费花帆、吟子和泉占住成员区，并在不损失场面的情况下增加休息室，再投入高费主力。'
      ),
      directive(
        'GREEN_RELAY_SD1_KAHO',
        '只有换手费用 9 花帆、恢复 2 能量后还能多做一个有价值的动作时，才换成费用 10 以上的莲之空成员。'
      ),
      directive(
        'GREEN_RECOVER_SELECTIVELY',
        '只有休息室里已有能立即推进当前计划的成员或 LIVE，且回收收益足以补偿离场损失时，才发动自送回收能力。'
      ),
      directive(
        'GREEN_CENTER_AND_NAMES',
        '费用 15 花帆优先放在中央；追求梓的分数增加时，尽量保留 3 个不同的成员名字。'
      ),
    ],
    livePlan: [
      directive(
        'GREEN_HANAMUSUBI',
        'LIVE 区已有其他莲之空卡，且绿 HEART 要求降低后能安全拿到 6 分时，优先「ハナムスビ」。'
      ),
      directive(
        'GREEN_AOKUHARUKA',
        '休息室至少有 3 张 Cerise Bouquet LIVE，能获得分数 +1 后，再优先「アオクハルカ」。'
      ),
      directive(
        'GREEN_TSUKIYOMI',
        '舞台能提供「月夜見海月」需要的 HEART，且追加声援能改善判定又不会丢掉关键 BLADE HEART 卡时再使用。'
      ),
      directive(
        'GREEN_SUISAII',
        '前期用「水彩世界」争取容易成功的演出，并利用成功后从声援卡回收费用 4～9 莲之空成员的机会。'
      ),
    ],
    optionalEffectPlan: [
      directive(
        'GREEN_DISCARD_AS_RESOURCE',
        '只有弃手能为休息室准备有用目标，并且剩余手牌足够支持下一次登场和 LIVE 时，才支付可选弃牌费用。'
      ),
      directive(
        'GREEN_HIME_ENERGY',
        '只有姬芽的 BLADE +2 能明显改善当前 LIVE 判定，且不会占用更重要的能量时，才支付她的 LIVE 开始能量。'
      ),
      directive(
        'GREEN_CHEER_SELECTION',
        '根据当前 LIVE 需求处理声援卡；不要弃置本次判定需要的 BLADE HEART 卡。'
      ),
    ],
    recoveryPlan: [
      directive(
        'GREEN_NO_ENGINE',
        '休息室还没有可用目标时，优先使用泉或其他低费堆墓卡，不要先打出高费回收卡。'
      ),
      directive(
        'GREEN_LOW_HAND',
        '手牌较少时，除非两组回收都有有用目标，否则不要弃 2 张手牌发动回收。'
      ),
      directive(
        'GREEN_BROKEN_STAGE',
        '3 个不同名字的成员或中央花帆计划无法继续时，保留还打得出的成员，改为追求最容易成功的 LIVE，不要强行组合。'
      ),
    ],
    cardRoles: [
      cardRole(
        'PL!HS-sd1-001-SD',
        '费用 9「日野下花帆」',
        ['RELAY_ENERGY_RECOVERY', 'MID_COST_BRIDGE'],
        ['换手后恢复能量', '中费过渡']
      ),
      cardRole(
        'PL!HS-bp6-001-R+',
        '费用 4「日野下花帆」',
        ['TOP_DECK_SELECTION', 'CHEER_CARD_REUSE'],
        ['整理卡组顶', '再利用声援卡']
      ),
      cardRole(
        'PL!HS-bp5-008-R',
        '费用 4「桂城 泉」',
        ['HIGH_COST_MEMBER_SEARCH', 'WAITING_ROOM_SETUP'],
        ['寻找高费成员', '增加休息室']
      ),
      cardRole(
        'PL!HS-pb1-009-R',
        '费用 15「日野下花帆」',
        ['CENTER_PAYOFF', 'MEMBER_ENTRY_BLADE_ENGINE'],
        ['中央主力', '成员登场后增加 BLADE']
      ),
      cardRole(
        'PL!HS-bp1-003-SEC',
        '费用 13「乙宗 梢」',
        ['DISTINCT_NAME_STAGE_PAYOFF', 'LOW_COST_RECOVERY'],
        ['不同成员名字收益', '回收低费成员']
      ),
      cardRole(
        'PL!HS-bp5-019-L',
        '分数 6「ハナムスビ」',
        ['PRIMARY_HIGH_SCORE_LIVE', 'MULTI_LIVE_REQUIREMENT_REDUCTION'],
        ['主力高分 LIVE', '按 LIVE 区卡数降低要求']
      ),
      cardRole(
        'PL!HS-bp2-022-L+',
        '分数 2「アオクハルカ」',
        ['WAITING_ROOM_CONDITION_LIVE', 'SCORE_MODIFIER'],
        ['休息室条件 LIVE', '条件达成后加分']
      ),
      cardRole(
        'PL!HS-cl1-009-CL',
        '分数 1「水彩世界」',
        ['EARLY_ACHIEVABLE_LIVE', 'CHEER_RECOVERY'],
        ['前期易成功 LIVE', '从声援卡回收成员']
      ),
    ],
  },
};

export function getAiDeckPlaybook(deckKey: AiBattlePhaseZeroDeckKey): AiDeckPlaybook {
  return AI_DECK_PLAYBOOKS[deckKey];
}

function directive(directiveId: string, text: string): AiStrategyDirective {
  return { directiveId, text };
}

function cardRole(
  cardCode: string,
  label: string,
  roleTags: readonly string[],
  roles: readonly string[]
): AiPlaybookCardRole {
  return { cardCode, label, roleTags, roles };
}
