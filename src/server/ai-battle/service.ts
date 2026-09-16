import { AiBattleService } from '../services/ai-battle-service.js';
import { createPlatformAiBattleClient } from './configuration.js';

/** Configuration is read and frozen when creating a game, never by observation polling. */
export const aiBattleService = new AiBattleService({
  createModel: createPlatformAiBattleClient,
});
