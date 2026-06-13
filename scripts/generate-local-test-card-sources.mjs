#!/usr/bin/env node

import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const deckDir = 'assets/decks';
const jpCardsPath = 'llocg_db/json/cards.json';
const cnCardsPath = 'llocg_db/json/cards_cn.json';
const outputPath = 'client/src/lib/localTestCardSources.generated.ts';

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

function pickCardsByCode(codes, cards, sourceName) {
  const result = {};
  const missing = [];

  for (const code of codes) {
    const card = cards.get(code);
    if (!card) {
      missing.push(code);
      continue;
    }
    result[code] = card;
  }

  if (missing.length > 0) {
    throw new Error(`${sourceName} missing local test card data: ${missing.join(', ')}`);
  }

  return result;
}

function toGeneratedSource(jpCards, cnCards) {
  return `// Generated from llocg_db/json for the built-in local test decks.
// Keep this small so the local player test entry does not bundle the full card database.
// Regenerate with: node scripts/generate-local-test-card-sources.mjs

export const localTestJpCards = ${JSON.stringify(jpCards, null, 2)} as const;

export const localTestCnCards = ${JSON.stringify(cnCards, null, 2)} as const;
`;
}

async function main() {
  const codes = await collectDeckCodes();
  const jpCards = pickCardsByCode(
    codes,
    buildNormalizedIndex(await readJson(jpCardsPath)),
    jpCardsPath
  );
  const cnCards = pickCardsByCode(
    codes,
    buildNormalizedIndex(await readJson(cnCardsPath)),
    cnCardsPath
  );

  await writeFile(path.join(rootDir, outputPath), toGeneratedSource(jpCards, cnCards));
  console.log(`Generated ${outputPath} for ${codes.length} local test cards.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
