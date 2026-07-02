import { isLiveCardData } from '../../../../domain/entities/card.js';
import {
  addAction,
  getCardById,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { OrientationState } from '../../../../shared/types/enums.js';
import { cardCodeMatchesBase } from '../../../../shared/utils/card-code.js';
import { placeEnergyFromDeckToZone } from '../../../effects/energy.js';
import { SP_BP5_027_LIVE_SUCCESS_PLACE_WAITING_ENERGY_OPPONENT_DRAW_ABILITY_ID } from '../../ability-ids.js';
import { drawCardsForPlayer } from '../../runtime/actions.js';
import { startPendingActiveEffect } from '../../runtime/active-effect.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText } from '../../runtime/workflow-helpers.js';

const PLACE_DECISION_STEP_ID = 'SP_BP5_027_PLACE_WAITING_ENERGY_DECISION';
const PLACE_OPTION_ID = 'place';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerSpBp5027HotPassionWorkflowHandlers(): void {
  registerPendingAbilityStarterHandler(
    SP_BP5_027_LIVE_SUCCESS_PLACE_WAITING_ENERGY_OPPONENT_DRAW_ABILITY_ID,
    (game, ability, options, context) =>
      startPlaceWaitingEnergyDecision(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      )
  );
  registerActiveEffectStepHandler(
    SP_BP5_027_LIVE_SUCCESS_PLACE_WAITING_ENERGY_OPPONENT_DRAW_ABILITY_ID,
    PLACE_DECISION_STEP_ID,
    (game, input, context) =>
      finishPlaceWaitingEnergyDecision(
        game,
        input.selectedOptionId ?? null,
        context.continuePendingCardEffects
      )
  );
}

function startPlaceWaitingEnergyDecision(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player || !sourceIsCurrentBp5027Live(game, ability.controllerId, ability.sourceCardId)) {
    return consumePendingNoop(game, ability, orderedResolution, continuePendingCardEffects, {
      step: 'SOURCE_NOT_IN_LIVE_ZONE',
      placedEnergyCardIds: [],
      opponentDrawnCardIds: [],
    });
  }
  if (player.energyDeck.cardIds.length === 0) {
    return consumePendingNoop(game, ability, orderedResolution, continuePendingCardEffects, {
      step: 'NO_ENERGY_DECK_CANDIDATE',
      placedEnergyCardIds: [],
      opponentDrawnCardIds: [],
    });
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
      stepId: PLACE_DECISION_STEP_ID,
      stepText: '可以从能量卡组放置1张待机能量。如此做，对方抽1张。',
      awaitingPlayerId: player.id,
      selectableOptions: [
        { id: PLACE_OPTION_ID, label: '放置1张待机能量' },
      ],
      canSkipSelection: true,
      skipSelectionLabel: '不发动',
      metadata: {
        orderedResolution,
      },
    },
    actionPayload: {
      sourceCardId: ability.sourceCardId,
      step: 'START_PLACE_WAITING_ENERGY_DECISION',
    },
  });
}

function finishPlaceWaitingEnergyDecision(
  game: GameState,
  selectedOptionId: string | null,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !== SP_BP5_027_LIVE_SUCCESS_PLACE_WAITING_ENERGY_OPPONENT_DRAW_ABILITY_ID ||
    effect.stepId !== PLACE_DECISION_STEP_ID
  ) {
    return game;
  }
  const player = getPlayerById(game, effect.controllerId);
  if (!player) {
    return game;
  }
  const orderedResolution = effect.metadata?.orderedResolution === true;
  if (selectedOptionId !== PLACE_OPTION_ID) {
    return finishActiveEffectNoop(game, player.id, effect, continuePendingCardEffects, {
      step: 'DECLINE_PLACE_WAITING_ENERGY',
      placedEnergyCardIds: [],
      opponentDrawnCardIds: [],
    });
  }
  if (!sourceIsCurrentBp5027Live(game, player.id, effect.sourceCardId)) {
    return finishActiveEffectNoop(game, player.id, effect, continuePendingCardEffects, {
      step: 'SOURCE_NOT_IN_LIVE_ZONE_AFTER_CHOICE',
      placedEnergyCardIds: [],
      opponentDrawnCardIds: [],
    });
  }

  const energyResult = placeEnergyFromDeckToZone(game, player.id, 1, OrientationState.WAITING);
  if (!energyResult || energyResult.placedEnergyCardIds.length === 0) {
    return finishActiveEffectNoop(game, player.id, effect, continuePendingCardEffects, {
      step: 'NO_ENERGY_DECK_CANDIDATE_AFTER_CHOICE',
      placedEnergyCardIds: [],
      opponentDrawnCardIds: [],
    });
  }

  const opponent = game.players.find((candidate) => candidate.id !== player.id) ?? null;
  const drawResult = opponent
    ? drawCardsForPlayer(energyResult.gameState, opponent.id, 1)
    : null;
  const state = drawResult?.gameState ?? energyResult.gameState;
  return continuePendingCardEffects(
    addAction({ ...state, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'PLACE_WAITING_ENERGY_OPPONENT_DRAW',
      placedEnergyCardIds: energyResult.placedEnergyCardIds,
      opponentPlayerId: opponent?.id ?? null,
      opponentDrawnCardIds: drawResult?.drawnCardIds ?? [],
    }),
    orderedResolution
  );
}

function consumePendingNoop(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects,
  payload: Readonly<Record<string, unknown>>
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  const stateWithoutPending: GameState = {
    ...game,
    pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
  };
  if (!player) {
    return continuePendingCardEffects(stateWithoutPending, orderedResolution);
  }
  return continuePendingCardEffects(
    addAction(stateWithoutPending, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      ...payload,
    }),
    orderedResolution
  );
}

function finishActiveEffectNoop(
  game: GameState,
  playerId: string,
  effect: NonNullable<GameState['activeEffect']>,
  continuePendingCardEffects: ContinuePendingCardEffects,
  payload: Readonly<Record<string, unknown>>
): GameState {
  return continuePendingCardEffects(
    addAction({ ...game, activeEffect: null }, 'RESOLVE_ABILITY', playerId, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      ...payload,
    }),
    effect.metadata?.orderedResolution === true
  );
}

function sourceIsCurrentBp5027Live(game: GameState, playerId: string, sourceCardId: string): boolean {
  const player = getPlayerById(game, playerId);
  const sourceCard = getCardById(game, sourceCardId);
  return (
    !!player &&
    !!sourceCard &&
    sourceCard.ownerId === playerId &&
    isLiveCardData(sourceCard.data) &&
    cardCodeMatchesBase(sourceCard.data.cardCode, 'PL!SP-bp5-027') &&
    player.liveZone.cardIds.includes(sourceCardId)
  );
}
