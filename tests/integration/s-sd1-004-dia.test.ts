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
import { placeCardInSlot, removeCardFromSlot } from '../../src/domain/entities/zone';
import {
  confirmActiveEffectStep,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import { S_SD1_004_LIVE_START_DRAW_ONE_HAND_TWO_TO_DECK_TOP_ABILITY_ID } from '../../src/application/card-effects/ability-ids';
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
    cardType: CardType.MEMBER,
    groupNames: ['Aqours'],
    cost: 4,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.RED, 1)],
  };
}

function pending(sourceCardId: string): PendingAbilityState {
  return {
    id: `${S_SD1_004_LIVE_START_DRAW_ONE_HAND_TWO_TO_DECK_TOP_ABILITY_ID}:${sourceCardId}:pending`,
    abilityId: S_SD1_004_LIVE_START_DRAW_ONE_HAND_TWO_TO_DECK_TOP_ABILITY_ID,
    sourceCardId,
    controllerId: PLAYER1,
    mandatory: true,
    timingId: TriggerCondition.ON_LIVE_START,
    eventIds: ['live-start-event'],
    sourceSlot: SlotPosition.CENTER,
  };
}

function setup(): {
  readonly game: GameState;
  readonly sourceId: string;
  readonly handId: string;
  readonly drawnId: string;
  readonly fillerId: string;
} {
  const source = createCardInstance(member('PL!S-sd1-004-SD', '黒澤ダイヤ'), PLAYER1, 'dia');
  const hand = createCardInstance(member('PL!S-hand-card'), PLAYER1, 'hand');
  const drawn = createCardInstance(member('PL!S-drawn-card'), PLAYER1, 'drawn');
  const filler = createCardInstance(member('PL!S-filler-card'), PLAYER1, 'filler');
  let game = registerCards(createGameState('s-sd1-004', PLAYER1, 'P1', PLAYER2, 'P2'), [
    source,
    hand,
    drawn,
    filler,
  ]);
  game = updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, source.instanceId, {
      orientation: OrientationState.ACTIVE,
      face: FaceState.FACE_UP,
    }),
    hand: { ...player.hand, cardIds: [hand.instanceId] },
    mainDeck: { ...player.mainDeck, cardIds: [drawn.instanceId, filler.instanceId] },
  }));
  return {
    game: { ...game, pendingAbilities: [pending(source.instanceId)] },
    sourceId: source.instanceId,
    handId: hand.instanceId,
    drawnId: drawn.instanceId,
    fillerId: filler.instanceId,
  };
}

describe('PL!S-sd1-004 黒澤ダイヤ', () => {
  it('opens a real optional LIVE_START interaction, then lets the drawn card be returned to deck top', () => {
    const scenario = setup();
    const started = resolvePendingCardEffects(scenario.game).gameState;

    expect(started.activeEffect?.metadata?.confirmOnlyPendingAbility).toBeUndefined();
    expect(started.activeEffect?.selectableOptions).toEqual([{ id: 'draw', label: '发动' }]);
    expect(started.activeEffect?.skipSelectionLabel).toBe('不发动');

    const afterDraw = confirmActiveEffectStep(
      started,
      PLAYER1,
      started.activeEffect!.id,
      null,
      null,
      false,
      'draw'
    );
    expect(afterDraw.activeEffect?.stepText).toContain('已抽1张卡');
    expect(afterDraw.activeEffect?.selectableCardMode).toBe('ORDERED_MULTI');
    expect(afterDraw.players[0]!.hand.cardIds).toEqual([scenario.handId, scenario.drawnId]);

    const resolved = confirmActiveEffectStep(
      afterDraw,
      PLAYER1,
      afterDraw.activeEffect!.id,
      null,
      null,
      false,
      null,
      [scenario.drawnId, scenario.handId]
    );

    expect(resolved.activeEffect).toBeNull();
    expect(resolved.pendingAbilities).toEqual([]);
    expect(resolved.players[0]!.hand.cardIds).toEqual([]);
    expect(resolved.players[0]!.mainDeck.cardIds).toEqual([
      scenario.drawnId,
      scenario.handId,
      scenario.fillerId,
    ]);
    expect(
      resolved.eventLog.some(
        (entry) => entry.event.eventType === TriggerCondition.ON_ENTER_WAITING_ROOM
      )
    ).toBe(false);
  });

  it('safely consumes the effect without moving hand cards if the source leaves stage before selection', () => {
    const scenario = setup();
    const started = resolvePendingCardEffects(scenario.game).gameState;
    const afterDraw = confirmActiveEffectStep(
      started,
      PLAYER1,
      started.activeEffect!.id,
      null,
      null,
      false,
      'draw'
    );
    const sourceLeft = updatePlayer(afterDraw, PLAYER1, (player) => ({
      ...player,
      memberSlots: removeCardFromSlot(player.memberSlots, SlotPosition.CENTER),
    }));

    const resolved = confirmActiveEffectStep(
      sourceLeft,
      PLAYER1,
      sourceLeft.activeEffect!.id,
      null,
      null,
      false,
      null,
      [scenario.drawnId, scenario.handId]
    );

    expect(resolved.activeEffect).toBeNull();
    expect(resolved.players[0]!.hand.cardIds).toEqual([scenario.handId, scenario.drawnId]);
    expect(resolved.players[0]!.mainDeck.cardIds).toEqual([scenario.fillerId]);
  });
});
