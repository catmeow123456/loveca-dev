import { describe, expect, it } from 'vitest';
import type { LiveCardData, MemberCardData } from '../../src/domain/entities/card';
import {
  createCardInstance,
  createHeartIcon,
  createHeartRequirement,
} from '../../src/domain/entities/card';
import { createGameState, registerCards, updatePlayer } from '../../src/domain/entities/game';
import { addCardToStatefulZone, createEmptyDeckZone, drawFromBottom, drawFromTop } from '../../src/domain/entities/zone';
import { createCheerEvent } from '../../src/domain/events/game-events';
import {
  CheerDeckEdge,
  getCheerDeckEdgeForPlayer,
} from '../../src/domain/rules/cheer-direction';
import { revealCheerCardsFromMainDeck } from '../../src/application/effects/cheer';
import { getCheerEventDeckEdge } from '../../src/application/card-effects/runtime/cheer-events';
import { projectPlayerViewState } from '../../src/online/projector';
import { CardType, HeartColor, TriggerCondition, ZoneType } from '../../src/shared/types/enums';

const P1 = 'p1';
const P2 = 'p2';

function live(cardCode: string, ownerId: string, instanceId: string) {
  const data: LiveCardData = {
    cardCode,
    name: cardCode,
    groupNames: ['Aqours'],
    cardType: CardType.LIVE,
    score: 1,
    requirements: createHeartRequirement({ [HeartColor.RED]: 1 }),
  };
  return createCardInstance(data, ownerId, instanceId);
}

function member(cardCode: string, ownerId: string, instanceId: string) {
  const data: MemberCardData = {
    cardCode,
    name: cardCode,
    groupNames: ['Aqours'],
    cardType: CardType.MEMBER,
    cost: 1,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.RED, 1)],
  };
  return createCardInstance(data, ownerId, instanceId);
}

function gameWithLiveSources(...sources: ReturnType<typeof live | typeof member>[]) {
  let game = registerCards(createGameState('cheer-direction', P1, 'P1', P2, 'P2'), sources);
  for (const source of sources) {
    game = updatePlayer(game, P1, (player) => ({
      ...player,
      liveZone: addCardToStatefulZone(player.liveZone, source.instanceId),
    }));
  }
  return game;
}

describe('drawFromBottom', () => {
  it('handles empty, one-card, and multi-card decks without reversing the remainder', () => {
    const empty = createEmptyDeckZone(P1, ZoneType.MAIN_DECK);
    expect(drawFromBottom(empty)).toEqual({ zone: empty, cardId: null });

    const one = { ...empty, cardIds: ['only'] };
    expect(drawFromBottom(one)).toEqual({ zone: { ...one, cardIds: [] }, cardId: 'only' });

    const many = { ...empty, cardIds: ['top', 'middle', 'bottom'] };
    expect(drawFromBottom(many)).toEqual({
      zone: { ...many, cardIds: ['top', 'middle'] },
      cardId: 'bottom',
    });
    expect(drawFromTop(many)).toEqual({
      zone: { ...many, cardIds: ['middle', 'bottom'] },
      cardId: 'top',
    });
  });
});

describe('getCheerDeckEdgeForPlayer', () => {
  it('defaults to TOP and enables BOTTOM only for an exact owned LIVE in that player live zone', () => {
    const source = live('PL!S-bp7-022-SECL', P1, 'source');
    let game = gameWithLiveSources(source);
    expect(getCheerDeckEdgeForPlayer(game, P1)).toBe(CheerDeckEdge.BOTTOM);
    expect(getCheerDeckEdgeForPlayer(game, P2)).toBe(CheerDeckEdge.TOP);

    game = updatePlayer(game, P1, (player) => ({
      ...player,
      liveZone: { ...player.liveZone, cardIds: [] },
    }));
    expect(getCheerDeckEdgeForPlayer(game, P1)).toBe(CheerDeckEdge.TOP);
  });

  it('ignores wrong owner, wrong type, wrong code, opponent sources, and duplicate same-direction sources', () => {
    const wrongOwner = live('PL!S-bp7-022-SECL', P2, 'wrong-owner');
    const wrongType = member('PL!S-bp7-022-SECL', P1, 'wrong-type');
    const wrongCode = live('PL!S-bp7-022-L', P1, 'wrong-code');
    expect(getCheerDeckEdgeForPlayer(gameWithLiveSources(wrongOwner), P1)).toBe(CheerDeckEdge.TOP);
    expect(getCheerDeckEdgeForPlayer(gameWithLiveSources(wrongType), P1)).toBe(CheerDeckEdge.TOP);
    expect(getCheerDeckEdgeForPlayer(gameWithLiveSources(wrongCode), P1)).toBe(CheerDeckEdge.TOP);

    const first = live('PL!S-bp7-022-SECL', P1, 'first');
    const second = live('PL!S-bp7-022-SECL', P1, 'second');
    expect(getCheerDeckEdgeForPlayer(gameWithLiveSources(first, second), P1)).toBe(
      CheerDeckEdge.BOTTOM
    );
  });
});

describe('unified cheer reveal direction', () => {
  it('preserves TOP order without a source and reveals bottom then next-bottom with the exact source', () => {
    const cards = ['top', 'middle', 'bottom'].map((id) => member(id, P1, id));
    let topGame = registerCards(createGameState('top-cheer', P1, 'P1', P2, 'P2'), cards);
    topGame = updatePlayer(topGame, P1, (player) => ({
      ...player,
      mainDeck: { ...player.mainDeck, cardIds: cards.map((card) => card.instanceId) },
    }));
    expect(revealCheerCardsFromMainDeck(topGame, P1, 2).cheerCardIds).toEqual(['top', 'middle']);

    const source = live('PL!S-bp7-022-SECL', P1, 'source');
    let bottomGame = registerCards(createGameState('bottom-cheer', P1, 'P1', P2, 'P2'), [
      source,
      ...cards,
    ]);
    bottomGame = updatePlayer(bottomGame, P1, (player) => ({
      ...player,
      liveZone: addCardToStatefulZone(player.liveZone, source.instanceId),
      mainDeck: { ...player.mainDeck, cardIds: cards.map((card) => card.instanceId) },
    }));
    const result = revealCheerCardsFromMainDeck(bottomGame, P1, 2, { automated: true });
    expect(result.cheerCardIds).toEqual(['bottom', 'middle']);
    expect(result.gameState.resolutionZone.cardIds).toEqual(['bottom', 'middle']);
    expect(result.gameState.resolutionZone.revealedCardIds).toEqual(['bottom', 'middle']);
    expect(result.cheerEvent).toMatchObject({
      revealedCardIds: ['bottom', 'middle'],
      deckEdge: CheerDeckEdge.BOTTOM,
      automated: true,
    });
    expect(result.gameState.actionHistory.at(-1)?.payload).toMatchObject({
      cheerCardIds: ['bottom', 'middle'],
      revealedCardIds: ['bottom', 'middle'],
      deckEdge: CheerDeckEdge.BOTTOM,
    });
  });

  it('refreshes immediately and continues from the refreshed deck bottom without recording refresh-only cards', () => {
    const source = live('PL!S-bp7-022-SECL', P1, 'source');
    const initial = member('initial', P1, 'initial');
    const refreshA = member('refresh-a', P1, 'refresh-a');
    const refreshB = member('refresh-b', P1, 'refresh-b');
    let game = registerCards(createGameState('bottom-refresh', P1, 'P1', P2, 'P2'), [
      source,
      initial,
      refreshA,
      refreshB,
    ]);
    game = updatePlayer(game, P1, (player) => ({
      ...player,
      liveZone: addCardToStatefulZone(player.liveZone, source.instanceId),
      mainDeck: { ...player.mainDeck, cardIds: [initial.instanceId] },
      waitingRoom: { ...player.waitingRoom, cardIds: [refreshA.instanceId, refreshB.instanceId] },
    }));
    const result = revealCheerCardsFromMainDeck(game, P1, 2);
    expect(result.cheerCardIds[0]).toBe(initial.instanceId);
    expect(result.cheerCardIds).toHaveLength(2);
    expect([refreshA.instanceId, refreshB.instanceId]).toContain(result.cheerCardIds[1]);
    const remainingId = result.gameState.players[0].mainDeck.cardIds[0];
    expect([refreshA.instanceId, refreshB.instanceId]).toContain(remainingId);
    expect(result.cheerCardIds).not.toContain(remainingId);
    expect(result.cheerEvent.revealedCardIds).toEqual(result.cheerCardIds);
  });

  it('treats a legacy CheerEvent without deckEdge as TOP', () => {
    const legacy = {
      ...createCheerEvent(P1, ['revealed'], 1),
      deckEdge: undefined,
    };
    expect(getCheerEventDeckEdge(legacy)).toBe(CheerDeckEdge.TOP);
    expect(legacy.eventType).toBe(TriggerCondition.ON_CHEER);
  });

  it('projects the revealed result without exposing the remaining main-deck identity or order', () => {
    const source = live('PL!S-bp7-022-SECL', P1, 'source');
    const remaining = member('SECRET-REMAINING-CARD', P1, 'secret-remaining-instance');
    const revealed = member('PUBLIC-REVEALED-CARD', P1, 'public-revealed-instance');
    let game = registerCards(createGameState('bottom-projector', P1, 'P1', P2, 'P2'), [
      source,
      remaining,
      revealed,
    ]);
    game = updatePlayer(game, P1, (player) => ({
      ...player,
      liveZone: addCardToStatefulZone(player.liveZone, source.instanceId),
      mainDeck: {
        ...player.mainDeck,
        cardIds: [remaining.instanceId, revealed.instanceId],
      },
    }));
    const done = revealCheerCardsFromMainDeck(game, P1, 1).gameState;
    const opponentView = JSON.stringify(projectPlayerViewState(done, P2));
    expect(opponentView).toContain('PUBLIC-REVEALED-CARD');
    expect(opponentView).not.toContain('SECRET-REMAINING-CARD');
    expect(opponentView).not.toContain(remaining.instanceId);
  });
});
