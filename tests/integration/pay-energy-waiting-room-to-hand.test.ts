import { describe, expect, it } from 'vitest';
import type {
  AnyCardData,
  EnergyCardData,
  LiveCardData,
  MemberCardData,
} from '../../src/domain/entities/card';
import {
  createCardInstance,
  createHeartIcon,
  createHeartRequirement,
} from '../../src/domain/entities/card';
import { registerCards, updatePlayer, type GameState } from '../../src/domain/entities/game';
import {
  createActivateAbilityCommand,
  createConfirmEffectStepCommand,
} from '../../src/application/game-commands';
import { createGameSession } from '../../src/application/game-session';
import type { DeckConfig } from '../../src/application/game-service';
import { HS_BP2_001_ACTIVATED_PAY_TWO_ENERGY_RECOVER_LOW_SCORE_HASUNOSORA_LIVE_ABILITY_ID } from '../../src/application/card-effects/ability-ids';
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

function createMember(
  cardCode: string,
  groupNames = ['蓮ノ空女学院スクールアイドルクラブ']
): MemberCardData {
  return {
    cardCode,
    name: cardCode,
    groupNames,
    cardType: CardType.MEMBER,
    cost: 13,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.PINK, 1)],
  };
}

function createLive(cardCode: string, score: number, groupNames: readonly string[]): LiveCardData {
  return {
    cardCode,
    name: cardCode,
    groupNames: [...groupNames],
    cardType: CardType.LIVE,
    score,
    requirements: createHeartRequirement({ [HeartColor.PINK]: 1 }),
  };
}

function createEnergy(cardCode: string): EnergyCardData {
  return { cardCode, name: cardCode, cardType: CardType.ENERGY };
}

function createDeck(): DeckConfig {
  return {
    mainDeck: Array.from({ length: 20 }, (_, index) =>
      createMember(`FILLER-M-${index}`)
    ) as AnyCardData[],
    energyDeck: Array.from({ length: 12 }, (_, index) => createEnergy(`FILLER-E-${index}`)),
  };
}

function setupScenario(options: {
  readonly sourceCardCode?: string;
  readonly waitingRoomCards: readonly ReturnType<typeof createCardInstance>[];
  readonly energyCount: number;
  readonly activeEnergyCount?: number;
}) {
  const session = createGameSession();
  const deck = createDeck();
  session.createGame('hs-bp2-001-pay-energy-recovery', PLAYER1, 'P1', PLAYER2, 'P2');
  session.initializeGame(deck, deck);

  const source = createCardInstance(
    createMember(options.sourceCardCode ?? 'PL!HS-bp2-001-R'),
    PLAYER1,
    'source'
  );
  const energyCards = Array.from({ length: options.energyCount }, (_, index) =>
    createCardInstance(createEnergy(`ENERGY-${index}`), PLAYER1, `energy-${index}`)
  );
  let state = registerCards(session.state!, [source, ...energyCards, ...options.waitingRoomCards]);
  state = updatePlayer(state, PLAYER1, (player) => ({
    ...player,
    waitingRoom: {
      ...player.waitingRoom,
      cardIds: options.waitingRoomCards.map((card) => card.instanceId),
    },
    energyZone: {
      ...player.energyZone,
      cardIds: energyCards.map((card) => card.instanceId),
      cardStates: new Map(
        energyCards.map((card, index) => [
          card.instanceId,
          {
            orientation:
              index < (options.activeEnergyCount ?? options.energyCount)
                ? OrientationState.ACTIVE
                : OrientationState.WAITING,
            face: FaceState.FACE_UP,
          },
        ])
      ),
    },
    memberSlots: {
      ...player.memberSlots,
      slots: {
        [SlotPosition.LEFT]: null,
        [SlotPosition.CENTER]: source.instanceId,
        [SlotPosition.RIGHT]: null,
      },
      cardStates: new Map([
        [source.instanceId, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
      ]),
    },
  }));
  state = {
    ...state,
    currentPhase: GamePhase.MAIN_PHASE,
    currentSubPhase: SubPhase.NONE,
    currentTurnType: TurnType.NORMAL,
    activePlayerIndex: 0,
    waitingPlayerId: null,
  };
  (session as unknown as { authorityState: GameState }).authorityState = state;

  return {
    session,
    sourceId: source.instanceId,
    energyCardIds: energyCards.map((card) => card.instanceId),
  };
}

function activate(scenario: ReturnType<typeof setupScenario>) {
  return scenario.session.executeCommand(
    createActivateAbilityCommand(
      PLAYER1,
      scenario.sourceId,
      HS_BP2_001_ACTIVATED_PAY_TWO_ENERGY_RECOVER_LOW_SCORE_HASUNOSORA_LIVE_ABILITY_ID
    )
  );
}

describe('pay-energy waiting-room-to-hand shared workflow', () => {
  it.each(['PL!HS-bp2-001-R', 'PL!HS-bp2-001-P'])(
    '%s pays two active energy and recovers only a score-three-or-less Hasunosora LIVE',
    (sourceCardCode) => {
      const eligible = createCardInstance(
        createLive('HASU-LOW-LIVE', 3, ['蓮ノ空女学院スクールアイドルクラブ']),
        PLAYER1,
        'eligible'
      );
      const highScore = createCardInstance(
        createLive('HASU-HIGH-LIVE', 4, ['蓮ノ空女学院スクールアイドルクラブ']),
        PLAYER1,
        'high-score'
      );
      const otherGroup = createCardInstance(
        createLive('OTHER-LOW-LIVE', 2, ['Aqours']),
        PLAYER1,
        'other-group'
      );
      const member = createCardInstance(createMember('HASU-MEMBER'), PLAYER1, 'member');
      const scenario = setupScenario({
        sourceCardCode,
        waitingRoomCards: [eligible, highScore, otherGroup, member],
        energyCount: 2,
      });

      const activateResult = activate(scenario);
      expect(activateResult.success, activateResult.error).toBe(true);
      expect(scenario.session.state?.activeEffect?.selectableCardIds).toEqual([
        eligible.instanceId,
      ]);
      expect(scenario.session.state?.activeEffect?.canSkipSelection).toBe(false);
      expect(
        scenario.energyCardIds.every(
          (cardId) =>
            scenario.session.state?.players[0].energyZone.cardStates.get(cardId)?.orientation ===
            OrientationState.WAITING
        )
      ).toBe(true);

      const confirmResult = scenario.session.executeCommand(
        createConfirmEffectStepCommand(
          PLAYER1,
          scenario.session.state!.activeEffect!.id,
          eligible.instanceId
        )
      );
      expect(confirmResult.success, confirmResult.error).toBe(true);
      expect(
        scenario.session.executeCommand(
          createConfirmEffectStepCommand(
            PLAYER1,
            scenario.session.state!.activeEffect!.id
          )
        ).success
      ).toBe(true);
      expect(scenario.session.state?.players[0].hand.cardIds).toContain(eligible.instanceId);
      expect(scenario.session.state?.players[0].waitingRoom.cardIds).toEqual([
        highScore.instanceId,
        otherGroup.instanceId,
        member.instanceId,
      ]);
    }
  );

  it('does not pay energy or consume the turn limit when no legal target exists', () => {
    const highScore = createCardInstance(
      createLive('HASU-HIGH-LIVE', 4, ['蓮ノ空女学院スクールアイドルクラブ']),
      PLAYER1,
      'high-score'
    );
    const scenario = setupScenario({ waitingRoomCards: [highScore], energyCount: 2 });

    const result = activate(scenario);
    expect(result.success).toBe(false);
    expect(scenario.session.state?.activeEffect).toBeNull();
    expect(
      scenario.energyCardIds.every(
        (cardId) =>
          scenario.session.state?.players[0].energyZone.cardStates.get(cardId)?.orientation ===
          OrientationState.ACTIVE
      )
    ).toBe(true);
    expect(
      scenario.session.state?.actionHistory.some(
        (action) =>
          action.payload.abilityId ===
            HS_BP2_001_ACTIVATED_PAY_TWO_ENERGY_RECOVER_LOW_SCORE_HASUNOSORA_LIVE_ABILITY_ID &&
          action.payload.step === 'ABILITY_USE'
      )
    ).toBe(false);
  });

  it('does not partially pay or consume the turn limit with fewer than two active energy', () => {
    const eligible = createCardInstance(
      createLive('HASU-LOW-LIVE', 3, ['蓮ノ空女学院スクールアイドルクラブ']),
      PLAYER1,
      'eligible'
    );
    const scenario = setupScenario({
      waitingRoomCards: [eligible],
      energyCount: 2,
      activeEnergyCount: 1,
    });

    const result = activate(scenario);
    expect(result.success).toBe(false);
    expect(scenario.session.state?.activeEffect).toBeNull();
    expect(
      scenario.session.state?.players[0].energyZone.cardStates.get(scenario.energyCardIds[0]!)
        ?.orientation
    ).toBe(OrientationState.ACTIVE);
    expect(
      scenario.session.state?.actionHistory.some(
        (action) =>
          action.payload.abilityId ===
            HS_BP2_001_ACTIVATED_PAY_TWO_ENERGY_RECOVER_LOW_SCORE_HASUNOSORA_LIVE_ABILITY_ID &&
          action.payload.step === 'ABILITY_USE'
      )
    ).toBe(false);
  });

  it('enforces once per turn after a successful recovery', () => {
    const first = createCardInstance(
      createLive('HASU-LOW-LIVE-1', 1, ['蓮ノ空女学院スクールアイドルクラブ']),
      PLAYER1,
      'first'
    );
    const second = createCardInstance(
      createLive('HASU-LOW-LIVE-2', 2, ['蓮ノ空女学院スクールアイドルクラブ']),
      PLAYER1,
      'second'
    );
    const scenario = setupScenario({
      waitingRoomCards: [first, second],
      energyCount: 4,
    });

    expect(activate(scenario).success).toBe(true);
    expect(
      scenario.session.executeCommand(
        createConfirmEffectStepCommand(
          PLAYER1,
          scenario.session.state!.activeEffect!.id,
          first.instanceId
        )
      ).success
    ).toBe(true);
    expect(
      scenario.session.executeCommand(
        createConfirmEffectStepCommand(PLAYER1, scenario.session.state!.activeEffect!.id)
      ).success
    ).toBe(true);

    const secondActivation = activate(scenario);
    expect(secondActivation.success).toBe(false);
    expect(secondActivation.error).toContain('本回合已发动 1/1 次');
  });

  it('rejects illegal and stale selections without moving another card', () => {
    const eligible = createCardInstance(
      createLive('HASU-LOW-LIVE', 3, ['蓮ノ空女学院スクールアイドルクラブ']),
      PLAYER1,
      'eligible'
    );
    const illegal = createCardInstance(
      createLive('OTHER-LOW-LIVE', 2, ['Aqours']),
      PLAYER1,
      'illegal'
    );
    const scenario = setupScenario({
      waitingRoomCards: [eligible, illegal],
      energyCount: 2,
    });
    expect(activate(scenario).success).toBe(true);
    const effectId = scenario.session.state!.activeEffect!.id;

    const illegalResult = scenario.session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, effectId, illegal.instanceId)
    );
    expect(illegalResult.success).toBe(false);
    expect(scenario.session.state?.players[0].hand.cardIds).not.toContain(illegal.instanceId);

    const player = scenario.session.state!.players[0] as unknown as {
      waitingRoom: { cardIds: string[] };
    };
    player.waitingRoom.cardIds = [illegal.instanceId];
    const staleResult = scenario.session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, effectId, eligible.instanceId)
    );
    expect(staleResult.success).toBe(false);
    expect(scenario.session.state?.players[0].hand.cardIds).not.toContain(eligible.instanceId);
    expect(scenario.session.state?.players[0].waitingRoom.cardIds).toEqual([illegal.instanceId]);
  });
});
