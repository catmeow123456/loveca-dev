import {
  getCardById,
  getPlayerById,
  type GameState,
  type LiveModifierState,
} from '../entities/game.js';
import { isLiveCardData } from '../entities/card.js';
import { HeartColor, OrientationState } from '../../shared/types/enums.js';
import type { OwnedHextech } from './state.js';
import { getDarkLiveSlots, getDarkLiveSlotGrayRequirementIncreases } from './suppression.js';

export function collectDarkHextechModifiers(
  game: GameState,
  owned: OwnedHextech,
  effect: string
): LiveModifierState[] {
  const opponent = game.players.find((player) => player.id !== owned.playerId)!;
  const isOpponent = [
    'solo-exam',
    'multi-song-tax',
    'reserve-inspection',
    'double-exam',
    'first-slot-mute',
  ].includes(effect);
  const playerId = isOpponent ? opponent.id : owned.playerId;
  const player = getPlayerById(game, playerId)!;
  const source = {
    playerId,
    sourceHextechInstanceId: owned.instanceId,
    abilityId: `hextech:${owned.definitionId}`,
  };
  const lives = player.liveZone.cardIds.filter((id) => {
    const card = getCardById(game, id);
    return card && isLiveCardData(card.data);
  });
  const visibilityDependency = { kind: 'PLAYER_LIVE_ZONE_CONTENTS' as const, playerId };
  const score = (countDelta: number, conditional = false): LiveModifierState => ({
    ...source,
    kind: 'SCORE',
    countDelta,
    ...(conditional ? { visibilityDependency } : {}),
  });
  const cheer = (countDelta: number): LiveModifierState => ({
    ...source,
    kind: 'CHEER_COUNT',
    countDelta,
  });
  const hearts = (count: number): LiveModifierState => ({
    ...source,
    kind: 'HEART',
    target: 'PLAYER',
    hearts: [{ color: HeartColor.RAINBOW, count }],
  });
  const requirement = (
    countDelta: number,
    cardIds: readonly string[] = lives
  ): LiveModifierState[] =>
    cardIds.map((liveCardId) => ({
      ...source,
      kind: 'REQUIREMENT',
      liveCardId,
      modifiers: [{ color: HeartColor.GRAY, countDelta }],
      visibilityDependency,
    }));
  const usedThisTurn = game.hextech?.uses?.some(
    (use) => use.instanceId === owned.instanceId && use.turn === game.turnCount
  );
  switch (effect) {
    case 'solo-exam':
      return lives.length === 1 ? requirement(1) : [];
    case 'multi-song-tax':
      return lives.length >= 2 ? [score(-1, true)] : [];
    case 'first-slot-mute': {
      const increases = getDarkLiveSlotGrayRequirementIncreases(game, playerId);
      return getDarkLiveSlots(game, playerId).flatMap((cardId, index) =>
        increases[index] > 0 && lives.includes(cardId)
          ? requirement(increases[index], [cardId])
          : []
      );
    }
    case 'restless-cheer':
      return [cheer(4), score(-1)];
    case 'lopsided-stage':
      return [hearts(3), cheer(-2)];
    case 'borrow-now':
      return usedThisTurn ? [score(-1)] : [];
    case 'reserve-inspection':
      return player.energyZone.cardIds.filter(
        (id) => player.energyZone.cardStates.get(id)?.orientation !== OrientationState.WAITING
      ).length >= 2
        ? [score(-2)]
        : [];
    case 'all-in-song':
      return lives.length === 1
        ? [
            { ...source, kind: 'SCORE', liveCardId: lives[0], countDelta: 3, visibilityDependency },
            ...requirement(2),
          ]
        : [];
    case 'high-pressure-cheer':
      return [cheer(4), ...requirement(1)];
    case 'greed-contract':
      return requirement(1);
    case 'burning-stage':
      return usedThisTurn ? [cheer(6), score(3), ...requirement(2)] : [];
    case 'bet-on-victory':
      return [score(3), cheer(-3)];
    case 'lower-the-bar':
      return [score(-1), ...requirement(-2)];
    case 'double-exam':
      return requirement(1, lives.slice(1));
    case 'hearts-for-score':
      return [hearts(5), score(-2)];
    case 'farewell-gift':
      return usedThisTurn ? [hearts(3), score(2)] : [];
    default:
      return [];
  }
}
