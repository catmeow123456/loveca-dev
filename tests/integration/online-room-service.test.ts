import { describe, expect, it, vi } from 'vitest';
import type { DeckConfig } from '../../src/application/game-service';
import type { EnergyCardData, LiveCardData, MemberCardData } from '../../src/domain/entities/card';
import { createHeartIcon, createHeartRequirement } from '../../src/domain/entities/card';
import { HeartColor, CardType } from '../../src/shared/types/enums';
import {
  OnlineRoomService,
  OnlineRoomServiceError,
} from '../../src/server/services/online-room-service';
import { OnlineMatchService } from '../../src/server/services/online-match-service';

vi.mock('../../src/server/db/pool.js', () => ({
  pool: {
    query: vi.fn(),
  },
}));

function createTestMemberCard(cardCode: string, name: string): MemberCardData {
  return {
    cardCode,
    name,
    cardType: CardType.MEMBER,
    cost: 1,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.PINK, 1)],
  };
}

function createTestLiveCard(cardCode: string, name: string): LiveCardData {
  return {
    cardCode,
    name,
    cardType: CardType.LIVE,
    score: 3,
    requirements: createHeartRequirement({ [HeartColor.PINK]: 2 }),
  };
}

function createTestEnergyCard(cardCode: string): EnergyCardData {
  return {
    cardCode,
    name: `能量 ${cardCode}`,
    cardType: CardType.ENERGY,
  };
}

function createRuntimeDeck(prefix: string): DeckConfig {
  const mainDeck = [];
  const energyDeck = [];

  for (let i = 0; i < 48; i += 1) {
    mainDeck.push(createTestMemberCard(`${prefix}-MEM-${i}`, `${prefix} 成员 ${i}`));
  }

  for (let i = 0; i < 12; i += 1) {
    mainDeck.push(createTestLiveCard(`${prefix}-LIVE-${i}`, `${prefix} Live ${i}`));
    energyDeck.push(createTestEnergyCard(`${prefix}-ENE-${i}`));
  }

  return { mainDeck, energyDeck };
}

describe('OnlineRoomService', () => {
  it('应完成正式房间准备流程并在接受提议后生成联机对局', async () => {
    const matchService = new OnlineMatchService();
    const service = new OnlineRoomService({
      matchService,
      loadUserProfile: async (userId) => ({
        userId,
        displayName: userId === 'u1' ? 'Alpha' : 'Beta',
      }),
      loadOwnedDeck: async (userId, deckId) => ({
        deckId,
        deckName: `${userId}-${deckId}`,
        runtimeDeck: createRuntimeDeck(deckId),
      }),
    });

    const created = await service.createRoom('room9', 'u1');
    expect(created.roomCode).toBe('ROOM9');
    expect(created.currentUserRole).toBe('HOST');

    const joined = await service.joinRoom('ROOM9', 'u2');
    expect(joined.members).toHaveLength(2);
    expect(joined.currentUserRole).toBe('GUEST');

    await service.lockDeck('ROOM9', 'u1', 'deck-a');
    await service.lockDeck('ROOM9', 'u2', 'deck-b');

    const proposed = await service.proposeTurnOrder('ROOM9', 'u1', 'HOST_SECOND');
    expect(proposed.status).toBe('READY');
    expect(proposed.turnOrderProposal?.proposal).toBe('HOST_SECOND');

    const started = await service.respondTurnOrder('ROOM9', 'u2', true);
    expect(started.status).toBe('IN_GAME');
    expect(started.matchId).toBeTruthy();
    expect(started.currentUserSeat).toBe('FIRST');

    const snapshot = await matchService.getMatchSnapshot(started.matchId!, 'u2');
    expect(snapshot?.seat).toBe('FIRST');
    expect(snapshot?.playerViewState.match.viewerSeat).toBe('FIRST');
  });

  it('同一用户重复加入同一房间时应复用原成员槽位', async () => {
    const service = new OnlineRoomService({
      matchService: new OnlineMatchService(),
      loadUserProfile: async (userId) => ({ userId, displayName: userId }),
      loadOwnedDeck: async (_userId, deckId) => ({
        deckId,
        deckName: deckId,
        runtimeDeck: createRuntimeDeck(deckId),
      }),
    });

    await service.createRoom('same1', 'u1');
    await service.joinRoom('same1', 'u2');
    const rejoined = await service.joinRoom('same1', 'u2');

    expect(rejoined.members).toHaveLength(2);
    expect(rejoined.currentUserRole).toBe('GUEST');
  });

  it('准备阶段房主离开后应把房主身份转移给剩余玩家', async () => {
    const service = new OnlineRoomService({
      matchService: new OnlineMatchService(),
      loadUserProfile: async (userId) => ({ userId, displayName: userId }),
      loadOwnedDeck: async (_userId, deckId) => ({
        deckId,
        deckName: deckId,
        runtimeDeck: createRuntimeDeck(deckId),
      }),
    });

    await service.createRoom('host2', 'u1');
    await service.joinRoom('host2', 'u2');

    const result = await service.leaveRoom('host2', 'u1');
    expect(result.room?.ownerUserId).toBe('u2');
    expect(result.room?.members[0]?.role).toBe('HOST');
  });

  it('对局内离开后应保留房间并允许同一用户恢复为 ACTIVE', async () => {
    const matchService = new OnlineMatchService();
    const service = new OnlineRoomService({
      matchService,
      loadUserProfile: async (userId) => ({ userId, displayName: userId }),
      loadOwnedDeck: async (_userId, deckId) => ({
        deckId,
        deckName: deckId,
        runtimeDeck: createRuntimeDeck(deckId),
      }),
    });

    await service.createRoom('rest1', 'u1');
    await service.joinRoom('rest1', 'u2');
    await service.lockDeck('rest1', 'u1', 'deck-a');
    await service.lockDeck('rest1', 'u2', 'deck-b');
    await service.proposeTurnOrder('rest1', 'u1', 'HOST_FIRST');
    const started = await service.respondTurnOrder('rest1', 'u2', true);

    const left = await service.leaveRoom('rest1', 'u2');
    expect(left.room?.status).toBe('IN_GAME');
    expect(left.room?.currentUserPresence).toBe('LEFT');

    const restored = await service.getRoomView('rest1', 'u2');
    expect(restored.status).toBe('IN_GAME');
    expect(restored.currentUserPresence).toBe('ACTIVE');
    expect((await matchService.getMatchSnapshot(started.matchId!, 'u2'))?.seat).toBe('SECOND');
  });

  it('双方都关闭后准备阶段房间应在宽限期后释放', async () => {
    let now = 1_000_000;
    const service = new OnlineRoomService({
      now: () => now,
      matchService: new OnlineMatchService(),
      loadUserProfile: async (userId) => ({ userId, displayName: userId }),
      loadOwnedDeck: async (_userId, deckId) => ({
        deckId,
        deckName: deckId,
        runtimeDeck: createRuntimeDeck(deckId),
      }),
    });

    await service.createRoom('stale1', 'u1');
    await service.joinRoom('stale1', 'u2');

    now += 61_000;

    expect(service.getRoomIfPresent('stale1')).toBeNull();

    const recreated = await service.createRoom('stale1', 'u3');
    expect(recreated.currentUserId).toBe('u3');
    expect(recreated.members).toHaveLength(1);
  });

  it('双方都失联后对局房间和 match 应在宽限期后一起销毁', async () => {
    let now = 2_000_000;
    const matchService = new OnlineMatchService();
    const service = new OnlineRoomService({
      now: () => now,
      matchService,
      loadUserProfile: async (userId) => ({ userId, displayName: userId }),
      loadOwnedDeck: async (_userId, deckId) => ({
        deckId,
        deckName: deckId,
        runtimeDeck: createRuntimeDeck(deckId),
      }),
    });

    await service.createRoom('gone1', 'u1');
    await service.joinRoom('gone1', 'u2');
    await service.lockDeck('gone1', 'u1', 'deck-a');
    await service.lockDeck('gone1', 'u2', 'deck-b');
    await service.proposeTurnOrder('gone1', 'u1', 'HOST_FIRST');
    const started = await service.respondTurnOrder('gone1', 'u2', true);

    now += 61_000;

    expect(service.getRoomIfPresent('gone1')).toBeNull();
    expect(matchService.getMatch(started.matchId!)).toBeNull();
  });

  it('对局请求刷新成员活跃时间后不应因房间轮询停滞销毁房间', async () => {
    let now = 3_000_000;
    const matchService = new OnlineMatchService();
    const service = new OnlineRoomService({
      now: () => now,
      matchService,
      loadUserProfile: async (userId) => ({ userId, displayName: userId }),
      loadOwnedDeck: async (_userId, deckId) => ({
        deckId,
        deckName: deckId,
        runtimeDeck: createRuntimeDeck(deckId),
      }),
    });

    await service.createRoom('live1', 'u1');
    await service.joinRoom('live1', 'u2');
    await service.lockDeck('live1', 'u1', 'deck-a');
    await service.lockDeck('live1', 'u2', 'deck-b');
    await service.proposeTurnOrder('live1', 'u1', 'HOST_FIRST');
    const started = await service.respondTurnOrder('live1', 'u2', true);

    now += 61_000;
    await service.touchInGameMemberByMatch(started.matchId!, 'u1');

    const room = service.getRoomIfPresent('live1');
    expect(room?.status).toBe('IN_GAME');
    expect(room?.members.find((member) => member.userId === 'u1')?.presence).toBe('ACTIVE');
    expect(matchService.getMatch(started.matchId!)).not.toBeNull();
  });

  it('对局中断超过宽限期后成员房间轮询先恢复时不应销毁 match', async () => {
    let now = 4_000_000;
    const matchService = new OnlineMatchService();
    const service = new OnlineRoomService({
      now: () => now,
      matchService,
      loadUserProfile: async (userId) => ({ userId, displayName: userId }),
      loadOwnedDeck: async (_userId, deckId) => ({
        deckId,
        deckName: deckId,
        runtimeDeck: createRuntimeDeck(deckId),
      }),
    });

    await service.createRoom('race1', 'u1');
    await service.joinRoom('race1', 'u2');
    await service.lockDeck('race1', 'u1', 'deck-a');
    await service.lockDeck('race1', 'u2', 'deck-b');
    await service.proposeTurnOrder('race1', 'u1', 'HOST_FIRST');
    const started = await service.respondTurnOrder('race1', 'u2', true);

    now += 61_000;

    const restored = await service.getRoomView('race1', 'u1');
    expect(restored.status).toBe('IN_GAME');
    expect(restored.currentUserPresence).toBe('ACTIVE');
    expect(matchService.getMatch(started.matchId!)).not.toBeNull();
  });

  it('非成员创建已占用房间号时应返回冲突错误', async () => {
    const service = new OnlineRoomService({
      matchService: new OnlineMatchService(),
      loadUserProfile: async (userId) => ({ userId, displayName: userId }),
      loadOwnedDeck: async (_userId, deckId) => ({
        deckId,
        deckName: deckId,
        runtimeDeck: createRuntimeDeck(deckId),
      }),
    });

    await service.createRoom('conf1', 'u1');

    await expect(service.createRoom('conf1', 'u3')).rejects.toMatchObject<OnlineRoomServiceError>({
      code: 'ONLINE_ROOM_EXISTS',
      statusCode: 409,
    });
  });
});
