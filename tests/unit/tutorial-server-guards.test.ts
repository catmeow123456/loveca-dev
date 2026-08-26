import { describe, expect, it } from 'vitest';
import {
  createMulliganCommand,
  createSubmitJudgmentCommand,
  GameCommandType,
} from '../../src/application/game-commands';
import { toTransport } from '../../src/online/serde';
import { SlotPosition, SubPhase } from '../../src/shared/types/enums';
import { parseTutorialGameCommand } from '../../src/server/services/tutorial-command-validation';
import {
  TutorialAdmissionController,
  TutorialMutationRateLimiter,
} from '../../src/server/services/tutorial-request-limits';
import { createRetryableSingletonLoader } from '../../src/server/services/tutorial-runtime-service';
import { TutorialSessionServiceError } from '../../src/server/services/tutorial-session-service';

function expectTutorialError(operation: () => unknown, code: string): void {
  try {
    operation();
  } catch (error) {
    expect(error).toBeInstanceOf(TutorialSessionServiceError);
    expect((error as TutorialSessionServiceError).code).toBe(code);
    return;
  }
  throw new Error(`预期教程服务错误但操作成功: ${code}`);
}

describe('教程 HTTP 输入边界', () => {
  it('应接受当前教程流程使用的完整命令类型集合', () => {
    const base = { playerId: 'player', timestamp: 1 } as const;
    const commands = [
      { ...base, type: GameCommandType.MULLIGAN, cardIdsToMulligan: ['card-1'] },
      {
        ...base,
        type: GameCommandType.PLAY_MEMBER_TO_SLOT,
        cardId: 'card-1',
        targetSlot: SlotPosition.CENTER,
      },
      { ...base, type: GameCommandType.END_PHASE },
      { ...base, type: GameCommandType.SET_LIVE_CARD, cardId: 'live-1', faceDown: true },
      { ...base, type: GameCommandType.CONFIRM_STEP, subPhase: SubPhase.RESULT_SETTLEMENT },
      {
        ...base,
        type: GameCommandType.SUBMIT_JUDGMENT,
        judgmentResults: new Map([['live-1', true]]),
      },
      { ...base, type: GameCommandType.SUBMIT_SCORE, adjustedScore: 2 },
      { ...base, type: GameCommandType.SELECT_SUCCESS_LIVE, cardId: 'live-1' },
      {
        ...base,
        type: GameCommandType.ACTIVATE_ABILITY,
        cardId: 'member-1',
        abilityId: 'ability-1',
      },
      { ...base, type: GameCommandType.CONFIRM_EFFECT_STEP, effectId: 'effect-1' },
    ];

    expect(commands.map((command) => parseTutorialGameCommand(toTransport(command)).type)).toEqual(
      commands.map((command) => command.type)
    );
  });

  it('应恢复合法 transport Map 并拒绝缺字段、额外字段和过长幂等键', () => {
    const validJudgment = createSubmitJudgmentCommand('player', new Map([['live-1', true]]));
    const parsed = parseTutorialGameCommand(toTransport(validJudgment));
    expect(parsed).toMatchObject({ type: validJudgment.type, playerId: 'player' });
    expect(parsed.type === validJudgment.type ? parsed.judgmentResults : new Map()).toEqual(
      new Map([['live-1', true]])
    );

    expectTutorialError(
      () => parseTutorialGameCommand({ type: 'MULLIGAN', playerId: 'player', timestamp: 1 }),
      'TUTORIAL_INVALID_INPUT'
    );
    expectTutorialError(
      () =>
        parseTutorialGameCommand({
          ...createMulliganCommand('player', ['card-1']),
          unexpected: true,
        }),
      'TUTORIAL_INVALID_INPUT'
    );
    expectTutorialError(
      () =>
        parseTutorialGameCommand({
          ...createMulliganCommand('player', ['card-1']),
          idempotencyKey: 'x'.repeat(129),
        }),
      'TUTORIAL_INVALID_INPUT'
    );
  });
});

describe('教程请求限制', () => {
  it('应把尚未完成的创建预占计入并发上限并在取消后释放', () => {
    const controller = new TutorialAdmissionController({
      createWindowMs: 1_000,
      maxCreatesPerWindow: 10,
      maxActiveSessionsPerIp: 2,
    });
    const first = controller.reserve('127.0.0.1', 1_000);
    const second = controller.reserve('127.0.0.1', 1_000);
    expectTutorialError(
      () => controller.reserve('127.0.0.1', 1_000),
      'TUTORIAL_ACTIVE_SESSION_LIMIT'
    );

    controller.cancel(second);
    const replacement = controller.reserve('127.0.0.1', 1_000);
    controller.commit(first, 'run-1', 2_000);
    controller.commit(replacement, 'run-2', 2_000);
    expectTutorialError(
      () => controller.reserve('127.0.0.1', 1_000),
      'TUTORIAL_ACTIVE_SESSION_LIMIT'
    );
  });

  it('应同时限制单 run 和单 IP 的变更请求', () => {
    const perRun = new TutorialMutationRateLimiter({
      windowMs: 1_000,
      maxRequestsPerRun: 2,
      maxRequestsPerIp: 10,
    });
    perRun.consume('ip-1', 'run-1', 1_000);
    perRun.consume('ip-1', 'run-1', 1_000);
    expectTutorialError(
      () => perRun.consume('ip-1', 'run-1', 1_000),
      'TUTORIAL_REQUEST_RATE_LIMITED'
    );

    const perIp = new TutorialMutationRateLimiter({
      windowMs: 1_000,
      maxRequestsPerRun: 10,
      maxRequestsPerIp: 2,
    });
    perIp.consume('ip-1', 'run-1', 1_000);
    perIp.consume('ip-1', 'run-2', 1_000);
    expectTutorialError(
      () => perIp.consume('ip-1', 'run-3', 1_000),
      'TUTORIAL_REQUEST_RATE_LIMITED'
    );
    expect(() => perIp.consume('ip-1', 'run-3', 2_000)).not.toThrow();
  });
});

describe('教程运行时单例加载', () => {
  it('应在首次 Promise 失败后清空缓存并允许重试', async () => {
    let attempts = 0;
    const load = createRetryableSingletonLoader(() => {
      attempts += 1;
      if (attempts === 1) return Promise.reject(new Error('temporary failure'));
      return Promise.resolve({ ready: true });
    });

    await expect(load()).rejects.toThrow('temporary failure');
    await expect(load()).resolves.toEqual({ ready: true });
    await expect(load()).resolves.toEqual({ ready: true });
    expect(attempts).toBe(2);
  });
});
