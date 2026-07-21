import { describe, expect, it } from 'vitest';
import {
  createDrawCardToHandCommand,
  createPlayMemberToSlotCommand,
} from '../../src/application/game-commands';
import { createGameSession } from '../../src/application/game-session';
import {
  getManualOperationMode,
  getManualOperationModeSwitchBlockedReason,
  applyAuthoritativeManualOperationModeToCommand,
} from '../../src/application/manual-operation-mode';
import type { DeckConfig } from '../../src/application/game-service';
import {
  createGameState,
  type ActiveEffectState,
  type GameState,
} from '../../src/domain/entities/game';
import type { EnergyCardData, LiveCardData, MemberCardData } from '../../src/domain/entities/card';
import { createHeartIcon, createHeartRequirement } from '../../src/domain/entities/card';
import {
  CardType,
  GamePhase,
  HeartColor,
  SubPhase,
  SlotPosition,
  ZoneType,
} from '../../src/shared/types/enums';

const P1 = 'p1';
const P2 = 'p2';

describe('权威操作模式', () => {
  it('新对局默认规则模式，旧权威态缺字段时按自由模式恢复', () => {
    const fresh = createGameState('fresh', P1, 'P1', P2, 'P2');
    expect(getManualOperationMode(fresh)).toBe('RULES');

    const legacy = { ...fresh, manualOperationMode: undefined };
    expect(getManualOperationMode(legacy)).toBe('FREE');

    const session = createGameSession();
    session.restoreRuntimeState({ authorityState: legacy, currentPublicSeq: 0 });
    expect(session.manualOperationMode).toBe('FREE');
    expect(session.state?.manualOperationMode).toBe('FREE');
    expect(session.getPlayerViewState(P1)?.match.manualOperation?.mode).toBe('FREE');
  });

  it('本地可在安全点直接切换，普通撤销不回滚模式', () => {
    const session = createGameSession();
    session.createGame('local-mode', P1, 'P1', P2, 'P2');
    expect(session.initializeGame(createDeck('A'), createDeck('B')).success).toBe(true);
    forceMainPhase(session.state!);

    const draw = session.executeCommand(createDrawCardToHandCommand(P1));
    expect(draw.success).toBe(true);
    expect(session.setManualOperationMode('FREE').success).toBe(true);
    expect(session.manualOperationMode).toBe('FREE');

    expect(session.undoLastStep().success).toBe(true);
    expect(session.manualOperationMode).toBe('FREE');
    expect(session.getPlayerViewState(P1)?.match.manualOperation?.mode).toBe('FREE');

    expect(session.setManualOperationMode('RULES').success).toBe(true);
    expect(session.manualOperationMode).toBe('RULES');
  });

  it('远程登场命令的免费标记由权威模式重写', () => {
    const forgedFree = createPlayMemberToSlotCommand(P1, 'member-1', SlotPosition.CENTER, {
      freePlay: true,
    });
    expect(applyAuthoritativeManualOperationModeToCommand(forgedFree, 'RULES')).toMatchObject({
      freePlay: false,
    });

    const omittedFree = createPlayMemberToSlotCommand(P1, 'member-1', SlotPosition.CENTER);
    expect(applyAuthoritativeManualOperationModeToCommand(omittedFree, 'FREE')).toMatchObject({
      freePlay: true,
    });
  });

  it('卡效、检视、判定、成功 LIVE 选择与自动子阶段均不是安全切换点', () => {
    const base = {
      ...createGameState('safety', P1, 'P1', P2, 'P2'),
      currentPhase: GamePhase.MAIN_PHASE,
      currentSubPhase: SubPhase.NONE,
      isStarted: true,
    } satisfies GameState;
    expect(getManualOperationModeSwitchBlockedReason(base)).toBeNull();

    const activeEffect = {
      id: 'effect-1',
      abilityId: 'ability-1',
      sourceCardId: 'source-1',
      controllerId: P1,
      effectText: '测试效果',
      stepId: 'STEP',
      stepText: '请处理效果。',
      awaitingPlayerId: P1,
    } satisfies ActiveEffectState;
    expect(getManualOperationModeSwitchBlockedReason({ ...base, activeEffect })).toContain(
      '卡牌效果'
    );
    expect(
      getManualOperationModeSwitchBlockedReason({
        ...base,
        inspectionContext: { ownerPlayerId: P1, sourceZone: ZoneType.MAIN_DECK },
      })
    ).toContain('检视');
    expect(
      getManualOperationModeSwitchBlockedReason({
        ...base,
        currentPhase: GamePhase.PERFORMANCE_PHASE,
        currentSubPhase: SubPhase.PERFORMANCE_JUDGMENT,
      })
    ).toContain('LIVE 判定');
    expect(
      getManualOperationModeSwitchBlockedReason({
        ...base,
        currentPhase: GamePhase.LIVE_RESULT_PHASE,
        currentSubPhase: SubPhase.RESULT_SETTLEMENT,
      })
    ).toContain('成功 LIVE');
    expect(
      getManualOperationModeSwitchBlockedReason({
        ...base,
        currentPhase: GamePhase.ACTIVE_PHASE,
        currentSubPhase: SubPhase.NONE,
      })
    ).toContain('自动处理');
  });
});

function forceMainPhase(state: GameState): void {
  const mutable = state as {
    currentPhase: GamePhase;
    currentSubPhase: SubPhase;
    activePlayerIndex: number;
    waitingPlayerId: string | null;
  };
  mutable.currentPhase = GamePhase.MAIN_PHASE;
  mutable.currentSubPhase = SubPhase.NONE;
  mutable.activePlayerIndex = 0;
  mutable.waitingPlayerId = null;
}

function createDeck(prefix: string): DeckConfig {
  const mainDeck: Array<MemberCardData | LiveCardData> = [];
  const energyDeck: EnergyCardData[] = [];
  for (let index = 0; index < 48; index += 1) {
    mainDeck.push({
      cardCode: `${prefix}-MEM-${index}`,
      name: `${prefix} 成员 ${index}`,
      cardType: CardType.MEMBER,
      cost: 1,
      blade: 1,
      hearts: [createHeartIcon(HeartColor.PINK, 1)],
    });
  }
  for (let index = 0; index < 12; index += 1) {
    mainDeck.push({
      cardCode: `${prefix}-LIVE-${index}`,
      name: `${prefix} LIVE ${index}`,
      cardType: CardType.LIVE,
      score: 1,
      requirements: createHeartRequirement({ [HeartColor.PINK]: 1 }),
    });
    energyDeck.push({
      cardCode: `${prefix}-ENERGY-${index}`,
      name: `${prefix} 能量 ${index}`,
      cardType: CardType.ENERGY,
    });
  }
  return { mainDeck, energyDeck };
}
