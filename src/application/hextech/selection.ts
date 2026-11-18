import { emitGameEvent, type GameState } from '../../domain/entities/game.js';
import { createTurnStartEvent } from '../../domain/events/game-events.js';
import {
  getHextechDefinitions,
  getHextechDefinition,
  hextechPoolForVersion,
  type HextechDefinition,
  type HextechRarity,
} from '../../domain/hextech/catalog.js';
import { HEXTECH_SELECTION_TURNS, type HextechOffer } from '../../domain/hextech/state.js';
import {
  HEXTECH_FIRST_ROUND_EXCLUSIONS,
  getHextechRarityWeights,
} from '../../domain/hextech/selection-rules.js';
import { GamePhase, SubPhase } from '../../shared/types/enums.js';
import type { RandomIntegerSource } from '../../shared/random-source.js';
import { GameCommandType, type HextechCommand } from '../game-commands.js';
import { acquireHextechBatch } from './acquire.js';

export function openHextechSelection(game: GameState, randomInt: RandomIntegerSource): GameState {
  const draft = game.hextech?.draft;
  if (
    !draft ||
    draft.pending ||
    game.isEnded ||
    game.currentPhase !== GamePhase.ACTIVE_PHASE ||
    game.turnCount !== HEXTECH_SELECTION_TURNS[draft.completedRounds]
  )
    return game;
  const isDark = hextechPoolForVersion(game.hextech!.rulesVersion) === 'DARK';
  const [silver, gold, prismatic] = getHextechRarityWeights(
    isDark ? 'DARK' : 'NORMAL',
    game.turnCount
  );
  const roll = randomInt(silver + gold + prismatic);
  const rarity: HextechRarity =
    roll < silver ? 'SILVER' : roll < silver + gold ? 'GOLD' : 'PRISMATIC';
  const drawOffer = (playerId: string): HextechOffer => {
    let pool = eligiblePool(game, playerId, rarity);
    if (pool.length < 3) throw new Error('海克斯候选池不足三项');
    if (isDark) {
      // At most eight definitions per tier: sample uniformly from legal mixed triples,
      // then randomize their positions so no slot is tied to a particular group.
      const triples: (typeof pool)[] = [];
      for (let first = 0; first < pool.length - 2; first++)
        for (let second = first + 1; second < pool.length - 1; second++)
          for (let third = second + 1; third < pool.length; third++) {
            const triple = [pool[first], pool[second], pool[third]];
            if (hasBothDarkGroups(triple)) triples.push(triple);
          }
      if (!triples.length) throw new Error('黑暗海克斯候选需要同时包含干扰和双刃剑');
      pool = triples[randomInt(triples.length)];
    }
    return {
      candidates: Array.from({ length: 3 }, () => ({
        definitionId: pool.splice(randomInt(pool.length), 1)[0].id,
        rerolled: false,
      })),
    };
  };
  const state =
    game.turnCount === 1
      ? emitGameEvent(game, createTurnStartEvent(1, game.players[game.firstPlayerIndex].id))
      : game;
  return {
    ...state,
    currentSubPhase: SubPhase.NONE,
    hextech: {
      ...game.hextech!,
      draft: {
        ...draft,
        pending: {
          turn: game.turnCount,
          rarity,
          offers: [drawOffer(game.players[0].id), drawOffer(game.players[1].id)],
        },
      },
    },
  };
}

export function validateHextechCommand(game: GameState, command: HextechCommand): string | null {
  const pending = game.hextech?.draft?.pending;
  if (game.isEnded || !pending || pending.turn !== command.selectionTurn)
    return '海克斯选择窗口已失效';
  const index = game.players.findIndex((player) => player.id === command.playerId);
  const offer = pending.offers[index];
  if (!offer || offer.selectedIndex !== undefined) return '海克斯选择已确认，无法更改';
  if (
    !Number.isInteger(command.slot) ||
    command.slot < 0 ||
    command.slot > 2 ||
    offer.candidates[command.slot].definitionId !== command.expectedDefinitionId
  )
    return '海克斯候选已变化，请重新选择';
  if (command.type === GameCommandType.REROLL_HEXTECH && offer.candidates[command.slot].rerolled)
    return '该候选已经重抽过一次';
  return null;
}

/** Caller validates the command before consuming randomness. No candidate IDs enter public events. */
export function applyHextechCommand(
  game: GameState,
  command: HextechCommand,
  randomInt: RandomIntegerSource
): GameState {
  const draft = game.hextech!.draft!;
  const pending = draft.pending!;
  const playerIndex = game.players.findIndex((player) => player.id === command.playerId);
  const offers: [HextechOffer, HextechOffer] = [...pending.offers];
  const offer = offers[playerIndex];
  if (command.type === GameCommandType.REROLL_HEXTECH) {
    const old = offer.candidates[command.slot];
    const pool = rerollPool(game, command.playerId, pending.rarity, offer, old.definitionId);
    const replacement = pool[randomInt(pool.length)];
    offers[playerIndex] = {
      candidates: offer.candidates.map((candidate, index) =>
        index === command.slot ? { definitionId: replacement.id, rerolled: true } : candidate
      ),
    };
  } else {
    offers[playerIndex] = { ...offer, selectedIndex: command.slot };
  }
  if (!offers.every((entry) => entry.selectedIndex !== undefined)) {
    return {
      ...game,
      hextech: { ...game.hextech!, draft: { ...draft, pending: { ...pending, offers } } },
    };
  }
  let state: GameState = {
    ...game,
    hextech: { ...game.hextech!, draft: { completedRounds: draft.completedRounds + 1 } },
  };
  const result = acquireHextechBatch(
    state,
    [game.firstPlayerIndex, 1 - game.firstPlayerIndex].map((index) => ({
      playerId: game.players[index].id,
      definitionId: offers[index].candidates[offers[index].selectedIndex!].definitionId,
      instanceId: `hextech:round:${pending.turn}:${index}`,
    })),
    randomInt
  );
  if (!result.success) throw new Error(result.error);
  return result.gameState;
}

function eligiblePool(game: GameState, playerId: string, rarity: HextechRarity) {
  const pool = hextechPoolForVersion(game.hextech!.rulesVersion);
  const owned = new Set(
    game
      .hextech!.owned.filter((entry) => entry.playerId === playerId)
      .map((entry) => entry.definitionId)
  );
  return getHextechDefinitions(pool).filter(
    (entry) =>
      entry.rarity === rarity &&
      (pool !== 'DARK' || !owned.has(entry.id)) &&
      (game.turnCount !== 1 || !HEXTECH_FIRST_ROUND_EXCLUSIONS[pool].includes(entry.id))
  );
}

function hasBothDarkGroups(entries: readonly HextechDefinition[]): boolean {
  return (
    entries.some((entry) => entry.group === 'DISRUPTION') &&
    entries.some((entry) => entry.group === 'DOUBLE_EDGED')
  );
}

function rerollPool(
  game: GameState,
  playerId: string,
  rarity: HextechRarity,
  offer: HextechOffer,
  oldId: string
) {
  const pool = eligiblePool(game, playerId, rarity).filter((entry) => entry.id !== oldId);
  const fresh = pool.filter(
    (entry) => !offer.candidates.some((candidate) => candidate.definitionId === entry.id)
  );
  if (hextechPoolForVersion(game.hextech!.rulesVersion) === 'DARK') {
    const retained = offer.candidates
      .filter((candidate) => candidate.definitionId !== oldId)
      .map((candidate) => getHextechDefinition(candidate.definitionId)!);
    const balanced = fresh.filter((entry) => hasBothDarkGroups([...retained, entry]));
    if (!balanced.length) throw new Error('黑暗海克斯没有满足候选规则的重抽项');
    return balanced;
  }
  return fresh.length ? fresh : pool;
}
