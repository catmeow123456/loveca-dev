import { describe, expect, it } from 'vitest';
import {
  ABILITY_ORDER_SELECTION_ID,
  confirmActiveEffectStep,
  enqueueTriggeredCardEffects,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import {
  HS_BP8_018_AUTO_REVEALED_CHEER_MOVED_SOURCE_SCORE_ABILITY_ID as HOLIDAY_ABILITY,
  S_BP3_020_AUTO_ON_CHEER_AT_MOST_TWO_BLADE_HEART_REROLL_ABILITY_ID as REROLL_ABILITY,
} from '../../src/application/card-effects/ability-ids';
import { CONFIRM_ONLY_PENDING_ABILITY_STEP_ID } from '../../src/application/card-effects/runtime/active-effect';
import { PUBLIC_CARD_SELECTION_CONFIRMATION_STEP_ID } from '../../src/application/card-effects/runtime/public-card-selection-confirmation';
import { moveRevealedCheerCardsAndEnqueueTriggers } from '../../src/application/card-effects/runtime/revealed-cheer-movement-triggers';
import { moveCardUniversal } from '../../src/application/action-handlers/zone-operations';
import { createConfirmJudgmentAction } from '../../src/application/actions';
import { revealCheerCardsFromMainDeck } from '../../src/application/effects/cheer';
import { GameService } from '../../src/application/game-service';
import {
  createCardInstance,
  createHeartIcon,
  type MemberCardData,
} from '../../src/domain/entities/card';
import {
  createGameState,
  registerCards,
  updatePlayer,
  type GameState,
} from '../../src/domain/entities/game';
import { addCardToStatefulZone, updateCardState } from '../../src/domain/entities/zone';
import { getLiveCardScoreModifier } from '../../src/domain/rules/live-modifiers';
import {
  CardType,
  FaceState,
  GamePhase,
  HeartColor,
  OrientationState,
  SlotPosition,
  SubPhase,
  TriggerCondition,
  TurnType,
  ZoneType,
} from '../../src/shared/types/enums';
import { getNovember06DraftRow, getNovember06LiveData } from '../helpers/november-06-draft-effects';

const P1 = 'player1';
const P2 = 'player2';
const BASE = 'PL!HS-bp8-018';
const HOLIDAY_1 = 'holiday-first';
const HOLIDAY_2 = 'holiday-second';
const MEMBER = 'moving-member';
const OPPONENT_MEMBER = 'opponent-member';
const MOVE_TIMING = TriggerCondition.ON_REVEALED_CHEER_CARDS_MOVED;
const MEMBER_EFFECT = {
  id: 'moving-member-pending',
  controllerId: P1,
  sourceCardId: MEMBER,
  abilityId: 'test:move-cheer',
};

const REROLL_1 = 'reroll-first';
const REROLL_2 = 'reroll-second';

function setup({
  secondHoliday = false,
  rerollSources = 0,
  firstFace = FaceState.FACE_UP,
}: {
  readonly secondHoliday?: boolean;
  readonly rerollSources?: number;
  readonly firstFace?: FaceState;
} = {}) {
  const holidayData = getNovember06LiveData(BASE);
  const holiday = createCardInstance(holidayData, P1, HOLIDAY_1);
  const anotherPrint = createCardInstance({ ...holidayData, cardCode: `${BASE}-L` }, P1, HOLIDAY_2);
  const memberData: MemberCardData = {
    cardType: CardType.MEMBER,
    cardCode: 'TEST-MEMBER',
    name: 'Member',
    cost: 1,
    blade: 1,
    hearts: [
      createHeartIcon(HeartColor.GREEN, 4),
      createHeartIcon(HeartColor.BLUE, 1),
      createHeartIcon(HeartColor.RED, 2),
    ],
  };
  const member = createCardInstance(memberData, P1, MEMBER);
  const opponentMember = createCardInstance(member.data, P2, OPPONENT_MEMBER);
  const ownCheerCards = ['cheer-1', 'cheer-2', 'cheer-3', 'cheer-4', 'cheer-5', 'cheer-6'].map(
    (id) => createCardInstance(member.data, P1, id)
  );
  const opponentCheer = createCardInstance(member.data, P2, 'opponent-cheer');
  const rerollCards = [REROLL_1, REROLL_2]
    .slice(0, rerollSources)
    .map((id) => createCardInstance(getNovember06LiveData('PL!S-bp3-020-L'), P1, id));
  const liveCards = [holiday, ...(secondHoliday ? [anotherPrint] : []), ...rerollCards];
  let game = registerCards(createGameState('holiday-cheer-movement', P1, 'P1', P2, 'P2'), [
    ...liveCards,
    member,
    opponentMember,
    ...ownCheerCards,
    opponentCheer,
  ]);
  game = updatePlayer(game, P1, (player) => ({
    ...player,
    memberSlots: {
      ...player.memberSlots,
      slots: { ...player.memberSlots.slots, [SlotPosition.LEFT]: MEMBER },
    },
    liveZone: liveCards.reduce(
      (zone, card) =>
        addCardToStatefulZone(zone, card.instanceId, {
          orientation: OrientationState.ACTIVE,
          face: card.instanceId === HOLIDAY_1 ? firstFace : FaceState.FACE_UP,
        }),
      player.liveZone
    ),
    mainDeck: { ...player.mainDeck, cardIds: ownCheerCards.map((card) => card.instanceId) },
  }));
  return updatePlayer(game, P2, (player) => ({
    ...player,
    mainDeck: { ...player.mainDeck, cardIds: [opponentCheer.instanceId] },
  }));
}

function move(game: GameState, cardIds: readonly string[]) {
  const result = moveRevealedCheerCardsAndEnqueueTriggers(game, P1, cardIds, 'HAND', MEMBER_EFFECT);
  expect(result).not.toBeNull();
  return result!.gameState;
}

function movementEvents(game: GameState) {
  return game.eventLog
    .map(({ event }) => event)
    .filter((event) => 'movedCardIds' in event && event.eventType === MOVE_TIMING);
}

function holidayPending(game: GameState) {
  return game.pendingAbilities.filter((ability) => ability.abilityId === HOLIDAY_ABILITY);
}

function holidayUses(game: GameState) {
  return game.actionHistory.filter(
    ({ payload, type }) =>
      type === 'RESOLVE_ABILITY' &&
      payload.abilityId === HOLIDAY_ABILITY &&
      payload.step === 'ABILITY_USE'
  );
}

function confirm(game: GameState) {
  expect(game.activeEffect?.stepId).toBe(CONFIRM_ONLY_PENDING_ABILITY_STEP_ID);
  return confirmActiveEffectStep(game, P1, game.activeEffect!.id);
}

describe('PL!HS-bp8-018 Holiday∞Holiday', () => {
  it('records one immutable batch and recognizes additional cheer moved by an own member effect', () => {
    const revealed = revealCheerCardsFromMainDeck(setup(), P1, 3, { additional: true });
    const selected = ['cheer-2', 'cheer-1'];
    const queued = move(revealed.gameState, selected);
    selected.reverse();

    expect(queued.players[0].hand.cardIds).toEqual(['cheer-2', 'cheer-1']);
    expect(queued.resolutionZone.cardIds).toEqual(['cheer-3']);
    expect(queued.activeEffect).toBeNull();
    const [event] = movementEvents(queued);
    expect(movementEvents(queued)).toHaveLength(1);
    expect(event).toMatchObject({
      playerId: P1,
      controllerId: P1,
      fromZone: ZoneType.RESOLUTION_ZONE,
      toZone: ZoneType.HAND,
      destination: 'HAND',
      movedCardIds: ['cheer-2', 'cheer-1'],
      cause: {
        kind: 'CARD_EFFECT',
        playerId: P1,
        sourceCardId: MEMBER,
        abilityId: MEMBER_EFFECT.abilityId,
        pendingAbilityId: MEMBER_EFFECT.id,
      },
    });
    expect(Object.isFrozen(event!.movedCardIds)).toBe(true);
    expect(holidayPending(queued)).toEqual([
      expect.objectContaining({
        sourceCardId: HOLIDAY_1,
        timingId: MOVE_TIMING,
        eventIds: [event!.eventId],
      }),
    ]);
    expect(
      queued.actionHistory.filter(
        ({ type, payload }) =>
          type === 'DISPATCH_TRIGGER_EVENT' && payload.eventId === event!.eventId
      )
    ).toHaveLength(1);

    const confirming = resolvePendingCardEffects(queued).gameState;
    expect(confirming.activeEffect?.effectText).toBe(getNovember06DraftRow(BASE).cardTextCn);
    expect(getLiveCardScoreModifier(confirming.liveResolution, HOLIDAY_1)).toBe(0);
    expect(holidayUses(confirming)).toHaveLength(0);
    const scored = confirm(confirming);
    expect(getLiveCardScoreModifier(scored.liveResolution, HOLIDAY_1)).toBe(1);
    expect(scored.liveResolution.playerScores.has(P1)).toBe(false);
    const result = new GameService().processAction(
      {
        ...scored,
        currentPhase: GamePhase.PERFORMANCE_PHASE,
        currentSubPhase: SubPhase.PERFORMANCE_JUDGMENT,
        currentTurnType: TurnType.FIRST_PLAYER_TURN,
      },
      createConfirmJudgmentAction(P1, new Map())
    );
    expect(result.success, result.error).toBe(true);
    expect(result.gameState.liveResolution.liveResults.get(HOLIDAY_1)).toBe(true);
    expect(result.gameState.liveResolution.playerScores.get(P1)).toBe(4);
    expect(holidayUses(scored)).toHaveLength(1);
    expect(holidayPending(scored)).toHaveLength(0);
  });

  it.each(['MAIN_DECK_TOP', 'MAIN_DECK_BOTTOM'] as const)(
    'records the actual order and placement when multiple revealed cards go to %s',
    (destination) => {
      const { gameState } = revealCheerCardsFromMainDeck(setup(), P1, 2);
      const selected = ['cheer-2', 'cheer-1'];
      const moved = moveRevealedCheerCardsAndEnqueueTriggers(
        gameState,
        P1,
        selected,
        destination,
        MEMBER_EFFECT
      )!.gameState;
      const deck = moved.players[0].mainDeck.cardIds;
      const placed = destination === 'MAIN_DECK_TOP' ? deck.slice(0, 2) : deck.slice(-2);
      expect(placed).toEqual(selected);
      expect(movementEvents(moved)).toMatchObject([
        { movedCardIds: selected, destination, toZone: ZoneType.MAIN_DECK },
      ]);
      expect(holidayPending(moved)).toHaveLength(1);
    }
  );

  it('isolates turn-one occupancy for two LIVE sources across consecutive movement batches', () => {
    const { gameState } = revealCheerCardsFromMainDeck(setup({ secondHoliday: true }), P1, 4);
    const first = move(gameState, ['cheer-1', 'cheer-2']);
    const second = move(first, ['cheer-3']);
    expect(movementEvents(second)).toHaveLength(2);
    expect(holidayPending(second).map((ability) => ability.sourceCardId)).toEqual([
      HOLIDAY_1,
      HOLIDAY_2,
    ]);
    const ordered = resolvePendingCardEffects(second).gameState;
    const scored = confirmActiveEffectStep(
      ordered,
      P1,
      ordered.activeEffect!.id,
      undefined,
      undefined,
      true
    );
    expect(scored.activeEffect).toBeNull();
    expect(scored.liveResolution.liveModifiers).toMatchObject([
      { kind: 'SCORE', sourceCardId: HOLIDAY_1, liveCardId: HOLIDAY_1, countDelta: 1 },
      { kind: 'SCORE', sourceCardId: HOLIDAY_2, liveCardId: HOLIDAY_2, countDelta: 1 },
    ]);
    expect(holidayUses(scored)).toHaveLength(2);
    const third = move(scored, ['cheer-4']);
    expect(movementEvents(third)).toHaveLength(3);
    expect(holidayPending(third)).toHaveLength(0);
    expect(holidayUses(third)).toHaveLength(2);
  });

  it.each([
    { label: 'judged success', succeeded: true, confirmed: false, draft: 8, expected: 9 },
    { label: 'another LIVE succeeds', succeeded: false, confirmed: false, draft: 8, expected: 8 },
    { label: 'score already confirmed', succeeded: true, confirmed: true, draft: 8, expected: 8 },
  ])(
    'applies source score and synchronizes only the eligible player draft ($label)',
    ({ succeeded, confirmed, draft, expected }) => {
      const { gameState } = revealCheerCardsFromMainDeck(setup({ rerollSources: 1 }), P1, 1);
      const judged: GameState = {
        ...gameState,
        liveResolution: {
          ...gameState.liveResolution,
          liveResults: new Map([
            [HOLIDAY_1, succeeded],
            [REROLL_1, true],
          ]),
          playerScores: new Map([
            [P1, draft],
            [P2, 3],
          ]),
          scoreConfirmedBy: confirmed ? [P1] : [],
        },
      };
      const queued = move(judged, ['cheer-1']);
      const scored = confirm(resolvePendingCardEffects(queued).gameState);
      expect(getLiveCardScoreModifier(scored.liveResolution, HOLIDAY_1)).toBe(1);
      expect(getLiveCardScoreModifier(scored.liveResolution, REROLL_1)).toBe(0);
      expect(scored.liveResolution.playerScores).toEqual(
        new Map([
          [P1, expected],
          [P2, 3],
        ])
      );
    }
  );

  it('leaves an absent source or its reentered instance without the old pending score', () => {
    const { gameState } = revealCheerCardsFromMainDeck(setup(), P1, 2);
    const queued = move(gameState, ['cheer-1']);
    const [old] = holidayPending(queued);
    const waiting = resolvePendingCardEffects(queued).gameState;
    const left = moveCardUniversal(
      waiting,
      P1,
      HOLIDAY_1,
      ZoneType.LIVE_ZONE,
      ZoneType.WAITING_ROOM
    );
    const departed = confirm(left);
    expect(getLiveCardScoreModifier(departed.liveResolution, HOLIDAY_1)).toBe(0);

    const reentered = moveCardUniversal(
      left,
      P1,
      HOLIDAY_1,
      ZoneType.WAITING_ROOM,
      ZoneType.LIVE_ZONE
    );
    const stale = confirm(reentered);
    expect(getLiveCardScoreModifier(stale.liveResolution, HOLIDAY_1)).toBe(0);
    expect(holidayUses(stale)[0]?.payload.sourceLifecycleId).toBe(old?.sourceLifecycleId);

    const newPending = move(stale, ['cheer-2']);
    expect(holidayPending(newPending)).toHaveLength(1);
    expect(holidayPending(newPending)[0]?.sourceLifecycleId).not.toBe(old?.sourceLifecycleId);
    const scored = confirm(resolvePendingCardEffects(newPending).gameState);
    expect(getLiveCardScoreModifier(scored.liveResolution, HOLIDAY_1)).toBe(1);
  });

  it('consumes no turn use when the pending movement event is missing or belongs to another controller', () => {
    const { gameState } = revealCheerCardsFromMainDeck(setup(), P1, 2);
    const queued = move(gameState, ['cheer-1']);
    const [pending] = holidayPending(queued);
    const eventId = pending!.eventIds[0];
    const missing = {
      ...queued,
      eventLog: queued.eventLog.filter(({ event }) => event.eventId !== eventId),
    };
    const mismatched = {
      ...queued,
      eventLog: queued.eventLog.map((entry) =>
        entry.event.eventType === MOVE_TIMING && entry.event.eventId === eventId
          ? { ...entry, event: { ...entry.event, controllerId: P2 } }
          : entry
      ),
    };

    for (const state of [missing, mismatched]) {
      const resolved = resolvePendingCardEffects(state).gameState;
      expect(resolved.activeEffect).toBeNull();
      expect(holidayPending(resolved)).toHaveLength(0);
      expect(holidayUses(resolved)).toHaveLength(0);
      expect(getLiveCardScoreModifier(resolved.liveResolution, HOLIDAY_1)).toBe(0);
      expect(holidayPending(move(resolved, ['cheer-2']))).toHaveLength(1);
    }
  });

  it('excludes opponent effects and opponent cards, and avoids dispatching zero or invalid moves', () => {
    const first = revealCheerCardsFromMainDeck(setup(), P1, 3);
    const { gameState } = revealCheerCardsFromMainDeck(first.gameState, P2, 1);
    expect(move(gameState, [])).toBe(gameState);
    for (const invalid of [
      ['cheer-1', 'cheer-1'],
      ['cheer-1', 'opponent-cheer'],
      ['cheer-1', 'stale'],
    ]) {
      expect(
        moveRevealedCheerCardsAndEnqueueTriggers(gameState, P1, invalid, 'HAND', MEMBER_EFFECT)
      ).toBeNull();
    }
    expect(movementEvents(gameState)).toEqual([]);

    const opponentEffect = { ...MEMBER_EFFECT, controllerId: P2, sourceCardId: OPPONENT_MEMBER };
    const foreignEffect = moveRevealedCheerCardsAndEnqueueTriggers(
      gameState,
      P1,
      ['cheer-1'],
      'HAND',
      opponentEffect
    )!.gameState;
    const foreignCard = moveRevealedCheerCardsAndEnqueueTriggers(
      foreignEffect,
      P2,
      ['opponent-cheer'],
      'MAIN_DECK_TOP',
      MEMBER_EFFECT
    )!.gameState;
    expect(
      movementEvents(foreignCard).map(({ controllerId, playerId, toZone }) => [
        controllerId,
        playerId,
        toZone,
      ])
    ).toEqual([
      [P2, P1, ZoneType.HAND],
      [P1, P2, ZoneType.MAIN_DECK],
    ]);
    expect(holidayPending(foreignCard)).toEqual([]);
    expect(holidayUses(foreignCard)).toEqual([]);
    const foreignSource = moveRevealedCheerCardsAndEnqueueTriggers(
      foreignCard,
      P1,
      ['cheer-2'],
      'HAND',
      { ...MEMBER_EFFECT, sourceCardId: OPPONENT_MEMBER }
    )!.gameState;
    expect(holidayPending(foreignSource)).toEqual([]);
    expect(holidayPending(move(foreignSource, ['cheer-3']))).toHaveLength(1);
  });

  it('ignores rule settlement and movement before the source is face-up', () => {
    const { gameState } = revealCheerCardsFromMainDeck(
      setup({ firstFace: FaceState.FACE_DOWN }),
      P1,
      2
    );
    const moved = move(gameState, ['cheer-1']);
    expect(holidayPending(moved)).toEqual([]);
    expect(
      moved.actionHistory.some(
        ({ type, payload }) =>
          type === 'DISPATCH_TRIGGER_EVENT' && payload.eventId === movementEvents(moved)[0]?.eventId
      )
    ).toBe(true);
    const faceUp = updatePlayer(moved, P1, (player) => ({
      ...player,
      liveZone: updateCardState(player.liveZone, HOLIDAY_1, { face: FaceState.FACE_UP }),
    }));
    expect(resolvePendingCardEffects(faceUp).gameState.pendingAbilities).toEqual([]);
    const settled = new GameService().finalizeLiveResult({
      ...faceUp,
      currentPhase: GamePhase.LIVE_RESULT_PHASE,
      currentSubPhase: SubPhase.RESULT_SETTLEMENT,
    }).gameState;
    expect(settled.players[0].waitingRoom.cardIds).toContain('cheer-2');
    expect(movementEvents(settled)).toHaveLength(1);
    expect(holidayPending(settled)).toEqual([]);
    expect(holidayUses(settled)).toEqual([]);
  });

  it('waits for the LIVE reroll to finish, then reopens the ordered batch with Holiday', () => {
    const original = revealCheerCardsFromMainDeck(setup({ rerollSources: 2 }), P1, 2);
    const queued = enqueueTriggeredCardEffects(original.gameState, [TriggerCondition.ON_CHEER], {
      cheerEvents: [original.cheerEvent],
    });
    const order = resolvePendingCardEffects(queued).gameState;
    expect(order.activeEffect?.abilityId).toBe(ABILITY_ORDER_SELECTION_ID);
    const first = confirmActiveEffectStep(
      order,
      P1,
      order.activeEffect!.id,
      undefined,
      undefined,
      true
    );
    expect(first.activeEffect?.abilityId).toBe(REROLL_ABILITY);
    const display = confirmActiveEffectStep(
      first,
      P1,
      first.activeEffect!.id,
      undefined,
      undefined,
      false,
      'reroll'
    );
    expect(display.activeEffect?.stepId).toBe(PUBLIC_CARD_SELECTION_CONFIRMATION_STEP_ID);
    expect(movementEvents(display)).toEqual([]);
    expect(holidayPending(display)).toEqual([]);

    const rerolled = confirmActiveEffectStep(display, P1, display.activeEffect!.id);
    expect(rerolled.resolutionZone.revealedCardIds).toEqual(['cheer-3', 'cheer-4']);
    expect(rerolled.players[0].waitingRoom.cardIds).toEqual(['cheer-1', 'cheer-2']);
    const [movement] = movementEvents(rerolled);
    expect(movement).toMatchObject({
      movedCardIds: ['cheer-1', 'cheer-2'],
      toZone: ZoneType.WAITING_ROOM,
      cause: { sourceCardId: REROLL_1, abilityId: REROLL_ABILITY },
    });
    expect(rerolled.activeEffect).toMatchObject({
      abilityId: ABILITY_ORDER_SELECTION_ID,
    });
    expect(rerolled.activeEffect?.metadata?.pendingAbilityIds).toContain(
      holidayPending(rerolled)[0]?.id
    );
    const next = rerolled.pendingAbilities.find(
      (ability) => ability.abilityId === REROLL_ABILITY && ability.sourceCardId === REROLL_2
    );
    expect(next).toBeDefined();
    expect(rerolled.activeEffect?.metadata?.pendingAbilityIds).toContain(next?.id);
    expect(getLiveCardScoreModifier(rerolled.liveResolution, HOLIDAY_1)).toBe(0);

    const selectingHoliday = confirmActiveEffectStep(
      rerolled,
      P1,
      rerolled.activeEffect!.id,
      HOLIDAY_1
    );
    const scored = confirm(selectingHoliday);
    expect(getLiveCardScoreModifier(scored.liveResolution, HOLIDAY_1)).toBe(1);
    expect(scored.activeEffect?.abilityId).toBe(REROLL_ABILITY);
    expect(scored.liveResolution.playerScores.has(P1)).toBe(false);
  });
});
