import { describe, expect, it } from 'vitest';
import {
  createCardInstance,
  createHeartIcon,
  type MemberCardData,
} from '../../src/domain/entities/card';
import {
  createGameState,
  registerCards,
  updatePlayer,
  type GameState,
  type PendingAbilityState,
} from '../../src/domain/entities/game';
import { placeCardInSlot } from '../../src/domain/entities/zone';
import {
  confirmActiveEffectStep,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import {
  PL_N_BP4_026_AUTO_WAITING_TO_HAND_PLACE_DIVE_LIVE_ABILITY_ID,
  S_BP7_008_LIVE_START_MILL_BOTTOM_ONE_RECOVER_KANAN_OR_DIA_ABILITY_ID,
  S_BP7_008_ON_ENTER_ARRANGE_TOP_THREE_TO_TOP_AND_BOTTOM_ABILITY_ID,
} from '../../src/application/card-effects/ability-ids';
import { findCardAbilityDefinitionById } from '../../src/application/card-effects/definitions/lookup';
import { PUBLIC_REVEAL_DWELL_STEP_ID } from '../../src/application/card-effects/runtime/public-reveal-dwell';
import {
  CardAbilityCategory,
  CardAbilitySourceZone,
} from '../../src/application/card-effects/ability-definition-types';
import {
  CardType,
  FaceState,
  GamePhase,
  HeartColor,
  OrientationState,
  SlotPosition,
  TriggerCondition,
  ZoneType,
} from '../../src/shared/types/enums';

const P1 = 'p1';
const P2 = 'p2';
const SOURCE_ID = 'mari-source';
const SOURCE_CODE = 'PL!S-bp7-008-SEC';

function member(cardCode: string, name = cardCode, ownerId = P1) {
  const data: MemberCardData = {
    cardCode,
    name,
    groupNames: ['Aqours'],
    cardType: CardType.MEMBER,
    cost: cardCode.startsWith('PL!S-bp7-008') ? 9 : 1,
    blade: 2,
    hearts: [createHeartIcon(HeartColor.RED, 1)],
  };
  return createCardInstance(data, ownerId, cardCode === SOURCE_CODE ? SOURCE_ID : cardCode);
}

function pending(abilityId: string, timingId: TriggerCondition): PendingAbilityState {
  return {
    id: `${abilityId}:pending`,
    abilityId,
    sourceCardId: SOURCE_ID,
    controllerId: P1,
    mandatory: true,
    timingId,
    eventIds: ['event'],
    sourceSlot: SlotPosition.CENTER,
  };
}

function setupDeck(cardNames = ['A', 'B', 'C', 'D']) {
  const source = member(SOURCE_CODE, '小原鞠莉');
  const cards = cardNames.map((name, index) => member(`TEST-${name}-${index}`, name));
  let game = registerCards(createGameState('s-bp7-008', P1, 'P1', P2, 'P2'), [source, ...cards]);
  game = updatePlayer(game, P1, (player) => ({
    ...player,
    mainDeck: { ...player.mainDeck, cardIds: cards.map((card) => card.instanceId) },
    memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, SOURCE_ID, {
      orientation: OrientationState.ACTIVE,
      face: FaceState.FACE_UP,
    }),
  }));
  return { game, cardIds: cards.map((card) => card.instanceId) };
}

function startArrange(game: GameState) {
  return resolvePendingCardEffects({
    ...game,
    pendingAbilities: [
      pending(
        S_BP7_008_ON_ENTER_ARRANGE_TOP_THREE_TO_TOP_AND_BOTTOM_ABILITY_ID,
        TriggerCondition.ON_ENTER_STAGE
      ),
    ],
  }).gameState;
}

function startLive(game: GameState) {
  return resolvePendingCardEffects({
    ...game,
    pendingAbilities: [
      pending(
        S_BP7_008_LIVE_START_MILL_BOTTOM_ONE_RECOVER_KANAN_OR_DIA_ABILITY_ID,
        TriggerCondition.ON_LIVE_START
      ),
    ],
  }).gameState;
}

function confirmCards(game: GameState, cardIds: readonly string[]) {
  return confirmActiveEffectStep(
    game,
    P1,
    game.activeEffect!.id,
    undefined,
    undefined,
    undefined,
    undefined,
    cardIds
  );
}

describe('PL!S-bp7-008 费用9「小原鞠莉」', () => {
  it('registers two independently classified base-code abilities with exact player text', () => {
    const onEnter = findCardAbilityDefinitionById(
      S_BP7_008_ON_ENTER_ARRANGE_TOP_THREE_TO_TOP_AND_BOTTOM_ABILITY_ID
    )!;
    const liveStart = findCardAbilityDefinitionById(
      S_BP7_008_LIVE_START_MILL_BOTTOM_ONE_RECOVER_KANAN_OR_DIA_ABILITY_ID
    )!;
    expect(onEnter).toMatchObject({
      baseCardCodes: ['PL!S-bp7-008'],
      category: CardAbilityCategory.ON_ENTER,
      sourceZone: CardAbilitySourceZone.PLAYED_MEMBER,
      triggerCondition: TriggerCondition.ON_ENTER_STAGE,
      queued: true,
      implemented: true,
    });
    expect(onEnter.effectText).toBe(
      '【登场】检视自己的卡组顶的3张卡片。将其中任意张数的卡片按任意顺序放置于卡组顶，其余的按任意顺序放置于卡组底。'
    );
    expect(liveStart).toMatchObject({
      baseCardCodes: ['PL!S-bp7-008'],
      category: CardAbilityCategory.LIVE_START,
      sourceZone: CardAbilitySourceZone.STAGE_MEMBER,
      triggerCondition: TriggerCondition.ON_LIVE_START,
      queued: true,
      implemented: true,
    });
    expect(liveStart.effectText).toBe(
      '【LIVE开始时】可以将自己的卡组底的卡片放置入休息室。那张卡片是「松浦果南」或「黑泽黛雅」的场合，将其加入手牌。'
    );
  });

  it.each([
    {
      label: '0张置顶时排序全部3张到底',
      topSelection: [] as string[],
      bottomOrderIndexes: [2, 0, 1],
      expectedIndexes: [3, 1, 0, 2],
      opensSecondStep: true,
    },
    {
      label: '1张置顶时排序其余2张到底',
      topSelection: [1],
      bottomOrderIndexes: [2, 0],
      expectedIndexes: [1, 3, 0, 2],
      opensSecondStep: true,
    },
    {
      label: '2张置顶时余下1张自动置底',
      topSelection: [1, 0],
      bottomOrderIndexes: [],
      expectedIndexes: [1, 0, 3, 2],
      opensSecondStep: false,
    },
    {
      label: '3张置顶时无余牌并自动完成',
      topSelection: [2, 0, 1],
      bottomOrderIndexes: [],
      expectedIndexes: [2, 0, 1, 3],
      opensSecondStep: false,
    },
  ])('$label', ({ topSelection, bottomOrderIndexes, expectedIndexes, opensSecondStep }) => {
    const scenario = setupDeck();
    const started = startArrange(scenario.game);
    expect(started.activeEffect).toMatchObject({
      selectableCardIds: scenario.cardIds.slice(0, 3),
      selectableCardVisibility: 'AWAITING_PLAYER_ONLY',
      selectableCardMode: 'ORDERED_MULTI',
      minSelectableCards: 0,
      maxSelectableCards: 3,
      selectionLabel: '按放置顺序选择卡片',
      confirmSelectionLabel: '按此顺序放置于卡组顶',
    });
    const afterTop = confirmCards(
      started,
      topSelection.map((index) => scenario.cardIds[index]!)
    );
    const finished = opensSecondStep
      ? confirmCards(
          afterTop,
          bottomOrderIndexes.map((index) => scenario.cardIds[index]!)
        )
      : afterTop;
    if (opensSecondStep) {
      expect(afterTop.activeEffect).toMatchObject({
        selectableCardMode: 'ORDERED_MULTI',
        minSelectableCards: bottomOrderIndexes.length,
        maxSelectableCards: bottomOrderIndexes.length,
        selectionLabel: '按放置顺序选择卡片',
        confirmSelectionLabel: '按此顺序放置于卡组底',
      });
    }
    expect(finished.activeEffect).toBeNull();
    expect(finished.players[0].mainDeck.cardIds).toEqual(
      expectedIndexes.map((index) => scenario.cardIds[index]!)
    );
    expect(finished.inspectionZone.cardIds).toEqual([]);
    expect(
      finished.eventLog.filter(
        ({ event }) =>
          event.eventType === TriggerCondition.ON_ENTER_WAITING_ROOM &&
          event.fromZone === ZoneType.MAIN_DECK
      )
    ).toEqual([]);
  });

  it('rejects a duplicate or incomplete second-step bottom ordering', () => {
    const scenario = setupDeck();
    const secondStep = confirmCards(startArrange(scenario.game), [scenario.cardIds[1]!]);
    expect(confirmCards(secondStep, [scenario.cardIds[0]!, scenario.cardIds[0]!])).toBe(secondStep);
    expect(confirmCards(secondStep, [scenario.cardIds[0]!])).toBe(secondStep);
  });

  it('can decline the LIVE-start effect without moving the deck bottom', () => {
    const scenario = setupDeck();
    const started = startLive(scenario.game);
    expect(started.activeEffect).toMatchObject({
      selectableOptions: [{ id: 'activate', label: '发动' }],
      canSkipSelection: true,
      skipSelectionLabel: '不发动',
    });
    const declined = confirmActiveEffectStep(started, P1, started.activeEffect!.id);
    expect(declined.activeEffect).toBeNull();
    expect(declined.players[0].mainDeck.cardIds).toEqual(scenario.cardIds);
    expect(declined.players[0].waitingRoom.cardIds).toEqual([]);
  });

  it.each([
    ['松浦果南', true],
    ['黑泽黛雅', true],
    ['黒澤ダイヤ', true],
    ['不命中成员', false],
  ])('moves bottom identity %s to waiting, dwells publicly, then recovery=%s', (name, matched) => {
    const scenario = setupDeck(['A', 'B', 'C', name]);
    const started = startLive(scenario.game);
    const revealing = confirmActiveEffectStep(
      started,
      P1,
      started.activeEffect!.id,
      undefined,
      undefined,
      undefined,
      'activate'
    );
    const bottomId = scenario.cardIds[3]!;
    expect(revealing.activeEffect).toMatchObject({
      stepId: PUBLIC_REVEAL_DWELL_STEP_ID,
      revealedCardIds: [bottomId],
    });
    expect(revealing.players[0].waitingRoom.cardIds).toContain(bottomId);
    expect(revealing.players[0].hand.cardIds).not.toContain(bottomId);
    const finished = confirmActiveEffectStep(revealing, P1, revealing.activeEffect!.id);
    expect(finished.activeEffect).toBeNull();
    expect(finished.players[0].hand.cardIds.includes(bottomId)).toBe(matched);
    expect(finished.players[0].waitingRoom.cardIds.includes(bottomId)).toBe(!matched);
    const waitingEvents = finished.eventLog.filter(
      ({ event }) =>
        event.eventType === TriggerCondition.ON_ENTER_WAITING_ROOM &&
        event.fromZone === ZoneType.MAIN_DECK
    );
    expect(waitingEvents).toHaveLength(1);
    expect(waitingEvents[0]?.event.cardInstanceIds).toEqual([bottomId]);
    const enterHandEvents = finished.eventLog.filter(
      ({ event }) =>
        event.eventType === TriggerCondition.ON_ENTER_HAND &&
        event.fromZone === ZoneType.WAITING_ROOM
    );
    expect(enterHandEvents).toHaveLength(matched ? 1 : 0);
    if (matched) {
      expect(enterHandEvents[0]?.event.cardInstanceIds).toEqual([bottomId]);
    }
  });

  it('dispatches the fixed recovery ON_ENTER_HAND trigger before continuation closes', () => {
    const source = member(SOURCE_CODE, '小原鞠莉');
    const topCards = ['A', 'B', 'C'].map((name, index) =>
      member(`TEST-CONTINUATION-${index}`, name)
    );
    const diveKanan = createCardInstance(
      {
        cardCode: 'PL!N-bp4-026-L',
        name: '松浦果南',
        groupNames: ['虹ヶ咲'],
        cardType: CardType.LIVE,
        score: 4,
        requiredHearts: [],
      },
      P1,
      'dive-kanan'
    );
    let game = registerCards(createGameState('s-bp7-008-continuation', P1, 'P1', P2, 'P2'), [
      source,
      ...topCards,
      diveKanan,
    ]);
    game = { ...game, currentPhase: GamePhase.MAIN_PHASE };
    game = updatePlayer(game, P1, (player) => ({
      ...player,
      mainDeck: {
        ...player.mainDeck,
        cardIds: [...topCards.map((card) => card.instanceId), diveKanan.instanceId],
      },
      memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, SOURCE_ID, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      }),
    }));
    const started = startLive(game);
    const revealing = confirmActiveEffectStep(
      started,
      P1,
      started.activeEffect!.id,
      undefined,
      undefined,
      undefined,
      'activate'
    );
    const finished = confirmActiveEffectStep(revealing, P1, revealing.activeEffect!.id);
    expect(finished.players[0].hand.cardIds).toContain(diveKanan.instanceId);
    expect(
      finished.actionHistory.some(
        (action) =>
          action.type === 'TRIGGER_ABILITY' &&
          action.payload.abilityId === PL_N_BP4_026_AUTO_WAITING_TO_HAND_PLACE_DIVE_LIVE_ABILITY_ID
      )
    ).toBe(true);
  });

  it('does not recover the fixed bottom card if it leaves waiting room during the dwell', () => {
    const scenario = setupDeck(['A', 'B', 'C', '松浦果南']);
    const started = startLive(scenario.game);
    const revealing = confirmActiveEffectStep(
      started,
      P1,
      started.activeEffect!.id,
      undefined,
      undefined,
      undefined,
      'activate'
    );
    const bottomId = scenario.cardIds[3]!;
    const stale = updatePlayer(revealing, P1, (player) => ({
      ...player,
      waitingRoom: {
        ...player.waitingRoom,
        cardIds: player.waitingRoom.cardIds.filter((cardId) => cardId !== bottomId),
      },
    }));
    const finished = confirmActiveEffectStep(stale, P1, stale.activeEffect!.id);
    expect(finished.activeEffect).toBeNull();
    expect(finished.players[0].hand.cardIds).not.toContain(bottomId);
  });
});
