import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { Pool, PoolClient } from 'pg';
import { readDeckClassifierSeedPackage } from '../src/server/services/deck-classifier-seed-package.js';
import { stableJsonStringify } from '../src/server/services/replay-payload-serialization.js';

interface CliOptions {
  readonly zipPath: string;
  readonly apply: boolean;
  readonly actorUserId?: string;
  readonly reason: string;
}

let databasePool: Pool | undefined;

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  const archive = await readFile(options.zipPath);
  const seed = await readDeckClassifierSeedPackage(archive);
  const summary = {
    catalogVersion: seed.catalogVersion,
    ruleVersion: seed.ruleVersion,
    archetypeCount: seed.archetypes.length,
    templateCount: seed.templates.length,
    activeTemplateCount: seed.activeTemplateCount,
    provisionalTemplateCount: seed.provisionalTemplateCount,
    ruleCount: seed.rules.length,
    ignoredSoftSignatureCount: seed.ignoredSoftSignatureCount,
    apply: options.apply,
  };
  if (!options.apply) {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    return;
  }
  if (!options.actorUserId) throw new Error('--apply 时必须提供 --actor-user-id=<uuid>');
  const { pool } = await import('../src/server/db/pool.js');
  databasePool = pool;
  const client = await pool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
    await client.query("SELECT pg_advisory_xact_lock(hashtext('deck-classifier-seed-import'))");
    const actor = await client.query<{ role: string }>(
      `SELECT role FROM profiles WHERE id = $1 AND role IN ('admin', 'season_admin')`,
      [options.actorUserId]
    );
    if (!actor.rows[0]) throw new Error('操作人不存在或不是管理员/赛季管理员');
    const archetypeIds = new Map<string, string>();
    for (const archetype of seed.archetypes) {
      const saved = await client.query<{ id: string }>(
        `INSERT INTO deck_archetypes (
           archetype_key, name, group_name, description, color_key, sort_order,
           lifecycle, created_by, updated_by
         )
         VALUES ($1, $2, $3, $4, $5, $6, 'ACTIVE', $7, $7)
         ON CONFLICT (archetype_key) DO UPDATE SET
           name = EXCLUDED.name,
           group_name = EXCLUDED.group_name,
           description = EXCLUDED.description,
           color_key = EXCLUDED.color_key,
           sort_order = EXCLUDED.sort_order,
           lifecycle = 'ACTIVE',
           updated_by = EXCLUDED.updated_by,
           updated_at = NOW()
         RETURNING id`,
        [
          archetype.archetypeKey,
          archetype.name,
          archetype.groupName,
          archetype.description,
          archetype.color,
          archetype.sortOrder,
          options.actorUserId,
        ]
      );
      const id = saved.rows[0]?.id;
      if (!id) throw new Error(`保存分类 ${archetype.archetypeKey} 失败`);
      archetypeIds.set(archetype.archetypeKey, id);
    }
    for (const template of seed.templates) {
      const archetypeId = requireMappedArchetype(archetypeIds, template.archetypeKey);
      const existing = await client.query<{ id: string; source_kind: string }>(
        `SELECT id, source_kind FROM deck_archetype_templates WHERE deck_fingerprint = $1 FOR UPDATE`,
        [template.deckFingerprint]
      );
      if (
        existing.rows.length > 1 ||
        (existing.rows[0] && existing.rows[0].source_kind !== 'SEED_PACKAGE')
      ) {
        throw new Error(`指纹 ${template.deckFingerprint} 已被非种子样板使用，已停止导入`);
      }
      if (existing.rows[0]) {
        await client.query(
          `UPDATE deck_archetype_templates
              SET archetype_id = $2, name = $3, cards = $4::jsonb,
                  source_note = $5, enabled = $6, updated_by = $7, updated_at = NOW()
            WHERE id = $1`,
          [
            existing.rows[0].id,
            archetypeId,
            template.name,
            stableJsonStringify(template.cards),
            template.sourceNote,
            template.enabled,
            options.actorUserId,
          ]
        );
      } else {
        await client.query(
          `INSERT INTO deck_archetype_templates (
             archetype_id, name, deck_fingerprint, cards, source_kind, source_note,
             enabled, created_by, updated_by
           )
           VALUES ($1, $2, $3, $4::jsonb, 'SEED_PACKAGE', $5, $6, $7, $7)`,
          [
            archetypeId,
            template.name,
            template.deckFingerprint,
            stableJsonStringify(template.cards),
            template.sourceNote,
            template.enabled,
            options.actorUserId,
          ]
        );
      }
    }
    for (const rule of seed.rules) {
      const archetypeId = requireMappedArchetype(archetypeIds, rule.archetypeKey);
      const existing = await client.query<{ id: string }>(
        'SELECT id FROM deck_archetype_rules WHERE name = $1 FOR UPDATE',
        [rule.name]
      );
      if (existing.rows.length > 1) throw new Error(`种子规则 ${rule.sourceKey} 存在重复记录`);
      if (existing.rows[0]) {
        await client.query(
          `UPDATE deck_archetype_rules
              SET archetype_id = $2, priority = $3, definition = $4::jsonb,
                  enabled = $5, updated_by = $6, updated_at = NOW()
            WHERE id = $1`,
          [
            existing.rows[0].id,
            archetypeId,
            rule.priority,
            stableJsonStringify(rule.definition),
            rule.enabled,
            options.actorUserId,
          ]
        );
      } else {
        await client.query(
          `INSERT INTO deck_archetype_rules (
             archetype_id, name, priority, definition, enabled, created_by, updated_by
           )
           VALUES ($1, $2, $3, $4::jsonb, $5, $6, $6)`,
          [
            archetypeId,
            rule.name,
            rule.priority,
            stableJsonStringify(rule.definition),
            rule.enabled,
            options.actorUserId,
          ]
        );
      }
    }
    await client.query(
      `UPDATE deck_classifier_settings
          SET draft_revision = draft_revision + 1, updated_by = $1, updated_at = NOW()
        WHERE id = 1`,
      [options.actorUserId]
    );
    await writeAudit(client, {
      actorUserId: options.actorUserId,
      actorRole: actor.rows[0].role,
      reason: options.reason,
      summary,
    });
    await client.query('COMMIT');
    process.stdout.write(`${JSON.stringify({ ...summary, committed: true }, null, 2)}\n`);
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function writeAudit(
  client: Pick<PoolClient, 'query'>,
  input: {
    readonly actorUserId: string;
    readonly actorRole: string;
    readonly reason: string;
    readonly summary: Record<string, unknown>;
  }
): Promise<void> {
  await client.query(
    `INSERT INTO management_audit_logs (
       actor_user_id, actor_role, scope, action, target_type, target_id,
       request_id, result, reason, before, after
     )
     VALUES ($1, $2, 'DECK_CLASSIFIER', 'SEED_PACKAGE_IMPORTED', 'SEED_PACKAGE', $3,
             $4, 'SUCCEEDED', $5, NULL, $6::jsonb)`,
    [
      input.actorUserId,
      input.actorRole,
      String(input.summary.catalogVersion),
      `deck-classifier-seed-import:${randomUUID()}`,
      input.reason,
      stableJsonStringify(input.summary),
    ]
  );
}

function parseOptions(args: readonly string[]): CliOptions {
  const values = new Map<string, string>();
  let apply = false;
  for (const argument of args) {
    if (argument === '--apply') {
      apply = true;
      continue;
    }
    const separator = argument.indexOf('=');
    if (!argument.startsWith('--') || separator < 3) throw new Error(`无法识别参数：${argument}`);
    values.set(argument.slice(2, separator), argument.slice(separator + 1));
  }
  const zipPath = values.get('zip')?.trim();
  if (!zipPath) throw new Error('必须提供 --zip=<种子包路径>');
  const reason = values.get('reason')?.trim() ?? '导入 GPT Pro 离线校准卡组分类种子包';
  return {
    zipPath,
    apply,
    actorUserId: values.get('actor-user-id')?.trim(),
    reason,
  };
}

function requireMappedArchetype(values: ReadonlyMap<string, string>, archetypeKey: string): string {
  const id = values.get(archetypeKey);
  if (!id) throw new Error(`未找到分类 ${archetypeKey}`);
  return id;
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    await databasePool?.end();
  });
