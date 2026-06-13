import {
  CardType,
  GamePhase,
  HeartColor,
  OrientationState,
  SlotPosition,
  SubPhase,
  TriggerCondition,
  ZoneType,
} from '../shared/types/enums.js';
import { isLiveCardData, isMemberCardData, type CardInstance } from '../domain/entities/card.js';
import type { ActiveEffectState, GameState, PendingAbilityState } from '../domain/entities/game.js';
import {
  addAction,
  getCardById,
  getOpponent,
  getPlayerById,
  updatePlayer,
} from '../domain/entities/game.js';
import { addCardToZone } from '../domain/entities/zone.js';
import {
  addLiveModifier,
  getMemberEffectiveBladeCount,
  replaceLiveModifier,
} from '../domain/rules/live-modifiers.js';
import {
  createWaitingRoomToHandEffectState,
  createWaitingRoomToHandSelectionConfig,
  getZoneSelectionConfig,
  moveSelectedCardsFromZone,
  selectWaitingRoomCardIds,
} from './effects/zone-selection.js';
import { and, cardNameIs, costLte, groupIs, typeIs } from './effects/card-selectors.js';
import {
  moveHandCardToWaitingRoomForEffect,
  payImmediateEffectCosts,
  type EffectCostDefinition,
} from './effects/effect-costs.js';
import {
  clearInspectionCards,
  inspectTopCards,
  moveInspectedCardsToWaitingRoom,
  moveInspectedSelectionToHandRestToWaitingRoom,
  moveTopDeckCardsToWaitingRoom,
} from './effects/look-top.js';
import {
  moveMemberBetweenSlots,
  playMembersFromWaitingRoomToEmptySlots,
  setMemberOrientation,
  setMembersOrientation,
} from './effects/member-state.js';
import { drawCardsFromMainDeckToHand } from './effects/draw.js';
import { getStageMemberCardIdsMatching } from './effects/stage-targets.js';
import {
  placeEnergyFromDeckToZone,
  setEnergyOrientation,
  setFirstEnergyCardsOrientation,
} from './effects/energy.js';
import type { EnterStageEvent, LeaveStageEvent } from '../domain/events/game-events.js';

export const ABILITY_ORDER_SELECTION_ID = 'system:select-pending-card-effect';
export const NOZOMI_ON_ENTER_ABILITY_ID = 'PL!-sd1-007-SD:on-enter-mill-five-draw-if-live';
export const UMI_ON_ENTER_ABILITY_ID = 'PL!-sd1-004-SD:on-enter-look-five-take-muse-live';
export const HONOKA_ON_ENTER_ABILITY_ID = 'PL!-sd1-001-SD:on-enter-take-live-if-two-success';
export const KOTORI_ON_ENTER_ABILITY_ID = 'PL!-sd1-003-SD:on-enter-take-low-cost-muse-member';
export const MAKI_ON_ENTER_ABILITY_ID = 'PL!-sd1-006-SD:on-enter-swap-hand-live-success-live';
export const GENERIC_DISCARD_LOOK_TOP_ABILITY_ID = 'PL!-sd1:discard-one-look-top-take-one';
export const LL_BP1_001_ON_ENTER_RECOVER_MEMBER_ABILITY_ID = 'LL-bp1-001-R+:on-enter-take-member';
export const HS_BP1_006_ON_ENTER_DRAW_DISCARD_ABILITY_ID =
  'PL!HS-bp1-006-P:on-enter-draw-two-discard-one';
export const KARIN_LIVE_START_ABILITY_ID = 'PL!N-pb1-004-P+:live-start-reveal-top-member';
export const KOTORI_LIVE_START_HEART_ABILITY_ID = 'PL!-sd1-003-SD:live-start-discard-gain-heart';
export const NICO_LIVE_START_SCORE_ABILITY_ID = 'PL!-sd1-009-SD:live-start-score-plus-if-25-muse';
export const BOKUIMA_LIVE_START_REQUIREMENT_ABILITY_ID =
  'PL!-sd1-022-SD:live-start-reduce-requirement-by-success-live';
export const ELI_ACTIVATED_ABILITY_ID =
  'PL!-sd1-002-SD:activated-send-self-to-waiting-room-add-member';
export const RIN_ACTIVATED_ABILITY_ID =
  'PL!-sd1-005-SD:activated-send-self-to-waiting-room-add-live';
export const BP4_003_ACTIVATED_ABILITY_ID =
  'PL!-bp4-003-P:activated-send-self-to-waiting-room-add-live';
export const PB1_019_ACTIVATED_ABILITY_ID =
  'PL!-pb1-019-N:activated-send-self-to-waiting-room-add-member';
export const HANAYO_ACTIVATED_ABILITY_ID = 'PL!-sd1-008-SD:activated-pay-two-mill-ten';
export const START_DASH_LIVE_SUCCESS_ABILITY_ID = 'PL!-sd1-019-SD:live-success-start-dash';
export const KEKE_ON_ENTER_PLACE_WAITING_ENERGY_ABILITY_ID =
  'PL!SP-PR-004-PR:on-enter-discard-place-waiting-energy';
export const BP3_010_ON_ENTER_LOOK_LIVE_EFFECT_ID = 'PL!-bp3-010-N:on-enter-look-top-reveal-live';
export const SHIKI_ON_ENTER_LEFT_DRAW_DISCARD_ABILITY_ID =
  'PL!SP-bp4-008-P:on-enter-left-draw-two-discard-one';
export const SHIKI_ON_ENTER_RIGHT_ACTIVATE_ENERGY_ABILITY_ID =
  'PL!SP-bp4-008-P:on-enter-right-activate-two-energy';
export const SHIKI_LIVE_START_POSITION_CHANGE_ABILITY_ID =
  'PL!SP-bp4-008-P:live-start-position-change';
export const HS_BP2_002_ON_ENTER_RECOVER_LOW_COST_MEMBER_ABILITY_ID =
  'PL!HS-bp2-002-P:on-enter-take-up-to-two-low-cost-members';
export const HS_BP2_012_LEAVE_STAGE_LOOK_TOP_MEMBER_ABILITY_ID =
  'PL!HS-bp2-012-N:auto-leave-stage-look-five-take-member';
export const HS_BP6_017_LEAVE_STAGE_RECOVER_LIVE_AND_MEMBER_ABILITY_ID =
  'PL!HS-bp6-017-N:auto-leave-stage-discard-recover-live-and-member';
export const HS_PB1_009_ON_HASUNOSORA_ENTER_GAIN_BLADE_ABILITY_ID =
  'PL!HS-pb1-009-R:auto-center-hasunosora-enter-gain-two-blade';
export const HS_PB1_009_LIVE_START_DRAW_DISCARD_ABILITY_ID =
  'PL!HS-pb1-009-R:live-start-draw-two-discard-if-eight-blade';
export const HS_BP6_004_ON_ENTER_WAIT_OPPONENT_LOW_COST_MEMBER_ABILITY_ID =
  'PL!HS-bp6-004-R:on-enter-wait-opponent-low-cost-member';
export const HS_BP6_004_LIVE_START_WAIT_OPPONENT_LOW_COST_MEMBER_ABILITY_ID =
  'PL!HS-bp6-004-R:live-start-wait-opponent-low-cost-member';
export const HS_BP6_004_LIVE_START_DISCARD_GAIN_BLADE_ABILITY_ID =
  'PL!HS-bp6-004-R:live-start-discard-gain-blade';
export const CHISATO_LIVE_START_ACTIVATE_LIELLA_AND_ENERGY_ABILITY_ID =
  'PL!SP-bp5-003-AR:live-start-activate-liella-members-and-energy';
export const EMMA_ON_ENTER_ACTIVATE_MEMBER_OR_ENERGY_ABILITY_ID =
  'PL!N-pb1-008-P+:on-enter-activate-member-or-energy';
export const YOSHIKO_ON_ENTER_PLAY_LOW_COST_MEMBERS_ABILITY_ID =
  'PL!S-bp2-006-P:on-enter-pay-four-play-up-to-two-low-cost-members';

export enum CardAbilityCategory {
  CONTINUOUS = 'CONTINUOUS',
  ON_ENTER = 'ON_ENTER',
  ACTIVATED = 'ACTIVATED',
  LIVE_START = 'LIVE_START',
  LIVE_SUCCESS = 'LIVE_SUCCESS',
  AUTO = 'AUTO',
}

export enum CardAbilitySourceZone {
  PLAYED_MEMBER = 'PLAYED_MEMBER',
  STAGE_MEMBER = 'STAGE_MEMBER',
  LIVE_CARD = 'LIVE_CARD',
}

export interface ActivatedAbilityUiConfig {
  readonly abilityId: string;
  readonly text: string;
  readonly title: string;
}

export interface CardAbilityDefinition {
  readonly abilityId: string;
  readonly cardCodes: readonly string[];
  readonly category: CardAbilityCategory;
  readonly sourceZone: CardAbilitySourceZone;
  readonly triggerCondition?: TriggerCondition;
  readonly queued: boolean;
  readonly implemented: boolean;
  readonly effectText: string;
  readonly requiredSourceSlots?: readonly SlotPosition[];
  readonly perTurnLimit?: number;
  readonly activatedUi?: ActivatedAbilityUiConfig;
  readonly notes?: string;
}

const NOZOMI_EFFECT_TEXT = '【登场】将自己卡组顶的5张卡放置入休息室。其中有LIVE卡的场合，抽1张卡。';
const UMI_EFFECT_TEXT =
  "【登场】检视自己卡组顶的5张卡。可以将1张其中的『μ's』的LIVE卡公开并加入手牌。其余的卡片放置入休息室。";
const HONOKA_ON_ENTER_EFFECT_TEXT =
  '【登场】自己的成功LIVE卡区中的卡片大于等于2张的场合，从自己的休息室将1张LIVE卡加入手牌。';
const KOTORI_ON_ENTER_EFFECT_TEXT =
  "【登场】从自己的休息室将1张费用小于等于4的『μ's』的成员卡加入手牌。";
const LL_BP1_001_ON_ENTER_EFFECT_TEXT = '【登场】从自己的休息室将1张成员卡加入手牌。';
const HS_BP1_006_ON_ENTER_EFFECT_TEXT = '【登场】抽2张卡，将1张手牌放置入休息室。';
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
const HS_PB1_009_ON_HASUNOSORA_ENTER_EFFECT_TEXT =
  '【自动】【中央】[1回合2次]每当「莲之空」的成员登场至自己的舞台，LIVE结束时为止，获得[BLADE][BLADE]。';
const HS_PB1_009_LIVE_START_EFFECT_TEXT =
  '【LIVE开始时】此成员持有的[BLADE]的数量大于等于8个的场合，抽2张卡，将1张手牌放置入休息室。';
const HS_BP6_004_WAIT_OPPONENT_LOW_COST_MEMBER_EFFECT_TEXT =
  '【登场】/【LIVE开始时】将存在于对方舞台的1名费用小于等于9的成员变为待机状态。';
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
const ELI_EFFECT_TEXT = '【起动】将此成员从舞台放置入休息室：从自己的休息室将1张成员卡加入手牌。';
const RIN_EFFECT_TEXT = '【起动】将此成员从舞台放置入休息室：从自己的休息室将1张LIVE卡加入手牌。';
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
const DISCARD_HAND_TO_ACTIVATE_SELECTION_LABEL = '请选择要放置入休息室的卡牌';
const DISCARD_HAND_TO_ACTIVATE_STEP_TEXT = '请选择要放置入休息室的手牌。也可以选择不发动此效果。';
const DECLINE_OPTION_LABEL = '不发动';
const ABILITY_USE_STEP = 'ABILITY_USE';
const ACTIVATED_ABILITY_USE_STEP = 'ACTIVATED_ABILITY_USE';
const START_DASH_ARRANGE_STEP_ID = 'START_DASH_ARRANGE_TOP_DECK';
const MEMBER_SLOT_ORDER = [SlotPosition.LEFT, SlotPosition.CENTER, SlotPosition.RIGHT] as const;
const CHISATO_LIVE_START_ACTIVATE_STEP_ID = 'CHISATO_LIVE_START_ACTIVATE_ALL';
const EMMA_SELECT_TARGET_TYPE_STEP_ID = 'EMMA_SELECT_ACTIVATE_TARGET_TYPE';
const EMMA_SELECT_MEMBER_STEP_ID = 'EMMA_SELECT_MEMBER_TO_ACTIVATE';
const YOSHIKO_PAY_COST_STEP_ID = 'YOSHIKO_PAY_COST';
const YOSHIKO_SELECT_WAITING_ROOM_MEMBERS_STEP_ID = 'YOSHIKO_SELECT_WAITING_ROOM_LOW_COST_MEMBERS';
const YOSHIKO_SELECT_STAGE_SLOT_STEP_ID = 'YOSHIKO_SELECT_STAGE_SLOT';
const CONFIRM_ONLY_EFFECT_STEP_ID = 'CONFIRM_ONLY_EFFECT';

interface DiscardHandToWaitingRoomEffectConfig {
  readonly ability: PendingAbilityState;
  readonly playerId: string;
  readonly effectText: string;
  readonly stepId: string;
  readonly selectableCardIds: readonly string[];
  readonly orderedResolution: boolean;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

interface RevealSelectedInspectionCardConfig {
  readonly stepId: string;
  readonly stepText: string;
  readonly actionStep: string;
}

type InspectedCardDestination = 'MAIN_DECK_TOP' | 'WAITING_ROOM';
interface ArrangeInspectedDeckTopConfig {
  readonly ability: PendingAbilityState;
  readonly playerId: string;
  readonly effectText: string;
  readonly inspectCount: number;
  readonly stepId: string;
  readonly stepText: string;
  readonly selectionLabel: string;
  readonly selectMin: number;
  readonly selectMax: number;
  readonly selectedDestination: InspectedCardDestination;
  readonly unselectedDestination: InspectedCardDestination;
  readonly orderedResolution: boolean;
}

interface DrawThenDiscardOneEffectConfig {
  readonly ability: PendingAbilityState;
  readonly effectText: string;
  readonly drawCount: number;
  readonly stepId: string;
  readonly orderedResolution: boolean;
}

interface MemberPositionChangeEffectConfig {
  readonly ability: PendingAbilityState;
  readonly effectText: string;
  readonly stepId: string;
  readonly stepText: string;
  readonly optional: boolean;
  readonly orderedResolution: boolean;
}

interface AbilitySourceEntry {
  readonly cardId: string;
  readonly sourceZone: CardAbilitySourceZone;
  readonly sourceSlot?: SlotPosition;
}

interface OnEnterAbilitySource {
  readonly cardId: string;
  readonly controllerId: string;
  readonly sourceSlot: SlotPosition | null;
  readonly eventId: string;
}

interface OnEnterStageAutoSource {
  readonly sourceCardId: string;
  readonly controllerId: string;
  readonly sourceSlot: SlotPosition;
  readonly enteredCardId: string;
  readonly eventId: string;
}

interface OnLeaveStageAbilitySource {
  readonly cardId: string;
  readonly controllerId: string;
  readonly sourceSlot: SlotPosition;
  readonly eventId: string;
}

interface EnqueueTriggeredCardEffectsOptions {
  readonly onEnterSources?: readonly OnEnterAbilitySource[];
  readonly enterStageEvents?: readonly EnterStageEvent[];
  readonly onLeaveStageSources?: readonly OnLeaveStageAbilitySource[];
  readonly leaveStageEvents?: readonly LeaveStageEvent[];
}

interface StartPendingAbilityEffectOptions {
  readonly orderedResolution?: boolean;
  readonly manualConfirmation?: boolean;
  readonly skipManualConfirmation?: boolean;
}

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
    cardCodes: ['PL!-sd1-005-SD'],
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
    abilityId: BP4_003_ACTIVATED_ABILITY_ID,
    cardCodes: ['PL!-bp4-003-P'],
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
    cardCodes: ['PL!-pb1-019-N'],
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
    cardCodes: [
      'PL!-sd1-011-SD',
      'PL!-sd1-012-SD',
      'PL!-sd1-015-SD',
      'PL!-sd1-016-SD',
      'PL!HS-PR-001-PR',
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
    abilityId: KEKE_ON_ENTER_PLACE_WAITING_ENERGY_ABILITY_ID,
    cardCodes: ['PL!SP-PR-004-PR'],
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
    abilityId: HS_BP2_002_ON_ENTER_RECOVER_LOW_COST_MEMBER_ABILITY_ID,
    cardCodes: ['PL!HS-bp2-002-P'],
    category: CardAbilityCategory.ON_ENTER,
    sourceZone: CardAbilitySourceZone.PLAYED_MEMBER,
    triggerCondition: TriggerCondition.ON_ENTER_STAGE,
    queued: true,
    implemented: true,
    effectText: HS_BP2_002_ON_ENTER_EFFECT_TEXT,
    notes: '复用 zone-selection + card-selectors，从休息室筛选低费(<=2)成员卡，最多2张。',
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
    abilityId: HS_PB1_009_ON_HASUNOSORA_ENTER_GAIN_BLADE_ABILITY_ID,
    cardCodes: ['PL!HS-pb1-009-R'],
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
    cardCodes: ['PL!HS-pb1-009-R'],
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
    cardCodes: ['PL!HS-bp6-004-R'],
    category: CardAbilityCategory.ON_ENTER,
    sourceZone: CardAbilitySourceZone.PLAYED_MEMBER,
    triggerCondition: TriggerCondition.ON_ENTER_STAGE,
    queued: true,
    implemented: true,
    effectText: HS_BP6_004_WAIT_OPPONENT_LOW_COST_MEMBER_EFFECT_TEXT,
    notes:
      '复用对手舞台成员目标筛选与成员方向 helper，将对方费用<=9成员变为待机状态。',
  },
  {
    abilityId: HS_BP6_004_LIVE_START_WAIT_OPPONENT_LOW_COST_MEMBER_ABILITY_ID,
    cardCodes: ['PL!HS-bp6-004-R'],
    category: CardAbilityCategory.LIVE_START,
    sourceZone: CardAbilitySourceZone.STAGE_MEMBER,
    triggerCondition: TriggerCondition.ON_LIVE_START,
    queued: true,
    implemented: true,
    effectText: HS_BP6_004_WAIT_OPPONENT_LOW_COST_MEMBER_EFFECT_TEXT,
    notes:
      '同一文本的 LIVE 开始段复用对手舞台成员目标筛选与成员方向 helper。',
  },
  {
    abilityId: HS_BP6_004_LIVE_START_DISCARD_GAIN_BLADE_ABILITY_ID,
    cardCodes: ['PL!HS-bp6-004-R'],
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
    abilityId: SHIKI_ON_ENTER_LEFT_DRAW_DISCARD_ABILITY_ID,
    cardCodes: ['PL!SP-bp4-008-P'],
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
    cardCodes: ['PL!SP-bp4-008-P'],
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
    cardCodes: ['PL!SP-bp4-008-P'],
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
    cardCodes: ['PL!SP-bp5-003-AR'],
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
    cardCodes: ['PL!N-pb1-008-P+'],
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
    cardCodes: ['PL!S-bp2-006-P'],
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
    cardCodes: ['PL!HS-bp1-006-P'],
    category: CardAbilityCategory.ON_ENTER,
    sourceZone: CardAbilitySourceZone.PLAYED_MEMBER,
    triggerCondition: TriggerCondition.ON_ENTER_STAGE,
    queued: true,
    implemented: true,
    effectText: HS_BP1_006_ON_ENTER_EFFECT_TEXT,
    notes: '登场后抽2张卡并将1张手牌放置入休息室；复用 draw helper 与 discard helper。',
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
    abilityId: KARIN_LIVE_START_ABILITY_ID,
    cardCodes: ['PL!N-pb1-004-P+'],
    category: CardAbilityCategory.LIVE_START,
    sourceZone: CardAbilitySourceZone.STAGE_MEMBER,
    triggerCondition: TriggerCondition.ON_LIVE_START,
    queued: true,
    implemented: true,
    effectText: KARIN_EFFECT_TEXT,
    notes: '测试用虹咲样例卡，保留在同一分类表中验证 LIVE开始队列共性。',
  },
];

const IMPLEMENTED_QUEUED_ABILITY_IDS = new Set(
  CARD_ABILITY_DEFINITIONS.filter((ability) => ability.implemented && ability.queued).map(
    (ability) => ability.abilityId
  )
);

export function getCardAbilityDefinitions(
  cardCode: string | undefined
): readonly CardAbilityDefinition[] {
  if (!cardCode) {
    return [];
  }
  return CARD_ABILITY_DEFINITIONS.filter((definition) => definition.cardCodes.includes(cardCode));
}

export function getActivatedAbilityUiConfig(
  cardCode: string | undefined
): ActivatedAbilityUiConfig | null {
  const definition = getCardAbilityDefinitions(cardCode).find(
    (ability) =>
      ability.category === CardAbilityCategory.ACTIVATED &&
      ability.implemented &&
      ability.activatedUi
  );
  return definition?.activatedUi ?? null;
}

export function isSupportedActivatedAbilityForCard(
  abilityId: string,
  cardCode: string | undefined
): boolean {
  return getCardAbilityDefinitions(cardCode).some(
    (ability) =>
      ability.category === CardAbilityCategory.ACTIVATED &&
      ability.implemented &&
      ability.abilityId === abilityId
  );
}

function getActivatedAbilityDefinition(abilityId: string): CardAbilityDefinition | null {
  return (
    CARD_ABILITY_DEFINITIONS.find(
      (ability) =>
        ability.abilityId === abilityId &&
        ability.category === CardAbilityCategory.ACTIVATED &&
        ability.implemented
    ) ?? null
  );
}

export interface AbilityTurnLimitStatus {
  readonly abilityId: string;
  readonly sourceCardId: string;
  readonly limit: number;
  readonly used: number;
  readonly remaining: number;
}

export type ActivatedAbilityLimitStatus = AbilityTurnLimitStatus;

export function getAbilityTurnLimitStatus(
  game: GameState,
  playerId: string,
  abilityId: string,
  sourceCardId: string
): AbilityTurnLimitStatus | null {
  const definition = CARD_ABILITY_DEFINITIONS.find(
    (ability) => ability.abilityId === abilityId && ability.implemented
  );
  const limit = definition?.perTurnLimit;
  if (limit === undefined) {
    return null;
  }

  const resolvedUses = game.actionHistory.filter(
    (action) =>
      action.type === 'RESOLVE_ABILITY' &&
      action.playerId === playerId &&
      action.payload.abilityId === abilityId &&
      action.payload.sourceCardId === sourceCardId &&
      (action.payload.step === ABILITY_USE_STEP ||
        action.payload.step === ACTIVATED_ABILITY_USE_STEP) &&
      action.payload.turnCount === game.turnCount
  ).length;
  const pendingUses = game.pendingAbilities.filter(
    (ability) =>
      ability.controllerId === playerId &&
      ability.abilityId === abilityId &&
      ability.sourceCardId === sourceCardId
  ).length;
  const activeUse =
    game.activeEffect?.controllerId === playerId &&
    game.activeEffect.abilityId === abilityId &&
    game.activeEffect.sourceCardId === sourceCardId
      ? 1
      : 0;
  const used = resolvedUses + pendingUses + activeUse;

  return {
    abilityId,
    sourceCardId,
    limit,
    used,
    remaining: Math.max(0, limit - used),
  };
}

export function getActivatedAbilityLimitStatus(
  game: GameState,
  playerId: string,
  abilityId: string,
  sourceCardId: string
): ActivatedAbilityLimitStatus | null {
  const definition = getActivatedAbilityDefinition(abilityId);
  if (!definition) {
    return null;
  }
  return getAbilityTurnLimitStatus(game, playerId, abilityId, sourceCardId);
}

function canUseAbilityThisTurn(
  game: GameState,
  playerId: string,
  abilityId: string,
  sourceCardId: string
): boolean {
  const status = getAbilityTurnLimitStatus(game, playerId, abilityId, sourceCardId);
  return status === null || status.used < status.limit;
}

export function canUseActivatedAbilityThisTurn(
  game: GameState,
  playerId: string,
  abilityId: string,
  sourceCardId: string
): boolean {
  const status = getActivatedAbilityLimitStatus(game, playerId, abilityId, sourceCardId);
  return status === null || status.used < status.limit;
}

function getQueuedAbilityDefinitionsForCard(
  cardCode: string | undefined,
  category: CardAbilityCategory,
  sourceZone: CardAbilitySourceZone,
  sourceSlot?: SlotPosition | null
): readonly CardAbilityDefinition[] {
  return getCardAbilityDefinitions(cardCode).filter(
    (ability) =>
      ability.category === category &&
      ability.sourceZone === sourceZone &&
      ability.queued &&
      ability.implemented &&
      doesSourceSlotSatisfyAbility(ability, sourceSlot)
  );
}

function doesSourceSlotSatisfyAbility(
  ability: CardAbilityDefinition,
  sourceSlot?: SlotPosition | null
): boolean {
  if (!ability.requiredSourceSlots || ability.requiredSourceSlots.length === 0) {
    return true;
  }

  return (
    sourceSlot !== undefined &&
    sourceSlot !== null &&
    ability.requiredSourceSlots.includes(sourceSlot)
  );
}

function toSlotPosition(value: unknown): SlotPosition | null {
  return Object.values(SlotPosition).includes(value as SlotPosition)
    ? (value as SlotPosition)
    : null;
}

function createDiscardHandToWaitingRoomActivationEffect(
  config: DiscardHandToWaitingRoomEffectConfig
): ActiveEffectState {
  const discardCost: EffectCostDefinition = {
    kind: 'DISCARD_HAND_TO_WAITING_ROOM',
    minCount: 1,
    maxCount: 1,
    optional: true,
  };
  return {
    id: config.ability.id,
    abilityId: config.ability.abilityId,
    sourceCardId: config.ability.sourceCardId,
    controllerId: config.ability.controllerId,
    effectText: config.effectText,
    stepId: config.stepId,
    stepText: DISCARD_HAND_TO_ACTIVATE_STEP_TEXT,
    awaitingPlayerId: config.playerId,
    selectableCardIds: config.selectableCardIds,
    selectionLabel: DISCARD_HAND_TO_ACTIVATE_SELECTION_LABEL,
    canSkipSelection: true,
    skipSelectionLabel: DECLINE_OPTION_LABEL,
    metadata: {
      ...config.metadata,
      orderedResolution: config.orderedResolution,
      effectCosts: [discardCost],
      handToWaitingRoomCost: {
        minCount: discardCost.minCount,
        maxCount: discardCost.maxCount,
        optional: discardCost.optional,
      },
    },
  };
}

function startConfirmOnlyPendingAbilityEffect(
  game: GameState,
  ability: PendingAbilityState,
  effectText: string,
  options: StartPendingAbilityEffectOptions = {}
): GameState {
  return {
    ...game,
    activeEffect: {
      id: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      controllerId: ability.controllerId,
      effectText,
      stepId: CONFIRM_ONLY_EFFECT_STEP_ID,
      stepText: '确认后继续处理此效果。',
      awaitingPlayerId: ability.controllerId,
      metadata: {
        confirmOnlyPendingAbility: true,
        orderedResolution: options.orderedResolution === true,
      },
    },
  };
}

function finishConfirmOnlyPendingAbilityEffect(game: GameState): GameState {
  const effect = game.activeEffect;
  if (!effect || effect.metadata?.confirmOnlyPendingAbility !== true) {
    return game;
  }
  const pendingAbility = game.pendingAbilities.find(
    (ability) =>
      ability.id === effect.id &&
      ability.abilityId === effect.abilityId &&
      ability.sourceCardId === effect.sourceCardId
  );
  if (!pendingAbility) {
    return game;
  }
  return startPendingAbilityEffect({ ...game, activeEffect: null }, pendingAbility, {
    orderedResolution: effect.metadata.orderedResolution === true,
    skipManualConfirmation: true,
  });
}

function recordAbilityUse(
  game: GameState,
  playerId: string,
  abilityId: string,
  sourceCardId: string
): GameState {
  return addAction(game, 'RESOLVE_ABILITY', playerId, {
    abilityId,
    sourceCardId,
    step: ABILITY_USE_STEP,
    turnCount: game.turnCount,
  });
}

function revealSelectedInspectionCard(
  game: GameState,
  selectedCardId: string,
  config: RevealSelectedInspectionCardConfig
): GameState {
  const effect = game.activeEffect;
  if (!effect || !effect.inspectionCardIds?.includes(selectedCardId)) {
    return game;
  }
  if (!effect.selectableCardIds?.includes(selectedCardId)) {
    return game;
  }

  const revealedCardIds = game.inspectionZone.revealedCardIds.includes(selectedCardId)
    ? game.inspectionZone.revealedCardIds
    : [...game.inspectionZone.revealedCardIds, selectedCardId];

  return addAction(
    {
      ...game,
      inspectionZone: {
        ...game.inspectionZone,
        revealedCardIds,
      },
      activeEffect: {
        ...effect,
        stepId: config.stepId,
        stepText: config.stepText,
        selectableCardIds: [],
        selectionLabel: undefined,
        canSkipSelection: false,
        skipSelectionLabel: undefined,
        metadata: {
          ...effect.metadata,
          selectedCardId,
        },
      },
    },
    'RESOLVE_ABILITY',
    effect.controllerId,
    {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: config.actionStep,
      selectedCardId,
    }
  );
}
const NOZOMI_REVEAL_STEP_ID = 'NOZOMI_REVEAL_TOP_FIVE';
const UMI_SELECT_STEP_ID = 'UMI_SELECT_MUSE_LIVE';
const UMI_REVEAL_STEP_ID = 'UMI_REVEAL_SELECTED_LIVE';
const SELECT_WAITING_ROOM_CARD_STEP_ID = 'SELECT_WAITING_ROOM_CARD';
const MAKI_SELECT_HAND_LIVE_STEP_ID = 'MAKI_SELECT_HAND_LIVE';
const MAKI_SELECT_SUCCESS_LIVE_STEP_ID = 'MAKI_SELECT_SUCCESS_LIVE';
const DISCARD_LOOK_SELECT_DISCARD_STEP_ID = 'DISCARD_LOOK_SELECT_DISCARD';
const DISCARD_LOOK_SELECT_TAKE_STEP_ID = 'DISCARD_LOOK_SELECT_TAKE';
const DISCARD_LOOK_REVEAL_SELECTED_STEP_ID = 'DISCARD_LOOK_REVEAL_SELECTED';
const KARIN_REVEAL_STEP_ID = 'KARIN_REVEAL_TOP_CARD';
const KARIN_POSITION_CHANGE_STEP_ID = 'KARIN_POSITION_CHANGE';
const KOTORI_LIVE_START_SELECT_DISCARD_STEP_ID = 'KOTORI_LIVE_START_SELECT_DISCARD';
const KOTORI_LIVE_START_SELECT_HEART_STEP_ID = 'KOTORI_LIVE_START_SELECT_HEART';
const NICO_SCORE_BONUS_STEP_ID = 'NICO_SCORE_BONUS';
const BOKUIMA_REQUIREMENT_REDUCTION_STEP_ID = 'BOKUIMA_REQUIREMENT_REDUCTION';
const ELI_SELECT_WAITING_ROOM_MEMBER_STEP_ID = 'ELI_SELECT_WAITING_ROOM_MEMBER';
const RIN_SELECT_WAITING_ROOM_LIVE_STEP_ID = 'RIN_SELECT_WAITING_ROOM_LIVE';
const KEKE_SELECT_DISCARD_STEP_ID = 'KEKE_SELECT_DISCARD_FOR_WAITING_ENERGY';
const SHIKI_LEFT_SELECT_DISCARD_STEP_ID = 'SHIKI_LEFT_SELECT_DISCARD_AFTER_DRAW';
const HS_BP1_006_ON_ENTER_SELECT_DISCARD_STEP_ID = 'HS_BP1_006_ON_ENTER_SELECT_DISCARD';
const HS_BP2_012_SELECT_MEMBER_STEP_ID = 'HS_BP2_012_SELECT_MEMBER_FROM_TOP_FIVE';
const HS_BP2_012_REVEAL_SELECTED_STEP_ID = 'HS_BP2_012_REVEAL_SELECTED_MEMBER';
const HS_BP6_017_SELECT_DISCARD_STEP_ID = 'HS_BP6_017_SELECT_DISCARD_FOR_RECOVERY';
const HS_BP6_017_SELECT_WAITING_ROOM_CARDS_STEP_ID =
  'HS_BP6_017_SELECT_LIVE_AND_MEMBER_FROM_WAITING_ROOM';
const HS_BP6_004_SELECT_OPPONENT_MEMBER_STEP_ID =
  'HS_BP6_004_SELECT_OPPONENT_MEMBER_TO_WAIT';
const HS_BP6_004_SELECT_DISCARD_STEP_ID = 'HS_BP6_004_SELECT_DISCARD_FOR_BLADE';
const HS_PB1_009_LIVE_START_SELECT_DISCARD_STEP_ID = 'HS_PB1_009_LIVE_START_SELECT_DISCARD';
const BP4_003_SELECT_WAITING_ROOM_LIVE_STEP_ID = 'BP4_003_SELECT_WAITING_ROOM_LIVE';
const SHIKI_RIGHT_ACTIVATE_ENERGY_STEP_ID = 'SHIKI_RIGHT_ACTIVATE_ENERGY';
const SHIKI_LIVE_START_POSITION_CHANGE_STEP_ID = 'SHIKI_LIVE_START_POSITION_CHANGE';
const PB1_019_SELECT_WAITING_ROOM_MEMBER_STEP_ID = 'PB1_019_SELECT_WAITING_ROOM_MEMBER';
const ABILITY_ORDER_SELECTION_STEP_ID = 'SELECT_NEXT_PENDING_ABILITY';

interface CardEffectRunnerResult {
  readonly gameState: GameState;
  readonly resolvedAbilityIds: readonly string[];
}

export function enqueueTriggeredCardEffects(
  game: GameState,
  triggerConditions: readonly TriggerCondition[],
  options: EnqueueTriggeredCardEffectsOptions = {}
): GameState {
  let state = game;

  if (triggerConditions.includes(TriggerCondition.ON_ENTER_STAGE)) {
    const onEnterSources =
      options.onEnterSources ?? createOnEnterAbilitySourcesFromEvents(options.enterStageEvents);
    state = enqueueOnEnterCardEffects(state, onEnterSources);
    state = enqueueOnEnterStageAutoCardEffects(
      state,
      createOnEnterStageAutoSources(state, options.enterStageEvents, onEnterSources)
    );
  }

  if (triggerConditions.includes(TriggerCondition.ON_LEAVE_STAGE)) {
    state = enqueueOnLeaveStageCardEffects(
      state,
      options.onLeaveStageSources ??
        createOnLeaveStageAbilitySourcesFromEvents(options.leaveStageEvents)
    );
  }

  if (triggerConditions.includes(TriggerCondition.ON_LIVE_START)) {
    state = enqueueLiveStartCardEffects(state);
  }

  if (triggerConditions.includes(TriggerCondition.ON_LIVE_SUCCESS)) {
    state = enqueueLiveSuccessCardEffects(state);
  }

  return state;
}

function enqueueOnLeaveStageCardEffects(
  game: GameState,
  explicitSources: readonly OnLeaveStageAbilitySource[] | undefined = undefined
): GameState {
  const sources = explicitSources ?? getLatestLeaveStageAbilitySources(game);
  if (sources.length === 0) {
    return game;
  }

  let state = game;
  for (const source of sources) {
    state = enqueueSingleOnLeaveStageCardEffect(state, source);
  }

  return state;
}

function getLatestLeaveStageAbilitySources(game: GameState): readonly OnLeaveStageAbilitySource[] {
  const action = [...game.actionHistory]
    .reverse()
    .find(
      (candidate) =>
        candidate.type === 'PLAY_MEMBER' ||
        (candidate.type === 'MOVE_CARD' &&
          candidate.payload.fromZone === ZoneType.MEMBER_SLOT &&
          candidate.payload.toZone === ZoneType.WAITING_ROOM)
    );
  if (!action) {
    return [];
  }

  if (action.type === 'PLAY_MEMBER') {
    const replacedCardId =
      typeof action.payload.replacedCardId === 'string' ? action.payload.replacedCardId : null;
    const sourceSlot = toSlotPosition(action.payload.targetSlot);
    if (!replacedCardId || sourceSlot === null) {
      return [];
    }
    return [
      {
        cardId: replacedCardId,
        controllerId: action.playerId ?? getCardById(game, replacedCardId)?.ownerId ?? '',
        sourceSlot,
        eventId: `action:${action.sequence}`,
      },
    ].filter((source) => source.controllerId.length > 0);
  }

  const cardId = typeof action.payload.cardId === 'string' ? action.payload.cardId : null;
  const sourceSlot = toSlotPosition(action.payload.sourceSlot);
  if (!cardId || sourceSlot === null) {
    return [];
  }

  return [
    {
      cardId,
      controllerId: action.playerId ?? getCardById(game, cardId)?.ownerId ?? '',
      sourceSlot,
      eventId: `action:${action.sequence}`,
    },
  ].filter((source) => source.controllerId.length > 0);
}

function createOnLeaveStageAbilitySourcesFromEvents(
  events: readonly LeaveStageEvent[] | undefined
): readonly OnLeaveStageAbilitySource[] | undefined {
  if (!events || events.length === 0) {
    return undefined;
  }

  return events.map((event) => ({
    cardId: event.cardInstanceId,
    controllerId: event.controllerId,
    sourceSlot: event.fromSlot,
    eventId: event.eventId,
  }));
}

function enqueueSingleOnLeaveStageCardEffect(
  game: GameState,
  source: OnLeaveStageAbilitySource
): GameState {
  const sourceCard = getCardById(game, source.cardId);
  if (!sourceCard) {
    return game;
  }

  const abilityDefinitions = getQueuedAbilityDefinitionsForCard(
    sourceCard.data.cardCode,
    CardAbilityCategory.AUTO,
    CardAbilitySourceZone.STAGE_MEMBER,
    source.sourceSlot
  ).filter((ability) => ability.triggerCondition === TriggerCondition.ON_LEAVE_STAGE);
  if (abilityDefinitions.length === 0) {
    return game;
  }

  let state = game;
  for (const abilityDefinition of abilityDefinitions) {
    const abilityId = abilityDefinition.abilityId;
    const pendingAbilityId = `${abilityId}:${source.eventId}`;
    if (hasAbilityInstance(state, pendingAbilityId)) {
      continue;
    }

    const pendingAbility: PendingAbilityState = {
      id: pendingAbilityId,
      abilityId,
      sourceCardId: source.cardId,
      controllerId: source.controllerId,
      mandatory: true,
      timingId: TriggerCondition.ON_LEAVE_STAGE,
      eventIds: [source.eventId],
      sourceSlot: source.sourceSlot,
    };

    state = addAction(
      {
        ...state,
        pendingAbilities: [...state.pendingAbilities, pendingAbility],
      },
      'TRIGGER_ABILITY',
      pendingAbility.controllerId,
      {
        pendingAbilityId,
        abilityId: pendingAbility.abilityId,
        sourceCardId: source.cardId,
        timingId: pendingAbility.timingId,
        sourceSlot: source.sourceSlot,
      }
    );
  }

  return state;
}

function enqueueOnEnterCardEffects(
  game: GameState,
  explicitSources: readonly OnEnterAbilitySource[] | undefined = undefined
): GameState {
  const sources = explicitSources ?? getLatestPlayMemberOnEnterSources(game);
  if (sources.length === 0) {
    return game;
  }

  let state = game;
  for (const source of sources) {
    state = enqueueSingleOnEnterCardEffect(state, source);
  }

  return state;
}

function getLatestPlayMemberOnEnterSources(game: GameState): readonly OnEnterAbilitySource[] {
  const action = [...game.actionHistory]
    .reverse()
    .find((candidate) => candidate.type === 'PLAY_MEMBER');
  const sourceCardId = typeof action?.payload.cardId === 'string' ? action.payload.cardId : null;
  if (!action || !sourceCardId) {
    return [];
  }

  const sourceCard = getCardById(game, sourceCardId);
  if (!sourceCard) {
    return [];
  }

  return [
    {
      cardId: sourceCardId,
      controllerId: action.playerId ?? sourceCard.ownerId,
      sourceSlot: toSlotPosition(action.payload.targetSlot),
      eventId: `action:${action.sequence}`,
    },
  ];
}

function createOnEnterAbilitySourcesFromEvents(
  events: readonly EnterStageEvent[] | undefined
): readonly OnEnterAbilitySource[] | undefined {
  if (!events || events.length === 0) {
    return undefined;
  }

  return events.map((event) => ({
    cardId: event.cardInstanceId,
    controllerId: event.controllerId,
    sourceSlot: event.toSlot,
    eventId: event.eventId,
  }));
}

function createOnEnterStageAutoSources(
  game: GameState,
  events: readonly EnterStageEvent[] | undefined,
  onEnterSources: readonly OnEnterAbilitySource[] | undefined
): readonly OnEnterStageAutoSource[] {
  const enterEvents = events ?? createEnterStageEventsFromOnEnterSources(game, onEnterSources);
  if (enterEvents.length === 0) {
    return [];
  }

  const sources: OnEnterStageAutoSource[] = [];
  for (const event of enterEvents) {
    const enteredCard = getCardById(game, event.cardInstanceId);
    if (!enteredCard || !isHasunosoraMemberCard(enteredCard)) {
      continue;
    }

    const player = getPlayerById(game, event.controllerId);
    if (!player) {
      continue;
    }

    for (const sourceSlot of MEMBER_SLOT_ORDER) {
      const sourceCardId = player.memberSlots.slots[sourceSlot];
      if (!sourceCardId) {
        continue;
      }

      sources.push({
        sourceCardId,
        controllerId: player.id,
        sourceSlot,
        enteredCardId: event.cardInstanceId,
        eventId: event.eventId,
      });
    }
  }

  return sources;
}

function createEnterStageEventsFromOnEnterSources(
  game: GameState,
  onEnterSources: readonly OnEnterAbilitySource[] | undefined
): readonly EnterStageEvent[] {
  const sources = onEnterSources ?? getLatestPlayMemberOnEnterSources(game);
  return sources.flatMap((source) => {
    if (source.sourceSlot === null) {
      return [];
    }
    const card = getCardById(game, source.cardId);
    if (!card) {
      return [];
    }
    return [
      {
        eventId: source.eventId,
        eventType: TriggerCondition.ON_ENTER_STAGE,
        timestamp: 0,
        cardInstanceId: source.cardId,
        fromZone: ZoneType.HAND,
        toZone: ZoneType.MEMBER_SLOT,
        toSlot: source.sourceSlot,
        ownerId: card.ownerId,
        controllerId: source.controllerId,
        triggerPlayerId: source.controllerId,
      },
    ];
  });
}

function isHasunosoraMemberCard(card: CardInstance): boolean {
  return (
    isMemberCardData(card.data) &&
    (groupIs('莲之空')(card) || groupIs('蓮ノ空')(card) || card.data.cardCode.startsWith('PL!HS-'))
  );
}

function enqueueSingleOnEnterCardEffect(game: GameState, source: OnEnterAbilitySource): GameState {
  const sourceCard = getCardById(game, source.cardId);
  if (!sourceCard) {
    return game;
  }

  const abilityDefinitions = getQueuedAbilityDefinitionsForCard(
    sourceCard.data.cardCode,
    CardAbilityCategory.ON_ENTER,
    CardAbilitySourceZone.PLAYED_MEMBER,
    source.sourceSlot
  );
  if (abilityDefinitions.length === 0) {
    return game;
  }

  let state = game;
  for (const abilityDefinition of abilityDefinitions) {
    const abilityId = abilityDefinition.abilityId;
    const pendingAbilityId = `${abilityId}:${source.eventId}`;
    if (hasAbilityInstance(state, pendingAbilityId)) {
      continue;
    }

    const pendingAbility: PendingAbilityState = {
      id: pendingAbilityId,
      abilityId,
      sourceCardId: source.cardId,
      controllerId: source.controllerId,
      mandatory: true,
      timingId: TriggerCondition.ON_ENTER_STAGE,
      eventIds: [source.eventId],
      sourceSlot: source.sourceSlot ?? undefined,
    };

    state = addAction(
      {
        ...state,
        pendingAbilities: [...state.pendingAbilities, pendingAbility],
      },
      'TRIGGER_ABILITY',
      pendingAbility.controllerId,
      {
        pendingAbilityId,
        abilityId: pendingAbility.abilityId,
        sourceCardId: source.cardId,
        timingId: pendingAbility.timingId,
        sourceSlot: source.sourceSlot,
      }
    );
  }

  return state;
}

function enqueueOnEnterStageAutoCardEffects(
  game: GameState,
  sources: readonly OnEnterStageAutoSource[]
): GameState {
  let state = game;
  for (const source of sources) {
    state = enqueueSingleOnEnterStageAutoCardEffect(state, source);
  }
  return state;
}

function enqueueSingleOnEnterStageAutoCardEffect(
  game: GameState,
  source: OnEnterStageAutoSource
): GameState {
  const sourceCard = getCardById(game, source.sourceCardId);
  if (!sourceCard) {
    return game;
  }

  const abilityDefinitions = getQueuedAbilityDefinitionsForCard(
    sourceCard.data.cardCode,
    CardAbilityCategory.AUTO,
    CardAbilitySourceZone.STAGE_MEMBER,
    source.sourceSlot
  ).filter((ability) => ability.triggerCondition === TriggerCondition.ON_ENTER_STAGE);
  if (abilityDefinitions.length === 0) {
    return game;
  }

  let state = game;
  for (const abilityDefinition of abilityDefinitions) {
    const abilityId = abilityDefinition.abilityId;
    if (!canUseAbilityThisTurn(state, source.controllerId, abilityId, source.sourceCardId)) {
      continue;
    }

    const pendingAbilityId = `${abilityId}:${source.sourceCardId}:${source.eventId}`;
    if (hasAbilityInstance(state, pendingAbilityId)) {
      continue;
    }

    const pendingAbility: PendingAbilityState = {
      id: pendingAbilityId,
      abilityId,
      sourceCardId: source.sourceCardId,
      controllerId: source.controllerId,
      mandatory: true,
      timingId: TriggerCondition.ON_ENTER_STAGE,
      eventIds: [source.eventId],
      sourceSlot: source.sourceSlot,
    };

    state = addAction(
      {
        ...state,
        pendingAbilities: [...state.pendingAbilities, pendingAbility],
      },
      'TRIGGER_ABILITY',
      pendingAbility.controllerId,
      {
        pendingAbilityId,
        abilityId: pendingAbility.abilityId,
        sourceCardId: source.sourceCardId,
        timingId: pendingAbility.timingId,
        sourceSlot: source.sourceSlot,
        enteredCardId: source.enteredCardId,
      }
    );
  }

  return state;
}

function enqueueLiveStartCardEffects(game: GameState): GameState {
  const performingPlayerId =
    game.liveResolution.performingPlayerId ?? game.players[game.activePlayerIndex]?.id;
  const player = performingPlayerId ? getPlayerById(game, performingPlayerId) : null;
  if (!player) {
    return game;
  }

  let state = game;
  const sourceEntries: AbilitySourceEntry[] = [
    ...MEMBER_SLOT_ORDER.flatMap((sourceSlot) => {
      const cardId = player.memberSlots.slots[sourceSlot];
      return cardId
        ? [
            {
              cardId,
              sourceZone: CardAbilitySourceZone.STAGE_MEMBER,
              sourceSlot,
            },
          ]
        : [];
    }),
    ...player.liveZone.cardIds.map((cardId) => ({
      cardId,
      sourceZone: CardAbilitySourceZone.LIVE_CARD,
    })),
  ];
  for (const sourceEntry of sourceEntries) {
    const sourceCardId = sourceEntry.cardId;
    const sourceCard = getCardById(state, sourceCardId);
    const abilityDefinitions = getQueuedAbilityDefinitionsForCard(
      sourceCard?.data.cardCode,
      CardAbilityCategory.LIVE_START,
      sourceEntry.sourceZone,
      sourceEntry.sourceSlot
    );
    if (!sourceCard || abilityDefinitions.length === 0) {
      continue;
    }

    for (const abilityDefinition of abilityDefinitions) {
      const abilityId = abilityDefinition.abilityId;
      const pendingAbilityId = `${abilityId}:${sourceCardId}:turn-${state.turnCount}:live-${performingPlayerId}`;
      if (hasAbilityInstance(state, pendingAbilityId)) {
        continue;
      }

      const pendingAbility: PendingAbilityState = {
        id: pendingAbilityId,
        abilityId,
        sourceCardId,
        controllerId: sourceCard.ownerId,
        mandatory: true,
        timingId: TriggerCondition.ON_LIVE_START,
        eventIds: [`live-start:${state.turnCount}:${performingPlayerId}`],
        sourceSlot: sourceEntry.sourceSlot ?? undefined,
      };

      state = addAction(
        {
          ...state,
          pendingAbilities: [...state.pendingAbilities, pendingAbility],
        },
        'TRIGGER_ABILITY',
        pendingAbility.controllerId,
        {
          pendingAbilityId,
          abilityId: pendingAbility.abilityId,
          sourceCardId,
          timingId: pendingAbility.timingId,
          sourceSlot: sourceEntry.sourceSlot,
        }
      );
    }
  }

  return state;
}

function enqueueLiveSuccessCardEffects(game: GameState): GameState {
  const playerId = getLiveSuccessEffectPlayerId(game);
  const player = playerId ? getPlayerById(game, playerId) : null;
  if (!player) {
    return game;
  }

  let state = game;
  const successfulLiveCardIds = [...state.liveResolution.liveResults.entries()]
    .filter(([cardId, isSuccess]) => {
      const card = getCardById(state, cardId);
      return isSuccess === true && card?.ownerId === player.id;
    })
    .map(([cardId]) => cardId);

  for (const sourceCardId of successfulLiveCardIds) {
    const sourceCard = getCardById(state, sourceCardId);
    const abilityDefinitions = getQueuedAbilityDefinitionsForCard(
      sourceCard?.data.cardCode,
      CardAbilityCategory.LIVE_SUCCESS,
      CardAbilitySourceZone.LIVE_CARD
    );
    if (!sourceCard || abilityDefinitions.length === 0) {
      continue;
    }

    for (const abilityDefinition of abilityDefinitions) {
      const abilityId = abilityDefinition.abilityId;
      const pendingAbilityId = `${abilityId}:${sourceCardId}:turn-${state.turnCount}:live-success-${player.id}`;
      if (hasAbilityInstance(state, pendingAbilityId)) {
        continue;
      }

      const pendingAbility: PendingAbilityState = {
        id: pendingAbilityId,
        abilityId,
        sourceCardId,
        controllerId: player.id,
        mandatory: true,
        timingId: TriggerCondition.ON_LIVE_SUCCESS,
        eventIds: [`live-success:${state.turnCount}:${player.id}:${sourceCardId}`],
      };

      state = addAction(
        {
          ...state,
          pendingAbilities: [...state.pendingAbilities, pendingAbility],
        },
        'TRIGGER_ABILITY',
        pendingAbility.controllerId,
        {
          pendingAbilityId,
          abilityId: pendingAbility.abilityId,
          sourceCardId,
          timingId: pendingAbility.timingId,
        }
      );
    }
  }

  return state;
}

function getLiveSuccessEffectPlayerId(game: GameState): string | null {
  if (game.currentSubPhase === SubPhase.RESULT_FIRST_SUCCESS_EFFECTS) {
    return game.players[game.firstPlayerIndex]?.id ?? null;
  }

  if (game.currentSubPhase === SubPhase.RESULT_SECOND_SUCCESS_EFFECTS) {
    return game.players[game.firstPlayerIndex === 0 ? 1 : 0]?.id ?? null;
  }

  return game.liveResolution.performingPlayerId ?? game.players[game.activePlayerIndex]?.id ?? null;
}

function hasAbilityInstance(game: GameState, pendingAbilityId: string): boolean {
  const alreadyPending = game.pendingAbilities.some((ability) => ability.id === pendingAbilityId);
  const alreadyActive = game.activeEffect?.id === pendingAbilityId;
  const alreadyResolved = game.actionHistory.some(
    (historyAction) =>
      historyAction.type === 'RESOLVE_ABILITY' &&
      historyAction.payload.pendingAbilityId === pendingAbilityId
  );
  return alreadyPending || alreadyActive || alreadyResolved;
}

export function resolvePendingCardEffects(game: GameState): CardEffectRunnerResult {
  if (game.activeEffect) {
    return {
      gameState: game,
      resolvedAbilityIds: [],
    };
  }

  const pendingAbilities = getSupportedPendingAbilities(game);
  const ability = pendingAbilities[0];
  if (!ability) {
    return {
      gameState: game,
      resolvedAbilityIds: [],
    };
  }

  const sameTimingAbilities = pendingAbilities.filter((candidate) =>
    isSamePendingAbilityChoiceWindow(candidate, ability)
  );
  if (sameTimingAbilities.length > 1) {
    return {
      gameState: startAbilityOrderSelection(game, sameTimingAbilities),
      resolvedAbilityIds: [],
    };
  }

  return {
    gameState: startPendingAbilityEffect(game, ability),
    resolvedAbilityIds: [ability.id],
  };
}

export function confirmActiveEffectStep(
  game: GameState,
  playerId: string,
  effectId: string,
  selectedCardId?: string | null,
  selectedSlot?: SlotPosition | null,
  resolveInOrder?: boolean,
  selectedOptionId?: string | null,
  selectedCardIds?: readonly string[]
): GameState {
  const effect = game.activeEffect;
  if (!effect) {
    return game;
  }
  if (effect.id !== effectId || effect.awaitingPlayerId !== playerId) {
    return game;
  }
  if (effect.abilityId === ABILITY_ORDER_SELECTION_ID) {
    return selectPendingAbilityOrder(
      game,
      selectedCardId,
      resolveInOrder === true,
      selectedOptionId
    );
  }
  if (effect.metadata?.confirmOnlyPendingAbility === true) {
    return finishConfirmOnlyPendingAbilityEffect(game);
  }

  if (effect.abilityId === NOZOMI_ON_ENTER_ABILITY_ID && effect.stepId === NOZOMI_REVEAL_STEP_ID) {
    return finishNozomiOnEnter(game);
  }

  if (
    (effect.abilityId === HONOKA_ON_ENTER_ABILITY_ID ||
      effect.abilityId === KOTORI_ON_ENTER_ABILITY_ID) &&
    effect.stepId === SELECT_WAITING_ROOM_CARD_STEP_ID
  ) {
    return finishSelectCardsFromZoneToHandEffect(game, selectedCardId ?? null);
  }

  if (
    (effect.abilityId === LL_BP1_001_ON_ENTER_RECOVER_MEMBER_ABILITY_ID ||
      effect.abilityId === HS_BP2_002_ON_ENTER_RECOVER_LOW_COST_MEMBER_ABILITY_ID) &&
    effect.stepId === SELECT_WAITING_ROOM_CARD_STEP_ID
  ) {
    return finishSelectCardsFromZoneToHandEffect(game, selectedCardId ?? null, selectedCardIds);
  }

  if (effect.abilityId === UMI_ON_ENTER_ABILITY_ID && effect.stepId === UMI_SELECT_STEP_ID) {
    return selectedCardId
      ? revealUmiSelectedLive(game, selectedCardId)
      : finishUmiOnEnter(game, null);
  }

  if (effect.abilityId === UMI_ON_ENTER_ABILITY_ID && effect.stepId === UMI_REVEAL_STEP_ID) {
    const selectedCardIdFromMetadata =
      typeof effect.metadata?.selectedCardId === 'string' ? effect.metadata.selectedCardId : null;
    return finishUmiOnEnter(game, selectedCardIdFromMetadata);
  }

  if (
    effect.abilityId === MAKI_ON_ENTER_ABILITY_ID &&
    effect.stepId === MAKI_SELECT_HAND_LIVE_STEP_ID
  ) {
    return startMakiSelectSuccessLive(game, selectedCardId ?? null);
  }

  if (
    effect.abilityId === MAKI_ON_ENTER_ABILITY_ID &&
    effect.stepId === MAKI_SELECT_SUCCESS_LIVE_STEP_ID
  ) {
    return finishMakiOnEnter(game, selectedCardId ?? null);
  }

  if (
    (effect.abilityId === GENERIC_DISCARD_LOOK_TOP_ABILITY_ID ||
      effect.abilityId === BP3_010_ON_ENTER_LOOK_LIVE_EFFECT_ID) &&
    effect.stepId === DISCARD_LOOK_SELECT_DISCARD_STEP_ID
  ) {
    return selectedCardId
      ? startDiscardLookTopInspection(game, selectedCardId)
      : finishSkipEffect(game);
  }

  if (
    (effect.abilityId === GENERIC_DISCARD_LOOK_TOP_ABILITY_ID ||
      effect.abilityId === BP3_010_ON_ENTER_LOOK_LIVE_EFFECT_ID) &&
    effect.stepId === DISCARD_LOOK_SELECT_TAKE_STEP_ID
  ) {
    if (effect.metadata?.revealSelectedBeforeHand === true && selectedCardId) {
      return revealDiscardLookTopSelectedCard(game, selectedCardId);
    }
    return finishDiscardLookTopEffect(game, selectedCardId ?? null);
  }

  if (
    (effect.abilityId === GENERIC_DISCARD_LOOK_TOP_ABILITY_ID ||
      effect.abilityId === BP3_010_ON_ENTER_LOOK_LIVE_EFFECT_ID) &&
    effect.stepId === DISCARD_LOOK_REVEAL_SELECTED_STEP_ID
  ) {
    const selectedCardIdFromMetadata =
      typeof effect.metadata?.selectedCardId === 'string' ? effect.metadata.selectedCardId : null;
    return finishDiscardLookTopEffect(game, selectedCardIdFromMetadata);
  }

  if (
    effect.abilityId === HS_BP2_012_LEAVE_STAGE_LOOK_TOP_MEMBER_ABILITY_ID &&
    effect.stepId === HS_BP2_012_SELECT_MEMBER_STEP_ID
  ) {
    return selectedCardId
      ? revealHsBp2KosuzuSelectedMember(game, selectedCardId)
      : finishHsBp2KosuzuLeaveStageEffect(game, null);
  }

  if (
    effect.abilityId === HS_BP2_012_LEAVE_STAGE_LOOK_TOP_MEMBER_ABILITY_ID &&
    effect.stepId === HS_BP2_012_REVEAL_SELECTED_STEP_ID
  ) {
    const selectedCardIdFromMetadata =
      typeof effect.metadata?.selectedCardId === 'string' ? effect.metadata.selectedCardId : null;
    return finishHsBp2KosuzuLeaveStageEffect(game, selectedCardIdFromMetadata);
  }

  if (
    effect.abilityId === HS_BP6_017_LEAVE_STAGE_RECOVER_LIVE_AND_MEMBER_ABILITY_ID &&
    effect.stepId === HS_BP6_017_SELECT_DISCARD_STEP_ID
  ) {
    return selectedCardId
      ? startHsBp6KahoWaitingRoomSelectionAfterDiscard(game, selectedCardId)
      : finishSkipEffect(game);
  }

  if (
    effect.abilityId === HS_BP6_017_LEAVE_STAGE_RECOVER_LIVE_AND_MEMBER_ABILITY_ID &&
    effect.stepId === HS_BP6_017_SELECT_WAITING_ROOM_CARDS_STEP_ID
  ) {
    return finishHsBp6KahoRecoverCards(game, selectedCardIds ?? []);
  }

  if (effect.abilityId === KARIN_LIVE_START_ABILITY_ID && effect.stepId === KARIN_REVEAL_STEP_ID) {
    return finishKarinLiveStart(game);
  }

  if (
    effect.abilityId === KARIN_LIVE_START_ABILITY_ID &&
    effect.stepId === KARIN_POSITION_CHANGE_STEP_ID
  ) {
    return finishKarinPositionChange(game, selectedSlot ?? null);
  }

  if (
    effect.abilityId === NICO_LIVE_START_SCORE_ABILITY_ID &&
    effect.stepId === NICO_SCORE_BONUS_STEP_ID
  ) {
    return finishNicoLiveStartScoreBonus(game);
  }

  if (
    effect.abilityId === KOTORI_LIVE_START_HEART_ABILITY_ID &&
    effect.stepId === KOTORI_LIVE_START_SELECT_DISCARD_STEP_ID
  ) {
    return selectedCardId
      ? startKotoriLiveStartHeartChoice(game, selectedCardId)
      : finishSkipEffect(game);
  }

  if (
    effect.abilityId === KOTORI_LIVE_START_HEART_ABILITY_ID &&
    effect.stepId === KOTORI_LIVE_START_SELECT_HEART_STEP_ID
  ) {
    return finishKotoriLiveStartHeartBonus(game, selectedOptionId ?? null);
  }

  if (
    effect.abilityId === BOKUIMA_LIVE_START_REQUIREMENT_ABILITY_ID &&
    effect.stepId === BOKUIMA_REQUIREMENT_REDUCTION_STEP_ID
  ) {
    return finishBokuimaLiveStartRequirementReduction(game);
  }

  if (
    effect.abilityId === START_DASH_LIVE_SUCCESS_ABILITY_ID &&
    effect.stepId === START_DASH_ARRANGE_STEP_ID
  ) {
    return finishArrangeInspectedDeckTopEffect(game, selectedCardIds ?? []);
  }

  if (
    effect.abilityId === KEKE_ON_ENTER_PLACE_WAITING_ENERGY_ABILITY_ID &&
    effect.stepId === KEKE_SELECT_DISCARD_STEP_ID
  ) {
    return selectedCardId
      ? finishKekeOnEnterPlaceWaitingEnergy(game, selectedCardId)
      : finishSkipEffect(game);
  }

  if (
    effect.abilityId === SHIKI_ON_ENTER_LEFT_DRAW_DISCARD_ABILITY_ID &&
    effect.stepId === SHIKI_LEFT_SELECT_DISCARD_STEP_ID
  ) {
    return finishDrawThenDiscardOneEffect(game, selectedCardId ?? null);
  }

  if (
    effect.abilityId === HS_BP1_006_ON_ENTER_DRAW_DISCARD_ABILITY_ID &&
    effect.stepId === HS_BP1_006_ON_ENTER_SELECT_DISCARD_STEP_ID
  ) {
    return finishDrawThenDiscardOneEffect(game, selectedCardId ?? null);
  }

  if (
    effect.abilityId === HS_PB1_009_LIVE_START_DRAW_DISCARD_ABILITY_ID &&
    effect.stepId === HS_PB1_009_LIVE_START_SELECT_DISCARD_STEP_ID
  ) {
    return finishDrawThenDiscardOneEffect(game, selectedCardId ?? null);
  }

  if (
    (effect.abilityId === HS_BP6_004_ON_ENTER_WAIT_OPPONENT_LOW_COST_MEMBER_ABILITY_ID ||
      effect.abilityId === HS_BP6_004_LIVE_START_WAIT_OPPONENT_LOW_COST_MEMBER_ABILITY_ID) &&
    effect.stepId === HS_BP6_004_SELECT_OPPONENT_MEMBER_STEP_ID
  ) {
    return finishHsBp6GinkoWaitOpponentLowCostMember(game, selectedCardId ?? null);
  }

  if (
    effect.abilityId === HS_BP6_004_LIVE_START_DISCARD_GAIN_BLADE_ABILITY_ID &&
    effect.stepId === HS_BP6_004_SELECT_DISCARD_STEP_ID
  ) {
    return selectedCardId
      ? finishHsBp6GinkoDiscardGainBlade(game, selectedCardId)
      : finishSkipEffect(game);
  }

  if (
    effect.abilityId === SHIKI_ON_ENTER_RIGHT_ACTIVATE_ENERGY_ABILITY_ID &&
    effect.stepId === SHIKI_RIGHT_ACTIVATE_ENERGY_STEP_ID
  ) {
    return finishShikiOnEnterRightActivateEnergy(game);
  }

  if (
    effect.abilityId === SHIKI_LIVE_START_POSITION_CHANGE_ABILITY_ID &&
    effect.stepId === SHIKI_LIVE_START_POSITION_CHANGE_STEP_ID
  ) {
    return finishMemberPositionChangeEffect(game, selectedSlot ?? null);
  }

  if (
    effect.abilityId === CHISATO_LIVE_START_ACTIVATE_LIELLA_AND_ENERGY_ABILITY_ID &&
    effect.stepId === CHISATO_LIVE_START_ACTIVATE_STEP_ID
  ) {
    return finishChisatoLiveStartActivateAll(game);
  }

  if (
    effect.abilityId === EMMA_ON_ENTER_ACTIVATE_MEMBER_OR_ENERGY_ABILITY_ID &&
    effect.stepId === EMMA_SELECT_TARGET_TYPE_STEP_ID
  ) {
    return startEmmaTargetSelection(game, selectedOptionId ?? null);
  }

  if (
    effect.abilityId === EMMA_ON_ENTER_ACTIVATE_MEMBER_OR_ENERGY_ABILITY_ID &&
    effect.stepId === EMMA_SELECT_MEMBER_STEP_ID
  ) {
    return finishEmmaActivateMember(game, selectedCardId ?? null);
  }

  if (
    effect.abilityId === YOSHIKO_ON_ENTER_PLAY_LOW_COST_MEMBERS_ABILITY_ID &&
    effect.stepId === YOSHIKO_PAY_COST_STEP_ID
  ) {
    return selectedOptionId === 'pay'
      ? startYoshikoWaitingRoomSelectionAfterCost(game)
      : finishSkipEffect(game);
  }

  if (
    effect.abilityId === YOSHIKO_ON_ENTER_PLAY_LOW_COST_MEMBERS_ABILITY_ID &&
    effect.stepId === YOSHIKO_SELECT_WAITING_ROOM_MEMBERS_STEP_ID
  ) {
    return startYoshikoSelectStageSlot(game, selectedCardIds ?? []);
  }

  if (
    effect.abilityId === YOSHIKO_ON_ENTER_PLAY_LOW_COST_MEMBERS_ABILITY_ID &&
    effect.stepId === YOSHIKO_SELECT_STAGE_SLOT_STEP_ID
  ) {
    return finishYoshikoSelectStageSlot(game, selectedSlot ?? null);
  }

  if (
    effect.abilityId === ELI_ACTIVATED_ABILITY_ID &&
    effect.stepId === ELI_SELECT_WAITING_ROOM_MEMBER_STEP_ID
  ) {
    return finishSelectCardsFromZoneToHandEffect(game, selectedCardId ?? null);
  }

  if (
    effect.abilityId === RIN_ACTIVATED_ABILITY_ID &&
    effect.stepId === RIN_SELECT_WAITING_ROOM_LIVE_STEP_ID
  ) {
    return finishSelectCardsFromZoneToHandEffect(game, selectedCardId ?? null);
  }

  if (
    effect.abilityId === PB1_019_ACTIVATED_ABILITY_ID &&
    effect.stepId === PB1_019_SELECT_WAITING_ROOM_MEMBER_STEP_ID
  ) {
    return finishSelectCardsFromZoneToHandEffect(game, selectedCardId ?? null);
  }

  if (
    effect.abilityId === BP4_003_ACTIVATED_ABILITY_ID &&
    effect.stepId === BP4_003_SELECT_WAITING_ROOM_LIVE_STEP_ID
  ) {
    return finishSelectCardsFromZoneToHandEffect(game, selectedCardId ?? null);
  }

  return game;
}

export function activateCardAbility(
  game: GameState,
  playerId: string,
  cardId: string,
  abilityId: string
): GameState {
  if (!canUseActivatedAbilityThisTurn(game, playerId, abilityId, cardId)) {
    return game;
  }

  switch (abilityId) {
    case ELI_ACTIVATED_ABILITY_ID:
      return startEliActivatedEffect(game, playerId, cardId);
    case RIN_ACTIVATED_ABILITY_ID:
      return startRinActivatedEffect(game, playerId, cardId);
    case BP4_003_ACTIVATED_ABILITY_ID:
      return startBp4ActivatedEffect(game, playerId, cardId);
    case PB1_019_ACTIVATED_ABILITY_ID:
      return startPb1ActivatedEffect(game, playerId, cardId);
    case HANAYO_ACTIVATED_ABILITY_ID:
      return startHanayoActivatedEffect(game, playerId, cardId);
    default:
      return game;
  }
}

function getSupportedPendingAbilities(game: GameState): readonly PendingAbilityState[] {
  return game.pendingAbilities.filter((candidate) =>
    IMPLEMENTED_QUEUED_ABILITY_IDS.has(candidate.abilityId)
  );
}

function startAbilityOrderSelection(
  game: GameState,
  abilities: readonly PendingAbilityState[]
): GameState {
  const firstAbility = abilities[0];
  const sourceCardIds = abilities.map((ability) => ability.sourceCardId);
  const hasDuplicateSourceCards = new Set(sourceCardIds).size !== sourceCardIds.length;
  return {
    ...game,
    activeEffect: {
      id: `${ABILITY_ORDER_SELECTION_ID}:${firstAbility.timingId}:${firstAbility.controllerId}`,
      abilityId: ABILITY_ORDER_SELECTION_ID,
      sourceCardId: firstAbility.sourceCardId,
      controllerId: firstAbility.controllerId,
      effectText: '请选择下一个要发动的效果。也可以选择“顺序发动”，按当前队列顺序依次处理。',
      stepId: ABILITY_ORDER_SELECTION_STEP_ID,
      stepText: '选择下一个待处理效果',
      awaitingPlayerId: firstAbility.controllerId,
      selectableCardIds: hasDuplicateSourceCards ? undefined : sourceCardIds,
      selectableOptions: hasDuplicateSourceCards
        ? abilities.map((ability, index) => ({
            id: ability.id,
            label: getAbilityOrderOptionLabel(game, ability, index),
          }))
        : undefined,
      canResolveInOrder: true,
      metadata: {
        pendingAbilityIds: abilities.map((ability) => ability.id),
        usesAbilityOptions: hasDuplicateSourceCards,
      },
    },
  };
}

function selectPendingAbilityOrder(
  game: GameState,
  selectedCardId: string | null | undefined,
  resolveInOrder: boolean,
  selectedOptionId?: string | null
): GameState {
  const effect = game.activeEffect;
  if (!effect || effect.abilityId !== ABILITY_ORDER_SELECTION_ID) {
    return game;
  }

  const pendingAbilityIds = Array.isArray(effect.metadata?.pendingAbilityIds)
    ? effect.metadata.pendingAbilityIds.filter((id): id is string => typeof id === 'string')
    : [];
  const candidates = game.pendingAbilities.filter((ability) =>
    pendingAbilityIds.includes(ability.id)
  );
  const selectedAbility = resolveInOrder
    ? candidates[0]
    : selectedOptionId
      ? candidates.find((ability) => ability.id === selectedOptionId)
      : candidates.find((ability) => ability.sourceCardId === selectedCardId);

  if (!selectedAbility) {
    return game;
  }

  return startPendingAbilityEffect(
    {
      ...game,
      activeEffect: null,
    },
    selectedAbility,
    { orderedResolution: resolveInOrder, manualConfirmation: !resolveInOrder }
  );
}

function getAbilityOrderOptionLabel(
  game: GameState,
  ability: PendingAbilityState,
  index: number
): string {
  const sourceCard = getCardById(game, ability.sourceCardId);
  const abilityDefinition = CARD_ABILITY_DEFINITIONS.find(
    (definition) => definition.abilityId === ability.abilityId
  );
  const cardName = sourceCard?.data.name ?? '未知卡牌';
  return `${index + 1}. ${cardName}：${abilityDefinition?.effectText ?? ability.abilityId}`;
}

function continuePendingCardEffects(game: GameState, orderedResolution: boolean): GameState {
  if (game.activeEffect) {
    return game;
  }

  const pendingAbilities = getSupportedPendingAbilities(game);
  if (pendingAbilities.length === 0) {
    return game;
  }

  if (orderedResolution) {
    return startPendingAbilityEffect(game, pendingAbilities[0], { orderedResolution: true });
  }

  const nextAbility = pendingAbilities[0];
  const sameTimingAbilities = pendingAbilities.filter((candidate) =>
    isSamePendingAbilityChoiceWindow(candidate, nextAbility)
  );

  return sameTimingAbilities.length > 1
    ? startAbilityOrderSelection(game, sameTimingAbilities)
    : startPendingAbilityEffect(game, nextAbility);
}

function isOrderedResolutionEffect(game: GameState): boolean {
  return game.activeEffect?.metadata?.orderedResolution === true;
}

function isSamePendingAbilityChoiceWindow(
  left: PendingAbilityState,
  right: PendingAbilityState
): boolean {
  if (left.controllerId !== right.controllerId) {
    return false;
  }

  if (left.timingId === right.timingId) {
    return true;
  }

  return left.eventIds.some((eventId) => right.eventIds.includes(eventId));
}

function startPendingAbilityEffect(
  game: GameState,
  ability: PendingAbilityState,
  options: StartPendingAbilityEffectOptions = {}
): GameState {
  switch (ability.abilityId) {
    case NOZOMI_ON_ENTER_ABILITY_ID:
      return startNozomiOnEnterInspection(game, ability, options);
    case UMI_ON_ENTER_ABILITY_ID:
      return startUmiOnEnterInspection(game, ability, options);
    case HONOKA_ON_ENTER_ABILITY_ID:
      return startHonokaOnEnterSelection(game, ability, options);
    case KOTORI_ON_ENTER_ABILITY_ID:
      return startKotoriOnEnterSelection(game, ability, options);
    case LL_BP1_001_ON_ENTER_RECOVER_MEMBER_ABILITY_ID:
      return startLLBp1OnEnterSelection(game, ability, options);
    case MAKI_ON_ENTER_ABILITY_ID:
      return startMakiOnEnterSelection(game, ability, options);
    case HS_BP2_002_ON_ENTER_RECOVER_LOW_COST_MEMBER_ABILITY_ID:
      return startHsBp2OnEnterSelection(game, ability, options);
    case HS_BP2_012_LEAVE_STAGE_LOOK_TOP_MEMBER_ABILITY_ID:
      return startHsBp2KosuzuLeaveStageInspection(game, ability, options);
    case HS_BP6_017_LEAVE_STAGE_RECOVER_LIVE_AND_MEMBER_ABILITY_ID:
      return startHsBp6KahoLeaveStageDiscard(game, ability, options);
    case HS_PB1_009_ON_HASUNOSORA_ENTER_GAIN_BLADE_ABILITY_ID:
      return resolveHsPb1KahoOnHasunosoraEnterGainBlade(game, ability, options);
    case HS_PB1_009_LIVE_START_DRAW_DISCARD_ABILITY_ID:
      return startHsPb1KahoLiveStartDrawDiscard(game, ability, options);
    case HS_BP6_004_ON_ENTER_WAIT_OPPONENT_LOW_COST_MEMBER_ABILITY_ID:
    case HS_BP6_004_LIVE_START_WAIT_OPPONENT_LOW_COST_MEMBER_ABILITY_ID:
      return startHsBp6GinkoWaitOpponentLowCostMember(game, ability, options);
    case HS_BP6_004_LIVE_START_DISCARD_GAIN_BLADE_ABILITY_ID:
      return startHsBp6GinkoLiveStartDiscardGainBlade(game, ability, options);
    case GENERIC_DISCARD_LOOK_TOP_ABILITY_ID:
      return startGenericDiscardLookTopEffect(game, ability, options);
    case BP3_010_ON_ENTER_LOOK_LIVE_EFFECT_ID:
      return startGenericDiscardLookTopEffect(game, ability, options);
    case KARIN_LIVE_START_ABILITY_ID:
      return startKarinLiveStartInspection(game, ability, options);
    case KOTORI_LIVE_START_HEART_ABILITY_ID:
      return startKotoriLiveStartEffect(game, ability, options);
    case NICO_LIVE_START_SCORE_ABILITY_ID:
      return startNicoLiveStartScoreBonus(game, ability, options);
    case BOKUIMA_LIVE_START_REQUIREMENT_ABILITY_ID:
      return startBokuimaLiveStartRequirementReduction(game, ability, options);
    case START_DASH_LIVE_SUCCESS_ABILITY_ID:
      return startStartDashLiveSuccessEffect(game, ability, options);
    case KEKE_ON_ENTER_PLACE_WAITING_ENERGY_ABILITY_ID:
      return startKekeOnEnterPlaceWaitingEnergy(game, ability, options);
    case SHIKI_ON_ENTER_LEFT_DRAW_DISCARD_ABILITY_ID:
      return startShikiOnEnterLeftDrawDiscard(game, ability, options);
    case SHIKI_ON_ENTER_RIGHT_ACTIVATE_ENERGY_ABILITY_ID:
      return startShikiOnEnterRightActivateEnergy(game, ability, options);
    case SHIKI_LIVE_START_POSITION_CHANGE_ABILITY_ID:
      return startShikiLiveStartPositionChange(game, ability, options);
    case CHISATO_LIVE_START_ACTIVATE_LIELLA_AND_ENERGY_ABILITY_ID:
      return startChisatoLiveStartActivateAll(game, ability, options);
    case EMMA_ON_ENTER_ACTIVATE_MEMBER_OR_ENERGY_ABILITY_ID:
      return startEmmaOnEnterActivateMemberOrEnergy(game, ability, options);
    case YOSHIKO_ON_ENTER_PLAY_LOW_COST_MEMBERS_ABILITY_ID:
      return startYoshikoOnEnterPlayLowCostMembers(game, ability, options);
    case HS_BP1_006_ON_ENTER_DRAW_DISCARD_ABILITY_ID:
      return startDrawThenDiscardOneEffect(game, {
        ability,
        effectText: HS_BP1_006_ON_ENTER_EFFECT_TEXT,
        drawCount: 2,
        stepId: HS_BP1_006_ON_ENTER_SELECT_DISCARD_STEP_ID,
        orderedResolution: options.orderedResolution === true,
      });
    default:
      return game;
  }
}

function resolveHsPb1KahoOnHasunosoraEnterGainBlade(
  game: GameState,
  ability: PendingAbilityState,
  options: StartPendingAbilityEffectOptions = {}
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }
  if (options.manualConfirmation === true && options.skipManualConfirmation !== true) {
    return startConfirmOnlyPendingAbilityEffect(
      game,
      ability,
      HS_PB1_009_ON_HASUNOSORA_ENTER_EFFECT_TEXT,
      options
    );
  }

  let state: GameState = {
    ...game,
    pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
  };
  state = recordAbilityUse(state, player.id, ability.abilityId, ability.sourceCardId);
  state = addLiveModifier(state, {
    kind: 'BLADE',
    playerId: player.id,
    countDelta: 2,
    sourceCardId: ability.sourceCardId,
    abilityId: ability.abilityId,
  });

  return continuePendingCardEffects(
    addAction(state, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: 'APPLY_BLADE_BONUS',
      bladeBonus: 2,
      sourceSlot: ability.sourceSlot,
    }),
    options.orderedResolution === true
  );
}

function startHsPb1KahoLiveStartDrawDiscard(
  game: GameState,
  ability: PendingAbilityState,
  options: { readonly orderedResolution?: boolean } = {}
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  const effectiveBladeCount = getMemberEffectiveBladeCount(game, player.id, ability.sourceCardId);
  if (effectiveBladeCount < 8) {
    const state = {
      ...game,
      pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
    };
    return continuePendingCardEffects(
      addAction(state, 'RESOLVE_ABILITY', player.id, {
        pendingAbilityId: ability.id,
        abilityId: ability.abilityId,
        sourceCardId: ability.sourceCardId,
        step: 'SKIP_CONDITION_NOT_MET',
        sourceSlot: ability.sourceSlot,
        effectiveBladeCount,
      }),
      options.orderedResolution === true
    );
  }

  const state = addAction(game, 'RESOLVE_ABILITY', player.id, {
    pendingAbilityId: ability.id,
    abilityId: ability.abilityId,
    sourceCardId: ability.sourceCardId,
    step: 'CONDITION_MET',
    sourceSlot: ability.sourceSlot,
    effectiveBladeCount,
  });

  return startDrawThenDiscardOneEffect(state, {
    ability,
    effectText: `${HS_PB1_009_LIVE_START_EFFECT_TEXT}（当前${effectiveBladeCount}个）`,
    drawCount: 2,
    stepId: HS_PB1_009_LIVE_START_SELECT_DISCARD_STEP_ID,
    orderedResolution: options.orderedResolution === true,
  });
}

function startHsBp6GinkoWaitOpponentLowCostMember(
  game: GameState,
  ability: PendingAbilityState,
  options: { readonly orderedResolution?: boolean } = {}
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  const opponent = player ? getOpponent(game, player.id) : null;
  if (!player || !opponent) {
    return game;
  }

  const selectableCardIds = getStageMemberCardIdsMatching(
    game,
    opponent.id,
    and(typeIs(CardType.MEMBER), costLte(9))
  );

  if (selectableCardIds.length === 0) {
    const state = {
      ...game,
      pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
    };
    return continuePendingCardEffects(
      addAction(state, 'RESOLVE_ABILITY', player.id, {
        pendingAbilityId: ability.id,
        abilityId: ability.abilityId,
        sourceCardId: ability.sourceCardId,
        step: 'SKIP_NO_TARGET',
        sourceSlot: ability.sourceSlot,
        targetPlayerId: opponent.id,
      }),
      options.orderedResolution === true
    );
  }

  return addAction(
    {
      ...game,
      pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
      activeEffect: {
        id: ability.id,
        abilityId: ability.abilityId,
        sourceCardId: ability.sourceCardId,
        controllerId: ability.controllerId,
        effectText: HS_BP6_004_WAIT_OPPONENT_LOW_COST_MEMBER_EFFECT_TEXT,
        stepId: HS_BP6_004_SELECT_OPPONENT_MEMBER_STEP_ID,
        stepText: '请选择对方舞台上1名费用小于等于9的成员变为待机状态。',
        awaitingPlayerId: player.id,
        selectableCardIds,
        selectionLabel: '选择对方舞台上费用小于等于9的成员',
        metadata: {
          orderedResolution: options.orderedResolution === true,
          sourceSlot: ability.sourceSlot,
          targetPlayerId: opponent.id,
          targetOrientation: OrientationState.WAITING,
        },
      },
    },
    'RESOLVE_ABILITY',
    player.id,
    {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: 'START_SELECT_OPPONENT_MEMBER',
      sourceSlot: ability.sourceSlot,
      targetPlayerId: opponent.id,
      selectableCardIds,
    }
  );
}

function finishHsBp6GinkoWaitOpponentLowCostMember(
  game: GameState,
  selectedCardId: string | null
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    (effect.abilityId !== HS_BP6_004_ON_ENTER_WAIT_OPPONENT_LOW_COST_MEMBER_ABILITY_ID &&
      effect.abilityId !== HS_BP6_004_LIVE_START_WAIT_OPPONENT_LOW_COST_MEMBER_ABILITY_ID)
  ) {
    return game;
  }
  if (!selectedCardId || effect.selectableCardIds?.includes(selectedCardId) !== true) {
    return game;
  }

  const player = getPlayerById(game, effect.controllerId);
  const targetPlayerId =
    typeof effect.metadata?.targetPlayerId === 'string' ? effect.metadata.targetPlayerId : null;
  if (!player || !targetPlayerId) {
    return game;
  }

  const selectedCard = getCardById(game, selectedCardId);
  if (!selectedCard || !isMemberCardData(selectedCard.data) || selectedCard.data.cost > 9) {
    return game;
  }

  const orientationChange = setMemberOrientation(
    game,
    targetPlayerId,
    selectedCardId,
    OrientationState.WAITING
  );
  if (!orientationChange) {
    return game;
  }

  const state = { ...orientationChange.gameState, activeEffect: null };
  return continuePendingCardEffects(
    addAction(state, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'WAIT_OPPONENT_MEMBER',
      sourceSlot: effect.metadata?.sourceSlot,
      targetPlayerId,
      targetCardId: selectedCardId,
      previousOrientation: orientationChange.previousOrientation,
      nextOrientation: orientationChange.nextOrientation,
    }),
    isOrderedResolutionEffect(game)
  );
}

function startHsBp6GinkoLiveStartDiscardGainBlade(
  game: GameState,
  ability: PendingAbilityState,
  options: { readonly orderedResolution?: boolean } = {}
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  return addAction(
    {
      ...game,
      pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
      activeEffect: createDiscardHandToWaitingRoomActivationEffect({
        ability,
        effectText: HS_BP6_004_LIVE_START_DISCARD_GAIN_BLADE_EFFECT_TEXT,
        playerId: player.id,
        stepId: HS_BP6_004_SELECT_DISCARD_STEP_ID,
        selectableCardIds: player.hand.cardIds,
        orderedResolution: options.orderedResolution === true,
        metadata: {
          sourceSlot: ability.sourceSlot,
        },
      }),
    },
    'RESOLVE_ABILITY',
    player.id,
    {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: 'START_SELECT_DISCARD',
      sourceSlot: ability.sourceSlot,
      selectableCardIds: player.hand.cardIds,
    }
  );
}

function finishHsBp6GinkoDiscardGainBlade(
  game: GameState,
  discardCardId: string
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !== HS_BP6_004_LIVE_START_DISCARD_GAIN_BLADE_ABILITY_ID ||
    effect.selectableCardIds?.includes(discardCardId) !== true
  ) {
    return game;
  }
  const player = getPlayerById(game, effect.controllerId);
  const discardCard = getCardById(game, discardCardId);
  if (!player || !discardCard || !player.hand.cardIds.includes(discardCardId)) {
    return game;
  }

  const stateAfterDiscard = moveHandCardToWaitingRoomForEffect(game, player.id, discardCardId);
  if (!stateAfterDiscard) {
    return game;
  }

  const discardedWasGinko = and(typeIs(CardType.MEMBER), cardNameIs('百生吟子'))(discardCard);
  const bladeBonus = discardedWasGinko ? 2 : 1;
  const stateAfterModifier = addLiveModifier(stateAfterDiscard, {
    kind: 'BLADE',
    playerId: player.id,
    countDelta: bladeBonus,
    sourceCardId: effect.sourceCardId,
    abilityId: effect.abilityId,
  });
  const state = { ...stateAfterModifier, activeEffect: null };

  return continuePendingCardEffects(
    addAction(state, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'DISCARD_HAND_CARD_GAIN_BLADE',
      sourceSlot: effect.metadata?.sourceSlot,
      discardedCardId: discardCardId,
      discardedWasGinko,
      bladeBonus,
    }),
    isOrderedResolutionEffect(game)
  );
}

function startHonokaOnEnterSelection(
  game: GameState,
  ability: PendingAbilityState,
  options: { readonly orderedResolution?: boolean } = {}
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }
  const selectableCardIds =
    player.successZone.cardIds.length >= 2
      ? selectWaitingRoomCardIds(game, player.id, typeIs(CardType.LIVE))
      : [];
  return startWaitingRoomCardSelection(game, ability, player.id, {
    effectText: HONOKA_ON_ENTER_EFFECT_TEXT,
    selectableCardIds,
    orderedResolution: options.orderedResolution === true,
  });
}

function startKotoriOnEnterSelection(
  game: GameState,
  ability: PendingAbilityState,
  options: { readonly orderedResolution?: boolean } = {}
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }
  const selectableCardIds = selectWaitingRoomCardIds(
    game,
    player.id,
    and(typeIs(CardType.MEMBER), costLte(4), groupIs("μ's"))
  );
  return startWaitingRoomCardSelection(game, ability, player.id, {
    effectText: KOTORI_ON_ENTER_EFFECT_TEXT,
    selectableCardIds,
    orderedResolution: options.orderedResolution === true,
  });
}

function startLLBp1OnEnterSelection(
  game: GameState,
  ability: PendingAbilityState,
  options: { readonly orderedResolution?: boolean } = {}
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }
  const selectableCardIds = selectWaitingRoomCardIds(game, player.id, typeIs(CardType.MEMBER));
  return startWaitingRoomCardSelection(game, ability, player.id, {
    effectText: LL_BP1_001_ON_ENTER_EFFECT_TEXT,
    selectableCardIds,
    orderedResolution: options.orderedResolution === true,
  });
}

function startHsBp2OnEnterSelection(
  game: GameState,
  ability: PendingAbilityState,
  options: { readonly orderedResolution?: boolean } = {}
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }
  const selectableCardIds = selectWaitingRoomCardIds(
    game,
    player.id,
    and(typeIs(CardType.MEMBER), costLte(2))
  );
  return startWaitingRoomCardSelection(game, ability, player.id, {
    effectText: HS_BP2_002_ON_ENTER_EFFECT_TEXT,
    selectableCardIds,
    orderedResolution: options.orderedResolution === true,
    zoneSelection: createWaitingRoomToHandSelectionConfig({
      minCount: 0,
      maxCount: 2,
      optional: true,
    }),
  });
}

function startHsBp2KosuzuLeaveStageInspection(
  game: GameState,
  ability: PendingAbilityState,
  options: { readonly orderedResolution?: boolean } = {}
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  if (player.mainDeck.cardIds.length === 0) {
    const state = {
      ...game,
      pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
    };
    return continuePendingCardEffects(
      addAction(state, 'RESOLVE_ABILITY', player.id, {
        pendingAbilityId: ability.id,
        abilityId: ability.abilityId,
        sourceCardId: ability.sourceCardId,
        step: 'FINISH',
        inspectedCardIds: [],
      }),
      options.orderedResolution === true
    );
  }

  const inspection = inspectTopCards(game, player.id, {
    count: 5,
    selectablePredicate: (card) => isMemberCardData(card.data),
  });
  if (!inspection) {
    return game;
  }
  const { gameState, inspectedCardIds, selectableCardIds } = inspection;

  return addAction(
    {
      ...gameState,
      pendingAbilities: gameState.pendingAbilities.filter(
        (candidate) => candidate.id !== ability.id
      ),
      activeEffect: {
        id: ability.id,
        abilityId: ability.abilityId,
        sourceCardId: ability.sourceCardId,
        controllerId: ability.controllerId,
        effectText: HS_BP2_012_LEAVE_STAGE_EFFECT_TEXT,
        stepId: HS_BP2_012_SELECT_MEMBER_STEP_ID,
        stepText:
          selectableCardIds.length > 0
            ? '请选择至多1张成员卡公开并加入手牌。也可以不加入。'
            : '没有可加入手牌的成员卡。确认后其余卡片放置入休息室。',
        awaitingPlayerId: player.id,
        inspectionCardIds: inspectedCardIds,
        selectableCardIds,
        selectionLabel: '选择要公开并加入手牌的成员',
        confirmSelectionLabel: '公开并加入手牌',
        canSkipSelection: true,
        skipSelectionLabel: selectableCardIds.length > 0 ? '不加入' : '确认',
        metadata: {
          sourceZone: ZoneType.MAIN_DECK,
          orderedResolution: options.orderedResolution === true,
        },
      },
    },
    'RESOLVE_ABILITY',
    player.id,
    {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: 'START_INSPECTION',
      inspectedCardIds,
      selectableCardIds,
    }
  );
}

function revealHsBp2KosuzuSelectedMember(game: GameState, selectedCardId: string): GameState {
  return revealSelectedInspectionCard(game, selectedCardId, {
    stepId: HS_BP2_012_REVEAL_SELECTED_STEP_ID,
    stepText: '选择的成员卡已公开。确认后加入手牌，其余卡片放置入休息室。',
    actionStep: 'REVEAL_SELECTED_MEMBER',
  });
}

function finishHsBp2KosuzuLeaveStageEffect(
  game: GameState,
  selectedCardId: string | null
): GameState {
  const effect = game.activeEffect;
  if (!effect) {
    return game;
  }
  const player = getPlayerById(game, effect.controllerId);
  if (!player) {
    return game;
  }

  const inspectedCardIds = effect.inspectionCardIds ?? [];
  const selectedCard =
    selectedCardId !== null ? (game.cardRegistry.get(selectedCardId)?.data ?? null) : null;
  if (
    selectedCardId !== null &&
    (!inspectedCardIds.includes(selectedCardId) || !selectedCard || !isMemberCardData(selectedCard))
  ) {
    return game;
  }

  const moveResult = moveInspectedSelectionToHandRestToWaitingRoom(
    game,
    player.id,
    inspectedCardIds,
    selectedCardId
  );
  if (!moveResult) {
    return game;
  }

  const state = { ...moveResult.gameState, activeEffect: null };
  return continuePendingCardEffects(
    addAction(state, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'FINISH',
      selectedCardId: moveResult.selectedCardId,
      waitingRoomCardIds: moveResult.waitingRoomCardIds,
    }),
    isOrderedResolutionEffect(game)
  );
}

function startHsBp6KahoLeaveStageDiscard(
  game: GameState,
  ability: PendingAbilityState,
  options: { readonly orderedResolution?: boolean } = {}
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  return addAction(
    {
      ...game,
      pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
      activeEffect: createDiscardHandToWaitingRoomActivationEffect({
        ability,
        effectText: HS_BP6_017_LEAVE_STAGE_EFFECT_TEXT,
        playerId: player.id,
        stepId: HS_BP6_017_SELECT_DISCARD_STEP_ID,
        selectableCardIds: player.hand.cardIds,
        orderedResolution: options.orderedResolution === true,
      }),
    },
    'RESOLVE_ABILITY',
    player.id,
    {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: 'START_SELECT_DISCARD',
      selectableCardIds: player.hand.cardIds,
    }
  );
}

function startHsBp6KahoWaitingRoomSelectionAfterDiscard(
  game: GameState,
  discardCardId: string
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !== HS_BP6_017_LEAVE_STAGE_RECOVER_LIVE_AND_MEMBER_ABILITY_ID ||
    !effect.selectableCardIds?.includes(discardCardId)
  ) {
    return game;
  }
  const player = getPlayerById(game, effect.controllerId);
  if (!player || !player.hand.cardIds.includes(discardCardId)) {
    return game;
  }

  const stateAfterDiscard = moveHandCardToWaitingRoomForEffect(game, player.id, discardCardId);
  if (!stateAfterDiscard) {
    return game;
  }
  const selectableCardIds = selectWaitingRoomCardIds(
    stateAfterDiscard,
    player.id,
    (card) => isLiveCardData(card.data) || isMemberCardData(card.data)
  );

  return addAction(
    {
      ...stateAfterDiscard,
      activeEffect: {
        ...effect,
        stepId: HS_BP6_017_SELECT_WAITING_ROOM_CARDS_STEP_ID,
        stepText: '请选择休息室中的 LIVE 卡和成员卡至多各1张加入手牌。也可以不选择。',
        selectableCardIds,
        selectableCardMode: 'ORDERED_MULTI',
        minSelectableCards: 0,
        maxSelectableCards: Math.min(2, selectableCardIds.length),
        selectionLabel: '选择要加入手牌的 LIVE / 成员',
        confirmSelectionLabel: '加入手牌',
        canSkipSelection: true,
        skipSelectionLabel: '不加入',
        metadata: {
          ...effect.metadata,
          discardCardId,
        },
      },
    },
    'RESOLVE_ABILITY',
    player.id,
    {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'DISCARD_HAND_CARD',
      discardCardId,
      selectableCardIds,
    }
  );
}

function finishHsBp6KahoRecoverCards(
  game: GameState,
  selectedCardIds: readonly string[]
): GameState {
  const effect = game.activeEffect;
  if (!effect || effect.abilityId !== HS_BP6_017_LEAVE_STAGE_RECOVER_LIVE_AND_MEMBER_ABILITY_ID) {
    return game;
  }
  const player = getPlayerById(game, effect.controllerId);
  if (!player) {
    return game;
  }

  const uniqueSelectedCardIds = [...new Set(selectedCardIds)];
  if (
    uniqueSelectedCardIds.length !== selectedCardIds.length ||
    uniqueSelectedCardIds.length > 2 ||
    !uniqueSelectedCardIds.every(
      (cardId) =>
        effect.selectableCardIds?.includes(cardId) === true &&
        player.waitingRoom.cardIds.includes(cardId)
    )
  ) {
    return game;
  }

  const selectedCards = uniqueSelectedCardIds.map((cardId) => getCardById(game, cardId));
  const selectedLiveCount = selectedCards.filter(
    (card) => card && isLiveCardData(card.data)
  ).length;
  const selectedMemberCount = selectedCards.filter(
    (card) => card && isMemberCardData(card.data)
  ).length;
  if (
    selectedCards.some((card) => !card) ||
    selectedLiveCount > 1 ||
    selectedMemberCount > 1 ||
    selectedLiveCount + selectedMemberCount !== uniqueSelectedCardIds.length
  ) {
    return game;
  }

  const movedState = moveSelectedCardsFromZone(
    game,
    player.id,
    uniqueSelectedCardIds,
    createWaitingRoomToHandSelectionConfig({
      minCount: 0,
      maxCount: 2,
      optional: true,
    })
  );
  if (!movedState) {
    return game;
  }

  const state = { ...movedState, activeEffect: null };
  return continuePendingCardEffects(
    addAction(state, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'RECOVER_LIVE_AND_MEMBER',
      selectedCardIds: uniqueSelectedCardIds,
      liveCardIds: uniqueSelectedCardIds.filter((cardId) => {
        const card = getCardById(game, cardId);
        return card !== null && isLiveCardData(card.data);
      }),
      memberCardIds: uniqueSelectedCardIds.filter((cardId) => {
        const card = getCardById(game, cardId);
        return card !== null && isMemberCardData(card.data);
      }),
    }),
    isOrderedResolutionEffect(game)
  );
}

function startWaitingRoomCardSelection(
  game: GameState,
  ability: PendingAbilityState,
  playerId: string,
  config: {
    readonly effectText: string;
    readonly selectableCardIds: readonly string[];
    readonly orderedResolution: boolean;
    readonly zoneSelection?: ReturnType<typeof createWaitingRoomToHandSelectionConfig>;
  }
): GameState {
  const zoneSelection = config.zoneSelection ?? createWaitingRoomToHandSelectionConfig();
  return addAction(
    {
      ...game,
      pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
      activeEffect: createWaitingRoomToHandEffectState({
        id: ability.id,
        abilityId: ability.abilityId,
        sourceCardId: ability.sourceCardId,
        controllerId: ability.controllerId,
        effectText: config.effectText,
        stepId: SELECT_WAITING_ROOM_CARD_STEP_ID,
        awaitingPlayerId: playerId,
        selectableCardIds: config.selectableCardIds,
        metadata: {
          orderedResolution: config.orderedResolution,
        },
        zoneSelection,
      }),
    },
    'RESOLVE_ABILITY',
    playerId,
    {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: 'START_SELECT_WAITING_ROOM_CARD',
      selectableCardIds: config.selectableCardIds,
    }
  );
}

function startYoshikoOnEnterPlayLowCostMembers(
  game: GameState,
  ability: PendingAbilityState,
  options: { readonly orderedResolution?: boolean } = {}
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  const activeEnergyCardIds = getActiveEnergyCardIds(player);
  const emptySlots = getEmptyMemberSlots(player);
  const canPay = activeEnergyCardIds.length >= 4 && emptySlots.length > 0;
  const selectableOptions = canPay
    ? [
        { id: 'pay', label: '支付4能量' },
        { id: 'decline', label: DECLINE_OPTION_LABEL },
      ]
    : [{ id: 'decline', label: DECLINE_OPTION_LABEL }];

  return addAction(
    {
      ...game,
      pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
      activeEffect: {
        id: ability.id,
        abilityId: ability.abilityId,
        sourceCardId: ability.sourceCardId,
        controllerId: ability.controllerId,
        effectText: YOSHIKO_ON_ENTER_PLAY_LOW_COST_MEMBERS_EFFECT_TEXT,
        stepId: YOSHIKO_PAY_COST_STEP_ID,
        stepText: canPay
          ? '可以支付4张活跃能量发动此效果。'
          : '当前无法支付4张活跃能量或没有空成员区，可以不发动。',
        awaitingPlayerId: player.id,
        selectableOptions,
        metadata: {
          orderedResolution: options.orderedResolution === true,
          activeEnergyCardIds,
          emptySlots,
        },
      },
    },
    'RESOLVE_ABILITY',
    player.id,
    {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: 'START_PAY_OPTION',
      canPay,
      activeEnergyCardIds,
      emptySlots,
    }
  );
}

function startYoshikoWaitingRoomSelectionAfterCost(game: GameState): GameState {
  const effect = game.activeEffect;
  if (!effect) {
    return game;
  }

  const player = getPlayerById(game, effect.controllerId);
  if (!player) {
    return game;
  }

  const costPayment = payImmediateEffectCosts(game, player.id, effect.sourceCardId, [
    { kind: 'TAP_ACTIVE_ENERGY', count: 4 },
  ]);
  if (!costPayment) {
    return game;
  }

  const selectableCardIds = getYoshikoWaitingRoomCandidateCardIds(costPayment.gameState, player.id);
  const emptySlots = getEmptyMemberSlots(player);
  const state = addAction(costPayment.gameState, 'PAY_COST', player.id, {
    pendingAbilityId: effect.id,
    abilityId: effect.abilityId,
    sourceCardId: effect.sourceCardId,
    energyCardIds: costPayment.paidEnergyCardIds,
    amount: costPayment.paidEnergyCardIds.length,
  });

  return addAction(
    {
      ...state,
      activeEffect: {
        ...effect,
        stepId: YOSHIKO_SELECT_WAITING_ROOM_MEMBERS_STEP_ID,
        stepText: '请选择至多2张费用合计小于等于4的成员卡。也可以不选择。',
        selectableCardIds,
        selectableCardMode: 'ORDERED_MULTI',
        minSelectableCards: 0,
        maxSelectableCards: Math.min(2, selectableCardIds.length, emptySlots.length),
        canSkipSelection: true,
        selectableOptions: undefined,
        selectionLabel: '选择要从休息室登场的成员',
        confirmSelectionLabel: '确认选择',
        metadata: {
          ...effect.metadata,
          paidEnergyCardIds: costPayment.paidEnergyCardIds,
          selectableCardIds,
          emptySlots,
        },
      },
    },
    'RESOLVE_ABILITY',
    player.id,
    {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'PAY_COST_SELECT_WAITING_ROOM_MEMBERS',
      paidEnergyCardIds: costPayment.paidEnergyCardIds,
      selectableCardIds,
      emptySlots,
    }
  );
}

function startYoshikoSelectStageSlot(
  game: GameState,
  selectedCardIds: readonly string[]
): GameState {
  const effect = game.activeEffect;
  if (!effect) {
    return game;
  }

  const player = getPlayerById(game, effect.controllerId);
  if (!player) {
    return game;
  }

  const uniqueSelectedCardIds = [...new Set(selectedCardIds)];
  const selectedAreValid =
    uniqueSelectedCardIds.length === selectedCardIds.length &&
    uniqueSelectedCardIds.length <= 2 &&
    uniqueSelectedCardIds.every(
      (cardId) =>
        effect.selectableCardIds?.includes(cardId) === true &&
        player.waitingRoom.cardIds.includes(cardId)
    ) &&
    calculateMemberCostSum(game, uniqueSelectedCardIds) <= 4;

  if (!selectedAreValid) {
    return game;
  }

  if (uniqueSelectedCardIds.length === 0) {
    const state = { ...game, activeEffect: null };
    return continuePendingCardEffects(
      addAction(state, 'RESOLVE_ABILITY', player.id, {
        pendingAbilityId: effect.id,
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
        step: 'FINISH_NO_SELECTION',
      }),
      isOrderedResolutionEffect(game)
    );
  }

  const nextCardId = uniqueSelectedCardIds[0];
  return addAction(
    {
      ...game,
      activeEffect: {
        ...effect,
        stepId: YOSHIKO_SELECT_STAGE_SLOT_STEP_ID,
        stepText: '请选择该成员要登场的空成员区。',
        selectableCardIds: [nextCardId],
        selectableCardMode: 'SINGLE',
        minSelectableCards: undefined,
        maxSelectableCards: undefined,
        selectableSlots: getEmptyMemberSlots(player),
        selectionLabel: '选择登场槽位',
        confirmSelectionLabel: '登场',
        canSkipSelection: false,
        metadata: {
          ...effect.metadata,
          selectedWaitingRoomCardIds: uniqueSelectedCardIds,
          nextWaitingRoomCardIndex: 0,
        },
      },
    },
    'RESOLVE_ABILITY',
    player.id,
    {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'SELECT_STAGE_SLOT',
      selectedCardIds: uniqueSelectedCardIds,
      nextCardId,
    }
  );
}

function finishYoshikoSelectStageSlot(
  game: GameState,
  selectedSlot: SlotPosition | null
): GameState {
  const effect = game.activeEffect;
  if (!effect || selectedSlot === null) {
    return game;
  }

  const player = getPlayerById(game, effect.controllerId);
  if (!player || !effect.selectableSlots?.includes(selectedSlot)) {
    return game;
  }

  const selectedWaitingRoomCardIds = Array.isArray(effect.metadata?.selectedWaitingRoomCardIds)
    ? effect.metadata.selectedWaitingRoomCardIds.filter(
        (cardId): cardId is string => typeof cardId === 'string'
      )
    : [];
  const currentIndex =
    typeof effect.metadata?.nextWaitingRoomCardIndex === 'number'
      ? effect.metadata.nextWaitingRoomCardIndex
      : 0;
  const cardId = selectedWaitingRoomCardIds[currentIndex];
  if (!cardId) {
    return game;
  }

  const playResult = playMembersFromWaitingRoomToEmptySlots(game, player.id, [
    { cardId, toSlot: selectedSlot },
  ]);
  if (!playResult) {
    return game;
  }

  const nextIndex = currentIndex + 1;
  const nextCardId = selectedWaitingRoomCardIds[nextIndex];
  const state = addAction(playResult.gameState, 'RESOLVE_ABILITY', player.id, {
    pendingAbilityId: effect.id,
    abilityId: effect.abilityId,
    sourceCardId: effect.sourceCardId,
    step: 'PLAY_MEMBER_FROM_WAITING_ROOM',
    playedCardId: cardId,
    toSlot: selectedSlot,
  });
  const stateWithOnEnter = enqueueTriggeredCardEffects(state, [TriggerCondition.ON_ENTER_STAGE], {
    onEnterSources: [
      {
        cardId,
        controllerId: player.id,
        sourceSlot: selectedSlot,
        eventId: `effect-enter:${state.actionSequence}:${cardId}:${selectedSlot}`,
      },
    ],
  });

  if (!nextCardId) {
    return continuePendingCardEffects(
      { ...stateWithOnEnter, activeEffect: null },
      isOrderedResolutionEffect(game)
    );
  }

  const nextPlayer = getPlayerById(stateWithOnEnter, player.id);
  if (!nextPlayer) {
    return game;
  }

  return {
    ...stateWithOnEnter,
    activeEffect: {
      ...effect,
      selectableCardIds: [nextCardId],
      selectableSlots: getEmptyMemberSlots(nextPlayer),
      metadata: {
        ...effect.metadata,
        selectedWaitingRoomCardIds,
        nextWaitingRoomCardIndex: nextIndex,
      },
    },
  };
}

function finishSelectCardsFromZoneToHandEffect(
  game: GameState,
  selectedCardId: string | null,
  selectedCardIds: readonly string[] | undefined = undefined
): GameState {
  const effect = game.activeEffect;
  if (!effect) {
    return game;
  }
  const player = getPlayerById(game, effect.controllerId);
  if (!player) {
    return game;
  }
  const orderedSelections =
    Array.isArray(selectedCardIds) && selectedCardIds.length > 0 ? selectedCardIds : [];
  const selectedCardIdsToMove =
    orderedSelections.length > 0
      ? orderedSelections
      : selectedCardId !== null
        ? [selectedCardId]
        : [];
  const uniqueSelectedCardIds = [...new Set(selectedCardIdsToMove)];
  if (uniqueSelectedCardIds.length !== selectedCardIdsToMove.length) {
    return game;
  }
  const zoneSelection = getZoneSelectionConfig(effect);
  if (
    uniqueSelectedCardIds.length < zoneSelection.minCount ||
    uniqueSelectedCardIds.length > zoneSelection.maxCount
  ) {
    return game;
  }
  const selectedAreValid = uniqueSelectedCardIds.every(
    (cardId) =>
      effect.selectableCardIds?.includes(cardId) === true &&
      player.waitingRoom.cardIds.includes(cardId)
  );
  if (!selectedAreValid) {
    return game;
  }
  const movedState = moveSelectedCardsFromZone(
    game,
    player.id,
    uniqueSelectedCardIds,
    zoneSelection
  );
  if (!movedState) {
    return game;
  }
  let state = movedState;
  state = { ...state, activeEffect: null };
  return continuePendingCardEffects(
    addAction(state, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'FINISH',
      selectedCardId: uniqueSelectedCardIds[0] ?? null,
      selectedCardIds: uniqueSelectedCardIds,
    }),
    isOrderedResolutionEffect(game)
  );
}

function startMakiOnEnterSelection(
  game: GameState,
  ability: PendingAbilityState,
  options: { readonly orderedResolution?: boolean } = {}
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }
  const selectableCardIds = player.hand.cardIds.filter((cardId) => {
    const card = getCardById(game, cardId);
    return card !== null && isLiveCardData(card.data);
  });
  return addAction(
    {
      ...game,
      pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
      activeEffect: {
        id: ability.id,
        abilityId: ability.abilityId,
        sourceCardId: ability.sourceCardId,
        controllerId: ability.controllerId,
        effectText: MAKI_EFFECT_TEXT,
        stepId: MAKI_SELECT_HAND_LIVE_STEP_ID,
        stepText: MAKI_EFFECT_TEXT,
        awaitingPlayerId: player.id,
        selectableCardIds,
        canSkipSelection: true,
        metadata: { orderedResolution: options.orderedResolution === true },
      },
    },
    'RESOLVE_ABILITY',
    player.id,
    {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: 'START_SELECT_HAND_LIVE',
      selectableCardIds,
    }
  );
}

function startMakiSelectSuccessLive(game: GameState, handLiveCardId: string | null): GameState {
  const effect = game.activeEffect;
  if (!effect) {
    return game;
  }
  const player = getPlayerById(game, effect.controllerId);
  if (!player || handLiveCardId === null || !effect.selectableCardIds?.includes(handLiveCardId)) {
    return finishSkipEffect(game);
  }
  return addAction(
    {
      ...game,
      activeEffect: {
        ...effect,
        stepId: MAKI_SELECT_SUCCESS_LIVE_STEP_ID,
        stepText: '请选择要加入手牌的成功 Live。所公开的手牌 Live 会放置入成功 Live 卡区。',
        selectableCardIds: player.successZone.cardIds.filter((cardId) => {
          const card = getCardById(game, cardId);
          return card !== null && isLiveCardData(card.data);
        }),
        canSkipSelection: true,
        metadata: {
          ...effect.metadata,
          handLiveCardId,
        },
      },
    },
    'RESOLVE_ABILITY',
    player.id,
    {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'REVEAL_HAND_LIVE',
      handLiveCardId,
    }
  );
}

function finishMakiOnEnter(game: GameState, successLiveCardId: string | null): GameState {
  const effect = game.activeEffect;
  if (!effect) {
    return game;
  }
  const player = getPlayerById(game, effect.controllerId);
  const handLiveCardId =
    typeof effect.metadata?.handLiveCardId === 'string' ? effect.metadata.handLiveCardId : null;
  if (
    !player ||
    handLiveCardId === null ||
    successLiveCardId === null ||
    !effect.selectableCardIds?.includes(successLiveCardId)
  ) {
    return finishSkipEffect(game);
  }
  let state = updatePlayer(game, player.id, (currentPlayer) => ({
    ...currentPlayer,
    hand: {
      ...currentPlayer.hand,
      cardIds: [
        ...currentPlayer.hand.cardIds.filter((cardId) => cardId !== handLiveCardId),
        successLiveCardId,
      ],
    },
    successZone: {
      ...currentPlayer.successZone,
      cardIds: [
        ...currentPlayer.successZone.cardIds.filter((cardId) => cardId !== successLiveCardId),
        handLiveCardId,
      ],
    },
  }));
  state = { ...state, activeEffect: null };
  return continuePendingCardEffects(
    addAction(state, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'FINISH',
      handLiveCardId,
      successLiveCardId,
    }),
    isOrderedResolutionEffect(game)
  );
}

function startNicoLiveStartScoreBonus(
  game: GameState,
  ability: PendingAbilityState,
  options: { readonly orderedResolution?: boolean } = {}
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  const effectText = formatNicoEffectText(game, player.id);

  return addAction(
    {
      ...game,
      pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
      activeEffect: {
        id: ability.id,
        abilityId: ability.abilityId,
        sourceCardId: ability.sourceCardId,
        controllerId: ability.controllerId,
        effectText,
        stepId: NICO_SCORE_BONUS_STEP_ID,
        stepText: effectText,
        awaitingPlayerId: player.id,
        metadata: {
          orderedResolution: options.orderedResolution === true,
        },
      },
    },
    'RESOLVE_ABILITY',
    player.id,
    {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: 'START_CONFIRM',
    }
  );
}

function finishNicoLiveStartScoreBonus(game: GameState): GameState {
  const effect = game.activeEffect;
  if (!effect) {
    return game;
  }

  const player = getPlayerById(game, effect.controllerId);
  if (!player) {
    return game;
  }

  const museWaitingRoomCount = countMuseWaitingRoomCards(game, player.id);
  const isConditionMet = museWaitingRoomCount >= 25;
  let state: GameState = {
    ...game,
    activeEffect: null,
  };
  if (isConditionMet) {
    state = addLiveModifier(state, {
      kind: 'SCORE',
      playerId: player.id,
      countDelta: 1,
      sourceCardId: effect.sourceCardId,
      abilityId: effect.abilityId,
    });
  }

  return continuePendingCardEffects(
    addAction(state, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'APPLY_SCORE_BONUS',
      effectText: NICO_EFFECT_TEXT,
      conditionMet: isConditionMet,
      museWaitingRoomCount,
      scoreBonus: isConditionMet ? 1 : 0,
    }),
    isOrderedResolutionEffect(game)
  );
}

function formatNicoEffectText(game: GameState, playerId: string): string {
  return `${NICO_EFFECT_TEXT}（当前${countMuseWaitingRoomCards(game, playerId)}张）`;
}

function startBokuimaLiveStartRequirementReduction(
  game: GameState,
  ability: PendingAbilityState,
  options: { readonly orderedResolution?: boolean } = {}
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  const successLiveCount = player.successZone.cardIds.length;
  const reduction = successLiveCount * 2;
  const effectText = `${BOKUIMA_EFFECT_TEXT}（当前成功LIVE ${successLiveCount}张，减少${reduction}个無Heart）`;

  return addAction(
    {
      ...game,
      pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
      activeEffect: {
        id: ability.id,
        abilityId: ability.abilityId,
        sourceCardId: ability.sourceCardId,
        controllerId: ability.controllerId,
        effectText,
        stepId: BOKUIMA_REQUIREMENT_REDUCTION_STEP_ID,
        stepText: effectText,
        awaitingPlayerId: player.id,
        metadata: {
          orderedResolution: options.orderedResolution === true,
        },
      },
    },
    'RESOLVE_ABILITY',
    player.id,
    {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: 'START_CONFIRM',
      successLiveCount,
      requirementReduction: reduction,
    }
  );
}

function finishBokuimaLiveStartRequirementReduction(game: GameState): GameState {
  const effect = game.activeEffect;
  if (!effect) {
    return game;
  }

  const player = getPlayerById(game, effect.controllerId);
  if (!player) {
    return game;
  }

  const successLiveCount = player.successZone.cardIds.length;
  const reduction = successLiveCount * 2;
  let state: GameState = {
    ...game,
    activeEffect: null,
  };
  if (reduction > 0) {
    const modifier = {
      kind: 'REQUIREMENT' as const,
      liveCardId: effect.sourceCardId,
      modifiers: [{ color: HeartColor.RAINBOW, countDelta: -reduction }],
      sourceCardId: effect.sourceCardId,
      abilityId: effect.abilityId,
    };
    state = replaceLiveModifier(
      state,
      {
        kind: 'REQUIREMENT',
        liveCardId: effect.sourceCardId,
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
      },
      modifier
    );
  } else {
    state = replaceLiveModifier(
      state,
      {
        kind: 'REQUIREMENT',
        liveCardId: effect.sourceCardId,
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
      },
      null
    );
  }

  return continuePendingCardEffects(
    addAction(state, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'APPLY_REQUIREMENT_REDUCTION',
      successLiveCount,
      requirementReduction: reduction,
    }),
    isOrderedResolutionEffect(game)
  );
}

function countMuseWaitingRoomCards(game: GameState, playerId: string): number {
  const player = getPlayerById(game, playerId);
  if (!player) {
    return 0;
  }

  return player.waitingRoom.cardIds.filter((cardId) => {
    const card = getCardById(game, cardId);
    return card !== null && isMuseCard(card.data);
  }).length;
}

function isMuseCard(cardData: {
  readonly cardCode?: string;
  readonly groupName?: string;
  readonly cardText?: string;
}): boolean {
  if (cardData.groupName?.includes('μ') || cardData.cardText?.includes('μ')) {
    return true;
  }

  return cardData.cardCode?.startsWith('PL!-') === true;
}

function isMuseLiveCardData(cardData: Parameters<typeof isLiveCardData>[0] | undefined): boolean {
  return cardData !== undefined && isLiveCardData(cardData) && isMuseCard(cardData);
}

function startNozomiOnEnterInspection(
  game: GameState,
  ability: PendingAbilityState,
  options: { readonly orderedResolution?: boolean } = {}
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  const inspection = inspectTopCards(game, player.id, {
    count: 5,
    reveal: true,
  });
  if (!inspection) {
    return game;
  }
  const { gameState, inspectedCardIds } = inspection;

  const state = {
    ...gameState,
    pendingAbilities: gameState.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
    activeEffect: {
      id: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      controllerId: ability.controllerId,
      effectText: NOZOMI_EFFECT_TEXT,
      stepId: NOZOMI_REVEAL_STEP_ID,
      stepText: '卡组顶5张已公开。确认后将这些牌放入休息室，并在其中有LIVE卡时抽1张。',
      awaitingPlayerId: player.id,
      inspectionCardIds: inspectedCardIds,
      metadata: {
        sourceZone: ZoneType.MAIN_DECK,
        orderedResolution: options.orderedResolution === true,
      },
    },
  };

  return addAction(state, 'RESOLVE_ABILITY', player.id, {
    pendingAbilityId: ability.id,
    abilityId: ability.abilityId,
    sourceCardId: ability.sourceCardId,
    step: 'START_INSPECTION',
    inspectedCardIds,
  });
}

function startUmiOnEnterInspection(
  game: GameState,
  ability: PendingAbilityState,
  options: { readonly orderedResolution?: boolean } = {}
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  const inspection = inspectTopCards(game, player.id, {
    count: 5,
    selectablePredicate: (card) => isMuseLiveCardData(card.data),
  });
  if (!inspection) {
    return game;
  }
  const { gameState, inspectedCardIds, selectableCardIds } = inspection;

  const state = {
    ...gameState,
    pendingAbilities: gameState.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
    activeEffect: {
      id: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      controllerId: ability.controllerId,
      effectText: UMI_EFFECT_TEXT,
      stepId: UMI_SELECT_STEP_ID,
      stepText: UMI_EFFECT_TEXT,
      awaitingPlayerId: player.id,
      inspectionCardIds: inspectedCardIds,
      selectableCardIds,
      canSkipSelection: true,
      metadata: {
        sourceZone: ZoneType.MAIN_DECK,
        orderedResolution: options.orderedResolution === true,
      },
    },
  };

  return addAction(state, 'RESOLVE_ABILITY', player.id, {
    pendingAbilityId: ability.id,
    abilityId: ability.abilityId,
    sourceCardId: ability.sourceCardId,
    step: 'START_INSPECTION',
    inspectedCardIds,
    selectableCardIds,
  });
}

function startGenericDiscardLookTopEffect(
  game: GameState,
  ability: PendingAbilityState,
  options: { readonly orderedResolution?: boolean } = {}
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  const sourceCard = getCardById(game, ability.sourceCardId);
  if (!player || !sourceCard) {
    return game;
  }
  const selectableCardIds = player.hand.cardIds.filter((cardId) => cardId !== ability.sourceCardId);
  const cardCode = sourceCard.data.cardCode;
  const topCount = getDiscardLookTopCount(cardCode);
  const selectableCardType = getDiscardLookTopSelectableCardType(cardCode);
  return addAction(
    {
      ...game,
      pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
      activeEffect: createDiscardHandToWaitingRoomActivationEffect({
        ability,
        playerId: player.id,
        effectText: getDiscardLookTopEffectText(cardCode),
        stepId: DISCARD_LOOK_SELECT_DISCARD_STEP_ID,
        selectableCardIds,
        orderedResolution: options.orderedResolution === true,
        metadata: {
          topCount,
          memberOnly: selectableCardType === 'MEMBER',
          liveOnly: selectableCardType === 'LIVE',
          selectionRequired: isDiscardLookTopSelectionRequired(cardCode),
          revealSelectedBeforeHand: cardCode === 'PL!-sd1-015-SD' || cardCode === 'PL!-bp3-010-N',
        },
      }),
    },
    'RESOLVE_ABILITY',
    player.id,
    {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: 'START_SELECT_DISCARD',
      selectableCardIds,
    }
  );
}

function startDiscardLookTopInspection(game: GameState, discardCardId: string): GameState {
  const effect = game.activeEffect;
  if (!effect || !effect.selectableCardIds?.includes(discardCardId)) {
    return game;
  }
  const player = getPlayerById(game, effect.controllerId);
  if (!player || !player.hand.cardIds.includes(discardCardId)) {
    return game;
  }
  const topCount = typeof effect.metadata?.topCount === 'number' ? effect.metadata.topCount : 3;
  const memberOnly = effect.metadata?.memberOnly === true;
  const liveOnly = effect.metadata?.liveOnly === true;
  const selectionRequired = effect.metadata?.selectionRequired === true;
  const stateAfterDiscard = moveHandCardToWaitingRoomForEffect(game, player.id, discardCardId);
  if (!stateAfterDiscard) {
    return game;
  }
  const inspection = inspectTopCards(stateAfterDiscard, player.id, {
    count: topCount,
    selectablePredicate: liveOnly
      ? (card) => isLiveCardData(card.data)
      : memberOnly
        ? (card) => isMemberCardData(card.data)
        : undefined,
  });
  if (!inspection) {
    return game;
  }
  const { gameState: state, inspectedCardIds, selectableCardIds } = inspection;
  return addAction(
    {
      ...state,
      activeEffect: {
        ...effect,
        stepId: DISCARD_LOOK_SELECT_TAKE_STEP_ID,
        stepText: liveOnly
          ? '请选择其中1张LIVE卡加入手牌，其余放置入休息室。'
          : memberOnly
            ? '请选择其中1张成员卡加入手牌，其余放置入休息室。'
            : '请选择其中1张卡加入手牌，其余放置入休息室。',
        inspectionCardIds: inspectedCardIds,
        selectableCardIds,
        selectionLabel: selectionRequired
          ? '请选择要加入手牌的卡牌'
          : liveOnly
            ? '请选择要加入手牌的LIVE卡'
            : '请选择要加入手牌的成员卡',
        canSkipSelection: !selectionRequired,
        skipSelectionLabel: !selectionRequired ? '不加入' : undefined,
        metadata: {
          ...effect.metadata,
          discardCardId,
          selectionRequired,
          revealSelectedBeforeHand:
            effect.metadata?.revealSelectedBeforeHand === true &&
            (memberOnly === true || liveOnly === true),
        },
      },
    },
    'RESOLVE_ABILITY',
    player.id,
    {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'START_INSPECTION',
      discardCardId,
      inspectedCardIds,
      selectableCardIds,
    }
  );
}

function finishDiscardLookTopEffect(game: GameState, selectedCardId: string | null): GameState {
  const effect = game.activeEffect;
  if (!effect) {
    return game;
  }
  const player = getPlayerById(game, effect.controllerId);
  if (!player) {
    return game;
  }
  const inspectedCardIds = effect.inspectionCardIds ?? [];
  const selectedWasRevealed =
    effect.stepId === DISCARD_LOOK_REVEAL_SELECTED_STEP_ID &&
    typeof effect.metadata?.selectedCardId === 'string' &&
    effect.metadata.selectedCardId === selectedCardId;
  const selectedIsValid =
    selectedCardId !== null &&
    inspectedCardIds.includes(selectedCardId) &&
    (effect.selectableCardIds?.includes(selectedCardId) === true || selectedWasRevealed);
  const selectionRequired = effect.metadata?.selectionRequired === true;
  if (selectionRequired && !selectedIsValid && (effect.selectableCardIds?.length ?? 0) > 0) {
    return game;
  }
  const cardToHandId = selectedIsValid ? selectedCardId : null;
  const moveResult = moveInspectedSelectionToHandRestToWaitingRoom(
    game,
    player.id,
    inspectedCardIds,
    cardToHandId
  );
  if (!moveResult) {
    return game;
  }
  const state = { ...moveResult.gameState, activeEffect: null };
  return continuePendingCardEffects(
    addAction(state, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'FINISH',
      selectedCardId: moveResult.selectedCardId,
      waitingRoomCardIds: moveResult.waitingRoomCardIds,
    }),
    isOrderedResolutionEffect(game)
  );
}

function revealDiscardLookTopSelectedCard(game: GameState, selectedCardId: string): GameState {
  return revealSelectedInspectionCard(game, selectedCardId, {
    stepId: DISCARD_LOOK_REVEAL_SELECTED_STEP_ID,
    stepText:
      game.activeEffect?.effectText ?? '选择的卡片已公开。确认后加入手牌，其余的卡片放置入休息室。',
    actionStep: 'REVEAL_SELECTED',
  });
}

function startKarinLiveStartInspection(
  game: GameState,
  ability: PendingAbilityState,
  options: { readonly orderedResolution?: boolean } = {}
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  if (player.mainDeck.cardIds.length === 0) {
    const state = {
      ...game,
      pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
    };
    return continuePendingCardEffects(
      addAction(state, 'RESOLVE_ABILITY', player.id, {
        pendingAbilityId: ability.id,
        abilityId: ability.abilityId,
        sourceCardId: ability.sourceCardId,
        step: 'FINISH',
        inspectedCardIds: [],
        destination: null,
      }),
      options.orderedResolution === true
    );
  }

  const inspection = inspectTopCards(game, player.id, {
    count: 1,
    reveal: true,
  });
  if (!inspection) {
    return game;
  }
  const { gameState, inspectedCardIds } = inspection;

  const state = {
    ...gameState,
    pendingAbilities: gameState.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
    activeEffect: {
      id: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      controllerId: ability.controllerId,
      effectText: KARIN_EFFECT_TEXT,
      stepId: KARIN_REVEAL_STEP_ID,
      stepText: '卡组顶1张已公开。确认后费用9以下成员加入手牌；否则放入休息室。',
      awaitingPlayerId: player.id,
      inspectionCardIds: inspectedCardIds,
      metadata: {
        sourceZone: ZoneType.MAIN_DECK,
        orderedResolution: options.orderedResolution === true,
      },
    },
  };

  return addAction(state, 'RESOLVE_ABILITY', player.id, {
    pendingAbilityId: ability.id,
    abilityId: ability.abilityId,
    sourceCardId: ability.sourceCardId,
    step: 'START_INSPECTION',
    inspectedCardIds,
  });
}

function startStartDashLiveSuccessEffect(
  game: GameState,
  ability: PendingAbilityState,
  options: { readonly orderedResolution?: boolean } = {}
): GameState {
  return startArrangeInspectedDeckTopEffect(game, {
    ability,
    playerId: ability.controllerId,
    effectText: START_DASH_EFFECT_TEXT,
    inspectCount: 3,
    stepId: START_DASH_ARRANGE_STEP_ID,
    stepText: '请选择要留在卡组顶的卡牌。数字1会成为卡组最上方的卡，未选择的卡牌将放置入休息室。',
    selectionLabel: '按卡组顶从上到下的顺序选择卡牌',
    selectMin: 0,
    selectMax: 3,
    selectedDestination: 'MAIN_DECK_TOP',
    unselectedDestination: 'WAITING_ROOM',
    orderedResolution: options.orderedResolution === true,
  });
}

function startArrangeInspectedDeckTopEffect(
  game: GameState,
  config: ArrangeInspectedDeckTopConfig
): GameState {
  const player = getPlayerById(game, config.playerId);
  if (!player) {
    return game;
  }

  if (player.mainDeck.cardIds.length === 0) {
    const state = {
      ...game,
      pendingAbilities: game.pendingAbilities.filter(
        (candidate) => candidate.id !== config.ability.id
      ),
    };
    return continuePendingCardEffects(
      addAction(state, 'RESOLVE_ABILITY', player.id, {
        pendingAbilityId: config.ability.id,
        abilityId: config.ability.abilityId,
        sourceCardId: config.ability.sourceCardId,
        step: 'FINISH',
        inspectedCardIds: [],
      }),
      config.orderedResolution
    );
  }

  const inspection = inspectTopCards(game, player.id, {
    count: config.inspectCount,
  });
  if (!inspection) {
    return game;
  }
  const { gameState, inspectedCardIds } = inspection;

  const state: GameState = {
    ...gameState,
    pendingAbilities: gameState.pendingAbilities.filter(
      (candidate) => candidate.id !== config.ability.id
    ),
    activeEffect: {
      id: config.ability.id,
      abilityId: config.ability.abilityId,
      sourceCardId: config.ability.sourceCardId,
      controllerId: config.ability.controllerId,
      effectText: config.effectText,
      stepId: config.stepId,
      stepText: config.stepText,
      awaitingPlayerId: player.id,
      inspectionCardIds: inspectedCardIds,
      selectableCardIds: inspectedCardIds,
      selectableCardMode: 'ORDERED_MULTI',
      minSelectableCards: config.selectMin,
      maxSelectableCards: Math.min(config.selectMax, inspectedCardIds.length),
      selectionLabel: config.selectionLabel,
      confirmSelectionLabel: '按此顺序放回卡组顶',
      metadata: {
        sourceZone: ZoneType.MAIN_DECK,
        selectedDestination: config.selectedDestination,
        unselectedDestination: config.unselectedDestination,
        orderedResolution: config.orderedResolution,
      },
    },
  };

  return addAction(state, 'RESOLVE_ABILITY', player.id, {
    pendingAbilityId: config.ability.id,
    abilityId: config.ability.abilityId,
    sourceCardId: config.ability.sourceCardId,
    step: 'START_INSPECTION',
    inspectedCardIds,
  });
}

function finishArrangeInspectedDeckTopEffect(
  game: GameState,
  selectedCardIds: readonly string[]
): GameState {
  const effect = game.activeEffect;
  if (!effect) {
    return game;
  }
  const player = getPlayerById(game, effect.controllerId);
  if (!player) {
    return game;
  }

  const inspectedCardIds = effect.inspectionCardIds ?? [];
  const selectableCardIds = effect.selectableCardIds ?? [];
  const uniqueSelectedCardIds = [...new Set(selectedCardIds)];
  const selectedAreValid =
    uniqueSelectedCardIds.length === selectedCardIds.length &&
    uniqueSelectedCardIds.every(
      (cardId) => inspectedCardIds.includes(cardId) && selectableCardIds.includes(cardId)
    );
  const minCount = effect.minSelectableCards ?? 0;
  const maxCount = effect.maxSelectableCards ?? inspectedCardIds.length;
  if (
    !selectedAreValid ||
    uniqueSelectedCardIds.length < minCount ||
    uniqueSelectedCardIds.length > maxCount
  ) {
    return game;
  }

  const unselectedCardIds = inspectedCardIds.filter(
    (cardId) => !uniqueSelectedCardIds.includes(cardId)
  );
  let state = updatePlayer(game, player.id, (currentPlayer) => ({
    ...currentPlayer,
    mainDeck:
      effect.metadata?.selectedDestination === 'MAIN_DECK_TOP'
        ? {
            ...currentPlayer.mainDeck,
            cardIds: [...uniqueSelectedCardIds, ...currentPlayer.mainDeck.cardIds],
          }
        : currentPlayer.mainDeck,
    waitingRoom:
      effect.metadata?.unselectedDestination === 'WAITING_ROOM'
        ? {
            ...currentPlayer.waitingRoom,
            cardIds: [...currentPlayer.waitingRoom.cardIds, ...unselectedCardIds],
          }
        : currentPlayer.waitingRoom,
  }));

  state = clearInspectionCards({ ...state, activeEffect: null }, inspectedCardIds);
  return continuePendingCardEffects(
    addAction(state, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'FINISH',
      selectedCardIds: uniqueSelectedCardIds,
      waitingRoomCardIds: unselectedCardIds,
    }),
    isOrderedResolutionEffect(game)
  );
}

function startKekeOnEnterPlaceWaitingEnergy(
  game: GameState,
  ability: PendingAbilityState,
  options: { readonly orderedResolution?: boolean } = {}
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  const selectableCardIds = player.hand.cardIds.filter((cardId) => cardId !== ability.sourceCardId);
  return addAction(
    {
      ...game,
      pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
      activeEffect: createDiscardHandToWaitingRoomActivationEffect({
        ability,
        playerId: player.id,
        effectText: KEKE_EFFECT_TEXT,
        stepId: KEKE_SELECT_DISCARD_STEP_ID,
        selectableCardIds,
        orderedResolution: options.orderedResolution === true,
      }),
    },
    'RESOLVE_ABILITY',
    player.id,
    {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: 'START_SELECT_DISCARD',
      selectableCardIds,
    }
  );
}

function finishKekeOnEnterPlaceWaitingEnergy(game: GameState, discardCardId: string): GameState {
  const effect = game.activeEffect;
  if (!effect || !effect.selectableCardIds?.includes(discardCardId)) {
    return game;
  }

  const player = getPlayerById(game, effect.controllerId);
  if (!player || !player.hand.cardIds.includes(discardCardId)) {
    return game;
  }

  const stateAfterDiscard = moveHandCardToWaitingRoomForEffect(game, player.id, discardCardId);
  if (!stateAfterDiscard) {
    return game;
  }

  const energyPlacement = placeEnergyFromDeckToZone(
    stateAfterDiscard,
    player.id,
    1,
    OrientationState.WAITING
  );
  if (!energyPlacement) {
    return game;
  }

  const state = {
    ...energyPlacement.gameState,
    activeEffect: null,
  };

  return continuePendingCardEffects(
    addAction(state, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'PLACE_WAITING_ENERGY',
      discardCardId,
      placedEnergyCardIds: energyPlacement.placedEnergyCardIds,
    }),
    isOrderedResolutionEffect(game)
  );
}

function startShikiOnEnterLeftDrawDiscard(
  game: GameState,
  ability: PendingAbilityState,
  options: { readonly orderedResolution?: boolean } = {}
): GameState {
  return startDrawThenDiscardOneEffect(game, {
    ability,
    effectText: SHIKI_LEFT_DRAW_DISCARD_EFFECT_TEXT,
    drawCount: 2,
    stepId: SHIKI_LEFT_SELECT_DISCARD_STEP_ID,
    orderedResolution: options.orderedResolution === true,
  });
}

function startDrawThenDiscardOneEffect(
  game: GameState,
  config: DrawThenDiscardOneEffectConfig
): GameState {
  const player = getPlayerById(game, config.ability.controllerId);
  if (!player) {
    return game;
  }

  const drawResult = drawCardsFromMainDeckToHand(game, player.id, config.drawCount);
  if (!drawResult) {
    return game;
  }

  const playerAfterDraw = getPlayerById(drawResult.gameState, player.id);
  if (!playerAfterDraw) {
    return game;
  }

  const selectableCardIds = [...playerAfterDraw.hand.cardIds];
  return addAction(
    {
      ...drawResult.gameState,
      pendingAbilities: drawResult.gameState.pendingAbilities.filter(
        (candidate) => candidate.id !== config.ability.id
      ),
      activeEffect: {
        id: config.ability.id,
        abilityId: config.ability.abilityId,
        sourceCardId: config.ability.sourceCardId,
        controllerId: config.ability.controllerId,
        effectText: config.effectText,
        stepId: config.stepId,
        stepText:
          selectableCardIds.length > 0
            ? '请选择1张手牌放置入休息室。'
            : '没有可放置入休息室的手牌。确认后继续。',
        awaitingPlayerId: player.id,
        selectableCardIds,
        selectionLabel: '请选择要放置入休息室的手牌',
        canSkipSelection: selectableCardIds.length === 0,
        skipSelectionLabel: '确认',
        metadata: {
          orderedResolution: config.orderedResolution,
          sourceSlot: config.ability.sourceSlot,
          drawCount: config.drawCount,
          drawnCardIds: drawResult.drawnCardIds,
        },
      },
    },
    'RESOLVE_ABILITY',
    player.id,
    {
      pendingAbilityId: config.ability.id,
      abilityId: config.ability.abilityId,
      sourceCardId: config.ability.sourceCardId,
      step: 'DRAW_CARDS_START_DISCARD',
      sourceSlot: config.ability.sourceSlot,
      drawCount: config.drawCount,
      drawnCardIds: drawResult.drawnCardIds,
      selectableCardIds,
    }
  );
}

function finishDrawThenDiscardOneEffect(game: GameState, selectedCardId: string | null): GameState {
  const effect = game.activeEffect;
  if (!effect) {
    return game;
  }

  const player = getPlayerById(game, effect.controllerId);
  if (!player) {
    return game;
  }

  const selectableCardIds = effect.selectableCardIds ?? [];
  if (selectedCardId === null) {
    if (selectableCardIds.length > 0) {
      return game;
    }
    const state = { ...game, activeEffect: null };
    return continuePendingCardEffects(
      addAction(state, 'RESOLVE_ABILITY', player.id, {
        pendingAbilityId: effect.id,
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
        step: 'FINISH',
        sourceSlot: effect.metadata?.sourceSlot,
        drawnCardIds: effect.metadata?.drawnCardIds,
        discardedCardId: null,
      }),
      isOrderedResolutionEffect(game)
    );
  }

  if (
    !selectableCardIds.includes(selectedCardId) ||
    !player.hand.cardIds.includes(selectedCardId)
  ) {
    return game;
  }

  const stateAfterDiscard = moveHandCardToWaitingRoomForEffect(game, player.id, selectedCardId);
  if (!stateAfterDiscard) {
    return game;
  }

  const state = {
    ...stateAfterDiscard,
    activeEffect: null,
  };

  return continuePendingCardEffects(
    addAction(state, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'DISCARD_HAND_CARD',
      sourceSlot: effect.metadata?.sourceSlot,
      drawnCardIds: effect.metadata?.drawnCardIds,
      discardedCardId: selectedCardId,
    }),
    isOrderedResolutionEffect(game)
  );
}

function startShikiOnEnterRightActivateEnergy(
  game: GameState,
  ability: PendingAbilityState,
  options: { readonly orderedResolution?: boolean } = {}
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  const waitingEnergyCardIds = player.energyZone.cardIds.filter(
    (cardId) => player.energyZone.cardStates.get(cardId)?.orientation === OrientationState.WAITING
  );
  const maxActivateCount = Math.min(2, waitingEnergyCardIds.length);
  const stepText = `确认后将至多2张待机能量变为活跃状态。（当前可变为活跃：${maxActivateCount}张）`;

  return addAction(
    {
      ...game,
      pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
      activeEffect: {
        id: ability.id,
        abilityId: ability.abilityId,
        sourceCardId: ability.sourceCardId,
        controllerId: ability.controllerId,
        effectText: SHIKI_RIGHT_ENERGY_EFFECT_TEXT,
        stepId: SHIKI_RIGHT_ACTIVATE_ENERGY_STEP_ID,
        stepText,
        awaitingPlayerId: player.id,
        metadata: {
          orderedResolution: options.orderedResolution === true,
          sourceSlot: ability.sourceSlot,
          fromOrientation: OrientationState.WAITING,
          nextOrientation: OrientationState.ACTIVE,
          maxActivateCount,
        },
      },
    },
    'RESOLVE_ABILITY',
    player.id,
    {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: 'START_CONFIRM',
      sourceSlot: ability.sourceSlot,
      waitingEnergyCardIds,
      maxActivateCount,
    }
  );
}

function finishShikiOnEnterRightActivateEnergy(game: GameState): GameState {
  const effect = game.activeEffect;
  if (!effect) {
    return game;
  }

  const player = getPlayerById(game, effect.controllerId);
  if (!player) {
    return game;
  }

  const orientationChange = setFirstEnergyCardsOrientation(
    game,
    player.id,
    2,
    OrientationState.ACTIVE,
    { fromOrientation: OrientationState.WAITING }
  );
  if (!orientationChange) {
    return game;
  }

  const state = {
    ...orientationChange.gameState,
    activeEffect: null,
  };

  return continuePendingCardEffects(
    addAction(state, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'ACTIVATE_ENERGY',
      sourceSlot: effect.metadata?.sourceSlot,
      activatedEnergyCardIds: orientationChange.updatedEnergyCardIds,
      previousOrientations: orientationChange.previousOrientations,
      nextOrientation: orientationChange.nextOrientation,
    }),
    isOrderedResolutionEffect(game)
  );
}

function startChisatoLiveStartActivateAll(
  game: GameState,
  ability: PendingAbilityState,
  options: { readonly orderedResolution?: boolean } = {}
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  const liellaMemberCardIds = MEMBER_SLOT_ORDER.flatMap((slot) => {
    const cardId = player.memberSlots.slots[slot];
    if (!cardId) {
      return [];
    }
    const card = cardId ? getCardById(game, cardId) : null;
    return card && isMemberCardData(card.data) && isLiellaMemberData(card.data) ? [cardId] : [];
  });
  const energyCardIds = [...player.energyZone.cardIds];

  return addAction(
    {
      ...game,
      pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
      activeEffect: {
        id: ability.id,
        abilityId: ability.abilityId,
        sourceCardId: ability.sourceCardId,
        controllerId: ability.controllerId,
        effectText: CHISATO_LIVE_START_ACTIVATE_EFFECT_TEXT,
        stepId: CHISATO_LIVE_START_ACTIVATE_STEP_ID,
        stepText: `确认后将${liellaMemberCardIds.length}名Liella!成员和${energyCardIds.length}张能量变为活跃状态。`,
        awaitingPlayerId: player.id,
        metadata: {
          orderedResolution: options.orderedResolution === true,
          sourceSlot: ability.sourceSlot,
          liellaMemberCardIds,
          energyCardIds,
        },
      },
    },
    'RESOLVE_ABILITY',
    player.id,
    {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: 'START_CONFIRM',
      sourceSlot: ability.sourceSlot,
      liellaMemberCardIds,
      energyCardIds,
    }
  );
}

function finishChisatoLiveStartActivateAll(game: GameState): GameState {
  const effect = game.activeEffect;
  if (!effect) {
    return game;
  }

  const player = getPlayerById(game, effect.controllerId);
  if (!player) {
    return game;
  }

  const liellaMemberCardIds = MEMBER_SLOT_ORDER.flatMap((slot) => {
    const cardId = player.memberSlots.slots[slot];
    if (!cardId) {
      return [];
    }
    const card = cardId ? getCardById(game, cardId) : null;
    return card && isMemberCardData(card.data) && isLiellaMemberData(card.data) ? [cardId] : [];
  });
  const energyCardIds = [...player.energyZone.cardIds];

  const memberOrientationChange = setMembersOrientation(
    game,
    player.id,
    liellaMemberCardIds,
    OrientationState.ACTIVE
  );
  if (!memberOrientationChange) {
    return game;
  }

  const energyOrientationChange = setEnergyOrientation(
    memberOrientationChange.gameState,
    player.id,
    energyCardIds,
    OrientationState.ACTIVE
  );
  if (!energyOrientationChange) {
    return game;
  }

  const state = {
    ...energyOrientationChange.gameState,
    activeEffect: null,
  };

  return continuePendingCardEffects(
    addAction(state, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'ACTIVATE_MEMBERS_AND_ENERGY',
      sourceSlot: effect.metadata?.sourceSlot,
      activatedMemberCardIds: memberOrientationChange.updatedMemberCardIds,
      previousMemberOrientations: memberOrientationChange.previousOrientations,
      activatedEnergyCardIds: energyOrientationChange.updatedEnergyCardIds,
      previousEnergyOrientations: energyOrientationChange.previousOrientations,
      nextOrientation: OrientationState.ACTIVE,
    }),
    isOrderedResolutionEffect(game)
  );
}

function startEmmaOnEnterActivateMemberOrEnergy(
  game: GameState,
  ability: PendingAbilityState,
  options: { readonly orderedResolution?: boolean } = {}
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  const waitingMemberCardIds = getStageMemberCardIdsByOrientation(player, OrientationState.WAITING);
  const waitingEnergyCardIds = getEnergyCardIdsByOrientation(player, OrientationState.WAITING);
  const selectableOptions = [
    ...(waitingMemberCardIds.length > 0 ? [{ id: 'member', label: '选择1名成员' }] : []),
    ...(waitingEnergyCardIds.length > 0 ? [{ id: 'energy', label: '将能量变活跃' }] : []),
  ];

  return addAction(
    {
      ...game,
      pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
      activeEffect: {
        id: ability.id,
        abilityId: ability.abilityId,
        sourceCardId: ability.sourceCardId,
        controllerId: ability.controllerId,
        effectText: EMMA_ON_ENTER_ACTIVATE_MEMBER_OR_ENERGY_EFFECT_TEXT,
        stepId: EMMA_SELECT_TARGET_TYPE_STEP_ID,
        stepText:
          selectableOptions.length > 0
            ? '请选择要变为活跃状态的目标类型。'
            : '当前没有待机状态的舞台成员或能量。确认后继续。',
        awaitingPlayerId: player.id,
        selectableOptions,
        canSkipSelection: selectableOptions.length === 0,
        skipSelectionLabel: selectableOptions.length === 0 ? '确认' : undefined,
        metadata: {
          orderedResolution: options.orderedResolution === true,
          waitingMemberCardIds,
          waitingEnergyCardIds,
        },
      },
    },
    'RESOLVE_ABILITY',
    player.id,
    {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: 'START_SELECT_TARGET_TYPE',
      waitingMemberCardIds,
      waitingEnergyCardIds,
    }
  );
}

function startEmmaTargetSelection(game: GameState, selectedOptionId: string | null): GameState {
  const effect = game.activeEffect;
  if (!effect) {
    return game;
  }

  const player = getPlayerById(game, effect.controllerId);
  if (!player) {
    return game;
  }

  const waitingMemberCardIds = getStageMemberCardIdsByOrientation(player, OrientationState.WAITING);
  const waitingEnergyCardIds = getEnergyCardIdsByOrientation(player, OrientationState.WAITING);

  if (selectedOptionId === 'member' && waitingMemberCardIds.length > 0) {
    return addAction(
      {
        ...game,
        activeEffect: {
          ...effect,
          stepId: EMMA_SELECT_MEMBER_STEP_ID,
          stepText: '请选择1名要变为活跃状态的舞台成员。',
          selectableCardIds: waitingMemberCardIds,
          selectableCardMode: 'SINGLE',
          minSelectableCards: undefined,
          maxSelectableCards: undefined,
          selectableOptions: undefined,
          canSkipSelection: false,
          skipSelectionLabel: undefined,
          selectionLabel: '选择要变为活跃的成员',
          confirmSelectionLabel: '变为活跃',
          metadata: {
            ...effect.metadata,
            waitingMemberCardIds,
            waitingEnergyCardIds,
          },
        },
      },
      'RESOLVE_ABILITY',
      player.id,
      {
        pendingAbilityId: effect.id,
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
        step: 'SELECT_MEMBER_TARGET',
        waitingMemberCardIds,
      }
    );
  }

  if (selectedOptionId === 'energy' && waitingEnergyCardIds.length > 0) {
    return finishEmmaActivateEnergy(game, waitingEnergyCardIds.slice(0, 2));
  }

  if (waitingMemberCardIds.length > 0 || waitingEnergyCardIds.length > 0) {
    return game;
  }

  const state = { ...game, activeEffect: null };
  return continuePendingCardEffects(
    addAction(state, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'FINISH_NO_TARGETS',
    }),
    isOrderedResolutionEffect(game)
  );
}

function finishEmmaActivateMember(game: GameState, selectedCardId: string | null): GameState {
  const effect = game.activeEffect;
  if (!effect || selectedCardId === null) {
    return game;
  }

  const player = getPlayerById(game, effect.controllerId);
  if (
    !player ||
    effect.selectableCardIds?.includes(selectedCardId) !== true ||
    !getStageMemberCardIdsByOrientation(player, OrientationState.WAITING).includes(selectedCardId)
  ) {
    return game;
  }

  const orientationChange = setMembersOrientation(
    game,
    player.id,
    [selectedCardId],
    OrientationState.ACTIVE
  );
  if (!orientationChange) {
    return game;
  }

  const state = {
    ...orientationChange.gameState,
    activeEffect: null,
  };

  return continuePendingCardEffects(
    addAction(state, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'ACTIVATE_MEMBER',
      activatedMemberCardIds: orientationChange.updatedMemberCardIds,
      previousOrientations: orientationChange.previousOrientations,
      nextOrientation: orientationChange.nextOrientation,
    }),
    isOrderedResolutionEffect(game)
  );
}

function finishEmmaActivateEnergy(game: GameState, energyCardIds: readonly string[]): GameState {
  const effect = game.activeEffect;
  if (!effect) {
    return game;
  }

  const player = getPlayerById(game, effect.controllerId);
  const uniqueEnergyCardIds = [...new Set(energyCardIds)];
  if (!player || uniqueEnergyCardIds.length === 0 || uniqueEnergyCardIds.length > 2) {
    return game;
  }

  const waitingEnergyCardIds = getEnergyCardIdsByOrientation(player, OrientationState.WAITING);
  if (
    uniqueEnergyCardIds.length !== energyCardIds.length ||
    !uniqueEnergyCardIds.every((cardId) => waitingEnergyCardIds.includes(cardId))
  ) {
    return game;
  }

  const orientationChange = setEnergyOrientation(
    game,
    player.id,
    uniqueEnergyCardIds,
    OrientationState.ACTIVE
  );
  if (!orientationChange) {
    return game;
  }

  const state = {
    ...orientationChange.gameState,
    activeEffect: null,
  };

  return continuePendingCardEffects(
    addAction(state, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'ACTIVATE_ENERGY',
      activatedEnergyCardIds: orientationChange.updatedEnergyCardIds,
      previousOrientations: orientationChange.previousOrientations,
      nextOrientation: orientationChange.nextOrientation,
    }),
    isOrderedResolutionEffect(game)
  );
}

function startShikiLiveStartPositionChange(
  game: GameState,
  ability: PendingAbilityState,
  options: { readonly orderedResolution?: boolean } = {}
): GameState {
  return startMemberPositionChangeEffect(game, {
    ability,
    effectText: SHIKI_LIVE_START_POSITION_CHANGE_EFFECT_TEXT,
    stepId: SHIKI_LIVE_START_POSITION_CHANGE_STEP_ID,
    stepText: '请选择若菜四季要移动到的成员区。也可以选择不进行站位变换。',
    optional: true,
    orderedResolution: options.orderedResolution === true,
  });
}

function startMemberPositionChangeEffect(
  game: GameState,
  config: MemberPositionChangeEffectConfig
): GameState {
  const player = getPlayerById(game, config.ability.controllerId);
  if (!player) {
    return game;
  }

  const sourceSlot =
    config.ability.sourceSlot ?? findMemberSlot(player, config.ability.sourceCardId);
  if (!sourceSlot) {
    return continuePendingCardEffects(
      {
        ...game,
        pendingAbilities: game.pendingAbilities.filter(
          (candidate) => candidate.id !== config.ability.id
        ),
      },
      config.orderedResolution
    );
  }

  return addAction(
    {
      ...game,
      pendingAbilities: game.pendingAbilities.filter(
        (candidate) => candidate.id !== config.ability.id
      ),
      activeEffect: {
        id: config.ability.id,
        abilityId: config.ability.abilityId,
        sourceCardId: config.ability.sourceCardId,
        controllerId: config.ability.controllerId,
        effectText: config.effectText,
        stepId: config.stepId,
        stepText: config.stepText,
        awaitingPlayerId: player.id,
        selectableSlots: Object.values(SlotPosition).filter((slot) => slot !== sourceSlot),
        canSkipSelection: config.optional,
        skipSelectionLabel: config.optional ? '不发动' : undefined,
        metadata: {
          orderedResolution: config.orderedResolution,
          sourceSlot,
          optional: config.optional,
        },
      },
    },
    'RESOLVE_ABILITY',
    player.id,
    {
      pendingAbilityId: config.ability.id,
      abilityId: config.ability.abilityId,
      sourceCardId: config.ability.sourceCardId,
      step: 'START_POSITION_CHANGE',
      sourceSlot,
      optional: config.optional,
    }
  );
}

function finishMemberPositionChangeEffect(
  game: GameState,
  selectedSlot: SlotPosition | null
): GameState {
  const effect = game.activeEffect;
  if (!effect) {
    return game;
  }

  const player = getPlayerById(game, effect.controllerId);
  if (!player) {
    return game;
  }

  const orderedResolution = isOrderedResolutionEffect(game);
  if (!selectedSlot) {
    if (effect.canSkipSelection !== true) {
      return game;
    }

    const state = {
      ...game,
      activeEffect: null,
    };

    return continuePendingCardEffects(
      addAction(state, 'RESOLVE_ABILITY', player.id, {
        pendingAbilityId: effect.id,
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
        step: 'POSITION_CHANGE_SKIPPED',
        sourceSlot: effect.metadata?.sourceSlot,
      }),
      orderedResolution
    );
  }

  if (!effect.selectableSlots?.includes(selectedSlot)) {
    return game;
  }

  const sourceSlot = findMemberSlot(player, effect.sourceCardId);
  if (!sourceSlot || sourceSlot === selectedSlot) {
    return game;
  }

  const moveResult = moveMemberBetweenSlots(game, player.id, effect.sourceCardId, selectedSlot);
  if (!moveResult) {
    return game;
  }

  const state = {
    ...moveResult.gameState,
    activeEffect: null,
  };

  return continuePendingCardEffects(
    addAction(state, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'POSITION_CHANGE',
      fromSlot: moveResult.fromSlot,
      toSlot: moveResult.toSlot,
      swappedCardId: moveResult.swappedCardId,
    }),
    orderedResolution
  );
}

function finishNozomiOnEnter(game: GameState): GameState {
  const effect = game.activeEffect;
  if (!effect) {
    return game;
  }

  const player = getPlayerById(game, effect.controllerId);
  if (!player) {
    return game;
  }

  const inspectedCardIds = effect.inspectionCardIds ?? [];
  const hasMilledLiveCard = inspectedCardIds.some(
    (cardId) => getCardById(game, cardId)?.data.cardType === CardType.LIVE
  );
  let drawnCardId: string | null = null;

  const moveResult = moveInspectedCardsToWaitingRoom(game, player.id, inspectedCardIds);
  if (!moveResult) {
    return game;
  }
  let state = moveResult.gameState;

  if (hasMilledLiveCard) {
    const drawResult = drawCardsFromMainDeckToHand(state, player.id, 1);
    if (!drawResult) {
      return game;
    }
    state = drawResult.gameState;
    drawnCardId = drawResult.drawnCardIds[0] ?? null;
  }

  state = {
    ...state,
    inspectionContext: state.inspectionZone.cardIds.length > 0 ? state.inspectionContext : null,
    activeEffect: null,
  };

  return continuePendingCardEffects(
    addAction(state, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'FINISH',
      milledCardIds: moveResult.movedCardIds,
      hasMilledLiveCard,
      drawnCardId,
    }),
    isOrderedResolutionEffect(game)
  );
}

function revealUmiSelectedLive(game: GameState, selectedCardId: string): GameState {
  return revealSelectedInspectionCard(game, selectedCardId, {
    stepId: UMI_REVEAL_STEP_ID,
    stepText: UMI_EFFECT_TEXT,
    actionStep: 'REVEAL_SELECTED',
  });
}

function finishUmiOnEnter(game: GameState, selectedCardId: string | null): GameState {
  const effect = game.activeEffect;
  if (!effect) {
    return game;
  }

  const player = getPlayerById(game, effect.controllerId);
  if (!player) {
    return game;
  }

  const inspectedCardIds = effect.inspectionCardIds ?? [];
  const selectedIsValid =
    selectedCardId !== null &&
    inspectedCardIds.includes(selectedCardId) &&
    isMuseLiveCardData(getCardById(game, selectedCardId)?.data);
  const cardToHandId = selectedIsValid ? selectedCardId : null;
  const moveResult = moveInspectedSelectionToHandRestToWaitingRoom(
    game,
    player.id,
    inspectedCardIds,
    cardToHandId
  );
  if (!moveResult) {
    return game;
  }

  const state = { ...moveResult.gameState, activeEffect: null };

  return continuePendingCardEffects(
    addAction(state, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'FINISH',
      inspectedCardIds,
      selectedCardId: moveResult.selectedCardId,
      waitingRoomCardIds: moveResult.waitingRoomCardIds,
    }),
    isOrderedResolutionEffect(game)
  );
}

function finishKarinLiveStart(game: GameState): GameState {
  const effect = game.activeEffect;
  if (!effect) {
    return game;
  }

  const player = getPlayerById(game, effect.controllerId);
  if (!player) {
    return game;
  }

  const inspectedCardIds = effect.inspectionCardIds ?? [];
  const revealedCardId = inspectedCardIds[0] ?? null;
  const revealedCard = revealedCardId ? getCardById(game, revealedCardId) : null;
  const shouldAddToHand =
    revealedCard !== null && isMemberCardData(revealedCard.data) && revealedCard.data.cost <= 9;
  const destination = shouldAddToHand ? ZoneType.HAND : ZoneType.WAITING_ROOM;
  const orderedResolution = isOrderedResolutionEffect(game);

  let state = updatePlayer(game, player.id, (currentPlayer) => ({
    ...currentPlayer,
    hand:
      shouldAddToHand && revealedCardId
        ? addCardToZone(currentPlayer.hand, revealedCardId)
        : currentPlayer.hand,
    waitingRoom:
      !shouldAddToHand && revealedCardId
        ? addCardToZone(currentPlayer.waitingRoom, revealedCardId)
        : currentPlayer.waitingRoom,
  }));

  state = {
    ...state,
    inspectionZone: {
      ...state.inspectionZone,
      cardIds: state.inspectionZone.cardIds.filter((cardId) => !inspectedCardIds.includes(cardId)),
      revealedCardIds: state.inspectionZone.revealedCardIds.filter(
        (cardId) => !inspectedCardIds.includes(cardId)
      ),
    },
    inspectionContext: null,
    activeEffect: null,
  };

  state = addAction(state, 'RESOLVE_ABILITY', player.id, {
    pendingAbilityId: effect.id,
    abilityId: effect.abilityId,
    sourceCardId: effect.sourceCardId,
    step: 'REVEAL_FINISH',
    inspectedCardIds,
    revealedCardId,
    destination,
  });

  if (!shouldAddToHand) {
    return continuePendingCardEffects(state, orderedResolution);
  }

  const sourceSlot = findMemberSlot(player, effect.sourceCardId);
  if (!sourceSlot) {
    return continuePendingCardEffects(state, orderedResolution);
  }

  return {
    ...state,
    activeEffect: {
      id: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      controllerId: effect.controllerId,
      effectText: KARIN_EFFECT_TEXT,
      stepId: KARIN_POSITION_CHANGE_STEP_ID,
      stepText: '公开的卡片已加入手牌。请选择朝香果林要移动到的成员区。',
      awaitingPlayerId: player.id,
      selectableSlots: Object.values(SlotPosition).filter((slot) => slot !== sourceSlot),
      metadata: {
        orderedResolution,
        sourceSlot,
      },
    },
  };
}

function finishKarinPositionChange(game: GameState, selectedSlot: SlotPosition | null): GameState {
  const effect = game.activeEffect;
  if (!effect || !selectedSlot) {
    return game;
  }

  const player = getPlayerById(game, effect.controllerId);
  if (!player) {
    return game;
  }

  const sourceSlot = findMemberSlot(player, effect.sourceCardId);
  if (!sourceSlot || sourceSlot === selectedSlot) {
    return game;
  }

  const moveResult = moveMemberBetweenSlots(game, player.id, effect.sourceCardId, selectedSlot);
  if (!moveResult) {
    return game;
  }

  const orderedResolution = isOrderedResolutionEffect(game);
  const state = {
    ...moveResult.gameState,
    activeEffect: null,
  };

  return continuePendingCardEffects(
    addAction(state, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'POSITION_CHANGE',
      fromSlot: moveResult.fromSlot,
      toSlot: moveResult.toSlot,
      swappedCardId: moveResult.swappedCardId,
    }),
    orderedResolution
  );
}

function startKotoriLiveStartEffect(
  game: GameState,
  ability: PendingAbilityState,
  options: { readonly orderedResolution?: boolean } = {}
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }
  const selectableCardIds = player.hand.cardIds;
  return addAction(
    {
      ...game,
      pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
      activeEffect: createDiscardHandToWaitingRoomActivationEffect({
        ability,
        playerId: player.id,
        effectText: KOTORI_LIVE_START_EFFECT_TEXT,
        stepId: KOTORI_LIVE_START_SELECT_DISCARD_STEP_ID,
        selectableCardIds,
        orderedResolution: options.orderedResolution === true,
      }),
    },
    'RESOLVE_ABILITY',
    player.id,
    {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: 'START_SELECT_DISCARD',
      selectableCardIds,
    }
  );
}

function startKotoriLiveStartHeartChoice(game: GameState, discardCardId: string): GameState {
  const effect = game.activeEffect;
  if (!effect || !effect.selectableCardIds?.includes(discardCardId)) {
    return game;
  }
  const player = getPlayerById(game, effect.controllerId);
  if (!player || !player.hand.cardIds.includes(discardCardId)) {
    return game;
  }
  const state = moveHandCardToWaitingRoomForEffect(game, player.id, discardCardId);
  if (!state) {
    return game;
  }
  return addAction(
    {
      ...state,
      activeEffect: {
        ...effect,
        stepId: KOTORI_LIVE_START_SELECT_HEART_STEP_ID,
        stepText: '请选择本次 Live 结束前获得的 Heart。',
        selectableCardIds: [],
        selectableOptions: [
          { id: HeartColor.PINK, label: '粉心' },
          { id: HeartColor.YELLOW, label: '黄心' },
          { id: HeartColor.PURPLE, label: '紫心' },
        ],
        canSkipSelection: false,
        metadata: {
          ...effect.metadata,
          discardCardId,
        },
      },
    },
    'RESOLVE_ABILITY',
    player.id,
    {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'DISCARD_HAND_CARD',
      discardCardId,
    }
  );
}

function finishKotoriLiveStartHeartBonus(
  game: GameState,
  selectedOptionId: string | null
): GameState {
  const effect = game.activeEffect;
  if (!effect) {
    return game;
  }
  const player = getPlayerById(game, effect.controllerId);
  const selectedColor = [HeartColor.PINK, HeartColor.YELLOW, HeartColor.PURPLE].includes(
    selectedOptionId as HeartColor
  )
    ? (selectedOptionId as HeartColor)
    : null;
  if (!player || selectedColor === null) {
    return game;
  }
  const heartBonus = { color: selectedColor, count: 1 };
  const state = addLiveModifier(
    {
      ...game,
      activeEffect: null,
    },
    {
      kind: 'HEART',
      playerId: player.id,
      hearts: [heartBonus],
      sourceCardId: effect.sourceCardId,
      abilityId: effect.abilityId,
    }
  );
  return continuePendingCardEffects(
    addAction(state, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'APPLY_HEART_BONUS',
      heartColor: selectedColor,
    }),
    isOrderedResolutionEffect(game)
  );
}

function startEliActivatedEffect(game: GameState, playerId: string, cardId: string): GameState {
  return startSacrificeSelfActivatedEffect(game, playerId, cardId, {
    abilityId: ELI_ACTIVATED_ABILITY_ID,
    expectedCardCode: 'PL!-sd1-002-SD',
    effectText: ELI_EFFECT_TEXT,
    stepId: ELI_SELECT_WAITING_ROOM_MEMBER_STEP_ID,
    selectablePredicate: typeIs(CardType.MEMBER),
  });
}

function startRinActivatedEffect(game: GameState, playerId: string, cardId: string): GameState {
  const state = startSacrificeSelfActivatedEffect(game, playerId, cardId, {
    abilityId: RIN_ACTIVATED_ABILITY_ID,
    expectedCardCode: 'PL!-sd1-005-SD',
    effectText: RIN_EFFECT_TEXT,
    stepId: RIN_SELECT_WAITING_ROOM_LIVE_STEP_ID,
    selectablePredicate: typeIs(CardType.LIVE),
  });
  return state;
}

function startPb1ActivatedEffect(game: GameState, playerId: string, cardId: string): GameState {
  return startSacrificeSelfActivatedEffect(game, playerId, cardId, {
    abilityId: PB1_019_ACTIVATED_ABILITY_ID,
    expectedCardCode: 'PL!-pb1-019-N',
    effectText: PB1_019_EFFECT_TEXT,
    stepId: PB1_019_SELECT_WAITING_ROOM_MEMBER_STEP_ID,
    selectablePredicate: typeIs(CardType.MEMBER),
  });
}

function startBp4ActivatedEffect(game: GameState, playerId: string, cardId: string): GameState {
  return startSacrificeSelfActivatedEffect(game, playerId, cardId, {
    abilityId: BP4_003_ACTIVATED_ABILITY_ID,
    expectedCardCode: 'PL!-bp4-003-P',
    effectText: BP4_003_EFFECT_TEXT,
    stepId: BP4_003_SELECT_WAITING_ROOM_LIVE_STEP_ID,
    selectablePredicate: typeIs(CardType.LIVE),
  });
}

function startSacrificeSelfActivatedEffect(
  game: GameState,
  playerId: string,
  cardId: string,
  config: {
    readonly abilityId: string;
    readonly expectedCardCode: string;
    readonly effectText: string;
    readonly stepId: string;
    readonly selectablePredicate: (card: NonNullable<ReturnType<typeof getCardById>>) => boolean;
  }
): GameState {
  if (game.activeEffect || game.currentPhase !== GamePhase.MAIN_PHASE) {
    return game;
  }
  const activePlayerId = game.players[game.activePlayerIndex]?.id ?? null;
  if (activePlayerId !== playerId) {
    return game;
  }
  const player = getPlayerById(game, playerId);
  const sourceCard = getCardById(game, cardId);
  if (
    !player ||
    !sourceCard ||
    sourceCard.ownerId !== playerId ||
    sourceCard.data.cardCode !== config.expectedCardCode ||
    !isMemberCardData(sourceCard.data)
  ) {
    return game;
  }
  const sourceSlot = findMemberSlot(player, cardId);
  if (!sourceSlot) {
    return game;
  }
  let state = recordAbilityUse(game, player.id, config.abilityId, cardId);
  const costPayment = payImmediateEffectCosts(state, player.id, cardId, [
    { kind: 'SEND_SOURCE_MEMBER_TO_WAITING_ROOM' },
  ]);
  if (!costPayment) {
    return game;
  }
  state = costPayment.gameState;
  const movedToWaitingRoomCardIds = costPayment.movedToWaitingRoomCardIds;
  if (costPayment.sourceSlot && movedToWaitingRoomCardIds.includes(cardId)) {
    state = enqueueTriggeredCardEffects(state, [TriggerCondition.ON_LEAVE_STAGE], {
      onLeaveStageSources: [
        {
          cardId,
          controllerId: player.id,
          sourceSlot: costPayment.sourceSlot,
          eventId: `effect-cost:${state.actionSequence}:${cardId}:leave-stage`,
        },
      ],
    });
  }
  const zoneSelection = createWaitingRoomToHandSelectionConfig();
  const selectableCardIds = selectWaitingRoomCardIds(state, player.id, config.selectablePredicate);
  state = {
    ...state,
    activeEffect: createWaitingRoomToHandEffectState({
      id: `${config.abilityId}:${cardId}:turn-${state.turnCount}:action-${state.actionHistory.length}`,
      abilityId: config.abilityId,
      sourceCardId: cardId,
      controllerId: player.id,
      effectText: config.effectText,
      stepId: config.stepId,
      awaitingPlayerId: player.id,
      selectableCardIds,
      metadata: {
        sourceSlot,
        movedToWaitingRoomCardIds,
      },
      zoneSelection,
    }),
  };
  return addAction(state, 'RESOLVE_ABILITY', player.id, {
    abilityId: config.abilityId,
    sourceCardId: cardId,
    step: 'PAY_COST',
    fromSlot: sourceSlot,
    movedToWaitingRoomCardIds,
    selectableCardIds,
  });
}

function startHanayoActivatedEffect(game: GameState, playerId: string, cardId: string): GameState {
  if (game.activeEffect || game.currentPhase !== GamePhase.MAIN_PHASE) {
    return game;
  }
  const activePlayerId = game.players[game.activePlayerIndex]?.id ?? null;
  const player = getPlayerById(game, playerId);
  const sourceCard = getCardById(game, cardId);
  if (
    activePlayerId !== playerId ||
    !player ||
    !sourceCard ||
    sourceCard.ownerId !== playerId ||
    sourceCard.data.cardCode !== 'PL!-sd1-008-SD'
  ) {
    return game;
  }
  let state = recordAbilityUse(game, player.id, HANAYO_ACTIVATED_ABILITY_ID, cardId);
  const costPayment = payImmediateEffectCosts(state, player.id, cardId, [
    { kind: 'TAP_ACTIVE_ENERGY', count: 2 },
  ]);
  if (!costPayment) {
    return game;
  }
  const moveResult = moveTopDeckCardsToWaitingRoom(costPayment.gameState, player.id, 10);
  if (!moveResult) {
    return game;
  }
  state = moveResult.gameState;
  state = addAction(state, 'PAY_COST', player.id, {
    abilityId: HANAYO_ACTIVATED_ABILITY_ID,
    sourceCardId: cardId,
    energyCardIds: costPayment.paidEnergyCardIds,
  });
  return addAction(state, 'RESOLVE_ABILITY', player.id, {
    abilityId: HANAYO_ACTIVATED_ABILITY_ID,
    sourceCardId: cardId,
    effectText: HANAYO_EFFECT_TEXT,
    step: 'MILL_TOP_TEN',
    milledCardIds: moveResult.movedCardIds,
  });
}

function finishSkipEffect(game: GameState): GameState {
  const effect = game.activeEffect;
  if (!effect) {
    return game;
  }
  const player = getPlayerById(game, effect.controllerId);
  if (!player) {
    return game;
  }
  const state = { ...game, activeEffect: null };
  return continuePendingCardEffects(
    addAction(state, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'SKIP',
    }),
    isOrderedResolutionEffect(game)
  );
}

function getActiveEnergyCardIds(player: NonNullable<ReturnType<typeof getPlayerById>>): string[] {
  return player.energyZone.cardIds.filter(
    (cardId) => player.energyZone.cardStates.get(cardId)?.orientation !== OrientationState.WAITING
  );
}

function getEmptyMemberSlots(
  player: NonNullable<ReturnType<typeof getPlayerById>>
): SlotPosition[] {
  return MEMBER_SLOT_ORDER.filter((slot) => player.memberSlots.slots[slot] === null);
}

function getStageMemberCardIdsByOrientation(
  player: NonNullable<ReturnType<typeof getPlayerById>>,
  orientation: OrientationState
): string[] {
  return MEMBER_SLOT_ORDER.flatMap((slot) => {
    const cardId = player.memberSlots.slots[slot];
    if (!cardId) {
      return [];
    }
    const cardState = player.memberSlots.cardStates.get(cardId);
    return cardState?.orientation === orientation ? [cardId] : [];
  });
}

function getEnergyCardIdsByOrientation(
  player: NonNullable<ReturnType<typeof getPlayerById>>,
  orientation: OrientationState
): string[] {
  return player.energyZone.cardIds.filter(
    (cardId) => player.energyZone.cardStates.get(cardId)?.orientation === orientation
  );
}

function getYoshikoWaitingRoomCandidateCardIds(game: GameState, playerId: string): string[] {
  const player = getPlayerById(game, playerId);
  if (!player) {
    return [];
  }

  return player.waitingRoom.cardIds.filter((cardId) => {
    const card = getCardById(game, cardId);
    return card !== null && isMemberCardData(card.data) && card.data.cost <= 4;
  });
}

function calculateMemberCostSum(game: GameState, cardIds: readonly string[]): number {
  return cardIds.reduce((sum, cardId) => {
    const card = getCardById(game, cardId);
    return sum + (card && isMemberCardData(card.data) ? card.data.cost : Number.POSITIVE_INFINITY);
  }, 0);
}

function isLiellaMemberData(memberData: {
  readonly cardCode: string;
  readonly groupName?: string;
  readonly cardText?: string;
}): boolean {
  return (
    memberData.cardCode.startsWith('PL!SP-') ||
    includesLiella(memberData.groupName) ||
    includesLiella(memberData.cardText)
  );
}

function includesLiella(value: string | undefined): boolean {
  const normalized = value?.toLowerCase() ?? '';
  return (
    normalized.includes('liella') ||
    normalized.includes('リエラ') ||
    normalized.includes('スーパースター') ||
    normalized.includes('superstar')
  );
}

function getDiscardLookTopCount(cardCode: string | undefined): number {
  if (cardCode === 'PL!-sd1-015-SD') {
    return 5;
  }
  if (cardCode === 'PL!-bp3-010-N') {
    return 5;
  }
  return 3;
}

function getDiscardLookTopSelectableCardType(
  cardCode: string | undefined
): 'MEMBER' | 'LIVE' | null {
  if (cardCode === 'PL!-sd1-015-SD') {
    return 'MEMBER';
  }
  if (cardCode === 'PL!-bp3-010-N') {
    return 'LIVE';
  }
  return null;
}

function isDiscardLookTopSelectionRequired(cardCode: string | undefined): boolean {
  return (
    cardCode === 'PL!-sd1-011-SD' ||
    cardCode === 'PL!-sd1-012-SD' ||
    cardCode === 'PL!-sd1-016-SD' ||
    cardCode === 'PL!HS-PR-001-PR'
  );
}

function getDiscardLookTopEffectText(cardCode: string | undefined): string {
  switch (cardCode) {
    case 'PL!-sd1-011-SD':
    case 'PL!-sd1-012-SD':
    case 'PL!-sd1-016-SD':
      return '【登场】可以将1张手牌放置入休息室：检视自己卡组顶的3张卡。将1张其中的卡片加入手牌，其余的卡片放置入休息室。';
    case 'PL!-sd1-015-SD':
      return '【登场】可以将1张手牌放置入休息室：检视自己卡组顶的5张卡。可以将1张其中的成员卡公开并加入手牌。其余的卡片放置入休息室。';
    case 'PL!HS-PR-001-PR':
      return '【登场】可以将1张手牌放置入休息室：检视自己卡组顶的3张卡，将1张加入手牌，其余放置入休息室。';
    case 'PL!-bp3-010-N':
      return BP3_010_ON_ENTER_EFFECT_TEXT;
    default:
      return GENERIC_DISCARD_LOOK_TOP_EFFECT_TEXT;
  }
}

function findMemberSlot(
  player: { memberSlots: { slots: Readonly<Record<SlotPosition, string | null>> } },
  cardId: string
): SlotPosition | null {
  for (const slot of Object.values(SlotPosition)) {
    if (player.memberSlots.slots[slot] === cardId) {
      return slot;
    }
  }
  return null;
}
