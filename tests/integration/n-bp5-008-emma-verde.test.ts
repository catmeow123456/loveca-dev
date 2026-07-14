import { describe, expect, it } from 'vitest';
import type { EnergyCardData, MemberCardData } from '../../src/domain/entities/card';
import { createCardInstance, createHeartIcon } from '../../src/domain/entities/card';
import {
  registerCards,
  updatePlayer,
  type GameState,
} from '../../src/domain/entities/game';
import { placeCardInSlot } from '../../src/domain/entities/zone';
import { createActivateAbilityCommand } from '../../src/application/game-commands';
import { createGameSession } from '../../src/application/game-session';
import { N_BP5_008_ACTIVATED_STACK_ENERGY_BELOW_ACTIVATE_TWO_ENERGY_ABILITY_ID } from '../../src/application/card-effects/ability-ids';
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

function createMember(cardCode = 'PL!N-bp5-008-R'): MemberCardData {
  return {
    cardCode,
    name: 'エマ・ヴェルデ',
    groupNames: ['虹ヶ咲'],
    cardType: CardType.MEMBER,
    cost: 10,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.GREEN, 1)],
  };
}

function createEnergy(cardCode: string): EnergyCardData {
  return {
    cardCode,
    name: cardCode,
    cardType: CardType.ENERGY,
  };
}

function setupEmmaScenario(options: {
  readonly energyOrientations: readonly OrientationState[];
  readonly currentPhase?: GamePhase;
  readonly activePlayerIndex?: number;
  readonly sourceCardCode?: string;
}) {
  const session = createGameSession();
  session.createGame('n-bp5-008-emma-verde', PLAYER1, 'P1', PLAYER2, 'P2');
  const source = createCardInstance(
    createMember(options.sourceCardCode),
    PLAYER1,
    'n-bp5-008-emma-source'
  );
  const energyCards = options.energyOrientations.map((_, index) =>
    createCardInstance(createEnergy(`EMMA-ENERGY-${index}`), PLAYER1, `emma-energy-${index}`)
  );
  let game = registerCards(session.state!, [source, ...energyCards]);
  game = {
    ...game,
    currentPhase: options.currentPhase ?? GamePhase.MAIN_PHASE,
    currentSubPhase: SubPhase.NONE,
    currentTurnType: TurnType.NORMAL,
    activePlayerIndex: options.activePlayerIndex ?? 0,
    waitingPlayerId: null,
  };
  game = updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, source.instanceId, {
      orientation: OrientationState.ACTIVE,
      face: FaceState.FACE_UP,
    }),
    energyZone: {
      ...player.energyZone,
      cardIds: energyCards.map((card) => card.instanceId),
      cardStates: new Map(
        energyCards.map((card, index) => [
          card.instanceId,
          {
            orientation: options.energyOrientations[index]!,
            face: FaceState.FACE_UP,
          },
        ])
      ),
    },
  }));
  (session as unknown as { authorityState: GameState }).authorityState = game;
  return { session, source, energyCards };
}

function activateEmma(session: ReturnType<typeof createGameSession>) {
  return session.executeCommand(
    createActivateAbilityCommand(
      PLAYER1,
      'n-bp5-008-emma-source',
      N_BP5_008_ACTIVATED_STACK_ENERGY_BELOW_ACTIVATE_TWO_ENERGY_ABILITY_ID
    )
  );
}

function abilityUseCount(game: GameState): number {
  return game.actionHistory.filter(
    (action) =>
      action.type === 'RESOLVE_ABILITY' &&
      action.payload.abilityId ===
        N_BP5_008_ACTIVATED_STACK_ENERGY_BELOW_ACTIVATE_TWO_ENERGY_ABILITY_ID &&
      action.payload.step === 'ABILITY_USE'
  ).length;
}

describe('PL!N-bp5-008 Emma Verde activated energy workflow', () => {
  it('stacks one energy below this member as cost and activates two waiting energy', () => {
    const scenario = setupEmmaScenario({
      energyOrientations: [
        OrientationState.ACTIVE,
        OrientationState.WAITING,
        OrientationState.WAITING,
      ],
    });

    const result = activateEmma(scenario.session);
    expect(result.success, result.error).toBe(true);

    const player = scenario.session.state!.players[0]!;
    expect(player.energyZone.cardIds).toEqual([
      scenario.energyCards[0]!.instanceId,
      scenario.energyCards[2]!.instanceId,
    ]);
    expect(player.memberSlots.energyBelow[SlotPosition.CENTER]).toEqual([
      scenario.energyCards[1]!.instanceId,
    ]);
    expect(
      [scenario.energyCards[0]!, scenario.energyCards[2]!].map(
        (card) => player.energyZone.cardStates.get(card.instanceId)?.orientation
      )
    ).toEqual([OrientationState.ACTIVE, OrientationState.ACTIVE]);
    expect(abilityUseCount(scenario.session.state!)).toBe(1);
    expect(
      scenario.session.state?.actionHistory.find(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.step === 'STACK_ENERGY_BELOW_ACTIVATE_TWO_ENERGY'
      )?.payload.activatedEnergyCardIds
    ).toEqual([scenario.energyCards[2]!.instanceId]);
  });

  it('keeps the paid cost and activates only available waiting energy', () => {
    const scenario = setupEmmaScenario({
      energyOrientations: [OrientationState.ACTIVE, OrientationState.WAITING],
    });

    const result = activateEmma(scenario.session);
    expect(result.success, result.error).toBe(true);

    const player = scenario.session.state!.players[0]!;
    expect(player.memberSlots.energyBelow[SlotPosition.CENTER]).toEqual([
      scenario.energyCards[1]!.instanceId,
    ]);
    expect(player.energyZone.cardStates.get(scenario.energyCards[0]!.instanceId)?.orientation).toBe(
      OrientationState.ACTIVE
    );
    expect(
      scenario.session.state?.actionHistory.find(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.step === 'STACK_ENERGY_BELOW_ACTIVATE_TWO_ENERGY'
      )?.payload.activatedEnergyCardIds
    ).toEqual([]);
  });

  it('does not activate or record turn use without energy, outside main phase, or for a non-current player', () => {
    for (const options of [
      { energyOrientations: [] },
      { energyOrientations: [OrientationState.ACTIVE], currentPhase: GamePhase.LIVE_SET_PHASE },
      { energyOrientations: [OrientationState.ACTIVE], activePlayerIndex: 1 },
    ] as const) {
      const scenario = setupEmmaScenario(options);
      const result = activateEmma(scenario.session);

      expect(result.success).toBe(false);
      expect(scenario.session.state?.activeEffect).toBeNull();
      expect(abilityUseCount(scenario.session.state!)).toBe(0);
      expect(
        scenario.session.state?.players[0].memberSlots.energyBelow[SlotPosition.CENTER]
      ).toEqual([]);
    }
  });
});
