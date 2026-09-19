import { mkdtemp, readFile, rm, stat, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { LocalAiArchive, readLocalArchiveConfig } from '../../src/server/ai-battle/local-archive';
import { AiBattleTraceStore, AI_TRACE_LIMITS } from '../../src/server/ai-battle/trace-store';

const dirs: string[] = [];
const archives: LocalAiArchive[] = [];
const env = {
  AI_BATTLE_LOCAL_ARCHIVE: '1',
  NODE_ENV: 'development',
  API_HOST: '127.0.0.1',
  DATABASE_URL: 'postgres://u:p@localhost/test',
  FRONTEND_URL: 'http://localhost:5173',
  AI_BATTLE_ARCHIVE_DIR: '/tmp/loveca-archive-test',
};
async function fixture(limits?: { fileBytes: number; queueBytes: number }) {
  const dir = await mkdtemp(join(tmpdir(), 'loveca-archive-'));
  dirs.push(dir);
  const archive = await LocalAiArchive.create(
    { directory: dir, frontendOrigin: env.FRONTEND_URL },
    'match-1',
    process.cwd(),
    limits
  );
  archives.push(archive);
  return { archive, dir };
}
async function records(archive: LocalAiArchive) {
  await archive.flush();
  return (await readFile(archive.path, 'utf8'))
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
}
const identity = (id: string) => ({
  id,
  revision: 1,
  windowKey: 'MAIN',
  seat: 'SECOND',
  purpose: 'MAIN',
});
afterEach(async () => {
  await Promise.all(archives.splice(0).map((archive) => archive.close()));
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('local complete AI observation archive', () => {
  it('requires explicit local deployment opt-in, independent of Codex', () => {
    expect(readLocalArchiveConfig({})).toBeNull();
    expect(readLocalArchiveConfig({ ...env, AI_BATTLE_LOCAL_ARCHIVE: '0' })).toBeNull();
    expect(readLocalArchiveConfig(env)?.directory).toBe(env.AI_BATTLE_ARCHIVE_DIR);
    for (const invalid of [
      { NODE_ENV: 'production' },
      { API_HOST: '0.0.0.0' },
      { DATABASE_URL: 'postgres://u:p@remote/test' },
      { FRONTEND_URL: 'https://example.com' },
      { AI_BATTLE_ARCHIVE_DIR: 'relative' },
      { AI_BATTLE_LOCAL_ARCHIVE: 'true' },
    ])
      expect(() => readLocalArchiveConfig({ ...env, ...invalid })).toThrow();
  });

  it('archives before byte truncation, decision eviction and event admission, including late updates', async () => {
    const { archive } = await fixture();
    const store = new AiBattleTraceStore({
      ...AI_TRACE_LIMITS,
      itemBytes: 50,
      decisions: 1,
      eventsPerDecision: 1,
    });
    const source = {
      id: 'rules',
      title: 'rules',
      source: 'rules',
      sha256: 'source-hash',
      content: '规则'.repeat(300),
    };
    store.open('m', [source], archive);
    store.begin('m', identity('1'));
    const large = '完整材料'.repeat(40000); // More than the production 256 KiB per-material cap.
    store.append('m', '1', 'SAMPLE', { text: large }, { status: 'ACCEPTED' });
    store.append('m', '1', 'REQUEST', { extra: 'past event limit' });
    store.begin('m', identity('2'));
    store.append('m', '1', 'COMPLETION', { late: true });
    store.append('m', '2', 'RESPONSE', {
      authorization: 'secret-token',
      text: 'API_KEY=super-secret',
      map: new Map([['a', 1]]),
    });
    store.end('m');
    expect(store.export('m')!.evictedDecisions).toBe(1);
    const rows = await records(archive);
    expect(rows.find((r) => r.kind === 'SOURCES').payload.sources[0].content).toBe(source.content);
    const events = rows.filter((r) => r.kind === 'APPEND');
    expect(events[0].payload.payload.text).toBe(large);
    expect(events[1].payload.payload.extra).toBe('past event limit');
    expect(events[2].payload.payload.late).toBe(true);
    expect(events[3].payload.payload.authorization).toBe('[REDACTED]');
    expect(events[3].payload.payload.text).not.toContain('super-secret');
    expect(events[3].payload.payload.map.__transportType).toBe('Map');
    expect(rows.at(-1).kind).toBe('END');
    expect(archive.status()).toMatchObject({ state: 'ENDED', droppedRecords: 0, queuedBytes: 0 });
    expect((await stat(archive.path)).mode & 0o777).toBe(0o600);
  });

  it('keeps recording decisions even when the memory store cannot admit any', async () => {
    const { archive } = await fixture();
    const store = new AiBattleTraceStore({ ...AI_TRACE_LIMITS, decisions: 0 });
    store.open('m', [], archive);
    store.begin('m', identity('1'));
    store.append('m', '1', 'RESPONSE', { text: 'still captured' });
    expect(store.list('m')!.omittedDecisions).toBe(1);
    expect((await records(archive)).at(-1).payload.payload.text).toBe('still captured');
  });

  it.each(['file', 'queue'] as const)(
    'stops at the %s budget without interrupting observation',
    async (kind) => {
      const { archive } = await fixture({
        fileBytes: kind === 'file' ? 1024 : 10000,
        queueBytes: kind === 'queue' ? 1024 : 10000,
      });
      const store = new AiBattleTraceStore();
      store.open('m', [], archive);
      store.begin('m', identity('1'));
      expect(() =>
        store.append('m', '1', 'SAMPLE', { text: 'x'.repeat(2000) }, { status: 'ACCEPTED' })
      ).not.toThrow();
      await archive.flush();
      expect(store.export('m')!.decisions[0].status).toBe('ACCEPTED');
      expect(archive.status()).toMatchObject({
        state: 'FAILED',
        failure: kind === 'file' ? 'FILE_LIMIT' : 'QUEUE_LIMIT',
        droppedRecords: 1,
      });
      const download = await archive.snapshot();
      expect(JSON.parse(download.manifest).payload.completeThroughExport).toBe(false);
      download.stream?.destroy();
    }
  );

  it('marks serialization failure without throwing into gameplay', async () => {
    const { archive } = await fixture();
    expect(() =>
      archive.record('APPEND', {
        toJSON() {
          throw new Error('secret');
        },
      })
    ).not.toThrow();
    expect(archive.status()).toMatchObject({ state: 'FAILED', failure: 'CAPTURE_FAILED' });
  });

  it('reports a failed disk write and keeps gameplay capture usable', async () => {
    const { archive } = await fixture();
    // Close the owned test descriptor to force a deterministic EBADF without touching real disks.
    const handle = (archive as unknown as { file: import('node:fs/promises').FileHandle }).file;
    await handle.close();
    const store = new AiBattleTraceStore();
    store.open('m', [], archive);
    store.begin('m', identity('1'));
    store.append('m', '1', 'RESPONSE', { text: 'accepted' }, { status: 'ACCEPTED' });
    await archive.flush();
    expect(archive.status()).toMatchObject({ state: 'FAILED', failure: 'WRITE_FAILED' });
    expect(store.export('m')!.decisions[0].status).toBe('ACCEPTED');
  });

  it('exports a fixed prefix and preserves later events in the ongoing journal', async () => {
    const { archive } = await fixture();
    archive.record('BEGIN', { identity: identity('1') });
    const snapshot = await archive.snapshot();
    archive.record('APPEND', { decisionId: '1', stage: 'RESPONSE', payload: 'later' });
    let text = '';
    if (snapshot.stream) for await (const chunk of snapshot.stream) text += chunk;
    expect(Buffer.byteLength(text)).toBe(snapshot.bytes);
    expect(text).not.toContain('later');
    expect((await records(archive)).at(-1).payload.payload).toBe('later');
    await expect(
      LocalAiArchive.create(
        { directory: (await fixture()).dir, frontendOrigin: env.FRONTEND_URL },
        '../escape'
      )
    ).rejects.toThrow();
  });

  it('rejects repository paths and symlinks into the repository before writing', async () => {
    await expect(
      LocalAiArchive.create(
        { directory: process.cwd(), frontendOrigin: env.FRONTEND_URL },
        'blocked'
      )
    ).rejects.toThrow('仓库外');
    const { dir } = await fixture();
    const link = join(dir, 'repo-link');
    await symlink(process.cwd(), link);
    await expect(
      LocalAiArchive.create(
        { directory: join(link, 'archive-must-not-exist'), frontendOrigin: env.FRONTEND_URL },
        'blocked'
      )
    ).rejects.toThrow('仓库外');
  });
});
