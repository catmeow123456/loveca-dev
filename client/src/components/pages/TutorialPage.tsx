import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowRight, Clock3, RotateCcw, School, TriangleAlert } from 'lucide-react';
import { TUTORIAL_CHECKPOINT_IDS, type TutorialCheckpointId } from '@game/online';
import { PageHeader } from '@/components/common';
import { BattleViewportShell } from '@/components/game/BattleViewportShell';
import { TutorialBattleSurface } from '@/components/tutorial/TutorialBattleSurface';
import type { TutorialCommandPolicy } from '@/components/tutorial/TutorialBattleGuidance';
import { tutorialSnapshotToRemote } from '@/lib/tutorialClient';
import {
  getTutorialScriptAdvanceDelayMs,
  isTutorialEntryBlockedByExistingBattle,
  shouldPauseTutorialScript,
} from '@/lib/tutorialBattleUi';
import { readTutorialCompletion, writeTutorialCompletion } from '@/lib/tutorialCompletion';
import { TUTORIAL_PORTRAIT_ASSETS, TUTORIAL_STICKER_ASSETS } from '@/lib/tutorialMascotAssets';
import type { TutorialProgressState } from '@/lib/tutorialScenario';
import {
  BASIC_LIVE_TUTORIAL,
  BASIC_LIVE_TUTORIAL_CHECKPOINTS,
  type BasicLiveTutorialCheckpointOption,
} from '@/tutorial/basicLiveTutorial';
import { useGameStore } from '@/store/gameStore';
import { useTutorialStore } from '@/store/tutorialStore';

export interface TutorialPageProps {
  readonly onExit: () => void;
}

const BASIC_LIVE_TUTORIAL_COMPLETION_IDENTITY = {
  scenarioId: BASIC_LIVE_TUTORIAL.id,
  scenarioVersion: BASIC_LIVE_TUTORIAL.version,
  contentVersion: BASIC_LIVE_TUTORIAL.contentVersion,
} as const;

function getTutorialCompletionStorage(): Storage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function getTutorialLoadingPortrait(checkpointId: TutorialCheckpointId | null): string {
  switch (checkpointId) {
    case TUTORIAL_CHECKPOINT_IDS.LIVE_EFFECTS:
      return TUTORIAL_PORTRAIT_ASSETS.READING;
    case TUTORIAL_CHECKPOINT_IDS.RECOVERY_LOOP:
    case TUTORIAL_CHECKPOINT_IDS.FINISHING_LIVE:
      return TUTORIAL_PORTRAIT_ASSETS.THINKING;
    case TUTORIAL_CHECKPOINT_IDS.FOUNDATIONS:
    default:
      return TUTORIAL_PORTRAIT_ASSETS.WELCOME;
  }
}

export function TutorialPage({ onExit }: TutorialPageProps) {
  const runtime = useTutorialStore((state) => state.runtime);
  const loadState = useTutorialStore((state) => state.loadState);
  const error = useTutorialStore((state) => state.error);
  const start = useTutorialStore((state) => state.start);
  const restart = useTutorialStore((state) => state.restart);
  const stop = useTutorialStore((state) => state.stop);
  const advanceScript = useTutorialStore((state) => state.advanceScript);
  const setCommandPolicy = useTutorialStore((state) => state.setCommandPolicy);
  const connectRemoteSession = useGameStore((state) => state.connectRemoteSession);
  const applyRemoteSnapshot = useGameStore((state) => state.applyRemoteSnapshot);
  const disconnectRemoteSession = useGameStore((state) => state.disconnectRemoteSession);
  const remoteSession = useGameStore((state) => state.remoteSession);
  const hasMatchView = useGameStore((state) => state.getMatchView() !== null);
  const scenario = BASIC_LIVE_TUTORIAL;
  const [requestedCheckpointId, setRequestedCheckpointId] = useState<TutorialCheckpointId | null>(
    runtime?.snapshot.checkpointId ?? null
  );
  const [completed, setCompleted] = useState(false);
  const [hasCompletedCurrentVersion, setHasCompletedCurrentVersion] = useState(() =>
    readTutorialCompletion(getTutorialCompletionStorage(), BASIC_LIVE_TUTORIAL_COMPLETION_IDENTITY)
  );
  const [restarting, setRestarting] = useState(false);
  const [progressRecord, setProgressRecord] = useState<{
    readonly runId: string;
    readonly progress: TutorialProgressState;
  } | null>(null);
  const lastScriptProbeSeqRef = useRef<number | null>(null);
  const activeProgress =
    runtime && progressRecord?.runId === runtime.snapshot.runId ? progressRecord.progress : null;
  const activeStep = activeProgress ? scenario.steps[activeProgress.currentStepIndex] : undefined;
  const pauseScript = shouldPauseTutorialScript(
    activeStep,
    activeProgress?.viewConditionSatisfiedAtMs
  );
  const tutorialEntryBlocked = isTutorialEntryBlockedByExistingBattle(
    remoteSession?.source ?? null,
    hasMatchView
  );

  useEffect(() => {
    if (!runtime || tutorialEntryBlocked) return;
    const remote = tutorialSnapshotToRemote(runtime.snapshot);
    if (remoteSession?.source !== 'TUTORIAL' || remoteSession.matchId !== remote.matchId) {
      connectRemoteSession({
        source: 'TUTORIAL',
        matchId: remote.matchId,
        seat: remote.seat,
        playerId: remote.playerId,
      });
    }
    void applyRemoteSnapshot(remote);
  }, [
    applyRemoteSnapshot,
    connectRemoteSession,
    remoteSession?.matchId,
    remoteSession?.source,
    runtime,
    tutorialEntryBlocked,
  ]);

  useEffect(() => {
    const snapshot = runtime?.snapshot;
    if (!snapshot || snapshot.status !== 'ACTIVE') return;
    if (pauseScript) {
      // A previously scheduled probe for the same revision must be allowed after “下一步”.
      lastScriptProbeSeqRef.current = null;
      return;
    }
    const seq = snapshot.playerViewState.match.seq;
    if (lastScriptProbeSeqRef.current === seq) return;
    lastScriptProbeSeqRef.current = seq;

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const timeout = window.setTimeout(
      () => {
        void advanceScript().catch(() => undefined);
      },
      getTutorialScriptAdvanceDelayMs(snapshot.playerViewState.match, reduceMotion)
    );
    return () => window.clearTimeout(timeout);
  }, [advanceScript, pauseScript, runtime?.snapshot]);

  const handlePolicyChange = useCallback(
    (policy: TutorialCommandPolicy | null) => setCommandPolicy(policy),
    [setCommandPolicy]
  );

  const handleProgressChange = useCallback(
    (progress: TutorialProgressState) => {
      const runId = runtime?.snapshot.runId;
      if (runId) setProgressRecord({ runId, progress });
    },
    [runtime?.snapshot.runId]
  );

  const handleExit = useCallback(() => {
    void stop().finally(() => {
      disconnectRemoteSession();
      onExit();
    });
  }, [disconnectRemoteSession, onExit, stop]);

  const handleStartCheckpoint = useCallback(
    (checkpointId: TutorialCheckpointId) => {
      if (tutorialEntryBlocked) return;
      setRequestedCheckpointId(checkpointId);
      setCompleted(false);
      setProgressRecord(null);
      lastScriptProbeSeqRef.current = null;
      void start(scenario.id, scenario.version, checkpointId).catch(() => undefined);
    },
    [scenario.id, scenario.version, start, tutorialEntryBlocked]
  );

  const handleRestart = useCallback(() => {
    if (restarting) return;
    const checkpointId = runtime?.snapshot.checkpointId ?? requestedCheckpointId;
    if (!checkpointId) return;
    setRestarting(true);
    setCompleted(false);
    setProgressRecord(null);
    lastScriptProbeSeqRef.current = null;
    disconnectRemoteSession();
    void restart(scenario.id, scenario.version, checkpointId).finally(() => {
      setRestarting(false);
    });
  }, [
    disconnectRemoteSession,
    requestedCheckpointId,
    restart,
    restarting,
    runtime?.snapshot.checkpointId,
    scenario.id,
    scenario.version,
  ]);

  const handleChooseChapter = useCallback(() => {
    setCompleted(false);
    setProgressRecord(null);
    setRequestedCheckpointId(null);
    lastScriptProbeSeqRef.current = null;
    disconnectRemoteSession();
    void stop();
  }, [disconnectRemoteSession, stop]);

  const handleCompleted = useCallback(() => {
    setCompleted(true);
    setHasCompletedCurrentVersion(true);
    writeTutorialCompletion(
      getTutorialCompletionStorage(),
      BASIC_LIVE_TUTORIAL_COMPLETION_IDENTITY
    );
  }, []);

  if (tutorialEntryBlocked) {
    return <TutorialBattleConflictState onExit={onExit} />;
  }

  if (!runtime && !requestedCheckpointId && loadState !== 'ERROR') {
    return (
      <TutorialChapterSelection
        checkpoints={BASIC_LIVE_TUTORIAL_CHECKPOINTS}
        completed={hasCompletedCurrentVersion}
        onSelect={handleStartCheckpoint}
        onExit={onExit}
      />
    );
  }

  if (loadState === 'ERROR' || runtime?.snapshot.status === 'ERROR') {
    return (
      <TutorialErrorState
        message={error ?? runtime?.snapshot.error ?? '教程场景执行异常'}
        onRetry={handleRestart}
        onChooseChapter={handleChooseChapter}
        onExit={handleExit}
      />
    );
  }

  if (!runtime || loadState === 'LOADING') {
    return (
      <TutorialLoadingState
        title="小铃正在准备牌桌"
        portraitSrc={getTutorialLoadingPortrait(
          requestedCheckpointId ?? runtime?.snapshot.checkpointId ?? null
        )}
        onExit={handleExit}
      />
    );
  }

  if (completed) {
    return (
      <TutorialCompletionState
        restarting={restarting}
        onRestart={handleRestart}
        onChooseChapter={handleChooseChapter}
        onExit={handleExit}
      />
    );
  }

  return (
    <BattleViewportShell>
      <TutorialBattleSurface
        key={runtime.snapshot.runId}
        scenario={scenario}
        entryStepId={runtime.snapshot.entryStepId}
        objectBindings={runtime.snapshot.objectBindings}
        acceptedCommands={runtime.snapshot.acceptedCommands}
        resumeProgress={
          progressRecord?.runId === runtime.snapshot.runId ? progressRecord.progress : undefined
        }
        onProgressChange={handleProgressChange}
        onCommandPolicyChange={handlePolicyChange}
        onCompleted={handleCompleted}
        gameBoardProps={{
          onLeaveLocalGame: handleExit,
          onRestartGame: handleRestart,
          showDesktopPublicBattleLogButton: false,
        }}
      />
    </BattleViewportShell>
  );
}

function TutorialBattleConflictState({ onExit }: { onExit: () => void }) {
  return (
    <main className="app-shell flex min-h-dvh items-center justify-center px-5">
      <section className="w-full max-w-lg rounded-xl border border-[color:color-mix(in_srgb,var(--semantic-warning)_45%,var(--border-default))] bg-[var(--bg-surface)] p-6 text-center shadow-[var(--shadow-md)]">
        <TriangleAlert
          className="mx-auto h-7 w-7 text-[var(--semantic-warning)]"
          aria-hidden="true"
        />
        <h1 className="mt-3 text-lg font-bold text-[var(--text-primary)]">已有对局正在进行</h1>
        <p className="mt-2 text-sm text-[var(--text-secondary)]">
          新手教程会使用同一张共享牌桌。请先返回并离开当前对局，再开始教程。
        </p>
        <button type="button" className="button-primary mt-5 min-h-10 px-4" onClick={onExit}>
          返回首页
        </button>
      </section>
    </main>
  );
}

function TutorialCompletionState({
  restarting,
  onRestart,
  onChooseChapter,
  onExit,
}: {
  restarting: boolean;
  onRestart: () => void;
  onChooseChapter: () => void;
  onExit: () => void;
}) {
  return (
    <main className="app-shell flex min-h-dvh items-center justify-center overflow-x-hidden px-5 py-6 sm:py-8">
      <div className="grid w-full max-w-3xl items-center gap-4 sm:grid-cols-[minmax(0,0.78fr)_minmax(0,1.22fr)] sm:gap-7">
        <img
          src={TUTORIAL_PORTRAIT_ASSETS.SUCCESS}
          alt=""
          aria-hidden="true"
          className="mx-auto h-44 w-auto object-contain sm:h-[22rem] lg:h-[24rem]"
        />

        <section className="rounded-2xl border border-[color:color-mix(in_srgb,var(--semantic-success)_42%,var(--border-default))] bg-[var(--bg-surface)] p-5 shadow-[var(--shadow-lg)] sm:p-7">
          <div className="flex items-center gap-3">
            <img
              src={TUTORIAL_STICKER_ASSETS.CELEBRATE}
              alt=""
              aria-hidden="true"
              className="h-14 w-14 shrink-0 object-contain"
            />
            <div>
              <div className="text-xs font-semibold text-[var(--semantic-success)]">
                新手教程完成
              </div>
              <h1 className="mt-1 text-2xl font-bold tracking-tight text-[var(--text-primary)]">
                徒町挑战成功！
              </h1>
            </div>
          </div>

          <div className="mt-6 flex flex-wrap justify-center gap-2 sm:justify-start">
            <button
              type="button"
              className="button-primary min-h-10 px-4"
              onClick={onChooseChapter}
            >
              选择其他章节
            </button>
            <button
              type="button"
              className="button-secondary min-h-10 px-4"
              onClick={onRestart}
              disabled={restarting}
            >
              {restarting ? '正在准备…' : '再练一次'}
            </button>
            <button type="button" className="button-secondary min-h-10 px-4" onClick={onExit}>
              返回首页
            </button>
          </div>
        </section>
      </div>
    </main>
  );
}

function TutorialChapterSelection({
  checkpoints,
  completed,
  onSelect,
  onExit,
}: {
  checkpoints: readonly BasicLiveTutorialCheckpointOption[];
  completed: boolean;
  onSelect: (checkpointId: TutorialCheckpointId) => void;
  onExit: () => void;
}) {
  return (
    <div className="app-shell min-h-dvh overflow-x-hidden">
      <PageHeader
        title="新手教程"
        description="从所选章节继续练到教程结束，可随时退出"
        icon={<School className="h-5 w-5" aria-hidden="true" />}
        onBack={onExit}
        backLabel="返回首页"
      />

      <main className="mx-auto w-full max-w-3xl px-4 py-7 sm:px-6 sm:py-10">
        {completed ? (
          <p className="mb-3 text-sm text-[var(--text-secondary)]">
            <span className="mr-2 inline-flex rounded-full bg-[color:color-mix(in_srgb,var(--semantic-success)_14%,transparent)] px-2 py-0.5 text-xs font-semibold text-[var(--semantic-success)]">
              已完成
            </span>
            当前教程版本已完成，仍可选择任意章节重新练习。
          </p>
        ) : null}
        <div aria-label="教程章节">
          <ol className="overflow-hidden rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] shadow-[var(--shadow-sm)] divide-y divide-[var(--border-subtle)]">
            {checkpoints.map((checkpoint, index) => (
              <li key={checkpoint.id}>
                <button
                  type="button"
                  className="group flex min-h-24 w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-[var(--bg-elevated)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--accent-primary)] sm:gap-4 sm:px-5"
                  onClick={() => onSelect(checkpoint.id)}
                  aria-describedby={`tutorial-checkpoint-${checkpoint.id}-description`}
                >
                  <span
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[color:color-mix(in_srgb,var(--accent-primary)_50%,var(--border-default))] text-sm font-bold text-[var(--accent-primary)]"
                    aria-hidden="true"
                  >
                    {index + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <strong className="text-base font-bold text-[var(--text-primary)]">
                        {checkpoint.title}
                      </strong>
                      {checkpoint.recommended ? (
                        <span className="text-[11px] font-semibold text-[var(--accent-primary)]">
                          推荐
                        </span>
                      ) : null}
                    </div>
                    <p
                      id={`tutorial-checkpoint-${checkpoint.id}-description`}
                      className="mt-1 text-sm leading-5 text-[var(--text-secondary)]"
                    >
                      {checkpoint.summary}
                    </p>
                    <span className="mt-1.5 inline-flex items-center gap-1.5 text-xs text-[var(--text-muted)] sm:hidden">
                      <Clock3 className="h-3.5 w-3.5" aria-hidden="true" />
                      {checkpoint.durationLabel}
                    </span>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <span className="hidden items-center gap-1.5 text-xs text-[var(--text-muted)] sm:inline-flex">
                      <Clock3 className="h-3.5 w-3.5" aria-hidden="true" />
                      {checkpoint.durationLabel}
                    </span>
                    <ArrowRight
                      className="h-5 w-5 text-[var(--accent-primary)] transition-transform group-hover:translate-x-0.5"
                      aria-hidden="true"
                    />
                  </div>
                </button>
              </li>
            ))}
          </ol>
        </div>
      </main>
    </div>
  );
}

function TutorialLoadingState({
  title,
  portraitSrc,
  onExit,
}: {
  title: string;
  portraitSrc: string;
  onExit: () => void;
}) {
  return (
    <main className="app-shell flex min-h-dvh items-center justify-center px-5">
      <div className="max-w-md text-center">
        <img
          src={portraitSrc}
          alt=""
          aria-hidden="true"
          className="mx-auto mb-4 h-40 w-auto object-contain"
        />
        <h1 className="text-lg font-bold text-[var(--text-primary)]">{title}</h1>
        <button type="button" className="button-secondary mt-5 min-h-10 px-4" onClick={onExit}>
          返回首页
        </button>
      </div>
    </main>
  );
}

function TutorialErrorState({
  message,
  onRetry,
  onChooseChapter,
  onExit,
}: {
  message: string;
  onRetry: () => void;
  onChooseChapter: () => void;
  onExit: () => void;
}) {
  return (
    <main className="app-shell flex min-h-dvh items-center justify-center px-5">
      <div className="flex w-full max-w-2xl flex-col items-center gap-4 sm:flex-row sm:items-end">
        <img
          src={TUTORIAL_PORTRAIT_ASSETS.RETRY}
          alt=""
          aria-hidden="true"
          className="h-36 w-auto shrink-0 object-contain sm:h-52"
        />
        <div className="w-full rounded-xl border border-[color:color-mix(in_srgb,var(--semantic-warning)_45%,var(--border-default))] bg-[var(--bg-surface)] p-6 text-center shadow-[var(--shadow-md)]">
          <TriangleAlert
            className="mx-auto h-7 w-7 text-[var(--semantic-warning)]"
            aria-hidden="true"
          />
          <h1 className="mt-3 text-lg font-bold text-[var(--text-primary)]">教程暂时无法继续</h1>
          <p className="mt-2 text-sm text-[var(--text-secondary)]">{message}</p>
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            <button type="button" className="button-secondary min-h-10 px-4" onClick={onExit}>
              返回首页
            </button>
            <button
              type="button"
              className="button-secondary min-h-10 px-4"
              onClick={onChooseChapter}
            >
              选择章节
            </button>
            <button
              type="button"
              className="button-primary inline-flex min-h-10 items-center gap-2 px-4"
              onClick={onRetry}
            >
              <RotateCcw className="h-4 w-4" aria-hidden="true" />
              重新开始
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}

export default TutorialPage;
