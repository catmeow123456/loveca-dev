import { fromTransport, toTransport, type TutorialSessionSnapshot } from '@game/online';
import type { TutorialProgressState } from '@/lib/tutorialScenario';

export const TUTORIAL_RUNTIME_STORAGE_KEY = 'loveca.tutorial.runtime.v1';

export interface PersistedTutorialRuntime {
  readonly accessToken: string;
  readonly snapshot: TutorialSessionSnapshot;
  readonly progress?: TutorialProgressState;
}

interface TutorialRuntimeStorageRecord {
  readonly schemaVersion: 1;
  readonly runtime: unknown;
}

function getTutorialRuntimeStorage(): Storage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function isPersistedTutorialRuntimeCore(value: unknown): value is PersistedTutorialRuntime {
  if (!value || typeof value !== 'object') return false;
  const runtime = value as Partial<PersistedTutorialRuntime>;
  const snapshot = runtime.snapshot as Partial<TutorialSessionSnapshot> | undefined;
  return (
    typeof runtime.accessToken === 'string' &&
    runtime.accessToken.length > 0 &&
    !!snapshot &&
    typeof snapshot.runId === 'string' &&
    snapshot.runId.length > 0 &&
    typeof snapshot.scenarioId === 'string' &&
    typeof snapshot.scenarioVersion === 'string' &&
    typeof snapshot.checkpointId === 'string'
  );
}

function isTutorialProgressState(value: unknown): value is TutorialProgressState {
  if (!value || typeof value !== 'object') return false;
  const progress = value as Partial<TutorialProgressState>;
  return (
    typeof progress.scenarioId === 'string' &&
    typeof progress.scenarioVersion === 'string' &&
    Number.isInteger(progress.currentStepIndex) &&
    Number(progress.currentStepIndex) >= 0 &&
    Number.isInteger(progress.entryStepIndex) &&
    Number(progress.entryStepIndex) >= 0 &&
    Number(progress.currentStepIndex) >= Number(progress.entryStepIndex) &&
    Number.isInteger(progress.enteredAtSeq) &&
    Number(progress.enteredAtSeq) >= 0 &&
    Array.isArray(progress.completedStepIds) &&
    progress.completedStepIds.every((stepId) => typeof stepId === 'string') &&
    (progress.viewConditionSatisfiedAtMs === undefined ||
      (typeof progress.viewConditionSatisfiedAtMs === 'number' &&
        Number.isFinite(progress.viewConditionSatisfiedAtMs))) &&
    (progress.error === undefined || typeof progress.error === 'string') &&
    (progress.status === 'ACTIVE' || progress.status === 'COMPLETED' || progress.status === 'ERROR')
  );
}

export function readTutorialRuntime(
  storage: Storage | null = getTutorialRuntimeStorage()
): PersistedTutorialRuntime | null {
  if (!storage) return null;
  try {
    const serialized = storage.getItem(TUTORIAL_RUNTIME_STORAGE_KEY);
    if (!serialized) return null;
    const record = JSON.parse(serialized) as Partial<TutorialRuntimeStorageRecord>;
    if (record.schemaVersion !== 1) {
      storage.removeItem(TUTORIAL_RUNTIME_STORAGE_KEY);
      return null;
    }
    const runtime = fromTransport<PersistedTutorialRuntime>(record.runtime);
    if (!isPersistedTutorialRuntimeCore(runtime)) {
      storage.removeItem(TUTORIAL_RUNTIME_STORAGE_KEY);
      return null;
    }
    if (
      runtime.progress !== undefined &&
      (!isTutorialProgressState(runtime.progress) ||
        runtime.progress.scenarioId !== runtime.snapshot.scenarioId ||
        runtime.progress.scenarioVersion !== runtime.snapshot.scenarioVersion)
    ) {
      return { accessToken: runtime.accessToken, snapshot: runtime.snapshot };
    }
    return runtime;
  } catch {
    try {
      storage.removeItem(TUTORIAL_RUNTIME_STORAGE_KEY);
    } catch {
      // sessionStorage 不可用时保留内存会话。
    }
    return null;
  }
}

export function writeTutorialRuntime(
  runtime: PersistedTutorialRuntime,
  storage: Storage | null = getTutorialRuntimeStorage()
): void {
  if (!storage) return;
  try {
    const record: TutorialRuntimeStorageRecord = {
      schemaVersion: 1,
      runtime: toTransport(runtime),
    };
    storage.setItem(TUTORIAL_RUNTIME_STORAGE_KEY, JSON.stringify(record));
  } catch {
    // 持久化只是刷新恢复能力，失败不能阻断当前教程。
  }
}

export function clearTutorialRuntime(storage: Storage | null = getTutorialRuntimeStorage()): void {
  if (!storage) return;
  try {
    storage.removeItem(TUTORIAL_RUNTIME_STORAGE_KEY);
  } catch {
    // 显式退出仍应继续清理内存状态与服务端会话。
  }
}
