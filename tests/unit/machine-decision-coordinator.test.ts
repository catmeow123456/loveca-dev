import { describe, expect, it, vi } from 'vitest';
import { createGameSession } from '../../src/application/game-session';
import type { GameState } from '../../src/domain/entities/game';
import {
  MachineDecisionCoordinator,
  type MachineAuthoritySnapshot,
} from '../../src/server/ai-battle/machine-decision-coordinator';
import { SingleMatchSerialExecutor } from '../../src/server/ai-battle/single-match-serial-executor';
import { GameMode, GamePhase, SubPhase } from '../../src/shared/types/enums';

function createMainPhaseState(): GameState {
  const session = createGameSession({ gameMode: GameMode.DEBUG });
  session.createGame('machine-lease-test', 'first', 'First', 'second', 'Second');
  const state = session.state!;
  return {
    ...state,
    currentPhase: GamePhase.MAIN_PHASE,
    currentSubPhase: SubPhase.NONE,
    activePlayerId: 'first',
  };
}

describe('MachineDecisionCoordinator', () => {
  it('acquires and reuses one lease for the same owner and window', async () => {
    let now = 100;
    const coordinator = new MachineDecisionCoordinator({
      now: () => now,
      runtimeEpoch: 'epoch-a',
      idGenerator: () => 'lease-a',
    });
    const snapshot = { game: createMainPhaseState(), authorityRevision: 7 };

    const first = await coordinator.acquireLease({
      matchId: 'match-a',
      playerId: 'first',
      ownerId: 'worker-a',
      readAuthoritySnapshot: () => snapshot,
    });
    now = 101;
    const reused = await coordinator.acquireLease({
      matchId: 'match-a',
      playerId: 'first',
      ownerId: 'worker-a',
      readAuthoritySnapshot: () => snapshot,
    });

    expect(first.ok && first.status).toBe('ACQUIRED');
    expect(reused.ok && reused.status).toBe('REUSED');
    expect(first.ok && reused.ok && reused.lease).toEqual(first.ok && first.lease);
  });

  it('does not let another owner steal a live lease', async () => {
    const coordinator = new MachineDecisionCoordinator({
      now: () => 100,
      runtimeEpoch: 'epoch-a',
      idGenerator: () => 'lease-a',
    });
    const snapshot = { game: createMainPhaseState(), authorityRevision: 7 };
    await coordinator.acquireLease({
      matchId: 'match-a',
      playerId: 'first',
      ownerId: 'worker-a',
      readAuthoritySnapshot: () => snapshot,
    });

    const blocked = await coordinator.acquireLease({
      matchId: 'match-a',
      playerId: 'first',
      ownerId: 'worker-b',
      readAuthoritySnapshot: () => snapshot,
    });

    expect(blocked).toMatchObject({
      ok: false,
      reason: 'LEASE_HELD_BY_OTHER_OWNER',
      retryAt: 30_100,
    });
  });

  it('reads authority only after entering the per-match critical section', async () => {
    const executor = new SingleMatchSerialExecutor();
    const coordinator = new MachineDecisionCoordinator({
      executor,
      now: () => 100,
      runtimeEpoch: 'epoch-a',
      idGenerator: () => 'lease-a',
    });
    const game = createMainPhaseState();
    let revision = 7;
    let releaseBlocker!: () => void;
    const blockerGate = new Promise<void>((resolve) => {
      releaseBlocker = resolve;
    });
    const blocker = executor.runExclusive('match-a', () => blockerGate);
    const leasePromise = coordinator.acquireLease({
      matchId: 'match-a',
      playerId: 'first',
      ownerId: 'worker-a',
      readAuthoritySnapshot: () => ({ game, authorityRevision: revision }),
    });

    revision = 8;
    releaseBlocker();
    await blocker;
    const acquired = await leasePromise;

    expect(acquired.ok && acquired.lease.authorityRevision).toBe(8);
  });

  it('rejects an old revision before executing a command and consumes the lease', async () => {
    const coordinator = new MachineDecisionCoordinator({
      now: () => 100,
      runtimeEpoch: 'epoch-a',
      idGenerator: () => 'lease-a',
    });
    const game = createMainPhaseState();
    const acquired = await coordinator.acquireLease({
      matchId: 'match-a',
      playerId: 'first',
      ownerId: 'worker-a',
      readAuthoritySnapshot: () => ({ game, authorityRevision: 7 }),
    });
    if (!acquired.ok) throw new Error(acquired.detail);
    const executeCommand = vi.fn();

    const stale = await coordinator.submitSelection({
      matchId: 'match-a',
      leaseId: acquired.lease.leaseId,
      ownerId: 'worker-a',
      selection: { kind: 'SELECT_MAIN_PHASE_ACTION', actionId: 'action-1' },
      readAuthoritySnapshot: () => ({ game, authorityRevision: 8 }),
      executeCommand,
    });
    const duplicate = await coordinator.submitSelection({
      matchId: 'match-a',
      leaseId: acquired.lease.leaseId,
      ownerId: 'worker-a',
      selection: { kind: 'SELECT_MAIN_PHASE_ACTION', actionId: 'action-1' },
      readAuthoritySnapshot: () => ({ game, authorityRevision: 8 }),
      executeCommand,
    });

    expect(stale).toMatchObject({ ok: false, reason: 'AUTHORITY_REVISION_CHANGED' });
    expect(duplicate).toMatchObject({ ok: false, reason: 'LEASE_NOT_FOUND' });
    expect(executeCommand).not.toHaveBeenCalled();
  });

  it('keeps the lease for a repairable invalid selection', async () => {
    const coordinator = new MachineDecisionCoordinator({
      now: () => 100,
      runtimeEpoch: 'epoch-a',
      idGenerator: () => 'lease-a',
    });
    const snapshot: MachineAuthoritySnapshot = {
      game: createMainPhaseState(),
      authorityRevision: 7,
    };
    const acquired = await coordinator.acquireLease({
      matchId: 'match-a',
      playerId: 'first',
      ownerId: 'worker-a',
      readAuthoritySnapshot: () => snapshot,
    });
    if (!acquired.ok) throw new Error(acquired.detail);

    const invalid = await coordinator.submitSelection({
      matchId: 'match-a',
      leaseId: acquired.lease.leaseId,
      ownerId: 'worker-a',
      selection: { kind: 'SELECT_MAIN_PHASE_ACTION', actionId: 'outside-contract' },
      readAuthoritySnapshot: () => snapshot,
      executeCommand: vi.fn(),
    });

    expect(invalid).toMatchObject({ ok: false, reason: 'INVALID_SELECTION' });
    expect(coordinator.getActiveLease('match-a', 'FIRST')).toEqual(acquired.lease);
  });

  it('executes a current selection once and requires revision growth', async () => {
    const coordinator = new MachineDecisionCoordinator({
      now: () => 100,
      runtimeEpoch: 'epoch-a',
      idGenerator: () => 'lease-a',
    });
    const snapshot = { game: createMainPhaseState(), authorityRevision: 7 };
    const acquired = await coordinator.acquireLease({
      matchId: 'match-a',
      playerId: 'first',
      ownerId: 'worker-a',
      readAuthoritySnapshot: () => snapshot,
    });
    if (!acquired.ok) throw new Error(acquired.detail);
    const witnessAction =
      acquired.contract.kind === 'MAIN_PHASE'
        ? acquired.contract.actions.find((action) => action.kind === 'END_MAIN_PHASE')
        : null;
    if (!witnessAction) throw new Error('missing main-phase witness action');
    const executeCommand = vi.fn(() => ({ success: true, authorityRevision: 8 }));

    const submitted = await coordinator.submitSelection({
      matchId: 'match-a',
      leaseId: acquired.lease.leaseId,
      ownerId: 'worker-a',
      selection: {
        kind: 'SELECT_MAIN_PHASE_ACTION',
        actionId: witnessAction.actionId,
      },
      readAuthoritySnapshot: () => snapshot,
      executeCommand,
    });
    const duplicate = await coordinator.submitSelection({
      matchId: 'match-a',
      leaseId: acquired.lease.leaseId,
      ownerId: 'worker-a',
      selection: {
        kind: 'SELECT_MAIN_PHASE_ACTION',
        actionId: witnessAction.actionId,
      },
      readAuthoritySnapshot: () => snapshot,
      executeCommand,
    });

    expect(submitted).toMatchObject({ ok: true, authorityRevision: 8 });
    expect(duplicate).toMatchObject({ ok: false, reason: 'LEASE_NOT_FOUND' });
    expect(executeCommand).toHaveBeenCalledTimes(1);
  });

  it('consumes the lease when the authority command throws', async () => {
    const coordinator = new MachineDecisionCoordinator({
      now: () => 100,
      runtimeEpoch: 'epoch-a',
      idGenerator: () => 'lease-a',
    });
    const snapshot = { game: createMainPhaseState(), authorityRevision: 7 };
    const acquired = await coordinator.acquireLease({
      matchId: 'match-a',
      playerId: 'first',
      ownerId: 'worker-a',
      readAuthoritySnapshot: () => snapshot,
    });
    if (!acquired.ok || acquired.contract.kind !== 'MAIN_PHASE') {
      throw new Error(acquired.ok ? 'unexpected contract' : acquired.detail);
    }
    const action = acquired.contract.actions.find(
      (candidate) => candidate.kind === 'END_MAIN_PHASE'
    );
    if (!action) throw new Error('missing main-phase witness action');

    const failed = await coordinator.submitSelection({
      matchId: 'match-a',
      leaseId: acquired.lease.leaseId,
      ownerId: 'worker-a',
      selection: { kind: 'SELECT_MAIN_PHASE_ACTION', actionId: action.actionId },
      readAuthoritySnapshot: () => snapshot,
      executeCommand: () => {
        throw new Error('unexpected authority error');
      },
    });

    expect(failed).toMatchObject({ ok: false, reason: 'COMMAND_EXECUTION_FAILED' });
    expect(coordinator.getActiveLease('match-a', 'FIRST')).toBeNull();
  });

  it('rejects expired leases and invalidates all leases on recovery', async () => {
    let now = 100;
    let leaseSequence = 0;
    const coordinator = new MachineDecisionCoordinator({
      now: () => now,
      leaseTtlMs: 50,
      runtimeEpoch: 'epoch-a',
      idGenerator: () => `lease-${++leaseSequence}`,
    });
    const snapshot = { game: createMainPhaseState(), authorityRevision: 7 };
    const expiredLease = await coordinator.acquireLease({
      matchId: 'match-a',
      playerId: 'first',
      ownerId: 'worker-a',
      readAuthoritySnapshot: () => snapshot,
    });
    if (!expiredLease.ok) throw new Error(expiredLease.detail);
    now = 150;

    const expired = await coordinator.submitSelection({
      matchId: 'match-a',
      leaseId: expiredLease.lease.leaseId,
      ownerId: 'worker-a',
      selection: { kind: 'SELECT_MAIN_PHASE_ACTION', actionId: 'action-1' },
      readAuthoritySnapshot: () => snapshot,
      executeCommand: vi.fn(),
    });
    expect(expired).toMatchObject({ ok: false, reason: 'LEASE_EXPIRED' });

    now = 151;
    const recoveredLease = await coordinator.acquireLease({
      matchId: 'match-a',
      playerId: 'first',
      ownerId: 'worker-a',
      readAuthoritySnapshot: () => snapshot,
    });
    if (!recoveredLease.ok) throw new Error(recoveredLease.detail);
    await expect(coordinator.invalidateMatch('match-a')).resolves.toBe(1);
    expect(coordinator.getActiveLease('match-a', 'FIRST')).toBeNull();
  });
});
