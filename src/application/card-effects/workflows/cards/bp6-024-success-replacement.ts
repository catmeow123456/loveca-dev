import { isLiveCardData } from '../../../../domain/entities/card.js';
import {
  addAction,
  getCardById,
  getPlayerById,
  updatePlayer,
  type GameState,
} from '../../../../domain/entities/game.js';
import {
  addCardToZone,
  removeCardFromStatefulZone,
  removeCardFromZone,
} from '../../../../domain/entities/zone.js';
import { CardType, ZoneType } from '../../../../shared/types/enums.js';
import { cardCodeMatchesBase } from '../../../../shared/utils/card-code.js';
import { canLiveCardEnterSuccessZone } from '../../../../domain/rules/success-live-placement.js';
import { BP6_024_CONTINUOUS_SUCCESS_ZONE_REPLACEMENT_ABILITY_ID } from '../../ability-ids.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { and, groupIs, typeIs } from '../../../effects/card-selectors.js';
import { getCardIdsInZoneMatching } from '../../../effects/conditions.js';

export const BP6_024_SUCCESS_REPLACEMENT_STEP_ID =
  'BP6_024_SELECT_SUCCESS_REPLACEMENT_LIVE';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;
type SuccessZoneReplacementOrigin = 'LIVE_SUCCESS' | 'MAKI_HAND_SUCCESS_SWAP';

interface StartSuccessZoneReplacementOptions {
  readonly controllerId: string;
  readonly originalCardId: string;
  readonly origin: SuccessZoneReplacementOrigin;
  readonly successLiveCardId?: string;
}

export function registerBp6024SuccessReplacementWorkflowHandlers(): void {
  registerActiveEffectStepHandler(
    BP6_024_CONTINUOUS_SUCCESS_ZONE_REPLACEMENT_ABILITY_ID,
    BP6_024_SUCCESS_REPLACEMENT_STEP_ID,
    (game, input, context) =>
      finishSuccessZoneReplacementEffect(
        game,
        input.selectedCardId ?? null,
        context.continuePendingCardEffects
      )
  );
}

function isBp6024SuccessReplacementCard(game: GameState, cardId: string): boolean {
  const card = getCardById(game, cardId);
  return (
    card !== null &&
    isLiveCardData(card.data) &&
    cardCodeMatchesBase(card.data.cardCode, 'PL!-bp6-024')
  );
}

function getBp6024ReplacementCandidateIds(game: GameState, playerId: string): readonly string[] {
  return getCardIdsInZoneMatching(
    game,
    playerId,
    ZoneType.WAITING_ROOM,
    and(typeIs(CardType.LIVE), groupIs("μ's"))
  ).filter((cardId) => canLiveCardEnterSuccessZone(game, playerId, cardId));
}

export function startSuccessZoneReplacementEffect(
  game: GameState,
  options: StartSuccessZoneReplacementOptions
): GameState | null {
  if (!isBp6024SuccessReplacementCard(game, options.originalCardId)) {
    return null;
  }
  const player = getPlayerById(game, options.controllerId);
  if (!player) {
    return null;
  }
  const selectableCardIds = getBp6024ReplacementCandidateIds(game, player.id);
  if (selectableCardIds.length === 0) {
    return null;
  }

  return addAction(
    {
      ...game,
      activeEffect: {
        id: `${BP6_024_CONTINUOUS_SUCCESS_ZONE_REPLACEMENT_ABILITY_ID}:${options.originalCardId}:${game.actionHistory.length}`,
        abilityId: BP6_024_CONTINUOUS_SUCCESS_ZONE_REPLACEMENT_ABILITY_ID,
        sourceCardId: options.originalCardId,
        controllerId: player.id,
        effectText:
          "【常时】此卡放置入成功LIVE卡区的场合，可以改为从自己的休息室将1张[μ's]的LIVE卡放置入成功LIVE卡区。",
        stepId: BP6_024_SUCCESS_REPLACEMENT_STEP_ID,
        stepText:
          "可以改为从自己的休息室选择1张『μ's』LIVE卡放置入成功LIVE卡区。",
        awaitingPlayerId: player.id,
        selectableCardIds,
        selectableCardVisibility: 'PUBLIC',
        canSkipSelection: true,
        skipSelectionLabel: '不替代',
        selectionLabel: "选择要放置入成功LIVE卡区的『μ's』LIVE",
        metadata: {
          successZoneReplacement: true,
          origin: options.origin,
          originalCardId: options.originalCardId,
          successLiveCardId: options.successLiveCardId,
          orderedResolution: game.activeEffect?.metadata?.orderedResolution === true,
        },
      },
    },
    'RESOLVE_ABILITY',
    player.id,
    {
      abilityId: BP6_024_CONTINUOUS_SUCCESS_ZONE_REPLACEMENT_ABILITY_ID,
      sourceCardId: options.originalCardId,
      step: 'START_SUCCESS_ZONE_REPLACEMENT',
      origin: options.origin,
      selectableCardIds,
    }
  );
}

function markLiveSuccessCardMoved(
  game: GameState,
  playerId: string,
  liveCardId: string
): GameState {
  const successCardMovedBy = game.liveResolution.successCardMovedBy.includes(playerId)
    ? game.liveResolution.successCardMovedBy
    : [...game.liveResolution.successCardMovedBy, playerId];
  const settlementConfirmedBy = game.liveResolution.settlementConfirmedBy.includes(playerId)
    ? game.liveResolution.settlementConfirmedBy
    : [...game.liveResolution.settlementConfirmedBy, playerId];
  return {
    ...game,
    liveResolution: {
      ...game.liveResolution,
      liveResults: new Map(game.liveResolution.liveResults).set(liveCardId, true),
      successCardMovedBy,
      settlementConfirmedBy,
    },
  };
}

function finishLiveSuccessReplacementEffect(
  game: GameState,
  playerId: string,
  originalCardId: string,
  replacementCardId: string | null
): GameState {
  let state = replacementCardId
    ? updatePlayer(game, playerId, (currentPlayer) => ({
        ...currentPlayer,
        waitingRoom: removeCardFromZone(currentPlayer.waitingRoom, replacementCardId),
        successZone: addCardToZone(currentPlayer.successZone, replacementCardId),
      }))
    : updatePlayer(game, playerId, (currentPlayer) => ({
        ...currentPlayer,
        liveZone: removeCardFromStatefulZone(currentPlayer.liveZone, originalCardId),
        successZone: addCardToZone(currentPlayer.successZone, originalCardId),
      }));

  state = markLiveSuccessCardMoved(state, playerId, originalCardId);
  return state;
}

function finishMakiSuccessReplacementEffect(
  game: GameState,
  playerId: string,
  handLiveCardId: string,
  successLiveCardId: string,
  replacementCardId: string | null
): GameState {
  return replacementCardId
    ? updatePlayer(game, playerId, (currentPlayer) => ({
        ...currentPlayer,
        hand: {
          ...currentPlayer.hand,
          cardIds: [...currentPlayer.hand.cardIds, successLiveCardId],
        },
        waitingRoom: removeCardFromZone(currentPlayer.waitingRoom, replacementCardId),
        successZone: {
          ...currentPlayer.successZone,
          cardIds: [
            ...currentPlayer.successZone.cardIds.filter((cardId) => cardId !== successLiveCardId),
            replacementCardId,
          ],
        },
      }))
    : updatePlayer(game, playerId, (currentPlayer) => ({
        ...currentPlayer,
        hand: {
          ...currentPlayer.hand,
          cardIds: [
            ...currentPlayer.hand.cardIds.filter((cardId) => cardId !== handLiveCardId),
            successLiveCardId,
          ],
        },
        successZone: {
          ...currentPlayer.successZone,
          cardIds: [
            ...currentPlayer.successZone.cardIds.filter((cardId) => cardId !== successLiveCardId),
            handLiveCardId,
          ],
        },
      }));
}

function finishSuccessZoneReplacementEffect(
  game: GameState,
  selectedCardId: string | null,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  if (!effect) {
    return game;
  }
  const player = getPlayerById(game, effect.controllerId);
  const originalCardId =
    typeof effect.metadata?.originalCardId === 'string' ? effect.metadata.originalCardId : null;
  const origin =
    effect.metadata?.origin === 'LIVE_SUCCESS' ||
    effect.metadata?.origin === 'MAKI_HAND_SUCCESS_SWAP'
      ? effect.metadata.origin
      : null;
  if (!player || originalCardId === null || origin === null) {
    return finishSkipEffect(game, continuePendingCardEffects);
  }

  const replacementCardId =
    selectedCardId !== null && effect.selectableCardIds?.includes(selectedCardId)
      ? selectedCardId
      : null;
  let state = game;

  if (origin === 'LIVE_SUCCESS') {
    state = finishLiveSuccessReplacementEffect(state, player.id, originalCardId, replacementCardId);
  } else {
    const successLiveCardId =
      typeof effect.metadata?.successLiveCardId === 'string'
        ? effect.metadata.successLiveCardId
        : null;
    if (successLiveCardId === null) {
      return finishSkipEffect(game, continuePendingCardEffects);
    }
    state = finishMakiSuccessReplacementEffect(
      state,
      player.id,
      originalCardId,
      successLiveCardId,
      replacementCardId
    );
  }

  state = { ...state, activeEffect: null };
  return continuePendingCardEffects(
    addAction(state, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: replacementCardId ? 'FINISH_REPLACE' : 'FINISH_SKIP',
      origin,
      originalCardId,
      replacementCardId,
    }),
    effect.metadata?.orderedResolution === true
  );
}

function finishSkipEffect(
  game: GameState,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  if (!effect) {
    return game;
  }
  const player = getPlayerById(game, effect.controllerId);
  if (!player) {
    return game;
  }
  const state = { ...game, activeEffect: null };
  return continuePendingCardEffects(
    addAction(state, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'SKIP',
    }),
    effect.metadata?.orderedResolution === true
  );
}
