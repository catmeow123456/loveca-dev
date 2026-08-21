import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  parsePublicSiteStatusSnapshot,
  PublicSiteStatusSnapshotError,
  PublicSiteStatusSnapshotService,
} from '../../src/server/services/public-site-status-snapshot-service';

const MAINTENANCE = {
  id: 'default',
  title: '版本更新',
  summary: '平台正在进行整站维护。',
  detail: null,
  startsAt: '2026-08-21T12:00:00.000Z',
  estimatedEndsAt: '2026-08-21T12:30:00.000Z',
  restrictsNewGamesAt: null,
  impactScopes: ['整站'],
  restrictions: [],
  action: '请稍后重新检查',
  updatedAt: '2026-08-21T12:00:00.000Z',
} as const;

describe('PublicSiteStatusSnapshotService', () => {
  it('atomically writes and inspects a maintenance snapshot', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'loveca-site-status-'));
    const snapshotPath = join(directory, 'nested', 'site-status.json');
    const service = new PublicSiteStatusSnapshotService({
      PUBLIC_SITE_STATUS_SNAPSHOT_PATH: snapshotPath,
    });

    await service.write('MAINTENANCE', MAINTENANCE, new Date('2026-08-21T12:00:00.000Z'));

    expect(parsePublicSiteStatusSnapshot(await readFile(snapshotPath, 'utf8'))).toMatchObject({
      schemaVersion: 1,
      availability: 'MAINTENANCE',
      maintenance: { title: '版本更新' },
    });
    await expect(service.inspect()).resolves.toEqual({
      status: 'SYNCED',
      availability: 'MAINTENANCE',
      generatedAt: '2026-08-21T12:00:00.000Z',
      error: null,
    });
  });

  it('rejects an open snapshot that still contains maintenance content', () => {
    expect(() =>
      parsePublicSiteStatusSnapshot(
        JSON.stringify({
          schemaVersion: 1,
          availability: 'OPEN',
          generatedAt: '2026-08-21T12:00:00.000Z',
          maintenance: MAINTENANCE,
        })
      )
    ).toThrow(PublicSiteStatusSnapshotError);
  });

  it('reports an unverified state when no operational path is configured', async () => {
    const service = new PublicSiteStatusSnapshotService({});
    await expect(service.inspect()).resolves.toMatchObject({
      status: 'UNVERIFIED',
      availability: null,
    });
  });
});
