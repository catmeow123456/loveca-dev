import type { OnlineMatchSnapshot } from './release-types.js';
import type { Seat } from './types.js';
import type { AiBattleModel, AiMatchBilling } from './ai-battle-billing-types.js';

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
  readonly enableThinking: boolean;
}

export interface AiBattleSessionView extends CreateAiBattleInput {
  readonly matchBilling: AiMatchBilling;
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
