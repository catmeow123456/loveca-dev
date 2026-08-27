import { describe, expect, it, vi } from 'vitest';
import {
  readTutorialCompletion,
  TUTORIAL_COMPLETION_STORAGE_KEY,
  writeTutorialCompletion,
} from '../../client/src/lib/tutorialCompletion';

const CURRENT_TUTORIAL = {
  scenarioId: 'basic-live-loop',
  scenarioVersion: '1.1.6',
  contentVersion: 17,
} as const;

describe('tutorial completion marker', () => {
  it('recognizes only the completed scenario and content version', () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    };

    expect(readTutorialCompletion(storage, CURRENT_TUTORIAL)).toBe(false);

    writeTutorialCompletion(storage, CURRENT_TUTORIAL, 1_777);

    expect(readTutorialCompletion(storage, CURRENT_TUTORIAL)).toBe(true);
    expect(readTutorialCompletion(storage, { ...CURRENT_TUTORIAL, scenarioVersion: '1.1.5' })).toBe(
      false
    );
    expect(readTutorialCompletion(storage, { ...CURRENT_TUTORIAL, contentVersion: 18 })).toBe(
      false
    );
    expect(JSON.parse(values.get(TUTORIAL_COMPLETION_STORAGE_KEY) ?? '')).toMatchObject({
      schemaVersion: 1,
      ...CURRENT_TUTORIAL,
      completedAt: 1_777,
    });
  });

  it('silently degrades for malformed or unavailable storage', () => {
    const getItem = vi.fn(() => '{broken-json');
    const setItem = vi.fn(() => {
      throw new Error('storage unavailable');
    });

    expect(readTutorialCompletion({ getItem }, CURRENT_TUTORIAL)).toBe(false);
    expect(() => writeTutorialCompletion({ setItem }, CURRENT_TUTORIAL)).not.toThrow();
    expect(readTutorialCompletion(null, CURRENT_TUTORIAL)).toBe(false);
    expect(() => writeTutorialCompletion(null, CURRENT_TUTORIAL)).not.toThrow();
  });
});
