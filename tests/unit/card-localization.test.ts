import { describe, expect, it } from 'vitest';
import {
  correctKnownLocalizedCardText,
  getCardLocalizedInfo,
} from '../../client/src/lib/cardLocalization';

const WRONG_COLOR_TOKENS =
  '[桃ブレード]、[赤ブレード]、[黄ブレード]、[緑ブレード]、[青ブレード]、[紫ブレード]';
const CORRECT_COLOR_TOKENS =
  '[桃ハート]、[赤ハート]、[黄ハート]、[緑ハート]、[青ハート]、[紫ハート]';

describe('known localized card-text source corrections', () => {
  it.each(['PL!N-bp7-025-SECL', 'PL!N-bp7-025-L'])(
    'corrects all six upstream color tokens for every N-bp7-025 rarity: %s',
    (cardCode) => {
      const localized = getCardLocalizedInfo({
        cardCode,
        cardTextCn: `第一段获得[ブレード]。\n第二段存在${WRONG_COLOR_TOKENS}中至少3种。`,
        cardTextJp: `前段は[ブレード]を得る。\n後段は${WRONG_COLOR_TOKENS}のうち3種類以上。`,
      });

      for (const effectText of [localized.effectCn, localized.effectJp]) {
        expect(effectText).toContain(CORRECT_COLOR_TOKENS);
        expect(effectText).not.toMatch(/\[(桃|赤|黄|緑|青|紫)ブレード\]/);
        expect(effectText).toContain('[ブレード]');
      }
    }
  );

  it('is idempotent for already corrected text and leaves adjacent base card codes untouched', () => {
    expect(
      correctKnownLocalizedCardText('PL!N-bp7-025-SECL', `存在${CORRECT_COLOR_TOKENS}。`)
    ).toBe(`存在${CORRECT_COLOR_TOKENS}。`);
    expect(correctKnownLocalizedCardText('PL!N-bp7-026-SECL', WRONG_COLOR_TOKENS)).toBe(
      WRONG_COLOR_TOKENS
    );
  });
});
