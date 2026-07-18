import { describe, expect, it } from 'vitest';
import type { EnergyCardData, LiveCardData, MemberCardData } from '../../src/domain/entities/card';
import {
  createCardInstance,
  createHeartIcon,
  createHeartRequirement,
} from '../../src/domain/entities/card';
import {
  createGameState,
  emitGameEvent,
  registerCards,
  updatePlayer,
  type GameState,
} from '../../src/domain/entities/game';
import {
  addCardToStatefulZone,
  placeCardInSlot,
  removeCardFromStatefulZone,
} from '../../src/domain/entities/zone';
import { GameService } from '../../src/application/game-service';
import { confirmActiveEffectStep } from '../../src/application/card-effect-runner';
import {
  MEMBER_ON_ENTER_ACTIVATE_TWO_WAITING_ENERGY_ABILITY_ID,
  PL_BP4_004_ON_ENTER_SUCCESS_SCORE_SIX_ACTIVATE_TWO_ENERGY_ABILITY_ID,
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
    groupNames: cardCode.startsWith('PL!HS')
      ? ['蓮ノ空女学院スクールアイドルクラブ']
      : ['虹ヶ咲学園スクールアイドル同好会'],
    cardType: CardType.MEMBER,
    cost,
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

function createLive(cardCode: string, score: number): LiveCardData {
  return {
    cardCode,
    name: cardCode,
    groupNames: ["μ's"],
    cardType: CardType.LIVE,
    score,
    requirements: createHeartRequirement({ [HeartColor.PURPLE]: 1 }),
  };
}

function setupOnEnterEnergyScenario(options: {
  readonly sourceCardCode: string;
  readonly sourceName: string;
  readonly sourceCost: number;
  readonly energyOrientations: readonly OrientationState[];
  readonly successLiveScores?: readonly number[];
  readonly nonLivePrintedScore?: number;
}): { readonly game: GameState; readonly energyCardIds: readonly string[] } {
  const source = createCardInstance(
    createMember(options.sourceCardCode, options.sourceName, options.sourceCost),
    PLAYER1,
    'source'
  );
  const energyCards = options.energyOrientations.map((_, index) =>
    createCardInstance(createEnergy(`ENERGY-${index}`), PLAYER1, `energy-${index}`)
  );
  const successLiveCards = (options.successLiveScores ?? []).map((score, index) =>
    createCardInstance(createLive(`SUCCESS-LIVE-${index}`, score), PLAYER1, `success-live-${index}`)
  );
  const nonLiveSuccessCard =
    options.nonLivePrintedScore === undefined
      ? null
      : createCardInstance(
          {
            ...createMember('NON-LIVE-IN-SUCCESS', 'Non LIVE', 1),
            score: options.nonLivePrintedScore,
          } as MemberCardData & { readonly score: number },
          PLAYER1,
          'non-live-success'
        );
  let game = createGameState('on-enter-activate-waiting-energy', PLAYER1, 'P1', PLAYER2, 'P2');
  game = registerCards(game, [
    source,
    ...energyCards,
    ...successLiveCards,
    ...(nonLiveSuccessCard ? [nonLiveSuccessCard] : []),
  ]);
  game = updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    energyZone: energyCards.reduce(
      (zone, card, index) =>
        addCardToStatefulZone(zone, card.instanceId, {
          orientation: options.energyOrientations[index],
          face: FaceState.FACE_UP,
        }),
      player.energyZone
    ),
    successZone: {
      ...player.successZone,
      cardIds: [
        ...successLiveCards.map((card) => card.instanceId),
        ...(nonLiveSuccessCard ? [nonLiveSuccessCard.instanceId] : []),
      ],
    },
    memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, source.instanceId, {
      orientation: OrientationState.ACTIVE,
      face: FaceState.FACE_UP,
    }),
  }));
  game = emitGameEvent(game, {
    eventId: `enter-${options.sourceCardCode}`,
    eventType: TriggerCondition.ON_ENTER_STAGE,
    timestamp: Date.now(),
    cardInstanceId: source.instanceId,
    fromZone: ZoneType.HAND,
    toZone: ZoneType.MEMBER_SLOT,
    toSlot: SlotPosition.CENTER,
    ownerId: PLAYER1,
    controllerId: PLAYER1,
  });
  return { game, energyCardIds: energyCards.map((card) => card.instanceId) };
}

function markSpecialEnergy(game: GameState, energyCardId: string): GameState {
  return {
    ...game,
    energyActivePhaseSkips: [
      {
        playerId: PLAYER1,
        energyCardId,
        sourceCardId: 'marker-source',
        abilityId: 'marker-ability',
      },
    ],
  };
}

function confirmEnergySelection(game: GameState, selectedEnergyCardIds: readonly string[]): GameState {
  return confirmActiveEffectStep(
    game,
    PLAYER1,
    game.activeEffect!.id,
    undefined,
    undefined,
    undefined,
    undefined,
    selectedEnergyCardIds
  );
}

function resolveOnEnter(game: GameState): GameState {
  const result = new GameService().executeCheckTiming(game, [TriggerCondition.ON_ENTER_STAGE]);
  expect(result.success, result.error).toBe(true);
  return result.gameState;
}

describe('shared on-enter activate waiting energy workflow', () => {
  it.each([
    ['PL!HS-bp1-001-R', '日野下花帆', 11],
    ['PL!N-sd1-008-SD', 'エマ・ヴェルデ', 7],
  ] as const)(
    'activates two waiting energy cards for %s',
    (sourceCardCode, sourceName, sourceCost) => {
      const scenario = setupOnEnterEnergyScenario({
        sourceCardCode,
        sourceName,
        sourceCost,
        energyOrientations: [
          OrientationState.WAITING,
          OrientationState.WAITING,
          OrientationState.ACTIVE,
        ],
      });

      const state = resolveOnEnter(scenario.game);

      expect(
        scenario.energyCardIds.map(
          (cardId) => state.players[0].energyZone.cardStates.get(cardId)?.orientation
        )
      ).toEqual([OrientationState.ACTIVE, OrientationState.ACTIVE, OrientationState.ACTIVE]);
      expect(
        state.actionHistory.some(
          (action) =>
            action.type === 'RESOLVE_ABILITY' &&
            action.payload.abilityId === MEMBER_ON_ENTER_ACTIVATE_TWO_WAITING_ENERGY_ABILITY_ID &&
            action.payload.activatedEnergyCardIds?.length === 2
        )
      ).toBe(true);
      expect(state.pendingAbilities).toEqual([]);
    }
  );

  it('activates only one energy when only one is waiting', () => {
    const scenario = setupOnEnterEnergyScenario({
      sourceCardCode: 'PL!HS-bp1-001-P',
      sourceName: '日野下花帆',
      sourceCost: 11,
      energyOrientations: [OrientationState.ACTIVE, OrientationState.WAITING],
    });

    const state = resolveOnEnter(scenario.game);

    expect(
      scenario.energyCardIds.map(
        (cardId) => state.players[0].energyZone.cardStates.get(cardId)?.orientation
      )
    ).toEqual([OrientationState.ACTIVE, OrientationState.ACTIVE]);
    expect(
      state.actionHistory.find(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId === MEMBER_ON_ENTER_ACTIVATE_TWO_WAITING_ENERGY_ABILITY_ID
      )?.payload.activatedEnergyCardIds
    ).toEqual([scenario.energyCardIds[1]]);
  });

  it('selects exact waiting energy when the candidates include a special energy', () => {
    const scenario = setupOnEnterEnergyScenario({
      sourceCardCode: 'PL!HS-bp1-001-R',
      sourceName: '日野下花帆',
      sourceCost: 11,
      energyOrientations: [
        OrientationState.WAITING,
        OrientationState.WAITING,
        OrientationState.WAITING,
      ],
    });
    const marked: GameState = {
      ...scenario.game,
      energyActivePhaseSkips: [
        {
          playerId: PLAYER1,
          energyCardId: scenario.energyCardIds[2]!,
          sourceCardId: 'marker-source',
          abilityId: 'marker-ability',
        },
      ],
    };
    const selecting = resolveOnEnter(marked);
    expect(selecting.activeEffect?.stepId).toBe('COMMON_ENERGY_OPERATION_SELECTION');
    const resolved = confirmActiveEffectStep(
      selecting,
      PLAYER1,
      selecting.activeEffect!.id,
      undefined,
      undefined,
      undefined,
      undefined,
      [scenario.energyCardIds[0]!, scenario.energyCardIds[2]!]
    );
    expect(
      scenario.energyCardIds.map(
        (cardId) => resolved.players[0].energyZone.cardStates.get(cardId)?.orientation
      )
    ).toEqual([OrientationState.ACTIVE, OrientationState.WAITING, OrientationState.ACTIVE]);
  });

  it('consumes the pending ability when no energy is waiting', () => {
    const scenario = setupOnEnterEnergyScenario({
      sourceCardCode: 'PL!N-sd1-008-RM',
      sourceName: 'エマ・ヴェルデ',
      sourceCost: 7,
      energyOrientations: [OrientationState.ACTIVE],
    });

    const state = resolveOnEnter(scenario.game);

    expect(state.players[0].energyZone.cardStates.get(scenario.energyCardIds[0])?.orientation).toBe(
      OrientationState.ACTIVE
    );
    expect(
      state.actionHistory.find(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId === MEMBER_ON_ENTER_ACTIVATE_TWO_WAITING_ENERGY_ABILITY_ID
      )?.payload.activatedEnergyCardIds
    ).toEqual([]);
    expect(state.pendingAbilities).toEqual([]);
  });

  it('PL!-bp4-004 consumes pending without opening selection at success LIVE score 5', () => {
    const scenario = setupOnEnterEnergyScenario({
      sourceCardCode: 'PL!-bp4-004-P',
      sourceName: '園田海未',
      sourceCost: 2,
      energyOrientations: [OrientationState.WAITING, OrientationState.WAITING],
      successLiveScores: [2, 3],
    });
    const state = resolveOnEnter(scenario.game);
    expect(state.activeEffect).toBeNull();
    expect(state.pendingAbilities).toEqual([]);
    expect(
      scenario.energyCardIds.map(
        (cardId) => state.players[0].energyZone.cardStates.get(cardId)?.orientation
      )
    ).toEqual([OrientationState.WAITING, OrientationState.WAITING]);
    expect(state.actionHistory.at(-1)?.payload).toMatchObject({
      abilityId: PL_BP4_004_ON_ENTER_SUCCESS_SCORE_SIX_ACTIVATE_TWO_ENERGY_ABILITY_ID,
      step: 'SUCCESS_LIVE_SCORE_CONDITION_NOT_MET',
      successLiveScore: 5,
      requiredSuccessLiveScore: 6,
    });
  });

  it.each([
    ['PL!-bp4-004-P', 0],
    ['PL!-bp4-004-R', 1],
    ['PL!-bp4-004-P', 2],
  ] as const)('PL!-bp4-004 %s resolves exactly %i available waiting energy', (cardCode, count) => {
    const scenario = setupOnEnterEnergyScenario({
      sourceCardCode: cardCode,
      sourceName: '園田海未',
      sourceCost: 2,
      energyOrientations: Array.from({ length: count }, () => OrientationState.WAITING),
      successLiveScores: [6],
    });
    const state = resolveOnEnter(scenario.game);
    expect(state.pendingAbilities).toEqual([]);
    expect(state.actionHistory.at(-1)?.payload).toMatchObject({
      abilityId: PL_BP4_004_ON_ENTER_SUCCESS_SCORE_SIX_ACTIVATE_TWO_ENERGY_ABILITY_ID,
      step: 'ON_ENTER_SUCCESS_LIVE_SCORE_SIX_ACTIVATE_TWO_ENERGY',
      successLiveScore: 6,
      requestedActivationCount: 2,
      activatedEnergyCardIds: scenario.energyCardIds,
    });
  });

  it('PL!-bp4-004 ignores a non-LIVE card mixed into the success zone', () => {
    const scenario = setupOnEnterEnergyScenario({
      sourceCardCode: 'PL!-bp4-004-P',
      sourceName: '園田海未',
      sourceCost: 2,
      energyOrientations: [OrientationState.WAITING],
      successLiveScores: [5],
      nonLivePrintedScore: 99,
    });
    const state = resolveOnEnter(scenario.game);
    expect(state.players[0].energyZone.cardStates.get(scenario.energyCardIds[0])?.orientation).toBe(
      OrientationState.WAITING
    );
    expect(state.actionHistory.at(-1)?.payload).toMatchObject({
      step: 'SUCCESS_LIVE_SCORE_CONDITION_NOT_MET',
      successLiveScore: 5,
    });
  });

  it('PL!-bp4-004 automatically activates the first two ordinary waiting candidates in stable order', () => {
    const scenario = setupOnEnterEnergyScenario({
      sourceCardCode: 'PL!-bp4-004-R',
      sourceName: '園田海未',
      sourceCost: 2,
      energyOrientations: [
        OrientationState.WAITING,
        OrientationState.ACTIVE,
        OrientationState.WAITING,
        OrientationState.WAITING,
      ],
      successLiveScores: [3, 3],
    });
    const state = resolveOnEnter(scenario.game);
    expect(state.actionHistory.at(-1)?.payload.activatedEnergyCardIds).toEqual([
      scenario.energyCardIds[0],
      scenario.energyCardIds[2],
    ]);
    expect(
      scenario.energyCardIds.map(
        (cardId) => state.players[0].energyZone.cardStates.get(cardId)?.orientation
      )
    ).toEqual([
      OrientationState.ACTIVE,
      OrientationState.ACTIVE,
      OrientationState.ACTIVE,
      OrientationState.WAITING,
    ]);
  });

  it('PL!-bp4-004 opens the common exact selection for excess candidates with a special marker', () => {
    const scenario = setupOnEnterEnergyScenario({
      sourceCardCode: 'PL!-bp4-004-P',
      sourceName: '園田海未',
      sourceCost: 2,
      energyOrientations: [
        OrientationState.WAITING,
        OrientationState.WAITING,
        OrientationState.WAITING,
      ],
      successLiveScores: [6],
    });
    const selecting = resolveOnEnter(markSpecialEnergy(scenario.game, scenario.energyCardIds[2]!));
    expect(selecting.activeEffect).toMatchObject({
      abilityId: PL_BP4_004_ON_ENTER_SUCCESS_SCORE_SIX_ACTIVATE_TWO_ENERGY_ABILITY_ID,
      stepId: 'COMMON_ENERGY_OPERATION_SELECTION',
      selectableCardIds: scenario.energyCardIds,
      minSelectableCards: 2,
      maxSelectableCards: 2,
      canSkipSelection: false,
    });

    const resolved = confirmEnergySelection(selecting, [
      scenario.energyCardIds[0]!,
      scenario.energyCardIds[2]!,
    ]);
    expect(resolved.activeEffect).toBeNull();
    expect(resolved.pendingAbilities).toEqual([]);
    expect(
      resolved.actionHistory.filter(
        (action) =>
          action.payload.abilityId ===
            PL_BP4_004_ON_ENTER_SUCCESS_SCORE_SIX_ACTIVATE_TWO_ENERGY_ABILITY_ID &&
          action.payload.step === 'ON_ENTER_SUCCESS_LIVE_SCORE_SIX_ACTIVATE_TWO_ENERGY'
      )
    ).toHaveLength(1);
    expect(resolved.actionHistory.at(-1)?.payload.activatedEnergyCardIds).toEqual([
      scenario.energyCardIds[0],
      scenario.energyCardIds[2],
    ]);
  });

  it.each([
    ['duplicate', (ids: readonly string[], sourceId: string) => [ids[0]!, ids[0]!]],
    ['non-candidate', (_ids: readonly string[], sourceId: string) => [_ids[0]!, sourceId]],
  ] as const)('PL!-bp4-004 rejects %s energy ids without advancing', (_label, selectIds) => {
    const scenario = setupOnEnterEnergyScenario({
      sourceCardCode: 'PL!-bp4-004-R',
      sourceName: '園田海未',
      sourceCost: 2,
      energyOrientations: [
        OrientationState.WAITING,
        OrientationState.WAITING,
        OrientationState.WAITING,
      ],
      successLiveScores: [6],
    });
    const selecting = resolveOnEnter(markSpecialEnergy(scenario.game, scenario.energyCardIds[2]!));
    const rejected = confirmEnergySelection(
      selecting,
      selectIds(scenario.energyCardIds, selecting.activeEffect!.sourceCardId)
    );
    expect(rejected.activeEffect?.stepId).toBe('COMMON_ENERGY_OPERATION_SELECTION');
    expect(rejected.pendingAbilities).toHaveLength(1);
    expect(
      scenario.energyCardIds.map(
        (cardId) => rejected.players[0].energyZone.cardStates.get(cardId)?.orientation
      )
    ).toEqual([
      OrientationState.WAITING,
      OrientationState.WAITING,
      OrientationState.WAITING,
    ]);
  });

  it('PL!-bp4-004 rejects a stale energyCardId without advancing', () => {
    const scenario = setupOnEnterEnergyScenario({
      sourceCardCode: 'PL!-bp4-004-P',
      sourceName: '園田海未',
      sourceCost: 2,
      energyOrientations: [
        OrientationState.WAITING,
        OrientationState.WAITING,
        OrientationState.WAITING,
      ],
      successLiveScores: [6],
    });
    const selecting = resolveOnEnter(markSpecialEnergy(scenario.game, scenario.energyCardIds[2]!));
    const stale = updatePlayer(selecting, PLAYER1, (player) => ({
      ...player,
      energyZone: removeCardFromStatefulZone(player.energyZone, scenario.energyCardIds[0]!),
    }));
    const rejected = confirmEnergySelection(stale, [
      scenario.energyCardIds[0]!,
      scenario.energyCardIds[2]!,
    ]);
    expect(rejected).toBe(stale);
    expect(rejected.activeEffect?.stepId).toBe('COMMON_ENERGY_OPERATION_SELECTION');
    expect(rejected.pendingAbilities).toHaveLength(1);
    expect(
      rejected.actionHistory.some(
        (action) =>
          action.payload.abilityId ===
            PL_BP4_004_ON_ENTER_SUCCESS_SCORE_SIX_ACTIVATE_TWO_ENERGY_ABILITY_ID &&
          action.payload.step === 'ON_ENTER_SUCCESS_LIVE_SCORE_SIX_ACTIVATE_TWO_ENERGY'
      )
    ).toBe(false);

    const resolved = confirmEnergySelection(rejected, [
      scenario.energyCardIds[1]!,
      scenario.energyCardIds[2]!,
    ]);
    expect(resolved.activeEffect).toBeNull();
    expect(resolved.pendingAbilities).toHaveLength(0);
    expect(
      [scenario.energyCardIds[1]!, scenario.energyCardIds[2]!].map(
        (cardId) => resolved.players[0].energyZone.cardStates.get(cardId)?.orientation
      )
    ).toEqual([OrientationState.ACTIVE, OrientationState.ACTIVE]);
  });
});
