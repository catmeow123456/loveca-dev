import { describe, expect, it } from 'vitest';
import type { MemberCardData } from '../../src/domain/entities/card';
import { createCardInstance, createHeartIcon } from '../../src/domain/entities/card';
import {
  createGameState,
  emitGameEvent,
  registerCards,
  updatePlayer,
  type GameState,
  type PendingAbilityState,
} from '../../src/domain/entities/game';
import { addCardToZone, placeCardInSlot } from '../../src/domain/entities/zone';
import { createEnterStageEvent } from '../../src/domain/events/game-events';
import {
  confirmActiveEffectStep,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import { GameService } from '../../src/application/game-service';
import {
  HS_BP2_017_ON_ENTER_WAITING_ROOM_TEN_DRAW_ONE_ABILITY_ID,
  MEMBER_ON_ENTER_DRAW_ONE_ABILITY_ID,
  PL_PB1_005_ON_ENTER_HAS_SUCCESS_LIVE_DRAW_ONE_ABILITY_ID,
  SP_PB1_009_ON_ENTER_OTHER_FIVEYNCRISE_DRAW_ONE_ABILITY_ID,
  SP_PR_ON_ENTER_ENERGY_SEVEN_DRAW_ABILITY_ID,
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

const PLAYER1 = 'player1';
const PLAYER2 = 'player2';

function createMember(cardCode: string, name = cardCode, cost = 4): MemberCardData {
  return {
    cardCode,
    name,
    groupNames: ['蓮ノ空女学院スクールアイドルクラブ'],
    unitName: 'みらくらぱーく！',
    cardType: CardType.MEMBER,
    cost,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.PINK, 1)],
  };
}

function runOnEnterDrawOne(
  cardCode: string,
  name: string,
  sourceSlot: SlotPosition,
  options: {
    readonly energyCount?: number;
    readonly successLiveCardCount?: number;
    readonly abilityId?: string;
  } = {}
): {
  readonly state: GameState;
  readonly sourceId: string;
  readonly drawCardId: string;
} {
  const source = createCardInstance(createMember(cardCode, name), PLAYER1, `${cardCode}-source`);
  const drawCard = createCardInstance(
    createMember(`${cardCode}-draw`),
    PLAYER1,
    `${cardCode}-draw`
  );
  const energyCards = Array.from({ length: options.energyCount ?? 0 }, (_, index) =>
    createCardInstance(
      createMember(`${cardCode}-energy-${index}`),
      PLAYER1,
      `${cardCode}-energy-${index}`
    )
  );
  const successLiveCards = Array.from({ length: options.successLiveCardCount ?? 0 }, (_, index) =>
    createCardInstance(
      createMember(`${cardCode}-success-live-${index}`),
      PLAYER1,
      `${cardCode}-success-live-${index}`
    )
  );
  let game = createGameState(`member-on-enter-draw-${cardCode}`, PLAYER1, 'P1', PLAYER2, 'P2');
  game = registerCards(game, [source, drawCard, ...energyCards, ...successLiveCards]);
  game = updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    mainDeck: { ...player.mainDeck, cardIds: [drawCard.instanceId] },
    energyZone: energyCards.reduce(
      (zone, card) => addCardToZone(zone, card.instanceId),
      player.energyZone
    ),
    successZone: {
      ...player.successZone,
      cardIds: successLiveCards.map((card) => card.instanceId),
    },
    memberSlots: placeCardInSlot(player.memberSlots, sourceSlot, source.instanceId, {
      orientation: OrientationState.ACTIVE,
      face: FaceState.FACE_UP,
    }),
  }));
  if (options.abilityId) {
    const result = resolvePendingCardEffects({
      ...game,
      pendingAbilities: [
        pendingAbility('manual-pending', source.instanceId, sourceSlot, options.abilityId),
      ],
    }).gameState;
    return { state: result, sourceId: source.instanceId, drawCardId: drawCard.instanceId };
  }

  const stateWithEvent = emitGameEvent(
    game,
    createEnterStageEvent(source.instanceId, ZoneType.HAND, sourceSlot, PLAYER1, PLAYER1)
  );

  const result = new GameService().executeCheckTiming(stateWithEvent, [
    TriggerCondition.ON_ENTER_STAGE,
  ]);
  expect(result.success).toBe(true);
  return { state: result.gameState, sourceId: source.instanceId, drawCardId: drawCard.instanceId };
}

function pendingAbility(
  id: string,
  sourceCardId: string,
  sourceSlot: SlotPosition,
  abilityId = MEMBER_ON_ENTER_DRAW_ONE_ABILITY_ID
): PendingAbilityState {
  return {
    id,
    abilityId,
    sourceCardId,
    controllerId: PLAYER1,
    timingId: TriggerCondition.ON_ENTER_STAGE,
    sourceSlot,
    eventIds: [`event-${id}`],
  };
}

describe('member on-enter draw shared workflow', () => {
  it.each([
    ['PL!HS-bp5-011-N', '大沢瑠璃乃', SlotPosition.LEFT],
    ['PL!SP-sd2-009-SD2', '鬼塚夏美', SlotPosition.RIGHT],
  ] as const)('draws one for %s on enter', (cardCode, name, sourceSlot) => {
    const { state, sourceId, drawCardId } = runOnEnterDrawOne(cardCode, name, sourceSlot);

    expect(state.pendingAbilities).toEqual([]);
    expect(state.players[0].hand.cardIds).toContain(drawCardId);
    expect(
      state.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId === MEMBER_ON_ENTER_DRAW_ONE_ABILITY_ID &&
          action.payload.sourceCardId === sourceId &&
          action.payload.step === 'ON_ENTER_DRAW_ONE' &&
          action.payload.drawnCardIds?.[0] === drawCardId
      )
    ).toBe(true);
  });

  it.each([
    ['PL!-pb1-005-R', '星空 凛'],
    ['PL!-pb1-005-P＋', '星空 凛'],
  ] as const)('draws one for %s when own success LIVE zone has a card', (cardCode, name) => {
    const { state, drawCardId } = runOnEnterDrawOne(cardCode, name, SlotPosition.CENTER, {
      abilityId: PL_PB1_005_ON_ENTER_HAS_SUCCESS_LIVE_DRAW_ONE_ABILITY_ID,
      successLiveCardCount: 1,
    });

    expect(state.players[0].hand.cardIds).toContain(drawCardId);
    expect(
      state.actionHistory.some(
        (action) =>
          action.payload.abilityId === PL_PB1_005_ON_ENTER_HAS_SUCCESS_LIVE_DRAW_ONE_ABILITY_ID &&
          action.payload.step === 'ON_ENTER_HAS_SUCCESS_LIVE_DRAW_ONE' &&
          action.payload.successLiveCardCount === 1
      )
    ).toBe(true);
  });

  it('PL!-pb1-005 consumes its pending without drawing when success LIVE zone is empty and continues later pending', () => {
    const first = createCardInstance(createMember('PL!-pb1-005-R', '星空 凛', 2), PLAYER1, 'rin');
    const second = createCardInstance(createMember('DRAW-SOURCE'), PLAYER1, 'draw-source');
    const drawCard = createCardInstance(createMember('DRAW'), PLAYER1, 'draw');
    let game = createGameState('pl-pb1-005-no-success-live', PLAYER1, 'P1', PLAYER2, 'P2');
    game = registerCards(game, [first, second, drawCard]);
    game = updatePlayer(game, PLAYER1, (player) => ({
      ...player,
      mainDeck: { ...player.mainDeck, cardIds: [drawCard.instanceId] },
      memberSlots: placeCardInSlot(
        placeCardInSlot(player.memberSlots, SlotPosition.LEFT, first.instanceId),
        SlotPosition.RIGHT,
        second.instanceId
      ),
    }));
    const orderSelection = resolvePendingCardEffects({
      ...game,
      pendingAbilities: [
        pendingAbility(
          'rin-pending',
          first.instanceId,
          SlotPosition.LEFT,
          PL_PB1_005_ON_ENTER_HAS_SUCCESS_LIVE_DRAW_ONE_ABILITY_ID
        ),
        pendingAbility('draw-pending', second.instanceId, SlotPosition.RIGHT),
      ],
    }).gameState;

    const resolved = confirmActiveEffectStep(
      orderSelection,
      PLAYER1,
      orderSelection.activeEffect!.id,
      null,
      null,
      true
    );

    expect(resolved.pendingAbilities).toEqual([]);
    expect(resolved.players[0].hand.cardIds).toEqual([drawCard.instanceId]);
    expect(
      resolved.actionHistory.some(
        (action) =>
          action.payload.abilityId === PL_PB1_005_ON_ENTER_HAS_SUCCESS_LIVE_DRAW_ONE_ABILITY_ID &&
          action.payload.step === 'SUCCESS_LIVE_CARD_COUNT_CONDITION_NOT_MET' &&
          action.payload.successLiveCardCount === 0
      )
    ).toBe(true);
  });

  it.each([
    ['PL!SP-PR-003-PR', '澁谷かのん'],
    ['PL!SP-PR-007-PR', '葉月 恋'],
    ['PL!SP-PR-010-PR', '若菜四季'],
  ] as const)('draws one for %s on enter when own energy is at least seven', (cardCode, name) => {
    const { state, sourceId, drawCardId } = runOnEnterDrawOne(cardCode, name, SlotPosition.CENTER, {
      energyCount: 7,
      abilityId: SP_PR_ON_ENTER_ENERGY_SEVEN_DRAW_ABILITY_ID,
    });

    expect(state.pendingAbilities).toEqual([]);
    expect(state.players[0].hand.cardIds).toContain(drawCardId);
    expect(
      state.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId === SP_PR_ON_ENTER_ENERGY_SEVEN_DRAW_ABILITY_ID &&
          action.payload.sourceCardId === sourceId &&
          action.payload.step === 'ON_ENTER_ENERGY_SEVEN_DRAW_ONE' &&
          action.payload.energyCount === 7 &&
          action.payload.drawnCardIds?.[0] === drawCardId
      )
    ).toBe(true);
  });

  it('consumes the SP PR on-enter pending without drawing when own energy is below seven', () => {
    const { state, drawCardId } = runOnEnterDrawOne(
      'PL!SP-PR-003-PR',
      '澁谷かのん',
      SlotPosition.CENTER,
      { energyCount: 6, abilityId: SP_PR_ON_ENTER_ENERGY_SEVEN_DRAW_ABILITY_ID }
    );

    expect(state.pendingAbilities).toEqual([]);
    expect(state.players[0].hand.cardIds).not.toContain(drawCardId);
    expect(
      state.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId === SP_PR_ON_ENTER_ENERGY_SEVEN_DRAW_ABILITY_ID &&
          action.payload.step === 'ENERGY_CONDITION_NOT_MET' &&
          action.payload.energyCount === 6
      )
    ).toBe(true);
  });

  it('continues ordered pending after resolving SP PR on-enter energy-seven draw effects', () => {
    const first = createCardInstance(
      createMember('PL!SP-PR-003-PR', '澁谷かのん'),
      PLAYER1,
      'first'
    );
    const second = createCardInstance(
      createMember('PL!SP-PR-007-PR', '葉月 恋'),
      PLAYER1,
      'second'
    );
    const firstDraw = createCardInstance(createMember('DRAW-1'), PLAYER1, 'draw-1');
    const secondDraw = createCardInstance(createMember('DRAW-2'), PLAYER1, 'draw-2');
    let game = createGameState('member-on-enter-draw-ordered', PLAYER1, 'P1', PLAYER2, 'P2');
    const energyCards = Array.from({ length: 7 }, (_, index) =>
      createCardInstance(createMember(`ENERGY-${index}`), PLAYER1, `energy-${index}`)
    );
    game = registerCards(game, [first, second, firstDraw, secondDraw, ...energyCards]);
    game = updatePlayer(game, PLAYER1, (player) => ({
      ...player,
      mainDeck: { ...player.mainDeck, cardIds: [firstDraw.instanceId, secondDraw.instanceId] },
      energyZone: energyCards.reduce(
        (zone, card) => addCardToZone(zone, card.instanceId),
        player.energyZone
      ),
      memberSlots: placeCardInSlot(
        placeCardInSlot(player.memberSlots, SlotPosition.LEFT, first.instanceId),
        SlotPosition.RIGHT,
        second.instanceId
      ),
    }));
    game = {
      ...game,
      pendingAbilities: [
        pendingAbility(
          'first-pending',
          first.instanceId,
          SlotPosition.LEFT,
          SP_PR_ON_ENTER_ENERGY_SEVEN_DRAW_ABILITY_ID
        ),
        pendingAbility(
          'second-pending',
          second.instanceId,
          SlotPosition.RIGHT,
          SP_PR_ON_ENTER_ENERGY_SEVEN_DRAW_ABILITY_ID
        ),
      ],
    };

    const orderSelection = resolvePendingCardEffects(game).gameState;
    expect(orderSelection.activeEffect?.canResolveInOrder).toBe(true);

    const resolved = confirmActiveEffectStep(
      orderSelection,
      PLAYER1,
      orderSelection.activeEffect!.id,
      null,
      null,
      true
    );

    expect(resolved.activeEffect).toBeNull();
    expect(resolved.pendingAbilities).toEqual([]);
    expect(resolved.players[0].hand.cardIds).toEqual([firstDraw.instanceId, secondDraw.instanceId]);
    expect(
      resolved.actionHistory.filter(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId === SP_PR_ON_ENTER_ENERGY_SEVEN_DRAW_ABILITY_ID &&
          action.payload.step === 'ON_ENTER_ENERGY_SEVEN_DRAW_ONE'
      )
    ).toHaveLength(2);
  });

  it('draws one for PL!HS-bp2-017-N when the waiting room has ten cards', () => {
    const source = createCardInstance(
      createMember('PL!HS-bp2-017-N', '徒町 小鈴', 7),
      PLAYER1,
      'hs-bp2-017-source'
    );
    const drawCard = createCardInstance(createMember('DRAW'), PLAYER1, 'draw');
    const waitingCards = Array.from({ length: 10 }, (_, index) =>
      createCardInstance(createMember(`WAITING-${index}`), PLAYER1, `waiting-${index}`)
    );
    let game = createGameState('hs-bp2-017-ten', PLAYER1, 'P1', PLAYER2, 'P2');
    game = registerCards(game, [source, drawCard, ...waitingCards]);
    game = updatePlayer(game, PLAYER1, (player) => ({
      ...player,
      mainDeck: { ...player.mainDeck, cardIds: [drawCard.instanceId] },
      waitingRoom: { ...player.waitingRoom, cardIds: waitingCards.map((card) => card.instanceId) },
      memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, source.instanceId),
    }));
    game = {
      ...game,
      pendingAbilities: [
        pendingAbility(
          'hs-bp2-017-pending',
          source.instanceId,
          SlotPosition.CENTER,
          HS_BP2_017_ON_ENTER_WAITING_ROOM_TEN_DRAW_ONE_ABILITY_ID
        ),
      ],
    };

    const resolved = resolvePendingCardEffects(game).gameState;
    expect(resolved.pendingAbilities).toEqual([]);
    expect(resolved.players[0].hand.cardIds).toContain(drawCard.instanceId);
    expect(
      resolved.actionHistory.some(
        (action) =>
          action.payload.abilityId === HS_BP2_017_ON_ENTER_WAITING_ROOM_TEN_DRAW_ONE_ABILITY_ID &&
          action.payload.step === 'ON_ENTER_WAITING_ROOM_TEN_DRAW_ONE' &&
          action.payload.waitingRoomCount === 10
      )
    ).toBe(true);
  });

  it('consumes PL!HS-bp2-017-N pending without drawing at nine waiting-room cards', () => {
    const source = createCardInstance(
      createMember('PL!HS-bp2-017-N', '徒町 小鈴', 7),
      PLAYER1,
      'hs-bp2-017-source'
    );
    const drawCard = createCardInstance(createMember('DRAW'), PLAYER1, 'draw');
    const waitingCards = Array.from({ length: 9 }, (_, index) =>
      createCardInstance(createMember(`WAITING-${index}`), PLAYER1, `waiting-${index}`)
    );
    let game = createGameState('hs-bp2-017-nine', PLAYER1, 'P1', PLAYER2, 'P2');
    game = registerCards(game, [source, drawCard, ...waitingCards]);
    game = updatePlayer(game, PLAYER1, (player) => ({
      ...player,
      mainDeck: { ...player.mainDeck, cardIds: [drawCard.instanceId] },
      waitingRoom: { ...player.waitingRoom, cardIds: waitingCards.map((card) => card.instanceId) },
      memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, source.instanceId),
    }));
    game = {
      ...game,
      pendingAbilities: [
        pendingAbility(
          'hs-bp2-017-pending',
          source.instanceId,
          SlotPosition.CENTER,
          HS_BP2_017_ON_ENTER_WAITING_ROOM_TEN_DRAW_ONE_ABILITY_ID
        ),
      ],
    };

    const resolved = resolvePendingCardEffects(game).gameState;
    expect(resolved.pendingAbilities).toEqual([]);
    expect(resolved.players[0].hand.cardIds).not.toContain(drawCard.instanceId);
    expect(
      resolved.actionHistory.some(
        (action) =>
          action.payload.abilityId === HS_BP2_017_ON_ENTER_WAITING_ROOM_TEN_DRAW_ONE_ABILITY_ID &&
          action.payload.step === 'WAITING_ROOM_COUNT_CONDITION_NOT_MET' &&
          action.payload.waitingRoomCount === 9
      )
    ).toBe(true);
  });

  it('uses the current waiting-room count when PL!HS-bp2-017-N resolves', () => {
    const source = createCardInstance(
      createMember('PL!HS-bp2-017-N', '徒町 小鈴', 7),
      PLAYER1,
      'hs-bp2-017-source'
    );
    const drawCard = createCardInstance(createMember('DRAW'), PLAYER1, 'draw');
    const waitingCards = Array.from({ length: 10 }, (_, index) =>
      createCardInstance(createMember(`WAITING-${index}`), PLAYER1, `waiting-${index}`)
    );
    let game = createGameState('hs-bp2-017-recompute', PLAYER1, 'P1', PLAYER2, 'P2');
    game = registerCards(game, [source, drawCard, ...waitingCards]);
    game = updatePlayer(game, PLAYER1, (player) => ({
      ...player,
      mainDeck: { ...player.mainDeck, cardIds: [drawCard.instanceId] },
      waitingRoom: {
        ...player.waitingRoom,
        cardIds: waitingCards.slice(0, 9).map((card) => card.instanceId),
      },
      memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, source.instanceId),
    }));
    game = {
      ...game,
      pendingAbilities: [
        pendingAbility(
          'hs-bp2-017-pending',
          source.instanceId,
          SlotPosition.CENTER,
          HS_BP2_017_ON_ENTER_WAITING_ROOM_TEN_DRAW_ONE_ABILITY_ID
        ),
      ],
    };
    game = updatePlayer(game, PLAYER1, (player) => ({
      ...player,
      waitingRoom: {
        ...player.waitingRoom,
        cardIds: [...player.waitingRoom.cardIds, waitingCards[9]!.instanceId],
      },
    }));

    const resolved = resolvePendingCardEffects(game).gameState;
    expect(resolved.players[0].hand.cardIds).toContain(drawCard.instanceId);
  });

  it('continues ordered pending after PL!HS-bp2-017-N no-op', () => {
    const first = createCardInstance(
      createMember('PL!HS-bp2-017-N', '徒町 小鈴', 7),
      PLAYER1,
      'first'
    );
    const second = createCardInstance(
      createMember('PL!HS-bp2-017-N', '徒町 小鈴', 7),
      PLAYER1,
      'second'
    );
    const drawCard = createCardInstance(createMember('DRAW'), PLAYER1, 'draw');
    const waitingCards = Array.from({ length: 9 }, (_, index) =>
      createCardInstance(createMember(`WAITING-${index}`), PLAYER1, `waiting-${index}`)
    );
    let game = createGameState('hs-bp2-017-ordered', PLAYER1, 'P1', PLAYER2, 'P2');
    game = registerCards(game, [first, second, drawCard, ...waitingCards]);
    game = updatePlayer(game, PLAYER1, (player) => ({
      ...player,
      mainDeck: { ...player.mainDeck, cardIds: [drawCard.instanceId] },
      waitingRoom: { ...player.waitingRoom, cardIds: waitingCards.map((card) => card.instanceId) },
      memberSlots: placeCardInSlot(
        placeCardInSlot(player.memberSlots, SlotPosition.LEFT, first.instanceId),
        SlotPosition.RIGHT,
        second.instanceId
      ),
    }));
    game = {
      ...game,
      pendingAbilities: [
        pendingAbility(
          'first-pending',
          first.instanceId,
          SlotPosition.LEFT,
          HS_BP2_017_ON_ENTER_WAITING_ROOM_TEN_DRAW_ONE_ABILITY_ID
        ),
        pendingAbility(
          'second-pending',
          second.instanceId,
          SlotPosition.RIGHT,
          MEMBER_ON_ENTER_DRAW_ONE_ABILITY_ID
        ),
      ],
    };

    const orderSelection = resolvePendingCardEffects(game).gameState;
    expect(orderSelection.activeEffect?.canResolveInOrder).toBe(true);
    const resolved = confirmActiveEffectStep(
      orderSelection,
      PLAYER1,
      orderSelection.activeEffect!.id,
      null,
      null,
      true
    );

    expect(resolved.activeEffect).toBeNull();
    expect(resolved.pendingAbilities).toEqual([]);
    expect(resolved.players[0].hand.cardIds).toEqual([drawCard.instanceId]);
    expect(
      resolved.actionHistory.some(
        (action) =>
          action.payload.abilityId === HS_BP2_017_ON_ENTER_WAITING_ROOM_TEN_DRAW_ONE_ABILITY_ID &&
          action.payload.step === 'WAITING_ROOM_COUNT_CONDITION_NOT_MET'
      )
    ).toBe(true);
    expect(
      resolved.actionHistory.some(
        (action) =>
          action.payload.abilityId === MEMBER_ON_ENTER_DRAW_ONE_ABILITY_ID &&
          action.payload.step === 'ON_ENTER_DRAW_ONE'
      )
    ).toBe(true);
  });
});

function createFiveyncriseMember(cardCode: string, name = '鬼塚夏美'): MemberCardData {
  return { ...createMember(cardCode, name, 2), groupNames: ['Liella!'], unitName: '5yncri5e!' };
}

function resolveSpPb1009(options: {
  readonly sourceCode?: string;
  readonly ownStageCards?: readonly ReturnType<typeof createCardInstance>[];
  readonly opponentStageCards?: readonly ReturnType<typeof createCardInstance>[];
  readonly handCards?: readonly ReturnType<typeof createCardInstance>[];
  readonly waitingRoomCards?: readonly ReturnType<typeof createCardInstance>[];
  readonly memberBelowCards?: readonly ReturnType<typeof createCardInstance>[];
  readonly includeDrawCard?: boolean;
} = {}) {
  const source = createCardInstance(
    createFiveyncriseMember(options.sourceCode ?? 'PL!SP-pb1-009-R'),
    PLAYER1,
    'sp-pb1-009-source'
  );
  const drawCard = createCardInstance(createMember('DRAW'), PLAYER1, 'sp-pb1-009-draw');
  const ownStageCards = [...(options.ownStageCards ?? [])];
  const opponentStageCards = [...(options.opponentStageCards ?? [])];
  const handCards = [...(options.handCards ?? [])];
  const waitingRoomCards = [...(options.waitingRoomCards ?? [])];
  const memberBelowCards = [...(options.memberBelowCards ?? [])];
  let game = createGameState('sp-pb1-009', PLAYER1, 'P1', PLAYER2, 'P2');
  game = registerCards(game, [
    source,
    drawCard,
    ...ownStageCards,
    ...opponentStageCards,
    ...handCards,
    ...waitingRoomCards,
    ...memberBelowCards,
  ]);
  game = updatePlayer(game, PLAYER1, (player) => {
    let memberSlots = placeCardInSlot(player.memberSlots, SlotPosition.CENTER, source.instanceId);
    ownStageCards.forEach((card, index) => {
      memberSlots = placeCardInSlot(
        memberSlots,
        index === 0 ? SlotPosition.LEFT : SlotPosition.RIGHT,
        card.instanceId
      );
    });
    return {
      ...player,
      mainDeck: {
        ...player.mainDeck,
        cardIds: options.includeDrawCard === false ? [] : [drawCard.instanceId],
      },
      hand: { ...player.hand, cardIds: handCards.map((card) => card.instanceId) },
      waitingRoom: {
        ...player.waitingRoom,
        cardIds: waitingRoomCards.map((card) => card.instanceId),
      },
      memberSlots: {
        ...memberSlots,
        memberBelow: {
          ...memberSlots.memberBelow,
          [SlotPosition.CENTER]: memberBelowCards.map((card) => card.instanceId),
        },
      },
    };
  });
  game = updatePlayer(game, PLAYER2, (player) => {
    let memberSlots = player.memberSlots;
    opponentStageCards.forEach((card, index) => {
      memberSlots = placeCardInSlot(
        memberSlots,
        index === 0 ? SlotPosition.LEFT : SlotPosition.RIGHT,
        card.instanceId
      );
    });
    return { ...player, memberSlots };
  });
  const state = resolvePendingCardEffects({
    ...game,
    pendingAbilities: [
      pendingAbility(
        'sp-pb1-009-pending',
        source.instanceId,
        SlotPosition.CENTER,
        SP_PB1_009_ON_ENTER_OTHER_FIVEYNCRISE_DRAW_ONE_ABILITY_ID
      ),
    ],
  }).gameState;
  return { state, source, drawCard };
}

describe('PL!SP-pb1-009 shared member-on-enter draw condition', () => {
  it('does not count the 5yncri5e! source itself', () => {
    const { state, drawCard } = resolveSpPb1009();
    expect(state.pendingAbilities).toEqual([]);
    expect(state.players[0].hand.cardIds).not.toContain(drawCard.instanceId);
    expect(state.actionHistory.at(-1)?.payload).toMatchObject({
      step: 'OTHER_STAGE_UNIT_MEMBER_CONDITION_NOT_MET',
      requiredOtherStageUnitAlias: '5yncri5e!',
      hasRequiredOtherStageUnitMember: false,
    });
  });

  it.each(['PL!SP-pb1-009-R', 'PL!SP-pb1-009-P＋'])(
    'draws one for %s with another own-stage 5yncri5e! member',
    (sourceCode) => {
      const other = createCardInstance(createFiveyncriseMember('OTHER'), PLAYER1, 'other-five');
      const { state, drawCard } = resolveSpPb1009({ sourceCode, ownStageCards: [other] });
      expect(state.players[0].hand.cardIds).toContain(drawCard.instanceId);
      expect(state.actionHistory.at(-1)?.payload).toMatchObject({
        step: 'ON_ENTER_OTHER_FIVEYNCRISE_DRAW_ONE',
        requiredOtherStageUnitAlias: '5yncri5e!',
        hasRequiredOtherStageUnitMember: true,
        drawnCardIds: [drawCard.instanceId],
      });
    }
  );

  it('counts another same-name instance as another member', () => {
    const sameName = createCardInstance(
      createFiveyncriseMember('PL!SP-pb1-009-P＋'),
      PLAYER1,
      'same-name-other-instance'
    );
    expect(resolveSpPb1009({ ownStageCards: [sameName] }).state.players[0].hand.cardIds).toContain(
      'sp-pb1-009-draw'
    );
  });

  it('does not count another Liella! member outside 5yncri5e!', () => {
    const otherLiella = createCardInstance(
      { ...createMember('OTHER-LIELLA'), groupNames: ['Liella!'], unitName: 'CatChu!' },
      PLAYER1,
      'other-liella'
    );
    const { state, drawCard } = resolveSpPb1009({ ownStageCards: [otherLiella] });
    expect(state.players[0].hand.cardIds).not.toContain(drawCard.instanceId);
  });

  it('does not count the opponent stage', () => {
    const opponent = createCardInstance(createFiveyncriseMember('OPPONENT'), PLAYER2, 'opponent');
    const { state, drawCard } = resolveSpPb1009({ opponentStageCards: [opponent] });
    expect(state.players[0].hand.cardIds).not.toContain(drawCard.instanceId);
  });

  it('does not count 5yncri5e! cards in memberBelow, hand, or waiting room', () => {
    const below = createCardInstance(createFiveyncriseMember('BELOW'), PLAYER1, 'below');
    const hand = createCardInstance(createFiveyncriseMember('HAND'), PLAYER1, 'hand');
    const waiting = createCardInstance(createFiveyncriseMember('WAITING'), PLAYER1, 'waiting');
    const { state, drawCard } = resolveSpPb1009({
      memberBelowCards: [below],
      handCards: [hand],
      waitingRoomCards: [waiting],
    });
    expect(state.players[0].hand.cardIds).not.toContain(drawCard.instanceId);
  });

  it('finishes normally with an empty main deck', () => {
    const other = createCardInstance(createFiveyncriseMember('OTHER'), PLAYER1, 'other-five');
    const { state } = resolveSpPb1009({ ownStageCards: [other], includeDrawCard: false });
    expect(state.pendingAbilities).toEqual([]);
    expect(state.actionHistory.at(-1)?.payload).toMatchObject({
      step: 'ON_ENTER_OTHER_FIVEYNCRISE_DRAW_ONE',
      drawnCardIds: [],
      drawCount: 0,
    });
  });

  it('preserves ordered continuation into an existing member-on-enter-draw config', () => {
    const first = createCardInstance(createFiveyncriseMember('PL!SP-pb1-009-R'), PLAYER1, 'first');
    const second = createCardInstance(createFiveyncriseMember('OTHER'), PLAYER1, 'second');
    const drawOne = createCardInstance(createMember('DRAW-1'), PLAYER1, 'draw-1');
    const drawTwo = createCardInstance(createMember('DRAW-2'), PLAYER1, 'draw-2');
    let game = createGameState('sp-pb1-009-ordered', PLAYER1, 'P1', PLAYER2, 'P2');
    game = registerCards(game, [first, second, drawOne, drawTwo]);
    game = updatePlayer(game, PLAYER1, (player) => ({
      ...player,
      mainDeck: { ...player.mainDeck, cardIds: [drawOne.instanceId, drawTwo.instanceId] },
      memberSlots: placeCardInSlot(
        placeCardInSlot(player.memberSlots, SlotPosition.LEFT, first.instanceId),
        SlotPosition.RIGHT,
        second.instanceId
      ),
    }));
    const selection = resolvePendingCardEffects({
      ...game,
      pendingAbilities: [
        pendingAbility(
          '009',
          first.instanceId,
          SlotPosition.LEFT,
          SP_PB1_009_ON_ENTER_OTHER_FIVEYNCRISE_DRAW_ONE_ABILITY_ID
        ),
        pendingAbility('generic', second.instanceId, SlotPosition.RIGHT),
      ],
    }).gameState;
    const resolved = confirmActiveEffectStep(
      selection,
      PLAYER1,
      selection.activeEffect!.id,
      null,
      null,
      true
    );
    expect(resolved.pendingAbilities).toEqual([]);
    expect(resolved.players[0].hand.cardIds).toEqual([drawOne.instanceId, drawTwo.instanceId]);
    expect(
      resolved.actionHistory
        .filter(
          (action) =>
            action.type === 'RESOLVE_ABILITY' &&
            (action.payload.step === 'ON_ENTER_OTHER_FIVEYNCRISE_DRAW_ONE' ||
              action.payload.step === 'ON_ENTER_DRAW_ONE')
        )
        .map((action) => action.payload.abilityId)
    ).toEqual([
      SP_PB1_009_ON_ENTER_OTHER_FIVEYNCRISE_DRAW_ONE_ABILITY_ID,
      MEMBER_ON_ENTER_DRAW_ONE_ABILITY_ID,
    ]);
  });
});
