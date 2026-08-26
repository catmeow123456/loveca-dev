import { createBasicLiveTutorialScenario } from './basic-live-tutorial-scenario.js';
import { getPublishedCardRegistry } from './card-registry-service.js';
import { TutorialSessionService } from './tutorial-session-service.js';

let tutorialSessionServicePromise: Promise<TutorialSessionService> | null = null;

/**
 * 教程运行时按进程保存临时会话；场景只从已发布卡池构造，且不会写入正式对局记录。
 */
export function getTutorialSessionService(): Promise<TutorialSessionService> {
  tutorialSessionServicePromise ??= getPublishedCardRegistry().then(
    (registry) =>
      new TutorialSessionService({
        scenarios: [createBasicLiveTutorialScenario(registry)],
      })
  );
  return tutorialSessionServicePromise;
}
