import {
  addAction,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { findMemberSlot } from '../../../../domain/entities/player.js';
import type { SlotPosition } from '../../../../shared/types/enums.js';
import { BP5_006_LIVE_START_LIVE_ZONE_TWO_DRAW_ABILITY_ID } from '../../ability-ids.js';
import { drawCardsForPlayer } from '../../runtime/actions.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import {
  getAbilityEffectText,
  maybeStartConfirmablePendingAbilityConfirmation,
} from '../../runtime/workflow-helpers.js';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

const BP5_006_RESOLVE_STEP = 'LIVE_START_LIVE_ZONE_TWO_DRAW';

export function registerBp5006MakiWorkflowHandlers(): void {
  registerPendingAbilityStarterHandler(
    BP5_006_LIVE_START_LIVE_ZONE_TWO_DRAW_ABILITY_ID,
    (game, ability, options, context) => {
      const confirmation = maybeStartConfirmablePendingAbilityConfirmation(game, ability, options, {
        effectText: getBp5006MakiConfirmationEffectText(game, ability),
        stepText: getBp5006MakiConfirmationStepText(game, ability),
      });
      if (confirmation) {
        return confirmation;
      }

      return resolveBp5006MakiLiveStart(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      );
    }
  );
}

function resolveBp5006MakiLiveStart(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  const context = getBp5006MakiContext(game, ability);
  const stateWithoutPending: GameState = {
    ...game,
    pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
  };
  const drawResult = context.shouldDraw
    ? drawCardsForPlayer(stateWithoutPending, player.id, 1)
    : null;
  const stateAfterEffect = drawResult?.gameState ?? stateWithoutPending;

  return continuePendingCardEffects(
    addAction(stateAfterEffect, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: BP5_006_RESOLVE_STEP,
      sourceSlot: context.sourceSlot,
      sourceOnStage: context.sourceOnStage,
      liveZoneCardCount: context.liveZoneCardCount,
      conditionMet: context.liveZoneConditionMet,
      drawnCardIds: drawResult?.drawnCardIds ?? [],
    }),
    orderedResolution
  );
}

function getBp5006MakiConfirmationEffectText(
  game: GameState,
  ability: PendingAbilityState
): string {
  const context = getBp5006MakiContext(game, ability);
  const sourceText = context.sourceOnStage ? '来源仍在己方舞台' : '来源不在己方舞台';
  const resultText = context.shouldDraw ? '满足条件，抽1张' : '未满足条件，不抽牌';
  return `${getAbilityEffectText(ability.abilityId)}（当前LIVE区 ${context.liveZoneCardCount}张，${sourceText}，${resultText}）`;
}

function getBp5006MakiConfirmationStepText(
  game: GameState,
  ability: PendingAbilityState
): string {
  const context = getBp5006MakiContext(game, ability);
  if (!context.sourceOnStage) {
    return `来源不在己方舞台，确认后不抽牌。当前LIVE区 ${context.liveZoneCardCount}张。`;
  }
  return context.liveZoneConditionMet
    ? `当前LIVE区 ${context.liveZoneCardCount}张，条件满足。确认后抽1张卡。`
    : `当前LIVE区 ${context.liveZoneCardCount}张，条件不满足。确认后不抽牌。`;
}

function getBp5006MakiContext(
  game: GameState,
  ability: PendingAbilityState
): {
  readonly sourceSlot: SlotPosition | null;
  readonly sourceOnStage: boolean;
  readonly liveZoneCardCount: number;
  readonly liveZoneConditionMet: boolean;
  readonly shouldDraw: boolean;
} {
  const player = getPlayerById(game, ability.controllerId);
  const sourceSlot = player ? findMemberSlot(player, ability.sourceCardId) : null;
  const liveZoneCardCount = player?.liveZone.cardIds.length ?? 0;
  const liveZoneConditionMet = liveZoneCardCount >= 2;
  const sourceOnStage = sourceSlot !== null && sourceSlot !== undefined;
  return {
    sourceSlot,
    sourceOnStage,
    liveZoneCardCount,
    liveZoneConditionMet,
    shouldDraw: sourceOnStage && liveZoneConditionMet,
  };
}
