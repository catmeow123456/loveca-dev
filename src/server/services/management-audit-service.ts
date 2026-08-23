import type { PoolClient } from 'pg';
import type { UserRole } from '../../shared/auth/permissions.js';
import { stableJsonStringify } from './replay-payload-serialization.js';

export interface ManagementAuditInput {
  readonly actorUserId: string | null;
  readonly actorRole: UserRole;
  readonly scope: 'DECK_CLASSIFIER';
  readonly action: string;
  readonly targetType: string;
  readonly targetId: string;
  readonly requestId: string;
  readonly result?: 'SUCCEEDED' | 'FAILED';
  readonly reason?: string | null;
  readonly before?: unknown;
  readonly after?: unknown;
}

export async function writeManagementAudit(
  client: Pick<PoolClient, 'query'>,
  input: ManagementAuditInput
): Promise<void> {
  await client.query(
    `INSERT INTO management_audit_logs (
       actor_user_id,
       actor_role,
       scope,
       action,
       target_type,
       target_id,
       request_id,
       result,
       reason,
       before,
       after
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11::jsonb)`,
    [
      input.actorUserId,
      input.actorRole,
      input.scope,
      requireText(input.action, 'audit action'),
      requireText(input.targetType, 'audit target type'),
      requireText(input.targetId, 'audit target ID'),
      requireText(input.requestId, 'audit request ID'),
      input.result ?? 'SUCCEEDED',
      input.reason?.trim() || null,
      input.before === undefined ? null : stableJsonStringify(input.before),
      input.after === undefined ? null : stableJsonStringify(input.after),
    ]
  );
}

function requireText(value: string, label: string): string {
  const result = value.trim();
  if (!result) throw new Error(`${label} is required`);
  return result;
}
