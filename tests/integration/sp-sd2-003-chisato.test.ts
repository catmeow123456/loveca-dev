import { describe, expect, it } from 'vitest';
import type { MemberCardData } from '../../src/domain/entities/card';
import { createCardInstance, createHeartIcon } from '../../src/domain/entities/card';
import {
  createGameState,
  registerCards,
  updatePlayer,
  type GameState,
} from '../../src/domain/entities/game';
import { placeCardInSlot } from '../../src/domain/entities/zone';
import {
  ABILITY_ORDER_SELECTION_ID,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import { SP_SD2_003_LIVE_SUCCESS_DRAW_ONE_PLUS_ONE_IF_MOVED_ABILITY_ID } from '../../src/application/card-effects/ability-ids';
import { createConfirmEffectStepCommand } from '../../src/application/game-commands';
import { createGameSession } from '../../src/application/game-session';
import {
  CardType,
  FaceState,
  HeartColor,
  OrientationState,
  SlotPosition,
  TriggerCondition,
} from '../../src/shared/types/enums';

const PLAYER1 = 'player1';
const PLAYER2 = 'player2';

function createMember(cardCode: string, cost = 11): MemberCardData {
  return {
    cardCode,
    name: cardCode,
    groupName: 'Liella!',
    cardType: CardType.MEMBER,
    cost,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.PINK, 1)],
  };
}

function setupState(options: {
  readonly mainDeckCount: number;
  readonly sourceMoved?: boolean;
  readonly otherMoved?: boolean;
}): {
  readonly game: GameState;
  readonly sourceId: string;
  readonly otherId: string;
  readonly drawCardIds: readonly string[];
} {
  const source = createCardInstance(
    createMember('PL!SP-sd2-003-SD2', 11),
    PLAYER1,
    'chisato-source'
  );
  const other = createCardInstance(createMember('PL!SP-test-other', 2), PLAYER1, 'other-member');
  const drawCards = Array.from({ length: options.mainDeckCount }, (_, index) =>
    createCardInstance(createMember(`PL!SP-test-draw-${index}`), PLAYER1, `draw-${index}`)
  );
  let game = createGameState('sp-sd2-003-chisato', PLAYER1, 'P1', PLAYER2, 'P2');
  game = registerCards(game, [source, other, ...drawCards]);
  game = updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    mainDeck: { ...player.mainDeck, cardIds: drawCards.map((card) => card.instanceId) },
    hand: { ...player.hand, cardIds: [] },
    positionMovedThisTurn: [
      ...(options.sourceMoved ? [source.instanceId] : []),
      ...(options.otherMoved ? [other.instanceId] : []),
    ],
    memberSlots: placeCardInSlot(
      placeCardInSlot(player.memberSlots, SlotPosition.CENTER, source.instanceId, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      }),
      SlotPosition.LEFT,
      other.instanceId,
      {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      }
    ),
  }));

  return {
    game,
    sourceId: source.instanceId,
    otherId: other.instanceId,
    drawCardIds: drawCards.map((card) => card.instanceId),
  };
}

function resolveChisato(game: GameState, sourceId: string): GameState {
  return resolvePendingCardEffects({
    ...game,
    pendingAbilities: [
      {
        id: 'sp-sd2-003-live-success',
        abilityId: SP_SD2_003_LIVE_SUCCESS_DRAW_ONE_PLUS_ONE_IF_MOVED_ABILITY_ID,
        sourceCardId: sourceId,
        controllerId: PLAYER1,
        mandatory: true,
        timingId: TriggerCondition.ON_LIVE_SUCCESS,
        eventIds: ['live-success'],
        sourceSlot: SlotPosition.CENTER,
      },
    ],
  }).gameState;
}

function resolveChisatoQueue(game: GameState, sourceId: string, otherId: string): GameState {
  return resolvePendingCardEffects({
    ...game,
    pendingAbilities: [
      {
        id: 'sp-sd2-003-live-success-source',
        abilityId: SP_SD2_003_LIVE_SUCCESS_DRAW_ONE_PLUS_ONE_IF_MOVED_ABILITY_ID,
        sourceCardId: sourceId,
        controllerId: PLAYER1,
        mandatory: true,
        timingId: TriggerCondition.ON_LIVE_SUCCESS,
        eventIds: ['live-success'],
        sourceSlot: SlotPosition.CENTER,
      },
      {
        id: 'sp-sd2-003-live-success-other',
        abilityId: SP_SD2_003_LIVE_SUCCESS_DRAW_ONE_PLUS_ONE_IF_MOVED_ABILITY_ID,
        sourceCardId: otherId,
        controllerId: PLAYER1,
        mandatory: true,
        timingId: TriggerCondition.ON_LIVE_SUCCESS,
        eventIds: ['live-success'],
        sourceSlot: SlotPosition.LEFT,
      },
    ],
  }).gameState;
}

function confirmActiveEffect(state: GameState, selectedCardId?: string): GameState {
  const session = createGameSession();
  session.createGame('sp-sd2-003-chisato-session', PLAYER1, 'P1', PLAYER2, 'P2');
  (session as unknown as { authorityState: GameState }).authorityState = state;
  const result = session.executeCommand(
    createConfirmEffectStepCommand(PLAYER1, state.activeEffect!.id, selectedCardId)
  );
  expect(result.success).toBe(true);
  return session.state!;
}

function latestPayload(game: GameState) {
  return game.actionHistory
    .filter(
      (action) =>
        action.type === 'RESOLVE_ABILITY' &&
        action.payload.abilityId ===
          SP_SD2_003_LIVE_SUCCESS_DRAW_ONE_PLUS_ONE_IF_MOVED_ABILITY_ID
    )
    .at(-1)?.payload;
}

describe('PL!SP-sd2-003 Chisato live-success draw workflow', () => {
  it('always draws one on LIVE success', () => {
    const scenario = setupState({ mainDeckCount: 2 });
    const state = resolveChisato(scenario.game, scenario.sourceId);

    expect(state.players[0].hand.cardIds).toEqual([scenario.drawCardIds[0]]);
    expect(latestPayload(state)).toMatchObject({
      movedThisTurn: false,
      firstDrawnCardIds: [scenario.drawCardIds[0]],
      bonusDrawnCardIds: [],
      totalDrawCount: 1,
    });
  });

  it('draws two total when this source member moved this turn', () => {
    const scenario = setupState({ mainDeckCount: 2, sourceMoved: true });
    const state = resolveChisato(scenario.game, scenario.sourceId);

    expect(state.players[0].hand.cardIds).toEqual(scenario.drawCardIds.slice(0, 2));
    expect(latestPayload(state)).toMatchObject({
      movedThisTurn: true,
      firstDrawnCardIds: [scenario.drawCardIds[0]],
      bonusDrawnCardIds: [scenario.drawCardIds[1]],
      totalDrawCount: 2,
    });
  });

  it('does not give the bonus draw when only another member moved', () => {
    const scenario = setupState({ mainDeckCount: 2, otherMoved: true });
    const state = resolveChisato(scenario.game, scenario.sourceId);

    expect(state.players[0].hand.cardIds).toEqual([scenario.drawCardIds[0]]);
    expect(latestPayload(state)).toMatchObject({
      movedThisTurn: false,
      bonusDrawnCardIds: [],
      totalDrawCount: 1,
    });
  });

  it('shows confirm-only feedback before resolving when manually chosen from a live-success queue', () => {
    const scenario = setupState({ mainDeckCount: 3 });
    const queuedState = resolveChisatoQueue(
      scenario.game,
      scenario.sourceId,
      scenario.otherId
    );

    expect(queuedState.activeEffect?.abilityId).toBe(ABILITY_ORDER_SELECTION_ID);
    expect(queuedState.activeEffect?.selectableCardIds).toEqual([
      scenario.sourceId,
      scenario.otherId,
    ]);

    const confirmOnlyState = confirmActiveEffect(queuedState, scenario.sourceId);

    expect(confirmOnlyState.activeEffect).toMatchObject({
      abilityId: SP_SD2_003_LIVE_SUCCESS_DRAW_ONE_PLUS_ONE_IF_MOVED_ABILITY_ID,
      sourceCardId: scenario.sourceId,
      stepId: 'CONFIRM_ONLY_EFFECT',
    });
    expect(confirmOnlyState.activeEffect?.metadata?.confirmOnlyPendingAbility).toBe(true);
    expect(confirmOnlyState.players[0].hand.cardIds).toEqual([]);
    expect(confirmOnlyState.pendingAbilities).toHaveLength(2);

    const resolvedState = confirmActiveEffect(confirmOnlyState);

    expect(
      resolvedState.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId ===
            SP_SD2_003_LIVE_SUCCESS_DRAW_ONE_PLUS_ONE_IF_MOVED_ABILITY_ID &&
          action.payload.sourceCardId === scenario.sourceId &&
          Array.isArray(action.payload.firstDrawnCardIds) &&
          action.payload.firstDrawnCardIds.includes(scenario.drawCardIds[0])
      )
    ).toBe(true);
  });

  it.each([
    [0, []],
    [1, ['draw-0']],
  ] as const)('keeps existing draw semantics with %i card(s) in deck', (count, expectedIds) => {
    const scenario = setupState({ mainDeckCount: count, sourceMoved: true });
    const expectedCardIds = expectedIds.map((id) => scenario.drawCardIds[Number(id.at(-1))]);
    const state = resolveChisato(scenario.game, scenario.sourceId);

    expect(state.players[0].hand.cardIds).toEqual(expectedCardIds);
    expect(latestPayload(state)).toMatchObject({
      movedThisTurn: true,
      totalDrawCount: expectedCardIds.length,
    });
  });
});
