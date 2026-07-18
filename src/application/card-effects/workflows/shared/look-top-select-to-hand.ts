import { isMemberCardData, type CardInstance } from '../../../../domain/entities/card.js';
import {
  addAction,
  getCardById,
  getPlayerById,
  type GameState,
} from '../../../../domain/entities/game.js';
import { findMemberSlot } from '../../../../domain/entities/player.js';
import { sumSuccessfulLiveScore } from '../../../../domain/rules/success-live-score.js';
import {
  CardType,
  HeartColor,
  OrientationState,
  ZoneType,
} from '../../../../shared/types/enums.js';
import {
  BP6_002_ON_ENTER_LOOK_NO_ABILITY_OR_CONTINUOUS_MUSE_CARD_ABILITY_ID,
  HS_BP2_012_LEAVE_STAGE_LOOK_TOP_MEMBER_ABILITY_ID,
  HS_BP2_013_LEAVE_STAGE_LOOK_TOP_LIVE_ABILITY_ID,
  PL_S_BP5_007_LIVE_SUCCESS_LOOK_TOP_GREEN_HEART_MEMBER_ABILITY_ID,
  PL_BP4_006_ON_ENTER_SUCCESS_SCORE_THREE_LOOK_TOP_FIVE_MUSE_MEMBER_ABILITY_ID,
  PL_N_PB1_016_ON_ENTER_LOOK_TOP_TWO_KARIN_MEMBER_ABILITY_ID,
  PL_N_PB1_018_ON_ENTER_LOOK_TOP_TWO_KANATA_MEMBER_ABILITY_ID,
  PL_N_PB1_021_ON_ENTER_LOOK_TOP_TWO_RINA_MEMBER_ABILITY_ID,
  PL_N_PB1_024_ON_ENTER_LOOK_TOP_TWO_LANZHU_MEMBER_ABILITY_ID,
  N_SD1_001_ON_ENTER_LOOK_TOP_NIJIGASAKI_LIVE_ABILITY_ID,
  S_BP6_005_ON_ENTER_LOOK_TOP_THREE_COLOR_MEMBER_ABILITY_ID,
  S_SD1_003_ON_ENTER_LOOK_TOP_AQOURS_LIVE_ABILITY_ID,
  SP_BP4_002_ON_ENTER_WAIT_LOOK_TOP_HIGH_REQUIREMENT_LIELLA_LIVE_ABILITY_ID,
  SP_BP2_002_ON_ENTER_LOOK_HIGH_COST_CARD_ABILITY_ID,
  UMI_ON_ENTER_ABILITY_ID,
} from '../../ability-ids.js';
import {
  finishSkippedActiveEffect,
  startPendingActiveEffect,
} from '../../runtime/active-effect.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText, recordPayCostAction } from '../../runtime/workflow-helpers.js';
import type { EnqueueTriggeredCardEffectsForEnterWaitingRoom } from '../../runtime/enter-waiting-room-triggers.js';
import {
  enqueueMemberStateChangedTriggersFromOrientationResult,
  type EnqueueTriggeredCardEffectsForMemberStateChanged,
} from '../../runtime/member-state-changed-triggers.js';
import { moveInspectedCardsToHandRestToWaitingRoomAndEnqueueTriggers } from '../../runtime/inspection-waiting-room-triggers.js';
import {
  and,
  cardNameAliasIs,
  costGte,
  groupAliasIs,
  groupIs,
  hasNoAbilityOrContinuousAbility,
  liveTotalRequiredHeartGte,
  memberHasPrintedHeartColorAtLeast,
  memberHasHeartColor,
  typeIs,
} from '../../../effects/card-selectors.js';
import { inspectTopCards } from '../../../effects/look-top.js';
import { setMemberOrientation } from '../../../effects/member-state.js';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;
export type LookTopSelectSelectionValidator = (
  game: GameState,
  selectedCardIds: readonly string[]
) => boolean;

export type LookTopSelectCountRule =
  | {
      readonly exactCount: number;
      readonly minCount?: never;
      readonly maxCount?: never;
    }
  | {
      readonly exactCount?: never;
      readonly minCount: number;
      readonly maxCount: number;
    };

export interface LookTopSelectToHandPublicSummaryContext {
  readonly effectKind: 'DISCARD_LOOK_TOP_SELECT_TO_HAND';
  readonly sourceActionLabel?: '登场' | '离场' | '起动' | 'LIVE成功';
  readonly discardedCostCardIds?: readonly string[];
  readonly inspectSourceZone?: ZoneType;
  readonly requestedInspectCount?: number;
  readonly sourceOrientationCost?: 'WAITING';
}

export interface LookTopSelectToHandWorkflowConfig {
  readonly effectText: string;
  readonly topCount: number;
  readonly selector: (card: CardInstance) => boolean;
  readonly countRule: LookTopSelectCountRule;
  readonly revealSelectedBeforeHand: boolean;
  readonly selectStepId: string;
  readonly revealStepId?: string;
  readonly selectStepText: string;
  readonly noTargetStepText: string;
  readonly revealStepText?: string;
  readonly selectionLabel?: string;
  readonly confirmSelectionLabel?: string;
  readonly skipSelectionLabel?: string;
  readonly startActionStep?: string;
  readonly startActionPayload?: Readonly<Record<string, unknown>>;
  readonly revealActionStep?: string;
  readonly finishActionStep?: string;
  readonly noCardsMode?: 'finish' | 'open-selection';
  readonly selectionRequiredWhenHasTargets?: boolean;
  readonly includeInspectedCardIdsInFinishAction?: boolean;
  readonly clampExactCountToInspectedCount?: boolean;
  readonly optionalSourceOrientationCost?: 'WAITING';
  readonly optionStepId?: string;
  readonly publicEffectSummaryContext?: LookTopSelectToHandPublicSummaryContext;
  readonly minSuccessfulLiveScore?: number;
}

export interface LookTopSelectToHandWorkflowOptions {
  readonly orderedResolution?: boolean;
  readonly continuePendingCardEffects: ContinuePendingCardEffects;
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom;
}

export interface LookTopSelectToHandAbilityContext {
  readonly id: string;
  readonly abilityId: string;
  readonly sourceCardId: string;
  readonly controllerId: string;
}

interface LookTopSelectToHandMetadata {
  readonly sourceZone?: ZoneType;
  readonly orderedResolution: boolean;
  readonly revealSelectedBeforeHand: boolean;
  readonly revealStepId?: string;
  readonly revealStepText?: string;
  readonly revealActionStep?: string;
  readonly finishActionStep: string;
  readonly countRule: LookTopSelectCountRule;
  readonly candidateCardIds: readonly string[];
  readonly includeInspectedCardIdsInFinishAction?: boolean;
  readonly selectedCardIds?: readonly string[];
  readonly publicEffectSummaryContext?: LookTopSelectToHandPublicSummaryContext;
}

interface RegisteredLookTopSelectToHandWorkflowConfig extends Omit<
  LookTopSelectToHandWorkflowConfig,
  'effectText'
> {
  readonly abilityId: string;
}

const UMI_SELECT_STEP_ID = 'UMI_SELECT_MUSE_LIVE';
const UMI_REVEAL_STEP_ID = 'UMI_REVEAL_SELECTED_LIVE';
const SP_BP2_002_SELECT_HIGH_COST_CARD_STEP_ID = 'SP_BP2_002_SELECT_HIGH_COST_CARD';
const SP_BP2_002_REVEAL_SELECTED_STEP_ID = 'SP_BP2_002_REVEAL_SELECTED_HIGH_COST_CARD';
const BP6_002_SELECT_NO_ABILITY_OR_CONTINUOUS_MUSE_CARD_STEP_ID =
  'BP6_002_SELECT_NO_ABILITY_OR_CONTINUOUS_MUSE_CARD';
const BP6_002_REVEAL_SELECTED_STEP_ID =
  'BP6_002_REVEAL_SELECTED_NO_ABILITY_OR_CONTINUOUS_MUSE_CARD';
const HS_BP2_012_SELECT_MEMBER_STEP_ID = 'HS_BP2_012_SELECT_MEMBER_FROM_TOP_FIVE';
const HS_BP2_012_REVEAL_SELECTED_STEP_ID = 'HS_BP2_012_REVEAL_SELECTED_MEMBER';
const HS_BP2_013_SELECT_LIVE_STEP_ID = 'HS_BP2_013_SELECT_LIVE_FROM_TOP_FIVE';
const HS_BP2_013_REVEAL_SELECTED_STEP_ID = 'HS_BP2_013_REVEAL_SELECTED_LIVE';
const S_BP6_005_SELECT_THREE_COLOR_MEMBER_STEP_ID =
  'S_BP6_005_SELECT_THREE_COLOR_MEMBER_FROM_TOP_TWO';
const S_BP6_005_REVEAL_THREE_COLOR_MEMBER_STEP_ID = 'S_BP6_005_REVEAL_SELECTED_THREE_COLOR_MEMBER';
const S_SD1_003_SELECT_AQOURS_LIVE_STEP_ID = 'S_SD1_003_SELECT_AQOURS_LIVE_FROM_TOP_FIVE';
const S_SD1_003_REVEAL_AQOURS_LIVE_STEP_ID = 'S_SD1_003_REVEAL_SELECTED_AQOURS_LIVE';
const PL_S_BP5_007_SELECT_GREEN_HEART_MEMBER_STEP_ID =
  'PL_S_BP5_007_SELECT_GREEN_HEART_MEMBER_FROM_TOP_FOUR';
const PL_S_BP5_007_REVEAL_GREEN_HEART_MEMBER_STEP_ID =
  'PL_S_BP5_007_REVEAL_SELECTED_GREEN_HEART_MEMBER';
const PL_BP4_006_SELECT_MUSE_MEMBER_STEP_ID =
  'PL_BP4_006_SELECT_MUSE_MEMBER_FROM_TOP_FIVE';
const PL_BP4_006_REVEAL_MUSE_MEMBER_STEP_ID = 'PL_BP4_006_REVEAL_SELECTED_MUSE_MEMBER';
const SP_BP4_002_OPTION_STEP_ID = 'SP_BP4_002_WAIT_OPTION';
const SP_BP4_002_SELECT_LIELLA_LIVE_STEP_ID = 'SP_BP4_002_SELECT_HIGH_REQUIREMENT_LIELLA_LIVE';
const SP_BP4_002_REVEAL_LIELLA_LIVE_STEP_ID =
  'SP_BP4_002_REVEAL_SELECTED_HIGH_REQUIREMENT_LIELLA_LIVE';
const N_PB1_016_SELECT_KARIN_MEMBER_STEP_ID = 'N_PB1_016_SELECT_KARIN_MEMBER_FROM_TOP_TWO';
const N_PB1_016_REVEAL_KARIN_MEMBER_STEP_ID = 'N_PB1_016_REVEAL_SELECTED_KARIN_MEMBER';
const N_PB1_018_SELECT_KANATA_MEMBER_STEP_ID = 'N_PB1_018_SELECT_KANATA_MEMBER_FROM_TOP_TWO';
const N_PB1_018_REVEAL_KANATA_MEMBER_STEP_ID = 'N_PB1_018_REVEAL_SELECTED_KANATA_MEMBER';
const N_PB1_021_SELECT_RINA_MEMBER_STEP_ID = 'N_PB1_021_SELECT_RINA_MEMBER_FROM_TOP_TWO';
const N_PB1_021_REVEAL_RINA_MEMBER_STEP_ID = 'N_PB1_021_REVEAL_SELECTED_RINA_MEMBER';
const N_PB1_024_SELECT_LANZHU_MEMBER_STEP_ID = 'N_PB1_024_SELECT_LANZHU_MEMBER_FROM_TOP_TWO';
const N_PB1_024_REVEAL_LANZHU_MEMBER_STEP_ID = 'N_PB1_024_REVEAL_SELECTED_LANZHU_MEMBER';
const N_SD1_001_SELECT_NIJIGASAKI_LIVE_STEP_ID =
  'N_SD1_001_SELECT_NIJIGASAKI_LIVE_FROM_TOP_FIVE';
const N_SD1_001_REVEAL_NIJIGASAKI_LIVE_STEP_ID = 'N_SD1_001_REVEAL_SELECTED_NIJIGASAKI_LIVE';

function createNamedMemberLookTopTwoConfig(params: {
  readonly abilityId: string;
  readonly memberName: string;
  readonly selectStepId: string;
  readonly revealStepId: string;
}): RegisteredLookTopSelectToHandWorkflowConfig {
  return {
    abilityId: params.abilityId,
    topCount: 2,
    selector: and(typeIs(CardType.MEMBER), cardNameAliasIs(params.memberName)),
    countRule: { minCount: 0, maxCount: 1 },
    revealSelectedBeforeHand: true,
    selectStepId: params.selectStepId,
    revealStepId: params.revealStepId,
    selectStepText: getAbilityEffectText(params.abilityId),
    noTargetStepText: getAbilityEffectText(params.abilityId),
    selectionLabel: '选择要公开并加入手牌的指定成员',
    confirmSelectionLabel: '公开并加入手牌',
    skipSelectionLabel: '全部放置入休息室',
    revealStepText: getAbilityEffectText(params.abilityId),
    revealActionStep: 'REVEAL_SELECTED_NAMED_MEMBER',
    noCardsMode: 'open-selection',
    includeInspectedCardIdsInFinishAction: true,
    publicEffectSummaryContext: {
      effectKind: 'DISCARD_LOOK_TOP_SELECT_TO_HAND',
      sourceActionLabel: '登场',
      inspectSourceZone: ZoneType.MAIN_DECK,
      requestedInspectCount: 2,
    },
  };
}

const LOOK_TOP_SELECT_TO_HAND_WORKFLOWS: readonly RegisteredLookTopSelectToHandWorkflowConfig[] = [
  {
    abilityId: N_SD1_001_ON_ENTER_LOOK_TOP_NIJIGASAKI_LIVE_ABILITY_ID,
    topCount: 5,
    selector: and(typeIs(CardType.LIVE), groupAliasIs('虹ヶ咲')),
    countRule: { minCount: 0, maxCount: 1 },
    revealSelectedBeforeHand: true,
    selectStepId: N_SD1_001_SELECT_NIJIGASAKI_LIVE_STEP_ID,
    revealStepId: N_SD1_001_REVEAL_NIJIGASAKI_LIVE_STEP_ID,
    selectStepText: getAbilityEffectText(N_SD1_001_ON_ENTER_LOOK_TOP_NIJIGASAKI_LIVE_ABILITY_ID),
    noTargetStepText: getAbilityEffectText(
      N_SD1_001_ON_ENTER_LOOK_TOP_NIJIGASAKI_LIVE_ABILITY_ID
    ),
    selectionLabel: '选择要公开并加入手牌的虹咲 LIVE',
    confirmSelectionLabel: '公开并加入手牌',
    skipSelectionLabel: '不加入',
    revealStepText: getAbilityEffectText(
      N_SD1_001_ON_ENTER_LOOK_TOP_NIJIGASAKI_LIVE_ABILITY_ID
    ),
    revealActionStep: 'REVEAL_SELECTED_NIJIGASAKI_LIVE',
    noCardsMode: 'open-selection',
    includeInspectedCardIdsInFinishAction: true,
    publicEffectSummaryContext: {
      effectKind: 'DISCARD_LOOK_TOP_SELECT_TO_HAND',
      sourceActionLabel: '登场',
      inspectSourceZone: ZoneType.MAIN_DECK,
      requestedInspectCount: 5,
    },
  },
  createNamedMemberLookTopTwoConfig({
    abilityId: PL_N_PB1_016_ON_ENTER_LOOK_TOP_TWO_KARIN_MEMBER_ABILITY_ID,
    memberName: '朝香果林',
    selectStepId: N_PB1_016_SELECT_KARIN_MEMBER_STEP_ID,
    revealStepId: N_PB1_016_REVEAL_KARIN_MEMBER_STEP_ID,
  }),
  createNamedMemberLookTopTwoConfig({
    abilityId: PL_N_PB1_018_ON_ENTER_LOOK_TOP_TWO_KANATA_MEMBER_ABILITY_ID,
    memberName: '近江彼方',
    selectStepId: N_PB1_018_SELECT_KANATA_MEMBER_STEP_ID,
    revealStepId: N_PB1_018_REVEAL_KANATA_MEMBER_STEP_ID,
  }),
  createNamedMemberLookTopTwoConfig({
    abilityId: PL_N_PB1_021_ON_ENTER_LOOK_TOP_TWO_RINA_MEMBER_ABILITY_ID,
    memberName: '天王寺璃奈',
    selectStepId: N_PB1_021_SELECT_RINA_MEMBER_STEP_ID,
    revealStepId: N_PB1_021_REVEAL_RINA_MEMBER_STEP_ID,
  }),
  createNamedMemberLookTopTwoConfig({
    abilityId: PL_N_PB1_024_ON_ENTER_LOOK_TOP_TWO_LANZHU_MEMBER_ABILITY_ID,
    memberName: '鐘嵐珠',
    selectStepId: N_PB1_024_SELECT_LANZHU_MEMBER_STEP_ID,
    revealStepId: N_PB1_024_REVEAL_LANZHU_MEMBER_STEP_ID,
  }),
  {
    abilityId: PL_BP4_006_ON_ENTER_SUCCESS_SCORE_THREE_LOOK_TOP_FIVE_MUSE_MEMBER_ABILITY_ID,
    topCount: 5,
    selector: and(typeIs(CardType.MEMBER), groupAliasIs("μ's")),
    countRule: { minCount: 0, maxCount: 1 },
    revealSelectedBeforeHand: true,
    minSuccessfulLiveScore: 3,
    selectStepId: PL_BP4_006_SELECT_MUSE_MEMBER_STEP_ID,
    revealStepId: PL_BP4_006_REVEAL_MUSE_MEMBER_STEP_ID,
    selectStepText: getAbilityEffectText(
      PL_BP4_006_ON_ENTER_SUCCESS_SCORE_THREE_LOOK_TOP_FIVE_MUSE_MEMBER_ABILITY_ID
    ),
    noTargetStepText: getAbilityEffectText(
      PL_BP4_006_ON_ENTER_SUCCESS_SCORE_THREE_LOOK_TOP_FIVE_MUSE_MEMBER_ABILITY_ID
    ),
    selectionLabel: "选择要公开并加入手牌的『μ's』成员",
    confirmSelectionLabel: '公开并加入手牌',
    skipSelectionLabel: '全部放置入休息室',
    revealStepText: getAbilityEffectText(
      PL_BP4_006_ON_ENTER_SUCCESS_SCORE_THREE_LOOK_TOP_FIVE_MUSE_MEMBER_ABILITY_ID
    ),
    revealActionStep: 'REVEAL_SELECTED_MUSE_MEMBER',
    noCardsMode: 'open-selection',
    includeInspectedCardIdsInFinishAction: true,
    publicEffectSummaryContext: {
      effectKind: 'DISCARD_LOOK_TOP_SELECT_TO_HAND',
      sourceActionLabel: '登场',
      inspectSourceZone: ZoneType.MAIN_DECK,
      requestedInspectCount: 5,
    },
  },
  {
    abilityId: SP_BP4_002_ON_ENTER_WAIT_LOOK_TOP_HIGH_REQUIREMENT_LIELLA_LIVE_ABILITY_ID,
    topCount: 4,
    selector: and(typeIs(CardType.LIVE), groupAliasIs('Liella!'), liveTotalRequiredHeartGte(8)),
    countRule: { minCount: 0, maxCount: 1 },
    revealSelectedBeforeHand: true,
    optionStepId: SP_BP4_002_OPTION_STEP_ID,
    optionalSourceOrientationCost: 'WAITING',
    selectStepId: SP_BP4_002_SELECT_LIELLA_LIVE_STEP_ID,
    revealStepId: SP_BP4_002_REVEAL_LIELLA_LIVE_STEP_ID,
    selectStepText:
      '请选择至多1张必要Heart合计大于等于8的『Liella!』LIVE卡公开并加入手牌。也可以不加入。',
    noTargetStepText:
      '没有可加入手牌的必要Heart合计大于等于8的『Liella!』LIVE卡。确认后其余卡片放置入休息室。',
    selectionLabel: '选择要公开并加入手牌的高必要Heart Liella! LIVE',
    confirmSelectionLabel: '公开并加入手牌',
    skipSelectionLabel: '不加入',
    revealStepText: '选择的LIVE卡已公开。确认后加入手牌，其余卡片放置入休息室。',
    revealActionStep: 'REVEAL_SELECTED_HIGH_REQUIREMENT_LIELLA_LIVE',
    publicEffectSummaryContext: {
      effectKind: 'DISCARD_LOOK_TOP_SELECT_TO_HAND',
      sourceActionLabel: '登场',
      inspectSourceZone: ZoneType.MAIN_DECK,
      requestedInspectCount: 4,
      sourceOrientationCost: 'WAITING',
    },
  },
  {
    abilityId: UMI_ON_ENTER_ABILITY_ID,
    topCount: 5,
    selector: and(typeIs(CardType.LIVE), groupAliasIs("μ's")),
    countRule: { minCount: 0, maxCount: 1 },
    revealSelectedBeforeHand: true,
    selectStepId: UMI_SELECT_STEP_ID,
    revealStepId: UMI_REVEAL_STEP_ID,
    selectStepText: getAbilityEffectText(UMI_ON_ENTER_ABILITY_ID),
    noTargetStepText: getAbilityEffectText(UMI_ON_ENTER_ABILITY_ID),
    confirmSelectionLabel: '公开并加入手牌',
    skipSelectionLabel: '不加入',
    revealStepText: getAbilityEffectText(UMI_ON_ENTER_ABILITY_ID),
    revealActionStep: 'REVEAL_SELECTED',
    noCardsMode: 'open-selection',
    includeInspectedCardIdsInFinishAction: true,
    publicEffectSummaryContext: {
      effectKind: 'DISCARD_LOOK_TOP_SELECT_TO_HAND',
      sourceActionLabel: '登场',
      inspectSourceZone: ZoneType.MAIN_DECK,
      requestedInspectCount: 5,
    },
  },
  {
    abilityId: SP_BP2_002_ON_ENTER_LOOK_HIGH_COST_CARD_ABILITY_ID,
    topCount: 3,
    selector: costGte(11),
    countRule: { minCount: 0, maxCount: 1 },
    revealSelectedBeforeHand: true,
    selectStepId: SP_BP2_002_SELECT_HIGH_COST_CARD_STEP_ID,
    revealStepId: SP_BP2_002_REVEAL_SELECTED_STEP_ID,
    selectStepText: '请选择至多1张费用大于等于11的卡公开并加入手牌。也可以不加入。',
    noTargetStepText: '没有可加入手牌的费用大于等于11的卡。确认后其余卡片放置入休息室。',
    selectionLabel: '选择要公开并加入手牌的高费用卡',
    confirmSelectionLabel: '公开并加入手牌',
    skipSelectionLabel: '不加入',
    revealStepText: '选择的卡片已公开。确认后加入手牌，其余卡片放置入休息室。',
    revealActionStep: 'REVEAL_SELECTED_HIGH_COST_CARD',
    publicEffectSummaryContext: {
      effectKind: 'DISCARD_LOOK_TOP_SELECT_TO_HAND',
      sourceActionLabel: '登场',
      inspectSourceZone: ZoneType.MAIN_DECK,
      requestedInspectCount: 3,
    },
  },
  {
    abilityId: S_SD1_003_ON_ENTER_LOOK_TOP_AQOURS_LIVE_ABILITY_ID,
    topCount: 5,
    selector: and(typeIs(CardType.LIVE), groupAliasIs('Aqours')),
    countRule: { minCount: 0, maxCount: 1 },
    revealSelectedBeforeHand: true,
    selectStepId: S_SD1_003_SELECT_AQOURS_LIVE_STEP_ID,
    revealStepId: S_SD1_003_REVEAL_AQOURS_LIVE_STEP_ID,
    selectStepText: getAbilityEffectText(S_SD1_003_ON_ENTER_LOOK_TOP_AQOURS_LIVE_ABILITY_ID),
    noTargetStepText: getAbilityEffectText(S_SD1_003_ON_ENTER_LOOK_TOP_AQOURS_LIVE_ABILITY_ID),
    selectionLabel: '选择要公开并加入手牌的 Aqours LIVE',
    confirmSelectionLabel: '公开并加入手牌',
    skipSelectionLabel: '不加入',
    revealStepText: getAbilityEffectText(S_SD1_003_ON_ENTER_LOOK_TOP_AQOURS_LIVE_ABILITY_ID),
    revealActionStep: 'REVEAL_SELECTED_AQOURS_LIVE',
    noCardsMode: 'open-selection',
    includeInspectedCardIdsInFinishAction: true,
    publicEffectSummaryContext: {
      effectKind: 'DISCARD_LOOK_TOP_SELECT_TO_HAND',
      sourceActionLabel: '登场',
      inspectSourceZone: ZoneType.MAIN_DECK,
      requestedInspectCount: 5,
    },
  },
  {
    abilityId: BP6_002_ON_ENTER_LOOK_NO_ABILITY_OR_CONTINUOUS_MUSE_CARD_ABILITY_ID,
    topCount: 2,
    selector: and(groupIs("μ's"), hasNoAbilityOrContinuousAbility()),
    countRule: { minCount: 0, maxCount: 1 },
    revealSelectedBeforeHand: true,
    selectStepId: BP6_002_SELECT_NO_ABILITY_OR_CONTINUOUS_MUSE_CARD_STEP_ID,
    revealStepId: BP6_002_REVEAL_SELECTED_STEP_ID,
    selectStepText:
      "请选择至多1张不持有能力或持有【常时】能力的『μ's』卡公开并加入手牌。也可以不加入。",
    noTargetStepText:
      "没有可加入手牌的不持有能力或持有【常时】能力的『μ's』卡。确认后其余卡片放置入休息室。",
    selectionLabel: "选择要公开并加入手牌的『μ's』卡",
    confirmSelectionLabel: '公开并加入手牌',
    skipSelectionLabel: '不加入',
    revealStepText: '选择的卡片已公开。确认后加入手牌，其余卡片放置入休息室。',
    revealActionStep: 'REVEAL_SELECTED_NO_ABILITY_OR_CONTINUOUS_MUSE_CARD',
    publicEffectSummaryContext: {
      effectKind: 'DISCARD_LOOK_TOP_SELECT_TO_HAND',
      sourceActionLabel: '登场',
      inspectSourceZone: ZoneType.MAIN_DECK,
      requestedInspectCount: 2,
    },
  },
  {
    abilityId: HS_BP2_012_LEAVE_STAGE_LOOK_TOP_MEMBER_ABILITY_ID,
    topCount: 5,
    selector: (card) => isMemberCardData(card.data),
    countRule: { minCount: 0, maxCount: 1 },
    revealSelectedBeforeHand: true,
    selectStepId: HS_BP2_012_SELECT_MEMBER_STEP_ID,
    revealStepId: HS_BP2_012_REVEAL_SELECTED_STEP_ID,
    selectStepText: '请选择至多1张成员卡公开并加入手牌。也可以不加入。',
    noTargetStepText: '没有可加入手牌的成员卡。确认后其余卡片放置入休息室。',
    selectionLabel: '选择要公开并加入手牌的成员',
    confirmSelectionLabel: '公开并加入手牌',
    skipSelectionLabel: '不加入',
    revealStepText: '选择的成员卡已公开。确认后加入手牌，其余卡片放置入休息室。',
    revealActionStep: 'REVEAL_SELECTED_MEMBER',
    publicEffectSummaryContext: {
      effectKind: 'DISCARD_LOOK_TOP_SELECT_TO_HAND',
      sourceActionLabel: '离场',
      inspectSourceZone: ZoneType.MAIN_DECK,
      requestedInspectCount: 5,
    },
  },
  {
    abilityId: HS_BP2_013_LEAVE_STAGE_LOOK_TOP_LIVE_ABILITY_ID,
    topCount: 5,
    selector: typeIs(CardType.LIVE),
    countRule: { minCount: 0, maxCount: 1 },
    revealSelectedBeforeHand: true,
    selectStepId: HS_BP2_013_SELECT_LIVE_STEP_ID,
    revealStepId: HS_BP2_013_REVEAL_SELECTED_STEP_ID,
    selectStepText: '请选择至多1张LIVE卡公开并加入手牌。也可以不加入。',
    noTargetStepText: '没有可加入手牌的LIVE卡。确认后其余卡片放置入休息室。',
    selectionLabel: '选择要公开并加入手牌的LIVE卡',
    confirmSelectionLabel: '公开并加入手牌',
    skipSelectionLabel: '不加入',
    revealStepText: '选择的LIVE卡已公开。确认后加入手牌，其余卡片放置入休息室。',
    revealActionStep: 'REVEAL_SELECTED_LIVE',
    publicEffectSummaryContext: {
      effectKind: 'DISCARD_LOOK_TOP_SELECT_TO_HAND',
      sourceActionLabel: '离场',
      inspectSourceZone: ZoneType.MAIN_DECK,
      requestedInspectCount: 5,
    },
  },
  {
    abilityId: S_BP6_005_ON_ENTER_LOOK_TOP_THREE_COLOR_MEMBER_ABILITY_ID,
    topCount: 2,
    selector: and(
      typeIs(CardType.MEMBER),
      memberHasHeartColor(HeartColor.RED),
      memberHasHeartColor(HeartColor.GREEN),
      memberHasHeartColor(HeartColor.BLUE)
    ),
    countRule: { minCount: 0, maxCount: 1 },
    revealSelectedBeforeHand: true,
    selectStepId: S_BP6_005_SELECT_THREE_COLOR_MEMBER_STEP_ID,
    revealStepId: S_BP6_005_REVEAL_THREE_COLOR_MEMBER_STEP_ID,
    selectStepText:
      '请选择至多1张同时持有红Heart、绿Heart、蓝Heart的成员卡公开并加入手牌。也可以不加入。',
    noTargetStepText:
      '没有可加入手牌的同时持有红Heart、绿Heart、蓝Heart的成员卡。确认后其余卡片放置入休息室。',
    selectionLabel: '选择要公开并加入手牌的三色Heart成员',
    confirmSelectionLabel: '公开并加入手牌',
    skipSelectionLabel: '不加入',
    revealStepText: getAbilityEffectText(S_BP6_005_ON_ENTER_LOOK_TOP_THREE_COLOR_MEMBER_ABILITY_ID),
    revealActionStep: 'REVEAL_SELECTED_THREE_COLOR_MEMBER',
    publicEffectSummaryContext: {
      effectKind: 'DISCARD_LOOK_TOP_SELECT_TO_HAND',
      sourceActionLabel: '登场',
      inspectSourceZone: ZoneType.MAIN_DECK,
      requestedInspectCount: 2,
    },
  },
  {
    abilityId: PL_S_BP5_007_LIVE_SUCCESS_LOOK_TOP_GREEN_HEART_MEMBER_ABILITY_ID,
    topCount: 4,
    selector: and(typeIs(CardType.MEMBER), memberHasPrintedHeartColorAtLeast(HeartColor.GREEN, 2)),
    countRule: { minCount: 0, maxCount: 1 },
    revealSelectedBeforeHand: true,
    selectStepId: PL_S_BP5_007_SELECT_GREEN_HEART_MEMBER_STEP_ID,
    revealStepId: PL_S_BP5_007_REVEAL_GREEN_HEART_MEMBER_STEP_ID,
    selectStepText: '请选择至多1张持有2个以上[緑ハート]的成员卡公开并加入手牌。也可以不加入。',
    noTargetStepText: '没有可加入手牌的持有2个以上[緑ハート]的成员卡。确认后其余卡片放置入休息室。',
    selectionLabel: '选择要公开并加入手牌的绿Heart成员',
    confirmSelectionLabel: '公开并加入手牌',
    skipSelectionLabel: '不加入',
    revealStepText: '选择的成员卡已公开。确认后加入手牌，其余卡片放置入休息室。',
    revealActionStep: 'REVEAL_SELECTED_GREEN_HEART_MEMBER',
    publicEffectSummaryContext: {
      effectKind: 'DISCARD_LOOK_TOP_SELECT_TO_HAND',
      sourceActionLabel: 'LIVE成功',
      inspectSourceZone: ZoneType.MAIN_DECK,
      requestedInspectCount: 4,
    },
  },
];

export function registerLookTopSelectToHandWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom &
    EnqueueTriggeredCardEffectsForMemberStateChanged;
}): void {
  for (const config of LOOK_TOP_SELECT_TO_HAND_WORKFLOWS) {
    const { abilityId, ...workflowConfig } = config;
    registerPendingAbilityStarterHandler(abilityId, (game, ability, options, context) =>
      workflowConfig.optionalSourceOrientationCost
        ? startOptionalSourceOrientationLookTopWorkflow(
            game,
            ability,
            {
              ...workflowConfig,
              effectText: getAbilityEffectText(abilityId),
            },
            options.orderedResolution === true
          )
        : startLookTopSelectToHandWorkflow(
            game,
            ability,
            {
              ...workflowConfig,
              effectText: getAbilityEffectText(abilityId),
            },
            {
              orderedResolution: options.orderedResolution,
              continuePendingCardEffects: context.continuePendingCardEffects,
              enqueueTriggeredCardEffects: deps.enqueueTriggeredCardEffects,
            }
          )
    );
    if (config.optionalSourceOrientationCost && config.optionStepId) {
      registerActiveEffectStepHandler(abilityId, config.optionStepId, (game, input, context) =>
        input.selectedOptionId === 'activate'
          ? finishOptionalSourceOrientationLookTopWorkflow(
              game,
              {
                ...workflowConfig,
                effectText: getAbilityEffectText(abilityId),
              },
              {
                orderedResolution: game.activeEffect?.metadata?.orderedResolution === true,
                continuePendingCardEffects: context.continuePendingCardEffects,
                enqueueTriggeredCardEffects: deps.enqueueTriggeredCardEffects,
                enqueueMemberStateChangedCardEffects: deps.enqueueTriggeredCardEffects,
              }
            )
          : finishSkippedActiveEffect(game, context.continuePendingCardEffects)
      );
    }
    registerActiveEffectStepHandler(abilityId, config.selectStepId, (game, input, context) =>
      resolveLookTopSelectToHandSelection(
        game,
        input.selectedCardId ?? null,
        input.selectedCardIds,
        {
          continuePendingCardEffects: context.continuePendingCardEffects,
          enqueueTriggeredCardEffects: deps.enqueueTriggeredCardEffects,
        },
        (state, selectedCardIds) =>
          selectedCardIds.every((cardId) => {
            const card = getCardById(state, cardId);
            return card !== null && config.selector(card);
          })
      )
    );
    if (config.revealStepId) {
      registerActiveEffectStepHandler(abilityId, config.revealStepId, (game, _input, context) =>
        finishRevealedLookTopSelectToHandWorkflow(
          game,
          {
            continuePendingCardEffects: context.continuePendingCardEffects,
            enqueueTriggeredCardEffects: deps.enqueueTriggeredCardEffects,
          },
          (state, selectedCardIds) =>
            selectedCardIds.every((cardId) => {
              const card = getCardById(state, cardId);
              return card !== null && config.selector(card);
            })
        )
      );
    }
  }
}

function startOptionalSourceOrientationLookTopWorkflow(
  game: GameState,
  ability: LookTopSelectToHandAbilityContext,
  config: LookTopSelectToHandWorkflowConfig,
  orderedResolution: boolean
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  const sourceSlot = player ? findMemberSlot(player, ability.sourceCardId) : null;
  const sourceState = player?.memberSlots.cardStates.get(ability.sourceCardId);
  const canPay =
    config.optionalSourceOrientationCost === 'WAITING' &&
    sourceSlot !== null &&
    sourceState?.orientation !== OrientationState.WAITING;
  const optionStepId = config.optionStepId;
  if (!player || !optionStepId) {
    return game;
  }

  return startPendingActiveEffect(game, {
    ability,
    playerId: player.id,
    activeEffect: {
      id: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      controllerId: ability.controllerId,
      effectText: config.effectText,
      stepId: optionStepId,
      stepText: canPay
        ? '可以将此成员变为待机状态：检视卡组顶4张。'
        : '当前无法支付“将此成员变为待机状态”的费用，可以不发动。',
      awaitingPlayerId: player.id,
      selectableOptions: canPay
        ? [
            { id: 'activate', label: '发动' },
            { id: 'decline', label: '不发动' },
          ]
        : [{ id: 'decline', label: '不发动' }],
      metadata: {
        orderedResolution,
      },
    },
    actionPayload: {
      sourceCardId: ability.sourceCardId,
      step: 'START_SOURCE_ORIENTATION_OPTION',
      sourceSlot,
      sourceOrientationCost: config.optionalSourceOrientationCost,
    },
  });
}

function finishOptionalSourceOrientationLookTopWorkflow(
  game: GameState,
  config: LookTopSelectToHandWorkflowConfig,
  options: LookTopSelectToHandWorkflowOptions & {
    readonly enqueueMemberStateChangedCardEffects: EnqueueTriggeredCardEffectsForMemberStateChanged;
  }
): GameState {
  const effect = game.activeEffect;
  const player = effect ? getPlayerById(game, effect.controllerId) : null;
  if (
    !effect ||
    !player ||
    !config.optionStepId ||
    effect.stepId !== config.optionStepId ||
    config.optionalSourceOrientationCost !== 'WAITING'
  ) {
    return game;
  }

  const sourceSlot = findMemberSlot(player, effect.sourceCardId);
  if (!sourceSlot) {
    return game;
  }
  const waitResult = setMemberOrientation(
    game,
    player.id,
    effect.sourceCardId,
    OrientationState.WAITING,
    {
      kind: 'CARD_EFFECT',
      playerId: player.id,
      sourceCardId: effect.sourceCardId,
      abilityId: effect.abilityId,
    }
  );
  if (!waitResult || waitResult.previousOrientation === OrientationState.WAITING) {
    return game;
  }

  const stateWithMemberStateTriggers = enqueueMemberStateChangedTriggersFromOrientationResult(
    game,
    waitResult,
    options.enqueueMemberStateChangedCardEffects,
    {
      prepareGameStateBeforeEnqueue: (stateAfterWait, result, memberStateChangedEvents) =>
        recordPayCostAction(stateAfterWait, player.id, {
          pendingAbilityId: effect.id,
          abilityId: effect.abilityId,
          sourceCardId: effect.sourceCardId,
          sourceSlot,
          orientedMemberCardIds: [effect.sourceCardId],
          previousOrientation: result.previousOrientation,
          nextOrientation: result.nextOrientation,
          memberStateChangedEventIds: memberStateChangedEvents.map((event) => event.eventId),
        }),
    }
  );

  return startLookTopSelectToHandWorkflow(
    { ...stateWithMemberStateTriggers.gameState, activeEffect: null },
    {
      id: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      controllerId: effect.controllerId,
    },
    config,
    options
  );
}

export function startLookTopSelectToHandWorkflow(
  game: GameState,
  ability: LookTopSelectToHandAbilityContext,
  config: LookTopSelectToHandWorkflowConfig,
  options: LookTopSelectToHandWorkflowOptions
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  if (config.minSuccessfulLiveScore !== undefined) {
    const successfulLiveScore = sumSuccessfulLiveScore(game, player.id);
    if (successfulLiveScore < config.minSuccessfulLiveScore) {
      const state = {
        ...game,
        pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
      };
      return options.continuePendingCardEffects(
        addAction(state, 'RESOLVE_ABILITY', player.id, {
          pendingAbilityId: ability.id,
          abilityId: ability.abilityId,
          sourceCardId: ability.sourceCardId,
          step: 'SUCCESS_LIVE_SCORE_CONDITION_NOT_MET',
          successfulLiveScore,
          requiredSuccessfulLiveScore: config.minSuccessfulLiveScore,
          conditionMet: false,
          resultText: `成功LIVE卡区中的卡片分数合计为${successfulLiveScore}，未达到${config.minSuccessfulLiveScore}，不检视卡组顶。`,
        }),
        options.orderedResolution === true
      );
    }
  }

  if (
    player.mainDeck.cardIds.length === 0 &&
    player.waitingRoom.cardIds.length === 0 &&
    config.noCardsMode !== 'open-selection'
  ) {
    const state = {
      ...game,
      pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
    };
    return options.continuePendingCardEffects(
      addAction(state, 'RESOLVE_ABILITY', player.id, {
        pendingAbilityId: ability.id,
        abilityId: ability.abilityId,
        sourceCardId: ability.sourceCardId,
        step: config.finishActionStep ?? 'FINISH',
        inspectedCardIds: [],
      }),
      options.orderedResolution === true
    );
  }

  const inspection = inspectTopCards(game, player.id, {
    count: config.topCount,
    selectablePredicate: config.selector,
  });
  if (!inspection) {
    return game;
  }
  const { gameState, inspectedCardIds, selectableCardIds } = inspection;
  const configuredCountRule =
    config.selectionRequiredWhenHasTargets === true && selectableCardIds.length > 0
      ? { minCount: 1, maxCount: getMaxSelectableCount(config.countRule) }
      : config.countRule;
  const countRule =
    config.clampExactCountToInspectedCount === true &&
    'exactCount' in configuredCountRule &&
    configuredCountRule.exactCount !== undefined
      ? { exactCount: Math.min(configuredCountRule.exactCount, selectableCardIds.length) }
      : configuredCountRule;
  const shouldUseOrderedMulti = getMaxSelectableCount(countRule) > 1;
  const canSkipSelection = getMinSelectableCount(countRule) === 0;

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
        effectText: config.effectText,
        stepId: config.selectStepId,
        stepText: selectableCardIds.length > 0 ? config.selectStepText : config.noTargetStepText,
        awaitingPlayerId: player.id,
        inspectionCardIds: inspectedCardIds,
        selectableCardIds,
        selectableCardVisibility: 'AWAITING_PLAYER_ONLY',
        selectableCardMode: shouldUseOrderedMulti ? 'ORDERED_MULTI' : undefined,
        minSelectableCards: shouldUseOrderedMulti ? getMinSelectableCount(countRule) : undefined,
        maxSelectableCards: shouldUseOrderedMulti ? getMaxSelectableCount(countRule) : undefined,
        selectionLabel: config.selectionLabel,
        confirmSelectionLabel: config.confirmSelectionLabel,
        canSkipSelection,
        skipSelectionLabel: canSkipSelection
          ? selectableCardIds.length > 0
            ? config.skipSelectionLabel
            : inspectedCardIds.length > 0
              ? '全部放置入休息室'
              : '确认'
          : undefined,
        metadata: {
          sourceZone: ZoneType.MAIN_DECK,
          orderedResolution: options.orderedResolution === true,
          revealSelectedBeforeHand: config.revealSelectedBeforeHand,
          revealStepId: config.revealStepId,
          revealStepText: config.revealStepText,
          revealActionStep: config.revealActionStep,
          finishActionStep: config.finishActionStep ?? 'FINISH',
          countRule,
          candidateCardIds: selectableCardIds,
          includeInspectedCardIdsInFinishAction: config.includeInspectedCardIdsInFinishAction,
          ...(config.publicEffectSummaryContext
            ? { publicEffectSummaryContext: config.publicEffectSummaryContext }
            : {}),
        } satisfies LookTopSelectToHandMetadata,
      },
    },
    'RESOLVE_ABILITY',
    player.id,
    {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: config.startActionStep ?? 'START_INSPECTION',
      inspectedCardIds,
      selectableCardIds,
      ...(config.publicEffectSummaryContext
        ? {
            publicEffectSummary: {
              ...config.publicEffectSummaryContext,
              summaryStatus: 'STARTED',
              actualInspectedCount: inspectedCardIds.length,
            },
          }
        : {}),
      ...config.startActionPayload,
    }
  );
}

export function resolveLookTopSelectToHandSelection(
  game: GameState,
  selectedCardId: string | null,
  selectedCardIds: readonly string[] | undefined = undefined,
  options: Pick<
    LookTopSelectToHandWorkflowOptions,
    'continuePendingCardEffects' | 'enqueueTriggeredCardEffects'
  >,
  customSelectionValidator?: LookTopSelectSelectionValidator
): GameState {
  const effect = game.activeEffect;
  if (!effect) {
    return game;
  }
  const selectedCardIdsToMove =
    selectedCardIds && selectedCardIds.length > 0
      ? selectedCardIds
      : selectedCardId !== null
        ? [selectedCardId]
        : [];
  const metadata = getLookTopSelectToHandMetadata(effect.metadata);
  if (
    !metadata ||
    !validateLookTopSelection(game, selectedCardIdsToMove, metadata, customSelectionValidator)
  ) {
    return game;
  }

  if (metadata.revealSelectedBeforeHand && selectedCardIdsToMove.length > 0) {
    return revealLookTopSelectToHandSelection(game, selectedCardIdsToMove, metadata);
  }

  return finishLookTopSelectToHandWorkflow(game, selectedCardIdsToMove, options);
}

export function finishRevealedLookTopSelectToHandWorkflow(
  game: GameState,
  options: Pick<
    LookTopSelectToHandWorkflowOptions,
    'continuePendingCardEffects' | 'enqueueTriggeredCardEffects'
  >,
  customSelectionValidator?: LookTopSelectSelectionValidator
): GameState {
  const effect = game.activeEffect;
  if (!effect) {
    return game;
  }
  const metadata = getLookTopSelectToHandMetadata(effect.metadata);
  if (
    !metadata ||
    !metadata.selectedCardIds ||
    !validateLookTopSelection(game, metadata.selectedCardIds, metadata, customSelectionValidator)
  ) {
    return game;
  }

  return finishLookTopSelectToHandWorkflow(game, metadata.selectedCardIds, options);
}

function revealLookTopSelectToHandSelection(
  game: GameState,
  selectedCardIds: readonly string[],
  metadata: LookTopSelectToHandMetadata
): GameState {
  const effect = game.activeEffect;
  if (!effect || !metadata.revealStepId || !metadata.revealStepText) {
    return game;
  }

  const revealedCardIds = [
    ...game.inspectionZone.revealedCardIds,
    ...selectedCardIds.filter((cardId) => !game.inspectionZone.revealedCardIds.includes(cardId)),
  ];

  return addAction(
    {
      ...game,
      inspectionZone: {
        ...game.inspectionZone,
        revealedCardIds,
      },
      activeEffect: {
        ...effect,
        stepId: metadata.revealStepId,
        stepText: metadata.revealStepText,
        selectableCardIds: [],
        selectableCardVisibility: undefined,
        selectableCardMode: undefined,
        minSelectableCards: undefined,
        maxSelectableCards: undefined,
        selectionLabel: undefined,
        confirmSelectionLabel: undefined,
        canSkipSelection: false,
        skipSelectionLabel: undefined,
        metadata: {
          ...effect.metadata,
          selectedCardIds,
          selectedCardId: selectedCardIds[0] ?? null,
        },
      },
    },
    'RESOLVE_ABILITY',
    effect.controllerId,
    {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: metadata.revealActionStep ?? 'REVEAL_SELECTED',
      selectedCardId: selectedCardIds[0] ?? null,
      selectedCardIds,
    }
  );
}

function finishLookTopSelectToHandWorkflow(
  game: GameState,
  selectedCardIds: readonly string[],
  options: Pick<
    LookTopSelectToHandWorkflowOptions,
    'continuePendingCardEffects' | 'enqueueTriggeredCardEffects'
  >
): GameState {
  const effect = game.activeEffect;
  if (!effect) {
    return game;
  }
  const player = getPlayerById(game, effect.controllerId);
  const metadata = getLookTopSelectToHandMetadata(effect.metadata);
  if (!player || !metadata || !validateLookTopSelection(game, selectedCardIds, metadata)) {
    return game;
  }

  const inspectedCardIds = (effect.inspectionCardIds ?? []).filter((cardId) =>
    game.inspectionZone.cardIds.includes(cardId)
  );
  const moveResult = moveInspectedCardsToHandRestToWaitingRoomAndEnqueueTriggers(
    game,
    player.id,
    inspectedCardIds,
    selectedCardIds,
    options.enqueueTriggeredCardEffects
  );
  if (!moveResult) {
    return game;
  }

  let state: GameState = { ...moveResult.gameState, activeEffect: null };
  const finishPayload: Record<string, unknown> = {
    pendingAbilityId: effect.id,
    abilityId: effect.abilityId,
    sourceCardId: effect.sourceCardId,
    step: metadata.finishActionStep,
    selectedCardId: moveResult.selectedCardIds[0] ?? null,
    selectedCardIds: moveResult.selectedCardIds,
    waitingRoomCardIds: moveResult.waitingRoomCardIds,
  };
  if (metadata.includeInspectedCardIdsInFinishAction === true) {
    finishPayload.inspectedCardIds = inspectedCardIds;
  }
  if (metadata.publicEffectSummaryContext) {
    finishPayload.publicEffectSummary = {
      ...metadata.publicEffectSummaryContext,
      summaryStatus: 'COMPLETED',
      actualInspectedCount: inspectedCardIds.length,
      selectedCardIds: moveResult.selectedCardIds,
      noSelectedCards: moveResult.selectedCardIds.length === 0,
      waitingRoomCardIds: moveResult.waitingRoomCardIds,
    };
  }

  return options.continuePendingCardEffects(
    addAction(state, 'RESOLVE_ABILITY', player.id, finishPayload),
    metadata.orderedResolution
  );
}

function validateLookTopSelection(
  game: GameState,
  selectedCardIds: readonly string[],
  metadata: LookTopSelectToHandMetadata,
  customSelectionValidator?: LookTopSelectSelectionValidator
): boolean {
  const effect = game.activeEffect;
  const uniqueSelectedCardIds = [...new Set(selectedCardIds)];
  if (!effect || uniqueSelectedCardIds.length !== selectedCardIds.length) {
    return false;
  }
  if (selectedCardIds.some((cardId) => !metadata.candidateCardIds.includes(cardId))) {
    return false;
  }
  if (selectedCardIds.some((cardId) => !effect.inspectionCardIds?.includes(cardId))) {
    return false;
  }
  if (selectedCardIds.some((cardId) => !game.inspectionZone.cardIds.includes(cardId))) {
    return false;
  }

  if ('exactCount' in metadata.countRule && metadata.countRule.exactCount !== undefined) {
    return (
      selectedCardIds.length === metadata.countRule.exactCount &&
      (customSelectionValidator?.(game, selectedCardIds) ?? true)
    );
  }

  return (
    selectedCardIds.length >= metadata.countRule.minCount &&
    selectedCardIds.length <= metadata.countRule.maxCount &&
    (customSelectionValidator?.(game, selectedCardIds) ?? true)
  );
}

function getLookTopSelectToHandMetadata(
  metadata: Readonly<Record<string, unknown>> | undefined
): LookTopSelectToHandMetadata | null {
  const countRule = metadata?.countRule;
  if (!countRule || typeof countRule !== 'object') {
    return null;
  }
  const candidate = countRule as Record<string, unknown>;
  const exactCount = candidate.exactCount;
  const minCount = candidate.minCount;
  const maxCount = candidate.maxCount;
  const parsedCountRule =
    typeof exactCount === 'number'
      ? { exactCount }
      : typeof minCount === 'number' && typeof maxCount === 'number'
        ? { minCount, maxCount }
        : null;
  if (!parsedCountRule) {
    return null;
  }

  const parsedMetadata: LookTopSelectToHandMetadata = {
    orderedResolution: metadata?.orderedResolution === true,
    revealSelectedBeforeHand: metadata?.revealSelectedBeforeHand === true,
    revealStepId: typeof metadata?.revealStepId === 'string' ? metadata.revealStepId : undefined,
    revealStepText:
      typeof metadata?.revealStepText === 'string' ? metadata.revealStepText : undefined,
    revealActionStep:
      typeof metadata?.revealActionStep === 'string' ? metadata.revealActionStep : undefined,
    finishActionStep:
      typeof metadata?.finishActionStep === 'string' ? metadata.finishActionStep : 'FINISH',
    countRule: parsedCountRule,
    candidateCardIds: Array.isArray(metadata?.candidateCardIds)
      ? metadata.candidateCardIds.filter((value): value is string => typeof value === 'string')
      : [],
    includeInspectedCardIdsInFinishAction: metadata?.includeInspectedCardIdsInFinishAction === true,
    selectedCardIds: Array.isArray(metadata?.selectedCardIds)
      ? metadata.selectedCardIds.filter((value): value is string => typeof value === 'string')
      : undefined,
  };
  const publicEffectSummaryContext = getLookTopSelectToHandPublicSummaryContext(
    metadata?.publicEffectSummaryContext
  );
  return publicEffectSummaryContext
    ? { ...parsedMetadata, publicEffectSummaryContext }
    : parsedMetadata;
}

function getLookTopSelectToHandPublicSummaryContext(
  value: unknown
): LookTopSelectToHandPublicSummaryContext | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }
  const candidate = value as Record<string, unknown>;
  if (candidate.effectKind !== 'DISCARD_LOOK_TOP_SELECT_TO_HAND') {
    return undefined;
  }
  return {
    effectKind: candidate.effectKind,
    ...(Array.isArray(candidate.discardedCostCardIds)
      ? {
          discardedCostCardIds: candidate.discardedCostCardIds.filter(
            (cardId): cardId is string => typeof cardId === 'string'
          ),
        }
      : {}),
    ...(typeof candidate.inspectSourceZone === 'string'
      ? { inspectSourceZone: candidate.inspectSourceZone as ZoneType }
      : {}),
    ...(typeof candidate.requestedInspectCount === 'number'
      ? { requestedInspectCount: candidate.requestedInspectCount }
      : {}),
    ...(candidate.sourceOrientationCost === 'WAITING'
      ? { sourceOrientationCost: candidate.sourceOrientationCost }
      : {}),
    ...(candidate.sourceActionLabel === '登场' ||
    candidate.sourceActionLabel === '离场' ||
    candidate.sourceActionLabel === '起动' ||
    candidate.sourceActionLabel === 'LIVE成功'
      ? { sourceActionLabel: candidate.sourceActionLabel }
      : {}),
  };
}

function getMinSelectableCount(countRule: LookTopSelectCountRule): number {
  return 'exactCount' in countRule && countRule.exactCount !== undefined
    ? countRule.exactCount
    : countRule.minCount;
}

function getMaxSelectableCount(countRule: LookTopSelectCountRule): number {
  return 'exactCount' in countRule && countRule.exactCount !== undefined
    ? countRule.exactCount
    : countRule.maxCount;
}
