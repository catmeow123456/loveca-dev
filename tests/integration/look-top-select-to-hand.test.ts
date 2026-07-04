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
import {
  createConfirmEffectStepCommand,
  createMovePublicCardToWaitingRoomCommand,
} from '../../src/application/game-commands';
import { createGameSession } from '../../src/application/game-session';
import type { DeckConfig } from '../../src/application/game-service';
import { HS_BP2_013_LEAVE_STAGE_LOOK_TOP_LIVE_ABILITY_ID } from '../../src/application/card-effects/ability-ids';
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
  ZoneType,
} from '../../src/shared/types/enums';

const PLAYER1 = 'player1';
const PLAYER2 = 'player2';

function createMemberCard(cardCode: string, name = cardCode, cost = 1): MemberCardData {
  return {
    cardCode,
    name,
    groupNames: ['莲之空女学院学园偶像俱乐部'],
    cardType: CardType.MEMBER,
    cost,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.BLUE, 1)],
  };
}

function createLiveCard(cardCode: string, name = cardCode): LiveCardData {
  return {
    cardCode,
    name,
    groupNames: ['莲之空女学院学园偶像俱乐部'],
    cardType: CardType.LIVE,
    score: 3,
    requirements: createHeartRequirement({ [HeartColor.BLUE]: 1 }),
  };
}

function createEnergyCard(cardCode: string): EnergyCardData {
  return {
    cardCode,
    name: cardCode,
    cardType: CardType.ENERGY,
  };
}

function createDeck(): DeckConfig {
  const mainDeck: AnyCardData[] = Array.from({ length: 60 }, (_, index) =>
    createMemberCard(`MEM-${index}`)
  );
  const energyDeck = Array.from({ length: 12 }, (_, index) => createEnergyCard(`ENE-${index}`));
  return { mainDeck, energyDeck };
}

function forceMainPhaseForPlayer(session: ReturnType<typeof createGameSession>): void {
  const state = session.state as unknown as {
    currentPhase: GamePhase;
    currentSubPhase: SubPhase;
    currentTurnType: TurnType;
    activePlayerIndex: number;
    waitingPlayerId: string | null;
  };

  state.currentPhase = GamePhase.MAIN_PHASE;
  state.currentSubPhase = SubPhase.MAIN_FREE;
  state.currentTurnType = TurnType.NORMAL;
  state.activePlayerIndex = 0;
  state.waitingPlayerId = null;
}

describe('look top select to hand shared workflow', () => {
  it('executes PL!HS-bp2-013-N leave-stage AUTO to reveal one top-five LIVE card', () => {
    const session = createGameSession();
    const deck = createDeck();

    session.createGame('look-top-select-to-hand-tsuzuri', PLAYER1, 'Player 1', PLAYER2, 'Player 2');
    session.initializeGame(deck, deck);
    forceMainPhaseForPlayer(session);

    const source = createCardInstance(
      createMemberCard('PL!HS-bp2-013-N', '夕霧綴理', 5),
      PLAYER1,
      'p1-hs-bp2-013-source'
    );
    const topCards = [
      createCardInstance(createMemberCard('PL!HS-test-member-0', 'Member 0'), PLAYER1, 'top-0'),
      createCardInstance(createLiveCard('PL!HS-test-live-1', 'Live 1'), PLAYER1, 'top-1-live'),
      createCardInstance(createMemberCard('PL!HS-test-member-2', 'Member 2'), PLAYER1, 'top-2'),
      createCardInstance(createLiveCard('PL!HS-test-live-3', 'Live 3'), PLAYER1, 'top-3-live'),
      createCardInstance(createMemberCard('PL!HS-test-member-4', 'Member 4'), PLAYER1, 'top-4'),
    ];

    const state = registerCards(session.state!, [source, ...topCards]);
    const topFiveCardIds = topCards.map((card) => card.instanceId);
    const selectableLiveCardIds = [topCards[1]!.instanceId, topCards[3]!.instanceId];
    const selectedLiveCardId = topCards[3]!.instanceId;

    const preparedState = updatePlayer(state, PLAYER1, (player) => ({
      ...player,
      hand: { ...player.hand, cardIds: [] },
      mainDeck: { ...player.mainDeck, cardIds: topFiveCardIds },
      waitingRoom: { ...player.waitingRoom, cardIds: [] },
      successZone: { ...player.successZone, cardIds: [] },
      liveZone: { ...player.liveZone, cardIds: [] },
      memberSlots: {
        ...player.memberSlots,
        slots: {
          [SlotPosition.LEFT]: null,
          [SlotPosition.CENTER]: source.instanceId,
          [SlotPosition.RIGHT]: null,
        },
        cardStates: new Map([
          [source.instanceId, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
        ]),
      },
    }));
    (session as unknown as { authorityState: GameState }).authorityState = preparedState;

    const beforeSeq = session.getCurrentPublicEventSeq();
    const moveResult = session.executeCommand(
      createMovePublicCardToWaitingRoomCommand(
        PLAYER1,
        source.instanceId,
        ZoneType.MEMBER_SLOT,
        SlotPosition.CENTER
      )
    );

    expect(moveResult.success).toBe(true);
    expect(
      session.state?.eventLog
        .map((entry) => entry.event)
        .find(
          (event) =>
            event.eventType === TriggerCondition.ON_LEAVE_STAGE &&
            event.cardInstanceId === source.instanceId
        )
    ).toMatchObject({
      eventType: TriggerCondition.ON_LEAVE_STAGE,
      cardInstanceId: source.instanceId,
      fromZone: ZoneType.MEMBER_SLOT,
      fromSlot: SlotPosition.CENTER,
      toZone: ZoneType.WAITING_ROOM,
      controllerId: PLAYER1,
    });
    expect(session.state?.activeEffect?.abilityId).toBe(
      HS_BP2_013_LEAVE_STAGE_LOOK_TOP_LIVE_ABILITY_ID
    );
    expect(session.state?.activeEffect?.inspectionCardIds).toEqual(topFiveCardIds);
    expect(session.state?.activeEffect?.selectableCardIds).toEqual(selectableLiveCardIds);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([source.instanceId]);
    const startedSummary = session
      .getPublicEventsSince(beforeSeq)
      .find((event) => event.type === 'CardEffectSummary' && event.summaryStatus === 'STARTED');
    expect(startedSummary?.type).toBe('CardEffectSummary');
    if (startedSummary?.type === 'CardEffectSummary') {
      expect(startedSummary.abilityId).toBe(HS_BP2_013_LEAVE_STAGE_LOOK_TOP_LIVE_ABILITY_ID);
      expect(startedSummary.effectKind).toBe('DISCARD_LOOK_TOP_SELECT_TO_HAND');
      expect(startedSummary.sourceActionLabel).toBe('离场');
      expect(startedSummary.sourceOrientationCost).toBeUndefined();
      expect(startedSummary.sourceCard?.publicObjectId).toBe(`obj_${source.instanceId}`);
      expect(startedSummary.discardedCostCards).toEqual([]);
      expect(startedSummary.hiddenDiscardedCostCardCount).toBe(0);
      expect(startedSummary.requestedInspectCount).toBe(5);
      expect(startedSummary.actualInspectedCount).toBe(5);
    }

    const revealResult = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id, selectedLiveCardId)
    );

    expect(revealResult.success).toBe(true);
    expect(session.state?.activeEffect?.abilityId).toBe(
      HS_BP2_013_LEAVE_STAGE_LOOK_TOP_LIVE_ABILITY_ID
    );
    expect(session.state?.inspectionZone.revealedCardIds).toContain(selectedLiveCardId);

    const finishResult = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id)
    );

    expect(finishResult.success).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].hand.cardIds).toEqual([selectedLiveCardId]);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([
      source.instanceId,
      topCards[0]!.instanceId,
      topCards[1]!.instanceId,
      topCards[2]!.instanceId,
      topCards[4]!.instanceId,
    ]);
    expect(session.state?.players[0].mainDeck.cardIds).toEqual([]);
    const completedSummary = session
      .getPublicEventsSince(beforeSeq)
      .find((event) => event.type === 'CardEffectSummary' && event.summaryStatus === 'COMPLETED');
    expect(completedSummary?.type).toBe('CardEffectSummary');
    if (completedSummary?.type === 'CardEffectSummary') {
      expect(completedSummary.abilityId).toBe(HS_BP2_013_LEAVE_STAGE_LOOK_TOP_LIVE_ABILITY_ID);
      expect(completedSummary.effectKind).toBe('DISCARD_LOOK_TOP_SELECT_TO_HAND');
      expect(completedSummary.sourceActionLabel).toBe('离场');
      expect(completedSummary.sourceOrientationCost).toBeUndefined();
      expect(completedSummary.discardedCostCards).toEqual([]);
      expect(completedSummary.hiddenDiscardedCostCardCount).toBe(0);
      expect(completedSummary.selectedCards?.map((card) => card.publicObjectId)).toEqual([
        `obj_${selectedLiveCardId}`,
      ]);
      expect(completedSummary.noSelectedCards).toBe(false);
      expect(completedSummary.waitingRoomCardCount).toBe(4);
    }
  });
});
