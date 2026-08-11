import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type {
  AiObservation,
  AiObservedDecision,
  AiObservedZone,
} from '../../src/server/ai-battle/ai-observation';
import { AI_OBSERVATION_SCHEMA_VERSION } from '../../src/server/ai-battle/ai-observation';
import {
  AI_EXPLAINABLE_DECISION_POLICY_VERSION,
  selectExplainableDecision,
} from '../../src/server/ai-battle/explainable-decision-policy';
import { AI_BATTLE_PHASE_ZERO_DECKS } from '../../src/server/ai-battle/phase-zero-baseline';
import {
  buildAiStrategyContext,
  type AiStrategyContext,
} from '../../src/server/ai-battle/strategy-context';
import { SlotPosition } from '../../src/shared/types/enums';
import { loadAiBattlePhaseZeroRuntimeDeck } from '../helpers/ai-battle-phase-zero-decks';

function context(
  decision: AiObservedDecision,
  zones: readonly AiObservedZone[] = []
): AiStrategyContext {
  const emptySeat = {
    successLiveCount: 0,
    successLiveScore: 0,
    zones: [],
  } as const;
  const observation: AiObservation = {
    schemaVersion: AI_OBSERVATION_SCHEMA_VERSION,
    decisionContractSchemaVersion: 'ai-battle.decision-contract/v1',
    commandAdapterVersion: 'ai-battle.decision-command-adapter/v1',
    authorityRevision: 3,
    viewerSeat: 'FIRST',
    turn: {
      count: 1,
      phase: 'MAIN_PHASE',
      subPhase: 'FREE_ACTION',
      firstSeat: 'FIRST',
      activeSeat: 'FIRST',
      prioritySeat: 'FIRST',
    },
    window: null,
    liveResult: null,
    endInfo: null,
    seats: {
      FIRST: { ...emptySeat, zones },
      SECOND: emptySeat,
    },
    sharedZones: [],
    decision,
  };
  return buildAiStrategyContext({
    observation,
    deckKey: 'GREEN_HASUNOSORA_B6',
    deckContentHash: AI_BATTLE_PHASE_ZERO_DECKS.GREEN_HASUNOSORA_B6.contentHash,
    deck: loadAiBattlePhaseZeroRuntimeDeck('GREEN_HASUNOSORA_B6'),
  });
}

const BASE_DECISION = {
  decisionRef: 'current-decision',
  mandatory: true,
  candidates: [],
  options: [],
  actions: [],
} as const;

describe('AI battle Phase 2 explainable decision policy', () => {
  it('routes exact payments and mandatory grouped selections through RULE_FORCED', () => {
    const payment = selectExplainableDecision(
      context({
        ...BASE_DECISION,
        kind: 'COST_PAYMENT',
        candidates: [
          { candidateId: 'energy-1', hidden: false },
          { candidateId: 'energy-2', hidden: false },
          { candidateId: 'energy-3', hidden: false },
        ],
        input: { kind: 'CARD_SELECTION', requiredCount: 2 },
      })
    );
    expect(payment).toEqual({
      ok: true,
      policyVersion: AI_EXPLAINABLE_DECISION_POLICY_VERSION,
      tier: 'RULE_FORCED',
      reasonCode: 'PAY_REQUIRED_COST',
      summary: 'Pay the exact required cost with the stable candidate order.',
      selection: { kind: 'PAY_COST', candidateIds: ['energy-1', 'energy-2'] },
      consideredIds: ['energy-1', 'energy-2'],
    });

    const grouped = selectExplainableDecision(
      context({
        ...BASE_DECISION,
        kind: 'ACTIVE_EFFECT',
        abilityId: 'grouped-recovery',
        stepId: 'SELECT',
        candidates: [
          { candidateId: 'live-1', hidden: false },
          { candidateId: 'member-1', hidden: false },
          { candidateId: 'live-2', hidden: false },
        ],
        input: {
          kind: 'CARD_SELECTION',
          ordered: true,
          minSelections: 2,
          maxSelections: 2,
          canSkip: false,
          groups: [
            {
              groupId: 'live',
              candidateIds: ['live-1', 'live-2'],
              minCount: 1,
              maxCount: 1,
            },
            {
              groupId: 'member',
              candidateIds: ['member-1'],
              minCount: 1,
              maxCount: 1,
            },
          ],
        },
      })
    );
    expect(grouped).toMatchObject({
      ok: true,
      tier: 'RULE_FORCED',
      selection: {
        kind: 'SELECT_EFFECT_CARDS',
        candidateIds: ['live-1', 'member-1'],
      },
    });
  });

  it('uses a visible early curve and LIVE requirements for mulligan choices', () => {
    const result = selectExplainableDecision(
      context({
        ...BASE_DECISION,
        kind: 'MULLIGAN',
        candidates: [
          {
            candidateId: 'early',
            hidden: false,
            card: { cardCode: 'EARLY', name: 'Early', cardType: 'MEMBER', cost: 2 },
          },
          {
            candidateId: 'top-end',
            hidden: false,
            card: { cardCode: 'TOP', name: 'Top', cardType: 'MEMBER', cost: 15 },
          },
          {
            candidateId: 'easy-live',
            hidden: false,
            card: {
              cardCode: 'EASY',
              name: 'Easy',
              cardType: 'LIVE',
              score: 2,
              requiredHearts: { colorRequirements: {}, totalRequired: 3 },
            },
          },
          {
            candidateId: 'hard-live',
            hidden: false,
            card: {
              cardCode: 'HARD',
              name: 'Hard',
              cardType: 'LIVE',
              score: 6,
              requiredHearts: { colorRequirements: {}, totalRequired: 12 },
            },
          },
        ],
        input: { kind: 'CARD_SELECTION', minSelections: 0, maxSelections: 4 },
      })
    );

    expect(result).toMatchObject({
      ok: true,
      tier: 'HEURISTIC',
      reasonCode: 'MULLIGAN_FOR_EARLY_CURVE',
      selection: {
        kind: 'MULLIGAN',
        candidateIds: ['top-end', 'hard-live'],
      },
    });
  });

  it('returns top-end members when the opening hand has no early member', () => {
    const result = selectExplainableDecision(
      context({
        ...BASE_DECISION,
        kind: 'MULLIGAN',
        candidates: [
          {
            candidateId: 'top-end-1',
            hidden: false,
            card: { cardCode: 'TOP-1', name: 'Top 1', cardType: 'MEMBER', cost: 15 },
          },
          {
            candidateId: 'top-end-2',
            hidden: false,
            card: { cardCode: 'TOP-2', name: 'Top 2', cardType: 'MEMBER', cost: 11 },
          },
        ],
        input: { kind: 'CARD_SELECTION', minSelections: 0, maxSelections: 2 },
      })
    );

    expect(result).toMatchObject({
      ok: true,
      tier: 'HEURISTIC',
      reasonCode: 'MULLIGAN_FOR_EARLY_CURVE',
      selection: {
        kind: 'MULLIGAN',
        candidateIds: ['top-end-1', 'top-end-2'],
      },
    });
  });

  it('uses playbook roles and public stage occupancy to rank main-phase actions', () => {
    const result = selectExplainableDecision(
      context(
        {
          ...BASE_DECISION,
          kind: 'MAIN_PHASE',
          candidates: [
            {
              candidateId: 'center-kaho',
              hidden: false,
              card: {
                cardCode: 'PL!HS-pb1-009-P+',
                name: '日野下花帆',
                cardType: 'MEMBER',
                cost: 15,
              },
            },
            {
              candidateId: 'cheap-member',
              hidden: false,
              card: {
                cardCode: 'PL!HS-sd1-012-SD',
                name: '百生吟子',
                cardType: 'MEMBER',
                cost: 4,
              },
            },
          ],
          actions: [
            {
              actionId: 'play-kaho-center',
              kind: 'PLAY_MEMBER',
              candidateId: 'center-kaho',
              targetSlot: SlotPosition.CENTER,
              paymentPreview: {
                modifiedCost: 15,
                energyCost: 5,
                relayDiscount: 10,
                replacementCount: 1,
              },
            },
            {
              actionId: 'play-cheap-left',
              kind: 'PLAY_MEMBER',
              candidateId: 'cheap-member',
              targetSlot: SlotPosition.LEFT,
              paymentPreview: {
                modifiedCost: 4,
                energyCost: 4,
                relayDiscount: 0,
                replacementCount: 0,
              },
            },
            { actionId: 'end', kind: 'END_MAIN_PHASE' },
          ],
        },
        [
          {
            zoneKey: 'MEMBER_LEFT',
            zoneType: 'MEMBER_SLOT',
            count: 0,
            ordered: false,
            visibleCards: [],
          },
          {
            zoneKey: 'MEMBER_CENTER',
            zoneType: 'MEMBER_SLOT',
            count: 1,
            ordered: false,
            visibleCards: [],
          },
          {
            zoneKey: 'WAITING_ROOM',
            zoneType: 'WAITING_ROOM',
            count: 3,
            ordered: false,
            visibleCards: [],
          },
        ]
      )
    );

    expect(result).toMatchObject({
      ok: true,
      tier: 'HEURISTIC',
      selection: { kind: 'SELECT_MAIN_PHASE_ACTION', actionId: 'play-kaho-center' },
    });
  });

  it('leaves special member play to the model with a conservative cancel witness', () => {
    const result = selectExplainableDecision(
      context({
        ...BASE_DECISION,
        kind: 'MAIN_PHASE',
        candidates: [
          {
            candidateId: 'special-member',
            hidden: false,
            card: {
              cardCode: 'SPECIAL',
              name: 'Special Member',
              cardType: 'MEMBER',
              cost: 11,
            },
          },
        ],
        actions: [
          {
            actionId: 'begin-special',
            kind: 'BEGIN_SPECIAL_MEMBER_PLAY',
            candidateId: 'special-member',
          },
          { actionId: 'end', kind: 'END_MAIN_PHASE' },
        ],
      })
    );

    expect(result).toMatchObject({
      ok: true,
      tier: 'HEURISTIC',
      reasonCode: 'EVALUATE_SPECIAL_MEMBER_PLAY',
      selection: { kind: 'SELECT_MAIN_PHASE_ACTION', actionId: 'end' },
    });
  });

  it('leaves optional card selections to the model instead of declining them generically', () => {
    const result = selectExplainableDecision(
      context({
        ...BASE_DECISION,
        kind: 'ACTIVE_EFFECT',
        abilityId: 'optional-search',
        stepId: 'SELECT_CARD',
        candidates: [
          {
            candidateId: 'member-1',
            hidden: false,
            card: {
              cardCode: 'PL!TEST-OPTIONAL',
              name: '可选目标',
              cardType: 'MEMBER',
              cost: 4,
            },
          },
        ],
        input: {
          kind: 'CARD_SELECTION',
          minSelections: 0,
          maxSelections: 1,
          canSkip: true,
        },
      })
    );

    expect(result).toMatchObject({
      ok: true,
      tier: 'HEURISTIC',
      reasonCode: 'EVALUATE_OPTIONAL_CARD_SELECTION',
      selection: { kind: 'SELECT_EFFECT_CARDS', candidateIds: [] },
    });
  });

  it('sets only visible LIVE candidates and otherwise confirms deterministically', () => {
    const withLive = selectExplainableDecision(
      context({
        ...BASE_DECISION,
        kind: 'LIVE_SET',
        candidates: [
          {
            candidateId: 'member',
            hidden: false,
            card: { cardCode: 'M', name: 'Member', cardType: 'MEMBER', cost: 2 },
          },
          {
            candidateId: 'easy-live',
            hidden: false,
            card: {
              cardCode: 'L1',
              name: 'Easy Live',
              cardType: 'LIVE',
              score: 2,
              requiredHearts: { colorRequirements: {}, totalRequired: 4 },
            },
          },
          {
            candidateId: 'hard-live',
            hidden: false,
            card: {
              cardCode: 'L2',
              name: 'Hard Live',
              cardType: 'LIVE',
              score: 6,
              requiredHearts: { colorRequirements: {}, totalRequired: 14 },
            },
          },
        ],
        actions: [
          { actionId: 'set-member', kind: 'SET_LIVE', candidateId: 'member' },
          { actionId: 'set-easy', kind: 'SET_LIVE', candidateId: 'easy-live' },
          { actionId: 'set-hard', kind: 'SET_LIVE', candidateId: 'hard-live' },
          { actionId: 'confirm', kind: 'CONFIRM_LIVE_SET' },
        ],
        setCount: 0,
        setLimit: 3,
      })
    );
    expect(withLive).toMatchObject({
      ok: true,
      tier: 'HEURISTIC',
      selection: { kind: 'SELECT_LIVE_SET_ACTION', actionId: 'set-easy' },
    });

    const withoutLive = selectExplainableDecision(
      context({
        ...BASE_DECISION,
        kind: 'LIVE_SET',
        candidates: [
          {
            candidateId: 'member',
            hidden: false,
            card: { cardCode: 'M', name: 'Member', cardType: 'MEMBER', cost: 2 },
          },
        ],
        actions: [
          { actionId: 'set-member', kind: 'SET_LIVE', candidateId: 'member' },
          { actionId: 'confirm', kind: 'CONFIRM_LIVE_SET' },
        ],
        setCount: 0,
        setLimit: 3,
      })
    );
    expect(withoutLive).toMatchObject({
      ok: true,
      tier: 'DETERMINISTIC',
      selection: { kind: 'SELECT_LIVE_SET_ACTION', actionId: 'confirm' },
    });
  });

  it('keeps the policy isolated from authority state and view projection types', () => {
    const source = readFileSync('src/server/ai-battle/explainable-decision-policy.ts', 'utf8');
    expect(source).not.toContain("from '../../domain/");
    expect(source).not.toContain("from '../services/");
    expect(source).not.toContain('GameState');
    expect(source).not.toContain('PlayerViewState');
  });
});
