import { isLiveCardData } from '../../../../domain/entities/card.js';
import {
  addAction,
  getCardById,
  getPlayerById,
  type ActiveEffectState,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { CardType } from '../../../../shared/types/enums.js';
import { selectDifferentNamedCards } from '../../../../shared/utils/card-identity.js';
import { typeIs } from '../../../effects/card-selectors.js';
import {
  createWaitingRoomToHandEffectState,
  createWaitingRoomToHandSelectionConfig,
  selectWaitingRoomCardIds,
} from '../../../effects/zone-selection.js';
import { SP_BP2_011_ON_ENTER_OPPONENT_CHOOSES_DISTINCT_LIVE_RECOVERY_ABILITY_ID } from '../../ability-ids.js';
import { recoverCardsFromWaitingRoomToHandForPlayer } from '../../runtime/actions.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText } from '../../runtime/workflow-helpers.js';

const SELECT_DISTINCT_LIVE_STEP_ID = 'SP_BP2_011_SELECT_DISTINCT_LIVES_FROM_WAITING_ROOM';
const OPPONENT_CHOOSE_LIVE_STEP_ID = 'SP_BP2_011_OPPONENT_CHOOSE_LIVE_TO_RECOVER';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerSpBp2011TomariWorkflowHandlers(): void {
  registerPendingAbilityStarterHandler(
    SP_BP2_011_ON_ENTER_OPPONENT_CHOOSES_DISTINCT_LIVE_RECOVERY_ABILITY_ID,
    (game, ability, options, context) =>
      startSpBp2011TomariOnEnter(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      )
  );
  registerActiveEffectStepHandler(
    SP_BP2_011_ON_ENTER_OPPONENT_CHOOSES_DISTINCT_LIVE_RECOVERY_ABILITY_ID,
    SELECT_DISTINCT_LIVE_STEP_ID,
    (game, input) => startOpponentChoiceStep(game, input.selectedCardIds)
  );
  registerActiveEffectStepHandler(
    SP_BP2_011_ON_ENTER_OPPONENT_CHOOSES_DISTINCT_LIVE_RECOVERY_ABILITY_ID,
    OPPONENT_CHOOSE_LIVE_STEP_ID,
    (game, input, context) =>
      finishOpponentChoiceRecovery(
        game,
        input.selectedCardId ?? null,
        context.continuePendingCardEffects
      )
  );
}

function startSpBp2011TomariOnEnter(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  const waitingLiveCardIds = getWaitingRoomLiveCardIds(game, player.id);
  if (!hasTwoDifferentNamedLives(game, waitingLiveCardIds)) {
    return consumePendingNoop(game, ability, player.id, orderedResolution, continuePendingCardEffects, {
      step: 'NO_DIFFERENT_NAMED_LIVE_PAIR',
      waitingLiveCardIds,
    });
  }

  return addAction(
    {
      ...game,
      pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
      activeEffect: createWaitingRoomToHandEffectState({
        id: ability.id,
        abilityId: ability.abilityId,
        sourceCardId: ability.sourceCardId,
        controllerId: ability.controllerId,
        effectText: getAbilityEffectText(ability.abilityId),
        stepId: SELECT_DISTINCT_LIVE_STEP_ID,
        stepText: '请选择自己休息室中2张卡名不同的LIVE卡。',
        awaitingPlayerId: player.id,
        selectableCardIds: waitingLiveCardIds,
        canSkipSelection: false,
        publiclyConfirmSelection: false,
        metadata: {
          orderedResolution,
        },
        zoneSelection: createWaitingRoomToHandSelectionConfig({
          minCount: 2,
          maxCount: 2,
          optional: false,
        }),
      }),
    },
    'RESOLVE_ABILITY',
    player.id,
    {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: 'START_SELECT_DIFFERENT_NAMED_LIVES',
      selectableCardIds: waitingLiveCardIds,
    }
  );
}

function startOpponentChoiceStep(
  game: GameState,
  selectedCardIds: readonly string[] | undefined
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !==
      SP_BP2_011_ON_ENTER_OPPONENT_CHOOSES_DISTINCT_LIVE_RECOVERY_ABILITY_ID ||
    effect.stepId !== SELECT_DISTINCT_LIVE_STEP_ID
  ) {
    return game;
  }

  const player = getPlayerById(game, effect.controllerId);
  const opponent = game.players.find((candidate) => candidate.id !== effect.controllerId);
  const selectedIds = selectedCardIds ?? [];
  if (
    !player ||
    !opponent ||
    !isValidDifferentNamedLiveSelection(game, player.id, selectedIds, effect.selectableCardIds ?? [])
  ) {
    return game;
  }

  return addAction(
    {
      ...game,
      activeEffect: {
        ...effect,
        stepId: OPPONENT_CHOOSE_LIVE_STEP_ID,
        stepText: '请选择其中1张LIVE卡。被选择的卡会加入对手手牌。',
        awaitingPlayerId: opponent.id,
        selectableCardIds: selectedIds,
        selectableCardVisibility: 'PUBLIC',
        selectableCardMode: 'SINGLE',
        minSelectableCards: undefined,
        maxSelectableCards: undefined,
        selectionLabel: '选择让对手加入手牌的LIVE',
        confirmSelectionLabel: '选择此LIVE',
        canSkipSelection: false,
        metadata: {
          ...effect.metadata,
          publicCardSelectionConfirmation: {
            destination: 'HAND',
            sourcePlayerId: effect.controllerId,
          },
          selectedLiveCardIds: selectedIds,
        },
      },
    },
    'RESOLVE_ABILITY',
    player.id,
    {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'SELECT_DIFFERENT_NAMED_LIVES',
      selectedCardIds: selectedIds,
    }
  );
}

function finishOpponentChoiceRecovery(
  game: GameState,
  selectedCardId: string | null,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !==
      SP_BP2_011_ON_ENTER_OPPONENT_CHOOSES_DISTINCT_LIVE_RECOVERY_ABILITY_ID ||
    effect.stepId !== OPPONENT_CHOOSE_LIVE_STEP_ID ||
    selectedCardId === null
  ) {
    return game;
  }

  const player = getPlayerById(game, effect.controllerId);
  const selectedLiveCardIds = getSelectedLiveCardIds(effect);
  if (
    !player ||
    !selectedLiveCardIds.includes(selectedCardId) ||
    !areAllCardsStillWaitingRoomLives(game, player.id, selectedLiveCardIds)
  ) {
    return game;
  }

  const recoveryResult = recoverCardsFromWaitingRoomToHandForPlayer(
    game,
    player.id,
    [selectedCardId],
    {
      candidateCardIds: selectedLiveCardIds,
      exactCount: 1,
    }
  );
  if (!recoveryResult) {
    return game;
  }

  const state: GameState = {
    ...recoveryResult.gameState,
    activeEffect: null,
  };

  return continuePendingCardEffects(
    addAction(state, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'OPPONENT_CHOOSE_RECOVER_LIVE',
      selectedLiveCardIds,
      opponentChosenCardId: selectedCardId,
      recoveredCardIds: recoveryResult.movedCardIds,
    }),
    effect.metadata?.orderedResolution === true
  );
}

function consumePendingNoop(
  game: GameState,
  ability: PendingAbilityState,
  playerId: string,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects,
  payload: Readonly<Record<string, unknown>>
): GameState {
  const state: GameState = {
    ...game,
    pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
  };
  return continuePendingCardEffects(
    addAction(state, 'RESOLVE_ABILITY', playerId, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      ...payload,
    }),
    orderedResolution
  );
}

function getWaitingRoomLiveCardIds(game: GameState, playerId: string): readonly string[] {
  return selectWaitingRoomCardIds(game, playerId, typeIs(CardType.LIVE));
}

function hasTwoDifferentNamedLives(game: GameState, cardIds: readonly string[]): boolean {
  return selectDifferentNamedCards(cardIds, (cardId) => getCardById(game, cardId)?.data ?? null, {
    minCount: 2,
    maxCount: 2,
  }).length === 2;
}

function isValidDifferentNamedLiveSelection(
  game: GameState,
  playerId: string,
  selectedCardIds: readonly string[],
  selectableCardIds: readonly string[]
): boolean {
  return (
    selectedCardIds.length === 2 &&
    new Set(selectedCardIds).size === 2 &&
    selectedCardIds.every((cardId) => selectableCardIds.includes(cardId)) &&
    areAllCardsStillWaitingRoomLives(game, playerId, selectedCardIds) &&
    hasTwoDifferentNamedLives(game, selectedCardIds)
  );
}

function areAllCardsStillWaitingRoomLives(
  game: GameState,
  playerId: string,
  cardIds: readonly string[]
): boolean {
  const player = getPlayerById(game, playerId);
  return (
    !!player &&
    cardIds.every((cardId) => {
      const card = getCardById(game, cardId);
      return player.waitingRoom.cardIds.includes(cardId) && card !== null && isLiveCardData(card.data);
    })
  );
}

function getSelectedLiveCardIds(effect: ActiveEffectState): readonly string[] {
  const selectedLiveCardIds = effect.metadata?.selectedLiveCardIds;
  return Array.isArray(selectedLiveCardIds)
    ? selectedLiveCardIds.filter((cardId): cardId is string => typeof cardId === 'string')
    : [];
}
