import { describe, expect, it } from 'vitest';
import { clearRemainingHeartsForPlayer } from '../../src/application/card-effects/runtime/actions';
import {
  getRemainingHeartCount,
  getRemainingHeartTotalCount,
  hasNoRemainingHearts,
  hasRemainingHeartColor,
  hasRemainingHearts,
  rebalanceRemainingHeartColorForPlayer,
} from '../../src/application/effects/remaining-hearts';
import { createGameState, registerCards, type GameState } from '../../src/domain/entities/game';
import { createCardInstance, createHeartRequirement } from '../../src/domain/entities/card';
import { addLiveModifier } from '../../src/domain/rules/live-modifiers';
import { CardType } from '../../src/shared/types/enums';
import { member, stage } from '../helpers/modifier-workflow-fixtures';
import { HeartColor } from '../../src/shared/types/enums';

const PLAYER1 = 'player1';
const PLAYER2 = 'player2';

function createStateWithRemainingHearts() {
  const game = createGameState('remaining-hearts', PLAYER1, 'P1', PLAYER2, 'P2');
  return {
    ...game,
    liveResolution: {
      ...game.liveResolution,
      playerRemainingHearts: new Map([
        [
          PLAYER1,
          [
            { color: HeartColor.GREEN, count: 1 },
            { color: HeartColor.RAINBOW, count: 2 },
          ],
        ],
      ]),
      playerLiveJudgmentHearts: new Map([
        [
          PLAYER1,
          [
            { color: HeartColor.GREEN, count: 2 },
            { color: HeartColor.RAINBOW, count: 2 },
          ],
        ],
      ]),
    },
  };
}

describe('remaining hearts helpers', () => {
  it.each([
    { score: 40, success: true, expected: 39 },
    { score: 0, success: true, expected: 0 },
    { score: 40, success: false, expected: 40 },
    { score: undefined, success: true, expected: undefined },
  ])('synchronizes only an existing successful score draft by continuous delta: $score / $success', ({ score, success, expected }) => {
    const mari = member('PL!S-bp5-008-R', 'mari', PLAYER2);
    const live = createCardInstance({ cardType: CardType.LIVE, cardCode: 'SYNTHETIC-LIVE', name: 'synthetic-live', score: 1, requirements: createHeartRequirement({}) }, PLAYER2, 'live');
    let game: GameState = stage(registerCards(createStateWithRemainingHearts(), [mari, live]), [mari], PLAYER2);
    game = addLiveModifier(game, { kind: 'SCORE', playerId: PLAYER2, sourceCardId: 'other', abilityId: 'other-bonus', countDelta: 7 });
    game = { ...game, liveResolution: { ...game.liveResolution,
      liveResults: new Map([['live', success]]),
      playerScores: score === undefined ? new Map([[PLAYER1, 15]]) : new Map([[PLAYER1, 15], [PLAYER2, score]]),
    } };
    const cleared = clearRemainingHeartsForPlayer(game, PLAYER1).gameState;
    expect(cleared.liveResolution.playerScores.get(PLAYER2)).toBe(expected);
    expect(cleared.liveResolution.playerScores.get(PLAYER1)).toBe(15);
    expect(cleared.liveResolution.liveModifiers).toEqual(game.liveResolution.liveModifiers);
    expect(cleared.actionHistory).toEqual(game.actionHistory);
    expect(cleared.eventLog).toEqual(game.eventLog);
    expect(clearRemainingHeartsForPlayer(cleared, PLAYER1).gameState.liveResolution.playerScores).toEqual(cleared.liveResolution.playerScores);
  });
  it('counts exact colors without treating RAINBOW as green', () => {
    const game = createStateWithRemainingHearts();

    expect(getRemainingHeartCount(game, PLAYER1, HeartColor.GREEN)).toBe(1);
    expect(getRemainingHeartCount(game, PLAYER1, HeartColor.RAINBOW)).toBe(2);
    expect(hasRemainingHeartColor(game, PLAYER1, HeartColor.GREEN, 2)).toBe(false);
    expect(hasRemainingHeartColor(game, PLAYER1, HeartColor.BLUE)).toBe(false);
  });

  it('counts total remaining hearts including RAINBOW and handles empty players', () => {
    const game = createStateWithRemainingHearts();

    expect(getRemainingHeartCount(game, PLAYER1)).toBe(3);
    expect(getRemainingHeartTotalCount(game, PLAYER1)).toBe(3);
    expect(hasRemainingHearts(game, PLAYER1, 3)).toBe(true);
    expect(hasNoRemainingHearts(game, PLAYER1)).toBe(false);
    expect(getRemainingHeartTotalCount(game, PLAYER2)).toBe(0);
    expect(hasNoRemainingHearts(game, PLAYER2)).toBe(true);
  });

  it('clears a player remaining hearts without affecting other players', () => {
    const game = {
      ...createStateWithRemainingHearts(),
      liveResolution: {
        ...createStateWithRemainingHearts().liveResolution,
        playerRemainingHearts: new Map([
          [PLAYER1, [{ color: HeartColor.GREEN, count: 1 }]],
          [PLAYER2, [{ color: HeartColor.YELLOW, count: 2 }]],
        ]),
      },
    };

    const result = clearRemainingHeartsForPlayer(game, PLAYER1);

    expect(result.lostHearts).toEqual([{ color: HeartColor.GREEN, count: 1 }]);
    expect(result.lostTotalCount).toBe(1);
    expect(result.gameState.liveResolution.playerRemainingHearts.get(PLAYER1)).toEqual([]);
    expect(result.gameState.liveResolution.playerRemainingHearts.get(PLAYER2)).toEqual([
      { color: HeartColor.YELLOW, count: 2 },
    ]);
  });

  it('rebalances remaining RAINBOW into an exact color only when that color was consumed', () => {
    const game = {
      ...createStateWithRemainingHearts(),
      liveResolution: {
        ...createStateWithRemainingHearts().liveResolution,
        playerRemainingHearts: new Map([[PLAYER1, [{ color: HeartColor.RAINBOW, count: 1 }]]]),
        playerLiveJudgmentHearts: new Map([
          [
            PLAYER1,
            [
              { color: HeartColor.GREEN, count: 2 },
              { color: HeartColor.RAINBOW, count: 2 },
            ],
          ],
        ]),
      },
    };

    const result = rebalanceRemainingHeartColorForPlayer(game, PLAYER1, HeartColor.GREEN, 1);

    expect(result.rebalancedCount).toBe(1);
    expect(result.remainingColorCountBefore).toBe(0);
    expect(result.remainingColorCountAfter).toBe(1);
    expect(result.gameState.liveResolution.playerRemainingHearts.get(PLAYER1)).toEqual([
      { color: HeartColor.GREEN, count: 1 },
    ]);
  });

  it('does not rebalance RAINBOW into a color that was not available during judgment', () => {
    const game = {
      ...createStateWithRemainingHearts(),
      liveResolution: {
        ...createStateWithRemainingHearts().liveResolution,
        playerRemainingHearts: new Map([[PLAYER1, [{ color: HeartColor.RAINBOW, count: 1 }]]]),
        playerLiveJudgmentHearts: new Map([
          [
            PLAYER1,
            [
              { color: HeartColor.YELLOW, count: 2 },
              { color: HeartColor.RAINBOW, count: 4 },
            ],
          ],
        ]),
      },
    };

    const result = rebalanceRemainingHeartColorForPlayer(game, PLAYER1, HeartColor.GREEN, 1);

    expect(result.rebalancedCount).toBe(0);
    expect(result.gameState.liveResolution.playerRemainingHearts.get(PLAYER1)).toEqual([
      { color: HeartColor.RAINBOW, count: 1 },
    ]);
  });
});
