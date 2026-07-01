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
  type LiveModifierState,
} from '../../src/domain/entities/game';
import { addCardToStatefulZone, placeCardInSlot } from '../../src/domain/entities/zone';
import { createConfirmEffectStepCommand } from '../../src/application/game-commands';
import { resolvePendingCardEffects } from '../../src/application/card-effect-runner';
import { GameService } from '../../src/application/game-service';
import { createGameSession } from '../../src/application/game-session';
import { SP_PB2_045_LIVE_START_LIELLA_HEART_FOUR_COUNT_THIS_LIVE_SCORE_ABILITY_ID } from '../../src/application/card-effects/ability-ids';
import {
  CardType,
  FaceState,
  HeartColor,
  OrientationState,
  SlotPosition,
  TriggerCondition,
} from '../../src/shared/types/enums';
import { confirmIfConfirmOnly } from './confirm-only-pending';

const PLAYER1 = 'player1';
const PLAYER2 = 'player2';

function createZettaiLover(cardCode = 'PL!SP-pb2-045-L'): LiveCardData {
  return {
    cardCode,
    name: '絶対的LOVER',
    groupNames: ['Liella!'],
    cardType: CardType.LIVE,
    score: 4,
    requirements: createHeartRequirement({ [HeartColor.PURPLE]: 2 }),
  };
}

function createMember(options: {
  readonly cardCode: string;
  readonly groupNames?: readonly string[];
  readonly heartCount: number;
}): MemberCardData {
  return {
    cardCode: options.cardCode,
    name: options.cardCode,
    groupNames: options.groupNames,
    cardType: CardType.MEMBER,
    cost: 5,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.PURPLE, options.heartCount)],
  };
}

function setupState(options: {
  readonly members: Partial<
    Record<
      SlotPosition,
      {
        readonly cardCode: string;
        readonly groupNames?: readonly string[];
        readonly heartCount: number;
      }
    >
  >;
  readonly initialScore?: number;
  readonly includeSecondLive?: boolean;
}): {
  readonly game: GameState;
  readonly live: ReturnType<typeof createCardInstance>;
  readonly secondLive: ReturnType<typeof createCardInstance> | null;
  readonly members: Partial<Record<SlotPosition, ReturnType<typeof createCardInstance>>>;
} {
  const live = createCardInstance(createZettaiLover(), PLAYER1, 'zettai-lover-live');
  const secondLive = options.includeSecondLive
    ? createCardInstance(createZettaiLover('PL!SP-pb2-045-L'), PLAYER1, 'zettai-lover-live-2')
    : null;
  const memberEntries = Object.entries(options.members).map(([slot, member]) => {
    const card = createCardInstance(
      createMember({
        cardCode: member.cardCode,
        groupNames: member.groupNames,
        heartCount: member.heartCount,
      }),
      PLAYER1,
      `member-${slot.toLowerCase()}`
    );
    return [slot as SlotPosition, card] as const;
  });
  const members = Object.fromEntries(memberEntries) as Partial<
    Record<SlotPosition, ReturnType<typeof createCardInstance>>
  >;
  const cards = [
    live,
    ...(secondLive ? [secondLive] : []),
    ...memberEntries.map(([, card]) => card),
  ];

  let game = createGameState('sp-pb2-045-zettai-lover', PLAYER1, 'P1', PLAYER2, 'P2');
  game = registerCards(game, cards);
  game = updatePlayer(game, PLAYER1, (player) => {
    const memberSlots = memberEntries.reduce(
      (slots, [slot, card]) =>
        placeCardInSlot(slots, slot, card.instanceId, {
          orientation: OrientationState.ACTIVE,
          face: FaceState.FACE_UP,
        }),
      player.memberSlots
    );
    return {
      ...player,
      liveZone: secondLive
        ? addCardToStatefulZone(
            addCardToStatefulZone(player.liveZone, live.instanceId),
            secondLive.instanceId
          )
        : addCardToStatefulZone(player.liveZone, live.instanceId),
      memberSlots,
    };
  });
  game = {
    ...game,
    liveResolution: {
      ...game.liveResolution,
      playerScores: new Map([[PLAYER1, options.initialScore ?? 4]]),
      performingPlayerId: PLAYER1,
    },
  };

  return { game, live, secondLive, members };
}

function resolveLiveStart(game: GameState): GameState {
  const result = new GameService().executeCheckTiming(game, [TriggerCondition.ON_LIVE_START]);
  expect(result.success).toBe(true);
  const gameState = confirmIfConfirmOnly(result.gameState, PLAYER1);
  expect(gameState.activeEffect).toBeNull();
  return gameState;
}

function zettaiScoreModifiers(game: GameState) {
  return game.liveResolution.liveModifiers.filter(
    (modifier) =>
      modifier.kind === 'SCORE' &&
      modifier.abilityId ===
        SP_PB2_045_LIVE_START_LIELLA_HEART_FOUR_COUNT_THIS_LIVE_SCORE_ABILITY_ID
  );
}

function latestZettaiPayload(game: GameState) {
  return [...game.actionHistory]
    .reverse()
    .find(
      (action) =>
        action.type === 'RESOLVE_ABILITY' &&
        action.payload.abilityId ===
          SP_PB2_045_LIVE_START_LIELLA_HEART_FOUR_COUNT_THIS_LIVE_SCORE_ABILITY_ID
    )?.payload;
}

describe('PL!SP-pb2-045-L Zettai LOVER live start workflow', () => {
  it('consumes pending and records scoreBonus 0 when no Liella member has four effective Hearts', () => {
    const { game } = setupState({
      members: {
        [SlotPosition.LEFT]: {
          cardCode: 'PL!SP-test-left',
          groupNames: ['Liella!'],
          heartCount: 3,
        },
      },
    });

    const state = resolveLiveStart(game);

    expect(state.pendingAbilities).toEqual([]);
    expect(zettaiScoreModifiers(state)).toEqual([]);
    expect(state.liveResolution.playerScores.get(PLAYER1)).toBe(4);
    expect(latestZettaiPayload(state)).toMatchObject({
      step: 'LIELLA_HEART_FOUR_COUNT_THIS_LIVE_SCORE',
      qualifyingMemberCardIds: [],
      scoreBonus: 0,
    });
  });

  it('adds SCORE +1 and refreshes playerScores for one qualifying Liella member', () => {
    const { game, live, members } = setupState({
      members: {
        [SlotPosition.LEFT]: {
          cardCode: 'PL!SP-test-left',
          groupNames: ['Liella!'],
          heartCount: 4,
        },
      },
    });

    const state = resolveLiveStart(game);

    expect(zettaiScoreModifiers(state)).toEqual([
      {
        kind: 'SCORE',
        playerId: PLAYER1,
        countDelta: 1,
        liveCardId: live.instanceId,
        sourceCardId: live.instanceId,
        abilityId: SP_PB2_045_LIVE_START_LIELLA_HEART_FOUR_COUNT_THIS_LIVE_SCORE_ABILITY_ID,
      },
    ]);
    expect(state.liveResolution.playerScores.get(PLAYER1)).toBe(5);
    expect(latestZettaiPayload(state)).toMatchObject({
      qualifyingMemberCardIds: [members[SlotPosition.LEFT]!.instanceId],
      scoreBonus: 1,
    });
  });

  it('adds SCORE +2 for two qualifying Liella members and ignores non-Liella members', () => {
    const { game, live, members } = setupState({
      members: {
        [SlotPosition.LEFT]: {
          cardCode: 'PL!SP-test-left',
          groupNames: ['Liella!'],
          heartCount: 4,
        },
        [SlotPosition.CENTER]: {
          cardCode: 'PL!SP-test-center',
          groupNames: ['Liella!'],
          heartCount: 5,
        },
        [SlotPosition.RIGHT]: {
          cardCode: 'PL!S-test-right',
          groupNames: ['Aqours'],
          heartCount: 6,
        },
      },
    });

    const state = resolveLiveStart(game);

    expect(zettaiScoreModifiers(state)).toEqual([
      {
        kind: 'SCORE',
        playerId: PLAYER1,
        countDelta: 2,
        liveCardId: live.instanceId,
        sourceCardId: live.instanceId,
        abilityId: SP_PB2_045_LIVE_START_LIELLA_HEART_FOUR_COUNT_THIS_LIVE_SCORE_ABILITY_ID,
      },
    ]);
    expect(state.liveResolution.playerScores.get(PLAYER1)).toBe(6);
    expect(latestZettaiPayload(state)).toMatchObject({
      qualifyingMemberCardIds: [
        members[SlotPosition.LEFT]!.instanceId,
        members[SlotPosition.CENTER]!.instanceId,
      ],
      scoreBonus: 2,
    });
  });

  it('counts member HEART modifiers as effective Hearts', () => {
    const { game, live, members } = setupState({
      members: {
        [SlotPosition.CENTER]: {
          cardCode: 'PL!SP-test-center',
          groupNames: ['Liella!'],
          heartCount: 2,
        },
      },
    });
    const targetMemberCardId = members[SlotPosition.CENTER]!.instanceId;
    const heartModifier: LiveModifierState = {
      kind: 'HEART',
      target: 'TARGET_MEMBER',
      playerId: PLAYER1,
      targetMemberCardId,
      hearts: [createHeartIcon(HeartColor.PURPLE, 2)],
      sourceCardId: 'test-heart-source',
      abilityId: 'test-heart-modifier',
    };
    const stateWithHeartModifier: GameState = {
      ...game,
      liveResolution: {
        ...game.liveResolution,
        liveModifiers: [heartModifier],
      },
    };

    const state = resolveLiveStart(stateWithHeartModifier);

    expect(zettaiScoreModifiers(state)).toContainEqual({
      kind: 'SCORE',
      playerId: PLAYER1,
      countDelta: 1,
      liveCardId: live.instanceId,
      sourceCardId: live.instanceId,
      abilityId: SP_PB2_045_LIVE_START_LIELLA_HEART_FOUR_COUNT_THIS_LIVE_SCORE_ABILITY_ID,
    });
    expect(state.liveResolution.playerScores.get(PLAYER1)).toBe(5);
    expect(latestZettaiPayload(state)).toMatchObject({
      qualifyingMemberCardIds: [targetMemberCardId],
      scoreBonus: 1,
    });
  });

  it('continues ordered pending resolution after this immediate workflow', () => {
    const { game } = setupState({
      includeSecondLive: true,
      members: {
        [SlotPosition.LEFT]: {
          cardCode: 'PL!SP-test-left',
          groupNames: ['Liella!'],
          heartCount: 4,
        },
      },
    });
    const checkResult = new GameService().executeCheckTiming(game, [
      TriggerCondition.ON_LIVE_START,
    ]);
    expect(checkResult.success).toBe(true);
    expect(checkResult.gameState.activeEffect?.canResolveInOrder).toBe(true);

    const session = createGameSession();
    session.createGame('sp-pb2-045-zettai-lover-order', PLAYER1, 'P1', PLAYER2, 'P2');
    (session as unknown as { authorityState: GameState }).authorityState = checkResult.gameState;
    const orderResult = session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        checkResult.gameState.activeEffect!.id,
        undefined,
        null,
        true
      )
    );

    expect(orderResult.success).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.pendingAbilities).toEqual([]);
    expect(session.state?.liveResolution.playerScores.get(PLAYER1)).toBe(6);
    expect(zettaiScoreModifiers(session.state!)).toHaveLength(2);
    expect(
      session.state?.actionHistory.filter(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId ===
            SP_PB2_045_LIVE_START_LIELLA_HEART_FOUR_COUNT_THIS_LIVE_SCORE_ABILITY_ID
      )
    ).toHaveLength(2);
  });

  it('resolves manually seeded pending abilities without leaving pending state', () => {
    const { game, live } = setupState({
      members: {
        [SlotPosition.LEFT]: {
          cardCode: 'PL!SP-test-left',
          groupNames: ['Liella!'],
          heartCount: 4,
        },
      },
    });
    const stateWithPending: GameState = {
      ...game,
      pendingAbilities: [
        {
          id: `${SP_PB2_045_LIVE_START_LIELLA_HEART_FOUR_COUNT_THIS_LIVE_SCORE_ABILITY_ID}:${live.instanceId}:manual`,
          abilityId: SP_PB2_045_LIVE_START_LIELLA_HEART_FOUR_COUNT_THIS_LIVE_SCORE_ABILITY_ID,
          sourceCardId: live.instanceId,
          controllerId: PLAYER1,
          mandatory: true,
          timingId: TriggerCondition.ON_LIVE_START,
          eventIds: ['manual-live-start'],
        },
      ],
    };

    const pendingResult = resolvePendingCardEffects(stateWithPending);
    const result = {
      ...pendingResult,
      gameState: confirmIfConfirmOnly(pendingResult.gameState, PLAYER1),
    };

    expect(result.gameState.pendingAbilities).toEqual([]);
    expect(result.gameState.liveResolution.playerScores.get(PLAYER1)).toBe(5);
    expect(result.resolvedAbilityIds).toEqual([
      `${SP_PB2_045_LIVE_START_LIELLA_HEART_FOUR_COUNT_THIS_LIVE_SCORE_ABILITY_ID}:${live.instanceId}:manual`,
    ]);
  });
});
