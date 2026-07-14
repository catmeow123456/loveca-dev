import {
  confirmActiveEffectStepThroughPublicReveal,
  confirmPublicSelectionIfNeeded,
} from '../helpers/public-card-selection-confirmation';
import { describe, expect, it } from 'vitest';
import type { EnergyCardData, LiveCardData, MemberCardData } from '../../src/domain/entities/card';
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
import { createConfirmEffectStepCommand } from '../../src/application/game-commands';
import { GameService } from '../../src/application/game-service';
import { createGameSession } from '../../src/application/game-session';
import {
  confirmActiveEffectStep,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import {
  HS_CL1_011_LIVE_SUCCESS_PAY_ENERGY_RECOVER_MEMBER_OR_HASUNOSORA_LIVE_ABILITY_ID,
  HS_CL1_012_LIVE_SUCCESS_EQUAL_SCORE_REVEALED_CHEER_HIGH_COST_MEMBER_TO_HAND_ABILITY_ID,
} from '../../src/application/card-effects/ability-ids';
import {
  CardType,
  FaceState,
  GamePhase,
  HeartColor,
  OrientationState,
  SubPhase,
  TriggerCondition,
} from '../../src/shared/types/enums';

const PLAYER1 = 'player1';
const PLAYER2 = 'player2';

function createMember(cardCode: string, cost: number, groupName = '蓮ノ空'): MemberCardData {
  return {
    cardCode,
    name: cardCode,
    groupNames: [groupName],
    cardType: CardType.MEMBER,
    cost,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.PINK, 1)],
  };
}

function createLive(cardCode: string, score = 2, groupName = '蓮ノ空'): LiveCardData {
  return {
    cardCode,
    name: cardCode,
    groupNames: [groupName],
    cardType: CardType.LIVE,
    score,
    requirements: createHeartRequirement({ [HeartColor.PINK]: 1 }),
  };
}

function createEnergy(cardCode: string): EnergyCardData {
  return {
    cardCode,
    name: cardCode,
    cardType: CardType.ENERGY,
  };
}

function setupDododoState(options: {
  readonly activeEnergyCount?: number;
  readonly waitingMember?: boolean;
  readonly waitingHasunosoraLive?: boolean;
  readonly liveZoneCount?: number;
} = {}): {
  readonly game: GameState;
  readonly sourceLiveId: string;
  readonly memberTargetId: string;
  readonly hasunosoraLiveTargetId: string;
  readonly energyCardIds: readonly string[];
} {
  const sourceLive = createCardInstance(createLive('PL!HS-cl1-011-CL', 5), PLAYER1, 'dododo');
  const extraLive = createCardInstance(createLive('PL!HS-extra-live', 1), PLAYER1, 'extra-live');
  const memberTarget = createCardInstance(createMember('PL!HS-waiting-member', 4), PLAYER1, 'member-target');
  const hasunosoraLiveTarget = createCardInstance(
    createLive('PL!HS-hasunosora-live', 3),
    PLAYER1,
    'hasunosora-live-target'
  );
  const energyCards = Array.from({ length: 2 }, (_, index) =>
    createCardInstance(createEnergy(`energy-${index}`), PLAYER1, `energy-${index}`)
  );
  const liveZoneCardIds = [sourceLive.instanceId].concat(
    (options.liveZoneCount ?? 2) >= 2 ? [extraLive.instanceId] : []
  );
  const waitingRoomCardIds = [
    ...(options.waitingMember === false ? [] : [memberTarget.instanceId]),
    ...(options.waitingHasunosoraLive === false ? [] : [hasunosoraLiveTarget.instanceId]),
  ];

  let game = createGameState('hs-cl1-011-dododo', PLAYER1, 'P1', PLAYER2, 'P2');
  game = registerCards(game, [
    sourceLive,
    extraLive,
    memberTarget,
    hasunosoraLiveTarget,
    ...energyCards,
  ]);
  game = updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    hand: { ...player.hand, cardIds: [] },
    waitingRoom: { ...player.waitingRoom, cardIds: waitingRoomCardIds },
    liveZone: {
      ...player.liveZone,
      cardIds: liveZoneCardIds,
      cardStates: new Map(
        liveZoneCardIds.map((cardId) => [
          cardId,
          { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP },
        ])
      ),
    },
    energyZone: {
      ...player.energyZone,
      cardIds: energyCards.map((card) => card.instanceId),
      cardStates: new Map(
        energyCards.map((card, index) => [
          card.instanceId,
          {
            orientation:
              index < (options.activeEnergyCount ?? 1)
                ? OrientationState.ACTIVE
                : OrientationState.WAITING,
            face: FaceState.FACE_UP,
          },
        ])
      ),
    },
  }));

  return {
    game,
    sourceLiveId: sourceLive.instanceId,
    memberTargetId: memberTarget.instanceId,
    hasunosoraLiveTargetId: hasunosoraLiveTarget.instanceId,
    energyCardIds: energyCards.map((card) => card.instanceId),
  };
}

function withDododoPending(game: GameState, sourceCardId: string): GameState {
  const pendingAbility: PendingAbilityState = {
    id: `${HS_CL1_011_LIVE_SUCCESS_PAY_ENERGY_RECOVER_MEMBER_OR_HASUNOSORA_LIVE_ABILITY_ID}:pending`,
    abilityId: HS_CL1_011_LIVE_SUCCESS_PAY_ENERGY_RECOVER_MEMBER_OR_HASUNOSORA_LIVE_ABILITY_ID,
    sourceCardId,
    controllerId: PLAYER1,
    mandatory: true,
    timingId: TriggerCondition.ON_LIVE_SUCCESS,
    eventIds: ['live-success'],
  };
  return {
    ...game,
    pendingAbilities: [pendingAbility],
  };
}

function startDododo(game: GameState, sourceLiveId: string): GameState {
  return resolvePendingCardEffects(withDododoPending(game, sourceLiveId)).gameState;
}

function chooseOption(game: GameState, optionId: string): GameState {
  return confirmActiveEffectStepThroughPublicReveal(
    game,
    PLAYER1,
    game.activeEffect!.id,
    undefined,
    undefined,
    undefined,
    optionId
  );
}

function setupEdeliedSession(options: {
  readonly equalScores: boolean;
  readonly includeValidTarget: boolean;
}): {
  readonly session: ReturnType<typeof createGameSession>;
  readonly validTargetId: string;
  readonly lowCostId: string;
  readonly liveCheerId: string;
  readonly opponentTargetId: string;
  readonly historicalTargetId: string;
  readonly leftResolutionZoneId: string;
  readonly notCheerTargetId: string;
} {
  const session = createGameSession();
  session.createGame('hs-cl1-012-edelied', PLAYER1, 'P1', PLAYER2, 'P2');

  const sourceLive = createCardInstance(createLive('PL!HS-cl1-012-CL', 2), PLAYER1, 'edelied');
  const validTarget = createCardInstance(createMember('PL!HS-valid-high-member', 9), PLAYER1, 'valid-high');
  const lowCost = createCardInstance(createMember('PL!HS-low-member', 8), PLAYER1, 'low-cost');
  const liveCheer = createCardInstance(createLive('PL!HS-live-cheer'), PLAYER1, 'live-cheer');
  const opponentTarget = createCardInstance(createMember('PL!HS-opponent-high', 9), PLAYER2, 'opponent-high');
  const historicalTarget = createCardInstance(
    createMember('PL!HS-historical-high', 9),
    PLAYER1,
    'historical-high'
  );
  const leftResolutionZone = createCardInstance(
    createMember('PL!HS-left-zone-high', 9),
    PLAYER1,
    'left-zone-high'
  );
  const notCheerTarget = createCardInstance(
    createMember('PL!HS-not-cheer-high', 9),
    PLAYER1,
    'not-cheer-high'
  );

  let game = registerCards(session.state!, [
    sourceLive,
    validTarget,
    lowCost,
    liveCheer,
    opponentTarget,
    historicalTarget,
    leftResolutionZone,
    notCheerTarget,
  ]);
  const currentResolutionIds = [
    ...(options.includeValidTarget ? [validTarget.instanceId] : []),
    lowCost.instanceId,
    liveCheer.instanceId,
    opponentTarget.instanceId,
    notCheerTarget.instanceId,
  ];
  game = updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    hand: { ...player.hand, cardIds: [] },
    liveZone: {
      ...player.liveZone,
      cardIds: [sourceLive.instanceId],
      cardStates: new Map([
        [
          sourceLive.instanceId,
          { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP },
        ],
      ]),
    },
  }));
  game = {
    ...game,
    currentPhase: GamePhase.LIVE_RESULT_PHASE,
    currentSubPhase: SubPhase.RESULT_FIRST_SUCCESS_EFFECTS,
    firstPlayerIndex: 0,
    activePlayerIndex: 0,
    resolutionZone: {
      ...game.resolutionZone,
      cardIds: currentResolutionIds,
      revealedCardIds: [...currentResolutionIds, leftResolutionZone.instanceId],
    },
    liveResolution: {
      ...game.liveResolution,
      liveResults: new Map([[sourceLive.instanceId, true]]),
      playerScores: new Map([
        [PLAYER1, 5],
        [PLAYER2, options.equalScores ? 5 : 4],
      ]),
      firstPlayerCheerCardIds: [
        ...(options.includeValidTarget ? [validTarget.instanceId] : []),
        lowCost.instanceId,
        liveCheer.instanceId,
        opponentTarget.instanceId,
        historicalTarget.instanceId,
        leftResolutionZone.instanceId,
      ],
      performingPlayerId: PLAYER1,
    },
  };

  const checkResult = new GameService().executeCheckTiming(game, [
    TriggerCondition.ON_LIVE_SUCCESS,
  ]);
  expect(checkResult.success, checkResult.error).toBe(true);
  (session as unknown as { authorityState: GameState }).authorityState = checkResult.gameState;

  return {
    session,
    validTargetId: validTarget.instanceId,
    lowCostId: lowCost.instanceId,
    liveCheerId: liveCheer.instanceId,
    opponentTargetId: opponentTarget.instanceId,
    historicalTargetId: historicalTarget.instanceId,
    leftResolutionZoneId: leftResolutionZone.instanceId,
    notCheerTargetId: notCheerTarget.instanceId,
  };
}

describe('PL!HS-cl1-011-CL Dododo live-success workflow', () => {
  it('declines payment without changing active energy or waiting room', () => {
    const { game, sourceLiveId, memberTargetId, energyCardIds } = setupDododoState();
    let state = startDododo(game, sourceLiveId);

    expect(state.activeEffect?.selectableOptions?.map((option) => option.id)).toEqual(['pay']);

    state = chooseOption(state, 'decline');

    expect(state.activeEffect).toBeNull();
    expect(state.pendingAbilities).toEqual([]);
    expect(state.players[0].waitingRoom.cardIds).toContain(memberTargetId);
    expect(state.players[0].energyZone.cardStates.get(energyCardIds[0])?.orientation).toBe(
      OrientationState.ACTIVE
    );
  });

  it('pays one energy and recovers one member from waiting room', () => {
    const { game, sourceLiveId, memberTargetId, energyCardIds } = setupDododoState();
    let state = startDododo(game, sourceLiveId);

    state = chooseOption(state, 'pay');
    expect(state.activeEffect?.selectableOptions?.map((option) => option.id)).toEqual([
      'recover-member',
      'recover-hasunosora-live',
    ]);

    state = chooseOption(state, 'recover-member');
    expect(state.activeEffect?.selectableCardIds).toEqual([memberTargetId]);

    state = confirmActiveEffectStepThroughPublicReveal(state, PLAYER1, state.activeEffect!.id, memberTargetId);

    expect(state.activeEffect).toBeNull();
    expect(state.players[0].hand.cardIds).toContain(memberTargetId);
    expect(state.players[0].waitingRoom.cardIds).not.toContain(memberTargetId);
    expect(state.players[0].energyZone.cardStates.get(energyCardIds[0])?.orientation).toBe(
      OrientationState.WAITING
    );
    expect(
      state.actionHistory.some(
        (action) => action.type === 'PAY_COST' && action.payload.amount === 1
      )
    ).toBe(true);
  });

  it('opens the Hasunosora Live branch only when liveZone has at least two cards', () => {
    const { game, sourceLiveId, hasunosoraLiveTargetId } = setupDododoState({
      waitingMember: false,
      liveZoneCount: 2,
    });
    let state = startDododo(game, sourceLiveId);

    state = chooseOption(state, 'pay');
    expect(state.activeEffect?.selectableOptions?.map((option) => option.id)).toEqual([
      'recover-hasunosora-live',
    ]);

    state = chooseOption(state, 'recover-hasunosora-live');
    expect(state.activeEffect?.selectableCardIds).toEqual([hasunosoraLiveTargetId]);
    state = confirmActiveEffectStepThroughPublicReveal(state, PLAYER1, state.activeEffect!.id, hasunosoraLiveTargetId);

    expect(state.players[0].hand.cardIds).toContain(hasunosoraLiveTargetId);

    const shortLiveZone = setupDododoState({
      waitingMember: false,
      liveZoneCount: 1,
    });
    const noBranchState = chooseOption(startDododo(shortLiveZone.game, shortLiveZone.sourceLiveId), 'pay');

    expect(noBranchState.activeEffect).toBeNull();
    expect(
      noBranchState.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' && action.payload.step === 'PAY_ENERGY_NO_RECOVERY_TARGET'
      )
    ).toBe(true);
  });

  it('keeps paid cost when no recovery targets remain after payment', () => {
    const { game, sourceLiveId, energyCardIds } = setupDododoState({
      waitingMember: false,
      waitingHasunosoraLive: false,
    });
    let state = startDododo(game, sourceLiveId);

    state = chooseOption(state, 'pay');

    expect(state.activeEffect).toBeNull();
    expect(state.players[0].energyZone.cardStates.get(energyCardIds[0])?.orientation).toBe(
      OrientationState.WAITING
    );
    expect(
      state.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' && action.payload.step === 'PAY_ENERGY_NO_RECOVERY_TARGET'
      )
    ).toBe(true);
  });
});

describe('PL!HS-cl1-012-CL Edelied live-success workflow', () => {
  it('recovers one own current revealed cost 9 or higher member when live scores are equal', () => {
    const {
      session,
      validTargetId,
      lowCostId,
      liveCheerId,
      opponentTargetId,
      historicalTargetId,
      leftResolutionZoneId,
      notCheerTargetId,
    } = setupEdeliedSession({ equalScores: true, includeValidTarget: true });

    expect(session.state?.activeEffect?.abilityId).toBe(
      HS_CL1_012_LIVE_SUCCESS_EQUAL_SCORE_REVEALED_CHEER_HIGH_COST_MEMBER_TO_HAND_ABILITY_ID
    );
    expect(session.state?.activeEffect?.selectableCardIds).toEqual([validTargetId]);
    expect(session.state?.activeEffect?.selectableCardIds).not.toContain(lowCostId);
    expect(session.state?.activeEffect?.selectableCardIds).not.toContain(liveCheerId);
    expect(session.state?.activeEffect?.selectableCardIds).not.toContain(opponentTargetId);
    expect(session.state?.activeEffect?.selectableCardIds).not.toContain(historicalTargetId);
    expect(session.state?.activeEffect?.selectableCardIds).not.toContain(leftResolutionZoneId);
    expect(session.state?.activeEffect?.selectableCardIds).not.toContain(notCheerTargetId);

    const result = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id, validTargetId)
    );

    expect(result.success, result.error).toBe(true);
    confirmPublicSelectionIfNeeded(session);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].hand.cardIds).toEqual([validTargetId]);
    expect(session.state?.resolutionZone.cardIds).not.toContain(validTargetId);
  });

  it('consumes pending without opening an active effect when live scores differ', () => {
    const { session } = setupEdeliedSession({ equalScores: false, includeValidTarget: true });

    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.pendingAbilities).toEqual([]);
    expect(
      session.state?.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId ===
            HS_CL1_012_LIVE_SUCCESS_EQUAL_SCORE_REVEALED_CHEER_HIGH_COST_MEMBER_TO_HAND_ABILITY_ID &&
          action.payload.step === 'CONDITION_NOT_MET'
      )
    ).toBe(true);
  });

  it('consumes pending without opening an active effect when equal scores have no legal target', () => {
    const { session } = setupEdeliedSession({ equalScores: true, includeValidTarget: false });

    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.pendingAbilities).toEqual([]);
    expect(
      session.state?.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId ===
            HS_CL1_012_LIVE_SUCCESS_EQUAL_SCORE_REVEALED_CHEER_HIGH_COST_MEMBER_TO_HAND_ABILITY_ID &&
          action.payload.step === 'NO_REVEALED_CHEER_TARGET'
      )
    ).toBe(true);
  });

  it('does not move a stale selected card that left the resolution zone before confirmation', () => {
    const { session, validTargetId } = setupEdeliedSession({
      equalScores: true,
      includeValidTarget: true,
    });
    const staleState = {
      ...session.state!,
      resolutionZone: {
        ...session.state!.resolutionZone,
        cardIds: session.state!.resolutionZone.cardIds.filter((cardId) => cardId !== validTargetId),
        revealedCardIds: session.state!.resolutionZone.revealedCardIds.filter(
          (cardId) => cardId !== validTargetId
        ),
      },
    };

    const confirmed = confirmActiveEffectStepThroughPublicReveal(
      staleState,
      PLAYER1,
      staleState.activeEffect!.id,
      validTargetId
    );

    expect(confirmed.activeEffect?.abilityId).toBe(
      HS_CL1_012_LIVE_SUCCESS_EQUAL_SCORE_REVEALED_CHEER_HIGH_COST_MEMBER_TO_HAND_ABILITY_ID
    );
    expect(confirmed.players[0].hand.cardIds).toEqual([]);
    expect(confirmed.resolutionZone.cardIds).not.toContain(validTargetId);
  });
});
