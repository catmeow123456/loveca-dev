import { describe, it, expect } from 'vitest';
import { CardType, HeartColor } from '../../src/shared/types/enums';
import { createGameState, registerCards, updatePlayer } from '../../src/domain/entities/game';
import { createCardInstance, createHeartRequirement } from '../../src/domain/entities/card';
import { addCardToStatefulZone } from '../../src/domain/entities/zone';
import { handleConfirmJudgment } from '../../src/application/action-handlers/phase-ten.handler';
import { GameService } from '../../src/application/game-service';

describe('Live 判定与结算', () => {
  it('确认判定应合并 liveResults，而不是覆盖其他玩家结果', () => {
    const game = createGameState('g-judgment-merge', 'p1', 'P1', 'p2', 'P2');
    const existing = new Map<string, boolean>([['p2-live-1', true]]);

    const result = handleConfirmJudgment(
      {
        ...game,
        liveResolution: {
          ...game.liveResolution,
          liveResults: existing,
        },
      },
      {
        type: 'CONFIRM_JUDGMENT',
        playerId: 'p1',
        judgmentResults: new Map<string, boolean>([['p1-live-1', false]]),
      },
      {} as never
    );

    expect(result.success).toBe(true);
    expect(result.gameState.liveResolution.liveResults.get('p2-live-1')).toBe(true);
    expect(result.gameState.liveResolution.liveResults.get('p1-live-1')).toBe(false);
  });

  it('结算阶段应只统计判定成功的 Live 分数', () => {
    const service = new GameService();
    const p1LiveData = {
      cardCode: 'P1-LIVE-1',
      name: 'P1 Live',
      cardType: CardType.LIVE as const,
      score: 5,
      requirements: createHeartRequirement({ [HeartColor.PINK]: 1 }),
    };
    const p2LiveData = {
      cardCode: 'P2-LIVE-1',
      name: 'P2 Live',
      cardType: CardType.LIVE as const,
      score: 3,
      requirements: createHeartRequirement({ [HeartColor.BLUE]: 1 }),
    };

    const p1Live = createCardInstance(p1LiveData, 'p1', 'p1-live-1');
    const p2Live = createCardInstance(p2LiveData, 'p2', 'p2-live-1');

    let game = createGameState('g-live-score', 'p1', 'P1', 'p2', 'P2');
    game = registerCards(game, [p1Live, p2Live]);

    game = updatePlayer(game, 'p1', (player) => ({
      ...player,
      liveZone: addCardToStatefulZone(player.liveZone, p1Live.instanceId),
    }));
    game = updatePlayer(game, 'p2', (player) => ({
      ...player,
      liveZone: addCardToStatefulZone(player.liveZone, p2Live.instanceId),
    }));

    game = {
      ...game,
      liveResolution: {
        ...game.liveResolution,
        liveResults: new Map<string, boolean>([
          [p1Live.instanceId, false],
          [p2Live.instanceId, true],
        ]),
      },
    };

    const settleResult = service.executeLiveResultPhase(game);
    expect(settleResult.success).toBe(true);
    expect(settleResult.gameState.liveResolution.playerScores.get('p1')).toBe(0);
    expect(settleResult.gameState.liveResolution.playerScores.get('p2')).toBe(3);
    expect(settleResult.gameState.liveResolution.liveWinnerIds).toEqual(['p2']);
  });
});
