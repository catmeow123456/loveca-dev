import {
  GameCommandType,
  type ActivateAbilityCommand,
  type ConfirmEffectStepCommand,
  type GameCommand,
  type MulliganCommand,
  type SelectSuccessLiveCommand,
  type SetLiveCardCommand,
} from '../../application/game-commands.js';
import { findCardAbilityDefinitionById } from '../../application/card-effects/definitions/lookup.js';
import type {
  ActiveEffectState,
  GameState,
  PendingAbilityState,
} from '../../domain/entities/game.js';
import { getCardById } from '../../domain/entities/game.js';
import { getBaseCardCode, normalizeCardCode } from '../../shared/utils/card-code.js';
import { ZoneType } from '../../shared/types/enums.js';
import type {
  MatchDecisionCardSummary,
  MatchDecisionSubmissionSummary,
  MatchDecisionVisibleContextSummary,
} from '../../online/replay-types.js';
import type { Seat } from '../../online/types.js';
import type { MatchDecisionRecordInput } from './match-recorder-service.js';

const ABILITY_ORDER_SELECTION_ID = 'system:select-pending-card-effect';

export interface BuildMatchDecisionRecordsInput {
  readonly matchId: string;
  readonly beforeState: GameState | null;
  readonly afterState: GameState | null;
  readonly command: GameCommand;
  readonly commandSucceeded: boolean;
  readonly submittedCommandSeq?: number | null;
  readonly getSeatForPlayer: (playerId: string | null | undefined) => Seat | null;
}

export function buildMatchDecisionRecordsForCommand(
  input: BuildMatchDecisionRecordsInput
): readonly MatchDecisionRecordInput[] {
  if (!input.commandSucceeded || !input.afterState) {
    return [];
  }

  const records: MatchDecisionRecordInput[] = [];
  const beforeEffect = input.beforeState?.activeEffect ?? null;
  const afterEffect = input.afterState.activeEffect;
  const commandDecision = buildPlayerCommandDecisionRecord(input);
  if (commandDecision) {
    records.push(commandDecision);
  }

  if (isConfirmEffectStepCommand(input.command) && beforeEffect?.id === input.command.effectId) {
    records.push(
      buildActiveEffectSubmittedRecord({
        matchId: input.matchId,
        state: input.beforeState,
        effect: beforeEffect,
        command: input.command,
        submittedCommandSeq: input.submittedCommandSeq ?? null,
        occurrenceKey: buildCommandOccurrenceKey(input.command, input.submittedCommandSeq),
        resultSummary: summarizeActiveEffectTransition(beforeEffect, afterEffect),
        getSeatForPlayer: input.getSeatForPlayer,
      })
    );
  }

  records.push(
    ...buildMatchDecisionRecordsForStateTransition({
      matchId: input.matchId,
      beforeState: input.beforeState,
      afterState: input.afterState,
      transitionOccurrenceKey: buildCommandOccurrenceKey(input.command, input.submittedCommandSeq),
      getSeatForPlayer: input.getSeatForPlayer,
    })
  );

  return records;
}

export function buildMatchDecisionRecordsForStateTransition(input: {
  readonly matchId: string;
  readonly beforeState: GameState | null;
  readonly afterState: GameState | null;
  readonly transitionOccurrenceKey?: string | null;
  readonly getSeatForPlayer: (playerId: string | null | undefined) => Seat | null;
}): readonly MatchDecisionRecordInput[] {
  const beforeEffect = input.beforeState?.activeEffect ?? null;
  const afterEffect = input.afterState?.activeEffect ?? null;
  if (
    !input.afterState ||
    !afterEffect ||
    isSameActiveEffectDecisionStep(beforeEffect, afterEffect)
  ) {
    return [];
  }

  return [
    buildActiveEffectOpenedRecord({
      matchId: input.matchId,
      state: input.afterState,
      effect: afterEffect,
      occurrenceKey: input.transitionOccurrenceKey ?? buildStateTransitionOccurrenceKey(input.afterState),
      getSeatForPlayer: input.getSeatForPlayer,
    }),
  ];
}

function buildActiveEffectOpenedRecord(input: {
  readonly matchId: string;
  readonly state: GameState;
  readonly effect: ActiveEffectState;
  readonly occurrenceKey: string;
  readonly getSeatForPlayer: (playerId: string | null | undefined) => Seat | null;
}): MatchDecisionRecordInput {
  const base = summarizeActiveEffect(input.state, input.effect, input.getSeatForPlayer);
  return {
    ...base,
    decisionId: buildDecisionId(input.matchId, 'opened', input.effect, input.occurrenceKey),
    decisionType: 'ACTIVE_EFFECT_OPENED',
    status: 'OPENED',
    transitionSemantics: 'STRUCTURED',
  };
}

function buildActiveEffectSubmittedRecord(input: {
  readonly matchId: string;
  readonly state: GameState | null | undefined;
  readonly effect: ActiveEffectState;
  readonly command: ConfirmEffectStepCommand;
  readonly submittedCommandSeq: number | null;
  readonly occurrenceKey: string;
  readonly resultSummary: string;
  readonly getSeatForPlayer: (playerId: string | null | undefined) => Seat | null;
}): MatchDecisionRecordInput {
  if (input.state && isPendingAbilityOrderSelectionEffect(input.effect)) {
    return buildPendingAbilityOrderSubmittedRecord({
      ...input,
      state: input.state,
    });
  }

  const base = input.state
    ? summarizeActiveEffect(input.state, input.effect, input.getSeatForPlayer)
    : summarizeActiveEffectWithoutState(input.effect, input.getSeatForPlayer);

  return {
    ...base,
    decisionId: buildDecisionId(input.matchId, 'submitted', input.effect, input.occurrenceKey),
    decisionType: 'ACTIVE_EFFECT_SUBMITTED',
    status: 'SUBMITTED',
    submittedCommandSeq: input.submittedCommandSeq,
    submission: summarizeConfirmEffectStepSubmission(input.command),
    resultSummary: input.resultSummary,
    transitionSemantics: 'STRUCTURED',
  };
}

function buildPendingAbilityOrderSubmittedRecord(input: {
  readonly matchId: string;
  readonly state: GameState;
  readonly effect: ActiveEffectState;
  readonly command: ConfirmEffectStepCommand;
  readonly submittedCommandSeq: number | null;
  readonly occurrenceKey: string;
  readonly resultSummary: string;
  readonly getSeatForPlayer: (playerId: string | null | undefined) => Seat | null;
}): MatchDecisionRecordInput {
  const pendingAbilityCandidates = getPendingAbilityOrderCandidates(input.state, input.effect);
  const selectedAbility = selectPendingAbilityCandidate(pendingAbilityCandidates, input.command);
  const selectedSourceCardId = selectedAbility?.sourceCardId ?? input.effect.sourceCardId;
  const selectedAbilityId = selectedAbility?.abilityId ?? input.effect.abilityId;
  const sourceSummary = summarizeSourceCard(input.state, selectedSourceCardId, selectedAbilityId);
  const abilityDefinition = findCardAbilityDefinitionById(selectedAbilityId);
  const candidates = summarizePendingAbilitySourceCards(input.state, pendingAbilityCandidates);

  return {
    ...sourceSummary,
    decisionId: buildDecisionId(input.matchId, 'submitted', input.effect, input.occurrenceKey),
    decisionSchemaVersion: 1,
    decisionType: 'PENDING_ABILITY_ORDER_SUBMITTED',
    status: 'SUBMITTED',
    playerId: input.effect.awaitingPlayerId,
    eventIds: collectPendingAbilityEventIds(pendingAbilityCandidates),
    sourceType: 'PENDING_ABILITY_ORDER',
    abilityId: selectedAbilityId,
    triggerCondition: abilityDefinition?.triggerCondition ?? null,
    abilityCategory: abilityDefinition?.category ?? null,
    abilitySourceZone: abilityDefinition?.sourceZone ?? null,
    effectTextSnapshot: abilityDefinition?.effectText ?? input.effect.effectText,
    stepId: input.effect.stepId,
    stepText: input.effect.stepText,
    waitingSeat: input.getSeatForPlayer(input.effect.awaitingPlayerId),
    visibleCandidates: candidates,
    auditCandidates: candidates,
    visibleContextSummary: summarizeVisibleContext(input.effect, pendingAbilityCandidates.length),
    minSelect: null,
    maxSelect: null,
    canSkip: input.effect.canSkipSelection ?? null,
    submittedCommandSeq: input.submittedCommandSeq,
    submission: {
      ...summarizeConfirmEffectStepSubmission(input.command),
      selectedPendingAbilityId: selectedAbility?.id ?? null,
    },
    resultSummary: summarizePendingAbilityOrderResult(input.command, selectedAbility),
    replayCapability: 'DECISION_RECORDS_PARTIAL',
    transitionSemantics: 'STRUCTURED',
  };
}

function buildPlayerCommandDecisionRecord(
  input: BuildMatchDecisionRecordsInput
): MatchDecisionRecordInput | null {
  switch (input.command.type) {
    case GameCommandType.ACTIVATE_ABILITY:
      return buildActivateAbilityDecisionRecord(input.command, input);
    case GameCommandType.MULLIGAN:
      return buildMulliganDecisionRecord(input.command, input);
    case GameCommandType.SET_LIVE_CARD:
      return buildSetLiveCardDecisionRecord(input.command, input);
    case GameCommandType.SELECT_SUCCESS_LIVE:
      return buildSelectSuccessLiveDecisionRecord(input.command, input);
    default:
      return null;
  }
}

function buildActivateAbilityDecisionRecord(
  command: ActivateAbilityCommand,
  input: BuildMatchDecisionRecordsInput
): MatchDecisionRecordInput {
  const state = input.beforeState ?? input.afterState;
  const sourceSummary = state
    ? summarizeSourceCard(state, command.cardId, command.abilityId)
    : emptySourceSummary(command.cardId, command.abilityId);
  const abilityDefinition = findCardAbilityDefinitionById(command.abilityId);

  return {
    ...sourceSummary,
    decisionId: buildCommandDecisionId(input.matchId, command, input.submittedCommandSeq),
    decisionSchemaVersion: 1,
    decisionType: 'ACTIVATE_ABILITY_SUBMITTED',
    status: 'SUBMITTED',
    playerId: command.playerId,
    eventIds: [],
    sourceType: 'CARD_ABILITY',
    abilityId: command.abilityId,
    triggerCondition: abilityDefinition?.triggerCondition ?? null,
    abilityCategory: abilityDefinition?.category ?? null,
    abilitySourceZone: abilityDefinition?.sourceZone ?? null,
    effectTextSnapshot: abilityDefinition?.effectText ?? null,
    stepId: 'activate-ability',
    stepText: '起动能力声明',
    waitingSeat: input.getSeatForPlayer(command.playerId),
    visibleCandidates: sourceSummary.visibleCandidates,
    auditCandidates: sourceSummary.visibleCandidates,
    visibleContextSummary: {
      selectableCardCount: 1,
      hasPrivateCandidates: false,
    },
    submittedCommandSeq: input.submittedCommandSeq ?? null,
    submission: {
      commandType: command.type,
      selectedCardId: command.cardId,
    },
    resultSummary: '起动能力已声明',
    replayCapability: 'DECISION_RECORDS_PARTIAL',
    transitionSemantics: 'STRUCTURED',
  };
}

function buildMulliganDecisionRecord(
  command: MulliganCommand,
  input: BuildMatchDecisionRecordsInput
): MatchDecisionRecordInput {
  const candidates = input.beforeState
    ? summarizeCandidateCards(input.beforeState, command.cardIdsToMulligan)
    : [];
  return {
    decisionId: buildCommandDecisionId(input.matchId, command, input.submittedCommandSeq),
    decisionSchemaVersion: 1,
    decisionType: 'MULLIGAN_SUBMITTED',
    status: 'SUBMITTED',
    playerId: command.playerId,
    eventIds: [],
    sourceType: 'PLAYER_COMMAND',
    waitingSeat: input.getSeatForPlayer(command.playerId),
    visibleCandidates: candidates,
    auditCandidates: candidates,
    visibleContextSummary: {
      selectableCardCount: command.cardIdsToMulligan.length,
      hasPrivateCandidates: true,
    },
    submittedCommandSeq: input.submittedCommandSeq ?? null,
    submission: {
      commandType: command.type,
      selectedCardIds: [...command.cardIdsToMulligan],
    },
    resultSummary: `换牌 ${command.cardIdsToMulligan.length} 张`,
    replayCapability: 'DECISION_RECORDS_PARTIAL',
    transitionSemantics: 'STRUCTURED',
  };
}

function buildSetLiveCardDecisionRecord(
  command: SetLiveCardCommand,
  input: BuildMatchDecisionRecordsInput
): MatchDecisionRecordInput {
  const state = input.beforeState ?? input.afterState;
  const sourceSummary = state
    ? summarizeSourceCard(state, command.cardId)
    : emptySourceSummary(command.cardId);
  return {
    ...sourceSummary,
    decisionId: buildCommandDecisionId(input.matchId, command, input.submittedCommandSeq),
    decisionSchemaVersion: 1,
    decisionType: 'SET_LIVE_CARD_SUBMITTED',
    status: 'SUBMITTED',
    playerId: command.playerId,
    eventIds: [],
    sourceType: 'PLAYER_COMMAND',
    stepId: 'set-live-card',
    stepText: '设置 LIVE 卡',
    waitingSeat: input.getSeatForPlayer(command.playerId),
    visibleCandidates: sourceSummary.visibleCandidates,
    auditCandidates: sourceSummary.visibleCandidates,
    visibleContextSummary: {
      selectableCardCount: 1,
      hasPrivateCandidates: true,
    },
    submittedCommandSeq: input.submittedCommandSeq ?? null,
    submission: {
      commandType: command.type,
      selectedCardId: command.cardId,
      faceDown: command.faceDown,
    },
    resultSummary: command.faceDown ? '盖放 LIVE 卡' : '正面放置 LIVE 卡',
    replayCapability: 'DECISION_RECORDS_PARTIAL',
    transitionSemantics: 'STRUCTURED',
  };
}

function buildSelectSuccessLiveDecisionRecord(
  command: SelectSuccessLiveCommand,
  input: BuildMatchDecisionRecordsInput
): MatchDecisionRecordInput {
  const state = input.beforeState ?? input.afterState;
  const sourceSummary = state
    ? summarizeSourceCard(state, command.cardId)
    : emptySourceSummary(command.cardId);
  return {
    ...sourceSummary,
    decisionId: buildCommandDecisionId(input.matchId, command, input.submittedCommandSeq),
    decisionSchemaVersion: 1,
    decisionType: 'SELECT_SUCCESS_LIVE_SUBMITTED',
    status: 'SUBMITTED',
    playerId: command.playerId,
    eventIds: [],
    sourceType: 'PLAYER_COMMAND',
    stepId: 'select-success-live',
    stepText: '选择成功 LIVE',
    waitingSeat: input.getSeatForPlayer(command.playerId),
    visibleCandidates: sourceSummary.visibleCandidates,
    auditCandidates: sourceSummary.visibleCandidates,
    visibleContextSummary: {
      selectableCardCount: 1,
      hasPrivateCandidates: false,
    },
    submittedCommandSeq: input.submittedCommandSeq ?? null,
    submission: {
      commandType: command.type,
      selectedCardId: command.cardId,
    },
    resultSummary: '成功 LIVE 已选择',
    replayCapability: 'DECISION_RECORDS_PARTIAL',
    transitionSemantics: 'STRUCTURED',
  };
}

function summarizeActiveEffect(
  state: GameState,
  effect: ActiveEffectState,
  getSeatForPlayer: (playerId: string | null | undefined) => Seat | null
): Omit<
  MatchDecisionRecordInput,
  'decisionId' | 'decisionType' | 'status' | 'transitionSemantics'
> {
  const sourceCard = getCardById(state, effect.sourceCardId);
  const sourceLocation = findCardLocation(state, effect.sourceCardId);
  const abilityDefinition = findCardAbilityDefinitionById(effect.abilityId);
  const pendingAbilityCandidates = getPendingAbilityOrderCandidates(state, effect);
  const candidates =
    pendingAbilityCandidates.length > 0
      ? summarizePendingAbilitySourceCards(state, pendingAbilityCandidates)
      : summarizeCandidateCards(state, effect.selectableCardIds ?? []);

  return {
    decisionSchemaVersion: 1,
    playerId: effect.awaitingPlayerId,
    eventIds:
      pendingAbilityCandidates.length > 0
        ? collectPendingAbilityEventIds(pendingAbilityCandidates)
        : [],
    sourceType: pendingAbilityCandidates.length > 0 ? 'PENDING_ABILITY_ORDER' : 'CARD_ABILITY',
    sourceCardObjectId: effect.sourceCardId,
    sourceCardCode: sourceCard ? normalizeCardCode(sourceCard.data.cardCode) : null,
    sourceBaseCardCode: sourceCard ? getBaseCardCode(sourceCard.data.cardCode) : null,
    sourceZone: sourceLocation.zone,
    sourceSlot: sourceLocation.slot,
    abilityId: effect.abilityId,
    triggerCondition: abilityDefinition?.triggerCondition ?? null,
    abilityCategory: abilityDefinition?.category ?? null,
    abilitySourceZone: abilityDefinition?.sourceZone ?? null,
    effectTextSnapshot: effect.effectText,
    stepId: effect.stepId,
    stepText: effect.stepText,
    waitingSeat: getSeatForPlayer(effect.awaitingPlayerId),
    visibleCandidates: candidates,
    auditCandidates: candidates,
    visibleContextSummary: summarizeVisibleContext(effect, pendingAbilityCandidates.length),
    minSelect: getMinSelectableCards(effect),
    maxSelect: getMaxSelectableCards(effect),
    canSkip: effect.canSkipSelection ?? null,
    replayCapability: 'DECISION_RECORDS_PARTIAL',
  };
}

function summarizeActiveEffectWithoutState(
  effect: ActiveEffectState,
  getSeatForPlayer: (playerId: string | null | undefined) => Seat | null
): Omit<
  MatchDecisionRecordInput,
  'decisionId' | 'decisionType' | 'status' | 'transitionSemantics'
> {
  return {
    decisionSchemaVersion: 1,
    playerId: effect.awaitingPlayerId,
    eventIds: [],
    sourceType: 'CARD_ABILITY',
    sourceCardObjectId: effect.sourceCardId,
    sourceCardCode: null,
    sourceBaseCardCode: null,
    sourceZone: null,
    sourceSlot: null,
    abilityId: effect.abilityId,
    effectTextSnapshot: effect.effectText,
    stepId: effect.stepId,
    stepText: effect.stepText,
    waitingSeat: getSeatForPlayer(effect.awaitingPlayerId),
    visibleCandidates: [],
    auditCandidates: [],
    visibleContextSummary: summarizeVisibleContext(effect),
    minSelect: getMinSelectableCards(effect),
    maxSelect: getMaxSelectableCards(effect),
    canSkip: effect.canSkipSelection ?? null,
    replayCapability: 'DECISION_RECORDS_PARTIAL',
  };
}

function summarizeSourceCard(
  state: GameState,
  cardId: string,
  abilityId?: string
): Pick<
  MatchDecisionRecordInput,
  | 'sourceCardObjectId'
  | 'sourceCardCode'
  | 'sourceBaseCardCode'
  | 'sourceZone'
  | 'sourceSlot'
  | 'abilityId'
  | 'visibleCandidates'
> {
  const sourceCard = getCardById(state, cardId);
  const sourceLocation = findCardLocation(state, cardId);
  return {
    sourceCardObjectId: cardId,
    sourceCardCode: sourceCard ? normalizeCardCode(sourceCard.data.cardCode) : null,
    sourceBaseCardCode: sourceCard ? getBaseCardCode(sourceCard.data.cardCode) : null,
    sourceZone: sourceLocation.zone,
    sourceSlot: sourceLocation.slot,
    abilityId: abilityId ?? null,
    visibleCandidates: summarizeCandidateCards(state, [cardId]),
  };
}

function emptySourceSummary(
  cardId: string,
  abilityId?: string
): Pick<
  MatchDecisionRecordInput,
  | 'sourceCardObjectId'
  | 'sourceCardCode'
  | 'sourceBaseCardCode'
  | 'sourceZone'
  | 'sourceSlot'
  | 'abilityId'
  | 'visibleCandidates'
> {
  return {
    sourceCardObjectId: cardId,
    sourceCardCode: null,
    sourceBaseCardCode: null,
    sourceZone: null,
    sourceSlot: null,
    abilityId: abilityId ?? null,
    visibleCandidates: [],
  };
}

function summarizeCandidateCards(
  state: GameState,
  candidateCardIds: readonly string[]
): readonly MatchDecisionCardSummary[] {
  return candidateCardIds.map((cardId) => {
    const card = getCardById(state, cardId);
    return {
      cardId,
      cardCode: card ? normalizeCardCode(card.data.cardCode) : null,
      baseCardCode: card ? getBaseCardCode(card.data.cardCode) : null,
      name: card?.data.name ?? null,
    };
  });
}

function summarizePendingAbilitySourceCards(
  state: GameState,
  pendingAbilities: readonly PendingAbilityState[]
): readonly MatchDecisionCardSummary[] {
  return pendingAbilities.flatMap((ability) =>
    summarizeCandidateCards(state, [ability.sourceCardId])
  );
}

function getPendingAbilityOrderCandidates(
  state: GameState,
  effect: ActiveEffectState
): readonly PendingAbilityState[] {
  const pendingAbilityIds = getPendingAbilityOrderIds(effect);
  if (pendingAbilityIds.length === 0) {
    return [];
  }

  const pendingAbilityById = new Map(
    state.pendingAbilities.map((ability) => [ability.id, ability])
  );
  return pendingAbilityIds
    .map((abilityId) => pendingAbilityById.get(abilityId))
    .filter((ability): ability is PendingAbilityState => !!ability);
}

function getPendingAbilityOrderIds(effect: ActiveEffectState): readonly string[] {
  if (!isPendingAbilityOrderSelectionEffect(effect)) {
    return [];
  }
  const value = effect.metadata?.pendingAbilityIds;
  return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : [];
}

function isPendingAbilityOrderSelectionEffect(effect: ActiveEffectState): boolean {
  return (
    effect.abilityId === ABILITY_ORDER_SELECTION_ID &&
    Array.isArray(effect.metadata?.pendingAbilityIds)
  );
}

function selectPendingAbilityCandidate(
  candidates: readonly PendingAbilityState[],
  command: ConfirmEffectStepCommand
): PendingAbilityState | null {
  if (command.resolveInOrder === true) {
    return candidates[0] ?? null;
  }
  if (command.selectedOptionId) {
    return candidates.find((ability) => ability.id === command.selectedOptionId) ?? null;
  }
  if (command.selectedCardId) {
    return candidates.find((ability) => ability.sourceCardId === command.selectedCardId) ?? null;
  }
  return null;
}

function collectPendingAbilityEventIds(
  pendingAbilities: readonly PendingAbilityState[]
): readonly string[] {
  const eventIds: string[] = [];
  const seen = new Set<string>();
  for (const ability of pendingAbilities) {
    for (const eventId of ability.eventIds) {
      if (!seen.has(eventId)) {
        seen.add(eventId);
        eventIds.push(eventId);
      }
    }
  }
  return eventIds;
}

function summarizePendingAbilityOrderResult(
  command: ConfirmEffectStepCommand,
  selectedAbility: PendingAbilityState | null
): string {
  if (command.resolveInOrder === true) {
    return selectedAbility
      ? `按当前队列顺序发动：${selectedAbility.abilityId}`
      : '按当前队列顺序发动';
  }
  return selectedAbility
    ? `选择待处理能力：${selectedAbility.abilityId}`
    : '待处理能力顺序选择已提交';
}

function summarizeVisibleContext(
  effect: ActiveEffectState,
  pendingAbilityCandidateCount = 0
): MatchDecisionVisibleContextSummary {
  const selectableCardCount =
    pendingAbilityCandidateCount > 0
      ? pendingAbilityCandidateCount
      : (effect.selectableCardIds?.length ?? 0);
  const selectableOptionCount =
    pendingAbilityCandidateCount > 0
      ? Math.max(effect.selectableOptions?.length ?? 0, pendingAbilityCandidateCount)
      : (effect.selectableOptions?.length ?? 0);

  return {
    selectableCardCount,
    selectableSlotCount: effect.selectableSlots?.length ?? 0,
    selectableOptionCount,
    hasPrivateCandidates: effect.selectableCardVisibility === 'AWAITING_PLAYER_ONLY',
  };
}

function summarizeConfirmEffectStepSubmission(
  command: ConfirmEffectStepCommand
): MatchDecisionSubmissionSummary {
  return {
    commandType: command.type,
    ...('selectedCardId' in command ? { selectedCardId: command.selectedCardId ?? null } : {}),
    ...(command.selectedCardIds ? { selectedCardIds: [...command.selectedCardIds] } : {}),
    ...('selectedSlot' in command ? { selectedSlot: command.selectedSlot ?? null } : {}),
    ...('selectedOptionId' in command
      ? { selectedOptionId: command.selectedOptionId ?? null }
      : {}),
    ...('selectedNumber' in command ? { selectedNumber: command.selectedNumber ?? null } : {}),
    ...(command.resolveInOrder !== undefined ? { resolveInOrder: command.resolveInOrder } : {}),
    skipped: command.selectedCardId === null,
  };
}

function summarizeActiveEffectTransition(
  beforeEffect: ActiveEffectState,
  afterEffect: ActiveEffectState | null
): string {
  if (!afterEffect) {
    return '效果步骤已完成';
  }
  if (!isSameActiveEffectDecisionStep(beforeEffect, afterEffect)) {
    return `进入效果步骤：${afterEffect.stepId}`;
  }
  return '效果步骤保持等待输入';
}

function isConfirmEffectStepCommand(command: GameCommand): command is ConfirmEffectStepCommand {
  return command.type === GameCommandType.CONFIRM_EFFECT_STEP;
}

function isSameActiveEffectDecisionStep(
  left: ActiveEffectState | null | undefined,
  right: ActiveEffectState | null | undefined
): boolean {
  return (
    !!left &&
    !!right &&
    left.id === right.id &&
    left.abilityId === right.abilityId &&
    left.stepId === right.stepId &&
    left.awaitingPlayerId === right.awaitingPlayerId
  );
}

function buildDecisionId(
  matchId: string,
  status: 'opened' | 'submitted',
  effect: ActiveEffectState,
  occurrenceKey: string
): string {
  return [
    'decision',
    status,
    matchId,
    effect.id,
    effect.abilityId,
    effect.stepId,
    effect.awaitingPlayerId ?? 'none',
    occurrenceKey,
  ]
    .map((part) => encodeURIComponent(part))
    .join(':');
}

function buildCommandOccurrenceKey(
  command: GameCommand,
  submittedCommandSeq: number | null | undefined
): string {
  if (submittedCommandSeq !== null && submittedCommandSeq !== undefined) {
    return `cmd-seq-${submittedCommandSeq}`;
  }
  return `cmd-ts-${command.timestamp}`;
}

function buildStateTransitionOccurrenceKey(state: GameState): string {
  return [
    'state',
    `action-${state.actionSequence}`,
    `event-${state.eventSequence}`,
    `turn-${state.turnCount}`,
    String(state.currentPhase),
    String(state.currentSubPhase),
  ].join('-');
}

function buildCommandDecisionId(
  matchId: string,
  command: GameCommand,
  submittedCommandSeq: number | null | undefined
): string {
  const discriminator =
    submittedCommandSeq !== null && submittedCommandSeq !== undefined
      ? `seq-${submittedCommandSeq}`
      : `ts-${command.timestamp}`;
  return ['decision', 'command', matchId, command.type, discriminator]
    .map((part) => encodeURIComponent(part))
    .join(':');
}

function getMinSelectableCards(effect: ActiveEffectState): number | null {
  if (effect.minSelectableCards !== undefined) {
    return effect.minSelectableCards;
  }
  if (effect.selectableCardIds?.length) {
    return effect.canSkipSelection ? 0 : 1;
  }
  return null;
}

function getMaxSelectableCards(effect: ActiveEffectState): number | null {
  if (effect.maxSelectableCards !== undefined) {
    return effect.maxSelectableCards;
  }
  if (effect.selectableCardIds?.length) {
    return effect.selectableCardMode === 'ORDERED_MULTI' ? effect.selectableCardIds.length : 1;
  }
  return null;
}

function findCardLocation(
  state: GameState,
  cardId: string
): { readonly zone: string | null; readonly slot: string | null } {
  for (const player of state.players) {
    for (const [slot, memberCardId] of Object.entries(player.memberSlots.slots)) {
      if (memberCardId === cardId) {
        return { zone: ZoneType.MEMBER_SLOT, slot };
      }
    }

    const zones: ReadonlyArray<{
      readonly zone: ZoneType;
      readonly cardIds: readonly string[];
    }> = [
      { zone: ZoneType.HAND, cardIds: player.hand.cardIds },
      { zone: ZoneType.MAIN_DECK, cardIds: player.mainDeck.cardIds },
      { zone: ZoneType.ENERGY_DECK, cardIds: player.energyDeck.cardIds },
      { zone: ZoneType.ENERGY_ZONE, cardIds: player.energyZone.cardIds },
      { zone: ZoneType.LIVE_ZONE, cardIds: player.liveZone.cardIds },
      { zone: ZoneType.SUCCESS_ZONE, cardIds: player.successZone.cardIds },
      { zone: ZoneType.WAITING_ROOM, cardIds: player.waitingRoom.cardIds },
      { zone: ZoneType.EXILE_ZONE, cardIds: player.exileZone.cardIds },
    ];
    for (const zone of zones) {
      if (zone.cardIds.includes(cardId)) {
        return { zone: zone.zone, slot: null };
      }
    }
  }

  if (state.inspectionZone.cardIds.includes(cardId)) {
    return { zone: ZoneType.INSPECTION_ZONE, slot: null };
  }
  if (state.resolutionZone.cardIds.includes(cardId)) {
    return { zone: ZoneType.RESOLUTION_ZONE, slot: null };
  }
  return { zone: null, slot: null };
}
