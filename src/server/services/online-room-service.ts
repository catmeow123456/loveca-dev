import type { DeckConfig as RuntimeDeckConfig } from '../../application/game-service.js';
import { DeckLoader } from '../../domain/card-data/deck-loader.js';
import type {
  OpeningRpsGesture,
  OpeningTurnOrderChoice,
  OnlineAdminRoomSummary,
  OnlineOpeningRpsView,
  OnlineRestartRequestView,
  OnlineRoomSpectatorEntryView,
  OnlineRoomMemberPresence,
  OnlineRoomMemberRole,
  OnlineRoomStatus,
  OnlineRoomView,
  OnlineSpectatorLinkView,
} from '../../online/release-types.js';
import type { Seat } from '../../online/types.js';
import { pool } from '../db/pool.js';
import {
  DeckPayloadValidationError,
  prepareDeckPayloadForStorage,
} from './deck-storage-service.js';
import {
  OnlineMatchServiceError,
  onlineMatchService,
  type CreateOnlineMatchParams,
  type OnlineMatchCleanupSummary,
  type OnlineMatchService,
} from './online-match-service.js';

const MEMBER_PRESENCE_STALE_MS = 15 * 1000;
const ROOM_DESTROY_AFTER_ALL_ABSENT_MS = 60 * 1000;
const RESTART_REQUEST_TTL_MS = 60 * 1000;

interface OnlineRoomMemberState {
  readonly userId: string;
  displayName: string;
  role: OnlineRoomMemberRole;
  presence: OnlineRoomMemberPresence;
  lockedDeckId: string | null;
  lockedDeckName: string | null;
  resolvedDeckConfig: RuntimeDeckConfig | null;
  lockedDeckAt: number | null;
  startReady: boolean;
  lastSeenAt: number;
}

type OnlineOpeningRpsState = OnlineOpeningRpsView;

type OnlineRestartRequestState = OnlineRestartRequestView;

interface OnlineRoomState {
  readonly roomCode: string;
  status: OnlineRoomStatus;
  ownerUserId: string;
  readonly members: OnlineRoomMemberState[];
  openingRps: OnlineOpeningRpsState | null;
  restartRequest: OnlineRestartRequestState | null;
  matchId: string | null;
  seatAssignments: Partial<Record<Seat, string>>;
  spectatorRoomEntryEnabled: Partial<Record<Seat, boolean>>;
  updatedAt: number;
}

export interface UserProfileSummary {
  readonly userId: string;
  readonly displayName: string;
}

export interface OwnedDeckSummary {
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

export interface OnlineRoomRuntimeCleanupSummary {
  readonly checkedRoomCount: number;
  readonly destroyedRoomCount: number;
  readonly matchCleanup: OnlineMatchCleanupSummary;
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
    this.loadUserProfile = deps.loadUserProfile ?? loadUserProfileForOnlineMatch;
    this.loadOwnedDeck = deps.loadOwnedDeck ?? loadOwnedDeckForOnlineMatch;
  }

  async createRoom(roomCodeInput: string, userId: string): Promise<OnlineRoomView> {
    const roomCode = normalizeRoomCode(roomCodeInput);
    await this.cleanupExpiredState();

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
          lockedDeckAt: null,
          startReady: false,
          lastSeenAt: now,
        },
      ],
      openingRps: null,
      restartRequest: null,
      matchId: null,
      seatAssignments: {},
      spectatorRoomEntryEnabled: {},
      updatedAt: now,
    };

    this.rooms.set(roomCode, room);
    return this.buildRoomView(room, room.members[0]);
  }

  async joinRoom(roomCodeInput: string, userId: string): Promise<OnlineRoomView> {
    await this.cleanupExpiredState();

    const room = this.getRoomState(roomCodeInput);
    const existingMember = findMember(room, userId);
    if (existingMember) {
      await this.reactivateMember(room, existingMember);
      return this.buildRoomView(room, existingMember);
    }

    if (room.status === 'OPENING' || room.status === 'IN_GAME') {
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
      lockedDeckAt: null,
      startReady: false,
      lastSeenAt: now,
    };
    room.members.push(member);
    touchRoom(room, now);

    return this.buildRoomView(room, member);
  }

  async getRoomView(roomCodeInput: string, userId: string): Promise<OnlineRoomView> {
    const roomCode = normalizeRoomCode(roomCodeInput);
    const activeInGameRoom = this.rooms.get(roomCode);
    const activeInGameMember = activeInGameRoom ? findMember(activeInGameRoom, userId) : undefined;
    if (
      activeInGameRoom?.status === 'IN_GAME' &&
      activeInGameMember &&
      activeInGameRoom.matchId &&
      this.matchService.getMatch(activeInGameRoom.matchId)
    ) {
      this.expireRestartRequestIfNeeded(activeInGameRoom, this.now());
      await this.reactivateMember(activeInGameRoom, activeInGameMember);
      return this.buildRoomView(activeInGameRoom, activeInGameMember);
    }

    await this.cleanupExpiredState();

    const room = this.getRoomState(roomCode);
    const member = findMember(room, userId);
    if (!member) {
      throw new OnlineRoomServiceError('ONLINE_ROOM_FORBIDDEN', '当前用户不在该房间中', 403);
    }

    await this.reactivateMember(room, member);
    return this.buildRoomView(room, member);
  }

  async lockDeck(roomCodeInput: string, userId: string, deckId: string): Promise<OnlineRoomView> {
    await this.cleanupExpiredState();

    const room = this.getRoomState(roomCodeInput);
    if (room.status === 'OPENING' || room.status === 'IN_GAME') {
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
    member.lockedDeckAt = this.now();
    room.members.forEach((candidate) => {
      candidate.startReady = false;
    });
    member.presence = 'ACTIVE';
    member.lastSeenAt = member.lockedDeckAt;

    room.openingRps = null;
    room.restartRequest = null;
    room.status = 'PREPARING';
    touchRoom(room, member.lastSeenAt);

    return this.buildRoomView(room, member);
  }

  async markReadyToStart(roomCodeInput: string, userId: string): Promise<OnlineRoomView> {
    await this.cleanupExpiredState();

    const room = this.getRoomState(roomCodeInput);
    if (room.status === 'OPENING' || room.status === 'IN_GAME') {
      throw new OnlineRoomServiceError('ONLINE_READY_FORBIDDEN', '对局已开始，不能重复准备', 409);
    }

    const member = this.requireMember(room, userId);
    ensureBothDecksLocked(room);
    ensureBothMembersActive(room);
    const now = this.now();
    member.startReady = true;
    member.presence = 'ACTIVE';
    member.lastSeenAt = now;
    room.openingRps = null;
    room.restartRequest = null;
    room.status = room.members.every((candidate) => candidate.startReady) ? 'OPENING' : 'READY';
    if (room.status === 'OPENING') {
      room.openingRps = createOpeningRpsState(room, 1, now);
    }
    touchRoom(room, now);

    return this.buildRoomView(room, member);
  }

  async submitOpeningRps(
    roomCodeInput: string,
    userId: string,
    gesture: OpeningRpsGesture
  ): Promise<OnlineRoomView> {
    await this.cleanupExpiredState();

    const room = this.getRoomState(roomCodeInput);
    const member = this.requireMember(room, userId);
    ensureOpeningRpsRoom(room);
    const current = room.openingRps!;
    if (current.winnerUserId) {
      throw new OnlineRoomServiceError(
        'ONLINE_OPENING_FORBIDDEN',
        '本轮猜拳已结束，等待胜者决定先后手',
        409
      );
    }
    const previousChoice = current.choices.find((choice) => choice.userId === userId);
    if (previousChoice?.selected) {
      if (previousChoice.gesture === gesture) {
        member.presence = 'ACTIVE';
        member.lastSeenAt = this.now();
        touchRoom(room, member.lastSeenAt);
        return this.buildRoomView(room, member);
      }

      throw new OnlineRoomServiceError('ONLINE_OPENING_FORBIDDEN', '本轮猜拳手势已经锁定', 409);
    }

    const now = this.now();
    const choices = current.choices.map((choice) =>
      choice.userId === userId ? { userId, selected: true, gesture } : choice
    );
    const allSelected = choices.every((choice) => choice.selected && choice.gesture);
    room.openingRps = allSelected
      ? revealOpeningRpsRound(current, choices, now)
      : {
          ...current,
          choices,
        };
    member.presence = 'ACTIVE';
    member.lastSeenAt = now;
    touchRoom(room, now);

    return this.buildRoomView(room, member);
  }

  async chooseOpeningTurnOrder(
    roomCodeInput: string,
    userId: string,
    choice: OpeningTurnOrderChoice
  ): Promise<OnlineRoomView> {
    await this.cleanupExpiredState();

    const room = this.getRoomState(roomCodeInput);
    const member = this.requireMember(room, userId);
    ensureOpeningRpsRoom(room);
    const opening = room.openingRps!;
    const now = this.now();

    if (!opening.winnerUserId || opening.chooserUserId !== userId) {
      throw new OnlineRoomServiceError(
        'ONLINE_OPENING_FORBIDDEN',
        '只有猜拳胜者可以决定先后手',
        403
      );
    }

    const winnerFirst = choice === 'SELF_FIRST';
    const firstUserId = winnerFirst ? userId : getOpponentUserId(room, userId);
    if (!firstUserId) {
      throw new OnlineRoomServiceError('ONLINE_MATCH_GONE', '房间状态异常，无法开始对局', 409);
    }

    try {
      await this.startMatchForRoom(room, firstUserId, now);
    } catch (error) {
      room.status = 'OPENING';
      touchRoom(room, now);
      throw error;
    }

    member.presence = 'ACTIVE';
    member.lastSeenAt = now;
    return this.buildRoomView(room, member);
  }

  async replayOpeningRps(roomCodeInput: string, userId: string): Promise<OnlineRoomView> {
    await this.cleanupExpiredState();

    const room = this.getRoomState(roomCodeInput);
    const member = this.requireMember(room, userId);
    ensureOpeningRpsRoom(room);
    const opening = room.openingRps!;
    if (!opening.revealed || opening.winnerUserId) {
      throw new OnlineRoomServiceError('ONLINE_OPENING_FORBIDDEN', '当前猜拳结果不能重来', 409);
    }

    const now = this.now();
    room.openingRps = createOpeningRpsState(room, opening.round + 1, now);
    member.presence = 'ACTIVE';
    member.lastSeenAt = now;
    touchRoom(room, now);

    return this.buildRoomView(room, member);
  }

  async requestRestart(roomCodeInput: string, userId: string): Promise<OnlineRoomView> {
    await this.cleanupExpiredState();

    const room = this.getRoomState(roomCodeInput);
    const member = this.requireMember(room, userId);
    const now = this.now();
    this.expireRestartRequestIfNeeded(room, now);
    this.ensureCanRestart(room);

    if (room.restartRequest) {
      if (room.restartRequest.requesterUserId === userId) {
        member.presence = 'ACTIVE';
        member.lastSeenAt = now;
        touchRoom(room, now);
        return this.buildRoomView(room, member);
      }

      throw new OnlineRoomServiceError('ONLINE_RESTART_CONFLICT', '已有重开请求待处理', 409);
    }

    const responder = room.members.find((candidate) => candidate.userId !== userId);
    if (!responder) {
      throw new OnlineRoomServiceError(
        'ONLINE_RESTART_FORBIDDEN',
        '需要双方都在房间中才能请求重开',
        409
      );
    }
    if (responder.presence !== 'ACTIVE') {
      throw new OnlineRoomServiceError(
        'ONLINE_RESTART_FORBIDDEN',
        '对手当前不在线，不能请求重开',
        409
      );
    }

    room.restartRequest = {
      requestId: `${room.roomCode}:restart:${now}`,
      requesterUserId: userId,
      responderUserId: responder.userId,
      matchId: room.matchId!,
      requestedAt: now,
      expiresAt: now + RESTART_REQUEST_TTL_MS,
    };
    member.presence = 'ACTIVE';
    member.lastSeenAt = now;
    touchRoom(room, now);

    return this.buildRoomView(room, member);
  }

  async acceptRestartRequest(
    roomCodeInput: string,
    userId: string,
    requestId: string
  ): Promise<OnlineRoomView> {
    await this.cleanupExpiredState();

    const room = this.getRoomState(roomCodeInput);
    const member = this.requireMember(room, userId);
    const now = this.now();
    this.expireRestartRequestIfNeeded(room, now);
    this.ensureCanRestart(room);
    const request = this.requireRestartRequest(room, requestId);
    if (request.responderUserId !== userId) {
      throw new OnlineRoomServiceError('ONLINE_RESTART_FORBIDDEN', '只有对手可以同意重开请求', 403);
    }

    const previousMatchId = room.matchId!;
    const previousDeleted = await this.matchService.deleteMatch(previousMatchId, {
      reason: 'ROOM_RESTART_ACCEPTED',
      now,
    });
    if (!previousDeleted) {
      throw new OnlineRoomServiceError(
        'ONLINE_RESTART_SEAL_FAILED',
        '无法重开对局：旧对局封存失败，请稍后重试',
        503
      );
    }

    room.matchId = null;
    room.seatAssignments = {};
    room.spectatorRoomEntryEnabled = {};
    room.members.forEach((candidate) => {
      candidate.startReady = false;
      candidate.presence = 'ACTIVE';
      candidate.lastSeenAt = now;
    });
    room.openingRps = null;
    room.restartRequest = null;
    room.status = 'PREPARING';
    member.presence = 'ACTIVE';
    member.lastSeenAt = now;
    touchRoom(room, now);

    return this.buildRoomView(room, member);
  }

  async rejectRestartRequest(
    roomCodeInput: string,
    userId: string,
    requestId: string
  ): Promise<OnlineRoomView> {
    await this.cleanupExpiredState();

    const room = this.getRoomState(roomCodeInput);
    const member = this.requireMember(room, userId);
    const now = this.now();
    this.expireRestartRequestIfNeeded(room, now);
    const request = this.requireRestartRequest(room, requestId);
    if (request.responderUserId !== userId) {
      throw new OnlineRoomServiceError('ONLINE_RESTART_FORBIDDEN', '只有对手可以拒绝重开请求', 403);
    }

    room.restartRequest = null;
    member.presence = 'ACTIVE';
    member.lastSeenAt = now;
    touchRoom(room, now);

    return this.buildRoomView(room, member);
  }

  async cancelRestartRequest(
    roomCodeInput: string,
    userId: string,
    requestId: string
  ): Promise<OnlineRoomView> {
    await this.cleanupExpiredState();

    const room = this.getRoomState(roomCodeInput);
    const member = this.requireMember(room, userId);
    const now = this.now();
    this.expireRestartRequestIfNeeded(room, now);
    const request = this.requireRestartRequest(room, requestId);
    if (request.requesterUserId !== userId) {
      throw new OnlineRoomServiceError(
        'ONLINE_RESTART_FORBIDDEN',
        '只有发起者可以取消重开请求',
        403
      );
    }

    room.restartRequest = null;
    member.presence = 'ACTIVE';
    member.lastSeenAt = now;
    touchRoom(room, now);

    return this.buildRoomView(room, member);
  }

  async leaveRoom(roomCodeInput: string, userId: string): Promise<{ room: OnlineRoomView | null }> {
    await this.cleanupExpiredState();

    const room = this.getRoomState(roomCodeInput);
    const member = this.requireMember(room, userId);
    const now = this.now();

    if (room.status === 'OPENING' || room.status === 'IN_GAME') {
      member.presence = 'LEFT';
      member.lastSeenAt = now;
      if (
        room.restartRequest?.requesterUserId === userId ||
        room.restartRequest?.responderUserId === userId
      ) {
        room.restartRequest = null;
      }
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

    room.openingRps = null;
    room.restartRequest = null;
    room.status = 'PREPARING';
    room.members.forEach((candidate) => {
      candidate.startReady = false;
    });
    touchRoom(room, now);

    return {
      room: this.buildRoomView(room, room.members[0]),
    };
  }

  async cleanupExpiredRuntimeState(): Promise<OnlineRoomRuntimeCleanupSummary> {
    return this.cleanupExpiredState();
  }

  touchInGameMemberByMatch(matchId: string, userId: string): void {
    const room =
      [...this.rooms.values()].find((candidate) => candidate.matchId === matchId) ?? null;
    if (!room || room.status !== 'IN_GAME') {
      return;
    }

    const member = findMember(room, userId);
    if (!member) {
      return;
    }

    const now = this.now();
    member.presence = 'ACTIVE';
    member.lastSeenAt = now;
    touchRoom(room, now);
  }

  async getRoomIfPresent(roomCodeInput: string): Promise<OnlineRoomView | null> {
    await this.cleanupExpiredState();

    const roomCode = normalizeRoomCode(roomCodeInput);
    const room = this.rooms.get(roomCode);
    if (!room || room.members.length === 0) {
      return null;
    }

    return this.buildRoomView(room, room.members[0]);
  }

  async getRoomSpectatorEntry(
    roomCodeInput: string,
    viewerUserId?: string | null
  ): Promise<OnlineRoomSpectatorEntryView | null> {
    await this.cleanupExpiredState();

    const roomCode = normalizeRoomCode(roomCodeInput);
    const room = this.rooms.get(roomCode);
    if (!room || room.members.length === 0) {
      return null;
    }
    this.assertUserCanEnterRoomCodeSpectator(room, viewerUserId);

    return buildSpectatorRoomEntryView(room, { onlyEnabledSeats: true });
  }

  async createRoomCodeSpectatorLink(
    roomCodeInput: string,
    viewerSeat: Seat,
    viewerUserId?: string | null
  ): Promise<OnlineSpectatorLinkView> {
    await this.cleanupExpiredState();

    const room = this.getRoomState(roomCodeInput);
    this.assertUserCanEnterRoomCodeSpectator(room, viewerUserId);
    if (room.status !== 'IN_GAME' || !room.matchId) {
      throw new OnlineRoomServiceError(
        'ONLINE_ROOM_SPECTATOR_UNAVAILABLE',
        '该房间当前不能通过房间号观战',
        404
      );
    }
    if (!room.seatAssignments[viewerSeat]) {
      throw new OnlineRoomServiceError(
        'ONLINE_ROOM_SPECTATOR_UNAVAILABLE',
        '该玩家视角当前不可观战',
        404
      );
    }
    if (room.spectatorRoomEntryEnabled[viewerSeat] !== true) {
      throw new OnlineRoomServiceError(
        'ONLINE_ROOM_SPECTATOR_CLOSED',
        '该玩家已关闭房间号观战',
        403
      );
    }

    const authorizedViewerSeats = getEnabledSpectatorSeats(room);
    const link = this.matchService.createRoomCodePlayerViewSpectatorLink(
      room.matchId,
      viewerSeat,
      authorizedViewerSeats
    );
    if (!link) {
      throw new OnlineRoomServiceError(
        'ONLINE_ROOM_SPECTATOR_UNAVAILABLE',
        '该玩家视角当前不可观战',
        404
      );
    }
    touchRoom(room, this.now());
    return link;
  }

  async setOwnRoomSpectatorEntry(
    roomCodeInput: string,
    userId: string,
    enabled: boolean
  ): Promise<OnlineRoomView> {
    await this.cleanupExpiredState();

    const room = this.getRoomState(roomCodeInput);
    const member = this.requireMember(room, userId);
    if (room.status !== 'IN_GAME' || !room.matchId) {
      throw new OnlineRoomServiceError(
        'ONLINE_ROOM_SPECTATOR_FORBIDDEN',
        '只有进行中的对局可以调整房间号观战',
        409
      );
    }
    const seat = getAssignedSeat(room, userId);
    if (!seat) {
      throw new OnlineRoomServiceError(
        'ONLINE_ROOM_SPECTATOR_FORBIDDEN',
        '当前用户没有可调整的玩家视角',
        403
      );
    }

    room.spectatorRoomEntryEnabled[seat] = enabled;
    this.matchService.setRoomCodeSpectatorSeats(room.matchId, getEnabledSpectatorSeats(room));

    const now = this.now();
    member.presence = 'ACTIVE';
    member.lastSeenAt = now;
    touchRoom(room, now);
    return this.buildRoomView(room, member);
  }

  private assertUserCanEnterRoomCodeSpectator(
    room: OnlineRoomState,
    viewerUserId?: string | null
  ): void {
    if (viewerUserId && findMember(room, viewerUserId)) {
      throw new OnlineRoomServiceError(
        'ONLINE_ROOM_SPECTATOR_FORBIDDEN',
        '当前账号不能通过房间号进入该观战入口',
        403
      );
    }
  }

  async listAdminRoomSummaries(): Promise<readonly OnlineAdminRoomSummary[]> {
    await this.cleanupExpiredState();

    const now = this.now();
    return [...this.rooms.values()]
      .filter((room) => room.members.length > 0)
      .sort(
        (left, right) =>
          right.updatedAt - left.updatedAt || left.roomCode.localeCompare(right.roomCode)
      )
      .map((room) => this.buildAdminRoomSummary(room, now));
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
        startReady: member.startReady,
        seat: getAssignedSeat(room, member.userId) ?? undefined,
      })),
      openingRps: buildOpeningRpsViewForViewer(room.openingRps, viewer.userId),
      restartRequest: room.restartRequest,
      matchId: room.matchId,
      spectatorRoomEntry: buildSpectatorRoomEntryView(room),
      spectatorPresence: room.matchId
        ? this.matchService.getSpectatorPresenceForMatch(room.matchId)
        : { total: 0, viewers: [] },
      updatedAt: room.updatedAt,
    };
  }

  private buildAdminRoomSummary(room: OnlineRoomState, now: number): OnlineAdminRoomSummary {
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
      members: members.map((member) => ({
        userId: member.userId,
        displayName: member.displayName,
        role: member.role,
        presence: member.presence,
        lockedDeckId: member.lockedDeckId,
        lockedDeckName: member.lockedDeckName,
        ready: member.resolvedDeckConfig !== null,
        startReady: member.startReady,
        seat: getAssignedSeat(room, member.userId) ?? undefined,
        lastSeenAt: member.lastSeenAt,
      })),
      openingRps: buildOpeningRpsViewForViewer(room.openingRps, null),
      restartRequest: room.restartRequest,
      matchId: room.matchId,
      match: room.matchId ? this.matchService.getAdminMatchSummary(room.matchId, now) : null,
      updatedAt: room.updatedAt,
    };
  }

  private async startMatch(room: OnlineRoomState, firstUserId: string) {
    const host = room.members.find((member) => member.role === 'HOST');
    const guest = room.members.find((member) => member.role === 'GUEST');
    if (!host || !guest || !host.resolvedDeckConfig || !guest.resolvedDeckConfig) {
      throw new OnlineRoomServiceError('ONLINE_MATCH_GONE', '房间状态异常，无法开始对局', 409);
    }
    const hostDeck = host.resolvedDeckConfig;
    const guestDeck = guest.resolvedDeckConfig;

    const firstMember =
      firstUserId === host.userId ? host : firstUserId === guest.userId ? guest : null;
    if (!firstMember) {
      throw new OnlineRoomServiceError('ONLINE_MATCH_GONE', '房间状态异常，无法开始对局', 409);
    }
    const secondMember = firstMember.userId === host.userId ? guest : host;

    const params: CreateOnlineMatchParams = {
      roomCode: room.roomCode,
      startedAt: this.now(),
      first: {
        userId: firstMember.userId,
        displayName: firstMember.displayName,
        deck: firstMember.userId === host.userId ? hostDeck : guestDeck,
        deckId: firstMember.lockedDeckId,
        deckName: firstMember.lockedDeckName,
        lockedAt: firstMember.lockedDeckAt,
      },
      second: {
        userId: secondMember.userId,
        displayName: secondMember.displayName,
        deck: secondMember.userId === host.userId ? hostDeck : guestDeck,
        deckId: secondMember.lockedDeckId,
        deckName: secondMember.lockedDeckName,
        lockedAt: secondMember.lockedDeckAt,
      },
    };

    const match = await this.matchService.createMatch(params);
    room.seatAssignments = {
      FIRST: firstMember.userId,
      SECOND: secondMember.userId,
    };

    return match;
  }

  private async startMatchForRoom(room: OnlineRoomState, firstUserId: string, now: number) {
    let match: Awaited<ReturnType<OnlineMatchService['createMatch']>>;
    try {
      match = await this.startMatch(room, firstUserId);
    } catch (error) {
      throw toMatchStartRoomError(error, '无法开始对局');
    }

    room.matchId = match.matchId;
    room.openingRps = null;
    room.restartRequest = null;
    room.status = 'IN_GAME';
    room.spectatorRoomEntryEnabled = {
      FIRST: true,
      SECOND: true,
    };
    touchRoom(room, now);

    return match;
  }

  private async cleanupExpiredState(): Promise<OnlineRoomRuntimeCleanupSummary> {
    const now = this.now();
    let checkedRoomCount = 0;
    let destroyedRoomCount = 0;

    for (const [roomCode, room] of this.rooms) {
      checkedRoomCount += 1;
      this.refreshMemberPresence(room, now);
      this.expireRestartRequestIfNeeded(room, now);
      this.clearRestartRequestIfParticipantInactive(room);

      if (room.status === 'OPENING' || room.status === 'IN_GAME') {
        if (shouldDestroyRoom(room, now)) {
          if (room.status === 'IN_GAME' && room.matchId) {
            const deleted = await this.matchService.deleteMatch(room.matchId, {
              reason: 'ROOM_DESTROYED_ALL_ABSENT',
              now,
            });
            if (!deleted) {
              continue;
            }
          }
          this.rooms.delete(roomCode);
          destroyedRoomCount += 1;
        }
        continue;
      }

      this.removeExpiredPreparingMembers(room, now);
      if (room.members.length === 0) {
        this.rooms.delete(roomCode);
        destroyedRoomCount += 1;
      }
    }

    const activeMatchIds = new Set<string>();
    for (const room of this.rooms.values()) {
      if (room.matchId) {
        activeMatchIds.add(room.matchId);
      }
    }
    const matchCleanup = await this.matchService.cleanupExpiredMatches(activeMatchIds, now);
    return {
      checkedRoomCount,
      destroyedRoomCount,
      matchCleanup,
    };
  }

  private refreshMemberPresence(room: OnlineRoomState, now: number): void {
    for (const member of room.members) {
      if (member.presence === 'ACTIVE' && isMemberPresenceStale(member, now)) {
        member.presence = 'LEFT';
      }
    }
  }

  private removeExpiredPreparingMembers(room: OnlineRoomState, now: number): void {
    const nextMembers = room.members.filter((member) => !shouldDropPreparingMember(member, now));
    if (nextMembers.length === room.members.length) {
      return;
    }

    room.members.splice(0, room.members.length, ...nextMembers);
    if (room.members.length === 0) {
      return;
    }

    if (!room.members.some((member) => member.userId === room.ownerUserId)) {
      room.ownerUserId = room.members[0].userId;
    }

    room.members.forEach((member, index) => {
      member.role = index === 0 ? 'HOST' : 'GUEST';
      member.startReady = false;
      if (!isMemberPresenceStale(member, now)) {
        member.presence = 'ACTIVE';
      }
    });

    room.openingRps = null;
    room.restartRequest = null;
    room.status = 'PREPARING';
    touchRoom(room, now);
  }

  private ensureCanRestart(room: OnlineRoomState): void {
    if (room.status !== 'IN_GAME' || !room.matchId) {
      throw new OnlineRoomServiceError(
        'ONLINE_RESTART_FORBIDDEN',
        '只有进行中的对局可以请求重开',
        409
      );
    }
    if (!this.matchService.getMatch(room.matchId)) {
      throw new OnlineRoomServiceError(
        'ONLINE_MATCH_GONE',
        '当前对局不存在或已失效，不能重开',
        404
      );
    }
    if (room.members.length !== 2) {
      throw new OnlineRoomServiceError(
        'ONLINE_RESTART_FORBIDDEN',
        '需要双方都在房间中才能请求重开',
        409
      );
    }
  }

  private requireRestartRequest(
    room: OnlineRoomState,
    requestId: string
  ): OnlineRestartRequestState {
    const request = room.restartRequest;
    if (!request || request.requestId !== requestId || request.matchId !== room.matchId) {
      throw new OnlineRoomServiceError('ONLINE_RESTART_NOT_FOUND', '重开请求不存在或已失效', 404);
    }
    return request;
  }

  private expireRestartRequestIfNeeded(room: OnlineRoomState, now: number): void {
    if (!room.restartRequest) {
      return;
    }
    if (room.restartRequest.expiresAt > now && room.restartRequest.matchId === room.matchId) {
      return;
    }

    room.restartRequest = null;
    touchRoom(room, now);
  }

  private clearRestartRequestIfParticipantInactive(room: OnlineRoomState): void {
    const request = room.restartRequest;
    if (!request) {
      return;
    }
    const requester = findMember(room, request.requesterUserId);
    const responder = findMember(room, request.responderUserId);
    if (requester?.presence === 'ACTIVE' && responder?.presence === 'ACTIVE') {
      return;
    }

    room.restartRequest = null;
    touchRoom(room, this.now());
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

function buildSpectatorRoomEntryView(
  room: OnlineRoomState,
  options: { readonly onlyEnabledSeats?: boolean } = {}
): OnlineRoomSpectatorEntryView | null {
  if (room.status !== 'IN_GAME' || !room.matchId) {
    return null;
  }

  const seats: OnlineRoomSpectatorEntryView['seats'] = (['FIRST', 'SECOND'] as const)
    .map((seat) => {
      const userId = room.seatAssignments[seat];
      const member = userId ? findMember(room, userId) : undefined;
      if (!member) {
        return null;
      }
      const enabled = room.spectatorRoomEntryEnabled[seat] === true;
      if (options.onlyEnabledSeats && !enabled) {
        return null;
      }
      return {
        seat,
        displayName: member.displayName,
        enabled,
      };
    })
    .filter((seat): seat is OnlineRoomSpectatorEntryView['seats'][number] => seat !== null);

  return {
    roomCode: room.roomCode,
    status: room.status,
    matchId: room.matchId,
    seats,
  };
}

function getEnabledSpectatorSeats(room: OnlineRoomState): Seat[] {
  return (['FIRST', 'SECOND'] as const).filter(
    (seat) => Boolean(room.seatAssignments[seat]) && room.spectatorRoomEntryEnabled[seat] === true
  );
}

function getHostUserId(room: OnlineRoomState): string | null {
  return room.members.find((member) => member.role === 'HOST')?.userId ?? null;
}

function getOpponentUserId(room: OnlineRoomState, userId: string): string | null {
  return room.members.find((member) => member.userId !== userId)?.userId ?? null;
}

function createOpeningRpsState(
  room: OnlineRoomState,
  round: number,
  _now: number
): OnlineOpeningRpsState {
  return {
    round,
    choices: room.members.map((member) => ({
      userId: member.userId,
      selected: false,
      gesture: null,
    })),
    revealed: false,
    winnerUserId: null,
    chooserUserId: null,
    revealedAt: null,
  };
}

function revealOpeningRpsRound(
  current: OnlineOpeningRpsState,
  choices: readonly OnlineOpeningRpsState['choices'][number][],
  now: number
): OnlineOpeningRpsState {
  const [left, right] = choices;
  const winnerUserId =
    left && right && left.gesture && right.gesture
      ? getRpsWinner(left.userId, left.gesture, right.userId, right.gesture)
      : null;

  return {
    ...current,
    choices,
    revealed: true,
    winnerUserId,
    chooserUserId: winnerUserId,
    revealedAt: now,
  };
}

function getRpsWinner(
  leftUserId: string,
  leftGesture: OpeningRpsGesture,
  rightUserId: string,
  rightGesture: OpeningRpsGesture
): string | null {
  if (leftGesture === rightGesture) {
    return null;
  }
  if (
    (leftGesture === 'ROCK' && rightGesture === 'SCISSORS') ||
    (leftGesture === 'SCISSORS' && rightGesture === 'PAPER') ||
    (leftGesture === 'PAPER' && rightGesture === 'ROCK')
  ) {
    return leftUserId;
  }
  return rightUserId;
}

function buildOpeningRpsViewForViewer(
  opening: OnlineOpeningRpsState | null,
  viewerUserId: string | null
): OnlineOpeningRpsView | null {
  if (!opening) {
    return null;
  }

  return {
    ...opening,
    choices: opening.choices.map((choice) => ({
      ...choice,
      gesture:
        opening.revealed || choice.userId === viewerUserId || viewerUserId === null
          ? choice.gesture
          : null,
    })),
  };
}

function ensureOpeningRpsRoom(room: OnlineRoomState): void {
  if (room.status !== 'OPENING' || !room.openingRps) {
    throw new OnlineRoomServiceError('ONLINE_OPENING_FORBIDDEN', '当前不在开局猜拳流程中', 409);
  }
  if (room.members.length !== 2) {
    throw new OnlineRoomServiceError(
      'ONLINE_OPENING_FORBIDDEN',
      '需要双方都在房间中才能进行开局猜拳',
      409
    );
  }
  if (room.members.some((member) => member.presence !== 'ACTIVE')) {
    throw new OnlineRoomServiceError(
      'ONLINE_OPENING_FORBIDDEN',
      '双方都在线时才能进行开局猜拳',
      409
    );
  }
}

function touchRoom(room: OnlineRoomState, updatedAt: number): void {
  room.updatedAt = updatedAt;
}

function isMemberPresenceStale(member: OnlineRoomMemberState, now: number): boolean {
  return now - member.lastSeenAt >= MEMBER_PRESENCE_STALE_MS;
}

function shouldDropPreparingMember(member: OnlineRoomMemberState, now: number): boolean {
  return now - member.lastSeenAt >= ROOM_DESTROY_AFTER_ALL_ABSENT_MS;
}

function shouldDestroyRoom(room: OnlineRoomState, now: number): boolean {
  if (room.members.length === 0) {
    return true;
  }

  const latestSeenAt = room.members.reduce(
    (latest, member) => Math.max(latest, member.lastSeenAt),
    0
  );
  return (
    room.members.every((member) => member.presence === 'LEFT') &&
    now - latestSeenAt >= ROOM_DESTROY_AFTER_ALL_ABSENT_MS
  );
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

function ensureBothMembersActive(room: OnlineRoomState): void {
  if (room.members.length !== 2 || room.members.some((member) => member.presence !== 'ACTIVE')) {
    throw new OnlineRoomServiceError('ONLINE_READY_FORBIDDEN', '双方都在线时才能开始对局', 409);
  }
}

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function toMatchStartRoomError(error: unknown, prefix: string): OnlineRoomServiceError {
  if (error instanceof OnlineRoomServiceError) {
    return error;
  }
  if (error instanceof OnlineMatchServiceError) {
    return new OnlineRoomServiceError(
      error.code,
      `${prefix}：历史对局记录服务暂时不可用，请稍后重试`,
      error.code === 'ONLINE_MATCH_RECORD_BEGIN_FAILED' ||
        error.code === 'ONLINE_MATCH_RECORD_CHECKPOINT_FAILED'
        ? 503
        : 500
    );
  }
  return new OnlineRoomServiceError(
    'ONLINE_MATCH_START_FAILED',
    `${prefix}：${readErrorMessage(error)}`,
    500
  );
}

export async function loadUserProfileForOnlineMatch(userId: string): Promise<UserProfileSummary> {
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

export async function loadOwnedDeckForOnlineMatch(
  userId: string,
  deckId: string
): Promise<OwnedDeckSummary> {
  const { rows } = await pool.query<{
    id: string;
    name: string;
    description: string | null;
    main_deck: Array<{ card_code: string; count: number; card_type?: 'MEMBER' | 'LIVE' }>;
    energy_deck: Array<{ card_code: string; count: number }>;
  }>(
    'SELECT id, name, description, main_deck, energy_deck FROM decks WHERE id = $1 AND user_id = $2 LIMIT 1',
    [deckId, userId]
  );

  if (rows.length === 0) {
    throw new OnlineRoomServiceError('ONLINE_DECK_INVALID', '只能锁定当前用户自己的云端卡组', 404);
  }

  const deck = rows[0];
  let preparedDeck;
  try {
    preparedDeck = await prepareDeckPayloadForStorage(deck);
  } catch (error) {
    if (error instanceof DeckPayloadValidationError) {
      throw new OnlineRoomServiceError(
        'ONLINE_DECK_INVALID',
        error.errors[0] ?? '卡组包含不可用卡牌',
        409
      );
    }
    throw error;
  }

  if (!preparedDeck.validation.valid) {
    throw new OnlineRoomServiceError(
      'ONLINE_DECK_INVALID',
      preparedDeck.validation.errors[0] ?? '只能锁定合法卡组',
      409
    );
  }

  const loader = new DeckLoader(preparedDeck.registry);
  const loadResult = loader.loadFromConfig(preparedDeck.config);
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
