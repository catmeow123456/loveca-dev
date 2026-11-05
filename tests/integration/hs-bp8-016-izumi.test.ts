import { describe, expect, it } from 'vitest';
import {
  enqueueTriggeredCardEffects,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import {
  HS_BP8_016_LIVE_SUCCESS_DISCARD_TWO_RECOVER_LOW_SCORE_HASUNOSORA_LIVE_ABILITY_ID as ABILITY,
  HS_PB1_003_AUTO_HAND_TO_WAITING_GAIN_HEART_BLADE_ABILITY_ID as RURINO_ABILITY,
} from '../../src/application/card-effects/ability-ids';
import { PUBLIC_CARD_SELECTION_CONFIRMATION_STEP_ID } from '../../src/application/card-effects/runtime/public-card-selection-confirmation';
import {
  createAutoAdvancePublicCardSelectionCommand,
  createConfirmEffectStepCommand,
} from '../../src/application/game-commands';
import { createGameSession, type GameSession } from '../../src/application/game-session';
import {
  createCardInstance,
  type CardInstance,
  type LiveCardData,
} from '../../src/domain/entities/card';
import {
  createGameState,
  emitGameEvent,
  registerCards,
  updatePlayer,
  type GameState,
} from '../../src/domain/entities/game';
import { placeCardInSlot, removeCardFromSlot } from '../../src/domain/entities/zone';
import { createLiveSuccessEvent } from '../../src/domain/events/game-events';
import { createPublicObjectId } from '../../src/online/projector';
import { SlotPosition, TriggerCondition, ZoneType } from '../../src/shared/types/enums';
import {
  getNovember04LiveData,
  getNovember04MemberData,
} from '../helpers/november-04-draft-effects';

const P1 = 'p1';
const P2 = 'p2';
const IZUMI = 'izumi';

function member(id: string, cardCode = id): CardInstance {
  return createCardInstance({ ...getNovember04MemberData('PL!HS-bp8-016'), cardCode }, P1, id);
}

function live(id: string, score = 3, group = '莲之空', ownerId = P1): CardInstance {
  const data: LiveCardData = {
    ...getNovember04LiveData('PL!HS-bp8-021'),
    cardCode: id,
    score,
    groupNames: [group],
  };
  return createCardInstance(data, ownerId, id);
}

function setState(session: GameSession, state: GameState) {
  (session as unknown as { authorityState: GameState }).authorityState = state;
}

function enqueueSuccess(game: GameState, playerId = P1, successful = true): GameState {
  const event = successful ? createLiveSuccessEvent(playerId, ['successful-live'], 1) : null;
  return enqueueTriggeredCardEffects(
    event ? emitGameEvent(game, event) : game,
    [TriggerCondition.ON_LIVE_SUCCESS],
    { liveSuccessEvents: event ? [event] : [] }
  );
}

function setup(
  options: {
    hand?: readonly CardInstance[];
    waitingRoom?: readonly CardInstance[];
    observer?: boolean;
  } = {}
) {
  const hand = options.hand ?? [member('discard-one'), member('discard-two')];
  const waitingRoom = options.waitingRoom ?? [live('target')];
  const izumi = member(IZUMI, 'PL!HS-bp8-016-N');
  const observer = member('rurino', 'PL!HS-pb1-003-R');
  const song = live('successful-live');
  const deckCard = member('deck-card');
  let game = registerCards(createGameState('izumi', P1, 'P1', P2, 'P2'), [
    izumi,
    observer,
    song,
    deckCard,
    ...hand,
    ...waitingRoom,
  ]);
  game = updatePlayer(game, P1, (player) => {
    const stage = placeCardInSlot(player.memberSlots, SlotPosition.CENTER, IZUMI);
    return {
      ...player,
      hand: { ...player.hand, cardIds: hand.map((card) => card.instanceId) },
      mainDeck: { ...player.mainDeck, cardIds: [deckCard.instanceId] },
      waitingRoom: {
        ...player.waitingRoom,
        cardIds: waitingRoom.filter((card) => card.ownerId === P1).map((card) => card.instanceId),
      },
      memberSlots: options.observer ? placeCardInSlot(stage, SlotPosition.RIGHT, 'rurino') : stage,
    };
  });
  game = updatePlayer(game, P2, (player) => ({
    ...player,
    waitingRoom: {
      ...player.waitingRoom,
      cardIds: waitingRoom.filter((card) => card.ownerId === P2).map((card) => card.instanceId),
    },
  }));

  let now = 10_000;
  const session = createGameSession({ now: () => now });
  session.createGame('izumi', P1, 'P1', P2, 'P2');
  const queued = enqueueSuccess(game);
  setState(session, resolvePendingCardEffects(queued).gameState);
  return {
    session,
    game,
    queued,
    handIds: hand.map((card) => card.instanceId),
    setNow: (timestamp: number) => {
      now = timestamp;
    },
  };
}

function pay(session: GameSession, cardIds: readonly string[]) {
  return session.executeCommand(
    createConfirmEffectStepCommand(
      P1,
      session.state!.activeEffect!.id,
      undefined,
      undefined,
      undefined,
      undefined,
      cardIds
    )
  );
}

function choose(session: GameSession, cardId?: string | null) {
  return session.executeCommand(
    createConfirmEffectStepCommand(P1, session.state!.activeEffect!.id, cardId)
  );
}

function paymentActions(game: GameState) {
  return game.actionHistory.filter(
    (action) => action.type === 'PAY_COST' && action.payload.abilityId === ABILITY
  );
}

function discardEvents(game: GameState) {
  return game.eventLog
    .map(({ event }) => event)
    .filter((event) => event.eventType === TriggerCondition.ON_ENTER_WAITING_ROOM);
}

describe('PL!HS-bp8-016-N 费用2「桂城泉」', () => {
  it('queues for a successful own LIVE with Izumi on stage', () => {
    const { game, queued } = setup();
    expect(queued.pendingAbilities).toEqual([
      expect.objectContaining({
        abilityId: ABILITY,
        sourceCardId: IZUMI,
        sourceSlot: SlotPosition.CENTER,
        controllerId: P1,
        timingId: TriggerCondition.ON_LIVE_SUCCESS,
      }),
    ]);
    expect(enqueueSuccess(game, P2).pendingAbilities).toEqual([]);
    expect(enqueueSuccess(game, P1, false).pendingAbilities).toEqual([]);
    const offStage = updatePlayer(game, P1, (player) => ({
      ...player,
      memberSlots: removeCardFromSlot(player.memberSlots, SlotPosition.CENTER),
      hand: { ...player.hand, cardIds: [...player.hand.cardIds, IZUMI] },
    }));
    expect(enqueueSuccess(offStage).pendingAbilities).toEqual([]);
  });

  it('pays atomically, can recover the just-discarded LIVE, and resumes after its public display', () => {
    const { session, setNow } = setup({
      hand: [member('fee-member'), live('fee-live'), member('keep')],
      waitingRoom: [],
      observer: true,
    });
    expect(session.state!.activeEffect).toMatchObject({
      abilityId: ABILITY,
      selectableCardMode: 'ORDERED_MULTI',
      selectableCardVisibility: 'AWAITING_PLAYER_ONLY',
      minSelectableCards: 2,
      maxSelectableCards: 2,
      canSkipSelection: true,
      confirmSelectionLabel: '放置入休息室',
      skipSelectionLabel: '不发动',
    });
    expect(session.getPlayerViewState(P2)?.activeEffect?.selectableObjectIds).toBeUndefined();
    expect(pay(session, ['fee-member', 'fee-live']).success).toBe(true);
    expect(session.state!.players[0].hand.cardIds).toEqual(['keep']);
    expect(session.state!.players[0].waitingRoom.cardIds).toEqual(['fee-member', 'fee-live']);
    expect(paymentActions(session.state!)).toEqual([
      expect.objectContaining({
        payload: expect.objectContaining({ discardedHandCardIds: ['fee-member', 'fee-live'] }),
      }),
    ]);
    expect(discardEvents(session.state!)).toEqual([
      expect.objectContaining({
        fromZone: ZoneType.HAND,
        toZone: ZoneType.WAITING_ROOM,
        cardInstanceIds: ['fee-member', 'fee-live'],
      }),
    ]);
    expect(session.state!.pendingAbilities.map((pending) => pending.abilityId)).toEqual([
      RURINO_ABILITY,
    ]);
    expect(session.state!.activeEffect).toMatchObject({
      abilityId: ABILITY,
      selectableCardIds: ['fee-live'],
      canSkipSelection: false,
      confirmSelectionLabel: '加入手牌',
    });
    expect(choose(session, null).success).toBe(false);
    expect(choose(session, 'fee-live').success).toBe(true);
    expect(session.state!.activeEffect).toMatchObject({
      stepId: PUBLIC_CARD_SELECTION_CONFIRMATION_STEP_ID,
      revealedCardIds: ['fee-live'],
      publicCardSelectionAutoAdvanceAt: 12_000,
    });
    const effectId = session.state!.activeEffect!.id;
    for (const playerId of [P1, P2]) {
      expect(session.getPlayerViewState(playerId)?.activeEffect?.revealedObjectIds).toEqual([
        createPublicObjectId('fee-live'),
      ]);
    }
    const advance = createAutoAdvancePublicCardSelectionCommand(P2, effectId, 12_000);
    expect(session.executeCommand(advance).success).toBe(false);
    expect(session.state!.players[0].waitingRoom.cardIds).toContain('fee-live');
    expect(session.state!.pendingAbilities.map((pending) => pending.abilityId)).toEqual([
      RURINO_ABILITY,
    ]);

    setNow(12_000);
    expect(session.executeCommand(advance).success).toBe(true);
    expect(session.state!.players[0].hand.cardIds).toEqual(['keep', 'fee-live']);
    expect(session.state!.players[0].waitingRoom.cardIds).toEqual(['fee-member']);
    expect(session.state!.pendingAbilities).toEqual([]);
    expect(session.state!.activeEffect).toBeNull();
    const resolutions = session.state!.actionHistory.filter(
      (action) => action.type === 'RESOLVE_ABILITY'
    );
    expect(
      resolutions.findIndex((action) => action.payload.abilityId === RURINO_ABILITY)
    ).toBeGreaterThan(
      resolutions.findIndex(
        (action) => action.payload.abilityId === ABILITY && action.payload.step === 'FINISH'
      )
    );
    expect(session.executeCommand(advance).success).toBe(false);
  });

  it('filters recovery by ownership, card type, Hasunosora identity, and printed score', () => {
    const { session, handIds } = setup({
      waitingRoom: [
        live('three'),
        live('two', 2, '蓮ノ空'),
        live('four', 4),
        live('other-group', 3, 'Aqours'),
        member('wrong-type'),
        live('opponent', 1, '蓮ノ空', P2),
      ],
    });
    expect(pay(session, handIds).success).toBe(true);
    expect(session.state!.activeEffect?.selectableCardIds).toEqual(['three', 'two']);
  });

  it('allows payment without a recovery target and allows declining even with a target', () => {
    const noTarget = setup({ waitingRoom: [live('four', 4)] });
    expect(pay(noTarget.session, noTarget.handIds).success).toBe(true);
    expect(noTarget.session.state!.players[0].hand.cardIds).toEqual([]);
    expect(noTarget.session.state!.players[0].waitingRoom.cardIds).toEqual([
      'four',
      ...noTarget.handIds,
    ]);
    expect(paymentActions(noTarget.session.state!)).toHaveLength(1);
    expect(noTarget.session.state!.activeEffect).toBeNull();

    const declined = setup();
    expect(choose(declined.session, null).success).toBe(true);
    expect(declined.session.state!.players[0].hand.cardIds).toEqual(declined.handIds);
    expect(paymentActions(declined.session.state!)).toEqual([]);
    expect(discardEvents(declined.session.state!)).toEqual([]);
    expect(declined.session.state!.activeEffect).toBeNull();
  });

  it.each([0, 1])('does not offer to pay from %i hand cards', (count) => {
    const hand = [member('only-one')].slice(0, count);
    const { session, handIds } = setup({ hand });
    expect(session.state!.activeEffect).toMatchObject({
      metadata: { confirmOnlyPendingAbility: true },
    });
    expect(session.state!.activeEffect?.selectableCardIds).toBeUndefined();
    expect(choose(session).success).toBe(true);
    expect(session.state!.players[0].hand.cardIds).toEqual(handIds);
    expect(paymentActions(session.state!)).toEqual([]);
    expect(session.state!.activeEffect).toBeNull();
    expect(session.state!.pendingAbilities).toEqual([]);
  });

  it('rejects malformed and stale fee choices without partly discarding or skipping', () => {
    const { session, handIds } = setup({
      hand: [member('first'), member('second'), member('third')],
    });
    const stepId = session.state!.activeEffect!.stepId;
    for (const badSelection of [[], ['first'], ['first', 'first'], ['first', 'missing'], handIds]) {
      pay(session, badSelection);
    }
    choose(session, 'first');
    const forged = {
      ...createConfirmEffectStepCommand(P1, session.state!.activeEffect!.id),
      selectedCardId: 'first',
      selectedCardIds: ['first', 'second'],
    };
    session.executeCommand(forged);
    expect(session.state!.players[0].hand.cardIds).toEqual(handIds);
    expect(session.state!.activeEffect?.stepId).toBe(stepId);
    setState(
      session,
      updatePlayer(session.state!, P1, (player) => ({
        ...player,
        hand: { ...player.hand, cardIds: ['first', 'third'] },
        mainDeck: { ...player.mainDeck, cardIds: ['second'] },
      }))
    );
    pay(session, ['first', 'second']);
    expect(session.state!.players[0].hand.cardIds).toEqual(['first', 'third']);
    expect(session.state!.players[0].waitingRoom.cardIds).toEqual(['target']);
    expect(session.state!.activeEffect?.stepId).toBe(stepId);
    expect(paymentActions(session.state!)).toEqual([]);
    expect(discardEvents(session.state!)).toEqual([]);
  });

  it.each([
    { score: 3, recovered: ['target'], remainingTargets: [] },
    { score: 4, recovered: [], remainingTargets: ['target'] },
  ])(
    'resolves after Izumi leaves and revalidates the target with score $score at deadline',
    ({ score, recovered, remainingTargets }) => {
      const { queued, session, handIds, setNow } = setup();
      const sourceLeft = updatePlayer(queued, P1, (player) => ({
        ...player,
        memberSlots: removeCardFromSlot(player.memberSlots, SlotPosition.CENTER),
        waitingRoom: { ...player.waitingRoom, cardIds: [...player.waitingRoom.cardIds, IZUMI] },
      }));
      setState(session, resolvePendingCardEffects(sourceLeft).gameState);
      expect(pay(session, handIds).success).toBe(true);
      expect(choose(session, 'target').success).toBe(true);
      setState(session, registerCards(session.state!, [live('target', score)]));
      const effectId = session.state!.activeEffect!.id;
      setNow(12_000);
      expect(
        session.executeCommand(createAutoAdvancePublicCardSelectionCommand(P2, effectId, 12_000))
          .success
      ).toBe(true);
      expect(session.state!.players[0].waitingRoom.cardIds).toEqual([
        ...remainingTargets,
        IZUMI,
        ...handIds,
      ]);
      expect(session.state!.players[0].hand.cardIds).toEqual(recovered);
      expect(paymentActions(session.state!)).toHaveLength(1);
      expect(session.state!.activeEffect).toBeNull();
      expect(session.state!.pendingAbilities).toEqual([]);
    }
  );
});
