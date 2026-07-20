import { describe, expect, it } from 'vitest';
import type { AnyCardData, EnergyCardData, MemberCardData } from '../../src/domain/entities/card';
import {
  createCardInstance,
  createHeartIcon,
  createHeartRequirement,
} from '../../src/domain/entities/card';
import type { DeckConfig } from '../../src/application/game-service';
import { createGameSession } from '../../src/application/game-session';
import {
  createBeginSpecialMemberPlayCommand,
  createCancelSpecialMemberPlayCommand,
  createConfirmSpecialMemberPlayCommand,
  createPlayMemberToSlotCommand,
} from '../../src/application/game-commands';
import { getMemberEffectiveCost } from '../../src/domain/rules/member-effective-cost';
import {
  createGameState,
  registerCards,
  updatePlayer,
  type PendingAbilityState,
} from '../../src/domain/entities/game';
import { placeCardInSlot } from '../../src/domain/entities/zone';
import { resolvePendingCardEffects } from '../../src/application/card-effect-runner';
import { createPublicObjectId } from '../../src/online/projector';
import {
  LL_BP7_001_LIVE_SUCCESS_RECOVER_MEMBER_ABILITY_ID,
  LL_BP7_001_ON_ENTER_RECOVER_LIVE_ABILITY_ID,
} from '../../src/application/card-effects/ability-ids';
import { getCardAbilityDefinitionsForCardCode } from '../../src/application/card-effects/definitions/lookup';
import {
  CardAbilityCategory,
  CardAbilitySourceZone,
} from '../../src/application/card-effects/ability-definition-types';
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

function member(cardCode: string, name: string, cost = 2): MemberCardData {
  return {
    cardCode,
    name,
    cardType: CardType.MEMBER,
    cost,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.PINK, 1)],
  };
}

function energy(cardCode: string): EnergyCardData {
  return { cardCode, name: cardCode, cardType: CardType.ENERGY };
}

function live(cardCode: string): AnyCardData {
  return {
    cardCode,
    name: cardCode,
    cardType: CardType.LIVE,
    score: 1,
    requirements: createHeartRequirement({ [HeartColor.PINK]: 1 }),
  };
}

function deck(): DeckConfig {
  return {
    mainDeck: Array.from({ length: 60 }, (_, index) =>
      member(`MEM-${index}`, `Member ${index}`)
    ) as AnyCardData[],
    energyDeck: Array.from({ length: 12 }, (_, index) => energy(`ENE-${index}`)),
  };
}

function setup() {
  const session = createGameSession();
  session.createGame('ll-bp7-001-special-play', PLAYER1, 'P1', PLAYER2, 'P2');
  session.initializeGame(deck(), deck());
  const state = session.state!;
  Object.assign(state, {
    currentPhase: GamePhase.MAIN_PHASE,
    currentSubPhase: SubPhase.NONE,
    activePlayerIndex: 0,
    waitingPlayerId: null,
  });
  const player = state.players[0];
  const [sourceId, hanamaruId, setsunaId, chisatoId] = player.hand.cardIds;
  const replacements: readonly [string, MemberCardData][] = [
    [sourceId, member('LL-bp7-001-R+', '国木田花丸&優木せつ菜&嵐千砂都', 15)],
    [hanamaruId, member('PAY-HANAMARU', '国木田花丸')],
    [setsunaId, member('PAY-SETSUNA', '優木せつ菜')],
    [chisatoId, member('PAY-CHISATO', '嵐千砂都')],
  ];
  for (const [cardId, data] of replacements) {
    const instance = state.cardRegistry.get(cardId)!;
    // Test setup mutates the authority registry before commands begin.
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
    state.cardRegistry.set(cardId, { ...instance, data });
  }
  const activeEnergyIds = [...player.energyZone.cardIds, ...player.energyDeck.cardIds].slice(0, 10);
  player.energyZone.cardIds = activeEnergyIds;
  player.energyZone.cardStates = new Map(
    activeEnergyIds.map((cardId) => [cardId, { orientation: OrientationState.ACTIVE }])
  );
  player.energyDeck.cardIds = player.energyDeck.cardIds.filter(
    (cardId) => !activeEnergyIds.includes(cardId)
  );
  return { session, sourceId, paymentIds: [hanamaruId, setsunaId, chisatoId], activeEnergyIds };
}

describe('LL-bp7-001-R+ special member play', () => {
  it('registers exactly the three exact-card ability identities', () => {
    const definitions = getCardAbilityDefinitionsForCardCode('LL-bp7-001-R+');
    expect(definitions).toHaveLength(3);
    expect(
      definitions.map(({ category, sourceZone, triggerCondition, queued }) => ({
        category,
        sourceZone,
        triggerCondition,
        queued,
      }))
    ).toEqual([
      {
        category: CardAbilityCategory.CONTINUOUS,
        sourceZone: CardAbilitySourceZone.HAND,
        triggerCondition: undefined,
        queued: false,
      },
      {
        category: CardAbilityCategory.ON_ENTER,
        sourceZone: CardAbilitySourceZone.PLAYED_MEMBER,
        triggerCondition: TriggerCondition.ON_ENTER_STAGE,
        queued: true,
      },
      {
        category: CardAbilityCategory.LIVE_SUCCESS,
        sourceZone: CardAbilitySourceZone.STAGE_MEMBER,
        triggerCondition: TriggerCondition.ON_LIVE_SUCCESS,
        queued: true,
      },
    ]);
    expect(getCardAbilityDefinitionsForCardCode('LL-bp7-001-R')).toHaveLength(0);
  });

  it('reuses waiting-room-to-hand with LIVE-only and member-only candidates', () => {
    const source = createCardInstance(
      member('LL-bp7-001-R+', '国木田花丸&優木せつ菜&嵐千砂都', 15),
      PLAYER1,
      'source'
    );
    const waitingLive = createCardInstance(live('WAITING-LIVE'), PLAYER1, 'waiting-live');
    const waitingMember = createCardInstance(
      member('WAITING-MEMBER', '候选成员'),
      PLAYER1,
      'waiting-member'
    );
    let game = registerCards(createGameState('recoveries', PLAYER1, 'P1', PLAYER2, 'P2'), [
      source,
      waitingLive,
      waitingMember,
    ]);
    game = updatePlayer(game, PLAYER1, (player) => ({
      ...player,
      waitingRoom: {
        ...player.waitingRoom,
        cardIds: [waitingLive.instanceId, waitingMember.instanceId],
      },
      memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, source.instanceId, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      }),
    }));
    const pending = (abilityId: string, timingId: TriggerCondition): PendingAbilityState => ({
      id: `${abilityId}-pending`,
      abilityId,
      sourceCardId: source.instanceId,
      controllerId: PLAYER1,
      timingId,
      sourceSlot: SlotPosition.CENTER,
      eventIds: [`${abilityId}-event`],
    });

    const enter = resolvePendingCardEffects({
      ...game,
      pendingAbilities: [
        pending(LL_BP7_001_ON_ENTER_RECOVER_LIVE_ABILITY_ID, TriggerCondition.ON_ENTER_STAGE),
      ],
    }).gameState;
    expect(enter.activeEffect?.selectableCardIds).toEqual([waitingLive.instanceId]);
    expect(enter.activeEffect?.metadata?.zoneSelection).toMatchObject({ minCount: 1, maxCount: 1 });
    expect(enter.activeEffect?.canSkipSelection).toBe(false);

    const success = resolvePendingCardEffects({
      ...game,
      pendingAbilities: [
        pending(
          LL_BP7_001_LIVE_SUCCESS_RECOVER_MEMBER_ABILITY_ID,
          TriggerCondition.ON_LIVE_SUCCESS
        ),
      ],
    }).gameState;
    expect(success.activeEffect?.selectableCardIds).toEqual([waitingMember.instanceId]);
    expect(success.activeEffect?.metadata?.zoneSelection).toMatchObject({
      minCount: 1,
      maxCount: 1,
    });
    expect(success.activeEffect?.canSkipSelection).toBe(false);
  });

  it('creates the private selection only after choosing a slot and reveals no hand identity', () => {
    const { session, sourceId, paymentIds } = setup();
    const beforeHand = [...session.state!.players[0].hand.cardIds];

    const result = session.executeCommand(
      createBeginSpecialMemberPlayCommand(PLAYER1, sourceId, SlotPosition.CENTER)
    );

    expect(result.success).toBe(true);
    expect(session.state!.players[0].hand.cardIds).toEqual(beforeHand);
    expect(session.state!.pendingSpecialMemberPlay?.candidateCardIds).toEqual(
      expect.arrayContaining(paymentIds)
    );
    const ownerView = session.getPlayerViewState(PLAYER1).pendingSpecialMemberPlay;
    const opponentView = session.getPlayerViewState(PLAYER2).pendingSpecialMemberPlay;
    expect(ownerView?.candidateObjectIds).toHaveLength(3);
    expect(ownerView?.confirmSelectionLabel).toBe('放置入休息室并登场');
    expect(opponentView).toEqual({ id: ownerView?.id, playerSeat: 'FIRST', waiting: true });
    expect(JSON.stringify(opponentView)).not.toContain(sourceId);
    for (const paymentId of paymentIds)
      expect(JSON.stringify(opponentView)).not.toContain(paymentId);
  });

  it.each([
    'activeEffect',
    'pendingAbilities',
    'pendingChoice',
    'checkTimingContext',
    'pendingCostPayment',
    'inspectionContext',
    'delegatedAbilitySequence',
  ] as const)(
    'rejects forged BEGIN while %s is unresolved and preserves authority state',
    (key) => {
      const { session, sourceId } = setup();
      const state = session.state!;
      switch (key) {
        case 'activeEffect':
          Object.assign(state, {
            activeEffect: {
              id: 'existing-effect',
              abilityId: 'existing-ability',
              sourceCardId: sourceId,
              controllerId: PLAYER1,
              effectText: 'existing',
              stepId: 'EXISTING',
              stepText: 'existing',
              awaitingPlayerId: PLAYER1,
            },
          });
          break;
        case 'pendingAbilities':
          Object.assign(state, {
            pendingAbilities: [
              {
                id: 'existing-pending',
                abilityId: 'existing-ability',
                sourceCardId: sourceId,
                controllerId: PLAYER1,
                timingId: TriggerCondition.ON_ENTER_STAGE,
                eventIds: ['existing-event'],
              },
            ],
          });
          break;
        case 'pendingChoice':
          Object.assign(state, {
            pendingChoice: {
              id: 'existing-choice',
              playerId: PLAYER1,
              kind: 'CONFIRM_OPTIONAL',
              prompt: 'existing',
            },
          });
          break;
        case 'checkTimingContext':
          Object.assign(state, {
            checkTimingContext: {
              id: 'existing-check-timing',
              activePlayerId: PLAYER1,
              iterationCount: 1,
            },
          });
          break;
        case 'pendingCostPayment':
          Object.assign(state, {
            pendingCostPayment: {
              id: 'existing-cost',
              playerId: PLAYER1,
              source: 'PLAY_MEMBER',
              sourceCardId: sourceId,
              finalEnergyCost: 1,
              relayDiscount: 0,
              replacedMemberCardId: null,
              payableEnergyCardIds: [],
            },
          });
          break;
        case 'inspectionContext':
          Object.assign(state, {
            inspectionContext: {
              ownerPlayerId: PLAYER1,
              viewerPlayerId: PLAYER1,
              sourceZone: 'MAIN_DECK',
            },
          });
          break;
        case 'delegatedAbilitySequence':
          Object.assign(state, {
            delegatedAbilitySequence: {
              id: 'existing-delegated',
              controllerId: PLAYER1,
              parentAbilityId: 'parent',
              parentSourceCardId: sourceId,
              parentEffectId: 'parent-effect',
              orderedResolution: false,
              remainingAbilities: [],
              resolvedPendingAbilityIds: [],
              resolvedAbilityIds: [],
              skippedPendingAbilityIds: [],
              skippedAbilityIds: [],
            },
          });
          break;
      }
      const authorityBefore = session.state;

      const result = session.executeCommand(
        createBeginSpecialMemberPlayCommand(PLAYER1, sourceId, SlotPosition.CENTER)
      );

      expect(result.success).toBe(false);
      expect(session.state).toBe(authorityBefore);
      expect(session.state!.pendingSpecialMemberPlay).toBeNull();
      expect(session.state![key]).not.toBeNull();
    }
  );

  it('atomically discards one of each name, pays the one-play base 10, then remains cost 15', () => {
    const { session, sourceId, paymentIds, activeEnergyIds } = setup();
    session.executeCommand(
      createBeginSpecialMemberPlayCommand(PLAYER1, sourceId, SlotPosition.CENTER)
    );
    const pendingId = session.state!.pendingSpecialMemberPlay!.id;

    const result = session.executeCommand(
      createConfirmSpecialMemberPlayCommand(PLAYER1, pendingId, paymentIds)
    );

    expect(result.success).toBe(true);
    expect(session.state!.pendingSpecialMemberPlay).toBeNull();
    expect(session.state!.players[0].memberSlots.slots[SlotPosition.CENTER]).toBe(sourceId);
    expect(session.state!.players[0].waitingRoom.cardIds).toEqual(
      expect.arrayContaining(paymentIds)
    );
    for (const energyId of activeEnergyIds) {
      expect(session.state!.players[0].energyZone.cardStates.get(energyId)?.orientation).toBe(
        OrientationState.WAITING
      );
    }
    const groupedEvent = session.state!.eventLog.find(
      ({ event }) =>
        event.eventType === TriggerCondition.ON_ENTER_WAITING_ROOM && event.fromZone === 'HAND'
    )?.event;
    expect(
      groupedEvent && 'cardInstanceIds' in groupedEvent ? groupedEvent.cardInstanceIds : []
    ).toEqual(paymentIds);
    expect(getMemberEffectiveCost(session.state!, PLAYER1, sourceId)).toBe(15);
    expect(session.state!.actionHistory.at(-1)?.payload).toMatchObject({
      sourceCardId: sourceId,
      printedCost: 15,
      specialPlayCost: 10,
      paidEnergyCount: 10,
    });
  });

  it('binds an occupied slot to SINGLE relay even when its effective cost is zero', () => {
    const { session, sourceId, paymentIds, activeEnergyIds } = setup();
    const state = session.state!;
    const player = state.players[0];
    const occupantId = player.hand.cardIds.find(
      (cardId) => cardId !== sourceId && !paymentIds.includes(cardId)
    )!;
    const occupant = state.cardRegistry.get(occupantId)!;
    // Test setup installs a legal zero-cost relay target before commands begin.
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
    state.cardRegistry.set(occupantId, { ...occupant, data: member('RELAY-0', '换手成员', 0) });
    player.hand.cardIds = player.hand.cardIds.filter((cardId) => cardId !== occupantId);
    player.memberSlots = placeCardInSlot(player.memberSlots, SlotPosition.LEFT, occupantId, {
      orientation: OrientationState.ACTIVE,
      face: FaceState.FACE_UP,
    });

    expect(
      session.executeCommand(
        createBeginSpecialMemberPlayCommand(PLAYER1, sourceId, SlotPosition.LEFT)
      ).success
    ).toBe(true);
    const pendingId = session.state!.pendingSpecialMemberPlay!.id;
    const publicSeqBeforeConfirm = session.getCurrentPublicEventSeq();
    expect(
      session.executeCommand(createConfirmSpecialMemberPlayCommand(PLAYER1, pendingId, paymentIds))
        .success
    ).toBe(true);

    expect(session.state!.players[0].memberSlots.slots[SlotPosition.LEFT]).toBe(sourceId);
    expect(session.state!.players[0].waitingRoom.cardIds).toContain(occupantId);
    expect(
      activeEnergyIds.filter(
        (cardId) =>
          session.state!.players[0].energyZone.cardStates.get(cardId)?.orientation ===
          OrientationState.WAITING
      )
    ).toHaveLength(10);
    const payCostAction = session
      .state!.actionHistory.filter((action) => action.type === 'PAY_COST')
      .at(-1);
    expect(payCostAction?.payload).toMatchObject({
      amount: 10,
      relayDiscount: 0,
      replacedMemberCardId: occupantId,
      relayReplacements: [{ cardId: occupantId, slot: SlotPosition.LEFT, effectiveCost: 0 }],
    });
    expect(session.state!.actionHistory.at(-1)?.payload).toMatchObject({
      relayReplacement: occupantId,
      relayReplacements: [{ cardId: occupantId, slot: SlotPosition.LEFT, effectiveCost: 0 }],
      relayDiscount: 0,
      paidEnergyCount: 10,
    });
    expect(
      session
        .getPublicEventsSince(publicSeqBeforeConfirm)
        .some(
          (event) =>
            event.type === 'CardMovedPublic' &&
            event.card?.publicObjectId === createPublicObjectId(occupantId) &&
            event.from?.zone === 'MEMBER_SLOT' &&
            event.from.slot === SlotPosition.LEFT &&
            event.to?.zone === 'WAITING_ROOM'
        )
    ).toBe(true);
    const sealedAudit = session
      .getSealedAuditSince(0)
      .filter((record) => record.type === 'SPECIAL_MEMBER_PLAY_CONFIRMED')
      .at(-1);
    expect(sealedAudit?.payload).toMatchObject({
      sourceCardId: sourceId,
      relayReplacement: occupantId,
      relayReplacements: [{ cardId: occupantId, slot: SlotPosition.LEFT, effectiveCost: 0 }],
      relayDiscount: 0,
      paidEnergyCardIds: activeEnergyIds,
      paidEnergyCount: 10,
    });
    expect(getMemberEffectiveCost(session.state!, PLAYER1, sourceId)).toBe(15);
  });

  it('rejects stale energy without discarding, paying, relaying, or playing', () => {
    const { session, sourceId, paymentIds } = setup();
    session.executeCommand(
      createBeginSpecialMemberPlayCommand(PLAYER1, sourceId, SlotPosition.LEFT)
    );
    const pendingId = session.state!.pendingSpecialMemberPlay!.id;
    for (const cardId of session.state!.players[0].energyZone.cardIds) {
      // Test setup invalidates the authoritative resource after the window opens.
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call
      session.state!.players[0].energyZone.cardStates.set(cardId, {
        orientation: OrientationState.WAITING,
      });
    }
    const beforeHand = [...session.state!.players[0].hand.cardIds];

    const result = session.executeCommand(
      createConfirmSpecialMemberPlayCommand(PLAYER1, pendingId, paymentIds)
    );

    expect(result.success).toBe(false);
    expect(session.state!.players[0].hand.cardIds).toEqual(beforeHand);
    expect(session.state!.players[0].waitingRoom.cardIds).not.toEqual(
      expect.arrayContaining(paymentIds)
    );
    expect(session.state!.players[0].memberSlots.slots[SlotPosition.LEFT]).toBeNull();
    expect(session.state!.pendingSpecialMemberPlay?.id).toBe(pendingId);
  });

  it('intentionally allows a cancellable private preparation window before energy is sufficient', () => {
    const { session, sourceId } = setup();
    for (const cardId of session.state!.players[0].energyZone.cardIds) {
      // Deliberately start below the payable threshold; BEGIN is preparation, CONFIRM is payment.
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call
      session.state!.players[0].energyZone.cardStates.set(cardId, {
        orientation: OrientationState.WAITING,
      });
    }

    const result = session.executeCommand(
      createBeginSpecialMemberPlayCommand(PLAYER1, sourceId, SlotPosition.RIGHT)
    );

    expect(result.success).toBe(true);
    expect(session.state!.pendingSpecialMemberPlay).toMatchObject({
      sourceCardId: sourceId,
      targetSlot: SlotPosition.RIGHT,
    });
  });

  it('keeps ordinary play on the printed cost 15 path', () => {
    const { session, sourceId } = setup();
    const result = session.executeCommand(
      createPlayMemberToSlotCommand(PLAYER1, sourceId, SlotPosition.RIGHT)
    );
    expect(result.success).toBe(false);
    expect(session.state!.players[0].hand.cardIds).toContain(sourceId);
  });

  it('keeps a legal pending usable after a forged choice and cancels without payment', () => {
    const { session, sourceId, paymentIds, activeEnergyIds } = setup();
    session.executeCommand(
      createBeginSpecialMemberPlayCommand(PLAYER1, sourceId, SlotPosition.CENTER)
    );
    const pendingId = session.state!.pendingSpecialMemberPlay!.id;
    const handBefore = [...session.state!.players[0].hand.cardIds];

    const forged = session.executeCommand(
      createConfirmSpecialMemberPlayCommand(PLAYER1, pendingId, [
        paymentIds[0],
        paymentIds[0],
        paymentIds[2],
      ])
    );
    expect(forged.success).toBe(false);
    expect(session.state!.pendingSpecialMemberPlay?.id).toBe(pendingId);
    expect(session.state!.players[0].hand.cardIds).toEqual(handBefore);

    const cancelled = session.executeCommand(
      createCancelSpecialMemberPlayCommand(PLAYER1, pendingId)
    );
    expect(cancelled.success).toBe(true);
    expect(session.state!.pendingSpecialMemberPlay).toBeNull();
    expect(session.state!.players[0].hand.cardIds).toEqual(handBefore);
    for (const energyId of activeEnergyIds) {
      expect(session.state!.players[0].energyZone.cardStates.get(energyId)?.orientation).toBe(
        OrientationState.ACTIVE
      );
    }
    expect(session.state!.players[0].memberSlots.slots[SlotPosition.CENTER]).toBeNull();
  });

  it('does not settle a repeated confirmation twice', () => {
    const { session, sourceId, paymentIds } = setup();
    session.executeCommand(
      createBeginSpecialMemberPlayCommand(PLAYER1, sourceId, SlotPosition.CENTER)
    );
    const pendingId = session.state!.pendingSpecialMemberPlay!.id;
    expect(
      session.executeCommand(createConfirmSpecialMemberPlayCommand(PLAYER1, pendingId, paymentIds))
        .success
    ).toBe(true);
    const waitingRoomBefore = [...session.state!.players[0].waitingRoom.cardIds];
    expect(
      session.executeCommand(createConfirmSpecialMemberPlayCommand(PLAYER1, pendingId, paymentIds))
        .success
    ).toBe(false);
    expect(session.state!.players[0].waitingRoom.cardIds).toEqual(waitingRoomBefore);
    expect(session.state!.players[0].memberSlots.slots[SlotPosition.CENTER]).toBe(sourceId);
  });
});
