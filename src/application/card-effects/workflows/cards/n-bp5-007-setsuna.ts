import {
  addAction,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { findMemberSlot } from '../../../../domain/entities/player.js';
import { addHeartLiveModifierForMember } from '../../../../domain/rules/live-modifiers.js';
import { HeartColor } from '../../../../shared/types/enums.js';
import { getRemainingHeartTotalCount } from '../../../effects/remaining-hearts.js';
import {
  PL_N_BP5_007_LIVE_START_EQUAL_SUCCESS_ZONES_GAIN_RED_HEART_ABILITY_ID,
  PL_N_BP5_007_LIVE_SUCCESS_REMAINING_HEART_DRAW_TWO_DISCARD_ONE_ABILITY_ID,
} from '../../ability-ids.js';
import type { EnqueueTriggeredCardEffectsForEnterWaitingRoom } from '../../runtime/enter-waiting-room-triggers.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { getAbilityEffectText } from '../../runtime/workflow-helpers.js';
import {
  finishDrawThenDiscardCardsWorkflow,
  startDrawThenDiscardCardsWorkflow,
} from '../shared/draw-then-discard.js';

const LIVE_SUCCESS_SELECT_DISCARD_STEP_ID =
  'PL_N_BP5_007_LIVE_SUCCESS_SELECT_DISCARD_AFTER_DRAW';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerNBp5007SetsunaWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom;
}): void {
  registerPendingAbilityStarterHandler(
    PL_N_BP5_007_LIVE_START_EQUAL_SUCCESS_ZONES_GAIN_RED_HEART_ABILITY_ID,
    (game, ability, options, context) =>
      resolveLiveStartEqualSuccessZones(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      )
  );
  registerPendingAbilityStarterHandler(
    PL_N_BP5_007_LIVE_SUCCESS_REMAINING_HEART_DRAW_TWO_DISCARD_ONE_ABILITY_ID,
    (game, ability, options, context) =>
      startLiveSuccessDrawDiscardIfRemainingHeart(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      )
  );
  registerActiveEffectStepHandler(
    PL_N_BP5_007_LIVE_SUCCESS_REMAINING_HEART_DRAW_TWO_DISCARD_ONE_ABILITY_ID,
    LIVE_SUCCESS_SELECT_DISCARD_STEP_ID,
    (game, input, context) =>
      finishDrawThenDiscardCardsWorkflow(
        game,
        input.selectedCardId ?? null,
        input.selectedCardIds,
        context.continuePendingCardEffects,
        deps.enqueueTriggeredCardEffects
      )
  );
}

function resolveLiveStartEqualSuccessZones(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  const opponent = game.players.find((candidate) => candidate.id !== ability.controllerId);
  if (!player) {
    return game;
  }

  const sourceSlot = findMemberSlot(player, ability.sourceCardId);
  const sourceOnStage = sourceSlot !== null;
  const ownSuccessCount = player.successZone.cardIds.length;
  const opponentSuccessCount = opponent?.successZone.cardIds.length ?? 0;
  const conditionMet = sourceOnStage && ownSuccessCount === opponentSuccessCount;
  const stateWithoutPending: GameState = {
    ...game,
    pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
  };
  const heartResult = conditionMet
    ? addHeartLiveModifierForMember(stateWithoutPending, {
        playerId: player.id,
        memberCardId: ability.sourceCardId,
        sourceCardId: ability.sourceCardId,
        abilityId: ability.abilityId,
        hearts: [{ color: HeartColor.RED, count: 2 }],
      })
    : null;
  const stateAfterModifier = heartResult?.gameState ?? stateWithoutPending;

  return continuePendingCardEffects(
    addAction(stateAfterModifier, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: 'EQUAL_SUCCESS_ZONES_GAIN_RED_HEART',
      sourceSlot,
      sourceOnStage,
      ownSuccessCount,
      opponentSuccessCount,
      conditionMet,
      heartBonus: heartResult?.heartBonus ?? [],
    }),
    orderedResolution
  );
}

function startLiveSuccessDrawDiscardIfRemainingHeart(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  const sourceSlot = findMemberSlot(player, ability.sourceCardId);
  const sourceOnStage = sourceSlot !== null;
  const remainingHeartTotalCount = getRemainingHeartTotalCount(game, player.id);
  const conditionMet = sourceOnStage && remainingHeartTotalCount >= 1;
  if (!conditionMet) {
    const state = {
      ...game,
      pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
    };
    return continuePendingCardEffects(
      addAction(state, 'RESOLVE_ABILITY', player.id, {
        pendingAbilityId: ability.id,
        abilityId: ability.abilityId,
        sourceCardId: ability.sourceCardId,
        step: 'REMAINING_HEART_DRAW_DISCARD_CONDITION_NOT_MET',
        sourceSlot,
        sourceOnStage,
        remainingHeartTotalCount,
        conditionMet,
      }),
      orderedResolution
    );
  }

  return startDrawThenDiscardCardsWorkflow(game, {
    ability: { ...ability, sourceSlot },
    effectText: getAbilityEffectText(
      PL_N_BP5_007_LIVE_SUCCESS_REMAINING_HEART_DRAW_TWO_DISCARD_ONE_ABILITY_ID
    ),
    drawCount: 2,
    discardCount: 1,
    stepId: LIVE_SUCCESS_SELECT_DISCARD_STEP_ID,
    orderedResolution,
  });
}
