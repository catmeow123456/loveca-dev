import { describe, expect, it } from 'vitest';
import type { LiveCardData, MemberCardData } from '../../src/domain/entities/card';
import {
  createCardInstance,
  createHeartIcon,
  createHeartRequirement,
} from '../../src/domain/entities/card';
import {
  createGameState,
  registerCards,
  updatePlayer,
  type GameState,
  type PendingAbilityState,
} from '../../src/domain/entities/game';
import {
  addCardToStatefulZone,
  addCardToZone,
  placeCardInSlot,
  removeCardFromSlot,
} from '../../src/domain/entities/zone';
import { createPlayMemberToSlotCommand } from '../../src/application/game-commands';
import {
  confirmActiveEffectStep,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import { createGameSession } from '../../src/application/game-session';
import { GameService } from '../../src/application/game-service';
import {
  HS_BP2_021_LIVE_START_RELAY_ENTERED_HASUNOSORA_GREEN_REQUIREMENT_ABILITY_ID,
  HS_BP2_023_LIVE_START_RELAY_ENTERED_HASUNOSORA_BLUE_REQUIREMENT_ABILITY_ID,
  HS_BP2_025_LIVE_START_RELAY_ENTERED_HASUNOSORA_PINK_REQUIREMENT_ABILITY_ID,
  HS_BP2_024_LIVE_START_KOSUZU_SAYAKA_REQUIREMENT_ABILITY_ID,
  HS_BP5_019_LIVE_START_REQUIREMENT_ABILITY_ID,
  HS_BP5_020_LIVE_START_HIGH_COST_HASUNOSORA_SCORE_ABILITY_ID,
} from '../../src/application/card-effects/ability-ids';
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
} from '../../src/shared/types/enums';

const PLAYER1 = 'player1';
const PLAYER2 = 'player2';

function createLive(cardCode: string, name: string, score = 1): LiveCardData {
  return {
    cardCode,
    name,
    groupNames: ['蓮ノ空女学院スクールアイドルクラブ'],
    unitName: 'DOLLCHESTRA',
    cardType: CardType.LIVE,
    score,
    requirements: createHeartRequirement({
      [HeartColor.BLUE]: 2,
      [HeartColor.RAINBOW]: 1,
    }),
  };
}

function createMember(options: {
  readonly cardCode: string;
  readonly name: string;
  readonly cost: number;
  readonly groupNames?: readonly string[];
}): MemberCardData {
  return {
    cardCode: options.cardCode,
    name: options.name,
    groupNames: options.groupNames ?? ['蓮ノ空女学院スクールアイドルクラブ'],
    unitName: 'DOLLCHESTRA',
    cardType: CardType.MEMBER,
    cost: options.cost,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.BLUE, 1)],
  };
}

function expectAutoResolved(game: GameState): GameState {
  const state =
    game.activeEffect?.metadata?.confirmOnlyPendingAbility === true
      ? confirmActiveEffectStep(game, PLAYER1, game.activeEffect.id)
      : game;
  expect(state.activeEffect).toBeNull();
  return state;
}

function runLiveStart(game: GameState): GameState {
  const result = new GameService().executeCheckTiming(game, [TriggerCondition.ON_LIVE_START]);
  expect(result.success).toBe(true);
  return result.gameState;
}

function setupLiveStartState(options: {
  readonly live: ReturnType<typeof createCardInstance>;
  readonly stageMembers: readonly {
    readonly card: ReturnType<typeof createCardInstance>;
    readonly slot: SlotPosition;
  }[];
  readonly successLive?: ReturnType<typeof createCardInstance>;
}): GameState {
  let game = createGameState('conditional-live-modifier', PLAYER1, 'P1', PLAYER2, 'P2');
  game = registerCards(game, [
    options.live,
    ...options.stageMembers.map((member) => member.card),
    ...(options.successLive ? [options.successLive] : []),
  ]);
  game = updatePlayer(game, PLAYER1, (player) => {
    let memberSlots = player.memberSlots;
    for (const stageMember of options.stageMembers) {
      memberSlots = placeCardInSlot(memberSlots, stageMember.slot, stageMember.card.instanceId, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      });
    }
    return {
      ...player,
      liveZone: addCardToStatefulZone(player.liveZone, options.live.instanceId, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      }),
      successZone: options.successLive
        ? addCardToZone(player.successZone, options.successLive.instanceId)
        : player.successZone,
      memberSlots,
    };
  });
  return {
    ...game,
    liveResolution: {
      ...game.liveResolution,
      performingPlayerId: PLAYER1,
    },
  };
}

function createHanamusubiPending(sourceCardId: string, index = 0): PendingAbilityState {
  return {
    id: `hanamusubi-pending-${sourceCardId}-${index}`,
    abilityId: HS_BP5_019_LIVE_START_REQUIREMENT_ABILITY_ID,
    sourceCardId,
    controllerId: PLAYER1,
    mandatory: true,
    timingId: TriggerCondition.ON_LIVE_START,
    eventIds: ['hanamusubi-live-start-event'],
  };
}

function setupHanamusubiPendingState(options: {
  readonly sourceCount: number;
  readonly includeOtherHasunosoraLive?: boolean;
}): {
  readonly game: GameState;
  readonly sourceLives: readonly ReturnType<typeof createCardInstance>[];
} {
  const sourceLives = Array.from({ length: options.sourceCount }, (_, index) =>
    createCardInstance(
      createLive('PL!HS-bp5-019-L', `花结 ${index + 1}`, 6),
      PLAYER1,
      `hanamusubi-source-${index}`
    )
  );
  const otherHasunosoraLive = options.includeOtherHasunosoraLive
    ? createCardInstance(
        createLive('PL!HS-test-other-live', '莲之空测试LIVE', 1),
        PLAYER1,
        'hanamusubi-other-live'
      )
    : null;
  const liveCards = [...sourceLives, ...(otherHasunosoraLive ? [otherHasunosoraLive] : [])];

  let game = createGameState('conditional-live-modifier-hanamusubi', PLAYER1, 'P1', PLAYER2, 'P2');
  game = registerCards(game, liveCards);
  game = updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    liveZone: liveCards.reduce(
      (zone, card) =>
        addCardToStatefulZone(zone, card.instanceId, {
          orientation: OrientationState.ACTIVE,
          face: FaceState.FACE_UP,
        }),
      player.liveZone
    ),
  }));

  return {
    game: {
      ...game,
      pendingAbilities: sourceLives.map((live, index) =>
        createHanamusubiPending(live.instanceId, index)
      ),
      liveResolution: {
        ...game.liveResolution,
        performingPlayerId: PLAYER1,
      },
    },
    sourceLives,
  };
}

function createRelayRequirementLive(
  cardCode: string,
  name: string,
  color: HeartColor
): LiveCardData {
  return {
    cardCode,
    name,
    groupNames: ['蓮ノ空女学院スクールアイドルクラブ'],
    unitName: 'DOLLCHESTRA',
    cardType: CardType.LIVE,
    score: 3,
    requirements: createHeartRequirement({ [color]: 2, [HeartColor.RAINBOW]: 1 }),
  };
}

function setupRelayEnteredLiveStartState(options: {
  readonly live: ReturnType<typeof createCardInstance>;
  readonly secondMode: 'relay' | 'ordinary' | 'preexisting';
  readonly removeFirstRelay?: boolean;
}): GameState {
  const incomingOne = createCardInstance(
    createMember({ cardCode: 'PL!HS-test-relay-in-1', name: 'Relay In 1', cost: 5 }),
    PLAYER1,
    'relay-in-1'
  );
  const incomingTwo = createCardInstance(
    createMember({ cardCode: 'PL!HS-test-relay-in-2', name: 'Relay In 2', cost: 5 }),
    PLAYER1,
    'relay-in-2'
  );
  const replacedOne = createCardInstance(
    createMember({ cardCode: 'PL!HS-test-replaced-1', name: 'Replaced 1', cost: 3 }),
    PLAYER1,
    'replaced-1'
  );
  const replacedTwo = createCardInstance(
    createMember({ cardCode: 'PL!HS-test-replaced-2', name: 'Replaced 2', cost: 3 }),
    PLAYER1,
    'replaced-2'
  );
  const preexisting = createCardInstance(
    createMember({ cardCode: 'PL!HS-test-preexisting', name: 'Preexisting', cost: 5 }),
    PLAYER1,
    'preexisting'
  );
  const registeredCards = [
    options.live,
    incomingOne,
    replacedOne,
    ...(options.secondMode === 'preexisting' ? [preexisting] : [incomingTwo]),
    ...(options.secondMode === 'relay' ? [replacedTwo] : []),
  ];

  const session = createGameSession();
  session.createGame('conditional-live-modifier-relay-entered', PLAYER1, 'P1', PLAYER2, 'P2');
  let game = createGameState(
    'conditional-live-modifier-relay-entered',
    PLAYER1,
    'P1',
    PLAYER2,
    'P2'
  );
  game = registerCards(game, registeredCards);
  game = updatePlayer(game, PLAYER1, (player) => {
    let memberSlots = placeCardInSlot(
      player.memberSlots,
      SlotPosition.LEFT,
      replacedOne.instanceId,
      {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      }
    );
    if (options.secondMode === 'relay') {
      memberSlots = placeCardInSlot(memberSlots, SlotPosition.CENTER, replacedTwo.instanceId, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      });
    } else if (options.secondMode === 'preexisting') {
      memberSlots = placeCardInSlot(memberSlots, SlotPosition.CENTER, preexisting.instanceId, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      });
    }

    return {
      ...player,
      hand: {
        ...player.hand,
        cardIds:
          options.secondMode === 'preexisting'
            ? [incomingOne.instanceId]
            : [incomingOne.instanceId, incomingTwo.instanceId],
      },
      liveZone: addCardToStatefulZone(player.liveZone, options.live.instanceId, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      }),
      memberSlots,
    };
  });
  (session as unknown as { authorityState: GameState }).authorityState = game;
  const phaseState = session.state as unknown as {
    currentPhase: GamePhase;
    currentSubPhase: SubPhase;
    currentTurnType: TurnType;
    activePlayerIndex: number;
    waitingPlayerId: string | null;
  };
  phaseState.currentPhase = GamePhase.MAIN_PHASE;
  phaseState.currentSubPhase = SubPhase.MAIN_FREE;
  phaseState.currentTurnType = TurnType.FIRST_PLAYER_TURN;
  phaseState.activePlayerIndex = 0;
  phaseState.waitingPlayerId = null;

  const firstRelay = session.executeCommand(
    createPlayMemberToSlotCommand(PLAYER1, incomingOne.instanceId, SlotPosition.LEFT, {
      freePlay: true,
    })
  );
  expect(firstRelay.success, firstRelay.error).toBe(true);

  if (options.secondMode !== 'preexisting') {
    const secondEnter = session.executeCommand(
      createPlayMemberToSlotCommand(PLAYER1, incomingTwo.instanceId, SlotPosition.CENTER, {
        freePlay: true,
      })
    );
    expect(secondEnter.success, secondEnter.error).toBe(true);
  }

  let state = session.state!;
  if (options.removeFirstRelay === true) {
    state = updatePlayer(state, PLAYER1, (player) => ({
      ...player,
      memberSlots: removeCardFromSlot(player.memberSlots, SlotPosition.LEFT),
      waitingRoom: addCardToZone(player.waitingRoom, incomingOne.instanceId),
    }));
  }

  return {
    ...state,
    liveResolution: {
      ...state.liveResolution,
      performingPlayerId: PLAYER1,
    },
  };
}

describe('conditional live modifier workflow', () => {
  it('shows a confirm-only bridge before resolving PL!HS-bp5-019 Hanamusubi when it is the only pending ability', () => {
    const { game, sourceLives } = setupHanamusubiPendingState({
      sourceCount: 1,
      includeOtherHasunosoraLive: true,
    });

    const preview = resolvePendingCardEffects(game).gameState;

    expect(preview.activeEffect).toMatchObject({
      abilityId: HS_BP5_019_LIVE_START_REQUIREMENT_ABILITY_ID,
      sourceCardId: sourceLives[0]!.instanceId,
      metadata: { confirmOnlyPendingAbility: true },
    });
    expect(preview.pendingAbilities).toHaveLength(1);
    expect(preview.liveResolution.liveModifiers).toEqual([]);

    const state = confirmActiveEffectStep(preview, PLAYER1, preview.activeEffect!.id);
    expect(state.activeEffect).toBeNull();
    expect(state.pendingAbilities).toEqual([]);
    expect(state.liveResolution.liveModifiers).toContainEqual({
      kind: 'REQUIREMENT',
      liveCardId: sourceLives[0]!.instanceId,
      modifiers: [{ color: HeartColor.GREEN, countDelta: -2 }],
      sourceCardId: sourceLives[0]!.instanceId,
      abilityId: HS_BP5_019_LIVE_START_REQUIREMENT_ABILITY_ID,
    });
  });

  it('auto-resolves PL!HS-bp5-019 Hanamusubi abilities after choosing ordered resolution', () => {
    const { game, sourceLives } = setupHanamusubiPendingState({ sourceCount: 2 });
    const orderSelection = resolvePendingCardEffects(game).gameState;

    expect(orderSelection.activeEffect?.canResolveInOrder).toBe(true);
    const state = confirmActiveEffectStep(
      orderSelection,
      PLAYER1,
      orderSelection.activeEffect!.id,
      undefined,
      undefined,
      true
    );

    expect(state.activeEffect).toBeNull();
    expect(state.pendingAbilities).toEqual([]);
    for (const sourceLive of sourceLives) {
      expect(state.liveResolution.liveModifiers).toContainEqual({
        kind: 'REQUIREMENT',
        liveCardId: sourceLive.instanceId,
        modifiers: [{ color: HeartColor.GREEN, countDelta: -2 }],
        sourceCardId: sourceLive.instanceId,
        abilityId: HS_BP5_019_LIVE_START_REQUIREMENT_ABILITY_ID,
      });
    }
  });

  it('shows a confirm-only bridge before resolving manually selected PL!HS-bp5-019 Hanamusubi', () => {
    const { game, sourceLives } = setupHanamusubiPendingState({ sourceCount: 2 });
    const orderSelection = resolvePendingCardEffects(game).gameState;

    const preview = confirmActiveEffectStep(
      orderSelection,
      PLAYER1,
      orderSelection.activeEffect!.id,
      sourceLives[1]!.instanceId
    );

    expect(preview.activeEffect).toMatchObject({
      abilityId: HS_BP5_019_LIVE_START_REQUIREMENT_ABILITY_ID,
      sourceCardId: sourceLives[1]!.instanceId,
      metadata: { confirmOnlyPendingAbility: true },
    });
    expect(
      preview.liveResolution.liveModifiers.some(
        (modifier) => modifier.sourceCardId === sourceLives[1]!.instanceId
      )
    ).toBe(false);
    expect(
      preview.pendingAbilities.some(
        (ability) => ability.sourceCardId === sourceLives[1]!.instanceId
      )
    ).toBe(true);

    const state = expectAutoResolved(
      confirmActiveEffectStep(preview, PLAYER1, preview.activeEffect!.id)
    );

    expect(state.activeEffect).toBeNull();
    expect(state.liveResolution.liveModifiers).toContainEqual({
      kind: 'REQUIREMENT',
      liveCardId: sourceLives[1]!.instanceId,
      modifiers: [{ color: HeartColor.GREEN, countDelta: -2 }],
      sourceCardId: sourceLives[1]!.instanceId,
      abilityId: HS_BP5_019_LIVE_START_REQUIREMENT_ABILITY_ID,
    });
  });

  it.each([
    {
      cardCode: 'PL!HS-bp2-021-L',
      name: '眩耀夜行',
      color: HeartColor.GREEN,
      abilityId: HS_BP2_021_LIVE_START_RELAY_ENTERED_HASUNOSORA_GREEN_REQUIREMENT_ABILITY_ID,
    },
    {
      cardCode: 'PL!HS-bp2-023-L',
      name: 'Mirage Voyage',
      color: HeartColor.BLUE,
      abilityId: HS_BP2_023_LIVE_START_RELAY_ENTERED_HASUNOSORA_BLUE_REQUIREMENT_ABILITY_ID,
    },
    {
      cardCode: 'PL!HS-bp2-025-L',
      name: 'ココン東西',
      color: HeartColor.PINK,
      abilityId: HS_BP2_025_LIVE_START_RELAY_ENTERED_HASUNOSORA_PINK_REQUIREMENT_ABILITY_ID,
    },
  ])('reduces $cardCode requirement after two Hasunosora relay-entered members', (config) => {
    const live = createCardInstance(
      createRelayRequirementLive(config.cardCode, config.name, config.color),
      PLAYER1,
      `${config.cardCode}-live`
    );

    const state = expectAutoResolved(
      runLiveStart(setupRelayEnteredLiveStartState({ live, secondMode: 'relay' }))
    );

    expect(state.liveResolution.liveModifiers).toContainEqual({
      kind: 'REQUIREMENT',
      liveCardId: live.instanceId,
      modifiers: [{ color: config.color, countDelta: -1 }],
      sourceCardId: live.instanceId,
      abilityId: config.abilityId,
    });
    expect(
      state.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId === config.abilityId &&
          action.payload.conditionMet === true &&
          action.payload.requirementReduction === 1 &&
          Array.isArray(action.payload.relayEnteredHasunosoraMemberIds) &&
          action.payload.relayEnteredHasunosoraMemberIds.length === 2
      )
    ).toBe(true);
  });

  it('does not reduce relay-entered requirement with only one relay-entered Hasunosora member', () => {
    const live = createCardInstance(
      createRelayRequirementLive('PL!HS-bp2-021-L', '眩耀夜行', HeartColor.GREEN),
      PLAYER1,
      'relay-one-live'
    );

    const state = expectAutoResolved(
      runLiveStart(setupRelayEnteredLiveStartState({ live, secondMode: 'preexisting' }))
    );

    expect(
      state.liveResolution.liveModifiers.some(
        (modifier) =>
          modifier.kind === 'REQUIREMENT' &&
          modifier.abilityId ===
            HS_BP2_021_LIVE_START_RELAY_ENTERED_HASUNOSORA_GREEN_REQUIREMENT_ABILITY_ID
      )
    ).toBe(false);
    expect(
      state.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId ===
            HS_BP2_021_LIVE_START_RELAY_ENTERED_HASUNOSORA_GREEN_REQUIREMENT_ABILITY_ID &&
          action.payload.conditionMet === false &&
          action.payload.requirementReduction === 0 &&
          Array.isArray(action.payload.relayEnteredHasunosoraMemberIds) &&
          action.payload.relayEnteredHasunosoraMemberIds.length === 1
      )
    ).toBe(true);
  });

  it('does not reduce relay-entered requirement when one of two stage members entered normally', () => {
    const live = createCardInstance(
      createRelayRequirementLive('PL!HS-bp2-023-L', 'Mirage Voyage', HeartColor.BLUE),
      PLAYER1,
      'relay-ordinary-live'
    );

    const state = expectAutoResolved(
      runLiveStart(setupRelayEnteredLiveStartState({ live, secondMode: 'ordinary' }))
    );

    expect(
      state.liveResolution.liveModifiers.some(
        (modifier) =>
          modifier.kind === 'REQUIREMENT' &&
          modifier.abilityId ===
            HS_BP2_023_LIVE_START_RELAY_ENTERED_HASUNOSORA_BLUE_REQUIREMENT_ABILITY_ID
      )
    ).toBe(false);
  });

  it('does not count a relay-entered member that has left the stage', () => {
    const live = createCardInstance(
      createRelayRequirementLive('PL!HS-bp2-025-L', 'ココン東西', HeartColor.PINK),
      PLAYER1,
      'relay-left-stage-live'
    );

    const state = expectAutoResolved(
      runLiveStart(
        setupRelayEnteredLiveStartState({
          live,
          secondMode: 'relay',
          removeFirstRelay: true,
        })
      )
    );

    expect(
      state.liveResolution.liveModifiers.some(
        (modifier) =>
          modifier.kind === 'REQUIREMENT' &&
          modifier.abilityId ===
            HS_BP2_025_LIVE_START_RELAY_ENTERED_HASUNOSORA_PINK_REQUIREMENT_ABILITY_ID
      )
    ).toBe(false);
    expect(
      state.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId ===
            HS_BP2_025_LIVE_START_RELAY_ENTERED_HASUNOSORA_PINK_REQUIREMENT_ABILITY_ID &&
          action.payload.conditionMet === false &&
          Array.isArray(action.payload.relayEnteredHasunosoraMemberIds) &&
          action.payload.relayEnteredHasunosoraMemberIds.length === 1
      )
    ).toBe(true);
  });

  it('adds SCORE +1 to PL!HS-bp5-020-L when two high-cost Hasunosora members are on stage', () => {
    const live = createCardInstance(
      createLive('PL!HS-bp5-020-L', 'バアドケージ'),
      PLAYER1,
      'birdcage-live'
    );
    const stageMembers = [
      {
        card: createCardInstance(
          createMember({ cardCode: 'PL!HS-test-high-1', name: 'High 1', cost: 10 }),
          PLAYER1,
          'high-1'
        ),
        slot: SlotPosition.LEFT,
      },
      {
        card: createCardInstance(
          createMember({ cardCode: 'PL!HS-test-high-2', name: 'High 2', cost: 11 }),
          PLAYER1,
          'high-2'
        ),
        slot: SlotPosition.CENTER,
      },
    ];

    const state = expectAutoResolved(runLiveStart(setupLiveStartState({ live, stageMembers })));

    expect(state.liveResolution.liveModifiers).toContainEqual({
      kind: 'SCORE',
      playerId: PLAYER1,
      countDelta: 1,
      liveCardId: live.instanceId,
      sourceCardId: live.instanceId,
      abilityId: HS_BP5_020_LIVE_START_HIGH_COST_HASUNOSORA_SCORE_ABILITY_ID,
    });
    expect(
      state.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId ===
            HS_BP5_020_LIVE_START_HIGH_COST_HASUNOSORA_SCORE_ABILITY_ID &&
          action.payload.conditionMet === true &&
          action.payload.highCostHasunosoraMemberCount === 2 &&
          action.payload.scoreBonus === 1
      )
    ).toBe(true);
  });

  it('does not add SCORE to PL!HS-bp5-020-L with only one high-cost Hasunosora member', () => {
    const live = createCardInstance(
      createLive('PL!HS-bp5-020-L', 'バアドケージ'),
      PLAYER1,
      'birdcage-live-false'
    );
    const stageMembers = [
      {
        card: createCardInstance(
          createMember({ cardCode: 'PL!HS-test-high-1', name: 'High 1', cost: 10 }),
          PLAYER1,
          'high-1-false'
        ),
        slot: SlotPosition.LEFT,
      },
      {
        card: createCardInstance(
          createMember({ cardCode: 'PL!SP-test-high', name: 'Liella High', cost: 12, groupNames: ['Liella!'] }),
          PLAYER1,
          'liella-high'
        ),
        slot: SlotPosition.CENTER,
      },
    ];

    const state = expectAutoResolved(runLiveStart(setupLiveStartState({ live, stageMembers })));

    expect(
      state.liveResolution.liveModifiers.some(
        (modifier) =>
          modifier.kind === 'SCORE' &&
          modifier.abilityId === HS_BP5_020_LIVE_START_HIGH_COST_HASUNOSORA_SCORE_ABILITY_ID
      )
    ).toBe(false);
  });

  it('reduces PL!HS-bp2-024-L+ requirement when Sayaka effective cost is higher than Kosuzu', () => {
    const live = createCardInstance(
      createLive('PL!HS-bp2-024-L+', 'レディバグ', 4),
      PLAYER1,
      'ladybug-live'
    );
    const successLive = createCardInstance(
      createLive('PL!HS-test-success-six', 'Success 6', 6),
      PLAYER1,
      'success-six'
    );
    const stageMembers = [
      {
        card: createCardInstance(
          createMember({ cardCode: 'PL!HS-test-kosuzu', name: '徒町小鈴', cost: 10 }),
          PLAYER1,
          'kosuzu'
        ),
        slot: SlotPosition.LEFT,
      },
      {
        card: createCardInstance(
          createMember({ cardCode: 'PL!-bp4-008-P', name: '村野さやか', cost: 8 }),
          PLAYER1,
          'sayaka-effective'
        ),
        slot: SlotPosition.CENTER,
      },
    ];

    const state = expectAutoResolved(
      runLiveStart(setupLiveStartState({ live, stageMembers, successLive }))
    );

    expect(state.liveResolution.liveModifiers).toContainEqual({
      kind: 'REQUIREMENT',
      liveCardId: live.instanceId,
      modifiers: [{ color: HeartColor.RAINBOW, countDelta: -3 }],
      sourceCardId: live.instanceId,
      abilityId: HS_BP2_024_LIVE_START_KOSUZU_SAYAKA_REQUIREMENT_ABILITY_ID,
    });
    expect(
      state.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId === HS_BP2_024_LIVE_START_KOSUZU_SAYAKA_REQUIREMENT_ABILITY_ID &&
          action.payload.conditionMet === true &&
          action.payload.requirementReduction === 3
      )
    ).toBe(true);
  });

  it('does not reduce PL!HS-bp2-024-L requirement when Sayaka cost is not higher than Kosuzu', () => {
    const live = createCardInstance(
      createLive('PL!HS-bp2-024-L', 'レディバグ', 4),
      PLAYER1,
      'ladybug-live-false'
    );
    const stageMembers = [
      {
        card: createCardInstance(
          createMember({ cardCode: 'PL!HS-test-kosuzu', name: '徒町小鈴', cost: 10 }),
          PLAYER1,
          'kosuzu-false'
        ),
        slot: SlotPosition.LEFT,
      },
      {
        card: createCardInstance(
          createMember({ cardCode: 'PL!HS-test-sayaka', name: '村野さやか', cost: 10 }),
          PLAYER1,
          'sayaka-false'
        ),
        slot: SlotPosition.CENTER,
      },
    ];

    const state = expectAutoResolved(runLiveStart(setupLiveStartState({ live, stageMembers })));

    expect(
      state.liveResolution.liveModifiers.some(
        (modifier) =>
          modifier.kind === 'REQUIREMENT' &&
          modifier.abilityId === HS_BP2_024_LIVE_START_KOSUZU_SAYAKA_REQUIREMENT_ABILITY_ID
      )
    ).toBe(false);
  });
});
