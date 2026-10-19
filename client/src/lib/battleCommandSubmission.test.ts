import { describe, expect, it } from 'vitest';
import {
  battleCommandIdentity,
  beginBattleCommandSubmission,
  useBattleCommandSubmission,
} from './battleCommandSubmission';

describe('pending battle command guard', () => {
  it('coalesces repeat submits despite refreshed timestamps and permits retry after settlement', () => {
    const identity = battleCommandIdentity('match', 'FIRST', {
      type: 'CONFIRM',
      timestamp: 1,
      payload: { ids: ['a', 'b'] },
    });
    expect(
      battleCommandIdentity('match', 'FIRST', {
        type: 'CONFIRM',
        timestamp: 2,
        idempotencyKey: 'new',
        payload: { ids: ['a', 'b'] },
      })
    ).toBe(identity);
    const finish = beginBattleCommandSubmission(identity)!;
    expect(beginBattleCommandSubmission(identity)).toBeNull();
    expect(useBattleCommandSubmission.getState().pendingCount).toBe(1);
    const other = beginBattleCommandSubmission(
      battleCommandIdentity('match', 'SECOND', { type: 'CONFIRM' })
    )!;
    expect(useBattleCommandSubmission.getState().pendingCount).toBe(2);
    finish();
    finish();
    other();
    expect(useBattleCommandSubmission.getState().pendingCount).toBe(0);
    const retry = beginBattleCommandSubmission(identity);
    expect(retry).not.toBeNull();
    retry?.();
  });
  it('retains order and candidate identity in the command key', () => {
    expect(battleCommandIdentity('m', 'FIRST', { ids: ['a', 'b'] })).not.toBe(
      battleCommandIdentity('m', 'FIRST', { ids: ['b', 'a'] })
    );
  });
});
