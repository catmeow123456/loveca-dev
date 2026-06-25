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
import { resolvePendingCardEffects } from '../../src/application/card-effect-runner';
import { SP_SD2_003_LIVE_SUCCESS_DRAW_ONE_PLUS_ONE_IF_MOVED_ABILITY_ID } from '../../src/application/card-effects/ability-ids';
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
