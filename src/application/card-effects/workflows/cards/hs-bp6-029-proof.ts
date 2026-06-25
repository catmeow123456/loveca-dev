import {
  addAction,
  getPlayerById,
  updatePlayer,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { replaceLiveModifier } from '../../../../domain/rules/live-modifiers.js';
import { HeartColor } from '../../../../shared/types/enums.js';
import { groupAliasIs } from '../../../effects/card-selectors.js';
import { sumStageMemberEffectiveCostMatching } from '../../../effects/conditions.js';
import { clearInspectionCards, inspectTopCards } from '../../../effects/look-top.js';
import { HS_BP6_029_LIVE_START_HASUNOSORA_COST_LOOK_TOP_TWO_HAND_REDUCE_REQUIREMENT_ABILITY_ID } from '../../ability-ids.js';
import { startPendingActiveEffect } from '../../runtime/active-effect.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText } from '../../runtime/workflow-helpers.js';

export const HS_BP6_029_SELECT_TOP_CARD_TO_HAND_STEP_ID =
  'HS_BP6_029_SELECT_TOP_CARD_TO_HAND';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerHsBp6029ProofWorkflowHandlers(): void {
  registerPendingAbilityStarterHandler(
    HS_BP6_029_LIVE_START_HASUNOSORA_COST_LOOK_TOP_TWO_HAND_REDUCE_REQUIREMENT_ABILITY_ID,
    (game, ability, options, context) =>
      startHsBp6029ProofLiveStart(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      )
  );
  registerActiveEffectStepHandler(
    HS_BP6_029_LIVE_START_HASUNOSORA_COST_LOOK_TOP_TWO_HAND_REDUCE_REQUIREMENT_ABILITY_ID,
    HS_BP6_029_SELECT_TOP_CARD_TO_HAND_STEP_ID,
    (game, input, context) =>
      finishHsBp6029ProofTopCardSelection(
        game,
        input.selectedCardId ?? null,
        context.continuePendingCardEffects
      )
  );
}

function startHsBp6029ProofLiveStart(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  const hasunosoraCostTotal = sumStageMemberEffectiveCostMatching(
    game,
    player.id,
    groupAliasIs('蓮ノ空')
  );
  const requirementReduction = hasunosoraCostTotal >= 30 ? 2 : 0;
  let state = applyRequirementReduction(
    game,
    ability.sourceCardId,
    ability.abilityId,
    requirementReduction
  );

  if (hasunosoraCostTotal < 20) {
    state = {
      ...state,
      pendingAbilities: state.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
    };
    return continuePendingCardEffects(
      addAction(state, 'RESOLVE_ABILITY', player.id, {
        pendingAbilityId: ability.id,
        abilityId: ability.abilityId,
        sourceCardId: ability.sourceCardId,
        step: 'HASUNOSORA_COST_BELOW_TWENTY',
        hasunosoraCostTotal,
        requirementReduction: 0,
      }),
      orderedResolution
    );
  }

  const inspectResult = inspectTopCards(state, player.id, { count: 2 });
  if (!inspectResult || inspectResult.inspectedCardIds.length === 0) {
    state = {
      ...state,
      pendingAbilities: state.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
    };
    return continuePendingCardEffects(
      addAction(state, 'RESOLVE_ABILITY', player.id, {
        pendingAbilityId: ability.id,
        abilityId: ability.abilityId,
        sourceCardId: ability.sourceCardId,
        step: 'NO_TOP_CARDS_TO_INSPECT',
        hasunosoraCostTotal,
        requirementReduction,
      }),
      orderedResolution
    );
  }

  if (inspectResult.inspectedCardIds.length === 1) {
    const selectedCardId = inspectResult.inspectedCardIds[0]!;
    const movedState = moveInspectedTopSelectionToHandRestToDeckTop(
      inspectResult.gameState,
      player.id,
      inspectResult.inspectedCardIds,
      selectedCardId
    );
    if (!movedState) {
      return game;
    }
    state = {
      ...movedState,
      pendingAbilities: movedState.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
    };
    return continuePendingCardEffects(
      addAction(state, 'RESOLVE_ABILITY', player.id, {
        pendingAbilityId: ability.id,
        abilityId: ability.abilityId,
        sourceCardId: ability.sourceCardId,
        step: 'AUTO_MOVE_ONLY_TOP_CARD_TO_HAND',
        hasunosoraCostTotal,
        selectedCardId,
        returnedCardIds: [],
        requirementReduction,
      }),
      orderedResolution
    );
  }

  return startPendingActiveEffect(inspectResult.gameState, {
    ability,
    playerId: player.id,
    activeEffect: {
      id: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      controllerId: ability.controllerId,
      effectText: getProofEffectText(ability.abilityId, hasunosoraCostTotal),
      stepId: HS_BP6_029_SELECT_TOP_CARD_TO_HAND_STEP_ID,
      stepText: '请选择检视的2张卡中的1张加入手牌。其余卡按原顺序放回卡组顶。',
      awaitingPlayerId: player.id,
      selectableCardIds: inspectResult.inspectedCardIds,
      selectableCardVisibility: 'AWAITING_PLAYER_ONLY',
      selectableCardMode: 'SINGLE',
      inspectionCardIds: inspectResult.inspectedCardIds,
      selectionLabel: '选择加入手牌的卡',
      confirmSelectionLabel: '加入手牌',
      canSkipSelection: false,
      metadata: {
        orderedResolution,
        hasunosoraCostTotal,
        requirementReduction,
      },
    },
    actionPayload: {
      sourceCardId: ability.sourceCardId,
      step: 'START_SELECT_TOP_CARD_TO_HAND',
      hasunosoraCostTotal,
      inspectedCardIds: inspectResult.inspectedCardIds,
      requirementReduction,
    },
  });
}

function getProofEffectText(abilityId: string, hasunosoraCostTotal: number): string {
  const tierText =
    hasunosoraCostTotal >= 30
      ? `当前费用合计 ${hasunosoraCostTotal}，满足30档，必要無Heart-2`
      : `当前费用合计 ${hasunosoraCostTotal}，满足20档，未满足30档`;
  return `${getAbilityEffectText(abilityId)}（${tierText}）`;
}

function finishHsBp6029ProofTopCardSelection(
  game: GameState,
  selectedCardId: string | null,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !==
      HS_BP6_029_LIVE_START_HASUNOSORA_COST_LOOK_TOP_TWO_HAND_REDUCE_REQUIREMENT_ABILITY_ID ||
    effect.stepId !== HS_BP6_029_SELECT_TOP_CARD_TO_HAND_STEP_ID ||
    selectedCardId === null ||
    effect.selectableCardIds?.includes(selectedCardId) !== true
  ) {
    return game;
  }

  const player = getPlayerById(game, effect.controllerId);
  const inspectedCardIds = effect.inspectionCardIds ?? [];
  if (!player || !inspectedCardIds.includes(selectedCardId)) {
    return game;
  }

  const movedState = moveInspectedTopSelectionToHandRestToDeckTop(
    game,
    player.id,
    inspectedCardIds,
    selectedCardId
  );
  if (!movedState) {
    return game;
  }
  const returnedCardIds = inspectedCardIds.filter((cardId) => cardId !== selectedCardId);

  return continuePendingCardEffects(
    addAction({ ...movedState, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'MOVE_SELECTED_TOP_CARD_TO_HAND_RETURN_REST',
      hasunosoraCostTotal: effect.metadata?.hasunosoraCostTotal,
      selectedCardId,
      returnedCardIds,
      requirementReduction: effect.metadata?.requirementReduction,
    }),
    effect.metadata?.orderedResolution === true
  );
}

function moveInspectedTopSelectionToHandRestToDeckTop(
  game: GameState,
  playerId: string,
  inspectedCardIds: readonly string[],
  selectedCardId: string
): GameState | null {
  if (!inspectedCardIds.includes(selectedCardId)) {
    return null;
  }
  const player = getPlayerById(game, playerId);
  if (!player) {
    return null;
  }

  const returnedCardIds = inspectedCardIds.filter((cardId) => cardId !== selectedCardId);
  const state = updatePlayer(game, player.id, (currentPlayer) => ({
    ...currentPlayer,
    hand: {
      ...currentPlayer.hand,
      cardIds: [...currentPlayer.hand.cardIds, selectedCardId],
    },
    mainDeck: {
      ...currentPlayer.mainDeck,
      cardIds: [...returnedCardIds, ...currentPlayer.mainDeck.cardIds],
    },
  }));

  return clearInspectionCards(state, inspectedCardIds);
}

function applyRequirementReduction(
  game: GameState,
  liveCardId: string,
  abilityId: string,
  requirementReduction: number
): GameState {
  return replaceLiveModifier(
    game,
    {
      kind: 'REQUIREMENT',
      liveCardId,
      abilityId,
      sourceCardId: liveCardId,
    },
    requirementReduction > 0
      ? {
          kind: 'REQUIREMENT',
          liveCardId,
          modifiers: [{ color: HeartColor.RAINBOW, countDelta: -requirementReduction }],
          sourceCardId: liveCardId,
          abilityId,
        }
      : null
  );
}
