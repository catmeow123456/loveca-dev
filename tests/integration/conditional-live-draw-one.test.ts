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
  type HeartIcon,
} from '../../src/domain/entities/card';
import {
  createGameState,
  emitGameEvent,
  registerCards,
  updatePlayer,
  type GameState,
  type PendingAbilityState,
} from '../../src/domain/entities/game';
import { createCheerEvent } from '../../src/domain/events/game-events';
import {
  confirmActiveEffectStep,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import {
  PL_BP4_001_LIVE_START_LOWER_STAGE_COST_DRAW_ONE_ABILITY_ID,
  PL_BP4_023_LIVE_SUCCESS_PINK_REMAINING_HEART_DRAW_ONE_ABILITY_ID,
  PL_N_BP4_003_LIVE_SUCCESS_HIGHER_SCORE_DRAW_ABILITY_ID,
  S_BP3_005_LIVE_SUCCESS_FEWER_REVEALED_CHEER_CARDS_DRAW_ONE_ABILITY_ID,
} from '../../src/application/card-effects/ability-ids';
import { GameService } from '../../src/application/game-service';
import { addLiveModifier } from '../../src/domain/rules/live-modifiers';
import { getCardAbilityDefinitionsForCardCode } from '../../src/application/card-effects/definitions/lookup';
import {
  CardAbilityCategory,
  CardAbilitySourceZone,
} from '../../src/application/card-effects/ability-definition-types';
import { placeCardInSlot } from '../../src/domain/entities/zone';
import {
  CardType,
  FaceState,
  HeartColor,
  OrientationState,
  SlotPosition,
  TriggerCondition,
} from '../../src/shared/types/enums';

const PLAYER1 = 'player1';
const PLAYER2 = 'player2';

function sourceMember(cardCode: string): MemberCardData {
  return {
    cardCode,
    name: '渡辺 曜',
    groupNames: ['Aqours'],
    cardType: CardType.MEMBER,
    cost: 7,
    blade: 1,
    hearts: [],
  };
}

function cheerCardData(cardCode: string, cardType: CardType): AnyCardData {
  if (cardType === CardType.LIVE) {
    return {
      cardCode,
      name: cardCode,
      groupNames: ['Aqours'],
      cardType,
      score: 1,
      requirements: createHeartRequirement({ [HeartColor.RED]: 1 }),
    } satisfies LiveCardData;
  }
  if (cardType === CardType.ENERGY) {
    return { cardCode, name: cardCode, cardType } satisfies EnergyCardData;
  }
  return {
    cardCode,
    name: cardCode,
    groupNames: ['Aqours'],
    cardType,
    cost: 1,
    blade: 1,
    hearts: [],
  } satisfies MemberCardData;
}

interface SetupOptions {
  readonly sourceCardCode?: string;
  readonly ownCardTypes?: readonly CardType[];
  readonly opponentCardTypes?: readonly CardType[];
  readonly movedOwnIndexes?: readonly number[];
  readonly additionalOwnIndexes?: readonly number[];
  readonly includeUnrelatedCheerEvent?: boolean;
  readonly deckCount?: number;
  readonly sourceOnStage?: boolean;
}

function setup(options: SetupOptions = {}): {
  readonly game: GameState;
  readonly sourceId: string;
  readonly drawIds: readonly string[];
  readonly ownCheerIds: readonly string[];
  readonly opponentCheerIds: readonly string[];
} {
  const ownCardTypes = options.ownCardTypes ?? [];
  const opponentCardTypes = options.opponentCardTypes ?? [];
  const source = createCardInstance(
    sourceMember(options.sourceCardCode ?? 'PL!S-bp3-005-P'),
    PLAYER1,
    's-bp3-005-source'
  );
  const ownCheerCards = ownCardTypes.map((cardType, index) =>
    createCardInstance(
      cheerCardData(`s-bp3-005-own-cheer-${index}`, cardType),
      PLAYER1,
      `s-bp3-005-own-cheer-${index}`
    )
  );
  const opponentCheerCards = opponentCardTypes.map((cardType, index) =>
    createCardInstance(
      cheerCardData(`s-bp3-005-opponent-cheer-${index}`, cardType),
      PLAYER2,
      `s-bp3-005-opponent-cheer-${index}`
    )
  );
  const drawCards = Array.from({ length: options.deckCount ?? 1 }, (_, index) =>
    createCardInstance(
      cheerCardData(`s-bp3-005-draw-${index}`, CardType.MEMBER),
      PLAYER1,
      `s-bp3-005-draw-${index}`
    )
  );
  const allCards = [source, ...ownCheerCards, ...opponentCheerCards, ...drawCards];
  let game = registerCards(
    createGameState('conditional-live-draw-one', PLAYER1, 'P1', PLAYER2, 'P2'),
    allCards
  );
  const movedOwnIndexes = new Set(options.movedOwnIndexes ?? []);
  const ownCheerIds = ownCheerCards.map((card) => card.instanceId);
  const opponentCheerIds = opponentCheerCards.map((card) => card.instanceId);
  const currentResolutionIds = [...ownCheerIds, ...opponentCheerIds].filter(
    (cardId) => !movedOwnIndexes.has(ownCheerIds.indexOf(cardId))
  );

  game = updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    memberSlots:
      options.sourceOnStage === false
        ? player.memberSlots
        : placeCardInSlot(player.memberSlots, SlotPosition.CENTER, source.instanceId, {
            orientation: OrientationState.ACTIVE,
            face: FaceState.FACE_UP,
          }),
    mainDeck: { ...player.mainDeck, cardIds: drawCards.map((card) => card.instanceId) },
  }));
  game = {
    ...game,
    resolutionZone: {
      ...game.resolutionZone,
      cardIds: currentResolutionIds,
      revealedCardIds: currentResolutionIds,
    },
    liveResolution: {
      ...game.liveResolution,
      performingPlayerId: PLAYER1,
      firstPlayerCheerCardIds: ownCheerIds,
      secondPlayerCheerCardIds: opponentCheerIds,
      playerScores: new Map([
        [PLAYER1, 0],
        [PLAYER2, 0],
      ]),
    },
  };

  if (ownCheerIds.length > 0) {
    const additionalIndexes = new Set(options.additionalOwnIndexes ?? []);
    const normalIds = ownCheerIds.filter((_, index) => !additionalIndexes.has(index));
    const additionalIds = ownCheerIds.filter((_, index) => additionalIndexes.has(index));
    if (normalIds.length > 0) {
      game = emitGameEvent(game, createCheerEvent(PLAYER1, normalIds, normalIds.length));
    }
    if (additionalIds.length > 0) {
      game = emitGameEvent(
        game,
        createCheerEvent(PLAYER1, additionalIds, additionalIds.length, { additional: true })
      );
    }
  }
  if (opponentCheerIds.length > 0) {
    game = emitGameEvent(
      game,
      createCheerEvent(PLAYER2, opponentCheerIds, opponentCheerIds.length)
    );
  }
  if (options.includeUnrelatedCheerEvent) {
    game = emitGameEvent(game, createCheerEvent(PLAYER1, ['unrelated-cheer-card'], 1));
  }

  return {
    game,
    sourceId: source.instanceId,
    drawIds: drawCards.map((card) => card.instanceId),
    ownCheerIds,
    opponentCheerIds,
  };
}

function pendingAbility(
  abilityId: string,
  sourceCardId: string,
  id = 'pending'
): PendingAbilityState {
  return {
    id,
    abilityId,
    sourceCardId,
    controllerId: PLAYER1,
    mandatory: true,
    timingId: TriggerCondition.ON_LIVE_SUCCESS,
    eventIds: [`live-success:${id}`],
  };
}

function start005(game: GameState, sourceId: string, id = 'pending'): GameState {
  return resolvePendingCardEffects({
    ...game,
    pendingAbilities: [
      pendingAbility(S_BP3_005_LIVE_SUCCESS_FEWER_REVEALED_CHEER_CARDS_DRAW_ONE_ABILITY_ID, sourceId, id),
    ],
  }).gameState;
}

function confirm005(started: GameState): GameState {
  expect(started.activeEffect?.metadata?.confirmOnlyPendingAbility).toBe(true);
  return confirmActiveEffectStep(started, PLAYER1, started.activeEffect!.id);
}

function latest005Payload(game: GameState): Readonly<Record<string, unknown>> {
  const action = [...game.actionHistory]
    .reverse()
    .find(
      (candidate) =>
        candidate.type === 'RESOLVE_ABILITY' &&
        candidate.payload.abilityId ===
          S_BP3_005_LIVE_SUCCESS_FEWER_REVEALED_CHEER_CARDS_DRAW_ONE_ABILITY_ID
    );
  return action?.payload ?? {};
}

const SHARED_PLAYER_VISIBLE_INTERNAL_WORDS =
  /此成员已不在舞台|来源不在舞台|来源在舞台|来源不在LIVE区|来源在LIVE区|source|pending|payload|stale|eventId|trigger/i;

describe('shared conditional LIVE draw-one workflow', () => {
  it('registers one implemented P/R definition and does not match another card', () => {
    for (const cardCode of ['PL!S-bp3-005-P', 'PL!S-bp3-005-R']) {
      const matches = getCardAbilityDefinitionsForCardCode(cardCode).filter(
        (definition) =>
          definition.abilityId ===
          S_BP3_005_LIVE_SUCCESS_FEWER_REVEALED_CHEER_CARDS_DRAW_ONE_ABILITY_ID
      );
      expect(matches).toHaveLength(1);
      expect(matches[0]).toMatchObject({
        baseCardCodes: ['PL!S-bp3-005'],
        category: CardAbilityCategory.LIVE_SUCCESS,
        sourceZone: CardAbilitySourceZone.STAGE_MEMBER,
        triggerCondition: TriggerCondition.ON_LIVE_SUCCESS,
        queued: true,
        implemented: true,
        effectText:
          '【LIVE成功时】因声援被公开的自己的卡片的张数，少于因声援被公开的对方的卡片的张数的场合，抽1张卡。',
      });
    }
    expect(
      getCardAbilityDefinitionsForCardCode('PL!S-bp3-004-R').some(
        (definition) =>
          definition.abilityId ===
          S_BP3_005_LIVE_SUCCESS_FEWER_REVEALED_CHEER_CARDS_DRAW_ONE_ABILITY_ID
      )
    ).toBe(false);
  });

  it.each([
    { own: 0, opponent: 1 },
    { own: 1, opponent: 2 },
    { own: 2, opponent: 3 },
  ])('draws one when own revealed cheer count is lower ($own < $opponent)', ({ own, opponent }) => {
    const { game, sourceId, drawIds } = setup({
      ownCardTypes: Array.from({ length: own }, () => CardType.MEMBER),
      opponentCardTypes: Array.from({ length: opponent }, () => CardType.MEMBER),
    });
    const started = start005(game, sourceId);
    expect(started.activeEffect?.effectText).toBe(
      `【LIVE成功时】因声援被公开的自己的卡片的张数，少于因声援被公开的对方的卡片的张数的场合，抽1张卡。（本次自己因声援公开${own}张，对方${opponent}张，满足条件，实际抽1张卡。）`
    );
    expect(started.activeEffect?.stepText).not.toMatch(
      SHARED_PLAYER_VISIBLE_INTERNAL_WORDS
    );
    expect(started.players[0].hand.cardIds).toEqual([]);
    const resolved = confirm005(started);
    expect(resolved.players[0].hand.cardIds).toEqual(drawIds.slice(0, 1));
    expect(resolved.pendingAbilities).toEqual([]);
    expect(resolved.activeEffect).toBeNull();
  });

  it.each([
    { own: 1, opponent: 1 },
    { own: 2, opponent: 1 },
    { own: 2, opponent: 2 },
  ])('does not draw when own revealed cheer count is not lower ($own vs $opponent)', ({ own, opponent }) => {
    const { game, sourceId, drawIds } = setup({
      ownCardTypes: Array.from({ length: own }, () => CardType.MEMBER),
      opponentCardTypes: Array.from({ length: opponent }, () => CardType.MEMBER),
    });
    const started = start005(game, sourceId);
    expect(started.activeEffect?.effectText).toBe(
      `【LIVE成功时】因声援被公开的自己的卡片的张数，少于因声援被公开的对方的卡片的张数的场合，抽1张卡。（本次自己因声援公开${own}张，对方${opponent}张，未满足条件，实际抽0张卡。）`
    );
    expect(started.activeEffect?.stepText).not.toMatch(
      SHARED_PLAYER_VISIBLE_INTERNAL_WORDS
    );
    const resolved = confirm005(started);
    expect(resolved.players[0].hand.cardIds).toEqual([]);
    expect(resolved.players[0].mainDeck.cardIds).toEqual(drawIds);
    expect(latest005Payload(resolved)).toMatchObject({
      ownRevealedCheerCount: own,
      opponentRevealedCheerCount: opponent,
      conditionMet: false,
      drawnCardIds: [],
      step: 'REVEALED_CHEER_COUNT_NOT_LOWER',
    });
  });

  it('treats an opponent without a LIVE as zero revealed cheer cards', () => {
    const { game, sourceId } = setup({
      ownCardTypes: [],
      opponentCardTypes: [],
    });
    const resolved = confirm005(start005(game, sourceId));
    expect(resolved.players[0].hand.cardIds).toEqual([]);
    expect(latest005Payload(resolved)).toMatchObject({
      ownRevealedCheerCount: 0,
      opponentRevealedCheerCount: 0,
      conditionMet: false,
    });
  });

  it('counts all legal cheer-revealed card types, not only members or LIVE cards', () => {
    const { game, sourceId } = setup({
      ownCardTypes: [CardType.MEMBER, CardType.LIVE, CardType.ENERGY],
      opponentCardTypes: [CardType.MEMBER, CardType.LIVE, CardType.ENERGY, CardType.MEMBER],
    });
    const resolved = confirm005(start005(game, sourceId));
    expect(latest005Payload(resolved)).toMatchObject({
      ownRevealedCheerCount: 3,
      opponentRevealedCheerCount: 4,
      conditionMet: true,
    });
  });

  it('counts a cheer-revealed card after a previous effect removed it from resolutionZone', () => {
    const { game, sourceId, ownCheerIds } = setup({
      ownCardTypes: [CardType.MEMBER, CardType.LIVE],
      opponentCardTypes: [CardType.MEMBER, CardType.LIVE, CardType.ENERGY],
      movedOwnIndexes: [0],
    });
    const resolved = confirm005(start005(game, sourceId));
    expect(latest005Payload(resolved)).toMatchObject({
      ownRevealedCheerCardIds: ownCheerIds,
      ownRevealedCheerCount: 2,
      opponentRevealedCheerCount: 3,
      conditionMet: true,
    });
  });

  it('counts normal and additional cheer events, while ignoring an unrelated event', () => {
    const { game, sourceId } = setup({
      ownCardTypes: [CardType.MEMBER, CardType.LIVE],
      opponentCardTypes: [CardType.MEMBER, CardType.LIVE, CardType.ENERGY],
      additionalOwnIndexes: [1],
      includeUnrelatedCheerEvent: true,
    });
    const resolved = confirm005(start005(game, sourceId));
    expect(latest005Payload(resolved)).toMatchObject({
      ownRevealedCheerCount: 2,
      opponentRevealedCheerCount: 3,
      conditionMet: true,
    });
    expect(start005(game, sourceId).activeEffect?.effectText).not.toContain('unrelated');
  });

  it('rereads the current cheer facts after the confirm-only window opens', () => {
    const { game, sourceId, ownCheerIds, opponentCheerIds, drawIds } = setup({
      ownCardTypes: [CardType.MEMBER],
      opponentCardTypes: [CardType.MEMBER, CardType.LIVE],
    });
    const started = start005(game, sourceId);
    const changedBeforeConfirm: GameState = {
      ...started,
      liveResolution: {
        ...started.liveResolution,
        firstPlayerCheerCardIds: [ownCheerIds[0]!],
        secondPlayerCheerCardIds: [opponentCheerIds[0]!],
      },
    };
    const resolved = confirm005(changedBeforeConfirm);
    expect(resolved.players[0].hand.cardIds).toEqual([]);
    expect(resolved.players[0].mainDeck.cardIds).toEqual(drawIds);
    expect(latest005Payload(resolved)).toMatchObject({
      ownRevealedCheerCount: 1,
      opponentRevealedCheerCount: 1,
      conditionMet: false,
    });
  });

  it('keeps the source-safe no-op path without leaking internal source wording', () => {
    const { game, sourceId } = setup({
      sourceOnStage: false,
      ownCardTypes: [CardType.MEMBER],
      opponentCardTypes: [CardType.MEMBER, CardType.LIVE],
    });
    const started = start005(game, sourceId);
    expect(started.activeEffect?.effectText).toBe(
      '【LIVE成功时】因声援被公开的自己的卡片的张数，少于因声援被公开的对方的卡片的张数的场合，抽1张卡。（本次自己因声援公开1张，对方2张，满足条件，实际抽0张卡。）'
    );
    expect(started.activeEffect?.stepText).toBe('确认后按当前声援公开张数结算此效果。');
    expect(started.activeEffect?.effectText).not.toMatch(
      SHARED_PLAYER_VISIBLE_INTERNAL_WORDS
    );
    expect(started.activeEffect?.stepText).not.toMatch(
      SHARED_PLAYER_VISIBLE_INTERNAL_WORDS
    );
    const resolved = confirm005(started);
    expect(resolved.players[0].hand.cardIds).toEqual([]);
    expect(resolved.pendingAbilities).toEqual([]);
    expect(resolved.activeEffect).toBeNull();
    expect(latest005Payload(resolved)).toEqual({
      pendingAbilityId: 'pending',
      abilityId: 'PL!S-bp3-005:live-success-fewer-revealed-cheer-cards-draw-one',
      sourceCardId: 's-bp3-005-source',
      sourceSlot: null,
      step: 'SOURCE_NOT_ON_STAGE',
      ownRevealedCheerCardIds: ['s-bp3-005-own-cheer-0'],
      opponentRevealedCheerCardIds: [
        's-bp3-005-opponent-cheer-0',
        's-bp3-005-opponent-cheer-1',
      ],
      ownRevealedCheerCount: 1,
      opponentRevealedCheerCount: 2,
      conditionMet: true,
      drawnCardIds: [],
    });
  });

  it('records exact drawnCardIds when the deck can draw and clears them when it cannot', () => {
    const drawable = setup({
      ownCardTypes: [],
      opponentCardTypes: [CardType.MEMBER],
      deckCount: 2,
    });
    const drawableResolved = confirm005(start005(drawable.game, drawable.sourceId));
    expect(latest005Payload(drawableResolved)).toMatchObject({
      drawnCardIds: [drawable.drawIds[0]],
    });

    const emptyDeck = setup({
      ownCardTypes: [],
      opponentCardTypes: [CardType.MEMBER],
      deckCount: 0,
    });
    const emptyResolved = confirm005(start005(emptyDeck.game, emptyDeck.sourceId));
    expect(latest005Payload(emptyResolved)).toMatchObject({ drawnCardIds: [] });
    expect(emptyResolved.pendingAbilities).toEqual([]);
    expect(emptyResolved.activeEffect).toBeNull();
  });

  it('uses confirm-only for a single pending and manual point selection', () => {
    const { game, sourceId, drawIds } = setup({
      ownCardTypes: [],
      opponentCardTypes: [CardType.MEMBER],
      deckCount: 2,
    });
    const first = pendingAbility(
      S_BP3_005_LIVE_SUCCESS_FEWER_REVEALED_CHEER_CARDS_DRAW_ONE_ABILITY_ID,
      sourceId,
      'first'
    );
    const second = pendingAbility(
      S_BP3_005_LIVE_SUCCESS_FEWER_REVEALED_CHEER_CARDS_DRAW_ONE_ABILITY_ID,
      sourceId,
      'second'
    );
    const selected = resolvePendingCardEffects({
      ...game,
      pendingAbilities: [first, second],
    }).gameState;
    const manuallyStarted = confirmActiveEffectStep(
      selected,
      PLAYER1,
      selected.activeEffect!.id,
      null,
      null,
      false,
      first.id
    );
    expect(manuallyStarted.activeEffect?.metadata?.confirmOnlyPendingAbility).toBe(true);
    expect(manuallyStarted.players[0].hand.cardIds).toEqual([]);
    const resolved = confirmActiveEffectStep(
      manuallyStarted,
      PLAYER1,
      manuallyStarted.activeEffect!.id
    );
    expect(resolved.players[0].hand.cardIds).toEqual([drawIds[0]]);
  });

  it('ordered resolution auto-settles the family without opening per-effect confirmations', () => {
    const { game, sourceId, drawIds } = setup({
      ownCardTypes: [],
      opponentCardTypes: [CardType.MEMBER],
      deckCount: 2,
    });
    const first = pendingAbility(
      S_BP3_005_LIVE_SUCCESS_FEWER_REVEALED_CHEER_CARDS_DRAW_ONE_ABILITY_ID,
      sourceId,
      'ordered-first'
    );
    const second = pendingAbility(
      S_BP3_005_LIVE_SUCCESS_FEWER_REVEALED_CHEER_CARDS_DRAW_ONE_ABILITY_ID,
      sourceId,
      'ordered-second'
    );
    let state = resolvePendingCardEffects({
      ...game,
      pendingAbilities: [first, second],
    }).gameState;
    state = confirmActiveEffectStep(
      state,
      PLAYER1,
      state.activeEffect!.id,
      null,
      null,
      true
    );
    expect(state.activeEffect).toBeNull();
    expect(state.pendingAbilities).toEqual([]);
    expect(state.players[0].hand.cardIds).toEqual(drawIds);
  });

  it('keeps the exact 005 action payload and removes activeEffect/pending state', () => {
    const { game, sourceId, ownCheerIds, opponentCheerIds, drawIds } = setup({
      ownCardTypes: [CardType.MEMBER],
      opponentCardTypes: [CardType.LIVE, CardType.ENERGY],
    });
    const resolved = confirm005(start005(game, sourceId));
    expect(latest005Payload(resolved)).toMatchObject({
      ownRevealedCheerCardIds: ownCheerIds,
      opponentRevealedCheerCardIds: opponentCheerIds,
      ownRevealedCheerCount: 1,
      opponentRevealedCheerCount: 2,
      conditionMet: true,
      step: 'DRAW_ONE',
      drawnCardIds: [drawIds[0]],
    });
    expect(resolved.pendingAbilities).toEqual([]);
    expect(resolved.activeEffect).toBeNull();
  });
});

function bp4Member(cardCode: string, cost: number, name = cardCode): MemberCardData {
  return {
    cardCode,
    name,
    groupNames: ["μ's"],
    cardType: CardType.MEMBER,
    cost,
    blade: 1,
    hearts: [],
  };
}

function bp4Live(cardCode = 'PL!-bp4-023-L'): LiveCardData {
  return {
    cardCode,
    name: 'もぎゅっと"love"で接近中！',
    groupNames: ["μ's"],
    cardType: CardType.LIVE,
    score: 3,
    requirements: createHeartRequirement({ [HeartColor.PINK]: 1 }),
  };
}

function setupBp4001(options: {
  readonly sourceCardCode?: string;
  readonly ownCostDelta?: number;
  readonly opponentCosts?: readonly number[];
  readonly opponentWaitingIndexes?: readonly number[];
  readonly memberBelowCost?: number;
  readonly deckCount?: number;
} = {}) {
  const source = createCardInstance(
    bp4Member(options.sourceCardCode ?? 'PL!-bp4-001-P', 9, '高坂穂乃果'),
    PLAYER1,
    'bp4-001-source'
  );
  const opponents = (options.opponentCosts ?? [9]).map((cost, index) =>
    createCardInstance(bp4Member(`opponent-${index}`, cost), PLAYER2, `opponent-${index}`)
  );
  const memberBelow =
    options.memberBelowCost === undefined
      ? null
      : createCardInstance(
          bp4Member('opponent-member-below', options.memberBelowCost),
          PLAYER2,
          'opponent-member-below'
        );
  const draws = Array.from({ length: options.deckCount ?? 2 }, (_, index) =>
    createCardInstance(bp4Member(`bp4-001-draw-${index}`, 1), PLAYER1, `bp4-001-draw-${index}`)
  );
  let game = registerCards(
    createGameState('bp4-001-conditional-live-draw', PLAYER1, 'P1', PLAYER2, 'P2'),
    [source, ...opponents, ...(memberBelow ? [memberBelow] : []), ...draws]
  );
  game = updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, source.instanceId, {
      orientation: OrientationState.ACTIVE,
      face: FaceState.FACE_UP,
    }),
    mainDeck: { ...player.mainDeck, cardIds: draws.map((card) => card.instanceId) },
  }));
  game = updatePlayer(game, PLAYER2, (player) => {
    const slots = [SlotPosition.CENTER, SlotPosition.LEFT, SlotPosition.RIGHT];
    let memberSlots = player.memberSlots;
    for (const [index, opponent] of opponents.entries()) {
      memberSlots = placeCardInSlot(memberSlots, slots[index]!, opponent.instanceId, {
        orientation: (options.opponentWaitingIndexes ?? []).includes(index)
          ? OrientationState.WAITING
          : OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      });
    }
    if (memberBelow) {
      memberSlots = {
        ...memberSlots,
        memberBelow: {
          ...memberSlots.memberBelow,
          [SlotPosition.CENTER]: [memberBelow.instanceId],
        },
      };
    }
    return { ...player, memberSlots };
  });
  if (options.ownCostDelta !== undefined) {
    game = addLiveModifier(game, {
      kind: 'MEMBER_COST',
      playerId: PLAYER1,
      memberCardId: source.instanceId,
      countDelta: options.ownCostDelta,
      sourceCardId: source.instanceId,
      abilityId: 'test-effective-cost',
    });
  }
  return { game, source, opponents, memberBelow, draws };
}

function setupBp4023(options: {
  readonly sourceCardCode?: string;
  readonly remainingHearts?: readonly HeartIcon[];
  readonly liveJudgmentHearts?: readonly HeartIcon[];
  readonly deckCount?: number;
  readonly sourceInLiveZone?: boolean;
} = {}) {
  const source = createCardInstance(
    bp4Live(options.sourceCardCode),
    PLAYER1,
    'bp4-023-source'
  );
  const draws = Array.from({ length: options.deckCount ?? 2 }, (_, index) =>
    createCardInstance(bp4Member(`bp4-023-draw-${index}`, 1), PLAYER1, `bp4-023-draw-${index}`)
  );
  let game = registerCards(
    createGameState('bp4-023-conditional-live-draw', PLAYER1, 'P1', PLAYER2, 'P2'),
    [source, ...draws]
  );
  game = updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    liveZone: {
      ...player.liveZone,
      cardIds: options.sourceInLiveZone === false ? [] : [source.instanceId],
    },
    mainDeck: { ...player.mainDeck, cardIds: draws.map((card) => card.instanceId) },
  }));
  game = {
    ...game,
    liveResolution: {
      ...game.liveResolution,
      performingPlayerId: PLAYER1,
      liveResults: new Map([[source.instanceId, true]]),
      playerScores: new Map([[PLAYER1, 3]]),
      playerRemainingHearts: new Map([[PLAYER1, options.remainingHearts ?? []]]),
      playerLiveJudgmentHearts: new Map([
        [PLAYER1, options.liveJudgmentHearts ?? options.remainingHearts ?? []],
      ]),
    },
  };
  return { game, source, draws };
}

function directPending(
  abilityId: string,
  sourceCardId: string,
  timingId: TriggerCondition,
  id = 'pending'
): PendingAbilityState {
  return {
    id,
    abilityId,
    sourceCardId,
    controllerId: PLAYER1,
    mandatory: true,
    timingId,
    eventIds: [`${timingId}:${id}`],
  };
}

function startDirect(game: GameState, ability: PendingAbilityState): GameState {
  return resolvePendingCardEffects({ ...game, pendingAbilities: [ability] }).gameState;
}

function confirmDirect(started: GameState): GameState {
  expect(started.activeEffect?.metadata?.confirmOnlyPendingAbility).toBe(true);
  return confirmActiveEffectStep(started, PLAYER1, started.activeEffect!.id);
}

function latestPayload(game: GameState, abilityId: string): Readonly<Record<string, unknown>> {
  return (
    [...game.actionHistory]
      .reverse()
      .find(
        (action) => action.type === 'RESOLVE_ABILITY' && action.payload.abilityId === abilityId
      )?.payload ?? {}
  );
}

describe('existing shared conditional draw compatibility', () => {
  it('preserves PL!N-bp4-003-P/R 费用4「桜坂しずく」 exact action payload', () => {
    const scenario = setupBp4001({ sourceCardCode: 'PL!N-bp4-003-P' });
    const game = {
      ...scenario.game,
      liveResolution: {
        ...scenario.game.liveResolution,
        playerScores: new Map([
          [PLAYER1, 2],
          [PLAYER2, 1],
        ]),
      },
    };
    const resolved = confirmDirect(
      startDirect(
        game,
        directPending(
          PL_N_BP4_003_LIVE_SUCCESS_HIGHER_SCORE_DRAW_ABILITY_ID,
          scenario.source.instanceId,
          TriggerCondition.ON_LIVE_SUCCESS
        )
      )
    );
    expect(latestPayload(resolved, PL_N_BP4_003_LIVE_SUCCESS_HIGHER_SCORE_DRAW_ABILITY_ID)).toEqual({
      pendingAbilityId: 'pending',
      abilityId: PL_N_BP4_003_LIVE_SUCCESS_HIGHER_SCORE_DRAW_ABILITY_ID,
      sourceCardId: scenario.source.instanceId,
      sourceSlot: SlotPosition.CENTER,
      step: 'DRAW_ONE',
      sourceOnStage: true,
      ownScore: 2,
      opponentScore: 1,
      scoreHigherThanOpponent: true,
      drawnCardIds: [scenario.draws[0]!.instanceId],
    });
  });
});

describe('PL!-bp4-001-P / PL!-bp4-001-R 费用9「高坂穂乃果」', () => {
  const abilityId = PL_BP4_001_LIVE_START_LOWER_STAGE_COST_DRAW_ONE_ABILITY_ID;

  it.each(['PL!-bp4-001-P', 'PL!-bp4-001-R']) (
    'enters and resolves through the real LIVE_START definition path for %s',
    (sourceCardCode) => {
      const scenario = setupBp4001({ sourceCardCode, ownCostDelta: -1 });
      const checked = new GameService().executeCheckTiming(scenario.game, [
        TriggerCondition.ON_LIVE_START,
      ]);
      expect(checked.success).toBe(true);
      expect(checked.gameState.activeEffect?.effectText).toContain(
        '当前双方舞台成员的有效费用合计为8对9，满足条件，实际抽1张卡。'
      );
      expect(checked.gameState.activeEffect?.effectText).not.toMatch(
        SHARED_PLAYER_VISIBLE_INTERNAL_WORDS
      );
      expect(checked.gameState.activeEffect?.stepText).not.toMatch(
        SHARED_PLAYER_VISIBLE_INTERNAL_WORDS
      );
      const resolved = confirmDirect(checked.gameState);
      expect(resolved.players[0].hand.cardIds).toEqual([scenario.draws[0]!.instanceId]);
      expect(latestPayload(resolved, abilityId)).toMatchObject({
        ownStageEffectiveCostTotal: 8,
        opponentStageEffectiveCostTotal: 9,
        conditionMet: true,
        drawnCardIds: [scenario.draws[0]!.instanceId],
      });
    }
  );

  it.each([
    { ownCostDelta: 0, label: '9 equals 9', conditionMet: false },
    { ownCostDelta: 1, label: '10 is above 9', conditionMet: false },
  ])('uses a strict comparison when $label', ({ ownCostDelta, conditionMet }) => {
    const scenario = setupBp4001({ ownCostDelta });
    const resolved = confirmDirect(
      startDirect(
        scenario.game,
        directPending(abilityId, scenario.source.instanceId, TriggerCondition.ON_LIVE_START)
      )
    );
    expect(resolved.players[0].hand.cardIds).toEqual([]);
    expect(latestPayload(resolved, abilityId)).toMatchObject({ conditionMet, drawnCardIds: [] });
  });

  it('rereads effective-cost modifiers after the confirmation opens', () => {
    const scenario = setupBp4001();
    const started = startDirect(
      scenario.game,
      directPending(abilityId, scenario.source.instanceId, TriggerCondition.ON_LIVE_START)
    );
    expect(started.activeEffect?.effectText).toContain('9对9，未满足条件');
    const changed = addLiveModifier(started, {
      kind: 'MEMBER_COST',
      playerId: PLAYER1,
      memberCardId: scenario.source.instanceId,
      countDelta: -1,
      sourceCardId: scenario.source.instanceId,
      abilityId: 'late-effective-cost-change',
    });
    const resolved = confirmDirect(changed);
    expect(resolved.players[0].hand.cardIds).toEqual([scenario.draws[0]!.instanceId]);
    expect(latestPayload(resolved, abilityId)).toMatchObject({
      ownStageEffectiveCostTotal: 8,
      opponentStageEffectiveCostTotal: 9,
      conditionMet: true,
    });
  });

  it('counts WAITING stage members and excludes memberBelow from the total', () => {
    const waiting = setupBp4001({
      ownCostDelta: -1,
      opponentCosts: [4, 5],
      opponentWaitingIndexes: [1],
    });
    const waitingResolved = confirmDirect(
      startDirect(
        waiting.game,
        directPending(abilityId, waiting.source.instanceId, TriggerCondition.ON_LIVE_START)
      )
    );
    expect(latestPayload(waitingResolved, abilityId)).toMatchObject({
      ownStageEffectiveCostTotal: 8,
      opponentStageEffectiveCostTotal: 9,
      conditionMet: true,
    });

    const below = setupBp4001({ opponentCosts: [8], memberBelowCost: 20 });
    const belowResolved = confirmDirect(
      startDirect(
        below.game,
        directPending(abilityId, below.source.instanceId, TriggerCondition.ON_LIVE_START)
      )
    );
    expect(latestPayload(belowResolved, abilityId)).toMatchObject({
      ownStageEffectiveCostTotal: 9,
      opponentStageEffectiveCostTotal: 8,
      conditionMet: false,
    });
  });

  it('rereads stage membership before confirmation', () => {
    const scenario = setupBp4001({ ownCostDelta: -1 });
    const started = startDirect(
      scenario.game,
      directPending(abilityId, scenario.source.instanceId, TriggerCondition.ON_LIVE_START)
    );
    const changed = updatePlayer(started, PLAYER2, (player) => ({
      ...player,
      memberSlots: {
        ...player.memberSlots,
        slots: { ...player.memberSlots.slots, [SlotPosition.CENTER]: null },
      },
    }));
    const resolved = confirmDirect(changed);
    expect(resolved.players[0].hand.cardIds).toEqual([]);
    expect(latestPayload(resolved, abilityId)).toMatchObject({
      ownStageEffectiveCostTotal: 8,
      opponentStageEffectiveCostTotal: 0,
      conditionMet: false,
    });
  });

  it.each([
    { sourceOnStage: false, sourceCardCode: 'PL!-bp4-001-P' },
    { sourceOnStage: true, sourceCardCode: 'PL!-bp4-002-P' },
  ])('safely no-ops for an invalid source %#', ({ sourceOnStage, sourceCardCode }) => {
    const scenario = setupBp4001({ sourceCardCode, ownCostDelta: -1 });
    const game = sourceOnStage
      ? scenario.game
      : updatePlayer(scenario.game, PLAYER1, (player) => ({
          ...player,
          memberSlots: {
            ...player.memberSlots,
            slots: { ...player.memberSlots.slots, [SlotPosition.CENTER]: null },
          },
        }));
    const resolved = confirmDirect(
      startDirect(game, directPending(abilityId, scenario.source.instanceId, TriggerCondition.ON_LIVE_START))
    );
    expect(resolved.players[0].hand.cardIds).toEqual([]);
    expect(resolved.pendingAbilities).toEqual([]);
  });

  it('reports an actual draw count of zero for an empty deck', () => {
    const scenario = setupBp4001({ ownCostDelta: -1, deckCount: 0 });
    const started = startDirect(
      scenario.game,
      directPending(abilityId, scenario.source.instanceId, TriggerCondition.ON_LIVE_START)
    );
    expect(started.activeEffect?.effectText).toContain('满足条件，实际抽0张卡');
    const resolved = confirmDirect(started);
    expect(latestPayload(resolved, abilityId)).toMatchObject({ conditionMet: true, drawnCardIds: [] });
  });

  it('supports manual point selection and ordered batches', () => {
    const manual = setupBp4001({ ownCostDelta: -1, deckCount: 2 });
    const first = directPending(abilityId, manual.source.instanceId, TriggerCondition.ON_LIVE_START, 'first');
    const second = directPending(abilityId, manual.source.instanceId, TriggerCondition.ON_LIVE_START, 'second');
    const chooser = resolvePendingCardEffects({ ...manual.game, pendingAbilities: [first, second] }).gameState;
    const manuallyStarted = confirmActiveEffectStep(
      chooser,
      PLAYER1,
      chooser.activeEffect!.id,
      null,
      null,
      false,
      first.id
    );
    expect(manuallyStarted.activeEffect?.metadata?.confirmOnlyPendingAbility).toBe(true);
    expect(manuallyStarted.players[0].hand.cardIds).toEqual([]);
    const manualResolved = confirmDirect(manuallyStarted);
    expect(manualResolved.players[0].hand.cardIds).toEqual([manual.draws[0]!.instanceId]);

    const ordered = setupBp4001({ ownCostDelta: -1, deckCount: 2 });
    let orderedState = resolvePendingCardEffects({
      ...ordered.game,
      pendingAbilities: [
        directPending(abilityId, ordered.source.instanceId, TriggerCondition.ON_LIVE_START, 'ordered-1'),
        directPending(abilityId, ordered.source.instanceId, TriggerCondition.ON_LIVE_START, 'ordered-2'),
      ],
    }).gameState;
    orderedState = confirmActiveEffectStep(
      orderedState,
      PLAYER1,
      orderedState.activeEffect!.id,
      null,
      null,
      true
    );
    expect(orderedState.activeEffect).toBeNull();
    expect(orderedState.pendingAbilities).toEqual([]);
    expect(orderedState.players[0].hand.cardIds).toEqual(
      ordered.draws.map((card) => card.instanceId)
    );
  });
});

describe('PL!-bp4-023-L 分数3「もぎゅっと"love"で接近中！」', () => {
  const abilityId = PL_BP4_023_LIVE_SUCCESS_PINK_REMAINING_HEART_DRAW_ONE_ABILITY_ID;

  it('enters and resolves through the real LIVE_SUCCESS definition path', () => {
    const scenario = setupBp4023({
      remainingHearts: [createHeartIcon(HeartColor.PINK, 1)],
    });
    const checked = new GameService().executeCheckTiming(scenario.game, [
      TriggerCondition.ON_LIVE_SUCCESS,
    ]);
    expect(checked.success).toBe(true);
    expect(checked.gameState.activeEffect?.effectText).toContain(
      '当前持有至少1个粉色剩余HEART，抽1张卡。'
    );
    expect(checked.gameState.activeEffect?.effectText).not.toMatch(
      SHARED_PLAYER_VISIBLE_INTERNAL_WORDS
    );
    expect(checked.gameState.activeEffect?.effectText).not.toContain('RAINBOW');
    expect(checked.gameState.activeEffect?.stepText).not.toMatch(
      SHARED_PLAYER_VISIBLE_INTERNAL_WORDS
    );
    const resolved = confirmDirect(checked.gameState);
    expect(resolved.players[0].hand.cardIds).toEqual([scenario.draws[0]!.instanceId]);
    expect(resolved.liveResolution.playerRemainingHearts.get(PLAYER1)).toEqual([
      createHeartIcon(HeartColor.PINK, 1),
    ]);
  });

  it.each([
    { label: 'zero pink', remainingHearts: [] as readonly HeartIcon[], conditionMet: false },
    {
      label: 'one pink',
      remainingHearts: [createHeartIcon(HeartColor.PINK, 1)],
      conditionMet: true,
    },
    {
      label: 'another single color',
      remainingHearts: [createHeartIcon(HeartColor.YELLOW, 2)],
      conditionMet: false,
    },
  ])('checks the exact pink boundary for $label', ({ remainingHearts, conditionMet }) => {
    const scenario = setupBp4023({ remainingHearts });
    const resolved = confirmDirect(
      startDirect(
        scenario.game,
        directPending(abilityId, scenario.source.instanceId, TriggerCondition.ON_LIVE_SUCCESS)
      )
    );
    expect(latestPayload(resolved, abilityId)).toMatchObject({ conditionMet });
    expect(resolved.players[0].hand.cardIds).toHaveLength(conditionMet ? 1 : 0);
    expect(resolved.liveResolution.playerRemainingHearts.get(PLAYER1)).toEqual(remainingHearts);
  });

  it('does not treat RAINBOW as pink without consumed pink judgment HEART', () => {
    const rainbow = [createHeartIcon(HeartColor.RAINBOW, 1)];
    const scenario = setupBp4023({
      remainingHearts: rainbow,
      liveJudgmentHearts: [
        createHeartIcon(HeartColor.YELLOW, 1),
        createHeartIcon(HeartColor.RAINBOW, 1),
      ],
    });
    const resolved = confirmDirect(
      startDirect(
        scenario.game,
        directPending(abilityId, scenario.source.instanceId, TriggerCondition.ON_LIVE_SUCCESS)
      )
    );
    expect(resolved.players[0].hand.cardIds).toEqual([]);
    expect(resolved.liveResolution.playerRemainingHearts.get(PLAYER1)).toEqual(rainbow);
    expect(latestPayload(resolved, abilityId)).toMatchObject({
      remainingPinkHeartCount: 0,
      rebalancedRemainingHeartCount: 0,
      conditionMet: false,
    });
  });

  it('previews without mutation, then legally rebalances consumed pink and does not spend it', () => {
    const scenario = setupBp4023({
      remainingHearts: [createHeartIcon(HeartColor.RAINBOW, 1)],
      liveJudgmentHearts: [
        createHeartIcon(HeartColor.PINK, 1),
        createHeartIcon(HeartColor.RAINBOW, 1),
      ],
    });
    const started = startDirect(
      scenario.game,
      directPending(abilityId, scenario.source.instanceId, TriggerCondition.ON_LIVE_SUCCESS)
    );
    expect(started.liveResolution.playerRemainingHearts.get(PLAYER1)).toEqual([
      createHeartIcon(HeartColor.RAINBOW, 1),
    ]);
    expect(started.activeEffect?.effectText).toContain(
      '当前持有至少1个粉色剩余HEART，抽1张卡。'
    );
    const resolved = confirmDirect(started);
    expect(resolved.players[0].hand.cardIds).toEqual([scenario.draws[0]!.instanceId]);
    expect(resolved.liveResolution.playerRemainingHearts.get(PLAYER1)).toEqual([
      createHeartIcon(HeartColor.PINK, 1),
    ]);
    expect(latestPayload(resolved, abilityId)).toMatchObject({
      remainingPinkHeartCount: 1,
      rebalancedRemainingHeartCount: 1,
      conditionMet: true,
    });
  });

  it('rereads remaining HEART state before confirmation', () => {
    const scenario = setupBp4023({
      remainingHearts: [createHeartIcon(HeartColor.PINK, 1)],
    });
    const started = startDirect(
      scenario.game,
      directPending(abilityId, scenario.source.instanceId, TriggerCondition.ON_LIVE_SUCCESS)
    );
    const playerRemainingHearts = new Map(started.liveResolution.playerRemainingHearts);
    playerRemainingHearts.set(PLAYER1, []);
    const changed = {
      ...started,
      liveResolution: { ...started.liveResolution, playerRemainingHearts },
    };
    const resolved = confirmDirect(changed);
    expect(resolved.players[0].hand.cardIds).toEqual([]);
    expect(latestPayload(resolved, abilityId)).toMatchObject({
      remainingPinkHeartCount: 0,
      conditionMet: false,
    });
  });

  it.each([
    { sourceCardCode: 'PL!-bp4-023-L', sourceInLiveZone: false },
    { sourceCardCode: 'PL!-bp4-024-L', sourceInLiveZone: true },
  ])('safely no-ops for an invalid LIVE source %#', ({ sourceCardCode, sourceInLiveZone }) => {
    const scenario = setupBp4023({
      sourceCardCode,
      sourceInLiveZone,
      remainingHearts: [createHeartIcon(HeartColor.PINK, 1)],
    });
    const resolved = confirmDirect(
      startDirect(
        scenario.game,
        directPending(abilityId, scenario.source.instanceId, TriggerCondition.ON_LIVE_SUCCESS)
      )
    );
    expect(resolved.players[0].hand.cardIds).toEqual([]);
    expect(resolved.pendingAbilities).toEqual([]);
  });

  it('does not leave a rebalance change when the source leaves the LIVE zone', () => {
    const rainbow = [createHeartIcon(HeartColor.RAINBOW, 1)];
    const scenario = setupBp4023({
      remainingHearts: rainbow,
      liveJudgmentHearts: [
        createHeartIcon(HeartColor.PINK, 1),
        createHeartIcon(HeartColor.RAINBOW, 1),
      ],
    });
    const started = startDirect(
      scenario.game,
      directPending(abilityId, scenario.source.instanceId, TriggerCondition.ON_LIVE_SUCCESS)
    );
    const leftLiveZone = updatePlayer(started, PLAYER1, (player) => ({
      ...player,
      liveZone: { ...player.liveZone, cardIds: [] },
    }));
    const resolved = confirmDirect(leftLiveZone);
    expect(resolved.players[0].hand.cardIds).toEqual([]);
    expect(resolved.liveResolution.playerRemainingHearts.get(PLAYER1)).toEqual(rainbow);
  });

  it('reports an actual draw count of zero for an empty deck', () => {
    const scenario = setupBp4023({
      remainingHearts: [createHeartIcon(HeartColor.PINK, 1)],
      deckCount: 0,
    });
    const started = startDirect(
      scenario.game,
      directPending(abilityId, scenario.source.instanceId, TriggerCondition.ON_LIVE_SUCCESS)
    );
    expect(started.activeEffect?.effectText).toContain(
      '当前持有至少1个粉色剩余HEART，抽0张卡。'
    );
    const resolved = confirmDirect(started);
    expect(latestPayload(resolved, abilityId)).toMatchObject({ conditionMet: true, drawnCardIds: [] });
  });

  it('supports manual point selection and ordered batches', () => {
    const manual = setupBp4023({
      remainingHearts: [createHeartIcon(HeartColor.PINK, 1)],
      deckCount: 2,
    });
    const first = directPending(abilityId, manual.source.instanceId, TriggerCondition.ON_LIVE_SUCCESS, 'first');
    const second = directPending(abilityId, manual.source.instanceId, TriggerCondition.ON_LIVE_SUCCESS, 'second');
    const chooser = resolvePendingCardEffects({ ...manual.game, pendingAbilities: [first, second] }).gameState;
    const manuallyStarted = confirmActiveEffectStep(
      chooser,
      PLAYER1,
      chooser.activeEffect!.id,
      null,
      null,
      false,
      first.id
    );
    expect(manuallyStarted.activeEffect?.metadata?.confirmOnlyPendingAbility).toBe(true);
    expect(manuallyStarted.players[0].hand.cardIds).toEqual([]);
    const manualResolved = confirmDirect(manuallyStarted);
    expect(manualResolved.players[0].hand.cardIds).toEqual([manual.draws[0]!.instanceId]);

    const ordered = setupBp4023({
      remainingHearts: [createHeartIcon(HeartColor.PINK, 1)],
      deckCount: 2,
    });
    let orderedState = resolvePendingCardEffects({
      ...ordered.game,
      pendingAbilities: [
        directPending(abilityId, ordered.source.instanceId, TriggerCondition.ON_LIVE_SUCCESS, 'ordered-1'),
        directPending(abilityId, ordered.source.instanceId, TriggerCondition.ON_LIVE_SUCCESS, 'ordered-2'),
      ],
    }).gameState;
    orderedState = confirmActiveEffectStep(
      orderedState,
      PLAYER1,
      orderedState.activeEffect!.id,
      null,
      null,
      true
    );
    expect(orderedState.activeEffect).toBeNull();
    expect(orderedState.pendingAbilities).toEqual([]);
    expect(orderedState.players[0].hand.cardIds).toEqual(
      ordered.draws.map((card) => card.instanceId)
    );
    expect(orderedState.liveResolution.playerRemainingHearts.get(PLAYER1)).toEqual([
      createHeartIcon(HeartColor.PINK, 1),
    ]);
  });
});
