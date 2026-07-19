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
import { addCardToZone, placeCardInSlot } from '../../src/domain/entities/zone';
import {
  confirmActiveEffectStep,
  enqueueTriggeredCardEffects,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import {
  PL_BP4_014_LIVE_START_LIVE_WITHOUT_TIMING_TARGET_OTHER_MEMBER_GAIN_TWO_BLADE_ABILITY_ID,
  PL_BP4_024_LIVE_START_TARGET_MUSE_MEMBER_GAIN_ONE_BLADE_ABILITY_ID,
  S_BP2_025_LIVE_START_SUCCESS_TWO_TARGET_MEMBER_GAIN_TWO_BLADE_ABILITY_ID,
} from '../../src/application/card-effects/ability-ids';
import { getCardAbilityDefinitionsForCardCode } from '../../src/application/card-effects/definitions/lookup';
import { clearPreviousStageMemberInstanceState } from '../../src/application/effects/member-state';
import {
  CardType,
  FaceState,
  HeartColor,
  OrientationState,
  SlotPosition,
  TriggerCondition,
} from '../../src/shared/types/enums';
import { parseCardEffectText } from '../../client/src/lib/cardEffectTokens';

const PLAYER1 = 'player1';
const PLAYER2 = 'player2';

function live(
  cardCode: string,
  name = cardCode,
  options: { readonly cardText?: string; readonly groupNames?: readonly string[] } = {}
): LiveCardData {
  return {
    cardCode,
    name,
    cardType: CardType.LIVE,
    score: 1,
    requirements: createHeartRequirement({ [HeartColor.PINK]: 1 }),
    cardText: options.cardText,
    groupNames: options.groupNames,
  };
}

function member(
  cardCode: string,
  name = cardCode,
  groupNames: readonly string[] = []
): MemberCardData {
  return {
    cardCode,
    name,
    groupNames,
    cardType: CardType.MEMBER,
    cost: 4,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.PINK, 1)],
  };
}

function pending(abilityId: string, sourceCardId: string, suffix = 'first'): PendingAbilityState {
  return {
    id: `${abilityId}:${suffix}`,
    abilityId,
    sourceCardId,
    controllerId: PLAYER1,
    mandatory: true,
    timingId: TriggerCondition.ON_LIVE_START,
    eventIds: ['live-start-event'],
  };
}

function bladeModifiers(game: GameState, abilityId: string) {
  return game.liveResolution.liveModifiers.filter(
    (modifier) => modifier.kind === 'BLADE' && modifier.abilityId === abilityId
  );
}

function start(game: GameState): GameState {
  return resolvePendingCardEffects(game).gameState;
}

function choose(game: GameState, selectedCardId: string | null): GameState {
  return confirmActiveEffectStep(
    game,
    PLAYER1,
    game.activeEffect!.id,
    selectedCardId,
    null,
    false,
    null
  );
}

function addMainStageMember(
  game: GameState,
  playerId: string,
  slot: SlotPosition,
  cardId: string,
  orientation: OrientationState
): GameState {
  return updatePlayer(game, playerId, (player) => ({
    ...player,
    memberSlots: placeCardInSlot(player.memberSlots, slot, cardId, {
      orientation,
      face: FaceState.FACE_UP,
    }),
  }));
}

function removeMainStageMember(game: GameState, playerId: string, slot: SlotPosition): GameState {
  return updatePlayer(game, playerId, (player) => ({
    ...player,
    memberSlots: placeCardInSlot(player.memberSlots, slot, null),
  }));
}

function setupAozora(
  options: { readonly targetCount?: number; readonly successCount?: number } = {}
) {
  const source = createCardInstance(live('PL!S-bp2-025-L', '青空Jumping Heart'), PLAYER1, 'aozora');
  const targets = [SlotPosition.LEFT, SlotPosition.CENTER, SlotPosition.RIGHT]
    .slice(0, options.targetCount ?? 2)
    .map((slot) => ({
      slot,
      card: createCardInstance(member(`PL!S-target-${slot}`), PLAYER1, `target-${slot}`),
    }));
  const successLives = Array.from({ length: options.successCount ?? 2 }, (_, index) =>
    createCardInstance(live(`PL!S-success-${index}`), PLAYER1, `success-${index}`)
  );
  let game = registerCards(createGameState('aozora', PLAYER1, 'P1', PLAYER2, 'P2'), [
    source,
    ...targets.map(({ card }) => card),
    ...successLives,
  ]);
  game = updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    liveZone: addCardToZone(player.liveZone, source.instanceId),
    successZone: successLives.reduce(
      (zone, card) => addCardToZone(zone, card.instanceId),
      player.successZone
    ),
  }));
  for (const { slot, card } of targets) {
    game = addMainStageMember(game, PLAYER1, slot, card.instanceId, OrientationState.ACTIVE);
  }
  return {
    game: {
      ...game,
      pendingAbilities: [
        pending(
          S_BP2_025_LIVE_START_SUCCESS_TWO_TARGET_MEMBER_GAIN_TWO_BLADE_ABILITY_ID,
          source.instanceId
        ),
      ],
    },
    sourceId: source.instanceId,
    targetIds: targets.map(({ card }) => card.instanceId),
  };
}

function setupRin(
  options: { readonly qualifyingText?: string; readonly includeTargets?: boolean } = {}
) {
  const source = createCardInstance(member('PL!-bp4-014-N', '星空 凛', ['μ’s']), PLAYER1, 'rin');
  const activeTarget = createCardInstance(
    member('PL!-target-active', 'active'),
    PLAYER1,
    'active-target'
  );
  const waitingTarget = createCardInstance(
    member('PL!-target-waiting', 'waiting'),
    PLAYER1,
    'waiting-target'
  );
  const below = createCardInstance(member('PL!-target-below', 'below'), PLAYER1, 'below-target');
  const opponent = createCardInstance(
    member('PL!-target-opponent', 'opponent'),
    PLAYER2,
    'opponent-target'
  );
  const qualifyingLive = createCardInstance(
    live('PL!-qualifying-live', 'qualifying', { cardText: options.qualifyingText }),
    PLAYER1,
    'qualifying-live'
  );
  let game = registerCards(createGameState('rin', PLAYER1, 'P1', PLAYER2, 'P2'), [
    source,
    activeTarget,
    waitingTarget,
    below,
    opponent,
    qualifyingLive,
  ]);
  game = addMainStageMember(
    game,
    PLAYER1,
    SlotPosition.CENTER,
    source.instanceId,
    OrientationState.ACTIVE
  );
  if (options.includeTargets !== false) {
    game = addMainStageMember(
      game,
      PLAYER1,
      SlotPosition.LEFT,
      activeTarget.instanceId,
      OrientationState.ACTIVE
    );
    game = addMainStageMember(
      game,
      PLAYER1,
      SlotPosition.RIGHT,
      waitingTarget.instanceId,
      OrientationState.WAITING
    );
  }
  game = updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    liveZone: addCardToZone(player.liveZone, qualifyingLive.instanceId),
    memberSlots: {
      ...player.memberSlots,
      memberBelow: {
        ...player.memberSlots.memberBelow,
        [SlotPosition.CENTER]: [below.instanceId],
      },
    },
  }));
  game = addMainStageMember(
    game,
    PLAYER2,
    SlotPosition.CENTER,
    opponent.instanceId,
    OrientationState.ACTIVE
  );
  return {
    game,
    sourceId: source.instanceId,
    activeTargetId: activeTarget.instanceId,
    waitingTargetId: waitingTarget.instanceId,
    belowId: below.instanceId,
    opponentId: opponent.instanceId,
    qualifyingLiveId: qualifyingLive.instanceId,
  };
}

function setupNightingale(options: { readonly includeSecondMuse?: boolean } = {}) {
  const source = createCardInstance(live('PL!-bp4-024-L', '小夜啼鳥恋詩'), PLAYER1, 'nightingale');
  const straightMuse = createCardInstance(
    member('PL!-muse-straight', 'muse straight', ["μ's"]),
    PLAYER1,
    'muse-straight'
  );
  const curlyMuse = createCardInstance(
    member('PL!-muse-curly', 'muse curly', ['μ’s']),
    PLAYER1,
    'muse-curly'
  );
  const nonMuse = createCardInstance(
    member('PL!-non-muse', 'non muse', ['Aqours']),
    PLAYER1,
    'non-muse'
  );
  const belowMuse = createCardInstance(
    member('PL!-below-muse', 'below muse', ['μ’s']),
    PLAYER1,
    'below-muse'
  );
  const opponentMuse = createCardInstance(
    member('PL!-opponent-muse', 'opponent muse', ['μ’s']),
    PLAYER2,
    'opponent-muse'
  );
  let game = registerCards(createGameState('nightingale', PLAYER1, 'P1', PLAYER2, 'P2'), [
    source,
    straightMuse,
    curlyMuse,
    nonMuse,
    belowMuse,
    opponentMuse,
  ]);
  game = updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    liveZone: addCardToZone(player.liveZone, source.instanceId),
  }));
  game = addMainStageMember(
    game,
    PLAYER1,
    SlotPosition.LEFT,
    straightMuse.instanceId,
    OrientationState.ACTIVE
  );
  game = addMainStageMember(
    game,
    PLAYER1,
    SlotPosition.CENTER,
    options.includeSecondMuse === false ? nonMuse.instanceId : curlyMuse.instanceId,
    OrientationState.WAITING
  );
  if (options.includeSecondMuse !== false) {
    game = addMainStageMember(
      game,
      PLAYER1,
      SlotPosition.RIGHT,
      nonMuse.instanceId,
      OrientationState.ACTIVE
    );
  }
  game = updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    memberSlots: {
      ...player.memberSlots,
      memberBelow: {
        ...player.memberSlots.memberBelow,
        [SlotPosition.LEFT]: [belowMuse.instanceId],
      },
    },
  }));
  game = addMainStageMember(
    game,
    PLAYER2,
    SlotPosition.CENTER,
    opponentMuse.instanceId,
    OrientationState.ACTIVE
  );
  return {
    game,
    sourceId: source.instanceId,
    straightMuseId: straightMuse.instanceId,
    curlyMuseId: curlyMuse.instanceId,
    nonMuseId: nonMuse.instanceId,
    belowMuseId: belowMuse.instanceId,
    opponentMuseId: opponentMuse.instanceId,
  };
}

describe('shared LIVE_START target-member gain-BLADE family', () => {
  it('preserves 青空Jumping Heart: 0 targets no-op, one target auto-resolves, and multiple targets open one real mandatory window', () => {
    const noTarget = start(setupAozora({ targetCount: 0 }).game);
    expect(noTarget.activeEffect).toBeNull();
    expect(noTarget.pendingAbilities).toEqual([]);

    const single = setupAozora({ targetCount: 1 });
    const singleResolved = start(single.game);
    expect(singleResolved.activeEffect).toBeNull();
    expect(
      bladeModifiers(
        singleResolved,
        S_BP2_025_LIVE_START_SUCCESS_TWO_TARGET_MEMBER_GAIN_TWO_BLADE_ABILITY_ID
      )
    ).toEqual([
      expect.objectContaining({
        sourceCardId: single.sourceId,
        targetMemberCardId: single.targetIds[0],
        countDelta: 2,
      }),
    ]);

    const multiple = setupAozora();
    const started = start(multiple.game);
    expect(started.activeEffect).toMatchObject({
      abilityId: S_BP2_025_LIVE_START_SUCCESS_TWO_TARGET_MEMBER_GAIN_TWO_BLADE_ABILITY_ID,
      selectableCardIds: multiple.targetIds,
      canSkipSelection: false,
      stepText: '请选择自己舞台上的1名成员获得[BLADE][BLADE]。',
    });
    expect(started.activeEffect?.metadata?.confirmOnlyPendingAbility).toBeUndefined();
    const resolved = choose(started, multiple.targetIds[1]);
    expect(
      bladeModifiers(
        resolved,
        S_BP2_025_LIVE_START_SUCCESS_TWO_TARGET_MEMBER_GAIN_TWO_BLADE_ABILITY_ID
      )
    ).toEqual([
      expect.objectContaining({
        sourceCardId: multiple.sourceId,
        targetMemberCardId: multiple.targetIds[1],
        countDelta: 2,
      }),
    ]);
  });

  it('keeps target-aware BLADE after the LIVE source leaves and clears it with the target instance', () => {
    const scenario = setupAozora({ targetCount: 1 });
    const applied = start(scenario.game);
    const sourceLeft = updatePlayer(applied, PLAYER1, (player) => ({
      ...player,
      liveZone: { ...player.liveZone, cardIds: [] },
    }));
    expect(
      bladeModifiers(
        sourceLeft,
        S_BP2_025_LIVE_START_SUCCESS_TWO_TARGET_MEMBER_GAIN_TWO_BLADE_ABILITY_ID
      )
    ).toHaveLength(1);

    const targetCleared = clearPreviousStageMemberInstanceState(
      sourceLeft,
      PLAYER1,
      scenario.targetIds[0]!
    );
    expect(
      bladeModifiers(
        targetCleared,
        S_BP2_025_LIVE_START_SUCCESS_TWO_TARGET_MEMBER_GAIN_TWO_BLADE_ABILITY_ID
      )
    ).toEqual([]);
  });

  it('preserves ordered continuation after a no-op first family pending', () => {
    const scenario = setupAozora({ successCount: 1 });
    const continuation = pending(
      S_BP2_025_LIVE_START_SUCCESS_TWO_TARGET_MEMBER_GAIN_TWO_BLADE_ABILITY_ID,
      'missing-source',
      'continuation'
    );
    const order = start({
      ...scenario.game,
      pendingAbilities: [...scenario.game.pendingAbilities, continuation],
    });
    expect(order.activeEffect?.canResolveInOrder).toBe(true);
    const resolved = confirmActiveEffectStep(
      order,
      PLAYER1,
      order.activeEffect!.id,
      null,
      null,
      true
    );
    expect(resolved.activeEffect).toBeNull();
    expect(resolved.pendingAbilities).toEqual([]);
  });

  it('keeps a forced window open for null, opponent, memberBelow, and unlisted input', () => {
    const scenario = setupRin();
    const queued = enqueueTriggeredCardEffects(scenario.game, [TriggerCondition.ON_LIVE_START]);
    const started = start(queued);
    for (const selected of [null, scenario.opponentId, scenario.belowId, 'unlisted']) {
      expect(choose(started, selected)).toBe(started);
    }
  });
});

describe('PL!-bp4-014-N 费用9「星空 凛」', () => {
  it('uses the real ON_LIVE_START enqueue entry and offers only ACTIVE/WAITING other main-stage members', () => {
    const scenario = setupRin({ qualifyingText: '【常时】此卡分数+1。' });
    const queued = enqueueTriggeredCardEffects(scenario.game, [TriggerCondition.ON_LIVE_START]);
    expect(queued.pendingAbilities).toContainEqual(
      expect.objectContaining({
        abilityId:
          PL_BP4_014_LIVE_START_LIVE_WITHOUT_TIMING_TARGET_OTHER_MEMBER_GAIN_TWO_BLADE_ABILITY_ID,
        sourceCardId: scenario.sourceId,
        timingId: TriggerCondition.ON_LIVE_START,
      })
    );
    const started = start(queued);
    expect(started.activeEffect).toMatchObject({
      selectableCardIds: [scenario.activeTargetId, scenario.waitingTargetId],
      canSkipSelection: false,
      stepText: '请选择自己舞台上的此成员以外的1名成员获得[ブレード][ブレード]。',
    });
    expect(started.activeEffect?.metadata?.confirmOnlyPendingAbility).toBeUndefined();
    expect(started.activeEffect?.selectableCardIds).not.toContain(scenario.sourceId);
    expect(started.activeEffect?.selectableCardIds).not.toContain(scenario.belowId);
    expect(started.activeEffect?.selectableCardIds).not.toContain(scenario.opponentId);
    const resolved = choose(started, scenario.waitingTargetId);
    expect(
      bladeModifiers(
        resolved,
        PL_BP4_014_LIVE_START_LIVE_WITHOUT_TIMING_TARGET_OTHER_MEMBER_GAIN_TWO_BLADE_ABILITY_ID
      )
    ).toEqual([
      expect.objectContaining({
        sourceCardId: scenario.sourceId,
        targetMemberCardId: scenario.waitingTargetId,
        countDelta: 2,
      }),
    ]);
  });

  it('auto-resolves one other target and no-ops when the stage only contains the source', () => {
    const one = setupRin();
    let oneGame = removeMainStageMember(one.game, PLAYER1, SlotPosition.RIGHT);
    const oneResolved = start({
      ...oneGame,
      pendingAbilities: [
        pending(
          PL_BP4_014_LIVE_START_LIVE_WITHOUT_TIMING_TARGET_OTHER_MEMBER_GAIN_TWO_BLADE_ABILITY_ID,
          one.sourceId
        ),
      ],
    });
    expect(oneResolved.activeEffect).toBeNull();
    expect(
      bladeModifiers(
        oneResolved,
        PL_BP4_014_LIVE_START_LIVE_WITHOUT_TIMING_TARGET_OTHER_MEMBER_GAIN_TWO_BLADE_ABILITY_ID
      )
    ).toEqual([
      expect.objectContaining({
        sourceCardId: one.sourceId,
        targetMemberCardId: one.activeTargetId,
        countDelta: 2,
      }),
    ]);

    const none = setupRin({ includeTargets: false });
    const noneResolved = start({
      ...none.game,
      pendingAbilities: [
        pending(
          PL_BP4_014_LIVE_START_LIVE_WITHOUT_TIMING_TARGET_OTHER_MEMBER_GAIN_TWO_BLADE_ABILITY_ID,
          none.sourceId
        ),
      ],
    });
    expect(noneResolved.activeEffect).toBeNull();
    expect(
      bladeModifiers(
        noneResolved,
        PL_BP4_014_LIVE_START_LIVE_WITHOUT_TIMING_TARGET_OTHER_MEMBER_GAIN_TWO_BLADE_ABILITY_ID
      )
    ).toEqual([]);
  });

  it.each([
    '【ライブ開始時】何かをする。',
    '【ライブ成功時】何かをする。',
    '【ライブ開始時】A。\n【ライブ成功時】B。',
  ])('does not resolve when every own LIVE has printed timing text: %s', (qualifyingText) => {
    const scenario = setupRin({ qualifyingText });
    const resolved = start({
      ...scenario.game,
      pendingAbilities: [
        pending(
          PL_BP4_014_LIVE_START_LIVE_WITHOUT_TIMING_TARGET_OTHER_MEMBER_GAIN_TWO_BLADE_ABILITY_ID,
          scenario.sourceId
        ),
      ],
    });
    expect(resolved.activeEffect).toBeNull();
    expect(
      bladeModifiers(
        resolved,
        PL_BP4_014_LIVE_START_LIVE_WITHOUT_TIMING_TARGET_OTHER_MEMBER_GAIN_TWO_BLADE_ABILITY_ID
      )
    ).toEqual([]);
  });

  it('clears without BLADE when target, source, or qualifying LIVE becomes stale before confirmation', () => {
    for (const staleKind of ['TARGET', 'SOURCE', 'CONDITION'] as const) {
      const scenario = setupRin();
      const started = start({
        ...scenario.game,
        pendingAbilities: [
          pending(
            PL_BP4_014_LIVE_START_LIVE_WITHOUT_TIMING_TARGET_OTHER_MEMBER_GAIN_TWO_BLADE_ABILITY_ID,
            scenario.sourceId
          ),
        ],
      });
      const withContinuation = {
        ...started,
        pendingAbilities: [
          pending(
            PL_BP4_014_LIVE_START_LIVE_WITHOUT_TIMING_TARGET_OTHER_MEMBER_GAIN_TWO_BLADE_ABILITY_ID,
            'missing-source',
            'continuation'
          ),
        ],
      };
      const stale =
        staleKind === 'TARGET'
          ? removeMainStageMember(withContinuation, PLAYER1, SlotPosition.LEFT)
          : staleKind === 'SOURCE'
            ? removeMainStageMember(withContinuation, PLAYER1, SlotPosition.CENTER)
            : updatePlayer(withContinuation, PLAYER1, (player) => ({
                ...player,
                liveZone: { ...player.liveZone, cardIds: [] },
              }));
      const resolved = choose(stale, scenario.activeTargetId);
      expect(resolved.activeEffect).toBeNull();
      expect(resolved.pendingAbilities).toEqual([]);
      expect(
        bladeModifiers(
          resolved,
          PL_BP4_014_LIVE_START_LIVE_WITHOUT_TIMING_TARGET_OTHER_MEMBER_GAIN_TWO_BLADE_ABILITY_ID
        )
      ).toEqual([]);
    }
  });
});

describe('PL!-bp4-024-L 分数2「小夜啼鳥恋詩」', () => {
  it("uses the real ON_LIVE_START enqueue entry and accepts structured μ's / μ’s aliases only", () => {
    const scenario = setupNightingale();
    const queued = enqueueTriggeredCardEffects(scenario.game, [TriggerCondition.ON_LIVE_START]);
    expect(queued.pendingAbilities).toContainEqual(
      expect.objectContaining({
        abilityId: PL_BP4_024_LIVE_START_TARGET_MUSE_MEMBER_GAIN_ONE_BLADE_ABILITY_ID,
        sourceCardId: scenario.sourceId,
        timingId: TriggerCondition.ON_LIVE_START,
      })
    );
    const started = start(queued);
    expect(started.activeEffect).toMatchObject({
      selectableCardIds: [scenario.straightMuseId, scenario.curlyMuseId],
      canSkipSelection: false,
      stepText: "请选择自己舞台上的1名『μ's』成员获得[ブレード]。",
    });
    expect(started.activeEffect?.metadata?.confirmOnlyPendingAbility).toBeUndefined();
    expect(started.activeEffect?.selectableCardIds).not.toContain(scenario.nonMuseId);
    expect(started.activeEffect?.selectableCardIds).not.toContain(scenario.belowMuseId);
    expect(started.activeEffect?.selectableCardIds).not.toContain(scenario.opponentMuseId);
    expect(choose(started, scenario.nonMuseId)).toBe(started);
    const resolved = choose(started, scenario.curlyMuseId);
    expect(
      bladeModifiers(resolved, PL_BP4_024_LIVE_START_TARGET_MUSE_MEMBER_GAIN_ONE_BLADE_ABILITY_ID)
    ).toEqual([
      expect.objectContaining({
        sourceCardId: scenario.sourceId,
        targetMemberCardId: scenario.curlyMuseId,
        countDelta: 1,
      }),
    ]);
  });

  it('auto-resolves one structured muse target for exactly BLADE +1', () => {
    const scenario = setupNightingale({ includeSecondMuse: false });
    const resolved = start({
      ...scenario.game,
      pendingAbilities: [
        pending(
          PL_BP4_024_LIVE_START_TARGET_MUSE_MEMBER_GAIN_ONE_BLADE_ABILITY_ID,
          scenario.sourceId
        ),
      ],
    });
    expect(resolved.activeEffect).toBeNull();
    expect(
      bladeModifiers(resolved, PL_BP4_024_LIVE_START_TARGET_MUSE_MEMBER_GAIN_ONE_BLADE_ABILITY_ID)
    ).toEqual([
      expect.objectContaining({
        sourceCardId: scenario.sourceId,
        targetMemberCardId: scenario.straightMuseId,
        countDelta: 1,
      }),
    ]);
  });

  it('clears without BLADE when the source LIVE or chosen muse target becomes stale', () => {
    for (const staleKind of ['SOURCE', 'TARGET'] as const) {
      const scenario = setupNightingale();
      const started = start({
        ...scenario.game,
        pendingAbilities: [
          pending(
            PL_BP4_024_LIVE_START_TARGET_MUSE_MEMBER_GAIN_ONE_BLADE_ABILITY_ID,
            scenario.sourceId
          ),
        ],
      });
      const withContinuation = {
        ...started,
        pendingAbilities: [
          pending(
            PL_BP4_024_LIVE_START_TARGET_MUSE_MEMBER_GAIN_ONE_BLADE_ABILITY_ID,
            'missing-live-source',
            'continuation'
          ),
        ],
      };
      const stale =
        staleKind === 'SOURCE'
          ? updatePlayer(withContinuation, PLAYER1, (player) => ({
              ...player,
              liveZone: { ...player.liveZone, cardIds: [] },
            }))
          : removeMainStageMember(withContinuation, PLAYER1, SlotPosition.LEFT);
      const resolved = choose(stale, scenario.straightMuseId);
      expect(resolved.activeEffect).toBeNull();
      expect(resolved.pendingAbilities).toEqual([]);
      expect(
        bladeModifiers(resolved, PL_BP4_024_LIVE_START_TARGET_MUSE_MEMBER_GAIN_ONE_BLADE_ABILITY_ID)
      ).toEqual([]);
    }
  });
});

describe('family effectText and BLADE token governance', () => {
  it.each([
    [
      'PL!-bp4-014-N',
      PL_BP4_014_LIVE_START_LIVE_WITHOUT_TIMING_TARGET_OTHER_MEMBER_GAIN_TWO_BLADE_ABILITY_ID,
      '【LIVE开始时】自己的LIVE中的LIVE卡，存在不持有【LIVE开始时】能力与【LIVE成功时】能力的卡片的场合，LIVE结束时为止，1名存在于自己的舞台的此成员以外的成员，获得[ブレード][ブレード]。',
      2,
    ],
    [
      'PL!-bp4-024-L',
      PL_BP4_024_LIVE_START_TARGET_MUSE_MEMBER_GAIN_ONE_BLADE_ABILITY_ID,
      "【LIVE开始时】LIVE结束时为止，存在于自己的舞台的1名『μ's』的成员，获得[ブレード]。",
      1,
    ],
  ] as const)(
    'uses exact Excel Chinese text and mapped BLADE tokens for %s',
    (cardCode, abilityId, effectText, bladeCount) => {
      const definition = getCardAbilityDefinitionsForCardCode(cardCode).find(
        (candidate) => candidate.abilityId === abilityId
      );
      expect(definition?.effectText).toBe(effectText);
      expect(
        parseCardEffectText(definition!.effectText).filter((part) => part.kind === 'blade')
      ).toHaveLength(bladeCount);
    }
  );
});
