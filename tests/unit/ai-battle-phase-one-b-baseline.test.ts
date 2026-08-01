import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  AI_BATTLE_PHASE_ONE_B_BASELINE_VERSION,
  AI_BATTLE_PHASE_ONE_B_CERTIFICATION_STATUS,
  AI_BATTLE_PHASE_ONE_B_COMPONENT_VERSIONS,
  AI_BATTLE_PHASE_ONE_B_GATE_EVIDENCE,
  AI_BATTLE_PHASE_ONE_B_LIVENESS_LIMITS,
  AI_BATTLE_PHASE_ONE_B_RUNTIME_BOUNDARY,
} from '../../src/server/ai-battle/phase-one-b-baseline';

describe('AI battle Phase 1B certified baseline', () => {
  it('freezes the completed single-instance runtime and conservative liveness boundary', () => {
    expect(AI_BATTLE_PHASE_ONE_B_BASELINE_VERSION).toBe('ai-battle.phase-one-b/v1');
    expect(AI_BATTLE_PHASE_ONE_B_CERTIFICATION_STATUS).toBe('COMPLETE');
    expect(AI_BATTLE_PHASE_ONE_B_COMPONENT_VERSIONS).toEqual({
      decisionLease: 'ai-battle.decision-lease/v1',
      machineSchedule: 'ai-battle.machine-decision-schedule/v1',
      serverDeadline: 'ai-battle.server-deadline/v2',
      conservativePolicy: 'ai-battle.conservative-policy/v1',
      ruleProgressSnapshot: 'ai-battle.rule-progress-snapshot/v1',
      onlineMatchChat: 'loveca.online-match-chat/v2',
    });
    expect(AI_BATTLE_PHASE_ONE_B_RUNTIME_BOUNDARY).toMatchObject({
      controlledSchedulingDefaultEnabled: false,
      allowedMatchMode: 'ONLINE',
      excludedMatchMode: 'SOLITAIRE',
      decisionsPerSchedulerCallback: 1,
      terminalAuthority: 'SYSTEM_ONLY',
      livenessTerminalGameEndReason: 'SYSTEM_LIVENESS_CONCEDE',
      infrastructureFailureGameEndReason: 'SYSTEM_MACHINE_FAILURE',
    });
    expect(AI_BATTLE_PHASE_ONE_B_LIVENESS_LIMITS).toEqual({
      maxAiTurnsWithoutRuleProgress: 3,
      maxConservativeDecisions: 256,
      maxDegradedDurationMs: 300_000,
      maxDecisionsWithoutAuthorityProgress: 128,
    });
  });

  it('keeps every completion claim attached to executable evidence', () => {
    expect(AI_BATTLE_PHASE_ONE_B_GATE_EVIDENCE.map(({ gate }) => gate)).toEqual([
      'CERTIFIED_CONSERVATIVE_WINDOWS',
      'SERIAL_LEASE_AND_STALE_REJECTION',
      'BROWSERLESS_SERVER_DEADLINE',
      'CONTINUOUS_MACHINE_SCHEDULING',
      'FROZEN_LIVENESS_TERMINAL',
      'SYSTEM_NOTICE_SCHEMA_AND_DEDUPE',
    ]);
    for (const row of AI_BATTLE_PHASE_ONE_B_GATE_EVIDENCE) {
      expect(
        readFileSync(row.behaviorTest, 'utf8'),
        `${row.gate} evidence anchor is stale`
      ).toContain(row.evidenceAnchor);
    }
  });
});
