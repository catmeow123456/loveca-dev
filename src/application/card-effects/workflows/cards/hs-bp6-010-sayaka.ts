import type { CardInstance } from '../../../../domain/entities/card.js';
import {
  addAction,
  getCardById,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { addMemberCostLiveModifierForMember } from '../../../../domain/rules/live-modifiers.js';
import { CardType, SlotPosition } from '../../../../shared/types/enums.js';
import { and, typeIs, unitAliasIs } from '../../../effects/card-selectors.js';
import { HS_BP6_010_LIVE_START_DISCARD_DOLLCHESTRA_DRAW_TARGET_COST_ABILITY_ID } from '../../ability-ids.js';
import {
  createOptionalDiscardHandToWaitingRoomActiveEffect,
  finishSkippedActiveEffect,
  startPendingActiveEffect,
} from '../../runtime/active-effect.js';
import { drawCardsForPlayer } from '../../runtime/actions.js';
import {
  discardOneHandCardToWaitingRoomAndEnqueueTriggers,
  type EnqueueTriggeredCardEffectsForEnterWaitingRoom,
} from '../../runtime/enter-waiting-room-triggers.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText } from '../../runtime/workflow-helpers.js';

export const HS_BP6_010_SELECT_DOLLCHESTRA_DISCARD_STEP_ID =
  'HS_BP6_010_SELECT_DOLLCHESTRA_DISCARD';
export const HS_BP6_010_SELECT_DOLLCHESTRA_COST_TARGET_STEP_ID =
  'HS_BP6_010_SELECT_DOLLCHESTRA_COST_TARGET';

const dollchestraCard = unitAliasIs('DOLLCHESTRA');
const dollchestraMember = and(typeIs(CardType.MEMBER), dollchestraCard);
const MEMBER_SLOT_ORDER = [SlotPosition.LEFT, SlotPosition.CENTER, SlotPosition.RIGHT] as const;

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerHsBp6010SayakaWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom;
}): void {
  registerPendingAbilityStarterHandler(
    HS_BP6_010_LIVE_START_DISCARD_DOLLCHESTRA_DRAW_TARGET_COST_ABILITY_ID,
    (game, ability, options) =>
      startHsBp6010SayakaLiveStartDiscard(game, ability, options.orderedResolution === true)
  );
  registerActiveEffectStepHandler(
    HS_BP6_010_LIVE_START_DISCARD_DOLLCHESTRA_DRAW_TARGET_COST_ABILITY_ID,
    HS_BP6_010_SELECT_DOLLCHESTRA_DISCARD_STEP_ID,
    (game, input, context) =>
      input.selectedCardId
        ? startHsBp6010SayakaTargetSelection(
            game,
            input.selectedCardId,
            context.continuePendingCardEffects,
            deps.enqueueTriggeredCardEffects
          )
        : finishSkippedActiveEffect(game, context.continuePendingCardEffects)
  );
  registerActiveEffectStepHandler(
    HS_BP6_010_LIVE_START_DISCARD_DOLLCHESTRA_DRAW_TARGET_COST_ABILITY_ID,
    HS_BP6_010_SELECT_DOLLCHESTRA_COST_TARGET_STEP_ID,
    (game, input, context) =>
      finishHsBp6010SayakaCostTarget(
        game,
        input.selectedCardId ?? null,
        context.continuePendingCardEffects
      )
  );
}

function startHsBp6010SayakaLiveStartDiscard(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  const selectableCardIds = player.hand.cardIds.filter((cardId) => {
    const card = getCardById(game, cardId);
    return card !== null && dollchestraCard(card);
  });

  return startPendingActiveEffect(game, {
    ability,
    playerId: player.id,
    activeEffect: createOptionalDiscardHandToWaitingRoomActiveEffect({
      ability,
      playerId: player.id,
      effectText: getAbilityEffectText(
        HS_BP6_010_LIVE_START_DISCARD_DOLLCHESTRA_DRAW_TARGET_COST_ABILITY_ID
      ),
      stepId: HS_BP6_010_SELECT_DOLLCHESTRA_DISCARD_STEP_ID,
      selectableCardIds,
      orderedResolution,
      stepText: '可以将手牌中的1张『DOLLCHESTRA』卡放置入休息室。如此做时抽1张卡。',
      selectionLabel: '选择要放置入休息室的DOLLCHESTRA卡',
      metadata: {
        sourceSlot: ability.sourceSlot,
      },
    }),
    actionPayload: {
      sourceCardId: ability.sourceCardId,
      step: 'START_SELECT_DOLLCHESTRA_DISCARD',
      sourceSlot: ability.sourceSlot,
      selectableCardIds,
    },
  });
}

function startHsBp6010SayakaTargetSelection(
  game: GameState,
  discardCardId: string,
  continuePendingCardEffects: ContinuePendingCardEffects,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !== HS_BP6_010_LIVE_START_DISCARD_DOLLCHESTRA_DRAW_TARGET_COST_ABILITY_ID ||
    effect.stepId !== HS_BP6_010_SELECT_DOLLCHESTRA_DISCARD_STEP_ID ||
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

  const drawResult = drawCardsForPlayer(discardResult.gameState, player.id, 1);
  let state = drawResult?.gameState ?? discardResult.gameState;
  const drawnCardIds = drawResult?.drawnCardIds ?? [];
  const selectableCardIds = getOwnStageMemberIdsMatching(state, player.id, dollchestraMember);

  if (selectableCardIds.length === 0) {
    state = { ...state, activeEffect: null };
    return continuePendingCardEffects(
      addAction(state, 'RESOLVE_ABILITY', player.id, {
        pendingAbilityId: effect.id,
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
        step: 'DISCARD_DRAW_NO_DOLLCHESTRA_TARGET',
        sourceSlot: effect.metadata?.sourceSlot,
        discardedCardId: discardResult.discardedCardIds[0],
        drawnCardIds,
      }),
      effect.metadata?.orderedResolution === true
    );
  }

  return addAction(
    {
      ...state,
      activeEffect: {
        ...effect,
        stepId: HS_BP6_010_SELECT_DOLLCHESTRA_COST_TARGET_STEP_ID,
        stepText: '请选择费用+5的『DOLLCHESTRA』成员。',
        selectableCardIds,
        selectableCardVisibility: 'PUBLIC',
        selectableCardMode: 'SINGLE',
        selectionLabel: '选择费用+5的成员',
        canSkipSelection: false,
        skipSelectionLabel: undefined,
        metadata: {
          ...effect.metadata,
          discardedCardId: discardResult.discardedCardIds[0],
          drawnCardIds,
        },
      },
    },
    'RESOLVE_ABILITY',
    player.id,
    {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'DISCARD_DRAW_SELECT_DOLLCHESTRA_TARGET',
      sourceSlot: effect.metadata?.sourceSlot,
      discardedCardId: discardResult.discardedCardIds[0],
      drawnCardIds,
      selectableCardIds,
    }
  );
}

function finishHsBp6010SayakaCostTarget(
  game: GameState,
  selectedCardId: string | null,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !== HS_BP6_010_LIVE_START_DISCARD_DOLLCHESTRA_DRAW_TARGET_COST_ABILITY_ID ||
    effect.stepId !== HS_BP6_010_SELECT_DOLLCHESTRA_COST_TARGET_STEP_ID ||
    !selectedCardId ||
    effect.selectableCardIds?.includes(selectedCardId) !== true
  ) {
    return game;
  }

  const player = getPlayerById(game, effect.controllerId);
  if (
    !player ||
    !getOwnStageMemberIdsMatching(game, player.id, dollchestraMember).includes(selectedCardId)
  ) {
    return game;
  }

  const costResult = addMemberCostLiveModifierForMember(
    { ...game, activeEffect: null },
    {
      playerId: player.id,
      memberCardId: selectedCardId,
      sourceCardId: effect.sourceCardId,
      abilityId: effect.abilityId,
      countDelta: 5,
    }
  );
  if (!costResult) {
    return game;
  }

  return continuePendingCardEffects(
    addAction(costResult.gameState, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'APPLY_DOLLCHESTRA_MEMBER_COST',
      sourceSlot: effect.metadata?.sourceSlot,
      discardedCardId: effect.metadata?.discardedCardId ?? null,
      drawnCardIds: effect.metadata?.drawnCardIds ?? [],
      targetCardId: selectedCardId,
      costBonus: costResult.costDelta,
    }),
    effect.metadata?.orderedResolution === true
  );
}

function getOwnStageMemberIdsMatching(
  game: GameState,
  playerId: string,
  predicate: (card: CardInstance) => boolean
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
