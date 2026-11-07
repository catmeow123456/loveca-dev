import { isMemberCardData } from '../../../../domain/entities/card.js';
import {
  addAction,
  getCardById,
  getOpponent,
  getPlayerById,
  type ActiveEffectState,
  type GameState,
} from '../../../../domain/entities/game.js';
import { getMemberEffectiveCost } from '../../../../domain/rules/member-effective-cost.js';
import { CardType, GamePhase, OrientationState } from '../../../../shared/types/enums.js';
import { cardCodeMatchesBase } from '../../../../shared/utils/card-code.js';
import { groupAliasIs, typeIs } from '../../../effects/card-selectors.js';
import { hasStageMemberMatching } from '../../../effects/conditions.js';
import {
  createStageMemberOrientationTargetSelection,
  resolveStageMemberOrientationTargetSelection,
} from '../../../effects/stage-member-target-selection.js';
import { N_BP8_008_ACTIVATED_REVEAL_SELF_HAND_BOTTOM_WAIT_OPPONENT_ABILITY_ID as ABILITY_ID } from '../../ability-ids.js';
import { getStageMemberLifecycleId } from '../../runtime/ability-source-lifecycle.js';
import { moveHandCardToDeckBottomForPlayer } from '../../runtime/actions.js';
import { registerActivatedAbilityHandler } from '../../runtime/activated-registry.js';
import {
  enqueueMemberStateChangedTriggersFromOrientationResult,
  type EnqueueTriggeredCardEffectsForMemberStateChanged,
} from '../../runtime/member-state-changed-triggers.js';
import { withPublicRevealDwell } from '../../runtime/public-reveal-dwell.js';
import { queryCardSelection, queryConfirmSelection } from '../../runtime/selection-query.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import {
  getAbilityEffectText,
  recordAbilityUseForContext,
  recordPayCostAction,
} from '../../runtime/workflow-helpers.js';

const BASE_CARD_CODE = 'PL!N-bp8-008';
const PLACE_BOTTOM = 'N_BP8_008_PLACE_SELF_BOTTOM';
const WAIT_OPPONENT = 'N_BP8_008_WAIT_OPPONENT_MEMBER';
const NIJIGASAKI = groupAliasIs('虹ヶ咲');

type Continue = (game: GameState, orderedResolution: boolean) => GameState;

export function registerNBp8008EmmaVerdeWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForMemberStateChanged;
}): void {
  registerActivatedAbilityHandler(ABILITY_ID, revealSource, canStart);
  registerActiveEffectStepHandler(
    ABILITY_ID,
    PLACE_BOTTOM,
    (game, _input, context) => placeBottom(game, context.continuePendingCardEffects),
    queryConfirmSelection
  );
  registerActiveEffectStepHandler(
    ABILITY_ID,
    WAIT_OPPONENT,
    (game, input, context) =>
      waitTarget(
        game,
        input.selectedCardId ?? null,
        context.continuePendingCardEffects,
        deps.enqueueTriggeredCardEffects
      ),
    queryCardSelection
  );
}

function isSourceInHand(game: GameState, playerId: string, cardId: string): boolean {
  const source = getCardById(game, cardId);
  return (
    source !== null &&
    source.ownerId === playerId &&
    isMemberCardData(source.data) &&
    cardCodeMatchesBase(source.data.cardCode, BASE_CARD_CODE) &&
    getPlayerById(game, playerId)?.hand.cardIds.includes(cardId) === true
  );
}

function canStart(game: GameState, playerId: string, cardId: string): boolean {
  return (
    !game.activeEffect &&
    game.currentPhase === GamePhase.MAIN_PHASE &&
    game.players[game.activePlayerIndex]?.id === playerId &&
    isSourceInHand(game, playerId, cardId)
  );
}

function revealSource(game: GameState, playerId: string, cardId: string): GameState {
  const activeEffect = withPublicRevealDwell({
    id: `${ABILITY_ID}:${cardId}:turn-${game.turnCount}:action-${game.actionSequence}`,
    abilityId: ABILITY_ID,
    sourceCardId: cardId,
    controllerId: playerId,
    effectText: getAbilityEffectText(ABILITY_ID),
    stepId: PLACE_BOTTOM,
    stepText:
      '已公开手牌中的此卡。展示结束后将其放置于卡组底。若自己的舞台上有『虹咲』成员，再将对方1名费用小于等于2的成员变为待机状态。',
    awaitingPlayerId: playerId,
    revealedCardIds: [cardId],
  });
  const paid = recordPayCostAction({ ...game, activeEffect }, playerId, {
    abilityId: ABILITY_ID,
    sourceCardId: cardId,
    revealedCardIds: [cardId],
  });
  return recordAbilityUseForContext(paid, playerId, {
    abilityId: ABILITY_ID,
    sourceCardId: cardId,
  });
}

function placeBottom(game: GameState, continuation: Continue): GameState {
  const effect = game.activeEffect;
  if (!effect) return game;
  const { controllerId, sourceCardId } = effect;
  // Paying the reveal is independent of the move and the later target selection.
  const moved = isSourceInHand(game, controllerId, sourceCardId)
    ? moveHandCardToDeckBottomForPlayer(game, controllerId, sourceCardId, {
        candidateCardIds: [sourceCardId],
      })
    : null;
  const state = addAction(moved?.gameState ?? game, 'RESOLVE_ABILITY', controllerId, {
    abilityId: ABILITY_ID,
    sourceCardId,
    step: PLACE_BOTTOM,
    movedCardIds: moved ? [moved.movedCardId] : [],
  });
  const targeting = { ...state, activeEffect: createTargetEffect(state, effect) };
  return targeting.activeEffect ? targeting : continuation(targeting, false);
}

function createTargetEffect(game: GameState, effect: ActiveEffectState): ActiveEffectState | null {
  const opponent = getOpponent(game, effect.controllerId);
  if (!opponent || !hasStageMemberMatching(game, effect.controllerId, NIJIGASAKI)) return null;

  const selection = createStageMemberOrientationTargetSelection(game, {
    ability: effect,
    effectText: effect.effectText,
    stepId: WAIT_OPPONENT,
    stepText: '请选择对方舞台上1名费用小于等于2的成员变为待机状态。',
    awaitingPlayerId: effect.controllerId,
    targetPlayerId: opponent.id,
    selector: typeIs(CardType.MEMBER),
    statePredicate: (state, playerId, id) => getMemberEffectiveCost(state, playerId, id) <= 2,
    targetOrientation: OrientationState.WAITING,
    selectionLabel: '选择要变为待机状态的成员',
    confirmSelectionLabel: '变为待机状态',
    orderedResolution: false,
  });
  return (
    selection.activeEffect && {
      ...selection.activeEffect,
      selectableCardMode: 'SINGLE',
      canSkipSelection: false,
      metadata: {
        ...selection.activeEffect.metadata,
        targetLifecycles: Object.fromEntries(
          selection.selectableCardIds.map((id) => [id, getStageMemberLifecycleId(game, id)])
        ),
      },
    }
  );
}

function waitTarget(
  game: GameState,
  id: string | null,
  continuation: Continue,
  enqueue: EnqueueTriggeredCardEffectsForMemberStateChanged
): GameState {
  const effect = game.activeEffect;
  if (!effect || !id || !effect.selectableCardIds?.includes(id)) return game;
  const currentEffect = createTargetEffect(game, effect);
  if (!currentEffect) return continuation({ ...game, activeEffect: null }, false);

  const lifecycles = effect.metadata?.targetLifecycles as
    Readonly<Record<string, string>> | undefined;
  if (
    !currentEffect.selectableCardIds?.includes(id) ||
    lifecycles?.[id] !== getStageMemberLifecycleId(game, id)
  ) {
    return {
      ...game,
      activeEffect: {
        ...currentEffect,
        id: `${effect.id}:reselect`,
        sourceCardDisplayCode: effect.sourceCardDisplayCode,
      },
    };
  }
  const result = resolveStageMemberOrientationTargetSelection(game, currentEffect, id);
  if (!result?.changed) return continuation({ ...game, activeEffect: null }, false);

  const triggered = enqueueMemberStateChangedTriggersFromOrientationResult(game, result, enqueue, {
    prepareGameStateBeforeEnqueue: (state) =>
      addAction({ ...state, activeEffect: null }, 'RESOLVE_ABILITY', effect.controllerId, {
        abilityId: ABILITY_ID,
        sourceCardId: effect.sourceCardId,
        step: WAIT_OPPONENT,
        targetMemberCardId: id,
      }),
  });
  return continuation(triggered.gameState, false);
}
