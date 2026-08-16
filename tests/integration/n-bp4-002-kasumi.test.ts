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
import { createGameSession } from '../../src/application/game-session';
import {
  createAutoAdvancePublicEffectChoiceCommand,
  createConfirmEffectChoiceCommand,
  createConfirmEffectStepCommand,
} from '../../src/application/game-commands';
import { confirmActiveEffectStep } from '../../src/application/card-effect-runner';
import { PL_N_BP4_002_LIVE_START_CHOOSE_PLAYER_LOOK_TOP_OPTIONAL_WAITING_ROOM_ABILITY_ID } from '../../src/application/card-effects/ability-ids';
import { PUBLIC_EFFECT_CHOICE_CONFIRMATION_STEP_ID } from '../../src/application/card-effects/runtime/public-effect-choice-confirmation';
import { createPublicObjectId, projectPlayerViewState } from '../../src/online/projector';
import { continuePublicEffectChoiceForTest } from '../helpers/public-effect-choice';
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
  return continuePublicEffectChoiceForTest(
    confirmActiveEffectStep(
      game,
      PLAYER1,
      game.activeEffect!.id,
      undefined,
      undefined,
      undefined,
      selectedOptionId
    ),
    PLAYER1
  );
}

function chooseLookTopOption(game: GameState, selectedOptionId: string | null): GameState {
  const normalizedOptionId = selectedOptionId ?? 'keep-top';
  return continuePublicEffectChoiceForTest(confirmActiveEffectStep(
    game,
    PLAYER1,
    game.activeEffect!.id,
    undefined,
    undefined,
    undefined,
    normalizedOptionId
  ), PLAYER1);
}

describe('PL!N-bp4-002 Kasumi live-start choose player look top workflow', () => {
  it('chooses self, looks at own deck top, and places it into own waiting room', () => {
    const scenario = setupKasumiScenario({ ownDeckCount: 2 });
    const targetSelection = startKasumi(scenario.game);

    expect(targetSelection.activeEffect).toMatchObject({
      abilityId: PL_N_BP4_002_LIVE_START_CHOOSE_PLAYER_LOOK_TOP_OPTIONAL_WAITING_ROOM_ABILITY_ID,
      stepId: 'N_BP4_002_CHOOSE_DECK_OWNER',
    });
    expect(targetSelection.activeEffect?.effectChoice).toEqual({
      mode: 'SINGLE',
      options: [
        { id: 'self', text: '自己' },
        { id: 'opponent', text: '对方' },
      ],
      minSelections: 1,
      maxSelections: 1,
      publicConfirmation: true,
    });
    expect(targetSelection.activeEffect?.selectableOptions).toBeUndefined();
    expect(targetSelection.actionHistory.some((action) => action.payload.step === 'START_CONFIRM')).toBe(
      false
    );

    const inspection = chooseDeckOwner(targetSelection, 'self');
    expect(inspection.activeEffect).toMatchObject({
      stepId: 'N_BP4_002_LOOK_TOP_OPTIONAL_WAITING_ROOM',
      inspectionCardIds: [scenario.ownDeckCardIds[0]],
      effectChoice: {
        mode: 'SINGLE',
        options: [
          { id: 'keep-top', text: '将检视的卡保留在卡组顶。' },
          { id: 'place-waiting-room', text: '将检视的卡放置入休息室。' },
        ],
      },
      canSkipSelection: false,
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
    const targetSelection = startKasumi(scenario.game);
    let now = 10_000;
    const session = createGameSession({ now: () => now });
    session.restoreRuntimeState({ authorityState: targetSelection, currentPublicSeq: 0 });

    const opponentCannotChooseDeckOwner = session.executeCommand(
      createConfirmEffectChoiceCommand(PLAYER2, targetSelection.activeEffect!.id, {
        selectedEffectOptionIds: ['opponent'],
      })
    );
    expect(opponentCannotChooseDeckOwner.success).toBe(false);

    const deckOwnerSelection = session.executeCommand(
      createConfirmEffectChoiceCommand(PLAYER1, targetSelection.activeEffect!.id, {
        selectedEffectOptionIds: ['opponent'],
      })
    );
    expect(deckOwnerSelection.success, deckOwnerSelection.error).toBe(true);
    const deckOwnerPublicChoice = session.state!.activeEffect!;
    expect(deckOwnerPublicChoice).toMatchObject({
      stepId: PUBLIC_EFFECT_CHOICE_CONFIRMATION_STEP_ID,
      awaitingPlayerId: PLAYER1,
      effectChoice: {
        mode: 'SINGLE',
        options: [
          { id: 'self', text: '自己' },
          { id: 'opponent', text: '对方' },
        ],
        minSelections: 1,
        maxSelections: 1,
        publicConfirmation: true,
        selectedOptionIds: ['opponent'],
      },
    });
    expect(session.state!.inspectionZone.cardIds).toEqual([]);
    expect(session.state!.inspectionContext).toBeNull();
    expect(session.state!.players[1].mainDeck.cardIds).toEqual(scenario.opponentDeckCardIds);

    const deckOwnerControllerView = projectPlayerViewState(session.state!, PLAYER1);
    const deckOwnerOpponentView = projectPlayerViewState(session.state!, PLAYER2);
    expect(deckOwnerControllerView.activeEffect?.effectChoice).toEqual(
      deckOwnerOpponentView.activeEffect?.effectChoice
    );
    expect(deckOwnerControllerView.activeEffect?.effectChoice?.selectedOptionIds).toEqual([
      'opponent',
    ]);

    const deckOwnerDeadline = deckOwnerPublicChoice.publicEffectChoiceAutoAdvanceAt;
    expect(deckOwnerDeadline).toBeGreaterThan(now);
    expect(
      session.executeCommand(
        createAutoAdvancePublicEffectChoiceCommand(
          PLAYER1,
          deckOwnerPublicChoice.id,
          deckOwnerDeadline!
        )
      ).success
    ).toBe(false);
    expect(session.state!.inspectionContext).toBeNull();

    now = deckOwnerDeadline!;
    const deckOwnerAutoAdvance = session.executeCommand(
      createAutoAdvancePublicEffectChoiceCommand(
        PLAYER1,
        deckOwnerPublicChoice.id,
        deckOwnerDeadline!
      )
    );
    expect(deckOwnerAutoAdvance.success, deckOwnerAutoAdvance.error).toBe(true);
    const inspection = session.state!;

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

    const opponentCannotChooseResolution = session.executeCommand(
      createConfirmEffectChoiceCommand(PLAYER2, inspection.activeEffect!.id, {
        selectedEffectOptionIds: ['place-waiting-room'],
      })
    );
    expect(opponentCannotChooseResolution.success).toBe(false);

    const resolutionSelection = session.executeCommand(
      createConfirmEffectChoiceCommand(PLAYER1, inspection.activeEffect!.id, {
        selectedEffectOptionIds: ['place-waiting-room'],
      })
    );
    expect(resolutionSelection.success, resolutionSelection.error).toBe(true);
    const resolutionPublicChoice = session.state!.activeEffect!;
    const resolutionDeadline = resolutionPublicChoice.publicEffectChoiceAutoAdvanceAt;
    expect(resolutionDeadline).toBeGreaterThan(now);
    expect(
      session.executeCommand(
        createAutoAdvancePublicEffectChoiceCommand(
          PLAYER1,
          resolutionPublicChoice.id,
          resolutionDeadline!
        )
      ).success
    ).toBe(false);

    now = resolutionDeadline!;
    const autoAdvance = session.executeCommand(
      createAutoAdvancePublicEffectChoiceCommand(
        PLAYER1,
        resolutionPublicChoice.id,
        resolutionDeadline!
      )
    );
    expect(autoAdvance.success, autoAdvance.error).toBe(true);
    const finished = session.state!;

    expect(finished.activeEffect).toBeNull();
    expect(finished.inspectionZone.cardIds).toEqual([]);
    expect(finished.inspectionContext).toBeNull();
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
    expect(chooseLookTopOption(staleInspection, 'place-waiting-room')).toStrictEqual(
      staleInspection
    );
    expect(staleInspection.activeEffect).not.toBeNull();
  });
});
