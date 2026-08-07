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
import type { DeckConfig } from '../../src/application/game-service';
import { createGameSession } from '../../src/application/game-session';
import {
  createBeginSpecialMemberPlayCommand,
  createConfirmSpecialMemberPlayCommand,
  GameCommandType,
} from '../../src/application/game-commands';
import {
  confirmActiveEffectStep,
  enqueueTriggeredCardEffects,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import {
  N_BP7_011_AUTO_DECK_TO_WAITING_DISCARD_ONE_RECOVER_SELF_ABILITY_ID,
  N_BP7_011_CONTINUOUS_PLAY_SHUFFLE_WAITING_MEMBERS_COST_MINUS_TWO_ABILITY_ID,
  N_BP7_011_LIVE_SUCCESS_NIJIGASAKI_WAITING_CARD_TO_DECK_TOP_ABILITY_ID,
} from '../../src/application/card-effects/ability-ids';
import {
  CardAbilityCategory,
  CardAbilitySourceZone,
} from '../../src/application/card-effects/ability-definition-types';
import { getCardAbilityDefinitionsForCardCode } from '../../src/application/card-effects/definitions/lookup';
import { moveTopDeckCardsToWaitingRoomAndEnqueueTriggers } from '../../src/application/card-effects/runtime/main-deck-waiting-room-triggers';
import { PUBLIC_CARD_SELECTION_CONFIRMATION_STEP_ID } from '../../src/application/card-effects/runtime/public-card-selection-confirmation';
import {
  createGameState,
  registerCards,
  updatePlayer,
  type GameState,
} from '../../src/domain/entities/game';
import { createLiveSuccessEvent } from '../../src/domain/events/game-events';
import { placeCardInSlot } from '../../src/domain/entities/zone';
import { createPublicObjectId, projectPlayerViewState } from '../../src/online/projector';
import {
  CardType,
  FaceState,
  GamePhase,
  HeartColor,
  OrientationState,
  SlotPosition,
  SubPhase,
  TriggerCondition,
  ZoneType,
} from '../../src/shared/types/enums';

const P1 = 'p1';
const P2 = 'p2';
const AUTO_ABILITY = N_BP7_011_AUTO_DECK_TO_WAITING_DISCARD_ONE_RECOVER_SELF_ABILITY_ID;
const COST_ABILITY = N_BP7_011_CONTINUOUS_PLAY_SHUFFLE_WAITING_MEMBERS_COST_MINUS_TWO_ABILITY_ID;
const LIVE_SUCCESS_ABILITY = N_BP7_011_LIVE_SUCCESS_NIJIGASAKI_WAITING_CARD_TO_DECK_TOP_ABILITY_ID;
const MIA_SPECIAL_PLAY_MODE = 'N_BP7_011_WAITING_MEMBERS_COST_MINUS_TWO' as const;

function member(
  cardCode: string,
  name = cardCode,
  cost = 1,
  groupNames: readonly string[] = ['虹ヶ咲']
): MemberCardData {
  return {
    cardCode,
    name,
    groupNames,
    cardType: CardType.MEMBER,
    cost,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.PINK, 1)],
  };
}

function live(
  cardCode: string,
  name = cardCode,
  groupNames: readonly string[] = ['虹ヶ咲']
): LiveCardData {
  return {
    cardCode,
    name,
    groupNames,
    cardType: CardType.LIVE,
    score: 1,
    requirements: createHeartRequirement({ [HeartColor.PINK]: 1 }),
  };
}

function energy(cardCode: string): EnergyCardData {
  return { cardCode, name: cardCode, cardType: CardType.ENERGY };
}

function deck(): DeckConfig {
  return {
    mainDeck: Array.from({ length: 60 }, (_, index) =>
      member(`MEMBER-${index}`, `Member ${index}`)
    ) as AnyCardData[],
    energyDeck: Array.from({ length: 12 }, (_, index) => energy(`ENERGY-${index}`)),
  };
}

function setCardData(game: GameState, cardId: string, data: MemberCardData | LiveCardData): void {
  const instance = game.cardRegistry.get(cardId);
  if (!instance) throw new Error(`missing test card ${cardId}`);
  // Test fixtures install real card identities before issuing authority commands.
  // eslint-disable-next-line @typescript-eslint/no-unsafe-call
  game.cardRegistry.set(cardId, { ...instance, data });
}

function setupSpecialPlay(
  options: {
    readonly sourceCode?: string;
    readonly waitingMemberCount?: number;
    readonly activeEnergyCount?: number;
  } = {}
) {
  const session = createGameSession();
  session.createGame('mia-special-play', P1, 'P1', P2, 'P2');
  session.initializeGame(deck(), deck());
  const game = session.state!;
  Object.assign(game, {
    currentPhase: GamePhase.MAIN_PHASE,
    currentSubPhase: SubPhase.NONE,
    activePlayerIndex: 0,
    waitingPlayerId: null,
  });
  const player = game.players[0];
  const sourceId = player.hand.cardIds[0]!;
  setCardData(game, sourceId, member(options.sourceCode ?? 'PL!N-bp7-011-SEC', '米娅·泰勒', 13));

  const waitingMemberCount = options.waitingMemberCount ?? 2;
  const waitingMemberIds = player.mainDeck.cardIds.slice(0, waitingMemberCount);
  const waitingLiveId = player.mainDeck.cardIds[waitingMemberCount]!;
  for (const [index, cardId] of waitingMemberIds.entries()) {
    setCardData(game, cardId, member(`WAITING-MEMBER-${index}`, `休息室成员${index + 1}`, 3));
  }
  setCardData(game, waitingLiveId, live('WAITING-LIVE', '休息室LIVE'));
  const movedToWaiting = [...waitingMemberIds, waitingLiveId];
  player.mainDeck.cardIds = player.mainDeck.cardIds.filter(
    (cardId) => !movedToWaiting.includes(cardId)
  );
  player.waitingRoom.cardIds = movedToWaiting;

  const activeEnergyIds = [...player.energyZone.cardIds, ...player.energyDeck.cardIds].slice(
    0,
    options.activeEnergyCount ?? 11
  );
  player.energyZone.cardIds = activeEnergyIds;
  player.energyZone.cardStates = new Map(
    activeEnergyIds.map((cardId) => [
      cardId,
      { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP },
    ])
  );
  player.energyDeck.cardIds = player.energyDeck.cardIds.filter(
    (cardId) => !activeEnergyIds.includes(cardId)
  );

  return {
    session,
    sourceId,
    waitingMemberIds,
    waitingLiveId,
    activeEnergyIds,
  };
}

function setupDeckToWaitingAuto(sourceCode = 'PL!N-bp7-011-SEC') {
  const source = createCardInstance(member(sourceCode, '米娅·泰勒', 13), P1, 'mia-auto');
  const discard = createCardInstance(member('HAND-DISCARD', '弃置手牌'), P1, 'discard');
  const deckBottom = createCardInstance(member('DECK-BOTTOM', '卡组底'), P1, 'deck-bottom');
  let game = registerCards(createGameState('mia-auto', P1, 'P1', P2, 'P2'), [
    source,
    discard,
    deckBottom,
  ]);
  game = updatePlayer(game, P1, (player) => ({
    ...player,
    hand: { ...player.hand, cardIds: [discard.instanceId] },
    mainDeck: {
      ...player.mainDeck,
      cardIds: [source.instanceId, deckBottom.instanceId],
    },
  }));
  const moved = moveTopDeckCardsToWaitingRoomAndEnqueueTriggers(
    game,
    P1,
    1,
    enqueueTriggeredCardEffects
  );
  if (!moved) throw new Error('failed to mill Mia in test setup');
  return { game: moved.gameState, source, discard, deckBottom };
}

describe('PL!N-bp7-011-SEC 费用13「米娅·泰勒」', () => {
  it('registers all three abilities for every rarity sharing the base card identity', () => {
    expect(getCardAbilityDefinitionsForCardCode('PL!N-bp7-011-SEC')).toEqual([
      expect.objectContaining({
        abilityId: AUTO_ABILITY,
        baseCardCodes: ['PL!N-bp7-011'],
        category: CardAbilityCategory.AUTO,
        sourceZone: CardAbilitySourceZone.WAITING_ROOM,
        triggerCondition: TriggerCondition.ON_ENTER_WAITING_ROOM,
        triggerFromZones: [ZoneType.MAIN_DECK],
        queued: true,
        implemented: true,
      }),
      expect.objectContaining({
        abilityId: COST_ABILITY,
        baseCardCodes: ['PL!N-bp7-011'],
        category: CardAbilityCategory.CONTINUOUS,
        sourceZone: CardAbilitySourceZone.HAND,
        queued: false,
        implemented: true,
      }),
      expect.objectContaining({
        abilityId: LIVE_SUCCESS_ABILITY,
        baseCardCodes: ['PL!N-bp7-011'],
        category: CardAbilityCategory.LIVE_SUCCESS,
        sourceZone: CardAbilitySourceZone.STAGE_MEMBER,
        triggerCondition: TriggerCondition.ON_LIVE_SUCCESS,
        queued: true,
        implemented: true,
      }),
    ]);
    expect(getCardAbilityDefinitionsForCardCode('PL!N-bp7-011-P')).toHaveLength(3);
    // cards.json 中真实存在、且已确认没有卡效定义的虹咲能量卡。
    expect(getCardAbilityDefinitionsForCardCode('PL!N-sd2-000-SECS')).toHaveLength(0);
  });

  it('triggers from a real grouped MAIN_DECK-to-WAITING_ROOM move, then discards one and recovers itself', () => {
    const scenario = setupDeckToWaitingAuto();
    let game = resolvePendingCardEffects(scenario.game).gameState;
    expect(game.activeEffect).toMatchObject({
      abilityId: AUTO_ABILITY,
      sourceCardId: scenario.source.instanceId,
      selectableCardIds: [scenario.discard.instanceId],
      selectionLabel: '选择要放置入休息室的手牌',
      confirmSelectionLabel: '放置入休息室',
      canSkipSelection: true,
      skipSelectionLabel: '不发动',
    });
    expect(game.players[0].waitingRoom.cardIds).toContain(scenario.source.instanceId);

    game = confirmActiveEffectStep(game, P1, game.activeEffect!.id, scenario.discard.instanceId);
    expect(game.activeEffect).toBeNull();
    expect(game.players[0].hand.cardIds).toEqual([scenario.source.instanceId]);
    expect(game.players[0].waitingRoom.cardIds).toEqual([scenario.discard.instanceId]);
    expect(game.players[0].mainDeck.cardIds).toEqual([scenario.deckBottom.instanceId]);
    const enterWaitingEvents = game.eventLog
      .map(({ event }) => event)
      .filter((event) => event.eventType === TriggerCondition.ON_ENTER_WAITING_ROOM);
    expect(enterWaitingEvents).toHaveLength(2);
    expect(enterWaitingEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          cardInstanceIds: [scenario.source.instanceId],
          fromZone: ZoneType.MAIN_DECK,
          toZone: ZoneType.WAITING_ROOM,
        }),
        expect.objectContaining({
          cardInstanceIds: [scenario.discard.instanceId],
          fromZone: ZoneType.HAND,
          toZone: ZoneType.WAITING_ROOM,
        }),
      ])
    );
  });

  it('allows declining the discard and refuses a stale recovery without consuming the hand card', () => {
    const declinedScenario = setupDeckToWaitingAuto('PL!N-bp7-011-P');
    let declined = resolvePendingCardEffects(declinedScenario.game).gameState;
    declined = confirmActiveEffectStep(declined, P1, declined.activeEffect!.id);
    expect(declined.activeEffect).toBeNull();
    expect(declined.players[0].hand.cardIds).toEqual([declinedScenario.discard.instanceId]);
    expect(declined.players[0].waitingRoom.cardIds).toEqual([declinedScenario.source.instanceId]);

    const staleScenario = setupDeckToWaitingAuto();
    let stale = resolvePendingCardEffects(staleScenario.game).gameState;
    stale = updatePlayer(stale, P1, (player) => ({
      ...player,
      waitingRoom: { ...player.waitingRoom, cardIds: [] },
      hand: {
        ...player.hand,
        cardIds: [...player.hand.cardIds, staleScenario.source.instanceId],
      },
    }));
    const beforeConfirm = stale;
    const afterConfirm = confirmActiveEffectStep(
      stale,
      P1,
      stale.activeEffect!.id,
      staleScenario.discard.instanceId
    );
    expect(afterConfirm).toBe(beforeConfirm);
    expect(afterConfirm.players[0].hand.cardIds).toEqual([
      staleScenario.discard.instanceId,
      staleScenario.source.instanceId,
    ]);
    expect(afterConfirm.players[0].waitingRoom.cardIds).toEqual([]);
  });

  it('queues on a real LIVE success, publicly confirms one Nijigasaki card, then emits one central top-deck event', () => {
    const source = createCardInstance(member('PL!N-bp7-011-SEC', '米娅·泰勒', 13), P1, 'mia');
    const successfulLive = createCardInstance(live('SUCCESSFUL-LIVE'), P1, 'successful-live');
    const nijiMember = createCardInstance(
      member('NIJI-MEMBER', '虹咲成员', 2, ['虹ヶ咲']),
      P1,
      'niji-member'
    );
    const nijiLive = createCardInstance(live('NIJI-LIVE', '虹咲LIVE', ['虹咲']), P1, 'niji-live');
    const aqoursMember = createCardInstance(
      member('AQOURS-MEMBER', 'Aqours成员', 2, ['Aqours']),
      P1,
      'aqours-member'
    );
    const deckTop = createCardInstance(member('DECK-TOP', '原卡组顶'), P1, 'deck-top');
    let game = registerCards(createGameState('mia-live-success', P1, 'P1', P2, 'P2'), [
      source,
      successfulLive,
      nijiMember,
      nijiLive,
      aqoursMember,
      deckTop,
    ]);
    game = updatePlayer(game, P1, (player) => ({
      ...player,
      memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, source.instanceId, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      }),
      liveZone: { ...player.liveZone, cardIds: [successfulLive.instanceId] },
      waitingRoom: {
        ...player.waitingRoom,
        cardIds: [nijiMember.instanceId, nijiLive.instanceId, aqoursMember.instanceId],
      },
      mainDeck: { ...player.mainDeck, cardIds: [deckTop.instanceId] },
    }));
    const successEvent = createLiveSuccessEvent(P1, [successfulLive.instanceId], 1);
    game = enqueueTriggeredCardEffects(game, [TriggerCondition.ON_LIVE_SUCCESS], {
      liveSuccessEvents: [successEvent],
    });
    game = resolvePendingCardEffects(game).gameState;
    expect(game.activeEffect).toMatchObject({
      abilityId: LIVE_SUCCESS_ABILITY,
      selectableCardIds: [nijiMember.instanceId, nijiLive.instanceId],
      selectableCardVisibility: 'PUBLIC',
      canSkipSelection: true,
      skipSelectionLabel: '不放置',
    });

    const effectId = game.activeEffect!.id;
    const revealed = confirmActiveEffectStep(game, P1, effectId, nijiMember.instanceId);
    expect(revealed.activeEffect).toMatchObject({
      stepId: PUBLIC_CARD_SELECTION_CONFIRMATION_STEP_ID,
      revealedCardIds: [nijiMember.instanceId],
    });
    expect(revealed.players[0].waitingRoom.cardIds).toContain(nijiMember.instanceId);
    expect(revealed.players[0].mainDeck.cardIds).toEqual([deckTop.instanceId]);
    const p1View = projectPlayerViewState(revealed, P1);
    const p2View = projectPlayerViewState(revealed, P2);
    expect(p1View.activeEffect?.revealedObjectIds).toEqual([
      createPublicObjectId(nijiMember.instanceId),
    ]);
    expect(p2View.activeEffect?.revealedObjectIds).toEqual(p1View.activeEffect?.revealedObjectIds);

    const done = confirmActiveEffectStep(revealed, P1, effectId);
    expect(done.activeEffect).toBeNull();
    expect(done.players[0].mainDeck.cardIds).toEqual([nijiMember.instanceId, deckTop.instanceId]);
    expect(done.players[0].waitingRoom.cardIds).toEqual([
      nijiLive.instanceId,
      aqoursMember.instanceId,
    ]);
    const movementEvents = done.eventLog
      .map(({ event }) => event)
      .filter(
        (event) => event.eventType === TriggerCondition.ON_WAITING_ROOM_CARDS_MOVED_TO_MAIN_DECK
      );
    expect(movementEvents).toHaveLength(1);
    expect(movementEvents[0]).toMatchObject({
      movedCardIds: [nijiMember.instanceId],
      destination: { kind: 'TOP' },
      cause: {
        kind: 'CARD_EFFECT',
        playerId: P1,
        sourceCardId: source.instanceId,
        abilityId: LIVE_SUCCESS_ABILITY,
      },
    });
  });

  it('projects the special-play mode from the server, hides the hand source from the opponent, and pays base 11 atomically', () => {
    const scenario = setupSpecialPlay({ sourceCode: 'PL!N-bp7-011-P' });
    const sourceObjectId = createPublicObjectId(scenario.sourceId);
    const beginHint = scenario.session
      .getPlayerViewState(P1)
      .permissions.availableCommands.find(
        (hint) => hint.command === GameCommandType.BEGIN_SPECIAL_MEMBER_PLAY
      );
    expect(beginHint).toMatchObject({
      enabled: true,
      // Vitest asymmetric matchers are intentionally untyped at this boundary.
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      scope: { objectIds: expect.arrayContaining([sourceObjectId]) },
      params: {
        memberPlayOptionsByObjectId: {
          [sourceObjectId]: [
            {
              id: MIA_SPECIAL_PLAY_MODE,
              label: '特殊登场',
              kind: 'CARD_DEFINED',
              title: '选择特殊登场区域',
              description:
                '将自己休息室中的所有成员卡洗切并放置于卡组底，使此卡本次登场费用减2，再完成特殊登场。',
              targetSlots: [SlotPosition.LEFT, SlotPosition.CENTER, SlotPosition.RIGHT],
              mode: MIA_SPECIAL_PLAY_MODE,
            },
          ],
        },
      },
    });

    const begin = scenario.session.executeCommand(
      createBeginSpecialMemberPlayCommand(
        P1,
        scenario.sourceId,
        SlotPosition.CENTER,
        MIA_SPECIAL_PLAY_MODE
      )
    );
    expect(begin.success, begin.error).toBe(true);
    expect(scenario.session.state!.pendingSpecialMemberPlay).toMatchObject({
      mode: MIA_SPECIAL_PLAY_MODE,
      candidateCardIds: scenario.waitingMemberIds,
      printedCost: 13,
      specialPlayCost: 11,
    });
    const ownerPending = scenario.session.getPlayerViewState(P1).pendingSpecialMemberPlay;
    const opponentPending = scenario.session.getPlayerViewState(P2).pendingSpecialMemberPlay;
    expect(ownerPending).toMatchObject({
      mode: MIA_SPECIAL_PLAY_MODE,
      sourceObjectId,
      candidateObjectIds: scenario.waitingMemberIds.map(createPublicObjectId),
      minSelectableObjects: 0,
      maxSelectableObjects: 0,
      confirmSelectionLabel: '放置于卡组底并登场',
    });
    expect(opponentPending).toEqual({
      id: ownerPending?.id,
      playerSeat: 'FIRST',
      waiting: true,
    });
    expect(JSON.stringify(opponentPending)).not.toContain(scenario.sourceId);
    expect(JSON.stringify(opponentPending)).not.toContain(sourceObjectId);

    const pendingId = scenario.session.state!.pendingSpecialMemberPlay!.id;
    const result = scenario.session.executeCommand(
      createConfirmSpecialMemberPlayCommand(P1, pendingId, [])
    );
    expect(result.success, result.error).toBe(true);
    expect(scenario.session.state!.pendingSpecialMemberPlay).toBeNull();
    expect(scenario.session.state!.players[0].memberSlots.slots[SlotPosition.CENTER]).toBe(
      scenario.sourceId
    );
    expect(scenario.session.state!.players[0].waitingRoom.cardIds).toEqual([
      scenario.waitingLiveId,
    ]);
    expect(
      scenario.activeEnergyIds.filter(
        (cardId) =>
          scenario.session.state!.players[0].energyZone.cardStates.get(cardId)?.orientation ===
          OrientationState.WAITING
      )
    ).toHaveLength(11);

    const movementEvents = scenario.session
      .state!.eventLog.map(({ event }) => event)
      .filter(
        (event) => event.eventType === TriggerCondition.ON_WAITING_ROOM_CARDS_MOVED_TO_MAIN_DECK
      );
    expect(movementEvents).toHaveLength(1);
    expect(movementEvents[0]).toMatchObject({
      // Vitest asymmetric matchers are intentionally untyped at this boundary.
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      movedCardIds: expect.arrayContaining(scenario.waitingMemberIds),
      destination: { kind: 'SHUFFLED_BOTTOM' },
      cause: {
        kind: 'CARD_EFFECT',
        playerId: P1,
        sourceCardId: scenario.sourceId,
        abilityId: COST_ABILITY,
      },
    });
    expect(movementEvents[0] && 'movedCardIds' in movementEvents[0]).toBe(true);
    const movedCardIds =
      movementEvents[0] && 'movedCardIds' in movementEvents[0]
        ? movementEvents[0].movedCardIds
        : [];
    expect(movedCardIds).toHaveLength(scenario.waitingMemberIds.length);
    expect(scenario.session.state!.players[0].mainDeck.cardIds.slice(-movedCardIds.length)).toEqual(
      movedCardIds
    );
    expect(scenario.session.state!.actionHistory.at(-1)?.payload).toMatchObject({
      step: 'CONFIRM_WAITING_MEMBERS_COST_MINUS_TWO',
      printedCost: 13,
      specialPlayCost: 11,
      movedCardIds,
      paidEnergyCount: 11,
    });
  });

  it('keeps the whole special play atomic when energy becomes insufficient', () => {
    const scenario = setupSpecialPlay({ activeEnergyCount: 10 });
    expect(
      scenario.session.executeCommand(
        createBeginSpecialMemberPlayCommand(
          P1,
          scenario.sourceId,
          SlotPosition.LEFT,
          MIA_SPECIAL_PLAY_MODE
        )
      ).success
    ).toBe(true);
    const pendingId = scenario.session.state!.pendingSpecialMemberPlay!.id;
    const authorityBefore = scenario.session.state;
    const waitingBefore = [...scenario.session.state!.players[0].waitingRoom.cardIds];
    const deckBefore = [...scenario.session.state!.players[0].mainDeck.cardIds];

    const result = scenario.session.executeCommand(
      createConfirmSpecialMemberPlayCommand(P1, pendingId, [])
    );
    expect(result.success).toBe(false);
    expect(scenario.session.state).toBe(authorityBefore);
    expect(scenario.session.state!.players[0].waitingRoom.cardIds).toEqual(waitingBefore);
    expect(scenario.session.state!.players[0].mainDeck.cardIds).toEqual(deckBefore);
    expect(scenario.session.state!.players[0].hand.cardIds).toContain(scenario.sourceId);
    expect(scenario.session.state!.pendingSpecialMemberPlay?.id).toBe(pendingId);
    expect(
      scenario.session.state!.eventLog.filter(
        ({ event }) => event.eventType === TriggerCondition.ON_WAITING_ROOM_CARDS_MOVED_TO_MAIN_DECK
      )
    ).toHaveLength(0);
  });

  it('moves the original waiting-room members before a standard single relay and applies the relay discount to base 11', () => {
    const scenario = setupSpecialPlay();
    const player = scenario.session.state!.players[0];
    const occupantId = player.hand.cardIds.find((cardId) => cardId !== scenario.sourceId)!;
    setCardData(
      scenario.session.state!,
      occupantId,
      member('RELAY-OCCUPANT', '被换手成员', 3, ['虹ヶ咲'])
    );
    player.hand.cardIds = player.hand.cardIds.filter((cardId) => cardId !== occupantId);
    player.memberSlots = placeCardInSlot(player.memberSlots, SlotPosition.LEFT, occupantId, {
      orientation: OrientationState.ACTIVE,
      face: FaceState.FACE_UP,
    });
    expect(
      scenario.session.executeCommand(
        createBeginSpecialMemberPlayCommand(
          P1,
          scenario.sourceId,
          SlotPosition.LEFT,
          MIA_SPECIAL_PLAY_MODE
        )
      ).success
    ).toBe(true);
    const pendingId = scenario.session.state!.pendingSpecialMemberPlay!.id;
    const publicSeqBeforeConfirm = scenario.session.getCurrentPublicEventSeq();

    const result = scenario.session.executeCommand(
      createConfirmSpecialMemberPlayCommand(P1, pendingId, [])
    );
    expect(result.success, result.error).toBe(true);
    expect(scenario.session.state!.players[0].memberSlots.slots[SlotPosition.LEFT]).toBe(
      scenario.sourceId
    );
    expect(scenario.session.state!.players[0].waitingRoom.cardIds).toEqual([
      scenario.waitingLiveId,
      occupantId,
    ]);
    const movementEvent = scenario.session
      .state!.eventLog.map(({ event }) => event)
      .find(
        (event) => event.eventType === TriggerCondition.ON_WAITING_ROOM_CARDS_MOVED_TO_MAIN_DECK
      );
    expect(movementEvent).toMatchObject({
      // Vitest asymmetric matchers are intentionally untyped at this boundary.
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      movedCardIds: expect.arrayContaining(scenario.waitingMemberIds),
      destination: { kind: 'SHUFFLED_BOTTOM' },
    });
    expect(
      movementEvent && 'movedCardIds' in movementEvent ? movementEvent.movedCardIds : []
    ).not.toContain(occupantId);
    expect(
      scenario.activeEnergyIds.filter(
        (cardId) =>
          scenario.session.state!.players[0].energyZone.cardStates.get(cardId)?.orientation ===
          OrientationState.WAITING
      )
    ).toHaveLength(8);
    expect(
      scenario.session.state!.actionHistory.filter((action) => action.type === 'PAY_COST').at(-1)
        ?.payload
    ).toMatchObject({
      amount: 8,
      relayDiscount: 3,
      replacedMemberCardId: occupantId,
      relayReplacements: [{ cardId: occupantId, slot: SlotPosition.LEFT, effectiveCost: 3 }],
    });
    expect(scenario.session.state!.actionHistory.at(-1)?.payload).toMatchObject({
      specialPlayCost: 11,
      relayReplacement: occupantId,
      relayDiscount: 3,
      paidEnergyCount: 8,
    });
    expect(
      scenario.session
        .getPublicEventsSince(publicSeqBeforeConfirm)
        .some(
          (event) =>
            event.type === 'CardMovedPublic' &&
            event.card?.publicObjectId === createPublicObjectId(occupantId) &&
            event.from?.zone === ZoneType.MEMBER_SLOT &&
            event.from.slot === SlotPosition.LEFT &&
            event.to?.zone === ZoneType.WAITING_ROOM
        )
    ).toBe(true);
  });

  it('FREE keeps the waiting-room shuffle but ignores energy and moved-slot restrictions', () => {
    const scenario = setupSpecialPlay({ activeEnergyCount: 0 });
    expect(scenario.session.setManualOperationMode('FREE').success).toBe(true);
    const player = scenario.session.state!.players[0];
    const occupantId = player.hand.cardIds.find((cardId) => cardId !== scenario.sourceId)!;
    setCardData(
      scenario.session.state!,
      occupantId,
      member('FREE-RELAY-OCCUPANT', '自由模式换手成员', 3, ['虹ヶ咲'])
    );
    player.hand.cardIds = player.hand.cardIds.filter((cardId) => cardId !== occupantId);
    player.memberSlots = placeCardInSlot(player.memberSlots, SlotPosition.RIGHT, occupantId, {
      orientation: OrientationState.ACTIVE,
      face: FaceState.FACE_UP,
    });
    player.movedToStageThisTurn = [occupantId];

    expect(
      scenario.session.executeCommand(
        createBeginSpecialMemberPlayCommand(
          P1,
          scenario.sourceId,
          SlotPosition.RIGHT,
          MIA_SPECIAL_PLAY_MODE
        )
      ).success
    ).toBe(true);
    const pendingId = scenario.session.state!.pendingSpecialMemberPlay!.id;
    expect(
      scenario.session.executeCommand(createConfirmSpecialMemberPlayCommand(P1, pendingId, []))
        .success
    ).toBe(true);

    expect(scenario.session.state!.players[0].memberSlots.slots[SlotPosition.RIGHT]).toBe(
      scenario.sourceId
    );
    expect(scenario.session.state!.players[0].waitingRoom.cardIds).toEqual([
      scenario.waitingLiveId,
      occupantId,
    ]);
    const finalPayload = scenario.session.state!.actionHistory.at(-1)?.payload;
    expect(finalPayload?.movedCardIds).toEqual(expect.arrayContaining(scenario.waitingMemberIds));
    expect(finalPayload).toMatchObject({
      manualOperationMode: 'FREE',
      relayReplacement: occupantId,
      relayReplacements: [{ cardId: occupantId, slot: SlotPosition.RIGHT, effectiveCost: 3 }],
      relayDiscount: 3,
      paidEnergyCardIds: [],
      paidEnergyCount: 0,
    });
  });

  it('rejects stale or forged special-play confirmation without moving any card', () => {
    const forged = setupSpecialPlay({ waitingMemberCount: 1 });
    expect(
      forged.session.executeCommand(
        createBeginSpecialMemberPlayCommand(
          P1,
          forged.sourceId,
          SlotPosition.RIGHT,
          MIA_SPECIAL_PLAY_MODE
        )
      ).success
    ).toBe(true);
    const forgedPendingId = forged.session.state!.pendingSpecialMemberPlay!.id;
    const forgedBefore = forged.session.state;
    expect(
      forged.session.executeCommand(
        createConfirmSpecialMemberPlayCommand(P1, forgedPendingId, [forged.waitingMemberIds[0]!])
      ).success
    ).toBe(false);
    expect(forged.session.state).toBe(forgedBefore);

    const stale = setupSpecialPlay({ waitingMemberCount: 1 });
    expect(
      stale.session.executeCommand(
        createBeginSpecialMemberPlayCommand(
          P1,
          stale.sourceId,
          SlotPosition.RIGHT,
          MIA_SPECIAL_PLAY_MODE
        )
      ).success
    ).toBe(true);
    const stalePendingId = stale.session.state!.pendingSpecialMemberPlay!.id;
    const staleMemberId = stale.waitingMemberIds[0]!;
    stale.session.state!.players[0].waitingRoom.cardIds =
      stale.session.state!.players[0].waitingRoom.cardIds.filter(
        (cardId) => cardId !== staleMemberId
      );
    // Test setup invalidates the authoritative waiting-room snapshot after BEGIN.
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
    stale.session.state!.players[0].hand.cardIds.push(staleMemberId);
    const authorityBefore = stale.session.state;
    const result = stale.session.executeCommand(
      createConfirmSpecialMemberPlayCommand(P1, stalePendingId, [])
    );
    expect(result.success).toBe(false);
    expect(stale.session.state).toBe(authorityBefore);
    expect(stale.session.state!.players[0].hand.cardIds).toContain(stale.sourceId);
    expect(stale.session.state!.players[0].hand.cardIds).toContain(staleMemberId);
    expect(
      stale.session.state!.eventLog.filter(
        ({ event }) => event.eventType === TriggerCondition.ON_WAITING_ROOM_CARDS_MOVED_TO_MAIN_DECK
      )
    ).toHaveLength(0);
  });

  it('does not expose the special-play entry when the waiting room has no member card', () => {
    const scenario = setupSpecialPlay({ waitingMemberCount: 0 });
    const sourceObjectId = createPublicObjectId(scenario.sourceId);
    const hint = scenario.session
      .getPlayerViewState(P1)
      .permissions.availableCommands.find(
        (candidate) => candidate.command === GameCommandType.BEGIN_SPECIAL_MEMBER_PLAY
      );
    expect(hint?.scope?.objectIds ?? []).not.toContain(sourceObjectId);
    const before = scenario.session.state;
    const result = scenario.session.executeCommand(
      createBeginSpecialMemberPlayCommand(
        P1,
        scenario.sourceId,
        SlotPosition.CENTER,
        MIA_SPECIAL_PLAY_MODE
      )
    );
    expect(result.success).toBe(false);
    expect(scenario.session.state).toBe(before);
    expect(scenario.session.state!.pendingSpecialMemberPlay).toBeNull();
  });
});
