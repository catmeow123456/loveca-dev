import { describe, expect, it } from 'vitest';
import type {
  AnyCardData,
  EnergyCardData,
  MemberCardData,
} from '../../src/domain/entities/card';
import {
  createCardInstance,
  createHeartIcon,
} from '../../src/domain/entities/card';
import { registerCards, updatePlayer, type GameState } from '../../src/domain/entities/game';
import {
  createConfirmEffectStepCommand,
  createPlayMemberToSlotCommand,
} from '../../src/application/game-commands';
import { createGameSession } from '../../src/application/game-session';
import type { DeckConfig } from '../../src/application/game-service';
import { BP5_007_ON_ENTER_RELAY_LOW_COST_HAND_ADJUST_DRAW_ABILITY_ID } from '../../src/application/card-effects/ability-ids';
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

function createMemberCard(cardCode: string, name = cardCode, cost = 1): MemberCardData {
  return {
    cardCode,
    name,
    groupName: "μ's",
    cardType: CardType.MEMBER,
    cost,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.PINK, 1)],
  };
}

function createEnergyCard(cardCode: string): EnergyCardData {
  return {
    cardCode,
    name: `Energy ${cardCode}`,
    cardType: CardType.ENERGY,
  };
}

function createDeck(): DeckConfig {
  const mainDeck: AnyCardData[] = Array.from({ length: 60 }, (_, index) =>
    createMemberCard(`MEM-${index}`, `Member ${index}`)
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

describe('BP5-007 Nozomi hand-adjust workflow', () => {
  it('skips controller discard, opens opponent discard, then draws three for each player', () => {
    const session = createGameSession();
    const deck = createDeck();

    session.createGame(
      'bp5-007-nozomi-skip-controller-discard',
      PLAYER1,
      'Player 1',
      PLAYER2,
      'Player 2'
    );
    session.initializeGame(deck, deck);
    forceMainPhaseForPlayer(session);

    const nozomi = createCardInstance(
      createMemberCard('PL!-bp5-007-AR', '東條 希', 13),
      PLAYER1,
      'p1-bp5-007-nozomi'
    );
    const relayMember = createCardInstance(
      createMemberCard('PL!-test-low-cost-relay', 'Low Cost Relay', 1),
      PLAYER1,
      'p1-low-cost-relay'
    );
    const p1HandCards = Array.from({ length: 2 }, (_, index) =>
      createCardInstance(
        createMemberCard(`PL!-test-p1-hand-${index}`, `P1 hand ${index}`),
        PLAYER1,
        `p1-hand-${index}`
      )
    );
    const p1DrawCards = Array.from({ length: 3 }, (_, index) =>
      createCardInstance(
        createMemberCard(`PL!-test-p1-draw-${index}`, `P1 draw ${index}`),
        PLAYER1,
        `p1-draw-${index}`
      )
    );
    const p2HandCards = Array.from({ length: 5 }, (_, index) =>
      createCardInstance(
        createMemberCard(`PL!-test-p2-hand-${index}`, `P2 hand ${index}`),
        PLAYER2,
        `p2-hand-${index}`
      )
    );
    const p2DrawCards = Array.from({ length: 3 }, (_, index) =>
      createCardInstance(
        createMemberCard(`PL!-test-p2-draw-${index}`, `P2 draw ${index}`),
        PLAYER2,
        `p2-draw-${index}`
      )
    );

    let state = registerCards(session.state!, [
      nozomi,
      relayMember,
      ...p1HandCards,
      ...p1DrawCards,
      ...p2HandCards,
      ...p2DrawCards,
    ]);
    state = updatePlayer(state, PLAYER1, (player) => ({
      ...player,
      hand: {
        ...player.hand,
        cardIds: [nozomi.instanceId, ...p1HandCards.map((card) => card.instanceId)],
      },
      mainDeck: {
        ...player.mainDeck,
        cardIds: p1DrawCards.map((card) => card.instanceId),
      },
      waitingRoom: { ...player.waitingRoom, cardIds: [] },
      successZone: { ...player.successZone, cardIds: [] },
      liveZone: { ...player.liveZone, cardIds: [] },
      memberSlots: {
        ...player.memberSlots,
        slots: {
          [SlotPosition.LEFT]: null,
          [SlotPosition.CENTER]: relayMember.instanceId,
          [SlotPosition.RIGHT]: null,
        },
        cardStates: new Map([
          [
            relayMember.instanceId,
            { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP },
          ],
        ]),
      },
    }));
    state = updatePlayer(state, PLAYER2, (player) => ({
      ...player,
      hand: {
        ...player.hand,
        cardIds: p2HandCards.map((card) => card.instanceId),
      },
      mainDeck: {
        ...player.mainDeck,
        cardIds: p2DrawCards.map((card) => card.instanceId),
      },
      waitingRoom: { ...player.waitingRoom, cardIds: [] },
      successZone: { ...player.successZone, cardIds: [] },
      liveZone: { ...player.liveZone, cardIds: [] },
      memberSlots: {
        ...player.memberSlots,
        slots: {
          [SlotPosition.LEFT]: null,
          [SlotPosition.CENTER]: null,
          [SlotPosition.RIGHT]: null,
        },
        cardStates: new Map(),
      },
    }));
    (session as unknown as { authorityState: GameState }).authorityState = state;

    const playResult = session.executeCommand(
      createPlayMemberToSlotCommand(PLAYER1, nozomi.instanceId, SlotPosition.CENTER, {
        freePlay: true,
      })
    );

    expect(playResult.success).toBe(true);
    expect(session.state?.activeEffect?.abilityId).toBe(
      BP5_007_ON_ENTER_RELAY_LOW_COST_HAND_ADJUST_DRAW_ABILITY_ID
    );
    expect(session.state?.activeEffect?.stepId).toBe('BP5_007_SELECT_HAND_DISCARD_TO_THREE');
    expect(session.state?.activeEffect?.awaitingPlayerId).toBe(PLAYER2);
    expect(session.state?.activeEffect?.selectableCardIds).toEqual(
      p2HandCards.map((card) => card.instanceId)
    );
    expect(session.state?.activeEffect?.selectableCardVisibility).toBe('AWAITING_PLAYER_ONLY');
    expect(session.state?.activeEffect?.selectableCardMode).toBe('ORDERED_MULTI');
    expect(session.state?.activeEffect?.minSelectableCards).toBe(2);
    expect(session.state?.activeEffect?.maxSelectableCards).toBe(2);
    expect(session.state?.activeEffect?.selectionLabel).toBe('请选择要放置入休息室的手牌');
    expect(session.state?.activeEffect?.confirmSelectionLabel).toBe('放置入休息室');
    expect(session.state?.activeEffect?.metadata).toMatchObject({
      orderedResolution: false,
      discardPlayerIds: [PLAYER1, PLAYER2],
      discardPlayerIndex: 1,
      discardCount: 2,
    });

    const startActions = session.state!.actionHistory.filter(
      (action) =>
        action.type === 'RESOLVE_ABILITY' &&
        action.payload.abilityId ===
          BP5_007_ON_ENTER_RELAY_LOW_COST_HAND_ADJUST_DRAW_ABILITY_ID &&
        action.payload.step === 'START_DISCARD_TO_THREE'
    );
    expect(startActions).toHaveLength(1);
    expect(startActions[0]?.playerId).toBe(PLAYER2);
    expect(startActions[0]?.payload).toMatchObject({
      sourceCardId: nozomi.instanceId,
      discardPlayerId: PLAYER2,
      discardCount: 2,
    });

    const p2DiscardIds = p2HandCards.slice(0, 2).map((card) => card.instanceId);
    const discardResult = session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER2,
        session.state!.activeEffect!.id,
        undefined,
        null,
        undefined,
        null,
        p2DiscardIds
      )
    );

    expect(discardResult.success).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].hand.cardIds).toEqual([
      ...p1HandCards.map((card) => card.instanceId),
      ...p1DrawCards.map((card) => card.instanceId),
    ]);
    expect(session.state?.players[1].hand.cardIds).toEqual([
      ...p2HandCards.slice(2).map((card) => card.instanceId),
      ...p2DrawCards.map((card) => card.instanceId),
    ]);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([relayMember.instanceId]);
    expect(session.state?.players[1].waitingRoom.cardIds).toEqual(p2DiscardIds);

    const discardAction = session.state!.actionHistory.find(
      (action) =>
        action.type === 'RESOLVE_ABILITY' &&
        action.payload.abilityId ===
          BP5_007_ON_ENTER_RELAY_LOW_COST_HAND_ADJUST_DRAW_ABILITY_ID &&
        action.payload.step === 'DISCARD_TO_THREE'
    );
    expect(discardAction?.playerId).toBe(PLAYER2);
    expect(discardAction?.payload).toMatchObject({
      sourceCardId: nozomi.instanceId,
      discardPlayerId: PLAYER2,
      discardedCardIds: p2DiscardIds,
    });

    const drawAction = session.state!.actionHistory.find(
      (action) =>
        action.type === 'RESOLVE_ABILITY' &&
        action.payload.abilityId ===
          BP5_007_ON_ENTER_RELAY_LOW_COST_HAND_ADJUST_DRAW_ABILITY_ID &&
        action.payload.step === 'DRAW_THREE_AFTER_HAND_ADJUST'
    );
    expect(drawAction?.playerId).toBe(PLAYER1);
    expect(drawAction?.payload).toMatchObject({
      sourceCardId: nozomi.instanceId,
      drawnCardIdsByPlayer: {
        [PLAYER1]: p1DrawCards.map((card) => card.instanceId),
        [PLAYER2]: p2DrawCards.map((card) => card.instanceId),
      },
    });
  });
});
