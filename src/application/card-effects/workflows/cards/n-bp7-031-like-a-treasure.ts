import { isLiveCardData } from '../../../../domain/entities/card.js';
import {
  addAction,
  getCardById,
  getPlayerById,
  type GameState,
  type LiveModifierState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { replaceLiveModifier } from '../../../../domain/rules/live-modifiers.js';
import { groupAliasIs } from '../../../effects/card-selectors.js';
import { N_BP7_031_AUTO_OWN_LIVE_SUCCESS_MILL_RECOVER_NIJIGASAKI_LIVE_SCORE_ABILITY_ID } from '../../ability-ids.js';
import { recoverCardsFromWaitingRoomToHandForPlayer } from '../../runtime/actions.js';
import { startPendingActiveEffect } from '../../runtime/active-effect.js';
import { canUseAbilityThisTurn } from '../../runtime/ability-turn-limit.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import {
  getAbilityEffectText,
  recordAbilityUseForContext,
} from '../../runtime/workflow-helpers.js';

const ABILITY_ID = N_BP7_031_AUTO_OWN_LIVE_SUCCESS_MILL_RECOVER_NIJIGASAKI_LIVE_SCORE_ABILITY_ID;
const EXACT_CARD_CODE = 'PL!N-bp7-031-L';
const SELECT_NIJIGASAKI_LIVE_STEP_ID = 'N_BP7_031_SELECT_MILLED_NIJIGASAKI_LIVE';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

type AbilityResolutionContext = Pick<
  PendingAbilityState,
  'id' | 'abilityId' | 'sourceCardId' | 'controllerId'
>;

const isNijigasakiCard = groupAliasIs('虹ヶ咲');

export function registerNBp7031LikeATreasureWorkflowHandlers(): void {
  registerPendingAbilityStarterHandler(ABILITY_ID, (game, ability, options, context) =>
    startLikeATreasure(
      game,
      ability,
      options.orderedResolution === true,
      context.continuePendingCardEffects
    )
  );
  registerActiveEffectStepHandler(
    ABILITY_ID,
    SELECT_NIJIGASAKI_LIVE_STEP_ID,
    (game, input, context) =>
      finishLikeATreasureSelection(
        game,
        input.selectedCardId ?? null,
        context.continuePendingCardEffects
      )
  );
}

function startLikeATreasure(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (
    !player ||
    !isValidSourceLive(game, player.id, ability.sourceCardId) ||
    !canUseAbilityThisTurn(game, player.id, ability.abilityId, ability.sourceCardId)
  ) {
    return finishPendingAbilityWithoutUse(
      removePendingAbility(game, ability.id),
      ability,
      orderedResolution,
      continuePendingCardEffects,
      'SOURCE_INVALID_OR_TURN_LIMIT_REACHED',
      []
    );
  }

  const movedCardIds = readStringArrayMetadata(ability.metadata?.movedCardIds);
  const candidateCardIds = getEligibleMovedNijigasakiLiveIds(game, player.id, movedCardIds);
  if (candidateCardIds.length === 0) {
    return finishPendingAbilityWithoutUse(
      removePendingAbility(game, ability.id),
      ability,
      orderedResolution,
      continuePendingCardEffects,
      'NO_ELIGIBLE_MOVED_NIJIGASAKI_LIVE',
      movedCardIds
    );
  }

  return startPendingActiveEffect(game, {
    ability,
    playerId: player.id,
    activeEffect: {
      id: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      controllerId: player.id,
      effectText: getAbilityEffectText(ability.abilityId),
      stepId: SELECT_NIJIGASAKI_LIVE_STEP_ID,
      stepText:
        '可以从本次放置入休息室的卡片中选择1张『虹咲』LIVE卡加入手牌。如此做时，此卡的分数+1。',
      awaitingPlayerId: player.id,
      selectableCardIds: candidateCardIds,
      selectableCardVisibility: 'PUBLIC',
      selectableCardMode: 'SINGLE',
      minSelectableCards: 0,
      maxSelectableCards: 1,
      selectionLabel: '选择要加入手牌的『虹咲』LIVE卡',
      confirmSelectionLabel: '加入手牌',
      canSkipSelection: true,
      skipSelectionLabel: '不发动',
      metadata: {
        publicCardSelectionConfirmation: { destination: 'HAND' },
        orderedResolution,
        movedCardIds,
      },
    },
    actionPayload: {
      sourceCardId: ability.sourceCardId,
      step: 'SELECT_MILLED_NIJIGASAKI_LIVE',
      movedCardIds,
      selectableCardIds: candidateCardIds,
    },
  });
}

function finishLikeATreasureSelection(
  game: GameState,
  selectedCardId: string | null,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !== ABILITY_ID ||
    effect.stepId !== SELECT_NIJIGASAKI_LIVE_STEP_ID
  ) {
    return game;
  }

  const orderedResolution = effect.metadata?.orderedResolution === true;
  const ability: AbilityResolutionContext = {
    id: effect.id,
    abilityId: effect.abilityId,
    sourceCardId: effect.sourceCardId,
    controllerId: effect.controllerId,
  };
  const movedCardIds = readStringArrayMetadata(effect.metadata?.movedCardIds);
  if (selectedCardId === null) {
    return finishPendingAbilityWithoutUse(
      { ...game, activeEffect: null },
      ability,
      orderedResolution,
      continuePendingCardEffects,
      'DECLINE_RECOVERY',
      movedCardIds
    );
  }

  const candidateCardIds = getEligibleMovedNijigasakiLiveIds(
    game,
    effect.controllerId,
    movedCardIds
  );
  if (
    !isValidSourceLive(game, effect.controllerId, effect.sourceCardId) ||
    !canUseAbilityThisTurn(game, effect.controllerId, effect.abilityId, effect.sourceCardId) ||
    effect.selectableCardIds?.includes(selectedCardId) !== true ||
    !candidateCardIds.includes(selectedCardId)
  ) {
    return finishPendingAbilityWithoutUse(
      { ...game, activeEffect: null },
      ability,
      orderedResolution,
      continuePendingCardEffects,
      'STALE_SOURCE_OR_TARGET',
      movedCardIds
    );
  }

  const recoveryResult = recoverCardsFromWaitingRoomToHandForPlayer(
    game,
    effect.controllerId,
    [selectedCardId],
    {
      candidateCardIds,
      exactCount: 1,
    }
  );
  if (!recoveryResult) {
    return finishPendingAbilityWithoutUse(
      { ...game, activeEffect: null },
      ability,
      orderedResolution,
      continuePendingCardEffects,
      'RECOVERY_FAILED',
      movedCardIds
    );
  }

  let state = recordAbilityUseForContext(recoveryResult.gameState, effect.controllerId, {
    abilityId: effect.abilityId,
    sourceCardId: effect.sourceCardId,
  });
  state = replaceScoreModifierAndRefresh(state, ability, 1);
  return continuePendingCardEffects(
    addAction({ ...state, activeEffect: null }, 'RESOLVE_ABILITY', effect.controllerId, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'RECOVER_MILLED_NIJIGASAKI_LIVE_AND_GAIN_SCORE',
      movedCardIds,
      selectedCardId,
      recoveredCardIds: recoveryResult.movedCardIds,
      scoreBonus: 1,
    }),
    orderedResolution
  );
}

function getEligibleMovedNijigasakiLiveIds(
  game: GameState,
  playerId: string,
  movedCardIds: readonly string[]
): readonly string[] {
  const player = getPlayerById(game, playerId);
  if (!player) {
    return [];
  }
  return [...new Set(movedCardIds)].filter((cardId) => {
    const card = getCardById(game, cardId);
    return (
      card !== null &&
      card.ownerId === playerId &&
      player.waitingRoom.cardIds.includes(cardId) &&
      isLiveCardData(card.data) &&
      isNijigasakiCard(card)
    );
  });
}

function isValidSourceLive(game: GameState, playerId: string, sourceCardId: string): boolean {
  const player = getPlayerById(game, playerId);
  const source = getCardById(game, sourceCardId);
  return (
    player !== null &&
    source !== null &&
    source.ownerId === playerId &&
    isLiveCardData(source.data) &&
    source.data.cardCode === EXACT_CARD_CODE &&
    player.liveZone.cardIds.includes(sourceCardId)
  );
}

function replaceScoreModifierAndRefresh(
  game: GameState,
  ability: AbilityResolutionContext,
  scoreBonus: number
): GameState {
  const matches = (modifier: LiveModifierState) =>
    modifier.kind === 'SCORE' &&
    modifier.playerId === ability.controllerId &&
    modifier.liveCardId === ability.sourceCardId &&
    modifier.sourceCardId === ability.sourceCardId &&
    modifier.abilityId === ability.abilityId;
  const previousScoreBonus = game.liveResolution.liveModifiers
    .filter(matches)
    .reduce((total, modifier) => total + (modifier.kind === 'SCORE' ? modifier.countDelta : 0), 0);
  const replacement: Extract<LiveModifierState, { readonly kind: 'SCORE' }> | null =
    scoreBonus > 0
      ? {
          kind: 'SCORE',
          playerId: ability.controllerId,
          countDelta: scoreBonus,
          liveCardId: ability.sourceCardId,
          sourceCardId: ability.sourceCardId,
          abilityId: ability.abilityId,
        }
      : null;
  const state = replaceLiveModifier(
    game,
    {
      kind: 'SCORE',
      playerId: ability.controllerId,
      liveCardId: ability.sourceCardId,
      sourceCardId: ability.sourceCardId,
      abilityId: ability.abilityId,
    },
    replacement
  );
  const delta = scoreBonus - previousScoreBonus;
  if (delta === 0) {
    return state;
  }
  const playerScores = new Map(state.liveResolution.playerScores);
  playerScores.set(ability.controllerId, (playerScores.get(ability.controllerId) ?? 0) + delta);
  return { ...state, liveResolution: { ...state.liveResolution, playerScores } };
}

function finishPendingAbilityWithoutUse(
  game: GameState,
  ability: AbilityResolutionContext,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects,
  step: string,
  movedCardIds: readonly string[]
): GameState {
  return continuePendingCardEffects(
    addAction(game, 'RESOLVE_ABILITY', ability.controllerId, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step,
      movedCardIds,
      recoveredCardIds: [],
      scoreBonus: 0,
    }),
    orderedResolution
  );
}

function removePendingAbility(game: GameState, pendingAbilityId: string): GameState {
  return {
    ...game,
    pendingAbilities: game.pendingAbilities.filter(
      (candidate) => candidate.id !== pendingAbilityId
    ),
  };
}

function readStringArrayMetadata(value: unknown): readonly string[] {
  return Array.isArray(value) && value.every((candidate) => typeof candidate === 'string')
    ? value
    : [];
}
