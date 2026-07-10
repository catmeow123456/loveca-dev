import { describe, expect, it } from 'vitest';
import type { LiveCardData, MemberCardData } from '../../src/domain/entities/card';
import {
  createCardInstance,
  createHeartIcon,
  createHeartRequirement,
} from '../../src/domain/entities/card';
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
import { S_SD1_020_LIVE_SUCCESS_DRAW_AQOURS_STAGE_COUNT_DISCARD_DRAWN_COUNT_ABILITY_ID } from '../../src/application/card-effects/ability-ids';
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

function member(
  cardCode: string,
  options: { readonly groupNames?: readonly string[]; readonly name?: string } = {}
): MemberCardData {
  return {
    cardCode,
    name: options.name ?? cardCode,
    cardType: CardType.MEMBER,
    groupNames: options.groupNames ?? ['Aqours'],
    cost: 4,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.RED, 1)],
  };
}

function live(cardCode: string, name = cardCode): LiveCardData {
  return {
    cardCode,
    name,
    cardType: CardType.LIVE,
    groupNames: ['Aqours'],
    score: 2,
    requirements: createHeartRequirement({ [HeartColor.RED]: 1 }),
    bladeHearts: [],
  };
}

function pending(sourceCardId: string): PendingAbilityState {
  return {
    id: `${S_SD1_020_LIVE_SUCCESS_DRAW_AQOURS_STAGE_COUNT_DISCARD_DRAWN_COUNT_ABILITY_ID}:${sourceCardId}:pending`,
    abilityId: S_SD1_020_LIVE_SUCCESS_DRAW_AQOURS_STAGE_COUNT_DISCARD_DRAWN_COUNT_ABILITY_ID,
    sourceCardId,
    controllerId: PLAYER1,
    mandatory: true,
    timingId: TriggerCondition.ON_LIVE_SUCCESS,
    eventIds: ['live-success-event'],
  };
}

function setup(deckCount: number): {
  readonly game: GameState;
  readonly sourceLiveId: string;
  readonly handId: string;
  readonly drawIds: readonly string[];
} {
  const sourceLive = createCardInstance(live('PL!S-sd1-020-SD', 'JIMO-AI Dash!'), PLAYER1, 'jimo');
  const aqoursA = createCardInstance(member('PL!S-aqours-a'), PLAYER1, 'aqours-a');
  const aqoursB = createCardInstance(member('PL!S-aqours-b'), PLAYER1, 'aqours-b');
  const nonAqours = createCardInstance(
    member('PL!N-non-aqours', { groupNames: ['虹ヶ咲'] }),
    PLAYER1,
    'non-aqours'
  );
  const hand = createCardInstance(member('PL!S-hand-card'), PLAYER1, 'hand');
  const drawCards = Array.from({ length: deckCount }, (_, index) =>
    createCardInstance(member(`PL!S-draw-${index + 1}`), PLAYER1, `draw-${index + 1}`)
  );
  let game = registerCards(createGameState('s-sd1-020', PLAYER1, 'P1', PLAYER2, 'P2'), [
    sourceLive,
    aqoursA,
    aqoursB,
    nonAqours,
    hand,
    ...drawCards,
  ]);
  game = updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    memberSlots: placeCardInSlot(
      placeCardInSlot(
        placeCardInSlot(player.memberSlots, SlotPosition.LEFT, aqoursA.instanceId, {
          orientation: OrientationState.ACTIVE,
          face: FaceState.FACE_UP,
        }),
        SlotPosition.CENTER,
        aqoursB.instanceId,
        {
          orientation: OrientationState.ACTIVE,
          face: FaceState.FACE_UP,
        }
      ),
      SlotPosition.RIGHT,
      nonAqours.instanceId,
      {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      }
    ),
    liveZone: {
      ...player.liveZone,
      cardIds: [sourceLive.instanceId],
      cardStates: new Map([
        [sourceLive.instanceId, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
      ]),
    },
    hand: { ...player.hand, cardIds: [hand.instanceId] },
    mainDeck: { ...player.mainDeck, cardIds: drawCards.map((card) => card.instanceId) },
  }));
  return {
    game: { ...game, pendingAbilities: [pending(sourceLive.instanceId)] },
    sourceLiveId: sourceLive.instanceId,
    handId: hand.instanceId,
    drawIds: drawCards.map((card) => card.instanceId),
  };
}

describe('PL!S-sd1-020 JIMO-AI Dash!', () => {
  it('draws for current Aqours stage members and accepts selectedCardId for single-card discard', () => {
    const scenario = setup(1);
    const started = resolvePendingCardEffects(scenario.game).gameState;

    expect(started.activeEffect?.metadata?.confirmOnlyPendingAbility).toBeUndefined();
    expect(started.activeEffect?.stepText).toContain('已实际抽1张卡');
    expect(started.activeEffect?.selectableCardMode).toBe('SINGLE');
    expect(started.players[0]!.hand.cardIds).toEqual([scenario.handId, scenario.drawIds[0]]);

    const resolved = confirmActiveEffectStep(
      started,
      PLAYER1,
      started.activeEffect!.id,
      scenario.handId,
      null,
      false,
      null
    );

    expect(resolved.activeEffect).toBeNull();
    expect(resolved.pendingAbilities).toEqual([]);
    expect(resolved.players[0]!.hand.cardIds).toEqual([scenario.drawIds[0]]);
    expect(resolved.players[0]!.waitingRoom.cardIds).toContain(scenario.handId);
    expect(
      resolved.eventLog.some(
        (entry) =>
          entry.event.eventType === TriggerCondition.ON_ENTER_WAITING_ROOM &&
          entry.event.fromZone === ZoneType.HAND &&
          entry.event.cardInstanceIds?.includes(scenario.handId) === true
      )
    ).toBe(true);
  });

  it('does not open a discard window when the actual drawn count is zero', () => {
    const scenario = setup(0);
    const resolved = resolvePendingCardEffects(scenario.game).gameState;

    expect(resolved.activeEffect).toBeNull();
    expect(resolved.pendingAbilities).toEqual([]);
    expect(resolved.players[0]!.hand.cardIds).toEqual([scenario.handId]);
    expect(resolved.players[0]!.waitingRoom.cardIds).toEqual([]);
  });

  it('safely continues without discarding when the discard selection is stale', () => {
    const scenario = setup(1);
    const started = resolvePendingCardEffects(scenario.game).gameState;
    const staleSelection = updatePlayer(started, PLAYER1, (player) => ({
      ...player,
      hand: {
        ...player.hand,
        cardIds: player.hand.cardIds.filter((cardId) => cardId !== scenario.handId),
      },
      waitingRoom: {
        ...player.waitingRoom,
        cardIds: [...player.waitingRoom.cardIds, scenario.handId],
      },
    }));

    const resolved = confirmActiveEffectStep(
      staleSelection,
      PLAYER1,
      staleSelection.activeEffect!.id,
      scenario.handId,
      null,
      false,
      null,
      [scenario.handId]
    );

    expect(resolved.activeEffect).toBeNull();
    expect(resolved.players[0]!.hand.cardIds).toEqual([scenario.drawIds[0]]);
    expect(
      resolved.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload?.step === 'STALE_OR_INVALID_DISCARD_SELECTION'
      )
    ).toBe(true);
  });
});
