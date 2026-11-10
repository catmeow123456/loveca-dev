import { HeartColor } from '@game/shared/types/enums';
import { PL_BP8_023_LIVE_START_LOW_COST_NO_BLADE_HEART_GAIN_ORANGE_ABILITY_ID } from '@game/application/card-effects/ability-ids';

/** Cosmetic selection only: the authority has already resolved both provenance and effective color. */
export function hasSnowHalationIgnition(grantAbilityId: string | undefined, color: HeartColor) {
  return (
    grantAbilityId === PL_BP8_023_LIVE_START_LOW_COST_NO_BLADE_HEART_GAIN_ORANGE_ABILITY_ID &&
    color === HeartColor.ORANGE
  );
}
