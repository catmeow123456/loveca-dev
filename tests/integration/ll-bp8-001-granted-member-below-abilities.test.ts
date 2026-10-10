import { describe, expect, it } from 'vitest';
import {
  BP4_010_LIVE_START_PAY_ENERGY_GAIN_BLADE_ABILITY_ID as ENERGY_BLADE,
  BP6_021_LIVE_SUCCESS_SEND_MUSE_MEMBER_SCORE_RECOVER_MUSE_LIVE_ABILITY_ID as RUSH,
  BP5_009_ACTIVATED_DISCARD_TWO_RECOVER_PURPLE_REQUIREMENT_LIVE_ABILITY_ID as PURPLE_LIVE,
  N_BP1_005_LIVE_START_DISCARD_GAIN_ONE_BLADE_ABILITY_ID as DISCARD_BLADE,
  N_SD1_005_ACTIVATED_DISCARD_TWO_RECOVER_NIJIGASAKI_MEMBER_ABILITY_ID as NIJI_MEMBER,
  N_SD2_005_LIVE_START_DISCARD_GAIN_HEART_ABILITY_ID as DISCARD_HEART,
  N_SD2_017_LIVE_START_PAY_ENERGY_ACTIVATE_STAGE_MEMBER_ABILITY_ID as ACTIVATE_MEMBER,
  NICO_LIVE_START_SCORE_ABILITY_ID as MUSE_SCORE,
  PB1_019_ACTIVATED_ABILITY_ID as RECOVER_MEMBER,
  PL_BP3_009_ACTIVATED_WAIT_SELF_CHOOSE_HEART_ABILITY_ID as WAIT_HEART,
  PL_N_BP3_005_LIVE_START_TWO_MEMBER_ENTRIES_GAIN_SCORE_ABILITY_ID as ENTRY_SCORE,
  PL_N_BP3_017_023_LIVE_START_WAIT_SELF_OPPONENT_COST_LTE_FOUR_WAIT_ABILITY_ID as AI_WAIT,
  PL_PB2_018_LIVE_START_DISCARD_THREE_DIFFERENT_BIBI_WAIT_OPPONENT_ABILITY_ID as BIBI_WAIT,
  PL_PR_007_009_LIVE_START_WAIT_SELF_OPPONENT_COST_LTE_FOUR_WAIT_ABILITY_ID as NICO_WAIT,
  PR_017_ACTIVATED_RECOVER_MUSE_LIVE_ACTIVATE_ENERGY_ABILITY_ID as MUSE_LIVE,
} from '../../src/application/card-effects/ability-ids';
import {
  enqueueTriggeredCardEffects,
  getActivatedAbilityUiConfigs,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import { getGrantedMemberBelowAbilityDefinitions } from '../../src/application/card-effects/runtime/granted-member-below-abilities';
import { sendStageMemberToWaitingRoomAndEnqueueLeaveStageTriggers } from '../../src/application/card-effects/runtime/leave-stage-triggers';
import { gameService } from '../../src/application/game-service';
import { getAbilityTurnLimitStatus } from '../../src/application/card-effects/runtime/ability-turn-limit';
import {
  createActivateAbilityCommand,
  createConfirmEffectChoiceCommand,
  createConfirmEffectStepCommand,
  createSubmitJudgmentCommand,
} from '../../src/application/game-commands';
import { createGameSession, type GameSession } from '../../src/application/game-session';
import {
  createCardInstance,
  createHeartIcon,
  createHeartRequirement,
  type CardInstance,
  type MemberCardData,
} from '../../src/domain/entities/card';
import {
  emitGameEvent,
  registerCards,
  updatePlayer,
  type GameState,
} from '../../src/domain/entities/game';
import {
  addCardToStatefulZone,
  addMemberBelowMember,
  placeCardInSlot,
  removeCardFromSlot,
} from '../../src/domain/entities/zone';
import {
  createEnterStageEvent,
  createLeaveStageEvent,
  createLiveStartEvent,
  createLiveSuccessEvent,
  createTurnStartEvent,
} from '../../src/domain/events/game-events';
import { GAME_STATE_SCHEMA_VERSION } from '../../src/server/services/replay-constants';
import {
  rehydrateAuthorityGameState,
  serializeReplayPayload,
} from '../../src/server/services/replay-payload-serialization';
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
import { confirmPublicSelectionIfNeeded } from '../helpers/public-card-selection-confirmation';

const P1 = 'player1';
const P2 = 'player2';
const HOST = 'host';
const BELOW = 'below';
const HAND = ['hand-nico', 'hand-eli', 'hand-maki'];
const TARGET = 'waiting-member';
const LIVE = 'waiting-live';
const OWN_WAITING = 'own-waiting';
const OPPONENT = 'opponent';

interface AbilityCase {
  readonly abilityId: string;
  readonly code: string;
  readonly name: string;
  readonly cost: number;
  readonly timing: 'ACTIVATED' | 'LIVE_START';
}
const CASES: readonly AbilityCase[] = [
  { abilityId: MUSE_LIVE, code: 'PL!-PR-017-PR', name: '矢澤にこ', cost: 2, timing: 'ACTIVATED' },
  { abilityId: WAIT_HEART, code: 'PL!-bp3-009-P', name: '矢澤にこ', cost: 2, timing: 'ACTIVATED' },
  {
    abilityId: PURPLE_LIVE,
    code: 'PL!-bp5-009-P',
    name: '矢澤にこ',
    cost: 15,
    timing: 'ACTIVATED',
  },
  {
    abilityId: RECOVER_MEMBER,
    code: 'PL!-pb2-027-N',
    name: '矢澤にこ',
    cost: 2,
    timing: 'ACTIVATED',
  },
  {
    abilityId: NIJI_MEMBER,
    code: 'PL!N-sd1-005-SD',
    name: '宮下愛',
    cost: 11,
    timing: 'ACTIVATED',
  },
  { abilityId: NICO_WAIT, code: 'PL!-PR-009-PR', name: '矢澤にこ', cost: 4, timing: 'LIVE_START' },
  { abilityId: AI_WAIT, code: 'PL!N-bp3-017-N', name: '宮下愛', cost: 4, timing: 'LIVE_START' },
  {
    abilityId: BIBI_WAIT,
    code: 'PL!-pb2-018-P+',
    name: '矢澤にこ',
    cost: 17,
    timing: 'LIVE_START',
  },
  {
    abilityId: MUSE_SCORE,
    code: 'PL!-sd1-009-SD',
    name: '矢澤にこ',
    cost: 15,
    timing: 'LIVE_START',
  },
  {
    abilityId: ENERGY_BLADE,
    code: 'PL!HS-PR-022-PR',
    name: 'セラス 柳田 リリエンフェルト',
    cost: 4,
    timing: 'LIVE_START',
  },
  {
    abilityId: DISCARD_BLADE,
    code: 'PL!N-bp1-005-P',
    name: '宮下愛',
    cost: 4,
    timing: 'LIVE_START',
  },
  {
    abilityId: ENTRY_SCORE,
    code: 'PL!N-bp3-005-P',
    name: '宮下愛',
    cost: 15,
    timing: 'LIVE_START',
  },
  {
    abilityId: DISCARD_HEART,
    code: 'PL!N-sd2-005-SD2',
    name: '宮下愛',
    cost: 13,
    timing: 'LIVE_START',
  },
  {
    abilityId: ACTIVATE_MEMBER,
    code: 'PL!N-sd2-017-SD2',
    name: '宮下愛',
    cost: 4,
    timing: 'LIVE_START',
  },
];
function cardCase(id: string): AbilityCase {
  return CASES.find((entry) => entry.abilityId === id)!;
}
function member(
  code: string,
  id: string,
  name = id,
  owner = P1,
  cost = 4,
  group = "μ's",
  unitName?: string
): CardInstance<MemberCardData> {
  return createCardInstance(
    {
      cardCode: code,
      name,
      groupNames: [group],
      ...(unitName ? { unitName } : {}),
      cardType: CardType.MEMBER,
      cost,
      blade: 1,
      hearts: [createHeartIcon(HeartColor.YELLOW, 1)],
    },
    owner,
    id
  );
}
function setState(session: GameSession, game: GameState): void {
  (session as unknown as { authorityState: GameState }).authorityState = game;
}
function roundtrip(game: GameState): GameState {
  return rehydrateAuthorityGameState(
    serializeReplayPayload(game, 'AUTHORITY_GAME_STATE', GAME_STATE_SCHEMA_VERSION)
  );
}
function setup(entry: AbilityCase, direct = false, copies = 1, rarity = 'R＋'): GameSession {
  const session = createGameSession();
  session.createGame(`ll-grant:${entry.abilityId}`, P1, 'P1', P2, 'P2');
  const host = direct
    ? member(
        entry.code,
        HOST,
        entry.name,
        P1,
        entry.cost,
        entry.name === '宮下愛' ? '虹ヶ咲' : entry.name === '矢澤にこ' ? "μ's" : '蓮ノ空',
        entry.name === '矢澤にこ' ? 'BiBi' : undefined
      )
    : member(`LL-bp8-001-${rarity}`, HOST, '矢澤にこ&宮下愛&セラス 柳田 リリエンフェルト', P1, 15);
  const below = Array.from({ length: copies }, (_, index) =>
    member(entry.code, index === 0 ? BELOW : `${BELOW}-${index}`, entry.name, P1, entry.cost)
  );
  const waiting = member('TEST-MEMBER', TARGET, '天王寺璃奈', P1, 2, '虹ヶ咲');
  const ownWaiting = member('TEST-OWN', OWN_WAITING, '高坂穂乃果', P1, 2, "μ's", 'BiBi');
  const opponent = member('TEST-OPPONENT', OPPONENT, '渡辺曜', P2, 4);
  const hand = [
    member('TEST-NICO', HAND[0]!, '矢澤にこ', P1, 2, "μ's", 'BiBi'),
    member('TEST-ELI', HAND[1]!, '絢瀬絵里', P1, 2, "μ's", 'BiBi'),
    member('TEST-MAKI', HAND[2]!, '西木野真姫', P1, 2, "μ's", 'BiBi'),
  ];
  const live = createCardInstance(
    {
      cardCode: 'TEST-LIVE',
      name: 'LIVE',
      cardType: CardType.LIVE,
      groupNames: ["μ's", '虹ヶ咲'],
      score: 9,
      requirements: createHeartRequirement({ [HeartColor.PURPLE]: 3 }),
    },
    P1,
    LIVE
  );
  const success = createCardInstance(
    { ...live.data, cardCode: 'TEST-SUCCESS' },
    P1,
    'success-live'
  );
  const energies = Array.from({ length: 4 }, (_, index) =>
    createCardInstance(
      { cardCode: `E-${index}`, name: 'Energy', cardType: CardType.ENERGY },
      P1,
      `energy-${index}`
    )
  );
  const waitingMuse = Array.from({ length: 25 }, (_, index) =>
    member('TEST-MUSE', `muse-${index}`)
  );
  const deck = Array.from({ length: 10 }, (_, index) => member('TEST-DECK', `deck-${index}`));
  let game = registerCards(session.state!, [
    host,
    ...below,
    waiting,
    ownWaiting,
    opponent,
    ...hand,
    live,
    success,
    ...energies,
    ...waitingMuse,
    ...deck,
  ]);
  game = updatePlayer(game, P1, (player) => {
    let slots = placeCardInSlot(player.memberSlots, SlotPosition.CENTER, HOST, {
      orientation: OrientationState.ACTIVE,
      face: FaceState.FACE_UP,
    });
    // The LL host has no BiBi unit. Its inherited BiBi cost is still legal.
    if (entry.abilityId !== BIBI_WAIT)
      slots = placeCardInSlot(slots, SlotPosition.LEFT, OWN_WAITING, {
        orientation: OrientationState.WAITING,
        face: FaceState.FACE_UP,
      });
    if (!direct)
      for (const card of below)
        slots = addMemberBelowMember(slots, SlotPosition.CENTER, card.instanceId);
    return {
      ...player,
      memberSlots: slots,
      hand: { ...player.hand, cardIds: HAND },
      waitingRoom: {
        ...player.waitingRoom,
        cardIds: [TARGET, LIVE, ...waitingMuse.map((card) => card.instanceId)],
      },
      successZone: { ...player.successZone, cardIds: ['success-live'] },
      mainDeck: { ...player.mainDeck, cardIds: deck.map((card) => card.instanceId) },
      energyZone: energies.reduce(
        (zone, energy, index) =>
          addCardToStatefulZone(zone, energy.instanceId, {
            orientation: index < 2 ? OrientationState.ACTIVE : OrientationState.WAITING,
            face: FaceState.FACE_UP,
          }),
        player.energyZone
      ),
    };
  });
  game = updatePlayer(game, P2, (player) => ({
    ...player,
    memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, OPPONENT, {
      orientation: OrientationState.ACTIVE,
      face: FaceState.FACE_UP,
    }),
  }));
  game = {
    ...game,
    currentPhase: GamePhase.MAIN_PHASE,
    currentSubPhase: SubPhase.NONE,
    currentTurnType: TurnType.FIRST_PLAYER_TURN,
    activePlayerIndex: 0,
    waitingPlayerId: null,
  };
  game = emitGameEvent(game, createTurnStartEvent(game.turnCount, P1));
  game = emitGameEvent(
    game,
    createEnterStageEvent(HOST, ZoneType.HAND, SlotPosition.CENTER, P1, P1)
  );
  game = emitGameEvent(
    game,
    createEnterStageEvent(OWN_WAITING, ZoneType.HAND, SlotPosition.LEFT, P1, P1)
  );
  setState(session, game);
  return session;
}
function granted(session: GameSession, abilityId: string, belowId = BELOW) {
  return getGrantedMemberBelowAbilityDefinitions(session.state!, P1, HOST).find(
    (copy) => copy.definition.abilityId === abilityId && copy.grantingMemberBelowCardId === belowId
  )!;
}
function confirm(
  session: GameSession,
  options: {
    card?: string;
    cards?: readonly string[];
    option?: string;
    effects?: readonly string[];
    inOrder?: boolean;
  } = {}
): void {
  const effect = session.state!.activeEffect!;
  expect(effect, 'active effect').toBeTruthy();
  const command = options.effects
    ? createConfirmEffectChoiceCommand(P1, effect.id, { selectedEffectOptionIds: options.effects })
    : createConfirmEffectStepCommand(
        P1,
        effect.id,
        options.card,
        undefined,
        options.inOrder,
        options.option,
        options.cards
      );
  const result = session.executeCommand(command);
  expect(result.success, `${effect.stepId}: ${result.error ?? ''}`).toBe(true);
  confirmPublicSelectionIfNeeded(session);
}
function enqueue(session: GameSession): void {
  const event = createLiveStartEvent(P1, []);
  setState(
    session,
    enqueueTriggeredCardEffects(
      emitGameEvent(session.state!, event),
      [TriggerCondition.ON_LIVE_START],
      { liveStartEvents: [event] }
    )
  );
}
function start(session: GameSession, entry: AbilityCase, direct = false): void {
  if (entry.timing === 'ACTIVATED') {
    const result = session.executeCommand(
      createActivateAbilityCommand(
        P1,
        HOST,
        entry.abilityId,
        direct ? undefined : granted(session, entry.abilityId).abilityInstanceId
      )
    );
    expect(result.success, result.error).toBe(true);
  } else {
    enqueue(session);
    expect(
      session.state!.pendingAbilities.filter((pending) => pending.abilityId === entry.abilityId)
    ).toHaveLength(1);
    setState(session, resolvePendingCardEffects(session.state!).gameState);
    if (session.state!.activeEffect?.metadata?.confirmOnlyPendingAbility) confirm(session);
  }
}
function complete(session: GameSession, entry: AbilityCase): void {
  switch (entry.abilityId) {
    case MUSE_LIVE:
      confirm(session, { card: LIVE });
      break;
    case RECOVER_MEMBER:
      confirm(session, { card: TARGET });
      break;
    case WAIT_HEART:
      confirm(session, { effects: ['PINK'] });
      break;
    case PURPLE_LIVE:
      confirm(session, { cards: HAND.slice(0, 2) });
      confirm(session, { card: LIVE });
      break;
    case NIJI_MEMBER:
      confirm(session, { cards: HAND.slice(0, 2) });
      confirm(session, { card: TARGET });
      break;
    case NICO_WAIT:
    case AI_WAIT:
      confirm(session, { option: 'activate' });
      confirm(session, { card: OPPONENT });
      break;
    case BIBI_WAIT:
      confirm(session, { cards: HAND });
      if (session.state!.activeEffect) confirm(session, { card: OPPONENT });
      break;
    case ENERGY_BLADE:
      confirm(session, { option: 'pay' });
      break;
    case DISCARD_BLADE:
      confirm(session, { card: HAND[0] });
      break;
    case ACTIVATE_MEMBER:
      confirm(session, { option: 'pay' });
      confirm(session, { card: OWN_WAITING });
      break;
    case DISCARD_HEART:
      confirm(session, { cards: HAND.slice(0, 2) });
      confirm(session, { option: HeartColor.PINK });
      break;
    case ENTRY_SCORE:
    case MUSE_SCORE:
      if (session.state!.activeEffect) confirm(session);
      break;
  }
  expect(session.state!.activeEffect).toBeNull();
  expect(session.state!.pendingAbilities).toEqual([]);
}
function assertOutcome(session: GameSession, entry: AbilityCase, direct = false): void {
  const game = session.state!;
  const player = game.players[0];
  const modifier = (kind: string) =>
    game.liveResolution.liveModifiers.find(
      (item) =>
        item.kind === kind && item.abilityId === entry.abilityId && item.sourceCardId === HOST
    );
  switch (entry.abilityId) {
    case MUSE_LIVE:
      expect(player.hand.cardIds).toContain(LIVE);
      expect(player.waitingRoom.cardIds).toContain(HOST);
      expect(
        ['energy-2', 'energy-3'].map((id) => player.energyZone.cardStates.get(id)?.orientation)
      ).toEqual([OrientationState.ACTIVE, OrientationState.ACTIVE]);
      break;
    case RECOVER_MEMBER:
      expect(player.hand.cardIds).toContain(TARGET);
      expect(player.waitingRoom.cardIds).toContain(HOST);
      break;
    case WAIT_HEART:
      expect(player.memberSlots.cardStates.get(HOST)?.orientation).toBe(OrientationState.WAITING);
      expect(modifier('HEART')).toMatchObject({
        target: 'SOURCE_MEMBER',
        hearts: [{ color: HeartColor.PINK, count: 1 }],
      });
      break;
    case NIJI_MEMBER:
    case PURPLE_LIVE:
      expect(player.waitingRoom.cardIds).toEqual(expect.arrayContaining(HAND.slice(0, 2)));
      expect(player.hand.cardIds).toContain(entry.abilityId === NIJI_MEMBER ? TARGET : LIVE);
      break;
    case NICO_WAIT:
    case AI_WAIT:
      expect(player.memberSlots.cardStates.get(HOST)?.orientation).toBe(OrientationState.WAITING);
      expect(game.players[1].memberSlots.cardStates.get(OPPONENT)?.orientation).toBe(
        OrientationState.WAITING
      );
      break;
    case BIBI_WAIT:
      expect(player.waitingRoom.cardIds).toEqual(expect.arrayContaining(HAND));
      expect(game.players[1].memberSlots.cardStates.get(OPPONENT)?.orientation).toBe(
        direct ? OrientationState.WAITING : OrientationState.ACTIVE
      );
      break;
    case ENERGY_BLADE:
      expect(player.energyZone.cardStates.get('energy-0')?.orientation).toBe(
        OrientationState.WAITING
      );
      expect(modifier('BLADE')).toMatchObject({ target: 'SOURCE_MEMBER', countDelta: 2 });
      break;
    case DISCARD_BLADE:
      expect(player.waitingRoom.cardIds).toContain(HAND[0]);
      expect(modifier('BLADE')).toMatchObject({ target: 'SOURCE_MEMBER', countDelta: 1 });
      break;
    case MUSE_SCORE:
    case ENTRY_SCORE:
      expect(modifier('SCORE')).toMatchObject({
        targetMemberCardId: HOST,
        playerId: P1,
        countDelta: 1,
      });
      break;
    case DISCARD_HEART:
      expect(player.waitingRoom.cardIds).toEqual(expect.arrayContaining(HAND.slice(0, 2)));
      expect(modifier('HEART')).toMatchObject({
        target: 'SOURCE_MEMBER',
        hearts: [{ color: HeartColor.PINK, count: 2 }],
      });
      break;
    case ACTIVATE_MEMBER:
      expect(player.energyZone.cardStates.get('energy-0')?.orientation).toBe(
        OrientationState.WAITING
      );
      expect(player.memberSlots.cardStates.get(OWN_WAITING)?.orientation).toBe(
        OrientationState.ACTIVE
      );
      break;
  }
}
function removeBelow(session: GameSession): void {
  setState(
    session,
    updatePlayer(session.state!, P1, (player) => ({
      ...player,
      memberSlots: {
        ...player.memberSlots,
        memberBelow: { ...player.memberSlots.memberBelow, [SlotPosition.CENTER]: [] },
      },
      waitingRoom: {
        ...player.waitingRoom,
        cardIds: [
          ...player.waitingRoom.cardIds,
          ...(player.memberSlots.memberBelow[SlotPosition.CENTER] ?? []),
        ],
      },
    }))
  );
}
function leaveHost(session: GameSession, reenter: boolean): void {
  let game = updatePlayer(session.state!, P1, (player) => ({
    ...player,
    memberSlots: removeCardFromSlot(player.memberSlots, SlotPosition.CENTER),
    waitingRoom: { ...player.waitingRoom, cardIds: [...player.waitingRoom.cardIds, HOST] },
  }));
  game = emitGameEvent(
    game,
    createLeaveStageEvent(HOST, SlotPosition.CENTER, ZoneType.WAITING_ROOM, P1, P1)
  );
  if (reenter) {
    game = updatePlayer(game, P1, (player) => ({
      ...player,
      memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, HOST, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      }),
      waitingRoom: {
        ...player.waitingRoom,
        cardIds: player.waitingRoom.cardIds.filter((id) => id !== HOST),
      },
    }));
    game = emitGameEvent(
      game,
      createEnterStageEvent(HOST, ZoneType.WAITING_ROOM, SlotPosition.CENTER, P1, P1)
    );
  }
  setState(session, game);
}

describe('LL-bp8-001 费用15「矢泽日香（矢泽妮可）&宫下爱&赛拉丝·柳田·利林费尔德」完整继承', () => {
  it.each(CASES)('$code 费用$cost「$name」：旧卡与宿主经真实入口完成能力', (entry) => {
    for (const direct of [false, true]) {
      const session = setup(entry, direct);
      start(session, entry, direct);
      complete(session, entry);
      assertOutcome(session, entry, direct);
    }
  });
  it('完整池为14唯一能力；三个成员别名、组合名与其他罕度都支持，排除AUTO和常时', () => {
    const session = setup(cardCase(ENTRY_SCORE), false, 0, 'SEC');
    const cards = CASES.map((entry, index) => member(entry.code, `grant-${index}`, entry.name));
    const other = member('PL!SP-bp5-020-N', 'not-granted', '鬼塚夏美');
    let game = registerCards(session.state!, [...cards, other]);
    game = updatePlayer(game, P1, (player) => ({
      ...player,
      memberSlots: [...cards, other].reduce(
        (slots, card) => addMemberBelowMember(slots, SlotPosition.CENTER, card.instanceId),
        player.memberSlots
      ),
    }));
    const grants = getGrantedMemberBelowAbilityDefinitions(game, P1, HOST);
    expect(new Set(grants.map((copy) => copy.definition.abilityId))).toEqual(
      new Set(CASES.map((entry) => entry.abilityId))
    );
    expect(grants).toHaveLength(14);
    expect(
      getActivatedAbilityUiConfigs(`LL-bp8-001-SEC`, undefined, {
        game,
        playerId: P1,
        sourceCardId: HOST,
      })
    ).toHaveLength(5);
  });
  it.each(['PL!HS-sd1-015-SD', 'PL!N-bp4-017-N'])('%s共享回收成员起动也能完整结算', (code) => {
    const entry = {
      ...cardCase(RECOVER_MEMBER),
      code,
      name: code.includes('HS') ? 'セラス 柳田 リリエンフェルト' : '宮下愛',
    };
    const session = setup(entry);
    start(session, entry);
    complete(session, entry);
    assertOutcome(session, entry);
  });
  it('起动授予移除即时失去；伪造实例与缺省实例不能借用', () => {
    const entry = cardCase(WAIT_HEART);
    const session = setup(entry);
    const instance = granted(session, entry.abilityId).abilityInstanceId;
    expect(
      session.executeCommand(createActivateAbilityCommand(P1, HOST, entry.abilityId)).success
    ).toBe(false);
    expect(
      session.executeCommand(
        createActivateAbilityCommand(P1, HOST, entry.abilityId, `${instance}-fake`)
      ).success
    ).toBe(false);
    removeBelow(session);
    expect(
      session.executeCommand(createActivateAbilityCommand(P1, HOST, entry.abilityId, instance))
        .success
    ).toBe(false);
  });
  it.each(CASES.filter((entry) => entry.timing === 'LIVE_START'))(
    '$code：授予触发后移除仍完成原pending，触发前移除不入队',
    (entry) => {
      const session = setup(entry);
      enqueue(session);
      const pending = session.state!.pendingAbilities[0]!;
      expect(pending.sourceCardId).toBe(HOST);
      expect(pending.abilityInstanceId).toBeTruthy();
      expect(pending.sourceLifecycleId).toBeTruthy();
      removeBelow(session);
      setState(session, resolvePendingCardEffects(roundtrip(session.state!)).gameState);
      if (session.state!.activeEffect?.metadata?.confirmOnlyPendingAbility) confirm(session);
      complete(session, entry);
      assertOutcome(session, entry);
      const before = setup(entry);
      removeBelow(before);
      enqueue(before);
      expect(before.state!.pendingAbilities).toEqual([]);
    }
  );
  it('两份相同LIVE开始能力各自入队可选择顺序，当前格式恢复保留身份并叠加2分', () => {
    const session = setup(cardCase(ENTRY_SCORE), false, 2);
    enqueue(session);
    const pending = session.state!.pendingAbilities;
    expect(pending).toHaveLength(2);
    expect(new Set(pending.map((copy) => copy.id)).size).toBe(2);
    expect(new Set(pending.map((copy) => copy.abilityInstanceId)).size).toBe(2);
    setState(session, resolvePendingCardEffects(roundtrip(session.state!)).gameState);
    expect(session.state!.activeEffect?.abilityId).toBe('system:select-pending-card-effect');
    confirm(session, { option: pending[1]!.id });
    if (session.state!.activeEffect?.metadata?.confirmOnlyPendingAbility) confirm(session);
    // The second copy remains independently pending after the selected copy resolves.
    while (session.state!.activeEffect) confirm(session);
    const modifiers = session.state!.liveResolution.liveModifiers.filter(
      (modifier) => modifier.kind === 'SCORE' && modifier.abilityId === ENTRY_SCORE
    );
    expect(modifiers).toHaveLength(2);
    expect(
      new Set(
        modifiers.map((modifier) =>
          'abilityInstanceId' in modifier ? modifier.abilityInstanceId : undefined
        )
      ).size
    ).toBe(2);
    expect(
      modifiers.reduce(
        (sum, modifier) => sum + (modifier.kind === 'SCORE' ? modifier.countDelta : 0),
        0
      )
    ).toBe(2);
    expect(roundtrip(session.state!).liveResolution.liveModifiers).toEqual(
      session.state!.liveResolution.liveModifiers
    );
  });
  it.each([false, true])(
    '已触发pending后宿主离场/重登场(%s)，仍支付玩家费用而自身奖励不转移',
    (reenter) => {
      for (const abilityId of [ENERGY_BLADE, DISCARD_BLADE, DISCARD_HEART]) {
        const entry = cardCase(abilityId);
        const session = setup(entry);
        enqueue(session);
        leaveHost(session, reenter);
        setState(session, resolvePendingCardEffects(session.state!).gameState);
        if (session.state!.activeEffect?.metadata?.confirmOnlyPendingAbility) confirm(session);
        if (abilityId === ENERGY_BLADE) confirm(session, { option: 'pay' });
        if (abilityId === DISCARD_BLADE) confirm(session, { card: HAND[0] });
        if (abilityId === DISCARD_HEART) {
          confirm(session, { cards: HAND.slice(0, 2) });
          confirm(session, { option: HeartColor.PINK });
        }
        const player = session.state!.players[0];
        if (abilityId === ENERGY_BLADE) {
          expect(player.energyZone.cardStates.get('energy-0')?.orientation).toBe(
            OrientationState.WAITING
          );
          expect(
            session
              .state!.actionHistory.filter(
                (action) =>
                  action.type === 'RESOLVE_ABILITY' &&
                  action.payload.step === 'PAY_ENERGY_GAIN_BLADE'
              )
              .at(-1)?.payload
          ).toMatchObject({ bladeBonus: 0, requestedBladeBonus: 2 });
        } else
          expect(player.waitingRoom.cardIds).toEqual(
            expect.arrayContaining(
              abilityId === DISCARD_HEART ? HAND.slice(0, 2) : HAND.slice(0, 1)
            )
          );
        expect(
          session.state!.liveResolution.liveModifiers.filter(
            (modifier) => modifier.abilityId === abilityId
          )
        ).toEqual([]);
        expect(session.state!.activeEffect).toBeNull();
      }
    }
  );
  it('旧pending不能横置或授予分数给重新登场宿主，其他成员奖励仍可完成', () => {
    for (const abilityId of [NICO_WAIT, ENTRY_SCORE, MUSE_SCORE, ACTIVATE_MEMBER]) {
      const entry = cardCase(abilityId);
      const session = setup(entry);
      enqueue(session);
      leaveHost(session, true);
      setState(session, resolvePendingCardEffects(session.state!).gameState);
      if (session.state!.activeEffect?.metadata?.confirmOnlyPendingAbility) confirm(session);
      if (abilityId === ACTIVATE_MEMBER) {
        confirm(session, { option: 'pay' });
        confirm(session, { card: OWN_WAITING });
      }
      if (session.state!.activeEffect) confirm(session);
      expect(session.state!.players[0].memberSlots.cardStates.get(HOST)?.orientation).toBe(
        OrientationState.ACTIVE
      );
      if (abilityId === ACTIVATE_MEMBER) assertOutcome(session, entry);
      else if (abilityId === ENTRY_SCORE || abilityId === MUSE_SCORE)
        expect(
          session.state!.liveResolution.liveModifiers.filter(
            (modifier) => modifier.abilityId === abilityId
          )
        ).toEqual([]);
      else
        expect(session.state!.players[1].memberSlots.cardStates.get(OPPONENT)?.orientation).toBe(
          OrientationState.ACTIVE
        );
    }
  });
  it.each([
    [WAIT_HEART, '矢泽日香（矢泽妮可）'],
    [ENTRY_SCORE, '宫下爱＆天王寺璃奈'],
    [ENERGY_BLADE, '赛拉丝·柳田·利林费尔德'],
  ])('指定成员中文别名和组合名%s/%s可授予，名称相似的未指定成员不授予', (abilityId, name) => {
    const entry = { ...cardCase(abilityId!), name: name! };
    const session = setup(entry);
    expect(granted(session, abilityId!)).toBeTruthy();
    const unrelated = member(entry.code, 'unrelated-name', '宫下爱子');
    const foreign = member(entry.code, 'foreign', entry.name, P2);
    let game = registerCards(session.state!, [unrelated, foreign]);
    game = updatePlayer(game, P1, (player) => ({
      ...player,
      memberSlots: {
        ...player.memberSlots,
        memberBelow: {
          ...player.memberSlots.memberBelow,
          [SlotPosition.CENTER]: [unrelated.instanceId, foreign.instanceId],
        },
      },
    }));
    expect(getGrantedMemberBelowAbilityDefinitions(game, P1, HOST)).toEqual([]);
  });
  it.each(
    CASES.filter(
      (entry) =>
        entry.timing === 'LIVE_START' &&
        entry.abilityId !== ENTRY_SCORE &&
        entry.abilityId !== MUSE_SCORE
    )
  )('$code：不发动不支付任何费用，仍正确消费继承pending', (entry) => {
    const session = setup(entry);
    start(session, entry);
    confirm(session);
    expect(session.state!.activeEffect).toBeNull();
    expect(session.state!.pendingAbilities).toEqual([]);
    expect(session.state!.players[0].hand.cardIds).toEqual(HAND);
    expect(session.state!.players[0].energyZone.cardStates.get('energy-0')?.orientation).toBe(
      OrientationState.ACTIVE
    );
    expect(session.state!.players[0].memberSlots.cardStates.get(HOST)?.orientation).toBe(
      OrientationState.ACTIVE
    );
    expect(session.state!.liveResolution.liveModifiers).toEqual([]);
  });
  it.each([MUSE_LIVE, PURPLE_LIVE, NIJI_MEMBER])(
    '%s没有后续回收目标时，合法起动及费用仍成立',
    (abilityId) => {
      const entry = cardCase(abilityId);
      const session = setup(entry);
      setState(
        session,
        updatePlayer(session.state!, P1, (player) => ({
          ...player,
          waitingRoom: {
            ...player.waitingRoom,
            cardIds: player.waitingRoom.cardIds.filter((id) => id !== TARGET && id !== LIVE),
          },
          exileZone: addCardToStatefulZone(addCardToStatefulZone(player.exileZone, TARGET), LIVE),
        }))
      );
      start(session, entry);
      if (abilityId === PURPLE_LIVE || abilityId === NIJI_MEMBER)
        confirm(session, { cards: HAND.slice(0, 2) });
      else if (session.state!.activeEffect) confirm(session);
      expect(session.state!.activeEffect).toBeNull();
      expect(session.state!.pendingAbilities).toEqual([]);
      if (abilityId === MUSE_LIVE)
        expect(session.state!.players[0].waitingRoom.cardIds).toContain(HOST);
      else
        expect(session.state!.players[0].waitingRoom.cardIds).toEqual(
          expect.arrayContaining(HAND.slice(0, 2))
        );
    }
  );
  it.each([NICO_WAIT, ACTIVATE_MEMBER])(
    '%s没有后续成员目标时仍支付自身待机或能量费用',
    (abilityId) => {
      const entry = cardCase(abilityId);
      const session = setup(entry);
      if (abilityId === NICO_WAIT)
        setState(
          session,
          updatePlayer(session.state!, P2, (player) => ({
            ...player,
            memberSlots: removeCardFromSlot(player.memberSlots, SlotPosition.CENTER),
          }))
        );
      else
        setState(
          session,
          updatePlayer(session.state!, P1, (player) => ({
            ...player,
            memberSlots: removeCardFromSlot(player.memberSlots, SlotPosition.LEFT),
          }))
        );
      start(session, entry);
      confirm(session, { option: abilityId === NICO_WAIT ? 'activate' : 'pay' });
      expect(session.state!.activeEffect).toBeNull();
      if (abilityId === NICO_WAIT)
        expect(session.state!.players[0].memberSlots.cardStates.get(HOST)?.orientation).toBe(
          OrientationState.WAITING
        );
      else
        expect(session.state!.players[0].energyZone.cardStates.get('energy-0')?.orientation).toBe(
          OrientationState.WAITING
        );
    }
  );
  it('多步骤恢复保留grant实例及旧宿主lifecycle；已支付弃手不退回、Heart不转移', () => {
    const entry = cardCase(DISCARD_HEART);
    const session = setup(entry);
    start(session, entry);
    const invocation = {
      abilityInstanceId: session.state!.activeEffect!.abilityInstanceId,
      sourceLifecycleId: session.state!.activeEffect!.sourceLifecycleId,
    };
    confirm(session, { cards: HAND.slice(0, 2) });
    expect(session.state!.activeEffect).toMatchObject(invocation);
    setState(session, roundtrip(session.state!));
    leaveHost(session, true);
    confirm(session, { option: HeartColor.PINK });
    expect(session.state!.players[0].waitingRoom.cardIds).toEqual(
      expect.arrayContaining(HAND.slice(0, 2))
    );
    expect(session.state!.liveResolution.liveModifiers).toEqual([]);
    expect(session.state!.activeEffect).toBeNull();
  });
  it('已支付旧宿主待机后，其离场重入仍不取消对方成员独立效果', () => {
    const entry = cardCase(NICO_WAIT);
    const session = setup(entry);
    start(session, entry);
    confirm(session, { option: 'activate' });
    setState(session, roundtrip(session.state!));
    leaveHost(session, true);
    confirm(session, { card: OPPONENT });
    expect(session.state!.players[0].memberSlots.cardStates.get(HOST)?.orientation).toBe(
      OrientationState.ACTIVE
    );
    expect(session.state!.players[1].memberSlots.cardStates.get(OPPONENT)?.orientation).toBe(
      OrientationState.WAITING
    );
  });
  it.each([ENTRY_SCORE, MUSE_SCORE])(
    '%s原卡和继承的旧pending均不能对已离场/重登场宿主授予常时分数',
    (abilityId) => {
      for (const direct of [false, true])
        for (const reenter of [false, true]) {
          const session = setup(cardCase(abilityId), direct);
          enqueue(session);
          leaveHost(session, reenter);
          setState(session, resolvePendingCardEffects(session.state!).gameState);
          if (session.state!.activeEffect) {
            expect(session.state!.activeEffect!.effectText).toContain('原成员已离场');
            expect(session.state!.activeEffect!.effectText).not.toContain('满足条件，');
            confirm(session);
          }
          expect(
            session.state!.liveResolution.liveModifiers.filter(
              (modifier) => modifier.abilityId === abilityId
            )
          ).toEqual([]);
        }
    }
  );
  it.each([ENTRY_SCORE, MUSE_SCORE])(
    '%s已经获得的常时分数随宿主离场移除，双份继承先+2再归0',
    (abilityId) => {
      for (const direct of [false, true]) {
        const session = setup(cardCase(abilityId), direct, direct ? 1 : 2);
        enqueue(session);
        setState(session, resolvePendingCardEffects(session.state!).gameState);
        if (!direct) confirm(session, { inOrder: true });
        while (session.state!.activeEffect) confirm(session);
        expect(session.state!.liveResolution.playerScoreBonuses.get(P1)).toBe(direct ? 1 : 2);
        leaveHost(session, false);
        setState(
          session,
          enqueueTriggeredCardEffects(session.state!, [TriggerCondition.ON_LEAVE_STAGE])
        );
        expect(
          session.state!.liveResolution.liveModifiers.filter(
            (modifier) => modifier.abilityId === abilityId
          )
        ).toEqual([]);
        expect(session.state!.liveResolution.playerScoreBonuses.get(P1) ?? 0).toBe(0);
      }
    }
  );
  it.each([ENTRY_SCORE, MUSE_SCORE])(
    '%s经真实Wonderful Rush送宿主离场及结果结算不保留已失效的继承分数',
    (abilityId) => {
      const session = setup(cardCase(abilityId));
      start(session, cardCase(abilityId));
      complete(session, cardCase(abilityId));
      const rush = createCardInstance(
        {
          cardCode: 'PL!-bp6-021-L',
          name: 'Wonderful Rush',
          cardType: CardType.LIVE,
          groupNames: ["μ's"],
          score: 10,
          requirements: createHeartRequirement({}),
        },
        P1,
        'rush'
      );
      let game = registerCards(session.state!, [rush]);
      game = updatePlayer(game, P1, (player) => ({
        ...player,
        liveZone: addCardToStatefulZone(player.liveZone, rush.instanceId, {
          face: FaceState.FACE_UP,
          orientation: OrientationState.ACTIVE,
        }),
      }));
      game = {
        ...game,
        currentPhase: GamePhase.PERFORMANCE_PHASE,
        currentSubPhase: SubPhase.PERFORMANCE_JUDGMENT,
        waitingPlayerId: P1,
        liveResolution: {
          ...game.liveResolution,
          isInLive: true,
          performingPlayerId: P1,
          liveResults: new Map(),
          playerScores: new Map(),
        },
      };
      setState(session, game);
      const judgment = session.executeCommand(createSubmitJudgmentCommand(P1, new Map()));
      expect(judgment.success, judgment.error).toBe(true);
      expect(session.state!.liveResolution.playerScores.get(P1)).toBe(11);
      // Dispatch the successful LIVE's real trigger, then use its production send-stage wrapper.
      game = {
        ...session.state!,
        activeEffect: null,
        pendingAbilities: [],
        currentPhase: GamePhase.MAIN_PHASE,
        currentSubPhase: SubPhase.NONE,
        waitingPlayerId: null,
      };
      const success = createLiveSuccessEvent(P1, [rush.instanceId], 11);
      game = enqueueTriggeredCardEffects(
        emitGameEvent(game, success),
        [TriggerCondition.ON_LIVE_SUCCESS],
        { liveSuccessEvents: [success] }
      );
      setState(session, resolvePendingCardEffects(game).gameState);
      if (session.state!.activeEffect?.abilityId === 'system:select-pending-card-effect') {
        confirm(session, { card: rush.instanceId });
      }
      if (session.state!.activeEffect?.metadata?.confirmOnlyPendingAbility) confirm(session);
      expect(session.state!.activeEffect?.abilityId).toBe(RUSH);
      confirm(session, { card: HOST });
      if (session.state!.activeEffect?.abilityId === RUSH) confirm(session, { card: LIVE });
      while (session.state!.activeEffect) confirm(session);
      expect(session.state!.players[0].memberSlots.slots[SlotPosition.CENTER]).toBeNull();
      expect(
        session.state!.liveResolution.liveModifiers.filter(
          (modifier) => modifier.abilityId === abilityId
        )
      ).toEqual([]);
      expect(session.state!.liveResolution.playerScores.get(P1)).toBe(11);
      const result = gameService.executeLiveResultPhase(session.state!);
      expect(result.success).toBe(true);
      expect(result.gameState.liveResolution.playerScores.get(P1)).toBe(11);
    }
  );
  it('移除成员绑定SCORE只同步已判定成功草案，保留手动调整且无草案/未判定/失败不产生负分', () => {
    for (const [kind, draft, judgment, expected] of [
      ['adjusted', 18, true, 17],
      ['absent', undefined, true, undefined],
      ['unjudged', 1, undefined, 1],
      ['failed', 0, false, 0],
    ] as const) {
      const session = setup(cardCase(ENTRY_SCORE));
      start(session, cardCase(ENTRY_SCORE));
      complete(session, cardCase(ENTRY_SCORE));
      let game = updatePlayer(session.state!, P1, (player) => ({
        ...player,
        liveZone: addCardToStatefulZone(player.liveZone, LIVE),
        waitingRoom: {
          ...player.waitingRoom,
          cardIds: player.waitingRoom.cardIds.filter((id) => id !== LIVE),
        },
      }));
      game = {
        ...game,
        liveResolution: {
          ...game.liveResolution,
          isInLive: true,
          playerScores: draft === undefined ? new Map() : new Map([[P1, draft]]),
          liveResults: judgment === undefined ? new Map() : new Map([[LIVE, judgment]]),
        },
      };
      const result = sendStageMemberToWaitingRoomAndEnqueueLeaveStageTriggers(
        game,
        P1,
        HOST,
        enqueueTriggeredCardEffects
      )!;
      expect(result.gameState.liveResolution.playerScores.get(P1), kind).toBe(expected);
      expect(result.gameState.liveResolution.playerScoreBonuses.get(P1) ?? 0).toBe(0);
    }
  });
  it('能量精确选择及恢复保留继承实例，宿主失效后费用仍支付但不产生Blade', () => {
    const entry = cardCase(ENERGY_BLADE);
    const session = setup(entry);
    start(session, entry);
    const invocation = {
      abilityInstanceId: session.state!.activeEffect!.abilityInstanceId,
      sourceLifecycleId: session.state!.activeEffect!.sourceLifecycleId,
    };
    setState(session, {
      ...session.state!,
      energyActivePhaseSkips: [
        {
          playerId: P1,
          energyCardId: 'energy-1',
          sourceCardId: 'marker-source',
          abilityId: 'marker',
        },
      ],
    });
    confirm(session, { option: 'pay' });
    expect(session.state!.activeEffect?.stepId).toBe('COMMON_ENERGY_OPERATION_SELECTION');
    expect(session.state!.activeEffect).toMatchObject(invocation);
    setState(session, roundtrip(session.state!));
    leaveHost(session, true);
    confirm(session, { card: 'energy-1' });
    expect(session.state!.players[0].energyZone.cardStates.get('energy-1')?.orientation).toBe(
      OrientationState.WAITING
    );
    expect(session.state!.players[0].energyZone.cardStates.get('energy-0')?.orientation).toBe(
      OrientationState.ACTIVE
    );
    expect(session.state!.liveResolution.liveModifiers).toEqual([]);
    expect(session.state!.activeEffect).toBeNull();
  });
  it('宿主跨区重登场后同授予实例按新规则对象重置起动次数', () => {
    const entry = cardCase(PURPLE_LIVE);
    const session = setup(entry);
    const instance = granted(session, entry.abilityId).abilityInstanceId;
    start(session, entry);
    complete(session, entry);
    expect(
      getAbilityTurnLimitStatus(session.state!, P1, entry.abilityId, HOST, instance)?.used
    ).toBe(1);
    leaveHost(session, true);
    setState(
      session,
      updatePlayer(session.state!, P1, (player) => ({
        ...player,
        memberSlots: {
          ...player.memberSlots,
          memberBelow: { ...player.memberSlots.memberBelow, [SlotPosition.CENTER]: [BELOW] },
        },
        hand: { ...player.hand, cardIds: [...player.hand.cardIds, HAND[0]!] },
        waitingRoom: {
          ...player.waitingRoom,
          cardIds: player.waitingRoom.cardIds.filter((id) => id !== HAND[0] && id !== BELOW),
        },
      }))
    );
    expect(granted(session, entry.abilityId).abilityInstanceId).toBe(instance);
    expect(
      getAbilityTurnLimitStatus(session.state!, P1, entry.abilityId, HOST, instance)?.used
    ).toBe(0);
    expect(
      session.executeCommand(createActivateAbilityCommand(P1, HOST, entry.abilityId, instance))
        .success
    ).toBe(true);
    confirm(session, { cards: [HAND[0]!, HAND[2]!] });
    expect(session.state!.activeEffect).toBeNull();
    expect(
      getAbilityTurnLimitStatus(session.state!, P1, entry.abilityId, HOST, instance)?.used
    ).toBe(1);
  });
  it('两份同名起动按实例独立限次，恢复后仍保留已用次数', () => {
    const entry = cardCase(PURPLE_LIVE);
    const session = setup(entry, false, 2);
    const first = granted(session, entry.abilityId);
    const second = granted(session, entry.abilityId, `${BELOW}-1`);
    start(session, entry);
    complete(session, entry);
    setState(session, roundtrip(session.state!));
    expect(
      getAbilityTurnLimitStatus(session.state!, P1, entry.abilityId, HOST, first.abilityInstanceId)
        ?.used
    ).toBe(1);
    expect(
      getAbilityTurnLimitStatus(session.state!, P1, entry.abilityId, HOST, second.abilityInstanceId)
        ?.used
    ).toBe(0);
    expect(
      session.executeCommand(
        createActivateAbilityCommand(P1, HOST, entry.abilityId, first.abilityInstanceId)
      ).success
    ).toBe(false);
    // Supply two legal hand cards without changing the source lifecycle.
    setState(
      session,
      updatePlayer(session.state!, P1, (player) => ({
        ...player,
        hand: { ...player.hand, cardIds: [...player.hand.cardIds, HAND[0]!] },
        waitingRoom: {
          ...player.waitingRoom,
          cardIds: player.waitingRoom.cardIds.filter((id) => id !== HAND[0]),
        },
      }))
    );
    expect(
      session.executeCommand(
        createActivateAbilityCommand(P1, HOST, entry.abilityId, second.abilityInstanceId)
      ).success
    ).toBe(true);
    confirm(session, { cards: [HAND[0]!, HAND[2]!] });
    // There is no legal purple LIVE after the first recovery: cost still resolves.
    expect(session.state!.activeEffect).toBeNull();
    expect(
      getAbilityTurnLimitStatus(session.state!, P1, entry.abilityId, HOST, second.abilityInstanceId)
        ?.used
    ).toBe(1);
  });
});
