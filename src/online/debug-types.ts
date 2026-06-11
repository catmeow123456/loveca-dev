import type { DeckConfig } from '../application/game-service.js';
import type { GameCommand } from '../application/game-commands.js';
import type { Seat } from './types.js';
import type { RemoteCommandResult, RemoteMatchHistorySnapshot } from './remote-match-types.js';

export interface DebugSeatDeckSelection {
  readonly seat: Seat;
  readonly playerName: string;
  readonly deckName: string;
  readonly deck: DeckConfig;
}

export interface DebugSeatStatus {
  readonly seat: Seat;
  readonly playerId: string;
  readonly playerName: string;
  readonly deckName: string | null;
  readonly ready: boolean;
}

export interface DebugMatchStatus {
  readonly matchId: string;
  readonly started: boolean;
  readonly startedAt: number | null;
  readonly updatedAt: number;
  readonly seats: Readonly<Record<Seat, DebugSeatStatus>>;
}

export type DebugMatchSnapshot = RemoteMatchHistorySnapshot;

export interface DebugCommandRequest {
  readonly seat: Seat;
  readonly command: GameCommand;
}

export type DebugCommandResult = RemoteCommandResult<DebugMatchSnapshot>;

export interface DebugAdvancePhaseRequest {
  readonly seat: Seat;
}
