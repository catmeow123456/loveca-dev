import { createGameSession, type GameSession } from '../../application/game-session.js';
import type { GameCommand } from '../../application/game-commands.js';
import type {
  DebugCommandResult,
  DebugMatchRecovery,
  DebugMatchSnapshot,
  DebugMatchStatus,
  DebugSeatDeckSelection,
  DebugSeatStatus,
} from '../../online/debug-types.js';
import type { DeckConfig } from '../../application/game-service.js';
import type { Seat } from '../../online/types.js';

interface DebugSeatState {
  playerId: string;
  playerName: string;
  deckName: string | null;
  deck: DeckConfig | null;
}

interface DebugMatchState {
  matchId: string;
  updatedAt: number;
  startedAt: number | null;
  session: GameSession | null;
  seats: Record<Seat, DebugSeatState>;
}

const debugMatches = new Map<string, DebugMatchState>();

export function getDebugMatchStatus(matchId: string): DebugMatchStatus {
  const match = getOrCreateDebugMatch(matchId);
  return {
    matchId: match.matchId,
    started: match.session !== null,
    startedAt: match.startedAt,
    updatedAt: match.updatedAt,
    seats: {
      FIRST: buildSeatStatus('FIRST', match.seats.FIRST),
      SECOND: buildSeatStatus('SECOND', match.seats.SECOND),
    },
  };
}

export function selectDebugSeatDeck(selection: DebugSeatDeckSelection & { matchId: string }): DebugMatchStatus {
  const match = getOrCreateDebugMatch(selection.matchId);
  const seatState = match.seats[selection.seat];

  seatState.playerName = selection.playerName.trim() || getDefaultSeatName(selection.seat);
  seatState.deckName = selection.deckName.trim() || '未命名卡组';
  seatState.deck = cloneDeck(selection.deck);

  recreateMatchSessionIfReady(match);
  touchDebugMatch(match);

  return getDebugMatchStatus(selection.matchId);
}

export function resetDebugMatch(matchId: string): DebugMatchStatus {
  const match = getOrCreateDebugMatch(matchId);
  match.session = null;
  match.startedAt = null;
  match.seats.FIRST.deck = null;
  match.seats.FIRST.deckName = null;
  match.seats.SECOND.deck = null;
  match.seats.SECOND.deckName = null;
  touchDebugMatch(match);
  return getDebugMatchStatus(matchId);
}

export function getDebugMatchSnapshot(matchId: string, seat: Seat): DebugMatchSnapshot | null {
  const match = getOrCreateDebugMatch(matchId);
  if (!match.session) {
    return null;
  }

  const playerId = match.seats[seat].playerId;
  const gameState = match.session.getStateForPlayer(playerId);
  const playerViewState = match.session.getPlayerViewState(playerId);

  if (!gameState || !playerViewState) {
    return null;
  }

  return {
    matchId,
    seat,
    playerId,
    seq: match.session.getCurrentPublicEventSeq(),
    gameState,
    playerViewState,
    publicEvents: match.session.getPublicEventsSince(0),
    privateEvents: match.session.getPrivateEventsSince(playerId, 0),
    snapshots: match.session.getSnapshotHistory(),
  };
}

export function getDebugMatchRecovery(
  matchId: string,
  seat: Seat,
  requestedSeq: number
): DebugMatchRecovery | null {
  const match = getOrCreateDebugMatch(matchId);
  if (!match.session) {
    return null;
  }

  const playerId = match.seats[seat].playerId;
  const playerRecovery = match.session.getPlayerRecoveryFrame(playerId, requestedSeq);
  if (!playerRecovery) {
    return null;
  }

  return {
    matchId,
    seat,
    playerId,
    requestedSeq,
    playerRecovery,
  };
}

export function executeDebugMatchCommand(
  matchId: string,
  seat: Seat,
  command: GameCommand
): DebugCommandResult {
  const match = getOrCreateDebugMatch(matchId);
  if (!match.session) {
    return {
      success: false,
      error: '调试对局尚未开始，请先让双方锁定卡组',
    };
  }

  const playerId = match.seats[seat].playerId;
  const result = match.session.executeCommand({
    ...command,
    playerId,
  });

  if (!result.success) {
    return {
      success: false,
      error: result.error,
    };
  }

  touchDebugMatch(match);
  return {
    success: true,
    snapshot: getDebugMatchSnapshot(matchId, seat) ?? undefined,
  };
}

export function advanceDebugMatchPhase(matchId: string, seat: Seat): DebugCommandResult {
  const match = getOrCreateDebugMatch(matchId);
  if (!match.session) {
    return {
      success: false,
      error: '调试对局尚未开始，请先让双方锁定卡组',
    };
  }

  const playerId = match.seats[seat].playerId;
  if (!match.session.isActivePlayer(playerId)) {
    return {
      success: false,
      error: '当前不是该玩家的推进时机',
    };
  }

  const result = match.session.advancePhase();
  if (!result.success) {
    return {
      success: false,
      error: result.error,
    };
  }

  touchDebugMatch(match);
  return {
    success: true,
    snapshot: getDebugMatchSnapshot(matchId, seat) ?? undefined,
  };
}

function getOrCreateDebugMatch(matchId: string): DebugMatchState {
  const existing = debugMatches.get(matchId);
  if (existing) {
    return existing;
  }

  const created: DebugMatchState = {
    matchId,
    updatedAt: Date.now(),
    startedAt: null,
    session: null,
    seats: {
      FIRST: {
        playerId: getDebugPlayerId('FIRST'),
        playerName: getDefaultSeatName('FIRST'),
        deckName: null,
        deck: null,
      },
      SECOND: {
        playerId: getDebugPlayerId('SECOND'),
        playerName: getDefaultSeatName('SECOND'),
        deckName: null,
        deck: null,
      },
    },
  };

  debugMatches.set(matchId, created);
  return created;
}

function recreateMatchSessionIfReady(match: DebugMatchState): void {
  if (!match.seats.FIRST.deck || !match.seats.SECOND.deck) {
    match.session = null;
    match.startedAt = null;
    return;
  }

  const session = createGameSession();
  session.createGame(
    match.matchId,
    match.seats.FIRST.playerId,
    match.seats.FIRST.playerName,
    match.seats.SECOND.playerId,
    match.seats.SECOND.playerName
  );

  const initialized = session.initializeGame(match.seats.FIRST.deck, match.seats.SECOND.deck);
  if (!initialized.success) {
    throw new Error(initialized.error ?? '调试对局初始化失败');
  }

  match.session = session;
  match.startedAt = Date.now();
}

function buildSeatStatus(seat: Seat, seatState: DebugSeatState): DebugSeatStatus {
  return {
    seat,
    playerId: seatState.playerId,
    playerName: seatState.playerName,
    deckName: seatState.deckName,
    ready: seatState.deck !== null,
  };
}

function getDefaultSeatName(seat: Seat): string {
  return seat === 'FIRST' ? '调试服务1' : '调试服务2';
}

function getDebugPlayerId(seat: Seat): string {
  return seat === 'FIRST' ? 'debug-player-first' : 'debug-player-second';
}

function touchDebugMatch(match: DebugMatchState): void {
  match.updatedAt = Date.now();
}

function cloneDeck(deck: DeckConfig): DeckConfig {
  return {
    mainDeck: [...deck.mainDeck],
    energyDeck: [...deck.energyDeck],
  };
}
