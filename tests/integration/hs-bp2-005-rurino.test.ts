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
  createConfirmEffectStepCommand,
  createPlayMemberToSlotCommand,
} from '../../src/application/game-commands';
import { GameService, type DeckConfig } from '../../src/application/game-service';
import { createGameSession } from '../../src/application/game-session';
import {
  HS_BP2_005_LIVE_START_PAY_ENERGY_FULL_STAGE_GAIN_TWO_BLADE_ABILITY_ID,
  HS_BP2_005_ON_ENTER_DISCARD_RECOVER_MIRACRA_CARD_ABILITY_ID,
  HS_PB1_003_AUTO_HAND_TO_WAITING_GAIN_HEART_BLADE_ABILITY_ID,
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

function createMemberCard(
  cardCode: string,
  name = cardCode,
  cost = 1,
  unitName = 'みらくらぱーく！'
): MemberCardData {
  return {
    cardCode,
    name,
    groupNames: ['莲之空'],
    unitName,
    cardType: CardType.MEMBER,
    cost,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.PINK, 1)],
  };
}

function createLiveCard(
  cardCode: string,
  name = cardCode,
  unitName = 'みらくらぱーく！'
): LiveCardData {
  return {
    cardCode,
    name,
    groupNames: ['莲之空'],
    unitName,
    cardType: CardType.LIVE,
    score: 3,
    requirements: createHeartRequirement({ [HeartColor.PINK]: 1 }),
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

function advanceToLiveStartEffects(session: ReturnType<typeof createGameSession>): void {
  const state = session.state!;
  const mutableState = state as unknown as {
    currentPhase: GamePhase;
    currentSubPhase: SubPhase;
    currentTurnType: TurnType;
    activePlayerIndex: number;
    firstPlayerIndex: number;
    liveSetCompletedPlayers: string[];
  };
  mutableState.currentPhase = GamePhase.LIVE_SET_PHASE;
  mutableState.currentSubPhase = SubPhase.LIVE_SET_SECOND_DRAW;
  mutableState.currentTurnType = TurnType.LIVE_PHASE;
  mutableState.activePlayerIndex = 0;
  mutableState.firstPlayerIndex = 0;
  mutableState.liveSetCompletedPlayers = [PLAYER1, PLAYER2];

  const advanceResult = new GameService().advancePhase(state);
  expect(advanceResult.success).toBe(true);
  (session as unknown as { authorityState: GameState }).authorityState = advanceResult.gameState;
}

function removeFromPlayerZones(player: {
  hand: { cardIds: string[] };
  mainDeck: { cardIds: string[] };
  waitingRoom: { cardIds: string[] };
  successZone: { cardIds: string[] };
  liveZone: { cardIds: string[] };
}): void {
  const ruleSentinelCardId = player.mainDeck.cardIds.at(-1);
  player.hand.cardIds = [];
  player.mainDeck.cardIds = ruleSentinelCardId ? [ruleSentinelCardId] : [];
  player.waitingRoom.cardIds = [];
  player.successZone.cardIds = [];
  player.liveZone.cardIds = [];
}

function setActiveEnergy(
  player: {
    energyZone: {
      cardIds: string[];
      cardStates: Map<string, { orientation: OrientationState; face: FaceState }>;
    };
  },
  cardIds: readonly string[]
): void {
  player.energyZone.cardIds = [...cardIds];
  player.energyZone.cardStates = new Map(
    cardIds.map((cardId) => [
      cardId,
      { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP },
    ])
  );
}

function startOnEnterScenario(options: {
  readonly handCards?: readonly ReturnType<typeof createCardInstance>[];
  readonly waitingCards?: readonly ReturnType<typeof createCardInstance>[];
  readonly stageCards?: Partial<Record<SlotPosition, ReturnType<typeof createCardInstance>>>;
}) {
  const session = createGameSession();
  const deck = createDeck();
  session.createGame('hs-bp2-005-on-enter', PLAYER1, 'Player 1', PLAYER2, 'Player 2');
  session.initializeGame(deck, deck);
  forceMainPhaseForPlayer(session);

  const source = createCardInstance(
    createMemberCard('PL!HS-bp2-005-P', '大沢瑠璃乃', 10),
    PLAYER1,
    'p1-hs-bp2-005-source'
  );
  const registeredCards = [
    source,
    ...(options.handCards ?? []),
    ...(options.waitingCards ?? []),
    ...Object.values(options.stageCards ?? {}),
  ];
  const state = registerCards(session.state!, registeredCards);
  const p1 = state.players[0] as unknown as {
    hand: { cardIds: string[] };
    mainDeck: { cardIds: string[] };
    waitingRoom: { cardIds: string[] };
    successZone: { cardIds: string[] };
    liveZone: { cardIds: string[] };
    memberSlots: {
      slots: Record<SlotPosition, string | null>;
      cardStates: Map<string, { orientation: OrientationState; face: FaceState }>;
    };
  };
  removeFromPlayerZones(p1);
  p1.hand.cardIds = [source.instanceId, ...(options.handCards ?? []).map((card) => card.instanceId)];
  p1.waitingRoom.cardIds = (options.waitingCards ?? []).map((card) => card.instanceId);
  p1.memberSlots.slots = {
    [SlotPosition.LEFT]: options.stageCards?.[SlotPosition.LEFT]?.instanceId ?? null,
    [SlotPosition.CENTER]: options.stageCards?.[SlotPosition.CENTER]?.instanceId ?? null,
    [SlotPosition.RIGHT]: options.stageCards?.[SlotPosition.RIGHT]?.instanceId ?? null,
  };
  p1.memberSlots.cardStates = new Map(
    Object.values(options.stageCards ?? {}).map((card) => [
      card.instanceId,
      { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP },
    ])
  );
  (session as unknown as { authorityState: GameState }).authorityState = state;

  session.localFreePlay = true;
  const playResult = session.executeCommand(
    createPlayMemberToSlotCommand(PLAYER1, source.instanceId, SlotPosition.CENTER, {
      freePlay: true,
    })
  );
  expect(playResult.success).toBe(true);
  const playerAfterPlay = session.state!.players[0] as unknown as {
    waitingRoom: { cardIds: string[] };
  };
  playerAfterPlay.waitingRoom.cardIds = (options.waitingCards ?? []).map((card) => card.instanceId);
  (session as unknown as { authorityState: GameState }).authorityState = session.state!;

  return { session, source };
}

function startLiveStartScenario(options: {
  readonly fullStage: boolean;
  readonly activeEnergyCount: number;
}) {
  const session = createGameSession();
  const deck = createDeck();
  session.createGame('hs-bp2-005-live-start', PLAYER1, 'Player 1', PLAYER2, 'Player 2');
  session.initializeGame(deck, deck);

  const source = createCardInstance(
    createMemberCard('PL!HS-bp2-005-P', '大沢瑠璃乃', 10),
    PLAYER1,
    'p1-hs-bp2-005-live-source'
  );
  const left = createCardInstance(createMemberCard('PL!HS-test-left'), PLAYER1, 'p1-left');
  const right = createCardInstance(createMemberCard('PL!HS-test-right'), PLAYER1, 'p1-right');
  const live = createCardInstance(createLiveCard('PL!HS-test-live'), PLAYER1, 'p1-live');
  const state = registerCards(session.state!, [source, left, right, live]);
  const p1 = state.players[0] as unknown as {
    hand: { cardIds: string[] };
    mainDeck: { cardIds: string[] };
    waitingRoom: { cardIds: string[] };
    successZone: { cardIds: string[] };
    liveZone: {
      cardIds: string[];
      cardStates: Map<string, { orientation: OrientationState; face: FaceState }>;
    };
    energyZone: {
      cardIds: string[];
      cardStates: Map<string, { orientation: OrientationState; face: FaceState }>;
    };
    memberSlots: {
      slots: Record<SlotPosition, string | null>;
      cardStates: Map<string, { orientation: OrientationState; face: FaceState }>;
    };
  };
  removeFromPlayerZones(p1);
  p1.liveZone.cardIds = [live.instanceId];
  p1.liveZone.cardStates = new Map([
    [live.instanceId, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_DOWN }],
  ]);
  p1.memberSlots.slots = {
    [SlotPosition.LEFT]: options.fullStage ? left.instanceId : null,
    [SlotPosition.CENTER]: source.instanceId,
    [SlotPosition.RIGHT]: options.fullStage ? right.instanceId : null,
  };
  p1.memberSlots.cardStates = new Map([
    [source.instanceId, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
    [left.instanceId, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
    [right.instanceId, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
  ]);
  const energyCardIds = state.players[0].energyDeck.cardIds.slice(0, options.activeEnergyCount);
  setActiveEnergy(p1, energyCardIds);
  (session as unknown as { authorityState: GameState }).authorityState = state;

  advanceToLiveStartEffects(session);

  return { session, source, energyCardIds };
}

describe('PL!HS-bp2-005 Rurino workflow', () => {
  it('declines or no-ops when there is no discardable hand card', () => {
    const noHand = startOnEnterScenario({});
    expect(noHand.session.state?.activeEffect).toBeNull();
    expect(
      noHand.session.state?.actionHistory.some(
        (action) =>
          action.type === 'PAY_COST' &&
          action.payload.abilityId === HS_BP2_005_ON_ENTER_DISCARD_RECOVER_MIRACRA_CARD_ABILITY_ID
      )
    ).toBe(false);

    const discard = createCardInstance(
      createMemberCard('PL!HS-test-discard', 'Discard', 1, 'DOLLCHESTRA'),
      PLAYER1,
      'discard'
    );
    const decline = startOnEnterScenario({ handCards: [discard] });
    expect(decline.session.state?.activeEffect?.abilityId).toBe(
      HS_BP2_005_ON_ENTER_DISCARD_RECOVER_MIRACRA_CARD_ABILITY_ID
    );
    const declineResult = decline.session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, decline.session.state!.activeEffect!.id)
    );
    expect(declineResult.success).toBe(true);
    expect(decline.session.state?.players[0].hand.cardIds).toContain(discard.instanceId);
    expect(decline.session.state?.players[0].waitingRoom.cardIds).not.toContain(discard.instanceId);
  });

  it('discards, recovers a Mira-Cra member, and keeps enter-waiting-room trigger wrapper semantics', () => {
    const discard = createCardInstance(
      createMemberCard('PL!HS-test-discard', 'Discard', 1, 'DOLLCHESTRA'),
      PLAYER1,
      'discard'
    );
    const recover = createCardInstance(
      createMemberCard('PL!HS-test-recover-member'),
      PLAYER1,
      'recover'
    );
    const pb1003Source = createCardInstance(
      createMemberCard('PL!HS-pb1-003-R', '大沢瑠璃乃', 15),
      PLAYER1,
      'pb1-003-source'
    );
    const { session } = startOnEnterScenario({
      handCards: [discard],
      waitingCards: [recover],
      stageCards: { [SlotPosition.RIGHT]: pb1003Source },
    });

    const discardResult = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id, discard.instanceId)
    );
    expect(discardResult.success).toBe(true);
    expect(session.state?.activeEffect?.selectableCardIds).toEqual([recover.instanceId]);

    const recoverResult = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id, recover.instanceId)
    );
    expect(recoverResult.success).toBe(true);
    confirmPublicSelectionIfNeeded(session);
    expect(session.state?.players[0].hand.cardIds).toContain(recover.instanceId);
    expect(session.state?.players[0].waitingRoom.cardIds).toContain(discard.instanceId);
    expect(
      session.state?.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId === HS_PB1_003_AUTO_HAND_TO_WAITING_GAIN_HEART_BLADE_ABILITY_ID
      )
    ).toBe(true);
  });

  it('can recover a Mira-Cra LIVE or the just-discarded Mira-Cra card', () => {
    const live = createCardInstance(createLiveCard('PL!HS-test-miracra-live'), PLAYER1, 'live');
    const discard = createCardInstance(
      createMemberCard('PL!HS-test-discard', 'Discard', 1, 'DOLLCHESTRA'),
      PLAYER1,
      'discard'
    );
    const other = createCardInstance(createMemberCard('PL!HS-test-other'), PLAYER1, 'other');
    const liveScenario = startOnEnterScenario({
      handCards: [discard],
      waitingCards: [live],
      stageCards: { [SlotPosition.RIGHT]: other },
    });
    liveScenario.session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        liveScenario.session.state!.activeEffect!.id,
        discard.instanceId
      )
    );
    expect(liveScenario.session.state?.activeEffect?.selectableCardIds).toEqual([live.instanceId]);

    const justDiscarded = createCardInstance(
      createMemberCard('PL!HS-test-just-discarded'),
      PLAYER1,
      'just-discarded'
    );
    const justDiscardedScenario = startOnEnterScenario({
      handCards: [justDiscarded],
      stageCards: {
        [SlotPosition.RIGHT]: createCardInstance(
          createMemberCard('PL!HS-test-other-2'),
          PLAYER1,
          'other-2'
        ),
      },
    });
    justDiscardedScenario.session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        justDiscardedScenario.session.state!.activeEffect!.id,
        justDiscarded.instanceId
      )
    );
    expect(justDiscardedScenario.session.state?.activeEffect?.selectableCardIds).toEqual([
      justDiscarded.instanceId,
    ]);
  });

  it('keeps the discard cost when no other member or no recovery target remains', () => {
    const noOtherDiscard = createCardInstance(
      createMemberCard('PL!HS-test-no-other-discard'),
      PLAYER1,
      'no-other-discard'
    );
    const noOtherTarget = createCardInstance(
      createMemberCard('PL!HS-test-no-other-target'),
      PLAYER1,
      'no-other-target'
    );
    const noOther = startOnEnterScenario({
      handCards: [noOtherDiscard],
      waitingCards: [noOtherTarget],
    });
    noOther.session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        noOther.session.state!.activeEffect!.id,
        noOtherDiscard.instanceId
      )
    );
    expect(noOther.session.state?.activeEffect).toBeNull();
    expect(noOther.session.state?.players[0].waitingRoom.cardIds).toEqual([
      noOtherTarget.instanceId,
      noOtherDiscard.instanceId,
    ]);

    const noTargetDiscard = createCardInstance(
      createMemberCard('PL!HS-test-no-target-discard', 'Discard', 1, 'DOLLCHESTRA'),
      PLAYER1,
      'no-target-discard'
    );
    const noTargetOther = createCardInstance(
      createMemberCard('PL!HS-test-no-target-other'),
      PLAYER1,
      'no-target-other'
    );
    const noTarget = startOnEnterScenario({
      handCards: [noTargetDiscard],
      stageCards: { [SlotPosition.RIGHT]: noTargetOther },
    });
    noTarget.session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        noTarget.session.state!.activeEffect!.id,
        noTargetDiscard.instanceId
      )
    );
    expect(noTarget.session.state?.activeEffect).toBeNull();
    expect(noTarget.session.state?.players[0].waitingRoom.cardIds).toEqual([
      noTargetDiscard.instanceId,
    ]);
  });

  it('declines or has no pay option when there is no active energy', () => {
    const { session } = startLiveStartScenario({ fullStage: true, activeEnergyCount: 0 });
    expect(session.state?.activeEffect?.selectableOptions).toEqual([{ id: 'decline', label: '不发动' }]);

    const declineResult = session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        session.state!.activeEffect!.id,
        undefined,
        undefined,
        undefined,
        'decline'
      )
    );
    expect(declineResult.success).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.liveResolution.liveModifiers).toEqual([]);
  });

  it('pays one active energy and gives BLADE +2 only when all three stage slots are full', () => {
    const full = startLiveStartScenario({ fullStage: true, activeEnergyCount: 1 });
    const payFull = full.session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        full.session.state!.activeEffect!.id,
        undefined,
        undefined,
        undefined,
        'pay'
      )
    );
    expect(payFull.success).toBe(true);
    expect(full.session.state?.players[0].energyZone.cardStates.get(full.energyCardIds[0])?.orientation).toBe(
      OrientationState.WAITING
    );
    expect(full.session.state?.liveResolution.liveModifiers).toContainEqual({
      kind: 'BLADE',
      playerId: PLAYER1,
      sourceCardId: full.source.instanceId,
      abilityId: HS_BP2_005_LIVE_START_PAY_ENERGY_FULL_STAGE_GAIN_TWO_BLADE_ABILITY_ID,
      countDelta: 2,
    });

    const notFull = startLiveStartScenario({ fullStage: false, activeEnergyCount: 1 });
    const payNotFull = notFull.session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        notFull.session.state!.activeEffect!.id,
        undefined,
        undefined,
        undefined,
        'pay'
      )
    );
    expect(payNotFull.success).toBe(true);
    expect(
      notFull.session.state?.players[0].energyZone.cardStates.get(notFull.energyCardIds[0])
        ?.orientation
    ).toBe(OrientationState.WAITING);
    expect(notFull.session.state?.liveResolution.liveModifiers).toEqual([]);
    expect(
      notFull.session.state?.actionHistory.some(
        (action) =>
          action.type === 'PAY_COST' &&
          action.payload.abilityId ===
            HS_BP2_005_LIVE_START_PAY_ENERGY_FULL_STAGE_GAIN_TWO_BLADE_ABILITY_ID &&
          action.payload.amount === 1
      )
    ).toBe(true);
  });
});
