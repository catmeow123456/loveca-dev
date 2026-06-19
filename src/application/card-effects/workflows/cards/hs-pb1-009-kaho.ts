import {
  addAction,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import type { SlotPosition } from '../../../../shared/types/enums.js';
import {
  HS_PB1_009_LIVE_START_DRAW_DISCARD_ABILITY_ID,
  HS_PB1_009_ON_HASUNOSORA_ENTER_GAIN_BLADE_ABILITY_ID,
} from '../../ability-ids.js';
import { startConfirmOnlyPendingAbilityEffect } from '../../runtime/active-effect.js';
import { addBladeLiveModifierForSourceMember } from '../../runtime/actions.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import {
  getAbilityEffectText,
  recordAbilityUseForContext,
} from '../../runtime/workflow-helpers.js';
import {
  getSourceEffectiveBladeCount,
  sourceHasBladeAtLeast,
} from '../../../effects/conditions.js';
import {
  finishDrawThenDiscardCardsWorkflow,
  startDrawThenDiscardCardsWorkflow,
} from '../shared/draw-then-discard.js';

const HS_PB1_009_LIVE_START_SELECT_DISCARD_STEP_ID = 'HS_PB1_009_LIVE_START_SELECT_DISCARD';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerHsPb1009KahoWorkflowHandlers(): void {
  registerPendingAbilityStarterHandler(
    HS_PB1_009_ON_HASUNOSORA_ENTER_GAIN_BLADE_ABILITY_ID,
    (game, ability, options, context) =>
      resolveHsPb1KahoOnHasunosoraEnterGainBlade(game, ability, {
        orderedResolution: options.orderedResolution === true,
        manualConfirmation: options.manualConfirmation === true,
        skipManualConfirmation: options.skipManualConfirmation === true,
        continuePendingCardEffects: context.continuePendingCardEffects,
      })
  );
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

function resolveHsPb1KahoOnHasunosoraEnterGainBlade(
  game: GameState,
  ability: PendingAbilityState,
  options: {
    readonly orderedResolution: boolean;
    readonly manualConfirmation: boolean;
    readonly skipManualConfirmation: boolean;
    readonly continuePendingCardEffects: ContinuePendingCardEffects;
  }
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }
  if (options.manualConfirmation && !options.skipManualConfirmation) {
    return startConfirmOnlyPendingAbilityEffect(game, {
      ability,
      effectText: getAbilityEffectText(HS_PB1_009_ON_HASUNOSORA_ENTER_GAIN_BLADE_ABILITY_ID),
      orderedResolution: options.orderedResolution,
    });
  }

  let state: GameState = {
    ...game,
    pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
  };
  state = recordAbilityUseForContext(state, player.id, {
    abilityId: ability.abilityId,
    sourceCardId: ability.sourceCardId,
  });
  const bladeResult = addBladeLiveModifierForSourceMember(state, {
    playerId: player.id,
    sourceCardId: ability.sourceCardId,
    abilityId: ability.abilityId,
    amount: 2,
  });
  if (!bladeResult) {
    return game;
  }

  return options.continuePendingCardEffects(
    addAction(bladeResult.gameState, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: 'APPLY_BLADE_BONUS',
      bladeBonus: 2,
      sourceSlot: ability.sourceSlot,
    }),
    options.orderedResolution
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
    effectText: `${getAbilityEffectText(HS_PB1_009_LIVE_START_DRAW_DISCARD_ABILITY_ID)}（当前${effectiveBladeCount}个）`,
    drawCount: 2,
    discardCount: 1,
    stepId: HS_PB1_009_LIVE_START_SELECT_DISCARD_STEP_ID,
    orderedResolution,
  });
}
