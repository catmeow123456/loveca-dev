import {
  addAction,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { ZoneType } from '../../../../shared/types/enums.js';
import { HS_BP6_015_ON_ENTER_FROM_NON_HAND_DRAW_TWO_DISCARD_TWO_ABILITY_ID } from '../../ability-ids.js';
import { type EnqueueTriggeredCardEffectsForEnterWaitingRoom } from '../../runtime/enter-waiting-room-triggers.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText } from '../../runtime/workflow-helpers.js';
import {
  finishDrawThenDiscardCardsWorkflow,
  startDrawThenDiscardCardsWorkflow,
} from '../shared/draw-then-discard.js';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

const HS_BP6_015_SELECT_DISCARD_STEP_ID = 'HS_BP6_015_SELECT_DISCARD_AFTER_DRAW';

export function registerHsBp6015SerasWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom;
}): void {
  registerPendingAbilityStarterHandler(
    HS_BP6_015_ON_ENTER_FROM_NON_HAND_DRAW_TWO_DISCARD_TWO_ABILITY_ID,
    (game, ability, options, context) =>
      resolveHsBp6015SerasOnEnter(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      )
  );
  registerActiveEffectStepHandler(
    HS_BP6_015_ON_ENTER_FROM_NON_HAND_DRAW_TWO_DISCARD_TWO_ABILITY_ID,
    HS_BP6_015_SELECT_DISCARD_STEP_ID,
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

function resolveHsBp6015SerasOnEnter(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const fromZone = ability.metadata?.fromZone;
  if (fromZone === undefined || fromZone === ZoneType.HAND) {
    return consumePendingNoOp(
      game,
      ability,
      orderedResolution,
      continuePendingCardEffects,
      fromZone ?? null
    );
  }

  return startDrawThenDiscardCardsWorkflow(game, {
    ability,
    effectText: getAbilityEffectText(ability.abilityId),
    drawCount: 2,
    discardCount: 2,
    stepId: HS_BP6_015_SELECT_DISCARD_STEP_ID,
    orderedResolution,
    continuePendingCardEffects,
  });
}

function consumePendingNoOp(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects,
  fromZone: ZoneType | null
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
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
      step: 'SOURCE_FROM_HAND_OR_UNKNOWN',
      sourceSlot: ability.sourceSlot,
      fromZone,
    }),
    orderedResolution
  );
}
