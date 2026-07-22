import { HeartColor } from '../../shared/types/enums.js';
import type { HeartRequirement } from '../entities/card.js';

export interface HeartRequirementModifier {
  readonly color: HeartColor;
  readonly countDelta: number;
}

/**
 * Apply Live Heart requirement modifiers while preserving requirement semantics.
 *
 * Generic/neutral requirements may be represented by totalRequired minus named
 * color requirements. Some card data also keeps the same amount in a RAINBOW
 * or GRAY entry for display, so this helper normalizes all forms to RAINBOW.
 */
export function applyHeartRequirementModifiers(
  requirement: HeartRequirement,
  modifiers: readonly HeartRequirementModifier[]
): HeartRequirement {
  if (modifiers.length === 0) {
    return requirement;
  }

  const colorRequirements = new Map(requirement.colorRequirements);
  const explicitGeneric = Math.max(
    colorRequirements.get(HeartColor.RAINBOW) ?? 0,
    colorRequirements.get(HeartColor.GRAY) ?? 0
  );
  colorRequirements.delete(HeartColor.RAINBOW);
  colorRequirements.delete(HeartColor.GRAY);

  const specificRequiredTotal = [...colorRequirements.values()].reduce(
    (total, count) => total + count,
    0
  );
  let genericRequired = Math.max(
    0,
    requirement.totalRequired - specificRequiredTotal,
    explicitGeneric
  );

  for (const modifier of modifiers) {
    if (modifier.countDelta === 0) {
      continue;
    }

    if (modifier.color === HeartColor.RAINBOW || modifier.color === HeartColor.GRAY) {
      genericRequired = Math.max(0, genericRequired + modifier.countDelta);
      continue;
    }

    const current = colorRequirements.get(modifier.color) ?? 0;
    const next = Math.max(0, current + modifier.countDelta);
    if (next > 0) {
      colorRequirements.set(modifier.color, next);
    } else {
      colorRequirements.delete(modifier.color);
    }
  }

  if (genericRequired > 0) {
    colorRequirements.set(HeartColor.RAINBOW, genericRequired);
  }

  const adjustedSpecificTotal = [...colorRequirements.entries()]
    .filter(([color]) => color !== HeartColor.RAINBOW && color !== HeartColor.GRAY)
    .reduce((total, [, count]) => total + count, 0);

  return {
    ...requirement,
    colorRequirements,
    totalRequired: adjustedSpecificTotal + genericRequired,
  };
}

export function reduceGenericHeartRequirement(
  requirement: HeartRequirement,
  reduction: number
): HeartRequirement {
  if (reduction <= 0) {
    return requirement;
  }

  return applyHeartRequirementModifiers(requirement, [
    { color: HeartColor.RAINBOW, countDelta: -reduction },
  ]);
}
