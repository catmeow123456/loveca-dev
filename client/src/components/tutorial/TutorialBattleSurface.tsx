import { memo, useCallback, useMemo, useState } from 'react';
import { useGameStore } from '@/store/gameStore';
import { GameBoard, type GameBoardProps } from '@/components/game/GameBoard';
import {
  resolveTutorialMulliganTargetOverride,
  resolveTutorialMulliganUiPolicy,
} from '@/lib/tutorialBattleUi';
import type {
  TutorialAcceptedCommand,
  TutorialObjectBindings,
  TutorialProgressState,
  TutorialScenarioDefinition,
} from '@/lib/tutorialScenario';
import { createTutorialProgress } from '@/lib/tutorialScenario';
import { TutorialBattleGuidance, type TutorialCommandPolicy } from './TutorialBattleGuidance';

export interface TutorialBattleSurfaceProps {
  readonly scenario: TutorialScenarioDefinition;
  readonly objectBindings: TutorialObjectBindings;
  readonly acceptedCommands?: readonly TutorialAcceptedCommand[];
  readonly resumeProgress?: TutorialProgressState;
  readonly entryStepId?: string;
  readonly gameBoardProps?: Omit<
    GameBoardProps,
    | 'resultAnimationAutoComplete'
    | 'mulliganPanelVisible'
    | 'mulliganSelectableCardIds'
    | 'onMulliganSelectionChange'
  >;
  readonly onProgressChange?: (progress: TutorialProgressState) => void;
  /** The future tutorial transport installs this policy before sending player commands. */
  readonly onCommandPolicyChange?: (policy: TutorialCommandPolicy | null) => void;
  readonly onCompleted?: (progress: TutorialProgressState) => void;
  readonly onTargetUnavailable?: (stepId: string) => void;
}

/**
 * Tutorial-only composition seam. It keeps the production GameBoard intact and
 * disables only its optional result auto-continue so the formal confirmation
 * remains a player action during the tutorial.
 */
export const TutorialBattleSurface = memo(function TutorialBattleSurface({
  scenario,
  objectBindings,
  acceptedCommands,
  resumeProgress,
  entryStepId,
  gameBoardProps,
  onProgressChange,
  onCommandPolicyChange,
  onCompleted,
  onTargetUnavailable,
}: TutorialBattleSurfaceProps) {
  const playerViewState = useGameStore((state) => state.playerViewState);
  const [progress, setProgress] = useState<TutorialProgressState>(
    () =>
      resumeProgress ??
      createTutorialProgress(scenario, playerViewState?.match.seq ?? 0, entryStepId)
  );
  const [mulliganSelection, setMulliganSelection] = useState<readonly string[]>([]);
  const currentStep = scenario.steps[progress.currentStepIndex] ?? null;
  const mulliganUiPolicy = useMemo(
    () => resolveTutorialMulliganUiPolicy(currentStep, objectBindings),
    [currentStep, objectBindings]
  );
  const mulliganTargetOverride = useMemo(
    () => resolveTutorialMulliganTargetOverride(currentStep, mulliganSelection),
    [currentStep, mulliganSelection]
  );
  const handleProgressChange = useCallback(
    (nextProgress: TutorialProgressState) => {
      setProgress(nextProgress);
      onProgressChange?.(nextProgress);
    },
    [onProgressChange]
  );

  return (
    <>
      <GameBoard
        {...gameBoardProps}
        resultAnimationAutoComplete={false}
        mulliganPanelVisible={mulliganUiPolicy.panelVisible}
        mulliganSelectableCardIds={mulliganUiPolicy.selectableCardIds}
        onMulliganSelectionChange={setMulliganSelection}
      />
      <TutorialBattleGuidance
        scenario={scenario}
        playerViewState={playerViewState}
        objectBindings={objectBindings}
        acceptedCommands={acceptedCommands}
        initialProgress={progress}
        targetOverride={mulliganTargetOverride}
        onProgressChange={handleProgressChange}
        onCommandPolicyChange={onCommandPolicyChange}
        onCompleted={onCompleted}
        onTargetUnavailable={onTargetUnavailable}
      />
    </>
  );
});

export default TutorialBattleSurface;
