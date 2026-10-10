import {
  addAction,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { addMemberCostLiveModifierForMember } from '../../../../domain/rules/live-modifiers.js';
import { getMemberEffectiveCost } from '../../../../domain/rules/member-effective-cost.js';
import { OrientationState } from '../../../../shared/types/enums.js';
import { setMemberOrientation } from '../../../effects/member-state.js';
import { HS_BP8_002_LIVE_START_DISCARD_GAIN_COST_ACTIVATE_DRAW_ABILITY_ID as ABILITY_ID } from '../../ability-ids.js';
import {
  createOptionalDiscardHandToWaitingRoomActiveEffect,
  finishSkippedActiveEffect,
  startPendingActiveEffect,
} from '../../runtime/active-effect.js';
import { drawCardsForPlayer } from '../../runtime/actions.js';
import { getPendingAbilitySourceLifecycleId } from '../../runtime/ability-source-lifecycle.js';
import {
  discardOneHandCardToWaitingRoomAndEnqueueTriggers,
  type EnqueueTriggeredCardEffectsForEnterWaitingRoom,
} from '../../runtime/enter-waiting-room-triggers.js';
import {
  enqueueMemberStateChangedTriggersFromOrientationResult,
  type EnqueueTriggeredCardEffectsForMemberStateChanged,
} from '../../runtime/member-state-changed-triggers.js';
import { isCurrentStageMemberAbilitySource } from '../../runtime/source-member.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { queryCardSelection } from '../../runtime/selection-query.js';
import { getAbilityEffectText, recordPayCostAction } from '../../runtime/workflow-helpers.js';

const DISCARD_STEP = 'HS_BP8_002_DISCARD_FOR_COST_ACTIVATE_DRAW';
type Continue = (game: GameState, orderedResolution: boolean) => GameState;
type Enqueue = EnqueueTriggeredCardEffectsForEnterWaitingRoom &
  EnqueueTriggeredCardEffectsForMemberStateChanged;

export function registerHsBp8002SayakaWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: Enqueue;
}): void {
  registerPendingAbilityStarterHandler(ABILITY_ID, (game, ability, options, context) => {
    const player = getPlayerById(game, ability.controllerId);
    if (!player) return game;
    if (player.hand.cardIds.length === 0) {
      return context.continuePendingCardEffects(
        addAction(
          {
            ...game,
            pendingAbilities: game.pendingAbilities.filter((pending) => pending.id !== ability.id),
          },
          'RESOLVE_ABILITY',
          player.id,
          {
            pendingAbilityId: ability.id,
            abilityId: ability.abilityId,
            sourceCardId: ability.sourceCardId,
            step: 'NO_HAND_FOR_COST',
          }
        ),
        options.orderedResolution === true
      );
    }
    return start(game, ability, options.orderedResolution === true);
  });
  registerActiveEffectStepHandler(
    ABILITY_ID,
    DISCARD_STEP,
    (game, input, context) =>
      input.selectedCardId
        ? finish(
            game,
            input.selectedCardId,
            context.continuePendingCardEffects,
            deps.enqueueTriggeredCardEffects
          )
        : finishSkippedActiveEffect(game, context.continuePendingCardEffects),
    queryCardSelection
  );
}

function start(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean
): GameState {
  const player = getPlayerById(game, ability.controllerId)!;
  return startPendingActiveEffect(game, {
    ability,
    playerId: player.id,
    activeEffect: {
      ...createOptionalDiscardHandToWaitingRoomActiveEffect({
        ability,
        playerId: player.id,
        effectText: getAbilityEffectText(ABILITY_ID),
        stepId: DISCARD_STEP,
        selectableCardIds: player.hand.cardIds,
        orderedResolution,
      }),
      sourceLifecycleId: getPendingAbilitySourceLifecycleId(game, ability),
    },
    actionPayload: {
      sourceCardId: ability.sourceCardId,
      step: 'SELECT_DISCARD_FOR_COST_ACTIVATE_DRAW',
    },
  });
}

function finish(
  game: GameState,
  discardCardId: string,
  continuation: Continue,
  enqueue: Enqueue
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !== ABILITY_ID ||
    effect.stepId !== DISCARD_STEP ||
    !effect.selectableCardIds?.includes(discardCardId)
  )
    return game;
  const player = getPlayerById(game, effect.controllerId);
  if (!player || !player.hand.cardIds.includes(discardCardId)) return game;
  const discarded = discardOneHandCardToWaitingRoomAndEnqueueTriggers(
    game,
    player.id,
    discardCardId,
    { candidateCardIds: effect.selectableCardIds },
    enqueue
  );
  if (!discarded) return game;

  // The hand cost remains legal after the source leaves; self-effects cannot transfer to a new object.
  let state = recordPayCostAction(discarded.gameState, player.id, {
    pendingAbilityId: effect.id,
    abilityId: ABILITY_ID,
    sourceCardId: effect.sourceCardId,
    discardedHandCardIds: discarded.discardedCardIds,
  });
  let effectiveCost: number | null = null;
  let conditionMet = false;
  let activated = false;
  let drawnCardIds: readonly string[] = [];
  if (isCurrentStageMemberAbilitySource(state, effect)) {
    const cost = addMemberCostLiveModifierForMember(state, {
      playerId: player.id,
      memberCardId: effect.sourceCardId,
      sourceCardId: effect.sourceCardId,
      abilityId: ABILITY_ID,
      countDelta: 5,
    });
    if (cost) {
      state = cost.gameState;
      effectiveCost = getMemberEffectiveCost(state, player.id, effect.sourceCardId);
      conditionMet = effectiveCost >= 20;
      if (conditionMet) {
        const orientation = setMemberOrientation(
          state,
          player.id,
          effect.sourceCardId,
          OrientationState.ACTIVE,
          {
            kind: 'CARD_EFFECT',
            playerId: player.id,
            sourceCardId: effect.sourceCardId,
            abilityId: ABILITY_ID,
            pendingAbilityId: effect.id,
          }
        );
        if (orientation) {
          activated = orientation.changed;
          state = enqueueMemberStateChangedTriggersFromOrientationResult(
            state,
            orientation,
            enqueue
          ).gameState;
        }
        const draw = drawCardsForPlayer(state, player.id, 1);
        if (draw) {
          state = draw.gameState;
          drawnCardIds = draw.drawnCardIds;
        }
      }
    }
  }
  return continuation(
    addAction({ ...state, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: ABILITY_ID,
      sourceCardId: effect.sourceCardId,
      step: 'DISCARD_GAIN_COST_CONDITIONAL_ACTIVATE_DRAW',
      discardedCardId: discardCardId,
      effectiveCost,
      conditionMet,
      activated,
      drawnCardIds,
    }),
    effect.metadata?.orderedResolution === true
  );
}
