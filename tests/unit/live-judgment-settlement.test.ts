import { describe, it, expect } from 'vitest';
import { CardType, HeartColor, GamePhase, SubPhase, TurnType } from '../../src/shared/types/enums';
import { createGameState, registerCards, updatePlayer } from '../../src/domain/entities/game';
import { createCardInstance, createHeartRequirement } from '../../src/domain/entities/card';
import {
  addCardToStatefulZone,
  addCardToZone,
  removeCardFromZone,
  removeCardFromStatefulZone,
} from '../../src/domain/entities/zone';
import {
  handleConfirmJudgment,
  handleConfirmSubPhase,
  handlePerformCheer,
} from '../../src/application/action-handlers/phase-ten.handler';
import { GameService } from '../../src/application/game-service';
import { createPerformCheerAction } from '../../src/application/actions';

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

  it('连续翻开应援牌时，应累积记录而不是覆盖上一张', () => {
    const cheer1 = createCardInstance(
      {
        cardCode: 'CHEER-1',
        name: 'Cheer 1',
        cardType: CardType.MEMBER as const,
        cost: 1,
        hearts: [],
      },
      'p1',
      'p1-cheer-1'
    );
    const cheer2 = createCardInstance(
      {
        cardCode: 'CHEER-2',
        name: 'Cheer 2',
        cardType: CardType.MEMBER as const,
        cost: 1,
        hearts: [],
      },
      'p1',
      'p1-cheer-2'
    );

    let game = createGameState('g-cheer-append', 'p1', 'P1', 'p2', 'P2');
    game = registerCards(game, [cheer1, cheer2]);
    game = updatePlayer(game, 'p1', (player) => ({
      ...player,
      mainDeck: addCardToZone(addCardToZone(player.mainDeck, cheer2.instanceId), cheer1.instanceId),
    }));

    const ctx = {
      getPlayerById: (state: typeof game, playerId: string) =>
        state.players.find((player) => player.id === playerId),
      drawTopMainDeckCard: (state: typeof game, playerId: string) => {
        const player = state.players.find((candidate) => candidate.id === playerId);
        const cardId = player?.mainDeck.cardIds[0] ?? null;
        if (!cardId) {
          return { gameState: state, cardId: null };
        }
        return {
          gameState: updatePlayer(state, playerId, (currentPlayer) => ({
            ...currentPlayer,
            mainDeck: removeCardFromZone(currentPlayer.mainDeck, cardId),
          })),
          cardId,
        };
      },
    };

    const firstResult = handlePerformCheer(game, createPerformCheerAction('p1', 1), ctx);
    expect(firstResult.success).toBe(true);
    expect(firstResult.gameState.liveResolution.firstPlayerCheerCardIds).toEqual(['p1-cheer-2']);

    const secondResult = handlePerformCheer(
      firstResult.gameState,
      createPerformCheerAction('p1', 1),
      ctx
    );
    expect(secondResult.success).toBe(true);
    expect(secondResult.gameState.liveResolution.firstPlayerCheerCardIds).toEqual([
      'p1-cheer-2',
      'p1-cheer-1',
    ]);
    expect(secondResult.gameState.resolutionZone.cardIds).toEqual(['p1-cheer-2', 'p1-cheer-1']);
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

  it('应在进入 LIVE_RESULT_PHASE 时初始化双方分数', () => {
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
      currentPhase: GamePhase.PERFORMANCE_PHASE,
      currentSubPhase: SubPhase.NONE,
      currentTurnType: TurnType.SECOND_PLAYER_TURN,
      activePlayerIndex: 1,
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

    const confirmResult = service.advancePhase(game);
    expect(confirmResult.success).toBe(true);
    expect(confirmResult.gameState.currentPhase).toBe(GamePhase.LIVE_RESULT_PHASE);
    expect(confirmResult.gameState.currentSubPhase).toBe(SubPhase.RESULT_FIRST_SUCCESS_EFFECTS);
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

  it('RESULT_SETTLEMENT 中胜者可直接确认，剩余 Live 会自动进入休息室', () => {
    const p1LiveA = createCardInstance(
      {
        cardCode: 'SETTLE-P1-LIVE-A',
        name: '结算 Live A',
        cardType: CardType.LIVE as const,
        score: 2,
        requirements: createHeartRequirement({ [HeartColor.PINK]: 1 }),
      },
      'p1',
      'settle-p1-live-a'
    );
    const p1LiveB = createCardInstance(
      {
        cardCode: 'SETTLE-P1-LIVE-B',
        name: '结算 Live B',
        cardType: CardType.LIVE as const,
        score: 3,
        requirements: createHeartRequirement({ [HeartColor.BLUE]: 1 }),
      },
      'p1',
      'settle-p1-live-b'
    );

    let game = createGameState('g-settlement-confirm-direct', 'p1', 'P1', 'p2', 'P2');
    game = registerCards(game, [p1LiveA, p1LiveB]);
    game = updatePlayer(game, 'p1', (player) => ({
      ...player,
      liveZone: addCardToStatefulZone(
        addCardToStatefulZone(player.liveZone, p1LiveA.instanceId),
        p1LiveB.instanceId
      ),
    }));
    game = {
      ...game,
      currentPhase: GamePhase.LIVE_RESULT_PHASE,
      currentSubPhase: SubPhase.RESULT_SETTLEMENT,
      liveResolution: {
        ...game.liveResolution,
        liveWinnerIds: ['p1'],
        successCardMovedBy: [],
        settlementConfirmedBy: [],
      },
    };

    const ctx = {
      getPlayerById: (state: typeof game, playerId: string) =>
        state.players.find((player) => player.id === playerId),
    };

    const result = handleConfirmSubPhase(
      game,
      {
        type: 'CONFIRM_SUB_PHASE',
        playerId: 'p1',
        subPhase: SubPhase.RESULT_SETTLEMENT,
      },
      ctx
    );

    expect(result.success).toBe(true);
    expect(result.gameState.players[0].liveZone.cardIds).toEqual([]);
    expect(result.gameState.players[0].waitingRoom.cardIds).toEqual([
      p1LiveA.instanceId,
      p1LiveB.instanceId,
    ]);
    expect(result.gameState.liveResolution.successCardMovedBy).toEqual([]);
    expect(result.gameState.liveResolution.settlementConfirmedBy).toContain('p1');
  });

  it('双方未完成分数确认时，不应根据草案分数提前判定胜者', () => {
    const service = new GameService();

    const p1Live = createCardInstance(
      {
        cardCode: 'DRAFT-P1',
        name: 'Draft P1',
        cardType: CardType.LIVE as const,
        score: 5,
        requirements: createHeartRequirement({ [HeartColor.PINK]: 1 }),
      },
      'p1',
      'draft-p1-live'
    );
    const p2Live = createCardInstance(
      {
        cardCode: 'DRAFT-P2',
        name: 'Draft P2',
        cardType: CardType.LIVE as const,
        score: 3,
        requirements: createHeartRequirement({ [HeartColor.BLUE]: 1 }),
      },
      'p2',
      'draft-p2-live'
    );

    let game = createGameState('g-draft-score-guard', 'p1', 'P1', 'p2', 'P2');
    game = registerCards(game, [p1Live, p2Live]);
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
          ['p2', 3],
        ]),
        scoreConfirmedBy: ['p1'],
        liveWinnerIds: [],
      },
    };

    const result = service.resolveLiveWinner(game);
    expect(result.success).toBe(true);
    expect(result.gameState.liveResolution.liveWinnerIds).toEqual([]);
  });

  it('胜负判定应以双方确认后的手动调整分数为准', () => {
    const service = new GameService();

    const p1Live = createCardInstance(
      {
        cardCode: 'MANUAL-P1',
        name: 'Manual P1',
        cardType: CardType.LIVE as const,
        score: 2,
        requirements: createHeartRequirement({ [HeartColor.PINK]: 1 }),
      },
      'p1',
      'manual-p1-live'
    );
    const p2Live = createCardInstance(
      {
        cardCode: 'MANUAL-P2',
        name: 'Manual P2',
        cardType: CardType.LIVE as const,
        score: 1,
        requirements: createHeartRequirement({ [HeartColor.BLUE]: 1 }),
      },
      'p2',
      'manual-p2-live'
    );

    let game = createGameState('g-manual-score-winner', 'p1', 'P1', 'p2', 'P2');
    game = registerCards(game, [p1Live, p2Live]);
    game = {
      ...game,
      liveResolution: {
        ...game.liveResolution,
        liveResults: new Map<string, boolean>([
          [p1Live.instanceId, true],
          [p2Live.instanceId, false],
        ]),
        playerScores: new Map<string, number>([
          ['p1', 2],
          ['p2', 4],
        ]),
        scoreConfirmedBy: ['p1', 'p2'],
        liveWinnerIds: [],
      },
    };

    const result = service.resolveLiveWinner(game);
    expect(result.success).toBe(true);
    expect(result.gameState.liveResolution.liveWinnerIds).toEqual(['p2']);
  });

  it('成功 Live 已先移入成功区时，进入分数确认仍应保留分数与胜者判定依据', () => {
    const service = new GameService();

    const p1LiveData = {
      cardCode: 'SUCCESS-P1',
      name: '先攻成功 Live',
      cardType: CardType.LIVE as const,
      score: 4,
      requirements: createHeartRequirement({ [HeartColor.PINK]: 1 }),
    };
    const p2LiveData = {
      cardCode: 'SUCCESS-P2',
      name: '后攻成功 Live',
      cardType: CardType.LIVE as const,
      score: 2,
      requirements: createHeartRequirement({ [HeartColor.BLUE]: 1 }),
    };

    const p1Live = createCardInstance(p1LiveData, 'p1', 'success-p1-live');
    const p2Live = createCardInstance(p2LiveData, 'p2', 'success-p2-live');

    let game = createGameState('g-success-window-score', 'p1', 'P1', 'p2', 'P2');
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
      currentPhase: GamePhase.PERFORMANCE_PHASE,
      currentSubPhase: SubPhase.NONE,
      currentTurnType: TurnType.SECOND_PLAYER_TURN,
      activePlayerIndex: 1,
      liveResolution: {
        ...game.liveResolution,
        liveResults: new Map<string, boolean>([
          [p1Live.instanceId, true],
          [p2Live.instanceId, true],
        ]),
        liveWinnerIds: ['p1'],
      },
    };

    game = updatePlayer(game, 'p1', (player) => ({
      ...player,
      liveZone: removeCardFromStatefulZone(player.liveZone, p1Live.instanceId),
      successZone: addCardToZone(player.successZone, p1Live.instanceId),
    }));

    const settleInitResult = service.advancePhase(game);
    expect(settleInitResult.success).toBe(true);
    expect(settleInitResult.gameState.currentPhase).toBe(GamePhase.LIVE_RESULT_PHASE);
    expect(settleInitResult.gameState.currentSubPhase).toBe(SubPhase.RESULT_FIRST_SUCCESS_EFFECTS);
    expect(settleInitResult.gameState.liveResolution.playerScores.get('p1')).toBe(4);
    expect(settleInitResult.gameState.liveResolution.playerScores.get('p2')).toBe(2);

    const winnerResult = service.resolveLiveWinner({
      ...settleInitResult.gameState,
      liveResolution: {
        ...settleInitResult.gameState.liveResolution,
        scoreConfirmedBy: ['p1', 'p2'],
      },
    });
    expect(winnerResult.success).toBe(true);
    expect(winnerResult.gameState.liveResolution.liveWinnerIds).toEqual(['p1']);
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
