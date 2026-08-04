import { describe, expect, it } from 'vitest';
import {
  S_BP2_007_AUTO_ON_CHEER_LIVE_HAND_SEVEN_OR_LESS_DRAW_ONE_ABILITY_ID,
  S_BP3_020_AUTO_ON_CHEER_AT_MOST_TWO_BLADE_HEART_REROLL_ABILITY_ID,
  HS_BP6_027_ON_CHEER_ADDITIONAL_CHEER_ABILITY_ID,
} from '../../src/application/card-effects/ability-ids';
import { confirmActiveEffectStep } from '../../src/application/card-effect-runner';
import { createConfirmSubPhaseAction } from '../../src/application/actions';
import { createRevealCheerCardCommand } from '../../src/application/game-commands';
import { GameService } from '../../src/application/game-service';
import { createGameSession } from '../../src/application/game-session';
import {
  createCardInstance,
  createHeartRequirement,
  type LiveCardData,
  type MemberCardData,
} from '../../src/domain/entities/card';
import {
  createGameState,
  registerCards,
  updatePlayer,
  type GameState,
} from '../../src/domain/entities/game';
import { addCardToStatefulZone, placeCardInSlot } from '../../src/domain/entities/zone';
import {
  BladeHeartEffect,
  CardType,
  EffectWindowType,
  GamePhase,
  HeartColor,
  SlotPosition,
  SubPhase,
  TurnType,
} from '../../src/shared/types/enums';

const P1 = 'player1';
const P2 = 'player2';

function member(
  cardCode: string,
  options: {
    readonly name?: string;
    readonly blade?: number;
    readonly hearts?: MemberCardData['hearts'];
    readonly bladeHearts?: MemberCardData['bladeHearts'];
    readonly groupNames?: readonly string[];
  } = {}
): MemberCardData {
  return {
    cardCode,
    name: options.name ?? cardCode,
    cardType: CardType.MEMBER,
    cost: 1,
    blade: options.blade ?? 0,
    hearts: options.hearts ?? [],
    bladeHearts: options.bladeHearts,
    groupNames: options.groupNames,
  };
}

function live(
  cardCode: string,
  options: {
    readonly name?: string;
    readonly bladeHearts?: LiveCardData['bladeHearts'];
    readonly groupNames?: readonly string[];
  } = {}
): LiveCardData {
  return {
    cardCode,
    name: options.name ?? cardCode,
    cardType: CardType.LIVE,
    score: 1,
    requirements: createHeartRequirement({ [HeartColor.PINK]: 1 }),
    bladeHearts: options.bladeHearts,
    groupNames: options.groupNames,
  };
}

function performanceJudgmentState(options: {
  readonly gameId: string;
  readonly stageMembers: readonly ReturnType<typeof createCardInstance>[];
  readonly performingLives: readonly ReturnType<typeof createCardInstance>[];
  readonly hand?: readonly ReturnType<typeof createCardInstance>[];
  readonly deck: readonly ReturnType<typeof createCardInstance>[];
}): GameState {
  const cards = [
    ...options.stageMembers,
    ...options.performingLives,
    ...(options.hand ?? []),
    ...options.deck,
  ];
  let game = registerCards(createGameState(options.gameId, P1, 'P1', P2, 'P2'), cards);
  game = updatePlayer(game, P1, (player) => {
    let slots = player.memberSlots;
    for (const [index, card] of options.stageMembers.entries()) {
      const slot = [SlotPosition.LEFT, SlotPosition.CENTER, SlotPosition.RIGHT][index];
      if (slot) {
        slots = placeCardInSlot(slots, slot, card.instanceId);
      }
    }
    return {
      ...player,
      memberSlots: slots,
      hand: { ...player.hand, cardIds: (options.hand ?? []).map((card) => card.instanceId) },
      mainDeck: { ...player.mainDeck, cardIds: options.deck.map((card) => card.instanceId) },
      liveZone: options.performingLives.reduce(
        (zone, card) => addCardToStatefulZone(zone, card.instanceId),
        player.liveZone
      ),
    };
  });
  return {
    ...game,
    currentPhase: GamePhase.PERFORMANCE_PHASE,
    currentSubPhase: SubPhase.PERFORMANCE_LIVE_START_EFFECTS,
    currentTurnType: TurnType.FIRST_PLAYER_TURN,
    activePlayerIndex: 0,
    firstPlayerIndex: 0,
    effectWindowType: EffectWindowType.LIVE_START,
    liveResolution: {
      ...game.liveResolution,
      isInLive: true,
      performingPlayerId: P1,
    },
  };
}

function resolvedAbilityActions(game: GameState, abilityId: string) {
  return game.actionHistory.filter(
    (action) => action.type === 'RESOLVE_ABILITY' && action.payload.abilityId === abilityId
  );
}

describe('cheer BLADE HEART ordering', () => {
  it('FAQ Q120: resolves the cheer DRAW before checking the seven-card ON_CHEER condition', () => {
    const hanamaru = createCardInstance(
      member('PL!S-bp2-007-P', {
        name: '国木田花丸',
        blade: 1,
        hearts: [{ color: HeartColor.PINK, count: 1 }],
      }),
      P1,
      'hanamaru'
    );
    const performingLive = createCardInstance(live('Q120-PERFORMING-LIVE'), P1, 'performing-live');
    const initialHand = Array.from({ length: 7 }, (_, index) =>
      createCardInstance(member(`Q120-HAND-${index}`), P1, `hand-${index}`)
    );
    const cheerDrawLive = createCardInstance(
      live('Q120-CHEER-DRAW-LIVE', {
        bladeHearts: [{ effect: BladeHeartEffect.DRAW }],
      }),
      P1,
      'cheer-draw-live'
    );
    const bladeHeartDrawn = createCardInstance(
      member('Q120-BLADE-HEART-DRAWN'),
      P1,
      'blade-heart-drawn'
    );
    const mustRemainInDeck = createCardInstance(member('Q120-MUST-REMAIN'), P1, 'must-remain');
    const service = new GameService();
    const game = performanceJudgmentState({
      gameId: 'q120-cheer-order',
      stageMembers: [hanamaru],
      performingLives: [performingLive],
      hand: initialHand,
      deck: [cheerDrawLive, bladeHeartDrawn, mustRemainInDeck],
    });

    const revealResult = service.processAction(
      game,
      createConfirmSubPhaseAction(P1, SubPhase.PERFORMANCE_LIVE_START_EFFECTS)
    );

    expect(revealResult.success).toBe(true);
    expect(revealResult.gameState.currentSubPhase).toBe(SubPhase.PERFORMANCE_JUDGMENT);
    expect(revealResult.gameState.players[0].hand.cardIds).toEqual([
      ...initialHand.map((card) => card.instanceId),
      bladeHeartDrawn.instanceId,
    ]);
    expect(revealResult.gameState.players[0].mainDeck.cardIds).toEqual([
      mustRemainInDeck.instanceId,
    ]);
    expect(
      resolvedAbilityActions(
        revealResult.gameState,
        S_BP2_007_AUTO_ON_CHEER_LIVE_HAND_SEVEN_OR_LESS_DRAW_ONE_ABILITY_ID
      ).map((action) => action.payload.step)
    ).toEqual(['CHEER_LIVE_OR_HAND_CONDITION_NOT_MET']);

    const judgmentResult = service.processAction(revealResult.gameState, {
      type: 'CONFIRM_JUDGMENT',
      playerId: P1,
      judgmentResults: new Map(),
      timestamp: 1,
    });
    expect(judgmentResult.success).toBe(true);
    expect(judgmentResult.gameState.players[0].hand.cardIds).toEqual([
      ...initialHand.map((card) => card.instanceId),
      bladeHeartDrawn.instanceId,
    ]);
    expect(judgmentResult.gameState.players[0].mainDeck.cardIds).toEqual([
      mustRemainInDeck.instanceId,
    ]);
  });

  it('manual reveal resolves a DRAW BLADE HEART immediately and only once', () => {
    const session = createGameSession();
    session.createGame('manual-cheer-draw-order', P1, 'P1', P2, 'P2');
    const cheerDraw = createCardInstance(
      member('MANUAL-CHEER-DRAW', {
        bladeHearts: [{ effect: BladeHeartEffect.DRAW }],
      }),
      P1,
      'manual-cheer-draw'
    );
    const drawn = createCardInstance(member('MANUAL-DRAWN'), P1, 'manual-drawn');
    const sentinel = createCardInstance(member('MANUAL-SENTINEL'), P1, 'manual-sentinel');
    let state = registerCards(session.state!, [cheerDraw, drawn, sentinel]);
    state = updatePlayer(state, P1, (player) => ({
      ...player,
      mainDeck: {
        ...player.mainDeck,
        cardIds: [cheerDraw.instanceId, drawn.instanceId, sentinel.instanceId],
      },
    }));
    state = {
      ...state,
      manualOperationMode: 'FREE',
      currentPhase: GamePhase.PERFORMANCE_PHASE,
      currentSubPhase: SubPhase.PERFORMANCE_JUDGMENT,
      activePlayerIndex: 0,
      firstPlayerIndex: 0,
      currentTurnType: TurnType.FIRST_PLAYER_TURN,
      liveResolution: { ...state.liveResolution, isInLive: true, performingPlayerId: P1 },
    };
    (session as unknown as { authorityState: GameState }).authorityState = state;

    const result = session.executeCommand(createRevealCheerCardCommand(P1));

    expect(result.success, result.error).toBe(true);
    expect(session.state!.resolutionZone.revealedCardIds).toEqual([cheerDraw.instanceId]);
    expect(session.state!.players[0].hand.cardIds).toEqual([drawn.instanceId]);
    expect(session.state!.players[0].mainDeck.cardIds).toEqual([sentinel.instanceId]);

    const judgmentResult = new GameService().processAction(session.state!, {
      type: 'CONFIRM_JUDGMENT',
      playerId: P1,
      judgmentResults: new Map(),
      timestamp: 1,
    });
    expect(judgmentResult.success).toBe(true);
    expect(judgmentResult.gameState.players[0].hand.cardIds).toEqual([drawn.instanceId]);
    expect(judgmentResult.gameState.players[0].mainDeck.cardIds).toEqual([sentinel.instanceId]);
  });

  it('keeps an original reroll DRAW resolved and resolves the replacement DRAW exactly once', () => {
    const sourceLive = createCardInstance(
      live('PL!S-bp3-020-L', { name: 'ダイスキだったらダイジョウブ！' }),
      P1,
      'reroll-source-live'
    );
    const bladeMember = createCardInstance(
      member('REROLL-BLADE-MEMBER', {
        blade: 1,
        hearts: [{ color: HeartColor.PINK, count: 1 }],
      }),
      P1,
      'reroll-blade-member'
    );
    const originalDrawCheer = createCardInstance(
      member('REROLL-ORIGINAL-DRAW', { bladeHearts: [{ effect: BladeHeartEffect.DRAW }] }),
      P1,
      'reroll-original-draw'
    );
    const originalDrawn = createCardInstance(
      member('REROLL-ORIGINAL-DRAWN'),
      P1,
      'reroll-original-drawn'
    );
    const replacementDrawCheer = createCardInstance(
      member('REROLL-REPLACEMENT-DRAW', { bladeHearts: [{ effect: BladeHeartEffect.DRAW }] }),
      P1,
      'reroll-replacement-draw'
    );
    const replacementDrawn = createCardInstance(
      member('REROLL-REPLACEMENT-DRAWN'),
      P1,
      'reroll-replacement-drawn'
    );
    const sentinel = createCardInstance(member('REROLL-SENTINEL'), P1, 'reroll-sentinel');
    const service = new GameService();
    const game = performanceJudgmentState({
      gameId: 'cheer-reroll-draw-order',
      stageMembers: [bladeMember],
      performingLives: [sourceLive],
      deck: [originalDrawCheer, originalDrawn, replacementDrawCheer, replacementDrawn, sentinel],
    });

    const revealResult = service.processAction(
      game,
      createConfirmSubPhaseAction(P1, SubPhase.PERFORMANCE_LIVE_START_EFFECTS)
    );
    expect(revealResult.success).toBe(true);
    expect(revealResult.gameState.players[0].hand.cardIds).toEqual([originalDrawn.instanceId]);
    expect(revealResult.gameState.activeEffect?.abilityId).toBe(
      S_BP3_020_AUTO_ON_CHEER_AT_MOST_TWO_BLADE_HEART_REROLL_ABILITY_ID
    );

    const displaying = confirmActiveEffectStep(
      revealResult.gameState,
      P1,
      revealResult.gameState.activeEffect!.id,
      undefined,
      undefined,
      false,
      'reroll'
    );
    const resolved = confirmActiveEffectStep(displaying, P1, displaying.activeEffect!.id);

    expect(resolved.players[0].hand.cardIds).toEqual([
      originalDrawn.instanceId,
      replacementDrawn.instanceId,
    ]);
    expect(resolved.players[0].hand.cardIds).not.toContain(sentinel.instanceId);
    expect(resolved.players[0].mainDeck.cardIds).toEqual([sentinel.instanceId]);
    expect(resolved.players[0].waitingRoom.cardIds).toContain(originalDrawCheer.instanceId);
    expect(resolved.resolutionZone.revealedCardIds).toEqual([replacementDrawCheer.instanceId]);

    const judgmentResult = service.processAction(resolved, {
      type: 'CONFIRM_JUDGMENT',
      playerId: P1,
      judgmentResults: new Map(),
      timestamp: 1,
    });
    expect(judgmentResult.success).toBe(true);
    expect(judgmentResult.gameState.players[0].hand.cardIds).toEqual([
      originalDrawn.instanceId,
      replacementDrawn.instanceId,
    ]);
    expect(judgmentResult.gameState.players[0].mainDeck.cardIds).toEqual([sentinel.instanceId]);
  });

  it('月夜見海月 additional cheer reveals from the current top, then resolves its DRAW immediately', () => {
    const tsukiyomi = createCardInstance(
      live('PL!HS-bp6-027-L', {
        name: '月夜見海月',
        groupNames: ['蓮ノ空女学院スクールアイドルクラブ'],
      }),
      P1,
      'tsukiyomi-live'
    );
    const bladeMember = createCardInstance(
      member('TSUKIYOMI-BLADE-MEMBER', {
        blade: 1,
        hearts: [{ color: HeartColor.PINK, count: 1 }],
      }),
      P1,
      'tsukiyomi-blade-member'
    );
    const movableInitialCheer = createCardInstance(
      member('TSUKIYOMI-MOVABLE-CHEER', {
        groupNames: ['蓮ノ空女学院スクールアイドルクラブ'],
      }),
      P1,
      'tsukiyomi-movable-cheer'
    );
    const additionalDrawCheer = createCardInstance(
      member('TSUKIYOMI-ADDITIONAL-DRAW', {
        bladeHearts: [{ effect: BladeHeartEffect.DRAW }],
      }),
      P1,
      'tsukiyomi-additional-draw'
    );
    const additionalDrawn = createCardInstance(
      member('TSUKIYOMI-ADDITIONAL-DRAWN'),
      P1,
      'tsukiyomi-additional-drawn'
    );
    const sentinel = createCardInstance(member('TSUKIYOMI-SENTINEL'), P1, 'tsukiyomi-sentinel');
    const service = new GameService();
    const game = performanceJudgmentState({
      gameId: 'tsukiyomi-additional-draw-order',
      stageMembers: [bladeMember],
      performingLives: [tsukiyomi],
      deck: [movableInitialCheer, additionalDrawCheer, additionalDrawn, sentinel],
    });

    const revealResult = service.processAction(
      game,
      createConfirmSubPhaseAction(P1, SubPhase.PERFORMANCE_LIVE_START_EFFECTS)
    );
    expect(revealResult.success).toBe(true);
    expect(revealResult.gameState.activeEffect?.abilityId).toBe(
      HS_BP6_027_ON_CHEER_ADDITIONAL_CHEER_ABILITY_ID
    );
    expect(revealResult.gameState.activeEffect?.selectableCardIds).toEqual([
      movableInitialCheer.instanceId,
    ]);

    const displaying = confirmActiveEffectStep(
      revealResult.gameState,
      P1,
      revealResult.gameState.activeEffect!.id,
      undefined,
      undefined,
      undefined,
      undefined,
      [movableInitialCheer.instanceId]
    );
    const resolved = confirmActiveEffectStep(displaying, P1, displaying.activeEffect!.id);

    expect(resolved.players[0].waitingRoom.cardIds).toContain(movableInitialCheer.instanceId);
    expect(resolved.resolutionZone.revealedCardIds).toEqual([additionalDrawCheer.instanceId]);
    expect(resolved.players[0].hand.cardIds).toEqual([additionalDrawn.instanceId]);
    expect(resolved.players[0].mainDeck.cardIds).toEqual([sentinel.instanceId]);

    const judgmentResult = service.processAction(resolved, {
      type: 'CONFIRM_JUDGMENT',
      playerId: P1,
      judgmentResults: new Map(),
      timestamp: 1,
    });
    expect(judgmentResult.success).toBe(true);
    expect(judgmentResult.gameState.players[0].hand.cardIds).toEqual([additionalDrawn.instanceId]);
    expect(judgmentResult.gameState.players[0].mainDeck.cardIds).toEqual([sentinel.instanceId]);
  });
});
