import {
  addAction,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { CardType, ZoneType } from '../../../../shared/types/enums.js';
import { allCardIdsMatchingSelector } from '../../../effects/conditions.js';
import { typeIs } from '../../../effects/card-selectors.js';
import { moveTopDeckCardsToWaitingRoomWithRefresh } from '../../../effects/look-top.js';
import { HS_BP1_008_ON_ENTER_MILL_THREE_DRAW_IF_ALL_MEMBERS_ABILITY_ID } from '../../ability-ids.js';
import { drawCardsForPlayer } from '../../runtime/actions.js';
import { startPendingActiveEffect } from '../../runtime/active-effect.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText } from '../../runtime/workflow-helpers.js';

const HS_BP1_008_REVEAL_TOP_THREE_STEP_ID = 'HS_BP1_008_REVEAL_TOP_THREE';
const TOP_COUNT = 3;

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerHsBp1008KosuzuWorkflowHandlers(): void {
  registerPendingAbilityStarterHandler(
    HS_BP1_008_ON_ENTER_MILL_THREE_DRAW_IF_ALL_MEMBERS_ABILITY_ID,
    (game, ability, options) =>
      startHsBp1008KosuzuInspection(game, ability, options.orderedResolution === true)
  );
  registerActiveEffectStepHandler(
    HS_BP1_008_ON_ENTER_MILL_THREE_DRAW_IF_ALL_MEMBERS_ABILITY_ID,
    HS_BP1_008_REVEAL_TOP_THREE_STEP_ID,
    (game, _input, context) => finishHsBp1008Kosuzu(game, context.continuePendingCardEffects)
  );
}

function startHsBp1008KosuzuInspection(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  const millResult = moveTopDeckCardsToWaitingRoomWithRefresh(game, player.id, TOP_COUNT);
  if (!millResult) {
    return game;
  }

  const milledCardIds = millResult.movedCardIds;
  const conditionMet =
    milledCardIds.length === TOP_COUNT &&
    allCardIdsMatchingSelector(millResult.gameState, milledCardIds, typeIs(CardType.MEMBER));
  const refreshText = millResult.refreshCount > 0 ? '期间发生卡组更新。' : '';
  const rewardText = conditionMet
    ? '这些卡均为成员卡。确认后抽1张。'
    : '这些卡不满足均为成员卡。确认后不抽牌。';

  return startPendingActiveEffect(millResult.gameState, {
    ability,
    playerId: player.id,
    activeEffect: {
      id: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      controllerId: ability.controllerId,
      effectText: getAbilityEffectText(ability.abilityId),
      stepId: HS_BP1_008_REVEAL_TOP_THREE_STEP_ID,
      stepText: `已将卡组顶合计${milledCardIds.length}张放置入休息室。${refreshText}${rewardText}`,
      awaitingPlayerId: player.id,
      revealedCardIds: [...new Set(milledCardIds)],
      metadata: {
        sourceZone: ZoneType.MAIN_DECK,
        orderedResolution,
        milledCardIds,
        conditionMet,
        refreshCount: millResult.refreshCount,
      },
    },
    actionPayload: {
      sourceCardId: ability.sourceCardId,
      step: 'MILL_TOP_CARDS',
      milledCardIds,
      conditionMet,
      refreshCount: millResult.refreshCount,
    },
  });
}

function finishHsBp1008Kosuzu(
  game: GameState,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !== HS_BP1_008_ON_ENTER_MILL_THREE_DRAW_IF_ALL_MEMBERS_ABILITY_ID ||
    effect.stepId !== HS_BP1_008_REVEAL_TOP_THREE_STEP_ID
  ) {
    return game;
  }

  const player = getPlayerById(game, effect.controllerId);
  if (!player) {
    return game;
  }

  let state: GameState = {
    ...game,
    activeEffect: null,
  };
  const milledCardIds = getStringArrayMetadata(effect.metadata?.milledCardIds);
  const conditionMet = effect.metadata?.conditionMet === true;
  const drawResult = conditionMet ? drawCardsForPlayer(state, player.id, 1) : null;
  if (conditionMet && !drawResult) {
    return game;
  }
  state = drawResult?.gameState ?? state;

  return continuePendingCardEffects(
    addAction(state, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'FINISH_MILL_TOP_THREE_DRAW_IF_ALL_MEMBERS',
      milledCardIds,
      conditionMet,
      drawnCardIds: drawResult?.drawnCardIds ?? [],
      refreshCount:
        typeof effect.metadata?.refreshCount === 'number' ? effect.metadata.refreshCount : 0,
    }),
    effect.metadata?.orderedResolution === true
  );
}

function getStringArrayMetadata(value: unknown): readonly string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}
