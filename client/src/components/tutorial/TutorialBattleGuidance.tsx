import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useState,
} from 'react';
import type { GameCommand } from '@game/application/game-commands';
import type { PlayerViewState } from '@game/online';
import {
  continueTutorialInformationStep,
  createTutorialProgress,
  evaluateTutorialCommandPermission,
  reduceTutorialProgress,
  resolveTutorialReviewPresentation,
  resolveTutorialStepPresentation,
  type TutorialAcceptedCommand,
  type TutorialCommandPermission,
  type TutorialObjectBindings,
  type TutorialProgressState,
  type TutorialRuntimeSnapshot,
  type TutorialScenarioDefinition,
} from '@/lib/tutorialScenario';
import type { TutorialGuidancePresentation, TutorialGuidanceTarget } from '@/lib/tutorialGuidance';
import { TutorialGuidanceLayer } from './TutorialGuidanceLayer';

export type TutorialCommandPolicy = (command: GameCommand) => TutorialCommandPermission;

export interface TutorialBattleGuidanceProps {
  readonly scenario: TutorialScenarioDefinition;
  readonly playerViewState: PlayerViewState | null;
  readonly objectBindings: TutorialObjectBindings;
  readonly acceptedCommands?: readonly TutorialAcceptedCommand[];
  readonly initialProgress?: TutorialProgressState;
  readonly targetOverride?: TutorialGuidanceTarget;
  readonly onProgressChange?: (progress: TutorialProgressState) => void;
  readonly onCommandPolicyChange?: (policy: TutorialCommandPolicy | null) => void;
  readonly onCompleted?: (progress: TutorialProgressState) => void;
  readonly onTargetUnavailable?: (stepId: string) => void;
}

type ControllerAction =
  | {
      readonly type: 'SYNC';
      readonly scenario: TutorialScenarioDefinition;
      readonly runtime: TutorialRuntimeSnapshot;
    }
  | {
      readonly type: 'CONTINUE_INFO';
      readonly scenario: TutorialScenarioDefinition;
      readonly currentSeq: number;
    };

function progressReducer(
  progress: TutorialProgressState,
  action: ControllerAction
): TutorialProgressState {
  if (action.type === 'CONTINUE_INFO') {
    return continueTutorialInformationStep(action.scenario, progress, action.currentSeq);
  }
  return reduceTutorialProgress(action.scenario, progress, action.runtime);
}

interface TutorialStepGuidanceProps {
  readonly presentation: TutorialGuidancePresentation;
  readonly onBack?: () => void;
  readonly onContinue?: () => void;
  readonly onTargetUnavailable?: (stepId: string) => void;
}

const TutorialStepGuidance = memo(function TutorialStepGuidance({
  presentation,
  onBack,
  onContinue,
  onTargetUnavailable,
}: TutorialStepGuidanceProps) {
  const [targetVisible, setTargetVisible] = useState(presentation.target == null);
  const handleTargetVisibilityChange = useCallback(
    (visible: boolean) => {
      setTargetVisible(visible);
      if (!visible) onTargetUnavailable?.(presentation.stepId);
    },
    [onTargetUnavailable, presentation.stepId]
  );

  return (
    <TutorialGuidanceLayer
      presentation={presentation}
      onBack={onBack}
      onContinue={targetVisible ? onContinue : undefined}
      onTargetVisibilityChange={handleTargetVisibilityChange}
    />
  );
});

export const TutorialBattleGuidance = memo(function TutorialBattleGuidance({
  scenario,
  playerViewState,
  objectBindings,
  acceptedCommands,
  initialProgress,
  targetOverride,
  onProgressChange,
  onCommandPolicyChange,
  onCompleted,
  onTargetUnavailable,
}: TutorialBattleGuidanceProps) {
  const [progress, dispatch] = useReducer(
    progressReducer,
    initialProgress ?? createTutorialProgress(scenario, playerViewState?.match.seq ?? 0)
  );
  const [reviewStepIndex, setReviewStepIndex] = useState<number | null>(null);

  useEffect(() => {
    dispatch({
      type: 'SYNC',
      scenario,
      runtime: { playerViewState, objectBindings, acceptedCommands, nowMs: Date.now() },
    });
  }, [acceptedCommands, objectBindings, playerViewState, scenario]);

  useLayoutEffect(() => {
    onProgressChange?.(progress);
  }, [onProgressChange, progress]);

  useEffect(() => {
    if (progress.status === 'COMPLETED') onCompleted?.(progress);
  }, [onCompleted, progress]);

  const currentStep = scenario.steps[progress.currentStepIndex] ?? null;

  useEffect(() => {
    const satisfiedAtMs = progress.viewConditionSatisfiedAtMs;
    const dwellMs = currentStep?.completionDwellMs;
    if (satisfiedAtMs === undefined || dwellMs === undefined) return;

    const remainingMs = Math.max(0, satisfiedAtMs + dwellMs - Date.now());
    const timer = window.setTimeout(() => {
      dispatch({
        type: 'SYNC',
        scenario,
        runtime: { playerViewState, objectBindings, acceptedCommands, nowMs: Date.now() },
      });
    }, remainingMs + 16);
    return () => window.clearTimeout(timer);
  }, [
    acceptedCommands,
    currentStep?.completionDwellMs,
    objectBindings,
    playerViewState,
    progress.viewConditionSatisfiedAtMs,
    scenario,
  ]);

  const commandPolicy = useMemo<TutorialCommandPolicy | null>(() => {
    if (progress.status !== 'ACTIVE' || !currentStep) return null;
    return (command) => evaluateTutorialCommandPermission(currentStep, command, objectBindings);
  }, [currentStep, objectBindings, progress.status]);

  useEffect(() => {
    onCommandPolicyChange?.(commandPolicy);
    return () => onCommandPolicyChange?.(null);
  }, [commandPolicy, onCommandPolicyChange]);

  const handleContinue = useCallback(() => {
    dispatch({
      type: 'CONTINUE_INFO',
      scenario,
      currentSeq: playerViewState?.match.seq ?? progress.enteredAtSeq,
    });
  }, [playerViewState?.match.seq, progress.enteredAtSeq, scenario]);

  const handleBack = useCallback(() => {
    const displayedStepIndex = reviewStepIndex ?? progress.currentStepIndex;
    if (displayedStepIndex <= progress.entryStepIndex) return;
    setReviewStepIndex(displayedStepIndex - 1);
  }, [progress.currentStepIndex, progress.entryStepIndex, reviewStepIndex]);

  const handleReviewContinue = useCallback(() => {
    if (reviewStepIndex === null) return;
    const nextReviewIndex = reviewStepIndex + 1;
    setReviewStepIndex(nextReviewIndex >= progress.currentStepIndex ? null : nextReviewIndex);
  }, [progress.currentStepIndex, reviewStepIndex]);

  const resolution = useMemo(() => {
    if (reviewStepIndex !== null) {
      return {
        presentation: resolveTutorialReviewPresentation(
          scenario,
          reviewStepIndex,
          progress.currentStepIndex
        ),
      };
    }
    const currentResolution = resolveTutorialStepPresentation(scenario, progress, objectBindings);
    return targetOverride && currentResolution.presentation
      ? {
          ...currentResolution,
          presentation: { ...currentResolution.presentation, target: targetOverride },
        }
      : currentResolution;
  }, [objectBindings, progress, reviewStepIndex, scenario, targetOverride]);

  if (!resolution.presentation) return null;

  return (
    <TutorialStepGuidance
      key={resolution.presentation.stepId}
      presentation={resolution.presentation}
      onBack={
        (reviewStepIndex ?? progress.currentStepIndex) > progress.entryStepIndex
          ? handleBack
          : undefined
      }
      onContinue={
        reviewStepIndex !== null
          ? handleReviewContinue
          : resolution.presentation.kind === 'INFO'
            ? handleContinue
            : undefined
      }
      onTargetUnavailable={onTargetUnavailable}
    />
  );
});

export default TutorialBattleGuidance;
