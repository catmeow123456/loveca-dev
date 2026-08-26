export const TUTORIAL_COMPLETION_STORAGE_KEY = 'loveca:tutorial-completion:v1';

const TUTORIAL_COMPLETION_SCHEMA_VERSION = 1;

export interface TutorialCompletionIdentity {
  readonly scenarioId: string;
  readonly scenarioVersion: string;
  readonly contentVersion: number;
}

export type TutorialCompletionStorage = Pick<Storage, 'getItem' | 'setItem'>;

interface TutorialCompletionRecord extends TutorialCompletionIdentity {
  readonly schemaVersion: typeof TUTORIAL_COMPLETION_SCHEMA_VERSION;
  readonly completedAt: number;
}

export function readTutorialCompletion(
  storage: Pick<TutorialCompletionStorage, 'getItem'> | null,
  identity: TutorialCompletionIdentity
): boolean {
  if (!storage) return false;

  try {
    const raw = storage.getItem(TUTORIAL_COMPLETION_STORAGE_KEY);
    if (!raw) return false;

    const record = JSON.parse(raw) as Partial<TutorialCompletionRecord> | null;
    return (
      record !== null &&
      record.schemaVersion === TUTORIAL_COMPLETION_SCHEMA_VERSION &&
      record.scenarioId === identity.scenarioId &&
      record.scenarioVersion === identity.scenarioVersion &&
      record.contentVersion === identity.contentVersion &&
      typeof record.completedAt === 'number' &&
      Number.isFinite(record.completedAt)
    );
  } catch {
    return false;
  }
}

export function writeTutorialCompletion(
  storage: Pick<TutorialCompletionStorage, 'setItem'> | null,
  identity: TutorialCompletionIdentity,
  completedAt = Date.now()
): void {
  if (!storage) return;

  const record: TutorialCompletionRecord = {
    schemaVersion: TUTORIAL_COMPLETION_SCHEMA_VERSION,
    ...identity,
    completedAt,
  };

  try {
    storage.setItem(TUTORIAL_COMPLETION_STORAGE_KEY, JSON.stringify(record));
  } catch {
    // Storage can be unavailable in private/restricted browser contexts. Tutorial flow still works.
  }
}
