import { describe, expect, it } from 'vitest';
import { createGameSession } from '../../src/application/game-session';
import { GameService, type DeckConfig } from '../../src/application/game-service';
import { acquireHextech } from '../../src/application/hextech/acquire';
import {
  createConfirmStepCommand,
  createMulliganCommand,
} from '../../src/application/game-commands';
import {
  createCardInstance,
  createHeartRequirement,
  type LiveCardData,
  type MemberCardData,
} from '../../src/domain/entities/card';
import { registerCards, updatePlayer, type GameState } from '../../src/domain/entities/game';
import { addCardToStatefulZone, placeCardInSlot } from '../../src/domain/entities/zone';
import {
  collectLiveModifiers,
  getEffectivePerformanceCheerCount,
  getPlayerLiveBladeModifier,
  getPlayerLiveHeartModifiers,
} from '../../src/domain/rules/live-modifiers';
import {
  HeartColor,
  GamePhase,
  SlotPosition,
  SubPhase,
  OrientationState,
} from '../../src/shared/types/enums';
import { projectPlayerViewState } from '../../src/online/projector';
import {
  rehydrateAuthorityGameState,
  serializeReplayPayload,
} from '../../src/server/services/replay-payload-serialization';
import { GAME_STATE_SCHEMA_VERSION } from '../../src/server/services/replay-constants';
import type { InitialHextechSetup } from '../../src/domain/hextech/state';

const member: MemberCardData = {
  cardCode: 'TEST-M',
  name: '测试成员',
  cardType: 'MEMBER',
  cost: 1,
  blade: 1,
  hearts: [],
};
const song: LiveCardData = {
  cardCode: 'TEST-L',
  name: '测试歌曲',
  cardType: 'LIVE',
  score: 3,
  requirements: createHeartRequirement({ [HeartColor.PINK]: 1, [HeartColor.RED]: 1 }),
};
const deck: DeckConfig = {
  mainDeck: Array.from({ length: 60 }, () => member),
  energyDeck: Array.from({ length: 12 }, () => ({
    cardCode: 'TEST-E',
    name: '能量',
    cardType: 'ENERGY',
  })),
};

function begin(setup: InitialHextechSetup) {
  const session = createGameSession({ randomInt: (max) => max - 1 });
  session.createGame('hextech-second-batch', 'p1', 'P1', 'p2', 'P2', setup);
  expect(session.initializeGame(deck, deck).success).toBe(true);
  expect(session.executeCommand(createMulliganCommand('p1', [])).success).toBe(true);
  expect(session.executeCommand(createMulliganCommand('p2', [])).success).toBe(true);
  return session;
}

describe('海克斯第二批：公开条件与声援数量', () => {
  it('你也是区按成功区张数提供万能心，实际改变 LIVE 成败并与玩家加分叠加', () => {
    const session = begin([['you-are-also-a-zone', 'original-ice-cream'], []]);
    let game = registerCards(session.state!, [
      createCardInstance(song, 'p1', 'song'),
      createCardInstance(song, 'p1', 'success-1'),
      createCardInstance(song, 'p1', 'success-2'),
    ]);
    game = updatePlayer(game, 'p1', (player) => ({
      ...player,
      liveZone: addCardToStatefulZone(player.liveZone, 'song'),
    }));
    game = {
      ...game,
      currentPhase: GamePhase.PERFORMANCE_PHASE,
      currentSubPhase: SubPhase.PERFORMANCE_JUDGMENT,
    };

    const judge = (state: GameState) =>
      new GameService().processAction(state, {
        type: 'CONFIRM_JUDGMENT',
        playerId: 'p1',
        timestamp: 1,
        judgmentResults: new Map(),
      });
    const noSuccessZone = judge(game);
    expect(noSuccessZone.success, noSuccessZone.error).toBe(true);
    expect(noSuccessZone.gameState.liveResolution.liveResults.get('song')).toBe(false);
    expect(noSuccessZone.gameState.liveResolution.playerScores.get('p1')).toBe(0);

    const oneSuccess = updatePlayer(game, 'p1', (player) => ({
      ...player,
      successZone: { ...player.successZone, cardIds: ['success-1'] },
    }));
    expect(
      getPlayerLiveHeartModifiers(oneSuccess.liveResolution, 'p1', collectLiveModifiers(oneSuccess))
    ).toEqual([{ color: HeartColor.RAINBOW, count: 1 }]);
    expect(judge(oneSuccess).gameState.liveResolution.liveResults.get('song')).toBe(false);

    const twoSuccess = updatePlayer(oneSuccess, 'p1', (player) => ({
      ...player,
      successZone: { ...player.successZone, cardIds: ['success-1', 'success-2'] },
    }));
    const result = judge(twoSuccess);
    expect(result.success, result.error).toBe(true);
    expect(result.gameState.liveResolution.liveResults.get('song')).toBe(true);
    expect(result.gameState.liveResolution.playerScores.get('p1')).toBe(4);
    for (const viewer of ['p1', 'p2']) {
      const view = projectPlayerViewState(twoSuccess, viewer);
      expect(view.match.liveResult!.heartBonuses.FIRST).toEqual([
        { color: HeartColor.RAINBOW, count: 2 },
      ]);
      expect(view.match.hextech!.owned.map((item) => item.name)).toEqual([
        '你也是区',
        '原味冰淇淋',
      ]);
    }
    expect(
      getPlayerLiveHeartModifiers(twoSuccess.liveResolution, 'p2', collectLiveModifiers(twoSuccess))
    ).toEqual([]);
  });

  it('团魂要求三名舞台成员共享团体，待机成员仍计入条件，实际声援再叠加偏差认知', () => {
    const session = begin([['group-spirit', 'perception-bias'], []]);
    const withGroups = (id: string, groupNames: string[]) =>
      createCardInstance({ ...member, groupNames }, 'p1', id);
    let game = registerCards(session.state!, [
      withGroups('left', ["μ's"]),
      withGroups('center', ["μ's", '虹ヶ咲']),
      withGroups('right', ["μ's"]),
      withGroups('aqours', ['Aqours']),
      createCardInstance(song, 'p1', 'song'),
    ]);
    game = updatePlayer(game, 'p1', (player) => ({
      ...player,
      liveZone: addCardToStatefulZone(player.liveZone, 'song'),
      memberSlots: placeCardInSlot(
        placeCardInSlot(
          placeCardInSlot(player.memberSlots, SlotPosition.LEFT, 'left'),
          SlotPosition.CENTER,
          'center'
        ),
        SlotPosition.RIGHT,
        'right',
        OrientationState.WAITING
      ),
    }));
    game = {
      ...game,
      currentPhase: GamePhase.PERFORMANCE_PHASE,
      currentSubPhase: SubPhase.PERFORMANCE_LIVE_START_EFFECTS,
      liveResolution: { ...game.liveResolution, isInLive: true, performingPlayerId: 'p1' },
    };
    expect(getPlayerLiveBladeModifier(game.liveResolution, 'p1', collectLiveModifiers(game))).toBe(
      3
    );
    expect(getEffectivePerformanceCheerCount(game, 'p1', 5)).toBe(9);
    expect(getEffectivePerformanceCheerCount(game, 'p2', 0)).toBe(0);
    session.restoreRuntimeState({ authorityState: game, currentPublicSeq: 0 });
    const cheer = session.executeCommand(
      createConfirmStepCommand('p1', SubPhase.PERFORMANCE_LIVE_START_EFFECTS)
    );
    expect(cheer.success, cheer.error).toBe(true);
    expect(session.state!.liveResolution.firstPlayerCheerCardIds).toHaveLength(9);

    const mixedStage = updatePlayer(game, 'p1', (player) => ({
      ...player,
      memberSlots: placeCardInSlot(player.memberSlots, SlotPosition.RIGHT, 'aqours'),
    }));
    expect(
      getPlayerLiveBladeModifier(mixedStage.liveResolution, 'p1', collectLiveModifiers(mixedStage))
    ).toBe(0);
    expect(getEffectivePerformanceCheerCount(mixedStage, 'p1', 2)).toBe(6);
  });

  it('偏差认知按取得后的回合递减至零，后取得的实例独立计时且恢复不重算取得时点', () => {
    const session = begin([['perception-bias'], []]);
    const service = new GameService();
    let game = session.state!;
    for (const [turn, extraCheer] of [
      [1, 4],
      [2, 3],
      [3, 2],
      [4, 1],
      [5, 0],
    ] as const) {
      expect(game.turnCount).toBe(turn);
      expect(
        getPlayerLiveBladeModifier(game.liveResolution, 'p1', collectLiveModifiers(game))
      ).toBe(0);
      expect(getEffectivePerformanceCheerCount(game, 'p1', 2)).toBe(2 + extraCheer);
      if (turn === 5) break;
      const settled = service.finalizeLiveResult({
        ...game,
        currentPhase: GamePhase.LIVE_RESULT_PHASE,
        currentSubPhase: SubPhase.RESULT_SETTLEMENT,
      }).gameState;
      game = service.advancePhase(settled).gameState;
    }

    const late = acquireHextech(game, 'p2', 'perception-bias', 'late-perception-bias');
    expect(late.success, late.error).toBe(true);
    expect(getEffectivePerformanceCheerCount(late.gameState, 'p2', 0)).toBe(4);
    expect(getEffectivePerformanceCheerCount(late.gameState, 'p1', 0)).toBe(0);
    const restored = rehydrateAuthorityGameState(
      serializeReplayPayload(late.gameState, 'AUTHORITY_GAME_STATE', GAME_STATE_SCHEMA_VERSION)
    );
    expect(restored.hextech!.owned.map((item) => item.acquiredTurn)).toEqual([1, 5]);
    expect(getEffectivePerformanceCheerCount(restored, 'p2', 0)).toBe(4);
  });
});
