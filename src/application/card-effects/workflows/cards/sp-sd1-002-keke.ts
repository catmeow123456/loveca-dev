import { isMemberCardData } from '../../../../domain/entities/card.js';
import {
  addAction,
  getCardById,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import type {
  EnterStageEvent,
  EnterWaitingRoomEvent,
  LeaveStageEvent,
} from '../../../../domain/events/game-events.js';
import {
  costCalculator,
  canMemberBeRelayedAway,
} from '../../../../domain/rules/cost-calculator.js';
import {
  CardType,
  SlotPosition,
  TriggerCondition,
  ZoneType,
} from '../../../../shared/types/enums.js';
import { and, costLte, groupAliasIs, typeIs } from '../../../effects/card-selectors.js';
import { buildPlayMemberCostResources } from '../../../effects/play-member-cost.js';
import { SP_SD1_002_ON_ENTER_PLAY_LOW_COST_LIELLA_MEMBER_ABILITY_ID } from '../../ability-ids.js';
import { playMemberFromZoneToStageSlotWithReplacement } from '../../runtime/play-member-to-stage.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText } from '../../runtime/workflow-helpers.js';

export const SP_SD1_002_SELECT_HAND_MEMBER_STEP_ID = 'SP_SD1_002_SELECT_HAND_MEMBER';
export const SP_SD1_002_SELECT_STAGE_SLOT_STEP_ID = 'SP_SD1_002_SELECT_STAGE_SLOT';

const MEMBER_SLOT_ORDER = [SlotPosition.LEFT, SlotPosition.CENTER, SlotPosition.RIGHT] as const;
const lowCostLiellaMemberSelector = and(
  typeIs(CardType.MEMBER),
  costLte(4),
  groupAliasIs('Liella!')
);

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;
type EnqueueTriggeredCardEffects = (
  game: GameState,
  triggerConditions: readonly TriggerCondition[],
  options?: {
    readonly enterStageEvents?: readonly EnterStageEvent[];
    readonly enterWaitingRoomEvents?: readonly EnterWaitingRoomEvent[];
    readonly leaveStageEvents?: readonly LeaveStageEvent[];
  }
) => GameState;

export function registerSpSd1002KekeWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffects;
}): void {
  registerPendingAbilityStarterHandler(
    SP_SD1_002_ON_ENTER_PLAY_LOW_COST_LIELLA_MEMBER_ABILITY_ID,
    (game, ability, options, context) =>
      startSpSd1002Keke(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      )
  );
  registerActiveEffectStepHandler(
    SP_SD1_002_ON_ENTER_PLAY_LOW_COST_LIELLA_MEMBER_ABILITY_ID,
    SP_SD1_002_SELECT_HAND_MEMBER_STEP_ID,
    (game, input, context) =>
      finishHandMemberSelection(
        game,
        Object.prototype.hasOwnProperty.call(input, 'selectedCardId')
          ? (input.selectedCardId ?? null)
          : undefined,
        context.continuePendingCardEffects
      )
  );
  registerActiveEffectStepHandler(
    SP_SD1_002_ON_ENTER_PLAY_LOW_COST_LIELLA_MEMBER_ABILITY_ID,
    SP_SD1_002_SELECT_STAGE_SLOT_STEP_ID,
    (game, input, context) =>
      finishStageSlotSelection(
        game,
        input.selectedSlot ?? null,
        deps.enqueueTriggeredCardEffects,
        context.continuePendingCardEffects
      )
  );
}

function startSpSd1002Keke(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) return game;

  const selectableCardIds = getPlayableHandMemberIds(game, player.id);
  if (selectableCardIds.length === 0) {
    return finishWithoutPlaying(
      game,
      ability,
      orderedResolution,
      continuePendingCardEffects,
      'NO_LEGAL_HAND_MEMBER_AND_SLOT'
    );
  }

  return addAction(
    {
      ...game,
      pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
      activeEffect: createHandSelectionEffect(ability, selectableCardIds, orderedResolution),
    },
    'RESOLVE_ABILITY',
    player.id,
    {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: 'START_SELECT_LOW_COST_LIELLA_HAND_MEMBER',
      selectableCardIds,
      sourceSlot: ability.sourceSlot,
    }
  );
}

function finishHandMemberSelection(
  game: GameState,
  selectedCardId: string | null | undefined,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  const player = effect ? getPlayerById(game, effect.controllerId) : null;
  if (
    !effect ||
    effect.abilityId !== SP_SD1_002_ON_ENTER_PLAY_LOW_COST_LIELLA_MEMBER_ABILITY_ID ||
    effect.stepId !== SP_SD1_002_SELECT_HAND_MEMBER_STEP_ID ||
    !player ||
    selectedCardId === undefined
  ) {
    return game;
  }

  if (selectedCardId === null) {
    return continuePendingCardEffects(
      addAction({ ...game, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
        pendingAbilityId: effect.id,
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
        step: 'DECLINE_PLAY_LOW_COST_LIELLA_HAND_MEMBER',
      }),
      effect.metadata?.orderedResolution === true
    );
  }

  const selectableCardIds = getPlayableHandMemberIds(game, player.id);
  const selectionWasOffered = effect.selectableCardIds?.includes(selectedCardId) === true;
  const selectionIsCurrent = selectableCardIds.includes(selectedCardId);
  if (!selectionWasOffered || !selectionIsCurrent) {
    if (!selectionWasOffered && sameValues(effect.selectableCardIds ?? [], selectableCardIds)) {
      return game;
    }
    if (selectableCardIds.length === 0) {
      return finishActiveEffectNoOp(
        game,
        effect,
        continuePendingCardEffects,
        'NO_LEGAL_HAND_MEMBER_AFTER_REFRESH'
      );
    }
    return refreshHandSelection(game, effect, selectableCardIds);
  }

  const selectableSlots = getLegalStageSlots(game, player.id, selectedCardId);
  if (selectableSlots.length === 0) {
    return finishActiveEffectNoOp(
      game,
      effect,
      continuePendingCardEffects,
      'NO_LEGAL_STAGE_SLOT_AFTER_HAND_SELECTION'
    );
  }

  return addAction(
    {
      ...game,
      activeEffect: {
        ...effect,
        stepId: SP_SD1_002_SELECT_STAGE_SLOT_STEP_ID,
        stepText: '请选择该成员要登场的区域。',
        selectableCardIds: undefined,
        selectableCardVisibility: 'PUBLIC',
        selectableSlots,
        selectionLabel: '选择登场区域',
        confirmSelectionLabel: '登场',
        canSkipSelection: false,
        skipSelectionLabel: undefined,
        metadata: {
          ...effect.metadata,
          selectedCardId,
          selectableSlots,
        },
      },
    },
    'RESOLVE_ABILITY',
    player.id,
    {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'SELECT_LOW_COST_LIELLA_MEMBER_STAGE_SLOT',
      selectedCardId,
      selectableSlots,
    }
  );
}

function finishStageSlotSelection(
  game: GameState,
  selectedSlot: SlotPosition | null,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffects,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  const player = effect ? getPlayerById(game, effect.controllerId) : null;
  const selectedCardId = getString(effect?.metadata?.selectedCardId);
  if (
    !effect ||
    effect.abilityId !== SP_SD1_002_ON_ENTER_PLAY_LOW_COST_LIELLA_MEMBER_ABILITY_ID ||
    effect.stepId !== SP_SD1_002_SELECT_STAGE_SLOT_STEP_ID ||
    !player ||
    !selectedCardId ||
    selectedSlot === null ||
    !MEMBER_SLOT_ORDER.includes(selectedSlot)
  ) {
    return game;
  }

  const selectableCardIds = getPlayableHandMemberIds(game, player.id);
  if (!selectableCardIds.includes(selectedCardId)) {
    if (selectableCardIds.length === 0) {
      return finishActiveEffectNoOp(
        game,
        effect,
        continuePendingCardEffects,
        'SELECTED_HAND_MEMBER_BECAME_STALE'
      );
    }
    return refreshHandSelection(game, effect, selectableCardIds);
  }

  const selectableSlots = getLegalStageSlots(game, player.id, selectedCardId);
  const selectionWasOffered = effect.selectableSlots?.includes(selectedSlot) === true;
  const selectionIsCurrent = selectableSlots.includes(selectedSlot);
  if (!selectionWasOffered || !selectionIsCurrent) {
    if (!selectionWasOffered && sameValues(effect.selectableSlots ?? [], selectableSlots)) {
      return game;
    }
    if (selectableSlots.length === 0) {
      return finishActiveEffectNoOp(
        game,
        effect,
        continuePendingCardEffects,
        'NO_LEGAL_STAGE_SLOT_AFTER_REFRESH'
      );
    }
    return refreshStageSlotSelection(game, effect, selectedCardId, selectableSlots);
  }

  const playResult = playMemberFromZoneToStageSlotWithReplacement(game, player.id, {
    cardId: selectedCardId,
    sourceZone: ZoneType.HAND,
    toSlot: selectedSlot,
  });
  if (!playResult) return game;

  const state = addAction(playResult.gameState, 'RESOLVE_ABILITY', player.id, {
    pendingAbilityId: effect.id,
    abilityId: effect.abilityId,
    sourceCardId: effect.sourceCardId,
    step: 'PLAY_LOW_COST_LIELLA_HAND_MEMBER',
    playedCardId: selectedCardId,
    toSlot: selectedSlot,
    replacedMemberCardId: playResult.replacedMemberCardId,
    replacedMemberEffectiveCost: playResult.replacedMemberEffectiveCost,
    relayReplacements: playResult.enterStageEvent.relayReplacements ?? [],
  });
  const stateWithTriggers = enqueueTriggeredCardEffects(
    state,
    [
      ...(playResult.leaveStageEvents.length > 0 ? [TriggerCondition.ON_LEAVE_STAGE] : []),
      ...(playResult.enterWaitingRoomEvents.length > 0
        ? [TriggerCondition.ON_ENTER_WAITING_ROOM]
        : []),
      TriggerCondition.ON_ENTER_STAGE,
    ],
    {
      leaveStageEvents: playResult.leaveStageEvents,
      enterWaitingRoomEvents: playResult.enterWaitingRoomEvents,
      enterStageEvents: [playResult.enterStageEvent],
    }
  );

  return continuePendingCardEffects({ ...stateWithTriggers, activeEffect: null }, false);
}

function getPlayableHandMemberIds(game: GameState, playerId: string): readonly string[] {
  const player = getPlayerById(game, playerId);
  if (!player) return [];
  return player.hand.cardIds.filter((cardId) => {
    const card = getCardById(game, cardId);
    return (
      card?.ownerId === player.id &&
      lowCostLiellaMemberSelector(card) &&
      getLegalStageSlots(game, player.id, cardId).length > 0
    );
  });
}

function getLegalStageSlots(
  game: GameState,
  playerId: string,
  incomingCardId: string
): readonly SlotPosition[] {
  const player = getPlayerById(game, playerId);
  const incomingCard = getCardById(game, incomingCardId);
  const resources = buildPlayMemberCostResources(game, playerId, incomingCardId);
  if (
    !player ||
    !incomingCard ||
    incomingCard.ownerId !== player.id ||
    !isMemberCardData(incomingCard.data) ||
    !lowCostLiellaMemberSelector(incomingCard) ||
    !resources
  ) {
    return [];
  }
  const incomingMemberData = incomingCard.data;

  return costCalculator
    .getAvailableSlots(player.movedToStageThisTurn, resources.stageMembers)
    .filter((slot) => {
      const currentMember = resources.stageMembers.find((member) => member.position === slot);
      return !currentMember || canMemberBeRelayedAway(currentMember.data, incomingMemberData);
    });
}

function createHandSelectionEffect(
  ability: Pick<PendingAbilityState, 'id' | 'abilityId' | 'sourceCardId' | 'controllerId'> & {
    readonly sourceSlot?: SlotPosition;
    readonly eventIds?: readonly string[];
  },
  selectableCardIds: readonly string[],
  orderedResolution: boolean
): NonNullable<GameState['activeEffect']> {
  return {
    id: ability.id,
    abilityId: ability.abilityId,
    sourceCardId: ability.sourceCardId,
    controllerId: ability.controllerId,
    effectText: getAbilityEffectText(ability.abilityId),
    stepId: SP_SD1_002_SELECT_HAND_MEMBER_STEP_ID,
    stepText: '可以从自己的手牌选择1张费用小于等于4的『Liella!』成员卡登场到舞台。',
    awaitingPlayerId: ability.controllerId,
    selectableCardIds,
    selectableCardVisibility: 'AWAITING_PLAYER_ONLY',
    selectionLabel: '选择要登场的成员',
    confirmSelectionLabel: '选择登场区域',
    canSkipSelection: true,
    skipSelectionLabel: '不登场',
    metadata: {
      orderedResolution,
      sourceSlot: ability.sourceSlot,
      eventIds: ability.eventIds,
    },
  };
}

function refreshHandSelection(
  game: GameState,
  effect: NonNullable<GameState['activeEffect']>,
  selectableCardIds: readonly string[]
): GameState {
  return addAction(
    {
      ...game,
      activeEffect: createHandSelectionEffect(
        {
          id: effect.id,
          abilityId: effect.abilityId,
          sourceCardId: effect.sourceCardId,
          controllerId: effect.controllerId,
          sourceSlot: getSlotPosition(effect.metadata?.sourceSlot),
          eventIds: getStringArray(effect.metadata?.eventIds),
        },
        selectableCardIds,
        effect.metadata?.orderedResolution === true
      ),
    },
    'RESOLVE_ABILITY',
    effect.controllerId,
    {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'REFRESH_LOW_COST_LIELLA_HAND_MEMBER_SELECTION',
      selectableCardIds,
    }
  );
}

function refreshStageSlotSelection(
  game: GameState,
  effect: NonNullable<GameState['activeEffect']>,
  selectedCardId: string,
  selectableSlots: readonly SlotPosition[]
): GameState {
  return addAction(
    {
      ...game,
      activeEffect: {
        ...effect,
        selectableSlots,
        metadata: { ...effect.metadata, selectedCardId, selectableSlots },
      },
    },
    'RESOLVE_ABILITY',
    effect.controllerId,
    {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'REFRESH_LOW_COST_LIELLA_STAGE_SLOT_SELECTION',
      selectedCardId,
      selectableSlots,
    }
  );
}

function finishWithoutPlaying(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects,
  step: string
): GameState {
  const state = addAction(
    {
      ...game,
      pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
    },
    'RESOLVE_ABILITY',
    ability.controllerId,
    {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step,
    }
  );
  return continuePendingCardEffects(state, orderedResolution);
}

function finishActiveEffectNoOp(
  game: GameState,
  effect: NonNullable<GameState['activeEffect']>,
  continuePendingCardEffects: ContinuePendingCardEffects,
  step: string
): GameState {
  return continuePendingCardEffects(
    addAction({ ...game, activeEffect: null }, 'RESOLVE_ABILITY', effect.controllerId, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step,
    }),
    false
  );
}

function sameValues<T>(left: readonly T[], right: readonly T[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function getString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function getStringArray(value: unknown): readonly string[] {
  return Array.isArray(value)
    ? value.filter((candidate): candidate is string => typeof candidate === 'string')
    : [];
}

function getSlotPosition(value: unknown): SlotPosition | undefined {
  return MEMBER_SLOT_ORDER.includes(value as SlotPosition) ? (value as SlotPosition) : undefined;
}
