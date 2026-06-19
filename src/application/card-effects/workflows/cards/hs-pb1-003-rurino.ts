import {
  addAction,
  getCardById,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import type { EnterWaitingRoomEvent } from '../../../../domain/events/game-events.js';
import { addHeartLiveModifierForMember } from '../../../../domain/rules/live-modifiers.js';
import { CardType, HeartColor, TriggerCondition } from '../../../../shared/types/enums.js';
import { unitAliasIs, typeIs } from '../../../effects/card-selectors.js';
import {
  HS_PB1_003_AUTO_HAND_TO_WAITING_GAIN_HEART_BLADE_ABILITY_ID,
  HS_PB1_003_ON_ENTER_DISCARD_MIRACRA_MEMBERS_DRAW_PLUS_ONE_ABILITY_ID,
} from '../../ability-ids.js';
import { startPendingActiveEffect } from '../../runtime/active-effect.js';
import {
  addBladeLiveModifierForSourceMember,
  discardHandCardsToWaitingRoomForPlayer,
  drawCardsForPlayer,
} from '../../runtime/actions.js';
import { enqueueEnterWaitingRoomTriggersFromDiscardResult } from '../../runtime/enter-waiting-room-triggers.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import {
  getAbilityEffectText,
  recordAbilityUseForContext,
} from '../../runtime/workflow-helpers.js';

export const HS_PB1_003_SELECT_DISCARD_STEP_ID = 'HS_PB1_003_SELECT_MIRACRA_HAND_MEMBERS';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;
type EnqueueTriggeredCardEffects = (
  game: GameState,
  triggerConditions: readonly TriggerCondition[],
  options?: {
    readonly enterWaitingRoomEvents?: readonly EnterWaitingRoomEvent[];
  }
) => GameState;

const miraCraMember = (game: GameState, cardId: string): boolean => {
  const card = getCardById(game, cardId);
  return card !== null && typeIs(CardType.MEMBER)(card) && unitAliasIs('Mira-Cra Park!')(card);
};

export function registerHsPb1003RurinoWorkflowHandlers(dependencies: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffects;
}): void {
  registerPendingAbilityStarterHandler(
    HS_PB1_003_ON_ENTER_DISCARD_MIRACRA_MEMBERS_DRAW_PLUS_ONE_ABILITY_ID,
    (game, ability, options) =>
      startHsPb1003RurinoOnEnterDiscardDraw(game, ability, options.orderedResolution === true)
  );
  registerPendingAbilityStarterHandler(
    HS_PB1_003_AUTO_HAND_TO_WAITING_GAIN_HEART_BLADE_ABILITY_ID,
    (game, ability, options, context) =>
      resolveHsPb1003RurinoHandToWaitingAuto(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      )
  );
  registerActiveEffectStepHandler(
    HS_PB1_003_ON_ENTER_DISCARD_MIRACRA_MEMBERS_DRAW_PLUS_ONE_ABILITY_ID,
    HS_PB1_003_SELECT_DISCARD_STEP_ID,
    (game, input, context) =>
      finishHsPb1003RurinoOnEnterDiscardDraw(
        game,
        input.selectedCardIds ?? [],
        dependencies.enqueueTriggeredCardEffects,
        context.continuePendingCardEffects
      )
  );
}

function startHsPb1003RurinoOnEnterDiscardDraw(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  const selectableCardIds = player.hand.cardIds.filter((cardId) => miraCraMember(game, cardId));
  return startPendingActiveEffect(game, {
    ability,
    playerId: player.id,
    activeEffect: {
      id: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      controllerId: ability.controllerId,
      effectText: getAbilityEffectText(
        HS_PB1_003_ON_ENTER_DISCARD_MIRACRA_MEMBERS_DRAW_PLUS_ONE_ABILITY_ID
      ),
      stepId: HS_PB1_003_SELECT_DISCARD_STEP_ID,
      stepText: '选择任意张手牌中的 Mira-Cra 成员卡放置入休息室。可以选择0张。',
      awaitingPlayerId: player.id,
      selectableCardIds,
      selectableCardVisibility: 'AWAITING_PLAYER_ONLY',
      selectableCardMode: 'ORDERED_MULTI',
      minSelectableCards: 0,
      maxSelectableCards: selectableCardIds.length,
      metadata: {
        orderedResolution,
        sourceSlot: ability.sourceSlot,
      },
    },
    actionPayload: {
      sourceCardId: ability.sourceCardId,
      step: 'START_SELECT_MIRACRA_HAND_MEMBERS',
    },
  });
}

function finishHsPb1003RurinoOnEnterDiscardDraw(
  game: GameState,
  selectedCardIds: readonly string[],
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffects,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  const player = effect ? getPlayerById(game, effect.controllerId) : null;
  const uniqueSelectedCardIds = [...new Set(selectedCardIds)];
  if (
    !effect ||
    effect.abilityId !== HS_PB1_003_ON_ENTER_DISCARD_MIRACRA_MEMBERS_DRAW_PLUS_ONE_ABILITY_ID ||
    effect.stepId !== HS_PB1_003_SELECT_DISCARD_STEP_ID ||
    !player ||
    selectedCardIds.length !== uniqueSelectedCardIds.length ||
    uniqueSelectedCardIds.some(
      (cardId) =>
        effect.selectableCardIds?.includes(cardId) !== true || !player.hand.cardIds.includes(cardId)
    )
  ) {
    return game;
  }

  const discardResult = discardHandCardsToWaitingRoomForPlayer(
    game,
    player.id,
    uniqueSelectedCardIds,
    {
      count: uniqueSelectedCardIds.length,
      candidateCardIds: effect.selectableCardIds ?? [],
    }
  );
  if (!discardResult) {
    return game;
  }

  const state = enqueueEnterWaitingRoomTriggersFromDiscardResult(
    discardResult.gameState,
    discardResult,
    enqueueTriggeredCardEffects
  );

  const drawResult = drawCardsForPlayer(
    state,
    player.id,
    discardResult.discardedCardIds.length + 1
  );
  if (!drawResult) {
    return game;
  }

  return continuePendingCardEffects(
    addAction({ ...drawResult.gameState, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'DISCARD_MIRACRA_HAND_MEMBERS_DRAW_PLUS_ONE',
      sourceSlot: effect.metadata?.sourceSlot,
      discardedCardIds: discardResult.discardedCardIds,
      drawnCardIds: drawResult.drawnCardIds,
    }),
    effect.metadata?.orderedResolution === true
  );
}

function resolveHsPb1003RurinoHandToWaitingAuto(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  let state: GameState = {
    ...game,
    pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
  };
  state = recordAbilityUseForContext(state, player.id, {
    abilityId: ability.abilityId,
    sourceCardId: ability.sourceCardId,
  });

  const heartResult = addHeartLiveModifierForMember(state, {
    playerId: player.id,
    memberCardId: ability.sourceCardId,
    sourceCardId: ability.sourceCardId,
    abilityId: ability.abilityId,
    hearts: [{ color: HeartColor.PINK, count: 1 }],
  });
  if (!heartResult) {
    return game;
  }

  const bladeResult = addBladeLiveModifierForSourceMember(heartResult.gameState, {
    playerId: player.id,
    sourceCardId: ability.sourceCardId,
    abilityId: ability.abilityId,
    amount: 1,
  });
  if (!bladeResult) {
    return game;
  }

  return continuePendingCardEffects(
    addAction(bladeResult.gameState, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: 'GAIN_PINK_HEART_AND_BLADE_FROM_HAND_TO_WAITING',
      sourceSlot: ability.sourceSlot,
      movedCardIds: ability.metadata?.movedCardIds ?? [],
    }),
    orderedResolution
  );
}
