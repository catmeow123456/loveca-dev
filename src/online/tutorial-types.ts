import type { GameCommand } from '../application/game-commands.js';
import type { PlayerViewState, Seat } from './types.js';

export type TutorialSessionStatus = 'ACTIVE' | 'COMPLETED' | 'ERROR';

export const TUTORIAL_CHECKPOINT_IDS = {
  FOUNDATIONS: 'FOUNDATIONS',
  LIVE_EFFECTS: 'LIVE_EFFECTS',
  RECOVERY_LOOP: 'RECOVERY_LOOP',
  FINISHING_LIVE: 'FINISHING_LIVE',
} as const;

export type TutorialCheckpointId =
  (typeof TUTORIAL_CHECKPOINT_IDS)[keyof typeof TUTORIAL_CHECKPOINT_IDS];

export interface TutorialObjectBindings {
  readonly [role: string]: string | undefined;
}

export interface TutorialAcceptedCommandReceipt {
  readonly actorSeat: Seat;
  readonly resultingSeq: number;
  /** 仅包含当前教程玩家自己已接受的命令。 */
  readonly command: GameCommand;
}

/**
 * 教程 transport 唯一允许返回给玩家的运行时快照。
 *
 * 私密场景、随机决策带、原始对象 ID 和脚本命令均不属于该契约。
 */
export interface TutorialSessionSnapshot {
  readonly runId: string;
  readonly scenarioId: string;
  readonly scenarioVersion: string;
  readonly checkpointId: TutorialCheckpointId;
  /** 与权威检查点对应的客户端稳定步骤 ID。 */
  readonly entryStepId: string;
  readonly status: TutorialSessionStatus;
  readonly expiresAt: number;
  readonly playerViewState: PlayerViewState;
  readonly objectBindings: TutorialObjectBindings;
  readonly acceptedCommands: readonly TutorialAcceptedCommandReceipt[];
  readonly error?: string;
}

export interface TutorialCommandResult {
  readonly success: true;
  readonly snapshot: TutorialSessionSnapshot;
}

export interface TutorialScriptAdvanceResult extends TutorialCommandResult {
  /** false 表示当前没有满足公开状态前置条件的脚本动作。 */
  readonly advanced: boolean;
}
