import { describe, expect, it } from 'vitest';
import type { EnergyCardData, LiveCardData, MemberCardData } from '../../src/domain/entities/card';
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
import {
  addCardToZone,
  addMemberBelowMember,
  placeCardInSlot,
  removeCardFromSlot,
} from '../../src/domain/entities/zone';
import { createEnterStageEvent } from '../../src/domain/events/game-events';
import {
  confirmActiveEffectStep,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import { createPlayMemberToSlotCommand } from '../../src/application/game-commands';
import { createGameSession } from '../../src/application/game-session';
import { GameService } from '../../src/application/game-service';
import {
  HS_BP2_017_ON_ENTER_WAITING_ROOM_TEN_DRAW_ONE_ABILITY_ID,
  MEMBER_ON_ENTER_DRAW_ONE_ABILITY_ID,
  PL_PB1_005_ON_ENTER_HAS_SUCCESS_LIVE_DRAW_ONE_ABILITY_ID,
  PL_BP4_016_ON_ENTER_SUCCESS_SCORE_THREE_DRAW_ONE_ABILITY_ID,
  S_BP7_002_ON_ENTER_AQOURS_COST_NINE_DRAW_ONE_ABILITY_ID,
  SP_BP1_008_ON_ENTER_DRAW_ONE_BONUS_IF_MEI_ABILITY_ID,
  SP_SD1_001_ON_ENTER_DRAW_PER_SIX_ENERGY_ABILITY_ID,
  SP_PB1_009_ON_ENTER_OTHER_FIVEYNCRISE_DRAW_ONE_ABILITY_ID,
  SP_PR_ON_ENTER_ENERGY_SEVEN_DRAW_ABILITY_ID,
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

function createEnergy(cardCode: string): EnergyCardData {
  return { cardCode, name: cardCode, cardType: CardType.ENERGY };
}

function createLive(cardCode: string, score: number): LiveCardData {
  return {
    cardCode,
    name: cardCode,
    groupNames: ["μ's"],
    cardType: CardType.LIVE,
    score,
    requirements: createHeartRequirement({ [HeartColor.PINK]: 1 }),
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
      createEnergy(`${cardCode}-energy-${index}`),
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
      createCardInstance(createEnergy(`ENERGY-${index}`), PLAYER1, `energy-${index}`)
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

describe('PL!S-bp7-002-P 费用4「樱内梨子」 shared on-enter draw condition', () => {
  function aqoursMember(cardCode: string, cost: number, groups: readonly string[] = ['Aqours']) {
    return {
      ...createMember(cardCode, cardCode, cost),
      groupNames: [...groups],
      unitName: undefined,
    };
  }

  function setupCondition(options: {
    readonly qualifierCost?: number;
    readonly qualifierGroups?: readonly string[];
    readonly sourceCost?: number;
    readonly qualifierBelow?: boolean;
    readonly qualifierOpponent?: boolean;
    readonly twoPendings?: boolean;
  } = {}) {
    const source = createCardInstance(
      aqoursMember('PL!S-bp7-002-P', options.sourceCost ?? 4),
      PLAYER1,
      'bp7-riko'
    );
    const qualifier = createCardInstance(
      aqoursMember(
        'BP7-QUALIFIER',
        options.qualifierCost ?? 9,
        options.qualifierGroups ?? ['Aqours']
      ),
      options.qualifierOpponent ? PLAYER2 : PLAYER1,
      'bp7-qualifier'
    );
    const generic = createCardInstance(createMember('GENERIC-DRAW-SOURCE'), PLAYER1, 'generic');
    const draws = [0, 1].map((index) =>
      createCardInstance(createMember(`BP7-DRAW-${index}`), PLAYER1, `bp7-draw-${index}`)
    );
    let game = registerCards(
      createGameState('s-bp7-002-on-enter', PLAYER1, 'P1', PLAYER2, 'P2'),
      [source, qualifier, generic, ...draws]
    );
    game = updatePlayer(game, PLAYER1, (player) => {
      let memberSlots = placeCardInSlot(player.memberSlots, SlotPosition.CENTER, source.instanceId);
      if (!options.qualifierOpponent) {
        memberSlots = options.qualifierBelow
          ? addMemberBelowMember(memberSlots, SlotPosition.CENTER, qualifier.instanceId)
          : placeCardInSlot(memberSlots, SlotPosition.LEFT, qualifier.instanceId);
      }
      if (options.twoPendings) {
        memberSlots = placeCardInSlot(memberSlots, SlotPosition.RIGHT, generic.instanceId);
      }
      return {
        ...player,
        mainDeck: { ...player.mainDeck, cardIds: draws.map((card) => card.instanceId) },
        memberSlots,
      };
    });
    if (options.qualifierOpponent) {
      game = updatePlayer(game, PLAYER2, (player) => ({
        ...player,
        memberSlots: placeCardInSlot(
          player.memberSlots,
          SlotPosition.LEFT,
          qualifier.instanceId
        ),
      }));
    }
    game = {
      ...game,
      pendingAbilities: [
        pendingAbility(
          'bp7-riko-pending',
          source.instanceId,
          SlotPosition.CENTER,
          S_BP7_002_ON_ENTER_AQOURS_COST_NINE_DRAW_ONE_ABILITY_ID
        ),
        ...(options.twoPendings
          ? [pendingAbility('generic-pending', generic.instanceId, SlotPosition.RIGHT)]
          : []),
      ],
    };
    return { game, source, qualifier, draws };
  }

  it.each([
    ['cost nine Aqours', 9, ['Aqours'], true],
    ['cost eight Aqours', 8, ['Aqours'], false],
    ['cost nine non-Aqours', 9, ['Liella!'], false],
    ['mixed structured Aqours identity', 9, ['Liella!', 'Aqours'], true],
  ] as const)('%s resolves with the expected draw result', (_label, cost, groups, shouldDraw) => {
    const scenario = setupCondition({ qualifierCost: cost, qualifierGroups: groups });
    const resolved = resolvePendingCardEffects(scenario.game).gameState;
    expect(resolved.players[0].hand.cardIds.includes(scenario.draws[0]!.instanceId)).toBe(
      shouldDraw
    );
  });

  it('uses current effective cost rather than printed cost for the Aqours threshold', () => {
    const scenario = setupCondition({ qualifierCost: 8 });
    const withEffectiveCost = {
      ...scenario.game,
      liveResolution: {
        ...scenario.game.liveResolution,
        liveModifiers: [
          {
            kind: 'MEMBER_COST' as const,
            playerId: PLAYER1,
            memberCardId: scenario.qualifier.instanceId,
            countDelta: 1,
            sourceCardId: 'bp7-effective-cost-source',
            abilityId: 'BP7_EFFECTIVE_COST_TEST',
          },
        ],
      },
    };
    const resolved = resolvePendingCardEffects(withEffectiveCost).gameState;
    expect(resolved.players[0].hand.cardIds).toEqual([scenario.draws[0]!.instanceId]);
  });

  it.each([
    ['memberBelow', { qualifierBelow: true }],
    ['opponent stage', { qualifierOpponent: true }],
  ] as const)('does not count %s', (_label, options) => {
    const scenario = setupCondition(options);
    const resolved = resolvePendingCardEffects(scenario.game).gameState;
    expect(resolved.players[0].hand.cardIds).toEqual([]);
  });

  it('counts the source itself when it independently satisfies the printed condition', () => {
    const scenario = setupCondition({ sourceCost: 9, qualifierCost: 8 });
    const resolved = resolvePendingCardEffects(scenario.game).gameState;
    expect(resolved.players[0].hand.cardIds).toEqual([scenario.draws[0]!.instanceId]);
  });

  it('shows a real-time manual confirmation and rechecks the current stage before drawing', () => {
    const scenario = setupCondition({ twoPendings: true });
    const order = resolvePendingCardEffects(scenario.game).gameState;
    const confirmation = confirmActiveEffectStep(
      order,
      PLAYER1,
      order.activeEffect!.id,
      undefined,
      undefined,
      false,
      'bp7-riko-pending'
    );
    expect(confirmation.activeEffect?.effectText).toContain(
      '当前自己舞台费用大于等于9的『Aqours』成员 1名，满足条件，实际抽1张卡'
    );
    expect(confirmation.players[0].hand.cardIds).toEqual([]);
    const changed = updatePlayer(confirmation, PLAYER1, (player) => ({
      ...player,
      memberSlots: removeCardFromSlot(player.memberSlots, SlotPosition.LEFT),
    }));
    const resolved = confirmActiveEffectStep(
      changed,
      PLAYER1,
      changed.activeEffect!.id
    );
    expect(resolved.pendingAbilities).toEqual([]);
    expect(resolved.players[0].hand.cardIds).toEqual([scenario.draws[0]!.instanceId]);
    expect(
      resolved.actionHistory.some(
        (action) =>
          action.payload.abilityId ===
            S_BP7_002_ON_ENTER_AQOURS_COST_NINE_DRAW_ONE_ABILITY_ID &&
          action.payload.requestedDrawCount === 0
      )
    ).toBe(true);
  });
});

function setupSpSd1001(options: {
  readonly energyCount: number;
  readonly deckCount?: number;
  readonly activeEnergyCount?: number;
  readonly markedEnergyIndices?: readonly number[];
  readonly includeSourceOnStage?: boolean;
}) {
  const source = createCardInstance(
    createMember('PL!SP-sd1-001-SD', '澁谷かのん', 11),
    PLAYER1,
    'sp-sd1-001-source'
  );
  const energyCards = Array.from({ length: options.energyCount }, (_, index) =>
    createCardInstance(createEnergy(`SP-SD1-ENERGY-${index}`), PLAYER1, `sp-sd1-energy-${index}`)
  );
  const deckCards = Array.from({ length: options.deckCount ?? 3 }, (_, index) =>
    createCardInstance(createMember(`SP-SD1-DRAW-${index}`), PLAYER1, `sp-sd1-draw-${index}`)
  );
  let game = registerCards(
    createGameState('sp-sd1-001', PLAYER1, 'P1', PLAYER2, 'P2'),
    [source, ...energyCards, ...deckCards]
  );
  game = updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    mainDeck: { ...player.mainDeck, cardIds: deckCards.map((card) => card.instanceId) },
    energyZone: {
      ...player.energyZone,
      cardIds: energyCards.map((card) => card.instanceId),
      cardStates: new Map(
        energyCards.map((card, index) => [
          card.instanceId,
          {
            orientation:
              index < (options.activeEnergyCount ?? options.energyCount)
                ? OrientationState.ACTIVE
                : OrientationState.WAITING,
            face: FaceState.FACE_UP,
          },
        ])
      ),
    },
    memberSlots:
      options.includeSourceOnStage === false
        ? player.memberSlots
        : placeCardInSlot(player.memberSlots, SlotPosition.CENTER, source.instanceId),
  }));
  game = {
    ...game,
    energyActivePhaseSkips: (options.markedEnergyIndices ?? []).map((index) => ({
      playerId: PLAYER1,
      energyCardId: energyCards[index]!.instanceId,
      sourceCardId: 'marker-source',
      abilityId: 'marker-ability',
    })),
  };
  return { game, source, energyCards, deckCards };
}

function resolveSpSd1001(game: GameState, sourceCardId = 'sp-sd1-001-source') {
  return resolvePendingCardEffects({
    ...game,
    pendingAbilities: [
      pendingAbility(
        'sp-sd1-001-pending',
        sourceCardId,
        SlotPosition.CENTER,
        SP_SD1_001_ON_ENTER_DRAW_PER_SIX_ENERGY_ABILITY_ID
      ),
    ],
  }).gameState;
}

describe('PL!SP-sd1-001-SD 费用11 澁谷かのん dynamic energy draw', () => {
  it('uses real PLAY_MEMBER -> ON_ENTER_STAGE and resolves from the current energy count', () => {
    const session = createGameSession();
    session.createGame('sp-sd1-001-real-play', PLAYER1, 'P1', PLAYER2, 'P2');
    const scenario = setupSpSd1001({ energyCount: 6, deckCount: 1 });
    let game = scenario.game;
    game = updatePlayer(game, PLAYER1, (player) => ({
      ...player,
      hand: { ...player.hand, cardIds: [scenario.source.instanceId] },
      memberSlots: removeCardFromSlot(player.memberSlots, SlotPosition.CENTER),
    }));
    (session as unknown as { authorityState: GameState }).authorityState = {
      ...game,
      currentPhase: GamePhase.MAIN_PHASE,
      currentSubPhase: SubPhase.NONE,
      activePlayerIndex: 0,
    };

    session.localFreePlay = true;
    const result = session.executeCommand(
      createPlayMemberToSlotCommand(PLAYER1, scenario.source.instanceId, SlotPosition.LEFT, {
        freePlay: true,
      })
    );
    expect(result.success, result.error).toBe(true);
    expect(session.state!.pendingAbilities).toEqual([]);
    expect(session.state!.players[0].hand.cardIds).toContain(scenario.deckCards[0]!.instanceId);
    expect(
      session.state!.actionHistory.find(
        (action) =>
          action.type === 'TRIGGER_ABILITY' &&
          action.payload.abilityId === SP_SD1_001_ON_ENTER_DRAW_PER_SIX_ENERGY_ABILITY_ID
      )?.payload
    ).toMatchObject({
      sourceCardId: scenario.source.instanceId,
      sourceSlot: SlotPosition.LEFT,
      timingId: TriggerCondition.ON_ENTER_STAGE,
    });
  });

  it.each([
    [0, 0],
    [5, 0],
    [6, 1],
    [11, 1],
    [12, 2],
  ] as const)('draws floor(%i / 6) cards and records exact requested/actual payload', (energyCount, expected) => {
    const scenario = setupSpSd1001({ energyCount, deckCount: 3 });
    const resolved = resolveSpSd1001(scenario.game);
    expect(resolved.pendingAbilities).toEqual([]);
    expect(resolved.activeEffect).toBeNull();
    expect(resolved.players[0].hand.cardIds).toEqual(
      scenario.deckCards.slice(0, expected).map((card) => card.instanceId)
    );
    expect(resolved.actionHistory.at(-1)?.payload).toMatchObject({
      abilityId: SP_SD1_001_ON_ENTER_DRAW_PER_SIX_ENERGY_ABILITY_ID,
      step: 'ON_ENTER_DRAW_PER_SIX_ENERGY',
      energyCount,
      energyPerDraw: 6,
      requestedDrawCount: expected,
      drawnCardIds: scenario.deckCards.slice(0, expected).map((card) => card.instanceId),
      drawCount: expected,
    });
  });

  it('counts ACTIVE, WAITING, and marker-bearing energy cards uniformly', () => {
    const scenario = setupSpSd1001({
      energyCount: 6,
      deckCount: 1,
      activeEnergyCount: 2,
      markedEnergyIndices: [1, 4],
    });
    const resolved = resolveSpSd1001(scenario.game);
    expect(resolved.players[0].hand.cardIds).toEqual([scenario.deckCards[0]!.instanceId]);
    expect(resolved.actionHistory.at(-1)?.payload).toMatchObject({
      energyCount: 6,
      requestedDrawCount: 1,
      drawCount: 1,
    });
    expect(resolved.energyActivePhaseSkips).toEqual(scenario.game.energyActivePhaseSkips);
  });

  it('records the actual draw when two are requested but only one card is available', () => {
    const scenario = setupSpSd1001({ energyCount: 12, deckCount: 1 });
    const resolved = resolveSpSd1001(scenario.game);
    expect(resolved.players[0].hand.cardIds).toEqual([scenario.deckCards[0]!.instanceId]);
    expect(resolved.actionHistory.at(-1)?.payload).toMatchObject({
      energyCount: 12,
      energyPerDraw: 6,
      requestedDrawCount: 2,
      drawnCardIds: [scenario.deckCards[0]!.instanceId],
      drawCount: 1,
    });
  });

  it('consumes the pending and continues safely when no card can be drawn', () => {
    const scenario = setupSpSd1001({ energyCount: 6, deckCount: 0 });
    const resolved = resolveSpSd1001(scenario.game);
    expect(resolved.pendingAbilities).toEqual([]);
    expect(resolved.activeEffect).toBeNull();
    expect(resolved.actionHistory.at(-1)?.payload).toMatchObject({
      requestedDrawCount: 1,
      drawnCardIds: [],
      drawCount: 0,
    });
  });

  it('still resolves from the current energy count after the triggering source leaves stage', () => {
    const scenario = setupSpSd1001({ energyCount: 12, deckCount: 2 });
    let queued = {
      ...scenario.game,
      pendingAbilities: [
        pendingAbility(
          'source-left',
          scenario.source.instanceId,
          SlotPosition.CENTER,
          SP_SD1_001_ON_ENTER_DRAW_PER_SIX_ENERGY_ABILITY_ID
        ),
      ],
    };
    queued = updatePlayer(queued, PLAYER1, (player) => ({
      ...player,
      memberSlots: removeCardFromSlot(player.memberSlots, SlotPosition.CENTER),
      waitingRoom: { ...player.waitingRoom, cardIds: [scenario.source.instanceId] },
    }));
    const resolved = resolvePendingCardEffects(queued).gameState;
    expect(resolved.players[0].hand.cardIds).toEqual(
      scenario.deckCards.map((card) => card.instanceId)
    );
    expect(resolved.pendingAbilities).toEqual([]);
  });

  it('preserves ordered continuation into a later pending ability', () => {
    const scenario = setupSpSd1001({ energyCount: 6, deckCount: 2 });
    const second = createCardInstance(createMember('PL!HS-bp5-011-N'), PLAYER1, 'later-source');
    let game = registerCards(scenario.game, [second]);
    game = updatePlayer(game, PLAYER1, (player) => ({
      ...player,
      memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.RIGHT, second.instanceId),
    }));
    const selection = resolvePendingCardEffects({
      ...game,
      pendingAbilities: [
        pendingAbility(
          'dynamic-draw',
          scenario.source.instanceId,
          SlotPosition.CENTER,
          SP_SD1_001_ON_ENTER_DRAW_PER_SIX_ENERGY_ABILITY_ID
        ),
        pendingAbility('fixed-draw', second.instanceId, SlotPosition.RIGHT),
      ],
    }).gameState;
    expect(selection.activeEffect?.canResolveInOrder).toBe(true);
    const resolved = confirmActiveEffectStep(
      selection,
      PLAYER1,
      selection.activeEffect!.id,
      null,
      null,
      true
    );
    expect(resolved.pendingAbilities).toEqual([]);
    expect(resolved.activeEffect).toBeNull();
    expect(resolved.players[0].hand.cardIds).toEqual(
      scenario.deckCards.map((card) => card.instanceId)
    );
    expect(
      resolved.actionHistory
        .filter((action) => action.type === 'RESOLVE_ABILITY')
        .map((action) => action.payload.abilityId)
    ).toEqual(
      expect.arrayContaining([
        SP_SD1_001_ON_ENTER_DRAW_PER_SIX_ENERGY_ABILITY_ID,
        MEMBER_ON_ENTER_DRAW_ONE_ABILITY_ID,
      ])
    );
  });
});

function createFiveyncriseMember(cardCode: string, name = '鬼塚夏美'): MemberCardData {
  return { ...createMember(cardCode, name, 2), groupNames: ['Liella!'], unitName: '5yncri5e!' };
}

function resolveSpPb1009(
  options: {
    readonly sourceCode?: string;
    readonly ownStageCards?: readonly ReturnType<typeof createCardInstance>[];
    readonly opponentStageCards?: readonly ReturnType<typeof createCardInstance>[];
    readonly handCards?: readonly ReturnType<typeof createCardInstance>[];
    readonly waitingRoomCards?: readonly ReturnType<typeof createCardInstance>[];
    readonly memberBelowCards?: readonly ReturnType<typeof createCardInstance>[];
    readonly includeDrawCard?: boolean;
  } = {}
) {
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

function resolvePlBp4016(options: {
  readonly successLiveScores: readonly number[];
  readonly nonLivePrintedScore?: number;
  readonly drawSource?: 'MAIN_DECK' | 'WAITING_ROOM' | 'NONE';
}): { readonly state: GameState; readonly drawCardId: string } {
  const source = createCardInstance(
    createMember('PL!-bp4-016-N', '東條 希', 4),
    PLAYER1,
    'bp4-016-source'
  );
  const successLives = options.successLiveScores.map((score, index) =>
    createCardInstance(createLive(`SUCCESS-LIVE-${index}`, score), PLAYER1, `success-live-${index}`)
  );
  const nonLive =
    options.nonLivePrintedScore === undefined
      ? null
      : createCardInstance(
          {
            ...createMember('NON-LIVE-IN-SUCCESS', 'Non LIVE'),
            score: options.nonLivePrintedScore,
          } as MemberCardData & { readonly score: number },
          PLAYER1,
          'non-live-success'
        );
  const drawCard = createCardInstance(createMember('DRAW-CARD'), PLAYER1, 'bp4-016-draw');
  const drawSource = options.drawSource ?? 'MAIN_DECK';
  let game = createGameState('pl-bp4-016-draw', PLAYER1, 'P1', PLAYER2, 'P2');
  game = registerCards(game, [source, ...successLives, ...(nonLive ? [nonLive] : []), drawCard]);
  game = updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    mainDeck: {
      ...player.mainDeck,
      cardIds: drawSource === 'MAIN_DECK' ? [drawCard.instanceId] : [],
    },
    waitingRoom: {
      ...player.waitingRoom,
      cardIds: drawSource === 'WAITING_ROOM' ? [drawCard.instanceId] : [],
    },
    successZone: {
      ...player.successZone,
      cardIds: [
        ...successLives.map((card) => card.instanceId),
        ...(nonLive ? [nonLive.instanceId] : []),
      ],
    },
    memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, source.instanceId),
  }));

  const state = resolvePendingCardEffects({
    ...game,
    pendingAbilities: [
      pendingAbility(
        'bp4-016-pending',
        source.instanceId,
        SlotPosition.CENTER,
        PL_BP4_016_ON_ENTER_SUCCESS_SCORE_THREE_DRAW_ONE_ABILITY_ID
      ),
    ],
  }).gameState;
  return { state, drawCardId: drawCard.instanceId };
}

describe('PL!-bp4-016-N shared success-score on-enter draw', () => {
  it('consumes pending without drawing at success LIVE effective score 2', () => {
    const { state, drawCardId } = resolvePlBp4016({ successLiveScores: [2] });
    expect(state.pendingAbilities).toEqual([]);
    expect(state.players[0].hand.cardIds).not.toContain(drawCardId);
    expect(state.actionHistory.at(-1)?.payload).toMatchObject({
      abilityId: PL_BP4_016_ON_ENTER_SUCCESS_SCORE_THREE_DRAW_ONE_ABILITY_ID,
      step: 'SUCCESS_LIVE_SCORE_CONDITION_NOT_MET',
      successLiveScore: 2,
      requiredSuccessLiveScore: 3,
    });
  });

  it('draws one at success LIVE effective score 3', () => {
    const { state, drawCardId } = resolvePlBp4016({ successLiveScores: [1, 2] });
    expect(state.pendingAbilities).toEqual([]);
    expect(state.players[0].hand.cardIds).toEqual([drawCardId]);
    expect(state.actionHistory.at(-1)?.payload).toMatchObject({
      abilityId: PL_BP4_016_ON_ENTER_SUCCESS_SCORE_THREE_DRAW_ONE_ABILITY_ID,
      step: 'ON_ENTER_SUCCESS_LIVE_SCORE_THREE_DRAW_ONE',
      successLiveScore: 3,
      drawnCardIds: [drawCardId],
      drawCount: 1,
    });
  });

  it('does not count a non-LIVE card mixed into the success zone', () => {
    const { state, drawCardId } = resolvePlBp4016({
      successLiveScores: [2],
      nonLivePrintedScore: 99,
    });
    expect(state.players[0].hand.cardIds).not.toContain(drawCardId);
    expect(state.actionHistory.at(-1)?.payload).toMatchObject({
      step: 'SUCCESS_LIVE_SCORE_CONDITION_NOT_MET',
      successLiveScore: 2,
    });
  });

  it('refreshes an empty main deck from the waiting room before drawing', () => {
    const { state, drawCardId } = resolvePlBp4016({
      successLiveScores: [3],
      drawSource: 'WAITING_ROOM',
    });
    expect(state.pendingAbilities).toEqual([]);
    expect(state.players[0].hand.cardIds).toEqual([drawCardId]);
    expect(state.players[0].waitingRoom.cardIds).not.toContain(drawCardId);
    expect(
      state.actionHistory.some(
        (action) =>
          action.type === 'RULE_ACTION' &&
          action.payload.type === 'REFRESH' &&
          action.payload.affectedPlayerId === PLAYER1
      )
    ).toBe(true);
  });

  it('records only the actual zero-card draw and continues pending when no card can be drawn', () => {
    const { state } = resolvePlBp4016({ successLiveScores: [3], drawSource: 'NONE' });
    expect(state.pendingAbilities).toEqual([]);
    expect(state.activeEffect).toBeNull();
    expect(state.actionHistory.at(-1)?.payload).toMatchObject({
      abilityId: PL_BP4_016_ON_ENTER_SUCCESS_SCORE_THREE_DRAW_ONE_ABILITY_ID,
      step: 'ON_ENTER_SUCCESS_LIVE_SCORE_THREE_DRAW_ONE',
      drawnCardIds: [],
      drawCount: 0,
    });
  });
});

function resolveSpBp1008(
  options: {
    readonly meiName?: string;
    readonly meiZone?: 'OWN_STAGE' | 'OPPONENT_STAGE' | 'MEMBER_BELOW' | 'WAITING_ROOM' | 'NONE';
    readonly drawCount?: number;
    readonly sourceCode?: string;
    readonly beforeResolution?: 'MEI_ENTERS_STAGE' | 'MEI_LEAVES_STAGE';
  } = {}
) {
  const meiZoneAtQueue =
    options.beforeResolution === 'MEI_ENTERS_STAGE'
      ? 'NONE'
      : options.beforeResolution === 'MEI_LEAVES_STAGE'
        ? 'OWN_STAGE'
        : options.meiZone;
  const source = createCardInstance(
    createMember(options.sourceCode ?? 'PL!SP-bp1-008-P', '若菜四季', 13),
    PLAYER1,
    'sp-bp1-008-source'
  );
  const mei = createCardInstance(
    createMember('MEI', options.meiName ?? '米女メイ', 13),
    options.meiZone === 'OPPONENT_STAGE' ? PLAYER2 : PLAYER1,
    'sp-bp1-008-mei'
  );
  const drawCards = Array.from({ length: options.drawCount ?? 2 }, (_, index) =>
    createCardInstance(createMember(`DRAW-${index}`), PLAYER1, `sp-bp1-008-draw-${index}`)
  );
  let game = registerCards(createGameState('sp-bp1-008', PLAYER1, 'P1', PLAYER2, 'P2'), [
    source,
    mei,
    ...drawCards,
  ]);
  game = updatePlayer(game, PLAYER1, (player) => {
    let memberSlots = placeCardInSlot(player.memberSlots, SlotPosition.CENTER, source.instanceId);
    if (meiZoneAtQueue === 'OWN_STAGE') {
      memberSlots = placeCardInSlot(memberSlots, SlotPosition.LEFT, mei.instanceId);
    }
    if (options.meiZone === 'MEMBER_BELOW') {
      memberSlots = {
        ...memberSlots,
        memberBelow: {
          ...memberSlots.memberBelow,
          [SlotPosition.CENTER]: [mei.instanceId],
        },
      };
    }
    return {
      ...player,
      mainDeck: { ...player.mainDeck, cardIds: drawCards.map((card) => card.instanceId) },
      waitingRoom:
        options.meiZone === 'WAITING_ROOM'
          ? { ...player.waitingRoom, cardIds: [mei.instanceId] }
          : player.waitingRoom,
      memberSlots,
    };
  });
  if (options.meiZone === 'OPPONENT_STAGE') {
    game = updatePlayer(game, PLAYER2, (player) => ({
      ...player,
      memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.LEFT, mei.instanceId),
    }));
  }
  let queuedGame: GameState = {
    ...game,
    pendingAbilities: [
      pendingAbility(
        'sp-bp1-008-pending',
        source.instanceId,
        SlotPosition.CENTER,
        SP_BP1_008_ON_ENTER_DRAW_ONE_BONUS_IF_MEI_ABILITY_ID
      ),
    ],
  };
  if (options.beforeResolution === 'MEI_ENTERS_STAGE') {
    queuedGame = updatePlayer(queuedGame, PLAYER1, (player) => ({
      ...player,
      memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.LEFT, mei.instanceId),
    }));
  } else if (options.beforeResolution === 'MEI_LEAVES_STAGE') {
    queuedGame = updatePlayer(queuedGame, PLAYER1, (player) => ({
      ...player,
      memberSlots: removeCardFromSlot(player.memberSlots, SlotPosition.LEFT),
      waitingRoom: {
        ...player.waitingRoom,
        cardIds: [...player.waitingRoom.cardIds, mei.instanceId],
      },
    }));
  }
  const state = resolvePendingCardEffects(queuedGame).gameState;
  return { state, source, mei, drawCards };
}

describe('PL!SP-bp1-008 shared member-on-enter conditional draw', () => {
  it.each(['PL!SP-bp1-008-P', 'PL!SP-bp1-008-R'])(
    'draws only one for %s without Mei on the own main stage',
    (sourceCode) => {
      const { state, drawCards } = resolveSpBp1008({ sourceCode, meiZone: 'NONE' });
      expect(state.players[0].hand.cardIds).toEqual([drawCards[0]!.instanceId]);
      expect(state.actionHistory.at(-1)?.payload).toMatchObject({
        abilityId: SP_BP1_008_ON_ENTER_DRAW_ONE_BONUS_IF_MEI_ABILITY_ID,
        hasBonusStageMember: false,
        requestedDrawCount: 1,
        drawCount: 1,
      });
    }
  );

  it.each(['米女メイ', '米女芽衣', '米女メイ&鬼塚夏美'])(
    'draws two for the own-stage Mei identity %s',
    (meiName) => {
      const { state, drawCards } = resolveSpBp1008({ meiName, meiZone: 'OWN_STAGE' });
      expect(state.players[0].hand.cardIds).toEqual(drawCards.map((card) => card.instanceId));
      expect(state.actionHistory.at(-1)?.payload).toMatchObject({
        bonusStageMemberName: '米女メイ',
        hasBonusStageMember: true,
        requestedDrawCount: 2,
        drawCount: 2,
      });
    }
  );

  it.each(['OPPONENT_STAGE', 'MEMBER_BELOW', 'WAITING_ROOM'] as const)(
    'does not count Mei in %s',
    (meiZone) => {
      const { state, drawCards } = resolveSpBp1008({ meiZone });
      expect(state.players[0].hand.cardIds).toEqual([drawCards[0]!.instanceId]);
    }
  );

  it('uses the stage state at resolution when Mei enters or leaves after queueing', () => {
    expect(
      resolveSpBp1008({ beforeResolution: 'MEI_ENTERS_STAGE' }).state.players[0].hand.cardIds
    ).toHaveLength(2);
    expect(
      resolveSpBp1008({ beforeResolution: 'MEI_LEAVES_STAGE' }).state.players[0].hand.cardIds
    ).toHaveLength(1);
  });

  it('draws only the actual available card when the bonus requests two', () => {
    const { state, drawCards } = resolveSpBp1008({ meiZone: 'OWN_STAGE', drawCount: 1 });
    expect(state.players[0].hand.cardIds).toEqual([drawCards[0]!.instanceId]);
    expect(state.actionHistory.at(-1)?.payload).toMatchObject({
      requestedDrawCount: 2,
      drawCount: 1,
    });
  });

  it('fully consumes its pending and continues an ordered draw ability', () => {
    const first = createCardInstance(
      createMember('PL!SP-bp1-008-P', '若菜四季', 13),
      PLAYER1,
      'sp-bp1-008-first'
    );
    const second = createCardInstance(createMember('GENERIC'), PLAYER1, 'generic-second');
    const mei = createCardInstance(createMember('MEI', '米女芽衣'), PLAYER1, 'mei');
    const draws = [0, 1, 2].map((index) =>
      createCardInstance(createMember(`DRAW-${index}`), PLAYER1, `ordered-draw-${index}`)
    );
    let game = registerCards(createGameState('sp-bp1-008-ordered', PLAYER1, 'P1', PLAYER2, 'P2'), [
      first,
      second,
      mei,
      ...draws,
    ]);
    game = updatePlayer(game, PLAYER1, (player) => ({
      ...player,
      mainDeck: { ...player.mainDeck, cardIds: draws.map((card) => card.instanceId) },
      memberSlots: placeCardInSlot(
        placeCardInSlot(
          placeCardInSlot(player.memberSlots, SlotPosition.LEFT, first.instanceId),
          SlotPosition.CENTER,
          mei.instanceId
        ),
        SlotPosition.RIGHT,
        second.instanceId
      ),
    }));
    const selection = resolvePendingCardEffects({
      ...game,
      pendingAbilities: [
        pendingAbility(
          'conditional',
          first.instanceId,
          SlotPosition.LEFT,
          SP_BP1_008_ON_ENTER_DRAW_ONE_BONUS_IF_MEI_ABILITY_ID
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
    expect(resolved.players[0].hand.cardIds).toEqual(draws.map((card) => card.instanceId));
  });
});
