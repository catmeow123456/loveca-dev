import { performance } from 'node:perf_hooks';
import type { QueryResultRow } from 'pg';
import { pool } from './pool.js';
import { getCurrentRequestId } from '../middleware/request-context.js';
import { readRuntimeDiagnostics } from '../runtime-diagnostics.js';

const SLOW_DATABASE_OPERATION_MS = 1000;
type StartupDatabaseOperation = 'startup-config' | 'auth-refresh';

function report(
  operation: StartupDatabaseOperation,
  phase: 'acquire' | 'query',
  started: number,
  failed: boolean
): void {
  const elapsedMs = performance.now() - started;
  if (!failed && elapsedMs < SLOW_DATABASE_OPERATION_MS) return;
  // Deliberately omit SQL, arguments and error messages: refresh-token values
  // and connection strings must never enter this diagnostic record.
  console.warn(
    JSON.stringify({
      event: 'startup-database-operation',
      requestId: getCurrentRequestId(),
      operation,
      phase,
      outcome: failed ? 'error' : 'slow',
      elapsedMs,
      ...readRuntimeDiagnostics(),
    })
  );
}

export async function connectWithDiagnostics(operation: StartupDatabaseOperation) {
  const started = performance.now();
  try {
    const client = await pool.connect();
    report(operation, 'acquire', started, false);
    return client;
  } catch (error) {
    report(operation, 'acquire', started, true);
    throw error;
  }
}

export async function queryWithDiagnostics<Row extends QueryResultRow>(
  operation: StartupDatabaseOperation,
  text: string,
  values: unknown[]
) {
  const client = await connectWithDiagnostics(operation);
  const started = performance.now();
  let queryError: Error | undefined;
  let onConnectionError!: (error: Error) => void;
  const connectionFailure = new Promise<never>((_resolve, reject) => {
    onConnectionError = reject;
    client.once('error', onConnectionError);
  });
  try {
    const result = await Promise.race([client.query<Row>(text, values), connectionFailure]);
    report(operation, 'query', started, false);
    return result;
  } catch (error) {
    queryError = error instanceof Error ? error : new Error('Database query failed');
    report(operation, 'query', started, true);
    throw error;
  } finally {
    client.removeListener('error', onConnectionError);
    // Match pool.query's handling of failed clients instead of returning a
    // potentially broken connection to the idle pool.
    client.release(queryError);
  }
}
