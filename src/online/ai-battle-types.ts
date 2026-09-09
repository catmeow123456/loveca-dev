import type { OnlineMatchSnapshot } from './release-types.js';
import type { Seat } from './types.js';

export interface AiBattlePresetChoice {
  readonly id: string;
  readonly name: string;
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
}

export interface AiBattleSessionView extends CreateAiBattleInput {
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
