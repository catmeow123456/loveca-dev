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
import { SP_BP4_004_ON_ENTER_DOUBLE_LIELLA_RELAY_DRAW_PLAY_LOW_COST_LIELLA_ABILITY_ID } from '../../ability-ids.js';
import { drawCardsForPlayer } from '../../runtime/actions.js';
import { getNewEnterStageEvents } from '../../runtime/events.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText } from '../../runtime/workflow-helpers.js';
import { and, costLte, groupAliasIs, typeIs } from '../../../effects/card-selectors.js';
import { getCardIdsInZoneMatching } from '../../../effects/conditions.js';
import { playMembersFromWaitingRoomToEmptySlots } from '../../../effects/member-state.js';

const MEMBER_SLOT_ORDER = [SlotPosition.LEFT, SlotPosition.CENTER, SlotPosition.RIGHT] as const;
const SUMIRE_SELECT_WAITING_ROOM_MEMBER_STEP_ID =
  'SP_BP4_004_SELECT_WAITING_ROOM_LOW_COST_LIELLA_MEMBER';
const SUMIRE_SELECT_EMPTY_STAGE_SLOT_STEP_ID = 'SP_BP4_004_SELECT_EMPTY_STAGE_SLOT';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

type EnqueueTriggeredCardEffects = (
  game: GameState,
  triggerConditions: readonly TriggerCondition[],
  options?: {
    readonly enterStageEvents?: readonly EnterStageEvent[];
  }
) => GameState;

export interface SpBp4004SumireWorkflowDependencies {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffects;
}

export function registerSpBp4004SumireWorkflowHandlers(
  dependencies: SpBp4004SumireWorkflowDependencies
): void {
  registerPendingAbilityStarterHandler(
    SP_BP4_004_ON_ENTER_DOUBLE_LIELLA_RELAY_DRAW_PLAY_LOW_COST_LIELLA_ABILITY_ID,
    (game, ability, options, context) =>
      startSpBp4004SumireOnEnter(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      )
  );
  registerActiveEffectStepHandler(
    SP_BP4_004_ON_ENTER_DOUBLE_LIELLA_RELAY_DRAW_PLAY_LOW_COST_LIELLA_ABILITY_ID,
    SUMIRE_SELECT_WAITING_ROOM_MEMBER_STEP_ID,
    (game, input) => startSpBp4004SumireSelectEmptySlot(game, input.selectedCardId ?? null)
  );
  registerActiveEffectStepHandler(
    SP_BP4_004_ON_ENTER_DOUBLE_LIELLA_RELAY_DRAW_PLAY_LOW_COST_LIELLA_ABILITY_ID,
    SUMIRE_SELECT_EMPTY_STAGE_SLOT_STEP_ID,
    (game, input, context) =>
      finishSpBp4004SumireSelectEmptySlot(
        game,
        input.selectedSlot ?? null,
        context.continuePendingCardEffects,
        dependencies
      )
  );
}

function startSpBp4004SumireOnEnter(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  const replacementCheck = getValidLiellaRelayReplacementCardIds(game, ability);
  if (!replacementCheck.conditionMet) {
    return finishWithoutActiveEffect(game, ability, player.id, orderedResolution, continuePendingCardEffects, {
      conditionMet: false,
      reason: replacementCheck.reason,
      relayReplacementCardIds: replacementCheck.relayReplacementCardIds,
    });
  }

  const stateWithoutPending: GameState = {
    ...game,
    pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
  };
  const drawResult = drawCardsForPlayer(stateWithoutPending, player.id, 2);
  if (!drawResult) {
    return game;
  }

  const selectableCardIds = getSumireWaitingRoomCandidates(drawResult.gameState, player.id);
  const emptySlots = getEmptyMemberSlots(drawResult.gameState, player.id);
  if (selectableCardIds.length === 0 || emptySlots.length === 0) {
    const noTargetReason =
      selectableCardIds.length === 0 ? 'NO_WAITING_ROOM_CANDIDATE' : 'NO_EMPTY_STAGE_SLOT';
    return continuePendingCardEffects(
      addAction(drawResult.gameState, 'RESOLVE_ABILITY', player.id, {
        pendingAbilityId: ability.id,
        abilityId: ability.abilityId,
        sourceCardId: ability.sourceCardId,
        step: 'DRAW_TWO_NO_PLAY_TARGET',
        conditionMet: true,
        relayReplacementCardIds: replacementCheck.relayReplacementCardIds,
        drawnCardIds: drawResult.drawnCardIds,
        selectableCardIds,
        emptySlots,
        noTargetReason,
      }),
      orderedResolution
    );
  }

  return addAction(
    {
      ...drawResult.gameState,
      activeEffect: {
        id: ability.id,
        abilityId: ability.abilityId,
        sourceCardId: ability.sourceCardId,
        controllerId: ability.controllerId,
        effectText: getAbilityEffectText(
          SP_BP4_004_ON_ENTER_DOUBLE_LIELLA_RELAY_DRAW_PLAY_LOW_COST_LIELLA_ABILITY_ID
        ),
        stepId: SUMIRE_SELECT_WAITING_ROOM_MEMBER_STEP_ID,
        stepText: '请选择1张费用小于等于4的『Liella!』成员卡。',
        awaitingPlayerId: player.id,
        selectableCardIds,
        selectableCardMode: 'SINGLE',
        minSelectableCards: 1,
        maxSelectableCards: 1,
        selectableCardVisibility: 'PUBLIC',
        selectionLabel: '选择要从休息室登场的成员',
        confirmSelectionLabel: '确认选择',
        canSkipSelection: false,
        metadata: {
          orderedResolution,
          conditionMet: true,
          relayReplacementCardIds: replacementCheck.relayReplacementCardIds,
          drawnCardIds: drawResult.drawnCardIds,
          selectableCardIds,
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
      step: 'DRAW_TWO_SELECT_WAITING_ROOM_MEMBER',
      conditionMet: true,
      relayReplacementCardIds: replacementCheck.relayReplacementCardIds,
      drawnCardIds: drawResult.drawnCardIds,
      selectableCardIds,
      emptySlots,
    }
  );
}

function startSpBp4004SumireSelectEmptySlot(
  game: GameState,
  selectedCardId: string | null
): GameState {
  const effect = game.activeEffect;
  if (!effect || !selectedCardId || effect.selectableCardIds?.includes(selectedCardId) !== true) {
    return game;
  }

  const player = getPlayerById(game, effect.controllerId);
  if (!player || !player.waitingRoom.cardIds.includes(selectedCardId)) {
    return game;
  }

  const emptySlots = getEmptyMemberSlots(game, player.id);
  if (emptySlots.length === 0) {
    return game;
  }

  return addAction(
    {
      ...game,
      activeEffect: {
        ...effect,
        stepId: SUMIRE_SELECT_EMPTY_STAGE_SLOT_STEP_ID,
        stepText: '请选择该成员要登场的空成员区。',
        selectableCardIds: undefined,
        selectableCardMode: undefined,
        minSelectableCards: undefined,
        maxSelectableCards: undefined,
        selectableSlots: emptySlots,
        selectionLabel: '选择登场槽位',
        confirmSelectionLabel: '登场',
        metadata: {
          ...effect.metadata,
          selectedWaitingRoomCardId: selectedCardId,
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
      step: 'SELECT_EMPTY_STAGE_SLOT',
      selectedCardId,
      emptySlots,
    }
  );
}

function finishSpBp4004SumireSelectEmptySlot(
  game: GameState,
  selectedSlot: SlotPosition | null,
  continuePendingCardEffects: ContinuePendingCardEffects,
  dependencies: SpBp4004SumireWorkflowDependencies
): GameState {
  const effect = game.activeEffect;
  if (!effect || selectedSlot === null || effect.selectableSlots?.includes(selectedSlot) !== true) {
    return game;
  }

  const player = getPlayerById(game, effect.controllerId);
  if (!player) {
    return game;
  }

  const selectedCardId =
    typeof effect.metadata?.selectedWaitingRoomCardId === 'string'
      ? effect.metadata.selectedWaitingRoomCardId
      : null;
  if (!selectedCardId || !player.waitingRoom.cardIds.includes(selectedCardId)) {
    return game;
  }

  const playResult = playMembersFromWaitingRoomToEmptySlots(
    game,
    player.id,
    [{ cardId: selectedCardId, toSlot: selectedSlot }]
  );
  if (!playResult) {
    return game;
  }

  const state = addAction(playResult.gameState, 'RESOLVE_ABILITY', player.id, {
    pendingAbilityId: effect.id,
    abilityId: effect.abilityId,
    sourceCardId: effect.sourceCardId,
    step: 'PLAY_LOW_COST_LIELLA_MEMBER_FROM_WAITING_ROOM',
    selectedCardId,
    toSlot: selectedSlot,
    relayReplacementCardIds: effect.metadata?.relayReplacementCardIds ?? [],
    drawnCardIds: effect.metadata?.drawnCardIds ?? [],
  });
  const stateWithOnEnter = dependencies.enqueueTriggeredCardEffects(
    state,
    [TriggerCondition.ON_ENTER_STAGE],
    {
      enterStageEvents: getNewEnterStageEvents(game, state),
    }
  );

  return continuePendingCardEffects(
    { ...stateWithOnEnter, activeEffect: null },
    effect.metadata?.orderedResolution === true
  );
}

function finishWithoutActiveEffect(
  game: GameState,
  ability: PendingAbilityState,
  playerId: string,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects,
  payload: Readonly<Record<string, unknown>>
): GameState {
  const state: GameState = {
    ...game,
    pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
    activeEffect: null,
  };

  return continuePendingCardEffects(
    addAction(state, 'RESOLVE_ABILITY', playerId, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: 'CHECK_DOUBLE_LIELLA_RELAY_CONDITION',
      ...payload,
    }),
    orderedResolution
  );
}

function getValidLiellaRelayReplacementCardIds(
  game: GameState,
  ability: PendingAbilityState
):
  | {
      readonly conditionMet: true;
      readonly relayReplacementCardIds: readonly string[];
    }
  | {
      readonly conditionMet: false;
      readonly reason: string;
      readonly relayReplacementCardIds: readonly string[];
    } {
  const relayReplacements = getRelayReplacementCardIds(ability.metadata?.relayReplacements);
  if (relayReplacements.length !== 2) {
    return {
      conditionMet: false,
      reason: 'NOT_DOUBLE_RELAY',
      relayReplacementCardIds: relayReplacements,
    };
  }

  const allReplacementsAreLiella = relayReplacements.every((cardId) => {
    const card = getCardById(game, cardId);
    return card !== null && isMemberCardData(card.data) && groupAliasIs('Liella!')(card);
  });
  if (!allReplacementsAreLiella) {
    return {
      conditionMet: false,
      reason: 'REPLACEMENT_NOT_LIELLA_MEMBER',
      relayReplacementCardIds: relayReplacements,
    };
  }

  return { conditionMet: true, relayReplacementCardIds: relayReplacements };
}

function getRelayReplacementCardIds(value: unknown): readonly string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((entry): string[] => {
    if (!entry || typeof entry !== 'object') {
      return [];
    }
    const cardId = (entry as { readonly cardId?: unknown }).cardId;
    return typeof cardId === 'string' ? [cardId] : [];
  });
}

function getSumireWaitingRoomCandidates(game: GameState, playerId: string): readonly string[] {
  return getCardIdsInZoneMatching(
    game,
    playerId,
    ZoneType.WAITING_ROOM,
    and(typeIs(CardType.MEMBER), costLte(4), groupAliasIs('Liella!'))
  );
}

function getEmptyMemberSlots(game: GameState, playerId: string): SlotPosition[] {
  const player = getPlayerById(game, playerId);
  if (!player) {
    return [];
  }
  return MEMBER_SLOT_ORDER.filter((slot) => player.memberSlots.slots[slot] === null);
}
