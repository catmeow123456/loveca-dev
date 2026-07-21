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
  updateLiveResolution,
  updatePlayer,
  type GameState,
  type PendingAbilityState,
} from '../../src/domain/entities/game';
import {
  addCardToStatefulZone,
  placeCardInSlot,
  removeCardFromSlot,
  removeCardFromStatefulZone,
} from '../../src/domain/entities/zone';
import {
  PL_BP3_024_LIVE_START_SUCCESS_CHOOSE_HEART_TARGET_MUSE_MEMBER_ABILITY_ID,
  PL_BP3_024_LIVE_START_SUCCESS_TWO_THIS_LIVE_SCORE_ABILITY_ID,
} from '../../src/application/card-effects/ability-ids';
import {
  confirmActiveEffectStep,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import { createConfirmEffectStepCommand } from '../../src/application/game-commands';
import { createGameSession } from '../../src/application/game-session';
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

function createNatsuiroEgao(): LiveCardData {
  return {
    cardCode: 'PL!-bp3-024-L',
    name: '夏色えがおで1,2,Jump!',
    groupNames: ["μ's"],
    cardType: CardType.LIVE,
    score: 2,
    requirements: createHeartRequirement({
      [HeartColor.PINK]: 2,
      [HeartColor.YELLOW]: 2,
      [HeartColor.PURPLE]: 2,
    }),
  };
}

function createMember(cardCode: string, groupName: string): MemberCardData {
  return {
    cardCode,
    name: cardCode,
    groupNames: [groupName],
    cardType: CardType.MEMBER,
    cost: 2,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.PINK, 1)],
  };
}

function createSuccessLive(): LiveCardData {
  return {
    cardCode: 'PL!-test-success-L',
    name: 'success',
    groupNames: ["μ's"],
    cardType: CardType.LIVE,
    score: 1,
    requirements: createHeartRequirement({ [HeartColor.PINK]: 1 }),
  };
}

function pendingAbility(
  abilityId: string,
  sourceCardId: string,
  suffix = abilityId
): PendingAbilityState {
  return {
    id: `pending-${suffix}`,
    abilityId,
    sourceCardId,
    controllerId: PLAYER1,
    mandatory: true,
    timingId: TriggerCondition.ON_LIVE_START,
    eventIds: [`event-${suffix}`],
  };
}

function setup(options: {
  readonly successLiveCount?: number;
  readonly includeMuseMember?: boolean;
  readonly abilityId: string;
}): {
  readonly game: GameState;
  readonly sourceCardId: string;
  readonly museMemberCardId: string;
  readonly nonMuseMemberCardId: string;
} {
  const source = createCardInstance(createNatsuiroEgao(), PLAYER1, 'natsuiro-egao');
  const museMember = createCardInstance(
    createMember('PL!-test-muse-member', "μ's"),
    PLAYER1,
    'muse-member'
  );
  const nonMuseMember = createCardInstance(
    createMember('PL!N-test-member', '虹ヶ咲'),
    PLAYER1,
    'non-muse-member'
  );
  const successLives = Array.from({ length: options.successLiveCount ?? 1 }, (_, index) =>
    createCardInstance(createSuccessLive(), PLAYER1, `success-live-${index + 1}`)
  );

  let game = createGameState('pl-bp3-024', PLAYER1, 'P1', PLAYER2, 'P2');
  game = registerCards(game, [source, museMember, nonMuseMember, ...successLives]);
  game = updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    liveZone: addCardToStatefulZone(player.liveZone, source.instanceId),
    successZone: successLives.reduce(
      (zone, live) => addCardToStatefulZone(zone, live.instanceId),
      player.successZone
    ),
    memberSlots: placeCardInSlot(
      options.includeMuseMember === false
        ? player.memberSlots
        : placeCardInSlot(player.memberSlots, SlotPosition.LEFT, museMember.instanceId, {
            orientation: OrientationState.ACTIVE,
            face: FaceState.FACE_UP,
          }),
      SlotPosition.RIGHT,
      nonMuseMember.instanceId,
      {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      }
    ),
  }));
  game = updateLiveResolution(game, (resolution) => ({
    ...resolution,
    performingPlayerId: PLAYER1,
    playerScores: new Map(resolution.playerScores).set(PLAYER1, 2),
  }));
  game = {
    ...game,
    pendingAbilities: [pendingAbility(options.abilityId, source.instanceId)],
  };
  return {
    game,
    sourceCardId: source.instanceId,
    museMemberCardId: museMember.instanceId,
    nonMuseMemberCardId: nonMuseMember.instanceId,
  };
}

function chooseColor(game: GameState, color: HeartColor): GameState {
  const publicChoice = confirmActiveEffectStep(
    game,
    PLAYER1,
    game.activeEffect!.id,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    [color]
  );
  return publicChoice === game
    ? game
    : confirmActiveEffectStep(publicChoice, PLAYER1, publicChoice.activeEffect!.id);
}

function scoreModifiers(game: GameState) {
  return game.liveResolution.liveModifiers.filter(
    (modifier) =>
      modifier.kind === 'SCORE' &&
      modifier.abilityId === PL_BP3_024_LIVE_START_SUCCESS_TWO_THIS_LIVE_SCORE_ABILITY_ID
  );
}

describe('PL!-bp3-024-L 夏色えがおで1,2,Jump! LIVE-start abilities', () => {
  it("chooses a mapped Heart color and only a structured μ's stage member, then writes TARGET_MEMBER Heart", () => {
    const scenario = setup({
      abilityId: PL_BP3_024_LIVE_START_SUCCESS_CHOOSE_HEART_TARGET_MUSE_MEMBER_ABILITY_ID,
    });
    const colorStep = resolvePendingCardEffects(scenario.game).gameState;
    expect(colorStep.activeEffect).toMatchObject({
      abilityId: PL_BP3_024_LIVE_START_SUCCESS_CHOOSE_HEART_TARGET_MUSE_MEMBER_ABILITY_ID,
      stepText: '请选择本次获得的Heart颜色。',
      selectionLabel: '选择Heart颜色',
      confirmSelectionLabel: '获得Heart',
      effectChoice: {
        mode: 'SINGLE',
        options: [
          { id: HeartColor.PINK, text: '选择的成员获得[桃ハート]。' },
          { id: HeartColor.YELLOW, text: '选择的成员获得[黄ハート]。' },
          { id: HeartColor.PURPLE, text: '选择的成员获得[紫ハート]。' },
        ],
        minSelections: 1,
        maxSelections: 1,
        publicConfirmation: true,
      },
      canSkipSelection: false,
    });
    expect(colorStep.activeEffect?.effectText).not.toMatch(/source|pending|stale|eventId|trigger/);

    const invalidSession = createGameSession();
    invalidSession.createGame('pl-bp3-024-invalid-color', PLAYER1, 'P1', PLAYER2, 'P2');
    (invalidSession as unknown as { authorityState: GameState }).authorityState = colorStep;
    expect(
      invalidSession.executeCommand(
        createConfirmEffectStepCommand(
          PLAYER1,
          colorStep.activeEffect!.id,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          [HeartColor.RED]
        )
      ).success
    ).toBe(false);
    expect(invalidSession.state?.activeEffect?.id).toBe(colorStep.activeEffect?.id);
    expect(invalidSession.state?.liveResolution.liveModifiers).toEqual([]);

    const targetStep = chooseColor(colorStep, HeartColor.YELLOW);
    expect(targetStep.activeEffect).toMatchObject({
      selectableCardIds: [scenario.museMemberCardId],
      selectableOptions: undefined,
      effectChoice: undefined,
      canSkipSelection: false,
    });
    expect(targetStep.activeEffect?.selectableCardIds).not.toContain(scenario.nonMuseMemberCardId);

    const resolved = confirmActiveEffectStep(
      targetStep,
      PLAYER1,
      targetStep.activeEffect!.id,
      scenario.museMemberCardId
    );
    expect(resolved.liveResolution.liveModifiers).toContainEqual({
      kind: 'HEART',
      target: 'TARGET_MEMBER',
      playerId: PLAYER1,
      targetMemberCardId: scenario.museMemberCardId,
      sourceCardId: scenario.sourceCardId,
      abilityId: PL_BP3_024_LIVE_START_SUCCESS_CHOOSE_HEART_TARGET_MUSE_MEMBER_ABILITY_ID,
      hearts: [{ color: HeartColor.YELLOW, count: 1 }],
    });
    expect(resolved.activeEffect).toBeNull();
    expect(resolved.pendingAbilities).toEqual([]);
  });

  it('consumes the interactive pending without opening a choice when the success condition or target is missing', () => {
    for (const scenario of [
      setup({
        abilityId: PL_BP3_024_LIVE_START_SUCCESS_CHOOSE_HEART_TARGET_MUSE_MEMBER_ABILITY_ID,
        successLiveCount: 0,
      }),
      setup({
        abilityId: PL_BP3_024_LIVE_START_SUCCESS_CHOOSE_HEART_TARGET_MUSE_MEMBER_ABILITY_ID,
        includeMuseMember: false,
      }),
    ]) {
      const resolved = resolvePendingCardEffects(scenario.game).gameState;
      expect(resolved.activeEffect).toBeNull();
      expect(resolved.pendingAbilities).toEqual([]);
      expect(resolved.liveResolution.liveModifiers).toEqual([]);
    }
  });

  it('rejects a stale member target and safely no-ops if the source LIVE leaves before applying Heart', () => {
    const staleScenario = setup({
      abilityId: PL_BP3_024_LIVE_START_SUCCESS_CHOOSE_HEART_TARGET_MUSE_MEMBER_ABILITY_ID,
    });
    let staleTargetStep = chooseColor(
      resolvePendingCardEffects(staleScenario.game).gameState,
      HeartColor.PURPLE
    );
    staleTargetStep = updatePlayer(staleTargetStep, PLAYER1, (player) => ({
      ...player,
      memberSlots: removeCardFromSlot(player.memberSlots, SlotPosition.LEFT),
    }));
    const session = createGameSession();
    session.createGame('pl-bp3-024-stale', PLAYER1, 'P1', PLAYER2, 'P2');
    (session as unknown as { authorityState: GameState }).authorityState = staleTargetStep;
    const staleResult = session.executeCommand(
      createConfirmEffectStepCommand(
        PLAYER1,
        staleTargetStep.activeEffect!.id,
        staleScenario.museMemberCardId
      )
    );
    expect(staleResult.success).toBe(true);
    expect(session.state?.activeEffect).toBeNull();
    expect(session.state?.pendingAbilities).toEqual([]);
    expect(session.state?.liveResolution.liveModifiers).toEqual([]);

    const sourceScenario = setup({
      abilityId: PL_BP3_024_LIVE_START_SUCCESS_CHOOSE_HEART_TARGET_MUSE_MEMBER_ABILITY_ID,
    });
    let sourceLeftStep = chooseColor(
      resolvePendingCardEffects(sourceScenario.game).gameState,
      HeartColor.PINK
    );
    sourceLeftStep = updatePlayer(sourceLeftStep, PLAYER1, (player) => ({
      ...player,
      liveZone: removeCardFromStatefulZone(player.liveZone, sourceScenario.sourceCardId),
    }));
    const resolved = confirmActiveEffectStep(
      sourceLeftStep,
      PLAYER1,
      sourceLeftStep.activeEffect!.id,
      sourceScenario.museMemberCardId
    );
    expect(resolved.activeEffect).toBeNull();
    expect(resolved.liveResolution.liveModifiers).toEqual([]);
  });

  it('shows the realtime success count before adding SCORE +1, and rechecks source/condition on confirm', () => {
    const met = setup({
      abilityId: PL_BP3_024_LIVE_START_SUCCESS_TWO_THIS_LIVE_SCORE_ABILITY_ID,
      successLiveCount: 2,
    });
    const preview = resolvePendingCardEffects(met.game).gameState;
    expect(preview.activeEffect).toMatchObject({
      abilityId: PL_BP3_024_LIVE_START_SUCCESS_TWO_THIS_LIVE_SCORE_ABILITY_ID,
      metadata: { confirmOnlyPendingAbility: true },
    });
    expect(preview.activeEffect?.effectText).toContain('当前自己成功LIVE卡区2张');
    expect(preview.activeEffect?.effectText).toContain('满足条件，实际[スコア]+1');
    expect(scoreModifiers(preview)).toEqual([]);
    const resolved = confirmActiveEffectStep(preview, PLAYER1, preview.activeEffect!.id);
    expect(scoreModifiers(resolved)).toContainEqual(
      expect.objectContaining({ liveCardId: met.sourceCardId, countDelta: 1 })
    );
    expect(resolved.liveResolution.playerScores.get(PLAYER1)).toBe(3);

    const unmet = setup({
      abilityId: PL_BP3_024_LIVE_START_SUCCESS_TWO_THIS_LIVE_SCORE_ABILITY_ID,
      successLiveCount: 1,
    });
    const unmetPreview = resolvePendingCardEffects(unmet.game).gameState;
    expect(unmetPreview.activeEffect?.effectText).toContain('未满足条件，实际不增加分数');
    const sourceRemoved = updatePlayer(unmetPreview, PLAYER1, (player) => ({
      ...player,
      liveZone: removeCardFromStatefulZone(player.liveZone, unmet.sourceCardId),
    }));
    const unmetResolved = confirmActiveEffectStep(
      sourceRemoved,
      PLAYER1,
      sourceRemoved.activeEffect!.id
    );
    expect(scoreModifiers(unmetResolved)).toEqual([]);
    expect(unmetResolved.liveResolution.playerScores.get(PLAYER1)).toBe(2);
  });

  it('auto-resolves ordered score pendings and gives a manually selected score pending its confirm-only preview', () => {
    const createMultipleScorePendingScenario = (suffix: string) => {
      const base = setup({
        abilityId: PL_BP3_024_LIVE_START_SUCCESS_TWO_THIS_LIVE_SCORE_ABILITY_ID,
        successLiveCount: 2,
      });
      const secondSource = createCardInstance(
        createNatsuiroEgao(),
        PLAYER1,
        `natsuiro-egao-second-${suffix}`
      );
      let game = registerCards(base.game, [secondSource]);
      game = updatePlayer(game, PLAYER1, (player) => ({
        ...player,
        liveZone: addCardToStatefulZone(player.liveZone, secondSource.instanceId),
      }));
      game = {
        ...game,
        pendingAbilities: [
          pendingAbility(
            PL_BP3_024_LIVE_START_SUCCESS_TWO_THIS_LIVE_SCORE_ABILITY_ID,
            base.sourceCardId,
            `score-first-${suffix}`
          ),
          pendingAbility(
            PL_BP3_024_LIVE_START_SUCCESS_TWO_THIS_LIVE_SCORE_ABILITY_ID,
            secondSource.instanceId,
            `score-second-${suffix}`
          ),
        ],
      };
      return { game, secondSourceCardId: secondSource.instanceId };
    };

    const orderedScenario = createMultipleScorePendingScenario('ordered');
    const orderedChoice = resolvePendingCardEffects(orderedScenario.game).gameState;
    expect(orderedChoice.activeEffect?.canResolveInOrder).toBe(true);
    const ordered = confirmActiveEffectStep(
      orderedChoice,
      PLAYER1,
      orderedChoice.activeEffect!.id,
      undefined,
      undefined,
      true
    );
    expect(ordered.activeEffect).toBeNull();
    expect(ordered.pendingAbilities).toEqual([]);
    expect(scoreModifiers(ordered)).toHaveLength(2);

    const manualScenario = createMultipleScorePendingScenario('manual');
    const manualChoice = resolvePendingCardEffects(manualScenario.game).gameState;
    const preview = confirmActiveEffectStep(
      manualChoice,
      PLAYER1,
      manualChoice.activeEffect!.id,
      manualScenario.secondSourceCardId
    );
    expect(preview.activeEffect).toMatchObject({
      abilityId: PL_BP3_024_LIVE_START_SUCCESS_TWO_THIS_LIVE_SCORE_ABILITY_ID,
      sourceCardId: manualScenario.secondSourceCardId,
      metadata: { confirmOnlyPendingAbility: true },
    });
    expect(preview.activeEffect?.effectText).toContain('当前自己成功LIVE卡区2张');
    expect(scoreModifiers(preview)).toEqual([]);

    const confirmed = confirmActiveEffectStep(preview, PLAYER1, preview.activeEffect!.id);
    expect(scoreModifiers(confirmed)).toContainEqual(
      expect.objectContaining({ sourceCardId: manualScenario.secondSourceCardId })
    );
  });
});
