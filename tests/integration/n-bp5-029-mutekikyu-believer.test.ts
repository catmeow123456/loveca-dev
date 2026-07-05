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
} from '../../src/domain/entities/game';
import { placeCardInSlot, removeCardFromSlot } from '../../src/domain/entities/zone';
import {
  confirmActiveEffectStep,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import { GameService } from '../../src/application/game-service';
import { N_BP5_029_LIVE_START_REVEAL_KASUMI_HEARTS_ABILITY_ID } from '../../src/application/card-effects/ability-ids';
import { getMemberEffectiveHeartIcons } from '../../src/domain/rules/live-modifiers';
import {
  BladeHeartEffect,
  CardType,
  FaceState,
  HeartColor,
  OrientationState,
  SlotPosition,
  TriggerCondition,
} from '../../src/shared/types/enums';

const PLAYER1 = 'player1';
const PLAYER2 = 'player2';

interface Scenario {
  readonly game: GameState;
  readonly liveId: string;
  readonly stageKasumiId: string;
  readonly secondStageKasumiId: string;
  readonly deckCardIds: readonly string[];
  readonly revealedKasumiId: string;
}

function createMutekikyuBelieverLive(): LiveCardData {
  return {
    cardCode: 'PL!N-bp5-029-L',
    name: '無敵級*ビリーバー',
    groupNames: ['虹ヶ咲'],
    cardType: CardType.LIVE,
    score: 7,
    requirements: createHeartRequirement({ [HeartColor.PINK]: 7 }),
  };
}

function createKasumiMember(
  cardCode: string,
  hearts = [createHeartIcon(HeartColor.GREEN, 1)]
): MemberCardData {
  return {
    cardCode,
    name: '中須かすみ',
    groupNames: ['虹ヶ咲'],
    cardType: CardType.MEMBER,
    cost: 2,
    blade: 1,
    hearts,
  };
}

function createOtherMember(cardCode: string, name = '上原歩夢'): MemberCardData {
  return {
    cardCode,
    name,
    groupNames: ['虹ヶ咲'],
    cardType: CardType.MEMBER,
    cost: 2,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.YELLOW, 1)],
  };
}

function setupMutekikyuScenario(options?: {
  readonly noStageKasumi?: boolean;
  readonly removeLiveSource?: boolean;
  readonly noRevealedKasumi?: boolean;
  readonly deckSize?: number;
}): Scenario {
  const live = createCardInstance(createMutekikyuBelieverLive(), PLAYER1, 'mutekikyu-live');
  const stageKasumi = createCardInstance(
    createKasumiMember('PL!N-bp5-014-N'),
    PLAYER1,
    'stage-kasumi'
  );
  const secondStageKasumi = createCardInstance(
    createKasumiMember('PL!N-bp1-002-P'),
    PLAYER1,
    'stage-kasumi-2'
  );
  const stageOther = createCardInstance(
    createOtherMember('PL!N-bp5-013-N'),
    PLAYER1,
    'stage-other'
  );
  const revealedKasumi = createCardInstance(
    {
      ...createKasumiMember('PL!N-bp5-014-P', [
        createHeartIcon(HeartColor.PINK, 2),
        createHeartIcon(HeartColor.RED, 1),
      ]),
      bladeHearts: [{ effect: BladeHeartEffect.HEART, heartColor: HeartColor.PURPLE }],
    },
    PLAYER1,
    'revealed-kasumi'
  );
  const topOther1 = createCardInstance(
    createOtherMember('PL!N-bp5-001-R', '高咲侑'),
    PLAYER1,
    'top-other-1'
  );
  const topOther2 = createCardInstance(
    createOtherMember('PL!N-bp5-002-R', '優木せつ菜'),
    PLAYER1,
    'top-other-2'
  );
  const topOther3 = createCardInstance(
    createOtherMember('PL!N-bp5-003-R', '桜坂しずく'),
    PLAYER1,
    'top-other-3'
  );
  const registeredCards = [
    live,
    stageKasumi,
    secondStageKasumi,
    stageOther,
    revealedKasumi,
    topOther1,
    topOther2,
    topOther3,
  ];
  const fullDeck = options?.noRevealedKasumi
    ? [topOther1, topOther2, topOther3, stageOther]
    : [revealedKasumi, topOther1, topOther2, topOther3];
  const deckCards = fullDeck.slice(0, options?.deckSize ?? 4);

  let game = createGameState('n-bp5-029-mutekikyu-believer', PLAYER1, 'P1', PLAYER2, 'P2');
  game = registerCards(game, registeredCards);
  game = updatePlayer(game, PLAYER1, (player) => {
    let memberSlots = options?.noStageKasumi
      ? placeCardInSlot(player.memberSlots, SlotPosition.CENTER, stageOther.instanceId, {
          orientation: OrientationState.ACTIVE,
          face: FaceState.FACE_UP,
        })
      : placeCardInSlot(player.memberSlots, SlotPosition.CENTER, stageKasumi.instanceId, {
          orientation: OrientationState.ACTIVE,
          face: FaceState.FACE_UP,
        });
    if (!options?.noStageKasumi) {
      memberSlots = placeCardInSlot(memberSlots, SlotPosition.RIGHT, secondStageKasumi.instanceId, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      });
    }
    return {
      ...player,
      liveZone: {
        ...player.liveZone,
        cardIds: options?.removeLiveSource ? [] : [live.instanceId],
      },
      mainDeck: {
        ...player.mainDeck,
        cardIds: deckCards.map((card) => card.instanceId),
      },
      memberSlots,
    };
  });

  return {
    game: {
      ...game,
      pendingAbilities: [
        {
          id: 'mutekikyu-live-start',
          abilityId: N_BP5_029_LIVE_START_REVEAL_KASUMI_HEARTS_ABILITY_ID,
          sourceCardId: live.instanceId,
          controllerId: PLAYER1,
          mandatory: true,
          timingId: TriggerCondition.ON_LIVE_START,
          eventIds: ['mutekikyu-live-start'],
        },
      ],
    },
    liveId: live.instanceId,
    stageKasumiId: stageKasumi.instanceId,
    secondStageKasumiId: secondStageKasumi.instanceId,
    deckCardIds: deckCards.map((card) => card.instanceId),
    revealedKasumiId: revealedKasumi.instanceId,
  };
}

function playerOne(game: GameState) {
  const player = game.players.find((candidate) => candidate.id === PLAYER1);
  if (!player) {
    throw new Error('missing player1');
  }
  return player;
}

function heartCount(game: GameState, memberCardId: string, color: HeartColor): number {
  return getMemberEffectiveHeartIcons(game, PLAYER1, memberCardId)
    .filter((heart) => heart.color === color)
    .reduce((sum, heart) => sum + heart.count, 0);
}

function hasInspectionEnterWaitingRoomEvent(
  game: GameState,
  movedCardIds: readonly string[]
): boolean {
  return game.eventLog.some(
    (entry) =>
      entry.event.eventType === TriggerCondition.ON_ENTER_WAITING_ROOM &&
      entry.event.cardInstanceIds?.length === movedCardIds.length &&
      movedCardIds.every((cardId) => entry.event.cardInstanceIds?.includes(cardId) === true)
  );
}

function startLiveStartFromCheckTiming(game: GameState): GameState {
  const result = new GameService().executeCheckTiming(
    { ...game, pendingAbilities: [] },
    [TriggerCondition.ON_LIVE_START]
  );
  expect(result.success, result.error).toBe(true);
  return result.gameState;
}

describe('PL!N-bp5-029-L 無敵級*ビリーバー live-start workflow', () => {
  it('queues from the real LIVE_START timing path when stage Kasumi is present', () => {
    const scenario = setupMutekikyuScenario();
    const started = startLiveStartFromCheckTiming(scenario.game);

    expect(started.activeEffect?.abilityId).toBe(
      N_BP5_029_LIVE_START_REVEAL_KASUMI_HEARTS_ABILITY_ID
    );
    expect(started.activeEffect?.stepText).toContain('请选择公开卡中的1张「中須かすみ」卡');
    expect(started.activeEffect?.selectableCardIds).toEqual([scenario.revealedKasumiId]);
    expect(started.inspectionZone.revealedCardIds).toEqual(scenario.deckCardIds);
  });

  it('reveals top four, selects Kasumi cards, grants each unique printed Heart color, and moves all revealed cards to waiting room', () => {
    const scenario = setupMutekikyuScenario();
    const started = resolvePendingCardEffects(scenario.game).gameState;

    expect(started.activeEffect?.abilityId).toBe(
      N_BP5_029_LIVE_START_REVEAL_KASUMI_HEARTS_ABILITY_ID
    );
    expect(started.activeEffect?.metadata?.confirmOnlyPendingAbility).not.toBe(true);
    expect(started.activeEffect?.effectText).toContain('【LIVE开始时】');
    expect(started.activeEffect?.stepText).toContain('请选择公开卡中的1张「中須かすみ」卡');
    expect(started.activeEffect?.stepText).not.toContain('确认后');
    expect(started.activeEffect?.selectableCardIds).toEqual([scenario.revealedKasumiId]);
    expect(started.inspectionZone.cardIds).toEqual(scenario.deckCardIds);
    expect(started.inspectionZone.revealedCardIds).toEqual(scenario.deckCardIds);
    expect(playerOne(started).mainDeck.cardIds).toEqual([]);

    const targetSelection = confirmActiveEffectStep(
      started,
      PLAYER1,
      started.activeEffect!.id,
      scenario.revealedKasumiId
    );
    expect(targetSelection.activeEffect?.stepText).toContain('其获得所选卡持有颜色的Heart');
    expect(targetSelection.activeEffect?.selectableCardIds).toEqual([
      scenario.stageKasumiId,
      scenario.secondStageKasumiId,
    ]);

    const result = confirmActiveEffectStep(
      targetSelection,
      PLAYER1,
      targetSelection.activeEffect!.id,
      scenario.stageKasumiId
    );

    expect(result.activeEffect).toBeNull();
    expect(result.pendingAbilities).toEqual([]);
    expect(playerOne(result).waitingRoom.cardIds).toEqual(scenario.deckCardIds);
    expect(result.inspectionZone.cardIds).toEqual([]);
    expect(result.inspectionZone.revealedCardIds).toEqual([]);
    expect(hasInspectionEnterWaitingRoomEvent(result, scenario.deckCardIds)).toBe(true);
    expect(heartCount(result, scenario.stageKasumiId, HeartColor.GREEN)).toBe(1);
    expect(heartCount(result, scenario.stageKasumiId, HeartColor.PINK)).toBe(1);
    expect(heartCount(result, scenario.stageKasumiId, HeartColor.RED)).toBe(1);
    expect(heartCount(result, scenario.stageKasumiId, HeartColor.PURPLE)).toBe(0);
  });

  it('no-ops without stage Kasumi or when the LIVE source left the live zone without revealing cards', () => {
    for (const scenario of [
      setupMutekikyuScenario({ noStageKasumi: true }),
      setupMutekikyuScenario({ removeLiveSource: true }),
    ]) {
      const result = resolvePendingCardEffects(scenario.game).gameState;

      expect(result.activeEffect).toBeNull();
      expect(result.pendingAbilities).toEqual([]);
      expect(playerOne(result).mainDeck.cardIds).toEqual(scenario.deckCardIds);
      expect(playerOne(result).waitingRoom.cardIds).toEqual([]);
      expect(result.inspectionZone.cardIds).toEqual([]);
      expect(result.eventLog).toEqual([]);
    }
  });

  it('moves revealed cards to waiting room and grants no Heart when no revealed card is Kasumi', () => {
    const scenario = setupMutekikyuScenario({ noRevealedKasumi: true });
    const started = resolvePendingCardEffects(scenario.game).gameState;

    expect(started.activeEffect?.stepText).toBe(
      '公开卡中没有「中須かすみ」卡。公开的卡全部放置入休息室。'
    );
    expect(started.activeEffect?.selectableCardIds).toEqual([]);
    expect(started.inspectionZone.revealedCardIds).toEqual(scenario.deckCardIds);
    expect(playerOne(started).waitingRoom.cardIds).toEqual([]);

    const result = confirmActiveEffectStep(started, PLAYER1, started.activeEffect!.id);
    expect(result.activeEffect).toBeNull();
    expect(result.pendingAbilities).toEqual([]);
    expect(playerOne(result).waitingRoom.cardIds).toEqual(scenario.deckCardIds);
    expect(result.inspectionZone.cardIds).toEqual([]);
    expect(hasInspectionEnterWaitingRoomEvent(result, scenario.deckCardIds)).toBe(true);
    expect(heartCount(result, scenario.stageKasumiId, HeartColor.PINK)).toBe(0);
    expect(result.liveResolution.liveModifiers).toEqual([]);
  });

  it('reveals only the available deck cards when the deck has fewer than four cards', () => {
    const scenario = setupMutekikyuScenario({ deckSize: 2 });
    const started = resolvePendingCardEffects(scenario.game).gameState;

    expect(started.inspectionZone.cardIds).toEqual(scenario.deckCardIds);
    expect(started.activeEffect?.selectableCardIds).toEqual([scenario.revealedKasumiId]);

    const targetSelection = confirmActiveEffectStep(
      started,
      PLAYER1,
      started.activeEffect!.id,
      scenario.revealedKasumiId
    );
    const result = confirmActiveEffectStep(
      targetSelection,
      PLAYER1,
      targetSelection.activeEffect!.id,
      scenario.stageKasumiId
    );

    expect(playerOne(result).waitingRoom.cardIds).toEqual(scenario.deckCardIds);
    expect(result.inspectionZone.cardIds).toEqual([]);
    expect(hasInspectionEnterWaitingRoomEvent(result, scenario.deckCardIds)).toBe(true);
    expect(heartCount(result, scenario.stageKasumiId, HeartColor.PINK)).toBe(1);
    expect(heartCount(result, scenario.stageKasumiId, HeartColor.RED)).toBe(1);
  });

  it('moves revealed cards to waiting room and grants no Heart if the selected stage Kasumi disappears before selection resolves', () => {
    const scenario = setupMutekikyuScenario();
    const started = resolvePendingCardEffects(scenario.game).gameState;
    const targetSelection = confirmActiveEffectStep(
      started,
      PLAYER1,
      started.activeEffect!.id,
      scenario.revealedKasumiId
    );
    const targetRemoved = updatePlayer(targetSelection, PLAYER1, (player) => ({
      ...player,
      memberSlots: removeCardFromSlot(player.memberSlots, SlotPosition.CENTER),
    }));

    const result = confirmActiveEffectStep(
      targetRemoved,
      PLAYER1,
      targetRemoved.activeEffect!.id,
      scenario.stageKasumiId
    );

    expect(result.activeEffect).toBeNull();
    expect(playerOne(result).waitingRoom.cardIds).toEqual(scenario.deckCardIds);
    expect(hasInspectionEnterWaitingRoomEvent(result, scenario.deckCardIds)).toBe(true);
    expect(result.liveResolution.liveModifiers).toEqual([]);
  });
});
