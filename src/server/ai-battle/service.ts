import { AiBattleService } from '../services/ai-battle-service.js';
import { DashScopeAiBattleClient, readAiModelConfig } from './model-client.js';

/** Configuration is read and frozen when creating a game, never by observation polling. */
export const aiBattleService = new AiBattleService({
  createModel: (knowledge, traces) =>
    Promise.resolve(new DashScopeAiBattleClient(readAiModelConfig(), knowledge, traces)),
});
