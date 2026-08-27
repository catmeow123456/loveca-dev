import type { GameCommand } from '@game/application/game-commands';
import { GameCommandType } from '@game/application/game-commands';
import type { PlayerViewState, Seat, ViewZoneKey } from '@game/online';
import { SlotPosition, SubPhase, ZoneType } from '@game/shared/types/enums';
import { BATTLE_UI_ANCHORS, type BattleUiAnchorId } from './battleUiAnchors';
import type {
  TutorialCalloutPlacement,
  TutorialGuidancePresentation,
  TutorialGuidanceTarget,
  TutorialMascotExpression,
  TutorialStepKind,
  TutorialTransferGuidance,
} from './tutorialGuidance';

export type TutorialObjectRole = string;

export type TutorialRelativeSeat = 'VIEWER' | 'OPPONENT';

export type TutorialPublicTarget =
  | {
      readonly kind: 'ANCHOR';
      readonly anchor: BattleUiAnchorId;
      readonly padding?: number;
      readonly placement?: TutorialCalloutPlacement;
    }
  | {
      /** Public role names are bound to projected object ids by the tutorial session. */
      readonly kind: 'OBJECT_ROLE';
      readonly role: TutorialObjectRole;
      readonly padding?: number;
      readonly placement?: TutorialCalloutPlacement;
    };

export interface TutorialObjectBindings {
  readonly [role: TutorialObjectRole]: string | undefined;
}

export interface TutorialTransferInteraction {
  readonly kind: 'TRANSFER';
  readonly source: TutorialPublicTarget;
  readonly destination: TutorialPublicTarget;
}

export type TutorialViewCondition =
  | {
      readonly kind: 'MATCH';
      readonly phase?: string;
      readonly subPhase?: string;
      readonly excludedPhases?: readonly string[];
      readonly excludedSubPhases?: readonly string[];
      readonly activeSeat?: TutorialRelativeSeat | 'NONE';
    }
  | {
      readonly kind: 'COMMAND_AVAILABLE';
      readonly commandType: GameCommandType;
    }
  | {
      readonly kind: 'OBJECT_IN_ZONE';
      readonly role: TutorialObjectRole;
      readonly seat: TutorialRelativeSeat;
      readonly zone: ZoneType;
      readonly slot?: SlotPosition;
    }
  | {
      /** Counts projected cards without requiring a hidden opponent card identity binding. */
      readonly kind: 'ZONE_CARD_COUNT';
      readonly seat: TutorialRelativeSeat;
      readonly zone: ZoneType;
      readonly minimumCount: number;
    }
  | {
      readonly kind: 'LIVE_SCORE_CONFIRMED';
      readonly seat: TutorialRelativeSeat;
    }
  | {
      readonly kind: 'SUCCESS_LIVE_SELECTION';
      readonly role: TutorialObjectRole;
      readonly waitingSeat: TutorialRelativeSeat;
    }
  | {
      readonly kind: 'ALL';
      readonly conditions: readonly TutorialViewCondition[];
    };

export interface TutorialCommandRule {
  readonly commandType: GameCommandType;
  /** Exact object roles for a multi-card command such as mulligan. */
  readonly exactObjectRoles?: readonly TutorialObjectRole[];
  /** Single object role for commands carrying one cardId. */
  readonly objectRole?: TutorialObjectRole;
  readonly targetSlot?: SlotPosition;
  readonly subPhase?: SubPhase;
  readonly faceDown?: boolean;
  /** Empty judgmentResults means accepting the rule-computed automatic result. */
  readonly automaticJudgmentOnly?: boolean;
  /** Reject adjustedScore so the tutorial cannot teach manual score editing. */
  readonly computedScoreOnly?: boolean;
}

export type TutorialCompletion =
  | { readonly kind: 'INFO_CONTINUE' }
  | {
      readonly kind: 'ACCEPTED_COMMAND';
      readonly command: TutorialCommandRule;
      /** Additional commands emitted by the same shared interaction must also be accepted. */
      readonly additionalCommands?: readonly TutorialCommandRule[];
      readonly postCondition?: TutorialViewCondition;
    }
  | {
      readonly kind: 'VIEW_STATE';
      readonly condition: TutorialViewCondition;
    };

export interface TutorialStepDefinition {
  readonly id: string;
  readonly contentVersion: number;
  readonly kind: TutorialStepKind;
  readonly chapter: string;
  readonly title: string;
  readonly body: string;
  /** Optional decoration only; it never carries rules or completion meaning. */
  readonly mascot?: TutorialMascotExpression;
  readonly statusText?: string;
  /**
   * OBSERVE only: keep the completed explanation readable for this long after
   * the authoritative view condition first becomes true. This never replaces
   * the view condition as completion evidence.
   */
  readonly completionDwellMs?: number;
  /** Status shown during the readable hold after the view condition is true. */
  readonly completionDwellStatusText?: string;
  readonly continueLabel?: string;
  /** INFO only: hold server-script probing until the player has read and continued. */
  readonly pauseScript?: boolean;
  readonly target?: TutorialPublicTarget | null;
  /** Secondary targets stay visible while the callout follows the primary target. */
  readonly secondaryTargets?: readonly TutorialPublicTarget[];
  /** Explicit A -> B interaction. Both targets must remain visible and unobstructed. */
  readonly interaction?: TutorialTransferInteraction;
  /** Commands permitted before the request reaches the authoritative session. */
  readonly allowedCommands?: readonly TutorialCommandRule[];
  readonly completion: TutorialCompletion;
}

export interface TutorialScenarioDefinition {
  readonly id: string;
  readonly version: string;
  readonly contentVersion: number;
  readonly objectRoles: readonly TutorialObjectRole[];
  readonly steps: readonly TutorialStepDefinition[];
}

export interface TutorialAcceptedCommand {
  readonly actorSeat: Seat;
  /** Revision of the authoritative player view after the accepted command. */
  readonly resultingSeq: number;
  /** This is the tutorial player's accepted command, never an opponent-private command. */
  readonly command: GameCommand;
}

export type TutorialProgressStatus = 'ACTIVE' | 'COMPLETED' | 'ERROR';

export interface TutorialProgressState {
  readonly scenarioId: string;
  readonly scenarioVersion: string;
  readonly currentStepIndex: number;
  /** 章节入口边界；只读回看不会越过玩家选择的章节。 */
  readonly entryStepIndex: number;
  readonly enteredAtSeq: number;
  readonly completedStepIds: readonly string[];
  readonly status: TutorialProgressStatus;
  /** Client-only presentation marker; set only after a VIEW_STATE condition is true. */
  readonly viewConditionSatisfiedAtMs?: number;
  readonly error?: string;
}

export interface TutorialRuntimeSnapshot {
  readonly playerViewState: PlayerViewState | null;
  readonly objectBindings: TutorialObjectBindings;
  /** Recent viewer command receipts; command chains may advance more than one revision. */
  readonly acceptedCommands?: readonly TutorialAcceptedCommand[];
  /** Explicit clock input keeps post-condition presentation dwell deterministic in tests. */
  readonly nowMs?: number;
}

export interface TutorialCommandPermission {
  readonly allowed: boolean;
  readonly reason?: string;
}

const KNOWN_ANCHORS = new Set<string>(Object.values(BATTLE_UI_ANCHORS));
const KNOWN_COMMAND_TYPES = new Set<string>(Object.values(GameCommandType));

function normalizeObjectId(objectId: string): string {
  return objectId.replace(/^obj_/, '');
}

function sameObjectId(left: string, right: string): boolean {
  return normalizeObjectId(left) === normalizeObjectId(right);
}

function oppositeSeat(seat: Seat): Seat {
  return seat === 'FIRST' ? 'SECOND' : 'FIRST';
}

function resolveRelativeSeat(viewerSeat: Seat, relativeSeat: TutorialRelativeSeat): Seat {
  return relativeSeat === 'VIEWER' ? viewerSeat : oppositeSeat(viewerSeat);
}

function resolveZoneKey(seat: Seat, zone: ZoneType, slot?: SlotPosition): ViewZoneKey | null {
  if (zone === ZoneType.RESOLUTION_ZONE) return 'SHARED_RESOLUTION_ZONE';
  if (zone === ZoneType.MEMBER_SLOT) {
    if (!slot) return null;
    return `${seat}_MEMBER_${slot}` as ViewZoneKey;
  }
  return `${seat}_${zone}` as ViewZoneKey;
}

function getCommandObjectIds(command: GameCommand): readonly string[] {
  if (command.type === GameCommandType.MULLIGAN) return command.cardIdsToMulligan;
  if ('cardId' in command && typeof command.cardId === 'string') return [command.cardId];
  return [];
}

function getBoundObjectIds(
  roles: readonly TutorialObjectRole[],
  bindings: TutorialObjectBindings
): readonly string[] | null {
  const result: string[] = [];
  for (const role of roles) {
    const objectId = bindings[role];
    if (!objectId) return null;
    result.push(objectId);
  }
  return result;
}

function sameObjectSet(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  const normalizedRight = new Set(right.map(normalizeObjectId));
  return left.every((objectId) => normalizedRight.has(normalizeObjectId(objectId)));
}

export function matchesTutorialCommandRule(
  command: GameCommand,
  rule: TutorialCommandRule,
  bindings: TutorialObjectBindings
): boolean {
  if (command.type !== rule.commandType) return false;

  if (rule.exactObjectRoles) {
    const expectedObjectIds = getBoundObjectIds(rule.exactObjectRoles, bindings);
    if (!expectedObjectIds || !sameObjectSet(getCommandObjectIds(command), expectedObjectIds)) {
      return false;
    }
  }

  if (rule.objectRole) {
    const expectedObjectId = bindings[rule.objectRole];
    const [actualObjectId] = getCommandObjectIds(command);
    if (!expectedObjectId || !actualObjectId || !sameObjectId(actualObjectId, expectedObjectId)) {
      return false;
    }
  }

  if (rule.targetSlot) {
    if (!('targetSlot' in command) || command.targetSlot !== rule.targetSlot) return false;
  }

  if (rule.subPhase) {
    if (command.type !== GameCommandType.CONFIRM_STEP || command.subPhase !== rule.subPhase) {
      return false;
    }
  }

  if (rule.faceDown !== undefined) {
    if (command.type !== GameCommandType.SET_LIVE_CARD || command.faceDown !== rule.faceDown) {
      return false;
    }
  }

  if (rule.automaticJudgmentOnly) {
    if (command.type !== GameCommandType.SUBMIT_JUDGMENT || command.judgmentResults.size !== 0) {
      return false;
    }
  }

  if (rule.computedScoreOnly) {
    if (command.type !== GameCommandType.SUBMIT_SCORE || command.adjustedScore !== undefined) {
      return false;
    }
  }

  return true;
}

export function evaluateTutorialCommandPermission(
  step: TutorialStepDefinition,
  command: GameCommand,
  bindings: TutorialObjectBindings
): TutorialCommandPermission {
  const allowedCommands = step.allowedCommands ?? [];
  if (allowedCommands.some((rule) => matchesTutorialCommandRule(command, rule, bindings))) {
    return { allowed: true };
  }

  return {
    allowed: false,
    reason:
      step.kind === 'ACTION'
        ? `当前目标是“${step.title}”，请按提示完成该操作。`
        : '当前步骤只用于说明或观察，请先完成本步。',
  };
}

export function isTutorialViewConditionSatisfied(
  condition: TutorialViewCondition,
  view: PlayerViewState,
  bindings: TutorialObjectBindings
): boolean {
  const viewerSeat = view.match.viewerSeat;
  switch (condition.kind) {
    case 'MATCH': {
      if (condition.phase && view.match.phase !== condition.phase) return false;
      if (condition.subPhase && view.match.subPhase !== condition.subPhase) return false;
      if (condition.excludedPhases?.includes(view.match.phase)) return false;
      if (condition.excludedSubPhases?.includes(view.match.subPhase)) return false;
      if (condition.activeSeat) {
        if (condition.activeSeat === 'NONE') return view.match.activeSeat === null;
        if (view.match.activeSeat !== resolveRelativeSeat(viewerSeat, condition.activeSeat)) {
          return false;
        }
      }
      return true;
    }
    case 'COMMAND_AVAILABLE':
      return view.permissions.availableCommands.some(
        (hint) => hint.command === condition.commandType && hint.enabled
      );
    case 'OBJECT_IN_ZONE': {
      const objectId = bindings[condition.role];
      if (!objectId) return false;
      const seat = resolveRelativeSeat(viewerSeat, condition.seat);
      const zoneKey = resolveZoneKey(seat, condition.zone, condition.slot);
      if (!zoneKey) return false;
      const zone = view.table.zones[zoneKey];
      if (!zone) return false;
      if (zone.objectIds?.some((candidate) => sameObjectId(candidate, objectId))) {
        return true;
      }
      if (condition.zone === ZoneType.MEMBER_SLOT && condition.slot) {
        const occupantObjectId = zone.slotMap?.[condition.slot];
        return occupantObjectId ? sameObjectId(occupantObjectId, objectId) : false;
      }
      return false;
    }
    case 'ZONE_CARD_COUNT': {
      const seat = resolveRelativeSeat(viewerSeat, condition.seat);
      const zoneKey = resolveZoneKey(seat, condition.zone);
      if (!zoneKey) return false;
      return (view.table.zones[zoneKey]?.count ?? 0) >= condition.minimumCount;
    }
    case 'LIVE_SCORE_CONFIRMED': {
      const seat = resolveRelativeSeat(viewerSeat, condition.seat);
      return view.match.liveResult?.confirmedSeats.includes(seat) ?? false;
    }
    case 'SUCCESS_LIVE_SELECTION': {
      const objectId = bindings[condition.role];
      const selection = view.match.liveResult?.successLiveSelection;
      if (!objectId || !selection) return false;
      const waitingSeat = resolveRelativeSeat(viewerSeat, condition.waitingSeat);
      return (
        selection.waitingSeat === waitingSeat &&
        selection.candidateObjectIds.some((candidate) => sameObjectId(candidate, objectId))
      );
    }
    case 'ALL':
      return condition.conditions.every((item) =>
        isTutorialViewConditionSatisfied(item, view, bindings)
      );
  }
}

function validateRole(
  role: TutorialObjectRole,
  knownRoles: ReadonlySet<TutorialObjectRole>,
  context: string,
  errors: string[]
): void {
  if (!knownRoles.has(role)) errors.push(`${context} 引用了未声明对象角色 ${role}`);
}

function validateCommandRule(
  rule: TutorialCommandRule,
  knownRoles: ReadonlySet<TutorialObjectRole>,
  context: string,
  errors: string[]
): void {
  if (!KNOWN_COMMAND_TYPES.has(rule.commandType)) {
    errors.push(`${context} 使用了未知命令 ${String(rule.commandType)}`);
  }
  if (rule.objectRole) validateRole(rule.objectRole, knownRoles, context, errors);
  for (const role of rule.exactObjectRoles ?? []) validateRole(role, knownRoles, context, errors);
  if (rule.targetSlot && rule.commandType !== GameCommandType.PLAY_MEMBER_TO_SLOT) {
    errors.push(`${context} 的 targetSlot 只支持成员登场命令`);
  }
  if (rule.subPhase && rule.commandType !== GameCommandType.CONFIRM_STEP) {
    errors.push(`${context} 的 subPhase 只支持确认步骤命令`);
  }
  if (rule.faceDown !== undefined && rule.commandType !== GameCommandType.SET_LIVE_CARD) {
    errors.push(`${context} 的 faceDown 只支持设置 LIVE 命令`);
  }
  if (rule.automaticJudgmentOnly && rule.commandType !== GameCommandType.SUBMIT_JUDGMENT) {
    errors.push(`${context} 的 automaticJudgmentOnly 只支持判定命令`);
  }
  if (rule.computedScoreOnly && rule.commandType !== GameCommandType.SUBMIT_SCORE) {
    errors.push(`${context} 的 computedScoreOnly 只支持分数命令`);
  }
}

function validateViewCondition(
  condition: TutorialViewCondition,
  knownRoles: ReadonlySet<TutorialObjectRole>,
  context: string,
  errors: string[]
): void {
  switch (condition.kind) {
    case 'OBJECT_IN_ZONE':
    case 'SUCCESS_LIVE_SELECTION':
      validateRole(condition.role, knownRoles, context, errors);
      break;
    case 'ALL':
      condition.conditions.forEach((item, index) =>
        validateViewCondition(item, knownRoles, `${context}.conditions[${index}]`, errors)
      );
      break;
    case 'MATCH':
    case 'COMMAND_AVAILABLE':
    case 'LIVE_SCORE_CONFIRMED':
      break;
    case 'ZONE_CARD_COUNT':
      if (!Number.isSafeInteger(condition.minimumCount) || condition.minimumCount < 1) {
        errors.push(`${context} 的 minimumCount 必须是大于 0 的整数`);
      }
      break;
  }
}

function validatePublicTarget(
  target: TutorialPublicTarget,
  knownRoles: ReadonlySet<TutorialObjectRole>,
  context: string,
  errors: string[]
): void {
  if (target.kind === 'ANCHOR' && !KNOWN_ANCHORS.has(target.anchor)) {
    errors.push(`${context} 使用了未知锚点 ${String(target.anchor)}`);
  }
  if (target.kind === 'OBJECT_ROLE') {
    validateRole(target.role, knownRoles, context, errors);
  }
}

export function validateTutorialScenarioDefinition(
  scenario: TutorialScenarioDefinition
): readonly string[] {
  const errors: string[] = [];
  const knownRoles = new Set(scenario.objectRoles);
  if (!scenario.id.trim()) errors.push('scenario.id 不能为空');
  if (!scenario.version.trim()) errors.push('scenario.version 不能为空');
  if (scenario.steps.length === 0) errors.push('教程至少需要一个步骤');
  if (knownRoles.size !== scenario.objectRoles.length) errors.push('对象角色不能重复');

  const stepIds = new Set<string>();
  scenario.steps.forEach((step, index) => {
    const context = `steps[${index}](${step.id || 'unknown'})`;
    if (!step.id.trim()) errors.push(`${context} 缺少稳定步骤 id`);
    if (stepIds.has(step.id)) errors.push(`${context} 的步骤 id 重复`);
    stepIds.add(step.id);

    if (!['INFO', 'ACTION', 'OBSERVE'].includes(step.kind)) {
      errors.push(`${context} 使用了未知步骤类型 ${String(step.kind)}`);
    }
    if (step.target) validatePublicTarget(step.target, knownRoles, context, errors);
    if (step.interaction) {
      if (step.kind !== 'ACTION') {
        errors.push(`${context} 的 interaction 只支持动作步骤`);
      }
      if (step.target) {
        errors.push(`${context} 的 interaction 不应再重复声明 target`);
      }
      validatePublicTarget(
        step.interaction.source,
        knownRoles,
        `${context}.interaction.source`,
        errors
      );
      validatePublicTarget(
        step.interaction.destination,
        knownRoles,
        `${context}.interaction.destination`,
        errors
      );
    }
    for (const [targetIndex, target] of (step.secondaryTargets ?? []).entries()) {
      validatePublicTarget(
        target,
        knownRoles,
        `${context}.secondaryTargets[${targetIndex}]`,
        errors
      );
    }

    for (const rule of step.allowedCommands ?? []) {
      validateCommandRule(rule, knownRoles, `${context}.allowedCommands`, errors);
    }

    if (step.kind === 'INFO' && step.completion.kind !== 'INFO_CONTINUE') {
      errors.push(`${context} 信息步骤必须由 INFO_CONTINUE 完成`);
    }
    if (step.kind === 'ACTION' && step.completion.kind !== 'ACCEPTED_COMMAND') {
      errors.push(`${context} 动作步骤必须由已接受命令完成`);
    }
    if (step.kind === 'OBSERVE' && step.completion.kind !== 'VIEW_STATE') {
      errors.push(`${context} 观察步骤必须由玩家视图状态完成`);
    }
    if (step.completionDwellMs !== undefined) {
      if (
        step.kind !== 'OBSERVE' ||
        !Number.isFinite(step.completionDwellMs) ||
        step.completionDwellMs <= 0
      ) {
        errors.push(`${context} 的 completionDwellMs 只支持大于 0 的观察步骤`);
      }
    }
    if (step.completionDwellStatusText !== undefined && step.completionDwellMs === undefined) {
      errors.push(`${context} 的 completionDwellStatusText 需要 completionDwellMs`);
    }
    if (step.pauseScript && step.kind !== 'INFO') {
      errors.push(`${context} 的 pauseScript 只支持信息步骤`);
    }

    if (step.completion.kind === 'ACCEPTED_COMMAND') {
      const completion = step.completion;
      validateCommandRule(completion.command, knownRoles, `${context}.completion`, errors);
      for (const rule of completion.additionalCommands ?? []) {
        validateCommandRule(rule, knownRoles, `${context}.additionalCommands`, errors);
      }
      if (completion.postCondition) {
        validateViewCondition(
          completion.postCondition,
          knownRoles,
          `${context}.postCondition`,
          errors
        );
      }
      const hasMatchingAllowedCommand = (step.allowedCommands ?? []).some(
        (rule) => rule.commandType === completion.command.commandType
      );
      if (!hasMatchingAllowedCommand) {
        errors.push(`${context} 的完成命令没有对应 allowedCommands`);
      }
      for (const requiredCommand of completion.additionalCommands ?? []) {
        const hasMatchingAdditionalCommand = (step.allowedCommands ?? []).some(
          (rule) => rule.commandType === requiredCommand.commandType
        );
        if (!hasMatchingAdditionalCommand) {
          errors.push(`${context} 的附加完成命令没有对应 allowedCommands`);
        }
      }
    } else if (step.completion.kind === 'VIEW_STATE') {
      validateViewCondition(step.completion.condition, knownRoles, `${context}.completion`, errors);
    }
  });

  return errors;
}

export function createTutorialProgress(
  scenario: TutorialScenarioDefinition,
  enteredAtSeq: number,
  entryStepId = scenario.steps[0]?.id
): TutorialProgressState {
  const errors = [...validateTutorialScenarioDefinition(scenario)];
  const entryStepIndex = scenario.steps.findIndex((step) => step.id === entryStepId);
  if (entryStepIndex < 0) errors.push(`教程入口步骤不存在: ${String(entryStepId)}`);
  if (errors.length > 0) {
    return {
      scenarioId: scenario.id,
      scenarioVersion: scenario.version,
      currentStepIndex: 0,
      entryStepIndex: 0,
      enteredAtSeq,
      completedStepIds: [],
      status: 'ERROR',
      error: errors.join('；'),
    };
  }

  return {
    scenarioId: scenario.id,
    scenarioVersion: scenario.version,
    currentStepIndex: entryStepIndex,
    entryStepIndex,
    enteredAtSeq,
    completedStepIds: [],
    status: 'ACTIVE',
  };
}

function advanceTutorialStep(
  scenario: TutorialScenarioDefinition,
  progress: TutorialProgressState,
  enteredAtSeq: number
): TutorialProgressState {
  const currentStep = scenario.steps[progress.currentStepIndex];
  if (!currentStep) {
    return { ...progress, status: 'ERROR', error: '当前教程步骤不存在' };
  }
  const nextStepIndex = progress.currentStepIndex + 1;
  return {
    ...progress,
    currentStepIndex: nextStepIndex,
    enteredAtSeq,
    completedStepIds: [...progress.completedStepIds, currentStep.id],
    status: nextStepIndex >= scenario.steps.length ? 'COMPLETED' : 'ACTIVE',
    viewConditionSatisfiedAtMs: undefined,
  };
}

export function continueTutorialInformationStep(
  scenario: TutorialScenarioDefinition,
  progress: TutorialProgressState,
  currentSeq: number
): TutorialProgressState {
  if (progress.status !== 'ACTIVE') return progress;
  const step = scenario.steps[progress.currentStepIndex];
  if (!step || step.kind !== 'INFO' || step.completion.kind !== 'INFO_CONTINUE') return progress;
  return advanceTutorialStep(scenario, progress, currentSeq);
}

export function reduceTutorialProgress(
  scenario: TutorialScenarioDefinition,
  progress: TutorialProgressState,
  runtime: TutorialRuntimeSnapshot
): TutorialProgressState {
  if (progress.status !== 'ACTIVE') return progress;
  if (progress.scenarioId !== scenario.id || progress.scenarioVersion !== scenario.version) {
    return {
      ...progress,
      status: 'ERROR',
      error: '教程定义版本与当前进度不匹配',
    };
  }

  const step = scenario.steps[progress.currentStepIndex];
  if (!step) return { ...progress, status: 'ERROR', error: '当前教程步骤不存在' };
  const view = runtime.playerViewState;
  if (!view || step.kind === 'INFO') return progress;

  if (step.completion.kind === 'VIEW_STATE') {
    const satisfied = isTutorialViewConditionSatisfied(
      step.completion.condition,
      view,
      runtime.objectBindings
    );
    if (!satisfied) {
      if (progress.viewConditionSatisfiedAtMs !== undefined) {
        return { ...progress, viewConditionSatisfiedAtMs: undefined };
      }
      return progress;
    }

    const completionDwellMs = step.completionDwellMs ?? 0;
    if (completionDwellMs > 0) {
      if (runtime.nowMs === undefined) return progress;
      if (progress.viewConditionSatisfiedAtMs === undefined) {
        return { ...progress, viewConditionSatisfiedAtMs: runtime.nowMs };
      }
      if (runtime.nowMs - progress.viewConditionSatisfiedAtMs < completionDwellMs) {
        return progress;
      }
    }
    return advanceTutorialStep(scenario, progress, view.match.seq);
  }

  if (step.completion.kind !== 'ACCEPTED_COMMAND') return progress;
  const completion = step.completion;
  const findReceipt = (rule: TutorialCommandRule) =>
    runtime.acceptedCommands?.find(
      (candidate) =>
        candidate.actorSeat === view.match.viewerSeat &&
        candidate.resultingSeq > progress.enteredAtSeq &&
        view.match.seq >= candidate.resultingSeq &&
        matchesTutorialCommandRule(candidate.command, rule, runtime.objectBindings)
    );
  const receipt = findReceipt(completion.command);
  if (!receipt) {
    return progress;
  }
  if (completion.additionalCommands?.some((rule) => !findReceipt(rule))) return progress;
  if (
    completion.postCondition &&
    !isTutorialViewConditionSatisfied(completion.postCondition, view, runtime.objectBindings)
  ) {
    return progress;
  }

  return advanceTutorialStep(scenario, progress, view.match.seq);
}

export interface TutorialPresentationResolution {
  readonly presentation: TutorialGuidancePresentation | null;
  readonly missingObjectRole?: TutorialObjectRole;
}

function resolvePublicTutorialTarget(
  target: TutorialPublicTarget,
  bindings: TutorialObjectBindings
): { readonly target: TutorialGuidanceTarget | null; readonly missingObjectRole?: string } {
  if (target.kind === 'ANCHOR') {
    return {
      target: {
        kind: 'ANCHOR',
        anchor: target.anchor,
        padding: target.padding,
        placement: target.placement,
      },
    };
  }

  const objectId = bindings[target.role];
  if (!objectId) return { target: null, missingObjectRole: target.role };
  return {
    target: {
      kind: 'OBJECT',
      objectId,
      padding: target.padding,
      placement: target.placement,
    },
  };
}

export function resolveTutorialReviewPresentation(
  scenario: TutorialScenarioDefinition,
  stepIndex: number,
  currentStepIndex: number
): TutorialGuidancePresentation | null {
  const step = scenario.steps[stepIndex];
  if (!step || stepIndex >= currentStepIndex) return null;
  return {
    stepId: `review:${step.id}`,
    kind: 'INFO',
    chapter: step.chapter,
    title: step.title,
    body: step.body,
    mascot: step.mascot,
    currentStep: stepIndex + 1,
    totalSteps: scenario.steps.length,
    target: null,
    continueLabel: '下一步',
  };
}

export function resolveTutorialStepPresentation(
  scenario: TutorialScenarioDefinition,
  progress: TutorialProgressState,
  bindings: TutorialObjectBindings
): TutorialPresentationResolution {
  if (progress.status !== 'ACTIVE') return { presentation: null };
  const step = scenario.steps[progress.currentStepIndex];
  if (!step) return { presentation: null };

  const resolvedPrimaryTarget = step.target
    ? resolvePublicTutorialTarget(step.target, bindings)
    : { target: null };
  const resolvedInteractionSource = step.interaction
    ? resolvePublicTutorialTarget(step.interaction.source, bindings)
    : null;
  const resolvedInteractionDestination = step.interaction
    ? resolvePublicTutorialTarget(step.interaction.destination, bindings)
    : null;
  const resolvedSecondaryTargets = (step.secondaryTargets ?? []).map((target) =>
    resolvePublicTutorialTarget(target, bindings)
  );
  const missingObjectRole =
    resolvedPrimaryTarget.missingObjectRole ??
    resolvedInteractionSource?.missingObjectRole ??
    resolvedInteractionDestination?.missingObjectRole ??
    resolvedSecondaryTargets.find((target) => target.missingObjectRole)?.missingObjectRole;
  if (missingObjectRole) {
    return {
      missingObjectRole,
      presentation: {
        stepId: step.id,
        kind: 'OBSERVE',
        chapter: step.chapter,
        title: '教学目标暂不可用',
        body: '当前玩家视图没有提供本步骤所需的可见对象。教程不会猜测牌面或跳过这一步，请重试同步或重新开始。',
        currentStep: progress.currentStepIndex + 1,
        totalSteps: scenario.steps.length,
        target: null,
        statusText: '教学场景数据未收敛',
      },
    };
  }

  const resolvedInteraction: TutorialTransferGuidance | undefined =
    resolvedInteractionSource?.target && resolvedInteractionDestination?.target
      ? {
          kind: 'TRANSFER',
          source: resolvedInteractionSource.target,
          destination: resolvedInteractionDestination.target,
        }
      : undefined;

  return {
    presentation: {
      stepId: step.id,
      kind: step.kind,
      chapter: step.chapter,
      title: step.title,
      body: step.body,
      mascot: step.mascot,
      currentStep: progress.currentStepIndex + 1,
      totalSteps: scenario.steps.length,
      target: resolvedInteraction?.destination ?? resolvedPrimaryTarget.target,
      secondaryTargets: [
        ...(resolvedInteraction ? [resolvedInteraction.source] : []),
        ...resolvedSecondaryTargets.flatMap((target) => (target.target ? [target.target] : [])),
      ],
      interaction: resolvedInteraction,
      statusText:
        progress.viewConditionSatisfiedAtMs !== undefined
          ? (step.completionDwellStatusText ?? step.statusText)
          : step.statusText,
      continueLabel: step.continueLabel,
    },
  };
}
