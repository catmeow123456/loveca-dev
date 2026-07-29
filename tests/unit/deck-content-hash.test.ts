import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as yaml from 'yaml';
import {
  canonicalizeDeckContent,
  DECK_CONTENT_CANONICAL_SCHEMA_VERSION,
  serializeCanonicalDeckContent,
} from '../../src/domain/card-data/deck-canonical';
import { type DeckConfig, DeckConfigSchema } from '../../src/domain/card-data/deck-loader';
import {
  createDeckContentIdentity,
  DECK_CONTENT_HASH_ALGORITHM,
} from '../../src/server/services/deck-content-hash';
import {
  AI_BATTLE_CONSERVATIVE_LIVENESS_LIMITS,
  AI_BATTLE_CONSERVATIVE_LIVE_CANDIDATE_ORDER,
  AI_BATTLE_CONSERVATIVE_MAIN_ACTION_ORDER,
  AI_BATTLE_CONSERVATIVE_SUCCESS_LIVE_CANDIDATE_ORDER,
  AI_BATTLE_CONSERVATIVE_WINDOW_POLICY,
  AI_BATTLE_HEADLESS_ACCEPTANCE_LIMITS,
  AI_BATTLE_PHASE_ZERO_BASELINE_VERSION,
  AI_BATTLE_PHASE_ZERO_CERTIFICATION_SOURCES,
  AI_BATTLE_PHASE_ZERO_CERTIFICATION_STATUS,
  AI_BATTLE_PHASE_ZERO_CERTIFICATION_VERSIONS,
  AI_BATTLE_PHASE_ZERO_DECKS,
  AI_BATTLE_PHASE_ZERO_MATCHUP_MATRIX,
  AI_BATTLE_RULE_PROGRESS_POLICY,
  AI_BATTLE_SYSTEM_PARTICIPANT,
} from '../../src/server/ai-battle/phase-zero-baseline';

function parseDeck(source: unknown): DeckConfig {
  return DeckConfigSchema.parse(source);
}

function loadDeck(path: string): DeckConfig {
  return parseDeck(yaml.parse(readFileSync(path, 'utf8')));
}

describe('canonical deck content identity', () => {
  it('ignores display metadata and source ordering while merging duplicate entries', () => {
    const first = parseDeck({
      player_name: 'first',
      description: 'ignored',
      main_deck: {
        members: [
          { card_code: 'PL!-sd1-002-SD', count: 1 },
          { card_code: 'PL!-sd1-001-SD', count: 2 },
          { card_code: 'PL!-sd1-002-SD', count: 2 },
        ],
        lives: [{ card_code: 'PL!-sd1-019-SD', count: 4 }],
      },
      energy_deck: [{ card_code: 'PL!-sd1-023-P', count: 2 }],
    });
    const reordered = parseDeck({
      description: 'also ignored',
      player_name: 'second',
      energy_deck: [{ count: 2, card_code: 'PL!-sd1-023-P' }],
      main_deck: {
        lives: [{ count: 4, card_code: 'PL!-sd1-019-SD' }],
        members: [
          { count: 3, card_code: 'PL!-sd1-002-SD' },
          { count: 2, card_code: 'PL!-sd1-001-SD' },
        ],
      },
    });

    expect(canonicalizeDeckContent(first)).toEqual({
      schemaVersion: DECK_CONTENT_CANONICAL_SCHEMA_VERSION,
      mainDeck: {
        members: [
          { cardCode: 'PL!-sd1-001-SD', count: 2 },
          { cardCode: 'PL!-sd1-002-SD', count: 3 },
        ],
        lives: [{ cardCode: 'PL!-sd1-019-SD', count: 4 }],
      },
      energyDeck: [{ cardCode: 'PL!-sd1-023-P', count: 2 }],
    });
    expect(serializeCanonicalDeckContent(first)).toBe(serializeCanonicalDeckContent(reordered));
    expect(createDeckContentIdentity(first)).toEqual(createDeckContentIdentity(reordered));
  });

  it('normalizes card-code spelling without collapsing exact rarity', () => {
    const fullWidthPlus = parseDeck({
      player_name: 'test',
      main_deck: {
        members: [{ card_code: 'PL!HS-bp6-001-R＋', count: 1 }],
        lives: [],
      },
      energy_deck: [],
    });
    const halfWidthPlus = parseDeck({
      player_name: 'test',
      main_deck: {
        members: [{ card_code: 'PL!HS-bp6-001-R+', count: 1 }],
        lives: [],
      },
      energy_deck: [],
    });
    const differentRarity = parseDeck({
      player_name: 'test',
      main_deck: {
        members: [{ card_code: 'PL!HS-bp6-001-P', count: 1 }],
        lives: [],
      },
      energy_deck: [],
    });

    expect(createDeckContentIdentity(fullWidthPlus)).toEqual(
      createDeckContentIdentity(halfWidthPlus)
    );
    expect(createDeckContentIdentity(differentRarity).contentHash).not.toBe(
      createDeckContentIdentity(halfWidthPlus).contentHash
    );
  });

  it('keeps member, LIVE, and energy boundaries in the hash preimage', () => {
    const memberDeck = parseDeck({
      player_name: 'test',
      main_deck: {
        members: [{ card_code: 'PL!-sd1-001-SD', count: 1 }],
        lives: [],
      },
      energy_deck: [],
    });
    const liveDeck = parseDeck({
      player_name: 'test',
      main_deck: {
        members: [],
        lives: [{ card_code: 'PL!-sd1-001-SD', count: 1 }],
      },
      energy_deck: [],
    });
    const energyDeck = parseDeck({
      player_name: 'test',
      main_deck: {
        members: [],
        lives: [],
      },
      energy_deck: [{ card_code: 'PL!-sd1-001-SD', count: 1 }],
    });

    const hashes = [memberDeck, liveDeck, energyDeck].map(
      (deck) => createDeckContentIdentity(deck).contentHash
    );
    expect(new Set(hashes).size).toBe(3);
  });

  it('freezes the canonical schema and hash algorithm identifiers', () => {
    expect(DECK_CONTENT_CANONICAL_SCHEMA_VERSION).toBe('loveca.deck-content/v1');
    expect(DECK_CONTENT_HASH_ALGORITHM).toBe('sha256');
  });

  it('creates content identities for both Phase 0 deck assets', () => {
    const muse = createDeckContentIdentity(loadDeck('assets/decks/缪预组.yaml'));
    const greenHasunosora = createDeckContentIdentity(loadDeck('assets/decks/绿莲-6弹ver.yaml'));

    expect(muse).toEqual({
      canonicalSchemaVersion: AI_BATTLE_PHASE_ZERO_DECKS.MUSE_STARTER.canonicalSchemaVersion,
      hashAlgorithm: AI_BATTLE_PHASE_ZERO_DECKS.MUSE_STARTER.hashAlgorithm,
      contentHash: AI_BATTLE_PHASE_ZERO_DECKS.MUSE_STARTER.contentHash,
    });
    expect(greenHasunosora).toEqual({
      canonicalSchemaVersion: AI_BATTLE_PHASE_ZERO_DECKS.GREEN_HASUNOSORA_B6.canonicalSchemaVersion,
      hashAlgorithm: AI_BATTLE_PHASE_ZERO_DECKS.GREEN_HASUNOSORA_B6.hashAlgorithm,
      contentHash: AI_BATTLE_PHASE_ZERO_DECKS.GREEN_HASUNOSORA_B6.contentHash,
    });
  });

  it('freezes eight role and turn-order matchup units', () => {
    expect(AI_BATTLE_PHASE_ZERO_MATCHUP_MATRIX).toHaveLength(8);
    expect(
      new Set(AI_BATTLE_PHASE_ZERO_MATCHUP_MATRIX.map((scenario) => scenario.scenarioId)).size
    ).toBe(8);
    expect(
      new Set(
        AI_BATTLE_PHASE_ZERO_MATCHUP_MATRIX.map(
          (scenario) => `${scenario.playerDeckKey}:${scenario.aiDeckKey}:${scenario.aiTurnOrder}`
        )
      ).size
    ).toBe(8);
    expect(
      AI_BATTLE_PHASE_ZERO_MATCHUP_MATRIX.every(
        (scenario) => scenario.manualOperationMode === 'RULES'
      )
    ).toBe(true);
    expect(
      AI_BATTLE_PHASE_ZERO_MATCHUP_MATRIX.length *
        AI_BATTLE_HEADLESS_ACCEPTANCE_LIMITS.seedsPerMatchup
    ).toBe(AI_BATTLE_HEADLESS_ACCEPTANCE_LIMITS.expectedMinimumGames);
    expect(
      AI_BATTLE_PHASE_ZERO_MATCHUP_MATRIX.length *
        AI_BATTLE_HEADLESS_ACCEPTANCE_LIMITS.pullRequestSmokeSeedsPerMatchup
    ).toBe(AI_BATTLE_HEADLESS_ACCEPTANCE_LIMITS.expectedPullRequestSmokeGames);
    expect(AI_BATTLE_HEADLESS_ACCEPTANCE_LIMITS.fullRegressionTier).toBe('DEDICATED_CI');
  });

  it('freezes the system participant and bounded fallback policy', () => {
    expect(AI_BATTLE_PHASE_ZERO_BASELINE_VERSION).toBe('ai-battle.phase-zero/v1');
    expect(AI_BATTLE_SYSTEM_PARTICIPANT).toEqual({
      participantKey: 'loveca-ai-standard-v1',
      participantKind: 'SYSTEM',
      loginAllowed: false,
    });
    expect(AI_BATTLE_CONSERVATIVE_LIVENESS_LIMITS).toEqual({
      maxAiTurnsWithoutRuleProgress: 3,
      maxConservativeDecisions: 256,
      maxDegradedDurationMs: 300_000,
      terminalPolicy: 'SYSTEM_CONCEDE',
    });
    expect(AI_BATTLE_CONSERVATIVE_WINDOW_POLICY.map((entry) => entry.window)).toEqual([
      'MULLIGAN',
      'MAIN_ACTION',
      'LIVE_SET',
      'OPTIONAL_EFFECT',
      'PURE_CONFIRMATION',
      'MANDATORY_SELECTION',
      'MANDATORY_ORDERING',
      'MANDATORY_NUMBER_OR_POSITION',
      'SCORE_CONFIRMATION',
      'SUCCESS_LIVE_SELECTION',
      'NO_PROGRESS_LIMIT',
    ]);
    expect(AI_BATTLE_PHASE_ZERO_CERTIFICATION_STATUS).toBe('COMPLETE');
    expect(AI_BATTLE_PHASE_ZERO_CERTIFICATION_SOURCES).toEqual({
      authoritativeCardData: 'llocg_db/json/cards.json',
      cardEffectLedger: 'docs/card-effect-reuse-audit/existing_module_map.md',
      abilityEvidence: 'src/server/ai-battle/phase-zero-ability-evidence.ts',
      cardEffectRegistrationTest:
        'tests/unit/ai-battle-phase-zero-card-effect-registration.test.ts',
      rulesMatrixTest: 'tests/integration/ai-battle-phase-zero-rules-baseline.test.ts',
    });
  });

  it('binds certification to rule, card-data, matrix, and evidence versions', () => {
    const authoritativeCardDataHash = createHash('sha256')
      .update(readFileSync(AI_BATTLE_PHASE_ZERO_CERTIFICATION_SOURCES.authoritativeCardData))
      .digest('hex');

    expect(AI_BATTLE_PHASE_ZERO_CERTIFICATION_VERSIONS).toEqual({
      rulesEngineVersion: readFileSync('VERSION', 'utf8').trim(),
      authoritativeCardDataVersion: `sha256:${authoritativeCardDataHash}`,
      matchupMatrixVersion: 'ai-battle.phase-zero-matchups/v1',
      validationConfigVersion: 'ai-battle.phase-zero-validation/v1',
      abilityEvidenceVersion: 'ai-battle.phase-zero-ability-evidence/v1',
      decisionContractVersion: 'NOT_IMPLEMENTED_PHASE_ZERO',
    });
  });

  it('freezes deterministic fallback ordering and two distinct progress semantics', () => {
    expect(AI_BATTLE_CONSERVATIVE_MAIN_ACTION_ORDER).toEqual({
      actionPriority: ['PLAY_AFFORDABLE_MEMBER', 'END_MAIN_PHASE'],
      memberCandidateOrder: ['PAYABLE_COST_ASC', 'PROJECTED_HAND_INDEX_ASC', 'CANDIDATE_ID_ASC'],
      slotOrder: ['LEFT', 'CENTER', 'RIGHT'],
      activatedAbilityPolicy: 'DECLINE_AS_OPTIONAL',
    });
    expect(AI_BATTLE_CONSERVATIVE_LIVE_CANDIDATE_ORDER).toEqual([
      'PROJECTED_HAND_INDEX_ASC',
      'CANDIDATE_ID_ASC',
    ]);
    expect(AI_BATTLE_CONSERVATIVE_SUCCESS_LIVE_CANDIDATE_ORDER).toEqual([
      'PROJECTED_LIVE_ZONE_INDEX_ASC',
      'CANDIDATE_ID_ASC',
    ]);
    expect(AI_BATTLE_RULE_PROGRESS_POLICY.version).toBe('ai-battle.rule-progress/v1');
    expect(AI_BATTLE_RULE_PROGRESS_POLICY.authorityStateProgressExcludes).toContain(
      'AUTHORITY_REVISION_ONLY'
    );
    expect(AI_BATTLE_RULE_PROGRESS_POLICY.strategicRuleProgressExcludes).toContain(
      'TURN_PHASE_OR_ACTIVE_PLAYER_ONLY'
    );
  });
});
