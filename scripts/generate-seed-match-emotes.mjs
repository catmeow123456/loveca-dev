import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { stdout } from 'node:process';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = join(SCRIPT_DIR, '..', 'assets', 'emotes', 'seed');
const SOURCE_DIR = join(SCRIPT_DIR, '..', 'assets', 'emotes', 'candidates');
const SIZE = 192;

const EMOTES = [
  { id: 'DEEP_THINKING', label: '深度思考中…', shortLabel: '思考中' },
  { id: 'THANK_YOU', label: '谢谢！', shortLabel: '谢谢' },
  { id: 'NICE_TO_MEET_YOU', label: '请多指教！', shortLabel: '请多指教' },
  { id: 'NICE_PLAY', label: '漂亮！', shortLabel: '漂亮' },
  { id: 'GOOD_GAME', label: '好局！', shortLabel: '好局' },
  {
    id: 'SORRY_TO_KEEP_YOU_WAITING',
    label: '抱歉，久等了',
    shortLabel: '久等了',
  },
  {
    id: 'ALL_IN_LIVE',
    label: '跟你爆了！',
    shortLabel: '跟你爆了',
    sourceFilename: 'all-in.png',
  },
  {
    id: 'OH_NO',
    label: 'Oh no!',
    shortLabel: 'Oh no',
    sourceFilename: 'oh-no.png',
  },
  {
    id: 'WHERE_IS_MY_LIVE',
    label: '我 LIVE 呢',
    shortLabel: '我 LIVE 呢',
    sourceFilename: 'where-is-my-live.png',
  },
];

await mkdir(OUTPUT_DIR, { recursive: true });
await removePreviousGeneratedAssets();

const manifest = [];
for (const { id, label, shortLabel, sourceFilename } of EMOTES) {
  let animatedBuffer = null;
  let animatedFilename = null;
  let animatedHash = null;
  let frameCount = 1;
  let durationMs = 0;
  let animatedBytes = null;

  if (id === 'DEEP_THINKING') {
    const frameBuffers = await Promise.all(
      Array.from({ length: 12 }, (_, frame) =>
        sharp(Buffer.from(renderSvg(id, frame)))
          .png()
          .toBuffer()
      )
    );
    const delays = frameBuffers.map(() => 105);
    animatedBuffer = await sharp(frameBuffers, { join: { animated: true } })
      .webp({ quality: 84, alphaQuality: 100, loop: 0, delay: delays, effort: 5 })
      .toBuffer();
    const animatedMetadata = await sharp(animatedBuffer, { animated: true }).metadata();
    animatedHash = sha256(animatedBuffer);
    animatedFilename = `${animatedHash}.webp`;
    animatedBytes = animatedBuffer.length;
    frameCount = animatedMetadata.pages ?? frameBuffers.length;
    durationMs =
      animatedMetadata.delay?.reduce((sum, delay) => sum + delay, 0) ??
      delays.reduce((sum, delay) => sum + delay, 0);
    await writeFile(join(OUTPUT_DIR, animatedFilename), animatedBuffer);
  }

  const staticBuffer = sourceFilename
    ? await sharp(await readFile(join(SOURCE_DIR, sourceFilename)), { page: 0 })
        .resize(SIZE, SIZE, { fit: 'contain' })
        .webp({ quality: 88, alphaQuality: 100 })
        .toBuffer()
    : await sharp(animatedBuffer ?? Buffer.from(renderSvg(id, null)), { page: 0 })
        .webp({ quality: 88, alphaQuality: 100 })
        .toBuffer();
  const staticHash = sha256(staticBuffer);
  const staticFilename = `${staticHash}.webp`;
  await writeFile(join(OUTPUT_DIR, staticFilename), staticBuffer);
  const contentFingerprint = `sha256:${sha256(Buffer.from(`${staticHash}:${animatedHash ?? ''}`))}`;

  manifest.push({
    id,
    label,
    shortLabel,
    staticFilename,
    staticHash,
    animatedFilename,
    animatedHash,
    contentFingerprint,
    width: SIZE,
    height: SIZE,
    frameCount,
    durationMs,
    staticBytes: staticBuffer.length,
    animatedBytes,
  });
}

await writeFile(join(OUTPUT_DIR, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
stdout.write(`Generated ${manifest.length} seed emotes in ${OUTPUT_DIR}\n`);

async function removePreviousGeneratedAssets() {
  try {
    const previous = JSON.parse(await readFile(join(OUTPUT_DIR, 'manifest.json'), 'utf8'));
    const filenames = new Set(
      previous.flatMap((entry) => [entry.staticFilename, entry.animatedFilename]).filter(Boolean)
    );
    await Promise.all(
      [...filenames].map((filename) =>
        unlink(join(OUTPUT_DIR, filename)).catch((error) => {
          if (error?.code !== 'ENOENT') throw error;
        })
      )
    );
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
}

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function renderSvg(id, thinkingFrame) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96" width="${SIZE}" height="${SIZE}">
  <defs>
    <linearGradient id="card" x1="18" y1="14" x2="78" y2="82" gradientUnits="userSpaceOnUse">
      <stop stop-color="#7c5cff"/><stop offset="1" stop-color="#ff4da6"/>
    </linearGradient>
    <filter id="shadow" x="-25%" y="-20%" width="150%" height="160%">
      <feDropShadow dx="0" dy="3" stdDeviation="3" flood-color="#7c5cff" flood-opacity=".2"/>
    </filter>
  </defs>
  <g filter="url(#shadow)">
    <rect x="19" y="12" width="58" height="72" rx="11" fill="#171329" stroke="url(#card)" stroke-width="4"/>
    <rect x="25" y="18" width="46" height="60" rx="7" fill="#241b43" stroke="#9c5799" stroke-width="1.5"/>
    ${renderMark(id, thinkingFrame)}
  </g>
</svg>`;
}

function renderMark(id, thinkingFrame) {
  switch (id) {
    case 'DEEP_THINKING': {
      const dots = [0, 1, 2]
        .map((index) => {
          const phase =
            thinkingFrame === null ? 0.55 : ((thinkingFrame - index * 2 + 12) % 12) / 12;
          const active = phase >= 0.25 && phase <= 0.62;
          return `<circle cx="${39 + index * 9}" cy="${active ? 45.5 : 47}" r="3.2" fill="#ff4da6" opacity="${active ? 1 : 0.34}"/>`;
        })
        .join('');
      return `<path d="M35 33h26a8 8 0 0 1 8 8v11a8 8 0 0 1-8 8H49l-8 7 1.5-7H35a8 8 0 0 1-8-8V41a8 8 0 0 1 8-8Z" fill="#2d2250" stroke="#7c5cff" stroke-width="2.5" stroke-linejoin="round"/>${dots}`;
    }
    case 'THANK_YOU':
      return `<g fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M34 59c7 6 21 6 28 0" stroke="#7c5cff" stroke-width="3"/><path d="M36 44c2.5-4 6.5-4 9 0M51 44c2.5-4 6.5-4 9 0" stroke="#f7f5ff" stroke-width="3"/><path d="m48 27 3.2 6.5 7.1 1-5.1 5 1.2 7-6.4-3.3-6.4 3.3 1.2-7-5.1-5 7.1-1Z" fill="#ff4da6" stroke="#ff4da6" stroke-width="1.5"/></g>`;
    case 'NICE_TO_MEET_YOU':
      return `<g fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M31 53c5-9 10-13 17-13s12 4 17 13" stroke="#7c5cff" stroke-width="4"/><path d="M31 53c5 5 11 8 17 8s12-3 17-8" stroke="#ff4da6" stroke-width="4"/><path d="M34 34 29 29m33 5 5-5M48 31v-7" stroke="#f7f5ff" stroke-width="3"/></g>`;
    case 'NICE_PLAY':
      return `<path d="m48 27 5.6 11.4 12.6 1.8-9.1 8.9 2.1 12.5L48 55.7l-11.2 5.9 2.1-12.5-9.1-8.9 12.6-1.8Z" fill="#f5b83d" stroke="#7c5cff" stroke-width="2.5" stroke-linejoin="round"/><path d="m42 46 4 4 8-9" fill="none" stroke="#171329" stroke-linecap="round" stroke-width="3.5"/>`;
    case 'GOOD_GAME':
      return `<g fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M37 32h22v11c0 9-4.5 15-11 15s-11-6-11-15Z" fill="#4b3d32" stroke="#f5b83d" stroke-width="3"/><path d="M37 36h-7v5c0 6 4 9 9 9m20-14h7v5c0 6-4 9-9 9M48 58v7m-9 4h18" stroke="#7c5cff" stroke-width="3"/></g>`;
    case 'SORRY_TO_KEEP_YOU_WAITING':
      return `<g fill="none" stroke-linecap="round" stroke-linejoin="round"><circle cx="48" cy="47" r="17" fill="#2d2250" stroke="#7c5cff" stroke-width="3"/><path d="M48 37v11l8 5M39 66h18" stroke="#f7f5ff" stroke-width="3"/><path d="M32 31 27 26m37 5 5-5" stroke="#ff4da6" stroke-width="3"/></g>`;
    default:
      throw new Error(`Unknown seed emote: ${id}`);
  }
}
