import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { AiObservation } from '../../src/server/ai-battle/ai-observation';
import {
  AI_SELECTED_HISTORY_SCHEMA_VERSION,
  createAiSelectedHistoryTracker,
} from '../../src/server/ai-battle/strategy-history';

function observation(
  authorityRevision: number,
  options: {
    readonly viewerSeat?: 'FIRST' | 'SECOND';
    readonly firstStageCards?: AiObservation['seats']['FIRST']['zones'][number]['visibleCards'];
  } = {}
): AiObservation {
  const emptyZones = [
    {
      zoneKey: 'MEMBER_CENTER',
      zoneType: 'MEMBER',
      count: 0,
      ordered: false,
      visibleCards: [],
    },
    {
      zoneKey: 'WAITING_ROOM',
      zoneType: 'WAITING_ROOM',
      count: 0,
      ordered: true,
      visibleCards: [],
    },
  ] as const;
  const firstStageCards = options.firstStageCards ?? [];
  return {
    schemaVersion: 'ai-battle.observation/v1',
    decisionContractSchemaVersion: 'ai-battle.decision-contract/v1',
    commandAdapterVersion: 'ai-battle.decision-command-adapter/v1',
    authorityRevision,
    viewerSeat: options.viewerSeat ?? 'FIRST',
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
      FIRST: {
        successLiveCount: 0,
        successLiveScore: 0,
        zones: [
          {
            zoneKey: 'MEMBER_CENTER',
            zoneType: 'MEMBER',
            count: firstStageCards.length,
            ordered: false,
            visibleCards: firstStageCards,
          },
          emptyZones[1],
        ],
      },
      SECOND: { successLiveCount: 0, successLiveScore: 0, zones: emptyZones },
    },
    sharedZones: [],
    decision: {
      decisionRef: 'current-decision',
      kind: 'MAIN_PHASE',
      mandatory: false,
      candidates: [
        {
          candidateId: 'candidate-1',
          hidden: false,
          card: {
            cardCode: 'PL!-sd1-001-SD',
            name: '高坂穗乃果',
            cardType: 'MEMBER',
            cost: 2,
          },
        },
      ],
      options: [],
      actions: [
        {
          actionId: 'action-1',
          kind: 'PLAY_MEMBER',
          candidateId: 'candidate-1',
          targetSlot: 'CENTER',
        },
      ],
    },
  };
}

describe('AI battle Phase 2 selected visible history', () => {
  it('records accepted strategic decisions without contract-local identifiers', () => {
    const tracker = createAiSelectedHistoryTracker('FIRST');
    const current = observation(4);
    tracker.observe(current);
    tracker.recordAcceptedDecision(current, {
      ok: true,
      policyVersion: 'ai-battle.explainable-policy/v1',
      tier: 'HEURISTIC',
      reasonCode: 'SELECT_HIGHEST_RANKED_MAIN_ACTION',
      summary: 'Choose the highest-ranked legal main-phase action.',
      selection: { kind: 'SELECT_MAIN_PHASE_ACTION', actionId: 'action-1' },
      consideredIds: ['action-1'],
    });

    expect(tracker.snapshot()).toEqual([
      {
        schemaVersion: AI_SELECTED_HISTORY_SCHEMA_VERSION,
        historyId: 'history-1',
        authorityRevision: 4,
        turnCount: 1,
        actorSeat: 'FIRST',
        source: 'AUTHORITY_ACCEPTED_SELECTION',
        category: 'MEMBER_PLAY',
        reasonCode: 'ACCEPTED_MEMBER_PLAY',
        summary:
          '权威已接受成员登场：PL!-sd1-001-SD 费用 2「高坂穗乃果」登场到中央；支付 0 张能量，不进行换手替换。',
        cards: [
          {
            cardCode: 'PL!-sd1-001-SD',
            name: '高坂穗乃果',
            cardType: 'MEMBER',
            cost: 2,
          },
        ],
      },
    ]);
    expect(JSON.stringify(tracker.snapshot())).not.toContain('candidate-1');
    expect(JSON.stringify(tracker.snapshot())).not.toContain('action-1');
  });

  it('selects visible public-zone changes, skips pure confirmations, and stays bounded', () => {
    const tracker = createAiSelectedHistoryTracker('SECOND', 2);
    tracker.observe(observation(1, { viewerSeat: 'SECOND' }));
    const changed = observation(2, {
      viewerSeat: 'SECOND',
      firstStageCards: [
        {
          cardCode: 'PL!-sd1-001-SD',
          name: '高坂穗乃果',
          cardType: 'MEMBER',
          cost: 2,
          slot: 'CENTER',
        },
      ],
    });
    tracker.observe(changed);
    tracker.recordAcceptedDecision(
      {
        ...changed,
        decision: {
          decisionRef: 'current-decision',
          kind: 'SCORE_CONFIRMATION',
          mandatory: true,
          candidates: [],
          options: [],
          actions: [],
        },
      },
      {
        ok: true,
        policyVersion: 'ai-battle.explainable-policy/v1',
        tier: 'RULE_FORCED',
        reasonCode: 'CONFIRM_AUTHORITY_SCORE',
        summary: 'Confirm.',
        selection: { kind: 'CONFIRM_SCORE' },
        consideredIds: [],
      }
    );
    tracker.recordAcceptedDecision(changed, {
      ok: true,
      policyVersion: 'ai-battle.explainable-policy/v1',
      tier: 'HEURISTIC',
      reasonCode: 'SELECT_HIGHEST_RANKED_MAIN_ACTION',
      summary: 'Play one.',
      selection: { kind: 'SELECT_MAIN_PHASE_ACTION', actionId: 'action-1' },
      consideredIds: [],
    });
    tracker.recordAcceptedDecision(changed, {
      ok: true,
      policyVersion: 'ai-battle.explainable-policy/v1',
      tier: 'HEURISTIC',
      reasonCode: 'SELECT_HIGHEST_RANKED_MAIN_ACTION',
      summary: 'Play another.',
      selection: { kind: 'SELECT_MAIN_PHASE_ACTION', actionId: 'action-1' },
      consideredIds: [],
    });

    expect(tracker.snapshot()).toHaveLength(2);
    expect(tracker.snapshot().map((item) => item.summary)).toEqual([
      '权威已接受成员登场：PL!-sd1-001-SD 费用 2「高坂穗乃果」登场到中央；支付 0 张能量，不进行换手替换。',
      '权威已接受成员登场：PL!-sd1-001-SD 费用 2「高坂穗乃果」登场到中央；支付 0 张能量，不进行换手替换。',
    ]);
    expect(JSON.stringify(tracker.snapshot())).not.toContain('Play one.');
    expect(JSON.stringify(tracker.snapshot())).not.toContain('Play another.');
  });

  it('describes stage-area deltas without inventing an actor or an enter-stage event', () => {
    const tracker = createAiSelectedHistoryTracker('SECOND');
    const visibleMember = {
      cardCode: 'PL!-sd1-001-SD',
      name: '高坂穗乃果',
      cardType: 'MEMBER',
      cost: 2,
      slot: 'CENTER',
    } as const;

    tracker.observe(observation(1, { viewerSeat: 'SECOND' }));
    const history = tracker.observe(
      observation(2, {
        viewerSeat: 'SECOND',
        firstStageCards: [visibleMember],
      })
    );

    expect(history).toEqual([
      {
        schemaVersion: AI_SELECTED_HISTORY_SCHEMA_VERSION,
        historyId: 'history-1',
        authorityRevision: 2,
        turnCount: 1,
        affectedSeat: 'FIRST',
        source: 'VISIBLE_PROJECTION_DELTA',
        category: 'VISIBLE_STATE_CHANGE',
        reasonCode: 'VISIBLE_MEMBER_CENTER_ADDITION',
        summary: "A card is newly visible in the opponent's stage area.",
        cards: [
          {
            cardCode: 'PL!-sd1-001-SD',
            name: '高坂穗乃果',
            cardType: 'MEMBER',
            cost: 2,
          },
        ],
      },
    ]);
    expect(history[0]).not.toHaveProperty('actorSeat');
    expect(history[0]?.summary).not.toContain('entered');
  });

  it('rejects cross-seat observations and remains isolated from authority sources', () => {
    const tracker = createAiSelectedHistoryTracker('FIRST');
    expect(() => tracker.observe(observation(1, { viewerSeat: 'SECOND' }))).toThrow(
      'selected-history seat mismatch'
    );
    const source = readFileSync('src/server/ai-battle/strategy-history.ts', 'utf8');
    expect(source).not.toContain("from '../../domain/");
    expect(source).not.toContain("from '../services/");
    expect(source).not.toContain('GameState');
    expect(source).not.toContain('PlayerViewState');
    expect(source).not.toContain('PublicEvent');
    expect(source).not.toContain('PrivateEvent');
  });
});
