import { randomUUID } from 'node:crypto';
import { mkdir, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import process from 'node:process';

const options = readOptions(process.argv.slice(2));
const outputPath = resolve(
  options.path ??
    process.env.PUBLIC_SITE_STATUS_SNAPSHOT_PATH ??
    'runtime/site-status/site-status.json'
);
const availability = options.status?.toUpperCase();

if (availability !== 'OPEN' && availability !== 'MAINTENANCE') {
  fail('必须使用 --status=OPEN 或 --status=MAINTENANCE');
}
if (availability === 'MAINTENANCE' && (!options.title || !options.summary)) {
  fail('MAINTENANCE 快照必须同时提供 --title 和 --summary');
}

const now = new Date().toISOString();
const snapshot = {
  schemaVersion: 1,
  availability,
  generatedAt: now,
  maintenance:
    availability === 'MAINTENANCE'
      ? {
          id: options.id ?? 'offline-maintenance',
          title: options.title,
          summary: options.summary,
          detail: options.detail ?? null,
          startsAt: normalizeDate(options.startsAt),
          estimatedEndsAt: normalizeDate(options.estimatedEndsAt),
          restrictsNewGamesAt: null,
          impactScopes: splitList(options.impactScopes),
          restrictions: splitList(options.restrictions),
          action: options.action ?? null,
          updatedAt: now,
        }
      : null,
};

const temporaryPath = `${outputPath}.${randomUUID()}.tmp`;
try {
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(temporaryPath, `${JSON.stringify(snapshot, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o644,
    flag: 'wx',
  });
  await rename(temporaryPath, outputPath);
  process.stdout.write(
    `${JSON.stringify({ outputPath, availability, generatedAt: now }, null, 2)}\n`
  );
} catch (error) {
  await unlink(temporaryPath).catch(() => undefined);
  fail(error instanceof Error ? error.message : '快照写入失败');
}

function readOptions(args) {
  const result = {};
  for (const argument of args) {
    if (!argument.startsWith('--') || !argument.includes('=')) {
      fail(`无法识别参数：${argument}`);
    }
    const separator = argument.indexOf('=');
    const key = argument
      .slice(2, separator)
      .replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    const value = argument.slice(separator + 1).trim();
    if (!value) fail(`参数不能为空：${argument.slice(0, separator)}`);
    result[key] = value;
  }
  return result;
}

function normalizeDate(value) {
  if (!value) return null;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) fail(`日期格式非法：${value}`);
  return new Date(timestamp).toISOString();
}

function splitList(value) {
  return value
    ? value
        .split(/[、,]/u)
        .map((item) => item.trim())
        .filter(Boolean)
    : [];
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}
