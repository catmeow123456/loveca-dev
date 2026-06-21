import { isMemberCardData } from '../../../../domain/entities/card.js';
import {
  addAction,
  getCardById,
  getPlayerById,
  updatePlayer,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { HS_PB1_005_LIVE_START_CHOOSE_NUMBER_REVEAL_TOP_HAND_OR_BLADE_ABILITY_ID } from '../../ability-ids.js';
import { startPendingActiveEffect } from '../../runtime/active-effect.js';
import { addBladeLiveModifierForSourceMember } from '../../runtime/actions.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText } from '../../runtime/workflow-helpers.js';
import { clearInspectionCards, inspectTopCards } from '../../../effects/look-top.js';

const CHOOSE_NUMBER_STEP_ID = 'HS_PB1_005_CHOOSE_NUMBER';
const CONFIRM_REVEALED_TOP_STEP_ID = 'HS_PB1_005_CONFIRM_REVEALED_TOP';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerHsPb1005KosuzuWorkflowHandlers(): void {
  registerPendingAbilityStarterHandler(
    HS_PB1_005_LIVE_START_CHOOSE_NUMBER_REVEAL_TOP_HAND_OR_BLADE_ABILITY_ID,
    (game, ability, options, context) =>
      startHsPb1005KosuzuLiveStart(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      )
  );
  registerActiveEffectStepHandler(
    HS_PB1_005_LIVE_START_CHOOSE_NUMBER_REVEAL_TOP_HAND_OR_BLADE_ABILITY_ID,
    CHOOSE_NUMBER_STEP_ID,
    (game, input, context) =>
      finishChooseNumberRevealTop(game, input.selectedNumber, context.continuePendingCardEffects)
  );
  registerActiveEffectStepHandler(
    HS_PB1_005_LIVE_START_CHOOSE_NUMBER_REVEAL_TOP_HAND_OR_BLADE_ABILITY_ID,
    CONFIRM_REVEALED_TOP_STEP_ID,
    (game, _input, context) => finishRevealedTopResolution(game, context.continuePendingCardEffects)
  );
}

function startHsPb1005KosuzuLiveStart(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  if (player.mainDeck.cardIds.length === 0) {
    return skipPendingAbilityWithoutActiveEffect(
      game,
      ability,
      player.id,
      orderedResolution,
      'NO_TOP_CARD',
      continuePendingCardEffects
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
      effectText: getAbilityEffectText(ability.abilityId),
      stepId: CHOOSE_NUMBER_STEP_ID,
      stepText: '请选择一个大于等于0的整数。',
      awaitingPlayerId: player.id,
      numericInput: {
        min: 0,
        integerOnly: true,
        label: '选择数字',
        placeholder: '0',
        confirmLabel: '公开卡组顶',
      },
      metadata: {
        orderedResolution,
        sourceSlot: ability.sourceSlot,
      },
    },
    actionPayload: {
      sourceCardId: ability.sourceCardId,
      step: 'START_CHOOSE_NUMBER',
      sourceSlot: ability.sourceSlot,
    },
  });
}

function finishChooseNumberRevealTop(
  game: GameState,
  selectedNumber: number | null | undefined,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !== HS_PB1_005_LIVE_START_CHOOSE_NUMBER_REVEAL_TOP_HAND_OR_BLADE_ABILITY_ID ||
    effect.stepId !== CHOOSE_NUMBER_STEP_ID ||
    typeof selectedNumber !== 'number' ||
    !Number.isFinite(selectedNumber) ||
    !Number.isInteger(selectedNumber) ||
    selectedNumber < 0
  ) {
    return game;
  }

  const player = getPlayerById(game, effect.controllerId);
  if (!player) {
    return game;
  }

  const inspectResult = inspectTopCards(game, player.id, { count: 1, reveal: true });
  const inspectedCardId = inspectResult?.inspectedCardIds[0] ?? null;
  if (!inspectResult || !inspectedCardId) {
    return continuePendingCardEffects(
      addAction({ ...game, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
        pendingAbilityId: effect.id,
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
        step: 'NO_TOP_CARD_AFTER_NUMBER',
        selectedNumber,
      }),
      effect.metadata?.orderedResolution === true
    );
  }

  return addAction(
    {
      ...inspectResult.gameState,
      activeEffect: {
        ...effect,
        stepId: CONFIRM_REVEALED_TOP_STEP_ID,
        stepText: '卡组顶的卡已公开。确认后按选择的数字结算。',
        inspectionCardIds: inspectResult.inspectedCardIds,
        revealedCardIds: inspectResult.inspectedCardIds,
        numericInput: undefined,
        metadata: {
          ...effect.metadata,
          selectedNumber,
        },
      },
    },
    'RESOLVE_ABILITY',
    player.id,
    {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'REVEAL_TOP_AFTER_NUMBER',
      selectedNumber,
      revealedCardId: inspectedCardId,
    }
  );
}

function finishRevealedTopResolution(
  game: GameState,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !== HS_PB1_005_LIVE_START_CHOOSE_NUMBER_REVEAL_TOP_HAND_OR_BLADE_ABILITY_ID ||
    effect.stepId !== CONFIRM_REVEALED_TOP_STEP_ID
  ) {
    return game;
  }

  const player = getPlayerById(game, effect.controllerId);
  const revealedCardId = effect.inspectionCardIds?.[0] ?? null;
  const selectedNumber =
    typeof effect.metadata?.selectedNumber === 'number' ? effect.metadata.selectedNumber : null;
  if (!player || !revealedCardId || selectedNumber === null) {
    return game;
  }

  const revealedCard = getCardById(game, revealedCardId);
  const revealedMemberCost = revealedCard && isMemberCardData(revealedCard.data)
    ? revealedCard.data.cost
    : null;
  const addToHand = revealedMemberCost !== null && revealedMemberCost >= selectedNumber;
  const gainBlade = revealedMemberCost !== null && revealedMemberCost <= selectedNumber;

  let state = updatePlayer(game, player.id, (currentPlayer) => ({
    ...currentPlayer,
    hand: addToHand
      ? {
          ...currentPlayer.hand,
          cardIds: [...currentPlayer.hand.cardIds, revealedCardId],
        }
      : currentPlayer.hand,
    mainDeck: addToHand
      ? currentPlayer.mainDeck
      : {
          ...currentPlayer.mainDeck,
          cardIds: [revealedCardId, ...currentPlayer.mainDeck.cardIds],
        },
  }));
  state = {
    ...clearInspectionCards(state, [revealedCardId]),
    activeEffect: null,
  };

  if (gainBlade) {
    const bladeResult = addBladeLiveModifierForSourceMember(state, {
      playerId: player.id,
      sourceCardId: effect.sourceCardId,
      abilityId: effect.abilityId,
      amount: 2,
    });
    if (!bladeResult) {
      return game;
    }
    state = bladeResult.gameState;
  }

  return continuePendingCardEffects(
    addAction(state, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'RESOLVE_REVEALED_TOP_BY_CHOSEN_NUMBER',
      selectedNumber,
      revealedCardId,
      revealedMemberCost,
      addedToHand: addToHand,
      returnedToDeckTop: !addToHand,
      bladeBonus: gainBlade ? 2 : 0,
    }),
    effect.metadata?.orderedResolution === true
  );
}

function skipPendingAbilityWithoutActiveEffect(
  game: GameState,
  ability: PendingAbilityState,
  playerId: string,
  orderedResolution: boolean,
  step: string,
  continuePendingCardEffects: ContinuePendingCardEffects
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
      step,
      sourceSlot: ability.sourceSlot,
    }),
    orderedResolution
  );
}
