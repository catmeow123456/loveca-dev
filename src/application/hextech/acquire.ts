import {
  addAction,
  emitGameEvent,
  getCardById,
  getPlayerById,
  type GameState,
} from '../../domain/entities/game.js';
import { isLiveCardData, isMemberCardData } from '../../domain/entities/card.js';
import { createEnterWaitingRoomEvent } from '../../domain/events/game-events.js';
import { getHextechAcquisitionStage } from '../../domain/hextech/bonuses.js';
import { moveCardBetweenZones } from '../action-handlers/zone-operations.js';
import { enqueueTriggeredCardEffects } from '../card-effect-runner.js';
import {
  getHextechDefinition,
  HEXTECH_RULES_VERSION,
  HEXTECH_DEFINITIONS,
  type HextechId,
} from '../../domain/hextech/catalog.js';
import type { GameOperationResult } from '../game-service.js';
import { drawCardsFromMainDeckToHand } from '../effects/draw.js';
import type { InitialHextechSetup } from '../../domain/hextech/state.js';
import { GamePhase, TriggerCondition, ZoneType } from '../../shared/types/enums.js';
import { secureRandomInt, type RandomIntegerSource } from '../../shared/random-source.js';
import { discardHandCardsToWaitingRoomAndEnqueueTriggers } from '../card-effects/runtime/enter-waiting-room-triggers.js';

export function validateInitialHextechSetup(setup: InitialHextechSetup): void {
  if (
    !Array.isArray(setup) ||
    setup.length !== 2 ||
    setup.some(
      (ids) =>
        !Array.isArray(ids) ||
        new Set(ids).size !== ids.length ||
        ids.some((id) => typeof id !== 'string' || !getHextechDefinition(id))
    )
  ) {
    throw new Error('海克斯开局配置需要双方各自的已实现条目，且同一玩家不能重复选择');
  }
}

export function applyInitialHextechGrants(
  game: GameState,
  randomInt: RandomIntegerSource = secureRandomInt
): GameState {
  if (
    !game.hextech?.initialGrants ||
    game.currentPhase !== GamePhase.ACTIVE_PHASE ||
    game.turnCount !== 1
  ) {
    return game;
  }
  const { initialGrants, ...hextech } = game.hextech;
  const state: GameState = { ...game, hextech };
  const grants: HextechGrant[] = [];
  for (const index of [game.firstPlayerIndex, 1 - game.firstPlayerIndex]) {
    for (const definitionId of initialGrants[index]) {
      grants.push({
        playerId: game.players[index].id,
        definitionId,
        instanceId: `hextech:initial:${index}:${definitionId}`,
      });
    }
  }
  const result = acquireHextechBatch(state, grants, randomInt);
  if (!result.success) throw new Error(result.error);
  return result.gameState;
}

export interface HextechGrant {
  readonly playerId: string;
  readonly definitionId: HextechId;
  readonly instanceId: string;
}

/** Trusted application primitive; the local setup caller supplies validated definitions. */
export function acquireHextech(
  game: GameState,
  playerId: string,
  definitionId: HextechId,
  instanceId: string,
  randomInt: RandomIntegerSource = secureRandomInt
): GameOperationResult {
  return acquireHextechBatch(game, [{ playerId, definitionId, instanceId }], randomInt);
}

/** Register simultaneous ownership first, then settle acquisition effects in first-player order. */
export function acquireHextechBatch(
  game: GameState,
  grants: readonly HextechGrant[],
  randomInt: RandomIntegerSource
): GameOperationResult {
  let state = game;
  for (const grant of grants) {
    const result = registerHextech(state, grant);
    if (!result.success) return { ...result, gameState: game };
    state = result.gameState;
  }
  return { success: true, gameState: continueHextechAcquisitions(state, randomInt) };
}

function registerHextech(
  game: GameState,
  { playerId, definitionId, instanceId }: HextechGrant
): GameOperationResult {
  const definition = getHextechDefinition(definitionId);
  if (
    !game.hextech ||
    game.hextech.rulesVersion !== HEXTECH_RULES_VERSION ||
    game.rulesetId !== 'STANDARD' ||
    !game.isStarted ||
    game.isEnded ||
    !getPlayerById(game, playerId) ||
    !definition ||
    !instanceId ||
    game.hextech.owned.some((owned) => owned.instanceId === instanceId)
  ) {
    return { success: false, gameState: game, error: '无法取得该海克斯' };
  }

  let state: GameState = {
    ...game,
    hextech: {
      ...game.hextech,
      owned: [
        ...game.hextech.owned,
        {
          instanceId,
          definitionId,
          playerId,
          acquiredTurn: game.turnCount,
        },
      ],
      acquisitionQueue: [...(game.hextech.acquisitionQueue ?? []), instanceId],
    },
  };
  state = addAction(state, 'HEXTECH_ACQUIRED', playerId, { definitionId, instanceId });
  return { success: true, gameState: state };
}

export function continueHextechAcquisitions(
  game: GameState,
  randomInt: RandomIntegerSource
): GameState {
  let state = game;
  while (state.hextech?.acquisitionQueue?.length && !state.hextech.pendingSearch) {
    const [instanceId, ...remaining] = state.hextech.acquisitionQueue;
    const owned = state.hextech.owned.find((item) => item.instanceId === instanceId)!;
    const { playerId, definitionId } = owned;
    const definition = getHextechDefinition(definitionId)!;
    state = {
      ...state,
      hextech: { ...state.hextech, acquisitionQueue: remaining.length ? remaining : undefined },
    };
    if (definition.effect.kind === 'ACQUIRE_RANDOM_HEXTECH') {
      const rarity = definition.effect.rarity;
      const pool = HEXTECH_DEFINITIONS.filter((item) => item.rarity === rarity);
      const childId = `${instanceId}:upgrade`;
      const result = registerHextech(state, {
        playerId,
        definitionId: pool[randomInt(pool.length)].id,
        instanceId: childId,
      });
      if (!result.success) throw new Error(result.error);
      state = {
        ...result.gameState,
        hextech: { ...result.gameState.hextech!, acquisitionQueue: [childId, ...remaining] },
      };
      continue;
    }
    if (definition.effect.kind === 'ACQUIRE_DRAW') {
      state = drawCardsFromMainDeckToHand(state, playerId, definition.effect.count)!.gameState;
    }
    if (definition.effect.kind === 'ACQUIRE_AND_TURN_DRAW') {
      state = drawCardsFromMainDeckToHand(
        state,
        playerId,
        getHextechAcquisitionStage(state.turnCount)
      )!.gameState;
    }
    if (definition.effect.kind === 'ACQUIRE_MEMBERS_FOR_LIVES') {
      const ids = getPlayerById(state, playerId)!.hand.cardIds.filter((id) => {
        const card = getCardById(state, id);
        return card && isMemberCardData(card.data);
      });
      if (ids.length) {
        state = discardHandCardsToWaitingRoomAndEnqueueTriggers(
          state,
          playerId,
          ids,
          { count: ids.length },
          enqueueTriggeredCardEffects
        )!.gameState;
        state = {
          ...state,
          hextech: {
            ...state.hextech!,
            pendingSearch: { sourceInstanceId: instanceId, count: ids.length },
          },
        };
      }
    }
    if (definition.effect.kind === 'ACQUIRE_CLEAR_SUCCESS_ZONES') {
      const events = [];
      for (const player of state.players) {
        const ids = player.successZone.cardIds.filter((id) => {
          const card = getCardById(state, id);
          return card && isLiveCardData(card.data);
        });
        for (const id of ids) {
          state = moveCardBetweenZones(
            state,
            player.id,
            id,
            ZoneType.SUCCESS_ZONE,
            ZoneType.WAITING_ROOM
          );
        }
        if (ids.length > 0) {
          const event = createEnterWaitingRoomEvent(
            ids,
            ZoneType.SUCCESS_ZONE,
            player.id,
            player.id
          );
          state = emitGameEvent(state, event);
          events.push(event);
        }
      }
      // Both zones change before any resulting card ability is allowed to resolve.
      if (events.length > 0) {
        state = enqueueTriggeredCardEffects(state, [TriggerCondition.ON_ENTER_WAITING_ROOM], {
          enterWaitingRoomEvents: events,
        });
      }
    }
  }
  return state;
}
