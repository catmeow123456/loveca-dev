import { randomUUID } from 'node:crypto';
import { createSurrenderCommand } from '../../application/game-commands.js';
import type { DeckPointTableRules } from '../../domain/rules/deck-point-table.js';
import type { OnlineMatchSnapshot, Seat } from '../../online/index.js';
import {
  AI_BATTLE_PHASE_ZERO_BASELINE_VERSION,
  AI_BATTLE_PHASE_ZERO_DECKS,
  type AiBattlePhaseZeroDeckKey,
} from '../ai-battle/phase-zero-baseline.js';
import {
  AI_PHASE_THREE_LIFECYCLE_POLICY_VERSION,
  createAiSystemParticipantBinding,
  type AiSystemParticipantBinding,
} from '../ai-battle/system-participant.js';
import {
  resolveControlledAiPregame,
  type AiControlledPregameResult,
} from '../ai-battle/system-pregame.js';
import { SingleMatchSerialExecutor } from '../ai-battle/single-match-serial-executor.js';
import {
  loadCertifiedAiDeck,
  type LoadedCertifiedAiDeck,
} from '../ai-battle/certified-deck-loader.js';
import type { AiBattleDebugTraceView } from '../ai-battle/debug-trace.js';
import {
  onlineMatchService,
  type OnlineMatchService,
  type OnlineMatchState,
} from './online-match-service.js';
import { revalidateRuntimeDeckPointSnapshot } from './deck-point-snapshot-validation.js';
import { deckPointTableService } from './deck-point-table-service.js';
import { loadUserProfileForOnlineMatch, type UserProfileSummary } from './online-room-service.js';

export const AI_BATTLE_PHASE_FOUR_ENTRY_SCHEMA_VERSION = 'ai-battle.phase-four-entry/v1' as const;

export interface CreateControlledAiBattleInput {
  readonly humanUserId: string;
  readonly humanDeckKey: AiBattlePhaseZeroDeckKey;
  readonly aiDeckKey: AiBattlePhaseZeroDeckKey;
  readonly aiSeat: Seat;
}

export interface ControlledAiBattleView {
  readonly schemaVersion: typeof AI_BATTLE_PHASE_FOUR_ENTRY_SCHEMA_VERSION;
  readonly matchId: string;
  readonly roomCode: string;
  readonly humanSeat: Seat;
  readonly systemSeat: Seat;
  readonly systemIdentity: AiSystemParticipantBinding;
  readonly humanDeckKey: AiBattlePhaseZeroDeckKey;
  readonly humanDeckContentHash: string;
  readonly aiDeckKey: AiBattlePhaseZeroDeckKey;
  readonly aiDeckContentHash: string;
  readonly pregame: AiControlledPregameResult;
  readonly lifecycle: {
    readonly policyVersion: typeof AI_PHASE_THREE_LIFECYCLE_POLICY_VERSION;
    readonly refresh: 'RESUME_SAME_MATCH';
    readonly undo: 'DISABLED';
    readonly freeMode: 'DISABLED';
    readonly restart: 'SYSTEM_AUTO_ACCEPTS_NEW_MATCH';
    readonly leave: 'HUMAN_SURRENDER_AND_REMOVE_RUNTIME';
  };
  readonly snapshot: OnlineMatchSnapshot;
}

interface ControlledAiBattleRuntime {
  readonly input: CreateControlledAiBattleInput;
  readonly roomCode: string;
  readonly matchId: string;
  readonly pregame: AiControlledPregameResult;
}

interface AiBattlePhaseThreeServiceDeps {
  readonly now?: () => number;
  readonly idGenerator?: () => string;
  readonly matchService?: OnlineMatchService;
  readonly loadUserProfile?: (userId: string) => Promise<UserProfileSummary>;
  readonly loadCertifiedDeck?: (
    deckKey: AiBattlePhaseZeroDeckKey
  ) => Promise<LoadedCertifiedAiDeck>;
  readonly getCurrentPointTableRules?: () => Promise<DeckPointTableRules>;
  readonly entryExecutor?: SingleMatchSerialExecutor;
}

export class AiBattlePhaseThreeServiceError extends Error {
  readonly code: string;
  readonly statusCode: number;

  constructor(code: string, message: string, statusCode = 400) {
    super(message);
    this.name = 'AiBattlePhaseThreeServiceError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

export class AiBattlePhaseThreeService {
  private readonly runtimeByMatchId = new Map<string, ControlledAiBattleRuntime>();
  private readonly matchIdByHumanUserId = new Map<string, string>();
  private readonly now: () => number;
  private readonly idGenerator: () => string;
  private readonly matchService: OnlineMatchService;
  private readonly loadUserProfile: (userId: string) => Promise<UserProfileSummary>;
  private readonly loadCertifiedDeck: (
    deckKey: AiBattlePhaseZeroDeckKey
  ) => Promise<LoadedCertifiedAiDeck>;
  private readonly getCurrentPointTableRules: () => Promise<DeckPointTableRules>;
  private readonly entryExecutor: SingleMatchSerialExecutor;

  constructor(deps: AiBattlePhaseThreeServiceDeps = {}) {
    this.now = deps.now ?? (() => Date.now());
    this.idGenerator = deps.idGenerator ?? randomUUID;
    this.matchService = deps.matchService ?? onlineMatchService;
    this.loadUserProfile = deps.loadUserProfile ?? loadUserProfileForOnlineMatch;
    this.loadCertifiedDeck = deps.loadCertifiedDeck ?? loadCertifiedAiDeck;
    this.getCurrentPointTableRules =
      deps.getCurrentPointTableRules ?? (() => deckPointTableService.getCurrentRules());
    this.entryExecutor = deps.entryExecutor ?? new SingleMatchSerialExecutor();
  }

  async createBattle(input: CreateControlledAiBattleInput): Promise<ControlledAiBattleView> {
    return this.entryExecutor.runExclusive(buildHumanEntryKey(input.humanUserId), () =>
      this.createBattleInCriticalSection(input)
    );
  }

  private async createBattleInCriticalSection(
    input: CreateControlledAiBattleInput
  ): Promise<ControlledAiBattleView> {
    if (input.humanUserId.startsWith('system:')) {
      throw new AiBattlePhaseThreeServiceError(
        'AI_BATTLE_INVALID_HUMAN_IDENTITY',
        '不可登录的 SYSTEM 身份不能作为真人席位',
        403
      );
    }
    const existingMatchId = this.matchIdByHumanUserId.get(input.humanUserId);
    if (existingMatchId) {
      if (this.matchService.getMatch(existingMatchId)) {
        throw new AiBattlePhaseThreeServiceError(
          'AI_BATTLE_ALREADY_ACTIVE',
          '当前账号已有 AI 对局，请刷新原对局或先离开',
          409
        );
      }
      const staleRuntime = this.runtimeByMatchId.get(existingMatchId);
      if (staleRuntime) {
        this.clearRuntime(staleRuntime);
      } else {
        this.matchIdByHumanUserId.delete(input.humanUserId);
      }
    }

    const [profile, humanDeck, aiDeck, pointTableRules] = await Promise.all([
      this.loadUserProfile(input.humanUserId),
      this.loadCertifiedDeck(input.humanDeckKey),
      this.loadCertifiedDeck(input.aiDeckKey),
      this.getCurrentPointTableRules(),
    ]);
    return this.createBattleFromResolvedInput(
      input,
      profile,
      humanDeck,
      aiDeck,
      pointTableRules
    );
  }

  async refreshBattle(
    matchId: string,
    humanUserId: string
  ): Promise<ControlledAiBattleView | null> {
    return this.entryExecutor.runExclusive(buildHumanEntryKey(humanUserId), async () => {
      const runtime = this.requireOwnedRuntime(matchId, humanUserId, false);
      if (!runtime) return null;
      const match = this.matchService.getMatch(matchId);
      if (!match) {
        this.clearRuntime(runtime);
        return null;
      }
      return this.buildView(runtime, match);
    });
  }

  async getDebugTrace(
    matchId: string,
    humanUserId: string,
    afterSeq = 0
  ): Promise<AiBattleDebugTraceView | null> {
    return this.entryExecutor.runExclusive(buildHumanEntryKey(humanUserId), async () => {
      const runtime = this.requireOwnedRuntime(matchId, humanUserId, false);
      if (!runtime) return null;
      return this.matchService.getAiBattleDebugTrace(matchId, humanUserId, afterSeq);
    });
  }

  async restartBattle(matchId: string, humanUserId: string): Promise<ControlledAiBattleView> {
    return this.entryExecutor.runExclusive(buildHumanEntryKey(humanUserId), () =>
      this.restartBattleInCriticalSection(matchId, humanUserId)
    );
  }

  private async restartBattleInCriticalSection(
    matchId: string,
    humanUserId: string
  ): Promise<ControlledAiBattleView> {
    const runtime = this.requireOwnedRuntime(matchId, humanUserId, true)!;
    const [profile, humanDeck, aiDeck, pointTableRules] = await Promise.all([
      this.loadUserProfile(humanUserId),
      this.loadCertifiedDeck(runtime.input.humanDeckKey),
      this.loadCertifiedDeck(runtime.input.aiDeckKey),
      this.getCurrentPointTableRules(),
    ]);
    const deleted = await this.matchService.deleteMatch(matchId, {
      reason: 'AI_BATTLE_RESTARTED',
      now: this.now(),
    });
    if (!deleted) {
      throw new AiBattlePhaseThreeServiceError(
        'AI_BATTLE_RESTART_SEAL_FAILED',
        '旧 AI 对局封存失败，暂时不能重开',
        503
      );
    }
    this.clearRuntime(runtime);
    return this.createBattleFromResolvedInput(
      runtime.input,
      profile,
      humanDeck,
      aiDeck,
      pointTableRules
    );
  }

  async leaveBattle(matchId: string, humanUserId: string): Promise<void> {
    return this.entryExecutor.runExclusive(buildHumanEntryKey(humanUserId), () =>
      this.leaveBattleInCriticalSection(matchId, humanUserId)
    );
  }

  private async leaveBattleInCriticalSection(matchId: string, humanUserId: string): Promise<void> {
    const runtime = this.requireOwnedRuntime(matchId, humanUserId, true)!;
    const match = this.matchService.getMatch(matchId);
    if (match && !match.session.state?.isEnded) {
      const participant = findHumanParticipant(match, humanUserId);
      const result = await this.matchService.executeCommand(matchId, humanUserId, {
        ...createSurrenderCommand(participant.playerId),
        timestamp: this.now(),
      });
      if (!result?.success) {
        throw new AiBattlePhaseThreeServiceError(
          'AI_BATTLE_LEAVE_SURRENDER_FAILED',
          result?.error ?? '离开 AI 对局时无法完成认输',
          409
        );
      }
    }
    const deleted = await this.matchService.deleteMatch(matchId, {
      reason: 'AI_BATTLE_HUMAN_LEFT',
      now: this.now(),
    });
    if (!deleted) {
      throw new AiBattlePhaseThreeServiceError(
        'AI_BATTLE_LEAVE_SEAL_FAILED',
        'AI 对局封存失败，请稍后重试',
        503
      );
    }
    this.clearRuntime(runtime);
  }

  private async createBattleFromResolvedInput(
    input: CreateControlledAiBattleInput,
    profile: UserProfileSummary,
    humanDeck: LoadedCertifiedAiDeck,
    aiDeck: LoadedCertifiedAiDeck,
    pointTableRules: DeckPointTableRules
  ): Promise<ControlledAiBattleView> {
    assertResolvedDeckIdentity(input.humanDeckKey, humanDeck);
    assertResolvedDeckIdentity(input.aiDeckKey, aiDeck);
    const binding = createAiSystemParticipantBinding(input.aiDeckKey);
    const humanPointReview = revalidateRuntimeDeckPointSnapshot(
      humanDeck.runtimeDeck,
      createInitialPointValidation(pointTableRules),
      pointTableRules
    );
    const aiPointReview = revalidateRuntimeDeckPointSnapshot(
      aiDeck.runtimeDeck,
      createInitialPointValidation(pointTableRules),
      pointTableRules
    );
    if (!humanPointReview.valid || !aiPointReview.valid) {
      throw new AiBattlePhaseThreeServiceError(
        'AI_BATTLE_CERTIFIED_DECK_POINT_INVALID',
        '当前认证 AI 卡组超出 PT 上限，暂时无法开始对局',
        503
      );
    }
    const roomCode = `AI-${this.idGenerator()
      .replace(/[^A-Za-z0-9]/gu, '')
      .slice(0, 10)}`;
    const human = {
      userId: input.humanUserId,
      displayName: profile.displayName,
      deck: humanDeck.runtimeDeck,
      deckId: null,
      deckName: input.humanDeckKey,
      deckSource: 'AI_CERTIFIED_DECK' as const,
      lockedAt: this.now(),
      participantKind: 'USER' as const,
      ownerUserId: input.humanUserId,
      pointValidation: humanPointReview.facts,
    };
    const system = {
      userId: binding.userId,
      displayName: binding.displayName,
      deck: aiDeck.runtimeDeck,
      deckId: null,
      deckName: input.aiDeckKey,
      deckSource: 'AI_CERTIFIED_DECK' as const,
      lockedAt: this.now(),
      participantKind: 'SYSTEM' as const,
      ownerUserId: null,
      systemParticipantBinding: binding,
      pointValidation: aiPointReview.facts,
    };
    const pregame = resolveControlledAiPregame({
      human,
      system,
      requestedSystemSeat: input.aiSeat,
    });
    const match = await this.matchService.createMatch({
      roomCode,
      matchMode: 'ONLINE',
      automationGameMode: 'DEBUG',
      originKind: 'AI_BATTLE',
      originLabel: 'AI 对战',
      startedAt: this.now(),
      first: pregame.first,
      second: pregame.second,
    });
    const runtime: ControlledAiBattleRuntime = {
      input,
      roomCode,
      matchId: match.matchId,
      pregame: pregame.result,
    };
    this.runtimeByMatchId.set(match.matchId, runtime);
    this.matchIdByHumanUserId.set(input.humanUserId, match.matchId);
    return this.buildView(runtime, match);
  }

  private async buildView(
    runtime: ControlledAiBattleRuntime,
    match: OnlineMatchState
  ): Promise<ControlledAiBattleView> {
    const snapshot = await this.matchService.getMatchSnapshot(
      match.matchId,
      runtime.input.humanUserId
    );
    if (!snapshot || !('playerViewState' in snapshot)) {
      throw new AiBattlePhaseThreeServiceError(
        'AI_BATTLE_SNAPSHOT_UNAVAILABLE',
        'AI 对局玩家视图暂不可用',
        503
      );
    }
    const binding = match.systemParticipantBindings[runtime.input.aiSeat];
    if (!binding) {
      throw new AiBattlePhaseThreeServiceError(
        'AI_BATTLE_SYSTEM_BINDING_MISSING',
        'AI 对局缺少正式 SYSTEM 身份绑定',
        500
      );
    }
    return {
      schemaVersion: AI_BATTLE_PHASE_FOUR_ENTRY_SCHEMA_VERSION,
      matchId: match.matchId,
      roomCode: runtime.roomCode,
      humanSeat: runtime.input.aiSeat === 'FIRST' ? 'SECOND' : 'FIRST',
      systemSeat: runtime.input.aiSeat,
      systemIdentity: binding,
      humanDeckKey: runtime.input.humanDeckKey,
      humanDeckContentHash: AI_BATTLE_PHASE_ZERO_DECKS[runtime.input.humanDeckKey].contentHash,
      aiDeckKey: runtime.input.aiDeckKey,
      aiDeckContentHash: binding.deckContentHash,
      pregame: runtime.pregame,
      lifecycle: {
        policyVersion: AI_PHASE_THREE_LIFECYCLE_POLICY_VERSION,
        refresh: 'RESUME_SAME_MATCH',
        undo: 'DISABLED',
        freeMode: 'DISABLED',
        restart: 'SYSTEM_AUTO_ACCEPTS_NEW_MATCH',
        leave: 'HUMAN_SURRENDER_AND_REMOVE_RUNTIME',
      },
      snapshot,
    };
  }

  private requireOwnedRuntime(
    matchId: string,
    humanUserId: string,
    required: boolean
  ): ControlledAiBattleRuntime | null {
    const runtime = this.runtimeByMatchId.get(matchId) ?? null;
    if (!runtime) {
      if (!required) return null;
      throw new AiBattlePhaseThreeServiceError('AI_BATTLE_NOT_FOUND', 'AI 对局不存在或已结束', 404);
    }
    if (runtime.input.humanUserId !== humanUserId) {
      throw new AiBattlePhaseThreeServiceError(
        'AI_BATTLE_FORBIDDEN',
        '当前账号无权访问该 AI 对局',
        403
      );
    }
    return runtime;
  }

  private clearRuntime(runtime: ControlledAiBattleRuntime): void {
    this.runtimeByMatchId.delete(runtime.matchId);
    if (this.matchIdByHumanUserId.get(runtime.input.humanUserId) === runtime.matchId) {
      this.matchIdByHumanUserId.delete(runtime.input.humanUserId);
    }
  }
}

export const aiBattlePhaseThreeService = new AiBattlePhaseThreeService();

function buildHumanEntryKey(humanUserId: string): string {
  return `ai-battle-entry:${humanUserId}`;
}

function createInitialPointValidation(pointTableRules: DeckPointTableRules) {
  return {
    pointTableVersion: pointTableRules.version,
    pointTotal: 0,
    pointLimit: pointTableRules.pointLimit,
  };
}

function assertResolvedDeckIdentity(
  expectedDeckKey: AiBattlePhaseZeroDeckKey,
  deck: LoadedCertifiedAiDeck
): void {
  const certification = AI_BATTLE_PHASE_ZERO_DECKS[expectedDeckKey];
  if (
    deck.deckKey !== expectedDeckKey ||
    deck.contentHash !== certification.contentHash ||
    deck.phaseZeroBaselineVersion !== AI_BATTLE_PHASE_ZERO_BASELINE_VERSION
  ) {
    throw new AiBattlePhaseThreeServiceError(
      'AI_BATTLE_DECK_CERTIFICATION_MISMATCH',
      `AI 对战卡组 ${expectedDeckKey} 未通过精确内容认证`,
      409
    );
  }
}

function findHumanParticipant(match: OnlineMatchState, humanUserId: string) {
  const participant = (['FIRST', 'SECOND'] as const)
    .map((seat) => match.participants[seat])
    .find((candidate) => candidate.userId === humanUserId && candidate.participantKind === 'USER');
  if (!participant) {
    throw new AiBattlePhaseThreeServiceError(
      'AI_BATTLE_HUMAN_PARTICIPANT_MISSING',
      'AI 对局真人席位不存在',
      409
    );
  }
  return participant;
}
