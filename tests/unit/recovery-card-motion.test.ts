import { describe, expect, it } from 'vitest';
import {
  recoveryPoseFromBounds,
  sampleRecoveryMotion,
} from '../../client/src/lib/recoveryCardMotion';
import {
  RECOVERY_DURATION_MS,
  createSequencedBattleAnimationEvents,
  getBattleAnimationEventDurationMs,
} from '../../client/src/lib/battleAnimationSequencing';
import { sampleWaitingRoomCardPose } from '../../client/src/lib/waitingRoomCardPresentation';
import { getDiscardPresentationBatchLayout } from '../../client/src/lib/battleAnimationEvents';
import { createBattleAnimationHistory } from '../../client/src/lib/battleAnimationHistory';
import type { BattleAnimationEvent } from '../../client/src/lib/battleAnimationEvents';
import { ZoneType } from '../../src/shared/types/enums';
import {
  drainRecoveryPresentations,
  RECOVERY_PRESENTATION_MAX_WAIT_MS,
} from '../../client/src/lib/recoveryPresentationQueue';
const from = { left: 700, top: 400, width: 45, height: 63, rotation: 0 };
const to = { left: 350, top: 650, width: 75, height: 105, rotation: 12 };
const reveal = getDiscardPresentationBatchLayout({
  count: 1,
  toRect: from,
  toSeat: 'FIRST',
  viewportWidth: 1600,
  viewportHeight: 900,
}).cards[0];
const event: BattleAnimationEvent = {
  id: 'move:3:obj_a',
  kind: 'CARD_MOVE',
  fromZoneType: ZoneType.WAITING_ROOM,
  toZoneType: ZoneType.HAND,
  toSeat: 'FIRST',
  render: {
    objectId: 'obj_a',
    cardId: 'a',
    surface: 'FRONT',
    fromSurface: 'FRONT',
    toSurface: 'FRONT',
  },
  fromRect: from,
  toRect: to,
};

describe('2D recovery choreography', () => {
  it('reverses the discard geometry and timing, holds the same reveal pose and lands exactly', () => {
    expect(sampleRecoveryMotion(from, to, 0, reveal).pose).toEqual(from);
    expect(sampleRecoveryMotion(from, to, 160, reveal).pose).toEqual(reveal);
    expect(sampleRecoveryMotion(from, to, 879, reveal).pose).toEqual(reveal);
    expect(sampleRecoveryMotion(from, to, RECOVERY_DURATION_MS, reveal).pose).toEqual(to);
    for (const time of [1, 80, 159, 300, 880, 1000, 1179]) {
      expect(sampleRecoveryMotion(from, to, time, reveal).pose).toEqual(
        sampleWaitingRoomCardPose(to, reveal, from, RECOVERY_DURATION_MS - time)
      );
    }
    expect(getBattleAnimationEventDurationMs(event)).toBe(1180);
    expect(getBattleAnimationEventDurationMs(event, true)).toBe(120);
  });
  it.each([-25, -12, 0, 12, 25])(
    'recovers actual scaled dimensions at fan angle %s',
    (rotation) => {
      const radians = (rotation * Math.PI) / 180;
      const w = 75,
        h = 105;
      const width = w * Math.abs(Math.cos(radians)) + h * Math.abs(Math.sin(radians));
      const height = h * Math.abs(Math.cos(radians)) + w * Math.abs(Math.sin(radians));
      const pose = recoveryPoseFromBounds(
        { left: 200 - width / 2, top: 300 - height / 2, width, height },
        rotation
      );
      expect(pose.width).toBeCloseTo(w);
      expect(pose.height).toBeCloseTo(h);
      expect(pose.left).toBeCloseTo(200 - w / 2);
      expect(pose.top).toBeCloseTo(300 - h / 2);
      const resized = { ...pose, left: 100, top: 180, width: 50, height: 70, rotation: -18 };
      expect(sampleRecoveryMotion(from, resized, RECOVERY_DURATION_MS, reveal).pose).toEqual(
        resized
      );
    }
  );
  it('groups same-seat cards into a simultaneous fan without mixing seats', () => {
    const scheduled = createSequencedBattleAnimationEvents([
      event,
      { ...event, id: 'second' },
      { ...event, id: 'other-seat', toSeat: 'SECOND' },
    ]);
    expect(scheduled.map((e) => e.delayMs)).toEqual([0, 0, 0]);
    expect(scheduled.map(({ event }) => event.kind === 'CARD_MOVE' && event.recoveryGroup)).toEqual(
      [
        { index: 0, count: 2 },
        { index: 1, count: 2 },
        { index: 0, count: 1 },
      ]
    );
    expect(scheduled.map((e) => e.delayMs + getBattleAnimationEventDurationMs(e.event))).toEqual([
      1180, 1180, 1180,
    ]);
  });
});

describe('discard before recovery presentation', () => {
  it('waits for late public logs, then the same-seat discard, and releases multiple pickups together', () => {
    const pending = [event, { ...event, id: 'second' }].map((event) => ({
      event,
      receivedAt: 100,
    }));
    const backfill = drainRecoveryPresentations(pending, {
      now: 110,
      publicLogCaughtUp: false,
      discardSeats: new Set(),
    });
    expect(backfill.ready).toEqual([]);
    const discarding = drainRecoveryPresentations(backfill.waiting, {
      now: 250,
      publicLogCaughtUp: true,
      discardSeats: new Set(['FIRST']),
    });
    expect(discarding.ready).toEqual([]);
    const released = drainRecoveryPresentations(discarding.waiting, {
      now: 1500,
      publicLogCaughtUp: true,
      discardSeats: new Set(),
    });
    expect(released.waiting).toEqual([]);
    expect(released.expired).toEqual([]);
    expect(
      createSequencedBattleAnimationEvents(released.ready).map((entry) => entry.delayMs)
    ).toEqual([0, 0]);
  });
  it('does not delay a pickup for another seat, or a recovery with no discard', () => {
    for (const discardSeats of [
      new Set<'FIRST' | 'SECOND'>(),
      new Set<'FIRST' | 'SECOND'>(['SECOND']),
    ]) {
      expect(
        drainRecoveryPresentations([{ event, receivedAt: 100 }], {
          now: 101,
          publicLogCaughtUp: true,
          discardSeats,
        }).ready
      ).toEqual([event]);
    }
  });
  it('expires a stalled pickup without replaying it when the public log eventually catches up', () => {
    const expired = drainRecoveryPresentations([{ event, receivedAt: 100 }], {
      now: 100 + RECOVERY_PRESENTATION_MAX_WAIT_MS,
      publicLogCaughtUp: false,
      discardSeats: new Set(['FIRST']),
    });
    expect(expired.expired).toEqual([event]);
    expect(expired.ready).toEqual([]);
    expect(
      drainRecoveryPresentations(expired.waiting, {
        now: 10000,
        publicLogCaughtUp: true,
        discardSeats: new Set(),
      }).ready
    ).toEqual([]);
  });
});

describe('presentation history', () => {
  it('undo and redo reuse rule IDs but have distinct presentation IDs and reject stale completions', () => {
    const history = createBattleAnimationHistory();
    history.sync({ matchId: 'one', viewerSeat: 'FIRST', seq: 2 });
    history.sync({ matchId: 'one', viewerSeat: 'FIRST', seq: 3 });
    const first = history.accept([event]);
    expect(history.accept([event])).toEqual([]);
    expect(history.sync({ matchId: 'one', viewerSeat: 'FIRST', seq: 2 })).toBe(true);
    history.sync({ matchId: 'one', viewerSeat: 'FIRST', seq: 3 });
    const second = history.accept([event]);
    expect(second).toHaveLength(1);
    expect(second[0].id).not.toBe(first[0].id);
    expect(second.filter((e) => e.id !== first[0].id)).toEqual(second);
  });
  it('resets for equal-sequence epoch changes, seats, match switches and read-only changes', () => {
    const history = createBattleAnimationHistory();
    const cursor = {
      matchId: 'one',
      viewerSeat: 'FIRST',
      seq: 3,
      presentationEpoch: 0,
      isReadOnly: false,
    };
    history.sync(cursor);
    history.accept([event]);
    for (const update of [
      { presentationEpoch: 1 },
      { viewerSeat: 'SECOND' },
      { matchId: 'two' },
      { isReadOnly: true },
    ]) {
      expect(history.sync({ ...cursor, ...update })).toBe(true);
      expect(history.accept([event])).toHaveLength(1);
    }
  });
});
