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
} from '../../src/domain/entities/game';
import {
  addCardToStatefulZone,
  addCardToZone,
  placeCardInSlot,
} from '../../src/domain/entities/zone';
import { addLiveModifier } from '../../src/domain/rules/live-modifiers';
import { createConfirmEffectStepCommand } from '../../src/application/game-commands';
import { GameService } from '../../src/application/game-service';
import { createGameSession } from '../../src/application/game-session';
import {
  SP_BP4_024_LIVE_START_CENTER_LIELLA_HIGHER_COST_THIS_LIVE_SCORE_ABILITY_ID,
  SP_BP4_024_LIVE_START_LEFT_LIELLA_RED_HEART_THREE_GAIN_TWO_BLADE_ABILITY_ID,
} from '../../src/application/card-effects/ability-ids';
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

function createNonfiction(): LiveCardData {
  return {
    cardCode: 'PL!SP-bp4-024-L',
    name: 'ノンフィクション!!',
    groupNames: ['Liella!'],
    cardType: CardType.LIVE,
    score: 6,
    requirements: createHeartRequirement({ [HeartColor.RED]: 3 }),
  };
}

function createSuccessLive(score: number): LiveCardData {
  return {
    cardCode: `PL!-test-success-live-${score}`,
    name: `Success Live ${score}`,
    cardType: CardType.LIVE,
    score,
    requirements: createHeartRequirement({ [HeartColor.PINK]: 1 }),
  };
}

function createMember(options: {
  readonly cardCode: string;
  readonly cost: number;
  readonly groupNames?: readonly string[];
  readonly redHearts?: number;
}): MemberCardData {
  return {
    cardCode: options.cardCode,
    name: options.cardCode,
    groupNames: options.groupNames,
    cardType: CardType.MEMBER,
    cost: options.cost,
    blade: 1,
    hearts:
      options.redHearts && options.redHearts > 0
        ? [createHeartIcon(HeartColor.RED, options.redHearts)]
        : [createHeartIcon(HeartColor.PINK, 1)],
  };
}

function setupState(options: {
  readonly ownCenterCost?: number;
  readonly ownCenterGroup?: string;
  readonly opponentCenterCost?: number | null;
  readonly opponentCenterCardCode?: string;
  readonly opponentSuccessLiveScore?: number;
  readonly leftGroup?: string;
  readonly leftRedHearts?: number;
  readonly initialScore?: number;
}): {
  readonly game: GameState;
  readonly live: ReturnType<typeof createCardInstance>;
  readonly leftMember: ReturnType<typeof createCardInstance>;
  readonly ownCenter: ReturnType<typeof createCardInstance>;
  readonly opponentCenter: ReturnType<typeof createCardInstance> | null;
} {
  const live = createCardInstance(createNonfiction(), PLAYER1, 'nonfiction-live');
  const leftMember = createCardInstance(
    createMember({
      cardCode: options.leftGroup === 'Aqours' ? 'PL!S-test-left' : 'PL!SP-test-left',
      cost: 4,
      groupNames: [options.leftGroup ?? 'Liella!'],
      redHearts: options.leftRedHearts ?? 1,
    }),
    PLAYER1,
    'own-left'
  );
  const ownCenter = createCardInstance(
    createMember({
      cardCode: options.ownCenterGroup === 'Aqours' ? 'PL!S-test-center' : 'PL!SP-test-center',
      cost: options.ownCenterCost ?? 7,
      groupNames: [options.ownCenterGroup ?? 'Liella!'],
      redHearts: 1,
    }),
    PLAYER1,
    'own-center'
  );
  const opponentCenter =
    options.opponentCenterCost === null
      ? null
      : createCardInstance(
          createMember({
            cardCode: options.opponentCenterCardCode ?? 'PL!S-test-opponent-center',
            cost: options.opponentCenterCost ?? 5,
            groupNames: ['Aqours'],
            redHearts: 1,
          }),
          PLAYER2,
          'opponent-center'
        );
  const opponentSuccessLive =
    options.opponentSuccessLiveScore !== undefined
      ? createCardInstance(
          createSuccessLive(options.opponentSuccessLiveScore),
          PLAYER2,
          'opponent-success-live'
        )
      : null;
  const cards = [
    live,
    leftMember,
    ownCenter,
    ...(opponentCenter ? [opponentCenter] : []),
    ...(opponentSuccessLive ? [opponentSuccessLive] : []),
  ];

  let game = createGameState('sp-bp4-024-nonfiction', PLAYER1, 'P1', PLAYER2, 'P2');
  game = registerCards(game, cards);
  game = updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    liveZone: addCardToStatefulZone(player.liveZone, live.instanceId),
    memberSlots: placeCardInSlot(
      placeCardInSlot(player.memberSlots, SlotPosition.LEFT, leftMember.instanceId, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      }),
      SlotPosition.CENTER,
      ownCenter.instanceId,
      {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      }
    ),
  }));
  if (opponentCenter) {
    game = updatePlayer(game, PLAYER2, (player) => ({
      ...player,
      memberSlots: placeCardInSlot(
        player.memberSlots,
        SlotPosition.CENTER,
        opponentCenter.instanceId,
        {
          orientation: OrientationState.ACTIVE,
          face: FaceState.FACE_UP,
        }
      ),
      successZone: opponentSuccessLive
        ? addCardToZone(player.successZone, opponentSuccessLive.instanceId)
        : player.successZone,
    }));
  }
  game = {
    ...game,
    liveResolution: {
      ...game.liveResolution,
      playerScores: new Map([[PLAYER1, options.initialScore ?? 6]]),
      performingPlayerId: PLAYER1,
    },
  };

  return { game, live, leftMember, ownCenter, opponentCenter };
}

function resolveLiveStart(game: GameState): GameState {
  const result = new GameService().executeCheckTiming(game, [TriggerCondition.ON_LIVE_START]);
  expect(result.success).toBe(true);
  if (!result.gameState.activeEffect?.canResolveInOrder) {
    return result.gameState;
  }

  const session = createGameSession();
  session.createGame('sp-bp4-024-nonfiction-session', PLAYER1, 'P1', PLAYER2, 'P2');
  (session as unknown as { authorityState: GameState }).authorityState = result.gameState;
  const orderResult = session.executeCommand(
    createConfirmEffectStepCommand(
      PLAYER1,
      result.gameState.activeEffect.id,
      undefined,
      null,
      true
    )
  );
  expect(orderResult.success).toBe(true);
  return session.state!;
}

function nonfictionScoreModifiers(game: GameState) {
  return game.liveResolution.liveModifiers.filter(
    (modifier) =>
      modifier.kind === 'SCORE' &&
      modifier.abilityId ===
        SP_BP4_024_LIVE_START_CENTER_LIELLA_HIGHER_COST_THIS_LIVE_SCORE_ABILITY_ID
  );
}

function nonfictionBladeModifiers(game: GameState) {
  return game.liveResolution.liveModifiers.filter(
    (modifier) =>
      modifier.kind === 'BLADE' &&
      modifier.abilityId ===
        SP_BP4_024_LIVE_START_LEFT_LIELLA_RED_HEART_THREE_GAIN_TWO_BLADE_ABILITY_ID
  );
}

describe('PL!SP-bp4-024 Nonfiction workflow', () => {
  it('adds SCORE +1 and refreshes playerScores when own center Liella cost is higher', () => {
    const { game, live } = setupState({
      ownCenterCost: 8,
      opponentCenterCost: 7,
      leftRedHearts: 1,
      initialScore: 6,
    });
    const state = resolveLiveStart(game);

    expect(nonfictionScoreModifiers(state)).toEqual([
      {
        kind: 'SCORE',
        playerId: PLAYER1,
        countDelta: 1,
        liveCardId: live.instanceId,
        sourceCardId: live.instanceId,
        abilityId: SP_BP4_024_LIVE_START_CENTER_LIELLA_HIGHER_COST_THIS_LIVE_SCORE_ABILITY_ID,
      },
    ]);
    expect(state.liveResolution.playerScores.get(PLAYER1)).toBe(7);
  });

  it.each([
    {
      label: 'own center is not Liella',
      ownCenterGroup: 'Aqours',
      ownCenterCost: 8,
      opponentCenterCost: 7,
    },
    { label: 'cost is equal', ownCenterGroup: 'Liella!', ownCenterCost: 7, opponentCenterCost: 7 },
    { label: 'cost is lower', ownCenterGroup: 'Liella!', ownCenterCost: 6, opponentCenterCost: 7 },
    {
      label: 'opponent center is missing',
      ownCenterGroup: 'Liella!',
      ownCenterCost: 8,
      opponentCenterCost: null,
    },
  ])('does not add score when $label but still consumes pending', (options) => {
    const { game } = setupState({
      ...options,
      leftRedHearts: 1,
      initialScore: 6,
    });
    const state = resolveLiveStart(game);

    expect(nonfictionScoreModifiers(state)).toEqual([]);
    expect(state.liveResolution.playerScores.get(PLAYER1)).toBe(6);
    expect(state.pendingAbilities).toEqual([]);
    expect(
      state.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId ===
            SP_BP4_024_LIVE_START_CENTER_LIELLA_HIGHER_COST_THIS_LIVE_SCORE_ABILITY_ID &&
          action.payload.conditionMet === false
      )
    ).toBe(true);
  });

  it('uses opponent effective center cost when PL!-bp4-008 has the success-score cost bonus', () => {
    const { game } = setupState({
      ownCenterCost: 6,
      opponentCenterCost: 4,
      opponentCenterCardCode: 'PL!-bp4-008-P',
      opponentSuccessLiveScore: 6,
      leftRedHearts: 1,
      initialScore: 6,
    });
    const state = resolveLiveStart(game);

    expect(nonfictionScoreModifiers(state)).toEqual([]);
    expect(state.liveResolution.playerScores.get(PLAYER1)).toBe(6);
    expect(
      state.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId ===
            SP_BP4_024_LIVE_START_CENTER_LIELLA_HIGHER_COST_THIS_LIVE_SCORE_ABILITY_ID &&
          action.payload.ownCenterCost === 6 &&
          action.payload.opponentCenterCost === 7 &&
          action.payload.conditionMet === false
      )
    ).toBe(true);
  });

  it('gives BLADE +2 to the own left Liella member with three red Hearts', () => {
    const { game, leftMember } = setupState({
      ownCenterCost: 6,
      opponentCenterCost: 7,
      leftRedHearts: 3,
    });
    const state = resolveLiveStart(game);

    expect(nonfictionBladeModifiers(state)).toEqual([
      {
        kind: 'BLADE',
        playerId: PLAYER1,
        countDelta: 2,
        sourceCardId: leftMember.instanceId,
        abilityId: SP_BP4_024_LIVE_START_LEFT_LIELLA_RED_HEART_THREE_GAIN_TWO_BLADE_ABILITY_ID,
      },
    ]);
  });

  it('counts effective red Heart modifiers for the own left member', () => {
    const { game, leftMember } = setupState({
      ownCenterCost: 6,
      opponentCenterCost: 7,
      leftRedHearts: 2,
    });
    const prepared = addLiveModifier(game, {
      kind: 'HEART',
      target: 'SOURCE_MEMBER',
      playerId: PLAYER1,
      sourceCardId: leftMember.instanceId,
      abilityId: 'fixture:red-heart',
      hearts: [{ color: HeartColor.RED, count: 1 }],
    });
    const state = resolveLiveStart(prepared);

    expect(nonfictionBladeModifiers(state)).toHaveLength(1);
    expect(nonfictionBladeModifiers(state)[0]).toMatchObject({
      sourceCardId: leftMember.instanceId,
      countDelta: 2,
    });
    expect(
      state.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId ===
            SP_BP4_024_LIVE_START_LEFT_LIELLA_RED_HEART_THREE_GAIN_TWO_BLADE_ABILITY_ID &&
          action.payload.leftRedHeartCount === 3 &&
          action.payload.conditionMet === true
      )
    ).toBe(true);
  });

  it('counts target-member red Heart modifiers for the own left member', () => {
    const { game, leftMember } = setupState({
      ownCenterCost: 6,
      opponentCenterCost: 7,
      leftRedHearts: 1,
    });
    const prepared = addLiveModifier(game, {
      kind: 'HEART',
      target: 'TARGET_MEMBER',
      playerId: PLAYER1,
      sourceCardId: 'fixture:red-heart-source',
      targetMemberCardId: leftMember.instanceId,
      abilityId: 'fixture:target-red-heart',
      hearts: [{ color: HeartColor.RED, count: 2 }],
    });
    const state = resolveLiveStart(prepared);

    expect(nonfictionBladeModifiers(state)).toHaveLength(1);
    expect(nonfictionBladeModifiers(state)[0]).toMatchObject({
      sourceCardId: leftMember.instanceId,
      countDelta: 2,
    });
    expect(
      state.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId ===
            SP_BP4_024_LIVE_START_LEFT_LIELLA_RED_HEART_THREE_GAIN_TWO_BLADE_ABILITY_ID &&
          action.payload.leftRedHeartCount === 3 &&
          action.payload.conditionMet === true
      )
    ).toBe(true);
  });

  it.each([
    { label: 'left member is not Liella', leftGroup: 'Aqours', leftRedHearts: 3 },
    {
      label: 'left member has fewer than three red Hearts',
      leftGroup: 'Liella!',
      leftRedHearts: 2,
    },
  ])('does not add BLADE when $label', (options) => {
    const { game } = setupState({
      ownCenterCost: 6,
      opponentCenterCost: 7,
      leftGroup: options.leftGroup,
      leftRedHearts: options.leftRedHearts,
    });
    const state = resolveLiveStart(game);

    expect(nonfictionBladeModifiers(state)).toEqual([]);
    expect(state.pendingAbilities).toEqual([]);
    expect(
      state.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId ===
            SP_BP4_024_LIVE_START_LEFT_LIELLA_RED_HEART_THREE_GAIN_TWO_BLADE_ABILITY_ID &&
          action.payload.conditionMet === false
      )
    ).toBe(true);
  });

  it('resolves the score pending before the left-member BLADE pending', () => {
    const { game } = setupState({
      ownCenterCost: 8,
      opponentCenterCost: 7,
      leftRedHearts: 3,
    });
    const state = resolveLiveStart(game);
    const resolvedAbilityIds = state.actionHistory
      .filter((action) => action.type === 'RESOLVE_ABILITY')
      .map((action) => action.payload.abilityId);

    expect(
      resolvedAbilityIds.indexOf(
        SP_BP4_024_LIVE_START_CENTER_LIELLA_HIGHER_COST_THIS_LIVE_SCORE_ABILITY_ID
      )
    ).toBeLessThan(
      resolvedAbilityIds.indexOf(
        SP_BP4_024_LIVE_START_LEFT_LIELLA_RED_HEART_THREE_GAIN_TWO_BLADE_ABILITY_ID
      )
    );
  });
});
