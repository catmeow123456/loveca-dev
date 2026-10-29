import { describe, expect, it } from 'vitest';
import '../../src/application/card-effect-runner';
import { findCardAbilityDefinitionById } from '../../src/application/card-effects/definitions/lookup';
import { getCopyableOnEnterDefinitions } from '../../src/application/card-effects/runtime/temporary-on-enter-ability-grants';
import { hasPendingAbilityStarterHandler } from '../../src/application/card-effects/runtime/starter-registry';
import {
  COPY_SOURCE_ABILITY_IDS,
  COPY_SOURCE_MEMBERS,
} from '../helpers/hs-bp8-004-copy-source-manifest';
import { SHARED_COPY_SOURCE_CASES } from '../helpers/copied-on-enter-shared-workflow-cases';
import { SINGLE_COPY_SOURCE_CASES } from '../helpers/hs-bp8-004-single-copy-cases';
import { sourceCardFixture } from '../helpers/card-effect-zone-fixture';
import { cardBelongsToGroup } from '../../src/shared/utils/card-identity';
import { CardType } from '../../src/shared/types/enums';

describe('PL!HS-bp8-004 费用17「百生吟子」完整复制源覆盖门禁', () => {
  it('freezes 66 qualifying bases and 55 unique ON_ENTER IDs including the October 29 additions', () => {
    expect(COPY_SOURCE_MEMBERS).toHaveLength(66);
    expect(
      new Set(COPY_SOURCE_MEMBERS.map((row) => row.cardCode.replace(/-[^-]+$/, ''))).size
    ).toBe(66);
    const fixtureIds = [
      ...new Set(COPY_SOURCE_MEMBERS.flatMap((row) => row.copyAbilityIds)),
    ].sort();
    expect(fixtureIds).toEqual([...COPY_SOURCE_ABILITY_IDS]);
    expect(fixtureIds).toHaveLength(55);
  });
  it.each(COPY_SOURCE_MEMBERS)(
    'has real qualifying source data and every declared ON_ENTER definition for $cardCode',
    (row) => {
      const card = sourceCardFixture(row.cardCode)!;
      expect(card.cardType).toBe(CardType.MEMBER);
      expect(cardBelongsToGroup(card, '蓮ノ空')).toBe(true);
      expect('cost' in card && card.cost <= 13).toBe(true);
      expect(
        getCopyableOnEnterDefinitions(row.cardCode)
          .map((definition) => definition.abilityId)
          .sort()
      ).toEqual([...row.copyAbilityIds].sort());
    }
  );
  it('assigns every unique source ID to exactly one native-versus-host behavior matrix', () => {
    const cases = [...SHARED_COPY_SOURCE_CASES, ...SINGLE_COPY_SOURCE_CASES];
    const ids = cases.map((item) => item.abilityId);
    expect(ids).toHaveLength(55);
    expect(new Set(ids).size).toBe(55);
    expect([...ids].sort()).toEqual([...COPY_SOURCE_ABILITY_IDS]);
    for (const entry of cases) {
      expect(
        COPY_SOURCE_MEMBERS.some(
          (row) =>
            row.cardCode === entry.representativeCardCode &&
            row.copyAbilityIds.includes(entry.abilityId)
        )
      ).toBe(true);
      expect(entry.workflowPath).toMatch(
        /^src\/application\/card-effects\/workflows\/(shared|cards)\/.+\.ts$/
      );
      expect(findCardAbilityDefinitionById(entry.abilityId)?.implemented).toBe(true);
      expect(hasPendingAbilityStarterHandler(entry.abilityId)).toBe(true);
    }
  });
});
