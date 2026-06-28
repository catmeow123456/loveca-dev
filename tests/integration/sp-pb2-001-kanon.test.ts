import { describe, expect, it } from 'vitest';
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
  type PendingAbilityState,
} from '../../src/domain/entities/game';
import { placeCardInSlot } from '../../src/domain/entities/zone';
import {
  confirmActiveEffectStep,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import { SP_PB2_001_ON_ENTER_DISCARD_LOOK_TOP_LOW_COST_LIELLA_MEMBER_PLAY_OR_HAND_ABILITY_ID } from '../../src/application/card-effects/ability-ids';
import {
  CardType,
  FaceState,
  HeartColor,
  OrientationState,
  SlotPosition,
  TriggerCondition,
} from '../../src/shared/types/enums';

const PLAYER1 = 'player1';
const PLAYER2 = 'player2';

function createMember(
  cardCode: string,
  options: {
    readonly name?: string;
    readonly groupName?: string;
    readonly unitName?: string;
    readonly cost?: number;
  } = {}
): MemberCardData {
  return {
    cardCode,
    name: options.name ?? cardCode,
    groupName: options.groupName ?? 'Liella!',
    unitName: options.unitName ?? 'CatChu!',
    cardType: CardType.MEMBER,
    cost: options.cost ?? 4,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.RED, 1)],
  };
}

function createLive(cardCode: string, groupName = 'Liella!'): LiveCardData {
  return {
    cardCode,
    name: cardCode,
    groupName,
    unitName: 'Liella!',
    cardType: CardType.LIVE,
    score: 3,
    requirements: createHeartRequirement({ [HeartColor.RED]: 1 }),
  };
}

function pendingAbility(sourceId: string): PendingAbilityState {
  return {
    id: 'sp-pb2-001-pending',
    abilityId: SP_PB2_001_ON_ENTER_DISCARD_LOOK_TOP_LOW_COST_LIELLA_MEMBER_PLAY_OR_HAND_ABILITY_ID,
    sourceCardId: sourceId,
    controllerId: PLAYER1,
    mandatory: true,
    timingId: TriggerCondition.ON_ENTER_STAGE,
    eventIds: ['on-enter'],
    sourceSlot: SlotPosition.CENTER,
  };
}

function setupState(options: {
  readonly handCardCount?: number;
  readonly fillEmptySlots?: boolean;
} = {}): {
  readonly game: GameState;
  readonly sourceId: string;
  readonly discardId: string;
  readonly eligibleId: string;
  readonly highCostId: string;
  readonly nonLiellaId: string;
  readonly liellaLiveId: string;
  readonly fifthId: string;
  readonly sixthId: string;
} {
  const source = createCardInstance(
    createMember('PL!SP-pb2-001-R', { name: '澁谷かのん', cost: 15 }),
    PLAYER1,
    'sp-pb2-001-source'
  );
  const discard = createCardInstance(
    createMember('PL!SP-pb2-001-discard', { name: 'discard' }),
    PLAYER1,
    'sp-pb2-001-discard'
  );
  const eligible = createCardInstance(
    createMember('PL!SP-pb2-001-eligible', { name: 'eligible', cost: 4 }),
    PLAYER1,
    'sp-pb2-001-eligible'
  );
  const highCost = createCardInstance(
    createMember('PL!SP-pb2-001-high-cost', { name: 'high cost', cost: 5 }),
    PLAYER1,
    'sp-pb2-001-high-cost'
  );
  const nonLiella = createCardInstance(
    createMember('PL!N-pb2-001-non-liella', {
      name: 'non Liella',
      groupName: '虹咲学園スクールアイドル同好会',
      unitName: 'A・ZU・NA',
      cost: 4,
    }),
    PLAYER1,
    'sp-pb2-001-non-liella'
  );
  const liellaLive = createCardInstance(
    createLive('PL!SP-pb2-001-liella-live'),
    PLAYER1,
    'sp-pb2-001-liella-live'
  );
  const fifth = createCardInstance(
    createMember('PL!SP-pb2-001-fifth', { name: 'fifth', cost: 4 }),
    PLAYER1,
    'sp-pb2-001-fifth'
  );
  const sixth = createCardInstance(
    createMember('PL!SP-pb2-001-sixth', { name: 'sixth', cost: 4 }),
    PLAYER1,
    'sp-pb2-001-sixth'
  );
  const leftOccupant = createCardInstance(
    createMember('PL!SP-pb2-001-left-occupant', { name: 'left occupant' }),
    PLAYER1,
    'sp-pb2-001-left-occupant'
  );
  const rightOccupant = createCardInstance(
    createMember('PL!SP-pb2-001-right-occupant', { name: 'right occupant' }),
    PLAYER1,
    'sp-pb2-001-right-occupant'
  );

  let game = createGameState('sp-pb2-001-kanon', PLAYER1, 'P1', PLAYER2, 'P2');
  game = registerCards(game, [
    source,
    discard,
    eligible,
    highCost,
    nonLiella,
    liellaLive,
    fifth,
    sixth,
    leftOccupant,
    rightOccupant,
  ]);
  game = updatePlayer(game, PLAYER1, (player) => {
    let memberSlots = placeCardInSlot(player.memberSlots, SlotPosition.CENTER, source.instanceId, {
      orientation: OrientationState.ACTIVE,
      face: FaceState.FACE_UP,
    });
    if (options.fillEmptySlots === true) {
      memberSlots = placeCardInSlot(memberSlots, SlotPosition.LEFT, leftOccupant.instanceId, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      });
      memberSlots = placeCardInSlot(memberSlots, SlotPosition.RIGHT, rightOccupant.instanceId, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      });
    }
    return {
      ...player,
      hand: {
        ...player.hand,
        cardIds: options.handCardCount === 0 ? [] : [discard.instanceId],
      },
      mainDeck: {
        ...player.mainDeck,
        cardIds: [
          eligible.instanceId,
          highCost.instanceId,
          nonLiella.instanceId,
          liellaLive.instanceId,
          fifth.instanceId,
          sixth.instanceId,
        ],
      },
      waitingRoom: { ...player.waitingRoom, cardIds: [] },
      memberSlots,
    };
  });

  return {
    game,
    sourceId: source.instanceId,
    discardId: discard.instanceId,
    eligibleId: eligible.instanceId,
    highCostId: highCost.instanceId,
    nonLiellaId: nonLiella.instanceId,
    liellaLiveId: liellaLive.instanceId,
    fifthId: fifth.instanceId,
    sixthId: sixth.instanceId,
  };
}

function startAbility(game: GameState, sourceId: string): GameState {
  return resolvePendingCardEffects({
    ...game,
    pendingAbilities: [pendingAbility(sourceId)],
  }).gameState;
}

function discardAndInspect(game: GameState, discardId: string): GameState {
  return confirmActiveEffectStep(game, PLAYER1, game.activeEffect!.id, discardId);
}

describe('PL!SP-pb2-001 Kanon discard look top play or hand', () => {
  it('discards, inspects top five, and adds a low-cost Liella member to hand', () => {
    const scenario = setupState();
    let state = startAbility(scenario.game, scenario.sourceId);

    expect(state.activeEffect?.selectableCardIds).toEqual([scenario.discardId]);
    state = discardAndInspect(state, scenario.discardId);

    expect(state.activeEffect?.inspectionCardIds).toEqual([
      scenario.eligibleId,
      scenario.highCostId,
      scenario.nonLiellaId,
      scenario.liellaLiveId,
      scenario.fifthId,
    ]);
    expect(state.activeEffect?.selectableCardIds).toEqual([
      scenario.eligibleId,
      scenario.fifthId,
    ]);

    state = confirmActiveEffectStep(state, PLAYER1, state.activeEffect!.id, scenario.eligibleId);
    state = confirmActiveEffectStep(
      state,
      PLAYER1,
      state.activeEffect!.id,
      null,
      null,
      false,
      'hand'
    );

    expect(state.activeEffect).toBeNull();
    expect(state.inspectionZone.cardIds).toEqual([]);
    expect(state.players[0].hand.cardIds).toEqual([scenario.eligibleId]);
    expect(state.players[0].waitingRoom.cardIds).toEqual([
      scenario.discardId,
      scenario.highCostId,
      scenario.nonLiellaId,
      scenario.liellaLiveId,
      scenario.fifthId,
    ]);
    expect(state.players[0].mainDeck.cardIds).toEqual([scenario.sixthId]);
  });

  it('can play the revealed member to an empty member slot and enqueue ON_ENTER_STAGE', () => {
    const scenario = setupState();
    let state = discardAndInspect(startAbility(scenario.game, scenario.sourceId), scenario.discardId);

    state = confirmActiveEffectStep(state, PLAYER1, state.activeEffect!.id, scenario.eligibleId);
    state = confirmActiveEffectStep(
      state,
      PLAYER1,
      state.activeEffect!.id,
      null,
      null,
      false,
      'stage'
    );
    expect(state.activeEffect?.selectableSlots).toEqual([SlotPosition.LEFT, SlotPosition.RIGHT]);
    state = confirmActiveEffectStep(
      state,
      PLAYER1,
      state.activeEffect!.id,
      null,
      SlotPosition.LEFT
    );

    expect(state.players[0].memberSlots.slots[SlotPosition.LEFT]).toBe(scenario.eligibleId);
    expect(state.players[0].hand.cardIds).toEqual([]);
    expect(state.players[0].waitingRoom.cardIds).toEqual([
      scenario.discardId,
      scenario.highCostId,
      scenario.nonLiellaId,
      scenario.liellaLiveId,
      scenario.fifthId,
    ]);
    expect(
      state.eventLog.some(
        (entry) =>
          entry.event.eventType === TriggerCondition.ON_ENTER_STAGE &&
          entry.event.cardInstanceId === scenario.eligibleId
      )
    ).toBe(true);
  });

  it('adds the revealed member to hand when no empty member slot exists', () => {
    const scenario = setupState({ fillEmptySlots: true });
    let state = discardAndInspect(startAbility(scenario.game, scenario.sourceId), scenario.discardId);

    state = confirmActiveEffectStep(state, PLAYER1, state.activeEffect!.id, scenario.eligibleId);

    expect(state.activeEffect).toBeNull();
    expect(state.players[0].hand.cardIds).toEqual([scenario.eligibleId]);
    expect(Object.values(state.players[0].memberSlots.slots)).not.toContain(scenario.eligibleId);
  });

  it('can reveal no card and moves all inspected cards to waiting room', () => {
    const scenario = setupState();
    let state = discardAndInspect(startAbility(scenario.game, scenario.sourceId), scenario.discardId);

    state = confirmActiveEffectStep(state, PLAYER1, state.activeEffect!.id, null);

    expect(state.activeEffect).toBeNull();
    expect(state.players[0].hand.cardIds).toEqual([]);
    expect(state.players[0].waitingRoom.cardIds).toEqual([
      scenario.discardId,
      scenario.eligibleId,
      scenario.highCostId,
      scenario.nonLiellaId,
      scenario.liellaLiveId,
      scenario.fifthId,
    ]);
    expect(state.inspectionZone.cardIds).toEqual([]);
  });

  it('consumes pending no-op when there is no hand card to discard', () => {
    const scenario = setupState({ handCardCount: 0 });
    const state = startAbility(scenario.game, scenario.sourceId);

    expect(state.activeEffect).toBeNull();
    expect(state.pendingAbilities).toEqual([]);
    expect(state.players[0].mainDeck.cardIds).toEqual([
      scenario.eligibleId,
      scenario.highCostId,
      scenario.nonLiellaId,
      scenario.liellaLiveId,
      scenario.fifthId,
      scenario.sixthId,
    ]);
  });

  it('rejects illegal inspected targets and occupied stage slots', () => {
    const scenario = setupState();
    let state = discardAndInspect(startAbility(scenario.game, scenario.sourceId), scenario.discardId);
    const beforeIllegalTarget = state;

    state = confirmActiveEffectStep(state, PLAYER1, state.activeEffect!.id, scenario.highCostId);
    expect(state).toBe(beforeIllegalTarget);

    state = confirmActiveEffectStep(state, PLAYER1, state.activeEffect!.id, scenario.eligibleId);
    state = confirmActiveEffectStep(
      state,
      PLAYER1,
      state.activeEffect!.id,
      null,
      null,
      false,
      'stage'
    );
    const beforeIllegalSlot = state;

    state = confirmActiveEffectStep(
      state,
      PLAYER1,
      state.activeEffect!.id,
      null,
      SlotPosition.CENTER
    );
    expect(state).toBe(beforeIllegalSlot);
  });
});
