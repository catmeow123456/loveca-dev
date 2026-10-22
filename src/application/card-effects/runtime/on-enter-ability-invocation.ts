import {
  getCardById,
  type GameState,
  type OnEnterAbilityInvocation,
} from '../../../domain/entities/game.js';

export interface OnEnterAbilityInvocationSource {
  readonly sourceCardId: string;
  readonly onEnterInvocation?: OnEnterAbilityInvocation;
}

/** Definition/configuration identity only; all game actions still use sourceCardId. */
export function getAbilityTemplateCardCode(
  game: GameState,
  invocation: OnEnterAbilityInvocationSource
): string {
  return (
    invocation.onEnterInvocation?.definitionSourceCardCode ??
    getCardById(game, invocation.sourceCardId)?.data.cardCode ??
    ''
  );
}

/** Waives only this invocation's printed activation costs, never its effects or conditions. */
export function isAbilityActivationCostWaived(invocation: {
  readonly onEnterInvocation?: OnEnterAbilityInvocation;
}): boolean {
  return invocation.onEnterInvocation?.waiveActivationCosts === true;
}
