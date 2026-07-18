import { isLiveCardData } from '../../../../domain/entities/card.js';
import {
  addAction,
  getCardById,
  getPlayerById,
  type ActiveEffectState,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { inspectTopCardsUntilMatch } from '../../../effects/look-top.js';
import { PL_N_BP1_011_ON_ENTER_OPTIONAL_DISCARD_REVEAL_UNTIL_LIVE_ABILITY_ID } from '../../ability-ids.js';
import { createOptionalDiscardHandToWaitingRoomActiveEffect } from '../../runtime/active-effect.js';
import {
  discardOneHandCardToWaitingRoomAndEnqueueTriggers,
  type EnqueueTriggeredCardEffectsForEnterWaitingRoom,
} from '../../runtime/enter-waiting-room-triggers.js';
import { moveInspectedSelectionToHandRestToWaitingRoomAndEnqueueTriggers } from '../../runtime/inspection-waiting-room-triggers.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText } from '../../runtime/workflow-helpers.js';

const SELECT_DISCARD_STEP_ID = 'PL_N_BP1_011_SELECT_HAND_CARD_TO_DISCARD';
const CONFIRM_REVEALED_CARDS_STEP_ID = 'PL_N_BP1_011_CONFIRM_REVEALED_CARDS';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerNBp1011MiaTaylorWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom;
}): void {
  registerPendingAbilityStarterHandler(
    PL_N_BP1_011_ON_ENTER_OPTIONAL_DISCARD_REVEAL_UNTIL_LIVE_ABILITY_ID,
    (game, ability, options, context) =>
      startMiaTaylorRevealUntilLive(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      )
  );
  registerActiveEffectStepHandler(
    PL_N_BP1_011_ON_ENTER_OPTIONAL_DISCARD_REVEAL_UNTIL_LIVE_ABILITY_ID,
    SELECT_DISCARD_STEP_ID,
    (game, input, context) =>
      input.selectedCardId
        ? finishMiaTaylorDiscardCost(
            game,
            input.selectedCardId,
            context.continuePendingCardEffects,
            deps.enqueueTriggeredCardEffects
          )
        : finishMiaTaylorWithoutPayment(game, context.continuePendingCardEffects)
  );
  registerActiveEffectStepHandler(
    PL_N_BP1_011_ON_ENTER_OPTIONAL_DISCARD_REVEAL_UNTIL_LIVE_ABILITY_ID,
    CONFIRM_REVEALED_CARDS_STEP_ID,
    (game, _input, context) =>
      finishMiaTaylorRevealedCards(
        game,
        context.continuePendingCardEffects,
        deps.enqueueTriggeredCardEffects
      )
  );
}

function startMiaTaylorRevealUntilLive(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player || player.hand.cardIds.length === 0) {
    return consumePending(
      game,
      ability,
      orderedResolution,
      continuePendingCardEffects,
      'NO_HAND_TO_DISCARD'
    );
  }
  return {
    ...game,
    pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
    activeEffect: createOptionalDiscardHandToWaitingRoomActiveEffect({
      ability,
      playerId: player.id,
      effectText: getAbilityEffectText(ability.abilityId),
      stepId: SELECT_DISCARD_STEP_ID,
      stepText: '可以将1张手牌放置入休息室。如此做的话，连续公开卡组顶直到公开LIVE卡。',
      selectionLabel: '选择要放置入休息室的手牌',
      confirmSelectionLabel: '放置入休息室',
      skipSelectionLabel: '不发动',
      selectableCardIds: player.hand.cardIds,
      orderedResolution,
    }),
  };
}

function finishMiaTaylorWithoutPayment(
  game: GameState,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = getMiaTaylorEffect(game, SELECT_DISCARD_STEP_ID);
  if (!effect) return game;
  return continuePendingCardEffects(
    addAction({ ...game, activeEffect: null }, 'RESOLVE_ABILITY', effect.controllerId, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'DECLINE_DISCARD_COST',
    }),
    effect.metadata?.orderedResolution === true
  );
}

function finishMiaTaylorDiscardCost(
  game: GameState,
  selectedCardId: string,
  continuePendingCardEffects: ContinuePendingCardEffects,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom
): GameState {
  const effect = getMiaTaylorEffect(game, SELECT_DISCARD_STEP_ID);
  const player = effect ? getPlayerById(game, effect.controllerId) : null;
  if (
    !effect ||
    !player ||
    effect.selectableCardIds?.includes(selectedCardId) !== true ||
    !player.hand.cardIds.includes(selectedCardId)
  ) {
    return game;
  }
  const discardResult = discardOneHandCardToWaitingRoomAndEnqueueTriggers(
    game,
    player.id,
    selectedCardId,
    { candidateCardIds: effect.selectableCardIds },
    enqueueTriggeredCardEffects
  );
  if (!discardResult) return game;

  const stateAfterCost = addAction(discardResult.gameState, 'PAY_COST', player.id, {
    pendingAbilityId: effect.id,
    abilityId: effect.abilityId,
    sourceCardId: effect.sourceCardId,
    discardedCardIds: discardResult.discardedCardIds,
    enterWaitingRoomEventId: discardResult.enterWaitingRoomEvent?.eventId,
  });
  const inspection = inspectTopCardsUntilMatch(
    stateAfterCost,
    player.id,
    (_state, card) => isLiveCardData(card.data)
  );
  if (!inspection) return game;
  if (inspection.inspectedCardIds.length === 0) {
    return continuePendingCardEffects(
      addAction({ ...inspection.gameState, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
        pendingAbilityId: effect.id,
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
        step: 'REVEAL_UNTIL_NO_CARDS',
        inspectedCardIds: [],
        hitCardId: null,
      }),
      effect.metadata?.orderedResolution === true
    );
  }

  return addAction(
    {
      ...inspection.gameState,
      activeEffect: {
        ...effect,
        stepId: CONFIRM_REVEALED_CARDS_STEP_ID,
        stepText:
          inspection.hitCardId === null
            ? `已公开${inspection.inspectedCardIds.length}张卡，未公开到LIVE卡。确认后将公开的卡全部放置入休息室。`
            : `已公开${inspection.inspectedCardIds.length}张卡并公开到LIVE卡。确认后将该LIVE卡加入手牌，其余公开的卡放置入休息室。`,
        inspectionCardIds: inspection.inspectedCardIds,
        revealedCardIds: inspection.inspectedCardIds,
        selectableCardIds: undefined,
        selectableCardVisibility: undefined,
        selectableCardMode: undefined,
        minSelectableCards: undefined,
        maxSelectableCards: undefined,
        selectableOptions: undefined,
        selectionLabel: '公开的卡片',
        confirmSelectionLabel: '确认公开结果',
        canSkipSelection: undefined,
        skipSelectionLabel: undefined,
        metadata: {
          ...effect.metadata,
          discardedCardIds: discardResult.discardedCardIds,
          inspectedCardIds: inspection.inspectedCardIds,
          hitCardId: inspection.hitCardId,
        },
      },
    },
    'RESOLVE_ABILITY',
    player.id,
    {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'REVEAL_UNTIL_LIVE_START_CONFIRM',
      inspectedCardIds: inspection.inspectedCardIds,
      hitCardId: inspection.hitCardId,
    }
  );
}

function finishMiaTaylorRevealedCards(
  game: GameState,
  continuePendingCardEffects: ContinuePendingCardEffects,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom
): GameState {
  const effect = getMiaTaylorEffect(game, CONFIRM_REVEALED_CARDS_STEP_ID);
  const player = effect ? getPlayerById(game, effect.controllerId) : null;
  const inspectedCardIds = effect?.inspectionCardIds ?? [];
  const hitCardId = readNullableStringMetadata(effect, 'hitCardId');
  const hitCard = hitCardId ? getCardById(game, hitCardId) : null;
  if (
    !effect ||
    !player ||
    inspectedCardIds.length === 0 ||
    game.inspectionContext?.ownerPlayerId !== player.id ||
    inspectedCardIds.some((cardId) => !game.inspectionZone.cardIds.includes(cardId)) ||
    inspectedCardIds.some((cardId) => !game.inspectionZone.revealedCardIds.includes(cardId)) ||
    (hitCardId !== null &&
      (!inspectedCardIds.includes(hitCardId) || !hitCard || !isLiveCardData(hitCard.data)))
  ) {
    return game;
  }
  const moveResult = moveInspectedSelectionToHandRestToWaitingRoomAndEnqueueTriggers(
    game,
    player.id,
    inspectedCardIds,
    hitCardId,
    enqueueTriggeredCardEffects
  );
  if (!moveResult) return game;

  return continuePendingCardEffects(
    addAction({ ...moveResult.gameState, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: hitCardId ? 'REVEAL_UNTIL_LIVE_TO_HAND' : 'REVEAL_UNTIL_NO_LIVE',
      inspectedCardIds,
      hitCardId,
      selectedCardIds: moveResult.selectedCardIds,
      waitingRoomCardIds: moveResult.waitingRoomCardIds,
    }),
    effect.metadata?.orderedResolution === true
  );
}

function getMiaTaylorEffect(game: GameState, stepId: string): ActiveEffectState | null {
  const effect = game.activeEffect;
  return effect?.abilityId ===
    PL_N_BP1_011_ON_ENTER_OPTIONAL_DISCARD_REVEAL_UNTIL_LIVE_ABILITY_ID &&
    effect.stepId === stepId
    ? effect
    : null;
}

function readNullableStringMetadata(effect: ActiveEffectState | null, key: string): string | null {
  const value = effect?.metadata?.[key];
  return typeof value === 'string' ? value : null;
}

function consumePending(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects,
  step: string
): GameState {
  return continuePendingCardEffects(
    addAction(
      {
        ...game,
        pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
      },
      'RESOLVE_ABILITY',
      ability.controllerId,
      {
        pendingAbilityId: ability.id,
        abilityId: ability.abilityId,
        sourceCardId: ability.sourceCardId,
        step,
      }
    ),
    orderedResolution
  );
}
