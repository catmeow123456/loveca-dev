import { getCardById } from '../entities/game.js';
import type { GameState, MemberActivePhaseSkipState } from '../entities/game.js';
import { OrientationState, SlotPosition } from '../../shared/types/enums.js';
import { cardCodeMatchesBase } from '../../shared/utils/card-code.js';

const CONTINUOUS_ACTIVE_PHASE_NOT_ACTIVE_BASE_CARD_CODES = ['PL!N-bp5-006'] as const;
const CONTINUOUS_OPPONENT_ACTIVE_PHASE_NOT_ACTIVE_BASE_CARD_CODES = ['PL!HS-pb1-008'] as const;

export interface AddMemberActivePhaseSkipOptions {
  readonly playerId: string;
  readonly memberCardId: string;
  readonly sourceCardId: string;
  readonly abilityId: string;
}

export function addMemberActivePhaseSkip(
  game: GameState,
  options: AddMemberActivePhaseSkipOptions
): GameState {
  const skip: MemberActivePhaseSkipState = {
    playerId: options.playerId,
    memberCardId: options.memberCardId,
    sourceCardId: options.sourceCardId,
    abilityId: options.abilityId,
  };

  return {
    ...game,
    memberActivePhaseSkips: [
      ...game.memberActivePhaseSkips.filter(
        (candidate) =>
          !(
            candidate.playerId === skip.playerId &&
            candidate.memberCardId === skip.memberCardId &&
            candidate.sourceCardId === skip.sourceCardId &&
            candidate.abilityId === skip.abilityId
          )
      ),
      skip,
    ],
  };
}

export function consumeMemberActivePhaseSkipsForPlayer(
  game: GameState,
  playerId: string
): {
  readonly gameState: GameState;
  readonly skippedMemberCardIds: readonly string[];
} {
  const skippedMemberCardIds = game.memberActivePhaseSkips
    .filter((skip) => skip.playerId === playerId)
    .map((skip) => skip.memberCardId);

  if (skippedMemberCardIds.length === 0) {
    return { gameState: game, skippedMemberCardIds };
  }

  return {
    gameState: {
      ...game,
      memberActivePhaseSkips: game.memberActivePhaseSkips.filter(
        (skip) => skip.playerId !== playerId
      ),
    },
    skippedMemberCardIds,
  };
}

export function collectContinuousActivePhaseSkippedMemberCardIds(
  game: GameState,
  playerId: string
): readonly string[] {
  const player = game.players.find((candidate) => candidate.id === playerId);
  if (!player) {
    return [];
  }
  const opponent = game.players.find((candidate) => candidate.id !== playerId);

  const ownStageSkippedMemberCardIds = Object.values(SlotPosition).flatMap((slot) => {
    const cardId = player.memberSlots.slots[slot];
    const cardState = cardId ? player.memberSlots.cardStates.get(cardId) : undefined;
    const card = cardId ? getCardById(game, cardId) : null;
    if (
      cardId &&
      cardState?.orientation === OrientationState.WAITING &&
      CONTINUOUS_ACTIVE_PHASE_NOT_ACTIVE_BASE_CARD_CODES.some((baseCardCode) =>
        cardCodeMatchesBase(card?.data.cardCode ?? '', baseCardCode)
      )
    ) {
      return [cardId];
    }
    return [];
  });

  const opponentHasStageSkipSource =
    opponent !== undefined &&
    Object.values(SlotPosition).some((slot) => {
      const cardId = opponent.memberSlots.slots[slot];
      const card = cardId ? getCardById(game, cardId) : null;
      return CONTINUOUS_OPPONENT_ACTIVE_PHASE_NOT_ACTIVE_BASE_CARD_CODES.some((baseCardCode) =>
        cardCodeMatchesBase(card?.data.cardCode ?? '', baseCardCode)
      );
    });

  if (!opponentHasStageSkipSource) {
    return ownStageSkippedMemberCardIds;
  }

  const opponentEffectSkippedMemberCardIds = Object.values(SlotPosition).flatMap((slot) => {
    const cardId = player.memberSlots.slots[slot];
    const cardState = cardId ? player.memberSlots.cardStates.get(cardId) : undefined;
    return cardId && cardState?.orientation === OrientationState.WAITING ? [cardId] : [];
  });

  return [...new Set([...ownStageSkippedMemberCardIds, ...opponentEffectSkippedMemberCardIds])];
}
