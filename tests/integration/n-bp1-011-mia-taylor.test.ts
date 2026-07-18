import { describe, expect, it } from 'vitest';
import type { CardInstance, LiveCardData, MemberCardData } from '../../src/domain/entities/card';
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
  type PendingAbilityState,
} from '../../src/domain/entities/game';
import { addCardToZone, placeCardInSlot } from '../../src/domain/entities/zone';
import { resolvePendingCardEffects } from '../../src/application/card-effect-runner';
import { createConfirmEffectStepCommand } from '../../src/application/game-commands';
import { createGameSession } from '../../src/application/game-session';
import { PL_N_BP1_011_ON_ENTER_OPTIONAL_DISCARD_REVEAL_UNTIL_LIVE_ABILITY_ID } from '../../src/application/card-effects/ability-ids';
import {
  CardType,
  FaceState,
  HeartColor,
  OrientationState,
  SlotPosition,
  TriggerCondition,
  ZoneType,
} from '../../src/shared/types/enums';

const PLAYER1 = 'player1';
const PLAYER2 = 'player2';

function member(code: string, id: string) {
  const data: MemberCardData = {
    cardCode: code,
    name: code,
    groupNames: ['虹ヶ咲'],
    cardType: CardType.MEMBER,
    cost: 5,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.PINK, 1)],
  };
  return createCardInstance(data, PLAYER1, id);
}

function live(code: string, id: string) {
  const data: LiveCardData = {
    cardCode: code,
    name: code,
    groupNames: ['虹ヶ咲'],
    cardType: CardType.LIVE,
    score: 3,
    requirements: createHeartRequirement({ [HeartColor.PINK]: 1 }),
  };
  return createCardInstance(data, PLAYER1, id);
}

function setup(options: {
  readonly handCards?: readonly CardInstance[];
  readonly deckCards?: readonly CardInstance[];
  readonly waitingCards?: readonly CardInstance[];
  readonly sourceOnStage?: boolean;
} = {}) {
  const source = member('PL!N-bp1-011-R', 'mia-source');
  const handCards = options.handCards ?? [member('HAND', 'hand')];
  const deckCards = options.deckCards ?? [];
  const waitingCards = options.waitingCards ?? [];
  let game = registerCards(
    createGameState('mia-reveal-until-live', PLAYER1, 'P1', PLAYER2, 'P2'),
    [source, ...handCards, ...deckCards, ...waitingCards]
  );
  game = updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    memberSlots:
      options.sourceOnStage === false
        ? player.memberSlots
        : placeCardInSlot(player.memberSlots, SlotPosition.CENTER, source.instanceId, {
            orientation: OrientationState.ACTIVE,
            face: FaceState.FACE_UP,
          }),
    hand: handCards.reduce((zone, card) => addCardToZone(zone, card.instanceId), player.hand),
    mainDeck: deckCards.reduce((zone, card) => addCardToZone(zone, card.instanceId), player.mainDeck),
    waitingRoom: waitingCards.reduce(
      (zone, card) => addCardToZone(zone, card.instanceId),
      player.waitingRoom
    ),
  }));
  const pending: PendingAbilityState = {
    id: 'pending-mia',
    abilityId: PL_N_BP1_011_ON_ENTER_OPTIONAL_DISCARD_REVEAL_UNTIL_LIVE_ABILITY_ID,
    sourceCardId: source.instanceId,
    controllerId: PLAYER1,
    mandatory: true,
    timingId: TriggerCondition.ON_ENTER_STAGE,
    eventIds: ['event-mia'],
  };
  return { game: { ...game, pendingAbilities: [pending] }, source, handCards, deckCards, waitingCards };
}

function sessionWithState(game: GameState) {
  const session = createGameSession();
  session.createGame('mia-reveal-until-live-session', PLAYER1, 'P1', PLAYER2, 'P2');
  (session as unknown as { authorityState: GameState }).authorityState = game;
  return session;
}

function submit(session: ReturnType<typeof createGameSession>, cardId?: string) {
  const effect = session.state!.activeEffect!;
  return session.executeCommand(createConfirmEffectStepCommand(PLAYER1, effect.id, cardId));
}

describe('PL!N-bp1-011 Mia Taylor on-enter reveal until LIVE', () => {
  it('reveals in order through the first LIVE, waits for confirmation, then moves one inspection batch', () => {
    const cost = member('COST', 'cost');
    const first = member('FIRST', 'first');
    const second = member('SECOND', 'second');
    const hit = live('HIT-LIVE', 'hit-live');
    const after = live('AFTER-LIVE', 'after-live');
    const started = resolvePendingCardEffects(
      setup({ handCards: [cost], deckCards: [first, second, hit, after] }).game
    ).gameState;
    expect(started.activeEffect).toMatchObject({
      confirmSelectionLabel: '放置入休息室',
      canSkipSelection: true,
      skipSelectionLabel: '不发动',
      selectableCardVisibility: 'AWAITING_PLAYER_ONLY',
    });
    const session = sessionWithState(started);
    expect(submit(session, cost.instanceId).success).toBe(true);
    expect(session.state?.activeEffect).toMatchObject({
      stepId: 'PL_N_BP1_011_CONFIRM_REVEALED_CARDS',
      inspectionCardIds: [first.instanceId, second.instanceId, hit.instanceId],
      revealedCardIds: [first.instanceId, second.instanceId, hit.instanceId],
      selectionLabel: '公开的卡片',
      confirmSelectionLabel: '确认公开结果',
    });
    expect(session.state?.activeEffect?.selectableCardIds).toBeUndefined();
    expect(session.state?.activeEffect?.selectableCardMode).toBeUndefined();
    expect(session.state?.activeEffect?.canSkipSelection).toBeUndefined();
    expect(session.state?.inspectionZone.cardIds).toEqual([
      first.instanceId,
      second.instanceId,
      hit.instanceId,
    ]);
    expect(session.state?.players[0].hand.cardIds).toEqual([]);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([cost.instanceId]);
    expect(session.state?.players[0].mainDeck.cardIds).toEqual([after.instanceId]);
    for (const playerId of [PLAYER1, PLAYER2]) {
      expect(session.getPlayerViewState(playerId)?.activeEffect?.revealedObjectIds).toEqual([
        `obj_${first.instanceId}`,
        `obj_${second.instanceId}`,
        `obj_${hit.instanceId}`,
      ]);
    }

    expect(submit(session).success).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].hand.cardIds).toEqual([hit.instanceId]);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([
      cost.instanceId,
      first.instanceId,
      second.instanceId,
    ]);
    expect(session.state?.inspectionZone.cardIds).toEqual([]);
    const inspectionEvent = session.state?.eventLog.find(
      ({ event }) =>
        event.eventType === TriggerCondition.ON_ENTER_WAITING_ROOM &&
        event.fromZone === ZoneType.MAIN_DECK &&
        event.cardInstanceIds?.includes(first.instanceId)
    );
    expect(inspectionEvent?.event.cardInstanceIds).toEqual([first.instanceId, second.instanceId]);
  });

  it('stops immediately on a top LIVE and supports decline, no hand, and forged input', () => {
    const cost = member('COST', 'cost');
    const hit = live('TOP-LIVE', 'top-live');
    const after = member('AFTER', 'after');
    const started = resolvePendingCardEffects(
      setup({ handCards: [cost], deckCards: [hit, after] }).game
    ).gameState;
    const forgedSession = sessionWithState(started);
    expect(submit(forgedSession, 'forged').success).toBe(false);
    expect(forgedSession.state?.activeEffect?.stepId).toBe(
      'PL_N_BP1_011_SELECT_HAND_CARD_TO_DISCARD'
    );
    expect(submit(forgedSession, cost.instanceId).success).toBe(true);
    expect(forgedSession.state?.activeEffect?.inspectionCardIds).toEqual([hit.instanceId]);
    expect(forgedSession.state?.players[0].mainDeck.cardIds).toEqual([after.instanceId]);

    const declineStarted = resolvePendingCardEffects(setup().game).gameState;
    const declineSession = sessionWithState(declineStarted);
    expect(submit(declineSession).success).toBe(true);
    expect(declineSession.state?.activeEffect).toBeNull();
    expect(declineSession.state?.inspectionZone.cardIds).toEqual([]);

    const noHand = resolvePendingCardEffects(setup({ handCards: [] }).game).gameState;
    expect(noHand.activeEffect).toBeNull();
    expect(noHand.pendingAbilities).toEqual([]);
  });

  it('exhausts safely with no LIVE and continues across refresh, including a discarded LIVE hit', () => {
    const cost = member('COST', 'cost');
    const first = member('FIRST', 'first');
    const waiting = member('WAITING', 'waiting');
    const noLiveStarted = resolvePendingCardEffects(
      setup({ handCards: [cost], deckCards: [first], waitingCards: [waiting] }).game
    ).gameState;
    const noLiveSession = sessionWithState(noLiveStarted);
    expect(submit(noLiveSession, cost.instanceId).success).toBe(true);
    const inspected = noLiveSession.state!.activeEffect!.inspectionCardIds!;
    expect(new Set(inspected)).toEqual(new Set([first.instanceId, waiting.instanceId, cost.instanceId]));
    expect(noLiveSession.state?.activeEffect?.metadata?.hitCardId).toBeNull();
    expect(submit(noLiveSession).success).toBe(true);
    expect(noLiveSession.state?.players[0].hand.cardIds).toEqual([]);
    expect(new Set(noLiveSession.state!.players[0].waitingRoom.cardIds)).toEqual(
      new Set(inspected)
    );

    const discardedLive = live('DISCARDED-LIVE', 'discarded-live');
    const discardHitStarted = resolvePendingCardEffects(
      setup({ handCards: [discardedLive], deckCards: [] }).game
    ).gameState;
    const discardHitSession = sessionWithState(discardHitStarted);
    expect(submit(discardHitSession, discardedLive.instanceId).success).toBe(true);
    expect(discardHitSession.state?.activeEffect?.metadata?.hitCardId).toBe(discardedLive.instanceId);
    expect(discardHitSession.state?.inspectionZone.cardIds).toEqual([discardedLive.instanceId]);
  });

  it('does not cancel after source departure and never partially moves stale inspection state', () => {
    const cost = member('COST', 'cost');
    const hit = live('HIT', 'hit');
    const started = resolvePendingCardEffects(
      setup({ handCards: [cost], deckCards: [hit], sourceOnStage: false }).game
    ).gameState;
    expect(started.activeEffect?.abilityId).toBe(
      PL_N_BP1_011_ON_ENTER_OPTIONAL_DISCARD_REVEAL_UNTIL_LIVE_ABILITY_ID
    );
    const session = sessionWithState(started);
    expect(submit(session, cost.instanceId).success).toBe(true);
    const before = session.state!;
    (session as unknown as { authorityState: GameState }).authorityState = {
      ...before,
      inspectionZone: {
        ...before.inspectionZone,
        cardIds: [],
        revealedCardIds: [],
      },
      inspectionContext: null,
    };
    expect(submit(session).success).toBe(false);
    expect(session.state?.players[0].hand.cardIds).toEqual([]);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([]);
    expect(session.state?.players[0].mainDeck.cardIds).toEqual([cost.instanceId]);
    expect(session.state?.activeEffect?.stepId).toBe('PL_N_BP1_011_CONFIRM_REVEALED_CARDS');
  });
});
