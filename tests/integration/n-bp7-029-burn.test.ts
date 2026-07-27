import { describe, expect, it, vi } from 'vitest';
import {
  confirmActiveEffectStep,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import { N_BP7_029_LIVE_SUCCESS_RETURN_ENERGY_BELOW_SCORE_ABILITY_ID } from '../../src/application/card-effects/ability-ids';
import {
  CardAbilityCategory,
  CardAbilitySourceZone,
} from '../../src/application/card-effects/ability-definition-types';
import { getCardAbilityDefinitionsForCardCode } from '../../src/application/card-effects/definitions/lookup';
import { moveAllEnergyBelowMemberToEnergyZoneByCardEffect } from '../../src/application/effects/energy-below';
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
  addEnergyBelowMember,
  placeCardInSlot,
  removeCardFromStatefulZone,
  removeCardFromSlot,
} from '../../src/domain/entities/zone';
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
const ABILITY_ID = N_BP7_029_LIVE_SUCCESS_RETURN_ENERGY_BELOW_SCORE_ABILITY_ID;
const EFFECT_TEXT =
  '【LIVE成功时】可以将存在于自己的舞台的1名成员的下方的所有能量卡，以待机状态放置于自己的能量卡区。因此放置了大于等于1张能量卡，且自己的能量大于等于10张的场合，此卡的分数+1。';

function member(code: string, id: string, ownerId = P1) {
  const data: MemberCardData = {
    cardCode: code,
    name: id,
    groupNames: ['虹ヶ咲'],
    cardType: CardType.MEMBER,
    cost: 1,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.BLUE, 1)],
  };
  return createCardInstance(data, ownerId, id);
}

function live(code: string, id: string, ownerId = P1) {
  const data: LiveCardData = {
    cardCode: code,
    name: id,
    groupNames: ['虹ヶ咲'],
    cardType: CardType.LIVE,
    score: 7,
    requirements: createHeartRequirement({}),
  };
  return createCardInstance(data, ownerId, id);
}

function energy(id: string, ownerId = P1) {
  return createCardInstance({ cardCode: id, name: id, cardType: CardType.ENERGY }, ownerId, id);
}

function pending(sourceCardId: string, suffix = 'main'): PendingAbilityState {
  return {
    id: `n-bp7-029:${suffix}`,
    abilityId: ABILITY_ID,
    sourceCardId,
    controllerId: P1,
    mandatory: true,
    timingId: TriggerCondition.ON_LIVE_SUCCESS,
    eventIds: [],
  };
}

function setup(
  options: {
    readonly energyZoneCount?: number;
    readonly belowCounts?: readonly number[];
    readonly continuation?: boolean;
  } = {}
) {
  const source = live('PL!N-bp7-029-L', 'burn');
  const targets = [member('TARGET-LEFT', 'target-left'), member('TARGET-RIGHT', 'target-right')];
  const belowCounts = options.belowCounts ?? [1];
  const belowEnergies = belowCounts.map((count, targetIndex) =>
    Array.from({ length: count }, (_, index) => energy(`below-${targetIndex}-${index}`))
  );
  const zoneEnergies = Array.from({ length: options.energyZoneCount ?? 9 }, (_, index) =>
    energy(`zone-${index}`)
  );
  let game = registerCards(createGameState('n-bp7-029', P1, 'P1', P2, 'P2'), [
    source,
    ...targets,
    ...belowEnergies.flat(),
    ...zoneEnergies,
  ]);
  game = updatePlayer(game, P1, (player) => {
    let memberSlots = player.memberSlots;
    for (let index = 0; index < belowCounts.length; index += 1) {
      const slot = index === 0 ? SlotPosition.LEFT : SlotPosition.RIGHT;
      memberSlots = placeCardInSlot(memberSlots, slot, targets[index]!.instanceId, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      });
      for (const belowEnergy of belowEnergies[index]!) {
        memberSlots = addEnergyBelowMember(memberSlots, slot, belowEnergy.instanceId);
      }
    }
    return {
      ...player,
      memberSlots,
      liveZone: addCardToStatefulZone(player.liveZone, source.instanceId, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      }),
      energyZone: zoneEnergies.reduce(
        (zone, card, index) =>
          addCardToStatefulZone(zone, card.instanceId, {
            orientation: index % 2 === 0 ? OrientationState.ACTIVE : OrientationState.WAITING,
            face: index % 2 === 0 ? FaceState.FACE_DOWN : FaceState.FACE_UP,
          }),
        player.energyZone
      ),
    };
  });
  game = {
    ...game,
    pendingAbilities: [
      pending(source.instanceId),
      ...(options.continuation ? [pending(source.instanceId, 'continuation')] : []),
    ],
  };
  game = resolvePendingCardEffects(game).gameState;
  return { game, source, targets, belowEnergies, zoneEnergies };
}

function selectMember(game: GameState, selectedMemberCardId: string | null): GameState {
  return confirmActiveEffectStep(
    game,
    P1,
    game.activeEffect!.id,
    selectedMemberCardId,
    null,
    false,
    null
  );
}

function scoreModifiers(game: GameState) {
  return game.liveResolution.liveModifiers.filter(
    (modifier) => modifier.kind === 'SCORE' && modifier.abilityId === ABILITY_ID
  );
}

describe('PL!N-bp7-029-L 分数7「Burn!!」', () => {
  it('registers exact player-visible text for the base card across rarities', () => {
    const definition = getCardAbilityDefinitionsForCardCode('PL!N-bp7-029-L').find(
      (candidate) => candidate.abilityId === ABILITY_ID
    );
    expect(definition).toMatchObject({
      abilityId: ABILITY_ID,
      baseCardCodes: ['PL!N-bp7-029'],
      category: CardAbilityCategory.LIVE_SUCCESS,
      sourceZone: CardAbilitySourceZone.LIVE_CARD,
      triggerCondition: TriggerCondition.ON_LIVE_SUCCESS,
      queued: true,
      implemented: true,
      effectText: EFFECT_TEXT,
    });
    expect(
      getCardAbilityDefinitionsForCardCode('PL!N-bp7-029-SECL').some(
        (candidate) => candidate.abilityId === ABILITY_ID
      )
    ).toBe(true);
  });

  it('the atomic helper moves the complete stack as WAITING/FACE_UP and forwards one exact event', () => {
    const scenario = setup({ energyZoneCount: 0, belowCounts: [2] });
    const rawGame = {
      ...scenario.game,
      activeEffect: null,
      pendingAbilities: [],
      actionHistory: [],
      eventLog: [],
    };
    const enqueue = vi.fn((gameState: GameState) => gameState);
    const moved = moveAllEnergyBelowMemberToEnergyZoneByCardEffect(rawGame, {
      playerId: P1,
      targetMemberCardId: scenario.targets[0]!.instanceId,
      expectedEnergyCardIds: scenario.belowEnergies[0]!.map((card) => card.instanceId),
      cause: {
        kind: 'CARD_EFFECT',
        playerId: P1,
        sourceCardId: scenario.source.instanceId,
        abilityId: ABILITY_ID,
        pendingAbilityId: 'helper-pending',
      },
      enqueueTriggeredCardEffects: enqueue,
    });
    expect(moved?.movedEnergyCardIds).toEqual(
      scenario.belowEnergies[0]!.map((card) => card.instanceId)
    );
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(enqueue.mock.calls[0]?.[1]).toEqual([TriggerCondition.ON_ENERGY_PLACED_BY_CARD_EFFECT]);
    expect(enqueue.mock.calls[0]?.[2]?.energyPlacedByCardEffectEvents).toEqual([
      moved?.energyPlacedEvent,
    ]);
    expect(moved?.energyPlacedEvent).toMatchObject({
      targetPlayerId: P1,
      placedEnergyCardIds: scenario.belowEnergies[0]!.map((card) => card.instanceId),
      orientation: OrientationState.WAITING,
      cause: {
        kind: 'CARD_EFFECT',
        playerId: P1,
        sourceCardId: scenario.source.instanceId,
        abilityId: ABILITY_ID,
        pendingAbilityId: 'helper-pending',
      },
    });
    expect(moved?.gameState.players[0].memberSlots.energyBelow[SlotPosition.LEFT]).toEqual([]);
    for (const card of scenario.belowEnergies[0]!) {
      expect(moved?.gameState.players[0].energyZone.cardStates.get(card.instanceId)).toEqual({
        orientation: OrientationState.WAITING,
        face: FaceState.FACE_UP,
      });
    }
  });

  it('keeps the optional decision even with one target and uses player-facing action copy', () => {
    const scenario = setup({ belowCounts: [1] });
    expect(scenario.game.activeEffect).toMatchObject({
      effectText: EFFECT_TEXT,
      selectableCardIds: [scenario.targets[0]!.instanceId],
      selectableCardVisibility: 'PUBLIC',
      selectableCardMode: 'SINGLE',
      selectionLabel: '选择要将下方能量放置入能量区的成员',
      confirmSelectionLabel: '放置于能量区',
      canSkipSelection: true,
      skipSelectionLabel: '不发动',
    });
    const skipped = selectMember(scenario.game, null);
    expect(skipped.activeEffect).toBeNull();
    expect(skipped.players[0].memberSlots.energyBelow[SlotPosition.LEFT]).toHaveLength(1);
  });

  it('moves 9 -> 10 energy, emits one caused event, and grants source LIVE score +1', () => {
    const scenario = setup({ energyZoneCount: 9, belowCounts: [1] });
    const done = selectMember(scenario.game, scenario.targets[0]!.instanceId);
    const movedEnergyId = scenario.belowEnergies[0]![0]!.instanceId;
    expect(done.players[0].memberSlots.energyBelow[SlotPosition.LEFT]).toEqual([]);
    expect(done.players[0].energyZone.cardIds).toContain(movedEnergyId);
    expect(done.players[0].energyZone.cardStates.get(movedEnergyId)).toEqual({
      orientation: OrientationState.WAITING,
      face: FaceState.FACE_UP,
    });
    const placementEvents = done.eventLog
      .map((entry) => entry.event)
      .filter((event) => event.eventType === TriggerCondition.ON_ENERGY_PLACED_BY_CARD_EFFECT);
    expect(placementEvents).toHaveLength(1);
    expect(placementEvents[0]).toMatchObject({
      targetPlayerId: P1,
      placedEnergyCardIds: [movedEnergyId],
      orientation: OrientationState.WAITING,
      cause: {
        kind: 'CARD_EFFECT',
        playerId: P1,
        sourceCardId: scenario.source.instanceId,
        abilityId: ABILITY_ID,
        pendingAbilityId: 'n-bp7-029:main',
      },
    });
    expect(scoreModifiers(done)).toEqual([
      expect.objectContaining({
        kind: 'SCORE',
        playerId: P1,
        countDelta: 1,
        liveCardId: scenario.source.instanceId,
        sourceCardId: scenario.source.instanceId,
        abilityId: ABILITY_ID,
      }),
    ]);
    expect(done.liveResolution.playerScores.get(P1)).toBe(1);
    expect(done.actionHistory.at(-1)?.payload).toMatchObject({
      movedEnergyCardIds: [movedEnergyId],
      energyCountAfterMove: 10,
      scoreBonus: 1,
    });
  });

  it('moves every energy below as WAITING but gives no score when the updated count is below 10', () => {
    const scenario = setup({ energyZoneCount: 5, belowCounts: [2] });
    const movedIds = scenario.belowEnergies[0]!.map((card) => card.instanceId);
    const done = selectMember(scenario.game, scenario.targets[0]!.instanceId);
    expect(done.players[0].memberSlots.energyBelow[SlotPosition.LEFT]).toEqual([]);
    expect(done.players[0].energyZone.cardIds).toEqual(expect.arrayContaining(movedIds));
    expect(
      movedIds.map((cardId) => done.players[0].energyZone.cardStates.get(cardId)?.orientation)
    ).toEqual([OrientationState.WAITING, OrientationState.WAITING]);
    expect(scoreModifiers(done)).toEqual([]);
    expect(done.actionHistory.at(-1)?.payload).toMatchObject({
      movedEnergyCardIds: movedIds,
      energyCountAfterMove: 7,
      scoreBonus: 0,
    });
  });

  it('uses a confirm-only no-op when no stage member has energy below', () => {
    const scenario = setup({ belowCounts: [] });
    expect(scenario.game.activeEffect).toMatchObject({
      effectText: EFFECT_TEXT,
      stepText: '确认后结算此效果。',
    });
    const done = confirmActiveEffectStep(scenario.game, P1, scenario.game.activeEffect!.id);
    expect(done.activeEffect).toBeNull();
    expect(done.actionHistory.at(-1)?.payload).toMatchObject({
      step: 'NO_MEMBER_WITH_ENERGY_BELOW',
      movedEnergyCardIds: [],
      scoreBonus: 0,
    });
  });

  it('rejects an illegal member input without advancing', () => {
    const scenario = setup({ belowCounts: [1] });
    expect(selectMember(scenario.game, scenario.targets[1]!.instanceId)).toBe(scenario.game);
  });

  it('treats a stale source or target instance as a whole-effect no-op', () => {
    const sourceScenario = setup({ energyZoneCount: 9, belowCounts: [1] });
    const sourceStale = updatePlayer(sourceScenario.game, P1, (player) => ({
      ...player,
      liveZone: removeCardFromStatefulZone(player.liveZone, sourceScenario.source.instanceId),
      waitingRoom: {
        ...player.waitingRoom,
        cardIds: [...player.waitingRoom.cardIds, sourceScenario.source.instanceId],
      },
    }));
    const sourceDone = selectMember(sourceStale, sourceScenario.targets[0]!.instanceId);
    expect(sourceDone.players[0].memberSlots.energyBelow[SlotPosition.LEFT]).toHaveLength(1);
    expect(scoreModifiers(sourceDone)).toEqual([]);

    const targetScenario = setup({ energyZoneCount: 9, belowCounts: [1] });
    const targetStale = updatePlayer(targetScenario.game, P1, (player) => ({
      ...player,
      memberSlots: removeCardFromSlot(player.memberSlots, SlotPosition.LEFT),
    }));
    const targetDone = selectMember(targetStale, targetScenario.targets[0]!.instanceId);
    expect(targetDone.players[0].energyZone.cardIds).toHaveLength(9);
    expect(scoreModifiers(targetDone)).toEqual([]);
  });

  it('moves no subset when any snapshotted energy below becomes stale', () => {
    const scenario = setup({ energyZoneCount: 8, belowCounts: [2] });
    const [firstEnergy, secondEnergy] = scenario.belowEnergies[0]!;
    const stale = updatePlayer(scenario.game, P1, (player) => ({
      ...player,
      memberSlots: {
        ...player.memberSlots,
        energyBelow: {
          ...player.memberSlots.energyBelow,
          [SlotPosition.LEFT]: [firstEnergy!.instanceId],
        },
      },
      energyDeck: {
        ...player.energyDeck,
        cardIds: [...player.energyDeck.cardIds, secondEnergy!.instanceId],
      },
    }));
    const done = selectMember(stale, scenario.targets[0]!.instanceId);
    expect(done.players[0].memberSlots.energyBelow[SlotPosition.LEFT]).toEqual([
      firstEnergy!.instanceId,
    ]);
    expect(done.players[0].energyZone.cardIds).toHaveLength(8);
    expect(
      done.eventLog.filter(
        (entry) => entry.event.eventType === TriggerCondition.ON_ENERGY_PLACED_BY_CARD_EFFECT
      )
    ).toHaveLength(0);
    expect(scoreModifiers(done)).toEqual([]);
  });

  it('returns through continuation after the complete move and event enqueue', () => {
    const scenario = setup({
      energyZoneCount: 8,
      belowCounts: [1, 1],
      continuation: true,
    });
    const firstWindow = confirmActiveEffectStep(
      scenario.game,
      P1,
      scenario.game.activeEffect!.id,
      undefined,
      undefined,
      false,
      'n-bp7-029:main'
    );
    const afterFirst = selectMember(firstWindow, scenario.targets[0]!.instanceId);
    expect(afterFirst.activeEffect).toMatchObject({
      abilityId: ABILITY_ID,
      selectableCardIds: [scenario.targets[1]!.instanceId],
    });
    expect(afterFirst.pendingAbilities).toEqual([]);
    expect(
      afterFirst.eventLog.filter(
        (entry) => entry.event.eventType === TriggerCondition.ON_ENERGY_PLACED_BY_CARD_EFFECT
      )
    ).toHaveLength(1);
  });
});
