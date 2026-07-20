import {
  addAction,
  getOpponent,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { N_BP7_009_ON_ENTER_EACH_PLAYER_MILL_TOP_SEVEN_ABILITY_ID } from '../../ability-ids.js';
import { startPendingActiveEffect } from '../../runtime/active-effect.js';
import type { EnqueueTriggeredCardEffectsForEnterWaitingRoom } from '../../runtime/enter-waiting-room-triggers.js';
import { moveTopDeckCardsForPlayersWithRefreshAndEnqueueTriggers } from '../../runtime/main-deck-waiting-room-triggers.js';
import {
  registerPendingAbilityStarterHandler,
  type PendingAbilityStarterOptions,
} from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText } from '../../runtime/workflow-helpers.js';

const MILL_COUNT = 7;
const REVEAL_EACH_PLAYER_MILL_RESULT_STEP_ID = 'N_BP7_009_REVEAL_EACH_PLAYER_MILL_RESULT';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerNBp7009RinaWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom;
}): void {
  registerPendingAbilityStarterHandler(
    N_BP7_009_ON_ENTER_EACH_PLAYER_MILL_TOP_SEVEN_ABILITY_ID,
    (game, ability, options, context) =>
      resolveEachPlayerMillTopSeven(
        game,
        ability,
        options,
        context.continuePendingCardEffects,
        deps.enqueueTriggeredCardEffects
      )
  );
  registerActiveEffectStepHandler(
    N_BP7_009_ON_ENTER_EACH_PLAYER_MILL_TOP_SEVEN_ABILITY_ID,
    REVEAL_EACH_PLAYER_MILL_RESULT_STEP_ID,
    (game, _input, context) =>
      finishEachPlayerMillTopSevenResult(game, context.continuePendingCardEffects)
  );
}

function resolveEachPlayerMillTopSeven(
  game: GameState,
  ability: PendingAbilityState,
  options: PendingAbilityStarterOptions,
  continuePendingCardEffects: ContinuePendingCardEffects,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom
): GameState {
  const controller = getPlayerById(game, ability.controllerId);
  const opponent = controller ? getOpponent(game, controller.id) : null;
  if (!controller || !opponent) return game;

  const result = moveTopDeckCardsForPlayersWithRefreshAndEnqueueTriggers(
    game,
    [controller.id, opponent.id],
    MILL_COUNT,
    enqueueTriggeredCardEffects,
    {
      cause: {
        kind: 'CARD_EFFECT',
        playerId: controller.id,
        sourceCardId: ability.sourceCardId,
        abilityId: ability.abilityId,
        pendingAbilityId: ability.id,
      },
    }
  );
  if (!result) return game;

  const movedCardIdsByPlayer = result.playerResults.map((entry) => ({
    playerId: entry.playerId,
    movedCardIds: entry.movedCardIds,
  }));
  const refreshCountsByPlayer = result.playerResults.map((entry) => ({
    playerId: entry.playerId,
    refreshCount: entry.refreshCount,
  }));
  const revealOrderPlayerIds = [controller.id, opponent.id];
  const firstRevealResult = revealOrderPlayerIds
    .map((playerId) => movedCardIdsByPlayer.find((entry) => entry.playerId === playerId))
    .find((entry) => entry && entry.movedCardIds.length > 0);
  if (!firstRevealResult) {
    return continuePendingCardEffects(
      addAction(
        {
          ...result.gameState,
          pendingAbilities: result.gameState.pendingAbilities.filter(
            (candidate) => candidate.id !== ability.id
          ),
        },
        'RESOLVE_ABILITY',
        controller.id,
        {
          pendingAbilityId: ability.id,
          abilityId: ability.abilityId,
          sourceCardId: ability.sourceCardId,
          step: 'FINISH_EACH_PLAYER_MILL_TOP_SEVEN_NO_CARDS',
          movedCardIdsByPlayer,
          refreshCountsByPlayer,
        }
      ),
      options.orderedResolution === true
    );
  }

  return startPendingActiveEffect(result.gameState, {
    ability,
    playerId: controller.id,
    activeEffect: {
      id: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      controllerId: ability.controllerId,
      effectText: getAbilityEffectText(ability.abilityId),
      stepId: REVEAL_EACH_PLAYER_MILL_RESULT_STEP_ID,
      stepText: getRevealStepText(firstRevealResult.playerId, controller.id),
      awaitingPlayerId: controller.id,
      revealedCardIds: [...new Set(firstRevealResult.movedCardIds)],
      selectionLabel: getRevealSelectionLabel(firstRevealResult.playerId, controller.id),
      confirmSelectionLabel: '确认公开结果',
      metadata: {
        orderedResolution: options.orderedResolution === true,
        movedCardIdsByPlayer,
        refreshCountsByPlayer,
        revealOrderPlayerIds,
        currentRevealPlayerId: firstRevealResult.playerId,
      },
    },
    actionPayload: {
      sourceCardId: ability.sourceCardId,
      step: 'REVEAL_EACH_PLAYER_MILL_TOP_SEVEN',
      movedCardIdsByPlayer,
      refreshCountsByPlayer,
      revealPlayerId: firstRevealResult.playerId,
    },
  });
}

function finishEachPlayerMillTopSevenResult(
  game: GameState,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !== N_BP7_009_ON_ENTER_EACH_PLAYER_MILL_TOP_SEVEN_ABILITY_ID ||
    effect.stepId !== REVEAL_EACH_PLAYER_MILL_RESULT_STEP_ID
  ) {
    return game;
  }
  const controller = getPlayerById(game, effect.controllerId);
  if (!controller) return game;

  const movedCardIdsByPlayer = getPlayerMovedCardIdsMetadata(effect.metadata?.movedCardIdsByPlayer);
  const refreshCountsByPlayer = getPlayerRefreshCountMetadata(
    effect.metadata?.refreshCountsByPlayer
  );
  const revealOrderPlayerIds = getStringArrayMetadata(effect.metadata?.revealOrderPlayerIds);
  const currentRevealPlayerId =
    typeof effect.metadata?.currentRevealPlayerId === 'string'
      ? effect.metadata.currentRevealPlayerId
      : null;
  const currentRevealIndex = currentRevealPlayerId
    ? revealOrderPlayerIds.indexOf(currentRevealPlayerId)
    : -1;
  const nextRevealResult = revealOrderPlayerIds
    .slice(currentRevealIndex + 1)
    .map((playerId) => movedCardIdsByPlayer.find((entry) => entry.playerId === playerId))
    .find((entry) => entry && entry.movedCardIds.length > 0);
  if (currentRevealIndex >= 0 && nextRevealResult) {
    return addAction(
      {
        ...game,
        activeEffect: {
          ...effect,
          stepText: getRevealStepText(nextRevealResult.playerId, controller.id),
          awaitingPlayerId: controller.id,
          revealedCardIds: [...new Set(nextRevealResult.movedCardIds)],
          selectionLabel: getRevealSelectionLabel(nextRevealResult.playerId, controller.id),
          metadata: {
            ...effect.metadata,
            currentRevealPlayerId: nextRevealResult.playerId,
          },
        },
      },
      'RESOLVE_ABILITY',
      controller.id,
      {
        pendingAbilityId: effect.id,
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
        step: 'REVEAL_NEXT_PLAYER_MILL_TOP_SEVEN',
        revealPlayerId: nextRevealResult.playerId,
        movedCardIds: nextRevealResult.movedCardIds,
      }
    );
  }
  return continuePendingCardEffects(
    addAction({ ...game, activeEffect: null }, 'RESOLVE_ABILITY', controller.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'FINISH_EACH_PLAYER_MILL_TOP_SEVEN',
      movedCardIdsByPlayer,
      refreshCountsByPlayer,
    }),
    effect.metadata?.orderedResolution === true
  );
}

function getRevealStepText(revealPlayerId: string, controllerId: string): string {
  return `${revealPlayerId === controllerId ? '发动方' : '对方'}已将卡组顶实际可处理的卡放置入休息室。`;
}

function getRevealSelectionLabel(revealPlayerId: string, controllerId: string): string {
  return `${revealPlayerId === controllerId ? '发动方' : '对方'}公开的卡片`;
}

function getPlayerMovedCardIdsMetadata(
  value: unknown
): readonly { readonly playerId: string; readonly movedCardIds: readonly string[] }[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!isRecord(entry) || typeof entry.playerId !== 'string') return [];
    return [
      {
        playerId: entry.playerId,
        movedCardIds: getStringArrayMetadata(entry.movedCardIds),
      },
    ];
  });
}

function getPlayerRefreshCountMetadata(
  value: unknown
): readonly { readonly playerId: string; readonly refreshCount: number }[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (
      !isRecord(entry) ||
      typeof entry.playerId !== 'string' ||
      typeof entry.refreshCount !== 'number'
    ) {
      return [];
    }
    return [{ playerId: entry.playerId, refreshCount: entry.refreshCount }];
  });
}

function getStringArrayMetadata(value: unknown): readonly string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}
