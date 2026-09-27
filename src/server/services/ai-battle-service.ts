import {
  LocalAiArchive,
  readLocalArchiveConfig,
  type LocalArchiveConfig,
} from '../ai-battle/local-archive.js';
import { randomUUID } from 'node:crypto';
import type { GameCommand } from '../../application/game-commands.js';
import type {
  CreateAiBattleInput,
  AiBattleSessionView,
  CreateAiBattleResult,
} from '../../online/ai-battle-types.js';
export type { CreateAiBattleInput, AiBattleSessionView } from '../../online/ai-battle-types.js';
import { AiBattleDriver, type AiBattleModelClient } from '../ai-battle/driver.js';
import { AiBattleTraceStore } from '../ai-battle/trace-store.js';
import {
  AiBattlePresetLoader,
  AiBattleSetupError,
  type AiFrozenKnowledge,
} from '../ai-battle/presets.js';
import { onlineMatchService, type OnlineMatchService } from './online-match-service.js';
import { loadUserProfileForOnlineMatch } from './online-room-service.js';
import {
  API_AI_BATTLE_MODELS,
  CODEX_AI_REASONING_EFFORTS,
  isCodexAiBattleModel,
  type AiBattleModel,
  type CodexAiReasoningEffort,
} from '../../online/ai-battle-model-registry.js';
import {
  AiBattleBilling,
  projectAiBilling,
  safeAiErrorForLog,
  type AiBillingPersistence,
} from '../ai-battle/billing.js';
import { AiBillingRepository } from '../ai-battle/billing-repository.js';

const MAX_AI_DEBUG_MATCHES = 4;
const MAX_RETAINED_AI_SESSIONS = 32;
const ENDED_SESSION_TTL_MS = 60 * 60 * 1000;

interface AiOwnedSession {
  archive?: LocalAiArchive;
  readonly billing: AiBattleBilling;
  readonly codexBudget?: AiBattleSessionView['codexBudget'];
  readonly ownerUserId: string;
  readonly matchId: string;
  readonly input: CreateAiBattleInput;
  readonly startedAt: number;
  endedAt: number | null;
  consecutiveFailures: number;
  stoppedReason: string | null;
}

interface AiBattleServiceDeps {
  readonly archiveConfig?: () => LocalArchiveConfig | null;
  readonly availableModels?: () => readonly AiBattleModel[];
  /** Validates and freezes model configuration before a match can be registered. */
  readonly createModel: (
    knowledge: AiFrozenKnowledge,
    traces: AiBattleTraceStore,
    model: AiBattleModel,
    billing: AiBattleBilling,
    enableThinking: boolean,
    reasoningEffort?: CodexAiReasoningEffort,
    fastMode?: boolean
  ) => Promise<AiBattleModelClient>;
  readonly billingPersistence?: AiBillingPersistence;
  readonly traces?: AiBattleTraceStore;
  readonly matchService?: OnlineMatchService;
  readonly presets?: Pick<AiBattlePresetLoader, 'list' | 'load'>;
  readonly driver?: Pick<AiBattleDriver, 'start' | 'stop'>;
  readonly loadProfile?: typeof loadUserProfileForOnlineMatch;
  readonly now?: () => number;
}

/** Administrator authorization is enforced by the router; all match access is additionally owned. */
export class AiBattleService {
  private readonly sessions = new Map<string, AiOwnedSession>();
  private readonly creatingOwners = new Set<string>();
  private creatingCodex = false;
  private readonly matches: OnlineMatchService;
  private readonly presets: Pick<AiBattlePresetLoader, 'list' | 'load'>;
  private readonly driver: Pick<AiBattleDriver, 'start' | 'stop'>;
  private readonly loadProfile: typeof loadUserProfileForOnlineMatch;
  private readonly now: () => number;
  private readonly traces: AiBattleTraceStore;
  private readonly billingPersistence: AiBillingPersistence;

  constructor(private readonly deps: AiBattleServiceDeps) {
    this.matches = deps.matchService ?? onlineMatchService;
    this.presets = deps.presets ?? new AiBattlePresetLoader();
    this.now = deps.now ?? Date.now;
    this.traces = deps.traces ?? new AiBattleTraceStore(undefined, this.now);
    this.driver = deps.driver ?? new AiBattleDriver(this.matches, this.now);
    this.loadProfile = deps.loadProfile ?? loadUserProfileForOnlineMatch;
    this.billingPersistence = deps.billingPersistence ?? new AiBillingRepository();
  }

  listModels(): readonly AiBattleModel[] {
    return this.deps.availableModels?.() ?? API_AI_BATTLE_MODELS;
  }

  localOptions() {
    return { archiveAvailable: Boolean(this.archiveConfig()) };
  }

  private archiveConfig() {
    return (this.deps.archiveConfig ?? readLocalArchiveConfig)();
  }

  async exportArchive(userId: string, matchId: string) {
    const entry = this.owned(userId, matchId);
    if (!entry.archive)
      throw new AiBattleSetupError(
        'AI_ARCHIVE_NOT_ENABLED',
        '本局未开启完整归档，无法补回历史',
        404
      );
    return entry.archive.snapshot();
  }

  listPresets() {
    return this.presets.list();
  }

  listSessions(userId: string): readonly AiBattleSessionView[] {
    return [...this.sessions.values()]
      .filter((entry) => entry.ownerUserId === userId && !this.expired(entry))
      .map((entry) => this.view(entry));
  }

  async create(userId: string, input: CreateAiBattleInput): Promise<CreateAiBattleResult> {
    if (!this.listModels().includes(input.model))
      throw new AiBattleSetupError('AI_MODEL_UNSUPPORTED', '请选择支持的 AI 对战模型', 400);
    if (
      input.reasoningEffort !== undefined &&
      (!isCodexAiBattleModel(input.model) ||
        !CODEX_AI_REASONING_EFFORTS.includes(input.reasoningEffort))
    )
      throw new AiBattleSetupError(
        'AI_REASONING_UNSUPPORTED',
        '思考强度仅支持本地 Codex 的轻度或中等',
        400
      );
    if (
      input.fastMode !== undefined &&
      (!isCodexAiBattleModel(input.model) || typeof input.fastMode !== 'boolean')
    )
      throw new AiBattleSetupError(
        'AI_FAST_MODE_UNSUPPORTED',
        '快速模式仅支持本地 Codex GPT 对局',
        400
      );
    if (isCodexAiBattleModel(input.model) && input.enableThinking)
      throw new AiBattleSetupError(
        'AI_REASONING_UNSUPPORTED',
        'Codex 使用思考强度选项，不使用 API 思考开关',
        400
      );
    const archiveConfig = input.archiveEnabled ? this.archiveConfig() : null;
    if (input.archiveEnabled && !archiveConfig)
      throw new AiBattleSetupError('AI_LOCAL_ARCHIVE_DISABLED', '服务端未开启本地归档选项', 400);
    this.cleanup();
    const active = [...this.sessions.values()].filter((entry) => this.finishedAt(entry) === null);
    if (this.creatingOwners.has(userId) || active.some((entry) => entry.ownerUserId === userId))
      throw new AiBattleSetupError('AI_MATCH_ALREADY_ACTIVE', '请先结束当前 AI 调试对局', 409);
    if (
      active.length + this.creatingOwners.size >= MAX_AI_DEBUG_MATCHES ||
      this.sessions.size + this.creatingOwners.size >= MAX_RETAINED_AI_SESSIONS
    )
      throw new AiBattleSetupError('AI_CAPACITY_FULL', 'AI 调试容量已满，请稍后重试', 503);
    const codex = isCodexAiBattleModel(input.model);
    if (
      codex &&
      (this.creatingCodex || active.some((entry) => isCodexAiBattleModel(entry.input.model)))
    )
      throw new AiBattleSetupError(
        'AI_CODEX_ALREADY_ACTIVE',
        '本地服务仅允许一局 Codex 对战，请先结束当前 Codex 对局',
        409
      );
    if (codex) this.creatingCodex = true;
    this.creatingOwners.add(userId);
    try {
      const [profile, setup] = await Promise.all([
        this.loadProfile(userId),
        this.presets.load(input),
      ]);
      const billing = new AiBattleBilling(
        input.model,
        this.billingPersistence,
        (matchId, value, decisionId, delta) => {
          try {
            this.traces.updateBilling(matchId, value, decisionId, delta);
          } catch {
            this.traces.reportCaptureFailure(matchId);
          }
        }
      );
      const model = await this.deps.createModel(
        setup.knowledge,
        this.traces,
        input.model,
        billing,
        input.enableThinking,
        input.reasoningEffort,
        input.fastMode
      );
      const startedAt = this.now();
      const human = {
        userId,
        displayName: profile.displayName,
        deck: setup.human.deck,
        deckName: setup.human.name,
        deckSource: 'PUBLISHED_CARDS_SNAPSHOT' as const,
        pointValidation: setup.human.pointValidation,
        lockedAt: startedAt,
        participantKind: 'USER' as const,
      };
      const system = {
        userId: `system:ai-battle:${randomUUID()}`,
        displayName: 'AI',
        deck: setup.ai.deck,
        deckName: setup.ai.name,
        deckSource: 'PUBLISHED_CARDS_SNAPSHOT' as const,
        pointValidation: setup.ai.pointValidation,
        lockedAt: startedAt,
        participantKind: 'SYSTEM' as const,
        ownerUserId: userId,
      };
      const match = await this.matches.createMatch({
        roomCode: `AI-${randomUUID()}`,
        originKind: 'AI_DEBUG',
        originLabel: 'AI 调试',
        matchMode: 'ONLINE',
        automationGameMode: 'DEBUG',
        startedAt,
        first: input.humanSeat === 'FIRST' ? human : system,
        second: input.humanSeat === 'FIRST' ? system : human,
      });
      const entry: AiOwnedSession = {
        billing,
        ...(model.codexBudget ? { codexBudget: Object.freeze({ ...model.codexBudget }) } : {}),
        ownerUserId: userId,
        matchId: match.matchId,
        input: {
          ...input,
          ...(model.reasoningEffort ? { reasoningEffort: model.reasoningEffort } : {}),
          ...(isCodexAiBattleModel(input.model) ? { fastMode: model.fastMode === true } : {}),
        },
        startedAt,
        endedAt: null,
        consecutiveFailures: 0,
        stoppedReason: null,
      };
      this.sessions.set(match.matchId, entry);
      try {
        if (archiveConfig) {
          try {
            entry.archive = await LocalAiArchive.create(archiveConfig, match.matchId);
          } catch {
            throw new AiBattleSetupError(
              'AI_ARCHIVE_OPEN_FAILED',
              '无法创建本地归档，请检查目录与磁盘权限',
              503
            );
          }
        }
        const knowledge = setup.knowledge;
        if (
          !this.traces.open(
            match.matchId,
            [
              knowledge.rules,
              knowledge.tutorial,
              knowledge.handbook,
              knowledge.ownDeck,
              ...(model.configurationMaterial ? [model.configurationMaterial] : []),
            ],
            entry.archive
          )
        )
          throw new AiBattleSetupError(
            'AI_OBSERVATION_CAPACITY_FULL',
            '观测存储容量不足，无法创建调试对局'
          );
        await billing.initialize(match.matchId);
        const snapshot = await this.matches.getMatchSnapshot(match.matchId, userId);
        if (!snapshot || 'modified' in snapshot)
          throw new AiBattleSetupError('AI_SNAPSHOT_FAILED', 'AI 对局初始快照读取失败');
        await this.driver.start(match.matchId, model, this.traces.bind(match.matchId));
        return { session: this.view(entry), snapshot };
      } catch (error) {
        const removed = await this.matches.deleteMatch(match.matchId, {
          reason: 'AI_CREATE_FAILED',
        });
        if (removed) {
          this.traces.end(match.matchId);
          await entry.archive?.close();
          this.sessions.delete(match.matchId);
        } else {
          entry.stoppedReason = 'AI_CREATE_CLEANUP_FAILED';
          console.error('[AiBattle] 创建失败且封存未完成', {
            matchId: match.matchId,
            ...safeAiErrorForLog(error),
          });
          const cleanupFailure = new AiBattleSetupError(
            'AI_CREATE_CLEANUP_FAILED',
            '创建失败且封存未完成，请在会话列表重试结束'
          );
          // Preserve the original setup failure for diagnostics instead of discarding it.
          cleanupFailure.cause = error;
          throw cleanupFailure;
        }
        throw error;
      }
    } finally {
      this.creatingOwners.delete(userId);
      if (codex) this.creatingCodex = false;
    }
  }

  getSession(userId: string, matchId: string): AiBattleSessionView {
    return this.view(this.owned(userId, matchId));
  }

  async getRecordedBilling(userId: string, matchId: string) {
    const record = await this.billingPersistence.readOwned(matchId, userId);
    if (record === undefined)
      throw new AiBattleSetupError('AI_SESSION_NOT_FOUND', '调试对局不存在', 404);
    return { matchBilling: record === null ? null : projectAiBilling(record) };
  }

  listDecisions(userId: string, matchId: string) {
    this.owned(userId, matchId);
    const listing = this.traces.list(matchId);
    if (!listing)
      throw new AiBattleSetupError('AI_OBSERVATION_NOT_RETAINED', '观测材料已过期或未保留', 404);
    return listing;
  }

  exportDecisions(userId: string, matchId: string, decisionId?: string) {
    this.owned(userId, matchId);
    const bundle = this.traces.export(matchId, decisionId);
    if (!bundle)
      throw new AiBattleSetupError(
        'AI_OBSERVATION_NOT_RETAINED',
        '指定决定或观测材料已过期或未保留',
        404
      );
    return bundle;
  }

  async snapshot(userId: string, matchId: string, sinceSeq?: number) {
    this.owned(userId, matchId);
    return this.matches.getMatchSnapshot(matchId, userId, { sinceSeq });
  }

  async publicEvents(userId: string, matchId: string, afterSeq?: number) {
    this.owned(userId, matchId);
    return this.matches.getMatchPublicEvents(matchId, userId, { afterSeq });
  }

  async command(userId: string, matchId: string, command: GameCommand) {
    const entry = this.owned(userId, matchId);
    if (this.finishedAt(entry) !== null)
      throw new AiBattleSetupError('AI_MATCH_ENDED', '调试对局已结束', 409);
    return this.matches.executeCommand(matchId, userId, { ...command, timestamp: this.now() });
  }

  async advance(userId: string, matchId: string) {
    const entry = this.owned(userId, matchId);
    if (this.finishedAt(entry) !== null)
      throw new AiBattleSetupError('AI_MATCH_ENDED', '调试对局已结束', 409);
    return this.matches.advancePhase(matchId, userId);
  }

  async end(userId: string, matchId: string): Promise<AiBattleSessionView> {
    const entry = this.owned(userId, matchId);
    const result = await this.matches.endAiBattle(matchId);
    await this.driver.stop(matchId);
    await entry.billing.flush();
    if (result && !result.removed)
      throw new AiBattleSetupError('AI_END_FAILED', '封存失败，请重试结束本局');
    entry.endedAt ??= result?.endedAt ?? this.now();
    this.traces.end(matchId, entry.endedAt);
    if (result) {
      entry.consecutiveFailures = result.consecutiveFailures;
      entry.stoppedReason ??= result.stoppedReason;
    }
    return this.view(entry);
  }

  /** TTL removal only drops ended administrator metadata; it cannot execute game actions. */
  cleanup(): void {
    for (const [id, entry] of this.sessions) {
      if (entry.endedAt === null && !this.matches.getMatch(id)) {
        void this.driver.stop(id);
        // The shared runtime cleanup may remove a match independently of this administrator API.
        // This is the time its removal was observed, not an invented game-result timestamp.
        entry.endedAt = this.now();
        entry.stoppedReason ??= 'MATCH_RUNTIME_RELEASED';
        this.traces.end(id, entry.endedAt);
      }
      if (this.expired(entry)) {
        void entry.archive?.close();
        this.sessions.delete(id);
      }
    }
    this.traces.cleanup();
  }

  private owned(userId: string, matchId: string): AiOwnedSession {
    const entry = this.sessions.get(matchId);
    const match = this.matches.getMatch(matchId);
    if (
      !entry ||
      entry.ownerUserId !== userId ||
      this.expired(entry) ||
      (match && match.originKind !== 'AI_DEBUG')
    )
      throw new AiBattleSetupError('AI_SESSION_NOT_FOUND', '调试会话不存在', 404);
    return entry;
  }

  private finishedAt(entry: AiOwnedSession): number | null {
    const match = this.matches.getMatch(entry.matchId);
    return entry.endedAt ?? match?.session.state?.endInfo?.endTimestamp ?? null;
  }

  private expired(entry: AiOwnedSession): boolean {
    const endedAt = this.finishedAt(entry);
    return endedAt !== null && this.now() - endedAt >= ENDED_SESSION_TTL_MS;
  }

  private view(entry: AiOwnedSession): AiBattleSessionView {
    const status = this.matches.getAiBattleStatus(entry.matchId);
    const endedAt = this.finishedAt(entry);
    const stoppedReason = entry.stoppedReason ?? status?.stoppedReason ?? null;
    return {
      ...entry.input,
      matchBilling: entry.billing.view(),
      ...(entry.codexBudget ? { codexBudget: entry.codexBudget } : {}),
      matchId: entry.matchId,
      startedAt: entry.startedAt,
      endedAt,
      consecutiveFailures: status?.consecutiveFailures ?? entry.consecutiveFailures,
      stoppedReason,
      activity:
        endedAt !== null ? 'ENDED' : stoppedReason ? 'STOPPED' : (status?.activity ?? 'WAITING'),
    };
  }
}
