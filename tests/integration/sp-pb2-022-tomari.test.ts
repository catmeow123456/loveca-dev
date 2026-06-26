import { describe, expect, it } from 'vitest';
import type { MemberCardData } from '../../src/domain/entities/card';
import { createCardInstance, createHeartIcon } from '../../src/domain/entities/card';
import {
  createGameState,
  emitGameEvent,
  registerCards,
  updatePlayer,
  type GameState,
} from '../../src/domain/entities/game';
import { createMemberSlotMovedEvent } from '../../src/domain/events/game-events';
import { placeCardInSlot } from '../../src/domain/entities/zone';
import {
  enqueueTriggeredCardEffects,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import { SP_PB2_022_AUTO_5YNCRISE_MEMBER_MOVED_CENTER_GAIN_FOUR_BLADE_ABILITY_ID } from '../../src/application/card-effects/ability-ids';
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

function createMember(cardCode: string, unitName = '5yncri5e!'): MemberCardData {
  return {
    cardCode,
    name: cardCode,
    groupName: 'Liella!',
    unitName,
    cardType: CardType.MEMBER,
    cost: 15,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.PURPLE, 1)],
  };
}

function setupState(): {
  readonly game: GameState;
  readonly sourceId: string;
  readonly movedId: string;
  readonly nonFiveyncriseId: string;
  readonly opponentMovedId: string;
} {
  const source = createCardInstance(
    createMember('PL!SP-pb2-022-R'),
    PLAYER1,
    'sp-pb2-022-source'
  );
  const moved = createCardInstance(
    createMember('PL!SP-test-fiveyncrise'),
    PLAYER1,
    'sp-pb2-022-moved'
  );
  const nonFiveyncrise = createCardInstance(
    createMember('PL!SP-test-catchu', 'CatChu!'),
    PLAYER1,
    'sp-pb2-022-non-fiveyncrise'
  );
  const opponentMoved = createCardInstance(
    createMember('PL!SP-test-opponent-fiveyncrise'),
    PLAYER2,
    'sp-pb2-022-opponent'
  );

  let game = createGameState('sp-pb2-022-tomari', PLAYER1, 'P1', PLAYER2, 'P2');
  game = registerCards(game, [source, moved, nonFiveyncrise, opponentMoved]);
  game = updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    memberSlots: placeCardInSlot(
      placeCardInSlot(player.memberSlots, SlotPosition.LEFT, moved.instanceId, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      }),
      SlotPosition.RIGHT,
      source.instanceId,
      {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      }
    ),
  }));
  game = updatePlayer(game, PLAYER2, (player) => ({
    ...player,
    memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.LEFT, opponentMoved.instanceId, {
      orientation: OrientationState.ACTIVE,
      face: FaceState.FACE_UP,
    }),
  }));

  return {
    game,
    sourceId: source.instanceId,
    movedId: moved.instanceId,
    nonFiveyncriseId: nonFiveyncrise.instanceId,
    opponentMovedId: opponentMoved.instanceId,
  };
}

function moveOwnMember(
  game: GameState,
  cardId: string,
  fromSlot: SlotPosition,
  toSlot: SlotPosition
): GameState {
  const withSlot = updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    memberSlots: placeCardInSlot(player.memberSlots, toSlot, cardId, {
      orientation: OrientationState.ACTIVE,
      face: FaceState.FACE_UP,
    }),
  }));
  const event = createMemberSlotMovedEvent(cardId, PLAYER1, fromSlot, toSlot);
  return enqueueTriggeredCardEffects(emitGameEvent(withSlot, event), [
    TriggerCondition.ON_MEMBER_SLOT_MOVED,
  ]);
}

function moveOpponentMemberToCenter(game: GameState, cardId: string): GameState {
  const withSlot = updatePlayer(game, PLAYER2, (player) => ({
    ...player,
    memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, cardId, {
      orientation: OrientationState.ACTIVE,
      face: FaceState.FACE_UP,
    }),
  }));
  const event = createMemberSlotMovedEvent(
    cardId,
    PLAYER2,
    SlotPosition.LEFT,
    SlotPosition.CENTER
  );
  return enqueueTriggeredCardEffects(emitGameEvent(withSlot, event), [
    TriggerCondition.ON_MEMBER_SLOT_MOVED,
  ]);
}

function latestPayload(game: GameState) {
  return game.actionHistory
    .filter(
      (action) =>
        action.type === 'RESOLVE_ABILITY' &&
        action.payload.abilityId ===
          SP_PB2_022_AUTO_5YNCRISE_MEMBER_MOVED_CENTER_GAIN_FOUR_BLADE_ABILITY_ID
    )
    .at(-1)?.payload;
}

function abilityUseCount(game: GameState): number {
  return game.actionHistory.filter(
    (action) =>
      action.type === 'RESOLVE_ABILITY' &&
      action.payload.abilityId ===
        SP_PB2_022_AUTO_5YNCRISE_MEMBER_MOVED_CENTER_GAIN_FOUR_BLADE_ABILITY_ID &&
      action.payload.step === 'ABILITY_USE'
  ).length;
}

describe('PL!SP-pb2-022 Tomari on-move blade workflow', () => {
  it('grants source BLADE +4 when an own 5yncri5e! stage member moves to CENTER', () => {
    const scenario = setupState();
    const queued = moveOwnMember(
      scenario.game,
      scenario.movedId,
      SlotPosition.LEFT,
      SlotPosition.CENTER
    );

    expect(queued.pendingAbilities).toHaveLength(1);
    const state = resolvePendingCardEffects(queued).gameState;

    expect(state.liveResolution.liveModifiers).toContainEqual({
      kind: 'BLADE',
      playerId: PLAYER1,
      countDelta: 4,
      sourceCardId: scenario.sourceId,
      abilityId: SP_PB2_022_AUTO_5YNCRISE_MEMBER_MOVED_CENTER_GAIN_FOUR_BLADE_ABILITY_ID,
    });
    expect(latestPayload(state)).toMatchObject({
      conditionMet: true,
      movedCardId: scenario.movedId,
      toSlot: SlotPosition.CENTER,
      bladeBonus: 4,
    });
    expect(abilityUseCount(state)).toBe(1);
  });

  it('consumes pending no-op when the moved member is not 5yncri5e!', () => {
    const scenario = setupState();
    const game = updatePlayer(scenario.game, PLAYER1, (player) => ({
      ...player,
      memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.LEFT, scenario.nonFiveyncriseId, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      }),
    }));
    const state = resolvePendingCardEffects(
      moveOwnMember(game, scenario.nonFiveyncriseId, SlotPosition.LEFT, SlotPosition.CENTER)
    ).gameState;

    expect(state.liveResolution.liveModifiers).toEqual([]);
    expect(latestPayload(state)).toMatchObject({
      conditionMet: false,
      movedMemberIsOwnFiveyncrise: false,
      movedToCenter: true,
    });
    expect(abilityUseCount(state)).toBe(0);
  });

  it('consumes pending no-op when the member does not move to CENTER', () => {
    const scenario = setupState();
    const game = updatePlayer(scenario.game, PLAYER1, (player) => ({
      ...player,
      memberSlots: {
        ...player.memberSlots,
        slots: {
          ...player.memberSlots.slots,
          [SlotPosition.LEFT]: scenario.movedId,
          [SlotPosition.CENTER]: scenario.sourceId,
          [SlotPosition.RIGHT]: null,
        },
      },
    }));
    const state = resolvePendingCardEffects(
      moveOwnMember(game, scenario.movedId, SlotPosition.LEFT, SlotPosition.RIGHT)
    ).gameState;

    expect(state.liveResolution.liveModifiers).toEqual([]);
    expect(latestPayload(state)).toMatchObject({
      conditionMet: false,
      movedMemberIsOwnFiveyncrise: true,
      movedToCenter: false,
    });
  });

  it('does not enqueue for opponent member movement', () => {
    const scenario = setupState();
    const queued = moveOpponentMemberToCenter(scenario.game, scenario.opponentMovedId);

    expect(queued.pendingAbilities).toEqual([]);
  });

  it('respects per-turn limit one after a successful resolution', () => {
    const scenario = setupState();
    const resolved = resolvePendingCardEffects(
      moveOwnMember(scenario.game, scenario.movedId, SlotPosition.LEFT, SlotPosition.CENTER)
    ).gameState;
    const queuedAgain = moveOwnMember(resolved, scenario.movedId, SlotPosition.LEFT, SlotPosition.CENTER);

    expect(queuedAgain.pendingAbilities).toEqual([]);
    expect(abilityUseCount(queuedAgain)).toBe(1);
  });
});
