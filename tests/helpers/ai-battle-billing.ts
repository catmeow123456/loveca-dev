import type { AiBillingRecord } from '../../src/online/ai-battle-billing-types';
import type { AiBillingPersistence } from '../../src/server/ai-battle/billing';

/** Explicit persistence substitute for fixtures that never connect to a business database. */
export function createMemoryAiBilling(ownerUserId = 'owner') {
  const records = new Map<string, AiBillingRecord>();
  const persistence: AiBillingPersistence = {
    save: (id, record) => {
      if (!records.has(id) || records.get(id)!.revision < record.revision)
        records.set(id, globalThis.structuredClone(record));
      return Promise.resolve();
    },
    readOwned: (id, owner) => Promise.resolve(owner === ownerUserId ? records.get(id) : undefined),
  };
  return { records, persistence };
}
