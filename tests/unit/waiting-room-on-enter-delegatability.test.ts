import { describe, expect, it } from 'vitest';
import { getWaitingRoomDelegatableOnEnterDefinitions } from '../../src/application/card-effects/runtime/delegatable-definitions';
import { getCardAbilityDefinitionsForCardCode } from '../../src/application/card-effects/definitions/lookup';

describe('waiting-room ON_ENTER delegatability', () => {
  it('is explicit opt-in and rejects source-member costs and slot prerequisites', () => {
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
