import { isLiveCardData } from '../../domain/entities/card.js';
import {
  addAction,
  getCardById,
  getPlayerById,
  updatePlayer,
  hasPendingAbilityOrChoice,
  type GameState,
} from '../../domain/entities/game.js';
import { shuffleZone } from '../../domain/entities/zone.js';
import { getHextechDefinition } from '../../domain/hextech/catalog.js';
import { hasPendingHextechInput } from '../../domain/hextech/state.js';
import { GamePhase, SubPhase, OrientationState, ZoneType } from '../../shared/types/enums.js';
import type { RandomIntegerSource } from '../../shared/random-source.js';
import { GameCommandType, type HextechAbilityCommand } from '../game-commands.js';
import { discardHandCardsToWaitingRoomAndEnqueueTriggers } from '../card-effects/runtime/enter-waiting-room-triggers.js';
import { waitStageMembersAndEnqueueTriggers } from '../card-effects/runtime/wait-stage-members.js';
import { enqueueTriggeredCardEffects } from '../card-effect-runner.js';
import { drawCardsFromMainDeckToHand } from '../effects/draw.js';
import { moveCardBetweenZones } from '../action-handlers/zone-operations.js';
import { continueHextechAcquisitions } from './acquire.js';

export function getHextechSearch(game: GameState) {
  const search = game.hextech?.pendingSearch;
  const source = game.hextech?.owned.find((item) => item.instanceId === search?.sourceInstanceId);
  if (!search || !source) return null;
  const player = getPlayerById(game, source.playerId)!;
  const candidates = [...player.mainDeck.cardIds, ...player.waitingRoom.cardIds].filter((id) => {
    const card = getCardById(game, id);
    return card?.ownerId === player.id && isLiveCardData(card.data);
  });
  return { source, candidates, count: Math.min(search.count, candidates.length) };
}

export function getHextechActivation(game: GameState, playerId: string, instanceId: string) {
  const owned = game.hextech?.owned.find(
    (item) => item.instanceId === instanceId && item.playerId === playerId
  );
  if (
    !owned ||
    game.isEnded ||
    hasPendingHextechInput(game) ||
    game.entranceRuntime?.pending ||
    game.currentPhase !== GamePhase.MAIN_PHASE ||
    game.currentSubPhase !== SubPhase.NONE ||
    game.players[game.activePlayerIndex].id !== playerId ||
    hasPendingAbilityOrChoice(game) ||
    game.checkTimingContext ||
    game.inspectionContext ||
    game.inspectionZone.cardIds.length > 0 ||
    game.delegatedAbilitySequence ||
    game.pendingSpecialMemberPlay
  )
    return null;
  if (
    game.actionHistory.some(
      (action) =>
        action.type === 'HEXTECH_ACTIVATED' &&
        action.payload.instanceId === instanceId &&
        action.payload.turn === game.turnCount
    )
  )
    return null;
  const kind = getHextechDefinition(owned.definitionId)?.effect.kind;
  const player = getPlayerById(game, playerId)!;
  if (kind === 'ACTIVATED_DISCARD_DRAW' && player.hand.cardIds.length) {
    return { kind, candidates: player.hand.cardIds, min: 1, max: player.hand.cardIds.length };
  }
  if (kind === 'WAITING_KANATA_SCORE_AND_REST') {
    const candidates = Object.values(player.memberSlots.slots).filter(
      (id): id is string =>
        !!id && player.memberSlots.cardStates.get(id)?.orientation === OrientationState.ACTIVE
    );
    if (candidates.length) return { kind, candidates, min: 1, max: 1 };
  }
  return null;
}

export function validateHextechAbilityCommand(
  game: GameState,
  command: HextechAbilityCommand
): string | null {
  const ids = command.selectedCardIds;
  if (
    !Array.isArray(ids) ||
    ids.some((id) => typeof id !== 'string') ||
    new Set(ids).size !== ids.length
  )
    return '海克斯选牌列表无效';
  if (command.type === GameCommandType.RESOLVE_HEXTECH_SEARCH) {
    const search = getHextechSearch(game);
    return !game.isEnded &&
      search?.source.playerId === command.playerId &&
      search.source.instanceId === command.instanceId &&
      ids.length === search.count &&
      ids.every((id) => search.candidates.includes(id))
      ? null
      : '海克斯检索已变化或选牌不合法';
  }
  const activation = getHextechActivation(game, command.playerId, command.instanceId);
  return activation &&
    ids.length >= activation.min &&
    ids.length <= activation.max &&
    ids.every((id) => activation.candidates.includes(id))
    ? null
    : '当前不能发动该海克斯或选牌不合法';
}

export function applyHextechAbilityCommand(
  game: GameState,
  command: HextechAbilityCommand,
  randomInt: RandomIntegerSource
): GameState {
  const { playerId, instanceId, selectedCardIds: ids } = command;
  if (command.type === GameCommandType.RESOLVE_HEXTECH_SEARCH) {
    const player = getPlayerById(game, playerId)!;
    let state = game;
    for (const id of ids) {
      const from = player.mainDeck.cardIds.includes(id)
        ? ZoneType.MAIN_DECK
        : ZoneType.WAITING_ROOM;
      state = moveCardBetweenZones(state, playerId, id, from, ZoneType.HAND);
    }
    // Searching the main deck hides its order again, even when all chosen cards came from waiting room.
    state = updatePlayer(state, playerId, (p) => ({
      ...p,
      mainDeck: shuffleZone(p.mainDeck, randomInt),
    }));
    state = addAction(state, 'SHUFFLE', playerId, {
      zone: ZoneType.MAIN_DECK,
      sourceHextechInstanceId: instanceId,
    });
    state = addAction(state, 'RESOLVE_ABILITY', playerId, {
      sourceHextechInstanceId: instanceId,
      selectedCardIds: ids,
    });
    state = { ...state, hextech: { ...state.hextech!, pendingSearch: undefined } };
    return continueHextechAcquisitions(state, randomInt);
  }
  const activation = getHextechActivation(game, playerId, instanceId)!;
  let state = addAction(game, 'HEXTECH_ACTIVATED', playerId, { instanceId, turn: game.turnCount });
  if (activation.kind === 'ACTIVATED_DISCARD_DRAW') {
    const allHand = getPlayerById(game, playerId)!.hand.cardIds.length === ids.length;
    state = discardHandCardsToWaitingRoomAndEnqueueTriggers(
      state,
      playerId,
      ids,
      { count: ids.length },
      enqueueTriggeredCardEffects
    )!.gameState;
    return drawCardsFromMainDeckToHand(state, playerId, ids.length + (allHand ? 1 : 0))!.gameState;
  }
  return waitStageMembersAndEnqueueTriggers(state, {
    playerId,
    memberCardIds: ids,
    cause: { kind: 'HEXTECH_EFFECT', playerId, sourceHextechInstanceId: instanceId },
    enqueueTriggeredCardEffects,
  }).gameState;
}
