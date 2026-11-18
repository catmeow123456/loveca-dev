import {
  getHextechDefinition,
  HEXTECH_RULES_VERSION,
  DARK_HEXTECH_RULES_VERSION,
  hextechPoolForVersion,
  isHextechInPool,
  type HextechRulesVersion,
  type HextechId,
  type HextechRarity,
} from './catalog.js';

export const HEXTECH_SELECTION_TURNS = [1, 3, 5] as const;
export interface HextechOffer {
  readonly candidates: readonly { readonly definitionId: HextechId; readonly rerolled: boolean }[];
  readonly selectedIndex?: number;
}
export interface HextechSelection {
  readonly turn: number;
  readonly rarity: HextechRarity;
  readonly offers: readonly [HextechOffer, HextechOffer];
}

export interface OwnedHextech {
  readonly instanceId: string;
  readonly definitionId: HextechId;
  readonly playerId: string;
  readonly acquiredTurn: number;
}

export interface HextechState {
  readonly rulesVersion: HextechRulesVersion;
  /** Match-scoped uses survive snapshots and cross-timing activations. */
  readonly uses?: readonly { readonly instanceId: string; readonly turn: number }[];
  readonly silencedMembers?: readonly {
    readonly memberCardId: string;
    readonly playerId: string;
    readonly lifecycleId: string;
    readonly turn: number;
    readonly sourceInstanceId: string;
  }[];
  readonly columnLocks?: readonly {
    readonly memberCardId: string;
    readonly playerId: string;
    readonly lifecycleId: string;
    readonly sourceInstanceId: string;
  }[];
  /** Frozen before reveal cleanup; null is a deliberate empty/non-LIVE first slot. */
  readonly liveSlots?: readonly {
    readonly playerId: string;
    readonly turn: number;
    readonly cardIds: readonly string[];
  }[];
  readonly pendingAcquisition?: {
    readonly sourceInstanceId: string;
    readonly kind: 'REWRITE_SCRIPT' | 'COLUMN_LOCK' | 'POSITION_MISHAP';
  };
  readonly owned: readonly OwnedHextech[];
  /** Acquisition choices retain only their source and outstanding quantity; candidates are derived. */
  readonly pendingSearch?: { readonly sourceInstanceId: string; readonly count: number };
  readonly acquisitionQueue?: readonly string[];
  /** Local test setup, consumed after both mulligans and before the first normal turn. */
  readonly initialGrants?: InitialHextechSetup;
  /** Selection progress cannot be inferred from owned instances (future effects can replace them). */
  readonly draft?: {
    readonly completedRounds: number;
    readonly pending?: HextechSelection;
  };
}

export type InitialHextechSetup = readonly [readonly HextechId[], readonly HextechId[]];

export function hasPendingHextechInput(game: { readonly hextech?: HextechState }): boolean {
  return !!(
    game.hextech?.draft?.pending ||
    game.hextech?.pendingSearch ||
    game.hextech?.pendingAcquisition ||
    game.hextech?.acquisitionQueue?.length
  );
}

/** Absence means disabled in the current format; no legacy shape is accepted or rewritten. */
export function assertValidHextechState(
  value: unknown,
  playerIds: readonly string[],
  rulesetId: string,
  turnCount: number
): asserts value is HextechState | undefined {
  if (value === undefined) return;
  const fail = (): never => {
    throw new Error('海克斯权威状态无效或规则版本不受支持');
  };
  if (!value || typeof value !== 'object') fail();
  const state = value as Record<string, unknown>;
  if (
    rulesetId !== 'STANDARD' ||
    ![HEXTECH_RULES_VERSION, DARK_HEXTECH_RULES_VERSION].includes(
      state.rulesVersion as typeof HEXTECH_RULES_VERSION
    ) ||
    !Array.isArray(state.owned)
  )
    fail();
  const pool = hextechPoolForVersion(state.rulesVersion as HextechRulesVersion);
  const definitionOwners = new Set<string>();
  const ids = new Set<string>();
  for (const entry of state.owned as unknown[]) {
    if (!entry || typeof entry !== 'object') fail();
    const owned = entry as Record<string, unknown>;
    if (
      typeof owned.instanceId !== 'string' ||
      !owned.instanceId ||
      ids.has(owned.instanceId) ||
      typeof owned.definitionId !== 'string' ||
      !isHextechInPool(owned.definitionId, pool) ||
      typeof owned.playerId !== 'string' ||
      !playerIds.includes(owned.playerId) ||
      typeof owned.acquiredTurn !== 'number' ||
      !Number.isInteger(owned.acquiredTurn) ||
      owned.acquiredTurn < 1 ||
      owned.acquiredTurn > turnCount
    )
      fail();
    const ownerKey = `${owned.playerId}:${owned.definitionId}`;
    if (pool === 'DARK' && definitionOwners.has(ownerKey)) fail();
    definitionOwners.add(ownerKey);
    ids.add(owned.instanceId as string);
  }
  if (
    state.acquisitionQueue !== undefined &&
    (!Array.isArray(state.acquisitionQueue) ||
      state.acquisitionQueue.length === 0 ||
      new Set(state.acquisitionQueue).size !== state.acquisitionQueue.length ||
      state.acquisitionQueue.some((id: unknown) => typeof id !== 'string' || !ids.has(id)))
  )
    fail();
  if (state.uses !== undefined) {
    if (!Array.isArray(state.uses)) fail();
    const useKeys = new Set<string>();
    for (const use of state.uses as NonNullable<HextechState['uses']>) {
      const owned = (state.owned as OwnedHextech[]).find(
        (entry) => entry.instanceId === use?.instanceId
      );
      const activation = owned ? getHextechDefinition(owned.definitionId)?.activation : undefined;
      if (
        !owned ||
        !activation ||
        !Number.isInteger(use.turn) ||
        use.turn < owned.acquiredTurn ||
        use.turn > turnCount
      )
        fail();
      const key = `${use.instanceId}:${activation!.limit === 'MATCH' ? 'match' : use.turn}`;
      if (useKeys.has(key)) fail();
      useKeys.add(key);
    }
  }
  if (state.pendingAcquisition !== undefined) {
    const pending = state.pendingAcquisition as HextechState['pendingAcquisition'];
    const owned = (state.owned as OwnedHextech[]).find(
      (entry) => entry.instanceId === pending?.sourceInstanceId
    );
    if (
      !pending ||
      !ids.has(pending.sourceInstanceId) ||
      !['REWRITE_SCRIPT', 'COLUMN_LOCK', 'POSITION_MISHAP'].includes(pending.kind) ||
      state.pendingSearch ||
      (state.acquisitionQueue as string[] | undefined)?.includes(pending.sourceInstanceId) ||
      owned?.definitionId !==
        {
          REWRITE_SCRIPT: 'dark-rewrite-script',
          COLUMN_LOCK: 'dark-silent-column',
          POSITION_MISHAP: 'dark-position-mishap',
        }[pending.kind]
    )
      fail();
  }
  if (
    pool !== 'DARK' &&
    [state.uses, state.pendingAcquisition, state.silencedMembers, state.columnLocks].some(
      (field) => field !== undefined
    )
  )
    fail();
  for (const field of ['silencedMembers', 'columnLocks'] as const) {
    const entries = state[field];
    if (entries === undefined) continue;
    if (!Array.isArray(entries)) fail();
    for (const value of entries as readonly unknown[]) {
      if (!value || typeof value !== 'object') fail();
      const entry = value as Record<string, unknown>;
      if (
        !(state.owned as OwnedHextech[]).some(
          (owned) =>
            owned.instanceId === entry.sourceInstanceId &&
            owned.definitionId ===
              (field === 'columnLocks' ? 'dark-silent-column' : 'dark-silent-spotlight') &&
            (field !== 'columnLocks' || owned.playerId === entry.playerId)
        ) ||
        typeof entry.playerId !== 'string' ||
        !playerIds.includes(entry.playerId) ||
        typeof entry.memberCardId !== 'string' ||
        !entry.memberCardId ||
        typeof entry.lifecycleId !== 'string' ||
        !entry.lifecycleId ||
        (field === 'silencedMembers' &&
          (typeof entry.turn !== 'number' ||
            !Number.isInteger(entry.turn) ||
            entry.turn < 1 ||
            entry.turn > turnCount))
      )
        fail();
    }
  }
  if (state.liveSlots !== undefined) {
    if (!Array.isArray(state.liveSlots)) fail();
    const seats = new Set<string>();
    for (const value of state.liveSlots as readonly unknown[]) {
      if (!value || typeof value !== 'object') fail();
      const entry = value as Record<string, unknown>;
      if (
        typeof entry.playerId !== 'string' ||
        !playerIds.includes(entry.playerId) ||
        seats.has(entry.playerId) ||
        entry.turn !== turnCount ||
        !Array.isArray(entry.cardIds) ||
        entry.cardIds.some((id: unknown) => typeof id !== 'string') ||
        new Set(entry.cardIds).size !== entry.cardIds.length
      )
        fail();
      seats.add(entry.playerId as string);
    }
  }
  if (state.pendingSearch !== undefined) {
    const search = state.pendingSearch as HextechState['pendingSearch'];
    const owned = (state.owned as OwnedHextech[]).find(
      (item) => item.instanceId === search?.sourceInstanceId
    );
    if (
      !search ||
      !owned ||
      (state.acquisitionQueue as string[] | undefined)?.includes(search.sourceInstanceId) ||
      getHextechDefinition(owned.definitionId)?.effect.kind !== 'ACQUIRE_MEMBERS_FOR_LIVES' ||
      !Number.isInteger(search.count) ||
      search.count < 1
    )
      fail();
  }
  if (state.initialGrants !== undefined) {
    const grants = state.initialGrants;
    if (
      ids.size > 0 ||
      turnCount > 1 ||
      !Array.isArray(grants) ||
      grants.length !== 2 ||
      grants.some(
        (list: unknown) =>
          !Array.isArray(list) ||
          new Set(list).size !== list.length ||
          list.some((id: unknown) => typeof id !== 'string' || !isHextechInPool(id, pool))
      )
    )
      fail();
  }
  if (state.draft !== undefined) {
    if (state.initialGrants !== undefined || !state.draft || typeof state.draft !== 'object')
      fail();
    const draft = state.draft as HextechState['draft'] & {};
    if (
      !Number.isInteger(draft.completedRounds) ||
      draft.completedRounds < 0 ||
      draft.completedRounds > 3
    )
      fail();
    if (draft.completedRounds > 0 && turnCount < HEXTECH_SELECTION_TURNS[draft.completedRounds - 1])
      fail();
    const pending = draft.pending;
    if (pending !== undefined) {
      if (
        !pending ||
        pending.turn !== turnCount ||
        pending.turn !== HEXTECH_SELECTION_TURNS[draft.completedRounds]
      )
        fail();
      if (
        !['SILVER', 'GOLD', 'PRISMATIC'].includes(pending.rarity) ||
        !Array.isArray(pending.offers) ||
        pending.offers.length !== 2
      )
        fail();
      for (const [playerIndex, offer] of pending.offers.entries()) {
        if (
          !offer ||
          !Array.isArray(offer.candidates) ||
          offer.candidates.length !== 3 ||
          (offer.selectedIndex !== undefined &&
            (!Number.isInteger(offer.selectedIndex) ||
              offer.selectedIndex < 0 ||
              offer.selectedIndex > 2))
        )
          fail();
        if (
          pool === 'DARK' &&
          (new Set(offer.candidates.map((entry) => entry.definitionId)).size !== 3 ||
            offer.candidates.some((entry) =>
              definitionOwners.has(`${playerIds[playerIndex]}:${entry.definitionId}`)
            ))
        )
          fail();
        for (const candidate of offer.candidates) {
          if (
            !candidate ||
            typeof candidate.rerolled !== 'boolean' ||
            getHextechDefinition(candidate.definitionId)?.rarity !== pending.rarity ||
            !isHextechInPool(candidate.definitionId, pool)
          )
            fail();
        }
      }
      if (pending.offers.every((offer) => offer.selectedIndex !== undefined)) fail();
    }
  }
}
