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
import { createGameState, registerCards, updatePlayer, type GameState } from '../../src/domain/entities/game';
import { placeCardInSlot, removeCardFromSlot } from '../../src/domain/entities/zone';
import { createConfirmEffectStepCommand } from '../../src/application/game-commands';
import { createGameSession } from '../../src/application/game-session';
import { GameService, type DeckConfig } from '../../src/application/game-service';
import { HS_BP1_006_LIVE_START_DISCARD_GAIN_HEART_ABILITY_ID } from '../../src/application/card-effect-runner';
import {
  confirmActiveEffectStep,
  enqueueTriggeredCardEffects,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import { sendStageMemberToWaitingRoomAndEnqueueLeaveStageTriggers } from '../../src/application/card-effects/runtime/leave-stage-triggers';
import {
  HS_PB1_003_AUTO_HAND_TO_WAITING_GAIN_HEART_BLADE_ABILITY_ID,
  KOTORI_LIVE_START_HEART_ABILITY_ID,
  PL_BP4_013_LIVE_START_DISCARD_TARGET_OTHER_MEMBER_GAIN_PINK_HEART_ABILITY_ID as UMI_013_ABILITY_ID,
  PL_N_BP3_002_LIVE_START_DISCARD_CHOOSE_HEART_OTHER_NIJIGASAKI_MEMBER_ABILITY_ID as KASUMI_ABILITY_ID,
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

function createEnergyCard(cardCode: string): EnergyCardData {
  return {
    cardCode,
    name: cardCode,
    cardType: CardType.ENERGY,
  };
}

function createDeck(): DeckConfig {
  const mainDeck: AnyCardData[] = Array.from({ length: 61 }, (_, index) =>
    createMemberCard(`MEM-${index}`)
  );
  const energyDeck = Array.from({ length: 12 }, (_, index) => createEnergyCard(`ENE-${index}`));
  return { mainDeck, energyDeck };
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

describe('live-start discard gain Heart workflow', () => {
  it('keeps Kotori on the existing three-color choice and SOURCE_MEMBER modifier path', () => {
    const kotori = createCardInstance(
      { ...createMemberCard('PL!-sd1-003-SD', '南ことり', 7), groupNames: ["μ's"] },
      PLAYER1,
      'kotori-shared-regression'
    );
    const discard = createCardInstance(
      createMemberCard('KOTORI-DISCARD', 'discard', 1),
      PLAYER1,
      'kotori-shared-regression-discard'
    );
    let game = registerCards(createGameState('kotori-shared-regression', PLAYER1, 'P1', PLAYER2, 'P2'), [
      kotori,
      discard,
    ]);
    game = updatePlayer(game, PLAYER1, (player) => ({
      ...player,
      memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, kotori.instanceId),
      hand: { ...player.hand, cardIds: [discard.instanceId] },
    }));
    game = {
      ...game,
      pendingAbilities: [
        {
          id: 'kotori-shared-regression-pending',
          abilityId: KOTORI_LIVE_START_HEART_ABILITY_ID,
          sourceCardId: kotori.instanceId,
          controllerId: PLAYER1,
          mandatory: false,
          timingId: TriggerCondition.ON_LIVE_START,
          eventIds: ['kotori-live-start'],
          sourceSlot: SlotPosition.CENTER,
        },
      ],
    };
    const discardWindow = resolvePendingCardEffects(game).gameState;
    const colorWindow = confirmActiveEffectStep(
      discardWindow,
      PLAYER1,
      discardWindow.activeEffect!.id,
      discard.instanceId
    );
    expect(colorWindow.activeEffect?.selectableOptions?.map((option) => option.id)).toEqual([
      HeartColor.PINK,
      HeartColor.YELLOW,
      HeartColor.PURPLE,
    ]);
    const done = confirmActiveEffectStep(
      colorWindow,
      PLAYER1,
      colorWindow.activeEffect!.id,
      null,
      null,
      false,
      HeartColor.YELLOW
    );
    expect(done.liveResolution.liveModifiers).toContainEqual({
      kind: 'HEART',
      target: 'SOURCE_MEMBER',
      playerId: PLAYER1,
      sourceCardId: kotori.instanceId,
      abilityId: KOTORI_LIVE_START_HEART_ABILITY_ID,
      hearts: [{ color: HeartColor.YELLOW, count: 1 }],
    });
  });

  it('keeps HS-bp1-006 Heart color options at the six standard colors', () => {
    const session = createGameSession();
    const deck = createDeck();

    session.createGame(
      'live-start-discard-gain-heart-hs-bp1-006-options',
      PLAYER1,
      'Player 1',
      PLAYER2,
      'Player 2'
    );
    session.initializeGame(deck, deck);

    const source = createCardInstance(
      createMemberCard('PL!HS-bp1-006-P', '藤島慈', 4),
      PLAYER1,
      'p1-hs-bp1-006-source'
    );
    const pb1003Source = createCardInstance(
      createMemberCard('PL!HS-pb1-003-R', '大沢瑠璃乃', 15),
      PLAYER1,
      'p1-live-start-heart-pb1-003'
    );
    const otherMember = createCardInstance(
      createMemberCard('PL!HS-test-other', '乙宗梢', 4),
      PLAYER1,
      'p1-hs-bp1-006-other'
    );
    const discardCard = createCardInstance(
      createMemberCard('PL!HS-test-discard', '日野下花帆', 3),
      PLAYER1,
      'p1-hs-bp1-006-discard'
    );
    const liveCard = createCardInstance(
      createLiveCard('PL!HS-test-live', 'Live Start'),
      PLAYER1,
      'p1-hs-bp1-006-live'
    );
    const state = registerCards(session.state!, [
      source,
      pb1003Source,
      otherMember,
      discardCard,
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
    p1.memberSlots.slots[SlotPosition.LEFT] = otherMember.instanceId;
    p1.memberSlots.slots[SlotPosition.CENTER] = source.instanceId;
    p1.memberSlots.slots[SlotPosition.RIGHT] = pb1003Source.instanceId;
    p1.memberSlots.cardStates = new Map([
      [otherMember.instanceId, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
      [source.instanceId, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
      [pb1003Source.instanceId, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }],
    ]);
    p1.hand.cardIds = [discardCard.instanceId];
    p1.liveZone.cardIds = [liveCard.instanceId];
    p1.liveZone.cardStates = new Map([
      [liveCard.instanceId, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_DOWN }],
    ]);

    advanceToLiveStartEffects(session);

    expect(session.state?.activeEffect?.abilityId).toBe(
      HS_BP1_006_LIVE_START_DISCARD_GAIN_HEART_ABILITY_ID
    );

    const discardResult = session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        session.state!.activeEffect!.id,
        discardCard.instanceId
      )
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
        HeartColor.PINK
      )
    );

    expect(heartResult.success).toBe(true);
    expect(
      session.state?.actionHistory.filter(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId ===
            HS_PB1_003_AUTO_HAND_TO_WAITING_GAIN_HEART_BLADE_ABILITY_ID &&
          action.payload.sourceCardId === pb1003Source.instanceId &&
          action.payload.step === 'GAIN_PINK_HEART_AND_BLADE_FROM_HAND_TO_WAITING'
      )
    ).toHaveLength(1);
  });
});

function setupKasumi(rarity: 'R' | 'P' = 'R', withHand = true, withSecondTarget = false) {
  const kasumi = createCardInstance(createMemberCard(`PL!N-bp3-002-${rarity}`, '中須かすみ', 4), PLAYER1, 'kasumi');
  const target = createCardInstance({ ...createMemberCard('PL!N-target', '上原歩夢', 5), groupNames: ['虹ヶ咲'] }, PLAYER1, 'target');
  const secondTarget = createCardInstance({ ...createMemberCard('PL!N-second-target', '桜坂しずく', 5), groupNames: ['虹ヶ咲'] }, PLAYER1, 'second-target');
  const memberBelow = createCardInstance({ ...createMemberCard('PL!N-member-below', '天王寺璃奈', 5), groupNames: ['虹ヶ咲'] }, PLAYER1, 'member-below');
  const nonNiji = createCardInstance({ ...createMemberCard('PL!HS-pb1-003-P＋', '大沢瑠璃乃', 15), groupNames: ['蓮ノ空'] }, PLAYER1, 'non-niji');
  const opponent = createCardInstance({ ...createMemberCard('PL!N-opponent', '優木せつ菜', 5), groupNames: ['虹ヶ咲'] }, PLAYER2, 'opponent');
  const discard = createCardInstance(createMemberCard('DISCARD', 'discard', 1), PLAYER1, 'discard');
  let game = registerCards(createGameState('n-bp3-002', PLAYER1, 'P1', PLAYER2, 'P2'), [kasumi, target, secondTarget, memberBelow, nonNiji, opponent, discard]);
  game = updatePlayer(game, PLAYER1, (p) => ({ ...p, memberSlots: { ...placeCardInSlot(placeCardInSlot(placeCardInSlot(p.memberSlots, SlotPosition.LEFT, target.instanceId), SlotPosition.CENTER, kasumi.instanceId), SlotPosition.RIGHT, withSecondTarget ? secondTarget.instanceId : nonNiji.instanceId), memberBelow: new Map([[target.instanceId, [memberBelow.instanceId]]]) }, hand: { ...p.hand, cardIds: withHand ? [discard.instanceId] : [] } }));
  game = updatePlayer(game, PLAYER2, (p) => ({ ...p, memberSlots: placeCardInSlot(p.memberSlots, SlotPosition.LEFT, opponent.instanceId) }));
  game = { ...game, pendingAbilities: [{ id: 'kasumi-pending', abilityId: KASUMI_ABILITY_ID, sourceCardId: kasumi.instanceId, controllerId: PLAYER1, mandatory: false, timingId: TriggerCondition.ON_LIVE_START, eventIds: ['live-start'], sourceSlot: SlotPosition.CENTER }] };
  return { game, kasumi, target, secondTarget, memberBelow, nonNiji, opponent, discard };
}

describe('PL!N-bp3-002 中須かすみ shared recipient mode', () => {
  const start = (game: GameState) => resolvePendingCardEffects(game).gameState;
  const confirm = (game: GameState, cardId?: string, optionId?: string) => confirmActiveEffectStep(game, PLAYER1, game.activeEffect!.id, cardId, null, false, optionId);

  it.each(['R', 'P'] as const)('R/P 共用；可跳过且无手牌时也能结束：%s', (rarity) => {
    const window = start(setupKasumi(rarity).game);
    const skipped = confirm(window);
    expect(skipped.activeEffect).toBeNull();
    expect(skipped.liveResolution.liveModifiers).toEqual([]);
    expect(confirm(start(setupKasumi(rarity, false).game)).activeEffect).toBeNull();
  });

  it('弃牌后只展示六种普通颜色，再强制选择其他虹咲成员并写 TARGET_MEMBER', () => {
    const { game, discard, target, kasumi } = setupKasumi();
    const colorWindow = confirm(start(game), discard.instanceId);
    expect(colorWindow.players[0]!.waitingRoom.cardIds).toContain(discard.instanceId);
    expect(colorWindow.activeEffect?.selectableOptions?.map((o) => o.id)).toEqual([HeartColor.PINK, HeartColor.RED, HeartColor.YELLOW, HeartColor.GREEN, HeartColor.BLUE, HeartColor.PURPLE]);
    expect(colorWindow.activeEffect?.selectableOptions?.map((o) => o.id)).not.toContain(HeartColor.RAINBOW);
    const targetWindow = confirm(colorWindow, undefined, HeartColor.BLUE);
    expect(targetWindow.activeEffect).toMatchObject({ selectableCardIds: [target.instanceId], canSkipSelection: false, confirmSelectionLabel: '获得所选Heart' });
    expect(targetWindow.pendingAbilities).toContainEqual(expect.objectContaining({ abilityId: HS_PB1_003_AUTO_HAND_TO_WAITING_GAIN_HEART_BLADE_ABILITY_ID }));
    expect(targetWindow.liveResolution.liveModifiers.some((m) => m.abilityId === HS_PB1_003_AUTO_HAND_TO_WAITING_GAIN_HEART_BLADE_ABILITY_ID)).toBe(false);
    const done = confirm(targetWindow, target.instanceId);
    expect(done.liveResolution.liveModifiers).toContainEqual({ kind: 'HEART', target: 'TARGET_MEMBER', playerId: PLAYER1, hearts: [{ color: HeartColor.BLUE, count: 1 }], sourceCardId: kasumi.instanceId, abilityId: KASUMI_ABILITY_ID, targetMemberCardId: target.instanceId });
    expect(done.liveResolution.liveModifiers.some((m) => m.abilityId === HS_PB1_003_AUTO_HAND_TO_WAITING_GAIN_HEART_BLADE_ABILITY_ID)).toBe(true);
  });

  it('非候选、对方、非虹咲、来源与 memberBelow 均不能选择', () => {
    const { game, discard, nonNiji, opponent, kasumi, memberBelow } = setupKasumi();
    const colorWindow = confirm(start(game), discard.instanceId);
    expect(confirm(colorWindow, undefined, HeartColor.RAINBOW)).toBe(colorWindow);
    const targetWindow = confirm(colorWindow, undefined, HeartColor.RED);
    expect(confirm(targetWindow, nonNiji.instanceId)).toBe(targetWindow);
    expect(confirm(targetWindow, opponent.instanceId)).toBe(targetWindow);
    expect(confirm(targetWindow, kasumi.instanceId)).toBe(targetWindow);
    expect(confirm(targetWindow, memberBelow.instanceId)).toBe(targetWindow);
    expect(targetWindow.activeEffect?.selectableCardIds).not.toContain(memberBelow.instanceId);
  });

  it('进入选成员窗口后唯一目标离场，安全结束并继续下游 pending', () => {
    const scenario = setupKasumi();
    const targetWindow = confirm(confirm(start(scenario.game), scenario.discard.instanceId), undefined, HeartColor.GREEN);
    const targetGone = updatePlayer(targetWindow, PLAYER1, (p) => ({ ...p, memberSlots: removeCardFromSlot(p.memberSlots, SlotPosition.LEFT) }));
    const finished = confirm(targetGone, scenario.target.instanceId);
    expect(finished.activeEffect).toBeNull();
    expect(finished.pendingAbilities.some((ability) => ability.abilityId === KASUMI_ABILITY_ID)).toBe(false);
    expect(finished.liveResolution.liveModifiers.some((m) => m.abilityId === KASUMI_ABILITY_ID)).toBe(false);
    expect(finished.players[0]!.mainDeck.cardIds).toContain(scenario.discard.instanceId);
    expect(finished.liveResolution.liveModifiers.some((m) => m.abilityId === HS_PB1_003_AUTO_HAND_TO_WAITING_GAIN_HEART_BLADE_ABILITY_ID)).toBe(true);
  });

  it('进入选成员窗口后来源离场，安全结束且不留下强制窗口', () => {
    const scenario = setupKasumi();
    const targetWindow = confirm(confirm(start(scenario.game), scenario.discard.instanceId), undefined, HeartColor.PURPLE);
    const sourceGone = updatePlayer(targetWindow, PLAYER1, (p) => ({ ...p, memberSlots: removeCardFromSlot(p.memberSlots, SlotPosition.CENTER) }));
    const finished = confirm(sourceGone, scenario.target.instanceId);
    expect(finished.activeEffect).toBeNull();
    expect(finished.pendingAbilities.some((ability) => ability.abilityId === KASUMI_ABILITY_ID)).toBe(false);
    expect(finished.liveResolution.liveModifiers.some((m) => m.abilityId === KASUMI_ABILITY_ID)).toBe(false);
    expect(finished.players[0]!.mainDeck.cardIds).toContain(scenario.discard.instanceId);
  });

  it('两个合法目标之一 stale 时刷新候选，并可选择剩余目标完成且不能重复确认', () => {
    const scenario = setupKasumi('R', true, true);
    const targetWindow = confirm(confirm(start(scenario.game), scenario.discard.instanceId), undefined, HeartColor.BLUE);
    expect(targetWindow.activeEffect?.selectableCardIds).toEqual([scenario.target.instanceId, scenario.secondTarget.instanceId]);
    const firstGone = updatePlayer(targetWindow, PLAYER1, (p) => ({ ...p, memberSlots: removeCardFromSlot(p.memberSlots, SlotPosition.LEFT) }));
    const refreshed = confirm(firstGone, scenario.target.instanceId);
    expect(refreshed.activeEffect?.selectableCardIds).toEqual([scenario.secondTarget.instanceId]);
    expect(refreshed.liveResolution.liveModifiers.some((m) => m.abilityId === KASUMI_ABILITY_ID)).toBe(false);
    const done = confirm(refreshed, scenario.secondTarget.instanceId);
    expect(done.activeEffect).toBeNull();
    expect(done.liveResolution.liveModifiers.filter((m) => m.abilityId === KASUMI_ABILITY_ID)).toHaveLength(1);
    const repeated = confirmActiveEffectStep(done, PLAYER1, refreshed.activeEffect!.id, scenario.secondTarget.instanceId);
    expect(repeated).toBe(done);
    expect(repeated.liveResolution.liveModifiers.filter((m) => m.abilityId === KASUMI_ABILITY_ID)).toHaveLength(1);
  });
});

function setupUmi013(options: {
  readonly withHand?: boolean;
  readonly withTargets?: boolean;
} = {}) {
  const withHand = options.withHand ?? true;
  const withTargets = options.withTargets ?? true;
  const umi = createCardInstance(
    { ...createMemberCard('PL!-bp4-013-N', '園田海未', 4), groupNames: ["μ's"] },
    PLAYER1,
    'umi-013'
  );
  const activeMuseTarget = createCardInstance(
    { ...createMemberCard('PL!HS-pb1-003-R', '南ことり', 15), groupNames: ["μ's"] },
    PLAYER1,
    'umi-013-active-muse-target'
  );
  const waitingOtherGroupTarget = createCardInstance(
    { ...createMemberCard('PL!SP-test-target', '澁谷かのん', 5), groupNames: ['Liella!'] },
    PLAYER1,
    'umi-013-waiting-other-group-target'
  );
  const memberBelow = createCardInstance(
    { ...createMemberCard('PL!-bp4-013-below', '東條希', 4), groupNames: ["μ's"] },
    PLAYER1,
    'umi-013-member-below'
  );
  const opponent = createCardInstance(
    { ...createMemberCard('PL!-bp4-013-opponent', '絢瀬絵里', 4), groupNames: ["μ's"] },
    PLAYER2,
    'umi-013-opponent'
  );
  const discard = createCardInstance(
    createMemberCard('PL!-bp4-013-discard', 'discard', 1),
    PLAYER1,
    'umi-013-discard'
  );
  let game = registerCards(createGameState('bp4-013', PLAYER1, 'P1', PLAYER2, 'P2'), [
    umi,
    activeMuseTarget,
    waitingOtherGroupTarget,
    memberBelow,
    opponent,
    discard,
  ]);
  game = updatePlayer(game, PLAYER1, (player) => {
    let memberSlots = placeCardInSlot(
      player.memberSlots,
      SlotPosition.CENTER,
      umi.instanceId,
      { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }
    );
    if (withTargets) {
      memberSlots = placeCardInSlot(memberSlots, SlotPosition.LEFT, activeMuseTarget.instanceId, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      });
      memberSlots = placeCardInSlot(
        memberSlots,
        SlotPosition.RIGHT,
        waitingOtherGroupTarget.instanceId,
        { orientation: OrientationState.WAITING, face: FaceState.FACE_UP }
      );
      memberSlots = {
        ...memberSlots,
        memberBelow: new Map([[activeMuseTarget.instanceId, [memberBelow.instanceId]]]),
      };
    }
    return {
      ...player,
      memberSlots,
      hand: { ...player.hand, cardIds: withHand ? [discard.instanceId] : [] },
    };
  });
  game = updatePlayer(game, PLAYER2, (player) => ({
    ...player,
    memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.LEFT, opponent.instanceId, {
      orientation: OrientationState.ACTIVE,
      face: FaceState.FACE_UP,
    }),
  }));
  game = {
    ...game,
    pendingAbilities: [
      {
        id: 'umi-013-pending',
        abilityId: UMI_013_ABILITY_ID,
        sourceCardId: umi.instanceId,
        controllerId: PLAYER1,
        mandatory: false,
        timingId: TriggerCondition.ON_LIVE_START,
        eventIds: ['umi-013-live-start'],
        sourceSlot: SlotPosition.CENTER,
      },
    ],
  };
  return { game, umi, activeMuseTarget, waitingOtherGroupTarget, memberBelow, opponent, discard };
}

describe('PL!-bp4-013-N 園田海未 fixed pink Heart shared path', () => {
  const start = (game: GameState) => resolvePendingCardEffects(game).gameState;
  const confirm = (game: GameState, cardId?: string) =>
    confirmActiveEffectStep(game, PLAYER1, game.activeEffect!.id, cardId);

  it('enters from the real ON_LIVE_START event with the correct source, ability and timing', () => {
    const session = createGameSession();
    const deck = createDeck();
    session.createGame('bp4-013-real-live-start', PLAYER1, 'P1', PLAYER2, 'P2');
    session.initializeGame(deck, deck);
    const umi = createCardInstance(
      { ...createMemberCard('PL!-bp4-013-N', '園田海未', 4), groupNames: ["μ's"] },
      PLAYER1,
      'real-live-start-umi-013'
    );
    const target = createCardInstance(
      createMemberCard('PL!SP-real-live-start-target', '唐可可', 4),
      PLAYER1,
      'real-live-start-target'
    );
    const discard = createCardInstance(
      createMemberCard('PL!-real-live-start-discard', 'discard', 1),
      PLAYER1,
      'real-live-start-discard'
    );
    const live = createCardInstance(
      createLiveCard('PL!-real-live-start-live', 'LIVE'),
      PLAYER1,
      'real-live-start-live'
    );
    const state = registerCards(session.state!, [umi, target, discard, live]);
    (session as unknown as { authorityState: GameState }).authorityState = updatePlayer(
      state,
      PLAYER1,
      (player) => {
        removeFromPlayerZones(player as Parameters<typeof removeFromPlayerZones>[0]);
        return {
          ...player,
          hand: { ...player.hand, cardIds: [discard.instanceId] },
          liveZone: {
            ...player.liveZone,
            cardIds: [live.instanceId],
            cardStates: new Map([
              [live.instanceId, { orientation: OrientationState.ACTIVE, face: FaceState.FACE_DOWN }],
            ]),
          },
          memberSlots: placeCardInSlot(
            placeCardInSlot(player.memberSlots, SlotPosition.CENTER, umi.instanceId),
            SlotPosition.LEFT,
            target.instanceId
          ),
        };
      }
    );

    advanceToLiveStartEffects(session);

    expect(
      session.state?.eventLog.some(
        (entry) =>
          entry.event.eventType === TriggerCondition.ON_LIVE_START &&
          entry.event.triggerPlayerId === PLAYER1
      )
    ).toBe(true);
    expect(session.state?.activeEffect).toMatchObject({
      abilityId: UMI_013_ABILITY_ID,
      sourceCardId: umi.instanceId,
      stepId: 'KOTORI_LIVE_START_SELECT_DISCARD',
    });
    expect(session.state?.activeEffect?.metadata?.confirmOnlyPendingAbility).not.toBe(true);
  });

  it('opens the optional discard shell and decline pays nothing, writes nothing, and continues', () => {
    const scenario = setupUmi013();
    const window = start(scenario.game);
    expect(window.activeEffect).toMatchObject({
      selectableCardIds: [scenario.discard.instanceId],
      selectionLabel: '请选择要放置入休息室的卡牌',
      confirmSelectionLabel: '放置入休息室',
      skipSelectionLabel: '不发动',
      canSkipSelection: true,
    });
    expect(window.activeEffect?.metadata?.confirmOnlyPendingAbility).not.toBe(true);
    const declined = confirm(window);
    expect(declined.activeEffect).toBeNull();
    expect(declined.players[0]!.hand.cardIds).toContain(scenario.discard.instanceId);
    expect(declined.players[0]!.waitingRoom.cardIds).not.toContain(scenario.discard.instanceId);
    expect(declined.liveResolution.liveModifiers).toEqual([]);
  });

  it('with no hand cannot pay and never creates an empty target window', () => {
    const window = start(setupUmi013({ withHand: false }).game);
    expect(window.activeEffect).toMatchObject({ selectableCardIds: [], canSkipSelection: true });
    const declined = confirm(window);
    expect(declined.activeEffect).toBeNull();
    expect(declined.liveResolution.liveModifiers).toEqual([]);
  });

  it('discards through the trigger wrapper and directly opens the mandatory fixed-pink target step', () => {
    const scenario = setupUmi013();
    const targetWindow = confirm(start(scenario.game), scenario.discard.instanceId);
    expect(targetWindow.players[0]!.hand.cardIds).not.toContain(scenario.discard.instanceId);
    expect(targetWindow.players[0]!.waitingRoom.cardIds).toContain(scenario.discard.instanceId);
    expect(targetWindow.eventLog).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: expect.objectContaining({
            eventType: TriggerCondition.ON_ENTER_WAITING_ROOM,
            cardInstanceIds: [scenario.discard.instanceId],
          }),
        }),
      ])
    );
    expect(targetWindow.pendingAbilities).toContainEqual(
      expect.objectContaining({
        abilityId: HS_PB1_003_AUTO_HAND_TO_WAITING_GAIN_HEART_BLADE_ABILITY_ID,
      })
    );
    expect(targetWindow.activeEffect).toMatchObject({
      stepId: 'LIVE_START_DISCARD_GAIN_HEART_SELECT_MEMBER',
      stepText: '请选择自己舞台上此成员以外的1名成员获得[桃ハート]。',
      selectableCardIds: [
        scenario.activeMuseTarget.instanceId,
        scenario.waitingOtherGroupTarget.instanceId,
      ],
      selectionLabel: '选择获得[桃ハート]的成员',
      confirmSelectionLabel: '获得[桃ハート]',
      selectableCardMode: 'SINGLE',
      minSelectableCards: 1,
      maxSelectableCards: 1,
      canSkipSelection: false,
    });
    expect(targetWindow.activeEffect?.selectableOptions).toBeUndefined();
    expect(targetWindow.activeEffect?.skipSelectionLabel).toBeUndefined();
  });

  it('accepts ACTIVE and WAITING targets across groups, but excludes source, memberBelow and opponent', () => {
    const scenario = setupUmi013();
    const targetWindow = confirm(start(scenario.game), scenario.discard.instanceId);
    expect(targetWindow.activeEffect?.selectableCardIds).toEqual([
      scenario.activeMuseTarget.instanceId,
      scenario.waitingOtherGroupTarget.instanceId,
    ]);
    expect(
      targetWindow.players[0]!.memberSlots.cardStates.get(scenario.activeMuseTarget.instanceId)
        ?.orientation
    ).toBe(OrientationState.ACTIVE);
    expect(
      targetWindow.players[0]!.memberSlots.cardStates.get(
        scenario.waitingOtherGroupTarget.instanceId
      )?.orientation
    ).toBe(OrientationState.WAITING);
    for (const illegalId of [
      undefined,
      scenario.umi.instanceId,
      scenario.memberBelow.instanceId,
      scenario.opponent.instanceId,
      'not-listed',
    ]) {
      expect(confirm(targetWindow, illegalId)).toBe(targetWindow);
    }
  });

  it('writes one exact TARGET_MEMBER pink Heart modifier with separate source and target ids', () => {
    const scenario = setupUmi013();
    const targetWindow = confirm(start(scenario.game), scenario.discard.instanceId);
    const done = confirm(targetWindow, scenario.waitingOtherGroupTarget.instanceId);
    expect(done.liveResolution.liveModifiers).toContainEqual({
      kind: 'HEART',
      target: 'TARGET_MEMBER',
      playerId: PLAYER1,
      targetMemberCardId: scenario.waitingOtherGroupTarget.instanceId,
      sourceCardId: scenario.umi.instanceId,
      abilityId: UMI_013_ABILITY_ID,
      hearts: [{ color: HeartColor.PINK, count: 1 }],
    });
    expect(done.pendingAbilities.some((ability) => ability.abilityId === UMI_013_ABILITY_ID)).toBe(
      false
    );
    expect(
      done.actionHistory.some(
        (action) =>
          action.payload.abilityId ===
          HS_PB1_003_AUTO_HAND_TO_WAITING_GAIN_HEART_BLADE_ABILITY_ID
      )
    ).toBe(true);
  });

  it('source departure after payment clears the window without refunding or writing Heart', () => {
    const scenario = setupUmi013();
    const targetWindow = confirm(start(scenario.game), scenario.discard.instanceId);
    const sourceGone = updatePlayer(targetWindow, PLAYER1, (player) => ({
      ...player,
      memberSlots: removeCardFromSlot(player.memberSlots, SlotPosition.CENTER),
    }));
    const finished = confirm(sourceGone, scenario.activeMuseTarget.instanceId);
    expect(finished.activeEffect).toBeNull();
    expect(finished.players[0]!.hand.cardIds).not.toContain(scenario.discard.instanceId);
    expect(
      finished.eventLog.some(
        (entry) =>
          entry.event.eventType === TriggerCondition.ON_ENTER_WAITING_ROOM &&
          'cardInstanceIds' in entry.event &&
          entry.event.cardInstanceIds.includes(scenario.discard.instanceId)
      )
    ).toBe(true);
    expect(finished.liveResolution.liveModifiers.some((m) => m.abilityId === UMI_013_ABILITY_ID)).toBe(
      false
    );
  });

  it('refreshes remaining candidates when one target becomes stale and keeps the mandatory window', () => {
    const scenario = setupUmi013();
    const targetWindow = confirm(start(scenario.game), scenario.discard.instanceId);
    const firstGone = updatePlayer(targetWindow, PLAYER1, (player) => ({
      ...player,
      memberSlots: removeCardFromSlot(player.memberSlots, SlotPosition.LEFT),
    }));
    const refreshed = confirm(firstGone, scenario.activeMuseTarget.instanceId);
    expect(refreshed.activeEffect?.selectableCardIds).toEqual([
      scenario.waitingOtherGroupTarget.instanceId,
    ]);
    expect(refreshed.activeEffect?.canSkipSelection).toBe(false);
    expect(refreshed.liveResolution.liveModifiers.some((m) => m.abilityId === UMI_013_ABILITY_ID)).toBe(
      false
    );
  });

  it('ends safely with paid cost when no target existed after discard or the only target becomes stale', () => {
    const noTarget = setupUmi013({ withTargets: false });
    const noTargetDone = confirm(start(noTarget.game), noTarget.discard.instanceId);
    expect(noTargetDone.activeEffect).toBeNull();
    expect(noTargetDone.players[0]!.waitingRoom.cardIds).toContain(noTarget.discard.instanceId);
    expect(noTargetDone.liveResolution.liveModifiers.some((m) => m.abilityId === UMI_013_ABILITY_ID)).toBe(
      false
    );

    const staleScenario = setupUmi013();
    const targetWindow = confirm(start(staleScenario.game), staleScenario.discard.instanceId);
    const allTargetsGone = updatePlayer(targetWindow, PLAYER1, (player) => ({
      ...player,
      memberSlots: removeCardFromSlot(
        removeCardFromSlot(player.memberSlots, SlotPosition.LEFT),
        SlotPosition.RIGHT
      ),
    }));
    const staleDone = confirm(allTargetsGone, staleScenario.activeMuseTarget.instanceId);
    expect(staleDone.activeEffect).toBeNull();
    expect(staleDone.players[0]!.hand.cardIds).not.toContain(staleScenario.discard.instanceId);
    expect(
      staleDone.eventLog.some(
        (entry) =>
          entry.event.eventType === TriggerCondition.ON_ENTER_WAITING_ROOM &&
          'cardInstanceIds' in entry.event &&
          entry.event.cardInstanceIds.includes(staleScenario.discard.instanceId)
      )
    ).toBe(true);
    expect(staleDone.liveResolution.liveModifiers.some((m) => m.abilityId === UMI_013_ABILITY_ID)).toBe(
      false
    );
  });

  it('removes the target-bound Heart through the standard leave-stage cleanup path', () => {
    const scenario = setupUmi013();
    const targetWindow = confirm(start(scenario.game), scenario.discard.instanceId);
    const done = confirm(targetWindow, scenario.waitingOtherGroupTarget.instanceId);
    expect(done.liveResolution.liveModifiers.some((m) => m.abilityId === UMI_013_ABILITY_ID)).toBe(
      true
    );
    const targetLeaves = sendStageMemberToWaitingRoomAndEnqueueLeaveStageTriggers(
      done,
      PLAYER1,
      scenario.waitingOtherGroupTarget.instanceId,
      enqueueTriggeredCardEffects
    );
    expect(targetLeaves).not.toBeNull();
    expect(
      targetLeaves!.gameState.liveResolution.liveModifiers.some(
        (modifier) => modifier.abilityId === UMI_013_ABILITY_ID
      )
    ).toBe(false);
  });
});
