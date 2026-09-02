import {
  addAction,
  getOpponent,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import {
  collectLiveModifiers,
  getMemberEffectiveHeartIcons,
} from '../../../../domain/rules/live-modifiers.js';
import { addMemberActivePhaseSkip } from '../../../../domain/rules/member-active-skips.js';
import { CardType, OrientationState } from '../../../../shared/types/enums.js';
import {
  HS_BP6_004_LIVE_START_WAIT_OPPONENT_LOW_COST_MEMBER_ABILITY_ID,
  HS_BP6_004_ON_ENTER_WAIT_OPPONENT_LOW_COST_MEMBER_ABILITY_ID,
  HS_BP6_013_LIVE_START_WAIT_LOW_BLADE_NON_DOLLCHESTRA_ABILITY_ID,
  HS_BP6_013_ON_ENTER_WAIT_LOW_BLADE_NON_DOLLCHESTRA_ABILITY_ID,
  HS_PB1_010_LIVE_START_WAIT_OPPONENT_LOW_COST_MEMBER_ABILITY_ID,
  HS_PB1_010_ON_ENTER_WAIT_OPPONENT_LOW_COST_MEMBER_ABILITY_ID,
  HS_PR_038_LIVE_SUCCESS_WAIT_OPPONENT_COST_FOUR_SKIP_NEXT_ACTIVE_ABILITY_ID,
  N_SD2_013_LIVE_START_ONLY_NIJIGASAKI_WAIT_LOW_PRINTED_BLADE_OPPONENT_ABILITY_ID,
  N_SD2_013_ON_ENTER_ONLY_NIJIGASAKI_WAIT_LOW_PRINTED_BLADE_OPPONENT_ABILITY_ID,
  N_SD2_019_LIVE_START_WAIT_OPPONENT_COST_TWO_MEMBER_ABILITY_ID,
  N_SD2_021_ON_ENTER_WAIT_OPPONENT_COST_FOUR_MEMBER_ABILITY_ID,
  PB1_011_ON_ENTER_DIFFERENT_BIBI_WAIT_OPPONENT_LOW_COST_MEMBER_ABILITY_ID,
  PL_PB2_033_LIVE_START_WAIT_OPPONENT_ORIGINAL_HEART_THREE_ABILITY_ID,
  PL_PB2_033_ON_ENTER_WAIT_OPPONENT_ORIGINAL_HEART_THREE_ABILITY_ID,
  PL_PB1_009_ON_ENTER_WAIT_OPPONENT_ORIGINAL_BLADE_ONE_ABILITY_ID,
  PL_BP5_013_ON_ENTER_WAIT_OPPONENT_COST_LTE_FOUR_MEMBER_ABILITY_ID,
  S_BP6_015_ON_ENTER_WAIT_OPPONENT_COST_TWO_MEMBER_ABILITY_ID,
  SP_PR_021_LIVE_START_STAGE_HEART_FIVE_WAIT_OPPONENT_COST_TWO_MEMBER_ABILITY_ID,
  SP_BP4_011_ENTER_OR_MOVE_WAIT_OPPONENT_LOW_BLADE_MEMBER_ABILITY_ID,
  SP_BP7_009_LIVE_START_WAIT_LOW_PRINTED_BLADE_OPPONENT_ABILITY_ID,
  SP_PB2_024_ON_ENTER_WAIT_OPPONENT_COST_TWO_MEMBER_ABILITY_ID,
  SP_PB2_029_LIVE_START_WAIT_OPPONENT_COST_TWO_MEMBER_ABILITY_ID,
  SP_PB2_029_ON_ENTER_WAIT_OPPONENT_COST_TWO_MEMBER_ABILITY_ID,
} from '../../ability-ids.js';
import {
  enqueueMemberStateChangedTriggersFromOrientationResult,
  type EnqueueTriggeredCardEffectsForMemberStateChanged,
} from '../../runtime/member-state-changed-triggers.js';
import {
  registerPendingAbilityStarterHandler,
  type PendingAbilityStarterOptions,
} from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import {
  getAbilityEffectText,
  maybeStartConfirmablePendingAbilityConfirmation,
} from '../../runtime/workflow-helpers.js';
import {
  and,
  costGte,
  costLte,
  groupAliasIs,
  memberPrintedBladeLte,
  not,
  type CardSelector,
  typeIs,
  unitAliasIs,
} from '../../../effects/card-selectors.js';
import { selectDifferentNamedCards } from '../../../../shared/utils/card-identity.js';
import {
  createStageMemberOrientationTargetSelection,
  getStageMemberOrientationTargetMetadata,
  resolveStageMemberOrientationTargetSelection,
} from '../../../effects/stage-member-target-selection.js';
import {
  getStageMemberCardIdsMatching,
  memberOriginalHeartLte,
  type StageMemberStatePredicate,
} from '../../../effects/stage-targets.js';

const HS_BP6_004_SELECT_OPPONENT_MEMBER_STEP_ID = 'HS_BP6_004_SELECT_OPPONENT_MEMBER_TO_WAIT';
const PL_BP5_013_SELECT_OPPONENT_MEMBER_STEP_ID = 'PL_BP5_013_SELECT_OPPONENT_MEMBER_TO_WAIT';
const SP_PB2_SELECT_OPPONENT_COST_TWO_MEMBER_STEP_ID =
  'SP_PB2_SELECT_OPPONENT_COST_TWO_MEMBER_TO_WAIT';
const S_BP6_015_SELECT_OPPONENT_COST_TWO_MEMBER_STEP_ID =
  'S_BP6_015_SELECT_OPPONENT_COST_TWO_MEMBER_TO_WAIT';
const SP_BP4_011_SELECT_OPPONENT_LOW_BLADE_MEMBER_STEP_ID =
  'SP_BP4_011_SELECT_OPPONENT_LOW_BLADE_MEMBER_TO_WAIT';
const HS_BP6_013_SELECT_OPPONENT_LOW_BLADE_NON_DOLLCHESTRA_MEMBER_STEP_ID =
  'HS_BP6_013_SELECT_OPPONENT_LOW_BLADE_NON_DOLLCHESTRA_MEMBER_TO_WAIT';
const HS_PB1_010_SELECT_OPPONENT_COST_FOUR_MEMBER_STEP_ID =
  'HS_PB1_010_SELECT_OPPONENT_COST_FOUR_MEMBER_TO_WAIT';
const PL_PB1_009_SELECT_OPPONENT_ORIGINAL_BLADE_ONE_MEMBER_STEP_ID =
  'PL_PB1_009_SELECT_OPPONENT_ORIGINAL_BLADE_ONE_MEMBER_TO_WAIT';
const SP_BP7_009_SELECT_OPPONENT_PRINTED_BLADE_TWO_MEMBER_STEP_ID =
  'SP_BP7_009_SELECT_OPPONENT_PRINTED_BLADE_TWO_MEMBER_TO_WAIT';
const N_SD2_013_SELECT_OPPONENT_PRINTED_BLADE_TWO_MEMBER_STEP_ID =
  'N_SD2_013_SELECT_OPPONENT_PRINTED_BLADE_TWO_MEMBER_TO_WAIT';
const N_SD2_021_SELECT_OPPONENT_COST_FOUR_MEMBER_STEP_ID =
  'N_SD2_021_SELECT_OPPONENT_COST_FOUR_MEMBER_TO_WAIT';
const HS_PR_038_SELECT_OPPONENT_COST_FOUR_MEMBER_STEP_ID =
  'HS_PR_038_SELECT_OPPONENT_COST_FOUR_MEMBER_TO_WAIT';
const PL_PB2_033_SELECT_OPPONENT_ORIGINAL_HEART_THREE_MEMBER_STEP_ID =
  'PL_PB2_033_SELECT_OPPONENT_ORIGINAL_HEART_THREE_MEMBER_TO_WAIT';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;
type EnqueueTriggeredCardEffects = EnqueueTriggeredCardEffectsForMemberStateChanged;

interface OpponentWaitTargetWorkflowConfig {
  readonly abilityId: string;
  readonly effectTextAbilityId: string;
  readonly stepId: string;
  readonly stepText: string;
  readonly selectionLabel: string;
  readonly selector: CardSelector;
  readonly statePredicate?: StageMemberStatePredicate;
  readonly startActionStep: string;
  readonly minOwnStageHeartTotal?: number;
  readonly minOwnStageDifferentBiBiMemberNameCount?: number;
  readonly minOwnStagePrintedCost?: number;
  readonly allOwnStageMembersGroupAlias?: string;
  readonly confirmNoTargetWithRealtimeText?: boolean;
  readonly skipNextActivePhase?: boolean;
  readonly consumeStaleSelectionAsNoOp?: boolean;
}

const lowCostOpponentMemberSelector = and(typeIs(CardType.MEMBER), costLte(9));
const costLteFourOpponentMemberSelector = and(typeIs(CardType.MEMBER), costLte(4));
const costLteTwoOpponentMemberSelector = and(typeIs(CardType.MEMBER), costLte(2));
const lowBladeNonDollchestraOpponentMemberSelector = and(
  typeIs(CardType.MEMBER),
  memberPrintedBladeLte(3),
  not(unitAliasIs('DOLLCHESTRA'))
);

const OPPONENT_WAIT_TARGET_WORKFLOWS: readonly OpponentWaitTargetWorkflowConfig[] = [
  ...[
    PL_PB2_033_ON_ENTER_WAIT_OPPONENT_ORIGINAL_HEART_THREE_ABILITY_ID,
    PL_PB2_033_LIVE_START_WAIT_OPPONENT_ORIGINAL_HEART_THREE_ABILITY_ID,
  ].map(
    (abilityId) =>
      ({
        abilityId,
        effectTextAbilityId: abilityId,
        stepId: PL_PB2_033_SELECT_OPPONENT_ORIGINAL_HEART_THREE_MEMBER_STEP_ID,
        stepText: '请选择对方舞台上1名原本持有的HEART数量小于等于3的成员变为待机状态。',
        selectionLabel: '选择要变为待机状态的成员',
        selector: typeIs(CardType.MEMBER),
        statePredicate: memberOriginalHeartLte(3),
        startActionStep: 'START_SELECT_OPPONENT_ORIGINAL_HEART_THREE_MEMBER',
        consumeStaleSelectionAsNoOp: true,
      }) satisfies OpponentWaitTargetWorkflowConfig
  ),
  {
    abilityId: PL_PB1_009_ON_ENTER_WAIT_OPPONENT_ORIGINAL_BLADE_ONE_ABILITY_ID,
    effectTextAbilityId: PL_PB1_009_ON_ENTER_WAIT_OPPONENT_ORIGINAL_BLADE_ONE_ABILITY_ID,
    stepId: PL_PB1_009_SELECT_OPPONENT_ORIGINAL_BLADE_ONE_MEMBER_STEP_ID,
    stepText: '请选择对方舞台上1名原本持有的[BLADE]数量小于等于1的成员变为待机状态。',
    selectionLabel: '选择对方舞台上原本[BLADE]小于等于1的成员',
    selector: memberPrintedBladeLte(1),
    startActionStep: 'START_SELECT_OPPONENT_ORIGINAL_BLADE_ONE_MEMBER',
  },
  {
    abilityId: HS_PB1_010_ON_ENTER_WAIT_OPPONENT_LOW_COST_MEMBER_ABILITY_ID,
    effectTextAbilityId: HS_PB1_010_ON_ENTER_WAIT_OPPONENT_LOW_COST_MEMBER_ABILITY_ID,
    stepId: HS_PB1_010_SELECT_OPPONENT_COST_FOUR_MEMBER_STEP_ID,
    stepText: '请选择对方舞台上1名费用小于等于4的成员变为待机状态。',
    selectionLabel: '选择对方舞台上费用小于等于4的成员',
    selector: costLteFourOpponentMemberSelector,
    startActionStep: 'START_SELECT_OPPONENT_COST_FOUR_MEMBER',
    minOwnStagePrintedCost: 10,
  },
  {
    abilityId: HS_PB1_010_LIVE_START_WAIT_OPPONENT_LOW_COST_MEMBER_ABILITY_ID,
    effectTextAbilityId: HS_PB1_010_LIVE_START_WAIT_OPPONENT_LOW_COST_MEMBER_ABILITY_ID,
    stepId: HS_PB1_010_SELECT_OPPONENT_COST_FOUR_MEMBER_STEP_ID,
    stepText: '请选择对方舞台上1名费用小于等于4的成员变为待机状态。',
    selectionLabel: '选择对方舞台上费用小于等于4的成员',
    selector: costLteFourOpponentMemberSelector,
    startActionStep: 'START_SELECT_OPPONENT_COST_FOUR_MEMBER',
    minOwnStagePrintedCost: 10,
    confirmNoTargetWithRealtimeText: true,
  },
  {
    abilityId: S_BP6_015_ON_ENTER_WAIT_OPPONENT_COST_TWO_MEMBER_ABILITY_ID,
    effectTextAbilityId: S_BP6_015_ON_ENTER_WAIT_OPPONENT_COST_TWO_MEMBER_ABILITY_ID,
    stepId: S_BP6_015_SELECT_OPPONENT_COST_TWO_MEMBER_STEP_ID,
    stepText: '请选择对方舞台上1名费用小于等于2的成员变为待机状态。',
    selectionLabel: '选择对方舞台上费用小于等于2的成员',
    selector: costLteTwoOpponentMemberSelector,
    startActionStep: 'START_SELECT_OPPONENT_COST_TWO_MEMBER',
  },
  {
    abilityId: N_SD2_021_ON_ENTER_WAIT_OPPONENT_COST_FOUR_MEMBER_ABILITY_ID,
    effectTextAbilityId: N_SD2_021_ON_ENTER_WAIT_OPPONENT_COST_FOUR_MEMBER_ABILITY_ID,
    stepId: N_SD2_021_SELECT_OPPONENT_COST_FOUR_MEMBER_STEP_ID,
    stepText: '请选择对方舞台上1名费用小于等于4的成员变为待机状态。',
    selectionLabel: '选择对方舞台上费用小于等于4的成员',
    selector: costLteFourOpponentMemberSelector,
    startActionStep: 'START_SELECT_OPPONENT_COST_FOUR_MEMBER',
  },
  {
    abilityId: HS_PR_038_LIVE_SUCCESS_WAIT_OPPONENT_COST_FOUR_SKIP_NEXT_ACTIVE_ABILITY_ID,
    effectTextAbilityId: HS_PR_038_LIVE_SUCCESS_WAIT_OPPONENT_COST_FOUR_SKIP_NEXT_ACTIVE_ABILITY_ID,
    stepId: HS_PR_038_SELECT_OPPONENT_COST_FOUR_MEMBER_STEP_ID,
    stepText: '请选择对方舞台上1名费用小于等于4的成员变为待机状态。',
    selectionLabel: '选择对方舞台上费用小于等于4的成员',
    selector: costLteFourOpponentMemberSelector,
    startActionStep: 'START_SELECT_OPPONENT_COST_FOUR_MEMBER_SKIP_NEXT_ACTIVE',
    confirmNoTargetWithRealtimeText: true,
    skipNextActivePhase: true,
    consumeStaleSelectionAsNoOp: true,
  },
  {
    abilityId: N_SD2_019_LIVE_START_WAIT_OPPONENT_COST_TWO_MEMBER_ABILITY_ID,
    effectTextAbilityId: N_SD2_019_LIVE_START_WAIT_OPPONENT_COST_TWO_MEMBER_ABILITY_ID,
    stepId: SP_PB2_SELECT_OPPONENT_COST_TWO_MEMBER_STEP_ID,
    stepText: '请选择对方舞台上1名费用小于等于2的成员变为待机状态。',
    selectionLabel: '选择对方舞台上费用小于等于2的成员',
    selector: costLteTwoOpponentMemberSelector,
    startActionStep: 'START_SELECT_OPPONENT_COST_TWO_MEMBER',
  },
  {
    abilityId: SP_PB2_024_ON_ENTER_WAIT_OPPONENT_COST_TWO_MEMBER_ABILITY_ID,
    effectTextAbilityId: SP_PB2_024_ON_ENTER_WAIT_OPPONENT_COST_TWO_MEMBER_ABILITY_ID,
    stepId: SP_PB2_SELECT_OPPONENT_COST_TWO_MEMBER_STEP_ID,
    stepText: '请选择对方舞台上1名费用小于等于2的成员变为待机状态。',
    selectionLabel: '选择对方舞台上费用小于等于2的成员',
    selector: costLteTwoOpponentMemberSelector,
    startActionStep: 'START_SELECT_OPPONENT_COST_TWO_MEMBER',
  },
  {
    abilityId: SP_PB2_029_ON_ENTER_WAIT_OPPONENT_COST_TWO_MEMBER_ABILITY_ID,
    effectTextAbilityId: SP_PB2_029_ON_ENTER_WAIT_OPPONENT_COST_TWO_MEMBER_ABILITY_ID,
    stepId: SP_PB2_SELECT_OPPONENT_COST_TWO_MEMBER_STEP_ID,
    stepText: '请选择对方舞台上1名费用小于等于2的成员变为待机状态。',
    selectionLabel: '选择对方舞台上费用小于等于2的成员',
    selector: costLteTwoOpponentMemberSelector,
    startActionStep: 'START_SELECT_OPPONENT_COST_TWO_MEMBER',
  },
  {
    abilityId: SP_PB2_029_LIVE_START_WAIT_OPPONENT_COST_TWO_MEMBER_ABILITY_ID,
    effectTextAbilityId: SP_PB2_029_ON_ENTER_WAIT_OPPONENT_COST_TWO_MEMBER_ABILITY_ID,
    stepId: SP_PB2_SELECT_OPPONENT_COST_TWO_MEMBER_STEP_ID,
    stepText: '请选择对方舞台上1名费用小于等于2的成员变为待机状态。',
    selectionLabel: '选择对方舞台上费用小于等于2的成员',
    selector: costLteTwoOpponentMemberSelector,
    startActionStep: 'START_SELECT_OPPONENT_COST_TWO_MEMBER',
  },
  {
    abilityId: SP_PR_021_LIVE_START_STAGE_HEART_FIVE_WAIT_OPPONENT_COST_TWO_MEMBER_ABILITY_ID,
    effectTextAbilityId:
      SP_PR_021_LIVE_START_STAGE_HEART_FIVE_WAIT_OPPONENT_COST_TWO_MEMBER_ABILITY_ID,
    stepId: SP_PB2_SELECT_OPPONENT_COST_TWO_MEMBER_STEP_ID,
    stepText: '请选择对方舞台上1名费用小于等于2的成员变为待机状态。',
    selectionLabel: '选择对方舞台上费用小于等于2的成员',
    selector: costLteTwoOpponentMemberSelector,
    startActionStep: 'START_SELECT_OPPONENT_COST_TWO_MEMBER',
    minOwnStageHeartTotal: 5,
  },
  {
    abilityId: PL_BP5_013_ON_ENTER_WAIT_OPPONENT_COST_LTE_FOUR_MEMBER_ABILITY_ID,
    effectTextAbilityId: PL_BP5_013_ON_ENTER_WAIT_OPPONENT_COST_LTE_FOUR_MEMBER_ABILITY_ID,
    stepId: PL_BP5_013_SELECT_OPPONENT_MEMBER_STEP_ID,
    stepText: '请选择对方舞台上1名费用小于等于4的成员变为待机状态。',
    selectionLabel: '选择对方舞台上费用小于等于4的成员',
    selector: costLteFourOpponentMemberSelector,
    startActionStep: 'START_SELECT_OPPONENT_COST_LTE_FOUR_MEMBER',
  },
  {
    abilityId: PB1_011_ON_ENTER_DIFFERENT_BIBI_WAIT_OPPONENT_LOW_COST_MEMBER_ABILITY_ID,
    effectTextAbilityId: PB1_011_ON_ENTER_DIFFERENT_BIBI_WAIT_OPPONENT_LOW_COST_MEMBER_ABILITY_ID,
    stepId: PL_BP5_013_SELECT_OPPONENT_MEMBER_STEP_ID,
    stepText: '请选择对方舞台上1名费用小于等于4的成员变为待机状态。',
    selectionLabel: '选择对方舞台上费用小于等于4的成员',
    selector: costLteFourOpponentMemberSelector,
    startActionStep: 'START_SELECT_OPPONENT_COST_LTE_FOUR_MEMBER',
    minOwnStageDifferentBiBiMemberNameCount: 2,
  },
  {
    abilityId: HS_BP6_004_ON_ENTER_WAIT_OPPONENT_LOW_COST_MEMBER_ABILITY_ID,
    effectTextAbilityId: HS_BP6_004_ON_ENTER_WAIT_OPPONENT_LOW_COST_MEMBER_ABILITY_ID,
    stepId: HS_BP6_004_SELECT_OPPONENT_MEMBER_STEP_ID,
    stepText: '请选择对方舞台上1名费用小于等于9的成员变为待机状态。',
    selectionLabel: '选择对方舞台上费用小于等于9的成员',
    selector: lowCostOpponentMemberSelector,
    startActionStep: 'START_SELECT_OPPONENT_MEMBER',
  },
  {
    abilityId: HS_BP6_004_LIVE_START_WAIT_OPPONENT_LOW_COST_MEMBER_ABILITY_ID,
    effectTextAbilityId: HS_BP6_004_ON_ENTER_WAIT_OPPONENT_LOW_COST_MEMBER_ABILITY_ID,
    stepId: HS_BP6_004_SELECT_OPPONENT_MEMBER_STEP_ID,
    stepText: '请选择对方舞台上1名费用小于等于9的成员变为待机状态。',
    selectionLabel: '选择对方舞台上费用小于等于9的成员',
    selector: lowCostOpponentMemberSelector,
    startActionStep: 'START_SELECT_OPPONENT_MEMBER',
  },
  {
    abilityId: SP_BP4_011_ENTER_OR_MOVE_WAIT_OPPONENT_LOW_BLADE_MEMBER_ABILITY_ID,
    effectTextAbilityId: SP_BP4_011_ENTER_OR_MOVE_WAIT_OPPONENT_LOW_BLADE_MEMBER_ABILITY_ID,
    stepId: SP_BP4_011_SELECT_OPPONENT_LOW_BLADE_MEMBER_STEP_ID,
    stepText: '请选择对方舞台上1名原本持有的 BLADE 数量小于等于3个的成员变为待机状态。',
    selectionLabel: '选择对方舞台上原本 BLADE 小于等于3的成员',
    selector: memberPrintedBladeLte(3),
    startActionStep: 'START_SELECT_OPPONENT_LOW_BLADE_MEMBER',
  },
  {
    abilityId: HS_BP6_013_ON_ENTER_WAIT_LOW_BLADE_NON_DOLLCHESTRA_ABILITY_ID,
    effectTextAbilityId: HS_BP6_013_ON_ENTER_WAIT_LOW_BLADE_NON_DOLLCHESTRA_ABILITY_ID,
    stepId: HS_BP6_013_SELECT_OPPONENT_LOW_BLADE_NON_DOLLCHESTRA_MEMBER_STEP_ID,
    stepText: '请选择对方舞台上1名原本[BLADE]小于等于3，且不是『DOLLCHESTRA』的成员变为待机状态。',
    selectionLabel: '选择对方舞台上低原本[BLADE]且非DOLLCHESTRA的成员',
    selector: lowBladeNonDollchestraOpponentMemberSelector,
    startActionStep: 'START_SELECT_OPPONENT_LOW_BLADE_NON_DOLLCHESTRA_MEMBER',
  },
  {
    abilityId: HS_BP6_013_LIVE_START_WAIT_LOW_BLADE_NON_DOLLCHESTRA_ABILITY_ID,
    effectTextAbilityId: HS_BP6_013_ON_ENTER_WAIT_LOW_BLADE_NON_DOLLCHESTRA_ABILITY_ID,
    stepId: HS_BP6_013_SELECT_OPPONENT_LOW_BLADE_NON_DOLLCHESTRA_MEMBER_STEP_ID,
    stepText: '请选择对方舞台上1名原本[BLADE]小于等于3，且不是『DOLLCHESTRA』的成员变为待机状态。',
    selectionLabel: '选择对方舞台上低原本[BLADE]且非DOLLCHESTRA的成员',
    selector: lowBladeNonDollchestraOpponentMemberSelector,
    startActionStep: 'START_SELECT_OPPONENT_LOW_BLADE_NON_DOLLCHESTRA_MEMBER',
    confirmNoTargetWithRealtimeText: true,
  },
  {
    abilityId: SP_BP7_009_LIVE_START_WAIT_LOW_PRINTED_BLADE_OPPONENT_ABILITY_ID,
    effectTextAbilityId: SP_BP7_009_LIVE_START_WAIT_LOW_PRINTED_BLADE_OPPONENT_ABILITY_ID,
    stepId: SP_BP7_009_SELECT_OPPONENT_PRINTED_BLADE_TWO_MEMBER_STEP_ID,
    stepText: '请选择对方舞台上1名原本持有的[BLADE]数量小于等于2的成员变为待机状态。',
    selectionLabel: '选择对方舞台上原本[BLADE]小于等于2的成员',
    selector: memberPrintedBladeLte(2),
    startActionStep: 'START_SELECT_OPPONENT_PRINTED_BLADE_TWO_MEMBER',
  },
  ...[
    N_SD2_013_ON_ENTER_ONLY_NIJIGASAKI_WAIT_LOW_PRINTED_BLADE_OPPONENT_ABILITY_ID,
    N_SD2_013_LIVE_START_ONLY_NIJIGASAKI_WAIT_LOW_PRINTED_BLADE_OPPONENT_ABILITY_ID,
  ].map(
    (abilityId) =>
      ({
        abilityId,
        effectTextAbilityId: abilityId,
        stepId: N_SD2_013_SELECT_OPPONENT_PRINTED_BLADE_TWO_MEMBER_STEP_ID,
        stepText: '请选择对方舞台上1名原本持有的[BLADE]数量小于等于2的成员变为待机状态。',
        selectionLabel: '选择对方舞台上原本[BLADE]小于等于2的成员',
        selector: memberPrintedBladeLte(2),
        startActionStep: 'START_SELECT_OPPONENT_PRINTED_BLADE_TWO_MEMBER',
        allOwnStageMembersGroupAlias: '虹ヶ咲',
      }) satisfies OpponentWaitTargetWorkflowConfig
  ),
];

export function registerOpponentWaitTargetWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffects;
}): void {
  for (const config of OPPONENT_WAIT_TARGET_WORKFLOWS) {
    registerPendingAbilityStarterHandler(config.abilityId, (game, ability, options, context) =>
      startOpponentWaitTargetWorkflow(
        game,
        ability,
        config,
        options,
        context.continuePendingCardEffects
      )
    );
    registerActiveEffectStepHandler(config.abilityId, config.stepId, (game, input, context) =>
      finishOpponentWaitTargetWorkflow(
        game,
        input.selectedCardId ?? null,
        config,
        context.continuePendingCardEffects,
        deps.enqueueTriggeredCardEffects
      )
    );
  }
}

function startOpponentWaitTargetWorkflow(
  game: GameState,
  ability: PendingAbilityState,
  config: OpponentWaitTargetWorkflowConfig,
  options: PendingAbilityStarterOptions,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  const opponent = player ? getOpponent(game, player.id) : null;
  if (!player || !opponent) {
    return game;
  }
  const orderedResolution = options.orderedResolution === true;

  const ownStageMemberCardIds = getStageMemberCardIdsMatching(
    game,
    player.id,
    typeIs(CardType.MEMBER)
  );
  const allOwnStageMembersMatchGroup =
    config.allOwnStageMembersGroupAlias === undefined
      ? true
      : ownStageMemberCardIds.length > 0 &&
        ownStageMemberCardIds.every((cardId) => {
          const card = game.cardRegistry.get(cardId);
          return card !== undefined && groupAliasIs(config.allOwnStageMembersGroupAlias!)(card);
        });
  if (!allOwnStageMembersMatchGroup) {
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
        ownStageMemberCardIds,
        requiredOwnStageGroupAlias: config.allOwnStageMembersGroupAlias,
        allOwnStageMembersMatchGroup,
      }),
      orderedResolution
    );
  }

  const ownStageHighPrintedCostMemberCount =
    config.minOwnStagePrintedCost === undefined
      ? 0
      : getStageMemberCardIdsMatching(
          game,
          player.id,
          and(typeIs(CardType.MEMBER), costGte(config.minOwnStagePrintedCost))
        ).length;
  if (config.minOwnStagePrintedCost !== undefined && ownStageHighPrintedCostMemberCount === 0) {
    const selectableTargetCount = getOpponentWaitTargetCount(
      game,
      opponent.id,
      config.selector,
      config.statePredicate
    );
    const confirmation =
      config.confirmNoTargetWithRealtimeText === true
        ? maybeStartConfirmablePendingAbilityConfirmation(game, ability, options, {
            effectText: getOpponentWaitNoOpConfirmationText(
              config,
              ownStageHighPrintedCostMemberCount,
              selectableTargetCount,
              false
            ),
            stepText: '确认后不处理。',
          })
        : null;
    if (confirmation) {
      return confirmation;
    }
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
        ownStageHighPrintedCostMemberCount,
        requiredOwnStagePrintedCost: config.minOwnStagePrintedCost,
        selectableTargetCount,
      }),
      orderedResolution
    );
  }

  const ownStageHeartTotal = getOwnStageEffectiveHeartTotal(game, player.id);
  if (
    config.minOwnStageHeartTotal !== undefined &&
    ownStageHeartTotal < config.minOwnStageHeartTotal
  ) {
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
        ownStageHeartTotal,
        requiredOwnStageHeartTotal: config.minOwnStageHeartTotal,
      }),
      orderedResolution
    );
  }

  const ownStageDifferentBiBiMemberNameCount = getOwnStageDifferentBiBiMemberNameCount(
    game,
    player.id
  );
  if (
    config.minOwnStageDifferentBiBiMemberNameCount !== undefined &&
    ownStageDifferentBiBiMemberNameCount < config.minOwnStageDifferentBiBiMemberNameCount
  ) {
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
        ownStageDifferentBiBiMemberNameCount,
        requiredOwnStageDifferentBiBiMemberNameCount:
          config.minOwnStageDifferentBiBiMemberNameCount,
      }),
      orderedResolution
    );
  }

  const targetSelection = createStageMemberOrientationTargetSelection(game, {
    ability,
    effectText: getAbilityEffectText(config.effectTextAbilityId),
    stepId: config.stepId,
    stepText: config.stepText,
    awaitingPlayerId: player.id,
    targetPlayerId: opponent.id,
    selector: config.selector,
    statePredicate: config.statePredicate,
    targetOrientation: OrientationState.WAITING,
    selectionLabel: config.selectionLabel,
    confirmSelectionLabel: '变为待机状态',
    orderedResolution,
    metadata: {
      sourceSlot: ability.sourceSlot,
    },
  });

  if (targetSelection.activeEffect === null) {
    if (config.confirmNoTargetWithRealtimeText === true) {
      const confirmation = maybeStartConfirmablePendingAbilityConfirmation(game, ability, options, {
        effectText: getOpponentWaitNoOpConfirmationText(
          config,
          ownStageHighPrintedCostMemberCount,
          targetSelection.selectableCardIds.length,
          true
        ),
        stepText: `当前合法目标${targetSelection.selectableCardIds.length}名，确认后不处理。`,
      });
      if (confirmation) {
        return confirmation;
      }
    }

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
      orderedResolution
    );
  }

  return addAction(
    {
      ...game,
      pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
      activeEffect: targetSelection.activeEffect,
    },
    'RESOLVE_ABILITY',
    player.id,
    {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: config.startActionStep,
      sourceSlot: ability.sourceSlot,
      targetPlayerId: opponent.id,
      selectableCardIds: targetSelection.selectableCardIds,
    }
  );
}

function finishOpponentWaitTargetWorkflow(
  game: GameState,
  selectedCardId: string | null,
  config: OpponentWaitTargetWorkflowConfig,
  continuePendingCardEffects: ContinuePendingCardEffects,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffects
): GameState {
  const effect = game.activeEffect;
  if (!effect) {
    return game;
  }
  if (!selectedCardId || effect.selectableCardIds?.includes(selectedCardId) !== true) {
    return game;
  }

  const player = getPlayerById(game, effect.controllerId);
  const targetMetadata = getStageMemberOrientationTargetMetadata(effect);
  if (!player || !targetMetadata) {
    return game;
  }

  const currentTarget = getPlayerById(game, targetMetadata.targetPlayerId);
  const currentTargetState = currentTarget?.memberSlots.cardStates.get(selectedCardId);
  const currentMatchingTargetIds = getStageMemberCardIdsMatching(
    game,
    targetMetadata.targetPlayerId,
    config.selector,
    config.statePredicate
  );
  const currentSelectionIsLegal =
    currentTargetState !== undefined &&
    currentTargetState.orientation !== targetMetadata.targetOrientation &&
    currentMatchingTargetIds.includes(selectedCardId);
  const orientationChange = currentSelectionIsLegal
    ? resolveStageMemberOrientationTargetSelection(game, effect, selectedCardId)
    : null;
  if (!orientationChange || !orientationChange.changed) {
    if (config.consumeStaleSelectionAsNoOp === true) {
      return continuePendingCardEffects(
        addAction(
          {
            ...game,
            activeEffect: null,
          },
          'RESOLVE_ABILITY',
          player.id,
          {
            pendingAbilityId: effect.id,
            abilityId: effect.abilityId,
            sourceCardId: effect.sourceCardId,
            step: 'STALE_TARGET_NO_OP',
            sourceSlot: effect.metadata?.sourceSlot,
            targetPlayerId: targetMetadata.targetPlayerId,
            targetCardId: selectedCardId,
            currentSelectionIsLegal,
            orientationChangeBlockedByWaitingProtection:
              orientationChange?.blockedByWaitingProtection ?? false,
            skipNextActivePhase: config.skipNextActivePhase === true,
            skipMarkerApplied: false,
          }
        ),
        effect.metadata?.orderedResolution === true
      );
    }
    return game;
  }

  const stateWithActivePhaseSkip =
    config.skipNextActivePhase === true
      ? addMemberActivePhaseSkip(orientationChange.gameState, {
          playerId: targetMetadata.targetPlayerId,
          memberCardId: selectedCardId,
          sourceCardId: effect.sourceCardId,
          abilityId: effect.abilityId,
        })
      : orientationChange.gameState;

  const stateWithMemberStateTriggers = enqueueMemberStateChangedTriggersFromOrientationResult(
    game,
    {
      ...orientationChange,
      gameState: stateWithActivePhaseSkip,
    },
    enqueueTriggeredCardEffects,
    {
      prepareGameStateBeforeEnqueue: (state, result) =>
        addAction(
          {
            ...state,
            activeEffect: null,
          },
          'RESOLVE_ABILITY',
          player.id,
          {
            pendingAbilityId: effect.id,
            abilityId: effect.abilityId,
            sourceCardId: effect.sourceCardId,
            step: 'WAIT_OPPONENT_MEMBER',
            sourceSlot: effect.metadata?.sourceSlot,
            targetPlayerId: targetMetadata.targetPlayerId,
            targetCardId: selectedCardId,
            previousOrientation: result.previousOrientation,
            nextOrientation: result.nextOrientation,
            skipNextActivePhase: config.skipNextActivePhase === true,
            skipNextActivePlayerId:
              config.skipNextActivePhase === true ? targetMetadata.targetPlayerId : undefined,
            skipNextActiveMemberCardId:
              config.skipNextActivePhase === true ? selectedCardId : undefined,
          }
        ),
    }
  );
  return continuePendingCardEffects(
    stateWithMemberStateTriggers.gameState,
    effect.metadata?.orderedResolution === true
  );
}

function getOwnStageEffectiveHeartTotal(game: GameState, playerId: string): number {
  const liveModifiers = collectLiveModifiers(game);
  return getStageMemberCardIdsMatching(game, playerId, typeIs(CardType.MEMBER))
    .flatMap((cardId) => getMemberEffectiveHeartIcons(game, playerId, cardId, liveModifiers))
    .reduce((total, heart) => total + heart.count, 0);
}

function getOwnStageDifferentBiBiMemberNameCount(game: GameState, playerId: string): number {
  return selectDifferentNamedCards(
    getStageMemberCardIdsMatching(
      game,
      playerId,
      and(typeIs(CardType.MEMBER), unitAliasIs('BiBi'))
    ),
    (cardId) => game.cardRegistry.get(cardId)?.data,
    { minCount: 1 }
  ).length;
}

function getOpponentWaitTargetCount(
  game: GameState,
  opponentId: string,
  selector: CardSelector,
  statePredicate?: StageMemberStatePredicate
): number {
  const opponent = getPlayerById(game, opponentId);
  return getStageMemberCardIdsMatching(game, opponentId, selector, statePredicate).filter(
    (cardId) =>
      opponent?.memberSlots.cardStates.get(cardId)?.orientation !== OrientationState.WAITING
  ).length;
}

function getOpponentWaitNoOpConfirmationText(
  config: OpponentWaitTargetWorkflowConfig,
  ownStageHighPrintedCostMemberCount: number,
  selectableTargetCount: number,
  conditionMet: boolean
): string {
  if (config.minOwnStagePrintedCost !== undefined) {
    return (
      getAbilityEffectText(config.effectTextAbilityId) +
      '（当前己方舞台费用大于等于' +
      config.minOwnStagePrintedCost +
      '的成员' +
      ownStageHighPrintedCostMemberCount +
      '名，对方可选择目标' +
      selectableTargetCount +
      '名；' +
      (conditionMet
        ? '没有可选择的目标，不会将成员变为待机状态。'
        : '条件未满足，不会将成员变为待机状态。') +
      '）'
    );
  }

  return (
    getAbilityEffectText(config.effectTextAbilityId) +
    '（当前合法目标' +
    selectableTargetCount +
    '名；未满足目标条件，不会将成员变为待机状态。）'
  );
}
