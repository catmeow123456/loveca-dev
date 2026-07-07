import { isMemberCardData } from '../../../../domain/entities/card.js';
import {
  addAction,
  getCardById,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { hasStrictNoAbilityCardText } from '../../../../shared/utils/card-text.js';
import { PL_S_BP5_001_ON_ENTER_RELAY_FROM_NO_ABILITY_DRAW_ABILITY_ID } from '../../ability-ids.js';
import { drawCardsForPlayer } from '../../runtime/actions.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerSBp5001ChikaWorkflowHandlers(): void {
  registerPendingAbilityStarterHandler(
    PL_S_BP5_001_ON_ENTER_RELAY_FROM_NO_ABILITY_DRAW_ABILITY_ID,
    (game, ability, options, context) =>
      resolveSBp5001ChikaOnEnterRelayDraw(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      )
  );
}

function resolveSBp5001ChikaOnEnterRelayDraw(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  const condition = getNoAbilityRelayReplacementCondition(game, ability);
  const sourceOnStage = Object.values(player.memberSlots.slots).includes(ability.sourceCardId);
  if (!sourceOnStage || !condition.conditionMet) {
    return consumePendingNoOp(
      game,
      ability,
      player.id,
      orderedResolution,
      continuePendingCardEffects,
      {
        step: 'CHECK_NO_ABILITY_RELAY_REPLACEMENT',
        reason: sourceOnStage ? condition.reason : 'SOURCE_NOT_ON_STAGE',
        relayReplacementCardIds: condition.relayReplacementCardIds,
        noAbilityRelayReplacementCardIds: condition.noAbilityRelayReplacementCardIds,
      }
    );
  }

  const stateWithoutPending: GameState = {
    ...game,
    pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
  };
  const drawResult = drawCardsForPlayer(stateWithoutPending, player.id, 1);
  if (!drawResult) {
    return consumePendingNoOp(
      game,
      ability,
      player.id,
      orderedResolution,
      continuePendingCardEffects,
      {
        step: 'CHECK_NO_ABILITY_RELAY_REPLACEMENT',
        reason: 'DRAW_FAILED',
        relayReplacementCardIds: condition.relayReplacementCardIds,
        noAbilityRelayReplacementCardIds: condition.noAbilityRelayReplacementCardIds,
      }
    );
  }

  return continuePendingCardEffects(
    addAction(drawResult.gameState, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      sourceSlot: ability.sourceSlot,
      step: 'DRAW_ONE_FROM_NO_ABILITY_RELAY_REPLACEMENT',
      relayReplacementCardIds: condition.relayReplacementCardIds,
      noAbilityRelayReplacementCardIds: condition.noAbilityRelayReplacementCardIds,
      drawnCardIds: drawResult.drawnCardIds,
    }),
    orderedResolution
  );
}

function consumePendingNoOp(
  game: GameState,
  ability: PendingAbilityState,
  playerId: string,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects,
  payload: Record<string, unknown>
): GameState {
  const stateWithoutPending: GameState = {
    ...game,
    pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
  };

  return continuePendingCardEffects(
    addAction(stateWithoutPending, 'RESOLVE_ABILITY', playerId, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      sourceSlot: ability.sourceSlot,
      conditionMet: false,
      ...payload,
    }),
    orderedResolution
  );
}

function getNoAbilityRelayReplacementCondition(
  game: GameState,
  ability: PendingAbilityState
):
  | {
      readonly conditionMet: true;
      readonly relayReplacementCardIds: readonly string[];
      readonly noAbilityRelayReplacementCardIds: readonly string[];
      readonly reason?: undefined;
    }
  | {
      readonly conditionMet: false;
      readonly reason: string;
      readonly relayReplacementCardIds: readonly string[];
      readonly noAbilityRelayReplacementCardIds: readonly string[];
    } {
  const relayReplacementCardIds = getRelayReplacementCardIds(ability.metadata?.relayReplacements);
  if (relayReplacementCardIds.length === 0) {
    return {
      conditionMet: false,
      reason: 'NOT_RELAY_ENTER',
      relayReplacementCardIds,
      noAbilityRelayReplacementCardIds: [],
    };
  }

  const noAbilityRelayReplacementCardIds = relayReplacementCardIds.filter((cardId) => {
    const card = getCardById(game, cardId);
    return (
      card !== null &&
      isMemberCardData(card.data) &&
      hasStrictNoAbilityCardText(card.data.cardText)
    );
  });
  if (noAbilityRelayReplacementCardIds.length === 0) {
    return {
      conditionMet: false,
      reason: 'NO_STRICT_NO_ABILITY_REPLACEMENT',
      relayReplacementCardIds,
      noAbilityRelayReplacementCardIds,
    };
  }

  return {
    conditionMet: true,
    relayReplacementCardIds,
    noAbilityRelayReplacementCardIds,
  };
}

function getRelayReplacementCardIds(value: unknown): readonly string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((replacement) => {
    if (
      replacement &&
      typeof replacement === 'object' &&
      'cardId' in replacement &&
      typeof replacement.cardId === 'string'
    ) {
      return [replacement.cardId];
    }
    return [];
  });
}
