import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { AI_BATTLE_PHASE_ZERO_ABILITY_EVIDENCE } from '../../src/server/ai-battle/phase-zero-ability-evidence';
import {
  AI_BATTLE_PHASE_ONE_A_ABILITY_EVIDENCE_SHA256,
  AI_BATTLE_PHASE_ONE_A_SUPPORTED_OUTSIDE_CERTIFIED_REACHABILITY,
  AI_BATTLE_PHASE_ONE_A_WINDOW_EVIDENCE,
  AI_BATTLE_PHASE_ONE_A_WINDOW_MATRIX_VERSION,
  type AiBattlePhaseOneAWindowSurface,
} from '../../src/server/ai-battle/phase-one-a-window-evidence';

const EXPECTED_CERTIFIED_SURFACES = [
  'MULLIGAN',
  'MAIN_PHASE',
  'LIVE_SET',
  'ACTIVE_EFFECT_CONFIRM',
  'ACTIVE_EFFECT_CARD_SINGLE',
  'ACTIVE_EFFECT_CARD_ORDERED',
  'ACTIVE_EFFECT_CARD_GROUPED',
  'ACTIVE_EFFECT_OPTION',
  'ACTIVE_EFFECT_ABILITY_ORDER',
  'ACTIVE_EFFECT_DEADLINE',
  'JUDGMENT_CONFIRMATION',
  'SCORE_CONFIRMATION',
  'SUCCESS_LIVE_SELECTION',
  'PHASE_CONFIRMATION',
] as const satisfies readonly AiBattlePhaseOneAWindowSurface[];

describe('AI battle Phase 1A certified window evidence', () => {
  it('keeps a unique, exhaustive v2 surface matrix with executable evidence anchors', () => {
    expect(AI_BATTLE_PHASE_ONE_A_WINDOW_MATRIX_VERSION).toBe(
      'ai-battle.phase-one-a-window-matrix/v2'
    );
    expect(AI_BATTLE_PHASE_ONE_A_WINDOW_EVIDENCE.map(({ surface }) => surface).sort()).toEqual(
      [...EXPECTED_CERTIFIED_SURFACES].sort()
    );

    for (const row of AI_BATTLE_PHASE_ONE_A_WINDOW_EVIDENCE) {
      const source = readFileSync(row.behaviorTest, 'utf8');
      expect(source, `${row.surface} evidence anchor is stale`).toContain(row.evidenceAnchor);
    }
  });

  it('invalidates the matrix review when the Phase 0 certified ability set changes', () => {
    const normalizedAbilitySet = AI_BATTLE_PHASE_ZERO_ABILITY_EVIDENCE.map(
      ({ baseCardCode, abilityId }) => `${baseCardCode}\0${abilityId}`
    )
      .sort()
      .join('\n');
    const digest = createHash('sha256').update(normalizedAbilitySet).digest('hex');

    expect(digest).toBe(AI_BATTLE_PHASE_ONE_A_ABILITY_EVIDENCE_SHA256);
  });

  it('keeps core-only surfaces outside the certified reachable set', () => {
    const certified = new Set<string>(
      AI_BATTLE_PHASE_ONE_A_WINDOW_EVIDENCE.map(({ surface }) => surface)
    );
    expect(
      AI_BATTLE_PHASE_ONE_A_SUPPORTED_OUTSIDE_CERTIFIED_REACHABILITY.filter((surface) =>
        certified.has(surface)
      )
    ).toEqual([]);
  });
});
