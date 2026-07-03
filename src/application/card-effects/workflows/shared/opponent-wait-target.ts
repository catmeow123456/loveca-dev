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
import { CardType, OrientationState } from '../../../../shared/types/enums.js';
import {
  HS_BP6_004_LIVE_START_WAIT_OPPONENT_LOW_COST_MEMBER_ABILITY_ID,
  HS_BP6_004_ON_ENTER_WAIT_OPPONENT_LOW_COST_MEMBER_ABILITY_ID,
  HS_BP6_013_LIVE_START_WAIT_LOW_BLADE_NON_DOLLCHESTRA_ABILITY_ID,
  HS_BP6_013_ON_ENTER_WAIT_LOW_BLADE_NON_DOLLCHESTRA_ABILITY_ID,
  PB1_011_ON_ENTER_DIFFERENT_BIBI_WAIT_OPPONENT_LOW_COST_MEMBER_ABILITY_ID,
  PL_BP5_013_ON_ENTER_WAIT_OPPONENT_COST_LTE_FOUR_MEMBER_ABILITY_ID,
  S_BP6_015_ON_ENTER_WAIT_OPPONENT_COST_TWO_MEMBER_ABILITY_ID,
  SP_PR_021_LIVE_START_STAGE_HEART_FIVE_WAIT_OPPONENT_COST_TWO_MEMBER_ABILITY_ID,
  SP_BP4_011_ENTER_OR_MOVE_WAIT_OPPONENT_LOW_BLADE_MEMBER_ABILITY_ID,
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
  costLte,
  memberPrintedBladeLte,
  normalizeCardName,
  not,
  type CardSelector,
  typeIs,
  unitAliasIs,
} from '../../../effects/card-selectors.js';
import {
  createStageMemberOrientationTargetSelection,
  getStageMemberOrientationTargetMetadata,
  resolveStageMemberOrientationTargetSelection,
} from '../../../effects/stage-member-target-selection.js';
import { getStageMemberCardIdsMatching } from '../../../effects/stage-targets.js';

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

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;
type EnqueueTriggeredCardEffects = EnqueueTriggeredCardEffectsForMemberStateChanged;

interface OpponentWaitTargetWorkflowConfig {
  readonly abilityId: string;
  readonly effectTextAbilityId: string;
  readonly stepId: string;
  readonly stepText: string;
  readonly selectionLabel: string;
  readonly selector: CardSelector;
  readonly startActionStep: string;
  readonly minOwnStageHeartTotal?: number;
  readonly minOwnStageDifferentBiBiMemberNameCount?: number;
  readonly confirmNoTargetWithRealtimeText?: boolean;
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
    targetOrientation: OrientationState.WAITING,
    selectionLabel: config.selectionLabel,
    orderedResolution,
    metadata: {
      sourceSlot: ability.sourceSlot,
    },
  });

  if (targetSelection.activeEffect === null) {
    if (config.confirmNoTargetWithRealtimeText === true) {
      const opponentStageMemberCount = getStageMemberCardIdsMatching(
        game,
        opponent.id,
        typeIs(CardType.MEMBER)
      ).length;
      const confirmation = maybeStartConfirmablePendingAbilityConfirmation(game, ability, options, {
        effectText: `${getAbilityEffectText(
          config.effectTextAbilityId
        )}（当前对方舞台成员${opponentStageMemberCount}名，符合“原本[BLADE]≤3、非DOLLCHESTRA、当前非待机”的目标${targetSelection.selectableCardIds.length}名；未满足目标条件，不会将成员变为待机状态。）`,
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

  const orientationChange = resolveStageMemberOrientationTargetSelection(
    game,
    effect,
    selectedCardId
  );
  if (!orientationChange) {
    return game;
  }

  const stateWithMemberStateTriggers = enqueueMemberStateChangedTriggersFromOrientationResult(
    game,
    orientationChange,
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
  const bibiMemberNames = getStageMemberCardIdsMatching(
    game,
    playerId,
    and(typeIs(CardType.MEMBER), unitAliasIs('BiBi'))
  )
    .map((cardId) => getCardName(game, cardId))
    .filter((name): name is string => name !== null)
    .map((name) => normalizeCardName(name))
    .filter((name) => name.length > 0);

  return new Set(bibiMemberNames).size;
}

function getCardName(game: GameState, cardId: string): string | null {
  return game.cardRegistry.get(cardId)?.data.name ?? null;
}
