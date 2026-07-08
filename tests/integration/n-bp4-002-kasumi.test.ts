import { describe, expect, it } from 'vitest';
import type { MemberCardData } from '../../src/domain/entities/card';
import { createCardInstance, createHeartIcon } from '../../src/domain/entities/card';
import {
  createGameState,
  registerCards,
  updatePlayer,
  type GameState,
} from '../../src/domain/entities/game';
import { placeCardInSlot } from '../../src/domain/entities/zone';
import { GameService } from '../../src/application/game-service';
import { confirmActiveEffectStep } from '../../src/application/card-effect-runner';
import { PL_N_BP4_002_LIVE_START_CHOOSE_PLAYER_LOOK_TOP_OPTIONAL_WAITING_ROOM_ABILITY_ID } from '../../src/application/card-effects/ability-ids';
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
    groupNames: ['虹ヶ咲学園スクールアイドル同好会'],
    cardType: CardType.MEMBER,
    cost,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.PINK, 1)],
  };
}

function setupKasumiScenario(options: {
  readonly ownDeckCount?: number;
  readonly opponentDeckCount?: number;
} = {}): {
  readonly game: GameState;
  readonly sourceId: string;
  readonly ownDeckCardIds: readonly string[];
  readonly opponentDeckCardIds: readonly string[];
} {
  const source = createCardInstance(
    createMemberData('PL!N-bp4-002-R', '中須かすみ', 9),
    PLAYER1,
    'kasumi-source'
  );
  const ownDeck = Array.from({ length: options.ownDeckCount ?? 2 }, (_, index) =>
    createCardInstance(
      createMemberData(`PL!N-bp4-002-own-${index}`, `Own Top ${index}`),
      PLAYER1,
      `own-deck-${index}`
    )
  );
  const opponentDeck = Array.from({ length: options.opponentDeckCount ?? 2 }, (_, index) =>
    createCardInstance(
      createMemberData(`PL!N-bp4-002-opponent-${index}`, `Opponent Top ${index}`),
      PLAYER2,
      `opponent-deck-${index}`
    )
  );

  let game = createGameState('n-bp4-002-kasumi', PLAYER1, 'P1', PLAYER2, 'P2');
  game = registerCards(game, [source, ...ownDeck, ...opponentDeck]);
  game = updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, source.instanceId, {
      orientation: OrientationState.ACTIVE,
      face: FaceState.FACE_UP,
    }),
    mainDeck: { ...player.mainDeck, cardIds: ownDeck.map((card) => card.instanceId) },
    waitingRoom: { ...player.waitingRoom, cardIds: [] },
  }));
  game = updatePlayer(game, PLAYER2, (player) => ({
    ...player,
    mainDeck: { ...player.mainDeck, cardIds: opponentDeck.map((card) => card.instanceId) },
    waitingRoom: { ...player.waitingRoom, cardIds: [] },
  }));

  return {
    game,
    sourceId: source.instanceId,
    ownDeckCardIds: ownDeck.map((card) => card.instanceId),
    opponentDeckCardIds: opponentDeck.map((card) => card.instanceId),
  };
}

function startKasumi(game: GameState): GameState {
  const result = new GameService().executeCheckTiming(game, [TriggerCondition.ON_LIVE_START]);
  expect(result.success, result.error).toBe(true);
  return result.gameState;
}

function chooseDeckOwner(game: GameState, selectedOptionId: 'self' | 'opponent'): GameState {
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

function chooseLookTopOption(game: GameState, selectedOptionId: string | null): GameState {
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

describe('PL!N-bp4-002 Kasumi live-start choose player look top workflow', () => {
  it('chooses self, looks at own deck top, and places it into own waiting room', () => {
    const scenario = setupKasumiScenario({ ownDeckCount: 2 });
    const targetSelection = startKasumi(scenario.game);

    expect(targetSelection.activeEffect).toMatchObject({
      abilityId: PL_N_BP4_002_LIVE_START_CHOOSE_PLAYER_LOOK_TOP_OPTIONAL_WAITING_ROOM_ABILITY_ID,
      stepId: 'N_BP4_002_CHOOSE_DECK_OWNER',
      selectableOptions: [
        { id: 'self', label: '自己' },
        { id: 'opponent', label: '对方' },
      ],
    });
    expect(targetSelection.actionHistory.some((action) => action.payload.step === 'START_CONFIRM')).toBe(
      false
    );

    const inspection = chooseDeckOwner(targetSelection, 'self');
    expect(inspection.activeEffect).toMatchObject({
      stepId: 'N_BP4_002_LOOK_TOP_OPTIONAL_WAITING_ROOM',
      inspectionCardIds: [scenario.ownDeckCardIds[0]],
      selectableOptions: [{ id: 'place-waiting-room', label: '放置入休息室' }],
      canSkipSelection: true,
      skipSelectionLabel: '不放置',
    });
    expect(inspection.inspectionContext).toEqual({
      ownerPlayerId: PLAYER1,
      sourceZone: ZoneType.MAIN_DECK,
    });

    const finished = chooseLookTopOption(inspection, 'place-waiting-room');

    expect(finished.activeEffect).toBeNull();
    expect(finished.pendingAbilities).toEqual([]);
    expect(finished.players[0].mainDeck.cardIds).toEqual([scenario.ownDeckCardIds[1]]);
    expect(finished.players[0].waitingRoom.cardIds).toEqual([scenario.ownDeckCardIds[0]]);
    expect(
      finished.eventLog.find(
        (entry) =>
          entry.event.eventType === TriggerCondition.ON_ENTER_WAITING_ROOM &&
          entry.event.cardInstanceId === scenario.ownDeckCardIds[0]
      )?.event
    ).toMatchObject({
      ownerId: PLAYER1,
      controllerId: PLAYER1,
      fromZone: ZoneType.MAIN_DECK,
      toZone: ZoneType.WAITING_ROOM,
    });
  });

  it('chooses opponent, lets controller inspect opponent deck top privately, and mills to opponent waiting room', () => {
    const scenario = setupKasumiScenario({ opponentDeckCount: 2 });
    const inspection = chooseDeckOwner(startKasumi(scenario.game), 'opponent');

    expect(inspection.activeEffect).toMatchObject({
      awaitingPlayerId: PLAYER1,
      inspectionCardIds: [scenario.opponentDeckCardIds[0]],
    });
    expect(inspection.inspectionContext).toEqual({
      ownerPlayerId: PLAYER2,
      viewerPlayerId: PLAYER1,
      sourceZone: ZoneType.MAIN_DECK,
    });

    const objectId = createPublicObjectId(scenario.opponentDeckCardIds[0]!);
    const controllerView = projectPlayerViewState(inspection, PLAYER1);
    const opponentView = projectPlayerViewState(inspection, PLAYER2);
    expect(controllerView.objects[objectId]?.surface).toBe('FRONT');
    expect(opponentView.objects[objectId]?.surface).toBe('BACK');

    const finished = chooseLookTopOption(inspection, 'place-waiting-room');

    expect(finished.players[1].mainDeck.cardIds).toEqual([scenario.opponentDeckCardIds[1]]);
    expect(finished.players[1].waitingRoom.cardIds).toEqual([scenario.opponentDeckCardIds[0]]);
    expect(
      finished.eventLog.some(
        (entry) =>
          entry.event.eventType === TriggerCondition.ON_ENTER_WAITING_ROOM &&
          entry.event.ownerId === PLAYER2 &&
          entry.event.controllerId === PLAYER2 &&
          entry.event.cardInstanceIds?.includes(scenario.opponentDeckCardIds[0]!) === true
      )
    ).toBe(true);
  });

  it('keeps the inspected card on the chosen player deck top when declined and consumes pending', () => {
    const own = setupKasumiScenario({ ownDeckCount: 2 });
    const ownFinished = chooseLookTopOption(chooseDeckOwner(startKasumi(own.game), 'self'), null);
    expect(ownFinished.activeEffect).toBeNull();
    expect(ownFinished.pendingAbilities).toEqual([]);
    expect(ownFinished.players[0].mainDeck.cardIds).toEqual(own.ownDeckCardIds);
    expect(ownFinished.players[0].waitingRoom.cardIds).toEqual([]);

    const opponent = setupKasumiScenario({ opponentDeckCount: 2 });
    const opponentFinished = chooseLookTopOption(
      chooseDeckOwner(startKasumi(opponent.game), 'opponent'),
      null
    );
    expect(opponentFinished.players[1].mainDeck.cardIds).toEqual(opponent.opponentDeckCardIds);
    expect(opponentFinished.players[1].waitingRoom.cardIds).toEqual([]);
  });

  it('no-ops and consumes pending when the chosen player has no deck top card', () => {
    const scenario = setupKasumiScenario({ opponentDeckCount: 0 });
    const finished = chooseDeckOwner(startKasumi(scenario.game), 'opponent');

    expect(finished.activeEffect).toBeNull();
    expect(finished.pendingAbilities).toEqual([]);
    expect(finished.inspectionZone.cardIds).toEqual([]);
    expect(
      finished.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId ===
            PL_N_BP4_002_LIVE_START_CHOOSE_PLAYER_LOOK_TOP_OPTIONAL_WAITING_ROOM_ABILITY_ID &&
          action.payload.step === 'NO_TOP_CARD_TO_LOOK' &&
          action.payload.selectedDeckOwnerId === PLAYER2
      )
    ).toBe(true);
  });

  it('rejects wrong-player, illegal, and stale confirmations without resolving the inspected card', () => {
    const scenario = setupKasumiScenario({ ownDeckCount: 2 });
    const targetSelection = startKasumi(scenario.game);
    expect(
      confirmActiveEffectStep(
        targetSelection,
        PLAYER2,
        targetSelection.activeEffect!.id,
        undefined,
        undefined,
        undefined,
        'self'
      )
    ).toBe(targetSelection);
    expect(
      confirmActiveEffectStep(
        targetSelection,
        PLAYER1,
        targetSelection.activeEffect!.id,
        undefined,
        undefined,
        undefined,
        'invalid'
      )
    ).toBe(targetSelection);

    const inspection = chooseDeckOwner(targetSelection, 'self');
    expect(
      confirmActiveEffectStep(
        inspection,
        PLAYER2,
        inspection.activeEffect!.id,
        undefined,
        undefined,
        undefined,
        'place-waiting-room'
      )
    ).toBe(inspection);
    expect(chooseLookTopOption(inspection, 'invalid')).toBe(inspection);

    const staleInspection: GameState = {
      ...inspection,
      inspectionZone: {
        ...inspection.inspectionZone,
        cardIds: [],
      },
    };
    expect(chooseLookTopOption(staleInspection, 'place-waiting-room')).toBe(staleInspection);
    expect(staleInspection.activeEffect).not.toBeNull();
  });
});
