import type { OnlineMatchSnapshot } from './release-types.js';
import type { Seat } from './types.js';
import type { AiBattleModel, CodexAiReasoningEffort } from './ai-battle-model-registry.js';
import type { AiMatchBilling, CodexBattleBudget } from './ai-battle-billing-types.js';
import type { OnlineSpectatorLinkView } from './release-types.js';

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

export interface AiBattleModelInput {
  readonly model: AiBattleModel;
  /** Local Codex only; omitted requests use the server default. Frozen per game. */
  readonly reasoningEffort?: CodexAiReasoningEffort;
  /** Local Codex only; defaults off and is frozen per game. */
  readonly fastMode?: boolean;
  readonly enableThinking: boolean;
  /** Opt-in local disk archive, frozen at creation; unavailable in production. */
  readonly archiveEnabled?: boolean;
}

export interface CreateAiBattleInput extends AiBattlePresetInput, AiBattleModelInput {
  readonly humanSeat: Seat;
}

export interface AiSelfPlaySeatInput {
  readonly presetId: string;
  readonly handbookId: string;
}

/** Both seats use the chosen model, with independently frozen decks and handbooks. */
export interface CreateAiSelfPlayInput extends AiBattleModelInput {
  readonly FIRST: AiSelfPlaySeatInput;
  readonly SECOND: AiSelfPlaySeatInput;
}

export interface AiBattleSessionStatusView {
  readonly ownerUserId: string;
  readonly ownerDisplayName: string;
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

export type AiHumanBattleSessionView = CreateAiBattleInput &
  AiBattleSessionStatusView & {
    readonly mode: 'HUMAN_VS_AI';
  };
export type AiSelfPlaySessionView = CreateAiSelfPlayInput &
  AiBattleSessionStatusView & {
    readonly mode: 'AI_VS_AI';
  };
export type AiBattleSessionView = AiHumanBattleSessionView | AiSelfPlaySessionView;

export interface CreateAiBattleResult {
  readonly session: AiHumanBattleSessionView;
  readonly snapshot: OnlineMatchSnapshot;
}

export interface CreateAiSelfPlayResult {
  readonly session: AiSelfPlaySessionView;
  readonly spectatorLink: OnlineSpectatorLinkView;
}
