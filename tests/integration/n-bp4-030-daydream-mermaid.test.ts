import { describe, expect, it } from 'vitest';
import type {
  EnergyCardData,
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
  type PendingAbilityState,
} from '../../src/domain/entities/game';
import { createConfirmEffectStepCommand } from '../../src/application/game-commands';
import { createGameSession } from '../../src/application/game-session';
import { resolvePendingCardEffects } from '../../src/application/card-effect-runner';
import { PL_N_BP4_030_LIVE_SUCCESS_CHOOSE_ENERGY_OR_MEMBER_RECOVERY_ABILITY_ID } from '../../src/application/card-effects/ability-ids';
import {
  CardType,
  GamePhase,
  HeartColor,
  OrientationState,
  SubPhase,
  TriggerCondition,
} from '../../src/shared/types/enums';

const PLAYER1 = 'player1';
const PLAYER2 = 'player2';

const ENERGY_OPTION_ID = 'energy';
const MEMBER_RECOVERY_OPTION_ID = 'member-recovery';
const ENERGY_AND_MEMBER_RECOVERY_OPTION_ID = 'energy-and-member-recovery';

function createLive(
  cardCode: string,
  options: {
    readonly name?: string;
    readonly groupNames?: readonly string[];
  } = {}
): LiveCardData {
  return {
    cardCode,
    name: options.name ?? cardCode,
    groupNames: options.groupNames ?? ['ラブライブ！虹ヶ咲学園スクールアイドル同好会'],
    cardType: CardType.LIVE,
    score: 3,
    requirements: createHeartRequirement({
      [HeartColor.BLUE]: 3,
      [HeartColor.RAINBOW]: 4,
    }),
  };
}

function createMember(cardCode: string): MemberCardData {
  return {
    cardCode,
    name: cardCode,
    groupNames: ['ラブライブ！虹ヶ咲学園スクールアイドル同好会'],
    cardType: CardType.MEMBER,
    cost: 1,
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

interface DaydreamScenario {
  readonly game: GameState;
  readonly sourceId: string;
  readonly energyCardIds: readonly string[];
  readonly waitingMemberId: string | null;
}

function setupScenario(
  options: {
    readonly sourceInLiveZone?: boolean;
    readonly energyDeckCount?: number;
    readonly hasWaitingMember?: boolean;
    readonly successZone?: 'none' | 'nijigasaki' | 'other';
  } = {}
): DaydreamScenario {
  const source = createCardInstance(
    createLive('PL!N-bp4-030-L', { name: 'Daydream Mermaid' }),
    PLAYER1,
    'daydream-mermaid'
  );
  const energyCards = Array.from({ length: options.energyDeckCount ?? 1 }, (_, index) =>
    createCardInstance(createEnergy(`ENERGY-${index}`), PLAYER1, `energy-${index}`)
  );
  const waitingMember =
    options.hasWaitingMember === false
      ? null
      : createCardInstance(createMember('PL!N-waiting-member'), PLAYER1, 'waiting-member');
  const successLive =
    options.successZone === 'nijigasaki'
      ? createCardInstance(
          createLive('PL!N-success-live', {
            name: 'Nijigasaki Success',
            groupNames: ['ラブライブ！虹ヶ咲学園スクールアイドル同好会'],
          }),
          PLAYER1,
          'success-nijigasaki'
        )
      : options.successZone === 'other'
        ? createCardInstance(
            createLive('PL!SP-success-live', {
              name: 'Liella Success',
              groupNames: ['ラブライブ！スーパースター!!'],
            }),
            PLAYER1,
            'success-other'
          )
        : null;

  let game = createGameState('n-bp4-030-daydream-mermaid', PLAYER1, 'P1', PLAYER2, 'P2');
  game = registerCards(game, [
    source,
    ...energyCards,
    ...(waitingMember ? [waitingMember] : []),
    ...(successLive ? [successLive] : []),
  ]);

  const sourceInLiveZone = options.sourceInLiveZone !== false;
  game = updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    liveZone: {
      ...player.liveZone,
      cardIds: sourceInLiveZone ? [source.instanceId] : [],
    },
    successZone: {
      ...player.successZone,
      cardIds: successLive ? [successLive.instanceId] : [],
    },
    waitingRoom: {
      ...player.waitingRoom,
      cardIds: [
        ...(waitingMember ? [waitingMember.instanceId] : []),
        ...(!sourceInLiveZone ? [source.instanceId] : []),
      ],
    },
    hand: {
      ...player.hand,
      cardIds: [],
    },
    energyDeck: {
      ...player.energyDeck,
      cardIds: energyCards.map((card) => card.instanceId),
    },
    energyZone: {
      ...player.energyZone,
      cardIds: [],
      cardStates: new Map(),
    },
  }));

  game = {
    ...game,
    currentPhase: GamePhase.LIVE_RESULT_PHASE,
    currentSubPhase: SubPhase.RESULT_FIRST_SUCCESS_EFFECTS,
    firstPlayerIndex: 0,
    activePlayerIndex: 0,
    liveResolution: {
      ...game.liveResolution,
      liveResults: new Map([[source.instanceId, true]]),
      performingPlayerId: PLAYER1,
    },
    pendingAbilities: [pendingAbility(source.instanceId)],
  };

  return {
    game,
    sourceId: source.instanceId,
    energyCardIds: energyCards.map((card) => card.instanceId),
    waitingMemberId: waitingMember?.instanceId ?? null,
  };
}

function pendingAbility(sourceCardId: string): PendingAbilityState {
  return {
    id: `${PL_N_BP4_030_LIVE_SUCCESS_CHOOSE_ENERGY_OR_MEMBER_RECOVERY_ABILITY_ID}:${sourceCardId}:test`,
    abilityId: PL_N_BP4_030_LIVE_SUCCESS_CHOOSE_ENERGY_OR_MEMBER_RECOVERY_ABILITY_ID,
    sourceCardId,
    controllerId: PLAYER1,
    mandatory: true,
    timingId: TriggerCondition.ON_LIVE_SUCCESS,
    eventIds: [],
  };
}

function startPending(game: GameState) {
  const result = resolvePendingCardEffects(game);
  const session = createGameSession();
  session.createGame('n-bp4-030-daydream-mermaid', PLAYER1, 'P1', PLAYER2, 'P2');
  (session as unknown as { authorityState: GameState }).authorityState = result.gameState;
  return session;
}

function confirmOption(session: ReturnType<typeof createGameSession>, optionId: string): void {
  const effectId = session.state!.activeEffect!.id;
  const result = session.executeCommand(
    createConfirmEffectStepCommand(PLAYER1, effectId, undefined, undefined, undefined, optionId)
  );
  expect(result.success).toBe(true);
}

function confirmCard(session: ReturnType<typeof createGameSession>, cardId: string): void {
  const effectId = session.state!.activeEffect!.id;
  const result = session.executeCommand(createConfirmEffectStepCommand(PLAYER1, effectId, cardId));
  expect(result.success).toBe(true);
}

function optionIds(session: ReturnType<typeof createGameSession>): readonly string[] {
  return session.state!.activeEffect?.selectableOptions?.map((option) => option.id) ?? [];
}

function abilityActions(game: GameState) {
  return game.actionHistory.filter(
    (action) =>
      action.type === 'RESOLVE_ABILITY' &&
      action.payload.abilityId ===
        PL_N_BP4_030_LIVE_SUCCESS_CHOOSE_ENERGY_OR_MEMBER_RECOVERY_ABILITY_ID
  );
}

describe('PL!N-bp4-030-L Daydream Mermaid', () => {
  it('chooses waiting energy without a Nijigasaki success-zone card', () => {
    const scenario = setupScenario({ successZone: 'none', energyDeckCount: 1 });
    const session = startPending(scenario.game);

    expect(optionIds(session)).toEqual([ENERGY_OPTION_ID, MEMBER_RECOVERY_OPTION_ID]);

    confirmOption(session, ENERGY_OPTION_ID);

    const state = session.state!;
    expect(state.activeEffect).toBeNull();
    expect(state.pendingAbilities).toHaveLength(0);
    expect(state.players[0].energyZone.cardIds).toEqual([scenario.energyCardIds[0]]);
    expect(state.players[0].energyZone.cardStates.get(scenario.energyCardIds[0]!)?.orientation).toBe(
      OrientationState.WAITING
    );
    expect(state.players[0].waitingRoom.cardIds).toContain(scenario.waitingMemberId);
  });

  it('chooses one waiting-room member without a Nijigasaki success-zone card', () => {
    const scenario = setupScenario({ successZone: 'none', energyDeckCount: 1 });
    const session = startPending(scenario.game);

    confirmOption(session, MEMBER_RECOVERY_OPTION_ID);
    expect(session.state?.activeEffect?.selectableCardIds).toEqual([scenario.waitingMemberId]);

    confirmCard(session, scenario.waitingMemberId!);

    const state = session.state!;
    expect(state.activeEffect).toBeNull();
    expect(state.players[0].hand.cardIds).toEqual([scenario.waitingMemberId]);
    expect(state.players[0].waitingRoom.cardIds).not.toContain(scenario.waitingMemberId);
    expect(state.players[0].energyZone.cardIds).toEqual([]);
  });

  it('can choose both legal options with a Nijigasaki success-zone card', () => {
    const scenario = setupScenario({ successZone: 'nijigasaki', energyDeckCount: 1 });
    const session = startPending(scenario.game);

    expect(optionIds(session)).toEqual([
      ENERGY_OPTION_ID,
      MEMBER_RECOVERY_OPTION_ID,
      ENERGY_AND_MEMBER_RECOVERY_OPTION_ID,
    ]);

    confirmOption(session, ENERGY_AND_MEMBER_RECOVERY_OPTION_ID);
    expect(session.state?.players[0].energyZone.cardIds).toEqual([scenario.energyCardIds[0]]);
    expect(session.state?.activeEffect?.selectableCardIds).toEqual([scenario.waitingMemberId]);

    confirmCard(session, scenario.waitingMemberId!);

    const state = session.state!;
    expect(state.players[0].hand.cardIds).toEqual([scenario.waitingMemberId]);
    expect(state.players[0].energyZone.cardStates.get(scenario.energyCardIds[0]!)?.orientation).toBe(
      OrientationState.WAITING
    );
    expect(
      abilityActions(state).map((action) => action.payload.step)
    ).toEqual(['PLACE_WAITING_ENERGY', 'RECOVER_WAITING_ROOM_MEMBER', 'FINISH']);
  });

  it('does not offer the multi-option choice with only a non-Nijigasaki success-zone card', () => {
    const scenario = setupScenario({ successZone: 'other', energyDeckCount: 1 });
    const session = startPending(scenario.game);

    expect(optionIds(session)).toEqual([ENERGY_OPTION_ID, MEMBER_RECOVERY_OPTION_ID]);

    const effectId = session.state!.activeEffect!.id;
    const result = session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        effectId,
        undefined,
        undefined,
        undefined,
        ENERGY_AND_MEMBER_RECOVERY_OPTION_ID
      )
    );

    expect(result.success).toBe(false);
    expect(session.state?.activeEffect?.stepId).toBe('PL_N_BP4_030_SELECT_LIVE_SUCCESS_OPTION');
    expect(session.state?.players[0].energyZone.cardIds).toEqual([]);
    expect(session.state?.players[0].hand.cardIds).toEqual([]);
    expect(session.state?.players[0].waitingRoom.cardIds).toContain(scenario.waitingMemberId);
  });

  it('safely consumes the pending ability when there are no legal options', () => {
    const scenario = setupScenario({
      successZone: 'nijigasaki',
      energyDeckCount: 0,
      hasWaitingMember: false,
    });
    const session = startPending(scenario.game);

    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.pendingAbilities).toHaveLength(0);
    expect(abilityActions(session.state!)[0]?.payload).toMatchObject({
      step: 'NO_LEGAL_OPTIONS',
      selectedOptionIds: [],
      placedEnergyCardIds: [],
      movedCardIds: [],
    });
  });

  it('does not resolve when the source is no longer in the live zone', () => {
    const scenario = setupScenario({
      sourceInLiveZone: false,
      successZone: 'nijigasaki',
      energyDeckCount: 1,
    });
    const session = startPending(scenario.game);

    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.pendingAbilities).toHaveLength(0);
    expect(session.state?.players[0].energyZone.cardIds).toEqual([]);
    expect(session.state?.players[0].hand.cardIds).toEqual([]);
    expect(abilityActions(session.state!)[0]?.payload).toMatchObject({
      step: 'SOURCE_NOT_IN_LIVE_ZONE',
      selectedOptionIds: [],
      placedEnergyCardIds: [],
      movedCardIds: [],
    });
  });
});
