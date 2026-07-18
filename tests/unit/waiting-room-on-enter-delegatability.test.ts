import { describe, expect, it } from 'vitest';
import { getWaitingRoomDelegatableOnEnterDefinitions } from '../../src/application/card-effects/runtime/delegatable-definitions';
import { getCardAbilityDefinitionsForCardCode } from '../../src/application/card-effects/definitions/lookup';

describe('waiting-room ON_ENTER delegatability', () => {
  it('explicitly exposes all four N-pb1 named-member look-top definitions', () => {
    const cases = [
      ['PL!N-pb1-016-P+', 'PL!N-pb1-016:on-enter-look-top-two-karin-member'],
      ['PL!N-pb1-018-R', 'PL!N-pb1-018:on-enter-look-top-two-kanata-member'],
      ['PL!N-pb1-021-P+', 'PL!N-pb1-021:on-enter-look-top-two-rina-member'],
      ['PL!N-pb1-024-R', 'PL!N-pb1-024:on-enter-look-top-two-lanzhu-member'],
    ] as const;

    for (const [cardCode, abilityId] of cases) {
      expect(getWaitingRoomDelegatableOnEnterDefinitions(cardCode).map((d) => d.abilityId)).toEqual([
        abilityId,
      ]);
    }
  });

  it('is explicit opt-in and rejects source-member costs and slot prerequisites', () => {
    for (const cardCode of [
      'PL!N-bp1-013-P+',
      'PL!N-pb1-015-R',
      'PL!N-pb1-017-P+',
      'PL!N-pb1-023-R',
      'PL!N-bp4-006-P',
      'PL!N-pb1-002-P＋',
      'PL!N-pb1-002-R',
      'PL!N-pb1-001-P＋',
      'PL!N-pb1-001-R',
      'PL!N-pb1-010-P＋',
      'PL!N-pb1-010-R',
    ]) {
      expect(getWaitingRoomDelegatableOnEnterDefinitions(cardCode)).toEqual([]);
    }
    expect(getWaitingRoomDelegatableOnEnterDefinitions('PL!N-bp3-012-R').map((d) => d.abilityId)).toEqual([
      'PL!N-bp3-012:on-enter-discard-look-top-nijigasaki-card',
    ]);
    expect(getWaitingRoomDelegatableOnEnterDefinitions('PL!SP-bp4-001-R')).toHaveLength(1);
    expect(getWaitingRoomDelegatableOnEnterDefinitions('PL!SP-bp4-002-R')).toEqual([]);
    const slotDefinition = getWaitingRoomDelegatableOnEnterDefinitions('PL!SP-bp5-015-N');
    expect(getCardAbilityDefinitionsForCardCode('PL!SP-bp5-015-N')[0]?.requiredSourceSlots).toEqual(['CENTER']);
    expect(slotDefinition).toEqual([]);
    expect(getWaitingRoomDelegatableOnEnterDefinitions('PL!N-bp5-009-R')).toEqual([]);
  });
});
