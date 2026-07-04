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
import { createCheerEvent } from '../../src/domain/events/game-events';
import { placeCardInSlot, removeCardFromSlot } from '../../src/domain/entities/zone';
import {
  enqueueTriggeredCardEffects,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import { SP_PR_024_AUTO_ON_CHEER_SCORE_LIELLA_LIVE_GAIN_PURPLE_HEART_ABILITY_ID } from '../../src/application/card-effects/ability-ids';
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

function createSumire(): MemberCardData {
  return {
    cardCode: 'PL!SP-PR-024-PR',
    name: '平安名すみれ',
    groupNames: ['Liella!'],
    cardType: CardType.MEMBER,
    cost: 4,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.PURPLE, 1)],
  };
}

function createMember(cardCode: string, groupNames: readonly string[] = ['Liella!']): MemberCardData {
  return {
    cardCode,
    name: cardCode,
    groupNames,
    cardType: CardType.MEMBER,
    cost: 2,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.YELLOW, 1)],
  };
}

function createLive(
  cardCode: string,
  options: {
    readonly groupNames?: readonly string[];
    readonly bladeHearts?: BladeHearts;
  } = {}
): LiveCardData {
  return {
    cardCode,
    name: cardCode,
    groupNames: options.groupNames ?? ['Liella!'],
    cardType: CardType.LIVE,
    score: 3,
    requirements: createHeartRequirement({ [HeartColor.YELLOW]: 1 }),
    bladeHearts: options.bladeHearts,
  };
}

function setupState(revealedCards: readonly ReturnType<typeof createCardInstance>[]): {
  readonly game: GameState;
  readonly sourceId: string;
} {
  const source = createCardInstance(createSumire(), PLAYER1, 'sp-pr-024-source');
  let game = createGameState('sp-pr-024-sumire', PLAYER1, 'P1', PLAYER2, 'P2');
  game = registerCards(game, [source, ...revealedCards]);
  game = updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, source.instanceId, {
      orientation: OrientationState.ACTIVE,
      face: FaceState.FACE_UP,
    }),
  }));
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
  return enqueueTriggeredCardEffects(emitGameEvent(game, event), [TriggerCondition.ON_CHEER], {
    cheerEvents: [event],
  });
}

function resolveCheer(
  game: GameState,
  playerId: string,
  revealedCardIds: readonly string[],
  options: { readonly additional?: boolean } = {}
): GameState {
  return resolvePendingCardEffects(enqueueCheer(game, playerId, revealedCardIds, options)).gameState;
}

function purpleHeartModifierCount(game: GameState): number {
  return game.liveResolution.liveModifiers.filter(
    (modifier) =>
      modifier.kind === 'HEART' &&
      modifier.abilityId === SP_PR_024_AUTO_ON_CHEER_SCORE_LIELLA_LIVE_GAIN_PURPLE_HEART_ABILITY_ID &&
      modifier.target === 'SOURCE_MEMBER' &&
      modifier.hearts.some((heart) => heart.color === HeartColor.PURPLE && heart.count === 1)
  ).length;
}

function abilityUseCount(game: GameState): number {
  return game.actionHistory.filter(
    (action) =>
      action.type === 'RESOLVE_ABILITY' &&
      action.payload.abilityId ===
        SP_PR_024_AUTO_ON_CHEER_SCORE_LIELLA_LIVE_GAIN_PURPLE_HEART_ABILITY_ID &&
      action.payload.step === 'ABILITY_USE'
  ).length;
}

describe('PL!SP-PR-024 Sumire on-cheer purple Heart workflow', () => {
  it('gains purple Heart when own normal cheer reveals a score Liella! LIVE', () => {
    const scoreLive = createCardInstance(
      createLive('PL!SP-score-liella-live', { bladeHearts: [{ effect: BladeHeartEffect.SCORE }] }),
      PLAYER1,
      'score-liella-live'
    );
    const { game } = setupState([scoreLive]);

    const state = resolveCheer(game, PLAYER1, [scoreLive.instanceId]);

    expect(purpleHeartModifierCount(state)).toBe(1);
    expect(abilityUseCount(state)).toBe(1);
    expect(state.pendingAbilities).toEqual([]);
  });

  it.each([
    {
      name: 'no SCORE icon',
      card: createCardInstance(createLive('PL!SP-no-score-live'), PLAYER1, 'no-score-live'),
    },
    {
      name: 'non Liella! LIVE',
      card: createCardInstance(
        createLive('PL!N-score-live', {
          groupNames: ['虹ヶ咲'],
          bladeHearts: [{ effect: BladeHeartEffect.SCORE }],
        }),
        PLAYER1,
        'non-liella-score-live'
      ),
    },
    {
      name: 'non LIVE',
      card: createCardInstance(createMember('PL!SP-score-member'), PLAYER1, 'score-member'),
    },
  ])('does not gain Heart for $name on own normal cheer', ({ card }) => {
    const { game } = setupState([card]);

    const state = resolveCheer(game, PLAYER1, [card.instanceId]);

    expect(purpleHeartModifierCount(state)).toBe(0);
    expect(abilityUseCount(state)).toBe(1);
    expect(state.pendingAbilities).toEqual([]);
  });

  it('ignores opponent cheer and additional cheer without recording turn use', () => {
    const scoreLive = createCardInstance(
      createLive('PL!SP-score-liella-live', { bladeHearts: [{ effect: BladeHeartEffect.SCORE }] }),
      PLAYER1,
      'score-liella-live'
    );
    const { game } = setupState([scoreLive]);

    const opponentCheer = resolveCheer(game, PLAYER2, [scoreLive.instanceId]);
    const additionalCheer = resolveCheer(game, PLAYER1, [scoreLive.instanceId], {
      additional: true,
    });

    expect(purpleHeartModifierCount(opponentCheer)).toBe(0);
    expect(abilityUseCount(opponentCheer)).toBe(0);
    expect(purpleHeartModifierCount(additionalCheer)).toBe(0);
    expect(abilityUseCount(additionalCheer)).toBe(0);
  });

  it('safely consumes pending without turn use when the source leaves stage', () => {
    const scoreLive = createCardInstance(
      createLive('PL!SP-score-liella-live', { bladeHearts: [{ effect: BladeHeartEffect.SCORE }] }),
      PLAYER1,
      'score-liella-live'
    );
    const { game, sourceId } = setupState([scoreLive]);
    const queued = enqueueCheer(game, PLAYER1, [scoreLive.instanceId]);
    const sourceGone = updatePlayer(queued, PLAYER1, (player) => ({
      ...player,
      memberSlots: removeCardFromSlot(player.memberSlots, SlotPosition.CENTER),
      waitingRoom: {
        ...player.waitingRoom,
        cardIds: [...player.waitingRoom.cardIds, sourceId],
      },
    }));

    const state = resolvePendingCardEffects(sourceGone).gameState;

    expect(purpleHeartModifierCount(state)).toBe(0);
    expect(abilityUseCount(state)).toBe(0);
    expect(state.pendingAbilities).toEqual([]);
  });

  it('records turn use once and blocks later cheers in the same turn', () => {
    const scoreLive = createCardInstance(
      createLive('PL!SP-score-liella-live', { bladeHearts: [{ effect: BladeHeartEffect.SCORE }] }),
      PLAYER1,
      'score-liella-live'
    );
    const { game } = setupState([scoreLive]);

    const first = resolveCheer(game, PLAYER1, [scoreLive.instanceId]);
    const secondQueued = enqueueCheer(first, PLAYER1, [scoreLive.instanceId]);

    expect(purpleHeartModifierCount(first)).toBe(1);
    expect(abilityUseCount(first)).toBe(1);
    expect(secondQueued.pendingAbilities).toEqual([]);
  });
});
