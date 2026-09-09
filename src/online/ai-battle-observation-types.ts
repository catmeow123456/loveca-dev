/** Administrator-only diagnostic DTOs. These never enter the normal player snapshot. */
export interface AiTraceMaterial {
  readonly id: string;
  readonly title: string;
  readonly source: string;
  /** Hash and size of the redacted, untrimmed evidence. */
  readonly sha256: string;
  readonly originalBytes: number;
  readonly retainedBytes: number;
  readonly content: string | null;
  readonly status: 'COMPLETE' | 'TRUNCATED' | 'MISSING';
  readonly reason?: 'ITEM_LIMIT' | 'SESSION_LIMIT' | 'PROCESS_LIMIT' | 'CAPTURE_FAILED';
  readonly redactionCount: number;
}

export interface AiTraceEvent {
  readonly stage: string;
  readonly timestamp: number;
  readonly materialId: string;
}

export interface AiTraceDecisionSummary {
  readonly id: string;
  readonly revision: number;
  /** Compact display value; the complete sampled identity is in the SAMPLE material. */
  readonly windowKey: string;
  readonly seat: string;
  readonly purpose: string;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly status: string;
  /** Derived from the retained SUBMIT material; null when unavailable or not submitted. */
  readonly submissionSource: 'MODEL' | 'MECHANICAL' | 'FALLBACK' | null;
  readonly pendingAttempts: readonly number[];
  readonly omittedEvents: number;
}

export interface AiTraceDecision extends Omit<AiTraceDecisionSummary, 'submissionSource'> {
  readonly sourceMaterialIds: readonly string[];
  readonly events: readonly AiTraceEvent[];
}

export interface AiTraceListing {
  readonly revision: number;
  readonly endedAt: number | null;
  readonly decisions: readonly AiTraceDecisionSummary[];
  readonly evictedDecisions: number;
  readonly omittedDecisions: number;
  readonly discardedLateUpdates: number;
  readonly captureFailures: number;
}

export interface AiTraceExport extends Omit<AiTraceListing, 'decisions'> {
  readonly format: 'loveca-ai-observation-v1';
  readonly matchId: string;
  readonly exportedAt: number;
  readonly decisions: readonly AiTraceDecision[];
  readonly materials: readonly AiTraceMaterial[];
  readonly incompleteMaterialIds: readonly string[];
}
