import type { DeckConfig as RuntimeDeckConfig } from '../../application/game-service.js';
import { DeckLoader, type DeckConfig as StoredDeckConfig } from '../../domain/card-data/deck-loader.js';
import type {
  OnlineRoomMemberPresence,
  OnlineRoomMemberRole,
  OnlineRoomStatus,
  OnlineRoomView,
  OnlineTurnOrderAgreementView,
  OnlineTurnOrderProposalView,
  TurnOrderProposalMode,
} from '../../online/release-types.js';
import type { Seat } from '../../online/types.js';
import { pool } from '../db/pool.js';
import { getPublishedCardRegistry } from './card-registry-service.js';
import {
  onlineMatchService,
  type CreateOnlineMatchParams,
  type OnlineMatchService,
} from './online-match-service.js';

const ROOM_STALE_TTL_MS = 30 * 60 * 1000;
const MATCH_DESTROY_AFTER_BOTH_LEFT_MS = 60 * 60 * 1000;

interface OnlineRoomMemberState {
  readonly userId: string;
  displayName: string;
  role: OnlineRoomMemberRole;
  presence: OnlineRoomMemberPresence;
  lockedDeckId: string | null;
  lockedDeckName: string | null;
  resolvedDeckConfig: RuntimeDeckConfig | null;
  lastSeenAt: number;
}

interface OnlineRoomTurnOrderProposalState extends OnlineTurnOrderProposalView {}

interface OnlineRoomTurnOrderAgreementState extends OnlineTurnOrderAgreementView {}

interface OnlineRoomState {
  readonly roomCode: string;
  status: OnlineRoomStatus;
  ownerUserId: string;
  readonly members: OnlineRoomMemberState[];
  turnOrderProposal: OnlineRoomTurnOrderProposalState | null;
  turnOrderAgreement: OnlineRoomTurnOrderAgreementState | null;
  matchId: string | null;
  seatAssignments: Partial<Record<Seat, string>>;
  updatedAt: number;
}

interface UserProfileSummary {
  readonly userId: string;
  readonly displayName: string;
}

interface OwnedDeckSummary {
  readonly deckId: string;
  readonly deckName: string;
  readonly runtimeDeck: RuntimeDeckConfig;
}

interface OnlineRoomServiceDeps {
  readonly now?: () => number;
  readonly matchService?: OnlineMatchService;
  readonly loadUserProfile?: (userId: string) => Promise<UserProfileSummary>;
  readonly loadOwnedDeck?: (userId: string, deckId: string) => Promise<OwnedDeckSummary>;
}

export class OnlineRoomServiceError extends Error {
  readonly code: string;
  readonly statusCode: number;

  constructor(code: string, message: string, statusCode = 400) {
    super(message);
    this.name = 'OnlineRoomServiceError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

export class OnlineRoomService {
  private readonly rooms = new Map<string, OnlineRoomState>();
  private readonly now: () => number;
  private readonly matchService: OnlineMatchService;
  private readonly loadUserProfile: (userId: string) => Promise<UserProfileSummary>;
  private readonly loadOwnedDeck: (userId: string, deckId: string) => Promise<OwnedDeckSummary>;

  constructor(deps: OnlineRoomServiceDeps = {}) {
    this.now = deps.now ?? (() => Date.now());
    this.matchService = deps.matchService ?? onlineMatchService;
    this.loadUserProfile = deps.loadUserProfile ?? defaultLoadUserProfile;
    this.loadOwnedDeck = deps.loadOwnedDeck ?? defaultLoadOwnedDeck;
  }

  async createRoom(roomCodeInput: string, userId: string): Promise<OnlineRoomView> {
    this.cleanupExpiredState();

    const roomCode = normalizeRoomCode(roomCodeInput);
    const existing = this.rooms.get(roomCode);
    if (existing) {
      const member = findMember(existing, userId);
      if (!member) {
        throw new OnlineRoomServiceError(
          'ONLINE_ROOM_EXISTS',
          '房间号已被占用，请直接加入该房间或更换房间号',
          409
        );
      }

      await this.reactivateMember(existing, member);
      return this.buildRoomView(existing, member);
    }

    const profile = await this.loadUserProfile(userId);
    const now = this.now();
    const room: OnlineRoomState = {
      roomCode,
      status: 'PREPARING',
      ownerUserId: userId,
      members: [
        {
          userId,
          displayName: profile.displayName,
          role: 'HOST',
          presence: 'ACTIVE',
          lockedDeckId: null,
          lockedDeckName: null,
          resolvedDeckConfig: null,
          lastSeenAt: now,
        },
      ],
      turnOrderProposal: null,
      turnOrderAgreement: null,
      matchId: null,
      seatAssignments: {},
      updatedAt: now,
    };

    this.rooms.set(roomCode, room);
    return this.buildRoomView(room, room.members[0]);
  }

  async joinRoom(roomCodeInput: string, userId: string): Promise<OnlineRoomView> {
    this.cleanupExpiredState();

    const room = this.getRoomState(roomCodeInput);
    const existingMember = findMember(room, userId);
    if (existingMember) {
      await this.reactivateMember(room, existingMember);
      return this.buildRoomView(room, existingMember);
    }

    if (room.status === 'IN_GAME') {
      throw new OnlineRoomServiceError(
        'ONLINE_ROOM_FORBIDDEN',
        '该房间对局已开始，不能以新成员身份加入',
        403
      );
    }

    if (room.members.length >= 2) {
      throw new OnlineRoomServiceError('ONLINE_ROOM_FULL', '房间已满员', 409);
    }

    const profile = await this.loadUserProfile(userId);
    const now = this.now();
    const member: OnlineRoomMemberState = {
      userId,
      displayName: profile.displayName,
      role: 'GUEST',
      presence: 'ACTIVE',
      lockedDeckId: null,
      lockedDeckName: null,
      resolvedDeckConfig: null,
      lastSeenAt: now,
    };
    room.members.push(member);
    touchRoom(room, now);

    return this.buildRoomView(room, member);
  }

  async getRoomView(roomCodeInput: string, userId: string): Promise<OnlineRoomView> {
    this.cleanupExpiredState();

    const room = this.getRoomState(roomCodeInput);
    const member = findMember(room, userId);
    if (!member) {
      throw new OnlineRoomServiceError('ONLINE_ROOM_FORBIDDEN', '当前用户不在该房间中', 403);
    }

    await this.reactivateMember(room, member);
    return this.buildRoomView(room, member);
  }

  async lockDeck(roomCodeInput: string, userId: string, deckId: string): Promise<OnlineRoomView> {
    this.cleanupExpiredState();

    const room = this.getRoomState(roomCodeInput);
    if (room.status === 'IN_GAME') {
      throw new OnlineRoomServiceError(
        'ONLINE_ROOM_FORBIDDEN',
        '对局已开始，不能再修改已锁定卡组',
        409
      );
    }

    const member = this.requireMember(room, userId);
    const deck = await this.loadOwnedDeck(userId, deckId.trim());

    member.lockedDeckId = deck.deckId;
    member.lockedDeckName = deck.deckName;
    member.resolvedDeckConfig = deck.runtimeDeck;
    member.presence = 'ACTIVE';
    member.lastSeenAt = this.now();

    room.turnOrderProposal = null;
    room.turnOrderAgreement = null;
    room.status = 'PREPARING';
    touchRoom(room, member.lastSeenAt);

    return this.buildRoomView(room, member);
  }

  async proposeTurnOrder(
    roomCodeInput: string,
    userId: string,
    proposal: TurnOrderProposalMode
  ): Promise<OnlineRoomView> {
    this.cleanupExpiredState();

    const room = this.getRoomState(roomCodeInput);
    const member = this.requireMember(room, userId);
    if (member.role !== 'HOST') {
      throw new OnlineRoomServiceError(
        'ONLINE_TURN_ORDER_FORBIDDEN',
        '只有房主可以发起先后手提议',
        403
      );
    }

    ensureBothDecksLocked(room);

    const now = this.now();
    room.turnOrderProposal = {
      proposal,
      proposedByUserId: userId,
      proposedAt: now,
    };
    room.turnOrderAgreement = null;
    room.status = 'READY';
    member.presence = 'ACTIVE';
    member.lastSeenAt = now;
    touchRoom(room, now);

    return this.buildRoomView(room, member);
  }

  async respondTurnOrder(
    roomCodeInput: string,
    userId: string,
    accepted: boolean
  ): Promise<OnlineRoomView> {
    this.cleanupExpiredState();

    const room = this.getRoomState(roomCodeInput);
    const member = this.requireMember(room, userId);
    if (member.role !== 'GUEST') {
      throw new OnlineRoomServiceError(
        'ONLINE_TURN_ORDER_FORBIDDEN',
        '只有客方可以响应先后手提议',
        403
      );
    }

    ensureBothDecksLocked(room);
    if (!room.turnOrderProposal) {
      throw new OnlineRoomServiceError(
        'ONLINE_TURN_ORDER_FORBIDDEN',
        '当前没有待确认的先后手提议',
        409
      );
    }

    const now = this.now();
    room.turnOrderAgreement = {
      accepted,
      respondedByUserId: userId,
      respondedAt: now,
    };
    member.presence = 'ACTIVE';
    member.lastSeenAt = now;

    if (!accepted) {
      room.status = 'READY';
      touchRoom(room, now);
      return this.buildRoomView(room, member);
    }

    const match = this.startMatch(room);
    room.matchId = match.matchId;
    room.status = 'IN_GAME';
    touchRoom(room, now);

    return this.buildRoomView(room, member);
  }

  async leaveRoom(roomCodeInput: string, userId: string): Promise<{ room: OnlineRoomView | null }> {
    this.cleanupExpiredState();

    const room = this.getRoomState(roomCodeInput);
    const member = this.requireMember(room, userId);
    const now = this.now();

    if (room.status === 'IN_GAME') {
      member.presence = 'LEFT';
      member.lastSeenAt = now;
      touchRoom(room, now);

      return {
        room: this.buildRoomView(room, member),
      };
    }

    const index = room.members.findIndex((candidate) => candidate.userId === userId);
    room.members.splice(index, 1);

    if (room.members.length === 0) {
      this.rooms.delete(room.roomCode);
      return { room: null };
    }

    if (room.ownerUserId === userId) {
      const nextOwner = room.members[0];
      nextOwner.role = 'HOST';
      room.ownerUserId = nextOwner.userId;
      if (room.members[1]) {
        room.members[1].role = 'GUEST';
      }
    }

    room.turnOrderProposal = null;
    room.turnOrderAgreement = null;
    room.status = 'PREPARING';
    touchRoom(room, now);

    return {
      room: this.buildRoomView(room, room.members[0]),
    };
  }

  getRoomIfPresent(roomCodeInput: string): OnlineRoomView | null {
    this.cleanupExpiredState();

    const roomCode = normalizeRoomCode(roomCodeInput);
    const room = this.rooms.get(roomCode);
    if (!room || room.members.length === 0) {
      return null;
    }

    return this.buildRoomView(room, room.members[0]);
  }

  clear(): void {
    this.rooms.clear();
  }

  private getRoomState(roomCodeInput: string): OnlineRoomState {
    const roomCode = normalizeRoomCode(roomCodeInput);
    const room = this.rooms.get(roomCode);
    if (!room) {
      throw new OnlineRoomServiceError('ONLINE_ROOM_NOT_FOUND', '房间不存在或已失效', 404);
    }
    return room;
  }

  private requireMember(room: OnlineRoomState, userId: string): OnlineRoomMemberState {
    const member = findMember(room, userId);
    if (!member) {
      throw new OnlineRoomServiceError('ONLINE_ROOM_FORBIDDEN', '当前用户不在该房间中', 403);
    }
    return member;
  }

  private async reactivateMember(
    room: OnlineRoomState,
    member: OnlineRoomMemberState
  ): Promise<void> {
    const profile = await this.loadUserProfile(member.userId);
    const now = this.now();
    member.displayName = profile.displayName;
    member.presence = 'ACTIVE';
    member.lastSeenAt = now;
    touchRoom(room, now);
  }

  private buildRoomView(room: OnlineRoomState, viewer: OnlineRoomMemberState): OnlineRoomView {
    const members = [...room.members].sort((left, right) => {
      const roleRank = left.role === right.role ? 0 : left.role === 'HOST' ? -1 : 1;
      if (roleRank !== 0) {
        return roleRank;
      }
      return left.userId.localeCompare(right.userId);
    });

    return {
      roomCode: room.roomCode,
      status: room.status,
      ownerUserId: room.ownerUserId,
      currentUserId: viewer.userId,
      currentUserRole: viewer.role,
      currentUserPresence: viewer.presence,
      currentUserSeat: getAssignedSeat(room, viewer.userId) ?? undefined,
      members: members.map((member) => ({
        userId: member.userId,
        displayName: member.displayName,
        role: member.role,
        presence: member.presence,
        lockedDeckId: member.lockedDeckId,
        lockedDeckName: member.lockedDeckName,
        ready: member.resolvedDeckConfig !== null,
        seat: getAssignedSeat(room, member.userId) ?? undefined,
      })),
      turnOrderProposal: room.turnOrderProposal,
      turnOrderAgreement: room.turnOrderAgreement,
      matchId: room.matchId,
      updatedAt: room.updatedAt,
    };
  }

  private startMatch(room: OnlineRoomState) {
    const host = room.members.find((member) => member.role === 'HOST');
    const guest = room.members.find((member) => member.role === 'GUEST');
    if (!host || !guest || !host.resolvedDeckConfig || !guest.resolvedDeckConfig) {
      throw new OnlineRoomServiceError('ONLINE_MATCH_GONE', '房间状态异常，无法开始对局', 409);
    }
    const hostDeck = host.resolvedDeckConfig;
    const guestDeck = guest.resolvedDeckConfig;

    const firstIsHost = room.turnOrderProposal?.proposal === 'HOST_FIRST';
    const firstMember = firstIsHost ? host : guest;
    const secondMember = firstIsHost ? guest : host;

    const params: CreateOnlineMatchParams = {
      roomCode: room.roomCode,
      startedAt: this.now(),
      first: {
        userId: firstMember.userId,
        displayName: firstMember.displayName,
        deck: firstMember.userId === host.userId ? hostDeck : guestDeck,
      },
      second: {
        userId: secondMember.userId,
        displayName: secondMember.displayName,
        deck: secondMember.userId === host.userId ? hostDeck : guestDeck,
      },
    };

    const match = this.matchService.createMatch(params);
    room.seatAssignments = {
      FIRST: firstMember.userId,
      SECOND: secondMember.userId,
    };

    return match;
  }

  private cleanupExpiredState(): void {
    const now = this.now();

    for (const [roomCode, room] of this.rooms) {
      if (room.status === 'IN_GAME') {
        const bothPlayersLeft = room.members.length > 0 && room.members.every(
          (member) => member.presence === 'LEFT'
        );
        const matchStartedAt = room.matchId ? this.matchService.getMatch(room.matchId)?.startedAt : null;
        const shouldDestroyMatch =
          bothPlayersLeft &&
          typeof matchStartedAt === 'number' &&
          now - matchStartedAt >= MATCH_DESTROY_AFTER_BOTH_LEFT_MS;
        if (shouldDestroyMatch) {
          if (room.matchId) {
            this.matchService.deleteMatch(room.matchId);
          }
          this.rooms.delete(roomCode);
        }
        continue;
      }

      if (room.members.every((member) => now - member.lastSeenAt > ROOM_STALE_TTL_MS)) {
        this.rooms.delete(roomCode);
      }
    }

    const activeMatchIds = new Set<string>();
    for (const room of this.rooms.values()) {
      if (room.matchId) {
        activeMatchIds.add(room.matchId);
      }
    }
    this.matchService.cleanupExpiredMatches(activeMatchIds, now);
  }
}

export const onlineRoomService = new OnlineRoomService();

function normalizeRoomCode(input: string): string {
  const roomCode = input.trim().toUpperCase();
  if (!/^[A-Z0-9]{4,12}$/.test(roomCode)) {
    throw new OnlineRoomServiceError(
      'ONLINE_ROOM_INVALID',
      '房间号必须为 4 到 12 位的大写字母或数字',
      400
    );
  }
  return roomCode;
}

function findMember(room: OnlineRoomState, userId: string): OnlineRoomMemberState | undefined {
  return room.members.find((member) => member.userId === userId);
}

function getAssignedSeat(room: OnlineRoomState, userId: string): Seat | null {
  if (room.seatAssignments.FIRST === userId) {
    return 'FIRST';
  }
  if (room.seatAssignments.SECOND === userId) {
    return 'SECOND';
  }
  return null;
}

function touchRoom(room: OnlineRoomState, updatedAt: number): void {
  room.updatedAt = updatedAt;
}

function ensureBothDecksLocked(room: OnlineRoomState): void {
  if (room.members.length !== 2 || room.members.some((member) => !member.resolvedDeckConfig)) {
    throw new OnlineRoomServiceError(
      'ONLINE_DECK_INVALID',
      '双方都锁定合法卡组后才能继续准备流程',
      409
    );
  }
}

async function defaultLoadUserProfile(userId: string): Promise<UserProfileSummary> {
  const { rows } = await pool.query<{ username: string; display_name: string | null }>(
    'SELECT username, display_name FROM profiles WHERE id = $1 LIMIT 1',
    [userId]
  );

  if (rows.length === 0) {
    throw new OnlineRoomServiceError('ONLINE_ROOM_FORBIDDEN', '用户资料不存在', 404);
  }

  return {
    userId,
    displayName: rows[0].display_name?.trim() || rows[0].username,
  };
}

async function defaultLoadOwnedDeck(userId: string, deckId: string): Promise<OwnedDeckSummary> {
  const { rows } = await pool.query<{
    id: string;
    name: string;
    description: string | null;
    main_deck: Array<{ card_code: string; count: number; card_type?: 'MEMBER' | 'LIVE' }>;
    energy_deck: Array<{ card_code: string; count: number }>;
    is_valid: boolean;
  }>(
    'SELECT id, name, description, main_deck, energy_deck, is_valid FROM decks WHERE id = $1 AND user_id = $2 LIMIT 1',
    [deckId, userId]
  );

  if (rows.length === 0) {
    throw new OnlineRoomServiceError('ONLINE_DECK_INVALID', '只能锁定当前用户自己的云端卡组', 404);
  }

  const deck = rows[0];
  if (!deck.is_valid) {
    throw new OnlineRoomServiceError('ONLINE_DECK_INVALID', '只能锁定合法卡组', 409);
  }

  const registry = await getPublishedCardRegistry();
  const loader = new DeckLoader(registry);
  const loadResult = loader.loadFromConfig(toStoredDeckConfig(deck));
  if (!loadResult.success || !loadResult.deck) {
    throw new OnlineRoomServiceError(
      'ONLINE_DECK_INVALID',
      loadResult.errors[0] ?? '卡组解析失败',
      409
    );
  }

  return {
    deckId: deck.id,
    deckName: deck.name,
    runtimeDeck: {
      mainDeck: [...loadResult.deck.mainDeck],
      energyDeck: [...loadResult.deck.energyDeck],
    },
  };
}

function toStoredDeckConfig(deck: {
  name: string;
  description: string | null;
  main_deck: Array<{ card_code: string; count: number; card_type?: 'MEMBER' | 'LIVE' }>;
  energy_deck: Array<{ card_code: string; count: number }>;
}): StoredDeckConfig {
  return {
    player_name: deck.name,
    description: deck.description ?? undefined,
    main_deck: {
      members: deck.main_deck.filter((entry) => entry.card_type === 'MEMBER'),
      lives: deck.main_deck.filter((entry) => entry.card_type === 'LIVE'),
    },
    energy_deck: [...deck.energy_deck],
  };
}
