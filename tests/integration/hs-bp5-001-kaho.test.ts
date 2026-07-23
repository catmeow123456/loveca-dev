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
  createConfirmEffectStepCommand,
  createPlayMemberToSlotCommand,
} from '../../src/application/game-commands';
import { createGameSession } from '../../src/application/game-session';
import type { DeckConfig } from '../../src/application/game-service';
import { HS_BP5_001_ON_ENTER_MILL_GAIN_BLADE_ABILITY_ID } from '../../src/application/card-effects/ability-ids';
import {
  CardType,
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
    groupNames: ['莲之空'],
    cardType: CardType.MEMBER,
    cost,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.PINK, 1)],
  };
}

function createEnergyCard(cardCode: string): EnergyCardData {
  return {
    cardCode,
    name: cardCode,
    cardType: CardType.ENERGY,
  };
}

function createLiveCard(cardCode: string, name = cardCode): LiveCardData {
  return {
    cardCode,
    name,
    groupNames: ['莲之空'],
    cardType: CardType.LIVE,
    score: 3,
    requirements: createHeartRequirement({ [HeartColor.PINK]: 1 }),
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
  const state = session.state!;
  const mutableState = state as unknown as {
    currentPhase: GamePhase;
    currentSubPhase: SubPhase;
    currentTurnType: TurnType;
    activePlayerIndex: number;
  };
  mutableState.currentPhase = GamePhase.MAIN_PHASE;
  mutableState.currentSubPhase = SubPhase.MAIN_FREE;
  mutableState.currentTurnType = TurnType.NORMAL;
  mutableState.activePlayerIndex = 0;
}

function removeFromPlayerZones(player: {
  hand: { cardIds: string[] };
  mainDeck: { cardIds: string[] };
  waitingRoom: { cardIds: string[] };
  successZone: { cardIds: string[] };
  liveZone: { cardIds: string[] };
}): void {
  player.hand.cardIds = [];
  player.mainDeck.cardIds = [];
  player.waitingRoom.cardIds = [];
  player.successZone.cardIds = [];
  player.liveZone.cardIds = [];
}

describe('HS-bp5-001 Kaho workflow', () => {
  it('mills top four without adding Blade when no revealed card is Live', () => {
    const session = createGameSession();
    const deck = createDeck();

    session.createGame('hs-bp5-001-no-live-mill', PLAYER1, 'Player 1', PLAYER2, 'Player 2');
    session.initializeGame(deck, deck);
    forceMainPhaseForPlayer(session);

    const kaho = createCardInstance(
      createMemberCard('PL!HS-bp5-001-SEC', '日野下花帆', 11),
      PLAYER1,
      'p1-hs-bp5-001-kaho'
    );
    const topCards = [0, 1, 2, 3].map((index) =>
      createCardInstance(
        createMemberCard(`PL!HS-bp5-001-test-member-${index}`, `Member ${index}`),
        PLAYER1,
        `p1-hs-bp5-001-top-${index}`
      )
    );
    const remainingDeckCard = createCardInstance(
      createMemberCard('PL!HS-bp5-001-test-remaining', 'Remaining'),
      PLAYER1,
      'p1-hs-bp5-001-remaining'
    );
    const state = registerCards(session.state!, [kaho, ...topCards, remainingDeckCard]);
    (session as unknown as { authorityState: GameState }).authorityState = state;

    const p1 = state.players[0] as unknown as {
      hand: { cardIds: string[] };
      mainDeck: { cardIds: string[] };
      waitingRoom: { cardIds: string[] };
      successZone: { cardIds: string[] };
      liveZone: { cardIds: string[] };
      memberSlots: {
        slots: Record<SlotPosition, string | null>;
        cardStates: Map<string, { orientation: OrientationState }>;
      };
    };
    const topCardIds = topCards.map((card) => card.instanceId);

    removeFromPlayerZones(p1);
    p1.hand.cardIds = [kaho.instanceId];
    p1.mainDeck.cardIds = [...topCardIds, remainingDeckCard.instanceId];
    p1.memberSlots.slots = {
      [SlotPosition.LEFT]: null,
      [SlotPosition.CENTER]: null,
      [SlotPosition.RIGHT]: null,
    };
    p1.memberSlots.cardStates = new Map();

    session.setManualOperationMode('FREE');
    const playResult = session.executeCommand(
      createPlayMemberToSlotCommand(PLAYER1, kaho.instanceId, SlotPosition.CENTER, {
        freePlay: true,
      })
    );

    expect(playResult.success).toBe(true);
    expect(session.state?.activeEffect?.abilityId).toBe(
      HS_BP5_001_ON_ENTER_MILL_GAIN_BLADE_ABILITY_ID
    );
    expect(session.state?.activeEffect?.stepId).toBe('HS_BP5_001_REVEAL_TOP_FOUR');
    expect(session.state?.activeEffect?.revealedCardIds).toEqual(topCardIds);
    expect(session.state?.activeEffect?.metadata?.milledCardIds).toEqual(topCardIds);
    expect(session.state?.inspectionZone.cardIds).toEqual([]);
    expect(session.state?.inspectionZone.revealedCardIds).toEqual([]);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual(topCardIds);

    const finishResult = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id)
    );

    expect(finishResult.success).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.pendingAbilities).toEqual([]);
    expect(session.state?.inspectionZone.cardIds).toEqual([]);
    expect(session.state?.inspectionZone.revealedCardIds).toEqual([]);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual(topCardIds);
    expect(
      session.state?.liveResolution.liveModifiers.some(
        (modifier) =>
          modifier.kind === 'BLADE' &&
          modifier.abilityId === HS_BP5_001_ON_ENTER_MILL_GAIN_BLADE_ABILITY_ID &&
          modifier.sourceCardId === kaho.instanceId
      )
    ).toBe(false);
    expect(
      session.state?.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId === HS_BP5_001_ON_ENTER_MILL_GAIN_BLADE_ABILITY_ID &&
          action.payload.sourceCardId === kaho.instanceId &&
          action.payload.step === 'MILL_TOP_FOUR_GAIN_BLADE_IF_LIVE' &&
          action.payload.bladeBonus === 0 &&
          Array.isArray(action.payload.liveCardIds) &&
          action.payload.liveCardIds.length === 0 &&
          Array.isArray(action.payload.milledCardIds) &&
          action.payload.milledCardIds.join(',') === topCardIds.join(',')
      )
    ).toBe(true);
  });

  it('refreshes mid-effect and adds Blade when the milled cards include Live', () => {
    const session = createGameSession();
    const deck = createDeck();

    session.createGame('hs-bp5-001-refresh-mill', PLAYER1, 'Player 1', PLAYER2, 'Player 2');
    session.initializeGame(deck, deck);
    forceMainPhaseForPlayer(session);

    const kaho = createCardInstance(
      createMemberCard('PL!HS-bp5-001-SEC', '日野下花帆', 11),
      PLAYER1,
      'p1-hs-bp5-001-refresh-kaho'
    );
    const liveTop = createCardInstance(
      createLiveCard('PL!HS-bp5-001-test-live', 'Live Top'),
      PLAYER1,
      'p1-hs-bp5-001-refresh-live'
    );
    const memberTopA = createCardInstance(
      createMemberCard('PL!HS-bp5-001-test-member-a', 'Member A'),
      PLAYER1,
      'p1-hs-bp5-001-refresh-member-a'
    );
    const memberTopB = createCardInstance(
      createMemberCard('PL!HS-bp5-001-test-member-b', 'Member B'),
      PLAYER1,
      'p1-hs-bp5-001-refresh-member-b'
    );
    const waitingMember = createCardInstance(
      createMemberCard('PL!HS-bp5-001-test-waiting-member', 'Waiting Member'),
      PLAYER1,
      'p1-hs-bp5-001-refresh-waiting'
    );
    const state = registerCards(session.state!, [
      kaho,
      liveTop,
      memberTopA,
      memberTopB,
      waitingMember,
    ]);
    (session as unknown as { authorityState: GameState }).authorityState = state;

    const p1 = state.players[0] as unknown as {
      hand: { cardIds: string[] };
      mainDeck: { cardIds: string[] };
      waitingRoom: { cardIds: string[] };
      successZone: { cardIds: string[] };
      liveZone: { cardIds: string[] };
      memberSlots: {
        slots: Record<SlotPosition, string | null>;
        cardStates: Map<string, { orientation: OrientationState }>;
      };
    };
    const initialTopCardIds = [liveTop.instanceId, memberTopA.instanceId, memberTopB.instanceId];

    removeFromPlayerZones(p1);
    p1.hand.cardIds = [kaho.instanceId];
    p1.mainDeck.cardIds = [...initialTopCardIds];
    p1.waitingRoom.cardIds = [waitingMember.instanceId];
    p1.memberSlots.slots = {
      [SlotPosition.LEFT]: null,
      [SlotPosition.CENTER]: null,
      [SlotPosition.RIGHT]: null,
    };
    p1.memberSlots.cardStates = new Map();

    session.setManualOperationMode('FREE');
    const playResult = session.executeCommand(
      createPlayMemberToSlotCommand(PLAYER1, kaho.instanceId, SlotPosition.CENTER, {
        freePlay: true,
      })
    );

    const activeEffect = session.state?.activeEffect;
    const milledCardIds = activeEffect?.metadata?.milledCardIds as readonly string[];

    expect(playResult.success).toBe(true);
    expect(milledCardIds).toHaveLength(4);
    expect(milledCardIds.slice(0, 3)).toEqual(initialTopCardIds);
    expect(activeEffect?.metadata?.liveCardIds).toEqual([liveTop.instanceId]);
    expect(activeEffect?.metadata?.bladeBonus).toBe(2);
    expect(activeEffect?.metadata?.refreshCount).toBe(1);
    expect(session.state?.inspectionZone.cardIds).toEqual([]);
    expect(
      session.state?.actionHistory.some(
        (action) =>
          action.type === 'RULE_ACTION' &&
          action.payload.type === 'REFRESH' &&
          action.payload.movedCount === 4
      )
    ).toBe(true);

    const finishResult = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, activeEffect!.id)
    );

    expect(finishResult.success).toBe(true);
    expect(session.state?.liveResolution.liveModifiers).toContainEqual({
      kind: 'BLADE',
      playerId: PLAYER1,
      countDelta: 2,
      sourceCardId: kaho.instanceId,
      abilityId: HS_BP5_001_ON_ENTER_MILL_GAIN_BLADE_ABILITY_ID,
    });
    expect(
      session.state?.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId === HS_BP5_001_ON_ENTER_MILL_GAIN_BLADE_ABILITY_ID &&
          action.payload.step === 'MILL_TOP_FOUR_GAIN_BLADE_IF_LIVE' &&
          action.payload.bladeBonus === 2 &&
          action.payload.refreshCount === 1
      )
    ).toBe(true);
  });
});
