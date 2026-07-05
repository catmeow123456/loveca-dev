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
} from '../../src/domain/entities/game';
import { placeCardInSlot } from '../../src/domain/entities/zone';
import {
  confirmActiveEffectStep,
  resolvePendingCardEffects,
} from '../../src/application/card-effect-runner';
import {
  N_BP5_026_LIVE_START_STAGE_SIX_HEARTS_THIS_LIVE_SCORE_ABILITY_ID,
  N_BP5_026_LIVE_SUCCESS_SCORE_THREE_RECOVER_NIJIGASAKI_CARD_ABILITY_ID,
} from '../../src/application/card-effects/ability-ids';
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

function createTokimekiLive(score = 2): LiveCardData {
  return {
    cardCode: 'PL!N-bp5-026-L',
    name: 'TOKIMEKI Runners',
    groupNames: ['虹ヶ咲'],
    cardType: CardType.LIVE,
    score,
    requirements: createHeartRequirement({ [HeartColor.PINK]: 1 }),
  };
}

function createMember(cardCode: string, hearts: readonly HeartColor[]): MemberCardData {
  return {
    cardCode,
    name: cardCode,
    groupNames: ['虹ヶ咲'],
    cardType: CardType.MEMBER,
    cost: 1,
    blade: 1,
    hearts: hearts.map((color) => createHeartIcon(color, 1)),
  };
}

function setupTokimekiScenario(options: {
  readonly allSixHearts?: boolean;
  readonly liveScore?: number;
  readonly waitingNijigasaki?: boolean;
  readonly removeLiveSource?: boolean;
  readonly secondLive?: boolean;
  readonly abilityId: string;
}): GameState {
  const live = createCardInstance(
    createTokimekiLive(options.liveScore ?? 2),
    PLAYER1,
    'tokimeki-live'
  );
  const secondLive = createCardInstance(
    createTokimekiLive(options.liveScore ?? 2),
    PLAYER1,
    'tokimeki-live-2'
  );
  const center = createCardInstance(
    createMember('TOKIMEKI-MEMBER-1', [HeartColor.PINK, HeartColor.RED]),
    PLAYER1,
    'tokimeki-member-1'
  );
  const left = createCardInstance(
    createMember('TOKIMEKI-MEMBER-2', [HeartColor.YELLOW, HeartColor.GREEN]),
    PLAYER1,
    'tokimeki-member-2'
  );
  const right = createCardInstance(
    createMember(
      'TOKIMEKI-MEMBER-3',
      options.allSixHearts === false ? [HeartColor.BLUE] : [HeartColor.BLUE, HeartColor.PURPLE]
    ),
    PLAYER1,
    'tokimeki-member-3'
  );
  const recoveryTarget = createCardInstance(
    createMember('TOKIMEKI-WAITING-NIJI', [HeartColor.PINK]),
    PLAYER1,
    'tokimeki-waiting-niji'
  );
  let game = createGameState('n-bp5-026-tokimeki', PLAYER1, 'P1', PLAYER2, 'P2');
  game = registerCards(game, [live, secondLive, center, left, right, recoveryTarget]);
  game = updatePlayer(game, PLAYER1, (player) => ({
    ...player,
    liveZone: {
      ...player.liveZone,
      cardIds: options.removeLiveSource
        ? []
        : [live.instanceId, ...(options.secondLive ? [secondLive.instanceId] : [])],
    },
    memberSlots: placeCardInSlot(
      placeCardInSlot(
        placeCardInSlot(player.memberSlots, SlotPosition.CENTER, center.instanceId, {
          orientation: OrientationState.ACTIVE,
          face: FaceState.FACE_UP,
        }),
        SlotPosition.LEFT,
        left.instanceId,
        {
          orientation: OrientationState.ACTIVE,
          face: FaceState.FACE_UP,
        }
      ),
      SlotPosition.RIGHT,
      right.instanceId,
      {
        orientation: OrientationState.ACTIVE,
        face: FaceState.FACE_UP,
      }
    ),
    waitingRoom: {
      ...player.waitingRoom,
      cardIds: options.waitingNijigasaki ? [recoveryTarget.instanceId] : [],
    },
  }));
  game = updateLiveResolution(game, (liveResolution) => {
    const playerScores = new Map(liveResolution.playerScores);
    playerScores.set(PLAYER1, options.liveScore ?? 2);
    return { ...liveResolution, playerScores };
  });
  return {
    ...game,
    pendingAbilities: [
      {
        id: `tokimeki-${options.abilityId}`,
        abilityId: options.abilityId,
        sourceCardId: live.instanceId,
        controllerId: PLAYER1,
        mandatory: true,
        timingId:
          options.abilityId === N_BP5_026_LIVE_START_STAGE_SIX_HEARTS_THIS_LIVE_SCORE_ABILITY_ID
            ? TriggerCondition.ON_LIVE_START
            : TriggerCondition.ON_LIVE_SUCCESS,
        eventIds: ['tokimeki-event'],
      },
      ...(options.secondLive
        ? [
            {
              id: `tokimeki-${options.abilityId}-2`,
              abilityId: options.abilityId,
              sourceCardId: secondLive.instanceId,
              controllerId: PLAYER1,
              mandatory: true,
              timingId:
                options.abilityId ===
                N_BP5_026_LIVE_START_STAGE_SIX_HEARTS_THIS_LIVE_SCORE_ABILITY_ID
                  ? TriggerCondition.ON_LIVE_START
                  : TriggerCondition.ON_LIVE_SUCCESS,
              eventIds: ['tokimeki-event-2'],
            },
          ]
        : []),
    ],
  };
}

describe('PL!N-bp5-026 TOKIMEKI Runners workflows', () => {
  it('opens confirm-only and adds this LIVE score when stage members have all six Heart colors', () => {
    const game = setupTokimekiScenario({
      allSixHearts: true,
      abilityId: N_BP5_026_LIVE_START_STAGE_SIX_HEARTS_THIS_LIVE_SCORE_ABILITY_ID,
    });
    const confirmation = resolvePendingCardEffects(game).gameState;

    expect(confirmation.activeEffect?.metadata?.confirmOnlyPendingAbility).toBe(true);
    expect(confirmation.activeEffect?.effectText).toContain(
      '当前舞台已集齐[桃ハート]、[赤ハート]、[黄ハート]、[緑ハート]、[青ハート]、[紫ハート]'
    );
    expect(confirmation.activeEffect?.effectText).not.toContain('ライブ開始時');
    expect(confirmation.activeEffect?.effectText).not.toContain('确认后');

    const result = confirmIfConfirmOnly(confirmation, PLAYER1);
    expect(result.pendingAbilities).toEqual([]);
    expect(result.liveResolution.playerScores.get(PLAYER1)).toBe(3);
    expect(
      result.liveResolution.liveModifiers.some(
        (modifier) =>
          modifier.kind === 'SCORE' &&
          modifier.abilityId ===
            N_BP5_026_LIVE_START_STAGE_SIX_HEARTS_THIS_LIVE_SCORE_ABILITY_ID &&
          modifier.liveCardId === 'tokimeki-live' &&
          modifier.countDelta === 1
      )
    ).toBe(true);
  });

  it('does not add score without all six Heart colors or when the LIVE source left the live zone', () => {
    for (const options of [
      { allSixHearts: false },
      { allSixHearts: true, removeLiveSource: true },
    ] as const) {
      const result = confirmIfConfirmOnly(
        resolvePendingCardEffects(
          setupTokimekiScenario({
            ...options,
            abilityId: N_BP5_026_LIVE_START_STAGE_SIX_HEARTS_THIS_LIVE_SCORE_ABILITY_ID,
          })
        ).gameState,
        PLAYER1
      );

      expect(result.pendingAbilities).toEqual([]);
      expect(result.liveResolution.playerScores.get(PLAYER1)).toBe(2);
    }
  });

  it('resolves multiple no-interaction LIVE_START pending abilities in order without confirm-only prompts', () => {
    const game = setupTokimekiScenario({
      allSixHearts: true,
      secondLive: true,
      abilityId: N_BP5_026_LIVE_START_STAGE_SIX_HEARTS_THIS_LIVE_SCORE_ABILITY_ID,
    });
    const orderSelection = resolvePendingCardEffects(game).gameState;
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
    expect(result.liveResolution.playerScores.get(PLAYER1)).toBe(4);
    expect(
      result.actionHistory.filter(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId ===
            N_BP5_026_LIVE_START_STAGE_SIX_HEARTS_THIS_LIVE_SCORE_ABILITY_ID &&
          action.payload.step === 'STAGE_SIX_HEARTS_THIS_LIVE_SCORE'
      )
    ).toHaveLength(2);
  });

  it('shows only a confirm-only bridge before resolving a manually selected LIVE_START pending ability', () => {
    const game = setupTokimekiScenario({
      allSixHearts: true,
      secondLive: true,
      abilityId: N_BP5_026_LIVE_START_STAGE_SIX_HEARTS_THIS_LIVE_SCORE_ABILITY_ID,
    });
    const orderSelection = resolvePendingCardEffects(game).gameState;
    const preview = confirmActiveEffectStep(
      orderSelection,
      PLAYER1,
      orderSelection.activeEffect!.id,
      'tokimeki-live'
    );

    expect(preview.activeEffect).toMatchObject({
      abilityId: N_BP5_026_LIVE_START_STAGE_SIX_HEARTS_THIS_LIVE_SCORE_ABILITY_ID,
      sourceCardId: 'tokimeki-live',
      metadata: { confirmOnlyPendingAbility: true },
    });
    expect(preview.activeEffect?.effectText).toContain('当前舞台已集齐');
    expect(preview.activeEffect?.stepText).toContain('此LIVE分数+1');
    expect(preview.activeEffect?.stepText).not.toContain('确认后');
    expect(preview.activeEffect?.selectableCardIds).toBeUndefined();
    expect(preview.activeEffect?.selectableOptions).toBeUndefined();
    expect(preview.liveResolution.playerScores.get(PLAYER1)).toBe(2);

    const afterFirst = confirmActiveEffectStep(preview, PLAYER1, preview.activeEffect!.id);
    expect(afterFirst.activeEffect?.metadata?.confirmOnlyPendingAbility).toBe(true);
    expect(afterFirst.activeEffect?.sourceCardId).toBe('tokimeki-live-2');
  });

  it('recovers one Nijigasaki card from waiting room when this LIVE score is 3', () => {
    const game = setupTokimekiScenario({
      liveScore: 3,
      waitingNijigasaki: true,
      abilityId: N_BP5_026_LIVE_SUCCESS_SCORE_THREE_RECOVER_NIJIGASAKI_CARD_ABILITY_ID,
    });
    const selection = resolvePendingCardEffects(game).gameState;

    expect(selection.activeEffect?.stepText).toContain('请选择自己的休息室1张');
    expect(selection.activeEffect?.effectText).toContain('【LIVE成功时】');

    const result = confirmActiveEffectStep(
      selection,
      PLAYER1,
      selection.activeEffect!.id,
      'tokimeki-waiting-niji'
    );
    expect(result.activeEffect).toBeNull();
    expect(result.players[0]!.hand.cardIds).toEqual(['tokimeki-waiting-niji']);
    expect(result.players[0]!.waitingRoom.cardIds).toEqual([]);
  });

  it('consumes live-success pending as no-op when score is not 3 or there is no target', () => {
    for (const options of [
      { liveScore: 2, waitingNijigasaki: true },
      { liveScore: 4, waitingNijigasaki: true },
      { liveScore: 3, waitingNijigasaki: false },
    ] as const) {
      const result = confirmIfConfirmOnly(
        resolvePendingCardEffects(
          setupTokimekiScenario({
            ...options,
            abilityId: N_BP5_026_LIVE_SUCCESS_SCORE_THREE_RECOVER_NIJIGASAKI_CARD_ABILITY_ID,
          })
        ).gameState,
        PLAYER1
      );

      expect(result.pendingAbilities).toEqual([]);
      expect(result.players[0]!.hand.cardIds).toEqual([]);
    }
  });

  it('uses this LIVE score, not player total score or another LIVE score modifier', () => {
    let game = setupTokimekiScenario({
      liveScore: 2,
      waitingNijigasaki: true,
      abilityId: N_BP5_026_LIVE_SUCCESS_SCORE_THREE_RECOVER_NIJIGASAKI_CARD_ABILITY_ID,
    });
    game = updateLiveResolution(game, (liveResolution) => ({
      ...liveResolution,
      playerScores: new Map([[PLAYER1, 3]]),
      liveModifiers: [
        ...liveResolution.liveModifiers,
        {
          kind: 'SCORE',
          playerId: PLAYER1,
          countDelta: 1,
          liveCardId: 'another-live',
          sourceCardId: 'another-live',
          abilityId: 'test:another-live-score',
        },
      ],
    }));

    const result = confirmIfConfirmOnly(resolvePendingCardEffects(game).gameState, PLAYER1);

    expect(result.pendingAbilities).toEqual([]);
    expect(result.players[0]!.hand.cardIds).toEqual([]);
    expect(
      result.actionHistory.find(
        (action) =>
          action.type === 'RESOLVE_ABILITY' &&
          action.payload.abilityId ===
            N_BP5_026_LIVE_SUCCESS_SCORE_THREE_RECOVER_NIJIGASAKI_CARD_ABILITY_ID
      )?.payload
    ).toMatchObject({
      step: 'LIVE_SCORE_NOT_THREE',
      currentScore: 2,
    });
  });
});
