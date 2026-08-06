import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  CardAbilityCategory,
  CardAbilitySourceZone,
} from '../../src/application/card-effects/ability-definition-types';
import { getWaitingRoomDelegatableOnEnterDefinitions } from '../../src/application/card-effects/runtime/delegatable-definitions';
import { getCardAbilityDefinitionsForCardCode } from '../../src/application/card-effects/definitions/lookup';
import {
  SP_BP2_005_ON_ENTER_PAY_TWO_ENERGY_LOOK_TOP_SEVEN_LIELLA_CARD_ABILITY_ID,
  SP_BP5_013_ON_ENTER_DISCARD_LOOK_TOP_SUNNYPASSION_OR_BLADE_HEART_LIELLA_ABILITY_ID,
} from '../../src/application/card-effects/ability-ids';
import { TriggerCondition } from '../../src/shared/types/enums';
import { getBaseCardCode, normalizeCardCode } from '../../src/shared/utils/card-code';

interface LlocgCardRecord {
  readonly card_no?: string;
  readonly type?: string;
  readonly series?: string;
  readonly cost?: number;
}

function getSpBp2006EligibleWaitingRoomDelegationRows() {
  const cards = JSON.parse(
    readFileSync(new URL('../../llocg_db/json/cards.json', import.meta.url), 'utf8')
  ) as Record<string, LlocgCardRecord>;
  const rows = new Map<
    string,
    {
      readonly baseCardCode: string;
      readonly abilityIds: Set<string>;
      readonly decisions: Set<'ALLOW' | 'DENY'>;
      readonly missingAbilityIds: Set<string>;
    }
  >();

  for (const [fallbackCardCode, card] of Object.entries(cards)) {
    const cardCode = normalizeCardCode(card.card_no ?? fallbackCardCode);
    if (
      !cardCode.startsWith('PL!SP-') ||
      card.type !== 'メンバー' ||
      card.series !== 'ラブライブ！スーパースター!!' ||
      typeof card.cost !== 'number' ||
      card.cost > 4
    ) {
      continue;
    }
    const targetDefinitions = getCardAbilityDefinitionsForCardCode(cardCode).filter(
      (definition) =>
        definition.implemented &&
        definition.queued &&
        definition.category === CardAbilityCategory.ON_ENTER &&
        definition.sourceZone === CardAbilitySourceZone.PLAYED_MEMBER &&
        definition.triggerCondition === TriggerCondition.ON_ENTER_STAGE
    );
    if (targetDefinitions.length === 0) {
      continue;
    }

    const baseCardCode = getBaseCardCode(cardCode);
    const row = rows.get(baseCardCode) ?? {
      baseCardCode,
      abilityIds: new Set<string>(),
      decisions: new Set<'ALLOW' | 'DENY'>(),
      missingAbilityIds: new Set<string>(),
    };
    for (const definition of targetDefinitions) {
      row.abilityIds.add(definition.abilityId);
      const policy = definition.delegatedOnEnterFromWaitingRoomPolicy;
      if (policy) {
        row.decisions.add(policy.decision);
      } else {
        row.missingAbilityIds.add(definition.abilityId);
      }
    }
    rows.set(baseCardCode, row);
  }

  return [...rows.values()].sort((left, right) =>
    left.baseCardCode.localeCompare(right.baseCardCode)
  );
}

describe('waiting-room ON_ENTER delegatability', () => {
  it('explicitly exposes all four N-pb1 named-member look-top definitions', () => {
    const cases = [
      ['PL!N-pb1-016-P+', 'PL!N-pb1-016:on-enter-look-top-two-karin-member'],
      ['PL!N-pb1-018-R', 'PL!N-pb1-018:on-enter-look-top-two-kanata-member'],
      ['PL!N-pb1-021-P+', 'PL!N-pb1-021:on-enter-look-top-two-rina-member'],
      ['PL!N-pb1-024-R', 'PL!N-pb1-024:on-enter-look-top-two-lanzhu-member'],
    ] as const;

    for (const [cardCode, abilityId] of cases) {
      expect(getWaitingRoomDelegatableOnEnterDefinitions(cardCode).map((d) => d.abilityId)).toEqual(
        [abilityId]
      );
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
    expect(
      getWaitingRoomDelegatableOnEnterDefinitions('PL!N-bp3-012-R').map((d) => d.abilityId)
    ).toEqual(['PL!N-bp3-012:on-enter-discard-look-top-nijigasaki-card']);
    expect(getWaitingRoomDelegatableOnEnterDefinitions('PL!SP-bp4-001-R')).toHaveLength(1);
    expect(getWaitingRoomDelegatableOnEnterDefinitions('PL!SP-bp4-002-R')).toEqual([]);
    expect(
      getCardAbilityDefinitionsForCardCode('PL!SP-bp4-002-R')[0]
        ?.delegatedOnEnterFromWaitingRoomPolicy
    ).toEqual({ decision: 'DENY', reason: 'SOURCE_MEMBER_COST_UNPAYABLE' });
    const slotDefinition = getWaitingRoomDelegatableOnEnterDefinitions('PL!SP-bp5-015-N');
    expect(getCardAbilityDefinitionsForCardCode('PL!SP-bp5-015-N')[0]?.requiredSourceSlots).toEqual(
      ['CENTER']
    );
    expect(slotDefinition).toEqual([]);
    expect(
      getCardAbilityDefinitionsForCardCode('PL!SP-bp5-015-N')[0]
        ?.delegatedOnEnterFromWaitingRoomPolicy
    ).toEqual({ decision: 'DENY', reason: 'SOURCE_SLOT_REQUIRED' });
    expect(getWaitingRoomDelegatableOnEnterDefinitions('PL!N-bp5-009-R')).toEqual([]);
  });

  it('governs every implemented cost-four-or-less Liella! ON_ENTER definition used by SP-BP2-006', () => {
    const rows = getSpBp2006EligibleWaitingRoomDelegationRows();
    const missing = rows.flatMap((row) =>
      [...row.missingAbilityIds].map((abilityId) => `${row.baseCardCode}: ${abilityId}`)
    );
    const conflicting = rows
      .filter((row) => row.decisions.size !== 1)
      .map((row) => `${row.baseCardCode}: ${[...row.decisions].join(',') || 'NO_DECISION'}`);

    expect(missing).toEqual([]);
    expect(conflicting).toEqual([]);
    expect(new Set(rows.flatMap((row) => [...row.abilityIds])).size).toBe(18);
    expect(rows).toHaveLength(33);
    expect(rows.filter((row) => row.decisions.has('ALLOW'))).toHaveLength(26);
    expect(rows.filter((row) => row.decisions.has('DENY')).map((row) => row.baseCardCode)).toEqual([
      'PL!SP-bp4-002',
      'PL!SP-bp4-013',
      'PL!SP-bp5-008',
      'PL!SP-bp5-015',
      'PL!SP-pb2-025',
      'PL!SP-sd2-007',
      'PL!SP-sd2-016',
    ]);

    const exactCardCodeRow = rows.find((row) => row.baseCardCode === 'PL!SP-bp5-013');
    expect([...exactCardCodeRow!.abilityIds]).toEqual([
      SP_BP5_013_ON_ENTER_DISCARD_LOOK_TOP_SUNNYPASSION_OR_BLADE_HEART_LIELLA_ABILITY_ID,
    ]);
    expect(exactCardCodeRow?.decisions).toEqual(new Set(['ALLOW']));
    expect(
      getCardAbilityDefinitionsForCardCode('PL!SP-bp5-013-N').find(
        (definition) =>
          definition.abilityId ===
          SP_BP5_013_ON_ENTER_DISCARD_LOOK_TOP_SUNNYPASSION_OR_BLADE_HEART_LIELLA_ABILITY_ID
      )?.baseCardCodes
    ).toEqual(['PL!SP-bp5-013']);
    expect(
      getCardAbilityDefinitionsForCardCode('PL!SP-bp2-005-R').find(
        (definition) =>
          definition.abilityId ===
          SP_BP2_005_ON_ENTER_PAY_TWO_ENERGY_LOOK_TOP_SEVEN_LIELLA_CARD_ABILITY_ID
      )?.baseCardCodes
    ).toEqual(['PL!SP-bp2-005']);
  });
});
