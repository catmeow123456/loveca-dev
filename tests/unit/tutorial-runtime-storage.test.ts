import { describe, expect, it, vi } from 'vitest';
import type { TutorialSessionSnapshot } from '../../src/online/tutorial-types';
import {
  clearTutorialRuntime,
  readTutorialRuntime,
  TUTORIAL_RUNTIME_STORAGE_KEY,
  writeTutorialRuntime,
} from '../../client/src/lib/tutorialRuntimeStorage';

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();

  get length(): number {
    return this.values.size;
  }

  clear(): void {
    this.values.clear();
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.values.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

function buildRuntime() {
  return {
    accessToken: 'tutorial-token',
    snapshot: {
      runId: 'tutorial-run',
      scenarioId: 'basic-live-loop',
      scenarioVersion: '1.1.5',
      checkpointId: 'FOUNDATIONS',
      probeMap: new Map([['visible-card', 1]]),
    } as unknown as TutorialSessionSnapshot,
    progress: {
      scenarioId: 'basic-live-loop',
      scenarioVersion: '1.1.5',
      currentStepIndex: 1,
      entryStepIndex: 0,
      enteredAtSeq: 0,
      completedStepIds: ['welcome'],
      status: 'ACTIVE' as const,
    },
  };
}

describe('tutorial runtime session storage', () => {
  it('round-trips the temporary credential and transport-safe snapshot', () => {
    const storage = new MemoryStorage();

    writeTutorialRuntime(buildRuntime(), storage);
    const restored = readTutorialRuntime(storage);

    expect(restored).toMatchObject({
      accessToken: 'tutorial-token',
      snapshot: {
        runId: 'tutorial-run',
        checkpointId: 'FOUNDATIONS',
      },
      progress: {
        currentStepIndex: 1,
        completedStepIds: ['welcome'],
      },
    });
    expect((restored?.snapshot as unknown as { probeMap: Map<string, number> }).probeMap).toEqual(
      new Map([['visible-card', 1]])
    );
  });

  it('removes malformed records and tolerates unavailable storage', () => {
    const storage = new MemoryStorage();
    storage.setItem(TUTORIAL_RUNTIME_STORAGE_KEY, '{broken-json');

    expect(readTutorialRuntime(storage)).toBeNull();
    expect(storage.getItem(TUTORIAL_RUNTIME_STORAGE_KEY)).toBeNull();

    const unavailable = {
      getItem: vi.fn(() => {
        throw new Error('blocked');
      }),
      removeItem: vi.fn(() => {
        throw new Error('blocked');
      }),
    } as unknown as Storage;
    expect(readTutorialRuntime(unavailable)).toBeNull();
    expect(() => clearTutorialRuntime(unavailable)).not.toThrow();
  });

  it('keeps the server credential while discarding mismatched UI progress', () => {
    const storage = new MemoryStorage();
    const runtime = buildRuntime();
    writeTutorialRuntime(
      {
        ...runtime,
        progress: { ...runtime.progress, scenarioId: 'another-scenario' },
      },
      storage
    );

    const restored = readTutorialRuntime(storage);

    expect(restored).toMatchObject({
      accessToken: 'tutorial-token',
      snapshot: { runId: 'tutorial-run' },
    });
    expect(restored).not.toHaveProperty('progress');
  });

  it('clears the persisted runtime on explicit exit', () => {
    const storage = new MemoryStorage();
    writeTutorialRuntime(buildRuntime(), storage);

    clearTutorialRuntime(storage);

    expect(storage.getItem(TUTORIAL_RUNTIME_STORAGE_KEY)).toBeNull();
  });
});
