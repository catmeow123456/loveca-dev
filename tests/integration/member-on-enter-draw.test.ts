import { describe, expect, it } from 'vitest';
import type { MemberCardData } from '../../src/domain/entities/card';
import { createCardInstance, createHeartIcon } from '../../src/domain/entities/card';
import {
  createGameState,
  emitGameEvent,
  registerCards,
  updatePlayer,
  type GameState,
  type PendingAbilityState,
} from '../../src/domain/entities/game';
import { placeCardInSlot } from '../../src/domain/entities/zone';
import { createEnterStageEvent } from '../../src/domain/events/game-events';
import {
  confirmActiveEffectStep,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import { GameService } from '../../src/application/game-service';
import { MEMBER_ON_ENTER_DRAW_ONE_ABILITY_ID } from '../../src/application/card-effects/ability-ids';
import {
  CardType,
  FaceState,
  HeartColor,
  OrientationState,
  SlotPosition,
  TriggerCondition,
  ZoneType,
} from '../../src/shared/types/enums';

const PLAYER1 = 'player1';
const PLAYER2 = 'player2';

function createMember(cardCode: string, name = cardCode, cost = 4): MemberCardData {
  return {
    cardCode,
    name,
    groupNames: ['蓮ノ空女学院スクールアイドルクラブ'],
    unitName: 'みらくらぱーく！',
    cardType: CardType.MEMBER,
    cost,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.PINK, 1)],
  };
}

function runOnEnterDrawOne(cardCode: string, name: string, sourceSlot: SlotPosition): {
  readonly state: GameState;
  readonly sourceId: string;
  readonly drawCardId: string;
} {
  const source = createCardInstance(createMember(cardCode, name), PLAYER1, `${cardCode}-source`);
  const drawCard = createCardInstance(createMember(`${cardCode}-draw`), PLAYER1, `${cardCode}-draw`);
  let game = createGameState(`member-on-enter-draw-${cardCode}`, PLAYER1, 'P1', PLAYER2, 'P2');
  game = registerCards(game, [source, drawCard]);
  game = updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    mainDeck: { ...player.mainDeck, cardIds: [drawCard.instanceId] },
    memberSlots: placeCardInSlot(player.memberSlots, sourceSlot, source.instanceId, {
      orientation: OrientationState.ACTIVE,
      face: FaceState.FACE_UP,
    }),
  }));
  game = emitGameEvent(
    game,
    createEnterStageEvent(source.instanceId, ZoneType.HAND, sourceSlot, PLAYER1, PLAYER1)
  );

  const result = new GameService().executeCheckTiming(game, [TriggerCondition.ON_ENTER_STAGE]);
  expect(result.success).toBe(true);
  return { state: result.gameState, sourceId: source.instanceId, drawCardId: drawCard.instanceId };
}

function pendingAbility(id: string, sourceCardId: string, sourceSlot: SlotPosition): PendingAbilityState {
  return {
    id,
    abilityId: MEMBER_ON_ENTER_DRAW_ONE_ABILITY_ID,
    sourceCardId,
    controllerId: PLAYER1,
    timingId: TriggerCondition.ON_ENTER_STAGE,
    sourceSlot,
    eventIds: [`event-${id}`],
  };
}

describe('member on-enter draw shared workflow', () => {
  it.each([
    ['PL!HS-bp5-011-N', '大沢瑠璃乃', SlotPosition.LEFT],
    ['PL!SP-sd2-009-SD2', '鬼塚夏美', SlotPosition.RIGHT],
  ] as const)('draws one for %s on enter', (cardCode, name, sourceSlot) => {
    const { state, sourceId, drawCardId } = runOnEnterDrawOne(cardCode, name, sourceSlot);

    expect(state.pendingAbilities).toEqual([]);
    expect(state.players[0].hand.cardIds).toContain(drawCardId);
    expect(
      state.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId === MEMBER_ON_ENTER_DRAW_ONE_ABILITY_ID &&
          action.payload.sourceCardId === sourceId &&
          action.payload.step === 'ON_ENTER_DRAW_ONE' &&
          action.payload.drawnCardIds?.[0] === drawCardId
      )
    ).toBe(true);
  });

  it('continues ordered pending after resolving the first on-enter draw one', () => {
    const first = createCardInstance(createMember('PL!HS-bp5-011-N', '大沢瑠璃乃'), PLAYER1, 'first');
    const second = createCardInstance(
      createMember('PL!SP-sd2-009-SD2', '鬼塚夏美'),
      PLAYER1,
      'second'
    );
    const firstDraw = createCardInstance(createMember('DRAW-1'), PLAYER1, 'draw-1');
    const secondDraw = createCardInstance(createMember('DRAW-2'), PLAYER1, 'draw-2');
    let game = createGameState('member-on-enter-draw-ordered', PLAYER1, 'P1', PLAYER2, 'P2');
    game = registerCards(game, [first, second, firstDraw, secondDraw]);
    game = updatePlayer(game, PLAYER1, (player) => ({
      ...player,
      mainDeck: { ...player.mainDeck, cardIds: [firstDraw.instanceId, secondDraw.instanceId] },
      memberSlots: placeCardInSlot(
        placeCardInSlot(player.memberSlots, SlotPosition.LEFT, first.instanceId),
        SlotPosition.RIGHT,
        second.instanceId
      ),
    }));
    game = {
      ...game,
      pendingAbilities: [
        pendingAbility('first-pending', first.instanceId, SlotPosition.LEFT),
        pendingAbility('second-pending', second.instanceId, SlotPosition.RIGHT),
      ],
    };

    const orderSelection = resolvePendingCardEffects(game).gameState;
    expect(orderSelection.activeEffect?.canResolveInOrder).toBe(true);

    const resolved = confirmActiveEffectStep(
      orderSelection,
      PLAYER1,
      orderSelection.activeEffect!.id,
      null,
      null,
      true
    );

    expect(resolved.activeEffect).toBeNull();
    expect(resolved.pendingAbilities).toEqual([]);
    expect(resolved.players[0].hand.cardIds).toEqual([firstDraw.instanceId, secondDraw.instanceId]);
    expect(
      resolved.actionHistory.filter(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId === MEMBER_ON_ENTER_DRAW_ONE_ABILITY_ID &&
          action.payload.step === 'ON_ENTER_DRAW_ONE'
      )
    ).toHaveLength(2);
  });
});
