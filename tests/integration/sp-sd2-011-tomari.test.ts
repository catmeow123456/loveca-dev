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
import { SP_SD2_011_AUTO_ON_MOVE_GAIN_BLADE_ABILITY_ID } from '../../src/application/card-effects/ability-ids';
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

function createTomari(): MemberCardData {
  return {
    cardCode: 'PL!SP-sd2-011-SD2',
    name: '鬼塚冬毬',
    groupNames: ['Liella!'],
    cardType: CardType.MEMBER,
    cost: 4,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.YELLOW, 1)],
  };
}

function createMember(cardCode: string): MemberCardData {
  return {
    cardCode,
    name: cardCode,
    groupNames: ['Liella!'],
    cardType: CardType.MEMBER,
    cost: 1,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.PINK, 1)],
  };
}

function setupState(): {
  readonly game: GameState;
  readonly source: ReturnType<typeof createCardInstance>;
  readonly other: ReturnType<typeof createCardInstance>;
} {
  const source = createCardInstance(createTomari(), PLAYER1, 'tomari-source');
  const other = createCardInstance(createMember('PL!SP-test-member'), PLAYER1, 'other-member');
  let game = createGameState('sp-sd2-011-tomari', PLAYER1, 'P1', PLAYER2, 'P2');
  game = registerCards(game, [source, other]);
  game = updatePlayer(game, PLAYER1, (player) => ({
    ...player,
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

  return { game, source, other };
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

function tomariBladeModifiers(game: GameState) {
  return game.liveResolution.liveModifiers.filter(
    (modifier) =>
      modifier.kind === 'BLADE' &&
      modifier.abilityId === SP_SD2_011_AUTO_ON_MOVE_GAIN_BLADE_ABILITY_ID
  );
}

describe('PL!SP-sd2-011 Tomari on-move BLADE workflow', () => {
  it('gains BLADE +1 for the source member after this member moves', () => {
    const { game, source } = setupState();
    const state = resolveMove({
      game,
      cardId: source.instanceId,
      toSlot: SlotPosition.CENTER,
    });

    expect(state.pendingAbilities).toEqual([]);
    expect(tomariBladeModifiers(state)).toEqual([
      {
        kind: 'BLADE',
        playerId: PLAYER1,
        sourceCardId: source.instanceId,
        abilityId: SP_SD2_011_AUTO_ON_MOVE_GAIN_BLADE_ABILITY_ID,
        countDelta: 1,
      },
    ]);
  });

  it('does not gain BLADE twice in the same turn', () => {
    const { game, source } = setupState();
    const firstState = resolveMove({
      game,
      cardId: source.instanceId,
      toSlot: SlotPosition.CENTER,
    });
    const secondState = resolveMove({
      game: firstState,
      cardId: source.instanceId,
      toSlot: SlotPosition.LEFT,
    });

    expect(tomariBladeModifiers(secondState)).toHaveLength(1);
    expect(
      secondState.actionHistory.filter(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId === SP_SD2_011_AUTO_ON_MOVE_GAIN_BLADE_ABILITY_ID &&
          action.payload.step === 'ABILITY_USE'
      )
    ).toHaveLength(1);
  });

  it('also triggers when the movement event is marked as caused by the opponent', () => {
    const { game, source } = setupState();
    const state = resolveMove({
      game,
      cardId: source.instanceId,
      toSlot: SlotPosition.CENTER,
      triggerPlayerId: PLAYER2,
    });

    expect(tomariBladeModifiers(state)).toEqual([
      expect.objectContaining({
        sourceCardId: source.instanceId,
        countDelta: 1,
      }),
    ]);
  });

  it('does not trigger when another member moves', () => {
    const { game, other } = setupState();
    const state = resolveMove({
      game,
      cardId: other.instanceId,
      toSlot: SlotPosition.CENTER,
    });

    expect(tomariBladeModifiers(state)).toEqual([]);
    expect(
      state.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId === SP_SD2_011_AUTO_ON_MOVE_GAIN_BLADE_ABILITY_ID
      )
    ).toBe(false);
  });
});
