import { describe, expect, it } from 'vitest';
import type { LiveCardData, MemberCardData } from '../../src/domain/entities/card';
import { createCardInstance, createHeartIcon, createHeartRequirement } from '../../src/domain/entities/card';
import { createGameState, registerCards, updatePlayer } from '../../src/domain/entities/game';
import { addCardToStatefulZone } from '../../src/domain/entities/zone';
import { GameService } from '../../src/application/game-service';
import { HS_BP1_022_LIVE_SUCCESS_CHEER_HASUNOSORA_MEMBER_SCORE_ABILITY_ID } from '../../src/application/card-effects/ability-ids';
import {
  CardType,
  GamePhase,
  HeartColor,
  SubPhase,
  TriggerCondition,
} from '../../src/shared/types/enums';

const PLAYER1 = 'player1';
const PLAYER2 = 'player2';

function createAwokeLive(): LiveCardData {
  return {
    cardCode: 'PL!HS-bp1-022-L',
    name: 'AWOKE',
    groupNames: ['蓮ノ空女学院スクールアイドルクラブ'],
    unitName: 'DOLLCHESTRA',
    cardType: CardType.LIVE,
    score: 5,
    requirements: createHeartRequirement({ [HeartColor.BLUE]: 6, [HeartColor.RAINBOW]: 6 }),
  };
}

function createOpponentLive(): LiveCardData {
  return {
    cardCode: 'PL!HS-test-opponent-live',
    name: 'Opponent Live',
    cardType: CardType.LIVE,
    score: 5,
    requirements: createHeartRequirement({ [HeartColor.PINK]: 1 }),
  };
}

function createHasunosoraMember(cardCode: string): MemberCardData {
  return {
    cardCode,
    name: cardCode,
    groupNames: ['蓮ノ空女学院スクールアイドルクラブ'],
    unitName: 'DOLLCHESTRA',
    cardType: CardType.MEMBER,
    cost: 1,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.BLUE, 1)],
  };
}

function createLiellaMember(cardCode: string): MemberCardData {
  return {
    cardCode,
    name: cardCode,
    groupNames: ['Liella!'],
    cardType: CardType.MEMBER,
    cost: 1,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.PINK, 1)],
  };
}

function createHasunosoraLive(cardCode: string): LiveCardData {
  return {
    cardCode,
    name: cardCode,
    groupNames: ['蓮ノ空女学院スクールアイドルクラブ'],
    unitName: 'DOLLCHESTRA',
    cardType: CardType.LIVE,
    score: 1,
    requirements: createHeartRequirement({ [HeartColor.BLUE]: 1 }),
  };
}

function setupAwokeLiveSuccess(options: {
  readonly cheerCards: readonly ReturnType<typeof createCardInstance>[];
  readonly resolutionCardIds?: readonly string[];
}) {
  const sourceLive = createCardInstance(createAwokeLive(), PLAYER1, 'awoke-live');
  const opponentLive = createCardInstance(createOpponentLive(), PLAYER2, 'opponent-live');

  let game = createGameState('hs-bp1-022-awoke', PLAYER1, 'P1', PLAYER2, 'P2');
  game = registerCards(game, [sourceLive, opponentLive, ...options.cheerCards]);
  game = updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    liveZone: addCardToStatefulZone(player.liveZone, sourceLive.instanceId),
  }));
  game = updatePlayer(game, PLAYER2, (player) => ({
    ...player,
    liveZone: addCardToStatefulZone(player.liveZone, opponentLive.instanceId),
  }));

  const resolutionCardIds =
    options.resolutionCardIds ?? options.cheerCards.map((card) => card.instanceId);
  game = {
    ...game,
    currentPhase: GamePhase.LIVE_RESULT_PHASE,
    currentSubPhase: SubPhase.RESULT_FIRST_SUCCESS_EFFECTS,
    firstPlayerIndex: 0,
    activePlayerIndex: 0,
    resolutionZone: {
      ...game.resolutionZone,
      cardIds: [...resolutionCardIds],
      revealedCardIds: [...resolutionCardIds],
    },
    liveResolution: {
      ...game.liveResolution,
      firstPlayerCheerCardIds: options.cheerCards.map((card) => card.instanceId),
      secondPlayerCheerCardIds: [],
      liveResults: new Map([
        [sourceLive.instanceId, true],
        [opponentLive.instanceId, true],
      ]),
      playerScores: new Map([
        [PLAYER1, 5],
        [PLAYER2, 5],
      ]),
      performingPlayerId: PLAYER1,
    },
  };

  const result = new GameService().executeCheckTiming(game, [TriggerCondition.ON_LIVE_SUCCESS]);
  expect(result.success).toBe(true);
  return { state: result.gameState, sourceLive };
}

function createCheerHasunosoraMembers(count: number): ReturnType<typeof createCardInstance>[] {
  return Array.from({ length: count }, (_, index) =>
    createCardInstance(
      createHasunosoraMember(`PL!HS-test-cheer-member-${index}`),
      PLAYER1,
      `cheer-member-${index}`
    )
  );
}

describe('PL!HS-bp1-022 AWOKE live success workflow', () => {
  it('adds this-live SCORE +1 and refreshes playerScores with ten Hasunosora member cheer cards', () => {
    const cheerCards = createCheerHasunosoraMembers(10);

    const { state, sourceLive } = setupAwokeLiveSuccess({ cheerCards });

    expect(state.pendingAbilities).toEqual([]);
    expect(state.liveResolution.liveModifiers).toContainEqual({
      kind: 'SCORE',
      playerId: PLAYER1,
      countDelta: 1,
      liveCardId: sourceLive.instanceId,
      sourceCardId: sourceLive.instanceId,
      abilityId: HS_BP1_022_LIVE_SUCCESS_CHEER_HASUNOSORA_MEMBER_SCORE_ABILITY_ID,
    });
    expect(state.liveResolution.playerScores.get(PLAYER1)).toBe(6);
    expect(
      state.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId ===
            HS_BP1_022_LIVE_SUCCESS_CHEER_HASUNOSORA_MEMBER_SCORE_ABILITY_ID &&
          action.payload.hasunosoraCheerMemberCount === 10 &&
          action.payload.conditionMet === true &&
          action.payload.scoreBonus === 1
      )
    ).toBe(true);
  });

  it('does not add SCORE with only nine Hasunosora member cheer cards', () => {
    const { state } = setupAwokeLiveSuccess({ cheerCards: createCheerHasunosoraMembers(9) });

    expect(
      state.liveResolution.liveModifiers.some(
        (modifier) =>
          modifier.kind === 'SCORE' &&
          modifier.abilityId === HS_BP1_022_LIVE_SUCCESS_CHEER_HASUNOSORA_MEMBER_SCORE_ABILITY_ID
      )
    ).toBe(false);
    expect(state.liveResolution.playerScores.get(PLAYER1)).toBe(5);
  });

  it('does not count non-member or non-Hasunosora cheer cards', () => {
    const cheerCards = [
      ...createCheerHasunosoraMembers(9),
      createCardInstance(createHasunosoraLive('PL!HS-test-cheer-live'), PLAYER1, 'cheer-live'),
      createCardInstance(createLiellaMember('PL!SP-test-cheer-member'), PLAYER1, 'liella-member'),
    ];

    const { state } = setupAwokeLiveSuccess({ cheerCards });

    expect(
      state.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId ===
            HS_BP1_022_LIVE_SUCCESS_CHEER_HASUNOSORA_MEMBER_SCORE_ABILITY_ID &&
          action.payload.hasunosoraCheerMemberCount === 9 &&
          action.payload.conditionMet === false &&
          action.payload.scoreBonus === 0
      )
    ).toBe(true);
    expect(state.liveResolution.playerScores.get(PLAYER1)).toBe(5);
  });

  it('counts cheer card ids even if those cards have already left the resolution zone', () => {
    const cheerCards = createCheerHasunosoraMembers(10);

    const { state } = setupAwokeLiveSuccess({ cheerCards, resolutionCardIds: [] });

    expect(state.liveResolution.liveModifiers).toContainEqual({
      kind: 'SCORE',
      playerId: PLAYER1,
      countDelta: 1,
      liveCardId: 'awoke-live',
      sourceCardId: 'awoke-live',
      abilityId: HS_BP1_022_LIVE_SUCCESS_CHEER_HASUNOSORA_MEMBER_SCORE_ABILITY_ID,
    });
    expect(state.liveResolution.playerScores.get(PLAYER1)).toBe(6);
  });
});
