import { isLiveCardData } from '../../../../domain/entities/card.js';
import {
  addAction,
  getCardById,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { groupAliasIs } from '../../../effects/card-selectors.js';
import {
  moveRevealedCheerCards,
  selectRevealedCheerCardIds,
} from '../../../effects/cheer-selection.js';
import { PL_N_BP1_026_LIVE_SUCCESS_HIGHER_SCORE_REVEALED_CHEER_NIJIGASAKI_TO_HAND_ABILITY_ID } from '../../ability-ids.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import {
  registerPendingAbilityStarterHandler,
  type PendingAbilityStarterOptions,
} from '../../runtime/starter-registry.js';
import {
  getAbilityEffectText,
  maybeStartManualPendingAbilityConfirmation,
} from '../../runtime/workflow-helpers.js';

const SELECT_NIJIGASAKI_REVEALED_CHEER_STEP_ID =
  'PL_N_BP1_026_SELECT_NIJIGASAKI_REVEALED_CHEER_TO_HAND';
const POPPIN_UP_METADATA_KEY = 'nBp1026PoppinUpRevealedCheerToHand';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerNBp1026PoppinUpWorkflowHandlers(): void {
  registerPendingAbilityStarterHandler(
    PL_N_BP1_026_LIVE_SUCCESS_HIGHER_SCORE_REVEALED_CHEER_NIJIGASAKI_TO_HAND_ABILITY_ID,
    (game, ability, options, context) =>
      startNBp1026PoppinUpSelection(
        game,
        ability,
        options,
        context.continuePendingCardEffects
      )
  );

  registerActiveEffectStepHandler(
    PL_N_BP1_026_LIVE_SUCCESS_HIGHER_SCORE_REVEALED_CHEER_NIJIGASAKI_TO_HAND_ABILITY_ID,
    SELECT_NIJIGASAKI_REVEALED_CHEER_STEP_ID,
    (game, input, context) =>
      finishNBp1026PoppinUpSelection(
        game,
        input.selectedCardId ?? null,
        context.continuePendingCardEffects
      )
  );
}

function startNBp1026PoppinUpSelection(
  game: GameState,
  ability: PendingAbilityState,
  options: PendingAbilityStarterOptions,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  const scoreComparison = getLiveScoreComparison(game, player.id);
  if (!scoreComparison.conditionMet) {
    const manualConfirmation = maybeStartManualPendingAbilityConfirmation(game, ability, options);
    if (manualConfirmation) {
      return manualConfirmation;
    }
    const state = removePendingAbility(game, ability.id);
    return continuePendingCardEffects(
      addAction(state, 'RESOLVE_ABILITY', player.id, {
        pendingAbilityId: ability.id,
        abilityId: ability.abilityId,
        sourceCardId: ability.sourceCardId,
        step: 'CONDITION_NOT_MET',
        ...scoreComparison,
      }),
      options.orderedResolution === true
    );
  }

  const selectableCardIds = selectNijigasakiRevealedCheerCardIds(game, player.id);
  if (selectableCardIds.length === 0) {
    const manualConfirmation = maybeStartManualPendingAbilityConfirmation(game, ability, options);
    if (manualConfirmation) {
      return manualConfirmation;
    }
    const state = removePendingAbility(game, ability.id);
    return continuePendingCardEffects(
      addAction(state, 'RESOLVE_ABILITY', player.id, {
        pendingAbilityId: ability.id,
        abilityId: ability.abilityId,
        sourceCardId: ability.sourceCardId,
        step: 'NO_NIJIGASAKI_REVEALED_CHEER_TARGET',
        selectableCardIds,
        ...scoreComparison,
      }),
      options.orderedResolution === true
    );
  }

  const state: GameState = {
    ...removePendingAbility(game, ability.id),
    activeEffect: {
      id: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      controllerId: ability.controllerId,
      effectText: getAbilityEffectText(ability.abilityId),
      stepId: SELECT_NIJIGASAKI_REVEALED_CHEER_STEP_ID,
      stepText: '请选择1张因声援被公开的自己的「虹ヶ咲」卡片加入手牌。',
      awaitingPlayerId: player.id,
      selectableCardIds,
      selectableCardVisibility: 'PUBLIC',
      selectableCardMode: 'SINGLE',
      selectionLabel: '选择加入手牌的声援公开虹咲卡',
      confirmSelectionLabel: '加入手牌',
      canSkipSelection: false,
      metadata: {
        [POPPIN_UP_METADATA_KEY]: true,
        orderedResolution: options.orderedResolution === true,
        publicCardSelectionConfirmation: {
          source: 'REVEALED_CHEER',
          destination: 'HAND',
        },
        ...scoreComparison,
      },
    },
  };

  return addAction(state, 'RESOLVE_ABILITY', player.id, {
    pendingAbilityId: ability.id,
    abilityId: ability.abilityId,
    sourceCardId: ability.sourceCardId,
    step: 'START_SELECT_NIJIGASAKI_REVEALED_CHEER_TO_HAND',
    selectableCardIds,
    ...scoreComparison,
  });
}

function finishNBp1026PoppinUpSelection(
  game: GameState,
  selectedCardId: string | null,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !==
      PL_N_BP1_026_LIVE_SUCCESS_HIGHER_SCORE_REVEALED_CHEER_NIJIGASAKI_TO_HAND_ABILITY_ID ||
    effect.stepId !== SELECT_NIJIGASAKI_REVEALED_CHEER_STEP_ID ||
    effect.metadata?.[POPPIN_UP_METADATA_KEY] !== true
  ) {
    return game;
  }

  const player = getPlayerById(game, effect.controllerId);
  if (!player || !selectedCardId) {
    return game;
  }

  const currentSelectableCardIds = selectNijigasakiRevealedCheerCardIds(game, player.id);
  if (
    effect.selectableCardIds?.includes(selectedCardId) !== true ||
    !currentSelectableCardIds.includes(selectedCardId)
  ) {
    return game;
  }

  const moveResult = moveRevealedCheerCards(game, player.id, [selectedCardId], 'HAND');
  if (!moveResult) {
    return game;
  }

  const state: GameState = {
    ...moveResult.gameState,
    activeEffect: null,
  };
  const scoreComparison = getLiveScoreComparison(game, player.id);

  return continuePendingCardEffects(
    addAction(state, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'MOVE_NIJIGASAKI_REVEALED_CHEER_TO_HAND',
      movedCardIds: moveResult.movedCardIds,
      ...scoreComparison,
    }),
    effect.metadata?.orderedResolution === true
  );
}

function selectNijigasakiRevealedCheerCardIds(
  game: GameState,
  playerId: string
): readonly string[] {
  return selectRevealedCheerCardIds(game, playerId, groupAliasIs('虹ヶ咲'));
}

function getLiveScoreComparison(
  game: GameState,
  playerId: string
): {
  readonly ownScore: number;
  readonly opponentScore: number;
  readonly ownHasLive: boolean;
  readonly opponentHasLive: boolean;
  readonly conditionMet: boolean;
} {
  const opponent = game.players.find((candidate) => candidate.id !== playerId);
  const ownScore = game.liveResolution.playerScores.get(playerId) ?? 0;
  const opponentScore = opponent ? (game.liveResolution.playerScores.get(opponent.id) ?? 0) : 0;
  const ownHasLive = hasLiveCardInLiveZone(game, playerId);
  const opponentHasLive = opponent ? hasLiveCardInLiveZone(game, opponent.id) : false;

  return {
    ownScore,
    opponentScore,
    ownHasLive,
    opponentHasLive,
    conditionMet: ownScore > opponentScore || (ownHasLive && !opponentHasLive),
  };
}

function hasLiveCardInLiveZone(game: GameState, playerId: string): boolean {
  const player = getPlayerById(game, playerId);
  if (!player) {
    return false;
  }

  return player.liveZone.cardIds.some((cardId) => {
    const card = getCardById(game, cardId);
    return card !== null && isLiveCardData(card.data);
  });
}

function removePendingAbility(game: GameState, pendingAbilityId: string): GameState {
  return {
    ...game,
    pendingAbilities: game.pendingAbilities.filter((ability) => ability.id !== pendingAbilityId),
  };
}
