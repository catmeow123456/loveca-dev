import { describe, expect, it } from 'vitest';
import {
  confirmActiveEffectStep,
  enqueueTriggeredCardEffects,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import { S_CL1_004_AUTO_ON_CHEER_TWO_LIVES_WAIT_OPPONENT_ORIGINAL_HEART_FOUR_ABILITY_ID as ABILITY } from '../../src/application/card-effects/ability-ids';
import {
  createCardInstance,
  createHeartRequirement,
  type MemberCardData,
} from '../../src/domain/entities/card';
import {
  createGameState,
  emitGameEvent,
  registerCards,
  updatePlayer,
  type GameState,
} from '../../src/domain/entities/game';
import { placeCardInSlot, removeCardFromSlot } from '../../src/domain/entities/zone';
import { createCheerEvent, createEnterStageEvent } from '../../src/domain/events/game-events';
import {
  addHeartLiveModifierForTargetMember,
  addLiveModifier,
} from '../../src/domain/rules/live-modifiers';
import { addMemberWaitProtectionUntilLiveEnd } from '../../src/domain/rules/member-wait-protections';
import {
  CardType,
  FaceState,
  HeartColor,
  OrientationState as O,
  SlotPosition as S,
  TriggerCondition as T,
  ZoneType,
} from '../../src/shared/types/enums';
import { addCheckTimingRuleSentinel } from '../helpers/check-timing-rule-sentinel';

const member = (code: string, heartCount = 1): MemberCardData => ({
  cardCode: code,
  name: code,
  cardType: CardType.MEMBER,
  cost: 15,
  blade: 1,
  hearts: [{ color: HeartColor.RED, count: heartCount }],
  groupNames: ['Aqours'],
});
function put(game: GameState, owner: string, slot: S, id: string, orientation = O.ACTIVE) {
  return updatePlayer(game, owner, (p) => ({
    ...p,
    memberSlots: placeCardInSlot(p.memberSlots, slot, id, { orientation, face: FaceState.FACE_UP }),
  }));
}
function setup(slot = S.CENTER): GameState {
  let game = registerCards(createGameState('cl1-dia', 'p1', 'P1', 'p2', 'P2'), [
    createCardInstance(member('PL!S-cl1-004-CL', 5), 'p1', 'dia'),
    ...[0, 1, 2].map((i) =>
      createCardInstance(
        {
          cardCode: `live-${i}`,
          name: `LIVE ${i}`,
          cardType: CardType.LIVE as const,
          score: 1,
          requirements: createHeartRequirement({}),
        },
        'p1',
        `live${i}`
      )
    ),
    createCardInstance(member('low', 4), 'p2', 'low'),
    createCardInstance(member('high', 5), 'p2', 'high'),
    createCardInstance(member('waiting'), 'p2', 'waiting'),
  ]);
  game = put(game, 'p1', slot, 'dia');
  game = put(
    put(put(game, 'p2', S.LEFT, 'low'), 'p2', S.CENTER, 'high'),
    'p2',
    S.RIGHT,
    'waiting',
    O.WAITING
  );
  game = emitGameEvent(game, createEnterStageEvent('dia', ZoneType.HAND, slot, 'p1', 'p1'));
  game = {
    ...game,
    liveResolution: { ...game.liveResolution, isInLive: true, performingPlayerId: 'p1' },
  };
  return addCheckTimingRuleSentinel(addCheckTimingRuleSentinel(game, 'p1', 'dia1'), 'p2', 'dia2');
}
function cheer(game: GameState, ids = ['live0', 'live1'], playerId = 'p1', additional = false) {
  const event = createCheerEvent(playerId, ids, ids.length, { additional, automated: true });
  const key = playerId === 'p1' ? 'firstPlayerCheerCardIds' : 'secondPlayerCheerCardIds';
  const state = emitGameEvent(
    {
      ...game,
      resolutionZone: {
        ...game.resolutionZone,
        cardIds: [...new Set([...game.resolutionZone.cardIds, ...ids])],
        revealedCardIds: [...new Set([...game.resolutionZone.revealedCardIds, ...ids])],
      },
      liveResolution: {
        ...game.liveResolution,
        [key]: [...new Set([...game.liveResolution[key], ...ids])],
      },
    },
    event
  );
  return enqueueTriggeredCardEffects(state, [T.ON_CHEER], { cheerEvents: [event] });
}
const start = (game: GameState) => resolvePendingCardEffects(game).gameState;
const choose = (game: GameState, id = 'low') =>
  confirmActiveEffectStep(game, 'p1', game.activeEffect!.id, id);
const confirm = (game: GameState) => confirmActiveEffectStep(game, 'p1', game.activeEffect!.id);
const uses = (game: GameState) =>
  game.actionHistory.filter(
    (a) => a.payload.abilityId === ABILITY && a.payload.step === 'ABILITY_USE'
  );
const orientation = (game: GameState, id = 'low') =>
  game.players[1].memberSlots.cardStates.get(id)?.orientation;

describe('PL!S-cl1-004 费用15「黑泽黛雅」 center ON_CHEER conditional wait', () => {
  it.each([0, 1, 2])(
    'checks %i revealed LIVE cards and consumes one use only after resolution starts',
    (count) => {
      const queued = cheer(setup(), ['live0', 'live1'].slice(0, count));
      expect(queued.pendingAbilities.filter((p) => p.abilityId === ABILITY)).toHaveLength(1);
      const waiting = start(queued);
      if (count < 2) {
        expect(waiting.activeEffect?.metadata?.confirmOnlyPendingAbility).toBe(true);
        expect(uses(waiting)).toHaveLength(0);
        const done = confirm(waiting);
        expect(orientation(done)).toBe(O.ACTIVE);
        expect(uses(done)).toHaveLength(1);
        expect(cheer(done).pendingAbilities.filter((p) => p.abilityId === ABILITY)).toHaveLength(0);
      } else {
        expect(waiting.activeEffect?.selectableCardIds).toEqual(['low']);
        expect(waiting.activeEffect?.canSkipSelection).toBe(false);
        const done = choose(waiting);
        expect(orientation(done)).toBe(O.WAITING);
        expect(uses(done)).toHaveLength(1);
        expect(
          done.eventLog.filter(({ event }) => event.eventType === T.ON_MEMBER_STATE_CHANGED)
        ).toHaveLength(1);
      }
    }
  );

  it.each([S.LEFT, S.RIGHT])('does not trigger outside center at %s', (slot) => {
    expect(cheer(setup(slot)).pendingAbilities.filter((p) => p.abilityId === ABILITY)).toEqual([]);
  });
  it.each(['opponent', 'additional'])('does not trigger for %s cheer', (kind) => {
    const game = cheer(
      setup(),
      ['live0', 'live1'],
      kind === 'opponent' ? 'p2' : 'p1',
      kind === 'additional'
    );
    expect(game.pendingAbilities.filter((p) => p.abilityId === ABILITY)).toEqual([]);
  });

  it('counts moved historical LIVE cards and earlier additional cheer without a second trigger', () => {
    let game = cheer(setup(), ['live0']);
    game = cheer(game, ['live1'], 'p1', true);
    expect(game.pendingAbilities.filter((p) => p.abilityId === ABILITY)).toHaveLength(1);
    game = updatePlayer(
      { ...game, resolutionZone: { ...game.resolutionZone, cardIds: [], revealedCardIds: [] } },
      'p1',
      (p) => ({ ...p, hand: { ...p.hand, cardIds: ['live0', 'live1'] } })
    );
    expect(orientation(choose(start(game)))).toBe(O.WAITING);
    const oldLive = {
      ...cheer(setup()),
      liveResolution: { ...game.liveResolution, firstPlayerCheerCardIds: ['live0'] },
    };
    expect(start(oldLive).activeEffect?.metadata?.confirmOnlyPendingAbility).toBe(true);
  });

  it.each(['move', 'leave'])('resolves its captured center invocation after source %s', (kind) => {
    let game = cheer(setup());
    game = updatePlayer(game, 'p1', (p) => ({
      ...p,
      memberSlots: removeCardFromSlot(p.memberSlots, S.CENTER),
    }));
    if (kind === 'move') game = put(game, 'p1', S.LEFT, 'dia');
    expect(orientation(choose(start(game)))).toBe(O.WAITING);
  });

  it('keeps old and new source lifecycles separate after departure and reentry', () => {
    let game = cheer(setup());
    const original = game.pendingAbilities.find((p) => p.abilityId === ABILITY)!.sourceLifecycleId;
    game = emitGameEvent(
      game,
      createEnterStageEvent('dia', ZoneType.WAITING_ROOM, S.CENTER, 'p1', 'p1')
    );
    game = choose(start(game));
    expect(uses(game)[0]?.payload.sourceLifecycleId).toBe(original);
    game = put(game, 'p2', S.LEFT, 'low');
    game = cheer(game);
    expect(game.pendingAbilities.filter((p) => p.abilityId === ABILITY)).toHaveLength(1);
    const current = game.pendingAbilities.find((p) => p.abilityId === ABILITY)!.sourceLifecycleId;
    expect(current).not.toBe(original);
    expect(uses(choose(start(game))).map((a) => a.payload.sourceLifecycleId)).toEqual([
      original,
      current,
    ]);
  });

  it('uses original Heart replacement and ignores ordinary gained Hearts', () => {
    let game = addHeartLiveModifierForTargetMember(cheer(setup()), {
      playerId: 'p2',
      sourceCardId: 'dia',
      targetMemberCardId: 'low',
      abilityId: 'bonus',
      hearts: [{ color: HeartColor.BLUE, count: 7 }],
    })!.gameState;
    expect(start(game).activeEffect?.selectableCardIds).toContain('low');
    game = addLiveModifier(game, {
      kind: 'MEMBER_ORIGINAL_HEART_REPLACEMENT',
      playerId: 'p2',
      sourceCardId: 'dia',
      memberCardId: 'high',
      abilityId: 'replace',
      hearts: [{ color: HeartColor.YELLOW, count: 4 }],
    });
    expect(start(game).activeEffect?.selectableCardIds).toEqual(['low', 'high']);
  });

  it('filters protected targets, rejects illegal/skipped input, and refreshes a reentered target without a second use', () => {
    const waiting = start(cheer(setup()));
    expect(choose(waiting, 'high')).toBe(waiting);
    expect(confirm(waiting)).toBe(waiting);
    expect(confirmActiveEffectStep(waiting, 'p1', waiting.activeEffect!.id, 'low', S.CENTER)).toBe(
      waiting
    );
    expect(
      confirmActiveEffectStep(
        waiting,
        'p1',
        waiting.activeEffect!.id,
        'low',
        undefined,
        undefined,
        undefined,
        undefined,
        1
      )
    ).toBe(waiting);
    let reentered = emitGameEvent(
      waiting,
      createEnterStageEvent('low', ZoneType.WAITING_ROOM, S.LEFT, 'p2', 'p2')
    );
    reentered = choose(reentered);
    expect(orientation(reentered)).toBe(O.ACTIVE);
    expect(uses(reentered)).toHaveLength(1);
    expect(orientation(choose(reentered))).toBe(O.WAITING);
    const protectedGame = addMemberWaitProtectionUntilLiveEnd(cheer(setup()), {
      affectedPlayerId: 'p2',
      sourceCardId: 'low',
      abilityId: 'protect',
    });
    const confirmation = start(protectedGame);
    expect(confirmation.activeEffect?.metadata?.confirmOnlyPendingAbility).toBe(true);
    expect(uses(confirm(confirmation))).toHaveLength(1);
  });
});
