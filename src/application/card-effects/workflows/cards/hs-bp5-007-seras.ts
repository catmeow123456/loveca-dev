import {
  addAction,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { CardType } from '../../../../shared/types/enums.js';
import { and, typeIs, unitAliasIs } from '../../../effects/card-selectors.js';
import {
  createWaitingRoomToHandEffectState,
  createWaitingRoomToHandSelectionConfig,
  selectWaitingRoomCardIds,
} from '../../../effects/zone-selection.js';
import { HS_BP5_007_ON_ENTER_DISCARD_TWO_RECOVER_EDELNOTE_LIVE_ABILITY_ID } from '../../ability-ids.js';
import { startPendingActiveEffect } from '../../runtime/active-effect.js';
import {
  discardHandCardsToWaitingRoomAndEnqueueTriggers,
  type EnqueueTriggeredCardEffectsForEnterWaitingRoom,
} from '../../runtime/enter-waiting-room-triggers.js';
import {
  registerPendingAbilityStarterHandler,
  type PendingAbilityStarterOptions,
} from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText } from '../../runtime/workflow-helpers.js';
import { finishWaitingRoomToHandWorkflow } from '../shared/waiting-room-to-hand.js';

const DISCARD_COUNT = 2;
const SELECT_DISCARD_STEP_ID = 'HS_BP5_007_SELECT_TWO_HAND_CARDS_TO_DISCARD';
const SELECT_EDELNOTE_LIVE_STEP_ID = 'HS_BP5_007_SELECT_EDELNOTE_LIVE_FROM_WAITING_ROOM';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerHsBp5007SerasWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom;
}): void {
  registerPendingAbilityStarterHandler(
    HS_BP5_007_ON_ENTER_DISCARD_TWO_RECOVER_EDELNOTE_LIVE_ABILITY_ID,
    (game, ability, options, context) =>
      startHsBp5007SerasOnEnterDiscardTwo(game, ability, options, context.continuePendingCardEffects)
  );
  registerActiveEffectStepHandler(
    HS_BP5_007_ON_ENTER_DISCARD_TWO_RECOVER_EDELNOTE_LIVE_ABILITY_ID,
    SELECT_DISCARD_STEP_ID,
    (game, input, context) =>
      finishHsBp5007SerasDiscardCost(
        game,
        input.selectedCardIds ?? [],
        context.continuePendingCardEffects,
        deps.enqueueTriggeredCardEffects
      )
  );
  registerActiveEffectStepHandler(
    HS_BP5_007_ON_ENTER_DISCARD_TWO_RECOVER_EDELNOTE_LIVE_ABILITY_ID,
    SELECT_EDELNOTE_LIVE_STEP_ID,
    (game, input, context) =>
      finishWaitingRoomToHandWorkflow(
        game,
        input.selectedCardId ?? null,
        input.selectedCardIds,
        context.continuePendingCardEffects
      )
  );
}

function startHsBp5007SerasOnEnterDiscardTwo(
  game: GameState,
  ability: PendingAbilityState,
  options: PendingAbilityStarterOptions,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  if (player.hand.cardIds.length < DISCARD_COUNT) {
    return finishWithoutEffect(
      game,
      ability,
      options.orderedResolution === true,
      continuePendingCardEffects,
      'NOT_ENOUGH_HAND_TO_DISCARD'
    );
  }

  return startPendingActiveEffect(game, {
    ability,
    playerId: player.id,
    activeEffect: {
      id: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      controllerId: ability.controllerId,
      effectText: getAbilityEffectText(
        HS_BP5_007_ON_ENTER_DISCARD_TWO_RECOVER_EDELNOTE_LIVE_ABILITY_ID
      ),
      stepId: SELECT_DISCARD_STEP_ID,
      stepText: '可以将2张手牌放置入休息室，之后回收1张『EdelNote』LIVE卡。',
      awaitingPlayerId: player.id,
      selectableCardIds: player.hand.cardIds,
      selectableCardVisibility: 'AWAITING_PLAYER_ONLY',
      selectableCardMode: 'ORDERED_MULTI',
      minSelectableCards: DISCARD_COUNT,
      maxSelectableCards: DISCARD_COUNT,
      selectionLabel: '选择要放置入休息室的2张手牌',
      confirmSelectionLabel: '放置入休息室',
      canSkipSelection: true,
      skipSelectionLabel: '不发动',
      metadata: {
        orderedResolution: options.orderedResolution === true,
        discardCount: DISCARD_COUNT,
        effectCosts: [
          {
            kind: 'DISCARD_HAND_TO_WAITING_ROOM',
            minCount: DISCARD_COUNT,
            maxCount: DISCARD_COUNT,
            optional: true,
          },
        ],
        handToWaitingRoomCost: {
          minCount: DISCARD_COUNT,
          maxCount: DISCARD_COUNT,
          optional: true,
        },
      },
    },
    actionPayload: {
      sourceCardId: ability.sourceCardId,
      step: 'START_SELECT_TWO_HAND_DISCARD',
      selectableCardIds: player.hand.cardIds,
      discardCount: DISCARD_COUNT,
    },
  });
}

function finishHsBp5007SerasDiscardCost(
  game: GameState,
  selectedCardIds: readonly string[],
  continuePendingCardEffects: ContinuePendingCardEffects,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !== HS_BP5_007_ON_ENTER_DISCARD_TWO_RECOVER_EDELNOTE_LIVE_ABILITY_ID ||
    effect.stepId !== SELECT_DISCARD_STEP_ID
  ) {
    return game;
  }
  const player = getPlayerById(game, effect.controllerId);
  const orderedResolution = effect.metadata?.orderedResolution === true;
  if (!player) {
    return game;
  }

  if (selectedCardIds.length === 0 && effect.canSkipSelection === true) {
    return continuePendingCardEffects(
      addAction({ ...game, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
        pendingAbilityId: effect.id,
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
        step: 'SKIP_DISCARD_COST',
      }),
      orderedResolution
    );
  }

  const uniqueSelectedCardIds = [...new Set(selectedCardIds)];
  if (
    uniqueSelectedCardIds.length !== selectedCardIds.length ||
    uniqueSelectedCardIds.length !== DISCARD_COUNT ||
    !uniqueSelectedCardIds.every(
      (selectedCardId) =>
        effect.selectableCardIds?.includes(selectedCardId) === true &&
        player.hand.cardIds.includes(selectedCardId)
    )
  ) {
    return game;
  }

  const discardResult = discardHandCardsToWaitingRoomAndEnqueueTriggers(
    game,
    player.id,
    uniqueSelectedCardIds,
    {
      count: DISCARD_COUNT,
      candidateCardIds: effect.selectableCardIds ?? [],
    },
    enqueueTriggeredCardEffects
  );
  if (!discardResult) {
    return game;
  }

  const selectableCardIds = selectWaitingRoomCardIds(
    discardResult.gameState,
    player.id,
    and(typeIs(CardType.LIVE), unitAliasIs('EdelNote'))
  );
  const stateWithCost = addAction(discardResult.gameState, 'PAY_COST', player.id, {
    pendingAbilityId: effect.id,
    abilityId: effect.abilityId,
    sourceCardId: effect.sourceCardId,
    discardedHandCardIds: discardResult.discardedCardIds,
    selectableCardIds,
  });

  if (selectableCardIds.length === 0) {
    return continuePendingCardEffects(
      addAction({ ...stateWithCost, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
        pendingAbilityId: effect.id,
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
        step: 'DISCARD_COST_NO_EDELNOTE_LIVE_TARGET',
        discardedHandCardIds: discardResult.discardedCardIds,
      }),
      orderedResolution
    );
  }

  return {
    ...stateWithCost,
    activeEffect: createWaitingRoomToHandEffectState({
      id: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      controllerId: player.id,
      effectText: effect.effectText,
      stepId: SELECT_EDELNOTE_LIVE_STEP_ID,
      stepText: '请选择自己的休息室中1张『EdelNote』的LIVE卡加入手牌。',
      awaitingPlayerId: player.id,
      selectableCardIds,
      canSkipSelection: false,
      metadata: {
        orderedResolution,
        discardedHandCardIds: discardResult.discardedCardIds,
      },
      zoneSelection: createWaitingRoomToHandSelectionConfig({
        minCount: 1,
        maxCount: 1,
        optional: false,
      }),
    }),
  };
}

function finishWithoutEffect(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects,
  reason: string
): GameState {
  const state = {
    ...game,
    pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
  };
  return continuePendingCardEffects(
    addAction(state, 'RESOLVE_ABILITY', ability.controllerId, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: reason,
      conditionMet: false,
      reason,
    }),
    orderedResolution
  );
}
