import { describe, expect, it } from 'vitest';
import {
  activateCardAbility,
  confirmActiveEffectStep,
} from '../../src/application/card-effect-runner';
import {
  N_BP7_006_ACTIVATED_MILL_TOP_THREE_CHOOSE_ENERGY_OR_BLADE_ABILITY_ID,
  N_BP7_006_ACTIVATED_PAY_ENERGY_INSPECT_TOP_FOUR_ABILITY_ID,
  SP_BP5_005_AUTO_MAIN_PHASE_CARD_ENTER_WAITING_ROOM_PAY_ENERGY_RECOVER_ABILITY_ID,
} from '../../src/application/card-effects/ability-ids';
import type { LiveCardData, MemberCardData } from '../../src/domain/entities/card';
import {
  createCardInstance,
  createHeartIcon,
  createHeartRequirement,
} from '../../src/domain/entities/card';
import {
  createGameState,
  registerCards,
  updatePlayer,
  type GameState,
} from '../../src/domain/entities/game';
import { placeCardInSlot } from '../../src/domain/entities/zone';
import { projectPlayerViewState } from '../../src/online/projector';
import { continuePublicEffectChoiceForTest } from '../helpers/public-effect-choice';
import {
  BladeHeartEffect,
  CardType,
  FaceState,
  GamePhase,
  HeartColor,
  OrientationState,
  SlotPosition,
  TriggerCondition,
} from '../../src/shared/types/enums';

const P1 = 'p1';
const P2 = 'p2';
const INSPECT = N_BP7_006_ACTIVATED_PAY_ENERGY_INSPECT_TOP_FOUR_ABILITY_ID;
const MILL = N_BP7_006_ACTIVATED_MILL_TOP_THREE_CHOOSE_ENERGY_OR_BLADE_ABILITY_ID;

function member(
  code: string,
  id: string,
  options: { readonly group?: string; readonly bladeHeart?: boolean } = {}
) {
  const data: MemberCardData = {
    cardCode: code,
    name: id,
    groupNames: [options.group ?? '虹ヶ咲'],
    cardType: CardType.MEMBER,
    cost: code === 'PL!N-bp7-006-SEC' ? 17 : 1,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.PINK, 1)],
    bladeHearts: options.bladeHeart ? [{ effect: BladeHeartEffect.DRAW }] : [],
  };
  return createCardInstance(data, P1, id);
}

function live(code: string, id: string, group = '虹ヶ咲') {
  const data: LiveCardData = {
    cardCode: code,
    name: id,
    groupNames: [group],
    cardType: CardType.LIVE,
    score: 1,
    requirements: createHeartRequirement({ [HeartColor.PINK]: 1 }),
  };
  return createCardInstance(data, P1, id);
}

function energy(index: number) {
  return createCardInstance(
    { cardCode: `ENERGY-${index}`, name: `Energy ${index}`, cardType: CardType.ENERGY },
    P1,
    `energy-${index}`
  );
}

function setup(
  options: {
    readonly deckCards?: readonly ReturnType<typeof member>[];
    readonly waitingCards?: readonly ReturnType<typeof member>[];
    readonly energyOrientations?: readonly OrientationState[];
    readonly specialEnergyIndex?: number;
    readonly waitingRoomWatcher?: boolean;
  } = {}
) {
  const source = member('PL!N-bp7-006-SEC', 'kanata');
  const watcher = options.waitingRoomWatcher
    ? member('PL!SP-bp5-005-R', 'waiting-room-watcher', { group: 'Liella!' })
    : null;
  const deckCards =
    options.deckCards ?? [0, 1, 2, 3, 4, 5].map((i) => member(`DECK-${i}`, `deck-${i}`));
  const waitingCards = options.waitingCards ?? [];
  const orientations = options.energyOrientations ?? [OrientationState.ACTIVE];
  const energies = orientations.map((_orientation, index) => energy(index));
  let game = registerCards(createGameState('n-bp7-006', P1, 'P1', P2, 'P2'), [
    source,
    ...(watcher ? [watcher] : []),
    ...deckCards,
    ...waitingCards,
    ...energies,
  ]);
  game = updatePlayer(game, P1, (player) => ({
    ...player,
    mainDeck: { ...player.mainDeck, cardIds: deckCards.map((card) => card.instanceId) },
    waitingRoom: { ...player.waitingRoom, cardIds: waitingCards.map((card) => card.instanceId) },
    memberSlots: watcher
      ? placeCardInSlot(
          placeCardInSlot(player.memberSlots, SlotPosition.CENTER, source.instanceId, {
            orientation: OrientationState.ACTIVE,
            face: FaceState.FACE_UP,
          }),
          SlotPosition.RIGHT,
          watcher.instanceId,
          { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }
        )
      : placeCardInSlot(player.memberSlots, SlotPosition.CENTER, source.instanceId, {
          orientation: OrientationState.ACTIVE,
          face: FaceState.FACE_UP,
        }),
    energyZone: {
      ...player.energyZone,
      cardIds: energies.map((card) => card.instanceId),
      cardStates: new Map(
        energies.map((card, index) => [
          card.instanceId,
          { orientation: orientations[index]!, face: FaceState.FACE_UP },
        ])
      ),
    },
  }));
  game = {
    ...game,
    currentPhase: GamePhase.MAIN_PHASE,
    activePlayerIndex: 0,
    ...(options.specialEnergyIndex === undefined
      ? {}
      : {
          energyActivePhaseSkips: [
            {
              playerId: P1,
              energyCardId: energies[options.specialEnergyIndex]!.instanceId,
              sourceCardId: 'marker-source',
              abilityId: 'marker-ability',
            },
          ],
        }),
  };
  return { game, source, watcher, deckCards, waitingCards, energies };
}

function confirmCards(game: GameState, cardIds: readonly string[]): GameState {
  return confirmActiveEffectStep(
    game,
    P1,
    game.activeEffect!.id,
    undefined,
    undefined,
    undefined,
    undefined,
    cardIds
  );
}

function choose(game: GameState, optionId: string): GameState {
  return continuePublicEffectChoiceForTest(
    confirmActiveEffectStep(
      game,
      P1,
      game.activeEffect!.id,
      undefined,
      undefined,
      undefined,
      optionId
    ),
    P1
  );
}

function confirmCurrent(game: GameState): GameState {
  return confirmActiveEffectStep(game, P1, game.activeEffect!.id);
}

function abilityUseCount(game: GameState, abilityId: string): number {
  return game.actionHistory.filter(
    (action) =>
      action.type === 'RESOLVE_ABILITY' &&
      action.payload.abilityId === abilityId &&
      action.payload.step === 'ABILITY_USE'
  ).length;
}

describe('PL!N-bp7-006-SEC 近江彼方', () => {
  it('支付[E]后私密检视顶4并按任意顺序回顶', () => {
    const { game, source, deckCards, energies } = setup();
    const inspecting = activateCardAbility(game, P1, source.instanceId, INSPECT);
    const originalTop = deckCards.slice(0, 4).map((card) => card.instanceId);

    expect(
      inspecting.players[0].energyZone.cardStates.get(energies[0]!.instanceId)?.orientation
    ).toBe(OrientationState.WAITING);
    expect(inspecting.activeEffect?.effectText).toContain('[E]');
    expect(inspecting.activeEffect).toMatchObject({
      inspectionCardIds: originalTop,
      selectionLabel: '按放置顺序选择卡片',
      confirmSelectionLabel: '按此顺序放置于卡组顶',
      minSelectableCards: 4,
      maxSelectableCards: 4,
    });
    expect(projectPlayerViewState(inspecting, P1).activeEffect?.selectableObjectIds).toHaveLength(
      4
    );
    expect(
      projectPlayerViewState(inspecting, P2).activeEffect?.selectableObjectIds
    ).toBeUndefined();

    const order = [originalTop[2]!, originalTop[0]!, originalTop[3]!, originalTop[1]!];
    const done = confirmCards(inspecting, order);
    expect(done.players[0].mainDeck.cardIds.slice(0, 4)).toEqual(order);
    expect(done.inspectionZone.cardIds).toEqual([]);
    expect(done.inspectionContext).toBeNull();
    expect(done.activeEffect).toBeNull();
    expect(abilityUseCount(done, INSPECT)).toBe(1);
  });

  it('能量不足不发动不消耗次数，成功后本回合不能第二次发动', () => {
    const none = setup({ energyOrientations: [] });
    expect(activateCardAbility(none.game, P1, none.source.instanceId, INSPECT)).toBe(none.game);
    expect(abilityUseCount(none.game, INSPECT)).toBe(0);

    const scenario = setup();
    const first = activateCardAbility(scenario.game, P1, scenario.source.instanceId, INSPECT);
    const done = confirmCards(first, first.activeEffect!.inspectionCardIds!);
    const second = activateCardAbility(done, P1, scenario.source.instanceId, INSPECT);
    expect(second).toBe(done);
    expect(abilityUseCount(second, INSPECT)).toBe(1);
  });

  it('少于4张与空卡组沿用 inspection 的实际检视与清理语义', () => {
    const twoCards = [member('SHORT-1', 'short-1'), member('SHORT-2', 'short-2')];
    const short = setup({ deckCards: twoCards });
    const inspecting = activateCardAbility(short.game, P1, short.source.instanceId, INSPECT);
    expect(inspecting.activeEffect?.inspectionCardIds).toEqual(
      twoCards.map((card) => card.instanceId)
    );
    expect(inspecting.activeEffect?.minSelectableCards).toBe(2);
    const shortDone = confirmCards(
      inspecting,
      [...twoCards].reverse().map((card) => card.instanceId)
    );
    expect(shortDone.players[0].mainDeck.cardIds).toEqual(
      [...twoCards].reverse().map((card) => card.instanceId)
    );

    const empty = setup({ deckCards: [] });
    const emptyDone = activateCardAbility(empty.game, P1, empty.source.instanceId, INSPECT);
    expect(emptyDone.activeEffect).toBeNull();
    expect(emptyDone.inspectionZone.cardIds).toEqual([]);
    expect(abilityUseCount(emptyDone, INSPECT)).toBe(1);
  });

  it('拒绝重复、遗漏、额外、非法与 stale inspection identity，重复确认不重复结算', () => {
    const { game, source } = setup();
    const inspecting = activateCardAbility(game, P1, source.instanceId, INSPECT);
    const ids = inspecting.activeEffect!.inspectionCardIds!;
    for (const bad of [
      [ids[0]!, ids[0]!, ids[2]!, ids[3]!],
      ids.slice(0, 3),
      [...ids, 'extra'],
      [ids[0]!, ids[1]!, ids[2]!, 'forged'],
    ]) {
      expect(confirmCards(inspecting, bad).activeEffect).toEqual(inspecting.activeEffect);
    }
    const stale = {
      ...inspecting,
      inspectionContext: { ...inspecting.inspectionContext!, ownerPlayerId: P2 },
    };
    expect(confirmCards(stale, ids).activeEffect).toEqual(stale.activeEffect);

    const done = confirmCards(inspecting, ids);
    const repeated = confirmActiveEffectStep(
      done,
      P1,
      inspecting.activeEffect!.id,
      undefined,
      undefined,
      undefined,
      undefined,
      ids
    );
    expect(repeated).toBe(done);
    expect(abilityUseCount(repeated, INSPECT)).toBe(1);
  });

  it('顶3费用不足时不预刷新；恰好3张时先产生一个分组事件再刷新且仍按原 movedCardIds 命中', () => {
    const shortCards = [member('SHORT-1', 'cost-short-1'), member('SHORT-2', 'cost-short-2')];
    const oldWaitingHit = live('OLD-HIT', 'old-hit');
    const short = setup({ deckCards: shortCards, waitingCards: [oldWaitingHit] });
    const rejected = activateCardAbility(short.game, P1, short.source.instanceId, MILL);
    expect(rejected).toBe(short.game);
    expect(abilityUseCount(rejected, MILL)).toBe(0);

    const costCards = [
      live('HIT-LIVE', 'hit-live'),
      member('FILL-1', 'cost-fill-1', { group: 'Aqours' }),
      member('FILL-2', 'cost-fill-2', { group: 'Aqours' }),
    ];
    const exact = setup({ deckCards: costCards });
    const choosing = activateCardAbility(exact.game, P1, exact.source.instanceId, MILL);
    const event = choosing.eventLog
      .map((entry) => entry.event)
      .find((candidate) => candidate.eventType === TriggerCondition.ON_ENTER_WAITING_ROOM);
    expect(event).toMatchObject({
      ownerId: P1,
      controllerId: P1,
      fromZone: 'MAIN_DECK',
      cardInstanceIds: costCards.map((card) => card.instanceId),
      cause: {
        kind: 'CARD_EFFECT',
        playerId: P1,
        sourceCardId: exact.source.instanceId,
        abilityId: MILL,
      },
    });
    expect(choosing.players[0].waitingRoom.cardIds).toEqual([]);
    expect(choosing.activeEffect?.selectableOptions?.map((option) => option.label)).toEqual([
      '将2张能量变为活跃状态',
      '获得[BLADE][BLADE]',
    ]);
    expect(choosing.activeEffect).toMatchObject({
      stepId: 'N_BP7_006_CHOOSE_ENERGY_OR_BLADE',
      confirmSelectionLabel: '结算所选效果',
      metadata: { conditionMet: true },
    });
    expect(choosing.activeEffect?.revealedCardIds).toEqual(
      costCards.map((card) => card.instanceId)
    );
    const publicMovedIds = costCards.map((card) => `obj_${card.instanceId}`);
    expect(projectPlayerViewState(choosing, P1).activeEffect?.revealedObjectIds).toEqual(
      publicMovedIds
    );
    expect(projectPlayerViewState(choosing, P2).activeEffect?.revealedObjectIds).toEqual(
      publicMovedIds
    );
  });

  it('未命中时先公开费用结果；恰好3张刷新仍保留原事实，确认后才推进 waiting-room pending', () => {
    const costCards = [0, 1, 2].map((i) =>
      member(`NON-HIT-${i}`, `non-hit-${i}`, { group: 'Aqours' })
    );
    const exact = setup({ deckCards: costCards, waitingRoomWatcher: true });
    const revealing = activateCardAbility(exact.game, P1, exact.source.instanceId, MILL);
    const movedCardIds = costCards.map((card) => card.instanceId);
    const publicMovedIds = movedCardIds.map((cardId) => `obj_${cardId}`);

    expect(revealing.players[0].waitingRoom.cardIds).toEqual([]);
    expect(revealing.activeEffect).toMatchObject({
      abilityId: MILL,
      stepId: 'N_BP7_006_REVEAL_MILL_COST_RESULT',
      revealedCardIds: movedCardIds,
      selectionLabel: '公开的卡片',
      confirmSelectionLabel: '确认公开结果',
      metadata: { movedCardIds, refreshCount: 1, conditionMet: false },
    });
    expect(projectPlayerViewState(revealing, P1).activeEffect?.revealedObjectIds).toEqual(
      publicMovedIds
    );
    expect(projectPlayerViewState(revealing, P2).activeEffect?.revealedObjectIds).toEqual(
      publicMovedIds
    );
    expect(
      revealing.pendingAbilities.some(
        (ability) =>
          ability.abilityId ===
          SP_BP5_005_AUTO_MAIN_PHASE_CARD_ENTER_WAITING_ROOM_PAY_ENERGY_RECOVER_ABILITY_ID
      )
    ).toBe(true);
    expect(
      revealing.actionHistory.filter(
        (action) =>
          action.payload.abilityId === MILL &&
          action.payload.step === 'FINISH_MILL_COST_CONDITION_NOT_MET'
      )
    ).toHaveLength(0);

    const eventCount = revealing.eventLog.filter(
      (entry) =>
        entry.event.eventType === TriggerCondition.ON_ENTER_WAITING_ROOM &&
        entry.event.cause?.abilityId === MILL
    ).length;
    const payCount = revealing.actionHistory.filter(
      (action) => action.type === 'PAY_COST' && action.payload.abilityId === MILL
    ).length;
    const done = confirmCurrent(revealing);
    expect(
      done.actionHistory.filter(
        (action) =>
          action.payload.abilityId === MILL &&
          action.payload.step === 'FINISH_MILL_COST_CONDITION_NOT_MET'
      )
    ).toHaveLength(1);
    expect(abilityUseCount(done, MILL)).toBe(1);
    expect(
      done.eventLog.filter(
        (entry) =>
          entry.event.eventType === TriggerCondition.ON_ENTER_WAITING_ROOM &&
          entry.event.cause?.abilityId === MILL
      )
    ).toHaveLength(eventCount);
    expect(
      done.actionHistory.filter(
        (action) => action.type === 'PAY_COST' && action.payload.abilityId === MILL
      )
    ).toHaveLength(payCount);
    expect(
      done.pendingAbilities.some(
        (ability) =>
          ability.abilityId ===
          SP_BP5_005_AUTO_MAIN_PHASE_CARD_ENTER_WAITING_ROOM_PAY_ENERGY_RECOVER_ABILITY_ID
      )
    ).toBe(false);

    const repeated = confirmActiveEffectStep(done, P1, revealing.activeEffect!.id);
    expect(repeated).toBe(done);
  });

  it('未刷新且未命中时也使用同一公开结果窗口', () => {
    const costCards = [0, 1, 2, 3].map((i) =>
      member(`NON-HIT-NO-REFRESH-${i}`, `non-hit-no-refresh-${i}`, { group: 'Aqours' })
    );
    const scenario = setup({ deckCards: costCards });
    const revealing = activateCardAbility(scenario.game, P1, scenario.source.instanceId, MILL);
    expect(revealing.activeEffect).toMatchObject({
      stepId: 'N_BP7_006_REVEAL_MILL_COST_RESULT',
      revealedCardIds: costCards.slice(0, 3).map((card) => card.instanceId),
      confirmSelectionLabel: '确认公开结果',
      metadata: { refreshCount: 0, conditionMet: false },
    });
    const done = confirmCurrent(revealing);
    expect(done.activeEffect).toBeNull();
    expect(abilityUseCount(done, MILL)).toBe(1);
  });

  it('命中只检查本次费用卡：虹咲LIVE或无BLADE HEART虹咲成员命中，其他不命中', () => {
    const cases = [
      { card: live('N-LIVE', 'case-live'), hit: true },
      { card: member('N-MEMBER', 'case-member'), hit: true },
      { card: member('N-BH', 'case-bh', { bladeHeart: true }), hit: false },
      { card: live('S-LIVE', 'case-other-live', 'Aqours'), hit: false },
      { card: member('S-MEMBER', 'case-other-member', { group: 'Aqours' }), hit: false },
    ];
    for (const entry of cases) {
      const deck = [
        entry.card,
        member('A', `${entry.card.instanceId}-a`, { group: 'Aqours' }),
        member('B', `${entry.card.instanceId}-b`, { group: 'Aqours' }),
        member('TAIL', `${entry.card.instanceId}-tail`, { group: 'Aqours' }),
      ];
      const scenario = setup({ deckCards: deck });
      const result = activateCardAbility(scenario.game, P1, scenario.source.instanceId, MILL);
      expect(result.activeEffect?.metadata?.conditionMet).toBe(entry.hit);
      expect(result.activeEffect?.stepId).toBe(
        entry.hit ? 'N_BP7_006_CHOOSE_ENERGY_OR_BLADE' : 'N_BP7_006_REVEAL_MILL_COST_RESULT'
      );
    }

    const oldHit = live('OLD-HIT', 'old-waiting-hit');
    const nonHitDeck = [0, 1, 2, 3].map((i) =>
      member(`OTHER-${i}`, `other-${i}`, { group: 'Aqours' })
    );
    const oldOnly = setup({ deckCards: nonHitDeck, waitingCards: [oldHit] });
    expect(
      activateCardAbility(oldOnly.game, P1, oldOnly.source.instanceId, MILL).activeEffect?.metadata
        ?.conditionMet
    ).toBe(false);
  });

  it('能量分支对0/1/2/超额 WAITING 与全部 ACTIVE 都按实际数量处理', () => {
    for (const count of [0, 1, 2, 3]) {
      const hitDeck = [
        live('HIT', `energy-hit-${count}`),
        ...[0, 1, 2].map((i) =>
          member(`TAIL-${count}-${i}`, `tail-${count}-${i}`, { group: 'Aqours' })
        ),
      ];
      const scenario = setup({
        deckCards: hitDeck,
        energyOrientations: Array.from({ length: count }, () => OrientationState.WAITING),
      });
      const done = choose(
        activateCardAbility(scenario.game, P1, scenario.source.instanceId, MILL),
        'activate-two-energy'
      );
      const expectedIds = scenario.energies
        .slice(0, Math.min(2, count))
        .map((card) => card.instanceId);
      expect(done.actionHistory.at(-1)?.payload.activatedEnergyCardIds).toEqual(expectedIds);
      expect(
        expectedIds.every(
          (id) =>
            done.players[0].energyZone.cardStates.get(id)?.orientation === OrientationState.ACTIVE
        )
      ).toBe(true);
    }

    const allActiveScenario = setup({
      deckCards: [
        live('HIT', 'all-active-hit'),
        ...[0, 1, 2].map((i) =>
          member(`ALL-ACTIVE-TAIL-${i}`, `all-active-tail-${i}`, { group: 'Aqours' })
        ),
      ],
      energyOrientations: Array.from({ length: 4 }, () => OrientationState.ACTIVE),
    });
    const allActiveDone = choose(
      activateCardAbility(allActiveScenario.game, P1, allActiveScenario.source.instanceId, MILL),
      'activate-two-energy'
    );
    expect(allActiveDone.activeEffect).toBeNull();
    expect(allActiveDone.actionHistory.at(-1)?.payload.activatedEnergyCardIds).toEqual([]);
    expect(
      allActiveScenario.energies.every(
        (energyCard) =>
          allActiveDone.players[0].energyZone.cardStates.get(energyCard.instanceId)?.orientation ===
          OrientationState.ACTIVE
      )
    ).toBe(true);
  });

  it('超额 WAITING 含特殊 marker 时打开标准精确选择，拒绝重复、非法与 stale ID', () => {
    const hitDeck = [
      live('HIT', 'marker-hit'),
      ...[0, 1, 2].map((i) => member(`TAIL-${i}`, `marker-tail-${i}`, { group: 'Aqours' })),
    ];
    const scenario = setup({
      deckCards: hitDeck,
      energyOrientations: [
        OrientationState.WAITING,
        OrientationState.WAITING,
        OrientationState.WAITING,
      ],
      specialEnergyIndex: 2,
    });
    const choosing = activateCardAbility(scenario.game, P1, scenario.source.instanceId, MILL);
    const energyWindow = choose(choosing, 'activate-two-energy');
    expect(energyWindow.activeEffect?.stepId).toBe('COMMON_ENERGY_OPERATION_SELECTION');
    expect(
      confirmCards(energyWindow, [
        scenario.energies[0]!.instanceId,
        scenario.energies[0]!.instanceId,
      ]).activeEffect
    ).toEqual(energyWindow.activeEffect);
    expect(
      confirmCards(energyWindow, [scenario.energies[0]!.instanceId, 'forged']).activeEffect
    ).toEqual(energyWindow.activeEffect);
    const stale = updatePlayer(energyWindow, P1, (player) => ({
      ...player,
      energyZone: {
        ...player.energyZone,
        cardStates: new Map(player.energyZone.cardStates).set(scenario.energies[1]!.instanceId, {
          orientation: OrientationState.ACTIVE,
          face: FaceState.FACE_UP,
        }),
      },
    }));
    expect(
      confirmCards(stale, [scenario.energies[0]!.instanceId, scenario.energies[1]!.instanceId])
        .activeEffect
    ).toEqual(stale.activeEffect);
    const done = confirmCards(energyWindow, [
      scenario.energies[1]!.instanceId,
      scenario.energies[2]!.instanceId,
    ]);
    expect(done.actionHistory.at(-1)?.payload.activatedEnergyCardIds).toEqual([
      scenario.energies[1]!.instanceId,
      scenario.energies[2]!.instanceId,
    ]);
  });

  it('BLADE分支向真实来源成员实例增加2，可叠加，来源失效时安全 no-op', () => {
    const hitDeck = [
      live('HIT-1', 'blade-hit-1'),
      member('TAIL-1', 'blade-tail-1', { group: 'Aqours' }),
      member('TAIL-2', 'blade-tail-2', { group: 'Aqours' }),
      live('HIT-2', 'blade-hit-2'),
      ...[3, 4, 5, 6].map((i) => member(`TAIL-${i}`, `blade-tail-${i}`, { group: 'Aqours' })),
    ];
    const scenario = setup({ deckCards: hitDeck });
    const first = choose(
      activateCardAbility(scenario.game, P1, scenario.source.instanceId, MILL),
      'gain-two-blade'
    );
    const secondChoosing = activateCardAbility(first, P1, scenario.source.instanceId, MILL);
    const second = choose(secondChoosing, 'gain-two-blade');
    expect(second.liveResolution.liveModifiers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sourceCardId: scenario.source.instanceId, countDelta: 2 }),
        expect.objectContaining({ sourceCardId: scenario.source.instanceId, countDelta: 2 }),
      ])
    );
    expect(abilityUseCount(second, MILL)).toBe(2);
    expect(activateCardAbility(second, P1, scenario.source.instanceId, MILL)).toBe(second);

    const fresh = setup({
      deckCards: hitDeck.map((card, i) =>
        member(`FRESH-${i}`, `fresh-${i}`, { group: i === 0 ? '虹ヶ咲' : 'Aqours' })
      ),
    });
    const choosing = activateCardAbility(fresh.game, P1, fresh.source.instanceId, MILL);
    const left = updatePlayer(choosing, P1, (player) => ({
      ...player,
      memberSlots: {
        ...player.memberSlots,
        slots: { ...player.memberSlots.slots, [SlotPosition.CENTER]: null },
      },
    }));
    const done = choose(left, 'gain-two-blade');
    expect(done.liveResolution.liveModifiers).toEqual([]);
    expect(done.activeEffect).toBeNull();
  });

  it('两条 activated identity 次数互不影响', () => {
    const deck = [
      live('HIT', 'independent-hit'),
      ...[0, 1, 2, 3, 4, 5, 6].map((i) =>
        member(`TAIL-${i}`, `independent-tail-${i}`, { group: 'Aqours' })
      ),
    ];
    const scenario = setup({ deckCards: deck, energyOrientations: [OrientationState.ACTIVE] });
    const inspected = activateCardAbility(scenario.game, P1, scenario.source.instanceId, INSPECT);
    const afterInspect = confirmCards(inspected, inspected.activeEffect!.inspectionCardIds!);
    const millChoosing = activateCardAbility(afterInspect, P1, scenario.source.instanceId, MILL);
    expect(millChoosing.activeEffect?.abilityId).toBe(MILL);
    expect(abilityUseCount(millChoosing, INSPECT)).toBe(1);
    expect(abilityUseCount(millChoosing, MILL)).toBe(1);
  });
});
