import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { GameCommand } from '../../application/game-commands.js';
import type { DeckConfig } from '../../application/game-service.js';
import { loadDeckFromYaml } from '../../domain/card-data/deck-loader-node.js';
import type {
  OnlineCommandResult,
  OnlineMatchSnapshot,
  OnlineMatchSnapshotResponse,
  PublicEventsResponse,
} from '../../online/index.js';
import { getPublishedCardRegistry } from './card-registry-service.js';
import type { DeckPointTableRules } from '../../domain/rules/deck-point-table.js';
import {
  loadOwnedDeckForOnlineMatch,
  loadUserProfileForOnlineMatch,
  type OwnedDeckSummary,
  type UserProfileSummary,
} from './online-room-service.js';
import {
  onlineMatchService,
  type OnlineMatchState,
  type OnlineMatchService,
  type RemoteUndoInput,
  type ChangeManualOperationModeInput,
} from './online-match-service.js';
import {
  solitaireRuntimeRecoveryService,
  type SolitaireRecoveredMatch,
  type SolitaireRuntimeRecoveryService,
} from './solitaire-runtime-recovery-service.js';
import { deckPointTableService } from './deck-point-table-service.js';
import { revalidateRuntimeDeckPointSnapshot } from './deck-point-snapshot-validation.js';

const DEFAULT_SOLITAIRE_OPPONENT_DECK_PATH =
  process.env.SOLITAIRE_DEFAULT_OPPONENT_DECK_PATH ?? 'assets/decks/缪预组.yaml';
const SOLITAIRE_SYSTEM_USER_ID = 'system:solitaire-opponent';
const SOLITAIRE_SYSTEM_DISPLAY_NAME = '对手 (AI)';

interface SolitaireMatchServiceDeps {
  readonly now?: () => number;
  readonly matchService?: OnlineMatchService;
  readonly recoveryService?: Pick<SolitaireRuntimeRecoveryService, 'recoverMatch'> | null;
  readonly idGenerator?: () => string;
  readonly opponentDeckPath?: string;
  readonly loadUserProfile?: (userId: string) => Promise<UserProfileSummary>;
  readonly loadOwnedDeck?: (userId: string, deckId: string) => Promise<OwnedDeckSummary>;
  readonly loadOpponentDeck?: (deckPath: string) => Promise<DeckConfig>;
  readonly getCurrentPointTableRules?: () => Promise<DeckPointTableRules>;
}

export interface CreateSolitaireMatchInput {
  readonly userId: string;
  readonly deckId: string;
}

export interface CreateSolitaireMatchResult {
  readonly matchId: string;
  readonly snapshot: OnlineMatchSnapshot;
}

export class SolitaireMatchServiceError extends Error {
  readonly code: string;
  readonly statusCode: number;

  constructor(code: string, message: string, statusCode = 400) {
    super(message);
    this.name = 'SolitaireMatchServiceError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

export class SolitaireMatchService {
  private readonly now: () => number;
  private readonly matchService: OnlineMatchService;
  private readonly recoveryService: Pick<SolitaireRuntimeRecoveryService, 'recoverMatch'> | null;
  private readonly idGenerator: () => string;
  private readonly opponentDeckPath: string;
  private readonly loadUserProfile: (userId: string) => Promise<UserProfileSummary>;
  private readonly loadOwnedDeck: (userId: string, deckId: string) => Promise<OwnedDeckSummary>;
  private readonly loadOpponentDeck: (deckPath: string) => Promise<DeckConfig>;
  private readonly getCurrentPointTableRules: () => Promise<DeckPointTableRules>;
  private readonly restartOperations = new Map<
    string,
    Promise<CreateSolitaireMatchResult | null>
  >();

  constructor(deps: SolitaireMatchServiceDeps = {}) {
    this.now = deps.now ?? (() => Date.now());
    this.matchService = deps.matchService ?? onlineMatchService;
    this.recoveryService =
      deps.recoveryService === undefined ? solitaireRuntimeRecoveryService : deps.recoveryService;
    this.idGenerator = deps.idGenerator ?? randomUUID;
    this.opponentDeckPath = deps.opponentDeckPath ?? DEFAULT_SOLITAIRE_OPPONENT_DECK_PATH;
    this.loadUserProfile = deps.loadUserProfile ?? loadUserProfileForOnlineMatch;
    this.loadOwnedDeck = deps.loadOwnedDeck ?? loadOwnedDeckForOnlineMatch;
    this.loadOpponentDeck = deps.loadOpponentDeck ?? loadDefaultOpponentDeck;
    this.getCurrentPointTableRules =
      deps.getCurrentPointTableRules ?? (() => deckPointTableService.getCurrentRules());
  }

  async createMatch(input: CreateSolitaireMatchInput): Promise<CreateSolitaireMatchResult> {
    const [profile, userDeck, opponentDeck] = await Promise.all([
      this.loadUserProfile(input.userId),
      this.loadOwnedDeck(input.userId, input.deckId.trim()),
      this.loadOpponentDeck(this.opponentDeckPath),
    ]);
    const roomCode = `SOL-${this.idGenerator()}`;
    const opponentPointReview = revalidateRuntimeDeckPointSnapshot(
      opponentDeck,
      {
        pointTableVersion: userDeck.pointTable.version,
        pointTotal: 0,
        pointLimit: userDeck.pointTable.pointLimit,
      },
      userDeck.pointTable
    );
    if (!opponentPointReview.valid) {
      throw new SolitaireMatchServiceError(
        'SOLITAIRE_OPPONENT_DECK_POINT_INVALID',
        '当前对墙打系统卡组超出PT上限，暂时无法开始对局',
        503
      );
    }

    const match = await this.matchService.createMatch({
      roomCode,
      matchMode: 'SOLITAIRE',
      automationGameMode: 'SOLITAIRE',
      originKind: 'SOLITAIRE',
      originLabel: '对墙打',
      startedAt: this.now(),
      first: {
        userId: profile.userId,
        displayName: profile.displayName,
        deck: cloneDeck(userDeck.runtimeDeck),
        deckId: userDeck.deckId,
        deckName: userDeck.deckName,
        deckSource: 'PUBLISHED_CARDS_SNAPSHOT',
        lockedAt: this.now(),
        participantKind: 'USER',
        ownerUserId: null,
        pointValidation: userDeck.pointValidation,
      },
      second: {
        userId: SOLITAIRE_SYSTEM_USER_ID,
        displayName: SOLITAIRE_SYSTEM_DISPLAY_NAME,
        deck: cloneDeck(opponentDeck),
        deckId: null,
        deckName: path.basename(this.opponentDeckPath),
        deckSource: 'SOLITAIRE_DEFAULT_DECK',
        lockedAt: this.now(),
        participantKind: 'SYSTEM',
        pointValidation: opponentPointReview.facts,
        ownerUserId: profile.userId,
      },
    });

    const snapshot = await this.matchService.getMatchSnapshot(match.matchId, input.userId);
    if (!snapshot || 'modified' in snapshot) {
      throw new SolitaireMatchServiceError(
        'SOLITAIRE_MATCH_SNAPSHOT_FAILED',
        '对墙打对局已创建，但初始快照读取失败',
        500
      );
    }

    return {
      matchId: match.matchId,
      snapshot,
    };
  }

  async getMatchSnapshot(
    matchId: string,
    userId: string,
    options: { readonly sinceSeq?: number } = {}
  ): Promise<OnlineMatchSnapshotResponse | null> {
    const resolved = await this.getPlayableOrRecoveredSolitaireMatch(matchId, userId);
    if (!resolved) {
      return null;
    }
    return this.matchService.getMatchSnapshot(matchId, userId, options);
  }

  async getMatchPublicEvents(
    matchId: string,
    userId: string,
    options: { readonly afterSeq?: number } = {}
  ): Promise<PublicEventsResponse | null> {
    const resolved = await this.getPlayableOrRecoveredSolitaireMatch(matchId, userId);
    if (!resolved) {
      return null;
    }
    return this.matchService.getMatchPublicEvents(matchId, userId, options);
  }

  async executeCommand(
    matchId: string,
    userId: string,
    command: GameCommand
  ): Promise<OnlineCommandResult | null> {
    const resolved = await this.getPlayableOrRecoveredSolitaireMatch(matchId, userId);
    if (!resolved) {
      return null;
    }
    if (shouldRejectRecoveredWrite(resolved.recovery)) {
      return this.buildRecoveredWriteRejectedResult(
        resolved.match,
        userId,
        '对局已恢复到最近保存点，请刷新后重试'
      );
    }
    return this.matchService.executeCommand(matchId, userId, command);
  }

  async advancePhase(matchId: string, userId: string): Promise<OnlineCommandResult | null> {
    const resolved = await this.getPlayableOrRecoveredSolitaireMatch(matchId, userId);
    if (!resolved) {
      return null;
    }
    if (shouldRejectRecoveredWrite(resolved.recovery)) {
      return this.buildRecoveredWriteRejectedResult(
        resolved.match,
        userId,
        '对局已恢复到最近保存点，请刷新后重试'
      );
    }
    return this.matchService.advancePhase(matchId, userId);
  }

  async undoLatest(
    matchId: string,
    userId: string,
    input: RemoteUndoInput
  ): Promise<OnlineCommandResult | null> {
    const resolved = await this.getPlayableOrRecoveredSolitaireMatch(matchId, userId);
    if (!resolved) {
      return null;
    }
    if (resolved.recovery) {
      return this.buildRecoveredWriteRejectedResult(
        resolved.match,
        userId,
        shouldRejectRecoveredWrite(resolved.recovery)
          ? '对局已恢复到最近保存点，请刷新后重试'
          : '对局运行态已恢复，撤销历史已重置，请刷新后重试'
      );
    }
    return this.matchService.undoLatest(matchId, userId, input);
  }

  async changeManualOperationMode(
    matchId: string,
    userId: string,
    input: ChangeManualOperationModeInput
  ): Promise<OnlineCommandResult | null> {
    const resolved = await this.getPlayableOrRecoveredSolitaireMatch(matchId, userId);
    if (!resolved) {
      return null;
    }
    if (shouldRejectRecoveredWrite(resolved.recovery)) {
      return this.buildRecoveredWriteRejectedResult(
        resolved.match,
        userId,
        '对局已恢复到最近保存点，请刷新后重试'
      );
    }
    return this.matchService.changeManualOperationMode(matchId, userId, input);
  }

  async leaveMatch(matchId: string, userId: string): Promise<boolean | null> {
    const match = this.getPlayableSolitaireMatch(matchId, userId);
    if (!match) {
      return null;
    }
    return this.matchService.deleteMatch(matchId, { reason: 'SOLITAIRE_PLAYER_LEFT' });
  }

  async restartMatch(matchId: string, userId: string): Promise<CreateSolitaireMatchResult | null> {
    const operationKey = `${matchId}:${userId}`;
    const pending = this.restartOperations.get(operationKey);
    if (pending) {
      return pending;
    }

    const operation = this.performRestartMatch(matchId, userId);
    this.restartOperations.set(operationKey, operation);
    try {
      return await operation;
    } finally {
      if (this.restartOperations.get(operationKey) === operation) {
        this.restartOperations.delete(operationKey);
      }
    }
  }

  private async performRestartMatch(
    matchId: string,
    userId: string
  ): Promise<CreateSolitaireMatchResult | null> {
    const resolved = await this.getPlayableOrRecoveredSolitaireMatch(matchId, userId);
    if (!resolved) {
      return null;
    }

    const previousMatch = resolved.match;
    const firstParticipant = previousMatch.participants.FIRST;
    const secondParticipant = previousMatch.participants.SECOND;
    const firstDeck = previousMatch.deckSnapshots.FIRST;
    const secondDeck = previousMatch.deckSnapshots.SECOND;
    const currentPointTable = await this.getCurrentPointTableRules();
    const firstPointReview = revalidateRuntimeDeckPointSnapshot(
      cloneDeck(firstDeck),
      firstDeck.pointValidation,
      currentPointTable
    );
    const secondPointReview = revalidateRuntimeDeckPointSnapshot(
      cloneDeck(secondDeck),
      secondDeck.pointValidation,
      currentPointTable
    );
    if (!firstPointReview.valid || !secondPointReview.valid) {
      throw new SolitaireMatchServiceError(
        'SOLITAIRE_RESTART_POINT_TABLE_CHANGED',
        '当前PT限制表已更新，原对局卡组不再合法，请返回准备页调整卡组',
        409
      );
    }
    const removed = await this.matchService.deleteMatch(matchId, {
      reason: 'SOLITAIRE_RESTARTED',
    });
    if (!removed) {
      throw new SolitaireMatchServiceError(
        'SOLITAIRE_RESTART_SEAL_FAILED',
        '当前对局封存失败，无法重新开始',
        500
      );
    }

    let restarted: OnlineMatchState;
    try {
      restarted = await this.matchService.createMatch({
        roomCode: `SOL-${this.idGenerator()}`,
        matchMode: 'SOLITAIRE',
        automationGameMode: 'SOLITAIRE',
        originKind: 'SOLITAIRE',
        originLabel: '对墙打',
        startedAt: this.now(),
        first: {
          userId: firstParticipant.userId,
          displayName: firstParticipant.displayName,
          deck: cloneDeck(firstDeck),
          deckId: firstDeck.sourceDeckId,
          deckName: firstDeck.sourceDeckName,
          deckSource: firstDeck.source,
          lockedAt: firstDeck.lockedAt,
          participantKind: firstParticipant.participantKind,
          ownerUserId: firstParticipant.ownerUserId,
          pointValidation: firstPointReview.facts,
        },
        second: {
          userId: secondParticipant.userId,
          displayName: secondParticipant.displayName,
          deck: cloneDeck(secondDeck),
          deckId: secondDeck.sourceDeckId,
          deckName: secondDeck.sourceDeckName,
          deckSource: secondDeck.source,
          lockedAt: secondDeck.lockedAt,
          participantKind: secondParticipant.participantKind,
          ownerUserId: secondParticipant.ownerUserId,
          pointValidation: secondPointReview.facts,
        },
      });
    } catch (error) {
      throw toSolitaireMatchServiceError(
        error,
        'SOLITAIRE_RESTART_CREATE_FAILED',
        '旧对局已封存，但新对局创建失败，请返回准备页重试'
      );
    }

    const snapshot = await this.matchService.getMatchSnapshot(restarted.matchId, userId);
    if (!snapshot || 'modified' in snapshot) {
      throw new SolitaireMatchServiceError(
        'SOLITAIRE_RESTART_SNAPSHOT_FAILED',
        '新对局已创建，但初始快照读取失败',
        500
      );
    }

    return {
      matchId: restarted.matchId,
      snapshot,
    };
  }

  private getPlayableSolitaireMatch(matchId: string, userId: string) {
    const match = this.matchService.getMatch(matchId);
    if (!match || !this.isPlayableSolitaireMatch(match, userId)) {
      return null;
    }
    return match;
  }

  private async getPlayableOrRecoveredSolitaireMatch(
    matchId: string,
    userId: string
  ): Promise<{
    readonly match: OnlineMatchState;
    readonly recovery: SolitaireRecoveredMatch['recovery'] | null;
  } | null> {
    const runtimeMatch = this.matchService.getMatch(matchId);
    if (runtimeMatch) {
      if (!this.isPlayableSolitaireMatch(runtimeMatch, userId)) {
        return null;
      }
      return {
        match: runtimeMatch,
        recovery: readPendingRuntimeRecovery(runtimeMatch),
      };
    }
    if (!this.recoveryService) {
      return null;
    }

    let recovered: SolitaireRecoveredMatch | null;
    try {
      recovered = await this.recoveryService.recoverMatch(matchId, userId);
    } catch (error) {
      throw toSolitaireMatchServiceError(
        error,
        'SOLITAIRE_MATCH_RECOVERY_FAILED',
        '对墙打运行态恢复失败'
      );
    }
    if (!recovered) {
      return null;
    }

    let restoredMatch: OnlineMatchState;
    try {
      restoredMatch = await this.matchService.restoreMatch(recovered.match);
    } catch (error) {
      throw toSolitaireMatchServiceError(
        error,
        'SOLITAIRE_MATCH_RECOVERY_REGISTER_FAILED',
        '对墙打恢复后的运行态注册失败'
      );
    }
    const playable =
      restoredMatch.matchMode === 'SOLITAIRE' &&
      restoredMatch.participants.FIRST.userId === userId &&
      restoredMatch.participants.FIRST.participantKind === 'USER'
        ? restoredMatch
        : this.getPlayableSolitaireMatch(matchId, userId);
    if (!playable) {
      return null;
    }

    return {
      match: playable,
      recovery: recovered.recovery,
    };
  }

  private isPlayableSolitaireMatch(match: OnlineMatchState, userId: string): boolean {
    if (match.matchMode !== 'SOLITAIRE') {
      return false;
    }

    const participant = match.participants.FIRST;
    return participant.userId === userId && participant.participantKind === 'USER';
  }

  private async buildRecoveredWriteRejectedResult(
    match: OnlineMatchState,
    userId: string,
    error: string
  ): Promise<OnlineCommandResult> {
    const snapshot = await this.matchService.getMatchSnapshot(match.matchId, userId);
    if (!snapshot || 'modified' in snapshot) {
      throw new SolitaireMatchServiceError(
        'SOLITAIRE_MATCH_RECOVERY_SNAPSHOT_FAILED',
        '对墙打恢复后快照读取失败',
        500
      );
    }

    return {
      success: false,
      error,
      snapshot,
    };
  }
}

export const solitaireMatchService = new SolitaireMatchService();

async function loadDefaultOpponentDeck(deckPath: string): Promise<DeckConfig> {
  const registry = await getPublishedCardRegistry();
  const resolvedPath = path.isAbsolute(deckPath) ? deckPath : path.resolve(process.cwd(), deckPath);
  const result = loadDeckFromYaml(resolvedPath, registry);
  if (!result.success || !result.deck) {
    throw new SolitaireMatchServiceError(
      'SOLITAIRE_DEFAULT_DECK_INVALID',
      result.errors[0] ?? '默认对手卡组加载失败',
      500
    );
  }
  return {
    mainDeck: [...result.deck.mainDeck],
    energyDeck: [...result.deck.energyDeck],
  };
}

function cloneDeck(deck: {
  readonly mainDeck: readonly DeckConfig['mainDeck'][number][];
  readonly energyDeck: readonly DeckConfig['energyDeck'][number][];
}): DeckConfig {
  return {
    mainDeck: [...deck.mainDeck],
    energyDeck: [...deck.energyDeck],
  };
}

function shouldRejectRecoveredWrite(recovery: SolitaireRecoveredMatch['recovery'] | null): boolean {
  return (
    recovery !== null &&
    (recovery.rolledBackFromPublicSeq !== null || recovery.rolledBackFromTimelineSeq !== null)
  );
}

function readPendingRuntimeRecovery(
  match: OnlineMatchState
): SolitaireRecoveredMatch['recovery'] | null {
  const recoveryNotice = match.recoveryNotice;
  return recoveryNotice
    ? {
        restoredAt: recoveryNotice.restoredAt,
        checkpointSeq: recoveryNotice.checkpointSeq,
        checkpointTimelineSeq: recoveryNotice.checkpointTimelineSeq,
        currentPublicSeq: recoveryNotice.currentPublicSeq,
        rolledBackFromPublicSeq: recoveryNotice.rolledBackFromPublicSeq,
        rolledBackFromTimelineSeq: recoveryNotice.rolledBackFromTimelineSeq,
      }
    : null;
}

function toSolitaireMatchServiceError(
  error: unknown,
  fallbackCode: string,
  fallbackMessage: string
): SolitaireMatchServiceError {
  const typedError = error as (Error & { code?: unknown; statusCode?: unknown }) | null;
  if (
    typedError instanceof Error &&
    typeof typedError.code === 'string' &&
    typeof typedError.statusCode === 'number'
  ) {
    return new SolitaireMatchServiceError(
      typedError.code,
      typedError.message,
      typedError.statusCode
    );
  }
  return new SolitaireMatchServiceError(fallbackCode, fallbackMessage, 500);
}
