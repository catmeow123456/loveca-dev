import { GameCommandType } from '@game/application/game-commands';
import { GamePhase, SubPhase } from '@game/shared/types/enums';
import { BATTLE_UI_ANCHORS } from './battleUiAnchors';
import type { RemoteSessionSource } from './remoteMatchClient';
import type { TutorialGuidanceTarget } from './tutorialGuidance';
import type { TutorialObjectBindings, TutorialStepDefinition } from './tutorialScenario';

export interface TutorialMulliganUiPolicy {
  readonly panelVisible: boolean;
  readonly selectableCardIds: readonly string[] | null;
}

const DEFAULT_SCRIPT_ADVANCE_DELAY_MS = 900;
const REDUCED_MOTION_SCRIPT_ADVANCE_DELAY_MS = 300;
const OPENING_SETTLE_DELAY_MS = 1_500;
const REDUCED_MOTION_OPENING_SETTLE_DELAY_MS = 650;

function normalizeObjectId(objectId: string): string {
  return objectId.replace(/^obj_/, '');
}

/** Prevents the tutorial bridge from replacing an existing shared-board session. */
export function isTutorialEntryBlockedByExistingBattle(
  remoteSessionSource: RemoteSessionSource | null,
  hasMatchView: boolean
): boolean {
  return remoteSessionSource !== 'TUTORIAL' && (remoteSessionSource !== null || hasMatchView);
}

/**
 * Keeps the opening hand visible on the shared board during the introductory
 * area tour, then mounts the modal only while the tutorial is actually
 * explaining or performing mulligan.
 */
export function resolveTutorialMulliganUiPolicy(
  step: TutorialStepDefinition | null,
  objectBindings: TutorialObjectBindings
): TutorialMulliganUiPolicy {
  if (!step) {
    return { panelVisible: false, selectableCardIds: null };
  }

  const explainsMulliganPanel =
    step.target?.kind === 'ANCHOR' && step.target.anchor === BATTLE_UI_ANCHORS.MULLIGAN_PANEL;
  const mulliganRule = step.allowedCommands?.find(
    (rule) => rule.commandType === GameCommandType.MULLIGAN
  );
  const exactRoles = mulliganRule?.exactObjectRoles;
  const boundCardIds = exactRoles
    ?.map((role) => objectBindings[role])
    .filter((objectId): objectId is string => objectId !== undefined)
    .map(normalizeObjectId);

  return {
    panelVisible: explainsMulliganPanel || mulliganRule !== undefined,
    selectableCardIds:
      exactRoles !== undefined && boundCardIds?.length === exactRoles.length ? boundCardIds : null,
  };
}

export function resolveTutorialMulliganTargetOverride(
  step: TutorialStepDefinition | null,
  selectedCardIds: readonly string[]
): TutorialGuidanceTarget | undefined {
  const isMulliganAction = step?.allowedCommands?.some(
    (rule) => rule.commandType === GameCommandType.MULLIGAN
  );
  if (!isMulliganAction || selectedCardIds.length === 0) return undefined;
  return {
    kind: 'ANCHOR',
    anchor: BATTLE_UI_ANCHORS.MULLIGAN_CONFIRM,
    placement: 'TOP',
  };
}

/** Gives rule animations time to settle without making progress depend on a timer. */
export function getTutorialScriptAdvanceDelayMs(
  match: { readonly phase: string; readonly subPhase: string },
  reduceMotion: boolean
): number {
  const isWaitingForOpponentMulligan =
    match.phase === GamePhase.MULLIGAN_PHASE && match.subPhase === SubPhase.MULLIGAN_SECOND_PLAYER;

  if (isWaitingForOpponentMulligan) {
    return reduceMotion ? REDUCED_MOTION_OPENING_SETTLE_DELAY_MS : OPENING_SETTLE_DELAY_MS;
  }

  return reduceMotion ? REDUCED_MOTION_SCRIPT_ADVANCE_DELAY_MS : DEFAULT_SCRIPT_ADVANCE_DELAY_MS;
}

/** Keeps a completed observation on screen before probing the next scripted command. */
export function shouldPauseTutorialScript(
  step: TutorialStepDefinition | null | undefined,
  viewConditionSatisfiedAtMs: number | undefined
): boolean {
  return (
    step?.pauseScript === true ||
    (step?.kind === 'OBSERVE' &&
      step.completionDwellMs !== undefined &&
      viewConditionSatisfiedAtMs !== undefined)
  );
}
