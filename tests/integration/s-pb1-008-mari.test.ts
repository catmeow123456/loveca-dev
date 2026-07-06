import { describe, expect, it } from 'vitest';
import type { MemberCardData } from '../../src/domain/entities/card';
import { createCardInstance, createHeartIcon } from '../../src/domain/entities/card';
import {
  createGameState,
  registerCards,
  updatePlayer,
  type GameState,
  type PendingAbilityState,
} from '../../src/domain/entities/game';
import { addCardToZone, placeCardInSlot } from '../../src/domain/entities/zone';
import {
  confirmActiveEffectStep,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import { PL_S_PB1_008_LIVE_START_CHOOSE_PLAYER_LOOK_TOP_TWO_ARRANGE_ABILITY_ID } from '../../src/application/card-effects/ability-ids';
import { createPublicObjectId, projectPlayerViewState } from '../../src/online/projector';
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

function createMemberData(cardCode: string, name = cardCode, cost = 1): MemberCardData {
  return {
    cardCode,
    name,
    groupNames: ['Aqours'],
    cardType: CardType.MEMBER,
    cost,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.YELLOW, 1)],
  };
}

function createMember(cardCode: string, ownerId: string, instanceId: string) {
  return createCardInstance(createMemberData(cardCode), ownerId, instanceId);
}

function createPending(sourceCardId: string, id = `pending-${sourceCardId}`): PendingAbilityState {
  return {
    id,
    abilityId: PL_S_PB1_008_LIVE_START_CHOOSE_PLAYER_LOOK_TOP_TWO_ARRANGE_ABILITY_ID,
    sourceCardId,
    controllerId: PLAYER1,
    mandatory: true,
    timingId: TriggerCondition.ON_LIVE_START,
    eventIds: ['live-start'],
    sourceSlot: SlotPosition.CENTER,
  };
}

function setupScenario(options: {
  readonly ownDeckCount?: number;
  readonly opponentDeckCount?: number;
  readonly sourceOnStage?: boolean;
  readonly withSecondPending?: boolean;
} = {}): {
  readonly game: GameState;
  readonly sourceId: string;
  readonly secondSourceId: string;
  readonly ownDeckCardIds: readonly string[];
  readonly opponentDeckCardIds: readonly string[];
} {
  const source = createMember('PL!S-pb1-008-R', PLAYER1, 'mari-source');
  const secondSource = createMember('PL!S-pb1-008-P＋', PLAYER1, 'mari-second-source');
  const ownDeck = Array.from({ length: options.ownDeckCount ?? 2 }, (_, index) =>
    createMember(`PL!S-pb1-008-own-deck-${index}`, PLAYER1, `own-deck-${index}`)
  );
  const opponentDeck = Array.from({ length: options.opponentDeckCount ?? 2 }, (_, index) =>
    createMember(`PL!S-pb1-008-opponent-deck-${index}`, PLAYER2, `opponent-deck-${index}`)
  );

  let game = createGameState('s-pb1-008-mari', PLAYER1, 'P1', PLAYER2, 'P2');
  game = registerCards(game, [source, secondSource, ...ownDeck, ...opponentDeck]);
  game = updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    mainDeck: ownDeck.reduce((zone, card) => addCardToZone(zone, card.instanceId), player.mainDeck),
    waitingRoom:
      options.sourceOnStage === false
        ? addCardToZone(player.waitingRoom, source.instanceId)
        : player.waitingRoom,
    memberSlots:
      options.sourceOnStage === false
        ? player.memberSlots
        : placeCardInSlot(
            options.withSecondPending
              ? placeCardInSlot(player.memberSlots, SlotPosition.LEFT, secondSource.instanceId, {
                  orientation: OrientationState.ACTIVE,
                  face: FaceState.FACE_UP,
                })
              : player.memberSlots,
            SlotPosition.CENTER,
            source.instanceId,
            { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }
          ),
  }));
  game = updatePlayer(game, PLAYER2, (player) => ({
    ...player,
    mainDeck: opponentDeck.reduce(
      (zone, card) => addCardToZone(zone, card.instanceId),
      player.mainDeck
    ),
  }));

  return {
    game,
    sourceId: source.instanceId,
    secondSourceId: secondSource.instanceId,
    ownDeckCardIds: ownDeck.map((card) => card.instanceId),
    opponentDeckCardIds: opponentDeck.map((card) => card.instanceId),
  };
}

function startMari(
  game: GameState,
  sourceId: string,
  pendingAbilities: readonly PendingAbilityState[] = [createPending(sourceId)]
): GameState {
  return resolvePendingCardEffects({
    ...game,
    pendingAbilities,
  }).gameState;
}

function chooseTarget(game: GameState, selectedOptionId: 'self' | 'opponent'): GameState {
  return confirmActiveEffectStep(
    game,
    PLAYER1,
    game.activeEffect!.id,
    undefined,
    undefined,
    undefined,
    selectedOptionId
  );
}

function arrangeTop(game: GameState, selectedCardIds: readonly string[]): GameState {
  return confirmActiveEffectStep(
    game,
    PLAYER1,
    game.activeEffect!.id,
    undefined,
    undefined,
    undefined,
    undefined,
    selectedCardIds
  );
}

describe('PL!S-pb1-008 Mari live-start target deck arrange workflow', () => {
  it('chooses self, returns a selected subset or all cards to own deck top, and mills the rest', () => {
    const partial = setupScenario({ ownDeckCount: 3 });
    const partialInspection = chooseTarget(startMari(partial.game, partial.sourceId), 'self');
    const partialFinished = arrangeTop(partialInspection, [partial.ownDeckCardIds[1]!]);

    expect(partialFinished.activeEffect).toBeNull();
    expect(partialFinished.players[0].mainDeck.cardIds).toEqual([
      partial.ownDeckCardIds[1],
      partial.ownDeckCardIds[2],
    ]);
    expect(partialFinished.players[0].waitingRoom.cardIds).toEqual([partial.ownDeckCardIds[0]]);

    const all = setupScenario({ ownDeckCount: 2 });
    const allInspection = chooseTarget(startMari(all.game, all.sourceId), 'self');
    const allFinished = arrangeTop(allInspection, [all.ownDeckCardIds[1]!, all.ownDeckCardIds[0]!]);

    expect(allFinished.players[0].mainDeck.cardIds).toEqual([
      all.ownDeckCardIds[1],
      all.ownDeckCardIds[0],
    ]);
    expect(allFinished.players[0].waitingRoom.cardIds).toEqual([]);
  });

  it('chooses opponent, lets the controller arrange opponent deck, mills to opponent waiting room, and hides private info', () => {
    const scenario = setupScenario({ opponentDeckCount: 3 });
    const targetSelection = startMari(scenario.game, scenario.sourceId);

    expect(targetSelection.activeEffect).toMatchObject({
      abilityId: PL_S_PB1_008_LIVE_START_CHOOSE_PLAYER_LOOK_TOP_TWO_ARRANGE_ABILITY_ID,
      selectableOptions: [
        { id: 'self', label: '自己' },
        { id: 'opponent', label: '对方' },
      ],
      awaitingPlayerId: PLAYER1,
    });

    const inspection = chooseTarget(targetSelection, 'opponent');
    expect(inspection.activeEffect).toMatchObject({
      awaitingPlayerId: PLAYER1,
      selectableCardIds: [scenario.opponentDeckCardIds[0], scenario.opponentDeckCardIds[1]],
      selectableCardVisibility: 'AWAITING_PLAYER_ONLY',
    });
    expect(inspection.inspectionContext).toEqual({
      ownerPlayerId: PLAYER2,
      viewerPlayerId: PLAYER1,
      sourceZone: ZoneType.MAIN_DECK,
    });

    const firstObjectId = createPublicObjectId(scenario.opponentDeckCardIds[0]!);
    const secondObjectId = createPublicObjectId(scenario.opponentDeckCardIds[1]!);
    const controllerView = projectPlayerViewState(inspection, PLAYER1);
    const opponentView = projectPlayerViewState(inspection, PLAYER2);
    expect(controllerView.activeEffect?.selectableObjectIds).toEqual([
      firstObjectId,
      secondObjectId,
    ]);
    expect(controllerView.objects[firstObjectId]?.surface).toBe('FRONT');
    expect(opponentView.activeEffect?.selectableObjectIds).toBeUndefined();
    expect(opponentView.objects[firstObjectId]?.surface).toBe('BACK');

    const finished = arrangeTop(inspection, [scenario.opponentDeckCardIds[1]!]);
    expect(finished.players[1].mainDeck.cardIds).toEqual([
      scenario.opponentDeckCardIds[1],
      scenario.opponentDeckCardIds[2],
    ]);
    expect(finished.players[1].waitingRoom.cardIds).toEqual([scenario.opponentDeckCardIds[0]]);
    expect(
      finished.eventLog.some(
        (entry) =>
          entry.event.eventType === TriggerCondition.ON_ENTER_WAITING_ROOM &&
          entry.event.ownerId === PLAYER2 &&
          entry.event.controllerId === PLAYER2 &&
          entry.event.fromZone === ZoneType.MAIN_DECK &&
          entry.event.cardInstanceIds?.includes(scenario.opponentDeckCardIds[0]!) === true
      )
    ).toBe(true);
  });

  it('moves both inspected cards to the chosen player waiting room when selecting zero cards', () => {
    const scenario = setupScenario();
    const inspection = chooseTarget(startMari(scenario.game, scenario.sourceId), 'opponent');
    const finished = arrangeTop(inspection, []);

    expect(finished.players[1].mainDeck.cardIds).toEqual([]);
    expect(finished.players[1].waitingRoom.cardIds).toEqual([
      scenario.opponentDeckCardIds[0],
      scenario.opponentDeckCardIds[1],
    ]);
  });

  it('rejects illegal, duplicate, and stale selected ids without moving inspected cards', () => {
    const scenario = setupScenario({ ownDeckCount: 3 });
    const inspection = chooseTarget(startMari(scenario.game, scenario.sourceId), 'self');

    expect(arrangeTop(inspection, [scenario.ownDeckCardIds[0]!, scenario.ownDeckCardIds[0]!])).toBe(
      inspection
    );
    expect(arrangeTop(inspection, [scenario.ownDeckCardIds[2]!])).toBe(inspection);
    expect(arrangeTop(inspection, ['not-a-card'])).toBe(inspection);
    expect(inspection.players[0].mainDeck.cardIds).toEqual([scenario.ownDeckCardIds[2]]);
    expect(inspection.inspectionZone.cardIds).toEqual([
      scenario.ownDeckCardIds[0],
      scenario.ownDeckCardIds[1],
    ]);
  });

  it('does not start when the source is off stage and safely consumes an empty chosen deck', () => {
    const offStage = setupScenario({ sourceOnStage: false });
    const offStageResult = startMari(offStage.game, offStage.sourceId);

    expect(offStageResult.activeEffect).toBeNull();
    expect(offStageResult.pendingAbilities).toHaveLength(0);
    expect(
      offStageResult.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.step === 'SOURCE_NOT_ON_STAGE' &&
          action.payload.abilityId ===
            PL_S_PB1_008_LIVE_START_CHOOSE_PLAYER_LOOK_TOP_TWO_ARRANGE_ABILITY_ID
      )
    ).toBe(true);

    const empty = setupScenario({ opponentDeckCount: 0 });
    const emptyResult = chooseTarget(startMari(empty.game, empty.sourceId), 'opponent');
    expect(emptyResult.activeEffect).toBeNull();
    expect(emptyResult.pendingAbilities).toHaveLength(0);
    expect(emptyResult.inspectionZone.cardIds).toEqual([]);
  });

  it('continues to the next pending ability after finishing this effect', () => {
    const scenario = setupScenario({ ownDeckCount: 3, withSecondPending: true });
    const orderSelection = startMari(scenario.game, scenario.sourceId, [
      createPending(scenario.sourceId, 'mari-first'),
      createPending(scenario.secondSourceId, 'mari-second'),
    ]);
    expect(orderSelection.activeEffect).toMatchObject({
      abilityId: 'system:select-pending-card-effect',
      stepId: 'SELECT_NEXT_PENDING_ABILITY',
      awaitingPlayerId: PLAYER1,
    });
    const startedFirst = confirmActiveEffectStep(
      orderSelection,
      PLAYER1,
      orderSelection.activeEffect!.id,
      undefined,
      undefined,
      true
    );
    const inspection = chooseTarget(startedFirst, 'self');
    const finishedFirst = arrangeTop(inspection, [scenario.ownDeckCardIds[0]!]);

    expect(finishedFirst.activeEffect).toMatchObject({
      id: 'mari-second',
      abilityId: PL_S_PB1_008_LIVE_START_CHOOSE_PLAYER_LOOK_TOP_TWO_ARRANGE_ABILITY_ID,
      sourceCardId: scenario.secondSourceId,
      stepId: 'PL_S_PB1_008_CHOOSE_TARGET_PLAYER',
      awaitingPlayerId: PLAYER1,
    });
  });
});
