import { describe, expect, it, vi } from 'vitest';
import { createGameSession, type GameSession } from '../../src/application/game-session';
import { GameService, type DeckConfig } from '../../src/application/game-service';
import {
  GameCommandType,
  createMulliganCommand,
  createEndPhaseCommand,
  createConfirmStepCommand,
  createSubmitScoreCommand,
  createSurrenderCommand,
  type HextechCommand,
  type GameCommand,
} from '../../src/application/game-commands';
import { CardType, GamePhase, SubPhase, OrientationState } from '../../src/shared/types/enums';
import {
  serializeReplayPayload,
  rehydrateAuthorityGameState,
} from '../../src/server/services/replay-payload-serialization';
import { GAME_STATE_SCHEMA_VERSION } from '../../src/server/services/replay-constants';
import { OnlineMatchService } from '../../src/server/services/online-match-service';

const deck: DeckConfig = {
  mainDeck: Array.from({ length: 60 }, () => ({
    cardCode: 'TEST-M',
    name: '测试成员',
    cardType: CardType.MEMBER,
    cost: 1,
    blade: 0,
    hearts: [],
  })),
  energyDeck: Array.from({ length: 12 }, () => ({
    cardCode: 'TEST-E',
    name: '能量',
    cardType: CardType.ENERGY,
  })),
};
function setup(rarity?: number) {
  const random = vi.fn((max: number) => max - 1);
  const session = createGameSession({ hextechRoundSelection: true, randomInt: random });
  session.createGame('hextech-draft', 'p1', '甲', 'p2', '乙');
  expect(session.initializeGame(deck, deck).success).toBe(true);
  expect(session.executeCommand(createMulliganCommand('p1', [])).success).toBe(true);
  random.mockClear();
  if (rarity !== undefined) random.mockImplementation(() => 0).mockImplementationOnce(() => rarity);
  const lastMulligan = { ...createMulliganCommand('p2', []), idempotencyKey: 'last-mulligan' };
  expect(session.executeCommand(lastMulligan).success).toBe(true);
  return { session, random, lastMulligan };
}
function choose(
  session: GameSession,
  playerId: string,
  slot: number,
  reroll = false
): HextechCommand {
  const view = session.getPlayerViewState(playerId)!.match.hextech!.selection!;
  return {
    type: reroll ? GameCommandType.REROLL_HEXTECH : GameCommandType.SELECT_HEXTECH,
    playerId,
    selectionTurn: view.turn,
    slot,
    expectedDefinitionId: view.ownOffer!.candidates[slot].definitionId,
    timestamp: 1,
  };
}
const execute = (session: GameSession, command: GameCommand) => {
  const result = session.executeCommand(command);
  expect(result.success, result.error).toBe(true);
};

describe('海克斯回合选择', () => {
  it('真人服务按登录身份校验，候选不外发给对手或观战者，重连和重复请求保留结果', async () => {
    const service = new OnlineMatchService({ recorder: null, randomInt: (max) => max - 1 });
    const participant = (userId: string) => ({
      userId,
      displayName: userId,
      deck,
      pointValidation: { pointTableVersion: 'test', pointTotal: 0, pointLimit: 9 },
    });
    const match = await service.createMatch({
      roomCode: 'HEX123',
      hextechRoundSelection: true,
      casualRuleMode: 'UNLIMITED',
      first: participant('u1'),
      second: participant('u2'),
    });
    await service.executeCommand(match.matchId, 'u1', createMulliganCommand('forged', []));
    await service.executeCommand(match.matchId, 'u2', createMulliganCommand('forged', []));
    const firstId = match.session.state!.players[0].id;
    const secondId = match.session.state!.players[1].id;
    const before = match.session.getPlayerViewState(firstId)!.match.hextech!.selection!.ownOffer!;
    const reroll = { ...choose(match.session, firstId, 0, true), idempotencyKey: 'network-retry' };
    await service.executeCommand(match.matchId, 'u1', reroll);
    const rerolled = await service.getMatchSnapshot(match.matchId, 'u1');
    await service.executeCommand(match.matchId, 'u1', reroll);
    const reconnected = await service.getMatchSnapshot(match.matchId, 'u1');
    expect(reconnected).toMatchObject({
      playerViewState: {
        match: {
          hextech: {
            selection: {
              ownOffer: {
                candidates: [{ rerolled: true }, { rerolled: false }, { rerolled: false }],
              },
            },
          },
        },
      },
    });
    expect(
      reconnected && 'playerViewState' in reconnected && reconnected.playerViewState.match.hextech
    ).toEqual(rerolled && 'playerViewState' in rerolled && rerolled.playerViewState.match.hextech);
    const other = match.session.getPlayerViewState(secondId)!.match.hextech!.selection!;
    expect(other.ownOffer!.candidates).toEqual(before.candidates);
    const link = service.createRoomCodePlayerViewSpectatorLink(
      match.matchId,
      'FIRST',
      ['FIRST', 'SECOND'],
      'test-generation'
    )!;
    const spectator = await service.joinSpectatorLink(link.token, { clientId: 'spectator' });
    expect(spectator.snapshot).toHaveProperty('playerViewState.match.hextech.selection');
    expect(JSON.stringify(spectator.snapshot)).not.toContain('candidates');
    expect(JSON.stringify(match.session.getPublicEventsSince(0))).not.toContain(
      'flexible-solo-fan'
    );
    expect(
      await service.executeCommand(match.matchId, 'outsider', choose(match.session, firstId, 0))
    ).toBeNull();
    const forged = { ...choose(match.session, secondId, 0), playerId: firstId };
    expect((await service.executeCommand(match.matchId, 'u2', forged))!.success).toBe(true);
    expect(match.session.getPlayerViewState(firstId)!.match.hextech!.selection).toMatchObject({
      lockedSeats: ['SECOND'],
    });
    expect(match.session.state!.hextech!.draft!.pending!.offers[0].selectedIndex).toBeUndefined();
    expect(match.session.state!.hextech!.owned).toHaveLength(0);
    await service.executeCommand(match.matchId, 'u1', choose(match.session, firstId, 0));
    expect(match.session.state!.hextech!.owned).toHaveLength(2);
  });
  it('真人双方同时提交确认并重试时，仅结算一次且继续正常回合', async () => {
    const random = vi.fn((max: number) => max - 1);
    const service = new OnlineMatchService({ recorder: null, randomInt: random });
    const participant = (userId: string) => ({
      userId,
      displayName: userId,
      deck,
      pointValidation: { pointTableVersion: 'test', pointTotal: 0, pointLimit: 9 },
    });
    const match = await service.createMatch({
      roomCode: 'HEX456',
      hextechRoundSelection: true,
      casualRuleMode: 'UNLIMITED',
      first: participant('u1'),
      second: participant('u2'),
    });
    await service.executeCommand(match.matchId, 'u1', createMulliganCommand('u1', []));
    random.mockImplementation(() => 0).mockImplementationOnce(() => 2);
    await service.executeCommand(match.matchId, 'u2', createMulliganCommand('u2', []));
    const commands = match.session.state!.players.map((player, index) => ({
      ...choose(match.session, player.id, 0),
      idempotencyKey: `concurrent-${index}`,
    }));
    const calls = random.mock.calls.length;
    const confirm = () =>
      Promise.all(
        commands.map((command, index) =>
          service.executeCommand(match.matchId, `u${index + 1}`, command)
        )
      );
    expect((await confirm()).every((result) => result?.success)).toBe(true);
    expect((await confirm()).every((result) => result?.success)).toBe(true);
    expect(random).toHaveBeenCalledTimes(calls);
    expect(match.session.state!.hextech!.owned).toHaveLength(2);
    expect(match.session.state!.players.map((player) => player.hand.cardIds.length)).toEqual([
      11, 10,
    ]);
    expect(match.session.state!.currentPhase).toBe(GamePhase.MAIN_PHASE);
    expect(
      match.session.getPublicEventsSince(0).filter((event) => event.type === 'HextechAcquired')
    ).toHaveLength(2);
  });

  it('换牌后自动生成共同稀有度与私密候选，刷新和重复请求不再次随机', () => {
    const { session, random, lastMulligan } = setup();
    expect(session.state!.currentPhase).toBe(GamePhase.ACTIVE_PHASE);
    expect(session.state!.players.map((player) => player.hand.cardIds.length)).toEqual([6, 6]);
    expect(session.undoLastStep().success).toBe(false);
    expect(random).toHaveBeenCalledTimes(7);
    expect(session.executeCommand(createEndPhaseCommand('p1')).success).toBe(false);
    expect(session.setManualOperationMode('FREE').success).toBe(false);
    expect(new GameService().advancePhase(session.state!).success).toBe(false);
    const state = session.state;
    execute(session, lastMulligan);
    for (const playerId of ['p1', 'p2']) {
      const view = session.getPlayerViewState(playerId)!;
      expect(view.match.hextech!.selection!.rarity).toBe('PRISMATIC');
      expect(view.match.hextech!.selection!.ownOffer!.candidates).toHaveLength(3);
      expect(view.permissions.availableCommands).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ command: GameCommandType.SELECT_HEXTECH, enabled: true }),
          expect.objectContaining({ command: GameCommandType.REROLL_HEXTECH, enabled: true }),
        ])
      );
    }
    expect(random).toHaveBeenCalledTimes(7);
    expect(session.state).toBe(state);
    const events = session
      .getPublicEventsSince(0)
      .filter((event) => event.type === 'HextechSelectionStarted');
    expect(events).toEqual([
      expect.objectContaining({ source: 'SYSTEM', turn: 1, rarity: 'PRISMATIC' }),
    ]);
    expect(events[0]).not.toHaveProperty('actorSeat');
    expect(events[0]).not.toHaveProperty('offers');
    expect(
      session.getSealedAuditSince(0).filter((record) => record.type === 'HEXTECH_RANDOM_RESULT')
    ).toEqual([
      expect.objectContaining({
        payload: { reason: 'ROUND_START', selection: state!.hextech!.draft!.pending },
      }),
    ]);
  });

  it.each([0, 1, 2])(
    '三档都提供三个不同初始候选；每格仅重抽一次且不返回原项（档 %i）',
    (rarity) => {
      const { session, random } = setup(rarity);
      const first = session.getPlayerViewState('p1')!.match.hextech!.selection!;
      expect(first.rarity).toBe(['SILVER', 'GOLD', 'PRISMATIC'][rarity]);
      expect(
        new Set(first.ownOffer!.candidates.map((candidate) => candidate.definitionId)).size
      ).toBe(3);
      const oldChoice = choose(session, 'p1', 0);
      const reroll = { ...choose(session, 'p1', 0, true), idempotencyKey: 'reroll-0' };
      execute(session, reroll);
      const updated = session.getPlayerViewState('p1')!.match.hextech!.selection!.ownOffer!;
      expect(updated.candidates[0].definitionId).not.toBe(
        first.ownOffer!.candidates[0].definitionId
      );
      const calls = random.mock.calls.length;
      execute(session, reroll);
      expect(session.executeCommand(oldChoice).success).toBe(false);
      expect(session.executeCommand(choose(session, 'p1', 0, true)).success).toBe(false);
      expect(session.executeCommand({ ...choose(session, 'p1', 1, true), slot: 3 }).success).toBe(
        false
      );
      expect(random).toHaveBeenCalledTimes(calls);
      execute(session, choose(session, 'p1', 1, true));
      execute(session, choose(session, 'p1', 2, true));
      expect(session.undoLastStep().success).toBe(false);
    }
  );

  it.each([
    ['p1', 'p2'],
    ['p2', 'p1'],
  ])('双方按 %s、%s 顺序确认都只在最后一人确认后公开和结算', (firstLocker, lastLocker) => {
    const { session } = setup(2);
    const command1 = { ...choose(session, firstLocker, 0), idempotencyKey: 'first-lock' };
    const command2 = { ...choose(session, lastLocker, 0), idempotencyKey: 'last-lock' };
    expect(command1.expectedDefinitionId).toBe('pot-of-greatest-greed');
    execute(session, command1);
    expect(session.state!.hextech!.owned).toHaveLength(0);
    expect(session.state!.players.map((player) => player.hand.cardIds.length)).toEqual([6, 6]);
    const opponent = session.getPlayerViewState(lastLocker)!.match.hextech!.selection!;
    expect(Object.keys(opponent).sort()).toEqual(['lockedSeats', 'ownOffer', 'rarity', 'turn']);
    expect(opponent.lockedSeats).toEqual([firstLocker === 'p1' ? 'FIRST' : 'SECOND']);
    expect(opponent.ownOffer!.selectedIndex).toBeUndefined();
    expect(session.getPublicEventsSince(0).some((event) => event.type === 'HextechAcquired')).toBe(
      false
    );
    expect(session.executeCommand(choose(session, firstLocker, 1, true)).success).toBe(false);
    execute(session, command2);
    expect(session.state!.hextech!.owned).toHaveLength(2);
    expect(session.state!.players.map((player) => player.hand.cardIds.length)).toEqual([11, 10]);
    expect(session.state!.currentPhase).toBe(GamePhase.MAIN_PHASE);
    expect(session.getPlayerViewState('p1')!.match.hextech!.selection).toBeUndefined();
    execute(session, command1);
    execute(session, command2);
    expect(session.state!.hextech!.owned).toHaveLength(2);
    expect(session.executeCommand({ ...command1, idempotencyKey: 'stale-window' }).success).toBe(
      false
    );
    expect(session.undoLastStep().success).toBe(false);
  });

  it('复水保留私密候选、每格重抽次数和单方锁定，拒绝损坏选择窗口', () => {
    const { session } = setup();
    execute(session, choose(session, 'p1', 0, true));
    execute(session, choose(session, 'p2', 1));
    const authority = rehydrateAuthorityGameState(
      serializeReplayPayload(session.state!, 'AUTHORITY_GAME_STATE', GAME_STATE_SCHEMA_VERSION)
    );
    const restored = createGameSession();
    restored.restoreRuntimeState({
      authorityState: authority,
      currentPublicSeq: session.getCurrentPublicEventSeq(),
    });
    expect(restored.getPlayerViewState('p1')!.match.hextech).toEqual(
      session.getPlayerViewState('p1')!.match.hextech
    );
    expect(restored.executeCommand(choose(restored, 'p1', 0, true)).success).toBe(false);
    expect(restored.executeCommand(choose(restored, 'p2', 0)).success).toBe(false);
    execute(restored, choose(restored, 'p1', 0));
    expect(restored.state!.hextech!.owned).toHaveLength(2);
    const bad = {
      ...authority,
      hextech: {
        ...authority.hextech!,
        draft: { completedRounds: 1, pending: authority.hextech!.draft!.pending },
      },
    };
    expect(() =>
      rehydrateAuthorityGameState(
        serializeReplayPayload(bad, 'AUTHORITY_GAME_STATE', GAME_STATE_SCHEMA_VERSION)
      )
    ).toThrow(/海克斯/);
  });

  it('真实阶段循环只在第 1/3/5 回合打开，各取得三项，重复定义按独立实例叠加', () => {
    const { session } = setup();
    const rounds: number[] = [];
    for (let step = 0; step < 200 && session.state!.turnCount < 6; step++) {
      const state = session.state!;
      if (state.hextech!.draft!.pending) {
        rounds.push(state.turnCount);
        expect(
          state.hextech!.draft!.pending!.offers.every((offer) => offer.candidates.length === 3)
        ).toBe(true);
        execute(session, choose(session, 'p2', 0));
        execute(session, choose(session, 'p1', 0));
        continue;
      }
      let command: GameCommand | undefined;
      for (const player of state.players) {
        const hints = session.getPlayerViewState(player.id)!.permissions.availableCommands;
        const allows = (type: GameCommandType) =>
          hints.some((hint) => hint.command === type && hint.enabled);
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
      expect(
        command,
        `${state.turnCount}/${state.currentPhase}/${state.currentSubPhase}`
      ).toBeDefined();
      execute(session, command!);
    }
    expect(rounds).toEqual([1, 3, 5]);
    expect(
      session
        .getPublicEventsSince(0)
        .filter((event) => event.type === 'HextechSelectionStarted')
        .map((event) => event.turn)
    ).toEqual([1, 3, 5]);
    expect(session.state!.turnCount).toBe(6);
    expect(session.state!.hextech!.owned).toHaveLength(6);
    expect(new Set(session.state!.hextech!.owned.map((entry) => entry.instanceId)).size).toBe(6);
  });

  it('新回合自动选择先于活跃恢复，两位玩家同时可选，选择期间可认输', () => {
    const { session } = setup();
    execute(session, choose(session, 'p1', 0));
    execute(session, choose(session, 'p2', 0));
    const game = session.state!;
    const energyId = game.players[1].energyZone.cardIds[0];
    const before = {
      ...game,
      turnCount: 2,
      firstPlayerIndex: 1,
      currentPhase: GamePhase.LIVE_RESULT_PHASE,
      currentSubPhase: SubPhase.RESULT_SETTLEMENT,
      players: game.players.map((player, index) =>
        index !== 1
          ? player
          : {
              ...player,
              energyZone: {
                ...player.energyZone,
                cardStates: new Map(player.energyZone.cardStates).set(energyId, {
                  ...player.energyZone.cardStates.get(energyId)!,
                  orientation: OrientationState.WAIT,
                }),
              },
            }
      ),
    };
    const pending = new GameService().advancePhase(before).gameState;
    session.restoreRuntimeState({ authorityState: pending, currentPublicSeq: 0 });
    expect(session.state!.turnCount).toBe(3);
    expect(session.state!.players[1].energyZone.cardStates.get(energyId)!.orientation).toBe(
      OrientationState.WAIT
    );
    const pendingCommand = choose(session, 'p2', 0);
    execute(session, choose(session, 'p1', 0));
    expect(session.state!.players[1].energyZone.cardStates.get(energyId)!.orientation).toBe(
      OrientationState.WAIT
    );
    execute(session, createSurrenderCommand('p1'));
    expect(session.state!.isEnded).toBe(true);
    expect(session.getPlayerViewState('p2')!.match.hextech!.selection).toBeUndefined();
    expect(session.executeCommand(pendingCommand).success).toBe(false);
  });
});
