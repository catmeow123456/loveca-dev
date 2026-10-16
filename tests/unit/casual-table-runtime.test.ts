import { beforeEach, describe, expect, it } from 'vitest';
import { OnlineMatchService } from '../../src/server/services/online-match-service';
import {
  OnlineRoomService,
  type CreateCasualTableRuntimeInput,
} from '../../src/server/services/online-room-service';
import { toDeckPointTableRules } from '../../src/domain/rules/deck-point-table';

const rules = toDeckPointTableRules({
  version: 'test',
  pointLimit: 9,
  effectiveFrom: '2026-01-01T00:00:00Z',
  entries: [],
});
let now = 100_000;
let rooms: OnlineRoomService;
const input: CreateCasualTableRuntimeInput = {
  tableId: 'table',
  roundId: 'round',
  roomCode: 'ABC234',
  originKind: 'ONLINE_ROOM',
  openingExpiresAt: 280_000,
  members: [
    {
      userId: 'host',
      displayName: '房主',
      deckId: 'host-deck',
      deckName: '房主卡组',
      deck: { mainDeck: [], energyDeck: [] },
      pointValidation: { pointTableVersion: 'test', pointTotal: 0, pointLimit: 9 },
      lockedAt: 100_000,
      spectatorEnabled: true,
    },
    {
      userId: 'guest',
      displayName: '访客',
      deckId: 'guest-deck',
      deckName: '访客卡组',
      deck: { mainDeck: [], energyDeck: [] },
      pointValidation: { pointTableVersion: 'test', pointTotal: 0, pointLimit: 9 },
      lockedAt: 100_000,
      spectatorEnabled: false,
    },
  ],
};

describe('casual preparation/runtime boundary', () => {
  beforeEach(() => {
    now = 100_000;
    rooms = new OnlineRoomService({
      now: () => now,
      matchService: new OnlineMatchService({ now: () => now, recorder: null }),
      getCurrentPointTableRules: () => Promise.resolve(rules),
      loadUserProfile: (userId) =>
        Promise.resolve({
          userId,
          displayName: userId === 'host' ? '房主' : '访客',
        }),
    });
  });

  it('requires an exact activation identity and keeps pending allocations inaccessible', async () => {
    const identity = rooms.prepareCasualTableRuntime(input);
    expect(rooms.prepareCasualTableRuntime(input)).toEqual(identity);
    expect(rooms.getCasualTableRuntime(input.tableId, input.roundId)).toBeNull();
    await expect(rooms.getRoomView(input.roomCode, 'host')).rejects.toMatchObject({
      code: 'ONLINE_ROOM_NOT_FOUND',
    });
    expect(() =>
      rooms.activateCasualTableRuntime('table', 'other-round', identity.roomGeneration)
    ).toThrow();
    expect(() => rooms.activateCasualTableRuntime('table', 'round', 'other-generation')).toThrow();
    rooms.activateCasualTableRuntime('table', 'round', identity.roomGeneration);
    rooms.activateCasualTableRuntime('table', 'round', identity.roomGeneration);
    expect(rooms.getCasualTableRuntime('table', 'round')?.roomGeneration).toBe(
      identity.roomGeneration
    );
  });

  it('starts the arrival window on activation after a binding retry', async () => {
    const identity = rooms.prepareCasualTableRuntime(input);
    now += 100_000;
    rooms.activateCasualTableRuntime('table', 'round', identity.roomGeneration);
    const view = await rooms.getRoomView(input.roomCode, 'host');
    expect(view.status).toBe('OPENING');
    expect(view.openingArrivalExpiresAt).toBe(now + 60_000);
  });

  it('keeps membership/decks frozen and excludes the opponent deck identity from runtime projections', async () => {
    const identity = rooms.prepareCasualTableRuntime(input);
    rooms.activateCasualTableRuntime('table', 'round', identity.roomGeneration);
    const view = await rooms.getRoomView(input.roomCode, 'host');
    expect(view.members.find((member) => member.userId === 'host')?.lockedDeckName).toBe(
      '房主卡组'
    );
    expect(view.members.find((member) => member.userId === 'guest')?.lockedDeckName).toBeNull();
    expect(view.members.find((member) => member.userId === 'guest')?.lockedDeckId).toBeNull();
    await expect(rooms.joinRoom(input.roomCode, 'third')).rejects.toMatchObject({
      code: 'ONLINE_ROOM_FORBIDDEN',
    });
    await expect(rooms.lockDeck(input.roomCode, 'host', 'new-deck')).rejects.toMatchObject({
      code: 'ONLINE_CASUAL_PREPARATION_REQUIRED',
    });
    await expect(rooms.markReadyToStart(input.roomCode, 'host')).rejects.toMatchObject({
      code: 'ONLINE_CASUAL_PREPARATION_REQUIRED',
    });
    await expect(rooms.leaveRoom(input.roomCode, 'host')).rejects.toMatchObject({
      code: 'ONLINE_CASUAL_PREPARATION_REQUIRED',
    });
    expect((await rooms.getRoomView(input.roomCode, 'host')).members).toHaveLength(2);
  });

  it('fences stale discard operations and lets cleanup discard an inaccessible pending allocation', () => {
    const identity = rooms.prepareCasualTableRuntime(input);
    expect(rooms.discardCasualTableRuntime('table', 'other-round', identity.roomGeneration)).toBe(
      false
    );
    expect(rooms.discardCasualTableRuntime('table', 'round', 'stale-generation')).toBe(false);
    expect(rooms.discardCasualTableRuntime('table', 'round', null)).toBe(true);
    const next = rooms.prepareCasualTableRuntime(input);
    expect(next.roomGeneration).not.toBe(identity.roomGeneration);
    rooms.activateCasualTableRuntime('table', 'round', next.roomGeneration);
    expect(rooms.discardCasualTableRuntime('table', 'round', identity.roomGeneration)).toBe(false);
    expect(rooms.getCasualTableRuntime('table', 'round')?.roomGeneration).toBe(next.roomGeneration);
  });

  it('exposes the existing opening timeout as a terminal runtime instead of mutable preparation', async () => {
    const identity = rooms.prepareCasualTableRuntime(input);
    rooms.activateCasualTableRuntime('table', 'round', identity.roomGeneration);
    now += 61_000;
    const view = await rooms.getRoomView(input.roomCode, 'host');
    expect(view.status).toBe('ENDED');
    expect(rooms.getCasualTableRuntime('table', 'round')?.ended).toBe(true);
    await expect(rooms.lockDeck(input.roomCode, 'host', 'new-deck')).rejects.toMatchObject({
      statusCode: 404,
    });
    await expect(rooms.markReadyToStart(input.roomCode, 'host')).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  it('distinguishes total opening timeout after both players arrived from missing arrival', async () => {
    const identity = rooms.prepareCasualTableRuntime(input);
    rooms.activateCasualTableRuntime('table', 'round', identity.roomGeneration);
    for (let elapsed = 0; elapsed < 180_000; elapsed += 10_000) {
      const first = await rooms.getRoomView(input.roomCode, 'host');
      await rooms.getRoomView(input.roomCode, 'guest');
      expect(first.status).toBe('OPENING');
      now += 10_000;
    }
    const view = await rooms.getRoomView(input.roomCode, 'host');
    expect(view.status).toBe('ENDED');
    expect(view.endInfo?.reason).toBe('OPENING_TIMEOUT');
    expect(view.matchId).toBeNull();
    expect(rooms.getCasualTableRuntime('table', 'round')?.failureReason).toBe('OPENING_TIMEOUT');
  });
});
