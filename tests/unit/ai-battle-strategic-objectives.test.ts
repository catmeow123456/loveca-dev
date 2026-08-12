import { describe, expect, it } from 'vitest';
import {
  AI_OBSERVATION_SCHEMA_VERSION,
  type AiObservation,
} from '../../src/server/ai-battle/ai-observation';
import {
  AI_STRATEGIC_OBJECTIVES_SCHEMA_VERSION,
  createAiStrategicObjectiveTracker,
} from '../../src/server/ai-battle/strategic-objectives';
import { SlotPosition } from '../../src/shared/types/enums';

function observation(input?: {
  readonly turnCount?: number;
  readonly handHasLive?: boolean;
  readonly stageMemberCount?: number;
  readonly withEnergyChoice?: boolean;
}): AiObservation {
  const stageMemberCount = input?.stageMemberCount ?? 1;
  const memberCard = {
    cardCode: 'PL!HS-sd1-012-SD',
    name: '百生吟子',
    cardType: 'MEMBER',
    cost: 4,
  } as const;
  return {
    schemaVersion: AI_OBSERVATION_SCHEMA_VERSION,
    decisionContractSchemaVersion: 'ai-battle.decision-contract/v1',
    commandAdapterVersion: 'ai-battle.decision-command-adapter/v1',
    authorityRevision: 10,
    viewerSeat: 'FIRST',
    turn: {
      count: input?.turnCount ?? 1,
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
            zoneKey: 'HAND',
            zoneType: 'HAND',
            count: input?.handHasLive ? 1 : 0,
            ordered: false,
            visibleCards: input?.handHasLive
              ? [
                  {
                    cardCode: 'PL!HS-bp2-022-L+',
                    name: 'AOKUHARUKA',
                    cardType: 'LIVE',
                    score: 2,
                  },
                ]
              : [],
          },
          {
            zoneKey: 'LIVE',
            zoneType: 'LIVE',
            count: 0,
            ordered: true,
            visibleCards: [],
          },
          ...(['LEFT', 'CENTER', 'RIGHT'] as const).map((slot, index) => ({
            zoneKey: `MEMBER_${slot}`,
            zoneType: 'MEMBER_SLOT',
            count: index < stageMemberCount ? 1 : 0,
            ordered: false,
            visibleCards: index < stageMemberCount ? [memberCard] : [],
          })),
          {
            zoneKey: 'ENERGY',
            zoneType: 'ENERGY',
            count: 5,
            ordered: false,
            visibleCards: Array.from({ length: 5 }, (_, index) => ({
              cardCode: `ENERGY-${String(index)}`,
              name: '能量',
              cardType: 'ENERGY',
              orientation: 'ACTIVE',
            })),
          },
        ],
      },
      SECOND: { successLiveCount: 0, successLiveScore: 0, zones: [] },
    },
    sharedZones: [],
    decision: {
      decisionRef: 'current-decision',
      kind: 'MAIN_PHASE',
      mandatory: true,
      candidates: input?.withEnergyChoice
        ? [
            { candidateId: 'member-a', hidden: false, card: memberCard },
            { candidateId: 'member-b', hidden: false, card: memberCard },
          ]
        : [],
      options: [],
      actions: input?.withEnergyChoice
        ? [
            {
              actionId: 'relay',
              kind: 'PLAY_MEMBER',
              candidateId: 'member-a',
              targetSlot: SlotPosition.LEFT,
              paymentPreview: {
                modifiedCost: 4,
                energyCost: 2,
                relayDiscount: 2,
                replacementCount: 1,
              },
            },
            {
              actionId: 'expand',
              kind: 'PLAY_MEMBER',
              candidateId: 'member-b',
              targetSlot: SlotPosition.CENTER,
              paymentPreview: {
                modifiedCost: 4,
                energyCost: 4,
                relayDiscount: 0,
                replacementCount: 0,
              },
            },
          ]
        : [{ actionId: 'end', kind: 'END_MAIN_PHASE' }],
    },
  };
}

describe('AI battle strategic objectives', () => {
  it('retains server-derived objectives across windows while refreshing visible evidence', () => {
    const tracker = createAiStrategicObjectiveTracker('FIRST');
    const first = tracker.observe(observation());
    const second = tracker.observe(observation({ handHasLive: true, stageMemberCount: 2 }));

    expect(first.schemaVersion).toBe(AI_STRATEGIC_OBJECTIVES_SCHEMA_VERSION);
    expect(first.items.find((item) => item.kind === 'MAINTAIN_LIVE_ACCESS')).toMatchObject({
      source: 'SERVER_DERIVED',
      createdTurnCount: 1,
      priority: 'HIGH',
    });
    expect(second.items.find((item) => item.kind === 'MAINTAIN_LIVE_ACCESS')).toMatchObject({
      createdTurnCount: 1,
      summary: expect.stringContaining('至少保留'),
    });
    expect(second.items.find((item) => item.kind === 'MAINTAIN_STAGE_DEVELOPMENT')).toMatchObject({
      createdTurnCount: 1,
      summary: expect.stringContaining('保留已经形成'),
    });
  });

  it('derives and carries an energy-efficiency objective for a same-turn relay choice', () => {
    const tracker = createAiStrategicObjectiveTracker('FIRST');
    const compared = tracker.observe(observation({ withEnergyChoice: true }));
    const carried = tracker.observe(observation());

    expect(
      compared.items.find((item) => item.kind === 'PRESERVE_ENERGY_EFFICIENCY')
    ).toMatchObject({
      source: 'SERVER_DERIVED',
      evidence: expect.arrayContaining([expect.stringContaining('2～4')]),
    });
    expect(
      carried.items.find((item) => item.kind === 'PRESERVE_ENERGY_EFFICIENCY')
    ).toMatchObject({
      createdTurnCount: 1,
      summary: expect.stringContaining('此前存在更省能量的换手路线'),
    });
  });
});
