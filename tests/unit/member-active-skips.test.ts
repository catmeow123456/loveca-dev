import { describe, expect, it } from 'vitest';
import type { EnergyCardData, MemberCardData } from '../../src/domain/entities/card';
import { createCardInstance, createHeartIcon } from '../../src/domain/entities/card';
import { createGameState, registerCards, updatePlayer } from '../../src/domain/entities/game';
import {
  addCardToStatefulZone,
  placeCardInSlot,
  removeCardFromSlot,
} from '../../src/domain/entities/zone';
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

function prepareActivePhaseAdvance(game: ReturnType<typeof createGameState>, activePlayerIndex = 0) {
  return {
    ...game,
    currentPhase: GamePhase.LIVE_RESULT_PHASE,
    currentSubPhase: SubPhase.NONE,
    activePlayerIndex,
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

  it('keeps PL!N-bp5-006 waiting during its own active phase without consuming skip markers', () => {
    const kanata = createCardInstance(createMember('PL!N-bp5-006-R'), PLAYER1, 'kanata');
    const other = createCardInstance(createMember('OTHER'), PLAYER1, 'other-member');
    const energy = createCardInstance(createEnergy('ENERGY'), PLAYER1, 'energy-card');
    let game = createGameState('n-bp5-006-continuous-active-phase', PLAYER1, 'P1', PLAYER2, 'P2');
    game = registerCards(game, [kanata, other, energy]);
    game = updatePlayer(game, PLAYER1, (player) => ({
      ...player,
      energyZone: addCardToStatefulZone(player.energyZone, energy.instanceId, {
        orientation: OrientationState.WAITING,
        face: FaceState.FACE_UP,
      }),
      memberSlots: placeCardInSlot(
        placeCardInSlot(player.memberSlots, SlotPosition.CENTER, kanata.instanceId, {
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

    const first = new GameService().advancePhase(prepareActivePhaseAdvance(game));

    expect(first.success).toBe(true);
    expect(first.gameState.memberActivePhaseSkips).toEqual([]);
    expect(first.gameState.players[0].memberSlots.cardStates.get(kanata.instanceId)?.orientation).toBe(
      OrientationState.WAITING
    );
    expect(first.gameState.players[0].memberSlots.cardStates.get(other.instanceId)?.orientation).toBe(
      OrientationState.ACTIVE
    );
    expect(first.gameState.players[0].energyZone.cardStates.get(energy.instanceId)?.orientation).toBe(
      OrientationState.ACTIVE
    );

    const second = new GameService().advancePhase(
      prepareActivePhaseAdvance(
        updatePlayer(first.gameState, PLAYER1, (player) => ({
          ...player,
          energyZone: {
            ...player.energyZone,
            cardStates: new Map([[energy.instanceId, { orientation: OrientationState.WAITING, face: FaceState.FACE_UP }]]),
          },
        }))
      )
    );

    expect(second.success).toBe(true);
    expect(second.gameState.memberActivePhaseSkips).toEqual([]);
    expect(second.gameState.players[0].memberSlots.cardStates.get(kanata.instanceId)?.orientation).toBe(
      OrientationState.WAITING
    );
    expect(second.gameState.players[0].energyZone.cardStates.get(energy.instanceId)?.orientation).toBe(
      OrientationState.ACTIVE
    );
  });

  it('does not wait an active PL!N-bp5-006 or keep applying after it leaves stage', () => {
    const activeKanata = createCardInstance(createMember('PL!N-bp5-006-R'), PLAYER1, 'active-kanata');
    const leftKanata = createCardInstance(createMember('PL!N-bp5-006-P'), PLAYER1, 'left-kanata');
    const other = createCardInstance(createMember('OTHER'), PLAYER1, 'other-member');
    let game = createGameState('n-bp5-006-active-and-left-stage', PLAYER1, 'P1', PLAYER2, 'P2');
    game = registerCards(game, [activeKanata, leftKanata, other]);
    game = updatePlayer(game, PLAYER1, (player) => {
      const withCards = placeCardInSlot(
        placeCardInSlot(
          placeCardInSlot(player.memberSlots, SlotPosition.CENTER, activeKanata.instanceId, {
            orientation: OrientationState.ACTIVE,
            face: FaceState.FACE_UP,
          }),
          SlotPosition.LEFT,
          leftKanata.instanceId,
          {
            orientation: OrientationState.WAITING,
            face: FaceState.FACE_UP,
          }
        ),
        SlotPosition.RIGHT,
        other.instanceId,
        {
          orientation: OrientationState.WAITING,
          face: FaceState.FACE_UP,
        }
      );
      return {
        ...player,
        memberSlots: removeCardFromSlot(withCards, SlotPosition.LEFT),
      };
    });

    const result = new GameService().advancePhase(prepareActivePhaseAdvance(game));

    expect(result.success).toBe(true);
    expect(
      result.gameState.players[0].memberSlots.cardStates.get(activeKanata.instanceId)?.orientation
    ).toBe(OrientationState.ACTIVE);
    expect(
      result.gameState.players[0].memberSlots.cardStates.get(other.instanceId)?.orientation
    ).toBe(OrientationState.ACTIVE);
    expect(
      result.gameState.eventLog.some(
        (entry) =>
          entry.event.eventType === 'ON_MEMBER_STATE_CHANGED' &&
          entry.event.cardInstanceId === activeKanata.instanceId
      )
    ).toBe(false);
  });

  it('keeps player 2 PL!N-bp5-006 waiting during player 2 own active phase without touching player 1 PL!N-bp5-006', () => {
    const ownKanata = createCardInstance(createMember('PL!N-bp5-006-P'), PLAYER1, 'p1-kanata');
    const opponentKanata = createCardInstance(
      createMember('PL!N-bp5-006-AR'),
      PLAYER2,
      'p2-kanata'
    );
    const opponentOther = createCardInstance(createMember('OPPONENT'), PLAYER2, 'opponent-member');
    const opponentEnergy = createCardInstance(
      createEnergy('OPPONENT-ENERGY'),
      PLAYER2,
      'opponent-energy'
    );
    let game = createGameState('n-bp5-006-opponent-active-phase', PLAYER1, 'P1', PLAYER2, 'P2');
    game = registerCards(game, [ownKanata, opponentKanata, opponentOther, opponentEnergy]);
    game = updatePlayer(game, PLAYER1, (player) => ({
      ...player,
      memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, ownKanata.instanceId, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      }),
    }));
    game = updatePlayer(game, PLAYER2, (player) => ({
      ...player,
      energyZone: addCardToStatefulZone(player.energyZone, opponentEnergy.instanceId, {
        orientation: OrientationState.WAITING,
        face: FaceState.FACE_UP,
      }),
      memberSlots: placeCardInSlot(
        placeCardInSlot(player.memberSlots, SlotPosition.CENTER, opponentKanata.instanceId, {
          orientation: OrientationState.WAITING,
          face: FaceState.FACE_UP,
        }),
        SlotPosition.LEFT,
        opponentOther.instanceId,
        {
          orientation: OrientationState.WAITING,
          face: FaceState.FACE_UP,
        }
      ),
    }));

    const result = new GameService().advancePhase({
      ...prepareActivePhaseAdvance(game, 0),
      firstPlayerIndex: 1,
    });

    expect(result.success).toBe(true);
    expect(result.gameState.activePlayerIndex).toBe(1);
    expect(
      result.gameState.players[0].memberSlots.cardStates.get(ownKanata.instanceId)?.orientation
    ).toBe(OrientationState.ACTIVE);
    expect(
      result.gameState.players[1].memberSlots.cardStates.get(opponentKanata.instanceId)?.orientation
    ).toBe(OrientationState.WAITING);
    expect(
      result.gameState.players[1].memberSlots.cardStates.get(opponentOther.instanceId)?.orientation
    ).toBe(OrientationState.ACTIVE);
    expect(
      result.gameState.players[1].energyZone.cardStates.get(opponentEnergy.instanceId)?.orientation
    ).toBe(OrientationState.ACTIVE);
  });

  it('keeps all active player members waiting when opponent stage has PL!HS-pb1-008 while energy activates', () => {
    const izumi = createCardInstance(createMember('PL!HS-pb1-008-R'), PLAYER2, 'opponent-izumi');
    const ownFirst = createCardInstance(createMember('OWN-FIRST'), PLAYER1, 'own-first');
    const ownSecond = createCardInstance(createMember('OWN-SECOND'), PLAYER1, 'own-second');
    const energy = createCardInstance(createEnergy('ENERGY'), PLAYER1, 'energy-card');
    let game = createGameState('hs-pb1-008-opponent-active-phase-skip', PLAYER1, 'P1', PLAYER2, 'P2');
    game = registerCards(game, [izumi, ownFirst, ownSecond, energy]);
    game = updatePlayer(game, PLAYER1, (player) => ({
      ...player,
      energyZone: addCardToStatefulZone(player.energyZone, energy.instanceId, {
        orientation: OrientationState.WAITING,
        face: FaceState.FACE_UP,
      }),
      memberSlots: placeCardInSlot(
        placeCardInSlot(player.memberSlots, SlotPosition.CENTER, ownFirst.instanceId, {
          orientation: OrientationState.WAITING,
          face: FaceState.FACE_UP,
        }),
        SlotPosition.LEFT,
        ownSecond.instanceId,
        {
          orientation: OrientationState.WAITING,
          face: FaceState.FACE_UP,
        }
      ),
    }));
    game = updatePlayer(game, PLAYER2, (player) => ({
      ...player,
      memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, izumi.instanceId, {
        orientation: OrientationState.WAITING,
        face: FaceState.FACE_UP,
      }),
    }));

    const result = new GameService().advancePhase(prepareActivePhaseAdvance(game));

    expect(result.success).toBe(true);
    expect(result.gameState.players[0].memberSlots.cardStates.get(ownFirst.instanceId)?.orientation).toBe(
      OrientationState.WAITING
    );
    expect(result.gameState.players[0].memberSlots.cardStates.get(ownSecond.instanceId)?.orientation).toBe(
      OrientationState.WAITING
    );
    expect(result.gameState.players[0].energyZone.cardStates.get(energy.instanceId)?.orientation).toBe(
      OrientationState.ACTIVE
    );
    expect(
      result.gameState.eventLog.some(
        (entry) =>
          entry.event.eventType === 'ON_MEMBER_STATE_CHANGED' &&
          (entry.event.cardInstanceId === ownFirst.instanceId ||
            entry.event.cardInstanceId === ownSecond.instanceId)
      )
    ).toBe(false);
  });

  it('restores normal active phase behavior after PL!HS-pb1-008 leaves opponent stage', () => {
    const izumi = createCardInstance(createMember('PL!HS-pb1-008-P＋'), PLAYER2, 'opponent-izumi');
    const ownMember = createCardInstance(createMember('OWN-MEMBER'), PLAYER1, 'own-member');
    let game = createGameState('hs-pb1-008-left-stage-active-phase', PLAYER1, 'P1', PLAYER2, 'P2');
    game = registerCards(game, [izumi, ownMember]);
    game = updatePlayer(game, PLAYER1, (player) => ({
      ...player,
      memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, ownMember.instanceId, {
        orientation: OrientationState.WAITING,
        face: FaceState.FACE_UP,
      }),
    }));
    game = updatePlayer(game, PLAYER2, (player) => {
      const withIzumi = placeCardInSlot(player.memberSlots, SlotPosition.CENTER, izumi.instanceId, {
        orientation: OrientationState.WAITING,
        face: FaceState.FACE_UP,
      });
      return {
        ...player,
        memberSlots: removeCardFromSlot(withIzumi, SlotPosition.CENTER),
      };
    });

    const result = new GameService().advancePhase(prepareActivePhaseAdvance(game));

    expect(result.success).toBe(true);
    expect(result.gameState.players[0].memberSlots.cardStates.get(ownMember.instanceId)?.orientation).toBe(
      OrientationState.ACTIVE
    );
  });
});
