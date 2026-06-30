import { isMemberCardData } from '../../../../domain/entities/card.js';
import {
  addAction,
  getCardById,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import type { EnterStageEvent } from '../../../../domain/events/game-events.js';
import {
  CardType,
  SlotPosition,
  TriggerCondition,
  ZoneType,
} from '../../../../shared/types/enums.js';
import { and, costLte, typeIs } from '../../../effects/card-selectors.js';
import { SP_PR_020_ON_ENTER_LOW_COST_RELAY_PLAY_HAND_LOW_COST_MEMBER_ABILITY_ID } from '../../ability-ids.js';
import { getNewEnterStageEvents } from '../../runtime/events.js';
import { playMemberFromZoneToEmptySlot } from '../../runtime/play-member-to-stage.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText } from '../../runtime/workflow-helpers.js';

const SELECT_HAND_MEMBER_STEP_ID = 'SP_PR_020_SELECT_HAND_LOW_COST_MEMBER';
const SELECT_EMPTY_SLOT_STEP_ID = 'SP_PR_020_SELECT_EMPTY_SLOT';
const MEMBER_SLOT_ORDER = [SlotPosition.LEFT, SlotPosition.CENTER, SlotPosition.RIGHT] as const;

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;
type EnqueueTriggeredCardEffects = (
  game: GameState,
  triggerConditions: readonly TriggerCondition[],
  options?: {
    readonly enterStageEvents?: readonly EnterStageEvent[];
  }
) => GameState;

const lowCostMemberSelector = and(typeIs(CardType.MEMBER), costLte(4));

export function registerSpPr020KinakoWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffects;
}): void {
  registerPendingAbilityStarterHandler(
    SP_PR_020_ON_ENTER_LOW_COST_RELAY_PLAY_HAND_LOW_COST_MEMBER_ABILITY_ID,
    (game, ability, options, context) =>
      startSpPr020KinakoOnEnter(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      )
  );
  registerActiveEffectStepHandler(
    SP_PR_020_ON_ENTER_LOW_COST_RELAY_PLAY_HAND_LOW_COST_MEMBER_ABILITY_ID,
    SELECT_HAND_MEMBER_STEP_ID,
    (game, input, context) =>
      finishHandMemberSelection(
        game,
        input.selectedCardId ?? null,
        context.continuePendingCardEffects
      )
  );
  registerActiveEffectStepHandler(
    SP_PR_020_ON_ENTER_LOW_COST_RELAY_PLAY_HAND_LOW_COST_MEMBER_ABILITY_ID,
    SELECT_EMPTY_SLOT_STEP_ID,
    (game, input, context) =>
      finishPlayHandMemberToSlot(
        game,
        input.selectedSlot ?? null,
        context.continuePendingCardEffects,
        deps.enqueueTriggeredCardEffects
      )
  );
}

function startSpPr020KinakoOnEnter(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  const sourceCard = getCardById(game, ability.sourceCardId);
  if (!player || !sourceCard || !isMemberCardData(sourceCard.data)) {
    return game;
  }

  const relayCondition = getLowCostRelayCondition(
    ability.metadata?.relayReplacements,
    sourceCard.data.cost
  );
  if (!relayCondition.conditionMet) {
    return finishPendingNoOp(
      game,
      ability,
      player.id,
      orderedResolution,
      continuePendingCardEffects,
      {
        step: 'NO_OP_LOW_COST_RELAY_CONDITION_NOT_MET',
        ...relayCondition,
      }
    );
  }

  const emptySlots = getEmptyMemberSlots(game, player.id);
  const selectableCardIds = getPlayableLowCostHandMemberIds(game, player.id, ability.sourceCardId);
  if (emptySlots.length === 0 || selectableCardIds.length === 0) {
    return finishPendingNoOp(
      game,
      ability,
      player.id,
      orderedResolution,
      continuePendingCardEffects,
      {
        step:
          emptySlots.length === 0 ? 'NO_OP_NO_EMPTY_STAGE_SLOT' : 'NO_OP_NO_LOW_COST_HAND_MEMBER',
        ...relayCondition,
        emptySlots,
        selectableCardIds,
      }
    );
  }

  return addAction(
    {
      ...game,
      pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
      activeEffect: {
        id: ability.id,
        abilityId: ability.abilityId,
        sourceCardId: ability.sourceCardId,
        controllerId: player.id,
        effectText: getAbilityEffectText(ability.abilityId),
        stepId: SELECT_HAND_MEMBER_STEP_ID,
        stepText: '可以从自己的手牌选择1张费用4以下的成员卡登场到空成员区。',
        awaitingPlayerId: player.id,
        selectableCardIds,
        selectableCardVisibility: 'AWAITING_PLAYER_ONLY',
        selectionLabel: '选择要登场的低费用成员',
        confirmSelectionLabel: '选择',
        canSkipSelection: true,
        skipSelectionLabel: '不登场',
        metadata: {
          orderedResolution,
          sourceSlot: ability.sourceSlot,
          eventIds: ability.eventIds,
          relayReplacementCardIds: relayCondition.relayReplacementCardIds,
          lowCostRelayReplacementCardIds: relayCondition.lowCostRelayReplacementCardIds,
          emptySlots,
        },
      },
    },
    'RESOLVE_ABILITY',
    player.id,
    {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: 'START_SELECT_LOW_COST_HAND_MEMBER',
      sourceSlot: ability.sourceSlot,
      relayReplacementCardIds: relayCondition.relayReplacementCardIds,
      lowCostRelayReplacementCardIds: relayCondition.lowCostRelayReplacementCardIds,
      selectableCardIds,
      emptySlots,
    }
  );
}

function finishHandMemberSelection(
  game: GameState,
  selectedCardId: string | null,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  if (!effect || effect.stepId !== SELECT_HAND_MEMBER_STEP_ID) {
    return game;
  }
  const player = getPlayerById(game, effect.controllerId);
  if (!player) {
    return game;
  }

  if (selectedCardId === null) {
    return continuePendingCardEffects(
      addAction({ ...game, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
        pendingAbilityId: effect.id,
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
        step: 'DECLINE_PLAY_HAND_LOW_COST_MEMBER',
        sourceSlot: effect.metadata?.sourceSlot,
      }),
      effect.metadata?.orderedResolution === true
    );
  }

  if (
    effect.selectableCardIds?.includes(selectedCardId) !== true ||
    !isPlayableLowCostHandMember(game, player.id, selectedCardId)
  ) {
    return game;
  }

  const emptySlots = getEmptyMemberSlots(game, player.id);
  if (emptySlots.length === 0) {
    return continuePendingCardEffects(
      addAction({ ...game, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
        pendingAbilityId: effect.id,
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
        step: 'NO_OP_NO_EMPTY_STAGE_SLOT_AFTER_SELECTION',
        sourceSlot: effect.metadata?.sourceSlot,
        selectedCardId,
      }),
      effect.metadata?.orderedResolution === true
    );
  }

  return addAction(
    {
      ...game,
      activeEffect: {
        ...effect,
        stepId: SELECT_EMPTY_SLOT_STEP_ID,
        stepText: '请选择要让该成员登场的空成员区。',
        selectableCardIds: [selectedCardId],
        selectableSlots: emptySlots,
        selectionLabel: '选择空成员区',
        confirmSelectionLabel: '登场',
        canSkipSelection: false,
        skipSelectionLabel: undefined,
        metadata: {
          ...effect.metadata,
          selectedCardId,
          emptySlots,
        },
      },
    },
    'RESOLVE_ABILITY',
    player.id,
    {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'START_SELECT_EMPTY_SLOT',
      sourceSlot: effect.metadata?.sourceSlot,
      selectedCardId,
      emptySlots,
    }
  );
}

function finishPlayHandMemberToSlot(
  game: GameState,
  selectedSlot: SlotPosition | null,
  continuePendingCardEffects: ContinuePendingCardEffects,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffects
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.stepId !== SELECT_EMPTY_SLOT_STEP_ID ||
    selectedSlot === null ||
    effect.selectableSlots?.includes(selectedSlot) !== true
  ) {
    return game;
  }
  const player = getPlayerById(game, effect.controllerId);
  const selectedCardId =
    typeof effect.metadata?.selectedCardId === 'string' ? effect.metadata.selectedCardId : null;
  if (!player || !selectedCardId || !isPlayableLowCostHandMember(game, player.id, selectedCardId)) {
    return game;
  }

  const playResult = playMemberFromZoneToEmptySlot(game, player.id, {
    cardId: selectedCardId,
    sourceZone: ZoneType.HAND,
    toSlot: selectedSlot,
  });
  if (!playResult) {
    return game;
  }

  const stateWithResolve = addAction(
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
      step: 'PLAY_HAND_LOW_COST_MEMBER_TO_EMPTY_SLOT',
      sourceSlot: effect.metadata?.sourceSlot,
      selectedCardId,
      toSlot: selectedSlot,
    }
  );
  const stateWithOnEnter = enqueueTriggeredCardEffects(
    stateWithResolve,
    [TriggerCondition.ON_ENTER_STAGE],
    {
      enterStageEvents: getNewEnterStageEvents(game, playResult.gameState),
    }
  );

  return continuePendingCardEffects(stateWithOnEnter, effect.metadata?.orderedResolution === true);
}

function finishPendingNoOp(
  game: GameState,
  ability: PendingAbilityState,
  playerId: string,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects,
  payload: Readonly<Record<string, unknown>>
): GameState {
  const state = {
    ...game,
    pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
  };
  return continuePendingCardEffects(
    addAction(state, 'RESOLVE_ABILITY', playerId, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      sourceSlot: ability.sourceSlot,
      ...payload,
    }),
    orderedResolution
  );
}

function getLowCostRelayCondition(
  value: unknown,
  sourceCost: number
):
  | {
      readonly conditionMet: true;
      readonly relayReplacementCardIds: readonly string[];
      readonly lowCostRelayReplacementCardIds: readonly string[];
    }
  | {
      readonly conditionMet: false;
      readonly reason: string;
      readonly relayReplacementCardIds: readonly string[];
      readonly lowCostRelayReplacementCardIds: readonly string[];
    } {
  const relayReplacements = getRelayReplacements(value);
  const relayReplacementCardIds = relayReplacements.map((replacement) => replacement.cardId);
  const lowCostRelayReplacementCardIds = relayReplacements
    .filter((replacement) => replacement.effectiveCost < sourceCost)
    .map((replacement) => replacement.cardId);
  if (relayReplacements.length === 0) {
    return {
      conditionMet: false,
      reason: 'NOT_RELAY_ENTER',
      relayReplacementCardIds,
      lowCostRelayReplacementCardIds,
    };
  }
  if (lowCostRelayReplacementCardIds.length === 0) {
    return {
      conditionMet: false,
      reason: 'NO_LOWER_COST_RELAY_REPLACEMENT',
      relayReplacementCardIds,
      lowCostRelayReplacementCardIds,
    };
  }
  return {
    conditionMet: true,
    relayReplacementCardIds,
    lowCostRelayReplacementCardIds,
  };
}

function getRelayReplacements(value: unknown): readonly {
  readonly cardId: string;
  readonly effectiveCost: number;
}[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((entry): { readonly cardId: string; readonly effectiveCost: number }[] => {
    if (!entry || typeof entry !== 'object') {
      return [];
    }
    const cardId = (entry as { readonly cardId?: unknown }).cardId;
    const effectiveCost = (entry as { readonly effectiveCost?: unknown }).effectiveCost;
    return typeof cardId === 'string' && typeof effectiveCost === 'number'
      ? [{ cardId, effectiveCost }]
      : [];
  });
}

function getPlayableLowCostHandMemberIds(
  game: GameState,
  playerId: string,
  sourceCardId: string
): readonly string[] {
  return (
    getPlayerById(game, playerId)?.hand.cardIds.filter(
      (cardId) => cardId !== sourceCardId && isPlayableLowCostHandMember(game, playerId, cardId)
    ) ?? []
  );
}

function isPlayableLowCostHandMember(game: GameState, playerId: string, cardId: string): boolean {
  const player = getPlayerById(game, playerId);
  const card = getCardById(game, cardId);
  return (
    player?.hand.cardIds.includes(cardId) === true &&
    card !== null &&
    card.ownerId === playerId &&
    lowCostMemberSelector(card)
  );
}

function getEmptyMemberSlots(game: GameState, playerId: string): readonly SlotPosition[] {
  const player = getPlayerById(game, playerId);
  if (!player) {
    return [];
  }
  return MEMBER_SLOT_ORDER.filter((slot) => player.memberSlots.slots[slot] === null);
}
