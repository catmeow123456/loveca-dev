import { describe, expect, it } from 'vitest';
import type {
  EnergyCardData,
  HeartIcon,
  LiveCardData,
  MemberCardData,
} from '../../src/domain/entities/card';
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
} from '../../src/domain/entities/game';
import { placeCardInSlot } from '../../src/domain/entities/zone';
import { GameService } from '../../src/application/game-service';
import { confirmActiveEffectStep } from '../../src/application/card-effect-runner';
import { createConfirmEffectStepCommand } from '../../src/application/game-commands';
import { createGameSession } from '../../src/application/game-session';
import { PL_N_BP3_027_LIVE_SUCCESS_GREEN_SURPLUS_NIJIGASAKI_MEMBER_PLACE_WAITING_ENERGY_ABILITY_ID } from '../../src/application/card-effects/ability-ids';
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

function createLive(cardCode = 'PL!N-bp3-027-L'): LiveCardData {
  return {
    cardCode,
    name: 'La Bella Patria',
    groupNames: ['ラブライブ！虹ヶ咲学園スクールアイドル同好会'],
    cardType: CardType.LIVE,
    score: 2,
    requirements: createHeartRequirement({
      [HeartColor.YELLOW]: 2,
      [HeartColor.GREEN]: 2,
      [HeartColor.RAINBOW]: 1,
    }),
  };
}

function createMember(
  cardCode: string,
  groupName = 'ラブライブ！虹ヶ咲学園スクールアイドル同好会'
): MemberCardData {
  return {
    cardCode,
    name: cardCode,
    groupNames: [groupName],
    cardType: CardType.MEMBER,
    cost: 1,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.GREEN, 1)],
  };
}

function createEnergy(index: number): EnergyCardData {
  return {
    cardCode: `ENERGY-${index}`,
    name: `Energy ${index}`,
    cardType: CardType.ENERGY,
  };
}

function prepareScenario(options: {
  readonly remainingHearts: readonly HeartIcon[];
  readonly liveJudgmentHearts?: readonly HeartIcon[];
  readonly hasNijigasakiStageMember?: boolean;
  readonly energyDeckCount?: number;
  readonly liveCount?: number;
}) {
  const liveCards = Array.from({ length: options.liveCount ?? 1 }, (_, index) =>
    createCardInstance(createLive(), PLAYER1, `la-bella-patria-${index}`)
  );
  const stageMember = createCardInstance(
    createMember(
      options.hasNijigasakiStageMember === false ? 'PL!SP-stage-member' : 'PL!N-stage-member',
      options.hasNijigasakiStageMember === false
        ? 'ラブライブ！スーパースター!!'
        : 'ラブライブ！虹ヶ咲学園スクールアイドル同好会'
    ),
    PLAYER1,
    'stage-member'
  );
  const energies = Array.from({ length: options.energyDeckCount ?? 1 }, (_, index) =>
    createCardInstance(createEnergy(index), PLAYER1, `energy-${index}`)
  );
  let game = createGameState('n-bp3-027-la-bella-patria', PLAYER1, 'P1', PLAYER2, 'P2');
  game = registerCards(game, [...liveCards, stageMember, ...energies]);
  game = updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    liveZone: { ...player.liveZone, cardIds: liveCards.map((live) => live.instanceId) },
    memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, stageMember.instanceId, {
      orientation: OrientationState.ACTIVE,
      face: FaceState.FACE_UP,
    }),
    energyDeck: {
      ...player.energyDeck,
      cardIds: energies.map((energy) => energy.instanceId),
    },
    energyZone: { ...player.energyZone, cardIds: [], cardStates: new Map() },
  }));
  game = {
    ...game,
    currentPhase: GamePhase.LIVE_RESULT_PHASE,
    currentSubPhase: SubPhase.RESULT_FIRST_SUCCESS_EFFECTS,
    firstPlayerIndex: 0,
    activePlayerIndex: 0,
    liveResolution: {
      ...game.liveResolution,
      liveResults: new Map(liveCards.map((live) => [live.instanceId, true])),
      playerScores: new Map([[PLAYER1, 2]]),
      playerRemainingHearts: new Map([[PLAYER1, options.remainingHearts]]),
      playerLiveJudgmentHearts: new Map([
        [PLAYER1, options.liveJudgmentHearts ?? options.remainingHearts],
      ]),
      performingPlayerId: PLAYER1,
    },
  };

  return { game, liveCards, energies };
}

function resolveLiveSuccess(game: ReturnType<typeof prepareScenario>['game']) {
  const result = new GameService().executeCheckTiming(game, [TriggerCondition.ON_LIVE_SUCCESS]);
  expect(result.success).toBe(true);
  return confirmIfConfirmOnly(result.gameState);
}

function confirmIfConfirmOnly(game: GameState): GameState {
  return game.activeEffect?.metadata?.confirmOnlyPendingAbility === true
    ? confirmActiveEffectStep(game, PLAYER1, game.activeEffect.id)
    : game;
}

function abilityActions(game: ReturnType<typeof resolveLiveSuccess>) {
  return game.actionHistory.filter(
    (action) =>
      action.type === 'RESOLVE_ABILITY' &&
      action.payload.abilityId ===
        PL_N_BP3_027_LIVE_SUCCESS_GREEN_SURPLUS_NIJIGASAKI_MEMBER_PLACE_WAITING_ENERGY_ABILITY_ID
  );
}

function resolveTwoCopies(game: ReturnType<typeof prepareScenario>['game']) {
  const result = new GameService().executeCheckTiming(game, [TriggerCondition.ON_LIVE_SUCCESS]);
  expect(result.success).toBe(true);
  const session = createGameSession();
  session.createGame('n-bp3-027-two-copies', PLAYER1, 'P1', PLAYER2, 'P2');
  (session as unknown as { authorityState: typeof game }).authorityState = result.gameState;

  expect(
    session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        session.state!.activeEffect!.id,
        undefined,
        null,
        true
      )
    ).success
  ).toBe(true);

  return session.state!;
}

describe('PL!N-bp3-027-L La Bella Patria', () => {
  it('places one waiting energy with green remaining heart and Nijigasaki stage member', () => {
    const { game, energies } = prepareScenario({
      remainingHearts: [{ color: HeartColor.GREEN, count: 1 }],
      hasNijigasakiStageMember: true,
      energyDeckCount: 2,
    });

    const state = resolveLiveSuccess(game);

    expect(state.players[0].energyZone.cardIds).toEqual([energies[0]!.instanceId]);
    expect(state.players[0].energyZone.cardStates.get(energies[0]!.instanceId)?.orientation).toBe(
      OrientationState.WAITING
    );
    expect(abilityActions(state)[0]?.payload).toMatchObject({
      conditionMet: true,
      remainingGreenHeartCount: 1,
      remainingHeartTotalCount: 1,
      hasNijigasakiStageMember: true,
      placedEnergyCardIds: [energies[0]!.instanceId],
    });
  });

  it('rebalances remaining RAINBOW into green when real green was consumed for Live success', () => {
    const { game, energies } = prepareScenario({
      remainingHearts: [{ color: HeartColor.RAINBOW, count: 1 }],
      liveJudgmentHearts: [
        { color: HeartColor.YELLOW, count: 2 },
        { color: HeartColor.GREEN, count: 2 },
        { color: HeartColor.RAINBOW, count: 2 },
      ],
      hasNijigasakiStageMember: true,
      energyDeckCount: 1,
    });

    const state = resolveLiveSuccess(game);

    expect(state.players[0].energyZone.cardIds).toEqual([energies[0]!.instanceId]);
    expect(state.liveResolution.playerRemainingHearts.get(PLAYER1)).toEqual([
      { color: HeartColor.GREEN, count: 1 },
    ]);
    expect(abilityActions(state)[0]?.payload).toMatchObject({
      conditionMet: true,
      remainingGreenHeartCount: 1,
      remainingHeartTotalCount: 1,
      rebalancedRemainingHeartCount: 1,
      remainingGreenHeartCountBeforeRebalance: 0,
      remainingRainbowHeartCountBeforeRebalance: 1,
      placedEnergyCardIds: [energies[0]!.instanceId],
    });
  });

  it('does not place energy without green remaining heart', () => {
    const { game } = prepareScenario({
      remainingHearts: [{ color: HeartColor.YELLOW, count: 2 }],
      hasNijigasakiStageMember: true,
    });

    const state = resolveLiveSuccess(game);

    expect(state.players[0].energyZone.cardIds).toEqual([]);
    expect(abilityActions(state)[0]?.payload).toMatchObject({
      conditionMet: false,
      remainingGreenHeartCount: 0,
      remainingHeartTotalCount: 2,
    });
  });

  it('does not treat only RAINBOW remaining hearts as green remaining heart', () => {
    const { game } = prepareScenario({
      remainingHearts: [{ color: HeartColor.RAINBOW, count: 3 }],
      liveJudgmentHearts: [
        { color: HeartColor.YELLOW, count: 2 },
        { color: HeartColor.RAINBOW, count: 4 },
      ],
      hasNijigasakiStageMember: true,
    });

    const state = resolveLiveSuccess(game);

    expect(state.players[0].energyZone.cardIds).toEqual([]);
    expect(abilityActions(state)[0]?.payload).toMatchObject({
      conditionMet: false,
      remainingGreenHeartCount: 0,
      remainingHeartTotalCount: 3,
      rebalancedRemainingHeartCount: 0,
    });
  });

  it('does not place energy without a Nijigasaki stage member', () => {
    const { game } = prepareScenario({
      remainingHearts: [{ color: HeartColor.GREEN, count: 1 }],
      hasNijigasakiStageMember: false,
    });

    const state = resolveLiveSuccess(game);

    expect(state.players[0].energyZone.cardIds).toEqual([]);
    expect(abilityActions(state)[0]?.payload).toMatchObject({
      conditionMet: false,
      remainingGreenHeartCount: 1,
      hasNijigasakiStageMember: false,
    });
  });

  it('safely resolves with empty energy deck', () => {
    const { game } = prepareScenario({
      remainingHearts: [{ color: HeartColor.GREEN, count: 1 }],
      hasNijigasakiStageMember: true,
      energyDeckCount: 0,
    });

    const state = resolveLiveSuccess(game);

    expect(state.players[0].energyZone.cardIds).toEqual([]);
    expect(abilityActions(state)[0]?.payload).toMatchObject({
      conditionMet: true,
      placedEnergyCardIds: [],
    });
  });

  it('does not consume green remaining heart when two copies trigger', () => {
    const { game, energies } = prepareScenario({
      remainingHearts: [{ color: HeartColor.GREEN, count: 1 }],
      hasNijigasakiStageMember: true,
      energyDeckCount: 2,
      liveCount: 2,
    });

    const state = resolveTwoCopies(game);
    const actions = abilityActions(state);

    expect(state.players[0].energyZone.cardIds).toEqual([
      energies[0]!.instanceId,
      energies[1]!.instanceId,
    ]);
    expect(actions).toHaveLength(2);
    expect(actions.map((action) => action.payload.remainingGreenHeartCount)).toEqual([1, 1]);
    expect(actions.map((action) => action.payload.conditionMet)).toEqual([true, true]);
  });

  it('rebalances once and lets two copies use the same green remaining heart', () => {
    const { game, energies } = prepareScenario({
      remainingHearts: [{ color: HeartColor.RAINBOW, count: 1 }],
      liveJudgmentHearts: [
        { color: HeartColor.YELLOW, count: 2 },
        { color: HeartColor.GREEN, count: 2 },
        { color: HeartColor.RAINBOW, count: 2 },
      ],
      hasNijigasakiStageMember: true,
      energyDeckCount: 2,
      liveCount: 2,
    });

    const state = resolveTwoCopies(game);
    const actions = abilityActions(state);

    expect(state.players[0].energyZone.cardIds).toEqual([
      energies[0]!.instanceId,
      energies[1]!.instanceId,
    ]);
    expect(state.liveResolution.playerRemainingHearts.get(PLAYER1)).toEqual([
      { color: HeartColor.GREEN, count: 1 },
    ]);
    expect(actions).toHaveLength(2);
    expect(actions.map((action) => action.payload.rebalancedRemainingHeartCount)).toEqual([1, 0]);
    expect(actions.map((action) => action.payload.remainingGreenHeartCount)).toEqual([1, 1]);
    expect(actions.map((action) => action.payload.conditionMet)).toEqual([true, true]);
  });

  it('clears playerRemainingHearts when Live result is finalized', () => {
    const { game } = prepareScenario({
      remainingHearts: [{ color: HeartColor.GREEN, count: 1 }],
      hasNijigasakiStageMember: true,
    });

    const result = new GameService().finalizeLiveResult(game);

    expect(result.success).toBe(true);
    expect(result.gameState.liveResolution.playerRemainingHearts.size).toBe(0);
    expect(result.gameState.liveResolution.playerLiveJudgmentHearts.size).toBe(0);
  });
});
