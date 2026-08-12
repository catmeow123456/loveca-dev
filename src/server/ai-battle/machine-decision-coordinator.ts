import { randomUUID } from 'node:crypto';
import {
  buildAiDecisionContract,
  materializeAiDecisionCommand,
  validateAiDecisionSelection,
  type AiDecisionContract,
  type AiDecisionContractHandle,
  type AiDecisionSelection,
} from '../../application/ai-decisions/index.js';
import type { GameCommand } from '../../application/game-commands.js';
import type { GameState } from '../../domain/entities/game.js';
import { getSeatForPlayer, type Seat } from '../../online/index.js';
import { AI_BATTLE_PROTOCOL_VERSIONS } from '../../shared/ai-battle-protocol-versions.js';
import {
  SingleMatchSerialExecutor,
  type SingleMatchCriticalSection,
} from './single-match-serial-executor.js';

export const AI_DECISION_LEASE_SCHEMA_VERSION = AI_BATTLE_PROTOCOL_VERSIONS.runtime.decisionLease;

export interface MachineDecisionLease {
  readonly schemaVersion: typeof AI_DECISION_LEASE_SCHEMA_VERSION;
  readonly leaseId: string;
  readonly runtimeEpoch: string;
  readonly matchId: string;
  readonly playerId: string;
  readonly seat: Seat;
  readonly ownerId: string;
  readonly authorityRevision: number;
  readonly decisionId: string;
  readonly windowSignature: string;
  readonly issuedAt: number;
  readonly expiresAt: number;
}

export type AcquireMachineDecisionLeaseResult =
  | {
      readonly ok: true;
      readonly status: 'ACQUIRED' | 'REUSED';
      readonly lease: MachineDecisionLease;
      readonly contract: AiDecisionContract;
    }
  | {
      readonly ok: false;
      readonly reason:
        'NO_DECISION' | 'UNSUPPORTED_WINDOW' | 'INVALID_STATE' | 'LEASE_HELD_BY_OTHER_OWNER';
      readonly detail: string;
      readonly retryAt?: number;
    };

export interface MachineAuthoritySnapshot {
  readonly game: GameState;
  readonly authorityRevision: number;
}

export interface MachineCommandExecutionResult {
  readonly success: boolean;
  readonly authorityRevision: number;
  readonly error?: string;
}

export type SubmitMachineDecisionResult =
  | {
      readonly ok: true;
      readonly leaseId: string;
      readonly authorityRevision: number;
      readonly command: GameCommand;
    }
  | {
      readonly ok: false;
      readonly reason:
        | 'LEASE_NOT_FOUND'
        | 'LEASE_OWNER_MISMATCH'
        | 'LEASE_EXPIRED'
        | 'AUTHORITY_REVISION_CHANGED'
        | 'WINDOW_CHANGED'
        | 'INVALID_SELECTION'
        | 'COMMAND_REJECTED'
        | 'COMMAND_EXECUTION_FAILED'
        | 'AUTHORITY_REVISION_NOT_ADVANCED';
      readonly detail: string;
    };

interface ActiveLease {
  readonly lease: MachineDecisionLease;
  readonly handle: AiDecisionContractHandle;
}

export interface MachineDecisionCoordinatorOptions {
  readonly executor?: SingleMatchSerialExecutor;
  readonly now?: () => number;
  readonly leaseTtlMs?: number;
  readonly runtimeEpoch?: string;
  readonly idGenerator?: () => string;
}

const DEFAULT_LEASE_TTL_MS = 30_000;

/**
 * Owns the single-process decision lease lifecycle and machine submission
 * critical section. It does not own authority revision; callers must supply
 * the match runtime's current revision and advance it on successful commands.
 */
export class MachineDecisionCoordinator {
  readonly executor: SingleMatchSerialExecutor;
  readonly runtimeEpoch: string;

  private readonly now: () => number;
  private readonly leaseTtlMs: number;
  private readonly idGenerator: () => string;
  private readonly activeLeaseBySeat = new Map<string, ActiveLease>();
  private readonly activeLeaseById = new Map<string, ActiveLease>();

  constructor(options: MachineDecisionCoordinatorOptions = {}) {
    this.executor = options.executor ?? new SingleMatchSerialExecutor();
    this.now = options.now ?? (() => Date.now());
    this.leaseTtlMs = options.leaseTtlMs ?? DEFAULT_LEASE_TTL_MS;
    this.runtimeEpoch = normalizeRequiredValue(
      options.runtimeEpoch ?? randomUUID(),
      'runtimeEpoch'
    );
    this.idGenerator = options.idGenerator ?? randomUUID;
    if (!Number.isSafeInteger(this.leaseTtlMs) || this.leaseTtlMs <= 0) {
      throw new Error('leaseTtlMs 必须是正安全整数');
    }
  }

  acquireLease(input: {
    readonly matchId: string;
    readonly playerId: string;
    readonly ownerId: string;
    /** Read inside the shared per-match critical section. */
    readonly readAuthoritySnapshot: (
      criticalSection: SingleMatchCriticalSection
    ) => MachineAuthoritySnapshot | null;
  }): Promise<AcquireMachineDecisionLeaseResult> {
    const matchId = normalizeRequiredValue(input.matchId, 'matchId');
    return this.executor.runExclusive(matchId, (criticalSection) =>
      this.acquireLeaseInCriticalSection(criticalSection, input)
    );
  }

  acquireLeaseInCriticalSection(
    criticalSection: SingleMatchCriticalSection,
    input: {
      readonly matchId: string;
      readonly playerId: string;
      readonly ownerId: string;
      readonly readAuthoritySnapshot: (
        criticalSection: SingleMatchCriticalSection
      ) => MachineAuthoritySnapshot | null;
    }
  ): AcquireMachineDecisionLeaseResult {
    const matchId = normalizeRequiredValue(input.matchId, 'matchId');
    const playerId = normalizeRequiredValue(input.playerId, 'playerId');
    const ownerId = normalizeRequiredValue(input.ownerId, 'ownerId');
    this.assertCriticalSection(matchId, criticalSection);
    const now = this.now();
    const snapshot = input.readAuthoritySnapshot(criticalSection);
    if (!snapshot) {
      return {
        ok: false,
        reason: 'INVALID_STATE',
        detail: '权威对局状态不存在',
      };
    }
    const buildResult = buildAiDecisionContract(
      snapshot.game,
      playerId,
      snapshot.authorityRevision,
      now
    );
    if (!buildResult.ok) {
      this.revokeSeatLease(matchId, resolvePlayerSeatKey(snapshot.game, playerId));
      return buildResult;
    }

    const { contract } = buildResult.handle;
    const seatKey = toSeatKey(matchId, contract.seat);
    const existing = this.activeLeaseBySeat.get(seatKey);
    if (existing && existing.lease.expiresAt <= now) {
      this.revoke(existing);
    } else if (existing) {
      const sameWindow =
        existing.lease.authorityRevision === contract.authorityRevision &&
        existing.lease.decisionId === contract.decisionId &&
        existing.lease.windowSignature === contract.windowSignature;
      if (sameWindow && existing.lease.ownerId === ownerId) {
        return {
          ok: true,
          status: 'REUSED',
          lease: existing.lease,
          contract: existing.handle.contract,
        };
      }
      if (sameWindow) {
        return {
          ok: false,
          reason: 'LEASE_HELD_BY_OTHER_OWNER',
          detail: '当前机器决策窗口已由其他执行者持有',
          retryAt: existing.lease.expiresAt,
        };
      }
      this.revoke(existing);
    }

    const lease: MachineDecisionLease = {
      schemaVersion: AI_DECISION_LEASE_SCHEMA_VERSION,
      leaseId: `${this.runtimeEpoch}:${this.idGenerator()}`,
      runtimeEpoch: this.runtimeEpoch,
      matchId,
      playerId,
      seat: contract.seat,
      ownerId,
      authorityRevision: contract.authorityRevision,
      decisionId: contract.decisionId,
      windowSignature: contract.windowSignature,
      issuedAt: now,
      expiresAt: now + this.leaseTtlMs,
    };
    const active = { lease, handle: buildResult.handle };
    this.activeLeaseBySeat.set(seatKey, active);
    this.activeLeaseById.set(lease.leaseId, active);
    return { ok: true, status: 'ACQUIRED', lease, contract };
  }

  submitSelection(input: {
    readonly matchId: string;
    readonly leaseId: string;
    readonly ownerId: string;
    readonly selection: AiDecisionSelection;
    readonly readAuthoritySnapshot: (
      criticalSection: SingleMatchCriticalSection
    ) => MachineAuthoritySnapshot | null;
    /**
     * This callback already runs inside the shared per-match critical section.
     * Callers must use an explicit in-critical-section authority path instead
     * of reacquiring the executor.
     */
    readonly executeCommand: (
      command: GameCommand,
      expectedRevision: number,
      criticalSection: SingleMatchCriticalSection
    ) => Promise<MachineCommandExecutionResult> | MachineCommandExecutionResult;
  }): Promise<SubmitMachineDecisionResult> {
    const matchId = normalizeRequiredValue(input.matchId, 'matchId');
    return this.executor.runExclusive(matchId, (criticalSection) =>
      this.submitSelectionInCriticalSection(criticalSection, input)
    );
  }

  async submitSelectionInCriticalSection(
    criticalSection: SingleMatchCriticalSection,
    input: {
      readonly matchId: string;
      readonly leaseId: string;
      readonly ownerId: string;
      readonly selection: AiDecisionSelection;
      readonly readAuthoritySnapshot: (
        criticalSection: SingleMatchCriticalSection
      ) => MachineAuthoritySnapshot | null;
      readonly executeCommand: (
        command: GameCommand,
        expectedRevision: number,
        criticalSection: SingleMatchCriticalSection
      ) => Promise<MachineCommandExecutionResult> | MachineCommandExecutionResult;
    }
  ): Promise<SubmitMachineDecisionResult> {
    const matchId = normalizeRequiredValue(input.matchId, 'matchId');
    const leaseId = normalizeRequiredValue(input.leaseId, 'leaseId');
    const ownerId = normalizeRequiredValue(input.ownerId, 'ownerId');
    this.assertCriticalSection(matchId, criticalSection);
    const active = this.activeLeaseById.get(leaseId);
    if (!active || active.lease.matchId !== matchId) {
      return rejectedSubmission('LEASE_NOT_FOUND', 'decision lease 不存在或已经失效');
    }
    if (active.lease.ownerId !== ownerId) {
      return rejectedSubmission('LEASE_OWNER_MISMATCH', 'decision lease 不属于当前执行者');
    }

    const now = this.now();
    if (active.lease.expiresAt <= now) {
      this.revoke(active);
      return rejectedSubmission('LEASE_EXPIRED', 'decision lease 已过期');
    }

    const snapshot = input.readAuthoritySnapshot(criticalSection);
    if (!snapshot || snapshot.authorityRevision !== active.lease.authorityRevision) {
      this.revoke(active);
      return rejectedSubmission(
        'AUTHORITY_REVISION_CHANGED',
        '权威 revision 已变化，旧机器决策作废'
      );
    }

    const current = buildAiDecisionContract(
      snapshot.game,
      active.lease.playerId,
      snapshot.authorityRevision,
      now
    );
    if (!current.ok) {
      this.revoke(active);
      return rejectedSubmission('WINDOW_CHANGED', `机器决策窗口已变化：${current.detail}`);
    }
    if (
      current.handle.contract.seat !== active.lease.seat ||
      current.handle.contract.decisionId !== active.lease.decisionId ||
      current.handle.contract.windowSignature !== active.lease.windowSignature
    ) {
      this.revoke(active);
      return rejectedSubmission('WINDOW_CHANGED', '机器决策窗口签名已变化');
    }

    const validation = validateAiDecisionSelection(current.handle, input.selection);
    if (!validation.ok) {
      return rejectedSubmission('INVALID_SELECTION', validation.error);
    }
    const materialized = materializeAiDecisionCommand(current.handle, input.selection, now);
    if (!materialized.ok) {
      return rejectedSubmission('INVALID_SELECTION', materialized.error);
    }

    let executed: MachineCommandExecutionResult;
    try {
      executed = await input.executeCommand(
        materialized.command,
        active.lease.authorityRevision,
        criticalSection
      );
    } catch {
      this.revoke(active);
      return rejectedSubmission(
        'COMMAND_EXECUTION_FAILED',
        '机器命令执行发生未预期错误，lease 已失效'
      );
    }
    if (!executed.success) {
      this.revoke(active);
      return rejectedSubmission('COMMAND_REJECTED', executed.error ?? '权威命令拒绝了机器决策');
    }
    this.revoke(active);
    if (executed.authorityRevision <= active.lease.authorityRevision) {
      return rejectedSubmission(
        'AUTHORITY_REVISION_NOT_ADVANCED',
        '机器命令成功后 authority revision 未增长'
      );
    }
    return {
      ok: true,
      leaseId,
      authorityRevision: executed.authorityRevision,
      command: materialized.command,
    };
  }

  invalidateMatch(matchIdInput: string): Promise<number> {
    const matchId = normalizeRequiredValue(matchIdInput, 'matchId');
    return this.executor.runExclusive(matchId, (criticalSection) =>
      this.invalidateMatchInCriticalSection(criticalSection, matchId)
    );
  }

  invalidateMatchInCriticalSection(
    criticalSection: SingleMatchCriticalSection,
    matchIdInput: string
  ): number {
    const matchId = normalizeRequiredValue(matchIdInput, 'matchId');
    this.assertCriticalSection(matchId, criticalSection);
    const activeLeases = [...this.activeLeaseById.values()].filter(
      (active) => active.lease.matchId === matchId
    );
    for (const active of activeLeases) {
      this.revoke(active);
    }
    return activeLeases.length;
  }

  getActiveLease(matchId: string, seat: Seat): MachineDecisionLease | null {
    return this.activeLeaseBySeat.get(toSeatKey(matchId, seat))?.lease ?? null;
  }

  dispose(): void {
    this.activeLeaseBySeat.clear();
    this.activeLeaseById.clear();
  }

  private revokeSeatLease(matchId: string, seat: Seat | null): void {
    if (!seat) return;
    const active = this.activeLeaseBySeat.get(toSeatKey(matchId, seat));
    if (active) this.revoke(active);
  }

  private revoke(active: ActiveLease): void {
    this.activeLeaseById.delete(active.lease.leaseId);
    const seatKey = toSeatKey(active.lease.matchId, active.lease.seat);
    if (this.activeLeaseBySeat.get(seatKey) === active) {
      this.activeLeaseBySeat.delete(seatKey);
    }
  }

  private assertCriticalSection(
    matchId: string,
    criticalSection: SingleMatchCriticalSection
  ): void {
    if (!this.executor.isExecutingMatch(matchId, criticalSection)) {
      throw new Error('机器决策协调操作必须位于单局临界区');
    }
  }
}

function rejectedSubmission(
  reason: Extract<SubmitMachineDecisionResult, { ok: false }>['reason'],
  detail: string
): SubmitMachineDecisionResult {
  return { ok: false, reason, detail };
}

function toSeatKey(matchId: string, seat: Seat): string {
  return `${matchId}:${seat}`;
}

function resolvePlayerSeatKey(game: GameState, playerId: string): Seat | null {
  return getSeatForPlayer(game, playerId);
}

function normalizeRequiredValue(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(`${label} 不能为空`);
  }
  return normalized;
}
