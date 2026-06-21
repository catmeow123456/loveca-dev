import { describe, expect, it } from 'vitest';
import type { EnergyCardData, MemberCardData } from '../../src/domain/entities/card';
import { createCardInstance, createHeartIcon } from '../../src/domain/entities/card';
import { createGameState, registerCards, updatePlayer } from '../../src/domain/entities/game';
import { addCardToStatefulZone, placeCardInSlot } from '../../src/domain/entities/zone';
import {
  addMemberActivePhaseSkip,
  consumeMemberActivePhaseSkipsForPlayer,
} from '../../src/domain/rules/member-active-skips';
import { GameService } from '../../src/application/game-service';
import {
  CardType,
  FaceState,
  GamePhase,
  HeartColor,
  OrientationState,
  SlotPosition,
  SubPhase,
} from '../../src/shared/types/enums';

const PLAYER1 = 'player1';
const PLAYER2 = 'player2';

function createMember(cardCode: string): MemberCardData {
  return {
    cardCode,
    name: cardCode,
    cardType: CardType.MEMBER,
    cost: 4,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.PINK, 1)],
  };
}

function createEnergy(cardCode: string): EnergyCardData {
  return {
    cardCode,
    name: cardCode,
    cardType: CardType.ENERGY,
  };
}

describe('member active phase skips', () => {
  it('consumes only the active player skip markers', () => {
    let game = createGameState('member-active-skip-consume', PLAYER1, 'P1', PLAYER2, 'P2');
    game = addMemberActivePhaseSkip(game, {
      playerId: PLAYER1,
      memberCardId: 'p1-member',
      sourceCardId: 'p1-member',
      abilityId: 'ability',
    });

    const opponentConsume = consumeMemberActivePhaseSkipsForPlayer(game, PLAYER2);
    expect(opponentConsume.skippedMemberCardIds).toEqual([]);
    expect(opponentConsume.gameState.memberActivePhaseSkips).toHaveLength(1);

    const ownConsume = consumeMemberActivePhaseSkipsForPlayer(opponentConsume.gameState, PLAYER1);
    expect(ownConsume.skippedMemberCardIds).toEqual(['p1-member']);
    expect(ownConsume.gameState.memberActivePhaseSkips).toEqual([]);
  });

  it('keeps marked waiting member waiting while other members and energy become active', () => {
    const skipped = createCardInstance(createMember('SKIPPED'), PLAYER1, 'skipped-member');
    const other = createCardInstance(createMember('OTHER'), PLAYER1, 'other-member');
    const energy = createCardInstance(createEnergy('ENERGY'), PLAYER1, 'energy-card');
    let game = createGameState('member-active-skip-phase', PLAYER1, 'P1', PLAYER2, 'P2');
    game = registerCards(game, [skipped, other, energy]);
    game = updatePlayer(game, PLAYER1, (player) => ({
      ...player,
      energyZone: addCardToStatefulZone(player.energyZone, energy.instanceId, {
        orientation: OrientationState.WAITING,
        face: FaceState.FACE_UP,
      }),
      memberSlots: placeCardInSlot(
        placeCardInSlot(player.memberSlots, SlotPosition.CENTER, skipped.instanceId, {
          orientation: OrientationState.WAITING,
          face: FaceState.FACE_UP,
        }),
        SlotPosition.LEFT,
        other.instanceId,
        {
          orientation: OrientationState.WAITING,
          face: FaceState.FACE_UP,
        }
      ),
    }));
    game = addMemberActivePhaseSkip(game, {
      playerId: PLAYER1,
      memberCardId: skipped.instanceId,
      sourceCardId: skipped.instanceId,
      abilityId: 'ability',
    });
    game = {
      ...game,
      currentPhase: GamePhase.LIVE_RESULT_PHASE,
      currentSubPhase: SubPhase.NONE,
      activePlayerIndex: 0,
    };

    const result = new GameService().advancePhase(game);

    expect(result.success).toBe(true);
    expect(result.gameState.memberActivePhaseSkips).toEqual([]);
    expect(
      result.gameState.players[0].memberSlots.cardStates.get(skipped.instanceId)?.orientation
    ).toBe(OrientationState.WAITING);
    expect(
      result.gameState.players[0].memberSlots.cardStates.get(other.instanceId)?.orientation
    ).toBe(OrientationState.ACTIVE);
    expect(
      result.gameState.players[0].energyZone.cardStates.get(energy.instanceId)?.orientation
    ).toBe(OrientationState.ACTIVE);
    expect(
      result.gameState.eventLog.some(
        (entry) =>
          entry.event.eventType === 'ON_MEMBER_STATE_CHANGED' &&
          entry.event.cardInstanceId === skipped.instanceId
      )
    ).toBe(false);
  });
});
