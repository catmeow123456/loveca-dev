import type { GameCommand } from '../../application/game-commands.js';
import type { PlayerViewState, PublicEvent } from '../../online/types.js';
import type { AiSelfResources } from './visible-resources.js';

export type AiSelection =
  | { readonly kind: 'ACTION'; readonly actionRef: string }
  | { readonly kind: 'CARDS'; readonly cardRefs: readonly string[] };

export interface AiCandidate {
  readonly ref: string;
  readonly description: string;
  readonly objectId?: string;
  readonly targetSlot?: string;
  readonly energyCost?: number;
  readonly replacedObjectIds?: readonly string[];
  readonly effectText?: string;
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
    };

export interface AiDecisionInput {
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
  }
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

export function responseSchema(space: AiDecisionSpace): Readonly<Record<string, unknown>> {
  const refs = space.candidates.map((candidate) => candidate.ref);
  return {
    type: 'object',
    additionalProperties: false,
    required: ['selection'],
    properties: {
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
                },
              },
      },
      tradeoff: { type: 'string', maxLength: 300 },
    },
  };
}
