import { createRequire } from 'node:module';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PhaseIndicator } from '../../client/src/components/game/PhaseIndicator';
import {
  createPhaseCompletionTimeGateDeadline,
  dispatchPhaseAction,
  getPhaseCompletionTimeGateCountdownSeconds,
  getPhaseCompletionTimeGateRemainingMs,
  isPhaseCompletionTimeGateHint,
} from '../../client/src/lib/phaseCompletionTimeGate';
import { useGameStore } from '../../client/src/store/gameStore';
import { GameCommandType } from '../../src/application/game-commands';
import type { PlayerViewState, ViewCommandHint } from '../../src/online/types';
import { GameMode, GamePhase, SubPhase } from '../../src/shared/types/enums';

vi.mock('@/lib/imageService', () => ({
  preloadImage: vi.fn(() => Promise.resolve()),
  resolveCardImagePath: vi.fn(() => '/images/medium/mock.webp'),
}));

const requireFromClient = createRequire(new URL('../../client/package.json', import.meta.url));
const { createElement } = requireFromClient('react') as {
  readonly createElement: (...args: readonly unknown[]) => unknown;
};
const { renderToStaticMarkup } = requireFromClient('react-dom/server') as {
  readonly renderToStaticMarkup: (element: unknown) => string;
};

const LOCK_REASON = '阶段开始 3 秒后才能确认完成';

function timeGateHint(command: GameCommandType, availableAfterMs = 3_000): ViewCommandHint {
  return {
    command,
    enabled: false,
    reason: LOCK_REASON,
    availability: {
      kind: 'TIME_GATE',
      windowKey: `turn:1|phase:test|subPhase:test|actingSeat:FIRST|entry:1`,
      availableAfterMs,
    },
  };
}

function createViewState(
  phase: GamePhase,
  subPhase: SubPhase,
  availableCommands: readonly ViewCommandHint[]
): PlayerViewState {
  return {
    match: {
      matchId: 'phase-gate-ui',
      viewerSeat: 'FIRST',
      participants: {
        FIRST: { id: 'player-1', name: '玩家一' },
        SECOND: { id: 'player-2', name: '玩家二' },
      },
      turnCount: 1,
      phase,
      subPhase,
      firstSeat: 'FIRST',
      activeSeat: 'FIRST',
      prioritySeat: 'FIRST',
      window: null,
      endInfo: null,
      manualOperation: {
        mode: 'RULES',
        canSwitchNow: true,
        disabledReason: null,
        pendingRequest: null,
      },
      seq: 1,
    },
    table: { zones: {} },
    objects: {},
    permissions: { availableCommands },
    activeEffect: null,
    pendingCostPayment: null,
    uiHints: { gameMode: GameMode.DEBUG },
  };
}

function setSurface(source: 'ONLINE' | 'SPECTATOR', viewState: PlayerViewState): void {
  useGameStore.setState({
    gameMode: GameMode.DEBUG,
    playerViewState: viewState,
    viewingPlayerId: 'player-1',
    replaySession: null,
    remoteSession: {
      source,
      matchId: 'phase-gate-ui',
      seat: 'FIRST',
      playerId: 'player-1',
    },
  });
}

function renderPhaseIndicator(phase: GamePhase): string {
  return renderToStaticMarkup(createElement(PhaseIndicator, { phase, turnNumber: 1 }));
}

describe('phase completion time gate UI model', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(100_000);
    useGameStore.setState({
      playerViewState: null,
      viewingPlayerId: null,
      replaySession: null,
      remoteSession: null,
    });
  });

  afterEach(() => {
    useGameStore.setState({
      playerViewState: null,
      viewingPlayerId: null,
      replaySession: null,
      remoteSession: null,
    });
    vi.useRealTimers();
  });

  it('按绝对 deadline 重新计算 3、2、1，后台节流不会按 tick 累积误差', () => {
    const hint = timeGateHint(GameCommandType.END_PHASE);
    expect(isPhaseCompletionTimeGateHint(hint)).toBe(true);
    const deadline = createPhaseCompletionTimeGateDeadline(hint.availability!, 100_000);

    expect(getPhaseCompletionTimeGateCountdownSeconds(deadline, 100_000)).toBe(3);
    expect(getPhaseCompletionTimeGateCountdownSeconds(deadline, 101_000)).toBe(2);
    expect(getPhaseCompletionTimeGateCountdownSeconds(deadline, 102_000)).toBe(1);
    expect(getPhaseCompletionTimeGateCountdownSeconds(deadline, 103_000)).toBe(0);
    expect(getPhaseCompletionTimeGateRemainingMs(deadline, 120_000)).toBe(0);
  });

  it('桌面端与移动端的 Live Start! 在锁定期仍可见且为原生 disabled', () => {
    setSurface(
      'ONLINE',
      createViewState(GamePhase.MAIN_PHASE, SubPhase.NONE, [
        timeGateHint(GameCommandType.END_PHASE),
      ])
    );
    const html = renderPhaseIndicator(GamePhase.MAIN_PHASE);

    expect(html).toContain('Live Start! · 3s');
    expect(html.match(/Live Start! · 3s/g)).toHaveLength(2);
    expect(html.match(/data-phase-completion-gate="locked"/g)).toHaveLength(2);
    expect(html.match(/disabled=""/g)).toHaveLength(2);
    expect(html.match(/aria-disabled="true"/g)?.length).toBeGreaterThanOrEqual(2);
    expect(html).toContain(LOCK_REASON);

    for (const [availableAfterMs, seconds] of [
      [2_000, 2],
      [1_000, 1],
    ] as const) {
      setSurface(
        'ONLINE',
        createViewState(GamePhase.MAIN_PHASE, SubPhase.NONE, [
          timeGateHint(GameCommandType.END_PHASE, availableAfterMs),
        ])
      );
      expect(
        renderPhaseIndicator(GamePhase.MAIN_PHASE).match(
          new RegExp(`Live Start! · ${seconds}s`, 'g')
        )
      ).toHaveLength(2);
    }
  });

  it('Live 放置的“确认完成”使用同一倒计时契约', () => {
    setSurface(
      'ONLINE',
      createViewState(GamePhase.LIVE_SET_PHASE, SubPhase.LIVE_SET_FIRST_PLAYER, [
        timeGateHint(GameCommandType.CONFIRM_STEP),
      ])
    );
    const html = renderPhaseIndicator(GamePhase.LIVE_SET_PHASE);

    expect(html.match(/确认完成 · 3s/g)).toHaveLength(2);
    expect(html.match(/disabled=""/g)).toHaveLength(2);
  });

  it('锁定期的防御性 handler 不会调用 endPhase 或 confirmSubPhase', () => {
    const endPhase = vi.fn();
    const advancePhase = vi.fn();
    const confirmSubPhase = vi.fn();

    dispatchPhaseAction({
      isReadOnly: false,
      isPhaseCompletionTimeGateLocked: true,
      currentSubPhase: SubPhase.NONE,
      phase: GamePhase.MAIN_PHASE,
      endPhase,
      advancePhase,
      confirmSubPhase,
    });
    dispatchPhaseAction({
      isReadOnly: false,
      isPhaseCompletionTimeGateLocked: true,
      currentSubPhase: SubPhase.LIVE_SET_FIRST_PLAYER,
      phase: GamePhase.LIVE_SET_PHASE,
      endPhase,
      advancePhase,
      confirmSubPhase,
    });

    expect(endPhase).not.toHaveBeenCalled();
    expect(confirmSubPhase).not.toHaveBeenCalled();
    expect(advancePhase).not.toHaveBeenCalled();
  });

  it('本地倒计到期后恢复原文案与可点击状态', () => {
    setSurface(
      'ONLINE',
      createViewState(GamePhase.MAIN_PHASE, SubPhase.NONE, [
        timeGateHint(GameCommandType.END_PHASE, 0),
      ])
    );
    const html = renderPhaseIndicator(GamePhase.MAIN_PHASE);

    expect(html.match(/>Live Start!</g)).toHaveLength(2);
    expect(html).not.toContain('Live Start! ·');
    expect(html).not.toContain('data-phase-completion-gate="locked"');
    expect(html).not.toContain('disabled=""');
  });

  it('解锁后仍分别调用主要阶段与 Live 放置的原命令', () => {
    const endPhase = vi.fn();
    const advancePhase = vi.fn();
    const confirmSubPhase = vi.fn();
    const shared = {
      isReadOnly: false,
      isPhaseCompletionTimeGateLocked: false,
      endPhase,
      advancePhase,
      confirmSubPhase,
    } as const;

    dispatchPhaseAction({
      ...shared,
      currentSubPhase: SubPhase.NONE,
      phase: GamePhase.MAIN_PHASE,
    });
    dispatchPhaseAction({
      ...shared,
      currentSubPhase: SubPhase.LIVE_SET_FIRST_PLAYER,
      phase: GamePhase.LIVE_SET_PHASE,
    });

    expect(endPhase).toHaveBeenCalledTimes(1);
    expect(confirmSubPhase).toHaveBeenCalledTimes(1);
    expect(confirmSubPhase).toHaveBeenCalledWith(SubPhase.LIVE_SET_FIRST_PLAYER);
    expect(advancePhase).not.toHaveBeenCalled();
  });

  it('普通 disabled reason 不会被识别为计时门禁', () => {
    const ordinaryDisabled: ViewCommandHint = {
      command: GameCommandType.END_PHASE,
      enabled: false,
      reason: '请先完成当前卡牌效果',
    };
    expect(isPhaseCompletionTimeGateHint(ordinaryDisabled)).toBe(false);
    expect(isPhaseCompletionTimeGateHint(timeGateHint(GameCommandType.SET_LIVE_CARD))).toBe(false);
    setSurface('ONLINE', createViewState(GamePhase.MAIN_PHASE, SubPhase.NONE, [ordinaryDisabled]));

    const html = renderPhaseIndicator(GamePhase.MAIN_PHASE);
    expect(html).not.toContain('Live Start!');
    expect(html).not.toContain('data-phase-completion-gate');
  });

  it('观战与回放等只读视图不显示可操作阶段按钮', () => {
    const viewState = createViewState(GamePhase.MAIN_PHASE, SubPhase.NONE, [
      timeGateHint(GameCommandType.END_PHASE),
    ]);
    setSurface('SPECTATOR', viewState);
    expect(renderPhaseIndicator(GamePhase.MAIN_PHASE)).not.toContain('Live Start!');

    useGameStore.setState({
      remoteSession: null,
      replaySession: {
        matchId: 'phase-gate-ui',
        sourceMatchMode: 'ONLINE',
        viewerSeat: 'FIRST',
        viewerPlayerId: 'player-1',
        checkpointSeq: 1,
        timelineSeq: 1,
        recordStatus: 'COMPLETED',
        recordCompleteness: 'FULL',
        partialReasonSummary: null,
      },
      playerViewState: viewState,
    });
    expect(renderPhaseIndicator(GamePhase.MAIN_PHASE)).not.toContain('Live Start!');
  });
});
