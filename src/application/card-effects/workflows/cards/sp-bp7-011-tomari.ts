import {
  addAction,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import type { EnterWaitingRoomEvent } from '../../../../domain/events/game-events.js';
import { TriggerCondition } from '../../../../shared/types/enums.js';
import { SP_BP7_011_ON_ENTER_DISCARD_ALL_DRAW_SIX_ABILITY_ID } from '../../ability-ids.js';
import { startPendingActiveEffect } from '../../runtime/active-effect.js';
import { drawCardsForPlayer } from '../../runtime/actions.js';
import { discardHandCardsToWaitingRoomAndEnqueueTriggers } from '../../runtime/enter-waiting-room-triggers.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText } from '../../runtime/workflow-helpers.js';

const DECIDE_DISCARD_ALL_DRAW_SIX_STEP_ID = 'SP_BP7_011_DECIDE_DISCARD_ALL_DRAW_SIX';
const ACTIVATE_OPTION_ID = 'activate';
const DRAW_COUNT = 6;

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;
type EnqueueTriggeredCardEffects = (
  game: GameState,
  triggerConditions: readonly TriggerCondition[],
  options?: { readonly enterWaitingRoomEvents?: readonly EnterWaitingRoomEvent[] }
) => GameState;

export function registerSpBp7011TomariWorkflowHandlers(dependencies: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffects;
}): void {
  registerPendingAbilityStarterHandler(
    SP_BP7_011_ON_ENTER_DISCARD_ALL_DRAW_SIX_ABILITY_ID,
    (game, ability, options) =>
      startDiscardAllDrawSix(game, ability, options.orderedResolution === true)
  );
  registerActiveEffectStepHandler(
    SP_BP7_011_ON_ENTER_DISCARD_ALL_DRAW_SIX_ABILITY_ID,
    DECIDE_DISCARD_ALL_DRAW_SIX_STEP_ID,
    (game, input, context) =>
      finishDiscardAllDrawSix(
        game,
        input.selectedOptionId ?? null,
        dependencies.enqueueTriggeredCardEffects,
        context.continuePendingCardEffects
      )
  );
}

function startDiscardAllDrawSix(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  return startPendingActiveEffect(game, {
    ability,
    playerId: player.id,
    activeEffect: {
      id: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      controllerId: ability.controllerId,
      effectText: getAbilityEffectText(ability.abilityId),
      stepId: DECIDE_DISCARD_ALL_DRAW_SIX_STEP_ID,
      stepText: '可以将全部手牌放置入休息室；如此做时抽6张卡。',
      awaitingPlayerId: player.id,
      selectableOptions: [{ id: ACTIVATE_OPTION_ID, label: '发动' }],
      canSkipSelection: true,
      skipSelectionLabel: '不发动',
      metadata: {
        orderedResolution,
        sourceSlot: ability.sourceSlot,
      },
    },
    actionPayload: {
      sourceCardId: ability.sourceCardId,
      step: 'START_DISCARD_ALL_DRAW_SIX_DECISION',
    },
  });
}

function finishDiscardAllDrawSix(
  game: GameState,
  selectedOptionId: string | null,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffects,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  const player = effect ? getPlayerById(game, effect.controllerId) : null;
  if (
    !effect ||
    effect.abilityId !== SP_BP7_011_ON_ENTER_DISCARD_ALL_DRAW_SIX_ABILITY_ID ||
    effect.stepId !== DECIDE_DISCARD_ALL_DRAW_SIX_STEP_ID ||
    !player
  ) {
    return game;
  }

  if (selectedOptionId === null) {
    return finish(
      game,
      effect,
      player.id,
      continuePendingCardEffects,
      'DECLINE_DISCARD_ALL_DRAW_SIX',
      [],
      []
    );
  }
  if (
    selectedOptionId !== ACTIVATE_OPTION_ID ||
    effect.selectableOptions?.some((option) => option.id === selectedOptionId) !== true
  ) {
    return game;
  }

  const currentHandCardIds = [...player.hand.cardIds];
  const discardResult = discardHandCardsToWaitingRoomAndEnqueueTriggers(
    game,
    player.id,
    currentHandCardIds,
    {
      count: currentHandCardIds.length,
      candidateCardIds: currentHandCardIds,
    },
    enqueueTriggeredCardEffects
  );
  if (!discardResult) {
    return game;
  }
  const drawResult = drawCardsForPlayer(discardResult.gameState, player.id, DRAW_COUNT);
  if (!drawResult) {
    return game;
  }

  return finish(
    drawResult.gameState,
    effect,
    player.id,
    continuePendingCardEffects,
    'DISCARD_ALL_DRAW_SIX',
    discardResult.discardedCardIds,
    drawResult.drawnCardIds
  );
}

function finish(
  game: GameState,
  effect: NonNullable<GameState['activeEffect']>,
  playerId: string,
  continuePendingCardEffects: ContinuePendingCardEffects,
  step: string,
  discardedCardIds: readonly string[],
  drawnCardIds: readonly string[]
): GameState {
  return continuePendingCardEffects(
    addAction({ ...game, activeEffect: null }, 'RESOLVE_ABILITY', playerId, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      sourceSlot: effect.metadata?.sourceSlot,
      step,
      discardedCardIds,
      drawnCardIds,
    }),
    effect.metadata?.orderedResolution === true
  );
}
