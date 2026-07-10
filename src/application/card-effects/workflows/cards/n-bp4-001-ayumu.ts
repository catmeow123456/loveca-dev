import {
  addAction,
  getOpponent,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { OrientationState } from '../../../../shared/types/enums.js';
import { placeEnergyFromDeckToZoneByCardEffect } from '../../../effects/energy.js';
import { PL_N_BP4_001_LIVE_SUCCESS_LESS_ENERGY_PLACE_WAITING_ENERGY_ABILITY_ID } from '../../ability-ids.js';
import { getSourceMemberSlot } from '../../runtime/source-member.js';
import type { PendingAbilityStarterOptions } from '../../runtime/starter-registry.js';
import {
  getAbilityEffectText,
  registerManualConfirmablePendingAbilityStarterHandler,
} from '../../runtime/workflow-helpers.js';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerNBp4001AyumuWorkflowHandlers(): void {
  registerManualConfirmablePendingAbilityStarterHandler(
    PL_N_BP4_001_LIVE_SUCCESS_LESS_ENERGY_PLACE_WAITING_ENERGY_ABILITY_ID,
    (game, ability, options, context) =>
      resolveAyumuLiveSuccessEnergyPlacement(
        game,
        ability,
        options,
        context.continuePendingCardEffects
      ),
    (game, ability) => {
      const context = getAyumuLiveSuccessContext(game, ability);
      const previewText = getAyumuPreviewText(context);
      return {
        effectText: `${getAbilityEffectText(ability.abilityId)}（${previewText}）`,
        stepText: previewText,
      };
    }
  );
}

function resolveAyumuLiveSuccessEnergyPlacement(
  game: GameState,
  ability: PendingAbilityState,
  options: PendingAbilityStarterOptions,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  const context = getAyumuLiveSuccessContext(game, ability);
  let state: GameState = {
    ...game,
    pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
  };
  let placedEnergyCardIds: readonly string[] = [];

  if (context.conditionMet) {
    const placement = placeEnergyFromDeckToZoneByCardEffect(
      state,
      player.id,
      1,
      OrientationState.WAITING,
      {
        kind: 'CARD_EFFECT',
        playerId: player.id,
        sourceCardId: ability.sourceCardId,
        abilityId: ability.abilityId,
        pendingAbilityId: ability.id,
      }
    );
    if (!placement) {
      return game;
    }
    state = placement.gameState;
    placedEnergyCardIds = placement.placedEnergyCardIds;
  }

  return continuePendingCardEffects(
    addAction(state, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      sourceSlot: context.sourceSlot,
      step: context.conditionMet ? 'PLACE_WAITING_ENERGY' : context.noOpStep,
      sourceOnStage: context.sourceOnStage,
      ownEnergyCount: context.ownEnergyCount,
      opponentEnergyCount: context.opponentEnergyCount,
      energyDeckCount: context.energyDeckCount,
      conditionMet: context.conditionMet,
      placedEnergyCardIds,
    }),
    options.orderedResolution === true
  );
}

function getAyumuLiveSuccessContext(
  game: GameState,
  ability: Pick<PendingAbilityState, 'controllerId' | 'sourceCardId'>
): {
  readonly sourceSlot: ReturnType<typeof getSourceMemberSlot>;
  readonly sourceOnStage: boolean;
  readonly ownEnergyCount: number;
  readonly opponentEnergyCount: number;
  readonly energyDeckCount: number;
  readonly energyLessThanOpponent: boolean;
  readonly conditionMet: boolean;
  readonly noOpStep: string;
} {
  const player = getPlayerById(game, ability.controllerId);
  const opponent = player ? getOpponent(game, player.id) : null;
  const sourceSlot = player
    ? getSourceMemberSlot(game, player.id, ability.sourceCardId)
    : null;
  const sourceOnStage = sourceSlot !== null;
  const ownEnergyCount = player?.energyZone.cardIds.length ?? 0;
  const opponentEnergyCount = opponent?.energyZone.cardIds.length ?? 0;
  const energyDeckCount = player?.energyDeck.cardIds.length ?? 0;
  const energyLessThanOpponent = ownEnergyCount < opponentEnergyCount;
  const conditionMet = sourceOnStage && energyLessThanOpponent && energyDeckCount > 0;
  const noOpStep = !sourceOnStage
    ? 'SOURCE_NOT_ON_STAGE'
    : !energyLessThanOpponent
      ? 'ENERGY_NOT_LESS_THAN_OPPONENT'
      : 'NO_ENERGY_TO_PLACE';

  return {
    sourceSlot,
    sourceOnStage,
    ownEnergyCount,
    opponentEnergyCount,
    energyDeckCount,
    energyLessThanOpponent,
    conditionMet,
    noOpStep,
  };
}

function getAyumuPreviewText(context: ReturnType<typeof getAyumuLiveSuccessContext>): string {
  if (!context.sourceOnStage) {
    return `当前能量数量：自己${context.ownEnergyCount}张，对方${context.opponentEnergyCount}张。此成员已不在舞台，不放置能量。`;
  }
  if (!context.energyLessThanOpponent) {
    return `当前能量数量：自己${context.ownEnergyCount}张，对方${context.opponentEnergyCount}张。自己能量不少于对方，条件不满足，不放置能量。`;
  }
  if (context.energyDeckCount === 0) {
    return `当前能量数量：自己${context.ownEnergyCount}张，对方${context.opponentEnergyCount}张。条件满足，但能量卡组为空，不放置能量。`;
  }
  return `当前能量数量：自己${context.ownEnergyCount}张，对方${context.opponentEnergyCount}张。条件满足，放置1张待机状态能量。`;
}
