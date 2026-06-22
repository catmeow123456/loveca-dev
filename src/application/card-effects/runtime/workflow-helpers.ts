import {
  addAction,
  type GameState,
} from '../../../domain/entities/game.js';
import { findCardAbilityDefinitionById } from '../definitions/lookup.js';

const ABILITY_USE_STEP = 'ABILITY_USE';

export interface AbilityUseContext {
  readonly abilityId: string;
  readonly sourceCardId: string;
}

export interface PayCostActionPayload {
  readonly abilityId: string;
  readonly sourceCardId: string;
  readonly pendingAbilityId?: string;
  readonly energyCardIds?: readonly string[];
  readonly amount?: number;
  readonly [key: string]: unknown;
}

export function getAbilityEffectText(abilityId: string): string {
  const effectText = findCardAbilityDefinitionById(abilityId)?.effectText;
  if (!effectText || effectText.trim().length === 0) {
    throw new Error(`Missing card ability effect text for abilityId: ${abilityId}`);
  }
  return effectText;
}

export function recordAbilityUseForContext(
  game: GameState,
  playerId: string,
  context: AbilityUseContext
): GameState {
  return addAction(game, 'RESOLVE_ABILITY', playerId, {
    abilityId: context.abilityId,
    sourceCardId: context.sourceCardId,
    step: ABILITY_USE_STEP,
    turnCount: game.turnCount,
  });
}

export function recordPayCostAction(
  game: GameState,
  playerId: string,
  payload: PayCostActionPayload
): GameState {
  return addAction(game, 'PAY_COST', playerId, payload);
}
