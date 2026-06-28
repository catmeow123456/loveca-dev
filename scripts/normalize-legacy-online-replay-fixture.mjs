#!/usr/bin/env node
// One-off migration helper for the 2026-06-27 legacy online replay fixture.
//
// New production exports should not need this script. They should already use a valid
// PostgreSQL COPY terminator (`\.`) and contain checkpoints recorded by current rules.
// Use REAL_DATA_ONLINE_FIXTURE=path/to/new.sql.gz with `pnpm test:real-data:online:strict`
// for newly exported data.
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { createInterface } from 'node:readline';
import { createGunzip, createGzip } from 'node:zlib';

const DEFAULT_INPUT =
  'data/20260627-cst_20260627T183253Z/loveca-match-replay-2026-06-27-cst-online-only.sql.gz';
const DEFAULT_OUTPUT =
  'data/20260627-cst_20260627T183253Z/loveca-match-replay-2026-06-27-cst-online-only.normalized.sql.gz';

const inputPath = process.argv[2] ?? process.env.REPLAY_FIXTURE_INPUT ?? DEFAULT_INPUT;
const outputPath = process.argv[3] ?? process.env.REPLAY_FIXTURE_OUTPUT ?? DEFAULT_OUTPUT;

const stats = {
  inputPath,
  outputPath,
  fixedCopyTerminators: 0,
  checkpointRows: 0,
  normalizedCheckpointRows: 0,
  removedStageCardStates: 0,
};

await mkdir(dirname(outputPath), { recursive: true });

const input = createReadStream(inputPath).pipe(createGunzip());
const output = createWriteStream(outputPath).on('error', (error) => {
  throw error;
});
const gzip = createGzip();
gzip.pipe(output);

let currentCopy = null;
const lines = createInterface({ input, crlfDelay: Infinity });

for await (const line of lines) {
  const copyHeader = parseCopyHeader(line);
  if (copyHeader) {
    currentCopy = copyHeader;
    await writeLine(gzip, line);
    continue;
  }

  if (currentCopy && isCopyTerminator(line)) {
    if (line === '\\\\.') {
      stats.fixedCopyTerminators += 1;
    }
    currentCopy = null;
    await writeLine(gzip, '\\.');
    continue;
  }

  if (currentCopy?.table === 'match_checkpoints') {
    await writeLine(gzip, normalizeCheckpointCopyLine(currentCopy.columns, line));
    continue;
  }

  await writeLine(gzip, line);
}

gzip.end();
await once(output, 'finish');

console.log(JSON.stringify(stats, null, 2));

function parseCopyHeader(line) {
  const match = line.match(/^COPY (?:public|pg_temp)\.([a-z_]+) \((.*)\) FROM stdin;$/);
  if (!match) {
    return null;
  }

  return {
    table: match[1],
    columns: match[2].split(', '),
  };
}

function isCopyTerminator(line) {
  return line === '\\.' || line === '\\\\.';
}

function normalizeCheckpointCopyLine(columns, line) {
  stats.checkpointRows += 1;
  const fields = splitPostgresCopyTextRow(line);
  if (fields.length !== columns.length) {
    throw new Error(
      `match_checkpoints COPY row column mismatch: expected ${columns.length}, got ${fields.length}`
    );
  }

  const row = Object.fromEntries(columns.map((column, index) => [column, fields[index]]));
  const envelope = JSON.parse(readRequired(row, 'payload'));
  const removed = removeDetachedMemberSlotCardStates(envelope.payload);
  if (removed > 0) {
    stats.normalizedCheckpointRows += 1;
    stats.removedStageCardStates += removed;
    rewriteEnvelopePayloadIntegrity(envelope);
    row.payload = JSON.stringify(envelope);
    row.payload_hash = envelope.payloadHash;
  }

  return columns.map((column) => escapePostgresCopyText(row[column])).join('\t');
}

function splitPostgresCopyTextRow(line) {
  return line
    .split('\t')
    .map((field) => (field === '\\N' ? null : unescapePostgresCopyText(field)));
}

function unescapePostgresCopyText(field) {
  let result = '';
  for (let index = 0; index < field.length; index += 1) {
    const char = field[index];
    if (char !== '\\') {
      result += char;
      continue;
    }

    index += 1;
    if (index >= field.length) {
      result += '\\';
      break;
    }

    const escaped = field[index];
    switch (escaped) {
      case 'b':
        result += '\b';
        break;
      case 'f':
        result += '\f';
        break;
      case 'n':
        result += '\n';
        break;
      case 'r':
        result += '\r';
        break;
      case 't':
        result += '\t';
        break;
      case 'v':
        result += '\v';
        break;
      case '\\':
        result += '\\';
        break;
      default:
        result += escaped;
        break;
    }
  }
  return result;
}

function escapePostgresCopyText(value) {
  if (value === null || value === undefined) {
    return '\\N';
  }

  return String(value).replace(/[\\\b\f\n\r\t\v]/g, (char) => {
    switch (char) {
      case '\\':
        return '\\\\';
      case '\b':
        return '\\b';
      case '\f':
        return '\\f';
      case '\n':
        return '\\n';
      case '\r':
        return '\\r';
      case '\t':
        return '\\t';
      case '\v':
        return '\\v';
      default:
        return char;
    }
  });
}

function readRequired(row, column) {
  const value = row[column];
  if (value === null || value === undefined) {
    throw new Error(`Missing required COPY column ${column}`);
  }
  return value;
}

function removeDetachedMemberSlotCardStates(authorityPayload) {
  let removed = 0;
  for (const player of authorityPayload?.players ?? []) {
    const memberSlots = player?.memberSlots;
    const slots = memberSlots?.slots;
    const cardStates = memberSlots?.cardStates;
    if (!slots || !isTransportMap(cardStates)) {
      continue;
    }

    const slottedCardIds = new Set(
      Object.values(slots).filter((cardId) => typeof cardId === 'string')
    );
    const beforeCount = cardStates.entries.length;
    cardStates.entries = cardStates.entries.filter((entry) => slottedCardIds.has(entry?.[0]));
    removed += beforeCount - cardStates.entries.length;
  }
  return removed;
}

function isTransportMap(value) {
  return value?.__transportType === 'Map' && Array.isArray(value.entries);
}

function rewriteEnvelopePayloadIntegrity(envelope) {
  const stablePayloadJson = stableJsonStringify(envelope.payload);
  const byteLength = Buffer.byteLength(stablePayloadJson, 'utf8');
  envelope.payloadHash = `sha256:${createHash('sha256').update(stablePayloadJson).digest('hex')}`;
  envelope.uncompressedByteLength = byteLength;
  envelope.compressedByteLength = byteLength;
}

function stableJsonStringify(value) {
  return JSON.stringify(toStableJsonValue(value)) ?? 'null';
}

function toStableJsonValue(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => toStableJsonValue(entry) ?? null);
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .flatMap((key) => {
          const normalizedValue = toStableJsonValue(value[key]);
          return normalizedValue === undefined ? [] : [[key, normalizedValue]];
        })
    );
  }

  if (typeof value === 'bigint') {
    return value.toString();
  }

  if (typeof value === 'function' || typeof value === 'symbol' || value === undefined) {
    return undefined;
  }

  return value;
}

async function writeLine(stream, line) {
  if (!stream.write(`${line}\n`)) {
    await once(stream, 'drain');
  }
}
