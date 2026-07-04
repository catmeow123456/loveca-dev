import { isMemberCardData } from '../../../../domain/entities/card.js';
import {
  addAction,
  getCardById,
  getPlayerById,
  type GameState,
} from '../../../../domain/entities/game.js';
import type {
  EnterStageEvent,
  EnterWaitingRoomEvent,
  LeaveStageEvent,
} from '../../../../domain/events/game-events.js';
import { OrientationState, SlotPosition, TriggerCondition } from '../../../../shared/types/enums.js';
import { groupAliasIs } from '../../../effects/card-selectors.js';
import {
  playMembersFromWaitingRoomToEmptySlots,
  type PlayMembersFromWaitingRoomResult,
} from '../../../effects/member-state.js';
import {
  sendStageMemberToWaitingRoomAndEnqueueLeaveStageTriggers,
  type EnqueueTriggeredCardEffectsForLeaveStage,
  type SendStageMemberToWaitingRoomAndEnqueueLeaveStageTriggersResult,
} from '../../runtime/leave-stage-triggers.js';
import { getNewEnterStageEvents } from '../../runtime/events.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';

export interface StageMemberUpgradeTarget {
  readonly cardId: string;
  readonly slot: SlotPosition;
  readonly printedCost: number;
}

export interface SendStageMemberUpgradeTargetResult
  extends SendStageMemberToWaitingRoomAndEnqueueLeaveStageTriggersResult {
  readonly target: StageMemberUpgradeTarget;
  readonly requiredReplacementCost: number;
  readonly replacementCandidateCardIds: readonly string[];
}

export interface PlayStageMemberUpgradeReplacementResult extends PlayMembersFromWaitingRoomResult {
  readonly playedCardId: string;
  readonly toSlot: SlotPosition;
}

export interface StageMemberUpgradeReplacementWorkflowConfig {
  readonly abilityId: string;
  readonly groupAlias: string;
  readonly groupLabel: string;
  readonly costDelta: number;
  readonly selectTargetStepId: string;
  readonly selectReplacementStepId: string;
  readonly selectTargetStepText: string;
  readonly targetSelectionLabel: string;
  readonly targetConfirmLabel: string;
  readonly replacementSelectionLabel: string;
  readonly replacementConfirmLabel: string;
}

type EnqueueTriggeredCardEffectsForStageMemberUpgrade = (
  game: GameState,
  triggerConditions: readonly TriggerCondition[],
  options?: {
    readonly enterStageEvents?: readonly EnterStageEvent[];
    readonly enterWaitingRoomEvents?: readonly EnterWaitingRoomEvent[];
    readonly leaveStageEvents?: readonly LeaveStageEvent[];
  }
) => GameState;

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

const STAGE_SLOTS: readonly SlotPosition[] = [
  SlotPosition.LEFT,
  SlotPosition.CENTER,
  SlotPosition.RIGHT,
];

export function registerStageMemberUpgradeReplacementStepHandlers(
  config: StageMemberUpgradeReplacementWorkflowConfig,
  deps: {
    readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForStageMemberUpgrade;
  }
): void {
  registerActiveEffectStepHandler(config.abilityId, config.selectTargetStepId, (game, input, context) =>
    finishStageMemberUpgradeTargetSelection(
      game,
      input.selectedCardId ?? null,
      config,
      context.continuePendingCardEffects,
      deps.enqueueTriggeredCardEffects
    )
  );
  registerActiveEffectStepHandler(
    config.abilityId,
    config.selectReplacementStepId,
    (game, input, context) =>
      finishStageMemberUpgradeReplacementSelection(
        game,
        input.selectedCardId ?? null,
        config,
        context.continuePendingCardEffects,
        deps.enqueueTriggeredCardEffects
      )
  );
}

export function startStageMemberUpgradeTargetSelection(
  game: GameState,
  config: StageMemberUpgradeReplacementWorkflowConfig,
  options: {
    readonly effect: NonNullable<GameState['activeEffect']>;
    readonly playerId: string;
    readonly extraActionPayload?: Readonly<Record<string, unknown>>;
  }
): GameState {
  const targetCardIds = getOwnStageGroupMemberUpgradeTargets(game, options.playerId, {
    groupAlias: config.groupAlias,
    excludeCardId: options.effect.sourceCardId,
  }).map((target) => target.cardId);

  if (targetCardIds.length === 0) {
    return addAction(
      {
        ...game,
        activeEffect: null,
      },
      'RESOLVE_ABILITY',
      options.playerId,
      {
        pendingAbilityId: options.effect.id,
        abilityId: options.effect.abilityId,
        sourceCardId: options.effect.sourceCardId,
        sourceSlot: options.effect.metadata?.sourceSlot,
        step: 'NO_UPGRADE_TARGET_AFTER_COST',
        ...options.extraActionPayload,
      }
    );
  }

  return addAction(
    {
      ...game,
      activeEffect: {
        ...options.effect,
        stepId: config.selectTargetStepId,
        stepText: config.selectTargetStepText,
        selectableCardIds: targetCardIds,
        selectableCardVisibility: 'PUBLIC',
        selectionLabel: config.targetSelectionLabel,
        confirmSelectionLabel: config.targetConfirmLabel,
        metadata: {
          ...options.effect.metadata,
          ...options.extraActionPayload,
        },
      },
    },
    'RESOLVE_ABILITY',
    options.playerId,
    {
      pendingAbilityId: options.effect.id,
      abilityId: options.effect.abilityId,
      sourceCardId: options.effect.sourceCardId,
      sourceSlot: options.effect.metadata?.sourceSlot,
      step: 'SELECT_UPGRADE_TARGET',
      selectableCardIds: targetCardIds,
      ...options.extraActionPayload,
    }
  );
}

export function getOwnStageGroupMemberUpgradeTargets(
  game: GameState,
  playerId: string,
  options: {
    readonly groupAlias: string;
    readonly excludeCardId: string;
  }
): readonly StageMemberUpgradeTarget[] {
  const player = getPlayerById(game, playerId);
  if (!player) {
    return [];
  }

  return STAGE_SLOTS.flatMap((slot) => {
    const cardId = player.memberSlots.slots[slot];
    const card = cardId ? getCardById(game, cardId) : null;
    return cardId &&
      cardId !== options.excludeCardId &&
      card &&
      card.ownerId === player.id &&
      isMemberCardData(card.data) &&
      groupAliasIs(options.groupAlias)(card)
      ? [{ cardId, slot, printedCost: card.data.cost }]
      : [];
  });
}

export function sendStageMemberUpgradeTargetToWaitingRoom(
  game: GameState,
  playerId: string,
  targetCardId: string,
  options: {
    readonly groupAlias: string;
    readonly excludeCardId: string;
    readonly costDelta: number;
    readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForLeaveStage;
  }
): SendStageMemberUpgradeTargetResult | null {
  const target = getOwnStageGroupMemberUpgradeTargets(game, playerId, {
    groupAlias: options.groupAlias,
    excludeCardId: options.excludeCardId,
  }).find((candidate) => candidate.cardId === targetCardId);
  if (!target) {
    return null;
  }

  const movedResult = sendStageMemberToWaitingRoomAndEnqueueLeaveStageTriggers(
    game,
    playerId,
    targetCardId,
    options.enqueueTriggeredCardEffects
  );
  if (!movedResult) {
    return null;
  }

  const requiredReplacementCost = target.printedCost + options.costDelta;
  return {
    ...movedResult,
    target,
    requiredReplacementCost,
    replacementCandidateCardIds: getWaitingRoomGroupMemberUpgradeReplacementCandidateIds(
      movedResult.gameState,
      playerId,
      {
        groupAlias: options.groupAlias,
        requiredCost: requiredReplacementCost,
      }
    ),
  };
}

export function getWaitingRoomGroupMemberUpgradeReplacementCandidateIds(
  game: GameState,
  playerId: string,
  options: {
    readonly groupAlias: string;
    readonly requiredCost: number;
  }
): readonly string[] {
  const player = getPlayerById(game, playerId);
  if (!player) {
    return [];
  }

  return player.waitingRoom.cardIds.filter((cardId) => {
    const card = getCardById(game, cardId);
    return (
      card !== null &&
      card.ownerId === player.id &&
      isMemberCardData(card.data) &&
      card.data.cost === options.requiredCost &&
      groupAliasIs(options.groupAlias)(card)
    );
  });
}

export function playStageMemberUpgradeReplacementToOriginalSlot(
  game: GameState,
  playerId: string,
  selectedCardId: string,
  options: {
    readonly groupAlias: string;
    readonly requiredCost: number;
    readonly toSlot: SlotPosition;
    readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForStageMemberUpgrade;
  }
): PlayStageMemberUpgradeReplacementResult | null {
  const candidateCardIds = getWaitingRoomGroupMemberUpgradeReplacementCandidateIds(game, playerId, {
    groupAlias: options.groupAlias,
    requiredCost: options.requiredCost,
  });
  if (!candidateCardIds.includes(selectedCardId)) {
    return null;
  }

  const playResult = playMembersFromWaitingRoomToEmptySlots(
    game,
    playerId,
    [{ cardId: selectedCardId, toSlot: options.toSlot }],
    OrientationState.ACTIVE
  );
  if (!playResult) {
    return null;
  }

  return {
    ...playResult,
    gameState: options.enqueueTriggeredCardEffects(
      playResult.gameState,
      [TriggerCondition.ON_ENTER_STAGE],
      {
        enterStageEvents: getNewEnterStageEvents(game, playResult.gameState),
      }
    ),
    playedCardId: selectedCardId,
    toSlot: options.toSlot,
  };
}

function finishStageMemberUpgradeTargetSelection(
  game: GameState,
  selectedCardId: string | null,
  config: StageMemberUpgradeReplacementWorkflowConfig,
  continuePendingCardEffects: ContinuePendingCardEffects,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForStageMemberUpgrade
): GameState {
  const effect = game.activeEffect;
  const player = effect ? getPlayerById(game, effect.controllerId) : null;
  if (
    !effect ||
    !player ||
    effect.abilityId !== config.abilityId ||
    effect.stepId !== config.selectTargetStepId ||
    selectedCardId === null ||
    effect.selectableCardIds?.includes(selectedCardId) !== true ||
    selectedCardId === effect.sourceCardId
  ) {
    return game;
  }

  const upgradeResult = sendStageMemberUpgradeTargetToWaitingRoom(game, player.id, selectedCardId, {
    groupAlias: config.groupAlias,
    excludeCardId: effect.sourceCardId,
    costDelta: config.costDelta,
    enqueueTriggeredCardEffects,
  });
  if (!upgradeResult) {
    return game;
  }

  const stateAfterTargetMove = addAction(upgradeResult.gameState, 'RESOLVE_ABILITY', player.id, {
    pendingAbilityId: effect.id,
    abilityId: effect.abilityId,
    sourceCardId: effect.sourceCardId,
    sourceSlot: effect.metadata?.sourceSlot,
    step: 'SEND_STAGE_MEMBER_UPGRADE_TARGET_TO_WAITING_ROOM',
    targetCardId: selectedCardId,
    targetSlot: upgradeResult.target.slot,
    targetPrintedCost: upgradeResult.target.printedCost,
    requiredReplacementCost: upgradeResult.requiredReplacementCost,
    movedToWaitingRoomCardIds: upgradeResult.movedToWaitingRoomCardIds,
    enterWaitingRoomEventId: upgradeResult.enterWaitingRoomEvent.eventId,
    leaveStageEventIds: upgradeResult.leaveStageEvents.map((event) => event.eventId),
  });

  if (upgradeResult.replacementCandidateCardIds.length === 0) {
    return continuePendingCardEffects(
      addAction(
        {
          ...stateAfterTargetMove,
          activeEffect: null,
        },
        'RESOLVE_ABILITY',
        player.id,
        {
          pendingAbilityId: effect.id,
          abilityId: effect.abilityId,
          sourceCardId: effect.sourceCardId,
          sourceSlot: effect.metadata?.sourceSlot,
          step: 'NO_REPLACEMENT_CANDIDATE_AFTER_TARGET_MOVED',
          targetCardId: selectedCardId,
          targetSlot: upgradeResult.target.slot,
          targetPrintedCost: upgradeResult.target.printedCost,
          requiredReplacementCost: upgradeResult.requiredReplacementCost,
        }
      ),
      false
    );
  }

  return addAction(
    {
      ...stateAfterTargetMove,
      activeEffect: {
        ...effect,
        stepId: config.selectReplacementStepId,
        stepText: `请选择自己的休息室中1张费用正好为${upgradeResult.requiredReplacementCost}的『${config.groupLabel}』成员卡登场到原区域。`,
        selectableCardIds: upgradeResult.replacementCandidateCardIds,
        selectableCardVisibility: 'PUBLIC',
        selectionLabel: config.replacementSelectionLabel,
        confirmSelectionLabel: config.replacementConfirmLabel,
        metadata: {
          ...effect.metadata,
          targetCardId: selectedCardId,
          targetSlot: upgradeResult.target.slot,
          targetPrintedCost: upgradeResult.target.printedCost,
          requiredReplacementCost: upgradeResult.requiredReplacementCost,
          movedToWaitingRoomCardIds: upgradeResult.movedToWaitingRoomCardIds,
        },
      },
    },
    'RESOLVE_ABILITY',
    player.id,
    {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      sourceSlot: effect.metadata?.sourceSlot,
      step: 'START_SELECT_REPLACEMENT_MEMBER',
      targetCardId: selectedCardId,
      targetSlot: upgradeResult.target.slot,
      targetPrintedCost: upgradeResult.target.printedCost,
      requiredReplacementCost: upgradeResult.requiredReplacementCost,
      selectableCardIds: upgradeResult.replacementCandidateCardIds,
    }
  );
}

function finishStageMemberUpgradeReplacementSelection(
  game: GameState,
  selectedCardId: string | null,
  config: StageMemberUpgradeReplacementWorkflowConfig,
  continuePendingCardEffects: ContinuePendingCardEffects,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForStageMemberUpgrade
): GameState {
  const effect = game.activeEffect;
  const player = effect ? getPlayerById(game, effect.controllerId) : null;
  const targetSlot = parseSlotPosition(effect?.metadata?.targetSlot);
  const requiredReplacementCost =
    typeof effect?.metadata?.requiredReplacementCost === 'number'
      ? effect.metadata.requiredReplacementCost
      : null;
  if (
    !effect ||
    !player ||
    effect.abilityId !== config.abilityId ||
    effect.stepId !== config.selectReplacementStepId ||
    selectedCardId === null ||
    targetSlot === null ||
    requiredReplacementCost === null ||
    effect.selectableCardIds?.includes(selectedCardId) !== true
  ) {
    return game;
  }

  const playResult = playStageMemberUpgradeReplacementToOriginalSlot(
    game,
    player.id,
    selectedCardId,
    {
      groupAlias: config.groupAlias,
      requiredCost: requiredReplacementCost,
      toSlot: targetSlot,
      enqueueTriggeredCardEffects,
    }
  );
  if (!playResult) {
    return game;
  }

  return continuePendingCardEffects(
    addAction(
      {
        ...playResult.gameState,
        activeEffect: null,
      },
      'RESOLVE_ABILITY',
      player.id,
      {
        pendingAbilityId: effect.id,
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
        sourceSlot: effect.metadata?.sourceSlot,
        step: 'PLAY_REPLACEMENT_MEMBER_FROM_WAITING_ROOM',
        selectedCardId,
        toSlot: targetSlot,
        requiredReplacementCost,
      }
    ),
    false
  );
}

function parseSlotPosition(value: unknown): SlotPosition | null {
  return Object.values(SlotPosition).includes(value as SlotPosition) ? (value as SlotPosition) : null;
}
