import { isLiveCardData, isMemberCardData } from '../../../../domain/entities/card.js';
import { addAction, getCardById, getOpponent, getPlayerById, type GameState, type LiveModifierState } from '../../../../domain/entities/game.js';
import { addLiveModifier } from '../../../../domain/rules/live-modifiers.js';
import { GamePhase, SubPhase } from '../../../../shared/types/enums.js';
import { cardCodeMatchesBase } from '../../../../shared/utils/card-code.js';
import { resolveBlindCardSelectionToken } from '../../../../shared/utils/blind-card-selection.js';
import { payImmediateEffectCosts } from '../../../effects/effect-costs.js';
import { PL_PB1_013_ACTIVATED_PAY_TWO_ENERGY_REVEAL_HAND_LIVE_SCORE_ABILITY_ID } from '../../ability-ids.js';
import { revealHandCardForActiveEffect } from '../../runtime/active-effect.js';
import { registerActivatedAbilityHandler } from '../../runtime/activated-registry.js';
import { getSourceMemberSlot } from '../../runtime/source-member.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText, recordAbilityUseForContext, recordPayCostAction } from '../../runtime/workflow-helpers.js';

const SELECT_HAND_CARD_STEP_ID = 'PL_PB1_013_SELECT_HAND_CARD';
const CONFIRM_REVEALED_HAND_CARD_STEP_ID = 'PL_PB1_013_CONFIRM_REVEALED_HAND_CARD';

export function registerPlPb1013UmiWorkflowHandlers(): void {
  registerActivatedAbilityHandler(PL_PB1_013_ACTIVATED_PAY_TWO_ENERGY_REVEAL_HAND_LIVE_SCORE_ABILITY_ID, startAbility);
  registerActiveEffectStepHandler(PL_PB1_013_ACTIVATED_PAY_TWO_ENERGY_REVEAL_HAND_LIVE_SCORE_ABILITY_ID, SELECT_HAND_CARD_STEP_ID, (game, input) => revealSelectedHandCard(game, input.selectedCardId ?? null));
  registerActiveEffectStepHandler(PL_PB1_013_ACTIVATED_PAY_TWO_ENERGY_REVEAL_HAND_LIVE_SCORE_ABILITY_ID, CONFIRM_REVEALED_HAND_CARD_STEP_ID, finishResolution);
}

function startAbility(game: GameState, playerId: string, sourceCardId: string): GameState {
  if (game.activeEffect || game.currentPhase !== GamePhase.MAIN_PHASE || game.currentSubPhase !== SubPhase.NONE || game.players[game.activePlayerIndex]?.id !== playerId) return game;
  const player = getPlayerById(game, playerId);
  const opponent = getOpponent(game, playerId);
  const sourceCard = getCardById(game, sourceCardId);
  if (!player || !opponent || !sourceCard || sourceCard.ownerId !== playerId || !isMemberCardData(sourceCard.data) || !cardCodeMatchesBase(sourceCard.data.cardCode, 'PL!-pb1-013') || getSourceMemberSlot(game, playerId, sourceCardId) === null || player.hand.cardIds.length === 0) return game;

  const payment = payImmediateEffectCosts(game, playerId, sourceCardId, [{ kind: 'TAP_ACTIVE_ENERGY', count: 2 }]);
  if (!payment) return game;
  let state = recordPayCostAction(payment.gameState, playerId, { abilityId: PL_PB1_013_ACTIVATED_PAY_TWO_ENERGY_REVEAL_HAND_LIVE_SCORE_ABILITY_ID, sourceCardId, energyCardIds: payment.paidEnergyCardIds, amount: payment.paidEnergyCardIds.length });
  state = recordAbilityUseForContext(state, playerId, { abilityId: PL_PB1_013_ACTIVATED_PAY_TWO_ENERGY_REVEAL_HAND_LIVE_SCORE_ABILITY_ID, sourceCardId });
  const selectableCardIds = [...player.hand.cardIds];
  return { ...state, activeEffect: {
    id: `${PL_PB1_013_ACTIVATED_PAY_TWO_ENERGY_REVEAL_HAND_LIVE_SCORE_ABILITY_ID}:${sourceCardId}:turn-${state.turnCount}:action-${state.actionHistory.length}`,
    abilityId: PL_PB1_013_ACTIVATED_PAY_TWO_ENERGY_REVEAL_HAND_LIVE_SCORE_ABILITY_ID,
    sourceCardId, controllerId: playerId,
    effectText: getAbilityEffectText(PL_PB1_013_ACTIVATED_PAY_TWO_ENERGY_REVEAL_HAND_LIVE_SCORE_ABILITY_ID),
    stepId: SELECT_HAND_CARD_STEP_ID, stepText: '请在不查看内容的情况下，从对方的手牌中选择1张并公开。', awaitingPlayerId: opponent.id,
    selectableCardIds, selectableCardVisibility: 'AWAITING_PLAYER_BLIND', selectableCardMode: 'SINGLE', minSelectableCards: 1, maxSelectableCards: 1,
    selectionLabel: '选择1张不可见的对方手牌', confirmSelectionLabel: '公开所选手牌', canSkipSelection: false,
    metadata: { initialCandidateCardIds: selectableCardIds },
  } };
}

function revealSelectedHandCard(game: GameState, selectedSelectionToken: string | null): GameState {
  const effect = game.activeEffect;
  if (!effect || effect.abilityId !== PL_PB1_013_ACTIVATED_PAY_TWO_ENERGY_REVEAL_HAND_LIVE_SCORE_ABILITY_ID || effect.stepId !== SELECT_HAND_CARD_STEP_ID) return game;
  const initialCandidateCardIds = stringArray(effect.metadata?.initialCandidateCardIds);
  const selectedCardId = resolveBlindCardSelectionToken(initialCandidateCardIds, selectedSelectionToken);
  if (!selectedCardId || !effect.selectableCardIds?.includes(selectedCardId)) return game;
  const player = getPlayerById(game, effect.controllerId);
  if (!player?.hand.cardIds.includes(selectedCardId)) return game;
  const revealed = revealHandCardForActiveEffect(game, { effect, playerId: player.id, selectedCardId,
    nextStepId: CONFIRM_REVEALED_HAND_CARD_STEP_ID,
    nextStepText: '已公开对方选择的手牌；确认后根据其是否为LIVE结算效果。',
    selectableCardIds: [], selectableCardVisibility: 'PUBLIC', selectableCardMode: undefined,
    selectionLabel: undefined, confirmSelectionLabel: undefined, canSkipSelection: false,
    metadata: { revealedHandCardId: selectedCardId }, actionStep: 'REVEAL_HAND', actionPayload: { revealedHandCardId: selectedCardId },
  });
  return revealed.activeEffect
    ? {
        ...revealed,
        activeEffect: {
          ...revealed.activeEffect,
          minSelectableCards: undefined,
          maxSelectableCards: undefined,
        },
      }
    : revealed;
}

function finishResolution(game: GameState): GameState {
  const effect = game.activeEffect;
  if (!effect || effect.abilityId !== PL_PB1_013_ACTIVATED_PAY_TWO_ENERGY_REVEAL_HAND_LIVE_SCORE_ABILITY_ID || effect.stepId !== CONFIRM_REVEALED_HAND_CARD_STEP_ID || typeof effect.metadata?.revealedHandCardId !== 'string') return game;
  const player = getPlayerById(game, effect.controllerId);
  const revealedCard = getCardById(game, effect.metadata.revealedHandCardId);
  const revealedHandCardId = effect.metadata.revealedHandCardId;
  if (!player || !revealedCard || !player.hand.cardIds.includes(revealedHandCardId)) return game;
  const live = isLiveCardData(revealedCard.data);
  let state: GameState = { ...game, activeEffect: null };
  if (live) {
    const modifier: Extract<LiveModifierState, { readonly kind: 'SCORE' }> = { kind: 'SCORE', playerId: player.id, countDelta: 1, sourceCardId: effect.sourceCardId, abilityId: effect.abilityId };
    state = addLiveModifier(state, modifier);
    const playerScores = new Map(state.liveResolution.playerScores);
    playerScores.set(player.id, (playerScores.get(player.id) ?? 0) + 1);
    state = { ...state, liveResolution: { ...state.liveResolution, playerScores } };
  }
  return addAction(state, 'RESOLVE_ABILITY', player.id, { abilityId: effect.abilityId, sourceCardId: effect.sourceCardId, step: 'RESOLVE_REVEALED_HAND_CARD', revealedHandCardId, isLiveCard: live, scoreBonus: live ? 1 : 0 });
}

function stringArray(value: unknown): readonly string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}
