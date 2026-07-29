import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  AI_BATTLE_PHASE_THREE_ACCEPTANCE,
  AI_BATTLE_PHASE_THREE_CERTIFICATION_STATUS,
  AI_BATTLE_PHASE_THREE_COMPONENT_STATUS,
  AI_BATTLE_PHASE_THREE_GATE_EVIDENCE,
  AI_BATTLE_PHASE_THREE_RUNTIME_BOUNDARY,
} from '../../src/server/ai-battle/phase-three-baseline';

describe('AI battle Phase 3 completion baseline', () => {
  it('freezes the completed formal SYSTEM runtime boundary', () => {
    expect(AI_BATTLE_PHASE_THREE_CERTIFICATION_STATUS).toBe('COMPLETE');
    expect(AI_BATTLE_PHASE_THREE_COMPONENT_STATUS).toMatchObject({
      unloginableSystemIdentity: 'IMPLEMENTED_VERSIONED_BINDING',
      certifiedDeckBinding: 'IMPLEMENTED_CANONICAL_YAML_CONTENT_HASH',
      phaseZeroVersionBinding: 'IMPLEMENTED_IN_SYSTEM_IDENTITY',
      serverInternalCommandAuthority: 'IMPLEMENTED_NON_FORGEABLE',
      systemSchedulingScope: 'AI_BATTLE_BOUND_SYSTEM_ONLY',
      strategyMatchRecord: 'IMPLEMENTED_ATOMIC_COMMAND_FRAME',
      controlledEntry: 'IMPLEMENTED_ADMIN_ONLY',
      controlledPregame: 'IMPLEMENTED_SHARED_RPS_RESOLVER',
      standaloneAiChatAuthorization: 'IMPLEMENTED_MATCH_PARTICIPANT',
      entryConcurrency: 'SERIALIZED_PER_HUMAN',
      primaryStrategyLiveness: 'AUTHORITY_PROGRESS_WATCHDOG_ONLY',
      certifiedRuntimeVerification: 'EIGHT_MATCHUP_UNITS_NATURAL_TERMINAL_ZERO_REJECTIONS',
    });
    expect(AI_BATTLE_PHASE_THREE_RUNTIME_BOUNDARY).toMatchObject({
      productEntryPublic: false,
      controlledEntryAuthorization: 'AUTHENTICATED_ADMIN',
      systemLoginAllowed: false,
      systemCommandPublicRouteAllowed: false,
      matchMode: 'ONLINE',
      manualOperationMode: 'RULES',
      controlledPregame: 'SERVER_DETERMINISTIC_SHARED_RPS_RULE',
      transientOnlineRoomCreated: false,
      standaloneAiChatAuthorization: 'ONLINE_MATCH_PARTICIPANT',
      ordinaryOnlineChatStillRequiresRoomPresence: true,
      entrySerializationScope: 'HUMAN_USER_ID',
      llmDependency: false,
      primaryStrategyConservativeLimitAccounting: false,
    });
  });

  it('keeps executable evidence for every Phase 3 gate', () => {
    expect(AI_BATTLE_PHASE_THREE_ACCEPTANCE).toMatchObject({
      certifiedMatchupUnitCount: 8,
      expectedFormalRuntimeGames: 8,
      certifiedDeckFixtureSource: 'VERSION_CONTROLLED_YAML_PLUS_CANONICAL_CONTENT_HASH',
      expectedConcurrentActiveMatchesPerHuman: 1,
      expectedAuthorityRejectionsForSelectedMachineCommands: 0,
      expectedAbnormalSystemTerminals: 0,
      expectedFallbackActivations: 0,
      expectedHiddenInformationLeaks: 0,
    });
    expect(AI_BATTLE_PHASE_THREE_GATE_EVIDENCE).toHaveLength(13);
    expect(new Set(AI_BATTLE_PHASE_THREE_GATE_EVIDENCE.map((evidence) => evidence.gate)).size).toBe(
      AI_BATTLE_PHASE_THREE_GATE_EVIDENCE.length
    );
    for (const evidence of AI_BATTLE_PHASE_THREE_GATE_EVIDENCE) {
      expect(
        readFileSync(evidence.behaviorTest, 'utf8'),
        `${evidence.gate} evidence anchor is stale`
      ).toContain(evidence.evidenceAnchor);
    }
  });
});
