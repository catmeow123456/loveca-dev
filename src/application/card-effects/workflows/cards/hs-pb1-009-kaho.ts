import {
  addAction,
  getPlayerById,
  type GameState,
} from '../../../../domain/entities/game.js';
import type { SlotPosition } from '../../../../shared/types/enums.js';
import { HS_PB1_009_LIVE_START_DRAW_DISCARD_ABILITY_ID } from '../../ability-ids.js';
import { CARD_ABILITY_DEFINITIONS } from '../../definitions/index.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import {
  getSourceEffectiveBladeCount,
  sourceHasBladeAtLeast,
} from '../../../effects/conditions.js';
import {
  finishDrawThenDiscardCardsWorkflow,
  startDrawThenDiscardCardsWorkflow,
} from '../shared/draw-then-discard.js';

const HS_PB1_009_LIVE_START_SELECT_DISCARD_STEP_ID = 'HS_PB1_009_LIVE_START_SELECT_DISCARD';

export function registerHsPb1009KahoWorkflowHandlers(): void {
  registerPendingAbilityStarterHandler(
    HS_PB1_009_LIVE_START_DRAW_DISCARD_ABILITY_ID,
    (game, ability, options, context) =>
      startHsPb1KahoLiveStartDrawDiscard(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      )
  );
  registerActiveEffectStepHandler(
    HS_PB1_009_LIVE_START_DRAW_DISCARD_ABILITY_ID,
    HS_PB1_009_LIVE_START_SELECT_DISCARD_STEP_ID,
    (game, input, context) =>
      finishDrawThenDiscardCardsWorkflow(
        game,
        input.selectedCardId ?? null,
        input.selectedCardIds,
        context.continuePendingCardEffects
      )
  );
}

function startHsPb1KahoLiveStartDrawDiscard(
  game: GameState,
  ability: {
    readonly id: string;
    readonly abilityId: string;
    readonly sourceCardId: string;
    readonly controllerId: string;
    readonly sourceSlot?: SlotPosition;
  },
  orderedResolution: boolean,
  continuePendingCardEffects: (game: GameState, orderedResolution: boolean) => GameState
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  const effectiveBladeCount = getSourceEffectiveBladeCount(game, player.id, ability.sourceCardId);
  const hasEnoughBlade = sourceHasBladeAtLeast(game, player.id, ability.sourceCardId, 8);
  if (!hasEnoughBlade) {
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
        effectiveBladeCount,
      }),
      orderedResolution
    );
  }

  const state = addAction(game, 'RESOLVE_ABILITY', player.id, {
    pendingAbilityId: ability.id,
    abilityId: ability.abilityId,
    sourceCardId: ability.sourceCardId,
    step: 'CONDITION_MET',
    sourceSlot: ability.sourceSlot,
    effectiveBladeCount,
  });

  return startDrawThenDiscardCardsWorkflow(state, {
    ability,
    effectText: `${getCardAbilityEffectText(HS_PB1_009_LIVE_START_DRAW_DISCARD_ABILITY_ID)}（当前${effectiveBladeCount}个）`,
    drawCount: 2,
    discardCount: 1,
    stepId: HS_PB1_009_LIVE_START_SELECT_DISCARD_STEP_ID,
    orderedResolution,
  });
}

function getCardAbilityEffectText(abilityId: string): string {
  const effectText = CARD_ABILITY_DEFINITIONS.find(
    (ability) => ability.abilityId === abilityId
  )?.effectText;
  if (!effectText || effectText.trim().length === 0) {
    throw new Error(`Missing card ability effect text for abilityId: ${abilityId}`);
  }
  return effectText;
}
