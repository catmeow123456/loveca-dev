import { describe, expect, it } from 'vitest';
import type { EnergyCardData, LiveCardData, MemberCardData } from '../../src/domain/entities/card';
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
  placeCardInSlot,
  removeCardFromStatefulZone,
} from '../../src/domain/entities/zone';
import {
  ABILITY_ORDER_SELECTION_ID,
  confirmActiveEffectStep,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import { GameService } from '../../src/application/game-service';
import { createPublicObjectId, projectPlayerViewState } from '../../src/online/projector';
import {
  S_BP7_021_LIVE_START_STAGE_THREE_MILL_BOTTOM_FIVE_MEMBER_REWARDS_ABILITY_ID,
  SP_BP5_005_AUTO_MAIN_PHASE_CARD_ENTER_WAITING_ROOM_PAY_ENERGY_RECOVER_ABILITY_ID,
} from '../../src/application/card-effects/ability-ids';
import {
  CardType,
  FaceState,
  HeartColor,
  OrientationState,
  SlotPosition,
  TriggerCondition,
  ZoneType,
} from '../../src/shared/types/enums';

const P1 = 'p1';
const P2 = 'p2';
const ABILITY_ID = S_BP7_021_LIVE_START_STAGE_THREE_MILL_BOTTOM_FIVE_MEMBER_REWARDS_ABILITY_ID;

type TestCard = ReturnType<typeof member> | ReturnType<typeof live> | ReturnType<typeof energy>;

function member(id: string, groupNames: readonly string[] = ['Aqours']) {
  const data: MemberCardData = {
    cardCode: id,
    name: id,
    groupNames,
    cardType: CardType.MEMBER,
    cost: 1,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.BLUE, 1)],
  };
  return createCardInstance(data, P1, id);
}

function live(id: string, instanceId = id) {
  const data: LiveCardData = {
    cardCode: id,
    name: id,
    groupNames: ['Aqours'],
    cardType: CardType.LIVE,
    score: 1,
    requirements: createHeartRequirement({ [HeartColor.RAINBOW]: 1 }),
  };
  return createCardInstance(data, P1, instanceId);
}

function energy(id: string) {
  const data: EnergyCardData = { cardCode: id, name: id, cardType: CardType.ENERGY };
  return createCardInstance(data, P1, id);
}

function pending(id = 'pending'): PendingAbilityState {
  return {
    id,
    abilityId: ABILITY_ID,
    sourceCardId: 'source-live',
    controllerId: P1,
    mandatory: true,
    timingId: TriggerCondition.ON_LIVE_START,
  };
}

function setup(options: {
  readonly stageCount: number;
  readonly bottomFive?: readonly TestCard[];
  readonly waitingCards?: readonly TestCard[];
  readonly extraStageCardCode?: string;
}) {
  const sourceWithStableId = live('PL!S-bp7-021-L', 'source-live');
  const stageMembers = Array.from({ length: options.stageCount }, (_, index) =>
    member(
      index === 2 && options.extraStageCardCode ? options.extraStageCardCode : `stage-${index}`
    )
  );
  const drawCard = member('draw-card');
  const bottomFive = options.bottomFive ?? [];
  const waitingCards = options.waitingCards ?? [];
  let game = registerCards(createGameState('s-bp7-021', P1, 'P1', P2, 'P2'), [
    sourceWithStableId,
    ...stageMembers,
    drawCard,
    ...bottomFive,
    ...waitingCards,
  ]);
  game = updatePlayer(game, P1, (player) => {
    let memberSlots = player.memberSlots;
    const slots = [SlotPosition.LEFT, SlotPosition.CENTER, SlotPosition.RIGHT] as const;
    stageMembers.forEach((card, index) => {
      memberSlots = placeCardInSlot(memberSlots, slots[index]!, card.instanceId, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      });
    });
    return {
      ...player,
      memberSlots,
      liveZone: addCardToStatefulZone(player.liveZone, sourceWithStableId.instanceId),
      mainDeck: {
        ...player.mainDeck,
        cardIds:
          bottomFive.length > 0
            ? [drawCard.instanceId, ...bottomFive.map((card) => card.instanceId)]
            : [],
      },
      waitingRoom: {
        ...player.waitingRoom,
        cardIds: waitingCards.map((card) => card.instanceId),
      },
    };
  });
  return {
    source: sourceWithStableId,
    drawCard,
    game: { ...game, pendingAbilities: [pending()] },
  };
}

function confirm(game: GameState): GameState {
  const waiting = resolvePendingCardEffects(game).gameState;
  if (!waiting.activeEffect) {
    return waiting;
  }
  if (waiting.activeEffect.stepId === 'S_BP7_021_REVEAL_MILLED_BOTTOM_FIVE') {
    expect(waiting.activeEffect.metadata?.confirmOnlyPendingAbility).not.toBe(true);
  } else {
    expect(waiting.activeEffect.metadata?.confirmOnlyPendingAbility).toBe(true);
  }
  return confirmActiveEffectStep(waiting, P1, waiting.activeEffect!.id);
}

function scoreModifiers(game: GameState) {
  return game.liveResolution.liveModifiers.filter(
    (modifier) => modifier.kind === 'SCORE' && modifier.abilityId === ABILITY_ID
  );
}

function lastResolve(game: GameState) {
  return game.actionHistory.findLast(
    (action) => action.type === 'RESOLVE_ABILITY' && action.payload.abilityId === ABILITY_ID
  );
}

describe('PL!S-bp7-021-L 分数5「我们的旅程永不落幕」', () => {
  it.each([0, 1, 2])('does nothing with only %i own top-stage members', (stageCount) => {
    const cards = [member('m1'), member('m2'), member('m3'), member('m4'), member('m5')];
    const scenario = setup({ stageCount, bottomFive: cards });
    const beforeDeck = scenario.game.players[0].mainDeck.cardIds;
    const done = confirm(scenario.game);
    expect(done.players[0].mainDeck.cardIds).toEqual(beforeDeck);
    expect(done.players[0].hand.cardIds).toEqual([]);
    expect(scoreModifiers(done)).toEqual([]);
    expect(lastResolve(done)?.payload).toMatchObject({
      stageMemberCount: stageCount,
      movedCardIds: [],
      drawnCardIds: [],
      scoreBonus: 0,
    });
  });

  it.each([
    [0, [live('l1'), live('l2'), energy('e1'), energy('e2'), live('l3')]],
    [2, [member('m1'), live('l1'), member('m2'), energy('e1'), live('l2')]],
  ])('gives no rewards for %i members among five moved cards', (_memberCount, cards) => {
    const done = confirm(setup({ stageCount: 3, bottomFive: cards }).game);
    expect(done.players[0].hand.cardIds).toEqual([]);
    expect(scoreModifiers(done)).toEqual([]);
  });

  it.each([3, 4])('draws one but does not gain score for exactly %i members', (memberCount) => {
    const cards: TestCard[] = Array.from({ length: memberCount }, (_, index) =>
      member(`member-${memberCount}-${index}`, ['虹ヶ咲'])
    );
    while (cards.length < 5)
      cards.push(
        cards.length % 2 === 0 ? live(`live-${cards.length}`) : energy(`energy-${cards.length}`)
      );
    const scenario = setup({ stageCount: 3, bottomFive: cards });
    const done = confirm(scenario.game);
    expect(done.players[0].hand.cardIds).toEqual([scenario.drawCard.instanceId]);
    expect(scoreModifiers(done)).toEqual([]);
    expect(lastResolve(done)?.payload).toMatchObject({ memberCount, scoreBonus: 0 });
  });

  it('counts non-Aqours MEMBER cards and gives both draw one and source-LIVE score +1 for all five', () => {
    const cards = Array.from({ length: 5 }, (_, index) =>
      member(`nijigasaki-${index}`, ['虹ヶ咲'])
    );
    const scenario = setup({ stageCount: 3, bottomFive: cards });
    const done = confirm(scenario.game);
    expect(done.players[0].hand.cardIds).toEqual([scenario.drawCard.instanceId]);
    expect(scoreModifiers(done)).toEqual([
      expect.objectContaining({
        playerId: P1,
        countDelta: 1,
        liveCardId: scenario.source.instanceId,
        sourceCardId: scenario.source.instanceId,
        abilityId: ABILITY_ID,
      }),
    ]);
    expect(done.liveResolution.playerScores.get(P1)).toBe(1);
    expect(lastResolve(done)?.payload).toMatchObject({ memberCount: 5, scoreBonus: 1 });
  });

  it('uses the actual refresh-aware moved set, then draws correctly even when drawing itself needs the refreshed deck', () => {
    const refreshMembers = Array.from({ length: 5 }, (_, index) =>
      member(`refresh-member-${index}`)
    );
    const scenario = setup({ stageCount: 3, waitingCards: refreshMembers });
    const done = confirm(scenario.game);
    expect(lastResolve(done)?.payload).toMatchObject({
      movedCardIds: expect.any(Array),
      memberCount: 5,
      scoreBonus: 1,
    });
    expect(lastResolve(done)?.payload.movedCardIds as readonly string[]).toHaveLength(5);
    expect(done.players[0].hand.cardIds).toHaveLength(1);
    expect(scoreModifiers(done)).toHaveLength(1);
  });

  it('keeps an unavailable partial/zero move and gives no reward when five cards cannot actually move', () => {
    const done = confirm(setup({ stageCount: 3 }).game);
    expect(lastResolve(done)?.payload).toMatchObject({
      movedCardIds: [],
      memberCount: 0,
      drawnCardIds: [],
      scoreBonus: 0,
    });
    expect(done.players[0].hand.cardIds).toEqual([]);
    expect(scoreModifiers(done)).toEqual([]);
  });

  it('writes one grouped MAIN_DECK -> WAITING_ROOM event with the exact cause after rewards/action preparation', () => {
    const cards = Array.from({ length: 5 }, (_, index) => member(`event-member-${index}`));
    const scenario = setup({ stageCount: 3, bottomFive: cards });
    const done = confirm(scenario.game);
    const events = done.eventLog
      .map((entry) => entry.event)
      .filter((event) => event.eventType === TriggerCondition.ON_ENTER_WAITING_ROOM);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      cardInstanceIds: cards.map((card) => card.instanceId).reverse(),
      fromZone: ZoneType.MAIN_DECK,
      toZone: ZoneType.WAITING_ROOM,
      cause: {
        kind: 'CARD_EFFECT',
        playerId: P1,
        sourceCardId: scenario.source.instanceId,
        abilityId: ABILITY_ID,
        pendingAbilityId: 'pending',
      },
    });
    const resolveIndex = done.actionHistory.findIndex(
      (action) => action.type === 'RESOLVE_ABILITY' && action.payload.abilityId === ABILITY_ID
    );
    expect(resolveIndex).toBeGreaterThanOrEqual(0);
  });

  it('clears the score modifier at standard LIVE end', () => {
    const cards = Array.from({ length: 5 }, (_, index) => member(`finish-member-${index}`));
    const done = confirm(setup({ stageCount: 3, bottomFive: cards }).game);
    expect(scoreModifiers(done)).toHaveLength(1);
    const finalized = new GameService().finalizeLiveResult(done);
    expect(finalized.success).toBe(true);
    expect(finalized.gameState.liveResolution.liveModifiers).toEqual([]);
  });

  it('safely no-ops after the source leaves the LIVE zone', () => {
    const cards = Array.from({ length: 5 }, (_, index) => member(`stale-member-${index}`));
    const scenario = setup({ stageCount: 3, bottomFive: cards });
    const game = updatePlayer(scenario.game, P1, (player) => ({
      ...player,
      liveZone: removeCardFromStatefulZone(player.liveZone, scenario.source.instanceId),
    }));
    const beforeDeck = game.players[0].mainDeck.cardIds;
    const done = confirm(game);
    expect(done.players[0].mainDeck.cardIds).toEqual(beforeDeck);
    expect(scoreModifiers(done)).toEqual([]);
  });

  it('publicly reveals the five moved bottom cards to both players before drawing or gaining score', () => {
    const cards = Array.from({ length: 5 }, (_, index) => member(`hidden-member-${index}`));
    const scenario = setup({ stageCount: 3, bottomFive: cards });
    const revealed = resolvePendingCardEffects(scenario.game).gameState;
    const movedCardIds = cards.map((card) => card.instanceId).reverse();
    expect(revealed.activeEffect?.stepId).toBe('S_BP7_021_REVEAL_MILLED_BOTTOM_FIVE');
    expect(revealed.activeEffect?.revealedCardIds).toEqual(movedCardIds);
    expect(revealed.activeEffect?.stepText).toContain('其中成员卡5张');
    expect(revealed.activeEffect?.stepText).toContain('确认后抽1张，此LIVE[スコア]+1');
    expect(revealed.players[0].waitingRoom.cardIds).toEqual(movedCardIds);
    expect(revealed.players[0].hand.cardIds).toEqual([]);
    expect(scoreModifiers(revealed)).toEqual([]);
    for (const viewerId of [P1, P2]) {
      expect(projectPlayerViewState(revealed, viewerId).activeEffect?.revealedObjectIds).toEqual(
        movedCardIds.map(createPublicObjectId)
      );
    }
    const done = confirmActiveEffectStep(revealed, P1, revealed.activeEffect!.id);
    expect(done.players[0].hand.cardIds).toEqual([scenario.drawCard.instanceId]);
    expect(scoreModifiers(done)).toHaveLength(1);
  });

  it('interrupts an ordered batch when the mill creates a new waiting-room pending', () => {
    const source = live('PL!S-bp7-021-L', 'ordered-source-a');
    const listener = member('PL!SP-bp5-005-R');
    const otherSource = live('PL!S-bp7-021-L', 'ordered-source-b');
    const stage = [member('stage-a'), member('stage-b'), listener];
    const cards = Array.from({ length: 10 }, (_, index) => member(`ordered-${index}`));
    let game = registerCards(createGameState('s-bp7-021-ordered', P1, 'P1', P2, 'P2'), [
      source,
      otherSource,
      ...stage,
      ...cards,
    ]);
    game = updatePlayer(game, P1, (player) => ({
      ...player,
      memberSlots: placeCardInSlot(
        placeCardInSlot(
          placeCardInSlot(player.memberSlots, SlotPosition.LEFT, stage[0]!.instanceId),
          SlotPosition.CENTER,
          stage[1]!.instanceId
        ),
        SlotPosition.RIGHT,
        listener.instanceId
      ),
      liveZone: addCardToStatefulZone(
        addCardToStatefulZone(player.liveZone, source.instanceId),
        otherSource.instanceId
      ),
      mainDeck: { ...player.mainDeck, cardIds: cards.map((card) => card.instanceId) },
    }));
    game = {
      ...game,
      pendingAbilities: [
        { ...pending('a'), sourceCardId: source.instanceId },
        { ...pending('b'), sourceCardId: otherSource.instanceId },
      ],
    };
    const order = resolvePendingCardEffects(game).gameState;
    expect(order.activeEffect?.abilityId).toBe(ABILITY_ORDER_SELECTION_ID);
    const reveal = confirmActiveEffectStep(order, P1, order.activeEffect!.id, null, null, true);
    expect(reveal.activeEffect?.stepId).toBe('S_BP7_021_REVEAL_MILLED_BOTTOM_FIVE');
    expect(reveal.activeEffect?.revealedCardIds).toHaveLength(5);
    expect(scoreModifiers(reveal)).toEqual([]);
    const reopened = confirmActiveEffectStep(reveal, P1, reveal.activeEffect!.id);
    expect(reopened.activeEffect?.abilityId).toBe(ABILITY_ORDER_SELECTION_ID);
    expect(reopened.pendingAbilities.map((ability) => ability.id)).toContain('b');
    expect(
      reopened.pendingAbilities.some(
        (ability) =>
          ability.abilityId ===
          SP_BP5_005_AUTO_MAIN_PHASE_CARD_ENTER_WAITING_ROOM_PAY_ENERGY_RECOVER_ABILITY_ID
      )
    ).toBe(true);
  });
});
