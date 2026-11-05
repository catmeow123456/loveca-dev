import { describe, expect, it } from 'vitest';
import {
  createCardInstance,
  createHeartIcon,
  createHeartRequirement,
  type LiveCardData,
  type MemberCardData,
} from '../../src/domain/entities/card';
import {
  createGameState,
  emitGameEvent,
  registerCards,
  updatePlayer,
  type ActiveEffectState,
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
  attachPublicCardSelectionAutoAdvanceDeadline,
  createPublicCardSelectionConfirmationWindow,
  createPublicCardSelectionConfirmationWindowForCardIds,
  getPublicCardSelectionConfirmationConfig,
  PUBLIC_CARD_SELECTION_CONFIRMATION_STEP_ID,
} from '../../src/application/card-effects/runtime/public-card-selection-confirmation';
import { createPublicObjectId, projectPlayerViewState } from '../../src/online/projector';
import { CardType, HeartColor, ZoneType } from '../../src/shared/types/enums';
import { createCheerEvent } from '../../src/domain/events/game-events';
import { moveRevealedCheerCards } from '../../src/application/effects/cheer-selection';
import { moveInspectedSelectionToHandRestToWaitingRoom } from '../../src/application/effects/look-top';

const PLAYER1 = 'player1';
const PLAYER2 = 'player2';
const ABILITY_ID = 'test:public-waiting-room-selection';
const STEP_ID = 'SELECT_WAITING_ROOM_CARDS';
const CHEER_ABILITY_ID = 'test:public-revealed-cheer-selection';
const CHEER_STEP_ID = 'SELECT_REVEALED_CHEER_CARDS';
const INSPECTION_ABILITY_ID = 'test:public-revealed-inspection-selection';
const INSPECTION_STEP_ID = 'SELECT_REVEALED_INSPECTION_CARD';
const INSPECTION_CONFIRMATION_TEXT =
  '已选择的卡牌已向双方公开。展示结束后，将所选卡牌加入手牌，其余公开的卡牌放置入休息室。';

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

function setupRevealedInspection() {
  let now = 10_000;
  let resolutionCount = 0;
  const cards = [member('inspection-selected'), member('inspection-rest')];
  const cardIds = cards.map((card) => card.instanceId);
  const source = member('inspection-source');
  let game = registerCards(
    createGameState('public-inspection-selection-test', PLAYER1, 'P1', PLAYER2, 'P2'),
    [...cards, source]
  );
  const effect: ActiveEffectState = {
    id: 'public-inspection-selection-effect',
    abilityId: INSPECTION_ABILITY_ID,
    sourceCardId: source.instanceId,
    controllerId: PLAYER1,
    awaitingPlayerId: PLAYER1,
    effectText: '从公开的卡牌中选1张加入手牌，其余放置入休息室。',
    stepId: INSPECTION_STEP_ID,
    stepText: '选择要加入手牌的公开卡牌。',
    inspectionCardIds: cardIds,
    selectableCardIds: cardIds,
    metadata: {
      publicCardSelectionConfirmation: {
        source: 'REVEALED_INSPECTION',
        destination: 'HAND',
        stepText: INSPECTION_CONFIRMATION_TEXT,
      },
    },
  };
  game = {
    ...game,
    inspectionContext: { ownerPlayerId: PLAYER1, sourceZone: ZoneType.MAIN_DECK },
    inspectionZone: { ...game.inspectionZone, cardIds, revealedCardIds: cardIds },
    activeEffect: effect,
  };
  registerActiveEffectStepHandler(INSPECTION_ABILITY_ID, INSPECTION_STEP_ID, (state, input) => {
    resolutionCount += 1;
    const moved = moveInspectedSelectionToHandRestToWaitingRoom(
      state,
      PLAYER1,
      state.activeEffect?.inspectionCardIds ?? [],
      input.selectedCardId ?? null
    );
    return moved ? { ...moved.gameState, activeEffect: null } : state;
  });
  const session = createGameSession({ now: () => now });
  session.createGame('public-inspection-selection-session', PLAYER1, 'P1', PLAYER2, 'P2');
  (session as unknown as { authorityState: GameState }).authorityState = game;
  return {
    game,
    effect,
    session,
    cardIds,
    getResolutionCount: () => resolutionCount,
    setNow: (value: number) => {
      now = value;
    },
  };
}

const INVALID_INSPECTION_CASES = [
  'private card',
  'outside current inspection',
  'missing current inspection',
  'outside inspection zone',
  'foreign owner',
  'foreign context',
  'missing context',
] as const;

function invalidateInspectionSelection(
  game: GameState,
  effect: ActiveEffectState,
  cardId: string,
  invalidation: (typeof INVALID_INSPECTION_CASES)[number]
): { game: GameState; effect: ActiveEffectState } {
  switch (invalidation) {
    case 'private card':
      return {
        game: {
          ...game,
          inspectionZone: {
            ...game.inspectionZone,
            revealedCardIds: game.inspectionZone.revealedCardIds.filter((id) => id !== cardId),
          },
        },
        effect,
      };
    case 'outside current inspection':
      return {
        game,
        effect: {
          ...effect,
          inspectionCardIds: effect.inspectionCardIds?.filter((id) => id !== cardId),
        },
      };
    case 'missing current inspection':
      return { game, effect: { ...effect, inspectionCardIds: undefined } };
    case 'outside inspection zone':
      return {
        game: {
          ...game,
          inspectionZone: {
            ...game.inspectionZone,
            cardIds: game.inspectionZone.cardIds.filter((id) => id !== cardId),
          },
        },
        effect,
      };
    case 'foreign owner': {
      const registry = new Map(game.cardRegistry);
      registry.set(cardId, { ...registry.get(cardId)!, ownerId: PLAYER2 });
      return { game: { ...game, cardRegistry: registry }, effect };
    }
    case 'foreign context':
      return {
        game: {
          ...game,
          inspectionContext: { ...game.inspectionContext!, ownerPlayerId: PLAYER2 },
        },
        effect,
      };
    case 'missing context':
      return { game: { ...game, inspectionContext: null }, effect };
  }
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
  it('accepts the LIVE_ZONE destination and displays the selection before any move', () => {
    const data: LiveCardData = {
      cardCode: 'test-live',
      name: 'test-live',
      cardType: CardType.LIVE,
      score: 1,
      requirements: createHeartRequirement({}),
    };
    let game = registerCards(createGameState('live-selection', PLAYER1, 'P1', PLAYER2, 'P2'), [
      createCardInstance(data, PLAYER1, 'live'),
    ]);
    game = updatePlayer(game, PLAYER1, (player) => ({
      ...player,
      waitingRoom: { ...player.waitingRoom, cardIds: ['live'] },
    }));
    const effect = {
      id: 'effect',
      abilityId: 'test',
      sourceCardId: 'source',
      controllerId: PLAYER1,
      awaitingPlayerId: PLAYER1,
      effectText: '从休息室正面放置入LIVE卡区。',
      stepId: 'SELECT_LIVE',
      stepText: '选择LIVE卡。',
      selectableCardIds: ['live'],
      metadata: { publicCardSelectionConfirmation: { destination: 'LIVE_ZONE' } },
    };
    const config = getPublicCardSelectionConfirmationConfig(effect);
    expect(config?.destination).toBe('LIVE_ZONE');
    const displayed = createPublicCardSelectionConfirmationWindow(
      game,
      effect,
      { selectedCardId: 'live' },
      config!
    );
    expect(displayed?.activeEffect).toMatchObject({
      stepId: PUBLIC_CARD_SELECTION_CONFIRMATION_STEP_ID,
      revealedCardIds: ['live'],
      stepText: '已选择的LIVE卡已向双方公开，即将自动正面放置入LIVE卡区。',
    });
    expect(displayed?.players[0].waitingRoom.cardIds).toEqual(['live']);
    expect(displayed?.players[0].liveZone.cardIds).toEqual([]);
  });

  it('does not create a LIVE_ZONE public window for a foreign or non-LIVE card', () => {
    const data: LiveCardData = {
      cardCode: 'test-live',
      name: 'test-live',
      cardType: CardType.LIVE,
      score: 1,
      requirements: createHeartRequirement({}),
    };
    const member: MemberCardData = {
      cardCode: 'member',
      name: 'member',
      cardType: CardType.MEMBER,
      cost: 1,
      blade: 1,
      hearts: [],
    };
    let game = registerCards(
      createGameState('invalid-live-selection', PLAYER1, 'P1', PLAYER2, 'P2'),
      [createCardInstance(data, PLAYER2, 'foreign'), createCardInstance(member, PLAYER1, 'member')]
    );
    game = updatePlayer(game, PLAYER1, (player) => ({
      ...player,
      waitingRoom: { ...player.waitingRoom, cardIds: ['foreign', 'member'] },
    }));
    const effect = {
      id: 'effect',
      abilityId: 'test',
      sourceCardId: 'source',
      controllerId: PLAYER1,
      awaitingPlayerId: PLAYER1,
      effectText: 'effect',
      stepId: 'SELECT_LIVE',
      stepText: 'select',
      selectableCardIds: ['foreign', 'member'],
    };
    for (const id of ['foreign', 'member'])
      expect(
        createPublicCardSelectionConfirmationWindow(
          game,
          effect,
          { selectedCardId: id },
          { destination: 'LIVE_ZONE' }
        )
      ).toBeNull();
  });

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
    expect(
      projectPlayerViewState(session.state!, PLAYER1, { now: 10_000 }).activeEffect
    ).toMatchObject({
      revealedObjectIds: expectedObjectIds,
      publicCardSelectionAutoAdvanceAfterMs: 2_300,
    });
    expect(
      projectPlayerViewState(session.state!, PLAYER2, { now: 10_000 }).activeEffect
    ).toMatchObject({
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
      session.executeCommand(createAutoAdvancePublicCardSelectionCommand(PLAYER1, effectId, 12_000))
        .success
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
      session.getPlayerViewState(PLAYER2)?.activeEffect?.publicCardSelectionAutoAdvanceAfterMs
    ).toBe(0);
    expect(session.executeCommand(createConfirmEffectStepCommand(PLAYER2, effectId)).success).toBe(
      false
    );
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
      session.executeCommand(createAutoAdvancePublicCardSelectionCommand(PLAYER2, effectId, 12_000))
        .success
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
      session.executeCommand(createAutoAdvancePublicCardSelectionCommand(PLAYER2, effectId, 12_000))
        .success
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

describe('public revealed-inspection card selection confirmation', () => {
  it('preserves a configured step text and retains the default for absent or non-string text', () => {
    const { game, effect, cardIds } = setupRevealedInspection();
    const config = getPublicCardSelectionConfirmationConfig(effect);
    expect(config).toMatchObject({
      source: 'REVEALED_INSPECTION',
      destination: 'HAND',
      stepText: INSPECTION_CONFIRMATION_TEXT,
    });
    expect(
      createPublicCardSelectionConfirmationWindow(
        game,
        effect,
        { selectedCardId: cardIds[0] },
        config!
      )?.activeEffect?.stepText
    ).toBe(INSPECTION_CONFIRMATION_TEXT);

    for (const stepText of [undefined, 17]) {
      const defaultConfig = getPublicCardSelectionConfirmationConfig({
        ...effect,
        metadata: {
          publicCardSelectionConfirmation: { ...config, stepText },
        },
      });
      expect(defaultConfig?.stepText).toBeUndefined();
      expect(
        createPublicCardSelectionConfirmationWindow(
          game,
          effect,
          { selectedCardId: cardIds[0] },
          defaultConfig!
        )?.activeEffect?.stepText
      ).toBe('已选择的卡牌已向双方公开，即将自动加入手牌。');
    }
  });

  it.each(INVALID_INSPECTION_CASES)(
    'rejects a %s before either public-window entry point',
    (reason) => {
      const { game, effect, cardIds } = setupRevealedInspection();
      const invalid = invalidateInspectionSelection(game, effect, cardIds[0], reason);
      const config = getPublicCardSelectionConfirmationConfig(effect)!;
      const originalInput = { selectedCardId: cardIds[0] };
      expect(
        createPublicCardSelectionConfirmationWindow(
          invalid.game,
          invalid.effect,
          originalInput,
          config
        )
      ).toBeNull();
      expect(
        createPublicCardSelectionConfirmationWindowForCardIds(
          invalid.game,
          invalid.effect,
          originalInput,
          config,
          [cardIds[0]]
        )
      ).toBeNull();
      expect(invalid.game.players[0].hand.cardIds).toEqual([]);
      expect(invalid.game.players[0].waitingRoom.cardIds).toEqual([]);
    }
  );

  it('requires context and card ownership to match the configured source player', () => {
    const { game, effect, cardIds } = setupRevealedInspection();
    const config = {
      ...getPublicCardSelectionConfirmationConfig(effect)!,
      sourcePlayerId: PLAYER2,
    };
    expect(
      createPublicCardSelectionConfirmationWindow(
        game,
        effect,
        { selectedCardId: cardIds[0] },
        config
      )
    ).toBeNull();

    const foreign = invalidateInspectionSelection(game, effect, cardIds[0], 'foreign owner');
    const sourceGame = {
      ...foreign.game,
      inspectionContext: { ...game.inspectionContext!, ownerPlayerId: PLAYER2 },
    };
    expect(
      createPublicCardSelectionConfirmationWindow(
        sourceGame,
        effect,
        { selectedCardId: cardIds[0] },
        config
      )?.activeEffect?.revealedCardIds
    ).toEqual([cardIds[0]]);
  });

  it('retains an explicitly supplied inspection source for revalidation after a direct window', () => {
    const { game, effect, session, cardIds, setNow, getResolutionCount } =
      setupRevealedInspection();
    const originalEffect = { ...effect, metadata: undefined };
    const window = createPublicCardSelectionConfirmationWindowForCardIds(
      game,
      originalEffect,
      { selectedCardId: cardIds[0] },
      { source: 'REVEALED_INSPECTION', destination: 'HAND' },
      [cardIds[0]]
    )!;
    const displayed = attachPublicCardSelectionAutoAdvanceDeadline(window, 10_000);
    (session as unknown as { authorityState: GameState }).authorityState = {
      ...displayed,
      inspectionZone: {
        ...displayed.inspectionZone,
        revealedCardIds: [cardIds[1]],
      },
    };
    setNow(12_000);
    const advanced = session.executeCommand(
      createAutoAdvancePublicCardSelectionCommand(PLAYER2, effect.id, 12_000)
    );
    expect(advanced.success, advanced.error).toBe(true);
    expect(getResolutionCount()).toBe(0);
    expect(session.state?.activeEffect).toMatchObject({ stepId: INSPECTION_STEP_ID });
    expect(getPublicCardSelectionConfirmationConfig(session.state!.activeEffect!)?.source).toBe(
      'REVEALED_INSPECTION'
    );
    expect(session.state?.players[0].hand.cardIds).toEqual([]);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([]);
    expect(session.state?.inspectionZone.cardIds).toEqual(cardIds);
  });

  it('shows exactly the chosen card to both players before moving, keeps its deadline and merges undo', () => {
    const { session, cardIds, setNow, getResolutionCount } = setupRevealedInspection();
    const effectId = session.state!.activeEffect!.id;
    const selected = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, effectId, cardIds[0])
    );
    expect(selected.success, selected.error).toBe(true);
    const selectionUndo = session.getUndoAvailability(PLAYER1);
    expect(session.state?.activeEffect).toMatchObject({
      stepId: PUBLIC_CARD_SELECTION_CONFIRMATION_STEP_ID,
      revealedCardIds: [cardIds[0]],
      publicCardSelectionAutoAdvanceAt: 12_000,
      stepText: INSPECTION_CONFIRMATION_TEXT,
    });
    expect(session.state?.inspectionZone.cardIds).toEqual(cardIds);
    expect(session.state?.players[0].hand.cardIds).toEqual([]);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([]);
    expect(getResolutionCount()).toBe(0);

    setNow(11_000);
    for (const playerId of [PLAYER1, PLAYER2]) {
      const view = session.getPlayerViewState(playerId)!;
      expect(view.activeEffect).toMatchObject({
        revealedObjectIds: [createPublicObjectId(cardIds[0])],
        publicCardSelectionAutoAdvanceAt: 12_000,
        publicCardSelectionAutoAdvanceAfterMs: 1_000,
      });
      expect(view.objects[createPublicObjectId(cardIds[0])]).toMatchObject({
        surface: 'FRONT',
        publiclyRevealed: true,
      });
      expect(view.activeEffect?.confirmSelectionLabel).toBeUndefined();
      expect(
        session.executeCommand(
          createAutoAdvancePublicCardSelectionCommand(playerId, effectId, 12_000)
        ).success
      ).toBe(false);
    }
    expect(getResolutionCount()).toBe(0);
    setNow(12_000);
    const advanced = session.executeCommand(
      createAutoAdvancePublicCardSelectionCommand(PLAYER2, effectId, 12_000)
    );
    expect(advanced.success, advanced.error).toBe(true);
    expect(getResolutionCount()).toBe(1);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].hand.cardIds).toEqual([cardIds[0]]);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([cardIds[1]]);
    expect(session.state?.inspectionZone.cardIds).toEqual([]);
    expect(session.state?.inspectionContext).toBeNull();
    expect(
      session.executeCommand(createAutoAdvancePublicCardSelectionCommand(PLAYER1, effectId, 12_000))
        .success
    ).toBe(false);
    expect(getResolutionCount()).toBe(1);

    const resolvedUndo = session.getUndoAvailability(PLAYER1);
    expect(resolvedUndo.entry?.undoEntryId).toBe(selectionUndo.entry?.undoEntryId);
    const undone = session.undoLastStepForPlayer(PLAYER1, resolvedUndo.entry!.undoEntryId);
    expect(undone.success, undone.error).toBe(true);
    expect(session.state?.activeEffect).toMatchObject({ stepId: INSPECTION_STEP_ID });
    expect(session.state?.activeEffect?.publicCardSelectionAutoAdvanceAt).toBeUndefined();
    expect(session.state?.activeEffect?.revealedCardIds).toBeUndefined();
    expect(session.state?.inspectionZone.cardIds).toEqual(cardIds);
    expect(session.state?.players[0].hand.cardIds).toEqual([]);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([]);
    expect(
      session.executeCommand(createAutoAdvancePublicCardSelectionCommand(PLAYER2, effectId, 12_000))
        .success
    ).toBe(false);
  });

  it.each(INVALID_INSPECTION_CASES)(
    'restores the selection without calling its handler for a %s at deadline',
    (reason) => {
      const { session, effect, cardIds, setNow, getResolutionCount } = setupRevealedInspection();
      expect(
        session.executeCommand(createConfirmEffectStepCommand(PLAYER1, effect.id, cardIds[0]))
          .success
      ).toBe(true);
      const invalidated = invalidateInspectionSelection(session.state!, effect, cardIds[0], reason);
      const invalid =
        reason === 'missing context'
          ? {
              ...invalidated,
              game: {
                ...invalidated.game,
                inspectionZone: {
                  ...invalidated.game.inspectionZone,
                  cardIds: [],
                  revealedCardIds: [],
                },
              },
            }
          : invalidated;
      const windowEffect = session.state!.activeEffect!;
      const continuation = windowEffect.metadata!.publicCardSelectionConfirmationContinuation as {
        readonly originalEffect: ActiveEffectState;
        readonly originalInput: { readonly selectedCardId: string };
      };
      (session as unknown as { authorityState: GameState }).authorityState = {
        ...invalid.game,
        activeEffect: {
          ...windowEffect,
          metadata: {
            ...windowEffect.metadata,
            publicCardSelectionConfirmationContinuation: {
              ...continuation,
              originalEffect: invalid.effect,
            },
          },
        },
      };
      setNow(12_000);
      const advanced = session.executeCommand(
        createAutoAdvancePublicCardSelectionCommand(PLAYER2, effect.id, 12_000)
      );
      expect(advanced.success, advanced.error).toBe(true);
      expect(getResolutionCount()).toBe(0);
      expect(session.state?.activeEffect).toEqual(invalid.effect);
      expect(session.state?.activeEffect?.revealedCardIds).toBeUndefined();
      expect(session.state?.players[0].hand.cardIds).toEqual([]);
      expect(session.state?.players[0].waitingRoom.cardIds).toEqual([]);
      expect(session.state?.inspectionZone).toEqual(invalid.game.inspectionZone);
    }
  );
});
