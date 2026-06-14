import { describe, expect, it } from 'vitest';
import { inheritMissingBladeHeartsByBase } from '../../src/domain/card-data/blade-heart-inheritance';
import { BladeHeartEffect, HeartColor } from '../../src/shared/types/enums';

describe('inheritMissingBladeHeartsByBase', () => {
  it('inherits blade hearts from the same base card and card type', () => {
    const cards = inheritMissingBladeHeartsByBase([
      {
        card_code: 'PL!HS-bp2-022-L',
        card_type: 'LIVE',
        blade_hearts: [{ effect: BladeHeartEffect.HEART, heartColor: HeartColor.RAINBOW }],
      },
      {
        card_code: 'PL!HS-bp2-022-L+',
        card_type: 'LIVE',
        blade_hearts: null,
      },
    ]);

    expect(cards[1].blade_hearts).toEqual([
      { effect: BladeHeartEffect.HEART, heartColor: HeartColor.RAINBOW },
    ]);
    expect(cards[1].blade_hearts).not.toBe(cards[0].blade_hearts);
  });

  it('does not overwrite existing blade hearts on another rarity', () => {
    const cards = inheritMissingBladeHeartsByBase([
      {
        card_code: 'TEST-bp1-001-R',
        card_type: 'LIVE',
        blade_hearts: [{ effect: BladeHeartEffect.HEART, heartColor: HeartColor.RAINBOW }],
      },
      {
        card_code: 'TEST-bp1-001-R+',
        card_type: 'LIVE',
        blade_hearts: [{ effect: BladeHeartEffect.DRAW }],
      },
    ]);

    expect(cards[1].blade_hearts).toEqual([{ effect: BladeHeartEffect.DRAW }]);
  });

  it('does not inherit across card types', () => {
    const cards = inheritMissingBladeHeartsByBase([
      {
        card_code: 'TEST-bp1-001-R',
        card_type: 'MEMBER',
        blade_hearts: [{ effect: BladeHeartEffect.HEART, heartColor: HeartColor.RAINBOW }],
      },
      {
        card_code: 'TEST-bp1-001-R+',
        card_type: 'LIVE',
        blade_hearts: null,
      },
    ]);

    expect(cards[1].blade_hearts).toBeNull();
  });
});
