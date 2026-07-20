import {
  addAction,
  getPlayerById,
  type GameState,
  type LiveModifierState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import type { EnterStageEvent } from '../../../../domain/events/game-events.js';
import {
  CardType,
  HeartColor,
  OrientationState,
  SlotPosition,
  TriggerCondition,
  ZoneType,
} from '../../../../shared/types/enums.js';
import { and, costLte, typeIs, unitAliasIs } from '../../../effects/card-selectors.js';
import { getCardIdsInZoneMatching, getMemberEffectiveCost } from '../../../effects/conditions.js';
import { payImmediateEffectCosts } from '../../../effects/effect-costs.js';
import { playMembersFromWaitingRoomToEmptySlots } from '../../../effects/member-state.js';
import { getStageMemberCardIdsMatching } from '../../../effects/stage-targets.js';
import { replaceLiveModifier } from '../../../../domain/rules/live-modifiers.js';
import { HS_BP5_022_LIVE_START_PAY_TWO_ENERGY_HIGH_COST_EDELNOTE_PLAY_LOW_COST_OR_REDUCE_PURPLE_REQUIREMENT_ABILITY_ID } from '../../ability-ids.js';
import {
  finishSkippedActiveEffect,
  startPendingActiveEffect,
} from '../../runtime/active-effect.js';
import { getNewEnterStageEvents } from '../../runtime/events.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText, recordPayCostAction } from '../../runtime/workflow-helpers.js';

const PAY_ENERGY_STEP_ID = 'HS_BP5_022_PAY_TWO_ENERGY';
const SELECT_MODE_STEP_ID = 'HS_BP5_022_SELECT_RETROFUTURE_MODE';
const SELECT_WAITING_ROOM_MEMBER_STEP_ID = 'HS_BP5_022_SELECT_LOW_COST_EDELNOTE_FROM_WAITING_ROOM';
const SELECT_EMPTY_STAGE_SLOT_STEP_ID = 'HS_BP5_022_SELECT_EMPTY_STAGE_SLOT';

const PAY_OPTION_ID = 'pay';
const DECLINE_OPTION_ID = 'decline';
const PLAY_MEMBER_MODE_OPTION_ID = 'play-low-cost-edelnote-member';
const REDUCE_REQUIREMENT_MODE_OPTION_ID = 'reduce-purple-requirement';
const MEMBER_SLOT_ORDER = [SlotPosition.LEFT, SlotPosition.CENTER, SlotPosition.RIGHT] as const;

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

type EnqueueTriggeredCardEffects = (
  game: GameState,
  triggerConditions: readonly TriggerCondition[],
  options?: {
    readonly enterStageEvents?: readonly EnterStageEvent[];
  }
) => GameState;

export function registerHsBp5022RetrofutureWorkflowHandlers(dependencies: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffects;
}): void {
  registerPendingAbilityStarterHandler(
    HS_BP5_022_LIVE_START_PAY_TWO_ENERGY_HIGH_COST_EDELNOTE_PLAY_LOW_COST_OR_REDUCE_PURPLE_REQUIREMENT_ABILITY_ID,
    (game, ability, options) =>
      startRetrofuturePayEnergyOption(game, ability, options.orderedResolution === true)
  );
  registerActiveEffectStepHandler(
    HS_BP5_022_LIVE_START_PAY_TWO_ENERGY_HIGH_COST_EDELNOTE_PLAY_LOW_COST_OR_REDUCE_PURPLE_REQUIREMENT_ABILITY_ID,
    PAY_ENERGY_STEP_ID,
    (game, input, context) =>
      input.selectedOptionId === PAY_OPTION_ID
        ? finishRetrofuturePayEnergy(game, context.continuePendingCardEffects)
        : finishSkippedActiveEffect(game, context.continuePendingCardEffects)
  );
  registerActiveEffectStepHandler(
    HS_BP5_022_LIVE_START_PAY_TWO_ENERGY_HIGH_COST_EDELNOTE_PLAY_LOW_COST_OR_REDUCE_PURPLE_REQUIREMENT_ABILITY_ID,
    SELECT_MODE_STEP_ID,
    (game, input, context) =>
      finishRetrofutureModeSelection(
        game,
        input.selectedOptionId ?? null,
        context.continuePendingCardEffects
      )
  );
  registerActiveEffectStepHandler(
    HS_BP5_022_LIVE_START_PAY_TWO_ENERGY_HIGH_COST_EDELNOTE_PLAY_LOW_COST_OR_REDUCE_PURPLE_REQUIREMENT_ABILITY_ID,
    SELECT_WAITING_ROOM_MEMBER_STEP_ID,
    (game, input, context) =>
      selectRetrofutureWaitingRoomMember(
        game,
        input.selectedCardId ?? null,
        context.continuePendingCardEffects
      )
  );
  registerActiveEffectStepHandler(
    HS_BP5_022_LIVE_START_PAY_TWO_ENERGY_HIGH_COST_EDELNOTE_PLAY_LOW_COST_OR_REDUCE_PURPLE_REQUIREMENT_ABILITY_ID,
    SELECT_EMPTY_STAGE_SLOT_STEP_ID,
    (game, input, context) =>
      finishRetrofuturePlayMember(
        game,
        input.selectedSlot ?? null,
        context.continuePendingCardEffects,
        dependencies.enqueueTriggeredCardEffects
      )
  );
}

function startRetrofuturePayEnergyOption(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  const activeEnergyCardIds = getActiveEnergyCardIds(player);
  const canPay = activeEnergyCardIds.length >= 2;

  return startPendingActiveEffect(game, {
    ability,
    playerId: player.id,
    activeEffect: {
      id: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      controllerId: ability.controllerId,
      effectText: getAbilityEffectText(ability.abilityId),
      stepId: PAY_ENERGY_STEP_ID,
      stepText: canPay ? '可以支付[E][E]发动此效果。' : '当前活跃能量不足，无法支付[E][E]，可以不发动。',
      awaitingPlayerId: player.id,
      selectableOptions: canPay
        ? [
            { id: PAY_OPTION_ID, label: '支付[E][E]' },
            { id: DECLINE_OPTION_ID, label: '不发动' },
          ]
        : [{ id: DECLINE_OPTION_ID, label: '不发动' }],
      metadata: {
        orderedResolution,
        activeEnergyCardIds,
        energyCostCount: 2,
      },
    },
    actionPayload: {
      sourceCardId: ability.sourceCardId,
      step: 'START_PAY_TWO_ENERGY_OPTION',
      activeEnergyCardIds,
    },
  });
}

function finishRetrofuturePayEnergy(
  game: GameState,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !==
      HS_BP5_022_LIVE_START_PAY_TWO_ENERGY_HIGH_COST_EDELNOTE_PLAY_LOW_COST_OR_REDUCE_PURPLE_REQUIREMENT_ABILITY_ID ||
    effect.stepId !== PAY_ENERGY_STEP_ID
  ) {
    return game;
  }

  const player = getPlayerById(game, effect.controllerId);
  if (!player) {
    return game;
  }

  const costPayment = payImmediateEffectCosts(game, player.id, effect.sourceCardId, [
    { kind: 'TAP_ACTIVE_ENERGY', count: 2 },
  ]);
  if (!costPayment) {
    return game;
  }

  let state = recordPayCostAction(costPayment.gameState, player.id, {
    pendingAbilityId: effect.id,
    abilityId: effect.abilityId,
    sourceCardId: effect.sourceCardId,
    energyCardIds: costPayment.paidEnergyCardIds,
    amount: costPayment.paidEnergyCardIds.length,
  });

  const highCostEdelNoteMemberIds = getHighCostEdelNoteStageMemberIds(state, player.id);
  if (highCostEdelNoteMemberIds.length === 0) {
    return continuePendingCardEffects(
      addAction({ ...state, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
        pendingAbilityId: effect.id,
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
        step: 'PAY_COST_NO_HIGH_COST_EDELNOTE_MEMBER',
        paidEnergyCardIds: costPayment.paidEnergyCardIds,
      }),
      effect.metadata?.orderedResolution === true
    );
  }

  const waitingRoomCandidateIds = getLowCostEdelNoteWaitingRoomMemberIds(state, player.id);
  const emptySlots = getEmptyMemberSlots(state, player.id);
  const modeOptions = getModeOptions(waitingRoomCandidateIds, emptySlots);

  state = addAction(
    {
      ...state,
      activeEffect: {
        ...effect,
        stepId: SELECT_MODE_STEP_ID,
        stepText:
          modeOptions.length > 1
            ? '请选择要执行的效果。'
            : '当前无法从休息室登场成员，可以选择减少此LIVE的紫色必要Heart。',
        selectableOptions: modeOptions,
        effectChoice: {
          mode: 'SINGLE',
          options: [
            {
              id: PLAY_MEMBER_MODE_OPTION_ID,
              text: '从自己的休息室将1张费用小于等于4的『EdelNote』成员卡登场到自己舞台的空成员区。',
              selectable: modeOptions.some((option) => option.id === PLAY_MEMBER_MODE_OPTION_ID),
            },
            {
              id: REDUCE_REQUIREMENT_MODE_OPTION_ID,
              text: '此LIVE成功所需的[紫ハート]减少1。',
              selectable: true,
            },
          ],
          minSelections: 1,
          maxSelections: 1,
          publicConfirmation: true,
        },
        selectableCardIds: undefined,
        selectableCardVisibility: undefined,
        selectableSlots: undefined,
        selectableCardMode: undefined,
        minSelectableCards: undefined,
        maxSelectableCards: undefined,
        canSkipSelection: false,
        skipSelectionLabel: undefined,
        selectionLabel: undefined,
        confirmSelectionLabel: undefined,
        numericInput: undefined,
        metadata: {
          ...effect.metadata,
          paidEnergyCardIds: costPayment.paidEnergyCardIds,
          highCostEdelNoteMemberIds,
          waitingRoomCandidateIds,
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
      step: 'PAY_COST_SELECT_RETROFUTURE_MODE',
      paidEnergyCardIds: costPayment.paidEnergyCardIds,
      highCostEdelNoteMemberIds,
      waitingRoomCandidateIds,
      emptySlots,
      modeOptionIds: modeOptions.map((option) => option.id),
    }
  );

  return state;
}

function finishRetrofutureModeSelection(
  game: GameState,
  selectedOptionId: string | null,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !==
      HS_BP5_022_LIVE_START_PAY_TWO_ENERGY_HIGH_COST_EDELNOTE_PLAY_LOW_COST_OR_REDUCE_PURPLE_REQUIREMENT_ABILITY_ID ||
    effect.stepId !== SELECT_MODE_STEP_ID ||
    selectedOptionId === null ||
    effect.selectableOptions?.some((option) => option.id === selectedOptionId) !== true
  ) {
    return game;
  }

  if (selectedOptionId === REDUCE_REQUIREMENT_MODE_OPTION_ID) {
    return finishRetrofutureReduceRequirement(game, continuePendingCardEffects);
  }

  if (selectedOptionId !== PLAY_MEMBER_MODE_OPTION_ID) {
    return game;
  }

  const player = getPlayerById(game, effect.controllerId);
  if (!player) {
    return game;
  }

  const waitingRoomCandidateIds = getLowCostEdelNoteWaitingRoomMemberIds(game, player.id);
  const emptySlots = getEmptyMemberSlots(game, player.id);
  if (waitingRoomCandidateIds.length === 0 || emptySlots.length === 0) {
    return game;
  }

  return addAction(
    {
      ...game,
      activeEffect: {
        ...effect,
        stepId: SELECT_WAITING_ROOM_MEMBER_STEP_ID,
        stepText: '请选择自己休息室中1张费用4以下的EdelNote成员卡。',
        effectChoice: undefined,
        selectableOptions: undefined,
        selectableCardIds: waitingRoomCandidateIds,
        selectableCardVisibility: 'PUBLIC',
        selectableSlots: undefined,
        selectableCardMode: undefined,
        canSkipSelection: false,
        skipSelectionLabel: undefined,
        selectionLabel: '选择要登场的休息室成员',
        confirmSelectionLabel: '选择登场区域',
        metadata: {
          ...effect.metadata,
          waitingRoomCandidateIds,
          emptySlots,
          selectedMode: PLAY_MEMBER_MODE_OPTION_ID,
        },
      },
    },
    'RESOLVE_ABILITY',
    player.id,
    {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'SELECT_PLAY_LOW_COST_EDELNOTE_MODE',
      waitingRoomCandidateIds,
      emptySlots,
    }
  );
}

function finishRetrofutureReduceRequirement(
  game: GameState,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  if (!effect) {
    return game;
  }
  const player = getPlayerById(game, effect.controllerId);
  if (!player) {
    return game;
  }

  const modifier: LiveModifierState = {
    kind: 'REQUIREMENT',
    liveCardId: effect.sourceCardId,
    modifiers: [{ color: HeartColor.PURPLE, countDelta: -1 }],
    sourceCardId: effect.sourceCardId,
    abilityId: effect.abilityId,
  };
  const state = replaceLiveModifier(
    game,
    {
      kind: 'REQUIREMENT',
      liveCardId: effect.sourceCardId,
      sourceCardId: effect.sourceCardId,
      abilityId: effect.abilityId,
    },
    modifier
  );

  return continuePendingCardEffects(
    addAction({ ...state, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'REDUCE_PURPLE_REQUIREMENT',
      requirementReduction: { color: HeartColor.PURPLE, countDelta: -1 },
    }),
    effect.metadata?.orderedResolution === true
  );
}

function selectRetrofutureWaitingRoomMember(
  game: GameState,
  selectedCardId: string | null,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !==
      HS_BP5_022_LIVE_START_PAY_TWO_ENERGY_HIGH_COST_EDELNOTE_PLAY_LOW_COST_OR_REDUCE_PURPLE_REQUIREMENT_ABILITY_ID ||
    effect.stepId !== SELECT_WAITING_ROOM_MEMBER_STEP_ID ||
    selectedCardId === null ||
    effect.selectableCardIds?.includes(selectedCardId) !== true
  ) {
    return game;
  }

  const player = getPlayerById(game, effect.controllerId);
  if (
    !player ||
    !getLowCostEdelNoteWaitingRoomMemberIds(game, player.id).includes(selectedCardId)
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
        step: 'NO_EMPTY_SLOT_AFTER_WAITING_ROOM_MEMBER_SELECTION',
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
        stepId: SELECT_EMPTY_STAGE_SLOT_STEP_ID,
        stepText: '请选择该成员要登场的空成员区。',
        selectableCardIds: undefined,
        selectableCardVisibility: undefined,
        selectableSlots: emptySlots,
        selectableCardMode: undefined,
        canSkipSelection: false,
        skipSelectionLabel: undefined,
        selectionLabel: '选择登场区域',
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
      step: 'SELECT_LOW_COST_EDELNOTE_FROM_WAITING_ROOM',
      selectedCardId,
      emptySlots,
    }
  );
}

function finishRetrofuturePlayMember(
  game: GameState,
  selectedSlot: SlotPosition | null,
  continuePendingCardEffects: ContinuePendingCardEffects,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffects
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !==
      HS_BP5_022_LIVE_START_PAY_TWO_ENERGY_HIGH_COST_EDELNOTE_PLAY_LOW_COST_OR_REDUCE_PURPLE_REQUIREMENT_ABILITY_ID ||
    effect.stepId !== SELECT_EMPTY_STAGE_SLOT_STEP_ID ||
    selectedSlot === null ||
    effect.selectableSlots?.includes(selectedSlot) !== true
  ) {
    return game;
  }

  const player = getPlayerById(game, effect.controllerId);
  const selectedCardId =
    typeof effect.metadata?.selectedWaitingRoomCardId === 'string'
      ? effect.metadata.selectedWaitingRoomCardId
      : null;
  if (
    !player ||
    selectedCardId === null ||
    !getLowCostEdelNoteWaitingRoomMemberIds(game, player.id).includes(selectedCardId) ||
    !getEmptyMemberSlots(game, player.id).includes(selectedSlot)
  ) {
    return game;
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

  const stateAfterPlayAction = addAction(playResult.gameState, 'RESOLVE_ABILITY', player.id, {
    pendingAbilityId: effect.id,
    abilityId: effect.abilityId,
    sourceCardId: effect.sourceCardId,
    step: 'PLAY_LOW_COST_EDELNOTE_FROM_WAITING_ROOM',
    playedCardId: selectedCardId,
    toSlot: selectedSlot,
  });
  const stateWithOnEnter = enqueueTriggeredCardEffects(
    stateAfterPlayAction,
    [TriggerCondition.ON_ENTER_STAGE],
    {
      enterStageEvents: getNewEnterStageEvents(game, stateAfterPlayAction),
    }
  );

  return continuePendingCardEffects(
    { ...stateWithOnEnter, activeEffect: null },
    effect.metadata?.orderedResolution === true
  );
}

function getModeOptions(
  waitingRoomCandidateIds: readonly string[],
  emptySlots: readonly SlotPosition[]
): readonly { readonly id: string; readonly label: string }[] {
  const options: { readonly id: string; readonly label: string }[] = [];
  if (waitingRoomCandidateIds.length > 0 && emptySlots.length > 0) {
    options.push({
      id: PLAY_MEMBER_MODE_OPTION_ID,
      label: '休息室EdelNote成员登场',
    });
  }
  options.push({
    id: REDUCE_REQUIREMENT_MODE_OPTION_ID,
    label: '减少紫色必要Heart',
  });
  return options;
}

function getHighCostEdelNoteStageMemberIds(game: GameState, playerId: string): readonly string[] {
  return getStageMemberCardIdsMatching(
    game,
    playerId,
    and(typeIs(CardType.MEMBER), unitAliasIs('EdelNote'))
  ).filter((cardId) => getMemberEffectiveCost(game, playerId, cardId) >= 9);
}

function getLowCostEdelNoteWaitingRoomMemberIds(
  game: GameState,
  playerId: string
): readonly string[] {
  return getCardIdsInZoneMatching(
    game,
    playerId,
    ZoneType.WAITING_ROOM,
    and(typeIs(CardType.MEMBER), unitAliasIs('EdelNote'), costLte(4))
  );
}

function getEmptyMemberSlots(game: GameState, playerId: string): SlotPosition[] {
  const player = getPlayerById(game, playerId);
  if (!player) {
    return [];
  }
  return MEMBER_SLOT_ORDER.filter((slot) => player.memberSlots.slots[slot] === null);
}

function getActiveEnergyCardIds(
  player: NonNullable<ReturnType<typeof getPlayerById>>
): readonly string[] {
  return player.energyZone.cardIds.filter(
    (cardId) => player.energyZone.cardStates.get(cardId)?.orientation !== OrientationState.WAITING
  );
}
