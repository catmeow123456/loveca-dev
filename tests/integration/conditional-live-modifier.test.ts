import { describe, expect, it } from 'vitest';
import { addCheckTimingRuleSentinel } from '../helpers/check-timing-rule-sentinel';
import type { LiveCardData, MemberCardData } from '../../src/domain/entities/card';
import {
  createCardInstance,
  createHeartIcon,
  createHeartRequirement,
} from '../../src/domain/entities/card';
import {
  createGameState,
  emitGameEvent,
  registerCards,
  updatePlayer,
  type GameState,
  type PendingAbilityState,
} from '../../src/domain/entities/game';
import { createEnterStageEvent } from '../../src/domain/events/game-events';
import {
  addCardToStatefulZone,
  addCardToZone,
  addMemberBelowMember,
  placeCardInSlot,
  removeCardFromStatefulZone,
  removeCardFromSlot,
} from '../../src/domain/entities/zone';
import {
  addLiveModifier,
  collectLiveModifiers,
  getEffectivePerformanceCheerCount,
} from '../../src/domain/rules/live-modifiers';
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
  HS_PB1_026_LIVE_START_DIFFERENT_HASUNOSORA_MEMBER_REDUCE_REQUIREMENT_ABILITY_ID,
  N_SD1_028_LIVE_START_STAGE_BLADE_TEN_GAIN_SCORE_ABILITY_ID,
  SP_BP1_026_LIVE_START_DIFFERENT_LIELLA_REPLACE_REQUIREMENT_ABILITY_ID,
  PL_BP3_023_LIVE_START_STAGE_BLADE_TEN_REDUCE_REQUIREMENT_ABILITY_ID,
  PL_BP4_022_LIVE_START_CENTER_MUSE_BLADE_NINE_SCORE_TWO_ABILITY_ID,
  PL_N_BP3_005_LIVE_START_TWO_MEMBER_ENTRIES_GAIN_SCORE_ABILITY_ID,
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
  ZoneType,
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
  readonly blade?: number;
  readonly groupNames?: readonly string[];
}): MemberCardData {
  return {
    cardCode: options.cardCode,
    name: options.name,
    groupNames: options.groupNames ?? ['蓮ノ空女学院スクールアイドルクラブ'],
    unitName: 'DOLLCHESTRA',
    cardType: CardType.MEMBER,
    cost: options.cost,
    blade: options.blade ?? 1,
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
    readonly orientation?: OrientationState;
  }[];
  readonly successLive?: ReturnType<typeof createCardInstance>;
  readonly additionalLives?: readonly ReturnType<typeof createCardInstance>[];
}): GameState {
  let game = createGameState('conditional-live-modifier', PLAYER1, 'P1', PLAYER2, 'P2');
  game = registerCards(game, [
    options.live,
    ...(options.additionalLives ?? []),
    ...options.stageMembers.map((member) => member.card),
    ...(options.successLive ? [options.successLive] : []),
  ]);
  game = updatePlayer(game, PLAYER1, (player) => {
    let memberSlots = player.memberSlots;
    for (const stageMember of options.stageMembers) {
      memberSlots = placeCardInSlot(memberSlots, stageMember.slot, stageMember.card.instanceId, {
        orientation: stageMember.orientation ?? OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      });
    }
    return {
      ...player,
      liveZone: [options.live, ...(options.additionalLives ?? [])].reduce(
        (zone, live) =>
          addCardToStatefulZone(zone, live.instanceId, {
            orientation: OrientationState.ACTIVE,
            face: FaceState.FACE_UP,
          }),
        player.liveZone
      ),
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

function setupPb1026LiveStartPending(memberNames: readonly string[]): {
  readonly game: GameState;
  readonly live: ReturnType<typeof createCardInstance>;
  readonly members: readonly ReturnType<typeof createCardInstance>[];
} {
  const live = createCardInstance(
    createLive('PL!HS-pb1-026-L', '雪舞う空と二秒の永远', 4),
    PLAYER1,
    'pb1-026-live'
  );
  const members = memberNames.map((name, index) =>
    createCardInstance(
      createMember({ cardCode: `PL!HS-test-pb1-026-${index}`, name, cost: index + 1 }),
      PLAYER1,
      `pb1-026-member-${index}`
    )
  );
  let game = createGameState('conditional-live-modifier-pb1-026', PLAYER1, 'P1', PLAYER2, 'P2');
  game = registerCards(game, [live, ...members]);
  game = updatePlayer(game, PLAYER1, (player) => {
    let memberSlots = player.memberSlots;
    for (const [index, slot] of [
      SlotPosition.LEFT,
      SlotPosition.CENTER,
      SlotPosition.RIGHT,
    ].entries()) {
      const member = members[index];
      if (!member) {
        continue;
      }
      memberSlots = placeCardInSlot(memberSlots, slot, member.instanceId, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      });
    }
    return {
      ...player,
      memberSlots,
      liveZone: addCardToStatefulZone(player.liveZone, live.instanceId, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      }),
      waitingRoom: members
        .slice(3)
        .reduce((zone, member) => addCardToZone(zone, member.instanceId), player.waitingRoom),
    };
  });
  return {
    game: {
      ...game,
      pendingAbilities: [
        {
          id: 'pb1-026-pending',
          abilityId:
            HS_PB1_026_LIVE_START_DIFFERENT_HASUNOSORA_MEMBER_REDUCE_REQUIREMENT_ABILITY_ID,
          sourceCardId: live.instanceId,
          controllerId: PLAYER1,
          mandatory: true,
          timingId: TriggerCondition.ON_LIVE_START,
        },
      ],
      liveResolution: { ...game.liveResolution, performingPlayerId: PLAYER1 },
    },
    live,
    members,
  };
}

function setupSpBp1026Pending(options: {
  readonly names: readonly string[];
  readonly sourceCount?: number;
  readonly preserveOtherRequirementModifier?: boolean;
}): {
  readonly game: GameState;
  readonly lives: readonly ReturnType<typeof createCardInstance>[];
  readonly members: readonly ReturnType<typeof createCardInstance>[];
} {
  const lives = Array.from({ length: options.sourceCount ?? 1 }, (_, index) =>
    createCardInstance(
      createLive('PL!SP-bp1-026-L', '未来予報ハレルヤ！', 3),
      PLAYER1,
      `sp-bp1-026-live-${index}`
    )
  );
  const members = options.names.map((name, index) =>
    createCardInstance(
      createMember({
        cardCode: `PL!SP-test-bp1-026-${index}`,
        name,
        cost: index + 1,
        groupNames: ['Liella!'],
      }),
      PLAYER1,
      `sp-bp1-026-member-${index}`
    )
  );
  let game = registerCards(
    createGameState('conditional-live-modifier-sp-bp1-026', PLAYER1, 'P1', PLAYER2, 'P2'),
    [...lives, ...members]
  );
  game = updatePlayer(game, PLAYER1, (player) => {
    let memberSlots = player.memberSlots;
    for (const [index, slot] of [
      SlotPosition.LEFT,
      SlotPosition.CENTER,
      SlotPosition.RIGHT,
    ].entries()) {
      if (members[index]) {
        memberSlots = placeCardInSlot(memberSlots, slot, members[index]!.instanceId);
      }
    }
    return {
      ...player,
      memberSlots,
      liveZone: lives.reduce(
        (zone, live) => addCardToStatefulZone(zone, live.instanceId),
        player.liveZone
      ),
      waitingRoom: members
        .slice(3)
        .reduce((zone, member) => addCardToZone(zone, member.instanceId), player.waitingRoom),
    };
  });
  game = {
    ...game,
    pendingAbilities: lives.map((live, index) => ({
      id: `sp-bp1-026-pending-${index}`,
      abilityId: SP_BP1_026_LIVE_START_DIFFERENT_LIELLA_REPLACE_REQUIREMENT_ABILITY_ID,
      sourceCardId: live.instanceId,
      controllerId: PLAYER1,
      mandatory: true,
      timingId: TriggerCondition.ON_LIVE_START,
    })),
    liveResolution: { ...game.liveResolution, performingPlayerId: PLAYER1 },
  };
  if (options.preserveOtherRequirementModifier) {
    game = addLiveModifier(game, {
      kind: 'REQUIREMENT',
      liveCardId: lives[0]!.instanceId,
      modifiers: [{ color: HeartColor.RED, countDelta: -1 }],
      sourceCardId: 'other-source',
      abilityId: 'other-requirement-ability',
    });
  }
  return { game, lives, members };
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

function setupStageBladeTotalScenario(options: {
  readonly cardCode: string;
  readonly name: string;
  readonly score: number;
  readonly blades: readonly number[];
  readonly orientations?: readonly OrientationState[];
  readonly sourceCount?: number;
}): {
  readonly game: GameState;
  readonly lives: readonly ReturnType<typeof createCardInstance>[];
  readonly members: readonly ReturnType<typeof createCardInstance>[];
} {
  const sourceCount = options.sourceCount ?? 1;
  const lives = Array.from({ length: sourceCount }, (_, index) =>
    createCardInstance(
      createLive(options.cardCode, options.name, options.score),
      PLAYER1,
      `stage-blade-live-${index}`
    )
  );
  const slots = [SlotPosition.LEFT, SlotPosition.CENTER, SlotPosition.RIGHT] as const;
  const members = options.blades.map((blade, index) =>
    createCardInstance(
      createMember({
        cardCode: `PL!-test-stage-blade-member-${index}`,
        name: `测试成员${index + 1}`,
        cost: 1,
        blade,
      }),
      PLAYER1,
      `stage-blade-member-${index}`
    )
  );
  return {
    game: (() => {
      const game = setupLiveStartState({
        live: lives[0]!,
        additionalLives: lives.slice(1),
        stageMembers: members.map((card, index) => ({
          card,
          slot: slots[index]!,
          orientation: options.orientations?.[index],
        })),
      });
      return {
        ...game,
        liveResolution: {
          ...game.liveResolution,
          playerScores: new Map([[PLAYER1, sourceCount * options.score]]),
        },
      };
    })(),
    lives,
    members,
  };
}

function setupBp3023StageBladeScenario(
  options: Omit<Parameters<typeof setupStageBladeTotalScenario>[0], 'cardCode' | 'name' | 'score'>
) {
  return setupStageBladeTotalScenario({
    ...options,
    cardCode: 'PL!-bp3-023-L',
    name: "ミはμ'sicのミ",
    score: 3,
  });
}

function setupDreamWithYouScenario(
  options: Omit<Parameters<typeof setupStageBladeTotalScenario>[0], 'cardCode' | 'name' | 'score'>
) {
  return setupStageBladeTotalScenario({
    ...options,
    cardCode: 'PL!N-sd1-028-SD',
    name: 'Dream with You',
    score: 4,
  });
}

function dreamWithYouScoreModifiers(game: GameState) {
  return game.liveResolution.liveModifiers.filter(
    (modifier) =>
      modifier.kind === 'SCORE' &&
      modifier.abilityId === N_SD1_028_LIVE_START_STAGE_BLADE_TEN_GAIN_SCORE_ABILITY_ID
  );
}

function createDreamWithYouPending(sourceCardId: string, index = 0): PendingAbilityState {
  return {
    id: `dream-with-you-pending-${index}`,
    abilityId: N_SD1_028_LIVE_START_STAGE_BLADE_TEN_GAIN_SCORE_ABILITY_ID,
    sourceCardId,
    controllerId: PLAYER1,
    mandatory: true,
    timingId: TriggerCondition.ON_LIVE_START,
    eventIds: ['dream-with-you-live-start'],
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

function setupNoBrandGirlsState(
  options: {
    readonly sourceCount?: number;
    readonly centerKind?: 'muse' | 'non-muse' | 'empty';
    readonly centerBlade?: number;
    readonly bladeModifier?: number;
    readonly playerScore?: number;
  } = {}
): {
  readonly game: GameState;
  readonly lives: readonly ReturnType<typeof createCardInstance>[];
  readonly center: ReturnType<typeof createCardInstance>;
} {
  const sourceCount = options.sourceCount ?? 1;
  const lives = Array.from({ length: sourceCount }, (_, index) =>
    createCardInstance(
      createLive('PL!-bp4-022-L', 'No brand girls', 7),
      PLAYER1,
      `no-brand-girls-${index}`
    )
  );
  const center = createCardInstance(
    createMember({
      cardCode: options.centerKind === 'non-muse' ? 'PL!S-test-center' : 'PL!-test-center',
      name: options.centerKind === 'non-muse' ? '高海千歌' : '絢瀬絵里',
      cost: 4,
      blade: options.centerBlade ?? 9,
      groupNames: options.centerKind === 'non-muse' ? ['Aqours'] : ["μ's"],
    }),
    PLAYER1,
    'no-brand-girls-center'
  );
  let game = setupLiveStartState({
    live: lives[0]!,
    additionalLives: lives.slice(1),
    stageMembers:
      options.centerKind === 'empty' ? [] : [{ card: center, slot: SlotPosition.CENTER }],
  });
  game = {
    ...game,
    liveResolution: {
      ...game.liveResolution,
      playerScores: new Map([[PLAYER1, options.playerScore ?? sourceCount * 7]]),
    },
  };
  if (options.bladeModifier) {
    game = addLiveModifier(game, {
      kind: 'BLADE',
      playerId: PLAYER1,
      countDelta: options.bladeModifier,
      sourceCardId: center.instanceId,
      abilityId: 'test:no-brand-girls-center-blade',
    });
  }
  return { game, lives, center };
}

function noBrandGirlsScoreModifiers(game: GameState) {
  return game.liveResolution.liveModifiers.filter(
    (modifier) =>
      modifier.kind === 'SCORE' &&
      modifier.abilityId === PL_BP4_022_LIVE_START_CENTER_MUSE_BLADE_NINE_SCORE_TWO_ABILITY_ID
  );
}

function createNoBrandGirlsPending(sourceCardId: string, index = 0): PendingAbilityState {
  return {
    id: `no-brand-girls-pending-${index}`,
    abilityId: PL_BP4_022_LIVE_START_CENTER_MUSE_BLADE_NINE_SCORE_TWO_ABILITY_ID,
    sourceCardId,
    controllerId: PLAYER1,
    mandatory: true,
    timingId: TriggerCondition.ON_LIVE_START,
    eventIds: ['no-brand-girls-live-start'],
  };
}

describe('conditional live modifier workflow', () => {
  it('recomputes PL!HS-pb1-026 different Hasunosora members across stage and waiting room before writing RAINBOW -2', () => {
    const live = createCardInstance(
      createLive('PL!HS-pb1-026-L', '雪舞う空と二秒の永遠', 4),
      PLAYER1,
      'pb1-026-live'
    );
    const members = Array.from({ length: 6 }, (_, index) =>
      createCardInstance(
        createMember({
          cardCode: `PL!HS-test-pb1-026-${index}`,
          name: `成员${index}`,
          cost: index + 1,
        }),
        PLAYER1,
        `pb1-026-member-${index}`
      )
    );
    let game = createGameState('conditional-live-modifier-pb1-026', PLAYER1, 'P1', PLAYER2, 'P2');
    game = registerCards(game, [live, ...members]);
    game = updatePlayer(game, PLAYER1, (player) => {
      let memberSlots = player.memberSlots;
      for (const [index, slot] of [
        SlotPosition.LEFT,
        SlotPosition.CENTER,
        SlotPosition.RIGHT,
      ].entries()) {
        memberSlots = placeCardInSlot(memberSlots, slot, members[index]!.instanceId, {
          orientation: OrientationState.ACTIVE,
          face: FaceState.FACE_UP,
        });
      }
      return {
        ...player,
        memberSlots,
        liveZone: addCardToStatefulZone(player.liveZone, live.instanceId, {
          orientation: OrientationState.ACTIVE,
          face: FaceState.FACE_UP,
        }),
        waitingRoom: members
          .slice(3)
          .reduce((zone, member) => addCardToZone(zone, member.instanceId), player.waitingRoom),
      };
    });
    game = {
      ...game,
      pendingAbilities: [
        {
          id: 'pb1-026-pending',
          abilityId:
            HS_PB1_026_LIVE_START_DIFFERENT_HASUNOSORA_MEMBER_REDUCE_REQUIREMENT_ABILITY_ID,
          sourceCardId: live.instanceId,
          controllerId: PLAYER1,
          mandatory: true,
          timingId: TriggerCondition.ON_LIVE_START,
        },
      ],
      liveResolution: { ...game.liveResolution, performingPlayerId: PLAYER1 },
    };

    const preview = resolvePendingCardEffects(game).gameState;
    expect(preview.activeEffect?.effectText).toContain('不同名『莲之空』成员6名');
    const resolved = confirmActiveEffectStep(preview, PLAYER1, preview.activeEffect!.id);
    expect(resolved.liveResolution.liveModifiers).toContainEqual({
      kind: 'REQUIREMENT',
      liveCardId: live.instanceId,
      modifiers: [{ color: HeartColor.RAINBOW, countDelta: -2 }],
      sourceCardId: live.instanceId,
      abilityId: HS_PB1_026_LIVE_START_DIFFERENT_HASUNOSORA_MEMBER_REDUCE_REQUIREMENT_ABILITY_ID,
    });
  });

  it('shows the actual distinct count when extra duplicate Hasunosora members are present', () => {
    const { game } = setupPb1026LiveStartPending([
      '成员甲',
      '成员乙',
      '成员丙',
      '成员丁',
      '成员戊',
      '成员己',
      '成员甲',
    ]);
    const preview = resolvePendingCardEffects(game).gameState;

    expect(preview.activeEffect?.effectText).toContain('不同名『莲之空』成员6名');
    expect(preview.activeEffect?.effectText).toContain('满足条件');
    expect(preview.activeEffect?.effectText).not.toContain('成员0名');
  });

  it.each([
    ['only five different names', ['成员甲', '成员乙', '成员丙', '成员丁', '成员戊'], 5],
    [
      'a duplicate across stage and waiting room',
      ['成员甲', '成员乙', '成员丙', '成员丁', '成员戊', '成员甲'],
      5,
    ],
  ])('does not reduce PL!HS-pb1-026 with %s', (_label, memberNames, expectedCount) => {
    const { game, live } = setupPb1026LiveStartPending(memberNames);
    const preview = resolvePendingCardEffects(game).gameState;
    expect(preview.activeEffect?.effectText).toContain(`不同名『莲之空』成员${expectedCount}名`);
    expect(preview.activeEffect?.effectText).toContain('未满足条件');

    const resolved = confirmActiveEffectStep(preview, PLAYER1, preview.activeEffect!.id);
    expect(
      resolved.liveResolution.liveModifiers.some(
        (modifier) =>
          modifier.kind === 'REQUIREMENT' &&
          modifier.liveCardId === live.instanceId &&
          modifier.abilityId ===
            HS_PB1_026_LIVE_START_DIFFERENT_HASUNOSORA_MEMBER_REDUCE_REQUIREMENT_ABILITY_ID
      )
    ).toBe(false);
  });

  it('recomputes PL!HS-pb1-026 at confirmation after its LIVE source or sixth distinct member leaves', () => {
    const names = ['成员甲', '成员乙', '成员丙', '成员丁', '成员戊', '成员己'];
    const sourceScenario = setupPb1026LiveStartPending(names);
    const sourcePreview = resolvePendingCardEffects(sourceScenario.game).gameState;
    expect(sourcePreview.activeEffect?.effectText).toContain('满足条件');
    const sourceRemoved = updatePlayer(sourcePreview, PLAYER1, (player) => ({
      ...player,
      liveZone: {
        ...player.liveZone,
        cardIds: player.liveZone.cardIds.filter(
          (cardId) => cardId !== sourceScenario.live.instanceId
        ),
        cardStates: new Map(
          [...player.liveZone.cardStates].filter(
            ([cardId]) => cardId !== sourceScenario.live.instanceId
          )
        ),
      },
    }));
    const sourceResolved = confirmActiveEffectStep(
      sourceRemoved,
      PLAYER1,
      sourceRemoved.activeEffect!.id
    );
    expect(sourceResolved.liveResolution.liveModifiers).toEqual([]);

    const countScenario = setupPb1026LiveStartPending(names);
    const countPreview = resolvePendingCardEffects(countScenario.game).gameState;
    const sixthMemberId = countScenario.members[5]!.instanceId;
    const sixthRemoved = updatePlayer(countPreview, PLAYER1, (player) => ({
      ...player,
      waitingRoom: {
        ...player.waitingRoom,
        cardIds: player.waitingRoom.cardIds.filter((cardId) => cardId !== sixthMemberId),
      },
    }));
    const countResolved = confirmActiveEffectStep(
      sixthRemoved,
      PLAYER1,
      sixthRemoved.activeEffect!.id
    );
    expect(countResolved.liveResolution.liveModifiers).toEqual([]);
  });

  it('auto-resolves ordered PL!HS-pb1-026 pendings without opening confirm-only and writes both RAINBOW reductions', () => {
    const scenario = setupPb1026LiveStartPending([
      '成员甲',
      '成员乙',
      '成员丙',
      '成员丁',
      '成员戊',
      '成员己',
    ]);
    const secondLive = createCardInstance(
      createLive('PL!HS-pb1-026-L', '雪舞う空と二秒の永远', 4),
      PLAYER1,
      'pb1-026-second-live'
    );
    let game = addCheckTimingRuleSentinel(
      registerCards(scenario.game, [secondLive]),
      PLAYER1,
      'conditional-live-modifier-ordered'
    );
    game = updatePlayer(game, PLAYER1, (player) => ({
      ...player,
      liveZone: addCardToStatefulZone(player.liveZone, secondLive.instanceId, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      }),
    }));
    game = {
      ...game,
      pendingAbilities: [
        ...game.pendingAbilities,
        {
          id: 'pb1-026-second-pending',
          abilityId:
            HS_PB1_026_LIVE_START_DIFFERENT_HASUNOSORA_MEMBER_REDUCE_REQUIREMENT_ABILITY_ID,
          sourceCardId: secondLive.instanceId,
          controllerId: PLAYER1,
          mandatory: true,
          timingId: TriggerCondition.ON_LIVE_START,
        },
      ],
    };
    const orderSelection = resolvePendingCardEffects(game).gameState;
    expect(orderSelection.activeEffect?.canResolveInOrder).toBe(true);
    const resolved = confirmActiveEffectStep(
      orderSelection,
      PLAYER1,
      orderSelection.activeEffect!.id,
      undefined,
      undefined,
      true
    );
    expect(resolved.activeEffect).toBeNull();
    expect(resolved.pendingAbilities).toEqual([]);
    for (const liveCardId of [scenario.live.instanceId, secondLive.instanceId]) {
      expect(resolved.liveResolution.liveModifiers).toContainEqual({
        kind: 'REQUIREMENT',
        liveCardId,
        modifiers: [{ color: HeartColor.RAINBOW, countDelta: -2 }],
        sourceCardId: liveCardId,
        abilityId: HS_PB1_026_LIVE_START_DIFFERENT_HASUNOSORA_MEMBER_REDUCE_REQUIREMENT_ABILITY_ID,
      });
    }
  });
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
          createMember({
            cardCode: 'PL!SP-test-high',
            name: 'Liella High',
            cost: 12,
            groupNames: ['Liella!'],
          }),
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

  it('confirms PL!-bp3-023-L before counting effective stage BLADE and includes WAITING members', () => {
    const scenario = setupBp3023StageBladeScenario({
      blades: [4, 3, 3],
      orientations: [OrientationState.ACTIVE, OrientationState.WAITING, OrientationState.ACTIVE],
    });
    const preview = runLiveStart(scenario.game);

    expect(preview.activeEffect).toMatchObject({
      abilityId: PL_BP3_023_LIVE_START_STAGE_BLADE_TEN_REDUCE_REQUIREMENT_ABILITY_ID,
      sourceCardId: scenario.lives[0]!.instanceId,
      metadata: { confirmOnlyPendingAbility: true },
    });
    expect(preview.activeEffect?.effectText).toContain(
      '【LIVE开始时】存在于自己的舞台的成员持有的[BLADE]的合计大于等于10的场合、使此卡成功的必要HEART减少[無ハート][無ハート]。'
    );
    expect(preview.activeEffect?.effectText).toContain('当前自己舞台成员持有的[BLADE]合计10');
    expect(preview.activeEffect?.effectText).toContain('满足条件，实际减少2个[無ハート]');
    expect(preview.activeEffect?.effectText).not.toMatch(/source|pending|stale|来源|LIVE区/);
    expect(preview.liveResolution.liveModifiers).toEqual([]);

    const state = confirmActiveEffectStep(preview, PLAYER1, preview.activeEffect!.id);
    expect(state.liveResolution.liveModifiers).toContainEqual({
      kind: 'REQUIREMENT',
      liveCardId: scenario.lives[0]!.instanceId,
      modifiers: [{ color: HeartColor.RAINBOW, countDelta: -2 }],
      sourceCardId: scenario.lives[0]!.instanceId,
      abilityId: PL_BP3_023_LIVE_START_STAGE_BLADE_TEN_REDUCE_REQUIREMENT_ABILITY_ID,
    });
    expect(
      state.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId ===
            PL_BP3_023_LIVE_START_STAGE_BLADE_TEN_REDUCE_REQUIREMENT_ABILITY_ID &&
          action.payload.stageBladeTotal === 10 &&
          action.payload.conditionMet === true &&
          action.payload.requirementReduction === 2
      )
    ).toBe(true);
  });

  it('does not reduce PL!-bp3-023-L requirement when effective stage BLADE is below ten', () => {
    const scenario = setupBp3023StageBladeScenario({ blades: [3, 3, 3] });
    const preview = runLiveStart(scenario.game);
    expect(preview.activeEffect?.effectText).toContain('[BLADE]合计9');
    expect(preview.activeEffect?.effectText).toContain('未满足条件，实际不减少[無ハート]');

    const state = confirmActiveEffectStep(preview, PLAYER1, preview.activeEffect!.id);
    expect(
      state.liveResolution.liveModifiers.some(
        (modifier) =>
          modifier.kind === 'REQUIREMENT' &&
          modifier.abilityId === PL_BP3_023_LIVE_START_STAGE_BLADE_TEN_REDUCE_REQUIREMENT_ABILITY_ID
      )
    ).toBe(false);
  });

  it('recomputes PL!-bp3-023-L effective BLADE at confirmation and clears stale requirement state', () => {
    const gainedScenario = setupBp3023StageBladeScenario({ blades: [3, 3, 3] });
    const gainedPreview = runLiveStart(gainedScenario.game);
    expect(gainedPreview.activeEffect?.effectText).toContain('[BLADE]合计9');
    const gainedBeforeConfirmation = addLiveModifier(gainedPreview, {
      kind: 'BLADE',
      playerId: PLAYER1,
      countDelta: 1,
      sourceCardId: gainedScenario.members[0]!.instanceId,
      abilityId: 'test:bp3-023-live-blade-gained',
    });
    const gainedState = confirmActiveEffectStep(
      gainedBeforeConfirmation,
      PLAYER1,
      gainedBeforeConfirmation.activeEffect!.id
    );
    expect(gainedState.liveResolution.liveModifiers).toContainEqual(
      expect.objectContaining({
        kind: 'REQUIREMENT',
        liveCardId: gainedScenario.lives[0]!.instanceId,
        abilityId: PL_BP3_023_LIVE_START_STAGE_BLADE_TEN_REDUCE_REQUIREMENT_ABILITY_ID,
      })
    );

    const lostScenario = setupBp3023StageBladeScenario({ blades: [3, 3, 3] });
    let lostGame = addLiveModifier(lostScenario.game, {
      kind: 'BLADE',
      playerId: PLAYER1,
      countDelta: 1,
      sourceCardId: lostScenario.members[0]!.instanceId,
      abilityId: 'test:bp3-023-live-blade-lost',
    });
    lostGame = addLiveModifier(lostGame, {
      kind: 'REQUIREMENT',
      liveCardId: lostScenario.lives[0]!.instanceId,
      modifiers: [{ color: HeartColor.RAINBOW, countDelta: -2 }],
      sourceCardId: lostScenario.lives[0]!.instanceId,
      abilityId: PL_BP3_023_LIVE_START_STAGE_BLADE_TEN_REDUCE_REQUIREMENT_ABILITY_ID,
    });
    const lostPreview = runLiveStart(lostGame);
    expect(lostPreview.activeEffect?.effectText).toContain('[BLADE]合计10');
    const lostBeforeConfirmation = {
      ...lostPreview,
      liveResolution: {
        ...lostPreview.liveResolution,
        liveModifiers: lostPreview.liveResolution.liveModifiers.filter(
          (modifier) => modifier.abilityId !== 'test:bp3-023-live-blade-lost'
        ),
      },
    };
    const lostState = confirmActiveEffectStep(
      lostBeforeConfirmation,
      PLAYER1,
      lostBeforeConfirmation.activeEffect!.id
    );
    expect(
      lostState.liveResolution.liveModifiers.some(
        (modifier) =>
          modifier.kind === 'REQUIREMENT' &&
          modifier.abilityId === PL_BP3_023_LIVE_START_STAGE_BLADE_TEN_REDUCE_REQUIREMENT_ABILITY_ID
      )
    ).toBe(false);
  });

  it('rechecks that PL!-bp3-023-L is still in the controller LIVE zone on confirmation', () => {
    const scenario = setupBp3023StageBladeScenario({ blades: [4, 3, 3] });
    const preview = runLiveStart(scenario.game);
    const sourceRemoved = updatePlayer(preview, PLAYER1, (player) => ({
      ...player,
      liveZone: removeCardFromStatefulZone(player.liveZone, scenario.lives[0]!.instanceId),
    }));
    const state = confirmActiveEffectStep(sourceRemoved, PLAYER1, sourceRemoved.activeEffect!.id);
    expect(
      state.liveResolution.liveModifiers.some(
        (modifier) =>
          modifier.kind === 'REQUIREMENT' &&
          modifier.abilityId === PL_BP3_023_LIVE_START_STAGE_BLADE_TEN_REDUCE_REQUIREMENT_ABILITY_ID
      )
    ).toBe(false);
    expect(
      state.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId ===
            PL_BP3_023_LIVE_START_STAGE_BLADE_TEN_REDUCE_REQUIREMENT_ABILITY_ID &&
          action.payload.sourceInLiveZone === false &&
          action.payload.requirementReduction === 0
      )
    ).toBe(true);
  });

  it('auto-resolves ordered PL!-bp3-023-L pendings and confirms a manually selected one first', () => {
    const orderedScenario = setupBp3023StageBladeScenario({
      blades: [4, 3, 3],
      sourceCount: 2,
    });
    const orderSelection = runLiveStart(orderedScenario.game);
    expect(orderSelection.activeEffect?.canResolveInOrder).toBe(true);
    const ordered = confirmActiveEffectStep(
      orderSelection,
      PLAYER1,
      orderSelection.activeEffect!.id,
      undefined,
      undefined,
      true
    );
    expect(ordered.activeEffect).toBeNull();
    expect(ordered.pendingAbilities).toEqual([]);
    expect(
      ordered.liveResolution.liveModifiers.filter(
        (modifier) =>
          modifier.kind === 'REQUIREMENT' &&
          modifier.abilityId === PL_BP3_023_LIVE_START_STAGE_BLADE_TEN_REDUCE_REQUIREMENT_ABILITY_ID
      )
    ).toHaveLength(2);

    const manualScenario = setupBp3023StageBladeScenario({
      blades: [4, 3, 3],
      sourceCount: 2,
    });
    const manualOrderSelection = runLiveStart(manualScenario.game);
    const preview = confirmActiveEffectStep(
      manualOrderSelection,
      PLAYER1,
      manualOrderSelection.activeEffect!.id,
      manualScenario.lives[1]!.instanceId
    );
    expect(preview.activeEffect).toMatchObject({
      abilityId: PL_BP3_023_LIVE_START_STAGE_BLADE_TEN_REDUCE_REQUIREMENT_ABILITY_ID,
      sourceCardId: manualScenario.lives[1]!.instanceId,
      metadata: { confirmOnlyPendingAbility: true },
    });
    expect(
      preview.liveResolution.liveModifiers.some(
        (modifier) =>
          modifier.kind === 'REQUIREMENT' &&
          modifier.abilityId === PL_BP3_023_LIVE_START_STAGE_BLADE_TEN_REDUCE_REQUIREMENT_ABILITY_ID
      )
    ).toBe(false);
    const confirmed = confirmActiveEffectStep(preview, PLAYER1, preview.activeEffect!.id);
    expect(confirmed.liveResolution.liveModifiers).toContainEqual(
      expect.objectContaining({
        kind: 'REQUIREMENT',
        sourceCardId: manualScenario.lives[1]!.instanceId,
        abilityId: PL_BP3_023_LIVE_START_STAGE_BLADE_TEN_REDUCE_REQUIREMENT_ABILITY_ID,
      })
    );
  });

  it('confirms Dream with You at exactly ten effective stage BLADE, including a WAITING member, before applying SCORE +1', () => {
    const scenario = setupDreamWithYouScenario({
      blades: [4, 3, 3],
      orientations: [OrientationState.ACTIVE, OrientationState.WAITING, OrientationState.ACTIVE],
    });
    const preview = runLiveStart(scenario.game);

    expect(preview.activeEffect).toMatchObject({
      abilityId: N_SD1_028_LIVE_START_STAGE_BLADE_TEN_GAIN_SCORE_ABILITY_ID,
      sourceCardId: scenario.lives[0]!.instanceId,
      metadata: { confirmOnlyPendingAbility: true },
    });
    expect(preview.activeEffect?.effectText).toContain(
      '【LIVE开始时】存在于自己的舞台的成员持有的[BLADE]的合计大于等于10时，此卡的分数+1。'
    );
    expect(preview.activeEffect?.effectText).toContain(
      '当前自己舞台成员持有的[BLADE]合计10，满足条件，实际此卡[スコア]+1。'
    );
    expect(preview.activeEffect?.stepText).toBe(preview.activeEffect?.effectText);
    expect(preview.activeEffect?.effectText).not.toMatch(
      /source|pending|stale|eventId|trigger|来源|LIVE区/
    );
    expect(preview.activeEffect?.effectText?.match(/\[[^\]]+\]/g)?.every(
      (token) => token === '[BLADE]' || token === '[スコア]'
    )).toBe(true);
    expect(dreamWithYouScoreModifiers(preview)).toHaveLength(0);
    expect(preview.liveResolution.playerScores.get(PLAYER1)).toBe(4);

    const resolved = confirmActiveEffectStep(preview, PLAYER1, preview.activeEffect!.id);
    expect(dreamWithYouScoreModifiers(resolved)).toEqual([
      {
        kind: 'SCORE',
        playerId: PLAYER1,
        countDelta: 1,
        liveCardId: scenario.lives[0]!.instanceId,
        sourceCardId: scenario.lives[0]!.instanceId,
        abilityId: N_SD1_028_LIVE_START_STAGE_BLADE_TEN_GAIN_SCORE_ABILITY_ID,
      },
    ]);
    expect(resolved.liveResolution.playerScores.get(PLAYER1)).toBe(5);
    expect(
      resolved.actionHistory.find(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId === N_SD1_028_LIVE_START_STAGE_BLADE_TEN_GAIN_SCORE_ABILITY_ID
      )?.payload
    ).toMatchObject({
      stageMemberCardIds: scenario.members.map((member) => member.instanceId),
      stageMemberBladeCounts: [4, 3, 3],
      stageBladeTotal: 10,
      sourceInLiveZone: true,
      conditionMet: true,
      scoreBonus: 1,
      scoreDelta: 1,
    });
  });

  it('shows the unmet Dream with You result and does not add SCORE at effective stage BLADE nine', () => {
    const scenario = setupDreamWithYouScenario({ blades: [3, 3, 3] });
    const preview = runLiveStart(scenario.game);
    expect(preview.activeEffect?.effectText).toContain(
      '当前自己舞台成员持有的[BLADE]合计9，未满足条件，实际不增加此卡[スコア]。'
    );

    const resolved = confirmActiveEffectStep(preview, PLAYER1, preview.activeEffect!.id);
    expect(dreamWithYouScoreModifiers(resolved)).toHaveLength(0);
    expect(resolved.liveResolution.playerScores.get(PLAYER1)).toBe(4);
  });

  it('uses effective BLADE modifiers for Dream with You instead of printed BLADE only', () => {
    const scenario = setupDreamWithYouScenario({ blades: [3, 3, 3] });
    const withBladeModifier = addLiveModifier(scenario.game, {
      kind: 'BLADE',
      playerId: PLAYER1,
      countDelta: 1,
      sourceCardId: scenario.members[0]!.instanceId,
      abilityId: 'test:dream-with-you-blade-plus-one',
    });
    const preview = runLiveStart(withBladeModifier);
    expect(preview.activeEffect?.effectText).toContain('[BLADE]合计10');
    const resolved = confirmActiveEffectStep(preview, PLAYER1, preview.activeEffect!.id);
    expect(dreamWithYouScoreModifiers(resolved)).toHaveLength(1);
  });

  it('does not count opponent members or member-below cards for Dream with You', () => {
    const scenario = setupDreamWithYouScenario({ blades: [3, 3, 3] });
    const opponentMember = createCardInstance(
      createMember({ cardCode: 'test-opponent-stage', name: 'Opponent', cost: 1, blade: 20 }),
      PLAYER2,
      'dream-with-you-opponent-member'
    );
    const belowMember = createCardInstance(
      createMember({ cardCode: 'test-member-below', name: 'Below', cost: 1, blade: 20 }),
      PLAYER1,
      'dream-with-you-below-member'
    );
    let game = registerCards(scenario.game, [opponentMember, belowMember]);
    game = updatePlayer(game, PLAYER1, (player) => ({
      ...player,
      memberSlots: addMemberBelowMember(
        player.memberSlots,
        SlotPosition.CENTER,
        belowMember.instanceId
      ),
    }));
    game = updatePlayer(game, PLAYER2, (player) => ({
      ...player,
      memberSlots: placeCardInSlot(
        player.memberSlots,
        SlotPosition.LEFT,
        opponentMember.instanceId,
        { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }
      ),
    }));

    const preview = runLiveStart(game);
    expect(preview.activeEffect?.effectText).toContain('[BLADE]合计9');
    const resolved = confirmActiveEffectStep(preview, PLAYER1, preview.activeEffect!.id);
    expect(dreamWithYouScoreModifiers(resolved)).toHaveLength(0);
  });

  it('recomputes Dream with You from nine to ten effective BLADE on confirmation', () => {
    const scenario = setupDreamWithYouScenario({ blades: [3, 3, 3] });
    const preview = runLiveStart(scenario.game);
    expect(preview.activeEffect?.effectText).toContain('[BLADE]合计9');
    const changed = addLiveModifier(preview, {
      kind: 'BLADE',
      playerId: PLAYER1,
      countDelta: 1,
      sourceCardId: scenario.members[0]!.instanceId,
      abilityId: 'test:dream-with-you-late-blade',
    });

    const resolved = confirmActiveEffectStep(changed, PLAYER1, changed.activeEffect!.id);
    expect(dreamWithYouScoreModifiers(resolved)).toHaveLength(1);
    expect(resolved.liveResolution.playerScores.get(PLAYER1)).toBe(5);
    expect(
      resolved.actionHistory.find(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId === N_SD1_028_LIVE_START_STAGE_BLADE_TEN_GAIN_SCORE_ABILITY_ID
      )?.payload
    ).toMatchObject({ stageBladeTotal: 10, conditionMet: true, scoreBonus: 1, scoreDelta: 1 });
  });

  it('recomputes Dream with You from ten to nine on confirmation and clears stale SCORE state by delta', () => {
    const scenario = setupDreamWithYouScenario({ blades: [3, 3, 3] });
    let game = addLiveModifier(scenario.game, {
      kind: 'BLADE',
      playerId: PLAYER1,
      countDelta: 1,
      sourceCardId: scenario.members[0]!.instanceId,
      abilityId: 'test:dream-with-you-removable-blade',
    });
    game = addLiveModifier(game, {
      kind: 'SCORE',
      playerId: PLAYER1,
      countDelta: 1,
      liveCardId: scenario.lives[0]!.instanceId,
      sourceCardId: scenario.lives[0]!.instanceId,
      abilityId: N_SD1_028_LIVE_START_STAGE_BLADE_TEN_GAIN_SCORE_ABILITY_ID,
    });
    game = {
      ...game,
      liveResolution: {
        ...game.liveResolution,
        playerScores: new Map([[PLAYER1, 5]]),
      },
    };
    const preview = runLiveStart(game);
    expect(preview.activeEffect?.effectText).toContain('[BLADE]合计10');
    const changed = {
      ...preview,
      liveResolution: {
        ...preview.liveResolution,
        liveModifiers: preview.liveResolution.liveModifiers.filter(
          (modifier) => modifier.abilityId !== 'test:dream-with-you-removable-blade'
        ),
      },
    };

    const resolved = confirmActiveEffectStep(changed, PLAYER1, changed.activeEffect!.id);
    expect(dreamWithYouScoreModifiers(resolved)).toHaveLength(0);
    expect(resolved.liveResolution.playerScores.get(PLAYER1)).toBe(4);
    expect(
      resolved.actionHistory.find(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId === N_SD1_028_LIVE_START_STAGE_BLADE_TEN_GAIN_SCORE_ABILITY_ID
      )?.payload
    ).toMatchObject({ stageBladeTotal: 9, conditionMet: false, scoreBonus: 0, scoreDelta: -1 });
  });

  it('consumes Dream with You pending without SCORE when the source leaves its controller LIVE zone', () => {
    const scenario = setupDreamWithYouScenario({ blades: [4, 3, 3] });
    const preview = runLiveStart(scenario.game);
    const sourceRemoved = updatePlayer(preview, PLAYER1, (player) => ({
      ...player,
      liveZone: removeCardFromStatefulZone(player.liveZone, scenario.lives[0]!.instanceId),
    }));
    const resolved = confirmActiveEffectStep(
      sourceRemoved,
      PLAYER1,
      sourceRemoved.activeEffect!.id
    );

    expect(dreamWithYouScoreModifiers(resolved)).toHaveLength(0);
    expect(resolved.pendingAbilities).toEqual([]);
    expect(resolved.liveResolution.playerScores.get(PLAYER1)).toBe(4);
    expect(
      resolved.actionHistory.find(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId === N_SD1_028_LIVE_START_STAGE_BLADE_TEN_GAIN_SCORE_ABILITY_ID
      )?.payload
    ).toMatchObject({ sourceInLiveZone: false, conditionMet: false, scoreBonus: 0, scoreDelta: 0 });
  });

  it('re-resolves Dream with You idempotently and subtracts only the prior draft bonus after the condition later fails', () => {
    const scenario = setupDreamWithYouScenario({ blades: [4, 3, 3] });
    const firstPreview = runLiveStart(scenario.game);
    const first = confirmActiveEffectStep(firstPreview, PLAYER1, firstPreview.activeEffect!.id);
    expect(first.liveResolution.playerScores.get(PLAYER1)).toBe(5);

    const replayPreview = resolvePendingCardEffects({
      ...first,
      pendingAbilities: [createDreamWithYouPending(scenario.lives[0]!.instanceId, 1)],
    }).gameState;
    const replayed = confirmActiveEffectStep(
      replayPreview,
      PLAYER1,
      replayPreview.activeEffect!.id
    );
    expect(dreamWithYouScoreModifiers(replayed)).toHaveLength(1);
    expect(replayed.liveResolution.playerScores.get(PLAYER1)).toBe(5);

    const conditionFailed = updatePlayer(replayed, PLAYER1, (player) => ({
      ...player,
      memberSlots: removeCardFromSlot(player.memberSlots, SlotPosition.LEFT),
    }));
    const failedPreview = resolvePendingCardEffects({
      ...conditionFailed,
      pendingAbilities: [createDreamWithYouPending(scenario.lives[0]!.instanceId, 2)],
    }).gameState;
    const failed = confirmActiveEffectStep(
      failedPreview,
      PLAYER1,
      failedPreview.activeEffect!.id
    );
    expect(dreamWithYouScoreModifiers(failed)).toHaveLength(0);
    expect(failed.liveResolution.playerScores.get(PLAYER1)).toBe(4);
    const dreamActions = failed.actionHistory.filter(
      (action) =>
        action.type === 'RESOLVE_ABILITY' &&
        action.payload.abilityId === N_SD1_028_LIVE_START_STAGE_BLADE_TEN_GAIN_SCORE_ABILITY_ID
    );
    expect(dreamActions.at(-2)?.payload).toMatchObject({ scoreBonus: 1, scoreDelta: 0 });
    expect(dreamActions.at(-1)?.payload).toMatchObject({ scoreBonus: 0, scoreDelta: -1 });
  });

  it('auto-resolves an ordered Dream with You batch and confirms a manually selected pending first', () => {
    const orderedScenario = setupDreamWithYouScenario({ blades: [4, 3, 3], sourceCount: 2 });
    const orderSelection = runLiveStart(orderedScenario.game);
    expect(orderSelection.activeEffect?.canResolveInOrder).toBe(true);
    const ordered = confirmActiveEffectStep(
      orderSelection,
      PLAYER1,
      orderSelection.activeEffect!.id,
      undefined,
      undefined,
      true
    );
    expect(ordered.activeEffect).toBeNull();
    expect(ordered.pendingAbilities).toEqual([]);
    expect(dreamWithYouScoreModifiers(ordered)).toHaveLength(2);
    expect(ordered.liveResolution.playerScores.get(PLAYER1)).toBe(10);

    const manualScenario = setupDreamWithYouScenario({ blades: [4, 3, 3], sourceCount: 2 });
    const manualOrderSelection = runLiveStart(manualScenario.game);
    const preview = confirmActiveEffectStep(
      manualOrderSelection,
      PLAYER1,
      manualOrderSelection.activeEffect!.id,
      manualScenario.lives[1]!.instanceId
    );
    expect(preview.activeEffect).toMatchObject({
      abilityId: N_SD1_028_LIVE_START_STAGE_BLADE_TEN_GAIN_SCORE_ABILITY_ID,
      sourceCardId: manualScenario.lives[1]!.instanceId,
      metadata: { confirmOnlyPendingAbility: true },
    });
    expect(dreamWithYouScoreModifiers(preview)).toHaveLength(0);
    const confirmed = confirmActiveEffectStep(preview, PLAYER1, preview.activeEffect!.id);
    expect(dreamWithYouScoreModifiers(confirmed)).toHaveLength(1);
    expect(confirmed.liveResolution.playerScores.get(PLAYER1)).toBe(9);
  });

  it('keeps the resolved Dream with You SCORE bonus after a later CHEER_COUNT reduction (FAQ Q116)', () => {
    const scenario = setupDreamWithYouScenario({ blades: [4, 3, 3] });
    const preview = runLiveStart(scenario.game);
    const resolved = confirmActiveEffectStep(preview, PLAYER1, preview.activeEffect!.id);
    const afterCheerCountReduction = addLiveModifier(resolved, {
      kind: 'CHEER_COUNT',
      playerId: PLAYER1,
      countDelta: -1,
      sourceCardId: 'test:q116-cheer-count-source',
      abilityId: 'test:q116-cheer-count-reduction',
    });

    expect(dreamWithYouScoreModifiers(afterCheerCountReduction)).toHaveLength(1);
    expect(afterCheerCountReduction.liveResolution.playerScores.get(PLAYER1)).toBe(5);
    expect(
      getEffectivePerformanceCheerCount(
        afterCheerCountReduction,
        PLAYER1,
        10,
        collectLiveModifiers(afterCheerCountReduction)
      )
    ).toBe(9);
    expect(
      afterCheerCountReduction.liveResolution.liveModifiers.some(
        (modifier) =>
          modifier.kind === 'CHEER_COUNT' &&
          modifier.abilityId === 'test:q116-cheer-count-reduction' &&
          modifier.countDelta === -1
      )
    ).toBe(true);
  });

  it.each([
    { blade: 8, conditionText: '未满足条件', scoreBonus: 0, expectedScore: 7 },
    { blade: 9, conditionText: '满足条件', scoreBonus: 2, expectedScore: 9 },
  ])(
    'confirms PL!-bp4-022 at effective BLADE $blade and applies SCORE +$scoreBonus',
    ({ blade, conditionText, scoreBonus, expectedScore }) => {
      const scenario = setupNoBrandGirlsState({ centerBlade: blade });
      const preview = runLiveStart(scenario.game);

      expect(preview.activeEffect).toMatchObject({
        abilityId: PL_BP4_022_LIVE_START_CENTER_MUSE_BLADE_NINE_SCORE_TWO_ABILITY_ID,
        sourceCardId: scenario.lives[0]!.instanceId,
        metadata: { confirmOnlyPendingAbility: true },
      });
      expect(preview.pendingAbilities).toHaveLength(1);
      expect(preview.activeEffect?.effectText).toContain("当前中央区域为『μ's』成员");
      expect(preview.activeEffect?.effectText).toContain(`有效[ブレード]${blade}`);
      expect(preview.activeEffect?.effectText).toContain(conditionText);
      expect(preview.activeEffect?.effectText).toContain(`实际[スコア]+${scoreBonus}`);
      expect(preview.activeEffect?.stepText).toBe(preview.activeEffect?.effectText);
      expect(preview.activeEffect?.effectText).not.toMatch(
        /source|pending|stale|payload|trigger|来源|LIVE区/
      );
      expect(noBrandGirlsScoreModifiers(preview)).toHaveLength(0);
      expect(preview.liveResolution.playerScores.get(PLAYER1)).toBe(7);

      const resolved = confirmActiveEffectStep(preview, PLAYER1, preview.activeEffect!.id);
      expect(resolved.liveResolution.playerScores.get(PLAYER1)).toBe(expectedScore);
      expect(noBrandGirlsScoreModifiers(resolved)).toHaveLength(scoreBonus > 0 ? 1 : 0);
      if (scoreBonus > 0) {
        expect(noBrandGirlsScoreModifiers(resolved)[0]).toMatchObject({
          kind: 'SCORE',
          playerId: PLAYER1,
          countDelta: 2,
          liveCardId: scenario.lives[0]!.instanceId,
          sourceCardId: scenario.lives[0]!.instanceId,
        });
      }
    }
  );

  it('counts printed BLADE plus a temporary member modifier when PL!-bp4-022 reaches nine', () => {
    const scenario = setupNoBrandGirlsState({ centerBlade: 8, bladeModifier: 1 });
    const preview = runLiveStart(scenario.game);
    expect(preview.activeEffect?.effectText).toContain('有效[ブレード]9');
    expect(preview.activeEffect?.effectText).toContain('满足条件，实际[スコア]+2');

    const resolved = confirmActiveEffectStep(preview, PLAYER1, preview.activeEffect!.id);
    expect(resolved.liveResolution.playerScores.get(PLAYER1)).toBe(9);
    expect(noBrandGirlsScoreModifiers(resolved)).toHaveLength(1);
  });

  it('uses the current original-BLADE replacement when PL!-bp4-022 evaluates its center member', () => {
    const scenario = setupNoBrandGirlsState({ centerBlade: 3 });
    const replaced = addLiveModifier(scenario.game, {
      kind: 'MEMBER_ORIGINAL_BLADE_REPLACEMENT',
      playerId: PLAYER1,
      memberCardId: scenario.center.instanceId,
      count: 9,
      sourceCardId: scenario.center.instanceId,
      abilityId: 'test:no-brand-girls-original-blade-replacement',
    });
    const preview = runLiveStart(replaced);
    expect(preview.activeEffect?.effectText).toContain('有效[ブレード]9');
    const resolved = confirmActiveEffectStep(preview, PLAYER1, preview.activeEffect!.id);
    expect(noBrandGirlsScoreModifiers(resolved)).toHaveLength(1);
    expect(resolved.liveResolution.playerScores.get(PLAYER1)).toBe(9);
  });

  it.each([
    { centerKind: 'non-muse' as const, expectedText: "当前中央区域成员不是『μ's』成员", blade: 12 },
    { centerKind: 'empty' as const, expectedText: "当前中央区域没有『μ's』成员", blade: 0 },
  ])(
    'does not apply PL!-bp4-022 when center is $centerKind',
    ({ centerKind, expectedText, blade }) => {
      const scenario = setupNoBrandGirlsState({ centerKind, centerBlade: 12 });
      const preview = runLiveStart(scenario.game);
      expect(preview.activeEffect?.effectText).toContain(expectedText);
      expect(preview.activeEffect?.effectText).toContain(`有效[ブレード]${blade}`);
      expect(preview.activeEffect?.effectText).toContain('未满足条件，实际[スコア]+0');
      const resolved = confirmActiveEffectStep(preview, PLAYER1, preview.activeEffect!.id);
      expect(noBrandGirlsScoreModifiers(resolved)).toHaveLength(0);
      expect(resolved.liveResolution.playerScores.get(PLAYER1)).toBe(7);
    }
  );

  it('recomputes PL!-bp4-022 at confirmation after effective BLADE changes', () => {
    const scenario = setupNoBrandGirlsState({ centerBlade: 8 });
    const preview = runLiveStart(scenario.game);
    expect(preview.activeEffect?.effectText).toContain('有效[ブレード]8');
    const changed = addLiveModifier(preview, {
      kind: 'BLADE',
      playerId: PLAYER1,
      countDelta: 1,
      sourceCardId: scenario.center.instanceId,
      abilityId: 'test:no-brand-girls-late-blade',
    });
    const resolved = confirmActiveEffectStep(changed, PLAYER1, changed.activeEffect!.id);
    expect(noBrandGirlsScoreModifiers(resolved)).toHaveLength(1);
    expect(resolved.liveResolution.playerScores.get(PLAYER1)).toBe(9);
    expect(
      resolved.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId ===
            PL_BP4_022_LIVE_START_CENTER_MUSE_BLADE_NINE_SCORE_TWO_ABILITY_ID &&
          action.payload.centerMemberEffectiveBladeCount === 9 &&
          action.payload.scoreBonus === 2
      )
    ).toBe(true);
  });

  it('does not apply PL!-bp4-022 after its source leaves the controller LIVE zone', () => {
    const scenario = setupNoBrandGirlsState({ centerBlade: 9 });
    const preview = runLiveStart(scenario.game);
    const sourceRemoved = updatePlayer(preview, PLAYER1, (player) => ({
      ...player,
      liveZone: removeCardFromStatefulZone(player.liveZone, scenario.lives[0]!.instanceId),
    }));
    const resolved = confirmActiveEffectStep(
      sourceRemoved,
      PLAYER1,
      sourceRemoved.activeEffect!.id
    );
    expect(noBrandGirlsScoreModifiers(resolved)).toHaveLength(0);
    expect(resolved.liveResolution.playerScores.get(PLAYER1)).toBe(7);
    expect(
      resolved.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId ===
            PL_BP4_022_LIVE_START_CENTER_MUSE_BLADE_NINE_SCORE_TWO_ABILITY_ID &&
          action.payload.sourceInLiveZone === false &&
          action.payload.conditionMet === true &&
          action.payload.scoreBonus === 0
      )
    ).toBe(true);
  });

  it('replaces the PL!-bp4-022 SCORE modifier once and refreshes playerScores only by delta', () => {
    const scenario = setupNoBrandGirlsState({ centerBlade: 9 });
    const firstPreview = runLiveStart(scenario.game);
    const first = confirmActiveEffectStep(firstPreview, PLAYER1, firstPreview.activeEffect!.id);
    expect(first.liveResolution.playerScores.get(PLAYER1)).toBe(9);
    expect(noBrandGirlsScoreModifiers(first)).toHaveLength(1);

    const replayPreview = resolvePendingCardEffects({
      ...first,
      pendingAbilities: [createNoBrandGirlsPending(scenario.lives[0]!.instanceId, 1)],
    }).gameState;
    const replayed = confirmActiveEffectStep(
      replayPreview,
      PLAYER1,
      replayPreview.activeEffect!.id
    );
    expect(replayed.liveResolution.playerScores.get(PLAYER1)).toBe(9);
    expect(noBrandGirlsScoreModifiers(replayed)).toHaveLength(1);
    expect(replayed.actionHistory.at(-1)?.payload).toMatchObject({ scoreBonus: 2, scoreDelta: 0 });
  });

  it('removes stale PL!-bp4-022 SCORE state and subtracts its previous draft bonus when the condition fails', () => {
    const scenario = setupNoBrandGirlsState({ centerBlade: 8, playerScore: 9 });
    const withStaleModifier = addLiveModifier(scenario.game, {
      kind: 'SCORE',
      playerId: PLAYER1,
      countDelta: 2,
      liveCardId: scenario.lives[0]!.instanceId,
      sourceCardId: scenario.lives[0]!.instanceId,
      abilityId: PL_BP4_022_LIVE_START_CENTER_MUSE_BLADE_NINE_SCORE_TWO_ABILITY_ID,
    });
    const preview = runLiveStart(withStaleModifier);
    const resolved = confirmActiveEffectStep(preview, PLAYER1, preview.activeEffect!.id);
    expect(noBrandGirlsScoreModifiers(resolved)).toHaveLength(0);
    expect(resolved.liveResolution.playerScores.get(PLAYER1)).toBe(7);
    expect(resolved.actionHistory.at(-1)?.payload).toMatchObject({
      conditionMet: false,
      scoreBonus: 0,
      scoreDelta: -2,
    });
  });

  it('auto-resolves an ordered PL!-bp4-022 batch and confirms a manually selected pending first', () => {
    const orderedScenario = setupNoBrandGirlsState({ sourceCount: 2, centerBlade: 9 });
    const orderSelection = runLiveStart(orderedScenario.game);
    expect(orderSelection.activeEffect?.canResolveInOrder).toBe(true);
    const ordered = confirmActiveEffectStep(
      orderSelection,
      PLAYER1,
      orderSelection.activeEffect!.id,
      undefined,
      undefined,
      true
    );
    expect(ordered.activeEffect).toBeNull();
    expect(ordered.pendingAbilities).toEqual([]);
    expect(noBrandGirlsScoreModifiers(ordered)).toHaveLength(2);
    expect(ordered.liveResolution.playerScores.get(PLAYER1)).toBe(18);

    const manualScenario = setupNoBrandGirlsState({ sourceCount: 2, centerBlade: 9 });
    const manualOrderSelection = runLiveStart(manualScenario.game);
    const preview = confirmActiveEffectStep(
      manualOrderSelection,
      PLAYER1,
      manualOrderSelection.activeEffect!.id,
      manualScenario.lives[1]!.instanceId
    );
    expect(preview.activeEffect).toMatchObject({
      abilityId: PL_BP4_022_LIVE_START_CENTER_MUSE_BLADE_NINE_SCORE_TWO_ABILITY_ID,
      sourceCardId: manualScenario.lives[1]!.instanceId,
      metadata: { confirmOnlyPendingAbility: true },
    });
    expect(noBrandGirlsScoreModifiers(preview)).toHaveLength(0);
    const confirmed = confirmActiveEffectStep(preview, PLAYER1, preview.activeEffect!.id);
    expect(noBrandGirlsScoreModifiers(confirmed)).toHaveLength(1);
    expect(confirmed.liveResolution.playerScores.get(PLAYER1)).toBe(16);
  });

  it('confirms and applies PL!N-bp3-005 player SCORE from current member-entry events', () => {
    const ai = createCardInstance(
      createMember({ cardCode: 'PL!N-bp3-005-P', name: '宮下 愛', cost: 15 }),
      PLAYER1,
      'ai'
    );
    let game = registerCards(
      createGameState('n-bp3-005-live-start', PLAYER1, 'P1', PLAYER2, 'P2'),
      [ai]
    );
    game = updatePlayer(game, PLAYER1, (player) => ({
      ...player,
      memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, ai.instanceId),
    }));
    game = emitGameEvent(
      game,
      createEnterStageEvent('first', ZoneType.HAND, SlotPosition.LEFT, PLAYER1, PLAYER1)
    );
    game = emitGameEvent(
      game,
      createEnterStageEvent('second', ZoneType.WAITING_ROOM, SlotPosition.RIGHT, PLAYER1, PLAYER1)
    );
    const pending: PendingAbilityState = {
      id: 'ai-live-start',
      abilityId: PL_N_BP3_005_LIVE_START_TWO_MEMBER_ENTRIES_GAIN_SCORE_ABILITY_ID,
      sourceCardId: ai.instanceId,
      controllerId: PLAYER1,
      mandatory: true,
      timingId: TriggerCondition.ON_LIVE_START,
      eventIds: ['live-start'],
    };
    game = { ...game, pendingAbilities: [pending] };
    const preview = resolvePendingCardEffects(game).gameState;
    expect(preview.liveResolution.playerScores.get(PLAYER1) ?? 0).toBe(0);
    expect(preview.activeEffect?.effectText).toContain('已登场2次，满足条件');
    const resolved = confirmActiveEffectStep(preview, PLAYER1, preview.activeEffect!.id);
    expect(resolved.liveResolution.playerScores.get(PLAYER1)).toBe(1);
    expect(resolved.liveResolution.liveModifiers).toContainEqual(
      expect.objectContaining({
        kind: 'SCORE',
        playerId: PLAYER1,
        sourceCardId: ai.instanceId,
        abilityId: PL_N_BP3_005_LIVE_START_TWO_MEMBER_ENTRIES_GAIN_SCORE_ABILITY_ID,
        countDelta: 1,
      })
    );
    expect(resolved.liveResolution.liveModifiers.at(-1)?.liveCardId).toBeUndefined();
  });

  it.each([
    [['涩谷香音', '唐可可', '岚千砂都', '平安名堇'], 4, false],
    [['涩谷香音', '唐可可', '岚千砂都', '平安名堇', '叶月恋'], 5, true],
    [['涩谷香音', '唐可可', '岚千砂都', '平安名堇', '唐可可'], 4, false],
    [['涩谷香音', '唐可可', '岚千砂都', '平安名堇', '唐可可＆叶月恋'], 5, true],
  ])(
    'PL!SP-bp1-026 recomputes %s as %i different Liella names',
    (names, expectedCount, expectedMet) => {
      const scenario = setupSpBp1026Pending({
        names,
        preserveOtherRequirementModifier: true,
      });
      const preview = resolvePendingCardEffects(scenario.game).gameState;
      expect(preview.activeEffect?.effectText).toBe(
        `【LIVE开始时】自己的舞台与休息室存在大于等于5人名称互不相同的『Liella!』的成员的场合，使用此卡所需的费用变为[赤ハート][赤ハート][黄ハート][黄ハート][紫ハート][紫ハート]。（当前不同名『Liella!』成员${expectedCount}名，${
          expectedMet ? '满足条件，实际减少2个[無ハート]' : '未满足条件，实际不减少[無ハート]'
        }）`
      );
      expect(
        preview.liveResolution.liveModifiers.some(
          (modifier) =>
            modifier.kind === 'REQUIREMENT' &&
            modifier.abilityId ===
              SP_BP1_026_LIVE_START_DIFFERENT_LIELLA_REPLACE_REQUIREMENT_ABILITY_ID
        )
      ).toBe(false);
      const resolved = confirmActiveEffectStep(preview, PLAYER1, preview.activeEffect!.id);
      expect(
        resolved.liveResolution.liveModifiers.filter(
          (modifier) =>
            modifier.kind === 'REQUIREMENT' &&
            modifier.abilityId ===
              SP_BP1_026_LIVE_START_DIFFERENT_LIELLA_REPLACE_REQUIREMENT_ABILITY_ID
        )
      ).toEqual(
        expectedMet
          ? [
              expect.objectContaining({
                liveCardId: scenario.lives[0]!.instanceId,
                modifiers: [{ color: HeartColor.RAINBOW, countDelta: -2 }],
              }),
            ]
          : []
      );
      expect(resolved.liveResolution.liveModifiers).toContainEqual(
        expect.objectContaining({ abilityId: 'other-requirement-ability' })
      );
    }
  );

  it('PL!SP-bp1-026 excludes non-Liella, opponent and memberBelow cards and safely no-ops when stale', () => {
    const scenario = setupSpBp1026Pending({
      names: ['涩谷香音', '唐可可', '岚千砂都', '平安名堇'],
    });
    const nonLiella = createCardInstance(
      createMember({ cardCode: 'non-liella', name: '叶月恋', cost: 1, groupNames: ['Aqours'] }),
      PLAYER1,
      'non-liella'
    );
    const opponentLiella = createCardInstance(
      createMember({
        cardCode: 'opponent-liella',
        name: '叶月恋',
        cost: 1,
        groupNames: ['Liella!'],
      }),
      PLAYER2,
      'opponent-liella'
    );
    const belowLiella = createCardInstance(
      createMember({ cardCode: 'below-liella', name: '叶月恋', cost: 1, groupNames: ['Liella!'] }),
      PLAYER1,
      'below-liella'
    );
    let game = registerCards(scenario.game, [nonLiella, opponentLiella, belowLiella]);
    game = updatePlayer(game, PLAYER1, (player) => ({
      ...player,
      waitingRoom: addCardToZone(player.waitingRoom, nonLiella.instanceId),
      memberSlots: addMemberBelowMember(
        player.memberSlots,
        SlotPosition.CENTER,
        belowLiella.instanceId
      ),
    }));
    game = updatePlayer(game, PLAYER2, (player) => ({
      ...player,
      waitingRoom: addCardToZone(player.waitingRoom, opponentLiella.instanceId),
    }));
    const preview = resolvePendingCardEffects(game).gameState;
    expect(preview.activeEffect?.effectText).toContain('成员4名，未满足条件');
    const stale = updatePlayer(preview, PLAYER1, (player) => ({
      ...player,
      liveZone: removeCardFromStatefulZone(player.liveZone, scenario.lives[0]!.instanceId),
    }));
    const resolved = confirmActiveEffectStep(stale, PLAYER1, stale.activeEffect!.id);
    expect(
      resolved.liveResolution.liveModifiers.some(
        (modifier) =>
          modifier.kind === 'REQUIREMENT' &&
          modifier.abilityId ===
            SP_BP1_026_LIVE_START_DIFFERENT_LIELLA_REPLACE_REQUIREMENT_ABILITY_ID
      )
    ).toBe(false);
  });

  it('PL!SP-bp1-026 auto-resolves an ordered batch and bridges a manually selected pending', () => {
    const scenario = setupSpBp1026Pending({
      names: ['涩谷香音', '唐可可', '岚千砂都', '平安名堇', '叶月恋'],
      sourceCount: 2,
    });
    const orderSelection = resolvePendingCardEffects(
      addCheckTimingRuleSentinel(scenario.game, PLAYER1, 'sp-bp1-026-ordered')
    ).gameState;
    expect(orderSelection.activeEffect?.canResolveInOrder).toBe(true);
    const ordered = confirmActiveEffectStep(
      orderSelection,
      PLAYER1,
      orderSelection.activeEffect!.id,
      undefined,
      undefined,
      true
    );
    expect(ordered.activeEffect).toBeNull();
    expect(
      ordered.liveResolution.liveModifiers.filter(
        (modifier) =>
          modifier.kind === 'REQUIREMENT' &&
          modifier.abilityId ===
            SP_BP1_026_LIVE_START_DIFFERENT_LIELLA_REPLACE_REQUIREMENT_ABILITY_ID
      )
    ).toHaveLength(2);

    const manual = confirmActiveEffectStep(
      orderSelection,
      PLAYER1,
      orderSelection.activeEffect!.id,
      scenario.lives[1]!.instanceId
    );
    expect(manual.activeEffect).toMatchObject({
      abilityId: SP_BP1_026_LIVE_START_DIFFERENT_LIELLA_REPLACE_REQUIREMENT_ABILITY_ID,
      sourceCardId: scenario.lives[1]!.instanceId,
      metadata: { confirmOnlyPendingAbility: true },
    });
    expect(
      manual.liveResolution.liveModifiers.some(
        (modifier) =>
          modifier.kind === 'REQUIREMENT' &&
          modifier.abilityId ===
            SP_BP1_026_LIVE_START_DIFFERENT_LIELLA_REPLACE_REQUIREMENT_ABILITY_ID
      )
    ).toBe(false);
  });
});
