import type { HeartColor } from '@game/shared/types/enums';

type ColorRequirementsLike =
  | ReadonlyMap<HeartColor, number>
  | Map<HeartColor, number>
  | Record<string, number>
  | null
  | undefined;

export function getHeartRequirementEntries(
  colorRequirements: ColorRequirementsLike
): Array<[HeartColor, number]> {
  if (!colorRequirements) {
    return [];
  }

  if (colorRequirements instanceof Map) {
    return Array.from(colorRequirements.entries()).filter((entry): entry is [HeartColor, number] => {
      const [, count] = entry;
      return typeof count === 'number' && count > 0;
    });
  }

  return Object.entries(colorRequirements)
    .map(([color, count]) => [color as HeartColor, Number(count)] as [HeartColor, number])
    .filter(([, count]) => Number.isFinite(count) && count > 0);
}
