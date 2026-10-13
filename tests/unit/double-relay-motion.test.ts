import { expect, it } from 'vitest';
import {
  doubleRelayTimeline as t,
  doubleRelayFrame,
  relayBeamPoint,
} from '../../client/src/lib/doubleRelayEntrance';
import { entranceTimeline, entrancePortraitFrame } from '../../client/src/lib/cardEntranceTimeline';
import {
  DOUBLE_RELAY_ENTRANCE_EXTRA_MS,
  ENTRANCE_WAIT_LIMIT_MS,
} from '../../src/shared/card-entrance';
import { ENTRANCE_LOAD_TIMEOUT_MS } from '../../client/src/lib/cardEntranceAssets';
it('gives the new card a continuous handoff before portrait/landing, within the authority deadline', () => {
  expect(doubleRelayFrame(0)).toMatchObject({
    charge: 0,
    dissolve: 0,
    travel: 0,
    form: 0,
    fade: 1,
  });
  expect(doubleRelayFrame(t.charge)).toMatchObject({ charge: 1, dissolve: 0 });
  expect(doubleRelayFrame(t.charge + t.dissolve)).toMatchObject({ dissolve: 1, travel: 0 });
  expect(doubleRelayFrame(t.mergeAt)).toMatchObject({ travel: 1, merge: 0 });
  expect(doubleRelayFrame(t.formAt)).toMatchObject({ merge: 1, form: 0 });
  expect(doubleRelayFrame(t.end)).toMatchObject({ form: 1, fade: 0, finished: true });
  expect(entrancePortraitFrame(t.end - t.portraitAt, false).opacity).toBeGreaterThan(0.8);
  expect(ENTRANCE_LOAD_TIMEOUT_MS + t.portraitAt + entranceTimeline.total).toBeLessThan(
    ENTRANCE_WAIT_LIMIT_MS + DOUBLE_RELAY_ENTRANCE_EXTRA_MS
  );
  for (let ms = 0; ms <= t.end; ms += 10)
    for (const [key, value] of Object.entries(doubleRelayFrame(ms))) {
      if (typeof value === 'number') expect(value, `${key}@${ms}`).toBeGreaterThanOrEqual(0);
      if (typeof value === 'number') expect(value, `${key}@${ms}`).toBeLessThanOrEqual(1);
    }
});
it('both lights leave their own card continuously and meet at exactly the same stage centre', () => {
  const end = { x: 600, y: 250 };
  const left = { x: 480, y: 500 },
    right = { x: 620, y: 500 };
  expect(relayBeamPoint(left, end, -1, 0)).toEqual(left);
  expect(relayBeamPoint(right, end, 1, 0)).toEqual(right);
  expect(relayBeamPoint(left, end, -1, 1)).toEqual(end);
  expect(relayBeamPoint(right, end, 1, 1)).toEqual(end);
  expect(relayBeamPoint(left, end, -1, 0.5).x).toBeLessThan(relayBeamPoint(right, end, 1, 0.5).x);
});
