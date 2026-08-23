import { describe, expect, it } from 'vitest';
import type { AnyCardData } from '@game/domain/entities/card';
import { CardType } from '@game/shared/types/enums';
import { resolveRegistryCardImagePath } from './imageService';

describe('resolveRegistryCardImagePath', () => {
  it('uses the authoritative versioned filename from the runtime card registry', () => {
    const cards = new Map<string, AnyCardData>([
      [
        'PL!N-bp1-001-N',
        {
          cardCode: 'PL!N-bp1-001-N',
          cardType: CardType.ENERGY,
          name: 'Versioned image',
          imageFilename: 'source-image-0123456789abcdef01234567.webp',
        },
      ],
    ]);

    expect(resolveRegistryCardImagePath('PL!N-bp1-001-N', cards, 'medium')).toBe(
      '/images/medium/source-image-0123456789abcdef01234567.webp'
    );
  });

  it('falls back to the card code when the registry has no matching record', () => {
    expect(resolveRegistryCardImagePath('PL!N-bp1-002-N', new Map(), 'thumb')).toBe(
      '/images/thumb/PL!N-bp1-002-N.webp'
    );
  });
});
