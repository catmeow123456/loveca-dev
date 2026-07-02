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
import {
  addAction,
  createGameState,
  registerCards,
  updatePlayer,
  type GameState,
  type PendingAbilityState,
} from '../../src/domain/entities/game';
import { placeCardInSlot } from '../../src/domain/entities/zone';
import { getMemberEffectiveHeartIcons } from '../../src/domain/rules/live-modifiers';
import {
  confirmActiveEffectStep,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import { createConfirmEffectStepCommand } from '../../src/application/game-commands';
import { createGameSession } from '../../src/application/game-session';
import { GameService, type DeckConfig } from '../../src/application/game-service';
import {
  BP6_003_LIVE_SUCCESS_PLAY_MEMBER_BELOW_LOW_COST_MUSE_ABILITY_ID,
  LL_BP2_001_LIVE_START_DISCARD_BLADE_ABILITY_ID,
  N_BP5_015_LIVE_START_ALL_SIX_STAGE_HEARTS_GAIN_TWO_BLADE_ABILITY_ID,
  N_BP5_030_AUTO_STAGE_MEMBER_LIVE_START_RESOLVED_GAIN_ALL_HEART_ABILITY_ID,
  N_BP5_030_AUTO_STAGE_MEMBER_LIVE_SUCCESS_RESOLVED_DRAW_ABILITY_ID,
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
  TriggerCondition,
} from '../../src/shared/types/enums';

const PLAYER1 = 'player1';
const PLAYER2 = 'player2';

function createMemberCard(
  cardCode: string,
  name = cardCode,
  hearts: readonly HeartColor[] = [HeartColor.PINK],
  cost = 4
): MemberCardData {
  return {
    cardCode,
    name,
    groupNames: ["μ's"],
    cardType: CardType.MEMBER,
    cost,
    blade: 1,
    hearts: hearts.map((color) => createHeartIcon(color, 1)),
  };
}

function createLiveCard(
  cardCode = 'PL!N-bp5-030-L',
  name = '繚乱！ビクトリーロード'
): LiveCardData {
  return {
    cardCode,
    name,
    groupNames: ['虹ヶ咲学園スクールアイドル同好会'],
    cardType: CardType.LIVE,
    score: 5,
    requirements: createHeartRequirement({ [HeartColor.RAINBOW]: 7 }),
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

function setupDirectState(options: {
  readonly sourceCardCode?: string;
  readonly sourceHearts?: readonly HeartColor[];
  readonly mainDeckCards?: readonly ReturnType<typeof createCardInstance>[];
}): {
  readonly game: GameState;
  readonly liveId: string;
  readonly sourceId: string;
} {
  const live = createCardInstance(createLiveCard(), PLAYER1, 'ryouran-live');
  const source = createCardInstance(
    createMemberCard(
      options.sourceCardCode ?? 'LL-bp2-001-R+',
      options.sourceCardCode ?? '渡辺曜&鬼塚夏美&大沢瑠璃乃',
      options.sourceHearts ?? []
    ),
    PLAYER1,
    'resolved-source'
  );
  const mainDeckCards = options.mainDeckCards ?? [];
  let game = createGameState('n-bp5-030-ryouran', PLAYER1, 'P1', PLAYER2, 'P2');
  game = registerCards(game, [live, source, ...mainDeckCards]);
  game = updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    mainDeck: {
      ...player.mainDeck,
      cardIds: mainDeckCards.map((card) => card.instanceId),
    },
    liveZone: {
      ...player.liveZone,
      cardIds: [live.instanceId],
    },
    memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, source.instanceId, {
      orientation: OrientationState.ACTIVE,
      face: FaceState.FACE_UP,
    }),
  }));
  return { game, liveId: live.instanceId, sourceId: source.instanceId };
}

function addResolvedMemberAbilityAction(
  game: GameState,
  options: {
    readonly abilityId: string;
    readonly sourceCardId: string;
    readonly step?: string;
    readonly sourceSlot?: SlotPosition;
  }
): GameState {
  return addAction(game, 'RESOLVE_ABILITY', PLAYER1, {
    pendingAbilityId: `${options.abilityId}:resolved`,
    abilityId: options.abilityId,
    sourceCardId: options.sourceCardId,
    sourceSlot: options.sourceSlot ?? SlotPosition.CENTER,
    step: options.step ?? 'TEST_MEMBER_ABILITY_RESOLVED',
  });
}

function addPendingAbility(
  game: GameState,
  ability: Omit<PendingAbilityState, 'id' | 'eventIds' | 'mandatory' | 'controllerId'>
): GameState {
  return {
    ...game,
    pendingAbilities: [
      ...game.pendingAbilities,
      {
        ...ability,
        id: `${ability.abilityId}:pending-${game.pendingAbilities.length}`,
        controllerId: PLAYER1,
        mandatory: true,
        eventIds: [`${ability.abilityId}:event-${game.pendingAbilities.length}`],
      },
    ],
  };
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

  const service = new GameService();
  const advanceResult = service.advancePhase(state);
  expect(advanceResult.success).toBe(true);
  (session as unknown as { authorityState: GameState }).authorityState = advanceResult.gameState;
}

function setupLlBp2LiveStartSession(): {
  readonly session: ReturnType<typeof createGameSession>;
  readonly sourceId: string;
  readonly liveId: string;
} {
  const session = createGameSession();
  const deck = createDeck();

  session.createGame('n-bp5-030-ll-bp2-live-start', PLAYER1, 'Player 1', PLAYER2, 'Player 2');
  session.initializeGame(deck, deck);

  const source = createCardInstance(
    createMemberCard('LL-bp2-001-R+', '渡辺曜&鬼塚夏美&大沢瑠璃乃', [], 20),
    PLAYER1,
    'p1-ll-bp2-source'
  );
  const matchingHandCard = createCardInstance(
    createMemberCard('PL!S-test-you', '渡辺曜'),
    PLAYER1,
    'p1-ll-bp2-you'
  );
  const nonMatchingHandCard = createCardInstance(
    createMemberCard('PL!N-test-karin', '朝香果林'),
    PLAYER1,
    'p1-ll-bp2-karin'
  );
  const liveCard = createCardInstance(createLiveCard(), PLAYER1, 'p1-ryouran-live');
  const state = registerCards(session.state!, [
    source,
    matchingHandCard,
    nonMatchingHandCard,
    liveCard,
  ]);
  (session as unknown as { authorityState: GameState }).authorityState = state;

  const p1 = state.players[0] as unknown as {
    hand: { cardIds: string[] };
    mainDeck: { cardIds: string[] };
    waitingRoom: { cardIds: string[] };
    successZone: { cardIds: string[] };
    liveZone: {
      cardIds: string[];
      cardStates: Map<string, { orientation: OrientationState; face: FaceState }>;
    };
    memberSlots: {
      slots: Record<SlotPosition, string | null>;
      cardStates: Map<string, { orientation: OrientationState; face: FaceState }>;
    };
  };

  removeFromPlayerZones(p1);
  p1.memberSlots.slots[SlotPosition.CENTER] = source.instanceId;
  p1.memberSlots.cardStates = new Map([
    [source.instanceId, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
  ]);
  p1.hand.cardIds = [matchingHandCard.instanceId, nonMatchingHandCard.instanceId];
  p1.liveZone.cardIds = [liveCard.instanceId];
  p1.liveZone.cardStates = new Map([
    [liveCard.instanceId, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_DOWN }],
  ]);

  advanceToLiveStartEffects(session);
  expect(session.state?.activeEffect?.abilityId).toBe(
    LL_BP2_001_LIVE_START_DISCARD_BLADE_ABILITY_ID
  );

  return {
    session,
    sourceId: source.instanceId,
    liveId: liveCard.instanceId,
  };
}

describe('PL!N-bp5-030-L 繚乱！ビクトリーロード', () => {
  it('grants ALL Heart after an own stage member LIVE_START ability resolves with no Heart', () => {
    const scenario = setupDirectState({ sourceHearts: [] });
    const state = resolvePendingCardEffects(
      addResolvedMemberAbilityAction(scenario.game, {
        abilityId: LL_BP2_001_LIVE_START_DISCARD_BLADE_ABILITY_ID,
        sourceCardId: scenario.sourceId,
        step: 'DISCARD_NAMED_HAND_CARDS_GAIN_BLADE',
      })
    ).gameState;

    expect(state.liveResolution.liveModifiers).toContainEqual({
      kind: 'HEART',
      playerId: PLAYER1,
      hearts: [{ color: HeartColor.RAINBOW, count: 1 }],
      sourceCardId: scenario.liveId,
      abilityId: N_BP5_030_AUTO_STAGE_MEMBER_LIVE_START_RESOLVED_GAIN_ALL_HEART_ABILITY_ID,
      target: 'TARGET_MEMBER',
      targetMemberCardId: scenario.sourceId,
    });
    expect(getMemberEffectiveHeartIcons(state, PLAYER1, scenario.sourceId)).toContainEqual({
      color: HeartColor.RAINBOW,
      count: 1,
    });
  });

  it('grants ALL Heart when the resolved member has ordinary Heart but no ALL Heart', () => {
    const scenario = setupDirectState({ sourceHearts: [HeartColor.PINK] });
    const state = resolvePendingCardEffects(
      addResolvedMemberAbilityAction(scenario.game, {
        abilityId: LL_BP2_001_LIVE_START_DISCARD_BLADE_ABILITY_ID,
        sourceCardId: scenario.sourceId,
        step: 'DISCARD_NAMED_HAND_CARDS_GAIN_BLADE',
      })
    ).gameState;

    expect(state.liveResolution.liveModifiers).toContainEqual({
      kind: 'HEART',
      playerId: PLAYER1,
      hearts: [{ color: HeartColor.RAINBOW, count: 1 }],
      sourceCardId: scenario.liveId,
      abilityId: N_BP5_030_AUTO_STAGE_MEMBER_LIVE_START_RESOLVED_GAIN_ALL_HEART_ABILITY_ID,
      target: 'TARGET_MEMBER',
      targetMemberCardId: scenario.sourceId,
    });
    expect(
      state.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.step === 'RYOURAN_GAIN_ALL_HEART' &&
          action.payload.allHeartCountBefore === 0
      )
    ).toBe(true);
  });

  it('does not grant ALL Heart when the resolved member already has ALL Heart', () => {
    const scenario = setupDirectState({ sourceHearts: [HeartColor.RAINBOW] });
    const state = resolvePendingCardEffects(
      addResolvedMemberAbilityAction(scenario.game, {
        abilityId: LL_BP2_001_LIVE_START_DISCARD_BLADE_ABILITY_ID,
        sourceCardId: scenario.sourceId,
        step: 'DISCARD_NAMED_HAND_CARDS_GAIN_BLADE',
      })
    ).gameState;

    expect(
      state.liveResolution.liveModifiers.some(
        (modifier) =>
          modifier.abilityId ===
          N_BP5_030_AUTO_STAGE_MEMBER_LIVE_START_RESOLVED_GAIN_ALL_HEART_ABILITY_ID
      )
    ).toBe(false);
    expect(
      state.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.step === 'RYOURAN_GAIN_ALL_HEART_CONDITION_NOT_MET' &&
          action.payload.allHeartCountBefore === 1
      )
    ).toBe(true);
  });

  it('resolves immediately before other same-timing LIVE_START pending choices', () => {
    const scenario = setupDirectState({ sourceHearts: [HeartColor.PINK] });
    const gameWithOtherLiveStartPending = addPendingAbility(scenario.game, {
      abilityId: N_BP5_015_LIVE_START_ALL_SIX_STAGE_HEARTS_GAIN_TWO_BLADE_ABILITY_ID,
      sourceCardId: scenario.sourceId,
      timingId: TriggerCondition.ON_LIVE_START,
    });

    const state = resolvePendingCardEffects(
      addResolvedMemberAbilityAction(gameWithOtherLiveStartPending, {
        abilityId: LL_BP2_001_LIVE_START_DISCARD_BLADE_ABILITY_ID,
        sourceCardId: scenario.sourceId,
        step: 'DISCARD_NAMED_HAND_CARDS_GAIN_BLADE',
      })
    ).gameState;

    expect(
      state.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId ===
            N_BP5_030_AUTO_STAGE_MEMBER_LIVE_START_RESOLVED_GAIN_ALL_HEART_ABILITY_ID &&
          action.payload.step === 'RYOURAN_GAIN_ALL_HEART'
      )
    ).toBe(true);
    expect(state.activeEffect?.abilityId).toBe(
      N_BP5_015_LIVE_START_ALL_SIX_STAGE_HEARTS_GAIN_TWO_BLADE_ABILITY_ID
    );
    expect(state.activeEffect?.effectText).not.toBe('请选择下一个要发动的效果。也可以选择“顺序发动”，按当前队列顺序依次处理。');
  });

  it('treats LL-bp2-001-R+ resolving with zero discarded cards as a resolved LIVE_START ability', () => {
    const scenario = setupLlBp2LiveStartSession();

    const zeroDiscardResult = scenario.session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        scenario.session.state!.activeEffect!.id,
        undefined,
        null,
        undefined,
        null,
        []
      )
    );

    expect(zeroDiscardResult.success).toBe(true);
    expect(scenario.session.state?.liveResolution.liveModifiers).toContainEqual({
      kind: 'HEART',
      playerId: PLAYER1,
      hearts: [{ color: HeartColor.RAINBOW, count: 1 }],
      sourceCardId: scenario.liveId,
      abilityId: N_BP5_030_AUTO_STAGE_MEMBER_LIVE_START_RESOLVED_GAIN_ALL_HEART_ABILITY_ID,
      target: 'TARGET_MEMBER',
      targetMemberCardId: scenario.sourceId,
    });
    expect(
      scenario.session.state?.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId === LL_BP2_001_LIVE_START_DISCARD_BLADE_ABILITY_ID &&
          Array.isArray(action.payload.discardedCardIds) &&
          action.payload.discardedCardIds.length === 0 &&
          action.payload.rewardAmount === 0
      )
    ).toBe(true);
  });

  it('does not trigger from LL-bp2-001-R+ skip/decline without selectedCardIds', () => {
    const scenario = setupLlBp2LiveStartSession();

    const skipResult = scenario.session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, scenario.session.state!.activeEffect!.id)
    );

    expect(skipResult.success).toBe(true);
    expect(scenario.session.state?.activeEffect).toBeNull();
    expect(
      scenario.session.state?.actionHistory.some(
        (action) =>
          action.type === 'TRIGGER_ABILITY' &&
          action.payload.abilityId ===
            N_BP5_030_AUTO_STAGE_MEMBER_LIVE_START_RESOLVED_GAIN_ALL_HEART_ABILITY_ID
      )
    ).toBe(false);
  });

  it('draws one card after an own stage member LIVE_SUCCESS ability resolves', () => {
    const drawCard = createCardInstance(
      createMemberCard('PL!N-test-draw', 'Draw card'),
      PLAYER1,
      'draw-card'
    );
    const scenario = setupDirectState({
      sourceCardCode: 'PL!-bp6-003-P',
      sourceHearts: [HeartColor.GREEN],
      mainDeckCards: [drawCard],
    });
    const state = resolvePendingCardEffects(
      addResolvedMemberAbilityAction(scenario.game, {
        abilityId: BP6_003_LIVE_SUCCESS_PLAY_MEMBER_BELOW_LOW_COST_MUSE_ABILITY_ID,
        sourceCardId: scenario.sourceId,
      })
    ).gameState;

    expect(state.players[0].hand.cardIds).toContain(drawCard.instanceId);
    expect(state.players[0].mainDeck.cardIds).not.toContain(drawCard.instanceId);
    expect(
      state.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId ===
            N_BP5_030_AUTO_STAGE_MEMBER_LIVE_SUCCESS_RESOLVED_DRAW_ABILITY_ID &&
          action.payload.step === 'RYOURAN_DRAW_ONE' &&
          Array.isArray(action.payload.drawnCardIds) &&
          action.payload.drawnCardIds.includes(drawCard.instanceId)
      )
    ).toBe(true);
  });
});
