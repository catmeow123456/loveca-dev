import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

interface SeedEmoteManifestEntry {
  readonly id: string;
  readonly label: string;
  readonly shortLabel: string;
  readonly staticFilename: string;
  readonly staticHash: string;
  readonly animatedFilename: string | null;
  readonly animatedHash: string | null;
  readonly contentFingerprint: string;
  readonly width: number;
  readonly height: number;
  readonly frameCount: number;
  readonly durationMs: number;
  readonly staticBytes: number;
  readonly animatedBytes: number | null;
}

const SEED_DIR = join(process.cwd(), 'assets', 'emotes', 'seed');
const MIGRATION_PATH = join(process.cwd(), 'drizzle', '0025_add_match_emote_sticker_pack.sql');

const EXPECTED_STICKERS = [
  { id: 'ALL_IN_LIVE', label: '跟你爆了！', shortLabel: '跟你爆了' },
  { id: 'OH_NO', label: 'Oh no!', shortLabel: 'Oh no' },
  { id: 'WHERE_IS_MY_LIVE', label: '我 LIVE 呢', shortLabel: '我 LIVE 呢' },
] as const;

describe('match emote seed assets', () => {
  it('keeps the three sticker sources content-addressed and referenced by the catalog migration', async () => {
    const manifest = JSON.parse(
      await readFile(join(SEED_DIR, 'manifest.json'), 'utf8')
    ) as SeedEmoteManifestEntry[];
    const migration = await readFile(MIGRATION_PATH, 'utf8');

    expect(manifest).toHaveLength(9);
    expect(new Set(manifest.map((entry) => entry.id)).size).toBe(manifest.length);

    for (const expected of EXPECTED_STICKERS) {
      const entry = manifest.find((candidate) => candidate.id === expected.id);
      expect(entry).toMatchObject({
        ...expected,
        width: 192,
        height: 192,
        frameCount: 1,
        durationMs: 0,
        animatedFilename: null,
        animatedHash: null,
        animatedBytes: null,
      });

      const buffer = await readFile(join(SEED_DIR, entry!.staticFilename));
      const hash = createHash('sha256').update(buffer).digest('hex');
      const metadata = await sharp(buffer).metadata();

      expect(entry!.staticFilename).toBe(`${hash}.webp`);
      expect(entry!.staticHash).toBe(hash);
      expect(entry!.staticBytes).toBe(buffer.length);
      expect(entry!.contentFingerprint).toBe(
        `sha256:${createHash('sha256').update(`${hash}:`).digest('hex')}`
      );
      expect(metadata).toMatchObject({
        format: 'webp',
        width: 192,
        height: 192,
        hasAlpha: true,
      });

      expect(migration).toContain(`'${expected.id}'`);
      expect(migration).toContain(`'${expected.label}'`);
      expect(migration).toContain(`'emotes/${entry!.staticFilename}'`);
      expect(migration).toContain(`'${entry!.contentFingerprint}'`);
      expect(migration).toContain(`, ${entry!.staticBytes}, NULL)`);
    }
  });
});
