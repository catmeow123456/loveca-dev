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
  type PendingAbilityState,
} from '../../src/domain/entities/game';
import { placeCardInSlot } from '../../src/domain/entities/zone';
import { resolvePendingCardEffects } from '../../src/application/card-effect-runner';
import { SP_PB2_008_LIVE_SUCCESS_CHEER_NO_BLADE_HEART_LIELLA_MEMBER_SCORE_ABILITY_ID } from '../../src/application/card-effects/ability-ids';
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
  options: {
    readonly groupNames?: readonly string[];
    readonly bladeHeart?: boolean;
  } = {}
): MemberCardData {
  return {
    cardCode,
    name: cardCode,
    groupNames: options.groupNames ?? ['Liella!'],
    cardType: CardType.MEMBER,
    cost: 2,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.PURPLE, 1)],
    bladeHearts: options.bladeHeart ? [{ effect: BladeHeartEffect.DRAW }] : [],
  };
}

function createLive(cardCode: string): LiveCardData {
  return {
    cardCode,
    name: cardCode,
    groupNames: ['Liella!'],
    cardType: CardType.LIVE,
    score: 3,
    requirements: createHeartRequirement({ [HeartColor.PURPLE]: 1 }),
  };
}

function setupState(cheerCards: readonly ReturnType<typeof createCardInstance>[]): {
  readonly game: GameState;
  readonly sourceId: string;
} {
  const source = createCardInstance(
    createMember('PL!SP-pb2-008-R'),
    PLAYER1,
    'sp-pb2-008-source'
  );

  let game = createGameState('sp-pb2-008-shiki', PLAYER1, 'P1', PLAYER2, 'P2');
  game = registerCards(game, [source, ...cheerCards]);
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
      firstPlayerCheerCardIds: cheerCards.map((card) => card.instanceId),
    },
    resolutionZone: {
      ...game.resolutionZone,
      cardIds: cheerCards.map((card) => card.instanceId),
      revealedCardIds: cheerCards.map((card) => card.instanceId),
    },
  };

  return {
    game,
    sourceId: source.instanceId,
  };
}

function noBladeLiellaMember(index: number) {
  return createCardInstance(
    createMember(`PL!SP-test-no-blade-${index}`),
    PLAYER1,
    `sp-pb2-008-no-blade-${index}`
  );
}

function startAbility(game: GameState, sourceCardId: string): GameState {
  const pendingAbility: PendingAbilityState = {
    id: 'sp-pb2-008-pending',
    abilityId: SP_PB2_008_LIVE_SUCCESS_CHEER_NO_BLADE_HEART_LIELLA_MEMBER_SCORE_ABILITY_ID,
    sourceCardId,
    controllerId: PLAYER1,
    mandatory: true,
    timingId: TriggerCondition.ON_LIVE_SUCCESS,
    eventIds: ['live-success'],
    sourceSlot: SlotPosition.CENTER,
  };
  return resolvePendingCardEffects({ ...game, pendingAbilities: [pendingAbility] }).gameState;
}

function latestPayload(game: GameState) {
  return game.actionHistory
    .filter(
      (action) =>
        action.type === 'RESOLVE_ABILITY' &&
        action.payload.abilityId ===
          SP_PB2_008_LIVE_SUCCESS_CHEER_NO_BLADE_HEART_LIELLA_MEMBER_SCORE_ABILITY_ID
    )
    .at(-1)?.payload;
}

describe('PL!SP-pb2-008 Shiki live success score workflow', () => {
  it.each([
    { count: 2, expectedScoreBonus: 1 },
    { count: 4, expectedScoreBonus: 2 },
    { count: 5, expectedScoreBonus: 2 },
  ])('adds capped total SCORE for $count qualifying revealed members', ({ count, expectedScoreBonus }) => {
    const cheerCards = Array.from({ length: count }, (_, index) => noBladeLiellaMember(index));
    const scenario = setupState(cheerCards);
    const state = startAbility(scenario.game, scenario.sourceId);

    expect(state.liveResolution.liveModifiers).toContainEqual({
      kind: 'SCORE',
      playerId: PLAYER1,
      countDelta: expectedScoreBonus,
      sourceCardId: scenario.sourceId,
      abilityId: SP_PB2_008_LIVE_SUCCESS_CHEER_NO_BLADE_HEART_LIELLA_MEMBER_SCORE_ABILITY_ID,
    });
    expect(state.liveResolution.playerScores.get(PLAYER1)).toBe(5 + expectedScoreBonus);
    expect(latestPayload(state)).toMatchObject({
      qualifyingCheerMemberCount: count,
      scoreBonus: expectedScoreBonus,
    });
  });

  it('does not count Liella live, blade-heart member, or non-Liella member cards', () => {
    const valid1 = noBladeLiellaMember(1);
    const valid2 = noBladeLiellaMember(2);
    const liellaLive = createCardInstance(
      createLive('PL!SP-test-live'),
      PLAYER1,
      'sp-pb2-008-live'
    );
    const bladeHeartMember = createCardInstance(
      createMember('PL!SP-test-blade-heart', { bladeHeart: true }),
      PLAYER1,
      'sp-pb2-008-blade-heart'
    );
    const nonLiellaMember = createCardInstance(
      createMember('PL!S-test-aqours', { groupNames: ['Aqours'] }),
      PLAYER1,
      'sp-pb2-008-aqours'
    );
    const scenario = setupState([
      valid1,
      valid2,
      liellaLive,
      bladeHeartMember,
      nonLiellaMember,
    ]);
    const state = startAbility(scenario.game, scenario.sourceId);

    expect(state.liveResolution.playerScores.get(PLAYER1)).toBe(6);
    expect(latestPayload(state)).toMatchObject({
      qualifyingCheerMemberIds: [valid1.instanceId, valid2.instanceId],
      qualifyingCheerMemberCount: 2,
      scoreBonus: 1,
    });
  });
});
