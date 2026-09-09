import { createHash } from 'node:crypto';
import type {
  AiTraceDecision,
  AiTraceDecisionSummary,
  AiTraceExport,
  AiTraceListing,
  AiTraceMaterial,
} from '../../online/ai-battle-observation-types.js';
import type { AiKnowledgeMaterial } from './presets.js';
import { redactAiText, serializeAiEvidence } from './redaction.js';

// The original starter's opening decision is ~10 KB and its full 72-card data ~78 KB.
// These are evidence retention limits, never a game/turn/model-call budget.
export const AI_TRACE_LIMITS = {
  itemBytes: 256 * 1024,
  sessionBytes: 16 * 1024 * 1024,
  processBytes: 64 * 1024 * 1024,
  sessions: 32,
  decisions: 128,
  eventsPerDecision: 32,
  sourcesPerSession: 8,
  endedTtlMs: 60 * 60 * 1000,
} as const;

type Limits = { readonly [K in keyof typeof AI_TRACE_LIMITS]: number };
interface StoredDecision {
  value: AiTraceDecision;
  /** Bounded metadata reservation, separate from retained text accounting. */
  readonly reservedBytes: number;
}
interface TraceSession {
  readonly matchId: string;
  readonly decisions: Map<string, StoredDecision>;
  readonly materials: Map<string, AiTraceMaterial>;
  readonly sources: string[];
  bytes: number;
  revision: number;
  endedAt: number | null;
  evictedDecisions: number;
  omittedDecisions: number;
  discardedLateUpdates: number;
  captureFailures: number;
  nextMaterial: number;
}

export interface AiTraceIdentity {
  readonly id: string;
  readonly revision: number;
  readonly windowKey: string;
  readonly seat: string;
  readonly purpose: string;
}

export interface AiBattleTraceObserver {
  begin(identity: AiTraceIdentity): void;
  append(
    decisionId: string,
    stage: string,
    payload: unknown,
    options?: Parameters<AiBattleTraceStore['append']>[4]
  ): void;
  end(): void;
  reportFailure(): void;
}

const SESSION_RESERVATION = 1024;
const MATERIAL_RESERVATION = 4096;
const DECISION_RESERVATION = 8192;
const EVENT_RESERVATION = 1024;
const label = (value: string) => value.slice(0, 256);

/** Synchronous sidecar: capture is isolated from gameplay; reads only clone retained evidence. */
export class AiBattleTraceStore {
  private readonly sessions = new Map<string, TraceSession>();
  private bytes = 0;

  constructor(
    private readonly limits: Limits = AI_TRACE_LIMITS,
    private readonly now: () => number = Date.now
  ) {}

  bind(matchId: string): AiBattleTraceObserver {
    return {
      begin: (identity) => this.begin(matchId, identity),
      append: (id, stage, payload, options) => this.append(matchId, id, stage, payload, options),
      end: () => this.end(matchId),
      reportFailure: () => this.reportCaptureFailure(matchId),
    };
  }

  open(matchId: string, sources: readonly AiKnowledgeMaterial[]): boolean {
    this.cleanup();
    if (
      this.sessions.has(matchId) ||
      this.sessions.size >= this.limits.sessions ||
      sources.length > this.limits.sourcesPerSession ||
      new Set(sources.map((source) => source.id)).size !== sources.length
    )
      return false;
    const reservation = SESSION_RESERVATION + sources.length * MATERIAL_RESERVATION;
    if (
      reservation > this.limits.sessionBytes ||
      this.bytes + reservation > this.limits.processBytes
    )
      return false;
    const session: TraceSession = {
      matchId,
      decisions: new Map(),
      materials: new Map(),
      sources: [],
      bytes: 0,
      revision: 0,
      endedAt: null,
      evictedDecisions: 0,
      omittedDecisions: 0,
      discardedLateUpdates: 0,
      captureFailures: 0,
      nextMaterial: 0,
    };
    this.sessions.set(matchId, session);
    this.reserve(session, SESSION_RESERVATION);
    for (const source of sources) {
      this.reserve(session, MATERIAL_RESERVATION);
      const id = `source:${source.id}`;
      session.sources.push(id);
      const redacted = redactAiText(source.content);
      this.material(session, id, source.title, source.source, redacted.text, false, redacted.count);
    }
    session.revision++;
    return true;
  }

  begin(matchId: string, identity: AiTraceIdentity): void {
    const session = this.retained(matchId);
    if (!session) return;
    this.capture(session, () => {
      if (session.decisions.has(identity.id)) return;
      if (!this.makeRoom(session, DECISION_RESERVATION, true)) {
        session.omittedDecisions++;
        return;
      }
      this.reserve(session, DECISION_RESERVATION);
      session.decisions.set(identity.id, {
        reservedBytes: DECISION_RESERVATION,
        value: {
          id: label(identity.id),
          revision: identity.revision,
          windowKey: label(identity.windowKey),
          seat: label(identity.seat),
          purpose: label(identity.purpose),
          createdAt: this.now(),
          updatedAt: this.now(),
          status: 'SAMPLED',
          pendingAttempts: [],
          omittedEvents: 0,
          sourceMaterialIds: [...session.sources],
          events: [],
        },
      });
    });
  }

  append(
    matchId: string,
    decisionId: string,
    stage: string,
    payload: unknown,
    options: {
      readonly status?: string;
      readonly attemptStarted?: number;
      readonly attemptFinished?: number;
    } = {}
  ): void {
    const session = this.retained(matchId);
    if (!session) return;
    this.capture(session, () => {
      const record = session.decisions.get(decisionId);
      if (!record) {
        session.discardedLateUpdates++;
        return;
      }
      const before = record.value;
      const pending = new Set(before.pendingAttempts);
      // The protocol permits two attempts. Arbitrary indices cannot grow a retention pin set.
      if (options.attemptStarted === 0 || options.attemptStarted === 1)
        pending.add(options.attemptStarted);
      if (options.attemptFinished !== undefined) pending.delete(options.attemptFinished);
      record.value = {
        ...before,
        updatedAt: this.now(),
        status: label(options.status ?? before.status),
        pendingAttempts: [...pending],
      };
      if (
        before.events.length >= this.limits.eventsPerDecision ||
        !this.makeRoom(session, EVENT_RESERVATION + MATERIAL_RESERVATION, false, decisionId)
      ) {
        record.value = { ...record.value, omittedEvents: before.omittedEvents + 1 };
        return;
      }
      this.reserve(session, EVENT_RESERVATION + MATERIAL_RESERVATION);
      const id = `event:${++session.nextMaterial}`;
      let content: string;
      let failed = false;
      let redactionCount = 0;
      try {
        const serialized = serializeAiEvidence(payload);
        content = serialized.text;
        redactionCount = serialized.count;
      } catch {
        content = '';
        failed = true;
        session.captureFailures++;
      }
      if (!failed)
        this.makeRoom(
          session,
          Math.min(this.limits.itemBytes, Buffer.byteLength(content)),
          false,
          decisionId
        );
      this.material(session, id, stage, 'capture', content, failed, redactionCount);
      record.value = {
        ...record.value,
        events: [
          ...before.events,
          {
            stage: label(stage),
            timestamp: this.now(),
            materialId: id,
          },
        ],
      };
    });
  }

  end(matchId: string, endedAt = this.now()): void {
    const session = this.retained(matchId);
    if (!session || session.endedAt !== null) return;
    session.endedAt = endedAt;
    session.revision++;
  }

  list(matchId: string): AiTraceListing | null {
    const session = this.retained(matchId);
    return session ? globalThis.structuredClone(this.listing(session)) : null;
  }

  /** Single synchronous snapshot; HTTP JSON serialization happens after this method returns. */
  export(matchId: string, decisionId?: string): AiTraceExport | null {
    const session = this.retained(matchId);
    if (!session || (decisionId !== undefined && !session.decisions.has(decisionId))) return null;
    const decisions = [...session.decisions.values()]
      .map((entry) => entry.value)
      .filter((entry) => decisionId === undefined || entry.id === decisionId);
    const ids = new Set(
      decisions.flatMap((entry) => [
        ...entry.sourceMaterialIds,
        ...entry.events.map((event) => event.materialId),
      ])
    );
    // An empty session export still includes its frozen sources.
    if (decisionId === undefined) session.sources.forEach((id) => ids.add(id));
    const materials = [...ids].map((id) => session.materials.get(id)!);
    return globalThis.structuredClone({
      ...this.listing(session),
      format: 'loveca-ai-observation-v1',
      matchId,
      exportedAt: this.now(),
      decisions,
      materials,
      incompleteMaterialIds: materials
        .filter((item) => item.status !== 'COMPLETE')
        .map((item) => item.id),
    });
  }

  cleanup(): void {
    for (const [id, session] of this.sessions) {
      if (session.endedAt !== null && this.now() - session.endedAt >= this.limits.endedTtlMs) {
        this.bytes -= session.bytes;
        this.sessions.delete(id);
      }
    }
  }

  usage(): { readonly reservedBytes: number; readonly sessions: number } {
    return { reservedBytes: this.bytes, sessions: this.sessions.size };
  }

  reportCaptureFailure(matchId: string): void {
    const session = this.sessions.get(matchId);
    if (session) {
      session.captureFailures++;
      session.revision++;
    }
  }

  private retained(matchId: string): TraceSession | null {
    const session = this.sessions.get(matchId);
    return session &&
      !(session.endedAt !== null && this.now() - session.endedAt >= this.limits.endedTtlMs)
      ? session
      : null;
  }

  private listing(session: TraceSession): AiTraceListing {
    return {
      revision: session.revision,
      endedAt: session.endedAt,
      decisions: [...session.decisions.values()].map(({ value }) => {
        const summary: AiTraceDecisionSummary = {
          id: value.id,
          revision: value.revision,
          windowKey: value.windowKey,
          seat: value.seat,
          purpose: value.purpose,
          createdAt: value.createdAt,
          updatedAt: value.updatedAt,
          status: value.status,
          submissionSource: this.submissionSource(session, value),
          pendingAttempts: value.pendingAttempts,
          omittedEvents: value.omittedEvents,
        };
        return summary satisfies AiTraceDecisionSummary;
      }),
      evictedDecisions: session.evictedDecisions,
      omittedDecisions: session.omittedDecisions,
      discardedLateUpdates: session.discardedLateUpdates,
      captureFailures: session.captureFailures,
    };
  }

  private capture(session: TraceSession, write: () => void): void {
    try {
      write();
    } catch {
      session.captureFailures++;
    }
    session.revision++;
  }

  private submissionSource(
    session: TraceSession,
    decision: AiTraceDecision
  ): AiTraceDecisionSummary['submissionSource'] {
    const event = decision.events.find((event) => event.stage === 'SUBMIT');
    const material = event && session.materials.get(event.materialId);
    if (!material || material.status !== 'COMPLETE' || material.content === null) return null;
    try {
      const payload = JSON.parse(material.content) as { selection?: { source?: unknown } } | null;
      const source = payload?.selection?.source;
      return source === 'MODEL' || source === 'MECHANICAL' || source === 'FALLBACK' ? source : null;
    } catch {
      return null;
    }
  }

  private reserve(session: TraceSession, bytes: number): void {
    session.bytes += bytes;
    this.bytes += bytes;
  }

  private makeRoom(
    session: TraceSession,
    bytes: number,
    addingDecision: boolean,
    protectedId?: string
  ): boolean {
    const fits = () =>
      (!addingDecision || session.decisions.size < this.limits.decisions) &&
      session.bytes + bytes <= this.limits.sessionBytes &&
      this.bytes + bytes <= this.limits.processBytes;
    while (!fits()) {
      // Keep active attempts and the current decision's mapping. Never resurrect evicted late updates.
      const victim = [...session.decisions.entries()].find(
        ([id, entry]) =>
          id !== protectedId &&
          entry.value.pendingAttempts.length === 0 &&
          ['ACCEPTED', 'STALE', 'STOPPED', 'ENDED', 'WAITING'].includes(entry.value.status)
      );
      if (!victim) return false;
      const [id, record] = victim;
      for (const event of record.value.events) {
        const item = session.materials.get(event.materialId)!;
        this.reserve(session, -(EVENT_RESERVATION + MATERIAL_RESERVATION + item.retainedBytes));
        session.materials.delete(event.materialId);
      }
      this.reserve(session, -record.reservedBytes);
      session.decisions.delete(id);
      session.evictedDecisions++;
    }
    return true;
  }

  private material(
    session: TraceSession,
    id: string,
    title: string,
    source: string,
    content: string,
    failed = false,
    redactionCount = 0
  ): void {
    const originalBytes = Buffer.byteLength(content);
    const sessionAvailable = this.limits.sessionBytes - session.bytes;
    const processAvailable = this.limits.processBytes - this.bytes;
    const available = Math.max(
      0,
      Math.min(this.limits.itemBytes, sessionAvailable, processAvailable)
    );
    const reason = failed
      ? 'CAPTURE_FAILED'
      : originalBytes > available
        ? available === processAvailable
          ? 'PROCESS_LIMIT'
          : available === sessionAvailable
            ? 'SESSION_LIMIT'
            : 'ITEM_LIMIT'
        : undefined;
    const retained = failed
      ? ''
      : new TextDecoder().decode(Buffer.from(content).subarray(0, available), { stream: true });
    const retainedBytes = Buffer.byteLength(retained);
    session.materials.set(id, {
      id: label(id),
      title: label(title),
      source: label(source),
      sha256: createHash('sha256').update(content).digest('hex'),
      originalBytes,
      retainedBytes,
      content: failed || (reason && retainedBytes === 0) ? null : retained,
      status:
        failed || (reason && retainedBytes === 0) ? 'MISSING' : reason ? 'TRUNCATED' : 'COMPLETE',
      ...(reason ? { reason } : {}),
      redactionCount,
    });
    this.reserve(session, retainedBytes);
  }
}
