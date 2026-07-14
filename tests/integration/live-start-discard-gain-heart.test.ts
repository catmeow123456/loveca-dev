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
import { confirmActiveEffectStep, resolvePendingCardEffects } from '../../src/application/card-effect-runner';
import { HS_PB1_003_AUTO_HAND_TO_WAITING_GAIN_HEART_BLADE_ABILITY_ID, PL_N_BP3_002_LIVE_START_DISCARD_CHOOSE_HEART_OTHER_NIJIGASAKI_MEMBER_ABILITY_ID as KASUMI_ABILITY_ID } from '../../src/application/card-effects/ability-ids';
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
