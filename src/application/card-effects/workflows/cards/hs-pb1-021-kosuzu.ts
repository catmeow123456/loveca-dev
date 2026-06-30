import {
  addAction,
  getCardById,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { unitAliasIs } from '../../../effects/card-selectors.js';
import { HS_PB1_021_LIVE_SUCCESS_DOLLCHESTRA_LIVE_ZONE_DRAW_ABILITY_ID } from '../../ability-ids.js';
import { drawCardsForPlayer } from '../../runtime/actions.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { maybeStartConfirmablePendingAbilityConfirmation } from '../../runtime/workflow-helpers.js';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerHsPb1021KosuzuWorkflowHandlers(): void {
  registerPendingAbilityStarterHandler(
    HS_PB1_021_LIVE_SUCCESS_DOLLCHESTRA_LIVE_ZONE_DRAW_ABILITY_ID,
    (game, ability, options, context) =>
      startHsPb1021KosuzuLiveSuccess(
        game,
        ability,
        {
          orderedResolution: options.orderedResolution === true,
          manualConfirmation: options.manualConfirmation === true,
          confirmBeforeResolution: options.confirmBeforeResolution === true,
          skipManualConfirmation: options.skipManualConfirmation === true,
        },
        context.continuePendingCardEffects
      )
  );
}

function startHsPb1021KosuzuLiveSuccess(
  game: GameState,
  ability: PendingAbilityState,
  options: {
    readonly orderedResolution: boolean;
    readonly manualConfirmation: boolean;
    readonly confirmBeforeResolution: boolean;
    readonly skipManualConfirmation: boolean;
  },
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  if ((options.manualConfirmation || options.confirmBeforeResolution) && !options.skipManualConfirmation) {
    const dollchestraLiveZoneCardIds = getDollchestraLiveZoneCardIds(game, player.id);
    const conditionMet = dollchestraLiveZoneCardIds.length > 0;
    return maybeStartConfirmablePendingAbilityConfirmation(game, ability, options, {
      stepText: conditionMet
        ? '自己的LIVE卡区存在『DOLLCHESTRA』卡片，条件满足。确认后抽 1 张卡。'
        : '自己的LIVE卡区不存在『DOLLCHESTRA』卡片，条件不满足。确认后不抽牌。',
    }) ?? game;
  }

  return resolveHsPb1021KosuzuLiveSuccess(
    game,
    ability,
    options.orderedResolution,
    continuePendingCardEffects
  );
}

function resolveHsPb1021KosuzuLiveSuccess(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  const dollchestraLiveZoneCardIds = getDollchestraLiveZoneCardIds(game, player.id);
  const conditionMet = dollchestraLiveZoneCardIds.length > 0;
  const stateWithoutPending: GameState = {
    ...game,
    pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
  };
  const drawResult = conditionMet ? drawCardsForPlayer(stateWithoutPending, player.id, 1) : null;
  const state = drawResult?.gameState ?? stateWithoutPending;

  return continuePendingCardEffects(
    addAction(state, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: 'LIVE_SUCCESS_DOLLCHESTRA_LIVE_ZONE_DRAW',
      dollchestraLiveZoneCardIds,
      conditionMet,
      drawnCardIds: drawResult?.drawnCardIds ?? [],
    }),
    orderedResolution
  );
}

function getDollchestraLiveZoneCardIds(game: GameState, playerId: string): readonly string[] {
  const player = getPlayerById(game, playerId);
  const isDollchestraCard = unitAliasIs('DOLLCHESTRA');
  if (!player) {
    return [];
  }

  return player.liveZone.cardIds.filter((cardId) => {
    const card = getCardById(game, cardId);
    return card ? isDollchestraCard(card) : false;
  });
}
