import { describe, expect, it } from 'vitest';
import type { AiObservation } from '../../src/server/ai-battle/ai-observation';
import {
  AI_STRATEGIC_OBJECTIVES_SCHEMA_VERSION,
  createAiStrategicObjectiveTracker,
} from '../../src/server/ai-battle/strategic-objectives';
import { SlotPosition } from '../../src/shared/types/enums';
import {
  createAiObservationFixture,
  createAiObservedZone,
} from '../helpers/ai-battle/observation-builder';

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
  return createAiObservationFixture({
    authorityRevision: 10,
    turn: {
      count: input?.turnCount ?? 1,
      phase: 'MAIN_PHASE',
      subPhase: 'FREE_ACTION',
      firstSeat: 'FIRST',
      activeSeat: 'FIRST',
      prioritySeat: 'FIRST',
    },
    firstSeat: {
      zones: [
        createAiObservedZone({
          zoneKey: 'HAND',
          zoneType: 'HAND',
          count: input?.handHasLive ? 1 : 0,
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
        }),
        createAiObservedZone({
          zoneKey: 'LIVE',
          zoneType: 'LIVE',
          ordered: true,
        }),
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
  });
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
    const liveAccess = second.items.find((item) => item.kind === 'MAINTAIN_LIVE_ACCESS');
    expect(liveAccess).toMatchObject({
      createdTurnCount: 1,
    });
    expect(liveAccess?.summary).toContain('至少保留');
    const stageDevelopment = second.items.find(
      (item) => item.kind === 'MAINTAIN_STAGE_DEVELOPMENT'
    );
    expect(stageDevelopment).toMatchObject({
      createdTurnCount: 1,
    });
    expect(stageDevelopment?.summary).toContain('保留已经形成');
  });

  it('derives and carries an energy-efficiency objective for a same-turn relay choice', () => {
    const tracker = createAiStrategicObjectiveTracker('FIRST');
    const compared = tracker.observe(observation({ withEnergyChoice: true }));
    const carried = tracker.observe(observation());

    const comparedEnergy = compared.items.find(
      (item) => item.kind === 'PRESERVE_ENERGY_EFFICIENCY'
    );
    expect(comparedEnergy).toMatchObject({ source: 'SERVER_DERIVED' });
    expect(comparedEnergy?.evidence.some((item) => item.includes('2～4'))).toBe(true);
    const carriedEnergy = carried.items.find((item) => item.kind === 'PRESERVE_ENERGY_EFFICIENCY');
    expect(carriedEnergy).toMatchObject({
      createdTurnCount: 1,
    });
    expect(carriedEnergy?.summary).toContain('此前存在更省能量的换手路线');
  });
});
