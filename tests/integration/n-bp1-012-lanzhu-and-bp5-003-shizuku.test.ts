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
import { registerCards, type GameState } from '../../src/domain/entities/game';
import {
  createActivateAbilityCommand,
  createConfirmEffectStepCommand,
} from '../../src/application/game-commands';
import { createGameSession } from '../../src/application/game-session';
import type { DeckConfig } from '../../src/application/game-service';
import {
  PL_N_BP1_012_ACTIVATED_PAY_THREE_ENERGY_RECOVER_LIVE_ABILITY_ID,
  PL_N_BP5_003_ACTIVATED_DISCARD_PAY_SCORE_RECOVER_LIVE_ABILITY_ID,
} from '../../src/application/card-effects/ability-ids';
import {
  CardType,
  FaceState,
  GamePhase,
  HeartColor,
  OrientationState,
  SlotPosition,
  SubPhase,
  TurnType,
} from '../../src/shared/types/enums';

const PLAYER1 = 'player1';
const PLAYER2 = 'player2';

function createMember(cardCode: string, name: string, cost: number): MemberCardData {
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

function createLive(cardCode: string, name: string, score: number): LiveCardData {
  return {
    cardCode,
    name,
    groupNames: ['虹ヶ咲学園スクールアイドル同好会'],
    cardType: CardType.LIVE,
    score,
    requirements: createHeartRequirement({ [HeartColor.PINK]: 1 }),
  };
}

function createEnergy(cardCode: string): EnergyCardData {
  return {
    cardCode,
    name: cardCode,
    cardType: CardType.ENERGY,
  };
}

function createDeck(): DeckConfig {
  return {
    mainDeck: Array.from({ length: 20 }, (_, index) =>
      createMember(`FILLER-M-${index}`, `Member ${index}`, 1)
    ) as AnyCardData[],
    energyDeck: Array.from({ length: 12 }, (_, index) => createEnergy(`FILLER-E-${index}`)),
  };
}

function setupActivatedScenario(options: {
  readonly sourceCardCode: string;
  readonly sourceName: string;
  readonly sourceCost: number;
  readonly handCards?: readonly ReturnType<typeof createCardInstance>[];
  readonly waitingRoomCards?: readonly ReturnType<typeof createCardInstance>[];
  readonly energyCount?: number;
}) {
  const session = createGameSession();
  const deck = createDeck();
  session.createGame('n-activated-effects', PLAYER1, 'P1', PLAYER2, 'P2');
  session.initializeGame(deck, deck);

  const source = createCardInstance(
    createMember(options.sourceCardCode, options.sourceName, options.sourceCost),
    PLAYER1,
    'source-member'
  );
  const energyCards = Array.from({ length: options.energyCount ?? 0 }, (_, index) =>
    createCardInstance(createEnergy(`ENERGY-${index}`), PLAYER1, `energy-${index}`)
  );
  const handCards = [...(options.handCards ?? [])];
  const waitingRoomCards = [...(options.waitingRoomCards ?? [])];
  const state = registerCards(session.state!, [
    source,
    ...energyCards,
    ...handCards,
    ...waitingRoomCards,
  ]);
  (session as unknown as { authorityState: GameState }).authorityState = state;

  const mutableState = state as unknown as {
    currentPhase: GamePhase;
    currentSubPhase: SubPhase;
    currentTurnType: TurnType;
    activePlayerIndex: number;
    waitingPlayerId: string | null;
  };
  mutableState.currentPhase = GamePhase.MAIN_PHASE;
  mutableState.currentSubPhase = SubPhase.NONE;
  mutableState.currentTurnType = TurnType.NORMAL;
  mutableState.activePlayerIndex = 0;
  mutableState.waitingPlayerId = null;

  const player = state.players[0] as unknown as {
    hand: { cardIds: string[] };
    waitingRoom: { cardIds: string[] };
    energyZone: {
      cardIds: string[];
      cardStates: Map<string, { orientation: OrientationState; face: FaceState }>;
    };
    memberSlots: {
      slots: Record<SlotPosition, string | null>;
      cardStates: Map<string, { orientation: OrientationState; face: FaceState }>;
    };
  };
  player.hand.cardIds = handCards.map((card) => card.instanceId);
  player.waitingRoom.cardIds = waitingRoomCards.map((card) => card.instanceId);
  player.energyZone.cardIds = energyCards.map((card) => card.instanceId);
  player.energyZone.cardStates = new Map(
    energyCards.map((card) => [
      card.instanceId,
      { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP },
    ])
  );
  player.memberSlots.slots = {
    [SlotPosition.LEFT]: null,
    [SlotPosition.CENTER]: source.instanceId,
    [SlotPosition.RIGHT]: null,
  };
  player.memberSlots.cardStates = new Map([
    [source.instanceId, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
  ]);

  return {
    session,
    sourceId: source.instanceId,
    energyCardIds: energyCards.map((card) => card.instanceId),
  };
}

function confirmActiveEffect(
  session: ReturnType<typeof createGameSession>,
  options: {
    readonly selectedCardId?: string | null;
    readonly selectedOptionId?: string | null;
  } = {}
) {
  const effect = session.state?.activeEffect;
  expect(effect).not.toBeNull();
  return session.executeCommand(
    createConfirmEffectStepCommand(
      PLAYER1,
      effect!.id,
      options.selectedCardId,
      null,
      false,
      options.selectedOptionId
    )
  );
}

describe('PL!N-bp1-012 Lanzhu and PL!N-bp5-003 Shizuku activated workflows', () => {
  it('PL!N-bp1-012-SEC pays three energy and recovers any waiting-room LIVE', () => {
    const live = createCardInstance(
      createLive('PL!N-test-live-L', 'Test Live', 2),
      PLAYER1,
      'live'
    );
    const scenario = setupActivatedScenario({
      sourceCardCode: 'PL!N-bp1-012-SEC',
      sourceName: '鐘 嵐珠',
      sourceCost: 15,
      waitingRoomCards: [live],
      energyCount: 3,
    });

    const activateResult = scenario.session.executeCommand(
      createActivateAbilityCommand(
        PLAYER1,
        scenario.sourceId,
        PL_N_BP1_012_ACTIVATED_PAY_THREE_ENERGY_RECOVER_LIVE_ABILITY_ID
      )
    );
    expect(activateResult.success, activateResult.error).toBe(true);
    expect(scenario.session.state?.activeEffect?.selectableCardIds).toEqual([live.instanceId]);

    const confirmResult = confirmActiveEffect(scenario.session, {
      selectedCardId: live.instanceId,
    });
    expect(confirmResult.success, confirmResult.error).toBe(true);

    confirmPublicSelectionIfNeeded(scenario.session);
    const player = scenario.session.state!.players[0];
    expect(player.hand.cardIds).toContain(live.instanceId);
    expect(player.waitingRoom.cardIds).not.toContain(live.instanceId);
    expect(
      scenario.energyCardIds.every(
        (cardId) =>
          player.energyZone.cardStates.get(cardId)?.orientation === OrientationState.WAITING
      )
    ).toBe(true);
  });

  it('PL!N-bp5-003-AR discards a hand card, pays zero for a score 0 LIVE, and recovers it', () => {
    const discard = createCardInstance(
      createMember('HAND-CARD', 'Hand Card', 1),
      PLAYER1,
      'discard'
    );
    const zeroLive = createCardInstance(
      createLive('PL!N-zero-live-L', 'Zero Live', 0),
      PLAYER1,
      'zero-live'
    );
    const scenario = setupActivatedScenario({
      sourceCardCode: 'PL!N-bp5-003-AR',
      sourceName: '桜坂しずく',
      sourceCost: 11,
      handCards: [discard],
      waitingRoomCards: [zeroLive],
      energyCount: 0,
    });

    const activateResult = scenario.session.executeCommand(
      createActivateAbilityCommand(
        PLAYER1,
        scenario.sourceId,
        PL_N_BP5_003_ACTIVATED_DISCARD_PAY_SCORE_RECOVER_LIVE_ABILITY_ID
      )
    );
    expect(activateResult.success, activateResult.error).toBe(true);
    expect(
      confirmActiveEffect(scenario.session, { selectedCardId: discard.instanceId }).success
    ).toBe(true);
    expect(scenario.session.state?.activeEffect?.selectableCardIds).toEqual([zeroLive.instanceId]);
    expect(
      confirmActiveEffect(scenario.session, { selectedCardId: zeroLive.instanceId }).success
    ).toBe(true);
    confirmPublicSelectionIfNeeded(scenario.session);
    expect(scenario.session.state?.activeEffect?.selectableOptions).toEqual([
      { id: 'pay', label: '支付0能量' },
      { id: 'decline', label: '不支付' },
    ]);
    expect(confirmActiveEffect(scenario.session, { selectedOptionId: 'pay' }).success).toBe(true);

    const player = scenario.session.state!.players[0];
    expect(player.hand.cardIds).toContain(zeroLive.instanceId);
    expect(player.waitingRoom.cardIds).toContain(discard.instanceId);
  });

  it('PL!N-bp5-003-AR pays a selected LIVE score in active energy before recovery', () => {
    const discard = createCardInstance(
      createMember('HAND-CARD', 'Hand Card', 1),
      PLAYER1,
      'discard'
    );
    const scoreLive = createCardInstance(
      createLive('PL!N-score-live-L', 'Score Live', 2),
      PLAYER1,
      'score-live'
    );
    const scenario = setupActivatedScenario({
      sourceCardCode: 'PL!N-bp5-003-AR',
      sourceName: '桜坂しずく',
      sourceCost: 11,
      handCards: [discard],
      waitingRoomCards: [scoreLive],
      energyCount: 2,
    });

    expect(
      scenario.session.executeCommand(
        createActivateAbilityCommand(
          PLAYER1,
          scenario.sourceId,
          PL_N_BP5_003_ACTIVATED_DISCARD_PAY_SCORE_RECOVER_LIVE_ABILITY_ID
        )
      ).success
    ).toBe(true);
    expect(
      confirmActiveEffect(scenario.session, { selectedCardId: discard.instanceId }).success
    ).toBe(true);
    expect(
      confirmActiveEffect(scenario.session, { selectedCardId: scoreLive.instanceId }).success
    ).toBe(true);
    confirmPublicSelectionIfNeeded(scenario.session);
    expect(confirmActiveEffect(scenario.session, { selectedOptionId: 'pay' }).success).toBe(true);

    const player = scenario.session.state!.players[0];
    expect(player.hand.cardIds).toContain(scoreLive.instanceId);
    expect(
      scenario.energyCardIds.every(
        (cardId) =>
          player.energyZone.cardStates.get(cardId)?.orientation === OrientationState.WAITING
      )
    ).toBe(true);
  });

  it('PL!N-bp5-003-AR keeps the discard cost and does not recover when payment is declined', () => {
    const discard = createCardInstance(
      createMember('HAND-CARD', 'Hand Card', 1),
      PLAYER1,
      'discard'
    );
    const scoreLive = createCardInstance(
      createLive('PL!N-score-live-L', 'Score Live', 2),
      PLAYER1,
      'score-live'
    );
    const scenario = setupActivatedScenario({
      sourceCardCode: 'PL!N-bp5-003-AR',
      sourceName: '桜坂しずく',
      sourceCost: 11,
      handCards: [discard],
      waitingRoomCards: [scoreLive],
      energyCount: 1,
    });

    expect(
      scenario.session.executeCommand(
        createActivateAbilityCommand(
          PLAYER1,
          scenario.sourceId,
          PL_N_BP5_003_ACTIVATED_DISCARD_PAY_SCORE_RECOVER_LIVE_ABILITY_ID
        )
      ).success
    ).toBe(true);
    expect(
      confirmActiveEffect(scenario.session, { selectedCardId: discard.instanceId }).success
    ).toBe(true);
    expect(
      confirmActiveEffect(scenario.session, { selectedCardId: scoreLive.instanceId }).success
    ).toBe(true);
    confirmPublicSelectionIfNeeded(scenario.session);
    expect(scenario.session.state?.activeEffect?.selectableOptions).toEqual([
      { id: 'decline', label: '不支付' },
    ]);
    expect(confirmActiveEffect(scenario.session, { selectedOptionId: 'decline' }).success).toBe(
      true
    );

    const player = scenario.session.state!.players[0];
    expect(player.hand.cardIds).not.toContain(scoreLive.instanceId);
    expect(player.waitingRoom.cardIds).toEqual(
      expect.arrayContaining([discard.instanceId, scoreLive.instanceId])
    );
    expect(
      scenario.energyCardIds.every(
        (cardId) =>
          player.energyZone.cardStates.get(cardId)?.orientation === OrientationState.ACTIVE
      )
    ).toBe(true);
  });
});
