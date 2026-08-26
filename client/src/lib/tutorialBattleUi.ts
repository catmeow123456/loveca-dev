import { GameCommandType } from '@game/application/game-commands';
import { GamePhase, SubPhase } from '@game/shared/types/enums';
import { BATTLE_UI_ANCHORS, type BattleUiAnchorId } from './battleUiAnchors';
import type { RemoteSessionSource } from './remoteMatchClient';
import type { TutorialGuidanceTarget } from './tutorialGuidance';
import type { TutorialObjectBindings, TutorialStepDefinition } from './tutorialScenario';

export interface TutorialMulliganUiPolicy {
  readonly panelVisible: boolean;
  readonly selectableCardIds: readonly string[] | null;
}

export type TutorialMobileBattlefieldFocus = 'SELF' | 'OPPONENT';

const OPPONENT_BATTLEFIELD_ANCHORS = new Set<BattleUiAnchorId>([
  BATTLE_UI_ANCHORS.OPPONENT_AREA,
  BATTLE_UI_ANCHORS.OPPONENT_HAND,
  BATTLE_UI_ANCHORS.OPPONENT_MAIN_DECK,
  BATTLE_UI_ANCHORS.OPPONENT_ENERGY_DECK,
  BATTLE_UI_ANCHORS.OPPONENT_ENERGY_ZONE,
  BATTLE_UI_ANCHORS.OPPONENT_WAITING_ROOM,
  BATTLE_UI_ANCHORS.OPPONENT_STAGE_LEFT,
  BATTLE_UI_ANCHORS.OPPONENT_STAGE_CENTER,
  BATTLE_UI_ANCHORS.OPPONENT_STAGE_RIGHT,
  BATTLE_UI_ANCHORS.OPPONENT_LIVE_ZONE,
  BATTLE_UI_ANCHORS.OPPONENT_SUCCESS_LIVE_ZONE,
]);

const SCORE_CONFIRM_ANCHORS = new Set<BattleUiAnchorId>([
  BATTLE_UI_ANCHORS.SCORE_CONFIRM,
  BATTLE_UI_ANCHORS.SCORE_CONFIRM_ACTION,
]);

export function resolveTutorialMobileBattlefieldFocus(
  step: TutorialStepDefinition | null,
  opponentIsActing = false
): TutorialMobileBattlefieldFocus {
  if (opponentIsActing) return 'OPPONENT';
  const targets = step ? [step.target, ...(step.secondaryTargets ?? [])] : [];
  return targets.some(
    (target) => target?.kind === 'ANCHOR' && OPPONENT_BATTLEFIELD_ANCHORS.has(target.anchor)
  )
    ? 'OPPONENT'
    : 'SELF';
}

export function shouldCloseTutorialMobileJudgmentPanel(
  step: TutorialStepDefinition | null
): boolean {
  const targets = step ? [step.target, ...(step.secondaryTargets ?? [])] : [];
  return targets.some(
    (target) => target?.kind === 'ANCHOR' && SCORE_CONFIRM_ANCHORS.has(target.anchor)
  );
}

export function normalizeTutorialMulliganSelection(
  selectedCardIds: readonly string[],
  selectableCardIds: readonly string[] | null
): readonly string[] {
  const uniqueSelection = [...new Set(selectedCardIds)];
  if (selectableCardIds === null) return uniqueSelection;
  const selectableCardIdSet = new Set(selectableCardIds);
  return uniqueSelection.filter((cardId) => selectableCardIdSet.has(cardId));
}

export function canConfirmTutorialMulliganSelection(
  selectedCardIds: readonly string[],
  selectableCardIds: readonly string[] | null
): boolean {
  const uniqueSelectedCardIds = [...new Set(selectedCardIds)];
  if (selectableCardIds === null) return uniqueSelectedCardIds.length > 0;

  const exactSelectableCardIds = [...new Set(selectableCardIds)];
  if (exactSelectableCardIds.length === 0) return false;
  if (uniqueSelectedCardIds.length !== exactSelectableCardIds.length) return false;
  const selectedCardIdSet = new Set(uniqueSelectedCardIds);
  return exactSelectableCardIds.every((cardId) => selectedCardIdSet.has(cardId));
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
    selectableCardIds: explainsMulliganPanel
      ? []
      : exactRoles !== undefined
        ? boundCardIds?.length === exactRoles.length
          ? boundCardIds
          : []
        : null,
  };
}

export function resolveTutorialMulliganTargetOverride(
  step: TutorialStepDefinition | null,
  selectedCardIds: readonly string[]
): TutorialGuidanceTarget | undefined {
  const mulliganRule = step?.allowedCommands?.find(
    (rule) => rule.commandType === GameCommandType.MULLIGAN
  );
  const uniqueSelectedCardIds = [...new Set(selectedCardIds)];
  const exactSelectionCount = mulliganRule?.exactObjectRoles?.length;
  if (
    !mulliganRule ||
    uniqueSelectedCardIds.length === 0 ||
    (exactSelectionCount !== undefined && uniqueSelectedCardIds.length !== exactSelectionCount)
  ) {
    return undefined;
  }
  return {
    kind: 'ANCHOR',
    anchor: BATTLE_UI_ANCHORS.MULLIGAN_CONFIRM,
    placement: 'TOP',
  };
}

export function resolveTutorialActivatedAbilityTargetOverride(
  step: TutorialStepDefinition | null,
  selectedCardId: string | null,
  objectBindings: TutorialObjectBindings
): TutorialGuidanceTarget | undefined {
  if (!selectedCardId) return undefined;

  const activatedAbilityRule = step?.allowedCommands?.find(
    (rule) => rule.commandType === GameCommandType.ACTIVATE_ABILITY
  );
  const sourceRole = activatedAbilityRule?.objectRole;
  const sourceObjectId = sourceRole ? objectBindings[sourceRole] : undefined;
  if (!sourceObjectId || normalizeObjectId(sourceObjectId) !== normalizeObjectId(selectedCardId)) {
    return undefined;
  }

  return {
    kind: 'ANCHOR',
    anchor: BATTLE_UI_ANCHORS.ACTIVATED_ABILITY_MENU,
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
