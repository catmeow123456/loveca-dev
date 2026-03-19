/**
 * Live 设置阶段卡牌朝向/盖放规则测试
 *
 * 规则要点（detail_rules.md）：
 * - Live 设置阶段，玩家可以从手牌选择最多 3 张卡里侧放到 Live 区
 * - 卡牌类型不应在此阶段被前端/系统强行限制（成员卡也可被“盖放”到 Live 区）
 * - 到 GamePhase.PERFORMANCE_PHASE 才会把 Live 区卡牌翻为表侧
 *
 * 这个测试锁定“成员卡可盖到 Live 区 + Live Set 时必须 FACE_DOWN + Performance 自动翻 FACE_UP”。
 */

import { describe, it, expect } from 'vitest';
import {
  CardType,
  FaceState,
  GamePhase,
  HeartColor,
  SlotPosition,
} from '../../src/shared/types/enums';
import type {
  AnyCardData,
  EnergyCardData,
  LiveCardData,
  MemberCardData,
} from '../../src/domain/entities/card';
import { createHeartIcon, createHeartRequirement } from '../../src/domain/entities/card';
import { GameService, type DeckConfig } from '../../src/application/game-service';
import {
  createEndPhaseAction,
  createMulliganAction,
  createSetLiveCardAction,
  createSkipLiveSetAction,
} from '../../src/application/actions';
import { getPlayerById, getCardById } from '../../src/domain/entities/game';

function createMemberCard(code: string, name: string, cost = 1): MemberCardData {
  return {
    cardCode: code,
    name,
    cardType: CardType.MEMBER,
    cost,
    blade: 1,
    hearts: [createHeartIcon(HeartColor.PINK, 1)],
  };
}

function createLiveCard(code: string, name: string): LiveCardData {
  return {
    cardCode: code,
    name,
    cardType: CardType.LIVE,
    score: 3,
    requirements: createHeartRequirement({ [HeartColor.PINK]: 2 }),
  };
}

function createEnergyCard(code: string): EnergyCardData {
  return { cardCode: code, name: '能量卡', cardType: CardType.ENERGY };
}

function createSimpleDeck(): DeckConfig {
  const mainDeck: AnyCardData[] = [];
  const energyDeck: AnyCardData[] = [];

  for (let i = 0; i < 40; i++) mainDeck.push(createMemberCard(`M-${i}`, `成员${i}`));
  for (let i = 0; i < 14; i++) mainDeck.push(createLiveCard(`L-${i}`, `Live${i}`));
  for (let i = 0; i < 12; i++) energyDeck.push(createEnergyCard(`E-${i}`));

  return { mainDeck, energyDeck };
}

function skipMulligan(
  service: GameService,
  state: import('../../src/domain/entities/game').GameState
) {
  if (state.currentPhase !== GamePhase.MULLIGAN_PHASE) return state;

  const firstPlayerId = state.players[state.firstPlayerIndex].id;
  const secondPlayerIndex = state.firstPlayerIndex === 0 ? 1 : 0;
  const secondPlayerId = state.players[secondPlayerIndex].id;

  let s = service.processAction(state, createMulliganAction(firstPlayerId, [])).gameState;
  s = service.processAction(s, createMulliganAction(secondPlayerId, [])).gameState;
  return s;
}

describe('Live Set face state', () => {
  it('成员卡可以在 Live 设置阶段里侧放到 Live 区，并在表演阶段开始时自动翻为表侧', () => {
    const service = new GameService();
    const game = service.createGame('live-set-face', 'alice', 'Alice', 'bob', 'Bob');
    const init = service.initializeGame(game, createSimpleDeck(), createSimpleDeck());
    expect(init.success).toBe(true);

    let state = skipMulligan(service, init.gameState);

    // 先攻通常阶段：推进到主要阶段并结束
    for (let i = 0; i < 3; i++) state = service.advancePhase(state).gameState;
    state = service.processAction(state, createEndPhaseAction('alice')).gameState;

    // 后攻通常阶段：推进到主要阶段并结束 -> 进入 Live Set
    for (let i = 0; i < 3; i++) state = service.advancePhase(state).gameState;
    state = service.processAction(state, createEndPhaseAction('bob')).gameState;

    expect(state.currentPhase).toBe(GamePhase.LIVE_SET_PHASE);

    // 从先攻玩家手牌找到一张“成员卡”，并里侧放到 Live 区
    const p1 = getPlayerById(state, 'alice');
    expect(p1).toBeTruthy();

    const memberCardId = p1!.hand.cardIds.find(
      (id) => getCardById(state, id)?.data.cardType === CardType.MEMBER
    );
    expect(memberCardId).toBeTruthy();

    const setResult = service.processAction(
      state,
      createSetLiveCardAction('alice', memberCardId!, true)
    );
    expect(setResult.success).toBe(true);
    state = setResult.gameState;

    const p1AfterSet = getPlayerById(state, 'alice')!;
    expect(p1AfterSet.liveZone.cardIds.includes(memberCardId!)).toBe(true);
    expect(p1AfterSet.liveZone.cardStates.get(memberCardId!)?.face).toBe(FaceState.FACE_DOWN);

    // 双方完成 Live 设置 -> 自动进入 PERFORMANCE_PHASE
    state = service.processAction(state, createSkipLiveSetAction('alice')).gameState;
    state = service.processAction(state, createSkipLiveSetAction('bob')).gameState;

    expect(state.currentPhase).toBe(GamePhase.PERFORMANCE_PHASE);

    // 进入 PERFORMANCE_PHASE 时会自动翻开活跃表演方的 Live 区卡牌
    const p1InPerformance = getPlayerById(state, 'alice')!;
    expect(p1InPerformance.liveZone.cardStates.get(memberCardId!)?.face).toBe(FaceState.FACE_UP);
  });
});
