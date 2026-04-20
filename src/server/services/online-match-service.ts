import { randomUUID } from 'node:crypto';
import { createGameSession, type GameSession } from '../../application/game-session.js';
import type { GameCommand } from '../../application/game-commands.js';
import type { DeckConfig } from '../../application/game-service.js';
import type {
  OnlineCommandResult,
  OnlineMatchSnapshot,
  Seat,
} from '../../online/index.js';

const MATCH_STALE_TTL_MS = 30 * 60 * 1000;

export interface OnlineMatchParticipant {
  readonly userId: string;
  readonly playerId: string;
  readonly displayName: string;
  readonly seat: Seat;
}

export interface CreateOnlineMatchParams {
  readonly roomCode: string;
  readonly startedAt?: number;
  readonly first: {
    readonly userId: string;
    readonly displayName: string;
    readonly deck: DeckConfig;
  };
  readonly second: {
    readonly userId: string;
    readonly displayName: string;
    readonly deck: DeckConfig;
  };
}

export interface OnlineMatchState {
  readonly matchId: string;
  readonly roomCode: string;
  readonly session: GameSession;
  readonly participants: Readonly<Record<Seat, OnlineMatchParticipant>>;
  readonly startedAt: number;
  updatedAt: number;
  lastActivityAt: number;
}

export class OnlineMatchService {
  private readonly matches = new Map<string, OnlineMatchState>();

  createMatch(params: CreateOnlineMatchParams): OnlineMatchState {
    const matchId = randomUUID();
    const session = createGameSession();
    const firstPlayerId = `${matchId}:FIRST:${params.first.userId}`;
    const secondPlayerId = `${matchId}:SECOND:${params.second.userId}`;

    session.createGame(
      matchId,
      firstPlayerId,
      params.first.displayName,
      secondPlayerId,
      params.second.displayName
    );

    const initialized = session.initializeGame(
      cloneRuntimeDeck(params.first.deck),
      cloneRuntimeDeck(params.second.deck)
    );
    if (!initialized.success) {
      throw new Error(initialized.error ?? '正式联机对局初始化失败');
    }

    const now = params.startedAt ?? Date.now();
    const state: OnlineMatchState = {
      matchId,
      roomCode: params.roomCode,
      session,
      participants: {
        FIRST: {
          userId: params.first.userId,
          playerId: firstPlayerId,
          displayName: params.first.displayName,
          seat: 'FIRST',
        },
        SECOND: {
          userId: params.second.userId,
          playerId: secondPlayerId,
          displayName: params.second.displayName,
          seat: 'SECOND',
        },
      },
      startedAt: now,
      updatedAt: now,
      lastActivityAt: now,
    };

    this.matches.set(matchId, state);
    return state;
  }

  getMatch(matchId: string): OnlineMatchState | null {
    return this.matches.get(matchId) ?? null;
  }

  getMatchSnapshot(matchId: string, userId: string): OnlineMatchSnapshot | null {
    const match = this.matches.get(matchId);
    if (!match) {
      return null;
    }

    const participant = getParticipantByUserId(match, userId);
    if (!participant) {
      return null;
    }

    touchMatch(match);
    return buildSnapshot(match, participant);
  }

  executeCommand(matchId: string, userId: string, command: GameCommand): OnlineCommandResult | null {
    const match = this.matches.get(matchId);
    if (!match) {
      return null;
    }

    const participant = getParticipantByUserId(match, userId);
    if (!participant) {
      return null;
    }

    const result = match.session.executeCommand({
      ...command,
      playerId: participant.playerId,
    });

    touchMatch(match);
    if (!result.success) {
      return {
        success: false,
        error: result.error,
      };
    }

    return {
      success: true,
      snapshot: buildSnapshot(match, participant),
    };
  }

  advancePhase(matchId: string, userId: string): OnlineCommandResult | null {
    const match = this.matches.get(matchId);
    if (!match) {
      return null;
    }

    const participant = getParticipantByUserId(match, userId);
    if (!participant) {
      return null;
    }

    if (!match.session.isActivePlayer(participant.playerId)) {
      touchMatch(match);
      return {
        success: false,
        error: '当前不是该玩家的推进时机',
      };
    }

    const result = match.session.advancePhase();
    touchMatch(match);
    if (!result.success) {
      return {
        success: false,
        error: result.error,
      };
    }

    return {
      success: true,
      snapshot: buildSnapshot(match, participant),
    };
  }

  deleteMatch(matchId: string): void {
    this.matches.delete(matchId);
  }

  cleanupExpiredMatches(activeMatchIds: ReadonlySet<string>, now = Date.now()): void {
    for (const [matchId, match] of this.matches) {
      if (activeMatchIds.has(matchId)) {
        continue;
      }

      if (now - match.lastActivityAt > MATCH_STALE_TTL_MS) {
        this.matches.delete(matchId);
      }
    }
  }

  clear(): void {
    this.matches.clear();
  }
}

export const onlineMatchService = new OnlineMatchService();

function buildSnapshot(
  match: OnlineMatchState,
  participant: OnlineMatchParticipant
): OnlineMatchSnapshot {
  const playerViewState = match.session.getPlayerViewState(participant.playerId);
  if (!playerViewState) {
    throw new Error('联机玩家视图不存在');
  }

  return {
    matchId: match.matchId,
    seat: participant.seat,
    playerId: participant.playerId,
    seq: match.session.getCurrentPublicEventSeq(),
    playerViewState,
    publicEvents: match.session.getPublicEventsSince(0),
    privateEvents: match.session.getPrivateEventsSince(participant.playerId, 0),
    snapshots: match.session.getSnapshotHistory(),
  };
}

function cloneRuntimeDeck(deck: DeckConfig): DeckConfig {
  return {
    mainDeck: [...deck.mainDeck],
    energyDeck: [...deck.energyDeck],
  };
}

function getParticipantByUserId(
  match: OnlineMatchState,
  userId: string
): OnlineMatchParticipant | null {
  if (match.participants.FIRST.userId === userId) {
    return match.participants.FIRST;
  }
  if (match.participants.SECOND.userId === userId) {
    return match.participants.SECOND;
  }
  return null;
}

function touchMatch(match: OnlineMatchState): void {
  const now = Date.now();
  match.updatedAt = now;
  match.lastActivityAt = now;
}
