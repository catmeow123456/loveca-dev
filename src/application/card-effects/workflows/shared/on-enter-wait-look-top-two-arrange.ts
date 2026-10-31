import {
  addAction,
  getPlayerById,
  type ActiveEffectState,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { OrientationState } from '../../../../shared/types/enums.js';
import {
  PL_BP3_014_ON_ENTER_LOOK_TOP_TWO_ARRANGE_TO_TOP_ABILITY_ID,
  HS_BP8_015_ON_ENTER_WAIT_LOOK_TOP_TWO_ARRANGE_ABILITY_ID,
} from '../../ability-ids.js';
import type { EnqueueTriggeredCardEffectsForEnterWaitingRoom } from '../../runtime/enter-waiting-room-triggers.js';
import {
  enqueueMemberStateChangedTriggersFromOrientationResult,
  type EnqueueTriggeredCardEffectsForMemberStateChanged,
} from '../../runtime/member-state-changed-triggers.js';
import { getPendingAbilitySourceLifecycleId } from '../../runtime/ability-source-lifecycle.js';
import { isCurrentStageMemberAbilitySource } from '../../runtime/source-member.js';
import { isAbilityActivationCostWaived } from '../../runtime/on-enter-ability-invocation.js';
import { startPendingActiveEffect } from '../../runtime/active-effect.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { queryCardSelection, queryOptionSelection } from '../../runtime/selection-query.js';
import { getAbilityEffectText, recordPayCostAction } from '../../runtime/workflow-helpers.js';
import { payImmediateEffectCosts } from '../../../effects/effect-costs.js';
import {
  finishArrangeInspectedDeckEdgeWorkflow,
  startArrangeInspectedDeckEdgeWorkflow,
} from './arrange-inspected-deck-edge.js';

type Continue = (game: GameState, orderedResolution: boolean) => GameState;
interface Config {
  readonly abilityId: string;
  readonly optionStepId: string;
  readonly arrangeStepId: string;
}
const CONFIGS: readonly Config[] = [
  {
    abilityId: PL_BP3_014_ON_ENTER_LOOK_TOP_TWO_ARRANGE_TO_TOP_ABILITY_ID,
    optionStepId: 'PL_BP3_014_ON_ENTER_OPTION',
    arrangeStepId: 'PL_BP3_014_ON_ENTER_ARRANGE_TOP_TWO',
  },
  {
    abilityId: HS_BP8_015_ON_ENTER_WAIT_LOOK_TOP_TWO_ARRANGE_ABILITY_ID,
    optionStepId: 'HS_BP8_015_ON_ENTER_OPTION',
    arrangeStepId: 'HS_BP8_015_ON_ENTER_ARRANGE_TOP_TWO',
  },
];

export function registerPlBp3014RinWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom &
    EnqueueTriggeredCardEffectsForMemberStateChanged;
}): void {
  for (const config of CONFIGS) {
    registerPendingAbilityStarterHandler(config.abilityId, (game, ability, options, context) => {
      if (isAbilityActivationCostWaived(ability))
        return arrange(
          game,
          ability,
          config,
          options.orderedResolution === true,
          context.continuePendingCardEffects,
          true
        );
      const sourceLifecycleId = getPendingAbilitySourceLifecycleId(game, ability);
      const canPay = canWaitSource(game, { ...ability, sourceLifecycleId });
      return startPendingActiveEffect(game, {
        ability,
        playerId: ability.controllerId,
        activeEffect: {
          id: ability.id,
          abilityId: ability.abilityId,
          sourceCardId: ability.sourceCardId,
          sourceLifecycleId,
          controllerId: ability.controllerId,
          effectText: getAbilityEffectText(config.abilityId),
          stepId: config.optionStepId,
          stepText: canPay
            ? '可以将此成员变为待机状态，检视卡组顶2张并调整卡组顶。'
            : '当前无法支付“将此成员变为待机状态”的费用，可以不发动。',
          awaitingPlayerId: ability.controllerId,
          selectableOptions: canPay ? [{ id: 'activate', label: '发动' }] : [],
          canSkipSelection: true,
          skipSelectionLabel: '不发动',
          metadata: { orderedResolution: options.orderedResolution === true },
        },
        actionPayload: {
          sourceCardId: ability.sourceCardId,
          step: 'START_SOURCE_ORIENTATION_OPTION',
        },
      });
    });
    registerActiveEffectStepHandler(
      config.abilityId,
      config.optionStepId,
      (game, input, context) => {
        const effect = game.activeEffect!;
        if (input.selectedOptionId == null)
          return finish(game, effect, context.continuePendingCardEffects, 'SKIP');
        if (input.selectedOptionId !== 'activate') return game;
        if (!canWaitSource(game, effect))
          return finish(game, effect, context.continuePendingCardEffects, 'SOURCE_COST_UNPAYABLE');
        const payment = payImmediateEffectCosts(game, effect.controllerId, effect.sourceCardId, [
          { kind: 'SET_SOURCE_MEMBER_ORIENTATION', orientation: OrientationState.WAITING },
        ]);
        if (!payment)
          return finish(game, effect, context.continuePendingCardEffects, 'SOURCE_COST_UNPAYABLE');
        const withTriggers = enqueueMemberStateChangedTriggersFromOrientationResult(
          game,
          payment,
          deps.enqueueTriggeredCardEffects,
          {
            prepareGameStateBeforeEnqueue: (state, result) =>
              recordPayCostAction(state, effect.controllerId, {
                pendingAbilityId: effect.id,
                abilityId: effect.abilityId,
                sourceCardId: effect.sourceCardId,
                sourceSlot: result.sourceSlot,
                orientedMemberCardIds: result.orientedMemberCardIds,
              }),
          }
        );
        const ability: PendingAbilityState = {
          id: effect.id,
          abilityId: effect.abilityId,
          sourceCardId: effect.sourceCardId,
          controllerId: effect.controllerId,
          sourceLifecycleId: effect.sourceLifecycleId,
          onEnterInvocation: effect.onEnterInvocation,
          mandatory: true,
          timingId: 'ON_ENTER_STAGE',
          eventIds: [],
        };
        return arrange(
          { ...withTriggers.gameState, activeEffect: null },
          ability,
          config,
          effect.metadata?.orderedResolution === true,
          context.continuePendingCardEffects,
          false
        );
      },
      queryOptionSelection
    );
    registerActiveEffectStepHandler(
      config.abilityId,
      config.arrangeStepId,
      (game, input, context) =>
        finishArrangeInspectedDeckEdgeWorkflow(
          game,
          input.selectedCardIds ?? [],
          context.continuePendingCardEffects,
          deps.enqueueTriggeredCardEffects
        ),
      queryCardSelection
    );
  }
}

function canWaitSource(
  game: GameState,
  source: Pick<ActiveEffectState, 'controllerId' | 'sourceCardId' | 'sourceLifecycleId'>
): boolean {
  return (
    isCurrentStageMemberAbilitySource(game, source) &&
    getPlayerById(game, source.controllerId)?.memberSlots.cardStates.get(source.sourceCardId)
      ?.orientation === OrientationState.ACTIVE
  );
}

function arrange(
  game: GameState,
  ability: PendingAbilityState,
  config: Config,
  ordered: boolean,
  next: Continue,
  waived: boolean
): GameState {
  return startArrangeInspectedDeckEdgeWorkflow(
    game,
    {
      ability,
      playerId: ability.controllerId,
      effectText: getAbilityEffectText(config.abilityId),
      inspectCount: 2,
      requestedInspectCount: 2,
      sourceActionLabel: '登场',
      ...(waived ? {} : { sourceOrientationCost: 'WAITING' as const }),
      stepId: config.arrangeStepId,
      stepText: '选择任意张数的卡片，按卡组顶从上到下的顺序排列；其余卡片放置入休息室。',
      selectionLabel: '按放置顺序选择卡片',
      confirmSelectionLabel: '按此顺序放置于卡组顶',
      selectMin: 0,
      selectMax: 2,
      selectedDestination: 'MAIN_DECK_TOP',
      unselectedDestination: 'WAITING_ROOM',
      orderedResolution: ordered,
    },
    next
  );
}

function finish(
  game: GameState,
  effect: ActiveEffectState,
  next: Continue,
  step: string
): GameState {
  return next(
    addAction({ ...game, activeEffect: null }, 'RESOLVE_ABILITY', effect.controllerId, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step,
    }),
    effect.metadata?.orderedResolution === true
  );
}
