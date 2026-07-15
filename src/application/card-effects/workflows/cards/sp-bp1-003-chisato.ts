import { isMemberCardData } from '../../../../domain/entities/card.js';
import {
  addAction,
  getCardById,
  getPlayerById,
  type ActiveEffectState,
  type GameState,
} from '../../../../domain/entities/game.js';
import { addPlayerScoreLiveModifierForTargetMember } from '../../../../domain/rules/live-modifiers.js';
import { GamePhase, SubPhase } from '../../../../shared/types/enums.js';
import { cardCodeMatchesBase } from '../../../../shared/utils/card-code.js';
import { getHandMemberEffectivePlayCost } from '../../../effects/play-member-cost.js';
import { SP_BP1_003_ACTIVATED_REVEAL_HAND_MEMBERS_COST_TOTAL_GAIN_SCORE_ABILITY_ID as ABILITY_ID } from '../../ability-ids.js';
import {
  doesCardAbilityDefinitionMatchCardCode,
  findCardAbilityDefinitionById,
} from '../../definitions/lookup.js';
import { revealHandCardsForActiveEffect } from '../../runtime/active-effect.js';
import { registerActivatedAbilityHandler } from '../../runtime/activated-registry.js';
import { getSourceMemberSlot } from '../../runtime/source-member.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import {
  getAbilityEffectText,
  recordAbilityUseForContext,
} from '../../runtime/workflow-helpers.js';

const BASE_CARD_CODE = 'PL!SP-bp1-003';
const SELECT_HAND_MEMBERS_STEP_ID = 'SP_BP1_003_SELECT_HAND_MEMBERS';
const CONFIRM_REVEALED_HAND_MEMBERS_STEP_ID = 'SP_BP1_003_CONFIRM_REVEALED_HAND_MEMBERS';
const SCORE_TOTALS = new Set([10, 20, 30, 40, 50]);

interface RevealedMemberCostSnapshot {
  readonly cardId: string;
  readonly effectiveCost: number;
}

export function registerSpBp1003ChisatoWorkflowHandlers(): void {
  registerActivatedAbilityHandler(ABILITY_ID, startChisatoActivatedWorkflow);
  registerActiveEffectStepHandler(ABILITY_ID, SELECT_HAND_MEMBERS_STEP_ID, (game, input) =>
    revealSelectedHandMembers(game, input.selectedCardIds ?? [])
  );
  registerActiveEffectStepHandler(ABILITY_ID, CONFIRM_REVEALED_HAND_MEMBERS_STEP_ID, (game) =>
    finishRevealedHandMembers(game)
  );
}

function startChisatoActivatedWorkflow(
  game: GameState,
  playerId: string,
  sourceCardId: string
): GameState {
  if (
    game.activeEffect ||
    game.currentPhase !== GamePhase.MAIN_PHASE ||
    game.currentSubPhase !== SubPhase.NONE ||
    game.players[game.activePlayerIndex]?.id !== playerId
  ) {
    return game;
  }

  const player = getPlayerById(game, playerId);
  const sourceCard = getCardById(game, sourceCardId);
  const definition = findCardAbilityDefinitionById(ABILITY_ID);
  if (
    !player ||
    !sourceCard ||
    sourceCard.ownerId !== playerId ||
    !isMemberCardData(sourceCard.data) ||
    !cardCodeMatchesBase(sourceCard.data.cardCode, BASE_CARD_CODE) ||
    !definition ||
    !doesCardAbilityDefinitionMatchCardCode(definition, sourceCard.data.cardCode) ||
    getSourceMemberSlot(game, playerId, sourceCardId) === null
  ) {
    return game;
  }

  const selectableCardIds = player.hand.cardIds.filter((cardId) => {
    const card = getCardById(game, cardId);
    return card?.ownerId === player.id && isMemberCardData(card.data);
  });
  return addAction(
    {
      ...game,
      activeEffect: {
        id: `${ABILITY_ID}:${sourceCardId}:turn-${game.turnCount}:action-${game.actionHistory.length}`,
        abilityId: ABILITY_ID,
        sourceCardId,
        controllerId: player.id,
        effectText: getAbilityEffectText(ABILITY_ID),
        stepId: SELECT_HAND_MEMBERS_STEP_ID,
        stepText: '请选择要公开的任意张手牌成员卡。',
        awaitingPlayerId: player.id,
        selectableCardIds,
        selectableCardVisibility: 'AWAITING_PLAYER_ONLY',
        selectableCardMode: 'ORDERED_MULTI',
        minSelectableCards: 0,
        maxSelectableCards: selectableCardIds.length,
        selectionLabel: '选择要公开的手牌成员卡',
        confirmSelectionLabel: '公开所选成员卡',
        canSkipSelection: false,
        metadata: { initialCandidateCardIds: selectableCardIds },
      },
    },
    'RESOLVE_ABILITY',
    player.id,
    {
      abilityId: ABILITY_ID,
      sourceCardId,
      step: 'START_REVEAL_HAND_MEMBERS',
      candidateCount: selectableCardIds.length,
    }
  );
}

function revealSelectedHandMembers(game: GameState, selectedCardIds: readonly string[]): GameState {
  const effect = getChisatoEffect(game, SELECT_HAND_MEMBERS_STEP_ID);
  const player = effect ? getPlayerById(game, effect.controllerId) : null;
  if (!effect || !player || !isValidSource(game, effect)) return game;

  const initialCandidateCardIds = stringArray(effect.metadata?.initialCandidateCardIds);
  if (
    selectedCardIds.length > initialCandidateCardIds.length ||
    new Set(selectedCardIds).size !== selectedCardIds.length ||
    selectedCardIds.some((cardId) => !initialCandidateCardIds.includes(cardId))
  ) {
    return game;
  }

  const handSnapshot = [...player.hand.cardIds];
  const costSnapshot: RevealedMemberCostSnapshot[] = [];
  for (const cardId of selectedCardIds) {
    const card = getCardById(game, cardId);
    if (
      !card ||
      card.ownerId !== player.id ||
      !isMemberCardData(card.data) ||
      !handSnapshot.includes(cardId)
    ) {
      return game;
    }
    const effectiveCost = getHandMemberEffectivePlayCost(game, player.id, cardId, handSnapshot);
    if (effectiveCost === null) return game;
    costSnapshot.push({ cardId, effectiveCost });
  }

  const effectiveCostTotal = costSnapshot.reduce(
    (total, snapshot) => total + snapshot.effectiveCost,
    0
  );
  const conditionMet = SCORE_TOTALS.has(effectiveCostTotal);
  const revealed = revealHandCardsForActiveEffect(game, {
    effect,
    playerId: player.id,
    selectedCardIds,
    nextStepId: CONFIRM_REVEALED_HAND_MEMBERS_STEP_ID,
    nextStepText: '已公开所选手牌。确认后，根据公开卡片的费用合计结算。',
    actionStep: 'REVEAL_HAND_MEMBERS',
    actionPayload: {
      revealedHandMemberCardIds: selectedCardIds,
      effectiveCosts: costSnapshot,
      effectiveCostTotal,
      conditionMet,
    },
    selectableCardIds: undefined,
    selectableCardVisibility: undefined,
    selectableCardMode: undefined,
    selectionLabel: '公开的卡片',
    confirmSelectionLabel: '确认公开结果',
    canSkipSelection: undefined,
    skipSelectionLabel: undefined,
    metadata: {
      revealedHandMemberCardIds: [...selectedCardIds],
      effectiveCosts: costSnapshot,
      effectiveCostTotal,
      conditionMet,
    },
  });
  if (revealed === game) return game;
  return recordAbilityUseForContext(revealed, player.id, {
    abilityId: ABILITY_ID,
    sourceCardId: effect.sourceCardId,
  });
}

function finishRevealedHandMembers(game: GameState): GameState {
  const effect = getChisatoEffect(game, CONFIRM_REVEALED_HAND_MEMBERS_STEP_ID);
  const player = effect ? getPlayerById(game, effect.controllerId) : null;
  if (!effect || !player) return game;

  const revealedHandMemberCardIds = stringArray(effect.metadata?.revealedHandMemberCardIds);
  const effectiveCosts = costSnapshotArray(effect.metadata?.effectiveCosts);
  const effectiveCostTotal = numberValue(effect.metadata?.effectiveCostTotal);
  const conditionMet = effect.metadata?.conditionMet === true;
  if (
    effectiveCosts.length !== revealedHandMemberCardIds.length ||
    effectiveCosts.some(
      (snapshot, index) => snapshot.cardId !== revealedHandMemberCardIds[index]
    ) ||
    effectiveCosts.reduce((total, snapshot) => total + snapshot.effectiveCost, 0) !==
      effectiveCostTotal ||
    conditionMet !== SCORE_TOTALS.has(effectiveCostTotal)
  ) {
    return game;
  }

  const stateWithoutEffect = { ...game, activeEffect: null };
  const modifierResult = conditionMet
    ? addPlayerScoreLiveModifierForTargetMember(stateWithoutEffect, {
        playerId: player.id,
        countDelta: 1,
        targetMemberCardId: effect.sourceCardId,
        sourceCardId: effect.sourceCardId,
        abilityId: ABILITY_ID,
      })
    : null;
  const settledState = modifierResult?.gameState ?? stateWithoutEffect;
  return addAction(settledState, 'RESOLVE_ABILITY', player.id, {
    abilityId: ABILITY_ID,
    sourceCardId: effect.sourceCardId,
    step: 'RESOLVE_REVEALED_HAND_MEMBER_COST_TOTAL',
    revealedHandMemberCardIds,
    effectiveCosts,
    effectiveCostTotal,
    conditionMet,
    scoreBonus: modifierResult ? 1 : 0,
  });
}

function getChisatoEffect(game: GameState, stepId: string): ActiveEffectState | null {
  const effect = game.activeEffect;
  return effect?.abilityId === ABILITY_ID && effect.stepId === stepId ? effect : null;
}

function isValidSource(game: GameState, effect: ActiveEffectState): boolean {
  const sourceCard = getCardById(game, effect.sourceCardId);
  const definition = findCardAbilityDefinitionById(ABILITY_ID);
  return Boolean(
    sourceCard &&
    sourceCard.ownerId === effect.controllerId &&
    isMemberCardData(sourceCard.data) &&
    cardCodeMatchesBase(sourceCard.data.cardCode, BASE_CARD_CODE) &&
    definition &&
    doesCardAbilityDefinitionMatchCardCode(definition, sourceCard.data.cardCode) &&
    getSourceMemberSlot(game, effect.controllerId, effect.sourceCardId) !== null
  );
}

function stringArray(value: unknown): readonly string[] {
  return Array.isArray(value)
    ? value.filter((candidate): candidate is string => typeof candidate === 'string')
    : [];
}

function costSnapshotArray(value: unknown): readonly RevealedMemberCostSnapshot[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (candidate): candidate is RevealedMemberCostSnapshot =>
      typeof candidate === 'object' &&
      candidate !== null &&
      typeof (candidate as { cardId?: unknown }).cardId === 'string' &&
      Number.isInteger((candidate as { effectiveCost?: unknown }).effectiveCost) &&
      ((candidate as { effectiveCost: number }).effectiveCost ?? -1) >= 0
  );
}

function numberValue(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) ? value : -1;
}
