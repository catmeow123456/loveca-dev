import type { OnlineMatchSnapshot } from './release-types.js';
import type { Seat } from './types.js';
import type { AiBattleModel, CodexAiReasoningEffort } from './ai-battle-model-registry.js';
import type { AiMatchBilling, CodexBattleBudget } from './ai-battle-billing-types.js';

export interface AiBattlePresetChoice {
  readonly id: string;
  readonly name: string;
  readonly humanSelectable: boolean;
  readonly defaultHandbookId: string;
  readonly handbooks: readonly { readonly id: string; readonly name: string }[];
}

export interface AiBattlePresetInput {
  readonly humanPresetId: string;
  readonly aiPresetId: string;
  readonly handbookId: string;
}

export interface CreateAiBattleInput extends AiBattlePresetInput {
  readonly humanSeat: Seat;
  readonly model: AiBattleModel;
  /** Local Codex only; omitted requests use the server default. Frozen per game. */
  readonly reasoningEffort?: CodexAiReasoningEffort;
  /** Local Codex only; defaults off and is frozen per game. */
  readonly fastMode?: boolean;
  readonly enableThinking: boolean;
  /** Opt-in local disk archive, frozen at creation; unavailable in production. */
  readonly archiveEnabled?: boolean;
}

export interface AiBattleSessionView extends CreateAiBattleInput {
  readonly matchBilling: AiMatchBilling;
  /** Frozen local test limits, only available for current Codex sessions. */
  readonly codexBudget?: CodexBattleBudget;
  readonly matchId: string;
  readonly startedAt: number;
  readonly endedAt: number | null;
  readonly consecutiveFailures: number;
  readonly stoppedReason: string | null;
  readonly activity: 'THINKING' | 'WAITING' | 'STOPPED' | 'ENDED';
}

export interface CreateAiBattleResult {
  readonly session: AiBattleSessionView;
  readonly snapshot: OnlineMatchSnapshot;
}
