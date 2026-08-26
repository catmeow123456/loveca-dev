#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const distArgument = process.argv.find((argument) => argument.startsWith('--dist='));
const distDir = distArgument
  ? path.resolve(rootDir, distArgument.slice('--dist='.length))
  : path.join(rootDir, 'client/dist');
const jsonOnly = process.argv.includes('--json');
const referenceInitialJsGzipBytes = 895_981;
const initialJsGzipTargetBytes = Math.floor(referenceInitialJsGzipBytes * 0.6);

function fail(message) {
  console.error(`[frontend-baseline] ${message}`);
  process.exit(1);
}

function run(command, args) {
  try {
    return execFileSync(command, args, {
      cwd: rootDir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null;
  }
}

function walkFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolutePath = path.join(directory, entry.name);
    return entry.isDirectory() ? walkFiles(absolutePath) : [absolutePath];
  });
}

function toRelative(absolutePath) {
  return path.relative(distDir, absolutePath).split(path.sep).join('/');
}

function measureAsset(relativePath) {
  const absolutePath = path.join(distDir, relativePath);
  const contents = readFileSync(absolutePath);
  return {
    file: relativePath,
    bytes: contents.byteLength,
    gzipBytes: gzipSync(contents, { level: 9 }).byteLength,
  };
}

function sum(metrics, field) {
  return metrics.reduce((total, metric) => total + metric[field], 0);
}

function formatKiB(bytes) {
  return `${(bytes / 1024).toFixed(2)} KiB`;
}

if (!existsSync(distDir)) {
  fail(`missing ${path.relative(rootDir, distDir)}; run pnpm --dir client build first`);
}

const indexPath = path.join(distDir, 'index.html');
const serviceWorkerPath = path.join(distDir, 'sw.js');
if (!existsSync(indexPath) || !existsSync(serviceWorkerPath)) {
  fail('client dist must contain index.html and sw.js');
}

const indexHtml = readFileSync(indexPath, 'utf8');
const entryMatch = indexHtml.match(/<script\b[^>]*\bsrc=["']\/([^"']+\.js)["']/i);
if (!entryMatch) fail('could not resolve the initial module script from index.html');
const entryScript = entryMatch[1];

const initialStyleMatches = [...indexHtml.matchAll(/<link\b[^>]*\bhref=["']\/([^"']+\.css)["']/gi)];
const initialStyles = initialStyleMatches.map((match) => measureAsset(match[1]));
const initialJavaScript = measureAsset(entryScript);

const assetFiles = walkFiles(path.join(distDir, 'assets'));
const javascriptAssets = assetFiles
  .filter((file) => file.endsWith('.js'))
  .map((file) => measureAsset(toRelative(file)))
  .sort((left, right) => right.bytes - left.bytes);
const routeChunks = javascriptAssets.filter((asset) =>
  /\/(?:[A-Za-z]+Page|GameBoard|DeckManager|CardEditor)-[^/]+\.js$/.test(asset.file)
);

const serviceWorker = readFileSync(serviceWorkerPath, 'utf8');
const precacheMatch = serviceWorker.match(
  /workbox\.precacheAndRoute\((\[[\s\S]*?\])\s*,\s*\{\}\);/
);
if (!precacheMatch) fail('could not resolve the Workbox precache manifest from sw.js');

const precacheManifest = JSON.parse(precacheMatch[1]);
const precacheAssets = precacheManifest.map((entry) => {
  const relativePath = decodeURIComponent(String(entry.url).split('?')[0]);
  const absolutePath = path.join(distDir, relativePath);
  if (!existsSync(absolutePath)) {
    fail(`precache entry is missing from dist: ${relativePath}`);
  }
  return {
    file: relativePath,
    bytes: statSync(absolutePath).size,
  };
});

const gitStatus = run('git', ['status', '--porcelain']);
const report = {
  schemaVersion: 1,
  baseline: {
    gitCommit: run('git', ['rev-parse', 'HEAD']),
    gitDirty: Boolean(gitStatus),
    nodeVersion: process.version,
    pnpmVersion: run('pnpm', ['--version']),
    platform: `${process.platform}-${process.arch}`,
    distDirectory: path.relative(rootDir, distDir).split(path.sep).join('/'),
  },
  initial: {
    javascript: initialJavaScript,
    styles: initialStyles,
    totalStyleBytes: sum(initialStyles, 'bytes'),
    totalStyleGzipBytes: sum(initialStyles, 'gzipBytes'),
    referenceJavaScriptGzipBytes: referenceInitialJsGzipBytes,
    targetReductionRatio: 0.4,
    targetJavaScriptGzipBytes: initialJsGzipTargetBytes,
    meetsTarget: initialJavaScript.gzipBytes <= initialJsGzipTargetBytes,
  },
  chunks: {
    javascriptCount: javascriptAssets.length,
    totalJavaScriptBytes: sum(javascriptAssets, 'bytes'),
    totalJavaScriptGzipBytes: sum(javascriptAssets, 'gzipBytes'),
    largestJavaScript: javascriptAssets.slice(0, 15),
    routeChunks,
  },
  pwa: {
    precacheEntryCount: precacheAssets.length,
    precacheBytes: sum(precacheAssets, 'bytes'),
  },
};

if (jsonOnly) {
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.exit(0);
}

console.log(
  `[frontend-baseline] commit ${report.baseline.gitCommit?.slice(0, 12) ?? 'unknown'}${
    report.baseline.gitDirty ? ' (dirty)' : ''
  }`
);
console.log(
  `[frontend-baseline] initial JS ${formatKiB(initialJavaScript.bytes)} / ${formatKiB(
    initialJavaScript.gzipBytes
  )} gzip (target <= ${formatKiB(initialJsGzipTargetBytes)})`
);
console.log(
  `[frontend-baseline] initial CSS ${formatKiB(report.initial.totalStyleBytes)} / ${formatKiB(
    report.initial.totalStyleGzipBytes
  )} gzip`
);
console.log(
  `[frontend-baseline] all JS ${javascriptAssets.length} files, ${formatKiB(
    report.chunks.totalJavaScriptBytes
  )} / ${formatKiB(report.chunks.totalJavaScriptGzipBytes)} gzip`
);
console.log(
  `[frontend-baseline] PWA precache ${report.pwa.precacheEntryCount} entries, ${formatKiB(
    report.pwa.precacheBytes
  )}`
);
console.log('[frontend-baseline] largest JS chunks:');
for (const asset of report.chunks.largestJavaScript.slice(0, 8)) {
  console.log(`  ${asset.file}: ${formatKiB(asset.bytes)} / ${formatKiB(asset.gzipBytes)} gzip`);
}
