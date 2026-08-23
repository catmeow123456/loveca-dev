import type { PoolClient, QueryResult, QueryResultRow } from 'pg';
import { CardSyncLeaseLostError, type CardSyncExecutionLease } from './card-sync-engine.js';

export const CARD_SYNC_LEASE_DURATION_SECONDS = 120;

interface Queryable {
  query<R extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: readonly unknown[]
  ): Promise<QueryResult<R>>;
}

export interface CardSyncLeaseIdentity {
  readonly runId: string;
  readonly token: string;
  readonly generation: number;
}

export function leaseIdentity(
  runId: string,
  execution: Pick<CardSyncExecutionLease, 'token' | 'generation'>
): CardSyncLeaseIdentity {
  return { runId, token: execution.token, generation: execution.generation };
}

export function throwIfCardSyncLeaseAborted(signal: AbortSignal): void {
  if (!signal.aborted) return;
  throw signal.reason instanceof CardSyncLeaseLostError
    ? signal.reason
    : new CardSyncLeaseLostError();
}

export async function assertCardSyncLease(
  database: Queryable,
  lease: CardSyncLeaseIdentity,
  signal?: AbortSignal
): Promise<void> {
  if (signal) throwIfCardSyncLeaseAborted(signal);
  const result = await database.query<{ id: string }>(
    `SELECT id
       FROM card_sync_runs
      WHERE id = $1 AND kind = 'APPLY' AND status = 'RUNNING'
        AND lease_token = $2 AND lease_generation = $3
        AND lease_expires_at > NOW()`,
    [lease.runId, lease.token, lease.generation]
  );
  if (result.rowCount !== 1) throw new CardSyncLeaseLostError();
  if (signal) throwIfCardSyncLeaseAborted(signal);
}

export async function renewCardSyncLease(
  database: Queryable,
  lease: CardSyncLeaseIdentity
): Promise<void> {
  const result = await database.query<{ id: string }>(
    `UPDATE card_sync_runs
        SET lease_expires_at = NOW() + ($4 * INTERVAL '1 second'), updated_at = NOW()
      WHERE id = $1 AND kind = 'APPLY' AND status = 'RUNNING'
        AND lease_token = $2 AND lease_generation = $3
        AND lease_expires_at > NOW()
      RETURNING id`,
    [lease.runId, lease.token, lease.generation, CARD_SYNC_LEASE_DURATION_SECONDS]
  );
  if (result.rowCount !== 1) throw new CardSyncLeaseLostError();
}

export async function lockAndRenewCardSyncLease(
  client: Pick<PoolClient, 'query'>,
  lease: CardSyncLeaseIdentity
): Promise<void> {
  await renewCardSyncLease(client as Queryable, lease);
}
