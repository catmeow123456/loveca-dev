export const CARD_SYNC_POLICY = {
  collection: 'loveca',
  status: 'DRAFT',
  uploadImages: true,
  allowMissingImages: false,
  overwriteImages: false,
} as const;

export type CardSyncEngineCardType = 'MEMBER' | 'LIVE' | 'ENERGY';

export interface CardSyncEngineCandidate {
  readonly cardCode: string;
  readonly name: string | null;
  readonly cardType: CardSyncEngineCardType | null;
  readonly imageFilename: string | null;
  readonly warnings: readonly string[];
}

export interface CardSyncEngineBlockedItem {
  readonly cardCode: string | null;
  readonly code: string;
  readonly message: string;
}

export interface CardSyncEnginePreview {
  readonly sourceHash: string;
  readonly generatedAt: string;
  readonly counts: {
    readonly source: number;
    readonly existing: number;
    readonly candidates: number;
    readonly blocked: number;
  };
  readonly candidates: readonly CardSyncEngineCandidate[];
  readonly blocked: readonly CardSyncEngineBlockedItem[];
}

export interface CardSyncEngineApplyItem {
  readonly cardCode: string;
  readonly result: 'SUCCEEDED' | 'SKIPPED' | 'FAILED';
  readonly message: string | null;
}

export interface CardSyncEngineApplyInput {
  readonly runId: string;
  readonly actorUserId: string;
  readonly requestId: string;
  readonly expectedSourceHash: string;
  readonly expectedCandidateCardCodes: readonly string[];
  readonly execution: CardSyncExecutionLease;
}

export interface CardSyncExecutionLease {
  readonly token: string;
  readonly generation: number;
  readonly signal: AbortSignal;
  readonly assertCurrent: () => Promise<void>;
}

export interface CardSyncEngineApplyResult {
  readonly sourceHash: string;
  readonly items: readonly CardSyncEngineApplyItem[];
}

export interface CardSyncEngineConfigurationStatus {
  readonly configured: boolean;
  readonly missing: readonly string[];
}

export interface CardSyncEngine {
  getConfigurationStatus(): CardSyncEngineConfigurationStatus;
  preview(): Promise<CardSyncEnginePreview>;
  apply(input: CardSyncEngineApplyInput): Promise<CardSyncEngineApplyResult>;
}

export class CardSyncEngineError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message);
  }
}

export class CardSyncPreviewStaleError extends CardSyncEngineError {
  constructor(message = '上游数据或待同步卡牌已变化，请重新检查') {
    super('PREVIEW_STALE', message);
  }
}

export class CardSyncLeaseLostError extends CardSyncEngineError {
  constructor(message = '同步任务执行租约已失效') {
    super('LEASE_LOST', message);
  }
}
