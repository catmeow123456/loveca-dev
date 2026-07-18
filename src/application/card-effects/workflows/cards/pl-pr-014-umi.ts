import { isLiveCardData } from '../../../../domain/entities/card.js';
import {
  addAction,
  getCardById,
  getOpponent,
  getPlayerById,
  type ActiveEffectState,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { resolveBlindCardSelectionToken } from '../../../../shared/utils/blind-card-selection.js';
import { PL_PR_014_ON_ENTER_BLIND_REVEAL_OPPONENT_HAND_THREE_DRAW_IF_NO_LIVE_ABILITY_ID as ABILITY_ID } from '../../ability-ids.js';
import { drawCardsForPlayer } from '../../runtime/actions.js';
import {
  revealHandCardsForActiveEffect,
  startPendingActiveEffect,
} from '../../runtime/active-effect.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText } from '../../runtime/workflow-helpers.js';

const SELECT_HAND_CARDS_STEP_ID = 'PL_PR_014_SELECT_OPPONENT_HAND_CARDS';
const CONFIRM_REVEALED_HAND_CARDS_STEP_ID = 'PL_PR_014_CONFIRM_REVEALED_HAND_CARDS';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerPlPr014UmiWorkflowHandlers(): void {
  registerPendingAbilityStarterHandler(ABILITY_ID, (game, ability, options, context) =>
    startAbility(
      game,
      ability,
      options.orderedResolution === true,
      context.continuePendingCardEffects
    )
  );
  registerActiveEffectStepHandler(ABILITY_ID, SELECT_HAND_CARDS_STEP_ID, (game, input, context) =>
    revealSelectedHandCards(
      game,
      input.selectedCardIds ?? [],
      context.continuePendingCardEffects
    )
  );
  registerActiveEffectStepHandler(ABILITY_ID, CONFIRM_REVEALED_HAND_CARDS_STEP_ID, (game, _input, context) =>
    finishResolution(game, context.continuePendingCardEffects)
  );
}

function startAbility(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  const opponent = getOpponent(game, ability.controllerId);
  if (!player || !opponent) return game;

  const candidateCardIds = [...opponent.hand.cardIds];
  const requiredCount = Math.min(3, candidateCardIds.length);
  if (requiredCount === 0) {
    return resolveWithoutReveal(
      consumePendingAbility(game, ability.id),
      ability,
      orderedResolution,
      continuePendingCardEffects
    );
  }

  return startPendingActiveEffect(game, {
    ability,
    playerId: player.id,
    activeEffect: createSelectionEffect(ability, candidateCardIds, requiredCount, orderedResolution, 0),
    actionPayload: {
      sourceCardId: ability.sourceCardId,
      step: 'START_BLIND_REVEAL_OPPONENT_HAND',
      requiredCount,
    },
  });
}

function createSelectionEffect(
  ability: PendingAbilityState,
  candidateCardIds: readonly string[],
  requiredCount: number,
  orderedResolution: boolean,
  blindSelectionVersion: number
): ActiveEffectState {
  return {
    id: ability.id,
    abilityId: ability.abilityId,
    sourceCardId: ability.sourceCardId,
    controllerId: ability.controllerId,
    effectText: getAbilityEffectText(ability.abilityId),
    stepId: SELECT_HAND_CARDS_STEP_ID,
    stepText: `请在不查看内容的情况下，从对方手牌选择${requiredCount}张并公开。`,
    awaitingPlayerId: ability.controllerId,
    selectableCardIds: candidateCardIds,
    selectableCardVisibility: 'AWAITING_PLAYER_BLIND',
    selectableCardMode: 'ORDERED_MULTI',
    minSelectableCards: requiredCount,
    maxSelectableCards: requiredCount,
    selectionLabel: '选择要公开的对方手牌',
    confirmSelectionLabel: '公开所选手牌',
    canSkipSelection: false,
    metadata: {
      orderedResolution,
      initialCandidateCardIds: candidateCardIds,
      blindSelectionVersion,
    },
  };
}

function revealSelectedHandCards(
  game: GameState,
  selectionTokens: readonly string[],
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  if (!effect || effect.abilityId !== ABILITY_ID || effect.stepId !== SELECT_HAND_CARDS_STEP_ID) return game;
  const opponent = getOpponent(game, effect.controllerId);
  if (!opponent) return game;

  const originalCandidateCardIds = stringArray(effect.metadata?.initialCandidateCardIds);
  const currentCandidateCardIds = [...opponent.hand.cardIds];
  if (!sameArray(originalCandidateCardIds, currentCandidateCardIds)) {
    const requiredCount = Math.min(3, currentCandidateCardIds.length);
    if (requiredCount === 0) {
      return resolveWithoutRevealFromEffect(game, effect, continuePendingCardEffects);
    }
    const nextVersion = numberValue(effect.metadata?.blindSelectionVersion) + 1;
    return {
      ...game,
      activeEffect: {
        ...effect,
        stepText: `请在不查看内容的情况下，从对方手牌选择${requiredCount}张并公开。`,
        selectableCardIds: currentCandidateCardIds,
        minSelectableCards: requiredCount,
        maxSelectableCards: requiredCount,
        metadata: {
          ...effect.metadata,
          initialCandidateCardIds: currentCandidateCardIds,
          blindSelectionVersion: nextVersion,
        },
      },
    };
  }

  const requiredCount = Math.min(3, originalCandidateCardIds.length);
  if (
    selectionTokens.length !== requiredCount ||
    new Set(selectionTokens).size !== selectionTokens.length
  ) return game;
  const version = numberValue(effect.metadata?.blindSelectionVersion);
  const resolvedCardIds = selectionTokens.map((token) =>
    resolveBlindCardSelectionToken(originalCandidateCardIds, token, version)
  );
  if (
    resolvedCardIds.some((cardId) => cardId === null) ||
    new Set(resolvedCardIds).size !== resolvedCardIds.length ||
    resolvedCardIds.some((cardId) => cardId !== null && !opponent.hand.cardIds.includes(cardId))
  ) return game;

  const revealedHandCardIds = resolvedCardIds as readonly string[];
  const revealedHadLive = revealedHandCardIds.some((cardId) => {
    const card = getCardById(game, cardId);
    return card ? isLiveCardData(card.data) : false;
  });
  return revealHandCardsForActiveEffect(game, {
    effect,
    playerId: opponent.id,
    selectedCardIds: revealedHandCardIds,
    nextStepId: CONFIRM_REVEALED_HAND_CARDS_STEP_ID,
    nextStepText: '已公开所选手牌。确认后，根据公开卡中是否包含LIVE卡结算。',
    actionStep: 'REVEAL_OPPONENT_HAND',
    actionPayload: { revealedHandCardIds, revealedHadLive },
    selectableCardIds: undefined,
    selectableCardVisibility: undefined,
    selectableCardMode: undefined,
    selectionLabel: '公开的卡片',
    confirmSelectionLabel: '确认公开结果',
    canSkipSelection: undefined,
    skipSelectionLabel: undefined,
    metadata: { revealedHandCardIds, revealedHadLive },
  });
}

function finishResolution(
  game: GameState,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  if (!effect || effect.abilityId !== ABILITY_ID || effect.stepId !== CONFIRM_REVEALED_HAND_CARDS_STEP_ID) return game;
  const player = getPlayerById(game, effect.controllerId);
  if (!player || typeof effect.metadata?.revealedHadLive !== 'boolean') return game;
  const revealedHandCardIds = stringArray(effect.metadata.revealedHandCardIds);
  const revealedHadLive = effect.metadata.revealedHadLive;
  const stateWithoutEffect = { ...game, activeEffect: null };
  const drawResult = revealedHadLive
    ? { gameState: stateWithoutEffect, drawnCardIds: [] as readonly string[] }
    : drawCardsForPlayer(stateWithoutEffect, player.id, 1);
  if (!drawResult) return game;
  return continuePendingCardEffects(
    addAction(drawResult.gameState, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'RESOLVE_BLIND_REVEALED_OPPONENT_HAND',
      revealedHandCardIds,
      revealedHadLive,
      drawnCardIds: drawResult.drawnCardIds,
    }),
    effect.metadata?.orderedResolution === true
  );
}

function resolveWithoutReveal(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) return game;
  const drawResult = drawCardsForPlayer(game, player.id, 1);
  if (!drawResult) return game;
  return continuePendingCardEffects(
    addAction(drawResult.gameState, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: 'RESOLVE_BLIND_REVEALED_OPPONENT_HAND',
      revealedHandCardIds: [],
      revealedHadLive: false,
      drawnCardIds: drawResult.drawnCardIds,
    }),
    orderedResolution
  );
}

function resolveWithoutRevealFromEffect(
  game: GameState,
  effect: ActiveEffectState,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, effect.controllerId);
  if (!player) return game;
  const drawResult = drawCardsForPlayer({ ...game, activeEffect: null }, player.id, 1);
  if (!drawResult) return game;
  return continuePendingCardEffects(
    addAction(drawResult.gameState, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'RESOLVE_BLIND_REVEALED_OPPONENT_HAND',
      revealedHandCardIds: [],
      revealedHadLive: false,
      drawnCardIds: drawResult.drawnCardIds,
    }),
    effect.metadata?.orderedResolution === true
  );
}

function consumePendingAbility(game: GameState, pendingAbilityId: string): GameState {
  return { ...game, pendingAbilities: game.pendingAbilities.filter((ability) => ability.id !== pendingAbilityId) };
}

function stringArray(value: unknown): readonly string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function numberValue(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : 0;
}

function sameArray(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
