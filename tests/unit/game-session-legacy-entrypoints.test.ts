import { describe, expect, it } from 'vitest';
import { createMulliganAction } from '../../src/application/actions';
import { GameSession, createGameSession } from '../../src/application/game-session';

describe('GameSession 旧式入口边界', () => {
  it('默认会话不允许 trusted test action 绕过语义命令入口', () => {
    const session = createGameSession();
    session.createGame('legacy-action-gate', 'p1', 'P1', 'p2', 'P2');

    const before = session.state;
    const result = session.dispatchLegacyActionForTesting(createMulliganAction('p1', []));

    expect(result.success).toBe(false);
    expect(result.error).toBe('旧式测试动作入口未启用');
    expect(session.state).toBe(before);
  });

  it('localFreePlay 仅保留只读兼容视图', () => {
    const descriptor = Object.getOwnPropertyDescriptor(GameSession.prototype, 'localFreePlay');

    expect(descriptor).toBeDefined();
    expect(typeof descriptor?.get).toBe('function');
    expect(Reflect.set(createGameSession(), 'localFreePlay', true)).toBe(false);
  });
});
