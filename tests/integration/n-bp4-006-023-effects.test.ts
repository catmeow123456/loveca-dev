import { describe, expect, it } from 'vitest';
import type { EnergyCardData, MemberCardData } from '../../src/domain/entities/card';
import { createCardInstance, createHeartIcon } from '../../src/domain/entities/card';
import {
  createGameState,
  registerCards,
  updatePlayer,
  type GameState,
  type PendingAbilityState,
} from '../../src/domain/entities/game';
import { addCardToZone, placeCardInSlot } from '../../src/domain/entities/zone';
import {
  confirmActiveEffectStep,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import {
  HS_PB1_003_AUTO_HAND_TO_WAITING_GAIN_HEART_BLADE_ABILITY_ID,
  PL_N_BP4_006_ON_ENTER_PAY_TWO_PLAY_LOW_COST_NIJIGASAKI_MEMBER_ABILITY_ID,
  PL_N_BP4_021_ON_ENTER_WAITING_ROOM_CARD_TO_DECK_TOP_ABILITY_ID,
  PL_N_BP4_023_ON_ENTER_WAIT_NIJIGASAKI_MEMBER_DRAW_DISCARD_ABILITY_ID,
} from '../../src/application/card-effects/ability-ids';
import {
  BladeHeartEffect,
  CardType,
  FaceState,
  HeartColor,
  OrientationState,
  SlotPosition,
  TriggerCondition,
} from '../../src/shared/types/enums';

const PLAYER1 = 'player1';
const PLAYER2 = 'player2';

function createMemberData(
  cardCode: string,
  options: {
    readonly name?: string;
    readonly cost?: number;
    readonly groupNames?: readonly string[];
    readonly bladeHeart?: boolean;
  } = {}
): MemberCardData {
  return {
    cardCode,
    name: options.name ?? cardCode,
    groupNames: options.groupNames ?? ['虹ヶ咲学園スクールアイドル同好会'],
    cardType: CardType.MEMBER,
    cost: options.cost ?? 4,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.PINK, 1)],
    bladeHearts: options.bladeHeart
      ? [{ effect: BladeHeartEffect.HEART, heartColor: HeartColor.PINK }]
      : [],
  };
}

function createMember(
  cardCode: string,
  instanceId: string,
  options: Parameters<typeof createMemberData>[1] = {},
  ownerId = PLAYER1
) {
  return createCardInstance(createMemberData(cardCode, options), ownerId, instanceId);
}

function createEnergy(instanceId: string) {
  const data: EnergyCardData = {
    cardCode: `ENERGY-${instanceId}`,
    name: `Energy ${instanceId}`,
    cardType: CardType.ENERGY,
  };
  return createCardInstance(data, PLAYER1, instanceId);
}

function addActiveEnergy(game: GameState, energyIds: readonly string[]): GameState {
  return updatePlayer(game, PLAYER1, (player) => {
    const cardStates = new Map(player.energyZone.cardStates);
    for (const energyId of energyIds) {
      cardStates.set(energyId, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      });
    }
    return {
      ...player,
      energyZone: {
        ...player.energyZone,
        cardIds: [...player.energyZone.cardIds, ...energyIds],
        cardStates,
      },
    };
  });
}

function createPending(
  abilityId: string,
  sourceCardId: string,
  sourceSlot = SlotPosition.CENTER
): PendingAbilityState {
  return {
    id: `${abilityId}:pending`,
    abilityId,
    sourceCardId,
    controllerId: PLAYER1,
    mandatory: true,
    timingId: TriggerCondition.ON_ENTER_STAGE,
    eventIds: ['enter-stage'],
    sourceSlot,
  };
}

function resolvePending(game: GameState, pending: PendingAbilityState): GameState {
  return resolvePendingCardEffects({ ...game, pendingAbilities: [pending] }).gameState;
}

function latestResolvePayload(game: GameState, abilityId: string) {
  return game.actionHistory
    .filter((action) => action.type === 'RESOLVE_ABILITY' && action.payload.abilityId === abilityId)
    .at(-1)?.payload;
}

function hasTriggeredAbility(game: GameState, abilityId: string, sourceCardId?: string): boolean {
  return game.actionHistory.some(
    (action) =>
      action.type === 'TRIGGER_ABILITY' &&
      action.payload.abilityId === abilityId &&
      (sourceCardId === undefined || action.payload.sourceCardId === sourceCardId)
  );
}

function setupKanata(options: {
  readonly sourceCode?: string;
  readonly handCards?: readonly ReturnType<typeof createMember>[];
  readonly activeEnergyCount?: number;
  readonly fillAllSlots?: boolean;
} = {}) {
  const source = createMember(options.sourceCode ?? 'PL!N-bp4-006-R', 'kanata-source', {
    name: '近江彼方',
    cost: 11,
  });
  const left = createMember('PL!N-test-left', 'kanata-left');
  const right = createMember('PL!N-test-right', 'kanata-right');
  const handCards = options.handCards ?? [
    createMember('PL!N-bp4-021-N', 'kanata-play-target', {
      name: '天王寺璃奈',
      cost: 4,
      bladeHeart: true,
    }),
  ];
  const energyCards = Array.from({ length: options.activeEnergyCount ?? 2 }, (_, index) =>
    createEnergy(`kanata-energy-${index}`)
  );

  let game = createGameState('n-bp4-006-kanata', PLAYER1, 'P1', PLAYER2, 'P2');
  game = registerCards(game, [source, left, right, ...handCards, ...energyCards]);
  game = updatePlayer(game, PLAYER1, (player) => {
    let memberSlots = placeCardInSlot(player.memberSlots, SlotPosition.CENTER, source.instanceId, {
      orientation: OrientationState.ACTIVE,
      face: FaceState.FACE_UP,
    });
    if (options.fillAllSlots) {
      memberSlots = placeCardInSlot(
        placeCardInSlot(memberSlots, SlotPosition.LEFT, left.instanceId),
        SlotPosition.RIGHT,
        right.instanceId
      );
    }
    return {
      ...player,
      memberSlots,
      hand: handCards.reduce((hand, card) => addCardToZone(hand, card.instanceId), player.hand),
    };
  });
  game = addActiveEnergy(
    game,
    energyCards.map((card) => card.instanceId)
  );
  return { game, source, handCards, energyCards };
}

function setupMia(options: {
  readonly includeNijigasakiTarget?: boolean;
  readonly includeHandDiscardTriggerSource?: boolean;
  readonly handCount?: number;
  readonly mainDeckCount?: number;
} = {}) {
  const source = createMember('PL!N-bp4-023-N', 'mia-source', {
    name: 'ミア・テイラー',
    cost: 5,
  });
  const target = options.includeNijigasakiTarget === false
    ? null
    : createMember('PL!N-test-target', 'mia-target', {
        name: '中須かすみ',
        cost: 4,
      });
  const triggerSource = options.includeHandDiscardTriggerSource
    ? createMember('PL!HS-pb1-003-R', 'hand-discard-trigger-source', {
        name: '大沢瑠璃乃',
        groupNames: ['蓮ノ空女学院スクールアイドルクラブ'],
      })
    : null;
  const handCards = Array.from({ length: options.handCount ?? 1 }, (_, index) =>
    createMember(`PL!N-test-hand-${index}`, `mia-hand-${index}`)
  );
  const mainDeckCards = Array.from({ length: options.mainDeckCount ?? 1 }, (_, index) =>
    createMember(`PL!N-test-draw-${index}`, `mia-draw-${index}`)
  );

  let game = createGameState('n-bp4-023-mia', PLAYER1, 'P1', PLAYER2, 'P2');
  game = registerCards(game, [
    source,
    ...(target ? [target] : []),
    ...(triggerSource ? [triggerSource] : []),
    ...handCards,
    ...mainDeckCards,
  ]);
  game = updatePlayer(game, PLAYER1, (player) => {
    let memberSlots = placeCardInSlot(player.memberSlots, SlotPosition.CENTER, source.instanceId, {
      orientation: OrientationState.ACTIVE,
      face: FaceState.FACE_UP,
    });
    if (target) {
      memberSlots = placeCardInSlot(memberSlots, SlotPosition.LEFT, target.instanceId, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      });
    }
    if (triggerSource) {
      memberSlots = placeCardInSlot(memberSlots, SlotPosition.RIGHT, triggerSource.instanceId, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      });
    }
    return {
      ...player,
      memberSlots,
      hand: handCards.reduce((hand, card) => addCardToZone(hand, card.instanceId), player.hand),
      mainDeck: mainDeckCards.reduce(
        (deck, card) => addCardToZone(deck, card.instanceId),
        player.mainDeck
      ),
    };
  });
  return { game, source, target, triggerSource, handCards, mainDeckCards };
}

describe('PL!N-bp4-006 Kanata on-enter workflow', () => {
  it('pays two energy, plays a low-cost Nijigasaki member from hand, triggers its ON_ENTER, and waits source when it has BLADE HEART', () => {
    const scenario = setupKanata({ sourceCode: 'PL!N-bp4-006-P' });
    const started = resolvePending(
      scenario.game,
      createPending(
        PL_N_BP4_006_ON_ENTER_PAY_TWO_PLAY_LOW_COST_NIJIGASAKI_MEMBER_ABILITY_ID,
        scenario.source.instanceId
      )
    );

    expect(started.activeEffect).toMatchObject({
      abilityId: PL_N_BP4_006_ON_ENTER_PAY_TWO_PLAY_LOW_COST_NIJIGASAKI_MEMBER_ABILITY_ID,
      selectableCardIds: [scenario.handCards[0].instanceId],
      canSkipSelection: true,
    });

    const selectedCard = confirmActiveEffectStep(
      started,
      PLAYER1,
      started.activeEffect!.id,
      scenario.handCards[0].instanceId
    );
    expect(selectedCard.players[0].energyZone.cardStates.get(scenario.energyCards[0].instanceId))
      .toMatchObject({ orientation: OrientationState.WAITING });
    expect(selectedCard.activeEffect).toMatchObject({
      stepId: 'N_BP4_006_SELECT_EMPTY_SLOT',
      selectableSlots: [SlotPosition.LEFT, SlotPosition.RIGHT],
    });

    const resolved = confirmActiveEffectStep(
      selectedCard,
      PLAYER1,
      selectedCard.activeEffect!.id,
      undefined,
      SlotPosition.LEFT
    );

    expect(resolved.players[0].hand.cardIds).not.toContain(scenario.handCards[0].instanceId);
    expect(resolved.players[0].memberSlots.slots[SlotPosition.LEFT]).toBe(
      scenario.handCards[0].instanceId
    );
    expect(resolved.players[0].memberSlots.cardStates.get(scenario.source.instanceId)).toMatchObject({
      orientation: OrientationState.WAITING,
    });
    expect(
      hasTriggeredAbility(
        resolved,
        PL_N_BP4_021_ON_ENTER_WAITING_ROOM_CARD_TO_DECK_TOP_ABILITY_ID,
        scenario.handCards[0].instanceId
      )
    ).toBe(true);
    expect(latestResolvePayload(resolved, PL_N_BP4_006_ON_ENTER_PAY_TWO_PLAY_LOW_COST_NIJIGASAKI_MEMBER_ABILITY_ID))
      .toMatchObject({
        step: 'WAIT_SOURCE_FOR_BLADE_HEART_MEMBER',
        playedMemberCardId: scenario.handCards[0].instanceId,
      });
  });

  it('skip and impossible starts consume without paying energy or moving cards', () => {
    const scenario = setupKanata();
    const started = resolvePending(
      scenario.game,
      createPending(
        PL_N_BP4_006_ON_ENTER_PAY_TWO_PLAY_LOW_COST_NIJIGASAKI_MEMBER_ABILITY_ID,
        scenario.source.instanceId
      )
    );
    const skipped = confirmActiveEffectStep(started, PLAYER1, started.activeEffect!.id, null);
    expect(skipped.activeEffect).toBeNull();
    expect(skipped.players[0].hand.cardIds).toContain(scenario.handCards[0].instanceId);
    expect(skipped.players[0].energyZone.cardStates.get(scenario.energyCards[0].instanceId))
      .toMatchObject({ orientation: OrientationState.ACTIVE });

    const noTarget = setupKanata({
      handCards: [
        createMember('PL!N-test-high-cost', 'kanata-high-cost', { cost: 5 }),
        createMember('PL!S-test-low-cost', 'kanata-non-niji', {
          cost: 4,
          groupNames: ['Aqours'],
        }),
      ],
    });
    expect(
      resolvePending(
        noTarget.game,
        createPending(
          PL_N_BP4_006_ON_ENTER_PAY_TWO_PLAY_LOW_COST_NIJIGASAKI_MEMBER_ABILITY_ID,
          noTarget.source.instanceId
        )
      ).activeEffect
    ).toBeNull();

    const noEnergy = setupKanata({ activeEnergyCount: 1 });
    expect(
      latestResolvePayload(
        resolvePending(
          noEnergy.game,
          createPending(
            PL_N_BP4_006_ON_ENTER_PAY_TWO_PLAY_LOW_COST_NIJIGASAKI_MEMBER_ABILITY_ID,
            noEnergy.source.instanceId
          )
        ),
        PL_N_BP4_006_ON_ENTER_PAY_TWO_PLAY_LOW_COST_NIJIGASAKI_MEMBER_ABILITY_ID
      )
    ).toMatchObject({ step: 'NO_OP_ENERGY_COST_UNPAYABLE' });

    const noSlot = setupKanata({ fillAllSlots: true });
    expect(
      latestResolvePayload(
        resolvePending(
          noSlot.game,
          createPending(
            PL_N_BP4_006_ON_ENTER_PAY_TWO_PLAY_LOW_COST_NIJIGASAKI_MEMBER_ABILITY_ID,
            noSlot.source.instanceId
          )
        ),
        PL_N_BP4_006_ON_ENTER_PAY_TWO_PLAY_LOW_COST_NIJIGASAKI_MEMBER_ABILITY_ID
      )
    ).toMatchObject({ step: 'NO_OP_NO_EMPTY_STAGE_SLOT' });
  });
});

describe('PL!N-bp4-023 Mia Taylor on-enter workflow', () => {
  it('waits a Nijigasaki stage member, draws one, discards one hand card, and enqueues hand-entered-waiting triggers', () => {
    const scenario = setupMia({ includeHandDiscardTriggerSource: true });
    const started = resolvePending(
      scenario.game,
      createPending(
        PL_N_BP4_023_ON_ENTER_WAIT_NIJIGASAKI_MEMBER_DRAW_DISCARD_ABILITY_ID,
        scenario.source.instanceId
      )
    );
    expect(started.activeEffect).toMatchObject({
      abilityId: PL_N_BP4_023_ON_ENTER_WAIT_NIJIGASAKI_MEMBER_DRAW_DISCARD_ABILITY_ID,
      selectableCardIds: [scenario.target!.instanceId, scenario.source.instanceId],
      canSkipSelection: true,
    });

    const waited = confirmActiveEffectStep(
      started,
      PLAYER1,
      started.activeEffect!.id,
      scenario.target!.instanceId
    );
    expect(waited.players[0].memberSlots.cardStates.get(scenario.target!.instanceId))
      .toMatchObject({ orientation: OrientationState.WAITING });
    expect(waited.players[0].hand.cardIds).toContain(scenario.mainDeckCards[0].instanceId);
    expect(waited.activeEffect).toMatchObject({
      stepId: 'N_BP4_023_SELECT_DISCARD_HAND',
      selectableCardIds: [scenario.handCards[0].instanceId, scenario.mainDeckCards[0].instanceId],
      canSkipSelection: false,
    });

    const resolved = confirmActiveEffectStep(
      waited,
      PLAYER1,
      waited.activeEffect!.id,
      scenario.handCards[0].instanceId
    );

    expect(resolved.players[0].waitingRoom.cardIds).toContain(scenario.handCards[0].instanceId);
    expect(
      hasTriggeredAbility(
        resolved,
        HS_PB1_003_AUTO_HAND_TO_WAITING_GAIN_HEART_BLADE_ABILITY_ID,
        scenario.triggerSource!.instanceId
      )
    ).toBe(true);
    expect(latestResolvePayload(resolved, PL_N_BP4_023_ON_ENTER_WAIT_NIJIGASAKI_MEMBER_DRAW_DISCARD_ABILITY_ID))
      .toMatchObject({
        step: 'DISCARD_ONE_AFTER_DRAW',
        waitedMemberCardId: scenario.target!.instanceId,
        discardedCardIds: [scenario.handCards[0].instanceId],
      });
  });

  it('skip, no legal target, and stale target do not draw or discard', () => {
    const scenario = setupMia();
    const started = resolvePending(
      scenario.game,
      createPending(
        PL_N_BP4_023_ON_ENTER_WAIT_NIJIGASAKI_MEMBER_DRAW_DISCARD_ABILITY_ID,
        scenario.source.instanceId
      )
    );
    const skipped = confirmActiveEffectStep(started, PLAYER1, started.activeEffect!.id, null);
    expect(skipped.activeEffect).toBeNull();
    expect(skipped.players[0].mainDeck.cardIds).toEqual([scenario.mainDeckCards[0].instanceId]);
    expect(skipped.players[0].waitingRoom.cardIds).not.toContain(scenario.handCards[0].instanceId);

    const noTarget = setupMia({ includeNijigasakiTarget: false });
    const noTargetWithoutSourceOnStage = updatePlayer(noTarget.game, PLAYER1, (player) => ({
      ...player,
      memberSlots: {
        ...player.memberSlots,
        slots: {
          ...player.memberSlots.slots,
          [SlotPosition.CENTER]: null,
        },
      },
    }));
    expect(
      latestResolvePayload(
        resolvePending(
          noTargetWithoutSourceOnStage,
          createPending(
            PL_N_BP4_023_ON_ENTER_WAIT_NIJIGASAKI_MEMBER_DRAW_DISCARD_ABILITY_ID,
            noTarget.source.instanceId
          )
        ),
        PL_N_BP4_023_ON_ENTER_WAIT_NIJIGASAKI_MEMBER_DRAW_DISCARD_ABILITY_ID
      )
    ).toMatchObject({ step: 'NO_OP_NO_NIJIGASAKI_STAGE_MEMBER' });

    const staleTarget = updatePlayer(started, PLAYER1, (player) => ({
      ...player,
      memberSlots: {
        ...player.memberSlots,
        cardStates: new Map([
          ...player.memberSlots.cardStates,
          [scenario.target!.instanceId, { orientation: OrientationState.WAITING, face: FaceState.FACE_UP }],
        ]),
      },
    }));
    expect(
      confirmActiveEffectStep(
        staleTarget,
        PLAYER1,
        staleTarget.activeEffect!.id,
        scenario.target!.instanceId
      )
    ).toBe(staleTarget);
  });
});
