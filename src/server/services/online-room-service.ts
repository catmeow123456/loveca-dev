import { randomInt, randomUUID } from 'node:crypto';
import { createSurrenderCommand } from '../../application/game-commands.js';
import type { DeckConfig as RuntimeDeckConfig } from '../../application/game-service.js';
import { DeckLoader } from '../../domain/card-data/deck-loader.js';
import type {
  OpeningRpsGesture,
  OpeningTurnOrderChoice,
  OnlineAdminRoomSummary,
  OnlineOpeningRpsView,
  OnlineRestartRequestView,
  OnlineRoomEndView,
  OnlineRoomSpectatorEntryView,
  OnlineRoomMemberPresence,
  OnlineRoomMemberRole,
  OnlineRoomStatus,
  OnlineRoomView,
  OnlineSpectatorLinkView,
} from '../../online/release-types.js';
import type { MatchOriginKind } from '../../online/replay-types.js';
import {
  RANKED_DOUBLE_DISCONNECT_NO_CONTEST_WINDOW_MS,
  RANKED_RECONNECT_GRACE_PERIOD_MS,
} from '../../online/ranked-policy.js';
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
import {
  gameplayParticipationService,
  type GameplayParticipationPort,
} from './gameplay-participation-service.js';
import { logPublicTableLifecycleEvent } from './public-table-telemetry.js';
import { rankedRatingService } from './ranked-rating-service.js';
import type {
  DeckPointTableRules,
  DeckPointValidationFacts,
} from '../../domain/rules/deck-point-table.js';
import { deckPointTableService } from './deck-point-table-service.js';
import { revalidateRuntimeDeckPointSnapshot } from './deck-point-snapshot-validation.js';

const MEMBER_PRESENCE_STALE_MS = 15 * 1000;
const ROOM_DESTROY_AFTER_ALL_ABSENT_MS = 60 * 1000;
const RESTART_REQUEST_TTL_MS = 60 * 1000;
export const PUBLIC_TABLE_OPENING_TTL_MS = 3 * 60 * 1000;
const PUBLIC_TABLE_ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const PUBLIC_TABLE_ROOM_CODE_LENGTH = 6;
const PUBLIC_TABLE_ROOM_CODE_MAX_ATTEMPTS = 32;

interface OnlineRoomMemberState {
  readonly userId: string;
  displayName: string;
  role: OnlineRoomMemberRole;
  presence: OnlineRoomMemberPresence;
  lockedDeckId: string | null;
  lockedDeckName: string | null;
  resolvedDeckConfig: RuntimeDeckConfig | null;
  pointValidation: DeckPointValidationFacts | null;
  lockedDeckAt: number | null;
  startReady: boolean;
  lastSeenAt: number;
  presenceGeneration: number;
  voluntarilyLeft: boolean;
  arrivedAt: number | null;
}

type OnlineOpeningRpsState = OnlineOpeningRpsView;

type OnlineRestartRequestState = OnlineRestartRequestView;

interface OnlineRoomState {
  readonly roomCode: string;
  readonly roomGeneration: string;
  status: OnlineRoomStatus;
  ownerUserId: string;
  readonly members: OnlineRoomMemberState[];
  openingRps: OnlineOpeningRpsState | null;
  restartRequest: OnlineRestartRequestState | null;
  matchId: string | null;
  seatAssignments: Partial<Record<Seat, string>>;
  spectatorRoomEntryEnabledByUserId: Record<string, boolean>;
  readonly originKind: MatchOriginKind;
  readonly originLabel: string;
  readonly publicTableReservationId: string | null;
  initialPublicTableMatchId: string | null;
  readonly rankedSeasonId: string | null;
  readonly closedToNewMembers: boolean;
  openingExpiresAt: number | null;
  openingArrivalExpiresAt: number | null;
  endInfo: OnlineRoomEndView | null;
  matchStartBlocked: boolean;
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
  readonly pointValidation: DeckPointValidationFacts;
  readonly pointTable: DeckPointTableRules;
}

interface OnlineRoomServiceDeps {
  readonly now?: () => number;
  readonly matchService?: OnlineMatchService;
  readonly loadUserProfile?: (userId: string) => Promise<UserProfileSummary>;
  readonly loadOwnedDeck?: (userId: string, deckId: string) => Promise<OwnedDeckSummary>;
  readonly getCurrentPointTableRules?: () => Promise<DeckPointTableRules>;
  readonly participationService?: GameplayParticipationPort | null;
}

export interface PublicTableRoomMemberInput {
  readonly userId: string;
  readonly displayName: string;
  readonly deckId: string | null;
  readonly deckName: string;
  readonly deck: RuntimeDeckConfig;
  readonly pointValidation: DeckPointValidationFacts;
  readonly lockedAt: number;
}

export interface CreatePublicTableRoomInput {
  readonly reservationId: string;
  readonly originKind: Extract<MatchOriginKind, 'PUBLIC_TABLE' | 'RANKED'>;
  readonly originLabel: string;
  readonly rankedSeasonId: string | null;
  readonly first: PublicTableRoomMemberInput;
  readonly second: PublicTableRoomMemberInput;
  readonly openingExpiresAt: number;
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
  readonly rankedDisconnectForfeitCount: number;
  readonly rankedPlatformNoContestCount: number;
  readonly matchCleanup: OnlineMatchCleanupSummary;
}

export class OnlineRoomService {
  private readonly rooms = new Map<string, OnlineRoomState>();
  private readonly matchStartPromises = new Map<string, Promise<unknown>>();
  private readonly now: () => number;
  private readonly matchService: OnlineMatchService;
  private readonly loadUserProfile: (userId: string) => Promise<UserProfileSummary>;
  private readonly loadOwnedDeck: (userId: string, deckId: string) => Promise<OwnedDeckSummary>;
  private readonly getCurrentPointTableRules: () => Promise<DeckPointTableRules>;
  private readonly participationService: GameplayParticipationPort | null;

  constructor(deps: OnlineRoomServiceDeps = {}) {
    this.now = deps.now ?? (() => Date.now());
    this.matchService = deps.matchService ?? onlineMatchService;
    this.loadUserProfile = deps.loadUserProfile ?? loadUserProfileForOnlineMatch;
    this.loadOwnedDeck = deps.loadOwnedDeck ?? loadOwnedDeckForOnlineMatch;
    this.getCurrentPointTableRules =
      deps.getCurrentPointTableRules ?? (() => deckPointTableService.getCurrentRules());
    this.participationService = deps.participationService ?? null;
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

      if (existing.status === 'ENDED') {
        throw new OnlineRoomServiceError('ONLINE_ROOM_ENDED', '该房间已经结束', 410);
      }

      await this.reactivateMember(existing, member);
      return this.buildRoomView(existing, member);
    }

    const profile = await this.loadUserProfile(userId);
    const now = this.now();
    const roomGeneration = randomUUID();
    if (
      this.participationService &&
      !(await this.participationService.acquireOnlineRoom(userId, roomGeneration))
    ) {
      throw new OnlineRoomServiceError(
        'ONLINE_PARTICIPATION_CONFLICT',
        '你已经在寻找对手、准备房间或进行其他真人对局',
        409
      );
    }
    const room: OnlineRoomState = {
      roomCode,
      roomGeneration,
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
          pointValidation: null,
          lockedDeckAt: null,
          startReady: false,
          lastSeenAt: now,
          presenceGeneration: 0,
          voluntarilyLeft: false,
          arrivedAt: now,
        },
      ],
      openingRps: null,
      restartRequest: null,
      matchId: null,
      seatAssignments: {},
      spectatorRoomEntryEnabledByUserId: { [userId]: true },
      originKind: 'ONLINE_ROOM',
      originLabel: roomCode,
      publicTableReservationId: null,
      initialPublicTableMatchId: null,
      rankedSeasonId: null,
      closedToNewMembers: false,
      openingExpiresAt: null,
      openingArrivalExpiresAt: null,
      endInfo: null,
      matchStartBlocked: false,
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

    if (room.status === 'ENDED') {
      throw new OnlineRoomServiceError('ONLINE_ROOM_ENDED', '该房间已经结束', 410);
    }

    if (room.status === 'OPENING' || room.status === 'IN_GAME') {
      throw new OnlineRoomServiceError(
        'ONLINE_ROOM_FORBIDDEN',
        '该房间对局已开始，不能以新成员身份加入',
        403
      );
    }

    if (room.closedToNewMembers) {
      throw new OnlineRoomServiceError('ONLINE_ROOM_FORBIDDEN', '该房间不接受其他玩家加入', 403);
    }

    if (room.members.length >= 2) {
      throw new OnlineRoomServiceError('ONLINE_ROOM_FULL', '房间已满员', 409);
    }

    const profile = await this.loadUserProfile(userId);
    if (
      this.participationService &&
      !(await this.participationService.acquireOnlineRoom(userId, room.roomGeneration))
    ) {
      throw new OnlineRoomServiceError(
        'ONLINE_PARTICIPATION_CONFLICT',
        '你已经在寻找对手、准备房间或进行其他真人对局',
        409
      );
    }
    const now = this.now();
    const member: OnlineRoomMemberState = {
      userId,
      displayName: profile.displayName,
      role: 'GUEST',
      presence: 'ACTIVE',
      lockedDeckId: null,
      lockedDeckName: null,
      resolvedDeckConfig: null,
      pointValidation: null,
      lockedDeckAt: null,
      startReady: false,
      lastSeenAt: now,
      presenceGeneration: 0,
      voluntarilyLeft: false,
      arrivedAt: now,
    };
    room.members.push(member);
    room.spectatorRoomEntryEnabledByUserId[userId] = true;
    touchRoom(room, now);

    return this.buildRoomView(room, member);
  }

  async createPublicTableRoom(
    input: CreatePublicTableRoomInput
  ): Promise<{ roomCode: string; roomGeneration: string }> {
    await this.cleanupExpiredState();

    const existing = [...this.rooms.values()].find(
      (room) => room.publicTableReservationId === input.reservationId
    );
    if (existing) {
      return { roomCode: existing.roomCode, roomGeneration: existing.roomGeneration };
    }

    let roomCode: string | null = null;
    for (let attempt = 0; attempt < PUBLIC_TABLE_ROOM_CODE_MAX_ATTEMPTS; attempt += 1) {
      const candidate = buildRandomPublicTableRoomCode();
      if (!this.rooms.has(candidate)) {
        roomCode = candidate;
        break;
      }
    }
    if (!roomCode) {
      throw new OnlineRoomServiceError(
        'PUBLIC_TABLE_ROOM_ID_CONFLICT',
        '暂时无法分配公共牌桌房间号，请重试',
        409
      );
    }

    const now = this.now();
    const room: OnlineRoomState = {
      roomCode,
      roomGeneration: randomUUID(),
      status: 'OPENING',
      ownerUserId: input.first.userId,
      members: [
        buildPublicTableMember(input.first, 'HOST', now),
        buildPublicTableMember(input.second, 'GUEST', now),
      ],
      openingRps: null,
      restartRequest: null,
      matchId: null,
      seatAssignments: {},
      spectatorRoomEntryEnabledByUserId: {
        [input.first.userId]: true,
        [input.second.userId]: true,
      },
      originKind: input.originKind,
      originLabel: input.originLabel,
      publicTableReservationId: input.reservationId,
      initialPublicTableMatchId: null,
      rankedSeasonId: input.rankedSeasonId,
      closedToNewMembers: true,
      openingExpiresAt: input.openingExpiresAt,
      openingArrivalExpiresAt: now + 60_000,
      endInfo: null,
      matchStartBlocked: false,
      updatedAt: now,
    };
    this.rooms.set(roomCode, room);
    return { roomCode: room.roomCode, roomGeneration: room.roomGeneration };
  }

  getRoomIdentityForPublicTableReservation(
    reservationId: string
  ): { roomCode: string; roomGeneration: string } | null {
    const room = [...this.rooms.values()].find(
      (candidate) => candidate.publicTableReservationId === reservationId
    );
    return room ? { roomCode: room.roomCode, roomGeneration: room.roomGeneration } : null;
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

    if (room.status !== 'ENDED') {
      await this.reactivateMember(room, member);
      this.markMemberArrivedForOpening(room, member, this.now());
    }
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
    member.pointValidation = deck.pointValidation;
    member.lockedDeckAt = this.now();
    room.members.forEach((candidate) => {
      candidate.startReady = false;
    });
    member.presence = 'ACTIVE';
    member.lastSeenAt = member.lockedDeckAt;

    room.openingRps = null;
    room.restartRequest = null;
    room.openingArrivalExpiresAt = null;
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
      if (room.publicTableReservationId) {
        room.openingExpiresAt = now + PUBLIC_TABLE_OPENING_TTL_MS;
      }
      room.members.forEach((candidate) => {
        candidate.arrivedAt = now;
      });
      room.openingArrivalExpiresAt = null;
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
    member.presenceGeneration += 1;
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
    if (room.status === 'IN_GAME' && room.matchId) {
      markMemberSeen(member, this.now());
      return this.buildRoomView(room, member);
    }
    if (room.matchStartBlocked) {
      throw new OnlineRoomServiceError(
        'ONLINE_MATCH_START_QUARANTINED',
        '开局状态需要管理员处理，不能重复创建对局',
        409
      );
    }
    const pendingStart = this.matchStartPromises.get(room.roomGeneration);
    if (pendingStart) {
      await pendingStart;
      return this.buildRoomView(room, member);
    }
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

    const startPromise = Promise.resolve().then(() =>
      this.startMatchForRoom(room, firstUserId, now)
    );
    this.matchStartPromises.set(room.roomGeneration, startPromise);
    try {
      await startPromise;
    } finally {
      this.matchStartPromises.delete(room.roomGeneration);
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
    const participantUserIds = room.members.map((candidate) => candidate.userId);
    if (this.participationService?.restoreOnlineRoom) {
      let restoredCount = 0;
      try {
        restoredCount = await this.participationService.restoreOnlineRoom(
          participantUserIds,
          room.roomGeneration,
          previousMatchId
        );
      } catch {
        throw new OnlineRoomServiceError(
          'ONLINE_RESTART_PARTICIPATION_FAILED',
          '无法重开对局：玩家占用状态恢复失败，请稍后重试',
          503
        );
      }
      if (restoredCount !== participantUserIds.length) {
        throw new OnlineRoomServiceError(
          'ONLINE_RESTART_PARTICIPATION_CONFLICT',
          '无法重开对局：玩家占用状态已经变化，请重新进入房间',
          409
        );
      }
    }

    let previousDeleted = false;
    try {
      previousDeleted = await this.matchService.deleteMatch(previousMatchId, {
        reason: 'ROOM_RESTART_ACCEPTED',
        now,
        preserveRoomCodeSpectators: true,
      });
    } catch {
      previousDeleted = false;
    }
    if (!previousDeleted) {
      throw new OnlineRoomServiceError(
        'ONLINE_RESTART_SEAL_FAILED',
        '无法重开对局：旧对局封存失败，请稍后重试',
        503
      );
    }

    room.matchId = null;
    room.seatAssignments = {};
    room.members.forEach((candidate) => {
      candidate.startReady = false;
      candidate.presence = 'ACTIVE';
      candidate.lastSeenAt = now;
    });
    room.openingRps = null;
    room.openingExpiresAt = null;
    room.restartRequest = null;
    room.status = 'PREPARING';
    room.matchStartBlocked = false;
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
    const completedMatch = Boolean(
      room.status === 'IN_GAME' && room.matchId && this.matchService.isMatchCompleted(room.matchId)
    );

    if (room.status === 'IN_GAME' && !completedMatch) {
      throw new OnlineRoomServiceError(
        'ONLINE_ROOM_LEAVE_FORBIDDEN',
        '对局进行中不能直接退出房间；暂时离开请返回大厅，结束本局请使用认输',
        409
      );
    }

    if (room.status === 'IN_GAME') {
      member.presence = 'LEFT';
      member.voluntarilyLeft = true;
      member.lastSeenAt = now;
      if (
        room.restartRequest?.requesterUserId === userId ||
        room.restartRequest?.responderUserId === userId
      ) {
        room.restartRequest = null;
      }
      touchRoom(room, now);

      await this.participationService?.releaseOnlineRoom([userId], room.roomGeneration);
      if (room.members.every((candidate) => candidate.presence === 'LEFT')) {
        const deleted = await this.matchService.deleteMatch(room.matchId!, {
          reason: 'COMPLETED_ROOM_LEFT',
          now,
        });
        if (!deleted) {
          throw new OnlineRoomServiceError(
            'ONLINE_ROOM_LEAVE_SEAL_FAILED',
            '暂时无法结束本局，请稍后重试',
            503
          );
        }
        this.matchService.terminateRoomCodeSpectators(
          room.roomCode,
          room.roomGeneration,
          'ROOM_CLOSED',
          now
        );
        this.rooms.delete(room.roomCode);
        await this.participationService?.releaseOnlineRoom(
          room.members.map((candidate) => candidate.userId),
          room.roomGeneration
        );
        return { room: null };
      }

      return {
        room: this.buildRoomView(room, member),
      };
    }

    if (
      room.originKind === 'PUBLIC_TABLE' &&
      (room.status === 'OPENING' ||
        (room.initialPublicTableMatchId !== null &&
          (room.status === 'PREPARING' || room.status === 'READY')))
    ) {
      await this.closePublicTableOpening(room, 'PLAYER_ABANDONED_OPENING', now);
      return { room: null };
    }

    if (room.status === 'OPENING' && room.originKind === 'RANKED') {
      member.presence = 'LEFT';
      member.voluntarilyLeft = true;
      member.lastSeenAt = now;
      touchRoom(room, now);
      return {
        room: this.buildRoomView(room, member),
      };
    }

    const index = room.members.findIndex((candidate) => candidate.userId === userId);
    room.members.splice(index, 1);
    delete room.spectatorRoomEntryEnabledByUserId[userId];

    if (room.members.length === 0) {
      this.matchService.terminateRoomCodeSpectators(
        room.roomCode,
        room.roomGeneration,
        'ROOM_CLOSED',
        now
      );
      this.rooms.delete(room.roomCode);
      await this.participationService?.releaseOnlineRoom([userId], room.roomGeneration);
      return { room: null };
    }

    await this.participationService?.releaseOnlineRoom([userId], room.roomGeneration);

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
    this.matchService.terminateRoomCodeSpectators(
      room.roomCode,
      room.roomGeneration,
      'ROOM_REPLACED',
      now
    );
    touchRoom(room, now);

    return {
      room: this.buildRoomView(room, room.members[0]),
    };
  }

  async abandonRoomForLocalGame(
    roomCodeInput: string,
    userId: string
  ): Promise<{ room: OnlineRoomView | null }> {
    await this.cleanupExpiredState();

    const room = this.getRoomState(roomCodeInput);
    this.requireMember(room, userId);
    const now = this.now();
    const matchId = room.matchId;

    if (room.status === 'IN_GAME' && matchId && !this.matchService.isMatchCompleted(matchId)) {
      const result = await this.matchService.executeCommand(matchId, userId, {
        ...createSurrenderCommand(userId),
        timestamp: now,
        idempotencyKey: `local-game-abandon:${matchId}:${userId}:${now}`,
      });
      if (!result) {
        throw new OnlineRoomServiceError(
          'ONLINE_MATCH_GONE',
          '当前对局不存在或已失效，无法放弃',
          404
        );
      }
      if (!result.success) {
        throw new OnlineRoomServiceError(
          'ONLINE_ROOM_ABANDON_FAILED',
          result.error ?? '放弃当前对局失败',
          409
        );
      }
    }

    return this.leaveRoom(room.roomCode, userId);
  }

  async cleanupExpiredRuntimeState(): Promise<OnlineRoomRuntimeCleanupSummary> {
    return this.cleanupExpiredState();
  }

  async terminateRankedMatchForNoContest(
    matchId: string,
    reason: 'RANKED_FINALIZING_DEADLINE_EXCEEDED',
    now = this.now()
  ): Promise<boolean> {
    const entry =
      [...this.rooms.entries()].find(
        ([, candidate]) =>
          candidate.matchId === matchId &&
          candidate.status === 'IN_GAME' &&
          candidate.originKind === 'RANKED'
      ) ?? null;
    if (!entry) {
      return false;
    }
    const [roomCode, room] = entry;
    const deleted = await this.matchService.deleteMatch(matchId, { reason, now });
    if (!deleted) {
      return false;
    }
    this.matchService.terminateRoomCodeSpectators(
      room.roomCode,
      room.roomGeneration,
      'ROOM_CLOSED',
      now
    );
    this.rooms.delete(roomCode);
    await this.participationService?.releaseOnlineRoom(
      room.members.map((member) => member.userId),
      room.roomGeneration
    );
    console.warn(
      JSON.stringify({
        scope: 'ranked_match',
        event: 'RANKED_FINALIZING_DEADLINE_TERMINATED',
        matchId,
      })
    );
    return true;
  }

  discardPublicTableRoom(
    reservationId: string,
    roomGeneration: string,
    reason: 'STALE_BOOTSTRAP_LEASE' | 'BOOTSTRAP_BIND_FAILED'
  ): boolean {
    const entry =
      [...this.rooms.entries()].find(
        ([, room]) =>
          room.publicTableReservationId === reservationId &&
          room.roomGeneration === roomGeneration &&
          room.status === 'OPENING' &&
          room.matchId === null
      ) ?? null;
    if (!entry) {
      return false;
    }
    const [roomCode, room] = entry;
    this.matchService.terminateRoomCodeSpectators(
      room.roomCode,
      room.roomGeneration,
      'ROOM_CLOSED',
      this.now()
    );
    this.rooms.delete(roomCode);
    logPublicTableLifecycleEvent({
      eventType: 'MATCH_INTERRUPTED',
      eventKey: `${reservationId}:${reason}:${roomGeneration}`,
      reservationId,
      roomGeneration,
      detail: { reason },
    });
    return true;
  }

  touchInGameMemberByMatch(matchId: string, userId: string): boolean {
    const room =
      [...this.rooms.values()].find((candidate) => candidate.matchId === matchId) ?? null;
    if (!room || room.status !== 'IN_GAME') {
      return false;
    }

    const member = findMember(room, userId);
    if (!member || member.voluntarilyLeft) {
      return false;
    }

    const now = this.now();
    markMemberSeen(member, now);
    touchRoom(room, now);
    return true;
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
    const viewerUserIdForSeat = room.seatAssignments[viewerSeat];
    if (!viewerUserIdForSeat) {
      throw new OnlineRoomServiceError(
        'ONLINE_ROOM_SPECTATOR_UNAVAILABLE',
        '该玩家视角当前不可观战',
        404
      );
    }
    if (room.spectatorRoomEntryEnabledByUserId[viewerUserIdForSeat] !== true) {
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
      authorizedViewerSeats,
      room.roomGeneration
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

    room.spectatorRoomEntryEnabledByUserId[userId] = enabled;
    this.matchService.setRoomCodeSpectatorSeats(
      room.matchId,
      room.roomGeneration,
      getEnabledSpectatorSeats(room)
    );

    const now = this.now();
    markMemberSeen(member, now);
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
      .map((room) => this.buildAdminRoomSummary(room, now))
      .sort((left, right) => {
        if (left.match && right.match) {
          return (
            left.match.startedAt - right.match.startedAt ||
            left.roomCode.localeCompare(right.roomCode)
          );
        }
        if (left.match) {
          return -1;
        }
        if (right.match) {
          return 1;
        }
        return left.roomCode.localeCompare(right.roomCode);
      });
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
    member.voluntarilyLeft = false;
    markMemberSeen(member, now);
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
      originKind: room.originKind,
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
      openingExpiresAt: room.openingExpiresAt,
      openingArrivalExpiresAt: room.openingArrivalExpiresAt,
      restartRequest: room.restartRequest,
      endInfo: room.endInfo,
      matchId: room.matchId,
      spectatorRoomEntry: buildSpectatorRoomEntryView(room),
      spectatorPresence: this.matchService.getRoomCodeSpectatorPresence(
        room.roomCode,
        room.roomGeneration
      ),
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
    if (
      !host ||
      !guest ||
      !host.resolvedDeckConfig ||
      !guest.resolvedDeckConfig ||
      !host.pointValidation ||
      !guest.pointValidation
    ) {
      throw new OnlineRoomServiceError('ONLINE_MATCH_GONE', '房间状态异常，无法开始对局', 409);
    }
    const hostDeck = host.resolvedDeckConfig;
    const guestDeck = guest.resolvedDeckConfig;
    const currentPointTable = await this.getCurrentPointTableRules();
    const hostPointReview = revalidateRuntimeDeckPointSnapshot(
      hostDeck,
      host.pointValidation,
      currentPointTable
    );
    const guestPointReview = revalidateRuntimeDeckPointSnapshot(
      guestDeck,
      guest.pointValidation,
      currentPointTable
    );
    const isInitialPublicTableOpening =
      room.publicTableReservationId !== null && room.initialPublicTableMatchId === null;
    if (!hostPointReview.valid || !guestPointReview.valid) {
      await this.handlePointTableChangedBeforeStart(
        room,
        [
          { member: host, valid: hostPointReview.valid },
          { member: guest, valid: guestPointReview.valid },
        ],
        this.now()
      );
      throw new OnlineRoomServiceError(
        'ONLINE_DECK_POINT_TABLE_CHANGED',
        isInitialPublicTableOpening
          ? '当前PT限制表已更新，候场卡组不再合法，请修改卡组后重新候场'
          : '当前PT限制表已更新，有已锁定卡组不再合法，请返回准备阶段重新锁定卡组',
        409
      );
    }
    host.pointValidation = hostPointReview.facts;
    guest.pointValidation = guestPointReview.facts;
    if (
      isInitialPublicTableOpening &&
      room.publicTableReservationId &&
      (hostPointReview.changed || guestPointReview.changed)
    ) {
      await pool.query(
        `UPDATE public_table_tickets
         SET point_table_version = $2,
             point_total = CASE
               WHEN user_id = $3::uuid THEN $4::integer
               WHEN user_id = $5::uuid THEN $6::integer
               ELSE point_total
             END,
             point_limit = $7,
             updated_at = NOW()
         WHERE reservation_id = $1
           AND user_id = ANY($8::uuid[])`,
        [
          room.publicTableReservationId,
          currentPointTable.version,
          host.userId,
          hostPointReview.facts.pointTotal,
          guest.userId,
          guestPointReview.facts.pointTotal,
          currentPointTable.pointLimit,
          [host.userId, guest.userId],
        ]
      );
    }

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
        pointValidation: firstMember.pointValidation!,
      },
      second: {
        userId: secondMember.userId,
        displayName: secondMember.displayName,
        deck: secondMember.userId === host.userId ? hostDeck : guestDeck,
        deckId: secondMember.lockedDeckId,
        deckName: secondMember.lockedDeckName,
        lockedAt: secondMember.lockedDeckAt,
        pointValidation: secondMember.pointValidation!,
      },
      originKind: room.originKind,
      originLabel: room.originLabel,
    };

    const match = await this.matchService.createMatch(params);
    return match;
  }

  private async handlePointTableChangedBeforeStart(
    room: OnlineRoomState,
    reviews: readonly { readonly member: OnlineRoomMemberState; readonly valid: boolean }[],
    now: number
  ): Promise<void> {
    if (!room.publicTableReservationId || room.initialPublicTableMatchId !== null) {
      for (const { member, valid } of reviews) {
        member.startReady = false;
        if (!valid) {
          member.lockedDeckId = null;
          member.lockedDeckName = null;
          member.resolvedDeckConfig = null;
          member.pointValidation = null;
          member.lockedDeckAt = null;
        }
      }
      room.status = 'PREPARING';
      room.openingRps = null;
      room.openingExpiresAt = null;
      room.openingArrivalExpiresAt = null;
      touchRoom(room, now);
      return;
    }

    await pool.query(
      `WITH released_reservation AS (
         UPDATE public_table_reservations
         SET state = 'RELEASED',
             failure_reason = 'POINT_TABLE_CHANGED',
             updated_at = $3
         WHERE id = $1
           AND state = 'MATCHED'
           AND room_generation = $2
         RETURNING id
       ), canceled_tickets AS (
         UPDATE public_table_tickets
         SET state = 'CANCELED',
             terminal_reason = 'POINT_TABLE_CHANGED',
             updated_at = $3
         WHERE reservation_id IN (SELECT id FROM released_reservation)
         RETURNING id
       )
       DELETE FROM gameplay_participations
       WHERE room_generation = $2`,
      [room.publicTableReservationId, room.roomGeneration, new Date(now)]
    );
    this.matchService.terminateRoomCodeSpectators(
      room.roomCode,
      room.roomGeneration,
      'ROOM_CLOSED',
      now
    );
    this.rooms.delete(room.roomCode);
    await this.participationService?.releaseOnlineRoom(
      room.members.map((member) => member.userId),
      room.roomGeneration
    );
  }

  private async startMatchForRoom(room: OnlineRoomState, firstUserId: string, now: number) {
    let match: Awaited<ReturnType<OnlineMatchService['createMatch']>> | null = null;
    const shouldBindInitialPublicTableMatch =
      room.publicTableReservationId !== null && room.initialPublicTableMatchId === null;
    let reservationClaimed = false;
    let rankedRegistered = false;
    let participationMarked = false;
    try {
      match = await this.startMatch(room, firstUserId);
      if (shouldBindInitialPublicTableMatch && room.publicTableReservationId) {
        const claimed = await pool.query(
          `UPDATE public_table_reservations
           SET match_id = $2,
               updated_at = NOW()
           WHERE id = $1
             AND state = 'MATCHED'
             AND match_id IS NULL
           RETURNING id`,
          [room.publicTableReservationId, match.matchId]
        );
        if ((claimed.rowCount ?? 0) !== 1) {
          throw new OnlineRoomServiceError(
            'ONLINE_MATCH_RESERVATION_ALREADY_BOUND',
            '本次配对已经绑定其他对局',
            409
          );
        }
        reservationClaimed = true;
      }
      if (room.rankedSeasonId) {
        await rankedRatingService.registerMatch({
          seasonId: room.rankedSeasonId,
          matchId: match.matchId,
        });
        rankedRegistered = true;
      }
      participationMarked = this.participationService !== null;
      await this.participationService?.markOnlineMatch(
        room.members.map((member) => member.userId),
        room.roomGeneration,
        match.matchId
      );
      if (shouldBindInitialPublicTableMatch && room.publicTableReservationId) {
        const ticketsBound = await pool.query(
          `UPDATE public_table_tickets
           SET matched_match_id = $2,
               updated_at = NOW()
           WHERE reservation_id = $1
             AND matched_match_id IS NULL
           RETURNING id`,
          [room.publicTableReservationId, match.matchId]
        );
        if ((ticketsBound.rowCount ?? 0) !== room.members.length) {
          throw new OnlineRoomServiceError(
            'ONLINE_MATCH_TICKET_BINDING_CONFLICT',
            '本次配对的候场凭据状态已经变化',
            409
          );
        }
      }

      room.matchId = match.matchId;
      room.seatAssignments = {
        FIRST: match.participants.FIRST.userId,
        SECOND: match.participants.SECOND.userId,
      };
      room.openingRps = null;
      room.restartRequest = null;
      room.status = 'IN_GAME';
      if (room.publicTableReservationId) {
        if (room.originKind === 'PUBLIC_TABLE') {
          logPublicTableLifecycleEvent({
            eventType: 'MATCH_STARTED',
            eventKey: shouldBindInitialPublicTableMatch
              ? `${room.publicTableReservationId}:MATCH_STARTED`
              : `${room.publicTableReservationId}:MATCH_STARTED:${match.matchId}`,
            reservationId: room.publicTableReservationId,
            roomGeneration: room.roomGeneration,
            matchId: match.matchId,
            detail: shouldBindInitialPublicTableMatch
              ? undefined
              : {
                  rematch: true,
                  initialMatchId: room.initialPublicTableMatchId,
                },
          });
        } else {
          logRankedRoomLifecycleEvent(room, 'RANKED_MATCH_STARTED', {
            matchId: match.matchId,
          });
        }
      }
      this.matchService.attachRoomCodeSpectators(
        match.matchId,
        room.roomGeneration,
        getEnabledSpectatorSeats(room)
      );
      touchRoom(room, now);
      if (shouldBindInitialPublicTableMatch) {
        room.initialPublicTableMatchId = match.matchId;
      }
      return match;
    } catch (error) {
      let compensationFailed = false;
      if (match) {
        if (participationMarked) {
          try {
            const restoredCount = await this.participationService?.restoreOnlineRoom?.(
              room.members.map((member) => member.userId),
              room.roomGeneration,
              match.matchId
            );
            if (restoredCount !== undefined && restoredCount !== room.members.length) {
              compensationFailed = true;
            }
          } catch {
            compensationFailed = true;
          }
        }
        if (rankedRegistered) {
          try {
            await rankedRatingService.unregisterPendingMatch(match.matchId);
          } catch {
            compensationFailed = true;
          }
        }
        if (reservationClaimed && room.publicTableReservationId) {
          try {
            await pool.query(
              `UPDATE public_table_reservations
               SET match_id = NULL,
                   updated_at = NOW()
               WHERE id = $1
                 AND match_id = $2`,
              [room.publicTableReservationId, match.matchId]
            );
            await pool.query(
              `UPDATE public_table_tickets
               SET matched_match_id = NULL,
                   updated_at = NOW()
               WHERE reservation_id = $1
                 AND matched_match_id = $2`,
              [room.publicTableReservationId, match.matchId]
            );
          } catch {
            compensationFailed = true;
          }
        }
        let deleted = false;
        try {
          deleted = await this.matchService.deleteMatch(match.matchId, {
            reason: 'MATCH_START_ROLLED_BACK',
            now,
          });
        } catch {
          compensationFailed = true;
        }
        if (!deleted) {
          compensationFailed = true;
        }
      }
      room.matchStartBlocked = compensationFailed;
      touchRoom(room, now);
      throw toMatchStartRoomError(error, '无法开始对局');
    }
  }

  private async cleanupExpiredState(): Promise<OnlineRoomRuntimeCleanupSummary> {
    const now = this.now();
    let checkedRoomCount = 0;
    let destroyedRoomCount = 0;
    let rankedDisconnectForfeitCount = 0;
    let rankedPlatformNoContestCount = 0;

    for (const [roomCode, room] of this.rooms) {
      checkedRoomCount += 1;
      this.refreshMemberPresence(room, now);
      this.expireRestartRequestIfNeeded(room, now);
      this.clearRestartRequestIfParticipantInactive(room);

      if (
        room.status === 'ENDED' &&
        room.endInfo !== null &&
        now - room.endInfo.endedAt >= ROOM_DESTROY_AFTER_ALL_ABSENT_MS
      ) {
        this.rooms.delete(roomCode);
        destroyedRoomCount += 1;
        continue;
      }

      if (
        room.status === 'OPENING' &&
        room.openingArrivalExpiresAt !== null &&
        now >= room.openingArrivalExpiresAt &&
        room.members.some((member) => member.arrivedAt === null)
      ) {
        await this.endRoomForOpeningArrivalTimeout(room, now);
        continue;
      }

      if (
        room.status === 'OPENING' &&
        room.publicTableReservationId &&
        room.openingExpiresAt !== null &&
        now >= room.openingExpiresAt
      ) {
        await this.closePublicTableOpening(room, 'OPENING_TIMEOUT', now);
        destroyedRoomCount += 1;
        continue;
      }

      if (
        room.originKind === 'PUBLIC_TABLE' &&
        room.initialPublicTableMatchId !== null &&
        (room.status === 'PREPARING' || room.status === 'READY') &&
        room.members.some((member) => shouldDropPreparingMember(member, now))
      ) {
        await this.closePublicTableOpening(room, 'PLAYER_ABANDONED_OPENING', now);
        destroyedRoomCount += 1;
        continue;
      }

      if (room.status === 'OPENING' || room.status === 'IN_GAME') {
        if (
          room.status === 'IN_GAME' &&
          room.originKind === 'RANKED' &&
          room.matchId &&
          !this.matchService.isMatchCompleted(room.matchId)
        ) {
          const overdueMembers = [...room.members]
            .filter((member) => now - member.lastSeenAt >= RANKED_RECONNECT_GRACE_PERIOD_MS)
            .sort(
              (first, second) =>
                first.lastSeenAt - second.lastSeenAt || first.userId.localeCompare(second.userId)
            );
          const hasIndistinguishableDoubleDisconnect =
            overdueMembers.length === room.members.length &&
            overdueMembers.length > 1 &&
            overdueMembers[overdueMembers.length - 1]!.lastSeenAt - overdueMembers[0]!.lastSeenAt <=
              RANKED_DOUBLE_DISCONNECT_NO_CONTEST_WINDOW_MS;
          if (hasIndistinguishableDoubleDisconnect) {
            const presenceSnapshot = capturePresenceSnapshot(overdueMembers);
            const voided = await pool.query(
              `UPDATE ranked_matches
               SET rating_status = 'VOIDED',
                   winner_seat = NULL,
                   result_type = 'PLATFORM_NO_CONTEST',
                   ended_at = $2,
                   settled_at = $2,
                   updated_at = $2
               WHERE match_id = $1
                 AND rating_status = 'PENDING'
               RETURNING match_id`,
              [room.matchId, new Date(now)]
            );
            if ((voided.rowCount ?? 0) > 0) {
              if (!isPresenceSnapshotCurrent(room, presenceSnapshot, now)) {
                await restorePendingNoContest(room.matchId);
                continue;
              }
              const deleted = await this.matchService.deleteMatch(room.matchId, {
                reason: 'RANKED_BOTH_DISCONNECTED_TIMEOUT',
                now,
              });
              if (!deleted) {
                await restorePendingNoContest(room.matchId);
              } else {
                this.matchService.terminateRoomCodeSpectators(
                  room.roomCode,
                  room.roomGeneration,
                  'ROOM_CLOSED',
                  now
                );
                this.rooms.delete(roomCode);
                await this.participationService?.releaseOnlineRoom(
                  room.members.map((member) => member.userId),
                  room.roomGeneration
                );
                destroyedRoomCount += 1;
                rankedPlatformNoContestCount += 1;
                console.warn(
                  JSON.stringify({
                    scope: 'ranked_match',
                    event: 'RANKED_BOTH_DISCONNECTED_NO_CONTEST',
                    matchId: room.matchId,
                  })
                );
                continue;
              }
            }
          }
          const forfeitingMember = hasIndistinguishableDoubleDisconnect
            ? undefined
            : overdueMembers[0];
          if (forfeitingMember) {
            const presenceSnapshot = capturePresenceSnapshot([forfeitingMember]);
            const claimed = await pool.query(
              `UPDATE ranked_matches
               SET result_type = 'DISCONNECT_FORFEIT',
                   updated_at = NOW()
               WHERE match_id = $1
                 AND rating_status = 'PENDING'
                 AND result_type IS NULL
               RETURNING match_id`,
              [room.matchId]
            );
            if ((claimed.rowCount ?? 0) === 0) {
              continue;
            }
            if (!isPresenceSnapshotCurrent(room, presenceSnapshot, now)) {
              await clearPendingDisconnectForfeit(room.matchId);
              continue;
            }
            let result;
            let commandFailed = false;
            try {
              result = await this.matchService.executeCommand(
                room.matchId,
                forfeitingMember.userId,
                {
                  ...createSurrenderCommand(forfeitingMember.userId),
                  timestamp: now,
                  idempotencyKey: `ranked-disconnect-forfeit:${room.matchId}:${forfeitingMember.userId}`,
                }
              );
            } catch (error) {
              commandFailed = true;
              await clearPendingDisconnectForfeit(room.matchId);
              console.error(
                JSON.stringify({
                  scope: 'ranked_match',
                  event: 'RANKED_DISCONNECT_FORFEIT_DEFERRED',
                  matchId: room.matchId,
                  forfeitingUserId: forfeitingMember.userId,
                  message: readErrorMessage(error),
                })
              );
              result = null;
            }
            if (result?.success) {
              rankedDisconnectForfeitCount += 1;
              console.info(
                JSON.stringify({
                  scope: 'ranked_match',
                  event: 'RANKED_DISCONNECT_FORFEIT',
                  matchId: room.matchId,
                  forfeitingUserId: forfeitingMember.userId,
                })
              );
            } else if (!commandFailed) {
              await clearPendingDisconnectForfeit(room.matchId);
            }
          }
        }
        const shouldPreserveUnfinishedRankedMatch =
          room.status === 'IN_GAME' &&
          room.originKind === 'RANKED' &&
          room.matchId !== null &&
          !this.matchService.isMatchCompleted(room.matchId);
        if (shouldDestroyRoom(room, now) && !shouldPreserveUnfinishedRankedMatch) {
          if (room.status === 'IN_GAME' && room.matchId) {
            const deleted = await this.matchService.deleteMatch(room.matchId, {
              reason: 'ROOM_DESTROYED_ALL_ABSENT',
              now,
            });
            if (!deleted) {
              continue;
            }
          }
          this.matchService.terminateRoomCodeSpectators(
            room.roomCode,
            room.roomGeneration,
            'ROOM_CLOSED',
            now
          );
          this.rooms.delete(roomCode);
          await this.participationService?.releaseOnlineRoom(
            room.members.map((member) => member.userId),
            room.roomGeneration
          );
          destroyedRoomCount += 1;
        }
        continue;
      }

      await this.removeExpiredPreparingMembers(room, now);
      if (room.members.length === 0) {
        this.matchService.terminateRoomCodeSpectators(
          room.roomCode,
          room.roomGeneration,
          'ROOM_CLOSED',
          now
        );
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
      rankedDisconnectForfeitCount,
      rankedPlatformNoContestCount,
      matchCleanup,
    };
  }

  private async closePublicTableOpening(
    room: OnlineRoomState,
    reason: 'PLAYER_ABANDONED_OPENING' | 'OPENING_TIMEOUT',
    now: number
  ): Promise<void> {
    const isPublicTableRematch =
      room.originKind === 'PUBLIC_TABLE' && room.initialPublicTableMatchId !== null;
    const recordedReason = isPublicTableRematch ? `REMATCH_${reason}` : reason;
    if (room.publicTableReservationId && isPublicTableRematch) {
      await pool.query(
        `UPDATE public_table_reservations
         SET state = 'RELEASED',
             failure_reason = $2,
             updated_at = $5
         WHERE id = $1
           AND state = 'MATCHED'
           AND room_generation = $3
           AND match_id = $4`,
        [
          room.publicTableReservationId,
          recordedReason,
          room.roomGeneration,
          room.initialPublicTableMatchId,
          new Date(now),
        ]
      );
    } else if (
      room.publicTableReservationId &&
      room.originKind === 'PUBLIC_TABLE' &&
      reason === 'PLAYER_ABANDONED_OPENING'
    ) {
      await pool.query(
        `WITH released_reservation AS (
           UPDATE public_table_reservations
           SET state = 'RELEASED',
               failure_reason = $2,
               updated_at = $4
           WHERE id = $1
             AND state = 'MATCHED'
             AND room_generation = $3
           RETURNING id
         ), canceled_tickets AS (
           UPDATE public_table_tickets
           SET state = 'CANCELED',
               terminal_reason = $2,
               updated_at = $4
           WHERE reservation_id IN (SELECT id FROM released_reservation)
           RETURNING id
         )
         DELETE FROM gameplay_participations
         WHERE room_generation = $3`,
        [room.publicTableReservationId, reason, room.roomGeneration, new Date(now)]
      );
    } else if (room.publicTableReservationId) {
      await pool.query(
        `UPDATE public_table_reservations
         SET failure_reason = $2,
             updated_at = NOW()
         WHERE id = $1`,
        [room.publicTableReservationId, reason]
      );
    }
    this.matchService.terminateRoomCodeSpectators(
      room.roomCode,
      room.roomGeneration,
      'ROOM_CLOSED',
      now
    );
    this.rooms.delete(room.roomCode);
    await this.participationService?.releaseOnlineRoom(
      room.members.map((member) => member.userId),
      room.roomGeneration
    );
    if (!room.publicTableReservationId) {
      return;
    }
    if (room.originKind === 'PUBLIC_TABLE') {
      logPublicTableLifecycleEvent({
        eventType: 'MATCH_INTERRUPTED',
        eventKey: isPublicTableRematch
          ? `${room.publicTableReservationId}:REMATCH_OPENING_ENDED:${room.initialPublicTableMatchId}`
          : `${room.publicTableReservationId}:OPENING_ENDED`,
        reservationId: room.publicTableReservationId,
        roomGeneration: room.roomGeneration,
        detail: isPublicTableRematch
          ? {
              reason: recordedReason,
              initialMatchId: room.initialPublicTableMatchId,
            }
          : { reason },
      });
    } else {
      logRankedRoomLifecycleEvent(room, 'RANKED_OPENING_ENDED', { reason });
    }
  }

  private async endRoomForOpeningArrivalTimeout(room: OnlineRoomState, now: number): Promise<void> {
    this.matchService.terminateRoomCodeSpectators(
      room.roomCode,
      room.roomGeneration,
      'ROOM_CLOSED',
      now
    );
    await this.participationService?.releaseOnlineRoom(
      room.members.map((member) => member.userId),
      room.roomGeneration
    );
    if (room.publicTableReservationId) {
      await pool.query(
        `UPDATE public_table_reservations
         SET failure_reason = 'OPENING_ARRIVAL_TIMEOUT',
             updated_at = NOW()
         WHERE id = $1`,
        [room.publicTableReservationId]
      );
      if (room.originKind === 'PUBLIC_TABLE') {
        logPublicTableLifecycleEvent({
          eventType: 'MATCH_INTERRUPTED',
          eventKey: `${room.publicTableReservationId}:OPENING_ARRIVAL_TIMEOUT`,
          reservationId: room.publicTableReservationId,
          roomGeneration: room.roomGeneration,
          detail: { reason: 'OPENING_ARRIVAL_TIMEOUT' },
        });
      } else {
        logRankedRoomLifecycleEvent(room, 'RANKED_OPENING_ARRIVAL_TIMEOUT');
      }
    }
    room.status = 'ENDED';
    room.openingRps = null;
    room.openingArrivalExpiresAt = null;
    room.restartRequest = null;
    room.endInfo = {
      reason: 'OPENING_ARRIVAL_TIMEOUT',
      endedAt: now,
    };
    touchRoom(room, now);
  }

  private markMemberArrivedForOpening(
    room: OnlineRoomState,
    member: OnlineRoomMemberState,
    now: number
  ): void {
    if (room.status !== 'OPENING' || member.arrivedAt !== null) {
      return;
    }
    member.arrivedAt = now;
    if (
      room.openingRps === null &&
      room.members.every(
        (candidate) => candidate.arrivedAt !== null && candidate.presence === 'ACTIVE'
      )
    ) {
      room.openingRps = createOpeningRpsState(room, 1, now);
      room.openingArrivalExpiresAt = null;
    }
    touchRoom(room, now);
  }

  private refreshMemberPresence(room: OnlineRoomState, now: number): void {
    for (const member of room.members) {
      if (member.presence === 'ACTIVE' && isMemberPresenceStale(member, now)) {
        member.presence = 'LEFT';
      }
    }
  }

  private async removeExpiredPreparingMembers(room: OnlineRoomState, now: number): Promise<void> {
    const previousUserIds = new Set(room.members.map((member) => member.userId));
    const nextMembers = room.members.filter((member) => !shouldDropPreparingMember(member, now));
    if (nextMembers.length === room.members.length) {
      return;
    }

    room.members.splice(0, room.members.length, ...nextMembers);
    const removedUserIds = [...previousUserIds].filter(
      (userId) => !nextMembers.some((member) => member.userId === userId)
    );
    await this.participationService?.releaseOnlineRoom(removedUserIds, room.roomGeneration);
    for (const userId of previousUserIds) {
      if (!nextMembers.some((member) => member.userId === userId)) {
        delete room.spectatorRoomEntryEnabledByUserId[userId];
      }
    }
    if (room.members.length === 0) {
      return;
    }

    this.matchService.terminateRoomCodeSpectators(
      room.roomCode,
      room.roomGeneration,
      'ROOM_REPLACED',
      now
    );

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
    room.openingArrivalExpiresAt = null;
    room.restartRequest = null;
    room.status = 'PREPARING';
    touchRoom(room, now);
  }

  private ensureCanRestart(room: OnlineRoomState): void {
    if (room.originKind === 'RANKED') {
      throw new OnlineRoomServiceError(
        'RANKED_RESTART_FORBIDDEN',
        '排位对局开始后不能重开整局',
        409
      );
    }
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

export const onlineRoomService = new OnlineRoomService({
  participationService: gameplayParticipationService,
});

function buildPublicTableMember(
  input: PublicTableRoomMemberInput,
  role: OnlineRoomMemberRole,
  now: number
): OnlineRoomMemberState {
  return {
    userId: input.userId,
    displayName: input.displayName,
    role,
    presence: 'ACTIVE',
    lockedDeckId: input.deckId,
    lockedDeckName: input.deckName,
    resolvedDeckConfig: input.deck,
    pointValidation: input.pointValidation,
    lockedDeckAt: input.lockedAt,
    startReady: true,
    lastSeenAt: now,
    presenceGeneration: 0,
    voluntarilyLeft: false,
    arrivedAt: null,
  };
}

type PresenceSnapshot = ReadonlyMap<
  string,
  { readonly lastSeenAt: number; readonly presenceGeneration: number }
>;

function capturePresenceSnapshot(members: readonly OnlineRoomMemberState[]): PresenceSnapshot {
  return new Map(
    members.map((member) => [
      member.userId,
      {
        lastSeenAt: member.lastSeenAt,
        presenceGeneration: member.presenceGeneration,
      },
    ])
  );
}

function isPresenceSnapshotCurrent(
  room: OnlineRoomState,
  snapshot: PresenceSnapshot,
  adjudicatedAt: number
): boolean {
  return [...snapshot].every(([userId, expected]) => {
    const member = findMember(room, userId);
    return (
      member !== undefined &&
      member.lastSeenAt === expected.lastSeenAt &&
      member.presenceGeneration === expected.presenceGeneration &&
      adjudicatedAt - member.lastSeenAt >= RANKED_RECONNECT_GRACE_PERIOD_MS
    );
  });
}

function markMemberSeen(member: OnlineRoomMemberState, now: number): void {
  member.presence = 'ACTIVE';
  member.lastSeenAt = now;
  member.presenceGeneration += 1;
}

async function restorePendingNoContest(matchId: string): Promise<void> {
  await pool.query(
    `UPDATE ranked_matches
     SET rating_status = 'PENDING',
         result_type = NULL,
         ended_at = NULL,
         settled_at = NULL,
         updated_at = NOW()
     WHERE match_id = $1
       AND rating_status = 'VOIDED'
       AND result_type = 'PLATFORM_NO_CONTEST'`,
    [matchId]
  );
}

async function clearPendingDisconnectForfeit(matchId: string): Promise<void> {
  await pool.query(
    `UPDATE ranked_matches
     SET result_type = NULL,
         updated_at = NOW()
     WHERE match_id = $1
       AND rating_status = 'PENDING'
       AND result_type = 'DISCONNECT_FORFEIT'`,
    [matchId]
  );
}

function buildRandomPublicTableRoomCode(): string {
  let roomCode = '';
  for (let index = 0; index < PUBLIC_TABLE_ROOM_CODE_LENGTH; index += 1) {
    roomCode += PUBLIC_TABLE_ROOM_CODE_ALPHABET[randomInt(PUBLIC_TABLE_ROOM_CODE_ALPHABET.length)];
  }
  return roomCode;
}

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
      if (!userId || !member) {
        return null;
      }
      const enabled = room.spectatorRoomEntryEnabledByUserId[userId] === true;
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
  return (['FIRST', 'SECOND'] as const).filter((seat) => {
    const userId = room.seatAssignments[seat];
    return userId !== undefined && room.spectatorRoomEntryEnabledByUserId[userId] === true;
  });
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

function logRankedRoomLifecycleEvent(
  room: OnlineRoomState,
  event: string,
  detail: Readonly<Record<string, unknown>> = {}
): void {
  console.info(
    JSON.stringify({
      scope: 'ranked_matchmaking',
      event,
      seasonId: room.rankedSeasonId,
      reservationId: room.publicTableReservationId,
      roomGeneration: room.roomGeneration,
      ...detail,
    })
  );
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
    pointValidation: {
      pointTableVersion: preparedDeck.pointTable.version,
      pointTotal: preparedDeck.validation.stats.pointTotal,
      pointLimit: preparedDeck.pointTable.pointLimit,
    },
    pointTable: preparedDeck.pointTable,
  };
}
