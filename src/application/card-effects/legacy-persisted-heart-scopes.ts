import * as abilityIds from './ability-ids.js';

export type LegacyPersistedHeartScope = 'SOURCE_MEMBER' | 'TARGET_MEMBER';

export type LegacyPersistedHeartHistoricalEncoding =
  'TARGETLESS_SOURCE_CARD_ID_IS_SOURCE' | 'EXPLICIT_SOURCE_MEMBER_IS_SELF_TARGET';

export type LegacyPersistedHeartScopeEntry = readonly [
  abilityId: string,
  scope: LegacyPersistedHeartScope,
  historicalEncoding: LegacyPersistedHeartHistoricalEncoding,
];

export interface LegacyPersistedHeartAudit {
  readonly scope: LegacyPersistedHeartScope;
  readonly historicalEncoding: LegacyPersistedHeartHistoricalEncoding;
}

/**
 * Frozen compatibility table for the only six persisted HEART shapes whose
 * historical meaning can be recovered without guessing from card type, ID
 * equality, or a missing field.
 */
const LEGACY_PERSISTED_HEART_SCOPE_ENTRIES = [
  [
    abilityIds.KOTORI_LIVE_START_HEART_ABILITY_ID,
    'SOURCE_MEMBER',
    'TARGETLESS_SOURCE_CARD_ID_IS_SOURCE',
  ],
  [
    abilityIds.HS_BP1_006_LIVE_START_DISCARD_GAIN_HEART_ABILITY_ID,
    'SOURCE_MEMBER',
    'TARGETLESS_SOURCE_CARD_ID_IS_SOURCE',
  ],
  [
    abilityIds.HS_PR_019_ON_ENTER_MILL_GAIN_GREEN_HEART_ABILITY_ID,
    'SOURCE_MEMBER',
    'TARGETLESS_SOURCE_CARD_ID_IS_SOURCE',
  ],
  [
    abilityIds.HS_BP2_007_LIVE_START_DISCARD_MEMBER_TARGET_SAME_NAME_GREEN_HEART_BLADE_ABILITY_ID,
    'TARGET_MEMBER',
    'EXPLICIT_SOURCE_MEMBER_IS_SELF_TARGET',
  ],
  [
    abilityIds.HS_BP5_003_LIVE_START_DISCARD_SAME_GROUP_MEMBER_HEART_ABILITY_ID,
    'TARGET_MEMBER',
    'EXPLICIT_SOURCE_MEMBER_IS_SELF_TARGET',
  ],
  [
    abilityIds.HS_BP6_003_LIVE_START_DISCARD_GAIN_MIRACRA_HEART_ABILITY_ID,
    'TARGET_MEMBER',
    'EXPLICIT_SOURCE_MEMBER_IS_SELF_TARGET',
  ],
] as const satisfies readonly LegacyPersistedHeartScopeEntry[];

const LEGACY_PERSISTED_HEART_AUDIT_BY_ABILITY_ID = new Map<string, LegacyPersistedHeartAudit>(
  LEGACY_PERSISTED_HEART_SCOPE_ENTRIES.map(([abilityId, scope, historicalEncoding]) => [
    abilityId,
    { scope, historicalEncoding },
  ])
);

if (
  LEGACY_PERSISTED_HEART_AUDIT_BY_ABILITY_ID.size !== LEGACY_PERSISTED_HEART_SCOPE_ENTRIES.length
) {
  throw new Error('legacy persisted HEART scope table contains duplicate abilityIds');
}

for (const [, scope, historicalEncoding] of LEGACY_PERSISTED_HEART_SCOPE_ENTRIES) {
  if (
    (scope === 'SOURCE_MEMBER' && historicalEncoding !== 'TARGETLESS_SOURCE_CARD_ID_IS_SOURCE') ||
    (scope === 'TARGET_MEMBER' && historicalEncoding !== 'EXPLICIT_SOURCE_MEMBER_IS_SELF_TARGET')
  ) {
    throw new Error('legacy persisted HEART encoding does not match scope');
  }
}

export function getLegacyPersistedHeartAudit(
  abilityId: string
): LegacyPersistedHeartAudit | undefined {
  return LEGACY_PERSISTED_HEART_AUDIT_BY_ABILITY_ID.get(abilityId);
}

export function getLegacyPersistedHeartScopeEntries(): readonly LegacyPersistedHeartScopeEntry[] {
  return LEGACY_PERSISTED_HEART_SCOPE_ENTRIES;
}
