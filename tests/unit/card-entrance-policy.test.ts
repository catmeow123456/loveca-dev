import { afterEach, expect, it, vi } from 'vitest';
import {
  canPresentCardEntrance,
  readCardEntranceEnabled,
  saveCardEntranceEnabled,
} from '../../client/src/lib/cardEntrancePolicy';
import type { BattleSurfaceKind } from '../../client/src/store/battleSurfaceCapabilities';
afterEach(() => vi.unstubAllGlobals());
it('allows player battles, excludes tutorial, spectator, replay and read-only views', () => {
  for (const surface of [
    'LOCAL_DEBUG',
    'REMOTE_DEBUG',
    'SOLITAIRE',
    'ONLINE',
  ] as BattleSurfaceKind[]) {
    expect(canPresentCardEntrance({ surface, isReadOnly: false })).toBe(true);
    expect(canPresentCardEntrance({ surface, isReadOnly: true })).toBe(false);
  }
  for (const surface of [
    'TUTORIAL',
    'AI_DEBUG',
    'SPECTATOR_READONLY',
    'REPLAY_READONLY',
  ] as BattleSurfaceKind[])
    expect(canPresentCardEntrance({ surface, isReadOnly: false })).toBe(false);
});
it('defaults on, remembers a local opt-out and supports opting back in', () => {
  const values = new Map<string, string>();
  vi.stubGlobal('window', {
    localStorage: {
      getItem: (k: string) => values.get(k),
      setItem: (k: string, v: string) => values.set(k, v),
    },
  });
  expect(readCardEntranceEnabled()).toBe(true);
  saveCardEntranceEnabled(false);
  expect(readCardEntranceEnabled()).toBe(false);
  saveCardEntranceEnabled(true);
  expect(readCardEntranceEnabled()).toBe(true);
});
it('storage failures do not prevent entering a battle or toggling', () => {
  vi.stubGlobal('window', {
    get localStorage() {
      throw Error('unavailable');
    },
  });
  expect(readCardEntranceEnabled()).toBe(true);
  expect(() => saveCardEntranceEnabled(false)).not.toThrow();
});
