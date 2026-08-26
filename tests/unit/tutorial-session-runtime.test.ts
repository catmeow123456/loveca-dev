import { describe, expect, it } from 'vitest';
import {
  createEndPhaseCommand,
  createMulliganCommand,
  GameCommandType,
} from '../../src/application/game-commands';
import { createGameSession } from '../../src/application/game-session';
import type { DeckConfig } from '../../src/application/game-service';
import type {
  AnyCardData,
  EnergyCardData,
  LiveCardData,
  MemberCardData,
} from '../../src/domain/entities/card';
import { createHeartIcon, createHeartRequirement } from '../../src/domain/entities/card';
import { getCardById } from '../../src/domain/entities/game';
import {
  TutorialSessionService,
  TutorialSessionServiceError,
  type TutorialRuntimeScenarioDefinition,
} from '../../src/server/services/tutorial-session-service';
import { DecisionTapeRandomSource } from '../../src/shared/random-source';
import { CardType, GamePhase, HeartColor } from '../../src/shared/types/enums';
import { TUTORIAL_CHECKPOINT_IDS } from '../../src/online/tutorial-types';

const MAIN_DECK_SIZE = 12;
const PLAYER_MULLIGAN_CODE = 'TUTORIAL-PLAYER-MULLIGAN';
const PLAYER_MEMBER_CODE = 'TUTORIAL-PLAYER-MEMBER';
const PLAYER_LIVE_CODE = 'TUTORIAL-PLAYER-LIVE';
const OPPONENT_HIDDEN_CODE = 'TUTORIAL-OPPONENT-HIDDEN';

function member(cardCode: string, cost = 0): MemberCardData {
  return {
    cardCode,
    name: cardCode,
    cardType: CardType.MEMBER,
    cost,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.PINK, 1)],
  };
}

function live(cardCode: string): LiveCardData {
  return {
    cardCode,
    name: cardCode,
    cardType: CardType.LIVE,
    score: 1,
    requirements: createHeartRequirement({
      [HeartColor.PINK]: 1,
    } as Record<HeartColor, number>),
  };
}

function energy(cardCode: string): EnergyCardData {
  return {
    cardCode,
    name: cardCode,
    cardType: CardType.ENERGY,
  };
}

function tutorialDeck(prefix: string, firstCards: readonly AnyCardData[]): DeckConfig {
  const fillerCount = MAIN_DECK_SIZE - firstCards.length;
  return {
    mainDeck: [
      ...firstCards,
      ...Array.from({ length: fillerCount }, (_, index) => member(`${prefix}-FILLER-${index}`)),
    ],
    energyDeck: Array.from({ length: 6 }, (_, index) => energy(`${prefix}-ENERGY-${index}`)),
  };
}

function noOpShuffleDecisions(deckSize: number): number[] {
  return Array.from({ length: deckSize - 1 }, (_, index) => deckSize - 1 - index);
}

function tutorialDecisionTape(): readonly number[] {
  const initialShuffle = noOpShuffleDecisions(MAIN_DECK_SIZE);
  return [
    ...initialShuffle,
    ...initialShuffle,
    ...initialShuffle,
    ...initialShuffle,
    ...noOpShuffleDecisions(MAIN_DECK_SIZE - 6),
  ];
}

function buildDecks(): { playerDeck: DeckConfig; opponentDeck: DeckConfig } {
  return {
    playerDeck: tutorialDeck('PLAYER', [
      member(PLAYER_MULLIGAN_CODE),
      member(PLAYER_MEMBER_CODE),
      live(PLAYER_LIVE_CODE),
    ]),
    opponentDeck: tutorialDeck('OPPONENT', [member(OPPONENT_HIDDEN_CODE)]),
  };
}

function buildScenario(): TutorialRuntimeScenarioDefinition {
  const { playerDeck, opponentDeck } = buildDecks();
  return {
    id: 'runtime-foundation',
    version: '1.0.0',
    playerName: '教程玩家',
    opponentName: '教程对手',
    playerDeck,
    opponentDeck,
    randomTape: {
      version: 'runtime-foundation-rng-v1',
      decisions: tutorialDecisionTape(),
    },
    checkpoints: [
      {
        id: TUTORIAL_CHECKPOINT_IDS.FOUNDATIONS,
        entryStepId: 'welcome',
      },
    ],
    objectRoles: {
      'opening-mulligan-card': {
        ownerSeat: 'FIRST',
        cardCode: PLAYER_MULLIGAN_CODE,
      },
      'tutorial-member-card': {
        ownerSeat: 'FIRST',
        cardCode: PLAYER_MEMBER_CODE,
      },
      'tutorial-live-card': {
        ownerSeat: 'FIRST',
        cardCode: PLAYER_LIVE_CODE,
      },
      'opponent-private-probe': {
        ownerSeat: 'SECOND',
        cardCode: OPPONENT_HIDDEN_CODE,
      },
    },
    validateInitialState: (context) => {
      const player = context.state.players[0];
      const requiredPlayerRoles = [
        context.roleCardIds['opening-mulligan-card'],
        context.roleCardIds['tutorial-member-card'],
        context.roleCardIds['tutorial-live-card'],
      ];
      return requiredPlayerRoles.every((cardId) => player.hand.cardIds.includes(cardId))
        ? null
        : '教程关键卡牌没有进入预期起手';
    },
    validatePlayerCommand: (context, command) => {
      const mulliganCardId = context.roleCardIds['opening-mulligan-card'];
      if (
        command.type === GameCommandType.MULLIGAN &&
        command.cardIdsToMulligan.length === 1 &&
        command.cardIdsToMulligan[0] === mulliganCardId
      ) {
        return null;
      }
      return '请先换掉教程指定的卡牌';
    },
    scriptActions: [
      {
        id: 'opponent-mulligan',
        isReady: (context) => context.state.mulliganCompletedPlayers.includes(context.playerId),
        isComplete: (context) => context.state.currentPhase !== GamePhase.MULLIGAN_PHASE,
        createCommand: (context) => createMulliganCommand(context.opponentId, []),
      },
    ],
  };
}

function cardCodesInZone(
  session: ReturnType<typeof createGameSession>,
  cardIds: readonly string[]
): readonly string[] {
  const state = session.state;
  if (!state) return [];
  return cardIds.map((cardId) => getCardById(state, cardId)?.data.cardCode ?? 'missing');
}

function expectTutorialServiceError(operation: () => unknown, code: string): void {
  try {
    operation();
  } catch (error) {
    expect(error).toBeInstanceOf(TutorialSessionServiceError);
    expect((error as TutorialSessionServiceError).code).toBe(code);
    return;
  }
  throw new Error(`预期教程服务错误但操作成功: ${code}`);
}

describe('教程确定性随机边界', () => {
  it('同一决策带应跨开局和换牌洗牌产生相同结果', () => {
    const { playerDeck, opponentDeck } = buildDecks();
    const run = () => {
      const randomSource = new DecisionTapeRandomSource('deterministic-v1', tutorialDecisionTape());
      const session = createGameSession({ randomInt: randomSource.nextInt });
      session.createGame('deterministic-game', 'player', '玩家', 'opponent', '对手');
      const initialized = session.initializeGame(playerDeck, opponentDeck);
      expect(initialized.success).toBe(true);

      const openingHand = session.state?.players[0].hand.cardIds ?? [];
      const mulliganResult = session.executeCommand(
        createMulliganCommand('player', [openingHand[0]])
      );
      expect(mulliganResult.success).toBe(true);

      const player = session.state?.players[0];
      expect(player).toBeDefined();
      return {
        hand: cardCodesInZone(session, player?.hand.cardIds ?? []),
        mainDeck: cardCodesInZone(session, player?.mainDeck.cardIds ?? []),
        random: randomSource.snapshot(),
      };
    };

    expect(run()).toEqual(run());
  });

  it('决策带耗尽时应失败，不能回退到生产随机', () => {
    const randomSource = new DecisionTapeRandomSource('short-v1', [3]);
    expect(randomSource.nextInt(4)).toBe(3);
    expect(() => randomSource.nextInt(2)).toThrow('随机决策带已耗尽');
  });
});

describe('教程临时会话运行时', () => {
  it('只返回玩家投影与公开角色绑定，并把玩家回执和脚本命令隔离', () => {
    let now = 1_000;
    const service = new TutorialSessionService({
      scenarios: [buildScenario()],
      idGenerator: () => 'run-1',
      now: () => now,
      idleTtlMs: 5_000,
    });

    const initial = service.createSession({
      participantKey: 'guest-1',
      scenarioId: 'runtime-foundation',
      scenarioVersion: '1.0.0',
      checkpointId: TUTORIAL_CHECKPOINT_IDS.FOUNDATIONS,
    });
    expect(initial.playerViewState.match.phase).toBe(GamePhase.MULLIGAN_PHASE);
    expect(initial.objectBindings).toEqual({
      'opening-mulligan-card': 'obj_tutorial:run-1:player-main-0',
      'tutorial-member-card': 'obj_tutorial:run-1:player-main-1',
      'tutorial-live-card': 'obj_tutorial:run-1:player-main-2',
    });
    expect(initial.acceptedCommands).toEqual([]);
    const publicPayload = JSON.stringify(initial);
    expect(publicPayload).not.toContain(OPPONENT_HIDDEN_CODE);
    expect(publicPayload).not.toContain('runtime-foundation-rng-v1');
    expect(publicPayload).not.toContain('opponent-mulligan');

    const mulliganCardId = initial.objectBindings['opening-mulligan-card']?.replace(/^obj_/, '');
    expect(mulliganCardId).toBeDefined();
    const playerResult = service.executePlayerCommand({
      runId: initial.runId,
      participantKey: 'guest-1',
      expectedSeq: initial.playerViewState.match.seq,
      command: createMulliganCommand('untrusted-player-id', [mulliganCardId as string]),
    });
    expect(playerResult.snapshot.acceptedCommands).toHaveLength(1);
    expect(playerResult.snapshot.acceptedCommands[0]).toMatchObject({
      actorSeat: 'FIRST',
      command: {
        type: GameCommandType.MULLIGAN,
        playerId: 'tutorial:run-1:player',
        cardIdsToMulligan: [mulliganCardId],
      },
    });

    const scriptResult = service.advanceScript({
      runId: initial.runId,
      participantKey: 'guest-1',
      expectedSeq: playerResult.snapshot.playerViewState.match.seq,
    });
    expect(scriptResult.advanced).toBe(true);
    expect(scriptResult.snapshot.acceptedCommands).toHaveLength(1);
    expect(scriptResult.snapshot.playerViewState.match.phase).toBe(GamePhase.MAIN_PHASE);

    const retry = service.advanceScript({
      runId: initial.runId,
      participantKey: 'guest-1',
      expectedSeq: scriptResult.snapshot.playerViewState.match.seq,
    });
    expect(retry.advanced).toBe(false);
    expect(retry.snapshot.acceptedCommands).toHaveLength(1);

    now += 1_000;
    expect(service.getSnapshot(initial.runId, 'guest-1').expiresAt).toBe(7_000);
  });

  it('应在教程门禁、参与者和 revision 边界拒绝无关请求', () => {
    const service = new TutorialSessionService({
      scenarios: [buildScenario()],
      idGenerator: () => 'run-2',
    });
    const initial = service.createSession({
      participantKey: 'guest-2',
      scenarioId: 'runtime-foundation',
      scenarioVersion: '1.0.0',
      checkpointId: TUTORIAL_CHECKPOINT_IDS.FOUNDATIONS,
    });

    expectTutorialServiceError(
      () => service.getSnapshot(initial.runId, 'other-guest'),
      'TUTORIAL_SESSION_NOT_FOUND'
    );
    expectTutorialServiceError(
      () =>
        service.executePlayerCommand({
          runId: initial.runId,
          participantKey: 'guest-2',
          expectedSeq: initial.playerViewState.match.seq,
          command: createEndPhaseCommand('guest-2'),
        }),
      'TUTORIAL_COMMAND_NOT_ALLOWED'
    );
    expectTutorialServiceError(
      () =>
        service.advanceScript({
          runId: initial.runId,
          participantKey: 'guest-2',
          expectedSeq: initial.playerViewState.match.seq - 1,
        }),
      'TUTORIAL_REVISION_CONFLICT'
    );
  });

  it('应在 revision 校验前无副作用恢复已接受的玩家幂等命令', () => {
    const service = new TutorialSessionService({
      scenarios: [buildScenario()],
      idGenerator: () => 'run-idempotent',
    });
    const initial = service.createSession({
      participantKey: 'guest-idempotent',
      scenarioId: 'runtime-foundation',
      scenarioVersion: '1.0.0',
      checkpointId: TUTORIAL_CHECKPOINT_IDS.FOUNDATIONS,
    });
    const mulliganCardId = initial.objectBindings['opening-mulligan-card']?.replace(/^obj_/, '');
    expect(mulliganCardId).toBeDefined();
    const command = {
      ...createMulliganCommand('untrusted-player-id', [mulliganCardId as string]),
      idempotencyKey: 'cmd:tutorial-retry',
    };

    const first = service.executePlayerCommand({
      runId: initial.runId,
      participantKey: 'guest-idempotent',
      expectedSeq: initial.playerViewState.match.seq,
      command,
    });
    const firstResultSeq = first.snapshot.playerViewState.match.seq;
    expect(first.snapshot.acceptedCommands).toHaveLength(1);
    const sessionRecord = (
      service as unknown as {
        readonly sessions: ReadonlyMap<
          string,
          { readonly session: ReturnType<typeof createGameSession> }
        >;
      }
    ).sessions.get(initial.runId);
    expect(sessionRecord).toBeDefined();
    const runtimeBeforeRetry = sessionRecord?.session.getRuntimeStats();

    const retry = service.executePlayerCommand({
      runId: initial.runId,
      participantKey: 'guest-idempotent',
      expectedSeq: initial.playerViewState.match.seq,
      command: { ...command, timestamp: command.timestamp + 1 },
    });
    expect(retry.snapshot.playerViewState.match.seq).toBe(firstResultSeq);
    expect(retry.snapshot.acceptedCommands).toHaveLength(1);
    expect(sessionRecord?.session.getRuntimeStats()).toMatchObject({
      commandLogCount: runtimeBeforeRetry?.commandLogCount,
      sealedAuditRecordCount: runtimeBeforeRetry?.sealedAuditRecordCount,
      currentCommandSeq: runtimeBeforeRetry?.currentCommandSeq,
      currentAuditSeq: runtimeBeforeRetry?.currentAuditSeq,
    });

    expectTutorialServiceError(
      () =>
        service.executePlayerCommand({
          runId: initial.runId,
          participantKey: 'guest-idempotent',
          expectedSeq: initial.playerViewState.match.seq,
          command: { ...command, cardIdsToMulligan: [] },
        }),
      'TUTORIAL_IDEMPOTENCY_CONFLICT'
    );
    expectTutorialServiceError(
      () =>
        service.executePlayerCommand({
          runId: initial.runId,
          participantKey: 'guest-idempotent',
          expectedSeq: firstResultSeq,
          command: { ...command, idempotencyKey: 'x'.repeat(129) },
        }),
      'TUTORIAL_INVALID_INPUT'
    );
  });

  it('应按空闲 TTL 回收临时会话', () => {
    let now = 5_000;
    const service = new TutorialSessionService({
      scenarios: [buildScenario()],
      idGenerator: () => 'run-ttl',
      now: () => now,
      idleTtlMs: 1_000,
    });
    const initial = service.createSession({
      participantKey: 'guest-ttl',
      scenarioId: 'runtime-foundation',
      scenarioVersion: '1.0.0',
      checkpointId: TUTORIAL_CHECKPOINT_IDS.FOUNDATIONS,
    });

    now = 6_000;
    expect(service.cleanupExpiredSessions()).toBe(1);
    expectTutorialServiceError(
      () => service.getSnapshot(initial.runId, 'guest-ttl'),
      'TUTORIAL_SESSION_NOT_FOUND'
    );
  });

  it('应在创建前回收过期会话并限制全局容量', () => {
    let now = 10_000;
    const runIds = ['run-capacity-1', 'run-capacity-2'];
    const service = new TutorialSessionService({
      scenarios: [buildScenario()],
      idGenerator: () => runIds.shift() ?? 'unexpected-run',
      now: () => now,
      idleTtlMs: 1_000,
      maxSessions: 1,
    });
    const create = (participantKey: string) =>
      service.createSession({
        participantKey,
        scenarioId: 'runtime-foundation',
        scenarioVersion: '1.0.0',
        checkpointId: TUTORIAL_CHECKPOINT_IDS.FOUNDATIONS,
      });

    expect(create('guest-capacity-1').runId).toBe('run-capacity-1');
    expectTutorialServiceError(() => create('guest-capacity-blocked'), 'TUTORIAL_CAPACITY_REACHED');

    now = 11_000;
    expect(create('guest-capacity-2').runId).toBe('run-capacity-2');
  });
});
