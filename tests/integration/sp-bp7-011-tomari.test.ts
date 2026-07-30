import { describe, expect, it } from 'vitest';
import type { MemberCardData } from '../../src/domain/entities/card';
import { createCardInstance, createHeartIcon } from '../../src/domain/entities/card';
import {
  createGameState,
  registerCards,
  updatePlayer,
  type GameState,
  type PendingAbilityState,
} from '../../src/domain/entities/game';
import { placeCardInSlot } from '../../src/domain/entities/zone';
import { createConfirmEffectStepCommand } from '../../src/application/game-commands';
import { resolvePendingCardEffects } from '../../src/application/card-effect-runner';
import { createGameSession } from '../../src/application/game-session';
import {
  MEMBER_ON_ENTER_DRAW_ONE_ABILITY_ID,
  SP_BP7_011_ON_ENTER_DISCARD_ALL_DRAW_SIX_ABILITY_ID,
} from '../../src/application/card-effects/ability-ids';
import { getCardAbilityDefinitionsForCardCode } from '../../src/application/card-effects/definitions/lookup';
import {
  CardType,
  FaceState,
  HeartColor,
  OrientationState,
  SlotPosition,
  TriggerCondition,
  ZoneType,
} from '../../src/shared/types/enums';

const P1 = 'player1';
const P2 = 'player2';
const EFFECT_TEXT = '【登场】可以将手牌全部放置入休息室：抽6张卡。';

function member(cardCode: string, name = cardCode): MemberCardData {
  return {
    cardCode,
    name,
    groupNames: ['Liella!'],
    cardType: CardType.MEMBER,
    cost: 9,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.PURPLE, 1)],
  };
}

function pending(sourceCardId: string): PendingAbilityState {
  return {
    id: 'sp-bp7-011-pending',
    abilityId: SP_BP7_011_ON_ENTER_DISCARD_ALL_DRAW_SIX_ABILITY_ID,
    sourceCardId,
    controllerId: P1,
    timingId: TriggerCondition.ON_ENTER_STAGE,
    sourceSlot: SlotPosition.CENTER,
    eventIds: ['sp-bp7-011-enter-event'],
  };
}

function setup(handCount: number, deckCount = 8) {
  const source = createCardInstance(member('PL!SP-bp7-011-P', '鬼塚冬毬'), P1, 'tomari');
  const hand = Array.from({ length: handCount }, (_, index) =>
    createCardInstance(member(`HAND-${index}`), P1, `hand-${index}`)
  );
  const deck = Array.from({ length: deckCount }, (_, index) =>
    createCardInstance(member(`DRAW-${index}`), P1, `draw-${index}`)
  );
  let game = registerCards(createGameState('sp-bp7-011', P1, 'P1', P2, 'P2'), [
    source,
    ...hand,
    ...deck,
  ]);
  game = updatePlayer(game, P1, (player) => ({
    ...player,
    hand: { ...player.hand, cardIds: hand.map((card) => card.instanceId) },
    mainDeck: { ...player.mainDeck, cardIds: deck.map((card) => card.instanceId) },
    memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, source.instanceId, {
      orientation: OrientationState.ACTIVE,
      face: FaceState.FACE_UP,
    }),
  }));
  game = { ...game, pendingAbilities: [pending(source.instanceId)] };
  const session = createGameSession();
  session.createGame('sp-bp7-011-session', P1, 'P1', P2, 'P2');
  (session as unknown as { authorityState: GameState }).authorityState =
    resolvePendingCardEffects(game).gameState;
  return { session, source, hand, deck };
}

function choose(session: ReturnType<typeof createGameSession>, selectedOptionId: string | null) {
  return session.executeCommand(
    createConfirmEffectStepCommand(
      P1,
      session.state!.activeEffect!.id,
      null,
      null,
      undefined,
      selectedOptionId
    )
  );
}

describe('PL!SP-bp7-011-P 鬼冢冬毬', () => {
  it('registers one base-family ON_ENTER definition with the full exported Chinese paragraph', () => {
    for (const cardCode of ['PL!SP-bp7-011-P', 'PL!SP-bp7-011-SEC']) {
      const definitions = getCardAbilityDefinitionsForCardCode(cardCode);
      expect(definitions).toHaveLength(1);
      expect(definitions[0]).toMatchObject({
        abilityId: SP_BP7_011_ON_ENTER_DISCARD_ALL_DRAW_SIX_ABILITY_ID,
        baseCardCodes: ['PL!SP-bp7-011'],
        triggerCondition: TriggerCondition.ON_ENTER_STAGE,
        queued: true,
        implemented: true,
        effectText: EFFECT_TEXT,
      });
    }
  });

  it('offers a deterministic 发动 / 不发动 choice without exposing the private hand as targets', () => {
    const { session } = setup(3);
    expect(session.state?.activeEffect).toMatchObject({
      abilityId: SP_BP7_011_ON_ENTER_DISCARD_ALL_DRAW_SIX_ABILITY_ID,
      effectText: EFFECT_TEXT,
      stepText: '可以将全部手牌放置入休息室；如此做时抽6张卡。',
      selectableOptions: [{ id: 'activate', label: '发动' }],
      canSkipSelection: true,
      skipSelectionLabel: '不发动',
    });
    expect(session.state?.activeEffect?.selectableCardIds).toBeUndefined();
  });

  it('declines without moving or drawing any cards', () => {
    const { session, hand, deck } = setup(3);
    expect(choose(session, null).success).toBe(true);
    expect(session.state?.players[0].hand.cardIds).toEqual(hand.map((card) => card.instanceId));
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([]);
    expect(session.state?.players[0].mainDeck.cardIds).toEqual(deck.map((card) => card.instanceId));
    expect(session.state?.actionHistory.at(-1)?.payload.step).toBe('DECLINE_DISCARD_ALL_DRAW_SIX');
  });

  it('re-reads and discards the full current hand in one event, then draws six', () => {
    const { session, hand, deck } = setup(3);
    expect(choose(session, 'not-offered').success).toBe(false);
    expect(choose(session, 'activate').success).toBe(true);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual(
      hand.map((card) => card.instanceId)
    );
    expect(session.state?.players[0].hand.cardIds).toEqual(
      deck.slice(0, 6).map((card) => card.instanceId)
    );
    const events = session.state!.eventLog.filter(
      ({ event }) =>
        event.eventType === TriggerCondition.ON_ENTER_WAITING_ROOM &&
        event.fromZone === ZoneType.HAND &&
        event.toZone === ZoneType.WAITING_ROOM
    );
    expect(events).toHaveLength(1);
    expect(events[0]!.event.cardInstanceIds).toEqual(hand.map((card) => card.instanceId));
    expect(session.state?.actionHistory.at(-1)?.payload).toMatchObject({
      abilityId: SP_BP7_011_ON_ENTER_DISCARD_ALL_DRAW_SIX_ABILITY_ID,
      step: 'DISCARD_ALL_DRAW_SIX',
      discardedCardIds: hand.map((card) => card.instanceId),
      drawnCardIds: deck.slice(0, 6).map((card) => card.instanceId),
    });
  });

  it('allows activating with an empty hand, emits no discard event, and still draws six', () => {
    const { session, deck } = setup(0);
    expect(choose(session, 'activate').success).toBe(true);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([]);
    expect(session.state?.players[0].hand.cardIds).toEqual(
      deck.slice(0, 6).map((card) => card.instanceId)
    );
    expect(
      session.state?.eventLog.filter(
        ({ event }) =>
          event.eventType === TriggerCondition.ON_ENTER_WAITING_ROOM &&
          event.fromZone === ZoneType.HAND
      )
    ).toEqual([]);
  });

  it('draws across a rule refresh after the discarded hand becomes the refresh pool', () => {
    const { session, hand, deck } = setup(3, 3);
    expect(choose(session, 'activate').success).toBe(true);
    expect(session.state?.players[0].hand.cardIds).toHaveLength(6);
    expect(new Set(session.state?.players[0].hand.cardIds)).toEqual(
      new Set([...deck.map((card) => card.instanceId), ...hand.map((card) => card.instanceId)])
    );
    expect(
      session.state?.actionHistory.some(
        (action) => action.type === 'RULE_ACTION' && action.payload.type === 'REFRESH'
      )
    ).toBe(true);
  });

  it('continues into newly queued work only after the discard and draw finish', () => {
    const { session, source, hand, deck } = setup(2);
    (session as unknown as { authorityState: GameState }).authorityState = {
      ...session.state!,
      pendingAbilities: [
        {
          id: 'continuation-pending',
          abilityId: MEMBER_ON_ENTER_DRAW_ONE_ABILITY_ID,
          sourceCardId: source.instanceId,
          controllerId: P1,
          timingId: TriggerCondition.ON_ENTER_STAGE,
          sourceSlot: SlotPosition.CENTER,
          eventIds: ['continuation-event'],
        },
      ],
    };
    expect(choose(session, 'activate').success).toBe(true);
    expect(session.state?.pendingAbilities).toEqual([]);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual(
      hand.map((card) => card.instanceId)
    );
    expect(session.state?.players[0].hand.cardIds).toEqual(
      deck.slice(0, 7).map((card) => card.instanceId)
    );
    const spResolutionIndex = session.state!.actionHistory.findIndex(
      (action) =>
        action.payload.abilityId === SP_BP7_011_ON_ENTER_DISCARD_ALL_DRAW_SIX_ABILITY_ID &&
        action.payload.step === 'DISCARD_ALL_DRAW_SIX'
    );
    const continuationIndex = session.state!.actionHistory.findIndex(
      (action) => action.payload.abilityId === MEMBER_ON_ENTER_DRAW_ONE_ABILITY_ID
    );
    expect(spResolutionIndex).toBeGreaterThanOrEqual(0);
    expect(continuationIndex).toBeGreaterThan(spResolutionIndex);
  });
});
