import { describe, expect, it } from 'vitest';
import type { AnyCardData, EnergyCardData, MemberCardData } from '../../src/domain/entities/card';
import { createCardInstance, createHeartIcon } from '../../src/domain/entities/card';
import {
  registerCards,
  updatePlayer,
  type GameState,
} from '../../src/domain/entities/game';
import { placeCardInSlot } from '../../src/domain/entities/zone';
import {
  createConfirmEffectStepCommand,
  createPlayMemberToSlotCommand,
} from '../../src/application/game-commands';
import { createGameSession } from '../../src/application/game-session';
import type { DeckConfig } from '../../src/application/game-service';
import {
  S_SD1_002_ON_ENTER_DISCARD_RECOVER_AQOURS_CARD_ABILITY_ID,
  S_SD1_006_ON_ENTER_DISCARD_PLAY_LOW_COST_AQOURS_MEMBER_ABILITY_ID,
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
const ABILITY_ID = S_SD1_006_ON_ENTER_DISCARD_PLAY_LOW_COST_AQOURS_MEMBER_ABILITY_ID;

function member(
  cardCode: string,
  options: {
    readonly name?: string;
    readonly cost?: number;
    readonly groupNames?: readonly string[];
  } = {}
): MemberCardData {
  return {
    cardCode,
    name: options.name ?? cardCode,
    groupNames: options.groupNames ?? ['Aqours'],
    cardType: CardType.MEMBER,
    cost: options.cost ?? 1,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.RED, 1)],
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
  const mainDeck: AnyCardData[] = Array.from({ length: 60 }, (_unused, index) =>
    member(`PL!S-test-main-${index}`)
  );
  const energyDeck: EnergyCardData[] = Array.from({ length: 12 }, (_unused, index) =>
    energy(`PL!S-test-energy-deck-${index}`)
  );
  return { mainDeck, energyDeck };
}

function setAuthorityState(session: ReturnType<typeof createGameSession>, state: GameState): void {
  (session as unknown as { authorityState: GameState }).authorityState = state;
}

function forceMainPhase(game: GameState): GameState {
  return {
    ...game,
    currentPhase: GamePhase.MAIN_PHASE,
    currentSubPhase: SubPhase.NONE,
    currentTurnType: TurnType.NORMAL,
    activePlayerIndex: 0,
    waitingPlayerId: null,
  };
}

function setupScenario(options: {
  readonly handCards?: readonly ReturnType<typeof createCardInstance>[];
  readonly waitingCards?: readonly ReturnType<typeof createCardInstance>[];
  readonly fillOtherSlots?: boolean;
}) {
  const session = createGameSession();
  session.createGame('s-sd1-006-yoshiko', PLAYER1, 'P1', PLAYER2, 'P2');
  session.initializeGame(deck(), deck());

  const source = createCardInstance(
    member('PL!S-sd1-006-SD', { name: '津島善子', cost: 5 }),
    PLAYER1,
    'yoshiko-006'
  );
  const otherStageCards = options.fillOtherSlots
    ? [
        createCardInstance(member('PL!S-test-left', { cost: 1 }), PLAYER1, 'left-member'),
        createCardInstance(member('PL!S-test-right', { cost: 1 }), PLAYER1, 'right-member'),
      ]
    : [];
  const allCards = [
    source,
    ...(options.handCards ?? []),
    ...(options.waitingCards ?? []),
    ...otherStageCards,
  ];
  let game = registerCards(session.state!, allCards);
  game = updatePlayer(game, PLAYER1, (player) => {
    let memberSlots = player.memberSlots;
    if (otherStageCards[0]) {
      memberSlots = placeCardInSlot(memberSlots, SlotPosition.LEFT, otherStageCards[0].instanceId, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      });
    }
    if (otherStageCards[1]) {
      memberSlots = placeCardInSlot(memberSlots, SlotPosition.RIGHT, otherStageCards[1].instanceId, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      });
    }
    return {
      ...player,
      hand: {
        ...player.hand,
        cardIds: [source.instanceId, ...(options.handCards ?? []).map((card) => card.instanceId)],
      },
      waitingRoom: {
        ...player.waitingRoom,
        cardIds: (options.waitingCards ?? []).map((card) => card.instanceId),
      },
      memberSlots,
    };
  });
  game = forceMainPhase(game);
  setAuthorityState(session, game);

  const playResult = session.executeCommand(
    createPlayMemberToSlotCommand(PLAYER1, source.instanceId, SlotPosition.CENTER, {
      freePlay: true,
    })
  );
  expect(playResult.success, playResult.error).toBe(true);

  return { session, source };
}

function confirmCard(session: ReturnType<typeof createGameSession>, selectedCardId: string | null) {
  const result = session.executeCommand(
    createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id, selectedCardId)
  );
  expect(result.success, result.error).toBe(true);
}

function confirmSlot(session: ReturnType<typeof createGameSession>, selectedSlot: SlotPosition) {
  const result = session.executeCommand(
    createConfirmEffectStepCommand(
      PLAYER1,
      session.state!.activeEffect!.id,
      undefined,
      selectedSlot
    )
  );
  expect(result.success, result.error).toBe(true);
}

function eventCardIds(game: GameState, eventType: TriggerCondition): readonly string[] {
  return game.eventLog.flatMap((entry) =>
    entry.event.eventType === eventType
      ? (entry.event.cardInstanceIds ?? [entry.event.cardInstanceId])
      : []
  );
}

describe('PL!S-sd1-006 津島善子 on-enter discard play low-cost Aqours member', () => {
  it('can decline without discarding', () => {
    const discard = createCardInstance(member('PL!S-test-discard'), PLAYER1, 'decline-discard');
    const { session } = setupScenario({ handCards: [discard] });

    expect(session.state?.activeEffect?.abilityId).toBe(ABILITY_ID);
    confirmCard(session, null);

    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].hand.cardIds).toContain(discard.instanceId);
    expect(session.state?.players[0].waitingRoom.cardIds).not.toContain(discard.instanceId);
  });

  it('can play the just-discarded low-cost Aqours member from waiting room', () => {
    const discardTarget = createCardInstance(
      member('PL!S-test-low-cost-aqours', { cost: 2 }),
      PLAYER1,
      'discarded-target'
    );
    const { session } = setupScenario({ handCards: [discardTarget] });

    confirmCard(session, discardTarget.instanceId);
    expect(session.state?.activeEffect?.selectableCardIds).toEqual([discardTarget.instanceId]);
    expect(session.state?.players[0].waitingRoom.cardIds).toContain(discardTarget.instanceId);
    expect(eventCardIds(session.state!, TriggerCondition.ON_ENTER_WAITING_ROOM)).toContain(
      discardTarget.instanceId
    );

    confirmCard(session, discardTarget.instanceId);
    expect(session.state?.activeEffect?.selectableSlots).toEqual([
      SlotPosition.LEFT,
      SlotPosition.RIGHT,
    ]);
    confirmSlot(session, SlotPosition.LEFT);

    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].memberSlots.slots[SlotPosition.LEFT]).toBe(
      discardTarget.instanceId
    );
  });

  it('filters waiting-room targets to cost 2 or less Aqours member cards', () => {
    const discard = createCardInstance(member('PL!S-test-discard', { groupNames: ['Liella!'] }), PLAYER1, 'discard');
    const valid = createCardInstance(member('PL!S-test-valid', { cost: 2 }), PLAYER1, 'valid');
    const tooExpensive = createCardInstance(member('PL!S-test-expensive', { cost: 3 }), PLAYER1, 'too-expensive');
    const nonAqours = createCardInstance(
      member('PL!S-test-non-aqours', { cost: 1, groupNames: ['Liella!'] }),
      PLAYER1,
      'non-aqours'
    );
    const { session } = setupScenario({
      handCards: [discard],
      waitingCards: [valid, tooExpensive, nonAqours],
    });

    confirmCard(session, discard.instanceId);

    expect(session.state?.activeEffect?.selectableCardIds).toEqual([valid.instanceId]);
  });

  it('does not open a meaningless window without hand cards or empty member slots', () => {
    const noHand = setupScenario({});
    expect(noHand.session.state?.activeEffect).toBeNull();
    expect(noHand.session.state?.pendingAbilities).toEqual([]);

    const discard = createCardInstance(member('PL!S-test-discard'), PLAYER1, 'full-stage-discard');
    const fullStage = setupScenario({ handCards: [discard], fillOtherSlots: true });
    expect(fullStage.session.state?.activeEffect).toBeNull();
    expect(fullStage.session.state?.pendingAbilities).toEqual([]);
  });

  it('keeps paid costs and safely no-ops when no target remains after discard', () => {
    const discard = createCardInstance(
      member('PL!S-test-non-target', { groupNames: ['Liella!'] }),
      PLAYER1,
      'no-target-discard'
    );
    const { session } = setupScenario({ handCards: [discard] });

    confirmCard(session, discard.instanceId);

    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].waitingRoom.cardIds).toContain(discard.instanceId);
  });

  it('handles stale hand, target, and slot selections without illegal movement', () => {
    const staleDiscard = createCardInstance(member('PL!S-test-stale-hand'), PLAYER1, 'stale-hand');
    const staleHand = setupScenario({ handCards: [staleDiscard] });
    setAuthorityState(
      staleHand.session,
      updatePlayer(staleHand.session.state!, PLAYER1, (player) => ({
        ...player,
        hand: {
          ...player.hand,
          cardIds: player.hand.cardIds.filter((cardId) => cardId !== staleDiscard.instanceId),
        },
        waitingRoom: {
          ...player.waitingRoom,
          cardIds: [...player.waitingRoom.cardIds, staleDiscard.instanceId],
        },
      }))
    );
    confirmCard(staleHand.session, staleDiscard.instanceId);
    expect(staleHand.session.state?.activeEffect).toBeNull();
    expect(staleHand.session.state?.players[0].waitingRoom.cardIds).toContain(
      staleDiscard.instanceId
    );

    const discard = createCardInstance(member('PL!S-test-discard', { groupNames: ['Liella!'] }), PLAYER1, 'discard-two');
    const target = createCardInstance(member('PL!S-test-target', { cost: 1 }), PLAYER1, 'stale-target');
    const staleTarget = setupScenario({ handCards: [discard], waitingCards: [target] });
    confirmCard(staleTarget.session, discard.instanceId);
    setAuthorityState(
      staleTarget.session,
      updatePlayer(staleTarget.session.state!, PLAYER1, (player) => ({
        ...player,
        waitingRoom: {
          ...player.waitingRoom,
          cardIds: player.waitingRoom.cardIds.filter((cardId) => cardId !== target.instanceId),
        },
        hand: { ...player.hand, cardIds: [...player.hand.cardIds, target.instanceId] },
      }))
    );
    confirmCard(staleTarget.session, target.instanceId);
    expect(staleTarget.session.state?.activeEffect).toBeNull();
    expect(staleTarget.session.state?.players[0].hand.cardIds).toContain(target.instanceId);

    const discardForSlot = createCardInstance(member('PL!S-test-discard-slot'), PLAYER1, 'discard-slot');
    const slotTarget = createCardInstance(member('PL!S-test-slot-target', { cost: 1 }), PLAYER1, 'slot-target');
    const blocker = createCardInstance(member('PL!S-test-blocker'), PLAYER1, 'slot-blocker');
    const staleSlot = setupScenario({ handCards: [discardForSlot], waitingCards: [slotTarget] });
    confirmCard(staleSlot.session, discardForSlot.instanceId);
    confirmCard(staleSlot.session, slotTarget.instanceId);
    let stateWithBlocker = registerCards(staleSlot.session.state!, [blocker]);
    stateWithBlocker = updatePlayer(stateWithBlocker, PLAYER1, (player) => ({
      ...player,
      memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.LEFT, blocker.instanceId, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      }),
    }));
    setAuthorityState(staleSlot.session, stateWithBlocker);
    confirmSlot(staleSlot.session, SlotPosition.LEFT);
    expect(staleSlot.session.state?.activeEffect).toBeNull();
    expect(staleSlot.session.state?.players[0].waitingRoom.cardIds).toContain(
      slotTarget.instanceId
    );
  });

  it('emits enter-stage events and queues the played member on-enter ability', () => {
    const discard = createCardInstance(member('PL!S-test-discard', { groupNames: ['Liella!'] }), PLAYER1, 'discard-trigger');
    const remainingHand = createCardInstance(member('PL!S-test-remaining-hand'), PLAYER1, 'remaining-hand');
    const riko = createCardInstance(
      member('PL!S-sd1-002-SD', { name: '桜内梨子', cost: 2 }),
      PLAYER1,
      'riko-target'
    );
    const { session } = setupScenario({ handCards: [discard, remainingHand], waitingCards: [riko] });

    confirmCard(session, discard.instanceId);
    confirmCard(session, riko.instanceId);
    confirmSlot(session, SlotPosition.LEFT);

    expect(eventCardIds(session.state!, TriggerCondition.ON_ENTER_STAGE)).toContain(riko.instanceId);
    expect(session.state?.activeEffect?.abilityId).toBe(
      S_SD1_002_ON_ENTER_DISCARD_RECOVER_AQOURS_CARD_ABILITY_ID
    );
  });
});
