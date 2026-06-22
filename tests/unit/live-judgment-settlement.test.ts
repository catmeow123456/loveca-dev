import { describe, it, expect } from 'vitest';
import {
  BladeHeartEffect,
  CardType,
  EffectWindowType,
  FaceState,
  HeartColor,
  GamePhase,
  OrientationState,
  SlotPosition,
  SubPhase,
  TurnType,
} from '../../src/shared/types/enums';
import { createGameState, registerCards, updatePlayer } from '../../src/domain/entities/game';
import { createCardInstance, createHeartRequirement } from '../../src/domain/entities/card';
import {
  addCardToStatefulZone,
  addCardToZone,
  placeCardInSlot,
  removeCardFromZone,
  removeCardFromStatefulZone,
} from '../../src/domain/entities/zone';
import {
  handleConfirmJudgment,
  handleConfirmSubPhase,
  handlePerformCheer,
} from '../../src/application/action-handlers/phase-ten.handler';
import { GameService } from '../../src/application/game-service';
import {
  createConfirmSubPhaseAction,
  createPerformCheerAction,
} from '../../src/application/actions';
import {
  BOKUIMA_LIVE_START_REQUIREMENT_ABILITY_ID,
  confirmActiveEffectStep,
  NICO_LIVE_START_SCORE_ABILITY_ID,
} from '../../src/application/card-effect-runner';
import { collectLiveModifiers } from '../../src/domain/rules/live-modifiers';

describe('Live 判定与结算', () => {
  it('进入判定子阶段时应先自动翻应援，接受后才生成 Live 成功与分数草案', () => {
    const service = new GameService();
    const member = createCardInstance(
      {
        cardCode: 'AUTO-MEMBER',
        name: 'Auto Member',
        cardType: CardType.MEMBER as const,
        cost: 1,
        blade: 2,
        hearts: [{ color: HeartColor.PINK, count: 1 }],
      },
      'p1',
      'p1-member'
    );
    const liveA = createCardInstance(
      {
        cardCode: 'AUTO-LIVE-A',
        name: 'Auto Live A',
        cardType: CardType.LIVE as const,
        score: 3,
        requirements: createHeartRequirement({ [HeartColor.PINK]: 1 }),
      },
      'p1',
      'p1-live-a'
    );
    const liveB = createCardInstance(
      {
        cardCode: 'AUTO-LIVE-B',
        name: 'Auto Live B',
        cardType: CardType.LIVE as const,
        score: 2,
        requirements: createHeartRequirement({ [HeartColor.BLUE]: 1 }),
      },
      'p1',
      'p1-live-b'
    );
    const cheerHeartScore = createCardInstance(
      {
        cardCode: 'AUTO-CHEER-HEART-SCORE',
        name: 'Auto Cheer Heart Score',
        cardType: CardType.MEMBER as const,
        cost: 1,
        blade: 0,
        hearts: [],
        bladeHearts: [
          { effect: BladeHeartEffect.HEART, heartColor: HeartColor.BLUE },
          { effect: BladeHeartEffect.SCORE },
        ],
      },
      'p1',
      'p1-cheer-heart-score'
    );
    const cheerDraw = createCardInstance(
      {
        cardCode: 'AUTO-CHEER-DRAW',
        name: 'Auto Cheer Draw',
        cardType: CardType.MEMBER as const,
        cost: 1,
        blade: 0,
        hearts: [],
        bladeHearts: [{ effect: BladeHeartEffect.DRAW }],
      },
      'p1',
      'p1-cheer-draw'
    );
    const drawnCard = createCardInstance(
      {
        cardCode: 'AUTO-DRAWN',
        name: 'Auto Drawn',
        cardType: CardType.MEMBER as const,
        cost: 1,
        blade: 0,
        hearts: [],
      },
      'p1',
      'p1-drawn'
    );

    let game = createGameState('g-auto-live-draft', 'p1', 'P1', 'p2', 'P2');
    game = registerCards(game, [member, liveA, liveB, cheerHeartScore, cheerDraw, drawnCard]);
    game = updatePlayer(game, 'p1', (player) => ({
      ...player,
      memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, member.instanceId),
      liveZone: addCardToStatefulZone(
        addCardToStatefulZone(player.liveZone, liveA.instanceId),
        liveB.instanceId
      ),
      mainDeck: addCardToZone(
        addCardToZone(
          addCardToZone(player.mainDeck, cheerHeartScore.instanceId),
          cheerDraw.instanceId
        ),
        drawnCard.instanceId
      ),
    }));
    game = {
      ...game,
      currentPhase: GamePhase.PERFORMANCE_PHASE,
      currentSubPhase: SubPhase.PERFORMANCE_LIVE_START_EFFECTS,
      currentTurnType: TurnType.FIRST_PLAYER_TURN,
      activePlayerIndex: 0,
      effectWindowType: EffectWindowType.LIVE_START,
    };

    const revealResult = service.processAction(
      game,
      createConfirmSubPhaseAction('p1', SubPhase.PERFORMANCE_LIVE_START_EFFECTS)
    );

    expect(revealResult.success).toBe(true);
    expect(revealResult.gameState.currentSubPhase).toBe(SubPhase.PERFORMANCE_JUDGMENT);
    expect(revealResult.gameState.liveResolution.firstPlayerCheerCardIds).toEqual([
      cheerHeartScore.instanceId,
      cheerDraw.instanceId,
    ]);
    expect(revealResult.gameState.resolutionZone.cardIds).toEqual([
      cheerHeartScore.instanceId,
      cheerDraw.instanceId,
    ]);
    expect(revealResult.gameState.resolutionZone.revealedCardIds).toEqual([
      cheerHeartScore.instanceId,
      cheerDraw.instanceId,
    ]);
    expect(revealResult.gameState.liveResolution.liveResults.size).toBe(0);
    expect(revealResult.gameState.liveResolution.playerScores.size).toBe(0);
    expect(revealResult.gameState.players[0].hand.cardIds).not.toContain(drawnCard.instanceId);

    const acceptResult = service.processAction(revealResult.gameState, {
      type: 'CONFIRM_JUDGMENT',
      playerId: 'p1',
      judgmentResults: new Map(),
      timestamp: Date.now(),
    });

    expect(acceptResult.success).toBe(true);
    expect(acceptResult.gameState.liveResolution.liveResults.get(liveA.instanceId)).toBe(true);
    expect(acceptResult.gameState.liveResolution.liveResults.get(liveB.instanceId)).toBe(true);
    expect(acceptResult.gameState.liveResolution.playerScores.get('p1')).toBe(6);
    expect(acceptResult.gameState.liveResolution.scoreConfirmedBy).toEqual([]);
    expect(acceptResult.gameState.players[0].hand.cardIds).toContain(drawnCard.instanceId);
  });

  it('多张 Live 中任意一张失败时，接受自动判定应将整轮 Live 记为失败', () => {
    const service = new GameService();
    const member = createCardInstance(
      {
        cardCode: 'PARTIAL-MEMBER',
        name: 'Partial Member',
        cardType: CardType.MEMBER as const,
        cost: 1,
        blade: 0,
        hearts: [
          { color: HeartColor.PINK, count: 1 },
          { color: HeartColor.YELLOW, count: 1 },
          { color: HeartColor.BLUE, count: 3 },
        ],
      },
      'p1',
      'p1-partial-member'
    );
    const failedLive = createCardInstance(
      {
        cardCode: 'PARTIAL-FAILED-LIVE',
        name: 'Partial Failed Live',
        cardType: CardType.LIVE as const,
        score: 1,
        requirements: createHeartRequirement({ [HeartColor.PINK]: 2 }),
      },
      'p1',
      'p1-partial-failed-live'
    );
    const rawSuccessLive = createCardInstance(
      {
        cardCode: 'PARTIAL-RAW-SUCCESS-LIVE',
        name: 'Partial Raw Success Live',
        cardType: CardType.LIVE as const,
        score: 2,
        requirements: createHeartRequirement({
          [HeartColor.PINK]: 1,
          [HeartColor.YELLOW]: 1,
          [HeartColor.RAINBOW]: 3,
        }),
      },
      'p1',
      'p1-partial-raw-success-live'
    );

    let game = createGameState('g-partial-live-overall-fail', 'p1', 'P1', 'p2', 'P2');
    game = registerCards(game, [member, failedLive, rawSuccessLive]);
    game = updatePlayer(game, 'p1', (player) => ({
      ...player,
      memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, member.instanceId),
      liveZone: addCardToStatefulZone(
        addCardToStatefulZone(player.liveZone, failedLive.instanceId),
        rawSuccessLive.instanceId
      ),
    }));
    game = {
      ...game,
      currentPhase: GamePhase.PERFORMANCE_PHASE,
      currentSubPhase: SubPhase.PERFORMANCE_JUDGMENT,
      currentTurnType: TurnType.FIRST_PLAYER_TURN,
      activePlayerIndex: 0,
      liveResolution: {
        ...game.liveResolution,
        isInLive: true,
        performingPlayerId: 'p1',
      },
    };

    const acceptResult = service.processAction(game, {
      type: 'CONFIRM_JUDGMENT',
      playerId: 'p1',
      judgmentResults: new Map(),
      timestamp: Date.now(),
    });

    expect(acceptResult.success).toBe(true);
    expect(acceptResult.gameState.liveResolution.liveResults.get(failedLive.instanceId)).toBe(
      false
    );
    expect(acceptResult.gameState.liveResolution.liveResults.get(rawSuccessLive.instanceId)).toBe(
      false
    );
    expect(acceptResult.gameState.liveResolution.playerScores.get('p1')).toBe(0);
  });

  it('PL!-sd1-001-SD 应按成功 Live 数增加自动翻应援数量', () => {
    const service = new GameService();
    const honoka = createCardInstance(
      {
        cardCode: 'PL!-sd1-001-SD',
        name: '高坂穗乃果',
        cardType: CardType.MEMBER as const,
        cost: 11,
        blade: 3,
        hearts: [{ color: HeartColor.PINK, count: 1 }],
      },
      'p1',
      'p1-honoka'
    );
    const live = createCardInstance(
      {
        cardCode: 'HONOKA-LIVE',
        name: 'Honoka Live',
        cardType: CardType.LIVE as const,
        score: 3,
        requirements: createHeartRequirement({ [HeartColor.PINK]: 1 }),
      },
      'p1',
      'p1-honoka-live'
    );
    const successLiveA = createCardInstance(
      {
        cardCode: 'HONOKA-SUCCESS-A',
        name: 'Success A',
        cardType: CardType.LIVE as const,
        score: 1,
        requirements: createHeartRequirement({ [HeartColor.PINK]: 1 }),
      },
      'p1',
      'p1-success-a'
    );
    const successLiveB = createCardInstance(
      {
        cardCode: 'HONOKA-SUCCESS-B',
        name: 'Success B',
        cardType: CardType.LIVE as const,
        score: 1,
        requirements: createHeartRequirement({ [HeartColor.PINK]: 1 }),
      },
      'p1',
      'p1-success-b'
    );
    const cheerCards = Array.from({ length: 5 }, (_, index) =>
      createCardInstance(
        {
          cardCode: `HONOKA-CHEER-${index}`,
          name: `Honoka Cheer ${index}`,
          cardType: CardType.MEMBER as const,
          cost: 1,
          blade: 0,
          hearts: [],
        },
        'p1',
        `p1-honoka-cheer-${index}`
      )
    );

    let game = createGameState('g-honoka-blade-bonus', 'p1', 'P1', 'p2', 'P2');
    game = registerCards(game, [honoka, live, successLiveA, successLiveB, ...cheerCards]);
    game = updatePlayer(game, 'p1', (player) => ({
      ...player,
      memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, honoka.instanceId),
      liveZone: addCardToStatefulZone(player.liveZone, live.instanceId),
      successZone: addCardToZone(
        addCardToZone(player.successZone, successLiveA.instanceId),
        successLiveB.instanceId
      ),
      mainDeck: cheerCards.reduce(
        (zone, card) => addCardToZone(zone, card.instanceId),
        player.mainDeck
      ),
    }));
    game = {
      ...game,
      currentPhase: GamePhase.PERFORMANCE_PHASE,
      currentSubPhase: SubPhase.PERFORMANCE_LIVE_START_EFFECTS,
      currentTurnType: TurnType.FIRST_PLAYER_TURN,
      activePlayerIndex: 0,
      effectWindowType: EffectWindowType.LIVE_START,
    };

    const revealResult = service.processAction(
      game,
      createConfirmSubPhaseAction('p1', SubPhase.PERFORMANCE_LIVE_START_EFFECTS)
    );

    expect(revealResult.success).toBe(true);
    expect(revealResult.gameState.liveResolution.firstPlayerCheerCardIds).toEqual(
      cheerCards.map((card) => card.instanceId)
    );
    expect(revealResult.gameState.actionHistory.at(-1)?.payload.cheerCount).toBe(5);
    expect(revealResult.gameState.liveResolution.liveModifiers).toEqual([]);
    expect(collectLiveModifiers(revealResult.gameState)).toContainEqual({
      kind: 'BLADE',
      playerId: 'p1',
      countDelta: 2,
      sourceCardId: honoka.instanceId,
    });
  });

  it('PL!-sd1-009-SD 条件满足时应让自动分数草案 +1', () => {
    const service = new GameService();
    const nico = createCardInstance(
      {
        cardCode: 'PL!-sd1-009-SD',
        name: '矢泽日香',
        cardType: CardType.MEMBER as const,
        cost: 15,
        blade: 5,
        hearts: [{ color: HeartColor.PINK, count: 1 }],
        cardText:
          "【LIVE开始时】自己的休息室中存在大于等于25张『μ's』的卡片的场合，LIVE结束时为止，获得「【常时】LIVE的合计分数＋１。」。",
      },
      'p1',
      'p1-nico'
    );
    const live = createCardInstance(
      {
        cardCode: 'NICO-LIVE',
        name: 'Nico Live',
        cardType: CardType.LIVE as const,
        score: 3,
        requirements: createHeartRequirement({ [HeartColor.PINK]: 1 }),
      },
      'p1',
      'p1-nico-live'
    );
    const waitingRoomCards = Array.from({ length: 25 }, (_, index) =>
      createCardInstance(
        {
          cardCode: `PL!-NICO-WAITING-${index}`,
          name: `Muse Waiting ${index}`,
          cardType: CardType.MEMBER as const,
          cost: 1,
          blade: 0,
          hearts: [],
          groupName: "μ's",
        },
        'p1',
        `p1-nico-waiting-${index}`
      )
    );
    const mainDeckCards = Array.from({ length: 5 }, (_, index) =>
      createCardInstance(
        {
          cardCode: `NICO-CHEER-${index}`,
          name: `Nico Cheer ${index}`,
          cardType: CardType.MEMBER as const,
          cost: 1,
          blade: 0,
          hearts: [],
        },
        'p1',
        `p1-nico-cheer-${index}`
      )
    );

    let game = createGameState('g-nico-score-bonus', 'p1', 'P1', 'p2', 'P2');
    game = registerCards(game, [nico, live, ...waitingRoomCards, ...mainDeckCards]);
    game = updatePlayer(game, 'p1', (player) => ({
      ...player,
      memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, nico.instanceId),
      liveZone: addCardToStatefulZone(player.liveZone, live.instanceId),
      mainDeck: mainDeckCards.reduce(
        (zone, card) => addCardToZone(zone, card.instanceId),
        player.mainDeck
      ),
      waitingRoom: waitingRoomCards.reduce(
        (zone, card) => addCardToZone(zone, card.instanceId),
        player.waitingRoom
      ),
    }));
    game = {
      ...game,
      currentPhase: GamePhase.LIVE_SET_PHASE,
      currentSubPhase: SubPhase.LIVE_SET_SECOND_DRAW,
      currentTurnType: TurnType.LIVE_PHASE,
      activePlayerIndex: 0,
      firstPlayerIndex: 0,
      liveSetCompletedPlayers: ['p1', 'p2'],
    };

    const advanceResult = service.advancePhase(game);
    expect(advanceResult.success).toBe(true);
    expect(advanceResult.gameState.activeEffect?.abilityId).toBe(NICO_LIVE_START_SCORE_ABILITY_ID);
    expect(advanceResult.gameState.activeEffect?.awaitingPlayerId).toBe('p1');
    expect(advanceResult.gameState.activeEffect?.effectText).toContain('（当前25张）');
    expect(advanceResult.gameState.liveResolution.playerScoreBonuses.get('p1')).toBeUndefined();

    const afterNico = confirmActiveEffectStep(
      advanceResult.gameState,
      'p1',
      advanceResult.gameState.activeEffect!.id
    );
    expect(afterNico.activeEffect).toBeNull();
    expect(afterNico.liveResolution.playerScoreBonuses.get('p1')).toBe(1);
    expect(afterNico.liveResolution.liveModifiers).toContainEqual({
      kind: 'SCORE',
      playerId: 'p1',
      countDelta: 1,
      sourceCardId: nico.instanceId,
      abilityId: NICO_LIVE_START_SCORE_ABILITY_ID,
    });

    const revealResult = service.processAction(
      afterNico,
      createConfirmSubPhaseAction('p1', SubPhase.PERFORMANCE_LIVE_START_EFFECTS)
    );
    expect(revealResult.success).toBe(true);

    const acceptResult = service.processAction(revealResult.gameState, {
      type: 'CONFIRM_JUDGMENT',
      playerId: 'p1',
      judgmentResults: new Map(),
      timestamp: Date.now(),
    });

    expect(acceptResult.success).toBe(true);
    expect(acceptResult.gameState.liveResolution.liveResults.get(live.instanceId)).toBe(true);
    expect(acceptResult.gameState.liveResolution.playerScores.get('p1')).toBe(4);
  });

  it('PL!-sd1-022-SD 应按成功 Live 数减少必要无色 Heart', () => {
    const service = new GameService();
    const member = createCardInstance(
      {
        cardCode: 'BOKUIMA-MEMBER',
        name: 'Bokura Member',
        cardType: CardType.MEMBER as const,
        cost: 1,
        blade: 0,
        hearts: [
          { color: HeartColor.PINK, count: 2 },
          { color: HeartColor.YELLOW, count: 2 },
          { color: HeartColor.PURPLE, count: 2 },
        ],
      },
      'p1',
      'p1-bokuima-member'
    );
    const live = createCardInstance(
      {
        cardCode: 'PL!-sd1-022-SD',
        name: '如今的我们',
        cardType: CardType.LIVE as const,
        score: 4,
        requirements: createHeartRequirement({
          [HeartColor.PINK]: 2,
          [HeartColor.YELLOW]: 2,
          [HeartColor.PURPLE]: 2,
          [HeartColor.RAINBOW]: 6,
        }),
      },
      'p1',
      'p1-bokuima-live'
    );

    let game = createGameState('g-bokuima-reduce-requirement', 'p1', 'P1', 'p2', 'P2');
    game = registerCards(game, [member, live]);
    game = updatePlayer(game, 'p1', (player) => ({
      ...player,
      memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, member.instanceId),
      liveZone: addCardToStatefulZone(player.liveZone, live.instanceId),
      successZone: {
        ...player.successZone,
        cardIds: ['success-live-1', 'success-live-2', 'success-live-3'],
      },
    }));
    game = {
      ...game,
      currentPhase: GamePhase.PERFORMANCE_PHASE,
      currentSubPhase: SubPhase.PERFORMANCE_JUDGMENT,
      currentTurnType: TurnType.FIRST_PLAYER_TURN,
      activePlayerIndex: 0,
      liveResolution: {
        ...game.liveResolution,
        isInLive: true,
        performingPlayerId: 'p1',
        liveRequirementReductions: new Map([[live.instanceId, 6]]),
      },
    };

    const acceptResult = service.processAction(game, {
      type: 'CONFIRM_JUDGMENT',
      playerId: 'p1',
      judgmentResults: new Map(),
      timestamp: Date.now(),
    });

    expect(acceptResult.success).toBe(true);
    expect(acceptResult.gameState.liveResolution.liveResults.get(live.instanceId)).toBe(true);
    expect(acceptResult.gameState.liveResolution.playerScores.get('p1')).toBe(4);
  });

  it('PL!-sd1-022-SD 结算后进入判定应立即使用减少后的必要无色 Heart', () => {
    const service = new GameService();
    const member = createCardInstance(
      {
        cardCode: 'BOKUIMA-PERFORMANCE-MEMBER',
        name: 'Bokura Performance Member',
        cardType: CardType.MEMBER as const,
        cost: 1,
        blade: 0,
        hearts: [
          { color: HeartColor.PINK, count: 2 },
          { color: HeartColor.YELLOW, count: 1 },
          { color: HeartColor.PURPLE, count: 1 },
        ],
      },
      'p1',
      'p1-bokuima-performance-member'
    );
    const live = createCardInstance(
      {
        cardCode: 'PL!-sd1-022-SD',
        name: '如今的我们',
        cardType: CardType.LIVE as const,
        score: 4,
        requirements: createHeartRequirement({ [HeartColor.RAINBOW]: 6 }),
      },
      'p1',
      'p1-bokuima-performance-live'
    );

    let game = createGameState('g-bokuima-reduce-before-auto-judgment', 'p1', 'P1', 'p2', 'P2');
    game = registerCards(game, [member, live]);
    game = updatePlayer(game, 'p1', (player) => ({
      ...player,
      memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, member.instanceId),
      liveZone: addCardToStatefulZone(player.liveZone, live.instanceId),
      successZone: {
        ...player.successZone,
        cardIds: ['success-live-1'],
      },
    }));
    game = {
      ...game,
      currentPhase: GamePhase.LIVE_SET_PHASE,
      currentSubPhase: SubPhase.LIVE_SET_SECOND_DRAW,
      currentTurnType: TurnType.LIVE_PHASE,
      activePlayerIndex: 0,
      firstPlayerIndex: 0,
      liveSetCompletedPlayers: ['p1', 'p2'],
    };

    const advanceResult = service.advancePhase(game);
    expect(advanceResult.success).toBe(true);
    expect(advanceResult.gameState.activeEffect?.abilityId).toBe(
      BOKUIMA_LIVE_START_REQUIREMENT_ABILITY_ID
    );

    const afterBokuima = confirmActiveEffectStep(
      advanceResult.gameState,
      'p1',
      advanceResult.gameState.activeEffect!.id
    );
    expect(afterBokuima.liveResolution.liveModifiers).toContainEqual({
      kind: 'REQUIREMENT',
      liveCardId: live.instanceId,
      modifiers: [{ color: HeartColor.RAINBOW, countDelta: -2 }],
      sourceCardId: live.instanceId,
      abilityId: BOKUIMA_LIVE_START_REQUIREMENT_ABILITY_ID,
    });

    const revealResult = service.processAction(
      afterBokuima,
      createConfirmSubPhaseAction('p1', SubPhase.PERFORMANCE_LIVE_START_EFFECTS)
    );
    expect(revealResult.success).toBe(true);
    expect(revealResult.gameState.currentSubPhase).toBe(SubPhase.PERFORMANCE_JUDGMENT);

    const acceptResult = service.processAction(revealResult.gameState, {
      type: 'CONFIRM_JUDGMENT',
      playerId: 'p1',
      judgmentResults: new Map(),
      timestamp: Date.now(),
    });

    expect(acceptResult.success).toBe(true);
    expect(acceptResult.gameState.liveResolution.liveResults.get(live.instanceId)).toBe(true);
    expect(acceptResult.gameState.liveResolution.playerScores.get('p1')).toBe(4);
  });

  it('PL!-sd1-022-SD 应支持只用 totalRequired 表达的无色 Heart 减少', () => {
    const service = new GameService();
    const member = createCardInstance(
      {
        cardCode: 'BOKUIMA-MEMBER-TOTAL',
        name: 'Bokura Member Total',
        cardType: CardType.MEMBER as const,
        cost: 1,
        blade: 0,
        hearts: [
          { color: HeartColor.PINK, count: 5 },
          { color: HeartColor.YELLOW, count: 2 },
          { color: HeartColor.PURPLE, count: 3 },
        ],
      },
      'p1',
      'p1-bokuima-total-member'
    );
    const live = createCardInstance(
      {
        cardCode: 'PL!-sd1-022-SD',
        name: '如今的我们',
        cardType: CardType.LIVE as const,
        score: 4,
        requirements: createHeartRequirement(
          {
            [HeartColor.PINK]: 2,
            [HeartColor.YELLOW]: 2,
            [HeartColor.PURPLE]: 2,
          },
          12
        ),
      },
      'p1',
      'p1-bokuima-total-live'
    );

    let game = createGameState('g-bokuima-reduce-total-requirement', 'p1', 'P1', 'p2', 'P2');
    game = registerCards(game, [member, live]);
    game = updatePlayer(game, 'p1', (player) => ({
      ...player,
      memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, member.instanceId),
      liveZone: addCardToStatefulZone(player.liveZone, live.instanceId),
      successZone: {
        ...player.successZone,
        cardIds: ['success-live-1'],
      },
    }));
    game = {
      ...game,
      currentPhase: GamePhase.PERFORMANCE_PHASE,
      currentSubPhase: SubPhase.PERFORMANCE_JUDGMENT,
      currentTurnType: TurnType.FIRST_PLAYER_TURN,
      activePlayerIndex: 0,
      liveResolution: {
        ...game.liveResolution,
        isInLive: true,
        performingPlayerId: 'p1',
        liveRequirementModifiers: new Map([
          [live.instanceId, [{ color: HeartColor.RAINBOW, countDelta: -2 }]],
        ]),
      },
    };

    const acceptResult = service.processAction(game, {
      type: 'CONFIRM_JUDGMENT',
      playerId: 'p1',
      judgmentResults: new Map(),
      timestamp: Date.now(),
    });

    expect(acceptResult.success).toBe(true);
    expect(acceptResult.gameState.liveResolution.liveResults.get(live.instanceId)).toBe(true);
    expect(acceptResult.gameState.liveResolution.playerScores.get('p1')).toBe(4);
  });

  it('统一 Live modifier 应能独立提供分数修正', () => {
    const service = new GameService();
    const member = createCardInstance(
      {
        cardCode: 'MODIFIER-SCORE-MEMBER',
        name: 'Modifier Score Member',
        cardType: CardType.MEMBER as const,
        cost: 1,
        blade: 0,
        hearts: [{ color: HeartColor.PINK, count: 1 }],
      },
      'p1',
      'p1-modifier-score-member'
    );
    const live = createCardInstance(
      {
        cardCode: 'MODIFIER-SCORE-LIVE',
        name: 'Modifier Score Live',
        cardType: CardType.LIVE as const,
        score: 3,
        requirements: createHeartRequirement({ [HeartColor.PINK]: 1 }),
      },
      'p1',
      'p1-modifier-score-live'
    );

    let game = createGameState('g-live-modifier-score', 'p1', 'P1', 'p2', 'P2');
    game = registerCards(game, [member, live]);
    game = updatePlayer(game, 'p1', (player) => ({
      ...player,
      memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, member.instanceId),
      liveZone: addCardToStatefulZone(player.liveZone, live.instanceId),
    }));
    game = {
      ...game,
      currentPhase: GamePhase.PERFORMANCE_PHASE,
      currentSubPhase: SubPhase.PERFORMANCE_JUDGMENT,
      currentTurnType: TurnType.FIRST_PLAYER_TURN,
      activePlayerIndex: 0,
      liveResolution: {
        ...game.liveResolution,
        isInLive: true,
        performingPlayerId: 'p1',
        liveModifiers: [{ kind: 'SCORE', playerId: 'p1', countDelta: 1 }],
      },
    };

    const acceptResult = service.processAction(game, {
      type: 'CONFIRM_JUDGMENT',
      playerId: 'p1',
      judgmentResults: new Map(),
      timestamp: Date.now(),
    });

    expect(acceptResult.success).toBe(true);
    expect(acceptResult.gameState.liveResolution.liveResults.get(live.instanceId)).toBe(true);
    expect(acceptResult.gameState.liveResolution.playerScores.get('p1')).toBe(4);
  });

  it('玩家 Live 合计分数修正不应让失败 Live 得分', () => {
    const service = new GameService();
    const live = createCardInstance(
      {
        cardCode: 'FAILED-MODIFIER-SCORE-LIVE',
        name: 'Failed Modifier Score Live',
        cardType: CardType.LIVE as const,
        score: 3,
        requirements: createHeartRequirement({ [HeartColor.PINK]: 1 }),
      },
      'p1',
      'p1-failed-modifier-score-live'
    );

    let game = createGameState('g-failed-live-modifier-score', 'p1', 'P1', 'p2', 'P2');
    game = registerCards(game, [live]);
    game = updatePlayer(game, 'p1', (player) => ({
      ...player,
      liveZone: addCardToStatefulZone(player.liveZone, live.instanceId),
    }));
    game = {
      ...game,
      currentPhase: GamePhase.PERFORMANCE_PHASE,
      currentSubPhase: SubPhase.PERFORMANCE_JUDGMENT,
      currentTurnType: TurnType.FIRST_PLAYER_TURN,
      activePlayerIndex: 0,
      liveResolution: {
        ...game.liveResolution,
        isInLive: true,
        performingPlayerId: 'p1',
        liveModifiers: [{ kind: 'SCORE', playerId: 'p1', countDelta: 3 }],
      },
    };

    const acceptResult = service.processAction(game, {
      type: 'CONFIRM_JUDGMENT',
      playerId: 'p1',
      judgmentResults: new Map(),
      timestamp: Date.now(),
    });

    expect(acceptResult.success).toBe(true);
    expect(acceptResult.gameState.liveResolution.liveResults.get(live.instanceId)).toBe(false);
    expect(acceptResult.gameState.liveResolution.playerScores.get('p1')).toBe(0);
  });

  it('进入结算阶段时失败 Live 不应套用玩家合计分数修正', () => {
    const service = new GameService();
    const live = createCardInstance(
      {
        cardCode: 'RESULT-FAILED-MODIFIER-SCORE-LIVE',
        name: 'Result Failed Modifier Score Live',
        cardType: CardType.LIVE as const,
        score: 3,
        requirements: createHeartRequirement({ [HeartColor.PINK]: 1 }),
      },
      'p1',
      'p1-result-failed-modifier-score-live'
    );

    let game = createGameState('g-result-failed-live-modifier-score', 'p1', 'P1', 'p2', 'P2');
    game = registerCards(game, [live]);
    game = updatePlayer(game, 'p1', (player) => ({
      ...player,
      liveZone: addCardToStatefulZone(player.liveZone, live.instanceId),
    }));
    game = {
      ...game,
      currentPhase: GamePhase.PERFORMANCE_PHASE,
      currentSubPhase: SubPhase.NONE,
      currentTurnType: TurnType.FIRST_PLAYER_TURN,
      activePlayerIndex: 0,
      liveResolution: {
        ...game.liveResolution,
        liveResults: new Map([[live.instanceId, false]]),
        playerScores: new Map(),
        liveModifiers: [{ kind: 'SCORE', playerId: 'p1', countDelta: 3 }],
      },
    };

    const result = service.executeLiveResultPhase(game);

    expect(result.success).toBe(true);
    expect(result.gameState.liveResolution.liveResults.get(live.instanceId)).toBe(false);
    expect(result.gameState.liveResolution.playerScores.get('p1')).toBe(0);
  });

  it('此 Live 卡分数修正应计入对应成功 Live 分数且不作为合计分数重复计算', () => {
    const service = new GameService();
    const member = createCardInstance(
      {
        cardCode: 'MODIFIER-LIVE-SCORE-MEMBER',
        name: 'Modifier Live Score Member',
        cardType: CardType.MEMBER as const,
        cost: 1,
        blade: 0,
        hearts: [{ color: HeartColor.PINK, count: 1 }],
      },
      'p1',
      'p1-modifier-live-score-member'
    );
    const live = createCardInstance(
      {
        cardCode: 'MODIFIER-LIVE-SCORE-LIVE',
        name: 'Modifier Live Score Live',
        cardType: CardType.LIVE as const,
        score: 3,
        requirements: createHeartRequirement({ [HeartColor.PINK]: 1 }),
      },
      'p1',
      'p1-modifier-live-score-live'
    );

    let game = createGameState('g-live-card-score-modifier', 'p1', 'P1', 'p2', 'P2');
    game = registerCards(game, [member, live]);
    game = updatePlayer(game, 'p1', (player) => ({
      ...player,
      memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, member.instanceId),
      liveZone: addCardToStatefulZone(player.liveZone, live.instanceId),
    }));
    game = {
      ...game,
      currentPhase: GamePhase.PERFORMANCE_PHASE,
      currentSubPhase: SubPhase.PERFORMANCE_JUDGMENT,
      currentTurnType: TurnType.FIRST_PLAYER_TURN,
      activePlayerIndex: 0,
      liveResolution: {
        ...game.liveResolution,
        isInLive: true,
        performingPlayerId: 'p1',
        liveModifiers: [
          {
            kind: 'SCORE',
            playerId: 'p1',
            liveCardId: live.instanceId,
            countDelta: 1,
          },
        ],
      },
    };

    const acceptResult = service.processAction(game, {
      type: 'CONFIRM_JUDGMENT',
      playerId: 'p1',
      judgmentResults: new Map(),
      timestamp: Date.now(),
    });

    expect(acceptResult.success).toBe(true);
    expect(acceptResult.gameState.liveResolution.liveResults.get(live.instanceId)).toBe(true);
    expect(acceptResult.gameState.liveResolution.playerScores.get('p1')).toBe(4);
  });

  it('SOURCE_MEMBER Heart modifier should provide hearts through its active source member', () => {
    const service = new GameService();
    const member = createCardInstance(
      {
        cardCode: 'MODIFIER-HEART-MEMBER',
        name: 'Modifier Heart Member',
        cardType: CardType.MEMBER as const,
        cost: 1,
        blade: 0,
        hearts: [{ color: HeartColor.PINK, count: 1 }],
      },
      'p1',
      'p1-modifier-heart-member'
    );
    const live = createCardInstance(
      {
        cardCode: 'MODIFIER-HEART-LIVE',
        name: 'Modifier Heart Live',
        cardType: CardType.LIVE as const,
        score: 4,
        requirements: createHeartRequirement({ [HeartColor.YELLOW]: 1 }),
      },
      'p1',
      'p1-modifier-heart-live'
    );

    let game = createGameState('g-live-modifier-heart', 'p1', 'P1', 'p2', 'P2');
    game = registerCards(game, [member, live]);
    game = updatePlayer(game, 'p1', (player) => ({
      ...player,
      memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, member.instanceId),
      liveZone: addCardToStatefulZone(player.liveZone, live.instanceId),
    }));
    game = {
      ...game,
      currentPhase: GamePhase.PERFORMANCE_PHASE,
      currentSubPhase: SubPhase.PERFORMANCE_JUDGMENT,
      currentTurnType: TurnType.FIRST_PLAYER_TURN,
      activePlayerIndex: 0,
      liveResolution: {
        ...game.liveResolution,
        isInLive: true,
        performingPlayerId: 'p1',
        liveModifiers: [
          {
            kind: 'HEART',
            target: 'SOURCE_MEMBER',
            playerId: 'p1',
            hearts: [{ color: HeartColor.YELLOW, count: 1 }],
            sourceCardId: member.instanceId,
          },
        ],
      },
    };

    const acceptResult = service.processAction(game, {
      type: 'CONFIRM_JUDGMENT',
      playerId: 'p1',
      judgmentResults: new Map(),
      timestamp: Date.now(),
    });

    expect(acceptResult.success).toBe(true);
    expect(acceptResult.gameState.liveResolution.liveResults.get(live.instanceId)).toBe(true);
    expect(acceptResult.gameState.liveResolution.playerScores.get('p1')).toBe(4);
  });

  it('SOURCE_MEMBER Heart modifier contributes when its source member is resting', () => {
    const service = new GameService();
    const member = createCardInstance(
      {
        cardCode: 'RESTING-MODIFIER-HEART-MEMBER',
        name: 'Resting Modifier Heart Member',
        cardType: CardType.MEMBER as const,
        cost: 1,
        blade: 0,
        hearts: [{ color: HeartColor.PINK, count: 1 }],
      },
      'p1',
      'p1-resting-modifier-heart-member'
    );
    const live = createCardInstance(
      {
        cardCode: 'RESTING-MODIFIER-HEART-LIVE',
        name: 'Resting Modifier Heart Live',
        cardType: CardType.LIVE as const,
        score: 4,
        requirements: createHeartRequirement({ [HeartColor.YELLOW]: 1 }),
      },
      'p1',
      'p1-resting-modifier-heart-live'
    );

    let game = createGameState('g-live-modifier-heart-resting-source', 'p1', 'P1', 'p2', 'P2');
    game = registerCards(game, [member, live]);
    game = updatePlayer(game, 'p1', (player) => ({
      ...player,
      memberSlots: {
        ...placeCardInSlot(player.memberSlots, SlotPosition.CENTER, member.instanceId),
        cardStates: new Map([
          [member.instanceId, { orientation: OrientationState.WAITING, face: FaceState.FACE_UP }],
        ]),
      },
      liveZone: addCardToStatefulZone(player.liveZone, live.instanceId),
    }));
    game = {
      ...game,
      currentPhase: GamePhase.PERFORMANCE_PHASE,
      currentSubPhase: SubPhase.PERFORMANCE_JUDGMENT,
      currentTurnType: TurnType.FIRST_PLAYER_TURN,
      activePlayerIndex: 0,
      liveResolution: {
        ...game.liveResolution,
        isInLive: true,
        performingPlayerId: 'p1',
        liveModifiers: [
          {
            kind: 'HEART',
            target: 'SOURCE_MEMBER',
            playerId: 'p1',
            hearts: [{ color: HeartColor.YELLOW, count: 1 }],
            sourceCardId: member.instanceId,
          },
        ],
      },
    };

    const acceptResult = service.processAction(game, {
      type: 'CONFIRM_JUDGMENT',
      playerId: 'p1',
      judgmentResults: new Map(),
      timestamp: Date.now(),
    });

    expect(acceptResult.success).toBe(true);
    expect(acceptResult.gameState.liveResolution.liveResults.get(live.instanceId)).toBe(true);
    expect(acceptResult.gameState.liveResolution.playerScores.get('p1')).toBe(4);
  });

  it('resting stage member printed Heart contributes to LIVE judgment', () => {
    const service = new GameService();
    const member = createCardInstance(
      {
        cardCode: 'RESTING-PRINTED-HEART-MEMBER',
        name: 'Resting Printed Heart Member',
        cardType: CardType.MEMBER as const,
        cost: 1,
        blade: 0,
        hearts: [{ color: HeartColor.PINK, count: 1 }],
      },
      'p1',
      'p1-resting-printed-heart-member'
    );
    const live = createCardInstance(
      {
        cardCode: 'RESTING-PRINTED-HEART-LIVE',
        name: 'Resting Printed Heart Live',
        cardType: CardType.LIVE as const,
        score: 4,
        requirements: createHeartRequirement({ [HeartColor.PINK]: 1 }),
      },
      'p1',
      'p1-resting-printed-heart-live'
    );

    let game = createGameState('g-resting-printed-heart-judgment', 'p1', 'P1', 'p2', 'P2');
    game = registerCards(game, [member, live]);
    game = updatePlayer(game, 'p1', (player) => ({
      ...player,
      memberSlots: {
        ...placeCardInSlot(player.memberSlots, SlotPosition.CENTER, member.instanceId),
        cardStates: new Map([
          [member.instanceId, { orientation: OrientationState.WAITING, face: FaceState.FACE_UP }],
        ]),
      },
      liveZone: addCardToStatefulZone(player.liveZone, live.instanceId),
    }));
    game = {
      ...game,
      currentPhase: GamePhase.PERFORMANCE_PHASE,
      currentSubPhase: SubPhase.PERFORMANCE_JUDGMENT,
      currentTurnType: TurnType.FIRST_PLAYER_TURN,
      activePlayerIndex: 0,
      liveResolution: {
        ...game.liveResolution,
        isInLive: true,
        performingPlayerId: 'p1',
      },
    };

    const acceptResult = service.processAction(game, {
      type: 'CONFIRM_JUDGMENT',
      playerId: 'p1',
      judgmentResults: new Map(),
      timestamp: Date.now(),
    });

    expect(acceptResult.success).toBe(true);
    expect(acceptResult.gameState.liveResolution.liveResults.get(live.instanceId)).toBe(true);
    expect(acceptResult.gameState.liveResolution.playerScores.get('p1')).toBe(4);
  });

  it('TARGET_MEMBER Heart modifier helps LIVE judgment while the target member is active', () => {
    const service = new GameService();
    const target = createCardInstance(
      {
        cardCode: 'TARGET-HEART-MEMBER',
        name: 'Target Heart Member',
        cardType: CardType.MEMBER as const,
        cost: 1,
        blade: 0,
        hearts: [{ color: HeartColor.PINK, count: 1 }],
      },
      'p1',
      'p1-target-heart-member'
    );
    const live = createCardInstance(
      {
        cardCode: 'TARGET-HEART-LIVE',
        name: 'Target Heart Live',
        cardType: CardType.LIVE as const,
        score: 4,
        requirements: createHeartRequirement({ [HeartColor.PINK]: 2 }),
      },
      'p1',
      'p1-target-heart-live'
    );

    let game = createGameState('g-live-target-member-heart', 'p1', 'P1', 'p2', 'P2');
    game = registerCards(game, [target, live]);
    game = updatePlayer(game, 'p1', (player) => ({
      ...player,
      memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, target.instanceId),
      liveZone: addCardToStatefulZone(player.liveZone, live.instanceId),
    }));
    game = {
      ...game,
      currentPhase: GamePhase.PERFORMANCE_PHASE,
      currentSubPhase: SubPhase.PERFORMANCE_JUDGMENT,
      currentTurnType: TurnType.FIRST_PLAYER_TURN,
      activePlayerIndex: 0,
      liveResolution: {
        ...game.liveResolution,
        isInLive: true,
        performingPlayerId: 'p1',
        liveModifiers: [
          {
            kind: 'HEART',
            target: 'TARGET_MEMBER',
            playerId: 'p1',
            targetMemberCardId: target.instanceId,
            hearts: [{ color: HeartColor.PINK, count: 1 }],
            sourceCardId: 'rurino',
          },
        ],
      },
    };

    const acceptResult = service.processAction(game, {
      type: 'CONFIRM_JUDGMENT',
      playerId: 'p1',
      judgmentResults: new Map(),
      timestamp: Date.now(),
    });

    expect(acceptResult.success).toBe(true);
    expect(acceptResult.gameState.liveResolution.liveResults.get(live.instanceId)).toBe(true);
    expect(acceptResult.gameState.liveResolution.playerScores.get('p1')).toBe(4);
  });

  it('TARGET_MEMBER Heart modifier helps LIVE judgment while the target member is resting', () => {
    const service = new GameService();
    const target = createCardInstance(
      {
        cardCode: 'RESTING-TARGET-HEART-MEMBER',
        name: 'Resting Target Heart Member',
        cardType: CardType.MEMBER as const,
        cost: 1,
        blade: 0,
        hearts: [{ color: HeartColor.PINK, count: 1 }],
      },
      'p1',
      'p1-resting-target-heart-member'
    );
    const live = createCardInstance(
      {
        cardCode: 'RESTING-TARGET-HEART-LIVE',
        name: 'Resting Target Heart Live',
        cardType: CardType.LIVE as const,
        score: 4,
        requirements: createHeartRequirement({ [HeartColor.PINK]: 2 }),
      },
      'p1',
      'p1-resting-target-heart-live'
    );

    let game = createGameState('g-live-target-member-heart-resting', 'p1', 'P1', 'p2', 'P2');
    game = registerCards(game, [target, live]);
    game = updatePlayer(game, 'p1', (player) => ({
      ...player,
      memberSlots: {
        ...placeCardInSlot(player.memberSlots, SlotPosition.CENTER, target.instanceId),
        cardStates: new Map([
          [target.instanceId, { orientation: OrientationState.WAITING, face: FaceState.FACE_UP }],
        ]),
      },
      liveZone: addCardToStatefulZone(player.liveZone, live.instanceId),
    }));
    game = {
      ...game,
      currentPhase: GamePhase.PERFORMANCE_PHASE,
      currentSubPhase: SubPhase.PERFORMANCE_JUDGMENT,
      currentTurnType: TurnType.FIRST_PLAYER_TURN,
      activePlayerIndex: 0,
      liveResolution: {
        ...game.liveResolution,
        isInLive: true,
        performingPlayerId: 'p1',
        liveModifiers: [
          {
            kind: 'HEART',
            target: 'TARGET_MEMBER',
            playerId: 'p1',
            targetMemberCardId: target.instanceId,
            hearts: [{ color: HeartColor.PINK, count: 1 }],
            sourceCardId: 'rurino',
          },
        ],
      },
    };

    const acceptResult = service.processAction(game, {
      type: 'CONFIRM_JUDGMENT',
      playerId: 'p1',
      judgmentResults: new Map(),
      timestamp: Date.now(),
    });

    expect(acceptResult.success).toBe(true);
    expect(acceptResult.gameState.liveResolution.liveResults.get(live.instanceId)).toBe(true);
    expect(acceptResult.gameState.liveResolution.playerScores.get('p1')).toBe(4);
  });

  it('PL!-bp5-008 continuous SOURCE_MEMBER yellow Heart helps LIVE judgment while source member is active', () => {
    const service = new GameService();
    const hanayo = createCardInstance(
      {
        cardCode: 'PL!-bp5-008-AR',
        name: '小泉花阳',
        cardType: CardType.MEMBER as const,
        cost: 13,
        blade: 0,
        hearts: [{ color: HeartColor.PINK, count: 1 }],
      },
      'p1',
      'p1-hanayo-bp5-008'
    );
    const previousSuccessLive = createCardInstance(
      {
        cardCode: 'PREVIOUS-SUCCESS-LIVE',
        name: 'Previous Success Live',
        cardType: CardType.LIVE as const,
        score: 6,
        requirements: createHeartRequirement({ [HeartColor.PINK]: 1 }),
      },
      'p1',
      'p1-previous-success-live'
    );
    const currentLive = createCardInstance(
      {
        cardCode: 'CURRENT-YELLOW-LIVE',
        name: 'Current Yellow Live',
        cardType: CardType.LIVE as const,
        score: 4,
        requirements: createHeartRequirement({ [HeartColor.YELLOW]: 2 }),
      },
      'p1',
      'p1-current-yellow-live'
    );

    let game = createGameState('g-bp5-008-active-source-heart', 'p1', 'P1', 'p2', 'P2');
    game = registerCards(game, [hanayo, previousSuccessLive, currentLive]);
    game = updatePlayer(game, 'p1', (player) => ({
      ...player,
      memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, hanayo.instanceId),
      successZone: addCardToZone(player.successZone, previousSuccessLive.instanceId),
      liveZone: addCardToStatefulZone(player.liveZone, currentLive.instanceId),
    }));
    game = {
      ...game,
      currentPhase: GamePhase.PERFORMANCE_PHASE,
      currentSubPhase: SubPhase.PERFORMANCE_JUDGMENT,
      currentTurnType: TurnType.FIRST_PLAYER_TURN,
      activePlayerIndex: 0,
      liveResolution: {
        ...game.liveResolution,
        isInLive: true,
        performingPlayerId: 'p1',
      },
    };

    const acceptResult = service.processAction(game, {
      type: 'CONFIRM_JUDGMENT',
      playerId: 'p1',
      judgmentResults: new Map(),
      timestamp: Date.now(),
    });

    expect(acceptResult.success).toBe(true);
    expect(acceptResult.gameState.liveResolution.liveResults.get(currentLive.instanceId)).toBe(
      true
    );
    expect(acceptResult.gameState.liveResolution.playerScores.get('p1')).toBe(4);
  });

  it('PL!-bp5-008 continuous SOURCE_MEMBER yellow Heart helps LIVE judgment while source member is resting', () => {
    const service = new GameService();
    const hanayo = createCardInstance(
      {
        cardCode: 'PL!-bp5-008-AR',
        name: '小泉花阳',
        cardType: CardType.MEMBER as const,
        cost: 13,
        blade: 0,
        hearts: [{ color: HeartColor.PINK, count: 1 }],
      },
      'p1',
      'p1-resting-hanayo-bp5-008'
    );
    const previousSuccessLive = createCardInstance(
      {
        cardCode: 'PREVIOUS-SUCCESS-LIVE',
        name: 'Previous Success Live',
        cardType: CardType.LIVE as const,
        score: 6,
        requirements: createHeartRequirement({ [HeartColor.PINK]: 1 }),
      },
      'p1',
      'p1-resting-previous-success-live'
    );
    const currentLive = createCardInstance(
      {
        cardCode: 'CURRENT-YELLOW-LIVE',
        name: 'Current Yellow Live',
        cardType: CardType.LIVE as const,
        score: 4,
        requirements: createHeartRequirement({ [HeartColor.YELLOW]: 2 }),
      },
      'p1',
      'p1-resting-current-yellow-live'
    );

    let game = createGameState('g-bp5-008-resting-source-heart', 'p1', 'P1', 'p2', 'P2');
    game = registerCards(game, [hanayo, previousSuccessLive, currentLive]);
    game = updatePlayer(game, 'p1', (player) => ({
      ...player,
      memberSlots: {
        ...placeCardInSlot(player.memberSlots, SlotPosition.CENTER, hanayo.instanceId),
        cardStates: new Map([
          [hanayo.instanceId, { orientation: OrientationState.WAITING, face: FaceState.FACE_UP }],
        ]),
      },
      successZone: addCardToZone(player.successZone, previousSuccessLive.instanceId),
      liveZone: addCardToStatefulZone(player.liveZone, currentLive.instanceId),
    }));
    game = {
      ...game,
      currentPhase: GamePhase.PERFORMANCE_PHASE,
      currentSubPhase: SubPhase.PERFORMANCE_JUDGMENT,
      currentTurnType: TurnType.FIRST_PLAYER_TURN,
      activePlayerIndex: 0,
      liveResolution: {
        ...game.liveResolution,
        isInLive: true,
        performingPlayerId: 'p1',
      },
    };

    const acceptResult = service.processAction(game, {
      type: 'CONFIRM_JUDGMENT',
      playerId: 'p1',
      judgmentResults: new Map(),
      timestamp: Date.now(),
    });

    expect(acceptResult.success).toBe(true);
    expect(acceptResult.gameState.liveResolution.liveResults.get(currentLive.instanceId)).toBe(
      true
    );
    expect(acceptResult.gameState.liveResolution.playerScores.get('p1')).toBe(4);
  });

  it('PL!-bp5-003 continuous SOURCE_MEMBER yellow Heart helps LIVE judgment while source member is active', () => {
    const service = new GameService();
    const kotori = createCardInstance(
      {
        cardCode: 'PL!-bp5-003-AR',
        name: '南ことり',
        cardType: CardType.MEMBER as const,
        cost: 11,
        blade: 3,
        hearts: [{ color: HeartColor.PINK, count: 1 }],
      },
      'p1',
      'p1-kotori-bp5-003'
    );
    const umi = createCardInstance(
      {
        cardCode: 'PL!-TEST-UMI',
        name: '園田海未',
        cardType: CardType.MEMBER as const,
        cost: 2,
        blade: 1,
        hearts: [],
      },
      'p1',
      'p1-umi-bp5-003'
    );
    const rin = createCardInstance(
      {
        cardCode: 'PL!-TEST-RIN',
        name: '星空凛',
        cardType: CardType.MEMBER as const,
        cost: 2,
        blade: 1,
        hearts: [],
      },
      'p1',
      'p1-rin-bp5-003'
    );
    const currentLive = createCardInstance(
      {
        cardCode: 'PL!-YELLOW-LIVE',
        name: 'Yellow Live',
        cardType: CardType.LIVE as const,
        score: 4,
        requirements: createHeartRequirement({ [HeartColor.YELLOW]: 1 }),
      },
      'p1',
      'p1-bp5-003-yellow-live'
    );

    let game = createGameState('g-bp5-003-active-source-heart', 'p1', 'P1', 'p2', 'P2');
    game = registerCards(game, [kotori, umi, rin, currentLive]);
    game = updatePlayer(game, 'p1', (player) => ({
      ...player,
      memberSlots: placeCardInSlot(
        placeCardInSlot(
          placeCardInSlot(player.memberSlots, SlotPosition.CENTER, kotori.instanceId),
          SlotPosition.LEFT,
          umi.instanceId
        ),
        SlotPosition.RIGHT,
        rin.instanceId
      ),
      liveZone: addCardToStatefulZone(player.liveZone, currentLive.instanceId),
    }));
    game = {
      ...game,
      currentPhase: GamePhase.PERFORMANCE_PHASE,
      currentSubPhase: SubPhase.PERFORMANCE_JUDGMENT,
      currentTurnType: TurnType.FIRST_PLAYER_TURN,
      activePlayerIndex: 0,
      liveResolution: {
        ...game.liveResolution,
        isInLive: true,
        performingPlayerId: 'p1',
      },
    };

    const acceptResult = service.processAction(game, {
      type: 'CONFIRM_JUDGMENT',
      playerId: 'p1',
      judgmentResults: new Map(),
      timestamp: Date.now(),
    });

    expect(acceptResult.success).toBe(true);
    expect(acceptResult.gameState.liveResolution.liveResults.get(currentLive.instanceId)).toBe(
      true
    );
    expect(acceptResult.gameState.liveResolution.playerScores.get('p1')).toBe(4);
  });

  it('PL!-bp5-003 continuous SOURCE_MEMBER yellow Heart helps LIVE judgment while source member is resting', () => {
    const service = new GameService();
    const kotori = createCardInstance(
      {
        cardCode: 'PL!-bp5-003-SEC',
        name: '南ことり',
        cardType: CardType.MEMBER as const,
        cost: 11,
        blade: 3,
        hearts: [{ color: HeartColor.PINK, count: 1 }],
      },
      'p1',
      'p1-resting-kotori-bp5-003'
    );
    const umi = createCardInstance(
      {
        cardCode: 'PL!-TEST-UMI',
        name: '園田海未',
        cardType: CardType.MEMBER as const,
        cost: 2,
        blade: 1,
        hearts: [],
      },
      'p1',
      'p1-resting-umi-bp5-003'
    );
    const rin = createCardInstance(
      {
        cardCode: 'PL!-TEST-RIN',
        name: '星空凛',
        cardType: CardType.MEMBER as const,
        cost: 2,
        blade: 1,
        hearts: [],
      },
      'p1',
      'p1-resting-rin-bp5-003'
    );
    const currentLive = createCardInstance(
      {
        cardCode: 'PL!-YELLOW-LIVE',
        name: 'Yellow Live',
        cardType: CardType.LIVE as const,
        score: 4,
        requirements: createHeartRequirement({ [HeartColor.YELLOW]: 1 }),
      },
      'p1',
      'p1-resting-bp5-003-yellow-live'
    );

    let game = createGameState('g-bp5-003-resting-source-heart', 'p1', 'P1', 'p2', 'P2');
    game = registerCards(game, [kotori, umi, rin, currentLive]);
    game = updatePlayer(game, 'p1', (player) => ({
      ...player,
      memberSlots: {
        ...placeCardInSlot(
          placeCardInSlot(
            placeCardInSlot(player.memberSlots, SlotPosition.CENTER, kotori.instanceId),
            SlotPosition.LEFT,
            umi.instanceId
          ),
          SlotPosition.RIGHT,
          rin.instanceId
        ),
        cardStates: new Map([
          [kotori.instanceId, { orientation: OrientationState.WAITING, face: FaceState.FACE_UP }],
          [umi.instanceId, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
          [rin.instanceId, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
        ]),
      },
      liveZone: addCardToStatefulZone(player.liveZone, currentLive.instanceId),
    }));
    game = {
      ...game,
      currentPhase: GamePhase.PERFORMANCE_PHASE,
      currentSubPhase: SubPhase.PERFORMANCE_JUDGMENT,
      currentTurnType: TurnType.FIRST_PLAYER_TURN,
      activePlayerIndex: 0,
      liveResolution: {
        ...game.liveResolution,
        isInLive: true,
        performingPlayerId: 'p1',
      },
    };

    const acceptResult = service.processAction(game, {
      type: 'CONFIRM_JUDGMENT',
      playerId: 'p1',
      judgmentResults: new Map(),
      timestamp: Date.now(),
    });

    expect(acceptResult.success).toBe(true);
    expect(acceptResult.gameState.liveResolution.liveResults.get(currentLive.instanceId)).toBe(
      true
    );
    expect(acceptResult.gameState.liveResolution.playerScores.get('p1')).toBe(4);
  });

  it('PL!-bp4-002 continuous SOURCE_MEMBER purple Heart helps LIVE judgment while source member is active', () => {
    const service = new GameService();
    const eli = createCardInstance(
      {
        cardCode: 'PL!-bp4-002-P',
        name: '绚濑绘里',
        cardType: CardType.MEMBER as const,
        cost: 15,
        blade: 4,
        hearts: [{ color: HeartColor.PINK, count: 1 }],
      },
      'p1',
      'p1-eli-bp4-002'
    );
    const currentLive = createCardInstance(
      {
        cardCode: 'PL!-NO-TIMING-PURPLE-LIVE',
        name: 'No Timing Purple Live',
        cardType: CardType.LIVE as const,
        score: 4,
        requirements: createHeartRequirement({ [HeartColor.PURPLE]: 2 }),
        cardText: '【常时】此卡的分数+1。',
      },
      'p1',
      'p1-no-timing-purple-live'
    );

    let game = createGameState('g-bp4-002-active-source-heart', 'p1', 'P1', 'p2', 'P2');
    game = registerCards(game, [eli, currentLive]);
    game = updatePlayer(game, 'p1', (player) => ({
      ...player,
      memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, eli.instanceId),
      liveZone: addCardToStatefulZone(player.liveZone, currentLive.instanceId),
    }));
    game = {
      ...game,
      currentPhase: GamePhase.PERFORMANCE_PHASE,
      currentSubPhase: SubPhase.PERFORMANCE_JUDGMENT,
      currentTurnType: TurnType.FIRST_PLAYER_TURN,
      activePlayerIndex: 0,
      liveResolution: {
        ...game.liveResolution,
        isInLive: true,
        performingPlayerId: 'p1',
      },
    };

    const acceptResult = service.processAction(game, {
      type: 'CONFIRM_JUDGMENT',
      playerId: 'p1',
      judgmentResults: new Map(),
      timestamp: Date.now(),
    });

    expect(acceptResult.success).toBe(true);
    expect(acceptResult.gameState.liveResolution.liveResults.get(currentLive.instanceId)).toBe(
      true
    );
    expect(acceptResult.gameState.liveResolution.playerScores.get('p1')).toBe(4);
  });

  it('PL!-bp4-002 continuous SOURCE_MEMBER purple Heart helps LIVE judgment while source member is resting', () => {
    const service = new GameService();
    const eli = createCardInstance(
      {
        cardCode: 'PL!-bp4-002-P',
        name: '绚濑绘里',
        cardType: CardType.MEMBER as const,
        cost: 15,
        blade: 4,
        hearts: [{ color: HeartColor.PINK, count: 1 }],
      },
      'p1',
      'p1-resting-eli-bp4-002'
    );
    const currentLive = createCardInstance(
      {
        cardCode: 'PL!-NO-TIMING-PURPLE-LIVE',
        name: 'No Timing Purple Live',
        cardType: CardType.LIVE as const,
        score: 4,
        requirements: createHeartRequirement({ [HeartColor.PURPLE]: 2 }),
      },
      'p1',
      'p1-resting-no-timing-purple-live'
    );

    let game = createGameState('g-bp4-002-resting-source-heart', 'p1', 'P1', 'p2', 'P2');
    game = registerCards(game, [eli, currentLive]);
    game = updatePlayer(game, 'p1', (player) => ({
      ...player,
      memberSlots: {
        ...placeCardInSlot(player.memberSlots, SlotPosition.CENTER, eli.instanceId),
        cardStates: new Map([
          [eli.instanceId, { orientation: OrientationState.WAITING, face: FaceState.FACE_UP }],
        ]),
      },
      liveZone: addCardToStatefulZone(player.liveZone, currentLive.instanceId),
    }));
    game = {
      ...game,
      currentPhase: GamePhase.PERFORMANCE_PHASE,
      currentSubPhase: SubPhase.PERFORMANCE_JUDGMENT,
      currentTurnType: TurnType.FIRST_PLAYER_TURN,
      activePlayerIndex: 0,
      liveResolution: {
        ...game.liveResolution,
        isInLive: true,
        performingPlayerId: 'p1',
      },
    };

    const acceptResult = service.processAction(game, {
      type: 'CONFIRM_JUDGMENT',
      playerId: 'p1',
      judgmentResults: new Map(),
      timestamp: Date.now(),
    });

    expect(acceptResult.success).toBe(true);
    expect(acceptResult.gameState.liveResolution.liveResults.get(currentLive.instanceId)).toBe(
      true
    );
    expect(acceptResult.gameState.liveResolution.playerScores.get('p1')).toBe(4);
  });

  it("PL!-bp6-022 success-zone continuous modifier reduces μ's LIVE generic requirement during judgment", () => {
    const service = new GameService();
    const member = createCardInstance(
      {
        cardCode: 'PL!-TEST-MEMBER',
        name: 'μ’s Member',
        cardType: CardType.MEMBER as const,
        cost: 1,
        blade: 0,
        hearts: [{ color: HeartColor.PINK, count: 1 }],
      },
      'p1',
      'p1-muse-member'
    );
    const dreamin = createCardInstance(
      {
        cardCode: 'PL!-bp6-022-L',
        name: "Dreamin' Go! Go!!",
        cardType: CardType.LIVE as const,
        score: 9,
        requirements: createHeartRequirement({ [HeartColor.RAINBOW]: 5 }),
        groupName: "μ's",
      },
      'p1',
      'p1-dreamin-success'
    );
    const currentLive = createCardInstance(
      {
        cardCode: 'PL!-CURRENT-GENERIC-LIVE',
        name: 'Current Generic Live',
        cardType: CardType.LIVE as const,
        score: 5,
        requirements: createHeartRequirement({ [HeartColor.RAINBOW]: 3 }),
        groupName: "μ's",
      },
      'p1',
      'p1-current-generic-live'
    );

    let game = createGameState('g-bp6-022-success-zone-requirement', 'p1', 'P1', 'p2', 'P2');
    game = registerCards(game, [member, dreamin, currentLive]);
    game = updatePlayer(game, 'p1', (player) => ({
      ...player,
      memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, member.instanceId),
      successZone: addCardToZone(player.successZone, dreamin.instanceId),
      liveZone: addCardToStatefulZone(player.liveZone, currentLive.instanceId),
    }));
    game = {
      ...game,
      currentPhase: GamePhase.PERFORMANCE_PHASE,
      currentSubPhase: SubPhase.PERFORMANCE_JUDGMENT,
      currentTurnType: TurnType.FIRST_PLAYER_TURN,
      activePlayerIndex: 0,
      liveResolution: {
        ...game.liveResolution,
        isInLive: true,
        performingPlayerId: 'p1',
      },
    };

    const acceptResult = service.processAction(game, {
      type: 'CONFIRM_JUDGMENT',
      playerId: 'p1',
      judgmentResults: new Map(),
      timestamp: Date.now(),
    });

    expect(acceptResult.success).toBe(true);
    expect(acceptResult.gameState.liveResolution.liveResults.get(currentLive.instanceId)).toBe(
      true
    );
    expect(acceptResult.gameState.liveResolution.playerScores.get('p1')).toBe(5);
  });

  it('统一 Live modifier 应能独立提供 Blade 修正', () => {
    const service = new GameService();
    const member = createCardInstance(
      {
        cardCode: 'MODIFIER-BLADE-MEMBER',
        name: 'Modifier Blade Member',
        cardType: CardType.MEMBER as const,
        cost: 1,
        blade: 0,
        hearts: [],
      },
      'p1',
      'p1-modifier-blade-member'
    );
    const live = createCardInstance(
      {
        cardCode: 'MODIFIER-BLADE-LIVE',
        name: 'Modifier Blade Live',
        cardType: CardType.LIVE as const,
        score: 5,
        requirements: createHeartRequirement({ [HeartColor.BLUE]: 1 }),
      },
      'p1',
      'p1-modifier-blade-live'
    );
    const cheer = createCardInstance(
      {
        cardCode: 'MODIFIER-BLADE-CHEER',
        name: 'Modifier Blade Cheer',
        cardType: CardType.MEMBER as const,
        cost: 1,
        blade: 0,
        hearts: [],
        bladeHearts: [{ effect: BladeHeartEffect.HEART, heartColor: HeartColor.BLUE }],
      },
      'p1',
      'p1-modifier-blade-cheer'
    );

    let game = createGameState('g-live-modifier-blade', 'p1', 'P1', 'p2', 'P2');
    game = registerCards(game, [member, live, cheer]);
    game = updatePlayer(game, 'p1', (player) => ({
      ...player,
      memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, member.instanceId),
      liveZone: addCardToStatefulZone(player.liveZone, live.instanceId),
      mainDeck: addCardToZone(player.mainDeck, cheer.instanceId),
    }));
    game = {
      ...game,
      currentPhase: GamePhase.PERFORMANCE_PHASE,
      currentSubPhase: SubPhase.PERFORMANCE_JUDGMENT,
      currentTurnType: TurnType.FIRST_PLAYER_TURN,
      activePlayerIndex: 0,
      liveResolution: {
        ...game.liveResolution,
        isInLive: true,
        performingPlayerId: 'p1',
        liveModifiers: [{ kind: 'BLADE', playerId: 'p1', countDelta: 1 }],
      },
    };

    const acceptResult = service.processAction(game, {
      type: 'CONFIRM_JUDGMENT',
      playerId: 'p1',
      judgmentResults: new Map(),
      timestamp: Date.now(),
    });

    expect(acceptResult.success).toBe(true);
    expect(acceptResult.gameState.liveResolution.firstPlayerCheerCardIds).toEqual([
      cheer.instanceId,
    ]);
    expect(acceptResult.gameState.liveResolution.liveResults.get(live.instanceId)).toBe(true);
    expect(acceptResult.gameState.liveResolution.playerScores.get('p1')).toBe(5);
  });

  it('成员来源 Blade modifier 只在来源成员活跃时提供翻应援数', () => {
    const service = new GameService();
    const createScenario = (orientation: OrientationState, suffix: string) => {
      const member = createCardInstance(
        {
          cardCode: `SOURCE-MEMBER-BLADE-${suffix}`,
          name: `Source Member Blade ${suffix}`,
          cardType: CardType.MEMBER as const,
          cost: 1,
          blade: 0,
          hearts: [],
        },
        'p1',
        `p1-source-member-blade-${suffix}`
      );
      const live = createCardInstance(
        {
          cardCode: `SOURCE-MEMBER-BLADE-LIVE-${suffix}`,
          name: `Source Member Blade Live ${suffix}`,
          cardType: CardType.LIVE as const,
          score: 5,
          requirements: createHeartRequirement({ [HeartColor.BLUE]: 1 }),
        },
        'p1',
        `p1-source-member-blade-live-${suffix}`
      );
      const cheer = createCardInstance(
        {
          cardCode: `SOURCE-MEMBER-BLADE-CHEER-${suffix}`,
          name: `Source Member Blade Cheer ${suffix}`,
          cardType: CardType.MEMBER as const,
          cost: 1,
          blade: 0,
          hearts: [],
          bladeHearts: [{ effect: BladeHeartEffect.HEART, heartColor: HeartColor.BLUE }],
        },
        'p1',
        `p1-source-member-blade-cheer-${suffix}`
      );

      let game = createGameState(`g-source-member-blade-${suffix}`, 'p1', 'P1', 'p2', 'P2');
      game = registerCards(game, [member, live, cheer]);
      game = updatePlayer(game, 'p1', (player) => ({
        ...player,
        memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, member.instanceId, {
          orientation,
          face: FaceState.FACE_UP,
        }),
        liveZone: addCardToStatefulZone(player.liveZone, live.instanceId),
        mainDeck: addCardToZone(player.mainDeck, cheer.instanceId),
      }));
      game = {
        ...game,
        currentPhase: GamePhase.PERFORMANCE_PHASE,
        currentSubPhase: SubPhase.PERFORMANCE_JUDGMENT,
        currentTurnType: TurnType.FIRST_PLAYER_TURN,
        activePlayerIndex: 0,
        liveResolution: {
          ...game.liveResolution,
          isInLive: true,
          performingPlayerId: 'p1',
          liveModifiers: [
            {
              kind: 'BLADE',
              playerId: 'p1',
              countDelta: 1,
              sourceCardId: member.instanceId,
            },
          ],
        },
      };

      return { game, live, cheer };
    };

    const activeScenario = createScenario(OrientationState.ACTIVE, 'active');
    const activeResult = service.processAction(activeScenario.game, {
      type: 'CONFIRM_JUDGMENT',
      playerId: 'p1',
      judgmentResults: new Map(),
      timestamp: Date.now(),
    });

    expect(activeResult.success).toBe(true);
    expect(activeResult.gameState.liveResolution.firstPlayerCheerCardIds).toEqual([
      activeScenario.cheer.instanceId,
    ]);
    expect(activeResult.gameState.liveResolution.liveResults.get(activeScenario.live.instanceId)).toBe(
      true
    );
    expect(activeResult.gameState.liveResolution.playerScores.get('p1')).toBe(5);

    const waitingScenario = createScenario(OrientationState.WAITING, 'waiting');
    const waitingResult = service.processAction(waitingScenario.game, {
      type: 'CONFIRM_JUDGMENT',
      playerId: 'p1',
      judgmentResults: new Map(),
      timestamp: Date.now(),
    });

    expect(waitingResult.success).toBe(true);
    expect(waitingResult.gameState.liveResolution.firstPlayerCheerCardIds).toEqual([]);
    expect(waitingResult.gameState.liveResolution.liveResults.get(waitingScenario.live.instanceId)).toBe(
      false
    );
    expect(waitingResult.gameState.liveResolution.playerScores.get('p1')).toBe(0);
  });

  it('统一 Live modifier 应能独立提供必要 Heart 修正', () => {
    const service = new GameService();
    const member = createCardInstance(
      {
        cardCode: 'MODIFIER-REQUIREMENT-MEMBER',
        name: 'Modifier Requirement Member',
        cardType: CardType.MEMBER as const,
        cost: 1,
        blade: 0,
        hearts: [{ color: HeartColor.PINK, count: 2 }],
      },
      'p1',
      'p1-modifier-requirement-member'
    );
    const live = createCardInstance(
      {
        cardCode: 'MODIFIER-REQUIREMENT-LIVE',
        name: 'Modifier Requirement Live',
        cardType: CardType.LIVE as const,
        score: 4,
        requirements: createHeartRequirement({ [HeartColor.PINK]: 3 }),
      },
      'p1',
      'p1-modifier-requirement-live'
    );

    let game = createGameState('g-live-modifier-requirement', 'p1', 'P1', 'p2', 'P2');
    game = registerCards(game, [member, live]);
    game = updatePlayer(game, 'p1', (player) => ({
      ...player,
      memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, member.instanceId),
      liveZone: addCardToStatefulZone(player.liveZone, live.instanceId),
    }));
    game = {
      ...game,
      currentPhase: GamePhase.PERFORMANCE_PHASE,
      currentSubPhase: SubPhase.PERFORMANCE_JUDGMENT,
      currentTurnType: TurnType.FIRST_PLAYER_TURN,
      activePlayerIndex: 0,
      liveResolution: {
        ...game.liveResolution,
        isInLive: true,
        performingPlayerId: 'p1',
        liveModifiers: [
          {
            kind: 'REQUIREMENT',
            liveCardId: live.instanceId,
            modifiers: [{ color: HeartColor.PINK, countDelta: -1 }],
          },
        ],
      },
    };

    const acceptResult = service.processAction(game, {
      type: 'CONFIRM_JUDGMENT',
      playerId: 'p1',
      judgmentResults: new Map(),
      timestamp: Date.now(),
    });

    expect(acceptResult.success).toBe(true);
    expect(acceptResult.gameState.liveResolution.liveResults.get(live.instanceId)).toBe(true);
    expect(acceptResult.gameState.liveResolution.playerScores.get('p1')).toBe(4);
  });

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

  it('0 分成功 Live 应战胜没有成功 Live 的玩家', () => {
    const service = new GameService();

    const p1Live = createCardInstance(
      {
        cardCode: 'ZERO-P1',
        name: '0 分成功 Live',
        cardType: CardType.LIVE as const,
        score: 0,
        requirements: createHeartRequirement({ [HeartColor.PINK]: 1 }),
      },
      'p1',
      'zero-p1-live'
    );
    const p2Live = createCardInstance(
      {
        cardCode: 'ZERO-P2',
        name: '未成功 Live',
        cardType: CardType.LIVE as const,
        score: 0,
        requirements: createHeartRequirement({ [HeartColor.BLUE]: 1 }),
      },
      'p2',
      'zero-p2-live'
    );

    let game = createGameState('g-zero-live-vs-no-live', 'p1', 'P1', 'p2', 'P2');
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
          ['p1', 0],
          ['p2', 0],
        ]),
        scoreConfirmedBy: ['p1', 'p2'],
        liveWinnerIds: [],
      },
    };

    const result = service.resolveLiveWinner(game);
    expect(result.success).toBe(true);
    expect(result.gameState.liveResolution.liveWinnerIds).toEqual(['p1']);
  });

  it('双方都有 0 分成功 Live 时，双方都获胜', () => {
    const service = new GameService();

    const mkLive = (code: string, owner: string, id: string) =>
      createCardInstance(
        {
          cardCode: code,
          name: code,
          cardType: CardType.LIVE as const,
          score: 0,
          requirements: createHeartRequirement({ [HeartColor.PINK]: 1 }),
        },
        owner,
        id
      );

    const p1Live = mkLive('ZERO-BOTH-P1', 'p1', 'zero-both-p1-live');
    const p2Live = mkLive('ZERO-BOTH-P2', 'p2', 'zero-both-p2-live');

    let game = createGameState('g-zero-live-both', 'p1', 'P1', 'p2', 'P2');
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
          ['p1', 0],
          ['p2', 0],
        ]),
        scoreConfirmedBy: ['p1', 'p2'],
        liveWinnerIds: [],
      },
    };

    const result = service.resolveLiveWinner(game);
    expect(result.success).toBe(true);
    expect(result.gameState.liveResolution.liveWinnerIds).toEqual(['p1', 'p2']);
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
