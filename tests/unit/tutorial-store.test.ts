import type { TutorialSessionSnapshot } from '../../src/online/tutorial-types';

const tutorialClient = vi.hoisted(() => ({
  advanceTutorialScript: vi.fn(),
  createTutorialSession: vi.fn(),
  deleteTutorialSession: vi.fn(),
  executeTutorialCommand: vi.fn(),
  fetchTutorialSession: vi.fn(),
}));

vi.mock('@/lib/tutorialClient', () => tutorialClient);

import { useTutorialStore } from '../../client/src/store/tutorialStore';

beforeEach(async () => {
  vi.clearAllMocks();
  tutorialClient.deleteTutorialSession.mockResolvedValue(undefined);
  await useTutorialStore.getState().stop();
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
