import {
  addAction,
  getOpponent,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { CardType, OrientationState } from '../../../../shared/types/enums.js';
import {
  HS_BP6_004_LIVE_START_WAIT_OPPONENT_LOW_COST_MEMBER_ABILITY_ID,
  HS_BP6_004_ON_ENTER_WAIT_OPPONENT_LOW_COST_MEMBER_ABILITY_ID,
  PL_BP5_013_ON_ENTER_WAIT_OPPONENT_COST_LTE_FOUR_MEMBER_ABILITY_ID,
  SP_BP4_011_ENTER_OR_MOVE_WAIT_OPPONENT_LOW_BLADE_MEMBER_ABILITY_ID,
} from '../../ability-ids.js';
import {
  enqueueMemberStateChangedTriggersFromOrientationResult,
  type EnqueueTriggeredCardEffectsForMemberStateChanged,
} from '../../runtime/member-state-changed-triggers.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText } from '../../runtime/workflow-helpers.js';
import {
  and,
  costLte,
  memberPrintedBladeLte,
  type CardSelector,
  typeIs,
} from '../../../effects/card-selectors.js';
import {
  createStageMemberOrientationTargetSelection,
  getStageMemberOrientationTargetMetadata,
  resolveStageMemberOrientationTargetSelection,
} from '../../../effects/stage-member-target-selection.js';

const HS_BP6_004_SELECT_OPPONENT_MEMBER_STEP_ID = 'HS_BP6_004_SELECT_OPPONENT_MEMBER_TO_WAIT';
const PL_BP5_013_SELECT_OPPONENT_MEMBER_STEP_ID = 'PL_BP5_013_SELECT_OPPONENT_MEMBER_TO_WAIT';
const SP_BP4_011_SELECT_OPPONENT_LOW_BLADE_MEMBER_STEP_ID =
  'SP_BP4_011_SELECT_OPPONENT_LOW_BLADE_MEMBER_TO_WAIT';

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
}

const lowCostOpponentMemberSelector = and(typeIs(CardType.MEMBER), costLte(9));
const costLteFourOpponentMemberSelector = and(typeIs(CardType.MEMBER), costLte(4));

const OPPONENT_WAIT_TARGET_WORKFLOWS: readonly OpponentWaitTargetWorkflowConfig[] = [
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
        options.orderedResolution === true,
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
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  const opponent = player ? getOpponent(game, player.id) : null;
  if (!player || !opponent) {
    return game;
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
