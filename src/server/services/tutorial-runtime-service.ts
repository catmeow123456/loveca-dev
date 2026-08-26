import { createBasicLiveTutorialScenario } from './basic-live-tutorial-scenario.js';
import { getPublishedCardRegistry } from './card-registry-service.js';
import { TutorialSessionService } from './tutorial-session-service.js';

const TUTORIAL_SESSION_CLEANUP_INTERVAL_MS = 60 * 1000;

export function createRetryableSingletonLoader<T>(factory: () => Promise<T>): () => Promise<T> {
  let pending: Promise<T> | null = null;
  return () => {
    pending ??= factory().catch((error) => {
      pending = null;
      throw error;
    });
    return pending;
  };
}

const loadTutorialSessionService = createRetryableSingletonLoader(async () => {
  const registry = await getPublishedCardRegistry();
  const service = new TutorialSessionService({
    scenarios: [createBasicLiveTutorialScenario(registry)],
  });
  const cleanupTimer = setInterval(
    () => service.cleanupExpiredSessions(),
    TUTORIAL_SESSION_CLEANUP_INTERVAL_MS
  );
  cleanupTimer.unref();
  return service;
});

/**
 * 教程运行时按进程保存临时会话；场景只从已发布卡池构造，且不会写入正式对局记录。
 */
export function getTutorialSessionService(): Promise<TutorialSessionService> {
  return loadTutorialSessionService();
}
