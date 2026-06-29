import {
  addAction,
  getCardById,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import {
  collectLiveModifiers,
  getMemberEffectiveBladeCount,
} from '../../../../domain/rules/live-modifiers.js';
import { CardType, SlotPosition, TriggerCondition } from '../../../../shared/types/enums.js';
import { cardBelongsToGroup } from '../../../../shared/utils/card-identity.js';
import { and, costLte, typeIs } from '../../../effects/card-selectors.js';
import {
  createWaitingRoomToHandEffectState,
  createWaitingRoomToHandSelectionConfig,
  selectWaitingRoomCardIds,
} from '../../../effects/zone-selection.js';
import {
  BP4_005_LIVE_START_POSITION_CHANGE_IF_NO_HIGH_BLADE_MUSE_ABILITY_ID,
  BP4_005_ON_ENTER_RECOVER_LOW_COST_MEMBER_ABILITY_ID,
} from '../../ability-ids.js';
import { startPendingActiveEffect } from '../../runtime/active-effect.js';
import {
  moveMemberBetweenSlotsAndEnqueueTriggers,
  type EnqueueTriggeredCardEffectsForMemberSlotMoved,
} from '../../runtime/member-slot-moved-triggers.js';
import { getSourceMemberSlot } from '../../runtime/source-member.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText } from '../../runtime/workflow-helpers.js';
import { finishWaitingRoomToHandWorkflow } from '../shared/waiting-room-to-hand.js';

export const BP4_005_SELECT_LOW_COST_MEMBER_STEP_ID = 'BP4_005_SELECT_LOW_COST_MEMBER';
export const BP4_005_SELECT_POSITION_CHANGE_SLOT_STEP_ID =
  'BP4_005_SELECT_POSITION_CHANGE_SLOT';

const MEMBER_SLOT_ORDER = [SlotPosition.LEFT, SlotPosition.CENTER, SlotPosition.RIGHT] as const;
const lowCostMemberSelector = and(typeIs(CardType.MEMBER), costLte(2));

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerPlBp4005RinWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForMemberSlotMoved;
}): void {
  registerPendingAbilityStarterHandler(
    BP4_005_ON_ENTER_RECOVER_LOW_COST_MEMBER_ABILITY_ID,
    (game, ability, options, context) =>
      startRecoverLowCostMember(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      )
  );
  registerActiveEffectStepHandler(
    BP4_005_ON_ENTER_RECOVER_LOW_COST_MEMBER_ABILITY_ID,
    BP4_005_SELECT_LOW_COST_MEMBER_STEP_ID,
    (game, input, context) =>
      finishWaitingRoomToHandWorkflow(
        game,
        input.selectedCardId ?? null,
        input.selectedCardIds,
        context.continuePendingCardEffects
      )
  );

  registerPendingAbilityStarterHandler(
    BP4_005_LIVE_START_POSITION_CHANGE_IF_NO_HIGH_BLADE_MUSE_ABILITY_ID,
    (game, ability, options, context) =>
      startPositionChangeIfNoHighBladeMuse(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      )
  );
  registerActiveEffectStepHandler(
    BP4_005_LIVE_START_POSITION_CHANGE_IF_NO_HIGH_BLADE_MUSE_ABILITY_ID,
    BP4_005_SELECT_POSITION_CHANGE_SLOT_STEP_ID,
    (game, input, context) =>
      finishPositionChange(
        game,
        input.selectedSlot ?? null,
        context.continuePendingCardEffects,
        deps.enqueueTriggeredCardEffects
      )
  );
}

function startRecoverLowCostMember(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  const selectableCardIds = selectWaitingRoomCardIds(game, player.id, lowCostMemberSelector);
  if (selectableCardIds.length === 0) {
    return finishPendingAbility(
      game,
      ability,
      player.id,
      orderedResolution,
      {
        step: 'NO_LOW_COST_MEMBER_IN_WAITING_ROOM',
        selectableCardIds,
      },
      continuePendingCardEffects
    );
  }

  return startPendingActiveEffect(game, {
    ability,
    playerId: player.id,
    activeEffect: createWaitingRoomToHandEffectState({
      id: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      controllerId: ability.controllerId,
      effectText: getAbilityEffectText(BP4_005_ON_ENTER_RECOVER_LOW_COST_MEMBER_ABILITY_ID),
      stepId: BP4_005_SELECT_LOW_COST_MEMBER_STEP_ID,
      stepText: '请选择自己的休息室中1张费用小于等于2的成员卡加入手牌。',
      awaitingPlayerId: player.id,
      selectableCardIds,
      canSkipSelection: false,
      metadata: { orderedResolution },
      zoneSelection: createWaitingRoomToHandSelectionConfig({
        minCount: 1,
        maxCount: 1,
        optional: false,
      }),
    }),
    actionPayload: {
      sourceCardId: ability.sourceCardId,
      step: 'START_SELECT_LOW_COST_MEMBER_FROM_WAITING_ROOM',
      selectableCardIds,
    },
  });
}

function startPositionChangeIfNoHighBladeMuse(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  const sourceSlot = getSourceMemberSlot(game, player.id, ability.sourceCardId);
  if (!sourceSlot) {
    return finishPendingAbility(
      game,
      ability,
      player.id,
      orderedResolution,
      { step: 'SOURCE_NOT_ON_STAGE' },
      continuePendingCardEffects
    );
  }

  if (hasMuseStageMemberWithEffectiveBladeAtLeast(game, player.id, 5)) {
    return finishPendingAbility(
      game,
      ability,
      player.id,
      orderedResolution,
      { step: 'HAS_HIGH_BLADE_MUSE_MEMBER', sourceSlot },
      continuePendingCardEffects
    );
  }

  const selectableSlots = getSelectablePositionChangeSlots(sourceSlot);
  if (selectableSlots.length === 0) {
    return finishPendingAbility(
      game,
      ability,
      player.id,
      orderedResolution,
      { step: 'NO_POSITION_CHANGE_SLOT', sourceSlot },
      continuePendingCardEffects
    );
  }

  return startPendingActiveEffect(game, {
    ability,
    playerId: player.id,
    activeEffect: {
      id: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      controllerId: ability.controllerId,
      effectText: getAbilityEffectText(
        BP4_005_LIVE_START_POSITION_CHANGE_IF_NO_HIGH_BLADE_MUSE_ABILITY_ID
      ),
      stepId: BP4_005_SELECT_POSITION_CHANGE_SLOT_STEP_ID,
      stepText: '请选择此成员要站位变换到的 CENTER 以外区域。',
      awaitingPlayerId: player.id,
      selectableSlots,
      selectionLabel: '选择移动区域',
      confirmSelectionLabel: '站位变换',
      canSkipSelection: false,
      metadata: {
        orderedResolution,
        sourceSlot,
      },
    },
    actionPayload: {
      sourceCardId: ability.sourceCardId,
      step: 'START_SELECT_POSITION_CHANGE_SLOT',
      sourceSlot,
      selectableSlots,
    },
  });
}

function finishPositionChange(
  game: GameState,
  selectedSlot: SlotPosition | null,
  continuePendingCardEffects: ContinuePendingCardEffects,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForMemberSlotMoved
): GameState {
  const effect = game.activeEffect;
  const player = effect ? getPlayerById(game, effect.controllerId) : null;
  if (
    !effect ||
    !player ||
    effect.abilityId !== BP4_005_LIVE_START_POSITION_CHANGE_IF_NO_HIGH_BLADE_MUSE_ABILITY_ID ||
    effect.stepId !== BP4_005_SELECT_POSITION_CHANGE_SLOT_STEP_ID ||
    selectedSlot === null ||
    !isSlotPosition(selectedSlot) ||
    effect.selectableSlots?.includes(selectedSlot) !== true
  ) {
    return game;
  }

  const sourceSlot = getSlotPosition(effect.metadata?.sourceSlot);
  if (!sourceSlot || selectedSlot === sourceSlot || selectedSlot === SlotPosition.CENTER) {
    return game;
  }

  const currentSourceSlot = getSourceMemberSlot(game, player.id, effect.sourceCardId);
  if (currentSourceSlot !== sourceSlot) {
    return game;
  }

  const moveResult = moveMemberBetweenSlotsAndEnqueueTriggers(
    game,
    player.id,
    effect.sourceCardId,
    selectedSlot,
    enqueueTriggeredCardEffects,
    {
      cause: {
        kind: 'CARD_EFFECT',
        playerId: player.id,
        sourceCardId: effect.sourceCardId,
        abilityId: effect.abilityId,
        pendingAbilityId: effect.id,
      },
      prepareGameStateBeforeEnqueue: (state, result) =>
        addAction({ ...state, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
          pendingAbilityId: effect.id,
          abilityId: effect.abilityId,
          sourceCardId: effect.sourceCardId,
          step: 'POSITION_CHANGE_TO_NON_CENTER_SLOT',
          fromSlot: result.fromSlot,
          toSlot: result.toSlot,
          swappedCardId: result.swappedCardId,
        }),
    }
  );
  if (!moveResult) {
    return game;
  }

  return continuePendingCardEffects(
    moveResult.gameState,
    effect.metadata?.orderedResolution === true
  );
}

function finishPendingAbility(
  game: GameState,
  ability: PendingAbilityState,
  playerId: string,
  orderedResolution: boolean,
  payload: Readonly<Record<string, unknown>>,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  return continuePendingCardEffects(
    addAction(
      {
        ...game,
        pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
      },
      'RESOLVE_ABILITY',
      playerId,
      {
        pendingAbilityId: ability.id,
        abilityId: ability.abilityId,
        sourceCardId: ability.sourceCardId,
        ...payload,
      }
    ),
    orderedResolution
  );
}

function hasMuseStageMemberWithEffectiveBladeAtLeast(
  game: GameState,
  playerId: string,
  minBlade: number
): boolean {
  const player = getPlayerById(game, playerId);
  if (!player) {
    return false;
  }

  const liveModifiers = collectLiveModifiers(game);
  return MEMBER_SLOT_ORDER.some((slot) => {
    const cardId = player.memberSlots.slots[slot];
    if (!cardId) {
      return false;
    }
    const card = getCardById(game, cardId);
    return (
      card !== null &&
      cardBelongsToGroup(card.data, "μ's") &&
      getMemberEffectiveBladeCount(game, player.id, cardId, liveModifiers) >= minBlade
    );
  });
}

function getSelectablePositionChangeSlots(sourceSlot: SlotPosition): SlotPosition[] {
  if (sourceSlot === SlotPosition.CENTER) {
    return [SlotPosition.LEFT, SlotPosition.RIGHT];
  }
  if (sourceSlot === SlotPosition.LEFT) {
    return [SlotPosition.RIGHT];
  }
  if (sourceSlot === SlotPosition.RIGHT) {
    return [SlotPosition.LEFT];
  }
  return [];
}

function isSlotPosition(value: unknown): value is SlotPosition {
  return MEMBER_SLOT_ORDER.includes(value as SlotPosition);
}

function getSlotPosition(value: unknown): SlotPosition | null {
  return isSlotPosition(value) ? value : null;
}
