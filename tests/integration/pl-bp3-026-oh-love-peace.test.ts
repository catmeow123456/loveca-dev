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
import { addCardToStatefulZone, placeCardInSlot } from '../../src/domain/entities/zone';
import {
  addHeartLiveModifierForMember,
  addLiveModifier,
} from '../../src/domain/rules/live-modifiers';
import { createConfirmEffectStepCommand } from '../../src/application/game-commands';
import { confirmActiveEffectStep } from '../../src/application/card-effect-runner';
import { GameService } from '../../src/application/game-service';
import { createGameSession } from '../../src/application/game-session';
import {
  HS_PB1_003_AUTO_HAND_TO_WAITING_GAIN_HEART_BLADE_ABILITY_ID,
  PL_BP3_026_LIVE_START_DISCARD_TWO_TARGET_MEMBER_GAIN_THREE_BLADE_ABILITY_ID,
  PL_BP3_026_LIVE_SUCCESS_HIGHER_STAGE_HEART_TOTAL_THIS_LIVE_SCORE_ABILITY_ID,
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
} from '../../src/shared/types/enums';

const PLAYER1 = 'player1';
const PLAYER2 = 'player2';

function createOhLovePeace(): LiveCardData {
  return {
    cardCode: 'PL!-bp3-026-L',
    name: 'Oh,Love&Peace!',
    groupNames: ["μ's"],
    cardType: CardType.LIVE,
    score: 6,
    requirements: createHeartRequirement({
      [HeartColor.PINK]: 2,
      [HeartColor.YELLOW]: 5,
      [HeartColor.PURPLE]: 2,
    }),
  };
}

function createMember(cardCode: string, name: string, heartCount = 1): MemberCardData {
  return {
    cardCode,
    name,
    groupNames: ["μ's"],
    cardType: CardType.MEMBER,
    cost: 4,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.PINK, heartCount)],
  };
}

interface LiveStartSetup {
  readonly game: GameState;
  readonly liveId: string;
  readonly handCardIds: readonly string[];
  readonly stageMemberIds: readonly string[];
  readonly watcherId?: string;
}

function setupLiveStart(options: {
  readonly handCount: number;
  readonly stageMembers: readonly {
    readonly id: string;
    readonly slot: SlotPosition;
    readonly cardCode?: string;
    readonly name?: string;
  }[];
}): LiveStartSetup {
  const live = createCardInstance(createOhLovePeace(), PLAYER1, 'oh-love-peace-live');
  const handCards = Array.from({ length: options.handCount }, (_, index) =>
    createCardInstance(
      createMember(`PL!-test-hand-${index}`, `Hand ${index}`),
      PLAYER1,
      `p1-hand-${index}`
    )
  );
  const stageMembers = options.stageMembers.map((member) =>
    createCardInstance(
      createMember(member.cardCode ?? `PL!-test-${member.id}`, member.name ?? member.id),
      PLAYER1,
      member.id
    )
  );

  let game = createGameState('pl-bp3-026-oh-love-peace', PLAYER1, 'P1', PLAYER2, 'P2');
  game = registerCards(game, [live, ...handCards, ...stageMembers]);
  game = updatePlayer(game, PLAYER1, (player) => {
    let memberSlots = player.memberSlots;
    for (const member of options.stageMembers) {
      memberSlots = placeCardInSlot(memberSlots, member.slot, member.id, {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      });
    }
    return {
      ...player,
      liveZone: addCardToStatefulZone(player.liveZone, live.instanceId),
      hand: { ...player.hand, cardIds: handCards.map((card) => card.instanceId) },
      memberSlots,
    };
  });
  game = {
    ...game,
    liveResolution: {
      ...game.liveResolution,
      performingPlayerId: PLAYER1,
      playerScores: new Map([[PLAYER1, 6]]),
    },
  };

  return {
    game,
    liveId: live.instanceId,
    handCardIds: handCards.map((card) => card.instanceId),
    stageMemberIds: stageMembers.map((card) => card.instanceId),
    watcherId: stageMembers.find((card) => card.data.cardCode === 'PL!HS-pb1-003-R')?.instanceId,
  };
}

function setupLiveSuccess(options: {
  readonly ownHeartCount: number;
  readonly opponentHeartCount: number;
  readonly addOwnHeartModifier?: number;
  readonly addBladeModifier?: boolean;
}): { readonly game: GameState; readonly liveId: string; readonly ownMemberId: string } {
  const live = createCardInstance(createOhLovePeace(), PLAYER1, 'oh-love-peace-live');
  const ownMember = createCardInstance(
    createMember('PL!-test-own-member', 'Own Member', options.ownHeartCount),
    PLAYER1,
    'own-member'
  );
  const opponentMember = createCardInstance(
    createMember('PL!-test-opponent-member', 'Opponent Member', options.opponentHeartCount),
    PLAYER2,
    'opponent-member'
  );

  let game = createGameState('pl-bp3-026-oh-love-peace-success', PLAYER1, 'P1', PLAYER2, 'P2');
  game = registerCards(game, [live, ownMember, opponentMember]);
  game = updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    liveZone: addCardToStatefulZone(player.liveZone, live.instanceId),
    memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, ownMember.instanceId, {
      orientation: OrientationState.ACTIVE,
      face: FaceState.FACE_UP,
    }),
  }));
  game = updatePlayer(game, PLAYER2, (player) => ({
    ...player,
    memberSlots: placeCardInSlot(
      player.memberSlots,
      SlotPosition.CENTER,
      opponentMember.instanceId,
      {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      }
    ),
  }));
  game = {
    ...game,
    currentPhase: GamePhase.LIVE_RESULT_PHASE,
    currentSubPhase: SubPhase.RESULT_FIRST_SUCCESS_EFFECTS,
    activePlayerIndex: 0,
    liveResolution: {
      ...game.liveResolution,
      performingPlayerId: PLAYER1,
      liveResults: new Map([[live.instanceId, true]]),
      playerScores: new Map([[PLAYER1, 6]]),
    },
  };

  if (options.addOwnHeartModifier) {
    const heartResult = addHeartLiveModifierForMember(game, {
      playerId: PLAYER1,
      memberCardId: ownMember.instanceId,
      sourceCardId: ownMember.instanceId,
      abilityId: 'test:heart-modifier',
      hearts: [createHeartIcon(HeartColor.BLUE, options.addOwnHeartModifier)],
    });
    expect(heartResult).not.toBeNull();
    game = heartResult!.gameState;
  }
  if (options.addBladeModifier) {
    game = addLiveModifier(game, {
      kind: 'BLADE',
      playerId: PLAYER1,
      sourceCardId: ownMember.instanceId,
      abilityId: 'test:blade-modifier',
      countDelta: 3,
    });
  }

  return { game, liveId: live.instanceId, ownMemberId: ownMember.instanceId };
}

function resolveLiveStart(game: GameState): GameState {
  const result = new GameService().executeCheckTiming(game, [TriggerCondition.ON_LIVE_START]);
  expect(result.success).toBe(true);
  return result.gameState;
}

function resolveLiveSuccess(game: GameState): GameState {
  const result = new GameService().executeCheckTiming(game, [TriggerCondition.ON_LIVE_SUCCESS]);
  expect(result.success).toBe(true);
  return confirmIfConfirmOnly(result.gameState);
}

function confirmIfConfirmOnly(game: GameState): GameState {
  return game.activeEffect?.metadata?.confirmOnlyPendingAbility === true
    ? confirmActiveEffectStep(game, PLAYER1, game.activeEffect.id)
    : game;
}

function confirmEffect(
  game: GameState,
  options: {
    readonly selectedCardId?: string | null;
    readonly selectedCardIds?: readonly string[];
  }
): GameState {
  const session = createGameSession();
  session.createGame('pl-bp3-026-oh-love-peace-session', PLAYER1, 'P1', PLAYER2, 'P2');
  (session as unknown as { authorityState: GameState }).authorityState = game;
  const result = session.executeCommand(
    createConfirmEffectStepCommand(
      PLAYER1,
      game.activeEffect!.id,
      options.selectedCardId,
      undefined,
      undefined,
      undefined,
      options.selectedCardIds
    )
  );
  expect(result.success).toBe(true);
  return session.state!;
}

describe('PL!-bp3-026 Oh,Love&Peace! workflow', () => {
  it('consumes live-start pending without opening an effect when hand or stage targets are insufficient', () => {
    const notEnoughHand = resolveLiveStart(
      setupLiveStart({
        handCount: 1,
        stageMembers: [{ id: 'target', slot: SlotPosition.CENTER }],
      }).game
    );
    expect(notEnoughHand.activeEffect).toBeNull();
    expect(notEnoughHand.pendingAbilities).toEqual([]);
    expect(
      notEnoughHand.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.step === 'NOT_ENOUGH_HAND_TO_DISCARD'
      )
    ).toBe(true);

    const noStageMember = resolveLiveStart(setupLiveStart({ handCount: 2, stageMembers: [] }).game);
    expect(noStageMember.activeEffect).toBeNull();
    expect(noStageMember.pendingAbilities).toEqual([]);
    expect(
      noStageMember.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.step === 'NO_STAGE_MEMBER_TARGET'
      )
    ).toBe(true);
  });

  it('allows the player to skip discarding two cards without granting BLADE', () => {
    const setup = setupLiveStart({
      handCount: 2,
      stageMembers: [{ id: 'target', slot: SlotPosition.CENTER }],
    });
    const selecting = resolveLiveStart(setup.game);
    expect(selecting.activeEffect).toMatchObject({
      abilityId: PL_BP3_026_LIVE_START_DISCARD_TWO_TARGET_MEMBER_GAIN_THREE_BLADE_ABILITY_ID,
      canSkipSelection: true,
    });

    const state = confirmEffect(selecting, { selectedCardId: null });

    expect(state.activeEffect).toBeNull();
    expect(state.players[0].hand.cardIds).toEqual(setup.handCardIds);
    expect(
      state.liveResolution.liveModifiers.some(
        (modifier) =>
          modifier.kind === 'BLADE' &&
          modifier.abilityId ===
            PL_BP3_026_LIVE_START_DISCARD_TWO_TARGET_MEMBER_GAIN_THREE_BLADE_ABILITY_ID
      )
    ).toBe(false);
  });

  it('discards two cards and auto-grants BLADE plus three to a single stage target', () => {
    const setup = setupLiveStart({
      handCount: 2,
      stageMembers: [{ id: 'target', slot: SlotPosition.CENTER }],
    });
    const selecting = resolveLiveStart(setup.game);
    const state = confirmEffect(selecting, { selectedCardIds: setup.handCardIds });

    expect(state.activeEffect).toBeNull();
    expect(state.players[0].mainDeck.cardIds).toEqual(expect.arrayContaining(setup.handCardIds));
    expect(
      state.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId ===
            PL_BP3_026_LIVE_START_DISCARD_TWO_TARGET_MEMBER_GAIN_THREE_BLADE_ABILITY_ID &&
          Array.isArray(action.payload.discardedHandCardIds) &&
          setup.handCardIds.every((cardId) => action.payload.discardedHandCardIds.includes(cardId))
      )
    ).toBe(true);
    expect(state.liveResolution.liveModifiers).toContainEqual({
      kind: 'BLADE',
      playerId: PLAYER1,
      sourceCardId: 'target',
      abilityId: PL_BP3_026_LIVE_START_DISCARD_TWO_TARGET_MEMBER_GAIN_THREE_BLADE_ABILITY_ID,
      countDelta: 3,
    });
  });

  it('opens target selection for multiple stage members and only grants BLADE to the selected member', () => {
    const setup = setupLiveStart({
      handCount: 2,
      stageMembers: [
        { id: 'target-a', slot: SlotPosition.LEFT },
        { id: 'target-b', slot: SlotPosition.CENTER },
        {
          id: 'watcher',
          slot: SlotPosition.RIGHT,
          cardCode: 'PL!HS-pb1-003-R',
          name: '大泽瑠璃乃',
        },
      ],
    });
    const selectingDiscard = resolveLiveStart(setup.game);
    const selectingTarget = confirmEffect(selectingDiscard, { selectedCardIds: setup.handCardIds });

    expect(selectingTarget.activeEffect).toMatchObject({
      selectableCardIds: ['target-a', 'target-b', 'watcher'],
      canSkipSelection: false,
    });
    expect(
      selectingTarget.actionHistory.some(
        (action) =>
          action.type === 'TRIGGER_ABILITY' &&
          action.payload.abilityId ===
            HS_PB1_003_AUTO_HAND_TO_WAITING_GAIN_HEART_BLADE_ABILITY_ID &&
          action.payload.sourceCardId === setup.watcherId
      )
    ).toBe(true);

    const state = confirmEffect(selectingTarget, { selectedCardId: 'target-b' });

    expect(
      state.liveResolution.liveModifiers.some(
        (modifier) => modifier.kind === 'BLADE' && modifier.sourceCardId === 'target-a'
      )
    ).toBe(false);
    expect(state.liveResolution.liveModifiers).toContainEqual({
      kind: 'BLADE',
      playerId: PLAYER1,
      sourceCardId: 'target-b',
      abilityId: PL_BP3_026_LIVE_START_DISCARD_TWO_TARGET_MEMBER_GAIN_THREE_BLADE_ABILITY_ID,
      countDelta: 3,
    });
  });

  it('adds this-live SCORE plus one and refreshes playerScores when own effective stage heart total is higher', () => {
    const { game, liveId } = setupLiveSuccess({ ownHeartCount: 4, opponentHeartCount: 3 });
    const state = resolveLiveSuccess(game);

    expect(state.liveResolution.liveModifiers).toContainEqual({
      kind: 'SCORE',
      playerId: PLAYER1,
      liveCardId: liveId,
      sourceCardId: liveId,
      abilityId: PL_BP3_026_LIVE_SUCCESS_HIGHER_STAGE_HEART_TOTAL_THIS_LIVE_SCORE_ABILITY_ID,
      countDelta: 1,
    });
    expect(state.liveResolution.playerScores.get(PLAYER1)).toBe(7);
    expect(
      state.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.ownHeartTotal === 4 &&
          action.payload.opponentHeartTotal === 3 &&
          action.payload.conditionMet === true
      )
    ).toBe(true);
  });

  it.each([
    { ownHeartCount: 3, opponentHeartCount: 3 },
    { ownHeartCount: 2, opponentHeartCount: 3 },
  ])(
    'does not add score when own heart total $ownHeartCount is not higher than opponent $opponentHeartCount',
    ({ ownHeartCount, opponentHeartCount }) => {
      const { game } = setupLiveSuccess({ ownHeartCount, opponentHeartCount });
      const state = resolveLiveSuccess(game);

      expect(
        state.liveResolution.liveModifiers.some(
          (modifier) =>
            modifier.kind === 'SCORE' &&
            modifier.abilityId ===
              PL_BP3_026_LIVE_SUCCESS_HIGHER_STAGE_HEART_TOTAL_THIS_LIVE_SCORE_ABILITY_ID
        )
      ).toBe(false);
      expect(state.liveResolution.playerScores.get(PLAYER1)).toBe(6);
    }
  );

  it('counts ability-granted HEART but not BLADE modifiers for the live-success total', () => {
    const withHeartModifier = resolveLiveSuccess(
      setupLiveSuccess({
        ownHeartCount: 2,
        opponentHeartCount: 3,
        addOwnHeartModifier: 2,
      }).game
    );
    expect(withHeartModifier.liveResolution.playerScores.get(PLAYER1)).toBe(7);

    const withBladeOnly = resolveLiveSuccess(
      setupLiveSuccess({
        ownHeartCount: 2,
        opponentHeartCount: 3,
        addBladeModifier: true,
      }).game
    );
    expect(withBladeOnly.liveResolution.playerScores.get(PLAYER1)).toBe(6);
    expect(
      withBladeOnly.actionHistory.some(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.ownHeartTotal === 2 &&
          action.payload.opponentHeartTotal === 3 &&
          action.payload.conditionMet === false
      )
    ).toBe(true);
  });
});
