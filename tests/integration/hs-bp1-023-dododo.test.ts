import { describe, expect, it } from 'vitest';
import type { EnergyCardData, LiveCardData, MemberCardData } from '../../src/domain/entities/card';
import {
  createCardInstance,
  createHeartIcon,
  createHeartRequirement,
} from '../../src/domain/entities/card';
import { createGameState, registerCards, updatePlayer } from '../../src/domain/entities/game';
import { placeCardInSlot } from '../../src/domain/entities/zone';
import { GameService } from '../../src/application/game-service';
import { HS_BP1_023_LIVE_SUCCESS_HIGHER_SCORE_PLACE_WAITING_ENERGY_ABILITY_ID } from '../../src/application/card-effects/ability-ids';
import {
  CardType,
  FaceState,
  GamePhase,
  HeartColor,
  OrientationState,
  SlotPosition,
  SubPhase,
  TriggerCondition,
} from '../../src/shared/types/enums';

const PLAYER1 = 'player1';
const PLAYER2 = 'player2';

function createMember(
  cardCode: string,
  groupName = '蓮ノ空女学院スクールアイドルクラブ'
): MemberCardData {
  return {
    cardCode,
    name: cardCode,
    groupName,
    cardType: CardType.MEMBER,
    cost: 1,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.PINK, 1)],
  };
}

function createLive(): LiveCardData {
  return {
    cardCode: 'PL!HS-bp1-023-L',
    name: 'ド！ド！ド！',
    groupName: '蓮ノ空女学院スクールアイドルクラブ',
    unitName: 'みらくらぱーく！',
    cardType: CardType.LIVE,
    score: 2,
    requirements: createHeartRequirement({ [HeartColor.PINK]: 3, [HeartColor.RAINBOW]: 2 }),
  };
}

function createEnergy(cardCode: string): EnergyCardData {
  return {
    cardCode,
    name: cardCode,
    cardType: CardType.ENERGY,
  };
}

function runLiveSuccess(options: {
  readonly ownScore: number;
  readonly opponentScore: number;
  readonly hasHasunosoraMember: boolean;
  readonly energyDeckCount: number;
}) {
  const live = createCardInstance(createLive(), PLAYER1, 'dododo-live');
  const member = createCardInstance(
    createMember(
      options.hasHasunosoraMember ? 'HASUNOSORA-MEMBER' : 'LIELLA-MEMBER',
      options.hasHasunosoraMember
        ? '蓮ノ空女学院スクールアイドルクラブ'
        : 'ラブライブ！スーパースター!!'
    ),
    PLAYER1,
    'stage-member'
  );
  const energies = Array.from({ length: options.energyDeckCount }, (_, index) =>
    createCardInstance(createEnergy(`ENE-${index}`), PLAYER1, `energy-${index}`)
  );
  let game = createGameState('hs-bp1-023-dododo', PLAYER1, 'P1', PLAYER2, 'P2');
  game = registerCards(game, [live, member, ...energies]);
  game = updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    energyDeck: { ...player.energyDeck, cardIds: energies.map((energy) => energy.instanceId) },
    energyZone: { ...player.energyZone, cardIds: [], cardStates: new Map() },
    memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, member.instanceId, {
      orientation: OrientationState.ACTIVE,
      face: FaceState.FACE_UP,
    }),
  }));
  game = {
    ...game,
    currentPhase: GamePhase.LIVE_RESULT_PHASE,
    currentSubPhase: SubPhase.RESULT_FIRST_SUCCESS_EFFECTS,
    firstPlayerIndex: 0,
    activePlayerIndex: 0,
    liveResolution: {
      ...game.liveResolution,
      liveResults: new Map([[live.instanceId, true]]),
      playerScores: new Map([
        [PLAYER1, options.ownScore],
        [PLAYER2, options.opponentScore],
      ]),
      performingPlayerId: PLAYER1,
    },
  };

  const result = new GameService().executeCheckTiming(game, [TriggerCondition.ON_LIVE_SUCCESS]);
  expect(result.success).toBe(true);
  return { state: result.gameState, live, energies };
}

describe('HS-bp1-023 ド！ド！ド！ workflow', () => {
  it('places one waiting energy when own score is higher and a Hasunosora member is on stage', () => {
    const { state, live, energies } = runLiveSuccess({
      ownScore: 5,
      opponentScore: 3,
      hasHasunosoraMember: true,
      energyDeckCount: 2,
    });

    expect(state.players[0].energyZone.cardIds).toEqual([energies[0].instanceId]);
    expect(state.players[0].energyZone.cardStates.get(energies[0].instanceId)?.orientation).toBe(
      OrientationState.WAITING
    );
    expect(state.players[0].energyDeck.cardIds).toEqual([energies[1].instanceId]);
    expect(
      state.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId ===
            HS_BP1_023_LIVE_SUCCESS_HIGHER_SCORE_PLACE_WAITING_ENERGY_ABILITY_ID &&
          action.payload.sourceCardId === live.instanceId &&
          action.payload.conditionMet === true &&
          Array.isArray(action.payload.placedEnergyCardIds) &&
          action.payload.placedEnergyCardIds[0] === energies[0].instanceId
      )
    ).toBe(true);
  });

  it('does not place energy when own score is not higher', () => {
    const { state } = runLiveSuccess({
      ownScore: 3,
      opponentScore: 3,
      hasHasunosoraMember: true,
      energyDeckCount: 1,
    });

    expect(state.players[0].energyZone.cardIds).toEqual([]);
    expect(state.players[0].energyDeck.cardIds).toEqual(['energy-0']);
  });

  it('does not place energy without a Hasunosora member on stage', () => {
    const { state } = runLiveSuccess({
      ownScore: 5,
      opponentScore: 3,
      hasHasunosoraMember: false,
      energyDeckCount: 1,
    });

    expect(state.players[0].energyZone.cardIds).toEqual([]);
    expect(state.players[0].energyDeck.cardIds).toEqual(['energy-0']);
  });

  it('safely resolves when the energy deck is empty', () => {
    const { state } = runLiveSuccess({
      ownScore: 5,
      opponentScore: 3,
      hasHasunosoraMember: true,
      energyDeckCount: 0,
    });

    expect(state.players[0].energyZone.cardIds).toEqual([]);
    expect(
      state.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId ===
            HS_BP1_023_LIVE_SUCCESS_HIGHER_SCORE_PLACE_WAITING_ENERGY_ABILITY_ID &&
          action.payload.conditionMet === true &&
          Array.isArray(action.payload.placedEnergyCardIds) &&
          action.payload.placedEnergyCardIds.length === 0
      )
    ).toBe(true);
  });
});
