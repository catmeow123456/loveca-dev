import { createHash } from 'node:crypto';
import type { DeckConfig as RuntimeDeckConfig } from '../../application/game-service.js';
import { fromTransport, toTransport } from '../../online/serde.js';

export interface EncodedPublicTableRuntimeDeck {
  readonly json: string;
  readonly contentHash: string;
}

export function encodePublicTableRuntimeDeck(
  runtimeDeck: RuntimeDeckConfig
): EncodedPublicTableRuntimeDeck {
  const json = JSON.stringify(toTransport(runtimeDeck));
  if (json === undefined) {
    throw new Error('公共牌桌卡组快照无法序列化');
  }
  return {
    json,
    contentHash: createHash('sha256').update(json).digest('hex'),
  };
}

export function decodePublicTableRuntimeDeck(value: unknown): RuntimeDeckConfig {
  const runtimeDeck = fromTransport<RuntimeDeckConfig>(value);
  if (
    !runtimeDeck ||
    !Array.isArray(runtimeDeck.mainDeck) ||
    !Array.isArray(runtimeDeck.energyDeck)
  ) {
    throw new Error('公共牌桌卡组快照格式无效');
  }
  return runtimeDeck;
}
