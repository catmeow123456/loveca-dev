import { isLiveCardData } from '../../../../domain/entities/card.js';
import {
  addAction,
  getCardById,
  getPlayerById,
  type ActiveEffectState,
  type GameState,
  type LiveModifierState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { replaceLiveModifier } from '../../../../domain/rules/live-modifiers.js';
import { CardType } from '../../../../shared/types/enums.js';
import { and, groupAliasIs, typeIs } from '../../../effects/card-selectors.js';
import { selectCurrentLiveRevealedCheerCardIds } from '../../../effects/cheer-selection.js';
import { getStageMemberCardIdsMatching } from '../../../effects/stage-targets.js';
import {
  SP_BP7_028_LIVE_START_BOTTOM_NINE_LIELLA_MEMBERS_ALL_STAGE_GAIN_BLADE_ABILITY_ID,
  SP_BP7_028_LIVE_SUCCESS_ALL_CHEER_LIELLA_SCORE_ABILITY_ID,
} from '../../ability-ids.js';
import { startPendingActiveEffect } from '../../runtime/active-effect.js';
import {
  addBladeLiveModifierForMember,
  shuffleWaitingRoomCardsToDeckBottomForPlayer,
} from '../../runtime/actions.js';
import { wasRestoredAfterPublicCardSelectionConfirmation } from '../../runtime/public-card-selection-confirmation.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import {
  getAbilityEffectText,
  registerManualConfirmablePendingAbilityStarterHandler,
} from '../../runtime/workflow-helpers.js';

const LIVE_START_ABILITY_ID =
  SP_BP7_028_LIVE_START_BOTTOM_NINE_LIELLA_MEMBERS_ALL_STAGE_GAIN_BLADE_ABILITY_ID;
const LIVE_SUCCESS_ABILITY_ID = SP_BP7_028_LIVE_SUCCESS_ALL_CHEER_LIELLA_SCORE_ABILITY_ID;
const EXACT_CARD_CODE = 'PL!SP-bp7-028-L';
const SELECT_NINE_STEP_ID = 'SP_BP7_028_SELECT_NINE_LIELLA_MEMBERS_TO_SHUFFLE_BOTTOM';
const REQUIRED_COUNT = 9;
const SCORE_BONUS = 1;

const liellaMemberSelector = and(typeIs(CardType.MEMBER), groupAliasIs('Liella!'));
const anyMemberSelector = typeIs(CardType.MEMBER);
const liellaCardSelector = groupAliasIs('Liella!');

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerSpBp7028MiraiNoOtoGaKikoeruWorkflowHandlers(): void {
  registerPendingAbilityStarterHandler(LIVE_START_ABILITY_ID, (game, ability, options, context) =>
    startLiveStart(
      game,
      ability,
      options.orderedResolution === true,
      context.continuePendingCardEffects
    )
  );
  registerActiveEffectStepHandler(
    LIVE_START_ABILITY_ID,
    SELECT_NINE_STEP_ID,
    (game, input, context) =>
      finishLiveStartSelection(
        game,
        input.selectedCardIds ?? (input.selectedCardId ? [input.selectedCardId] : []),
        context.continuePendingCardEffects
      )
  );
  registerManualConfirmablePendingAbilityStarterHandler(
    LIVE_SUCCESS_ABILITY_ID,
    (game, ability, options, context) =>
      resolveLiveSuccess(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      ),
    getLiveSuccessConfirmation
  );
}

function startLiveStart(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  const sourceValid = isValidSourceLive(game, ability.controllerId, ability.sourceCardId);
  const candidateCardIds = getCurrentWaitingRoomCandidates(game, ability.controllerId);
  if (!player || !sourceValid || candidateCardIds.length < REQUIRED_COUNT) {
    return consumePendingNoOp(
      game,
      ability,
      orderedResolution,
      continuePendingCardEffects,
      sourceValid ? 'INSUFFICIENT_LIELLA_MEMBERS' : 'SOURCE_INVALID_AT_START',
      {
        candidateCardIds,
        candidateCount: candidateCardIds.length,
      }
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
      stepId: SELECT_NINE_STEP_ID,
      stepText: '可以选择自己休息室中的9张『Liella!』成员卡，将那些卡片洗牌并放置于卡组底。',
      awaitingPlayerId: player.id,
      selectableCardIds: candidateCardIds,
      selectableCardVisibility: 'PUBLIC',
      selectableCardMode: 'ORDERED_MULTI',
      minSelectableCards: REQUIRED_COUNT,
      maxSelectableCards: REQUIRED_COUNT,
      selectionLabel: '选择要洗牌并放置于卡组底的卡',
      confirmSelectionLabel: '洗牌并放置于卡组底',
      canSkipSelection: true,
      skipSelectionLabel: '不发动',
      metadata: {
        publicCardSelectionConfirmation: {
          destination: 'MAIN_DECK_BOTTOM',
        },
        orderedResolution,
        candidateCardIds,
      },
    },
    actionPayload: {
      sourceCardId: ability.sourceCardId,
      step: 'START_SELECT_NINE_LIELLA_MEMBERS',
      candidateCardIds,
    },
  });
}

function finishLiveStartSelection(
  game: GameState,
  selectedCardIds: readonly string[],
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = getLiveStartEffect(game);
  if (!effect) return game;
  const player = getPlayerById(game, effect.controllerId);
  if (!player) return game;
  if (selectedCardIds.length === 0) {
    return consumeActiveEffectNoOp(
      game,
      effect,
      continuePendingCardEffects,
      'DECLINE_BOTTOM_NINE_LIELLA_MEMBERS'
    );
  }

  const originalCandidateCardIds = getStringArray(effect.metadata?.candidateCardIds);
  if (
    selectedCardIds.length !== REQUIRED_COUNT ||
    new Set(selectedCardIds).size !== selectedCardIds.length ||
    selectedCardIds.some((cardId) => !originalCandidateCardIds.includes(cardId))
  ) {
    return game;
  }
  const sourceValid = isValidSourceLive(game, player.id, effect.sourceCardId);
  const currentCandidateCardIdSet = new Set(getCurrentWaitingRoomCandidates(game, player.id));
  if (!sourceValid || selectedCardIds.some((cardId) => !currentCandidateCardIdSet.has(cardId))) {
    return wasRestoredAfterPublicCardSelectionConfirmation(effect)
      ? consumeActiveEffectNoOp(
          game,
          effect,
          continuePendingCardEffects,
          sourceValid ? 'STALE_LIELLA_MEMBER_SELECTION' : 'SOURCE_INVALID_AT_RESTORE',
          { selectedCardIds }
        )
      : game;
  }

  const shuffleResult = shuffleWaitingRoomCardsToDeckBottomForPlayer(
    { ...game, activeEffect: null },
    player.id,
    selectedCardIds
  );
  if (!shuffleResult || shuffleResult.movedCardIds.length !== REQUIRED_COUNT) {
    return wasRestoredAfterPublicCardSelectionConfirmation(effect)
      ? consumeActiveEffectNoOp(
          game,
          effect,
          continuePendingCardEffects,
          'STALE_LIELLA_MEMBER_SELECTION',
          { selectedCardIds }
        )
      : game;
  }

  const targetMemberCardIds = getStageMemberCardIdsMatching(
    shuffleResult.gameState,
    player.id,
    anyMemberSelector
  );
  let state = shuffleResult.gameState;
  for (const memberCardId of targetMemberCardIds) {
    const result = addBladeLiveModifierForMember(state, {
      playerId: player.id,
      memberCardId,
      sourceCardId: effect.sourceCardId,
      abilityId: effect.abilityId,
      countDelta: 1,
    });
    if (!result) return game;
    state = result.gameState;
  }

  return continuePendingCardEffects(
    addAction(state, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'SHUFFLE_NINE_LIELLA_MEMBERS_BOTTOM_ALL_STAGE_GAIN_BLADE',
      selectedCardIds,
      movedCardIds: shuffleResult.movedCardIds,
      targetMemberCardIds,
      bladeBonusPerMember: 1,
    }),
    effect.metadata?.orderedResolution === true
  );
}

function getLiveSuccessConfirmation(
  game: GameState,
  ability: PendingAbilityState
): {
  readonly effectText: string;
  readonly stepText: string;
} {
  const evaluation = evaluateLiveSuccess(game, ability);
  return {
    effectText: `${getAbilityEffectText(ability.abilityId)}（当前因声援公开的自己的卡片${evaluation.revealedCardIds.length}张，其中『Liella!』${evaluation.liellaCardIds.length}张；${
      evaluation.conditionMet ? '满足条件，实际此卡[スコア]+1' : '未满足条件，实际不增加[スコア]'
    }。）`,
    stepText: '确认后结算此效果。',
  };
}

function resolveLiveSuccess(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const evaluation = evaluateLiveSuccess(game, ability);
  const stateWithoutPending = removePendingAbility(game, ability.id);
  const scoreBonus = evaluation.conditionMet ? SCORE_BONUS : 0;
  const stateAfterScore = evaluation.sourceValid
    ? replaceScoreModifierAndRefresh(stateWithoutPending, ability, scoreBonus)
    : stateWithoutPending;
  return continuePendingCardEffects(
    addAction(stateAfterScore, 'RESOLVE_ABILITY', ability.controllerId, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: evaluation.conditionMet ? 'ALL_CHEER_LIELLA_SCORE' : 'CONDITION_NOT_MET',
      revealedCardIds: evaluation.revealedCardIds,
      liellaCardIds: evaluation.liellaCardIds,
      nonLiellaCardIds: evaluation.nonLiellaCardIds,
      conditionMet: evaluation.conditionMet,
      scoreBonus,
    }),
    orderedResolution
  );
}

function evaluateLiveSuccess(
  game: GameState,
  ability: Pick<PendingAbilityState, 'controllerId' | 'sourceCardId'>
): {
  readonly sourceValid: boolean;
  readonly revealedCardIds: readonly string[];
  readonly liellaCardIds: readonly string[];
  readonly nonLiellaCardIds: readonly string[];
  readonly conditionMet: boolean;
} {
  const sourceValid = isValidSourceLive(game, ability.controllerId, ability.sourceCardId);
  const revealedCardIds = sourceValid
    ? [...new Set(selectCurrentLiveRevealedCheerCardIds(game, ability.controllerId))]
    : [];
  const liellaCardIds = revealedCardIds.filter((cardId) => {
    const card = getCardById(game, cardId);
    return card !== null && card.ownerId === ability.controllerId && liellaCardSelector(card);
  });
  const liellaCardIdSet = new Set(liellaCardIds);
  const nonLiellaCardIds = revealedCardIds.filter((cardId) => !liellaCardIdSet.has(cardId));
  return {
    sourceValid,
    revealedCardIds,
    liellaCardIds,
    nonLiellaCardIds,
    conditionMet: sourceValid && revealedCardIds.length > 0 && nonLiellaCardIds.length === 0,
  };
}

function getCurrentWaitingRoomCandidates(game: GameState, playerId: string): readonly string[] {
  const player = getPlayerById(game, playerId);
  return player
    ? player.waitingRoom.cardIds.filter((cardId) => {
        const card = getCardById(game, cardId);
        return card !== null && card.ownerId === player.id && liellaMemberSelector(card);
      })
    : [];
}

function isValidSourceLive(game: GameState, playerId: string, sourceCardId: string): boolean {
  const player = getPlayerById(game, playerId);
  const source = getCardById(game, sourceCardId);
  return (
    player !== null &&
    source !== null &&
    source.ownerId === player.id &&
    isLiveCardData(source.data) &&
    source.data.cardCode === EXACT_CARD_CODE &&
    player.liveZone.cardIds.includes(sourceCardId)
  );
}

function replaceScoreModifierAndRefresh(
  game: GameState,
  ability: Pick<PendingAbilityState, 'abilityId' | 'controllerId' | 'sourceCardId'>,
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
  const scoreDelta = scoreBonus - previousScoreBonus;
  if (scoreDelta === 0) return state;
  const playerScores = new Map(state.liveResolution.playerScores);
  playerScores.set(
    ability.controllerId,
    (playerScores.get(ability.controllerId) ?? 0) + scoreDelta
  );
  return {
    ...state,
    liveResolution: {
      ...state.liveResolution,
      playerScores,
    },
  };
}

function getLiveStartEffect(game: GameState): ActiveEffectState | null {
  const effect = game.activeEffect;
  return effect?.abilityId === LIVE_START_ABILITY_ID && effect.stepId === SELECT_NINE_STEP_ID
    ? effect
    : null;
}

function consumePendingNoOp(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects,
  step: string,
  payload: Readonly<Record<string, unknown>> = {}
): GameState {
  return continuePendingCardEffects(
    addAction(removePendingAbility(game, ability.id), 'RESOLVE_ABILITY', ability.controllerId, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step,
      ...payload,
    }),
    orderedResolution
  );
}

function consumeActiveEffectNoOp(
  game: GameState,
  effect: ActiveEffectState,
  continuePendingCardEffects: ContinuePendingCardEffects,
  step: string,
  payload: Readonly<Record<string, unknown>> = {}
): GameState {
  return continuePendingCardEffects(
    addAction({ ...game, activeEffect: null }, 'RESOLVE_ABILITY', effect.controllerId, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step,
      ...payload,
    }),
    effect.metadata?.orderedResolution === true
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

function getStringArray(value: unknown): readonly string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string') ? value : [];
}
