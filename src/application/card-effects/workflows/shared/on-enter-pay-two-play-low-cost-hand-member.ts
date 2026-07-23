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
  MemberStateChangedEvent,
} from '../../../../domain/events/game-events.js';
import { costCalculator } from '../../../../domain/rules/cost-calculator.js';
import {
  CardType,
  OrientationState,
  SlotPosition,
  TriggerCondition,
  ZoneType,
} from '../../../../shared/types/enums.js';
import { payImmediateEffectCosts } from '../../../effects/effect-costs.js';
import { getEnergySelectionCandidates } from '../../../effects/energy-selection.js';
import { setMemberOrientation } from '../../../effects/member-state.js';
import { buildPlayMemberCostResources } from '../../../effects/play-member-cost.js';
import {
  and,
  cardNameAliasIs,
  costLte,
  groupAliasIs,
  hasBladeHeart,
  type CardSelector,
  typeIs,
} from '../../../effects/card-selectors.js';
import {
  PL_N_BP4_006_ON_ENTER_PAY_TWO_PLAY_LOW_COST_NIJIGASAKI_MEMBER_ABILITY_ID,
  PL_N_PB1_013_ON_ENTER_PAY_TWO_PLAY_LOW_COST_AYUMU_MEMBER_ABILITY_ID,
  PL_N_PB1_015_ON_ENTER_PAY_TWO_PLAY_LOW_COST_SHIZUKU_MEMBER_ABILITY_ID,
  PL_N_PB1_017_ON_ENTER_PAY_TWO_PLAY_LOW_COST_AI_MEMBER_ABILITY_ID,
  PL_N_PB1_023_ON_ENTER_PAY_TWO_PLAY_LOW_COST_MIA_TAYLOR_MEMBER_ABILITY_ID,
} from '../../ability-ids.js';
import { enqueueMemberStateChangedTriggersFromOrientationResult } from '../../runtime/member-state-changed-triggers.js';
import {
  enqueueCardEffectPlacementTriggersWithStageSnapshot,
  playMemberFromZoneToStageSlotWithReplacement,
} from '../../runtime/play-member-to-stage.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText } from '../../runtime/workflow-helpers.js';

const SELECT_HAND_MEMBER_STEP_ID = 'ON_ENTER_PAY_TWO_SELECT_LOW_COST_HAND_MEMBER';
const SELECT_STAGE_SLOT_STEP_ID = 'ON_ENTER_PAY_TWO_SELECT_STAGE_SLOT';
const ENERGY_COST = 2;

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;
type EnqueueTriggeredCardEffects = (
  game: GameState,
  triggerConditions: readonly TriggerCondition[],
  options?: {
    readonly enterStageEvents?: readonly EnterStageEvent[];
    readonly enterWaitingRoomEvents?: readonly EnterWaitingRoomEvent[];
    readonly leaveStageEvents?: readonly LeaveStageEvent[];
    readonly memberStateChangedEvents?: readonly MemberStateChangedEvent[];
  }
) => GameState;

interface WorkflowConfig {
  readonly selector: CardSelector;
  readonly targetDescription: string;
  readonly waitSourceIfPlayedMemberHasBladeHeart: boolean;
}

const CONFIGS: Readonly<Record<string, WorkflowConfig>> = {
  [PL_N_BP4_006_ON_ENTER_PAY_TWO_PLAY_LOW_COST_NIJIGASAKI_MEMBER_ABILITY_ID]: {
    selector: and(typeIs(CardType.MEMBER), costLte(4), groupAliasIs('虹ヶ咲')),
    targetDescription: '费用4以下的『虹ヶ咲』成员',
    waitSourceIfPlayedMemberHasBladeHeart: true,
  },
  [PL_N_PB1_013_ON_ENTER_PAY_TWO_PLAY_LOW_COST_AYUMU_MEMBER_ABILITY_ID]: {
    selector: and(typeIs(CardType.MEMBER), costLte(4), cardNameAliasIs('上原歩夢')),
    targetDescription: '费用4以下的「上原步梦」成员',
    waitSourceIfPlayedMemberHasBladeHeart: false,
  },
  [PL_N_PB1_015_ON_ENTER_PAY_TWO_PLAY_LOW_COST_SHIZUKU_MEMBER_ABILITY_ID]: {
    selector: and(typeIs(CardType.MEMBER), costLte(4), cardNameAliasIs('桜坂しずく')),
    targetDescription: '费用4以下的「樱坂雫」成员',
    waitSourceIfPlayedMemberHasBladeHeart: false,
  },
  [PL_N_PB1_017_ON_ENTER_PAY_TWO_PLAY_LOW_COST_AI_MEMBER_ABILITY_ID]: {
    selector: and(typeIs(CardType.MEMBER), costLte(4), cardNameAliasIs('宮下愛')),
    targetDescription: '费用4以下的「宫下爱」成员',
    waitSourceIfPlayedMemberHasBladeHeart: false,
  },
  [PL_N_PB1_023_ON_ENTER_PAY_TWO_PLAY_LOW_COST_MIA_TAYLOR_MEMBER_ABILITY_ID]: {
    selector: and(typeIs(CardType.MEMBER), costLte(4), cardNameAliasIs('ミア・テイラー')),
    targetDescription: '费用4以下的「米娅·泰勒」成员',
    waitSourceIfPlayedMemberHasBladeHeart: false,
  },
};

export function registerOnEnterPayTwoPlayLowCostHandMemberWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffects;
}): void {
  for (const abilityId of Object.keys(CONFIGS)) {
    registerPendingAbilityStarterHandler(abilityId, (game, ability, options, context) =>
      startOnEnterPayTwoPlayLowCostHandMember(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      )
    );
    registerActiveEffectStepHandler(abilityId, SELECT_HAND_MEMBER_STEP_ID, (game, input, context) =>
      finishHandMemberSelection(
        game,
        input.selectedCardId ?? null,
        context.continuePendingCardEffects
      )
    );
    registerActiveEffectStepHandler(abilityId, SELECT_STAGE_SLOT_STEP_ID, (game, input, context) =>
      finishPlayHandMemberToSlot(
        game,
        input.selectedSlot ?? null,
        context.continuePendingCardEffects,
        deps.enqueueTriggeredCardEffects
      )
    );
  }
}

function startOnEnterPayTwoPlayLowCostHandMember(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const config = CONFIGS[ability.abilityId];
  const player = getPlayerById(game, ability.controllerId);
  const sourceCard = getCardById(game, ability.sourceCardId);
  if (!config || !player || !sourceCard || !isMemberCardData(sourceCard.data)) {
    return game;
  }

  const selectableCardIds = getPlayableLowCostHandMemberIds(
    game,
    player.id,
    ability.sourceCardId,
    config.selector
  );
  const canPayEnergy =
    getEnergySelectionCandidates(game, player.id, 'TAP_ACTIVE_ENERGY').length >= ENERGY_COST;
  if (selectableCardIds.length === 0 || !canPayEnergy) {
    return finishPendingNoOp(
      game,
      ability,
      player.id,
      orderedResolution,
      continuePendingCardEffects,
      {
        step: !canPayEnergy
          ? 'NO_OP_ENERGY_COST_UNPAYABLE'
          : 'NO_OP_NO_LOW_COST_HAND_MEMBER_OR_LEGAL_STAGE_SLOT',
        selectableCardIds,
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
        stepText: `可以支付[E][E]，从自己的手牌选择1张${config.targetDescription}登场至舞台。`,
        awaitingPlayerId: player.id,
        selectableCardIds,
        selectableCardVisibility: 'AWAITING_PLAYER_ONLY',
        selectionLabel: '选择要登场的指定成员',
        confirmSelectionLabel: '登场',
        canSkipSelection: true,
        skipSelectionLabel: '不发动',
        metadata: {
          orderedResolution,
          sourceSlot: ability.sourceSlot,
          eventIds: ability.eventIds,
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
      step: 'START_SELECT_LOW_COST_HAND_MEMBER',
      selectableCardIds,
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
  const config = effect ? CONFIGS[effect.abilityId] : undefined;
  if (!effect || !config || effect.stepId !== SELECT_HAND_MEMBER_STEP_ID) {
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
        step: 'DECLINE_PLAY_LOW_COST_HAND_MEMBER',
      }),
      effect.metadata?.orderedResolution === true
    );
  }

  if (
    effect.selectableCardIds?.includes(selectedCardId) !== true ||
    !isPlayableLowCostHandMember(
      game,
      player.id,
      selectedCardId,
      effect.sourceCardId,
      config.selector
    )
  ) {
    return game;
  }

  const selectableSlots = getLegalStageSlots(game, player.id, selectedCardId);
  if (selectableSlots.length === 0) {
    return continuePendingCardEffects(
      addAction({ ...game, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
        pendingAbilityId: effect.id,
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
        sourceSlot: effect.metadata?.sourceSlot,
        step: 'NO_OP_NO_LEGAL_STAGE_SLOT_AFTER_SELECTION',
        selectedCardId,
        selectableSlots,
      }),
      effect.metadata?.orderedResolution === true
    );
  }
  const energyPayment = payImmediateEffectCosts(game, player.id, effect.sourceCardId, [
    { kind: 'TAP_ACTIVE_ENERGY', count: ENERGY_COST },
  ]);
  if (!energyPayment) {
    return continuePendingCardEffects(
      addAction({ ...game, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
        pendingAbilityId: effect.id,
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
        sourceSlot: effect.metadata?.sourceSlot,
        step: 'NO_OP_ENERGY_COST_UNPAYABLE_AFTER_SELECTION',
        selectedCardId,
        selectableSlots,
      }),
      effect.metadata?.orderedResolution === true
    );
  }

  return addAction(
    {
      ...energyPayment.gameState,
      activeEffect: {
        ...effect,
        stepId: SELECT_STAGE_SLOT_STEP_ID,
        stepText: '请选择该成员要登场的区域。',
        selectableCardIds: undefined,
        selectableCardVisibility: undefined,
        selectableSlots,
        selectionLabel: '选择登场区域',
        confirmSelectionLabel: '登场',
        canSkipSelection: false,
        skipSelectionLabel: undefined,
        metadata: {
          ...effect.metadata,
          selectedCardId,
          selectableSlots,
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
      step: 'PAY_TWO_ENERGY_SELECT_STAGE_SLOT',
      paidEnergyCardIds: energyPayment.paidEnergyCardIds,
      selectedCardId,
      selectableSlots,
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
  const config = effect ? CONFIGS[effect.abilityId] : undefined;
  if (
    !effect ||
    !config ||
    effect.stepId !== SELECT_STAGE_SLOT_STEP_ID ||
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
    !isPlayableLowCostHandMember(
      game,
      player.id,
      selectedCardId,
      effect.sourceCardId,
      config.selector
    )
  ) {
    return game;
  }

  const selectableSlots = getLegalStageSlots(game, player.id, selectedCardId);
  if (!selectableSlots.includes(selectedSlot)) {
    return game;
  }

  const playResult = playMemberFromZoneToStageSlotWithReplacement(game, player.id, {
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
      step: 'PLAY_LOW_COST_HAND_MEMBER_TO_STAGE_SLOT',
      selectedCardId,
      toSlot: selectedSlot,
      duplicateMemberRuleRemovedCardId: playResult.duplicateMemberRuleRemovedCardId,
      paidEnergyCardIds: getStringArrayMetadata(effect.metadata?.paidEnergyCardIds),
    }
  );
  const stateWithOnEnter = enqueueCardEffectPlacementTriggersWithStageSnapshot(
    game,
    stateWithResolve,
    playResult,
    enqueueTriggeredCardEffects
  );

  const playedCard = getCardById(stateWithOnEnter, selectedCardId);
  const sourceState = getPlayerById(stateWithOnEnter, player.id)?.memberSlots.cardStates.get(
    effect.sourceCardId
  );
  if (
    !config.waitSourceIfPlayedMemberHasBladeHeart ||
    !playedCard ||
    !hasBladeHeart()(playedCard) ||
    sourceState?.orientation === OrientationState.WAITING
  ) {
    return continuePendingCardEffects(
      stateWithOnEnter,
      effect.metadata?.orderedResolution === true
    );
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
    return continuePendingCardEffects(
      stateWithOnEnter,
      effect.metadata?.orderedResolution === true
    );
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

function getPlayableLowCostHandMemberIds(
  game: GameState,
  playerId: string,
  sourceCardId: string,
  selector: CardSelector
): readonly string[] {
  return (
    getPlayerById(game, playerId)?.hand.cardIds.filter(
      (cardId) =>
        isPlayableLowCostHandMember(game, playerId, cardId, sourceCardId, selector) &&
        getLegalStageSlots(game, playerId, cardId).length > 0
    ) ?? []
  );
}

function isPlayableLowCostHandMember(
  game: GameState,
  playerId: string,
  cardId: string,
  sourceCardId: string,
  selector: CardSelector
): boolean {
  const player = getPlayerById(game, playerId);
  const card = getCardById(game, cardId);
  return (
    cardId !== sourceCardId &&
    player?.hand.cardIds.includes(cardId) === true &&
    card !== null &&
    card.ownerId === playerId &&
    selector(card)
  );
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
    !resources
  ) {
    return [];
  }
  return costCalculator.getAvailableSlots(player.movedToStageThisTurn, resources.stageMembers);
}

function getStringArrayMetadata(value: unknown): readonly string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : [];
}
