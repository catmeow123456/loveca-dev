import {
  addAction,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { ZoneType } from '../../../../shared/types/enums.js';
import {
  S_BP5_015_ON_ENTER_MILL_TOP_TEN_ABILITY_ID,
  S_BP6_012_ON_ENTER_MILL_TOP_FIVE_ABILITY_ID,
  S_BP6_017_ON_ENTER_MILL_TOP_FIVE_ABILITY_ID,
} from '../../ability-ids.js';
import { startPendingActiveEffect } from '../../runtime/active-effect.js';
import type { EnqueueTriggeredCardEffectsForEnterWaitingRoom } from '../../runtime/enter-waiting-room-triggers.js';
import { moveTopDeckCardsToWaitingRoomWithRefreshAndEnqueueTriggers } from '../../runtime/main-deck-waiting-room-triggers.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText } from '../../runtime/workflow-helpers.js';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

interface DirectMillTopConfig {
  readonly abilityId: string;
  readonly stepId: string;
  readonly topCount: number;
  readonly finishStep: string;
}

const DIRECT_MILL_TOP_CONFIGS: readonly DirectMillTopConfig[] = [
  {
    abilityId: S_BP5_015_ON_ENTER_MILL_TOP_TEN_ABILITY_ID,
    stepId: 'S_BP5_015_REVEAL_MILLED_TOP_TEN',
    topCount: 10,
    finishStep: 'FINISH_MILL_TOP_TEN',
  },
  {
    abilityId: S_BP6_012_ON_ENTER_MILL_TOP_FIVE_ABILITY_ID,
    stepId: 'S_BP6_012_REVEAL_MILLED_TOP_FIVE',
    topCount: 5,
    finishStep: 'FINISH_MILL_TOP_FIVE',
  },
  {
    abilityId: S_BP6_017_ON_ENTER_MILL_TOP_FIVE_ABILITY_ID,
    stepId: 'S_BP6_017_REVEAL_MILLED_TOP_FIVE',
    topCount: 5,
    finishStep: 'FINISH_MILL_TOP_FIVE',
  },
];

export function registerDirectMillTopWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom;
}): void {
  for (const config of DIRECT_MILL_TOP_CONFIGS) {
    registerPendingAbilityStarterHandler(config.abilityId, (game, ability, options) =>
      startDirectMillTopWorkflow(
        game,
        ability,
        options.orderedResolution === true,
        config,
        deps.enqueueTriggeredCardEffects
      )
    );
    registerActiveEffectStepHandler(config.abilityId, config.stepId, (game, _input, context) =>
      finishDirectMillTopWorkflow(game, context.continuePendingCardEffects, config)
    );
  }
}

function startDirectMillTopWorkflow(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  config: DirectMillTopConfig,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  const millResult = moveTopDeckCardsToWaitingRoomWithRefreshAndEnqueueTriggers(
    game,
    player.id,
    config.topCount,
    enqueueTriggeredCardEffects
  );
  if (!millResult) {
    return game;
  }

  const milledCardIds = millResult.movedCardIds;
  const refreshText = millResult.refreshCount > 0 ? '期间发生卡组更新。' : '';

  return startPendingActiveEffect(millResult.gameState, {
    ability,
    playerId: player.id,
    activeEffect: {
      id: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      controllerId: ability.controllerId,
      effectText: getAbilityEffectText(config.abilityId),
      stepId: config.stepId,
      stepText: `已将卡组顶合计${milledCardIds.length}张放置入休息室。${refreshText}`,
      awaitingPlayerId: player.id,
      revealedCardIds: [...new Set(milledCardIds)],
      metadata: {
        sourceZone: ZoneType.MAIN_DECK,
        orderedResolution,
        milledCardIds,
        refreshCount: millResult.refreshCount,
      },
    },
    actionPayload: {
      sourceCardId: ability.sourceCardId,
      step: 'MILL_TOP_CARDS',
      milledCardIds,
      refreshCount: millResult.refreshCount,
    },
  });
}

function finishDirectMillTopWorkflow(
  game: GameState,
  continuePendingCardEffects: ContinuePendingCardEffects,
  config: DirectMillTopConfig
): GameState {
  const effect = game.activeEffect;
  if (!effect || effect.abilityId !== config.abilityId || effect.stepId !== config.stepId) {
    return game;
  }

  const player = getPlayerById(game, effect.controllerId);
  if (!player) {
    return game;
  }

  const milledCardIds = getStringArrayMetadata(effect.metadata?.milledCardIds);
  const refreshCount =
    typeof effect.metadata?.refreshCount === 'number' ? effect.metadata.refreshCount : 0;

  return continuePendingCardEffects(
    addAction(
      {
        ...game,
        activeEffect: null,
      },
      'RESOLVE_ABILITY',
      player.id,
      {
        pendingAbilityId: effect.id,
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
        step: config.finishStep,
        milledCardIds,
        refreshCount,
      }
    ),
    effect.metadata?.orderedResolution === true
  );
}

function getStringArrayMetadata(value: unknown): readonly string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}
