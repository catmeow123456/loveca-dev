import { describe, expect, it } from 'vitest';
import {
  createCardInstance,
  createHeartRequirement,
  type LiveCardData,
} from '../../src/domain/entities/card';
import {
  createGameState,
  registerCards,
  updatePlayer,
  type GameState,
  type PendingAbilityState,
} from '../../src/domain/entities/game';
import { addCardToStatefulZone } from '../../src/domain/entities/zone';
import {
  addSuccessLivePlacementRestrictionUntilLiveEnd,
  getSuccessLiveSelectionCandidateIds,
} from '../../src/domain/rules/success-live-placement';
import {
  ABILITY_ORDER_SELECTION_ID,
  confirmActiveEffectStep,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import { createGameSession } from '../../src/application/game-session';
import {
  createConfirmStepCommand,
  createSelectSuccessLiveCommand,
} from '../../src/application/game-commands';
import { PL_S_PB1_022_LIVE_SUCCESS_TIED_SCORE_PROHIBIT_SUCCESS_ZONE_ABILITY_ID } from '../../src/application/card-effects/ability-ids';
import { CardType, GamePhase, HeartColor, SubPhase, TriggerCondition } from '../../src/shared/types/enums';

const PLAYER1 = 'p1';
const PLAYER2 = 'p2';

function live(cardCode: string, score: number, name = cardCode): LiveCardData {
  return {
    cardCode,
    name,
    cardType: CardType.LIVE,
    score,
    requirements: createHeartRequirement({ [HeartColor.BLUE]: 1 }),
  };
}

function pending(sourceCardId: string, id = 's-pb1-022-pending'): PendingAbilityState {
  return {
    id,
    abilityId: PL_S_PB1_022_LIVE_SUCCESS_TIED_SCORE_PROHIBIT_SUCCESS_ZONE_ABILITY_ID,
    sourceCardId,
    controllerId: PLAYER1,
    mandatory: true,
    timingId: TriggerCondition.ON_LIVE_SUCCESS,
    eventIds: [`event:${id}`],
  };
}

function setupSettlement(options: {
  readonly firstScore: number;
  readonly secondScore: number;
  readonly withRestriction?: boolean;
  readonly secondOwnSource?: boolean;
}): {
  readonly game: GameState;
  readonly p1LiveId: string;
  readonly p1SecondLiveId: string | null;
  readonly p2LiveId: string;
} {
  const p1Live = createCardInstance(
    live('PL!S-pb1-022-L', 2, '逃走迷走メビウスループ'),
    PLAYER1,
    'p1-mobius-loop'
  );
  const p1SecondLive = options.secondOwnSource
    ? createCardInstance(
        live('PL!S-pb1-022-L＋', 2, '逃走迷走メビウスループ'),
        PLAYER1,
        'p1-mobius-loop-2'
      )
    : null;
  const p2Live = createCardInstance(live('PL!S-test-live', 2), PLAYER2, 'p2-live');
  let game = registerCards(
    createGameState('s-pb1-022-settlement', PLAYER1, 'P1', PLAYER2, 'P2'),
    [p1Live, ...(p1SecondLive ? [p1SecondLive] : []), p2Live]
  );
  game = updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    liveZone: p1SecondLive
      ? addCardToStatefulZone(
          addCardToStatefulZone(player.liveZone, p1Live.instanceId),
          p1SecondLive.instanceId
        )
      : addCardToStatefulZone(player.liveZone, p1Live.instanceId),
  }));
  game = updatePlayer(game, PLAYER2, (player) => ({
    ...player,
    liveZone: addCardToStatefulZone(player.liveZone, p2Live.instanceId),
  }));
  const liveResults = new Map<string, boolean>([
    [p1Live.instanceId, true],
    [p2Live.instanceId, true],
  ]);
  if (p1SecondLive) {
    liveResults.set(p1SecondLive.instanceId, true);
  }
  game = {
    ...game,
    currentPhase: GamePhase.LIVE_RESULT_PHASE,
    currentSubPhase: SubPhase.RESULT_SETTLEMENT,
    liveResolution: {
      ...game.liveResolution,
      liveResults,
      playerScores: new Map([
        [PLAYER1, options.firstScore],
        [PLAYER2, options.secondScore],
      ]),
      liveWinnerIds:
        options.firstScore === options.secondScore
          ? [PLAYER1, PLAYER2]
          : options.firstScore > options.secondScore
            ? [PLAYER1]
            : [PLAYER2],
    },
  };
  if (options.withRestriction) {
    game = addSuccessLivePlacementRestrictionUntilLiveEnd(game, {
      playerId: PLAYER1,
      sourceCardId: p1Live.instanceId,
      abilityId: PL_S_PB1_022_LIVE_SUCCESS_TIED_SCORE_PROHIBIT_SUCCESS_ZONE_ABILITY_ID,
    });
  }
  return {
    game,
    p1LiveId: p1Live.instanceId,
    p1SecondLiveId: p1SecondLive?.instanceId ?? null,
    p2LiveId: p2Live.instanceId,
  };
}

function sessionFromGame(game: GameState) {
  const session = createGameSession();
  session.createGame(game.gameId, PLAYER1, 'P1', PLAYER2, 'P2');
  (session as unknown as { authorityState: GameState }).authorityState = game;
  return session;
}

describe('PL!S-pb1-022 逃走迷走メビウスループ', () => {
  it('opens confirm-only text with current scores and registers the restriction after confirmation', () => {
    const { game, p1LiveId } = setupSettlement({
      firstScore: 4,
      secondScore: 4,
    });
    const pendingGame: GameState = {
      ...game,
      currentSubPhase: SubPhase.RESULT_FIRST_SUCCESS_EFFECTS,
      pendingAbilities: [pending(p1LiveId)],
    };

    const confirmation = resolvePendingCardEffects(pendingGame).gameState;

    expect(confirmation.activeEffect?.metadata?.confirmOnlyPendingAbility).toBe(true);
    expect(confirmation.activeEffect?.effectText).toContain('当前分数 4:4');
    expect(confirmation.activeEffect?.effectText).toContain('分数相同');
    expect(confirmation.activeEffect?.effectText).toContain('将限制双方放置成功LIVE');

    const resolved = confirmActiveEffectStep(
      confirmation,
      PLAYER1,
      confirmation.activeEffect!.id
    );

    expect(resolved.liveResolution.successLivePlacementRestrictions).toHaveLength(1);
    expect(resolved.liveResolution.successLivePlacementRestrictions[0]).toMatchObject({
      sourceCardId: p1LiveId,
      abilityId: PL_S_PB1_022_LIVE_SUCCESS_TIED_SCORE_PROHIBIT_SUCCESS_ZONE_ABILITY_ID,
      appliesWhen: 'TIED_LIVE_SCORE',
      expiresAt: 'LIVE_END',
    });
  });

  it('resolves same-timing queue in order without opening confirm-only prompts', () => {
    const { game, p1LiveId, p1SecondLiveId } = setupSettlement({
      firstScore: 4,
      secondScore: 4,
      secondOwnSource: true,
    });
    const secondLiveId = p1SecondLiveId!;
    const pendingGame: GameState = {
      ...game,
      currentSubPhase: SubPhase.RESULT_FIRST_SUCCESS_EFFECTS,
      pendingAbilities: [pending(p1LiveId), pending(secondLiveId, 's-pb1-022-pending-2')],
    };

    const orderSelection = resolvePendingCardEffects(pendingGame).gameState;
    expect(orderSelection.activeEffect?.abilityId).toBe(ABILITY_ORDER_SELECTION_ID);

    const resolved = confirmActiveEffectStep(
      orderSelection,
      PLAYER1,
      orderSelection.activeEffect!.id,
      null,
      null,
      true
    );

    expect(resolved.activeEffect).toBeNull();
    expect(resolved.pendingAbilities).toEqual([]);
    expect(
      resolved.liveResolution.successLivePlacementRestrictions.map(
        (restriction) => restriction.sourceCardId
      )
    ).toEqual([p1LiveId, secondLiveId]);
  });

  it('opens confirm-only before resolving a manually selected same-timing pending ability', () => {
    const { game, p1LiveId, p1SecondLiveId } = setupSettlement({
      firstScore: 4,
      secondScore: 4,
      secondOwnSource: true,
    });
    const secondLiveId = p1SecondLiveId!;
    const pendingGame: GameState = {
      ...game,
      currentSubPhase: SubPhase.RESULT_FIRST_SUCCESS_EFFECTS,
      pendingAbilities: [pending(p1LiveId), pending(secondLiveId, 's-pb1-022-pending-2')],
    };
    const orderSelection = resolvePendingCardEffects(pendingGame).gameState;

    const preview = confirmActiveEffectStep(
      orderSelection,
      PLAYER1,
      orderSelection.activeEffect!.id,
      p1LiveId
    );

    expect(preview.activeEffect).toMatchObject({
      abilityId: PL_S_PB1_022_LIVE_SUCCESS_TIED_SCORE_PROHIBIT_SUCCESS_ZONE_ABILITY_ID,
      sourceCardId: p1LiveId,
      metadata: { confirmOnlyPendingAbility: true },
    });
    expect(preview.liveResolution.successLivePlacementRestrictions).toHaveLength(0);

    const afterFirst = confirmActiveEffectStep(preview, PLAYER1, preview.activeEffect!.id);

    expect(afterFirst.liveResolution.successLivePlacementRestrictions).toHaveLength(1);
    expect(afterFirst.liveResolution.successLivePlacementRestrictions[0]?.sourceCardId).toBe(
      p1LiveId
    );
    expect(afterFirst.activeEffect).toMatchObject({
      sourceCardId: secondLiveId,
      metadata: { confirmOnlyPendingAbility: true },
    });
  });

  it('prevents both players from selecting success LIVE when scores are tied after resolution', () => {
    const { game, p1LiveId, p2LiveId } = setupSettlement({
      firstScore: 5,
      secondScore: 5,
      withRestriction: true,
    });
    const session = sessionFromGame(game);

    expect(getSuccessLiveSelectionCandidateIds(game, PLAYER1)).toEqual([]);
    expect(getSuccessLiveSelectionCandidateIds(game, PLAYER2)).toEqual([]);
    expect(session.executeCommand(createSelectSuccessLiveCommand(PLAYER1, p1LiveId)).success).toBe(
      false
    );

    const skipP1 = session.executeCommand(
      createConfirmStepCommand(PLAYER1, SubPhase.RESULT_SETTLEMENT, {
        skipSuccessLiveSelection: true,
      })
    );
    expect(skipP1.success).toBe(true);
    expect(skipP1.gameState.liveResolution.settlementConfirmedBy).toContain(PLAYER1);

    const p2Select = session.executeCommand(createSelectSuccessLiveCommand(PLAYER2, p2LiveId));
    expect(p2Select.success).toBe(false);
    expect(p2Select.error).toContain('不能放置入成功LIVE卡区');
  });

  it('does not restrict success LIVE placement before the ability resolves', () => {
    const { game, p1LiveId } = setupSettlement({
      firstScore: 5,
      secondScore: 5,
    });
    const session = sessionFromGame(game);

    expect(getSuccessLiveSelectionCandidateIds(game, PLAYER1)).toEqual([p1LiveId]);
    const result = session.executeCommand(createSelectSuccessLiveCommand(PLAYER1, p1LiveId));

    expect(result.success).toBe(true);
    expect(result.gameState.players[0].successZone.cardIds).toContain(p1LiveId);
  });

  it('does not restrict success LIVE placement when scores are not tied', () => {
    const { game, p1LiveId } = setupSettlement({
      firstScore: 6,
      secondScore: 5,
      withRestriction: true,
    });
    const session = sessionFromGame(game);

    expect(getSuccessLiveSelectionCandidateIds(game, PLAYER1)).toEqual([p1LiveId]);
    const result = session.executeCommand(createSelectSuccessLiveCommand(PLAYER1, p1LiveId));

    expect(result.success).toBe(true);
    expect(result.gameState.players[0].successZone.cardIds).toContain(p1LiveId);
  });
});
