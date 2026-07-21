import { describe, expect, it } from 'vitest';
import { getContinuousLiveModifierVisibilityDeclarations } from '../../src/domain/rules/live-modifiers';

describe('continuous live modifier visibility governance', () => {
  it('requires every registered definition and factory result to declare its information visibility', () => {
    const declarations = getContinuousLiveModifierVisibilityDeclarations();

    expect(declarations.length).toBeGreaterThan(0);
    expect(
      declarations.every(
        (declaration) =>
          declaration.visibility.kind === 'PUBLIC' ||
          declaration.visibility.kind === 'PLAYER_LIVE_ZONE_CONTENTS'
      )
    ).toBe(true);
    expect(declarations.some((declaration) => declaration.visibility.kind === 'PUBLIC')).toBe(true);
  });

  it('keeps the complete reviewed hidden-LIVE dependency inventory at definition level', () => {
    const hiddenDeclarations = getContinuousLiveModifierVisibilityDeclarations()
      .filter((declaration) => declaration.visibility.kind === 'PLAYER_LIVE_ZONE_CONTENTS')
      .flatMap((declaration) => {
        const visibility = declaration.visibility;
        if (visibility.kind !== 'PLAYER_LIVE_ZONE_CONTENTS') return [];
        return [...(declaration.cardCodes ?? []), ...(declaration.baseCardCodes ?? [])].map(
          (cardCode) => ({ cardCode, player: visibility.player })
        );
      })
      .sort((left, right) => left.cardCode.localeCompare(right.cardCode));

    expect(hiddenDeclarations).toEqual(
      [
        { cardCode: 'PL!-bp4-002', player: 'SELF' },
        { cardCode: 'PL!-bp6-022', player: 'SELF' },
        { cardCode: 'PL!N-bp1-012', player: 'SELF' },
        { cardCode: 'PL!N-pb1-001', player: 'SELF' },
        { cardCode: 'PL!N-pb1-007', player: 'SELF' },
        { cardCode: 'PL!S-bp5-010', player: 'OPPONENT' },
        { cardCode: 'PL!S-bp5-011', player: 'OPPONENT' },
        { cardCode: 'PL!SP-bp2-010', player: 'OPPONENT' },
        { cardCode: 'PL!SP-bp5-012', player: 'SELF' },
      ].sort((left, right) => left.cardCode.localeCompare(right.cardCode))
    );
  });
});
