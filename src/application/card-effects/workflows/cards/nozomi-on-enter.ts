import {
  addAction,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { CardType, ZoneType } from '../../../../shared/types/enums.js';
import { NOZOMI_ON_ENTER_ABILITY_ID } from '../../ability-ids.js';
import { startPendingActiveEffect } from '../../runtime/active-effect.js';
import { drawCardsForPlayer } from '../../runtime/actions.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText } from '../../runtime/workflow-helpers.js';
import { typeIs } from '../../../effects/card-selectors.js';
import { hasCardIdsMatchingSelector } from '../../../effects/conditions.js';
import { moveTopDeckCardsToWaitingRoomWithRefresh } from '../../../effects/look-top.js';

const NOZOMI_REVEAL_STEP_ID = 'NOZOMI_REVEAL_TOP_FIVE';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerNozomiOnEnterWorkflowHandlers(): void {
  registerPendingAbilityStarterHandler(NOZOMI_ON_ENTER_ABILITY_ID, (game, ability, options) =>
    startNozomiOnEnterInspection(game, ability, options.orderedResolution === true)
  );
  registerActiveEffectStepHandler(
    NOZOMI_ON_ENTER_ABILITY_ID,
    NOZOMI_REVEAL_STEP_ID,
    (game, _input, context) => finishNozomiOnEnter(game, context.continuePendingCardEffects)
  );
}

function startNozomiOnEnterInspection(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  const millResult = moveTopDeckCardsToWaitingRoomWithRefresh(game, player.id, 5);
  if (!millResult) {
    return game;
  }

  const milledCardIds = millResult.movedCardIds;
  const hasMilledLiveCard = hasCardIdsMatchingSelector(
    millResult.gameState,
    milledCardIds,
    typeIs(CardType.LIVE)
  );
  const refreshText = millResult.refreshCount > 0 ? '期间发生卡组更新。' : '';
  const rewardText = hasMilledLiveCard
    ? '其中有LIVE卡。确认后抽1张。'
    : '其中没有LIVE卡。确认后不抽牌。';

  return startPendingActiveEffect(millResult.gameState, {
    ability,
    playerId: player.id,
    activeEffect: {
      id: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      controllerId: ability.controllerId,
      effectText: getAbilityEffectText(NOZOMI_ON_ENTER_ABILITY_ID),
      stepId: NOZOMI_REVEAL_STEP_ID,
      stepText: `已将卡组顶合计${milledCardIds.length}张放置入休息室。${refreshText}${rewardText}`,
      awaitingPlayerId: player.id,
      revealedCardIds: [...new Set(milledCardIds)],
      metadata: {
        sourceZone: ZoneType.MAIN_DECK,
        orderedResolution,
        milledCardIds,
        hasMilledLiveCard,
        refreshCount: millResult.refreshCount,
      },
    },
    actionPayload: {
      sourceCardId: ability.sourceCardId,
      step: 'MILL_TOP_CARDS',
      milledCardIds,
      hasMilledLiveCard,
      refreshCount: millResult.refreshCount,
    },
  });
}

function finishNozomiOnEnter(
  game: GameState,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !== NOZOMI_ON_ENTER_ABILITY_ID ||
    effect.stepId !== NOZOMI_REVEAL_STEP_ID
  ) {
    return game;
  }

  const player = getPlayerById(game, effect.controllerId);
  if (!player) {
    return game;
  }

  const milledCardIds = getStringArrayMetadata(effect.metadata?.milledCardIds);
  const hasMilledLiveCard = effect.metadata?.hasMilledLiveCard === true;

  let state = game;
  let drawnCardId: string | null = null;
  if (hasMilledLiveCard) {
    const drawResult = drawCardsForPlayer(state, player.id, 1);
    if (!drawResult) {
      return game;
    }
    state = drawResult.gameState;
    drawnCardId = drawResult.drawnCardIds[0] ?? null;
  }

  state = {
    ...state,
    activeEffect: null,
  };

  return continuePendingCardEffects(
    addAction(state, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'FINISH',
      milledCardIds,
      hasMilledLiveCard,
      drawnCardId,
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
