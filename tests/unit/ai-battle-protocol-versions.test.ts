import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AI_DECISION_COMMAND_ADAPTER_VERSION,
  AI_DECISION_CONTRACT_SCHEMA_VERSION,
} from '../../src/application/ai-decisions/index.js';
import {
  AI_BATTLE_PROTOCOL_MANIFEST_REVISION,
  AI_BATTLE_PROTOCOL_VERSIONS,
} from '../../src/shared/ai-battle-protocol-versions.js';
import { AI_OBSERVATION_SCHEMA_VERSION } from '../../src/server/ai-battle/ai-observation.js';
import { AI_CONSERVATIVE_POLICY_VERSION } from '../../src/server/ai-battle/conservative-decision-policy.js';
import { AI_BATTLE_DEBUG_TRACE_SCHEMA_VERSION } from '../../src/server/ai-battle/debug-trace.js';
import { AI_DECK_KNOWLEDGE_SCHEMA_VERSION } from '../../src/server/ai-battle/deck-knowledge.js';
import { AI_EXPLAINABLE_DECISION_POLICY_VERSION } from '../../src/server/ai-battle/explainable-decision-policy.js';
import {
  AI_HEADLESS_FAILURE_ARTIFACT_SCHEMA_VERSION,
  AI_HEADLESS_PLAYOUT_SCHEMA_VERSION,
} from '../../src/server/ai-battle/headless-playout.js';
import { AI_DECISION_LEASE_SCHEMA_VERSION } from '../../src/server/ai-battle/machine-decision-coordinator.js';
import { MACHINE_DECISION_SCHEDULE_SCHEMA_VERSION } from '../../src/server/ai-battle/machine-decision-scheduler.js';
import {
  AI_MODEL_DECISION_POLICY_VERSION,
  AI_MODEL_INVOCATION_AUDIT_SCHEMA_VERSION,
  AI_MODEL_INVOCATION_POLICY_VERSION,
} from '../../src/server/ai-battle/model-governance.js';
import { AI_MODEL_PROVIDER_PROFILE_VERSION } from '../../src/server/ai-battle/model-provider.js';
import {
  AI_MODEL_DECISION_OUTPUT_SCHEMA_VERSION,
  AI_MODEL_REQUEST_ENVELOPE_SCHEMA_VERSION,
  AI_MODEL_STRATEGY_CONTEXT_SCHEMA_VERSION,
  AI_MODEL_SYSTEM_PROMPT_VERSION,
} from '../../src/server/ai-battle/model-protocol.js';
import { AI_PHASE_TWO_PLAYOUT_SCHEMA_VERSION } from '../../src/server/ai-battle/phase-two-playout.js';
import {
  AI_RANDOM_LEGAL_DECISION_FACT_SCHEMA_VERSION,
  AI_RANDOM_LEGAL_POLICY_VERSION,
} from '../../src/server/ai-battle/random-legal-decision-policy.js';
import {
  AI_BATTLE_REFLECTION_DOCUMENT_DOWNLOAD_SCHEMA_VERSION,
  AI_BATTLE_REFLECTION_DOCUMENT_SCHEMA_VERSION,
  AI_BATTLE_REFLECTION_HISTORY_SCHEMA_VERSION,
} from '../../src/server/ai-battle/reflection-history.js';
import { AI_RULE_PROGRESS_SNAPSHOT_VERSION } from '../../src/server/ai-battle/rule-progress.js';
import { AI_SEMANTIC_DECISION_CONTEXT_SCHEMA_VERSION } from '../../src/server/ai-battle/semantic-context.js';
import { SERVER_DEADLINE_SCHEMA_VERSION } from '../../src/server/ai-battle/server-deadline-owner.js';
import { AI_STRATEGIC_OBJECTIVES_SCHEMA_VERSION } from '../../src/server/ai-battle/strategic-objectives.js';
import { AI_STRATEGY_CONTEXT_SCHEMA_VERSION } from '../../src/server/ai-battle/strategy-context.js';
import {
  AI_STRATEGY_DECISION_AUDIT_SCHEMA_VERSION,
  AI_STRATEGY_DECISION_RECORD_SCHEMA_VERSION,
} from '../../src/server/ai-battle/strategy-decision-audit.js';
import { AI_STRATEGY_EVALUATION_SCHEMA_VERSION } from '../../src/server/ai-battle/strategy-evaluation.js';
import { AI_SELECTED_HISTORY_SCHEMA_VERSION } from '../../src/server/ai-battle/strategy-history.js';
import {
  AI_COMPACT_RULES_VERSION,
  AI_GREEN_HASUNOSORA_B6_PLAYBOOK_VERSION,
  AI_MUSE_STARTER_PLAYBOOK_VERSION,
} from '../../src/server/ai-battle/strategy-knowledge.js';
import {
  AI_PHASE_THREE_LIFECYCLE_POLICY_VERSION,
  AI_PHASE_THREE_PREGAME_POLICY_VERSION,
  AI_SYSTEM_IDENTITY_SCHEMA_VERSION,
} from '../../src/server/ai-battle/system-participant.js';
import { AI_CONTROLLED_PREGAME_RESULT_SCHEMA_VERSION } from '../../src/server/ai-battle/system-pregame.js';
import { AI_BATTLE_PHASE_FOUR_ENTRY_SCHEMA_VERSION } from '../../src/server/services/ai-battle-phase-three-service.js';

const FROZEN_VERSION_SOURCE_FILES = new Set([
  'phase-zero-baseline.ts',
  'phase-one-a-window-evidence.ts',
  'phase-one-b-baseline.ts',
  'phase-one-c-baseline.ts',
  'phase-two-baseline.ts',
  'phase-three-baseline.ts',
  'phase-four-baseline.ts',
  'phase-four-five-baseline.ts',
]);

function flattenVersionManifest(): string[] {
  return Object.values(AI_BATTLE_PROTOCOL_VERSIONS).flatMap((group) => Object.values(group));
}

describe('AI battle protocol version manifest', () => {
  it('owns unique, namespaced current version identifiers', () => {
    const versions = flattenVersionManifest();

    expect(AI_BATTLE_PROTOCOL_MANIFEST_REVISION).toBeGreaterThan(0);
    expect(new Set(versions).size).toBe(versions.length);
    for (const version of versions) {
      expect(version).toMatch(/^ai-battle\.[a-z0-9.-]+\/v[1-9][0-9]*$/);
    }
  });

  it('drives every current compatibility export', () => {
    expect({
      decision: {
        contract: AI_DECISION_CONTRACT_SCHEMA_VERSION,
        commandAdapter: AI_DECISION_COMMAND_ADAPTER_VERSION,
        observation: AI_OBSERVATION_SCHEMA_VERSION,
        strategyContext: AI_STRATEGY_CONTEXT_SCHEMA_VERSION,
        strategicObjectives: AI_STRATEGIC_OBJECTIVES_SCHEMA_VERSION,
        selectedHistory: AI_SELECTED_HISTORY_SCHEMA_VERSION,
        semanticDecisionContext: AI_SEMANTIC_DECISION_CONTEXT_SCHEMA_VERSION,
        modelStrategyContext: AI_MODEL_STRATEGY_CONTEXT_SCHEMA_VERSION,
        modelRequestEnvelope: AI_MODEL_REQUEST_ENVELOPE_SCHEMA_VERSION,
        modelDecisionOutput: AI_MODEL_DECISION_OUTPUT_SCHEMA_VERSION,
      },
      knowledge: {
        deckKnowledge: AI_DECK_KNOWLEDGE_SCHEMA_VERSION,
        compactRules: AI_COMPACT_RULES_VERSION,
        museStarterPlaybook: AI_MUSE_STARTER_PLAYBOOK_VERSION,
        greenHasunosoraB6Playbook: AI_GREEN_HASUNOSORA_B6_PLAYBOOK_VERSION,
        modelSystemPrompt: AI_MODEL_SYSTEM_PROMPT_VERSION,
      },
      policy: {
        conservativeDecision: AI_CONSERVATIVE_POLICY_VERSION,
        explainableDecision: AI_EXPLAINABLE_DECISION_POLICY_VERSION,
        randomLegalDecision: AI_RANDOM_LEGAL_POLICY_VERSION,
        modelInvocation: AI_MODEL_INVOCATION_POLICY_VERSION,
        modelDecision: AI_MODEL_DECISION_POLICY_VERSION,
        controlledPregame: AI_PHASE_THREE_PREGAME_POLICY_VERSION,
        systemLifecycle: AI_PHASE_THREE_LIFECYCLE_POLICY_VERSION,
      },
      runtime: {
        systemParticipantIdentity: AI_SYSTEM_IDENTITY_SCHEMA_VERSION,
        controlledPregameResult: AI_CONTROLLED_PREGAME_RESULT_SCHEMA_VERSION,
        decisionLease: AI_DECISION_LEASE_SCHEMA_VERSION,
        machineDecisionSchedule: MACHINE_DECISION_SCHEDULE_SCHEMA_VERSION,
        serverDeadline: SERVER_DEADLINE_SCHEMA_VERSION,
        ruleProgressSnapshot: AI_RULE_PROGRESS_SNAPSHOT_VERSION,
        publicEntryConfig: AI_BATTLE_PROTOCOL_VERSIONS.runtime.publicEntryConfig,
        phaseFourEntry: AI_BATTLE_PHASE_FOUR_ENTRY_SCHEMA_VERSION,
      },
      audit: {
        strategyDecisionAudit: AI_STRATEGY_DECISION_AUDIT_SCHEMA_VERSION,
        strategyDecisionRecord: AI_STRATEGY_DECISION_RECORD_SCHEMA_VERSION,
        modelInvocationAudit: AI_MODEL_INVOCATION_AUDIT_SCHEMA_VERSION,
        debugTrace: AI_BATTLE_DEBUG_TRACE_SCHEMA_VERSION,
        reflectionHistory: AI_BATTLE_REFLECTION_HISTORY_SCHEMA_VERSION,
        reflectionDocument: AI_BATTLE_REFLECTION_DOCUMENT_SCHEMA_VERSION,
        reflectionDocumentDownload: AI_BATTLE_REFLECTION_DOCUMENT_DOWNLOAD_SCHEMA_VERSION,
      },
      evaluation: {
        randomLegalDecisionFact: AI_RANDOM_LEGAL_DECISION_FACT_SCHEMA_VERSION,
        headlessPlayout: AI_HEADLESS_PLAYOUT_SCHEMA_VERSION,
        headlessFailureArtifact: AI_HEADLESS_FAILURE_ARTIFACT_SCHEMA_VERSION,
        strategyEvaluation: AI_STRATEGY_EVALUATION_SCHEMA_VERSION,
        phaseTwoPlayout: AI_PHASE_TWO_PLAYOUT_SCHEMA_VERSION,
      },
      provider: {
        modelProfile: AI_MODEL_PROVIDER_PROFILE_VERSION,
      },
    }).toEqual(AI_BATTLE_PROTOCOL_VERSIONS);
  });

  it('rejects new current-version literals outside the central manifest', () => {
    const aiBattleDirectory = join(process.cwd(), 'src/server/ai-battle');
    const currentRuntimeSources = readdirSync(aiBattleDirectory)
      .filter((fileName) => fileName.endsWith('.ts') && !FROZEN_VERSION_SOURCE_FILES.has(fileName))
      .map((fileName) => join(aiBattleDirectory, fileName));
    const additionalRuntimeSources = [
      join(process.cwd(), 'src/application/ai-decisions/decision-contract.ts'),
      join(process.cwd(), 'src/server/services/ai-battle-phase-three-service.ts'),
      join(process.cwd(), 'src/server/routes/online.ts'),
    ];
    const versionLiteralPattern = /['"]ai-battle\.[a-z0-9.-]+\/v[1-9][0-9]*['"]/g;
    const offenders = [...currentRuntimeSources, ...additionalRuntimeSources].flatMap(
      (filePath) => {
        const matches = readFileSync(filePath, 'utf8').match(versionLiteralPattern) ?? [];
        return matches.map((match) => `${filePath.replace(`${process.cwd()}/`, '')}: ${match}`);
      }
    );

    expect(offenders).toEqual([]);
  });
});
