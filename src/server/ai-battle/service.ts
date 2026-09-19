import { AI_BATTLE_MODELS, API_AI_BATTLE_MODELS } from '../../online/ai-battle-model-registry.js';
import { readLocalCodexConfig } from './local-codex-config.js';
import { AiBattleService } from '../services/ai-battle-service.js';
import { createPlatformAiBattleClient } from './configuration.js';

/** Configuration is read and frozen when creating a game, never by observation polling. */
export const aiBattleService = new AiBattleService({
  createModel: createPlatformAiBattleClient,
  availableModels: () => (readLocalCodexConfig() ? AI_BATTLE_MODELS : API_AI_BATTLE_MODELS),
});
