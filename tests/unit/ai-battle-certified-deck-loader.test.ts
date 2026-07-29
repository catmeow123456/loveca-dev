import { describe, expect, it } from 'vitest';
import { loadCertifiedAiDeckFromRegistry } from '../../src/server/ai-battle/certified-deck-loader';
import { AI_BATTLE_PHASE_ZERO_DECKS } from '../../src/server/ai-battle/phase-zero-baseline';
import { aiBattleAuthoritativeCardRegistry } from '../helpers/ai-battle-phase-zero-decks';

describe('AI battle certified deck loader', () => {
  it('loads both version-controlled decks after canonical content verification', async () => {
    for (const deckKey of ['MUSE_STARTER', 'GREEN_HASUNOSORA_B6'] as const) {
      const loaded = await loadCertifiedAiDeckFromRegistry(
        deckKey,
        aiBattleAuthoritativeCardRegistry
      );
      expect(loaded.deckKey).toBe(deckKey);
      expect(loaded.contentHash).toBe(AI_BATTLE_PHASE_ZERO_DECKS[deckKey].contentHash);
      expect(loaded.phaseZeroBaselineVersion).toBe('ai-battle.phase-zero/v1');
      expect(loaded.runtimeDeck.mainDeck).toHaveLength(60);
      expect(loaded.runtimeDeck.energyDeck).toHaveLength(12);
    }
  });
});
