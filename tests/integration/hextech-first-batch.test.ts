import { describe, expect, it } from 'vitest';
import { createGameSession, type GameSession } from '../../src/application/game-session';
import { GameService, type DeckConfig } from '../../src/application/game-service';
import { acquireHextech } from '../../src/application/hextech/acquire';
import {
  createMulliganCommand,
  createConfirmStepCommand,
  createEndPhaseCommand,
  createSurrenderCommand,
  createSetLiveCardCommand,
  createSubmitJudgmentCommand,
  createSubmitScoreCommand,
  createSelectSuccessLiveCommand,
  createConfirmPerformanceOutcomeCommand,
  GameCommandType,
  type GameCommand,
} from '../../src/application/game-commands';
import {
  createGameState,
  registerCards,
  updatePlayer,
  type GameState,
} from '../../src/domain/entities/game';
import {
  createCardInstance,
  createHeartRequirement,
  type MemberCardData,
  type LiveCardData,
} from '../../src/domain/entities/card';
import { addCardToStatefulZone, placeCardInSlot } from '../../src/domain/entities/zone';
import {
  collectLiveModifiers,
  getPlayerLiveHeartModifiers,
  getPlayerLiveBladeModifier,
  getPlayerLiveScoreModifier,
  getMemberEffectiveBladeCount,
  getMemberEffectiveHeartIcons,
} from '../../src/domain/rules/live-modifiers';
import { HEXTECH_RULES_VERSION, type HextechId } from '../../src/domain/hextech/catalog';
import type { InitialHextechSetup } from '../../src/domain/hextech/state';
import {
  CardType,
  GamePhase,
  HeartColor,
  OrientationState,
  SlotPosition,
  SubPhase,
} from '../../src/shared/types/enums';
import { projectPlayerViewState } from '../../src/online/projector';
import {
  serializeReplayPayload,
  rehydrateAuthorityGameState,
} from '../../src/server/services/replay-payload-serialization';
import { GAME_STATE_SCHEMA_VERSION } from '../../src/server/services/replay-constants';

const member: MemberCardData = {
  cardCode: 'TEST-M',
  name: '测试成员',
  cardType: CardType.MEMBER,
  cost: 1,
  blade: 1,
  hearts: [{ color: HeartColor.GRAY, count: 1 }],
};
const live: LiveCardData = {
  cardCode: 'TEST-L',
  name: '测试歌曲',
  cardType: CardType.LIVE,
  score: 3,
  requirements: createHeartRequirement({ [HeartColor.PINK]: 1, [HeartColor.RED]: 1 }),
};
const deck: DeckConfig = {
  mainDeck: Array.from({ length: 60 }, () => member),
  energyDeck: Array.from({ length: 12 }, () => ({
    cardCode: 'TEST-E',
    name: '能量',
    cardType: CardType.ENERGY,
  })),
};
const FIRST_BATCH_IDS = [
  'strawberry-cherry-ice-cream',
  'mango-blueberry-ice-cream',
  'green-grape-purple-grape-ice-cream',
  'ice-cream-mystery-box',
  'original-ice-cream',
  'pot-of-greed',
  'pot-of-greater-greed',
  'pot-of-greatest-greed',
] as const;

function sessionWith(setup?: InitialHextechSetup): GameSession {
  const session = createGameSession({ randomInt: (max) => max - 1 });
  session.createGame('hextech-test', 'p1', 'P1', 'p2', 'P2', setup);
  expect(session.initializeGame(deck, deck).success).toBe(true);
  return session;
}

function finishMulligan(session: GameSession) {
  expect(session.executeCommand(createMulliganCommand('p1', [])).success).toBe(true);
  expect(session.executeCommand(createMulliganCommand('p2', [])).success).toBe(true);
}

function roundTrip(game: GameState): GameState {
  return rehydrateAuthorityGameState(
    serializeReplayPayload(game, 'AUTHORITY_GAME_STATE', GAME_STATE_SCHEMA_VERSION)
  );
}

function bonuses(game: GameState, id = 'p1') {
  const modifiers = collectLiveModifiers(game);
  return {
    hearts: getPlayerLiveHeartModifiers(game.liveResolution, id, modifiers),
    blade: getPlayerLiveBladeModifier(game.liveResolution, id, modifiers),
    score: getPlayerLiveScoreModifier(game.liveResolution, id, modifiers),
  };
}

describe('海克斯首批：固定增益和取得抽牌', () => {
  it('不启用时保持普通开局，配置也不会跨新对局继承', () => {
    const session = sessionWith();
    finishMulligan(session);
    expect(session.state!.players.map((p) => p.hand.cardIds.length)).toEqual([7, 6]);
    expect(session.state!.hextech).toBeUndefined();
    expect(session.getPlayerViewState('p1')!.match.hextech).toBeUndefined();
    expect(bonuses(session.state!)).toEqual({ hearts: [], blade: 0, score: 0 });
    session.createGame('configured', 'p1', 'P1', 'p2', 'P2', [['pot-of-greed'], []]);
    session.createGame('plain-again', 'p1', 'P1', 'p2', 'P2');
    expect(session.state!.hextech).toBeUndefined();
  });

  it.each([
    ['pot-of-greed', 2],
    ['pot-of-greater-greed', 3],
    ['pot-of-greatest-greed', 4],
  ] as const)('%s 在双方换牌后只抽 %i 张，并拒绝重复取得', (id, count) => {
    const session = sessionWith([[id], [id]]);
    const before = session.state!;
    expect(before.players.map((p) => p.hand.cardIds.length)).toEqual([6, 6]);
    expect(session.executeCommand(createMulliganCommand('p1', [])).success).toBe(true);
    expect(session.state!.hextech!.owned).toHaveLength(0);
    const command = { ...createMulliganCommand('p2', []), idempotencyKey: 'last-mulligan' };
    expect(session.executeCommand(command).success).toBe(true);
    const acquired = session.state!;
    const acquisitionEvents = session
      .getPublicEventsSince(0)
      .filter((event) => event.type === 'HextechAcquired');
    expect(acquisitionEvents.map((event) => event.ownerSeat)).toEqual(['FIRST', 'SECOND']);
    expect(acquired.players.map((p) => p.hand.cardIds.length)).toEqual([7 + count, 6 + count]);
    expect(acquired.hextech!.owned).toHaveLength(2);
    expect(acquired.hextech!.initialGrants).toBeUndefined();
    expect(session.executeCommand(command).success).toBe(true);
    expect(session.state).toBe(acquired);
    expect(
      session.getPublicEventsSince(0).filter((event) => event.type === 'HextechAcquired')
    ).toEqual(acquisitionEvents);
    const duplicate = acquireHextech(acquired, 'p1', id, acquired.hextech!.owned[0].instanceId);
    expect(duplicate.success).toBe(false);
    expect(duplicate.gameState).toBe(acquired);
    session.restoreRuntimeState({ authorityState: roundTrip(acquired), currentPublicSeq: 0 });
    expect(session.state!.players.map((p) => p.hand.cardIds.length)).toEqual([
      7 + count,
      6 + count,
    ]);
    expect(before.players.map((p) => p.hand.cardIds.length)).toEqual([6, 6]);
    expect(session.canUndoLastStep()).toBe(false);
  });

  it('三种双色心、两棒和一分都按玩家累计一次，成员待机或离场不丢失', () => {
    const ids = FIRST_BATCH_IDS.slice(0, 5);
    const session = sessionWith([ids, []]);
    finishMulligan(session);
    let game = session.state!;
    for (const [i, slot] of [
      SlotPosition.LEFT,
      SlotPosition.CENTER,
      SlotPosition.RIGHT,
    ].entries()) {
      const card = createCardInstance(member, 'p1', `stage-${i}`);
      game = registerCards(game, [card]);
      game = updatePlayer(game, 'p1', (p) => ({
        ...p,
        memberSlots: placeCardInSlot(
          p.memberSlots,
          slot,
          card.instanceId,
          OrientationState.WAITING
        ),
      }));
    }
    const actual = bonuses(game);
    expect(actual.hearts).toHaveLength(6);
    expect(actual.hearts.map((h) => h.color).sort()).toEqual(
      [
        HeartColor.PINK,
        HeartColor.RED,
        HeartColor.YELLOW,
        HeartColor.BLUE,
        HeartColor.GREEN,
        HeartColor.PURPLE,
      ].sort()
    );
    expect(actual.hearts.every((h) => h.count === 1)).toBe(true);
    expect(actual.blade).toBe(2);
    expect(actual.score).toBe(1);
    expect(bonuses(game, 'p2')).toEqual({ hearts: [], blade: 0, score: 0 });
    expect(getMemberEffectiveHeartIcons(game, 'p1', 'stage-0')).toEqual(member.hearts);
    expect(getMemberEffectiveBladeCount(game, 'p1', 'stage-0')).toBe(1);
    expect(bonuses(session.state!)).toEqual(actual);
    const service = new GameService();
    const cleaned = service.finalizeLiveResult({
      ...game,
      currentPhase: GamePhase.LIVE_RESULT_PHASE,
      currentSubPhase: SubPhase.RESULT_SETTLEMENT,
      liveResolution: {
        ...game.liveResolution,
        liveModifiers: [{ kind: 'SCORE', playerId: 'p1', countDelta: 4 }],
      },
    }).gameState;
    const afterCleanup = service.advancePhase(cleaned).gameState;
    expect(afterCleanup.turnCount).toBe(2);
    expect(afterCleanup.liveResolution.liveModifiers).toHaveLength(0);
    expect(bonuses(roundTrip(afterCleanup))).toEqual(actual);
    expect(collectLiveModifiers(game).filter((m) => 'sourceHextechInstanceId' in m)).toHaveLength(
      5
    );
  });

  it('海克斯的心参与实际 LIVE 判定，总分加成只加一次且不能使失败 LIVE 得分', () => {
    const session = sessionWith([['strawberry-cherry-ice-cream', 'original-ice-cream'], []]);
    finishMulligan(session);
    let game = registerCards(session.state!, [createCardInstance(live, 'p1', 'song')]);
    game = updatePlayer(game, 'p1', (p) => ({
      ...p,
      liveZone: addCardToStatefulZone(p.liveZone, 'song'),
    }));
    game = {
      ...game,
      currentPhase: GamePhase.PERFORMANCE_PHASE,
      currentSubPhase: SubPhase.PERFORMANCE_JUDGMENT,
    };
    const judge = (state: GameState) =>
      new GameService().processAction(state, {
        type: 'CONFIRM_JUDGMENT',
        playerId: 'p1',
        timestamp: 1,
        judgmentResults: new Map(),
      });
    const result = judge(game);
    expect(result.success).toBe(true);
    expect(result.gameState.liveResolution.liveResults.get('song')).toBe(true);
    expect(result.gameState.liveResolution.playerScores.get('p1')).toBe(4);
    const failure = judge({
      ...game,
      hextech: {
        ...game.hextech!,
        owned: game.hextech!.owned.filter((o) => o.definitionId === 'original-ice-cream'),
      },
    });
    expect(failure.gameState.liveResolution.liveResults.get('song')).toBe(false);
    expect(failure.gameState.liveResolution.playerScores.get('p1')).toBe(0);
    for (const playerId of ['p1', 'p2']) {
      const view = projectPlayerViewState(game, playerId);
      expect(view.match.liveResult!.scoreModifiers).toEqual({ FIRST: 1, SECOND: 0 });
      expect(view.match.liveResult!.heartBonuses.FIRST).toHaveLength(2);
      expect(view.match.hextech!.owned).toHaveLength(2);
    }
  });

  it('两棒进入真实声援流程，叠加活跃成员的棒但不计待机成员', () => {
    const session = sessionWith([['ice-cream-mystery-box'], []]);
    finishMulligan(session);
    let game = registerCards(session.state!, [
      createCardInstance(live, 'p1', 'song'),
      createCardInstance(member, 'p1', 'active'),
      createCardInstance(member, 'p1', 'waiting'),
    ]);
    game = updatePlayer(game, 'p1', (p) => ({
      ...p,
      liveZone: addCardToStatefulZone(p.liveZone, 'song'),
      memberSlots: placeCardInSlot(
        placeCardInSlot(p.memberSlots, SlotPosition.LEFT, 'active'),
        SlotPosition.RIGHT,
        'waiting',
        OrientationState.WAITING
      ),
    }));
    game = {
      ...game,
      currentPhase: GamePhase.PERFORMANCE_PHASE,
      currentSubPhase: SubPhase.PERFORMANCE_LIVE_START_EFFECTS,
      liveResolution: { ...game.liveResolution, isInLive: true, performingPlayerId: 'p1' },
    };
    session.restoreRuntimeState({ authorityState: game, currentPublicSeq: 0 });
    const result = session.executeCommand(
      createConfirmStepCommand('p1', SubPhase.PERFORMANCE_LIVE_START_EFFECTS)
    );
    expect(result.success, result.error).toBe(true);
    expect(session.state!.liveResolution.firstPlayerCheerCardIds).toHaveLength(3);
  });

  it('壶抽牌跨牌堆更新，牌不足时尽量执行且不会产生新卡', () => {
    const base: GameState = {
      ...createGameState('short', 'p1', 'P1', 'p2', 'P2'),
      isStarted: true,
      turnCount: 1,
      hextech: { rulesVersion: HEXTECH_RULES_VERSION, owned: [] },
    };
    let game = registerCards(
      base,
      ['a', 'b', 'c'].map((id) => createCardInstance(member, 'p1', id))
    );
    game = updatePlayer(game, 'p1', (p) => ({
      ...p,
      mainDeck: { ...p.mainDeck, cardIds: ['a'] },
      waitingRoom: { ...p.waitingRoom, cardIds: ['b', 'c'] },
    }));
    const result = acquireHextech(game, 'p1', 'pot-of-greatest-greed', 'pot');
    expect(result.success).toBe(true);
    expect(result.gameState.players[0].hand.cardIds.slice().sort()).toEqual(['a', 'b', 'c']);
    expect(result.gameState.players[0].waitingRoom.cardIds).toHaveLength(0);
    expect(result.gameState.players[0].mainDeck.cardIds).toHaveLength(0);
    expect(result.gameState.players[0].lastDeckRefreshTurnCount).toBe(1);
    expect(result.gameState.cardRegistry.size).toBe(3);
  });

  it('玩家投影不包含待授予配置或对手抽到的牌，恢复不重放取得收益', () => {
    const session = sessionWith([['pot-of-greed'], ['pot-of-greatest-greed']]);
    expect(JSON.stringify(session.getPlayerViewState('p1'))).not.toContain('initialGrants');
    const waiting = roundTrip(session.state!);
    session.restoreRuntimeState({ authorityState: waiting, currentPublicSeq: 0 });
    finishMulligan(session);
    const before = session.getPlayerViewState('p1')!;
    const p2Hand = session.state!.players[1].hand.cardIds;
    for (const id of p2Hand) expect(before.objects[`obj_${id}`]?.frontInfo).toBeUndefined();
    session.restoreRuntimeState({ authorityState: roundTrip(session.state!), currentPublicSeq: 0 });
    expect(session.getPlayerViewState('p1')!.match.hextech).toEqual(before.match.hextech);
    expect(session.state!.players[1].hand.cardIds).toEqual(p2Hand);
    expect(session.executeCommand(createEndPhaseCommand('p1')).success).toBe(true);
    expect(session.state!.players[1].hand.cardIds).toHaveLength(p2Hand.length + 1);
    expect(session.executeCommand(createSurrenderCommand('p1')).success).toBe(true);
    expect(session.state!.isEnded).toBe(true);
    expect(session.getPlayerViewState('p1')!.match.hextech!.owned).toHaveLength(2);
  });

  it('通过规则命令完成三个 LIVE 并自然获胜，跨回合加成保留且壶不重发', () => {
    const session = createGameSession({ randomInt: (max) => max - 1 });
    session.createGame('full-match', 'p1', 'P1', 'p2', 'P2', [[...FIRST_BATCH_IDS], []]);
    const members = Array.from({ length: 48 }, () => member);
    const songs = Array.from({ length: 12 }, () => live);
    session.initializeGame(
      { ...deck, mainDeck: [...songs, ...members] },
      { ...deck, mainDeck: [...members, ...songs] }
    );
    finishMulligan(session);
    const trace: string[] = [];
    for (let step = 0; step < 100 && !session.state!.isEnded; step++) {
      const state = session.state!;
      let next: GameCommand | undefined;
      for (const playerId of ['p1', 'p2']) {
        const view = session.getPlayerViewState(playerId)!;
        const allows = (type: GameCommandType) =>
          view.permissions.availableCommands.some((hint) => hint.command === type && hint.enabled);
        if (allows(GameCommandType.END_PHASE)) next = createEndPhaseCommand(playerId);
        else if (
          playerId === 'p1' &&
          allows(GameCommandType.SET_LIVE_CARD) &&
          state.players[0].liveZone.cardIds.length === 0
        ) {
          const song = state.players[0].hand.cardIds.find(
            (id) => state.cardRegistry.get(id)?.data.cardType === CardType.LIVE
          )!;
          next = createSetLiveCardCommand(playerId, song, true);
        } else if (
          allows(GameCommandType.SUBMIT_JUDGMENT) &&
          !state.liveResolution.playerScores.has(playerId)
        )
          next = createSubmitJudgmentCommand(playerId, new Map());
        else if (allows(GameCommandType.CONFIRM_PERFORMANCE_OUTCOME))
          next = createConfirmPerformanceOutcomeCommand(playerId, true);
        else if (
          allows(GameCommandType.SUBMIT_SCORE) &&
          !state.liveResolution.scoreConfirmedBy.includes(playerId)
        )
          next = createSubmitScoreCommand(playerId);
        else if (allows(GameCommandType.SELECT_SUCCESS_LIVE)) {
          const candidate = view.match.liveResult!.successLiveSelection!.candidateObjectIds[0];
          next = createSelectSuccessLiveCommand(playerId, candidate.slice(4));
        } else if (allows(GameCommandType.CONFIRM_STEP))
          next = createConfirmStepCommand(playerId, state.currentSubPhase);
        if (next) break;
      }
      expect(next, `${state.currentPhase}/${state.currentSubPhase}`).toBeDefined();
      trace.push(`${state.turnCount}/${state.currentSubPhase}: ${next!.playerId} ${next!.type}`);
      const result = session.executeCommand(next!);
      expect(result.success, `${next!.type}: ${result.error}`).toBe(true);
    }
    expect(session.state!.isEnded, trace.slice(-8).join('\n')).toBe(true);
    expect(session.state!.endInfo!.winnerId).toBe('p1');
    expect(session.state!.players[0].successZone.cardIds).toHaveLength(3);
    expect(session.state!.turnCount).toBe(3);
    expect(
      session.getPublicEventsSince(0).filter((event) => event.type === 'HextechAcquired')
    ).toHaveLength(8);
    expect(session.state!.hextech!.owned).toHaveLength(8);
  });

  it('拒绝未知定义、重复配置、错误规则集与损坏的 checkpoint', () => {
    const session = sessionWith();
    const before = session.state;
    for (const setup of [
      [['not-implemented'], []],
      [['pot-of-greed', 'pot-of-greed'], []],
      [['pot-of-greed']],
    ]) {
      expect(() =>
        session.createGame('bad', 'p1', 'P1', 'p2', 'P2', setup as InitialHextechSetup)
      ).toThrow();
      expect(session.state).toBe(before);
    }
    expect(() =>
      createGameSession({ rulesetId: 'SEALED_HALF_GRAY_V1' }).createGame(
        'bad',
        'p1',
        'P1',
        'p2',
        'P2',
        [['pot-of-greed'], []]
      )
    ).toThrow();
    const configured = sessionWith([['original-ice-cream'], []]);
    finishMulligan(configured);
    const valid = configured.state!;
    for (const owned of [
      [{ ...valid.hextech!.owned[0], definitionId: 'not-implemented' }],
      [{ ...valid.hextech!.owned[0], playerId: 'intruder' }],
      [{ ...valid.hextech!.owned[0], acquiredTurn: 9 }],
      [...valid.hextech!.owned, ...valid.hextech!.owned],
    ]) {
      expect(() =>
        roundTrip({ ...valid, hextech: { ...valid.hextech!, owned } } as GameState)
      ).toThrow();
    }
    const invalid = acquireHextech(valid, 'intruder', 'pot-of-greed', 'invalid');
    expect(invalid.success).toBe(false);
    expect(invalid.gameState).toBe(valid);
    expect(acquireHextech(valid, 'p1', 'not-implemented' as HextechId, 'invalid').success).toBe(
      false
    );
  });
});
