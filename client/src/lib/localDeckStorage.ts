import { z } from 'zod/v4';
import { DeckConfigSchema, type DeckConfig } from '@game/domain/card-data/deck-loader';

export const LOCAL_DECK_STORAGE_KEY = 'loveca.local-decks.v1';

export interface LocalDeck {
  id: string;
  name: string;
  description?: string;
  config: DeckConfig;
  updatedAt: Date;
}

export interface LocalDeckStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const storedLocalDeckSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  config: DeckConfigSchema,
  updatedAt: z.string().refine((value) => !Number.isNaN(Date.parse(value))),
});

const storedLocalDeckEnvelopeSchema = z.object({
  version: z.literal(1),
  decks: z.array(storedLocalDeckSchema),
});

function getBrowserStorage(): LocalDeckStorage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function readLocalDecks(
  storage: LocalDeckStorage | null = getBrowserStorage()
): LocalDeck[] {
  if (!storage) return [];

  try {
    const raw = storage.getItem(LOCAL_DECK_STORAGE_KEY);
    if (!raw) return [];

    const parsed = storedLocalDeckEnvelopeSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) return [];

    return parsed.data.decks.map((deck) => ({
      ...deck,
      updatedAt: new Date(deck.updatedAt),
    }));
  } catch {
    return [];
  }
}

export function writeLocalDecks(
  decks: readonly LocalDeck[],
  storage: LocalDeckStorage | null = getBrowserStorage()
): void {
  if (!storage) {
    throw new Error('当前环境不支持浏览器本地存储');
  }

  storage.setItem(
    LOCAL_DECK_STORAGE_KEY,
    JSON.stringify({
      version: 1,
      decks: decks.map((deck) => ({
        ...deck,
        updatedAt: deck.updatedAt.toISOString(),
      })),
    })
  );
}

export function createLocalDeckId(): string {
  return `local-${crypto.randomUUID()}`;
}
