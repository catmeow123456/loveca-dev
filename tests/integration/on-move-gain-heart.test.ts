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
import {
  SP_SD2_002_AUTO_ON_MOVE_GAIN_PURPLE_HEART_ABILITY_ID,
  SP_SD2_012_AUTO_ON_MOVE_GAIN_RED_HEART_ABILITY_ID,
  SP_SD2_013_AUTO_ON_MOVE_GAIN_PURPLE_HEART_ABILITY_ID,
  SP_SD2_022_AUTO_ON_MOVE_GAIN_YELLOW_HEART_ABILITY_ID,
} from '../../src/application/card-effects/ability-ids';
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

interface OnMoveHeartCase {
  readonly cardCode: string;
  readonly name: string;
  readonly abilityId: string;
  readonly heartColor: HeartColor;
}

const ON_MOVE_HEART_CASES: readonly OnMoveHeartCase[] = [
  {
    cardCode: 'PL!SP-sd2-002-SD2',
    name: '唐 可可',
    abilityId: SP_SD2_002_AUTO_ON_MOVE_GAIN_PURPLE_HEART_ABILITY_ID,
    heartColor: HeartColor.PURPLE,
  },
  {
    cardCode: 'PL!SP-sd2-012-SD2',
    name: '澁谷かのん',
    abilityId: SP_SD2_012_AUTO_ON_MOVE_GAIN_RED_HEART_ABILITY_ID,
    heartColor: HeartColor.RED,
  },
  {
    cardCode: 'PL!SP-sd2-013-SD2',
    name: '唐 可可',
    abilityId: SP_SD2_013_AUTO_ON_MOVE_GAIN_PURPLE_HEART_ABILITY_ID,
    heartColor: HeartColor.PURPLE,
  },
  {
    cardCode: 'PL!SP-sd2-022-SD2',
    name: '鬼塚冬毬',
    abilityId: SP_SD2_022_AUTO_ON_MOVE_GAIN_YELLOW_HEART_ABILITY_ID,
    heartColor: HeartColor.YELLOW,
  },
];

function createOnMoveHeartMember(testCase: OnMoveHeartCase): MemberCardData {
  return {
    cardCode: testCase.cardCode,
    name: testCase.name,
    groupNames: ['Liella!'],
    cardType: CardType.MEMBER,
    cost: 2,
    blade: 1,
    hearts: [createHeartIcon(testCase.heartColor, 1)],
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

function setupState(testCase: OnMoveHeartCase = ON_MOVE_HEART_CASES[1]): {
  readonly game: GameState;
  readonly source: ReturnType<typeof createCardInstance>;
  readonly other: ReturnType<typeof createCardInstance>;
  readonly testCase: OnMoveHeartCase;
} {
  const source = createCardInstance(createOnMoveHeartMember(testCase), PLAYER1, 'heart-source');
  const other = createCardInstance(createMember('PL!SP-test-member'), PLAYER1, 'other-member');
  let game = createGameState('on-move-gain-heart', PLAYER1, 'P1', PLAYER2, 'P2');
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

  return { game, source, other, testCase };
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

function heartModifiers(game: GameState, abilityId = SP_SD2_012_AUTO_ON_MOVE_GAIN_RED_HEART_ABILITY_ID) {
  return game.liveResolution.liveModifiers.filter(
    (modifier) =>
      modifier.kind === 'HEART' &&
      modifier.abilityId === abilityId
  );
}

describe('on-move Heart shared workflow', () => {
  it.each(ON_MOVE_HEART_CASES)(
    'gains configured Heart for $cardCode after this member moves',
    (testCase) => {
      const { game, source } = setupState(testCase);
      const state = resolveMove({
        game,
        cardId: source.instanceId,
        toSlot: SlotPosition.CENTER,
      });

      expect(state.pendingAbilities).toEqual([]);
      expect(heartModifiers(state, testCase.abilityId)).toEqual([
        {
          kind: 'HEART',
          target: 'SOURCE_MEMBER',
          playerId: PLAYER1,
          sourceCardId: source.instanceId,
          abilityId: testCase.abilityId,
          hearts: [{ color: testCase.heartColor, count: 1 }],
        },
      ]);
      expect(state.liveResolution.playerHeartBonuses.has(PLAYER1)).toBe(false);
    }
  );

  it('preserves PL!SP-sd2-012 red Heart behavior', () => {
    const { game, source, testCase } = setupState();
    const state = resolveMove({
      game,
      cardId: source.instanceId,
      toSlot: SlotPosition.CENTER,
    });

    expect(heartModifiers(state, testCase.abilityId)).toEqual([
      {
        kind: 'HEART',
        target: 'SOURCE_MEMBER',
        playerId: PLAYER1,
        sourceCardId: source.instanceId,
        abilityId: testCase.abilityId,
        hearts: [{ color: HeartColor.RED, count: 1 }],
      },
    ]);
  });

  it('does not gain red Heart twice in the same turn', () => {
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

    expect(heartModifiers(secondState)).toHaveLength(1);
    expect(
      secondState.actionHistory.filter(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId === SP_SD2_012_AUTO_ON_MOVE_GAIN_RED_HEART_ABILITY_ID &&
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

    expect(heartModifiers(state)).toHaveLength(1);
    expect(heartModifiers(state)[0]).toMatchObject({
      target: 'SOURCE_MEMBER',
      playerId: PLAYER1,
      sourceCardId: source.instanceId,
      hearts: [{ color: HeartColor.RED, count: 1 }],
    });
  });

  it('does not trigger when another member moves', () => {
    const { game, other } = setupState();
    const state = resolveMove({
      game,
      cardId: other.instanceId,
      toSlot: SlotPosition.CENTER,
    });

    expect(heartModifiers(state)).toEqual([]);
    expect(
      state.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId === SP_SD2_012_AUTO_ON_MOVE_GAIN_RED_HEART_ABILITY_ID
      )
    ).toBe(false);
  });

  it('writes only member/source Heart modifiers and never playerHeartBonuses', () => {
    const { game, source } = setupState();
    const state = resolveMove({
      game,
      cardId: source.instanceId,
      toSlot: SlotPosition.CENTER,
    });

    expect(state.liveResolution.playerHeartBonuses.has(PLAYER1)).toBe(false);
    expect(heartModifiers(state)).toEqual([
      expect.objectContaining({
        kind: 'HEART',
        target: 'SOURCE_MEMBER',
        sourceCardId: source.instanceId,
      }),
    ]);
    expect(
      state.liveResolution.liveModifiers.some(
        (modifier) =>
          modifier.kind === 'HEART' &&
          modifier.abilityId === SP_SD2_012_AUTO_ON_MOVE_GAIN_RED_HEART_ABILITY_ID &&
          modifier.target === 'PLAYER'
      )
    ).toBe(false);
  });
});
