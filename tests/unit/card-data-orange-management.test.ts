import { describe, expect, it } from 'vitest';
import {
  BLADE_HEART_COLOR_OPTIONS,
  BLADE_HEART_OPTIONS,
  MEMBER_HEART_COLOR_OPTIONS,
  REQUIREMENT_HEART_COLOR_OPTIONS,
  matchesBladeHeartFilter,
} from '../../client/src/components/deck-editor/filter-constants';
import { formDataToYaml, yamlToFormData } from '../../client/src/components/admin/yaml-helpers';
import { HeartColorSchema } from '../../src/domain/card-data/schema';
import { BladeHeartEffect, CardType, HeartColor } from '../../src/shared/types/enums';

const orangeBladeHeart = [
  { effect: BladeHeartEffect.HEART, heartColor: HeartColor.ORANGE },
] as const;

describe('orange Heart card data and management', () => {
  it('accepts ORANGE in the runtime card-data schema', () => {
    expect(HeartColorSchema.parse('ORANGE')).toBe(HeartColor.ORANGE);
  });

  it('exposes ORANGE as a distinct member, requirement, and Blade Heart filter', () => {
    for (const options of [
      MEMBER_HEART_COLOR_OPTIONS,
      REQUIREMENT_HEART_COLOR_OPTIONS,
      BLADE_HEART_COLOR_OPTIONS,
    ]) {
      expect(options).toContainEqual(
        expect.objectContaining({ value: HeartColor.ORANGE, label: '橙' })
      );
    }
    expect(BLADE_HEART_OPTIONS).toContainEqual(
      expect.objectContaining({ value: 'HEART:ORANGE', label: '橙' })
    );
    expect(matchesBladeHeartFilter(orangeBladeHeart, 'HEART:ORANGE')).toBe(true);
    expect(matchesBladeHeartFilter(orangeBladeHeart, 'HEART:YELLOW')).toBe(false);
  });

  it('preserves ORANGE through the card-management YAML round trip', () => {
    const yamlText = formDataToYaml(
      {
        cardType: CardType.LIVE,
        score: 5,
        requirements: [{ color: HeartColor.ORANGE, count: 1 }],
        bladeHearts: orangeBladeHeart,
      },
      CardType.LIVE,
      true
    );
    const restored = yamlToFormData(yamlText, { cardType: CardType.LIVE });

    expect(restored.requirements).toEqual([{ color: HeartColor.ORANGE, count: 1 }]);
    expect(restored.bladeHearts).toEqual(orangeBladeHeart);
    expect(yamlText).toContain('color: ORANGE');
    expect(yamlText).toContain('heartColor: ORANGE');
  });
});
