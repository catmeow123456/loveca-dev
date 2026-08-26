import { create } from 'zustand';
import type { GameCommand } from '@game/application/game-commands';
import type { TutorialCheckpointId, TutorialSessionSnapshot } from '@game/online';
import type { TutorialCommandResult } from '@game/online';
import type { TutorialCommandPolicy } from '@/components/tutorial/TutorialBattleGuidance';
import {
  advanceTutorialScript,
  createTutorialSession,
  deleteTutorialSession,
  executeTutorialCommand,
  fetchTutorialSession,
} from '@/lib/tutorialClient';

export interface TutorialRuntimeState {
  readonly accessToken: string;
  readonly snapshot: TutorialSessionSnapshot;
}

interface TutorialStoreState {
  readonly runtime: TutorialRuntimeState | null;
  readonly commandPolicy: TutorialCommandPolicy | null;
  readonly loadState: 'IDLE' | 'LOADING' | 'READY' | 'ERROR';
  readonly error: string | null;
  readonly scriptAdvancing: boolean;
  start: (
    scenarioId: string,
    scenarioVersion: string,
    checkpointId: TutorialCheckpointId
  ) => Promise<TutorialRuntimeState>;
  restart: (
    scenarioId: string,
    scenarioVersion: string,
    checkpointId: TutorialCheckpointId
  ) => Promise<TutorialRuntimeState>;
  refresh: () => Promise<TutorialSessionSnapshot>;
  execute: (
    command: GameCommand
  ) => Promise<TutorialCommandResult | { readonly success: false; readonly error: string }>;
  advanceScript: () => Promise<{ advanced: boolean; snapshot: TutorialSessionSnapshot }>;
  acceptSnapshot: (snapshot: TutorialSessionSnapshot) => void;
  setCommandPolicy: (policy: TutorialCommandPolicy | null) => void;
  stop: () => Promise<void>;
}

let startPromise: Promise<TutorialRuntimeState> | null = null;
let lifecycleGeneration = 0;

export const useTutorialStore = create<TutorialStoreState>((set, get) => ({
  runtime: null,
  commandPolicy: null,
  loadState: 'IDLE',
  error: null,
  scriptAdvancing: false,

  start: async (scenarioId, scenarioVersion, checkpointId) => {
    const existing = get().runtime;
    if (
      existing?.snapshot.scenarioId === scenarioId &&
      existing.snapshot.scenarioVersion === scenarioVersion &&
      existing.snapshot.checkpointId === checkpointId
    ) {
      return existing;
    }
    if (startPromise) return startPromise;

    set({ loadState: 'LOADING', error: null });
    const requestGeneration = lifecycleGeneration;
    const request = createTutorialSession(scenarioId, scenarioVersion, checkpointId)
      .then(async (created) => {
        if (requestGeneration !== lifecycleGeneration) {
          try {
            await deleteTutorialSession(created.snapshot.runId, created.accessToken);
          } catch {
            // 已取消的临时会话仍会由服务端 TTL 回收。
          }
          throw new Error('教程创建已取消');
        }
        const runtime = { accessToken: created.accessToken, snapshot: created.snapshot };
        set({ runtime, loadState: 'READY', error: null });
        return runtime;
      })
      .catch((error) => {
        if (requestGeneration === lifecycleGeneration) {
          const message = error instanceof Error ? error.message : '教程暂时不可用';
          set({ loadState: 'ERROR', error: message });
        }
        throw error;
      })
      .finally(() => {
        if (startPromise === request) startPromise = null;
      });
    startPromise = request;
    return request;
  },

  restart: async (scenarioId, scenarioVersion, checkpointId) => {
    await get().stop();
    return get().start(scenarioId, scenarioVersion, checkpointId);
  },

  refresh: async () => {
    const runtime = get().runtime;
    if (!runtime) throw new Error('教程会话尚未建立');
    const snapshot = await fetchTutorialSession(runtime.snapshot.runId, runtime.accessToken);
    get().acceptSnapshot(snapshot);
    return snapshot;
  },

  execute: async (command) => {
    const runtime = get().runtime;
    if (!runtime) throw new Error('教程会话尚未建立');
    const policy = get().commandPolicy;
    const permission = policy?.(command);
    if (!policy || !permission?.allowed) {
      return {
        success: false as const,
        error: permission?.reason ?? '教学提示正在切换，请按当前步骤继续',
      };
    }
    const result = await executeTutorialCommand(
      runtime.snapshot.runId,
      runtime.accessToken,
      runtime.snapshot.playerViewState.match.seq,
      command
    );
    get().acceptSnapshot(result.snapshot);
    return result;
  },

  advanceScript: async () => {
    const runtime = get().runtime;
    if (!runtime) throw new Error('教程会话尚未建立');
    if (get().scriptAdvancing) {
      return { advanced: false, snapshot: runtime.snapshot };
    }
    set({ scriptAdvancing: true });
    try {
      const result = await advanceTutorialScript(
        runtime.snapshot.runId,
        runtime.accessToken,
        runtime.snapshot.playerViewState.match.seq
      );
      get().acceptSnapshot(result.snapshot);
      return result;
    } finally {
      set({ scriptAdvancing: false });
    }
  },

  acceptSnapshot: (snapshot) => {
    set((state) => {
      if (!state.runtime || state.runtime.snapshot.runId !== snapshot.runId) return state;
      return {
        runtime: { ...state.runtime, snapshot },
        loadState: 'READY',
        error: snapshot.error ?? null,
      };
    });
  },

  setCommandPolicy: (commandPolicy) => set({ commandPolicy }),

  stop: async () => {
    lifecycleGeneration += 1;
    startPromise = null;
    const runtime = get().runtime;
    set({
      runtime: null,
      commandPolicy: null,
      loadState: 'IDLE',
      error: null,
      scriptAdvancing: false,
    });
    if (!runtime) return;
    try {
      await deleteTutorialSession(runtime.snapshot.runId, runtime.accessToken);
    } catch {
      // 临时会话会由 TTL 回收；退出界面不能被清理请求阻塞。
    }
  },
}));
