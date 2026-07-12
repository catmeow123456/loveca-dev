import { describe, expect, it } from 'vitest';
import {
  createCardInstance,
  createHeartIcon,
  type MemberCardData,
} from '../../src/domain/entities/card';
import {
  createGameState,
  emitGameEvent,
  registerCards,
  updatePlayer,
  type GameState,
} from '../../src/domain/entities/game';
import {
  createAutoAdvancePublicCardSelectionCommand,
  createConfirmEffectStepCommand,
} from '../../src/application/game-commands';
import { createGameSession } from '../../src/application/game-session';
import {
  createWaitingRoomToHandEffectState,
  createWaitingRoomToHandSelectionConfig,
  getZoneSelectionConfig,
  moveSelectedCardsFromZone,
} from '../../src/application/effects/zone-selection';
import { registerActiveEffectStepHandler } from '../../src/application/card-effects/runtime/step-registry';
import {
  getPublicCardSelectionDisplayDurationMs,
  PUBLIC_CARD_SELECTION_CONFIRMATION_STEP_ID,
} from '../../src/application/card-effects/runtime/public-card-selection-confirmation';
import { createPublicObjectId, projectPlayerViewState } from '../../src/online/projector';
import { CardType, HeartColor } from '../../src/shared/types/enums';
import { createCheerEvent } from '../../src/domain/events/game-events';
import { moveRevealedCheerCards } from '../../src/application/effects/cheer-selection';

const PLAYER1 = 'player1';
const PLAYER2 = 'player2';
const ABILITY_ID = 'test:public-waiting-room-selection';
const STEP_ID = 'SELECT_WAITING_ROOM_CARDS';
const CHEER_ABILITY_ID = 'test:public-revealed-cheer-selection';
const CHEER_STEP_ID = 'SELECT_REVEALED_CHEER_CARDS';

function member(id: string): ReturnType<typeof createCardInstance> {
  const data: MemberCardData = {
    cardCode: id,
    name: id,
    cardType: CardType.MEMBER,
    cost: 1,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.PINK, 1)],
  };
  return createCardInstance(data, PLAYER1, id);
}

function setupRevealedCheer(count = 2) {
  let now = 10_000;
  const cards = Array.from({ length: count }, (_, index) => member(`cheer-${index}`));
  let game = registerCards(
    createGameState('public-cheer-selection-test', PLAYER1, 'P1', PLAYER2, 'P2'),
    cards
  );
  const cardIds = cards.map((card) => card.instanceId);
  const cheerEvent = createCheerEvent(PLAYER1, cardIds, count);
  game = emitGameEvent(game, cheerEvent);
  game = {
    ...game,
    resolutionZone: {
      ...game.resolutionZone,
      cardIds,
      revealedCardIds: cardIds,
    },
    liveResolution: {
      ...game.liveResolution,
      firstPlayerCheerCardIds: cardIds,
    },
    activeEffect: {
      id: 'public-cheer-selection-effect',
      abilityId: CHEER_ABILITY_ID,
      sourceCardId: cards[0]!.instanceId,
      controllerId: PLAYER1,
      effectText: '从声援公开卡中加入手牌。',
      stepId: CHEER_STEP_ID,
      stepText: '选择要加入手牌的声援公开卡。',
      awaitingPlayerId: PLAYER1,
      selectableCardIds: cardIds,
      selectableCardMode: 'ORDERED_MULTI',
      minSelectableCards: count,
      maxSelectableCards: count,
      metadata: {
        publicCardSelectionConfirmation: {
          source: 'REVEALED_CHEER',
          destination: 'HAND',
        },
      },
    },
  };
  registerActiveEffectStepHandler(CHEER_ABILITY_ID, CHEER_STEP_ID, (state, input) => {
    const selectedCardIds = input.selectedCardIds ?? [];
    const moved = moveRevealedCheerCards(state, PLAYER1, selectedCardIds, 'HAND');
    return moved ? { ...moved.gameState, activeEffect: null } : state;
  });
  const session = createGameSession({ now: () => now });
  session.createGame('public-cheer-selection-session', PLAYER1, 'P1', PLAYER2, 'P2');
  (session as unknown as { authorityState: GameState }).authorityState = game;
  return {
    session,
    cardIds,
    cheerEventId: cheerEvent.eventId,
    setNow: (value: number) => {
      now = value;
    },
  };
}

function setup(
  count = 1,
  optional = false
): {
  readonly session: ReturnType<typeof createGameSession>;
  readonly cardIds: readonly string[];
  readonly setNow: (value: number) => void;
} {
  let now = 10_000;
  const cards = Array.from({ length: count }, (_, index) => member(`waiting-${index}`));
  let game = registerCards(
    createGameState('public-selection-test', PLAYER1, 'P1', PLAYER2, 'P2'),
    cards
  );
  game = updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    waitingRoom: { ...player.waitingRoom, cardIds: cards.map((card) => card.instanceId) },
  }));
  const zoneSelection = createWaitingRoomToHandSelectionConfig({
    minCount: optional ? 0 : count,
    maxCount: count,
    optional,
  });
  game = {
    ...game,
    activeEffect: createWaitingRoomToHandEffectState({
      id: 'public-selection-effect',
      abilityId: ABILITY_ID,
      sourceCardId: cards[0].instanceId,
      controllerId: PLAYER1,
      effectText: '从休息室加入手牌。',
      stepId: STEP_ID,
      stepText: '选择要加入手牌的卡。',
      awaitingPlayerId: PLAYER1,
      selectableCardIds: cards.map((card) => card.instanceId),
      selectionLabel: '选择要加入手牌的卡',
      confirmSelectionLabel: '加入手牌',
      zoneSelection,
    }),
  };
  registerActiveEffectStepHandler(ABILITY_ID, STEP_ID, (state, input) => {
    const effect = state.activeEffect;
    if (!effect) return state;
    const selected = input.selectedCardIds ?? (input.selectedCardId ? [input.selectedCardId] : []);
    const moved = moveSelectedCardsFromZone(
      state,
      effect.controllerId,
      selected,
      getZoneSelectionConfig(effect)
    );
    return moved ? { ...moved, activeEffect: null } : state;
  });
  const session = createGameSession({ now: () => now });
  session.createGame('public-selection-session', PLAYER1, 'P1', PLAYER2, 'P2');
  (session as unknown as { authorityState: GameState }).authorityState = game;
  return {
    session,
    cardIds: cards.map((card) => card.instanceId),
    setNow: (value) => {
      now = value;
    },
  };
}

describe('public waiting-room card selection confirmation', () => {
  it('scales the display duration by revealed card count and caps it at 3500ms', () => {
    expect(getPublicCardSelectionDisplayDurationMs(1)).toBe(2_000);
    expect(getPublicCardSelectionDisplayDurationMs(2)).toBe(2_300);
    expect(getPublicCardSelectionDisplayDurationMs(4)).toBe(2_900);
    expect(getPublicCardSelectionDisplayDurationMs(6)).toBe(3_500);
    expect(getPublicCardSelectionDisplayDurationMs(8)).toBe(3_500);
  });

  it('uses the same authoritative deadline and undo lifecycle for current revealed-cheer cards while preserving event facts', () => {
    const { session, cardIds, cheerEventId, setNow } = setupRevealedCheer();
    const effectId = session.state!.activeEffect!.id;
    const selected = session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        effectId,
        undefined,
        undefined,
        undefined,
        undefined,
        cardIds
      )
    );
    expect(selected.success, selected.error).toBe(true);
    const selectionUndo = session.getUndoAvailability(PLAYER1);
    expect(session.state?.activeEffect).toMatchObject({
      stepId: PUBLIC_CARD_SELECTION_CONFIRMATION_STEP_ID,
      revealedCardIds: cardIds,
      publicCardSelectionAutoAdvanceAt: 12_300,
    });
    expect(session.state?.resolutionZone.cardIds).toEqual(cardIds);
    expect(session.state?.players[0].hand.cardIds).toEqual([]);
    const expectedObjectIds = cardIds.map(createPublicObjectId);
    expect(projectPlayerViewState(session.state!, PLAYER1, { now: 10_000 }).activeEffect)
      .toMatchObject({
        revealedObjectIds: expectedObjectIds,
        publicCardSelectionAutoAdvanceAfterMs: 2_300,
      });
    expect(projectPlayerViewState(session.state!, PLAYER2, { now: 10_000 }).activeEffect)
      .toMatchObject({
        revealedObjectIds: expectedObjectIds,
        publicCardSelectionAutoAdvanceAfterMs: 2_300,
      });

    setNow(12_300);
    const advanced = session.executeCommand(
      createAutoAdvancePublicCardSelectionCommand(PLAYER2, effectId, 12_300)
    );
    expect(advanced.success, advanced.error).toBe(true);
    expect(session.state?.players[0].hand.cardIds).toEqual(cardIds);
    expect(session.state?.resolutionZone.cardIds).toEqual([]);
    expect(
      session.state?.eventLog.find((entry) => entry.event.eventId === cheerEventId)?.event
    ).toMatchObject({ revealedCardIds: cardIds });

    const resolvedUndo = session.getUndoAvailability(PLAYER1);
    expect(resolvedUndo.entry?.undoEntryId).toBe(selectionUndo.entry?.undoEntryId);
    const undone = session.undoLastStepForPlayer(PLAYER1, resolvedUndo.entry!.undoEntryId);
    expect(undone.success, undone.error).toBe(true);
    expect(session.state?.activeEffect).toMatchObject({ stepId: CHEER_STEP_ID });
    expect(session.state?.resolutionZone.cardIds).toEqual(cardIds);
    expect(session.state?.players[0].hand.cardIds).toEqual([]);
  });

  it('does not move a displayed cheer card that is no longer part of the current cheer at deadline', () => {
    const { session, cardIds, setNow } = setupRevealedCheer(1);
    const effectId = session.state!.activeEffect!.id;
    expect(
      session.executeCommand(
        createConfirmEffectStepCommand(
          PLAYER1,
          effectId,
          undefined,
          undefined,
          undefined,
          undefined,
          cardIds
        )
      ).success
    ).toBe(true);
    (session as unknown as { authorityState: GameState }).authorityState = {
      ...session.state!,
      liveResolution: {
        ...session.state!.liveResolution,
        firstPlayerCheerCardIds: [],
      },
    };
    setNow(12_000);
    const advanced = session.executeCommand(
      createAutoAdvancePublicCardSelectionCommand(PLAYER2, effectId, 12_000)
    );
    expect(advanced.success, advanced.error).toBe(true);
    expect(session.state?.activeEffect).toMatchObject({ stepId: CHEER_STEP_ID });
    expect(session.state?.resolutionZone.cardIds).toEqual(cardIds);
    expect(session.state?.players[0].hand.cardIds).toEqual([]);
  });

  it('reveals to both players before movement, then either participant can advance at the deadline', () => {
    const { session, cardIds, setNow } = setup();
    const effectId = session.state!.activeEffect!.id;
    expect(
      session.executeCommand(
        createAutoAdvancePublicCardSelectionCommand(PLAYER1, effectId, 12_000)
      ).success
    ).toBe(false);
    const opponentAttempt = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER2, effectId, cardIds[0])
    );
    expect(opponentAttempt.success).toBe(false);

    const selected = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, effectId, cardIds[0])
    );
    expect(selected.success, selected.error).toBe(true);
    const selectionUndo = session.getUndoAvailability(PLAYER1);
    expect(selectionUndo).toMatchObject({
      canUndoNow: true,
      entry: {
        actorPlayerId: PLAYER1,
        label: 'CONFIRM_EFFECT_STEP',
      },
    });
    expect(session.state?.activeEffect).toMatchObject({
      stepId: PUBLIC_CARD_SELECTION_CONFIRMATION_STEP_ID,
      revealedCardIds: cardIds,
      publicCardSelectionAutoAdvanceAt: 12_000,
    });
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual(cardIds);
    expect(session.state?.players[0].hand.cardIds).toEqual([]);

    const expectedObjectIds = cardIds.map(createPublicObjectId);
    const player1View = projectPlayerViewState(session.state!, PLAYER1, { now: 10_000 });
    const player2View = projectPlayerViewState(session.state!, PLAYER2, { now: 10_000 });
    expect(player1View.activeEffect?.revealedObjectIds).toEqual(expectedObjectIds);
    expect(player2View.activeEffect?.revealedObjectIds).toEqual(expectedObjectIds);
    expect(player1View.activeEffect?.publicCardSelectionAutoAdvanceAt).toBe(12_000);
    expect(player2View.activeEffect?.publicCardSelectionAutoAdvanceAt).toBe(12_000);
    expect(player1View.activeEffect?.publicCardSelectionAutoAdvanceAfterMs).toBe(2_000);
    expect(player2View.activeEffect?.publicCardSelectionAutoAdvanceAfterMs).toBe(2_000);
    expect(player1View.activeEffect?.confirmSelectionLabel).toBeUndefined();
    expect(player2View.activeEffect?.confirmSelectionLabel).toBeUndefined();
    expect(
      player1View.permissions.availableCommands.some(
        (hint) => hint.command === 'CONFIRM_EFFECT_STEP'
      )
    ).toBe(true);
    expect(
      player2View.permissions.availableCommands.some(
        (hint) => hint.command === 'CONFIRM_EFFECT_STEP'
      )
    ).toBe(true);

    const earlyPlayer1 = session.executeCommand(
      createAutoAdvancePublicCardSelectionCommand(PLAYER1, effectId, 12_000)
    );
    const earlyPlayer2 = session.executeCommand(
      createAutoAdvancePublicCardSelectionCommand(PLAYER2, effectId, 12_000)
    );
    expect(earlyPlayer1.success).toBe(false);
    expect(earlyPlayer2.success).toBe(false);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual(cardIds);

    setNow(12_000);
    expect(
      session.getPlayerViewState(PLAYER2)?.activeEffect
        ?.publicCardSelectionAutoAdvanceAfterMs
    ).toBe(0);
    expect(
      session.executeCommand(createConfirmEffectStepCommand(PLAYER2, effectId)).success
    ).toBe(false);
    const confirmed = session.executeCommand(
      createAutoAdvancePublicCardSelectionCommand(PLAYER2, effectId, 12_000)
    );
    expect(confirmed.success, confirmed.error).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([]);
    expect(session.state?.players[0].hand.cardIds).toEqual(cardIds);
    const repeated = session.executeCommand(
      createAutoAdvancePublicCardSelectionCommand(PLAYER1, effectId, 12_000)
    );
    expect(repeated.success).toBe(false);
    expect(session.state?.players[0].hand.cardIds).toEqual(cardIds);

    const resolvedUndo = session.getUndoAvailability(PLAYER1);
    expect(resolvedUndo.entry?.undoEntryId).toBe(selectionUndo.entry?.undoEntryId);
    expect(resolvedUndo.entry?.actorPlayerId).toBe(PLAYER1);
    expect(resolvedUndo.entry?.afterCommandSeq).toBeGreaterThan(
      selectionUndo.entry?.afterCommandSeq ?? 0
    );
    expect(session.getUndoAvailability(PLAYER2)).toMatchObject({
      canUndoNow: false,
      disabledReason: '只能撤销自己最近一次操作',
    });

    const undone = session.undoLastStepForPlayer(PLAYER1, resolvedUndo.entry!.undoEntryId);
    expect(undone.success, undone.error).toBe(true);
    expect(session.state?.activeEffect).toMatchObject({
      id: effectId,
      stepId: STEP_ID,
    });
    expect(session.state?.activeEffect?.publicCardSelectionAutoAdvanceAt).toBeUndefined();
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual(cardIds);
    expect(session.state?.players[0].hand.cardIds).toEqual([]);
  });

  it('preserves ordered multi selection and skips an empty optional choice without a reveal window', () => {
    const ordered = setup(2);
    const reverse = [...ordered.cardIds].reverse();
    expect(
      ordered.session.executeCommand(
        createConfirmEffectStepCommand(
          PLAYER1,
          ordered.session.state!.activeEffect!.id,
          undefined,
          undefined,
          undefined,
          undefined,
          reverse
        )
      ).success
    ).toBe(true);
    expect(ordered.session.state?.activeEffect?.revealedCardIds).toEqual(reverse);
    expect(ordered.session.state?.activeEffect?.publicCardSelectionOrdered).toBe(true);
    expect(ordered.session.state?.activeEffect?.publicCardSelectionAutoAdvanceAt).toBe(12_300);
    ordered.setNow(12_300);
    expect(
      ordered.session.executeCommand(
        createAutoAdvancePublicCardSelectionCommand(
          PLAYER1,
          ordered.session.state!.activeEffect!.id,
          12_300
        )
      ).success
    ).toBe(true);
    expect(ordered.session.state?.players[0].hand.cardIds).toEqual(reverse);

    const skipped = setup(2, true);
    expect(
      skipped.session.executeCommand(
        createConfirmEffectStepCommand(
          PLAYER1,
          skipped.session.state!.activeEffect!.id,
          undefined,
          undefined,
          undefined,
          undefined,
          []
        )
      ).success
    ).toBe(true);
    expect(skipped.session.state?.activeEffect).toBeNull();
    expect(skipped.session.state?.players[0].waitingRoom.cardIds).toEqual(skipped.cardIds);
  });

  it('restores the original selection when the revealed card becomes stale before final confirmation', () => {
    const { session, cardIds, setNow } = setup();
    const effectId = session.state!.activeEffect!.id;
    expect(
      session.executeCommand(createConfirmEffectStepCommand(PLAYER1, effectId, cardIds[0])).success
    ).toBe(true);
    expect(session.state?.activeEffect?.stepId).toBe(PUBLIC_CARD_SELECTION_CONFIRMATION_STEP_ID);

    const staleState = updatePlayer(session.state!, PLAYER1, (player) => ({
      ...player,
      waitingRoom: { ...player.waitingRoom, cardIds: [] },
      hand: { ...player.hand, cardIds: [cardIds[0]] },
    }));
    (session as unknown as { authorityState: GameState }).authorityState = staleState;
    setNow(12_000);

    expect(
      session.executeCommand(
        createAutoAdvancePublicCardSelectionCommand(PLAYER2, effectId, 12_000)
      ).success
    ).toBe(true);
    expect(session.state?.activeEffect?.stepId).toBe(STEP_ID);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([]);
    expect(session.state?.players[0].hand.cardIds).toEqual(cardIds);
  });

  it('rejects non-participants and selection payloads on the automatic advance step', () => {
    const { session, cardIds, setNow } = setup();
    const effectId = session.state!.activeEffect!.id;
    expect(
      session.executeCommand(createConfirmEffectStepCommand(PLAYER1, effectId, cardIds[0])).success
    ).toBe(true);
    setNow(12_000);

    expect(
      session.executeCommand(
        createAutoAdvancePublicCardSelectionCommand('outsider', effectId, 12_000)
      ).success
    ).toBe(false);
    expect(
      session.executeCommand({
        ...createAutoAdvancePublicCardSelectionCommand(PLAYER2, effectId, 12_000),
        selectedCardId: cardIds[0],
      }).success
    ).toBe(false);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual(cardIds);
  });

  it('rejects a delayed token from an older public window that reused the same effect id', () => {
    const { session, cardIds, setNow } = setup();
    const effectId = session.state!.activeEffect!.id;
    expect(
      session.executeCommand(createConfirmEffectStepCommand(PLAYER1, effectId, cardIds[0])).success
    ).toBe(true);

    const nextDeadline = 15_000;
    (session as unknown as { authorityState: GameState }).authorityState = {
      ...session.state!,
      activeEffect: {
        ...session.state!.activeEffect!,
        publicCardSelectionAutoAdvanceAt: nextDeadline,
      },
    };
    setNow(nextDeadline);

    expect(
      session.executeCommand(
        createAutoAdvancePublicCardSelectionCommand(PLAYER2, effectId, 12_000)
      ).success
    ).toBe(false);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual(cardIds);
    expect(
      session.executeCommand(
        createAutoAdvancePublicCardSelectionCommand(PLAYER2, effectId, nextDeadline)
      ).success
    ).toBe(true);
    expect(session.state?.players[0].hand.cardIds).toEqual(cardIds);
  });
});
