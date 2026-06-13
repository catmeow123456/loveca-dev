import { describe, expect, it } from 'vitest';
import { createGameState } from '../../src/domain/entities/game';
import { addLiveModifier, replaceLiveModifier } from '../../src/domain/rules/live-modifiers';
import { HeartColor } from '../../src/shared/types/enums';

describe('live modifier helpers', () => {
  it('uses liveModifiers as the source for score and heart compatibility projections', () => {
    let game = createGameState('live-modifier-projection', 'p1', 'P1', 'p2', 'P2');

    game = addLiveModifier(game, {
      kind: 'SCORE',
      playerId: 'p1',
      countDelta: 1,
      sourceCardId: 'nico',
      abilityId: 'nico-score',
    });
    game = addLiveModifier(game, {
      kind: 'HEART',
      playerId: 'p1',
      hearts: [{ color: HeartColor.YELLOW, count: 1 }],
      sourceCardId: 'kotori',
      abilityId: 'kotori-heart',
    });

    expect(game.liveResolution.liveModifiers).toEqual([
      {
        kind: 'SCORE',
        playerId: 'p1',
        countDelta: 1,
        sourceCardId: 'nico',
        abilityId: 'nico-score',
      },
      {
        kind: 'HEART',
        playerId: 'p1',
        hearts: [{ color: HeartColor.YELLOW, count: 1 }],
        sourceCardId: 'kotori',
        abilityId: 'kotori-heart',
      },
    ]);
    expect(game.liveResolution.playerScoreBonuses.get('p1')).toBe(1);
    expect(game.liveResolution.playerHeartBonuses.get('p1')).toEqual([
      { color: HeartColor.YELLOW, count: 1 },
    ]);
  });

  it('replaces requirement modifiers and derives legacy requirement fields', () => {
    let game = createGameState('live-requirement-projection', 'p1', 'P1', 'p2', 'P2');
    const match = {
      kind: 'REQUIREMENT' as const,
      liveCardId: 'live-1',
      sourceCardId: 'live-1',
      abilityId: 'bokuima-requirement',
    };

    game = replaceLiveModifier(game, match, {
      ...match,
      kind: 'REQUIREMENT',
      modifiers: [{ color: HeartColor.RAINBOW, countDelta: -4 }],
    });

    expect(game.liveResolution.liveRequirementReductions.get('live-1')).toBe(4);
    expect(game.liveResolution.liveRequirementModifiers.get('live-1')).toEqual([
      { color: HeartColor.RAINBOW, countDelta: -4 },
    ]);

    game = replaceLiveModifier(game, match, null);

    expect(game.liveResolution.liveModifiers).toEqual([]);
    expect(game.liveResolution.liveRequirementReductions.has('live-1')).toBe(false);
    expect(game.liveResolution.liveRequirementModifiers.has('live-1')).toBe(false);
  });
});
