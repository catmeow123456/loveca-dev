import { isLiveCardData } from '../../../../domain/entities/card.js';
import {
  addAction,
  getCardById,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { CardType } from '../../../../shared/types/enums.js';
import { selectCurrentLiveRevealedCheerCardIds } from '../../../effects/cheer-selection.js';
import {
  S_BP2_007_AUTO_ON_CHEER_LIVE_HAND_SEVEN_OR_LESS_DRAW_ONE_ABILITY_ID,
  S_BP2_007_LIVE_START_REVEAL_HAND_LIVE_BOTTOM_ARRANGE_TOP_TWO_ABILITY_ID,
} from '../../ability-ids.js';
import {
  revealHandCardForActiveEffect,
  startPendingActiveEffect,
} from '../../runtime/active-effect.js';
import {
  drawCardsForPlayer,
  moveHandCardToDeckBottomForPlayer,
} from '../../runtime/actions.js';
import type { EnqueueTriggeredCardEffectsForEnterWaitingRoom } from '../../runtime/enter-waiting-room-triggers.js';
import { getSourceMemberSlot } from '../../runtime/source-member.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import {
  getAbilityEffectText,
  recordAbilityUseForContext,
} from '../../runtime/workflow-helpers.js';
import {
  finishArrangeInspectedDeckTopWorkflow,
  startArrangeInspectedDeckTopWorkflow,
} from '../shared/arrange-inspected-deck-top.js';

const AUTO_ABILITY_ID = S_BP2_007_AUTO_ON_CHEER_LIVE_HAND_SEVEN_OR_LESS_DRAW_ONE_ABILITY_ID;
const LIVE_START_ABILITY_ID =
  S_BP2_007_LIVE_START_REVEAL_HAND_LIVE_BOTTOM_ARRANGE_TOP_TWO_ABILITY_ID;
const SELECT_HAND_LIVE_STEP_ID = 'S_BP2_007_SELECT_HAND_LIVE_TO_REVEAL';
const PLACE_REVEALED_LIVE_BOTTOM_STEP_ID = 'S_BP2_007_PLACE_REVEALED_LIVE_DECK_BOTTOM';
const ARRANGE_TOP_TWO_STEP_ID = 'S_BP2_007_ARRANGE_TOP_TWO';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerSBp2007HanamaruWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom;
}): void {
  registerPendingAbilityStarterHandler(AUTO_ABILITY_ID, (game, ability, options, context) =>
    resolveOnCheerDrawOne(
      game,
      ability,
      options.orderedResolution === true,
      context.continuePendingCardEffects
    )
  );
  registerPendingAbilityStarterHandler(LIVE_START_ABILITY_ID, (game, ability, options, context) =>
    startLiveStartRevealAndArrange(
      game,
      ability,
      options.orderedResolution === true,
      context.continuePendingCardEffects
    )
  );
  registerActiveEffectStepHandler(LIVE_START_ABILITY_ID, SELECT_HAND_LIVE_STEP_ID, (game, input, context) =>
    finishHandLiveSelection(
      game,
      input.selectedCardId ?? null,
      context.continuePendingCardEffects
    )
  );
  registerActiveEffectStepHandler(
    LIVE_START_ABILITY_ID,
    PLACE_REVEALED_LIVE_BOTTOM_STEP_ID,
    (game, _input, context) =>
      finishPlaceRevealedLiveBottom(game, context.continuePendingCardEffects, deps.enqueueTriggeredCardEffects)
  );
  registerActiveEffectStepHandler(LIVE_START_ABILITY_ID, ARRANGE_TOP_TWO_STEP_ID, (game, input, context) =>
    finishArrangeInspectedDeckTopWorkflow(
      game,
      input.selectedCardIds ?? [],
      context.continuePendingCardEffects,
      deps.enqueueTriggeredCardEffects
    )
  );
}

function resolveOnCheerDrawOne(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  const sourceSlot = player ? getSourceMemberSlot(game, player.id, ability.sourceCardId) : null;
  if (!player || sourceSlot === null) {
    return consumePending(game, ability, ability.controllerId, orderedResolution, continuePendingCardEffects, {
      step: 'SOURCE_NOT_ON_STAGE',
      sourceSlot,
    });
  }

  const matchingLiveCardIds = selectCurrentLiveRevealedCheerCardIds(game, player.id, {
    eventIds: ability.eventIds,
    eventScope: 'NON_ADDITIONAL',
    cardTypes: CardType.LIVE,
  });
  const conditionMet = matchingLiveCardIds.length >= 1 && player.hand.cardIds.length <= 7;
  if (!conditionMet) {
    return consumePending(game, ability, player.id, orderedResolution, continuePendingCardEffects, {
      step: 'CHEER_LIVE_OR_HAND_CONDITION_NOT_MET',
      sourceSlot,
      matchingLiveCardIds,
      handCardCount: player.hand.cardIds.length,
    });
  }

  const drawResult = drawCardsForPlayer(removePendingAbility(game, ability.id), player.id, 1);
  if (!drawResult) {
    return game;
  }
  const state = recordAbilityUseForContext(drawResult.gameState, player.id, {
    abilityId: ability.abilityId,
    sourceCardId: ability.sourceCardId,
  });
  return continuePendingCardEffects(
    addAction(state, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      sourceSlot,
      step: 'DRAW_ONE_FOR_OWN_CHEER_LIVE_HAND_SEVEN_OR_LESS',
      matchingLiveCardIds,
      handCardCount: player.hand.cardIds.length,
      drawnCardIds: drawResult.drawnCardIds,
    }),
    orderedResolution
  );
}

function startLiveStartRevealAndArrange(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player || getSourceMemberSlot(game, ability.controllerId, ability.sourceCardId) === null) {
    return consumePending(game, ability, ability.controllerId, orderedResolution, continuePendingCardEffects, {
      step: 'SOURCE_NOT_ON_STAGE',
    });
  }
  const selectableCardIds = player.hand.cardIds.filter((cardId) => {
    const card = getCardById(game, cardId);
    return card !== null && card.ownerId === player.id && isLiveCardData(card.data);
  });
  if (selectableCardIds.length === 0) {
    return consumePending(game, ability, player.id, orderedResolution, continuePendingCardEffects, {
      step: 'NO_HAND_LIVE_TO_REVEAL',
    });
  }

  return startPendingActiveEffect(game, {
    ability,
    playerId: player.id,
    activeEffect: {
      id: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      controllerId: ability.controllerId,
      effectText: getAbilityEffectText(ability.abilityId),
      stepId: SELECT_HAND_LIVE_STEP_ID,
      stepText: '请选择公开并放置到卡组底的1张手牌LIVE。也可以选择不发动。',
      awaitingPlayerId: player.id,
      selectableCardIds,
      selectableCardVisibility: 'AWAITING_PLAYER_ONLY',
      selectableCardMode: 'SINGLE',
      selectionLabel: '选择要公开并放置到卡组底的LIVE',
      confirmSelectionLabel: '公开',
      canSkipSelection: true,
      skipSelectionLabel: '不发动',
      metadata: { orderedResolution, revealCandidateCardIds: selectableCardIds },
    },
    actionPayload: {
      sourceCardId: ability.sourceCardId,
      step: 'START_SELECT_HAND_LIVE_TO_REVEAL',
      selectableCardIds,
    },
  });
}

function finishHandLiveSelection(
  game: GameState,
  selectedCardId: string | null,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  if (!effect || effect.abilityId !== LIVE_START_ABILITY_ID || effect.stepId !== SELECT_HAND_LIVE_STEP_ID) {
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
        step: 'DECLINE_REVEAL_HAND_LIVE',
      }),
      effect.metadata?.orderedResolution === true
    );
  }
  if (effect.selectableCardIds?.includes(selectedCardId) !== true) {
    return game;
  }
  if (!player.hand.cardIds.includes(selectedCardId)) {
    return clearStaleActiveEffect(game, effect, player.id, continuePendingCardEffects);
  }

  return revealHandCardForActiveEffect(game, {
    effect,
    playerId: player.id,
    selectedCardId,
    nextStepId: PLACE_REVEALED_LIVE_BOTTOM_STEP_ID,
    nextStepText: '已公开所选LIVE。确认后将其放置到卡组底，并检视卡组顶2张。',
    actionStep: 'REVEAL_HAND_LIVE',
    selectableCardIds: undefined,
    selectableCardVisibility: 'PUBLIC',
    selectableCardMode: undefined,
    selectionLabel: undefined,
    confirmSelectionLabel: '放置到卡组底并继续',
    canSkipSelection: false,
    skipSelectionLabel: undefined,
    metadata: { revealedHandLiveCardId: selectedCardId },
    actionPayload: { revealedHandLiveCardId: selectedCardId },
  });
}

function finishPlaceRevealedLiveBottom(
  game: GameState,
  continuePendingCardEffects: ContinuePendingCardEffects,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !== LIVE_START_ABILITY_ID ||
    effect.stepId !== PLACE_REVEALED_LIVE_BOTTOM_STEP_ID
  ) {
    return game;
  }
  const player = getPlayerById(game, effect.controllerId);
  const selectedCardId =
    typeof effect.metadata?.revealedHandLiveCardId === 'string'
      ? effect.metadata.revealedHandLiveCardId
      : null;
  const candidateCardIds = Array.isArray(effect.metadata?.revealCandidateCardIds)
    ? effect.metadata.revealCandidateCardIds.filter((cardId): cardId is string => typeof cardId === 'string')
    : [];
  if (!player || selectedCardId === null || getSourceMemberSlot(game, effect.controllerId, effect.sourceCardId) === null) {
    return clearStaleActiveEffect(game, effect, effect.controllerId, continuePendingCardEffects);
  }
  const moveResult = moveHandCardToDeckBottomForPlayer(game, player.id, selectedCardId, {
    candidateCardIds,
  });
  if (!moveResult) {
    return clearStaleActiveEffect(game, effect, player.id, continuePendingCardEffects);
  }

  const state = addAction({ ...moveResult.gameState, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
    pendingAbilityId: effect.id,
    abilityId: effect.abilityId,
    sourceCardId: effect.sourceCardId,
    step: 'PLACE_REVEALED_HAND_LIVE_TO_DECK_BOTTOM',
    revealedHandLiveCardId: selectedCardId,
    movedCardIds: [moveResult.movedCardId],
  });
  return startArrangeInspectedDeckTopWorkflow(
    state,
    {
      ability: {
        id: effect.id,
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
        controllerId: effect.controllerId,
      },
      playerId: player.id,
      effectText: getAbilityEffectText(effect.abilityId),
      inspectCount: 2,
      requestedInspectCount: 2,
      sourceActionLabel: 'LIVE开始',
      stepId: ARRANGE_TOP_TWO_STEP_ID,
      stepText: '请选择要留在卡组顶的卡牌。数字1会成为卡组最上方的卡，未选择的卡牌将放置入休息室。',
      selectionLabel: '按卡组顶从上到下的顺序选择卡牌',
      selectMin: 0,
      selectMax: 2,
      selectedDestination: 'MAIN_DECK_TOP',
      unselectedDestination: 'WAITING_ROOM',
      orderedResolution: effect.metadata?.orderedResolution === true,
    },
    continuePendingCardEffects
  );
}

function clearStaleActiveEffect(
  game: GameState,
  effect: NonNullable<GameState['activeEffect']>,
  playerId: string,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  return continuePendingCardEffects(
    addAction({ ...game, activeEffect: null }, 'RESOLVE_ABILITY', playerId, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'STALE_REVEALED_HAND_LIVE',
    }),
    effect.metadata?.orderedResolution === true
  );
}

function consumePending(
  game: GameState,
  ability: PendingAbilityState,
  playerId: string,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects,
  payload: Readonly<Record<string, unknown>>
): GameState {
  return continuePendingCardEffects(
    addAction(removePendingAbility(game, ability.id), 'RESOLVE_ABILITY', playerId, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      ...payload,
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
