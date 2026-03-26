import { describe, it, expect } from 'vitest';
import { CardType, HeartColor, GamePhase, SubPhase } from '../../src/shared/types/enums';
import { createGameState, registerCards, updatePlayer } from '../../src/domain/entities/game';
import { createCardInstance, createHeartRequirement } from '../../src/domain/entities/card';
import { addCardToStatefulZone } from '../../src/domain/entities/zone';
import { handleConfirmJudgment } from '../../src/application/action-handlers/phase-ten.handler';
import { GameService } from '../../src/application/game-service';
import { createConfirmSubPhaseAction } from '../../src/application/actions';

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
    expect(settleResult.gameState.liveResolution.liveWinnerIds).toEqual([]);
  });

  it('应在进入 RESULT_SETTLEMENT 时才计算双方分数', () => {
    const service = new GameService();
    const p1LiveData = {
      cardCode: 'P1-LIVE-2',
      name: 'P1 Live 2',
      cardType: CardType.LIVE as const,
      score: 4,
      requirements: createHeartRequirement({ [HeartColor.PINK]: 1 }),
    };
    const p2LiveData = {
      cardCode: 'P2-LIVE-2',
      name: 'P2 Live 2',
      cardType: CardType.LIVE as const,
      score: 6,
      requirements: createHeartRequirement({ [HeartColor.BLUE]: 1 }),
    };

    const p1Live = createCardInstance(p1LiveData, 'p1', 'p1-live-2');
    const p2Live = createCardInstance(p2LiveData, 'p2', 'p2-live-2');

    let game = createGameState('g-live-score-timing', 'p1', 'P1', 'p2', 'P2');
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
      currentPhase: GamePhase.LIVE_RESULT_PHASE,
      currentSubPhase: SubPhase.RESULT_SECOND_SUCCESS_EFFECTS,
      liveResolution: {
        ...game.liveResolution,
        liveResults: new Map<string, boolean>([
          [p1Live.instanceId, true],
          [p2Live.instanceId, true],
        ]),
        playerScores: new Map(),
        scoreConfirmedBy: [],
        liveWinnerIds: [],
      },
    };

    const confirmResult = service.processAction(
      game,
      createConfirmSubPhaseAction('p2', SubPhase.RESULT_SECOND_SUCCESS_EFFECTS)
    );
    expect(confirmResult.success).toBe(true);
    expect(confirmResult.gameState.currentSubPhase).toBe(SubPhase.RESULT_SETTLEMENT);
    expect(confirmResult.gameState.liveResolution.playerScores.get('p1')).toBe(4);
    expect(confirmResult.gameState.liveResolution.playerScores.get('p2')).toBe(6);
    expect(confirmResult.gameState.liveResolution.liveWinnerIds).toEqual([]);
  });

  it('分数相等时，成功区卡数 < 2 的玩家获胜', () => {
    const service = new GameService();

    const mkLive = (code: string, owner: string, id: string, score: number) => {
      const data = {
        cardCode: code,
        name: code,
        cardType: CardType.LIVE as const,
        score,
        requirements: createHeartRequirement({ [HeartColor.PINK]: 1 }),
      };
      return createCardInstance(data, owner, id);
    };

    const p1Live = mkLive('TIE-P1', 'p1', 'tie-p1-live', 5);
    const p2Live = mkLive('TIE-P2', 'p2', 'tie-p2-live', 5);

    let game = createGameState('g-tie-breaker', 'p1', 'P1', 'p2', 'P2');
    game = registerCards(game, [p1Live, p2Live]);
    game = updatePlayer(game, 'p1', (player) => ({
      ...player,
      liveZone: addCardToStatefulZone(player.liveZone, p1Live.instanceId),
    }));
    game = updatePlayer(game, 'p2', (player) => ({
      ...player,
      liveZone: addCardToStatefulZone(player.liveZone, p2Live.instanceId),
      // p2 已有 2 张成功区卡
      successZone: { ...player.successZone, cardIds: ['dummy-s1', 'dummy-s2'] },
    }));
    game = {
      ...game,
      liveResolution: {
        ...game.liveResolution,
        liveResults: new Map<string, boolean>([
          [p1Live.instanceId, true],
          [p2Live.instanceId, true],
        ]),
        playerScores: new Map<string, number>([
          ['p1', 5],
          ['p2', 5],
        ]),
        scoreConfirmedBy: ['p1', 'p2'],
        liveWinnerIds: [],
      },
    };

    const result = service.resolveLiveWinner(game);
    expect(result.success).toBe(true);
    // p1 成功区 0 < 2 → 获胜；p2 成功区 2 >= 2 → 不获胜
    expect(result.gameState.liveResolution.liveWinnerIds).toEqual(['p1']);
  });

  it('分数相等且双方成功区均 < 2 时，双方都获胜', () => {
    const service = new GameService();

    const mkLive = (code: string, owner: string, id: string, score: number) => {
      const data = {
        cardCode: code,
        name: code,
        cardType: CardType.LIVE as const,
        score,
        requirements: createHeartRequirement({ [HeartColor.PINK]: 1 }),
      };
      return createCardInstance(data, owner, id);
    };

    const p1Live = mkLive('TIE2-P1', 'p1', 'tie2-p1-live', 3);
    const p2Live = mkLive('TIE2-P2', 'p2', 'tie2-p2-live', 3);

    let game = createGameState('g-tie-both', 'p1', 'P1', 'p2', 'P2');
    game = registerCards(game, [p1Live, p2Live]);
    game = updatePlayer(game, 'p1', (player) => ({
      ...player,
      liveZone: addCardToStatefulZone(player.liveZone, p1Live.instanceId),
      successZone: { ...player.successZone, cardIds: ['dummy-1'] }, // 1 < 2
    }));
    game = updatePlayer(game, 'p2', (player) => ({
      ...player,
      liveZone: addCardToStatefulZone(player.liveZone, p2Live.instanceId),
      // 0 < 2
    }));
    game = {
      ...game,
      liveResolution: {
        ...game.liveResolution,
        liveResults: new Map<string, boolean>([
          [p1Live.instanceId, true],
          [p2Live.instanceId, true],
        ]),
        playerScores: new Map<string, number>([
          ['p1', 3],
          ['p2', 3],
        ]),
        scoreConfirmedBy: ['p1', 'p2'],
        liveWinnerIds: [],
      },
    };

    const result = service.resolveLiveWinner(game);
    expect(result.success).toBe(true);
    expect(result.gameState.liveResolution.liveWinnerIds).toEqual(['p1', 'p2']);
  });
});
