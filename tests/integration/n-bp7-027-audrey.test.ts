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
  type PendingAbilityState,
} from '../../src/domain/entities/game';
import { addCardToStatefulZone, placeCardInSlot } from '../../src/domain/entities/zone';
import {
  confirmActiveEffectStep,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import { N_BP7_027_LIVE_SUCCESS_SELECT_NIJIGASAKI_HIGHEST_BLADE_SCORE_ABILITY_ID } from '../../src/application/card-effects/ability-ids';
import { getCardAbilityDefinitionsForCardCode } from '../../src/application/card-effects/definitions/lookup';
import {
  CardAbilityCategory,
  CardAbilitySourceZone,
} from '../../src/application/card-effects/ability-definition-types';
import {
  CardType,
  FaceState,
  HeartColor,
  OrientationState,
  SlotPosition,
  TriggerCondition,
} from '../../src/shared/types/enums';

const P1 = 'p1';
const P2 = 'p2';
const ABILITY_ID = N_BP7_027_LIVE_SUCCESS_SELECT_NIJIGASAKI_HIGHEST_BLADE_SCORE_ABILITY_ID;
const SOURCE_ID = 'audrey-live';
const SLOTS = [SlotPosition.LEFT, SlotPosition.CENTER, SlotPosition.RIGHT] as const;

interface MemberSpec {
  readonly id: string;
  readonly blade: number;
  readonly group?: string;
  readonly orientation?: OrientationState;
}

function live(cardCode = 'PL!N-bp7-027-L'): LiveCardData {
  return {
    cardCode,
    name: 'オードリー / 奥黛丽',
    groupNames: ['虹ヶ咲'],
    cardType: CardType.LIVE,
    score: 2,
    requirements: createHeartRequirement({ [HeartColor.PINK]: 1 }),
  };
}

function member(spec: MemberSpec, ownerId: string) {
  const data: MemberCardData = {
    cardCode: spec.id,
    name: spec.id,
    groupNames: [spec.group ?? '虹ヶ咲'],
    cardType: CardType.MEMBER,
    cost: 1,
    blade: spec.blade,
    hearts: [createHeartIcon(HeartColor.PINK, 1)],
  };
  return createCardInstance(data, ownerId, spec.id);
}

function pending(id = 'audrey-pending'): PendingAbilityState {
  return {
    id,
    abilityId: ABILITY_ID,
    sourceCardId: SOURCE_ID,
    controllerId: P1,
    mandatory: true,
    timingId: TriggerCondition.ON_LIVE_SUCCESS,
  };
}

function setup(
  options: {
    readonly own?: readonly MemberSpec[];
    readonly opponent?: readonly MemberSpec[];
    readonly below?: MemberSpec;
    readonly sourceCode?: string;
  } = {}
) {
  const source = createCardInstance(live(options.sourceCode), P1, SOURCE_ID);
  const own = (options.own ?? []).map((spec) => ({ spec, card: member(spec, P1) }));
  const opponent = (options.opponent ?? []).map((spec) => ({ spec, card: member(spec, P2) }));
  const below = options.below ? member(options.below, P1) : null;
  let game = registerCards(createGameState('audrey', P1, 'P1', P2, 'P2'), [
    source,
    ...own.map(({ card }) => card),
    ...opponent.map(({ card }) => card),
    ...(below ? [below] : []),
  ]);
  game = updatePlayer(game, P1, (player) => ({
    ...player,
    liveZone: addCardToStatefulZone(player.liveZone, source.instanceId),
  }));
  for (const [index, { spec, card }] of own.entries()) {
    game = putTopLevel(game, P1, SLOTS[index]!, card.instanceId, spec.orientation);
  }
  for (const [index, { spec, card }] of opponent.entries()) {
    game = putTopLevel(game, P2, SLOTS[index]!, card.instanceId, spec.orientation);
  }
  if (below) {
    game = updatePlayer(game, P1, (player) => ({
      ...player,
      memberSlots: {
        ...player.memberSlots,
        memberBelow: {
          ...player.memberSlots.memberBelow,
          [SlotPosition.LEFT]: [below.instanceId],
        },
      },
    }));
  }
  return { game: { ...game, pendingAbilities: [pending()] }, source, own, opponent, below };
}

function putTopLevel(
  game: GameState,
  playerId: string,
  slot: SlotPosition,
  cardId: string | null,
  orientation = OrientationState.ACTIVE
): GameState {
  return updatePlayer(game, playerId, (player) => ({
    ...player,
    memberSlots: placeCardInSlot(
      player.memberSlots,
      slot,
      cardId,
      cardId ? { orientation, face: FaceState.FACE_UP } : undefined
    ),
  }));
}

function start(game: GameState): GameState {
  return resolvePendingCardEffects(game).gameState;
}

function choose(game: GameState, cardId: string): GameState {
  return confirmActiveEffectStep(game, P1, game.activeEffect!.id, cardId);
}

function scoreModifiers(game: GameState) {
  return game.liveResolution.liveModifiers.filter(
    (modifier) => modifier.kind === 'SCORE' && modifier.abilityId === ABILITY_ID
  );
}

function lastResolve(game: GameState) {
  return game.actionHistory
    .filter(
      (action) => action.type === 'RESOLVE_ABILITY' && action.payload.abilityId === ABILITY_ID
    )
    .at(-1);
}

function withModifiers(game: GameState, modifiers: readonly LiveModifierState[]): GameState {
  return {
    ...game,
    liveResolution: {
      ...game.liveResolution,
      liveModifiers: [...game.liveResolution.liveModifiers, ...modifiers],
    },
  };
}

describe('PL!N-bp7-027-L 分数2「オードリー / 奥黛丽」', () => {
  it('registers only the exact LIVE_SUCCESS ability identity', () => {
    expect(getCardAbilityDefinitionsForCardCode('PL!N-bp7-027-L')).toEqual([
      expect.objectContaining({
        abilityId: ABILITY_ID,
        cardCodes: ['PL!N-bp7-027-L'],
        category: CardAbilityCategory.LIVE_SUCCESS,
        sourceZone: CardAbilitySourceZone.LIVE_CARD,
        triggerCondition: TriggerCondition.ON_LIVE_SUCCESS,
        queued: true,
        implemented: true,
      }),
    ]);
    expect(
      getCardAbilityDefinitionsForCardCode('PL!N-bp7-027-L')[0]?.baseCardCodes
    ).toBeUndefined();
    for (const code of [
      'PL!N-bp7-027-P',
      'PL!N-bp7-027-SECL',
      'PL!N-bp7-026-L',
      'PL!N-bp7-028-L',
    ]) {
      expect(getCardAbilityDefinitionsForCardCode(code)).toEqual([]);
    }
  });

  it('safely ends with no own Nijigasaki target and auto-resolves exactly one target', () => {
    const noTarget = start(setup({ own: [{ id: 'aqours', blade: 5, group: 'Aqours' }] }).game);
    expect(noTarget.pendingAbilities).toEqual([]);
    expect(noTarget.activeEffect).toBeNull();
    expect(scoreModifiers(noTarget)).toEqual([]);

    const single = setup({
      own: [{ id: 'target', blade: 3 }],
      opponent: [{ id: 'opp', blade: 2 }],
    });
    const done = start(single.game);
    expect(done.activeEffect).toBeNull();
    expect(scoreModifiers(done)).toEqual([
      expect.objectContaining({
        playerId: P1,
        liveCardId: SOURCE_ID,
        sourceCardId: SOURCE_ID,
        abilityId: ABILITY_ID,
        countDelta: 1,
      }),
    ]);
    expect(done.liveResolution.playerScores.get(P1)).toBe(1);
  });

  it('opens one public mandatory selection containing only own top-level Nijigasaki members', () => {
    const scenario = setup({
      own: [
        { id: 'target-a', blade: 4 },
        { id: 'non-niji', blade: 9, group: 'Aqours' },
        { id: 'target-b', blade: 3, orientation: OrientationState.WAITING },
      ],
      opponent: [{ id: 'opponent-niji', blade: 1 }],
      below: { id: 'below-niji', blade: 99 },
    });
    const waiting = start(scenario.game);
    expect(waiting.activeEffect).toMatchObject({
      abilityId: ABILITY_ID,
      selectableCardIds: ['target-a', 'target-b'],
      selectableCardVisibility: 'PUBLIC',
      selectableCardMode: 'SINGLE',
      canSkipSelection: false,
      confirmSelectionLabel: '选择成员并结算',
    });
    expect(waiting.activeEffect?.metadata?.confirmOnlyPendingAbility).toBeUndefined();
  });

  it.each([
    ['strictly higher than all', 5, 4, 3, true],
    ['tied with own other', 5, 5, 3, false],
    ['tied with opponent', 5, 4, 5, false],
    ['lower than own other', 5, 6, 3, false],
    ['lower than opponent', 5, 4, 6, false],
  ])(
    '%s uses strict comparison against both stages',
    (_label, target, ownOther, opponent, expected) => {
      const scenario = setup({
        own: [
          { id: 'target', blade: target },
          { id: 'own-other', blade: ownOther },
        ],
        opponent: [{ id: 'opponent', blade: opponent }],
      });
      const done = choose(start(scenario.game), 'target');
      expect(scoreModifiers(done)).toHaveLength(expected ? 1 : 0);
      expect(lastResolve(done)?.payload).toMatchObject({
        targetMemberCardId: 'target',
        targetBlade: target,
        conditionMet: expected,
        scoreBonus: expected ? 1 : 0,
        ownOtherMembers: [{ playerId: P1, memberCardId: 'own-other', blade: ownOther }],
        opponentMembers: [{ playerId: P2, memberCardId: 'opponent', blade: opponent }],
      });
    }
  );

  it('treats the empty comparison set as true and includes WAITING members in comparisons', () => {
    const only = start(setup({ own: [{ id: 'only', blade: 0 }] }).game);
    expect(scoreModifiers(only)).toHaveLength(1);

    const waitingOther = setup({
      own: [
        { id: 'target', blade: 2 },
        { id: 'waiting-other', blade: 3, orientation: OrientationState.WAITING },
      ],
    });
    const failed = choose(start(waitingOther.game), 'target');
    expect(scoreModifiers(failed)).toEqual([]);
  });

  it('uses one current modifier snapshot for bonuses and original-BLADE replacement', () => {
    const bonusScenario = setup({
      own: [
        { id: 'target', blade: 1 },
        { id: 'other', blade: 2 },
      ],
      opponent: [{ id: 'opponent', blade: 2 }],
    });
    const bonusGame = withModifiers(bonusScenario.game, [
      {
        kind: 'BLADE',
        playerId: P1,
        countDelta: 2,
        sourceCardId: 'bonus-source',
        targetMemberCardId: 'target',
        abilityId: 'bonus-ability',
      },
    ]);
    expect(scoreModifiers(choose(start(bonusGame), 'target'))).toHaveLength(1);

    const replacementScenario = setup({
      own: [
        { id: 'target', blade: 1 },
        { id: 'other', blade: 3 },
      ],
    });
    const replacementGame = withModifiers(replacementScenario.game, [
      {
        kind: 'MEMBER_ORIGINAL_BLADE_REPLACEMENT',
        playerId: P1,
        memberCardId: 'target',
        count: 4,
        sourceCardId: 'replacement-source',
        abilityId: 'replacement-ability',
      },
    ]);
    expect(scoreModifiers(choose(start(replacementGame), 'target'))).toHaveLength(1);
  });

  it('re-evaluates changed BLADE values when the selection is confirmed', () => {
    const scenario = setup({
      own: [
        { id: 'target', blade: 1 },
        { id: 'other', blade: 2 },
      ],
    });
    const waiting = start(scenario.game);
    const changed = withModifiers(waiting, [
      {
        kind: 'BLADE',
        playerId: P1,
        countDelta: 2,
        sourceCardId: 'late-source',
        targetMemberCardId: 'target',
        abilityId: 'late-bonus',
      },
    ]);
    const done = choose(changed, 'target');
    expect(lastResolve(done)?.payload).toMatchObject({ targetBlade: 3, conditionMet: true });
  });

  it('follows the same target instance across slots', () => {
    const scenario = setup({
      own: [
        { id: 'target', blade: 4 },
        { id: 'other', blade: 1 },
      ],
    });
    let waiting = start(scenario.game);
    waiting = putTopLevel(waiting, P1, SlotPosition.LEFT, null);
    waiting = putTopLevel(waiting, P1, SlotPosition.RIGHT, 'target');
    const done = choose(waiting, 'target');
    expect(scoreModifiers(done)).toHaveLength(1);
    expect(lastResolve(done)?.payload).toMatchObject({
      targetMemberCardId: 'target',
      conditionMet: true,
    });
  });

  it.each(['leaves', 'replaced', 'memberBelow', 'sourceLeaves'])(
    'consumes the window as a safe no-op when the selected target/source %s',
    (change) => {
      const scenario = setup({
        own: [
          { id: 'target', blade: 4 },
          { id: 'other', blade: 1 },
        ],
      });
      let waiting = start(scenario.game);
      if (change === 'sourceLeaves') {
        waiting = updatePlayer(waiting, P1, (player) => ({
          ...player,
          liveZone: { ...player.liveZone, cardIds: [] },
        }));
      } else {
        waiting = putTopLevel(waiting, P1, SlotPosition.LEFT, null);
        if (change === 'replaced') {
          const replacement = member({ id: 'replacement', blade: 2 }, P1);
          waiting = registerCards(waiting, [replacement]);
          waiting = putTopLevel(waiting, P1, SlotPosition.LEFT, replacement.instanceId);
        }
        if (change === 'memberBelow') {
          waiting = updatePlayer(waiting, P1, (player) => ({
            ...player,
            memberSlots: {
              ...player.memberSlots,
              memberBelow: {
                ...player.memberSlots.memberBelow,
                [SlotPosition.CENTER]: ['target'],
              },
            },
          }));
        }
      }
      const done = choose(waiting, 'target');
      expect(done.activeEffect).toBeNull();
      expect(scoreModifiers(done)).toEqual([]);
      expect(lastResolve(done)?.payload).toMatchObject({
        step: 'STALE_SOURCE_OR_TARGET',
        conditionMet: false,
        scoreBonus: 0,
      });
    }
  );

  it('rejects a forged target without changing the window and ignores repeated confirmation', () => {
    const scenario = setup({
      own: [
        { id: 'target', blade: 4 },
        { id: 'other', blade: 1 },
      ],
    });
    const waiting = start(scenario.game);
    const forged = choose(waiting, 'not-selectable');
    expect(forged).toEqual(waiting);

    const done = choose(waiting, 'target');
    const repeated = confirmActiveEffectStep(done, P1, waiting.activeEffect!.id, 'target');
    expect(repeated).toEqual(done);
    expect(scoreModifiers(repeated)).toHaveLength(1);
    expect(repeated.liveResolution.playerScores.get(P1)).toBe(1);
  });

  it('preserves other SCORE modifiers and replaces its own score by delta', () => {
    const scenario = setup({
      own: [
        { id: 'target', blade: 4 },
        { id: 'other', blade: 1 },
      ],
    });
    const existing: LiveModifierState = {
      kind: 'SCORE',
      playerId: P1,
      countDelta: 2,
      liveCardId: SOURCE_ID,
      sourceCardId: 'other-source',
      abilityId: 'other-score-ability',
    };
    const game = {
      ...withModifiers(scenario.game, [existing]),
      liveResolution: {
        ...withModifiers(scenario.game, [existing]).liveResolution,
        playerScores: new Map([[P1, 2]]),
      },
    };
    const done = choose(start(game), 'target');
    expect(done.liveResolution.liveModifiers).toContainEqual(existing);
    expect(scoreModifiers(done)).toHaveLength(1);
    expect(done.liveResolution.playerScores.get(P1)).toBe(3);
  });

  it('consumes an invalid exact source at start and preserves orderedResolution on the real window', () => {
    const invalid = start(
      setup({ own: [{ id: 'target', blade: 4 }], sourceCode: 'PL!N-bp7-027-P' }).game
    );
    expect(invalid.pendingAbilities).toEqual([]);
    expect(invalid.activeEffect).toBeNull();
    expect(lastResolve(invalid)?.payload).toMatchObject({ step: 'SOURCE_INVALID' });

    const scenario = setup({
      own: [
        { id: 'target', blade: 4 },
        { id: 'other', blade: 1 },
      ],
    });
    const orderWindow = start({
      ...scenario.game,
      pendingAbilities: [pending('ordered-a'), pending('ordered-b')],
    });
    expect(orderWindow.activeEffect?.canResolveInOrder).toBe(true);
    const ordered = confirmActiveEffectStep(
      orderWindow,
      P1,
      orderWindow.activeEffect!.id,
      null,
      null,
      true
    );
    expect(ordered.activeEffect?.metadata?.orderedResolution).toBe(true);
    const afterFirst = choose(ordered, 'target');
    expect(afterFirst.activeEffect?.metadata?.orderedResolution).toBe(true);
    const done = choose(afterFirst, 'target');
    expect(done.pendingAbilities).toEqual([]);
    expect(done.activeEffect).toBeNull();
    expect(scoreModifiers(done)).toHaveLength(1);
    expect(done.liveResolution.playerScores.get(P1)).toBe(1);
    expect(
      done.actionHistory.filter(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId === ABILITY_ID &&
          action.payload.targetMemberCardId === 'target'
      )
    ).toHaveLength(2);
  });
});
