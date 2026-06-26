import {
  addAction,
  getCardById,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { OrientationState } from '../../../../shared/types/enums.js';
import { unitAliasIs, hasBladeHeart } from '../../../effects/card-selectors.js';
import { placeEnergyFromDeckToZone } from '../../../effects/energy.js';
import {
  drawCardsForPlayer,
} from '../../runtime/actions.js';
import {
  createOptionalDiscardHandToWaitingRoomActiveEffect,
  finishSkippedActiveEffect,
  startPendingActiveEffect,
} from '../../runtime/active-effect.js';
import {
  discardOneHandCardToWaitingRoomAndEnqueueTriggers,
  type EnqueueTriggeredCardEffectsForEnterWaitingRoom,
} from '../../runtime/enter-waiting-room-triggers.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText } from '../../runtime/workflow-helpers.js';
import { SP_PB2_013_ON_ENTER_DISCARD_KALEIDOSCORE_PLACE_ENERGY_DRAW_ABILITY_ID } from '../../ability-ids.js';

const SELECT_DISCARD_KALEIDOSCORE_STEP_ID = 'SP_PB2_013_SELECT_DISCARD_KALEIDOSCORE';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerSpPb2013KekeWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom;
}): void {
  registerPendingAbilityStarterHandler(
    SP_PB2_013_ON_ENTER_DISCARD_KALEIDOSCORE_PLACE_ENERGY_DRAW_ABILITY_ID,
    (game, ability, options, context) =>
      startSpPb2013KekeOnEnter(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      )
  );
  registerActiveEffectStepHandler(
    SP_PB2_013_ON_ENTER_DISCARD_KALEIDOSCORE_PLACE_ENERGY_DRAW_ABILITY_ID,
    SELECT_DISCARD_KALEIDOSCORE_STEP_ID,
    (game, input, context) =>
      input.selectedCardId
        ? finishSpPb2013DiscardKaleidoscore(
            game,
            input.selectedCardId,
            context.continuePendingCardEffects,
            deps.enqueueTriggeredCardEffects
          )
        : finishSkippedActiveEffect(game, context.continuePendingCardEffects)
  );
}

function startSpPb2013KekeOnEnter(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  const selectableCardIds = player.hand.cardIds.filter((cardId) => {
    const card = getCardById(game, cardId);
    return card !== null && unitAliasIs('KALEIDOSCORE')(card);
  });
  if (selectableCardIds.length === 0) {
    return finishPendingAbility(
      game,
      ability,
      player.id,
      orderedResolution,
      {
        step: 'NO_OP_DISCARD_KALEIDOSCORE_PLACE_ENERGY_DRAW',
        reason: 'NO_KALEIDOSCORE_HAND',
        selectableCardIds,
      },
      continuePendingCardEffects
    );
  }

  return startPendingActiveEffect(game, {
    ability,
    playerId: player.id,
    activeEffect: createOptionalDiscardHandToWaitingRoomActiveEffect({
      ability,
      playerId: player.id,
      effectText: getAbilityEffectText(ability.abilityId),
      stepId: SELECT_DISCARD_KALEIDOSCORE_STEP_ID,
      stepText:
        '请选择1张手牌中的『KALEIDOSCORE』卡放置入休息室。也可以选择不发动此效果。',
      selectionLabel: '选择要放置入休息室的『KALEIDOSCORE』手牌',
      selectableCardIds,
      orderedResolution,
    }),
    actionPayload: {
      sourceCardId: ability.sourceCardId,
      step: 'START_SELECT_DISCARD_KALEIDOSCORE',
      selectableCardIds,
    },
  });
}

function finishSpPb2013DiscardKaleidoscore(
  game: GameState,
  selectedCardId: string,
  continuePendingCardEffects: ContinuePendingCardEffects,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom
): GameState {
  const effect = game.activeEffect;
  const player = effect ? getPlayerById(game, effect.controllerId) : null;
  const selectedCard = getCardById(game, selectedCardId);
  if (
    !effect ||
    effect.abilityId !== SP_PB2_013_ON_ENTER_DISCARD_KALEIDOSCORE_PLACE_ENERGY_DRAW_ABILITY_ID ||
    effect.stepId !== SELECT_DISCARD_KALEIDOSCORE_STEP_ID ||
    !player ||
    !selectedCard ||
    effect.selectableCardIds?.includes(selectedCardId) !== true ||
    !player.hand.cardIds.includes(selectedCardId) ||
    !unitAliasIs('KALEIDOSCORE')(selectedCard)
  ) {
    return game;
  }

  const discardedHasBladeHeart = hasBladeHeart()(selectedCard);
  const discardResult = discardOneHandCardToWaitingRoomAndEnqueueTriggers(
    game,
    player.id,
    selectedCardId,
    {
      candidateCardIds: effect.selectableCardIds ?? [],
    },
    enqueueTriggeredCardEffects
  );
  if (!discardResult) {
    return game;
  }

  let state = addAction(discardResult.gameState, 'PAY_COST', player.id, {
    pendingAbilityId: effect.id,
    abilityId: effect.abilityId,
    sourceCardId: effect.sourceCardId,
    discardedHandCardIds: discardResult.discardedCardIds,
  });

  const energyPlacement = placeEnergyFromDeckToZone(state, player.id, 1, OrientationState.WAITING);
  if (!energyPlacement) {
    return game;
  }
  state = energyPlacement.gameState;

  let drawnCardIds: readonly string[] = [];
  if (!discardedHasBladeHeart) {
    const drawResult = drawCardsForPlayer(state, player.id, 1);
    if (!drawResult) {
      return game;
    }
    state = drawResult.gameState;
    drawnCardIds = drawResult.drawnCardIds;
  }

  return finishPendingEffect(
    {
      ...state,
      activeEffect: effect,
    },
    continuePendingCardEffects,
    {
      step: 'DISCARD_KALEIDOSCORE_PLACE_ENERGY_DRAW',
      discardedCardId: discardResult.discardedCardIds[0] ?? selectedCardId,
      discardedCardIds: discardResult.discardedCardIds,
      discardedHasBladeHeart,
      placedEnergyCardIds: energyPlacement.placedEnergyCardIds,
      drawnCardIds,
    }
  );
}

function finishPendingEffect(
  game: GameState,
  continuePendingCardEffects: ContinuePendingCardEffects,
  payload: Readonly<Record<string, unknown>>
): GameState {
  const effect = game.activeEffect;
  const player = effect ? getPlayerById(game, effect.controllerId) : null;
  if (!effect || !player) {
    return game;
  }

  return continuePendingCardEffects(
    addAction(
      {
        ...game,
        activeEffect: null,
      },
      'RESOLVE_ABILITY',
      player.id,
      {
        pendingAbilityId: effect.id,
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
        ...payload,
      }
    ),
    effect.metadata?.orderedResolution === true
  );
}

function finishPendingAbility(
  game: GameState,
  ability: PendingAbilityState,
  playerId: string,
  orderedResolution: boolean,
  payload: Readonly<Record<string, unknown>>,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  return continuePendingCardEffects(
    addAction(
      {
        ...game,
        pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
      },
      'RESOLVE_ABILITY',
      playerId,
      {
        pendingAbilityId: ability.id,
        abilityId: ability.abilityId,
        sourceCardId: ability.sourceCardId,
        ...payload,
      }
    ),
    orderedResolution
  );
}
