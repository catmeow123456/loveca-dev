import { describe, expect, it } from 'vitest';
import type { EnergyCardData, LiveCardData, MemberCardData } from '../../src/domain/entities/card';
import {
  createCardInstance,
  createHeartIcon,
  createHeartRequirement,
} from '../../src/domain/entities/card';
import { createGameState, emitGameEvent, registerCards } from '../../src/domain/entities/game';
import { createCheerEvent } from '../../src/domain/events/game-events';
import { evaluateDistinctCheerCardsCoverHeartColors } from '../../src/application/effects/cheer-selection';
import {
  BladeHeartEffect,
  CardType,
  HeartColor,
} from '../../src/shared/types/enums';

const P1 = 'p1';
const P2 = 'p2';
const COLORS = [HeartColor.RED, HeartColor.GREEN, HeartColor.BLUE] as const;

function member(
  id: string,
  hearts: readonly HeartColor[],
  options: { readonly ownerId?: string; readonly groupNames?: readonly string[]; readonly bladeBlue?: boolean } = {}
) {
  const data: MemberCardData = {
    cardCode: id,
    name: id,
    groupNames: options.groupNames ?? ['Aqours'],
    cardType: CardType.MEMBER,
    cost: 1,
    blade: 1,
    hearts: hearts.map((color) => createHeartIcon(color, 1)),
    bladeHearts: options.bladeBlue
      ? [{ effect: BladeHeartEffect.HEART, heartColor: HeartColor.BLUE }]
      : [],
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

describe('distinct cheer cards cover printed Heart colors', () => {
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

  it('ignores non-Aqours, LIVE, energy, opponent-owned cards, and BLADE HEART colors', () => {
    const bladeOnly = member('blade-blue', [], { bladeBlue: true });
    const result = evaluate(
      setup([
        member('red', [HeartColor.RED]),
        member('green-non-aqours', [HeartColor.GREEN], { groupNames: ['Liella!'] }),
        live('blue-live'),
        energy('blue-energy'),
        member('opponent-blue', [HeartColor.BLUE], { ownerId: P2 }),
        bladeOnly,
      ])
    );
    expect(result.matchingCardIds).toEqual(['red', 'blade-blue']);
    expect(result.candidateCountsByColor.get(HeartColor.BLUE)).toBe(0);
    expect(result.conditionMet).toBe(false);
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
