import type { ActiveEffectState, GameState } from '../../../domain/entities/game.js';

type ActivatedAbilityEnergyResumeValidator = (
  game: GameState,
  invocation: ActiveEffectState
) => boolean;

const validators = new Map<string, ActivatedAbilityEnergyResumeValidator>();

/** Source-bound costs opt in; unrelated pending payments keep their existing rules. */
export function registerActivatedAbilityEnergyResumeValidator(
  abilityId: string,
  validator: ActivatedAbilityEnergyResumeValidator
): void {
  validators.set(abilityId, validator);
}

export function canResumeActivatedAbilityEnergyPayment(
  game: GameState,
  invocation: ActiveEffectState
): boolean {
  return validators.get(invocation.abilityId)?.(game, invocation) ?? true;
}
