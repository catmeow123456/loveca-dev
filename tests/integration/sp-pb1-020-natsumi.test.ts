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
import { moveMemberBetweenSlots } from '../../src/application/effects/member-state';
import { GameService } from '../../src/application/game-service';
import { SP_PB1_020_AUTO_ON_MOVE_DRAW_ONE_ABILITY_ID } from '../../src/application/card-effects/ability-ids';
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

function createMember(cardCode: string, cost = 4): MemberCardData {
  return {
    cardCode,
    name: cardCode,
    groupName: 'Liella!',
    cardType: CardType.MEMBER,
    cost,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.YELLOW, 1)],
  };
}

function setupState(): {
  readonly game: GameState;
  readonly sourceId: string;
  readonly otherId: string;
  readonly drawCardIds: readonly string[];
} {
  const source = createCardInstance(
    createMember('PL!SP-pb1-020-N', 4),
    PLAYER1,
    'natsumi-source'
  );
  const other = createCardInstance(createMember('PL!SP-test-other'), PLAYER1, 'other-member');
  const drawCards = [0, 1, 2].map((index) =>
    createCardInstance(createMember(`PL!SP-test-draw-${index}`), PLAYER1, `draw-${index}`)
  );
  let game = createGameState('sp-pb1-020-natsumi', PLAYER1, 'P1', PLAYER2, 'P2');
  game = registerCards(game, [source, other, ...drawCards]);
  game = updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    mainDeck: { ...player.mainDeck, cardIds: drawCards.map((card) => card.instanceId) },
    hand: { ...player.hand, cardIds: [] },
    memberSlots: placeCardInSlot(
      placeCardInSlot(player.memberSlots, SlotPosition.LEFT, source.instanceId, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      }),
      SlotPosition.RIGHT,
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

function resolveMove(options: {
  readonly game: GameState;
  readonly cardId: string;
  readonly toSlot: SlotPosition;
  readonly triggerPlayerId?: string;
}): GameState {
  const moveResult = moveMemberBetweenSlots(
    options.game,
    PLAYER1,
    options.cardId,
    options.toSlot
  );
  expect(moveResult).not.toBeNull();
  let movedState = moveResult!.gameState;
  if (options.triggerPlayerId) {
    movedState = {
      ...movedState,
      eventLog: movedState.eventLog.map((entry) =>
        entry.event.eventType === TriggerCondition.ON_MEMBER_SLOT_MOVED &&
        entry.event.cardInstanceId === options.cardId
          ? {
              ...entry,
              event: {
                ...entry.event,
                triggerPlayerId: options.triggerPlayerId,
              },
            }
          : entry
      ),
    };
  }

  const result = new GameService().executeCheckTiming(movedState, [
    TriggerCondition.ON_MEMBER_SLOT_MOVED,
  ]);
  expect(result.success).toBe(true);
  return result.gameState;
}

function drawResolveCount(game: GameState): number {
  return game.actionHistory.filter(
    (action) =>
      action.type === 'RESOLVE_ABILITY' &&
      action.payload.abilityId === SP_PB1_020_AUTO_ON_MOVE_DRAW_ONE_ABILITY_ID &&
      action.payload.step === 'ON_MOVE_DRAW_ONE'
  ).length;
}

describe('PL!SP-pb1-020 Natsumi on-move draw workflow', () => {
  it('draws one when this member moves', () => {
    const scenario = setupState();
    const state = resolveMove({
      game: scenario.game,
      cardId: scenario.sourceId,
      toSlot: SlotPosition.CENTER,
    });

    expect(state.players[0].hand.cardIds).toEqual([scenario.drawCardIds[0]]);
    expect(drawResolveCount(state)).toBe(1);
  });

  it('draws once for each move in the same turn', () => {
    const scenario = setupState();
    const first = resolveMove({
      game: scenario.game,
      cardId: scenario.sourceId,
      toSlot: SlotPosition.CENTER,
    });
    const second = resolveMove({
      game: first,
      cardId: scenario.sourceId,
      toSlot: SlotPosition.LEFT,
    });

    expect(second.players[0].hand.cardIds).toEqual(scenario.drawCardIds.slice(0, 2));
    expect(drawResolveCount(second)).toBe(2);
  });

  it('also triggers when the movement event is marked as caused by the opponent', () => {
    const scenario = setupState();
    const state = resolveMove({
      game: scenario.game,
      cardId: scenario.sourceId,
      toSlot: SlotPosition.CENTER,
      triggerPlayerId: PLAYER2,
    });

    expect(state.players[0].hand.cardIds).toEqual([scenario.drawCardIds[0]]);
    expect(drawResolveCount(state)).toBe(1);
  });

  it('does not trigger when another member moves', () => {
    const scenario = setupState();
    const state = resolveMove({
      game: scenario.game,
      cardId: scenario.otherId,
      toSlot: SlotPosition.CENTER,
    });

    expect(state.players[0].hand.cardIds).toEqual([]);
    expect(drawResolveCount(state)).toBe(0);
  });
});
