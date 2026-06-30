import {
  addAction,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import {
  addBladeLiveModifierForSourceMember,
  type AddBladeLiveModifierForSourceMemberResult,
} from '../../runtime/actions.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import {
  getAbilityEffectText,
  registerManualConfirmablePendingAbilityStarterHandler,
} from '../../runtime/workflow-helpers.js';
import {
  SP_BP2_009_LIVE_START_HAND_COUNT_GAIN_BLADE_ABILITY_ID,
  SP_BP2_009_LIVE_SUCCESS_DRAW_TWO_DISCARD_ONE_ABILITY_ID,
} from '../../ability-ids.js';
import {
  finishDrawThenDiscardCardsWorkflow,
  startDrawThenDiscardCardsWorkflow,
} from '../shared/draw-then-discard.js';
import type { EnqueueTriggeredCardEffectsForEnterWaitingRoom } from '../../runtime/enter-waiting-room-triggers.js';

const SP_BP2_009_LIVE_SUCCESS_SELECT_DISCARD_STEP_ID =
  'SP_BP2_009_LIVE_SUCCESS_SELECT_DISCARD_AFTER_DRAW';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerSpBp2009NatsumiWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom;
}): void {
  registerManualConfirmablePendingAbilityStarterHandler(
    SP_BP2_009_LIVE_START_HAND_COUNT_GAIN_BLADE_ABILITY_ID,
    (game, ability, options, context) =>
      resolveSpBp2009NatsumiLiveStart(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      )
  );
  registerPendingAbilityStarterHandler(
    SP_BP2_009_LIVE_SUCCESS_DRAW_TWO_DISCARD_ONE_ABILITY_ID,
    (game, ability, options) =>
      startDrawThenDiscardCardsWorkflow(game, {
        ability,
        effectText: getAbilityEffectText(SP_BP2_009_LIVE_SUCCESS_DRAW_TWO_DISCARD_ONE_ABILITY_ID),
        drawCount: 2,
        discardCount: 1,
        stepId: SP_BP2_009_LIVE_SUCCESS_SELECT_DISCARD_STEP_ID,
        orderedResolution: options.orderedResolution === true,
      })
  );
  registerActiveEffectStepHandler(
    SP_BP2_009_LIVE_SUCCESS_DRAW_TWO_DISCARD_ONE_ABILITY_ID,
    SP_BP2_009_LIVE_SUCCESS_SELECT_DISCARD_STEP_ID,
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

function resolveSpBp2009NatsumiLiveStart(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  const handCount = player.hand.cardIds.length;
  const bladeBonus = Math.floor(handCount / 2);
  const stateBeforeModifier = {
    ...game,
    pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
  };
  const bladeResult =
    bladeBonus > 0
      ? addBladeLiveModifierForSourceMember(stateBeforeModifier, {
          playerId: player.id,
          sourceCardId: ability.sourceCardId,
          abilityId: ability.abilityId,
          amount: bladeBonus,
        })
      : null;
  const stateAfterModifier = getStateAfterBladeModifier(stateBeforeModifier, bladeResult);

  return continuePendingCardEffects(
    addAction(stateAfterModifier, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: 'LIVE_START_HAND_COUNT_GAIN_BLADE',
      handCount,
      bladeBonus,
    }),
    orderedResolution
  );
}

function getStateAfterBladeModifier(
  fallbackState: GameState,
  bladeResult: AddBladeLiveModifierForSourceMemberResult | null
): GameState {
  return bladeResult?.gameState ?? fallbackState;
}
