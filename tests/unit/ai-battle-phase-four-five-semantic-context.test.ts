import { describe, expect, it } from 'vitest';
import type { AiObservation } from '../../src/server/ai-battle/ai-observation';
import {
  AI_BATTLE_PHASE_FOUR_FIVE_COMPONENT_STATUS,
  AI_BATTLE_PHASE_FOUR_FIVE_RUNTIME_BOUNDARY,
  AI_BATTLE_PHASE_FOUR_FIVE_STATUS,
} from '../../src/server/ai-battle/phase-four-five-baseline';
import {
  AI_SEMANTIC_DECISION_CONTEXT_SCHEMA_VERSION,
  buildAiSemanticDecisionContext,
} from '../../src/server/ai-battle/semantic-context';

function relayObservation(): AiObservation {
  const emptyZone = (zoneKey: string, zoneType = zoneKey) => ({
    zoneKey,
    zoneType,
    count: 0,
    ordered: false,
    visibleCards: [],
  });
  const energyCards = Array.from({ length: 4 }, (_, index) => ({
    cardCode: `ENERGY-${String(index + 1)}`,
    name: '能量',
    cardType: 'ENERGY',
    orientation: 'ACTIVE',
  }));
  return {
    schemaVersion: 'ai-battle.observation/v1',
    decisionContractSchemaVersion: 'ai-battle.decision-contract/v1',
    commandAdapterVersion: 'ai-battle.decision-command-adapter/v1',
    authorityRevision: 21,
    viewerSeat: 'FIRST',
    turn: {
      count: 3,
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
          emptyZone('MEMBER_LEFT', 'MEMBER_SLOT'),
          {
            zoneKey: 'MEMBER_CENTER',
            zoneType: 'MEMBER_SLOT',
            count: 1,
            ordered: false,
            visibleCards: [
              {
                cardCode: 'PL!HS-bp5-008-R',
                name: '桂城 泉',
                cardType: 'MEMBER',
                cost: 4,
                text: '【登场】将此成员变为待机并弃 1 张手牌：检视卡组顶 5 张。',
                orientation: 'ACTIVE',
                role: 'PRIMARY',
                slot: 'CENTER',
              },
            ],
          },
          emptyZone('MEMBER_RIGHT', 'MEMBER_SLOT'),
          {
            zoneKey: 'HAND',
            zoneType: 'HAND',
            count: 1,
            ordered: false,
            visibleCards: [
              {
                cardCode: 'PL!HS-sd1-012-SD',
                name: '百生吟子',
                cardType: 'MEMBER',
                cost: 4,
              },
            ],
          },
          {
            zoneKey: 'ENERGY_ZONE',
            zoneType: 'ENERGY_ZONE',
            count: 4,
            ordered: true,
            visibleCards: energyCards,
          },
          emptyZone('MAIN_DECK'),
          emptyZone('ENERGY_DECK'),
          emptyZone('LIVE_ZONE'),
          emptyZone('WAITING_ROOM'),
          emptyZone('SUCCESS_ZONE'),
          emptyZone('EXILE_ZONE'),
        ],
      },
      SECOND: {
        successLiveCount: 0,
        successLiveScore: 0,
        zones: [
          emptyZone('MEMBER_LEFT', 'MEMBER_SLOT'),
          emptyZone('MEMBER_CENTER', 'MEMBER_SLOT'),
          emptyZone('MEMBER_RIGHT', 'MEMBER_SLOT'),
          emptyZone('HAND'),
          emptyZone('MAIN_DECK'),
          emptyZone('ENERGY_DECK'),
          emptyZone('ENERGY_ZONE'),
          emptyZone('LIVE_ZONE'),
          emptyZone('WAITING_ROOM'),
          emptyZone('SUCCESS_ZONE'),
          emptyZone('EXILE_ZONE'),
        ],
      },
    },
    sharedZones: [],
    decision: {
      decisionRef: 'current-decision',
      kind: 'MAIN_PHASE',
      mandatory: false,
      candidates: [
        {
          candidateId: 'candidate-ginko',
          hidden: false,
          card: {
            cardCode: 'PL!HS-sd1-012-SD',
            name: '百生吟子',
            cardType: 'MEMBER',
            cost: 4,
            text: '-',
          },
        },
      ],
      options: [],
      actions: [
        {
          actionId: 'play-left-pay-four',
          kind: 'PLAY_MEMBER',
          candidateId: 'candidate-ginko',
          targetSlot: 'LEFT',
          paymentPreview: {
            modifiedCost: 4,
            energyCost: 4,
            relayDiscount: 0,
            replacementCount: 0,
          },
        },
        {
          actionId: 'relay-center-pay-zero',
          kind: 'PLAY_MEMBER',
          candidateId: 'candidate-ginko',
          targetSlot: 'CENTER',
          paymentPreview: {
            modifiedCost: 4,
            energyCost: 0,
            relayDiscount: 4,
            replacementCount: 1,
          },
        },
      ],
    },
  };
}

describe('AI battle Phase 4.5 semantic decision context', () => {
  it('truthfully marks the first semantic slice in progress', () => {
    expect(AI_BATTLE_PHASE_FOUR_FIVE_STATUS).toBe('IN_PROGRESS');
    expect(AI_BATTLE_PHASE_FOUR_FIVE_COMPONENT_STATUS).toMatchObject({
      semanticCurrentState: 'IMPLEMENTED_FROM_REDACTED_OBSERVATION',
      semanticFactReferences: 'IMPLEMENTED_EXISTENCE_AND_SELECTED_CHOICE_REQUIREMENTS',
      administratorContextInspector: 'IMPLEMENTED_ADMIN_DEVELOPMENT_IN_MEMORY',
      realProviderSemanticEvaluation: 'PENDING',
    });
    expect(AI_BATTLE_PHASE_FOUR_FIVE_RUNTIME_BOUNDARY).toMatchObject({
      rawObservationSentToModel: false,
      rawSelectedHistorySentToModel: false,
      modelFreeTextStoredAsHistoryFact: false,
      authoritySelectionValidationStillRequired: true,
      serverStrategyValueVetoImplemented: false,
      administratorContextInspectorDevelopmentOnly: true,
      administratorContextInspectorAdminOnly: true,
      administratorContextInspectorPersisted: false,
    });
  });

  it('describes relay consequences and keeps card abilities attached to the actual source', () => {
    const context = buildAiSemanticDecisionContext({
      observation: relayObservation(),
      selectedHistory: [],
    });
    const relay = context.currentDecision.choices.find(
      (choice) => choice.referenceId === 'relay-center-pay-zero'
    );
    const normal = context.currentDecision.choices.find(
      (choice) => choice.referenceId === 'play-left-pay-four'
    );

    expect(context.schemaVersion).toBe(AI_SEMANTIC_DECISION_CONTEXT_SCHEMA_VERSION);
    expect(relay).toBeDefined();
    expect(relay?.facts.map((item) => item.factId)).toEqual([
      'decision.action.2.choice',
      'decision.action.2.source_boundary',
      'decision.action.2.consequence',
    ]);
    expect(relay?.facts.map((item) => item.text).join('\n')).toContain(
      'PL!HS-sd1-012-SD 费用 4「百生吟子」'
    );
    expect(relay?.facts.map((item) => item.text).join('\n')).toContain(
      '中央的PL!HS-bp5-008-R 费用 4「桂城 泉」'
    );
    expect(relay?.facts.map((item) => item.text).join('\n')).toContain(
      '左侧=空，中央=PL!HS-sd1-012-SD 费用 4「百生吟子」，右侧=空'
    );
    expect(relay?.facts.map((item) => item.text).join('\n')).toContain('活跃能量从 4 变为 4');
    expect(relay?.facts.map((item) => item.text).join('\n')).toContain('当前公开卡文没有能力文本');
    expect(relay?.facts.map((item) => item.text).join('\n')).toContain(
      '不得把被换手替换成员的能力当作它的能力'
    );
    expect(relay?.facts.map((item) => item.text).join('\n')).not.toContain('检视卡组顶');
    expect(context.currentState.facts.map((item) => item.text).join('\n')).toContain(
      '【登场】将此成员变为待机并弃 1 张手牌：检视卡组顶 5 张。'
    );

    expect(normal?.facts.map((item) => item.text).join('\n')).toContain(
      '左侧=PL!HS-sd1-012-SD 费用 4「百生吟子」，中央=PL!HS-bp5-008-R 费用 4「桂城 泉」，右侧=空'
    );
    expect(normal?.facts.map((item) => item.text).join('\n')).toContain('活跃能量从 4 变为 0');
  });

  it('keeps hidden candidates anonymous in semantic model context', () => {
    const observation = relayObservation();
    const context = buildAiSemanticDecisionContext({
      observation: {
        ...observation,
        decision: {
          ...observation.decision,
          candidates: [{ candidateId: 'blind-1', hidden: true }],
          actions: [],
        },
      },
      selectedHistory: [],
    });

    const serialized = JSON.stringify(context);
    expect(serialized).toContain('身份不可见的候选');
    expect(serialized).not.toContain('secret-card-code');
    expect(serialized).not.toContain('secret-card-name');
  });
});
