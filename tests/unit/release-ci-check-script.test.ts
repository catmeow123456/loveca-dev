import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import * as releaseCiModule from '../../scripts/check-release-ci.mjs';

interface WorkflowRun {
  readonly databaseId?: number;
  readonly headSha?: string;
  readonly headBranch?: string;
  readonly event?: string;
  readonly status?: string;
  readonly conclusion?: string | null;
  readonly createdAt?: string;
  readonly url?: string;
}

interface QualityJob {
  readonly name?: string;
  readonly status?: string;
  readonly conclusion?: string | null;
}

interface ReleaseCiModule {
  readonly findLatestExactShaMainRun: (
    runs: readonly WorkflowRun[],
    targetSha: string
  ) => WorkflowRun | undefined;
  readonly assertSuccessfulExactShaMainRun: (
    run: WorkflowRun | undefined,
    targetSha: string
  ) => WorkflowRun;
  readonly assertSuccessfulQualityGateJob: (jobs: readonly QualityJob[]) => QualityJob;
  readonly buildRunListArgs: (options: {
    readonly repository: string;
    readonly sha: string;
    readonly workflow?: string;
  }) => string[];
}

const {
  assertSuccessfulExactShaMainRun,
  assertSuccessfulQualityGateJob,
  buildRunListArgs,
  findLatestExactShaMainRun,
} = releaseCiModule as unknown as ReleaseCiModule;

const releaseSha = 'd4839e8ff91d018f4b7a11ad31a8ad6282ea3bff';
const parentSha = 'b0697b7830c738ad7e908e5f1642bf96589d8717';
const ciWorkflow = readFileSync('.github/workflows/ci.yml', 'utf8');
const tagIntegrityWorkflow = readFileSync('.github/workflows/release-tag-integrity.yml', 'utf8');

describe('release exact-SHA CI check', () => {
  it('does not accept a successful parent commit run for the release commit', () => {
    const runs = [
      {
        databaseId: 1,
        headSha: parentSha,
        headBranch: 'main',
        event: 'push',
        status: 'completed',
        conclusion: 'success',
        createdAt: '2026-08-02T05:00:00Z',
      },
    ];

    expect(findLatestExactShaMainRun(runs, releaseSha)).toBeUndefined();
  });

  it('selects the latest main push for the exact release SHA', () => {
    const expected = {
      databaseId: 4,
      headSha: releaseSha,
      headBranch: 'main',
      event: 'push',
      status: 'completed',
      conclusion: 'success',
      createdAt: '2026-08-02T07:00:00Z',
    };
    const runs = [
      { ...expected, databaseId: 1, headBranch: 'v3.9.2' },
      { ...expected, databaseId: 2, event: 'pull_request' },
      {
        ...expected,
        databaseId: 3,
        status: 'in_progress',
        conclusion: null,
        createdAt: '2026-08-02T06:00:00Z',
      },
      expected,
    ];

    expect(findLatestExactShaMainRun(runs, releaseSha)).toBe(expected);
  });

  it('does not fall back to an older success when the latest matching run failed', () => {
    const latestFailure = {
      databaseId: 2,
      headSha: releaseSha,
      headBranch: 'main',
      event: 'push',
      status: 'completed',
      conclusion: 'failure',
      createdAt: '2026-08-02T08:00:00Z',
    };
    const olderSuccess = {
      ...latestFailure,
      databaseId: 1,
      conclusion: 'success',
      createdAt: '2026-08-02T07:00:00Z',
    };

    expect(findLatestExactShaMainRun([olderSuccess, latestFailure], releaseSha)).toBe(
      latestFailure
    );
    expect(() => assertSuccessfulExactShaMainRun(latestFailure, releaseSha)).toThrow(
      'completed/failure'
    );
  });

  it('rejects a tag, PR, pending, or different-SHA run during the final identity check', () => {
    const success = {
      databaseId: 4,
      headSha: releaseSha,
      headBranch: 'main',
      event: 'push',
      status: 'completed',
      conclusion: 'success',
      url: 'https://github.com/example/actions/runs/4',
    };

    expect(assertSuccessfulExactShaMainRun(success, releaseSha)).toBe(success);
    expect(() =>
      assertSuccessfulExactShaMainRun({ ...success, headBranch: 'v3.9.2' }, releaseSha)
    ).toThrow('identity mismatch');
    expect(() =>
      assertSuccessfulExactShaMainRun({ ...success, event: 'pull_request' }, releaseSha)
    ).toThrow('identity mismatch');
    expect(() =>
      assertSuccessfulExactShaMainRun(
        { ...success, status: 'in_progress', conclusion: null },
        releaseSha
      )
    ).toThrow('in_progress/unknown');
    expect(() => assertSuccessfulExactShaMainRun(success, parentSha)).toThrow('identity mismatch');
  });

  it('requires the named Quality Gates job itself to have succeeded', () => {
    expect(
      assertSuccessfulQualityGateJob([
        { name: 'Quality Gates', status: 'completed', conclusion: 'success' },
      ])
    ).toEqual({ name: 'Quality Gates', status: 'completed', conclusion: 'success' });

    expect(() =>
      assertSuccessfulQualityGateJob([
        { name: 'Tag Integrity', status: 'completed', conclusion: 'success' },
      ])
    ).toThrow('does not contain');
    expect(() =>
      assertSuccessfulQualityGateJob([
        { name: 'Quality Gates', status: 'completed', conclusion: 'failure' },
      ])
    ).toThrow('completed/failure');
    expect(() =>
      assertSuccessfulQualityGateJob([
        { name: 'Quality Gates', status: 'completed', conclusion: 'success' },
        { name: 'Quality Gates', status: 'completed', conclusion: 'success' },
      ])
    ).toThrow('contains 2');
  });

  it('asks gh for a main push run filtered to the exact commit', () => {
    expect(
      buildRunListArgs({
        repository: 'catmeow123456/loveca-dev',
        sha: releaseSha,
      })
    ).toEqual(
      expect.arrayContaining([
        '--repo',
        'catmeow123456/loveca-dev',
        '--branch',
        'main',
        '--commit',
        releaseSha,
        '--event',
        'push',
      ])
    );
  });

  it('keeps full Quality Gates on PR/main and out of tag pushes', () => {
    expect(ciWorkflow).toContain('pull_request:');
    expect(ciWorkflow).toContain('- main');
    expect(ciWorkflow).not.toContain('tags:');
    expect(ciWorkflow).toContain('name: Quality Gates');
  });

  it('keeps the tag workflow lightweight and reuses the exact-SHA CI check', () => {
    expect(tagIntegrityWorkflow).toContain("- 'v*'");
    expect(tagIntegrityWorkflow).toContain('submodules: false');
    expect(tagIntegrityWorkflow).toContain('scripts/check-version-consistency.mjs');
    expect(tagIntegrityWorkflow).toContain('scripts/check-release-ci.mjs');
    expect(tagIntegrityWorkflow).not.toContain('pnpm install');
    expect(tagIntegrityWorkflow).not.toContain('test:run');
    expect(tagIntegrityWorkflow).not.toContain('build:server');
    expect(tagIntegrityWorkflow).not.toContain('Build client');
  });
});
