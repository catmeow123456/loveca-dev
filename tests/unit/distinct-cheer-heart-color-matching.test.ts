import { describe, expect, it } from 'vitest';
import type { EnergyCardData, LiveCardData, MemberCardData } from '../../src/domain/entities/card';
import {
  createCardInstance,
  createHeartIcon,
  createHeartRequirement,
} from '../../src/domain/entities/card';
import { createGameState, emitGameEvent, registerCards } from '../../src/domain/entities/game';
import { createCheerEvent } from '../../src/domain/events/game-events';
import {
  collectCurrentLiveRevealedCheerBladeHeartColors,
  evaluateDistinctCheerCardsCoverHeartColors,
  selectCurrentLiveRevealedCheerCardsWithEffectiveBladeHearts,
} from '../../src/application/effects/cheer-selection';
import { addLiveModifier } from '../../src/domain/rules/live-modifiers';
import { BladeHeartEffect, CardType, HeartColor } from '../../src/shared/types/enums';

const P1 = 'p1';
const P2 = 'p2';
const COLORS = [HeartColor.RED, HeartColor.GREEN, HeartColor.BLUE] as const;
const DAZZLING_GAME_FROM_COLORS = [
  HeartColor.PINK,
  HeartColor.RED,
  HeartColor.YELLOW,
  HeartColor.GREEN,
  HeartColor.BLUE,
  HeartColor.RAINBOW,
] as const;

function member(
  id: string,
  judgmentHeartColors: readonly HeartColor[],
  options: {
    readonly ownerId?: string;
    readonly groupNames?: readonly string[];
    readonly printedHearts?: readonly HeartColor[];
    readonly includeNonHeartBladeEffects?: boolean;
  } = {}
) {
  const data: MemberCardData = {
    cardCode: id,
    name: id,
    groupNames: options.groupNames ?? ['Aqours'],
    cardType: CardType.MEMBER,
    cost: 1,
    blade: 1,
    hearts: (options.printedHearts ?? []).map((color) => createHeartIcon(color, 1)),
    bladeHearts: [
      ...judgmentHeartColors.map((heartColor) => ({
        effect: BladeHeartEffect.HEART as const,
        heartColor,
      })),
      ...(options.includeNonHeartBladeEffects
        ? [{ effect: BladeHeartEffect.DRAW as const }, { effect: BladeHeartEffect.SCORE as const }]
        : []),
    ],
  };
  return createCardInstance(data, options.ownerId ?? P1, id);
}

function live(id: string) {
  const data: LiveCardData = {
    cardCode: id,
    name: id,
    groupNames: ['Aqours'],
    cardType: CardType.LIVE,
    score: 1,
    requirements: createHeartRequirement({ [HeartColor.BLUE]: 1 }),
  };
  return createCardInstance(data, P1, id);
}

function energy(id: string) {
  const data: EnergyCardData = { cardCode: id, name: id, cardType: CardType.ENERGY };
  return createCardInstance(data, P1, id);
}

function setup(cards: readonly ReturnType<typeof member | typeof live | typeof energy>[]) {
  let game = registerCards(createGameState('distinct-cheer-hearts', P1, 'P1', P2, 'P2'), cards);
  const ids = cards.map((card) => card.instanceId);
  game = {
    ...game,
    liveResolution: { ...game.liveResolution, firstPlayerCheerCardIds: ids },
  };
  return emitGameEvent(game, createCheerEvent(P1, ids, ids.length));
}

function evaluate(game: ReturnType<typeof setup>) {
  return evaluateDistinctCheerCardsCoverHeartColors(game, P1, {
    requiredColors: COLORS,
    groupAlias: 'Aqours',
    cardType: CardType.MEMBER,
  });
}

describe('distinct cheer cards cover effective judgment Heart colors', () => {
  it('shares event-inclusive effective Blade Heart facts after a Dazzling Game-style replacement', () => {
    const allColors = member('all-colors', [...DAZZLING_GAME_FROM_COLORS, HeartColor.PURPLE]);
    let game = setup([allColors]);
    game = {
      ...game,
      resolutionZone: { ...game.resolutionZone, cardIds: [], revealedCardIds: [] },
    };
    game = addLiveModifier(game, {
      kind: 'CHEER_CARD_HEART_COLOR_REPLACEMENT',
      playerId: P1,
      fromColors: DAZZLING_GAME_FROM_COLORS,
      toColor: HeartColor.PURPLE,
      sourceCardId: 'dazzling-game',
      abilityId: 'test-dazzling-game-replacement',
    });

    const facts = selectCurrentLiveRevealedCheerCardsWithEffectiveBladeHearts(game, P1);
    expect(game.resolutionZone.cardIds).not.toContain(allColors.instanceId);
    expect(facts).toHaveLength(1);
    expect(facts[0]?.cardId).toBe(allColors.instanceId);
    expect(facts[0]?.effectiveBladeHearts.map((bladeHeart) => bladeHeart.heartColor)).toEqual(
      Array.from({ length: 7 }, () => HeartColor.PURPLE)
    );
    expect([...collectCurrentLiveRevealedCheerBladeHeartColors(game, P1)]).toEqual([
      HeartColor.PURPLE,
    ]);
  });

  it('scopes effective Blade Heart replacement facts to the modifier player', () => {
    const ownCheer = member('own-cheer', [HeartColor.PINK, HeartColor.RAINBOW]);
    const opponentCheer = member('opponent-cheer', [HeartColor.PINK, HeartColor.RAINBOW], {
      ownerId: P2,
    });
    let game = registerCards(
      createGameState('player-scoped-effective-cheer-hearts', P1, 'P1', P2, 'P2'),
      [ownCheer, opponentCheer]
    );
    game = {
      ...game,
      liveResolution: {
        ...game.liveResolution,
        firstPlayerCheerCardIds: [ownCheer.instanceId],
        secondPlayerCheerCardIds: [opponentCheer.instanceId],
      },
    };
    game = emitGameEvent(game, createCheerEvent(P1, [ownCheer.instanceId], 1));
    game = emitGameEvent(game, createCheerEvent(P2, [opponentCheer.instanceId], 1));
    game = addLiveModifier(game, {
      kind: 'CHEER_CARD_HEART_COLOR_REPLACEMENT',
      playerId: P1,
      fromColors: DAZZLING_GAME_FROM_COLORS,
      toColor: HeartColor.PURPLE,
      sourceCardId: 'dazzling-game',
      abilityId: 'test-player-scoped-dazzling-game-replacement',
    });

    expect([...collectCurrentLiveRevealedCheerBladeHeartColors(game, P1)]).toEqual([
      HeartColor.PURPLE,
    ]);
    expect([...collectCurrentLiveRevealedCheerBladeHeartColors(game, P2)]).toEqual([
      HeartColor.PINK,
      HeartColor.RAINBOW,
    ]);
  });

  it('matches three different single-color Aqours members deterministically', () => {
    const result = evaluate(
      setup([
        member('red', [HeartColor.RED]),
        member('green', [HeartColor.GREEN]),
        member('blue', [HeartColor.BLUE]),
      ])
    );
    expect(result.conditionMet).toBe(true);
    expect(result.assignment).toEqual([
      { color: HeartColor.RED, cardId: 'red' },
      { color: HeartColor.GREEN, cardId: 'green' },
      { color: HeartColor.BLUE, cardId: 'blue' },
    ]);
    expect(result.matchedCardIds).toEqual(['red', 'green', 'blue']);
  });

  it('rejects one tri-color card and any two-card cover', () => {
    expect(evaluate(setup([member('rainbow', COLORS)])).conditionMet).toBe(false);
    const twoCards = evaluate(
      setup([
        member('red-green', [HeartColor.RED, HeartColor.GREEN]),
        member('blue', [HeartColor.BLUE]),
      ])
    );
    expect(twoCards.conditionMet).toBe(false);
    expect(twoCards.assignment).toEqual([]);
  });

  it('backtracks through overlapping colors and returns a stable distinct assignment', () => {
    const game = setup([
      member('red-green', [HeartColor.RED, HeartColor.GREEN]),
      member('green-blue', [HeartColor.GREEN, HeartColor.BLUE]),
      member('red-only', [HeartColor.RED]),
    ]);
    expect(evaluate(game).assignment).toEqual([
      { color: HeartColor.RED, cardId: 'red-only' },
      { color: HeartColor.GREEN, cardId: 'red-green' },
      { color: HeartColor.BLUE, cardId: 'green-blue' },
    ]);
    expect(evaluate(game).assignment).toEqual(evaluate(game).assignment);
  });

  it('fails when every color has candidates but Hall-style distinct assignment is impossible', () => {
    const result = evaluate(
      setup([
        member('red-green', [HeartColor.RED, HeartColor.GREEN]),
        member('blue', [HeartColor.BLUE]),
      ])
    );
    expect([...result.candidateCountsByColor.entries()]).toEqual([
      [HeartColor.RED, 1],
      [HeartColor.GREEN, 1],
      [HeartColor.BLUE, 1],
    ]);
    expect(result.conditionMet).toBe(false);
  });

  it('ignores non-Aqours, LIVE, energy, opponent-owned cards, printed Hearts, and non-HEART Blade effects', () => {
    const printedBlue = member('printed-blue', [], {
      printedHearts: [HeartColor.BLUE],
      includeNonHeartBladeEffects: true,
    });
    const result = evaluate(
      setup([
        member('red', [HeartColor.RED]),
        member('green-non-aqours', [HeartColor.GREEN], { groupNames: ['Liella!'] }),
        live('blue-live'),
        energy('blue-energy'),
        member('opponent-blue', [HeartColor.BLUE], { ownerId: P2 }),
        printedBlue,
      ])
    );
    expect(result.matchingCardIds).toEqual(['red', 'printed-blue']);
    expect(result.candidateCountsByColor.get(HeartColor.BLUE)).toBe(0);
    expect(result.conditionMet).toBe(false);
  });

  it('uses the effective judgment color after this-LIVE cheer Heart replacement', () => {
    let game = setup([
      member('red', [HeartColor.RED]),
      member('green', [HeartColor.GREEN]),
      member('purple-to-blue', [HeartColor.PURPLE]),
    ]);
    game = addLiveModifier(game, {
      kind: 'CHEER_CARD_HEART_COLOR_REPLACEMENT',
      playerId: P1,
      fromColors: [HeartColor.PURPLE],
      toColor: HeartColor.BLUE,
      sourceCardId: 'replacement-source',
      abilityId: 'test-purple-to-blue',
    });
    const result = evaluate(game);
    expect(result.conditionMet).toBe(true);
    expect(result.assignment).toEqual([
      { color: HeartColor.RED, cardId: 'red' },
      { color: HeartColor.GREEN, cardId: 'green' },
      { color: HeartColor.BLUE, cardId: 'purple-to-blue' },
    ]);
  });

  it('deduplicates a repeated current-cheer fact for the same cardId', () => {
    const red = member('red', [HeartColor.RED]);
    let game = setup([red]);
    game = {
      ...game,
      liveResolution: {
        ...game.liveResolution,
        firstPlayerCheerCardIds: [red.instanceId, red.instanceId],
      },
    };
    game = emitGameEvent(game, createCheerEvent(P1, [red.instanceId, red.instanceId], 2));
    const result = evaluate(game);
    expect(result.matchingCardIds).toEqual([red.instanceId]);
    expect(result.candidateCountsByColor.get(HeartColor.RED)).toBe(1);
  });
});
