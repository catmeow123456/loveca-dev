import { describe, expect, it } from 'vitest';
import type { LiveCardData, MemberCardData } from '../../src/domain/entities/card';
import {
  createCardInstance,
  createHeartIcon,
  createHeartRequirement,
} from '../../src/domain/entities/card';
import {
  createGameState,
  getCardById,
  registerCards,
  updateLiveResolution,
  updatePlayer,
  type GameState,
} from '../../src/domain/entities/game';
import { placeCardInSlot } from '../../src/domain/entities/zone';
import {
  confirmActiveEffectStep,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import { N_BP5_028_LIVE_START_RED_HEART_MEMBER_THIS_LIVE_SCORE_REQUIREMENT_ABILITY_ID } from '../../src/application/card-effects/ability-ids';
import {
  getLiveCardRequirementModifiers,
} from '../../src/domain/rules/live-modifiers';
import { applyHeartRequirementModifiers } from '../../src/domain/rules/live-requirement-modifiers';
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

function createChaseLive(): LiveCardData {
  return {
    cardCode: 'PL!N-bp5-028-L',
    name: 'CHASE!',
    groupNames: ['虹ヶ咲'],
    cardType: CardType.LIVE,
    score: 1,
    requirements: createHeartRequirement({
      [HeartColor.PINK]: 2,
      [HeartColor.YELLOW]: 1,
    }),
  };
}

function createMember(redHeartCount: number): MemberCardData {
  return {
    cardCode: 'CHASE-MEMBER',
    name: 'CHASE Member',
    groupNames: ['虹ヶ咲'],
    cardType: CardType.MEMBER,
    cost: 1,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.RED, redHeartCount)],
  };
}

function setupChaseScenario(options: {
  readonly redHeartCount: number;
  readonly removeLiveSource?: boolean;
  readonly secondLive?: boolean;
}): GameState {
  const live = createCardInstance(createChaseLive(), PLAYER1, 'chase-live');
  const secondLive = createCardInstance(createChaseLive(), PLAYER1, 'chase-live-2');
  const member = createCardInstance(createMember(options.redHeartCount), PLAYER1, 'chase-member');
  let game = createGameState('n-bp5-028-chase', PLAYER1, 'P1', PLAYER2, 'P2');
  game = registerCards(game, [live, secondLive, member]);
  game = updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    liveZone: {
      ...player.liveZone,
      cardIds: options.removeLiveSource
        ? []
        : [live.instanceId, ...(options.secondLive ? [secondLive.instanceId] : [])],
    },
    memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.CENTER, member.instanceId, {
      orientation: OrientationState.ACTIVE,
      face: FaceState.FACE_UP,
    }),
  }));
  game = updateLiveResolution(game, (liveResolution) => {
    const playerScores = new Map(liveResolution.playerScores);
    playerScores.set(PLAYER1, 1);
    return { ...liveResolution, playerScores };
  });
  return {
    ...game,
    pendingAbilities: [
      {
        id: 'chase-live-start',
        abilityId: N_BP5_028_LIVE_START_RED_HEART_MEMBER_THIS_LIVE_SCORE_REQUIREMENT_ABILITY_ID,
        sourceCardId: live.instanceId,
        controllerId: PLAYER1,
        mandatory: true,
        timingId: TriggerCondition.ON_LIVE_START,
        eventIds: ['chase-live-start'],
      },
      ...(options.secondLive
        ? [
            {
              id: 'chase-live-start-2',
              abilityId:
                N_BP5_028_LIVE_START_RED_HEART_MEMBER_THIS_LIVE_SCORE_REQUIREMENT_ABILITY_ID,
              sourceCardId: secondLive.instanceId,
              controllerId: PLAYER1,
              mandatory: true,
              timingId: TriggerCondition.ON_LIVE_START,
              eventIds: ['chase-live-start-2'],
            },
          ]
        : []),
    ],
  };
}

function adjustedRequirement(game: GameState) {
  const live = getCardById(game, 'chase-live');
  if (!live || live.data.cardType !== CardType.LIVE) {
    throw new Error('missing CHASE live card');
  }
  return applyHeartRequirementModifiers(
    live.data.requirements,
    getLiveCardRequirementModifiers(game.liveResolution, live.instanceId)
  );
}

describe('PL!N-bp5-028 CHASE! live-start workflow', () => {
  it('opens confirm-only, adds score, and changes final requirement to exactly five RED Hearts', () => {
    const confirmation = resolvePendingCardEffects(setupChaseScenario({ redHeartCount: 4 })).gameState;

    expect(confirmation.activeEffect?.metadata?.confirmOnlyPendingAbility).toBe(true);
    expect(confirmation.activeEffect?.effectText).toContain('当前舞台成员最多持有4个[赤ハート]');
    expect(confirmation.activeEffect?.effectText).toContain('必要Heart变为5个[赤ハート]');
    expect(confirmation.activeEffect?.effectText).not.toContain('ライブ開始時');
    expect(confirmation.activeEffect?.effectText).not.toContain('确认后');

    const result = confirmIfConfirmOnly(confirmation, PLAYER1);
    const requirement = adjustedRequirement(result);
    expect(result.liveResolution.playerScores.get(PLAYER1)).toBe(3);
    expect(requirement.totalRequired).toBe(5);
    expect(requirement.colorRequirements.get(HeartColor.RED)).toBe(5);
    expect(requirement.colorRequirements.get(HeartColor.PINK) ?? 0).toBe(0);
    expect(requirement.colorRequirements.get(HeartColor.YELLOW) ?? 0).toBe(0);
    expect(requirement.colorRequirements.get(HeartColor.RAINBOW) ?? 0).toBe(0);
  });

  it('no-ops without a member holding four RED Hearts or when the LIVE source left the live zone', () => {
    for (const options of [{ redHeartCount: 3 }, { redHeartCount: 4, removeLiveSource: true }] as const) {
      const result = confirmIfConfirmOnly(
        resolvePendingCardEffects(setupChaseScenario(options)).gameState,
        PLAYER1
      );
      const requirement = adjustedRequirement(result);

      expect(result.pendingAbilities).toEqual([]);
      expect(result.liveResolution.playerScores.get(PLAYER1)).toBe(1);
      expect(requirement.totalRequired).toBe(3);
      expect(requirement.colorRequirements.get(HeartColor.PINK)).toBe(2);
      expect(requirement.colorRequirements.get(HeartColor.YELLOW)).toBe(1);
      expect(requirement.colorRequirements.get(HeartColor.RED) ?? 0).toBe(0);
    }
  });

  it('resolves multiple no-interaction LIVE_START pending abilities in order without confirm-only prompts', () => {
    const orderSelection = resolvePendingCardEffects(
      setupChaseScenario({ redHeartCount: 4, secondLive: true })
    ).gameState;
    expect(orderSelection.activeEffect?.abilityId).toBe('system:select-pending-card-effect');

    const result = confirmActiveEffectStep(
      orderSelection,
      PLAYER1,
      orderSelection.activeEffect!.id,
      null,
      null,
      true
    );

    expect(result.activeEffect).toBeNull();
    expect(result.pendingAbilities).toEqual([]);
    expect(result.liveResolution.playerScores.get(PLAYER1)).toBe(5);
    expect(
      result.actionHistory.filter(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId ===
            N_BP5_028_LIVE_START_RED_HEART_MEMBER_THIS_LIVE_SCORE_REQUIREMENT_ABILITY_ID &&
          action.payload.step === 'RED_HEART_MEMBER_SCORE_AND_REQUIREMENT'
      )
    ).toHaveLength(2);
  });

  it('shows only a confirm-only bridge before resolving a manually selected LIVE_START pending ability', () => {
    const orderSelection = resolvePendingCardEffects(
      setupChaseScenario({ redHeartCount: 4, secondLive: true })
    ).gameState;
    const preview = confirmActiveEffectStep(
      orderSelection,
      PLAYER1,
      orderSelection.activeEffect!.id,
      'chase-live'
    );

    expect(preview.activeEffect).toMatchObject({
      abilityId: N_BP5_028_LIVE_START_RED_HEART_MEMBER_THIS_LIVE_SCORE_REQUIREMENT_ABILITY_ID,
      sourceCardId: 'chase-live',
      metadata: { confirmOnlyPendingAbility: true },
    });
    expect(preview.activeEffect?.effectText).toContain('当前舞台成员最多持有4个[赤ハート]');
    expect(preview.activeEffect?.stepText).toContain('必要Heart变为5个[赤ハート]');
    expect(preview.activeEffect?.stepText).not.toContain('确认后');
    expect(preview.activeEffect?.selectableCardIds).toBeUndefined();
    expect(preview.activeEffect?.selectableOptions).toBeUndefined();
    expect(preview.liveResolution.playerScores.get(PLAYER1)).toBe(1);

    const afterFirst = confirmActiveEffectStep(preview, PLAYER1, preview.activeEffect!.id);
    expect(afterFirst.activeEffect?.metadata?.confirmOnlyPendingAbility).toBe(true);
    expect(afterFirst.activeEffect?.sourceCardId).toBe('chase-live-2');
  });
});
