import { confirmPublicSelectionIfNeeded } from '../helpers/public-card-selection-confirmation';
import { describe, expect, it } from 'vitest';
import type { AnyCardData, EnergyCardData, LiveCardData, MemberCardData } from '../../src/domain/entities/card';
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
import { createGameSession, type GameSession } from '../../src/application/game-session';
import type { DeckConfig } from '../../src/application/game-service';
import { HS_SD1_005_ON_ENTER_RELAY_FROM_OTHER_HASUNOSORA_RECOVER_LIVE_ABILITY_ID } from '../../src/application/card-effects/ability-ids';
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

function createMemberCard(options: {
  readonly cardCode: string;
  readonly name: string;
  readonly groupNames?: readonly string[];
  readonly cost?: number;
}): MemberCardData {
  return {
    cardCode: options.cardCode,
    name: options.name,
    groupNames: options.groupNames ?? ['蓮ノ空女学院スクールアイドルクラブ'],
    cardType: CardType.MEMBER,
    cost: options.cost ?? 4,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.BLUE, 1)],
  };
}

function createLiveCard(cardCode: string): LiveCardData {
  return {
    cardCode,
    name: cardCode,
    groupNames: ['蓮ノ空女学院スクールアイドルクラブ'],
    cardType: CardType.LIVE,
    score: 2,
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
    createMemberCard({ cardCode: `MEM-${index}`, name: `Member ${index}` })
  );
  const energyDeck = Array.from({ length: 12 }, (_, index) => createEnergyCard(`ENE-${index}`));
  return { mainDeck, energyDeck };
}

function forceMainPhaseForPlayer(session: GameSession): void {
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

function setupScenario(options: {
  readonly replacementName: string;
  readonly replacementCardCode: string;
  readonly replacementGroupName?: string;
  readonly waitingLive?: boolean;
}): {
  readonly session: GameSession;
  readonly sourceId: string;
  readonly replacementId: string;
  readonly liveId: string | null;
} {
  const session = createGameSession();
  const deck = createDeck();
  session.createGame('hs-sd1-005-kosuzu', PLAYER1, 'Player 1', PLAYER2, 'Player 2');
  session.initializeGame(deck, deck);
  forceMainPhaseForPlayer(session);

  const source = createCardInstance(
    createMemberCard({
      cardCode: 'PL!HS-sd1-005-SD',
      name: '徒町小鈴',
      cost: 13,
    }),
    PLAYER1,
    'kosuzu-source'
  );
  const replacement = createCardInstance(
    createMemberCard({
      cardCode: options.replacementCardCode,
      name: options.replacementName,
      groupNames: options.replacementGroupName ? [options.replacementGroupName] : undefined,
    }),
    PLAYER1,
    'relay-replacement'
  );
  const live = options.waitingLive
    ? createCardInstance(createLiveCard('PL!HS-test-live'), PLAYER1, 'waiting-live')
    : null;
  const state = registerCards(session.state!, [source, replacement, ...(live ? [live] : [])]);
  (session as unknown as { authorityState: GameState }).authorityState = state;

  const player = state.players[0] as unknown as {
    hand: { cardIds: string[] };
    waitingRoom: { cardIds: string[] };
    successZone: { cardIds: string[] };
    liveZone: { cardIds: string[] };
    memberSlots: {
      slots: Record<SlotPosition, string | null>;
      cardStates: Map<string, { orientation: OrientationState; face: FaceState }>;
    };
  };
  player.hand.cardIds = [source.instanceId];
  player.waitingRoom.cardIds = live ? [live.instanceId] : [];
  player.successZone.cardIds = [];
  player.liveZone.cardIds = [];
  player.memberSlots.slots = {
    [SlotPosition.LEFT]: null,
    [SlotPosition.CENTER]: replacement.instanceId,
    [SlotPosition.RIGHT]: null,
  };
  player.memberSlots.cardStates = new Map([
    [replacement.instanceId, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
  ]);

  return {
    session,
    sourceId: source.instanceId,
    replacementId: replacement.instanceId,
    liveId: live?.instanceId ?? null,
  };
}

function playWithRelay(session: GameSession, sourceId: string): void {
  session.setManualOperationMode('FREE');
  const result = session.executeCommand(
    createPlayMemberToSlotCommand(PLAYER1, sourceId, SlotPosition.CENTER, {
      freePlay: true,
    })
  );
  expect(result.success).toBe(true);
}

describe('PL!HS-sd1-005-SD Kosuzu workflow', () => {
  it('recovers one LIVE when relayed from another Hasunosora member', () => {
    const scenario = setupScenario({
      replacementName: '百生吟子',
      replacementCardCode: 'PL!HS-test-ginko',
      waitingLive: true,
    });

    playWithRelay(scenario.session, scenario.sourceId);

    expect(scenario.session.state?.activeEffect).toMatchObject({
      abilityId: HS_SD1_005_ON_ENTER_RELAY_FROM_OTHER_HASUNOSORA_RECOVER_LIVE_ABILITY_ID,
      selectableCardIds: [scenario.liveId],
    });

    const recoverResult = scenario.session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        scenario.session.state!.activeEffect!.id,
        scenario.liveId
      )
    );

    expect(recoverResult.success).toBe(true);
    confirmPublicSelectionIfNeeded(scenario.session);
    expect(scenario.session.state?.activeEffect).toBeNull();
    expect(scenario.session.state?.players[0].hand.cardIds).toEqual([scenario.liveId]);
    expect(scenario.session.state?.players[0].waitingRoom.cardIds).toEqual([
      scenario.replacementId,
    ]);
  });

  it('does not trigger when relayed from another 徒町小鈴', () => {
    const scenario = setupScenario({
      replacementName: '徒町小铃',
      replacementCardCode: 'PL!HS-test-kosuzu',
      waitingLive: true,
    });

    playWithRelay(scenario.session, scenario.sourceId);

    expect(scenario.session.state?.activeEffect).toBeNull();
    expect(scenario.session.state?.pendingAbilities).toEqual([]);
    expect(
      scenario.session.state?.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId ===
            HS_SD1_005_ON_ENTER_RELAY_FROM_OTHER_HASUNOSORA_RECOVER_LIVE_ABILITY_ID &&
          action.payload.reason === 'RELAY_REPLACEMENT_NOT_OTHER_HASUNOSORA_MEMBER'
      )
    ).toBe(true);
  });

  it('does not trigger when relayed from a non-Hasunosora member', () => {
    const scenario = setupScenario({
      replacementName: '中須かすみ',
      replacementCardCode: 'PL!N-test-kasumi',
      replacementGroupName: '虹ヶ咲学園スクールアイドル同好会',
      waitingLive: true,
    });

    playWithRelay(scenario.session, scenario.sourceId);

    expect(scenario.session.state?.activeEffect).toBeNull();
    expect(scenario.session.state?.pendingAbilities).toEqual([]);
    expect(
      scenario.session.state?.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId ===
            HS_SD1_005_ON_ENTER_RELAY_FROM_OTHER_HASUNOSORA_RECOVER_LIVE_ABILITY_ID &&
          action.payload.reason === 'RELAY_REPLACEMENT_NOT_OTHER_HASUNOSORA_MEMBER'
      )
    ).toBe(true);
  });

  it('consumes pending as no-op when the relay condition is met but no LIVE target exists', () => {
    const scenario = setupScenario({
      replacementName: '村野さやか',
      replacementCardCode: 'PL!HS-test-sayaka',
      waitingLive: false,
    });

    playWithRelay(scenario.session, scenario.sourceId);

    expect(scenario.session.state?.activeEffect).toBeNull();
    expect(scenario.session.state?.pendingAbilities).toEqual([]);
    expect(
      scenario.session.state?.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId ===
            HS_SD1_005_ON_ENTER_RELAY_FROM_OTHER_HASUNOSORA_RECOVER_LIVE_ABILITY_ID &&
          action.payload.conditionMet === true &&
          action.payload.reason === 'NO_WAITING_ROOM_LIVE_TARGET'
      )
    ).toBe(true);
    expect(scenario.session.state?.players[0].waitingRoom.cardIds).toEqual([
      scenario.replacementId,
    ]);
  });
});
