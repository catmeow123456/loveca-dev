import {
  addAction,
  getCardById,
  getPlayerById,
  type ActiveEffectState,
  type GameState,
} from '../../../../domain/entities/game.js';
import type { EnterStageEvent } from '../../../../domain/events/game-events.js';
import { SlotPosition, TriggerCondition, ZoneType } from '../../../../shared/types/enums.js';
import { unitAliasIs } from '../../../effects/card-selectors.js';
import { getHandMemberEffectiveCost } from '../../../effects/play-member-cost.js';
import { getStageMemberCardIdsMatching } from '../../../effects/stage-targets.js';
import { HS_BP8_021_LIVE_START_RETURN_MIRACRA_MEMBER_PLAY_SAME_COST_ABILITY_ID as ABILITY_ID } from '../../ability-ids.js';
import { getStageMemberLifecycleId } from '../../runtime/ability-source-lifecycle.js';
import {
  finishSkippedActiveEffect,
  startPendingActiveEffect,
} from '../../runtime/active-effect.js';
import { getNewEnterStageEvents } from '../../runtime/events.js';
import { playMemberFromZoneToEmptySlot } from '../../runtime/play-member-to-stage.js';
import {
  returnStageMemberToHandAndEnqueueTriggers,
  type EnqueueStageMemberReturnTriggers,
} from '../../runtime/return-stage-member-to-hand.js';
import { queryCardSelection, querySlotSelection } from '../../runtime/selection-query.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import {
  getAbilityEffectText,
  maybeStartConfirmablePendingAbilityConfirmation,
} from '../../runtime/workflow-helpers.js';

const RETURN_STEP = 'HS_BP8_021_SELECT_STAGE_MEMBER_TO_RETURN';
const HAND_STEP = 'HS_BP8_021_SELECT_SAME_COST_HAND_MEMBER';
const SLOT_STEP = 'HS_BP8_021_SELECT_EMPTY_STAGE_SLOT';
const miraCra = unitAliasIs('Mira-Cra Park!');

type Continue = (game: GameState, orderedResolution: boolean) => GameState;
type Enqueue = (
  game: GameState,
  triggers: readonly TriggerCondition[],
  options: Partial<Parameters<EnqueueStageMemberReturnTriggers>[2]> & {
    readonly enterStageEvents?: readonly EnterStageEvent[];
    readonly onEnterSources?: readonly [];
  }
) => GameState;

export function registerHsBp8021MiraCreationWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: Enqueue;
}): void {
  registerPendingAbilityStarterHandler(ABILITY_ID, (game, ability, options, context) => {
    const ids = getReturnTargets(game, ability.controllerId);
    if (ids.length === 0) {
      const confirmation = maybeStartConfirmablePendingAbilityConfirmation(game, ability, options, {
        stepText: '没有可选择的目标。',
      });
      if (confirmation) return confirmation;
      const state = {
        ...game,
        pendingAbilities: game.pendingAbilities.filter((item) => item.id !== ability.id),
      };
      return context.continuePendingCardEffects(
        addAction(state, 'RESOLVE_ABILITY', ability.controllerId, {
          pendingAbilityId: ability.id,
          abilityId: ABILITY_ID,
          sourceCardId: ability.sourceCardId,
          step: 'NO_STAGE_MEMBER_TO_RETURN',
        }),
        options.orderedResolution === true
      );
    }
    return startPendingActiveEffect(game, {
      ability,
      playerId: ability.controllerId,
      activeEffect: {
        id: ability.id,
        abilityId: ABILITY_ID,
        sourceCardId: ability.sourceCardId,
        sourceLifecycleId: ability.sourceLifecycleId,
        controllerId: ability.controllerId,
        awaitingPlayerId: ability.controllerId,
        effectText: getAbilityEffectText(ABILITY_ID),
        stepId: RETURN_STEP,
        stepText: '可以将自己舞台上的１名『Mira-Cra Park!』成员放回手牌。',
        selectableCardVisibility: 'PUBLIC',
        selectionLabel: '选择要放回手牌的成员',
        confirmSelectionLabel: '放回手牌',
        canSkipSelection: true,
        skipSelectionLabel: '不发动',
        ...returnTargets(game, ids, options.orderedResolution === true),
      },
      actionPayload: { sourceCardId: ability.sourceCardId, step: RETURN_STEP },
    });
  });
  registerActiveEffectStepHandler(
    ABILITY_ID,
    RETURN_STEP,
    (game, input, context) =>
      finishReturnSelection(
        game,
        input.selectedCardId,
        context.continuePendingCardEffects,
        deps.enqueueTriggeredCardEffects
      ),
    queryCardSelection
  );
  registerActiveEffectStepHandler(
    ABILITY_ID,
    HAND_STEP,
    (game, input, context) =>
      finishHandSelection(game, input.selectedCardId, context.continuePendingCardEffects),
    queryCardSelection
  );
  registerActiveEffectStepHandler(
    ABILITY_ID,
    SLOT_STEP,
    (game, input, context) =>
      finishSlotSelection(
        game,
        input.selectedSlot,
        context.continuePendingCardEffects,
        deps.enqueueTriggeredCardEffects
      ),
    querySlotSelection
  );
}

function finishReturnSelection(
  game: GameState,
  selectedCardId: string | null | undefined,
  next: Continue,
  enqueue: Enqueue
): GameState {
  const effect = game.activeEffect!;
  if (selectedCardId == null)
    return finishSkippedActiveEffect(game, next, { step: 'DECLINE_RETURN' });

  const ids = getReturnTargets(game, effect.controllerId);
  const lifecycles = effect.metadata?.targetLifecycleIds as
    Readonly<Record<string, unknown>> | undefined;
  if (
    !ids.includes(selectedCardId) ||
    lifecycles?.[selectedCardId] !== getStageMemberLifecycleId(game, selectedCardId)
  ) {
    return ids.length === 0
      ? finishSkippedActiveEffect(game, next, { step: 'NO_STAGE_MEMBER_TO_RETURN' })
      : {
          ...game,
          activeEffect: {
            ...effect,
            ...returnTargets(game, ids, effect.metadata?.orderedResolution === true),
          },
        };
  }

  const returned = returnStageMemberToHandAndEnqueueTriggers(
    game,
    effect.controllerId,
    selectedCardId,
    enqueue
  );
  if (!returned) return game;
  const state = addAction(returned.gameState, 'RESOLVE_ABILITY', effect.controllerId, {
    pendingAbilityId: effect.id,
    abilityId: ABILITY_ID,
    sourceCardId: effect.sourceCardId,
    step: 'RETURN_STAGE_MEMBER_TO_HAND',
    returnedCardId: selectedCardId,
    returnedMemberEffectiveCost: returned.returnedMemberEffectiveCost,
  });
  return selectHandMember(state, effect, returned.returnedMemberEffectiveCost, next);
}

function selectHandMember(
  game: GameState,
  effect: ActiveEffectState,
  cost: number,
  next: Continue
): GameState {
  if (getEmptySlots(game, effect.controllerId).length === 0) {
    return finishSkippedActiveEffect(game, next, { step: 'NO_EMPTY_MEMBER_SLOT' });
  }
  return {
    ...game,
    activeEffect: {
      ...effect,
      stepId: HAND_STEP,
      stepText: '从手牌选择１张与放回手牌前的成员费用相同的『Mira-Cra Park!』成员卡。',
      // Keep the private window even when no card matches, so the opponent cannot infer hand contents.
      selectableCardIds: getHandTargets(game, effect.controllerId, cost),
      selectableCardVisibility: 'AWAITING_PLAYER_ONLY',
      selectableSlots: undefined,
      selectionLabel: '选择要登场的手牌成员',
      confirmSelectionLabel: '选择登场区域',
      canSkipSelection: true,
      skipSelectionLabel: '不登场',
      metadata: {
        orderedResolution: effect.metadata?.orderedResolution === true,
        returnedCost: cost,
      },
    },
  };
}

function finishHandSelection(
  game: GameState,
  selectedCardId: string | null | undefined,
  next: Continue
): GameState {
  const effect = game.activeEffect!;
  if (selectedCardId == null)
    return finishSkippedActiveEffect(game, next, { step: 'DECLINE_PLAY' });
  const cost = effect.metadata?.returnedCost;
  if (typeof cost !== 'number') return game;
  const slots = getEmptySlots(game, effect.controllerId);
  if (
    slots.length === 0 ||
    !getHandTargets(game, effect.controllerId, cost).includes(selectedCardId)
  ) {
    return selectHandMember(game, effect, cost, next);
  }
  return {
    ...game,
    activeEffect: {
      ...effect,
      stepId: SLOT_STEP,
      stepText: '请选择该成员要登场的空成员区。',
      selectableCardIds: undefined,
      selectableCardVisibility: undefined,
      selectableSlots: slots,
      selectionLabel: '选择登场区域',
      confirmSelectionLabel: '登场',
      canSkipSelection: false,
      skipSelectionLabel: undefined,
      metadata: { ...effect.metadata, selectedCardId },
    },
  };
}

function finishSlotSelection(
  game: GameState,
  slot: SlotPosition | null | undefined,
  next: Continue,
  enqueue: Enqueue
): GameState {
  const effect = game.activeEffect!;
  const { returnedCost, selectedCardId } = effect.metadata ?? {};
  if (slot == null || typeof returnedCost !== 'number' || typeof selectedCardId !== 'string')
    return game;
  const slots = getEmptySlots(game, effect.controllerId);
  if (
    slots.length === 0 ||
    !getHandTargets(game, effect.controllerId, returnedCost).includes(selectedCardId)
  ) {
    return selectHandMember(game, effect, returnedCost, next);
  }
  if (!slots.includes(slot))
    return { ...game, activeEffect: { ...effect, selectableSlots: slots } };

  const played = playMemberFromZoneToEmptySlot(game, effect.controllerId, {
    cardId: selectedCardId,
    sourceZone: ZoneType.HAND,
    toSlot: slot,
  });
  if (!played) return game;

  // The placement remains visible to all stage-entry AUTO listeners.
  const triggered = enqueue(played.gameState, [TriggerCondition.ON_ENTER_STAGE], {
    enterStageEvents: getNewEnterStageEvents(game, played.gameState),
    onEnterSources: [],
  });
  const finished = addAction(
    { ...triggered, activeEffect: null },
    'RESOLVE_ABILITY',
    effect.controllerId,
    {
      pendingAbilityId: effect.id,
      abilityId: ABILITY_ID,
      sourceCardId: effect.sourceCardId,
      step: 'PLAY_SAME_COST_HAND_MEMBER',
      playedCardId: selectedCardId,
      toSlot: slot,
    }
  );
  return next(finished, effect.metadata?.orderedResolution === true);
}

function getReturnTargets(game: GameState, playerId: string): readonly string[] {
  return getStageMemberCardIdsMatching(
    game,
    playerId,
    (card) => card.ownerId === playerId && miraCra(card)
  );
}

function returnTargets(game: GameState, ids: readonly string[], orderedResolution: boolean) {
  return {
    selectableCardIds: ids,
    metadata: {
      orderedResolution,
      targetLifecycleIds: Object.fromEntries(
        ids.map((id) => [id, getStageMemberLifecycleId(game, id)])
      ),
    },
  };
}

function getHandTargets(game: GameState, playerId: string, cost: number): readonly string[] {
  const handIds = getPlayerById(game, playerId)?.hand.cardIds ?? [];
  return handIds.filter((id) => {
    const card = getCardById(game, id);
    return (
      card !== null &&
      miraCra(card) &&
      getHandMemberEffectiveCost(game, playerId, id, handIds) === cost
    );
  });
}

function getEmptySlots(game: GameState, playerId: string): readonly SlotPosition[] {
  const player = getPlayerById(game, playerId);
  return [SlotPosition.LEFT, SlotPosition.CENTER, SlotPosition.RIGHT].filter(
    (slot) => player?.memberSlots.slots[slot] === null
  );
}
