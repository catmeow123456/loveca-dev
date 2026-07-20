import { describe, expect, it } from 'vitest';
import { confirmActiveEffectStep, resolvePendingCardEffects } from '../../src/application/card-effect-runner';
import { N_BP7_005_ON_ENTER_DIVERDIVA_CHOOSE_ACTIVATE_TWO_OR_PLACE_ENERGY_BELOW_ABILITY_ID } from '../../src/application/card-effects/ability-ids';
import { createCardInstance, createHeartIcon } from '../../src/domain/entities/card';
import { createGameState, registerCards, updatePlayer, type GameState, type PendingAbilityState } from '../../src/domain/entities/game';
import { placeCardInSlot } from '../../src/domain/entities/zone';
import { CardType, FaceState, HeartColor, OrientationState, SlotPosition, TriggerCondition } from '../../src/shared/types/enums';

const P1 = 'p1';
const P2 = 'p2';
const ACTIVATE_OPTION = 'activate-two-energy';
const PLACE_OPTION = 'place-energy-below';

function member(code: string, id: string, name: string) {
  return createCardInstance({
    cardCode: code,
    name,
    groupNames: ['虹ヶ咲'],
    unitName: 'DiverDiva',
    cardType: CardType.MEMBER,
    cost: 5,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.RED, 1)],
  }, P1, id);
}

function setup(options: { readonly waitingEnergyCount?: number; readonly activeEnergyCount?: number; readonly energyDeckCount?: number } = {}) {
  const waitingEnergyCount = options.waitingEnergyCount ?? 1;
  const activeEnergyCount = options.activeEnergyCount ?? 0;
  const energyDeckCount = options.energyDeckCount ?? 1;
  const ai = member('PL!N-bp7-005-P', 'ai', '宮下愛');
  const karin = member('KARIN', 'karin', '朝香果林');
  const zoneEnergies = Array.from({ length: waitingEnergyCount + activeEnergyCount }, (_, index) =>
    createCardInstance(
      { cardCode: `EZ-${index}`, name: `EZ-${index}`, cardType: CardType.ENERGY },
      P1,
      `energy-zone-${index}`
    )
  );
  const deckEnergies = Array.from({ length: Math.max(1, energyDeckCount) }, (_, index) =>
    createCardInstance(
      { cardCode: `ED-${index}`, name: `ED-${index}`, cardType: CardType.ENERGY },
      P1,
      `energy-deck-${index}`
    )
  );
  let game = registerCards(
    createGameState('bp7-005', P1, 'P1', P2, 'P2'),
    [ai, karin, ...zoneEnergies, ...deckEnergies]
  );
  const zoneEnergyIds = zoneEnergies.map((card) => card.instanceId);
  game = updatePlayer(game, P1, (player) => ({
    ...player,
    memberSlots: placeCardInSlot(
      placeCardInSlot(player.memberSlots, SlotPosition.CENTER, ai.instanceId, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      }),
      SlotPosition.LEFT,
      karin.instanceId,
      { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }
    ),
    energyZone: {
      ...player.energyZone,
      cardIds: zoneEnergyIds,
      cardStates: new Map(
        zoneEnergyIds.map((id, index) => [
          id,
          {
            orientation:
              index < waitingEnergyCount
                ? OrientationState.WAITING
                : OrientationState.ACTIVE,
            face: FaceState.FACE_UP,
          },
        ])
      ),
    },
    energyDeck: {
      ...player.energyDeck,
      cardIds: deckEnergies.slice(0, energyDeckCount).map((card) => card.instanceId),
    },
  }));
  const pending: PendingAbilityState = {
    id: 'ai-enter',
    abilityId: N_BP7_005_ON_ENTER_DIVERDIVA_CHOOSE_ACTIVATE_TWO_OR_PLACE_ENERGY_BELOW_ABILITY_ID,
    sourceCardId: ai.instanceId,
    controllerId: P1,
    mandatory: true,
    timingId: TriggerCondition.ON_ENTER_STAGE,
    eventIds: ['enter'],
    sourceSlot: SlotPosition.CENTER,
  };
  return {
    game: { ...game, pendingAbilities: [pending] },
    ai,
    karin,
    zoneEnergies,
    deckEnergies,
    pending,
  };
}

function start(game: GameState): GameState {
  return resolvePendingCardEffects(game).gameState;
}

function choose(game: GameState, option: string): GameState {
  return confirmActiveEffectStep(
    game,
    P1,
    game.activeEffect!.id,
    undefined,
    undefined,
    undefined,
    option
  );
}

function latestResolution(game: GameState) {
  return game.actionHistory
    .filter((action) => action.type === 'RESOLVE_ABILITY')
    .at(-1)?.payload;
}

describe('PL!N-bp7-005-P 宫下爱', () => {
  it('展示权威的“将2张能量变为活跃状态”文案，2张以上 WAITING 时恰好活跃2张', () => {
    const { game, zoneEnergies } = setup({ waitingEnergyCount: 2 });
    const choosing = start(game);

    expect(choosing.activeEffect?.selectableOptions?.map((option) => option.label)).toEqual([
      '将2张能量变为活跃状态',
      '将能量放置于『虹ヶ咲』成员下方',
    ]);

    const done = choose(choosing, ACTIVATE_OPTION);
    expect(zoneEnergies.slice(0, 2).map((card) =>
      done.players[0].energyZone.cardStates.get(card.instanceId)?.orientation
    )).toEqual([OrientationState.ACTIVE, OrientationState.ACTIVE]);
    expect(latestResolution(done)).toMatchObject({
      step: 'ACTIVATE_TWO_ENERGY',
      activatedEnergyCardIds: zoneEnergies.slice(0, 2).map((card) => card.instanceId),
    });
  });

  it('只有1张 WAITING 时尽可能活跃实际1张', () => {
    const { game, zoneEnergies } = setup({ waitingEnergyCount: 1 });
    const done = choose(start(game), ACTIVATE_OPTION);

    expect(done.players[0].energyZone.cardStates.get(zoneEnergies[0]!.instanceId)?.orientation)
      .toBe(OrientationState.ACTIVE);
    expect(latestResolution(done)?.activatedEnergyCardIds).toEqual([
      zoneEnergies[0]!.instanceId,
    ]);
  });

  it('能量区4张全部已活跃时仍可选活跃分支，并以0张实际变化正常结束', () => {
    const { game, zoneEnergies, deckEnergies } = setup({
      waitingEnergyCount: 0,
      activeEnergyCount: 4,
      energyDeckCount: 1,
    });
    const choosing = start(game);

    expect(choosing.activeEffect?.selectableOptions?.map((option) => option.id)).toEqual([
      ACTIVATE_OPTION,
      PLACE_OPTION,
    ]);
    const done = choose(choosing, ACTIVATE_OPTION);
    expect(done.activeEffect).toBeNull();
    expect(
      zoneEnergies.map((card) =>
        done.players[0].energyZone.cardStates.get(card.instanceId)?.orientation
      )
    ).toEqual(Array.from({ length: 4 }, () => OrientationState.ACTIVE));
    expect(done.players[0].energyDeck.cardIds).toContain(deckEnergies[0]!.instanceId);
    expect(latestResolution(done)).toMatchObject({
      step: 'ACTIVATE_TWO_ENERGY',
      activatedEnergyCardIds: [],
    });
  });

  it('已展示的活跃分支在确认前能量区变空时消费 pending 并继续', () => {
    const { game, pending } = setup({ waitingEnergyCount: 1 });
    const choosing = start(game);
    const stale = updatePlayer(choosing, P1, (player) => ({
      ...player,
      energyZone: {
        ...player.energyZone,
        cardIds: [],
        cardStates: new Map(),
      },
    }));

    const done = choose(stale, ACTIVATE_OPTION);
    expect(done.activeEffect).toBeNull();
    expect(done.pendingAbilities.some((ability) => ability.id === pending.id)).toBe(false);
    expect(latestResolution(done)).toMatchObject({
      step: 'ACTIVATE_BRANCH_STALE',
      activatedEnergyCardIds: [],
    });
  });

  it('已展示的 energyBelow 分支在确认前失效时消费并推进后续 pending', () => {
    const { game, pending } = setup({ waitingEnergyCount: 1, energyDeckCount: 1 });
    const choosing = start(game);
    const laterPending: PendingAbilityState = {
      ...pending,
      id: 'later-ai-enter',
      controllerId: P2,
      sourceCardId: 'missing-opponent-source',
      eventIds: ['later-enter'],
    };
    const stale = updatePlayer(
      { ...choosing, pendingAbilities: [...choosing.pendingAbilities, laterPending] },
      P1,
      (player) => ({ ...player, energyDeck: { ...player.energyDeck, cardIds: [] } })
    );

    const done = choose(stale, PLACE_OPTION);
    expect(done.activeEffect).toBeNull();
    expect(done.pendingAbilities).toEqual([]);
    expect(done.actionHistory.some((action) =>
      action.type === 'RESOLVE_ABILITY' &&
      action.payload.pendingAbilityId === pending.id &&
      action.payload.step === 'PLACE_BRANCH_STALE'
    )).toBe(true);
    expect(done.actionHistory.some((action) =>
      action.type === 'RESOLVE_ABILITY' &&
      action.payload.pendingAbilityId === laterPending.id
    )).toBe(true);
  });

  it('伪造且不属于原 selectableOptions 的分支仍被拒绝', () => {
    const choosing = start(setup().game);
    const rejected = choose(choosing, 'forged-option');

    expect(rejected.activeEffect).toEqual(choosing.activeEffect);
    expect(rejected.pendingAbilities).toEqual(choosing.pendingAbilities);
  });

  it('目标选择后离场时记录 PLACE_TARGET_STALE 并消费能力', () => {
    const { game, karin, pending } = setup({ waitingEnergyCount: 0 });
    const selecting = start(game);
    const stale = updatePlayer(selecting, P1, (player) => ({
      ...player,
      memberSlots: {
        ...player.memberSlots,
        slots: { ...player.memberSlots.slots, [SlotPosition.LEFT]: null },
      },
    }));

    const done = confirmActiveEffectStep(stale, P1, stale.activeEffect!.id, karin.instanceId);
    expect(done.activeEffect).toBeNull();
    expect(done.pendingAbilities.some((ability) => ability.id === pending.id)).toBe(false);
    expect(latestResolution(done)).toMatchObject({
      step: 'PLACE_TARGET_STALE',
      targetMemberCardId: karin.instanceId,
      placedEnergyCardIds: [],
    });
  });

  it('目标选择后成为 memberBelow 时安全消费且不移动能量', () => {
    const { game, ai, karin, deckEnergies } = setup({ waitingEnergyCount: 0 });
    const selecting = start(game);
    const stale = updatePlayer(selecting, P1, (player) => ({
      ...player,
      memberSlots: {
        ...player.memberSlots,
        slots: { ...player.memberSlots.slots, [SlotPosition.LEFT]: null },
        memberBelow: {
          ...player.memberSlots.memberBelow,
          [SlotPosition.CENTER]: [karin.instanceId],
        },
      },
    }));

    const done = confirmActiveEffectStep(stale, P1, stale.activeEffect!.id, karin.instanceId);
    expect(done.players[0].energyDeck.cardIds).toContain(deckEnergies[0]!.instanceId);
    expect(done.players[0].memberSlots.memberBelow[SlotPosition.CENTER]).toEqual([
      karin.instanceId,
    ]);
    expect(done.players[0].memberSlots.slots[SlotPosition.CENTER]).toBe(ai.instanceId);
    expect(latestResolution(done)).toMatchObject({
      step: 'PLACE_TARGET_STALE',
      placedEnergyCardIds: [],
    });
  });

  it('目标仅移槽时按成员实例找到当前槽并正常放置', () => {
    const { game, karin, deckEnergies } = setup({ waitingEnergyCount: 0 });
    const selecting = start(game);
    const moved = updatePlayer(selecting, P1, (player) => ({
      ...player,
      memberSlots: {
        ...player.memberSlots,
        slots: {
          ...player.memberSlots.slots,
          [SlotPosition.LEFT]: null,
          [SlotPosition.RIGHT]: karin.instanceId,
        },
      },
    }));

    const done = confirmActiveEffectStep(moved, P1, moved.activeEffect!.id, karin.instanceId);
    expect(done.players[0].memberSlots.energyBelow[SlotPosition.RIGHT]).toEqual([
      deckEnergies[0]!.instanceId,
    ]);
    expect(latestResolution(done)).toMatchObject({
      step: 'PLACE_ENERGY_BELOW_NIJIGASAKI_MEMBER',
      targetSlot: SlotPosition.RIGHT,
      placedEnergyCardIds: [deckEnergies[0]!.instanceId],
    });
  });

  it('选择目标后能量卡组变空时记录实际空 IDs 并正常结束', () => {
    const { game, karin } = setup({ waitingEnergyCount: 0 });
    const selecting = start(game);
    const emptyDeck = updatePlayer(selecting, P1, (player) => ({
      ...player,
      energyDeck: { ...player.energyDeck, cardIds: [] },
    }));

    const done = confirmActiveEffectStep(
      emptyDeck,
      P1,
      emptyDeck.activeEffect!.id,
      karin.instanceId
    );
    expect(done.activeEffect).toBeNull();
    expect(latestResolution(done)).toMatchObject({
      step: 'PLACE_ENERGY_BELOW_NIJIGASAKI_MEMBER',
      targetMemberCardId: karin.instanceId,
      placedEnergyCardIds: [],
    });
  });

  it('不属于原 selectableCardIds 的目标输入仍保持窗口', () => {
    const selecting = start(setup({ waitingEnergyCount: 0 }).game);
    const rejected = confirmActiveEffectStep(
      selecting,
      P1,
      selecting.activeEffect!.id,
      'forged-target'
    );

    expect(rejected.activeEffect).toEqual(selecting.activeEffect);
    expect(rejected.pendingAbilities).toEqual(selecting.pendingAbilities);
  });
});
