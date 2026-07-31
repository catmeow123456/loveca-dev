import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as yaml from 'yaml';
import { isLiveCardData, isMemberCardData } from '../../src/domain/entities/card';
import {
  AI_OBSERVATION_SCHEMA_VERSION,
  type AiObservation,
} from '../../src/server/ai-battle/ai-observation';
import {
  AI_BATTLE_PHASE_ZERO_DECKS,
  type AiBattlePhaseZeroDeckKey,
} from '../../src/server/ai-battle/phase-zero-baseline';
import {
  AI_STRATEGY_CONTEXT_SCHEMA_VERSION,
  buildAiStrategyContext,
} from '../../src/server/ai-battle/strategy-context';
import {
  AI_COMPACT_RULES,
  AI_COMPACT_RULES_VERSION,
  AI_DECK_PLAYBOOKS,
  AI_GREEN_HASUNOSORA_B6_PLAYBOOK_VERSION,
  AI_MUSE_STARTER_PLAYBOOK_VERSION,
} from '../../src/server/ai-battle/strategy-knowledge';
import { aiBattleAuthoritativeCardRegistry } from '../helpers/ai-battle-phase-zero-decks';

function createObservation(): AiObservation {
  const emptySeat = {
    successLiveCount: 0,
    successLiveScore: 0,
    zones: [],
  } as const;
  return {
    schemaVersion: AI_OBSERVATION_SCHEMA_VERSION,
    decisionContractSchemaVersion: 'ai-battle.decision-contract/v1',
    commandAdapterVersion: 'ai-battle.decision-command-adapter/v1',
    authorityRevision: 4,
    viewerSeat: 'FIRST',
    turn: {
      count: 2,
      phase: 'MAIN_PHASE',
      subPhase: 'FREE_ACTION',
      firstSeat: 'FIRST',
      activeSeat: 'FIRST',
      prioritySeat: 'FIRST',
    },
    window: null,
    liveResult: null,
    endInfo: null,
    seats: { FIRST: emptySeat, SECOND: emptySeat },
    sharedZones: [],
    decision: {
      decisionRef: 'current-decision',
      kind: 'PHASE_CONFIRMATION',
      mandatory: true,
      candidates: [],
      options: [],
      actions: [],
    },
  };
}

describe('AI battle Phase 2 strategy knowledge and context', () => {
  it('freezes compact authority, turn, decision, and victory rules with unique IDs', () => {
    expect(AI_COMPACT_RULES.version).toBe(AI_COMPACT_RULES_VERSION);
    const directives = [
      ...AI_COMPACT_RULES.authorityBoundary,
      ...AI_COMPACT_RULES.turnFlow,
      ...AI_COMPACT_RULES.decisionRules,
      ...AI_COMPACT_RULES.victoryRules,
    ];
    expect(new Set(directives.map((item) => item.directiveId)).size).toBe(directives.length);
    expect(directives.map((item) => item.directiveId)).toContain('CONTRACT_ONLY');
    expect(directives.map((item) => item.directiveId)).toContain('THREE_SUCCESS_LIVES');
    expect(directives.every((item) => item.text.length > 20)).toBe(true);
  });

  it('binds both playbooks to certified content hashes and cards actually in each deck', () => {
    expect(AI_DECK_PLAYBOOKS.MUSE_STARTER.version).toBe(AI_MUSE_STARTER_PLAYBOOK_VERSION);
    expect(AI_DECK_PLAYBOOKS.GREEN_HASUNOSORA_B6.version).toBe(
      AI_GREEN_HASUNOSORA_B6_PLAYBOOK_VERSION
    );

    for (const deckKey of Object.keys(AI_DECK_PLAYBOOKS) as AiBattlePhaseZeroDeckKey[]) {
      const playbook = AI_DECK_PLAYBOOKS[deckKey];
      const certification = AI_BATTLE_PHASE_ZERO_DECKS[deckKey];
      const source = yaml.parse(readFileSync(certification.sourceAssetPath, 'utf8')) as {
        readonly main_deck: {
          readonly members: readonly { readonly card_code: string }[];
          readonly lives: readonly { readonly card_code: string }[];
        };
      };
      const deckCardCodes = new Set(
        [...source.main_deck.members, ...source.main_deck.lives].map((item) => item.card_code)
      );

      expect(playbook.certifiedContentHash).toBe(certification.contentHash);
      expect(playbook.cardRoles.length).toBeGreaterThanOrEqual(7);
      for (const role of playbook.cardRoles) {
        expect(deckCardCodes.has(role.cardCode), `${deckKey}:${role.cardCode}`).toBe(true);
        const card = aiBattleAuthoritativeCardRegistry.getByCode(role.cardCode);
        expect(card, `${role.cardCode} is missing authoritative data`).toBeDefined();
        if (!card) continue;
        expect(role.label).toContain(card.name);
        if (isMemberCardData(card)) {
          expect(role.label).toContain(`cost ${String(card.cost)}`);
        } else if (isLiveCardData(card)) {
          expect(role.label).toContain(`score ${String(card.score)}`);
        }
      }
    }
  });

  it('builds a versioned strategy-only envelope and rejects stale deck content', () => {
    const observation = createObservation();
    const selectedHistory = [
      {
        schemaVersion: 'ai-battle.selected-history/v3',
        historyId: 'history-1',
        authorityRevision: 3,
        turnCount: 1,
        actorSeat: 'FIRST',
        source: 'AUTHORITY_ACCEPTED_SELECTION',
        category: 'LIVE_SET',
        reasonCode: 'SET_HIGHEST_RANKED_LIVE',
        summary: 'Set an achievable LIVE.',
        cards: [
          {
            cardCode: 'PL!-sd1-019-SD',
            name: 'START:DASH!!',
            cardType: 'LIVE',
            score: 4,
          },
        ],
      },
    ] as const;
    const context = buildAiStrategyContext({
      observation,
      deckKey: 'MUSE_STARTER',
      deckContentHash: AI_BATTLE_PHASE_ZERO_DECKS.MUSE_STARTER.contentHash,
      selectedHistory,
    });

    expect({
      schemaVersion: context.schemaVersion,
      observationVersion: context.observation.schemaVersion,
      compactRulesVersion: context.knowledge.compactRules.version,
      playbookVersion: context.knowledge.deckPlaybook.version,
      playbookDeckKey: context.knowledge.deckPlaybook.deckKey,
      selectedHistory: context.selectedHistory,
    }).toMatchInlineSnapshot(`
      {
        "compactRulesVersion": "ai-battle.compact-rules/v1",
        "observationVersion": "ai-battle.observation/v1",
        "playbookDeckKey": "MUSE_STARTER",
        "playbookVersion": "ai-battle.playbook.muse-starter/v1",
        "schemaVersion": "ai-battle.strategy-context/v1",
        "selectedHistory": [
          {
            "actorSeat": "FIRST",
            "authorityRevision": 3,
            "cards": [
              {
                "cardCode": "PL!-sd1-019-SD",
                "cardType": "LIVE",
                "name": "START:DASH!!",
                "score": 4,
              },
            ],
            "category": "LIVE_SET",
            "historyId": "history-1",
            "reasonCode": "SET_HIGHEST_RANKED_LIVE",
            "schemaVersion": "ai-battle.selected-history/v3",
            "source": "AUTHORITY_ACCEPTED_SELECTION",
            "summary": "Set an achievable LIVE.",
            "turnCount": 1,
          },
        ],
      }
    `);
    expect(context.schemaVersion).toBe(AI_STRATEGY_CONTEXT_SCHEMA_VERSION);
    expect(JSON.stringify(context)).not.toContain('chat');
    expect(JSON.stringify(context)).not.toContain('matchId');
    expect(JSON.stringify(context)).not.toContain('playerName');
    expect(JSON.stringify(context)).not.toContain('obj_');

    expect(() =>
      buildAiStrategyContext({
        observation,
        deckKey: 'MUSE_STARTER',
        deckContentHash: 'sha256:stale',
      })
    ).toThrow('playbook content hash mismatch');
    expect(() =>
      buildAiStrategyContext({
        observation,
        deckKey: 'MUSE_STARTER',
        deckContentHash: AI_BATTLE_PHASE_ZERO_DECKS.MUSE_STARTER.contentHash,
        selectedHistory: [{ ...selectedHistory[0], authorityRevision: 5 }],
      })
    ).toThrow('future authority revision');
    expect(() =>
      buildAiStrategyContext({
        observation,
        deckKey: 'MUSE_STARTER',
        deckContentHash: AI_BATTLE_PHASE_ZERO_DECKS.MUSE_STARTER.contentHash,
        selectedHistory: [
          {
            ...selectedHistory[0],
            source: 'VISIBLE_PROJECTION_DELTA',
          } as unknown as (typeof selectedHistory)[number],
        ],
      })
    ).toThrow('source does not match');
  });

  it('keeps strategy knowledge and context isolated from authority runtime imports', () => {
    for (const sourcePath of [
      'src/server/ai-battle/strategy-knowledge.ts',
      'src/server/ai-battle/strategy-context.ts',
    ]) {
      const source = readFileSync(sourcePath, 'utf8');
      expect(source).not.toContain("from '../../domain/");
      expect(source).not.toContain("from '../services/");
      expect(source).not.toContain('GameState');
      expect(source).not.toContain('PlayerViewState');
    }
  });
});
