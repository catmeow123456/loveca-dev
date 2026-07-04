import { isMemberCardData, type CardInstance } from '../../../../domain/entities/card.js';
import {
  addAction,
  getCardById,
  getOpponent,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import type { CheerEvent } from '../../../../domain/events/game-events.js';
import {
  addHeartLiveModifierForMember,
} from '../../../../domain/rules/live-modifiers.js';
import {
  CardType,
  GamePhase,
  HeartColor,
  OrientationState,
  TriggerCondition,
} from '../../../../shared/types/enums.js';
import { cardCodeMatchesBase } from '../../../../shared/utils/card-code.js';
import { getCardGroupIdentityKeys } from '../../../../shared/utils/card-identity.js';
import { payImmediateEffectCosts } from '../../../effects/effect-costs.js';
import { setMemberOrientation } from '../../../effects/member-state.js';
import { and, costLte, typeIs } from '../../../effects/card-selectors.js';
import { getStageMemberCardIdsMatching } from '../../../effects/stage-targets.js';
import {
  BP5_004_ACTIVATED_STAGE_GROUP_DYNAMIC_COST_WAIT_OPPONENT_COST_TEN_ABILITY_ID,
  BP5_004_AUTO_ON_CHEER_NO_BLADE_MEMBER_THREE_GAIN_ALL_HEART_ABILITY_ID,
} from '../../ability-ids.js';
import { registerActivatedAbilityHandler } from '../../runtime/activated-registry.js';
import {
  enqueueMemberStateChangedTriggersFromOrientationResult,
  type EnqueueTriggeredCardEffectsForMemberStateChanged,
} from '../../runtime/member-state-changed-triggers.js';
import { getSourceMemberSlot } from '../../runtime/source-member.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import {
  getAbilityEffectText,
  recordAbilityUseForContext,
  recordPayCostAction,
} from '../../runtime/workflow-helpers.js';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;
type EnqueueTriggeredCardEffects = EnqueueTriggeredCardEffectsForMemberStateChanged;

const ACTIVATED_SELECT_OPPONENT_STEP_ID = 'BP5_004_SELECT_OPPONENT_COST_TEN_MEMBER_TO_WAIT';
const BASE_ENERGY_COST = 4;

const opponentCostTenMemberSelector = and(typeIs(CardType.MEMBER), costLte(10));

export function registerBp5004UmiWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffects;
}): void {
  registerActivatedAbilityHandler(
    BP5_004_ACTIVATED_STAGE_GROUP_DYNAMIC_COST_WAIT_OPPONENT_COST_TEN_ABILITY_ID,
    (game, playerId, cardId) => startBp5004UmiActivated(game, playerId, cardId)
  );
  registerActiveEffectStepHandler(
    BP5_004_ACTIVATED_STAGE_GROUP_DYNAMIC_COST_WAIT_OPPONENT_COST_TEN_ABILITY_ID,
    ACTIVATED_SELECT_OPPONENT_STEP_ID,
    (game, input, context) =>
      finishBp5004UmiActivatedOpponentWait(
        game,
        input.selectedCardId ?? null,
        context.continuePendingCardEffects,
        deps.enqueueTriggeredCardEffects
      )
  );
  registerPendingAbilityStarterHandler(
    BP5_004_AUTO_ON_CHEER_NO_BLADE_MEMBER_THREE_GAIN_ALL_HEART_ABILITY_ID,
    (game, ability, options, context) =>
      resolveBp5004UmiOnCheer(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      )
  );
}

function startBp5004UmiActivated(game: GameState, playerId: string, cardId: string): GameState {
  if (game.activeEffect || game.currentPhase !== GamePhase.MAIN_PHASE) {
    return game;
  }

  const activePlayerId = game.players[game.activePlayerIndex]?.id ?? null;
  const player = getPlayerById(game, playerId);
  const sourceCard = getCardById(game, cardId);
  const opponent = player ? getOpponent(game, player.id) : null;
  const sourceSlot = getSourceMemberSlot(game, playerId, cardId);
  if (
    activePlayerId !== playerId ||
    !player ||
    !opponent ||
    !sourceCard ||
    sourceCard.ownerId !== playerId ||
    !isMemberCardData(sourceCard.data) ||
    !cardCodeMatchesBase(sourceCard.data.cardCode, 'PL!-bp5-004') ||
    sourceSlot === null
  ) {
    return game;
  }

  const stageGroupKeys = getOwnStageGroupIdentityKeys(game, player.id);
  const energyCost = Math.max(0, BASE_ENERGY_COST - stageGroupKeys.length);
  const costPayment = payImmediateEffectCosts(game, player.id, cardId, [
    { kind: 'TAP_ACTIVE_ENERGY', count: energyCost },
  ]);
  if (!costPayment) {
    return game;
  }

  const stateAfterCost = recordPayCostAction(costPayment.gameState, player.id, {
    abilityId: BP5_004_ACTIVATED_STAGE_GROUP_DYNAMIC_COST_WAIT_OPPONENT_COST_TEN_ABILITY_ID,
    sourceCardId: cardId,
    energyCardIds: costPayment.paidEnergyCardIds,
    amount: costPayment.paidEnergyCardIds.length,
    baseEnergyCost: BASE_ENERGY_COST,
    stageGroupCount: stageGroupKeys.length,
    stageGroupKeys,
    reducedEnergyCost: energyCost,
  });
  const selectableCardIds = getOpponentCostTenActiveMemberIds(stateAfterCost, opponent.id);

  if (selectableCardIds.length === 0) {
    return addAction(stateAfterCost, 'RESOLVE_ABILITY', player.id, {
      abilityId: BP5_004_ACTIVATED_STAGE_GROUP_DYNAMIC_COST_WAIT_OPPONENT_COST_TEN_ABILITY_ID,
      sourceCardId: cardId,
      step: 'NO_OPPONENT_COST_TEN_TARGET_AFTER_COST',
      sourceSlot,
      targetPlayerId: opponent.id,
      paidEnergyCardIds: costPayment.paidEnergyCardIds,
      baseEnergyCost: BASE_ENERGY_COST,
      stageGroupCount: stageGroupKeys.length,
      stageGroupKeys,
      reducedEnergyCost: energyCost,
    });
  }

  return addAction(
    {
      ...stateAfterCost,
      activeEffect: {
        id: `${BP5_004_ACTIVATED_STAGE_GROUP_DYNAMIC_COST_WAIT_OPPONENT_COST_TEN_ABILITY_ID}:${cardId}:turn-${stateAfterCost.turnCount}:action-${stateAfterCost.actionHistory.length}`,
        abilityId: BP5_004_ACTIVATED_STAGE_GROUP_DYNAMIC_COST_WAIT_OPPONENT_COST_TEN_ABILITY_ID,
        sourceCardId: cardId,
        controllerId: player.id,
        effectText: getAbilityEffectText(
          BP5_004_ACTIVATED_STAGE_GROUP_DYNAMIC_COST_WAIT_OPPONENT_COST_TEN_ABILITY_ID
        ),
        stepId: ACTIVATED_SELECT_OPPONENT_STEP_ID,
        stepText: '请选择对方舞台上1名费用小于等于10且当前非待机的成员变为待机状态。',
        awaitingPlayerId: player.id,
        selectableCardIds,
        selectionLabel: '选择对方舞台上费用小于等于10的成员',
        confirmSelectionLabel: '变为待机',
        metadata: {
          sourceSlot,
          targetPlayerId: opponent.id,
          paidEnergyCardIds: costPayment.paidEnergyCardIds,
          baseEnergyCost: BASE_ENERGY_COST,
          stageGroupCount: stageGroupKeys.length,
          stageGroupKeys,
          reducedEnergyCost: energyCost,
        },
      },
    },
    'RESOLVE_ABILITY',
    player.id,
    {
      abilityId: BP5_004_ACTIVATED_STAGE_GROUP_DYNAMIC_COST_WAIT_OPPONENT_COST_TEN_ABILITY_ID,
      sourceCardId: cardId,
      step: 'PAY_DYNAMIC_COST_SELECT_OPPONENT_COST_TEN_MEMBER',
      sourceSlot,
      targetPlayerId: opponent.id,
      paidEnergyCardIds: costPayment.paidEnergyCardIds,
      selectableCardIds,
      baseEnergyCost: BASE_ENERGY_COST,
      stageGroupCount: stageGroupKeys.length,
      stageGroupKeys,
      reducedEnergyCost: energyCost,
    }
  );
}

function finishBp5004UmiActivatedOpponentWait(
  game: GameState,
  selectedCardId: string | null,
  continuePendingCardEffects: ContinuePendingCardEffects,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffects
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !==
      BP5_004_ACTIVATED_STAGE_GROUP_DYNAMIC_COST_WAIT_OPPONENT_COST_TEN_ABILITY_ID ||
    effect.stepId !== ACTIVATED_SELECT_OPPONENT_STEP_ID ||
    selectedCardId === null ||
    effect.selectableCardIds?.includes(selectedCardId) !== true
  ) {
    return game;
  }

  const player = getPlayerById(game, effect.controllerId);
  const targetPlayerId =
    typeof effect.metadata?.targetPlayerId === 'string' ? effect.metadata.targetPlayerId : null;
  if (
    !player ||
    !targetPlayerId ||
    !getOpponentCostTenActiveMemberIds(game, targetPlayerId).includes(selectedCardId)
  ) {
    return game;
  }

  const orientationChange = setMemberOrientation(
    game,
    targetPlayerId,
    selectedCardId,
    OrientationState.WAITING,
    {
      kind: 'CARD_EFFECT',
      playerId: player.id,
      sourceCardId: effect.sourceCardId,
      abilityId: effect.abilityId,
      pendingAbilityId: effect.id,
    }
  );
  if (!orientationChange) {
    return game;
  }

  const stateWithTriggers = enqueueMemberStateChangedTriggersFromOrientationResult(
    game,
    orientationChange,
    enqueueTriggeredCardEffects,
    {
      prepareGameStateBeforeEnqueue: (state, result) =>
        addAction(
          {
            ...state,
            activeEffect: null,
          },
          'RESOLVE_ABILITY',
          player.id,
          {
            pendingAbilityId: effect.id,
            abilityId: effect.abilityId,
            sourceCardId: effect.sourceCardId,
            step: 'WAIT_OPPONENT_COST_TEN_MEMBER',
            sourceSlot: effect.metadata?.sourceSlot,
            targetPlayerId,
            targetCardId: selectedCardId,
            paidEnergyCardIds: getStringArrayMetadata(effect.metadata?.paidEnergyCardIds),
            baseEnergyCost: effect.metadata?.baseEnergyCost,
            stageGroupCount: effect.metadata?.stageGroupCount,
            stageGroupKeys: getStringArrayMetadata(effect.metadata?.stageGroupKeys),
            reducedEnergyCost: effect.metadata?.reducedEnergyCost,
            previousOrientation: result.previousOrientation,
            nextOrientation: result.nextOrientation,
          }
        ),
    }
  );

  return continuePendingCardEffects(stateWithTriggers.gameState, false);
}

function resolveBp5004UmiOnCheer(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  const sourceSlot = player ? getSourceMemberSlot(game, player.id, ability.sourceCardId) : null;
  if (!player || sourceSlot === null) {
    return skipPendingAbility(
      game,
      ability,
      ability.controllerId,
      orderedResolution,
      continuePendingCardEffects,
      'SOURCE_NOT_ON_STAGE',
      false
    );
  }

  const cheerEvent = getOwnCheerEventForAbility(game, ability, player.id);
  if (!cheerEvent) {
    return skipPendingAbility(
      game,
      ability,
      player.id,
      orderedResolution,
      continuePendingCardEffects,
      'NO_MATCHING_OWN_CHEER_EVENT',
      false
    );
  }

  const noBladeHeartMemberCardIds = getOwnNoBladeHeartMemberIdsFromCheerEvent(
    game,
    player.id,
    cheerEvent
  );
  const conditionMet = noBladeHeartMemberCardIds.length >= 3;
  let state = removePendingAbility(game, ability.id);
  state = recordAbilityUseForContext(state, player.id, {
    abilityId: ability.abilityId,
    sourceCardId: ability.sourceCardId,
  });

  const heartResult = conditionMet
    ? addHeartLiveModifierForMember(state, {
        playerId: player.id,
        memberCardId: ability.sourceCardId,
        sourceCardId: ability.sourceCardId,
        abilityId: ability.abilityId,
        hearts: [{ color: HeartColor.RAINBOW, count: 1 }],
      })
    : null;
  const stateAfterHeart = heartResult?.gameState ?? state;

  return continuePendingCardEffects(
    addAction(stateAfterHeart, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      sourceSlot,
      step: 'COUNT_NO_BLADE_HEART_MEMBERS_FROM_CHEER',
      cheerEventId: cheerEvent.eventId,
      revealedCardIds: cheerEvent.revealedCardIds,
      noBladeHeartMemberCardIds,
      noBladeHeartMemberCount: noBladeHeartMemberCardIds.length,
      conditionMet,
      heartBonus: heartResult?.heartBonus ?? [],
    }),
    orderedResolution
  );
}

function getOpponentCostTenActiveMemberIds(
  game: GameState,
  opponentId: string
): readonly string[] {
  const opponent = getPlayerById(game, opponentId);
  return getStageMemberCardIdsMatching(game, opponentId, opponentCostTenMemberSelector).filter(
    (cardId) =>
      opponent?.memberSlots.cardStates.get(cardId)?.orientation !== OrientationState.WAITING
  );
}

function getOwnStageGroupIdentityKeys(game: GameState, playerId: string): readonly string[] {
  const groupKeys = new Set<string>();
  for (const cardId of getStageMemberCardIdsMatching(game, playerId, typeIs(CardType.MEMBER))) {
    const card = getCardById(game, cardId);
    if (!card || !isMemberCardData(card.data)) {
      continue;
    }
    for (const groupKey of getCardGroupIdentityKeys(card.data)) {
      groupKeys.add(groupKey);
    }
  }
  return [...groupKeys].sort();
}

function getOwnCheerEventForAbility(
  game: GameState,
  ability: PendingAbilityState,
  playerId: string
): CheerEvent | null {
  const eventIds = new Set(ability.eventIds);
  const events = game.eventLog
    .map((entry) => entry.event)
    .filter(
      (event): event is CheerEvent =>
        event.eventType === TriggerCondition.ON_CHEER &&
        'playerId' in event &&
        'additional' in event &&
        event.playerId === playerId &&
        event.additional !== true &&
        eventIds.has(event.eventId)
    );
  return events.at(-1) ?? null;
}

function getOwnNoBladeHeartMemberIdsFromCheerEvent(
  game: GameState,
  playerId: string,
  cheerEvent: CheerEvent
): readonly string[] {
  return cheerEvent.revealedCardIds.filter((cardId) => {
    const card = getCardById(game, cardId);
    return (
      card?.ownerId === playerId &&
      isMemberCardData(card.data) &&
      ((card.data.bladeHearts?.length ?? 0) === 0)
    );
  });
}

function skipPendingAbility(
  game: GameState,
  ability: PendingAbilityState,
  playerId: string,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects,
  step: string,
  recordTurnUse: boolean
): GameState {
  let state = removePendingAbility(game, ability.id);
  if (recordTurnUse) {
    state = recordAbilityUseForContext(state, playerId, {
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
    });
  }
  return continuePendingCardEffects(
    addAction(state, 'RESOLVE_ABILITY', playerId, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      sourceSlot: ability.sourceSlot,
      step,
    }),
    orderedResolution
  );
}

function removePendingAbility(game: GameState, pendingAbilityId: string): GameState {
  return {
    ...game,
    pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== pendingAbilityId),
  };
}

function getStringArrayMetadata(value: unknown): readonly string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
}
