import { describe, expect, it } from 'vitest';
import {
  createCardInstance,
  createHeartIcon,
  type LiveCardData,
  type MemberCardData,
} from '../../src/domain/entities/card';
import {
  createGameState,
  registerCards,
  updatePlayer,
  type PendingAbilityState,
} from '../../src/domain/entities/game';
import { addCardToZone, placeCardInSlot } from '../../src/domain/entities/zone';
import {
  confirmActiveEffectStep,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import {
  MEMBER_ON_ENTER_DRAW_ONE_ABILITY_ID,
  PL_PB1_006_ON_ENTER_STACK_MUSE_LIVE_DRAW_IF_OPPONENT_WAITING_ABILITY_ID,
} from '../../src/application/card-effects/ability-ids';
import {
  CardType,
  FaceState,
  HeartColor,
  OrientationState,
  SlotPosition,
  TriggerCondition,
} from '../../src/shared/types/enums';

const P1 = 'p1',
  P2 = 'p2';
const member = (code: string): MemberCardData => ({
  cardCode: code,
  name: code,
  cardType: CardType.MEMBER,
  cost: 1,
  blade: 1,
  hearts: [createHeartIcon(HeartColor.PINK, 1)],
  groupNames: ["μ's"],
});
const live = (code: string, group = "μ's"): LiveCardData => ({
  cardCode: code,
  name: code,
  cardType: CardType.LIVE,
  score: 1,
  requiredHearts: [],
  groupNames: [group],
});
function setup(waiting = true, candidates = true) {
  const source = createCardInstance(member('PL!-pb1-006-R'), P1, 'source');
  const target = createCardInstance(live('muse-live'), P1, 'target');
  const wrong = createCardInstance(member('wrong-member'), P1, 'wrong');
  const draw = createCardInstance(member('draw'), P1, 'draw');
  const continuationDraw = createCardInstance(member('continuation-draw'), P1, 'continuation-draw');
  const continuationSource = createCardInstance(
    member('continuation-source'),
    P1,
    'continuation-source'
  );
  const opp = createCardInstance(member('opp'), P2, 'opp');
  let game = registerCards(createGameState('006', P1, 'P1', P2, 'P2'), [
    source,
    target,
    wrong,
    draw,
    continuationDraw,
    continuationSource,
    opp,
  ]);
  game = updatePlayer(game, P1, (p) => ({
    ...p,
    waitingRoom: candidates
      ? addCardToZone(addCardToZone(p.waitingRoom, target.instanceId), wrong.instanceId)
      : p.waitingRoom,
    mainDeck: addCardToZone(
      addCardToZone(p.mainDeck, continuationDraw.instanceId),
      draw.instanceId
    ),
  }));
  game = updatePlayer(game, P2, (p) => ({
    ...p,
    memberSlots: placeCardInSlot(p.memberSlots, SlotPosition.CENTER, opp.instanceId, {
      orientation: waiting ? OrientationState.WAITING : OrientationState.ACTIVE,
      face: FaceState.FACE_UP,
    }),
  }));
  const pending: PendingAbilityState = {
    id: 'pending',
    abilityId: PL_PB1_006_ON_ENTER_STACK_MUSE_LIVE_DRAW_IF_OPPONENT_WAITING_ABILITY_ID,
    sourceCardId: source.instanceId,
    controllerId: P1,
    mandatory: true,
    timingId: TriggerCondition.ON_ENTER_STAGE,
  };
  const continuationPending: PendingAbilityState = {
    id: 'continuation-pending',
    abilityId: MEMBER_ON_ENTER_DRAW_ONE_ABILITY_ID,
    sourceCardId: continuationSource.instanceId,
    controllerId: P1,
    mandatory: true,
    timingId: TriggerCondition.ON_ENTER_STAGE,
  };
  return {
    game: { ...game, pendingAbilities: [pending, continuationPending] },
    target,
    wrong,
    draw,
    continuationDraw,
  };
}

function expectContinuationResolved(
  game: ReturnType<typeof resolvePendingCardEffects>['gameState']
) {
  const action = game.actionHistory.find(
    (candidate) =>
      candidate.type === 'RESOLVE_ABILITY' &&
      candidate.payload.abilityId === MEMBER_ON_ENTER_DRAW_ONE_ABILITY_ID &&
      candidate.payload.step === 'ON_ENTER_DRAW_ONE'
  );
  expect(action).toBeDefined();
  expect(action?.payload.drawnCardIds).toHaveLength(1);
  expect(game.players[0].hand.cardIds).toContain(action?.payload.drawnCardIds?.[0]);
  expect(game.activeEffect).toBeNull();
}
function start006(game: ReturnType<typeof resolvePendingCardEffects>['gameState']) {
  const selection = resolvePendingCardEffects(game).gameState;
  return selection.activeEffect?.abilityId === 'system:select-pending-card-effect'
    ? confirmActiveEffectStep(selection, P1, selection.activeEffect.id, 'source')
    : selection;
}
function resolveContinuation(game: ReturnType<typeof resolvePendingCardEffects>['gameState']) {
  return game.activeEffect?.abilityId === 'system:select-pending-card-effect'
    ? confirmActiveEffectStep(game, P1, game.activeEffect.id, 'continuation-source')
    : game;
}
describe('PL!-pb1-006 西木野真姫', () => {
  it("offers only the own waiting-room μ's LIVE and stacks it before drawing for opponent WAITING", () => {
    const s = setup();
    const started = start006(s.game);
    expect(started.activeEffect?.selectableCardIds).toEqual([s.target.instanceId]);
    const done = resolveContinuation(
      confirmActiveEffectStep(started, P1, 'pending', s.target.instanceId)
    );
    expect(done.players[0].hand.cardIds).toContain(s.target.instanceId);
    expect(done.players[0].mainDeck.cardIds).toContain(s.draw.instanceId);
    expect(done.activeEffect).toBeNull();
    expect(done.pendingAbilities).toEqual([]);
    expectContinuationResolved(done);
  });
  it('skip and no-target still run the later draw condition without confirm-only', () => {
    for (const candidates of [true, false]) {
      const s = setup(true, candidates);
      const started = start006(s.game);
      const done = resolveContinuation(
        candidates ? confirmActiveEffectStep(started, P1, 'pending', null) : started
      );
      expect(done.players[0].hand.cardIds).toContain(s.draw.instanceId);
      expect(done.activeEffect).toBeNull();
      expectContinuationResolved(done);
    }
  });
  it('does not draw without an opponent WAITING member and rejects an ID never offered by the window', () => {
    const s = setup(false, true);
    const started = start006(s.game);
    const illegal = confirmActiveEffectStep(started, P1, 'pending', s.wrong.instanceId);
    expect(illegal).toBe(started);
    const done = resolveContinuation(confirmActiveEffectStep(started, P1, 'pending', null));
    expect(done.players[0].hand.cardIds).not.toContain(s.draw.instanceId);
    expectContinuationResolved(done);
  });

  it('safely consumes an originally selectable target that becomes stale and still draws for WAITING', () => {
    const s = setup(true, true);
    const started = start006(s.game);
    expect(started.activeEffect?.selectableCardIds).toContain(s.target.instanceId);
    const staleState = updatePlayer(started, P1, (player) => ({
      ...player,
      waitingRoom: {
        ...player.waitingRoom,
        cardIds: player.waitingRoom.cardIds.filter((id) => id !== s.target.instanceId),
      },
    }));
    const done = resolveContinuation(
      confirmActiveEffectStep(staleState, P1, 'pending', s.target.instanceId)
    );
    expect(done.players[0].mainDeck.cardIds).not.toContain(s.target.instanceId);
    expect(done.players[0].hand.cardIds).toContain(s.draw.instanceId);
    expect(done.activeEffect).toBeNull();
    expect(done.pendingAbilities).toEqual([]);
    expect(
      done.actionHistory.filter(
        (action) =>
          action.payload.abilityId ===
            PL_PB1_006_ON_ENTER_STACK_MUSE_LIVE_DRAW_IF_OPPONENT_WAITING_ABILITY_ID &&
          action.payload.step === 'STALE_TARGET'
      )
    ).toHaveLength(1);
    expectContinuationResolved(done);
  });
  it('safely resolves with an empty deck', () => {
    const s = setup(true, false);
    const game = updatePlayer(s.game, P1, (p) => ({
      ...p,
      mainDeck: { ...p.mainDeck, cardIds: [] },
    }));
    const done = resolveContinuation(start006(game));
    expect(done.activeEffect).toBeNull();
    expect(done.pendingAbilities).toEqual([]);
  });
});
