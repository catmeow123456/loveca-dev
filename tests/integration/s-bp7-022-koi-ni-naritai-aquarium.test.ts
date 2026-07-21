import { describe, expect, it } from 'vitest';
import type { LiveCardData, MemberCardData } from '../../src/domain/entities/card';
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
  type PendingAbilityState,
} from '../../src/domain/entities/game';
import { addCardToStatefulZone, removeCardFromStatefulZone } from '../../src/domain/entities/zone';
import { createCheerEvent } from '../../src/domain/events/game-events';
import {
  ABILITY_ORDER_SELECTION_ID,
  confirmActiveEffectStep,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import { S_BP7_022_LIVE_SUCCESS_DISTINCT_AQOURS_RED_GREEN_BLUE_CHEER_SCORE_ABILITY_ID } from '../../src/application/card-effects/ability-ids';
import { GameService } from '../../src/application/game-service';
import { CardType, HeartColor, TriggerCondition } from '../../src/shared/types/enums';

const P1 = 'p1';
const P2 = 'p2';
const ABILITY_ID =
  S_BP7_022_LIVE_SUCCESS_DISTINCT_AQOURS_RED_GREEN_BLUE_CHEER_SCORE_ABILITY_ID;

function member(
  id: string,
  hearts: readonly HeartColor[],
  options: { readonly ownerId?: string; readonly groupNames?: readonly string[] } = {}
) {
  const data: MemberCardData = {
    cardCode: id,
    name: id,
    groupNames: options.groupNames ?? ['Aqours'],
    cardType: CardType.MEMBER,
    cost: 1,
    blade: 1,
    hearts: hearts.map((color) => createHeartIcon(color, 1)),
  };
  return createCardInstance(data, options.ownerId ?? P1, id);
}

function sourceLive() {
  const data: LiveCardData = {
    cardCode: 'PL!S-bp7-022-SECL',
    name: '想在水族馆恋爱',
    groupNames: ['Aqours'],
    cardType: CardType.LIVE,
    score: 8,
    requirements: createHeartRequirement({ [HeartColor.RAINBOW]: 1 }),
  };
  return createCardInstance(data, P1, 'source-live');
}

function pending(id = 'pending'): PendingAbilityState {
  return {
    id,
    abilityId: ABILITY_ID,
    sourceCardId: 'source-live',
    controllerId: P1,
    mandatory: true,
    timingId: TriggerCondition.ON_LIVE_SUCCESS,
  };
}

function setup(options: {
  readonly normal?: readonly ReturnType<typeof member>[];
  readonly additional?: readonly ReturnType<typeof member>[];
  readonly opponent?: readonly ReturnType<typeof member>[];
  readonly currentIds?: readonly string[];
  readonly keepInResolution?: boolean;
}) {
  const source = sourceLive();
  const normal = options.normal ?? [];
  const additional = options.additional ?? [];
  const opponent = options.opponent ?? [];
  const all = [source, ...normal, ...additional, ...opponent];
  let game = registerCards(createGameState('s-bp7-022', P1, 'P1', P2, 'P2'), all);
  game = updatePlayer(game, P1, (player) => ({
    ...player,
    liveZone: addCardToStatefulZone(player.liveZone, source.instanceId),
  }));
  const currentIds = options.currentIds ?? [...normal, ...additional].map((card) => card.instanceId);
  game = {
    ...game,
    liveResolution: {
      ...game.liveResolution,
      firstPlayerCheerCardIds: currentIds,
      secondPlayerCheerCardIds: opponent.map((card) => card.instanceId),
    },
    resolutionZone:
      options.keepInResolution === false
        ? game.resolutionZone
        : {
            ...game.resolutionZone,
            cardIds: [...currentIds, ...opponent.map((card) => card.instanceId)],
            revealedCardIds: [...currentIds, ...opponent.map((card) => card.instanceId)],
          },
  };
  if (normal.length > 0) {
    game = emitGameEvent(
      game,
      createCheerEvent(P1, normal.map((card) => card.instanceId), normal.length)
    );
  }
  if (additional.length > 0) {
    game = emitGameEvent(
      game,
      createCheerEvent(P1, additional.map((card) => card.instanceId), additional.length, {
        additional: true,
      })
    );
  }
  if (opponent.length > 0) {
    game = emitGameEvent(
      game,
      createCheerEvent(P2, opponent.map((card) => card.instanceId), opponent.length)
    );
  }
  return { source, game: { ...game, pendingAbilities: [pending()] } };
}

function confirm(game: GameState): GameState {
  const waiting = resolvePendingCardEffects(game).gameState;
  expect(waiting.activeEffect?.metadata?.confirmOnlyPendingAbility).toBe(true);
  return confirmActiveEffectStep(waiting, P1, waiting.activeEffect!.id);
}

function modifiers(game: GameState) {
  return game.liveResolution.liveModifiers.filter(
    (modifier) => modifier.kind === 'SCORE' && modifier.abilityId === ABILITY_ID
  );
}

function lastResolve(game: GameState) {
  return game.actionHistory.findLast(
    (action) => action.type === 'RESOLVE_ABILITY' && action.payload.abilityId === ABILITY_ID
  );
}

describe('PL!S-bp7-022-SECL 分数8「想在水族馆恋爱」 LIVE_SUCCESS', () => {
  it('adds this-LIVE SCORE +1 for three distinct Aqours members covering red/green/blue', () => {
    const scenario = setup({
      normal: [
        member('red', [HeartColor.RED]),
        member('green', [HeartColor.GREEN]),
        member('blue', [HeartColor.BLUE]),
      ],
    });
    const done = confirm(scenario.game);
    expect(modifiers(done)).toEqual([
      expect.objectContaining({
        kind: 'SCORE',
        playerId: P1,
        countDelta: 1,
        liveCardId: scenario.source.instanceId,
        sourceCardId: scenario.source.instanceId,
        abilityId: ABILITY_ID,
      }),
    ]);
    expect(done.liveResolution.playerScores.get(P1)).toBe(1);
    expect(lastResolve(done)?.payload).toMatchObject({
      redCandidateCount: 1,
      greenCandidateCount: 1,
      blueCandidateCount: 1,
      conditionMet: true,
      matchedCardIds: ['red', 'green', 'blue'],
      scoreBonus: 1,
    });
  });

  it('lets additional cheer fill the missing color and keeps moved-out current facts eligible', () => {
    const done = confirm(
      setup({
        normal: [member('red', [HeartColor.RED]), member('green', [HeartColor.GREEN])],
        additional: [member('blue', [HeartColor.BLUE])],
        keepInResolution: false,
      }).game
    );
    expect(modifiers(done)).toHaveLength(1);
    expect(lastResolve(done)?.payload).toMatchObject({ conditionMet: true, scoreBonus: 1 });
  });

  it('uses only the current rerolled cheer set and excludes replaced old facts', () => {
    const oldRed = member('old-red', [HeartColor.RED]);
    const currentGreen = member('current-green', [HeartColor.GREEN]);
    const currentBlue = member('current-blue', [HeartColor.BLUE]);
    let scenario = setup({
      normal: [oldRed, currentGreen, currentBlue],
      currentIds: [currentGreen.instanceId, currentBlue.instanceId],
      keepInResolution: false,
    });
    scenario = {
      ...scenario,
      game: emitGameEvent(
        scenario.game,
        createCheerEvent(P1, [currentGreen.instanceId, currentBlue.instanceId], 2)
      ),
    };
    const done = confirm(scenario.game);
    expect(lastResolve(done)?.payload).toMatchObject({
      redCandidateCount: 0,
      conditionMet: false,
      scoreBonus: 0,
    });
    expect(modifiers(done)).toEqual([]);
  });

  it('ignores opponent cheer and rejects a single tri-color member', () => {
    const done = confirm(
      setup({
        normal: [member('tri-color', [HeartColor.RED, HeartColor.GREEN, HeartColor.BLUE])],
        opponent: [
          member('opp-red', [HeartColor.RED], { ownerId: P2 }),
          member('opp-green', [HeartColor.GREEN], { ownerId: P2 }),
          member('opp-blue', [HeartColor.BLUE], { ownerId: P2 }),
        ],
      }).game
    );
    expect(lastResolve(done)?.payload).toMatchObject({ conditionMet: false, scoreBonus: 0 });
    expect(modifiers(done)).toEqual([]);
  });

  it('replaces by delta without accumulating and removes a stale replacement when condition fails', () => {
    const qualifying = setup({
      normal: [
        member('red', [HeartColor.RED]),
        member('green', [HeartColor.GREEN]),
        member('blue', [HeartColor.BLUE]),
      ],
    });
    let game: GameState = {
      ...qualifying.game,
      liveResolution: {
        ...qualifying.game.liveResolution,
        playerScores: new Map([[P1, 1]]),
        liveModifiers: [
          {
            kind: 'SCORE',
            playerId: P1,
            countDelta: 1,
            liveCardId: qualifying.source.instanceId,
            sourceCardId: qualifying.source.instanceId,
            abilityId: ABILITY_ID,
          },
        ],
      },
    };
    const repeated = confirm(game);
    expect(modifiers(repeated)).toHaveLength(1);
    expect(repeated.liveResolution.playerScores.get(P1)).toBe(1);

    game = {
      ...repeated,
      pendingAbilities: [pending('replacement-fails')],
      liveResolution: {
        ...repeated.liveResolution,
        firstPlayerCheerCardIds: ['red'],
      },
    };
    const removed = confirm(game);
    expect(modifiers(removed)).toEqual([]);
    expect(removed.liveResolution.playerScores.get(P1)).toBe(0);
  });

  it('previews no score and clears its old replacement if the exact source left before confirm-only opens', () => {
    const scenario = setup({
      normal: [
        member('red', [HeartColor.RED]),
        member('green', [HeartColor.GREEN]),
        member('blue', [HeartColor.BLUE]),
      ],
    });
    let game: GameState = updatePlayer(scenario.game, P1, (player) => ({
      ...player,
      liveZone: removeCardFromStatefulZone(player.liveZone, scenario.source.instanceId),
    }));
    game = {
      ...game,
      liveResolution: {
        ...game.liveResolution,
        playerScores: new Map([[P1, 1]]),
        liveModifiers: [
          {
            kind: 'SCORE',
            playerId: P1,
            countDelta: 1,
            liveCardId: scenario.source.instanceId,
            sourceCardId: scenario.source.instanceId,
            abilityId: ABILITY_ID,
          },
        ],
      },
    };
    const waiting = resolvePendingCardEffects(game).gameState;
    expect(waiting.activeEffect?.metadata?.confirmOnlyPendingAbility).toBe(true);
    expect(waiting.activeEffect?.effectText).toContain('可完成匹配');
    expect(waiting.activeEffect?.effectText).toContain('本次实际不增加[スコア]');
    expect(waiting.activeEffect?.effectText).not.toContain('实际此LIVE[スコア]+1');
    expect(waiting.activeEffect?.effectText).not.toMatch(
      /来源|LIVE区|source|stale|pending|payload|eventId|resolutionZone/
    );
    expect(modifiers(waiting)).toHaveLength(1);
    expect(waiting.liveResolution.playerScores.get(P1)).toBe(1);

    const done = confirmActiveEffectStep(waiting, P1, waiting.activeEffect!.id);
    expect(modifiers(done)).toEqual([]);
    expect(done.liveResolution.playerScores.get(P1)).toBe(0);
    expect(lastResolve(done)?.payload).toMatchObject({ conditionMet: false, scoreBonus: 0 });
    expect(done.pendingAbilities).toEqual([]);
    expect(done.activeEffect).toBeNull();
  });

  it('uses one confirm-only pending and displays realtime counts, distinct-card result, and actual score', () => {
    const waiting = resolvePendingCardEffects(
      setup({
        normal: [
          member('red', [HeartColor.RED]),
          member('green', [HeartColor.GREEN]),
          member('blue', [HeartColor.BLUE]),
        ],
      }).game
    ).gameState;
    expect(waiting.activeEffect?.metadata?.confirmOnlyPendingAbility).toBe(true);
    expect(waiting.activeEffect?.effectText).toContain('持有[赤ハート]的『Aqours』成员候选1张');
    expect(waiting.activeEffect?.effectText).toContain('需要三张不同卡');
    expect(waiting.activeEffect?.effectText).toContain('可完成匹配，实际此LIVE[スコア]+1');
    expect(waiting.activeEffect?.effectText).not.toMatch(/cardId|source|pending|payload|eventId|stale|resolutionZone/);
  });

  it('automatically continues an ordered batch when no new pending is created', () => {
    const scenario = setup({
      normal: [
        member('red', [HeartColor.RED]),
        member('green', [HeartColor.GREEN]),
        member('blue', [HeartColor.BLUE]),
      ],
    });
    const game = { ...scenario.game, pendingAbilities: [pending('a'), pending('b')] };
    const order = resolvePendingCardEffects(game).gameState;
    expect(order.activeEffect?.abilityId).toBe(ABILITY_ORDER_SELECTION_ID);
    const done = confirmActiveEffectStep(order, P1, order.activeEffect!.id, null, null, true);
    expect(done.pendingAbilities).toEqual([]);
    expect(done.activeEffect).toBeNull();
    expect(modifiers(done)).toHaveLength(1);
    expect(done.liveResolution.playerScores.get(P1)).toBe(1);
  });

  it('clears the modifier through the standard LIVE-end lifecycle', () => {
    const done = confirm(
      setup({
        normal: [
          member('red', [HeartColor.RED]),
          member('green', [HeartColor.GREEN]),
          member('blue', [HeartColor.BLUE]),
        ],
      }).game
    );
    const finalized = new GameService().finalizeLiveResult(done);
    expect(finalized.success).toBe(true);
    expect(finalized.gameState.liveResolution.liveModifiers).toEqual([]);
  });
});
