import { confirmPublicSelectionIfNeeded } from '../helpers/public-card-selection-confirmation';
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
import { placeCardInSlot } from '../../src/domain/entities/zone';
import {
  createActivateAbilityCommand,
  createConfirmEffectStepCommand,
  createPlayMemberToSlotCommand,
} from '../../src/application/game-commands';
import { createGameSession } from '../../src/application/game-session';
import type { DeckConfig } from '../../src/application/game-service';
import {
  S_SD1_002_ON_ENTER_DISCARD_RECOVER_AQOURS_CARD_ABILITY_ID,
  S_SD1_005_ACTIVATED_PAY_ENERGY_DISCARD_RECOVER_AQOURS_LIVE_ABILITY_ID,
} from '../../src/application/card-effects/ability-ids';
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

function member(cardCode: string, name = cardCode, groupNames: readonly string[] = ['Aqours']): MemberCardData {
  return {
    cardCode,
    name,
    groupNames,
    cardType: CardType.MEMBER,
    cost: 5,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.RED, 1)],
  };
}

function live(cardCode: string, name = cardCode, groupNames: readonly string[] = ['Aqours']): LiveCardData {
  return {
    cardCode,
    name,
    groupNames,
    cardType: CardType.LIVE,
    score: 3,
    requirements: createHeartRequirement({ [HeartColor.RED]: 1 }),
  };
}

function energy(cardCode: string): EnergyCardData {
  return {
    cardCode,
    name: cardCode,
    cardType: CardType.ENERGY,
  };
}

function deck(): DeckConfig {
  const mainDeck: AnyCardData[] = Array.from({ length: 61 }, (_, index) =>
    member(`PL!S-test-main-${index}`)
  );
  const energyDeck: EnergyCardData[] = Array.from({ length: 12 }, (_, index) =>
    energy(`PL!S-test-energy-deck-${index}`)
  );
  return { mainDeck, energyDeck };
}

function setAuthorityState(session: ReturnType<typeof createGameSession>, state: GameState): void {
  (session as unknown as { authorityState: GameState }).authorityState = state;
}

function forceMainPhase(game: GameState, activePlayerIndex = 0): GameState {
  return {
    ...game,
    currentPhase: GamePhase.MAIN_PHASE,
    currentSubPhase: SubPhase.NONE,
    currentTurnType: TurnType.NORMAL,
    activePlayerIndex,
    waitingPlayerId: null,
  };
}

function setupOnEnterScenario(options: {
  readonly handCard?: ReturnType<typeof createCardInstance>;
  readonly waitingCards?: readonly ReturnType<typeof createCardInstance>[];
}) {
  const session = createGameSession();
  session.createGame('s-sd1-002-aqours-recovery', PLAYER1, 'P1', PLAYER2, 'P2');
  session.initializeGame(deck(), deck());

  const source = createCardInstance(member('PL!S-sd1-002-SD', '桜内梨子'), PLAYER1, 'riko-002');
  const cards = [source, ...(options.handCard ? [options.handCard] : []), ...(options.waitingCards ?? [])];
  let game = registerCards(session.state!, cards);
  game = updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    hand: {
      ...player.hand,
      cardIds: [source.instanceId, ...(options.handCard ? [options.handCard.instanceId] : [])],
    },
    mainDeck: { ...player.mainDeck, cardIds: [] },
    waitingRoom: {
      ...player.waitingRoom,
      cardIds: (options.waitingCards ?? []).map((card) => card.instanceId),
    },
  }));
  game = forceMainPhase(game);
  setAuthorityState(session, game);

  const playResult = session.executeCommand(
    createPlayMemberToSlotCommand(PLAYER1, source.instanceId, SlotPosition.CENTER, {
      freePlay: true,
    })
  );
  expect(playResult.success, playResult.error).toBe(true);
  if ((options.waitingCards?.length ?? 0) > 0) {
    const stateWithWaitingTargets = updatePlayer(session.state!, PLAYER1, (player) => ({
      ...player,
      waitingRoom: {
        ...player.waitingRoom,
        cardIds: [
          ...player.waitingRoom.cardIds,
          ...(options.waitingCards ?? []).map((card) => card.instanceId),
        ],
      },
    }));
    setAuthorityState(session, stateWithWaitingTargets);
  }
  if (options.handCard) {
    expect(session.state?.activeEffect?.abilityId).toBe(
      S_SD1_002_ON_ENTER_DISCARD_RECOVER_AQOURS_CARD_ABILITY_ID
    );
  }

  return { session, source };
}

function setupActivatedScenario(options: {
  readonly activeEnergyCount: number;
  readonly handCards: readonly ReturnType<typeof createCardInstance>[];
  readonly waitingCards?: readonly ReturnType<typeof createCardInstance>[];
  readonly sourceInStage?: boolean;
  readonly activePlayerIndex?: number;
  readonly phase?: GamePhase;
}) {
  const session = createGameSession();
  session.createGame('s-sd1-005-aqours-live-recovery', PLAYER1, 'P1', PLAYER2, 'P2');

  const source = createCardInstance(member('PL!S-sd1-005-SD', '渡辺 曜'), PLAYER1, 'you-005');
  const energies = Array.from({ length: Math.max(options.activeEnergyCount, 2) }, (_, index) =>
    createCardInstance(energy(`PL!S-test-energy-${index}`), PLAYER1, `energy-${index}`)
  );
  const cards = [source, ...energies, ...options.handCards, ...(options.waitingCards ?? [])];
  let game = registerCards(session.state!, cards);
  game = updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    hand: { ...player.hand, cardIds: options.handCards.map((card) => card.instanceId) },
    mainDeck: { ...player.mainDeck, cardIds: [] },
    waitingRoom: {
      ...player.waitingRoom,
      cardIds: (options.waitingCards ?? []).map((card) => card.instanceId),
    },
    energyZone: {
      ...player.energyZone,
      cardIds: energies.map((card) => card.instanceId),
      cardStates: new Map(
        energies.map((card, index) => [
          card.instanceId,
          {
            orientation:
              index < options.activeEnergyCount
                ? OrientationState.ACTIVE
                : OrientationState.WAITING,
            face: FaceState.FACE_UP,
          },
        ])
      ),
    },
    memberSlots:
      options.sourceInStage === false
        ? player.memberSlots
        : placeCardInSlot(player.memberSlots, SlotPosition.CENTER, source.instanceId, {
            orientation: OrientationState.ACTIVE,
            face: FaceState.FACE_UP,
          }),
  }));
  game = forceMainPhase(game, options.activePlayerIndex ?? 0);
  if (options.phase) {
    game = { ...game, currentPhase: options.phase };
  }
  setAuthorityState(session, game);

  return {
    session,
    source,
    energyIds: energies.map((card) => card.instanceId),
  };
}

function activate005(session: ReturnType<typeof createGameSession>, sourceId: string) {
  return session.executeCommand(
    createActivateAbilityCommand(
      PLAYER1,
      sourceId,
      S_SD1_005_ACTIVATED_PAY_ENERGY_DISCARD_RECOVER_AQOURS_LIVE_ABILITY_ID
    )
  );
}

describe('PL!S-sd1-002 and PL!S-sd1-005 Aqours recovery workflows', () => {
  it('PL!S-sd1-002 consumes the pending on-enter ability without a window when there is no hand card', () => {
    const { session } = setupOnEnterScenario({});

    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.pendingAbilities).toEqual([]);
  });

  it('PL!S-sd1-002 can decline the on-enter effect without discarding', () => {
    const discard = createCardInstance(member('PL!S-test-aqours-hand'), PLAYER1, 'discard-aqours');
    const { session } = setupOnEnterScenario({ handCard: discard });

    const result = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id, null)
    );

    expect(result.success, result.error).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].hand.cardIds).toContain(discard.instanceId);
    expect(session.state?.players[0].waitingRoom.cardIds).not.toContain(discard.instanceId);
  });

  it('PL!S-sd1-002 discards through the waiting-room trigger path and recovers any Aqours card', () => {
    const discard = createCardInstance(member('PL!S-test-non-aqours', 'Discard', ['Liella!']), PLAYER1, 'discard-non-aqours');
    const target = createCardInstance(live('PL!S-test-aqours-live'), PLAYER1, 'waiting-aqours-live');
    const { session } = setupOnEnterScenario({ handCard: discard, waitingCards: [target] });

    const discardResult = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id, discard.instanceId)
    );

    expect(discardResult.success, discardResult.error).toBe(true);
    expect(session.state?.activeEffect?.selectableCardIds).toEqual([target.instanceId]);
    expect(session.state?.players[0].waitingRoom.cardIds).toContain(discard.instanceId);
    expect(
      session.state?.eventLog.some(
        (entry) =>
          entry.event.eventType === TriggerCondition.ON_ENTER_WAITING_ROOM &&
          entry.event.cardInstanceId === discard.instanceId
      )
    ).toBe(true);

    const recoverResult = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id, target.instanceId)
    );

    expect(recoverResult.success, recoverResult.error).toBe(true);
    confirmPublicSelectionIfNeeded(session);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].hand.cardIds).toEqual([target.instanceId]);
    expect(session.state?.players[0].waitingRoom.cardIds).not.toContain(target.instanceId);
  });

  it('PL!S-sd1-002 can recover the just-discarded Aqours card and safely resolves with no target', () => {
    const aqoursDiscard = createCardInstance(member('PL!S-test-aqours-member'), PLAYER1, 'discard-aqours-member');
    const { session } = setupOnEnterScenario({ handCard: aqoursDiscard });

    const discardResult = session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        session.state!.activeEffect!.id,
        aqoursDiscard.instanceId
      )
    );

    expect(discardResult.success, discardResult.error).toBe(true);
    expect(session.state?.activeEffect?.selectableCardIds).toEqual([aqoursDiscard.instanceId]);

    const recoverResult = session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        session.state!.activeEffect!.id,
        aqoursDiscard.instanceId
      )
    );

    expect(recoverResult.success, recoverResult.error).toBe(true);
    confirmPublicSelectionIfNeeded(session);
    expect(session.state?.players[0].hand.cardIds).toEqual([aqoursDiscard.instanceId]);

    const nonAqoursDiscard = createCardInstance(member('PL!S-test-other', 'Other', ['Liella!']), PLAYER1, 'discard-other');
    const noTarget = setupOnEnterScenario({ handCard: nonAqoursDiscard });
    const noTargetResult = noTarget.session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        noTarget.session.state!.activeEffect!.id,
        nonAqoursDiscard.instanceId
      )
    );

    expect(noTargetResult.success, noTargetResult.error).toBe(true);
    expect(noTarget.session.state?.activeEffect).toBeNull();
    expect(noTarget.session.state?.players[0].mainDeck.cardIds).toContain(
      nonAqoursDiscard.instanceId
    );
  });

  it('PL!S-sd1-002 does not move an illegal or stale recovery target', () => {
    const discard = createCardInstance(member('PL!S-test-cost', 'Cost', ['Liella!']), PLAYER1, 'discard-cost');
    const target = createCardInstance(live('PL!S-test-stale-live'), PLAYER1, 'stale-live');
    const { session } = setupOnEnterScenario({ handCard: discard, waitingCards: [target] });

    session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id, discard.instanceId)
    );
    const staleState = updatePlayer(session.state!, PLAYER1, (player) => ({
      ...player,
      waitingRoom: {
        ...player.waitingRoom,
        cardIds: player.waitingRoom.cardIds.filter((cardId) => cardId !== target.instanceId),
      },
      hand: { ...player.hand, cardIds: [...player.hand.cardIds, target.instanceId] },
    }));
    setAuthorityState(session, staleState);

    session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id, target.instanceId)
    );

    expect(session.state?.activeEffect?.stepId).toBe('S_SD1_002_SELECT_AQOURS_CARD_FROM_WAITING_ROOM');
    expect(session.state?.players[0].hand.cardIds).toContain(target.instanceId);
  });

  it('PL!S-sd1-005 pays two energy and discards one hand card before recovering an Aqours LIVE', () => {
    const discard = createCardInstance(member('PL!S-test-discard', 'Discard', ['Liella!']), PLAYER1, 'discard-hand');
    const target = createCardInstance(live('PL!S-test-target-live'), PLAYER1, 'target-live');
    const { session, source, energyIds } = setupActivatedScenario({
      activeEnergyCount: 2,
      handCards: [discard],
      waitingCards: [target],
    });

    expect(activate005(session, source.instanceId).success).toBe(true);
    expect(session.state?.activeEffect?.stepId).toBe(
      'S_SD1_005_SELECT_DISCARD_FOR_AQOURS_LIVE_RECOVERY'
    );
    expect(session.state?.activeEffect?.confirmSelectionLabel).toBe('放置入休息室');

    const discardResult = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id, discard.instanceId)
    );

    expect(discardResult.success, discardResult.error).toBe(true);
    expect(session.state?.players[0].energyZone.cardStates.get(energyIds[0])?.orientation).toBe(
      OrientationState.WAITING
    );
    expect(session.state?.players[0].energyZone.cardStates.get(energyIds[1])?.orientation).toBe(
      OrientationState.WAITING
    );
    expect(session.state?.players[0].waitingRoom.cardIds).toContain(discard.instanceId);
    expect(session.state?.activeEffect?.selectableCardIds).toEqual([target.instanceId]);

    const recoverResult = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id, target.instanceId)
    );

    expect(recoverResult.success, recoverResult.error).toBe(true);
    confirmPublicSelectionIfNeeded(session);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].hand.cardIds).toEqual([target.instanceId]);
  });

  it('PL!S-sd1-005 can recover the just-discarded Aqours LIVE and no-ops after paid costs with no target', () => {
    const discardedLive = createCardInstance(live('PL!S-test-discard-live'), PLAYER1, 'discard-live');
    const scenario = setupActivatedScenario({
      activeEnergyCount: 2,
      handCards: [discardedLive],
    });

    expect(activate005(scenario.session, scenario.source.instanceId).success).toBe(true);
    scenario.session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        scenario.session.state!.activeEffect!.id,
        discardedLive.instanceId
      )
    );
    expect(scenario.session.state?.activeEffect?.selectableCardIds).toEqual([
      discardedLive.instanceId,
    ]);
    scenario.session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        scenario.session.state!.activeEffect!.id,
        discardedLive.instanceId
      )
    );
    confirmPublicSelectionIfNeeded(scenario.session);
    expect(scenario.session.state?.players[0].hand.cardIds).toEqual([discardedLive.instanceId]);

    const nonTargetDiscard = createCardInstance(member('PL!S-test-non-target', 'No target', ['Liella!']), PLAYER1, 'non-target-discard');
    const noTarget = setupActivatedScenario({
      activeEnergyCount: 2,
      handCards: [nonTargetDiscard],
    });
    expect(activate005(noTarget.session, noTarget.source.instanceId).success).toBe(true);
    const noTargetResult = noTarget.session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        noTarget.session.state!.activeEffect!.id,
        nonTargetDiscard.instanceId
      )
    );

    expect(noTargetResult.success, noTargetResult.error).toBe(true);
    expect(noTarget.session.state?.activeEffect).toBeNull();
    expect(noTarget.session.state?.players[0].waitingRoom.cardIds).toContain(
      nonTargetDiscard.instanceId
    );
    expect(noTarget.session.state?.players[0].energyZone.cardStates.get(noTarget.energyIds[0])?.orientation).toBe(
      OrientationState.WAITING
    );
  });

  it('PL!S-sd1-005 enforces activation conditions and the once-per-turn limit', () => {
    const hand = createCardInstance(member('PL!S-test-hand'), PLAYER1, 'condition-hand');
    for (const options of [
      { activeEnergyCount: 1, handCards: [hand] },
      { activeEnergyCount: 2, handCards: [] },
      { activeEnergyCount: 2, handCards: [hand], sourceInStage: false },
      { activeEnergyCount: 2, handCards: [hand], phase: GamePhase.LIVE_SET_PHASE },
      { activeEnergyCount: 2, handCards: [hand], activePlayerIndex: 1 },
    ] as const) {
      const scenario = setupActivatedScenario(options);
      expect(activate005(scenario.session, scenario.source.instanceId).success).toBe(false);
      expect(scenario.session.state?.activeEffect).toBeNull();
    }

    const firstDiscard = createCardInstance(member('PL!S-test-first', 'First', ['Liella!']), PLAYER1, 'first-discard');
    const secondDiscard = createCardInstance(member('PL!S-test-second', 'Second', ['Liella!']), PLAYER1, 'second-discard');
    const scenario = setupActivatedScenario({
      activeEnergyCount: 4,
      handCards: [firstDiscard, secondDiscard],
    });
    expect(activate005(scenario.session, scenario.source.instanceId).success).toBe(true);
    scenario.session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        scenario.session.state!.activeEffect!.id,
        firstDiscard.instanceId
      )
    );
    expect(scenario.session.state?.activeEffect).toBeNull();
    expect(activate005(scenario.session, scenario.source.instanceId).success).toBe(false);
  });

  it('PL!S-sd1-005 does not move an illegal or stale recovery target', () => {
    const discard = createCardInstance(member('PL!S-test-discard-two', 'Discard', ['Liella!']), PLAYER1, 'discard-two');
    const target = createCardInstance(live('PL!S-test-stale-target'), PLAYER1, 'stale-target');
    const { session, source } = setupActivatedScenario({
      activeEnergyCount: 2,
      handCards: [discard],
      waitingCards: [target],
    });

    expect(activate005(session, source.instanceId).success).toBe(true);
    session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id, discard.instanceId)
    );
    const staleState = updatePlayer(session.state!, PLAYER1, (player) => ({
      ...player,
      waitingRoom: {
        ...player.waitingRoom,
        cardIds: player.waitingRoom.cardIds.filter((cardId) => cardId !== target.instanceId),
      },
      hand: { ...player.hand, cardIds: [...player.hand.cardIds, target.instanceId] },
    }));
    setAuthorityState(session, staleState);

    session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id, target.instanceId)
    );

    expect(session.state?.activeEffect?.stepId).toBe('S_SD1_005_SELECT_AQOURS_LIVE_FROM_WAITING_ROOM');
    expect(session.state?.players[0].hand.cardIds).toContain(target.instanceId);
  });
});
