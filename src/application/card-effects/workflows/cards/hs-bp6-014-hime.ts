import { isMemberCardData } from '../../../../domain/entities/card.js';
import {
  addAction,
  getCardById,
  getPlayerById,
  type GameState,
} from '../../../../domain/entities/game.js';
import { addLiveModifier } from '../../../../domain/rules/live-modifiers.js';
import { GamePhase, SlotPosition, TriggerCondition } from '../../../../shared/types/enums.js';
import { cardCodeMatchesBase } from '../../../../shared/utils/card-code.js';
import { cardNameAliasAny } from '../../../effects/card-selectors.js';
import {
  discardOneHandCardToWaitingRoomAndEnqueueTriggers,
  type EnqueueTriggeredCardEffectsForEnterWaitingRoom,
} from '../../runtime/enter-waiting-room-triggers.js';
import { registerActivatedAbilityHandler } from '../../runtime/activated-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import {
  getAbilityEffectText,
  recordAbilityUseForContext,
} from '../../runtime/workflow-helpers.js';
import { drawCardsForPlayer } from '../../runtime/actions.js';
import { HS_BP6_014_ACTIVATED_HAND_DISCARD_SELF_DRAW_TARGET_MEGU_RURINO_BLADE_ABILITY_ID } from '../../ability-ids.js';

export const HS_BP6_014_SELECT_MEGU_RURINO_BLADE_TARGET_STEP_ID =
  'HS_BP6_014_SELECT_MEGU_RURINO_BLADE_TARGET';

const TARGET_SELECTOR = cardNameAliasAny(['藤島慈', '大沢瑠璃乃']);
const STAGE_SLOT_ORDER = [SlotPosition.LEFT, SlotPosition.CENTER, SlotPosition.RIGHT] as const;

export function registerHsBp6014HimeWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom;
}): void {
  registerActivatedAbilityHandler(
    HS_BP6_014_ACTIVATED_HAND_DISCARD_SELF_DRAW_TARGET_MEGU_RURINO_BLADE_ABILITY_ID,
    (game, playerId, cardId) =>
      startHsBp6014HimeHandActivated(game, playerId, cardId, deps.enqueueTriggeredCardEffects)
  );
  registerActiveEffectStepHandler(
    HS_BP6_014_ACTIVATED_HAND_DISCARD_SELF_DRAW_TARGET_MEGU_RURINO_BLADE_ABILITY_ID,
    HS_BP6_014_SELECT_MEGU_RURINO_BLADE_TARGET_STEP_ID,
    (game, input) => finishHsBp6014HimeBladeTarget(game, input.selectedCardId ?? null)
  );
}

function startHsBp6014HimeHandActivated(
  game: GameState,
  playerId: string,
  cardId: string,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom
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
    !isMemberCardData(sourceCard.data) ||
    !cardCodeMatchesBase(sourceCard.data.cardCode, 'PL!HS-bp6-014') ||
    !player.hand.cardIds.includes(cardId)
  ) {
    return game;
  }

  const discardResult = discardOneHandCardToWaitingRoomAndEnqueueTriggers(
    game,
    player.id,
    cardId,
    { candidateCardIds: [cardId] },
    enqueueTriggeredCardEffects
  );
  if (!discardResult) {
    return game;
  }

  let state = recordAbilityUseForContext(discardResult.gameState, player.id, {
    abilityId: HS_BP6_014_ACTIVATED_HAND_DISCARD_SELF_DRAW_TARGET_MEGU_RURINO_BLADE_ABILITY_ID,
    sourceCardId: cardId,
  });
  const drawResult = drawCardsForPlayer(state, player.id, 1);
  if (!drawResult) {
    return game;
  }
  state = drawResult.gameState;

  const targetCardIds = getMeguRurinoStageTargetIds(state, player.id);
  if (targetCardIds.length === 0) {
    return addAction(state, 'RESOLVE_ABILITY', player.id, {
      abilityId: HS_BP6_014_ACTIVATED_HAND_DISCARD_SELF_DRAW_TARGET_MEGU_RURINO_BLADE_ABILITY_ID,
      sourceCardId: cardId,
      effectText: getAbilityEffectText(
        HS_BP6_014_ACTIVATED_HAND_DISCARD_SELF_DRAW_TARGET_MEGU_RURINO_BLADE_ABILITY_ID
      ),
      step: 'DISCARD_SELF_DRAW_ONE_NO_TARGET',
      discardedCardIds: discardResult.discardedCardIds,
      drawnCardIds: drawResult.drawnCardIds,
      targetCardIds,
      bladeBonus: 0,
    });
  }

  return addAction(
    {
      ...state,
      activeEffect: {
        id: `${HS_BP6_014_ACTIVATED_HAND_DISCARD_SELF_DRAW_TARGET_MEGU_RURINO_BLADE_ABILITY_ID}:${cardId}:turn-${state.turnCount}:action-${state.actionHistory.length}`,
        abilityId:
          HS_BP6_014_ACTIVATED_HAND_DISCARD_SELF_DRAW_TARGET_MEGU_RURINO_BLADE_ABILITY_ID,
        sourceCardId: cardId,
        controllerId: player.id,
        effectText: getAbilityEffectText(
          HS_BP6_014_ACTIVATED_HAND_DISCARD_SELF_DRAW_TARGET_MEGU_RURINO_BLADE_ABILITY_ID
        ),
        stepId: HS_BP6_014_SELECT_MEGU_RURINO_BLADE_TARGET_STEP_ID,
        stepText:
          '请选择自己舞台上的1名「藤岛慈」或「大泽瑠璃乃」，LIVE结束时为止获得[BLADE]。',
        awaitingPlayerId: player.id,
        selectableCardIds: targetCardIds,
        minSelectableCards: 1,
        maxSelectableCards: 1,
        selectionLabel: '选择获得[BLADE]的成员',
        confirmSelectionLabel: '获得[BLADE]',
        metadata: {
          discardedCardIds: discardResult.discardedCardIds,
          drawnCardIds: drawResult.drawnCardIds,
        },
      },
    },
    'RESOLVE_ABILITY',
    player.id,
    {
      abilityId: HS_BP6_014_ACTIVATED_HAND_DISCARD_SELF_DRAW_TARGET_MEGU_RURINO_BLADE_ABILITY_ID,
      sourceCardId: cardId,
      step: 'DISCARD_SELF_DRAW_ONE_START_SELECT_TARGET',
      discardedCardIds: discardResult.discardedCardIds,
      drawnCardIds: drawResult.drawnCardIds,
      targetCardIds,
    }
  );
}

function finishHsBp6014HimeBladeTarget(
  game: GameState,
  selectedCardId: string | null
): GameState {
  const effect = game.activeEffect;
  const player = effect ? getPlayerById(game, effect.controllerId) : null;
  if (
    !effect ||
    effect.abilityId !==
      HS_BP6_014_ACTIVATED_HAND_DISCARD_SELF_DRAW_TARGET_MEGU_RURINO_BLADE_ABILITY_ID ||
    effect.stepId !== HS_BP6_014_SELECT_MEGU_RURINO_BLADE_TARGET_STEP_ID ||
    !player ||
    selectedCardId === null ||
    effect.selectableCardIds?.includes(selectedCardId) !== true ||
    !getMeguRurinoStageTargetIds(game, player.id).includes(selectedCardId)
  ) {
    return game;
  }

  const stateWithoutEffect: GameState = { ...game, activeEffect: null };
  const stateWithBlade = addLiveModifier(stateWithoutEffect, {
    kind: 'BLADE',
    playerId: player.id,
    countDelta: 1,
    sourceCardId: selectedCardId,
    abilityId: effect.abilityId,
  });

  return addAction(stateWithBlade, 'RESOLVE_ABILITY', player.id, {
    abilityId: effect.abilityId,
    sourceCardId: effect.sourceCardId,
    effectText: effect.effectText,
    step: 'TARGET_MEGU_RURINO_GAIN_BLADE',
    targetCardId: selectedCardId,
    discardedCardIds: effect.metadata?.discardedCardIds ?? [],
    drawnCardIds: effect.metadata?.drawnCardIds ?? [],
    bladeBonus: 1,
  });
}

function getMeguRurinoStageTargetIds(game: GameState, playerId: string): readonly string[] {
  const player = getPlayerById(game, playerId);
  if (!player) {
    return [];
  }

  return STAGE_SLOT_ORDER.map((slot) => player.memberSlots.slots[slot])
    .filter((cardId): cardId is string => typeof cardId === 'string')
    .filter((cardId) => {
      const card = getCardById(game, cardId);
      return !!card && card.ownerId === playerId && isMemberCardData(card.data) && TARGET_SELECTOR(card);
    });
}
