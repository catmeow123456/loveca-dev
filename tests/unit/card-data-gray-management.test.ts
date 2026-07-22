import { describe, expect, it } from 'vitest';
import {
  BLADE_HEART_COLOR_OPTIONS,
  BLADE_HEART_OPTIONS,
  MEMBER_HEART_COLOR_OPTIONS,
  REQUIREMENT_HEART_COLOR_OPTIONS,
  matchesBladeHeartFilter,
  matchesRequirementHeartColor,
} from '../../client/src/components/deck-editor/filter-constants';
import { formDataToYaml, yamlToFormData } from '../../client/src/components/admin/yaml-helpers';
import { BladeHeartEffect, CardType, HeartColor } from '../../src/shared/types/enums';

const doubleGrayBladeHearts = [
  { effect: BladeHeartEffect.HEART, heartColor: HeartColor.GRAY },
  { effect: BladeHeartEffect.HEART, heartColor: HeartColor.GRAY },
] as const;

describe('gray Blade Heart deck filter and card management', () => {
  it('exposes a distinct colorless filter and does not confuse it with All Heart', () => {
    expect(BLADE_HEART_OPTIONS).toContainEqual(
      expect.objectContaining({ value: 'HEART:GRAY', label: '无色' })
    );
    expect(BLADE_HEART_COLOR_OPTIONS).toContainEqual(
      expect.objectContaining({ value: HeartColor.GRAY, label: '无色' })
    );
    expect(matchesBladeHeartFilter(doubleGrayBladeHearts, 'HEART:GRAY')).toBe(true);
    expect(matchesBladeHeartFilter(doubleGrayBladeHearts, 'HEART:RAINBOW')).toBe(false);
  });

  it('keeps member, requirement, and Blade Heart option semantics distinct', () => {
    expect(MEMBER_HEART_COLOR_OPTIONS).toContainEqual(
      expect.objectContaining({ value: HeartColor.GRAY, label: '无色' })
    );
    expect(MEMBER_HEART_COLOR_OPTIONS).toContainEqual(
      expect.objectContaining({ value: HeartColor.RAINBOW, label: 'All' })
    );
    expect(REQUIREMENT_HEART_COLOR_OPTIONS).toContainEqual(
      expect.objectContaining({ value: HeartColor.RAINBOW, label: '无色' })
    );
    expect(REQUIREMENT_HEART_COLOR_OPTIONS).not.toContainEqual(
      expect.objectContaining({ value: HeartColor.GRAY })
    );
  });

  it('matches canonical and existing gray generic LIVE requirements through one filter', () => {
    expect(
      matchesRequirementHeartColor(new Map([[HeartColor.RAINBOW, 2]]), HeartColor.RAINBOW)
    ).toBe(true);
    expect(matchesRequirementHeartColor(new Map([[HeartColor.GRAY, 2]]), HeartColor.RAINBOW)).toBe(
      true
    );
    expect(matchesRequirementHeartColor(new Map([[HeartColor.GRAY, 2]]), HeartColor.PINK)).toBe(
      false
    );
  });

  it('preserves both gray Heart items through the card-management YAML round trip', () => {
    const yamlText = formDataToYaml(
      {
        cardType: CardType.LIVE,
        score: 8,
        requirements: [],
        bladeHearts: doubleGrayBladeHearts,
      },
      CardType.LIVE,
      true
    );
    const restored = yamlToFormData(yamlText, { cardType: CardType.LIVE });

    expect(restored.bladeHearts).toEqual(doubleGrayBladeHearts);
    expect(yamlText.match(/heartColor: GRAY/g)).toHaveLength(2);
  });
});
