import { describe, expect, it } from 'vitest';
import { confirmPublicSelectionIfNeeded } from '../helpers/public-card-selection-confirmation';
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
  emitGameEvent,
  registerCards,
  updatePlayer,
  type GameState,
} from '../../src/domain/entities/game';
import { addCardToStatefulZone, placeCardInSlot } from '../../src/domain/entities/zone';
import { createEnterStageEvent } from '../../src/domain/events/game-events';
import { createConfirmEffectStepCommand } from '../../src/application/game-commands';
import { createGameSession, type GameSession } from '../../src/application/game-session';
import {
  enqueueTriggeredCardEffects,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import { HS_CL1_002_ON_ENTER_PAY_ENERGY_RECOVER_DOLLCHESTRA_CARD_ABILITY_ID } from '../../src/application/card-effects/ability-ids';
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

type CardInstance = ReturnType<typeof createCardInstance>;

function createSayaka(): MemberCardData {
  return {
    cardCode: 'PL!HS-cl1-002-CL',
    name: '村野さやか',
    groupNames: ['蓮ノ空女学院スクールアイドルクラブ'],
    unitName: 'DOLLCHESTRA',
    cardType: CardType.MEMBER,
    cost: 5,
    blade: 2,
    hearts: [createHeartIcon(HeartColor.PINK, 1), createHeartIcon(HeartColor.BLUE, 1)],
  };
}

function createDollchestraMember(cardCode: string): MemberCardData {
  return {
    cardCode,
    name: cardCode,
    groupNames: ['蓮ノ空女学院スクールアイドルクラブ'],
    unitName: 'DOLLCHESTRA',
    cardType: CardType.MEMBER,
    cost: 4,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.BLUE, 1)],
  };
}

function createDollchestraLive(cardCode: string): LiveCardData {
  return {
    cardCode,
    name: cardCode,
    groupNames: ['蓮ノ空女学院スクールアイドルクラブ'],
    unitName: 'DOLLCHESTRA',
    cardType: CardType.LIVE,
    score: 3,
    requirements: createHeartRequirement({ [HeartColor.BLUE]: 1 }),
  };
}

function createNonDollchestraMember(cardCode: string): MemberCardData {
  return {
    cardCode,
    name: cardCode,
    groupNames: ['蓮ノ空女学院スクールアイドルクラブ'],
    unitName: 'Mira-Cra Park!',
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

function setupOnEnter(options: {
  readonly activeEnergyCount: number;
  readonly waitingCards: readonly CardInstance[];
  readonly sourceOnStage?: boolean;
}): {
  readonly session: GameSession;
  readonly source: CardInstance;
  readonly energyIds: readonly string[];
} {
  const session = createGameSession();
  session.createGame('hs-cl1-002-sayaka', PLAYER1, 'P1', PLAYER2, 'P2');

  const source = createCardInstance(createSayaka(), PLAYER1, 'sayaka-source');
  const energyCards = Array.from({ length: Math.max(options.activeEnergyCount, 0) }, (_, index) =>
    createCardInstance(createEnergy(`PL!HS-test-energy-${index}`), PLAYER1, `energy-${index}`)
  );
  let game = createGameState('hs-cl1-002-sayaka-state', PLAYER1, 'P1', PLAYER2, 'P2');
  game = registerCards(game, [source, ...energyCards, ...options.waitingCards]);
  game = updatePlayer(game, PLAYER1, (player) => {
    let energyZone = player.energyZone;
    for (const energy of energyCards) {
      energyZone = addCardToStatefulZone(energyZone, energy.instanceId, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      });
    }
    return {
      ...player,
      energyZone,
      waitingRoom: {
        ...player.waitingRoom,
        cardIds: options.waitingCards.map((card) => card.instanceId),
      },
      memberSlots:
        options.sourceOnStage === false
          ? player.memberSlots
          : placeCardInSlot(player.memberSlots, SlotPosition.CENTER, source.instanceId, {
              orientation: OrientationState.ACTIVE,
              face: FaceState.FACE_UP,
            }),
    };
  });
  game = emitGameEvent(
    game,
    createEnterStageEvent(source.instanceId, ZoneType.HAND, SlotPosition.CENTER, PLAYER1, PLAYER1)
  );

  const stateWithPending = enqueueTriggeredCardEffects(game, [TriggerCondition.ON_ENTER_STAGE]);
  const resolved = resolvePendingCardEffects(stateWithPending).gameState;
  (session as unknown as { authorityState: GameState }).authorityState = resolved;

  return {
    session,
    source,
    energyIds: energyCards.map((card) => card.instanceId),
  };
}

function confirmOption(session: GameSession, selectedOptionId: string | null): void {
  const activeEffect = session.state!.activeEffect!;
  const result = session.executeCommand(
    createConfirmEffectStepCommand(
      PLAYER1,
      activeEffect.id,
      null,
      null,
      undefined,
      selectedOptionId
    )
  );
  expect(result.success).toBe(true);
}

function confirmCard(session: GameSession, selectedCardId: string): void {
  const activeEffect = session.state!.activeEffect!;
  const result = session.executeCommand(
    createConfirmEffectStepCommand(PLAYER1, activeEffect.id, selectedCardId)
  );
  expect(result.success).toBe(true);
  confirmPublicSelectionIfNeeded(session);
}

function hasPayCostAction(state: GameState): boolean {
  return state.actionHistory.some(
    (action) =>
      action.type === 'PAY_COST' &&
      action.payload.abilityId ===
        HS_CL1_002_ON_ENTER_PAY_ENERGY_RECOVER_DOLLCHESTRA_CARD_ABILITY_ID
  );
}

describe('PL!HS-cl1-002-CL Sayaka workflow', () => {
  it('opens an optional pay-energy window when active energy and DOLLCHESTRA targets exist', () => {
    const target = createCardInstance(
      createDollchestraMember('PL!HS-test-dollchestra-member'),
      PLAYER1,
      'target-member'
    );
    const { session, energyIds } = setupOnEnter({
      activeEnergyCount: 1,
      waitingCards: [target],
    });

    expect(session.state?.activeEffect).toMatchObject({
      abilityId: HS_CL1_002_ON_ENTER_PAY_ENERGY_RECOVER_DOLLCHESTRA_CARD_ABILITY_ID,
      stepId: 'HS_CL1_002_PAY_ENERGY_FOR_DOLLCHESTRA_RECOVERY',
      selectableOptions: [{ id: 'pay', label: '支付[E]' }],
      canSkipSelection: true,
      skipSelectionLabel: '不发动',
    });
    expect(session.state?.activeEffect?.metadata?.activeEnergyCardIds).toEqual(energyIds);
  });

  it('declines without paying energy or recovering a card', () => {
    const target = createCardInstance(
      createDollchestraMember('PL!HS-test-dollchestra-member'),
      PLAYER1,
      'target-member'
    );
    const { session, energyIds } = setupOnEnter({
      activeEnergyCount: 1,
      waitingCards: [target],
    });

    confirmOption(session, null);

    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].energyZone.cardStates.get(energyIds[0]!)?.orientation).toBe(
      OrientationState.ACTIVE
    );
    expect(session.state?.players[0].hand.cardIds).toEqual([]);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([target.instanceId]);
    expect(hasPayCostAction(session.state!)).toBe(false);
  });

  it('pays active energy, records PAY_COST, then recovers a selected DOLLCHESTRA card', () => {
    const memberTarget = createCardInstance(
      createDollchestraMember('PL!HS-test-dollchestra-member'),
      PLAYER1,
      'target-member'
    );
    const liveTarget = createCardInstance(
      createDollchestraLive('PL!HS-test-dollchestra-live'),
      PLAYER1,
      'target-live'
    );
    const nonTarget = createCardInstance(
      createNonDollchestraMember('PL!HS-test-non-dollchestra'),
      PLAYER1,
      'non-target'
    );
    const { session, energyIds } = setupOnEnter({
      activeEnergyCount: 1,
      waitingCards: [memberTarget, liveTarget, nonTarget],
    });

    confirmOption(session, 'pay');

    expect(session.state?.players[0].energyZone.cardStates.get(energyIds[0]!)?.orientation).toBe(
      OrientationState.WAITING
    );
    expect(hasPayCostAction(session.state!)).toBe(true);
    expect(session.state?.activeEffect).toMatchObject({
      stepId: 'HS_CL1_002_SELECT_DOLLCHESTRA_CARD_FROM_WAITING_ROOM',
      selectableCardIds: [memberTarget.instanceId, liveTarget.instanceId],
      canSkipSelection: false,
    });

    confirmCard(session, liveTarget.instanceId);

    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].hand.cardIds).toEqual([liveTarget.instanceId]);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([
      memberTarget.instanceId,
      nonTarget.instanceId,
    ]);
  });

  it('does not pay and resolves no-op when there is no active energy', () => {
    const target = createCardInstance(
      createDollchestraMember('PL!HS-test-dollchestra-member'),
      PLAYER1,
      'target-member'
    );
    const { session } = setupOnEnter({
      activeEnergyCount: 0,
      waitingCards: [target],
    });

    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([target.instanceId]);
    expect(hasPayCostAction(session.state!)).toBe(false);
    expect(
      session.state?.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' && action.payload.reason === 'NO_ACTIVE_ENERGY'
      )
    ).toBe(true);
  });

  it('does not pay and resolves no-op when there is no DOLLCHESTRA target', () => {
    const nonTarget = createCardInstance(
      createNonDollchestraMember('PL!HS-test-non-dollchestra'),
      PLAYER1,
      'non-target'
    );
    const { session, energyIds } = setupOnEnter({
      activeEnergyCount: 1,
      waitingCards: [nonTarget],
    });

    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].energyZone.cardStates.get(energyIds[0]!)?.orientation).toBe(
      OrientationState.ACTIVE
    );
    expect(hasPayCostAction(session.state!)).toBe(false);
    expect(
      session.state?.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' && action.payload.reason === 'NO_DOLLCHESTRA_TARGET'
      )
    ).toBe(true);
  });

  it('resolves stale pending no-op when the source is no longer on stage', () => {
    const target = createCardInstance(
      createDollchestraMember('PL!HS-test-dollchestra-member'),
      PLAYER1,
      'target-member'
    );
    const { session } = setupOnEnter({
      activeEnergyCount: 1,
      waitingCards: [target],
      sourceOnStage: false,
    });

    expect(session.state?.activeEffect).toBeNull();
    expect(hasPayCostAction(session.state!)).toBe(false);
    expect(
      session.state?.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' && action.payload.reason === 'SOURCE_NOT_ON_STAGE'
      )
    ).toBe(true);
  });

  it('keeps paid energy and resolves no-op when targets disappear after the payment choice', () => {
    const target = createCardInstance(
      createDollchestraMember('PL!HS-test-dollchestra-member'),
      PLAYER1,
      'target-member'
    );
    const { session, energyIds } = setupOnEnter({
      activeEnergyCount: 1,
      waitingCards: [target],
    });
    const stateWithoutTarget = updatePlayer(session.state!, PLAYER1, (player) => ({
      ...player,
      waitingRoom: {
        ...player.waitingRoom,
        cardIds: [],
      },
    }));
    (session as unknown as { authorityState: GameState }).authorityState = stateWithoutTarget;

    confirmOption(session, 'pay');

    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].energyZone.cardStates.get(energyIds[0]!)?.orientation).toBe(
      OrientationState.WAITING
    );
    expect(hasPayCostAction(session.state!)).toBe(true);
    expect(
      session.state?.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.step === 'PAY_ENERGY_DOLLCHESTRA_RECOVERY_NO_TARGET_AFTER_COST'
      )
    ).toBe(true);
  });

  it('continues ordered pending resolution after a declined payment window', () => {
    const firstSource = createCardInstance(createSayaka(), PLAYER1, 'sayaka-source-a');
    const secondSource = createCardInstance(createSayaka(), PLAYER1, 'sayaka-source-b');
    const energy = createCardInstance(createEnergy('PL!HS-test-energy'), PLAYER1, 'energy');
    const target = createCardInstance(
      createDollchestraMember('PL!HS-test-dollchestra-member'),
      PLAYER1,
      'target-member'
    );
    let game = createGameState('hs-cl1-002-sayaka-ordered', PLAYER1, 'P1', PLAYER2, 'P2');
    game = registerCards(game, [firstSource, secondSource, energy, target]);
    game = updatePlayer(game, PLAYER1, (player) => ({
      ...player,
      energyZone: addCardToStatefulZone(player.energyZone, energy.instanceId, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      }),
      waitingRoom: {
        ...player.waitingRoom,
        cardIds: [target.instanceId],
      },
      memberSlots: placeCardInSlot(
        placeCardInSlot(player.memberSlots, SlotPosition.LEFT, firstSource.instanceId, {
          orientation: OrientationState.ACTIVE,
          face: FaceState.FACE_UP,
        }),
        SlotPosition.RIGHT,
        secondSource.instanceId,
        { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }
      ),
    }));
    game = emitGameEvent(
      game,
      createEnterStageEvent(firstSource.instanceId, ZoneType.HAND, SlotPosition.LEFT, PLAYER1, PLAYER1)
    );
    game = emitGameEvent(
      game,
      createEnterStageEvent(secondSource.instanceId, ZoneType.HAND, SlotPosition.RIGHT, PLAYER1, PLAYER1)
    );
    game = enqueueTriggeredCardEffects(game, [TriggerCondition.ON_ENTER_STAGE]);
    game = resolvePendingCardEffects(game).gameState;

    const session = createGameSession();
    session.createGame('hs-cl1-002-sayaka-ordered-session', PLAYER1, 'P1', PLAYER2, 'P2');
    (session as unknown as { authorityState: GameState }).authorityState = game;

    const currentSourceCardId = session.state!.activeEffect!.sourceCardId;
    const queuedSourceCardId =
      currentSourceCardId === firstSource.instanceId
        ? secondSource.instanceId
        : firstSource.instanceId;
    (session as unknown as { authorityState: GameState }).authorityState = {
      ...session.state!,
      pendingAbilities: [
        ...session.state!.pendingAbilities,
        {
          id: 'manual-ordered-continuation-pending',
          abilityId: HS_CL1_002_ON_ENTER_PAY_ENERGY_RECOVER_DOLLCHESTRA_CARD_ABILITY_ID,
          sourceCardId: queuedSourceCardId,
          controllerId: PLAYER1,
          mandatory: false,
          timingId: TriggerCondition.ON_ENTER_STAGE,
          eventIds: ['manual-ordered-continuation-event'],
        },
      ],
    };
    const nextPendingSourceCardId =
      session.state!.pendingAbilities.find((ability) => ability.sourceCardId !== currentSourceCardId)
        ?.sourceCardId ?? null;
    expect([firstSource.instanceId, secondSource.instanceId]).toContain(currentSourceCardId);
    expect([firstSource.instanceId, secondSource.instanceId]).toContain(nextPendingSourceCardId);
    (session as unknown as { authorityState: GameState }).authorityState = {
      ...session.state!,
      activeEffect: {
        ...session.state!.activeEffect!,
        metadata: {
          ...session.state!.activeEffect!.metadata,
          orderedResolution: true,
        },
      },
    };

    confirmOption(session, null);

    expect(session.state?.activeEffect).toMatchObject({
      abilityId: HS_CL1_002_ON_ENTER_PAY_ENERGY_RECOVER_DOLLCHESTRA_CARD_ABILITY_ID,
      sourceCardId: nextPendingSourceCardId,
      stepId: 'HS_CL1_002_PAY_ENERGY_FOR_DOLLCHESTRA_RECOVERY',
    });
  });
});
