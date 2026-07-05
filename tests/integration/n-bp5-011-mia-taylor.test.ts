import { describe, expect, it } from 'vitest';
import type { LiveCardData, MemberCardData } from '../../src/domain/entities/card';
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
import {
  confirmActiveEffectStep,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import { N_BP5_011_ON_ENTER_CHOOSE_DISTINCT_LIVE_RECOVERY_ABILITY_ID } from '../../src/application/card-effects/ability-ids';
import {
  CardType,
  FaceState,
  HeartColor,
  OrientationState,
  SlotPosition,
  TriggerCondition,
} from '../../src/shared/types/enums';

const PLAYER1 = 'player1';
const PLAYER2 = 'player2';

function createMember(): MemberCardData {
  return {
    cardCode: 'PL!N-bp5-011-R',
    name: 'ミア・テイラー',
    groupNames: ['虹ヶ咲'],
    cardType: CardType.MEMBER,
    cost: 11,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.YELLOW, 1)],
  };
}

function createLive(name: string, groupNames: readonly string[]): LiveCardData {
  return {
    cardCode: `LIVE-${name}-${groupNames.join('-')}`,
    name,
    groupNames,
    cardType: CardType.LIVE,
    score: 1,
    requirements: createHeartRequirement({ [HeartColor.PINK]: 1 }),
  };
}

function setupMiaOnEnter(options: {
  readonly waitingLives: readonly LiveCardData[];
  readonly secondPending?: boolean;
}) {
  const source = createCardInstance(createMember(), PLAYER1, 'n-bp5-011-source');
  const secondSource = createCardInstance(createMember(), PLAYER1, 'n-bp5-011-source-2');
  const waitingLives = options.waitingLives.map((data, index) =>
    createCardInstance(data, PLAYER1, `waiting-live-${index}`)
  );
  const illegalLive = createCardInstance(
    createLive('Illegal Live', ['Aqours']),
    PLAYER2,
    'opponent-illegal-live'
  );
  let game = createGameState('n-bp5-011-mia', PLAYER1, 'P1', PLAYER2, 'P2');
  game = registerCards(game, [source, secondSource, illegalLive, ...waitingLives]);
  game = updatePlayer(game, PLAYER1, (player) => {
    let memberSlots = placeCardInSlot(player.memberSlots, SlotPosition.CENTER, source.instanceId, {
      orientation: OrientationState.ACTIVE,
      face: FaceState.FACE_UP,
    });
    if (options.secondPending) {
      memberSlots = placeCardInSlot(memberSlots, SlotPosition.RIGHT, secondSource.instanceId, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      });
    }
    return {
      ...player,
      memberSlots,
      waitingRoom: {
        ...player.waitingRoom,
        cardIds: waitingLives.map((card) => card.instanceId),
      },
    };
  });
  game = {
    ...game,
    pendingAbilities: [
      createPending(source.instanceId, SlotPosition.CENTER, '1'),
      ...(options.secondPending
        ? [createPending(secondSource.instanceId, SlotPosition.RIGHT, '2')]
        : []),
    ],
  };
  return { game, source, secondSource, waitingLives, illegalLive };
}

function createPending(sourceCardId: string, sourceSlot: SlotPosition, suffix: string) {
  return {
    id: `n-bp5-011-on-enter-${suffix}`,
    abilityId: N_BP5_011_ON_ENTER_CHOOSE_DISTINCT_LIVE_RECOVERY_ABILITY_ID,
    sourceCardId,
    controllerId: PLAYER1,
    mandatory: true,
    timingId: TriggerCondition.ON_ENTER_STAGE,
    eventIds: [`enter-${suffix}`],
    sourceSlot,
  };
}

function chooseMode(game: GameState, selectedOptionId: string): GameState {
  return confirmActiveEffectStep(
    game,
    PLAYER1,
    game.activeEffect!.id,
    null,
    null,
    false,
    selectedOptionId
  );
}

function recoverCards(game: GameState, selectedCardIds: readonly string[]): GameState {
  return confirmActiveEffectStep(
    game,
    PLAYER1,
    game.activeEffect!.id,
    selectedCardIds[0] ?? null,
    null,
    false,
    null,
    selectedCardIds
  );
}

describe('PL!N-bp5-011 Mia Taylor on-enter distinct LIVE recovery workflow', () => {
  it('shows both recovery modes when both distinct-name and distinct-group conditions are met', () => {
    const { game, waitingLives } = setupMiaOnEnter({
      waitingLives: [
        createLive('Live A', ['虹ヶ咲']),
        createLive('Live B', ['Aqours']),
        createLive('Live C', ['Liella!']),
      ],
    });
    let state = resolvePendingCardEffects(game).gameState;

    expect(state.activeEffect?.selectableOptions?.map((option) => option.id)).toEqual([
      'recover-one-different-name-live',
      'recover-two-different-group-live',
    ]);

    state = chooseMode(state, 'recover-two-different-group-live');
    expect(state.activeEffect?.minSelectableCards).toBe(2);
    expect(state.activeEffect?.maxSelectableCards).toBe(2);

    state = recoverCards(state, [waitingLives[0]!.instanceId, waitingLives[1]!.instanceId]);
    expect(state.activeEffect).toBeNull();
    expect(state.pendingAbilities).toEqual([]);
    expect(state.players[0]!.hand.cardIds).toEqual([
      waitingLives[0]!.instanceId,
      waitingLives[1]!.instanceId,
    ]);
  });

  it('only shows the one-card mode when only the distinct-name condition is met', () => {
    const { game } = setupMiaOnEnter({
      waitingLives: [
        createLive('Live A', ['虹ヶ咲']),
        createLive('Live B', ['虹ヶ咲']),
        createLive('Live C', ['虹ヶ咲']),
      ],
    });
    const state = resolvePendingCardEffects(game).gameState;

    expect(state.activeEffect?.selectableOptions?.map((option) => option.id)).toEqual([
      'recover-one-different-name-live',
    ]);
  });

  it('only shows the two-card mode when only the distinct-group condition is met', () => {
    const { game } = setupMiaOnEnter({
      waitingLives: [
        createLive('Same Live', ['虹ヶ咲']),
        createLive('Same Live', ['Aqours']),
        createLive('Same Live', ['Liella!']),
      ],
    });
    const state = resolvePendingCardEffects(game).gameState;

    expect(state.activeEffect?.selectableOptions?.map((option) => option.id)).toEqual([
      'recover-two-different-group-live',
    ]);
  });

  it('consumes the pending ability as no-op when neither condition is met', () => {
    const { game } = setupMiaOnEnter({
      waitingLives: [createLive('Live A', ['虹ヶ咲']), createLive('Live B', ['Aqours'])],
    });
    const state = resolvePendingCardEffects(game).gameState;

    expect(state.activeEffect).toBeNull();
    expect(state.pendingAbilities).toEqual([]);
    expect(
      state.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId === N_BP5_011_ON_ENTER_CHOOSE_DISTINCT_LIVE_RECOVERY_ABILITY_ID &&
          action.payload.step === 'NO_DISTINCT_LIVE_RECOVERY_MODE'
      )
    ).toBe(true);
  });

  it('rejects an illegal recovery target and keeps the recovery window open', () => {
    const { game, illegalLive } = setupMiaOnEnter({
      waitingLives: [
        createLive('Live A', ['虹ヶ咲']),
        createLive('Live B', ['Aqours']),
        createLive('Live C', ['Liella!']),
      ],
    });
    let state = resolvePendingCardEffects(game).gameState;
    state = chooseMode(state, 'recover-one-different-name-live');
    const effectId = state.activeEffect!.id;

    const result = recoverCards(state, [illegalLive.instanceId]);

    expect(result.activeEffect?.id).toBe(effectId);
    expect(result.players[0]!.hand.cardIds).toEqual([]);
  });

  it('continues to the next pending ability after resolving the selected recovery', () => {
    const { game, waitingLives } = setupMiaOnEnter({
      waitingLives: [
        createLive('Live A', ['虹ヶ咲']),
        createLive('Live B', ['Aqours']),
        createLive('Live C', ['Liella!']),
      ],
      secondPending: true,
    });
    let state = resolvePendingCardEffects(game).gameState;
    expect(state.activeEffect?.abilityId).toBe('system:select-pending-card-effect');
    state = confirmActiveEffectStep(state, PLAYER1, state.activeEffect!.id, null, null, true);
    state = chooseMode(state, 'recover-one-different-name-live');
    state = recoverCards(state, [waitingLives[0]!.instanceId]);
    const resolveActions = state.actionHistory.filter(
      (action) =>
        action.type === 'RESOLVE_ABILITY' &&
        action.payload.abilityId === N_BP5_011_ON_ENTER_CHOOSE_DISTINCT_LIVE_RECOVERY_ABILITY_ID
    );

    expect(state.pendingAbilities).toEqual([]);
    expect(state.activeEffect).toBeNull();
    expect(resolveActions.map((action) => action.payload.step)).toContain(
      'RECOVER_DISTINCT_LIVE_FROM_WAITING_ROOM'
    );
    expect(resolveActions.map((action) => action.payload.step)).toContain(
      'NO_DISTINCT_LIVE_RECOVERY_MODE'
    );
  });
});
