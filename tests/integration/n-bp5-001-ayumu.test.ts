import { describe, expect, it } from 'vitest';
import type { BladeHearts, LiveCardData, MemberCardData } from '../../src/domain/entities/card';
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
} from '../../src/domain/entities/game';
import { addCardToZone, placeCardInSlot } from '../../src/domain/entities/zone';
import { createCheerEvent } from '../../src/domain/events/game-events';
import {
  enqueueTriggeredCardEffects,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import { N_BP5_001_AUTO_ON_CHEER_BLADE_HEART_TYPES_GAIN_PINK_HEART_SCORE_ABILITY_ID } from '../../src/application/card-effects/ability-ids';
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

function createMember(
  cardCode: string,
  bladeHearts: BladeHearts = [],
  ownerGroup = 'A・ZU・NA'
): MemberCardData {
  return {
    cardCode,
    name: cardCode,
    groupNames: [ownerGroup],
    cardType: CardType.MEMBER,
    cost: 5,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.PINK, 2)],
    bladeHearts,
  };
}

function createLive(cardCode: string, bladeHearts: BladeHearts = []): LiveCardData {
  return {
    cardCode,
    name: cardCode,
    groupNames: ['虹ヶ咲'],
    cardType: CardType.LIVE,
    score: 2,
    requirements: createHeartRequirement({ [HeartColor.GREEN]: 2, [HeartColor.BLUE]: 1 }),
    bladeHearts,
  };
}

function bladeHeart(color: HeartColor) {
  return { effect: BladeHeartEffect.HEART, heartColor: color } as const;
}

function setupAyumu(cards: readonly ReturnType<typeof createCardInstance>[]): {
  readonly game: GameState;
  readonly sourceId: string;
} {
  const source = createCardInstance(
    createMember('PL!N-bp5-001-P'),
    PLAYER1,
    'n-bp5-001-ayumu-source'
  );
  let game = createGameState('n-bp5-001-ayumu', PLAYER1, 'P1', PLAYER2, 'P2');
  game = registerCards(game, [source, ...cards]);
  game = updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, source.instanceId, {
      orientation: OrientationState.ACTIVE,
      face: FaceState.FACE_UP,
    }),
  }));
  game = {
    ...game,
    liveResolution: {
      ...game.liveResolution,
      isInLive: true,
      performingPlayerId: PLAYER1,
      playerScores: new Map([[PLAYER1, 5]]),
    },
  };
  return { game, sourceId: source.instanceId };
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
  const firstPlayerId = game.players[game.firstPlayerIndex]?.id ?? null;
  const withCurrentCheerIds: GameState = {
    ...game,
    liveResolution: {
      ...game.liveResolution,
      firstPlayerCheerCardIds:
        playerId === firstPlayerId
          ? [...game.liveResolution.firstPlayerCheerCardIds, ...revealedCardIds]
          : game.liveResolution.firstPlayerCheerCardIds,
      secondPlayerCheerCardIds:
        playerId === firstPlayerId
          ? game.liveResolution.secondPlayerCheerCardIds
          : [...game.liveResolution.secondPlayerCheerCardIds, ...revealedCardIds],
    },
  };
  return enqueueTriggeredCardEffects(emitGameEvent(withCurrentCheerIds, event), [TriggerCondition.ON_CHEER], {
    cheerEvents: [event],
  });
}

function resolveOwnCheer(game: GameState, revealedCardIds: readonly string[]): GameState {
  return resolvePendingCardEffects(enqueueCheer(game, PLAYER1, revealedCardIds)).gameState;
}

function abilityUseCount(game: GameState): number {
  return game.actionHistory.filter(
    (action) =>
      action.type === 'RESOLVE_ABILITY' &&
      action.payload.abilityId ===
        N_BP5_001_AUTO_ON_CHEER_BLADE_HEART_TYPES_GAIN_PINK_HEART_SCORE_ABILITY_ID &&
      action.payload.step === 'ABILITY_USE'
  ).length;
}

function getAyumuResolveAction(game: GameState) {
  return game.actionHistory.find(
    (action) =>
      action.type === 'RESOLVE_ABILITY' &&
      action.payload.abilityId ===
        N_BP5_001_AUTO_ON_CHEER_BLADE_HEART_TYPES_GAIN_PINK_HEART_SCORE_ABILITY_ID &&
      action.payload.step === 'COUNT_CHEER_BLADE_HEART_TYPES'
  );
}

describe('PL!N-bp5-001 Ayumu on-cheer blade heart type count', () => {
  it('gains PINK Heart without score when current cheer reveals three blade heart colors', () => {
    const revealed = createCardInstance(
      createMember('PL!N-test-three-colors', [
        bladeHeart(HeartColor.PINK),
        bladeHeart(HeartColor.RED),
        bladeHeart(HeartColor.YELLOW),
      ]),
      PLAYER1,
      'three-colors'
    );
    const { game, sourceId } = setupAyumu([revealed]);

    const state = resolveOwnCheer(game, [revealed.instanceId]);

    expect(state.liveResolution.liveModifiers).toContainEqual({
      kind: 'HEART',
      playerId: PLAYER1,
      hearts: [{ color: HeartColor.PINK, count: 1 }],
      sourceCardId: sourceId,
      abilityId: N_BP5_001_AUTO_ON_CHEER_BLADE_HEART_TYPES_GAIN_PINK_HEART_SCORE_ABILITY_ID,
      target: 'SOURCE_MEMBER',
    });
    expect(
      state.liveResolution.liveModifiers.some((modifier) => modifier.kind === 'SCORE')
    ).toBe(false);
    expect(state.liveResolution.playerScores.get(PLAYER1)).toBe(5);
    expect(getAyumuResolveAction(state)?.payload.bladeHeartTypeCount).toBe(3);
  });

  it('gains PINK Heart and SCORE +1 when six blade heart colors include RAINBOW', () => {
    const revealed = createCardInstance(
      createMember('PL!N-test-six-colors', [
        bladeHeart(HeartColor.PINK),
        bladeHeart(HeartColor.RED),
        bladeHeart(HeartColor.YELLOW),
        bladeHeart(HeartColor.GREEN),
        bladeHeart(HeartColor.BLUE),
        bladeHeart(HeartColor.RAINBOW),
      ]),
      PLAYER1,
      'six-colors'
    );
    const { game, sourceId } = setupAyumu([revealed]);

    const state = resolveOwnCheer(game, [revealed.instanceId]);

    expect(state.liveResolution.liveModifiers).toContainEqual({
      kind: 'HEART',
      playerId: PLAYER1,
      hearts: [{ color: HeartColor.PINK, count: 1 }],
      sourceCardId: sourceId,
      abilityId: N_BP5_001_AUTO_ON_CHEER_BLADE_HEART_TYPES_GAIN_PINK_HEART_SCORE_ABILITY_ID,
      target: 'SOURCE_MEMBER',
    });
    expect(state.liveResolution.liveModifiers).toContainEqual({
      kind: 'SCORE',
      playerId: PLAYER1,
      countDelta: 1,
      sourceCardId: sourceId,
      abilityId: N_BP5_001_AUTO_ON_CHEER_BLADE_HEART_TYPES_GAIN_PINK_HEART_SCORE_ABILITY_ID,
    });
    expect(state.liveResolution.playerScores.get(PLAYER1)).toBe(6);
    expect(getAyumuResolveAction(state)?.payload.bladeHeartTypeCount).toBe(6);
  });

  it('records turn1 use and consumes pending when there are only two blade heart colors', () => {
    const revealed = createCardInstance(
      createMember('PL!N-test-two-colors', [
        bladeHeart(HeartColor.PINK),
        bladeHeart(HeartColor.RED),
      ]),
      PLAYER1,
      'two-colors'
    );
    const { game } = setupAyumu([revealed]);

    const state = resolveOwnCheer(game, [revealed.instanceId]);

    expect(state.pendingAbilities).toEqual([]);
    expect(state.liveResolution.liveModifiers).toEqual([]);
    expect(abilityUseCount(state)).toBe(1);
    expect(getAyumuResolveAction(state)?.payload.bladeHeartTypeCount).toBe(2);

    const secondCheer = enqueueCheer(state, PLAYER1, [revealed.instanceId]);
    expect(secondCheer.pendingAbilities).toEqual([]);
    expect(abilityUseCount(secondCheer)).toBe(1);
  });

  it('counts duplicate blade heart colors only once', () => {
    const revealed = createCardInstance(
      createMember('PL!N-test-duplicate-colors', [
        bladeHeart(HeartColor.PINK),
        bladeHeart(HeartColor.PINK),
        bladeHeart(HeartColor.RED),
      ]),
      PLAYER1,
      'duplicate-colors'
    );
    const { game } = setupAyumu([revealed]);

    const state = resolveOwnCheer(game, [revealed.instanceId]);

    expect(state.liveResolution.liveModifiers).toEqual([]);
    expect(getAyumuResolveAction(state)?.payload.bladeHeartTypeCount).toBe(2);
  });

  it('does not count DRAW/SCORE blade hearts, base hearts, or LIVE requirements', () => {
    const member = createCardInstance(
      createMember('PL!N-test-draw-score-blade-heart', [
        { effect: BladeHeartEffect.DRAW },
        { effect: BladeHeartEffect.SCORE },
      ]),
      PLAYER1,
      'draw-score-member'
    );
    const live = createCardInstance(createLive('PL!N-test-requirement-live'), PLAYER1, 'req-live');
    const { game } = setupAyumu([member, live]);

    const state = resolveOwnCheer(game, [member.instanceId, live.instanceId]);

    expect(state.liveResolution.liveModifiers).toEqual([]);
    expect(getAyumuResolveAction(state)?.payload.bladeHeartTypeCount).toBe(0);
  });

  it('ignores opponent cards, old revealed zone cards, and cards outside this CheerEvent', () => {
    const ownValid = createCardInstance(
      createMember('PL!N-test-own-valid', [bladeHeart(HeartColor.PINK)]),
      PLAYER1,
      'own-valid'
    );
    const opponentValid = createCardInstance(
      createMember('PL!N-test-opponent-valid', [
        bladeHeart(HeartColor.RED),
        bladeHeart(HeartColor.YELLOW),
        bladeHeart(HeartColor.GREEN),
      ]),
      PLAYER2,
      'opponent-valid'
    );
    const oldRevealed = createCardInstance(
      createMember('PL!N-test-old-revealed', [
        bladeHeart(HeartColor.RED),
        bladeHeart(HeartColor.YELLOW),
      ]),
      PLAYER1,
      'old-revealed'
    );
    let { game } = setupAyumu([ownValid, opponentValid, oldRevealed]);
    game = {
      ...game,
      resolutionZone: {
        ...game.resolutionZone,
        cardIds: addCardToZone(game.resolutionZone, oldRevealed.instanceId).cardIds,
        revealedCardIds: [oldRevealed.instanceId],
      },
    };

    const state = resolveOwnCheer(game, [ownValid.instanceId, opponentValid.instanceId]);

    expect(state.liveResolution.liveModifiers).toEqual([]);
    expect(getAyumuResolveAction(state)?.payload.bladeHeartTypeCount).toBe(1);

    const additionalQueued = enqueueCheer(game, PLAYER1, [oldRevealed.instanceId], {
      additional: true,
    });
    expect(additionalQueued.pendingAbilities).toEqual([]);
  });
});
