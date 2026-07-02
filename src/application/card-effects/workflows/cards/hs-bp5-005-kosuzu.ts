import { isMemberCardData } from '../../../../domain/entities/card.js';
import {
  addAction,
  getCardById,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import {
  addHeartLiveModifierForMember,
  addMemberCostSetLiveModifierForMember,
} from '../../../../domain/rules/live-modifiers.js';
import { CardType, HeartColor, SlotPosition } from '../../../../shared/types/enums.js';
import { and, typeIs, unitAliasIs } from '../../../effects/card-selectors.js';
import { getMemberEffectiveCost } from '../../../effects/conditions.js';
import { HS_BP5_005_LIVE_START_DISCARD_DOLLCHESTRA_SET_COST_GAIN_BLUE_HEART_ABILITY_ID } from '../../ability-ids.js';
import {
  createOptionalDiscardHandToWaitingRoomActiveEffect,
  finishSkippedActiveEffect,
  startPendingActiveEffect,
} from '../../runtime/active-effect.js';
import {
  discardOneHandCardToWaitingRoomAndEnqueueTriggers,
  type EnqueueTriggeredCardEffectsForEnterWaitingRoom,
} from '../../runtime/enter-waiting-room-triggers.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText } from '../../runtime/workflow-helpers.js';

export const HS_BP5_005_SELECT_DOLLCHESTRA_DISCARD_STEP_ID =
  'HS_BP5_005_SELECT_DOLLCHESTRA_DISCARD';
export const HS_BP5_005_SELECT_DOLLCHESTRA_COST_SOURCE_STEP_ID =
  'HS_BP5_005_SELECT_DOLLCHESTRA_COST_SOURCE';

const dollchestraCard = unitAliasIs('DOLLCHESTRA');
const dollchestraMember = and(typeIs(CardType.MEMBER), dollchestraCard);
const MEMBER_SLOT_ORDER = [SlotPosition.LEFT, SlotPosition.CENTER, SlotPosition.RIGHT] as const;

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerHsBp5005KosuzuWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom;
}): void {
  registerPendingAbilityStarterHandler(
    HS_BP5_005_LIVE_START_DISCARD_DOLLCHESTRA_SET_COST_GAIN_BLUE_HEART_ABILITY_ID,
    (game, ability, options, context) =>
      startHsBp5005KosuzuLiveStart(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      )
  );
  registerActiveEffectStepHandler(
    HS_BP5_005_LIVE_START_DISCARD_DOLLCHESTRA_SET_COST_GAIN_BLUE_HEART_ABILITY_ID,
    HS_BP5_005_SELECT_DOLLCHESTRA_DISCARD_STEP_ID,
    (game, input, context) =>
      input.selectedCardId
        ? startHsBp5005KosuzuTargetSelection(
            game,
            input.selectedCardId,
            context.continuePendingCardEffects,
            deps.enqueueTriggeredCardEffects
          )
        : finishSkippedActiveEffect(game, context.continuePendingCardEffects)
  );
  registerActiveEffectStepHandler(
    HS_BP5_005_LIVE_START_DISCARD_DOLLCHESTRA_SET_COST_GAIN_BLUE_HEART_ABILITY_ID,
    HS_BP5_005_SELECT_DOLLCHESTRA_COST_SOURCE_STEP_ID,
    (game, input, context) =>
      finishHsBp5005KosuzuTargetSelection(
        game,
        input.selectedCardId ?? null,
        context.continuePendingCardEffects
      )
  );
}

function startHsBp5005KosuzuLiveStart(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return finishPendingAbility(
      game,
      ability,
      ability.controllerId,
      orderedResolution,
      { step: 'NO_OP_DOLLCHESTRA_DISCARD_SET_COST', reason: 'CONTROLLER_NOT_FOUND' },
      continuePendingCardEffects
    );
  }

  const sourceOnStage = Object.values(player.memberSlots.slots).includes(ability.sourceCardId);
  const selectableCardIds = player.hand.cardIds.filter((cardId) => {
    const card = getCardById(game, cardId);
    return card !== null && dollchestraCard(card);
  });
  if (!sourceOnStage || selectableCardIds.length === 0) {
    return finishPendingAbility(
      game,
      ability,
      player.id,
      orderedResolution,
      {
        step: 'NO_OP_DOLLCHESTRA_DISCARD_SET_COST',
        reason: !sourceOnStage ? 'SOURCE_NOT_ON_STAGE' : 'NO_DOLLCHESTRA_HAND_COST',
        selectableCardIds,
      },
      continuePendingCardEffects
    );
  }

  return startPendingActiveEffect(game, {
    ability,
    playerId: player.id,
    activeEffect: createOptionalDiscardHandToWaitingRoomActiveEffect({
      ability,
      playerId: player.id,
      effectText: getAbilityEffectText(ability.abilityId),
      stepId: HS_BP5_005_SELECT_DOLLCHESTRA_DISCARD_STEP_ID,
      selectableCardIds,
      orderedResolution,
      stepText: '可以将手牌中的1张『DOLLCHESTRA』卡放置入休息室。',
      selectionLabel: '选择要放置入休息室的DOLLCHESTRA卡',
      metadata: {
        sourceSlot: ability.sourceSlot,
      },
    }),
    actionPayload: {
      sourceCardId: ability.sourceCardId,
      step: 'START_SELECT_DOLLCHESTRA_DISCARD_FOR_SET_COST',
      sourceSlot: ability.sourceSlot,
      selectableCardIds,
    },
  });
}

function startHsBp5005KosuzuTargetSelection(
  game: GameState,
  discardCardId: string,
  continuePendingCardEffects: ContinuePendingCardEffects,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !==
      HS_BP5_005_LIVE_START_DISCARD_DOLLCHESTRA_SET_COST_GAIN_BLUE_HEART_ABILITY_ID ||
    effect.stepId !== HS_BP5_005_SELECT_DOLLCHESTRA_DISCARD_STEP_ID ||
    effect.selectableCardIds?.includes(discardCardId) !== true
  ) {
    return game;
  }

  const player = getPlayerById(game, effect.controllerId);
  if (!player || !player.hand.cardIds.includes(discardCardId)) {
    return game;
  }

  const discardResult = discardOneHandCardToWaitingRoomAndEnqueueTriggers(
    game,
    player.id,
    discardCardId,
    { candidateCardIds: effect.selectableCardIds ?? [] },
    enqueueTriggeredCardEffects
  );
  if (!discardResult) {
    return game;
  }

  const stateAfterDiscard = discardResult.gameState;
  const selectableCardIds = getOwnStageMemberIdsMatching(
    stateAfterDiscard,
    player.id,
    dollchestraMember
  );
  if (selectableCardIds.length === 0) {
    return finishActiveEffect(
      {
        ...stateAfterDiscard,
        activeEffect: effect,
      },
      continuePendingCardEffects,
      {
        step: 'DISCARD_NO_DOLLCHESTRA_STAGE_TARGET',
        sourceSlot: effect.metadata?.sourceSlot,
        discardedCardId: discardResult.discardedCardIds[0],
      }
    );
  }

  return addAction(
    {
      ...stateAfterDiscard,
      activeEffect: {
        ...effect,
        stepId: HS_BP5_005_SELECT_DOLLCHESTRA_COST_SOURCE_STEP_ID,
        stepText:
          '请选择自己舞台上的1名『DOLLCHESTRA』成员。此成员的原本费用将决定来源成员费用。',
        selectableCardIds,
        selectableCardVisibility: 'PUBLIC',
        selectableCardMode: 'SINGLE',
        selectionLabel: '选择费用参照成员',
        confirmSelectionLabel: '确定',
        canSkipSelection: false,
        skipSelectionLabel: undefined,
        metadata: {
          ...effect.metadata,
          discardedCardId: discardResult.discardedCardIds[0],
        },
      },
    },
    'RESOLVE_ABILITY',
    player.id,
    {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'DISCARD_SELECT_DOLLCHESTRA_COST_SOURCE',
      sourceSlot: effect.metadata?.sourceSlot,
      discardedCardId: discardResult.discardedCardIds[0],
      selectableCardIds,
    }
  );
}

function finishHsBp5005KosuzuTargetSelection(
  game: GameState,
  selectedCardId: string | null,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !==
      HS_BP5_005_LIVE_START_DISCARD_DOLLCHESTRA_SET_COST_GAIN_BLUE_HEART_ABILITY_ID ||
    effect.stepId !== HS_BP5_005_SELECT_DOLLCHESTRA_COST_SOURCE_STEP_ID ||
    !selectedCardId ||
    effect.selectableCardIds?.includes(selectedCardId) !== true
  ) {
    return game;
  }

  const player = getPlayerById(game, effect.controllerId);
  if (!player) {
    return game;
  }

  if (!isSourceOnOwnStage(game, player.id, effect.sourceCardId)) {
    return finishActiveEffect(game, continuePendingCardEffects, {
      step: 'SOURCE_NOT_ON_STAGE_AFTER_COST',
      sourceSlot: effect.metadata?.sourceSlot,
      discardedCardId: effect.metadata?.discardedCardId ?? null,
      selectedCardId,
    });
  }

  const currentSelectableCardIds = getOwnStageMemberIdsMatching(game, player.id, dollchestraMember);
  const selectedCard = getCardById(game, selectedCardId);
  if (
    !currentSelectableCardIds.includes(selectedCardId) ||
    !selectedCard ||
    !isMemberCardData(selectedCard.data)
  ) {
    return finishActiveEffect(game, continuePendingCardEffects, {
      step: 'DOLLCHESTRA_COST_SOURCE_ILLEGAL_AFTER_SELECTION',
      sourceSlot: effect.metadata?.sourceSlot,
      discardedCardId: effect.metadata?.discardedCardId ?? null,
      selectedCardId,
    });
  }

  const setTo = Math.max(0, selectedCard.data.cost - 1);
  const stateWithoutEffect = { ...game, activeEffect: null };
  const costResult = addMemberCostSetLiveModifierForMember(stateWithoutEffect, {
    playerId: player.id,
    memberCardId: effect.sourceCardId,
    sourceCardId: effect.sourceCardId,
    abilityId: effect.abilityId,
    setTo,
  });
  if (!costResult) {
    return game;
  }

  const sourceEffectiveCost = getMemberEffectiveCost(
    costResult.gameState,
    player.id,
    effect.sourceCardId
  );
  const heartResult =
    sourceEffectiveCost >= 10
      ? addHeartLiveModifierForMember(costResult.gameState, {
          playerId: player.id,
          memberCardId: effect.sourceCardId,
          sourceCardId: effect.sourceCardId,
          abilityId: effect.abilityId,
          hearts: [{ color: HeartColor.BLUE, count: 1 }],
        })
      : null;
  const stateAfterModifier = heartResult?.gameState ?? costResult.gameState;

  return continuePendingCardEffects(
    addAction(stateAfterModifier, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'APPLY_SOURCE_COST_SET_AND_BLUE_HEART',
      sourceSlot: effect.metadata?.sourceSlot,
      discardedCardId: effect.metadata?.discardedCardId ?? null,
      selectedCardId,
      selectedOriginalCost: selectedCard.data.cost,
      setTo,
      sourceEffectiveCost,
      gainedBlueHeart: heartResult !== null,
    }),
    effect.metadata?.orderedResolution === true
  );
}

function finishActiveEffect(
  game: GameState,
  continuePendingCardEffects: ContinuePendingCardEffects,
  payload: Readonly<Record<string, unknown>>
): GameState {
  const effect = game.activeEffect;
  const player = effect ? getPlayerById(game, effect.controllerId) : null;
  if (!effect || !player) {
    return game;
  }

  return continuePendingCardEffects(
    addAction(
      {
        ...game,
        activeEffect: null,
      },
      'RESOLVE_ABILITY',
      player.id,
      {
        pendingAbilityId: effect.id,
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
        ...payload,
      }
    ),
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

function getOwnStageMemberIdsMatching(
  game: GameState,
  playerId: string,
  predicate: (card: NonNullable<ReturnType<typeof getCardById>>) => boolean
): readonly string[] {
  const player = getPlayerById(game, playerId);
  if (!player) {
    return [];
  }

  return MEMBER_SLOT_ORDER.flatMap((slot) => {
    const cardId = player.memberSlots.slots[slot];
    if (!cardId) {
      return [];
    }
    const card = getCardById(game, cardId);
    return card !== null && card.ownerId === playerId && predicate(card) ? [cardId] : [];
  });
}

function isSourceOnOwnStage(game: GameState, playerId: string, sourceCardId: string): boolean {
  const player = getPlayerById(game, playerId);
  return player ? Object.values(player.memberSlots.slots).includes(sourceCardId) : false;
}
