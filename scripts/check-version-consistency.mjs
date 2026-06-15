#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const versionPattern = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

function readRootText(relativePath) {
  return readFileSync(path.join(rootDir, relativePath), 'utf8');
}

function readRootJson(relativePath) {
  return JSON.parse(readRootText(relativePath));
}

function getGitTagFromEnv() {
  if (process.env.GITHUB_REF_TYPE === 'tag' && process.env.GITHUB_REF_NAME) {
    return process.env.GITHUB_REF_NAME;
  }
  if (process.env.GITHUB_REF?.startsWith('refs/tags/')) {
    return process.env.GITHUB_REF.slice('refs/tags/'.length);
  }
  return undefined;
}

function getVersionTagsAtHead() {
  try {
    return execFileSync('git', ['tag', '--points-at', 'HEAD'], {
      cwd: rootDir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .split(/\r?\n/)
      .map((tag) => tag.trim())
      .filter((tag) => tag.startsWith('v'));
  } catch {
    return [];
  }
}

const version = readRootText('VERSION').trim();
const rootPackage = readRootJson('package.json');
const clientPackage = readRootJson('client/package.json');
const expectedTag = `v${version}`;
const errors = [];

if (!versionPattern.test(version)) {
  errors.push(`VERSION must be a semantic version, got: ${version}`);
}

if (rootPackage.version !== version) {
  errors.push(`package.json version ${rootPackage.version} does not match VERSION ${version}`);
}

if (clientPackage.version !== version) {
  errors.push(`client/package.json version ${clientPackage.version} does not match VERSION ${version}`);
}

const envTag = getGitTagFromEnv();
const tagsToCheck = envTag ? [envTag] : getVersionTagsAtHead();
const mismatchedTags = tagsToCheck.filter((tag) => tag !== expectedTag);

if (mismatchedTags.length > 0) {
  errors.push(`release tag must be ${expectedTag}, got: ${mismatchedTags.join(', ')}`);
}

if (errors.length > 0) {
  for (const error of errors) {
    console.error(`[version:check] ${error}`);
  }
  process.exit(1);
}

console.log(`[version:check] version ${version} is consistent`);
