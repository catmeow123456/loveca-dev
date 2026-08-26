import { randomUUID } from 'node:crypto';
import type { GameCommand } from '../../application/game-commands.js';
import { createGameSession, type GameSession } from '../../application/game-session.js';
import type { DeckConfig } from '../../application/game-service.js';
import type { GameState } from '../../domain/entities/game.js';
import type {
  TutorialAcceptedCommandReceipt,
  TutorialCheckpointId,
  TutorialCommandResult,
  TutorialObjectBindings,
  TutorialScriptAdvanceResult,
  TutorialSessionSnapshot,
  TutorialSessionStatus,
} from '../../online/tutorial-types.js';
import { createPublicObjectId } from '../../online/projector.js';
import { toTransport } from '../../online/serde.js';
import type { PlayerViewState, Seat } from '../../online/types.js';
import { DecisionTapeRandomSource } from '../../shared/random-source.js';
import { GameMode } from '../../shared/types/enums.js';

const DEFAULT_IDLE_TTL_MS = 30 * 60 * 1000;
const DEFAULT_MAX_SESSIONS = 256;
const MAX_ACCEPTED_COMMAND_RECEIPTS = 64;
const MAX_PLAYER_IDEMPOTENCY_RECEIPTS = 64;
const MAX_PLAYER_COMMAND_ATTEMPTS = 256;
export const MAX_TUTORIAL_IDEMPOTENCY_KEY_LENGTH = 128;

export interface TutorialRoleBindingDefinition {
  readonly ownerSeat: Seat;
  readonly cardCode: string;
  /** 同一席位、同编号卡牌按实例 ID 排序后的序号。 */
  readonly occurrence?: number;
}

export interface TutorialScenarioContext {
  readonly runId: string;
  readonly state: GameState;
  readonly playerId: string;
  readonly opponentId: string;
  /** 仅存在于服务端的原始卡牌实例 ID。 */
  readonly roleCardIds: Readonly<Record<string, string>>;
}

export interface TutorialScriptActionDefinition {
  readonly id: string;
  /** 默认由脚本对手执行；FIRST 仅用于没有选择/费用的系统自动确认窗口。 */
  readonly actorSeat?: Seat;
  /** 已满足时视为幂等完成，不再重复提交命令。 */
  readonly isComplete: (context: TutorialScenarioContext) => boolean;
  /** 只有公开流程到达预定窗口后才允许执行。 */
  readonly isReady: (context: TutorialScenarioContext) => boolean;
  /** 返回正式 GameCommand；playerId、timestamp 与 idempotencyKey 会由服务端覆盖。 */
  readonly createCommand: (context: TutorialScenarioContext) => GameCommand;
}

export interface TutorialCheckpointBootstrapController {
  /** 每次调用都返回推进后的最新权威状态。 */
  readonly getContext: () => TutorialScenarioContext;
  /** 使用正式玩家命令推进，但不把检查点准备动作记为玩家教程回执。 */
  readonly executePlayerCommand: (command: GameCommand) => void;
  /** 连续执行当前已经满足前置条件的脚本命令，直到再次等待玩家。 */
  readonly advanceScriptUntilBlocked: () => void;
}

export interface TutorialCheckpointDefinition {
  readonly id: TutorialCheckpointId;
  readonly entryStepId: string;
  readonly bootstrap?: (controller: TutorialCheckpointBootstrapController) => void;
  readonly validateState?: (context: TutorialScenarioContext) => string | null;
}

/**
 * 服务端私密教程场景。
 *
 * 该对象不得进入 transport；卡组、决策带和脚本动作只在受信任服务端使用。
 */
export interface TutorialRuntimeScenarioDefinition {
  readonly id: string;
  readonly version: string;
  readonly playerName: string;
  readonly opponentName: string;
  readonly playerDeck: DeckConfig;
  readonly opponentDeck: DeckConfig;
  readonly randomTape: {
    readonly version: string;
    readonly decisions: readonly number[];
  };
  readonly checkpoints: readonly TutorialCheckpointDefinition[];
  readonly objectRoles: Readonly<Record<string, TutorialRoleBindingDefinition>>;
  readonly validateInitialState?: (context: TutorialScenarioContext) => string | null;
  /** 教学聚焦门禁；通过后仍由 GameSession 执行完整规则校验。 */
  readonly validatePlayerCommand: (
    context: TutorialScenarioContext,
    command: GameCommand
  ) => string | null;
  readonly scriptActions: readonly TutorialScriptActionDefinition[];
  readonly isComplete?: (context: TutorialScenarioContext) => boolean;
}

interface TutorialSessionRecord {
  readonly runId: string;
  readonly participantKey: string;
  readonly scenario: TutorialRuntimeScenarioDefinition;
  readonly checkpoint: TutorialCheckpointDefinition;
  readonly session: GameSession;
  readonly playerId: string;
  readonly opponentId: string;
  readonly roleCardIds: Readonly<Record<string, string>>;
  readonly completedScriptActionIds: Set<string>;
  readonly playerIdempotencyReceipts: Map<string, string>;
  playerCommandAttemptCount: number;
  status: TutorialSessionStatus;
  publicError?: string;
  expiresAt: number;
}

export interface TutorialSessionServiceDeps {
  readonly scenarios: readonly TutorialRuntimeScenarioDefinition[];
  readonly now?: () => number;
  readonly idGenerator?: () => string;
  readonly idleTtlMs?: number;
  readonly maxSessions?: number;
}

export interface CreateTutorialSessionInput {
  readonly participantKey: string;
  readonly scenarioId: string;
  readonly scenarioVersion: string;
  readonly checkpointId: TutorialCheckpointId;
}

export interface ExecuteTutorialCommandInput {
  readonly runId: string;
  readonly participantKey: string;
  readonly expectedSeq: number;
  readonly command: GameCommand;
}

export interface AdvanceTutorialScriptInput {
  readonly runId: string;
  readonly participantKey: string;
  readonly expectedSeq: number;
}

export class TutorialSessionServiceError extends Error {
  readonly code: string;
  readonly statusCode: number;

  constructor(code: string, message: string, statusCode = 400) {
    super(message);
    this.name = 'TutorialSessionServiceError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

/**
 * 不写正式对局记录的临时教程会话服务。
 *
 * 脚本每次最多推进一个正式命令，让客户端有机会按权威快照播放可理解的动作反馈。
 */
export class TutorialSessionService {
  private readonly scenarios = new Map<string, TutorialRuntimeScenarioDefinition>();
  private readonly sessions = new Map<string, TutorialSessionRecord>();
  private readonly now: () => number;
  private readonly idGenerator: () => string;
  private readonly idleTtlMs: number;
  private readonly maxSessions: number;

  constructor(deps: TutorialSessionServiceDeps) {
    this.now = deps.now ?? (() => Date.now());
    this.idGenerator = deps.idGenerator ?? randomUUID;
    this.idleTtlMs = deps.idleTtlMs ?? DEFAULT_IDLE_TTL_MS;
    this.maxSessions = deps.maxSessions ?? DEFAULT_MAX_SESSIONS;
    if (!Number.isSafeInteger(this.idleTtlMs) || this.idleTtlMs <= 0) {
      throw new Error('教程会话空闲 TTL 必须是正安全整数');
    }
    if (!Number.isSafeInteger(this.maxSessions) || this.maxSessions <= 0) {
      throw new Error('教程会话全局容量必须是正安全整数');
    }

    for (const scenario of deps.scenarios) {
      validateScenarioDefinition(scenario);
      const key = scenarioKey(scenario.id, scenario.version);
      if (this.scenarios.has(key)) {
        throw new Error(`教程场景重复注册: ${key}`);
      }
      this.scenarios.set(key, scenario);
    }
  }

  createSession(input: CreateTutorialSessionInput): TutorialSessionSnapshot {
    this.cleanupExpiredSessions();
    if (this.sessions.size >= this.maxSessions) {
      throw new TutorialSessionServiceError(
        'TUTORIAL_CAPACITY_REACHED',
        '当前教程使用人数较多，请稍后再试',
        503
      );
    }

    const participantKey = normalizeRequired(input.participantKey, '教程参与者标识');
    const scenario = this.scenarios.get(scenarioKey(input.scenarioId, input.scenarioVersion));
    if (!scenario) {
      throw new TutorialSessionServiceError(
        'TUTORIAL_SCENARIO_NOT_FOUND',
        '指定的教程版本不存在',
        404
      );
    }
    const checkpoint = scenario.checkpoints.find(
      (candidate) => candidate.id === input.checkpointId
    );
    if (!checkpoint) {
      throw new TutorialSessionServiceError(
        'TUTORIAL_CHECKPOINT_NOT_FOUND',
        '指定的教程章节不存在',
        404
      );
    }

    const runId = this.idGenerator();
    const playerId = `tutorial:${runId}:player`;
    const opponentId = `tutorial:${runId}:opponent`;
    const randomSource = new DecisionTapeRandomSource(
      scenario.randomTape.version,
      scenario.randomTape.decisions
    );
    const session = createGameSession({
      gameMode: GameMode.DEBUG,
      now: this.now,
      randomInt: randomSource.nextInt,
    });
    session.createGame(
      `tutorial:${runId}`,
      playerId,
      scenario.playerName,
      opponentId,
      scenario.opponentName
    );

    let initialized;
    try {
      initialized = session.initializeGame(scenario.playerDeck, scenario.opponentDeck);
    } catch {
      throw new TutorialSessionServiceError(
        'TUTORIAL_SCENARIO_RANDOM_TAPE_INVALID',
        '教程场景的确定性随机决策不足或无效',
        500
      );
    }
    if (!initialized.success || !session.state) {
      throw new TutorialSessionServiceError(
        'TUTORIAL_SCENARIO_INITIALIZATION_FAILED',
        '教程场景初始化失败',
        500
      );
    }

    const roleCardIds = resolveRoleCardIds(session.state, scenario.objectRoles);
    const record: TutorialSessionRecord = {
      runId,
      participantKey,
      scenario,
      checkpoint,
      session,
      playerId,
      opponentId,
      roleCardIds,
      completedScriptActionIds: new Set(),
      playerIdempotencyReceipts: new Map(),
      playerCommandAttemptCount: 0,
      status: 'ACTIVE',
      expiresAt: this.now() + this.idleTtlMs,
    };

    const initialError = scenario.validateInitialState?.(createScenarioContext(record)) ?? null;
    if (initialError) {
      throw new TutorialSessionServiceError(
        'TUTORIAL_SCENARIO_MILESTONE_MISMATCH',
        initialError,
        500
      );
    }

    try {
      checkpoint.bootstrap?.({
        getContext: () => createScenarioContext(record),
        executePlayerCommand: (command) => this.executeCheckpointPlayerCommand(record, command),
        advanceScriptUntilBlocked: () => this.advanceCheckpointScript(record),
      });
    } catch (error) {
      if (error instanceof TutorialSessionServiceError) throw error;
      throw new TutorialSessionServiceError(
        'TUTORIAL_CHECKPOINT_BOOTSTRAP_FAILED',
        '教程章节准备失败，请重新选择章节',
        500
      );
    }

    const checkpointError = checkpoint.validateState?.(createScenarioContext(record)) ?? null;
    if (checkpointError) {
      throw new TutorialSessionServiceError(
        'TUTORIAL_CHECKPOINT_MILESTONE_MISMATCH',
        checkpointError,
        500
      );
    }

    this.updateCompletionStatus(record);
    this.sessions.set(runId, record);
    return this.buildSnapshot(record);
  }

  getSnapshot(runId: string, participantKey: string): TutorialSessionSnapshot {
    const record = this.getAuthorizedRecord(runId, participantKey);
    this.touch(record);
    return this.buildSnapshot(record);
  }

  executePlayerCommand(input: ExecuteTutorialCommandInput): TutorialCommandResult {
    const record = this.getAuthorizedRecord(input.runId, input.participantKey);
    const command = {
      ...input.command,
      playerId: record.playerId,
    } as GameCommand;
    const idempotencyKey = this.validatePlayerIdempotencyKey(record, command.idempotencyKey);
    const comparablePayload = createComparableTutorialCommandPayload(command);
    if (idempotencyKey) {
      const existingPayload = record.playerIdempotencyReceipts.get(idempotencyKey);
      if (existingPayload !== undefined) {
        if (existingPayload !== comparablePayload) {
          throw new TutorialSessionServiceError(
            'TUTORIAL_IDEMPOTENCY_CONFLICT',
            '同一幂等键对应的教程命令不一致',
            409
          );
        }
        this.touch(record);
        return { success: true, snapshot: this.buildSnapshot(record) };
      }
    }

    this.assertActiveRecord(record);
    this.assertExpectedSeq(record, input.expectedSeq);
    this.consumePlayerCommandAttempt(record);

    const blockedReason = record.scenario.validatePlayerCommand(
      createScenarioContext(record),
      command
    );
    if (blockedReason) {
      throw new TutorialSessionServiceError('TUTORIAL_COMMAND_NOT_ALLOWED', blockedReason, 409);
    }

    const result = record.session.executeCommand(command);
    if (!result.success) {
      throw new TutorialSessionServiceError(
        'TUTORIAL_COMMAND_REJECTED',
        result.error ?? '当前操作未通过规则校验',
        409
      );
    }

    if (idempotencyKey) {
      rememberBoundedReceipt(
        record.playerIdempotencyReceipts,
        idempotencyKey,
        comparablePayload,
        MAX_PLAYER_IDEMPOTENCY_RECEIPTS
      );
    }
    this.touch(record);
    this.updateCompletionStatus(record);
    return { success: true, snapshot: this.buildSnapshot(record) };
  }

  advanceScript(input: AdvanceTutorialScriptInput): TutorialScriptAdvanceResult {
    const record = this.getAuthorizedActiveRecord(input.runId, input.participantKey);
    this.assertExpectedSeq(record, input.expectedSeq);

    const advanced = this.executeNextScriptAction(record);
    this.touch(record);
    this.updateCompletionStatus(record);
    return { success: true, advanced, snapshot: this.buildSnapshot(record) };
  }

  deleteSession(runId: string, participantKey: string): boolean {
    const record = this.getAuthorizedRecord(runId, participantKey);
    return this.sessions.delete(record.runId);
  }

  cleanupExpiredSessions(at = this.now()): number {
    let removed = 0;
    for (const [runId, record] of this.sessions) {
      if (record.expiresAt <= at) {
        this.sessions.delete(runId);
        removed += 1;
      }
    }
    return removed;
  }

  private getAuthorizedRecord(runId: string, participantKey: string): TutorialSessionRecord {
    const normalizedRunId = runId.trim();
    const record = this.sessions.get(normalizedRunId);
    if (record && record.expiresAt <= this.now()) {
      this.sessions.delete(normalizedRunId);
    }
    if (!record || record.expiresAt <= this.now() || record.participantKey !== participantKey) {
      throw new TutorialSessionServiceError(
        'TUTORIAL_SESSION_NOT_FOUND',
        '教程会话不存在或已过期',
        404
      );
    }
    return record;
  }

  private getAuthorizedActiveRecord(runId: string, participantKey: string): TutorialSessionRecord {
    const record = this.getAuthorizedRecord(runId, participantKey);
    this.assertActiveRecord(record);
    return record;
  }

  private assertActiveRecord(record: TutorialSessionRecord): void {
    if (record.status !== 'ACTIVE') {
      throw new TutorialSessionServiceError(
        'TUTORIAL_SESSION_NOT_ACTIVE',
        record.status === 'COMPLETED' ? '教程已经完成' : '教程运行异常，请重新开始',
        409
      );
    }
  }

  private validatePlayerIdempotencyKey(
    record: TutorialSessionRecord,
    idempotencyKey: string | undefined
  ): string | null {
    if (idempotencyKey === undefined) return null;
    if (
      typeof idempotencyKey !== 'string' ||
      idempotencyKey.length === 0 ||
      idempotencyKey.length > MAX_TUTORIAL_IDEMPOTENCY_KEY_LENGTH ||
      idempotencyKey.startsWith(`${record.runId}:`)
    ) {
      throw new TutorialSessionServiceError('TUTORIAL_INVALID_INPUT', '教程命令幂等键非法', 400);
    }
    return idempotencyKey;
  }

  private consumePlayerCommandAttempt(record: TutorialSessionRecord): void {
    if (record.playerCommandAttemptCount >= MAX_PLAYER_COMMAND_ATTEMPTS) {
      throw new TutorialSessionServiceError(
        'TUTORIAL_COMMAND_LIMIT_REACHED',
        '本次教程操作次数过多，请重新开始教程',
        429
      );
    }
    record.playerCommandAttemptCount += 1;
  }

  private assertExpectedSeq(record: TutorialSessionRecord, expectedSeq: number): void {
    const currentSeq = record.session.getCurrentPublicEventSeq();
    if (!Number.isSafeInteger(expectedSeq) || expectedSeq !== currentSeq) {
      throw new TutorialSessionServiceError(
        'TUTORIAL_REVISION_CONFLICT',
        '教程状态已经更新，请同步最新牌桌后重试',
        409
      );
    }
  }

  private touch(record: TutorialSessionRecord): void {
    record.expiresAt = this.now() + this.idleTtlMs;
  }

  private updateCompletionStatus(record: TutorialSessionRecord): void {
    if (record.status === 'ACTIVE' && record.scenario.isComplete?.(createScenarioContext(record))) {
      record.status = 'COMPLETED';
    }
  }

  private failRecord(record: TutorialSessionRecord): void {
    record.status = 'ERROR';
    record.publicError = '教程场景执行异常，请重新开始';
    this.touch(record);
  }

  private executeCheckpointPlayerCommand(
    record: TutorialSessionRecord,
    proposedCommand: GameCommand
  ): void {
    const context = createScenarioContext(record);
    const command = {
      ...proposedCommand,
      playerId: record.playerId,
      timestamp: this.now(),
      idempotencyKey: `${record.runId}:${record.scenario.version}:checkpoint:${record.checkpoint.id}:${record.session.getCommandLogSince(0).length}`,
    } as GameCommand;
    const blockedReason = record.scenario.validatePlayerCommand(context, command);
    if (blockedReason) {
      throw new TutorialSessionServiceError(
        'TUTORIAL_CHECKPOINT_COMMAND_NOT_ALLOWED',
        '教程章节准备没有到达预期操作点',
        500
      );
    }
    const result = record.session.executeCommand(command);
    if (!result.success) {
      throw new TutorialSessionServiceError(
        'TUTORIAL_CHECKPOINT_COMMAND_REJECTED',
        '教程章节准备未通过规则校验',
        500
      );
    }
  }

  private advanceCheckpointScript(record: TutorialSessionRecord): void {
    for (let index = 0; index < record.scenario.scriptActions.length + 1; index += 1) {
      if (!this.executeNextScriptAction(record)) return;
    }
    throw new TutorialSessionServiceError(
      'TUTORIAL_CHECKPOINT_SCRIPT_LIMIT',
      '教程章节准备超过预期动作数量',
      500
    );
  }

  private executeNextScriptAction(record: TutorialSessionRecord): boolean {
    for (const action of record.scenario.scriptActions) {
      let context = createScenarioContext(record);
      if (record.completedScriptActionIds.has(action.id) || action.isComplete(context)) {
        record.completedScriptActionIds.add(action.id);
        continue;
      }
      if (!action.isReady(context)) return false;

      const proposedCommand = action.createCommand(context);
      const actorId = action.actorSeat === 'FIRST' ? record.playerId : record.opponentId;
      const command = {
        ...proposedCommand,
        playerId: actorId,
        timestamp: this.now(),
        idempotencyKey: `${record.runId}:${record.scenario.version}:${action.id}`,
      } as GameCommand;
      const result = record.session.executeCommand(command);
      if (!result.success) {
        this.failRecord(record);
        throw new TutorialSessionServiceError(
          'TUTORIAL_SCRIPT_COMMAND_REJECTED',
          '教程对手动作未通过规则校验，请重新开始教程',
          500
        );
      }

      context = createScenarioContext(record);
      if (!action.isComplete(context)) {
        this.failRecord(record);
        throw new TutorialSessionServiceError(
          'TUTORIAL_SCRIPT_POSTCONDITION_FAILED',
          '教程对手动作没有到达预期状态，请重新开始教程',
          500
        );
      }

      record.completedScriptActionIds.add(action.id);
      return true;
    }
    return false;
  }

  private buildSnapshot(record: TutorialSessionRecord): TutorialSessionSnapshot {
    const playerViewState = record.session.getPlayerViewState(record.playerId);
    if (!playerViewState) {
      throw new TutorialSessionServiceError('TUTORIAL_VIEW_UNAVAILABLE', '教程牌桌暂时不可用', 500);
    }

    return {
      runId: record.runId,
      scenarioId: record.scenario.id,
      scenarioVersion: record.scenario.version,
      checkpointId: record.checkpoint.id,
      entryStepId: record.checkpoint.entryStepId,
      status: record.status,
      expiresAt: record.expiresAt,
      playerViewState,
      objectBindings: projectObjectBindings(playerViewState, record.roleCardIds, 'FIRST'),
      acceptedCommands: collectAcceptedPlayerCommands(record),
      ...(record.publicError ? { error: record.publicError } : {}),
    };
  }
}

function scenarioKey(id: string, version: string): string {
  return `${id.trim()}@${version.trim()}`;
}

function normalizeRequired(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new TutorialSessionServiceError('TUTORIAL_INVALID_INPUT', `${label}不能为空`);
  }
  return normalized;
}

function validateScenarioDefinition(scenario: TutorialRuntimeScenarioDefinition): void {
  normalizeRequired(scenario.id, '教程场景 ID');
  normalizeRequired(scenario.version, '教程场景版本');
  normalizeRequired(scenario.randomTape.version, '随机决策带版本');

  const actionIds = new Set<string>();
  for (const action of scenario.scriptActions) {
    const id = normalizeRequired(action.id, '教程脚本动作 ID');
    if (actionIds.has(id)) {
      throw new Error(`教程脚本动作 ID 重复: ${id}`);
    }
    actionIds.add(id);
  }

  if (scenario.checkpoints.length === 0) {
    throw new Error(
      `教程场景至少需要一个章节检查点: ${scenarioKey(scenario.id, scenario.version)}`
    );
  }
  const checkpointIds = new Set<TutorialCheckpointId>();
  for (const checkpoint of scenario.checkpoints) {
    normalizeRequired(checkpoint.id, '教程章节检查点 ID');
    normalizeRequired(checkpoint.entryStepId, `教程章节 ${checkpoint.id} 的入口步骤 ID`);
    if (checkpointIds.has(checkpoint.id)) {
      throw new Error(`教程章节检查点 ID 重复: ${checkpoint.id}`);
    }
    checkpointIds.add(checkpoint.id);
  }

  for (const [role, definition] of Object.entries(scenario.objectRoles)) {
    normalizeRequired(role, '教程对象角色');
    normalizeRequired(definition.cardCode, `教程对象角色 ${role} 的卡牌编号`);
    const occurrence = definition.occurrence ?? 0;
    if (!Number.isSafeInteger(occurrence) || occurrence < 0) {
      throw new Error(`教程对象角色序号无效: role=${role} occurrence=${occurrence}`);
    }
  }
}

function resolveRoleCardIds(
  state: GameState,
  definitions: Readonly<Record<string, TutorialRoleBindingDefinition>>
): Readonly<Record<string, string>> {
  const result: Record<string, string> = {};
  for (const [role, definition] of Object.entries(definitions)) {
    const ownerId = definition.ownerSeat === 'FIRST' ? state.players[0].id : state.players[1].id;
    const candidates = [...state.cardRegistry.values()]
      .filter((card) => card.ownerId === ownerId && card.data.cardCode === definition.cardCode)
      .sort((left, right) => left.instanceId.localeCompare(right.instanceId));
    const selected = candidates[definition.occurrence ?? 0];
    if (!selected) {
      throw new TutorialSessionServiceError(
        'TUTORIAL_ROLE_BINDING_FAILED',
        `教程对象角色无法绑定: ${role}`,
        500
      );
    }
    result[role] = selected.instanceId;
  }
  return result;
}

function createScenarioContext(record: TutorialSessionRecord): TutorialScenarioContext {
  const state = record.session.state;
  if (!state) {
    throw new TutorialSessionServiceError('TUTORIAL_STATE_UNAVAILABLE', '教程权威状态不可用', 500);
  }
  return {
    runId: record.runId,
    state,
    playerId: record.playerId,
    opponentId: record.opponentId,
    roleCardIds: record.roleCardIds,
  };
}

function projectObjectBindings(
  view: PlayerViewState,
  roleCardIds: Readonly<Record<string, string>>,
  viewerSeat: Seat
): TutorialObjectBindings {
  const result: Record<string, string | undefined> = {};
  for (const [role, cardId] of Object.entries(roleCardIds)) {
    const publicObjectId = createPublicObjectId(cardId);
    const object = view.objects[publicObjectId];
    if (object && (object.ownerSeat === viewerSeat || object.surface === 'FRONT')) {
      result[role] = publicObjectId;
    }
  }
  return result;
}

function collectAcceptedPlayerCommands(
  record: TutorialSessionRecord
): readonly TutorialAcceptedCommandReceipt[] {
  return record.session
    .getCommandLogSince(0)
    .filter(
      (commandRecord) =>
        commandRecord.playerId === record.playerId &&
        commandRecord.status === 'ACCEPTED' &&
        commandRecord.actorSeat &&
        !commandRecord.idempotencyKey?.startsWith(`${record.runId}:${record.scenario.version}:`)
    )
    .slice(-MAX_ACCEPTED_COMMAND_RECEIPTS)
    .map((commandRecord) => ({
      actorSeat: commandRecord.actorSeat as Seat,
      resultingSeq: commandRecord.resultingPublicSeq,
      command: commandRecord.payload as GameCommand,
    }));
}

function createComparableTutorialCommandPayload(command: GameCommand): string {
  const payload = { ...command } as Record<string, unknown>;
  delete payload.timestamp;
  delete payload.idempotencyKey;
  return JSON.stringify(toTransport(payload));
}

function rememberBoundedReceipt(
  receipts: Map<string, string>,
  key: string,
  payload: string,
  maxSize: number
): void {
  if (!receipts.has(key) && receipts.size >= maxSize) {
    const oldestKey = receipts.keys().next().value;
    if (oldestKey !== undefined) receipts.delete(oldestKey);
  }
  receipts.set(key, payload);
}
