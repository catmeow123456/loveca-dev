import { memo, useCallback, useMemo, useState } from 'react';
import { useGameStore } from '@/store/gameStore';
import { GameBoard, type GameBoardProps } from '@/components/game/GameBoard';
import {
  resolveTutorialActivatedAbilityTargetOverride,
  resolveTutorialMobileBattlefieldFocus,
  resolveTutorialMulliganTargetOverride,
  resolveTutorialMulliganUiPolicy,
  shouldCloseTutorialMobileJudgmentPanel,
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
    | 'mobileBattlefieldFocusRequest'
    | 'mobileJudgmentPanelCloseRequestKey'
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
  const selectedCardId = useGameStore((state) => state.ui.selectedCardId);
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
  const activatedAbilityTargetOverride = useMemo(
    () =>
      resolveTutorialActivatedAbilityTargetOverride(currentStep, selectedCardId, objectBindings),
    [currentStep, objectBindings, selectedCardId]
  );
  const mobileBattlefieldFocusRequest = useMemo(
    () =>
      currentStep
        ? {
            key: currentStep.id,
            target: resolveTutorialMobileBattlefieldFocus(
              currentStep,
              playerViewState?.match.activeSeat !== playerViewState?.match.viewerSeat
            ),
          }
        : undefined,
    [currentStep, playerViewState?.match.activeSeat, playerViewState?.match.viewerSeat]
  );
  const mobileJudgmentPanelCloseRequestKey = shouldCloseTutorialMobileJudgmentPanel(currentStep)
    ? currentStep?.id
    : undefined;
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
        mobileBattlefieldFocusRequest={mobileBattlefieldFocusRequest}
        mobileJudgmentPanelCloseRequestKey={mobileJudgmentPanelCloseRequestKey}
      />
      <TutorialBattleGuidance
        scenario={scenario}
        playerViewState={playerViewState}
        objectBindings={objectBindings}
        acceptedCommands={acceptedCommands}
        initialProgress={progress}
        targetOverride={activatedAbilityTargetOverride ?? mulliganTargetOverride}
        onProgressChange={handleProgressChange}
        onCommandPolicyChange={onCommandPolicyChange}
        onCompleted={onCompleted}
        onTargetUnavailable={onTargetUnavailable}
      />
    </>
  );
});

export default TutorialBattleSurface;
