import { describe, expect, it } from 'vitest';
import type { MemberCardData } from '../../src/domain/entities/card';
import { createCardInstance, createHeartIcon } from '../../src/domain/entities/card';
import { createGameState, registerCards, updatePlayer, type GameState } from '../../src/domain/entities/game';
import { placeCardInSlot } from '../../src/domain/entities/zone';
import { createConfirmEffectStepCommand, createPlayMemberToSlotCommand } from '../../src/application/game-commands';
import { resolvePendingCardEffects } from '../../src/application/card-effect-runner';
import { createGameSession } from '../../src/application/game-session';
import { PL_N_BP1_002_ACTIVATED_FROM_WAITING_ROOM_PAY_TWO_DISCARD_ONE_PLAY_SELF_ABILITY_ID, S_PR_ON_ENTER_LOOK_TOP_THREE_ARRANGE_TO_TOP_ABILITY_ID } from '../../src/application/card-effects/ability-ids';
import { getCardAbilityDefinitionsForCardCode } from '../../src/application/card-effects/definitions/lookup';
import { CardType, FaceState, GamePhase, HeartColor, OrientationState, SlotPosition, SubPhase, TriggerCondition, TurnType, ZoneType } from '../../src/shared/types/enums';

const P1 = 'player1';
const P2 = 'player2';
const CARDS = [
  ['PL!S-PR-028-PR', '黒澤ダイヤ'],
  ['PL!S-PR-032-PR', '小原鞠莉'],
  ['PL!S-PR-033-PR', '黒澤ルビィ'],
] as const;
const EFFECT_TEXT = '【登场】检视自己卡组顶的3张卡。将其中任意张数的卡牌按任意顺序放置于卡组顶，其余的卡片放置入休息室。';

function member(cardCode: string, name = cardCode): MemberCardData {
  return { cardCode, name, groupNames: ['Aqours'], cardType: CardType.MEMBER, cost: 4, blade: 1, hearts: [createHeartIcon(HeartColor.RED, 1)] };
}

function startViaRealEnter(cardCode: string, name: string, deckCount = 3) {
  const source = createCardInstance(member(cardCode, name), P1, `${cardCode}-source`);
  const deck = Array.from({ length: deckCount }, (_, i) =>
    createCardInstance(member(`${cardCode}-deck-${i}`), P1, `${cardCode}-deck-${i}`)
  );
  let game = createGameState(`s-pr-${cardCode}`, P1, 'P1', P2, 'P2');
  game = registerCards(game, [source, ...deck]);
  game = updatePlayer(game, P1, (player) => ({
    ...player,
    hand: { ...player.hand, cardIds: [source.instanceId] },
    mainDeck: { ...player.mainDeck, cardIds: deck.map((card) => card.instanceId) },
  }));
  game = { ...game, currentPhase: GamePhase.MAIN_PHASE, currentSubPhase: SubPhase.NONE, currentTurnType: TurnType.NORMAL, activePlayerIndex: 0, waitingPlayerId: null };
  const session = createGameSession();
  session.createGame(`session-${cardCode}`, P1, 'P1', P2, 'P2');
  (session as unknown as { authorityState: GameState }).authorityState = game;
  session.localFreePlay = true;
  const result = session.executeCommand(createPlayMemberToSlotCommand(P1, source.instanceId, SlotPosition.CENTER, { freePlay: true }));
  expect(result.success, result.error).toBe(true);
  return { session, deckIds: deck.map((card) => card.instanceId) };
}

function startContinuationFixture() {
  const source = createCardInstance(member(CARDS[0][0], CARDS[0][1]), P1, 'continuation-source');
  const second = createCardInstance(member(CARDS[1][0], CARDS[1][1]), P1, 'continuation-second');
  const deck = Array.from({ length: 6 }, (_, i) => createCardInstance(member(`continuation-deck-${i}`), P1, `continuation-deck-${i}`));
  let game = registerCards(createGameState('s-pr-continuation', P1, 'P1', P2, 'P2'), [source, second, ...deck]);
  game = updatePlayer(game, P1, (player) => ({
    ...player,
    mainDeck: { ...player.mainDeck, cardIds: deck.map((card) => card.instanceId) },
    memberSlots: placeCardInSlot(placeCardInSlot(player.memberSlots, SlotPosition.CENTER, source.instanceId, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }), SlotPosition.LEFT, second.instanceId, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }),
  }));
  game = { ...game, pendingAbilities: [{ id: 'continuation-first', abilityId: S_PR_ON_ENTER_LOOK_TOP_THREE_ARRANGE_TO_TOP_ABILITY_ID, sourceCardId: source.instanceId, controllerId: P1, mandatory: true, timingId: TriggerCondition.ON_ENTER_STAGE, eventIds: ['event-0'] }] };
  const started = resolvePendingCardEffects(game).gameState;
  const session = createGameSession();
  session.createGame('s-pr-continuation-session', P1, 'P1', P2, 'P2');
  (session as unknown as { authorityState: GameState }).authorityState = { ...started, pendingAbilities: [...started.pendingAbilities, { id: 'continuation-second', abilityId: S_PR_ON_ENTER_LOOK_TOP_THREE_ARRANGE_TO_TOP_ABILITY_ID, sourceCardId: second.instanceId, controllerId: P1, mandatory: true, timingId: TriggerCondition.ON_ENTER_STAGE, eventIds: ['event-1'] }] };
  return { session, secondId: second.instanceId };
}

function submit(session: ReturnType<typeof createGameSession>, ids: readonly string[]) {
  return session.executeCommand(createConfirmEffectStepCommand(P1, session.state!.activeEffect!.id, undefined, undefined, undefined, undefined, ids));
}

describe('Aqours S PR shared look-top-three arrange workflow', () => {
  for (const [cardCode, name] of CARDS) {
    it(`${cardCode} starts the existing shared workflow`, () => {
      const { session, deckIds } = startViaRealEnter(cardCode, name);
      expect(session.state?.activeEffect).toMatchObject({
        abilityId: S_PR_ON_ENTER_LOOK_TOP_THREE_ARRANGE_TO_TOP_ABILITY_ID,
        effectText: EFFECT_TEXT,
        stepText: '请选择要留在卡组顶的卡牌。数字1会成为卡组最上方的卡，未选择的卡牌将放置入休息室。',
        selectionLabel: '按卡组顶从上到下的顺序选择卡牌',
        confirmSelectionLabel: '按此顺序放回卡组顶',
        selectableCardMode: 'ORDERED_MULTI',
        minSelectableCards: 0,
        maxSelectableCards: 3,
        selectableCardIds: deckIds,
      });
      expect(getCardAbilityDefinitionsForCardCode(cardCode).some((definition) => definition.abilityId === PL_N_BP1_002_ACTIVATED_FROM_WAITING_ROOM_PAY_TWO_DISCARD_ONE_PLAY_SELF_ABILITY_ID)).toBe(false);
    });
  }

  it('keeps two in order, sends one through one deck-to-waiting event, and records summaries', () => {
    const { session, deckIds } = startViaRealEnter(...CARDS[0]);
    const order = [deckIds[1]!, deckIds[0]!];
    expect(submit(session, order).success).toBe(true);
    expect(session.state?.players[0].mainDeck.cardIds.slice(0, 2)).toEqual(order);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([deckIds[2]]);
    expect(session.state?.eventLog.filter(({ event }) => event.eventType === TriggerCondition.ON_ENTER_WAITING_ROOM && event.fromZone === ZoneType.MAIN_DECK && event.toZone === ZoneType.WAITING_ROOM)).toHaveLength(1);
    const summaries = session.state?.actionHistory.filter((action) => action.payload.publicEffectSummary).map((action) => action.payload.publicEffectSummary);
    expect(summaries).toEqual(expect.arrayContaining([
      expect.objectContaining({ summaryStatus: 'STARTED', sourceActionLabel: '登场' }),
      expect.objectContaining({ summaryStatus: 'COMPLETED', waitingRoomCardIds: [deckIds[2]] }),
    ]));
  });

  it('supports zero, all three, and the actually inspected short deck', () => {
    const none = startViaRealEnter(...CARDS[1]);
    expect(submit(none.session, []).success).toBe(true);
    const waitingEvents = none.session.state?.eventLog.filter(({ event }) => event.eventType === TriggerCondition.ON_ENTER_WAITING_ROOM && event.fromZone === ZoneType.MAIN_DECK && event.toZone === ZoneType.WAITING_ROOM);
    expect(waitingEvents).toHaveLength(1);
    expect(waitingEvents?.[0]?.event.cardInstanceIds).toEqual(none.deckIds);
    expect(none.session.state?.pendingAbilities).toEqual([]);
    const all = startViaRealEnter(...CARDS[2]);
    const reversed = [...all.deckIds].reverse();
    expect(submit(all.session, reversed).success).toBe(true);
    expect(all.session.state?.players[0].mainDeck.cardIds).toEqual(reversed);
    expect(all.session.state?.players[0].waitingRoom.cardIds).toEqual([]);
    const short = startViaRealEnter(CARDS[0][0], CARDS[0][1], 2);
    expect(short.session.state?.activeEffect?.maxSelectableCards).toBe(2);
    expect(submit(short.session, [short.deckIds[1]!]).success).toBe(true);
    expect(short.session.state?.players[0].mainDeck.cardIds[0]).toBe(short.deckIds[1]);
    expect(short.session.state?.players[0].waitingRoom.cardIds).toEqual([short.deckIds[0]]);
  });

  it('rejects duplicate, unrelated, and excessive ids without cleanup or pending progress', () => {
    const selections = (ids: readonly string[]) => [[ids[0]!, ids[0]!], [ids[0]!, 'unrelated'], [ids[0]!, ids[1]!, ids[2]!, 'excess']];
    for (let index = 0; index < 3; index += 1) {
      const scenario = startViaRealEnter(...CARDS[0]);
      expect(submit(scenario.session, selections(scenario.deckIds)[index]!).success).toBe(false);
      expect(scenario.session.state?.activeEffect).not.toBeNull();
      expect(scenario.session.state?.inspectionZone.cardIds).toEqual(scenario.deckIds);
      expect(scenario.session.state?.players[0].waitingRoom.cardIds).toEqual([]);
    }
  });

  it('returns through the shared continuation to the next pending ability', () => {
    const scenario = startContinuationFixture();
    const firstInspected = scenario.session.state!.activeEffect!.selectableCardIds!;
    expect(submit(scenario.session, firstInspected).success).toBe(true);
    expect(scenario.session.state?.activeEffect).toMatchObject({
      abilityId: S_PR_ON_ENTER_LOOK_TOP_THREE_ARRANGE_TO_TOP_ABILITY_ID,
      sourceCardId: scenario.secondId,
    });
    expect(scenario.session.state?.activeEffect?.selectableCardIds).toHaveLength(3);
  });
});
