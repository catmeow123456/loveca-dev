import { randomUUID } from 'node:crypto';
import type { GameState } from '../../domain/entities/game.js';

export const SERVER_DEADLINE_SCHEMA_VERSION = 'ai-battle.server-deadline/v2' as const;

export type ServerDeadlineKind = 'PUBLIC_CARD_SELECTION' | 'PUBLIC_EFFECT_CHOICE' | 'PUBLIC_REVEAL';

export interface ServerDeadlineRegistration {
  readonly schemaVersion: typeof SERVER_DEADLINE_SCHEMA_VERSION;
  readonly registrationId: string;
  readonly runtimeEpoch: string;
  readonly matchId: string;
  readonly authorityRevision: number;
  readonly effectId: string;
  readonly stepId: string;
  readonly kind: ServerDeadlineKind;
  readonly autoAdvanceAt: number;
  readonly publicRevealGeneration?: string;
  readonly windowSignature: string;
}

export interface ServerDeadlineAuthoritySnapshot {
  readonly game: GameState;
  readonly authorityRevision: number;
}

export interface ServerDeadlineTimerHandle {
  unref?(): void;
}

export interface ServerDeadlineOwnerOptions {
  readonly now?: () => number;
  readonly runtimeEpoch?: string;
  readonly idGenerator?: () => string;
  readonly retryDelayMs?: number;
  readonly scheduleTimer?: (callback: () => void, delayMs: number) => ServerDeadlineTimerHandle;
  readonly cancelTimer?: (handle: ServerDeadlineTimerHandle) => void;
  readonly onDeadlineDue: (registration: ServerDeadlineRegistration) => Promise<void> | void;
}

interface ActiveServerDeadline {
  readonly registration: ServerDeadlineRegistration;
  timerHandle: ServerDeadlineTimerHandle | null;
}

const DEFAULT_RETRY_DELAY_MS = 1_000;
const MAX_TIMER_DELAY_MS = 2_147_483_647;

/**
 * Single-process owner for authoritative public-display deadlines.
 *
 * It owns timer lifecycle only. The due callback must enter the shared
 * per-match critical section and revalidate the registration before writing.
 */
export class ServerDeadlineOwner {
  readonly runtimeEpoch: string;

  private readonly now: () => number;
  private readonly idGenerator: () => string;
  private readonly retryDelayMs: number;
  private readonly scheduleTimer: NonNullable<ServerDeadlineOwnerOptions['scheduleTimer']>;
  private readonly cancelTimer: NonNullable<ServerDeadlineOwnerOptions['cancelTimer']>;
  private readonly onDeadlineDue: ServerDeadlineOwnerOptions['onDeadlineDue'];
  private readonly activeByMatch = new Map<string, ActiveServerDeadline>();
  private registrationSequence = 0;

  constructor(options: ServerDeadlineOwnerOptions) {
    this.now = options.now ?? (() => Date.now());
    this.runtimeEpoch = normalizeRequiredValue(
      options.runtimeEpoch ?? randomUUID(),
      'runtimeEpoch'
    );
    this.idGenerator = options.idGenerator ?? randomUUID;
    this.retryDelayMs = options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
    this.scheduleTimer =
      options.scheduleTimer ??
      ((callback, delayMs) => {
        const handle = setTimeout(callback, delayMs);
        handle.unref();
        return handle;
      });
    this.cancelTimer =
      options.cancelTimer ??
      ((handle) => {
        clearTimeout(handle as ReturnType<typeof setTimeout>);
      });
    this.onDeadlineDue = options.onDeadlineDue;
    if (!Number.isSafeInteger(this.retryDelayMs) || this.retryDelayMs <= 0) {
      throw new Error('retryDelayMs 必须是正安全整数');
    }
  }

  reconcileMatch(
    matchIdInput: string,
    snapshot: ServerDeadlineAuthoritySnapshot | null
  ): ServerDeadlineRegistration | null {
    const matchId = normalizeRequiredValue(matchIdInput, 'matchId');
    const descriptor = snapshot ? readServerDeadlineDescriptor(snapshot.game) : null;
    if (!snapshot || !descriptor) {
      this.cancelMatch(matchId);
      return null;
    }

    const existing = this.activeByMatch.get(matchId);
    if (
      existing &&
      existing.registration.authorityRevision === snapshot.authorityRevision &&
      existing.registration.windowSignature === descriptor.windowSignature
    ) {
      if (!existing.timerHandle) {
        this.schedule(existing, this.delayUntil(descriptor.autoAdvanceAt));
      }
      return existing.registration;
    }

    this.cancelMatch(matchId);
    const registration: ServerDeadlineRegistration = {
      schemaVersion: SERVER_DEADLINE_SCHEMA_VERSION,
      registrationId: `${this.runtimeEpoch}:${++this.registrationSequence}:${this.idGenerator()}`,
      runtimeEpoch: this.runtimeEpoch,
      matchId,
      authorityRevision: snapshot.authorityRevision,
      effectId: descriptor.effectId,
      stepId: descriptor.stepId,
      kind: descriptor.kind,
      autoAdvanceAt: descriptor.autoAdvanceAt,
      publicRevealGeneration: descriptor.publicRevealGeneration,
      windowSignature: descriptor.windowSignature,
    };
    const active: ActiveServerDeadline = { registration, timerHandle: null };
    this.activeByMatch.set(matchId, active);
    this.schedule(active, this.delayUntil(registration.autoAdvanceAt));
    return registration;
  }

  cancelMatch(matchIdInput: string): boolean {
    const matchId = normalizeRequiredValue(matchIdInput, 'matchId');
    const active = this.activeByMatch.get(matchId);
    if (!active) return false;
    this.activeByMatch.delete(matchId);
    if (active.timerHandle) {
      this.cancelTimer(active.timerHandle);
      active.timerHandle = null;
    }
    return true;
  }

  isCurrent(registration: ServerDeadlineRegistration): boolean {
    const current = this.activeByMatch.get(registration.matchId)?.registration;
    return (
      current?.registrationId === registration.registrationId &&
      current.runtimeEpoch === this.runtimeEpoch
    );
  }

  getCurrent(matchId: string): ServerDeadlineRegistration | null {
    return this.activeByMatch.get(matchId)?.registration ?? null;
  }

  dispose(): void {
    for (const matchId of [...this.activeByMatch.keys()]) {
      this.cancelMatch(matchId);
    }
  }

  private schedule(active: ActiveServerDeadline, delayMs: number): void {
    const boundedDelay = Math.min(Math.max(0, delayMs), MAX_TIMER_DELAY_MS);
    active.timerHandle = this.scheduleTimer(() => this.handleTimer(active), boundedDelay);
    active.timerHandle.unref?.();
  }

  private handleTimer(active: ActiveServerDeadline): void {
    if (!this.isCurrent(active.registration)) return;
    active.timerHandle = null;
    const remaining = this.delayUntil(active.registration.autoAdvanceAt);
    if (remaining > 0) {
      this.schedule(active, remaining);
      return;
    }

    void Promise.resolve()
      .then(() => this.onDeadlineDue(active.registration))
      .catch(() => undefined)
      .finally(() => {
        if (this.isCurrent(active.registration) && !active.timerHandle) {
          this.schedule(active, this.retryDelayMs);
        }
      });
  }

  private delayUntil(autoAdvanceAt: number): number {
    return Math.max(0, autoAdvanceAt - this.now());
  }
}

interface ServerDeadlineDescriptor {
  readonly effectId: string;
  readonly stepId: string;
  readonly kind: ServerDeadlineKind;
  readonly autoAdvanceAt: number;
  readonly publicRevealGeneration?: string;
  readonly windowSignature: string;
}

export function readServerDeadlineDescriptor(game: GameState): ServerDeadlineDescriptor | null {
  if (game.isEnded) return null;
  const effect = game.activeEffect;
  if (!effect) return null;

  const cardSelectionDeadline = effect.publicCardSelectionAutoAdvanceAt;
  const effectChoiceDeadline = effect.publicEffectChoiceAutoAdvanceAt;
  const publicRevealDeadline = effect.publicRevealAutoAdvanceAt;
  const deadlineCount = [cardSelectionDeadline, effectChoiceDeadline, publicRevealDeadline].filter(
    (deadline) => deadline !== undefined
  ).length;
  if (deadlineCount !== 1) {
    return null;
  }
  const kind: ServerDeadlineKind | null =
    cardSelectionDeadline !== undefined
      ? 'PUBLIC_CARD_SELECTION'
      : effectChoiceDeadline !== undefined
        ? 'PUBLIC_EFFECT_CHOICE'
        : publicRevealDeadline !== undefined
          ? 'PUBLIC_REVEAL'
          : null;
  const autoAdvanceAt = cardSelectionDeadline ?? effectChoiceDeadline ?? publicRevealDeadline;
  const publicRevealGeneration =
    kind === 'PUBLIC_REVEAL' ? effect.publicRevealGeneration : undefined;
  if (
    !kind ||
    autoAdvanceAt === undefined ||
    !Number.isFinite(autoAdvanceAt) ||
    autoAdvanceAt < 0 ||
    (kind === 'PUBLIC_REVEAL' && !publicRevealGeneration)
  ) {
    return null;
  }
  const windowSignature = JSON.stringify([
    effect.id,
    effect.stepId,
    kind,
    autoAdvanceAt,
    publicRevealGeneration ?? null,
  ]);
  return {
    effectId: effect.id,
    stepId: effect.stepId,
    kind,
    autoAdvanceAt,
    publicRevealGeneration,
    windowSignature,
  };
}

function normalizeRequiredValue(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${field} 不能为空`);
  return normalized;
}
