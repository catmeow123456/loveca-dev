import { isLiveCardData, isMemberCardData } from '../../../../domain/entities/card.js';
import {
  addAction,
  getCardById,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { findMemberSlot } from '../../../../domain/entities/player.js';
import {
  CardType,
  GamePhase,
  ZoneType,
} from '../../../../shared/types/enums.js';
import { cardCodeMatchesBase } from '../../../../shared/utils/card-code.js';
import {
  HS_BP5_001_ACTIVATED_REVEAL_HAND_LIVE_RECOVER_SAME_NAME_LIVE_ABILITY_ID,
  HS_BP5_001_ON_ENTER_MILL_GAIN_BLADE_ABILITY_ID,
} from '../../ability-ids.js';
import {
  revealHandCardForActiveEffect,
  startConfirmOnlyPendingAbilityEffect,
} from '../../runtime/active-effect.js';
import { registerActivatedAbilityHandler } from '../../runtime/activated-registry.js';
import { addBladeLiveModifierForSourceMember } from '../../runtime/actions.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import {
  getAbilityEffectText,
  recordPayCostAction,
  recordAbilityUseForContext,
} from '../../runtime/workflow-helpers.js';
import {
  and,
  cardNameContains,
  typeIs,
} from '../../../effects/card-selectors.js';
import {
  getCardIdsInZoneMatching,
  getCardIdsMatchingSelector,
  hasCardIdsMatchingSelector,
} from '../../../effects/conditions.js';
import { payImmediateEffectCosts } from '../../../effects/effect-costs.js';
import {
  inspectTopCards,
  moveInspectedCardsToWaitingRoom,
} from '../../../effects/look-top.js';
import {
  createWaitingRoomToHandEffectState,
  createWaitingRoomToHandSelectionConfig,
} from '../../../effects/zone-selection.js';
import { finishWaitingRoomToHandWorkflow } from '../shared/waiting-room-to-hand.js';

const HS_BP5_001_SELECT_HAND_LIVE_STEP_ID = 'HS_BP5_001_SELECT_HAND_LIVE_TO_REVEAL';
const HS_BP5_001_REVEAL_HAND_LIVE_STEP_ID = 'HS_BP5_001_REVEAL_HAND_LIVE';
const HS_BP5_001_SELECT_WAITING_ROOM_LIVE_STEP_ID =
  'HS_BP5_001_SELECT_WAITING_ROOM_SAME_NAME_LIVE';
const HS_BP5_001_REVEAL_TOP_FOUR_STEP_ID = 'HS_BP5_001_REVEAL_TOP_FOUR';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerHsBp5001KahoWorkflowHandlers(): void {
  registerPendingAbilityStarterHandler(
    HS_BP5_001_ON_ENTER_MILL_GAIN_BLADE_ABILITY_ID,
    (game, ability, options) =>
      startHsBp5KahoOnEnterMillGainBladeInspection(game, ability, {
        orderedResolution: options.orderedResolution === true,
        manualConfirmation: options.manualConfirmation === true,
        skipManualConfirmation: options.skipManualConfirmation === true,
      })
  );
  registerActiveEffectStepHandler(
    HS_BP5_001_ON_ENTER_MILL_GAIN_BLADE_ABILITY_ID,
    HS_BP5_001_REVEAL_TOP_FOUR_STEP_ID,
    (game, _input, context) =>
      finishHsBp5KahoOnEnterMillGainBlade(game, context.continuePendingCardEffects)
  );
  registerActivatedAbilityHandler(
    HS_BP5_001_ACTIVATED_REVEAL_HAND_LIVE_RECOVER_SAME_NAME_LIVE_ABILITY_ID,
    startHsBp5KahoActivatedRevealHandLiveRecoverSameNameLive
  );
  registerActiveEffectStepHandler(
    HS_BP5_001_ACTIVATED_REVEAL_HAND_LIVE_RECOVER_SAME_NAME_LIVE_ABILITY_ID,
    HS_BP5_001_SELECT_HAND_LIVE_STEP_ID,
    (game, input) => revealHsBp5KahoActivatedHandLive(game, input.selectedCardId ?? null)
  );
  registerActiveEffectStepHandler(
    HS_BP5_001_ACTIVATED_REVEAL_HAND_LIVE_RECOVER_SAME_NAME_LIVE_ABILITY_ID,
    HS_BP5_001_REVEAL_HAND_LIVE_STEP_ID,
    (game) => startHsBp5KahoActivatedSelectSameNameLive(game)
  );
  registerActiveEffectStepHandler(
    HS_BP5_001_ACTIVATED_REVEAL_HAND_LIVE_RECOVER_SAME_NAME_LIVE_ABILITY_ID,
    HS_BP5_001_SELECT_WAITING_ROOM_LIVE_STEP_ID,
    (game, input, context) =>
      finishWaitingRoomToHandWorkflow(
        game,
        input.selectedCardId ?? null,
        input.selectedCardIds,
        context.continuePendingCardEffects
      )
  );
}

function startHsBp5KahoOnEnterMillGainBladeInspection(
  game: GameState,
  ability: PendingAbilityState,
  options: {
    readonly orderedResolution: boolean;
    readonly manualConfirmation: boolean;
    readonly skipManualConfirmation: boolean;
  }
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }
  if (options.manualConfirmation && !options.skipManualConfirmation) {
    return startConfirmOnlyPendingAbilityEffect(game, {
      ability,
      effectText: getAbilityEffectText(HS_BP5_001_ON_ENTER_MILL_GAIN_BLADE_ABILITY_ID),
      orderedResolution: options.orderedResolution,
    });
  }

  const inspection = inspectTopCards(game, player.id, {
    count: 4,
    reveal: true,
  });
  if (!inspection) {
    return game;
  }
  const { gameState, inspectedCardIds } = inspection;
  const state: GameState = {
    ...gameState,
    pendingAbilities: gameState.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
    activeEffect: {
      id: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      controllerId: ability.controllerId,
      effectText: getAbilityEffectText(HS_BP5_001_ON_ENTER_MILL_GAIN_BLADE_ABILITY_ID),
      stepId: HS_BP5_001_REVEAL_TOP_FOUR_STEP_ID,
      stepText: '卡组顶4张已公开。确认后将这些牌放入休息室，并在其中有LIVE卡时获得[BLADE][BLADE]。',
      awaitingPlayerId: player.id,
      inspectionCardIds: inspectedCardIds,
      metadata: {
        sourceZone: ZoneType.MAIN_DECK,
        orderedResolution: options.orderedResolution,
      },
    },
  };

  return addAction(state, 'RESOLVE_ABILITY', player.id, {
    pendingAbilityId: ability.id,
    abilityId: ability.abilityId,
    sourceCardId: ability.sourceCardId,
    step: 'START_INSPECTION',
    inspectedCardIds,
  });
}

function finishHsBp5KahoOnEnterMillGainBlade(
  game: GameState,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !== HS_BP5_001_ON_ENTER_MILL_GAIN_BLADE_ABILITY_ID ||
    effect.stepId !== HS_BP5_001_REVEAL_TOP_FOUR_STEP_ID
  ) {
    return game;
  }
  const player = getPlayerById(game, effect.controllerId);
  if (!player) {
    return game;
  }

  const inspectedCardIds = effect.inspectionCardIds ?? [];
  const hasLiveCard = hasCardIdsMatchingSelector(game, inspectedCardIds, typeIs(CardType.LIVE));
  const liveCardIds = hasLiveCard
    ? getCardIdsMatchingSelector(game, inspectedCardIds, typeIs(CardType.LIVE))
    : [];
  const bladeBonus = hasLiveCard ? 2 : 0;
  const moveResult = moveInspectedCardsToWaitingRoom(game, player.id, inspectedCardIds);
  if (!moveResult) {
    return game;
  }
  let stateAfterModifier = moveResult.gameState;
  if (bladeBonus > 0) {
    const bladeResult = addBladeLiveModifierForSourceMember(moveResult.gameState, {
      playerId: player.id,
      sourceCardId: effect.sourceCardId,
      abilityId: effect.abilityId,
      amount: bladeBonus,
    });
    if (!bladeResult) {
      return game;
    }
    stateAfterModifier = bladeResult.gameState;
  }
  const state: GameState = {
    ...stateAfterModifier,
    inspectionContext:
      stateAfterModifier.inspectionZone.cardIds.length > 0
        ? stateAfterModifier.inspectionContext
        : null,
    activeEffect: null,
  };

  return continuePendingCardEffects(
    addAction(state, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'MILL_TOP_FOUR_GAIN_BLADE_IF_LIVE',
      milledCardIds: moveResult.movedCardIds,
      liveCardIds,
      bladeBonus,
    }),
    effect.metadata?.orderedResolution === true
  );
}

function startHsBp5KahoActivatedRevealHandLiveRecoverSameNameLive(
  game: GameState,
  playerId: string,
  cardId: string
): GameState {
  if (game.activeEffect || game.currentPhase !== GamePhase.MAIN_PHASE) {
    return game;
  }
  const activePlayerId = game.players[game.activePlayerIndex]?.id ?? null;
  const player = getPlayerById(game, playerId);
  const sourceCard = getCardById(game, cardId);
  if (
    activePlayerId !== playerId ||
    !player ||
    !sourceCard ||
    sourceCard.ownerId !== playerId ||
    !cardCodeMatchesBase(sourceCard.data.cardCode, 'PL!HS-bp5-001') ||
    !isMemberCardData(sourceCard.data) ||
    !findMemberSlot(player, cardId)
  ) {
    return game;
  }

  const selectableHandLiveCardIds = player.hand.cardIds.filter((handCardId) => {
    const handCard = getCardById(game, handCardId);
    return (
      handCard !== null &&
      isLiveCardData(handCard.data) &&
      getSameNameWaitingRoomLiveCardIds(game, player.id, handCardId).length > 0
    );
  });
  if (selectableHandLiveCardIds.length === 0) {
    return game;
  }

  let state = recordAbilityUseForContext(game, player.id, {
    abilityId: HS_BP5_001_ACTIVATED_REVEAL_HAND_LIVE_RECOVER_SAME_NAME_LIVE_ABILITY_ID,
    sourceCardId: cardId,
  });
  const costPayment = payImmediateEffectCosts(state, player.id, cardId, [
    { kind: 'TAP_ACTIVE_ENERGY', count: 2 },
  ]);
  if (!costPayment) {
    return game;
  }
  state = recordPayCostAction(costPayment.gameState, player.id, {
    abilityId: HS_BP5_001_ACTIVATED_REVEAL_HAND_LIVE_RECOVER_SAME_NAME_LIVE_ABILITY_ID,
    sourceCardId: cardId,
    energyCardIds: costPayment.paidEnergyCardIds,
    amount: costPayment.paidEnergyCardIds.length,
  });

  state = {
    ...state,
    activeEffect: {
      id: `${HS_BP5_001_ACTIVATED_REVEAL_HAND_LIVE_RECOVER_SAME_NAME_LIVE_ABILITY_ID}:${cardId}:turn-${state.turnCount}:action-${state.actionHistory.length}`,
      abilityId: HS_BP5_001_ACTIVATED_REVEAL_HAND_LIVE_RECOVER_SAME_NAME_LIVE_ABILITY_ID,
      sourceCardId: cardId,
      controllerId: player.id,
      effectText: getAbilityEffectText(HS_BP5_001_ACTIVATED_REVEAL_HAND_LIVE_RECOVER_SAME_NAME_LIVE_ABILITY_ID),
      stepId: HS_BP5_001_SELECT_HAND_LIVE_STEP_ID,
      stepText: '请选择手牌中1张LIVE卡公开。之后可从休息室将1张包含该卡卡名的LIVE卡加入手牌。',
      awaitingPlayerId: player.id,
      selectableCardIds: selectableHandLiveCardIds,
      selectableCardVisibility: 'AWAITING_PLAYER_ONLY',
      canSkipSelection: false,
      selectionLabel: '选择要公开的手牌LIVE',
      confirmSelectionLabel: '公开',
      metadata: {
        paidEnergyCardIds: costPayment.paidEnergyCardIds,
      },
    },
  };

  return addAction(state, 'RESOLVE_ABILITY', player.id, {
    abilityId: HS_BP5_001_ACTIVATED_REVEAL_HAND_LIVE_RECOVER_SAME_NAME_LIVE_ABILITY_ID,
    sourceCardId: cardId,
    step: 'PAY_COST_SELECT_HAND_LIVE',
    paidEnergyCardIds: costPayment.paidEnergyCardIds,
    selectableCardIds: selectableHandLiveCardIds,
  });
}

function revealHsBp5KahoActivatedHandLive(
  game: GameState,
  selectedHandLiveCardId: string | null
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !== HS_BP5_001_ACTIVATED_REVEAL_HAND_LIVE_RECOVER_SAME_NAME_LIVE_ABILITY_ID ||
    effect.stepId !== HS_BP5_001_SELECT_HAND_LIVE_STEP_ID ||
    selectedHandLiveCardId === null ||
    effect.selectableCardIds?.includes(selectedHandLiveCardId) !== true
  ) {
    return game;
  }
  const player = getPlayerById(game, effect.controllerId);
  if (!player || !player.hand.cardIds.includes(selectedHandLiveCardId)) {
    return game;
  }

  const revealedHandLive = getCardById(game, selectedHandLiveCardId);
  if (!revealedHandLive) {
    return game;
  }

  return revealHandCardForActiveEffect(game, {
    effect,
    playerId: player.id,
    selectedCardId: selectedHandLiveCardId,
    nextStepId: HS_BP5_001_REVEAL_HAND_LIVE_STEP_ID,
    nextStepText: '已公开手牌LIVE。确认后从休息室选择1张同名LIVE卡加入手牌。',
    selectableCardIds: [],
    selectableCardVisibility: 'PUBLIC',
    canSkipSelection: false,
    metadata: {
      revealedHandLiveCardId: selectedHandLiveCardId,
      revealedHandLiveCardName: revealedHandLive.data.name,
    },
    actionStep: 'REVEAL_HAND_LIVE',
    actionPayload: {
      revealedHandLiveCardId: selectedHandLiveCardId,
      revealedHandLiveCardName: revealedHandLive.data.name,
    },
  });
}

function startHsBp5KahoActivatedSelectSameNameLive(game: GameState): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !== HS_BP5_001_ACTIVATED_REVEAL_HAND_LIVE_RECOVER_SAME_NAME_LIVE_ABILITY_ID ||
    effect.stepId !== HS_BP5_001_REVEAL_HAND_LIVE_STEP_ID ||
    typeof effect.metadata?.revealedHandLiveCardId !== 'string'
  ) {
    return game;
  }
  const player = getPlayerById(game, effect.controllerId);
  const selectedHandLiveCardId = effect.metadata.revealedHandLiveCardId;
  if (!player || !player.hand.cardIds.includes(selectedHandLiveCardId)) {
    return game;
  }

  const selectableCardIds = getSameNameWaitingRoomLiveCardIds(
    game,
    player.id,
    selectedHandLiveCardId
  );
  if (selectableCardIds.length === 0) {
    return game;
  }

  const revealedHandLive = getCardById(game, selectedHandLiveCardId);
  const state = {
    ...game,
    activeEffect: createWaitingRoomToHandEffectState({
      id: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      controllerId: player.id,
      effectText: getAbilityEffectText(HS_BP5_001_ACTIVATED_REVEAL_HAND_LIVE_RECOVER_SAME_NAME_LIVE_ABILITY_ID),
      stepId: HS_BP5_001_SELECT_WAITING_ROOM_LIVE_STEP_ID,
      stepText: '已公开手牌LIVE。请选择休息室中1张同名LIVE卡加入手牌。',
      awaitingPlayerId: player.id,
      selectableCardIds,
      canSkipSelection: false,
      metadata: {
        ...effect.metadata,
        revealedHandLiveCardId: selectedHandLiveCardId,
        revealedHandLiveCardName: revealedHandLive?.data.name ?? null,
      },
      zoneSelection: createWaitingRoomToHandSelectionConfig({
        minCount: 1,
        maxCount: 1,
        optional: false,
      }),
    }),
  };

  return addAction(state, 'RESOLVE_ABILITY', player.id, {
    pendingAbilityId: effect.id,
    abilityId: effect.abilityId,
    sourceCardId: effect.sourceCardId,
    step: 'REVEAL_HAND_LIVE_SELECT_WAITING_ROOM_SAME_NAME_LIVE',
    revealedHandLiveCardId: selectedHandLiveCardId,
    revealedHandLiveCardName: revealedHandLive?.data.name ?? null,
    selectableCardIds,
  });
}

function getSameNameWaitingRoomLiveCardIds(
  game: GameState,
  playerId: string,
  revealedLiveCardId: string
): readonly string[] {
  const revealedLiveCard = getCardById(game, revealedLiveCardId);
  if (!revealedLiveCard || !isLiveCardData(revealedLiveCard.data)) {
    return [];
  }
  return getCardIdsInZoneMatching(
    game,
    playerId,
    ZoneType.WAITING_ROOM,
    and(typeIs(CardType.LIVE), cardNameContains(revealedLiveCard.data.name))
  );
}
