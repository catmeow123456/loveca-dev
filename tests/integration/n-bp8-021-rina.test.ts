import { describe, expect, it } from 'vitest';
import {
  activateCardAbility,
  confirmActiveEffectStep,
  enqueueTriggeredCardEffects,
} from '../../src/application/card-effect-runner';
import { N_BP8_021_ACTIVATED_DISCARD_TWO_PLACE_NIJIGASAKI_LIVE_REDUCE_NEXT_LIVE_SET_LIMIT_ABILITY_ID as ABILITY } from '../../src/application/card-effects/ability-ids';
import { HS_PB1_003_AUTO_HAND_TO_WAITING_GAIN_HEART_BLADE_ABILITY_ID as DISCARD_TRIGGER } from '../../src/application/card-effects/ability-ids';
import { getStageMemberLifecycleId } from '../../src/application/card-effects/runtime/ability-source-lifecycle';
import { sendStageMemberToWaitingRoomAndEnqueueLeaveStageTriggers } from '../../src/application/card-effects/runtime/leave-stage-triggers';
import { PUBLIC_CARD_SELECTION_CONFIRMATION_STEP_ID } from '../../src/application/card-effects/runtime/public-card-selection-confirmation';
import {
  createConfirmSubPhaseAction,
  createSetLiveCardAction,
} from '../../src/application/actions';
import { GameService } from '../../src/application/game-service';
import {
  createCardInstance,
  createHeartRequirement,
  type LiveCardData,
  type MemberCardData,
} from '../../src/domain/entities/card';
import {
  createGameState,
  emitGameEvent,
  getLiveSetCardCountForPlayer,
  getLiveSetCardLimitForPlayer,
  registerCards,
  updatePlayer,
  type GameState,
} from '../../src/domain/entities/game';
import {
  addCardToStatefulZone,
  placeCardInSlot,
  removeCardFromZone,
} from '../../src/domain/entities/zone';
import { createEnterStageEvent } from '../../src/domain/events/game-events';
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
import { getOctober31MemberData } from '../helpers/october-31-draft-effects';
import { confirmActiveEffectStepThroughPublicReveal } from '../helpers/public-card-selection-confirmation';

const P1 = 'p1',
  P2 = 'p2';
function live(id: string, group = '虹ヶ咲', owner = P1) {
  return createCardInstance(
    {
      cardCode: `SYNTHETIC-${id}`,
      name: id,
      cardType: CardType.LIVE,
      score: 2,
      groupNames: [group],
      requirements: createHeartRequirement({ [HeartColor.PINK]: 1 }),
    } as LiveCardData,
    owner,
    id
  );
}
function setup(
  options: {
    handLive?: boolean;
    waiting?: boolean;
    occupied?: boolean;
    cardCode?: string;
    orientation?: OrientationState;
    handCount?: number;
  } = {}
) {
  const source = createCardInstance(
    { ...getOctober31MemberData('PL!N-bp8-021'), cardCode: options.cardCode ?? 'PL!N-bp8-021-N' },
    P1,
    'rina'
  );
  const cost = Array.from({ length: options.handCount ?? 4 }, (_, i) =>
    createCardInstance(
      {
        cardCode: `SYNTHETIC-COST-${i}`,
        name: '费用成员',
        cardType: CardType.MEMBER,
        cost: 2,
        blade: 1,
        hearts: [{ color: HeartColor.PINK, count: 1 }],
      } as MemberCardData,
      P1,
      `cost-${i}`
    )
  );
  const target = live('target'),
    handTarget = live('hand-live'),
    wrong = live('wrong', '蓮ノ空');
  const enemy = live('enemy', '虹ヶ咲', P2),
    occupied = live('occupied');
  const sets = [live('set-0'), live('set-1'), live('set-2')];
  const deck = Array.from({ length: 8 }, (_, i) =>
    createCardInstance({ ...cost[0]!.data, cardCode: `SYNTHETIC-DECK-${i}` }, P1, `deck-${i}`)
  );
  let game = registerCards(createGameState('n-bp8-021', P1, 'P1', P2, 'P2'), [
    source,
    ...cost,
    target,
    handTarget,
    wrong,
    enemy,
    occupied,
    ...sets,
    ...deck,
  ]);
  game = updatePlayer(game, P1, (p) => ({
    ...p,
    hand: {
      ...p.hand,
      cardIds: [...cost.map((c) => c.instanceId), ...(options.handLive ? ['hand-live'] : [])],
    },
    waitingRoom: {
      ...p.waitingRoom,
      cardIds: [...(options.waiting === false ? [] : ['target']), 'wrong'],
    },
    mainDeck: { ...p.mainDeck, cardIds: deck.map((c) => c.instanceId) },
    memberSlots: placeCardInSlot(p.memberSlots, SlotPosition.CENTER, 'rina', {
      face: FaceState.FACE_UP,
      orientation: options.orientation ?? OrientationState.ACTIVE,
    }),
    liveZone: options.occupied
      ? addCardToStatefulZone(p.liveZone, 'occupied', {
          face: FaceState.FACE_UP,
          orientation: OrientationState.ACTIVE,
        })
      : p.liveZone,
  }));
  game = updatePlayer(game, P2, (p) => ({
    ...p,
    waitingRoom: { ...p.waitingRoom, cardIds: ['enemy'] },
  }));
  game = emitGameEvent(
    { ...game, currentPhase: GamePhase.MAIN_PHASE, activePlayerIndex: 0 },
    createEnterStageEvent('rina', ZoneType.HAND, SlotPosition.CENTER, P1, P1)
  );
  return { game, sets };
}
const start = (g: GameState) => activateCardAbility(g, P1, 'rina', ABILITY);
const pay = (g: GameState, ids = ['cost-0', 'cost-1']) =>
  confirmActiveEffectStep(
    g,
    P1,
    g.activeEffect!.id,
    undefined,
    undefined,
    undefined,
    undefined,
    ids
  );
const uses = (g: GameState) =>
  g.actionHistory.filter(
    (a) => a.payload.abilityId === ABILITY && a.payload.step === 'ABILITY_USE'
  );

function place(g: GameState, id = 'target') {
  return confirmActiveEffectStepThroughPublicReveal(g, P1, g.activeEffect!.id, id);
}

describe('PL!N-bp8-021 费用11 天王寺璃奈', () => {
  it.each(['PL!N-bp8-021-N', 'PL!N-bp8-021-P', 'PL!N-bp8-021-SEC'])(
    'pays exactly two, then publicly places a Nijigasaki LIVE for %s',
    (cardCode) => {
      let game = pay(start(setup({ cardCode, orientation: OrientationState.WAITING }).game));
      expect(game.activeEffect?.selectableCardIds).toEqual(['target']);
      expect(game.players[0].waitingRoom.cardIds).toEqual(['target', 'wrong', 'cost-0', 'cost-1']);
      expect(uses(game)).toHaveLength(1);
      const selectionId = game.activeEffect!.id;
      game = confirmActiveEffectStep(game, P1, selectionId, 'target');
      expect(game.activeEffect?.stepId).toBe(PUBLIC_CARD_SELECTION_CONFIRMATION_STEP_ID);
      expect(game.players[0].waitingRoom.cardIds).toContain('target');
      expect(game.players[0].liveZone.cardIds).toEqual([]);
      expect(game.liveSetLimitReductions).toEqual([]);
      game = confirmActiveEffectStep(game, P1, selectionId);
      expect(game.players[0].liveZone.cardIds).toEqual(['target']);
      expect(game.players[0].liveZone.cardStates.get('target')?.face).toBe(FaceState.FACE_UP);
      expect(game.liveSetLimitReductions).toHaveLength(1);
      expect(getLiveSetCardLimitForPlayer(game, P1)).toBe(2);
      expect(
        game.eventLog.filter(({ event }) => event.eventType === TriggerCondition.ON_ENTER_LIVE_ZONE)
      ).toHaveLength(1);
      expect(
        game.eventLog.filter(
          ({ event }) =>
            event.eventType === TriggerCondition.ON_ENTER_WAITING_ROOM &&
            'cardInstanceIds' in event &&
            event.cardInstanceIds?.includes('cost-0')
        )
      ).toHaveLength(1);
      expect(confirmActiveEffectStep(game, P1, selectionId)).toBe(game);
      expect(start(game)).toBe(game);
    }
  );

  it.each([{ waiting: false }, { occupied: true }])(
    'keeps legal costs and independently reduces the limit with %j',
    (options) => {
      const started = start(setup(options).game);
      expect(started.activeEffect).not.toBeNull();
      const game = pay(started);
      expect(game.activeEffect).toBeNull();
      expect(game.liveSetLimitReductions).toHaveLength(1);
      expect(uses(game)).toHaveLength(1);
      expect(game.players[0].hand.cardIds).toEqual(['cost-2', 'cost-3']);
    }
  );

  it('allows a LIVE discarded as this cost to be the subsequent target', () => {
    const paid = pay(start(setup({ waiting: false, handLive: true }).game), [
      'hand-live',
      'cost-0',
    ]);
    expect(paid.activeEffect?.selectableCardIds).toEqual(['hand-live']);
    const game = place(paid, 'hand-live');
    expect(game.players[0].liveZone.cardIds).toEqual(['hand-live']);
  });

  it('enqueues one discard trigger for the batch and waits until placement finishes to resolve it', () => {
    let game = setup().game;
    const observer = createCardInstance(
      {
        ...getOctober31MemberData('PL!N-bp8-021'),
        cardCode: 'PL!HS-pb1-003-R',
        name: '大沢瑠璃乃',
      },
      P1,
      'observer'
    );
    game = updatePlayer(registerCards(game, [observer]), P1, (p) => ({
      ...p,
      memberSlots: placeCardInSlot(p.memberSlots, SlotPosition.RIGHT, 'observer'),
    }));
    game = pay(start(game));
    expect(game.pendingAbilities.filter((a) => a.abilityId === DISCARD_TRIGGER)).toHaveLength(1);
    expect(game.activeEffect?.abilityId).toBe(ABILITY);
    expect(
      game.liveResolution.liveModifiers.filter((m) => m.abilityId === DISCARD_TRIGGER)
    ).toEqual([]);
    game = place(game);
    expect(game.liveSetLimitReductions).toHaveLength(1);
    expect(
      game.liveResolution.liveModifiers.filter((m) => m.abilityId === DISCARD_TRIGGER)
    ).toHaveLength(2);
    expect(game.pendingAbilities).toEqual([]);
    const placeIndex = game.actionHistory.findIndex(
      (a) => a.payload.abilityId === ABILITY && a.payload.step === 'PLACE_LIVE_FACE_UP'
    );
    const triggerIndex = game.actionHistory.findIndex(
      (a) => a.payload.abilityId === DISCARD_TRIGGER && a.payload.step === 'ABILITY_USE'
    );
    expect(triggerIndex).toBeGreaterThan(placeIndex);
  });

  it('rejects insufficient, duplicate, foreign, stale and mixed cost input without partial payment', () => {
    expect(start(setup({ handCount: 1 }).game).activeEffect).toBeNull();
    const started = start(setup().game);
    for (const ids of [['cost-0'], ['cost-0', 'cost-0'], ['cost-0', 'enemy']]) {
      expect(pay(started, ids)).toBe(started);
    }
    const stale = updatePlayer(started, P1, (p) => ({
      ...p,
      hand: removeCardFromZone(p.hand, 'cost-0'),
    }));
    expect(pay(stale)).toBe(stale);
    const mixed = confirmActiveEffectStep(
      started,
      P1,
      started.activeEffect!.id,
      'cost-0',
      undefined,
      undefined,
      undefined,
      ['cost-0', 'cost-1']
    );
    expect(mixed).toBe(started);
    expect(uses(started)).toEqual([]);
    expect(started.liveSetLimitReductions).toEqual([]);
  });

  it('can decline before paying and start again without consuming turn1', () => {
    const started = start(setup().game);
    const game = confirmActiveEffectStep(started, P1, started.activeEffect!.id, null);
    expect(game.activeEffect).toBeNull();
    expect(uses(game)).toEqual([]);
    expect(game.liveSetLimitReductions).toEqual([]);
    expect(start(game).activeEffect?.abilityId).toBe(ABILITY);
  });

  it.each(['gone', 'occupied'] as const)(
    'finishes the independent reduction after a public selection becomes %s',
    (kind) => {
      const paid = pay(start(setup().game));
      let game = confirmActiveEffectStep(paid, P1, paid.activeEffect!.id, 'target');
      const id = game.activeEffect!.id;
      game = updatePlayer(game, P1, (p) => ({
        ...p,
        waitingRoom: kind === 'gone' ? removeCardFromZone(p.waitingRoom, 'target') : p.waitingRoom,
        liveZone:
          kind === 'occupied'
            ? addCardToStatefulZone(p.liveZone, 'occupied', {
                face: FaceState.FACE_UP,
                orientation: OrientationState.ACTIVE,
              })
            : p.liveZone,
      }));
      game = confirmActiveEffectStep(game, P1, id);
      expect(game.activeEffect).toBeNull();
      expect(game.players[0].liveZone.cardIds).not.toContain('target');
      expect(game.liveSetLimitReductions).toHaveLength(1);
      expect(uses(game)).toHaveLength(1);
      expect(confirmActiveEffectStep(game, P1, id)).toBe(game);
    }
  );

  it('does not cancel independent costs or reward when the source leaves and re-enters', () => {
    let game = start(setup({ waiting: false }).game);
    const old = getStageMemberLifecycleId(game, 'rina');
    game = sendStageMemberToWaitingRoomAndEnqueueLeaveStageTriggers(
      game,
      P1,
      'rina',
      enqueueTriggeredCardEffects
    )!.gameState;
    game = pay(game);
    expect(uses(game)[0].payload.sourceLifecycleId).toBe(old);
    expect(game.liveSetLimitReductions).toHaveLength(1);
    game = updatePlayer(game, P1, (p) => ({
      ...p,
      waitingRoom: removeCardFromZone(p.waitingRoom, 'rina'),
      memberSlots: placeCardInSlot(p.memberSlots, SlotPosition.CENTER, 'rina'),
    }));
    game = emitGameEvent(
      game,
      createEnterStageEvent('rina', ZoneType.WAITING_ROOM, SlotPosition.CENTER, P1, P1)
    );
    expect(getStageMemberLifecycleId(game, 'rina')).not.toBe(old);
    game = pay(start(game), ['cost-2', 'cost-3']);
    expect(uses(game)).toHaveLength(2);
    expect(getLiveSetCardLimitForPlayer(game, P1)).toBe(1);
  });

  it('counts only natural sets, draws only those cards, and consumes the reduction only for the owner', () => {
    const { game: initial, sets } = setup();
    let game = place(pay(start(initial)));
    game = updatePlayer(game, P1, (p) => ({
      ...p,
      hand: { ...p.hand, cardIds: [...p.hand.cardIds, ...sets.map((c) => c.instanceId)] },
    }));
    const service = new GameService();
    const opponent = service.processAction(
      {
        ...game,
        currentPhase: GamePhase.LIVE_SET_PHASE,
        currentSubPhase: SubPhase.LIVE_SET_SECOND_PLAYER,
      },
      createConfirmSubPhaseAction(P2, SubPhase.LIVE_SET_SECOND_PLAYER)
    );
    expect(opponent.success).toBe(true);
    expect(opponent.gameState.liveSetLimitReductions).toHaveLength(1);
    game = {
      ...opponent.gameState,
      currentPhase: GamePhase.LIVE_SET_PHASE,
      currentSubPhase: SubPhase.LIVE_SET_FIRST_PLAYER,
      liveSetCompletedPlayers: [],
    };
    for (const id of ['set-0', 'set-1']) {
      const result = service.processAction(game, createSetLiveCardAction(P1, id));
      expect(result.success).toBe(true);
      game = result.gameState;
    }
    expect(service.processAction(game, createSetLiveCardAction(P1, 'set-2')).success).toBe(false);
    expect(game.players[0].liveZone.cardIds).toHaveLength(3);
    expect(getLiveSetCardCountForPlayer(game, P1)).toBe(2);
    const before = game.players[0].hand.cardIds.length;
    const ended = service.processAction(
      game,
      createConfirmSubPhaseAction(P1, SubPhase.LIVE_SET_FIRST_PLAYER)
    );
    expect(ended.success).toBe(true);
    expect(ended.gameState.players[0].hand.cardIds).toHaveLength(before + 2);
    expect(ended.gameState.liveSetLimitReductions).toEqual([]);
    expect(getLiveSetCardLimitForPlayer(ended.gameState, P1)).toBe(3);
  });
});
