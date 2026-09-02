import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { isStructurallyValidMp3 } from '../../src/server/services/mp3-validation';

describe('MP3 validation', () => {
  it('accepts the bundled matchmaking tracks', () => {
    for (const filename of ['event-2-theme.mp3', 'event-menu-theme.mp3', 'intro-theme.mp3']) {
      const file = readFileSync(new URL(`../../assets/music/${filename}`, import.meta.url));
      expect(isStructurallyValidMp3(file), filename).toBe(true);
    }
  });

  it('rejects marker-only and single-frame payloads', () => {
    expect(isStructurallyValidMp3(Buffer.from('ID3audio'))).toBe(false);

    const singleFrame = Buffer.alloc(417);
    Buffer.from([0xff, 0xfb, 0x90, 0x00]).copy(singleFrame);
    expect(isStructurallyValidMp3(singleFrame)).toBe(false);
  });
});
