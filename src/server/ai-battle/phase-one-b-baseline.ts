import { ONLINE_MATCH_CHAT_SCHEMA_VERSION } from '../../online/chat-types.js';
import { AI_CONSERVATIVE_POLICY_VERSION } from './conservative-decision-policy.js';
import { AI_DECISION_LEASE_SCHEMA_VERSION } from './machine-decision-coordinator.js';
import { MACHINE_DECISION_SCHEDULE_SCHEMA_VERSION } from './machine-decision-scheduler.js';
import {
  AI_RULE_PROGRESS_SNAPSHOT_VERSION,
  DEFAULT_MACHINE_LIVENESS_LIMITS,
} from './rule-progress.js';
import { SERVER_DEADLINE_SCHEMA_VERSION } from './server-deadline-owner.js';

export const AI_BATTLE_PHASE_ONE_B_BASELINE_VERSION = 'ai-battle.phase-one-b/v1' as const;
export const AI_BATTLE_PHASE_ONE_B_CERTIFICATION_STATUS = 'COMPLETE' as const;

export const AI_BATTLE_PHASE_ONE_B_COMPONENT_VERSIONS = {
  decisionLease: AI_DECISION_LEASE_SCHEMA_VERSION,
  machineSchedule: MACHINE_DECISION_SCHEDULE_SCHEMA_VERSION,
  serverDeadline: SERVER_DEADLINE_SCHEMA_VERSION,
  conservativePolicy: AI_CONSERVATIVE_POLICY_VERSION,
  ruleProgressSnapshot: AI_RULE_PROGRESS_SNAPSHOT_VERSION,
  onlineMatchChat: ONLINE_MATCH_CHAT_SCHEMA_VERSION,
} as const;

export const AI_BATTLE_PHASE_ONE_B_RUNTIME_BOUNDARY = {
  controlledSchedulingDefaultEnabled: false,
  allowedMatchMode: 'ONLINE',
  excludedMatchMode: 'SOLITAIRE',
  decisionsPerSchedulerCallback: 1,
  terminalAuthority: 'SYSTEM_ONLY',
  livenessTerminalGameEndReason: 'SYSTEM_LIVENESS_CONCEDE',
  infrastructureFailureGameEndReason: 'SYSTEM_MACHINE_FAILURE',
} as const;

export const AI_BATTLE_PHASE_ONE_B_LIVENESS_LIMITS = DEFAULT_MACHINE_LIVENESS_LIMITS;

export const AI_BATTLE_PHASE_ONE_B_GATE_EVIDENCE = [
  evidence(
    'CERTIFIED_CONSERVATIVE_WINDOWS',
    'tests/helpers/ai-decision-contract.ts',
    'const conservative = selectConservativeDecision(result.handle.contract);'
  ),
  evidence(
    'SERIAL_LEASE_AND_STALE_REJECTION',
    'tests/integration/ai-battle-phase-one-b-match-runtime.test.ts',
    "it('rejects an old machine lease after a serialized player write'"
  ),
  evidence(
    'BROWSERLESS_SERVER_DEADLINE',
    'tests/integration/ai-battle-phase-one-b-server-deadline.test.ts',
    "it('advances an authoritative public display without a browser request'"
  ),
  evidence(
    'CONTINUOUS_MACHINE_SCHEDULING',
    'tests/integration/ai-battle-phase-one-b-machine-scheduler.test.ts',
    "it('continues adjacent SYSTEM windows and stops when the USER seat must act'"
  ),
  evidence(
    'FROZEN_LIVENESS_TERMINAL',
    'tests/integration/ai-battle-phase-one-b-machine-scheduler.test.ts',
    "it('concedes with a distinct SYSTEM terminal reason at the frozen decision bound'"
  ),
  evidence(
    'SYSTEM_NOTICE_SCHEMA_AND_DEDUPE',
    'tests/unit/online-match-chat-runtime.test.ts',
    "it('系统通知使用独立 schema、服务端去重且没有玩家发送者字段'"
  ),
] as const;

function evidence(gate: string, behaviorTest: string, evidenceAnchor: string) {
  return { gate, behaviorTest, evidenceAnchor } as const;
}
