import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { summarizeAiStrategyEvaluation } from '../../src/server/ai-battle/strategy-evaluation';
import {
  AI_BATTLE_PHASE_TWO_REGRESSION_ARTIFACT_SCHEMA_VERSION,
  persistAiBattlePhaseTwoRegressionArtifact,
} from '../helpers/ai-battle-phase-two';

const createdDirectories: string[] = [];

afterEach(() => {
  delete process.env.AI_BATTLE_PHASE_TWO_ARTIFACT_DIR;
  for (const directory of createdDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('AI battle Phase 2 restricted evaluation artifact', () => {
  it('persists the versioned audit summary without product or user fields', () => {
    const directory = mkdtempSync(join(tmpdir(), 'loveca-ai-phase-two-'));
    createdDirectories.push(directory);
    process.env.AI_BATTLE_PHASE_TWO_ARTIFACT_DIR = directory;

    persistAiBattlePhaseTwoRegressionArtifact({
      games: [],
      summary: summarizeAiStrategyEvaluation([]),
    });

    const artifact = JSON.parse(
      readFileSync(join(directory, 'phase-two-strategy-evaluation.json'), 'utf8')
    ) as Record<string, unknown>;
    expect(artifact.schemaVersion).toBe(AI_BATTLE_PHASE_TWO_REGRESSION_ARTIFACT_SCHEMA_VERSION);
    expect(artifact.summary).toMatchObject({
      schemaVersion: 'ai-battle.strategy-evaluation/v1',
      gameCount: 0,
    });
    expect(JSON.stringify(artifact)).not.toContain('matchId');
    expect(JSON.stringify(artifact)).not.toContain('playerName');
    expect(JSON.stringify(artifact)).not.toContain('authorityState');
    expect(JSON.stringify(artifact)).not.toContain('chat');
  });
});
