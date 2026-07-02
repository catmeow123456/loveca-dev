import { describe, expect, it } from 'vitest';
import type { EnergyCardData, LiveCardData, MemberCardData } from '../../src/domain/entities/card';
import {
  createCardInstance,
  createHeartIcon,
  createHeartRequirement,
} from '../../src/domain/entities/card';
import { createGameState, registerCards, updatePlayer, type GameState } from '../../src/domain/entities/game';
import {
  addCardToStatefulZone,
  addCardToZone,
  placeCardInSlot,
  removeCardFromZone,
} from '../../src/domain/entities/zone';
import {
  createActivateAbilityCommand,
  createConfirmEffectStepCommand,
} from '../../src/application/game-commands';
import { createGameSession } from '../../src/application/game-session';
import { SP_BP5_111_ACTIVATED_RETURN_TWO_ENERGY_RECOVER_LIVE_ABILITY_ID } from '../../src/application/card-effects/ability-ids';
import {
  CardType,
  FaceState,
  GamePhase,
  HeartColor,
  OrientationState,
  SlotPosition,
  SubPhase,
  TurnType,
} from '../../src/shared/types/enums';

const PLAYER1 = 'player1';
const PLAYER2 = 'player2';

function member(): MemberCardData {
  return {
    cardCode: 'PL!SP-bp5-111-R',
    name: '柊摩央',
    groupNames: ['Liella!'],
    cardType: CardType.MEMBER,
    cost: 8,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.PINK, 1)],
  };
}

function live(cardCode: string): LiveCardData {
  return {
    cardCode,
    name: cardCode,
    groupNames: ['Liella!'],
    cardType: CardType.LIVE,
    score: 1,
    requirements: createHeartRequirement({ [HeartColor.PINK]: 1 }),
  };
}

function energy(cardCode: string): EnergyCardData {
  return { cardCode, name: cardCode, cardType: CardType.ENERGY };
}

function setMainPhase(game: GameState): GameState {
  return {
    ...game,
    currentPhase: GamePhase.MAIN_PHASE,
    currentSubPhase: SubPhase.NONE,
    currentTurnType: TurnType.FIRST_PLAYER_TURN,
    activePlayerIndex: 0,
  };
}

function setup(options: { readonly energyCount: number; readonly waitingLiveCount: number }) {
  const source = createCardInstance(member(), PLAYER1, 'mao-source');
  const energies = Array.from({ length: options.energyCount }, (_, index) =>
    createCardInstance(energy(`PL!E-${index}`), PLAYER1, `energy-${index}`)
  );
  const waitingLives = Array.from({ length: options.waitingLiveCount }, (_, index) =>
    createCardInstance(live(`PL!SP-test-live-${index}`), PLAYER1, `waiting-live-${index}`)
  );
  let game = createGameState('sp-bp5-111-mao', PLAYER1, 'P1', PLAYER2, 'P2');
  game = registerCards(game, [source, ...energies, ...waitingLives]);
  game = updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, source.instanceId, {
      orientation: OrientationState.ACTIVE,
      face: FaceState.FACE_UP,
    }),
    energyZone: energies.reduce(
      (zone, card) =>
        addCardToStatefulZone(zone, card.instanceId, {
          orientation: OrientationState.ACTIVE,
          face: FaceState.FACE_UP,
        }),
      player.energyZone
    ),
    waitingRoom: waitingLives.reduce(
      (zone, card) => addCardToZone(zone, card.instanceId),
      player.waitingRoom
    ),
  }));
  return {
    game: setMainPhase(game),
    sourceId: source.instanceId,
    energyIds: energies.map((card) => card.instanceId),
    waitingLiveIds: waitingLives.map((card) => card.instanceId),
  };
}

function createSession(game: GameState) {
  const session = createGameSession();
  session.createGame('sp-bp5-111-mao-session', PLAYER1, 'P1', PLAYER2, 'P2');
  (session as unknown as { authorityState: GameState }).authorityState = game;
  return session;
}

function activateMao(session: ReturnType<typeof createGameSession>, sourceId: string) {
  return session.executeCommand(
    createActivateAbilityCommand(
      PLAYER1,
      sourceId,
      SP_BP5_111_ACTIVATED_RETURN_TWO_ENERGY_RECOVER_LIVE_ABILITY_ID
    )
  );
}

function abilityUseCount(game: GameState): number {
  return game.actionHistory.filter(
    (action) =>
      action.type === 'RESOLVE_ABILITY' &&
      action.payload.abilityId ===
        SP_BP5_111_ACTIVATED_RETURN_TWO_ENERGY_RECOVER_LIVE_ABILITY_ID &&
      action.payload.step === 'ABILITY_USE'
  ).length;
}

describe('PL!SP-bp5-111 Mao activated workflow', () => {
  it('returns two energy to energy deck, then recovers one LIVE from waiting room', () => {
    const scenario = setup({ energyCount: 2, waitingLiveCount: 1 });
    const session = createSession(scenario.game);

    expect(activateMao(session, scenario.sourceId).success).toBe(true);
    expect(session.state?.activeEffect?.stepId).toBe('SP_BP5_111_SELECT_TWO_ENERGY_COST');

    expect(
      session.executeCommand(
        createConfirmEffectStepCommand(
          PLAYER1,
          session.state!.activeEffect!.id,
          undefined,
          undefined,
          undefined,
          undefined,
          scenario.energyIds
        )
      ).success
    ).toBe(true);
    expect(session.state?.activeEffect?.stepId).toBe('SP_BP5_111_SELECT_WAITING_ROOM_LIVE');

    expect(
      session.executeCommand(
        createConfirmEffectStepCommand(
          PLAYER1,
          session.state!.activeEffect!.id,
          scenario.waitingLiveIds[0]
        )
      ).success
    ).toBe(true);

    expect(session.state?.players[0].energyZone.cardIds).toEqual([]);
    expect(session.state?.players[0].energyDeck.cardIds).toEqual(scenario.energyIds);
    expect(session.state?.players[0].hand.cardIds).toContain(scenario.waitingLiveIds[0]);
    expect(abilityUseCount(session.state!)).toBe(1);
  });

  it('does not pay or record use when energy or waiting room LIVE target is missing', () => {
    const noEnergy = setup({ energyCount: 1, waitingLiveCount: 1 });
    const noEnergySession = createSession(noEnergy.game);
    expect(activateMao(noEnergySession, noEnergy.sourceId).success).toBe(false);
    expect(noEnergySession.state?.players[0].energyZone.cardIds).toEqual(noEnergy.energyIds);
    expect(abilityUseCount(noEnergySession.state!)).toBe(0);

    const noTarget = setup({ energyCount: 2, waitingLiveCount: 0 });
    const noTargetSession = createSession(noTarget.game);
    expect(activateMao(noTargetSession, noTarget.sourceId).success).toBe(false);
    expect(noTargetSession.state?.players[0].energyZone.cardIds).toEqual(noTarget.energyIds);
    expect(abilityUseCount(noTargetSession.state!)).toBe(0);
  });

  it('does not roll back paid energy when the waiting room LIVE target disappears after payment', () => {
    const scenario = setup({ energyCount: 2, waitingLiveCount: 1 });
    const session = createSession(scenario.game);

    expect(activateMao(session, scenario.sourceId).success).toBe(true);
    expect(
      session.executeCommand(
        createConfirmEffectStepCommand(
          PLAYER1,
          session.state!.activeEffect!.id,
          undefined,
          undefined,
          undefined,
          undefined,
          scenario.energyIds
        )
      ).success
    ).toBe(true);

    const targetGone = updatePlayer(session.state!, PLAYER1, (player) => ({
      ...player,
      waitingRoom: removeCardFromZone(player.waitingRoom, scenario.waitingLiveIds[0]),
    }));
    (session as unknown as { authorityState: GameState }).authorityState = targetGone;

    expect(
      session.executeCommand(
        createConfirmEffectStepCommand(
          PLAYER1,
          session.state!.activeEffect!.id,
          scenario.waitingLiveIds[0]
        )
      ).success
    ).toBe(true);

    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].energyZone.cardIds).toEqual([]);
    expect(session.state?.players[0].energyDeck.cardIds).toEqual(scenario.energyIds);
    expect(session.state?.players[0].hand.cardIds).not.toContain(scenario.waitingLiveIds[0]);
    expect(abilityUseCount(session.state!)).toBe(1);
  });
});
