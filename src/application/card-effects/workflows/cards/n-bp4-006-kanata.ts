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
  MemberStateChangedEvent,
} from '../../../../domain/events/game-events.js';
import {
  CardType,
  OrientationState,
  SlotPosition,
  TriggerCondition,
  ZoneType,
} from '../../../../shared/types/enums.js';
import { payImmediateEffectCosts } from '../../../effects/effect-costs.js';
import { setMemberOrientation } from '../../../effects/member-state.js';
import { and, costLte, groupAliasIs, hasBladeHeart, typeIs } from '../../../effects/card-selectors.js';
import { PL_N_BP4_006_ON_ENTER_PAY_TWO_PLAY_LOW_COST_NIJIGASAKI_MEMBER_ABILITY_ID } from '../../ability-ids.js';
import { getNewEnterStageEvents } from '../../runtime/events.js';
import { enqueueMemberStateChangedTriggersFromOrientationResult } from '../../runtime/member-state-changed-triggers.js';
import { playMemberFromZoneToEmptySlot } from '../../runtime/play-member-to-stage.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText } from '../../runtime/workflow-helpers.js';

const SELECT_HAND_MEMBER_STEP_ID = 'N_BP4_006_SELECT_HAND_NIJIGASAKI_MEMBER';
const SELECT_EMPTY_SLOT_STEP_ID = 'N_BP4_006_SELECT_EMPTY_SLOT';
const ENERGY_COST = 2;
const MEMBER_SLOT_ORDER = [SlotPosition.LEFT, SlotPosition.CENTER, SlotPosition.RIGHT] as const;

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;
type EnqueueTriggeredCardEffects = (
  game: GameState,
  triggerConditions: readonly TriggerCondition[],
  options?: {
    readonly enterStageEvents?: readonly EnterStageEvent[];
    readonly memberStateChangedEvents?: readonly MemberStateChangedEvent[];
  }
) => GameState;

const lowCostNijigasakiMember = and(typeIs(CardType.MEMBER), costLte(4), groupAliasIs('虹ヶ咲'));

export function registerNBp4006KanataWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffects;
}): void {
  registerPendingAbilityStarterHandler(
    PL_N_BP4_006_ON_ENTER_PAY_TWO_PLAY_LOW_COST_NIJIGASAKI_MEMBER_ABILITY_ID,
    (game, ability, options, context) =>
      startNBp4006KanataOnEnter(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      )
  );
  registerActiveEffectStepHandler(
    PL_N_BP4_006_ON_ENTER_PAY_TWO_PLAY_LOW_COST_NIJIGASAKI_MEMBER_ABILITY_ID,
    SELECT_HAND_MEMBER_STEP_ID,
    (game, input, context) =>
      finishHandMemberSelection(
        game,
        input.selectedCardId ?? null,
        context.continuePendingCardEffects
      )
  );
  registerActiveEffectStepHandler(
    PL_N_BP4_006_ON_ENTER_PAY_TWO_PLAY_LOW_COST_NIJIGASAKI_MEMBER_ABILITY_ID,
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

function startNBp4006KanataOnEnter(
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

  const emptySlots = getEmptyMemberSlots(game, player.id);
  const selectableCardIds = getPlayableLowCostNijigasakiHandMemberIds(
    game,
    player.id,
    ability.sourceCardId
  );
  const canPayEnergy =
    payImmediateEffectCosts(game, player.id, ability.sourceCardId, [
      { kind: 'TAP_ACTIVE_ENERGY', count: ENERGY_COST },
    ]) !== null;
  if (emptySlots.length === 0 || selectableCardIds.length === 0 || !canPayEnergy) {
    return finishPendingNoOp(
      game,
      ability,
      player.id,
      orderedResolution,
      continuePendingCardEffects,
      {
        step: !canPayEnergy
          ? 'NO_OP_ENERGY_COST_UNPAYABLE'
          : emptySlots.length === 0
            ? 'NO_OP_NO_EMPTY_STAGE_SLOT'
            : 'NO_OP_NO_LOW_COST_NIJIGASAKI_HAND_MEMBER',
        selectableCardIds,
        emptySlots,
        energyCost: ENERGY_COST,
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
        stepText:
          '可以支付[E][E]，从自己的手牌选择1张费用4以下的「虹ヶ咲」成员登场到空成员区。',
        awaitingPlayerId: player.id,
        selectableCardIds,
        selectableCardVisibility: 'AWAITING_PLAYER_ONLY',
        selectionLabel: '选择要登场的虹咲成员',
        confirmSelectionLabel: '选择',
        canSkipSelection: true,
        skipSelectionLabel: '不发动',
        metadata: {
          orderedResolution,
          sourceSlot: ability.sourceSlot,
          eventIds: ability.eventIds,
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
      sourceSlot: ability.sourceSlot,
      step: 'START_SELECT_LOW_COST_NIJIGASAKI_HAND_MEMBER',
      selectableCardIds,
      emptySlots,
      energyCost: ENERGY_COST,
    }
  );
}

function finishHandMemberSelection(
  game: GameState,
  selectedCardId: string | null,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !== PL_N_BP4_006_ON_ENTER_PAY_TWO_PLAY_LOW_COST_NIJIGASAKI_MEMBER_ABILITY_ID ||
    effect.stepId !== SELECT_HAND_MEMBER_STEP_ID
  ) {
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
        sourceSlot: effect.metadata?.sourceSlot,
        step: 'DECLINE_PLAY_LOW_COST_NIJIGASAKI_HAND_MEMBER',
      }),
      effect.metadata?.orderedResolution === true
    );
  }

  if (
    effect.selectableCardIds?.includes(selectedCardId) !== true ||
    !isPlayableLowCostNijigasakiHandMember(game, player.id, selectedCardId, effect.sourceCardId)
  ) {
    return game;
  }

  const emptySlots = getEmptyMemberSlots(game, player.id);
  const energyPayment = payImmediateEffectCosts(game, player.id, effect.sourceCardId, [
    { kind: 'TAP_ACTIVE_ENERGY', count: ENERGY_COST },
  ]);
  if (!energyPayment || emptySlots.length === 0) {
    return continuePendingCardEffects(
      addAction({ ...game, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
        pendingAbilityId: effect.id,
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
        sourceSlot: effect.metadata?.sourceSlot,
        step: !energyPayment
          ? 'NO_OP_ENERGY_COST_UNPAYABLE_AFTER_SELECTION'
          : 'NO_OP_NO_EMPTY_STAGE_SLOT_AFTER_SELECTION',
        selectedCardId,
        emptySlots,
      }),
      effect.metadata?.orderedResolution === true
    );
  }

  return addAction(
    {
      ...energyPayment.gameState,
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
          paidEnergyCardIds: energyPayment.paidEnergyCardIds,
        },
      },
    },
    'PAY_COST',
    player.id,
    {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      sourceSlot: effect.metadata?.sourceSlot,
      step: 'PAY_TWO_ENERGY_SELECT_EMPTY_SLOT',
      paidEnergyCardIds: energyPayment.paidEnergyCardIds,
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
    effect.abilityId !== PL_N_BP4_006_ON_ENTER_PAY_TWO_PLAY_LOW_COST_NIJIGASAKI_MEMBER_ABILITY_ID ||
    effect.stepId !== SELECT_EMPTY_SLOT_STEP_ID ||
    selectedSlot === null ||
    effect.selectableSlots?.includes(selectedSlot) !== true
  ) {
    return game;
  }
  const player = getPlayerById(game, effect.controllerId);
  const selectedCardId =
    typeof effect.metadata?.selectedCardId === 'string' ? effect.metadata.selectedCardId : null;
  if (
    !player ||
    !selectedCardId ||
    !isPlayableLowCostNijigasakiHandMember(game, player.id, selectedCardId, effect.sourceCardId)
  ) {
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
      sourceSlot: effect.metadata?.sourceSlot,
      step: 'PLAY_LOW_COST_NIJIGASAKI_HAND_MEMBER_TO_EMPTY_SLOT',
      selectedCardId,
      toSlot: selectedSlot,
      paidEnergyCardIds: getStringArrayMetadata(effect.metadata?.paidEnergyCardIds),
    }
  );
  const stateWithOnEnter = enqueueTriggeredCardEffects(
    stateWithResolve,
    [TriggerCondition.ON_ENTER_STAGE],
    {
      enterStageEvents: getNewEnterStageEvents(game, playResult.gameState),
    }
  );

  const playedCard = getCardById(stateWithOnEnter, selectedCardId);
  const sourceState = getPlayerById(stateWithOnEnter, player.id)?.memberSlots.cardStates.get(
    effect.sourceCardId
  );
  if (!playedCard || !hasBladeHeart()(playedCard) || sourceState?.orientation === OrientationState.WAITING) {
    return continuePendingCardEffects(stateWithOnEnter, effect.metadata?.orderedResolution === true);
  }

  const waitResult = setMemberOrientation(
    stateWithOnEnter,
    player.id,
    effect.sourceCardId,
    OrientationState.WAITING,
    {
      kind: 'CARD_EFFECT',
      playerId: player.id,
      sourceCardId: effect.sourceCardId,
      abilityId: effect.abilityId,
    }
  );
  if (!waitResult) {
    return continuePendingCardEffects(stateWithOnEnter, effect.metadata?.orderedResolution === true);
  }

  const stateWithMemberStateTriggers = enqueueMemberStateChangedTriggersFromOrientationResult(
    stateWithOnEnter,
    waitResult,
    enqueueTriggeredCardEffects,
    {
      prepareGameStateBeforeEnqueue: (stateAfterWait, result, memberStateChangedEvents) =>
        addAction(stateAfterWait, 'RESOLVE_ABILITY', player.id, {
          pendingAbilityId: effect.id,
          abilityId: effect.abilityId,
          sourceCardId: effect.sourceCardId,
          sourceSlot: effect.metadata?.sourceSlot,
          step: 'WAIT_SOURCE_FOR_BLADE_HEART_MEMBER',
          playedMemberCardId: selectedCardId,
          previousOrientation: result.previousOrientation,
          nextOrientation: result.nextOrientation,
          memberStateChangedEventIds: memberStateChangedEvents.map((event) => event.eventId),
        }),
    }
  );

  return continuePendingCardEffects(
    stateWithMemberStateTriggers.gameState,
    effect.metadata?.orderedResolution === true
  );
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

function getPlayableLowCostNijigasakiHandMemberIds(
  game: GameState,
  playerId: string,
  sourceCardId: string
): readonly string[] {
  return (
    getPlayerById(game, playerId)?.hand.cardIds.filter((cardId) =>
      isPlayableLowCostNijigasakiHandMember(game, playerId, cardId, sourceCardId)
    ) ?? []
  );
}

function isPlayableLowCostNijigasakiHandMember(
  game: GameState,
  playerId: string,
  cardId: string,
  sourceCardId: string
): boolean {
  const player = getPlayerById(game, playerId);
  const card = getCardById(game, cardId);
  return (
    cardId !== sourceCardId &&
    player?.hand.cardIds.includes(cardId) === true &&
    card !== null &&
    card.ownerId === playerId &&
    lowCostNijigasakiMember(card)
  );
}

function getEmptyMemberSlots(game: GameState, playerId: string): readonly SlotPosition[] {
  const player = getPlayerById(game, playerId);
  if (!player) {
    return [];
  }
  return MEMBER_SLOT_ORDER.filter((slot) => player.memberSlots.slots[slot] === null);
}

function getStringArrayMetadata(value: unknown): readonly string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : [];
}
