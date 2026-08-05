#!/usr/bin/env node
/* global console, process */

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_REPOSITORY = 'catmeow123456/loveca-dev';
const DEFAULT_WORKFLOW = 'ci.yml';
const QUALITY_JOB_NAME = 'Quality Gates';
const FULL_SHA_PATTERN = /^[0-9a-f]{40}$/i;
const REPOSITORY_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

export function findLatestExactShaMainRun(runs, targetSha) {
  return [...runs]
    .filter((run) => run.headSha === targetSha && run.headBranch === 'main' && run.event === 'push')
    .sort((left, right) => {
      const createdAtOrder = String(right.createdAt ?? '').localeCompare(
        String(left.createdAt ?? '')
      );
      if (createdAtOrder !== 0) {
        return createdAtOrder;
      }
      return Number(right.databaseId ?? 0) - Number(left.databaseId ?? 0);
    })[0];
}

export function assertSuccessfulExactShaMainRun(run, targetSha) {
  if (!run) {
    throw new Error('no exact-SHA main push workflow run was found');
  }
  if (run.headSha !== targetSha || run.headBranch !== 'main' || run.event !== 'push') {
    throw new Error(
      `workflow run identity mismatch: sha=${run.headSha ?? 'unknown'} ` +
        `branch=${run.headBranch ?? 'unknown'} event=${run.event ?? 'unknown'}`
    );
  }
  if (run.status !== 'completed' || run.conclusion !== 'success') {
    throw new Error(
      `latest exact-SHA main workflow run is ${run.status}/${run.conclusion ?? 'unknown'}: ` +
        `id=${run.databaseId ?? 'unknown'} url=${run.url ?? 'unknown'}`
    );
  }
  return run;
}

export function assertSuccessfulQualityGateJob(jobs) {
  const qualityJobs = jobs.filter((job) => job.name === QUALITY_JOB_NAME);
  if (qualityJobs.length === 0) {
    throw new Error(`run does not contain the required "${QUALITY_JOB_NAME}" job`);
  }
  if (qualityJobs.length !== 1) {
    throw new Error(`run contains ${qualityJobs.length} "${QUALITY_JOB_NAME}" jobs`);
  }
  const [qualityJob] = qualityJobs;
  if (qualityJob.status !== 'completed' || qualityJob.conclusion !== 'success') {
    throw new Error(
      `"${QUALITY_JOB_NAME}" job is ${qualityJob.status}/${qualityJob.conclusion ?? 'unknown'}`
    );
  }
  return qualityJob;
}

export function buildRunListArgs({ repository, sha, workflow = DEFAULT_WORKFLOW }) {
  return [
    'run',
    'list',
    '--repo',
    repository,
    '--workflow',
    workflow,
    '--branch',
    'main',
    '--commit',
    sha,
    '--event',
    'push',
    '--limit',
    '20',
    '--json',
    'databaseId,headSha,headBranch,event,status,conclusion,url,workflowName,createdAt',
  ];
}

function parseArguments(argv) {
  const options = {
    repository:
      process.env.RELEASE_GITHUB_REPOSITORY ?? process.env.GITHUB_REPOSITORY ?? DEFAULT_REPOSITORY,
    workflow: DEFAULT_WORKFLOW,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--sha') {
      options.sha = argv[++index];
    } else if (argument === '--repo') {
      options.repository = argv[++index];
    } else if (argument === '--workflow') {
      options.workflow = argv[++index];
    } else {
      throw new Error(`unknown argument: ${argument}`);
    }
  }

  if (!options.sha || !FULL_SHA_PATTERN.test(options.sha)) {
    throw new Error('--sha must be the full 40-character release commit SHA');
  }
  if (!options.repository || !REPOSITORY_PATTERN.test(options.repository)) {
    throw new Error('--repo must use the OWNER/REPOSITORY form');
  }
  if (!options.workflow) {
    throw new Error('--workflow must not be empty');
  }

  return options;
}

function runGhJson(args) {
  const result = spawnSync('gh', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 30_000,
    maxBuffer: 1024 * 1024,
  });
  if (result.error) {
    throw new Error(`failed to run gh: ${result.error.message}`);
  }
  if (result.status !== 0) {
    const detail = result.stderr.trim() || result.stdout.trim() || `exit ${result.status}`;
    throw new Error(`gh ${args.slice(0, 2).join(' ')} failed: ${detail}`);
  }
  try {
    return JSON.parse(result.stdout);
  } catch {
    throw new Error('gh returned invalid JSON');
  }
}

function summarizeRuns(runs) {
  if (runs.length === 0) {
    return 'no matching main push workflow run was found';
  }
  return runs
    .map(
      (run) =>
        `id=${run.databaseId ?? 'unknown'} sha=${run.headSha ?? 'unknown'} ` +
        `branch=${run.headBranch ?? 'unknown'} status=${run.status ?? 'unknown'}/` +
        `${run.conclusion ?? 'unknown'} url=${run.url ?? 'unknown'}`
    )
    .join('; ');
}

export function checkReleaseCi(options) {
  const runs = runGhJson(buildRunListArgs(options));
  const run = findLatestExactShaMainRun(runs, options.sha);
  if (!run) {
    throw new Error(`no exact-SHA main workflow run was found: ${summarizeRuns(runs)}`);
  }
  assertSuccessfulExactShaMainRun(run, options.sha);

  const details = runGhJson([
    'run',
    'view',
    String(run.databaseId),
    '--repo',
    options.repository,
    '--json',
    'conclusion,databaseId,event,headBranch,headSha,jobs,status,url,workflowName',
  ]);
  assertSuccessfulExactShaMainRun(details, options.sha);
  if (details.databaseId !== run.databaseId) {
    throw new Error(
      `workflow run changed during verification: listed=${run.databaseId} viewed=${details.databaseId}`
    );
  }
  assertSuccessfulQualityGateJob(details.jobs ?? []);
  return details;
}

function main() {
  try {
    const options = parseArguments(process.argv.slice(2));
    const run = checkReleaseCi(options);
    console.log(`[release:ci] exact-SHA Quality Gates passed for ${options.sha}`);
    console.log(`[release:ci] run id: ${run.databaseId}`);
    console.log(`[release:ci] run url: ${run.url}`);
  } catch (error) {
    console.error(`[release:ci] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : undefined;
if (invokedPath === fileURLToPath(import.meta.url)) {
  main();
}
