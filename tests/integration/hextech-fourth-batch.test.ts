import { describe, expect, it } from 'vitest';
import { createGameSession, type GameSession } from '../../src/application/game-session';
import { GameService, type DeckConfig } from '../../src/application/game-service';
import {
  GameCommandType,
  createConfirmStepCommand,
  createEndPhaseCommand,
  createMulliganCommand,
  createSubmitScoreCommand,
  type GameCommand,
} from '../../src/application/game-commands';
import { acquireHextech } from '../../src/application/hextech/acquire';
import { revealCheerCardsFromMainDeck } from '../../src/application/effects/cheer';
import { selectCurrentLiveRevealedCheerCardIdsWithoutBladeHearts } from '../../src/application/effects/cheer-selection';
import {
  createCardInstance,
  createHeartRequirement,
  type AnyCardData,
  type LiveCardData,
  type MemberCardData,
} from '../../src/domain/entities/card';
import {
  createEmptyLiveResolutionState,
  registerCards,
  updatePlayer,
  type GameState,
} from '../../src/domain/entities/game';
import { addCardToStatefulZone, placeCardInSlot } from '../../src/domain/entities/zone';
import {
  collectLiveModifiers,
  getCheerCardEffectiveBladeHearts,
  getPlayerLiveBladeModifier,
  getPlayerLiveScoreModifier,
} from '../../src/domain/rules/live-modifiers';
import { HEXTECH_DEFINITIONS, type HextechId } from '../../src/domain/hextech/catalog';
import { createPublicObjectId, projectPlayerViewState } from '../../src/online/projector';
import {
  rehydrateAuthorityGameState,
  serializeReplayPayload,
} from '../../src/server/services/replay-payload-serialization';
import { GAME_STATE_SCHEMA_VERSION } from '../../src/server/services/replay-constants';
import {
  BladeHeartEffect,
  CardType,
  GamePhase,
  HeartColor,
  SlotPosition,
  SubPhase,
  TriggerCondition,
} from '../../src/shared/types/enums';

const gray = { effect: BladeHeartEffect.HEART, heartColor: HeartColor.GRAY } as const;
const red = { effect: BladeHeartEffect.HEART, heartColor: HeartColor.RED } as const;
const score = { effect: BladeHeartEffect.SCORE } as const;
const draw = { effect: BladeHeartEffect.DRAW } as const;
const member: MemberCardData = {
  cardCode: 'TEST-M',
  name: '测试成员',
  cardType: CardType.MEMBER,
  cost: 1,
  blade: 0,
  hearts: [],
};
const song: LiveCardData = {
  cardCode: 'TEST-L',
  name: '测试歌曲',
  cardType: CardType.LIVE,
  score: 3,
  requirements: createHeartRequirement({ [HeartColor.GRAY]: 1 }),
};
const deck: DeckConfig = {
  mainDeck: Array.from({ length: 60 }, () => member),
  energyDeck: Array.from({ length: 12 }, () => ({
    cardCode: 'TEST-E',
    name: '能量',
    cardType: CardType.ENERGY,
  })),
};

function execute(session: GameSession, command: GameCommand) {
  const result = session.executeCommand(command);
  expect(result.success, result.error).toBe(true);
  return session.state!;
}
function begin(first: readonly HextechId[] = [], second: readonly HextechId[] = []) {
  const session = createGameSession({ randomInt: (max) => max - 1 });
  session.createGame('hextech-fourth', 'p1', '甲', 'p2', '乙', [first, second]);
  expect(session.initializeGame(deck, deck).success).toBe(true);
  execute(session, createMulliganCommand('p1', []));
  execute(session, createMulliganCommand('p2', []));
  return session;
}
function grant(game: GameState, definition: HextechId, instance = definition, playerId = 'p1') {
  const result = acquireHextech(game, playerId, definition, instance);
  expect(result.success, result.error).toBe(true);
  return result.gameState;
}
function roundTrip(game: GameState) {
  return rehydrateAuthorityGameState(
    serializeReplayPayload(game, 'AUTHORITY_GAME_STATE', GAME_STATE_SCHEMA_VERSION)
  );
}
function withCheerDeck(game: GameState, cards: readonly AnyCardData[], live = song) {
  const instances = cards.map((data, i) => createCardInstance(data, 'p1', `cheer-${i}`));
  const state = registerCards(game, [
    ...instances,
    createCardInstance(live, 'p1', 'performing'),
    createCardInstance(
      { ...member, blade: cards.length, hearts: [{ color: HeartColor.PINK, count: 1 }] },
      'p1',
      'stage'
    ),
  ]);
  return updatePlayer(state, 'p1', (p) => ({
    ...p,
    mainDeck: {
      ...p.mainDeck,
      cardIds: [...instances.map((card) => card.instanceId), ...p.mainDeck.cardIds],
    },
    liveZone: addCardToStatefulZone(p.liveZone, 'performing'),
    memberSlots: placeCardInSlot(p.memberSlots, SlotPosition.CENTER, 'stage'),
  }));
}
function judge(game: GameState) {
  const result = new GameService().processAction(
    {
      ...game,
      currentPhase: GamePhase.PERFORMANCE_PHASE,
      currentSubPhase: SubPhase.PERFORMANCE_JUDGMENT,
    },
    { type: 'CONFIRM_JUDGMENT', playerId: 'p1', timestamp: 1, judgmentResults: new Map() }
  );
  expect(result.success, result.error).toBe(true);
  return result.gameState;
}
function actualCheerCount(game: GameState) {
  const session = createGameSession();
  const prepared = withCheerDeck(game, [member, member]);
  session.restoreRuntimeState({
    authorityState: {
      ...prepared,
      currentPhase: GamePhase.PERFORMANCE_PHASE,
      currentSubPhase: SubPhase.PERFORMANCE_LIVE_START_EFFECTS,
    },
    currentPublicSeq: 0,
  });
  return execute(session, createConfirmStepCommand('p1', SubPhase.PERFORMANCE_LIVE_START_EFFECTS))
    .liveResolution.firstPlayerCheerCardIds.length;
}
function scoreBonus(game: GameState) {
  return getPlayerLiveScoreModifier(game.liveResolution, 'p1', collectLiveModifiers(game));
}

describe('海克斯第四批：成长、判定替换和取得移动', () => {
  it.each([5, 7, 9])(
    '拒绝赌博给印刷费用 %i 的空判成员一个灰判，按持有者隔离且重复取得不增加判数',
    (cost) => {
      let game = begin(['refuse-to-gamble']).state!;
      game = grant(game, 'refuse-to-gamble', 'duplicate');
      game = registerCards(game, [
        createCardInstance({ ...member, cost }, 'p1', 'own'),
        createCardInstance({ ...member, cost }, 'p2', 'other'),
        createCardInstance({ ...member, cost: 4, bladeHearts: [red] }, 'p1', 'cost4'),
      ]);
      expect(getCheerCardEffectiveBladeHearts(game, 'p1', 'own')).toEqual([gray]);
      expect(getCheerCardEffectiveBladeHearts(game, 'p2', 'other')).toEqual([]);
      expect(getCheerCardEffectiveBladeHearts(game, 'p1', 'other')).toEqual([]);
      expect(getCheerCardEffectiveBladeHearts(game, 'p1', 'cost4')).toEqual([red]);
      expect(
        getCheerCardEffectiveBladeHearts({ ...game, hextech: undefined }, 'p1', 'own')
      ).toEqual([]);
      const modified: GameState = {
        ...game,
        liveResolution: {
          ...game.liveResolution,
          liveModifiers: [
            { kind: 'MEMBER_COST', playerId: 'p1', memberCardId: 'own', countDelta: 2 },
            {
              kind: 'CHEER_CARD_HEART_COLOR_REPLACEMENT',
              playerId: 'p1',
              fromColors: [HeartColor.GRAY],
              toColor: HeartColor.BLUE,
            },
          ],
        },
      };
      expect(getCheerCardEffectiveBladeHearts(modified, 'p1', 'own')).toEqual([
        { effect: BladeHeartEffect.HEART, heartColor: HeartColor.BLUE },
      ]);
    }
  );

  it('两种判定替换参与真实声援、阻止原判抽，并让判定预览与成功分数一致', () => {
    const session = begin(['refuse-to-gamble', 'critical-hit', 'not-a-single-miss']);
    let game = withCheerDeck(
      session.state!,
      [
        { ...member, cost: 5 },
        { ...song, bladeHearts: [draw] },
        { ...member, cost: 6, bladeHearts: [red] },
        { ...song, bladeHearts: [red, red, red] },
        { ...member, cost: 7, bladeHearts: [draw] },
      ],
      {
        ...song,
        requirements: createHeartRequirement({ [HeartColor.GRAY]: 3, [HeartColor.RED]: 1 }),
      }
    );
    const beforeCount = game.players[0].hand.cardIds.length;
    game = {
      ...game,
      currentPhase: GamePhase.PERFORMANCE_PHASE,
      currentSubPhase: SubPhase.PERFORMANCE_LIVE_START_EFFECTS,
    };
    session.restoreRuntimeState({ authorityState: game, currentPublicSeq: 0 });
    game = execute(
      session,
      createConfirmStepCommand('p1', SubPhase.PERFORMANCE_LIVE_START_EFFECTS)
    );
    expect(game.liveResolution.firstPlayerCheerCardIds).toHaveLength(5);
    expect(game.players[0].hand.cardIds).toHaveLength(beforeCount);
    expect(selectCurrentLiveRevealedCheerCardIdsWithoutBladeHearts(game, 'p1')).toEqual([]);
    expect(scoreBonus(game)).toBe(1);
    for (const playerId of ['p1', 'p2']) {
      const view = projectPlayerViewState(game, playerId);
      expect(
        view.match.liveResult?.effectiveCheerBladeHearts[createPublicObjectId('cheer-0')]
      ).toEqual([gray]);
      expect(view.objects[createPublicObjectId('cheer-1')].frontInfo).toMatchObject({
        bladeHearts: [draw],
      });
      expect(
        view.match.liveResult?.effectiveCheerBladeHearts[createPublicObjectId('cheer-1')]
      ).toEqual([score, score]);
      expect(
        view.match.liveResult?.effectiveCheerBladeHearts[createPublicObjectId('cheer-3')]
      ).toEqual([score, score]);
      expect(view.match.liveResult?.scoreModifiers.FIRST).toBe(1);
    }
    const result = judge(game);
    expect(result.liveResolution.liveResults.get('performing')).toBe(true);
    expect(result.liveResolution.playerScores.get('p1')).toBe(8);
    const normal = { ...game, hextech: undefined };
    expect(selectCurrentLiveRevealedCheerCardIdsWithoutBladeHearts(normal, 'p1')).toEqual([
      'cheer-0',
    ]);
    expect(judge(normal).liveResolution.liveResults.get('performing')).toBe(true);
    expect(judge(normal).liveResolution.playerScores.get('p1')).toBe(3);
  });

  it('灰判不能补指定颜色，关键暴击不让空判LIVE或失败LIVE凭空得分', () => {
    let game = withCheerDeck(
      begin(['refuse-to-gamble', 'critical-hit']).state!,
      [{ ...member, cost: 9 }, song],
      { ...song, requirements: createHeartRequirement({ [HeartColor.BLUE]: 1 }) }
    );
    game = revealCheerCardsFromMainDeck(game, 'p1', 2).gameState;
    expect(getCheerCardEffectiveBladeHearts(game, 'p1', 'cheer-1')).toEqual([]);
    expect(judge(game).liveResolution.playerScores.get('p1')).toBe(0);
    const hidden = {
      ...game,
      resolutionZone: { ...game.resolutionZone, revealedCardIds: [] },
    };
    expect(
      projectPlayerViewState(hidden, 'p2').objects[createPublicObjectId('cheer-0')].frontInfo
    ).toBeUndefined();
  });

  it('未启用海克斯的对局与恢复视图仍投影己方颜色替换，并保留印刷判定', () => {
    let game = withCheerDeck(begin().state!, [
      { ...member, bladeHearts: [red] },
      { ...song, bladeHearts: [draw] },
    ]);
    game = revealCheerCardsFromMainDeck(game, 'p1', 2).gameState;
    game = {
      ...game,
      liveResolution: {
        ...game.liveResolution,
        liveModifiers: [
          {
            kind: 'CHEER_CARD_HEART_COLOR_REPLACEMENT',
            playerId: 'p1',
            fromColors: [HeartColor.RED],
            toColor: HeartColor.BLUE,
          },
          {
            kind: 'CHEER_CARD_HEART_COLOR_REPLACEMENT',
            playerId: 'p2',
            fromColors: [HeartColor.RED],
            toColor: HeartColor.PURPLE,
          },
        ],
      },
    };
    for (const state of [game, roundTrip(game)]) {
      for (const playerId of ['p1', 'p2']) {
        const view = projectPlayerViewState(state, playerId);
        expect(view.objects[createPublicObjectId('cheer-0')].frontInfo).toMatchObject({
          bladeHearts: [red],
        });
        expect(
          view.match.liveResult?.effectiveCheerBladeHearts[createPublicObjectId('cheer-0')]
        ).toEqual([{ effect: BladeHeartEffect.HEART, heartColor: HeartColor.BLUE }]);
        expect(view.objects[createPublicObjectId('cheer-1')].frontInfo).toMatchObject({
          bladeHearts: [draw],
        });
        expect(
          view.match.liveResult?.effectiveCheerBladeHearts[createPublicObjectId('cheer-1')]
        ).toEqual([draw]);
      }
    }
  });

  it('空判授予、橙判心、海克斯替换与全判加分共用有效判定，授予失效后重新计算', () => {
    const orange = { effect: BladeHeartEffect.HEART, heartColor: HeartColor.ORANGE } as const;
    let game = withCheerDeck(
      begin(['refuse-to-gamble', 'critical-hit', 'not-a-single-miss']).state!,
      [
        member,
        { ...member, cost: 5 },
        { ...song, bladeHearts: [orange] },
        { ...song, bladeHearts: [draw] },
        { ...member, cost: 7, bladeHearts: [red] },
      ],
      { ...song, requirements: createHeartRequirement({ [HeartColor.GRAY]: 4 }) }
    );
    game = {
      ...game,
      liveResolution: {
        ...game.liveResolution,
        liveModifiers: [
          {
            kind: 'CHEER_CARD_BLADE_HEART_GRANT',
            playerId: 'p1',
            maxMemberCost: 5,
            heartColor: HeartColor.ORANGE,
            abilityId: 'test:orange-grant',
          },
        ],
      },
    };
    const before = game.players[0].hand.cardIds.length;
    game = revealCheerCardsFromMainDeck(game, 'p1', 5).gameState;
    expect(game.players[0].hand.cardIds).toHaveLength(before);
    expect(scoreBonus(game)).toBe(1);
    expect(selectCurrentLiveRevealedCheerCardIdsWithoutBladeHearts(game, 'p1')).toEqual([]);
    for (const state of [game, roundTrip(game)]) {
      for (const playerId of ['p1', 'p2']) {
        const result = projectPlayerViewState(state, playerId).match.liveResult!;
        expect(result.effectiveCheerBladeHearts).toMatchObject({
          'obj_cheer-0': [orange],
          'obj_cheer-1': [gray],
          'obj_cheer-2': [score, score],
          'obj_cheer-3': [score, score],
          'obj_cheer-4': [gray],
        });
        expect(result.cheerBladeHeartGrantAbilityIds).toEqual({
          'obj_cheer-0': 'test:orange-grant',
        });
      }
      expect(judge(state).liveResolution.playerScores.get('p1')).toBe(8);
    }
    const expired = { ...game, liveResolution: { ...game.liveResolution, liveModifiers: [] } };
    expect(scoreBonus(expired)).toBe(0);
    expect(judge(expired).liveResolution.liveResults.get('performing')).toBe(false);
  });

  it.each([
    [4, 0],
    [5, 1],
    [9, 1],
    [10, 2],
  ])('压根没漏儿按本次全部 %i 张公开牌给 %i 分，包含已回收牌并在新LIVE清零', (count, bonus) => {
    let game = withCheerDeck(
      begin(['not-a-single-miss']).state!,
      Array.from({ length: count }, () => ({ ...member, bladeHearts: [red] }))
    );
    game = revealCheerCardsFromMainDeck(game, 'p1', count).gameState;
    expect(scoreBonus(game)).toBe(bonus);
    const moved: GameState = updatePlayer(
      {
        ...game,
        resolutionZone: {
          ...game.resolutionZone,
          cardIds: game.resolutionZone.cardIds.slice(1),
          revealedCardIds: game.resolutionZone.revealedCardIds.slice(1),
        },
      },
      'p1',
      (p) => ({ ...p, hand: { ...p.hand, cardIds: [...p.hand.cardIds, 'cheer-0'] } })
    );
    expect(scoreBonus(moved)).toBe(bonus);
    expect(scoreBonus({ ...moved, liveResolution: createEmptyLiveResolutionState() })).toBe(0);
    const blank = revealCheerCardsFromMainDeck(moved, 'p1', 1, { additional: true }).gameState;
    expect(scoreBonus(blank)).toBe(0);
  });

  it('声援条件不读取未公开牌，重做声援后只使用当前批次', () => {
    let game = withCheerDeck(
      begin(['not-a-single-miss']).state!,
      Array.from({ length: 5 }, () => ({ ...member, bladeHearts: [red] }))
    );
    game = revealCheerCardsFromMainDeck(game, 'p1', 4).gameState;
    const hidden = {
      ...game,
      liveResolution: {
        ...game.liveResolution,
        firstPlayerCheerCardIds: [...game.liveResolution.firstPlayerCheerCardIds, 'cheer-4'],
      },
    };
    expect(scoreBonus(hidden)).toBe(0);
    game = revealCheerCardsFromMainDeck(game, 'p1', 1, { additional: true }).gameState;
    expect(scoreBonus(game)).toBe(1);
    const rerolled = revealCheerCardsFromMainDeck(game, 'p1', 5, {
      replaceCurrentCheerCards: true,
    }).gameState;
    expect(scoreBonus(rerolled)).toBe(0);
  });

  it.each([
    [1, 1],
    [3, 2],
    [5, 3],
  ])(
    '第 %i 回合取得的恶魔形态立即给 %i 棒，成长随实例取得时间计算且复水不重算',
    (turn, initial) => {
      let game = grant({ ...begin().state!, turnCount: turn }, 'demon-form');
      expect(actualCheerCount(game)).toBe(2 + initial);
      expect(
        getPlayerLiveBladeModifier(game.liveResolution, 'p2', collectLiveModifiers(game))
      ).toBe(0);
      game = { ...game, turnCount: turn + 2 };
      expect(actualCheerCount(roundTrip(game))).toBe(4 + initial);
      game = grant(game, 'demon-form', 'second-demon');
      const secondInitial = Math.min(3, Math.ceil((turn + 2) / 2));
      expect(actualCheerCount(game)).toBe(4 + initial + secondInitial);
    }
  );

  it.each([
    [1, 1],
    [3, 2],
    [5, 3],
  ])('第 %i 回合取得来财立即抽 %i 张，同回合通常抽牌不再重复额外抽', (turn, initial) => {
    const base = { ...begin().state!, turnCount: turn };
    const before = base.players[0].hand.cardIds.length;
    const acquired = grant(base, 'incoming-wealth');
    expect(acquired.players[0].hand.cardIds).toHaveLength(before + initial);
    const restored = roundTrip(acquired);
    expect(restored.players[0].hand.cardIds).toHaveLength(before + initial);
    expect(acquireHextech(restored, 'p1', 'incoming-wealth', 'incoming-wealth').success).toBe(
      false
    );
    const drawAt = (state: GameState, currentTurn: number) =>
      new GameService().advancePhase({
        ...state,
        turnCount: currentTurn,
        currentPhase: GamePhase.ENERGY_PHASE,
        currentSubPhase: SubPhase.NONE,
      }).gameState;
    expect(drawAt(restored, turn).players[0].hand.cardIds).toHaveLength(before + initial + 1);
    expect(drawAt(restored, turn + 1).players[0].hand.cardIds).toHaveLength(before + initial + 2);
  });

  it('来财跨空牌堆沿用更新，牌不足时尽量抽牌', () => {
    let game = { ...begin().state!, turnCount: 5 };
    game = updatePlayer(game, 'p1', (p) => ({
      ...p,
      mainDeck: { ...p.mainDeck, cardIds: p.mainDeck.cardIds.slice(0, 1) },
      waitingRoom: { ...p.waitingRoom, cardIds: p.mainDeck.cardIds.slice(1, 4) },
    }));
    const before = game.players[0].hand.cardIds.length;
    game = grant(game, 'incoming-wealth');
    expect(game.players[0].hand.cardIds).toHaveLength(before + 3);
    expect(game.players[0].waitingRoom.cardIds).toHaveLength(0);
    expect(game.players[0].mainDeck.cardIds).toHaveLength(1);
    game = grant(game, 'incoming-wealth', 'later-wealth');
    expect(game.players[0].hand.cardIds).toHaveLength(before + 4);
    const empty = new GameService().advancePhase({
      ...game,
      turnCount: 6,
      currentPhase: GamePhase.ENERGY_PHASE,
      currentSubPhase: SubPhase.NONE,
    }).gameState;
    expect(empty.players[0].hand.cardIds).toHaveLength(before + 4);
  });

  it('后取得的来财实例同回合只发即时收益，随后与既有实例叠加额外抽牌', () => {
    let game = begin(['incoming-wealth']).state!;
    game = grant({ ...game, turnCount: 3 }, 'incoming-wealth', 'second-wealth');
    const before = game.players[0].hand.cardIds.length;
    const drawAt = (turn: number) =>
      new GameService().advancePhase({
        ...game,
        turnCount: turn,
        currentPhase: GamePhase.ENERGY_PHASE,
        currentSubPhase: SubPhase.NONE,
      }).gameState;
    expect(drawAt(3).players[0].hand.cardIds).toHaveLength(before + 2);
    expect(drawAt(4).players[0].hand.cardIds).toHaveLength(before + 3);
  });

  it('真实双人阶段循环中，来财每回合仅在本人抽牌阶段增加一次，重复命令与中途恢复不额外发牌', () => {
    let session = begin(['incoming-wealth', 'demon-form'], ['incoming-wealth']);
    const seen = new Map<string, number>();
    for (let step = 0; step < 100 && session.state!.turnCount < 6; step++) {
      const state = session.state!;
      if (state.currentPhase === GamePhase.MAIN_PHASE) {
        const player = state.players[state.activePlayerIndex];
        seen.set(`${state.turnCount}:${player.id}`, player.hand.cardIds.length);
      }
      if (
        state.turnCount === 3 &&
        state.currentPhase === GamePhase.MAIN_PHASE &&
        state.activePlayerIndex === 0
      ) {
        const restored = createGameSession();
        restored.restoreRuntimeState({ authorityState: roundTrip(state), currentPublicSeq: 0 });
        session = restored;
      }
      let command: GameCommand | undefined;
      for (const player of session.state!.players) {
        const allows = (type: GameCommandType) =>
          session
            .getPlayerViewState(player.id)!
            .permissions.availableCommands.some((hint) => hint.command === type && hint.enabled);
        if (allows(GameCommandType.END_PHASE)) command = createEndPhaseCommand(player.id);
        else if (
          allows(GameCommandType.SUBMIT_SCORE) &&
          !state.liveResolution.scoreConfirmedBy.includes(player.id)
        )
          command = createSubmitScoreCommand(player.id);
        else if (allows(GameCommandType.CONFIRM_STEP))
          command = createConfirmStepCommand(player.id, state.currentSubPhase);
        if (command) break;
      }
      expect(command).toBeDefined();
      command = { ...command!, idempotencyKey: `advance-${step}` };
      const after = execute(session, command);
      execute(session, command);
      expect(session.state).toBe(after);
    }
    expect(session.state!.turnCount).toBe(6);
    for (let turn = 1; turn <= 5; turn++) {
      for (const id of ['p1', 'p2']) expect(seen.get(`${turn}:${id}`)).toBe(8 + 2 * (turn - 1));
    }
  });

  it('掀桌等待双方确认后一次清理双方成功区，公开移动、移除条件加成且恢复不重发', () => {
    const session = begin(['you-are-also-a-zone'], ['you-are-also-a-zone']);
    let game = session.state!;
    for (const playerId of ['p1', 'p2']) {
      const cards = [1, 2].map((i) =>
        createCardInstance(song, playerId, `${playerId}-success-${i}`)
      );
      game = registerCards(game, cards);
      game = updatePlayer(game, playerId, (p) => ({
        ...p,
        successZone: { ...p.successZone, cardIds: cards.map((card) => card.instanceId) },
      }));
    }
    const candidates = (['table-flip', 'critical-hit', 'incoming-wealth'] as const).map(
      (definitionId) => ({ definitionId, rerolled: false })
    );
    game = {
      ...game,
      turnCount: 3,
      currentPhase: GamePhase.ACTIVE_PHASE,
      currentSubPhase: SubPhase.NONE,
      hextech: {
        ...game.hextech!,
        draft: {
          completedRounds: 1,
          pending: { turn: 3, rarity: 'PRISMATIC', offers: [{ candidates }, { candidates }] },
        },
      },
    };
    session.restoreRuntimeState({ authorityState: game, currentPublicSeq: 0 });
    const command = (playerId: string, slot: number): GameCommand => ({
      type: GameCommandType.SELECT_HEXTECH,
      playerId,
      selectionTurn: 3,
      slot,
      expectedDefinitionId: candidates[slot].definitionId,
      timestamp: 1,
      idempotencyKey: `lock-${playerId}`,
    });
    execute(session, command('p1', 0));
    expect(session.state!.players.map((p) => p.successZone.cardIds.length)).toEqual([2, 2]);
    const result = execute(session, command('p2', 1));
    expect(result.players.map((p) => p.successZone.cardIds.length)).toEqual([0, 0]);
    for (const p of result.players)
      expect(p.waitingRoom.cardIds).toEqual([`${p.id}-success-1`, `${p.id}-success-2`]);
    expect(
      result.eventLog.filter(
        ({ event }) => event.eventType === TriggerCondition.ON_ENTER_WAITING_ROOM
      )
    ).toHaveLength(2);
    expect(
      session
        .getPublicEventsSince(0)
        .filter((event) => event.type === 'CardMovedPublic' && event.from?.zone === 'SUCCESS_ZONE')
    ).toHaveLength(4);
    expect(session.getPlayerViewState('p1')!.match.liveResult?.heartBonuses.FIRST).toEqual([]);
    execute(session, command('p2', 1));
    expect(session.state).toBe(result);
    expect(roundTrip(result).players.map((p) => p.successZone.cardIds.length)).toEqual([0, 0]);
    expect(result.isEnded).toBe(false);
    expect(result.rulesetId).toBe('STANDARD');
  });

  it.each([
    'refuse-to-gamble',
    'not-a-single-miss',
    'demon-form',
    'incoming-wealth',
    'critical-hit',
    'table-flip',
  ] as const)('%s 可以从真人候选中取得，并在双方确认后向双方公开', (id) => {
    const definition = HEXTECH_DEFINITIONS.find((item) => item.id === id)!;
    const pool = HEXTECH_DEFINITIONS.filter((item) => item.rarity === definition.rarity);
    let sampling = false;
    let step = 0;
    const session = createGameSession({
      hextechRoundSelection: true,
      randomInt: (max) => {
        if (!sampling) return max - 1;
        const call = step++;
        if (call === 0) return ['SILVER', 'GOLD', 'PRISMATIC'].indexOf(definition.rarity);
        if (call === 1 || call === 4) return pool.findIndex((item) => item.id === id);
        return 0;
      },
    });
    session.createGame(`select-${id}`, 'p1', '甲', 'p2', '乙');
    expect(session.initializeGame(deck, deck).success).toBe(true);
    execute(session, createMulliganCommand('p1', []));
    sampling = true;
    execute(session, createMulliganCommand('p2', []));
    for (const playerId of ['p2', 'p1']) {
      const candidate =
        session.getPlayerViewState(playerId)!.match.hextech!.selection!.ownOffer!.candidates[0];
      expect(candidate.definitionId).toBe(id);
      execute(session, {
        type: GameCommandType.SELECT_HEXTECH,
        playerId,
        selectionTurn: 1,
        slot: 0,
        expectedDefinitionId: candidate.definitionId,
        timestamp: 1,
      });
    }
    expect(session.state!.currentPhase).toBe(GamePhase.MAIN_PHASE);
    for (const playerId of ['p1', 'p2'])
      expect(
        session.getPlayerViewState(playerId)!.match.hextech!.owned.map((item) => item.definitionId)
      ).toEqual([id, id]);
  });
});
