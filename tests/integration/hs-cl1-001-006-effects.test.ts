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
import { GameService } from '../../src/application/game-service';
import { confirmActiveEffectStep } from '../../src/application/card-effect-runner';
import { continuePublicEffectChoiceForTest } from '../helpers/public-effect-choice';
import {
  HS_CL1_001_LIVE_START_LOOK_TOP_ONE_OPTIONAL_WAITING_ROOM_ABILITY_ID,
} from '../../src/application/card-effects/ability-ids';
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

function createMember(cardCode: string, name: string, cost: number): MemberCardData {
  return {
    cardCode,
    name,
    groupNames: ['蓮ノ空女学院スクールアイドルクラブ'],
    cardType: CardType.MEMBER,
    cost,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.PINK, 1)],
  };
}

function placeSourceMemberOnStage(game: GameState, cardId: string): GameState {
  return updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, cardId, {
      orientation: OrientationState.ACTIVE,
      face: FaceState.FACE_UP,
    }),
  }));
}

function confirmActiveEffectOption(game: GameState, selectedOptionId: string | null): GameState {
  const normalizedOptionId = selectedOptionId ?? 'keep-top';
  return continuePublicEffectChoiceForTest(confirmActiveEffectStep(
    game,
    PLAYER1,
    game.activeEffect!.id,
    null,
    null,
    undefined,
    normalizedOptionId
  ), PLAYER1);
}

describe('PL!HS-cl1-001-CL Kaho live-start workflow', () => {
  it('opens a private top-card inspection and places the card into waiting room with triggers', () => {
    const kaho = createCardInstance(
      createMember('PL!HS-cl1-001-CL', '日野下花帆', 4),
      PLAYER1,
      'kaho-source'
    );
    const topCard = createCardInstance(
      createMember('PL!HS-test-top-member', 'Top Member', 3),
      PLAYER1,
      'top-card'
    );
    let game = createGameState('hs-cl1-001-kaho-place', PLAYER1, 'P1', PLAYER2, 'P2');
    game = registerCards(game, [kaho, topCard]);
    game = placeSourceMemberOnStage(game, kaho.instanceId);
    game = updatePlayer(game, PLAYER1, (player) => ({
      ...player,
      mainDeck: { ...player.mainDeck, cardIds: [topCard.instanceId] },
      waitingRoom: { ...player.waitingRoom, cardIds: [] },
    }));

    const checkResult = new GameService().executeCheckTiming(game, [TriggerCondition.ON_LIVE_START]);
    expect(checkResult.success, checkResult.error).toBe(true);
    let state = checkResult.gameState;

    expect(state.activeEffect).toMatchObject({
      abilityId: HS_CL1_001_LIVE_START_LOOK_TOP_ONE_OPTIONAL_WAITING_ROOM_ABILITY_ID,
      inspectionCardIds: [topCard.instanceId],
      effectChoice: {
        mode: 'SINGLE',
        options: [
          { id: 'keep-top', text: '将检视的卡保留在卡组顶。' },
          { id: 'place-waiting-room', text: '将检视的卡放置入休息室。' },
        ],
      },
      canSkipSelection: false,
    });
    expect(state.inspectionZone.cardIds).toEqual([topCard.instanceId]);
    expect(state.inspectionZone.revealedCardIds).toEqual([]);
    expect(state.inspectionContext).toEqual({
      ownerPlayerId: PLAYER1,
      sourceZone: ZoneType.MAIN_DECK,
    });
    expect(state.players[0].mainDeck.cardIds).toEqual([]);

    state = confirmActiveEffectOption(state, 'place-waiting-room');

    expect(state.activeEffect).toBeNull();
    expect(state.pendingAbilities).toEqual([]);
    expect(state.inspectionZone.cardIds).toEqual([]);
    expect(state.inspectionContext).toBeNull();
    expect(state.players[0].mainDeck.cardIds).toEqual([topCard.instanceId]);
    expect(
      state.eventLog.find(
        (entry) =>
          entry.event.eventType === TriggerCondition.ON_ENTER_WAITING_ROOM &&
          entry.event.cardInstanceId === topCard.instanceId
      )?.event
    ).toMatchObject({
      eventType: TriggerCondition.ON_ENTER_WAITING_ROOM,
      fromZone: ZoneType.MAIN_DECK,
      toZone: ZoneType.WAITING_ROOM,
      ownerId: PLAYER1,
      controllerId: PLAYER1,
    });
  });

  it('keeps the inspected card on top of the deck when the player declines', () => {
    const kaho = createCardInstance(
      createMember('PL!HS-cl1-001-CL', '日野下花帆', 4),
      PLAYER1,
      'kaho-source'
    );
    const topCard = createCardInstance(
      createMember('PL!HS-test-top-member', 'Top Member', 3),
      PLAYER1,
      'top-card'
    );
    const secondCard = createCardInstance(
      createMember('PL!HS-test-second-member', 'Second Member', 3),
      PLAYER1,
      'second-card'
    );
    let game = createGameState('hs-cl1-001-kaho-keep', PLAYER1, 'P1', PLAYER2, 'P2');
    game = registerCards(game, [kaho, topCard, secondCard]);
    game = placeSourceMemberOnStage(game, kaho.instanceId);
    game = updatePlayer(game, PLAYER1, (player) => ({
      ...player,
      mainDeck: { ...player.mainDeck, cardIds: [topCard.instanceId, secondCard.instanceId] },
      waitingRoom: { ...player.waitingRoom, cardIds: [] },
    }));

    const checkResult = new GameService().executeCheckTiming(game, [TriggerCondition.ON_LIVE_START]);
    expect(checkResult.success, checkResult.error).toBe(true);

    const state = confirmActiveEffectOption(checkResult.gameState, null);

    expect(state.activeEffect).toBeNull();
    expect(state.pendingAbilities).toEqual([]);
    expect(state.players[0].mainDeck.cardIds).toEqual([topCard.instanceId, secondCard.instanceId]);
    expect(state.players[0].waitingRoom.cardIds).toEqual([]);
    expect(
      state.eventLog.some(
        (entry) =>
          entry.event.eventType === TriggerCondition.ON_ENTER_WAITING_ROOM &&
          entry.event.cardInstanceId === topCard.instanceId
      )
    ).toBe(false);
  });

  it('consumes the pending ability when the main deck is empty', () => {
    const kaho = createCardInstance(
      createMember('PL!HS-cl1-001-CL', '日野下花帆', 4),
      PLAYER1,
      'kaho-source'
    );
    let game = createGameState('hs-cl1-001-kaho-empty', PLAYER1, 'P1', PLAYER2, 'P2');
    game = registerCards(game, [kaho]);
    game = placeSourceMemberOnStage(game, kaho.instanceId);
    game = updatePlayer(game, PLAYER1, (player) => ({
      ...player,
      mainDeck: { ...player.mainDeck, cardIds: [] },
      waitingRoom: { ...player.waitingRoom, cardIds: [] },
    }));

    const checkResult = new GameService().executeCheckTiming(game, [TriggerCondition.ON_LIVE_START]);
    expect(checkResult.success, checkResult.error).toBe(true);

    expect(checkResult.gameState.activeEffect).toBeNull();
    expect(checkResult.gameState.pendingAbilities).toEqual([]);
    expect(
      checkResult.gameState.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId ===
            HS_CL1_001_LIVE_START_LOOK_TOP_ONE_OPTIONAL_WAITING_ROOM_ABILITY_ID &&
          action.payload.step === 'NO_TOP_CARD_TO_LOOK'
      )
    ).toBe(true);
  });
});
