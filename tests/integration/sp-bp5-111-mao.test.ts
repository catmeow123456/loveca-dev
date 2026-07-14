import { confirmPublicSelectionIfNeeded } from '../helpers/public-card-selection-confirmation';
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
  TriggerCondition,
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

function setup(options: {
  readonly energyCount: number;
  readonly waitingLiveCount: number;
  readonly markedEnergyIndices?: readonly number[];
}) {
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
  const markedEnergyIndices = options.markedEnergyIndices ?? [];
  return {
    game: {
      ...setMainPhase(game),
      energyActivePhaseSkips: markedEnergyIndices.map((index) => ({
        playerId: PLAYER1,
        energyCardId: energies[index]!.instanceId,
        sourceCardId: 'marker-source',
        abilityId: 'marker-ability',
      })),
    },
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
    confirmPublicSelectionIfNeeded(session);
    expect(session.state?.players[0].hand.cardIds).toContain(scenario.waitingLiveIds[0]);
    expect(abilityUseCount(session.state!)).toBe(1);
  });

  it.each([
    {
      label: '普通与特殊混合',
      markedEnergyIndices: [2],
      selectedIndices: [0, 2],
    },
    {
      label: '候选全部为特殊能量',
      markedEnergyIndices: [0, 1, 2, 3],
      selectedIndices: [1, 3],
    },
  ])('$label时通过公共窗口返回明确选择的2张能量', ({
    markedEnergyIndices,
    selectedIndices,
  }) => {
    const scenario = setup({
      energyCount: 4,
      waitingLiveCount: 1,
      markedEnergyIndices,
    });
    const session = createSession(scenario.game);

    expect(activateMao(session, scenario.sourceId).success).toBe(true);
    expect(session.state?.activeEffect?.stepId).toBe('COMMON_ENERGY_OPERATION_SELECTION');
    expect(session.state?.players[0].energyDeck.cardIds).toEqual([]);
    const selectedEnergyIds = selectedIndices.map((index) => scenario.energyIds[index]!);
    expect(
      session.executeCommand(
        createConfirmEffectStepCommand(
          PLAYER1,
          session.state!.activeEffect!.id,
          undefined,
          undefined,
          undefined,
          undefined,
          selectedEnergyIds
        )
      ).success
    ).toBe(true);

    expect(session.state?.activeEffect?.stepId).toBe('SP_BP5_111_SELECT_WAITING_ROOM_LIVE');
    expect(session.state?.players[0].energyDeck.cardIds).toEqual(selectedEnergyIds);
    expect(session.state?.players[0].energyZone.cardIds).toEqual(
      scenario.energyIds.filter((cardId) => !selectedEnergyIds.includes(cardId))
    );
    const movedEvents = session.state!.eventLog
      .map((entry) => entry.event)
      .filter((event) => event.eventType === TriggerCondition.ON_ENERGY_MOVED_TO_DECK);
    expect(movedEvents).toHaveLength(1);
    expect(movedEvents[0]).toMatchObject({ movedEnergyCardIds: selectedEnergyIds });
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
    expect(session.state?.activeEffect?.stepId).toBe('SP_BP5_111_SELECT_WAITING_ROOM_LIVE');

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
