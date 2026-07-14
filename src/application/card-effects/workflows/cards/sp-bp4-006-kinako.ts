import { isLiveCardData } from '../../../../domain/entities/card.js';
import {
  addAction,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { CardType } from '../../../../shared/types/enums.js';
import { cardBelongsToGroup } from '../../../../shared/utils/card-identity.js';
import {
  countCurrentLiveRevealedDifferentNamedCheerCards,
  moveRevealedCheerCards,
  selectRevealedCheerCardIds,
} from '../../../effects/cheer-selection.js';
import { SP_BP4_006_LIVE_SUCCESS_DIFFERENT_LIELLA_CHEER_LIVE_TO_HAND_ABILITY_ID } from '../../ability-ids.js';
import {
  registerPendingAbilityStarterHandler,
  type PendingAbilityStarterOptions,
} from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import {
  getAbilityEffectText,
  maybeStartConfirmablePendingAbilityConfirmation,
} from '../../runtime/workflow-helpers.js';

const SELECT_LIELLA_LIVE_STEP_ID = 'SP_BP4_006_SELECT_REVEALED_CHEER_LIELLA_LIVE';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerSpBp4006KinakoWorkflowHandlers(): void {
  registerPendingAbilityStarterHandler(
    SP_BP4_006_LIVE_SUCCESS_DIFFERENT_LIELLA_CHEER_LIVE_TO_HAND_ABILITY_ID,
    (game, ability, options, context) =>
      startSpBp4006KinakoLiveSuccess(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects,
        options
      )
  );
  registerActiveEffectStepHandler(
    SP_BP4_006_LIVE_SUCCESS_DIFFERENT_LIELLA_CHEER_LIVE_TO_HAND_ABILITY_ID,
    SELECT_LIELLA_LIVE_STEP_ID,
    (game, input, context) =>
      finishSpBp4006KinakoLiveSelection(
        game,
        input.selectedCardId ?? null,
        context.continuePendingCardEffects
      )
  );
}

function startSpBp4006KinakoLiveSuccess(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects,
  options: PendingAbilityStarterOptions
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  const context = getSpBp4006Context(game, player.id);
  if (!context.conditionMet || context.targetCardIds.length === 0) {
    const confirmation = maybeStartConfirmablePendingAbilityConfirmation(game, ability, options, {
      effectText: getSpBp4006ConfirmationEffectText(game, ability),
    });
    if (confirmation) {
      return confirmation;
    }
    return resolveSpBp4006NoInteraction(
      game,
      ability,
      orderedResolution,
      continuePendingCardEffects
    );
  }

  return addAction(
    {
      ...game,
      pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
      activeEffect: {
        id: ability.id,
        abilityId: ability.abilityId,
        sourceCardId: ability.sourceCardId,
        controllerId: ability.controllerId,
        effectText: getAbilityEffectText(ability.abilityId),
        stepId: SELECT_LIELLA_LIVE_STEP_ID,
        stepText: '请选择1张因声援公开且仍可移动的『Liella!』LIVE卡加入手牌。',
        awaitingPlayerId: player.id,
        selectableCardIds: context.targetCardIds,
        selectableCardVisibility: 'PUBLIC',
        selectableCardMode: 'SINGLE',
        selectionLabel: '选择要加入手牌的声援公开LIVE',
        confirmSelectionLabel: '加入手牌',
        metadata: {
          orderedResolution,
          publicCardSelectionConfirmation: {
            source: 'REVEALED_CHEER',
            destination: 'HAND',
          },
          differentNameLiellaMemberCount: context.differentNameLiellaMemberCount,
          movableLiellaLiveCount: context.targetCardIds.length,
        },
      },
    },
    'RESOLVE_ABILITY',
    player.id,
    {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: 'START_SELECT_REVEALED_CHEER_LIELLA_LIVE',
      differentNameLiellaMemberCount: context.differentNameLiellaMemberCount,
      conditionMet: context.conditionMet,
      selectableCardIds: context.targetCardIds,
    }
  );
}

function finishSpBp4006KinakoLiveSelection(
  game: GameState,
  selectedCardId: string | null,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !== SP_BP4_006_LIVE_SUCCESS_DIFFERENT_LIELLA_CHEER_LIVE_TO_HAND_ABILITY_ID ||
    effect.stepId !== SELECT_LIELLA_LIVE_STEP_ID ||
    !selectedCardId ||
    effect.selectableCardIds?.includes(selectedCardId) !== true
  ) {
    return game;
  }

  const player = getPlayerById(game, effect.controllerId);
  if (!player) {
    return game;
  }

  const moveResult = moveRevealedCheerCards(game, player.id, [selectedCardId], 'HAND');
  if (!moveResult) {
    return game;
  }

  return continuePendingCardEffects(
    addAction(
      {
        ...moveResult.gameState,
        activeEffect: null,
      },
      'RESOLVE_ABILITY',
      player.id,
      {
        pendingAbilityId: effect.id,
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
        step: 'MOVE_REVEALED_CHEER_LIELLA_LIVE_TO_HAND',
        movedCardIds: moveResult.movedCardIds,
        differentNameLiellaMemberCount: effect.metadata?.differentNameLiellaMemberCount,
      }
    ),
    effect.metadata?.orderedResolution === true
  );
}

function resolveSpBp4006NoInteraction(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  const context = getSpBp4006Context(game, player.id);
  const stateWithoutPending: GameState = {
    ...game,
    pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
  };

  return continuePendingCardEffects(
    addAction(stateWithoutPending, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: context.conditionMet ? 'NO_REVEALED_CHEER_LIELLA_LIVE_TARGET' : 'CONDITION_NOT_MET',
      differentNameLiellaMemberCount: context.differentNameLiellaMemberCount,
      movableLiellaLiveCount: context.targetCardIds.length,
      conditionMet: context.conditionMet,
      movedCardIds: [],
    }),
    orderedResolution
  );
}

function getSpBp4006ConfirmationEffectText(
  game: GameState,
  ability: PendingAbilityState
): string {
  const context = getSpBp4006Context(game, ability.controllerId);
  return `${getAbilityEffectText(ability.abilityId)}（当前不同名Liella!成员 ${context.differentNameLiellaMemberCount}名，可加入手牌的Liella! LIVE ${context.targetCardIds.length}张，${
    context.conditionMet
      ? context.targetCardIds.length > 0
        ? '满足条件，将进入选择'
        : '满足条件但无可移动目标，不加入手牌'
      : '未满足条件，不加入手牌'
  }）`;
}

function getSpBp4006Context(
  game: GameState,
  playerId: string
): {
  readonly differentNameLiellaMemberCount: number;
  readonly conditionMet: boolean;
  readonly targetCardIds: readonly string[];
} {
  const differentNames = countCurrentLiveRevealedDifferentNamedCheerCards(game, playerId, {
    cardTypes: CardType.MEMBER,
    groupAliases: ['Liella!'],
  });
  const targetCardIds = selectRevealedCheerCardIds(game, playerId, (card) =>
    isLiveCardData(card.data) && cardBelongsToGroup(card.data, 'Liella!')
  );
  return {
    differentNameLiellaMemberCount: differentNames.differentNameCount,
    conditionMet: differentNames.differentNameCount >= 3,
    targetCardIds,
  };
}
