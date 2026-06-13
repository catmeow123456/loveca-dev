#!/usr/bin/env node

import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { parse as parseYaml } from 'yaml';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = new Set(process.argv.slice(2));
const dryRun = args.has('--dry-run');
const force = args.has('--force');
const skipDownload = args.has('--skip-download');
const noCompress = args.has('--no-compress');

const deckDir = 'assets/decks';
const jpCardsPath = 'llocg_db/json/cards.json';
const cnCardsPath = 'llocg_db/json/cards_cn.json';
const outputDir = path.join(rootDir, 'assets/card');
const imagesOutputDir = path.join(rootDir, 'assets/images');

const imageSizes = {
  thumb: { width: 100, quality: 75 },
  medium: { width: 300, quality: 80 },
  large: { width: 600, quality: 85 },
};

const rawGithubBaseUrl = 'https://raw.githubusercontent.com/wlt233/llocg_db/main/';

const rarityFixes = {
  PR2: 'PR+',
  PRproteinbar: 'PR',
  'PRLoveLive!Days': 'PR',
};

function normalizeCardCode(cardCode) {
  let result = cardCode.replace(/＋/g, '+');
  const lastDash = result.lastIndexOf('-');
  if (lastDash > 0) {
    const rarity = result.substring(lastDash + 1);
    const fix = rarityFixes[rarity];
    if (fix) {
      result = result.substring(0, lastDash + 1) + fix;
    }
  }
  return result;
}

async function readJson(relativePath) {
  return JSON.parse(await readFile(path.join(rootDir, relativePath), 'utf8'));
}

function buildNormalizedIndex(cards) {
  const result = new Map();
  for (const [code, card] of Object.entries(cards)) {
    result.set(normalizeCardCode(code), card);
  }
  return result;
}

async function collectDeckCodes() {
  const deckFiles = (await readdir(path.join(rootDir, deckDir)))
    .filter((filename) => filename.endsWith('.yaml') || filename.endsWith('.yml'))
    .map((filename) => path.join(deckDir, filename))
    .sort();

  const codes = new Set();
  for (const deckFile of deckFiles) {
    const deck = parseYaml(await readFile(path.join(rootDir, deckFile), 'utf8'));
    for (const entry of deck.main_deck.members) codes.add(normalizeCardCode(entry.card_code));
    for (const entry of deck.main_deck.lives) codes.add(normalizeCardCode(entry.card_code));
    for (const entry of deck.energy_deck) codes.add(normalizeCardCode(entry.card_code));
  }
  return Array.from(codes).sort();
}

function basenameFromImagePath(imagePath) {
  if (!imagePath) return null;
  try {
    return path.posix.basename(new URL(imagePath).pathname);
  } catch {
    return path.posix.basename(imagePath);
  }
}

function pickImagePath(jpCard, cnCard) {
  return cnCard?._img || jpCard?._img || cnCard?.img || jpCard?.img || null;
}

function pickDownloadUrl(jpCard, cnCard) {
  const remoteUrl = jpCard?.img || cnCard?.img;
  if (remoteUrl?.startsWith('http://') || remoteUrl?.startsWith('https://')) {
    return remoteUrl;
  }

  const relativePath = jpCard?._img || cnCard?._img;
  if (relativePath) {
    return `${rawGithubBaseUrl}${relativePath}`;
  }

  return null;
}

async function exists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

async function downloadToFile(url, filePath) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText}`);
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  await writeFile(filePath, bytes);
  return bytes.length;
}

function webpFilename(filename) {
  return filename.replace(/\.[^.]+$/, '.webp');
}

async function compressToWebp(inputPath, filename) {
  const metadata = await sharp(inputPath).metadata();
  const shouldRotate = metadata.width && metadata.height && metadata.width > metadata.height;
  const outputFilename = webpFilename(filename);

  for (const [size, config] of Object.entries(imageSizes)) {
    const sizeOutputDir = path.join(imagesOutputDir, size);
    await mkdir(sizeOutputDir, { recursive: true });

    let pipeline = sharp(inputPath);
    if (shouldRotate) {
      pipeline = pipeline.rotate(90);
    }

    await pipeline
      .resize({ width: config.width, withoutEnlargement: true })
      .webp({ quality: config.quality })
      .toFile(path.join(sizeOutputDir, outputFilename));
  }

  return outputFilename;
}

async function main() {
  const jpCards = buildNormalizedIndex(await readJson(jpCardsPath));
  const cnCards = buildNormalizedIndex(await readJson(cnCardsPath));
  const deckCodes = await collectDeckCodes();

  const jobs = [];
  const missing = [];

  for (const cardCode of deckCodes) {
    const jpCard = jpCards.get(cardCode);
    const cnCard = cnCards.get(cardCode);
    const imagePath = pickImagePath(jpCard, cnCard);
    const filename = basenameFromImagePath(imagePath);
    const url = pickDownloadUrl(jpCard, cnCard);

    if (!jpCard || !filename || !url) {
      missing.push(cardCode);
      continue;
    }

    jobs.push({
      cardCode,
      filename,
      outputPath: path.join(outputDir, filename),
      webpFilename: webpFilename(filename),
      url,
    });
  }

  console.log(`Local test decks need ${deckCodes.length} unique card images.`);
  console.log(`Image jobs: ${jobs.length}`);
  if (missing.length > 0) {
    console.log(`Missing image metadata: ${missing.join(', ')}`);
  }

  if (dryRun) {
    for (const job of jobs) {
      console.log(
        `${job.cardCode} -> assets/card/${job.filename} -> assets/images/{thumb,medium,large}/${job.webpFilename}`
      );
    }
    return;
  }

  if (!skipDownload) {
    await mkdir(outputDir, { recursive: true });
  }

  let downloaded = 0;
  let skipped = 0;
  let failed = 0;

  for (const job of jobs) {
    if (skipDownload) {
      skipped++;
      continue;
    }

    if (!force && (await exists(job.outputPath))) {
      skipped++;
      console.log(`skip ${job.filename}`);
      continue;
    }

    try {
      const size = await downloadToFile(job.url, job.outputPath);
      downloaded++;
      console.log(`ok   ${job.filename} (${Math.round(size / 1024)} KiB)`);
    } catch (error) {
      failed++;
      console.log(
        `fail ${job.filename}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  let compressed = 0;
  let missingSource = 0;

  if (!noCompress) {
    for (const job of jobs) {
      if (!(await exists(job.outputPath))) {
        missingSource++;
        console.log(`miss ${job.filename}`);
        continue;
      }

      try {
        await compressToWebp(job.outputPath, job.filename);
        compressed++;
        console.log(`webp ${job.webpFilename}`);
      } catch (error) {
        failed++;
        console.log(
          `fail ${job.filename}: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
  }

  console.log(
    `Done. downloaded=${downloaded}, skipped=${skipped}, compressed=${compressed}, missingSource=${missingSource}, failed=${failed}`
  );
  if (failed > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
