import {
  addAction,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { findMemberSlot } from '../../../../domain/entities/player.js';
import { ZoneType } from '../../../../shared/types/enums.js';
import { S_SD1_004_LIVE_START_DRAW_ONE_HAND_TWO_TO_DECK_TOP_ABILITY_ID } from '../../ability-ids.js';
import { drawCardsForPlayer, moveHandCardsToDeckTopForPlayer } from '../../runtime/actions.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText } from '../../runtime/workflow-helpers.js';

const ABILITY_ID = S_SD1_004_LIVE_START_DRAW_ONE_HAND_TWO_TO_DECK_TOP_ABILITY_ID;
const CHOOSE_RESOLUTION_STEP_ID = 'S_SD1_004_CHOOSE_DRAW_AND_RETURN_HAND_TO_DECK_TOP';
const SELECT_HAND_TO_DECK_TOP_STEP_ID = 'S_SD1_004_SELECT_HAND_TO_DECK_TOP';
const DRAW_COUNT = 1;
const RETURN_COUNT = 2;

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerSSd1004DiaWorkflowHandlers(): void {
  registerPendingAbilityStarterHandler(ABILITY_ID, (game, ability, options, context) =>
    startSSd1004DiaLiveStart(
      game,
      ability,
      options.orderedResolution === true,
      context.continuePendingCardEffects
    )
  );
  registerActiveEffectStepHandler(ABILITY_ID, CHOOSE_RESOLUTION_STEP_ID, (game, input, context) =>
    finishSSd1004DiaChoice(
      game,
      input.selectedOptionId ?? null,
      context.continuePendingCardEffects
    )
  );
  registerActiveEffectStepHandler(ABILITY_ID, SELECT_HAND_TO_DECK_TOP_STEP_ID, (game, input, context) =>
    finishSSd1004DiaHandToDeckTopSelection(
      game,
      input.selectedCardIds ?? [],
      context.continuePendingCardEffects
    )
  );
}

function startSSd1004DiaLiveStart(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  if (!isSourceOnOwnStage(game, player.id, ability.sourceCardId)) {
    return resolveNoOp(game, ability, player.id, orderedResolution, continuePendingCardEffects, {
      step: 'SOURCE_NOT_ON_STAGE',
    });
  }

  return addAction(
    {
      ...removePendingAbility(game, ability.id),
      activeEffect: {
        id: ability.id,
        abilityId: ability.abilityId,
        sourceCardId: ability.sourceCardId,
        controllerId: ability.controllerId,
        effectText: getAbilityEffectText(ability.abilityId),
        stepId: CHOOSE_RESOLUTION_STEP_ID,
        stepText: '可以发动此效果。发动时，抽1张卡，然后选择2张手牌按顺序放置到卡组顶。',
        awaitingPlayerId: player.id,
        selectableOptions: [{ id: 'draw', label: '发动' }],
        canSkipSelection: true,
        skipSelectionLabel: '不发动',
        metadata: {
          orderedResolution,
        },
      },
    },
    'RESOLVE_ABILITY',
    player.id,
    {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: 'START_OPTIONAL_DRAW',
    }
  );
}

function finishSSd1004DiaChoice(
  game: GameState,
  selectedOptionId: string | null,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  if (!effect || effect.abilityId !== ABILITY_ID || effect.stepId !== CHOOSE_RESOLUTION_STEP_ID) {
    return game;
  }
  const player = getPlayerById(game, effect.controllerId);
  if (!player) {
    return game;
  }

  if (selectedOptionId !== 'draw') {
    return finishEffect(game, effect, continuePendingCardEffects, {
      step: 'DECLINE',
    });
  }

  if (!isSourceOnOwnStage(game, player.id, effect.sourceCardId)) {
    return finishEffect(game, effect, continuePendingCardEffects, {
      step: 'SOURCE_NOT_ON_STAGE',
    });
  }

  const drawResult = drawCardsForPlayer(game, player.id, DRAW_COUNT);
  if (!drawResult || drawResult.drawnCardIds.length !== DRAW_COUNT) {
    return finishEffect(drawResult?.gameState ?? game, effect, continuePendingCardEffects, {
      step: 'DRAW_FAILED',
      drawnCardIds: drawResult?.drawnCardIds ?? [],
    });
  }

  const playerAfterDraw = getPlayerById(drawResult.gameState, player.id);
  const selectableCardIds = playerAfterDraw?.hand.cardIds ?? [];
  if (selectableCardIds.length < RETURN_COUNT) {
    return finishEffect(drawResult.gameState, effect, continuePendingCardEffects, {
      step: 'DRAWN_BUT_HAND_LESS_THAN_TWO',
      drawnCardIds: drawResult.drawnCardIds,
      selectableCardIds,
    });
  }

  return addAction(
    {
      ...drawResult.gameState,
      activeEffect: {
        id: effect.id,
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
        controllerId: effect.controllerId,
        effectText: effect.effectText,
        stepId: SELECT_HAND_TO_DECK_TOP_STEP_ID,
        stepText: '已抽1张卡。请选择2张手牌，并按放置到卡组顶的顺序选择。',
        awaitingPlayerId: player.id,
        selectableCardIds,
        selectableCardVisibility: 'AWAITING_PLAYER_ONLY',
        selectableCardMode: 'ORDERED_MULTI',
        minSelectableCards: RETURN_COUNT,
        maxSelectableCards: RETURN_COUNT,
        selectionLabel: '选择放置到卡组顶的手牌',
        confirmSelectionLabel: '放置到卡组顶',
        metadata: {
          orderedResolution: effect.metadata?.orderedResolution === true,
          sourceZone: ZoneType.HAND,
          destination: ZoneType.MAIN_DECK,
          drawnCardIds: drawResult.drawnCardIds,
        },
      },
    },
    'RESOLVE_ABILITY',
    player.id,
    {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'DRAW_ONE_SELECT_HAND_TO_DECK_TOP',
      drawnCardIds: drawResult.drawnCardIds,
      selectableCardIds,
    }
  );
}

function finishSSd1004DiaHandToDeckTopSelection(
  game: GameState,
  selectedCardIds: readonly string[],
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  if (!effect || effect.abilityId !== ABILITY_ID || effect.stepId !== SELECT_HAND_TO_DECK_TOP_STEP_ID) {
    return game;
  }
  const player = getPlayerById(game, effect.controllerId);
  if (!player) {
    return game;
  }

  if (!isSourceOnOwnStage(game, player.id, effect.sourceCardId)) {
    return finishEffect(game, effect, continuePendingCardEffects, {
      step: 'SOURCE_NOT_ON_STAGE',
      drawnCardIds: getStringArrayMetadata(effect.metadata?.drawnCardIds),
    });
  }

  const uniqueSelectedCardIds = [...new Set(selectedCardIds)];
  const currentSelectableCardIds = player.hand.cardIds.filter(
    (cardId) => effect.selectableCardIds?.includes(cardId) === true
  );
  if (
    uniqueSelectedCardIds.length !== selectedCardIds.length ||
    selectedCardIds.length !== RETURN_COUNT ||
    selectedCardIds.some((cardId) => !currentSelectableCardIds.includes(cardId))
  ) {
    return finishEffect(game, effect, continuePendingCardEffects, {
      step: 'STALE_OR_INVALID_HAND_SELECTION',
      drawnCardIds: getStringArrayMetadata(effect.metadata?.drawnCardIds),
      selectedCardIds,
      selectableCardIds: currentSelectableCardIds,
      movedCardIds: [],
    });
  }

  const moveResult = moveHandCardsToDeckTopForPlayer(game, player.id, selectedCardIds, {
    candidateCardIds: currentSelectableCardIds,
    exactCount: RETURN_COUNT,
  });
  if (!moveResult) {
    return finishEffect(game, effect, continuePendingCardEffects, {
      step: 'MOVE_HAND_TO_DECK_TOP_FAILED',
      drawnCardIds: getStringArrayMetadata(effect.metadata?.drawnCardIds),
      selectedCardIds,
      selectableCardIds: currentSelectableCardIds,
      movedCardIds: [],
    });
  }

  return finishEffect(moveResult.gameState, effect, continuePendingCardEffects, {
    step: 'HAND_CARDS_TO_DECK_TOP',
    drawnCardIds: getStringArrayMetadata(effect.metadata?.drawnCardIds),
    selectedCardIds: moveResult.selectedCardIds,
    movedCardIds: moveResult.movedCardIds,
  });
}

function finishEffect(
  game: GameState,
  effect: NonNullable<GameState['activeEffect']>,
  continuePendingCardEffects: ContinuePendingCardEffects,
  payload: Readonly<Record<string, unknown>>
): GameState {
  const player = getPlayerById(game, effect.controllerId);
  if (!player) {
    return game;
  }
  return continuePendingCardEffects(
    addAction({ ...game, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      ...payload,
    }),
    effect.metadata?.orderedResolution === true
  );
}

function resolveNoOp(
  game: GameState,
  ability: PendingAbilityState,
  playerId: string,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects,
  payload: Readonly<Record<string, unknown>>
): GameState {
  return continuePendingCardEffects(
    addAction(removePendingAbility(game, ability.id), 'RESOLVE_ABILITY', playerId, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      ...payload,
    }),
    orderedResolution
  );
}

function isSourceOnOwnStage(game: GameState, playerId: string, sourceCardId: string): boolean {
  const player = getPlayerById(game, playerId);
  return player ? findMemberSlot(player, sourceCardId) !== null : false;
}

function removePendingAbility(game: GameState, pendingAbilityId: string): GameState {
  return {
    ...game,
    pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== pendingAbilityId),
  };
}

function getStringArrayMetadata(value: unknown): readonly string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string') ? value : [];
}
