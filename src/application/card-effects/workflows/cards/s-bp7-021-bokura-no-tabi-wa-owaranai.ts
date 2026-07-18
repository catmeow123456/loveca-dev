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
import { CardType, ZoneType } from '../../../../shared/types/enums.js';
import { typeIs } from '../../../effects/card-selectors.js';
import { countCardsMatchingSelector } from '../../../effects/conditions.js';
import { getStageMemberCardIdsMatching } from '../../../effects/stage-targets.js';
import { S_BP7_021_LIVE_START_STAGE_THREE_MILL_BOTTOM_FIVE_MEMBER_REWARDS_ABILITY_ID } from '../../ability-ids.js';
import { startPendingActiveEffect } from '../../runtime/active-effect.js';
import { drawCardsForPlayer } from '../../runtime/actions.js';
import type { EnqueueTriggeredCardEffectsForEnterWaitingRoom } from '../../runtime/enter-waiting-room-triggers.js';
import { moveBottomDeckCardsToWaitingRoomWithRefreshAndEnqueueTriggers } from '../../runtime/main-deck-waiting-room-triggers.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import {
  getAbilityEffectText,
  maybeStartConfirmablePendingAbilityConfirmation,
} from '../../runtime/workflow-helpers.js';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

const ABILITY_ID = S_BP7_021_LIVE_START_STAGE_THREE_MILL_BOTTOM_FIVE_MEMBER_REWARDS_ABILITY_ID;
const EXACT_CARD_CODE = 'PL!S-bp7-021-L';
const REVEAL_STEP_ID = 'S_BP7_021_REVEAL_MILLED_BOTTOM_FIVE';

export function registerSBp7021BokuraNoTabiWaOwaranaiWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom;
}): void {
  registerPendingAbilityStarterHandler(ABILITY_ID, (game, ability, options, context) => {
    const player = getPlayerById(game, ability.controllerId);
    const sourceValid = player && isValidSourceLive(game, player.id, ability.sourceCardId);
    const stageMemberCount = countOwnStageMembers(game, ability.controllerId);
    if (!sourceValid || stageMemberCount < 3) {
      const confirmation = maybeStartConfirmablePendingAbilityConfirmation(game, ability, options, {
        effectText: `${getAbilityEffectText(
          ability.abilityId
        )}（当前舞台成员${stageMemberCount}名，${
          stageMemberCount >= 3
            ? '满足舞台条件。'
            : '未满足舞台条件，实际不移动卡牌、不抽牌、不增加[スコア]。'
        }）`,
        stepText: '确认后结算此效果。',
      });
      if (confirmation) {
        return confirmation;
      }
    }

    return startBokuraNoTabiWaOwaranaiReveal(
      game,
      ability,
      options.orderedResolution === true,
      deps.enqueueTriggeredCardEffects,
      context.continuePendingCardEffects
    );
  });
  registerActiveEffectStepHandler(ABILITY_ID, REVEAL_STEP_ID, (game, _input, context) =>
    finishBokuraNoTabiWaOwaranai(game, context.continuePendingCardEffects)
  );
}

function startBokuraNoTabiWaOwaranaiReveal(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player || !isValidSourceLive(game, player.id, ability.sourceCardId)) {
    return finishNoOp(
      game,
      ability,
      orderedResolution,
      continuePendingCardEffects,
      'SOURCE_NOT_IN_LIVE_ZONE',
      countOwnStageMembers(game, ability.controllerId)
    );
  }

  const stageMemberCount = countOwnStageMembers(game, player.id);
  if (stageMemberCount < 3) {
    return finishNoOp(
      game,
      ability,
      orderedResolution,
      continuePendingCardEffects,
      'STAGE_MEMBER_COUNT_BELOW_THREE',
      stageMemberCount
    );
  }

  const moveResult = moveBottomDeckCardsToWaitingRoomWithRefreshAndEnqueueTriggers(
    game,
    player.id,
    5,
    enqueueTriggeredCardEffects,
    {
      cause: {
        kind: 'CARD_EFFECT',
        playerId: player.id,
        sourceCardId: ability.sourceCardId,
        abilityId: ability.abilityId,
        pendingAbilityId: ability.id,
      },
    }
  );
  if (!moveResult) {
    return game;
  }

  const movedCardIds = moveResult.movedCardIds;
  const fullMove = movedCardIds.length === 5;
  const memberCount = countCardsMatchingSelector(
    moveResult.gameState,
    movedCardIds,
    typeIs(CardType.MEMBER)
  );
  const refreshText = moveResult.refreshCount > 0 ? '期间发生卡组更新。' : '';
  const rewardText = getRewardPreviewText(movedCardIds.length, memberCount);

  return startPendingActiveEffect(moveResult.gameState, {
    ability,
    playerId: player.id,
    activeEffect: {
      id: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      controllerId: ability.controllerId,
      effectText: getAbilityEffectText(ability.abilityId),
      stepId: REVEAL_STEP_ID,
      stepText: `已将卡组底合计${movedCardIds.length}张放置入休息室。${refreshText}${rewardText}`,
      awaitingPlayerId: player.id,
      revealedCardIds: [...new Set(movedCardIds)],
      metadata: {
        sourceZone: ZoneType.MAIN_DECK,
        orderedResolution,
        stageMemberCount,
        movedCardIds,
        memberCount,
        fullMove,
        refreshCount: moveResult.refreshCount,
      },
    },
    actionPayload: {
      sourceCardId: ability.sourceCardId,
      step: 'MILL_BOTTOM_CARDS',
      stageMemberCount,
      movedCardIds,
      memberCount,
      fullMove,
      refreshCount: moveResult.refreshCount,
    },
  });
}

function finishBokuraNoTabiWaOwaranai(
  game: GameState,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  if (!effect || effect.abilityId !== ABILITY_ID || effect.stepId !== REVEAL_STEP_ID) {
    return game;
  }

  const player = getPlayerById(game, effect.controllerId);
  if (!player) {
    return game;
  }

  const movedCardIds = getStringArrayMetadata(effect.metadata?.movedCardIds);
  const memberCount =
    typeof effect.metadata?.memberCount === 'number' ? effect.metadata.memberCount : 0;
  const fullMove = effect.metadata?.fullMove === true;
  const shouldDraw = fullMove && memberCount >= 3;
  const shouldGainScore =
    fullMove && memberCount === 5 && isValidSourceLive(game, player.id, effect.sourceCardId);
  const stateWithoutEffect = { ...game, activeEffect: null };
  const drawResult = shouldDraw ? drawCardsForPlayer(stateWithoutEffect, player.id, 1) : null;
  let state = drawResult?.gameState ?? stateWithoutEffect;
  const previousScoreBonus = getExistingScoreBonus(state, player.id, effect);
  const replacement: LiveModifierState | null = shouldGainScore
    ? {
        kind: 'SCORE',
        playerId: player.id,
        countDelta: 1,
        liveCardId: effect.sourceCardId,
        sourceCardId: effect.sourceCardId,
        abilityId: effect.abilityId,
      }
    : null;
  state = replaceLiveModifier(
    state,
    {
      kind: 'SCORE',
      playerId: player.id,
      liveCardId: effect.sourceCardId,
      sourceCardId: effect.sourceCardId,
      abilityId: effect.abilityId,
    },
    replacement
  );
  state = refreshPlayerScoreDraft(state, player.id, (shouldGainScore ? 1 : 0) - previousScoreBonus);

  return continuePendingCardEffects(
    addAction(state, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'MILL_BOTTOM_FIVE_MEMBER_REWARDS',
      stageMemberCount:
        typeof effect.metadata?.stageMemberCount === 'number'
          ? effect.metadata.stageMemberCount
          : 0,
      movedCardIds,
      refreshCount:
        typeof effect.metadata?.refreshCount === 'number' ? effect.metadata.refreshCount : 0,
      memberCount,
      fullMove,
      drawnCardIds: drawResult?.drawnCardIds ?? [],
      scoreBonus: shouldGainScore ? 1 : 0,
    }),
    effect.metadata?.orderedResolution === true
  );
}

function getRewardPreviewText(movedCount: number, memberCount: number): string {
  if (movedCount !== 5) {
    return '实际移动数量不足5张。确认后不抽牌、不增加[スコア]。';
  }
  if (memberCount < 3) {
    return `其中成员卡${memberCount}张。确认后不抽牌、不增加[スコア]。`;
  }
  if (memberCount < 5) {
    return `其中成员卡${memberCount}张。确认后抽1张，不增加[スコア]。`;
  }
  return '其中成员卡5张。确认后抽1张，此LIVE[スコア]+1。';
}

function getStringArrayMetadata(value: unknown): readonly string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function countOwnStageMembers(game: GameState, playerId: string): number {
  return getStageMemberCardIdsMatching(game, playerId, typeIs(CardType.MEMBER)).length;
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

function getExistingScoreBonus(
  game: GameState,
  playerId: string,
  ability: Pick<PendingAbilityState, 'sourceCardId' | 'abilityId'>
): number {
  return game.liveResolution.liveModifiers
    .filter(
      (modifier) =>
        modifier.kind === 'SCORE' &&
        modifier.playerId === playerId &&
        modifier.liveCardId === ability.sourceCardId &&
        modifier.sourceCardId === ability.sourceCardId &&
        modifier.abilityId === ability.abilityId
    )
    .reduce((total, modifier) => total + (modifier.kind === 'SCORE' ? modifier.countDelta : 0), 0);
}

function refreshPlayerScoreDraft(game: GameState, playerId: string, scoreDelta: number): GameState {
  if (scoreDelta === 0) {
    return game;
  }
  const playerScores = new Map(game.liveResolution.playerScores);
  playerScores.set(playerId, (playerScores.get(playerId) ?? 0) + scoreDelta);
  return {
    ...game,
    liveResolution: {
      ...game.liveResolution,
      playerScores,
    },
  };
}

function finishNoOp(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects,
  step: string,
  stageMemberCount: number
): GameState {
  const state = addAction(
    {
      ...game,
      pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
    },
    'RESOLVE_ABILITY',
    ability.controllerId,
    {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step,
      stageMemberCount,
      movedCardIds: [],
      memberCount: 0,
      drawnCardIds: [],
      scoreBonus: 0,
    }
  );
  return continuePendingCardEffects(state, orderedResolution);
}
