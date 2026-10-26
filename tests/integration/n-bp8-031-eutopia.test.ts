import { describe, expect, it } from 'vitest';
import {
  confirmActiveEffectStep,
  enqueueTriggeredCardEffects,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import { N_BP8_031_LIVE_SUCCESS_MOST_HEART_MEMBER_GAIN_SCORE_ABILITY_ID as ABILITY } from '../../src/application/card-effects/ability-ids';
import { returnLiveZoneCardToHandForPlayer } from '../../src/application/card-effects/runtime/actions';
import { sendStageMemberToWaitingRoomAndEnqueueLeaveStageTriggers } from '../../src/application/card-effects/runtime/leave-stage-triggers';
import { GameService } from '../../src/application/game-service';
import { createCardInstance, type LiveCardData } from '../../src/domain/entities/card';
import {
  emitGameEvent,
  registerCards,
  updatePlayer,
  type GameState,
} from '../../src/domain/entities/game';
import { addCardToZone, placeCardInSlot, removeCardFromZone } from '../../src/domain/entities/zone';
import { createEnterStageEvent, createLiveSuccessEvent } from '../../src/domain/events/game-events';
import {
  addLiveModifier,
  getMemberEffectiveHeartIcons,
  getPlayerLiveScoreModifier,
} from '../../src/domain/rules/live-modifiers';
import { LiveResolver } from '../../src/domain/rules/live-resolver';
import { HeartPool, createHeartCountsFromIcons } from '../../src/domain/value-objects/heart';
import {
  FaceState,
  GamePhase,
  HeartColor,
  OrientationState,
  SlotPosition,
  SubPhase,
  TriggerCondition,
  ZoneType,
} from '../../src/shared/types/enums';
import { gameWith, liveZone, member, P1, P2, stage } from '../helpers/modifier-workflow-fixtures';
import { getOctober26CardData } from '../helpers/october-26-card-effects';

function setup(
  options: {
    ownHearts?: number;
    opponentHearts?: number;
    opponentSuccess?: boolean;
    subPhase?: SubPhase;
  } = {}
) {
  const source = createCardInstance(getOctober26CardData('PL!N-bp8-031-SECL'), P1, 'eutopia');
  const opponentLive = createCardInstance(
    getOctober26CardData('PL!S-cl1-013-CL'),
    P2,
    'opponent-live'
  );
  const own = member('own', 'own', P1, {
    hearts: [{ color: HeartColor.PINK, count: options.ownHearts ?? 4 }],
  });
  const opponent = member('opponent', 'opponent', P2, {
    hearts: [{ color: HeartColor.BLUE, count: options.opponentHearts ?? 5 }],
  });
  let game = stage(stage(gameWith([source, opponentLive, own, opponent]), [own]), [opponent], P2);
  game = liveZone(liveZone(game, source), opponentLive);
  game = {
    ...game,
    currentPhase: GamePhase.LIVE_RESULT_PHASE,
    currentSubPhase: options.subPhase ?? SubPhase.RESULT_FIRST_SUCCESS_EFFECTS,
    liveResolution: {
      ...game.liveResolution,
      isInLive: true,
      liveResults: new Map([
        [source.instanceId, true],
        [opponentLive.instanceId, options.opponentSuccess !== false],
      ]),
      playerScores: new Map([
        [P1, 1],
        [P2, options.opponentSuccess === false ? 0 : 10],
      ]),
    },
  };
  return { game, source, opponentLive, own, opponent };
}

function enqueue(game: GameState, ids: readonly string[] = ['eutopia']): GameState {
  const event = createLiveSuccessEvent(P1, ids, 1);
  return enqueueTriggeredCardEffects(
    emitGameEvent(game, event),
    [TriggerCondition.ON_LIVE_SUCCESS],
    { liveSuccessEvents: [event] }
  );
}

function resolve(game: GameState): GameState {
  return resolvePendingCardEffects(game).gameState;
}

function finish(game: GameState): GameState {
  const preview = resolve(enqueue(game));
  expect(preview.activeEffect?.abilityId).toBe(ABILITY);
  return confirmActiveEffectStep(preview, P1, preview.activeEffect!.id);
}

function grants(game: GameState) {
  return game.liveResolution.liveModifiers.filter(
    (item) => item.kind === 'SCORE' && item.abilityId === ABILITY
  );
}

describe('PL!N-bp8-031 分数1「Eutopia」', () => {
  it('uses the real four-pink requirement and confirms before granting the opponent member a player-total bonus', () => {
    const { game, source } = setup();
    const live = source.data as LiveCardData;
    expect(live.score).toBe(1);
    expect(live.requirements.totalRequired).toBe(4);
    expect(
      new LiveResolver().judgeSingleLive(
        source.instanceId,
        live,
        new HeartPool(createHeartCountsFromIcons(getMemberEffectiveHeartIcons(game, P1, 'own')))
      ).isSuccess
    ).toBe(true);
    const preview = resolve(enqueue(game));
    expect(grants(preview)).toEqual([]);
    expect(preview.liveResolution.playerScores.get(P2)).toBe(10);
    const done = confirmActiveEffectStep(preview, P1, preview.activeEffect!.id);
    expect(grants(done)).toMatchObject([
      { playerId: P2, targetMemberCardId: 'opponent', sourceCardId: 'eutopia', countDelta: 1 },
    ]);
    expect(done.liveResolution.playerScores.get(P1)).toBe(1);
    expect(done.liveResolution.playerScores.get(P2)).toBe(11);
    expect(done.activeEffect).toBeNull();
    expect(done.pendingAbilities).toEqual([]);
  });

  it.each([SubPhase.RESULT_FIRST_SUCCESS_EFFECTS, SubPhase.RESULT_SECOND_SUCCESS_EFFECTS])(
    'updates the target owner draft irrespective of success-effect ordering: %s',
    (subPhase) => {
      const { game } = setup({ subPhase });
      const adjusted = {
        ...game,
        liveResolution: {
          ...game.liveResolution,
          playerScores: new Map([
            [P1, 11],
            [P2, 11],
          ]),
        },
      };
      const done = finish(adjusted);
      expect(done.liveResolution.playerScores.get(P2)).toBe(12);
      expect(grants(done)).toHaveLength(1);
      const result = new GameService().resolveLiveWinner({
        ...done,
        liveResolution: { ...done.liveResolution, scoreConfirmedBy: [P1, P2] },
      });
      expect(result.gameState.liveResolution.liveWinnerIds).toEqual([P2]);
      expect(
        new GameService().executeLiveResultPhase(done).gameState.liveResolution.playerScores.get(P2)
      ).toBe(12);
    }
  );

  it('grants to the opponent even when that player failed, without creating a score for a failed LIVE', () => {
    const done = finish(setup({ opponentSuccess: false }).game);
    expect(grants(done)).toMatchObject([{ playerId: P2, targetMemberCardId: 'opponent' }]);
    expect(getPlayerLiveScoreModifier(done.liveResolution, P2)).toBe(1);
    expect(done.liveResolution.playerScores.get(P2)).toBe(0);
    const result = new GameService().resolveLiveWinner({
      ...done,
      liveResolution: { ...done.liveResolution, scoreConfirmedBy: [P1, P2] },
    });
    expect(result.gameState.liveResolution.liveWinnerIds).toEqual([P1]);
  });

  it('grants to its own member when that member is strictly highest', () => {
    const done = finish(setup({ ownHearts: 6 }).game);
    expect(grants(done)).toMatchObject([{ playerId: P1, targetMemberCardId: 'own' }]);
    expect(done.liveResolution.playerScores.get(P1)).toBe(2);
    expect(done.liveResolution.playerScores.get(P2)).toBe(10);
  });

  it('does not grant on a tie and does not accept an old confirmation twice', () => {
    const preview = resolve(enqueue(setup({ ownHearts: 5 }).game));
    const effectId = preview.activeEffect!.id;
    expect(preview.activeEffect?.stepText).toContain('不授予能力');
    const done = confirmActiveEffectStep(preview, P1, effectId);
    expect(grants(done)).toEqual([]);
    expect(done.liveResolution.playerScores.get(P2)).toBe(10);
    expect(confirmActiveEffectStep(done, P1, effectId)).toBe(done);
  });

  it('recomputes the recipient after preview, including current continuous and temporary Hearts, then fixes the grant', () => {
    const preview = resolve(enqueue(setup().game));
    const oldOwn = preview.cardRegistry.get('own')!;
    // This existing continuous card gains one red Heart in a side slot.
    let changed = registerCards(preview, [
      { ...oldOwn, data: { ...oldOwn.data, cardCode: 'PL!SP-bp7-009-P' } },
    ]);
    changed = addLiveModifier(changed, {
      kind: 'HEART',
      target: 'TARGET_MEMBER',
      playerId: P1,
      sourceCardId: 'temporary',
      targetMemberCardId: 'own',
      hearts: [{ color: HeartColor.GREEN, count: 1 }],
    });
    const done = confirmActiveEffectStep(changed, P1, changed.activeEffect!.id);
    expect(grants(done)).toMatchObject([{ playerId: P1, targetMemberCardId: 'own' }]);
    const newLeader = addLiveModifier(done, {
      kind: 'HEART',
      target: 'TARGET_MEMBER',
      playerId: P2,
      sourceCardId: 'later',
      targetMemberCardId: 'opponent',
      hearts: [{ color: HeartColor.BLUE, count: 20 }],
    });
    expect(grants(newLeader)).toEqual(grants(done));
    expect(newLeader.liveResolution.playerScores.get(P1)).toBe(2);
  });

  it('keeps grants when the source leaves, removes and subtracts them when the target leaves, and does not restore them on re-entry', () => {
    let done = finish(setup().game);
    done = returnLiveZoneCardToHandForPlayer(done, P1, 'eutopia')!.gameState;
    expect(grants(done)).toHaveLength(1);
    const left = sendStageMemberToWaitingRoomAndEnqueueLeaveStageTriggers(
      done,
      P2,
      'opponent',
      enqueueTriggeredCardEffects
    )!.gameState;
    expect(grants(left)).toEqual([]);
    expect(left.liveResolution.playerScores.get(P2)).toBe(10);
    let reentered = updatePlayer(left, P2, (player) => ({
      ...player,
      waitingRoom: removeCardFromZone(player.waitingRoom, 'opponent'),
      memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.RIGHT, 'opponent', {
        face: FaceState.FACE_UP,
        orientation: OrientationState.ACTIVE,
      }),
    }));
    reentered = emitGameEvent(
      reentered,
      createEnterStageEvent('opponent', ZoneType.WAITING_ROOM, SlotPosition.RIGHT, P2, P2)
    );
    expect(grants(reentered)).toEqual([]);
    expect(reentered.liveResolution.playerScores.get(P2)).toBe(10);
  });

  it('still grants the independent ability when its LIVE source leaves after triggering', () => {
    const queued = enqueue(setup().game);
    const returned = returnLiveZoneCardToHandForPlayer(queued, P1, 'eutopia')!.gameState;
    const preview = resolve(returned);
    const done = confirmActiveEffectStep(preview, P1, preview.activeEffect!.id);
    expect(grants(done)).toMatchObject([{ playerId: P2, targetMemberCardId: 'opponent' }]);
    expect(done.liveResolution.playerScores.get(P2)).toBe(11);
  });

  it('does not subtract an unapplied bonus from a failed target owner when the target leaves', () => {
    const done = finish(setup({ opponentSuccess: false }).game);
    const left = sendStageMemberToWaitingRoomAndEnqueueLeaveStageTriggers(
      done,
      P2,
      'opponent',
      enqueueTriggeredCardEffects
    )!.gameState;
    expect(grants(left)).toEqual([]);
    expect(left.liveResolution.playerScores.get(P2)).toBe(0);
  });

  it('keeps an applied bonus until the recipient leaves even after its only successful LIVE returns to hand', () => {
    const { game } = setup({ ownHearts: 6 });
    const adjusted = {
      ...game,
      liveResolution: {
        ...game.liveResolution,
        playerScores: new Map([
          [P1, 9],
          [P2, 10],
        ]),
      },
    };
    const done = finish(adjusted);
    expect(done.liveResolution.playerScores.get(P1)).toBe(10);
    const returned = returnLiveZoneCardToHandForPlayer(done, P1, 'eutopia')!.gameState;
    expect(returned.players[0].liveZone.cardIds).toEqual([]);
    expect(returned.players[0].successZone.cardIds).toEqual([]);
    expect(returned.liveResolution.liveResults.get('eutopia')).toBe(true);
    expect(returned.liveResolution.playerScores.get(P1)).toBe(10);
    const left = sendStageMemberToWaitingRoomAndEnqueueLeaveStageTriggers(
      returned,
      P1,
      'own',
      enqueueTriggeredCardEffects
    )!.gameState;
    expect(grants(left)).toEqual([]);
    expect(left.liveResolution.playerScores.get(P1)).toBe(9);
    const winner = new GameService().resolveLiveWinner({
      ...left,
      liveResolution: { ...left.liveResolution, scoreConfirmedBy: [P1, P2] },
    });
    expect(winner.gameState.liveResolution.liveWinnerIds).toEqual([P2]);
  });

  it('uses the current LIVE success fact when all of the recipient owner successful LIVEs have already returned to hand', () => {
    const { game } = setup();
    const adjusted = {
      ...game,
      liveResolution: {
        ...game.liveResolution,
        playerScores: new Map([
          [P1, 10],
          [P2, 10],
        ]),
      },
    };
    const returned = returnLiveZoneCardToHandForPlayer(adjusted, P2, 'opponent-live')!.gameState;
    const done = finish(returned);
    expect(grants(done)).toHaveLength(1);
    expect(done.liveResolution.playerScores.get(P2)).toBe(11);
    const winner = new GameService().resolveLiveWinner({
      ...done,
      liveResolution: { ...done.liveResolution, scoreConfirmedBy: [P1, P2] },
    });
    expect(winner.gameState.liveResolution.liveWinnerIds).toEqual([P2]);
    const left = sendStageMemberToWaitingRoomAndEnqueueLeaveStageTriggers(
      done,
      P2,
      'opponent',
      enqueueTriggeredCardEffects
    )!.gameState;
    expect(grants(left)).toEqual([]);
    expect(left.liveResolution.playerScores.get(P2)).toBe(10);
  });

  it('does not use an older success-zone LIVE without a successful result from this LIVE', () => {
    const { game } = setup({ opponentSuccess: false });
    const oldSuccess = createCardInstance(
      getOctober26CardData('PL!S-cl1-013-CL'),
      P2,
      'old-success'
    );
    const withOldSuccess = updatePlayer(registerCards(game, [oldSuccess]), P2, (player) => ({
      ...player,
      successZone: addCardToZone(player.successZone, oldSuccess.instanceId),
    }));
    const done = finish(withOldSuccess);
    expect(grants(done)).toHaveLength(1);
    expect(done.liveResolution.playerScores.get(P2)).toBe(0);
    const left = sendStageMemberToWaitingRoomAndEnqueueLeaveStageTriggers(
      done,
      P2,
      'opponent',
      enqueueTriggeredCardEffects
    )!.gameState;
    expect(left.liveResolution.playerScores.get(P2)).toBe(0);
  });

  it('preserves the grant through waiting and slot changes, and clears it at LIVE end', () => {
    const done = finish(setup().game);
    const moved = updatePlayer(done, P2, (player) => ({
      ...player,
      memberSlots: {
        ...player.memberSlots,
        slots: {
          ...player.memberSlots.slots,
          [SlotPosition.LEFT]: null,
          [SlotPosition.RIGHT]: 'opponent',
        },
        cardStates: new Map(player.memberSlots.cardStates).set('opponent', {
          face: FaceState.FACE_UP,
          orientation: OrientationState.WAITING,
        }),
      },
    }));
    expect(grants(moved)).toHaveLength(1);
    expect(moved.liveResolution.playerScores.get(P2)).toBe(11);
    const finalized = new GameService().finalizeLiveResult({
      ...moved,
      liveResolution: { ...moved.liveResolution, scoreConfirmedBy: [P1, P2] },
    });
    expect(finalized.success).toBe(true);
    expect(finalized.gameState.liveResolution.liveModifiers).toEqual([]);
  });

  it('independently stacks two real Eutopia sources on the same member', () => {
    const { game } = setup();
    const second = createCardInstance(
      getOctober26CardData('PL!N-bp8-031-SECL'),
      P1,
      'eutopia-second'
    );
    let state = liveZone(registerCards(game, [second]), second);
    state = {
      ...state,
      liveResolution: {
        ...state.liveResolution,
        liveResults: new Map(state.liveResolution.liveResults).set(second.instanceId, true),
      },
    };
    const queued = enqueue(state, ['eutopia', second.instanceId]);
    const order = resolvePendingCardEffects(queued).gameState;
    const done = confirmActiveEffectStep(
      order,
      P1,
      order.activeEffect!.id,
      undefined,
      undefined,
      true
    );
    expect(done.activeEffect).toBeNull();
    expect(grants(done)).toHaveLength(2);
    expect(done.liveResolution.playerScores.get(P2)).toBe(12);
  });
});
