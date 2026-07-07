import { describe, expect, it } from 'vitest';
import {
  clearStoredSolitaireMatchId,
  readStoredSolitaireMatchId,
  SOLITAIRE_MATCH_RECOVERY_STORAGE_KEY,
  writeStoredSolitaireMatchId,
} from '../../client/src/lib/solitaireMatchRecovery';

class MemoryStorage {
  readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

describe('solitaire match recovery storage', () => {
  it('stores and reads the current solitaire match id', () => {
    const storage = new MemoryStorage();

    writeStoredSolitaireMatchId('  match-1  ', storage);

    expect(storage.getItem(SOLITAIRE_MATCH_RECOVERY_STORAGE_KEY)).toBe('match-1');
    expect(readStoredSolitaireMatchId(storage)).toBe('match-1');
  });

  it('treats missing and blank stored ids as absent', () => {
    const storage = new MemoryStorage();

    expect(readStoredSolitaireMatchId(storage)).toBeNull();

    storage.setItem(SOLITAIRE_MATCH_RECOVERY_STORAGE_KEY, '   ');

    expect(readStoredSolitaireMatchId(storage)).toBeNull();
  });

  it('clears only the matching stored match id when one is provided', () => {
    const storage = new MemoryStorage();
    writeStoredSolitaireMatchId('match-1', storage);

    clearStoredSolitaireMatchId('match-2', storage);

    expect(readStoredSolitaireMatchId(storage)).toBe('match-1');

    clearStoredSolitaireMatchId('match-1', storage);

    expect(readStoredSolitaireMatchId(storage)).toBeNull();
  });

  it('is safe when storage is unavailable', () => {
    expect(readStoredSolitaireMatchId(null)).toBeNull();
    expect(() => writeStoredSolitaireMatchId('match-1', null)).not.toThrow();
    expect(() => clearStoredSolitaireMatchId('match-1', null)).not.toThrow();
  });
});
