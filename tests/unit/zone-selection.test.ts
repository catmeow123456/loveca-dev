import { describe, expect, it } from 'vitest';
import type { AnyCardData, LiveCardData, MemberCardData } from '../../src/domain/entities/card';
import { createHeartIcon, createHeartRequirement } from '../../src/domain/entities/card';
import type { GameState } from '../../src/domain/entities/game';
import type { DeckConfig } from '../../src/application/game-service';
import { createGameSession } from '../../src/application/game-session';
import {
  createWaitingRoomToHandEffectState,
  createWaitingRoomToHandSelectionConfig,
  getZoneSelectionConfig,
  moveSelectedCardsFromZone,
  selectWaitingRoomCardIds,
} from '../../src/application/effects/zone-selection';
import { typeIs } from '../../src/application/effects/card-selectors';
import { CardType, HeartColor } from '../../src/shared/types/enums';

const PLAYER1 = 'player1';
const PLAYER2 = 'player2';

function createMemberCard(cardCode: string, cost = 1): MemberCardData {
  return {
    cardCode,
    name: cardCode,
    cardType: CardType.MEMBER,
    cost,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.PINK, 1)],
  };
}

function createLiveCard(cardCode: string): LiveCardData {
  return {
    cardCode,
    name: cardCode,
    groupName: "μ's",
    cardType: CardType.LIVE,
    score: 3,
    requirements: createHeartRequirement({ [HeartColor.PINK]: 1 }),
  };
}

function createDeck(): DeckConfig {
  const mainDeck: AnyCardData[] = [];
  for (let index = 0; index < 48; index++) {
    mainDeck.push(createMemberCard(`MEM-${index}`));
  }
  for (let index = 0; index < 12; index++) {
    mainDeck.push(createLiveCard(`LIVE-${index}`));
  }

  const energyDeck = Array.from({ length: 12 }, (_, index) => ({
    cardCode: `ENE-${index}`,
    name: `Energy ${index}`,
    cardType: CardType.ENERGY,
  }));

  return { mainDeck, energyDeck };
}

function createStateWithWaitingRoom(): {
  state: GameState;
  memberCardId: string;
  liveCardId: string;
} {
  const session = createGameSession();
  const deck = createDeck();
  session.createGame('zone-selection-unit', PLAYER1, 'Player 1', PLAYER2, 'Player 2');
  session.initializeGame(deck, deck);

  const state = session.state!;
  const p1 = state.players[0] as unknown as {
    hand: { cardIds: string[] };
    mainDeck: { cardIds: string[] };
    waitingRoom: { cardIds: string[] };
    successZone: { cardIds: string[] };
    liveZone: { cardIds: string[] };
  };
  const ownedP1CardIds = [...state.cardRegistry.values()]
    .filter((card) => card.ownerId === PLAYER1)
    .map((card) => card.instanceId);
  const memberCardId = ownedP1CardIds.find(
    (cardId) => state.cardRegistry.get(cardId)?.data.cardType === CardType.MEMBER
  );
  const liveCardId = ownedP1CardIds.find(
    (cardId) => state.cardRegistry.get(cardId)?.data.cardType === CardType.LIVE
  );

  expect(memberCardId).toBeTruthy();
  expect(liveCardId).toBeTruthy();

  p1.hand.cardIds = [];
  p1.mainDeck.cardIds = [];
  p1.successZone.cardIds = [];
  p1.liveZone.cardIds = [];
  p1.waitingRoom.cardIds = [memberCardId!, liveCardId!];

  return { state, memberCardId: memberCardId!, liveCardId: liveCardId! };
}

describe('zone selection helpers', () => {
  it('creates default waiting-room-to-hand effect metadata', () => {
    const effect = createWaitingRoomToHandEffectState({
      id: 'effect-1',
      abilityId: 'ability-1',
      sourceCardId: 'source-1',
      controllerId: PLAYER1,
      effectText: 'effect text',
      stepId: 'SELECT_WAITING_ROOM_CARD',
      awaitingPlayerId: PLAYER1,
      selectableCardIds: ['card-1'],
      metadata: { orderedResolution: true },
    });

    expect(effect.canSkipSelection).toBe(true);
    expect(effect.metadata).toEqual({
      orderedResolution: true,
      zoneSelection: {
        source: 'WAITING_ROOM',
        destination: 'HAND',
        minCount: 0,
        maxCount: 1,
        optional: true,
      },
    });
    expect(getZoneSelectionConfig(effect)).toEqual(effect.metadata?.zoneSelection);
  });

  it('selects candidate cards from waiting room with a predicate', () => {
    const { state, memberCardId, liveCardId } = createStateWithWaitingRoom();

    expect(selectWaitingRoomCardIds(state, PLAYER1, typeIs(CardType.LIVE))).toEqual([liveCardId]);
    expect(selectWaitingRoomCardIds(state, PLAYER1, typeIs(CardType.MEMBER))).toEqual([
      memberCardId,
    ]);
    expect(selectWaitingRoomCardIds(state, 'missing-player', typeIs(CardType.LIVE))).toEqual([]);
  });

  it('moves selected waiting-room cards to hand and preserves unselected order', () => {
    const { state, memberCardId, liveCardId } = createStateWithWaitingRoom();
    const config = createWaitingRoomToHandSelectionConfig();

    const movedState = moveSelectedCardsFromZone(state, PLAYER1, [liveCardId], config);

    expect(movedState).not.toBeNull();
    expect(movedState?.players[0].waitingRoom.cardIds).toEqual([memberCardId]);
    expect(movedState?.players[0].hand.cardIds).toEqual([liveCardId]);
  });

  it('rejects invalid counts, duplicate selections, and cards outside waiting room', () => {
    const { state, liveCardId } = createStateWithWaitingRoom();
    const requiredOne = createWaitingRoomToHandSelectionConfig({ minCount: 1, maxCount: 1 });

    expect(moveSelectedCardsFromZone(state, PLAYER1, [], requiredOne)).toBeNull();
    expect(moveSelectedCardsFromZone(state, PLAYER1, [liveCardId, liveCardId], requiredOne)).toBeNull();
    expect(moveSelectedCardsFromZone(state, PLAYER1, ['missing-card'], requiredOne)).toBeNull();
  });
});
