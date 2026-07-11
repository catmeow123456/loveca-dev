import { describe, expect, it } from 'vitest';
import type { EnergyCardData, LiveCardData, MemberCardData } from '../../src/domain/entities/card';
import { createCardInstance, createHeartIcon, createHeartRequirement } from '../../src/domain/entities/card';
import { createGameState, registerCards, updatePlayer, type GameState, type PendingAbilityState } from '../../src/domain/entities/game';
import { addCardToZone, placeCardInSlot } from '../../src/domain/entities/zone';
import { addLiveModifier } from '../../src/domain/rules/live-modifiers';
import { confirmActiveEffectStep, resolvePendingCardEffects } from '../../src/application/card-effect-runner';
import { HS_PR_035_ON_ENTER_BOTTOM_THREE_OPPONENT_WAITING_MEMBERS_WAIT_LOW_BLADE_ABILITY_ID } from '../../src/application/card-effects/ability-ids';
import { CardType, FaceState, HeartColor, OrientationState, SlotPosition, TriggerCondition } from '../../src/shared/types/enums';

const PLAYER1 = 'player1';
const PLAYER2 = 'player2';

function member(id: string, ownerId: string, blade = 1) {
  return createCardInstance<MemberCardData>({
    cardCode: id,
    name: id,
    groupNames: ['蓮ノ空'],
    cardType: CardType.MEMBER,
    cost: 1,
    blade,
    hearts: [createHeartIcon(HeartColor.PINK, 1)],
  }, ownerId, id);
}

function live(id: string) {
  return createCardInstance<LiveCardData>({
    cardCode: id,
    name: id,
    groupNames: ['蓮ノ空'],
    cardType: CardType.LIVE,
    score: 1,
    requirements: createHeartRequirement({ [HeartColor.PINK]: 1 }),
  }, PLAYER2, id);
}

function energy(id: string) {
  return createCardInstance<EnergyCardData>({ cardCode: id, name: id, cardType: CardType.ENERGY }, PLAYER2, id);
}

function pending(sourceCardId: string, id = 'ginko-pending'): PendingAbilityState {
  return {
    id,
    abilityId: HS_PR_035_ON_ENTER_BOTTOM_THREE_OPPONENT_WAITING_MEMBERS_WAIT_LOW_BLADE_ABILITY_ID,
    sourceCardId,
    controllerId: PLAYER1,
    mandatory: true,
    timingId: TriggerCondition.ON_ENTER_STAGE,
    eventIds: [`${id}-enter`],
    sourceSlot: SlotPosition.CENTER,
  };
}

function setup(options: { waitingMemberCount?: number; includeNonMembers?: boolean; targetBlades?: readonly number[]; pendingCount?: number } = {}) {
  const source = member('PL!HS-PR-035-PR', PLAYER1, 4);
  const ownWaiting = member('own-waiting', PLAYER1);
  const waitingMembers = Array.from({ length: options.waitingMemberCount ?? 4 }, (_, index) => member(`opp-wait-${index}`, PLAYER2));
  const nonMembers = options.includeNonMembers ? [live('opp-live'), energy('opp-energy')] : [];
  const targets = (options.targetBlades ?? [3]).map((blade, index) => member(`target-${blade}-${index}`, PLAYER2, blade));
  const deckCards = [member('deck-a', PLAYER2), member('deck-b', PLAYER2)];
  let game = createGameState('hs-pr-035', PLAYER1, 'P1', PLAYER2, 'P2');
  game = registerCards(game, [source, ownWaiting, ...waitingMembers, ...nonMembers, ...targets, ...deckCards]);
  game = updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    waitingRoom: addCardToZone(player.waitingRoom, ownWaiting.instanceId),
    memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, source.instanceId, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }),
  }));
  game = updatePlayer(game, PLAYER2, (player) => {
    let memberSlots = player.memberSlots;
    const slots = [SlotPosition.LEFT, SlotPosition.CENTER, SlotPosition.RIGHT];
    for (const [index, target] of targets.entries()) {
      memberSlots = placeCardInSlot(memberSlots, slots[index]!, target.instanceId, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP });
    }
    return {
      ...player,
      waitingRoom: { ...player.waitingRoom, cardIds: [...waitingMembers, ...nonMembers].map((card) => card.instanceId) },
      mainDeck: { ...player.mainDeck, cardIds: deckCards.map((card) => card.instanceId) },
      memberSlots,
    };
  });
  return {
    game: { ...game, pendingAbilities: Array.from({ length: options.pendingCount ?? 1 }, (_, index) => pending(source.instanceId, `ginko-pending-${index}`)) },
    source,
    ownWaiting,
    waitingMembers,
    nonMembers,
    targets,
    deckCards,
  };
}

function chooseMany(game: GameState, cardIds: readonly string[]): GameState {
  return confirmActiveEffectStep(game, PLAYER1, game.activeEffect!.id, null, null, false, null, cardIds);
}

function chooseOne(game: GameState, cardId: string): GameState {
  return confirmActiveEffectStep(game, PLAYER1, game.activeEffect!.id, cardId);
}

describe('PL!HS-PR-035 百生吟子', () => {
  it('moves exactly the selected three in submitted bottom order, preserves the old deck, then waits one legal member with one event', () => {
    const scenario = setup();
    const first = resolvePendingCardEffects(scenario.game).gameState;
    expect(first.activeEffect).toMatchObject({ selectableCardMode: 'ORDERED_MULTI', selectableCardVisibility: 'PUBLIC', minSelectableCards: 3, maxSelectableCards: 3, canSkipSelection: true, skipSelectionLabel: '不发动' });
    expect(first.activeEffect?.selectableOptions).toBeUndefined();
    const order = [scenario.waitingMembers[2]!.instanceId, scenario.waitingMembers[0]!.instanceId, scenario.waitingMembers[3]!.instanceId];
    const second = chooseMany(first, order);
    expect(second.players[1].mainDeck.cardIds).toEqual([...scenario.deckCards.map((card) => card.instanceId), ...order]);
    expect(second.players[1].waitingRoom.cardIds).toEqual([scenario.waitingMembers[1]!.instanceId]);
    expect(second.activeEffect?.selectableCardIds).toEqual([scenario.targets[0]!.instanceId]);
    const resolved = chooseOne(second, scenario.targets[0]!.instanceId);
    expect(resolved.players[1].memberSlots.cardStates.get(scenario.targets[0]!.instanceId)?.orientation).toBe(OrientationState.WAITING);
    const events = resolved.eventLog.filter((entry) => entry.event.eventType === TriggerCondition.ON_MEMBER_STATE_CHANGED && entry.event.cardInstanceId === scenario.targets[0]!.instanceId);
    expect(events).toHaveLength(1);
    expect(resolved.actionHistory).toContainEqual(expect.objectContaining({ payload: expect.objectContaining({ step: 'BOTTOM_OPPONENT_WAITING_MEMBERS', selectedCardIds: order, movedCardIds: order }) }));
    expect(resolved.actionHistory).toContainEqual(expect.objectContaining({ payload: expect.objectContaining({ step: 'WAIT_OPPONENT_LOW_BLADE_MEMBER', targetCardId: scenario.targets[0]!.instanceId, nextOrientation: OrientationState.WAITING }) }));
  });

  it('only exposes opponent waiting-room members and keeps exact-three bounds when fewer than three exist', () => {
    const scenario = setup({ waitingMemberCount: 2, includeNonMembers: true });
    const started = resolvePendingCardEffects(scenario.game).gameState;
    expect(started.activeEffect?.selectableCardIds).toEqual(scenario.waitingMembers.map((card) => card.instanceId));
    expect(started.activeEffect).toMatchObject({ minSelectableCards: 3, maxSelectableCards: 3, canSkipSelection: true });
    expect(started.activeEffect?.selectableCardIds).not.toContain(scenario.ownWaiting.instanceId);
    const unchanged = chooseMany(started, scenario.waitingMembers.map((card) => card.instanceId));
    expect(unchanged).toBe(started);
    const skipped = chooseMany(started, []);
    expect(skipped.activeEffect).toBeNull();
    expect(skipped.pendingAbilities).toEqual([]);
    expect(skipped.players[1].waitingRoom.cardIds).toEqual(started.players[1].waitingRoom.cardIds);
  });

  it('declines with enough candidates without moving cards or waiting a member', () => {
    const scenario = setup();
    const started = resolvePendingCardEffects(scenario.game).gameState;
    const skipped = chooseMany(started, []);
    expect(skipped.players[1].waitingRoom.cardIds).toEqual(started.players[1].waitingRoom.cardIds);
    expect(skipped.players[1].mainDeck.cardIds).toEqual(started.players[1].mainDeck.cardIds);
    expect(skipped.players[1].memberSlots.cardStates.get(scenario.targets[0]!.instanceId)?.orientation).toBe(OrientationState.ACTIVE);
  });

  it('atomically rejects duplicate, wrong-count, non-candidate, wrong-zone and stale first-step selections', () => {
    const scenario = setup();
    const started = resolvePendingCardEffects(scenario.game).gameState;
    const valid = scenario.waitingMembers.slice(0, 3).map((card) => card.instanceId);
    for (const invalid of [[valid[0]!, valid[0]!, valid[1]!], valid.slice(0, 2), [...valid, scenario.waitingMembers[3]!.instanceId], [valid[0]!, valid[1]!, scenario.ownWaiting.instanceId]]) {
      const result = chooseMany(started, invalid);
      expect(result).toBe(started);
      expect(result.players[1].mainDeck.cardIds).toEqual(started.players[1].mainDeck.cardIds);
    }
    const stale = updatePlayer(started, PLAYER2, (player) => ({ ...player, waitingRoom: { ...player.waitingRoom, cardIds: player.waitingRoom.cardIds.filter((id) => id !== valid[0]) } }));
    expect(chooseMany(stale, valid)).toBe(stale);
    expect(chooseMany(started, [valid[0]!, valid[1]!, scenario.targets[0]!.instanceId])).toBe(started);
  });

  it('uses printed BLADE, excludes WAITING targets, and retains the first move when no second target exists', () => {
    const scenario = setup({ targetBlades: [3, 4] });
    let game = addLiveModifier(scenario.game, { kind: 'BLADE', target: 'TARGET_MEMBER', playerId: PLAYER2, targetMemberCardId: scenario.targets[0]!.instanceId, blade: 10, sourceCardId: 'boost', abilityId: 'boost' });
    game = addLiveModifier(game, { kind: 'BLADE', target: 'TARGET_MEMBER', playerId: PLAYER2, targetMemberCardId: scenario.targets[1]!.instanceId, blade: -10, sourceCardId: 'reduce', abilityId: 'reduce' });
    const second = chooseMany(resolvePendingCardEffects(game).gameState, scenario.waitingMembers.slice(0, 3).map((card) => card.instanceId));
    expect(second.activeEffect?.selectableCardIds).toEqual([scenario.targets[0]!.instanceId]);

    const noTargetScenario = setup({ targetBlades: [4] });
    const order = noTargetScenario.waitingMembers.slice(0, 3).map((card) => card.instanceId);
    const finished = chooseMany(resolvePendingCardEffects(noTargetScenario.game).gameState, order);
    expect(finished.activeEffect).toBeNull();
    expect(finished.players[1].mainDeck.cardIds.slice(-3)).toEqual(order);

    const waitingScenario = setup();
    const waitingGame = updatePlayer(waitingScenario.game, PLAYER2, (player) => ({ ...player, memberSlots: { ...player.memberSlots, cardStates: new Map(player.memberSlots.cardStates).set(waitingScenario.targets[0]!.instanceId, { orientation: OrientationState.WAITING, face: FaceState.FACE_UP }) } }));
    const waitingFinished = chooseMany(resolvePendingCardEffects(waitingGame).gameState, waitingScenario.waitingMembers.slice(0, 3).map((card) => card.instanceId));
    expect(waitingFinished.activeEffect).toBeNull();
  });

  it('rejects illegal or stale second-step targets without state changes or events', () => {
    const scenario = setup({ targetBlades: [3, 4] });
    const second = chooseMany(resolvePendingCardEffects(scenario.game).gameState, scenario.waitingMembers.slice(0, 3).map((card) => card.instanceId));
    expect(chooseOne(second, scenario.targets[1]!.instanceId)).toBe(second);
    const stale = updatePlayer(second, PLAYER2, (player) => ({ ...player, memberSlots: { ...player.memberSlots, slots: { ...player.memberSlots.slots, [SlotPosition.LEFT]: null }, cardStates: new Map([...player.memberSlots.cardStates].filter(([id]) => id !== scenario.targets[0]!.instanceId)) } }));
    const result = chooseOne(stale, scenario.targets[0]!.instanceId);
    expect(result).toBe(stale);
    expect(result.eventLog.filter((entry) => entry.event.eventType === TriggerCondition.ON_MEMBER_STATE_CHANGED)).toEqual([]);
  });

  it('continues two pending abilities through real windows and clears the queue after declining the second', () => {
    const scenario = setup({ waitingMemberCount: 6, pendingCount: 2 });
    const orderWindow = resolvePendingCardEffects(scenario.game).gameState;
    const selection = confirmActiveEffectStep(
      orderWindow,
      PLAYER1,
      orderWindow.activeEffect!.id,
      null,
      null,
      false,
      'ginko-pending-0'
    );
    const firstSecondStep = chooseMany(selection, scenario.waitingMembers.slice(0, 3).map((card) => card.instanceId));
    const secondFirstStep = chooseOne(firstSecondStep, scenario.targets[0]!.instanceId);
    expect(secondFirstStep.activeEffect).toMatchObject({ selectableCardMode: 'ORDERED_MULTI', metadata: { orderedResolution: false } });
    expect(secondFirstStep.activeEffect?.metadata?.confirmOnlyPendingAbility).not.toBe(true);
    expect(secondFirstStep.pendingAbilities).toEqual([]);
    const finished = chooseMany(secondFirstStep, []);
    expect(finished.activeEffect).toBeNull();
    expect(finished.pendingAbilities).toEqual([]);
  });
});
