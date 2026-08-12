/**
 * Current AI battle protocol/version manifest.
 *
 * Runtime modules must reference this manifest instead of declaring their own
 * `ai-battle.* /vN` literals. A component version changes only when that
 * component's serialized shape, behavioral contract, or prompt knowledge
 * changes. `AI_BATTLE_PROTOCOL_MANIFEST_REVISION` changes whenever this
 * manifest is edited, but it is not itself a wire-format version.
 *
 * Frozen phase baselines and historical certification evidence deliberately do
 * not read from this manifest: they must continue to describe the versions
 * that were certified at that point in time.
 */
export const AI_BATTLE_PROTOCOL_MANIFEST_REVISION = 1 as const;

export const AI_BATTLE_PROTOCOL_VERSIONS = {
  decision: {
    contract: 'ai-battle.decision-contract/v2',
    commandAdapter: 'ai-battle.decision-command-adapter/v2',
    observation: 'ai-battle.observation/v3',
    strategyContext: 'ai-battle.strategy-context/v4',
    strategicObjectives: 'ai-battle.strategic-objectives/v1',
    selectedHistory: 'ai-battle.selected-history/v4',
    semanticDecisionContext: 'ai-battle.semantic-decision-context/v5',
    modelStrategyContext: 'ai-battle.model-strategy-context/v6',
    modelRequestEnvelope: 'ai-battle.model-request-envelope/v7',
    modelDecisionOutput: 'ai-battle.model-decision-output/v3',
  },
  knowledge: {
    deckKnowledge: 'ai-battle.deck-knowledge/v1',
    compactRules: 'ai-battle.compact-rules/v4',
    museStarterPlaybook: 'ai-battle.playbook.muse-starter/v2',
    greenHasunosoraB6Playbook: 'ai-battle.playbook.green-hasunosora-b6/v2',
    modelSystemPrompt: 'ai-battle.model-system-prompt/v7',
  },
  policy: {
    conservativeDecision: 'ai-battle.conservative-policy/v1',
    explainableDecision: 'ai-battle.explainable-policy/v1',
    randomLegalDecision: 'ai-battle.random-legal-policy/v1',
    modelInvocation: 'ai-battle.model-invocation-policy/v1',
    modelDecision: 'ai-battle.model-decision-policy/v1',
    controlledPregame: 'ai-battle.phase-three-pregame/v1',
    systemLifecycle: 'ai-battle.phase-three-lifecycle/v1',
  },
  runtime: {
    systemParticipantIdentity: 'ai-battle.system-participant-identity/v8',
    controlledPregameResult: 'ai-battle.controlled-pregame-result/v1',
    decisionLease: 'ai-battle.decision-lease/v1',
    machineDecisionSchedule: 'ai-battle.machine-decision-schedule/v1',
    serverDeadline: 'ai-battle.server-deadline/v2',
    ruleProgressSnapshot: 'ai-battle.rule-progress-snapshot/v1',
    publicEntryConfig: 'ai-battle.public-entry-config/v1',
    phaseFourEntry: 'ai-battle.phase-four-entry/v1',
  },
  audit: {
    strategyDecisionAudit: 'ai-battle.strategy-decision-audit/v3',
    strategyDecisionRecord: 'ai-battle.strategy-decision-record/v4',
    modelInvocationAudit: 'ai-battle.model-invocation-audit/v1',
    debugTrace: 'ai-battle.debug-trace/v2',
    reflectionHistory: 'ai-battle.reflection-history/v2',
    reflectionDocument: 'ai-battle.reflection-document/v2',
    reflectionDocumentDownload: 'ai-battle.reflection-document-download/v2',
  },
  evaluation: {
    randomLegalDecisionFact: 'ai-battle.random-legal-decision-fact/v1',
    headlessPlayout: 'ai-battle.headless-playout/v1',
    headlessFailureArtifact: 'ai-battle.headless-failure-artifact/v1',
    strategyEvaluation: 'ai-battle.strategy-evaluation/v1',
    phaseTwoPlayout: 'ai-battle.phase-two-playout/v1',
  },
  provider: {
    modelProfile: 'ai-battle.model-provider.alibaba-qwen3.7-flash/v1',
  },
} as const;

type Values<T> = T[keyof T];

export type AiBattleProtocolVersion = Values<{
  [TGroup in keyof typeof AI_BATTLE_PROTOCOL_VERSIONS]: Values<
    (typeof AI_BATTLE_PROTOCOL_VERSIONS)[TGroup]
  >;
}>;
