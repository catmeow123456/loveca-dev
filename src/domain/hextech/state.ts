import {
  getHextechDefinition,
  HEXTECH_RULES_VERSION,
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
  readonly rulesVersion: typeof HEXTECH_RULES_VERSION;
  readonly owned: readonly OwnedHextech[];
  /** Local test setup, consumed after both mulligans and before the first normal turn. */
  readonly initialGrants?: InitialHextechSetup;
  /** Selection progress cannot be inferred from owned instances (future effects can replace them). */
  readonly draft?: {
    readonly completedRounds: number;
    readonly pending?: HextechSelection;
  };
}

export type InitialHextechSetup = readonly [readonly HextechId[], readonly HextechId[]];

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
    state.rulesVersion !== HEXTECH_RULES_VERSION ||
    !Array.isArray(state.owned)
  )
    fail();
  const ids = new Set<string>();
  for (const entry of state.owned as unknown[]) {
    if (!entry || typeof entry !== 'object') fail();
    const owned = entry as Record<string, unknown>;
    if (
      typeof owned.instanceId !== 'string' ||
      !owned.instanceId ||
      ids.has(owned.instanceId) ||
      typeof owned.definitionId !== 'string' ||
      !getHextechDefinition(owned.definitionId) ||
      typeof owned.playerId !== 'string' ||
      !playerIds.includes(owned.playerId) ||
      typeof owned.acquiredTurn !== 'number' ||
      !Number.isInteger(owned.acquiredTurn) ||
      owned.acquiredTurn < 1 ||
      owned.acquiredTurn > turnCount
    )
      fail();
    ids.add(owned.instanceId as string);
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
          list.some((id: unknown) => typeof id !== 'string' || !getHextechDefinition(id))
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
      for (const offer of pending.offers) {
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
        for (const candidate of offer.candidates) {
          if (
            !candidate ||
            typeof candidate.rerolled !== 'boolean' ||
            getHextechDefinition(candidate.definitionId)?.rarity !== pending.rarity
          )
            fail();
        }
      }
      if (pending.offers.every((offer) => offer.selectedIndex !== undefined)) fail();
    }
  }
}
