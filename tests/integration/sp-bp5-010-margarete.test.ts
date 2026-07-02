import { describe, expect, it } from 'vitest';
import type { MemberCardData } from '../../src/domain/entities/card';
import { createCardInstance, createHeartIcon } from '../../src/domain/entities/card';
import {
  createGameState,
  registerCards,
  updatePlayer,
  type GameState,
  type PendingAbilityState,
} from '../../src/domain/entities/game';
import { placeCardInSlot } from '../../src/domain/entities/zone';
import {
  confirmActiveEffectStep,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import { SP_BP5_010_ON_ENTER_BOTH_CENTER_POSITION_CHANGE_ABILITY_ID } from '../../src/application/card-effects/ability-ids';
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

function member(cardCode: string, name = cardCode): MemberCardData {
  return {
    cardCode,
    name,
    groupNames: ['Liella!'],
    cardType: CardType.MEMBER,
    cost: 4,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.YELLOW, 1)],
  };
}

function pending(sourceCardId: string): PendingAbilityState {
  return {
    id: 'sp-bp5-010-pending',
    abilityId: SP_BP5_010_ON_ENTER_BOTH_CENTER_POSITION_CHANGE_ABILITY_ID,
    sourceCardId,
    controllerId: PLAYER1,
    mandatory: true,
    timingId: TriggerCondition.ON_ENTER_STAGE,
    eventIds: ['on-enter'],
    sourceSlot: SlotPosition.CENTER,
  };
}

function setup(options: {
  readonly p1Center?: boolean;
  readonly p1Left?: boolean;
  readonly p2Center?: boolean;
  readonly p2Right?: boolean;
} = {}) {
  const p1Center = createCardInstance(member('PL!SP-bp5-010-R', 'ウィーン・マルガレーテ'), PLAYER1, 'p1-center');
  const p1Left = createCardInstance(member('P1-LEFT'), PLAYER1, 'p1-left');
  const p2Center = createCardInstance(member('P2-CENTER'), PLAYER2, 'p2-center');
  const p2Right = createCardInstance(member('P2-RIGHT'), PLAYER2, 'p2-right');
  let game = createGameState('sp-bp5-010-margarete', PLAYER1, 'P1', PLAYER2, 'P2');
  game = registerCards(game, [p1Center, p1Left, p2Center, p2Right]);

  game = updatePlayer(game, PLAYER1, (player) => {
    let memberSlots = player.memberSlots;
    if (options.p1Center !== false) {
      memberSlots = placeCardInSlot(memberSlots, SlotPosition.CENTER, p1Center.instanceId);
    }
    if (options.p1Left === true) {
      memberSlots = placeCardInSlot(memberSlots, SlotPosition.LEFT, p1Left.instanceId);
    }
    return {
      ...player,
      memberSlots: {
        ...memberSlots,
        cardStates: new Map(
          [p1Center, p1Left].map((card) => [
            card.instanceId,
            { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP },
          ])
        ),
      },
    };
  });
  game = updatePlayer(game, PLAYER2, (player) => {
    let memberSlots = player.memberSlots;
    if (options.p2Center !== false) {
      memberSlots = placeCardInSlot(memberSlots, SlotPosition.CENTER, p2Center.instanceId);
    }
    if (options.p2Right === true) {
      memberSlots = placeCardInSlot(memberSlots, SlotPosition.RIGHT, p2Right.instanceId);
    }
    return {
      ...player,
      memberSlots: {
        ...memberSlots,
        cardStates: new Map(
          [p2Center, p2Right].map((card) => [
            card.instanceId,
            { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP },
          ])
        ),
      },
    };
  });

  return {
    game,
    sourceId: p1Center.instanceId,
    p1CenterId: p1Center.instanceId,
    p1LeftId: p1Left.instanceId,
    p2CenterId: p2Center.instanceId,
    p2RightId: p2Right.instanceId,
  };
}

function start(game: GameState, sourceId: string): GameState {
  return resolvePendingCardEffects({ ...game, pendingAbilities: [pending(sourceId)] }).gameState;
}

function selectSlot(game: GameState, playerId: string, slot: SlotPosition): GameState {
  return confirmActiveEffectStep(
    game,
    playerId,
    game.activeEffect!.id,
    undefined,
    slot
  );
}

describe('PL!SP-bp5-010 Margarete both-center position change', () => {
  it('lets each player move their own CENTER member and swaps occupied target slots', () => {
    const scenario = setup({ p1Left: true, p2Right: true });
    let state = start(scenario.game, scenario.sourceId);

    expect(state.activeEffect).toMatchObject({
      abilityId: SP_BP5_010_ON_ENTER_BOTH_CENTER_POSITION_CHANGE_ABILITY_ID,
      awaitingPlayerId: PLAYER1,
      selectableSlots: [SlotPosition.LEFT, SlotPosition.RIGHT],
    });

    state = selectSlot(state, PLAYER1, SlotPosition.LEFT);
    expect(state.activeEffect?.awaitingPlayerId).toBe(PLAYER2);
    expect(state.players[0].memberSlots.slots[SlotPosition.LEFT]).toBe(scenario.p1CenterId);
    expect(state.players[0].memberSlots.slots[SlotPosition.CENTER]).toBe(scenario.p1LeftId);

    state = selectSlot(state, PLAYER2, SlotPosition.RIGHT);
    expect(state.activeEffect).toBeNull();
    expect(state.players[1].memberSlots.slots[SlotPosition.RIGHT]).toBe(scenario.p2CenterId);
    expect(state.players[1].memberSlots.slots[SlotPosition.CENTER]).toBe(scenario.p2RightId);
    expect(state.players[0].positionMovedThisTurn).toEqual([
      scenario.p1CenterId,
      scenario.p1LeftId,
    ]);
    expect(state.players[1].positionMovedThisTurn).toEqual([
      scenario.p2CenterId,
      scenario.p2RightId,
    ]);
    expect(
      state.eventLog.filter(
        (entry) => entry.event.eventType === TriggerCondition.ON_MEMBER_SLOT_MOVED
      )
    ).toHaveLength(4);
  });

  it('moves to an empty side slot and no-ops for a player with no CENTER member', () => {
    const scenario = setup({ p1Left: false, p2Center: false });
    let state = start(scenario.game, scenario.sourceId);

    expect(state.activeEffect?.awaitingPlayerId).toBe(PLAYER1);
    state = selectSlot(state, PLAYER1, SlotPosition.RIGHT);

    expect(state.activeEffect).toBeNull();
    expect(state.players[0].memberSlots.slots[SlotPosition.RIGHT]).toBe(scenario.p1CenterId);
    expect(state.players[0].memberSlots.slots[SlotPosition.CENTER]).toBeNull();
    expect(state.players[1].positionMovedThisTurn).toEqual([]);
    expect(
      state.eventLog.filter(
        (entry) => entry.event.eventType === TriggerCondition.ON_MEMBER_SLOT_MOVED
      )
    ).toHaveLength(1);
  });

  it('consumes pending without opening a prompt when neither player has a CENTER member', () => {
    const scenario = setup({ p1Center: false, p2Center: false });
    const state = start(scenario.game, scenario.sourceId);

    expect(state.activeEffect).toBeNull();
    expect(state.pendingAbilities).toEqual([]);
    expect(state.actionHistory.at(-1)?.payload.step).toBe('NO_CENTER_MEMBERS_POSITION_CHANGE');
  });
});
