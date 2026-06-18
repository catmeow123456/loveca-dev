import { describe, expect, it } from 'vitest';
import {
  BladeHeartEffect,
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
  emitGameEvent,
  registerCards,
  updatePlayer,
  type GameState,
} from '../../src/domain/entities/game';
import { createCheerEvent, createLiveSuccessEvent } from '../../src/domain/events/game-events';
import {
  addLiveModifier,
  getMemberEffectiveBladeCount,
} from '../../src/domain/rules/live-modifiers';
import { GameService, type DeckConfig } from '../../src/application/game-service';
import { createTapMemberAction } from '../../src/application/actions';
import {
  createActivateAbilityCommand,
  createConfirmEffectStepCommand,
  createConfirmStepCommand,
  createMoveMemberToSlotCommand,
  createMoveResolutionCardToZoneCommand,
  createMovePublicCardToWaitingRoomCommand,
  createPlayMemberToSlotCommand,
  createRevealCheerCardCommand,
  createSelectSuccessLiveCommand,
  createSubmitJudgmentCommand,
  createTapMemberCommand,
} from '../../src/application/game-commands';
import { createGameSession } from '../../src/application/game-session';
import {
  ABILITY_ORDER_SELECTION_ID,
  BOKUIMA_LIVE_START_REQUIREMENT_ABILITY_ID,
  BP4_002_ACTIVATED_DISCARD_RECOVER_MUSE_LIVE_ABILITY_ID,
  BP4_021_LIVE_START_SUCCESS_SCORE_REQUIREMENT_AND_SCORE_ABILITY_ID,
  BP4_010_LIVE_START_PAY_ENERGY_GAIN_BLADE_ABILITY_ID,
  BP5_003_ACTIVATED_ENERGY_DISCARD_BRANCH_ABILITY_ID,
  BP5_005_ON_ENTER_SUCCESS_SCORE_PLACE_ACTIVE_ENERGY_ABILITY_ID,
  BP6_002_ON_ENTER_LOOK_NO_ABILITY_OR_CONTINUOUS_MUSE_CARD_ABILITY_ID,
  BP6_005_ON_ENTER_DISCARD_TWO_RECOVER_YELLOW_HEART_CARDS_ABILITY_ID,
  BP6_024_CONTINUOUS_SUCCESS_ZONE_REPLACEMENT_ABILITY_ID,
  CHISATO_LIVE_START_ACTIVATE_LIELLA_AND_ENERGY_ABILITY_ID,
  EMMA_ON_ENTER_ACTIVATE_MEMBER_OR_ENERGY_ABILITY_ID,
  ELI_ACTIVATED_ABILITY_ID,
  GENERIC_DISCARD_LOOK_TOP_ABILITY_ID,
  LL_BP1_001_ON_ENTER_RECOVER_MEMBER_ABILITY_ID,
  BP3_010_ON_ENTER_LOOK_LIVE_EFFECT_ID,
  HS_BP1_004_ACTIVATED_RECOVER_HASUNOSORA_LIVE_ABILITY_ID,
  HS_BP1_002_ACTIVATED_PLAY_HASUNOSORA_MEMBER_TO_SOURCE_SLOT_ABILITY_ID,
  HS_BP1_003_ACTIVATED_RECOVER_LOW_COST_HASUNOSORA_MEMBER_ABILITY_ID,
  PL_BP3_014_ON_ENTER_LOOK_TOP_TWO_ARRANGE_TO_TOP_ABILITY_ID,
  HS_BP1_004_LIVE_START_PAY_ENERGY_GAIN_BLADE_ABILITY_ID,
  HS_BP2_002_ON_ENTER_RECOVER_LOW_COST_MEMBER_ABILITY_ID,
  HS_BP2_022_LIVE_START_SCORE_ABILITY_ID,
  HS_BP5_001_ACTIVATED_REVEAL_HAND_LIVE_RECOVER_SAME_NAME_LIVE_ABILITY_ID,
  HS_BP5_008_ON_ENTER_WAIT_DISCARD_LOOK_TOP_ABILITY_ID,
  HS_BP5_001_ON_ENTER_MILL_GAIN_BLADE_ABILITY_ID,
  HS_BP5_003_LEAVE_STAGE_POSITION_CHANGE_ABILITY_ID,
  HS_BP5_003_LIVE_START_DISCARD_SAME_GROUP_MEMBER_HEART_ABILITY_ID,
  HS_BP6_001_LIVE_SUCCESS_CHEER_TO_TOP_ABILITY_ID,
  HS_BP6_001_ON_ENTER_LOOK_STAGE_PLUS_TWO_ABILITY_ID,
  HS_BP6_027_ON_CHEER_ADDITIONAL_CHEER_ABILITY_ID,
  HS_BP6_031_LIVE_START_RECYCLE_MIRACRA_MEMBERS_GAIN_BLADE_ABILITY_ID,
  HS_PB1_012_ON_ENTER_RECYCLE_MEMBERS_RECOVER_LIVE_GAIN_BLADE_ABILITY_ID,
  HANAYO_ACTIVATED_ABILITY_ID,
  BP4_003_ACTIVATED_ABILITY_ID,
  HONOKA_ON_ENTER_ABILITY_ID,
  HS_BP1_006_ON_ENTER_DRAW_DISCARD_ABILITY_ID,
  HS_BP1_006_ON_ENTER_DRAW_ONE_DISCARD_ONE_ABILITY_ID,
  HS_BP1_006_LIVE_START_DISCARD_GAIN_HEART_ABILITY_ID,
  HS_PR_001_LIVE_START_PAY_TWO_ENERGY_GAIN_BLADE_ABILITY_ID,
  HS_BP5_019_LIVE_START_REQUIREMENT_ABILITY_ID,
  HS_BP6_004_LIVE_START_DISCARD_GAIN_BLADE_ABILITY_ID,
  HS_BP6_004_LIVE_START_WAIT_OPPONENT_LOW_COST_MEMBER_ABILITY_ID,
  HS_BP6_004_ON_ENTER_WAIT_OPPONENT_LOW_COST_MEMBER_ABILITY_ID,
  KARIN_LIVE_START_ABILITY_ID,
  KEKE_ON_ENTER_PLACE_WAITING_ENERGY_ABILITY_ID,
  LL_BP1_001_LIVE_START_DISCARD_SCORE_ABILITY_ID,
  LL_BP2_001_LIVE_START_DISCARD_BLADE_ABILITY_ID,
  MAKI_ON_ENTER_ABILITY_ID,
  N_BP4_018_MAIN_PHASE_ACTIVE_TO_WAITING_DRAW_DISCARD_ABILITY_ID,
  HS_BP2_012_LEAVE_STAGE_LOOK_TOP_MEMBER_ABILITY_ID,
  HS_BP6_017_LEAVE_STAGE_RECOVER_LIVE_AND_MEMBER_ABILITY_ID,
  HS_PB1_020_ON_ENTER_DISCARD_TWO_RECOVER_CERISE_MEMBER_AND_HASUNOSORA_LIVE_ABILITY_ID,
  HS_PB1_009_LIVE_START_DRAW_DISCARD_ABILITY_ID,
  HS_PB1_009_ON_HASUNOSORA_ENTER_GAIN_BLADE_ABILITY_ID,
  HS_PB1_004_ON_ENTER_PAY_ENERGY_DISCARD_MILL_RECOVER_CERISE_LIVE_ABILITY_ID,
  HS_CL1_009_LIVE_SUCCESS_CHEER_MEMBER_TO_HAND_ABILITY_ID,
  HS_PR_019_ON_ENTER_MILL_GAIN_GREEN_HEART_ABILITY_ID,
  HS_SD1_006_LIVE_START_PAY_ENERGY_GAIN_BLADE_ABILITY_ID,
  HS_SD1_006_ON_ENTER_ACTIVATE_ENERGY_RECOVER_LIVE_ABILITY_ID,
  HS_SD1_001_RELAY_REPLACED_ACTIVATE_ENERGY_ABILITY_ID,
  enqueueTriggeredCardEffects,
  KOTORI_ON_ENTER_ABILITY_ID,
  KOTORI_LIVE_START_HEART_ABILITY_ID,
  PB1_015_OWN_EFFECT_WAIT_OPPONENT_LOW_COST_DRAW_ABILITY_ID,
  PB1_019_ACTIVATED_ABILITY_ID,
  NICO_LIVE_START_SCORE_ABILITY_ID,
  NOZOMI_ON_ENTER_ABILITY_ID,
  PR_018_ON_ENTER_RECOVER_HIGH_SCORE_LIVE_ABILITY_ID,
  PR_017_ACTIVATED_RECOVER_MUSE_LIVE_ACTIVATE_ENERGY_ABILITY_ID,
  RIN_ACTIVATED_ABILITY_ID,
  SHIKI_LIVE_START_POSITION_CHANGE_ABILITY_ID,
  SHIKI_ON_ENTER_LEFT_DRAW_DISCARD_ABILITY_ID,
  SHIKI_ON_ENTER_RIGHT_ACTIVATE_ENERGY_ABILITY_ID,
  SP_BP4_011_ENTER_OR_MOVE_WAIT_OPPONENT_LOW_BLADE_MEMBER_ABILITY_ID,
  SP_BP2_002_ON_ENTER_LOOK_HIGH_COST_CARD_ABILITY_ID,
  START_DASH_LIVE_SUCCESS_ABILITY_ID,
  UMI_ON_ENTER_ABILITY_ID,
  YOSHIKO_ON_ENTER_PLAY_LOW_COST_MEMBERS_ABILITY_ID,
  BP5_007_ON_ENTER_RELAY_LOW_COST_HAND_ADJUST_DRAW_ABILITY_ID,
} from '../../src/application/card-effect-runner';

const PLAYER1 = 'player1';
const PLAYER2 = 'player2';

const RIN_LIKE_MEMBER_ACTIVATION_TEST_CASES = [
  { cardCode: 'PL!-sd1-005-SD', name: '星空 凛' },
  { cardCode: 'PL!-pb1-024-N', name: '西木野真姬' },
  { cardCode: 'PL!HS-PR-026-PR', name: '村野沙耶香' },
  { cardCode: 'PL!HS-bp2-004-R', name: '夕雾缀理' },
  { cardCode: 'PL!HS-sd1-009-SD', name: '日野下花帆' },
  { cardCode: 'PL!N-PR-009-PR', name: '优木雪菜' },
  { cardCode: 'PL!N-PR-012-PR', name: '三船栞子' },
  { cardCode: 'PL!N-PR-014-PR', name: '钟岚珠' },
  { cardCode: 'PL!N-PR-019-PR', name: '中须霞' },
  { cardCode: 'PL!N-sd1-011-SD', name: '米娅·泰勒' },
  { cardCode: 'PL!S-PR-026-PR', name: '樱内梨子' },
  { cardCode: 'PL!S-bp2-009-R', name: '黑泽露比' },
  { cardCode: 'PL!S-pb1-004-R', name: '黑泽黛雅' },
  { cardCode: 'PL!S-sd1-015-SD', name: '津岛善子' },
  { cardCode: 'PL!SP-bp1-011-R', name: '鬼冢冬毬' },
  { cardCode: 'PL!SP-pb1-018-N', name: '米女芽衣' },
  { cardCode: 'PL!SP-sd1-006-SD', name: '樱小路 希奈子' },
  { cardCode: 'PL!SP-sd2-010-SD2', name: 'ウィーン・マルガレーテ' },
] as const;

const PB1_019_LIKE_MEMBER_ACTIVATION_TEST_CASES = [
  { cardCode: 'PL!-pb1-019-N', name: '高坂 穂乃果' },
  { cardCode: 'PL!-pb1-025-N', name: '東條 希' },
  { cardCode: 'PL!HS-PR-014-PR', name: '日野下 花帆' },
  { cardCode: 'PL!HS-pb1-019-N', name: '大沢 瑠璃乃' },
  { cardCode: 'PL!HS-sd1-015-SD', name: 'セラス 柳田 リリエンフェルト' },
  { cardCode: 'PL!N-bp4-017-N', name: '宮下 愛' },
  { cardCode: 'PL!N-bp4-020-N', name: 'エマ・ヴェルデ' },
  { cardCode: 'PL!N-sd1-006-SD', name: '近江 彼方' },
  { cardCode: 'PL!S-PR-025-PR', name: '高海 千歌' },
  { cardCode: 'PL!S-PR-027-PR', name: '松浦 果南' },
  { cardCode: 'PL!S-bp2-016-N', name: '国木田 花丸' },
  { cardCode: 'PL!S-bp6-014-N', name: '渡辺 曜' },
  { cardCode: 'PL!S-sd1-008-SD', name: '小原 鞠莉' },
  { cardCode: 'PL!SP-bp4-015-N', name: '平安名 すみれ' },
  { cardCode: 'PL!SP-bp4-019-N', name: '若菜 四季' },
  { cardCode: 'PL!SP-pb1-021-N', name: 'ウィーン・マルガレーテ' },
  { cardCode: 'PL!SP-sd2-014-SD2', name: '嵐 千砂都' },
] as const;

const GENERIC_DISCARD_LOOK_TOP_ON_ENTER_CARD_TEST_CASES = [
  { cardCode: 'PL!-sd1-011-SD', name: '高坂 穂乃果', cost: 4 },
  { cardCode: 'PL!HS-cl1-007-CL', name: 'セラス 柳田 リリエンフェルト', cost: 7 },
  { cardCode: 'PL!HS-pb1-011-R', name: '大沢 瑠璃乃', cost: 7 },
  { cardCode: 'PL!N-PR-004-PR', name: '中須かすみ', cost: 4 },
  { cardCode: 'PL!N-PR-006-PR', name: '朝香果林', cost: 4 },
  { cardCode: 'PL!N-PR-013-PR', name: 'ミア・テイラー', cost: 4 },
  { cardCode: 'PL!N-bp1-007-R', name: '優木せつ菜', cost: 4 },
  { cardCode: 'PL!N-bp1-010-R', name: '三船栞子', cost: 4 },
  { cardCode: 'PL!N-sd1-002-SD', name: '中須かすみ', cost: 9 },
  { cardCode: 'PL!N-sd1-003-SD', name: '桜坂しずく', cost: 9 },
] as const;

function createMemberCard(
  cardCode: string,
  name: string,
  cost = 1,
  groupName?: string,
  blade = 1
): MemberCardData {
  return {
    cardCode,
    name,
    groupName,
    cardType: CardType.MEMBER,
    cost,
    blade,
    hearts: [createHeartIcon(HeartColor.PINK, 1)],
  };
}

function createLiveCard(cardCode: string, name: string, groupName = "μ's"): LiveCardData {
  return {
    cardCode,
    name,
    groupName,
    cardType: CardType.LIVE,
    score: 3,
    requirements: createHeartRequirement({ [HeartColor.PINK]: 1 }),
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
  const mainDeck: AnyCardData[] = [
    createMemberCard('PL!-sd1-004-SD', '園田 海未', 11),
    createMemberCard('PL!-sd1-007-SD', '東條 希', 7),
    createMemberCard('PL!-sd1-009-SD', '矢澤 にこ', 15),
    createMemberCard('PL!-sd1-011-SD', '高坂 穂乃果', 11),
    createMemberCard('PL!HS-cl1-007-CL', 'セラス 柳田 リリエンフェルト', 7),
    createMemberCard('PL!HS-pb1-011-R', '大沢 瑠璃乃', 7),
    createMemberCard('PL!N-PR-004-PR', '中須かすみ', 4),
    createMemberCard('PL!N-PR-006-PR', '朝香果林', 4),
    createMemberCard('PL!N-PR-013-PR', 'ミア・テイラー', 4),
    createMemberCard('PL!N-bp1-007-R', '優木せつ菜', 4),
    createMemberCard('PL!N-bp1-010-R', '三船栞子', 4),
    createMemberCard('PL!N-sd1-002-SD', '中須かすみ', 9),
    createMemberCard('PL!N-sd1-003-SD', '桜坂しずく', 9),
    createMemberCard('PL!-sd1-003-SD', '南 ことり', 13),
    createMemberCard('PL!-sd1-015-SD', '西木野 真姫'),
    createMemberCard('PL!-sd1-008-SD', '小泉 花陽'),
    createMemberCard('PL!-sd1-008-SD', '小泉 花陽'),
    createMemberCard('PL!-bp3-010-N', '高坂 穂乃果', 9),
    createMemberCard('PL!-bp5-005-AR', '星空 凛', 10),
    createMemberCard('PL!-bp5-007-AR', '东条希', 13),
    createMemberCard('PL!SP-bp2-002-R', '唐 可可', 2),
    createMemberCard('PL!-PR-018-PR', '東條 希', 15),
    createMemberCard('LL-bp1-001-R+', '上原 步梦', 20),
    createMemberCard('PL!HS-bp2-002-P', '村野 沙耶香', 13),
    createMemberCard('PL!HS-PR-001-PR', '日野下 花帆', 10),
    createMemberCard('PL!N-pb1-004-P+', '朝香 果林', 5),
    createMemberCard('PL!N-pb1-004-P+', '朝香 果林', 5),
    createMemberCard('PL!SP-PR-004-PR', '唐 可可', 4),
    createMemberCard('PL!SP-bp4-008-P', '若菜四季', 13),
    createMemberCard('PL!SP-bp4-011-P', '鬼冢冬毬', 7, 'Liella!'),
    createMemberCard('PL!SP-bp5-003-AR', '岚 千砂都', 17),
    createMemberCard('PL!N-pb1-008-P+', '艾玛·维尔德', 17),
    createMemberCard('PL!S-bp2-006-P', '津岛善子', 11),
    createMemberCard('PL!HS-bp2-012-N', '乙宗 梢', 5),
    createMemberCard('PL!HS-bp6-017-N', '日野下花帆', 11),
    createMemberCard('PL!HS-sd1-001-SD', '日野下花帆', 9, '莲之空'),
    createMemberCard('PL!HS-pb1-009-R', '日野下花帆', 15, '莲之空', 4),
    createMemberCard('PL!HS-pb1-020-N', '百生吟子', 9, '莲之空'),
    createMemberCard('PL!HS-bp6-004-R', '百生 吟子', 13, '莲之空'),
    createMemberCard('PL!HS-bp6-004-P', '百生 吟子', 13, '莲之空'),
    createMemberCard('PL!HS-bp5-001-SEC', '日野下花帆', 11, '莲之空'),
    createMemberCard('PL!HS-bp5-003-AR', '大泽瑠璃乃', 2, '莲之空'),
    createMemberCard('PL!HS-bp1-003-SEC', '乙宗 梢', 13, '莲之空'),
    createMemberCard('PL!HS-bp1-002-RM', '村野沙耶香', 11, '莲之空'),
    createMemberCard('PL!HS-bp6-001-R＋', '日野下花帆', 4, '莲之空'),
    createMemberCard('PL!HS-bp1-006-P', '藤島 慈', 11),
    createMemberCard('PL!HS-bp1-006-P', '藤島 慈', 11, '莲之空'),
    createMemberCard('PL!HS-bp2-002-P', '村野 沙耶香', 13, '莲之空'),
    createMemberCard('PL!HS-PR-001-PR', '日野下 花帆', 10, '莲之空'),
    createMemberCard('MEM-HASU-0', '莲之空成员 0', 1, '莲之空'),
    createMemberCard('MEM-HASU-1', '莲之空成员 1', 1, '莲之空'),
    createMemberCard('MEM-HASU-2', '莲之空成员 2', 1, '莲之空'),
    createMemberCard('PL!-pb1-019-N', '高坂 穂乃果', 2),
    createMemberCard('PL!-bp4-003-P', '南 ことり', 2),
  ];
  for (let i = 0; i < 37; i++) {
    mainDeck.push(createMemberCard(`MEM-${i}`, `Member ${i}`));
  }
  for (let i = 0; i < 12; i++) {
    mainDeck.push(createLiveCard(`LIVE-${i}`, `Live ${i}`));
  }
  mainDeck.push({ ...createLiveCard('LIVE-SCORE-6', 'Score 6 Live'), score: 6 });
  mainDeck.push(createLiveCard('PL!-bp6-022-L', "Dreamin' Go! Go!!"));
  mainDeck.push(createLiveCard('LIVE-SAME-NAME-HAND', '水彩世界', '莲之空'));
  mainDeck.push(createLiveCard('LIVE-SAME-NAME-WAITING', '水彩世界', '莲之空'));
  mainDeck.push(createLiveCard('LIVE-DIFFERENT-NAME-WAITING', '月夜見海月', '莲之空'));
  mainDeck.push(createLiveCard('PL!HS-cl1-009-CL', '水彩世界', '莲之空'));

  const energyDeck = Array.from({ length: 24 }, (_, index) => createEnergyCard(`ENE-${index}`));
  return { mainDeck, energyDeck };
}

function forceMainPhaseForPlayer(session: ReturnType<typeof createGameSession>): void {
  const state = session.state as unknown as {
    currentPhase: GamePhase;
    currentSubPhase: SubPhase;
    activePlayerIndex: number;
    waitingPlayerId: string | null;
  };

  state.currentPhase = GamePhase.MAIN_PHASE;
  state.currentSubPhase = SubPhase.NONE;
  state.activePlayerIndex = 0;
  state.waitingPlayerId = null;
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

function setupHeartbeatLiveStartScenario(successLiveScores: readonly number[]): {
  readonly session: ReturnType<typeof createGameSession>;
  readonly advanceResult: ReturnType<GameService['advancePhase']>;
  readonly heartbeatLiveCardId: string;
  readonly successLiveCardIds: readonly string[];
} {
  const session = createGameSession();
  const deck = createDeck();

  session.createGame(
    `sample-bp4-021-heartbeat-live-start-${successLiveScores.join('-') || 'none'}`,
    PLAYER1,
    'Player 1',
    PLAYER2,
    'Player 2'
  );
  session.initializeGame(deck, deck);

  const heartbeatLive = createCardInstance(
    {
      cardCode: 'PL!-bp4-021-L',
      name: '?←HEARTBEAT',
      groupName: "μ's",
      cardType: CardType.LIVE as const,
      score: 6,
      requirements: createHeartRequirement({
        [HeartColor.PINK]: 2,
        [HeartColor.BLUE]: 2,
        [HeartColor.PURPLE]: 2,
        [HeartColor.RAINBOW]: 8,
      }),
    },
    PLAYER1,
    'p1-bp4-021-heartbeat-live'
  );
  const successLiveCards = successLiveScores.map((score, index) =>
    createCardInstance(
      {
        cardCode: `SUCCESS-SCORE-${score}-${index}`,
        name: `Success Score ${score}`,
        groupName: "μ's",
        cardType: CardType.LIVE as const,
        score,
        requirements: createHeartRequirement({ [HeartColor.PINK]: 1 }),
      },
      PLAYER1,
      `p1-success-score-${score}-${index}`
    )
  );
  const successLiveCardIds = successLiveCards.map((card) => card.instanceId);

  let state = registerCards(session.state!, [heartbeatLive, ...successLiveCards]);
  state = updatePlayer(state, PLAYER1, (player) => ({
    ...player,
    successZone: {
      ...player.successZone,
      cardIds: successLiveCardIds,
    },
    liveZone: {
      ...player.liveZone,
      cardIds: [heartbeatLive.instanceId],
      cardStates: new Map([
        [
          heartbeatLive.instanceId,
          { orientation: OrientationState.ACTIVE, face: FaceState.FACE_DOWN },
        ],
      ]),
    },
  }));
  state = {
    ...state,
    currentPhase: GamePhase.LIVE_SET_PHASE,
    currentSubPhase: SubPhase.LIVE_SET_SECOND_DRAW,
    currentTurnType: TurnType.LIVE_PHASE,
    activePlayerIndex: 0,
    firstPlayerIndex: 0,
    liveSetCompletedPlayers: [PLAYER1, PLAYER2],
  };

  const service = new GameService();
  const advanceResult = service.advancePhase(state);
  (session as unknown as { authorityState: GameState }).authorityState = advanceResult.gameState;

  return {
    session,
    advanceResult,
    heartbeatLiveCardId: heartbeatLive.instanceId,
    successLiveCardIds,
  };
}

function createTestMemberInstances(
  ownerId: string,
  prefix: string,
  count: number
): ReturnType<typeof createCardInstance>[] {
  return Array.from({ length: count }, (_, index) =>
    createCardInstance(
      createMemberCard(`PL!HS-test-${prefix}-${index}`, `${prefix} member ${index}`, 1, '蓮ノ空'),
      ownerId,
      `${ownerId}-${prefix}-${index}`
    )
  );
}

function setupHsPb1012OnEnterScenario(config: {
  readonly ownMemberCount: number;
  readonly opponentMemberCount: number;
  readonly includeLiveTarget: boolean;
}): {
  readonly session: ReturnType<typeof createGameSession>;
  readonly ginko: ReturnType<typeof createCardInstance>;
  readonly ownMembers: readonly ReturnType<typeof createCardInstance>[];
  readonly opponentMembers: readonly ReturnType<typeof createCardInstance>[];
  readonly ownDeckFiller: ReturnType<typeof createCardInstance>;
  readonly opponentDeckFiller: ReturnType<typeof createCardInstance>;
  readonly liveTarget: ReturnType<typeof createCardInstance> | null;
} {
  const session = createGameSession();
  const deck = createDeck();

  session.createGame(
    `sample-hs-pb1-012-on-enter-${config.ownMemberCount}-${config.opponentMemberCount}-${config.includeLiveTarget}`,
    PLAYER1,
    'Player 1',
    PLAYER2,
    'Player 2'
  );
  session.initializeGame(deck, deck);
  forceMainPhaseForPlayer(session);

  const ginko = createCardInstance(
    createMemberCard('PL!HS-pb1-012-R', '百生吟子', 13, '蓮ノ空', 3),
    PLAYER1,
    'p1-pb1-012-ginko'
  );
  const ownMembers = createTestMemberInstances(PLAYER1, 'pb1-012-own', config.ownMemberCount);
  const opponentMembers = createTestMemberInstances(
    PLAYER2,
    'pb1-012-opponent',
    config.opponentMemberCount
  );
  const ownDeckFiller = createCardInstance(
    createLiveCard('PL!HS-test-pb1-012-own-filler', 'Own Filler Live', '蓮ノ空'),
    PLAYER1,
    'p1-pb1-012-own-filler'
  );
  const opponentDeckFiller = createCardInstance(
    createLiveCard('PL!HS-test-pb1-012-opponent-filler', 'Opponent Filler Live', '蓮ノ空'),
    PLAYER2,
    'p2-pb1-012-opponent-filler'
  );
  const liveTarget = config.includeLiveTarget
    ? createCardInstance(
        createLiveCard('PL!HS-test-pb1-012-live', 'Recoverable Live', '蓮ノ空'),
        PLAYER1,
        'p1-pb1-012-live'
      )
    : null;

  const registeredState = registerCards(session.state!, [
    ginko,
    ...ownMembers,
    ...opponentMembers,
    ownDeckFiller,
    opponentDeckFiller,
    ...(liveTarget ? [liveTarget] : []),
  ]);
  const activeEnergyCardIds = [...registeredState.cardRegistry.values()]
    .filter((card) => card.ownerId === PLAYER1 && card.data.cardType === CardType.ENERGY)
    .map((card) => card.instanceId)
    .slice(0, 13);

  let preparedState = updatePlayer(registeredState, PLAYER1, (player) => ({
    ...player,
    hand: { ...player.hand, cardIds: [ginko.instanceId] },
    mainDeck: { ...player.mainDeck, cardIds: [ownDeckFiller.instanceId] },
    waitingRoom: {
      ...player.waitingRoom,
      cardIds: [
        ...ownMembers.map((card) => card.instanceId),
        ...(liveTarget ? [liveTarget.instanceId] : []),
      ],
    },
    successZone: { ...player.successZone, cardIds: [] },
    liveZone: { ...player.liveZone, cardIds: [] },
    energyDeck: { ...player.energyDeck, cardIds: [] },
    energyZone: {
      ...player.energyZone,
      cardIds: activeEnergyCardIds,
      cardStates: new Map(
        activeEnergyCardIds.map((cardId) => [
          cardId,
          { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP },
        ])
      ),
    },
    memberSlots: {
      ...player.memberSlots,
      slots: {
        ...player.memberSlots.slots,
        [SlotPosition.CENTER]: null,
      },
    },
  }));
  preparedState = updatePlayer(preparedState, PLAYER2, (player) => ({
    ...player,
    hand: { ...player.hand, cardIds: [] },
    mainDeck: { ...player.mainDeck, cardIds: [opponentDeckFiller.instanceId] },
    waitingRoom: {
      ...player.waitingRoom,
      cardIds: opponentMembers.map((card) => card.instanceId),
    },
    successZone: { ...player.successZone, cardIds: [] },
    liveZone: { ...player.liveZone, cardIds: [] },
  }));
  (session as unknown as { authorityState: GameState }).authorityState = preparedState;

  const playResult = session.executeCommand(
    createPlayMemberToSlotCommand(PLAYER1, ginko.instanceId, SlotPosition.CENTER)
  );
  expect(playResult.success).toBe(true);

  return {
    session,
    ginko,
    ownMembers,
    opponentMembers,
    ownDeckFiller,
    opponentDeckFiller,
    liveTarget,
  };
}

function setupTsukiyomiManualCheerAdjustmentSession(
  selectableCheerCount = 1
): ReturnType<typeof createGameSession> {
  const session = createGameSession();
  const deck = createDeck();

  session.createGame(
    'sample-hs-bp6-027-manual-cheer-adjustment',
    PLAYER1,
    'Player 1',
    PLAYER2,
    'Player 2'
  );
  session.initializeGame(deck, deck);

  const tsukiyomi = createCardInstance(
    {
      ...createLiveCard('PL!HS-bp6-027-L', '月夜見海月', '蓮ノ空'),
      score: 5,
    },
    PLAYER1,
    'p1-tsukiyomi-manual-live'
  );
  const selectableCheers = Array.from({ length: selectableCheerCount }, (_, index) =>
    createCardInstance(
      createMemberCard(`PL!HS-test-manual-cheer-target-${index}`, `日野下 花帆 ${index}`, 1, '蓮ノ空'),
      PLAYER1,
      `p1-tsukiyomi-manual-cheer-target-${index}`
    )
  );
  const deckFiller = createCardInstance(
    createMemberCard('PL!HS-test-manual-cheer-filler', '村野 沙耶香', 1, '蓮ノ空'),
    PLAYER1,
    'p1-tsukiyomi-manual-cheer-filler'
  );

  let state = registerCards(session.state!, [tsukiyomi, ...selectableCheers, deckFiller]);
  state = updatePlayer(state, PLAYER1, (player) => ({
    ...player,
    mainDeck: {
      ...player.mainDeck,
      cardIds: [...selectableCheers.map((card) => card.instanceId), deckFiller.instanceId],
    },
    liveZone: { ...player.liveZone, cardIds: [tsukiyomi.instanceId] },
    waitingRoom: { ...player.waitingRoom, cardIds: [] },
  }));
  state = {
    ...state,
    currentPhase: GamePhase.PERFORMANCE_PHASE,
    currentSubPhase: SubPhase.PERFORMANCE_JUDGMENT,
    currentTurnType: TurnType.FIRST_PLAYER_TURN,
    activePlayerIndex: 0,
    firstPlayerIndex: 0,
    resolutionZone: {
      ...state.resolutionZone,
      cardIds: [],
      revealedCardIds: [],
    },
    liveResolution: {
      ...state.liveResolution,
      isInLive: true,
      performingPlayerId: PLAYER1,
      firstPlayerCheerCardIds: [],
      secondPlayerCheerCardIds: [],
    },
  };
  (session as unknown as { authorityState: GameState }).authorityState = state;

  return session;
}

function removeFromPlayerZones(player: {
  hand: { cardIds: string[] };
  mainDeck: { cardIds: string[] };
  waitingRoom: { cardIds: string[] };
  successZone: { cardIds: string[] };
  liveZone: { cardIds: string[] };
}): void {
  const zones = [
    player.hand,
    player.mainDeck,
    player.waitingRoom,
    player.successZone,
    player.liveZone,
  ];
  for (const zone of zones) {
    zone.cardIds = [];
  }
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

function setEnergyZoneCards(
  player: {
    energyZone: {
      cardIds: string[];
      cardStates: Map<string, { orientation: OrientationState; face: FaceState }>;
    };
  },
  energyCards: readonly { readonly cardId: string; readonly orientation: OrientationState }[]
): void {
  player.energyZone.cardIds = energyCards.map((card) => card.cardId);
  player.energyZone.cardStates = new Map(
    energyCards.map((card) => [
      card.cardId,
      { orientation: card.orientation, face: FaceState.FACE_UP },
    ])
  );
}

interface Bp6005RinScenario {
  readonly session: ReturnType<typeof createGameSession>;
  readonly rin: ReturnType<typeof createCardInstance>;
  readonly discardA: ReturnType<typeof createCardInstance>;
  readonly discardB: ReturnType<typeof createCardInstance>;
  readonly yellowMember: ReturnType<typeof createCardInstance>;
  readonly secondYellowMember: ReturnType<typeof createCardInstance>;
  readonly pinkMember: ReturnType<typeof createCardInstance>;
  readonly yellowLive: ReturnType<typeof createCardInstance>;
  readonly pinkLive: ReturnType<typeof createCardInstance>;
}

function setupBp6005RinOnEnterScenario(
  options: {
    readonly handDiscardCount?: 0 | 1 | 2;
    readonly includeSecondYellowMember?: boolean;
  } = {}
): Bp6005RinScenario {
  const session = createGameSession();
  const deck = createDeck();

  session.createGame(
    'sample-bp6-005-rin-on-enter-discard-two-recover-yellow-heart-groups',
    PLAYER1,
    'Player 1',
    PLAYER2,
    'Player 2'
  );
  session.initializeGame(deck, deck);
  forceMainPhaseForPlayer(session);

  const rin = createCardInstance(
    createMemberCard('PL!-bp6-005-P', '星空 凛', 11, "μ's"),
    PLAYER1,
    'p1-bp6-005-rin'
  );
  const discardA = createCardInstance(
    createMemberCard('PL!-test-bp6-005-discard-a', '高坂穂乃果', 1, "μ's"),
    PLAYER1,
    'p1-bp6-005-discard-a'
  );
  const discardB = createCardInstance(
    createMemberCard('PL!-test-bp6-005-discard-b', '南ことり', 1, "μ's"),
    PLAYER1,
    'p1-bp6-005-discard-b'
  );
  const yellowMember = createCardInstance(
    {
      ...createMemberCard('PL!-test-bp6-005-yellow-member', '小泉花陽', 1, "μ's"),
      hearts: [createHeartIcon(HeartColor.YELLOW, 1)],
    },
    PLAYER1,
    'p1-bp6-005-yellow-member'
  );
  const secondYellowMember = createCardInstance(
    {
      ...createMemberCard('PL!-test-bp6-005-second-yellow-member', '星空凛', 1, "μ's"),
      hearts: [createHeartIcon(HeartColor.YELLOW, 1)],
    },
    PLAYER1,
    'p1-bp6-005-second-yellow-member'
  );
  const pinkMember = createCardInstance(
    {
      ...createMemberCard('PL!-test-bp6-005-pink-member', '西木野真姫', 1, "μ's"),
      hearts: [createHeartIcon(HeartColor.PINK, 1)],
    },
    PLAYER1,
    'p1-bp6-005-pink-member'
  );
  const yellowLive = createCardInstance(
    {
      ...createLiveCard('PL!-test-bp6-005-yellow-live', 'Yellow Requirement LIVE', "μ's"),
      requirements: createHeartRequirement({ [HeartColor.YELLOW]: 1 }),
    },
    PLAYER1,
    'p1-bp6-005-yellow-live'
  );
  const pinkLive = createCardInstance(
    {
      ...createLiveCard('PL!-test-bp6-005-pink-live', 'Pink Requirement LIVE', "μ's"),
      requirements: createHeartRequirement({ [HeartColor.PINK]: 2 }),
    },
    PLAYER1,
    'p1-bp6-005-pink-live'
  );
  const deckFiller = createCardInstance(
    createMemberCard('PL!-test-bp6-005-deck-filler', '園田海未', 1, "μ's"),
    PLAYER1,
    'p1-bp6-005-deck-filler'
  );

  const state = registerCards(session.state!, [
    rin,
    discardA,
    discardB,
    yellowMember,
    secondYellowMember,
    pinkMember,
    yellowLive,
    pinkLive,
    deckFiller,
  ]);
  const p1 = state.players[0] as unknown as {
    hand: { cardIds: string[] };
    mainDeck: { cardIds: string[] };
    waitingRoom: { cardIds: string[] };
    successZone: { cardIds: string[] };
    liveZone: { cardIds: string[] };
    energyZone: {
      cardIds: string[];
      cardStates: Map<string, { orientation: OrientationState; face: FaceState }>;
    };
    memberSlots: {
      slots: Record<SlotPosition, string | null>;
      cardStates: Map<string, { orientation: OrientationState; face: FaceState }>;
    };
  };
  const energyCardIds = [...state.cardRegistry.values()]
    .filter((card) => card.ownerId === PLAYER1 && card.data.cardType === CardType.ENERGY)
    .map((card) => card.instanceId);

  removeFromPlayerZones(p1);
  const handDiscardCount = options.handDiscardCount ?? 2;
  p1.hand.cardIds = [
    rin.instanceId,
    ...[discardA.instanceId, discardB.instanceId].slice(0, handDiscardCount),
  ];
  p1.mainDeck.cardIds = [deckFiller.instanceId];
  p1.waitingRoom.cardIds = [
    yellowMember.instanceId,
    yellowLive.instanceId,
    pinkMember.instanceId,
    pinkLive.instanceId,
    ...(options.includeSecondYellowMember ? [secondYellowMember.instanceId] : []),
  ];
  p1.memberSlots.slots[SlotPosition.CENTER] = null;
  p1.memberSlots.cardStates = new Map();
  setActiveEnergy(p1, energyCardIds.slice(0, 11));
  (session as unknown as { authorityState: GameState }).authorityState = state;

  const playResult = session.executeCommand(
    createPlayMemberToSlotCommand(PLAYER1, rin.instanceId, SlotPosition.CENTER)
  );
  expect(playResult.success).toBe(true);

  return {
    session,
    rin,
    discardA,
    discardB,
    yellowMember,
    secondYellowMember,
    pinkMember,
    yellowLive,
    pinkLive,
  };
}

function payBp6005DiscardCost(context: Bp6005RinScenario): void {
  expect(context.session.state?.activeEffect?.abilityId).toBe(
    BP6_005_ON_ENTER_DISCARD_TWO_RECOVER_YELLOW_HEART_CARDS_ABILITY_ID
  );
  expect(context.session.state?.activeEffect?.selectableCardMode).toBe('ORDERED_MULTI');
  expect(context.session.state?.activeEffect?.selectableCardVisibility).toBe(
    'AWAITING_PLAYER_ONLY'
  );

  const discardResult = context.session.executeCommand(
    createConfirmEffectStepCommand(
      PLAYER1,
      context.session.state!.activeEffect!.id,
      undefined,
      undefined,
      undefined,
      undefined,
      [context.discardA.instanceId, context.discardB.instanceId]
    )
  );
  expect(discardResult.success).toBe(true);
}

interface HsPb1020GinkoScenario {
  readonly session: ReturnType<typeof createGameSession>;
  readonly ginko: ReturnType<typeof createCardInstance>;
  readonly discardA: ReturnType<typeof createCardInstance>;
  readonly discardB: ReturnType<typeof createCardInstance>;
  readonly ceriseMember: ReturnType<typeof createCardInstance>;
  readonly hasunosoraLive: ReturnType<typeof createCardInstance>;
  readonly otherLiveA: ReturnType<typeof createCardInstance>;
  readonly otherLiveB: ReturnType<typeof createCardInstance>;
  readonly otherLiveC: ReturnType<typeof createCardInstance>;
}

function setupHsPb1020GinkoScenario(
  options: {
    readonly handDiscardCount?: 1 | 2;
    readonly recoveryTargets?: 'both' | 'ceriseOnly' | 'none';
    readonly waitingRoomLiveCount?: 2 | 3;
  } = {}
): HsPb1020GinkoScenario {
  const session = createGameSession();
  const deck = createDeck();

  session.createGame(
    `sample-hs-pb1-020-grouped-recovery-${options.recoveryTargets ?? 'both'}-${options.handDiscardCount ?? 2}-${options.waitingRoomLiveCount ?? 3}`,
    PLAYER1,
    'Player 1',
    PLAYER2,
    'Player 2'
  );
  session.initializeGame(deck, deck);
  forceMainPhaseForPlayer(session);

  const ginko = createCardInstance(
    createMemberCard('PL!HS-pb1-020-N', '百生吟子', 9, '蓮ノ空'),
    PLAYER1,
    'p1-pb1-020-helper-ginko'
  );
  const discardA = createCardInstance(
    createMemberCard('PL!HS-test-pb1-020-helper-discard-a', '日野下花帆', 1, '蓮ノ空'),
    PLAYER1,
    'p1-pb1-020-helper-discard-a'
  );
  const discardB = createCardInstance(
    createMemberCard('PL!HS-test-pb1-020-helper-discard-b', '村野さやか', 1, '蓮ノ空'),
    PLAYER1,
    'p1-pb1-020-helper-discard-b'
  );
  const ceriseMember = createCardInstance(
    {
      ...createMemberCard('PL!HS-test-pb1-020-helper-cerise-member', '乙宗梢', 4, '蓮ノ空'),
      unitName: 'スリーズブーケ',
    },
    PLAYER1,
    'p1-pb1-020-helper-cerise-member'
  );
  const hasunosoraLive = createCardInstance(
    createLiveCard('PL!HS-test-pb1-020-helper-hasu-live', '蓮ノ空 LIVE', '蓮ノ空'),
    PLAYER1,
    'p1-pb1-020-helper-hasu-live'
  );
  const otherLiveA = createCardInstance(
    createLiveCard('PL!-test-pb1-020-helper-other-live-a', "μ's LIVE A", "μ's"),
    PLAYER1,
    'p1-pb1-020-helper-other-live-a'
  );
  const otherLiveB = createCardInstance(
    createLiveCard('PL!-test-pb1-020-helper-other-live-b', "μ's LIVE B", "μ's"),
    PLAYER1,
    'p1-pb1-020-helper-other-live-b'
  );
  const otherLiveC = createCardInstance(
    createLiveCard('PL!-test-pb1-020-helper-other-live-c', "μ's LIVE C", "μ's"),
    PLAYER1,
    'p1-pb1-020-helper-other-live-c'
  );
  const deckFiller = createCardInstance(
    createMemberCard('PL!HS-test-pb1-020-helper-deck-filler', '大沢瑠璃乃', 1, '蓮ノ空'),
    PLAYER1,
    'p1-pb1-020-helper-deck-filler'
  );

  let state = registerCards(session.state!, [
    ginko,
    discardA,
    discardB,
    ceriseMember,
    hasunosoraLive,
    otherLiveA,
    otherLiveB,
    otherLiveC,
    deckFiller,
  ]);
  const p1 = state.players[0] as unknown as {
    hand: { cardIds: string[] };
    mainDeck: { cardIds: string[] };
    waitingRoom: { cardIds: string[] };
    successZone: { cardIds: string[] };
    liveZone: { cardIds: string[] };
    energyZone: {
      cardIds: string[];
      cardStates: Map<string, { orientation: OrientationState; face: FaceState }>;
    };
    memberSlots: {
      slots: Record<SlotPosition, string | null>;
      cardStates: Map<string, { orientation: OrientationState; face: FaceState }>;
    };
  };
  const energyCardIds = [...state.cardRegistry.values()]
    .filter((card) => card.ownerId === PLAYER1 && card.data.cardType === CardType.ENERGY)
    .map((card) => card.instanceId);

  removeFromPlayerZones(p1);
  const recoveryTargets = options.recoveryTargets ?? 'both';
  p1.hand.cardIds = [
    ginko.instanceId,
    ...[discardA.instanceId, discardB.instanceId].slice(0, options.handDiscardCount ?? 2),
  ];
  p1.mainDeck.cardIds = [deckFiller.instanceId];
  const liveFillerCardIds =
    options.waitingRoomLiveCount === 2
      ? [otherLiveA.instanceId, otherLiveB.instanceId]
      : [otherLiveA.instanceId, otherLiveB.instanceId, otherLiveC.instanceId];
  p1.waitingRoom.cardIds = [
    ...(recoveryTargets === 'both' ? [hasunosoraLive.instanceId] : []),
    ...(recoveryTargets === 'both' || recoveryTargets === 'ceriseOnly'
      ? [ceriseMember.instanceId]
      : []),
    ...liveFillerCardIds,
  ];
  p1.successZone.cardIds = [];
  p1.liveZone.cardIds = [];
  p1.memberSlots.slots[SlotPosition.CENTER] = null;
  p1.memberSlots.cardStates = new Map();
  setActiveEnergy(p1, energyCardIds.slice(0, 9));
  (session as unknown as { authorityState: GameState }).authorityState = state;

  const playResult = session.executeCommand(
    createPlayMemberToSlotCommand(PLAYER1, ginko.instanceId, SlotPosition.CENTER)
  );
  expect(playResult.success).toBe(true);

  return {
    session,
    ginko,
    discardA,
    discardB,
    ceriseMember,
    hasunosoraLive,
    otherLiveA,
    otherLiveB,
    otherLiveC,
  };
}

interface FixedPayEnergyGainBladeScenario {
  readonly session: ReturnType<typeof createGameSession>;
  readonly sourceCardId: string;
  readonly liveCardId: string;
  readonly energyCardIds: readonly string[];
}

function setupFixedPayEnergyGainBladeLiveStartScenario(options: {
  readonly gameId: string;
  readonly cardCode: string;
  readonly cardName: string;
  readonly groupName: string;
  readonly activeEnergyCount: number;
}): FixedPayEnergyGainBladeScenario {
  const session = createGameSession();
  const deck = createDeck();

  session.createGame(options.gameId, PLAYER1, 'Player 1', PLAYER2, 'Player 2');
  session.initializeGame(deck, deck);

  let state = session.state!;
  const p1 = state.players[0] as unknown as {
    hand: { cardIds: string[] };
    mainDeck: { cardIds: string[] };
    waitingRoom: { cardIds: string[] };
    successZone: { cardIds: string[] };
    liveZone: { cardIds: string[] };
    energyZone: {
      cardIds: string[];
      cardStates: Map<string, { orientation: OrientationState; face: FaceState }>;
    };
    memberSlots: {
      slots: Record<SlotPosition, string | null>;
      cardStates: Map<string, { orientation: OrientationState; face: FaceState }>;
    };
  };
  const ownedP1CardIds = [...state.cardRegistry.values()]
    .filter((card) => card.ownerId === PLAYER1)
    .map((card) => card.instanceId);
  const sourceCardId = ownedP1CardIds.find(
    (cardId) => state.cardRegistry.get(cardId)?.data.cardType === CardType.MEMBER
  );
  const liveCardId = ownedP1CardIds.find(
    (cardId) => state.cardRegistry.get(cardId)?.data.cardType === CardType.LIVE
  );
  const energyCardIds = ownedP1CardIds.filter(
    (cardId) => state.cardRegistry.get(cardId)?.data.cardType === CardType.ENERGY
  );
  const sourceCard = state.cardRegistry.get(sourceCardId!) as unknown as { data: MemberCardData };

  expect(sourceCardId).toBeTruthy();
  expect(liveCardId).toBeTruthy();
  expect(energyCardIds.length).toBeGreaterThanOrEqual(options.activeEnergyCount);
  sourceCard.data = createMemberCard(
    options.cardCode,
    options.cardName,
    15,
    options.groupName
  );

  removeFromPlayerZones(p1);
  p1.memberSlots.slots[SlotPosition.CENTER] = sourceCardId!;
  p1.memberSlots.cardStates = new Map([
    [sourceCardId!, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
  ]);
  p1.liveZone.cardIds = [liveCardId!];
  setActiveEnergy(p1, energyCardIds.slice(0, options.activeEnergyCount));
  state = {
    ...state,
    currentPhase: GamePhase.LIVE_SET_PHASE,
    currentSubPhase: SubPhase.LIVE_SET_SECOND_DRAW,
    currentTurnType: TurnType.LIVE_PHASE,
    activePlayerIndex: 0,
    firstPlayerIndex: 0,
    liveSetCompletedPlayers: [PLAYER1, PLAYER2],
  };

  const service = new GameService();
  const advanceResult = service.advancePhase(state);
  (session as unknown as { authorityState: GameState }).authorityState = advanceResult.gameState;
  expect(advanceResult.success).toBe(true);

  return {
    session,
    sourceCardId: sourceCardId!,
    liveCardId: liveCardId!,
    energyCardIds,
  };
}

function prepareHsPb1KahoMegumiOrderScenario(gameId: string): {
  readonly session: ReturnType<typeof createGameSession>;
  readonly kahoCardId: string;
  readonly megumiCardId: string;
  readonly drawCardIds: readonly string[];
  readonly playResult: ReturnType<ReturnType<typeof createGameSession>['executeCommand']>;
} {
  const session = createGameSession();
  const deck = createDeck();

  session.createGame(gameId, PLAYER1, 'Player 1', PLAYER2, 'Player 2');
  session.initializeGame(deck, deck);
  forceMainPhaseForPlayer(session);

  const state = session.state!;
  const p1 = state.players[0] as unknown as {
    hand: { cardIds: string[] };
    mainDeck: { cardIds: string[] };
    waitingRoom: { cardIds: string[] };
    successZone: { cardIds: string[] };
    liveZone: { cardIds: string[] };
    energyZone: {
      cardIds: string[];
      cardStates: Map<string, { orientation: OrientationState; face: FaceState }>;
    };
    memberSlots: {
      slots: Record<SlotPosition, string | null>;
      cardStates: Map<string, { orientation: OrientationState; face: FaceState }>;
    };
  };
  const ownedP1CardIds = [...state.cardRegistry.values()]
    .filter((card) => card.ownerId === PLAYER1)
    .map((card) => card.instanceId);
  const kahoCardId = ownedP1CardIds.find(
    (cardId) => state.cardRegistry.get(cardId)?.data.cardCode === 'PL!HS-pb1-009-R'
  );
  const megumiCardId = ownedP1CardIds.find((cardId) => {
    const card = state.cardRegistry.get(cardId);
    return card?.data.cardCode === 'PL!HS-bp1-006-P' && card.data.groupName === '莲之空';
  });
  const energyCardIds = ownedP1CardIds.filter(
    (cardId) => state.cardRegistry.get(cardId)?.data.cardType === CardType.ENERGY
  );
  const deckCardIds = ownedP1CardIds.filter(
    (cardId) =>
      cardId !== kahoCardId &&
      cardId !== megumiCardId &&
      state.cardRegistry.get(cardId)?.data.cardType !== CardType.ENERGY
  );

  expect(kahoCardId).toBeTruthy();
  expect(megumiCardId).toBeTruthy();
  expect(energyCardIds.length).toBeGreaterThanOrEqual(11);
  expect(deckCardIds.length).toBeGreaterThanOrEqual(2);

  const drawCardIds = deckCardIds.slice(0, 2);
  removeFromPlayerZones(p1);
  p1.hand.cardIds = [megumiCardId!];
  p1.mainDeck.cardIds = drawCardIds;
  setActiveEnergy(p1, energyCardIds.slice(0, 11));
  p1.memberSlots.slots[SlotPosition.LEFT] = null;
  p1.memberSlots.slots[SlotPosition.CENTER] = kahoCardId!;
  p1.memberSlots.slots[SlotPosition.RIGHT] = null;
  p1.memberSlots.cardStates = new Map([
    [kahoCardId!, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
  ]);

  const playResult = session.executeCommand(
    createPlayMemberToSlotCommand(PLAYER1, megumiCardId!, SlotPosition.LEFT)
  );

  return {
    session,
    kahoCardId: kahoCardId!,
    megumiCardId: megumiCardId!,
    drawCardIds,
    playResult,
  };
}

describe('sample card effect runner', () => {
  it('executes PL!-sd1-007-SD on-enter mill five and draw one when a Live card was milled', () => {
    const session = createGameSession();
    const deck = createDeck();

    session.createGame('sample-effect-runner', PLAYER1, 'Player 1', PLAYER2, 'Player 2');
    session.initializeGame(deck, deck);
    forceMainPhaseForPlayer(session);

    const state = session.state!;
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
      memberSlots: { slots: Record<SlotPosition, string | null> };
    };

    const ownedP1CardIds = [...state.cardRegistry.values()]
      .filter((card) => card.ownerId === PLAYER1)
      .map((card) => card.instanceId);
    const nozomiCardId = ownedP1CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardCode === 'PL!-sd1-007-SD'
    );
    const liveCardId = ownedP1CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardType === CardType.LIVE
    );
    const energyCardIds = ownedP1CardIds.filter(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardType === CardType.ENERGY
    );
    const otherMemberCardIds = ownedP1CardIds.filter(
      (cardId) =>
        cardId !== nozomiCardId && state.cardRegistry.get(cardId)?.data.cardType === CardType.MEMBER
    );

    expect(nozomiCardId).toBeTruthy();
    expect(liveCardId).toBeTruthy();
    expect(energyCardIds.length).toBeGreaterThanOrEqual(7);
    expect(otherMemberCardIds.length).toBeGreaterThanOrEqual(5);

    const milledCardIds = [
      otherMemberCardIds[0],
      liveCardId!,
      otherMemberCardIds[1],
      otherMemberCardIds[2],
      otherMemberCardIds[3],
    ];
    const drawnCardId = otherMemberCardIds[4];

    removeFromPlayerZones(p1);
    setActiveEnergy(p1, energyCardIds.slice(0, 7));
    p1.hand.cardIds = [nozomiCardId!];
    p1.mainDeck.cardIds = [...milledCardIds, drawnCardId];
    p1.memberSlots.slots = {
      [SlotPosition.LEFT]: null,
      [SlotPosition.CENTER]: null,
      [SlotPosition.RIGHT]: null,
    };

    const result = session.executeCommand(
      createPlayMemberToSlotCommand(PLAYER1, nozomiCardId!, SlotPosition.CENTER)
    );

    expect(result.success).toBe(true);
    const activeEffect = session.state?.activeEffect;
    expect(session.state?.players[0].memberSlots.slots[SlotPosition.CENTER]).toBe(nozomiCardId);
    expect(session.state?.inspectionZone.cardIds).toEqual(milledCardIds);
    expect(session.state?.inspectionZone.revealedCardIds).toEqual(milledCardIds);
    expect(session.state?.inspectionContext?.ownerPlayerId).toBe(PLAYER1);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([]);
    expect(session.state?.players[0].hand.cardIds).toEqual([]);
    expect(session.state?.players[0].mainDeck.cardIds).toEqual([drawnCardId]);
    expect(session.state?.pendingAbilities).toEqual([]);
    expect(activeEffect?.abilityId).toBe(NOZOMI_ON_ENTER_ABILITY_ID);
    expect(activeEffect?.awaitingPlayerId).toBe(PLAYER1);
    expect(activeEffect?.inspectionCardIds).toEqual(milledCardIds);
    expect(
      session.state?.actionHistory.some(
        (action) =>
          action.type === 'TRIGGER_ABILITY' &&
          action.payload.abilityId === NOZOMI_ON_ENTER_ABILITY_ID
      )
    ).toBe(true);

    const confirmResult = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, activeEffect!.id)
    );

    expect(confirmResult.success).toBe(true);
    expect(session.state?.inspectionZone.cardIds).toEqual([]);
    expect(session.state?.inspectionZone.revealedCardIds).toEqual([]);
    expect(session.state?.inspectionContext).toBeNull();
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual(milledCardIds);
    expect(session.state?.players[0].hand.cardIds).toEqual([drawnCardId]);
    expect(session.state?.players[0].mainDeck.cardIds).toEqual([]);
    expect(
      session.state?.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId === NOZOMI_ON_ENTER_ABILITY_ID &&
          action.payload.step === 'FINISH' &&
          action.payload.drawnCardId === drawnCardId
      )
    ).toBe(true);
  });

  it('executes PL!-sd1-007-SD on-enter mill five without drawing when no Live card was milled', () => {
    const session = createGameSession();
    const deck = createDeck();

    session.createGame('sample-effect-runner-no-live', PLAYER1, 'Player 1', PLAYER2, 'Player 2');
    session.initializeGame(deck, deck);
    forceMainPhaseForPlayer(session);

    const state = session.state!;
    const p1 = state.players[0] as unknown as {
      hand: { cardIds: string[] };
      mainDeck: { cardIds: string[] };
      waitingRoom: { cardIds: string[] };
      successZone: { cardIds: string[] };
      liveZone: { cardIds: string[] };
      energyZone: {
        cardIds: string[];
        cardStates: Map<string, { orientation: OrientationState; face: FaceState }>;
      };
      memberSlots: { slots: Record<SlotPosition, string | null> };
    };

    const ownedP1CardIds = [...state.cardRegistry.values()]
      .filter((card) => card.ownerId === PLAYER1)
      .map((card) => card.instanceId);
    const nozomiCardId = ownedP1CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardCode === 'PL!-sd1-007-SD'
    );
    const energyCardIds = ownedP1CardIds.filter(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardType === CardType.ENERGY
    );
    const otherMemberCardIds = ownedP1CardIds.filter(
      (cardId) =>
        cardId !== nozomiCardId && state.cardRegistry.get(cardId)?.data.cardType === CardType.MEMBER
    );

    expect(nozomiCardId).toBeTruthy();
    expect(energyCardIds.length).toBeGreaterThanOrEqual(7);
    expect(otherMemberCardIds.length).toBeGreaterThanOrEqual(6);

    const milledCardIds = otherMemberCardIds.slice(0, 5);
    const remainingDeckCardId = otherMemberCardIds[5];

    removeFromPlayerZones(p1);
    setActiveEnergy(p1, energyCardIds.slice(0, 7));
    p1.hand.cardIds = [nozomiCardId!];
    p1.mainDeck.cardIds = [...milledCardIds, remainingDeckCardId];
    p1.memberSlots.slots[SlotPosition.CENTER] = null;

    const result = session.executeCommand(
      createPlayMemberToSlotCommand(PLAYER1, nozomiCardId!, SlotPosition.CENTER)
    );

    expect(result.success).toBe(true);
    const activeEffect = session.state?.activeEffect;
    expect(session.state?.inspectionZone.cardIds).toEqual(milledCardIds);
    expect(session.state?.inspectionZone.revealedCardIds).toEqual(milledCardIds);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([]);
    expect(session.state?.players[0].hand.cardIds).toEqual([]);
    expect(session.state?.players[0].mainDeck.cardIds).toEqual([remainingDeckCardId]);
    expect(activeEffect?.abilityId).toBe(NOZOMI_ON_ENTER_ABILITY_ID);

    const confirmResult = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, activeEffect!.id)
    );

    expect(confirmResult.success).toBe(true);
    expect(session.state?.inspectionZone.cardIds).toEqual([]);
    expect(session.state?.inspectionZone.revealedCardIds).toEqual([]);
    expect(session.state?.inspectionContext).toBeNull();
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual(milledCardIds);
    expect(session.state?.players[0].hand.cardIds).toEqual([]);
    expect(session.state?.players[0].mainDeck.cardIds).toEqual([remainingDeckCardId]);
    expect(
      session.state?.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId === NOZOMI_ON_ENTER_ABILITY_ID &&
          action.payload.step === 'FINISH' &&
          action.payload.hasMilledLiveCard === false &&
          action.payload.drawnCardId === null
      )
    ).toBe(true);
  });

  it('executes PL!-sd1-004-SD on-enter look five and choose one Muse Live to hand', () => {
    const session = createGameSession();
    const deck = createDeck();

    session.createGame('sample-choice-effect-runner', PLAYER1, 'Player 1', PLAYER2, 'Player 2');
    session.initializeGame(deck, deck);
    forceMainPhaseForPlayer(session);

    const state = session.state!;
    const p1 = state.players[0] as unknown as {
      hand: { cardIds: string[] };
      mainDeck: { cardIds: string[] };
      waitingRoom: { cardIds: string[] };
      successZone: { cardIds: string[] };
      liveZone: { cardIds: string[] };
      energyZone: {
        cardIds: string[];
        cardStates: Map<string, { orientation: OrientationState; face: FaceState }>;
      };
      memberSlots: { slots: Record<SlotPosition, string | null> };
    };

    const ownedP1CardIds = [...state.cardRegistry.values()]
      .filter((card) => card.ownerId === PLAYER1)
      .map((card) => card.instanceId);
    const umiCardId = ownedP1CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardCode === 'PL!-sd1-004-SD'
    );
    const liveCardIds = ownedP1CardIds.filter(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardType === CardType.LIVE
    );
    const liveCardId = liveCardIds[0];
    const nonMuseLiveCardId = liveCardIds[1];
    const energyCardIds = ownedP1CardIds.filter(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardType === CardType.ENERGY
    );
    const otherMemberCardIds = ownedP1CardIds.filter(
      (cardId) =>
        cardId !== umiCardId && state.cardRegistry.get(cardId)?.data.cardType === CardType.MEMBER
    );

    expect(umiCardId).toBeTruthy();
    expect(liveCardId).toBeTruthy();
    expect(nonMuseLiveCardId).toBeTruthy();
    expect(energyCardIds.length).toBeGreaterThanOrEqual(11);
    expect(otherMemberCardIds.length).toBeGreaterThanOrEqual(3);

    const nonMuseLiveCard = state.cardRegistry.get(nonMuseLiveCardId!) as unknown as {
      data: LiveCardData;
    };
    nonMuseLiveCard.data = {
      ...nonMuseLiveCard.data,
      cardCode: 'OTHER-LIVE-0',
      groupName: 'Other',
    };

    const inspectedCardIds = [
      otherMemberCardIds[0],
      nonMuseLiveCardId!,
      liveCardId!,
      otherMemberCardIds[1],
      otherMemberCardIds[2],
    ];

    removeFromPlayerZones(p1);
    setActiveEnergy(p1, energyCardIds.slice(0, 11));
    p1.hand.cardIds = [umiCardId!];
    p1.mainDeck.cardIds = [...inspectedCardIds];
    p1.memberSlots.slots[SlotPosition.CENTER] = null;

    const playResult = session.executeCommand(
      createPlayMemberToSlotCommand(PLAYER1, umiCardId!, SlotPosition.CENTER)
    );

    const activeEffect = session.state?.activeEffect;
    expect(playResult.success).toBe(true);
    expect(session.state?.inspectionZone.cardIds).toEqual(inspectedCardIds);
    expect(session.state?.inspectionZone.revealedCardIds).toEqual([]);
    expect(activeEffect?.abilityId).toBe(UMI_ON_ENTER_ABILITY_ID);
    expect(activeEffect?.selectableCardIds).toEqual([liveCardId]);
    expect(activeEffect?.canSkipSelection).toBe(true);

    const confirmResult = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, activeEffect!.id, liveCardId)
    );

    expect(confirmResult.success).toBe(true);
    expect(session.state?.activeEffect).not.toBeNull();
    expect(session.state?.inspectionZone.cardIds).toEqual(inspectedCardIds);
    expect(session.state?.inspectionZone.revealedCardIds).toEqual([liveCardId]);
    expect(session.state?.players[0].hand.cardIds).toEqual([]);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([]);

    const finishResult = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id)
    );

    expect(finishResult.success).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.inspectionContext).toBeNull();
    expect(session.state?.inspectionZone.cardIds).toEqual([]);
    expect(session.state?.inspectionZone.revealedCardIds).toEqual([]);
    expect(session.state?.players[0].hand.cardIds).toEqual([liveCardId]);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual(
      inspectedCardIds.filter((cardId) => cardId !== liveCardId)
    );
    expect(
      session.state?.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId === UMI_ON_ENTER_ABILITY_ID &&
          action.payload.step === 'FINISH' &&
          action.payload.selectedCardId === liveCardId
      )
    ).toBe(true);
  });

  it('uses the generic waiting-room-to-hand selection after PL!-sd1-002-SD self-sacrifice cost', () => {
    const session = createGameSession();
    const deck = createDeck();

    session.createGame('sample-zone-selection-eli', PLAYER1, 'Player 1', PLAYER2, 'Player 2');
    session.initializeGame(deck, deck);
    forceMainPhaseForPlayer(session);

    const state = session.state!;
    const p1 = state.players[0] as unknown as {
      hand: { cardIds: string[] };
      mainDeck: { cardIds: string[] };
      waitingRoom: { cardIds: string[] };
      successZone: { cardIds: string[] };
      liveZone: { cardIds: string[] };
      energyZone: {
        cardIds: string[];
        cardStates: Map<string, { orientation: OrientationState; face: FaceState }>;
      };
      memberSlots: {
        slots: Record<SlotPosition, string | null>;
        cardStates: Map<string, { orientation: OrientationState; face: FaceState }>;
      };
    };

    const ownedP1CardIds = [...state.cardRegistry.values()]
      .filter((card) => card.ownerId === PLAYER1)
      .map((card) => card.instanceId);
    const eliCardId = ownedP1CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardType === CardType.MEMBER
    );
    const targetMemberCardId = ownedP1CardIds.find(
      (cardId) =>
        cardId !== eliCardId && state.cardRegistry.get(cardId)?.data.cardType === CardType.MEMBER
    );

    expect(eliCardId).toBeTruthy();
    expect(targetMemberCardId).toBeTruthy();

    const eliCard = state.cardRegistry.get(eliCardId!) as unknown as { data: MemberCardData };
    eliCard.data = createMemberCard('PL!-sd1-002-SD', '絢瀬 絵里', 2);

    removeFromPlayerZones(p1);
    p1.memberSlots.slots[SlotPosition.CENTER] = eliCardId!;
    p1.memberSlots.cardStates = new Map([
      [eliCardId!, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
    ]);
    p1.waitingRoom.cardIds = [targetMemberCardId!];

    const activateResult = session.executeCommand(
      createActivateAbilityCommand(PLAYER1, eliCardId!, ELI_ACTIVATED_ABILITY_ID)
    );

    expect(activateResult.success).toBe(true);
    expect(session.state?.activeEffect?.abilityId).toBe(ELI_ACTIVATED_ABILITY_ID);
    expect(session.state?.activeEffect?.metadata?.zoneSelection).toEqual({
      source: 'WAITING_ROOM',
      destination: 'HAND',
      minCount: 0,
      maxCount: 1,
      optional: true,
    });
    expect(session.state?.players[0].waitingRoom.cardIds).toContain(eliCardId);
    expect(session.state?.activeEffect?.selectableCardIds).toContain(targetMemberCardId);

    const confirmResult = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id, targetMemberCardId)
    );

    expect(confirmResult.success).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].hand.cardIds).toEqual([targetMemberCardId]);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([eliCardId]);
  });

  it('executes PL!-sd1-001-SD on-enter recovery of a Live from waiting room when two success Lives exist', () => {
    const session = createGameSession();
    const deck = createDeck();

    session.createGame(
      'sample-honoka-waiting-room-live-recovery',
      PLAYER1,
      'Player 1',
      PLAYER2,
      'Player 2'
    );
    session.initializeGame(deck, deck);
    forceMainPhaseForPlayer(session);

    const state = session.state!;
    const p1 = state.players[0] as unknown as {
      hand: { cardIds: string[] };
      mainDeck: { cardIds: string[] };
      waitingRoom: { cardIds: string[] };
      successZone: { cardIds: string[] };
      liveZone: { cardIds: string[] };
      energyZone: {
        cardIds: string[];
        cardStates: Map<string, { orientation: OrientationState; face: FaceState }>;
      };
      memberSlots: { slots: Record<SlotPosition, string | null> };
    };

    const ownedP1CardIds = [...state.cardRegistry.values()]
      .filter((card) => card.ownerId === PLAYER1)
      .map((card) => card.instanceId);
    const honokaCardId = ownedP1CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardType === CardType.MEMBER
    );
    const liveCardIds = ownedP1CardIds.filter(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardType === CardType.LIVE
    );
    const nonLiveWaitingRoomCardId = ownedP1CardIds.find(
      (cardId) =>
        cardId !== honokaCardId && state.cardRegistry.get(cardId)?.data.cardType === CardType.MEMBER
    );

    expect(honokaCardId).toBeTruthy();
    expect(liveCardIds.length).toBeGreaterThanOrEqual(3);
    expect(nonLiveWaitingRoomCardId).toBeTruthy();

    const honokaCard = state.cardRegistry.get(honokaCardId!) as unknown as { data: MemberCardData };
    honokaCard.data = createMemberCard('PL!-sd1-001-SD', '高坂 穂乃果', 0);

    const targetLiveCardId = liveCardIds[0];
    const successLiveCardIds = liveCardIds.slice(1, 3);
    const deckFillerCardId = ownedP1CardIds.find(
      (cardId) =>
        cardId !== honokaCardId &&
        cardId !== targetLiveCardId &&
        !successLiveCardIds.includes(cardId) &&
        cardId !== nonLiveWaitingRoomCardId &&
        state.cardRegistry.get(cardId)?.data.cardType === CardType.MEMBER
    );
    const targetLiveCard = state.cardRegistry.get(targetLiveCardId) as unknown as {
      data: LiveCardData;
    };
    expect(deckFillerCardId).toBeTruthy();
    targetLiveCard.data = createLiveCard('PL!-sd1-target-live', 'Target Live');

    removeFromPlayerZones(p1);
    p1.mainDeck.cardIds = [deckFillerCardId!];
    p1.hand.cardIds = [honokaCardId!];
    p1.successZone.cardIds = successLiveCardIds;
    p1.waitingRoom.cardIds = [targetLiveCardId, nonLiveWaitingRoomCardId!];
    p1.memberSlots.slots[SlotPosition.CENTER] = null;

    const playResult = session.executeCommand(
      createPlayMemberToSlotCommand(PLAYER1, honokaCardId!, SlotPosition.CENTER)
    );

    expect(playResult.success).toBe(true);
    expect(session.state?.activeEffect?.abilityId).toBe(HONOKA_ON_ENTER_ABILITY_ID);
    expect(session.state?.activeEffect?.metadata?.zoneSelection).toEqual({
      source: 'WAITING_ROOM',
      destination: 'HAND',
      minCount: 0,
      maxCount: 1,
      optional: true,
    });
    expect(session.state?.activeEffect?.selectableCardIds).toEqual([targetLiveCardId]);

    const confirmResult = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id, targetLiveCardId)
    );

    expect(confirmResult.success).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].hand.cardIds).toEqual([targetLiveCardId]);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([nonLiveWaitingRoomCardId]);
    expect(session.state?.players[0].mainDeck.cardIds).toEqual([deckFillerCardId]);
    expect(session.state?.players[0].successZone.cardIds).toEqual(successLiveCardIds);
  });

  it('executes PL!-sd1-003-SD on-enter recovery of a low-cost Muse member from waiting room', () => {
    const session = createGameSession();
    const deck = createDeck();

    session.createGame(
      'sample-kotori-waiting-room-member-recovery',
      PLAYER1,
      'Player 1',
      PLAYER2,
      'Player 2'
    );
    session.initializeGame(deck, deck);
    forceMainPhaseForPlayer(session);

    const state = session.state!;
    const p1 = state.players[0] as unknown as {
      hand: { cardIds: string[] };
      mainDeck: { cardIds: string[] };
      waitingRoom: { cardIds: string[] };
      successZone: { cardIds: string[] };
      liveZone: { cardIds: string[] };
      energyZone: {
        cardIds: string[];
        cardStates: Map<string, { orientation: OrientationState; face: FaceState }>;
      };
      memberSlots: { slots: Record<SlotPosition, string | null> };
    };

    const ownedP1CardIds = [...state.cardRegistry.values()]
      .filter((card) => card.ownerId === PLAYER1)
      .map((card) => card.instanceId);
    const kotoriCardId = ownedP1CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardCode === 'PL!-sd1-003-SD'
    );
    const energyCardIds = ownedP1CardIds.filter(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardType === CardType.ENERGY
    );
    const waitingRoomMemberCardIds = ownedP1CardIds.filter(
      (cardId) =>
        cardId !== kotoriCardId && state.cardRegistry.get(cardId)?.data.cardType === CardType.MEMBER
    );

    expect(kotoriCardId).toBeTruthy();
    expect(energyCardIds.length).toBeGreaterThanOrEqual(12);
    expect(waitingRoomMemberCardIds.length).toBeGreaterThanOrEqual(4);

    const targetMemberCardId = waitingRoomMemberCardIds[0];
    const highCostMuseMemberCardId = waitingRoomMemberCardIds[1];
    const nonMuseMemberCardId = waitingRoomMemberCardIds[2];
    const deckFillerCardId = waitingRoomMemberCardIds[3];
    const targetMemberCard = state.cardRegistry.get(targetMemberCardId) as unknown as {
      data: MemberCardData;
    };
    const highCostMuseMemberCard = state.cardRegistry.get(highCostMuseMemberCardId) as unknown as {
      data: MemberCardData;
    };
    const nonMuseMemberCard = state.cardRegistry.get(nonMuseMemberCardId) as unknown as {
      data: MemberCardData;
    };
    const kotoriCard = state.cardRegistry.get(kotoriCardId!) as unknown as {
      data: MemberCardData;
    };
    kotoriCard.data = createMemberCard('PL!-sd1-003-SD', '南 ことり', 1);
    targetMemberCard.data = createMemberCard('PL!-sd1-test-low-cost-muse', '低费用 μs 成员', 4);
    highCostMuseMemberCard.data = createMemberCard(
      'PL!-sd1-test-high-cost-muse',
      '高费用 μs 成员',
      5
    );
    nonMuseMemberCard.data = createMemberCard('OTHER-MEMBER-0', 'Other Member', 4);

    removeFromPlayerZones(p1);
    p1.mainDeck.cardIds = [deckFillerCardId];
    setActiveEnergy(p1, energyCardIds.slice(0, 12));
    p1.hand.cardIds = [kotoriCardId!];
    p1.waitingRoom.cardIds = [targetMemberCardId, highCostMuseMemberCardId, nonMuseMemberCardId];
    p1.memberSlots.slots[SlotPosition.CENTER] = null;

    const playResult = session.executeCommand(
      createPlayMemberToSlotCommand(PLAYER1, kotoriCardId!, SlotPosition.CENTER)
    );

    expect(playResult.success).toBe(true);
    expect(session.state?.activeEffect?.abilityId).toBe(KOTORI_ON_ENTER_ABILITY_ID);
    expect(session.state?.activeEffect?.metadata?.zoneSelection).toEqual({
      source: 'WAITING_ROOM',
      destination: 'HAND',
      minCount: 0,
      maxCount: 1,
      optional: true,
    });
    expect(session.state?.activeEffect?.selectableCardIds).toEqual([targetMemberCardId]);

    const confirmResult = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id, targetMemberCardId)
    );

    expect(confirmResult.success).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].hand.cardIds).toEqual([targetMemberCardId]);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([
      highCostMuseMemberCardId,
      nonMuseMemberCardId,
    ]);
    expect(session.state?.players[0].mainDeck.cardIds).toEqual([deckFillerCardId]);
  });

  it.each(RIN_LIKE_MEMBER_ACTIVATION_TEST_CASES)(
    'uses the generic waiting-room-to-hand selection after $cardCode self-sacrifice cost',
    ({ cardCode, name }) => {
      const session = createGameSession();
      const deck = createDeck();

      session.createGame('sample-zone-selection-rin', PLAYER1, 'Player 1', PLAYER2, 'Player 2');
      session.initializeGame(deck, deck);
      forceMainPhaseForPlayer(session);

      const state = session.state!;
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

      const ownedP1CardIds = [...state.cardRegistry.values()]
        .filter((card) => card.ownerId === PLAYER1)
        .map((card) => card.instanceId);
      const rinCardId = ownedP1CardIds.find(
        (cardId) => state.cardRegistry.get(cardId)?.data.cardType === CardType.MEMBER
      );
      const targetLiveCardId = ownedP1CardIds.find(
        (cardId) => state.cardRegistry.get(cardId)?.data.cardType === CardType.LIVE
      );
      const nonLiveWaitingRoomCardId = ownedP1CardIds.find(
        (cardId) =>
          cardId !== rinCardId && state.cardRegistry.get(cardId)?.data.cardType === CardType.MEMBER
      );

      expect(rinCardId).toBeTruthy();
      expect(targetLiveCardId).toBeTruthy();
      expect(nonLiveWaitingRoomCardId).toBeTruthy();

      const rinCard = state.cardRegistry.get(rinCardId!) as unknown as { data: MemberCardData };
      rinCard.data = createMemberCard(cardCode, name, 2);

      removeFromPlayerZones(p1);
      p1.memberSlots.slots[SlotPosition.CENTER] = rinCardId!;
      p1.memberSlots.cardStates = new Map([
        [rinCardId!, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
      ]);
      p1.waitingRoom.cardIds = [targetLiveCardId!, nonLiveWaitingRoomCardId!];

      const activateResult = session.executeCommand(
        createActivateAbilityCommand(PLAYER1, rinCardId!, RIN_ACTIVATED_ABILITY_ID)
      );

      expect(activateResult.success).toBe(true);
      expect(session.state?.activeEffect?.abilityId).toBe(RIN_ACTIVATED_ABILITY_ID);
      expect(session.state?.activeEffect?.metadata?.zoneSelection).toEqual({
        source: 'WAITING_ROOM',
        destination: 'HAND',
        minCount: 0,
        maxCount: 1,
        optional: true,
      });
      expect(session.state?.players[0].waitingRoom.cardIds).toContain(rinCardId);
      expect(session.state?.activeEffect?.selectableCardIds).toEqual([targetLiveCardId]);

      const confirmResult = session.executeCommand(
        createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id, targetLiveCardId)
      );

      expect(confirmResult.success).toBe(true);
      expect(session.state?.activeEffect).toBeNull();
      expect(session.state?.players[0].hand.cardIds).toEqual([targetLiveCardId]);
      expect(session.state?.players[0].waitingRoom.cardIds).toEqual([
        nonLiveWaitingRoomCardId,
        rinCardId,
      ]);
    }
  );

  it('executes PL!-PR-017-PR activated ability to recover a Muse Live and activate two energy at score nine', () => {
    const session = createGameSession();
    const deck = createDeck();

    session.createGame('sample-pr-017-activated-recover-live-energy', PLAYER1, 'Player 1', PLAYER2, 'Player 2');
    session.initializeGame(deck, deck);
    forceMainPhaseForPlayer(session);

    const state = session.state!;
    const p1 = state.players[0] as unknown as {
      hand: { cardIds: string[] };
      mainDeck: { cardIds: string[] };
      waitingRoom: { cardIds: string[] };
      successZone: { cardIds: string[] };
      liveZone: { cardIds: string[] };
      energyZone: {
        cardIds: string[];
        cardStates: Map<string, { orientation: OrientationState; face: FaceState }>;
      };
      memberSlots: {
        slots: Record<SlotPosition, string | null>;
        cardStates: Map<string, { orientation: OrientationState; face: FaceState }>;
      };
    };

    const ownedP1CardIds = [...state.cardRegistry.values()]
      .filter((card) => card.ownerId === PLAYER1)
      .map((card) => card.instanceId);
    const nicoCardId = ownedP1CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardType === CardType.MEMBER
    );
    const successScore6LiveId = ownedP1CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardCode === 'LIVE-SCORE-6'
    );
    const targetMuseLiveId = ownedP1CardIds.find(
      (cardId) =>
        cardId !== successScore6LiveId &&
        state.cardRegistry.get(cardId)?.data.cardType === CardType.LIVE
    );
    const nonMuseLiveId = ownedP1CardIds.find(
      (cardId) =>
        cardId !== targetMuseLiveId &&
        cardId !== successScore6LiveId &&
        state.cardRegistry.get(cardId)?.data.cardType === CardType.LIVE
    );
    const successScore3LiveId = ownedP1CardIds.find(
      (cardId) =>
        cardId !== targetMuseLiveId &&
        cardId !== nonMuseLiveId &&
        cardId !== successScore6LiveId &&
        state.cardRegistry.get(cardId)?.data.cardType === CardType.LIVE
    );
    const energyCardIds = [...state.cardRegistry.values()]
      .filter((card) => card.ownerId === PLAYER1 && card.data.cardType === CardType.ENERGY)
      .map((card) => card.instanceId);

    expect(nicoCardId).toBeTruthy();
    expect(targetMuseLiveId).toBeTruthy();
    expect(nonMuseLiveId).toBeTruthy();
    expect(successScore6LiveId).toBeTruthy();
    expect(successScore3LiveId).toBeTruthy();
    expect(energyCardIds.length).toBeGreaterThanOrEqual(3);

    const nicoCard = state.cardRegistry.get(nicoCardId!) as unknown as { data: MemberCardData };
    const targetMuseLive = state.cardRegistry.get(targetMuseLiveId!) as unknown as {
      data: LiveCardData;
    };
    const nonMuseLive = state.cardRegistry.get(nonMuseLiveId!) as unknown as {
      data: LiveCardData;
    };
    const successScore3Live = state.cardRegistry.get(successScore3LiveId!) as unknown as {
      data: LiveCardData;
    };
    nicoCard.data = createMemberCard('PL!-PR-017-PR', '矢澤 にこ', 2);
    targetMuseLive.data = createLiveCard('PR-017-MUSE-LIVE', 'μs target Live');
    nonMuseLive.data = createLiveCard('PR-017-NON-MUSE-LIVE', 'Non Muse Live', '虹咲');
    successScore3Live.data = createLiveCard('PR-017-SUCCESS-THREE', 'Success Three');

    removeFromPlayerZones(p1);
    p1.memberSlots.slots[SlotPosition.CENTER] = nicoCardId!;
    p1.memberSlots.cardStates = new Map([
      [nicoCardId!, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
    ]);
    p1.waitingRoom.cardIds = [targetMuseLiveId!, nonMuseLiveId!];
    p1.successZone.cardIds = [successScore6LiveId!, successScore3LiveId!];
    setEnergyZoneCards(p1, [
      { cardId: energyCardIds[0], orientation: OrientationState.WAITING },
      { cardId: energyCardIds[1], orientation: OrientationState.WAITING },
      { cardId: energyCardIds[2], orientation: OrientationState.ACTIVE },
    ]);

    const activateResult = session.executeCommand(
      createActivateAbilityCommand(
        PLAYER1,
        nicoCardId!,
        PR_017_ACTIVATED_RECOVER_MUSE_LIVE_ACTIVATE_ENERGY_ABILITY_ID
      )
    );

    expect(activateResult.success).toBe(true);
    expect(session.state?.activeEffect?.abilityId).toBe(
      PR_017_ACTIVATED_RECOVER_MUSE_LIVE_ACTIVATE_ENERGY_ABILITY_ID
    );
    expect(session.state?.activeEffect?.selectableCardIds).toEqual([targetMuseLiveId]);
    expect(session.state?.activeEffect?.canSkipSelection).toBe(false);
    expect(session.state?.activeEffect?.metadata?.zoneSelection).toEqual({
      source: 'WAITING_ROOM',
      destination: 'HAND',
      minCount: 1,
      maxCount: 1,
      optional: false,
    });

    const activeEffectId = session.state!.activeEffect!.id;
    const skipResult = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, activeEffectId)
    );

    expect(skipResult.success).toBe(false);
    expect(session.state?.activeEffect?.id).toBe(activeEffectId);
    expect(session.state?.players[0].hand.cardIds).toEqual([]);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([
      targetMuseLiveId,
      nonMuseLiveId,
      nicoCardId,
    ]);
    expect(session.state?.players[0].energyZone.cardStates.get(energyCardIds[0])?.orientation).toBe(
      OrientationState.WAITING
    );
    expect(session.state?.players[0].energyZone.cardStates.get(energyCardIds[1])?.orientation).toBe(
      OrientationState.WAITING
    );

    const confirmResult = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, activeEffectId, targetMuseLiveId)
    );

    expect(confirmResult.success).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].hand.cardIds).toEqual([targetMuseLiveId]);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([nonMuseLiveId, nicoCardId]);
    expect(session.state?.players[0].energyZone.cardStates.get(energyCardIds[0])?.orientation).toBe(
      OrientationState.ACTIVE
    );
    expect(session.state?.players[0].energyZone.cardStates.get(energyCardIds[1])?.orientation).toBe(
      OrientationState.ACTIVE
    );
    expect(
      session.state?.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId ===
            PR_017_ACTIVATED_RECOVER_MUSE_LIVE_ACTIVATE_ENERGY_ABILITY_ID &&
          action.payload.conditionMet === true &&
          Array.isArray(action.payload.activatedEnergyCardIds) &&
          action.payload.activatedEnergyCardIds[0] === energyCardIds[0] &&
          action.payload.activatedEnergyCardIds[1] === energyCardIds[1]
      )
    ).toBe(true);
  });

  it('allows PL!-PR-017-PR activated ability to finish with no Muse Live target and still activate energy when score is nine', () => {
    const session = createGameSession();
    const deck = createDeck();

    session.createGame('sample-pr-017-activated-no-target-energy', PLAYER1, 'Player 1', PLAYER2, 'Player 2');
    session.initializeGame(deck, deck);
    forceMainPhaseForPlayer(session);

    const state = session.state!;
    const p1 = state.players[0] as unknown as {
      hand: { cardIds: string[] };
      mainDeck: { cardIds: string[] };
      waitingRoom: { cardIds: string[] };
      successZone: { cardIds: string[] };
      liveZone: { cardIds: string[] };
      energyZone: {
        cardIds: string[];
        cardStates: Map<string, { orientation: OrientationState; face: FaceState }>;
      };
      memberSlots: {
        slots: Record<SlotPosition, string | null>;
        cardStates: Map<string, { orientation: OrientationState; face: FaceState }>;
      };
    };

    const ownedP1CardIds = [...state.cardRegistry.values()]
      .filter((card) => card.ownerId === PLAYER1)
      .map((card) => card.instanceId);
    const nicoCardId = ownedP1CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardType === CardType.MEMBER
    );
    const successScore6LiveId = ownedP1CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardCode === 'LIVE-SCORE-6'
    );
    const nonMuseLiveId = ownedP1CardIds.find(
      (cardId) =>
        cardId !== successScore6LiveId &&
        state.cardRegistry.get(cardId)?.data.cardType === CardType.LIVE
    );
    const successScore3LiveId = ownedP1CardIds.find(
      (cardId) =>
        cardId !== nonMuseLiveId &&
        cardId !== successScore6LiveId &&
        state.cardRegistry.get(cardId)?.data.cardType === CardType.LIVE
    );
    const energyCardIds = [...state.cardRegistry.values()]
      .filter((card) => card.ownerId === PLAYER1 && card.data.cardType === CardType.ENERGY)
      .map((card) => card.instanceId);

    expect(nicoCardId).toBeTruthy();
    expect(nonMuseLiveId).toBeTruthy();
    expect(successScore6LiveId).toBeTruthy();
    expect(successScore3LiveId).toBeTruthy();
    expect(energyCardIds.length).toBeGreaterThanOrEqual(2);

    const nicoCard = state.cardRegistry.get(nicoCardId!) as unknown as { data: MemberCardData };
    const nonMuseLive = state.cardRegistry.get(nonMuseLiveId!) as unknown as {
      data: LiveCardData;
    };
    const successScore3Live = state.cardRegistry.get(successScore3LiveId!) as unknown as {
      data: LiveCardData;
    };
    nicoCard.data = createMemberCard('PL!-PR-017-PR', '矢澤 にこ', 2);
    nonMuseLive.data = createLiveCard('PR-017-NON-MUSE-LIVE', 'Non Muse Live', '虹咲');
    successScore3Live.data = createLiveCard('PR-017-SUCCESS-THREE', 'Success Three');

    removeFromPlayerZones(p1);
    p1.memberSlots.slots[SlotPosition.CENTER] = nicoCardId!;
    p1.memberSlots.cardStates = new Map([
      [nicoCardId!, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
    ]);
    p1.waitingRoom.cardIds = [nonMuseLiveId!];
    p1.successZone.cardIds = [successScore6LiveId!, successScore3LiveId!];
    setEnergyZoneCards(p1, [
      { cardId: energyCardIds[0], orientation: OrientationState.WAITING },
      { cardId: energyCardIds[1], orientation: OrientationState.WAITING },
    ]);

    const activateResult = session.executeCommand(
      createActivateAbilityCommand(
        PLAYER1,
        nicoCardId!,
        PR_017_ACTIVATED_RECOVER_MUSE_LIVE_ACTIVATE_ENERGY_ABILITY_ID
      )
    );

    expect(activateResult.success).toBe(true);
    expect(session.state?.activeEffect?.selectableCardIds).toEqual([]);
    expect(session.state?.activeEffect?.canSkipSelection).toBe(true);
    expect(session.state?.activeEffect?.metadata?.zoneSelection).toEqual({
      source: 'WAITING_ROOM',
      destination: 'HAND',
      minCount: 0,
      maxCount: 1,
      optional: true,
    });

    const confirmResult = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id)
    );

    expect(confirmResult.success).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].hand.cardIds).toEqual([]);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([nonMuseLiveId, nicoCardId]);
    expect(session.state?.players[0].energyZone.cardStates.get(energyCardIds[0])?.orientation).toBe(
      OrientationState.ACTIVE
    );
    expect(session.state?.players[0].energyZone.cardStates.get(energyCardIds[1])?.orientation).toBe(
      OrientationState.ACTIVE
    );
  });

  it('does not activate PL!-bp4-002-SEC activated ability when successful Live score is below six', () => {
    const session = createGameSession();
    const deck = createDeck();

    session.createGame('sample-bp4-002-activated-condition-not-met', PLAYER1, 'Player 1', PLAYER2, 'Player 2');
    session.initializeGame(deck, deck);
    forceMainPhaseForPlayer(session);

    const state = session.state!;
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
    const ownedP1CardIds = [...state.cardRegistry.values()]
      .filter((card) => card.ownerId === PLAYER1)
      .map((card) => card.instanceId);
    const eliCardId = ownedP1CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardType === CardType.MEMBER
    );
    const handCostCardIds = ownedP1CardIds
      .filter(
        (cardId) =>
          cardId !== eliCardId && state.cardRegistry.get(cardId)?.data.cardType === CardType.MEMBER
      )
      .slice(0, 2);
    const targetMuseLiveId = ownedP1CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardType === CardType.LIVE
    );
    const successScore3LiveId = ownedP1CardIds.find(
      (cardId) =>
        cardId !== targetMuseLiveId && state.cardRegistry.get(cardId)?.data.cardType === CardType.LIVE
    );

    expect(eliCardId).toBeTruthy();
    expect(handCostCardIds).toHaveLength(2);
    expect(targetMuseLiveId).toBeTruthy();
    expect(successScore3LiveId).toBeTruthy();

    const eliCard = state.cardRegistry.get(eliCardId!) as unknown as { data: MemberCardData };
    const successScore3Live = state.cardRegistry.get(successScore3LiveId!) as unknown as {
      data: LiveCardData;
    };
    eliCard.data = createMemberCard('PL!-bp4-002-SEC', '絢瀬絵里', 15);
    successScore3Live.data = createLiveCard('BP4-002-SUCCESS-THREE', 'Success Three');

    removeFromPlayerZones(p1);
    p1.memberSlots.slots[SlotPosition.CENTER] = eliCardId!;
    p1.memberSlots.cardStates = new Map([
      [eliCardId!, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
    ]);
    p1.hand.cardIds = [...handCostCardIds];
    p1.waitingRoom.cardIds = [targetMuseLiveId!];
    p1.successZone.cardIds = [successScore3LiveId!];

    const activateResult = session.executeCommand(
      createActivateAbilityCommand(
        PLAYER1,
        eliCardId!,
        BP4_002_ACTIVATED_DISCARD_RECOVER_MUSE_LIVE_ABILITY_ID
      )
    );

    expect(activateResult.success).toBe(false);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].hand.cardIds).toEqual(handCostCardIds);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([targetMuseLiveId]);
  });

  it('executes PL!-bp4-002-SEC activated ability by discarding two and requiring a Muse Live recovery target', () => {
    const session = createGameSession();
    const deck = createDeck();

    session.createGame('sample-bp4-002-activated-discard-recover-live', PLAYER1, 'Player 1', PLAYER2, 'Player 2');
    session.initializeGame(deck, deck);
    forceMainPhaseForPlayer(session);

    const state = session.state!;
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
    const ownedP1CardIds = [...state.cardRegistry.values()]
      .filter((card) => card.ownerId === PLAYER1)
      .map((card) => card.instanceId);
    const eliCardId = ownedP1CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardType === CardType.MEMBER
    );
    const handAndRetryCardIds = ownedP1CardIds
      .filter(
        (cardId) =>
          cardId !== eliCardId && state.cardRegistry.get(cardId)?.data.cardType === CardType.MEMBER
      )
      .slice(0, 4);
    const targetMuseLiveId = ownedP1CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardType === CardType.LIVE
    );
    const nonMuseLiveId = ownedP1CardIds.find(
      (cardId) =>
        cardId !== targetMuseLiveId &&
        state.cardRegistry.get(cardId)?.data.cardType === CardType.LIVE
    );
    const successScore6LiveId = ownedP1CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardCode === 'LIVE-SCORE-6'
    );

    expect(eliCardId).toBeTruthy();
    expect(handAndRetryCardIds.length).toBeGreaterThanOrEqual(4);
    expect(targetMuseLiveId).toBeTruthy();
    expect(nonMuseLiveId).toBeTruthy();
    expect(successScore6LiveId).toBeTruthy();

    const eliCard = state.cardRegistry.get(eliCardId!) as unknown as { data: MemberCardData };
    const targetMuseLive = state.cardRegistry.get(targetMuseLiveId!) as unknown as {
      data: LiveCardData;
    };
    const nonMuseLive = state.cardRegistry.get(nonMuseLiveId!) as unknown as {
      data: LiveCardData;
    };
    eliCard.data = createMemberCard('PL!-bp4-002-SEC', '絢瀬絵里', 15);
    targetMuseLive.data = createLiveCard('BP4-002-MUSE-LIVE', 'Muse Live');
    nonMuseLive.data = createLiveCard('BP4-002-NON-MUSE-LIVE', 'Non Muse Live', '虹咲');

    const discardCardIds = handAndRetryCardIds.slice(0, 2);
    const retryHandCardIds = handAndRetryCardIds.slice(2, 4);
    removeFromPlayerZones(p1);
    p1.memberSlots.slots[SlotPosition.CENTER] = eliCardId!;
    p1.memberSlots.cardStates = new Map([
      [eliCardId!, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
    ]);
    p1.hand.cardIds = [...discardCardIds];
    p1.waitingRoom.cardIds = [targetMuseLiveId!, nonMuseLiveId!];
    p1.successZone.cardIds = [successScore6LiveId!];

    const activateResult = session.executeCommand(
      createActivateAbilityCommand(
        PLAYER1,
        eliCardId!,
        BP4_002_ACTIVATED_DISCARD_RECOVER_MUSE_LIVE_ABILITY_ID
      )
    );

    expect(activateResult.success).toBe(true);
    expect(session.state?.activeEffect?.abilityId).toBe(
      BP4_002_ACTIVATED_DISCARD_RECOVER_MUSE_LIVE_ABILITY_ID
    );
    expect(session.state?.activeEffect?.selectableCardMode).toBe('ORDERED_MULTI');
    expect(session.state?.activeEffect?.minSelectableCards).toBe(2);
    expect(session.state?.activeEffect?.maxSelectableCards).toBe(2);
    expect(session.state?.activeEffect?.canSkipSelection).toBe(false);

    const activeEffectId = session.state!.activeEffect!.id;
    const discardResult = session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        activeEffectId,
        undefined,
        undefined,
        undefined,
        undefined,
        discardCardIds
      )
    );

    expect(discardResult.success).toBe(true);
    expect(session.state?.players[0].hand.cardIds).toEqual([]);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([
      targetMuseLiveId,
      nonMuseLiveId,
      ...discardCardIds,
    ]);
    expect(session.state?.activeEffect?.id).toBe(activeEffectId);
    expect(session.state?.activeEffect?.selectableCardIds).toEqual([targetMuseLiveId]);
    expect(session.state?.activeEffect?.canSkipSelection).toBe(false);
    expect(session.state?.activeEffect?.metadata?.zoneSelection).toEqual({
      source: 'WAITING_ROOM',
      destination: 'HAND',
      minCount: 1,
      maxCount: 1,
      optional: false,
    });

    const skipRecoveryResult = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, activeEffectId)
    );

    expect(skipRecoveryResult.success).toBe(false);
    expect(session.state?.activeEffect?.id).toBe(activeEffectId);
    expect(session.state?.players[0].hand.cardIds).toEqual([]);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([
      targetMuseLiveId,
      nonMuseLiveId,
      ...discardCardIds,
    ]);

    const recoverResult = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, activeEffectId, targetMuseLiveId)
    );

    expect(recoverResult.success).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].hand.cardIds).toEqual([targetMuseLiveId]);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([
      nonMuseLiveId,
      ...discardCardIds,
    ]);

    (session.state!.players[0] as unknown as { hand: { cardIds: string[] } }).hand.cardIds = [
      ...retryHandCardIds,
    ];
    const secondActivateResult = session.executeCommand(
      createActivateAbilityCommand(
        PLAYER1,
        eliCardId!,
        BP4_002_ACTIVATED_DISCARD_RECOVER_MUSE_LIVE_ABILITY_ID
      )
    );

    expect(secondActivateResult.success).toBe(false);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].hand.cardIds).toEqual(retryHandCardIds);
  });

  it('allows PL!-bp4-002-SEC activated ability to finish after discarding when no Muse Live target exists', () => {
    const session = createGameSession();
    const deck = createDeck();

    session.createGame('sample-bp4-002-activated-no-target-after-discard', PLAYER1, 'Player 1', PLAYER2, 'Player 2');
    session.initializeGame(deck, deck);
    forceMainPhaseForPlayer(session);

    const state = session.state!;
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
    const ownedP1CardIds = [...state.cardRegistry.values()]
      .filter((card) => card.ownerId === PLAYER1)
      .map((card) => card.instanceId);
    const eliCardId = ownedP1CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardType === CardType.MEMBER
    );
    const discardCardIds = ownedP1CardIds
      .filter(
        (cardId) =>
          cardId !== eliCardId && state.cardRegistry.get(cardId)?.data.cardType === CardType.MEMBER
      )
      .slice(0, 2);
    const nonMuseLiveId = ownedP1CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardType === CardType.LIVE
    );
    const successScore6LiveId = ownedP1CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardCode === 'LIVE-SCORE-6'
    );

    expect(eliCardId).toBeTruthy();
    expect(discardCardIds).toHaveLength(2);
    expect(nonMuseLiveId).toBeTruthy();
    expect(successScore6LiveId).toBeTruthy();

    const eliCard = state.cardRegistry.get(eliCardId!) as unknown as { data: MemberCardData };
    const nonMuseLive = state.cardRegistry.get(nonMuseLiveId!) as unknown as {
      data: LiveCardData;
    };
    eliCard.data = createMemberCard('PL!-bp4-002-SEC', '絢瀬絵里', 15);
    nonMuseLive.data = createLiveCard('BP4-002-NON-MUSE-LIVE', 'Non Muse Live', '虹咲');

    removeFromPlayerZones(p1);
    p1.memberSlots.slots[SlotPosition.CENTER] = eliCardId!;
    p1.memberSlots.cardStates = new Map([
      [eliCardId!, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
    ]);
    p1.hand.cardIds = [...discardCardIds];
    p1.waitingRoom.cardIds = [nonMuseLiveId!];
    p1.successZone.cardIds = [successScore6LiveId!];

    const activateResult = session.executeCommand(
      createActivateAbilityCommand(
        PLAYER1,
        eliCardId!,
        BP4_002_ACTIVATED_DISCARD_RECOVER_MUSE_LIVE_ABILITY_ID
      )
    );
    expect(activateResult.success).toBe(true);

    const activeEffectId = session.state!.activeEffect!.id;
    const discardResult = session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        activeEffectId,
        undefined,
        undefined,
        undefined,
        undefined,
        discardCardIds
      )
    );

    expect(discardResult.success).toBe(true);
    expect(session.state?.activeEffect?.selectableCardIds).toEqual([]);
    expect(session.state?.activeEffect?.canSkipSelection).toBe(true);
    expect(session.state?.activeEffect?.metadata?.zoneSelection).toEqual({
      source: 'WAITING_ROOM',
      destination: 'HAND',
      minCount: 0,
      maxCount: 1,
      optional: true,
    });

    const finishResult = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, activeEffectId)
    );

    expect(finishResult.success).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].hand.cardIds).toEqual([]);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([
      nonMuseLiveId,
      ...discardCardIds,
    ]);
  });

  it("executes PL!-bp5-003-AR activated ability with μ's discard branch looking top four and taking two", () => {
    const session = createGameSession();
    const deck = createDeck();

    session.createGame('sample-bp5-003-activated-muse-branch', PLAYER1, 'Player 1', PLAYER2, 'Player 2');
    session.initializeGame(deck, deck);
    forceMainPhaseForPlayer(session);

    const state = session.state!;
    const p1 = state.players[0] as unknown as {
      hand: { cardIds: string[] };
      mainDeck: { cardIds: string[] };
      waitingRoom: { cardIds: string[] };
      successZone: { cardIds: string[] };
      liveZone: { cardIds: string[] };
      energyZone: {
        cardIds: string[];
        cardStates: Map<string, { orientation: OrientationState; face: FaceState }>;
      };
      memberSlots: {
        slots: Record<SlotPosition, string | null>;
        cardStates: Map<string, { orientation: OrientationState; face: FaceState }>;
      };
    };
    const ownedP1CardIds = [...state.cardRegistry.values()]
      .filter((card) => card.ownerId === PLAYER1)
      .map((card) => card.instanceId);
    const sourceCardId = ownedP1CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardType === CardType.MEMBER
    );
    const memberCardIds = ownedP1CardIds.filter(
      (cardId) =>
        cardId !== sourceCardId &&
        state.cardRegistry.get(cardId)?.data.cardType === CardType.MEMBER
    );
    const energyCardIds = ownedP1CardIds.filter(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardType === CardType.ENERGY
    );
    const discardCardId = memberCardIds[0];
    const topCardIds = memberCardIds.slice(1, 5);
    const retryCardId = memberCardIds[5];

    expect(sourceCardId).toBeTruthy();
    expect(discardCardId).toBeTruthy();
    expect(topCardIds).toHaveLength(4);
    expect(retryCardId).toBeTruthy();
    expect(energyCardIds.length).toBeGreaterThanOrEqual(15);

    const sourceCard = state.cardRegistry.get(sourceCardId!) as unknown as { data: MemberCardData };
    const discardCard = state.cardRegistry.get(discardCardId!) as unknown as {
      data: MemberCardData;
    };
    sourceCard.data = createMemberCard('PL!-bp5-003-AR', '南ことり', 11);
    discardCard.data = createMemberCard('PL!-BP5-003-MUSE-DISCARD', '高坂穂乃果', 4, "μ's");

    removeFromPlayerZones(p1);
    p1.memberSlots.slots[SlotPosition.CENTER] = sourceCardId!;
    p1.memberSlots.cardStates = new Map([
      [sourceCardId!, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
    ]);
    p1.hand.cardIds = [discardCardId!];
    p1.mainDeck.cardIds = [...topCardIds, retryCardId!];
    p1.waitingRoom.cardIds = [];
    setActiveEnergy(p1, energyCardIds.slice(0, 15));
    (session as unknown as { authorityState: GameState }).authorityState = state;

    const activateResult = session.executeCommand(
      createActivateAbilityCommand(
        PLAYER1,
        sourceCardId!,
        BP5_003_ACTIVATED_ENERGY_DISCARD_BRANCH_ABILITY_ID
      )
    );

    expect(activateResult.success).toBe(true);
    expect(session.state?.activeEffect?.abilityId).toBe(
      BP5_003_ACTIVATED_ENERGY_DISCARD_BRANCH_ABILITY_ID
    );
    expect(session.state?.activeEffect?.selectableCardIds).toEqual([discardCardId]);
    expect(session.state?.activeEffect?.canSkipSelection).toBe(false);

    const discardStepId = session.state!.activeEffect!.id;
    const discardResult = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, discardStepId, discardCardId)
    );

    expect(discardResult.success).toBe(true);
    expect(session.state?.players[0].hand.cardIds).toEqual([]);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([discardCardId]);
    expect(session.state?.players[0].energyZone.cardStates.get(energyCardIds[0])?.orientation).toBe(
      OrientationState.WAITING
    );
    expect(session.state?.players[0].energyZone.cardStates.get(energyCardIds[1])?.orientation).toBe(
      OrientationState.WAITING
    );
    expect(session.state?.activeEffect?.inspectionCardIds).toEqual(topCardIds);
    expect(session.state?.activeEffect?.selectableCardMode).toBe('ORDERED_MULTI');
    expect(session.state?.activeEffect?.minSelectableCards).toBe(2);
    expect(session.state?.activeEffect?.maxSelectableCards).toBe(2);

    const topSelectionResult = session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        discardStepId,
        undefined,
        undefined,
        undefined,
        undefined,
        [topCardIds[1]!, topCardIds[3]!]
      )
    );

    expect(topSelectionResult.success).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].hand.cardIds).toEqual([topCardIds[1], topCardIds[3]]);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([
      discardCardId,
      topCardIds[0],
      topCardIds[2],
    ]);
    expect(session.state?.players[0].mainDeck.cardIds).toEqual([retryCardId]);

    (session.state!.players[0] as unknown as { hand: { cardIds: string[] } }).hand.cardIds = [
      retryCardId!,
    ];
    const secondActivateResult = session.executeCommand(
      createActivateAbilityCommand(
        PLAYER1,
        sourceCardId!,
        BP5_003_ACTIVATED_ENERGY_DISCARD_BRANCH_ABILITY_ID
      )
    );

    expect(secondActivateResult.success).toBe(false);
    expect(session.state?.activeEffect).toBeNull();
  });

  it("finishes PL!-bp5-003-AR μ's discard branch when no top cards can be inspected", () => {
    const session = createGameSession();
    const deck = createDeck();

    session.createGame(
      'sample-bp5-003-activated-muse-branch-empty-deck',
      PLAYER1,
      'Player 1',
      PLAYER2,
      'Player 2'
    );
    session.initializeGame(deck, deck);
    forceMainPhaseForPlayer(session);

    const state = session.state!;
    const p1 = state.players[0] as unknown as {
      hand: { cardIds: string[] };
      mainDeck: { cardIds: string[] };
      waitingRoom: { cardIds: string[] };
      successZone: { cardIds: string[] };
      liveZone: { cardIds: string[] };
      energyZone: {
        cardIds: string[];
        cardStates: Map<string, { orientation: OrientationState; face: FaceState }>;
      };
      memberSlots: {
        slots: Record<SlotPosition, string | null>;
        cardStates: Map<string, { orientation: OrientationState; face: FaceState }>;
      };
    };
    const ownedP1CardIds = [...state.cardRegistry.values()]
      .filter((card) => card.ownerId === PLAYER1)
      .map((card) => card.instanceId);
    const sourceCardId = ownedP1CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardType === CardType.MEMBER
    );
    const discardCardId = ownedP1CardIds.find(
      (cardId) =>
        cardId !== sourceCardId && state.cardRegistry.get(cardId)?.data.cardType === CardType.MEMBER
    );
    const energyCardIds = ownedP1CardIds.filter(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardType === CardType.ENERGY
    );

    expect(sourceCardId).toBeTruthy();
    expect(discardCardId).toBeTruthy();
    expect(energyCardIds.length).toBeGreaterThanOrEqual(2);

    const sourceCard = state.cardRegistry.get(sourceCardId!) as unknown as { data: MemberCardData };
    const discardCard = state.cardRegistry.get(discardCardId!) as unknown as {
      data: MemberCardData;
    };
    sourceCard.data = createMemberCard('PL!-bp5-003-AR', '南ことり', 11);
    discardCard.data = createMemberCard('PL!-BP5-003-MUSE-EMPTY-DECK', '高坂穂乃果', 4, "μ's");

    removeFromPlayerZones(p1);
    p1.memberSlots.slots[SlotPosition.CENTER] = sourceCardId!;
    p1.memberSlots.cardStates = new Map([
      [sourceCardId!, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
    ]);
    p1.hand.cardIds = [discardCardId!];
    p1.mainDeck.cardIds = [];
    p1.waitingRoom.cardIds = [];
    setActiveEnergy(p1, energyCardIds.slice(0, 2));

    const activateResult = session.executeCommand(
      createActivateAbilityCommand(
        PLAYER1,
        sourceCardId!,
        BP5_003_ACTIVATED_ENERGY_DISCARD_BRANCH_ABILITY_ID
      )
    );
    expect(activateResult.success).toBe(true);

    const discardResult = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id, discardCardId)
    );

    expect(discardResult.success).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].hand.cardIds).toEqual([]);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([discardCardId]);
    expect(session.state?.players[0].mainDeck.cardIds).toEqual([]);
    expect(session.state?.players[0].energyZone.cardStates.get(energyCardIds[0])?.orientation).toBe(
      OrientationState.WAITING
    );
    expect(session.state?.players[0].energyZone.cardStates.get(energyCardIds[1])?.orientation).toBe(
      OrientationState.WAITING
    );
    expect(
      session.state?.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId === BP5_003_ACTIVATED_ENERGY_DISCARD_BRANCH_ABILITY_ID &&
          action.payload.step === 'NO_TOP_CARDS_TO_INSPECT' &&
          action.payload.discardCardId === discardCardId &&
          Array.isArray(action.payload.paidEnergyCardIds) &&
          action.payload.paidEnergyCardIds.length === 2
      )
    ).toBe(true);
  });

  it("executes PL!-bp5-003-P activated ability with non-μ's discard branch recovering a LIVE", () => {
    const session = createGameSession();
    const deck = createDeck();

    session.createGame('sample-bp5-003-activated-non-muse-branch', PLAYER1, 'Player 1', PLAYER2, 'Player 2');
    session.initializeGame(deck, deck);
    forceMainPhaseForPlayer(session);

    const state = session.state!;
    const p1 = state.players[0] as unknown as {
      hand: { cardIds: string[] };
      mainDeck: { cardIds: string[] };
      waitingRoom: { cardIds: string[] };
      successZone: { cardIds: string[] };
      liveZone: { cardIds: string[] };
      energyZone: {
        cardIds: string[];
        cardStates: Map<string, { orientation: OrientationState; face: FaceState }>;
      };
      memberSlots: {
        slots: Record<SlotPosition, string | null>;
        cardStates: Map<string, { orientation: OrientationState; face: FaceState }>;
      };
    };
    const ownedP1CardIds = [...state.cardRegistry.values()]
      .filter((card) => card.ownerId === PLAYER1)
      .map((card) => card.instanceId);
    const sourceCardId = ownedP1CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardType === CardType.MEMBER
    );
    const memberCardIds = ownedP1CardIds.filter(
      (cardId) =>
        cardId !== sourceCardId &&
        state.cardRegistry.get(cardId)?.data.cardType === CardType.MEMBER
    );
    const targetLiveId = ownedP1CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardType === CardType.LIVE
    );
    const energyCardIds = ownedP1CardIds.filter(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardType === CardType.ENERGY
    );
    const discardCardId = memberCardIds[0];

    expect(sourceCardId).toBeTruthy();
    expect(discardCardId).toBeTruthy();
    expect(targetLiveId).toBeTruthy();
    expect(energyCardIds.length).toBeGreaterThanOrEqual(2);

    const sourceCard = state.cardRegistry.get(sourceCardId!) as unknown as { data: MemberCardData };
    const discardCard = state.cardRegistry.get(discardCardId!) as unknown as {
      data: MemberCardData;
    };
    const targetLive = state.cardRegistry.get(targetLiveId!) as unknown as { data: LiveCardData };
    sourceCard.data = createMemberCard('PL!-bp5-003-P', '南ことり', 11);
    discardCard.data = createMemberCard('PL!N-BP5-003-NON-MUSE-DISCARD', '中須かすみ', 4, '虹咲');
    targetLive.data = createLiveCard('PL!-BP5-003-TARGET-LIVE', 'Recovery Live');

    removeFromPlayerZones(p1);
    p1.memberSlots.slots[SlotPosition.CENTER] = sourceCardId!;
    p1.memberSlots.cardStates = new Map([
      [sourceCardId!, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
    ]);
    p1.hand.cardIds = [discardCardId!];
    p1.waitingRoom.cardIds = [targetLiveId!];
    setActiveEnergy(p1, energyCardIds.slice(0, 2));

    const activateResult = session.executeCommand(
      createActivateAbilityCommand(
        PLAYER1,
        sourceCardId!,
        BP5_003_ACTIVATED_ENERGY_DISCARD_BRANCH_ABILITY_ID
      )
    );
    expect(activateResult.success).toBe(true);

    const activeEffectId = session.state!.activeEffect!.id;
    const discardResult = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, activeEffectId, discardCardId)
    );

    expect(discardResult.success).toBe(true);
    expect(session.state?.players[0].hand.cardIds).toEqual([]);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([targetLiveId, discardCardId]);
    expect(session.state?.activeEffect?.id).toBe(activeEffectId);
    expect(session.state?.activeEffect?.selectableCardIds).toEqual([targetLiveId]);
    expect(session.state?.activeEffect?.canSkipSelection).toBe(false);
    expect(session.state?.activeEffect?.metadata?.zoneSelection).toEqual({
      source: 'WAITING_ROOM',
      destination: 'HAND',
      minCount: 1,
      maxCount: 1,
      optional: false,
    });

    const skipRecoveryResult = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, activeEffectId)
    );

    expect(skipRecoveryResult.success).toBe(false);
    expect(session.state?.activeEffect?.id).toBe(activeEffectId);

    const recoverResult = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, activeEffectId, targetLiveId)
    );

    expect(recoverResult.success).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].hand.cardIds).toEqual([targetLiveId]);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([discardCardId]);
  });

  it("allows PL!-bp5-003-R+ non-μ's discard branch to finish when no LIVE target exists", () => {
    const session = createGameSession();
    const deck = createDeck();

    session.createGame('sample-bp5-003-activated-non-muse-no-target', PLAYER1, 'Player 1', PLAYER2, 'Player 2');
    session.initializeGame(deck, deck);
    forceMainPhaseForPlayer(session);

    const state = session.state!;
    const p1 = state.players[0] as unknown as {
      hand: { cardIds: string[] };
      mainDeck: { cardIds: string[] };
      waitingRoom: { cardIds: string[] };
      successZone: { cardIds: string[] };
      liveZone: { cardIds: string[] };
      energyZone: {
        cardIds: string[];
        cardStates: Map<string, { orientation: OrientationState; face: FaceState }>;
      };
      memberSlots: {
        slots: Record<SlotPosition, string | null>;
        cardStates: Map<string, { orientation: OrientationState; face: FaceState }>;
      };
    };
    const ownedP1CardIds = [...state.cardRegistry.values()]
      .filter((card) => card.ownerId === PLAYER1)
      .map((card) => card.instanceId);
    const sourceCardId = ownedP1CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardType === CardType.MEMBER
    );
    const discardCardId = ownedP1CardIds.find(
      (cardId) =>
        cardId !== sourceCardId && state.cardRegistry.get(cardId)?.data.cardType === CardType.MEMBER
    );
    const energyCardIds = ownedP1CardIds.filter(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardType === CardType.ENERGY
    );

    expect(sourceCardId).toBeTruthy();
    expect(discardCardId).toBeTruthy();
    expect(energyCardIds.length).toBeGreaterThanOrEqual(2);

    const sourceCard = state.cardRegistry.get(sourceCardId!) as unknown as { data: MemberCardData };
    const discardCard = state.cardRegistry.get(discardCardId!) as unknown as {
      data: MemberCardData;
    };
    sourceCard.data = createMemberCard('PL!-bp5-003-R+', '南ことり', 11);
    discardCard.data = createMemberCard('PL!N-BP5-003-NON-MUSE-NO-TARGET', '中須かすみ', 4, '虹咲');

    removeFromPlayerZones(p1);
    p1.memberSlots.slots[SlotPosition.CENTER] = sourceCardId!;
    p1.memberSlots.cardStates = new Map([
      [sourceCardId!, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
    ]);
    p1.hand.cardIds = [discardCardId!];
    p1.waitingRoom.cardIds = [];
    setActiveEnergy(p1, energyCardIds.slice(0, 2));

    const activateResult = session.executeCommand(
      createActivateAbilityCommand(
        PLAYER1,
        sourceCardId!,
        BP5_003_ACTIVATED_ENERGY_DISCARD_BRANCH_ABILITY_ID
      )
    );
    expect(activateResult.success).toBe(true);

    const discardResult = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id, discardCardId)
    );

    expect(discardResult.success).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].hand.cardIds).toEqual([]);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([discardCardId]);
  });

  it('does not activate PL!-bp5-003-SEC activated ability without two active energy and a hand card', () => {
    const session = createGameSession();
    const deck = createDeck();

    session.createGame('sample-bp5-003-activated-cannot-pay', PLAYER1, 'Player 1', PLAYER2, 'Player 2');
    session.initializeGame(deck, deck);
    forceMainPhaseForPlayer(session);

    const state = session.state!;
    const p1 = state.players[0] as unknown as {
      hand: { cardIds: string[] };
      mainDeck: { cardIds: string[] };
      waitingRoom: { cardIds: string[] };
      successZone: { cardIds: string[] };
      liveZone: { cardIds: string[] };
      energyZone: {
        cardIds: string[];
        cardStates: Map<string, { orientation: OrientationState; face: FaceState }>;
      };
      memberSlots: {
        slots: Record<SlotPosition, string | null>;
        cardStates: Map<string, { orientation: OrientationState; face: FaceState }>;
      };
    };
    const ownedP1CardIds = [...state.cardRegistry.values()]
      .filter((card) => card.ownerId === PLAYER1)
      .map((card) => card.instanceId);
    const sourceCardId = ownedP1CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardType === CardType.MEMBER
    );
    const handCardId = ownedP1CardIds.find(
      (cardId) =>
        cardId !== sourceCardId && state.cardRegistry.get(cardId)?.data.cardType === CardType.MEMBER
    );
    const energyCardIds = ownedP1CardIds.filter(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardType === CardType.ENERGY
    );

    expect(sourceCardId).toBeTruthy();
    expect(handCardId).toBeTruthy();
    expect(energyCardIds.length).toBeGreaterThanOrEqual(15);

    const sourceCard = state.cardRegistry.get(sourceCardId!) as unknown as { data: MemberCardData };
    sourceCard.data = createMemberCard('PL!-bp5-003-SEC', '南ことり', 11);

    removeFromPlayerZones(p1);
    p1.memberSlots.slots[SlotPosition.CENTER] = sourceCardId!;
    p1.memberSlots.cardStates = new Map([
      [sourceCardId!, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
    ]);
    p1.hand.cardIds = [];
    setActiveEnergy(p1, energyCardIds.slice(0, 2));

    const noHandResult = session.executeCommand(
      createActivateAbilityCommand(
        PLAYER1,
        sourceCardId!,
        BP5_003_ACTIVATED_ENERGY_DISCARD_BRANCH_ABILITY_ID
      )
    );
    expect(noHandResult.success).toBe(false);
    expect(session.state?.activeEffect).toBeNull();

    p1.hand.cardIds = [handCardId!];
    setActiveEnergy(p1, energyCardIds.slice(0, 1));
    const oneEnergyResult = session.executeCommand(
      createActivateAbilityCommand(
        PLAYER1,
        sourceCardId!,
        BP5_003_ACTIVATED_ENERGY_DISCARD_BRANCH_ABILITY_ID
      )
    );

    expect(oneEnergyResult.success).toBe(false);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].hand.cardIds).toEqual([handCardId]);
  });

  it('executes PL!HS-bp1-006-P on-enter draw2 and discard1', () => {
    const session = createGameSession();
    const deck = createDeck();

    session.createGame(
      'sample-hs-bp1-006-on-enter-draw-discard-runner',
      PLAYER1,
      'Player 1',
      PLAYER2,
      'Player 2'
    );
    session.initializeGame(deck, deck);
    forceMainPhaseForPlayer(session);

    const state = session.state!;
    const p1 = state.players[0] as unknown as {
      hand: { cardIds: string[] };
      mainDeck: { cardIds: string[] };
      waitingRoom: { cardIds: string[] };
      successZone: { cardIds: string[] };
      liveZone: { cardIds: string[] };
      energyZone: {
        cardIds: string[];
        cardStates: Map<string, { orientation: OrientationState; face: FaceState }>;
      };
      memberSlots: { slots: Record<SlotPosition, string | null> };
    };

    const ownedP1CardIds = [...state.cardRegistry.values()]
      .filter((card) => card.ownerId === PLAYER1)
      .map((card) => card.instanceId);
    const hsCardId = ownedP1CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardCode === 'PL!HS-bp1-006-P'
    );
    const deckCardIds = ownedP1CardIds.filter(
      (cardId) =>
        cardId !== hsCardId && state.cardRegistry.get(cardId)?.data.cardType === CardType.MEMBER
    );
    const energyCardIds = ownedP1CardIds.filter(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardType === CardType.ENERGY
    );
    const firstDrawnCardId = deckCardIds[0];
    const secondDrawnCardId = deckCardIds[1];
    const remainingDeckCardId = deckCardIds[2];

    expect(hsCardId).toBeTruthy();
    expect(energyCardIds.length).toBeGreaterThanOrEqual(11);
    expect(firstDrawnCardId).toBeTruthy();
    expect(secondDrawnCardId).toBeTruthy();
    expect(remainingDeckCardId).toBeTruthy();

    removeFromPlayerZones(p1);
    setActiveEnergy(p1, energyCardIds.slice(0, 11));
    p1.hand.cardIds = [hsCardId!];
    p1.mainDeck.cardIds = [firstDrawnCardId!, secondDrawnCardId!, remainingDeckCardId!];
    p1.memberSlots.slots[SlotPosition.CENTER] = null;

    const playResult = session.executeCommand(
      createPlayMemberToSlotCommand(PLAYER1, hsCardId!, SlotPosition.CENTER)
    );

    expect(playResult.success).toBe(true);
    expect(session.state?.activeEffect?.abilityId).toBe(
      HS_BP1_006_ON_ENTER_DRAW_DISCARD_ABILITY_ID
    );
    expect(session.state?.activeEffect?.selectableCardIds).toEqual([
      firstDrawnCardId,
      secondDrawnCardId,
    ]);
    expect(session.state?.players[0].hand.cardIds).toEqual([firstDrawnCardId, secondDrawnCardId]);
    expect(session.state?.players[0].mainDeck.cardIds).toEqual([remainingDeckCardId]);

    expect(
      session.state?.actionHistory.some(
        (action) =>
          action.type === 'TRIGGER_ABILITY' &&
          action.payload.abilityId === HS_BP1_006_ON_ENTER_DRAW_DISCARD_ABILITY_ID
      )
    ).toBe(true);

    const confirmResult = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id, secondDrawnCardId)
    );

    expect(confirmResult.success).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].hand.cardIds).toEqual([firstDrawnCardId]);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([secondDrawnCardId]);
    expect(session.state?.players[0].mainDeck.cardIds).toEqual([remainingDeckCardId]);
    expect(
      session.state?.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId === HS_BP1_006_ON_ENTER_DRAW_DISCARD_ABILITY_ID &&
          action.payload.step === 'DISCARD_HAND_CARD' &&
          action.payload.discardedCardId === secondDrawnCardId
      )
    ).toBe(true);
  });

  it('executes PL!HS-bp1-010-N on-enter draw1 and discard1', () => {
    const session = createGameSession();
    const deck = createDeck();

    session.createGame(
      'sample-hs-bp1-010-n-on-enter-draw-discard-runner',
      PLAYER1,
      'Player 1',
      PLAYER2,
      'Player 2'
    );
    session.initializeGame(deck, deck);
    forceMainPhaseForPlayer(session);

    const hsCard = createCardInstance(
      createMemberCard('PL!HS-bp1-010-N', '日野下花帆', 4, '蓮ノ空'),
      PLAYER1,
      'p1-hs-bp1-010'
    );
    const drawnCard = createCardInstance(
      createMemberCard('PL!HS-test-bp1-010-drawn', '村野さやか', 1, '蓮ノ空'),
      PLAYER1,
      'p1-bp1-010-drawn'
    );
    const remainingDeckCard = createCardInstance(
      createMemberCard('PL!HS-test-bp1-010-remaining', '乙宗梢', 1, '蓮ノ空'),
      PLAYER1,
      'p1-bp1-010-remaining'
    );
    const energyCardIds = [...session.state!.cardRegistry.values()]
      .filter((card) => card.ownerId === PLAYER1 && card.data.cardType === CardType.ENERGY)
      .map((card) => card.instanceId);

    const state = registerCards(session.state!, [hsCard, drawnCard, remainingDeckCard]);
    const p1 = state.players[0] as unknown as {
      hand: { cardIds: string[] };
      mainDeck: { cardIds: string[] };
      waitingRoom: { cardIds: string[] };
      successZone: { cardIds: string[] };
      liveZone: { cardIds: string[] };
      energyZone: {
        cardIds: string[];
        cardStates: Map<string, { orientation: OrientationState; face: FaceState }>;
      };
      memberSlots: { slots: Record<SlotPosition, string | null> };
    };

    expect(energyCardIds.length).toBeGreaterThanOrEqual(4);

    removeFromPlayerZones(p1);
    setActiveEnergy(p1, energyCardIds.slice(0, 4));
    p1.hand.cardIds = [hsCard.instanceId];
    p1.mainDeck.cardIds = [drawnCard.instanceId, remainingDeckCard.instanceId];
    p1.memberSlots.slots[SlotPosition.CENTER] = null;
    (session as unknown as { authorityState: GameState }).authorityState = state;

    const playResult = session.executeCommand(
      createPlayMemberToSlotCommand(PLAYER1, hsCard.instanceId, SlotPosition.CENTER)
    );

    expect(playResult.success).toBe(true);
    expect(session.state?.activeEffect?.abilityId).toBe(
      HS_BP1_006_ON_ENTER_DRAW_ONE_DISCARD_ONE_ABILITY_ID
    );
    expect(session.state?.activeEffect?.selectableCardIds).toEqual([drawnCard.instanceId]);
    expect(session.state?.players[0].hand.cardIds).toEqual([drawnCard.instanceId]);
    expect(session.state?.players[0].mainDeck.cardIds).toEqual([remainingDeckCard.instanceId]);

    expect(
      session.state?.actionHistory.some(
        (action) =>
          action.type === 'TRIGGER_ABILITY' &&
          action.payload.abilityId === HS_BP1_006_ON_ENTER_DRAW_ONE_DISCARD_ONE_ABILITY_ID
      )
    ).toBe(true);

    const confirmResult = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id, drawnCard.instanceId)
    );

    expect(confirmResult.success).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].hand.cardIds).toEqual([]);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([drawnCard.instanceId]);
    expect(session.state?.players[0].mainDeck.cardIds).toEqual([remainingDeckCard.instanceId]);
    expect(
      session.state?.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId === HS_BP1_006_ON_ENTER_DRAW_ONE_DISCARD_ONE_ABILITY_ID &&
          action.payload.step === 'DISCARD_HAND_CARD' &&
          action.payload.discardedCardId === drawnCard.instanceId
      )
    ).toBe(true);
  });

  it.each(PB1_019_LIKE_MEMBER_ACTIVATION_TEST_CASES)(
    'uses the generic waiting-room-to-hand selection after $cardCode self-sacrifice cost',
    ({ cardCode, name }) => {
      const session = createGameSession();
      const deck = createDeck();

      session.createGame(
        'sample-pb1-019-activated-waiting-room-member-runner',
        PLAYER1,
        'Player 1',
        PLAYER2,
        'Player 2'
      );
      session.initializeGame(deck, deck);
      forceMainPhaseForPlayer(session);

      const state = session.state!;
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

      const ownedP1CardIds = [...state.cardRegistry.values()]
        .filter((card) => card.ownerId === PLAYER1)
        .map((card) => card.instanceId);
      const pb1CardId = ownedP1CardIds.find(
        (cardId) => state.cardRegistry.get(cardId)?.data.cardType === CardType.MEMBER
      );
      const targetMemberCardId = ownedP1CardIds.find(
        (cardId) =>
          cardId !== pb1CardId && state.cardRegistry.get(cardId)?.data.cardType === CardType.MEMBER
      );
      const liveCardId = ownedP1CardIds.find(
        (cardId) =>
          cardId !== pb1CardId &&
          cardId !== targetMemberCardId &&
          state.cardRegistry.get(cardId)?.data.cardType === CardType.LIVE
      );

      expect(pb1CardId).toBeTruthy();
      expect(targetMemberCardId).toBeTruthy();
      expect(liveCardId).toBeTruthy();

      const pb1Card = state.cardRegistry.get(pb1CardId!) as unknown as { data: MemberCardData };
      pb1Card.data = createMemberCard(cardCode, name, 2);

      removeFromPlayerZones(p1);
      p1.hand.cardIds = [];
      p1.waitingRoom.cardIds = [targetMemberCardId!, liveCardId!];
      p1.memberSlots.slots[SlotPosition.CENTER] = pb1CardId!;
      p1.memberSlots.cardStates = new Map([
        [pb1CardId!, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
      ]);

      const activateResult = session.executeCommand(
        createActivateAbilityCommand(PLAYER1, pb1CardId!, PB1_019_ACTIVATED_ABILITY_ID)
      );

      expect(activateResult.success).toBe(true);
      expect(session.state?.activeEffect?.abilityId).toBe(PB1_019_ACTIVATED_ABILITY_ID);
      expect(session.state?.activeEffect?.metadata?.zoneSelection).toEqual({
        source: 'WAITING_ROOM',
        destination: 'HAND',
        minCount: 0,
        maxCount: 1,
        optional: true,
      });
      expect(session.state?.players[0].waitingRoom.cardIds).toContain(pb1CardId);
      expect(session.state?.activeEffect?.selectableCardIds).toContain(pb1CardId);
      expect(session.state?.activeEffect?.selectableCardIds).toContain(targetMemberCardId);
      expect(session.state?.activeEffect?.selectableCardIds).not.toContain(liveCardId);

      const confirmResult = session.executeCommand(
        createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id, targetMemberCardId)
      );

      expect(confirmResult.success).toBe(true);
      expect(session.state?.activeEffect).toBeNull();
      expect(session.state?.players[0].hand.cardIds).toEqual([targetMemberCardId]);
      expect(session.state?.players[0].waitingRoom.cardIds).toEqual(
        expect.arrayContaining([liveCardId!, pb1CardId!])
      );
      expect(
        session.state?.actionHistory.some(
          (action) =>
            action.type === 'RESOLVE_ABILITY' &&
            action.payload.abilityId === PB1_019_ACTIVATED_ABILITY_ID &&
            action.payload.step === 'FINISH' &&
            action.payload.selectedCardId === targetMemberCardId
        )
      ).toBe(true);
    }
  );

  it('uses the generic waiting-room-to-hand selection after PL!-bp4-003-P self-sacrifice cost', () => {
    const session = createGameSession();
    const deck = createDeck();

    session.createGame(
      'sample-bp4-003-activated-waiting-room-live-runner',
      PLAYER1,
      'Player 1',
      PLAYER2,
      'Player 2'
    );
    session.initializeGame(deck, deck);
    forceMainPhaseForPlayer(session);

    const state = session.state!;
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

    const ownedP1CardIds = [...state.cardRegistry.values()]
      .filter((card) => card.ownerId === PLAYER1)
      .map((card) => card.instanceId);
    const kotoriCardId = ownedP1CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardCode === 'PL!-bp4-003-P'
    );
    const targetLiveCardId = ownedP1CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardType === CardType.LIVE
    );
    const memberCardId = ownedP1CardIds.find(
      (cardId) =>
        cardId !== kotoriCardId && state.cardRegistry.get(cardId)?.data.cardType === CardType.MEMBER
    );

    expect(kotoriCardId).toBeTruthy();
    expect(targetLiveCardId).toBeTruthy();
    expect(memberCardId).toBeTruthy();

    removeFromPlayerZones(p1);
    p1.hand.cardIds = [];
    p1.waitingRoom.cardIds = [targetLiveCardId!, memberCardId!];
    p1.memberSlots.slots[SlotPosition.CENTER] = kotoriCardId!;
    p1.memberSlots.cardStates = new Map([
      [kotoriCardId!, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
    ]);

    const activateResult = session.executeCommand(
      createActivateAbilityCommand(PLAYER1, kotoriCardId!, BP4_003_ACTIVATED_ABILITY_ID)
    );

    expect(activateResult.success).toBe(true);
    expect(session.state?.activeEffect?.abilityId).toBe(BP4_003_ACTIVATED_ABILITY_ID);
    expect(session.state?.activeEffect?.metadata?.zoneSelection).toEqual({
      source: 'WAITING_ROOM',
      destination: 'HAND',
      minCount: 0,
      maxCount: 1,
      optional: true,
    });
    expect(session.state?.players[0].waitingRoom.cardIds).toContain(kotoriCardId);
    expect(session.state?.activeEffect?.selectableCardIds).toEqual([targetLiveCardId]);

    const confirmResult = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id, targetLiveCardId)
    );

    expect(confirmResult.success).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].hand.cardIds).toEqual([targetLiveCardId]);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual(
      expect.arrayContaining([memberCardId!, kotoriCardId!])
    );
    expect(
      session.state?.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId === BP4_003_ACTIVATED_ABILITY_ID &&
          action.payload.step === 'FINISH' &&
          action.payload.selectedCardId === targetLiveCardId
      )
    ).toBe(true);
  });

  it.each(GENERIC_DISCARD_LOOK_TOP_ON_ENTER_CARD_TEST_CASES)(
    'executes $cardCode on-enter discard then requires taking one of top three',
    ({ cardCode }) => {
      const session = createGameSession();
      const deck = createDeck();

      session.createGame(
        `sample-discard-look-top-runner-${cardCode}`,
        PLAYER1,
        'Player 1',
        PLAYER2,
        'Player 2'
      );
      session.initializeGame(deck, deck);
      forceMainPhaseForPlayer(session);

      const state = session.state!;
      const p1 = state.players[0] as unknown as {
        hand: { cardIds: string[] };
        mainDeck: { cardIds: string[] };
        waitingRoom: { cardIds: string[] };
        successZone: { cardIds: string[] };
        liveZone: { cardIds: string[] };
        energyZone: {
          cardIds: string[];
          cardStates: Map<string, { orientation: OrientationState; face: FaceState }>;
        };
        memberSlots: { slots: Record<SlotPosition, string | null> };
      };

      const ownedP1CardIds = [...state.cardRegistry.values()]
        .filter((card) => card.ownerId === PLAYER1)
        .map((card) => card.instanceId);
      const sourceCardId = ownedP1CardIds.find(
        (ownedCardId) => state.cardRegistry.get(ownedCardId)?.data.cardCode === cardCode
      );
      const energyCardIds = ownedP1CardIds.filter(
        (ownedCardId) => state.cardRegistry.get(ownedCardId)?.data.cardType === CardType.ENERGY
      );
      const otherMemberCardIds = ownedP1CardIds.filter(
        (ownedCardId) =>
          ownedCardId !== sourceCardId &&
          state.cardRegistry.get(ownedCardId)?.data.cardType === CardType.MEMBER
      );

      expect(sourceCardId).toBeTruthy();
      expect(energyCardIds.length).toBeGreaterThanOrEqual(11);
      expect(otherMemberCardIds.length).toBeGreaterThanOrEqual(5);

      const discardCardId = otherMemberCardIds[0];
      const inspectedCardIds = [
        otherMemberCardIds[1],
        otherMemberCardIds[2],
        otherMemberCardIds[3],
      ];
      const unrevealedCardId = otherMemberCardIds[4];
      const selectedCardId = inspectedCardIds[1];

      removeFromPlayerZones(p1);
      setActiveEnergy(p1, energyCardIds.slice(0, 11));
      p1.hand.cardIds = [sourceCardId!, discardCardId];
      p1.mainDeck.cardIds = [...inspectedCardIds, unrevealedCardId];
      p1.memberSlots.slots[SlotPosition.CENTER] = null;

      const playResult = session.executeCommand(
        createPlayMemberToSlotCommand(PLAYER1, sourceCardId!, SlotPosition.CENTER)
      );

      expect(playResult.success).toBe(true);
      expect(session.state?.activeEffect?.sourceCardId).toBe(sourceCardId);
      expect(session.state?.activeEffect?.selectionLabel).toBe('请选择要放置入休息室的卡牌');
      expect(session.state?.activeEffect?.skipSelectionLabel).toBe('不发动');
      expect(session.state?.activeEffect?.metadata?.handToWaitingRoomCost).toEqual({
        minCount: 1,
        maxCount: 1,
        optional: true,
      });
      expect(session.state?.activeEffect?.metadata?.effectCosts).toEqual([
        {
          kind: 'DISCARD_HAND_TO_WAITING_ROOM',
          minCount: 1,
          maxCount: 1,
          optional: true,
        },
      ]);
      expect(session.state?.activeEffect?.canSkipSelection).toBe(true);
      expect(session.state?.activeEffect?.selectableCardIds).toEqual([discardCardId]);

      const discardResult = session.executeCommand(
        createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id, discardCardId)
      );

      expect(discardResult.success).toBe(true);
      expect(session.state?.inspectionZone.cardIds).toEqual(inspectedCardIds);
      expect(session.state?.activeEffect?.selectionLabel).toBe('请选择要加入手牌的卡牌');
      expect(session.state?.activeEffect?.canSkipSelection).toBe(false);
      expect(session.state?.activeEffect?.selectableCardIds).toEqual(inspectedCardIds);
      expect(session.state?.players[0].mainDeck.cardIds).toEqual([unrevealedCardId]);
      expect(session.state?.players[0].waitingRoom.cardIds).toEqual([discardCardId]);

      const skipTakeResult = session.executeCommand(
        createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id)
      );

      expect(skipTakeResult.success).toBe(false);
      expect(session.state?.activeEffect).not.toBeNull();
      expect(session.state?.inspectionZone.cardIds).toEqual(inspectedCardIds);
      expect(session.state?.players[0].hand.cardIds).toEqual([]);
      expect(session.state?.players[0].waitingRoom.cardIds).toEqual([discardCardId]);

      const takeResult = session.executeCommand(
        createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id, selectedCardId)
      );

      expect(takeResult.success).toBe(true);
      expect(session.state?.activeEffect).toBeNull();
      expect(session.state?.inspectionZone.cardIds).toEqual([]);
      expect(session.state?.players[0].hand.cardIds).toEqual([selectedCardId]);
      expect(session.state?.players[0].waitingRoom.cardIds).toEqual([
        discardCardId,
        inspectedCardIds[0],
        inspectedCardIds[2],
      ]);
    }
  );

  it('executes PL!-sd1-015-SD by revealing the selected member before adding it to hand', () => {
    const session = createGameSession();
    const deck = createDeck();

    session.createGame(
      'sample-discard-look-top-reveal-member-runner',
      PLAYER1,
      'Player 1',
      PLAYER2,
      'Player 2'
    );
    session.initializeGame(deck, deck);
    forceMainPhaseForPlayer(session);

    const state = session.state!;
    const p1 = state.players[0] as unknown as {
      hand: { cardIds: string[] };
      mainDeck: { cardIds: string[] };
      waitingRoom: { cardIds: string[] };
      successZone: { cardIds: string[] };
      liveZone: { cardIds: string[] };
      energyZone: {
        cardIds: string[];
        cardStates: Map<string, { orientation: OrientationState; face: FaceState }>;
      };
      memberSlots: { slots: Record<SlotPosition, string | null> };
    };

    const ownedP1CardIds = [...state.cardRegistry.values()]
      .filter((card) => card.ownerId === PLAYER1)
      .map((card) => card.instanceId);
    const makiCardId = ownedP1CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardCode === 'PL!-sd1-015-SD'
    );
    const liveCardId = ownedP1CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardType === CardType.LIVE
    );
    const energyCardIds = ownedP1CardIds.filter(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardType === CardType.ENERGY
    );
    const otherMemberCardIds = ownedP1CardIds.filter(
      (cardId) =>
        cardId !== makiCardId && state.cardRegistry.get(cardId)?.data.cardType === CardType.MEMBER
    );

    expect(makiCardId).toBeTruthy();
    expect(liveCardId).toBeTruthy();
    expect(energyCardIds.length).toBeGreaterThanOrEqual(1);
    expect(otherMemberCardIds.length).toBeGreaterThanOrEqual(5);

    const discardCardId = otherMemberCardIds[0];
    const inspectedCardIds = [
      otherMemberCardIds[1],
      liveCardId!,
      otherMemberCardIds[2],
      otherMemberCardIds[3],
      otherMemberCardIds[4],
    ];
    const unrevealedCardId = otherMemberCardIds[5];
    const selectedCardId = otherMemberCardIds[2];

    removeFromPlayerZones(p1);
    setActiveEnergy(p1, energyCardIds.slice(0, 1));
    p1.hand.cardIds = [makiCardId!, discardCardId];
    p1.mainDeck.cardIds = [...inspectedCardIds, unrevealedCardId];
    p1.memberSlots.slots[SlotPosition.CENTER] = null;

    const playResult = session.executeCommand(
      createPlayMemberToSlotCommand(PLAYER1, makiCardId!, SlotPosition.CENTER)
    );

    expect(playResult.success).toBe(true);
    expect(session.state?.activeEffect?.abilityId).toBe(GENERIC_DISCARD_LOOK_TOP_ABILITY_ID);
    expect(session.state?.activeEffect?.selectionLabel).toBe('请选择要放置入休息室的卡牌');

    const discardResult = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id, discardCardId)
    );

    expect(discardResult.success).toBe(true);
    expect(session.state?.inspectionZone.cardIds).toEqual(inspectedCardIds);
    expect(session.state?.inspectionZone.revealedCardIds).toEqual([]);
    expect(session.state?.activeEffect?.selectionLabel).toBe('请选择要加入手牌的成员卡');
    expect(session.state?.activeEffect?.canSkipSelection).toBe(true);
    expect(session.state?.activeEffect?.skipSelectionLabel).toBe('不加入');
    expect(session.state?.activeEffect?.selectableCardIds).toEqual(
      inspectedCardIds.filter((cardId) => cardId !== liveCardId)
    );

    const revealResult = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id, selectedCardId)
    );

    expect(revealResult.success).toBe(true);
    expect(session.state?.activeEffect).not.toBeNull();
    expect(session.state?.inspectionZone.cardIds).toEqual(inspectedCardIds);
    expect(session.state?.inspectionZone.revealedCardIds).toEqual([selectedCardId]);
    expect(session.state?.players[0].hand.cardIds).toEqual([]);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([discardCardId]);

    const finishResult = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id)
    );

    expect(finishResult.success).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.inspectionZone.cardIds).toEqual([]);
    expect(session.state?.inspectionZone.revealedCardIds).toEqual([]);
    expect(session.state?.players[0].hand.cardIds).toEqual([selectedCardId]);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([
      discardCardId,
      inspectedCardIds[0],
      inspectedCardIds[1],
      inspectedCardIds[3],
      inspectedCardIds[4],
    ]);
  });

  it('executes PL!HS-bp5-008-R on-enter by waiting itself, discarding, and revealing one high-cost Hasunosora member from top five', () => {
    const session = createGameSession();
    const deck = createDeck();

    session.createGame(
      'sample-hs-bp5-008-on-enter-look-top-runner',
      PLAYER1,
      'Player 1',
      PLAYER2,
      'Player 2'
    );
    session.initializeGame(deck, deck);
    forceMainPhaseForPlayer(session);

    const izumi = createCardInstance(
      createMemberCard('PL!HS-bp5-008-R', '桂城 泉', 4, '蓮ノ空'),
      PLAYER1,
      'p1-izumi'
    );
    const discard = createCardInstance(
      createMemberCard('PL!HS-test-discard', '日野下花帆', 1, '蓮ノ空'),
      PLAYER1,
      'p1-izumi-discard'
    );
    const highCostHasunosora = createCardInstance(
      createMemberCard('PL!HS-test-high-cost', '村野さやか', 9, '蓮ノ空'),
      PLAYER1,
      'p1-high-cost-hasu'
    );
    const lowCostHasunosora = createCardInstance(
      createMemberCard('PL!HS-test-low-cost', '大沢瑠璃乃', 8, '蓮ノ空'),
      PLAYER1,
      'p1-low-cost-hasu'
    );
    const highCostOther = createCardInstance(
      createMemberCard('PL!N-test-high-cost', '上原歩夢', 9, '虹咲'),
      PLAYER1,
      'p1-high-cost-other'
    );
    const liveCard = createCardInstance(
      createLiveCard('PL!HS-test-live-for-izumi', '蓮ノ空 LIVE', '蓮ノ空'),
      PLAYER1,
      'p1-hasu-live-for-izumi'
    );
    const restMember = createCardInstance(
      createMemberCard('PL!HS-test-rest', '乙宗梢', 1, '蓮ノ空'),
      PLAYER1,
      'p1-rest-member'
    );

    let state = registerCards(session.state!, [
      izumi,
      discard,
      highCostHasunosora,
      lowCostHasunosora,
      highCostOther,
      liveCard,
      restMember,
    ]);
    const p1 = state.players[0] as unknown as {
      hand: { cardIds: string[] };
      mainDeck: { cardIds: string[] };
      waitingRoom: { cardIds: string[] };
      successZone: { cardIds: string[] };
      liveZone: { cardIds: string[] };
      energyZone: {
        cardIds: string[];
        cardStates: Map<string, { orientation: OrientationState; face: FaceState }>;
      };
      memberSlots: {
        slots: Record<SlotPosition, string | null>;
        cardStates: Map<string, { orientation: OrientationState; face: FaceState }>;
      };
    };
    const energyCardIds = [...state.cardRegistry.values()]
      .filter((card) => card.ownerId === PLAYER1 && card.data.cardType === CardType.ENERGY)
      .map((card) => card.instanceId);
    const inspectedCardIds = [
      highCostHasunosora.instanceId,
      lowCostHasunosora.instanceId,
      highCostOther.instanceId,
      liveCard.instanceId,
      restMember.instanceId,
    ];

    expect(energyCardIds.length).toBeGreaterThanOrEqual(4);

    removeFromPlayerZones(p1);
    p1.hand.cardIds = [izumi.instanceId, discard.instanceId];
    p1.mainDeck.cardIds = inspectedCardIds;
    p1.memberSlots.slots = {
      [SlotPosition.LEFT]: null,
      [SlotPosition.CENTER]: null,
      [SlotPosition.RIGHT]: null,
    };
    p1.memberSlots.cardStates = new Map();
    setActiveEnergy(p1, energyCardIds.slice(0, 15));
    (session as unknown as { authorityState: GameState }).authorityState = state;
    (session as unknown as { authorityState: GameState }).authorityState = state;

    const playResult = session.executeCommand(
      createPlayMemberToSlotCommand(PLAYER1, izumi.instanceId, SlotPosition.CENTER)
    );

    expect(playResult.success).toBe(true);
    expect(session.state?.activeEffect?.abilityId).toBe(
      HS_BP5_008_ON_ENTER_WAIT_DISCARD_LOOK_TOP_ABILITY_ID
    );
    expect(session.state?.activeEffect?.selectableCardIds).toEqual([discard.instanceId]);
    expect(session.state?.activeEffect?.metadata?.effectCosts).toEqual([
      { kind: 'SET_SOURCE_MEMBER_ORIENTATION', orientation: OrientationState.WAITING },
      {
        kind: 'DISCARD_HAND_TO_WAITING_ROOM',
        minCount: 1,
        maxCount: 1,
        optional: true,
      },
    ]);

    const discardResult = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id, discard.instanceId)
    );

    expect(discardResult.success).toBe(true);
    expect(
      session.state?.players[0].memberSlots.cardStates.get(izumi.instanceId)?.orientation
    ).toBe(OrientationState.WAITING);
    expect(session.state?.inspectionZone.cardIds).toEqual(inspectedCardIds);
    expect(session.state?.activeEffect?.selectableCardIds).toEqual([highCostHasunosora.instanceId]);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([discard.instanceId]);

    const revealResult = session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        session.state!.activeEffect!.id,
        highCostHasunosora.instanceId
      )
    );

    expect(revealResult.success).toBe(true);
    expect(session.state?.inspectionZone.revealedCardIds).toEqual([highCostHasunosora.instanceId]);

    const finishResult = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id)
    );

    expect(finishResult.success).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].hand.cardIds).toEqual([highCostHasunosora.instanceId]);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([
      discard.instanceId,
      lowCostHasunosora.instanceId,
      highCostOther.instanceId,
      liveCard.instanceId,
      restMember.instanceId,
    ]);
  });

  it('starts PL!N-bp3-022-N on-enter with an optional activation choice', () => {
    const session = createGameSession();
    const deck = createDeck();

    session.createGame(
      'sample-n-bp3-022-on-enter-option-runner',
      PLAYER1,
      'Player 1',
      PLAYER2,
      'Player 2'
    );
    session.initializeGame(deck, deck);
    forceMainPhaseForPlayer(session);

    const shiorikoCard = createCardInstance(
      createMemberCard('PL!N-bp3-022-N', '三船栞子', 4, '虹咲'),
      PLAYER1,
      'p1-shioriko'
    );
    const topCardA = createCardInstance(
      createMemberCard('PL!HS-test-top-1', '日野下花帆', 1, '蓮ノ空'),
      PLAYER1,
      'p1-top-1'
    );
    const topCardB = createCardInstance(
      createMemberCard('PL!HS-test-top-2', '大沢瑠璃乃', 2, '蓮ノ空'),
      PLAYER1,
      'p1-top-2'
    );
    const energyCardIds = [...session.state!.cardRegistry.values()]
      .filter((card) => card.ownerId === PLAYER1 && card.data.cardType === CardType.ENERGY)
      .map((card) => card.instanceId);

    let state = registerCards(session.state!, [shiorikoCard, topCardA, topCardB]);
    const p1 = state.players[0] as unknown as {
      hand: { cardIds: string[] };
      mainDeck: { cardIds: string[] };
      waitingRoom: { cardIds: string[] };
      successZone: { cardIds: string[] };
      liveZone: { cardIds: string[] };
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
    p1.hand.cardIds = [shiorikoCard.instanceId];
    p1.mainDeck.cardIds = [topCardA.instanceId, topCardB.instanceId];
    p1.memberSlots.slots[SlotPosition.CENTER] = null;
    p1.memberSlots.cardStates = new Map();
    expect(energyCardIds.length).toBeGreaterThanOrEqual(4);
    setActiveEnergy(p1, energyCardIds.slice(0, 4));
    (session as unknown as { authorityState: GameState }).authorityState = state;

    const playResult = session.executeCommand(
      createPlayMemberToSlotCommand(PLAYER1, shiorikoCard.instanceId, SlotPosition.CENTER)
    );

    expect(playResult.success, playResult.error).toBe(true);
    expect(session.state?.activeEffect).toMatchObject({
      abilityId: PL_BP3_014_ON_ENTER_LOOK_TOP_TWO_ARRANGE_TO_TOP_ABILITY_ID,
      sourceCardId: shiorikoCard.instanceId,
      stepId: 'PL_BP3_014_ON_ENTER_OPTION',
      selectableOptions: [
        { id: 'activate', label: '发动' },
        { id: 'decline', label: '不发动' },
      ],
    });
    expect(session.state?.activeEffect?.selectableCardIds).toBeUndefined();
    expect(
      session.state?.players[0].memberSlots.cardStates.get(shiorikoCard.instanceId)?.orientation
    ).not.toBe(OrientationState.WAITING);
    expect(session.state?.inspectionZone.cardIds).toEqual([]);
  });

  it('allows PL!N-bp3-022-N on-enter optional activation to be declined', () => {
    const session = createGameSession();
    const deck = createDeck();

    session.createGame(
      'sample-n-bp3-022-on-enter-decline-runner',
      PLAYER1,
      'Player 1',
      PLAYER2,
      'Player 2'
    );
    session.initializeGame(deck, deck);
    forceMainPhaseForPlayer(session);

    const shiorikoCard = createCardInstance(
      createMemberCard('PL!N-bp3-022-N', '三船栞子', 4, '虹咲'),
      PLAYER1,
      'p1-shioriko'
    );
    const topCardA = createCardInstance(
      createMemberCard('PL!HS-test-top-1', '日野下花帆', 1, '蓮ノ空'),
      PLAYER1,
      'p1-top-1'
    );
    const topCardB = createCardInstance(
      createMemberCard('PL!HS-test-top-2', '大沢瑠璃乃', 2, '蓮ノ空'),
      PLAYER1,
      'p1-top-2'
    );
    const energyCardIds = [...session.state!.cardRegistry.values()]
      .filter((card) => card.ownerId === PLAYER1 && card.data.cardType === CardType.ENERGY)
      .map((card) => card.instanceId);

    let state = registerCards(session.state!, [shiorikoCard, topCardA, topCardB]);
    const p1 = state.players[0] as unknown as {
      hand: { cardIds: string[] };
      mainDeck: { cardIds: string[] };
      waitingRoom: { cardIds: string[] };
      successZone: { cardIds: string[] };
      liveZone: { cardIds: string[] };
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
    p1.hand.cardIds = [shiorikoCard.instanceId];
    p1.mainDeck.cardIds = [topCardA.instanceId, topCardB.instanceId];
    p1.memberSlots.slots[SlotPosition.CENTER] = null;
    p1.memberSlots.cardStates = new Map();
    expect(energyCardIds.length).toBeGreaterThanOrEqual(4);
    setActiveEnergy(p1, energyCardIds.slice(0, 4));
    (session as unknown as { authorityState: GameState }).authorityState = state;

    const playResult = session.executeCommand(
      createPlayMemberToSlotCommand(PLAYER1, shiorikoCard.instanceId, SlotPosition.CENTER)
    );

    expect(playResult.success, playResult.error).toBe(true);
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

    expect(declineResult.success, declineResult.error).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(
      session.state?.pendingAbilities.some(
        (ability) =>
          ability.abilityId === PL_BP3_014_ON_ENTER_LOOK_TOP_TWO_ARRANGE_TO_TOP_ABILITY_ID
      )
    ).toBe(false);
    expect(
      session.state?.players[0].memberSlots.cardStates.get(shiorikoCard.instanceId)?.orientation
    ).not.toBe(OrientationState.WAITING);
    expect(session.state?.inspectionZone.cardIds).toEqual([]);
    expect(session.state?.players[0].mainDeck.cardIds).toEqual([
      topCardA.instanceId,
      topCardB.instanceId,
    ]);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([]);
    expect(
      session.state?.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId ===
            PL_BP3_014_ON_ENTER_LOOK_TOP_TWO_ARRANGE_TO_TOP_ABILITY_ID &&
          action.payload.step === 'SKIP'
      )
    ).toBe(true);
  });

  it('executes PL!-bp3-014-N on-enter after opting in by waiting itself and rearranging top two cards', () => {
    const session = createGameSession();
    const deck = createDeck();

    session.createGame(
      'sample-bp3-014-on-enter-rearrange-top-two-runner',
      PLAYER1,
      'Player 1',
      PLAYER2,
      'Player 2'
    );
    session.initializeGame(deck, deck);
    forceMainPhaseForPlayer(session);

    const rinkiCard = createCardInstance(
      createMemberCard('PL!-bp3-014-N', '星空 凛', 4, '虹咲'),
      PLAYER1,
      'p1-rin'
    );
    const topCardA = createCardInstance(
      createMemberCard('PL!HS-test-top-1', '日野下花帆', 1, '蓮ノ空'),
      PLAYER1,
      'p1-top-1'
    );
    const topCardB = createCardInstance(
      createMemberCard('PL!HS-test-top-2', '大沢瑠璃乃', 2, '蓮ノ空'),
      PLAYER1,
      'p1-top-2'
    );
    const energyCardIds = [...session.state!.cardRegistry.values()]
      .filter((card) => card.ownerId === PLAYER1 && card.data.cardType === CardType.ENERGY)
      .map((card) => card.instanceId);

    let state = registerCards(session.state!, [rinkiCard, topCardA, topCardB]);
    const p1 = state.players[0] as unknown as {
      hand: { cardIds: string[] };
      mainDeck: { cardIds: string[] };
      waitingRoom: { cardIds: string[] };
      successZone: { cardIds: string[] };
      liveZone: { cardIds: string[] };
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
    p1.hand.cardIds = [rinkiCard.instanceId];
    p1.mainDeck.cardIds = [topCardA.instanceId, topCardB.instanceId];
    p1.memberSlots.slots[SlotPosition.CENTER] = null;
    p1.memberSlots.cardStates = new Map();
    expect(energyCardIds.length).toBeGreaterThanOrEqual(4);
    setActiveEnergy(p1, energyCardIds.slice(0, 4));
    (session as unknown as { authorityState: GameState }).authorityState = state;

    const playResult = session.executeCommand(
      createPlayMemberToSlotCommand(PLAYER1, rinkiCard.instanceId, SlotPosition.CENTER)
    );

    expect(playResult.success, playResult.error).toBe(true);
    expect(session.state?.activeEffect).toMatchObject({
      abilityId: PL_BP3_014_ON_ENTER_LOOK_TOP_TWO_ARRANGE_TO_TOP_ABILITY_ID,
      sourceCardId: rinkiCard.instanceId,
      stepId: 'PL_BP3_014_ON_ENTER_OPTION',
      selectableOptions: [
        { id: 'activate', label: '发动' },
        { id: 'decline', label: '不发动' },
      ],
    });
    expect(
      session.state?.players[0].memberSlots.cardStates.get(rinkiCard.instanceId)?.orientation
    ).not.toBe(OrientationState.WAITING);
    expect(session.state?.inspectionZone.cardIds).toEqual([]);

    const activateResult = session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        session.state!.activeEffect!.id,
        undefined,
        undefined,
        undefined,
        'activate'
      )
    );

    expect(activateResult.success, activateResult.error).toBe(true);
    expect(session.state?.activeEffect?.abilityId).toBe(
      PL_BP3_014_ON_ENTER_LOOK_TOP_TWO_ARRANGE_TO_TOP_ABILITY_ID
    );
    expect(session.state?.activeEffect?.stepId).toBe('PL_BP3_014_ON_ENTER_ARRANGE_TOP_TWO');
    expect(session.state?.activeEffect?.selectableCardIds).toEqual([
      topCardA.instanceId,
      topCardB.instanceId,
    ]);
    expect(
      session.state?.players[0].memberSlots.cardStates.get(rinkiCard.instanceId)?.orientation
    ).toBe(OrientationState.WAITING);
    expect(session.state?.actionHistory).toContainEqual(
      expect.objectContaining({
        type: 'PAY_COST',
        playerId: PLAYER1,
        payload: {
          pendingAbilityId: session.state!.activeEffect!.id,
          abilityId: PL_BP3_014_ON_ENTER_LOOK_TOP_TWO_ARRANGE_TO_TOP_ABILITY_ID,
          sourceCardId: rinkiCard.instanceId,
          sourceSlot: SlotPosition.CENTER,
          orientedMemberCardIds: [rinkiCard.instanceId],
        },
      })
    );
    expect(session.state?.inspectionZone.cardIds).toEqual([
      topCardA.instanceId,
      topCardB.instanceId,
    ]);

    const arrangeResult = session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        session.state!.activeEffect!.id,
        undefined,
        undefined,
        undefined,
        undefined,
        [topCardB.instanceId]
      )
    );

    expect(arrangeResult.success).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.inspectionZone.cardIds).toEqual([]);
    expect(session.state?.inspectionZone.revealedCardIds).toEqual([]);
    expect(session.state?.players[0].mainDeck.cardIds).toEqual([topCardB.instanceId]);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([topCardA.instanceId]);
  });

  it('keeps PL!-bp3-014-N source wait cost when the deck is empty after opting in', () => {
    const session = createGameSession();
    const deck = createDeck();

    session.createGame(
      'sample-bp3-014-on-enter-rearrange-empty-deck-after-cost',
      PLAYER1,
      'Player 1',
      PLAYER2,
      'Player 2'
    );
    session.initializeGame(deck, deck);
    forceMainPhaseForPlayer(session);

    const rinCard = createCardInstance(
      createMemberCard('PL!-bp3-014-N', '星空 凛', 4, '虹咲'),
      PLAYER1,
      'p1-rin-empty-deck'
    );
    const energyCardIds = [...session.state!.cardRegistry.values()]
      .filter((card) => card.ownerId === PLAYER1 && card.data.cardType === CardType.ENERGY)
      .map((card) => card.instanceId);

    let state = registerCards(session.state!, [rinCard]);
    const p1 = state.players[0] as unknown as {
      hand: { cardIds: string[] };
      mainDeck: { cardIds: string[] };
      waitingRoom: { cardIds: string[] };
      successZone: { cardIds: string[] };
      liveZone: { cardIds: string[] };
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
    p1.hand.cardIds = [rinCard.instanceId];
    p1.mainDeck.cardIds = [];
    p1.memberSlots.slots[SlotPosition.CENTER] = null;
    p1.memberSlots.cardStates = new Map();
    expect(energyCardIds.length).toBeGreaterThanOrEqual(4);
    setActiveEnergy(p1, energyCardIds.slice(0, 4));
    (session as unknown as { authorityState: GameState }).authorityState = state;

    const playResult = session.executeCommand(
      createPlayMemberToSlotCommand(PLAYER1, rinCard.instanceId, SlotPosition.CENTER)
    );

    expect(playResult.success, playResult.error).toBe(true);
    const activeEffectId = session.state!.activeEffect!.id;
    const activateResult = session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        activeEffectId,
        undefined,
        undefined,
        undefined,
        'activate'
      )
    );

    expect(activateResult.success, activateResult.error).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.inspectionZone.cardIds).toEqual([]);
    expect(session.state?.players[0].mainDeck.cardIds).toEqual([]);
    expect(
      session.state?.players[0].memberSlots.cardStates.get(rinCard.instanceId)?.orientation
    ).toBe(OrientationState.WAITING);
    expect(session.state?.actionHistory).toContainEqual(
      expect.objectContaining({
        type: 'PAY_COST',
        playerId: PLAYER1,
        payload: {
          pendingAbilityId: activeEffectId,
          abilityId: PL_BP3_014_ON_ENTER_LOOK_TOP_TWO_ARRANGE_TO_TOP_ABILITY_ID,
          sourceCardId: rinCard.instanceId,
          sourceSlot: SlotPosition.CENTER,
          orientedMemberCardIds: [rinCard.instanceId],
        },
      })
    );
    expect(session.state?.actionHistory).toContainEqual(
      expect.objectContaining({
        type: 'RESOLVE_ABILITY',
        playerId: PLAYER1,
        payload: {
          pendingAbilityId: activeEffectId,
          abilityId: PL_BP3_014_ON_ENTER_LOOK_TOP_TWO_ARRANGE_TO_TOP_ABILITY_ID,
          sourceCardId: rinCard.instanceId,
          step: 'FINISH',
          inspectedCardIds: [],
        },
      })
    );
  });

  it('executes PL!HS-pb1-004-R on-enter compound cost, mills three, and recovers a Cerise Bouquet Live', () => {
    const session = createGameSession();
    const deck = createDeck();

    session.createGame(
      'sample-hs-pb1-004-on-enter-mill-recover-runner',
      PLAYER1,
      'Player 1',
      PLAYER2,
      'Player 2'
    );
    session.initializeGame(deck, deck);
    forceMainPhaseForPlayer(session);

    const ginko = createCardInstance(
      createMemberCard('PL!HS-pb1-004-R', '百生吟子', 4, '蓮ノ空'),
      PLAYER1,
      'p1-pb1-004-ginko'
    );
    const discard = createCardInstance(
      createMemberCard('PL!HS-test-pb1-004-discard', '日野下花帆', 1, '蓮ノ空'),
      PLAYER1,
      'p1-pb1-004-discard'
    );
    const ceriseLive = createCardInstance(
      {
        ...createLiveCard('PL!HS-test-cerise-live', 'Cerise Bouquet LIVE', '蓮ノ空'),
        unitName: 'スリーズブーケ',
      },
      PLAYER1,
      'p1-pb1-004-cerise-live'
    );
    const otherMilledMember = createCardInstance(
      createMemberCard('PL!HS-test-pb1-004-mill-member', '村野さやか', 1, '蓮ノ空'),
      PLAYER1,
      'p1-pb1-004-mill-member'
    );
    const otherMilledLive = createCardInstance(
      createLiveCard('PL!HS-test-pb1-004-other-live', 'DOLLCHESTRA LIVE', '蓮ノ空'),
      PLAYER1,
      'p1-pb1-004-other-live'
    );
    const deckFiller = createCardInstance(
      createMemberCard('PL!HS-test-pb1-004-filler', '乙宗梢', 1, '蓮ノ空'),
      PLAYER1,
      'p1-pb1-004-filler'
    );

    let state = registerCards(session.state!, [
      ginko,
      discard,
      ceriseLive,
      otherMilledMember,
      otherMilledLive,
      deckFiller,
    ]);
    const p1 = state.players[0] as unknown as {
      hand: { cardIds: string[] };
      mainDeck: { cardIds: string[] };
      waitingRoom: { cardIds: string[] };
      successZone: { cardIds: string[] };
      liveZone: { cardIds: string[] };
      energyZone: {
        cardIds: string[];
        cardStates: Map<string, { orientation: OrientationState; face: FaceState }>;
      };
      memberSlots: {
        slots: Record<SlotPosition, string | null>;
        cardStates: Map<string, { orientation: OrientationState; face: FaceState }>;
      };
    };
    const energyCardIds = [...state.cardRegistry.values()]
      .filter((card) => card.ownerId === PLAYER1 && card.data.cardType === CardType.ENERGY)
      .map((card) => card.instanceId);

    expect(energyCardIds.length).toBeGreaterThanOrEqual(5);

    removeFromPlayerZones(p1);
    p1.hand.cardIds = [ginko.instanceId, discard.instanceId];
    p1.mainDeck.cardIds = [
      ceriseLive.instanceId,
      otherMilledMember.instanceId,
      otherMilledLive.instanceId,
      deckFiller.instanceId,
    ];
    p1.memberSlots.slots[SlotPosition.CENTER] = null;
    p1.memberSlots.cardStates = new Map();
    setActiveEnergy(p1, energyCardIds.slice(0, 5));
    (session as unknown as { authorityState: GameState }).authorityState = state;

    const playResult = session.executeCommand(
      createPlayMemberToSlotCommand(PLAYER1, ginko.instanceId, SlotPosition.CENTER)
    );

    expect(playResult.success).toBe(true);
    expect(session.state?.activeEffect?.abilityId).toBe(
      HS_PB1_004_ON_ENTER_PAY_ENERGY_DISCARD_MILL_RECOVER_CERISE_LIVE_ABILITY_ID
    );
    expect(session.state?.activeEffect?.selectableCardIds).toEqual([discard.instanceId]);
    expect(session.state?.players[0].energyZone.cardStates.get(energyCardIds[4])?.orientation).toBe(
      OrientationState.ACTIVE
    );

    const discardResult = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id, discard.instanceId)
    );

    expect(discardResult.success).toBe(true);
    expect(session.state?.players[0].energyZone.cardStates.get(energyCardIds[4])?.orientation).toBe(
      OrientationState.WAITING
    );
    expect(session.state?.players[0].mainDeck.cardIds).toEqual([deckFiller.instanceId]);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([
      discard.instanceId,
      ceriseLive.instanceId,
      otherMilledMember.instanceId,
      otherMilledLive.instanceId,
    ]);
    expect(session.state?.activeEffect?.selectableCardIds).toEqual([ceriseLive.instanceId]);

    const recoverResult = session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        session.state!.activeEffect!.id,
        ceriseLive.instanceId
      )
    );

    expect(recoverResult.success).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].hand.cardIds).toEqual([ceriseLive.instanceId]);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([
      discard.instanceId,
      otherMilledMember.instanceId,
      otherMilledLive.instanceId,
    ]);
  });

  it('lets PL!HS-pb1-004-R enter a skippable active effect when energy and hand cannot both be paid', () => {
    const session = createGameSession();
    const deck = createDeck();

    session.createGame(
      'sample-hs-pb1-004-on-enter-cannot-pay-skip',
      PLAYER1,
      'Player 1',
      PLAYER2,
      'Player 2'
    );
    session.initializeGame(deck, deck);
    forceMainPhaseForPlayer(session);

    const ginko = createCardInstance(
      createMemberCard('PL!HS-pb1-004-R', '百生吟子', 4, '蓮ノ空'),
      PLAYER1,
      'p1-pb1-004-cannot-pay-ginko'
    );
    const deckTop = createCardInstance(
      createMemberCard('PL!HS-test-pb1-004-cannot-pay-top', '日野下花帆', 1, '蓮ノ空'),
      PLAYER1,
      'p1-pb1-004-cannot-pay-top'
    );

    let state = registerCards(session.state!, [ginko, deckTop]);
    const p1 = state.players[0] as unknown as {
      hand: { cardIds: string[] };
      mainDeck: { cardIds: string[] };
      waitingRoom: { cardIds: string[] };
      successZone: { cardIds: string[] };
      liveZone: { cardIds: string[] };
      energyZone: {
        cardIds: string[];
        cardStates: Map<string, { orientation: OrientationState; face: FaceState }>;
      };
      memberSlots: {
        slots: Record<SlotPosition, string | null>;
        cardStates: Map<string, { orientation: OrientationState; face: FaceState }>;
      };
    };
    const energyCardIds = [...state.cardRegistry.values()]
      .filter((card) => card.ownerId === PLAYER1 && card.data.cardType === CardType.ENERGY)
      .map((card) => card.instanceId);

    expect(energyCardIds.length).toBeGreaterThanOrEqual(1);

    removeFromPlayerZones(p1);
    p1.hand.cardIds = [ginko.instanceId];
    p1.mainDeck.cardIds = [deckTop.instanceId];
    p1.memberSlots.slots[SlotPosition.CENTER] = null;
    p1.memberSlots.cardStates = new Map();
    setActiveEnergy(p1, energyCardIds.slice(0, 4));
    (session as unknown as { authorityState: GameState }).authorityState = state;

    const playResult = session.executeCommand(
      createPlayMemberToSlotCommand(PLAYER1, ginko.instanceId, SlotPosition.CENTER)
    );

    expect(playResult.success).toBe(true);
    expect(session.state?.activeEffect?.abilityId).toBe(
      HS_PB1_004_ON_ENTER_PAY_ENERGY_DISCARD_MILL_RECOVER_CERISE_LIVE_ABILITY_ID
    );
    expect(session.state?.activeEffect?.selectableCardIds).toEqual([]);
    expect(session.state?.players[0].hand.cardIds).toEqual([]);
    expect(session.state?.players[0].mainDeck.cardIds).toEqual([deckTop.instanceId]);
    expect(
      session.state?.players[0].energyZone.cardStates.get(energyCardIds[3]!)?.orientation
    ).toBe(OrientationState.WAITING);

    const skipResult = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id)
    );

    expect(skipResult.success).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].hand.cardIds).toEqual([]);
    expect(session.state?.players[0].mainDeck.cardIds).toEqual([deckTop.instanceId]);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([]);
    expect(
      session.state?.players[0].energyZone.cardStates.get(energyCardIds[3]!)?.orientation
    ).toBe(OrientationState.WAITING);
    expect(
      session.state?.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId ===
            HS_PB1_004_ON_ENTER_PAY_ENERGY_DISCARD_MILL_RECOVER_CERISE_LIVE_ABILITY_ID &&
          action.payload.step === 'SKIP'
      )
    ).toBe(true);
  });

  it('lets PL!HS-pb1-004-R decline without paying energy, discarding, or milling', () => {
    const session = createGameSession();
    const deck = createDeck();

    session.createGame(
      'sample-hs-pb1-004-on-enter-decline',
      PLAYER1,
      'Player 1',
      PLAYER2,
      'Player 2'
    );
    session.initializeGame(deck, deck);
    forceMainPhaseForPlayer(session);

    const ginko = createCardInstance(
      createMemberCard('PL!HS-pb1-004-R', '百生吟子', 4, '蓮ノ空'),
      PLAYER1,
      'p1-pb1-004-decline-ginko'
    );
    const discard = createCardInstance(
      createMemberCard('PL!HS-test-pb1-004-decline-discard', '日野下花帆', 1, '蓮ノ空'),
      PLAYER1,
      'p1-pb1-004-decline-discard'
    );
    const deckTop = createCardInstance(
      createMemberCard('PL!HS-test-pb1-004-decline-top', '村野さやか', 1, '蓮ノ空'),
      PLAYER1,
      'p1-pb1-004-decline-top'
    );

    let state = registerCards(session.state!, [ginko, discard, deckTop]);
    const p1 = state.players[0] as unknown as {
      hand: { cardIds: string[] };
      mainDeck: { cardIds: string[] };
      waitingRoom: { cardIds: string[] };
      successZone: { cardIds: string[] };
      liveZone: { cardIds: string[] };
      energyZone: {
        cardIds: string[];
        cardStates: Map<string, { orientation: OrientationState; face: FaceState }>;
      };
      memberSlots: {
        slots: Record<SlotPosition, string | null>;
        cardStates: Map<string, { orientation: OrientationState; face: FaceState }>;
      };
    };
    const energyCardIds = [...state.cardRegistry.values()]
      .filter((card) => card.ownerId === PLAYER1 && card.data.cardType === CardType.ENERGY)
      .map((card) => card.instanceId);

    expect(energyCardIds.length).toBeGreaterThanOrEqual(5);

    removeFromPlayerZones(p1);
    p1.hand.cardIds = [ginko.instanceId, discard.instanceId];
    p1.mainDeck.cardIds = [deckTop.instanceId];
    p1.memberSlots.slots[SlotPosition.CENTER] = null;
    p1.memberSlots.cardStates = new Map();
    setActiveEnergy(p1, energyCardIds.slice(0, 5));
    (session as unknown as { authorityState: GameState }).authorityState = state;

    const playResult = session.executeCommand(
      createPlayMemberToSlotCommand(PLAYER1, ginko.instanceId, SlotPosition.CENTER)
    );

    expect(playResult.success).toBe(true);
    expect(session.state?.activeEffect?.selectableCardIds).toEqual([discard.instanceId]);

    const skipResult = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id)
    );

    expect(skipResult.success).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].hand.cardIds).toEqual([discard.instanceId]);
    expect(session.state?.players[0].mainDeck.cardIds).toEqual([deckTop.instanceId]);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([]);
    expect(
      session.state?.players[0].energyZone.cardStates.get(energyCardIds[4]!)?.orientation
    ).toBe(OrientationState.ACTIVE);
  });

  it('keeps PL!HS-pb1-004-R paid costs and milled cards when no Cerise Bouquet LIVE target remains', () => {
    const session = createGameSession();
    const deck = createDeck();

    session.createGame(
      'sample-hs-pb1-004-on-enter-no-cerise-live-target',
      PLAYER1,
      'Player 1',
      PLAYER2,
      'Player 2'
    );
    session.initializeGame(deck, deck);
    forceMainPhaseForPlayer(session);

    const ginko = createCardInstance(
      createMemberCard('PL!HS-pb1-004-R', '百生吟子', 4, '蓮ノ空'),
      PLAYER1,
      'p1-pb1-004-no-target-ginko'
    );
    const discard = createCardInstance(
      createMemberCard('PL!HS-test-pb1-004-no-target-discard', '日野下花帆', 1, '蓮ノ空'),
      PLAYER1,
      'p1-pb1-004-no-target-discard'
    );
    const milledMember = createCardInstance(
      createMemberCard('PL!HS-test-pb1-004-no-target-member', '村野さやか', 1, '蓮ノ空'),
      PLAYER1,
      'p1-pb1-004-no-target-member'
    );
    const milledLive = createCardInstance(
      createLiveCard('PL!HS-test-pb1-004-no-target-live', 'DOLLCHESTRA LIVE', '蓮ノ空'),
      PLAYER1,
      'p1-pb1-004-no-target-live'
    );
    const milledFiller = createCardInstance(
      createMemberCard('PL!HS-test-pb1-004-no-target-filler', '乙宗梢', 1, '蓮ノ空'),
      PLAYER1,
      'p1-pb1-004-no-target-filler'
    );
    const deckFiller = createCardInstance(
      createMemberCard('PL!HS-test-pb1-004-no-target-deck-filler', '藤島慈', 1, '蓮ノ空'),
      PLAYER1,
      'p1-pb1-004-no-target-deck-filler'
    );

    let state = registerCards(session.state!, [
      ginko,
      discard,
      milledMember,
      milledLive,
      milledFiller,
      deckFiller,
    ]);
    const p1 = state.players[0] as unknown as {
      hand: { cardIds: string[] };
      mainDeck: { cardIds: string[] };
      waitingRoom: { cardIds: string[] };
      successZone: { cardIds: string[] };
      liveZone: { cardIds: string[] };
      energyZone: {
        cardIds: string[];
        cardStates: Map<string, { orientation: OrientationState; face: FaceState }>;
      };
      memberSlots: {
        slots: Record<SlotPosition, string | null>;
        cardStates: Map<string, { orientation: OrientationState; face: FaceState }>;
      };
    };
    const energyCardIds = [...state.cardRegistry.values()]
      .filter((card) => card.ownerId === PLAYER1 && card.data.cardType === CardType.ENERGY)
      .map((card) => card.instanceId);

    expect(energyCardIds.length).toBeGreaterThanOrEqual(5);

    removeFromPlayerZones(p1);
    p1.hand.cardIds = [ginko.instanceId, discard.instanceId];
    p1.mainDeck.cardIds = [
      milledMember.instanceId,
      milledLive.instanceId,
      milledFiller.instanceId,
      deckFiller.instanceId,
    ];
    p1.memberSlots.slots[SlotPosition.CENTER] = null;
    p1.memberSlots.cardStates = new Map();
    setActiveEnergy(p1, energyCardIds.slice(0, 5));
    (session as unknown as { authorityState: GameState }).authorityState = state;

    const playResult = session.executeCommand(
      createPlayMemberToSlotCommand(PLAYER1, ginko.instanceId, SlotPosition.CENTER)
    );

    expect(playResult.success).toBe(true);

    const discardResult = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id, discard.instanceId)
    );

    expect(discardResult.success).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(
      session.state?.players[0].energyZone.cardStates.get(energyCardIds[4]!)?.orientation
    ).toBe(OrientationState.WAITING);
    expect(session.state?.players[0].mainDeck.cardIds).toEqual([deckFiller.instanceId]);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([
      discard.instanceId,
      milledMember.instanceId,
      milledLive.instanceId,
      milledFiller.instanceId,
    ]);
    expect(
      session.state?.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId ===
            HS_PB1_004_ON_ENTER_PAY_ENERGY_DISCARD_MILL_RECOVER_CERISE_LIVE_ABILITY_ID &&
          action.payload.step === 'NO_CERISE_LIVE_TARGET' &&
          Array.isArray(action.payload.milledCardIds) &&
          action.payload.milledCardIds.length === 3
      )
    ).toBe(true);
  });

  it('executes PL!HS-pb1-020-N on-enter discard two and recovers a Cerise Bouquet member plus Hasunosora Live', () => {
    const session = createGameSession();
    const deck = createDeck();

    session.createGame(
      'sample-hs-pb1-020-on-enter-discard-two-recover-groups',
      PLAYER1,
      'Player 1',
      PLAYER2,
      'Player 2'
    );
    session.initializeGame(deck, deck);
    forceMainPhaseForPlayer(session);

    const ginko = createCardInstance(
      createMemberCard('PL!HS-pb1-020-N', '百生吟子', 9, '蓮ノ空'),
      PLAYER1,
      'p1-pb1-020-ginko'
    );
    const discardA = createCardInstance(
      createMemberCard('PL!HS-test-pb1-020-discard-a', '日野下花帆', 1, '蓮ノ空'),
      PLAYER1,
      'p1-pb1-020-discard-a'
    );
    const discardB = createCardInstance(
      createMemberCard('PL!HS-test-pb1-020-discard-b', '村野さやか', 1, '蓮ノ空'),
      PLAYER1,
      'p1-pb1-020-discard-b'
    );
    const ceriseMember = createCardInstance(
      {
        ...createMemberCard('PL!HS-test-pb1-020-cerise-member', '乙宗梢', 4, '蓮ノ空'),
        unitName: 'スリーズブーケ',
      },
      PLAYER1,
      'p1-pb1-020-cerise-member'
    );
    const hasunosoraLive = createCardInstance(
      createLiveCard('PL!HS-test-pb1-020-hasu-live', '蓮ノ空 LIVE', '蓮ノ空'),
      PLAYER1,
      'p1-pb1-020-hasu-live'
    );
    const otherLiveA = createCardInstance(
      createLiveCard('PL!-test-pb1-020-other-live-a', "μ's LIVE A", "μ's"),
      PLAYER1,
      'p1-pb1-020-other-live-a'
    );
    const otherLiveB = createCardInstance(
      createLiveCard('PL!-test-pb1-020-other-live-b', "μ's LIVE B", "μ's"),
      PLAYER1,
      'p1-pb1-020-other-live-b'
    );
    const deckFiller = createCardInstance(
      createMemberCard('PL!HS-test-pb1-020-deck-filler', '大沢瑠璃乃', 1, '蓮ノ空'),
      PLAYER1,
      'p1-pb1-020-deck-filler'
    );

    let state = registerCards(session.state!, [
      ginko,
      discardA,
      discardB,
      ceriseMember,
      hasunosoraLive,
      otherLiveA,
      otherLiveB,
      deckFiller,
    ]);
    const p1 = state.players[0] as unknown as {
      hand: { cardIds: string[] };
      mainDeck: { cardIds: string[] };
      waitingRoom: { cardIds: string[] };
      successZone: { cardIds: string[] };
      liveZone: { cardIds: string[] };
      energyZone: {
        cardIds: string[];
        cardStates: Map<string, { orientation: OrientationState; face: FaceState }>;
      };
      memberSlots: {
        slots: Record<SlotPosition, string | null>;
        cardStates: Map<string, { orientation: OrientationState; face: FaceState }>;
      };
    };
    const energyCardIds = [...state.cardRegistry.values()]
      .filter((card) => card.ownerId === PLAYER1 && card.data.cardType === CardType.ENERGY)
      .map((card) => card.instanceId);

    expect(energyCardIds.length).toBeGreaterThanOrEqual(9);

    removeFromPlayerZones(p1);
    p1.hand.cardIds = [ginko.instanceId, discardA.instanceId, discardB.instanceId];
    p1.mainDeck.cardIds = [deckFiller.instanceId];
    p1.waitingRoom.cardIds = [
      hasunosoraLive.instanceId,
      otherLiveA.instanceId,
      otherLiveB.instanceId,
      ceriseMember.instanceId,
    ];
    p1.memberSlots.slots[SlotPosition.CENTER] = null;
    p1.memberSlots.cardStates = new Map();
    setActiveEnergy(p1, energyCardIds.slice(0, 9));
    (session as unknown as { authorityState: GameState }).authorityState = state;

    const playResult = session.executeCommand(
      createPlayMemberToSlotCommand(PLAYER1, ginko.instanceId, SlotPosition.CENTER)
    );

    expect(playResult.success).toBe(true);
    expect(session.state?.activeEffect?.abilityId).toBe(
      HS_PB1_020_ON_ENTER_DISCARD_TWO_RECOVER_CERISE_MEMBER_AND_HASUNOSORA_LIVE_ABILITY_ID
    );
    expect(session.state?.activeEffect?.selectableCardMode).toBe('ORDERED_MULTI');
    expect(session.state?.activeEffect?.selectableCardVisibility).toBe('AWAITING_PLAYER_ONLY');
    expect(session.state?.activeEffect?.selectableCardIds).toEqual([
      discardA.instanceId,
      discardB.instanceId,
    ]);

    const discardResult = session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        session.state!.activeEffect!.id,
        undefined,
        undefined,
        undefined,
        undefined,
        [discardA.instanceId, discardB.instanceId]
      )
    );

    expect(discardResult.success).toBe(true);
    expect(session.state?.activeEffect?.stepId).toBe(
      'HS_PB1_020_SELECT_CERISE_MEMBER_AND_HASUNOSORA_LIVE'
    );
    expect(session.state?.activeEffect?.selectableCardMode).toBe('ORDERED_MULTI');
    expect(session.state?.activeEffect?.minSelectableCards).toBe(2);
    expect(session.state?.activeEffect?.maxSelectableCards).toBe(2);
    expect(session.state?.activeEffect?.selectableCardIds).toEqual([
      hasunosoraLive.instanceId,
      ceriseMember.instanceId,
    ]);
    expect(session.state?.activeEffect?.selectableCardIds).not.toContain(discardA.instanceId);
    expect(session.state?.activeEffect?.selectableCardIds).not.toContain(discardB.instanceId);

    const staleDiscardSelectionResult = session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        session.state!.activeEffect!.id,
        undefined,
        undefined,
        undefined,
        undefined,
        [discardA.instanceId, discardB.instanceId]
      )
    );

    expect(staleDiscardSelectionResult.success).toBe(false);
    expect(session.state?.activeEffect?.stepId).toBe(
      'HS_PB1_020_SELECT_CERISE_MEMBER_AND_HASUNOSORA_LIVE'
    );
    expect(session.state?.players[0].hand.cardIds).toEqual([]);

    const invalidRecoverResult = session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        session.state!.activeEffect!.id,
        undefined,
        undefined,
        undefined,
        undefined,
        [hasunosoraLive.instanceId]
      )
    );

    expect(invalidRecoverResult.success).toBe(false);
    expect(session.state?.players[0].hand.cardIds).toEqual([]);

    const recoverResult = session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        session.state!.activeEffect!.id,
        undefined,
        undefined,
        undefined,
        undefined,
        [ceriseMember.instanceId, hasunosoraLive.instanceId]
      )
    );

    expect(recoverResult.success).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].hand.cardIds).toEqual([
      ceriseMember.instanceId,
      hasunosoraLive.instanceId,
    ]);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([
      otherLiveA.instanceId,
      otherLiveB.instanceId,
      discardA.instanceId,
      discardB.instanceId,
    ]);
    expect(session.state?.players[0].mainDeck.cardIds).toEqual([deckFiller.instanceId]);
  });

  it('skips PL!HS-pb1-020-N on-enter grouped recovery when the precondition is not met', () => {
    const notEnoughLiveContext = setupHsPb1020GinkoScenario({
      recoveryTargets: 'none',
      waitingRoomLiveCount: 2,
    });

    expect(notEnoughLiveContext.session.state?.activeEffect).toBeNull();
    expect(notEnoughLiveContext.session.state?.players[0].hand.cardIds).toEqual([
      notEnoughLiveContext.discardA.instanceId,
      notEnoughLiveContext.discardB.instanceId,
    ]);
    expect(
      notEnoughLiveContext.session.state?.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId ===
            HS_PB1_020_ON_ENTER_DISCARD_TWO_RECOVER_CERISE_MEMBER_AND_HASUNOSORA_LIVE_ABILITY_ID &&
          action.payload.step === 'CONDITION_NOT_MET' &&
          action.payload.waitingRoomLiveCount === 2
      )
    ).toBe(true);

    const notEnoughHandContext = setupHsPb1020GinkoScenario({
      handDiscardCount: 1,
      recoveryTargets: 'none',
    });

    expect(notEnoughHandContext.session.state?.activeEffect).toBeNull();
    expect(notEnoughHandContext.session.state?.players[0].hand.cardIds).toEqual([
      notEnoughHandContext.discardA.instanceId,
    ]);
    expect(
      notEnoughHandContext.session.state?.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId ===
            HS_PB1_020_ON_ENTER_DISCARD_TWO_RECOVER_CERISE_MEMBER_AND_HASUNOSORA_LIVE_ABILITY_ID &&
          action.payload.step === 'NOT_ENOUGH_HAND_TO_DISCARD' &&
          action.payload.handCount === 1
      )
    ).toBe(true);
  });

  it('keeps PL!HS-pb1-020-N discard cost when no grouped recovery target exists after payment', () => {
    const context = setupHsPb1020GinkoScenario({ recoveryTargets: 'none' });

    expect(context.session.state?.activeEffect?.abilityId).toBe(
      HS_PB1_020_ON_ENTER_DISCARD_TWO_RECOVER_CERISE_MEMBER_AND_HASUNOSORA_LIVE_ABILITY_ID
    );

    const discardResult = context.session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        context.session.state!.activeEffect!.id,
        undefined,
        undefined,
        undefined,
        undefined,
        [context.discardA.instanceId, context.discardB.instanceId]
      )
    );

    expect(discardResult.success).toBe(true);
    expect(context.session.state?.activeEffect).toBeNull();
    expect(context.session.state?.players[0].hand.cardIds).toEqual([]);
    expect(context.session.state?.players[0].waitingRoom.cardIds).toEqual([
      context.otherLiveA.instanceId,
      context.otherLiveB.instanceId,
      context.otherLiveC.instanceId,
      context.discardA.instanceId,
      context.discardB.instanceId,
    ]);
    expect(
      context.session.state?.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId ===
            HS_PB1_020_ON_ENTER_DISCARD_TWO_RECOVER_CERISE_MEMBER_AND_HASUNOSORA_LIVE_ABILITY_ID &&
          action.payload.step === 'DISCARD_TWO_NO_RECOVERY_TARGET' &&
          Array.isArray(action.payload.discardedHandCardIds) &&
          action.payload.discardedHandCardIds.length === 2
      )
    ).toBe(true);
  });

  it('requires PL!HS-pb1-020-N to recover an available single grouped target', () => {
    const context = setupHsPb1020GinkoScenario({ recoveryTargets: 'ceriseOnly' });

    const discardResult = context.session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        context.session.state!.activeEffect!.id,
        undefined,
        undefined,
        undefined,
        undefined,
        [context.discardA.instanceId, context.discardB.instanceId]
      )
    );

    expect(discardResult.success).toBe(true);
    expect(context.session.state?.activeEffect?.stepId).toBe(
      'HS_PB1_020_SELECT_CERISE_MEMBER_AND_HASUNOSORA_LIVE'
    );
    expect(context.session.state?.activeEffect?.minSelectableCards).toBe(1);
    expect(context.session.state?.activeEffect?.maxSelectableCards).toBe(1);
    expect(context.session.state?.activeEffect?.canSkipSelection).toBe(false);
    expect(context.session.state?.activeEffect?.selectableCardIds).toEqual([
      context.ceriseMember.instanceId,
    ]);

    const missingRequiredTargetResult = context.session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        context.session.state!.activeEffect!.id,
        undefined,
        undefined,
        undefined,
        undefined,
        []
      )
    );

    expect(missingRequiredTargetResult.success).toBe(false);
    expect(context.session.state?.activeEffect?.stepId).toBe(
      'HS_PB1_020_SELECT_CERISE_MEMBER_AND_HASUNOSORA_LIVE'
    );

    const recoverResult = context.session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        context.session.state!.activeEffect!.id,
        undefined,
        undefined,
        undefined,
        undefined,
        [context.ceriseMember.instanceId]
      )
    );

    expect(recoverResult.success).toBe(true);
    expect(context.session.state?.activeEffect).toBeNull();
    expect(context.session.state?.players[0].hand.cardIds).toEqual([
      context.ceriseMember.instanceId,
    ]);
  });

  it('allows PL!-bp6-005-P on-enter effect to decline the optional discard cost', () => {
    const context = setupBp6005RinOnEnterScenario();

    expect(context.session.state?.activeEffect?.abilityId).toBe(
      BP6_005_ON_ENTER_DISCARD_TWO_RECOVER_YELLOW_HEART_CARDS_ABILITY_ID
    );

    const declineResult = context.session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, context.session.state!.activeEffect!.id)
    );

    expect(declineResult.success).toBe(true);
    expect(context.session.state?.activeEffect).toBeNull();
    expect(context.session.state?.players[0].hand.cardIds).toEqual([
      context.discardA.instanceId,
      context.discardB.instanceId,
    ]);
    expect(context.session.state?.players[0].waitingRoom.cardIds).toEqual([
      context.yellowMember.instanceId,
      context.yellowLive.instanceId,
      context.pinkMember.instanceId,
      context.pinkLive.instanceId,
    ]);
  });

  it('skips PL!-bp6-005-P on-enter effect without discarding when hand has fewer than two cards', () => {
    const context = setupBp6005RinOnEnterScenario({ handDiscardCount: 1 });

    expect(context.session.state?.activeEffect).toBeNull();
    expect(context.session.state?.players[0].hand.cardIds).toEqual([context.discardA.instanceId]);
    expect(context.session.state?.players[0].waitingRoom.cardIds).toEqual([
      context.yellowMember.instanceId,
      context.yellowLive.instanceId,
      context.pinkMember.instanceId,
      context.pinkLive.instanceId,
    ]);
  });

  for (const testCase of [
    {
      label: 'no recovery targets',
      select: () => [],
      expectedHand: () => [],
      expectedWaitingRoomPrefix: (context: Bp6005RinScenario) => [
        context.yellowMember.instanceId,
        context.yellowLive.instanceId,
        context.pinkMember.instanceId,
        context.pinkLive.instanceId,
      ],
    },
    {
      label: 'only the yellow Heart member',
      select: (context: Bp6005RinScenario) => [context.yellowMember.instanceId],
      expectedHand: (context: Bp6005RinScenario) => [context.yellowMember.instanceId],
      expectedWaitingRoomPrefix: (context: Bp6005RinScenario) => [
        context.yellowLive.instanceId,
        context.pinkMember.instanceId,
        context.pinkLive.instanceId,
      ],
    },
    {
      label: 'only the yellow requirement LIVE',
      select: (context: Bp6005RinScenario) => [context.yellowLive.instanceId],
      expectedHand: (context: Bp6005RinScenario) => [context.yellowLive.instanceId],
      expectedWaitingRoomPrefix: (context: Bp6005RinScenario) => [
        context.yellowMember.instanceId,
        context.pinkMember.instanceId,
        context.pinkLive.instanceId,
      ],
    },
    {
      label: 'one card from each group',
      select: (context: Bp6005RinScenario) => [
        context.yellowMember.instanceId,
        context.yellowLive.instanceId,
      ],
      expectedHand: (context: Bp6005RinScenario) => [
        context.yellowMember.instanceId,
        context.yellowLive.instanceId,
      ],
      expectedWaitingRoomPrefix: (context: Bp6005RinScenario) => [
        context.pinkMember.instanceId,
        context.pinkLive.instanceId,
      ],
    },
  ] as const) {
    it(`executes PL!-bp6-005-P on-enter recovery selecting ${testCase.label}`, () => {
      const context = setupBp6005RinOnEnterScenario();
      payBp6005DiscardCost(context);

      expect(context.session.state?.activeEffect?.stepId).toBe(
        'BP6_005_SELECT_WAITING_ROOM_YELLOW_HEART_CARDS'
      );
      expect(context.session.state?.activeEffect?.selectableCardMode).toBe('ORDERED_MULTI');
      expect(context.session.state?.activeEffect?.minSelectableCards).toBe(0);
      expect(context.session.state?.activeEffect?.maxSelectableCards).toBe(2);
      expect(context.session.state?.activeEffect?.selectableCardIds).toEqual([
        context.yellowMember.instanceId,
        context.yellowLive.instanceId,
      ]);
      expect(context.session.state?.activeEffect?.selectableCardIds).not.toContain(
        context.pinkMember.instanceId
      );
      expect(context.session.state?.activeEffect?.selectableCardIds).not.toContain(
        context.pinkLive.instanceId
      );

      const recoverResult = context.session.executeCommand(
        createConfirmEffectStepCommand(
          PLAYER1,
          context.session.state!.activeEffect!.id,
          undefined,
          undefined,
          undefined,
          undefined,
          testCase.select(context)
        )
      );

      expect(recoverResult.success).toBe(true);
      expect(context.session.state?.activeEffect).toBeNull();
      expect(context.session.state?.players[0].hand.cardIds).toEqual(
        testCase.expectedHand(context)
      );
      expect(context.session.state?.players[0].waitingRoom.cardIds).toEqual([
        ...testCase.expectedWaitingRoomPrefix(context),
        context.discardA.instanceId,
        context.discardB.instanceId,
      ]);
    });
  }

  it('rejects PL!-bp6-005-P recovery selection with more than one card from the same group', () => {
    const context = setupBp6005RinOnEnterScenario({ includeSecondYellowMember: true });
    payBp6005DiscardCost(context);

    expect(context.session.state?.activeEffect?.selectableCardIds).toEqual([
      context.yellowMember.instanceId,
      context.yellowLive.instanceId,
      context.secondYellowMember.instanceId,
    ]);

    const invalidRecoverResult = context.session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        context.session.state!.activeEffect!.id,
        undefined,
        undefined,
        undefined,
        undefined,
        [context.yellowMember.instanceId, context.secondYellowMember.instanceId]
      )
    );

    expect(invalidRecoverResult.success).toBe(false);
    expect(context.session.state?.activeEffect?.stepId).toBe(
      'BP6_005_SELECT_WAITING_ROOM_YELLOW_HEART_CARDS'
    );
    expect(context.session.state?.players[0].hand.cardIds).toEqual([]);
    expect(context.session.state?.players[0].waitingRoom.cardIds).toEqual([
      context.yellowMember.instanceId,
      context.yellowLive.instanceId,
      context.pinkMember.instanceId,
      context.pinkLive.instanceId,
      context.secondYellowMember.instanceId,
      context.discardA.instanceId,
      context.discardB.instanceId,
    ]);

    const recoverResult = context.session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        context.session.state!.activeEffect!.id,
        undefined,
        undefined,
        undefined,
        undefined,
        [context.yellowMember.instanceId, context.yellowLive.instanceId]
      )
    );

    expect(recoverResult.success).toBe(true);
    expect(context.session.state?.activeEffect).toBeNull();
    expect(context.session.state?.players[0].hand.cardIds).toEqual([
      context.yellowMember.instanceId,
      context.yellowLive.instanceId,
    ]);
  });

  it('executes PL!HS-PR-019-RM on-enter mill three and gains green Heart when all milled cards are green-heart members', () => {
    const session = createGameSession();
    const deck = createDeck();

    session.createGame(
      'sample-hs-pr-019-on-enter-green-heart-runner',
      PLAYER1,
      'Player 1',
      PLAYER2,
      'Player 2'
    );
    session.initializeGame(deck, deck);
    forceMainPhaseForPlayer(session);

    const ginko = createCardInstance(
      {
        ...createMemberCard('PL!HS-PR-019-RM', '百生 吟子', 2, '蓮ノ空'),
        hearts: [createHeartIcon(HeartColor.GREEN, 1)],
      },
      PLAYER1,
      'p1-pr-019-ginko'
    );
    const greenMembers = Array.from({ length: 3 }, (_, index) =>
      createCardInstance(
        {
          ...createMemberCard(
            `PL!HS-test-pr-019-green-${index}`,
            `緑メンバー${index}`,
            1,
            '蓮ノ空'
          ),
          hearts: [createHeartIcon(HeartColor.GREEN, 1)],
        },
        PLAYER1,
        `p1-pr-019-green-${index}`
      )
    );
    const deckFiller = createCardInstance(
      createMemberCard('PL!HS-test-pr-019-filler', '乙宗梢', 1, '蓮ノ空'),
      PLAYER1,
      'p1-pr-019-filler'
    );

    let state = registerCards(session.state!, [ginko, ...greenMembers, deckFiller]);
    const p1 = state.players[0] as unknown as {
      hand: { cardIds: string[] };
      mainDeck: { cardIds: string[] };
      waitingRoom: { cardIds: string[] };
      successZone: { cardIds: string[] };
      liveZone: { cardIds: string[] };
      energyZone: {
        cardIds: string[];
        cardStates: Map<string, { orientation: OrientationState; face: FaceState }>;
      };
      memberSlots: {
        slots: Record<SlotPosition, string | null>;
        cardStates: Map<string, { orientation: OrientationState; face: FaceState }>;
      };
    };
    const energyCardIds = [...state.cardRegistry.values()]
      .filter((card) => card.ownerId === PLAYER1 && card.data.cardType === CardType.ENERGY)
      .map((card) => card.instanceId);

    expect(energyCardIds.length).toBeGreaterThanOrEqual(2);

    removeFromPlayerZones(p1);
    p1.hand.cardIds = [ginko.instanceId];
    p1.mainDeck.cardIds = [...greenMembers.map((card) => card.instanceId), deckFiller.instanceId];
    p1.memberSlots.slots[SlotPosition.CENTER] = null;
    p1.memberSlots.cardStates = new Map();
    setActiveEnergy(p1, energyCardIds.slice(0, 2));
    (session as unknown as { authorityState: GameState }).authorityState = state;

    const playResult = session.executeCommand(
      createPlayMemberToSlotCommand(PLAYER1, ginko.instanceId, SlotPosition.CENTER)
    );

    expect(playResult.success).toBe(true);
    expect(session.state?.activeEffect?.abilityId).toBe(
      HS_PR_019_ON_ENTER_MILL_GAIN_GREEN_HEART_ABILITY_ID
    );
    expect(session.state?.activeEffect?.inspectionCardIds).toEqual(
      greenMembers.map((card) => card.instanceId)
    );
    expect(session.state?.inspectionZone.cardIds).toEqual(
      greenMembers.map((card) => card.instanceId)
    );
    expect(session.state?.inspectionZone.revealedCardIds).toEqual(
      greenMembers.map((card) => card.instanceId)
    );
    expect(session.state?.players[0].mainDeck.cardIds).toEqual([deckFiller.instanceId]);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([]);
    expect(session.state?.liveResolution.liveModifiers).not.toContainEqual({
      kind: 'HEART',
      target: 'SOURCE_MEMBER',
      playerId: PLAYER1,
      hearts: [{ color: HeartColor.GREEN, count: 1 }],
      sourceCardId: ginko.instanceId,
      abilityId: HS_PR_019_ON_ENTER_MILL_GAIN_GREEN_HEART_ABILITY_ID,
    });

    const confirmResult = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id)
    );

    expect(confirmResult.success).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.inspectionZone.cardIds).toEqual([]);
    expect(session.state?.inspectionZone.revealedCardIds).toEqual([]);
    expect(session.state?.inspectionContext).toBeNull();
    expect(session.state?.players[0].mainDeck.cardIds).toEqual([deckFiller.instanceId]);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual(
      greenMembers.map((card) => card.instanceId)
    );
    expect(session.state?.liveResolution.liveModifiers).toContainEqual({
      kind: 'HEART',
      target: 'SOURCE_MEMBER',
      playerId: PLAYER1,
      hearts: [{ color: HeartColor.GREEN, count: 1 }],
      sourceCardId: ginko.instanceId,
      abilityId: HS_PR_019_ON_ENTER_MILL_GAIN_GREEN_HEART_ABILITY_ID,
    });
  });

  it('executes LL-bp1-001-R+ on-enter member recovery from waiting room', () => {
    const session = createGameSession();
    const deck = createDeck();

    session.createGame(
      'sample-ll-bp1-001-on-enter-recovery-runner',
      PLAYER1,
      'Player 1',
      PLAYER2,
      'Player 2'
    );
    session.initializeGame(deck, deck);
    forceMainPhaseForPlayer(session);

    const state = session.state!;
    const p1 = state.players[0] as unknown as {
      hand: { cardIds: string[] };
      waitingRoom: { cardIds: string[] };
      mainDeck: { cardIds: string[] };
      successZone: { cardIds: string[] };
      liveZone: { cardIds: string[] };
      energyZone: {
        cardIds: string[];
        cardStates: Map<string, { orientation: OrientationState; face: FaceState }>;
      };
      memberSlots: { slots: Record<SlotPosition, string | null> };
    };

    const ownedP1CardIds = [...state.cardRegistry.values()]
      .filter((card) => card.ownerId === PLAYER1)
      .map((card) => card.instanceId);
    const llCardId = ownedP1CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardCode === 'LL-bp1-001-R+'
    );
    const memberCardIds = ownedP1CardIds.filter(
      (cardId) =>
        cardId !== llCardId && state.cardRegistry.get(cardId)?.data.cardType === CardType.MEMBER
    );
    const liveCardId = ownedP1CardIds.find(
      (cardId) =>
        cardId !== llCardId &&
        cardId !== memberCardIds[0] &&
        state.cardRegistry.get(cardId)?.data.cardType === CardType.LIVE
    );
    const selectedMemberCardId = memberCardIds[0];
    const llDeckFillCardId = ownedP1CardIds.find(
      (cardId) =>
        cardId !== llCardId &&
        cardId !== selectedMemberCardId &&
        cardId !== liveCardId &&
        state.cardRegistry.get(cardId)?.data.cardType === CardType.MEMBER
    );

    expect(llCardId).toBeTruthy();
    expect(selectedMemberCardId).toBeTruthy();

    removeFromPlayerZones(p1);
    const energyCardIds = [...state.cardRegistry.values()]
      .filter((card) => card.ownerId === PLAYER1 && card.data.cardType === CardType.ENERGY)
      .map((card) => card.instanceId);
    setActiveEnergy(p1, energyCardIds);
    p1.hand.cardIds = [llCardId!];
    p1.waitingRoom.cardIds = [selectedMemberCardId!, liveCardId!];
    p1.mainDeck.cardIds = [llDeckFillCardId!];
    p1.memberSlots.slots[SlotPosition.CENTER] = null;

    const playResult = session.executeCommand(
      createPlayMemberToSlotCommand(PLAYER1, llCardId!, SlotPosition.CENTER)
    );

    expect(playResult.success).toBe(true);
    expect(session.state?.activeEffect?.abilityId).toBe(
      LL_BP1_001_ON_ENTER_RECOVER_MEMBER_ABILITY_ID
    );
    expect(session.state?.players[0].waitingRoom.cardIds).toContain(selectedMemberCardId!);
    expect(session.state?.players[0].waitingRoom.cardIds).toContain(liveCardId!);
    expect(session.state?.activeEffect?.selectableCardIds).toEqual([selectedMemberCardId]);
    expect(session.state?.activeEffect?.metadata?.zoneSelection).toMatchObject({
      source: 'WAITING_ROOM',
      destination: 'HAND',
      minCount: 0,
      maxCount: 1,
      optional: true,
    });

    const confirmResult = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id, selectedMemberCardId)
    );

    expect(confirmResult.success).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].hand.cardIds).toEqual([selectedMemberCardId]);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([liveCardId!]);
  });

  it('executes LL-bp1-001-R+ live-start discard three named hand cards for score +3', () => {
    const session = createGameSession();
    const deck = createDeck();

    session.createGame(
      'sample-ll-bp1-001-live-start-score-runner',
      PLAYER1,
      'Player 1',
      PLAYER2,
      'Player 2'
    );
    session.initializeGame(deck, deck);

    const state = session.state!;
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
    const ownedP1CardIds = [...state.cardRegistry.values()]
      .filter((card) => card.ownerId === PLAYER1)
      .map((card) => card.instanceId);
    const sourceCardId = ownedP1CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardCode === 'LL-bp1-001-R+'
    );
    const liveCardId = ownedP1CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardType === CardType.LIVE
    );
    const handCandidateIds = ownedP1CardIds.filter((cardId) => {
      const card = state.cardRegistry.get(cardId);
      return cardId !== sourceCardId && card?.data.cardType === CardType.MEMBER;
    });
    const [ayumuCardId, kanonCardId, kahoCardId, nonMatchingCardId] = handCandidateIds;

    expect(sourceCardId).toBeTruthy();
    expect(liveCardId).toBeTruthy();
    expect(kahoCardId).toBeTruthy();
    expect(nonMatchingCardId).toBeTruthy();

    (state.cardRegistry.get(ayumuCardId) as unknown as { data: MemberCardData }).data =
      createMemberCard('PL!N-test-ayumu', '上原 步梦', 4);
    (state.cardRegistry.get(kanonCardId) as unknown as { data: MemberCardData }).data =
      createMemberCard('PL!SP-test-kanon', '涩谷 香音', 4);
    (state.cardRegistry.get(kahoCardId) as unknown as { data: MemberCardData }).data =
      createMemberCard('PL!HS-test-kaho', '日野下花帆', 4);
    (state.cardRegistry.get(nonMatchingCardId) as unknown as { data: MemberCardData }).data =
      createMemberCard('PL!N-test-karin', '朝香果林', 4);

    removeFromPlayerZones(p1);
    p1.memberSlots.slots[SlotPosition.CENTER] = sourceCardId!;
    p1.memberSlots.cardStates = new Map([
      [sourceCardId!, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
    ]);
    p1.hand.cardIds = [ayumuCardId, kanonCardId, kahoCardId, nonMatchingCardId];
    p1.liveZone.cardIds = [liveCardId!];
    p1.liveZone.cardStates = new Map([
      [liveCardId!, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_DOWN }],
    ]);

    advanceToLiveStartEffects(session);

    expect(session.state?.activeEffect?.abilityId).toBe(
      LL_BP1_001_LIVE_START_DISCARD_SCORE_ABILITY_ID
    );
    expect(session.state?.activeEffect?.selectableCardIds).toEqual([
      ayumuCardId,
      kanonCardId,
      kahoCardId,
    ]);
    expect(session.state?.activeEffect?.minSelectableCards).toBe(3);
    expect(session.state?.activeEffect?.maxSelectableCards).toBe(3);

    const confirmResult = session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        session.state!.activeEffect!.id,
        undefined,
        null,
        undefined,
        null,
        [ayumuCardId, kanonCardId, kahoCardId]
      )
    );

    expect(confirmResult.success).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].hand.cardIds).toEqual([nonMatchingCardId]);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([
      ayumuCardId,
      kanonCardId,
      kahoCardId,
    ]);
    expect(session.state?.liveResolution.liveModifiers).toContainEqual({
      kind: 'SCORE',
      playerId: PLAYER1,
      countDelta: 3,
      sourceCardId: sourceCardId!,
      abilityId: LL_BP1_001_LIVE_START_DISCARD_SCORE_ABILITY_ID,
    });
  });

  it('executes LL-bp2-001-R+ live-start discard named hand cards for matching blade count', () => {
    const session = createGameSession();
    const deck = createDeck();

    session.createGame(
      'sample-ll-bp2-001-live-start-blade-runner',
      PLAYER1,
      'Player 1',
      PLAYER2,
      'Player 2'
    );
    session.initializeGame(deck, deck);

    const state = session.state!;
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
    const ownedP1CardIds = [...state.cardRegistry.values()]
      .filter((card) => card.ownerId === PLAYER1)
      .map((card) => card.instanceId);
    const liveCardId = ownedP1CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardType === CardType.LIVE
    );
    const memberCardIds = ownedP1CardIds.filter(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardType === CardType.MEMBER
    );
    const [sourceCardId, youCardId, copyCardId, nonMatchingCardId] = memberCardIds;

    expect(sourceCardId).toBeTruthy();
    expect(liveCardId).toBeTruthy();
    expect(copyCardId).toBeTruthy();
    expect(nonMatchingCardId).toBeTruthy();

    (state.cardRegistry.get(sourceCardId) as unknown as { data: MemberCardData }).data =
      createMemberCard('LL-bp2-001-R+', '渡边 曜&鬼冢夏美&大泽瑠璃乃', 20);
    (state.cardRegistry.get(youCardId) as unknown as { data: MemberCardData }).data =
      createMemberCard('PL!S-test-you', '渡边 曜', 4);
    (state.cardRegistry.get(copyCardId) as unknown as { data: MemberCardData }).data =
      createMemberCard('LL-bp2-001-R+', '渡边 曜&鬼冢夏美&大泽瑠璃乃', 20);
    (state.cardRegistry.get(nonMatchingCardId) as unknown as { data: MemberCardData }).data =
      createMemberCard('PL!N-test-karin', '朝香果林', 4);

    removeFromPlayerZones(p1);
    p1.memberSlots.slots[SlotPosition.CENTER] = sourceCardId;
    p1.memberSlots.cardStates = new Map([
      [sourceCardId, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
    ]);
    p1.hand.cardIds = [youCardId, copyCardId, nonMatchingCardId];
    p1.liveZone.cardIds = [liveCardId!];
    p1.liveZone.cardStates = new Map([
      [liveCardId!, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_DOWN }],
    ]);

    advanceToLiveStartEffects(session);

    expect(session.state?.activeEffect?.abilityId).toBe(
      LL_BP2_001_LIVE_START_DISCARD_BLADE_ABILITY_ID
    );
    expect(session.state?.activeEffect?.selectableCardIds).toEqual([youCardId, copyCardId]);
    expect(session.state?.activeEffect?.minSelectableCards).toBe(1);
    expect(session.state?.activeEffect?.maxSelectableCards).toBe(2);

    const confirmResult = session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        session.state!.activeEffect!.id,
        undefined,
        null,
        undefined,
        null,
        [youCardId, copyCardId]
      )
    );

    expect(confirmResult.success).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].hand.cardIds).toEqual([nonMatchingCardId]);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([youCardId, copyCardId]);
    expect(session.state?.liveResolution.liveModifiers).toContainEqual({
      kind: 'BLADE',
      playerId: PLAYER1,
      countDelta: 2,
      sourceCardId,
      abilityId: LL_BP2_001_LIVE_START_DISCARD_BLADE_ABILITY_ID,
    });
  });

  it('executes PL!HS-PR-001-PR on-enter discard then takes one of top three', () => {
    const session = createGameSession();
    const deck = createDeck();

    session.createGame(
      'sample-hs-pr-001-on-enter-discard-look-top-runner',
      PLAYER1,
      'Player 1',
      PLAYER2,
      'Player 2'
    );
    session.initializeGame(deck, deck);
    forceMainPhaseForPlayer(session);

    const state = session.state!;
    const p1 = state.players[0] as unknown as {
      hand: { cardIds: string[] };
      mainDeck: { cardIds: string[] };
      waitingRoom: { cardIds: string[] };
      successZone: { cardIds: string[] };
      liveZone: { cardIds: string[] };
      energyZone: {
        cardIds: string[];
        cardStates: Map<string, { orientation: OrientationState; face: FaceState }>;
      };
      memberSlots: { slots: Record<SlotPosition, string | null> };
    };

    const ownedP1CardIds = [...state.cardRegistry.values()]
      .filter((card) => card.ownerId === PLAYER1)
      .map((card) => card.instanceId);
    const prCardId = ownedP1CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardCode === 'PL!HS-PR-001-PR'
    );
    const discardCardId = ownedP1CardIds.find(
      (cardId) =>
        cardId !== prCardId && state.cardRegistry.get(cardId)?.data.cardType === CardType.MEMBER
    );
    const inspectedCardIds = ownedP1CardIds.filter(
      (cardId) =>
        cardId !== prCardId &&
        cardId !== discardCardId &&
        state.cardRegistry.get(cardId)?.data.cardType === CardType.MEMBER
    );
    const unrevealedCardId = inspectedCardIds[3];
    const selectedCardId = inspectedCardIds[0];

    expect(prCardId).toBeTruthy();
    expect(discardCardId).toBeTruthy();
    expect(inspectedCardIds.length).toBeGreaterThanOrEqual(4);
    expect(unrevealedCardId).toBeTruthy();
    expect(selectedCardId).toBeTruthy();

    removeFromPlayerZones(p1);
    const energyCardIds = [...state.cardRegistry.values()]
      .filter((card) => card.ownerId === PLAYER1 && card.data.cardType === CardType.ENERGY)
      .map((card) => card.instanceId);
    setActiveEnergy(p1, energyCardIds);
    p1.hand.cardIds = [prCardId!, discardCardId!];
    p1.mainDeck.cardIds = [
      inspectedCardIds[0],
      inspectedCardIds[1],
      inspectedCardIds[2],
      unrevealedCardId,
    ];
    p1.memberSlots.slots[SlotPosition.CENTER] = null;

    const playResult = session.executeCommand(
      createPlayMemberToSlotCommand(PLAYER1, prCardId!, SlotPosition.CENTER)
    );

    expect(playResult.success).toBe(true);
    expect(session.state?.activeEffect?.abilityId).toBe(GENERIC_DISCARD_LOOK_TOP_ABILITY_ID);
    expect(session.state?.activeEffect?.selectionLabel).toBe('请选择要放置入休息室的卡牌');
    expect(session.state?.activeEffect?.selectableCardIds).toEqual([discardCardId]);

    const discardResult = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id, discardCardId!)
    );

    expect(discardResult.success).toBe(true);
    expect(session.state?.inspectionZone.cardIds).toEqual([
      inspectedCardIds[0],
      inspectedCardIds[1],
      inspectedCardIds[2],
    ]);
    expect(session.state?.activeEffect?.selectableCardIds).toEqual([
      inspectedCardIds[0],
      inspectedCardIds[1],
      inspectedCardIds[2],
    ]);

    const takeResult = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id, selectedCardId)
    );

    expect(takeResult.success).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].hand.cardIds).toEqual([selectedCardId]);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([
      discardCardId,
      inspectedCardIds[1],
      inspectedCardIds[2],
    ]);
  });

  it('executes PL!HS-PR-001-PR live-start pay2 and gains one Blade', () => {
    const session = createGameSession();
    const deck = createDeck();

    session.createGame(
      'sample-hs-pr-001-live-start-blade-runner',
      PLAYER1,
      'Player 1',
      PLAYER2,
      'Player 2'
    );
    session.initializeGame(deck, deck);
    forceMainPhaseForPlayer(session);

    let state = session.state!;
    const p1 = state.players[0] as unknown as {
      hand: { cardIds: string[] };
      mainDeck: { cardIds: string[] };
      waitingRoom: { cardIds: string[] };
      successZone: { cardIds: string[] };
      liveZone: { cardIds: string[] };
      energyZone: {
        cardIds: string[];
        cardStates: Map<string, { orientation: OrientationState; face: FaceState }>;
      };
      memberSlots: {
        slots: Record<SlotPosition, string | null>;
        cardStates: Map<string, { orientation: OrientationState; face: FaceState }>;
      };
    };
    const ownedP1CardIds = [...state.cardRegistry.values()]
      .filter((card) => card.ownerId === PLAYER1)
      .map((card) => card.instanceId);
    const prCardId = ownedP1CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardCode === 'PL!HS-PR-001-PR'
    );
    const liveCardId = ownedP1CardIds.find(
      (cardId) =>
        cardId !== prCardId && state.cardRegistry.get(cardId)?.data.cardType === CardType.LIVE
    );
    const energyCardIds = ownedP1CardIds.filter(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardType === CardType.ENERGY
    );
    const prCard = state.cardRegistry.get(prCardId!) as unknown as { data: MemberCardData };

    expect(prCardId).toBeTruthy();
    expect(liveCardId).toBeTruthy();
    expect(energyCardIds.length).toBeGreaterThanOrEqual(2);
    prCard.data = createMemberCard('PL!HS-PR-001-PR', '日野下 花帆', 10, "μ's");

    removeFromPlayerZones(p1);
    p1.memberSlots.slots[SlotPosition.CENTER] = prCardId!;
    p1.memberSlots.cardStates = new Map([
      [prCardId!, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
    ]);
    p1.liveZone.cardIds = [liveCardId!];
    setActiveEnergy(p1, energyCardIds.slice(0, 2));
    state = {
      ...state,
      currentPhase: GamePhase.LIVE_SET_PHASE,
      currentSubPhase: SubPhase.LIVE_SET_SECOND_DRAW,
      currentTurnType: TurnType.LIVE_PHASE,
      activePlayerIndex: 0,
      firstPlayerIndex: 0,
      liveSetCompletedPlayers: [PLAYER1, PLAYER2],
    };

    const service = new GameService();
    const advanceResult = service.advancePhase(state);
    (session as unknown as { authorityState: GameState }).authorityState = advanceResult.gameState;

    expect(advanceResult.success).toBe(true);
    expect(session.state?.activeEffect?.abilityId).toBe(
      HS_PR_001_LIVE_START_PAY_TWO_ENERGY_GAIN_BLADE_ABILITY_ID
    );
    const activeEffectId = session.state!.activeEffect!.id;

    const payResult = session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        activeEffectId,
        undefined,
        undefined,
        undefined,
        'pay'
      )
    );

    expect(payResult.success).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].energyZone.cardStates.get(energyCardIds[0])?.orientation).toBe(
      OrientationState.WAITING
    );
    expect(session.state?.players[0].energyZone.cardStates.get(energyCardIds[1])?.orientation).toBe(
      OrientationState.WAITING
    );
    expect(session.state?.liveResolution.liveModifiers).toContainEqual({
      kind: 'BLADE',
      playerId: PLAYER1,
      countDelta: 1,
      sourceCardId: prCardId,
      abilityId: HS_PR_001_LIVE_START_PAY_TWO_ENERGY_GAIN_BLADE_ABILITY_ID,
    });
    expect(session.state?.actionHistory).toContainEqual(
      expect.objectContaining({
        type: 'PAY_COST',
        playerId: PLAYER1,
        payload: {
          pendingAbilityId: activeEffectId,
          abilityId: HS_PR_001_LIVE_START_PAY_TWO_ENERGY_GAIN_BLADE_ABILITY_ID,
          sourceCardId: prCardId,
          energyCardIds: [energyCardIds[0], energyCardIds[1]],
          amount: 2,
        },
      })
    );
    expect(session.state?.actionHistory).toContainEqual(
      expect.objectContaining({
        type: 'RESOLVE_ABILITY',
        playerId: PLAYER1,
        payload: {
          pendingAbilityId: activeEffectId,
          abilityId: HS_PR_001_LIVE_START_PAY_TWO_ENERGY_GAIN_BLADE_ABILITY_ID,
          sourceCardId: prCardId,
          step: 'PAY_ENERGY_GAIN_BLADE',
          paidEnergyCardIds: [energyCardIds[0], energyCardIds[1]],
          bladeBonus: 1,
        },
      })
    );
  });

  it('executes PL!-bp3-010-N on-enter by revealing a LIVE card from top five', () => {
    const session = createGameSession();
    const deck = createDeck();

    session.createGame(
      'sample-bp3-010-on-enter-live-reveal-runner',
      PLAYER1,
      'Player 1',
      PLAYER2,
      'Player 2'
    );
    session.initializeGame(deck, deck);
    forceMainPhaseForPlayer(session);

    const state = session.state!;
    const p1 = state.players[0] as unknown as {
      hand: { cardIds: string[] };
      mainDeck: { cardIds: string[] };
      waitingRoom: { cardIds: string[] };
      successZone: { cardIds: string[] };
      liveZone: { cardIds: string[] };
      energyZone: {
        cardIds: string[];
        cardStates: Map<string, { orientation: OrientationState; face: FaceState }>;
      };
      memberSlots: { slots: Record<SlotPosition, string | null> };
    };

    const ownedP1CardIds = [...state.cardRegistry.values()]
      .filter((card) => card.ownerId === PLAYER1)
      .map((card) => card.instanceId);
    const bp3CardId = ownedP1CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardCode === 'PL!-bp3-010-N'
    );
    const discardCardId = ownedP1CardIds.find(
      (cardId) =>
        cardId !== bp3CardId && state.cardRegistry.get(cardId)?.data.cardType === CardType.MEMBER
    );
    const liveCardId = ownedP1CardIds.find(
      (cardId) =>
        cardId !== bp3CardId &&
        state.cardRegistry.get(cardId)?.data.cardType === CardType.LIVE &&
        cardId !== discardCardId
    );
    const inspectedCardIds = ownedP1CardIds.filter(
      (cardId) =>
        cardId !== bp3CardId &&
        cardId !== discardCardId &&
        state.cardRegistry.get(cardId)?.data.cardType === CardType.MEMBER
    );
    const extraMemberId = inspectedCardIds[0];
    const unrevealedCardId = inspectedCardIds[1];
    const candidateLiveCards = ownedP1CardIds.filter(
      (cardId) =>
        cardId !== bp3CardId &&
        cardId !== discardCardId &&
        cardId !== extraMemberId &&
        cardId !== unrevealedCardId &&
        cardId !== liveCardId &&
        state.cardRegistry.get(cardId)?.data.cardType === CardType.LIVE
    );

    expect(bp3CardId).toBeTruthy();
    expect(discardCardId).toBeTruthy();
    expect(liveCardId).toBeTruthy();
    expect(candidateLiveCards.length).toBeGreaterThan(0);
    expect(extraMemberId).toBeTruthy();
    expect(unrevealedCardId).toBeTruthy();

    const topVisibleCardIds = [
      liveCardId!,
      extraMemberId!,
      candidateLiveCards[0],
      candidateLiveCards[1] ?? unrevealedCardId,
      unrevealedCardId,
    ];

    removeFromPlayerZones(p1);
    const energyCardIds = [...state.cardRegistry.values()]
      .filter((card) => card.ownerId === PLAYER1 && card.data.cardType === CardType.ENERGY)
      .map((card) => card.instanceId);
    setActiveEnergy(p1, energyCardIds);
    p1.hand.cardIds = [bp3CardId!, discardCardId!];
    p1.mainDeck.cardIds = topVisibleCardIds;
    p1.memberSlots.slots[SlotPosition.CENTER] = null;

    const playResult = session.executeCommand(
      createPlayMemberToSlotCommand(PLAYER1, bp3CardId!, SlotPosition.CENTER)
    );

    expect(playResult.success).toBe(true);
    expect(session.state?.activeEffect?.abilityId).toBe(BP3_010_ON_ENTER_LOOK_LIVE_EFFECT_ID);
    expect(session.state?.activeEffect?.selectionLabel).toBe('请选择要放置入休息室的卡牌');
    expect(session.state?.activeEffect?.selectableCardIds).toEqual([discardCardId]);

    const discardResult = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id, discardCardId!)
    );
    const inspectedLiveCount = session.state?.inspectionZone.cardIds.filter(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardType === CardType.LIVE
    ).length;

    expect(inspectedLiveCount).toBeGreaterThan(0);
    const inspectedLiveCountByPredicate = session.state!.inspectionZone.cardIds.filter(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardType === CardType.LIVE
    ).length;
    expect(inspectedLiveCountByPredicate).toBeGreaterThan(0);

    expect(discardResult.success).toBe(true);
    expect(session.state?.inspectionZone.cardIds).toEqual(topVisibleCardIds);
    expect(session.state?.activeEffect?.selectionLabel).toBe('请选择要加入手牌的LIVE卡');
    expect(session.state?.activeEffect?.canSkipSelection).toBe(true);
    const selectableLiveCardIds = session.state?.activeEffect?.selectableCardIds ?? [];
    expect(selectableLiveCardIds.length).toBeGreaterThan(0);
    expect(selectableLiveCardIds).toContain(liveCardId!);
    expect(
      selectableLiveCardIds.every(
        (cardId) => state.cardRegistry.get(cardId)?.data.cardType === CardType.LIVE
      )
    ).toBe(true);
    const selectedLiveCardId = selectableLiveCardIds[0];

    const selectLiveResult = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id, selectedLiveCardId)
    );

    expect(selectLiveResult.success).toBe(true);
    expect(session.state?.activeEffect).not.toBeNull();
    expect(session.state?.inspectionZone.revealedCardIds).toEqual([selectedLiveCardId]);
    expect(session.state?.players[0].hand.cardIds).toEqual([]);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([discardCardId]);

    const revealFinishResult = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id)
    );

    expect(revealFinishResult.success).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.inspectionZone.cardIds).toEqual([]);
    expect(session.state?.players[0].hand.cardIds).toContain(selectedLiveCardId);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual(
      expect.arrayContaining(topVisibleCardIds.filter((cardId) => cardId !== selectedLiveCardId))
    );
    expect(session.state?.players[0].waitingRoom.cardIds).toContain(discardCardId!);
  });

  it('executes PL!-bp5-005-AR on-enter to place active energy when success Live score is at least six', () => {
    const session = createGameSession();
    const deck = createDeck();

    session.createGame(
      'sample-bp5-005-on-enter-active-energy',
      PLAYER1,
      'Player 1',
      PLAYER2,
      'Player 2'
    );
    session.initializeGame(deck, deck);
    forceMainPhaseForPlayer(session);

    const state = session.state!;
    const p1 = state.players[0] as unknown as {
      hand: { cardIds: string[] };
      mainDeck: { cardIds: string[] };
      waitingRoom: { cardIds: string[] };
      successZone: { cardIds: string[] };
      liveZone: { cardIds: string[] };
      energyDeck: { cardIds: string[] };
      energyZone: {
        cardIds: string[];
        cardStates: Map<string, { orientation: OrientationState; face: FaceState }>;
      };
      memberSlots: { slots: Record<SlotPosition, string | null> };
    };
    const ownedP1CardIds = [...state.cardRegistry.values()]
      .filter((card) => card.ownerId === PLAYER1)
      .map((card) => card.instanceId);
    const rinCardId = ownedP1CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardCode === 'PL!-bp5-005-AR'
    );
    const successLiveCardIds = ownedP1CardIds
      .filter((cardId) => state.cardRegistry.get(cardId)?.data.cardType === CardType.LIVE)
      .slice(0, 2);

    expect(rinCardId).toBeTruthy();
    expect(successLiveCardIds.length).toBe(2);

    removeFromPlayerZones(p1);
    const energyCardIds = [...state.cardRegistry.values()]
      .filter((card) => card.ownerId === PLAYER1 && card.data.cardType === CardType.ENERGY)
      .map((card) => card.instanceId);
    setActiveEnergy(p1, energyCardIds.slice(0, 10));
    p1.energyDeck.cardIds = energyCardIds.slice(10);
    p1.hand.cardIds = [rinCardId!];
    p1.successZone.cardIds = successLiveCardIds;
    const energyDeckBefore = [...p1.energyDeck.cardIds];

    const playResult = session.executeCommand(
      createPlayMemberToSlotCommand(PLAYER1, rinCardId!, SlotPosition.CENTER)
    );

    expect(playResult.success).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.pendingAbilities).toEqual([]);
    expect(session.state?.players[0].energyZone.cardIds).toContain(energyDeckBefore[0]);
    expect(
      session.state?.players[0].energyZone.cardStates.get(energyDeckBefore[0]!)?.orientation
    ).toBe(OrientationState.ACTIVE);
    expect(session.state?.players[0].energyDeck.cardIds).toEqual(energyDeckBefore.slice(1));
    expect(
      session.state?.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId ===
            BP5_005_ON_ENTER_SUCCESS_SCORE_PLACE_ACTIVE_ENERGY_ABILITY_ID &&
          action.payload.conditionMet === true &&
          action.payload.successLiveScore === 6
      )
    ).toBe(true);
  });

  it('executes PL!-bp5-007-AR on-enter after relay from a lower effective cost member', () => {
    const session = createGameSession();
    const deck = createDeck();

    session.createGame(
      'sample-bp5-007-nozomi-relay-discard-to-three-draw-three',
      PLAYER1,
      'Player 1',
      PLAYER2,
      'Player 2'
    );
    session.initializeGame(deck, deck);
    forceMainPhaseForPlayer(session);

    const state = session.state!;
    const p1 = state.players[0] as unknown as {
      hand: { cardIds: string[] };
      mainDeck: { cardIds: string[] };
      waitingRoom: { cardIds: string[] };
      successZone: { cardIds: string[] };
      liveZone: { cardIds: string[] };
      energyZone: {
        cardIds: string[];
        cardStates: Map<string, { orientation: OrientationState; face: FaceState }>;
      };
      memberSlots: {
        slots: Record<SlotPosition, string | null>;
        cardStates: Map<string, { orientation: OrientationState; face: FaceState }>;
      };
    };
    const p2 = state.players[1] as unknown as {
      hand: { cardIds: string[] };
      mainDeck: { cardIds: string[] };
      waitingRoom: { cardIds: string[] };
      successZone: { cardIds: string[] };
      liveZone: { cardIds: string[] };
    };
    const ownedP1CardIds = [...state.cardRegistry.values()]
      .filter((card) => card.ownerId === PLAYER1)
      .map((card) => card.instanceId);
    const ownedP2CardIds = [...state.cardRegistry.values()]
      .filter((card) => card.ownerId === PLAYER2)
      .map((card) => card.instanceId);
    const nozomiCardId = ownedP1CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardCode === 'PL!-bp5-007-AR'
    );
    const relayMemberId = ownedP1CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardCode === 'MEM-0'
    );
    const p1HandCardIds = ownedP1CardIds
      .filter((cardId) => {
        const cardCode = state.cardRegistry.get(cardId)?.data.cardCode;
        return cardId !== nozomiCardId && cardId !== relayMemberId && cardCode?.startsWith('MEM-');
      })
      .slice(0, 5);
    const p1DrawCardIds = ownedP1CardIds
      .filter((cardId) => {
        const cardCode = state.cardRegistry.get(cardId)?.data.cardCode;
        return (
          cardId !== nozomiCardId &&
          cardId !== relayMemberId &&
          !p1HandCardIds.includes(cardId) &&
          cardCode?.startsWith('MEM-')
        );
      })
      .slice(0, 3);
    const p2HandCardIds = ownedP2CardIds
      .filter((cardId) => state.cardRegistry.get(cardId)?.data.cardCode?.startsWith('MEM-'))
      .slice(0, 5);
    const p2DrawCardIds = ownedP2CardIds
      .filter(
        (cardId) =>
          !p2HandCardIds.includes(cardId) &&
          state.cardRegistry.get(cardId)?.data.cardCode?.startsWith('MEM-')
      )
      .slice(0, 3);
    const energyCardIds = ownedP1CardIds.filter(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardType === CardType.ENERGY
    );

    expect(nozomiCardId).toBeTruthy();
    expect(relayMemberId).toBeTruthy();
    expect(p1HandCardIds.length).toBe(5);
    expect(p1DrawCardIds.length).toBe(3);
    expect(p2HandCardIds.length).toBe(5);
    expect(p2DrawCardIds.length).toBe(3);
    expect(energyCardIds.length).toBeGreaterThanOrEqual(12);

    removeFromPlayerZones(p1);
    removeFromPlayerZones(p2);
    setActiveEnergy(p1, energyCardIds.slice(0, 12));
    p1.hand.cardIds = [nozomiCardId!, ...p1HandCardIds];
    p1.mainDeck.cardIds = [...p1DrawCardIds];
    p2.hand.cardIds = [...p2HandCardIds];
    p2.mainDeck.cardIds = [...p2DrawCardIds];
    p1.memberSlots.slots[SlotPosition.CENTER] = relayMemberId!;
    p1.memberSlots.cardStates = new Map([
      [relayMemberId!, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
    ]);

    const playResult = session.executeCommand(
      createPlayMemberToSlotCommand(PLAYER1, nozomiCardId!, SlotPosition.CENTER)
    );

    expect(playResult.success).toBe(true);
    expect(session.state?.activeEffect?.abilityId).toBe(
      BP5_007_ON_ENTER_RELAY_LOW_COST_HAND_ADJUST_DRAW_ABILITY_ID
    );
    expect(session.state?.activeEffect?.awaitingPlayerId).toBe(PLAYER1);
    expect(session.state?.activeEffect?.minSelectableCards).toBe(2);
    expect(session.state?.activeEffect?.maxSelectableCards).toBe(2);

    const p1DiscardIds = p1HandCardIds.slice(0, 2);
    const p1DiscardResult = session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        session.state!.activeEffect!.id,
        undefined,
        null,
        undefined,
        null,
        p1DiscardIds
      )
    );

    expect(p1DiscardResult.success).toBe(true);
    expect(session.state?.activeEffect?.awaitingPlayerId).toBe(PLAYER2);
    expect(session.state?.activeEffect?.minSelectableCards).toBe(2);
    expect(session.state?.activeEffect?.maxSelectableCards).toBe(2);

    const p2DiscardIds = p2HandCardIds.slice(0, 2);
    const p2DiscardResult = session.executeCommand(
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

    expect(p2DiscardResult.success).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].hand.cardIds).toEqual([
      ...p1HandCardIds.slice(2),
      ...p1DrawCardIds,
    ]);
    expect(session.state?.players[1].hand.cardIds).toEqual([
      ...p2HandCardIds.slice(2),
      ...p2DrawCardIds,
    ]);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([
      relayMemberId,
      ...p1DiscardIds,
    ]);
    expect(session.state?.players[1].waitingRoom.cardIds).toEqual(p2DiscardIds);
  });

  it('executes PL!-bp5-007-AR draw even when players have three or fewer cards in hand', () => {
    const session = createGameSession();
    const deck = createDeck();

    session.createGame(
      'sample-bp5-007-nozomi-relay-low-hand-draw-three',
      PLAYER1,
      'Player 1',
      PLAYER2,
      'Player 2'
    );
    session.initializeGame(deck, deck);
    forceMainPhaseForPlayer(session);

    const state = session.state!;
    const p1 = state.players[0] as unknown as {
      hand: { cardIds: string[] };
      mainDeck: { cardIds: string[] };
      waitingRoom: { cardIds: string[] };
      successZone: { cardIds: string[] };
      liveZone: { cardIds: string[] };
      energyZone: {
        cardIds: string[];
        cardStates: Map<string, { orientation: OrientationState; face: FaceState }>;
      };
      memberSlots: {
        slots: Record<SlotPosition, string | null>;
        cardStates: Map<string, { orientation: OrientationState; face: FaceState }>;
      };
    };
    const p2 = state.players[1] as unknown as {
      hand: { cardIds: string[] };
      mainDeck: { cardIds: string[] };
      waitingRoom: { cardIds: string[] };
      successZone: { cardIds: string[] };
      liveZone: { cardIds: string[] };
    };
    const ownedP1CardIds = [...state.cardRegistry.values()]
      .filter((card) => card.ownerId === PLAYER1)
      .map((card) => card.instanceId);
    const ownedP2CardIds = [...state.cardRegistry.values()]
      .filter((card) => card.ownerId === PLAYER2)
      .map((card) => card.instanceId);
    const nozomiCardId = ownedP1CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardCode === 'PL!-bp5-007-AR'
    );
    const relayMemberId = ownedP1CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardCode === 'MEM-0'
    );
    const p1HandCardIds = ownedP1CardIds
      .filter((cardId) => {
        const cardCode = state.cardRegistry.get(cardId)?.data.cardCode;
        return cardId !== nozomiCardId && cardId !== relayMemberId && cardCode?.startsWith('MEM-');
      })
      .slice(0, 2);
    const p1DrawCardIds = ownedP1CardIds
      .filter(
        (cardId) =>
          !p1HandCardIds.includes(cardId) &&
          cardId !== nozomiCardId &&
          cardId !== relayMemberId &&
          state.cardRegistry.get(cardId)?.data.cardCode?.startsWith('MEM-')
      )
      .slice(0, 3);
    const p2HandCardIds = ownedP2CardIds
      .filter((cardId) => state.cardRegistry.get(cardId)?.data.cardCode?.startsWith('MEM-'))
      .slice(0, 3);
    const p2DrawCardIds = ownedP2CardIds
      .filter(
        (cardId) =>
          !p2HandCardIds.includes(cardId) &&
          state.cardRegistry.get(cardId)?.data.cardCode?.startsWith('MEM-')
      )
      .slice(0, 3);
    const energyCardIds = ownedP1CardIds.filter(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardType === CardType.ENERGY
    );

    expect(nozomiCardId).toBeTruthy();
    expect(relayMemberId).toBeTruthy();
    expect(p1HandCardIds.length).toBe(2);
    expect(p1DrawCardIds.length).toBe(3);
    expect(p2HandCardIds.length).toBe(3);
    expect(p2DrawCardIds.length).toBe(3);
    expect(energyCardIds.length).toBeGreaterThanOrEqual(12);

    removeFromPlayerZones(p1);
    removeFromPlayerZones(p2);
    setActiveEnergy(p1, energyCardIds.slice(0, 12));
    p1.hand.cardIds = [nozomiCardId!, ...p1HandCardIds];
    p1.mainDeck.cardIds = [...p1DrawCardIds];
    p2.hand.cardIds = [...p2HandCardIds];
    p2.mainDeck.cardIds = [...p2DrawCardIds];
    p1.memberSlots.slots[SlotPosition.CENTER] = relayMemberId!;
    p1.memberSlots.cardStates = new Map([
      [relayMemberId!, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
    ]);

    const playResult = session.executeCommand(
      createPlayMemberToSlotCommand(PLAYER1, nozomiCardId!, SlotPosition.CENTER)
    );

    expect(playResult.success).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].hand.cardIds).toEqual([...p1HandCardIds, ...p1DrawCardIds]);
    expect(session.state?.players[1].hand.cardIds).toEqual([...p2HandCardIds, ...p2DrawCardIds]);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([relayMemberId]);
    expect(session.state?.players[1].waitingRoom.cardIds).toEqual([]);
  });

  it('does not trigger PL!-bp5-007-AR when it enters without relay', () => {
    const session = createGameSession();
    const deck = createDeck();

    session.createGame(
      'sample-bp5-007-nozomi-non-relay-no-trigger',
      PLAYER1,
      'Player 1',
      PLAYER2,
      'Player 2'
    );
    session.initializeGame(deck, deck);
    forceMainPhaseForPlayer(session);

    const state = session.state!;
    const p1 = state.players[0] as unknown as {
      hand: { cardIds: string[] };
      mainDeck: { cardIds: string[] };
      waitingRoom: { cardIds: string[] };
      successZone: { cardIds: string[] };
      liveZone: { cardIds: string[] };
      energyZone: {
        cardIds: string[];
        cardStates: Map<string, { orientation: OrientationState; face: FaceState }>;
      };
      memberSlots: {
        slots: Record<SlotPosition, string | null>;
        cardStates: Map<string, { orientation: OrientationState; face: FaceState }>;
      };
    };
    const ownedP1CardIds = [...state.cardRegistry.values()]
      .filter((card) => card.ownerId === PLAYER1)
      .map((card) => card.instanceId);
    const nozomiCardId = ownedP1CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardCode === 'PL!-bp5-007-AR'
    );
    const energyCardIds = ownedP1CardIds.filter(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardType === CardType.ENERGY
    );

    expect(nozomiCardId).toBeTruthy();
    expect(energyCardIds.length).toBeGreaterThanOrEqual(13);

    removeFromPlayerZones(p1);
    setActiveEnergy(p1, energyCardIds.slice(0, 13));
    p1.hand.cardIds = [nozomiCardId!];
    p1.memberSlots.slots[SlotPosition.CENTER] = null;
    p1.memberSlots.cardStates = new Map();

    const playResult = session.executeCommand(
      createPlayMemberToSlotCommand(PLAYER1, nozomiCardId!, SlotPosition.CENTER)
    );

    expect(playResult.success).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(
      session.state?.actionHistory.some(
        (action) =>
          action.type === 'TRIGGER_ABILITY' &&
          action.payload.abilityId ===
            BP5_007_ON_ENTER_RELAY_LOW_COST_HAND_ADJUST_DRAW_ABILITY_ID
      )
    ).toBe(false);
  });

  it('does not trigger PL!-bp5-007-AR when relayed member cost is not lower', () => {
    const session = createGameSession();
    const deck = createDeck();

    session.createGame(
      'sample-bp5-007-nozomi-equal-cost-relay-no-trigger',
      PLAYER1,
      'Player 1',
      PLAYER2,
      'Player 2'
    );
    session.initializeGame(deck, deck);
    forceMainPhaseForPlayer(session);

    const state = session.state!;
    const p1 = state.players[0] as unknown as {
      hand: { cardIds: string[] };
      mainDeck: { cardIds: string[] };
      waitingRoom: { cardIds: string[] };
      successZone: { cardIds: string[] };
      liveZone: { cardIds: string[] };
      energyZone: {
        cardIds: string[];
        cardStates: Map<string, { orientation: OrientationState; face: FaceState }>;
      };
      memberSlots: {
        slots: Record<SlotPosition, string | null>;
        cardStates: Map<string, { orientation: OrientationState; face: FaceState }>;
      };
    };
    const ownedP1CardIds = [...state.cardRegistry.values()]
      .filter((card) => card.ownerId === PLAYER1)
      .map((card) => card.instanceId);
    const nozomiCardId = ownedP1CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardCode === 'PL!-bp5-007-AR'
    );
    const equalCostMemberId = ownedP1CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardCode === 'PL!SP-bp4-008-P'
    );

    expect(nozomiCardId).toBeTruthy();
    expect(equalCostMemberId).toBeTruthy();

    removeFromPlayerZones(p1);
    p1.hand.cardIds = [nozomiCardId!];
    p1.memberSlots.slots[SlotPosition.CENTER] = equalCostMemberId!;
    p1.memberSlots.cardStates = new Map([
      [equalCostMemberId!, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
    ]);

    const playResult = session.executeCommand(
      createPlayMemberToSlotCommand(PLAYER1, nozomiCardId!, SlotPosition.CENTER)
    );

    expect(playResult.success).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(
      session.state?.actionHistory.some(
        (action) =>
          action.type === 'TRIGGER_ABILITY' &&
          action.payload.abilityId ===
            BP5_007_ON_ENTER_RELAY_LOW_COST_HAND_ADJUST_DRAW_ABILITY_ID
      )
    ).toBe(false);
  });

  it('executes PL!SP-bp2-002-R on-enter by revealing a cost 11 or higher card from top three', () => {
    const session = createGameSession();
    const deck = createDeck();

    session.createGame(
      'sample-sp-bp2-002-on-enter-high-cost-look',
      PLAYER1,
      'Player 1',
      PLAYER2,
      'Player 2'
    );
    session.initializeGame(deck, deck);
    forceMainPhaseForPlayer(session);

    const state = session.state!;
    const p1 = state.players[0] as unknown as {
      hand: { cardIds: string[] };
      mainDeck: { cardIds: string[] };
      waitingRoom: { cardIds: string[] };
      successZone: { cardIds: string[] };
      liveZone: { cardIds: string[] };
      energyZone: {
        cardIds: string[];
        cardStates: Map<string, { orientation: OrientationState; face: FaceState }>;
      };
      memberSlots: { slots: Record<SlotPosition, string | null> };
    };
    const ownedP1CardIds = [...state.cardRegistry.values()]
      .filter((card) => card.ownerId === PLAYER1)
      .map((card) => card.instanceId);
    const kekeCardId = ownedP1CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardCode === 'PL!SP-bp2-002-R'
    );
    const highCostCardId = ownedP1CardIds.find((cardId) => {
      const card = state.cardRegistry.get(cardId);
      return (
        card?.data.cardType === CardType.MEMBER && card.data.cost >= 11 && cardId !== kekeCardId
      );
    });
    const lowCostCardId = ownedP1CardIds.find((cardId) => {
      const card = state.cardRegistry.get(cardId);
      return (
        card?.data.cardType === CardType.MEMBER && card.data.cost < 11 && cardId !== kekeCardId
      );
    });
    const liveCardId = ownedP1CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardType === CardType.LIVE
    );

    expect(kekeCardId).toBeTruthy();
    expect(highCostCardId).toBeTruthy();
    expect(lowCostCardId).toBeTruthy();
    expect(liveCardId).toBeTruthy();

    const topCardIds = [lowCostCardId!, highCostCardId!, liveCardId!];
    removeFromPlayerZones(p1);
    p1.hand.cardIds = [kekeCardId!];
    p1.mainDeck.cardIds = topCardIds;

    const playResult = session.executeCommand(
      createPlayMemberToSlotCommand(PLAYER1, kekeCardId!, SlotPosition.CENTER)
    );

    expect(playResult.success).toBe(true);
    expect(session.state?.activeEffect?.abilityId).toBe(
      SP_BP2_002_ON_ENTER_LOOK_HIGH_COST_CARD_ABILITY_ID
    );
    expect(session.state?.activeEffect?.inspectionCardIds).toEqual(topCardIds);
    expect(session.state?.activeEffect?.selectableCardIds).toEqual([highCostCardId]);

    const selectResult = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id, highCostCardId!)
    );

    expect(selectResult.success).toBe(true);
    expect(session.state?.inspectionZone.revealedCardIds).toEqual([highCostCardId]);
    expect(session.state?.players[0].hand.cardIds).toEqual([]);

    const finishResult = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id)
    );

    expect(finishResult.success).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.inspectionZone.cardIds).toEqual([]);
    expect(session.state?.players[0].hand.cardIds).toEqual([highCostCardId]);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([lowCostCardId, liveCardId]);
  });

  it('executes PL!-bp6-002-P on-enter by revealing a no-ability Muse card from top two', () => {
    const session = createGameSession();
    const deck = createDeck();

    session.createGame('sample-bp6-002-on-enter-look-no-ability-muse', PLAYER1, 'Player 1', PLAYER2, 'Player 2');
    session.initializeGame(deck, deck);
    forceMainPhaseForPlayer(session);

    const state = session.state!;
    const p1 = state.players[0] as unknown as {
      hand: { cardIds: string[] };
      mainDeck: { cardIds: string[] };
      waitingRoom: { cardIds: string[] };
      successZone: { cardIds: string[] };
      liveZone: { cardIds: string[] };
      memberSlots: { slots: Record<SlotPosition, string | null> };
    };
    const ownedP1CardIds = [...state.cardRegistry.values()]
      .filter((card) => card.ownerId === PLAYER1)
      .map((card) => card.instanceId);
    const eliCardId = ownedP1CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardType === CardType.MEMBER
    );
    const eligibleMuseCardId = ownedP1CardIds.find(
      (cardId) =>
        cardId !== eliCardId && state.cardRegistry.get(cardId)?.data.cardType === CardType.MEMBER
    );
    const triggeredMuseCardId = ownedP1CardIds.find(
      (cardId) =>
        cardId !== eliCardId &&
        cardId !== eligibleMuseCardId &&
        state.cardRegistry.get(cardId)?.data.cardType === CardType.MEMBER
    );

    expect(eliCardId).toBeTruthy();
    expect(eligibleMuseCardId).toBeTruthy();
    expect(triggeredMuseCardId).toBeTruthy();

    const eliCard = state.cardRegistry.get(eliCardId!) as unknown as { data: MemberCardData };
    const eligibleMuseCard = state.cardRegistry.get(eligibleMuseCardId!) as unknown as {
      data: MemberCardData;
    };
    const triggeredMuseCard = state.cardRegistry.get(triggeredMuseCardId!) as unknown as {
      data: MemberCardData;
    };
    eliCard.data = createMemberCard('PL!-bp6-002-P', '絢瀬絵里', 2);
    eligibleMuseCard.data = createMemberCard(
      'BP6-002-NO-ABILITY-MUSE',
      'No Ability Muse',
      2,
      "μ's"
    );
    triggeredMuseCard.data = {
      ...createMemberCard('BP6-002-TRIGGERED-MUSE', 'Triggered Muse', 2, "μ's"),
      cardText: '【登场】抽1张卡。',
    };

    const topCardIds = [eligibleMuseCardId!, triggeredMuseCardId!];
    removeFromPlayerZones(p1);
    p1.hand.cardIds = [eliCardId!];
    p1.mainDeck.cardIds = topCardIds;

    const playResult = session.executeCommand(
      createPlayMemberToSlotCommand(PLAYER1, eliCardId!, SlotPosition.CENTER)
    );

    expect(playResult.success).toBe(true);
    expect(session.state?.activeEffect?.abilityId).toBe(
      BP6_002_ON_ENTER_LOOK_NO_ABILITY_OR_CONTINUOUS_MUSE_CARD_ABILITY_ID
    );
    expect(session.state?.activeEffect?.inspectionCardIds).toEqual(topCardIds);
    expect(session.state?.activeEffect?.selectableCardIds).toEqual([eligibleMuseCardId]);

    const selectResult = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id, eligibleMuseCardId!)
    );

    expect(selectResult.success).toBe(true);
    expect(session.state?.inspectionZone.revealedCardIds).toEqual([eligibleMuseCardId]);
    expect(session.state?.players[0].hand.cardIds).toEqual([]);

    const finishResult = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id)
    );

    expect(finishResult.success).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.inspectionZone.cardIds).toEqual([]);
  expect(session.state?.players[0].hand.cardIds).toEqual([eligibleMuseCardId]);
  expect(session.state?.players[0].waitingRoom.cardIds).toEqual([triggeredMuseCardId]);
});

  function prepareBp6024SuccessSettlement(waitingRoomCards: ReturnType<typeof createCardInstance>[]) {
    const session = createGameSession();
    const deck = createDeck();

    session.createGame(
      `sample-bp6-024-success-replacement-${waitingRoomCards.length}`,
      PLAYER1,
      'Player 1',
      PLAYER2,
      'Player 2'
    );
    session.initializeGame(deck, deck);

    const crossroads = createCardInstance(
      createLiveCard('PL!-bp6-024-L', '錯覚CROSSROADS', "μ's"),
      PLAYER1,
      'p1-bp6-024-crossroads'
    );
    let state = registerCards(session.state!, [crossroads, ...waitingRoomCards]);
    state = updatePlayer(state, PLAYER1, (player) => ({
      ...player,
      hand: { ...player.hand, cardIds: [] },
      waitingRoom: {
        ...player.waitingRoom,
        cardIds: waitingRoomCards.map((card) => card.instanceId),
      },
      successZone: { ...player.successZone, cardIds: [] },
      liveZone: {
        ...player.liveZone,
        cardIds: [crossroads.instanceId],
        cardStates: new Map([
          [
            crossroads.instanceId,
            { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP },
          ],
        ]),
      },
    }));
    state = {
      ...state,
      currentPhase: GamePhase.PERFORMANCE_PHASE,
      currentSubPhase: SubPhase.RESULT_SETTLEMENT,
      currentTurnType: TurnType.LIVE_PHASE,
      activePlayerIndex: 0,
      waitingPlayerId: PLAYER1,
      liveResolution: {
        ...state.liveResolution,
        liveWinnerIds: [PLAYER1],
        liveResults: new Map([[crossroads.instanceId, true]]),
        successCardMovedBy: [],
        settlementConfirmedBy: [],
      },
    };
    (session as unknown as { authorityState: GameState }).authorityState = state;

    return { session, crossroadsId: crossroads.instanceId };
  }

  it('replaces PL!-bp6-024-L ordinary successful LIVE placement with a Muse LIVE from waiting room', () => {
    const museTarget = createCardInstance(
      createLiveCard('PL!-test-bp6-024-muse-waiting-live', 'Muse waiting LIVE', "μ's"),
      PLAYER1,
      'p1-bp6-024-muse-target'
    );
    const nonMuseTarget = createCardInstance(
      createLiveCard('PL!S-test-bp6-024-non-muse-live', 'Non Muse waiting LIVE', 'Aqours'),
      PLAYER1,
      'p1-bp6-024-non-muse-target'
    );
    const { session, crossroadsId } = prepareBp6024SuccessSettlement([
      museTarget,
      nonMuseTarget,
    ]);

    const selectResult = session.executeCommand(
      createSelectSuccessLiveCommand(PLAYER1, crossroadsId)
    );

    expect(selectResult.success).toBe(true);
    expect(session.state?.activeEffect?.abilityId).toBe(
      BP6_024_CONTINUOUS_SUCCESS_ZONE_REPLACEMENT_ABILITY_ID
    );
    expect(session.state?.activeEffect?.selectableCardIds).toEqual([museTarget.instanceId]);
    expect(session.state?.activeEffect?.selectableCardIds).not.toContain(nonMuseTarget.instanceId);
    expect(session.state?.players[0].liveZone.cardIds).toEqual([crossroadsId]);
    expect(session.state?.players[0].successZone.cardIds).toEqual([]);

    const replaceResult = session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        session.state!.activeEffect!.id,
        museTarget.instanceId
      )
    );

    expect(replaceResult.success).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].liveZone.cardIds).toEqual([crossroadsId]);
    expect(session.state?.players[0].successZone.cardIds).toEqual([museTarget.instanceId]);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([nonMuseTarget.instanceId]);
    expect(session.state?.liveResolution.successCardMovedBy).toContain(PLAYER1);
    expect(session.state?.liveResolution.liveResults.get(crossroadsId)).toBe(true);
  });

  it('keeps PL!-bp6-024-L ordinary successful LIVE placement when replacement is skipped', () => {
    const museTarget = createCardInstance(
      createLiveCard('PL!-test-bp6-024-skip-muse-live', 'Muse waiting LIVE', "μ's"),
      PLAYER1,
      'p1-bp6-024-skip-muse-target'
    );
    const { session, crossroadsId } = prepareBp6024SuccessSettlement([museTarget]);

    const selectResult = session.executeCommand(
      createSelectSuccessLiveCommand(PLAYER1, crossroadsId)
    );

    expect(selectResult.success).toBe(true);
    expect(session.state?.activeEffect?.abilityId).toBe(
      BP6_024_CONTINUOUS_SUCCESS_ZONE_REPLACEMENT_ABILITY_ID
    );

    const skipResult = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id)
    );

    expect(skipResult.success).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].liveZone.cardIds).toEqual([]);
    expect(session.state?.players[0].successZone.cardIds).toEqual([crossroadsId]);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([museTarget.instanceId]);
    expect(session.state?.liveResolution.successCardMovedBy).toContain(PLAYER1);
  });

  it("places PL!-bp6-024-L normally when no Muse LIVE exists in waiting room", () => {
    const nonMuseTarget = createCardInstance(
      createLiveCard('PL!S-test-bp6-024-only-non-muse-live', 'Non Muse waiting LIVE', 'Aqours'),
      PLAYER1,
      'p1-bp6-024-only-non-muse-target'
    );
    const { session, crossroadsId } = prepareBp6024SuccessSettlement([nonMuseTarget]);

    const selectResult = session.executeCommand(
      createSelectSuccessLiveCommand(PLAYER1, crossroadsId)
    );

    expect(selectResult.success).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].liveZone.cardIds).toEqual([]);
    expect(session.state?.players[0].successZone.cardIds).toEqual([crossroadsId]);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([nonMuseTarget.instanceId]);
  });

  it('allows PL!-bp6-024-L replacement through the Maki revealed hand LIVE success-zone path', () => {
    const session = createGameSession();
    const deck = createDeck();

    session.createGame(
      'sample-bp6-024-maki-success-replacement',
      PLAYER1,
      'Player 1',
      PLAYER2,
      'Player 2'
    );
    session.initializeGame(deck, deck);

    const maki = createCardInstance(
      createMemberCard('PL!-sd1-006-SD', '西木野真姫', 1, "μ's"),
      PLAYER1,
      'p1-bp6-024-maki-source'
    );
    const crossroads = createCardInstance(
      createLiveCard('PL!-bp6-024-L', '錯覚CROSSROADS', "μ's"),
      PLAYER1,
      'p1-bp6-024-maki-crossroads'
    );
    const successLive = createCardInstance(
      createLiveCard('PL!-test-bp6-024-success-live', 'Success LIVE', "μ's"),
      PLAYER1,
      'p1-bp6-024-maki-success-live'
    );
    const museTarget = createCardInstance(
      createLiveCard('PL!-test-bp6-024-maki-waiting-live', 'Muse waiting LIVE', "μ's"),
      PLAYER1,
      'p1-bp6-024-maki-muse-target'
    );

    let state = registerCards(session.state!, [maki, crossroads, successLive, museTarget]);
    state = updatePlayer(state, PLAYER1, (player) => ({
      ...player,
      hand: { ...player.hand, cardIds: [crossroads.instanceId] },
      waitingRoom: { ...player.waitingRoom, cardIds: [museTarget.instanceId] },
      successZone: { ...player.successZone, cardIds: [successLive.instanceId] },
      liveZone: { ...player.liveZone, cardIds: [] },
    }));
    state = {
      ...state,
      activeEffect: {
        id: 'maki-bp6-024-success-swap',
        abilityId: MAKI_ON_ENTER_ABILITY_ID,
        sourceCardId: maki.instanceId,
        controllerId: PLAYER1,
        effectText: '【登场】公开手牌 LIVE，与成功 LIVE 交换。',
        stepId: 'MAKI_SELECT_SUCCESS_LIVE',
        stepText: '请选择要加入手牌的成功 Live。',
        awaitingPlayerId: PLAYER1,
        selectableCardIds: [successLive.instanceId],
        selectableCardVisibility: 'PUBLIC',
        canSkipSelection: true,
        metadata: {
          handLiveCardId: crossroads.instanceId,
        },
      },
    };
    (session as unknown as { authorityState: GameState }).authorityState = state;

    const chooseSuccessResult = session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        session.state!.activeEffect!.id,
        successLive.instanceId
      )
    );

    expect(chooseSuccessResult.success).toBe(true);
    expect(session.state?.activeEffect?.abilityId).toBe(
      BP6_024_CONTINUOUS_SUCCESS_ZONE_REPLACEMENT_ABILITY_ID
    );
    expect(session.state?.activeEffect?.selectableCardIds).toEqual([museTarget.instanceId]);

    const replaceResult = session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        session.state!.activeEffect!.id,
        museTarget.instanceId
      )
    );

    expect(replaceResult.success).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].hand.cardIds).toEqual([
      crossroads.instanceId,
      successLive.instanceId,
    ]);
    expect(session.state?.players[0].successZone.cardIds).toEqual([museTarget.instanceId]);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([]);
  });

  it('executes PL!-PR-018-PR on-enter to recover one score 6 or higher LIVE from waiting room', () => {
    const session = createGameSession();
    const deck = createDeck();

    session.createGame(
      'sample-pr-018-on-enter-high-score-live-recover',
      PLAYER1,
      'Player 1',
      PLAYER2,
      'Player 2'
    );
    session.initializeGame(deck, deck);
    forceMainPhaseForPlayer(session);

    const state = session.state!;
    const p1 = state.players[0] as unknown as {
      hand: { cardIds: string[] };
      mainDeck: { cardIds: string[] };
      waitingRoom: { cardIds: string[] };
      successZone: { cardIds: string[] };
      liveZone: { cardIds: string[] };
      memberSlots: { slots: Record<SlotPosition, string | null> };
    };
    const ownedP1CardIds = [...state.cardRegistry.values()]
      .filter((card) => card.ownerId === PLAYER1)
      .map((card) => card.instanceId);
    const nozomiCardId = ownedP1CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardCode === 'PL!-PR-018-PR'
    );
    const highScoreLiveId = ownedP1CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardCode === 'LIVE-SCORE-6'
    );
    const lowScoreLiveId = ownedP1CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardCode === 'LIVE-1'
    );
    const nonLiveId = ownedP1CardIds.find(
      (cardId) =>
        state.cardRegistry.get(cardId)?.data.cardType === CardType.MEMBER && cardId !== nozomiCardId
    );
    const deckFillerId = ownedP1CardIds.find(
      (cardId) =>
        cardId !== nozomiCardId &&
        cardId !== nonLiveId &&
        cardId !== highScoreLiveId &&
        cardId !== lowScoreLiveId &&
        state.cardRegistry.get(cardId)?.data.cardType === CardType.MEMBER
    );

    expect(nozomiCardId).toBeTruthy();
    expect(highScoreLiveId).toBeTruthy();
    expect(lowScoreLiveId).toBeTruthy();
    expect(nonLiveId).toBeTruthy();
    expect(deckFillerId).toBeTruthy();

    removeFromPlayerZones(p1);
    const energyCardIds = [...state.cardRegistry.values()]
      .filter((card) => card.ownerId === PLAYER1 && card.data.cardType === CardType.ENERGY)
      .map((card) => card.instanceId);
    setActiveEnergy(p1, energyCardIds.slice(0, 15));
    p1.hand.cardIds = [nozomiCardId!];
    p1.mainDeck.cardIds = [deckFillerId!];
    p1.waitingRoom.cardIds = [highScoreLiveId!, lowScoreLiveId!, nonLiveId!];

    const playResult = session.executeCommand(
      createPlayMemberToSlotCommand(PLAYER1, nozomiCardId!, SlotPosition.CENTER)
    );

    expect(playResult.success).toBe(true);
    expect(session.state?.activeEffect?.abilityId).toBe(
      PR_018_ON_ENTER_RECOVER_HIGH_SCORE_LIVE_ABILITY_ID
    );
    expect(session.state?.activeEffect?.selectableCardIds).toEqual([highScoreLiveId]);
    expect(session.state?.activeEffect?.canSkipSelection).toBe(false);
    expect(session.state?.activeEffect?.metadata?.zoneSelection).toEqual({
      source: 'WAITING_ROOM',
      destination: 'HAND',
      minCount: 1,
      maxCount: 1,
      optional: false,
    });

    const activeEffectId = session.state!.activeEffect!.id;
    const skipResult = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, activeEffectId)
    );

    expect(skipResult.success).toBe(false);
    expect(session.state?.activeEffect?.id).toBe(activeEffectId);
    expect(session.state?.activeEffect?.selectableCardIds).toEqual([highScoreLiveId]);

    const recoverResult = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id, highScoreLiveId!)
    );

    expect(recoverResult.success).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].hand.cardIds).toEqual([highScoreLiveId]);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([lowScoreLiveId, nonLiveId]);
  });

  it('allows PL!-PR-018-PR on-enter to finish when no score 6 or higher LIVE is in waiting room', () => {
    const session = createGameSession();
    const deck = createDeck();

    session.createGame(
      'sample-pr-018-on-enter-high-score-live-recover-no-target',
      PLAYER1,
      'Player 1',
      PLAYER2,
      'Player 2'
    );
    session.initializeGame(deck, deck);
    forceMainPhaseForPlayer(session);

    const state = session.state!;
    const p1 = state.players[0] as unknown as {
      hand: { cardIds: string[] };
      mainDeck: { cardIds: string[] };
      waitingRoom: { cardIds: string[] };
      successZone: { cardIds: string[] };
      liveZone: { cardIds: string[] };
      memberSlots: { slots: Record<SlotPosition, string | null> };
    };
    const ownedP1CardIds = [...state.cardRegistry.values()]
      .filter((card) => card.ownerId === PLAYER1)
      .map((card) => card.instanceId);
    const nozomiCardId = ownedP1CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardCode === 'PL!-PR-018-PR'
    );
    const highScoreLiveId = ownedP1CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardCode === 'LIVE-SCORE-6'
    );
    const lowScoreLiveId = ownedP1CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardCode === 'LIVE-1'
    );
    const nonLiveId = ownedP1CardIds.find(
      (cardId) =>
        state.cardRegistry.get(cardId)?.data.cardType === CardType.MEMBER && cardId !== nozomiCardId
    );
    const deckFillerId = ownedP1CardIds.find(
      (cardId) =>
        cardId !== nozomiCardId &&
        cardId !== nonLiveId &&
        cardId !== highScoreLiveId &&
        cardId !== lowScoreLiveId &&
        state.cardRegistry.get(cardId)?.data.cardType === CardType.MEMBER
    );

    expect(nozomiCardId).toBeTruthy();
    expect(highScoreLiveId).toBeTruthy();
    expect(lowScoreLiveId).toBeTruthy();
    expect(nonLiveId).toBeTruthy();
    expect(deckFillerId).toBeTruthy();

    removeFromPlayerZones(p1);
    const energyCardIds = [...state.cardRegistry.values()]
      .filter((card) => card.ownerId === PLAYER1 && card.data.cardType === CardType.ENERGY)
      .map((card) => card.instanceId);
    setActiveEnergy(p1, energyCardIds.slice(0, 15));
    p1.hand.cardIds = [nozomiCardId!];
    p1.mainDeck.cardIds = [deckFillerId!];
    p1.waitingRoom.cardIds = [lowScoreLiveId!, nonLiveId!];

    const playResult = session.executeCommand(
      createPlayMemberToSlotCommand(PLAYER1, nozomiCardId!, SlotPosition.CENTER)
    );

    expect(playResult.success).toBe(true);
    expect(session.state?.activeEffect?.abilityId).toBe(
      PR_018_ON_ENTER_RECOVER_HIGH_SCORE_LIVE_ABILITY_ID
    );
    expect(session.state?.activeEffect?.selectableCardIds).toEqual([]);
    expect(session.state?.activeEffect?.canSkipSelection).toBe(true);
    expect(session.state?.activeEffect?.metadata?.zoneSelection).toEqual({
      source: 'WAITING_ROOM',
      destination: 'HAND',
      minCount: 0,
      maxCount: 1,
      optional: true,
    });

    const finishResult = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id)
    );

    expect(finishResult.success).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].hand.cardIds).toEqual([]);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([lowScoreLiveId, nonLiveId]);
  });

  it('executes PL!HS-bp2-002-P on-enter to recover up to two low-cost members from waiting room', () => {
    const session = createGameSession();
    const deck = createDeck();

    session.createGame(
      'sample-hs-bp2-002-on-enter-waiting-room-runner',
      PLAYER1,
      'Player 1',
      PLAYER2,
      'Player 2'
    );
    session.initializeGame(deck, deck);
    forceMainPhaseForPlayer(session);

    const state = session.state!;
    const p1 = state.players[0] as unknown as {
      hand: { cardIds: string[] };
      mainDeck: { cardIds: string[] };
      waitingRoom: { cardIds: string[] };
      successZone: { cardIds: string[] };
      liveZone: { cardIds: string[] };
      energyZone: {
        cardIds: string[];
        cardStates: Map<string, { orientation: OrientationState; face: FaceState }>;
      };
      memberSlots: { slots: Record<SlotPosition, string | null> };
    };

    const ownedP1CardIds = [...state.cardRegistry.values()]
      .filter((card) => card.ownerId === PLAYER1)
      .map((card) => card.instanceId);
    const hsCardId = ownedP1CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardCode === 'PL!HS-bp2-002-P'
    );
    const lowCostMemberIds = ownedP1CardIds.filter(
      (cardId) =>
        cardId !== hsCardId &&
        state.cardRegistry.get(cardId)?.data.cardType === CardType.MEMBER &&
        (state.cardRegistry.get(cardId)?.data.cost ?? 0) <= 2
    );
    const highCostMemberId = ownedP1CardIds.find(
      (cardId) =>
        cardId !== hsCardId &&
        state.cardRegistry.get(cardId)?.data.cardType === CardType.MEMBER &&
        (state.cardRegistry.get(cardId)?.data.cost ?? 0) > 2
    );
    const hsDeckFillCardId = ownedP1CardIds.find(
      (cardId) =>
        cardId !== hsCardId &&
        cardId !== lowCostMemberIds[0] &&
        cardId !== lowCostMemberIds[1] &&
        cardId !== highCostMemberId &&
        state.cardRegistry.get(cardId)?.data.cardType === CardType.MEMBER
    );

    expect(hsCardId).toBeTruthy();
    expect(lowCostMemberIds.length).toBeGreaterThanOrEqual(2);
    expect(highCostMemberId).toBeTruthy();

    removeFromPlayerZones(p1);
    const energyCardIds = [...state.cardRegistry.values()]
      .filter((card) => card.ownerId === PLAYER1 && card.data.cardType === CardType.ENERGY)
      .map((card) => card.instanceId);
    setActiveEnergy(p1, energyCardIds);
    p1.hand.cardIds = [hsCardId!];
    p1.mainDeck.cardIds = [hsDeckFillCardId!];
    p1.waitingRoom.cardIds = [lowCostMemberIds[0]!, lowCostMemberIds[1]!, highCostMemberId!];
    p1.memberSlots.slots[SlotPosition.CENTER] = null;
    expect(p1.waitingRoom.cardIds).toEqual(
      expect.arrayContaining([lowCostMemberIds[0]!, lowCostMemberIds[1]!, highCostMemberId!])
    );

    const playResult = session.executeCommand(
      createPlayMemberToSlotCommand(PLAYER1, hsCardId!, SlotPosition.CENTER)
    );

    expect(playResult.success).toBe(true);
    expect(session.state?.activeEffect?.abilityId).toBe(
      HS_BP2_002_ON_ENTER_RECOVER_LOW_COST_MEMBER_ABILITY_ID
    );
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual(
      expect.arrayContaining([lowCostMemberIds[0]!, lowCostMemberIds[1]!, highCostMemberId!])
    );
    expect(session.state?.activeEffect?.metadata?.zoneSelection).toMatchObject({
      source: 'WAITING_ROOM',
      destination: 'HAND',
      minCount: 0,
      maxCount: 2,
      optional: true,
    });
    expect(session.state?.activeEffect?.selectableCardIds).toEqual(
      expect.arrayContaining([lowCostMemberIds[0]!, lowCostMemberIds[1]!])
    );
    expect(session.state?.activeEffect?.selectableCardIds).not.toContain(highCostMemberId!);

    const confirmResult = session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        session.state!.activeEffect!.id,
        undefined,
        undefined,
        undefined,
        undefined,
        [lowCostMemberIds[0]!, lowCostMemberIds[1]!]
      )
    );

    expect(confirmResult.success).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].hand.cardIds).toEqual(
      expect.arrayContaining([lowCostMemberIds[0]!, lowCostMemberIds[1]!])
    );
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([highCostMemberId!]);
  });

  it('executes PL!HS-bp5-001-SEC on-enter to mill four and gain BLADE when a LIVE is milled', () => {
    const session = createGameSession();
    const deck = createDeck();

    session.createGame(
      'sample-hs-bp5-001-on-enter-runner',
      PLAYER1,
      'Player 1',
      PLAYER2,
      'Player 2'
    );
    session.initializeGame(deck, deck);
    forceMainPhaseForPlayer(session);

    const state = session.state!;
    const p1 = state.players[0] as unknown as {
      hand: { cardIds: string[] };
      mainDeck: { cardIds: string[] };
      waitingRoom: { cardIds: string[] };
      successZone: { cardIds: string[] };
      liveZone: { cardIds: string[] };
      energyZone: {
        cardIds: string[];
        cardStates: Map<string, { orientation: OrientationState; face: FaceState }>;
      };
      memberSlots: {
        slots: Record<SlotPosition, string | null>;
        cardStates: Map<string, { orientation: OrientationState; face: FaceState }>;
      };
    };

    const ownedP1CardIds = [...state.cardRegistry.values()]
      .filter((card) => card.ownerId === PLAYER1)
      .map((card) => card.instanceId);
    const kahoCardId = ownedP1CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardCode === 'PL!HS-bp5-001-SEC'
    );
    const topCardIds = ['MEM-0', 'LIVE-0', 'MEM-1', 'MEM-2'].map((cardCode) =>
      ownedP1CardIds.find((cardId) => state.cardRegistry.get(cardId)?.data.cardCode === cardCode)
    );
    const energyCardIds = ownedP1CardIds.filter(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardType === CardType.ENERGY
    );

    expect(kahoCardId).toBeTruthy();
    expect(topCardIds.every(Boolean)).toBe(true);
    expect(energyCardIds.length).toBeGreaterThanOrEqual(11);

    removeFromPlayerZones(p1);
    setActiveEnergy(p1, energyCardIds);
    p1.hand.cardIds = [kahoCardId!];
    p1.mainDeck.cardIds = topCardIds as string[];
    p1.memberSlots.slots = {
      [SlotPosition.LEFT]: null,
      [SlotPosition.CENTER]: null,
      [SlotPosition.RIGHT]: null,
    };
    p1.memberSlots.cardStates = new Map();

    const playResult = session.executeCommand(
      createPlayMemberToSlotCommand(PLAYER1, kahoCardId!, SlotPosition.CENTER)
    );

    expect(playResult.success).toBe(true);
    expect(session.state?.activeEffect?.abilityId).toBe(
      HS_BP5_001_ON_ENTER_MILL_GAIN_BLADE_ABILITY_ID
    );
    expect(session.state?.activeEffect?.inspectionCardIds).toEqual(topCardIds);
    expect(session.state?.inspectionZone.cardIds).toEqual(topCardIds);
    expect(session.state?.inspectionZone.revealedCardIds).toEqual(topCardIds);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([]);

    const finishResult = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id)
    );

    expect(finishResult.success).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.inspectionZone.cardIds).toEqual([]);
    expect(session.state?.inspectionZone.revealedCardIds).toEqual([]);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual(topCardIds);
    expect(session.state?.liveResolution.liveModifiers).toContainEqual({
      kind: 'BLADE',
      playerId: PLAYER1,
      countDelta: 2,
      sourceCardId: kahoCardId,
      abilityId: HS_BP5_001_ON_ENTER_MILL_GAIN_BLADE_ABILITY_ID,
    });
    expect(
      session.state?.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId === HS_BP5_001_ON_ENTER_MILL_GAIN_BLADE_ABILITY_ID &&
          action.payload.step === 'MILL_TOP_FOUR_GAIN_BLADE_IF_LIVE' &&
          action.payload.bladeBonus === 2
      )
    ).toBe(true);
  });

  it('executes PL!HS-bp6-001-R＋ on-enter dynamic look stage count plus two and top one', () => {
    const session = createGameSession();
    const deck = createDeck();

    session.createGame(
      'sample-hs-bp6-001-on-enter-runner',
      PLAYER1,
      'Player 1',
      PLAYER2,
      'Player 2'
    );
    session.initializeGame(deck, deck);
    forceMainPhaseForPlayer(session);

    const state = session.state!;
    const p1 = state.players[0] as unknown as {
      hand: { cardIds: string[] };
      mainDeck: { cardIds: string[] };
      waitingRoom: { cardIds: string[] };
      successZone: { cardIds: string[] };
      liveZone: { cardIds: string[] };
      energyZone: {
        cardIds: string[];
        cardStates: Map<string, { orientation: OrientationState; face: FaceState }>;
      };
      memberSlots: {
        slots: Record<SlotPosition, string | null>;
        cardStates: Map<string, { orientation: OrientationState; face: FaceState }>;
      };
    };
    const ownedP1CardIds = [...state.cardRegistry.values()]
      .filter((card) => card.ownerId === PLAYER1)
      .map((card) => card.instanceId);
    const kahoCardId = ownedP1CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardCode === 'PL!HS-bp6-001-R＋'
    );
    const stageCardIds = ['MEM-HASU-0', 'MEM-HASU-1'].map((cardCode) =>
      ownedP1CardIds.find((cardId) => state.cardRegistry.get(cardId)?.data.cardCode === cardCode)
    );
    const topCardIds = ['MEM-0', 'MEM-1', 'MEM-2', 'LIVE-0', 'MEM-3'].map((cardCode) =>
      ownedP1CardIds.find((cardId) => state.cardRegistry.get(cardId)?.data.cardCode === cardCode)
    );
    const restCardId = ownedP1CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardCode === 'MEM-4'
    );
    const energyCardIds = ownedP1CardIds.filter(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardType === CardType.ENERGY
    );

    expect(kahoCardId).toBeTruthy();
    expect(stageCardIds.every(Boolean)).toBe(true);
    expect(topCardIds.every(Boolean)).toBe(true);
    expect(restCardId).toBeTruthy();
    expect(energyCardIds.length).toBeGreaterThanOrEqual(4);

    removeFromPlayerZones(p1);
    setActiveEnergy(p1, energyCardIds.slice(0, 4));
    p1.hand.cardIds = [kahoCardId!];
    p1.mainDeck.cardIds = [...(topCardIds as string[]), restCardId!];
    p1.memberSlots.slots = {
      [SlotPosition.LEFT]: stageCardIds[0]!,
      [SlotPosition.CENTER]: null,
      [SlotPosition.RIGHT]: stageCardIds[1]!,
    };
    p1.memberSlots.cardStates = new Map(
      stageCardIds.map((cardId) => [
        cardId!,
        { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP },
      ])
    );

    const playResult = session.executeCommand(
      createPlayMemberToSlotCommand(PLAYER1, kahoCardId!, SlotPosition.CENTER)
    );

    expect(playResult.success).toBe(true);
    expect(session.state?.activeEffect?.abilityId).toBe(
      HS_BP6_001_ON_ENTER_LOOK_STAGE_PLUS_TWO_ABILITY_ID
    );
    expect(session.state?.activeEffect?.selectableCardMode).toBe('ORDERED_MULTI');
    expect(session.state?.activeEffect?.minSelectableCards).toBe(1);
    expect(session.state?.activeEffect?.maxSelectableCards).toBe(1);
    expect(session.state?.activeEffect?.inspectionCardIds).toEqual(topCardIds);
    expect(session.state?.inspectionZone.cardIds).toEqual(topCardIds);
    expect(session.state?.players[0].mainDeck.cardIds).toEqual([restCardId]);

    const missingSelectionResult = session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        session.state!.activeEffect!.id,
        undefined,
        undefined,
        undefined,
        undefined,
        []
      )
    );

    expect(missingSelectionResult.success).toBe(false);
    expect(session.state?.activeEffect?.abilityId).toBe(
      HS_BP6_001_ON_ENTER_LOOK_STAGE_PLUS_TWO_ABILITY_ID
    );
    expect(session.state?.inspectionZone.cardIds).toEqual(topCardIds);
    expect(session.state?.players[0].mainDeck.cardIds).toEqual([restCardId]);

    const selectedTopCardId = topCardIds[3]!;
    const finishResult = session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        session.state!.activeEffect!.id,
        undefined,
        undefined,
        undefined,
        undefined,
        [selectedTopCardId]
      )
    );

    expect(finishResult.success).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.inspectionZone.cardIds).toEqual([]);
    expect(session.state?.players[0].mainDeck.cardIds).toEqual([selectedTopCardId, restCardId]);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual(
      topCardIds.filter((cardId) => cardId !== selectedTopCardId)
    );
  });

  it('executes PL!HS-bp5-001-SEC activated ability by revealing a hand LIVE and recovering a same-name LIVE', () => {
    const session = createGameSession();
    const deck = createDeck();

    session.createGame(
      'sample-hs-bp5-001-activated-runner',
      PLAYER1,
      'Player 1',
      PLAYER2,
      'Player 2'
    );
    session.initializeGame(deck, deck);
    forceMainPhaseForPlayer(session);

    const state = session.state!;
    const ownedP1CardIds = [...state.cardRegistry.values()]
      .filter((card) => card.ownerId === PLAYER1)
      .map((card) => card.instanceId);
    const kahoCardId = ownedP1CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardCode === 'PL!HS-bp5-001-SEC'
    );
    const handLiveCardId = ownedP1CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardCode === 'LIVE-SAME-NAME-HAND'
    );
    const sameNameLiveCardId = ownedP1CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardCode === 'LIVE-SAME-NAME-WAITING'
    );
    const differentNameLiveCardId = ownedP1CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardCode === 'LIVE-DIFFERENT-NAME-WAITING'
    );
    const energyCardIds = ownedP1CardIds.filter(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardType === CardType.ENERGY
    );

    expect(kahoCardId).toBeTruthy();
    expect(handLiveCardId).toBeTruthy();
    expect(sameNameLiveCardId).toBeTruthy();
    expect(differentNameLiveCardId).toBeTruthy();
    expect(energyCardIds.length).toBeGreaterThanOrEqual(2);

    const preparedState = updatePlayer(state, PLAYER1, (player) => ({
      ...player,
      hand: { ...player.hand, cardIds: [handLiveCardId!] },
      mainDeck: { ...player.mainDeck, cardIds: [] },
      waitingRoom: {
        ...player.waitingRoom,
        cardIds: [sameNameLiveCardId!, differentNameLiveCardId!],
      },
      successZone: { ...player.successZone, cardIds: [] },
      liveZone: { ...player.liveZone, cardIds: [] },
      energyZone: {
        ...player.energyZone,
        cardIds: energyCardIds.slice(0, 4),
        cardStates: new Map(
          energyCardIds
            .slice(0, 4)
            .map((cardId) => [
              cardId,
              { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP },
            ])
        ),
      },
      memberSlots: {
        ...player.memberSlots,
        slots: {
          [SlotPosition.LEFT]: null,
          [SlotPosition.CENTER]: kahoCardId!,
          [SlotPosition.RIGHT]: null,
        },
        cardStates: new Map([
          [kahoCardId!, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
        ]),
      },
    }));
    (session as unknown as { authorityState: GameState }).authorityState = preparedState;

    const activateResult = session.executeCommand(
      createActivateAbilityCommand(
        PLAYER1,
        kahoCardId!,
        HS_BP5_001_ACTIVATED_REVEAL_HAND_LIVE_RECOVER_SAME_NAME_LIVE_ABILITY_ID
      )
    );

    expect(activateResult.success).toBe(true);
    expect(session.state?.activeEffect?.abilityId).toBe(
      HS_BP5_001_ACTIVATED_REVEAL_HAND_LIVE_RECOVER_SAME_NAME_LIVE_ABILITY_ID
    );
    expect(session.state?.activeEffect?.selectableCardIds).toEqual([handLiveCardId]);
    expect(session.state?.players[0].hand.cardIds).toEqual([handLiveCardId]);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([
      sameNameLiveCardId,
      differentNameLiveCardId,
    ]);
    expect(
      session.state?.players[0].energyZone.cardStates.get(energyCardIds[0]!)?.orientation
    ).toBe(OrientationState.WAITING);
    expect(
      session.state?.players[0].energyZone.cardStates.get(energyCardIds[1]!)?.orientation
    ).toBe(OrientationState.WAITING);

    const revealResult = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id, handLiveCardId!)
    );

    expect(revealResult.success).toBe(true);
    expect(session.state?.activeEffect?.stepId).toBe('HS_BP5_001_REVEAL_HAND_LIVE');
    expect(session.state?.activeEffect?.revealedCardIds).toEqual([handLiveCardId]);
    expect(session.state?.activeEffect?.metadata?.revealedHandLiveCardId).toBe(handLiveCardId);
    expect(session.state?.activeEffect?.metadata?.revealedHandLiveCardName).toBe('水彩世界');
    expect(session.state?.activeEffect?.selectableCardIds).toEqual([]);
    expect(
      session.state?.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId ===
            HS_BP5_001_ACTIVATED_REVEAL_HAND_LIVE_RECOVER_SAME_NAME_LIVE_ABILITY_ID &&
          action.payload.step === 'REVEAL_HAND_LIVE' &&
          action.payload.revealedHandLiveCardId === handLiveCardId
      )
    ).toBe(true);

    const continueAfterRevealResult = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id)
    );

    expect(continueAfterRevealResult.success).toBe(true);
    expect(session.state?.activeEffect?.stepId).toBe(
      'HS_BP5_001_SELECT_WAITING_ROOM_SAME_NAME_LIVE'
    );
    expect(session.state?.activeEffect?.selectableCardIds).toEqual([sameNameLiveCardId]);
    expect(session.state?.activeEffect?.selectableCardIds).not.toContain(differentNameLiveCardId);
    expect(
      session.state?.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId ===
            HS_BP5_001_ACTIVATED_REVEAL_HAND_LIVE_RECOVER_SAME_NAME_LIVE_ABILITY_ID &&
          action.payload.step === 'REVEAL_HAND_LIVE_SELECT_WAITING_ROOM_SAME_NAME_LIVE' &&
          action.payload.revealedHandLiveCardId === handLiveCardId
      )
    ).toBe(true);

    const recoverResult = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id, sameNameLiveCardId!)
    );

    expect(recoverResult.success).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].hand.cardIds).toEqual([handLiveCardId, sameNameLiveCardId]);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([differentNameLiveCardId]);
  });

  it('does not activate PL!HS-bp5-001-SEC reveal-hand recovery without a same-name waiting-room LIVE target', () => {
    const session = createGameSession();
    const deck = createDeck();

    session.createGame(
      'sample-hs-bp5-001-activated-no-same-name-target',
      PLAYER1,
      'Player 1',
      PLAYER2,
      'Player 2'
    );
    session.initializeGame(deck, deck);
    forceMainPhaseForPlayer(session);

    const state = session.state!;
    const ownedP1CardIds = [...state.cardRegistry.values()]
      .filter((card) => card.ownerId === PLAYER1)
      .map((card) => card.instanceId);
    const kahoCardId = ownedP1CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardCode === 'PL!HS-bp5-001-SEC'
    );
    const handLiveCardId = ownedP1CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardCode === 'LIVE-SAME-NAME-HAND'
    );
    const differentNameLiveCardId = ownedP1CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardCode === 'LIVE-DIFFERENT-NAME-WAITING'
    );
    const energyCardIds = ownedP1CardIds.filter(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardType === CardType.ENERGY
    );

    expect(kahoCardId).toBeTruthy();
    expect(handLiveCardId).toBeTruthy();
    expect(differentNameLiveCardId).toBeTruthy();
    expect(energyCardIds.length).toBeGreaterThanOrEqual(2);

    const preparedState = updatePlayer(state, PLAYER1, (player) => ({
      ...player,
      hand: { ...player.hand, cardIds: [handLiveCardId!] },
      mainDeck: { ...player.mainDeck, cardIds: [] },
      waitingRoom: { ...player.waitingRoom, cardIds: [differentNameLiveCardId!] },
      successZone: { ...player.successZone, cardIds: [] },
      liveZone: { ...player.liveZone, cardIds: [] },
      energyZone: {
        ...player.energyZone,
        cardIds: energyCardIds.slice(0, 2),
        cardStates: new Map(
          energyCardIds
            .slice(0, 2)
            .map((cardId) => [
              cardId,
              { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP },
            ])
        ),
      },
      memberSlots: {
        ...player.memberSlots,
        slots: {
          [SlotPosition.LEFT]: null,
          [SlotPosition.CENTER]: kahoCardId!,
          [SlotPosition.RIGHT]: null,
        },
        cardStates: new Map([
          [kahoCardId!, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
        ]),
      },
    }));
    (session as unknown as { authorityState: GameState }).authorityState = preparedState;
    const actionHistoryLength = preparedState.actionHistory.length;

    const activateResult = session.executeCommand(
      createActivateAbilityCommand(
        PLAYER1,
        kahoCardId!,
        HS_BP5_001_ACTIVATED_REVEAL_HAND_LIVE_RECOVER_SAME_NAME_LIVE_ABILITY_ID
      )
    );

    expect(activateResult.success).toBe(false);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.actionHistory).toHaveLength(actionHistoryLength);
    expect(session.state?.players[0].hand.cardIds).toEqual([handLiveCardId]);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([differentNameLiveCardId]);
    expect(
      session.state?.players[0].energyZone.cardStates.get(energyCardIds[0]!)?.orientation
    ).toBe(OrientationState.ACTIVE);
    expect(
      session.state?.players[0].energyZone.cardStates.get(energyCardIds[1]!)?.orientation
    ).toBe(OrientationState.ACTIVE);
  });

  it('does not activate PL!HS-bp5-001-SEC reveal-hand recovery with fewer than two active energy', () => {
    const session = createGameSession();
    const deck = createDeck();

    session.createGame(
      'sample-hs-bp5-001-activated-insufficient-energy',
      PLAYER1,
      'Player 1',
      PLAYER2,
      'Player 2'
    );
    session.initializeGame(deck, deck);
    forceMainPhaseForPlayer(session);

    const state = session.state!;
    const ownedP1CardIds = [...state.cardRegistry.values()]
      .filter((card) => card.ownerId === PLAYER1)
      .map((card) => card.instanceId);
    const kahoCardId = ownedP1CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardCode === 'PL!HS-bp5-001-SEC'
    );
    const handLiveCardId = ownedP1CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardCode === 'LIVE-SAME-NAME-HAND'
    );
    const sameNameLiveCardId = ownedP1CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardCode === 'LIVE-SAME-NAME-WAITING'
    );
    const energyCardIds = ownedP1CardIds.filter(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardType === CardType.ENERGY
    );

    expect(kahoCardId).toBeTruthy();
    expect(handLiveCardId).toBeTruthy();
    expect(sameNameLiveCardId).toBeTruthy();
    expect(energyCardIds.length).toBeGreaterThanOrEqual(1);

    const preparedState = updatePlayer(state, PLAYER1, (player) => ({
      ...player,
      hand: { ...player.hand, cardIds: [handLiveCardId!] },
      mainDeck: { ...player.mainDeck, cardIds: [] },
      waitingRoom: { ...player.waitingRoom, cardIds: [sameNameLiveCardId!] },
      successZone: { ...player.successZone, cardIds: [] },
      liveZone: { ...player.liveZone, cardIds: [] },
      energyZone: {
        ...player.energyZone,
        cardIds: energyCardIds.slice(0, 1),
        cardStates: new Map(
          energyCardIds
            .slice(0, 1)
            .map((cardId) => [
              cardId,
              { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP },
            ])
        ),
      },
      memberSlots: {
        ...player.memberSlots,
        slots: {
          [SlotPosition.LEFT]: null,
          [SlotPosition.CENTER]: kahoCardId!,
          [SlotPosition.RIGHT]: null,
        },
        cardStates: new Map([
          [kahoCardId!, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
        ]),
      },
    }));
    (session as unknown as { authorityState: GameState }).authorityState = preparedState;
    const actionHistoryLength = preparedState.actionHistory.length;

    const activateResult = session.executeCommand(
      createActivateAbilityCommand(
        PLAYER1,
        kahoCardId!,
        HS_BP5_001_ACTIVATED_REVEAL_HAND_LIVE_RECOVER_SAME_NAME_LIVE_ABILITY_ID
      )
    );

    expect(activateResult.success).toBe(false);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.actionHistory).toHaveLength(actionHistoryLength);
    expect(session.state?.players[0].hand.cardIds).toEqual([handLiveCardId]);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([sameNameLiveCardId]);
    expect(
      session.state?.players[0].energyZone.cardStates.get(energyCardIds[0]!)?.orientation
    ).toBe(OrientationState.ACTIVE);
  });

  it('executes PL!HS-bp1-003-SEC activated ability to recover a low-cost Hasunosora member', () => {
    const session = createGameSession();
    const deck = createDeck();

    session.createGame(
      'sample-hs-bp1-003-activated-runner',
      PLAYER1,
      'Player 1',
      PLAYER2,
      'Player 2'
    );
    session.initializeGame(deck, deck);
    forceMainPhaseForPlayer(session);

    const state = session.state!;
    const ownedP1CardIds = [...state.cardRegistry.values()]
      .filter((card) => card.ownerId === PLAYER1)
      .map((card) => card.instanceId);
    const kosuzuCardId = ownedP1CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardCode === 'PL!HS-bp1-003-SEC'
    );
    const lowCostHasuCardId = ownedP1CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardCode === 'MEM-HASU-0'
    );
    const nonHasuCardId = ownedP1CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardCode === 'MEM-0'
    );
    const energyCardIds = ownedP1CardIds.filter(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardType === CardType.ENERGY
    );

    expect(kosuzuCardId).toBeTruthy();
    expect(lowCostHasuCardId).toBeTruthy();
    expect(nonHasuCardId).toBeTruthy();
    expect(energyCardIds.length).toBeGreaterThanOrEqual(1);

    const preparedState = updatePlayer(state, PLAYER1, (player) => ({
      ...player,
      hand: { ...player.hand, cardIds: [] },
      mainDeck: { ...player.mainDeck, cardIds: [] },
      waitingRoom: { ...player.waitingRoom, cardIds: [lowCostHasuCardId!, nonHasuCardId!] },
      successZone: { ...player.successZone, cardIds: [] },
      liveZone: { ...player.liveZone, cardIds: [] },
      energyZone: {
        ...player.energyZone,
        cardIds: energyCardIds.slice(0, 3),
        cardStates: new Map(
          energyCardIds
            .slice(0, 3)
            .map((cardId) => [
              cardId,
              { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP },
            ])
        ),
      },
      memberSlots: {
        ...player.memberSlots,
        slots: {
          [SlotPosition.LEFT]: null,
          [SlotPosition.CENTER]: kosuzuCardId!,
          [SlotPosition.RIGHT]: null,
        },
        cardStates: new Map([
          [kosuzuCardId!, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
        ]),
      },
    }));
    (session as unknown as { authorityState: GameState }).authorityState = preparedState;

    const activateResult = session.executeCommand(
      createActivateAbilityCommand(
        PLAYER1,
        kosuzuCardId!,
        HS_BP1_003_ACTIVATED_RECOVER_LOW_COST_HASUNOSORA_MEMBER_ABILITY_ID
      )
    );

    expect(activateResult.success).toBe(true);
    expect(session.state?.activeEffect?.abilityId).toBe(
      HS_BP1_003_ACTIVATED_RECOVER_LOW_COST_HASUNOSORA_MEMBER_ABILITY_ID
    );
    expect(session.state?.activeEffect?.selectableCardIds).toEqual([lowCostHasuCardId]);
    expect(session.state?.activeEffect?.selectableCardIds).not.toContain(nonHasuCardId);
    expect(
      session.state?.players[0].energyZone.cardStates.get(energyCardIds[0]!)?.orientation
    ).toBe(OrientationState.WAITING);

    const selectResult = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id, lowCostHasuCardId!)
    );

    expect(selectResult.success).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].hand.cardIds).toContain(lowCostHasuCardId);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([nonHasuCardId]);
  });

  it('executes PL!HS-bp1-002-RM activated ability to play a Hasunosora member to the source slot', () => {
    const session = createGameSession();
    const deck = createDeck();

    session.createGame(
      'sample-hs-bp1-002-activated-runner',
      PLAYER1,
      'Player 1',
      PLAYER2,
      'Player 2'
    );
    session.initializeGame(deck, deck);
    forceMainPhaseForPlayer(session);

    const state = session.state!;
    const ownedP1CardIds = [...state.cardRegistry.values()]
      .filter((card) => card.ownerId === PLAYER1)
      .map((card) => card.instanceId);
    const sayakaCardId = ownedP1CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardCode === 'PL!HS-bp1-002-RM'
    );
    const targetCardId = ownedP1CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardCode === 'MEM-HASU-1'
    );
    const nonHasuCardId = ownedP1CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardCode === 'MEM-1'
    );
    const energyCardIds = ownedP1CardIds.filter(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardType === CardType.ENERGY
    );

    expect(sayakaCardId).toBeTruthy();
    expect(targetCardId).toBeTruthy();
    expect(nonHasuCardId).toBeTruthy();
    expect(energyCardIds.length).toBeGreaterThanOrEqual(2);

    const preparedState = updatePlayer(state, PLAYER1, (player) => ({
      ...player,
      hand: { ...player.hand, cardIds: [] },
      mainDeck: { ...player.mainDeck, cardIds: [] },
      waitingRoom: { ...player.waitingRoom, cardIds: [targetCardId!, nonHasuCardId!] },
      successZone: { ...player.successZone, cardIds: [] },
      liveZone: { ...player.liveZone, cardIds: [] },
      energyZone: {
        ...player.energyZone,
        cardIds: energyCardIds.slice(0, 4),
        cardStates: new Map(
          energyCardIds
            .slice(0, 4)
            .map((cardId) => [
              cardId,
              { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP },
            ])
        ),
      },
      memberSlots: {
        ...player.memberSlots,
        slots: {
          [SlotPosition.LEFT]: null,
          [SlotPosition.CENTER]: sayakaCardId!,
          [SlotPosition.RIGHT]: null,
        },
        cardStates: new Map([
          [sayakaCardId!, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
        ]),
      },
    }));
    (session as unknown as { authorityState: GameState }).authorityState = preparedState;

    const activateResult = session.executeCommand(
      createActivateAbilityCommand(
        PLAYER1,
        sayakaCardId!,
        HS_BP1_002_ACTIVATED_PLAY_HASUNOSORA_MEMBER_TO_SOURCE_SLOT_ABILITY_ID
      )
    );

    expect(activateResult.success).toBe(true);
    expect(session.state?.activeEffect?.abilityId).toBe(
      HS_BP1_002_ACTIVATED_PLAY_HASUNOSORA_MEMBER_TO_SOURCE_SLOT_ABILITY_ID
    );
    expect(session.state?.activeEffect?.selectableCardIds).toEqual(
      expect.arrayContaining([targetCardId!, sayakaCardId!])
    );
    expect(session.state?.activeEffect?.selectableCardIds).not.toContain(nonHasuCardId);
    expect(session.state?.players[0].memberSlots.slots[SlotPosition.CENTER]).toBeNull();
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual(
      expect.arrayContaining([targetCardId!, nonHasuCardId!, sayakaCardId!])
    );

    const selectResult = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id, targetCardId!)
    );

    expect(selectResult.success).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].memberSlots.slots[SlotPosition.CENTER]).toBe(targetCardId);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual(
      expect.arrayContaining([nonHasuCardId!, sayakaCardId!])
    );
    expect(
      session.state?.players[0].energyZone.cardStates.get(energyCardIds[0]!)?.orientation
    ).toBe(OrientationState.WAITING);
    expect(
      session.state?.players[0].energyZone.cardStates.get(energyCardIds[1]!)?.orientation
    ).toBe(OrientationState.WAITING);
  });

  it('keeps PL!HS-bp1-002-RM cost unpaid when no waiting-room member target remains after cost', () => {
    const session = createGameSession();
    const deck = createDeck();

    session.createGame(
      'sample-hs-bp1-002-activated-no-target-after-cost',
      PLAYER1,
      'Player 1',
      PLAYER2,
      'Player 2'
    );
    session.initializeGame(deck, deck);
    forceMainPhaseForPlayer(session);

    const state = session.state!;
    const ownedP1CardIds = [...state.cardRegistry.values()]
      .filter((card) => card.ownerId === PLAYER1)
      .map((card) => card.instanceId);
    const sayakaCardId = ownedP1CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardCode === 'PL!HS-bp1-002-RM'
    );
    const nonHasuCardId = ownedP1CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardCode === 'MEM-1'
    );
    const energyCardIds = ownedP1CardIds.filter(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardType === CardType.ENERGY
    );

    expect(sayakaCardId).toBeTruthy();
    expect(nonHasuCardId).toBeTruthy();
    expect(energyCardIds.length).toBeGreaterThanOrEqual(2);

    const sourceCard = state.cardRegistry.get(sayakaCardId!) as unknown as {
      data: MemberCardData;
    };
    sourceCard.data = createMemberCard('PL!HS-bp1-002-RM', '村野沙耶香', 16, '莲之空');

    const preparedState = updatePlayer(state, PLAYER1, (player) => ({
      ...player,
      hand: { ...player.hand, cardIds: [] },
      mainDeck: { ...player.mainDeck, cardIds: [] },
      waitingRoom: { ...player.waitingRoom, cardIds: [nonHasuCardId!] },
      successZone: { ...player.successZone, cardIds: [] },
      liveZone: { ...player.liveZone, cardIds: [] },
      energyZone: {
        ...player.energyZone,
        cardIds: energyCardIds.slice(0, 2),
        cardStates: new Map(
          energyCardIds
            .slice(0, 2)
            .map((cardId) => [
              cardId,
              { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP },
            ])
        ),
      },
      memberSlots: {
        ...player.memberSlots,
        slots: {
          [SlotPosition.LEFT]: null,
          [SlotPosition.CENTER]: sayakaCardId!,
          [SlotPosition.RIGHT]: null,
        },
        cardStates: new Map([
          [sayakaCardId!, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
        ]),
      },
    }));
    (session as unknown as { authorityState: GameState }).authorityState = preparedState;
    const actionHistoryLength = preparedState.actionHistory.length;

    const activateResult = session.executeCommand(
      createActivateAbilityCommand(
        PLAYER1,
        sayakaCardId!,
        HS_BP1_002_ACTIVATED_PLAY_HASUNOSORA_MEMBER_TO_SOURCE_SLOT_ABILITY_ID
      )
    );

    expect(activateResult.success).toBe(false);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.actionHistory).toHaveLength(actionHistoryLength);
    expect(session.state?.players[0].memberSlots.slots[SlotPosition.CENTER]).toBe(sayakaCardId);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([nonHasuCardId]);
    expect(
      session.state?.players[0].energyZone.cardStates.get(energyCardIds[0]!)?.orientation
    ).toBe(OrientationState.ACTIVE);
    expect(
      session.state?.players[0].energyZone.cardStates.get(energyCardIds[1]!)?.orientation
    ).toBe(OrientationState.ACTIVE);
  });

  it('allows PL!SP-PR-004-PR on-enter effect to be declined without placing energy', () => {
    const session = createGameSession();
    const deck = createDeck();

    session.createGame('sample-keke-skip-energy-runner', PLAYER1, 'Player 1', PLAYER2, 'Player 2');
    session.initializeGame(deck, deck);
    forceMainPhaseForPlayer(session);

    const state = session.state!;
    const p1 = state.players[0] as unknown as {
      hand: { cardIds: string[] };
      mainDeck: { cardIds: string[] };
      waitingRoom: { cardIds: string[] };
      successZone: { cardIds: string[] };
      liveZone: { cardIds: string[] };
      energyDeck: { cardIds: string[] };
      energyZone: {
        cardIds: string[];
        cardStates: Map<string, { orientation: OrientationState; face: FaceState }>;
      };
      memberSlots: { slots: Record<SlotPosition, string | null> };
    };

    const ownedP1CardIds = [...state.cardRegistry.values()]
      .filter((card) => card.ownerId === PLAYER1)
      .map((card) => card.instanceId);
    const kekeCardId = ownedP1CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardCode === 'PL!SP-PR-004-PR'
    );
    const energyCardIds = ownedP1CardIds.filter(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardType === CardType.ENERGY
    );

    expect(kekeCardId).toBeTruthy();
    expect(energyCardIds.length).toBeGreaterThanOrEqual(6);

    removeFromPlayerZones(p1);
    setActiveEnergy(p1, energyCardIds.slice(0, 4));
    p1.energyDeck.cardIds = energyCardIds.slice(4, 6);
    p1.hand.cardIds = [kekeCardId!];
    p1.memberSlots.slots[SlotPosition.CENTER] = null;

    const playResult = session.executeCommand(
      createPlayMemberToSlotCommand(PLAYER1, kekeCardId!, SlotPosition.CENTER)
    );

    expect(playResult.success).toBe(true);
    expect(session.state?.activeEffect?.abilityId).toBe(
      KEKE_ON_ENTER_PLACE_WAITING_ENERGY_ABILITY_ID
    );
    expect(session.state?.activeEffect?.selectableCardIds).toEqual([]);
    expect(session.state?.activeEffect?.canSkipSelection).toBe(true);

    const skipResult = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id, null)
    );

    expect(skipResult.success).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].energyDeck.cardIds).toEqual(energyCardIds.slice(4, 6));
    expect(session.state?.players[0].energyZone.cardIds).toEqual(energyCardIds.slice(0, 4));
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([]);
  });

  it('executes PL!SP-PR-004-PR on-enter discard one and place waiting energy', () => {
    const session = createGameSession();
    const deck = createDeck();

    session.createGame('sample-keke-place-energy-runner', PLAYER1, 'Player 1', PLAYER2, 'Player 2');
    session.initializeGame(deck, deck);
    forceMainPhaseForPlayer(session);

    const state = session.state!;
    const p1 = state.players[0] as unknown as {
      hand: { cardIds: string[] };
      mainDeck: { cardIds: string[] };
      waitingRoom: { cardIds: string[] };
      successZone: { cardIds: string[] };
      liveZone: { cardIds: string[] };
      energyDeck: { cardIds: string[] };
      energyZone: {
        cardIds: string[];
        cardStates: Map<string, { orientation: OrientationState; face: FaceState }>;
      };
      memberSlots: { slots: Record<SlotPosition, string | null> };
    };

    const ownedP1CardIds = [...state.cardRegistry.values()]
      .filter((card) => card.ownerId === PLAYER1)
      .map((card) => card.instanceId);
    const kekeCardId = ownedP1CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardCode === 'PL!SP-PR-004-PR'
    );
    const discardCardId = ownedP1CardIds.find(
      (cardId) =>
        cardId !== kekeCardId && state.cardRegistry.get(cardId)?.data.cardType === CardType.MEMBER
    );
    const energyCardIds = ownedP1CardIds.filter(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardType === CardType.ENERGY
    );
    const activeEnergyIds = energyCardIds.slice(0, 4);
    const effectEnergyDeckIds = energyCardIds.slice(4, 7);
    const placedEnergyCardId = effectEnergyDeckIds[0];

    expect(kekeCardId).toBeTruthy();
    expect(discardCardId).toBeTruthy();
    expect(effectEnergyDeckIds.length).toBe(3);

    removeFromPlayerZones(p1);
    setActiveEnergy(p1, activeEnergyIds);
    p1.energyDeck.cardIds = [...effectEnergyDeckIds];
    p1.hand.cardIds = [kekeCardId!, discardCardId!];
    p1.memberSlots.slots[SlotPosition.CENTER] = null;

    const playResult = session.executeCommand(
      createPlayMemberToSlotCommand(PLAYER1, kekeCardId!, SlotPosition.CENTER)
    );

    expect(playResult.success).toBe(true);
    expect(session.state?.activeEffect?.abilityId).toBe(
      KEKE_ON_ENTER_PLACE_WAITING_ENERGY_ABILITY_ID
    );
    expect(session.state?.activeEffect?.selectableCardIds).toEqual([discardCardId]);

    const confirmResult = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id, discardCardId)
    );

    expect(confirmResult.success).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].hand.cardIds).toEqual([]);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([discardCardId]);
    expect(session.state?.players[0].energyDeck.cardIds).toEqual(effectEnergyDeckIds.slice(1));
    expect(session.state?.players[0].energyZone.cardIds).toEqual([
      ...activeEnergyIds,
      placedEnergyCardId,
    ]);
    expect(
      session.state?.players[0].energyZone.cardStates.get(placedEnergyCardId)?.orientation
    ).toBe(OrientationState.WAITING);
    expect(
      session.state?.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId === KEKE_ON_ENTER_PLACE_WAITING_ENERGY_ABILITY_ID &&
          action.payload.step === 'PLACE_WAITING_ENERGY' &&
          action.payload.discardCardId === discardCardId &&
          Array.isArray(action.payload.placedEnergyCardIds) &&
          action.payload.placedEnergyCardIds[0] === placedEnergyCardId
      )
    ).toBe(true);
  });

  it('executes PL!SP-PR-013-PR on-enter discard one and place waiting energy through shared shell', () => {
    const session = createGameSession();
    const deck = createDeck();

    session.createGame(
      'sample-pr013-keke-place-energy-runner',
      PLAYER1,
      'Player 1',
      PLAYER2,
      'Player 2'
    );
    session.initializeGame(deck, deck);
    forceMainPhaseForPlayer(session);

    const pr013Card = createCardInstance(
      createMemberCard('PL!SP-PR-013-PR', '鬼冢 冬毬', 4),
      PLAYER1,
      'p1-keke-pr013'
    );
    const discardCard = createCardInstance(
      createMemberCard('PL!HS-test-discard', '日野下花帆', 1),
      PLAYER1,
      'p1-keke-pr013-discard'
    );

    let state = registerCards(session.state!, [pr013Card, discardCard]);

    const p1 = state.players[0] as unknown as {
      hand: { cardIds: string[] };
      mainDeck: { cardIds: string[] };
      waitingRoom: { cardIds: string[] };
      successZone: { cardIds: string[] };
      liveZone: { cardIds: string[] };
      energyDeck: { cardIds: string[] };
      energyZone: {
        cardIds: string[];
        cardStates: Map<string, { orientation: OrientationState; face: FaceState }>;
      };
      memberSlots: { slots: Record<SlotPosition, string | null> };
    };
    const energyCardIds = [...state.cardRegistry.values()]
      .filter((card) => card.ownerId === PLAYER1 && card.data.cardType === CardType.ENERGY)
      .map((card) => card.instanceId);
    const activeEnergyIds = energyCardIds.slice(0, 4);
    const effectEnergyDeckIds = energyCardIds.slice(4, 7);
    const placedEnergyCardId = effectEnergyDeckIds[0];

    expect(effectEnergyDeckIds.length).toBe(3);

    removeFromPlayerZones(p1);
    setActiveEnergy(p1, activeEnergyIds);
    p1.energyDeck.cardIds = [...effectEnergyDeckIds];
    p1.hand.cardIds = [pr013Card.instanceId, discardCard.instanceId];
    p1.memberSlots.slots[SlotPosition.CENTER] = null;
    (session as unknown as { authorityState: GameState }).authorityState = state;

    const playResult = session.executeCommand(
      createPlayMemberToSlotCommand(PLAYER1, pr013Card.instanceId, SlotPosition.CENTER)
    );

    expect(playResult.success).toBe(true);
    expect(session.state?.activeEffect?.abilityId).toBe(
      KEKE_ON_ENTER_PLACE_WAITING_ENERGY_ABILITY_ID
    );
    expect(session.state?.activeEffect?.selectableCardIds).toEqual([discardCard.instanceId]);

    const confirmResult = session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        session.state!.activeEffect!.id,
        discardCard.instanceId
      )
    );

    expect(confirmResult.success).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].hand.cardIds).toEqual([]);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([discardCard.instanceId]);
    expect(session.state?.players[0].energyDeck.cardIds).toEqual(effectEnergyDeckIds.slice(1));
    expect(session.state?.players[0].energyZone.cardIds).toEqual([
      ...activeEnergyIds,
      placedEnergyCardId,
    ]);
    expect(
      session.state?.players[0].energyZone.cardStates.get(placedEnergyCardId)?.orientation
    ).toBe(OrientationState.WAITING);
  });

  it('executes PL!SP-bp4-008-P left-side on-enter effect to draw two and discard one', () => {
    const session = createGameSession();
    const deck = createDeck();

    session.createGame(
      'sample-shiki-left-draw-discard-runner',
      PLAYER1,
      'Player 1',
      PLAYER2,
      'Player 2'
    );
    session.initializeGame(deck, deck);
    forceMainPhaseForPlayer(session);

    const state = session.state!;
    const p1 = state.players[0] as unknown as {
      hand: { cardIds: string[] };
      mainDeck: { cardIds: string[] };
      waitingRoom: { cardIds: string[] };
      successZone: { cardIds: string[] };
      liveZone: { cardIds: string[] };
      energyDeck: { cardIds: string[] };
      energyZone: {
        cardIds: string[];
        cardStates: Map<string, { orientation: OrientationState; face: FaceState }>;
      };
      memberSlots: {
        slots: Record<SlotPosition, string | null>;
        cardStates: Map<string, { orientation: OrientationState; face: FaceState }>;
      };
    };

    const ownedP1CardIds = [...state.cardRegistry.values()]
      .filter((card) => card.ownerId === PLAYER1)
      .map((card) => card.instanceId);
    const shikiCardId = ownedP1CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardCode === 'PL!SP-bp4-008-P'
    );
    const relayMemberCardId = ownedP1CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardCode === 'PL!-sd1-003-SD'
    );
    const drawnCardIds = ownedP1CardIds.filter((cardId) => {
      const card = state.cardRegistry.get(cardId);
      return (
        cardId !== shikiCardId &&
        cardId !== relayMemberCardId &&
        card?.data.cardType === CardType.MEMBER
      );
    });
    const firstDrawnCardId = drawnCardIds[0];
    const secondDrawnCardId = drawnCardIds[1];
    const remainingDeckCardId = drawnCardIds[2];

    expect(shikiCardId).toBeTruthy();
    expect(relayMemberCardId).toBeTruthy();
    expect(drawnCardIds.length).toBeGreaterThanOrEqual(3);

    removeFromPlayerZones(p1);
    p1.energyDeck.cardIds = [];
    setEnergyZoneCards(p1, []);
    p1.hand.cardIds = [shikiCardId!];
    p1.mainDeck.cardIds = [firstDrawnCardId, secondDrawnCardId, remainingDeckCardId];
    p1.memberSlots.slots[SlotPosition.LEFT] = relayMemberCardId!;
    p1.memberSlots.cardStates = new Map([
      [relayMemberCardId!, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
    ]);

    const playResult = session.executeCommand(
      createPlayMemberToSlotCommand(PLAYER1, shikiCardId!, SlotPosition.LEFT)
    );

    expect(playResult.success).toBe(true);
    expect(session.state?.players[0].memberSlots.slots[SlotPosition.LEFT]).toBe(shikiCardId);
    expect(session.state?.activeEffect?.abilityId).toBe(
      SHIKI_ON_ENTER_LEFT_DRAW_DISCARD_ABILITY_ID
    );
    expect(session.state?.activeEffect?.metadata?.sourceSlot).toBe(SlotPosition.LEFT);
    expect(session.state?.activeEffect?.metadata?.drawnCardIds).toEqual([
      firstDrawnCardId,
      secondDrawnCardId,
    ]);
    expect(session.state?.activeEffect?.selectableCardIds).toEqual([
      firstDrawnCardId,
      secondDrawnCardId,
    ]);
    expect(session.state?.players[0].hand.cardIds).toEqual([firstDrawnCardId, secondDrawnCardId]);
    expect(session.state?.players[0].mainDeck.cardIds).toEqual([remainingDeckCardId]);
    expect(
      session.state?.actionHistory.some(
        (action) =>
          action.type === 'TRIGGER_ABILITY' &&
          action.payload.abilityId === SHIKI_ON_ENTER_LEFT_DRAW_DISCARD_ABILITY_ID &&
          action.payload.sourceSlot === SlotPosition.LEFT
      )
    ).toBe(true);

    const confirmResult = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id, secondDrawnCardId)
    );

    expect(confirmResult.success).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].hand.cardIds).toEqual([firstDrawnCardId]);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([
      relayMemberCardId,
      secondDrawnCardId,
    ]);
    expect(
      session.state?.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId === SHIKI_ON_ENTER_LEFT_DRAW_DISCARD_ABILITY_ID &&
          action.payload.step === 'DISCARD_HAND_CARD' &&
          action.payload.discardedCardId === secondDrawnCardId &&
          Array.isArray(action.payload.drawnCardIds) &&
          action.payload.drawnCardIds[0] === firstDrawnCardId &&
          action.payload.drawnCardIds[1] === secondDrawnCardId
      )
    ).toBe(true);
  });

  it('executes PL!SP-bp4-008-P right-side on-enter effect to activate two waiting energy', () => {
    const session = createGameSession();
    const deck = createDeck();

    session.createGame(
      'sample-shiki-right-activate-energy-runner',
      PLAYER1,
      'Player 1',
      PLAYER2,
      'Player 2'
    );
    session.initializeGame(deck, deck);
    forceMainPhaseForPlayer(session);

    const state = session.state!;
    const p1 = state.players[0] as unknown as {
      hand: { cardIds: string[] };
      mainDeck: { cardIds: string[] };
      waitingRoom: { cardIds: string[] };
      successZone: { cardIds: string[] };
      liveZone: { cardIds: string[] };
      energyDeck: { cardIds: string[] };
      energyZone: {
        cardIds: string[];
        cardStates: Map<string, { orientation: OrientationState; face: FaceState }>;
      };
      memberSlots: {
        slots: Record<SlotPosition, string | null>;
        cardStates: Map<string, { orientation: OrientationState; face: FaceState }>;
      };
    };

    const ownedP1CardIds = [...state.cardRegistry.values()]
      .filter((card) => card.ownerId === PLAYER1)
      .map((card) => card.instanceId);
    const shikiCardId = ownedP1CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardCode === 'PL!SP-bp4-008-P'
    );
    const relayMemberCardId = ownedP1CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardCode === 'PL!-sd1-003-SD'
    );
    const energyCardIds = ownedP1CardIds.filter(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardType === CardType.ENERGY
    );
    const energyToActivate = energyCardIds.slice(0, 2);
    const waitingEnergyToLeave = energyCardIds[2];
    const activeEnergyToLeave = energyCardIds[3];

    expect(shikiCardId).toBeTruthy();
    expect(relayMemberCardId).toBeTruthy();
    expect(energyCardIds.length).toBeGreaterThanOrEqual(4);

    removeFromPlayerZones(p1);
    p1.energyDeck.cardIds = [];
    setEnergyZoneCards(p1, [
      { cardId: energyToActivate[0], orientation: OrientationState.WAITING },
      { cardId: energyToActivate[1], orientation: OrientationState.WAITING },
      { cardId: waitingEnergyToLeave, orientation: OrientationState.WAITING },
      { cardId: activeEnergyToLeave, orientation: OrientationState.ACTIVE },
    ]);
    p1.hand.cardIds = [shikiCardId!];
    p1.memberSlots.slots[SlotPosition.RIGHT] = relayMemberCardId!;
    p1.memberSlots.cardStates = new Map([
      [relayMemberCardId!, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
    ]);

    const playResult = session.executeCommand(
      createPlayMemberToSlotCommand(PLAYER1, shikiCardId!, SlotPosition.RIGHT)
    );

    expect(playResult.success).toBe(true);
    expect(session.state?.players[0].memberSlots.slots[SlotPosition.RIGHT]).toBe(shikiCardId);
    expect(session.state?.activeEffect?.abilityId).toBe(
      SHIKI_ON_ENTER_RIGHT_ACTIVATE_ENERGY_ABILITY_ID
    );
    expect(session.state?.activeEffect?.metadata?.sourceSlot).toBe(SlotPosition.RIGHT);
    expect(
      session.state?.actionHistory.some(
        (action) =>
          action.type === 'TRIGGER_ABILITY' &&
          action.payload.abilityId === SHIKI_ON_ENTER_RIGHT_ACTIVATE_ENERGY_ABILITY_ID &&
          action.payload.sourceSlot === SlotPosition.RIGHT
      )
    ).toBe(true);

    const confirmResult = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id)
    );

    expect(confirmResult.success).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(
      session.state?.players[0].energyZone.cardStates.get(energyToActivate[0])?.orientation
    ).toBe(OrientationState.ACTIVE);
    expect(
      session.state?.players[0].energyZone.cardStates.get(energyToActivate[1])?.orientation
    ).toBe(OrientationState.ACTIVE);
    expect(
      session.state?.players[0].energyZone.cardStates.get(waitingEnergyToLeave)?.orientation
    ).toBe(OrientationState.WAITING);
    expect(
      session.state?.players[0].energyZone.cardStates.get(activeEnergyToLeave)?.orientation
    ).toBe(OrientationState.ACTIVE);
    expect(
      session.state?.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId === SHIKI_ON_ENTER_RIGHT_ACTIVATE_ENERGY_ABILITY_ID &&
          action.payload.step === 'ACTIVATE_ENERGY' &&
          Array.isArray(action.payload.activatedEnergyCardIds) &&
          action.payload.activatedEnergyCardIds[0] === energyToActivate[0] &&
          action.payload.activatedEnergyCardIds[1] === energyToActivate[1]
      )
    ).toBe(true);
  });

  it('does not trigger PL!SP-bp4-008-P right-side on-enter effect from the center slot', () => {
    const session = createGameSession();
    const deck = createDeck();

    session.createGame(
      'sample-shiki-center-no-right-energy-runner',
      PLAYER1,
      'Player 1',
      PLAYER2,
      'Player 2'
    );
    session.initializeGame(deck, deck);
    forceMainPhaseForPlayer(session);

    const state = session.state!;
    const p1 = state.players[0] as unknown as {
      hand: { cardIds: string[] };
      mainDeck: { cardIds: string[] };
      waitingRoom: { cardIds: string[] };
      successZone: { cardIds: string[] };
      liveZone: { cardIds: string[] };
      energyDeck: { cardIds: string[] };
      energyZone: {
        cardIds: string[];
        cardStates: Map<string, { orientation: OrientationState; face: FaceState }>;
      };
      memberSlots: {
        slots: Record<SlotPosition, string | null>;
        cardStates: Map<string, { orientation: OrientationState; face: FaceState }>;
      };
    };

    const ownedP1CardIds = [...state.cardRegistry.values()]
      .filter((card) => card.ownerId === PLAYER1)
      .map((card) => card.instanceId);
    const shikiCardId = ownedP1CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardCode === 'PL!SP-bp4-008-P'
    );
    const relayMemberCardId = ownedP1CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardCode === 'PL!-sd1-003-SD'
    );
    const energyCardIds = ownedP1CardIds.filter(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardType === CardType.ENERGY
    );

    expect(shikiCardId).toBeTruthy();
    expect(relayMemberCardId).toBeTruthy();
    expect(energyCardIds.length).toBeGreaterThanOrEqual(2);

    removeFromPlayerZones(p1);
    p1.energyDeck.cardIds = [];
    setEnergyZoneCards(p1, [
      { cardId: energyCardIds[0], orientation: OrientationState.WAITING },
      { cardId: energyCardIds[1], orientation: OrientationState.WAITING },
    ]);
    p1.hand.cardIds = [shikiCardId!];
    p1.memberSlots.slots[SlotPosition.CENTER] = relayMemberCardId!;
    p1.memberSlots.cardStates = new Map([
      [relayMemberCardId!, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
    ]);

    const playResult = session.executeCommand(
      createPlayMemberToSlotCommand(PLAYER1, shikiCardId!, SlotPosition.CENTER)
    );

    expect(playResult.success).toBe(true);
    expect(session.state?.players[0].memberSlots.slots[SlotPosition.CENTER]).toBe(shikiCardId);
    expect(session.state?.activeEffect).toBeNull();
    expect(
      session.state?.pendingAbilities.some(
        (ability) =>
          ability.abilityId === SHIKI_ON_ENTER_LEFT_DRAW_DISCARD_ABILITY_ID ||
          ability.abilityId === SHIKI_ON_ENTER_RIGHT_ACTIVATE_ENERGY_ABILITY_ID
      )
    ).toBe(false);
    expect(session.state?.players[0].energyZone.cardStates.get(energyCardIds[0])?.orientation).toBe(
      OrientationState.WAITING
    );
    expect(
      session.state?.actionHistory.some(
        (action) =>
          action.type === 'TRIGGER_ABILITY' &&
          (action.payload.abilityId === SHIKI_ON_ENTER_LEFT_DRAW_DISCARD_ABILITY_ID ||
            action.payload.abilityId === SHIKI_ON_ENTER_RIGHT_ACTIVATE_ENERGY_ABILITY_ID)
      )
    ).toBe(false);
  });

  it('executes PL!SP-bp4-008-P live-start optional position change', () => {
    const session = createGameSession();
    const deck = createDeck();

    session.createGame(
      'sample-shiki-live-start-position-change-runner',
      PLAYER1,
      'Player 1',
      PLAYER2,
      'Player 2'
    );
    session.initializeGame(deck, deck);

    const state = session.state!;
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

    const ownedP1CardIds = [...state.cardRegistry.values()]
      .filter((card) => card.ownerId === PLAYER1)
      .map((card) => card.instanceId);
    const shikiCardId = ownedP1CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardCode === 'PL!SP-bp4-008-P'
    );
    const rightMemberCardId = ownedP1CardIds.find(
      (cardId) =>
        cardId !== shikiCardId && state.cardRegistry.get(cardId)?.data.cardCode === 'MEM-0'
    );
    const liveCardId = ownedP1CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardType === CardType.LIVE
    );

    expect(shikiCardId).toBeTruthy();
    expect(rightMemberCardId).toBeTruthy();
    expect(liveCardId).toBeTruthy();

    removeFromPlayerZones(p1);
    p1.memberSlots.slots[SlotPosition.CENTER] = shikiCardId!;
    p1.memberSlots.slots[SlotPosition.RIGHT] = rightMemberCardId!;
    p1.memberSlots.cardStates = new Map([
      [shikiCardId!, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
      [rightMemberCardId!, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
    ]);
    p1.liveZone.cardIds = [liveCardId!];
    p1.liveZone.cardStates = new Map([
      [liveCardId!, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_DOWN }],
    ]);
    p1.liveZone.cardStates = new Map([
      [liveCardId!, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_DOWN }],
    ]);

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
    (session as unknown as { authorityState: GameState }).authorityState = advanceResult.gameState;

    expect(advanceResult.success).toBe(true);
    expect(session.state?.currentPhase).toBe(GamePhase.PERFORMANCE_PHASE);
    expect(session.state?.currentSubPhase).toBe(SubPhase.PERFORMANCE_LIVE_START_EFFECTS);
    expect(session.state?.activeEffect?.abilityId).toBe(
      SHIKI_LIVE_START_POSITION_CHANGE_ABILITY_ID
    );
    expect(session.state?.activeEffect?.sourceCardId).toBe(shikiCardId);
    expect(session.state?.activeEffect?.selectableSlots).toEqual([
      SlotPosition.LEFT,
      SlotPosition.RIGHT,
    ]);
    expect(session.state?.activeEffect?.canSkipSelection).toBe(true);
    expect(session.state?.activeEffect?.metadata?.sourceSlot).toBe(SlotPosition.CENTER);
    expect(
      session.state?.actionHistory.some(
        (action) =>
          action.type === 'TRIGGER_ABILITY' &&
          action.payload.abilityId === SHIKI_LIVE_START_POSITION_CHANGE_ABILITY_ID &&
          action.payload.sourceSlot === SlotPosition.CENTER
      )
    ).toBe(true);

    const positionResult = session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        session.state!.activeEffect!.id,
        undefined,
        SlotPosition.RIGHT
      )
    );

    expect(positionResult.success).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].memberSlots.slots[SlotPosition.CENTER]).toBe(
      rightMemberCardId
    );
    expect(session.state?.players[0].memberSlots.slots[SlotPosition.RIGHT]).toBe(shikiCardId);
    expect(
      session.state?.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId === SHIKI_LIVE_START_POSITION_CHANGE_ABILITY_ID &&
          action.payload.step === 'POSITION_CHANGE' &&
          action.payload.fromSlot === SlotPosition.CENTER &&
          action.payload.toSlot === SlotPosition.RIGHT &&
          action.payload.swappedCardId === rightMemberCardId
      )
    ).toBe(true);
  });

  it('limits PL!-sd1-008-SD activated ability to once per turn per source card', () => {
    const session = createGameSession();
    const deck = createDeck();

    session.createGame(
      'sample-hanayo-once-per-turn-runner',
      PLAYER1,
      'Player 1',
      PLAYER2,
      'Player 2'
    );
    session.initializeGame(deck, deck);
    forceMainPhaseForPlayer(session);

    const state = session.state!;
    const p1 = state.players[0] as unknown as {
      hand: { cardIds: string[] };
      mainDeck: { cardIds: string[] };
      waitingRoom: { cardIds: string[] };
      successZone: { cardIds: string[] };
      liveZone: { cardIds: string[] };
      energyZone: {
        cardIds: string[];
        cardStates: Map<string, { orientation: OrientationState; face: FaceState }>;
      };
      memberSlots: {
        slots: Record<SlotPosition, string | null>;
        cardStates: Map<string, { orientation: OrientationState; face: FaceState }>;
      };
    };
    const ownedP1CardIds = [...state.cardRegistry.values()]
      .filter((card) => card.ownerId === PLAYER1)
      .map((card) => card.instanceId);
    const hanayoCardIds = ownedP1CardIds.filter(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardCode === 'PL!-sd1-008-SD'
    );
    const [firstHanayoCardId, secondHanayoCardId] = hanayoCardIds;
    const energyCardIds = ownedP1CardIds.filter(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardType === CardType.ENERGY
    );
    const deckCardIds = ownedP1CardIds.filter(
      (cardId) =>
        !hanayoCardIds.includes(cardId) &&
        state.cardRegistry.get(cardId)?.data.cardType !== CardType.ENERGY
    );

    expect(firstHanayoCardId).toBeTruthy();
    expect(secondHanayoCardId).toBeTruthy();
    expect(energyCardIds.length).toBeGreaterThanOrEqual(4);
    expect(deckCardIds.length).toBeGreaterThanOrEqual(20);

    removeFromPlayerZones(p1);
    setActiveEnergy(p1, energyCardIds.slice(0, 4));
    p1.mainDeck.cardIds = deckCardIds.slice(0, 20);
    p1.memberSlots.slots[SlotPosition.CENTER] = firstHanayoCardId!;
    p1.memberSlots.slots[SlotPosition.RIGHT] = secondHanayoCardId!;
    p1.memberSlots.cardStates = new Map([
      [firstHanayoCardId!, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
      [secondHanayoCardId!, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
    ]);

    const firstActivateResult = session.executeCommand(
      createActivateAbilityCommand(PLAYER1, firstHanayoCardId!, HANAYO_ACTIVATED_ABILITY_ID)
    );

    expect(firstActivateResult.success).toBe(true);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual(deckCardIds.slice(0, 10));
    expect(session.state?.players[0].mainDeck.cardIds).toEqual(deckCardIds.slice(10, 20));
    expect(
      session.state?.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId === HANAYO_ACTIVATED_ABILITY_ID &&
          action.payload.sourceCardId === firstHanayoCardId &&
          action.payload.step === 'ABILITY_USE' &&
          action.payload.turnCount === session.state?.turnCount
      )
    ).toBe(true);
    expect(
      session.state?.actionHistory.some(
        (action) =>
          action.type === 'PAY_COST' &&
          action.payload.abilityId === HANAYO_ACTIVATED_ABILITY_ID &&
          Array.isArray(action.payload.energyCardIds) &&
          action.payload.energyCardIds.length === 2
      )
    ).toBe(true);

    const secondActivateResult = session.executeCommand(
      createActivateAbilityCommand(PLAYER1, firstHanayoCardId!, HANAYO_ACTIVATED_ABILITY_ID)
    );

    expect(secondActivateResult.success).toBe(false);
    expect(secondActivateResult.error).toContain('本回合已发动 1/1 次');
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual(deckCardIds.slice(0, 10));
    expect(session.state?.players[0].mainDeck.cardIds).toEqual(deckCardIds.slice(10, 20));

    const otherCopyActivateResult = session.executeCommand(
      createActivateAbilityCommand(PLAYER1, secondHanayoCardId!, HANAYO_ACTIVATED_ABILITY_ID)
    );

    expect(otherCopyActivateResult.success).toBe(true);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual(deckCardIds.slice(0, 20));
    expect(session.state?.players[0].mainDeck.cardIds).toEqual([]);
    expect(
      session.state?.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId === HANAYO_ACTIVATED_ABILITY_ID &&
          action.payload.sourceCardId === secondHanayoCardId &&
          action.payload.step === 'ABILITY_USE' &&
          action.payload.turnCount === session.state?.turnCount
      )
    ).toBe(true);
  });

  it('executes PL!N-pb1-004-P+ live-start reveal top, add low-cost member to hand, and position change', () => {
    const session = createGameSession();
    const deck = createDeck();

    session.createGame('sample-live-start-effect-runner', PLAYER1, 'Player 1', PLAYER2, 'Player 2');
    session.initializeGame(deck, deck);

    const state = session.state!;
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

    const ownedP1CardIds = [...state.cardRegistry.values()]
      .filter((card) => card.ownerId === PLAYER1)
      .map((card) => card.instanceId);
    const karinCardId = ownedP1CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardCode === 'PL!N-pb1-004-P+'
    );
    const liveCardId = ownedP1CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardType === CardType.LIVE
    );
    const lowCostMemberCardId = ownedP1CardIds.find((cardId) => {
      const card = state.cardRegistry.get(cardId);
      return (
        cardId !== karinCardId &&
        card?.data.cardType === CardType.MEMBER &&
        'cost' in card.data &&
        card.data.cost <= 9
      );
    });

    expect(karinCardId).toBeTruthy();
    expect(liveCardId).toBeTruthy();
    expect(lowCostMemberCardId).toBeTruthy();

    removeFromPlayerZones(p1);
    p1.memberSlots.slots[SlotPosition.CENTER] = karinCardId!;
    p1.memberSlots.cardStates = new Map([
      [karinCardId!, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
    ]);
    p1.liveZone.cardIds = [liveCardId!];
    p1.liveZone.cardStates = new Map([
      [liveCardId!, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_DOWN }],
    ]);
    p1.mainDeck.cardIds = [lowCostMemberCardId!];

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
    (session as unknown as { authorityState: GameState }).authorityState = advanceResult.gameState;

    expect(advanceResult.success).toBe(true);
    expect(session.state?.currentPhase).toBe(GamePhase.PERFORMANCE_PHASE);
    expect(session.state?.currentSubPhase).toBe(SubPhase.PERFORMANCE_LIVE_START_EFFECTS);
    expect(session.state?.activeEffect?.abilityId).toBe(KARIN_LIVE_START_ABILITY_ID);
    expect(session.state?.inspectionZone.cardIds).toEqual([lowCostMemberCardId]);
    expect(session.state?.inspectionZone.revealedCardIds).toEqual([lowCostMemberCardId]);
    expect(session.state?.players[0].mainDeck.cardIds).toEqual([]);

    const finishResult = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id)
    );

    expect(finishResult.success).toBe(true);
    expect(session.state?.activeEffect?.abilityId).toBe(KARIN_LIVE_START_ABILITY_ID);
    expect(session.state?.activeEffect?.selectableSlots).toEqual([
      SlotPosition.LEFT,
      SlotPosition.RIGHT,
    ]);
    expect(session.state?.inspectionContext).toBeNull();
    expect(session.state?.inspectionZone.cardIds).toEqual([]);
    expect(session.state?.inspectionZone.revealedCardIds).toEqual([]);
    expect(session.state?.players[0].hand.cardIds).toEqual([lowCostMemberCardId]);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([]);

    const positionResult = session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        session.state!.activeEffect!.id,
        undefined,
        SlotPosition.RIGHT
      )
    );

    expect(positionResult.success).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.inspectionContext).toBeNull();
    expect(session.state?.inspectionZone.cardIds).toEqual([]);
    expect(session.state?.inspectionZone.revealedCardIds).toEqual([]);
    expect(session.state?.players[0].hand.cardIds).toEqual([lowCostMemberCardId]);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([]);
    expect(session.state?.players[0].memberSlots.slots[SlotPosition.CENTER]).toBeNull();
    expect(session.state?.players[0].memberSlots.slots[SlotPosition.RIGHT]).toBe(karinCardId);
    expect(
      session.state?.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId === KARIN_LIVE_START_ABILITY_ID &&
          action.payload.step === 'REVEAL_FINISH' &&
          action.payload.destination === 'HAND'
      )
    ).toBe(true);
    expect(
      session.state?.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId === KARIN_LIVE_START_ABILITY_ID &&
          action.payload.step === 'POSITION_CHANGE' &&
          action.payload.fromSlot === SlotPosition.CENTER &&
          action.payload.toSlot === SlotPosition.RIGHT
      )
    ).toBe(true);
  });

  it('lets the player choose or sequentially resolve multiple live-start effects', () => {
    const session = createGameSession();
    const deck = createDeck();

    session.createGame('sample-live-start-order-runner', PLAYER1, 'Player 1', PLAYER2, 'Player 2');
    session.initializeGame(deck, deck);

    const state = session.state!;
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

    const ownedP1CardIds = [...state.cardRegistry.values()]
      .filter((card) => card.ownerId === PLAYER1)
      .map((card) => card.instanceId);
    const karinCardIds = ownedP1CardIds.filter(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardCode === 'PL!N-pb1-004-P+'
    );
    const liveCardId = ownedP1CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardType === CardType.LIVE
    );
    const lowCostMemberCardIds = ownedP1CardIds.filter((cardId) => {
      const card = state.cardRegistry.get(cardId);
      return (
        !karinCardIds.includes(cardId) &&
        card?.data.cardType === CardType.MEMBER &&
        'cost' in card.data &&
        card.data.cost <= 9
      );
    });

    expect(karinCardIds.length).toBeGreaterThanOrEqual(2);
    expect(liveCardId).toBeTruthy();
    expect(lowCostMemberCardIds.length).toBeGreaterThanOrEqual(2);

    removeFromPlayerZones(p1);
    p1.memberSlots.slots[SlotPosition.LEFT] = karinCardIds[0];
    p1.memberSlots.slots[SlotPosition.CENTER] = karinCardIds[1];
    p1.memberSlots.cardStates = new Map([
      [karinCardIds[0], { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
      [karinCardIds[1], { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
    ]);
    p1.liveZone.cardIds = [liveCardId!];
    p1.liveZone.cardStates = new Map([
      [liveCardId!, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_DOWN }],
    ]);
    p1.mainDeck.cardIds = [lowCostMemberCardIds[0], lowCostMemberCardIds[1]];

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
    (session as unknown as { authorityState: GameState }).authorityState = advanceResult.gameState;

    expect(advanceResult.success).toBe(true);
    expect(session.state?.activeEffect?.abilityId).toBe(ABILITY_ORDER_SELECTION_ID);
    expect(session.state?.activeEffect?.selectableCardIds).toEqual(karinCardIds);
    expect(session.state?.activeEffect?.canResolveInOrder).toBe(true);
    expect(session.state?.pendingAbilities).toHaveLength(2);

    const orderResult = session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        session.state!.activeEffect!.id,
        undefined,
        null,
        true
      )
    );

    expect(orderResult.success).toBe(true);
    expect(session.state?.activeEffect?.abilityId).toBe(KARIN_LIVE_START_ABILITY_ID);
    expect(session.state?.activeEffect?.sourceCardId).toBe(karinCardIds[0]);
    expect(session.state?.activeEffect?.metadata?.orderedResolution).toBe(true);
    expect(session.state?.inspectionZone.cardIds).toEqual([lowCostMemberCardIds[0]]);
  });

  it('queues PL!-sd1-009-SD with other live-start effects for order selection', () => {
    const session = createGameSession();
    const deck = createDeck();

    session.createGame(
      'sample-live-start-nico-order-runner',
      PLAYER1,
      'Player 1',
      PLAYER2,
      'Player 2'
    );
    session.initializeGame(deck, deck);

    const state = session.state!;
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

    const ownedP1CardIds = [...state.cardRegistry.values()]
      .filter((card) => card.ownerId === PLAYER1)
      .map((card) => card.instanceId);
    const karinCardId = ownedP1CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardCode === 'PL!N-pb1-004-P+'
    );
    const nicoCardId = ownedP1CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardCode === 'PL!-sd1-009-SD'
    );
    const liveCardId = ownedP1CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardType === CardType.LIVE
    );
    const lowCostMemberCardId = ownedP1CardIds.find((cardId) => {
      const card = state.cardRegistry.get(cardId);
      return (
        cardId !== karinCardId &&
        cardId !== nicoCardId &&
        card?.data.cardType === CardType.MEMBER &&
        'cost' in card.data &&
        card.data.cost <= 9
      );
    });

    expect(karinCardId).toBeTruthy();
    expect(nicoCardId).toBeTruthy();
    expect(liveCardId).toBeTruthy();
    expect(lowCostMemberCardId).toBeTruthy();

    removeFromPlayerZones(p1);
    p1.memberSlots.slots[SlotPosition.LEFT] = karinCardId!;
    p1.memberSlots.slots[SlotPosition.CENTER] = nicoCardId!;
    p1.memberSlots.cardStates = new Map([
      [karinCardId!, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
      [nicoCardId!, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
    ]);
    p1.liveZone.cardIds = [liveCardId!];
    p1.liveZone.cardStates = new Map([
      [liveCardId!, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_DOWN }],
    ]);
    p1.mainDeck.cardIds = [lowCostMemberCardId!];

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
    (session as unknown as { authorityState: GameState }).authorityState = advanceResult.gameState;

    expect(advanceResult.success).toBe(true);
    expect(session.state?.activeEffect?.abilityId).toBe(ABILITY_ORDER_SELECTION_ID);
    expect(session.state?.activeEffect?.selectableCardIds).toEqual([karinCardId, nicoCardId]);
    expect(session.state?.pendingAbilities.map((ability) => ability.abilityId)).toEqual([
      KARIN_LIVE_START_ABILITY_ID,
      NICO_LIVE_START_SCORE_ABILITY_ID,
    ]);

    const chooseNicoResult = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id, nicoCardId)
    );
    expect(chooseNicoResult.success).toBe(true);
    expect(session.state?.activeEffect?.abilityId).toBe(NICO_LIVE_START_SCORE_ABILITY_ID);
    expect(session.state?.activeEffect?.sourceCardId).toBe(nicoCardId);
  });

  it('labels PL!-sd1-003-SD live-start discard choice as discarding hand to activate', () => {
    const session = createGameSession();
    const deck = createDeck();

    session.createGame(
      'sample-live-start-kotori-label-runner',
      PLAYER1,
      'Player 1',
      PLAYER2,
      'Player 2'
    );
    session.initializeGame(deck, deck);

    const state = session.state!;
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

    const ownedP1CardIds = [...state.cardRegistry.values()]
      .filter((card) => card.ownerId === PLAYER1)
      .map((card) => card.instanceId);
    const kotoriCardId = ownedP1CardIds.find((cardId) => {
      const card = state.cardRegistry.get(cardId);
      return card?.data.cardType === CardType.MEMBER && card.data.cardCode === 'PL!-sd1-003-SD';
    });
    const discardCardId = ownedP1CardIds.find((cardId) => {
      const card = state.cardRegistry.get(cardId);
      return cardId !== kotoriCardId && card?.data.cardType === CardType.MEMBER;
    });
    const liveCardId = ownedP1CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardType === CardType.LIVE
    );

    expect(kotoriCardId).toBeTruthy();
    expect(discardCardId).toBeTruthy();
    expect(liveCardId).toBeTruthy();

    removeFromPlayerZones(p1);
    p1.hand.cardIds = [discardCardId!];
    p1.memberSlots.slots[SlotPosition.CENTER] = kotoriCardId!;
    p1.memberSlots.cardStates = new Map([
      [kotoriCardId!, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
    ]);
    p1.liveZone.cardIds = [liveCardId!];
    p1.liveZone.cardStates = new Map([
      [liveCardId!, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_DOWN }],
    ]);

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
    (session as unknown as { authorityState: GameState }).authorityState = advanceResult.gameState;

    expect(advanceResult.success).toBe(true);
    expect(session.state?.activeEffect?.abilityId).toBe(KOTORI_LIVE_START_HEART_ABILITY_ID);
    expect(session.state?.activeEffect?.selectionLabel).toBe('请选择要放置入休息室的卡牌');
    expect(session.state?.activeEffect?.skipSelectionLabel).toBe('不发动');
    expect(session.state?.activeEffect?.metadata?.handToWaitingRoomCost).toEqual({
      minCount: 1,
      maxCount: 1,
      optional: true,
    });
    expect(session.state?.activeEffect?.metadata?.effectCosts).toEqual([
      {
        kind: 'DISCARD_HAND_TO_WAITING_ROOM',
        minCount: 1,
        maxCount: 1,
        optional: true,
      },
    ]);
    expect(session.state?.activeEffect?.selectableCardIds).toEqual([discardCardId]);

    const discardResult = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id, discardCardId)
    );

    expect(discardResult.success).toBe(true);
    expect(session.state?.activeEffect?.selectableOptions).toEqual([
      { id: HeartColor.PINK, label: '粉心' },
      { id: HeartColor.YELLOW, label: '黄心' },
      { id: HeartColor.PURPLE, label: '紫心' },
    ]);

    const heartResult = session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        session.state!.activeEffect!.id,
        undefined,
        undefined,
        undefined,
        HeartColor.YELLOW
      )
    );

    expect(heartResult.success).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.liveResolution.playerHeartBonuses.has(PLAYER1)).toBe(false);
    expect(session.state?.liveResolution.liveModifiers).toContainEqual({
      kind: 'HEART',
      target: 'SOURCE_MEMBER',
      playerId: PLAYER1,
      hearts: [{ color: HeartColor.YELLOW, count: 1 }],
      sourceCardId: kotoriCardId,
      abilityId: KOTORI_LIVE_START_HEART_ABILITY_ID,
    });
  });

  it('executes PL!HS-bp1-006-P live-start discard and grants selected Heart if another member exists', () => {
    const session = createGameSession();
    const deck = createDeck();

    session.createGame(
      'sample-live-start-hs-bp1-006-heart-runner',
      PLAYER1,
      'Player 1',
      PLAYER2,
      'Player 2'
    );
    session.initializeGame(deck, deck);

    const state = session.state!;
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

    const ownedP1CardIds = [...state.cardRegistry.values()]
      .filter((card) => card.ownerId === PLAYER1)
      .map((card) => card.instanceId);
    const megumiCardId = ownedP1CardIds.find((cardId) => {
      const card = state.cardRegistry.get(cardId);
      return card?.data.cardType === CardType.MEMBER && card.data.cardCode === 'PL!HS-bp1-006-P';
    });
    const otherMemberCardId = ownedP1CardIds.find((cardId) => {
      const card = state.cardRegistry.get(cardId);
      return cardId !== megumiCardId && card?.data.cardType === CardType.MEMBER;
    });
    const discardCardId = ownedP1CardIds.find((cardId) => {
      const card = state.cardRegistry.get(cardId);
      return (
        cardId !== megumiCardId &&
        cardId !== otherMemberCardId &&
        card?.data.cardType === CardType.MEMBER
      );
    });
    const liveCardId = ownedP1CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardType === CardType.LIVE
    );

    expect(megumiCardId).toBeTruthy();
    expect(otherMemberCardId).toBeTruthy();
    expect(discardCardId).toBeTruthy();
    expect(liveCardId).toBeTruthy();

    removeFromPlayerZones(p1);
    p1.hand.cardIds = [discardCardId!];
    p1.memberSlots.slots[SlotPosition.LEFT] = otherMemberCardId!;
    p1.memberSlots.slots[SlotPosition.CENTER] = megumiCardId!;
    p1.memberSlots.slots[SlotPosition.RIGHT] = null;
    p1.memberSlots.cardStates = new Map([
      [otherMemberCardId!, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
      [megumiCardId!, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
    ]);
    p1.liveZone.cardIds = [liveCardId!];
    p1.liveZone.cardStates = new Map([
      [liveCardId!, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_DOWN }],
    ]);

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
    (session as unknown as { authorityState: GameState }).authorityState = advanceResult.gameState;

    expect(advanceResult.success).toBe(true);
    expect(session.state?.activeEffect?.abilityId).toBe(
      HS_BP1_006_LIVE_START_DISCARD_GAIN_HEART_ABILITY_ID
    );
    expect(session.state?.activeEffect?.metadata?.requiresOtherStageMemberForHeart).toBe(true);

    const discardResult = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id, discardCardId)
    );

    expect(discardResult.success).toBe(true);
    expect(session.state?.activeEffect?.selectableOptions).toEqual([
      { id: HeartColor.PINK, label: '粉心' },
      { id: HeartColor.RED, label: '红心' },
      { id: HeartColor.YELLOW, label: '黄心' },
      { id: HeartColor.GREEN, label: '绿心' },
      { id: HeartColor.BLUE, label: '蓝心' },
      { id: HeartColor.PURPLE, label: '紫心' },
    ]);

    const heartResult = session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        session.state!.activeEffect!.id,
        undefined,
        undefined,
        undefined,
        HeartColor.BLUE
      )
    );

    expect(heartResult.success).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.liveResolution.liveModifiers).toContainEqual({
      kind: 'HEART',
      target: 'SOURCE_MEMBER',
      playerId: PLAYER1,
      hearts: [{ color: HeartColor.BLUE, count: 1 }],
      sourceCardId: megumiCardId,
      abilityId: HS_BP1_006_LIVE_START_DISCARD_GAIN_HEART_ABILITY_ID,
    });
  });

  it('does not grant Heart for PL!HS-bp1-006-P live-start discard when there is no other member', () => {
    const session = createGameSession();
    const deck = createDeck();

    session.createGame(
      'sample-live-start-hs-bp1-006-no-other-member-runner',
      PLAYER1,
      'Player 1',
      PLAYER2,
      'Player 2'
    );
    session.initializeGame(deck, deck);

    const state = session.state!;
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

    const ownedP1CardIds = [...state.cardRegistry.values()]
      .filter((card) => card.ownerId === PLAYER1)
      .map((card) => card.instanceId);
    const megumiCardId = ownedP1CardIds.find((cardId) => {
      const card = state.cardRegistry.get(cardId);
      return card?.data.cardType === CardType.MEMBER && card.data.cardCode === 'PL!HS-bp1-006-P';
    });
    const discardCardId = ownedP1CardIds.find((cardId) => {
      const card = state.cardRegistry.get(cardId);
      return cardId !== megumiCardId && card?.data.cardType === CardType.MEMBER;
    });
    const liveCardId = ownedP1CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardType === CardType.LIVE
    );

    expect(megumiCardId).toBeTruthy();
    expect(discardCardId).toBeTruthy();
    expect(liveCardId).toBeTruthy();

    removeFromPlayerZones(p1);
    p1.hand.cardIds = [discardCardId!];
    p1.memberSlots.slots[SlotPosition.LEFT] = null;
    p1.memberSlots.slots[SlotPosition.CENTER] = megumiCardId!;
    p1.memberSlots.slots[SlotPosition.RIGHT] = null;
    p1.memberSlots.cardStates = new Map([
      [megumiCardId!, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
    ]);
    p1.liveZone.cardIds = [liveCardId!];
    p1.liveZone.cardStates = new Map([
      [liveCardId!, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_DOWN }],
    ]);

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
    (session as unknown as { authorityState: GameState }).authorityState = advanceResult.gameState;

    expect(advanceResult.success).toBe(true);
    expect(session.state?.activeEffect?.abilityId).toBe(
      HS_BP1_006_LIVE_START_DISCARD_GAIN_HEART_ABILITY_ID
    );

    const discardResult = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id, discardCardId)
    );

    expect(discardResult.success).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([discardCardId]);
    expect(session.state?.liveResolution.liveModifiers).not.toContainEqual(
      expect.objectContaining({
        kind: 'HEART',
        abilityId: HS_BP1_006_LIVE_START_DISCARD_GAIN_HEART_ABILITY_ID,
      })
    );
  });

  it('executes PL!HS-bp1-004-P activated pay3 recovery of one Hasunosora Live once per turn', () => {
    const session = createGameSession();
    const deck = createDeck();

    session.createGame(
      'sample-hs-bp1-004-activated-recover-live-runner',
      PLAYER1,
      'Player 1',
      PLAYER2,
      'Player 2'
    );
    session.initializeGame(deck, deck);
    forceMainPhaseForPlayer(session);

    const state = session.state!;
    const p1 = state.players[0] as unknown as {
      hand: { cardIds: string[] };
      mainDeck: { cardIds: string[] };
      waitingRoom: { cardIds: string[] };
      successZone: { cardIds: string[] };
      liveZone: { cardIds: string[] };
      energyZone: {
        cardIds: string[];
        cardStates: Map<string, { orientation: OrientationState; face: FaceState }>;
      };
      memberSlots: {
        slots: Record<SlotPosition, string | null>;
        cardStates: Map<string, { orientation: OrientationState; face: FaceState }>;
      };
    };

    const ownedP1CardIds = [...state.cardRegistry.values()]
      .filter((card) => card.ownerId === PLAYER1)
      .map((card) => card.instanceId);
    const tsuzuriCardId = ownedP1CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardType === CardType.MEMBER
    );
    const targetLiveCardId = ownedP1CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardType === CardType.LIVE
    );
    const otherLiveCardId = ownedP1CardIds.find(
      (cardId) =>
        cardId !== targetLiveCardId &&
        state.cardRegistry.get(cardId)?.data.cardType === CardType.LIVE
    );
    const energyCardIds = ownedP1CardIds.filter(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardType === CardType.ENERGY
    );

    expect(tsuzuriCardId).toBeTruthy();
    expect(targetLiveCardId).toBeTruthy();
    expect(otherLiveCardId).toBeTruthy();
    expect(energyCardIds.length).toBeGreaterThanOrEqual(6);

    const tsuzuriCard = state.cardRegistry.get(tsuzuriCardId!) as unknown as {
      data: MemberCardData;
    };
    const targetLiveCard = state.cardRegistry.get(targetLiveCardId!) as unknown as {
      data: LiveCardData;
    };
    const otherLiveCard = state.cardRegistry.get(otherLiveCardId!) as unknown as {
      data: LiveCardData;
    };
    tsuzuriCard.data = createMemberCard('PL!HS-bp1-004-P', '夕雾缀理', 15, '莲之空');
    targetLiveCard.data = createLiveCard('HASU-LIVE', '莲之空 LIVE', '莲之空');
    otherLiveCard.data = createLiveCard('OTHER-LIVE', '其他 LIVE', "μ's");

    removeFromPlayerZones(p1);
    p1.hand.cardIds = [];
    p1.waitingRoom.cardIds = [otherLiveCardId!];
    setActiveEnergy(p1, energyCardIds.slice(0, 6));
    p1.memberSlots.slots[SlotPosition.CENTER] = tsuzuriCardId!;
    p1.memberSlots.cardStates = new Map([
      [tsuzuriCardId!, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
    ]);

    const noTargetActivateResult = session.executeCommand(
      createActivateAbilityCommand(
        PLAYER1,
        tsuzuriCardId!,
        HS_BP1_004_ACTIVATED_RECOVER_HASUNOSORA_LIVE_ABILITY_ID
      )
    );

    expect(noTargetActivateResult.success).toBe(false);
    expect(session.state?.activeEffect).toBeNull();
    expect(
      session.state?.players[0].energyZone.cardStates.get(energyCardIds[0]!)?.orientation
    ).toBe(OrientationState.ACTIVE);

    p1.waitingRoom.cardIds = [otherLiveCardId!, targetLiveCardId!];
    const activateResult = session.executeCommand(
      createActivateAbilityCommand(
        PLAYER1,
        tsuzuriCardId!,
        HS_BP1_004_ACTIVATED_RECOVER_HASUNOSORA_LIVE_ABILITY_ID
      )
    );

    expect(activateResult.success).toBe(true);
    expect(session.state?.activeEffect?.abilityId).toBe(
      HS_BP1_004_ACTIVATED_RECOVER_HASUNOSORA_LIVE_ABILITY_ID
    );
    expect(session.state?.activeEffect?.selectableCardIds).toEqual([targetLiveCardId]);
    expect(session.state?.activeEffect?.metadata?.zoneSelection).toEqual({
      source: 'WAITING_ROOM',
      destination: 'HAND',
      minCount: 0,
      maxCount: 1,
      optional: true,
    });
    for (const energyCardId of energyCardIds.slice(0, 3)) {
      expect(session.state?.players[0].energyZone.cardStates.get(energyCardId)?.orientation).toBe(
        OrientationState.WAITING
      );
    }

    const recoverResult = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id, targetLiveCardId)
    );

    expect(recoverResult.success).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].hand.cardIds).toEqual([targetLiveCardId]);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([otherLiveCardId]);

    const secondActivateResult = session.executeCommand(
      createActivateAbilityCommand(
        PLAYER1,
        tsuzuriCardId!,
        HS_BP1_004_ACTIVATED_RECOVER_HASUNOSORA_LIVE_ABILITY_ID
      )
    );

    expect(secondActivateResult.success).toBe(false);
    expect(secondActivateResult.error).toContain('本回合已发动 1/1 次');
  });

  it('executes PL!HS-bp1-004-P live-start pay1 and gains Blade by Live zone count', () => {
    const session = createGameSession();
    const deck = createDeck();

    session.createGame(
      'sample-hs-bp1-004-live-start-blade-runner',
      PLAYER1,
      'Player 1',
      PLAYER2,
      'Player 2'
    );
    session.initializeGame(deck, deck);

    const state = session.state!;
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

    const ownedP1CardIds = [...state.cardRegistry.values()]
      .filter((card) => card.ownerId === PLAYER1)
      .map((card) => card.instanceId);
    const tsuzuriCardId = ownedP1CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardType === CardType.MEMBER
    );
    const liveCardIds = ownedP1CardIds
      .filter((cardId) => state.cardRegistry.get(cardId)?.data.cardType === CardType.LIVE)
      .slice(0, 2);
    const energyCardIds = ownedP1CardIds.filter(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardType === CardType.ENERGY
    );

    expect(tsuzuriCardId).toBeTruthy();
    expect(liveCardIds.length).toBe(2);
    expect(energyCardIds.length).toBeGreaterThanOrEqual(1);

    const tsuzuriCard = state.cardRegistry.get(tsuzuriCardId!) as unknown as {
      data: MemberCardData;
    };
    tsuzuriCard.data = createMemberCard('PL!HS-bp1-004-P', '夕雾缀理', 15, '莲之空');

    removeFromPlayerZones(p1);
    p1.hand.cardIds = [];
    p1.memberSlots.slots[SlotPosition.CENTER] = tsuzuriCardId!;
    p1.memberSlots.cardStates = new Map([
      [tsuzuriCardId!, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
    ]);
    p1.liveZone.cardIds = liveCardIds;
    p1.liveZone.cardStates = new Map(
      liveCardIds.map((cardId) => [
        cardId,
        { orientation: OrientationState.ACTIVE, face: FaceState.FACE_DOWN },
      ])
    );
    setActiveEnergy(p1, energyCardIds.slice(0, 1));

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
    (session as unknown as { authorityState: GameState }).authorityState = advanceResult.gameState;

    expect(advanceResult.success).toBe(true);
    expect(session.state?.activeEffect?.abilityId).toBe(
      HS_BP1_004_LIVE_START_PAY_ENERGY_GAIN_BLADE_ABILITY_ID
    );
    expect(session.state?.activeEffect?.selectableOptions).toEqual([
      { id: 'pay', label: '支付1能量' },
      { id: 'decline', label: '不发动' },
    ]);

    const payResult = session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        session.state!.activeEffect!.id,
        undefined,
        undefined,
        undefined,
        'pay'
      )
    );

    expect(payResult.success).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(
      session.state?.players[0].energyZone.cardStates.get(energyCardIds[0]!)?.orientation
    ).toBe(OrientationState.WAITING);
    expect(session.state?.liveResolution.liveModifiers).toContainEqual({
      kind: 'BLADE',
      playerId: PLAYER1,
      countDelta: 2,
      sourceCardId: tsuzuriCardId,
      abilityId: HS_BP1_004_LIVE_START_PAY_ENERGY_GAIN_BLADE_ABILITY_ID,
    });
  });

  it('executes PL!HS-sd1-006-SD on-enter by activating energy and recovering a Hasunosora Live when a related member is on stage', () => {
    const session = createGameSession();
    const deck = createDeck();

    session.createGame(
      'sample-hs-sd1-006-on-enter-runner',
      PLAYER1,
      'Player 1',
      PLAYER2,
      'Player 2'
    );
    session.initializeGame(deck, deck);
    forceMainPhaseForPlayer(session);

    const state = session.state!;
    const p1 = state.players[0] as unknown as {
      hand: { cardIds: string[] };
      mainDeck: { cardIds: string[] };
      waitingRoom: { cardIds: string[] };
      successZone: { cardIds: string[] };
      liveZone: { cardIds: string[] };
      energyZone: {
        cardIds: string[];
        cardStates: Map<string, { orientation: OrientationState; face: FaceState }>;
      };
      memberSlots: {
        slots: Record<SlotPosition, string | null>;
        cardStates: Map<string, { orientation: OrientationState; face: FaceState }>;
      };
    };
    const ownedP1CardIds = [...state.cardRegistry.values()]
      .filter((card) => card.ownerId === PLAYER1)
      .map((card) => card.instanceId);
    const memberCardIds = ownedP1CardIds.filter(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardType === CardType.MEMBER
    );
    const liveCardIds = ownedP1CardIds.filter(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardType === CardType.LIVE
    );
    const energyCardIds = ownedP1CardIds.filter(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardType === CardType.ENERGY
    );
    const himeCardId = memberCardIds[0];
    const rurinoCardId = memberCardIds[1];
    const deckFillerCardId = memberCardIds[2];
    const targetLiveCardId = liveCardIds[0];
    const otherLiveCardId = liveCardIds[1];
    const himeCard = state.cardRegistry.get(himeCardId!) as unknown as { data: MemberCardData };
    const rurinoCard = state.cardRegistry.get(rurinoCardId!) as unknown as { data: MemberCardData };
    const targetLiveCard = state.cardRegistry.get(targetLiveCardId!) as unknown as {
      data: LiveCardData;
    };
    const otherLiveCard = state.cardRegistry.get(otherLiveCardId!) as unknown as {
      data: LiveCardData;
    };

    expect(himeCardId).toBeTruthy();
    expect(rurinoCardId).toBeTruthy();
    expect(deckFillerCardId).toBeTruthy();
    expect(targetLiveCardId).toBeTruthy();
    expect(otherLiveCardId).toBeTruthy();
    himeCard.data = createMemberCard('PL!HS-sd1-006-SD', '安養寺 姫芽', 15, '蓮ノ空');
    rurinoCard.data = createMemberCard('PL!HS-test-rurino', '大泽 瑠璃乃', 1, '蓮ノ空');
    targetLiveCard.data = createLiveCard('PL!HS-test-live', '蓮ノ空 LIVE', '蓮ノ空');
    otherLiveCard.data = createLiveCard('PL!N-test-live', '虹咲 LIVE', '虹咲');

    expect(energyCardIds.length).toBeGreaterThanOrEqual(15);

    removeFromPlayerZones(p1);
    p1.hand.cardIds = [himeCardId!];
    p1.mainDeck.cardIds = [deckFillerCardId!];
    p1.waitingRoom.cardIds = [targetLiveCardId!, otherLiveCardId!];
    p1.memberSlots.slots[SlotPosition.LEFT] = rurinoCardId!;
    p1.memberSlots.slots[SlotPosition.CENTER] = null;
    p1.memberSlots.slots[SlotPosition.RIGHT] = null;
    p1.memberSlots.cardStates = new Map([
      [rurinoCardId!, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
    ]);
    setActiveEnergy(p1, energyCardIds.slice(0, 15));

    const playResult = session.executeCommand(
      createPlayMemberToSlotCommand(PLAYER1, himeCardId!, SlotPosition.CENTER)
    );

    expect(playResult.success).toBe(true);
    expect(session.state?.activeEffect?.abilityId).toBe(
      HS_SD1_006_ON_ENTER_ACTIVATE_ENERGY_RECOVER_LIVE_ABILITY_ID
    );
    expect(session.state?.activeEffect?.selectableCardIds).toEqual([targetLiveCardId]);
    expect(session.state?.players[0].energyZone.cardStates.get(energyCardIds[0])?.orientation).toBe(
      OrientationState.ACTIVE
    );
    expect(
      session.state?.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId ===
            HS_SD1_006_ON_ENTER_ACTIVATE_ENERGY_RECOVER_LIVE_ABILITY_ID &&
          action.payload.step === 'ACTIVATE_ENERGY' &&
          Array.isArray(action.payload.activatedEnergyCardIds) &&
          action.payload.activatedEnergyCardIds[0] === energyCardIds[0] &&
          Array.isArray(action.payload.previousOrientations) &&
          action.payload.previousOrientations[0]?.cardId === energyCardIds[0] &&
          action.payload.previousOrientations[0]?.orientation === OrientationState.WAITING &&
          action.payload.nextOrientation === OrientationState.ACTIVE
      )
    ).toBe(true);

    const confirmResult = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id, targetLiveCardId)
    );

    expect(confirmResult.success).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].hand.cardIds).toEqual([targetLiveCardId]);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([otherLiveCardId]);
  });

  it('continues PL!HS-sd1-006-SD on-enter recovery when there is no waiting energy to activate', () => {
    const session = createGameSession();
    const deck = createDeck();

    session.createGame(
      'sample-hs-sd1-006-on-enter-no-waiting-energy-runner',
      PLAYER1,
      'Player 1',
      PLAYER2,
      'Player 2'
    );
    session.initializeGame(deck, deck);
    forceMainPhaseForPlayer(session);

    const state = session.state!;
    const p1 = state.players[0] as unknown as {
      hand: { cardIds: string[] };
      mainDeck: { cardIds: string[] };
      waitingRoom: { cardIds: string[] };
      successZone: { cardIds: string[] };
      liveZone: { cardIds: string[] };
      energyZone: {
        cardIds: string[];
        cardStates: Map<string, { orientation: OrientationState; face: FaceState }>;
      };
      memberSlots: {
        slots: Record<SlotPosition, string | null>;
        cardStates: Map<string, { orientation: OrientationState; face: FaceState }>;
      };
    };
    const ownedP1CardIds = [...state.cardRegistry.values()]
      .filter((card) => card.ownerId === PLAYER1)
      .map((card) => card.instanceId);
    const memberCardIds = ownedP1CardIds.filter(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardType === CardType.MEMBER
    );
    const liveCardIds = ownedP1CardIds.filter(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardType === CardType.LIVE
    );
    const energyCardIds = ownedP1CardIds.filter(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardType === CardType.ENERGY
    );
    const himeCardId = memberCardIds[0];
    const rurinoCardId = memberCardIds[1];
    const deckFillerCardId = memberCardIds[2];
    const targetLiveCardId = liveCardIds[0];
    const himeCard = state.cardRegistry.get(himeCardId!) as unknown as { data: MemberCardData };
    const rurinoCard = state.cardRegistry.get(rurinoCardId!) as unknown as { data: MemberCardData };
    const targetLiveCard = state.cardRegistry.get(targetLiveCardId!) as unknown as {
      data: LiveCardData;
    };

    expect(himeCardId).toBeTruthy();
    expect(rurinoCardId).toBeTruthy();
    expect(deckFillerCardId).toBeTruthy();
    expect(targetLiveCardId).toBeTruthy();
    himeCard.data = createMemberCard('PL!HS-sd1-006-SD', '安養寺 姫芽', 0, '蓮ノ空');
    rurinoCard.data = createMemberCard('PL!HS-test-rurino-no-waiting', '大泽 瑠璃乃', 1, '蓮ノ空');
    targetLiveCard.data = createLiveCard('PL!HS-test-live-no-waiting', '蓮ノ空 LIVE', '蓮ノ空');

    expect(energyCardIds.length).toBeGreaterThanOrEqual(2);

    removeFromPlayerZones(p1);
    p1.hand.cardIds = [himeCardId!];
    p1.mainDeck.cardIds = [deckFillerCardId!];
    p1.waitingRoom.cardIds = [targetLiveCardId!];
    p1.memberSlots.slots[SlotPosition.LEFT] = rurinoCardId!;
    p1.memberSlots.slots[SlotPosition.CENTER] = null;
    p1.memberSlots.slots[SlotPosition.RIGHT] = null;
    p1.memberSlots.cardStates = new Map([
      [rurinoCardId!, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
    ]);
    setActiveEnergy(p1, energyCardIds.slice(0, 2));

    const playResult = session.executeCommand(
      createPlayMemberToSlotCommand(PLAYER1, himeCardId!, SlotPosition.CENTER)
    );

    expect(playResult.success).toBe(true);
    expect(session.state?.activeEffect?.abilityId).toBe(
      HS_SD1_006_ON_ENTER_ACTIVATE_ENERGY_RECOVER_LIVE_ABILITY_ID
    );
    expect(session.state?.activeEffect?.selectableCardIds).toEqual([targetLiveCardId]);
    expect(
      session.state?.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId ===
            HS_SD1_006_ON_ENTER_ACTIVATE_ENERGY_RECOVER_LIVE_ABILITY_ID &&
          action.payload.step === 'ACTIVATE_ENERGY' &&
          Array.isArray(action.payload.activatedEnergyCardIds) &&
          action.payload.activatedEnergyCardIds.length === 0 &&
          Array.isArray(action.payload.previousOrientations) &&
          action.payload.previousOrientations.length === 0 &&
          action.payload.nextOrientation === OrientationState.ACTIVE
      )
    ).toBe(true);

    const confirmResult = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id, targetLiveCardId)
    );

    expect(confirmResult.success).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].hand.cardIds).toEqual([targetLiveCardId]);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([]);
  });

  it('executes PL!HS-sd1-006-SD live-start pay1 and gains two Blade', () => {
    const session = createGameSession();
    const deck = createDeck();

    session.createGame(
      'sample-hs-sd1-006-live-start-blade-runner',
      PLAYER1,
      'Player 1',
      PLAYER2,
      'Player 2'
    );
    session.initializeGame(deck, deck);

    let state = session.state!;
    const p1 = state.players[0] as unknown as {
      hand: { cardIds: string[] };
      mainDeck: { cardIds: string[] };
      waitingRoom: { cardIds: string[] };
      successZone: { cardIds: string[] };
      liveZone: { cardIds: string[] };
      energyZone: {
        cardIds: string[];
        cardStates: Map<string, { orientation: OrientationState; face: FaceState }>;
      };
      memberSlots: {
        slots: Record<SlotPosition, string | null>;
        cardStates: Map<string, { orientation: OrientationState; face: FaceState }>;
      };
    };
    const ownedP1CardIds = [...state.cardRegistry.values()]
      .filter((card) => card.ownerId === PLAYER1)
      .map((card) => card.instanceId);
    const himeCardId = ownedP1CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardType === CardType.MEMBER
    );
    const liveCardId = ownedP1CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardType === CardType.LIVE
    );
    const energyCardIds = ownedP1CardIds.filter(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardType === CardType.ENERGY
    );
    const himeCard = state.cardRegistry.get(himeCardId!) as unknown as { data: MemberCardData };

    expect(himeCardId).toBeTruthy();
    expect(liveCardId).toBeTruthy();
    expect(energyCardIds.length).toBeGreaterThanOrEqual(1);
    himeCard.data = createMemberCard('PL!HS-sd1-006-SD', '安養寺 姫芽', 15, '蓮ノ空');

    removeFromPlayerZones(p1);
    p1.memberSlots.slots[SlotPosition.CENTER] = himeCardId!;
    p1.memberSlots.cardStates = new Map([
      [himeCardId!, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
    ]);
    p1.liveZone.cardIds = [liveCardId!];
    setActiveEnergy(p1, energyCardIds.slice(0, 1));
    state = {
      ...state,
      currentPhase: GamePhase.LIVE_SET_PHASE,
      currentSubPhase: SubPhase.LIVE_SET_SECOND_DRAW,
      currentTurnType: TurnType.LIVE_PHASE,
      activePlayerIndex: 0,
      firstPlayerIndex: 0,
      liveSetCompletedPlayers: [PLAYER1, PLAYER2],
    };

    const service = new GameService();
    const advanceResult = service.advancePhase(state);
    (session as unknown as { authorityState: GameState }).authorityState = advanceResult.gameState;

    expect(advanceResult.success).toBe(true);
    expect(session.state?.activeEffect?.abilityId).toBe(
      HS_SD1_006_LIVE_START_PAY_ENERGY_GAIN_BLADE_ABILITY_ID
    );

    const payResult = session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        session.state!.activeEffect!.id,
        undefined,
        undefined,
        undefined,
        'pay'
      )
    );

    expect(payResult.success).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].energyZone.cardStates.get(energyCardIds[0])?.orientation).toBe(
      OrientationState.WAITING
    );
    expect(session.state?.liveResolution.liveModifiers).toContainEqual({
      kind: 'BLADE',
      playerId: PLAYER1,
      countDelta: 2,
      sourceCardId: himeCardId,
      abilityId: HS_SD1_006_LIVE_START_PAY_ENERGY_GAIN_BLADE_ABILITY_ID,
    });
  });

  it('executes PL!-bp4-010-N live-start pay1 and gains two Blade', () => {
    const session = createGameSession();
    const deck = createDeck();

    session.createGame(
      'sample-bp4-010-live-start-blade-runner',
      PLAYER1,
      'Player 1',
      PLAYER2,
      'Player 2'
    );
    session.initializeGame(deck, deck);

    let state = session.state!;
    const p1 = state.players[0] as unknown as {
      hand: { cardIds: string[] };
      mainDeck: { cardIds: string[] };
      waitingRoom: { cardIds: string[] };
      successZone: { cardIds: string[] };
      liveZone: { cardIds: string[] };
      energyZone: {
        cardIds: string[];
        cardStates: Map<string, { orientation: OrientationState; face: FaceState }>;
      };
      memberSlots: {
        slots: Record<SlotPosition, string | null>;
        cardStates: Map<string, { orientation: OrientationState; face: FaceState }>;
      };
    };
    const ownedP1CardIds = [...state.cardRegistry.values()]
      .filter((card) => card.ownerId === PLAYER1)
      .map((card) => card.instanceId);
    const honokaCardId = ownedP1CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardType === CardType.MEMBER
    );
    const liveCardId = ownedP1CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardType === CardType.LIVE
    );
    const energyCardIds = ownedP1CardIds.filter(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardType === CardType.ENERGY
    );
    const honokaCard = state.cardRegistry.get(honokaCardId!) as unknown as { data: MemberCardData };

    expect(honokaCardId).toBeTruthy();
    expect(liveCardId).toBeTruthy();
    expect(energyCardIds.length).toBeGreaterThanOrEqual(1);
    honokaCard.data = createMemberCard('PL!-bp4-010-N', '高坂穗乃果', 15, "μ's");

    removeFromPlayerZones(p1);
    p1.memberSlots.slots[SlotPosition.CENTER] = honokaCardId!;
    p1.memberSlots.cardStates = new Map([
      [honokaCardId!, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
    ]);
    p1.liveZone.cardIds = [liveCardId!];
    setActiveEnergy(p1, energyCardIds.slice(0, 1));
    state = {
      ...state,
      currentPhase: GamePhase.LIVE_SET_PHASE,
      currentSubPhase: SubPhase.LIVE_SET_SECOND_DRAW,
      currentTurnType: TurnType.LIVE_PHASE,
      activePlayerIndex: 0,
      firstPlayerIndex: 0,
      liveSetCompletedPlayers: [PLAYER1, PLAYER2],
    };

    const service = new GameService();
    const advanceResult = service.advancePhase(state);
    (session as unknown as { authorityState: GameState }).authorityState = advanceResult.gameState;

    expect(advanceResult.success).toBe(true);
    expect(session.state?.activeEffect?.abilityId).toBe(
      BP4_010_LIVE_START_PAY_ENERGY_GAIN_BLADE_ABILITY_ID
    );

    const payResult = session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        session.state!.activeEffect!.id,
        undefined,
        undefined,
        undefined,
        'pay'
      )
    );

    expect(payResult.success).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].energyZone.cardStates.get(energyCardIds[0])?.orientation).toBe(
      OrientationState.WAITING
    );
    expect(session.state?.liveResolution.liveModifiers).toContainEqual({
      kind: 'BLADE',
      playerId: PLAYER1,
      countDelta: 2,
      sourceCardId: honokaCardId,
      abilityId: BP4_010_LIVE_START_PAY_ENERGY_GAIN_BLADE_ABILITY_ID,
    });
  });

  it('lets PL!-bp4-010-N live-start pay-energy Blade effect be declined without paying', () => {
    const { session, sourceCardId, energyCardIds } =
      setupFixedPayEnergyGainBladeLiveStartScenario({
        gameId: 'sample-bp4-010-live-start-blade-decline',
        cardCode: 'PL!-bp4-010-N',
        cardName: '高坂穗乃果',
        groupName: "μ's",
        activeEnergyCount: 1,
      });

    expect(session.state?.activeEffect?.abilityId).toBe(
      BP4_010_LIVE_START_PAY_ENERGY_GAIN_BLADE_ABILITY_ID
    );
    expect(session.state?.activeEffect?.selectableOptions).toEqual([
      { id: 'pay', label: '支付1能量' },
      { id: 'decline', label: '不发动' },
    ]);

    const declineResult = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id)
    );

    expect(declineResult.success).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].energyZone.cardStates.get(energyCardIds[0])?.orientation).toBe(
      OrientationState.ACTIVE
    );
    expect(
      session.state?.liveResolution.liveModifiers.some(
        (modifier) =>
          modifier.kind === 'BLADE' &&
          modifier.sourceCardId === sourceCardId &&
          modifier.abilityId === BP4_010_LIVE_START_PAY_ENERGY_GAIN_BLADE_ABILITY_ID
      )
    ).toBe(false);
    expect(
      session.state?.actionHistory.some(
        (action) =>
          action.type === 'PAY_COST' &&
          action.payload.abilityId === BP4_010_LIVE_START_PAY_ENERGY_GAIN_BLADE_ABILITY_ID
      )
    ).toBe(false);
    expect(
      session.state?.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId === BP4_010_LIVE_START_PAY_ENERGY_GAIN_BLADE_ABILITY_ID &&
          action.payload.step === 'SKIP'
      )
    ).toBe(true);
  });

  it('limits PL!HS-PR-001-PR live-start pay2 Blade effect to decline when active energy is insufficient', () => {
    const { session, sourceCardId, energyCardIds } =
      setupFixedPayEnergyGainBladeLiveStartScenario({
        gameId: 'sample-hs-pr-001-live-start-blade-insufficient-energy',
        cardCode: 'PL!HS-PR-001-PR',
        cardName: '日野下 花帆',
        groupName: "μ's",
        activeEnergyCount: 1,
      });

    expect(session.state?.activeEffect?.abilityId).toBe(
      HS_PR_001_LIVE_START_PAY_TWO_ENERGY_GAIN_BLADE_ABILITY_ID
    );
    expect(session.state?.activeEffect?.selectableOptions).toEqual([
      { id: 'decline', label: '不发动' },
    ]);

    const skipResult = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id)
    );

    expect(skipResult.success).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].energyZone.cardStates.get(energyCardIds[0])?.orientation).toBe(
      OrientationState.ACTIVE
    );
    expect(
      session.state?.liveResolution.liveModifiers.some(
        (modifier) =>
          modifier.kind === 'BLADE' &&
          modifier.sourceCardId === sourceCardId &&
          modifier.abilityId === HS_PR_001_LIVE_START_PAY_TWO_ENERGY_GAIN_BLADE_ABILITY_ID
      )
    ).toBe(false);
    expect(
      session.state?.actionHistory.some(
        (action) =>
          action.type === 'PAY_COST' &&
          action.payload.abilityId ===
            HS_PR_001_LIVE_START_PAY_TWO_ENERGY_GAIN_BLADE_ABILITY_ID
      )
    ).toBe(false);
  });

  it('executes PL!HS-PR-018-RM live-start pay1 and gains two Blade', () => {
    const session = createGameSession();
    const deck = createDeck();

    session.createGame(
      'sample-hs-pr-018-rm-live-start-blade-runner',
      PLAYER1,
      'Player 1',
      PLAYER2,
      'Player 2'
    );
    session.initializeGame(deck, deck);

    let state = session.state!;
    const p1 = state.players[0] as unknown as {
      hand: { cardIds: string[] };
      mainDeck: { cardIds: string[] };
      waitingRoom: { cardIds: string[] };
      successZone: { cardIds: string[] };
      liveZone: { cardIds: string[] };
      energyZone: {
        cardIds: string[];
        cardStates: Map<string, { orientation: OrientationState; face: FaceState }>;
      };
      memberSlots: {
        slots: Record<SlotPosition, string | null>;
        cardStates: Map<string, { orientation: OrientationState; face: FaceState }>;
      };
    };
    const ownedP1CardIds = [...state.cardRegistry.values()]
      .filter((card) => card.ownerId === PLAYER1)
      .map((card) => card.instanceId);
    const harunoCardId = ownedP1CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardType === CardType.MEMBER
    );
    const liveCardId = ownedP1CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardType === CardType.LIVE
    );
    const energyCardIds = ownedP1CardIds.filter(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardType === CardType.ENERGY
    );
    const harunoCard = state.cardRegistry.get(harunoCardId!) as unknown as { data: MemberCardData };

    expect(harunoCardId).toBeTruthy();
    expect(liveCardId).toBeTruthy();
    expect(energyCardIds.length).toBeGreaterThanOrEqual(1);
    harunoCard.data = createMemberCard('PL!HS-PR-018-RM', '大泽瑠璃乃', 4, "μ's");

    removeFromPlayerZones(p1);
    p1.memberSlots.slots[SlotPosition.CENTER] = harunoCardId!;
    p1.memberSlots.cardStates = new Map([
      [harunoCardId!, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
    ]);
    p1.liveZone.cardIds = [liveCardId!];
    setActiveEnergy(p1, energyCardIds.slice(0, 1));
    state = {
      ...state,
      currentPhase: GamePhase.LIVE_SET_PHASE,
      currentSubPhase: SubPhase.LIVE_SET_SECOND_DRAW,
      currentTurnType: TurnType.LIVE_PHASE,
      activePlayerIndex: 0,
      firstPlayerIndex: 0,
      liveSetCompletedPlayers: [PLAYER1, PLAYER2],
    };

    const service = new GameService();
    const advanceResult = service.advancePhase(state);
    (session as unknown as { authorityState: GameState }).authorityState = advanceResult.gameState;

    expect(advanceResult.success).toBe(true);
    expect(session.state?.activeEffect?.abilityId).toBe(
      BP4_010_LIVE_START_PAY_ENERGY_GAIN_BLADE_ABILITY_ID
    );

    const payResult = session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        session.state!.activeEffect!.id,
        undefined,
        undefined,
        undefined,
        'pay'
      )
    );

    expect(payResult.success).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].energyZone.cardStates.get(energyCardIds[0])?.orientation).toBe(
      OrientationState.WAITING
    );
    expect(session.state?.liveResolution.liveModifiers).toContainEqual({
      kind: 'BLADE',
      playerId: PLAYER1,
      countDelta: 2,
      sourceCardId: harunoCardId,
      abilityId: BP4_010_LIVE_START_PAY_ENERGY_GAIN_BLADE_ABILITY_ID,
    });
  });

  it('queues PL!-sd1-022-SD from the Live zone and records its requirement reduction', () => {
    const session = createGameSession();
    const deck = createDeck();

    session.createGame(
      'sample-live-start-bokuima-runner',
      PLAYER1,
      'Player 1',
      PLAYER2,
      'Player 2'
    );
    session.initializeGame(deck, deck);

    const state = session.state!;
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

    const ownedP1CardIds = [...state.cardRegistry.values()]
      .filter((card) => card.ownerId === PLAYER1)
      .map((card) => card.instanceId);
    const liveCardIds = ownedP1CardIds.filter(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardType === CardType.LIVE
    );
    const liveCardId = liveCardIds[0];
    expect(liveCardId).toBeTruthy();
    expect(liveCardIds.length).toBeGreaterThanOrEqual(4);

    const liveCard = state.cardRegistry.get(liveCardId!) as unknown as { data: LiveCardData };
    liveCard.data = {
      ...liveCard.data,
      cardCode: 'PL!-sd1-022-SD',
      name: '如今的我们',
      requirements: createHeartRequirement({
        [HeartColor.PINK]: 1,
        [HeartColor.RAINBOW]: 6,
      }),
    };

    removeFromPlayerZones(p1);
    p1.successZone.cardIds = liveCardIds.slice(1, 3);
    p1.liveZone.cardIds = [liveCardId!];
    p1.liveZone.cardStates = new Map([
      [liveCardId!, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_DOWN }],
    ]);

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
    (session as unknown as { authorityState: GameState }).authorityState = advanceResult.gameState;

    expect(advanceResult.success).toBe(true);
    expect(session.state?.activeEffect?.abilityId).toBe(BOKUIMA_LIVE_START_REQUIREMENT_ABILITY_ID);
    expect(session.state?.activeEffect?.sourceCardId).toBe(liveCardId);
    expect(session.state?.activeEffect?.effectText).toContain('当前成功LIVE 2张');
    expect(
      session.state?.liveResolution.liveRequirementReductions.get(liveCardId!)
    ).toBeUndefined();

    const confirmResult = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id)
    );

    expect(confirmResult.success).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.liveResolution.liveRequirementReductions.get(liveCardId!)).toBe(4);
    expect(session.state?.liveResolution.liveRequirementModifiers.get(liveCardId!)).toEqual([
      { color: HeartColor.RAINBOW, countDelta: -4 },
    ]);
    expect(session.state?.liveResolution.liveModifiers).toContainEqual({
      kind: 'REQUIREMENT',
      liveCardId,
      modifiers: [{ color: HeartColor.RAINBOW, countDelta: -4 }],
      sourceCardId: liveCardId,
      abilityId: BOKUIMA_LIVE_START_REQUIREMENT_ABILITY_ID,
    });
  });

  it('queues PL!-bp4-021-L and reduces requirement when successful Live score is at least six', () => {
    const { session, advanceResult, heartbeatLiveCardId } = setupHeartbeatLiveStartScenario([3, 3]);

    expect(advanceResult.success).toBe(true);
    expect(session.state?.activeEffect?.abilityId).toBe(
      BP4_021_LIVE_START_SUCCESS_SCORE_REQUIREMENT_AND_SCORE_ABILITY_ID
    );
    expect(session.state?.activeEffect?.sourceCardId).toBe(heartbeatLiveCardId);
    expect(session.state?.activeEffect?.effectText).toContain('当前成功LIVE分数合计 6');
    expect(
      session.state?.liveResolution.liveRequirementReductions.get(heartbeatLiveCardId)
    ).toBeUndefined();

    const confirmResult = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id)
    );

    expect(confirmResult.success).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.liveResolution.liveRequirementReductions.get(heartbeatLiveCardId)).toBe(
      1
    );
    expect(session.state?.liveResolution.liveRequirementModifiers.get(heartbeatLiveCardId)).toEqual([
      { color: HeartColor.RAINBOW, countDelta: -1 },
    ]);
    expect(session.state?.liveResolution.liveModifiers).toContainEqual({
      kind: 'REQUIREMENT',
      liveCardId: heartbeatLiveCardId,
      modifiers: [{ color: HeartColor.RAINBOW, countDelta: -1 }],
      sourceCardId: heartbeatLiveCardId,
      abilityId: BP4_021_LIVE_START_SUCCESS_SCORE_REQUIREMENT_AND_SCORE_ABILITY_ID,
    });
    expect(
      session.state?.liveResolution.liveModifiers.some(
        (modifier) =>
          modifier.kind === 'SCORE' &&
          modifier.abilityId === BP4_021_LIVE_START_SUCCESS_SCORE_REQUIREMENT_AND_SCORE_ABILITY_ID
      )
    ).toBe(false);
  });

  it('queues PL!-bp4-021-L and also gives score when successful Live score is at least nine', () => {
    const { session, advanceResult, heartbeatLiveCardId } = setupHeartbeatLiveStartScenario([6, 3]);

    expect(advanceResult.success).toBe(true);
    expect(session.state?.activeEffect?.abilityId).toBe(
      BP4_021_LIVE_START_SUCCESS_SCORE_REQUIREMENT_AND_SCORE_ABILITY_ID
    );
    expect(session.state?.activeEffect?.sourceCardId).toBe(heartbeatLiveCardId);
    expect(session.state?.activeEffect?.effectText).toContain('当前成功LIVE分数合计 9');

    const confirmResult = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id)
    );

    expect(confirmResult.success).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.liveResolution.liveRequirementReductions.get(heartbeatLiveCardId)).toBe(
      1
    );
    expect(session.state?.liveResolution.playerScoreBonuses.get(PLAYER1)).toBe(1);
    expect(session.state?.liveResolution.liveModifiers).toContainEqual({
      kind: 'REQUIREMENT',
      liveCardId: heartbeatLiveCardId,
      modifiers: [{ color: HeartColor.RAINBOW, countDelta: -1 }],
      sourceCardId: heartbeatLiveCardId,
      abilityId: BP4_021_LIVE_START_SUCCESS_SCORE_REQUIREMENT_AND_SCORE_ABILITY_ID,
    });
    expect(session.state?.liveResolution.liveModifiers).toContainEqual({
      kind: 'SCORE',
      playerId: PLAYER1,
      countDelta: 1,
      liveCardId: heartbeatLiveCardId,
      sourceCardId: heartbeatLiveCardId,
      abilityId: BP4_021_LIVE_START_SUCCESS_SCORE_REQUIREMENT_AND_SCORE_ABILITY_ID,
    });
  });

  it('queues PL!-bp4-021-L without writing modifiers when successful Live score is below six', () => {
    const { session, advanceResult, heartbeatLiveCardId } = setupHeartbeatLiveStartScenario([3]);

    expect(advanceResult.success).toBe(true);
    expect(session.state?.activeEffect?.abilityId).toBe(
      BP4_021_LIVE_START_SUCCESS_SCORE_REQUIREMENT_AND_SCORE_ABILITY_ID
    );
    expect(session.state?.activeEffect?.sourceCardId).toBe(heartbeatLiveCardId);
    expect(session.state?.activeEffect?.effectText).toContain('当前成功LIVE分数合计 3');

    const confirmResult = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id)
    );

    expect(confirmResult.success).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(
      session.state?.liveResolution.liveRequirementReductions.get(heartbeatLiveCardId)
    ).toBeUndefined();
    expect(
      session.state?.liveResolution.liveModifiers.filter(
        (modifier) =>
          modifier.abilityId === BP4_021_LIVE_START_SUCCESS_SCORE_REQUIREMENT_AND_SCORE_ABILITY_ID
      )
    ).toEqual([]);
  });

  it('queues PL!HS-bp5-019-L from the Live zone and reduces green requirements by other Hasunosora live cards', () => {
    const session = createGameSession();
    const deck = createDeck();

    session.createGame(
      'sample-live-start-hanamusubi-requirement',
      PLAYER1,
      'Player 1',
      PLAYER2,
      'Player 2'
    );
    session.initializeGame(deck, deck);

    const hanamusubi = createCardInstance(
      {
        cardCode: 'PL!HS-bp5-019-L',
        name: '花结',
        groupName: 'スリーズブーケ',
        cardType: CardType.LIVE as const,
        score: 6,
        requirements: createHeartRequirement({
          [HeartColor.GREEN]: 9,
          [HeartColor.RAINBOW]: 5,
        }),
      },
      PLAYER1,
      'p1-hanamusubi-live'
    );
    const otherHasunosoraLive = createCardInstance(
      {
        cardCode: 'PL!HS-test-live',
        name: '莲之空测试LIVE',
        groupName: '蓮ノ空',
        cardType: CardType.LIVE as const,
        score: 1,
        requirements: createHeartRequirement({ [HeartColor.GREEN]: 1 }),
      },
      PLAYER1,
      'p1-other-hasunosora-live'
    );

    let state = registerCards(session.state!, [hanamusubi, otherHasunosoraLive]);
    state = updatePlayer(state, PLAYER1, (player) => ({
      ...player,
      liveZone: {
        ...player.liveZone,
        cardIds: [hanamusubi.instanceId, otherHasunosoraLive.instanceId],
        cardStates: new Map([
          [
            hanamusubi.instanceId,
            { orientation: OrientationState.ACTIVE, face: FaceState.FACE_DOWN },
          ],
          [
            otherHasunosoraLive.instanceId,
            { orientation: OrientationState.ACTIVE, face: FaceState.FACE_DOWN },
          ],
        ]),
      },
    }));
    state = {
      ...state,
      currentPhase: GamePhase.LIVE_SET_PHASE,
      currentSubPhase: SubPhase.LIVE_SET_SECOND_DRAW,
      currentTurnType: TurnType.LIVE_PHASE,
      activePlayerIndex: 0,
      firstPlayerIndex: 0,
      liveSetCompletedPlayers: [PLAYER1, PLAYER2],
    };

    const service = new GameService();
    const advanceResult = service.advancePhase(state);
    (session as unknown as { authorityState: GameState }).authorityState = advanceResult.gameState;

    expect(advanceResult.success).toBe(true);
    const liveStartEvent = session.state?.eventLog.find(
      (entry) => entry.event.eventType === TriggerCondition.ON_LIVE_START
    )?.event;
    expect(liveStartEvent).toMatchObject({
      eventType: TriggerCondition.ON_LIVE_START,
      performerId: PLAYER1,
      liveCardIds: [hanamusubi.instanceId, otherHasunosoraLive.instanceId],
    });
    expect(session.state?.activeEffect?.abilityId).toBe(
      HS_BP5_019_LIVE_START_REQUIREMENT_ABILITY_ID
    );
    expect(session.state?.activeEffect?.sourceCardId).toBe(hanamusubi.instanceId);
    expect(session.state?.activeEffect?.effectText).toContain('当前此卡以外莲之空卡 1张');

    const confirmResult = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id)
    );

    expect(confirmResult.success).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(
      session.state?.liveResolution.liveRequirementModifiers.get(hanamusubi.instanceId)
    ).toEqual([{ color: HeartColor.GREEN, countDelta: -2 }]);
    expect(session.state?.liveResolution.liveModifiers).toContainEqual({
      kind: 'REQUIREMENT',
      liveCardId: hanamusubi.instanceId,
      modifiers: [{ color: HeartColor.GREEN, countDelta: -2 }],
      sourceCardId: hanamusubi.instanceId,
      abilityId: HS_BP5_019_LIVE_START_REQUIREMENT_ABILITY_ID,
    });
  });

  it('queues PL!HS-bp2-022-L+ from the Live zone and adds score with three Cerise Bouquet live cards in waiting room', () => {
    const session = createGameSession();
    const deck = createDeck();

    session.createGame(
      'sample-live-start-aokuharuka-score',
      PLAYER1,
      'Player 1',
      PLAYER2,
      'Player 2'
    );
    session.initializeGame(deck, deck);

    const aokuharuka = createCardInstance(
      {
        cardCode: 'PL!HS-bp2-022-L+',
        name: 'アオクハルカ',
        groupName: 'スリーズブーケ',
        cardType: CardType.LIVE as const,
        score: 2,
        requirements: createHeartRequirement({ [HeartColor.GREEN]: 1 }),
      },
      PLAYER1,
      'p1-aokuharuka-live'
    );
    const waitingRoomLives = Array.from({ length: 3 }, (_, index) =>
      createCardInstance(
        {
          cardCode: `CERISE-LIVE-${index}`,
          name: `Cerise Live ${index}`,
          groupName: '蓮ノ空女学院スクールアイドルクラブ',
          unitName: 'スリーズブーケ',
          cardType: CardType.LIVE as const,
          score: 1,
          requirements: createHeartRequirement({ [HeartColor.GREEN]: 1 }),
        },
        PLAYER1,
        `p1-cerise-live-${index}`
      )
    );

    let state = registerCards(session.state!, [aokuharuka, ...waitingRoomLives]);
    state = updatePlayer(state, PLAYER1, (player) => ({
      ...player,
      liveZone: {
        ...player.liveZone,
        cardIds: [aokuharuka.instanceId],
        cardStates: new Map([
          [
            aokuharuka.instanceId,
            { orientation: OrientationState.ACTIVE, face: FaceState.FACE_DOWN },
          ],
        ]),
      },
      waitingRoom: {
        ...player.waitingRoom,
        cardIds: waitingRoomLives.map((card) => card.instanceId),
      },
    }));
    state = {
      ...state,
      currentPhase: GamePhase.LIVE_SET_PHASE,
      currentSubPhase: SubPhase.LIVE_SET_SECOND_DRAW,
      currentTurnType: TurnType.LIVE_PHASE,
      activePlayerIndex: 0,
      firstPlayerIndex: 0,
      liveSetCompletedPlayers: [PLAYER1, PLAYER2],
    };

    const service = new GameService();
    const advanceResult = service.advancePhase(state);
    (session as unknown as { authorityState: GameState }).authorityState = advanceResult.gameState;

    expect(advanceResult.success).toBe(true);
    expect(session.state?.activeEffect?.abilityId).toBe(HS_BP2_022_LIVE_START_SCORE_ABILITY_ID);
    expect(session.state?.activeEffect?.sourceCardId).toBe(aokuharuka.instanceId);
    expect(session.state?.activeEffect?.effectText).toContain('当前3张，满足条件');

    const confirmResult = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id)
    );

    expect(confirmResult.success).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.liveResolution.playerScoreBonuses.get(PLAYER1)).toBe(1);
    expect(session.state?.liveResolution.liveModifiers).toContainEqual({
      kind: 'SCORE',
      playerId: PLAYER1,
      countDelta: 1,
      liveCardId: aokuharuka.instanceId,
      sourceCardId: aokuharuka.instanceId,
      abilityId: HS_BP2_022_LIVE_START_SCORE_ABILITY_ID,
    });
  });

  it('executes PL!-sd1-019-SD live-success inspect top 3, order selected cards to deck top, and mill the rest', () => {
    const session = createGameSession();
    const deck = createDeck();

    session.createGame('sample-live-success-start-dash', PLAYER1, 'Player 1', PLAYER2, 'Player 2');
    session.initializeGame(deck, deck);

    const state = session.state!;
    const p1 = state.players[0] as unknown as {
      hand: { cardIds: string[] };
      mainDeck: { cardIds: string[] };
      waitingRoom: { cardIds: string[] };
      successZone: { cardIds: string[] };
      liveZone: { cardIds: string[] };
    };
    const ownedP1CardIds = [...state.cardRegistry.values()]
      .filter((card) => card.ownerId === PLAYER1)
      .map((card) => card.instanceId);
    const liveCardId = ownedP1CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardType === CardType.LIVE
    );
    const topCardIds = ownedP1CardIds
      .filter((cardId) => cardId !== liveCardId)
      .filter((cardId) => state.cardRegistry.get(cardId)?.data.cardType === CardType.MEMBER)
      .slice(0, 4);

    expect(liveCardId).toBeTruthy();
    expect(topCardIds).toHaveLength(4);

    const liveCard = state.cardRegistry.get(liveCardId!) as unknown as { data: LiveCardData };
    liveCard.data = createLiveCard('PL!-sd1-019-SD', 'START:DASH!!');
    removeFromPlayerZones(p1);
    p1.successZone.cardIds = [liveCardId!];
    p1.mainDeck.cardIds = topCardIds;

    const mutableState = state as unknown as {
      currentPhase: GamePhase;
      currentSubPhase: SubPhase;
      firstPlayerIndex: number;
      activePlayerIndex: number;
      liveResolution: GameState['liveResolution'];
    };
    mutableState.currentPhase = GamePhase.LIVE_RESULT_PHASE;
    mutableState.currentSubPhase = SubPhase.RESULT_FIRST_SUCCESS_EFFECTS;
    mutableState.firstPlayerIndex = 0;
    mutableState.activePlayerIndex = 0;
    mutableState.liveResolution = {
      ...state.liveResolution,
      liveResults: new Map([[liveCardId!, true]]),
    };

    const service = new GameService();
    const checkResult = service.executeCheckTiming(state, [TriggerCondition.ON_LIVE_SUCCESS]);
    (session as unknown as { authorityState: GameState }).authorityState = checkResult.gameState;

    expect(checkResult.success).toBe(true);
    expect(session.state?.activeEffect?.abilityId).toBe(START_DASH_LIVE_SUCCESS_ABILITY_ID);
    expect(session.state?.activeEffect?.selectableCardMode).toBe('ORDERED_MULTI');
    expect(session.state?.activeEffect?.minSelectableCards).toBe(0);
    expect(session.state?.activeEffect?.maxSelectableCards).toBe(3);
    expect(session.state?.inspectionZone.cardIds).toEqual(topCardIds.slice(0, 3));
    expect(session.state?.players[0].mainDeck.cardIds).toEqual([topCardIds[3]]);

    const duplicateSelectionResult = session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        session.state!.activeEffect!.id,
        undefined,
        undefined,
        undefined,
        undefined,
        [topCardIds[2], topCardIds[2]]
      )
    );

    expect(duplicateSelectionResult.success).toBe(false);
    expect(session.state?.activeEffect?.abilityId).toBe(START_DASH_LIVE_SUCCESS_ABILITY_ID);
    expect(session.state?.inspectionZone.cardIds).toEqual(topCardIds.slice(0, 3));
    expect(session.state?.players[0].mainDeck.cardIds).toEqual([topCardIds[3]]);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([]);

    const confirmResult = session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        session.state!.activeEffect!.id,
        undefined,
        undefined,
        undefined,
        undefined,
        [topCardIds[2], topCardIds[0]]
      )
    );

    expect(confirmResult.success).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.inspectionZone.cardIds).toEqual([]);
    expect(session.state?.players[0].mainDeck.cardIds).toEqual([
      topCardIds[2],
      topCardIds[0],
      topCardIds[3],
    ]);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([topCardIds[1]]);
  });

  it('triggers the second player live-success window when only the second player succeeded', () => {
    const session = createGameSession();
    const deck = createDeck();

    session.createGame(
      'sample-live-success-second-player-only',
      PLAYER1,
      'Player 1',
      PLAYER2,
      'Player 2'
    );
    session.initializeGame(deck, deck);

    const state = session.state!;
    const p1 = state.players[0] as unknown as {
      hand: { cardIds: string[] };
      mainDeck: { cardIds: string[] };
      waitingRoom: { cardIds: string[] };
      successZone: { cardIds: string[] };
      liveZone: { cardIds: string[] };
    };
    const p2 = state.players[1] as unknown as {
      hand: { cardIds: string[] };
      mainDeck: { cardIds: string[] };
      waitingRoom: { cardIds: string[] };
      successZone: { cardIds: string[] };
      liveZone: { cardIds: string[] };
    };
    const ownedP1CardIds = [...state.cardRegistry.values()]
      .filter((card) => card.ownerId === PLAYER1)
      .map((card) => card.instanceId);
    const ownedP2CardIds = [...state.cardRegistry.values()]
      .filter((card) => card.ownerId === PLAYER2)
      .map((card) => card.instanceId);
    const failedLiveCardId = ownedP1CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardType === CardType.LIVE
    );
    const successfulLiveCardId = ownedP2CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardType === CardType.LIVE
    );
    const topCardIds = ownedP2CardIds
      .filter((cardId) => cardId !== successfulLiveCardId)
      .filter((cardId) => state.cardRegistry.get(cardId)?.data.cardType === CardType.MEMBER)
      .slice(0, 4);

    expect(failedLiveCardId).toBeTruthy();
    expect(successfulLiveCardId).toBeTruthy();
    expect(topCardIds).toHaveLength(4);

    const failedLiveCard = state.cardRegistry.get(failedLiveCardId!) as unknown as {
      data: LiveCardData;
    };
    const successfulLiveCard = state.cardRegistry.get(successfulLiveCardId!) as unknown as {
      data: LiveCardData;
    };
    failedLiveCard.data = createLiveCard('P1-FAILED-LIVE', 'First Player Failed Live');
    successfulLiveCard.data = createLiveCard('PL!-sd1-019-SD', 'START:DASH!!');

    removeFromPlayerZones(p1);
    removeFromPlayerZones(p2);
    p1.liveZone.cardIds = [failedLiveCardId!];
    p2.liveZone.cardIds = [successfulLiveCardId!];
    p2.mainDeck.cardIds = topCardIds;

    const mutableState = state as unknown as {
      currentPhase: GamePhase;
      currentSubPhase: SubPhase;
      currentTurnType: TurnType;
      firstPlayerIndex: number;
      activePlayerIndex: number;
      liveResolution: GameState['liveResolution'];
    };
    mutableState.currentPhase = GamePhase.PERFORMANCE_PHASE;
    mutableState.currentSubPhase = SubPhase.NONE;
    mutableState.currentTurnType = TurnType.SECOND_PLAYER_TURN;
    mutableState.firstPlayerIndex = 0;
    mutableState.activePlayerIndex = 1;
    mutableState.liveResolution = {
      ...state.liveResolution,
      liveResults: new Map([
        [failedLiveCardId!, false],
        [successfulLiveCardId!, true],
      ]),
    };

    const service = new GameService();
    const advanceResult = service.advancePhase(state);

    expect(advanceResult.success).toBe(true);
    expect(advanceResult.gameState.currentPhase).toBe(GamePhase.LIVE_RESULT_PHASE);
    expect(advanceResult.gameState.currentSubPhase).toBe(SubPhase.RESULT_SECOND_SUCCESS_EFFECTS);
    expect(advanceResult.gameState.activePlayerIndex).toBe(1);
    const liveSuccessEvent = advanceResult.gameState.eventLog.find(
      (entry) => entry.event.eventType === TriggerCondition.ON_LIVE_SUCCESS
    )?.event;
    expect(liveSuccessEvent).toMatchObject({
      eventType: TriggerCondition.ON_LIVE_SUCCESS,
      playerId: PLAYER2,
      successfulLiveCardIds: [successfulLiveCardId],
      score: expect.any(Number),
    });
    expect(advanceResult.gameState.activeEffect?.abilityId).toBe(
      START_DASH_LIVE_SUCCESS_ABILITY_ID
    );
    expect(advanceResult.gameState.activeEffect?.awaitingPlayerId).toBe(PLAYER2);
    expect(advanceResult.gameState.activeEffect?.sourceCardId).toBe(successfulLiveCardId);
    expect(advanceResult.gameState.inspectionZone.cardIds).toEqual(topCardIds.slice(0, 3));
    expect(advanceResult.gameState.players[1].mainDeck.cardIds).toEqual([topCardIds[3]]);
  });

  it('queues live-success abilities from LiveSuccessEvent without relying on liveResults fallback', () => {
    const session = createGameSession();
    const deck = createDeck();

    session.createGame(
      'sample-live-success-event-log-consumption',
      PLAYER1,
      'Player 1',
      PLAYER2,
      'Player 2'
    );
    session.initializeGame(deck, deck);

    const state = session.state!;
    const p1 = state.players[0] as unknown as {
      hand: { cardIds: string[] };
      mainDeck: { cardIds: string[] };
      waitingRoom: { cardIds: string[] };
      successZone: { cardIds: string[] };
      liveZone: { cardIds: string[] };
      memberSlots: {
        slots: Record<SlotPosition, string | null>;
      };
    };
    const ownedP1CardIds = [...state.cardRegistry.values()]
      .filter((card) => card.ownerId === PLAYER1)
      .map((card) => card.instanceId);
    const kahoCardId = ownedP1CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardCode === 'PL!HS-bp6-001-R＋'
    );
    const watercolorWorldCardId = ownedP1CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardCode === 'PL!HS-cl1-009-CL'
    );

    expect(kahoCardId).toBeTruthy();
    expect(watercolorWorldCardId).toBeTruthy();

    removeFromPlayerZones(p1);
    p1.liveZone.cardIds = [watercolorWorldCardId!];
    p1.memberSlots.slots = {
      [SlotPosition.LEFT]: null,
      [SlotPosition.CENTER]: kahoCardId!,
      [SlotPosition.RIGHT]: null,
    };
    const mutableState = state as unknown as {
      currentPhase: GamePhase;
      currentSubPhase: SubPhase;
      firstPlayerIndex: number;
      activePlayerIndex: number;
      liveResolution: GameState['liveResolution'];
    };
    mutableState.currentPhase = GamePhase.LIVE_RESULT_PHASE;
    mutableState.currentSubPhase = SubPhase.RESULT_FIRST_SUCCESS_EFFECTS;
    mutableState.firstPlayerIndex = 0;
    mutableState.activePlayerIndex = 0;
    mutableState.liveResolution = {
      ...state.liveResolution,
      liveResults: new Map(),
    };

    const liveSuccessEvent = createLiveSuccessEvent(PLAYER1, [watercolorWorldCardId!], 1);
    const stateWithEvent = emitGameEvent(state, liveSuccessEvent);
    const queuedState = enqueueTriggeredCardEffects(stateWithEvent, [
      TriggerCondition.ON_LIVE_SUCCESS,
    ]);

    expect(queuedState.pendingAbilities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          abilityId: HS_BP6_001_LIVE_SUCCESS_CHEER_TO_TOP_ABILITY_ID,
          sourceCardId: kahoCardId,
          eventIds: [liveSuccessEvent.eventId],
        }),
        expect.objectContaining({
          abilityId: HS_CL1_009_LIVE_SUCCESS_CHEER_MEMBER_TO_HAND_ABILITY_ID,
          sourceCardId: watercolorWorldCardId,
          eventIds: [liveSuccessEvent.eventId],
        }),
      ])
    );
  });

  it('executes PL!HS-bp6-001-R＋ live-success by moving a revealed cheer card to deck top', () => {
    const session = createGameSession();
    const deck = createDeck();

    session.createGame(
      'sample-hs-bp6-001-live-success-runner',
      PLAYER1,
      'Player 1',
      PLAYER2,
      'Player 2'
    );
    session.initializeGame(deck, deck);

    const state = session.state!;
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
    const ownedP1CardIds = [...state.cardRegistry.values()]
      .filter((card) => card.ownerId === PLAYER1)
      .map((card) => card.instanceId);
    const kahoCardId = ownedP1CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardCode === 'PL!HS-bp6-001-R＋'
    );
    const successfulLiveCardId = ownedP1CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardCode === 'LIVE-0'
    );
    const cheerCardIds = ['MEM-0', 'LIVE-1'].map((cardCode) =>
      ownedP1CardIds.find((cardId) => state.cardRegistry.get(cardId)?.data.cardCode === cardCode)
    );
    const restCardId = ownedP1CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardCode === 'MEM-1'
    );

    expect(kahoCardId).toBeTruthy();
    expect(successfulLiveCardId).toBeTruthy();
    expect(cheerCardIds.every(Boolean)).toBe(true);
    expect(restCardId).toBeTruthy();

    removeFromPlayerZones(p1);
    p1.mainDeck.cardIds = [restCardId!];
    p1.liveZone.cardIds = [successfulLiveCardId!];
    p1.memberSlots.slots = {
      [SlotPosition.LEFT]: null,
      [SlotPosition.CENTER]: kahoCardId!,
      [SlotPosition.RIGHT]: null,
    };
    p1.memberSlots.cardStates = new Map([
      [kahoCardId!, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
    ]);

    const mutableState = state as unknown as {
      currentPhase: GamePhase;
      currentSubPhase: SubPhase;
      firstPlayerIndex: number;
      activePlayerIndex: number;
      liveResolution: GameState['liveResolution'];
      resolutionZone: GameState['resolutionZone'];
    };
    mutableState.currentPhase = GamePhase.LIVE_RESULT_PHASE;
    mutableState.currentSubPhase = SubPhase.RESULT_FIRST_SUCCESS_EFFECTS;
    mutableState.firstPlayerIndex = 0;
    mutableState.activePlayerIndex = 0;
    mutableState.liveResolution = {
      ...state.liveResolution,
      liveResults: new Map([[successfulLiveCardId!, true]]),
      firstPlayerCheerCardIds: cheerCardIds as string[],
    };
    mutableState.resolutionZone = {
      ...state.resolutionZone,
      cardIds: cheerCardIds as string[],
      revealedCardIds: cheerCardIds as string[],
    };

    const service = new GameService();
    const checkResult = service.executeCheckTiming(state, [TriggerCondition.ON_LIVE_SUCCESS]);
    (session as unknown as { authorityState: GameState }).authorityState = checkResult.gameState;

    expect(checkResult.success).toBe(true);
    expect(session.state?.activeEffect?.abilityId).toBe(
      HS_BP6_001_LIVE_SUCCESS_CHEER_TO_TOP_ABILITY_ID
    );
    expect(session.state?.activeEffect?.selectableCardVisibility).toBe('PUBLIC');
    expect(session.state?.activeEffect?.canSkipSelection).toBe(true);
    expect(session.state?.activeEffect?.selectableCardIds).toEqual(cheerCardIds);

    const selectedCardId = cheerCardIds[1]!;
    const confirmResult = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id, selectedCardId)
    );

    expect(confirmResult.success).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].mainDeck.cardIds).toEqual([selectedCardId, restCardId]);
    expect(session.state?.resolutionZone.cardIds).toEqual([cheerCardIds[0]]);
    expect(session.state?.resolutionZone.revealedCardIds).toEqual([cheerCardIds[0]]);
  });

  it('executes PL!HS-cl1-009-CL live-success by taking a cost 4-9 revealed cheer member', () => {
    const session = createGameSession();
    const deck = createDeck();

    session.createGame(
      'sample-hs-cl1-009-live-success-runner',
      PLAYER1,
      'Player 1',
      PLAYER2,
      'Player 2'
    );
    session.initializeGame(deck, deck);

    const state = session.state!;
    const p1 = state.players[0] as unknown as {
      hand: { cardIds: string[] };
      mainDeck: { cardIds: string[] };
      waitingRoom: { cardIds: string[] };
      successZone: { cardIds: string[] };
      liveZone: { cardIds: string[] };
      memberSlots: {
        slots: Record<SlotPosition, string | null>;
      };
    };
    const ownedP1CardIds = [...state.cardRegistry.values()]
      .filter((card) => card.ownerId === PLAYER1)
      .map((card) => card.instanceId);
    const watercolorWorldCardId = ownedP1CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardCode === 'PL!HS-cl1-009-CL'
    );
    const candidateMemberCardId = ownedP1CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardCode === 'PL!N-PR-004-PR'
    );
    const highCostMemberCardId = ownedP1CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardCode === 'PL!-sd1-009-SD'
    );
    const liveCheerCardId = ownedP1CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardCode === 'LIVE-1'
    );

    expect(watercolorWorldCardId).toBeTruthy();
    expect(candidateMemberCardId).toBeTruthy();
    expect(highCostMemberCardId).toBeTruthy();
    expect(liveCheerCardId).toBeTruthy();

    removeFromPlayerZones(p1);
    p1.liveZone.cardIds = [watercolorWorldCardId!];
    p1.memberSlots.slots = {
      [SlotPosition.LEFT]: null,
      [SlotPosition.CENTER]: null,
      [SlotPosition.RIGHT]: null,
    };

    const cheerCardIds = [candidateMemberCardId!, highCostMemberCardId!, liveCheerCardId!];
    const mutableState = state as unknown as {
      currentPhase: GamePhase;
      currentSubPhase: SubPhase;
      firstPlayerIndex: number;
      activePlayerIndex: number;
      liveResolution: GameState['liveResolution'];
      resolutionZone: GameState['resolutionZone'];
    };
    mutableState.currentPhase = GamePhase.LIVE_RESULT_PHASE;
    mutableState.currentSubPhase = SubPhase.RESULT_FIRST_SUCCESS_EFFECTS;
    mutableState.firstPlayerIndex = 0;
    mutableState.activePlayerIndex = 0;
    mutableState.liveResolution = {
      ...state.liveResolution,
      liveResults: new Map([[watercolorWorldCardId!, true]]),
      firstPlayerCheerCardIds: cheerCardIds,
    };
    mutableState.resolutionZone = {
      ...state.resolutionZone,
      cardIds: cheerCardIds,
      revealedCardIds: cheerCardIds,
    };

    const service = new GameService();
    const checkResult = service.executeCheckTiming(state, [TriggerCondition.ON_LIVE_SUCCESS]);
    (session as unknown as { authorityState: GameState }).authorityState = checkResult.gameState;

    expect(checkResult.success).toBe(true);
    expect(session.state?.activeEffect?.abilityId).toBe(
      HS_CL1_009_LIVE_SUCCESS_CHEER_MEMBER_TO_HAND_ABILITY_ID
    );
    expect(session.state?.activeEffect?.selectableCardVisibility).toBe('PUBLIC');
    expect(session.state?.activeEffect?.canSkipSelection).toBe(false);
    expect(session.state?.activeEffect?.selectableCardIds).toEqual([candidateMemberCardId]);

    const confirmResult = session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        session.state!.activeEffect!.id,
        candidateMemberCardId
      )
    );

    expect(confirmResult.success).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].hand.cardIds).toEqual([candidateMemberCardId]);
    expect(session.state?.resolutionZone.cardIds).toEqual([highCostMemberCardId, liveCheerCardId]);
    expect(session.state?.resolutionZone.revealedCardIds).toEqual([
      highCostMemberCardId,
      liveCheerCardId,
    ]);
  });

  it('executes PL!HS-bp6-027-L on-cheer by sending up to three non-blade Hasunosora revealed cheer cards for additional cheer', () => {
    const session = createGameSession();
    const deck = createDeck();

    session.createGame(
      'sample-hs-bp6-027-on-cheer-runner',
      PLAYER1,
      'Player 1',
      PLAYER2,
      'Player 2'
    );
    session.initializeGame(deck, deck);

    const sourceLive = createCardInstance(
      {
        ...createLiveCard('PL!HS-bp6-027-L', '月夜見海月', '莲之空'),
        score: 5,
      },
      PLAYER1,
      'p1-hs-bp6-027-live'
    );
    const bladeHeartHasunosora = createCardInstance(
      {
        ...createMemberCard('PL!HS-test-blade-heart-cheer', '莲之空分数卡', 1, '莲之空'),
        bladeHearts: [{ effect: BladeHeartEffect.SCORE }],
      },
      PLAYER1,
      'p1-hasu-blade-heart-cheer'
    );

    const state = registerCards(session.state!, [sourceLive, bladeHeartHasunosora]);
    const p1 = state.players[0] as unknown as {
      hand: { cardIds: string[] };
      mainDeck: { cardIds: string[] };
      waitingRoom: { cardIds: string[] };
      successZone: { cardIds: string[] };
      liveZone: { cardIds: string[] };
      memberSlots: {
        slots: Record<SlotPosition, string | null>;
      };
    };
    const ownedP1CardIds = [...state.cardRegistry.values()]
      .filter((card) => card.ownerId === PLAYER1)
      .map((card) => card.instanceId);
    const firstSelectableCheerCardId = ownedP1CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardCode === 'MEM-HASU-0'
    );
    const secondSelectableCheerCardId = ownedP1CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardCode === 'LIVE-DIFFERENT-NAME-WAITING'
    );
    const nonHasunosoraCheerCardId = ownedP1CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardCode === 'PL!N-PR-004-PR'
    );
    const additionalCheerCardIds = ['MEM-HASU-1', 'MEM-HASU-2'].map((cardCode) => {
      const cardId = ownedP1CardIds.find(
        (candidateId) => state.cardRegistry.get(candidateId)?.data.cardCode === cardCode
      );
      expect(cardId).toBeTruthy();
      return cardId!;
    });
    const remainingDeckCardId = ownedP1CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardCode === 'MEM-0'
    );

    expect(firstSelectableCheerCardId).toBeTruthy();
    expect(secondSelectableCheerCardId).toBeTruthy();
    expect(nonHasunosoraCheerCardId).toBeTruthy();
    expect(remainingDeckCardId).toBeTruthy();

    removeFromPlayerZones(p1);
    p1.mainDeck.cardIds = [...additionalCheerCardIds, remainingDeckCardId!];
    p1.liveZone.cardIds = [sourceLive.instanceId];
    p1.memberSlots.slots = {
      [SlotPosition.LEFT]: null,
      [SlotPosition.CENTER]: null,
      [SlotPosition.RIGHT]: null,
    };

    const initialCheerCardIds = [
      firstSelectableCheerCardId!,
      secondSelectableCheerCardId!,
      bladeHeartHasunosora.instanceId,
      nonHasunosoraCheerCardId!,
    ];
    const mutableState = state as unknown as {
      currentPhase: GamePhase;
      currentSubPhase: SubPhase;
      firstPlayerIndex: number;
      activePlayerIndex: number;
      liveResolution: GameState['liveResolution'];
      resolutionZone: GameState['resolutionZone'];
    };
    mutableState.currentPhase = GamePhase.PERFORMANCE_PHASE;
    mutableState.currentSubPhase = SubPhase.PERFORMANCE_JUDGMENT;
    mutableState.firstPlayerIndex = 0;
    mutableState.activePlayerIndex = 0;
    mutableState.liveResolution = {
      ...state.liveResolution,
      isInLive: true,
      performingPlayerId: PLAYER1,
      firstPlayerCheerCardIds: initialCheerCardIds,
    };
    mutableState.resolutionZone = {
      ...state.resolutionZone,
      cardIds: initialCheerCardIds,
      revealedCardIds: initialCheerCardIds,
    };

    const cheerEvent = createCheerEvent(PLAYER1, initialCheerCardIds, initialCheerCardIds.length, {
      automated: true,
    });
    const stateWithCheerEvent = emitGameEvent(state, cheerEvent);

    const service = new GameService();
    const checkResult = service.executeCheckTiming(stateWithCheerEvent, [
      TriggerCondition.ON_CHEER,
    ]);
    (session as unknown as { authorityState: GameState }).authorityState = checkResult.gameState;

    expect(checkResult.success).toBe(true);
    expect(session.state?.activeEffect?.id).toContain(cheerEvent.eventId);
    expect(session.state?.activeEffect?.abilityId).toBe(
      HS_BP6_027_ON_CHEER_ADDITIONAL_CHEER_ABILITY_ID
    );
    expect(session.state?.activeEffect?.selectableCardVisibility).toBe('PUBLIC');
    expect(session.state?.activeEffect?.selectableCardMode).toBe('ORDERED_MULTI');
    expect(session.state?.activeEffect?.minSelectableCards).toBe(0);
    expect(session.state?.activeEffect?.maxSelectableCards).toBe(2);
    expect(session.state?.activeEffect?.selectableCardIds).toEqual([
      firstSelectableCheerCardId,
      secondSelectableCheerCardId,
    ]);

    const confirmResult = session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        session.state!.activeEffect!.id,
        undefined,
        undefined,
        undefined,
        undefined,
        [firstSelectableCheerCardId!, secondSelectableCheerCardId!]
      )
    );

    expect(confirmResult.success).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.pendingAbilities).toEqual([]);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([
      firstSelectableCheerCardId,
      secondSelectableCheerCardId,
    ]);
    expect(session.state?.players[0].mainDeck.cardIds).toEqual([remainingDeckCardId]);
    expect(session.state?.resolutionZone.cardIds).toEqual([
      bladeHeartHasunosora.instanceId,
      nonHasunosoraCheerCardId,
      ...additionalCheerCardIds,
    ]);
    expect(session.state?.resolutionZone.revealedCardIds).toEqual([
      bladeHeartHasunosora.instanceId,
      nonHasunosoraCheerCardId,
      ...additionalCheerCardIds,
    ]);
    expect(session.state?.liveResolution.firstPlayerCheerCardIds).toEqual([
      ...initialCheerCardIds,
      ...additionalCheerCardIds,
    ]);
    const cheerEvents = session
      .state!.eventLog.map((entry) => entry.event)
      .filter((event) => event.eventType === TriggerCondition.ON_CHEER);
    expect(cheerEvents).toHaveLength(2);
    expect(cheerEvents.at(-1)).toMatchObject({
      playerId: PLAYER1,
      revealedCardIds: additionalCheerCardIds,
      totalBlade: 2,
      additional: true,
    });

    const recursiveCheckResult = service.executeCheckTiming(session.state!, [
      TriggerCondition.ON_CHEER,
    ]);
    expect(recursiveCheckResult.success).toBe(true);
    expect(recursiveCheckResult.gameState.pendingAbilities).toEqual([]);
  });

  it('opens PL!HS-bp6-027-L manual cheer adjustment selection after revealing a cheer card', () => {
    const session = setupTsukiyomiManualCheerAdjustmentSession();

    const revealResult = session.executeCommand(createRevealCheerCardCommand(PLAYER1));

    expect(revealResult.success).toBe(true);
    expect(session.state?.activeEffect?.abilityId).toBe(
      HS_BP6_027_ON_CHEER_ADDITIONAL_CHEER_ABILITY_ID
    );
    expect(session.state?.activeEffect?.selectableCardIds).toEqual([
      'p1-tsukiyomi-manual-cheer-target-0',
    ]);

    const cheerEvents = session.state!.eventLog
      .map((entry) => entry.event)
      .filter((event) => event.eventType === TriggerCondition.ON_CHEER);
    expect(cheerEvents).toHaveLength(1);
  });

  it('clears PL!HS-bp6-027-L manual cheer adjustment selection after its target leaves resolution', () => {
    const session = setupTsukiyomiManualCheerAdjustmentSession();

    const revealResult = session.executeCommand(createRevealCheerCardCommand(PLAYER1));
    expect(revealResult.success).toBe(true);
    expect(session.state?.activeEffect?.abilityId).toBe(
      HS_BP6_027_ON_CHEER_ADDITIONAL_CHEER_ABILITY_ID
    );

    const moveResult = session.executeCommand(
      createMoveResolutionCardToZoneCommand(
        PLAYER1,
        'p1-tsukiyomi-manual-cheer-target-0',
        ZoneType.MAIN_DECK,
        'TOP'
      )
    );

    expect(moveResult.success).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.resolutionZone.cardIds).not.toContain(
      'p1-tsukiyomi-manual-cheer-target-0'
    );
    expect(session.state?.players[0].mainDeck.cardIds[0]).toBe(
      'p1-tsukiyomi-manual-cheer-target-0'
    );
  });

  it('refreshes PL!HS-bp6-027-L manual cheer adjustment selection after multiple resolution moves', () => {
    const session = setupTsukiyomiManualCheerAdjustmentSession(4);

    const selectableObjectIds = () =>
      session.getPlayerViewState(PLAYER1).activeEffect?.selectableObjectIds;

    for (let index = 0; index < 4; index++) {
      const revealResult = session.executeCommand(createRevealCheerCardCommand(PLAYER1));
      expect(revealResult.success).toBe(true);
    }
    expect(session.state?.activeEffect?.selectableCardIds).toEqual([
      'p1-tsukiyomi-manual-cheer-target-0',
      'p1-tsukiyomi-manual-cheer-target-1',
      'p1-tsukiyomi-manual-cheer-target-2',
      'p1-tsukiyomi-manual-cheer-target-3',
    ]);
    expect(selectableObjectIds()).toEqual([
      'obj_p1-tsukiyomi-manual-cheer-target-0',
      'obj_p1-tsukiyomi-manual-cheer-target-1',
      'obj_p1-tsukiyomi-manual-cheer-target-2',
      'obj_p1-tsukiyomi-manual-cheer-target-3',
    ]);

    const handResult = session.executeCommand(
      createMoveResolutionCardToZoneCommand(
        PLAYER1,
        'p1-tsukiyomi-manual-cheer-target-0',
        ZoneType.HAND
      )
    );
    expect(handResult.success).toBe(true);
    expect(session.state?.activeEffect?.selectableCardIds).toEqual([
      'p1-tsukiyomi-manual-cheer-target-1',
      'p1-tsukiyomi-manual-cheer-target-2',
      'p1-tsukiyomi-manual-cheer-target-3',
    ]);
    expect(selectableObjectIds()).toEqual([
      'obj_p1-tsukiyomi-manual-cheer-target-1',
      'obj_p1-tsukiyomi-manual-cheer-target-2',
      'obj_p1-tsukiyomi-manual-cheer-target-3',
    ]);

    const discardResult = session.executeCommand(
      createMoveResolutionCardToZoneCommand(
        PLAYER1,
        'p1-tsukiyomi-manual-cheer-target-1',
        ZoneType.WAITING_ROOM
      )
    );
    expect(discardResult.success).toBe(true);
    expect(session.state?.activeEffect?.selectableCardIds).toEqual([
      'p1-tsukiyomi-manual-cheer-target-2',
      'p1-tsukiyomi-manual-cheer-target-3',
    ]);
    expect(selectableObjectIds()).toEqual([
      'obj_p1-tsukiyomi-manual-cheer-target-2',
      'obj_p1-tsukiyomi-manual-cheer-target-3',
    ]);

    const returnResult = session.executeCommand(
      createMoveResolutionCardToZoneCommand(
        PLAYER1,
        'p1-tsukiyomi-manual-cheer-target-2',
        ZoneType.MAIN_DECK,
        'TOP'
      )
    );
    expect(returnResult.success).toBe(true);
    expect(session.state?.activeEffect?.selectableCardIds).toEqual([
      'p1-tsukiyomi-manual-cheer-target-3',
    ]);
    expect(selectableObjectIds()).toEqual([
      'obj_p1-tsukiyomi-manual-cheer-target-3',
    ]);
  });

  it('does not trigger PL!-sd1-019-SD live-success effect when the Live failed', () => {
    const session = createGameSession();
    const deck = createDeck();

    session.createGame(
      'sample-live-success-start-dash-fail',
      PLAYER1,
      'Player 1',
      PLAYER2,
      'Player 2'
    );
    session.initializeGame(deck, deck);

    const state = session.state!;
    const ownedP1CardIds = [...state.cardRegistry.values()]
      .filter((card) => card.ownerId === PLAYER1)
      .map((card) => card.instanceId);
    const liveCardId = ownedP1CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardType === CardType.LIVE
    );

    expect(liveCardId).toBeTruthy();

    const liveCard = state.cardRegistry.get(liveCardId!) as unknown as { data: LiveCardData };
    liveCard.data = createLiveCard('PL!-sd1-019-SD', 'START:DASH!!');

    const mutableState = state as unknown as {
      currentPhase: GamePhase;
      currentSubPhase: SubPhase;
      firstPlayerIndex: number;
      activePlayerIndex: number;
      liveResolution: GameState['liveResolution'];
    };
    mutableState.currentPhase = GamePhase.LIVE_RESULT_PHASE;
    mutableState.currentSubPhase = SubPhase.RESULT_FIRST_SUCCESS_EFFECTS;
    mutableState.firstPlayerIndex = 0;
    mutableState.activePlayerIndex = 0;
    mutableState.liveResolution = {
      ...state.liveResolution,
      liveResults: new Map([[liveCardId!, false]]),
    };

    const service = new GameService();
    const checkResult = service.executeCheckTiming(state, [TriggerCondition.ON_LIVE_SUCCESS]);

    expect(checkResult.success).toBe(true);
    expect(checkResult.gameState.activeEffect).toBeNull();
    expect(checkResult.gameState.pendingAbilities).toEqual([]);
  });

  it('executes PL!SP-bp5-003-AR live-start activation for Liella! members and all energy', () => {
    const session = createGameSession();
    const deck = createDeck();

    session.createGame(
      'sample-chisato-live-start-activate',
      PLAYER1,
      'Player 1',
      PLAYER2,
      'Player 2'
    );
    session.initializeGame(deck, deck);

    const state = session.state!;
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

    const ownedP1CardIds = [...state.cardRegistry.values()]
      .filter((card) => card.ownerId === PLAYER1)
      .map((card) => card.instanceId);
    const chisatoCardId = ownedP1CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardCode === 'PL!SP-bp5-003-AR'
    );
    const liellaMemberCardId = ownedP1CardIds.find(
      (cardId) =>
        cardId !== chisatoCardId &&
        state.cardRegistry.get(cardId)?.data.cardCode === 'PL!SP-PR-004-PR'
    );
    const otherMemberCardId = ownedP1CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardCode === 'MEM-0'
    );
    const liveCardId = ownedP1CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardType === CardType.LIVE
    );
    const energyCardIds = ownedP1CardIds.filter(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardType === CardType.ENERGY
    );

    expect(chisatoCardId).toBeTruthy();
    expect(liellaMemberCardId).toBeTruthy();
    expect(otherMemberCardId).toBeTruthy();
    expect(liveCardId).toBeTruthy();
    expect(energyCardIds.length).toBeGreaterThanOrEqual(3);

    removeFromPlayerZones(p1);
    p1.memberSlots.slots[SlotPosition.LEFT] = liellaMemberCardId!;
    p1.memberSlots.slots[SlotPosition.CENTER] = chisatoCardId!;
    p1.memberSlots.slots[SlotPosition.RIGHT] = otherMemberCardId!;
    p1.memberSlots.cardStates = new Map([
      [liellaMemberCardId!, { orientation: OrientationState.WAITING, face: FaceState.FACE_UP }],
      [chisatoCardId!, { orientation: OrientationState.WAITING, face: FaceState.FACE_UP }],
      [otherMemberCardId!, { orientation: OrientationState.WAITING, face: FaceState.FACE_UP }],
    ]);
    p1.liveZone.cardIds = [liveCardId!];
    p1.liveZone.cardStates = new Map([
      [liveCardId!, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_DOWN }],
    ]);
    setEnergyZoneCards(p1, [
      { cardId: energyCardIds[0], orientation: OrientationState.WAITING },
      { cardId: energyCardIds[1], orientation: OrientationState.WAITING },
      { cardId: energyCardIds[2], orientation: OrientationState.ACTIVE },
    ]);

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
    (session as unknown as { authorityState: GameState }).authorityState = advanceResult.gameState;

    expect(advanceResult.success).toBe(true);
    expect(session.state?.activeEffect?.abilityId).toBe(
      CHISATO_LIVE_START_ACTIVATE_LIELLA_AND_ENERGY_ABILITY_ID
    );

    const confirmResult = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id)
    );

    expect(confirmResult.success).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(
      session.state?.players[0].memberSlots.cardStates.get(liellaMemberCardId!)?.orientation
    ).toBe(OrientationState.ACTIVE);
    expect(session.state?.players[0].memberSlots.cardStates.get(chisatoCardId!)?.orientation).toBe(
      OrientationState.ACTIVE
    );
    expect(
      session.state?.players[0].memberSlots.cardStates.get(otherMemberCardId!)?.orientation
    ).toBe(OrientationState.WAITING);
    for (const energyCardId of energyCardIds.slice(0, 3)) {
      expect(session.state?.players[0].energyZone.cardStates.get(energyCardId)?.orientation).toBe(
        OrientationState.ACTIVE
      );
    }
  });

  it('executes PL!N-pb1-008-P+ on-enter effect activate one waiting stage member', () => {
    const session = createGameSession();
    const deck = createDeck();

    session.createGame('sample-emma-activate-member', PLAYER1, 'Player 1', PLAYER2, 'Player 2');
    session.initializeGame(deck, deck);
    forceMainPhaseForPlayer(session);

    const state = session.state!;
    const ownedP1CardIds = [...state.cardRegistry.values()]
      .filter((card) => card.ownerId === PLAYER1)
      .map((card) => card.instanceId);
    const emmaCardId = ownedP1CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardCode === 'PL!N-pb1-008-P+'
    );
    const targetMemberCardId = ownedP1CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardCode === 'MEM-0'
    );
    const energyCardIds = ownedP1CardIds.filter(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardType === CardType.ENERGY
    );

    expect(emmaCardId).toBeTruthy();
    expect(targetMemberCardId).toBeTruthy();
    expect(energyCardIds.length).toBeGreaterThanOrEqual(20);

    const preparedState = updatePlayer(state, PLAYER1, (player) => ({
      ...player,
      hand: { ...player.hand, cardIds: [emmaCardId!] },
      mainDeck: { ...player.mainDeck, cardIds: [] },
      waitingRoom: { ...player.waitingRoom, cardIds: [] },
      successZone: { ...player.successZone, cardIds: [] },
      liveZone: { ...player.liveZone, cardIds: [] },
      energyZone: {
        ...player.energyZone,
        cardIds: energyCardIds.slice(0, 20),
        cardStates: new Map(
          energyCardIds
            .slice(0, 20)
            .map((cardId) => [
              cardId,
              { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP },
            ])
        ),
      },
      memberSlots: {
        ...player.memberSlots,
        slots: {
          [SlotPosition.LEFT]: targetMemberCardId!,
          [SlotPosition.CENTER]: null,
          [SlotPosition.RIGHT]: null,
        },
        cardStates: new Map([
          [targetMemberCardId!, { orientation: OrientationState.WAITING, face: FaceState.FACE_UP }],
        ]),
      },
    }));
    (session as unknown as { authorityState: GameState }).authorityState = preparedState;

    const playResult = session.executeCommand(
      createPlayMemberToSlotCommand(PLAYER1, emmaCardId!, SlotPosition.CENTER)
    );

    expect(playResult.success).toBe(true);
    expect(session.state?.activeEffect?.abilityId).toBe(
      EMMA_ON_ENTER_ACTIVATE_MEMBER_OR_ENERGY_ABILITY_ID
    );
    expect(session.state?.activeEffect?.stepId).toBe('EMMA_SELECT_ACTIVATE_TARGET_TYPE');
    expect(session.state?.activeEffect?.selectableOptions).toEqual([
      { id: 'member', label: '选择1名成员' },
      { id: 'energy', label: '将能量变活跃' },
    ]);

    const selectMemberBranchResult = session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        session.state!.activeEffect!.id,
        undefined,
        undefined,
        undefined,
        'member'
      )
    );

    expect(selectMemberBranchResult.success).toBe(true);
    expect(session.state?.activeEffect?.stepId).toBe('EMMA_SELECT_MEMBER_TO_ACTIVATE');
    expect(session.state?.activeEffect?.selectableOptions).toBeUndefined();
    expect(session.state?.activeEffect?.selectableCardIds).toEqual([targetMemberCardId]);

    const activateMemberResult = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id, targetMemberCardId!)
    );

    expect(activateMemberResult.success).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(
      session.state?.players[0].memberSlots.cardStates.get(targetMemberCardId!)?.orientation
    ).toBe(OrientationState.ACTIVE);
  });

  it('executes PL!N-pb1-008-P+ on-enter effect activate two waiting energy', () => {
    const session = createGameSession();
    const deck = createDeck();

    session.createGame('sample-emma-activate-energy', PLAYER1, 'Player 1', PLAYER2, 'Player 2');
    session.initializeGame(deck, deck);
    forceMainPhaseForPlayer(session);

    const state = session.state!;
    const ownedP1CardIds = [...state.cardRegistry.values()]
      .filter((card) => card.ownerId === PLAYER1)
      .map((card) => card.instanceId);
    const emmaCardId = ownedP1CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardCode === 'PL!N-pb1-008-P+'
    );
    const energyCardIds = ownedP1CardIds.filter(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardType === CardType.ENERGY
    );

    expect(emmaCardId).toBeTruthy();
    expect(energyCardIds.length).toBeGreaterThanOrEqual(20);

    const preparedState = updatePlayer(state, PLAYER1, (player) => ({
      ...player,
      hand: { ...player.hand, cardIds: [emmaCardId!] },
      mainDeck: { ...player.mainDeck, cardIds: [] },
      waitingRoom: { ...player.waitingRoom, cardIds: [] },
      successZone: { ...player.successZone, cardIds: [] },
      liveZone: { ...player.liveZone, cardIds: [] },
      energyZone: {
        ...player.energyZone,
        cardIds: energyCardIds.slice(0, 20),
        cardStates: new Map(
          energyCardIds
            .slice(0, 20)
            .map((cardId) => [
              cardId,
              { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP },
            ])
        ),
      },
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
    (session as unknown as { authorityState: GameState }).authorityState = preparedState;

    const playResult = session.executeCommand(
      createPlayMemberToSlotCommand(PLAYER1, emmaCardId!, SlotPosition.CENTER)
    );

    expect(playResult.success).toBe(true);
    expect(session.state?.activeEffect?.abilityId).toBe(
      EMMA_ON_ENTER_ACTIVATE_MEMBER_OR_ENERGY_ABILITY_ID
    );
    expect(session.state?.activeEffect?.selectableOptions).toEqual([
      { id: 'energy', label: '将能量变活跃' },
    ]);
    const autoActivatedEnergyCardIds = session
      .state!.players[0].energyZone.cardIds.filter(
        (cardId) =>
          session.state!.players[0].energyZone.cardStates.get(cardId)?.orientation ===
          OrientationState.WAITING
      )
      .slice(0, 2);

    const selectEnergyBranchResult = session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        session.state!.activeEffect!.id,
        undefined,
        undefined,
        undefined,
        'energy'
      )
    );

    expect(selectEnergyBranchResult.success).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    for (const energyCardId of autoActivatedEnergyCardIds) {
      expect(session.state?.players[0].energyZone.cardStates.get(energyCardId)?.orientation).toBe(
        OrientationState.ACTIVE
      );
    }
  });

  it('executes PL!S-bp2-006-P on-enter effect play from waiting room to empty slots', () => {
    const session = createGameSession();
    const deck = createDeck();

    session.createGame(
      'sample-yoshiko-play-from-waiting',
      PLAYER1,
      'Player 1',
      PLAYER2,
      'Player 2'
    );
    session.initializeGame(deck, deck);
    forceMainPhaseForPlayer(session);

    const state = session.state!;
    const p1 = state.players[0] as unknown as {
      hand: { cardIds: string[] };
      mainDeck: { cardIds: string[] };
      waitingRoom: { cardIds: string[] };
      successZone: { cardIds: string[] };
      liveZone: { cardIds: string[] };
      energyZone: {
        cardIds: string[];
        cardStates: Map<string, { orientation: OrientationState; face: FaceState }>;
      };
      memberSlots: {
        slots: Record<SlotPosition, string | null>;
        cardStates: Map<string, { orientation: OrientationState; face: FaceState }>;
      };
    };

    const ownedP1CardIds = [...state.cardRegistry.values()]
      .filter((card) => card.ownerId === PLAYER1)
      .map((card) => card.instanceId);
    const yoshikoCardId = ownedP1CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardCode === 'PL!S-bp2-006-P'
    );
    const waitingMemberCardIds = ['MEM-0', 'MEM-1'].map((cardCode) =>
      ownedP1CardIds.find((cardId) => state.cardRegistry.get(cardId)?.data.cardCode === cardCode)
    );
    const energyCardIds = ownedP1CardIds.filter(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardType === CardType.ENERGY
    );

    expect(yoshikoCardId).toBeTruthy();
    expect(waitingMemberCardIds.every(Boolean)).toBe(true);
    expect(energyCardIds.length).toBeGreaterThanOrEqual(15);

    for (const cardId of waitingMemberCardIds) {
      const card = state.cardRegistry.get(cardId!) as unknown as { data: MemberCardData };
      card.data = { ...card.data, cost: 2 };
    }

    const preparedState = updatePlayer(state, PLAYER1, (player) => ({
      ...player,
      hand: { ...player.hand, cardIds: [yoshikoCardId!] },
      mainDeck: { ...player.mainDeck, cardIds: [] },
      waitingRoom: { ...player.waitingRoom, cardIds: waitingMemberCardIds as string[] },
      successZone: { ...player.successZone, cardIds: [] },
      liveZone: { ...player.liveZone, cardIds: [] },
      energyZone: {
        ...player.energyZone,
        cardIds: energyCardIds.slice(0, 15),
        cardStates: new Map(
          energyCardIds
            .slice(0, 15)
            .map((cardId) => [
              cardId,
              { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP },
            ])
        ),
      },
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
    (session as unknown as { authorityState: GameState }).authorityState = preparedState;

    const playResult = session.executeCommand(
      createPlayMemberToSlotCommand(PLAYER1, yoshikoCardId!, SlotPosition.CENTER)
    );

    expect(playResult.success).toBe(true);
    (session as unknown as { authorityState: GameState }).authorityState = updatePlayer(
      session.state!,
      PLAYER1,
      (player) => ({
        ...player,
        waitingRoom: { ...player.waitingRoom, cardIds: waitingMemberCardIds as string[] },
      })
    );
    expect(session.state?.activeEffect?.abilityId).toBe(
      YOSHIKO_ON_ENTER_PLAY_LOW_COST_MEMBERS_ABILITY_ID
    );
    expect(session.state?.activeEffect?.stepId).toBe('YOSHIKO_PAY_COST');

    const payResult = session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        session.state!.activeEffect!.id,
        undefined,
        undefined,
        undefined,
        'pay'
      )
    );

    expect(payResult.success).toBe(true);
    expect(session.state?.activeEffect?.stepId).toBe(
      'YOSHIKO_SELECT_WAITING_ROOM_LOW_COST_MEMBERS'
    );
    expect(session.state?.activeEffect?.selectableCardMode).toBe('ORDERED_MULTI');
    expect(session.state?.activeEffect?.selectableOptions).toBeUndefined();
    expect(session.state?.activeEffect?.selectableCardIds).toEqual(waitingMemberCardIds);

    const duplicatePayResult = session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        session.state!.activeEffect!.id,
        undefined,
        undefined,
        undefined,
        'pay'
      )
    );

    expect(duplicatePayResult.success).toBe(false);
    expect(session.state?.activeEffect?.stepId).toBe(
      'YOSHIKO_SELECT_WAITING_ROOM_LOW_COST_MEMBERS'
    );

    const selectMembersResult = session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        session.state!.activeEffect!.id,
        undefined,
        undefined,
        undefined,
        undefined,
        waitingMemberCardIds as string[]
      )
    );

    expect(selectMembersResult.success).toBe(true);
    expect(session.state?.activeEffect?.stepId).toBe('YOSHIKO_SELECT_STAGE_SLOT');
    expect(session.state?.activeEffect?.selectableCardIds).toEqual([waitingMemberCardIds[0]]);
    expect(
      session.state?.eventLog
        .map((entry) => entry.event)
        .filter(
          (event) =>
            event.eventType === TriggerCondition.ON_ENTER_STAGE &&
            waitingMemberCardIds.includes(event.cardInstanceId)
        )
    ).toHaveLength(0);

    const firstSlotResult = session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        session.state!.activeEffect!.id,
        undefined,
        SlotPosition.LEFT
      )
    );

    expect(firstSlotResult.success).toBe(true);
    expect(session.state?.activeEffect?.selectableCardIds).toEqual([waitingMemberCardIds[1]]);

    const secondSlotResult = session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        session.state!.activeEffect!.id,
        undefined,
        SlotPosition.RIGHT
      )
    );

    expect(secondSlotResult.success).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].memberSlots.slots[SlotPosition.CENTER]).toBe(yoshikoCardId);
    expect(session.state?.players[0].memberSlots.slots[SlotPosition.LEFT]).toBe(
      waitingMemberCardIds[0]
    );
    expect(session.state?.players[0].memberSlots.slots[SlotPosition.RIGHT]).toBe(
      waitingMemberCardIds[1]
    );
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([]);
    const waitingRoomEnterStageEvents = session.state?.eventLog
      .map((entry) => entry.event)
      .filter(
        (event) =>
          event.eventType === TriggerCondition.ON_ENTER_STAGE &&
          waitingMemberCardIds.includes(event.cardInstanceId) &&
          event.fromZone === ZoneType.WAITING_ROOM
      );
    expect(waitingRoomEnterStageEvents).toHaveLength(2);
    expect(waitingRoomEnterStageEvents?.map((event) => event.toSlot)).toEqual([
      SlotPosition.LEFT,
      SlotPosition.RIGHT,
    ]);
    expect(
      session.state?.actionHistory.some(
        (action) =>
          action.type === 'PAY_COST' &&
          action.payload.abilityId === YOSHIKO_ON_ENTER_PLAY_LOW_COST_MEMBERS_ABILITY_ID &&
          action.payload.amount === 4
      )
    ).toBe(true);
  });

  it('lets PL!S-bp2-006-P on-enter play-from-waiting effect be declined without paying or playing members', () => {
    const session = createGameSession();
    const deck = createDeck();

    session.createGame(
      'sample-yoshiko-play-from-waiting-decline',
      PLAYER1,
      'Player 1',
      PLAYER2,
      'Player 2'
    );
    session.initializeGame(deck, deck);
    forceMainPhaseForPlayer(session);

    const state = session.state!;
    const p1 = state.players[0] as unknown as {
      hand: { cardIds: string[] };
      mainDeck: { cardIds: string[] };
      waitingRoom: { cardIds: string[] };
      successZone: { cardIds: string[] };
      liveZone: { cardIds: string[] };
      energyZone: {
        cardIds: string[];
        cardStates: Map<string, { orientation: OrientationState; face: FaceState }>;
      };
      memberSlots: {
        slots: Record<SlotPosition, string | null>;
        cardStates: Map<string, { orientation: OrientationState; face: FaceState }>;
      };
    };
    const ownedP1CardIds = [...state.cardRegistry.values()]
      .filter((card) => card.ownerId === PLAYER1)
      .map((card) => card.instanceId);
    const yoshikoCardId = ownedP1CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardCode === 'PL!S-bp2-006-P'
    );
    const waitingMemberCardId = ownedP1CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardCode === 'MEM-0'
    );
    const energyCardIds = ownedP1CardIds.filter(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardType === CardType.ENERGY
    );

    expect(yoshikoCardId).toBeTruthy();
    expect(waitingMemberCardId).toBeTruthy();
    expect(energyCardIds.length).toBeGreaterThanOrEqual(15);

    const waitingMember = state.cardRegistry.get(waitingMemberCardId!) as unknown as {
      data: MemberCardData;
    };
    waitingMember.data = { ...waitingMember.data, cost: 2 };
    removeFromPlayerZones(p1);
    p1.hand.cardIds = [yoshikoCardId!];
    p1.waitingRoom.cardIds = [waitingMemberCardId!];
    p1.memberSlots.slots = {
      [SlotPosition.LEFT]: null,
      [SlotPosition.CENTER]: null,
      [SlotPosition.RIGHT]: null,
    };
    p1.memberSlots.cardStates = new Map();
    setActiveEnergy(p1, energyCardIds.slice(0, 15));
    (session as unknown as { authorityState: GameState }).authorityState = state;

    const playResult = session.executeCommand(
      createPlayMemberToSlotCommand(PLAYER1, yoshikoCardId!, SlotPosition.CENTER)
    );

    expect(playResult.success).toBe(true);
    (session as unknown as { authorityState: GameState }).authorityState = updatePlayer(
      session.state!,
      PLAYER1,
      (player) => ({
        ...player,
        waitingRoom: { ...player.waitingRoom, cardIds: [waitingMemberCardId!] },
      })
    );
    const activeEffectId = session.state!.activeEffect!.id;
    const enterEventCountBeforeDecline = session.state!.eventLog.filter(
      (entry) => entry.event.eventType === TriggerCondition.ON_ENTER_STAGE
    ).length;
    const energyOrientationsBeforeDecline = new Map(
      session.state!.players[0].energyZone.cardStates
    );

    const declineResult = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, activeEffectId)
    );

    expect(declineResult.success).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([waitingMemberCardId]);
    expect(session.state?.players[0].memberSlots.slots[SlotPosition.LEFT]).toBeNull();
    expect(session.state?.players[0].memberSlots.slots[SlotPosition.RIGHT]).toBeNull();
    for (const energyCardId of energyCardIds.slice(0, 15)) {
      expect(session.state?.players[0].energyZone.cardStates.get(energyCardId)?.orientation).toBe(
        energyOrientationsBeforeDecline.get(energyCardId)?.orientation
      );
    }
    expect(
      session.state?.actionHistory.some(
        (action) =>
          action.type === 'PAY_COST' &&
          action.payload.abilityId === YOSHIKO_ON_ENTER_PLAY_LOW_COST_MEMBERS_ABILITY_ID
      )
    ).toBe(false);
    expect(
      session.state?.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId === YOSHIKO_ON_ENTER_PLAY_LOW_COST_MEMBERS_ABILITY_ID &&
          action.payload.step === 'SKIP'
      )
    ).toBe(true);
    expect(
      session.state?.eventLog.filter(
        (entry) => entry.event.eventType === TriggerCondition.ON_ENTER_STAGE
      )
    ).toHaveLength(enterEventCountBeforeDecline);
  });

  it('keeps PL!S-bp2-006-P on-enter play-from-waiting effect optional when it cannot pay', () => {
    const session = createGameSession();
    const deck = createDeck();

    session.createGame(
      'sample-yoshiko-play-from-waiting-cannot-pay',
      PLAYER1,
      'Player 1',
      PLAYER2,
      'Player 2'
    );
    session.initializeGame(deck, deck);
    forceMainPhaseForPlayer(session);

    const state = session.state!;
    const p1 = state.players[0] as unknown as {
      hand: { cardIds: string[] };
      mainDeck: { cardIds: string[] };
      waitingRoom: { cardIds: string[] };
      successZone: { cardIds: string[] };
      liveZone: { cardIds: string[] };
      energyZone: {
        cardIds: string[];
        cardStates: Map<string, { orientation: OrientationState; face: FaceState }>;
      };
      memberSlots: {
        slots: Record<SlotPosition, string | null>;
        cardStates: Map<string, { orientation: OrientationState; face: FaceState }>;
      };
    };
    const ownedP1CardIds = [...state.cardRegistry.values()]
      .filter((card) => card.ownerId === PLAYER1)
      .map((card) => card.instanceId);
    const yoshikoCardId = ownedP1CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardCode === 'PL!S-bp2-006-P'
    );
    const waitingMemberCardId = ownedP1CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardCode === 'MEM-0'
    );
    const energyCardIds = ownedP1CardIds.filter(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardType === CardType.ENERGY
    );

    expect(yoshikoCardId).toBeTruthy();
    expect(waitingMemberCardId).toBeTruthy();
    expect(energyCardIds.length).toBeGreaterThanOrEqual(14);

    const waitingMember = state.cardRegistry.get(waitingMemberCardId!) as unknown as {
      data: MemberCardData;
    };
    waitingMember.data = { ...waitingMember.data, cost: 2 };
    removeFromPlayerZones(p1);
    p1.hand.cardIds = [yoshikoCardId!];
    p1.waitingRoom.cardIds = [waitingMemberCardId!];
    p1.memberSlots.slots = {
      [SlotPosition.LEFT]: null,
      [SlotPosition.CENTER]: null,
      [SlotPosition.RIGHT]: null,
    };
    p1.memberSlots.cardStates = new Map();
    setActiveEnergy(p1, energyCardIds.slice(0, 14));
    (session as unknown as { authorityState: GameState }).authorityState = state;

    const playResult = session.executeCommand(
      createPlayMemberToSlotCommand(PLAYER1, yoshikoCardId!, SlotPosition.CENTER)
    );

    expect(playResult.success).toBe(true);
    (session as unknown as { authorityState: GameState }).authorityState = updatePlayer(
      session.state!,
      PLAYER1,
      (player) => ({
        ...player,
        waitingRoom: { ...player.waitingRoom, cardIds: [waitingMemberCardId!] },
      })
    );
    expect(session.state?.activeEffect?.selectableOptions).toEqual([
      { id: 'decline', label: '不发动' },
    ]);
    const energyOrientationsBeforeSkip = new Map(session.state!.players[0].energyZone.cardStates);

    const skipResult = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id)
    );

    expect(skipResult.success).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([waitingMemberCardId]);
    expect(session.state?.players[0].memberSlots.slots[SlotPosition.LEFT]).toBeNull();
    expect(session.state?.players[0].memberSlots.slots[SlotPosition.RIGHT]).toBeNull();
    for (const energyCardId of energyCardIds.slice(0, 14)) {
      expect(session.state?.players[0].energyZone.cardStates.get(energyCardId)?.orientation).toBe(
        energyOrientationsBeforeSkip.get(energyCardId)?.orientation
      );
    }
    expect(
      session.state?.actionHistory.some(
        (action) =>
          action.type === 'PAY_COST' &&
          action.payload.abilityId === YOSHIKO_ON_ENTER_PLAY_LOW_COST_MEMBERS_ABILITY_ID
      )
    ).toBe(false);
  });

  it('keeps PL!S-bp2-006-P paid cost when no waiting-room member is selected after payment', () => {
    const session = createGameSession();
    const deck = createDeck();

    session.createGame(
      'sample-yoshiko-play-from-waiting-no-selection-after-pay',
      PLAYER1,
      'Player 1',
      PLAYER2,
      'Player 2'
    );
    session.initializeGame(deck, deck);
    forceMainPhaseForPlayer(session);

    const state = session.state!;
    const p1 = state.players[0] as unknown as {
      hand: { cardIds: string[] };
      mainDeck: { cardIds: string[] };
      waitingRoom: { cardIds: string[] };
      successZone: { cardIds: string[] };
      liveZone: { cardIds: string[] };
      energyZone: {
        cardIds: string[];
        cardStates: Map<string, { orientation: OrientationState; face: FaceState }>;
      };
      memberSlots: {
        slots: Record<SlotPosition, string | null>;
        cardStates: Map<string, { orientation: OrientationState; face: FaceState }>;
      };
    };
    const ownedP1CardIds = [...state.cardRegistry.values()]
      .filter((card) => card.ownerId === PLAYER1)
      .map((card) => card.instanceId);
    const yoshikoCardId = ownedP1CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardCode === 'PL!S-bp2-006-P'
    );
    const energyCardIds = ownedP1CardIds.filter(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardType === CardType.ENERGY
    );

    expect(yoshikoCardId).toBeTruthy();
    expect(energyCardIds.length).toBeGreaterThanOrEqual(15);

    removeFromPlayerZones(p1);
    p1.hand.cardIds = [yoshikoCardId!];
    p1.waitingRoom.cardIds = [];
    p1.memberSlots.slots = {
      [SlotPosition.LEFT]: null,
      [SlotPosition.CENTER]: null,
      [SlotPosition.RIGHT]: null,
    };
    p1.memberSlots.cardStates = new Map();
    setActiveEnergy(p1, energyCardIds.slice(0, 15));
    (session as unknown as { authorityState: GameState }).authorityState = state;

    const playResult = session.executeCommand(
      createPlayMemberToSlotCommand(PLAYER1, yoshikoCardId!, SlotPosition.CENTER)
    );

    expect(playResult.success).toBe(true);
    const payResult = session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        session.state!.activeEffect!.id,
        undefined,
        undefined,
        undefined,
        'pay'
      )
    );

    expect(payResult.success).toBe(true);
    expect(session.state?.activeEffect?.stepId).toBe(
      'YOSHIKO_SELECT_WAITING_ROOM_LOW_COST_MEMBERS'
    );
    expect(session.state?.activeEffect?.selectableCardIds).toEqual([]);
    expect(session.state?.activeEffect?.maxSelectableCards).toBe(0);
    const enterEventCountBeforeFinish = session.state!.eventLog.filter(
      (entry) => entry.event.eventType === TriggerCondition.ON_ENTER_STAGE
    ).length;

    const finishResult = session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        session.state!.activeEffect!.id,
        undefined,
        undefined,
        undefined,
        undefined,
        []
      )
    );

    expect(finishResult.success).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([]);
    expect(session.state?.players[0].memberSlots.slots[SlotPosition.LEFT]).toBeNull();
    expect(session.state?.players[0].memberSlots.slots[SlotPosition.RIGHT]).toBeNull();
    for (const energyCardId of energyCardIds.slice(0, 15)) {
      expect(session.state?.players[0].energyZone.cardStates.get(energyCardId)?.orientation).toBe(
        OrientationState.WAITING
      );
    }
    expect(
      session.state?.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId === YOSHIKO_ON_ENTER_PLAY_LOW_COST_MEMBERS_ABILITY_ID &&
          action.payload.step === 'FINISH_NO_SELECTION'
      )
    ).toBe(true);
    expect(
      session.state?.eventLog.filter(
        (entry) => entry.event.eventType === TriggerCondition.ON_ENTER_STAGE
      )
    ).toHaveLength(enterEventCountBeforeFinish);
  });

  it('queues on-enter effects for members played from waiting room by PL!S-bp2-006-P', () => {
    const session = createGameSession();
    const deck = createDeck();

    session.createGame(
      'sample-yoshiko-play-from-waiting-on-enter',
      PLAYER1,
      'Player 1',
      PLAYER2,
      'Player 2'
    );
    session.initializeGame(deck, deck);
    forceMainPhaseForPlayer(session);

    const state = session.state!;
    const ownedP1CardIds = [...state.cardRegistry.values()]
      .filter((card) => card.ownerId === PLAYER1)
      .map((card) => card.instanceId);
    const yoshikoCardId = ownedP1CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardCode === 'PL!S-bp2-006-P'
    );
    const kotoriCardId = ownedP1CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardCode === 'PL!-sd1-003-SD'
    );
    const targetMemberCardId = ownedP1CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardCode === 'MEM-0'
    );
    const energyCardIds = ownedP1CardIds.filter(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardType === CardType.ENERGY
    );

    expect(yoshikoCardId).toBeTruthy();
    expect(kotoriCardId).toBeTruthy();
    expect(targetMemberCardId).toBeTruthy();
    expect(energyCardIds.length).toBeGreaterThanOrEqual(15);

    const kotoriCard = state.cardRegistry.get(kotoriCardId!) as unknown as {
      data: MemberCardData;
    };
    const targetMemberCard = state.cardRegistry.get(targetMemberCardId!) as unknown as {
      data: MemberCardData;
    };
    kotoriCard.data = createMemberCard('PL!-sd1-003-SD', '南 ことり', 2);
    targetMemberCard.data = createMemberCard('PL!-sd1-test-low-cost-muse', '低费用 μs 成员', 4);

    const preparedState = updatePlayer(state, PLAYER1, (player) => ({
      ...player,
      hand: { ...player.hand, cardIds: [yoshikoCardId!] },
      mainDeck: { ...player.mainDeck, cardIds: [] },
      waitingRoom: { ...player.waitingRoom, cardIds: [kotoriCardId!, targetMemberCardId!] },
      successZone: { ...player.successZone, cardIds: [] },
      liveZone: { ...player.liveZone, cardIds: [] },
      energyZone: {
        ...player.energyZone,
        cardIds: energyCardIds.slice(0, 15),
        cardStates: new Map(
          energyCardIds
            .slice(0, 15)
            .map((cardId) => [
              cardId,
              { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP },
            ])
        ),
      },
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
    (session as unknown as { authorityState: GameState }).authorityState = preparedState;

    const playResult = session.executeCommand(
      createPlayMemberToSlotCommand(PLAYER1, yoshikoCardId!, SlotPosition.CENTER)
    );

    expect(playResult.success).toBe(true);
    (session as unknown as { authorityState: GameState }).authorityState = updatePlayer(
      session.state!,
      PLAYER1,
      (player) => ({
        ...player,
        waitingRoom: { ...player.waitingRoom, cardIds: [kotoriCardId!, targetMemberCardId!] },
      })
    );

    const payResult = session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        session.state!.activeEffect!.id,
        undefined,
        undefined,
        undefined,
        'pay'
      )
    );

    expect(payResult.success).toBe(true);
    expect(session.state?.activeEffect?.selectableOptions).toBeUndefined();
    expect(session.state?.activeEffect?.selectableCardIds).toContain(kotoriCardId);

    const selectMemberResult = session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        session.state!.activeEffect!.id,
        undefined,
        undefined,
        undefined,
        undefined,
        [kotoriCardId!]
      )
    );

    expect(selectMemberResult.success).toBe(true);

    const slotResult = session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        session.state!.activeEffect!.id,
        undefined,
        SlotPosition.LEFT
      )
    );

    expect(slotResult.success).toBe(true);
    const enterStageEvent = session.state?.eventLog
      .map((entry) => entry.event)
      .find(
        (event) =>
          event.eventType === TriggerCondition.ON_ENTER_STAGE &&
          event.cardInstanceId === kotoriCardId
      );
    expect(enterStageEvent).toMatchObject({
      eventType: TriggerCondition.ON_ENTER_STAGE,
      cardInstanceId: kotoriCardId,
      fromZone: ZoneType.WAITING_ROOM,
      toZone: ZoneType.MEMBER_SLOT,
      toSlot: SlotPosition.LEFT,
      controllerId: PLAYER1,
    });
    expect(session.state?.players[0].memberSlots.slots[SlotPosition.LEFT]).toBe(kotoriCardId);
    expect(session.state?.activeEffect?.abilityId).toBe(KOTORI_ON_ENTER_ABILITY_ID);
    expect(session.state?.activeEffect?.sourceCardId).toBe(kotoriCardId);
    expect(session.state?.activeEffect?.selectableCardIds).toEqual([targetMemberCardId]);
    expect(
      session.state?.actionHistory.some(
        (action) =>
          action.type === 'TRIGGER_ABILITY' &&
          action.payload.abilityId === KOTORI_ON_ENTER_ABILITY_ID &&
          action.payload.sourceCardId === kotoriCardId &&
          action.payload.sourceSlot === SlotPosition.LEFT
      )
    ).toBe(true);
  });

  it('executes PL!HS-bp2-012-N leave-stage AUTO to reveal one top-five member', () => {
    const session = createGameSession();
    const deck = createDeck();

    session.createGame('sample-kosuzu-leave-stage-auto', PLAYER1, 'Player 1', PLAYER2, 'Player 2');
    session.initializeGame(deck, deck);
    forceMainPhaseForPlayer(session);

    const state = session.state!;
    const ownedP1CardIds = [...state.cardRegistry.values()]
      .filter((card) => card.ownerId === PLAYER1)
      .map((card) => card.instanceId);
    const kosuzuCardId = ownedP1CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardCode === 'PL!HS-bp2-012-N'
    );
    const memberCardIds = ['MEM-0', 'MEM-1', 'MEM-2'].map((cardCode) =>
      ownedP1CardIds.find((cardId) => state.cardRegistry.get(cardId)?.data.cardCode === cardCode)
    );
    const liveCardIds = ['LIVE-0', 'LIVE-1'].map((cardCode) =>
      ownedP1CardIds.find((cardId) => state.cardRegistry.get(cardId)?.data.cardCode === cardCode)
    );

    expect(kosuzuCardId).toBeTruthy();
    expect(memberCardIds.every(Boolean)).toBe(true);
    expect(liveCardIds.every(Boolean)).toBe(true);

    const topFiveCardIds = [
      memberCardIds[0]!,
      liveCardIds[0]!,
      memberCardIds[1]!,
      liveCardIds[1]!,
      memberCardIds[2]!,
    ];
    const selectedMemberCardId = memberCardIds[1]!;

    const preparedState = updatePlayer(state, PLAYER1, (player) => ({
      ...player,
      hand: { ...player.hand, cardIds: [] },
      mainDeck: { ...player.mainDeck, cardIds: topFiveCardIds },
      waitingRoom: { ...player.waitingRoom, cardIds: [] },
      successZone: { ...player.successZone, cardIds: [] },
      liveZone: { ...player.liveZone, cardIds: [] },
      memberSlots: {
        ...player.memberSlots,
        slots: {
          [SlotPosition.LEFT]: null,
          [SlotPosition.CENTER]: kosuzuCardId!,
          [SlotPosition.RIGHT]: null,
        },
        cardStates: new Map([
          [kosuzuCardId!, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
        ]),
      },
    }));
    (session as unknown as { authorityState: GameState }).authorityState = preparedState;

    const moveResult = session.executeCommand(
      createMovePublicCardToWaitingRoomCommand(
        PLAYER1,
        kosuzuCardId!,
        ZoneType.MEMBER_SLOT,
        SlotPosition.CENTER
      )
    );

    expect(moveResult.success).toBe(true);
    const leaveStageEvent = session.state?.eventLog
      .map((entry) => entry.event)
      .find(
        (event) =>
          event.eventType === TriggerCondition.ON_LEAVE_STAGE &&
          event.cardInstanceId === kosuzuCardId
      );
    expect(leaveStageEvent).toMatchObject({
      eventType: TriggerCondition.ON_LEAVE_STAGE,
      cardInstanceId: kosuzuCardId,
      fromZone: ZoneType.MEMBER_SLOT,
      fromSlot: SlotPosition.CENTER,
      toZone: ZoneType.WAITING_ROOM,
      controllerId: PLAYER1,
    });
    expect(session.state?.activeEffect?.abilityId).toBe(
      HS_BP2_012_LEAVE_STAGE_LOOK_TOP_MEMBER_ABILITY_ID
    );
    expect(session.state?.activeEffect?.inspectionCardIds).toEqual(topFiveCardIds);
    expect(session.state?.activeEffect?.selectableCardIds).toEqual(memberCardIds);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([kosuzuCardId]);

    const revealResult = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id, selectedMemberCardId)
    );

    expect(revealResult.success).toBe(true);
    expect(session.state?.activeEffect?.abilityId).toBe(
      HS_BP2_012_LEAVE_STAGE_LOOK_TOP_MEMBER_ABILITY_ID
    );
    expect(session.state?.inspectionZone.revealedCardIds).toContain(selectedMemberCardId);

    const finishResult = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id)
    );

    expect(finishResult.success).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].hand.cardIds).toEqual([selectedMemberCardId]);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([
      kosuzuCardId,
      topFiveCardIds[0],
      topFiveCardIds[1],
      topFiveCardIds[3],
      topFiveCardIds[4],
    ]);
    expect(session.state?.players[0].mainDeck.cardIds).toEqual([]);
  });

  it('lets the player order PL!HS-bp2-012-N leave-stage AUTO with the replacing member on-enter ability', () => {
    const session = createGameSession();
    const deck = createDeck();

    session.createGame(
      'sample-kosuzu-replaced-order-window',
      PLAYER1,
      'Player 1',
      PLAYER2,
      'Player 2'
    );
    session.initializeGame(deck, deck);
    forceMainPhaseForPlayer(session);

    const state = session.state!;
    const ownedP1CardIds = [...state.cardRegistry.values()]
      .filter((card) => card.ownerId === PLAYER1)
      .map((card) => card.instanceId);
    const kosuzuCardId = ownedP1CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardCode === 'PL!HS-bp2-012-N'
    );
    const megumiCardId = ownedP1CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardCode === 'PL!HS-bp1-006-P'
    );
    const topMemberCardIds = ['MEM-0', 'MEM-1', 'MEM-2', 'MEM-3', 'MEM-4'].map((cardCode) =>
      ownedP1CardIds.find((cardId) => state.cardRegistry.get(cardId)?.data.cardCode === cardCode)
    );
    const energyCardIds = ownedP1CardIds.filter(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardType === CardType.ENERGY
    );

    expect(kosuzuCardId).toBeTruthy();
    expect(megumiCardId).toBeTruthy();
    expect(topMemberCardIds.every(Boolean)).toBe(true);
    expect(energyCardIds.length).toBeGreaterThanOrEqual(11);

    const preparedState = updatePlayer(state, PLAYER1, (player) => ({
      ...player,
      hand: { ...player.hand, cardIds: [megumiCardId!] },
      mainDeck: { ...player.mainDeck, cardIds: topMemberCardIds as string[] },
      waitingRoom: { ...player.waitingRoom, cardIds: [] },
      successZone: { ...player.successZone, cardIds: [] },
      liveZone: { ...player.liveZone, cardIds: [] },
      energyZone: {
        ...player.energyZone,
        cardIds: energyCardIds.slice(0, 11),
        cardStates: new Map(
          energyCardIds
            .slice(0, 11)
            .map((cardId) => [
              cardId,
              { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP },
            ])
        ),
      },
      memberSlots: {
        ...player.memberSlots,
        slots: {
          [SlotPosition.LEFT]: null,
          [SlotPosition.CENTER]: kosuzuCardId!,
          [SlotPosition.RIGHT]: null,
        },
        cardStates: new Map([
          [kosuzuCardId!, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
        ]),
      },
    }));
    (session as unknown as { authorityState: GameState }).authorityState = preparedState;

    const playResult = session.executeCommand(
      createPlayMemberToSlotCommand(PLAYER1, megumiCardId!, SlotPosition.CENTER)
    );

    expect(playResult.success).toBe(true);
    const leaveStageEvent = session.state?.eventLog
      .map((entry) => entry.event)
      .find(
        (event) =>
          event.eventType === TriggerCondition.ON_LEAVE_STAGE &&
          event.cardInstanceId === kosuzuCardId
      );
    expect(leaveStageEvent).toMatchObject({
      eventType: TriggerCondition.ON_LEAVE_STAGE,
      cardInstanceId: kosuzuCardId,
      fromSlot: SlotPosition.CENTER,
      toZone: ZoneType.WAITING_ROOM,
      replacingCardId: megumiCardId,
    });
    expect(session.state?.activeEffect?.abilityId).toBe(ABILITY_ORDER_SELECTION_ID);
    expect(session.state?.activeEffect?.selectableCardIds).toEqual([megumiCardId, kosuzuCardId]);
    expect(session.state?.pendingAbilities.map((ability) => ability.abilityId)).toEqual([
      HS_BP1_006_ON_ENTER_DRAW_DISCARD_ABILITY_ID,
      HS_BP2_012_LEAVE_STAGE_LOOK_TOP_MEMBER_ABILITY_ID,
    ]);

    const chooseKosuzuResult = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id, kosuzuCardId)
    );

    expect(chooseKosuzuResult.success).toBe(true);
    expect(session.state?.activeEffect?.abilityId).toBe(
      HS_BP2_012_LEAVE_STAGE_LOOK_TOP_MEMBER_ABILITY_ID
    );
    expect(session.state?.activeEffect?.sourceCardId).toBe(kosuzuCardId);
    expect(session.state?.activeEffect?.inspectionCardIds).toEqual(topMemberCardIds);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([kosuzuCardId]);
    expect(session.state?.players[0].memberSlots.slots[SlotPosition.CENTER]).toBe(megumiCardId);
  });

  it('opens PL!HS-bp5-003 leave-stage AUTO and position-changes an own member', () => {
    const session = createGameSession();
    const deck = createDeck();

    session.createGame('sample-rurino-leave-stage-own-position', PLAYER1, 'Player 1', PLAYER2, 'Player 2');
    session.initializeGame(deck, deck);
    forceMainPhaseForPlayer(session);

    const state = session.state!;
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
    const p2 = state.players[1] as unknown as {
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
    const ownedP1CardIds = [...state.cardRegistry.values()]
      .filter((card) => card.ownerId === PLAYER1)
      .map((card) => card.instanceId);
    const rurinoCardId = ownedP1CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardCode === 'PL!HS-bp5-003-AR'
    );
    const ownMemberCardId = ownedP1CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardCode === 'MEM-HASU-0'
    );

    expect(rurinoCardId).toBeTruthy();
    expect(ownMemberCardId).toBeTruthy();

    removeFromPlayerZones(p1);
    removeFromPlayerZones(p2);
    p1.memberSlots.slots[SlotPosition.LEFT] = ownMemberCardId!;
    p1.memberSlots.slots[SlotPosition.CENTER] = rurinoCardId!;
    p1.memberSlots.slots[SlotPosition.RIGHT] = null;
    p1.memberSlots.cardStates = new Map([
      [ownMemberCardId!, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
      [rurinoCardId!, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
    ]);
    p2.memberSlots.slots[SlotPosition.LEFT] = null;
    p2.memberSlots.slots[SlotPosition.CENTER] = null;
    p2.memberSlots.slots[SlotPosition.RIGHT] = null;
    p2.memberSlots.cardStates = new Map();
    (session as unknown as { authorityState: GameState }).authorityState = state;

    const moveResult = session.executeCommand(
      createMovePublicCardToWaitingRoomCommand(
        PLAYER1,
        rurinoCardId!,
        ZoneType.MEMBER_SLOT,
        SlotPosition.CENTER
      )
    );

    expect(moveResult.success).toBe(true);
    expect(session.state?.activeEffect?.abilityId).toBe(
      HS_BP5_003_LEAVE_STAGE_POSITION_CHANGE_ABILITY_ID
    );
    expect(session.state?.activeEffect?.selectableCardIds).toEqual([ownMemberCardId]);
    expect(session.state?.activeEffect?.skipSelectionLabel).toBe('不发动');

    const selectMemberResult = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id, ownMemberCardId)
    );

    expect(selectMemberResult.success).toBe(true);
    expect(session.state?.activeEffect?.selectableSlots).toEqual([
      SlotPosition.CENTER,
      SlotPosition.RIGHT,
    ]);

    const moveMemberResult = session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        session.state!.activeEffect!.id,
        undefined,
        SlotPosition.RIGHT
      )
    );

    expect(moveMemberResult.success).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].memberSlots.slots[SlotPosition.LEFT]).toBeNull();
    expect(session.state?.players[0].memberSlots.slots[SlotPosition.RIGHT]).toBe(ownMemberCardId);
  });

  it('allows PL!HS-bp5-003 leave-stage AUTO to position-change an opponent member per FAQ', () => {
    const session = createGameSession();
    const deck = createDeck();

    session.createGame('sample-rurino-leave-stage-opponent-position', PLAYER1, 'Player 1', PLAYER2, 'Player 2');
    session.initializeGame(deck, deck);
    forceMainPhaseForPlayer(session);

    const state = session.state!;
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
    const p2 = state.players[1] as unknown as {
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
    const ownedP1CardIds = [...state.cardRegistry.values()]
      .filter((card) => card.ownerId === PLAYER1)
      .map((card) => card.instanceId);
    const ownedP2CardIds = [...state.cardRegistry.values()]
      .filter((card) => card.ownerId === PLAYER2)
      .map((card) => card.instanceId);
    const rurinoCardId = ownedP1CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardCode === 'PL!HS-bp5-003-AR'
    );
    const opponentMemberCardId = ownedP2CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardCode === 'MEM-HASU-0'
    );

    expect(rurinoCardId).toBeTruthy();
    expect(opponentMemberCardId).toBeTruthy();

    removeFromPlayerZones(p1);
    removeFromPlayerZones(p2);
    p1.memberSlots.slots[SlotPosition.CENTER] = rurinoCardId!;
    p1.memberSlots.cardStates = new Map([
      [rurinoCardId!, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
    ]);
    p2.memberSlots.slots[SlotPosition.LEFT] = opponentMemberCardId!;
    p2.memberSlots.slots[SlotPosition.CENTER] = null;
    p2.memberSlots.slots[SlotPosition.RIGHT] = null;
    p2.memberSlots.cardStates = new Map([
      [opponentMemberCardId!, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
    ]);
    (session as unknown as { authorityState: GameState }).authorityState = state;

    const moveResult = session.executeCommand(
      createMovePublicCardToWaitingRoomCommand(
        PLAYER1,
        rurinoCardId!,
        ZoneType.MEMBER_SLOT,
        SlotPosition.CENTER
      )
    );

    expect(moveResult.success).toBe(true);
    expect(session.state?.activeEffect?.abilityId).toBe(
      HS_BP5_003_LEAVE_STAGE_POSITION_CHANGE_ABILITY_ID
    );
    expect(session.state?.activeEffect?.selectableCardIds).toEqual([opponentMemberCardId]);

    const selectOpponentResult = session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        session.state!.activeEffect!.id,
        opponentMemberCardId
      )
    );

    expect(selectOpponentResult.success).toBe(true);
    const moveOpponentResult = session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        session.state!.activeEffect!.id,
        undefined,
        SlotPosition.RIGHT
      )
    );

    expect(moveOpponentResult.success).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[1].memberSlots.slots[SlotPosition.LEFT]).toBeNull();
    expect(session.state?.players[1].memberSlots.slots[SlotPosition.RIGHT]).toBe(
      opponentMemberCardId
    );
  });

  it('safely resolves PL!HS-bp5-003 leave-stage AUTO when no target exists', () => {
    const session = createGameSession();
    const deck = createDeck();

    session.createGame('sample-rurino-leave-stage-no-target', PLAYER1, 'Player 1', PLAYER2, 'Player 2');
    session.initializeGame(deck, deck);
    forceMainPhaseForPlayer(session);

    const state = session.state!;
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
    const p2 = state.players[1] as unknown as {
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
    const ownedP1CardIds = [...state.cardRegistry.values()]
      .filter((card) => card.ownerId === PLAYER1)
      .map((card) => card.instanceId);
    const rurinoCardId = ownedP1CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardCode === 'PL!HS-bp5-003-AR'
    );

    expect(rurinoCardId).toBeTruthy();

    removeFromPlayerZones(p1);
    removeFromPlayerZones(p2);
    p1.memberSlots.slots[SlotPosition.LEFT] = null;
    p1.memberSlots.slots[SlotPosition.CENTER] = rurinoCardId!;
    p1.memberSlots.slots[SlotPosition.RIGHT] = null;
    p1.memberSlots.cardStates = new Map([
      [rurinoCardId!, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
    ]);
    p2.memberSlots.slots[SlotPosition.LEFT] = null;
    p2.memberSlots.slots[SlotPosition.CENTER] = null;
    p2.memberSlots.slots[SlotPosition.RIGHT] = null;
    p2.memberSlots.cardStates = new Map();
    (session as unknown as { authorityState: GameState }).authorityState = state;

    const moveResult = session.executeCommand(
      createMovePublicCardToWaitingRoomCommand(
        PLAYER1,
        rurinoCardId!,
        ZoneType.MEMBER_SLOT,
        SlotPosition.CENTER
      )
    );

    expect(moveResult.success).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(
      session.state?.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId === HS_BP5_003_LEAVE_STAGE_POSITION_CHANGE_ABILITY_ID &&
          action.payload.step === 'NO_POSITION_CHANGE_TARGETS'
      )
    ).toBe(true);
  });

  it('resolves PL!HS-sd1-001-SD leave-stage AUTO only from a high-cost Hasunosora relay replacement', () => {
    const session = createGameSession();
    const deck = createDeck();

    session.createGame(
      'sample-hs-sd1-001-relay-activate-energy',
      PLAYER1,
      'Player 1',
      PLAYER2,
      'Player 2'
    );
    session.initializeGame(deck, deck);
    forceMainPhaseForPlayer(session);

    let state = session.state!;
    const highCostHasunosoraMember = createCardInstance(
      createMemberCard('PL!HS-test-sd1-001-relay-member', '蓮ノ空 10 Cost Member', 10, '蓮ノ空'),
      PLAYER1,
      'p1-sd1-001-relay-member'
    );
    state = registerCards(state, [highCostHasunosoraMember]);
    const ownedP1CardIds = [...state.cardRegistry.values()]
      .filter((card) => card.ownerId === PLAYER1)
      .map((card) => card.instanceId);
    const kahoCardId = ownedP1CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardCode === 'PL!HS-sd1-001-SD'
    );
    const highCostHasunosoraCardId = highCostHasunosoraMember.instanceId;
    const energyCardIds = ownedP1CardIds.filter(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardType === CardType.ENERGY
    );

    expect(kahoCardId).toBeTruthy();
    expect(highCostHasunosoraCardId).toBeTruthy();
    expect(energyCardIds.length).toBeGreaterThanOrEqual(3);

    const preparedState = updatePlayer(state, PLAYER1, (player) => ({
      ...player,
      hand: { ...player.hand, cardIds: [highCostHasunosoraCardId!] },
      waitingRoom: { ...player.waitingRoom, cardIds: [] },
      successZone: { ...player.successZone, cardIds: [] },
      liveZone: { ...player.liveZone, cardIds: [] },
      energyZone: {
        ...player.energyZone,
        cardIds: energyCardIds.slice(0, 3),
        cardStates: new Map([
          [energyCardIds[0], { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
          [energyCardIds[1], { orientation: OrientationState.WAITING, face: FaceState.FACE_UP }],
          [energyCardIds[2], { orientation: OrientationState.WAITING, face: FaceState.FACE_UP }],
        ]),
      },
      memberSlots: {
        ...player.memberSlots,
        slots: {
          [SlotPosition.LEFT]: null,
          [SlotPosition.CENTER]: kahoCardId!,
          [SlotPosition.RIGHT]: null,
        },
        cardStates: new Map([
          [kahoCardId!, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
        ]),
      },
    }));
    (session as unknown as { authorityState: GameState }).authorityState = preparedState;

    const playResult = session.executeCommand(
      createPlayMemberToSlotCommand(PLAYER1, highCostHasunosoraCardId!, SlotPosition.CENTER)
    );

    expect(playResult.success).toBe(true);
    const leaveStageEvent = session.state?.eventLog
      .map((entry) => entry.event)
      .find(
        (event) =>
          event.eventType === TriggerCondition.ON_LEAVE_STAGE && event.cardInstanceId === kahoCardId
      );
    expect(leaveStageEvent).toMatchObject({
      eventType: TriggerCondition.ON_LEAVE_STAGE,
      cardInstanceId: kahoCardId,
      fromSlot: SlotPosition.CENTER,
      toZone: ZoneType.WAITING_ROOM,
      replacingCardId: highCostHasunosoraCardId,
    });
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.pendingAbilities).toEqual([]);
    expect(session.state?.players[0].memberSlots.slots[SlotPosition.CENTER]).toBe(
      highCostHasunosoraCardId
    );
    expect(session.state?.players[0].waitingRoom.cardIds).toContain(kahoCardId);
    expect(session.state?.players[0].energyZone.cardStates.get(energyCardIds[0])?.orientation).toBe(
      OrientationState.ACTIVE
    );
    expect(session.state?.players[0].energyZone.cardStates.get(energyCardIds[1])?.orientation).toBe(
      OrientationState.ACTIVE
    );
    expect(session.state?.players[0].energyZone.cardStates.get(energyCardIds[2])?.orientation).toBe(
      OrientationState.WAITING
    );
    expect(
      session.state?.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId === HS_SD1_001_RELAY_REPLACED_ACTIVATE_ENERGY_ABILITY_ID &&
          action.payload.step === 'ACTIVATE_TWO_ENERGY_AFTER_RELAY'
      )
    ).toBe(true);
  });

  it('shows a confirm-only step when manually choosing PL!HS-sd1-001-SD no-input AUTO from order selection', () => {
    const session = createGameSession();
    const deck = createDeck();

    session.createGame(
      'sample-hs-sd1-001-relay-confirm-only-manual',
      PLAYER1,
      'Player 1',
      PLAYER2,
      'Player 2'
    );
    session.initializeGame(deck, deck);
    forceMainPhaseForPlayer(session);

    const state = session.state!;
    const ownedP1CardIds = [...state.cardRegistry.values()]
      .filter((card) => card.ownerId === PLAYER1)
      .map((card) => card.instanceId);
    const kahoCardId = ownedP1CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardCode === 'PL!HS-sd1-001-SD'
    );
    const megumiCardId = ownedP1CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardCode === 'PL!HS-bp1-006-P'
    );
    const deckCardIds = ['MEM-0', 'MEM-1'].map((cardCode) =>
      ownedP1CardIds.find((cardId) => state.cardRegistry.get(cardId)?.data.cardCode === cardCode)
    );
    const energyCardIds = ownedP1CardIds.filter(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardType === CardType.ENERGY
    );

    expect(kahoCardId).toBeTruthy();
    expect(megumiCardId).toBeTruthy();
    expect(deckCardIds.every(Boolean)).toBe(true);
    expect(energyCardIds.length).toBeGreaterThanOrEqual(4);

    const preparedState = updatePlayer(state, PLAYER1, (player) => ({
      ...player,
      hand: { ...player.hand, cardIds: [megumiCardId!] },
      mainDeck: { ...player.mainDeck, cardIds: deckCardIds as string[] },
      waitingRoom: { ...player.waitingRoom, cardIds: [] },
      successZone: { ...player.successZone, cardIds: [] },
      liveZone: { ...player.liveZone, cardIds: [] },
      energyZone: {
        ...player.energyZone,
        cardIds: energyCardIds.slice(0, 4),
        cardStates: new Map([
          [energyCardIds[0], { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
          [energyCardIds[1], { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
          [energyCardIds[2], { orientation: OrientationState.WAITING, face: FaceState.FACE_UP }],
          [energyCardIds[3], { orientation: OrientationState.WAITING, face: FaceState.FACE_UP }],
        ]),
      },
      memberSlots: {
        ...player.memberSlots,
        slots: {
          [SlotPosition.LEFT]: null,
          [SlotPosition.CENTER]: kahoCardId!,
          [SlotPosition.RIGHT]: null,
        },
        cardStates: new Map([
          [kahoCardId!, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
        ]),
      },
    }));
    (session as unknown as { authorityState: GameState }).authorityState = preparedState;

    const playResult = session.executeCommand(
      createPlayMemberToSlotCommand(PLAYER1, megumiCardId!, SlotPosition.CENTER)
    );

    expect(playResult.success).toBe(true);
    expect(session.state?.activeEffect?.abilityId).toBe(ABILITY_ORDER_SELECTION_ID);
    expect(session.state?.activeEffect?.selectableCardIds).toEqual(
      expect.arrayContaining([megumiCardId, kahoCardId])
    );
    expect(session.state?.pendingAbilities.map((ability) => ability.abilityId)).toEqual([
      HS_BP1_006_ON_ENTER_DRAW_DISCARD_ABILITY_ID,
      HS_SD1_001_RELAY_REPLACED_ACTIVATE_ENERGY_ABILITY_ID,
    ]);

    const chooseKahoResult = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id, kahoCardId)
    );

    expect(chooseKahoResult.success).toBe(true);
    expect(session.state?.activeEffect).toMatchObject({
      abilityId: HS_SD1_001_RELAY_REPLACED_ACTIVATE_ENERGY_ABILITY_ID,
      sourceCardId: kahoCardId,
    });
    expect(session.state?.activeEffect?.selectableCardIds).toBeUndefined();
    expect(session.state?.activeEffect?.selectableSlots).toBeUndefined();
    expect(session.state?.activeEffect?.selectableOptions).toBeUndefined();
    expect(session.state?.activeEffect?.metadata?.confirmOnlyPendingAbility).toBe(true);
    expect(session.state?.players[0].energyZone.cardStates.get(energyCardIds[0])?.orientation).toBe(
      OrientationState.WAITING
    );
    expect(session.state?.players[0].energyZone.cardStates.get(energyCardIds[1])?.orientation).toBe(
      OrientationState.WAITING
    );

    const continueResult = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id)
    );

    expect(continueResult.success).toBe(true);
    expect(session.state?.players[0].energyZone.cardStates.get(energyCardIds[0])?.orientation).toBe(
      OrientationState.ACTIVE
    );
    expect(session.state?.players[0].energyZone.cardStates.get(energyCardIds[1])?.orientation).toBe(
      OrientationState.ACTIVE
    );
    expect(session.state?.players[0].energyZone.cardStates.get(energyCardIds[2])?.orientation).toBe(
      OrientationState.WAITING
    );
    expect(session.state?.players[0].energyZone.cardStates.get(energyCardIds[3])?.orientation).toBe(
      OrientationState.WAITING
    );
    expect(session.state?.activeEffect?.abilityId).toBe(
      HS_BP1_006_ON_ENTER_DRAW_DISCARD_ABILITY_ID
    );
    expect(session.state?.activeEffect?.sourceCardId).toBe(megumiCardId);
  });

  it('does not show confirm-only steps for PL!HS-sd1-001-SD when resolving in queue order', () => {
    const session = createGameSession();
    const deck = createDeck();

    session.createGame(
      'sample-hs-sd1-001-relay-confirm-only-sequential',
      PLAYER1,
      'Player 1',
      PLAYER2,
      'Player 2'
    );
    session.initializeGame(deck, deck);
    forceMainPhaseForPlayer(session);

    const state = session.state!;
    const ownedP1CardIds = [...state.cardRegistry.values()]
      .filter((card) => card.ownerId === PLAYER1)
      .map((card) => card.instanceId);
    const kahoCardId = ownedP1CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardCode === 'PL!HS-sd1-001-SD'
    );
    const megumiCardId = ownedP1CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardCode === 'PL!HS-bp1-006-P'
    );
    const deckCardIds = ['MEM-0', 'MEM-1'].map((cardCode) =>
      ownedP1CardIds.find((cardId) => state.cardRegistry.get(cardId)?.data.cardCode === cardCode)
    );
    const energyCardIds = ownedP1CardIds.filter(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardType === CardType.ENERGY
    );

    expect(kahoCardId).toBeTruthy();
    expect(megumiCardId).toBeTruthy();
    expect(deckCardIds.every(Boolean)).toBe(true);
    expect(energyCardIds.length).toBeGreaterThanOrEqual(4);

    const preparedState = updatePlayer(state, PLAYER1, (player) => ({
      ...player,
      hand: { ...player.hand, cardIds: [megumiCardId!] },
      mainDeck: { ...player.mainDeck, cardIds: deckCardIds as string[] },
      waitingRoom: { ...player.waitingRoom, cardIds: [] },
      successZone: { ...player.successZone, cardIds: [] },
      liveZone: { ...player.liveZone, cardIds: [] },
      energyZone: {
        ...player.energyZone,
        cardIds: energyCardIds.slice(0, 4),
        cardStates: new Map([
          [energyCardIds[0], { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
          [energyCardIds[1], { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
          [energyCardIds[2], { orientation: OrientationState.WAITING, face: FaceState.FACE_UP }],
          [energyCardIds[3], { orientation: OrientationState.WAITING, face: FaceState.FACE_UP }],
        ]),
      },
      memberSlots: {
        ...player.memberSlots,
        slots: {
          [SlotPosition.LEFT]: null,
          [SlotPosition.CENTER]: kahoCardId!,
          [SlotPosition.RIGHT]: null,
        },
        cardStates: new Map([
          [kahoCardId!, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
        ]),
      },
    }));
    (session as unknown as { authorityState: GameState }).authorityState = preparedState;

    const playResult = session.executeCommand(
      createPlayMemberToSlotCommand(PLAYER1, megumiCardId!, SlotPosition.CENTER)
    );

    expect(playResult.success).toBe(true);
    expect(session.state?.activeEffect?.abilityId).toBe(ABILITY_ORDER_SELECTION_ID);

    const orderResult = session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        session.state!.activeEffect!.id,
        undefined,
        null,
        true
      )
    );

    expect(orderResult.success).toBe(true);
    expect(session.state?.activeEffect?.abilityId).toBe(
      HS_BP1_006_ON_ENTER_DRAW_DISCARD_ABILITY_ID
    );
    expect(session.state?.activeEffect?.metadata?.orderedResolution).toBe(true);

    const discardResult = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id, deckCardIds[0])
    );

    expect(discardResult.success).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.pendingAbilities).toEqual([]);
    expect(session.state?.players[0].energyZone.cardStates.get(energyCardIds[0])?.orientation).toBe(
      OrientationState.ACTIVE
    );
    expect(session.state?.players[0].energyZone.cardStates.get(energyCardIds[1])?.orientation).toBe(
      OrientationState.ACTIVE
    );
    expect(session.state?.players[0].energyZone.cardStates.get(energyCardIds[2])?.orientation).toBe(
      OrientationState.WAITING
    );
    expect(session.state?.players[0].energyZone.cardStates.get(energyCardIds[3])?.orientation).toBe(
      OrientationState.WAITING
    );
  });

  it('triggers PL!HS-pb1-009-R center AUTO when this member enters center', () => {
    const session = createGameSession();
    const deck = createDeck();

    session.createGame(
      'sample-hs-pb1-kaho-self-enter-auto',
      PLAYER1,
      'Player 1',
      PLAYER2,
      'Player 2'
    );
    session.initializeGame(deck, deck);
    forceMainPhaseForPlayer(session);

    const state = session.state!;
    const p1 = state.players[0] as unknown as {
      hand: { cardIds: string[] };
      mainDeck: { cardIds: string[] };
      waitingRoom: { cardIds: string[] };
      successZone: { cardIds: string[] };
      liveZone: { cardIds: string[] };
      energyZone: {
        cardIds: string[];
        cardStates: Map<string, { orientation: OrientationState; face: FaceState }>;
      };
      memberSlots: {
        slots: Record<SlotPosition, string | null>;
        cardStates: Map<string, { orientation: OrientationState; face: FaceState }>;
      };
    };
    const ownedP1CardIds = [...state.cardRegistry.values()]
      .filter((card) => card.ownerId === PLAYER1)
      .map((card) => card.instanceId);
    const kahoCardId = ownedP1CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardCode === 'PL!HS-pb1-009-R'
    );
    const energyCardIds = ownedP1CardIds.filter(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardType === CardType.ENERGY
    );
    const deckCardIds = ownedP1CardIds.filter(
      (cardId) =>
        cardId !== kahoCardId && state.cardRegistry.get(cardId)?.data.cardType !== CardType.ENERGY
    );

    expect(kahoCardId).toBeTruthy();
    expect(energyCardIds.length).toBeGreaterThanOrEqual(15);

    removeFromPlayerZones(p1);
    p1.hand.cardIds = [kahoCardId!];
    p1.mainDeck.cardIds = deckCardIds.slice(0, 10);
    setActiveEnergy(p1, energyCardIds.slice(0, 15));

    const playResult = session.executeCommand(
      createPlayMemberToSlotCommand(PLAYER1, kahoCardId!, SlotPosition.CENTER)
    );

    expect(playResult.success).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.pendingAbilities).toEqual([]);
    expect(session.state?.liveResolution.liveModifiers).toContainEqual({
      kind: 'BLADE',
      playerId: PLAYER1,
      countDelta: 2,
      sourceCardId: kahoCardId,
      abilityId: HS_PB1_009_ON_HASUNOSORA_ENTER_GAIN_BLADE_ABILITY_ID,
    });
    expect(
      session.state?.actionHistory.some(
        (action) =>
          action.type === 'TRIGGER_ABILITY' &&
          action.payload.abilityId === HS_PB1_009_ON_HASUNOSORA_ENTER_GAIN_BLADE_ABILITY_ID &&
          action.payload.sourceCardId === kahoCardId &&
          action.payload.enteredCardId === kahoCardId &&
          action.payload.sourceSlot === SlotPosition.CENTER
      )
    ).toBe(true);
    expect(
      session.state?.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId === HS_PB1_009_ON_HASUNOSORA_ENTER_GAIN_BLADE_ABILITY_ID &&
          action.payload.sourceCardId === kahoCardId &&
          action.payload.step === 'ABILITY_USE' &&
          action.payload.turnCount === session.state?.turnCount
      )
    ).toBe(true);
  });

  it('shows a confirm-only step when manually choosing PL!HS-pb1-009-R no-input AUTO from order selection', () => {
    const { session, kahoCardId, megumiCardId, playResult } = prepareHsPb1KahoMegumiOrderScenario(
      'sample-hs-pb1-kaho-confirm-only-manual'
    );

    expect(playResult.success).toBe(true);
    expect(session.state?.activeEffect?.abilityId).toBe(ABILITY_ORDER_SELECTION_ID);
    expect(session.state?.activeEffect?.selectableCardIds).toEqual(
      expect.arrayContaining([megumiCardId, kahoCardId])
    );
    expect(session.state?.pendingAbilities).toHaveLength(2);

    const chooseKahoResult = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id, kahoCardId)
    );

    expect(chooseKahoResult.success).toBe(true);
    expect(session.state?.activeEffect).toMatchObject({
      abilityId: HS_PB1_009_ON_HASUNOSORA_ENTER_GAIN_BLADE_ABILITY_ID,
      sourceCardId: kahoCardId,
    });
    expect(session.state?.activeEffect?.selectableCardIds).toBeUndefined();
    expect(session.state?.activeEffect?.selectableSlots).toBeUndefined();
    expect(session.state?.activeEffect?.selectableOptions).toBeUndefined();
    expect(session.state?.activeEffect?.canSkipSelection).toBeUndefined();
    expect(session.state?.activeEffect?.canResolveInOrder).toBeUndefined();
    expect(session.state?.activeEffect?.metadata?.confirmOnlyPendingAbility).toBe(true);
    expect(
      session.state?.liveResolution.liveModifiers.some(
        (modifier) =>
          modifier.kind === 'BLADE' &&
          modifier.abilityId === HS_PB1_009_ON_HASUNOSORA_ENTER_GAIN_BLADE_ABILITY_ID &&
          modifier.sourceCardId === kahoCardId
      )
    ).toBe(false);

    const continueResult = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id)
    );

    expect(continueResult.success).toBe(true);
    expect(
      session.state?.liveResolution.liveModifiers.some(
        (modifier) =>
          modifier.kind === 'BLADE' &&
          modifier.abilityId === HS_PB1_009_ON_HASUNOSORA_ENTER_GAIN_BLADE_ABILITY_ID &&
          modifier.sourceCardId === kahoCardId
      )
    ).toBe(true);
    expect(session.state?.activeEffect?.abilityId).toBe(
      HS_BP1_006_ON_ENTER_DRAW_DISCARD_ABILITY_ID
    );
    expect(session.state?.activeEffect?.sourceCardId).toBe(megumiCardId);
  });

  it('does not show confirm-only steps when resolving PL!HS-pb1-009-R AUTO in queue order', () => {
    const { session, kahoCardId, megumiCardId, drawCardIds, playResult } =
      prepareHsPb1KahoMegumiOrderScenario('sample-hs-pb1-kaho-confirm-only-sequential');

    expect(playResult.success).toBe(true);
    expect(session.state?.activeEffect?.abilityId).toBe(ABILITY_ORDER_SELECTION_ID);

    const orderResult = session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        session.state!.activeEffect!.id,
        undefined,
        null,
        true
      )
    );

    expect(orderResult.success).toBe(true);
    expect(session.state?.activeEffect?.abilityId).toBe(
      HS_BP1_006_ON_ENTER_DRAW_DISCARD_ABILITY_ID
    );
    expect(session.state?.activeEffect?.sourceCardId).toBe(megumiCardId);
    expect(session.state?.activeEffect?.metadata?.orderedResolution).toBe(true);

    const discardResult = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id, drawCardIds[0])
    );

    expect(discardResult.success).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.pendingAbilities).toEqual([]);
    expect(
      session.state?.liveResolution.liveModifiers.some(
        (modifier) =>
          modifier.kind === 'BLADE' &&
          modifier.abilityId === HS_PB1_009_ON_HASUNOSORA_ENTER_GAIN_BLADE_ABILITY_ID &&
          modifier.sourceCardId === kahoCardId
      )
    ).toBe(true);
  });

  it('limits PL!HS-pb1-009-R enter-stage AUTO to twice per turn per source card', () => {
    const session = createGameSession();
    const deck = createDeck();

    session.createGame(
      'sample-hs-pb1-kaho-enter-auto-limit',
      PLAYER1,
      'Player 1',
      PLAYER2,
      'Player 2'
    );
    session.initializeGame(deck, deck);
    forceMainPhaseForPlayer(session);

    const state = session.state!;
    const p1 = state.players[0] as unknown as {
      hand: { cardIds: string[] };
      mainDeck: { cardIds: string[] };
      waitingRoom: { cardIds: string[] };
      successZone: { cardIds: string[] };
      liveZone: { cardIds: string[] };
      energyZone: {
        cardIds: string[];
        cardStates: Map<string, { orientation: OrientationState; face: FaceState }>;
      };
      memberSlots: {
        slots: Record<SlotPosition, string | null>;
        cardStates: Map<string, { orientation: OrientationState; face: FaceState }>;
      };
    };
    const ownedP1CardIds = [...state.cardRegistry.values()]
      .filter((card) => card.ownerId === PLAYER1)
      .map((card) => card.instanceId);
    const kahoCardId = ownedP1CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardCode === 'PL!HS-pb1-009-R'
    );
    const hasuCardIds = ['MEM-HASU-0', 'MEM-HASU-1', 'MEM-HASU-2'].map((cardCode) =>
      ownedP1CardIds.find((cardId) => state.cardRegistry.get(cardId)?.data.cardCode === cardCode)
    );
    const nonHasuCardId = ownedP1CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardCode === 'MEM-0'
    );
    const energyCardIds = ownedP1CardIds.filter(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardType === CardType.ENERGY
    );
    const deckCardIds = ownedP1CardIds.filter(
      (cardId) =>
        cardId !== kahoCardId &&
        !hasuCardIds.includes(cardId) &&
        cardId !== nonHasuCardId &&
        state.cardRegistry.get(cardId)?.data.cardType !== CardType.ENERGY
    );

    expect(kahoCardId).toBeTruthy();
    expect(hasuCardIds.every(Boolean)).toBe(true);
    expect(nonHasuCardId).toBeTruthy();
    expect(energyCardIds.length).toBeGreaterThanOrEqual(4);

    removeFromPlayerZones(p1);
    p1.hand.cardIds = [...(hasuCardIds as string[]), nonHasuCardId!];
    p1.mainDeck.cardIds = deckCardIds.slice(0, 10);
    setActiveEnergy(p1, energyCardIds.slice(0, 4));
    p1.memberSlots.slots[SlotPosition.CENTER] = kahoCardId!;
    p1.memberSlots.cardStates = new Map([
      [kahoCardId!, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
    ]);

    const firstHasuResult = session.executeCommand(
      createPlayMemberToSlotCommand(PLAYER1, hasuCardIds[0]!, SlotPosition.LEFT)
    );
    const nonHasuResult = session.executeCommand(
      createPlayMemberToSlotCommand(PLAYER1, nonHasuCardId!, SlotPosition.RIGHT)
    );
    const secondHasuResult = session.executeCommand(
      createPlayMemberToSlotCommand(PLAYER1, hasuCardIds[1]!, SlotPosition.RIGHT)
    );
    const thirdHasuResult = session.executeCommand(
      createPlayMemberToSlotCommand(PLAYER1, hasuCardIds[2]!, SlotPosition.LEFT)
    );

    expect(firstHasuResult.success).toBe(true);
    expect(nonHasuResult.success).toBe(true);
    expect(secondHasuResult.success).toBe(true);
    expect(thirdHasuResult.success).toBe(true);
    expect(
      session.state?.liveResolution.liveModifiers.filter(
        (modifier) =>
          modifier.kind === 'BLADE' &&
          modifier.abilityId === HS_PB1_009_ON_HASUNOSORA_ENTER_GAIN_BLADE_ABILITY_ID &&
          modifier.sourceCardId === kahoCardId
      )
    ).toHaveLength(2);
    expect(
      session.state?.actionHistory.filter(
        (action) =>
          action.type === 'TRIGGER_ABILITY' &&
          action.payload.abilityId === HS_PB1_009_ON_HASUNOSORA_ENTER_GAIN_BLADE_ABILITY_ID &&
          action.payload.sourceCardId === kahoCardId
      )
    ).toHaveLength(2);
    expect(
      session.state?.actionHistory.filter(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId === HS_PB1_009_ON_HASUNOSORA_ENTER_GAIN_BLADE_ABILITY_ID &&
          action.payload.sourceCardId === kahoCardId &&
          action.payload.step === 'ABILITY_USE'
      )
    ).toHaveLength(2);
  });

  it('skips PL!HS-pb1-009-R live-start draw-discard when effective blade is below eight', () => {
    const session = createGameSession();
    const deck = createDeck();

    session.createGame(
      'sample-hs-pb1-kaho-live-start-below-blade-threshold',
      PLAYER1,
      'Player 1',
      PLAYER2,
      'Player 2'
    );
    session.initializeGame(deck, deck);

    const state = session.state!;
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
    const ownedP1CardIds = [...state.cardRegistry.values()]
      .filter((card) => card.ownerId === PLAYER1)
      .map((card) => card.instanceId);
    const kahoCardId = ownedP1CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardCode === 'PL!HS-pb1-009-R'
    );
    const liveCardId = ownedP1CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardType === CardType.LIVE
    );
    const deckCardIds = ownedP1CardIds.filter(
      (cardId) =>
        cardId !== kahoCardId &&
        cardId !== liveCardId &&
        state.cardRegistry.get(cardId)?.data.cardType !== CardType.ENERGY
    );

    expect(kahoCardId).toBeTruthy();
    expect(liveCardId).toBeTruthy();
    expect(deckCardIds.length).toBeGreaterThanOrEqual(2);

    removeFromPlayerZones(p1);
    p1.mainDeck.cardIds = deckCardIds.slice(0, 2);
    p1.memberSlots.slots[SlotPosition.CENTER] = kahoCardId!;
    p1.memberSlots.cardStates = new Map([
      [kahoCardId!, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
    ]);
    p1.liveZone.cardIds = [liveCardId!];
    p1.liveZone.cardStates = new Map([
      [liveCardId!, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_DOWN }],
    ]);

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

    const preparedState = addLiveModifier(state, {
      kind: 'BLADE',
      playerId: PLAYER1,
      countDelta: 2,
      sourceCardId: kahoCardId,
      abilityId: HS_PB1_009_ON_HASUNOSORA_ENTER_GAIN_BLADE_ABILITY_ID,
    });
    const service = new GameService();
    const advanceResult = service.advancePhase(preparedState);
    (session as unknown as { authorityState: GameState }).authorityState = advanceResult.gameState;

    expect(advanceResult.success).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].mainDeck.cardIds).toEqual(deckCardIds.slice(0, 2));
    expect(session.state?.players[0].hand.cardIds).toEqual([]);
    expect(
      session.state?.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId === HS_PB1_009_LIVE_START_DRAW_DISCARD_ABILITY_ID &&
          action.payload.sourceCardId === kahoCardId &&
          action.payload.step === 'SKIP_CONDITION_NOT_MET' &&
          action.payload.effectiveBladeCount === 6
      )
    ).toBe(true);
  });

  it('executes PL!HS-pb1-009-R live-start draw-discard when effective blade is at least eight', () => {
    const session = createGameSession();
    const deck = createDeck();

    session.createGame(
      'sample-hs-pb1-kaho-live-start-draw-discard',
      PLAYER1,
      'Player 1',
      PLAYER2,
      'Player 2'
    );
    session.initializeGame(deck, deck);

    const state = session.state!;
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
    const ownedP1CardIds = [...state.cardRegistry.values()]
      .filter((card) => card.ownerId === PLAYER1)
      .map((card) => card.instanceId);
    const kahoCardId = ownedP1CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardCode === 'PL!HS-pb1-009-R'
    );
    const liveCardId = ownedP1CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardType === CardType.LIVE
    );
    const discardCardId = ownedP1CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardCode === 'MEM-1'
    );
    const deckCardIds = ownedP1CardIds.filter(
      (cardId) =>
        cardId !== kahoCardId &&
        cardId !== liveCardId &&
        cardId !== discardCardId &&
        state.cardRegistry.get(cardId)?.data.cardType !== CardType.ENERGY
    );

    expect(kahoCardId).toBeTruthy();
    expect(liveCardId).toBeTruthy();
    expect(discardCardId).toBeTruthy();
    expect(deckCardIds.length).toBeGreaterThanOrEqual(2);

    const drawCardIds = deckCardIds.slice(0, 2);
    removeFromPlayerZones(p1);
    p1.hand.cardIds = [discardCardId!];
    p1.mainDeck.cardIds = drawCardIds;
    p1.memberSlots.slots[SlotPosition.CENTER] = kahoCardId!;
    p1.memberSlots.cardStates = new Map([
      [kahoCardId!, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
    ]);
    p1.liveZone.cardIds = [liveCardId!];
    p1.liveZone.cardStates = new Map([
      [liveCardId!, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_DOWN }],
    ]);

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

    let preparedState = addLiveModifier(state, {
      kind: 'BLADE',
      playerId: PLAYER1,
      countDelta: 2,
      sourceCardId: kahoCardId,
      abilityId: HS_PB1_009_ON_HASUNOSORA_ENTER_GAIN_BLADE_ABILITY_ID,
    });
    preparedState = addLiveModifier(preparedState, {
      kind: 'BLADE',
      playerId: PLAYER1,
      countDelta: 2,
      sourceCardId: kahoCardId,
      abilityId: HS_PB1_009_ON_HASUNOSORA_ENTER_GAIN_BLADE_ABILITY_ID,
    });

    const service = new GameService();
    const advanceResult = service.advancePhase(preparedState);
    (session as unknown as { authorityState: GameState }).authorityState = advanceResult.gameState;

    expect(advanceResult.success).toBe(true);
    expect(session.state?.activeEffect?.abilityId).toBe(
      HS_PB1_009_LIVE_START_DRAW_DISCARD_ABILITY_ID
    );
    expect(session.state?.activeEffect?.sourceCardId).toBe(kahoCardId);
    expect(session.state?.activeEffect?.selectableCardIds).toEqual([discardCardId, ...drawCardIds]);
    expect(session.state?.players[0].hand.cardIds).toEqual([discardCardId, ...drawCardIds]);
    expect(session.state?.players[0].mainDeck.cardIds).toEqual([]);
    expect(
      session.state?.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId === HS_PB1_009_LIVE_START_DRAW_DISCARD_ABILITY_ID &&
          action.payload.sourceCardId === kahoCardId &&
          action.payload.step === 'CONDITION_MET' &&
          action.payload.effectiveBladeCount === 8
      )
    ).toBe(true);

    const discardResult = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id, discardCardId)
    );

    expect(discardResult.success).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].hand.cardIds).toEqual(drawCardIds);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([discardCardId]);
  });

  it('executes PL!HS-bp6-004-R on-enter target to wait an opponent low-cost member', () => {
    const session = createGameSession();
    const deck = createDeck();

    session.createGame(
      'sample-ginko-on-enter-wait-opponent',
      PLAYER1,
      'Player 1',
      PLAYER2,
      'Player 2'
    );
    session.initializeGame(deck, deck);
    forceMainPhaseForPlayer(session);

    const state = session.state!;
    const p1 = state.players[0] as unknown as {
      hand: { cardIds: string[] };
      mainDeck: { cardIds: string[] };
      waitingRoom: { cardIds: string[] };
      successZone: { cardIds: string[] };
      liveZone: { cardIds: string[] };
      energyZone: {
        cardIds: string[];
        cardStates: Map<string, { orientation: OrientationState; face: FaceState }>;
      };
      memberSlots: {
        slots: Record<SlotPosition, string | null>;
        cardStates: Map<string, { orientation: OrientationState; face: FaceState }>;
      };
    };
    const p2 = state.players[1] as unknown as {
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
    const ownedP1CardIds = [...state.cardRegistry.values()]
      .filter((card) => card.ownerId === PLAYER1)
      .map((card) => card.instanceId);
    const ownedP2CardIds = [...state.cardRegistry.values()]
      .filter((card) => card.ownerId === PLAYER2)
      .map((card) => card.instanceId);
    const ginkoCardId = ownedP1CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardCode === 'PL!HS-bp6-004-R'
    );
    const lowCostMemberId = ownedP2CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardCode === 'MEM-0'
    );
    const highCostMemberId = ownedP2CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardCode === 'PL!HS-bp1-006-P'
    );
    const energyCardIds = ownedP1CardIds.filter(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardType === CardType.ENERGY
    );
    const deckCardIds = ownedP1CardIds.filter(
      (cardId) =>
        cardId !== ginkoCardId && state.cardRegistry.get(cardId)?.data.cardType !== CardType.ENERGY
    );

    expect(ginkoCardId).toBeTruthy();
    expect(lowCostMemberId).toBeTruthy();
    expect(highCostMemberId).toBeTruthy();
    expect(energyCardIds.length).toBeGreaterThanOrEqual(13);

    removeFromPlayerZones(p1);
    removeFromPlayerZones(p2);
    p1.hand.cardIds = [ginkoCardId!];
    p1.mainDeck.cardIds = deckCardIds.slice(0, 5);
    setActiveEnergy(p1, energyCardIds.slice(0, 13));
    p2.memberSlots.slots[SlotPosition.LEFT] = lowCostMemberId!;
    p2.memberSlots.slots[SlotPosition.CENTER] = highCostMemberId!;
    p2.memberSlots.slots[SlotPosition.RIGHT] = null;
    p2.memberSlots.cardStates = new Map([
      [lowCostMemberId!, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
      [highCostMemberId!, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
    ]);

    const playResult = session.executeCommand(
      createPlayMemberToSlotCommand(PLAYER1, ginkoCardId!, SlotPosition.CENTER)
    );

    expect(playResult.success).toBe(true);
    const enterStageEvent = session.state?.eventLog
      .map((entry) => entry.event)
      .find(
        (event) =>
          event.eventType === TriggerCondition.ON_ENTER_STAGE &&
          event.cardInstanceId === ginkoCardId
      );
    expect(enterStageEvent).toMatchObject({
      eventType: TriggerCondition.ON_ENTER_STAGE,
      cardInstanceId: ginkoCardId,
      fromZone: ZoneType.HAND,
      toZone: ZoneType.MEMBER_SLOT,
      toSlot: SlotPosition.CENTER,
      controllerId: PLAYER1,
    });
    expect(session.state?.activeEffect?.abilityId).toBe(
      HS_BP6_004_ON_ENTER_WAIT_OPPONENT_LOW_COST_MEMBER_ABILITY_ID
    );
    expect(session.state?.activeEffect?.selectableCardIds).toEqual([lowCostMemberId]);

    const invalidWaitResult = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id, highCostMemberId)
    );

    expect(invalidWaitResult.success).toBe(false);
    expect(session.state?.activeEffect?.abilityId).toBe(
      HS_BP6_004_ON_ENTER_WAIT_OPPONENT_LOW_COST_MEMBER_ABILITY_ID
    );
    expect(
      session.state?.players[1].memberSlots.cardStates.get(lowCostMemberId!)?.orientation
    ).toBe(OrientationState.ACTIVE);
    expect(
      session.state?.players[1].memberSlots.cardStates.get(highCostMemberId!)?.orientation
    ).toBe(OrientationState.ACTIVE);

    const waitResult = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id, lowCostMemberId)
    );

    expect(waitResult.success).toBe(true);
    expect(
      session.state?.players[1].memberSlots.cardStates.get(lowCostMemberId!)?.orientation
    ).toBe(OrientationState.WAITING);
    expect(
      session.state?.players[1].memberSlots.cardStates.get(highCostMemberId!)?.orientation
    ).toBe(OrientationState.ACTIVE);
    expect(
      session.state?.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId === HS_BP6_004_ON_ENTER_WAIT_OPPONENT_LOW_COST_MEMBER_ABILITY_ID &&
          action.payload.sourceCardId === ginkoCardId &&
          action.payload.step === 'WAIT_OPPONENT_MEMBER' &&
          action.payload.sourceSlot === SlotPosition.CENTER &&
          action.payload.targetPlayerId === PLAYER2 &&
          action.payload.targetCardId === lowCostMemberId &&
          action.payload.previousOrientation === OrientationState.ACTIVE &&
          action.payload.nextOrientation === OrientationState.WAITING
      )
    ).toBe(true);
    expect(
      session.state?.eventLog
        .map((entry) => entry.event)
        .filter(
          (event) =>
            event.eventType === TriggerCondition.ON_MEMBER_STATE_CHANGED &&
            event.cardInstanceId === lowCostMemberId &&
            event.controllerId === PLAYER2 &&
            event.slot === SlotPosition.LEFT &&
            event.previousOrientation === OrientationState.ACTIVE &&
            event.nextOrientation === OrientationState.WAITING
        )
    ).toHaveLength(1);
  });

  it('executes PL!SP-bp4-011-P on-enter to wait an opponent member with printed BLADE <= 3', () => {
    const session = createGameSession();
    const deck = createDeck();

    session.createGame(
      'sample-tomari-bp4-011-on-enter-wait-low-blade',
      PLAYER1,
      'Player 1',
      PLAYER2,
      'Player 2'
    );
    session.initializeGame(deck, deck);
    forceMainPhaseForPlayer(session);

    const state = session.state!;
    const p1 = state.players[0] as unknown as {
      hand: { cardIds: string[] };
      mainDeck: { cardIds: string[] };
      waitingRoom: { cardIds: string[] };
      successZone: { cardIds: string[] };
      liveZone: { cardIds: string[] };
      energyZone: {
        cardIds: string[];
        cardStates: Map<string, { orientation: OrientationState; face: FaceState }>;
      };
      memberSlots: {
        slots: Record<SlotPosition, string | null>;
        cardStates: Map<string, { orientation: OrientationState; face: FaceState }>;
      };
    };
    const p2 = state.players[1] as unknown as {
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
    const ownedP1CardIds = [...state.cardRegistry.values()]
      .filter((card) => card.ownerId === PLAYER1)
      .map((card) => card.instanceId);
    const ownedP2CardIds = [...state.cardRegistry.values()]
      .filter((card) => card.ownerId === PLAYER2)
      .map((card) => card.instanceId);
    const tomariCardId = ownedP1CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardCode === 'PL!SP-bp4-011-P'
    );
    const lowBladeMemberId = ownedP2CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardCode === 'MEM-0'
    );
    const highBladeMemberId = ownedP2CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardCode === 'PL!HS-pb1-009-R'
    );
    const energyCardIds = ownedP1CardIds.filter(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardType === CardType.ENERGY
    );

    expect(tomariCardId).toBeTruthy();
    expect(lowBladeMemberId).toBeTruthy();
    expect(highBladeMemberId).toBeTruthy();
    expect(energyCardIds.length).toBeGreaterThanOrEqual(7);

    removeFromPlayerZones(p1);
    removeFromPlayerZones(p2);
    p1.hand.cardIds = [tomariCardId!];
    setActiveEnergy(p1, energyCardIds.slice(0, 7));
    p2.memberSlots.slots[SlotPosition.LEFT] = lowBladeMemberId!;
    p2.memberSlots.slots[SlotPosition.CENTER] = highBladeMemberId!;
    p2.memberSlots.slots[SlotPosition.RIGHT] = null;
    p2.memberSlots.cardStates = new Map([
      [lowBladeMemberId!, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
      [highBladeMemberId!, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
    ]);

    const playResult = session.executeCommand(
      createPlayMemberToSlotCommand(PLAYER1, tomariCardId!, SlotPosition.CENTER)
    );

    expect(playResult.success).toBe(true);
    expect(session.state?.activeEffect?.abilityId).toBe(
      SP_BP4_011_ENTER_OR_MOVE_WAIT_OPPONENT_LOW_BLADE_MEMBER_ABILITY_ID
    );
    expect(session.state?.activeEffect?.selectableCardIds).toEqual([lowBladeMemberId]);

    const waitResult = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id, lowBladeMemberId)
    );

    expect(waitResult.success).toBe(true);
    expect(
      session.state?.players[1].memberSlots.cardStates.get(lowBladeMemberId!)?.orientation
    ).toBe(OrientationState.WAITING);
    expect(
      session.state?.players[1].memberSlots.cardStates.get(highBladeMemberId!)?.orientation
    ).toBe(OrientationState.ACTIVE);
    expect(
      session.state?.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId ===
            SP_BP4_011_ENTER_OR_MOVE_WAIT_OPPONENT_LOW_BLADE_MEMBER_ABILITY_ID &&
          action.payload.sourceCardId === tomariCardId &&
          action.payload.step === 'WAIT_OPPONENT_MEMBER' &&
          action.payload.sourceSlot === SlotPosition.CENTER &&
          action.payload.targetPlayerId === PLAYER2 &&
          action.payload.targetCardId === lowBladeMemberId &&
          action.payload.previousOrientation === OrientationState.ACTIVE &&
          action.payload.nextOrientation === OrientationState.WAITING
      )
    ).toBe(true);
    expect(
      session.state?.eventLog
        .map((entry) => entry.event)
        .filter(
          (event) =>
            event.eventType === TriggerCondition.ON_MEMBER_STATE_CHANGED &&
            event.cardInstanceId === lowBladeMemberId &&
            event.controllerId === PLAYER2 &&
            event.slot === SlotPosition.LEFT &&
            event.previousOrientation === OrientationState.ACTIVE &&
            event.nextOrientation === OrientationState.WAITING
        )
    ).toHaveLength(1);
  });

  it('executes PL!SP-bp4-011-P after member slot movement events', () => {
    const session = createGameSession();
    const deck = createDeck();

    session.createGame(
      'sample-tomari-bp4-011-move-wait-low-blade',
      PLAYER1,
      'Player 1',
      PLAYER2,
      'Player 2'
    );
    session.initializeGame(deck, deck);
    forceMainPhaseForPlayer(session);

    const state = session.state!;
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
    const p2 = state.players[1] as unknown as {
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
    const ownedP1CardIds = [...state.cardRegistry.values()]
      .filter((card) => card.ownerId === PLAYER1)
      .map((card) => card.instanceId);
    const ownedP2CardIds = [...state.cardRegistry.values()]
      .filter((card) => card.ownerId === PLAYER2)
      .map((card) => card.instanceId);
    const tomariCardId = ownedP1CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardCode === 'PL!SP-bp4-011-P'
    );
    const lowBladeMemberId = ownedP2CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardCode === 'MEM-0'
    );
    const highBladeMemberId = ownedP2CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardCode === 'PL!HS-pb1-009-R'
    );

    expect(tomariCardId).toBeTruthy();
    expect(lowBladeMemberId).toBeTruthy();
    expect(highBladeMemberId).toBeTruthy();

    removeFromPlayerZones(p1);
    removeFromPlayerZones(p2);
    p1.memberSlots.slots[SlotPosition.LEFT] = tomariCardId!;
    p1.memberSlots.slots[SlotPosition.CENTER] = null;
    p1.memberSlots.slots[SlotPosition.RIGHT] = null;
    p1.memberSlots.cardStates = new Map([
      [tomariCardId!, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
    ]);
    p2.memberSlots.slots[SlotPosition.LEFT] = lowBladeMemberId!;
    p2.memberSlots.slots[SlotPosition.CENTER] = highBladeMemberId!;
    p2.memberSlots.slots[SlotPosition.RIGHT] = null;
    p2.memberSlots.cardStates = new Map([
      [lowBladeMemberId!, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
      [highBladeMemberId!, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
    ]);

    const moveResult = session.executeCommand(
      createMoveMemberToSlotCommand(PLAYER1, tomariCardId!, SlotPosition.LEFT, SlotPosition.RIGHT)
    );

    expect(moveResult.success).toBe(true);
    expect(session.state?.eventLog.at(-1)?.event).toMatchObject({
      eventType: TriggerCondition.ON_MEMBER_SLOT_MOVED,
      cardInstanceId: tomariCardId,
      fromSlot: SlotPosition.LEFT,
      toSlot: SlotPosition.RIGHT,
    });
    expect(session.state?.activeEffect?.abilityId).toBe(
      SP_BP4_011_ENTER_OR_MOVE_WAIT_OPPONENT_LOW_BLADE_MEMBER_ABILITY_ID
    );
    expect(session.state?.activeEffect?.selectableCardIds).toEqual([lowBladeMemberId]);

    const waitResult = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id, lowBladeMemberId)
    );

    expect(waitResult.success).toBe(true);
    expect(
      session.state?.players[1].memberSlots.cardStates.get(lowBladeMemberId!)?.orientation
    ).toBe(OrientationState.WAITING);
  });

  it('resolves PL!SP-bp4-011-P movement trigger with no effect when no low-BLADE target exists', () => {
    const session = createGameSession();
    const deck = createDeck();

    session.createGame(
      'sample-tomari-bp4-011-move-no-target',
      PLAYER1,
      'Player 1',
      PLAYER2,
      'Player 2'
    );
    session.initializeGame(deck, deck);
    forceMainPhaseForPlayer(session);

    const state = session.state!;
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
    const p2 = state.players[1] as unknown as {
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
    const ownedP1CardIds = [...state.cardRegistry.values()]
      .filter((card) => card.ownerId === PLAYER1)
      .map((card) => card.instanceId);
    const ownedP2CardIds = [...state.cardRegistry.values()]
      .filter((card) => card.ownerId === PLAYER2)
      .map((card) => card.instanceId);
    const tomariCardId = ownedP1CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardCode === 'PL!SP-bp4-011-P'
    );
    const highBladeMemberId = ownedP2CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardCode === 'PL!HS-pb1-009-R'
    );

    expect(tomariCardId).toBeTruthy();
    expect(highBladeMemberId).toBeTruthy();

    removeFromPlayerZones(p1);
    removeFromPlayerZones(p2);
    p1.memberSlots.slots[SlotPosition.LEFT] = tomariCardId!;
    p1.memberSlots.slots[SlotPosition.CENTER] = null;
    p1.memberSlots.slots[SlotPosition.RIGHT] = null;
    p1.memberSlots.cardStates = new Map([
      [tomariCardId!, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
    ]);
    p2.memberSlots.slots[SlotPosition.LEFT] = highBladeMemberId!;
    p2.memberSlots.slots[SlotPosition.CENTER] = null;
    p2.memberSlots.slots[SlotPosition.RIGHT] = null;
    p2.memberSlots.cardStates = new Map([
      [highBladeMemberId!, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
    ]);

    const moveResult = session.executeCommand(
      createMoveMemberToSlotCommand(PLAYER1, tomariCardId!, SlotPosition.LEFT, SlotPosition.RIGHT)
    );

    expect(moveResult.success).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(
      session.state?.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId ===
            SP_BP4_011_ENTER_OR_MOVE_WAIT_OPPONENT_LOW_BLADE_MEMBER_ABILITY_ID &&
          action.payload.step === 'SKIP_NO_TARGET' &&
          action.payload.sourceCardId === tomariCardId &&
          action.payload.sourceSlot === SlotPosition.RIGHT &&
          action.payload.targetPlayerId === PLAYER2
      )
    ).toBe(true);
    expect(
      session.state?.players[1].memberSlots.cardStates.get(highBladeMemberId!)?.orientation
    ).toBe(OrientationState.ACTIVE);
    expect(
      session.state?.eventLog.filter(
        (entry) => entry.event.eventType === TriggerCondition.ON_MEMBER_STATE_CHANGED
      )
    ).toHaveLength(0);
  });

  it('executes PL!N-bp4-018-N when it changes from active to waiting during its own main phase', () => {
    const session = createGameSession();
    const deck = createDeck();

    session.createGame(
      'sample-kanata-bp4-018-state-change',
      PLAYER1,
      'Player 1',
      PLAYER2,
      'Player 2'
    );
    session.initializeGame(deck, deck);
    forceMainPhaseForPlayer(session);

    const kanata = createCardInstance(
      createMemberCard('PL!N-bp4-018-N', '近江彼方', 7),
      PLAYER1,
      'p1-kanata-bp4-018'
    );
    const drawnCard = createCardInstance(
      createMemberCard('STATE-DRAWN-MEMBER', 'Drawn Member', 1),
      PLAYER1,
      'p1-state-drawn'
    );
    const secondDrawnCard = createCardInstance(
      createMemberCard('STATE-SECOND-DRAWN-MEMBER', 'Second Drawn Member', 1),
      PLAYER1,
      'p1-state-second-drawn'
    );
    let state = registerCards(session.state!, [kanata, drawnCard, secondDrawnCard]);
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
    p1.mainDeck.cardIds = [drawnCard.instanceId, secondDrawnCard.instanceId];
    p1.memberSlots.slots[SlotPosition.LEFT] = kanata.instanceId;
    p1.memberSlots.slots[SlotPosition.CENTER] = null;
    p1.memberSlots.slots[SlotPosition.RIGHT] = null;
    p1.memberSlots.cardStates = new Map([
      [kanata.instanceId, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
    ]);
    (session as unknown as { authorityState: GameState }).authorityState = state;

    const tapResult = session.executeCommand(
      createTapMemberCommand(PLAYER1, kanata.instanceId, SlotPosition.LEFT)
    );

    expect(tapResult.success).toBe(true);
    expect(session.state?.eventLog.at(-1)?.event).toMatchObject({
      eventType: TriggerCondition.ON_MEMBER_STATE_CHANGED,
      cardInstanceId: kanata.instanceId,
      previousOrientation: OrientationState.ACTIVE,
      nextOrientation: OrientationState.WAITING,
      cause: { kind: 'PLAYER_ACTION', playerId: PLAYER1 },
    });
    expect(session.state?.activeEffect?.abilityId).toBe(
      N_BP4_018_MAIN_PHASE_ACTIVE_TO_WAITING_DRAW_DISCARD_ABILITY_ID
    );
    expect(session.state?.activeEffect?.selectableCardIds).toEqual([drawnCard.instanceId]);
    expect(session.state?.players[0].hand.cardIds).toEqual([drawnCard.instanceId]);

    const discardResult = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id, drawnCard.instanceId)
    );

    expect(discardResult.success).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].hand.cardIds).toEqual([]);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([drawnCard.instanceId]);

    const resetActiveResult = session.executeCommand(
      createTapMemberCommand(PLAYER1, kanata.instanceId, SlotPosition.LEFT)
    );
    expect(resetActiveResult.success).toBe(true);
    expect(
      session.state?.players[0].memberSlots.cardStates.get(kanata.instanceId)?.orientation
    ).toBe(OrientationState.ACTIVE);

    const secondTapResult = session.executeCommand(
      createTapMemberCommand(PLAYER1, kanata.instanceId, SlotPosition.LEFT)
    );

    expect(secondTapResult.success).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].hand.cardIds).toEqual([]);
    expect(session.state?.players[0].mainDeck.cardIds).toEqual([secondDrawnCard.instanceId]);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([drawnCard.instanceId]);
    expect(
      session.state?.actionHistory.filter(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId ===
            N_BP4_018_MAIN_PHASE_ACTIVE_TO_WAITING_DRAW_DISCARD_ABILITY_ID &&
          action.payload.step === 'ABILITY_USE'
      )
    ).toHaveLength(1);
  });

  it('queues PL!N-bp4-018-N from the direct TAP_MEMBER action path', () => {
    const session = createGameSession();
    const deck = createDeck();

    session.createGame(
      'sample-kanata-bp4-018-state-change-direct-action',
      PLAYER1,
      'Player 1',
      PLAYER2,
      'Player 2'
    );
    session.initializeGame(deck, deck);
    forceMainPhaseForPlayer(session);

    const kanata = createCardInstance(
      createMemberCard('PL!N-bp4-018-N', '近江彼方', 7),
      PLAYER1,
      'p1-kanata-bp4-018-direct'
    );
    const drawnCard = createCardInstance(
      createMemberCard('STATE-DIRECT-DRAWN-MEMBER', 'Direct Drawn Member', 1),
      PLAYER1,
      'p1-state-direct-drawn'
    );
    let state = registerCards(session.state!, [kanata, drawnCard]);
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
    p1.mainDeck.cardIds = [drawnCard.instanceId];
    p1.memberSlots.slots[SlotPosition.LEFT] = kanata.instanceId;
    p1.memberSlots.slots[SlotPosition.CENTER] = null;
    p1.memberSlots.slots[SlotPosition.RIGHT] = null;
    p1.memberSlots.cardStates = new Map([
      [kanata.instanceId, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
    ]);

    const actionResult = new GameService().processAction(
      state,
      createTapMemberAction(PLAYER1, kanata.instanceId, SlotPosition.LEFT)
    );

    expect(actionResult.success).toBe(true);
    expect(actionResult.gameState.activeEffect?.abilityId).toBe(
      N_BP4_018_MAIN_PHASE_ACTIVE_TO_WAITING_DRAW_DISCARD_ABILITY_ID
    );
    expect(actionResult.gameState.activeEffect?.selectableCardIds).toEqual([drawnCard.instanceId]);
    expect(actionResult.gameState.players[0].hand.cardIds).toEqual([drawnCard.instanceId]);
  });

  it('executes PL!-pb1-015-P+ when own card effect waits an opponent active low-cost member', () => {
    const session = createGameSession();
    const deck = createDeck();

    session.createGame(
      'sample-maki-pb1-015-own-effect-state-change',
      PLAYER1,
      'Player 1',
      PLAYER2,
      'Player 2'
    );
    session.initializeGame(deck, deck);
    forceMainPhaseForPlayer(session);

    const maki = createCardInstance(
      createMemberCard('PL!-pb1-015-P＋', '西木野真姫', 7),
      PLAYER1,
      'p1-maki-pb1-015'
    );
    const ginko = createCardInstance(
      createMemberCard('PL!HS-bp6-004-R', '百生 吟子', 13, '莲之空'),
      PLAYER1,
      'p1-ginko-bp6-004'
    );
    const lowCostTarget = createCardInstance(
      createMemberCard('OPP-LOW-COST-MEMBER', 'Opponent Low Cost', 4),
      PLAYER2,
      'p2-low-cost-target'
    );
    const drawnCard = createCardInstance(
      createMemberCard('PB1-015-DRAWN-MEMBER', 'Drawn Member', 1),
      PLAYER1,
      'p1-pb1-015-drawn'
    );
    let state = registerCards(session.state!, [maki, ginko, lowCostTarget, drawnCard]);
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
    const p2 = state.players[1] as unknown as {
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
    removeFromPlayerZones(p2);
    const energyCardIds = [...state.cardRegistry.values()]
      .filter((card) => card.ownerId === PLAYER1 && card.data.cardType === CardType.ENERGY)
      .map((card) => card.instanceId);
    setActiveEnergy(p1, energyCardIds.slice(0, 13));
    p1.hand.cardIds = [ginko.instanceId];
    p1.mainDeck.cardIds = [drawnCard.instanceId];
    p1.memberSlots.slots[SlotPosition.LEFT] = maki.instanceId;
    p1.memberSlots.slots[SlotPosition.CENTER] = null;
    p1.memberSlots.slots[SlotPosition.RIGHT] = null;
    p1.memberSlots.cardStates = new Map([
      [maki.instanceId, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
    ]);
    p2.memberSlots.slots[SlotPosition.LEFT] = lowCostTarget.instanceId;
    p2.memberSlots.slots[SlotPosition.CENTER] = null;
    p2.memberSlots.slots[SlotPosition.RIGHT] = null;
    p2.memberSlots.cardStates = new Map([
      [lowCostTarget.instanceId, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
    ]);
    (session as unknown as { authorityState: GameState }).authorityState = state;

    const playResult = session.executeCommand(
      createPlayMemberToSlotCommand(PLAYER1, ginko.instanceId, SlotPosition.CENTER)
    );

    expect(playResult.success).toBe(true);
    expect(session.state?.activeEffect?.abilityId).toBe(
      HS_BP6_004_ON_ENTER_WAIT_OPPONENT_LOW_COST_MEMBER_ABILITY_ID
    );
    expect(session.state?.activeEffect?.selectableCardIds).toEqual([lowCostTarget.instanceId]);

    const waitResult = session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        session.state!.activeEffect!.id,
        lowCostTarget.instanceId
      )
    );

    expect(waitResult.success).toBe(true);
    expect(
      session.state?.players[1].memberSlots.cardStates.get(lowCostTarget.instanceId)?.orientation
    ).toBe(OrientationState.WAITING);
    expect(session.state?.players[0].hand.cardIds).toEqual([drawnCard.instanceId]);
    expect(
      session.state?.actionHistory.some(
        (action) =>
          action.type === 'TRIGGER_ABILITY' &&
          action.payload.abilityId === PB1_015_OWN_EFFECT_WAIT_OPPONENT_LOW_COST_DRAW_ABILITY_ID &&
          action.payload.changedCardId === lowCostTarget.instanceId
      )
    ).toBe(true);
    expect(
      session.state?.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId === PB1_015_OWN_EFFECT_WAIT_OPPONENT_LOW_COST_DRAW_ABILITY_ID &&
          action.payload.step === 'DRAW_CARD' &&
          Array.isArray(action.payload.drawnCardIds) &&
          action.payload.drawnCardIds[0] === drawnCard.instanceId
      )
    ).toBe(true);
  });

  it('uses ability options for PL!HS-bp6-004-R duplicate live-start effects from one source card', () => {
    const session = createGameSession();
    const deck = createDeck();

    session.createGame(
      'sample-ginko-live-start-ability-options',
      PLAYER1,
      'Player 1',
      PLAYER2,
      'Player 2'
    );
    session.initializeGame(deck, deck);

    const state = session.state!;
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
    const p2 = state.players[1] as unknown as {
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
    const ownedP1CardIds = [...state.cardRegistry.values()]
      .filter((card) => card.ownerId === PLAYER1)
      .map((card) => card.instanceId);
    const ownedP2CardIds = [...state.cardRegistry.values()]
      .filter((card) => card.ownerId === PLAYER2)
      .map((card) => card.instanceId);
    const ginkoCardId = ownedP1CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardCode === 'PL!HS-bp6-004-R'
    );
    const discardCardId = ownedP1CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardCode === 'MEM-1'
    );
    const liveCardId = ownedP1CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardType === CardType.LIVE
    );
    const lowCostMemberId = ownedP2CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardCode === 'MEM-0'
    );

    expect(ginkoCardId).toBeTruthy();
    expect(discardCardId).toBeTruthy();
    expect(liveCardId).toBeTruthy();
    expect(lowCostMemberId).toBeTruthy();

    removeFromPlayerZones(p1);
    removeFromPlayerZones(p2);
    p1.hand.cardIds = [discardCardId!];
    p1.liveZone.cardIds = [liveCardId!];
    p1.liveZone.cardStates = new Map([
      [liveCardId!, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_DOWN }],
    ]);
    p1.memberSlots.slots[SlotPosition.CENTER] = ginkoCardId!;
    p1.memberSlots.cardStates = new Map([
      [ginkoCardId!, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
    ]);
    p2.memberSlots.slots[SlotPosition.LEFT] = lowCostMemberId!;
    p2.memberSlots.cardStates = new Map([
      [lowCostMemberId!, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
    ]);

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
    (session as unknown as { authorityState: GameState }).authorityState = advanceResult.gameState;

    expect(advanceResult.success).toBe(true);
    const liveStartEvent = session.state?.eventLog.find(
      (entry) => entry.event.eventType === TriggerCondition.ON_LIVE_START
    )?.event;
    expect(liveStartEvent).toMatchObject({
      eventType: TriggerCondition.ON_LIVE_START,
      performerId: PLAYER1,
      liveCardIds: [liveCardId],
    });
    expect(session.state?.pendingAbilities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          abilityId: HS_BP6_004_LIVE_START_WAIT_OPPONENT_LOW_COST_MEMBER_ABILITY_ID,
          eventIds: [liveStartEvent?.eventId],
        }),
        expect.objectContaining({
          abilityId: HS_BP6_004_LIVE_START_DISCARD_GAIN_BLADE_ABILITY_ID,
          eventIds: [liveStartEvent?.eventId],
        }),
      ])
    );
    expect(session.state?.activeEffect?.abilityId).toBe(ABILITY_ORDER_SELECTION_ID);
    expect(session.state?.activeEffect?.selectableCardIds).toBeUndefined();
    expect(session.state?.activeEffect?.selectableOptions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: expect.stringContaining(
            HS_BP6_004_LIVE_START_WAIT_OPPONENT_LOW_COST_MEMBER_ABILITY_ID
          ),
        }),
        expect.objectContaining({
          id: expect.stringContaining(HS_BP6_004_LIVE_START_DISCARD_GAIN_BLADE_ABILITY_ID),
        }),
      ])
    );

    const waitOptionId = session.state!.activeEffect!.selectableOptions!.find((option) =>
      option.id.includes(HS_BP6_004_LIVE_START_WAIT_OPPONENT_LOW_COST_MEMBER_ABILITY_ID)
    )!.id;
    const chooseWaitResult = session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        session.state!.activeEffect!.id,
        undefined,
        null,
        undefined,
        waitOptionId
      )
    );

    expect(chooseWaitResult.success).toBe(true);
    expect(session.state?.activeEffect?.abilityId).toBe(
      HS_BP6_004_LIVE_START_WAIT_OPPONENT_LOW_COST_MEMBER_ABILITY_ID
    );
    expect(session.state?.activeEffect?.selectableCardIds).toEqual([lowCostMemberId]);

    const waitResult = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id, lowCostMemberId)
    );

    expect(waitResult.success).toBe(true);
    expect(
      session.state?.players[1].memberSlots.cardStates.get(lowCostMemberId!)?.orientation
    ).toBe(OrientationState.WAITING);
    expect(
      session.state?.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId ===
            HS_BP6_004_LIVE_START_WAIT_OPPONENT_LOW_COST_MEMBER_ABILITY_ID &&
          action.payload.sourceCardId === ginkoCardId &&
          action.payload.step === 'WAIT_OPPONENT_MEMBER' &&
          action.payload.sourceSlot === SlotPosition.CENTER &&
          action.payload.targetPlayerId === PLAYER2 &&
          action.payload.targetCardId === lowCostMemberId &&
          action.payload.previousOrientation === OrientationState.ACTIVE &&
          action.payload.nextOrientation === OrientationState.WAITING
      )
    ).toBe(true);
    expect(
      session.state?.eventLog
        .map((entry) => entry.event)
        .filter(
          (event) =>
            event.eventType === TriggerCondition.ON_MEMBER_STATE_CHANGED &&
            event.cardInstanceId === lowCostMemberId &&
            event.controllerId === PLAYER2 &&
            event.slot === SlotPosition.LEFT &&
            event.previousOrientation === OrientationState.ACTIVE &&
            event.nextOrientation === OrientationState.WAITING
        )
    ).toHaveLength(1);
    expect(session.state?.activeEffect?.abilityId).toBe(
      HS_BP6_004_LIVE_START_DISCARD_GAIN_BLADE_ABILITY_ID
    );
  });

  it('gives PL!HS-bp6-004-R two blade when discarding a Ginko member at live start', () => {
    const session = createGameSession();
    const deck = createDeck();

    session.createGame(
      'sample-ginko-live-start-discard-ginko',
      PLAYER1,
      'Player 1',
      PLAYER2,
      'Player 2'
    );
    session.initializeGame(deck, deck);

    const state = session.state!;
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
    const p2 = state.players[1] as unknown as {
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
    const ownedP1CardIds = [...state.cardRegistry.values()]
      .filter((card) => card.ownerId === PLAYER1)
      .map((card) => card.instanceId);
    const ginkoCardId = ownedP1CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardCode === 'PL!HS-bp6-004-R'
    );
    const discardGinkoCardId = ownedP1CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardCode === 'PL!HS-bp6-004-P'
    );
    const liveCardId = ownedP1CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardType === CardType.LIVE
    );

    expect(ginkoCardId).toBeTruthy();
    expect(discardGinkoCardId).toBeTruthy();
    expect(liveCardId).toBeTruthy();

    removeFromPlayerZones(p1);
    removeFromPlayerZones(p2);
    p1.hand.cardIds = [discardGinkoCardId!];
    p1.liveZone.cardIds = [liveCardId!];
    p1.liveZone.cardStates = new Map([
      [liveCardId!, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_DOWN }],
    ]);
    p1.memberSlots.slots[SlotPosition.CENTER] = ginkoCardId!;
    p1.memberSlots.cardStates = new Map([
      [ginkoCardId!, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
    ]);
    p2.memberSlots.slots[SlotPosition.LEFT] = null;
    p2.memberSlots.slots[SlotPosition.CENTER] = null;
    p2.memberSlots.slots[SlotPosition.RIGHT] = null;
    p2.memberSlots.cardStates = new Map();

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
    (session as unknown as { authorityState: GameState }).authorityState = advanceResult.gameState;

    expect(advanceResult.success).toBe(true);
    expect(session.state?.activeEffect?.abilityId).toBe(ABILITY_ORDER_SELECTION_ID);

    const discardOptionId = session.state!.activeEffect!.selectableOptions!.find((option) =>
      option.id.includes(HS_BP6_004_LIVE_START_DISCARD_GAIN_BLADE_ABILITY_ID)
    )!.id;
    const chooseDiscardResult = session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        session.state!.activeEffect!.id,
        undefined,
        null,
        undefined,
        discardOptionId
      )
    );

    expect(chooseDiscardResult.success).toBe(true);
    expect(session.state?.activeEffect?.abilityId).toBe(
      HS_BP6_004_LIVE_START_DISCARD_GAIN_BLADE_ABILITY_ID
    );
    expect(session.state?.activeEffect?.selectableCardIds).toEqual([discardGinkoCardId]);

    const discardResult = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id, discardGinkoCardId)
    );

    expect(discardResult.success).toBe(true);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([discardGinkoCardId]);
    expect(session.state?.liveResolution.liveModifiers).toContainEqual({
      kind: 'BLADE',
      playerId: PLAYER1,
      countDelta: 2,
      sourceCardId: ginkoCardId,
      abilityId: HS_BP6_004_LIVE_START_DISCARD_GAIN_BLADE_ABILITY_ID,
    });
    expect(
      session.state?.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId === HS_BP6_004_LIVE_START_DISCARD_GAIN_BLADE_ABILITY_ID &&
          action.payload.sourceCardId === ginkoCardId &&
          action.payload.step === 'DISCARD_HAND_CARD_GAIN_BLADE' &&
          action.payload.discardedWasGinko === true &&
          action.payload.bladeBonus === 2
      )
    ).toBe(true);
  });

  it('lets PL!HS-bp5-003 discard a hand card and grant pink Heart only to same-group member targets', () => {
    const session = createGameSession();
    const deck = createDeck();

    session.createGame('sample-rurino-live-start-same-group-heart', PLAYER1, 'Player 1', PLAYER2, 'Player 2');
    session.initializeGame(deck, deck);

    const state = session.state!;
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
    const p2 = state.players[1] as unknown as {
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
    const ownedP1CardIds = [...state.cardRegistry.values()]
      .filter((card) => card.ownerId === PLAYER1)
      .map((card) => card.instanceId);
    const ownedP2CardIds = [...state.cardRegistry.values()]
      .filter((card) => card.ownerId === PLAYER2)
      .map((card) => card.instanceId);
    const rurinoCardId = ownedP1CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardCode === 'PL!HS-bp5-003-AR'
    );
    const discardHasuCardId = ownedP1CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardCode === 'MEM-HASU-0'
    );
    const targetHasuCardId = ownedP1CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardCode === 'MEM-HASU-1'
    );
    const mismatchLiellaCardId = ownedP2CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardCode === 'PL!SP-bp4-011-P'
    );
    const liveCardId = ownedP1CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardType === CardType.LIVE
    );

    expect(rurinoCardId).toBeTruthy();
    expect(discardHasuCardId).toBeTruthy();
    expect(targetHasuCardId).toBeTruthy();
    expect(mismatchLiellaCardId).toBeTruthy();
    expect(liveCardId).toBeTruthy();

    removeFromPlayerZones(p1);
    removeFromPlayerZones(p2);
    p1.hand.cardIds = [discardHasuCardId!];
    p1.liveZone.cardIds = [liveCardId!];
    p1.liveZone.cardStates = new Map([
      [liveCardId!, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_DOWN }],
    ]);
    p1.memberSlots.slots[SlotPosition.LEFT] = targetHasuCardId!;
    p1.memberSlots.slots[SlotPosition.CENTER] = rurinoCardId!;
    p1.memberSlots.slots[SlotPosition.RIGHT] = null;
    p1.memberSlots.cardStates = new Map([
      [targetHasuCardId!, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
      [rurinoCardId!, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
    ]);
    p2.memberSlots.slots[SlotPosition.LEFT] = mismatchLiellaCardId!;
    p2.memberSlots.slots[SlotPosition.CENTER] = null;
    p2.memberSlots.slots[SlotPosition.RIGHT] = null;
    p2.memberSlots.cardStates = new Map([
      [mismatchLiellaCardId!, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
    ]);

    advanceToLiveStartEffects(session);

    expect(session.state?.activeEffect?.abilityId).toBe(
      HS_BP5_003_LIVE_START_DISCARD_SAME_GROUP_MEMBER_HEART_ABILITY_ID
    );
    expect(session.state?.activeEffect?.selectableCardIds).toEqual([discardHasuCardId]);

    const discardResult = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id, discardHasuCardId)
    );

    expect(discardResult.success).toBe(true);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([discardHasuCardId]);
    expect(session.state?.activeEffect?.selectableCardIds).toEqual([
      targetHasuCardId,
      rurinoCardId,
    ]);
    expect(session.state?.activeEffect?.selectableCardIds).not.toContain(mismatchLiellaCardId);

    const targetResult = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id, targetHasuCardId)
    );

    expect(targetResult.success).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.liveResolution.playerHeartBonuses.has(PLAYER1)).toBe(false);
    expect(session.state?.liveResolution.liveModifiers).toContainEqual({
      kind: 'HEART',
      target: 'TARGET_MEMBER',
      playerId: PLAYER1,
      targetMemberCardId: targetHasuCardId,
      hearts: [{ color: HeartColor.PINK, count: 1 }],
      sourceCardId: rurinoCardId,
      abilityId: HS_BP5_003_LIVE_START_DISCARD_SAME_GROUP_MEMBER_HEART_ABILITY_ID,
    });
  });

  it('uses card identity fallback when PL!HS-bp5-003 discards Dreamin so target Heart affects live judgment', () => {
    const session = createGameSession();
    const deck = createDeck();

    session.createGame(
      'sample-rurino-live-start-card-code-group-heart-judgment',
      PLAYER1,
      'Player 1',
      PLAYER2,
      'Player 2'
    );
    session.initializeGame(deck, deck);

    const state = session.state!;
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
    const p2 = state.players[1] as unknown as {
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
    const ownedP1CardIds = [...state.cardRegistry.values()]
      .filter((card) => card.ownerId === PLAYER1)
      .map((card) => card.instanceId);
    const rurinoCardId = ownedP1CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardCode === 'PL!HS-bp5-003-AR'
    );
    const discardDreaminCardId = ownedP1CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardCode === 'PL!-bp6-022-L'
    );
    const targetMuseCardId = ownedP1CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardCode === 'PL!-bp5-005-AR'
    );
    const liveCardId = ownedP1CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardCode === 'LIVE-0'
    );

    expect(rurinoCardId).toBeTruthy();
    expect(discardDreaminCardId).toBeTruthy();
    expect(targetMuseCardId).toBeTruthy();
    expect(liveCardId).toBeTruthy();

    const rurinoCard = state.cardRegistry.get(rurinoCardId!) as unknown as {
      data: MemberCardData;
    };
    const discardDreaminCard = state.cardRegistry.get(discardDreaminCardId!) as unknown as {
      data: LiveCardData;
    };
    const targetMuseCard = state.cardRegistry.get(targetMuseCardId!) as unknown as {
      data: MemberCardData;
    };
    const liveCard = state.cardRegistry.get(liveCardId!) as unknown as { data: LiveCardData };
    rurinoCard.data = {
      ...rurinoCard.data,
      blade: 0,
      hearts: [],
    };
    discardDreaminCard.data = {
      ...discardDreaminCard.data,
      groupName: undefined,
    };
    targetMuseCard.data = {
      ...targetMuseCard.data,
      groupName: undefined,
      blade: 0,
      hearts: [createHeartIcon(HeartColor.PINK, 1)],
    };
    liveCard.data = {
      ...liveCard.data,
      cardCode: 'RURINO-REGRESSION-LIVE',
      name: 'Rurino Regression Live',
      score: 1,
      requirements: createHeartRequirement({ [HeartColor.PINK]: 2 }),
    };

    removeFromPlayerZones(p1);
    removeFromPlayerZones(p2);
    p1.hand.cardIds = [discardDreaminCardId!];
    p1.liveZone.cardIds = [liveCardId!];
    p1.liveZone.cardStates = new Map([
      [liveCardId!, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_DOWN }],
    ]);
    p1.memberSlots.slots[SlotPosition.LEFT] = targetMuseCardId!;
    p1.memberSlots.slots[SlotPosition.CENTER] = rurinoCardId!;
    p1.memberSlots.slots[SlotPosition.RIGHT] = null;
    p1.memberSlots.cardStates = new Map([
      [targetMuseCardId!, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
      [rurinoCardId!, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
    ]);
    p2.memberSlots.slots[SlotPosition.LEFT] = null;
    p2.memberSlots.slots[SlotPosition.CENTER] = null;
    p2.memberSlots.slots[SlotPosition.RIGHT] = null;
    p2.memberSlots.cardStates = new Map();

    advanceToLiveStartEffects(session);

    expect(session.state?.activeEffect?.abilityId).toBe(
      HS_BP5_003_LIVE_START_DISCARD_SAME_GROUP_MEMBER_HEART_ABILITY_ID
    );
    expect(session.state?.activeEffect?.selectableCardIds).toEqual([discardDreaminCardId]);

    const discardResult = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id, discardDreaminCardId)
    );

    expect(discardResult.success).toBe(true);
    expect(session.state?.activeEffect?.selectableCardIds).toEqual([targetMuseCardId]);

    const targetResult = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id, targetMuseCardId)
    );

    expect(targetResult.success).toBe(true);
    expect(session.state?.liveResolution.liveModifiers).toContainEqual({
      kind: 'HEART',
      target: 'TARGET_MEMBER',
      playerId: PLAYER1,
      targetMemberCardId: targetMuseCardId,
      hearts: [{ color: HeartColor.PINK, count: 1 }],
      sourceCardId: rurinoCardId,
      abilityId: HS_BP5_003_LIVE_START_DISCARD_SAME_GROUP_MEMBER_HEART_ABILITY_ID,
    });

    const confirmLiveStartResult = session.executeCommand(
      createConfirmStepCommand(PLAYER1, SubPhase.PERFORMANCE_LIVE_START_EFFECTS)
    );

    expect(confirmLiveStartResult.success).toBe(true);
    expect(session.state?.currentSubPhase).toBe(SubPhase.PERFORMANCE_JUDGMENT);

    const judgmentResult = session.executeCommand(
      createSubmitJudgmentCommand(PLAYER1, new Map())
    );

    expect(judgmentResult.success).toBe(true);
    expect(session.state?.liveResolution.liveResults.get(liveCardId!)).toBe(true);
    expect(session.state?.liveResolution.playerScores.get(PLAYER1)).toBe(1);
  });

  it('safely finishes PL!HS-bp5-003 live-start effect when the discarded group has no stage target', () => {
    const session = createGameSession();
    const deck = createDeck();

    session.createGame('sample-rurino-live-start-no-same-group-target', PLAYER1, 'Player 1', PLAYER2, 'Player 2');
    session.initializeGame(deck, deck);

    const state = session.state!;
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
    const p2 = state.players[1] as unknown as {
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
    const ownedP1CardIds = [...state.cardRegistry.values()]
      .filter((card) => card.ownerId === PLAYER1)
      .map((card) => card.instanceId);
    const rurinoCardId = ownedP1CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardCode === 'PL!HS-bp5-003-AR'
    );
    const discardLiellaCardId = ownedP1CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardCode === 'PL!SP-bp4-011-P'
    );
    const liveCardId = ownedP1CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardType === CardType.LIVE
    );

    expect(rurinoCardId).toBeTruthy();
    expect(discardLiellaCardId).toBeTruthy();
    expect(liveCardId).toBeTruthy();

    removeFromPlayerZones(p1);
    removeFromPlayerZones(p2);
    p1.hand.cardIds = [discardLiellaCardId!];
    p1.liveZone.cardIds = [liveCardId!];
    p1.liveZone.cardStates = new Map([
      [liveCardId!, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_DOWN }],
    ]);
    p1.memberSlots.slots[SlotPosition.LEFT] = null;
    p1.memberSlots.slots[SlotPosition.CENTER] = rurinoCardId!;
    p1.memberSlots.slots[SlotPosition.RIGHT] = null;
    p1.memberSlots.cardStates = new Map([
      [rurinoCardId!, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
    ]);
    p2.memberSlots.slots[SlotPosition.LEFT] = null;
    p2.memberSlots.slots[SlotPosition.CENTER] = null;
    p2.memberSlots.slots[SlotPosition.RIGHT] = null;
    p2.memberSlots.cardStates = new Map();

    advanceToLiveStartEffects(session);

    expect(session.state?.activeEffect?.abilityId).toBe(
      HS_BP5_003_LIVE_START_DISCARD_SAME_GROUP_MEMBER_HEART_ABILITY_ID
    );

    const discardResult = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id, discardLiellaCardId)
    );

    expect(discardResult.success).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.liveResolution.liveModifiers).toEqual([]);
    expect(
      session.state?.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId ===
            HS_BP5_003_LIVE_START_DISCARD_SAME_GROUP_MEMBER_HEART_ABILITY_ID &&
          action.payload.step === 'DISCARD_HAND_CARD_NO_SAME_GROUP_TARGET'
      )
    ).toBe(true);
  });

  it('does not open an illegal PL!HS-bp5-003 live-start discard choice with no hand', () => {
    const session = createGameSession();
    const deck = createDeck();

    session.createGame('sample-rurino-live-start-no-hand', PLAYER1, 'Player 1', PLAYER2, 'Player 2');
    session.initializeGame(deck, deck);

    const state = session.state!;
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
    const p2 = state.players[1] as unknown as {
      hand: { cardIds: string[] };
      mainDeck: { cardIds: string[] };
      waitingRoom: { cardIds: string[] };
      successZone: { cardIds: string[] };
      liveZone: { cardIds: string[] };
    };
    const ownedP1CardIds = [...state.cardRegistry.values()]
      .filter((card) => card.ownerId === PLAYER1)
      .map((card) => card.instanceId);
    const rurinoCardId = ownedP1CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardCode === 'PL!HS-bp5-003-AR'
    );
    const liveCardId = ownedP1CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardType === CardType.LIVE
    );

    expect(rurinoCardId).toBeTruthy();
    expect(liveCardId).toBeTruthy();

    removeFromPlayerZones(p1);
    removeFromPlayerZones(p2);
    p1.hand.cardIds = [];
    p1.liveZone.cardIds = [liveCardId!];
    p1.liveZone.cardStates = new Map([
      [liveCardId!, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_DOWN }],
    ]);
    p1.memberSlots.slots[SlotPosition.CENTER] = rurinoCardId!;
    p1.memberSlots.cardStates = new Map([
      [rurinoCardId!, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
    ]);

    advanceToLiveStartEffects(session);

    expect(session.state?.activeEffect).toBeNull();
    expect(
      session.state?.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId ===
            HS_BP5_003_LIVE_START_DISCARD_SAME_GROUP_MEMBER_HEART_ABILITY_ID &&
          action.payload.step === 'NO_HAND_TO_DISCARD'
      )
    ).toBe(true);
  });

  it('executes PL!HS-bp6-017-N leave-stage AUTO to discard then recover one live and one member', () => {
    const session = createGameSession();
    const deck = createDeck();

    session.createGame('sample-kaho-leave-stage-auto', PLAYER1, 'Player 1', PLAYER2, 'Player 2');
    session.initializeGame(deck, deck);
    forceMainPhaseForPlayer(session);

    const state = session.state!;
    const ownedP1CardIds = [...state.cardRegistry.values()]
      .filter((card) => card.ownerId === PLAYER1)
      .map((card) => card.instanceId);
    const kahoCardId = ownedP1CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardCode === 'PL!HS-bp6-017-N'
    );
    const discardCardId = ownedP1CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardCode === 'MEM-0'
    );
    const targetMemberCardId = ownedP1CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardCode === 'MEM-1'
    );
    const targetLiveCardId = ownedP1CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardCode === 'LIVE-0'
    );
    const secondLiveCardId = ownedP1CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardCode === 'LIVE-1'
    );

    expect(kahoCardId).toBeTruthy();
    expect(discardCardId).toBeTruthy();
    expect(targetMemberCardId).toBeTruthy();
    expect(targetLiveCardId).toBeTruthy();
    expect(secondLiveCardId).toBeTruthy();

    const preparedState = updatePlayer(state, PLAYER1, (player) => ({
      ...player,
      hand: { ...player.hand, cardIds: [discardCardId!] },
      mainDeck: { ...player.mainDeck, cardIds: [] },
      waitingRoom: { ...player.waitingRoom, cardIds: [] },
      successZone: { ...player.successZone, cardIds: [] },
      liveZone: { ...player.liveZone, cardIds: [] },
      memberSlots: {
        ...player.memberSlots,
        slots: {
          [SlotPosition.LEFT]: null,
          [SlotPosition.CENTER]: kahoCardId!,
          [SlotPosition.RIGHT]: null,
        },
        cardStates: new Map([
          [kahoCardId!, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
        ]),
      },
    }));
    (session as unknown as { authorityState: GameState }).authorityState = preparedState;

    const moveResult = session.executeCommand(
      createMovePublicCardToWaitingRoomCommand(
        PLAYER1,
        kahoCardId!,
        ZoneType.MEMBER_SLOT,
        SlotPosition.CENTER
      )
    );

    expect(moveResult.success).toBe(true);
    expect(session.state?.activeEffect?.abilityId).toBe(
      HS_BP6_017_LEAVE_STAGE_RECOVER_LIVE_AND_MEMBER_ABILITY_ID
    );
    expect(session.state?.activeEffect?.selectableCardIds).toEqual([discardCardId]);

    const stateWithRecoveryTargets = updatePlayer(session.state!, PLAYER1, (player) => ({
      ...player,
      waitingRoom: {
        ...player.waitingRoom,
        cardIds: [targetLiveCardId!, targetMemberCardId!, secondLiveCardId!, kahoCardId!],
      },
    }));
    (session as unknown as { authorityState: GameState }).authorityState = stateWithRecoveryTargets;

    const discardResult = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id, discardCardId)
    );

    expect(discardResult.success).toBe(true);
    expect(session.state?.activeEffect?.abilityId).toBe(
      HS_BP6_017_LEAVE_STAGE_RECOVER_LIVE_AND_MEMBER_ABILITY_ID
    );
    expect(session.state?.activeEffect?.selectableCardMode).toBe('ORDERED_MULTI');
    expect(session.state?.activeEffect?.maxSelectableCards).toBe(2);
    expect(session.state?.activeEffect?.selectableCardIds).toEqual([
      targetLiveCardId,
      targetMemberCardId,
      secondLiveCardId,
      kahoCardId,
      discardCardId,
    ]);

    const invalidRecoverResult = session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        session.state!.activeEffect!.id,
        undefined,
        undefined,
        undefined,
        undefined,
        [targetLiveCardId!, secondLiveCardId!]
      )
    );

    expect(invalidRecoverResult.success).toBe(false);
    expect(session.state?.activeEffect?.abilityId).toBe(
      HS_BP6_017_LEAVE_STAGE_RECOVER_LIVE_AND_MEMBER_ABILITY_ID
    );
    expect(session.state?.players[0].hand.cardIds).toEqual([]);

    const recoverResult = session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        session.state!.activeEffect!.id,
        undefined,
        undefined,
        undefined,
        undefined,
        [targetLiveCardId!, targetMemberCardId!]
      )
    );

    expect(recoverResult.success).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].hand.cardIds).toEqual([targetLiveCardId, targetMemberCardId]);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([
      secondLiveCardId,
      kahoCardId,
      discardCardId,
    ]);
  });

  it('lets PL!HS-bp6-017-N leave-stage AUTO resolve without discarding', () => {
    const session = createGameSession();
    const deck = createDeck();

    session.createGame(
      'sample-kaho-leave-stage-auto-decline',
      PLAYER1,
      'Player 1',
      PLAYER2,
      'Player 2'
    );
    session.initializeGame(deck, deck);
    forceMainPhaseForPlayer(session);

    const state = session.state!;
    const ownedP1CardIds = [...state.cardRegistry.values()]
      .filter((card) => card.ownerId === PLAYER1)
      .map((card) => card.instanceId);
    const kahoCardId = ownedP1CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardCode === 'PL!HS-bp6-017-N'
    );
    const discardCardId = ownedP1CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardCode === 'MEM-0'
    );

    expect(kahoCardId).toBeTruthy();
    expect(discardCardId).toBeTruthy();

    const preparedState = updatePlayer(state, PLAYER1, (player) => ({
      ...player,
      hand: { ...player.hand, cardIds: [discardCardId!] },
      waitingRoom: { ...player.waitingRoom, cardIds: [] },
      successZone: { ...player.successZone, cardIds: [] },
      liveZone: { ...player.liveZone, cardIds: [] },
      memberSlots: {
        ...player.memberSlots,
        slots: {
          [SlotPosition.LEFT]: null,
          [SlotPosition.CENTER]: kahoCardId!,
          [SlotPosition.RIGHT]: null,
        },
        cardStates: new Map([
          [kahoCardId!, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
        ]),
      },
    }));
    (session as unknown as { authorityState: GameState }).authorityState = preparedState;

    const moveResult = session.executeCommand(
      createMovePublicCardToWaitingRoomCommand(
        PLAYER1,
        kahoCardId!,
        ZoneType.MEMBER_SLOT,
        SlotPosition.CENTER
      )
    );

    expect(moveResult.success).toBe(true);
    expect(session.state?.activeEffect?.abilityId).toBe(
      HS_BP6_017_LEAVE_STAGE_RECOVER_LIVE_AND_MEMBER_ABILITY_ID
    );

    const skipResult = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id, null)
    );

    expect(skipResult.success).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].hand.cardIds).toEqual([discardCardId]);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([kahoCardId]);
  });

  it('opens a skippable PL!HS-bp6-017-N leave-stage AUTO even when hand is empty', () => {
    const session = createGameSession();
    const deck = createDeck();

    session.createGame(
      'sample-kaho-leave-stage-auto-empty-hand-skip',
      PLAYER1,
      'Player 1',
      PLAYER2,
      'Player 2'
    );
    session.initializeGame(deck, deck);
    forceMainPhaseForPlayer(session);

    const state = session.state!;
    const ownedP1CardIds = [...state.cardRegistry.values()]
      .filter((card) => card.ownerId === PLAYER1)
      .map((card) => card.instanceId);
    const kahoCardId = ownedP1CardIds.find(
      (cardId) => state.cardRegistry.get(cardId)?.data.cardCode === 'PL!HS-bp6-017-N'
    );

    expect(kahoCardId).toBeTruthy();

    const preparedState = updatePlayer(state, PLAYER1, (player) => ({
      ...player,
      hand: { ...player.hand, cardIds: [] },
      waitingRoom: { ...player.waitingRoom, cardIds: [] },
      successZone: { ...player.successZone, cardIds: [] },
      liveZone: { ...player.liveZone, cardIds: [] },
      memberSlots: {
        ...player.memberSlots,
        slots: {
          [SlotPosition.LEFT]: null,
          [SlotPosition.CENTER]: kahoCardId!,
          [SlotPosition.RIGHT]: null,
        },
        cardStates: new Map([
          [kahoCardId!, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
        ]),
      },
    }));
    (session as unknown as { authorityState: GameState }).authorityState = preparedState;

    const moveResult = session.executeCommand(
      createMovePublicCardToWaitingRoomCommand(
        PLAYER1,
        kahoCardId!,
        ZoneType.MEMBER_SLOT,
        SlotPosition.CENTER
      )
    );

    expect(moveResult.success).toBe(true);
    expect(session.state?.activeEffect?.abilityId).toBe(
      HS_BP6_017_LEAVE_STAGE_RECOVER_LIVE_AND_MEMBER_ABILITY_ID
    );
    expect(session.state?.activeEffect?.selectableCardIds).toEqual([]);
    expect(session.state?.activeEffect?.canSkipSelection).toBe(true);

    const skipResult = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id, null)
    );

    expect(skipResult.success).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].hand.cardIds).toEqual([]);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([kahoCardId]);
  });

  it('executes PL!HS-pb1-012-R on-enter recycle, recovers a Live, and gains Blade', () => {
    const {
      session,
      ginko,
      ownMembers,
      opponentMembers,
      ownDeckFiller,
      opponentDeckFiller,
      liveTarget,
    } = setupHsPb1012OnEnterScenario({
      ownMemberCount: 12,
      opponentMemberCount: 8,
      includeLiveTarget: true,
    });

    expect(liveTarget).not.toBeNull();
    expect(session.state?.activeEffect?.abilityId).toBe(
      HS_PB1_012_ON_ENTER_RECYCLE_MEMBERS_RECOVER_LIVE_GAIN_BLADE_ABILITY_ID
    );
    expect(session.state?.activeEffect?.selectableOptions).toEqual([
      { id: 'continue', label: '继续处理' },
    ]);

    const recycleResult = session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        session.state!.activeEffect!.id,
        undefined,
        undefined,
        undefined,
        'continue'
      )
    );

    expect(recycleResult.success).toBe(true);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([liveTarget!.instanceId]);
    expect(session.state?.players[1].waitingRoom.cardIds).toEqual([]);
    expect(new Set(session.state?.players[0].mainDeck.cardIds)).toEqual(
      new Set([ownDeckFiller.instanceId, ...ownMembers.map((card) => card.instanceId)])
    );
    expect(new Set(session.state?.players[1].mainDeck.cardIds)).toEqual(
      new Set([opponentDeckFiller.instanceId, ...opponentMembers.map((card) => card.instanceId)])
    );
    expect(session.state?.activeEffect?.stepId).toBe('HS_PB1_012_SELECT_WAITING_ROOM_LIVE');
    expect(session.state?.activeEffect?.selectableCardIds).toEqual([liveTarget!.instanceId]);

    const recoverResult = session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        session.state!.activeEffect!.id,
        liveTarget!.instanceId
      )
    );

    expect(recoverResult.success).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].hand.cardIds).toEqual([liveTarget!.instanceId]);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([]);
    expect(session.state?.liveResolution.liveModifiers).toContainEqual({
      kind: 'BLADE',
      playerId: PLAYER1,
      countDelta: 2,
      sourceCardId: ginko.instanceId,
      abilityId: HS_PB1_012_ON_ENTER_RECYCLE_MEMBERS_RECOVER_LIVE_GAIN_BLADE_ABILITY_ID,
    });
    expect(getMemberEffectiveBladeCount(session.state!, PLAYER1, ginko.instanceId)).toBe(5);
  });

  it('grants PL!HS-pb1-012-R Blade even when no waiting-room Live can be recovered', () => {
    const { session, ginko, ownMembers, opponentMembers, ownDeckFiller, opponentDeckFiller } =
      setupHsPb1012OnEnterScenario({
        ownMemberCount: 10,
        opponentMemberCount: 10,
        includeLiveTarget: false,
      });

    const recycleResult = session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        session.state!.activeEffect!.id,
        undefined,
        undefined,
        undefined,
        'continue'
      )
    );

    expect(recycleResult.success).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].hand.cardIds).toEqual([]);
    expect(new Set(session.state?.players[0].mainDeck.cardIds)).toEqual(
      new Set([ownDeckFiller.instanceId, ...ownMembers.map((card) => card.instanceId)])
    );
    expect(new Set(session.state?.players[1].mainDeck.cardIds)).toEqual(
      new Set([opponentDeckFiller.instanceId, ...opponentMembers.map((card) => card.instanceId)])
    );
    expect(session.state?.liveResolution.liveModifiers).toContainEqual({
      kind: 'BLADE',
      playerId: PLAYER1,
      countDelta: 2,
      sourceCardId: ginko.instanceId,
      abilityId: HS_PB1_012_ON_ENTER_RECYCLE_MEMBERS_RECOVER_LIVE_GAIN_BLADE_ABILITY_ID,
    });
  });

  it('recycles PL!HS-pb1-012-R waiting-room members without recovery or Blade below twenty total cards', () => {
    const { session, ownMembers, opponentMembers, ownDeckFiller, opponentDeckFiller, liveTarget } =
      setupHsPb1012OnEnterScenario({
        ownMemberCount: 10,
        opponentMemberCount: 9,
        includeLiveTarget: true,
      });

    const recycleResult = session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        session.state!.activeEffect!.id,
        undefined,
        undefined,
        undefined,
        'continue'
      )
    );

    expect(recycleResult.success).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].hand.cardIds).toEqual([]);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([liveTarget!.instanceId]);
    expect(new Set(session.state?.players[0].mainDeck.cardIds)).toEqual(
      new Set([ownDeckFiller.instanceId, ...ownMembers.map((card) => card.instanceId)])
    );
    expect(new Set(session.state?.players[1].mainDeck.cardIds)).toEqual(
      new Set([opponentDeckFiller.instanceId, ...opponentMembers.map((card) => card.instanceId)])
    );
    expect(
      session.state?.liveResolution.liveModifiers.some(
        (modifier) =>
          modifier.kind === 'BLADE' &&
          modifier.abilityId ===
            HS_PB1_012_ON_ENTER_RECYCLE_MEMBERS_RECOVER_LIVE_GAIN_BLADE_ABILITY_ID
      )
    ).toBe(false);
  });

  it('executes PL!HS-bp6-031-L live-start recycle and grants Blade to selected Hime', () => {
    const session = createGameSession();
    const deck = createDeck();

    session.createGame(
      'sample-hs-bp6-031-live-start-recycle-blade',
      PLAYER1,
      'Player 1',
      PLAYER2,
      'Player 2'
    );
    session.initializeGame(deck, deck);

    const fanfareLive = createCardInstance(
      createLiveCard('PL!HS-bp6-031-L', 'ファンファーレ！！！', '蓮ノ空'),
      PLAYER1,
      'p1-fanfare-live'
    );
    const hime = createCardInstance(
      {
        ...createMemberCard('PL!HS-test-hime', '安養寺 姫芽', 4, '蓮ノ空'),
        unitName: 'みらくらぱーく！',
      },
      PLAYER1,
      'p1-hime'
    );
    const miraCraMembers = Array.from({ length: 15 }, (_, index) =>
      createCardInstance(
        {
          ...createMemberCard(
            `PL!HS-test-miracra-${index}`,
            `みらくらぱーく！ ${index}`,
            1,
            '蓮ノ空'
          ),
          unitName: 'みらくらぱーく！',
        },
        PLAYER1,
        `p1-miracra-${index}`
      )
    );
    const waitingLive = createCardInstance(
      createLiveCard('PL!HS-test-waiting-live', 'Waiting Live', '蓮ノ空'),
      PLAYER1,
      'p1-waiting-live'
    );
    const deckFiller = createCardInstance(
      createLiveCard('PL!HS-test-deck-filler-live', 'Deck Filler', '蓮ノ空'),
      PLAYER1,
      'p1-deck-filler-live'
    );

    const registeredState = registerCards(session.state!, [
      fanfareLive,
      hime,
      waitingLive,
      deckFiller,
      ...miraCraMembers,
    ]);
    const preparedState = updatePlayer(registeredState, PLAYER1, (player) => ({
      ...player,
      hand: { ...player.hand, cardIds: [] },
      mainDeck: { ...player.mainDeck, cardIds: [deckFiller.instanceId] },
      waitingRoom: {
        ...player.waitingRoom,
        cardIds: [...miraCraMembers.map((card) => card.instanceId), waitingLive.instanceId],
      },
      successZone: { ...player.successZone, cardIds: [] },
      liveZone: {
        ...player.liveZone,
        cardIds: [fanfareLive.instanceId],
        cardStates: new Map([
          [
            fanfareLive.instanceId,
            { orientation: OrientationState.ACTIVE, face: FaceState.FACE_DOWN },
          ],
        ]),
      },
      memberSlots: {
        ...player.memberSlots,
        slots: {
          [SlotPosition.LEFT]: null,
          [SlotPosition.CENTER]: hime.instanceId,
          [SlotPosition.RIGHT]: null,
        },
        cardStates: new Map([
          [hime.instanceId, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
        ]),
      },
    }));
    (session as unknown as { authorityState: GameState }).authorityState = preparedState;

    advanceToLiveStartEffects(session);

    expect(session.state?.activeEffect?.abilityId).toBe(
      HS_BP6_031_LIVE_START_RECYCLE_MIRACRA_MEMBERS_GAIN_BLADE_ABILITY_ID
    );
    expect(session.state?.activeEffect?.selectableOptions).toEqual([
      { id: 'activate', label: '发动' },
      { id: 'decline', label: '不发动' },
    ]);

    const recycleResult = session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        session.state!.activeEffect!.id,
        undefined,
        undefined,
        undefined,
        'activate'
      )
    );

    expect(recycleResult.success).toBe(true);
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([waitingLive.instanceId]);
    expect(new Set(session.state?.players[0].mainDeck.cardIds)).toEqual(
      new Set([deckFiller.instanceId, ...miraCraMembers.map((card) => card.instanceId)])
    );
    expect(session.state?.activeEffect?.stepId).toBe('HS_BP6_031_SELECT_HIME_BLADE_TARGET');
    expect(session.state?.activeEffect?.selectableCardIds).toEqual([hime.instanceId]);

    const targetResult = session.executeCommand(
      createConfirmEffectStepCommand(PLAYER1, session.state!.activeEffect!.id, hime.instanceId)
    );

    expect(targetResult.success).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.liveResolution.liveModifiers).toContainEqual({
      kind: 'BLADE',
      playerId: PLAYER1,
      countDelta: 3,
      sourceCardId: hime.instanceId,
      abilityId: HS_BP6_031_LIVE_START_RECYCLE_MIRACRA_MEMBERS_GAIN_BLADE_ABILITY_ID,
    });
    expect(getMemberEffectiveBladeCount(session.state!, PLAYER1, hime.instanceId)).toBe(4);
  });

  it('recycles PL!HS-bp6-031-L waiting-room members without Blade when Mira-Cra count is below fifteen', () => {
    const session = createGameSession();
    const deck = createDeck();

    session.createGame(
      'sample-hs-bp6-031-live-start-recycle-no-blade',
      PLAYER1,
      'Player 1',
      PLAYER2,
      'Player 2'
    );
    session.initializeGame(deck, deck);

    const fanfareLive = createCardInstance(
      createLiveCard('PL!HS-bp6-031-L', 'ファンファーレ！！！', '蓮ノ空'),
      PLAYER1,
      'p1-fanfare-live-low-count'
    );
    const hime = createCardInstance(
      {
        ...createMemberCard('PL!HS-test-hime-low-count', '安養寺 姫芽', 4, '蓮ノ空'),
        unitName: 'みらくらぱーく！',
      },
      PLAYER1,
      'p1-hime-low-count'
    );
    const miraCraMembers = Array.from({ length: 14 }, (_, index) =>
      createCardInstance(
        {
          ...createMemberCard(
            `PL!HS-test-miracra-low-${index}`,
            `みらくらぱーく！ ${index}`,
            1,
            '蓮ノ空'
          ),
          unitName: 'みらくらぱーく！',
        },
        PLAYER1,
        `p1-miracra-low-${index}`
      )
    );
    const deckFiller = createCardInstance(
      createLiveCard('PL!HS-test-deck-filler-live-low-count', 'Deck Filler', '蓮ノ空'),
      PLAYER1,
      'p1-deck-filler-live-low-count'
    );

    const registeredState = registerCards(session.state!, [
      fanfareLive,
      hime,
      deckFiller,
      ...miraCraMembers,
    ]);
    const preparedState = updatePlayer(registeredState, PLAYER1, (player) => ({
      ...player,
      hand: { ...player.hand, cardIds: [] },
      mainDeck: { ...player.mainDeck, cardIds: [deckFiller.instanceId] },
      waitingRoom: {
        ...player.waitingRoom,
        cardIds: miraCraMembers.map((card) => card.instanceId),
      },
      successZone: { ...player.successZone, cardIds: [] },
      liveZone: {
        ...player.liveZone,
        cardIds: [fanfareLive.instanceId],
        cardStates: new Map([
          [
            fanfareLive.instanceId,
            { orientation: OrientationState.ACTIVE, face: FaceState.FACE_DOWN },
          ],
        ]),
      },
      memberSlots: {
        ...player.memberSlots,
        slots: {
          [SlotPosition.LEFT]: null,
          [SlotPosition.CENTER]: hime.instanceId,
          [SlotPosition.RIGHT]: null,
        },
        cardStates: new Map([
          [hime.instanceId, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
        ]),
      },
    }));
    (session as unknown as { authorityState: GameState }).authorityState = preparedState;

    advanceToLiveStartEffects(session);

    const recycleResult = session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        session.state!.activeEffect!.id,
        undefined,
        undefined,
        undefined,
        'activate'
      )
    );

    expect(recycleResult.success).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.players[0].waitingRoom.cardIds).toEqual([]);
    expect(new Set(session.state?.players[0].mainDeck.cardIds)).toEqual(
      new Set([deckFiller.instanceId, ...miraCraMembers.map((card) => card.instanceId)])
    );
    expect(
      session.state?.liveResolution.liveModifiers.some(
        (modifier) =>
          modifier.kind === 'BLADE' &&
          modifier.abilityId === HS_BP6_031_LIVE_START_RECYCLE_MIRACRA_MEMBERS_GAIN_BLADE_ABILITY_ID
      )
    ).toBe(false);
  });
});
