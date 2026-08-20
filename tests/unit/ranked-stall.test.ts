import { describe, expect, it } from 'vitest';
import { PUBLIC_CARD_SELECTION_CONFIRMATION_STEP_ID } from '../../src/application/card-effects/runtime/public-card-selection-confirmation';
import { PUBLIC_REVEAL_DWELL_STEP_ID } from '../../src/application/card-effects/runtime/public-reveal-dwell';
import {
  createGameState,
  type ActiveEffectState,
  type GameState,
} from '../../src/domain/entities/game';
import { describeRankedSinglePlayerWait } from '../../src/online/ranked-stall';
import { GamePhase, SlotPosition, SubPhase, ZoneType } from '../../src/shared/types/enums';

const PLAYER_ONE = 'stall-player-one';
const PLAYER_TWO = 'stall-player-two';

function createStartedGame(overrides: Partial<GameState> = {}): GameState {
  return {
    ...createGameState('ranked-stall-test', PLAYER_ONE, '玩家一', PLAYER_TWO, '玩家二'),
    isStarted: true,
    currentPhase: GamePhase.MAIN_PHASE,
    currentSubPhase: SubPhase.NONE,
    ...overrides,
  };
}

function createActiveEffect(overrides: Partial<ActiveEffectState> = {}): ActiveEffectState {
  return {
    id: 'effect-1',
    abilityId: 'ability-1',
    sourceCardId: 'source-card-1',
    controllerId: PLAYER_ONE,
    effectText: '测试效果',
    stepId: 'choose',
    stepText: '请选择',
    awaitingPlayerId: PLAYER_ONE,
    ...overrides,
  };
}

describe('排位单一责任玩家查询', () => {
  it('按命令闸门优先级识别特殊登场、费用、效果、选择与检视', () => {
    const special = createStartedGame({
      pendingSpecialMemberPlay: {
        id: 'special-1',
        playerId: PLAYER_TWO,
        sourceCardId: 'member-1',
        targetSlot: SlotPosition.LEFT,
        candidateCardIds: [],
        mode: 'LL_BP7_001_SPECIAL_PLAY',
        printedCost: 15,
        specialPlayCost: 10,
      },
      pendingCostPayment: {
        id: 'cost-ignored',
        playerId: PLAYER_ONE,
        source: 'PLAY_MEMBER',
        sourceCardId: 'member-2',
        baseCost: 1,
        finalEnergyCost: 1,
        relayDiscount: 0,
        replacedMemberCardId: null,
        payableEnergyCardIds: [],
      },
    });
    expect(describeRankedSinglePlayerWait(special)).toEqual({
      key: 'pending-special-member-play:special-1',
      playerId: PLAYER_TWO,
    });

    const cost = createStartedGame({
      pendingCostPayment: {
        id: 'cost-1',
        playerId: PLAYER_ONE,
        source: 'PLAY_MEMBER',
        sourceCardId: 'member-2',
        baseCost: 1,
        finalEnergyCost: 1,
        relayDiscount: 0,
        replacedMemberCardId: null,
        payableEnergyCardIds: [],
      },
    });
    expect(describeRankedSinglePlayerWait(cost)).toEqual({
      key: 'pending-cost-payment:cost-1',
      playerId: PLAYER_ONE,
    });

    const effect = createStartedGame({
      activeEffect: createActiveEffect({ awaitingPlayerId: PLAYER_TWO }),
      inspectionContext: {
        ownerPlayerId: PLAYER_ONE,
        viewerPlayerId: PLAYER_TWO,
        sourceZone: ZoneType.MAIN_DECK,
      },
    });
    expect(describeRankedSinglePlayerWait(effect)).toEqual({
      key: 'active-effect:effect-1',
      playerId: PLAYER_TWO,
    });

    const choice = createStartedGame({
      pendingChoice: {
        id: 'choice-1',
        playerId: PLAYER_TWO,
        kind: 'SELECT_TARGET',
        sourceAbilityId: 'ability-1',
      },
    });
    expect(describeRankedSinglePlayerWait(choice)).toEqual({
      key: 'pending-choice:choice-1',
      playerId: PLAYER_TWO,
    });

    const inspection = createStartedGame({
      inspectionContext: {
        ownerPlayerId: PLAYER_ONE,
        sourceZone: ZoneType.MAIN_DECK,
      },
    });
    expect(describeRankedSinglePlayerWait(inspection)).toMatchObject({
      key: `inspection:${PLAYER_ONE}:${ZoneType.MAIN_DECK}`,
      playerId: PLAYER_ONE,
    });
  });

  it('Public Reveal Dwell 与其他任一参与者可推进的公开展示不归责给单方', () => {
    const publicReveal = createStartedGame({
      activeEffect: createActiveEffect({
        stepId: PUBLIC_REVEAL_DWELL_STEP_ID,
        publicRevealAutoAdvanceAt: 123_000,
        publicRevealGeneration: 'reveal-1',
        metadata: {
          publicRevealDwellContinuation: {
            mode: 'RESOLVE_CURRENT_STEP',
            effect: createActiveEffect(),
          },
        },
      }),
    });
    expect(describeRankedSinglePlayerWait(publicReveal)).toBeNull();

    const publicSelection = createStartedGame({
      activeEffect: createActiveEffect({
        stepId: PUBLIC_CARD_SELECTION_CONFIRMATION_STEP_ID,
        publicCardSelectionAutoAdvanceAt: 123_000,
        metadata: { publicCardSelectionConfirmationContinuation: {} },
      }),
    });
    expect(describeRankedSinglePlayerWait(publicSelection)).toBeNull();
  });

  it.each([
    [GamePhase.MULLIGAN_PHASE, SubPhase.MULLIGAN_FIRST_PLAYER, PLAYER_ONE],
    [GamePhase.MULLIGAN_PHASE, SubPhase.MULLIGAN_SECOND_PLAYER, PLAYER_TWO],
    [GamePhase.MAIN_PHASE, SubPhase.NONE, PLAYER_ONE],
    [GamePhase.LIVE_SET_PHASE, SubPhase.LIVE_SET_FIRST_PLAYER, PLAYER_ONE],
    [GamePhase.LIVE_SET_PHASE, SubPhase.LIVE_SET_SECOND_PLAYER, PLAYER_TWO],
    [GamePhase.PERFORMANCE_PHASE, SubPhase.PERFORMANCE_LIVE_START_EFFECTS, PLAYER_TWO],
    [GamePhase.PERFORMANCE_PHASE, SubPhase.PERFORMANCE_JUDGMENT, PLAYER_TWO],
    [GamePhase.LIVE_RESULT_PHASE, SubPhase.RESULT_FIRST_SUCCESS_EFFECTS, PLAYER_ONE],
    [GamePhase.LIVE_RESULT_PHASE, SubPhase.RESULT_SECOND_SUCCESS_EFFECTS, PLAYER_TWO],
  ] as const)('识别 %s / %s 的唯一行动玩家', (phase, subPhase, expectedPlayerId) => {
    const game = createStartedGame({
      currentPhase: phase,
      currentSubPhase: subPhase,
      firstPlayerIndex: 0,
      activePlayerIndex:
        subPhase === SubPhase.PERFORMANCE_LIVE_START_EFFECTS ||
        subPhase === SubPhase.PERFORMANCE_JUDGMENT
          ? 1
          : 0,
    });
    expect(describeRankedSinglePlayerWait(game)?.playerId).toBe(expectedPlayerId);
  });

  it('双方分数都未确认时不归责，只剩一方时归责给未确认方', () => {
    const bothPending = createStartedGame({
      currentPhase: GamePhase.LIVE_RESULT_PHASE,
      currentSubPhase: SubPhase.RESULT_SCORE_CONFIRM,
    });
    expect(describeRankedSinglePlayerWait(bothPending)).toBeNull();

    const onePending = {
      ...bothPending,
      liveResolution: {
        ...bothPending.liveResolution,
        scoreConfirmedBy: [PLAYER_ONE],
      },
    };
    expect(describeRankedSinglePlayerWait(onePending)?.playerId).toBe(PLAYER_TWO);
  });

  it('结果结算只归责给当前尚未完成结算的胜者', () => {
    const game = createStartedGame({
      currentPhase: GamePhase.LIVE_RESULT_PHASE,
      currentSubPhase: SubPhase.RESULT_SETTLEMENT,
    });
    const settlement = {
      ...game,
      liveResolution: {
        ...game.liveResolution,
        liveWinnerIds: [PLAYER_TWO, PLAYER_ONE],
        settlementConfirmedBy: [PLAYER_TWO],
      },
    };
    expect(describeRankedSinglePlayerWait(settlement)?.playerId).toBe(PLAYER_ONE);
  });

  it('自动阶段、双方都能行动的窗口和已结束对局不产生单方责任', () => {
    expect(
      describeRankedSinglePlayerWait(
        createStartedGame({
          currentPhase: GamePhase.ACTIVE_PHASE,
          currentSubPhase: SubPhase.NONE,
        })
      )
    ).toBeNull();
    expect(
      describeRankedSinglePlayerWait(
        createStartedGame({
          currentPhase: GamePhase.LIVE_RESULT_PHASE,
          currentSubPhase: SubPhase.RESULT_ANIMATION,
        })
      )
    ).toBeNull();
    expect(describeRankedSinglePlayerWait(createStartedGame({ isEnded: true }))).toBeNull();
  });
});
