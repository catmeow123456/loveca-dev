import { describe, expect, it } from 'vitest';
import type { LiveCardData, MemberCardData } from '../../src/domain/entities/card';
import { createCardInstance, createHeartIcon } from '../../src/domain/entities/card';
import {
  addLiveSetLimitReduction,
  createGameState,
  getLiveSetCardCountForPlayer,
  getLiveSetCardLimitForPlayer,
  registerCards,
  updatePlayer,
  type GameState,
  type PendingAbilityState,
} from '../../src/domain/entities/game';
import {
  addCardToStatefulZone,
  addCardToZone,
  placeCardInSlot,
  removeCardFromStatefulZone,
  removeCardFromZone,
} from '../../src/domain/entities/zone';
import { createEnterHandEvent, createEnterLiveZoneEvent } from '../../src/domain/events/game-events';
import { createConfirmSubPhaseAction, createSetLiveCardAction } from '../../src/application/actions';
import {
  confirmActiveEffectStep,
  enqueueTriggeredCardEffects,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import {
  PL_N_BP4_026_AUTO_FACE_UP_LIVE_ZONE_NIJIGASAKI_MEMBER_BLADE_ABILITY_ID,
  PL_N_BP4_026_AUTO_WAITING_TO_HAND_PLACE_DIVE_LIVE_ABILITY_ID,
} from '../../src/application/card-effects/ability-ids';
import { recoverCardsFromWaitingRoomToHandForPlayer } from '../../src/application/card-effects/runtime/actions';
import { GameService } from '../../src/application/game-service';
import {
  CardType,
  FaceState,
  GamePhase,
  HeartColor,
  OrientationState,
  SlotPosition,
  SubPhase,
  TriggerCondition,
  ZoneType,
} from '../../src/shared/types/enums';

const PLAYER1 = 'player1';
const PLAYER2 = 'player2';

function createDiveLive(instanceId: string, ownerId = PLAYER1, cardCode = 'PL!N-bp4-026-L') {
  return createCardInstance(createDiveLiveData(cardCode), ownerId, instanceId);
}

function createDiveLiveData(cardCode = 'PL!N-bp4-026-L'): LiveCardData {
  return {
    cardCode,
    name: 'DIVE!',
    groupNames: ['虹ヶ咲'],
    cardType: CardType.LIVE,
    score: 5,
    requirements: [],
  };
}

function createOtherLive(instanceId: string, name = 'Not DIVE!', ownerId = PLAYER1) {
  return createCardInstance(
    {
      cardCode: `LIVE-${instanceId}`,
      name,
      cardType: CardType.LIVE,
      score: 1,
      requirements: [],
    },
    ownerId,
    instanceId
  );
}

function createMember(
  instanceId: string,
  groupNames: readonly string[] = ['虹ヶ咲学園スクールアイドル同好会'],
  ownerId = PLAYER1
) {
  const data: MemberCardData = {
    cardCode: `MEMBER-${instanceId}`,
    name: instanceId,
    groupNames,
    cardType: CardType.MEMBER,
    cost: 4,
    blade: 0,
    hearts: [createHeartIcon(HeartColor.PINK, 1)],
  };
  return createCardInstance(data, ownerId, instanceId);
}

function mainPhase(game: GameState): GameState {
  return {
    ...game,
    currentPhase: GamePhase.MAIN_PHASE,
    activePlayerIndex: 0,
  };
}

function setupFirstAbility(options: { readonly includeTargetMember?: boolean } = {}) {
  const dive = createDiveLive('dive-source');
  const target = options.includeTargetMember === false ? null : createMember('niji-target');
  let game = createGameState('n-bp4-026-dive', PLAYER1, 'P1', PLAYER2, 'P2');
  game = registerCards(game, [dive, ...(target ? [target] : [])]);
  game = mainPhase(game);
  game = updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    waitingRoom: addCardToZone(player.waitingRoom, dive.instanceId),
    memberSlots: target
      ? placeCardInSlot(player.memberSlots, SlotPosition.CENTER, target.instanceId, {
          orientation: OrientationState.ACTIVE,
          face: FaceState.FACE_UP,
        })
      : player.memberSlots,
  }));
  return { game, dive, target };
}

function recoverDiveAndEnqueue(game: GameState, diveId: string): GameState {
  const recovery = recoverCardsFromWaitingRoomToHandForPlayer(game, PLAYER1, [diveId], {
    candidateCardIds: [diveId],
    exactCount: 1,
  });
  expect(recovery).not.toBeNull();
  return enqueueTriggeredCardEffects(recovery!.gameState, [TriggerCondition.ON_ENTER_HAND], {
    enterHandEvents: recovery!.enterHandEvents,
  });
}

function resolvePending(game: GameState): GameState {
  return resolvePendingCardEffects(game).gameState;
}

function pendingSecond(sourceCardId: string): PendingAbilityState {
  return {
    id: `${PL_N_BP4_026_AUTO_FACE_UP_LIVE_ZONE_NIJIGASAKI_MEMBER_BLADE_ABILITY_ID}:pending`,
    abilityId: PL_N_BP4_026_AUTO_FACE_UP_LIVE_ZONE_NIJIGASAKI_MEMBER_BLADE_ABILITY_ID,
    sourceCardId,
    controllerId: PLAYER1,
    mandatory: true,
    timingId: TriggerCondition.ON_ENTER_LIVE_ZONE,
    eventIds: ['enter-live-zone'],
  };
}

describe('PL!N-bp4-026-L DIVE! AUTO effects', () => {
  it('triggers from waiting room to hand in own main phase, places the recovered DIVE! face-up, reduces next Live Set limit, then starts the BLADE target selection', () => {
    const { game, dive, target } = setupFirstAbility();
    const queued = recoverDiveAndEnqueue(game, dive.instanceId);

    expect(queued.pendingAbilities).toHaveLength(1);
    expect(queued.pendingAbilities[0]).toMatchObject({
      abilityId: PL_N_BP4_026_AUTO_WAITING_TO_HAND_PLACE_DIVE_LIVE_ABILITY_ID,
      sourceCardId: dive.instanceId,
      timingId: TriggerCondition.ON_ENTER_HAND,
    });

    const started = resolvePending(queued);
    expect(started.activeEffect).toMatchObject({
      abilityId: PL_N_BP4_026_AUTO_WAITING_TO_HAND_PLACE_DIVE_LIVE_ABILITY_ID,
      selectableCardIds: [dive.instanceId],
      canSkipSelection: true,
    });

    const afterPlace = confirmActiveEffectStep(
      started,
      PLAYER1,
      started.activeEffect!.id,
      dive.instanceId
    );

    const player = afterPlace.players[0];
    expect(player.hand.cardIds).not.toContain(dive.instanceId);
    expect(player.liveZone.cardIds).toContain(dive.instanceId);
    expect(player.liveZone.cardStates.get(dive.instanceId)?.face).toBe(FaceState.FACE_UP);
    expect(getLiveSetCardLimitForPlayer(afterPlace, PLAYER1)).toBe(2);
    expect(afterPlace.liveSetLimitReductions).toEqual([
      expect.objectContaining({
        playerId: PLAYER1,
        sourceCardId: dive.instanceId,
        amount: 1,
      }),
    ]);
    expect(afterPlace.activeEffect).toMatchObject({
      abilityId: PL_N_BP4_026_AUTO_FACE_UP_LIVE_ZONE_NIJIGASAKI_MEMBER_BLADE_ABILITY_ID,
      selectableCardIds: [target!.instanceId],
    });
  });

  it('does not trigger from non-waiting-room source or a different card code, and main-phase no-op does not place or reduce', () => {
    const dive = createDiveLive('dive-source');
    const otherDive = createDiveLive('other-dive-card', PLAYER1, 'PL!N-test-999-L');
    let game = createGameState('n-bp4-026-negative', PLAYER1, 'P1', PLAYER2, 'P2');
    game = registerCards(game, [dive, otherDive]);
    game = mainPhase(game);
    game = updatePlayer(game, PLAYER1, (player) => ({
      ...player,
      hand: addCardToZone(addCardToZone(player.hand, dive.instanceId), otherDive.instanceId),
    }));

    const fromDeckEvent = createEnterHandEvent(
      [dive.instanceId],
      ZoneType.MAIN_DECK,
      PLAYER1,
      PLAYER1
    );
    const wrongCardEvent = createEnterHandEvent(
      [otherDive.instanceId],
      ZoneType.WAITING_ROOM,
      PLAYER1,
      PLAYER1
    );
    const queued = enqueueTriggeredCardEffects(game, [TriggerCondition.ON_ENTER_HAND], {
      enterHandEvents: [fromDeckEvent, wrongCardEvent],
    });
    expect(queued.pendingAbilities).toHaveLength(0);

    const waitingEvent = createEnterHandEvent(
      [dive.instanceId],
      ZoneType.WAITING_ROOM,
      PLAYER1,
      PLAYER1
    );
    const nonMainPhaseQueued = enqueueTriggeredCardEffects(
      { ...game, currentPhase: GamePhase.DRAW_PHASE },
      [TriggerCondition.ON_ENTER_HAND],
      { enterHandEvents: [waitingEvent] }
    );
    const resolved = resolvePending(nonMainPhaseQueued);
    expect(resolved.activeEffect).toBeNull();
    expect(resolved.players[0].liveZone.cardIds).not.toContain(dive.instanceId);
    expect(getLiveSetCardLimitForPlayer(resolved, PLAYER1)).toBe(3);
  });

  it('canceling or submitting a stale DIVE! selection does not place a card or reduce the next Live Set limit', () => {
    const { game, dive } = setupFirstAbility({ includeTargetMember: false });
    const started = resolvePending(recoverDiveAndEnqueue(game, dive.instanceId));

    const declined = confirmActiveEffectStep(started, PLAYER1, started.activeEffect!.id, null);
    expect(declined.players[0].liveZone.cardIds).toHaveLength(0);
    expect(getLiveSetCardLimitForPlayer(declined, PLAYER1)).toBe(3);

    const staleStarted = resolvePending(recoverDiveAndEnqueue(game, dive.instanceId));
    const staleGame = updatePlayer(staleStarted, PLAYER1, (player) => ({
      ...player,
      hand: removeCardFromZone(player.hand, dive.instanceId),
    }));
    const staleResult = confirmActiveEffectStep(
      staleGame,
      PLAYER1,
      staleGame.activeEffect!.id,
      dive.instanceId
    );
    expect(staleResult).toBe(staleGame);
  });

  it('counts only cards set during the Live Set phase when a DIVE! was pre-placed', () => {
    const prePlacedDive = createDiveLive('pre-placed-dive');
    const lives = [
      createOtherLive('set-live-1', 'Song 1'),
      createOtherLive('set-live-2', 'Song 2'),
      createOtherLive('set-live-3', 'Song 3'),
    ];
    const drawCards = [
      createMember('draw-card-1'),
      createMember('draw-card-2'),
      createMember('draw-card-3'),
    ];
    let game = createGameState('n-bp4-026-live-set-limit', PLAYER1, 'P1', PLAYER2, 'P2');
    game = registerCards(game, [prePlacedDive, ...lives, ...drawCards]);
    game = updatePlayer(game, PLAYER1, (player) => ({
      ...player,
      hand: lives.reduce((hand, card) => addCardToZone(hand, card.instanceId), player.hand),
      mainDeck: drawCards.reduce((deck, card) => addCardToZone(deck, card.instanceId), player.mainDeck),
      liveZone: addCardToStatefulZone(player.liveZone, prePlacedDive.instanceId, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      }),
    }));
    game = {
      ...addLiveSetLimitReduction(game, {
        playerId: PLAYER1,
        sourceCardId: prePlacedDive.instanceId,
        abilityId: PL_N_BP4_026_AUTO_WAITING_TO_HAND_PLACE_DIVE_LIVE_ABILITY_ID,
        amount: 1,
        expiresAt: 'NEXT_LIVE_SET_PHASE',
      }),
      currentPhase: GamePhase.LIVE_SET_PHASE,
      currentSubPhase: SubPhase.LIVE_SET_FIRST_PLAYER,
    };

    expect(game.players[0].liveZone.cardIds).toEqual([prePlacedDive.instanceId]);
    expect(getLiveSetCardLimitForPlayer(game, PLAYER1)).toBe(2);
    expect(getLiveSetCardCountForPlayer(game, PLAYER1)).toBe(0);

    const service = new GameService();
    const first = service.processAction(game, createSetLiveCardAction(PLAYER1, lives[0].instanceId));
    expect(first.success).toBe(true);
    expect(getLiveSetCardCountForPlayer(first.gameState, PLAYER1)).toBe(1);
    const second = service.processAction(
      first.gameState,
      createSetLiveCardAction(PLAYER1, lives[1].instanceId)
    );
    expect(second.success).toBe(true);
    expect(getLiveSetCardCountForPlayer(second.gameState, PLAYER1)).toBe(2);
    expect(second.gameState.players[0].liveZone.cardIds).toEqual([
      prePlacedDive.instanceId,
      lives[0].instanceId,
      lives[1].instanceId,
    ]);
    const third = service.processAction(
      second.gameState,
      createSetLiveCardAction(PLAYER1, lives[2].instanceId)
    );
    expect(third.success).toBe(false);
    expect(third.error).toContain('已达到 Live 卡放置上限');

    const consumed = service.processAction(
      second.gameState,
      createConfirmSubPhaseAction(PLAYER1, SubPhase.LIVE_SET_FIRST_PLAYER)
    );
    expect(consumed.success).toBe(true);
    expect(consumed.gameState.liveSetLimitReductions).toHaveLength(0);
    expect(getLiveSetCardCountForPlayer(consumed.gameState, PLAYER1)).toBe(0);
    expect(consumed.gameState.players[0].hand.cardIds).toHaveLength(3);

    const reducedToZero = addLiveSetLimitReduction(
      addLiveSetLimitReduction(consumed.gameState, {
        playerId: PLAYER1,
        sourceCardId: 'dive-1',
        abilityId: PL_N_BP4_026_AUTO_WAITING_TO_HAND_PLACE_DIVE_LIVE_ABILITY_ID,
        amount: 2,
        expiresAt: 'NEXT_LIVE_SET_PHASE',
      }),
      {
        playerId: PLAYER1,
        sourceCardId: 'dive-2',
        abilityId: PL_N_BP4_026_AUTO_WAITING_TO_HAND_PLACE_DIVE_LIVE_ABILITY_ID,
        amount: 2,
        expiresAt: 'NEXT_LIVE_SET_PHASE',
      }
    );
    expect(getLiveSetCardLimitForPlayer(reducedToZero, PLAYER1)).toBe(0);
  });

  it('face-up LIVE zone trigger lets a Nijigasaki stage member gain two BLADE and face-down/source-left/no-target paths no-op', () => {
    const dive = createDiveLive('dive-source');
    const target = createMember('niji-target');
    let game = createGameState('n-bp4-026-blade', PLAYER1, 'P1', PLAYER2, 'P2');
    game = registerCards(game, [dive, target]);
    game = updatePlayer(game, PLAYER1, (player) => ({
      ...player,
      liveZone: addCardToStatefulZone(player.liveZone, dive.instanceId, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      }),
      memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, target.instanceId, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      }),
    }));

    const event = createEnterLiveZoneEvent(
      dive.instanceId,
      ZoneType.WAITING_ROOM,
      PLAYER1,
      PLAYER1,
      FaceState.FACE_UP
    );
    const queued = enqueueTriggeredCardEffects(game, [TriggerCondition.ON_ENTER_LIVE_ZONE], {
      enterLiveZoneEvents: [event],
    });
    const started = resolvePending(queued);
    expect(started.activeEffect).toMatchObject({
      abilityId: PL_N_BP4_026_AUTO_FACE_UP_LIVE_ZONE_NIJIGASAKI_MEMBER_BLADE_ABILITY_ID,
      selectableCardIds: [target.instanceId],
    });

    const resolved = confirmActiveEffectStep(
      started,
      PLAYER1,
      started.activeEffect!.id,
      target.instanceId
    );
    expect(resolved.liveResolution.liveModifiers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'BLADE',
          sourceCardId: target.instanceId,
          countDelta: 2,
        }),
      ])
    );

    const faceDownEvent = createEnterLiveZoneEvent(
      dive.instanceId,
      ZoneType.HAND,
      PLAYER1,
      PLAYER1,
      FaceState.FACE_DOWN
    );
    const faceDownQueued = enqueueTriggeredCardEffects(game, [TriggerCondition.ON_ENTER_LIVE_ZONE], {
      enterLiveZoneEvents: [faceDownEvent],
    });
    expect(faceDownQueued.pendingAbilities).toHaveLength(0);

    const sourceLeftGame = updatePlayer(game, PLAYER1, (player) => ({
      ...player,
      liveZone: removeCardFromStatefulZone(player.liveZone, dive.instanceId),
    }));
    const sourceLeftResolved = resolvePending({
      ...sourceLeftGame,
      pendingAbilities: [pendingSecond(dive.instanceId)],
    });
    expect(sourceLeftResolved.activeEffect).toBeNull();

    const noTargetGame = updatePlayer(game, PLAYER1, (player) => ({
      ...player,
      memberSlots: {
        ...player.memberSlots,
        slots: { ...player.memberSlots.slots, [SlotPosition.CENTER]: null },
        cardStates: new Map(),
      },
    }));
    const noTargetResolved = resolvePending({
      ...noTargetGame,
      pendingAbilities: [pendingSecond(dive.instanceId)],
    });
    expect(noTargetResolved.activeEffect).toBeNull();
  });
});
