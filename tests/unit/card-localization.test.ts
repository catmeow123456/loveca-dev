import { describe, expect, it } from 'vitest';
import { getCardLocalizedInfo } from '../../client/src/lib/cardLocalization';

const COLOR_BLADE_TOKENS =
  '[桃ブレード]、[赤ブレード]、[黄ブレード]、[緑ブレード]、[青ブレード]、[紫ブレード]';

describe('localized card text', () => {
  it.each(['PL!N-bp7-025-SECL', 'PL!N-bp7-025-L'])(
    'preserves all six official Blade Heart tokens for every N-bp7-025 rarity: %s',
    (cardCode) => {
      const localized = getCardLocalizedInfo({
        cardCode,
        cardTextCn: `第一段获得[ブレード]。\n第二段存在${COLOR_BLADE_TOKENS}中至少3种。`,
        cardTextJp: `前段は[ブレード]を得る。\n後段は${COLOR_BLADE_TOKENS}のうち3種類以上。`,
      });

      for (const effectText of [localized.effectCn, localized.effectJp]) {
        expect(effectText).toContain(COLOR_BLADE_TOKENS);
        expect(effectText).toContain('[ブレード]');
      }
    }
  );
});
