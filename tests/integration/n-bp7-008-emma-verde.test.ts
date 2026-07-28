import { describe, expect, it } from 'vitest';
import {
  confirmActiveEffectStep,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import { N_BP7_008_ON_ENTER_BOTTOM_UP_TO_FOUR_NO_BLADE_HEART_MEMBERS_ACTIVATE_ENERGY_ABILITY_ID } from '../../src/application/card-effects/ability-ids';
import {
  CardAbilityCategory,
  CardAbilitySourceZone,
} from '../../src/application/card-effects/ability-definition-types';
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
import {
  addCardToStatefulZone,
  placeCardInSlot,
  removeCardFromStatefulZone,
} from '../../src/domain/entities/zone';
import {
  BladeHeartEffect,
  CardType,
  FaceState,
  HeartColor,
  OrientationState,
  SlotPosition,
  TriggerCondition,
} from '../../src/shared/types/enums';

const P1 = 'p1';
const P2 = 'p2';
const ABILITY_ID =
  N_BP7_008_ON_ENTER_BOTTOM_UP_TO_FOUR_NO_BLADE_HEART_MEMBERS_ACTIVATE_ENERGY_ABILITY_ID;
const EFFECT_TEXT =
  '【登场】可以从自己的休息室将至多4张不持有BLADE HEART的成员卡按任意顺序放置于卡组底。每有1张因此放置的卡片，将1张能量变为活跃状态。';

function member(
  code: string,
  id: string,
  options: { readonly ownerId?: string; readonly hasBladeHeart?: boolean } = {}
) {
  const data: MemberCardData = {
    cardCode: code,
    name: id,
    groupNames: ['虹ヶ咲'],
    cardType: CardType.MEMBER,
    cost: 1,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.BLUE, 1)],
    bladeHearts: options.hasBladeHeart ? [{ effect: BladeHeartEffect.DRAW }] : [],
  };
  return createCardInstance(data, options.ownerId ?? P1, id);
}

function live(code: string, id: string) {
  const data: LiveCardData = {
    cardCode: code,
    name: id,
    groupNames: ['虹ヶ咲'],
    cardType: CardType.LIVE,
    score: 1,
    requirements: createHeartRequirement({}),
    bladeHearts: [],
  };
  return createCardInstance(data, P1, id);
}

function energy(id: string) {
  return createCardInstance({ cardCode: id, name: id, cardType: CardType.ENERGY }, P1, id);
}

function pending(sourceCardId: string, suffix = 'main'): PendingAbilityState {
  return {
    id: `n-bp7-008:${suffix}`,
    abilityId: ABILITY_ID,
    sourceCardId,
    controllerId: P1,
    mandatory: true,
    timingId: TriggerCondition.ON_ENTER_STAGE,
    eventIds: [],
    sourceSlot: SlotPosition.CENTER,
  };
}

function setup(
  options: {
    readonly candidateCount?: number;
    readonly waitingEnergyCount?: number;
    readonly activeEnergyCount?: number;
    readonly markedWaitingIndices?: readonly number[];
    readonly continuation?: boolean;
  } = {}
) {
  const source = member('PL!N-bp7-008-P', 'emma');
  const candidates = Array.from({ length: options.candidateCount ?? 4 }, (_, index) =>
    member(`N-BP7-008-CANDIDATE-${index}`, `candidate-${index}`)
  );
  const bladeMember = member('BLADE-MEMBER', 'blade-member', { hasBladeHeart: true });
  const liveWithoutBladeHeart = live('LIVE-NO-BLADE', 'live-no-blade');
  const opponentMember = member('OPPONENT-MEMBER', 'opponent-member', { ownerId: P2 });
  const waitingEnergies = Array.from({ length: options.waitingEnergyCount ?? 4 }, (_, index) =>
    energy(`waiting-energy-${index}`)
  );
  const activeEnergies = Array.from({ length: options.activeEnergyCount ?? 0 }, (_, index) =>
    energy(`active-energy-${index}`)
  );
  let game = registerCards(createGameState('n-bp7-008', P1, 'P1', P2, 'P2'), [
    source,
    ...candidates,
    bladeMember,
    liveWithoutBladeHeart,
    opponentMember,
    ...waitingEnergies,
    ...activeEnergies,
  ]);
  game = updatePlayer(game, P1, (player) => ({
    ...player,
    memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, source.instanceId, {
      orientation: OrientationState.ACTIVE,
      face: FaceState.FACE_UP,
    }),
    waitingRoom: {
      ...player.waitingRoom,
      cardIds: [
        ...candidates.map((card) => card.instanceId),
        bladeMember.instanceId,
        liveWithoutBladeHeart.instanceId,
        opponentMember.instanceId,
      ],
    },
    energyZone: [...waitingEnergies, ...activeEnergies].reduce(
      (zone, card, index) =>
        addCardToStatefulZone(zone, card.instanceId, {
          orientation:
            index < waitingEnergies.length ? OrientationState.WAITING : OrientationState.ACTIVE,
          face: FaceState.FACE_UP,
        }),
      player.energyZone
    ),
  }));
  game = {
    ...game,
    energyActivePhaseSkips: (options.markedWaitingIndices ?? []).map((index) => ({
      playerId: P1,
      energyCardId: waitingEnergies[index]!.instanceId,
      sourceCardId: source.instanceId,
      abilityId: 'marker',
    })),
    pendingAbilities: [
      pending(source.instanceId),
      ...(options.continuation ? [pending(source.instanceId, 'continuation')] : []),
    ],
  };
  game = resolvePendingCardEffects(game).gameState;
  return {
    game,
    source,
    candidates,
    bladeMember,
    liveWithoutBladeHeart,
    opponentMember,
    waitingEnergies,
    activeEnergies,
  };
}

function submitCards(game: GameState, selectedCardIds: readonly string[]): GameState {
  return confirmActiveEffectStep(
    game,
    P1,
    game.activeEffect!.id,
    selectedCardIds.length === 0 ? null : undefined,
    null,
    false,
    null,
    selectedCardIds.length === 0 ? undefined : selectedCardIds
  );
}

function finishPublicConfirmation(game: GameState): GameState {
  return confirmActiveEffectStep(game, P1, game.activeEffect!.id);
}

describe('PL!N-bp7-008-P 费用15「艾玛·维尔德」', () => {
  it('registers exact player-visible text for all rarities through the base card code', () => {
    const definition = getCardAbilityDefinitionsForCardCode('PL!N-bp7-008-P').find(
      (candidate) => candidate.abilityId === ABILITY_ID
    );
    expect(definition).toMatchObject({
      abilityId: ABILITY_ID,
      baseCardCodes: ['PL!N-bp7-008'],
      category: CardAbilityCategory.ON_ENTER,
      sourceZone: CardAbilitySourceZone.PLAYED_MEMBER,
      triggerCondition: TriggerCondition.ON_ENTER_STAGE,
      queued: true,
      implemented: true,
      effectText: EFFECT_TEXT,
    });
    expect(
      getCardAbilityDefinitionsForCardCode('PL!N-bp7-008-SEC').some(
        (candidate) => candidate.abilityId === ABILITY_ID
      )
    ).toBe(true);
  });

  it('offers only own waiting-room MEMBER cards without BLADE HEART and uses stable copy', () => {
    const scenario = setup();
    expect(scenario.game.activeEffect).toMatchObject({
      effectText: EFFECT_TEXT,
      selectableCardIds: scenario.candidates.map((card) => card.instanceId),
      selectableCardVisibility: 'PUBLIC',
      selectableCardMode: 'ORDERED_MULTI',
      minSelectableCards: 0,
      maxSelectableCards: 4,
      selectionLabel: '按放置顺序选择卡片',
      confirmSelectionLabel: '按此顺序放置于卡组底',
      canSkipSelection: true,
      skipSelectionLabel: '不放置',
    });
    for (const illegalCardId of [
      scenario.bladeMember.instanceId,
      scenario.liveWithoutBladeHeart.instanceId,
      scenario.opponentMember.instanceId,
    ]) {
      expect(submitCards(scenario.game, [illegalCardId])).toBe(scenario.game);
    }
  });

  it('supports skip and rejects excessive, duplicate, and non-candidate submissions', () => {
    const skipped = setup();
    const skippedState = submitCards(skipped.game, []);
    expect(skippedState.activeEffect).toBeNull();
    expect(skippedState.players[0].mainDeck.cardIds).toEqual([]);

    const invalid = setup({ candidateCount: 5 });
    const ids = invalid.candidates.map((card) => card.instanceId);
    for (const selected of [ids, [ids[0]!, ids[0]!], [invalid.bladeMember.instanceId]]) {
      expect(submitCards(invalid.game, selected)).toBe(invalid.game);
    }
  });

  it.each([
    { candidateCount: 2, waitingEnergyCount: 1, selectedCount: 2, activatedCount: 1 },
    { candidateCount: 4, waitingEnergyCount: 4, selectedCount: 4, activatedCount: 4 },
  ])(
    'moves in selected order and activates the actual safe count ($candidateCount candidates)',
    ({ candidateCount, waitingEnergyCount, selectedCount, activatedCount }) => {
      const scenario = setup({ candidateCount, waitingEnergyCount });
      const selectedCardIds = scenario.candidates
        .slice(0, selectedCount)
        .map((card) => card.instanceId)
        .reverse();
      const reveal = submitCards(scenario.game, selectedCardIds);
      expect(reveal.players[0].waitingRoom.cardIds).toEqual(
        expect.arrayContaining(selectedCardIds)
      );
      expect(reveal.players[0].mainDeck.cardIds).toEqual([]);
      expect(reveal.activeEffect?.revealedCardIds).toEqual(selectedCardIds);

      const done = finishPublicConfirmation(reveal);
      expect(done.players[0].mainDeck.cardIds).toEqual(selectedCardIds);
      expect(
        scenario.waitingEnergies.filter(
          (card) =>
            done.players[0].energyZone.cardStates.get(card.instanceId)?.orientation ===
            OrientationState.ACTIVE
        )
      ).toHaveLength(activatedCount);
      const movementEvents = done.eventLog
        .map((entry) => entry.event)
        .filter(
          (event) => event.eventType === TriggerCondition.ON_WAITING_ROOM_CARDS_MOVED_TO_MAIN_DECK
        );
      expect(movementEvents).toHaveLength(1);
      expect(movementEvents[0]).toMatchObject({
        movedCardIds: selectedCardIds,
        destination: { kind: 'BOTTOM' },
        cause: {
          kind: 'CARD_EFFECT',
          playerId: P1,
          sourceCardId: scenario.source.instanceId,
          abilityId: ABILITY_ID,
        },
      });
      expect(done.activeEffect).toBeNull();
    }
  );

  it('uses the common exact energy-selection adapter before atomically moving cards and activating energy', () => {
    const scenario = setup({
      candidateCount: 3,
      waitingEnergyCount: 5,
      markedWaitingIndices: [0],
    });
    const movedCardIds = scenario.candidates.map((card) => card.instanceId);
    const reveal = submitCards(scenario.game, movedCardIds);
    const energyStep = finishPublicConfirmation(reveal);
    expect(energyStep.players[0].mainDeck.cardIds).toEqual([]);
    expect(energyStep.players[0].waitingRoom.cardIds).toEqual(expect.arrayContaining(movedCardIds));
    expect(
      scenario.waitingEnergies.every(
        (card) =>
          energyStep.players[0].energyZone.cardStates.get(card.instanceId)?.orientation ===
          OrientationState.WAITING
      )
    ).toBe(true);
    expect(energyStep.activeEffect).toMatchObject({
      stepId: 'COMMON_ENERGY_OPERATION_SELECTION',
      stepText: '请选择要变为活跃状态的待机能量。',
      selectableCardIds: scenario.waitingEnergies.map((card) => card.instanceId),
      minSelectableCards: 3,
      maxSelectableCards: 3,
      selectionLabel: '选择要变为活跃的能量',
      confirmSelectionLabel: '变为活跃',
      canSkipSelection: false,
    });
    expect(energyStep.activeEffect?.metadata?.publicCardSelectionConfirmation).toBeUndefined();
    expect(energyStep.activeEffect?.skipSelectionLabel).toBeUndefined();
    expect(energyStep.activeEffect?.revealedCardIds).toBeUndefined();

    const selectedEnergyCardIds = [
      scenario.waitingEnergies[0]!.instanceId,
      scenario.waitingEnergies[2]!.instanceId,
      scenario.waitingEnergies[4]!.instanceId,
    ];
    expect(
      submitCards(energyStep, [
        selectedEnergyCardIds[0]!,
        selectedEnergyCardIds[0]!,
        selectedEnergyCardIds[2]!,
      ])
    ).toBe(energyStep);
    expect(
      submitCards(energyStep, [
        selectedEnergyCardIds[0]!,
        selectedEnergyCardIds[1]!,
        scenario.candidates[0]!.instanceId,
      ])
    ).toBe(energyStep);
    const done = submitCards(energyStep, selectedEnergyCardIds);
    expect(done.activeEffect).toBeNull();
    expect(done.players[0].mainDeck.cardIds).toEqual(movedCardIds);
    expect(
      selectedEnergyCardIds.map(
        (cardId) => done.players[0].energyZone.cardStates.get(cardId)?.orientation
      )
    ).toEqual([OrientationState.ACTIVE, OrientationState.ACTIVE, OrientationState.ACTIVE]);
  });

  it('cancels the whole public-card move when any selected member becomes stale', () => {
    const scenario = setup({ candidateCount: 2, waitingEnergyCount: 2 });
    const selectedCardIds = scenario.candidates.map((card) => card.instanceId);
    const reveal = submitCards(scenario.game, selectedCardIds);
    const stale = updatePlayer(reveal, P1, (player) => ({
      ...player,
      waitingRoom: {
        ...player.waitingRoom,
        cardIds: player.waitingRoom.cardIds.filter((cardId) => cardId !== selectedCardIds[1]),
      },
      hand: addCardToStatefulZone(player.hand, selectedCardIds[1]!),
    }));
    const done = finishPublicConfirmation(stale);
    expect(done.players[0].mainDeck.cardIds).toEqual([]);
    expect(done.players[0].waitingRoom.cardIds).toContain(selectedCardIds[0]);
    expect(done.players[0].hand.cardIds).toContain(selectedCardIds[1]);
    expect(done.activeEffect).toBeNull();
  });

  it('rejects a stale energy selection without moving cards or advancing the effect', () => {
    const scenario = setup({
      candidateCount: 3,
      waitingEnergyCount: 5,
      markedWaitingIndices: [0],
    });
    const movedCardIds = scenario.candidates.map((card) => card.instanceId);
    const energyStep = finishPublicConfirmation(submitCards(scenario.game, movedCardIds));
    const removedEnergyId = scenario.waitingEnergies[0]!.instanceId;
    const staleEnergyState = updatePlayer(energyStep, P1, (player) => ({
      ...player,
      energyZone: removeCardFromStatefulZone(player.energyZone, removedEnergyId),
      energyDeck: {
        ...player.energyDeck,
        cardIds: [...player.energyDeck.cardIds, removedEnergyId],
      },
    }));
    const submittedIds = scenario.waitingEnergies.slice(0, 3).map((card) => card.instanceId);
    const done = submitCards(staleEnergyState, submittedIds);
    expect(done).toBe(staleEnergyState);
    expect(done.players[0].mainDeck.cardIds).toEqual([]);
    expect(done.players[0].waitingRoom.cardIds).toEqual(expect.arrayContaining(movedCardIds));
    expect(done.activeEffect?.stepId).toBe('COMMON_ENERGY_OPERATION_SELECTION');
    expect(
      scenario.waitingEnergies
        .slice(1, 4)
        .every(
          (card) =>
            done.players[0].energyZone.cardStates.get(card.instanceId)?.orientation ===
            OrientationState.WAITING
        )
    ).toBe(true);
  });

  it('returns through continuation after common energy selection replays the card move', () => {
    const scenario = setup({
      candidateCount: 2,
      waitingEnergyCount: 3,
      markedWaitingIndices: [0],
      continuation: true,
    });
    const firstCardId = scenario.candidates[0]!.instanceId;
    const firstWindow = confirmActiveEffectStep(
      scenario.game,
      P1,
      scenario.game.activeEffect!.id,
      undefined,
      undefined,
      false,
      'n-bp7-008:main'
    );
    const energyStep = finishPublicConfirmation(submitCards(firstWindow, [firstCardId]));
    expect(energyStep.activeEffect?.stepId).toBe('COMMON_ENERGY_OPERATION_SELECTION');
    expect(energyStep.players[0].mainDeck.cardIds).toEqual([]);
    const selectedEnergyCardId = scenario.waitingEnergies[1]!.instanceId;
    const afterFirst = submitCards(energyStep, [selectedEnergyCardId]);
    expect(afterFirst.players[0].mainDeck.cardIds).toEqual([firstCardId]);
    expect(afterFirst.players[0].energyZone.cardStates.get(selectedEnergyCardId)?.orientation).toBe(
      OrientationState.ACTIVE
    );
    expect(afterFirst.activeEffect).toMatchObject({
      abilityId: ABILITY_ID,
      selectableCardIds: [scenario.candidates[1]!.instanceId],
    });
    expect(afterFirst.pendingAbilities).toEqual([]);
  });
});
