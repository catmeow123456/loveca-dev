import { describe, expect, it } from 'vitest';
import {
  createCardInstance,
  createHeartIcon,
  createHeartRequirement,
  type BladeHearts,
  type LiveCardData,
  type MemberCardData,
} from '../../src/domain/entities/card';
import {
  createGameState,
  emitGameEvent,
  getPlayerById,
  registerCards,
  updatePlayer,
  type GameState,
} from '../../src/domain/entities/game';
import { createCheerEvent } from '../../src/domain/events/game-events';
import { placeCardInSlot, removeCardFromSlot } from '../../src/domain/entities/zone';
import {
  confirmActiveEffectStep,
  enqueueTriggeredCardEffects,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import {
  PL_PB2_004_AUTO_ON_CHEER_MUSE_SCORE_ADDITIONAL_CHEER_ABILITY_ID,
  PL_PB2_004_CONTINUOUS_SUCCESS_MUSE_SCORE_GAIN_BLADE_ABILITY_ID,
} from '../../src/application/card-effects/ability-ids';
import {
  CardAbilityCategory,
  CardAbilitySourceZone,
} from '../../src/application/card-effects/ability-definition-types';
import { getCardAbilityDefinitionsForCardCode } from '../../src/application/card-effects/definitions/lookup';
import { getMemberEffectiveBladeCount } from '../../src/domain/rules/live-modifiers';
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
const CONTINUOUS_TEXT =
  '【常时】存在于自己的成功LIVE卡区的持有[スコア]的『μ’s』的卡片每有1张，获得[ブレード]。';
const ON_CHEER_TEXT =
  '【自动】【1回合1次】自己声援时，因声援被公开的自己的卡片中持有[スコア]的『μ’s』的卡片每有1张，追加声援1张卡片。';

function createUmi(cardCode = 'PL!-pb2-004-PP'): MemberCardData {
  return {
    cardCode,
    name: '园田海未',
    groupNames: ["μ's"],
    cardType: CardType.MEMBER,
    cost: 15,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.BLUE, 1)],
  };
}

function createMember(
  cardCode: string,
  groupNames: readonly string[] = ["μ's"],
  bladeHearts?: BladeHearts
): MemberCardData {
  return {
    cardCode,
    name: cardCode,
    groupNames,
    cardType: CardType.MEMBER,
    cost: 2,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.PINK, 1)],
    bladeHearts,
  };
}

function createLive(
  cardCode: string,
  groupNames: readonly string[] = ["μ's"],
  bladeHearts?: BladeHearts
): LiveCardData {
  return {
    cardCode,
    name: cardCode,
    groupNames,
    cardType: CardType.LIVE,
    score: 3,
    requirements: createHeartRequirement({ [HeartColor.PINK]: 1 }),
    bladeHearts,
  };
}

function createScoreBladeHearts(): BladeHearts {
  return [{ effect: BladeHeartEffect.SCORE }];
}

function setupAuto(
  options: {
    readonly sourceCount?: number;
    readonly matchingCount?: number;
    readonly deckCount?: number;
  } = {}
): {
  readonly game: GameState;
  readonly sourceIds: readonly string[];
  readonly matchingCardIds: readonly string[];
  readonly deckCardIds: readonly string[];
} {
  const sourceCount = options.sourceCount ?? 1;
  const matchingCount = options.matchingCount ?? 2;
  const deckCount = options.deckCount ?? 4;
  const sources = Array.from({ length: sourceCount }, (_, index) =>
    createCardInstance(createUmi(), PLAYER1, `umi-source-${index}`)
  );
  const matchingCards = Array.from({ length: matchingCount }, (_, index) =>
    createCardInstance(
      index % 2 === 0
        ? createMember(`PL!-score-muse-member-${index}`, ["μ's"], createScoreBladeHearts())
        : createLive(`PL!-score-muse-live-${index}`, ["μ's"], createScoreBladeHearts()),
      PLAYER1,
      `matching-${index}`
    )
  );
  const nonMatchingCards = [
    createCardInstance(createLive('PL!-no-score-muse-live'), PLAYER1, 'no-score'),
    createCardInstance(
      createLive('PL!S-score-aqours-live', ['Aqours'], createScoreBladeHearts()),
      PLAYER1,
      'non-muse-score'
    ),
    createCardInstance(
      createLive('PL!-opponent-score-muse-live', ["μ's"], createScoreBladeHearts()),
      PLAYER2,
      'opponent-owned-score'
    ),
  ];
  const deckCards = Array.from({ length: deckCount }, (_, index) =>
    createCardInstance(createMember(`PL!-deck-${index}`), PLAYER1, `deck-${index}`)
  );

  let game = createGameState('pl-pb2-004-umi', PLAYER1, 'P1', PLAYER2, 'P2');
  game = registerCards(game, [...sources, ...matchingCards, ...nonMatchingCards, ...deckCards]);
  game = updatePlayer(game, PLAYER1, (player) => {
    let memberSlots = player.memberSlots;
    sources.forEach((source, index) => {
      memberSlots = placeCardInSlot(
        memberSlots,
        index === 0 ? SlotPosition.CENTER : SlotPosition.LEFT,
        source.instanceId,
        { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }
      );
    });
    return {
      ...player,
      memberSlots,
      mainDeck: { ...player.mainDeck, cardIds: deckCards.map((card) => card.instanceId) },
    };
  });
  game = {
    ...game,
    liveResolution: {
      ...game.liveResolution,
      isInLive: true,
      performingPlayerId: PLAYER1,
    },
  };

  return {
    game,
    sourceIds: sources.map((source) => source.instanceId),
    matchingCardIds: matchingCards.map((card) => card.instanceId),
    deckCardIds: deckCards.map((card) => card.instanceId),
  };
}

function enqueueCheer(
  game: GameState,
  playerId: string,
  revealedCardIds: readonly string[],
  options: { readonly additional?: boolean } = {}
): GameState {
  const event = createCheerEvent(playerId, revealedCardIds, revealedCardIds.length, {
    automated: true,
    additional: options.additional,
  });
  return enqueueTriggeredCardEffects(emitGameEvent(game, event), [TriggerCondition.ON_CHEER], {
    cheerEvents: [event],
  });
}

function abilityUseCount(game: GameState): number {
  return game.actionHistory.filter(
    (action) =>
      action.type === 'RESOLVE_ABILITY' &&
      action.payload.abilityId ===
        PL_PB2_004_AUTO_ON_CHEER_MUSE_SCORE_ADDITIONAL_CHEER_ABILITY_ID &&
      action.payload.step === 'ABILITY_USE'
  ).length;
}

function additionalCheerActions(game: GameState) {
  return game.actionHistory.filter(
    (action) => action.type === 'CHEER' && action.payload.additional === true
  );
}

describe('PL!-pb2-004 Umi', () => {
  it('registers both independent base-code definitions with exact player text', () => {
    for (const cardCode of ['PL!-pb2-004-PP', 'PL!-pb2-004-R']) {
      const definitions = getCardAbilityDefinitionsForCardCode(cardCode);
      expect(definitions).toHaveLength(2);
      expect(definitions).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            abilityId: PL_PB2_004_CONTINUOUS_SUCCESS_MUSE_SCORE_GAIN_BLADE_ABILITY_ID,
            baseCardCodes: ['PL!-pb2-004'],
            category: CardAbilityCategory.CONTINUOUS,
            sourceZone: CardAbilitySourceZone.STAGE_MEMBER,
            queued: false,
            implemented: true,
            effectText: CONTINUOUS_TEXT,
          }),
          expect.objectContaining({
            abilityId: PL_PB2_004_AUTO_ON_CHEER_MUSE_SCORE_ADDITIONAL_CHEER_ABILITY_ID,
            baseCardCodes: ['PL!-pb2-004'],
            category: CardAbilityCategory.AUTO,
            sourceZone: CardAbilitySourceZone.STAGE_MEMBER,
            triggerCondition: TriggerCondition.ON_CHEER,
            queued: true,
            implemented: true,
            perTurnLimit: 1,
            effectText: ON_CHEER_TEXT,
          }),
        ])
      );
    }
  });

  it("dynamically grants one BLADE per own successful μ's SCORE card and stops off stage", () => {
    const source = createCardInstance(createUmi(), PLAYER1, 'continuous-umi');
    const scoreMuseLive = createCardInstance(
      createLive('PL!-success-score-live', ["μ's"], createScoreBladeHearts()),
      PLAYER1,
      'success-score-live'
    );
    const scoreMuseMember = createCardInstance(
      createMember('PL!-success-score-member', ["μ's"], createScoreBladeHearts()),
      PLAYER1,
      'success-score-member'
    );
    const noScoreMuse = createCardInstance(
      createLive('PL!-success-no-score-live'),
      PLAYER1,
      'success-no-score'
    );
    const scoreAqours = createCardInstance(
      createLive('PL!S-success-score-live', ['Aqours'], createScoreBladeHearts()),
      PLAYER1,
      'success-aqours-score'
    );
    let game = registerCards(
      createGameState('pl-pb2-004-continuous', PLAYER1, 'P1', PLAYER2, 'P2'),
      [source, scoreMuseLive, scoreMuseMember, noScoreMuse, scoreAqours]
    );
    game = updatePlayer(game, PLAYER1, (player) => ({
      ...player,
      memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, source.instanceId, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      }),
      successZone: {
        ...player.successZone,
        cardIds: [
          scoreMuseLive.instanceId,
          scoreMuseMember.instanceId,
          noScoreMuse.instanceId,
          scoreAqours.instanceId,
        ],
      },
    }));

    expect(getMemberEffectiveBladeCount(game, PLAYER1, source.instanceId)).toBe(3);

    const oneRemoved = updatePlayer(game, PLAYER1, (player) => ({
      ...player,
      successZone: {
        ...player.successZone,
        cardIds: player.successZone.cardIds.filter(
          (cardId) => cardId !== scoreMuseMember.instanceId
        ),
      },
    }));
    expect(getMemberEffectiveBladeCount(oneRemoved, PLAYER1, source.instanceId)).toBe(2);

    const sourceGone = updatePlayer(oneRemoved, PLAYER1, (player) => ({
      ...player,
      memberSlots: removeCardFromSlot(player.memberSlots, SlotPosition.CENTER),
      waitingRoom: {
        ...player.waitingRoom,
        cardIds: [...player.waitingRoom.cardIds, source.instanceId],
      },
    }));
    expect(getMemberEffectiveBladeCount(sourceGone, PLAYER1, source.instanceId)).toBe(1);
  });

  it('shows a dynamic single-pending confirmation, then adds event-inclusive matching count', () => {
    const scenario = setupAuto({ matchingCount: 2, deckCount: 3 });
    const queued = enqueueCheer(scenario.game, PLAYER1, [
      ...scenario.matchingCardIds,
      'no-score',
      'non-muse-score',
      'opponent-owned-score',
    ]);
    let state = resolvePendingCardEffects(queued).gameState;

    expect(state.activeEffect).toMatchObject({
      abilityId: PL_PB2_004_AUTO_ON_CHEER_MUSE_SCORE_ADDITIONAL_CHEER_ABILITY_ID,
      effectText: `${ON_CHEER_TEXT}\n\n（本次普通声援公开了2张符合条件的卡片，因此追加声援2张。）`,
      stepText: '确认后追加声援2张。',
    });
    expect(state.pendingAbilities).toHaveLength(1);
    expect(abilityUseCount(state)).toBe(0);
    expect(additionalCheerActions(state)).toHaveLength(0);

    state = confirmActiveEffectStep(state, PLAYER1, state.activeEffect!.id);

    expect(state.activeEffect).toBeNull();
    expect(state.pendingAbilities).toEqual([]);
    expect(abilityUseCount(state)).toBe(1);
    expect(additionalCheerActions(state)).toHaveLength(1);
    expect(additionalCheerActions(state)[0]?.payload).toMatchObject({
      cheerCount: 2,
      cheerCardIds: scenario.deckCardIds.slice(0, 2),
      additional: true,
    });
  });

  it('counts moved event cards, records a zero-match use, and blocks the second cheer', () => {
    const eventInclusive = setupAuto({ matchingCount: 1, deckCount: 1 });
    let eventState = resolvePendingCardEffects(
      enqueueCheer(eventInclusive.game, PLAYER1, eventInclusive.matchingCardIds)
    ).gameState;
    expect(eventState.resolutionZone.cardIds).not.toContain(eventInclusive.matchingCardIds[0]);
    eventState = confirmActiveEffectStep(eventState, PLAYER1, eventState.activeEffect!.id);
    expect(additionalCheerActions(eventState)[0]?.payload.cheerCardIds).toEqual(
      eventInclusive.deckCardIds
    );

    const zeroMatch = setupAuto({ matchingCount: 0, deckCount: 2 });
    let state = resolvePendingCardEffects(
      enqueueCheer(zeroMatch.game, PLAYER1, ['no-score', 'non-muse-score'])
    ).gameState;
    expect(state.activeEffect?.effectText).toBe(
      `${ON_CHEER_TEXT}\n\n（本次普通声援公开的卡片中没有符合条件的卡片，因此不追加声援。）`
    );
    state = confirmActiveEffectStep(state, PLAYER1, state.activeEffect!.id);
    expect(abilityUseCount(state)).toBe(1);
    expect(additionalCheerActions(state)).toHaveLength(0);

    const queuedAgain = enqueueCheer(state, PLAYER1, ['no-score']);
    expect(queuedAgain.pendingAbilities).toEqual([]);
  });

  it('ignores opponent/additional cheer and safely consumes a stale source without turn use', () => {
    const scenario = setupAuto({ matchingCount: 1 });
    expect(enqueueCheer(scenario.game, PLAYER2, scenario.matchingCardIds).pendingAbilities).toEqual(
      []
    );
    expect(
      enqueueCheer(scenario.game, PLAYER1, scenario.matchingCardIds, { additional: true })
        .pendingAbilities
    ).toEqual([]);

    const queued = enqueueCheer(scenario.game, PLAYER1, scenario.matchingCardIds);
    const sourceGone = updatePlayer(queued, PLAYER1, (player) => ({
      ...player,
      memberSlots: removeCardFromSlot(player.memberSlots, SlotPosition.CENTER),
      waitingRoom: {
        ...player.waitingRoom,
        cardIds: [...player.waitingRoom.cardIds, scenario.sourceIds[0]!],
      },
    }));
    const state = resolvePendingCardEffects(sourceGone).gameState;
    expect(state.activeEffect).toBeNull();
    expect(state.pendingAbilities).toEqual([]);
    expect(abilityUseCount(state)).toBe(0);
    expect(additionalCheerActions(state)).toHaveLength(0);

    const confirmScenario = setupAuto({ matchingCount: 1 });
    let confirming = resolvePendingCardEffects(
      enqueueCheer(confirmScenario.game, PLAYER1, confirmScenario.matchingCardIds)
    ).gameState;
    confirming = updatePlayer(confirming, PLAYER1, (player) => ({
      ...player,
      memberSlots: removeCardFromSlot(player.memberSlots, SlotPosition.CENTER),
      waitingRoom: {
        ...player.waitingRoom,
        cardIds: [...player.waitingRoom.cardIds, confirmScenario.sourceIds[0]!],
      },
    }));
    const staleAtConfirm = confirmActiveEffectStep(
      confirming,
      PLAYER1,
      confirming.activeEffect!.id
    );
    expect(staleAtConfirm.activeEffect).toBeNull();
    expect(staleAtConfirm.pendingAbilities).toEqual([]);
    expect(abilityUseCount(staleAtConfirm)).toBe(0);
    expect(additionalCheerActions(staleAtConfirm)).toHaveLength(0);
  });

  it('resolves an ordered batch without per-item confirms and manual choice with one bridge', () => {
    const orderedScenario = setupAuto({ sourceCount: 2, matchingCount: 1, deckCount: 3 });
    let ordered = resolvePendingCardEffects(
      enqueueCheer(orderedScenario.game, PLAYER1, orderedScenario.matchingCardIds)
    ).gameState;
    expect(ordered.activeEffect?.canResolveInOrder).toBe(true);
    ordered = confirmActiveEffectStep(ordered, PLAYER1, ordered.activeEffect!.id, null, null, true);
    expect(ordered.activeEffect).toBeNull();
    expect(ordered.pendingAbilities).toEqual([]);
    expect(abilityUseCount(ordered)).toBe(2);
    expect(additionalCheerActions(ordered)).toHaveLength(2);

    const manualScenario = setupAuto({ sourceCount: 2, matchingCount: 1, deckCount: 3 });
    let manual = resolvePendingCardEffects(
      enqueueCheer(manualScenario.game, PLAYER1, manualScenario.matchingCardIds)
    ).gameState;
    manual = confirmActiveEffectStep(
      manual,
      PLAYER1,
      manual.activeEffect!.id,
      manualScenario.sourceIds[0]!
    );
    expect(manual.activeEffect).toMatchObject({
      abilityId: PL_PB2_004_AUTO_ON_CHEER_MUSE_SCORE_ADDITIONAL_CHEER_ABILITY_ID,
      sourceCardId: manualScenario.sourceIds[0],
      metadata: expect.objectContaining({ orderedResolution: false }),
    });
    expect(abilityUseCount(manual)).toBe(0);
    manual = confirmActiveEffectStep(manual, PLAYER1, manual.activeEffect!.id);
    expect(abilityUseCount(manual)).toBe(1);
    expect(additionalCheerActions(manual)).toHaveLength(1);
    expect(manual.activeEffect).toMatchObject({
      abilityId: PL_PB2_004_AUTO_ON_CHEER_MUSE_SCORE_ADDITIONAL_CHEER_ABILITY_ID,
      sourceCardId: manualScenario.sourceIds[1],
    });
  });

  it('reports requested and actual additional cards when the deck is short', () => {
    const scenario = setupAuto({ matchingCount: 3, deckCount: 1 });
    let state = resolvePendingCardEffects(
      enqueueCheer(scenario.game, PLAYER1, scenario.matchingCardIds)
    ).gameState;
    state = confirmActiveEffectStep(state, PLAYER1, state.activeEffect!.id);

    expect(additionalCheerActions(state)[0]?.payload).toMatchObject({
      cheerCount: 3,
      cheerCardIds: scenario.deckCardIds,
      additional: true,
    });
    expect(
      state.actionHistory.find(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId ===
            PL_PB2_004_AUTO_ON_CHEER_MUSE_SCORE_ADDITIONAL_CHEER_ABILITY_ID &&
          action.payload.step === 'COUNT_MUSE_SCORE_CARDS_AND_ADDITIONAL_CHEER'
      )?.payload
    ).toMatchObject({
      requestedAdditionalCheerCount: 3,
      additionalCheerCardIds: scenario.deckCardIds,
      actualAdditionalCheerCount: 1,
    });
    expect(getPlayerById(state, PLAYER1)?.mainDeck.cardIds).toEqual([]);
  });
});
