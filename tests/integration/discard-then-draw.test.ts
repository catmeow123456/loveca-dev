import { describe, expect, it } from 'vitest';
import type { MemberCardData } from '../../src/domain/entities/card';
import { createCardInstance, createHeartIcon } from '../../src/domain/entities/card';
import {
  createGameState,
  emitGameEvent,
  registerCards,
  type GameState,
  updatePlayer,
} from '../../src/domain/entities/game';
import { placeCardInSlot } from '../../src/domain/entities/zone';
import { createEnterStageEvent } from '../../src/domain/events/game-events';
import { GameService } from '../../src/application/game-service';
import { createGameSession } from '../../src/application/game-session';
import { createConfirmEffectStepCommand } from '../../src/application/game-commands';
import {
  enqueueTriggeredCardEffects,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import { getCardAbilityDefinitionsForCardCode } from '../../src/application/card-effects/definitions/lookup';
import {
  HS_BP1_005_ON_ENTER_DISCARD_UP_TO_THREE_DRAW_SAME_COUNT_ABILITY_ID,
  HS_PB1_003_AUTO_HAND_TO_WAITING_GAIN_HEART_BLADE_ABILITY_ID,
  HS_PB1_003_ON_ENTER_DISCARD_MIRACRA_MEMBERS_DRAW_PLUS_ONE_ABILITY_ID,
  HS_PR_031_ON_ENTER_DISCARD_TWO_DRAW_TO_FIVE_ABILITY_ID,
} from '../../src/application/card-effects/ability-ids';
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

function member(cardCode: string, unitName = 'みらくらぱーく！'): MemberCardData {
  return {
    cardCode,
    name: cardCode,
    groupNames: ['蓮ノ空女学院スクールアイドルクラブ'],
    unitName,
    cardType: CardType.MEMBER,
    cost: 9,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.PINK, 1)],
  };
}

function start(cardCode: string, handCount: number, handUnits?: readonly string[]) {
  const source = createCardInstance(member(cardCode), PLAYER1, 'source');
  const hand = Array.from({ length: handCount }, (_, index) =>
    createCardInstance(member(`HAND-${index}`, handUnits?.[index] ?? 'みらくらぱーく！'), PLAYER1, `hand-${index}`)
  );
  const deck = Array.from({ length: 8 }, (_, index) =>
    createCardInstance(member(`DRAW-${index}`), PLAYER1, `draw-${index}`)
  );
  let game = registerCards(
    createGameState(`discard-then-draw-${cardCode}-${handCount}`, PLAYER1, 'P1', PLAYER2, 'P2'),
    [source, ...hand, ...deck]
  );
  game = updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    hand: { ...player.hand, cardIds: hand.map((card) => card.instanceId) },
    mainDeck: { ...player.mainDeck, cardIds: deck.map((card) => card.instanceId) },
    memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, source.instanceId, {
      orientation: OrientationState.ACTIVE,
      face: FaceState.FACE_UP,
    }),
  }));
  game = emitGameEvent(
    game,
    createEnterStageEvent(source.instanceId, ZoneType.HAND, SlotPosition.CENTER, PLAYER1, PLAYER1)
  );
  const checked = new GameService().executeCheckTiming(game, [TriggerCondition.ON_ENTER_STAGE]);
  expect(checked.success).toBe(true);
  const session = createGameSession();
  session.createGame('discard-then-draw-session', PLAYER1, 'P1', PLAYER2, 'P2');
  (session as unknown as { authorityState: GameState }).authorityState = checked.gameState;
  return { session, source, hand, deck };
}

function startDoublePending(cardCode: string, handCount: number) {
  const firstSource = createCardInstance(member(cardCode), PLAYER1, 'first-source');
  const secondSource = createCardInstance(member(cardCode), PLAYER1, 'second-source');
  const hand = Array.from({ length: handCount }, (_, index) =>
    createCardInstance(member(`DOUBLE-HAND-${index}`), PLAYER1, `double-hand-${index}`)
  );
  const deck = Array.from({ length: 8 }, (_, index) =>
    createCardInstance(member(`DOUBLE-DRAW-${index}`), PLAYER1, `double-draw-${index}`)
  );
  let game = registerCards(
    createGameState(`discard-then-draw-double-${cardCode}`, PLAYER1, 'P1', PLAYER2, 'P2'),
    [firstSource, secondSource, ...hand, ...deck]
  );
  game = updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    hand: { ...player.hand, cardIds: hand.map((card) => card.instanceId) },
    mainDeck: { ...player.mainDeck, cardIds: deck.map((card) => card.instanceId) },
    memberSlots: placeCardInSlot(
      placeCardInSlot(player.memberSlots, SlotPosition.LEFT, firstSource.instanceId, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      }),
      SlotPosition.RIGHT,
      secondSource.instanceId,
      { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }
    ),
  }));
  const firstEvent = createEnterStageEvent(
    firstSource.instanceId,
    ZoneType.HAND,
    SlotPosition.LEFT,
    PLAYER1,
    PLAYER1
  );
  const secondEvent = createEnterStageEvent(
    secondSource.instanceId,
    ZoneType.HAND,
    SlotPosition.RIGHT,
    PLAYER1,
    PLAYER1
  );
  game = emitGameEvent(emitGameEvent(game, firstEvent), secondEvent);
  game = enqueueTriggeredCardEffects(game, [TriggerCondition.ON_ENTER_STAGE], {
    enterStageEvents: [firstEvent, secondEvent],
  });
  game = resolvePendingCardEffects(game).gameState;
  const session = createGameSession();
  session.createGame('discard-then-draw-double-session', PLAYER1, 'P1', PLAYER2, 'P2');
  (session as unknown as { authorityState: GameState }).authorityState = game;
  expect(session.state?.activeEffect).toMatchObject({
    abilityId: 'system:select-pending-card-effect',
    canResolveInOrder: true,
  });
  expect(
    session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        session.state!.activeEffect!.id,
        undefined,
        null,
        true
      )
    ).success
  ).toBe(true);
  return { session, firstSource, secondSource, hand, deck };
}

function confirm(session: ReturnType<typeof createGameSession>, selectedCardIds: readonly string[]) {
  return session.executeCommand(
    createConfirmEffectStepCommand(
      PLAYER1,
      session.state!.activeEffect!.id,
      undefined,
      null,
      undefined,
      null,
      selectedCardIds
    )
  );
}

function decline(session: ReturnType<typeof createGameSession>) {
  return session.executeCommand(
    createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id, null)
  );
}

describe('discard-then-draw shared workflow', () => {
  it('keeps HS-pb1-003 selector, zero-selection draw, and grouped trigger semantics', () => {
    const { session, hand } = start('PL!HS-pb1-003-R', 3, [
      'みらくらぱーく！',
      'みらくらぱーく！',
      'スリーズブーケ',
    ]);
    expect(session.state?.activeEffect?.abilityId).toBe(
      HS_PB1_003_ON_ENTER_DISCARD_MIRACRA_MEMBERS_DRAW_PLUS_ONE_ABILITY_ID
    );
    expect(session.state?.activeEffect?.selectableCardIds).toEqual([
      hand[0].instanceId,
      hand[1].instanceId,
    ]);
    expect(confirm(session, []).success).toBe(true);
    expect(session.state?.players[0].hand.cardIds).toHaveLength(4);

    const second = start('PL!HS-pb1-003-R', 2);
    expect(confirm(second.session, second.hand.map((card) => card.instanceId)).success).toBe(true);
    const events = second.session.state!.eventLog.filter(
      (entry) => entry.event.eventType === TriggerCondition.ON_ENTER_WAITING_ROOM
    );
    expect(events).toHaveLength(1);
    expect(events[0].event.cardInstanceIds).toEqual(second.hand.map((card) => card.instanceId));
    expect(
      second.session.state?.actionHistory.some(
        (action) =>
          action.payload.abilityId ===
          HS_PB1_003_AUTO_HAND_TO_WAITING_GAIN_HEART_BLADE_ABILITY_ID
      )
    ).toBe(true);
  });

  it('covers bp1-005 P/R/PR through one base definition', () => {
    for (const cardCode of ['PL!HS-bp1-005-P', 'PL!HS-bp1-005-R', 'PL!HS-bp1-005-PR']) {
      expect(
        getCardAbilityDefinitionsForCardCode(cardCode).filter(
          (definition) =>
            definition.abilityId ===
            HS_BP1_005_ON_ENTER_DISCARD_UP_TO_THREE_DRAW_SAME_COUNT_ABILITY_ID
        )
      ).toHaveLength(1);
    }
  });

  it.each([1, 3])('bp1-005 discards and draws the selected count (%i)', (count) => {
    const { session, hand } = start('PL!HS-bp1-005-P', 4);
    expect(session.state?.activeEffect).toMatchObject({
      minSelectableCards: 1,
      maxSelectableCards: 3,
      canSkipSelection: true,
      skipSelectionLabel: '不发动',
      selectableCardVisibility: 'AWAITING_PLAYER_ONLY',
    });
    expect(confirm(session, hand.slice(0, count).map((card) => card.instanceId)).success).toBe(true);
    expect(session.state?.players[0].waitingRoom.cardIds).toHaveLength(count);
    expect(session.state?.players[0].hand.cardIds).toHaveLength(4);
  });

  it('bp1-005 caps selection by current hand and decline does not discard or draw', () => {
    for (const count of [1, 2]) {
      const { session } = start('PL!HS-bp1-005-R', count);
      expect(session.state?.activeEffect?.maxSelectableCards).toBe(count);
    }
    const { session } = start('PL!HS-bp1-005-PR', 2);
    expect(decline(session).success).toBe(true);
    expect(session.state?.players[0].hand.cardIds).toHaveLength(2);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([]);
  });

  it('bp1-005 keeps a legal empty-hand interval and only permits decline', () => {
    const { session } = start('PL!HS-bp1-005-P', 0);
    expect(session.state?.activeEffect).toMatchObject({
      minSelectableCards: 1,
      maxSelectableCards: 1,
      selectableCardIds: [],
      canSkipSelection: true,
      skipSelectionLabel: '不发动',
    });
    expect(confirm(session, []).success).toBe(false);
    expect(decline(session).success).toBe(true);
  });

  it('bp1-005 continues from the first real selection into the second real pending window', () => {
    const { session, hand, deck } = startDoublePending('PL!HS-bp1-005-P', 3);
    expect(session.state?.activeEffect?.abilityId).toBe(
      HS_BP1_005_ON_ENTER_DISCARD_UP_TO_THREE_DRAW_SAME_COUNT_ABILITY_ID
    );
    expect(session.state?.pendingAbilities).toHaveLength(1);

    expect(confirm(session, [hand[0].instanceId]).success).toBe(true);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([hand[0].instanceId]);
    expect(session.state?.players[0].hand.cardIds).toContain(deck[0].instanceId);
    const waitingEvents = session.state!.eventLog.filter(
      (entry) => entry.event.eventType === TriggerCondition.ON_ENTER_WAITING_ROOM
    );
    expect(waitingEvents).toHaveLength(1);
    expect(waitingEvents[0].event.cardInstanceIds).toEqual([hand[0].instanceId]);
    expect(session.state?.activeEffect?.abilityId).toBe(
      HS_BP1_005_ON_ENTER_DISCARD_UP_TO_THREE_DRAW_SAME_COUNT_ABILITY_ID
    );
    expect(session.state?.activeEffect?.metadata?.confirmOnlyPendingAbility).not.toBe(true);

    expect(decline(session).success).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.pendingAbilities).toEqual([]);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([hand[0].instanceId]);
  });

  it('bp1-005 rejects duplicate, over-limit, and stale selections atomically', () => {
    const duplicate = start('PL!HS-bp1-005-P', 4);
    expect(confirm(duplicate.session, [duplicate.hand[0].instanceId, duplicate.hand[0].instanceId]).success).toBe(false);
    expect(duplicate.session.state?.players[0].waitingRoom.cardIds).toEqual([]);

    const over = start('PL!HS-bp1-005-P', 4);
    expect(confirm(over.session, over.hand.map((card) => card.instanceId)).success).toBe(false);
    expect(over.session.state?.players[0].waitingRoom.cardIds).toEqual([]);

    const stale = start('PL!HS-bp1-005-P', 2);
    (stale.session as unknown as { authorityState: GameState }).authorityState = updatePlayer(
      (stale.session as unknown as { authorityState: GameState }).authorityState,
      PLAYER1,
      (player) => ({ ...player, hand: { ...player.hand, cardIds: [stale.hand[1].instanceId] } })
    );
    expect(confirm(stale.session, [stale.hand[0].instanceId]).success).toBe(false);
    expect(stale.session.state?.players[0].waitingRoom.cardIds).toEqual([]);
  });

  it.each([
    [2, 5],
    [5, 5],
    [7, 5],
  ])('PR-031 discards two then draws from hand size %i to %i', (initialHand, finalHand) => {
    const { session, hand } = start('PL!HS-PR-031-PR', initialHand);
    expect(confirm(session, hand.slice(0, 2).map((card) => card.instanceId)).success).toBe(true);
    expect(session.state?.players[0].waitingRoom.cardIds).toHaveLength(2);
    expect(session.state?.players[0].hand.cardIds).toHaveLength(finalHand);
    expect(session.state?.activeEffect).toBeNull();
  });

  it('PR-031 with zero or one card keeps a legal interval and only permits decline', () => {
    for (const handCount of [0, 1]) {
      const { session } = start('PL!HS-PR-031-PR', handCount);
      expect(session.state?.activeEffect).toMatchObject({
        minSelectableCards: 2,
        maxSelectableCards: 2,
        canSkipSelection: true,
        skipSelectionLabel: '不发动',
      });
      expect(session.state?.activeEffect?.selectableCardIds).toHaveLength(handCount);
      expect(confirm(session, session.state!.activeEffect!.selectableCardIds ?? []).success).toBe(
        false
      );
      expect(decline(session).success).toBe(true);
      expect(session.state?.players[0].hand.cardIds).toHaveLength(handCount);
    }
  });

  it('PR-031 continues from draw-to-five into the second real pending window', () => {
    const { session, hand, deck } = startDoublePending('PL!HS-PR-031-PR', 5);
    expect(session.state?.pendingAbilities).toHaveLength(1);

    expect(confirm(session, [hand[0].instanceId, hand[1].instanceId]).success).toBe(true);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([
      hand[0].instanceId,
      hand[1].instanceId,
    ]);
    expect(session.state?.players[0].hand.cardIds).toHaveLength(5);
    expect(session.state?.players[0].hand.cardIds).toEqual(
      expect.arrayContaining([deck[0].instanceId, deck[1].instanceId])
    );
    expect(session.state?.activeEffect?.abilityId).toBe(
      HS_PR_031_ON_ENTER_DISCARD_TWO_DRAW_TO_FIVE_ABILITY_ID
    );
    expect(session.state?.activeEffect?.metadata?.confirmOnlyPendingAbility).not.toBe(true);

    expect(decline(session).success).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.pendingAbilities).toEqual([]);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([
      hand[0].instanceId,
      hand[1].instanceId,
    ]);
  });

  it('PR-031 rejects one or three cards and does not partially pay', () => {
    for (const count of [1, 3]) {
      const { session, hand } = start('PL!HS-PR-031-PR', 3);
      expect(confirm(session, hand.slice(0, count).map((card) => card.instanceId)).success).toBe(false);
      expect(session.state?.players[0].waitingRoom.cardIds).toEqual([]);
    }
  });

  it('does not register the same-text N-PR-028 card', () => {
    expect(
      getCardAbilityDefinitionsForCardCode('PL!N-PR-028-PR').some(
        (definition) =>
          definition.abilityId === HS_PR_031_ON_ENTER_DISCARD_TWO_DRAW_TO_FIVE_ABILITY_ID
      )
    ).toBe(false);
  });
});
