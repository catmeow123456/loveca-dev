import { describe, expect, it } from 'vitest';
import type { BladeHeartItem, LiveCardData, MemberCardData } from '../../src/domain/entities/card';
import { createCardInstance, createHeartRequirement } from '../../src/domain/entities/card';
import {
  createGameState,
  emitGameEvent,
  registerCards,
  updatePlayer,
  type GameState,
  type PendingAbilityState,
} from '../../src/domain/entities/game';
import { createCheerEvent, createLiveSuccessEvent } from '../../src/domain/events/game-events';
import { addCardToZone, placeCardInSlot } from '../../src/domain/entities/zone';
import {
  ABILITY_ORDER_SELECTION_ID,
  confirmActiveEffectStep,
  enqueueTriggeredCardEffects,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import { GameService } from '../../src/application/game-service';
import { addLiveModifier } from '../../src/domain/rules/live-modifiers';
import {
  N_BP7_025_LIVE_START_TARGET_NIJIGASAKI_MEMBER_GAIN_ONE_BLADE_ABILITY_ID,
  N_BP7_025_LIVE_SUCCESS_THREE_BLADE_HEART_COLORS_SCORE_ABILITY_ID,
  SP_BP4_023_LIVE_START_CHEER_HEART_COLORS_TO_PURPLE_ABILITY_ID,
  SP_BP7_025_LIVE_START_TARGET_CHISATO_GAIN_ONE_BLADE_ABILITY_ID,
} from '../../src/application/card-effects/ability-ids';
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

function live(cardCode: string, score = 1): LiveCardData {
  return {
    cardCode,
    name: cardCode,
    cardType: CardType.LIVE,
    score,
    requirements: createHeartRequirement({ [HeartColor.PINK]: 1 }),
  };
}

function member(options: {
  readonly cardCode: string;
  readonly name: string;
  readonly groupNames?: readonly string[];
  readonly bladeHearts?: readonly BladeHeartItem[];
  readonly blade?: number;
}): MemberCardData {
  return {
    cardCode: options.cardCode,
    name: options.name,
    groupNames: options.groupNames,
    cardType: CardType.MEMBER,
    cost: 4,
    blade: options.blade ?? 1,
    hearts: [],
    bladeHearts: options.bladeHearts,
  };
}

function putStageMember(
  game: GameState,
  playerId: string,
  slot: SlotPosition,
  cardId: string,
  orientation: OrientationState = OrientationState.ACTIVE
): GameState {
  return updatePlayer(game, playerId, (player) => ({
    ...player,
    memberSlots: placeCardInSlot(player.memberSlots, slot, cardId, {
      orientation,
      face: FaceState.FACE_UP,
    }),
  }));
}

function removeStageMember(game: GameState, playerId: string, slot: SlotPosition): GameState {
  return updatePlayer(game, playerId, (player) => ({
    ...player,
    memberSlots: placeCardInSlot(player.memberSlots, slot, null),
  }));
}

function startLiveStart(game: GameState): GameState {
  return resolvePendingCardEffects(
    enqueueTriggeredCardEffects(game, [TriggerCondition.ON_LIVE_START])
  ).gameState;
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

function bladeModifiers(game: GameState, abilityId: string) {
  return game.liveResolution.liveModifiers.filter(
    (modifier) => modifier.kind === 'BLADE' && modifier.abilityId === abilityId
  );
}

function setupNijigasakiTargets(targetCount: 0 | 1 | 2 = 2) {
  const source = createCardInstance(live('PL!N-bp7-025-SECL'), PLAYER1, 'n-bp7-025-source');
  const nijiJp = createCardInstance(
    member({
      cardCode: 'NIJI-JP',
      name: '上原歩夢',
      groupNames: ['虹ヶ咲'],
    }),
    PLAYER1,
    'niji-jp'
  );
  const nijiCn = createCardInstance(
    member({
      cardCode: 'NIJI-CN',
      name: '中须霞',
      groupNames: ['虹咲'],
    }),
    PLAYER1,
    'niji-cn'
  );
  const nonNiji = createCardInstance(
    member({ cardCode: 'NON-NIJI', name: '高海千歌', groupNames: ['Aqours'] }),
    PLAYER1,
    'non-niji'
  );
  const belowNiji = createCardInstance(
    member({ cardCode: 'BELOW-NIJI', name: '优木雪菜', groupNames: ['虹ヶ咲'] }),
    PLAYER1,
    'below-niji'
  );
  const opponentNiji = createCardInstance(
    member({ cardCode: 'OPPONENT-NIJI', name: '鐘嵐珠', groupNames: ['虹ヶ咲'] }),
    PLAYER2,
    'opponent-niji'
  );
  let game = registerCards(createGameState('niji-targets', PLAYER1, 'P1', PLAYER2, 'P2'), [
    source,
    nijiJp,
    nijiCn,
    nonNiji,
    belowNiji,
    opponentNiji,
  ]);
  game = updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    liveZone: addCardToZone(player.liveZone, source.instanceId),
  }));
  if (targetCount >= 1) {
    game = putStageMember(game, PLAYER1, SlotPosition.LEFT, nijiJp.instanceId);
  }
  if (targetCount >= 2) {
    game = putStageMember(
      game,
      PLAYER1,
      SlotPosition.CENTER,
      nijiCn.instanceId,
      OrientationState.WAITING
    );
  }
  game = putStageMember(game, PLAYER1, SlotPosition.RIGHT, nonNiji.instanceId);
  game = updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    memberSlots: {
      ...player.memberSlots,
      memberBelow: {
        ...player.memberSlots.memberBelow,
        [SlotPosition.RIGHT]: [belowNiji.instanceId],
      },
    },
  }));
  game = putStageMember(game, PLAYER2, SlotPosition.CENTER, opponentNiji.instanceId);
  return {
    game,
    sourceId: source.instanceId,
    targetIds: [nijiJp.instanceId, nijiCn.instanceId].slice(0, targetCount),
    nonNijiId: nonNiji.instanceId,
    belowNijiId: belowNiji.instanceId,
    opponentNijiId: opponentNiji.instanceId,
  };
}

function setupChisatoTargets(targetCount: 0 | 1 | 3 = 3) {
  const source = createCardInstance(live('PL!SP-bp7-025-L', 3), PLAYER1, 'sp-bp7-025-source');
  const chisatoJp = createCardInstance(
    member({ cardCode: 'CHISATO-JP', name: '嵐千砂都', groupNames: ['Liella!'] }),
    PLAYER1,
    'chisato-jp'
  );
  const chisatoCn = createCardInstance(
    member({ cardCode: 'CHISATO-CN', name: '岚千砂都', groupNames: ['Liella!'] }),
    PLAYER1,
    'chisato-cn'
  );
  const comboChisato = createCardInstance(
    member({
      cardCode: 'CHISATO-COMBO',
      name: '嵐千砂都&澁谷かのん',
      groupNames: ['Liella!', 'Liella!'],
    }),
    PLAYER1,
    'chisato-combo'
  );
  const nonChisato = createCardInstance(
    member({ cardCode: 'NON-CHISATO', name: '葉月恋', groupNames: ['Liella!'] }),
    PLAYER1,
    'non-chisato'
  );
  const targetCards = [chisatoJp, chisatoCn, comboChisato].slice(0, targetCount);
  let game = registerCards(createGameState('chisato-targets', PLAYER1, 'P1', PLAYER2, 'P2'), [
    source,
    chisatoJp,
    chisatoCn,
    comboChisato,
    nonChisato,
  ]);
  game = updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    liveZone: addCardToZone(player.liveZone, source.instanceId),
  }));
  for (const [index, card] of targetCards.entries()) {
    game = putStageMember(
      game,
      PLAYER1,
      [SlotPosition.LEFT, SlotPosition.CENTER, SlotPosition.RIGHT][index]!,
      card.instanceId,
      index === 1 ? OrientationState.WAITING : OrientationState.ACTIVE
    );
  }
  if (targetCount === 0) {
    game = putStageMember(game, PLAYER1, SlotPosition.CENTER, nonChisato.instanceId);
  }
  return {
    game,
    sourceId: source.instanceId,
    targetIds: targetCards.map((card) => card.instanceId),
    nonChisatoId: nonChisato.instanceId,
  };
}

describe('BP7 single-target BLADE shared family expansion', () => {
  it('selects only own top-level structured Nijigasaki members and writes TARGET_MEMBER BLADE', () => {
    const scenario = setupNijigasakiTargets();
    const started = startLiveStart(scenario.game);
    expect(started.activeEffect).toMatchObject({
      abilityId: N_BP7_025_LIVE_START_TARGET_NIJIGASAKI_MEMBER_GAIN_ONE_BLADE_ABILITY_ID,
      selectableCardIds: scenario.targetIds,
      canSkipSelection: false,
      stepText: '请选择自己舞台上的1名『虹咲』成员获得[BLADE]。',
      selectionLabel: '选择获得[BLADE]的成员',
      confirmSelectionLabel: '获得[BLADE]',
    });
    expect(started.activeEffect?.metadata?.confirmOnlyPendingAbility).toBeUndefined();
    for (const invalidId of [
      scenario.nonNijiId,
      scenario.belowNijiId,
      scenario.opponentNijiId,
      'unknown',
    ]) {
      expect(choose(started, invalidId)).toBe(started);
    }

    const resolved = choose(started, scenario.targetIds[1]!);
    expect(
      bladeModifiers(
        resolved,
        N_BP7_025_LIVE_START_TARGET_NIJIGASAKI_MEMBER_GAIN_ONE_BLADE_ABILITY_ID
      )
    ).toEqual([
      expect.objectContaining({
        target: 'TARGET_MEMBER',
        sourceCardId: scenario.sourceId,
        targetMemberCardId: scenario.targetIds[1],
        countDelta: 1,
      }),
    ]);
  });

  it('PL!N-bp7-025 实际结算目标 +1 后以 1+4+1 只公开 6 张声援', () => {
    const source = createCardInstance(
      live('PL!N-bp7-025-SECL'),
      PLAYER1,
      'n-bp7-025-cross-layer-source'
    );
    const left = createCardInstance(
      member({
        cardCode: 'CROSS-LAYER-NIJI-LEFT',
        name: '上原步梦',
        groupNames: ['虹ヶ咲'],
        blade: 1,
      }),
      PLAYER1,
      'n-bp7-025-cross-layer-left'
    );
    const center = createCardInstance(
      member({
        cardCode: 'CROSS-LAYER-NIJI-CENTER',
        name: '中须霞',
        groupNames: ['虹咲'],
        blade: 4,
      }),
      PLAYER1,
      'n-bp7-025-cross-layer-center'
    );
    const cheerCards = Array.from({ length: 8 }, (_, index) =>
      createCardInstance(
        member({ cardCode: `CROSS-LAYER-CHEER-${index}`, name: `Cheer ${index}` }),
        PLAYER1,
        `n-bp7-025-cross-layer-cheer-${index}`
      )
    );
    let game = registerCards(
      createGameState('n-bp7-025-cross-layer', PLAYER1, 'P1', PLAYER2, 'P2'),
      [source, left, center, ...cheerCards]
    );
    game = updatePlayer(game, PLAYER1, (player) => ({
      ...player,
      liveZone: addCardToZone(player.liveZone, source.instanceId),
      memberSlots: placeCardInSlot(
        placeCardInSlot(player.memberSlots, SlotPosition.LEFT, left.instanceId, {
          orientation: OrientationState.ACTIVE,
          face: FaceState.FACE_UP,
        }),
        SlotPosition.CENTER,
        center.instanceId,
        { orientation: OrientationState.ACTIVE, face: FaceState.FACE_UP }
      ),
      mainDeck: cheerCards.reduce(
        (zone, card) => addCardToZone(zone, card.instanceId),
        player.mainDeck
      ),
    }));

    const resolved = choose(startLiveStart(game), left.instanceId);
    const done = (
      new GameService() as unknown as {
        autoRevealPerformanceCheer(state: GameState, playerId: string): GameState;
      }
    ).autoRevealPerformanceCheer(resolved, PLAYER1);

    expect(done.liveResolution.firstPlayerCheerCardIds).toHaveLength(6);
  });

  it('keeps 0-target safe consumption, one-target auto resolution, and stale source/target safety', () => {
    const none = startLiveStart(setupNijigasakiTargets(0).game);
    expect(none.activeEffect).toBeNull();
    expect(none.pendingAbilities).toEqual([]);

    const one = setupNijigasakiTargets(1);
    const autoResolved = startLiveStart(one.game);
    expect(autoResolved.activeEffect).toBeNull();
    expect(
      bladeModifiers(
        autoResolved,
        N_BP7_025_LIVE_START_TARGET_NIJIGASAKI_MEMBER_GAIN_ONE_BLADE_ABILITY_ID
      )
    ).toHaveLength(1);

    for (const staleKind of ['SOURCE', 'TARGET'] as const) {
      const scenario = setupNijigasakiTargets();
      const started = startLiveStart(scenario.game);
      const stale =
        staleKind === 'SOURCE'
          ? updatePlayer(started, PLAYER1, (player) => ({
              ...player,
              liveZone: { ...player.liveZone, cardIds: [] },
            }))
          : removeStageMember(started, PLAYER1, SlotPosition.LEFT);
      const resolved = choose(stale, scenario.targetIds[0]!);
      expect(resolved.activeEffect).toBeNull();
      expect(
        bladeModifiers(
          resolved,
          N_BP7_025_LIVE_START_TARGET_NIJIGASAKI_MEMBER_GAIN_ONE_BLADE_ABILITY_ID
        )
      ).toEqual([]);
    }
  });

  it('matches Chisato Japanese, Chinese, and combination-card identities through cardNameAliasIs', () => {
    const scenario = setupChisatoTargets();
    const started = startLiveStart(scenario.game);
    expect(started.activeEffect).toMatchObject({
      abilityId: SP_BP7_025_LIVE_START_TARGET_CHISATO_GAIN_ONE_BLADE_ABILITY_ID,
      selectableCardIds: scenario.targetIds,
      canSkipSelection: false,
      stepText: '请选择自己舞台上的1名「岚千砂都」成员获得[BLADE]。',
    });
    expect(started.activeEffect?.selectableCardIds).not.toContain(scenario.nonChisatoId);

    const resolved = choose(started, scenario.targetIds[2]!);
    expect(
      bladeModifiers(resolved, SP_BP7_025_LIVE_START_TARGET_CHISATO_GAIN_ONE_BLADE_ABILITY_ID)
    ).toEqual([
      expect.objectContaining({
        target: 'TARGET_MEMBER',
        sourceCardId: scenario.sourceId,
        targetMemberCardId: scenario.targetIds[2],
        countDelta: 1,
      }),
    ]);
  });

  it('keeps Chisato 0/1-target paths deterministic and rejects an adjacent-base source', () => {
    const none = startLiveStart(setupChisatoTargets(0).game);
    expect(none.activeEffect).toBeNull();

    const one = setupChisatoTargets(1);
    expect(
      bladeModifiers(
        startLiveStart(one.game),
        SP_BP7_025_LIVE_START_TARGET_CHISATO_GAIN_ONE_BLADE_ABILITY_ID
      )
    ).toHaveLength(1);

    const forgedSource = createCardInstance(
      live('PL!SP-bp7-024-P', 3),
      PLAYER1,
      'forged-sp-bp7-025-source'
    );
    const forgedTarget = createCardInstance(
      member({ cardCode: 'FORGED-CHISATO', name: '嵐千砂都', groupNames: ['Liella!'] }),
      PLAYER1,
      'forged-chisato-target'
    );
    let forgedGame = registerCards(createGameState('forged-source', PLAYER1, 'P1', PLAYER2, 'P2'), [
      forgedSource,
      forgedTarget,
    ]);
    forgedGame = updatePlayer(forgedGame, PLAYER1, (player) => ({
      ...player,
      liveZone: addCardToZone(player.liveZone, forgedSource.instanceId),
    }));
    forgedGame = putStageMember(forgedGame, PLAYER1, SlotPosition.CENTER, forgedTarget.instanceId);
    forgedGame = {
      ...forgedGame,
      pendingAbilities: [
        {
          id: 'forged-pending',
          abilityId: SP_BP7_025_LIVE_START_TARGET_CHISATO_GAIN_ONE_BLADE_ABILITY_ID,
          sourceCardId: forgedSource.instanceId,
          controllerId: PLAYER1,
          mandatory: true,
          timingId: TriggerCondition.ON_LIVE_START,
          eventIds: ['forged-event'],
        },
      ],
    };
    const forgedResolved = resolvePendingCardEffects(forgedGame).gameState;
    expect(forgedResolved.pendingAbilities).toEqual([]);
    expect(
      bladeModifiers(forgedResolved, SP_BP7_025_LIVE_START_TARGET_CHISATO_GAIN_ONE_BLADE_ABILITY_ID)
    ).toEqual([]);
  });
});

function bladeHeart(effect: BladeHeartEffect, heartColor?: HeartColor): BladeHeartItem {
  return { effect, heartColor };
}

function liveSuccessPending(sourceCardId: string, suffix = 'first'): PendingAbilityState {
  return {
    id: `n-bp7-025-success:${suffix}`,
    abilityId: N_BP7_025_LIVE_SUCCESS_THREE_BLADE_HEART_COLORS_SCORE_ABILITY_ID,
    sourceCardId,
    controllerId: PLAYER1,
    mandatory: true,
    timingId: TriggerCondition.ON_LIVE_SUCCESS,
    eventIds: [`live-success-event:${suffix}`],
  };
}

function setupN025LiveSuccess(options: {
  readonly sourceInLiveZone?: boolean;
  readonly bladeHearts: readonly BladeHeartItem[][];
  readonly moveFirstOutOfResolution?: boolean;
}) {
  const source = createCardInstance(live('PL!N-bp7-025-SECL'), PLAYER1, 'n-bp7-025-success-source');
  const cheerCards = options.bladeHearts.map((items, index) =>
    createCardInstance(
      member({
        cardCode: `CHEER-${index}`,
        name: `cheer-${index}`,
        bladeHearts: items,
      }),
      PLAYER1,
      `cheer-${index}`
    )
  );
  let game = registerCards(createGameState('n025-success', PLAYER1, 'P1', PLAYER2, 'P2'), [
    source,
    ...cheerCards,
  ]);
  game = updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    liveZone:
      options.sourceInLiveZone === false
        ? player.liveZone
        : addCardToZone(player.liveZone, source.instanceId),
  }));
  const cheerCardIds = cheerCards.map((card) => card.instanceId);
  game = {
    ...game,
    resolutionZone: {
      ...game.resolutionZone,
      cardIds: options.moveFirstOutOfResolution ? cheerCardIds.slice(1) : cheerCardIds,
      revealedCardIds: options.moveFirstOutOfResolution ? cheerCardIds.slice(1) : cheerCardIds,
    },
    liveResolution: {
      ...game.liveResolution,
      isInLive: true,
      performingPlayerId: PLAYER1,
      firstPlayerCheerCardIds: cheerCardIds,
      playerScores: new Map([[PLAYER1, 1]]),
    },
  };
  game = emitGameEvent(
    game,
    createCheerEvent(PLAYER1, cheerCardIds, cheerCardIds.length, {
      automated: true,
    })
  );
  return { game, sourceId: source.instanceId, cheerCardIds };
}

function startLiveSuccess(game: GameState, sourceCardId: string, suffix = 'first'): GameState {
  return resolvePendingCardEffects({
    ...game,
    pendingAbilities: [liveSuccessPending(sourceCardId, suffix)],
  }).gameState;
}

function confirmOnly(game: GameState): GameState {
  return confirmActiveEffectStep(game, PLAYER1, game.activeEffect!.id, null, null, false, null);
}

describe('PL!N-bp7-025-SECL 分数1「Colorful Dreams! Colorful Smiles!」LIVE成功', () => {
  it('shows BLADE HEART condition facts and applies replacement SCORE only after confirmation', () => {
    const scenario = setupN025LiveSuccess({
      bladeHearts: [
        [
          bladeHeart(BladeHeartEffect.HEART, HeartColor.PINK),
          bladeHeart(BladeHeartEffect.HEART, HeartColor.RED),
        ],
        [
          bladeHeart(BladeHeartEffect.HEART, HeartColor.YELLOW),
          bladeHeart(BladeHeartEffect.HEART, HeartColor.PINK),
        ],
      ],
    });
    const queued = enqueueTriggeredCardEffects(scenario.game, [TriggerCondition.ON_LIVE_SUCCESS], {
      liveSuccessEvents: [createLiveSuccessEvent(PLAYER1, [scenario.sourceId], 1)],
    });
    expect(queued.pendingAbilities).toContainEqual(
      expect.objectContaining({
        abilityId: N_BP7_025_LIVE_SUCCESS_THREE_BLADE_HEART_COLORS_SCORE_ABILITY_ID,
        sourceCardId: scenario.sourceId,
        timingId: TriggerCondition.ON_LIVE_SUCCESS,
      })
    );
    const started = resolvePendingCardEffects(queued).gameState;
    expect(started.liveResolution.playerScores.get(PLAYER1)).toBe(1);
    expect(started.activeEffect).toMatchObject({
      abilityId: N_BP7_025_LIVE_SUCCESS_THREE_BLADE_HEART_COLORS_SCORE_ABILITY_ID,
      stepText: '确认后此卡[スコア]+1。',
    });
    expect(started.activeEffect?.effectText).toContain(
      '当前命中：[桃ブレード]、[赤ブレード]、[黄ブレード]，共3种'
    );
    expect(started.activeEffect?.effectText).toContain('满足条件，实际[スコア]+1');
    expect(started.activeEffect?.effectText).not.toMatch(/\[(桃|赤|黄|緑|青|紫)ハート\]/);

    const resolved = confirmOnly(started);
    expect(resolved.liveResolution.playerScores.get(PLAYER1)).toBe(2);
    expect(
      resolved.liveResolution.liveModifiers.filter(
        (modifier) =>
          modifier.kind === 'SCORE' &&
          modifier.abilityId === N_BP7_025_LIVE_SUCCESS_THREE_BLADE_HEART_COLORS_SCORE_ABILITY_ID
      )
    ).toEqual([
      expect.objectContaining({
        playerId: PLAYER1,
        liveCardId: scenario.sourceId,
        sourceCardId: scenario.sourceId,
        countDelta: 1,
      }),
    ]);
  });

  it('excludes duplicate, DRAW/SCORE, GRAY, and RAINBOW values from the six-color threshold', () => {
    const scenario = setupN025LiveSuccess({
      bladeHearts: [
        [
          bladeHeart(BladeHeartEffect.HEART, HeartColor.PINK),
          bladeHeart(BladeHeartEffect.HEART, HeartColor.PINK),
          bladeHeart(BladeHeartEffect.HEART, HeartColor.RED),
          bladeHeart(BladeHeartEffect.DRAW),
          bladeHeart(BladeHeartEffect.SCORE),
          bladeHeart(BladeHeartEffect.HEART, HeartColor.GRAY),
          bladeHeart(BladeHeartEffect.HEART, HeartColor.RAINBOW),
        ],
      ],
    });
    const started = startLiveSuccess(scenario.game, scenario.sourceId);
    expect(started.activeEffect?.effectText).toContain(
      '当前命中：[桃ブレード]、[赤ブレード]，共2种'
    );
    expect(started.activeEffect?.effectText).toContain('未满足条件，实际不增加[スコア]');
    const resolved = confirmOnly(started);
    expect(resolved.pendingAbilities).toEqual([]);
    expect(resolved.activeEffect).toBeNull();
    expect(resolved.liveResolution.playerScores.get(PLAYER1)).toBe(1);
    expect(resolved.liveResolution.liveModifiers).toEqual([]);
  });

  it('counts only purple after Dazzling Game replaces the revealed Blade Heart colors', () => {
    const scenario = setupN025LiveSuccess({
      bladeHearts: [
        [
          bladeHeart(BladeHeartEffect.HEART, HeartColor.PINK),
          bladeHeart(BladeHeartEffect.HEART, HeartColor.RED),
          bladeHeart(BladeHeartEffect.HEART, HeartColor.YELLOW),
          bladeHeart(BladeHeartEffect.HEART, HeartColor.RAINBOW),
        ],
      ],
    });
    const replaced = addLiveModifier(scenario.game, {
      kind: 'CHEER_CARD_HEART_COLOR_REPLACEMENT',
      playerId: PLAYER1,
      fromColors: [
        HeartColor.PINK,
        HeartColor.RED,
        HeartColor.YELLOW,
        HeartColor.GREEN,
        HeartColor.BLUE,
        HeartColor.RAINBOW,
      ],
      toColor: HeartColor.PURPLE,
      sourceCardId: 'dazzling-game-live',
      abilityId: SP_BP4_023_LIVE_START_CHEER_HEART_COLORS_TO_PURPLE_ABILITY_ID,
    });

    const started = startLiveSuccess(replaced, scenario.sourceId);
    expect(started.activeEffect?.effectText).toContain('当前命中：[紫ブレード]，共1种');
    expect(started.activeEffect?.effectText).toContain('未满足条件，实际不增加[スコア]');

    const resolved = confirmOnly(started);
    expect(resolved.pendingAbilities).toEqual([]);
    expect(resolved.activeEffect).toBeNull();
    expect(resolved.liveResolution.playerScores.get(PLAYER1)).toBe(1);
    expect(resolved.liveResolution.liveModifiers).toEqual([
      expect.objectContaining({ kind: 'CHEER_CARD_HEART_COLOR_REPLACEMENT' }),
    ]);
  });

  it('keeps event-inclusive colors after a revealed card leaves the resolution zone', () => {
    const scenario = setupN025LiveSuccess({
      bladeHearts: [
        [bladeHeart(BladeHeartEffect.HEART, HeartColor.PINK)],
        [
          bladeHeart(BladeHeartEffect.HEART, HeartColor.RED),
          bladeHeart(BladeHeartEffect.HEART, HeartColor.YELLOW),
        ],
      ],
      moveFirstOutOfResolution: true,
    });
    const resolved = confirmOnly(startLiveSuccess(scenario.game, scenario.sourceId));
    expect(resolved.liveResolution.playerScores.get(PLAYER1)).toBe(2);
  });

  it('revalidates the source and replacement-settles repeated resolution without stacking', () => {
    const missingSource = setupN025LiveSuccess({
      sourceInLiveZone: false,
      bladeHearts: [
        [
          bladeHeart(BladeHeartEffect.HEART, HeartColor.PINK),
          bladeHeart(BladeHeartEffect.HEART, HeartColor.RED),
          bladeHeart(BladeHeartEffect.HEART, HeartColor.YELLOW),
        ],
      ],
    });
    const noOp = confirmOnly(startLiveSuccess(missingSource.game, missingSource.sourceId));
    expect(noOp.liveResolution.playerScores.get(PLAYER1)).toBe(1);
    expect(noOp.liveResolution.liveModifiers).toEqual([]);

    const scenario = setupN025LiveSuccess({
      bladeHearts: [
        [
          bladeHeart(BladeHeartEffect.HEART, HeartColor.PINK),
          bladeHeart(BladeHeartEffect.HEART, HeartColor.RED),
          bladeHeart(BladeHeartEffect.HEART, HeartColor.YELLOW),
        ],
      ],
    });
    const first = confirmOnly(startLiveSuccess(scenario.game, scenario.sourceId, 'first'));
    const second = confirmOnly(startLiveSuccess(first, scenario.sourceId, 'second'));
    expect(second.liveResolution.playerScores.get(PLAYER1)).toBe(2);
    expect(
      second.liveResolution.liveModifiers.filter(
        (modifier) =>
          modifier.kind === 'SCORE' &&
          modifier.abilityId === N_BP7_025_LIVE_SUCCESS_THREE_BLADE_HEART_COLORS_SCORE_ABILITY_ID
      )
    ).toHaveLength(1);
  });

  it('auto-resolves an explicitly ordered no-input batch without a second confirm-only window', () => {
    const scenario = setupN025LiveSuccess({
      bladeHearts: [
        [
          bladeHeart(BladeHeartEffect.HEART, HeartColor.PINK),
          bladeHeart(BladeHeartEffect.HEART, HeartColor.RED),
          bladeHeart(BladeHeartEffect.HEART, HeartColor.YELLOW),
        ],
      ],
    });
    const orderWindow = resolvePendingCardEffects({
      ...scenario.game,
      pendingAbilities: [
        liveSuccessPending(scenario.sourceId, 'first'),
        liveSuccessPending(scenario.sourceId, 'second'),
      ],
    }).gameState;
    expect(orderWindow.activeEffect?.abilityId).toBe(ABILITY_ORDER_SELECTION_ID);
    const resolved = confirmActiveEffectStep(
      orderWindow,
      PLAYER1,
      orderWindow.activeEffect!.id,
      null,
      null,
      true
    );
    expect(resolved.activeEffect).toBeNull();
    expect(resolved.pendingAbilities).toEqual([]);
    expect(resolved.liveResolution.playerScores.get(PLAYER1)).toBe(2);
  });
});
