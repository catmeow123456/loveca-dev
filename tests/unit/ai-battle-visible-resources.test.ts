import { describe, expect, it } from 'vitest';
import {
  describeAiActivationResources,
  describeAiMemberPlay,
  summarizeAiSelfResources,
} from '../../src/server/ai-battle/visible-resources';
import type { PlayerViewState, ViewCardObject, ViewZoneState } from '../../src/online/types';
import { CardType, HeartColor, OrientationState } from '../../src/shared/types/enums';

describe('AI visible resource subtotals', () => {
  it('summarizes only own waiting-room fronts, grouping identical printings and distinguishing cost from score', () => {
    const memberFront = {
      cardCode: 'PL!N-bp4-017-N',
      nameCn: '宫下爱',
      cardType: CardType.MEMBER,
      cost: 2,
    };
    const liveFront = {
      cardCode: 'PL!N-bp4-030-L',
      nameCn: 'Daydream Mermaid',
      cardType: CardType.LIVE,
      score: 3,
    };
    const card = (id: string, frontInfo: ViewCardObject['frontInfo']): ViewCardObject => ({
      publicObjectId: id,
      ownerSeat: 'FIRST',
      controllerSeat: 'FIRST',
      surface: 'FRONT',
      frontInfo,
    });
    const view: Pick<PlayerViewState, 'table' | 'objects'> = {
      objects: {
        member1: card('member1', memberFront),
        member2: card('member2', memberFront),
        live: card('live', liveFront),
        hidden: {
          ...card('hidden', { ...liveFront, cardCode: 'HIDDEN-SENTINEL' }),
          surface: 'BACK',
        },
        opponent: card('opponent', { ...liveFront, cardCode: 'OPPONENT-SENTINEL' }),
      },
      table: {
        zones: {
          SHARED_RESOLUTION_ZONE: {
            zone: 'RESOLUTION_ZONE',
            count: 0,
            ordered: false,
            objectIds: [],
          },
          FIRST_WAITING_ROOM: {
            zone: 'WAITING_ROOM',
            ownerSeat: 'FIRST',
            count: 5,
            ordered: false,
            objectIds: ['member1', 'member2', 'live', 'hidden'],
          },
          SECOND_WAITING_ROOM: {
            zone: 'WAITING_ROOM',
            ownerSeat: 'SECOND',
            count: 1,
            ordered: false,
            objectIds: ['opponent'],
          },
        },
      },
    };
    const before = globalThis.structuredClone(view);
    const summary = summarizeAiSelfResources(view, 'FIRST').waitingRoomSummary;
    expect(summary).toContain('成员 2 张：2宫下爱(PL!N-bp4-017-N)×2');
    expect(summary).toContain('LIVE 1 张：3Daydream Mermaid(PL!N-bp4-030-L)');
    expect(summary).toContain('未知正面 2 张');
    expect(summary).not.toContain('SENTINEL');
    expect(view).toEqual(before);
    const changed = globalThis.structuredClone(view);
    Object.assign(changed.table.zones.FIRST_WAITING_ROOM, {
      count: 2,
      objectIds: ['member1', 'member2'],
    });
    expect(summarizeAiSelfResources(changed, 'FIRST').waitingRoomSummary).toBe(
      '己方休息室：成员 2 张：2宫下爱(PL!N-bp4-017-N)×2；LIVE 0 张'
    );
    Object.assign(changed.table.zones.FIRST_WAITING_ROOM, { count: 0, objectIds: [] });
    expect(summarizeAiSelfResources(changed, 'FIRST').waitingRoomSummary).toBe(
      '己方休息室：成员 0 张；LIVE 0 张'
    );
  });

  it('describes source costs and the existing target query without claiming recovery or removing empty choices', () => {
    const activation = {
      costs: [{ kind: 'SEND_SOURCE_MEMBER_TO_WAITING_ROOM' as const }],
      destination: 'HAND' as const,
      targets: [],
    };
    const before = globalThis.structuredClone(activation);
    expect(describeAiActivationResources(activation)).toContain('来源成员送入休息室');
    expect(describeAiActivationResources(activation)).toContain('支付后可见回手目标 0 张');
    expect(activation).toEqual(before);
    expect(
      describeAiActivationResources({
        ...activation,
        targets: [{ objectId: 'visible-live' }],
      })
    ).toContain('支付后可见回手目标 1 张（尚未选择或取得）');
  });

  it('compares visible values once, including duplicated colors and losses, without forecasting effects', () => {
    const incoming = {
      cardCode: 'INCOMING',
      cardType: CardType.MEMBER,
      cost: 4,
      blade: 1,
      hearts: [
        { color: HeartColor.PINK, count: 1 },
        { color: HeartColor.PINK, count: 1 },
      ],
      cardTextCn: '【登场】条件效果',
    };
    const outgoing = {
      cardCode: 'OUTGOING',
      cardType: CardType.MEMBER,
      cost: 9,
      blade: 3,
      hearts: [
        { color: HeartColor.PINK, count: 3 },
        { color: HeartColor.PURPLE, count: 1 },
      ],
      modifierDelta: { heartDeltas: [{ color: HeartColor.PINK, count: 2 }], bladeDelta: 2 },
    };
    const before = globalThis.structuredClone({ incoming, outgoing });
    const description = describeAiMemberPlay(incoming, outgoing);
    expect(description).toContain('手牌打出 1 张（未计卡效）');
    expect(description).toContain('HEART -2（PINK -1、PURPLE -1）／BLADE -2');
    expect(description).toContain('舞台顶层成员印刷总费用变化 -5');
    expect(description).toContain('未预结算卡效、常时条件或朝向变化');
    expect({ incoming, outgoing }).toEqual(before);
    expect(describeAiMemberPlay(incoming)).toContain('HEART +2（PINK +2）／BLADE +1');
    expect(describeAiMemberPlay(incoming)).toContain('舞台顶层成员印刷总费用变化 +4');
  });

  it('counts only own top-level stage and active energy, using effective hearts/blades once', () => {
    const member = (
      id: string,
      count: number,
      orientation = OrientationState.ACTIVE
    ): ViewCardObject => ({
      publicObjectId: id,
      ownerSeat: 'SECOND',
      controllerSeat: 'SECOND',
      surface: 'FRONT',
      orientation,
      frontInfo: {
        cardCode: id,
        cardType: CardType.MEMBER,
        cost: 4,
        hearts: [{ color: HeartColor.PINK, count }],
        blade: count,
        modifierDelta: { heartDeltas: [{ color: HeartColor.PINK, count: 9 }], bladeDelta: 9 },
      },
    });
    const stage = (ownerSeat: 'FIRST' | 'SECOND', id: string, slot = 'LEFT'): ViewZoneState => ({
      zone: 'MEMBER_SLOT',
      ownerSeat,
      count: 1,
      ordered: false,
      slotMap: { [slot]: id },
      memberBelow: { LEFT: ['below'] },
    });
    const view: Pick<PlayerViewState, 'table' | 'objects'> = {
      objects: {
        own: member('own', 2),
        waiting: member('waiting', 3, OrientationState.WAITING),
        opponent: member('opponent', 7),
        hand: member('hand', 11),
        below: member('below', 13),
        activeEnergy: {
          publicObjectId: 'activeEnergy',
          ownerSeat: 'SECOND',
          controllerSeat: 'SECOND',
          surface: 'BACK',
          orientation: OrientationState.ACTIVE,
        },
        waitingEnergy: {
          publicObjectId: 'waitingEnergy',
          ownerSeat: 'SECOND',
          controllerSeat: 'SECOND',
          surface: 'BACK',
          orientation: OrientationState.WAITING,
        },
      },
      table: {
        zones: {
          SECOND_MEMBER_LEFT: stage('SECOND', 'own'),
          SECOND_MEMBER_CENTER: stage('SECOND', 'waiting', 'CENTER'),
          SHARED_RESOLUTION_ZONE: {
            zone: 'RESOLUTION_ZONE',
            count: 0,
            ordered: false,
            objectIds: [],
          },
          FIRST_MEMBER_LEFT: stage('FIRST', 'opponent'),
          SECOND_HAND: {
            zone: 'HAND',
            ownerSeat: 'SECOND',
            count: 1,
            ordered: false,
            objectIds: ['hand'],
          },
          SECOND_ENERGY_ZONE: {
            zone: 'ENERGY_ZONE',
            ownerSeat: 'SECOND',
            count: 2,
            ordered: false,
            objectIds: ['activeEnergy', 'waitingEnergy'],
          },
          SECOND_SUCCESS_ZONE: {
            zone: 'SUCCESS_ZONE',
            ownerSeat: 'SECOND',
            count: 2,
            ordered: false,
          },
        },
      },
    };
    const before = globalThis.structuredClone(view);
    const summary = summarizeAiSelfResources(view, 'SECOND');
    expect(summary.stageMembers.map((card) => card.objectId)).toEqual(['own', 'waiting']);
    expect(summary).toMatchObject({
      stageHeartCounts: { PINK: 5 },
      stageHeartTotal: 5,
      activeMemberBladeTotal: 2,
      activeEnergyCount: 1,
      successfulLiveCount: 2,
      handCards: [
        { objectId: 'hand', cardCode: 'hand', cardType: CardType.MEMBER, printedCost: 4 },
      ],
      handLiveCount: 0,
    });
    expect(view).toEqual(before);
    const changed = globalThis.structuredClone(view);
    Object.assign(changed.objects.opponent!, { frontInfo: member('opponent', 999).frontInfo });
    Object.assign(changed.objects.hand!, { frontInfo: member('hand', 999).frontInfo });
    expect(summarizeAiSelfResources(changed, 'SECOND')).toEqual(summary);
  });

  it('counts LIVE only in the current visible own hand, excluding other zones and hidden faces', () => {
    const live = (id: string): ViewCardObject => ({
      publicObjectId: id,
      ownerSeat: 'SECOND',
      controllerSeat: 'SECOND',
      surface: 'FRONT',
      frontInfo: {
        cardCode: id,
        nameCn: '可见 LIVE',
        cardType: CardType.LIVE,
        score: 3,
        requiredHearts: { totalRequired: 7, colorRequirements: {} },
      },
    });
    const zone = (
      type: 'HAND' | 'LIVE_ZONE',
      ownerSeat: 'FIRST' | 'SECOND',
      objectIds: string[]
    ): ViewZoneState => ({
      zone: type,
      ownerSeat,
      count: objectIds.length,
      ordered: false,
      objectIds,
    });
    const own = live('own-live');
    const hidden = { ...live('hidden-live'), surface: 'BACK' as const };
    const view: Pick<PlayerViewState, 'table' | 'objects'> = {
      objects: { own, staged: live('staged-live'), opponent: live('opponent-live'), hidden },
      table: {
        zones: {
          SECOND_HAND: zone('HAND', 'SECOND', ['own', 'hidden']),
          SECOND_LIVE_ZONE: zone('LIVE_ZONE', 'SECOND', ['staged']),
          FIRST_HAND: zone('HAND', 'FIRST', ['opponent']),
          SHARED_RESOLUTION_ZONE: {
            zone: 'RESOLUTION_ZONE',
            count: 0,
            ordered: false,
            objectIds: [],
          },
        },
      },
    };
    const summary = summarizeAiSelfResources(view, 'SECOND');
    expect(summary.handLiveCount).toBe(1);
    expect(summary.handCards).toEqual([
      {
        objectId: 'own',
        cardCode: 'own-live',
        name: '可见 LIVE',
        cardType: CardType.LIVE,
        printedCost: undefined,
        score: 3,
        requiredHearts: own.frontInfo!.requiredHearts,
        liveBaseBudget: {
          basis: 'CURRENT_STAGE_MEMBERS_VS_BASE_REQUIREMENT',
          score: 3,
          requiredHearts: own.frontInfo!.requiredHearts,
          stageHeartCounts: {},
          missingHearts: { RAINBOW: 7 },
          stageAloneMeetsBaseRequirement: false,
        },
      },
    ]);
    const afterMove = {
      ...view,
      table: {
        zones: {
          ...view.table.zones,
          SECOND_HAND: zone('HAND', 'SECOND', ['hidden']),
          SECOND_LIVE_ZONE: zone('LIVE_ZONE', 'SECOND', ['staged', 'own']),
        },
      },
    };
    expect(summarizeAiSelfResources(afterMove, 'SECOND').handLiveCount).toBe(0);
    expect(summarizeAiSelfResources(afterMove, 'SECOND').handCards).toEqual([]);
  });
});
