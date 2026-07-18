import { describe, expect, it } from 'vitest';
import {
  confirmActiveEffectStep,
  enqueueTriggeredCardEffects,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import {
  PL_BP4_020_CONTINUOUS_SUCCESS_ZONE_CENTER_MUSE_GAIN_BLADE_ABILITY_ID as CONTINUOUS,
  PL_BP4_020_LIVE_START_ONLY_MUSE_STAGE_TARGET_MEMBER_POSITION_CHANGE_ABILITY_ID as LIVE_START,
} from '../../src/application/card-effects/ability-ids';
import { getCardAbilityDefinitionsForCardCode } from '../../src/application/card-effects/definitions/lookup';
import {
  createCardInstance,
  createHeartIcon,
  createHeartRequirement,
  type LiveCardData,
  type MemberCardData,
} from '../../src/domain/entities/card';
import {
  createGameState,
  registerCards,
  updatePlayer,
  type GameState,
  type PendingAbilityState,
} from '../../src/domain/entities/game';
import { addCardToZone, placeCardInSlot } from '../../src/domain/entities/zone';
import { parseCardEffectText } from '../../client/src/lib/cardEffectTokens';
import {
  CardType,
  FaceState,
  HeartColor,
  OrientationState,
  SlotPosition,
  TriggerCondition,
} from '../../src/shared/types/enums';

const P1 = 'p1';
const P2 = 'p2';
const LIVE_TEXT =
  "【LIVE开始时】存在于自己的舞台的成员均为『μ's』的成员的场合，可以使1名存在于自己的舞台的成员进行站位变换。";
const CONTINUOUS_TEXT =
  "【常时】只要此卡存在于自己的成功LIVE卡区，存在于自己的中央区域的『μ's』的成员获得[ブレード]。";

function live(cardCode = 'PL!-bp4-020-L', ownerGroup: readonly string[] = ["μ's"]): LiveCardData {
  return {
    cardCode,
    name: 'Love wing bell',
    groupNames: ownerGroup,
    cardType: CardType.LIVE,
    score: 3,
    requirements: createHeartRequirement({ [HeartColor.PINK]: 3 }),
  };
}

function member(cardCode: string, groupNames: readonly string[], blade = 1): MemberCardData {
  return {
    cardCode,
    name: cardCode,
    groupNames,
    cardType: CardType.MEMBER,
    cost: 5,
    blade,
    hearts: [createHeartIcon(HeartColor.PINK, 1)],
  };
}

function pending(sourceCardId: string, id = 'pending-020'): PendingAbilityState {
  return {
    id,
    abilityId: LIVE_START,
    sourceCardId,
    controllerId: P1,
    mandatory: true,
    timingId: TriggerCondition.ON_LIVE_START,
    eventIds: [`event-${id}`],
  };
}

function setup(
  options: {
    readonly groups?: readonly (readonly string[])[];
    readonly orientations?: readonly OrientationState[];
    readonly sourceOwner?: string;
    readonly sourceZone?: 'LIVE' | 'HAND' | 'SUCCESS';
    readonly sourceCardCode?: string;
    readonly sourceIsMember?: boolean;
  } = {}
) {
  const source = options.sourceIsMember
    ? createCardInstance(
        member(options.sourceCardCode ?? 'PL!-bp4-020-L', ["μ's"]),
        options.sourceOwner ?? P1,
        'love-wing'
      )
    : createCardInstance(live(options.sourceCardCode), options.sourceOwner ?? P1, 'love-wing');
  const groups = options.groups ?? [["μ's"], ['μ’s']];
  const members = groups.map((group, index) =>
    createCardInstance(member(`MEMBER-${index}`, group), P1, `member-${index}`)
  );
  const below = createCardInstance(member('BELOW', ['Aqours']), P1, 'below');
  const opponent = createCardInstance(member('OPPONENT', ['Aqours']), P2, 'opponent');
  let game = registerCards(createGameState('bp4-020', P1, 'P1', P2, 'P2'), [
    source,
    ...members,
    below,
    opponent,
  ]);
  game = updatePlayer(game, P1, (player) => {
    let memberSlots = player.memberSlots;
    members.forEach((card, index) => {
      memberSlots = placeCardInSlot(
        memberSlots,
        [SlotPosition.LEFT, SlotPosition.CENTER, SlotPosition.RIGHT][index],
        card.instanceId,
        {
          orientation: options.orientations?.[index] ?? OrientationState.ACTIVE,
          face: FaceState.FACE_UP,
        }
      );
    });
    memberSlots = {
      ...memberSlots,
      memberBelow: { ...memberSlots.memberBelow, [SlotPosition.LEFT]: [below.instanceId] },
    };
    const sourceZone = options.sourceZone ?? 'LIVE';
    return {
      ...player,
      memberSlots,
      liveZone:
        sourceZone === 'LIVE' ? addCardToZone(player.liveZone, source.instanceId) : player.liveZone,
      successZone:
        sourceZone === 'SUCCESS'
          ? addCardToZone(player.successZone, source.instanceId)
          : player.successZone,
      hand:
        sourceZone === 'HAND'
          ? { ...player.hand, cardIds: [...player.hand.cardIds, source.instanceId] }
          : player.hand,
    };
  });
  game = updatePlayer(game, P2, (player) => ({
    ...player,
    memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, opponent.instanceId),
  }));
  return { game, source, members, below, opponent };
}

function start(game: GameState): GameState {
  return resolvePendingCardEffects(game).gameState;
}

function chooseMember(game: GameState, cardId: string | null | undefined): GameState {
  return confirmActiveEffectStep(game, P1, game.activeEffect!.id, cardId);
}

function chooseSlot(game: GameState, slot: SlotPosition | null): GameState {
  return confirmActiveEffectStep(game, P1, game.activeEffect!.id, undefined, slot);
}

describe('PL!-bp4-020-L 分数3「Love wing bell」', () => {
  it('登记精确两条 implemented definition 与分段 Excel 中文', () => {
    const definitions = getCardAbilityDefinitionsForCardCode('PL!-bp4-020-L').filter(
      (definition) => definition.implemented
    );
    expect(definitions).toHaveLength(2);
    expect(definitions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          abilityId: LIVE_START,
          baseCardCodes: ['PL!-bp4-020'],
          category: 'LIVE_START',
          sourceZone: 'LIVE_CARD',
          triggerCondition: TriggerCondition.ON_LIVE_START,
          queued: true,
          effectText: LIVE_TEXT,
        }),
        expect.objectContaining({
          abilityId: CONTINUOUS,
          baseCardCodes: ['PL!-bp4-020'],
          category: 'CONTINUOUS',
          sourceZone: 'SUCCESS_LIVE_CARD',
          queued: false,
          effectText: CONTINUOUS_TEXT,
        }),
      ])
    );
    expect(
      parseCardEffectText(CONTINUOUS_TEXT).filter((part) => part.kind === 'blade')
    ).toHaveLength(1);
  });

  it('通过真实 ON_LIVE_START enqueue 产生正确 pending 并且单目标仍不自动发动', () => {
    const scenario = setup({ groups: [["μ's"]] });
    const queued = enqueueTriggeredCardEffects(scenario.game, [TriggerCondition.ON_LIVE_START]);
    expect(queued.pendingAbilities).toContainEqual(
      expect.objectContaining({
        abilityId: LIVE_START,
        sourceCardId: scenario.source.instanceId,
        controllerId: P1,
        timingId: TriggerCondition.ON_LIVE_START,
      })
    );
    const started = start(queued);
    expect(started.activeEffect).toMatchObject({
      selectableCardIds: [scenario.members[0].instanceId],
      canSkipSelection: true,
      skipSelectionLabel: '不发动',
    });
  });

  it.each([
    [[["μ's"]], true],
    [[['μ’s'], ["μ's"]], true],
    [[["μ's"], ["μ's"], ['μ’s']], true],
    [[["μ's"], ['Aqours']], false],
    [[['Aqours']], false],
    [[], false],
  ] as const)('按己方顶层结构化团体判断 groups=%j', (groups, expected) => {
    const scenario = setup({ groups });
    const resolved = start({
      ...scenario.game,
      pendingAbilities: [pending(scenario.source.instanceId)],
    });
    expect(Boolean(resolved.activeEffect?.selectableCardIds)).toBe(expected);
  });

  it("忽略 memberBelow 与对方非 μ's，ACTIVE / WAITING 都可选", () => {
    const scenario = setup({ orientations: [OrientationState.ACTIVE, OrientationState.WAITING] });
    const started = start({
      ...scenario.game,
      pendingAbilities: [pending(scenario.source.instanceId)],
    });
    expect(started.activeEffect?.selectableCardIds).toEqual(
      scenario.members.map((card) => card.instanceId)
    );
    expect(started.activeEffect?.selectableCardIds).not.toContain(scenario.below.instanceId);
    expect(started.activeEffect?.selectableCardIds).not.toContain(scenario.opponent.instanceId);
  });

  it('明确不发动不移动且继续', () => {
    const scenario = setup();
    const started = start({
      ...scenario.game,
      pendingAbilities: [pending(scenario.source.instanceId)],
    });
    const resolved = chooseMember(started, null);
    expect(resolved.activeEffect).toBeNull();
    expect(resolved.players[0].memberSlots.slots[SlotPosition.LEFT]).toBe('member-0');
    expect(
      resolved.eventLog.filter(
        (entry) => entry.event.eventType === TriggerCondition.ON_MEMBER_SLOT_MOVED
      )
    ).toEqual([]);
  });

  it('对方、memberBelow、离场与未列出 ID 不关窗', () => {
    const scenario = setup();
    const started = start({
      ...scenario.game,
      pendingAbilities: [pending(scenario.source.instanceId)],
    });
    for (const id of [scenario.opponent.instanceId, scenario.below.instanceId, 'missing']) {
      expect(chooseMember(started, id).activeEffect).not.toBeNull();
    }
  });

  it('移动到空槽并产生真实 MEMBER_SLOT_MOVED 事件', () => {
    const scenario = setup({ groups: [["μ's"]] });
    const started = start({
      ...scenario.game,
      pendingAbilities: [pending(scenario.source.instanceId)],
    });
    const slotStep = chooseMember(started, scenario.members[0].instanceId);
    expect(slotStep.activeEffect).toMatchObject({
      selectableCardIds: undefined,
      selectableOptions: undefined,
      canSkipSelection: false,
      selectableSlots: [SlotPosition.CENTER, SlotPosition.RIGHT],
    });
    const resolved = chooseSlot(slotStep, SlotPosition.RIGHT);
    expect(resolved.players[0].memberSlots.slots[SlotPosition.RIGHT]).toBe('member-0');
    expect(resolved.eventLog).toContainEqual(
      expect.objectContaining({
        event: expect.objectContaining({
          eventType: TriggerCondition.ON_MEMBER_SLOT_MOVED,
          cardInstanceId: 'member-0',
        }),
      })
    );
  });

  it('移动到占用槽时交换且保留双方移动事件', () => {
    const scenario = setup();
    const started = start({
      ...scenario.game,
      pendingAbilities: [pending(scenario.source.instanceId)],
    });
    const resolved = chooseSlot(
      chooseMember(started, scenario.members[0].instanceId),
      SlotPosition.CENTER
    );
    expect(resolved.players[0].memberSlots.slots[SlotPosition.LEFT]).toBe('member-1');
    expect(resolved.players[0].memberSlots.slots[SlotPosition.CENTER]).toBe('member-0');
    const moved = resolved.eventLog.filter(
      (entry) => entry.event.eventType === TriggerCondition.ON_MEMBER_SLOT_MOVED
    );
    expect(moved).toHaveLength(2);
  });

  it('第二步 null、当前槽与未列出槽不关窗', () => {
    const scenario = setup();
    const slotStep = chooseMember(
      start({ ...scenario.game, pendingAbilities: [pending(scenario.source.instanceId)] }),
      scenario.members[0].instanceId
    );
    expect(chooseSlot(slotStep, null).activeEffect).not.toBeNull();
    expect(chooseSlot(slotStep, SlotPosition.LEFT).activeEffect).not.toBeNull();
  });

  it('来源、团体条件或目标在确认前 stale 时清窗 no-op', () => {
    for (const stale of ['SOURCE', 'GROUP', 'TARGET'] as const) {
      const scenario = setup();
      const slotStep = chooseMember(
        start({ ...scenario.game, pendingAbilities: [pending(scenario.source.instanceId)] }),
        scenario.members[0].instanceId
      );
      const changed = updatePlayer(slotStep, P1, (player) => ({
        ...player,
        liveZone: stale === 'SOURCE' ? { ...player.liveZone, cardIds: [] } : player.liveZone,
        memberSlots:
          stale === 'GROUP'
            ? placeCardInSlot(player.memberSlots, SlotPosition.RIGHT, scenario.below.instanceId)
            : stale === 'TARGET'
              ? placeCardInSlot(player.memberSlots, SlotPosition.LEFT, null)
              : player.memberSlots,
      }));
      const resolved = chooseSlot(changed, SlotPosition.RIGHT);
      expect(resolved.activeEffect).toBeNull();
      expect(
        resolved.eventLog.filter(
          (entry) => entry.event.eventType === TriggerCondition.ON_MEMBER_SLOT_MOVED
        )
      ).toEqual([]);
    }
  });

  it('目标当前槽位变化时按权威位置刷新另外两槽', () => {
    const scenario = setup();
    const slotStep = chooseMember(
      start({ ...scenario.game, pendingAbilities: [pending(scenario.source.instanceId)] }),
      scenario.members[0].instanceId
    );
    const movedExternally = updatePlayer(slotStep, P1, (player) => ({
      ...player,
      memberSlots: placeCardInSlot(
        placeCardInSlot(player.memberSlots, SlotPosition.LEFT, null),
        SlotPosition.RIGHT,
        scenario.members[0].instanceId
      ),
    }));
    const refreshed = chooseSlot(movedExternally, SlotPosition.RIGHT);
    expect(refreshed.activeEffect?.selectableSlots).toEqual([
      SlotPosition.LEFT,
      SlotPosition.CENTER,
    ]);
  });

  it.each([
    ['wrong owner', { sourceOwner: P2 }],
    ['wrong zone', { sourceZone: 'HAND' as const }],
    ['success zone', { sourceZone: 'SUCCESS' as const }],
    ['wrong base', { sourceCardCode: 'PL!-bp4-019-L' }],
    ['non LIVE', { sourceIsMember: true }],
  ])('非法来源 %s 不进入交互', (_label, options) => {
    const scenario = setup(options);
    const resolved = start({
      ...scenario.game,
      pendingAbilities: [pending(scenario.source.instanceId)],
    });
    expect(resolved.activeEffect).toBeNull();
    expect(resolved.pendingAbilities).toEqual([]);
  });

  it('条件不满足时 ordered 安全 no-op，手动点选复用实时 confirm-only bridge', () => {
    const first = setup({ groups: [['Aqours']] });
    const secondSource = createCardInstance(live(), P1, 'love-wing-second');
    let game = registerCards(first.game, [secondSource]);
    game = updatePlayer(game, P1, (player) => ({
      ...player,
      liveZone: addCardToZone(player.liveZone, secondSource.instanceId),
    }));
    const pendingAbilities = [
      pending(first.source.instanceId, 'pending-first'),
      pending(secondSource.instanceId, 'pending-second'),
    ];

    const orderedChoice = start({ ...game, pendingAbilities });
    expect(orderedChoice.activeEffect?.canResolveInOrder).toBe(true);
    const ordered = confirmActiveEffectStep(
      orderedChoice,
      P1,
      orderedChoice.activeEffect!.id,
      undefined,
      undefined,
      true
    );
    expect(ordered.activeEffect).toBeNull();
    expect(ordered.pendingAbilities).toEqual([]);

    const manualChoice = start({ ...game, pendingAbilities });
    const preview = confirmActiveEffectStep(
      manualChoice,
      P1,
      manualChoice.activeEffect!.id,
      secondSource.instanceId
    );
    expect(preview.activeEffect).toMatchObject({
      abilityId: LIVE_START,
      sourceCardId: secondSource.instanceId,
      metadata: { confirmOnlyPendingAbility: true },
    });
    expect(preview.activeEffect?.effectText).toContain(
      "不均为『μ's』的成员，未进行站位变换"
    );
    const afterConfirm = confirmActiveEffectStep(preview, P1, preview.activeEffect!.id);
    expect(afterConfirm.pendingAbilities).toEqual([]);
    expect(afterConfirm.activeEffect).toBeNull();
  });
});
