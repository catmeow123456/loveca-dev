import { isMemberCardData } from '../../../../domain/entities/card.js';
import {
  addAction,
  getCardById,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import type { EnterStageEvent } from '../../../../domain/events/game-events.js';
import { CardType, OrientationState, SlotPosition, TriggerCondition, ZoneType } from '../../../../shared/types/enums.js';
import { and, costLte, groupAliasIs, typeIs } from '../../../effects/card-selectors.js';
import { getCardIdsInZoneMatching } from '../../../effects/conditions.js';
import { playMembersFromWaitingRoomToEmptySlots } from '../../../effects/member-state.js';
import { S_SD1_006_ON_ENTER_DISCARD_PLAY_LOW_COST_AQOURS_MEMBER_ABILITY_ID } from '../../ability-ids.js';
import {
  discardOneHandCardToWaitingRoomAndEnqueueTriggers,
  type EnqueueTriggeredCardEffectsForEnterWaitingRoom,
} from '../../runtime/enter-waiting-room-triggers.js';
import { getNewEnterStageEvents } from '../../runtime/events.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText } from '../../runtime/workflow-helpers.js';

const ABILITY_ID = S_SD1_006_ON_ENTER_DISCARD_PLAY_LOW_COST_AQOURS_MEMBER_ABILITY_ID;
const SELECT_DISCARD_STEP_ID = 'S_SD1_006_SELECT_DISCARD_FOR_LOW_COST_AQOURS_PLAY';
const SELECT_WAITING_ROOM_MEMBER_STEP_ID = 'S_SD1_006_SELECT_LOW_COST_AQOURS_MEMBER_FROM_WAITING_ROOM';
const SELECT_STAGE_SLOT_STEP_ID = 'S_SD1_006_SELECT_EMPTY_STAGE_SLOT';
const MEMBER_SLOT_ORDER = [SlotPosition.LEFT, SlotPosition.CENTER, SlotPosition.RIGHT] as const;

const lowCostAqoursMemberSelector = and(
  typeIs(CardType.MEMBER),
  groupAliasIs('Aqours'),
  costLte(2)
);

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

type EnqueueTriggeredCardEffects = (
  game: GameState,
  triggerConditions: readonly TriggerCondition[],
  options?: {
    readonly enterStageEvents?: readonly EnterStageEvent[];
  }
) => GameState;

export function registerSSd1006YoshikoWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom &
    EnqueueTriggeredCardEffects;
}): void {
  registerPendingAbilityStarterHandler(ABILITY_ID, (game, ability, options, context) =>
    startSSd1006YoshikoWorkflow(
      game,
      ability,
      options.orderedResolution === true,
      context.continuePendingCardEffects
    )
  );
  registerActiveEffectStepHandler(ABILITY_ID, SELECT_DISCARD_STEP_ID, (game, input, context) =>
    input.selectedCardId
      ? finishSSd1006DiscardCost(
          game,
          input.selectedCardId,
          context.continuePendingCardEffects,
          deps.enqueueTriggeredCardEffects
        )
      : finishSSd1006WithoutPayment(
          game,
          'DECLINE_DISCARD_COST',
          context.continuePendingCardEffects
        )
  );
  registerActiveEffectStepHandler(
    ABILITY_ID,
    SELECT_WAITING_ROOM_MEMBER_STEP_ID,
    (game, input, context) =>
      startSSd1006SelectStageSlot(
        game,
        input.selectedCardId ?? null,
        context.continuePendingCardEffects
      )
  );
  registerActiveEffectStepHandler(ABILITY_ID, SELECT_STAGE_SLOT_STEP_ID, (game, input, context) =>
    finishSSd1006PlayMember(
      game,
      input.selectedSlot ?? null,
      context.continuePendingCardEffects,
      deps.enqueueTriggeredCardEffects
    )
  );
}

function startSSd1006YoshikoWorkflow(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  const emptySlots = getEmptyMemberSlots(game, ability.controllerId);
  if (!player || player.hand.cardIds.length === 0 || emptySlots.length === 0) {
    return consumePendingWithoutEffect(
      game,
      ability,
      orderedResolution,
      continuePendingCardEffects,
      !player
        ? 'PLAYER_NOT_FOUND'
        : player.hand.cardIds.length === 0
          ? 'NO_HAND_TO_DISCARD'
          : 'NO_EMPTY_STAGE_SLOT',
      { emptySlots }
    );
  }

  return {
    ...game,
    pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
    activeEffect: {
      id: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      controllerId: ability.controllerId,
      effectText: getAbilityEffectText(ABILITY_ID),
      stepId: SELECT_DISCARD_STEP_ID,
      stepText:
        '可以将1张手牌放置入休息室。如此做的话，从自己的休息室将1张费用2以下的『Aqours』成员卡登场到没有成员的区域。',
      awaitingPlayerId: player.id,
      selectableCardIds: player.hand.cardIds,
      selectableCardVisibility: 'AWAITING_PLAYER_ONLY',
      selectionLabel: '选择要放置入休息室的手牌',
      confirmSelectionLabel: '放置入休息室',
      canSkipSelection: true,
      skipSelectionLabel: '不发动',
      metadata: {
        orderedResolution,
        sourceSlot: ability.sourceSlot,
        effectCosts: [
          {
            kind: 'DISCARD_HAND_TO_WAITING_ROOM',
            minCount: 1,
            maxCount: 1,
            optional: true,
          },
        ],
        handToWaitingRoomCost: {
          minCount: 1,
          maxCount: 1,
          optional: true,
        },
      },
    },
  };
}

function finishSSd1006WithoutPayment(
  game: GameState,
  step: string,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  if (!effect || effect.abilityId !== ABILITY_ID || effect.stepId !== SELECT_DISCARD_STEP_ID) {
    return game;
  }

  return continuePendingCardEffects(
    addAction({ ...game, activeEffect: null }, 'RESOLVE_ABILITY', effect.controllerId, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      sourceSlot: effect.metadata?.sourceSlot,
      step,
    }),
    effect.metadata?.orderedResolution === true
  );
}

function finishSSd1006DiscardCost(
  game: GameState,
  selectedCardId: string,
  continuePendingCardEffects: ContinuePendingCardEffects,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom
): GameState {
  const effect = game.activeEffect;
  const player = effect ? getPlayerById(game, effect.controllerId) : null;
  if (
    !effect ||
    effect.abilityId !== ABILITY_ID ||
    effect.stepId !== SELECT_DISCARD_STEP_ID ||
    !player ||
    effect.selectableCardIds?.includes(selectedCardId) !== true
  ) {
    return game;
  }
  if (!player.hand.cardIds.includes(selectedCardId)) {
    return finishSSd1006WithoutPayment(
      game,
      'STALE_DISCARD_SELECTION',
      continuePendingCardEffects
    );
  }

  const discardResult = discardOneHandCardToWaitingRoomAndEnqueueTriggers(
    game,
    player.id,
    selectedCardId,
    {
      candidateCardIds: effect.selectableCardIds ?? [],
    },
    enqueueTriggeredCardEffects
  );
  if (!discardResult) {
    return game;
  }

  const stateAfterCost = addAction(discardResult.gameState, 'PAY_COST', player.id, {
    pendingAbilityId: effect.id,
    abilityId: effect.abilityId,
    sourceCardId: effect.sourceCardId,
    sourceSlot: effect.metadata?.sourceSlot,
    discardedHandCardIds: discardResult.discardedCardIds,
  });
  const selectableCardIds = getLowCostAqoursMemberIds(stateAfterCost, player.id);
  const emptySlots = getEmptyMemberSlots(stateAfterCost, player.id);

  if (selectableCardIds.length === 0 || emptySlots.length === 0) {
    return continuePendingCardEffects(
      addAction({ ...stateAfterCost, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
        pendingAbilityId: effect.id,
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
        sourceSlot: effect.metadata?.sourceSlot,
        step: selectableCardIds.length === 0 ? 'NO_AQOURS_MEMBER_TARGET' : 'NO_EMPTY_STAGE_SLOT',
        discardedHandCardIds: discardResult.discardedCardIds,
        selectableCardIds,
        emptySlots,
      }),
      effect.metadata?.orderedResolution === true
    );
  }

  return addAction(
    {
      ...stateAfterCost,
      activeEffect: {
        ...effect,
        stepId: SELECT_WAITING_ROOM_MEMBER_STEP_ID,
        stepText: '请选择自己休息室1张费用2以下的『Aqours』成员卡。',
        selectableCardIds,
        selectableCardMode: undefined,
        selectableSlots: undefined,
        selectionLabel: '选择要登场的成员',
        confirmSelectionLabel: '选择成员',
        canSkipSelection: false,
        skipSelectionLabel: undefined,
        metadata: {
          orderedResolution: effect.metadata?.orderedResolution === true,
          sourceSlot: effect.metadata?.sourceSlot,
          discardedHandCardIds: discardResult.discardedCardIds,
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
      step: 'PAY_COST_SELECT_LOW_COST_AQOURS_MEMBER',
      discardedHandCardIds: discardResult.discardedCardIds,
      selectableCardIds,
      emptySlots,
    }
  );
}

function startSSd1006SelectStageSlot(
  game: GameState,
  selectedCardId: string | null,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  const player = effect ? getPlayerById(game, effect.controllerId) : null;
  if (!effect || effect.abilityId !== ABILITY_ID || effect.stepId !== SELECT_WAITING_ROOM_MEMBER_STEP_ID || !player) {
    return game;
  }

  const selectableCardIds = getLowCostAqoursMemberIds(game, player.id);
  const emptySlots = getEmptyMemberSlots(game, player.id);
  if (!selectedCardId || !selectableCardIds.includes(selectedCardId) || emptySlots.length === 0) {
    return continuePendingCardEffects(
      addAction({ ...game, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
        pendingAbilityId: effect.id,
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
        sourceSlot: effect.metadata?.sourceSlot,
        step: !selectedCardId || !selectableCardIds.includes(selectedCardId)
          ? 'TARGET_LOST'
          : 'NO_EMPTY_STAGE_SLOT',
        selectedCardId,
        selectableCardIds,
        emptySlots,
        discardedHandCardIds: effect.metadata?.discardedHandCardIds,
      }),
      effect.metadata?.orderedResolution === true
    );
  }

  return addAction(
    {
      ...game,
      activeEffect: {
        ...effect,
        stepId: SELECT_STAGE_SLOT_STEP_ID,
        stepText: '请选择该成员要登场的空成员区。',
        selectableCardIds: undefined,
        selectableSlots: emptySlots,
        selectionLabel: '选择登场区域',
        confirmSelectionLabel: '登场',
        canSkipSelection: false,
        metadata: {
          ...effect.metadata,
          selectedWaitingRoomCardId: selectedCardId,
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
      step: 'SELECT_EMPTY_STAGE_SLOT',
      selectedCardId,
      emptySlots,
    }
  );
}

function finishSSd1006PlayMember(
  game: GameState,
  selectedSlot: SlotPosition | null,
  continuePendingCardEffects: ContinuePendingCardEffects,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffects
): GameState {
  const effect = game.activeEffect;
  const player = effect ? getPlayerById(game, effect.controllerId) : null;
  if (!effect || effect.abilityId !== ABILITY_ID || effect.stepId !== SELECT_STAGE_SLOT_STEP_ID || !player) {
    return game;
  }

  const selectedCardId =
    typeof effect.metadata?.selectedWaitingRoomCardId === 'string'
      ? effect.metadata.selectedWaitingRoomCardId
      : null;
  const selectableCardIds = getLowCostAqoursMemberIds(game, player.id);
  const emptySlots = getEmptyMemberSlots(game, player.id);
  if (
    !selectedCardId ||
    selectedSlot === null ||
    !selectableCardIds.includes(selectedCardId) ||
    !emptySlots.includes(selectedSlot)
  ) {
    return continuePendingCardEffects(
      addAction({ ...game, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
        pendingAbilityId: effect.id,
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
        sourceSlot: effect.metadata?.sourceSlot,
        step:
          !selectedCardId || !selectableCardIds.includes(selectedCardId)
            ? 'TARGET_LOST'
            : 'NO_EMPTY_STAGE_SLOT',
        selectedCardId,
        selectedSlot,
        selectableCardIds,
        emptySlots,
        discardedHandCardIds: effect.metadata?.discardedHandCardIds,
      }),
      effect.metadata?.orderedResolution === true
    );
  }

  const playResult = playMembersFromWaitingRoomToEmptySlots(
    game,
    player.id,
    [{ cardId: selectedCardId, toSlot: selectedSlot }],
    OrientationState.ACTIVE
  );
  if (!playResult) {
    return game;
  }

  const state = addAction(playResult.gameState, 'RESOLVE_ABILITY', player.id, {
    pendingAbilityId: effect.id,
    abilityId: effect.abilityId,
    sourceCardId: effect.sourceCardId,
    sourceSlot: effect.metadata?.sourceSlot,
    step: 'PLAY_LOW_COST_AQOURS_MEMBER_FROM_WAITING_ROOM',
    playedCardId: selectedCardId,
    toSlot: selectedSlot,
    discardedHandCardIds: effect.metadata?.discardedHandCardIds,
  });
  const stateWithOnEnter = enqueueTriggeredCardEffects(state, [TriggerCondition.ON_ENTER_STAGE], {
    enterStageEvents: getNewEnterStageEvents(game, state),
  });

  return continuePendingCardEffects(
    { ...stateWithOnEnter, activeEffect: null },
    effect.metadata?.orderedResolution === true
  );
}

function consumePendingWithoutEffect(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects,
  step: string,
  extraPayload: Readonly<Record<string, unknown>> = {}
): GameState {
  return continuePendingCardEffects(
    addAction(
      {
        ...game,
        pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
        activeEffect: null,
      },
      'RESOLVE_ABILITY',
      ability.controllerId,
      {
        pendingAbilityId: ability.id,
        abilityId: ability.abilityId,
        sourceCardId: ability.sourceCardId,
        sourceSlot: ability.sourceSlot,
        step,
        ...extraPayload,
      }
    ),
    orderedResolution
  );
}

function getLowCostAqoursMemberIds(game: GameState, playerId: string): string[] {
  return getCardIdsInZoneMatching(
    game,
    playerId,
    ZoneType.WAITING_ROOM,
    lowCostAqoursMemberSelector
  ).filter((cardId) => {
    const card = getCardById(game, cardId);
    return card?.ownerId === playerId && isMemberCardData(card.data);
  });
}

function getEmptyMemberSlots(game: GameState, playerId: string): SlotPosition[] {
  const player = getPlayerById(game, playerId);
  if (!player) {
    return [];
  }
  return MEMBER_SLOT_ORDER.filter((slot) => player.memberSlots.slots[slot] === null);
}
