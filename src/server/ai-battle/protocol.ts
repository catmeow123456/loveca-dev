import type { GameCommand } from '../../application/game-commands.js';
import type { GameState } from '../../domain/entities/game.js';
import type { PlayerViewState, PublicEvent } from '../../online/types.js';
import type { AiSelfResources, AiStageEntryBudget, AiLiveBaseBudget } from './visible-resources.js';
import type { EffectCostDefinition } from '../../application/effects/effect-costs.js';
import type { AiDecisionContextInput } from './decision-context.js';

export interface AiMemberEntryResources {
  readonly abilityId: string;
  readonly conditionMet: boolean;
  readonly conditionObjectIds: readonly string[];
  readonly activateEnergyUpTo: number;
  readonly recoverLiveObjectIds: readonly string[];
}

export type AiSelection =
  | { readonly kind: 'ACTION'; readonly actionRef: string }
  | { readonly kind: 'CARDS'; readonly cardRefs: readonly string[] };

export interface AiCandidate {
  readonly ref: string;
  readonly description: string;
  readonly objectId?: string;
  /** Preselected visible target; executed only if the immediate post-activation window still matches. */
  readonly followUpTargetObjectId?: string;
  readonly targetSlot?: string;
  readonly energyCost?: number;
  readonly replacedObjectIds?: readonly string[];
  readonly effectText?: string;
  readonly liveBaseBudget?: AiLiveBaseBudget;
  readonly entryResources?: readonly AiMemberEntryResources[];
  readonly activation?: {
    readonly costs: readonly EffectCostDefinition[];
    readonly destination: 'HAND' | 'SOURCE_MEMBER_SLOT';
    readonly sourceSlot?: string;
    /** Visible targets after the stated source cost; all later choices revalidate normally. */
    readonly targets: readonly {
      readonly objectId: string;
      readonly stageAfterEntry?: AiStageEntryBudget;
      readonly entryResources?: readonly AiMemberEntryResources[];
    }[];
  };
  /** A selected phase-completion action waits until this server deadline. Other actions remain usable. */
  readonly availableAt?: number;
}

export type AiDecisionSpace =
  | { readonly kind: 'ACTION'; readonly candidates: readonly AiCandidate[] }
  | {
      readonly kind: 'CARDS';
      readonly candidates: readonly AiCandidate[];
      readonly min: number;
      readonly max: number;
      readonly ordered: boolean;
      readonly canSkip?: boolean;
      readonly skipDescription?: string;
      /** Overlapping membership counts toward every matching group's limits. */
      readonly groups?: readonly {
        readonly cardRefs: readonly string[];
        readonly min: number;
        readonly max: number;
      }[];
    };

export interface AiDecisionInput {
  /** Current seat's authoritative setting allowance; queried only in its LIVE_SET window. */
  readonly liveSet?: {
    readonly selectionMode: 'FINAL_SET_AND_CONFIRM';
    readonly setCardObjectIds: readonly string[];
    readonly setCount: number;
    readonly setLimit: number;
    readonly drawCountRule: 'FINAL_SET_COUNT';
  };
  readonly context?: AiDecisionContextInput;
  readonly history?: {
    readonly selection: 'LAST_12_PUBLIC_EVENTS';
    readonly throughPublicSeq: number;
    readonly omittedEventCount: number;
    readonly events: readonly PublicEvent[];
  };
  readonly state: Pick<PlayerViewState, 'table' | 'objects'> & {
    readonly turn: number;
    readonly phase: string;
    readonly subPhase: string;
    readonly selfSeat: string;
    readonly selfResources: AiSelfResources;
    readonly firstSeat: string;
    readonly activeSeat: string | null;
    readonly liveResult?: PlayerViewState['match']['liveResult'];
  };
  readonly purpose:
    | 'MULLIGAN'
    | 'MAIN'
    | 'LIVE_SET'
    | 'PUBLIC_DISPLAY'
    | 'PENDING_ORDER'
    | 'EFFECT'
    | 'EFFECT_CONFIRM'
    | 'RULE_CONFIRM'
    | 'SUCCESS_LIVE';
  readonly effect?: {
    readonly effectText: string;
    readonly stepText: string;
    readonly selectionLabel?: string;
    readonly sourceObjectId?: string;
    readonly sourceCardDisplayCode?: string;
  };
  readonly space: AiDecisionSpace;
  readonly responseSchema: Readonly<Record<string, unknown>>;
}

export interface AiDecision {
  /** The only material from this object that may be sent to a model. */
  readonly input: AiDecisionInput;
  /** Server-only mapping, valid solely for the version sampled by the caller. */
  readonly toCommand: (selection: AiSelection, timestamp: number) => GameCommand;
  /** Multi-command plans stay inside the same authority queue and represent one model decision. */
  readonly toCommands?: (selection: AiSelection, timestamp: number) => readonly GameCommand[];
  /** Server-only, single-use plans. Never serialized or carried to a later decision window. */
  readonly activationFollowUps?: ReadonlyMap<string, AiActivationFollowUp>;
}

export interface AiActivationFollowUp {
  readonly resolve: (
    game: GameState,
    view: PlayerViewState,
    timestamp: number
  ) =>
    | { readonly kind: 'READY'; readonly command: GameCommand; readonly selection: AiSelection }
    | { readonly kind: 'REQUERY'; readonly reason: string };
}

export function materializeAiDecisionCommands(
  decision: AiDecision,
  selection: AiSelection,
  timestamp: number
): readonly GameCommand[] {
  const commands = decision.toCommands?.(selection, timestamp) ?? [
    decision.toCommand(selection, timestamp),
  ];
  if (commands.length === 0) throw new Error('AI decision produced no commands');
  return commands;
}

export type AiDecisionQuery =
  | { readonly kind: 'DECISION'; readonly decision: AiDecision }
  | { readonly kind: 'WAITING_FOR_PLAYER' }
  | {
      readonly kind: 'WAITING_FOR_TIME';
      readonly deadlineAt: number;
      readonly reason: 'PUBLIC_DISPLAY';
    }
  | { readonly kind: 'ENDED' }
  | { readonly kind: 'UNSUPPORTED'; readonly reason: string };

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function validateSelection(
  space: AiDecisionSpace,
  selection: unknown
): asserts selection is AiSelection {
  if (!record(selection) || selection.kind !== space.kind)
    throw new Error('Invalid selection kind');
  const refs = new Set(space.candidates.map((candidate) => candidate.ref));
  if (space.kind === 'ACTION') {
    if (
      Object.keys(selection).length !== 2 ||
      typeof selection.actionRef !== 'string' ||
      !refs.has(selection.actionRef)
    )
      throw new Error('Unknown action reference');
  } else {
    const selected = selection.cardRefs;
    if (
      Object.keys(selection).length !== 2 ||
      !Array.isArray(selected) ||
      (selected.length < space.min && !(space.canSkip && selected.length === 0)) ||
      selected.length > space.max ||
      new Set(selected).size !== selected.length ||
      selected.some((ref: unknown) => typeof ref !== 'string' || !refs.has(ref))
    )
      throw new Error('Invalid card selection');
    if (
      !(space.canSkip && selected.length === 0) &&
      space.groups?.some((group) => {
        const count = selected.filter(
          (ref: unknown) => typeof ref === 'string' && group.cardRefs.includes(ref)
        ).length;
        return count < group.min || count > group.max;
      })
    )
      throw new Error('Invalid grouped card selection');
  }
}

/**
 * Worst-case visited-node cap for the subset search. Legal windows are tiny in practice;
 * overlapping group minimums can make feasibility undecidable by cheap prechecks, and the
 * enumeration is exponential. The bound converts a pathological window into a bounded failure.
 */
const AI_CARD_SELECTION_SEARCH_NODE_BUDGET = 200_000;

/** Find a complete legal subset from visible constraints; never execute a candidate. */
export function findAiCardSelection(
  space: Extract<AiDecisionSpace, { kind: 'CARDS' }>
): AiSelection {
  if (space.canSkip) return { kind: 'CARDS', cardRefs: [] };
  const refs = space.candidates.map((candidate) => candidate.ref);
  const groups = space.groups ?? [];
  // Per-group satisfiability precheck: a group whose available membership (capped by the
  // overall selection limit) cannot reach its minimum has no legal completion at all.
  for (const group of groups) {
    const available = group.cardRefs.filter((ref) => refs.includes(ref)).length;
    if (Math.min(group.max, available, space.max) < group.min)
      throw new Error('No complete legal card selection');
  }
  let visitedNodes = 0;
  const search = (selected: string[], start: number): string[] | null => {
    if (++visitedNodes > AI_CARD_SELECTION_SEARCH_NODE_BUDGET)
      throw new Error('Card selection search exceeded the node budget');
    if (
      groups.some(
        (group) => selected.filter((ref) => group.cardRefs.includes(ref)).length > group.max
      )
    )
      return null;
    if (
      selected.length >= space.min &&
      groups.every(
        (group) => selected.filter((ref) => group.cardRefs.includes(ref)).length >= group.min
      )
    )
      return selected;
    if (selected.length >= space.max || selected.length + refs.length - start < space.min)
      return null;
    for (let i = start; i < refs.length; i++) {
      const result = search([...selected, refs[i]!], i + 1);
      if (result) return result;
    }
    return null;
  };
  const selected = search([], 0);
  if (!selected) throw new Error('No complete legal card selection');
  return { kind: 'CARDS', cardRefs: selected };
}

export function parseAiBattleResponse(
  decision: Pick<AiDecision, 'input'>,
  text: string
): { selection: AiSelection; tradeoff?: string } {
  const parsed: unknown = JSON.parse(text);
  if (
    !record(parsed) ||
    Object.keys(parsed).some((key) => key !== 'selection' && key !== 'tradeoff') ||
    (parsed.tradeoff !== undefined &&
      (typeof parsed.tradeoff !== 'string' || parsed.tradeoff.length > 300))
  )
    throw new Error('Invalid response structure');
  validateSelection(decision.input.space, parsed.selection);
  return {
    selection: parsed.selection,
    ...(typeof parsed.tradeoff === 'string' ? { tradeoff: parsed.tradeoff } : {}),
  };
}

/**
 * Lenient recovery of a CARDS answer from a response that failed strict parsing. Used only by
 * the deterministic fallback repair: strict validation still decides acceptance, so an envelope
 * violation can never become a MODEL selection through this path. Truncated or unparsable text
 * is treated as untrusted and yields null.
 */
export function extractInvalidCardSelection(text: string): AiSelection | null {
  try {
    const parsed: unknown = JSON.parse(text);
    if (!record(parsed) || !record(parsed.selection) || parsed.selection.kind !== 'CARDS')
      return null;
    const cardRefs = parsed.selection.cardRefs;
    if (!Array.isArray(cardRefs)) return null;
    const refs = cardRefs.filter((ref): ref is string => typeof ref === 'string');
    return refs.length > 0 ? { kind: 'CARDS', cardRefs: refs } : null;
  } catch {
    return null;
  }
}

export function responseSchema(space: AiDecisionSpace): Readonly<Record<string, unknown>> {
  const refs = space.candidates.map((candidate) => candidate.ref);
  return {
    type: 'object',
    additionalProperties: false,
    required: ['selection'],
    properties: {
      tradeoff: { type: 'string', maxLength: 300 },
      selection: {
        type: 'object',
        additionalProperties: false,
        required: ['kind', space.kind === 'ACTION' ? 'actionRef' : 'cardRefs'],
        properties:
          space.kind === 'ACTION'
            ? { kind: { const: 'ACTION' }, actionRef: { type: 'string', enum: refs } }
            : {
                kind: { const: 'CARDS' },
                cardRefs: {
                  type: 'array',
                  uniqueItems: true,
                  minItems: space.canSkip ? 0 : space.min,
                  ...(space.canSkip && space.min > 1
                    ? { anyOf: [{ maxItems: 0 }, { minItems: space.min }] }
                    : {}),
                  maxItems: Math.min(space.max, refs.length),
                  items: { type: 'string', ...(refs.length ? { enum: refs } : {}) },
                  ...(space.groups
                    ? {
                        allOf: [
                          {
                            if: { minItems: space.canSkip ? 1 : 0 },
                            then: {
                              allOf: space.groups.map((group) => ({
                                contains: group.cardRefs.length ? { enum: group.cardRefs } : false,
                                minContains: group.min,
                                maxContains: group.max,
                              })),
                            },
                          },
                        ],
                      }
                    : {}),
                },
              },
      },
    },
  };
}
