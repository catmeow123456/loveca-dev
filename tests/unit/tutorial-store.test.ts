import type { TutorialSessionSnapshot } from '../../src/online/tutorial-types';

const tutorialClient = vi.hoisted(() => ({
  advanceTutorialScript: vi.fn(),
  createTutorialSession: vi.fn(),
  deleteTutorialSession: vi.fn(),
  executeTutorialCommand: vi.fn(),
  fetchTutorialSession: vi.fn(),
}));

const tutorialRuntimeStorage = vi.hoisted(() => ({
  clearTutorialRuntime: vi.fn(),
  readTutorialRuntime: vi.fn(() => null),
  writeTutorialRuntime: vi.fn(),
}));

vi.mock('@/lib/tutorialClient', () => tutorialClient);
vi.mock('@/lib/tutorialRuntimeStorage', () => tutorialRuntimeStorage);

import { useTutorialStore } from '../../client/src/store/tutorialStore';

beforeEach(async () => {
  vi.clearAllMocks();
  tutorialClient.deleteTutorialSession.mockResolvedValue(undefined);
  await useTutorialStore.getState().stop();
  vi.clearAllMocks();
  tutorialClient.deleteTutorialSession.mockResolvedValue(undefined);
});

it('退出加载中的教程后忽略迟到响应并清理服务端会话', async () => {
  let resolveCreate!: (value: {
    readonly accessToken: string;
    readonly snapshot: TutorialSessionSnapshot;
  }) => void;
  tutorialClient.createTutorialSession.mockReturnValueOnce(
    new Promise((resolve) => {
      resolveCreate = resolve;
    })
  );

  const pendingStart = useTutorialStore.getState().start('basic-live-loop', '1.1.5', 'FOUNDATIONS');
  expect(useTutorialStore.getState().loadState).toBe('LOADING');

  await useTutorialStore.getState().stop();
  resolveCreate({
    accessToken: 'late-token',
    snapshot: {
      runId: 'late-run',
      scenarioId: 'basic-live-loop',
      scenarioVersion: '1.1.5',
      checkpointId: 'FOUNDATIONS',
    } as TutorialSessionSnapshot,
  });

  await expect(pendingStart).rejects.toThrow('教程创建已取消');
  expect(tutorialClient.deleteTutorialSession).toHaveBeenCalledWith('late-run', 'late-token');
  expect(useTutorialStore.getState()).toMatchObject({
    runtime: null,
    loadState: 'IDLE',
    error: null,
  });
});

it('创建、恢复并退出教程时同步维护恢复记录', async () => {
  const initialSnapshot = {
    runId: 'persisted-run',
    scenarioId: 'basic-live-loop',
    scenarioVersion: '1.1.5',
    checkpointId: 'FOUNDATIONS',
  } as TutorialSessionSnapshot;
  const refreshedSnapshot = { ...initialSnapshot, expiresAt: 99_999 } as TutorialSessionSnapshot;
  tutorialClient.createTutorialSession.mockResolvedValue({
    accessToken: 'persisted-token',
    snapshot: initialSnapshot,
  });
  tutorialClient.fetchTutorialSession.mockResolvedValue(refreshedSnapshot);

  await useTutorialStore.getState().start('basic-live-loop', '1.1.5', 'FOUNDATIONS');
  expect(tutorialRuntimeStorage.writeTutorialRuntime).toHaveBeenLastCalledWith({
    accessToken: 'persisted-token',
    snapshot: initialSnapshot,
  });

  const progress = {
    scenarioId: 'basic-live-loop',
    scenarioVersion: '1.1.5',
    currentStepIndex: 1,
    entryStepIndex: 0,
    enteredAtSeq: 0,
    completedStepIds: ['welcome'],
    status: 'ACTIVE' as const,
  };
  useTutorialStore.getState().setProgress(progress);
  expect(tutorialRuntimeStorage.writeTutorialRuntime).toHaveBeenLastCalledWith({
    accessToken: 'persisted-token',
    snapshot: initialSnapshot,
    progress,
  });

  useTutorialStore.setState({ loadState: 'LOADING' });
  await useTutorialStore.getState().resume();
  expect(tutorialClient.fetchTutorialSession).toHaveBeenCalledWith(
    'persisted-run',
    'persisted-token'
  );
  expect(tutorialRuntimeStorage.writeTutorialRuntime).toHaveBeenLastCalledWith({
    accessToken: 'persisted-token',
    snapshot: refreshedSnapshot,
    progress,
  });

  await useTutorialStore.getState().stop();
  expect(tutorialRuntimeStorage.clearTutorialRuntime).toHaveBeenCalledOnce();
  expect(tutorialClient.deleteTutorialSession).toHaveBeenCalledWith(
    'persisted-run',
    'persisted-token'
  );
});
