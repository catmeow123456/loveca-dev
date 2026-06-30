import {
  addAction,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { OrientationState } from '../../../../shared/types/enums.js';
import { PL_BP3_014_ON_ENTER_LOOK_TOP_TWO_ARRANGE_TO_TOP_ABILITY_ID } from '../../ability-ids.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import {
  getAbilityEffectText,
  recordPayCostAction,
} from '../../runtime/workflow-helpers.js';
import { payImmediateEffectCosts } from '../../../effects/effect-costs.js';
import {
  finishArrangeInspectedDeckTopWorkflow,
  startArrangeInspectedDeckTopWorkflow,
} from './arrange-inspected-deck-top.js';

const DECLINE_OPTION_LABEL = '不发动';
const PL_BP3_014_ON_ENTER_OPTION_STEP_ID = 'PL_BP3_014_ON_ENTER_OPTION';
const PL_BP3_014_ON_ENTER_ARRANGE_STEP_ID = 'PL_BP3_014_ON_ENTER_ARRANGE_TOP_TWO';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerPlBp3014RinWorkflowHandlers(): void {
  registerPendingAbilityStarterHandler(
    PL_BP3_014_ON_ENTER_LOOK_TOP_TWO_ARRANGE_TO_TOP_ABILITY_ID,
    (game, ability, options) =>
      startPlBp3014RinOptionWorkflow(game, ability, options.orderedResolution === true)
  );
  registerActiveEffectStepHandler(
    PL_BP3_014_ON_ENTER_LOOK_TOP_TWO_ARRANGE_TO_TOP_ABILITY_ID,
    PL_BP3_014_ON_ENTER_OPTION_STEP_ID,
    (game, input, context) => {
      if (input.selectedOptionId === 'decline') {
        return finishPlBp3014RinDeclineWorkflow(game, context.continuePendingCardEffects);
      }
      return input.selectedOptionId === 'activate'
        ? finishPlBp3014RinActivateWorkflow(game, context.continuePendingCardEffects)
        : game;
    }
  );
  registerActiveEffectStepHandler(
    PL_BP3_014_ON_ENTER_LOOK_TOP_TWO_ARRANGE_TO_TOP_ABILITY_ID,
    PL_BP3_014_ON_ENTER_ARRANGE_STEP_ID,
    (game, input, context) =>
      finishArrangeInspectedDeckTopWorkflow(
        game,
        input.selectedCardIds ?? [],
        context.continuePendingCardEffects
      )
  );
}

function startPlBp3014RinOptionWorkflow(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  return {
    ...game,
    activeEffect: {
      id: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      controllerId: ability.controllerId,
      effectText: getAbilityEffectText(PL_BP3_014_ON_ENTER_LOOK_TOP_TWO_ARRANGE_TO_TOP_ABILITY_ID),
      stepId: PL_BP3_014_ON_ENTER_OPTION_STEP_ID,
      stepText: '可以将此成员变为待机状态：检视卡组顶2张并调整卡组顶。',
      awaitingPlayerId: player.id,
      selectableOptions: [
        { id: 'activate', label: '发动' },
        { id: 'decline', label: DECLINE_OPTION_LABEL },
      ],
      metadata: {
        orderedResolution,
      },
    },
  };
}

function finishPlBp3014RinDeclineWorkflow(
  game: GameState,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !== PL_BP3_014_ON_ENTER_LOOK_TOP_TWO_ARRANGE_TO_TOP_ABILITY_ID ||
    effect.stepId !== PL_BP3_014_ON_ENTER_OPTION_STEP_ID
  ) {
    return game;
  }
  const player = getPlayerById(game, effect.controllerId);
  if (!player) {
    return game;
  }

  const state = {
    ...game,
    pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== effect.id),
    activeEffect: null,
  };
  return continuePendingCardEffects(
    addAction(state, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'SKIP',
    }),
    effect.metadata?.orderedResolution === true
  );
}

function finishPlBp3014RinActivateWorkflow(
  game: GameState,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !== PL_BP3_014_ON_ENTER_LOOK_TOP_TWO_ARRANGE_TO_TOP_ABILITY_ID ||
    effect.stepId !== PL_BP3_014_ON_ENTER_OPTION_STEP_ID
  ) {
    return game;
  }
  const player = getPlayerById(game, effect.controllerId);
  const pendingAbility = game.pendingAbilities.find(
    (ability) =>
      ability.id === effect.id &&
      ability.abilityId === effect.abilityId &&
      ability.sourceCardId === effect.sourceCardId
  );
  if (!player || !pendingAbility) {
    return game;
  }

  const sourceWaitPayment = payImmediateEffectCosts(game, player.id, pendingAbility.sourceCardId, [
    { kind: 'SET_SOURCE_MEMBER_ORIENTATION', orientation: OrientationState.WAITING },
  ]);
  if (!sourceWaitPayment) {
    return game;
  }

  const stateAfterCost = recordPayCostAction(sourceWaitPayment.gameState, player.id, {
    pendingAbilityId: pendingAbility.id,
    abilityId: pendingAbility.abilityId,
    sourceCardId: pendingAbility.sourceCardId,
    sourceSlot: sourceWaitPayment.sourceSlot,
    orientedMemberCardIds: sourceWaitPayment.orientedMemberCardIds,
  });

  return startArrangeInspectedDeckTopWorkflow(
    { ...stateAfterCost, activeEffect: null },
    {
      ability: pendingAbility,
      playerId: player.id,
      effectText: getAbilityEffectText(PL_BP3_014_ON_ENTER_LOOK_TOP_TWO_ARRANGE_TO_TOP_ABILITY_ID),
      inspectCount: 2,
      stepId: PL_BP3_014_ON_ENTER_ARRANGE_STEP_ID,
      stepText: '请检视卡组顶2张。选择任意张数的卡牌按顺序放置于卡组顶，其余的卡牌放入休息室。',
      selectionLabel: '选择要放回卡组顶的卡牌',
      selectMin: 0,
      selectMax: 2,
      selectedDestination: 'MAIN_DECK_TOP',
      unselectedDestination: 'WAITING_ROOM',
      orderedResolution: effect.metadata?.orderedResolution === true,
    },
    continuePendingCardEffects
  );
}
