import { describe, expect, it } from 'vitest';
import type { EnergyCardData, LiveCardData, MemberCardData } from '../../src/domain/entities/card';
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
import { addCardToZone, addCardToStatefulZone, placeCardInSlot, removeCardFromSlot } from '../../src/domain/entities/zone';
import {
  activateCardAbility,
  confirmActiveEffectStep,
} from '../../src/application/card-effect-runner';
import {
  HS_PB1_003_AUTO_HAND_TO_WAITING_GAIN_HEART_BLADE_ABILITY_ID,
  SP_SD2_006_ACTIVATED_PAY_TWO_ENERGY_DISCARD_RECOVER_LIELLA_LIVE_ABILITY_ID,
} from '../../src/application/card-effects/ability-ids';
import {
  CardType,
  FaceState,
  GamePhase,
  HeartColor,
  OrientationState,
  SlotPosition,
  SubPhase,
  TurnType,
} from '../../src/shared/types/enums';

const PLAYER1 = 'player1';
const PLAYER2 = 'player2';

function createKinako(): MemberCardData {
  return {
    cardCode: 'PL!SP-sd2-006-SD2',
    name: '桜小路きな子',
    groupNames: ['Liella!'],
    cardType: CardType.MEMBER,
    cost: 7,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.YELLOW, 1)],
  };
}

function createMember(
  cardCode: string,
  options: {
    readonly name?: string;
    readonly groupNames?: readonly string[];
    readonly unitName?: string;
  } = {}
): MemberCardData {
  return {
    cardCode,
    name: options.name ?? cardCode,
    groupNames: options.groupNames ?? ['Liella!'],
    unitName: options.unitName,
    cardType: CardType.MEMBER,
    cost: 2,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.YELLOW, 1)],
  };
}

function createLive(
  cardCode: string,
  groupNames: readonly string[] = ['Liella!']
): LiveCardData {
  return {
    cardCode,
    name: cardCode,
    groupNames,
    cardType: CardType.LIVE,
    score: 3,
    requirements: createHeartRequirement({ [HeartColor.YELLOW]: 1 }),
  };
}

function createEnergy(cardCode: string): EnergyCardData {
  return {
    cardCode,
    name: cardCode,
    cardType: CardType.ENERGY,
  };
}

function setupState(options: {
  readonly handCards?: readonly ReturnType<typeof createCardInstance>[];
  readonly waitingRoomCards?: readonly ReturnType<typeof createCardInstance>[];
  readonly activeEnergyCount?: number;
  readonly sourceOnStage?: boolean;
  readonly extraStageCards?: readonly {
    readonly card: ReturnType<typeof createCardInstance>;
    readonly slot: SlotPosition;
  }[];
} = {}): {
  readonly game: GameState;
  readonly sourceId: string;
  readonly energyIds: readonly string[];
} {
  const source = createCardInstance(createKinako(), PLAYER1, 'sp-sd2-006-source');
  const activeEnergyCount = options.activeEnergyCount ?? 2;
  const energyCards = Array.from({ length: Math.max(2, activeEnergyCount) }, (_, index) =>
    createCardInstance(createEnergy(`PL!SP-energy-${index}`), PLAYER1, `energy-${index}`)
  );
  const handCards =
    options.handCards ?? [
      createCardInstance(createMember('PL!SP-hand-member'), PLAYER1, 'hand-member'),
    ];
  const waitingRoomCards = options.waitingRoomCards ?? [];

  let game = {
    ...createGameState('sp-sd2-006-kinako', PLAYER1, 'P1', PLAYER2, 'P2'),
    currentPhase: GamePhase.MAIN_PHASE,
    currentSubPhase: SubPhase.MAIN_FREE,
    currentTurnType: TurnType.NORMAL,
    activePlayerIndex: 0,
  };
  game = registerCards(game, [
    source,
    ...energyCards,
    ...handCards,
    ...waitingRoomCards,
    ...(options.extraStageCards ?? []).map((entry) => entry.card),
  ]);
  game = updatePlayer(game, PLAYER1, (player) => {
    let memberSlots = player.memberSlots;
    if (options.sourceOnStage !== false) {
      memberSlots = placeCardInSlot(memberSlots, SlotPosition.CENTER, source.instanceId, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      });
    }
    for (const entry of options.extraStageCards ?? []) {
      memberSlots = placeCardInSlot(memberSlots, entry.slot, entry.card.instanceId, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      });
    }
    const energyZone = energyCards.reduce(
      (zone, card, index) =>
        addCardToStatefulZone(zone, card.instanceId, {
          orientation:
            index < activeEnergyCount ? OrientationState.ACTIVE : OrientationState.WAITING,
          face: FaceState.FACE_UP,
        }),
      player.energyZone
    );
    return {
      ...player,
      memberSlots,
      energyZone,
      hand: handCards.reduce((hand, card) => addCardToZone(hand, card.instanceId), player.hand),
      waitingRoom: waitingRoomCards.reduce(
        (waitingRoom, card) => addCardToZone(waitingRoom, card.instanceId),
        player.waitingRoom
      ),
    };
  });

  return {
    game,
    sourceId: source.instanceId,
    energyIds: energyCards.map((card) => card.instanceId),
  };
}

function activateKinako(game: GameState, sourceId: string): GameState {
  return activateCardAbility(
    game,
    PLAYER1,
    sourceId,
    SP_SD2_006_ACTIVATED_PAY_TWO_ENERGY_DISCARD_RECOVER_LIELLA_LIVE_ABILITY_ID
  );
}

function confirmSelection(game: GameState, selectedCardId: string): GameState {
  expect(game.activeEffect).not.toBeNull();
  return confirmActiveEffectStep(game, PLAYER1, game.activeEffect!.id, selectedCardId);
}

function latestPayload(game: GameState, step?: string) {
  return [...game.actionHistory]
    .reverse()
    .find(
      (action) =>
        action.type === 'RESOLVE_ABILITY' &&
        action.payload.abilityId ===
          SP_SD2_006_ACTIVATED_PAY_TWO_ENERGY_DISCARD_RECOVER_LIELLA_LIVE_ABILITY_ID &&
        (step === undefined || action.payload.step === step)
    )?.payload;
}

function latestPayCostPayload(game: GameState) {
  return [...game.actionHistory]
    .reverse()
    .find(
      (action) =>
        action.type === 'PAY_COST' &&
        action.payload.abilityId ===
          SP_SD2_006_ACTIVATED_PAY_TWO_ENERGY_DISCARD_RECOVER_LIELLA_LIVE_ABILITY_ID
    )?.payload;
}

function activeEnergyIds(game: GameState): readonly string[] {
  const player = game.players[0];
  return player.energyZone.cardIds.filter(
    (cardId) => player.energyZone.cardStates.get(cardId)?.orientation === OrientationState.ACTIVE
  );
}

function abilityUseCount(game: GameState): number {
  return game.actionHistory.filter(
    (action) =>
      action.type === 'RESOLVE_ABILITY' &&
      action.payload.abilityId ===
        SP_SD2_006_ACTIVATED_PAY_TWO_ENERGY_DISCARD_RECOVER_LIELLA_LIVE_ABILITY_ID &&
      action.payload.step === 'ABILITY_USE'
  ).length;
}

describe('PL!SP-sd2-006 Kinako activated recover Liella! LIVE workflow', () => {
  it('pays two energy, discards one hand card, then recovers a waiting room Liella! LIVE', () => {
    const discard = createCardInstance(createMember('PL!SP-hand-member'), PLAYER1, 'discard');
    const target = createCardInstance(createLive('PL!SP-waiting-live'), PLAYER1, 'target-live');
    const { game, sourceId, energyIds } = setupState({
      handCards: [discard],
      waitingRoomCards: [target],
    });

    let state = activateKinako(game, sourceId);
    expect(state.activeEffect?.selectableCardIds).toEqual([discard.instanceId]);

    state = confirmSelection(state, discard.instanceId);
    expect(latestPayCostPayload(state)).toMatchObject({
      amount: 2,
      energyCardIds: energyIds,
      discardedHandCardIds: [discard.instanceId],
    });
    expect(state.activeEffect?.selectableCardIds).toEqual([target.instanceId]);

    state = confirmSelection(state, target.instanceId);
    expect(state.players[0].hand.cardIds).toContain(target.instanceId);
    expect(state.players[0].waitingRoom.cardIds).toContain(discard.instanceId);
    expect(activeEnergyIds(state)).toEqual([]);
    expect(abilityUseCount(state)).toBe(1);
  });

  it('can recover the Liella! LIVE that was just discarded as the hand cost', () => {
    const discardLive = createCardInstance(createLive('PL!SP-discard-live'), PLAYER1, 'discard-live');
    const { game, sourceId } = setupState({
      handCards: [discardLive],
      waitingRoomCards: [],
    });

    let state = activateKinako(game, sourceId);
    state = confirmSelection(state, discardLive.instanceId);
    expect(state.activeEffect?.selectableCardIds).toEqual([discardLive.instanceId]);

    state = confirmSelection(state, discardLive.instanceId);
    expect(state.players[0].hand.cardIds).toContain(discardLive.instanceId);
    expect(state.players[0].waitingRoom.cardIds).not.toContain(discardLive.instanceId);
  });

  it.each([
    { name: 'energy insufficient', activeEnergyCount: 1, handCount: 1, sourceOnStage: true },
    { name: 'no hand', activeEnergyCount: 2, handCount: 0, sourceOnStage: true },
    { name: 'source left stage', activeEnergyCount: 2, handCount: 1, sourceOnStage: false },
  ])('does not open when $name', ({ activeEnergyCount, handCount, sourceOnStage }) => {
    const handCards = Array.from({ length: handCount }, (_, index) =>
      createCardInstance(createMember(`PL!SP-hand-${index}`), PLAYER1, `hand-${index}`)
    );
    const { game, sourceId } = setupState({
      activeEnergyCount,
      handCards,
      sourceOnStage,
    });

    const state = activateKinako(game, sourceId);

    expect(state.activeEffect).toBeNull();
    expect(latestPayCostPayload(state)).toBeUndefined();
  });

  it('does not open again after its turn-one use is recorded', () => {
    const discard = createCardInstance(createMember('PL!SP-hand-member'), PLAYER1, 'discard');
    const { game, sourceId } = setupState({ handCards: [discard], waitingRoomCards: [] });
    let state = activateKinako(game, sourceId);
    state = confirmSelection(state, discard.instanceId);
    expect(abilityUseCount(state)).toBe(1);

    const extraHand = createCardInstance(createMember('PL!SP-extra-hand'), PLAYER1, 'extra-hand');
    const extraEnergyA = createCardInstance(createEnergy('PL!SP-extra-energy-a'), PLAYER1, 'extra-energy-a');
    const extraEnergyB = createCardInstance(createEnergy('PL!SP-extra-energy-b'), PLAYER1, 'extra-energy-b');
    state = registerCards(state, [extraHand, extraEnergyA, extraEnergyB]);
    state = updatePlayer(state, PLAYER1, (player) => ({
      ...player,
      hand: addCardToZone(player.hand, extraHand.instanceId),
      energyZone: addCardToStatefulZone(
        addCardToStatefulZone(player.energyZone, extraEnergyA.instanceId, {
          orientation: OrientationState.ACTIVE,
          face: FaceState.FACE_UP,
        }),
        extraEnergyB.instanceId,
        {
          orientation: OrientationState.ACTIVE,
          face: FaceState.FACE_UP,
        }
      ),
    }));

    const second = activateKinako(state, sourceId);

    expect(second.activeEffect).toBeNull();
    expect(abilityUseCount(second)).toBe(1);
  });

  it('keeps paid costs and resolves no-op when no Liella! LIVE target exists after costs', () => {
    const discard = createCardInstance(createMember('PL!SP-hand-member'), PLAYER1, 'discard');
    const nonLiellaLive = createCardInstance(
      createLive('PL!N-non-liella-live', ['虹ヶ咲']),
      PLAYER1,
      'non-liella-live'
    );
    const { game, sourceId } = setupState({
      handCards: [discard],
      waitingRoomCards: [nonLiellaLive],
    });

    const state = confirmSelection(activateKinako(game, sourceId), discard.instanceId);

    expect(state.activeEffect).toBeNull();
    expect(state.players[0].hand.cardIds).not.toContain(discard.instanceId);
    expect(state.players[0].waitingRoom.cardIds).toEqual([
      nonLiellaLive.instanceId,
      discard.instanceId,
    ]);
    expect(activeEnergyIds(state)).toEqual([]);
    expect(latestPayload(state, 'NO_LIELLA_LIVE_TARGET_AFTER_COST')).toMatchObject({
      discardCardId: discard.instanceId,
    });
  });

  it('uses the hand-to-waiting trigger path for the discard cost', () => {
    const discard = createCardInstance(createMember('PL!SP-hand-member'), PLAYER1, 'discard');
    const triggerSource = createCardInstance(
      createMember('PL!HS-pb1-003-R', {
        name: '大沢瑠璃乃',
        groupNames: ['蓮ノ空'],
        unitName: 'みらくらぱーく！',
      }),
      PLAYER1,
      'hs-pb1-003-source'
    );
    const { game, sourceId } = setupState({
      handCards: [discard],
      waitingRoomCards: [],
      extraStageCards: [{ card: triggerSource, slot: SlotPosition.LEFT }],
    });

    const state = confirmSelection(activateKinako(game, sourceId), discard.instanceId);

    expect(
      state.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId ===
            HS_PB1_003_AUTO_HAND_TO_WAITING_GAIN_HEART_BLADE_ABILITY_ID &&
          action.payload.sourceCardId === triggerSource.instanceId &&
          action.payload.step === 'GAIN_PINK_HEART_AND_BLADE_FROM_HAND_TO_WAITING'
      )
    ).toBe(true);
  });

  it('does not open if the source leaves stage before activation', () => {
    const discard = createCardInstance(createMember('PL!SP-hand-member'), PLAYER1, 'discard');
    const { game, sourceId } = setupState({ handCards: [discard] });
    const sourceGone = updatePlayer(game, PLAYER1, (player) => ({
      ...player,
      memberSlots: removeCardFromSlot(player.memberSlots, SlotPosition.CENTER),
      waitingRoom: addCardToZone(player.waitingRoom, sourceId),
    }));

    const state = activateKinako(sourceGone, sourceId);

    expect(state.activeEffect).toBeNull();
    expect(latestPayCostPayload(state)).toBeUndefined();
  });
});
