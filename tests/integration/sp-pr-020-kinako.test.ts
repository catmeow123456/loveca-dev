import { describe, expect, it } from 'vitest';
import type { MemberCardData } from '../../src/domain/entities/card';
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
  SP_BP4_001_ON_ENTER_LIELLA_STAGE_SEVEN_ENERGY_PLACE_WAITING_ENERGY_ABILITY_ID,
  SP_PR_020_ON_ENTER_LOW_COST_RELAY_PLAY_HAND_LOW_COST_MEMBER_ABILITY_ID,
} from '../../src/application/card-effects/ability-ids';
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

function createMemberData(
  cardCode: string,
  options: {
    readonly name?: string;
    readonly cost?: number;
    readonly groupNames?: readonly string[];
  } = {}
): MemberCardData {
  return {
    cardCode,
    name: options.name ?? cardCode,
    groupNames: options.groupNames ?? ['Liella!'],
    cardType: CardType.MEMBER,
    cost: options.cost ?? 4,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.RED, 1)],
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

function setupState(options: {
  readonly sourceCost?: number;
  readonly replacementEffectiveCost?: number;
  readonly includeRelayMetadata?: boolean;
  readonly handCards?: readonly ReturnType<typeof createCardInstance>[];
  readonly fillAllSlots?: boolean;
}) {
  const source = createMember('PL!SP-PR-020-PR', 'sp-pr-020-source', {
    name: '桜小路きな子',
    cost: options.sourceCost ?? 17,
  });
  const replacement = createMember('PL!SP-test-replacement', 'sp-pr-020-replacement', {
    cost: options.replacementEffectiveCost ?? 9,
  });
  const left = createMember('PL!SP-test-left', 'sp-pr-020-left');
  const right = createMember('PL!SP-test-right', 'sp-pr-020-right');
  const handCards = options.handCards ?? [
    createMember('PL!SP-bp4-001-P', 'sp-pr-020-low-cost-enter', {
      name: '澁谷かのん',
      cost: 4,
    }),
  ];

  let game = createGameState('sp-pr-020-kinako', PLAYER1, 'P1', PLAYER2, 'P2');
  game = registerCards(game, [source, replacement, left, right, ...handCards]);
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
      waitingRoom: addCardToZone(player.waitingRoom, replacement.instanceId),
    };
  });

  return { game, source, replacement, handCards };
}

function startAbility(
  game: GameState,
  sourceCardId: string,
  replacementCardId: string,
  options: {
    readonly includeRelayMetadata?: boolean;
    readonly replacementEffectiveCost?: number;
  } = {}
): GameState {
  const pendingAbility: PendingAbilityState = {
    id: 'sp-pr-020-pending',
    abilityId: SP_PR_020_ON_ENTER_LOW_COST_RELAY_PLAY_HAND_LOW_COST_MEMBER_ABILITY_ID,
    sourceCardId,
    controllerId: PLAYER1,
    mandatory: true,
    timingId: TriggerCondition.ON_ENTER_STAGE,
    eventIds: ['enter-stage'],
    sourceSlot: SlotPosition.CENTER,
    metadata:
      options.includeRelayMetadata === false
        ? undefined
        : {
            relayReplacements: [
              {
                cardId: replacementCardId,
                effectiveCost: options.replacementEffectiveCost ?? 9,
              },
            ],
          },
  };
  return resolvePendingCardEffects({ ...game, pendingAbilities: [pendingAbility] }).gameState;
}

function latestPayload(game: GameState) {
  return game.actionHistory
    .filter(
      (action) =>
        action.type === 'RESOLVE_ABILITY' &&
        action.payload.abilityId ===
          SP_PR_020_ON_ENTER_LOW_COST_RELAY_PLAY_HAND_LOW_COST_MEMBER_ABILITY_ID
    )
    .at(-1)?.payload;
}

describe('PL!SP-PR-020 Kinako low-cost relay hand play workflow', () => {
  it('optionally plays a cost 4 or lower member from hand to an empty slot and triggers its ON_ENTER ability', () => {
    const scenario = setupState({});
    const started = startAbility(
      scenario.game,
      scenario.source.instanceId,
      scenario.replacement.instanceId
    );

    expect(started.activeEffect).toMatchObject({
      abilityId: SP_PR_020_ON_ENTER_LOW_COST_RELAY_PLAY_HAND_LOW_COST_MEMBER_ABILITY_ID,
      awaitingPlayerId: PLAYER1,
      selectableCardIds: [scenario.handCards[0].instanceId],
      canSkipSelection: true,
    });

    const afterCardSelection = confirmActiveEffectStep(
      started,
      PLAYER1,
      started.activeEffect!.id,
      scenario.handCards[0].instanceId
    );
    expect(afterCardSelection.activeEffect).toMatchObject({
      stepId: 'SP_PR_020_SELECT_EMPTY_SLOT',
      selectableSlots: [SlotPosition.LEFT, SlotPosition.RIGHT],
    });

    const state = confirmActiveEffectStep(
      afterCardSelection,
      PLAYER1,
      afterCardSelection.activeEffect!.id,
      undefined,
      SlotPosition.LEFT
    );

    expect(state.players[0].hand.cardIds).not.toContain(scenario.handCards[0].instanceId);
    expect(state.players[0].memberSlots.slots[SlotPosition.LEFT]).toBe(
      scenario.handCards[0].instanceId
    );
    expect(state.players[0].memberSlots.cardStates.get(scenario.handCards[0].instanceId)).toEqual({
      orientation: OrientationState.ACTIVE,
      face: FaceState.FACE_UP,
    });
    expect(
      state.actionHistory.some(
        (action) =>
          action.type === 'TRIGGER_ABILITY' &&
          action.payload.abilityId ===
            SP_BP4_001_ON_ENTER_LIELLA_STAGE_SEVEN_ENERGY_PLACE_WAITING_ENERGY_ABILITY_ID &&
          action.payload.sourceCardId === scenario.handCards[0].instanceId
      )
    ).toBe(true);
    expect(latestPayload(state)).toMatchObject({
      step: 'PLAY_HAND_LOW_COST_MEMBER_TO_EMPTY_SLOT',
      selectedCardId: scenario.handCards[0].instanceId,
      toSlot: SlotPosition.LEFT,
    });
  });

  it.each([
    { name: 'non-relay enter', includeRelayMetadata: false, replacementEffectiveCost: 9 },
    {
      name: 'replacement cost is not lower',
      includeRelayMetadata: true,
      replacementEffectiveCost: 17,
    },
  ])(
    'consumes pending as no-op for $name',
    ({ includeRelayMetadata, replacementEffectiveCost }) => {
      const scenario = setupState({ replacementEffectiveCost });
      const state = startAbility(
        scenario.game,
        scenario.source.instanceId,
        scenario.replacement.instanceId,
        {
          includeRelayMetadata,
          replacementEffectiveCost,
        }
      );

      expect(state.activeEffect).toBeNull();
      expect(state.pendingAbilities).toHaveLength(0);
      expect(state.players[0].hand.cardIds).toEqual([scenario.handCards[0].instanceId]);
      expect(latestPayload(state)).toMatchObject({
        conditionMet: false,
      });
    }
  );

  it('consumes pending as no-op when there is no legal hand target', () => {
    const highCostMember = createMember('PL!SP-test-high-cost', 'sp-pr-020-high-cost', {
      cost: 5,
    });
    const liveCard = createCardInstance(
      {
        cardCode: 'PL!SP-test-live',
        name: 'Live',
        groupNames: ['Liella!'],
        cardType: CardType.LIVE,
        score: 1,
        requirements: [],
      },
      PLAYER1,
      'sp-pr-020-live'
    );
    const scenario = setupState({ handCards: [highCostMember, liveCard] });
    const state = startAbility(
      scenario.game,
      scenario.source.instanceId,
      scenario.replacement.instanceId
    );

    expect(state.activeEffect).toBeNull();
    expect(state.pendingAbilities).toHaveLength(0);
    expect(latestPayload(state)).toMatchObject({
      step: 'NO_OP_NO_LOW_COST_HAND_MEMBER',
      selectableCardIds: [],
    });
  });

  it('consumes pending as no-op when there is no empty member slot', () => {
    const scenario = setupState({ fillAllSlots: true });
    const state = startAbility(
      scenario.game,
      scenario.source.instanceId,
      scenario.replacement.instanceId
    );

    expect(state.activeEffect).toBeNull();
    expect(state.pendingAbilities).toHaveLength(0);
    expect(latestPayload(state)).toMatchObject({
      step: 'NO_OP_NO_EMPTY_STAGE_SLOT',
      emptySlots: [],
    });
  });

  it('lets the player skip without changing hand or stage', () => {
    const scenario = setupState({});
    const started = startAbility(
      scenario.game,
      scenario.source.instanceId,
      scenario.replacement.instanceId
    );
    const state = confirmActiveEffectStep(started, PLAYER1, started.activeEffect!.id, null);

    expect(state.activeEffect).toBeNull();
    expect(state.pendingAbilities).toHaveLength(0);
    expect(state.players[0].hand.cardIds).toEqual([scenario.handCards[0].instanceId]);
    expect(state.players[0].memberSlots.slots[SlotPosition.LEFT]).toBeNull();
    expect(latestPayload(state)).toMatchObject({
      step: 'DECLINE_PLAY_HAND_LOW_COST_MEMBER',
    });
  });

  it('does not allow selecting high-cost, non-member, opponent, or no-longer-in-hand cards', () => {
    const valid = createMember('PL!SP-test-valid-low-cost', 'sp-pr-020-valid', { cost: 4 });
    const highCost = createMember('PL!SP-test-high-cost', 'sp-pr-020-high-cost', { cost: 5 });
    const opponentMember = createMember(
      'PL!SP-test-opponent-member',
      'sp-pr-020-opponent-member',
      { cost: 4 },
      PLAYER2
    );
    const scenario = setupState({ handCards: [valid, highCost, opponentMember] });
    let started = startAbility(
      scenario.game,
      scenario.source.instanceId,
      scenario.replacement.instanceId
    );

    expect(started.activeEffect?.selectableCardIds).toEqual([valid.instanceId]);
    expect(
      confirmActiveEffectStep(started, PLAYER1, started.activeEffect!.id, highCost.instanceId)
    ).toBe(started);
    expect(
      confirmActiveEffectStep(started, PLAYER1, started.activeEffect!.id, opponentMember.instanceId)
    ).toBe(started);

    started = updatePlayer(started, PLAYER1, (player) => ({
      ...player,
      hand: {
        ...player.hand,
        cardIds: player.hand.cardIds.filter((cardId) => cardId !== valid.instanceId),
      },
    }));
    expect(
      confirmActiveEffectStep(started, PLAYER1, started.activeEffect!.id, valid.instanceId)
    ).toBe(started);
  });
});
