import { z } from 'zod';
import { applyHeartRequirementModifiers } from '../../domain/rules/live-requirement-modifiers.js';
import { BladeHeartEffect, CardType, HeartColor } from '../../shared/types/enums.js';
import type { ViewFrontCardInfo } from '../../online/types.js';
import { validateSelection, type AiDecisionInput } from './protocol.js';
import type { AiKnowledgeMaterial } from './presets.js';
import {
  calculateLiveProbability,
  cheerSignature,
  type CheerGroup,
  type ProbabilityBudget,
  type ProbabilityHearts,
} from './live-probability.js';

const frozenDeckSchema = z.object({
  cards: z
    .array(
      z.object({
        count: z.number().int().positive().max(120),
        card: z.object({
          cardCode: z.string(),
          cardType: z.enum(CardType),
          bladeHearts: z
            .array(
              z.object({
                effect: z.enum(BladeHeartEffect),
                heartColor: z.enum(HeartColor).optional(),
              })
            )
            .optional(),
        }),
      })
    )
    .max(120),
});
const fail = (reason: string) => ({ status: 'UNAVAILABLE' as const, reason });
const addHearts = (a: ProbabilityHearts, b: ProbabilityHearts) => {
  const result = { ...a };
  for (const [color, count] of Object.entries(b)) {
    const c = color as HeartColor;
    result[c] = (result[c] ?? 0) + count;
  }
  return result;
};

/** Only projected own-zone fronts and the frozen OWN deck enter the accounting. */
function prepare(input: AiDecisionInput, ownDeck?: AiKnowledgeMaterial) {
  if (input.purpose !== 'LIVE_SET' || input.space.kind !== 'CARDS' || !input.liveSet)
    return fail('NOT_LIVE_SET');
  let raw: unknown;
  try {
    raw = JSON.parse(ownDeck?.content ?? 'null');
  } catch {
    return fail('INVALID_FROZEN_DECK');
  }
  const parsed = frozenDeckSchema.safeParse(raw);
  if (!parsed.success) return fail('INVALID_FROZEN_DECK');
  const { state } = input;
  const selfSeat = state.selfSeat;
  if (selfSeat !== 'FIRST' && selfSeat !== 'SECOND') return fail('INVALID_SEAT');
  const catalog = new Map<
    string,
    { count: number; hearts: ProbabilityHearts; cardType: CardType }
  >();
  const replacement = state.liveResult?.cheerHeartColorReplacements[selfSeat];
  for (const { card, count } of parsed.data.cards) {
    if (card.cardType === CardType.ENERGY) continue;
    let hearts: ProbabilityHearts = {};
    for (const item of card.bladeHearts ?? []) {
      if (item.effect !== BladeHeartEffect.HEART) continue;
      if (!item.heartColor) return fail('MISSING_PRINTED_HEART_COLOR');
      const color = replacement?.fromColors.includes(item.heartColor)
        ? replacement.toColor
        : item.heartColor;
      hearts = addHearts(hearts, { [color]: 1 });
    }
    const existing = catalog.get(card.cardCode);
    if (
      existing &&
      (existing.cardType !== card.cardType ||
        cheerSignature(existing.hearts) !== cheerSignature(hearts))
    )
      return fail('AMBIGUOUS_FROZEN_CARD');
    catalog.set(card.cardCode, {
      count: (existing?.count ?? 0) + count,
      hearts,
      cardType: card.cardType,
    });
  }
  const remaining = new Map([...catalog].map(([code, card]) => [code, { ...card }]));
  const zones = Object.values(state.table.zones);
  const deckCount = zones.find(
    (z) => z.ownerSeat === state.selfSeat && z.zone === 'MAIN_DECK'
  )?.count;
  if (deckCount === undefined) return fail('MISSING_DECK_COUNT');
  const seen = new Set<string>();
  const refreshPool: CheerGroup[] = [];
  const eligible = new Map<string, ViewFrontCardInfo>();
  for (const zone of zones) {
    const shared = zone.zone === 'RESOLUTION_ZONE';
    if (!shared && zone.ownerSeat !== state.selfSeat) continue;
    // Never traverse main/energy deck IDs, even if a malformed caller includes them.
    if (['MAIN_DECK', 'ENERGY_DECK', 'ENERGY_ZONE'].includes(zone.zone)) continue;
    if (zone.zone === 'INSPECTION_ZONE') {
      if (zone.count) return fail('UNRESOLVED_INSPECTION');
      continue;
    }
    const ids =
      zone.zone === 'MEMBER_SLOT'
        ? Object.values(zone.slotMap ?? {}).filter((id): id is string => !!id)
        : [...(zone.objectIds ?? [])];
    if (!shared && ids.length !== zone.count) return fail('INCOMPLETE_OWN_ZONE');
    ids.push(
      ...Object.values(zone.overlays ?? {}).flat(),
      ...Object.values(zone.memberBelow ?? {}).flat()
    );
    for (const id of ids) {
      const object = state.objects[id];
      if (shared && object?.ownerSeat !== state.selfSeat) continue;
      if (
        !object ||
        object.ownerSeat !== state.selfSeat ||
        object.surface !== 'FRONT' ||
        !object.frontInfo
      )
        return fail('INCOMPLETE_OWN_FRONT');
      if (seen.has(id)) return fail('DUPLICATE_OWN_PLACEMENT');
      seen.add(id);
      const front = object.frontInfo;
      if (front.cardType === CardType.ENERGY) continue;
      const card = remaining.get(front.cardCode);
      if (!card || card.cardType !== front.cardType || --card.count < 0)
        return fail('DECK_ACCOUNTING_MISMATCH');
      if (zone.zone === 'WAITING_ROOM') refreshPool.push({ count: 1, hearts: card.hearts });
      if (zone.zone === 'HAND' || zone.zone === 'LIVE_ZONE') eligible.set(id, front);
    }
  }
  const deck = [...remaining.values()].map(({ count, hearts }) => ({ count, hearts }));
  if (deck.reduce((n, g) => n + g.count, 0) !== deckCount) return fail('DECK_ACCOUNTING_MISMATCH');
  const known = input.context?.knownDeckTop;
  const topCard = known ? remaining.get(known.frontInfo.cardCode) : undefined;
  if (known && (!topCard || topCard.count < 1)) return fail('KNOWN_TOP_NOT_IN_REMAINDER');
  const knownTop = topCard ? [topCard.hearts] : [];
  let stageHearts = { ...state.selfResources.stageHeartCounts };
  for (const heart of state.liveResult?.heartBonuses[selfSeat] ?? [])
    stageHearts = addHearts(stageHearts, { [heart.color]: heart.count });
  const candidates = input.space.candidates.map((candidate) => ({
    candidate,
    front: eligible.get(candidate.objectId ?? ''),
  }));
  if (candidates.some(({ front }) => !front)) return fail('INCOMPLETE_CANDIDATE_FRONT');
  return {
    status: 'READY' as const,
    input,
    deck,
    deckCount,
    refreshPool,
    knownTop,
    stageHearts,
    catalog,
    candidates,
    max: Math.min(input.space.max, input.liveSet.setLimit),
  };
}
type Prepared = Extract<ReturnType<typeof prepare>, { status: 'READY' }>;
type Choice = Prepared['candidates'][number];

function validFinalSet(ctx: Prepared, refs: readonly string[]): boolean {
  try {
    validateSelection(ctx.input.space, { kind: 'CARDS', cardRefs: refs });
    return refs.length <= ctx.max;
  } catch {
    return false;
  }
}

export interface LiveProbabilityAssumptions {
  /** Numeric what-if only: this API neither proves an ability legal nor spends its cost. */
  readonly additionalHearts?: ProbabilityHearts;
  readonly additionalCheer?: number;
}

function plan(
  ctx: Prepared,
  choices: readonly Choice[],
  budget: ProbabilityBudget,
  assumptions: LiveProbabilityAssumptions = {}
) {
  const lives = choices.filter(({ front }) => front?.cardType === CardType.LIVE);
  if (!lives.length) return fail('NO_LIVE');
  let requirements: ProbabilityHearts = {};
  let totalRequired = 0;
  let printedScore = 0;
  for (const { candidate, front } of lives) {
    if (!front?.requiredHearts || front.score === undefined)
      return fail('MISSING_LIVE_REQUIREMENT');
    const result = ctx.input.state.liveResult;
    const modifiers = result?.requirementModifiers[candidate.objectId!] ?? [];
    const reduction = result?.requirementReductions[candidate.objectId!] ?? 0;
    const required = applyHeartRequirementModifiers(
      {
        colorRequirements: new Map(
          Object.entries(front.requiredHearts.colorRequirements) as [HeartColor, number][]
        ),
        totalRequired: front.requiredHearts.totalRequired,
      },
      modifiers.length
        ? modifiers
        : reduction > 0
          ? [{ color: HeartColor.RAINBOW, countDelta: -reduction }]
          : []
    );
    requirements = addHearts(requirements, Object.fromEntries(required.colorRequirements));
    totalRequired += required.totalRequired;
    printedScore += front.score;
  }
  const result = calculateLiveProbability(
    {
      deck: ctx.deck,
      refreshPool: ctx.refreshPool,
      knownTop: ctx.knownTop,
      discardedBeforeCheer: choices
        .filter(({ front }) => front?.cardType === CardType.MEMBER)
        .map(({ front }) => ({ count: 1, hearts: ctx.catalog.get(front!.cardCode)!.hearts })),
      preCheerDrawCount: choices.length,
      cheerCount:
        ctx.input.state.selfResources.activeMemberBladeTotal + (assumptions.additionalCheer ?? 0),
      stageHearts: addHearts(ctx.stageHearts, assumptions.additionalHearts ?? {}),
      requirements,
      totalRequired,
    },
    budget
  );
  return { ...result, printedScore, totalRequired, requirements };
}

/** Internal batch-building primitive, also usable for offline explicit numeric what-if analysis. */
export function estimateAiLiveSet(
  input: AiDecisionInput,
  ownDeck: AiKnowledgeMaterial | undefined,
  finalSetRefs: readonly string[],
  assumptions: LiveProbabilityAssumptions = {}
) {
  return estimateAiLiveSets(input, ownDeck, [{ finalSetRefs, assumptions }])[0]!;
}

/** Batch queries share one preparation and a total work budget, never an authority state. */
export function estimateAiLiveSets(
  input: AiDecisionInput,
  ownDeck: AiKnowledgeMaterial | undefined,
  scenarios: readonly { finalSetRefs: readonly string[]; assumptions: LiveProbabilityAssumptions }[]
) {
  const ctx = prepare(input, ownDeck);
  const budget = { remainingTransitions: 150_000 };
  return scenarios.map(({ finalSetRefs, assumptions }) => {
    if (ctx.status !== 'READY') return ctx;
    if (!validFinalSet(ctx, finalSetRefs)) return fail('INVALID_FINAL_SET');
    const choices = finalSetRefs.map((ref) =>
      ctx.candidates.find(({ candidate }) => candidate.ref === ref)
    );
    if (choices.some((choice) => !choice)) return fail('INVALID_FINAL_SET');
    return {
      ...plan(ctx, choices as Choice[], budget, assumptions),
      assumptions,
      basis: 'CONDITIONAL_UNIFORM_REMAINDER_NOT_WIN_PROBABILITY' as const,
    };
  });
}

function combinations<T>(items: readonly T[], count: number): T[][] {
  const output: T[][] = [];
  const visit = (at: number, selected: T[]) => {
    if (selected.length === count) {
      output.push([...selected]);
      return;
    }
    for (let i = at; i <= items.length - count + selected.length; i++)
      visit(i + 1, [...selected, items[i]!]);
  };
  visit(0, []);
  return output;
}

/** Bounded, same-request assistance. Never filters candidates or changes the authority's command. */
export function summarizeAiLiveProbabilities(
  input: AiDecisionInput,
  ownDeck?: AiKnowledgeMaterial
) {
  const ctx = prepare(input, ownDeck);
  if (ctx.status !== 'READY') return ctx;
  if (ctx.max > 3 || ctx.candidates.length > 24) return fail('COMBINATION_LIMIT');
  const liveChoices = ctx.candidates.filter(({ front }) => front?.cardType === CardType.LIVE);
  const members = ctx.candidates.filter(({ front }) => front?.cardType === CardType.MEMBER);
  const bySize = [1, 2, 3].map((n) => (n <= ctx.max ? combinations(liveChoices, n) : []));
  const totalCombinations = bySize.reduce((n, bucket) => n + bucket.length, 0);
  // Interleave sizes so a large hand does not hide every multi-LIVE alternative.
  const selected: Choice[][] = [];
  for (let i = 0; selected.length < Math.min(24, totalCombinations); i++)
    for (const bucket of bySize) if (bucket[i] && selected.length < 24) selected.push(bucket[i]!);
  const budget = { remainingTransitions: 150_000 };
  const rows = selected.map((lives) => {
    const results: Extract<ReturnType<typeof plan>, { status: 'READY' }>[] = [];
    let reason: string | undefined;
    const cache = new Map<string, ReturnType<typeof plan>>();
    for (let count = 0; count <= Math.min(members.length, ctx.max - lives.length); count++) {
      for (const fillers of combinations(members, count)) {
        if (
          !validFinalSet(
            ctx,
            [...lives, ...fillers].map(({ candidate }) => candidate.ref)
          )
        )
          continue;
        const setCount = lives.length + count;
        const noRefresh =
          setCount + input.state.selfResources.activeMemberBladeTotal < ctx.deckCount;
        const key =
          noRefresh && !ctx.knownTop.length
            ? 'NO_REFRESH_UNIFORM'
            : `${setCount}:${fillers
                .map(({ front }) => cheerSignature(ctx.catalog.get(front!.cardCode)!.hearts))
                .sort()
                .join(';')}`;
        let result = cache.get(key);
        if (!result) {
          result = plan(ctx, [...lives, ...fillers], budget);
          cache.set(key, result);
        }
        if (result.status !== 'READY') {
          reason = result.reason;
          break;
        }
        results.push(result);
      }
      if (reason) break;
    }
    const liveRefs = lives.map(({ candidate }) => candidate.ref);
    if (reason || !results.length) return { liveRefs, ...fail(reason ?? 'NO_COMPLETIONS') };
    const range = (get: (r: (typeof results)[number]) => number) => {
      const values = results.map(get);
      // Four decimal places in [0,1]; rounded conditional estimates, not certainty guarantees.
      return [Number(Math.min(...values).toFixed(4)), Number(Math.max(...values).toFixed(4))];
    };
    return {
      liveRefs,
      status: 'READY' as const,
      printedScore: results[0]!.printedScore,
      totalRequired: results[0]!.totalRequired,
      requirements: results[0]!.requirements,
      successProbabilityRange: range((r) => r.successProbability),
      totalInsufficientProbabilityRange: range((r) => r.totalInsufficientProbability),
      colorInsufficientProbabilityRange: range((r) => r.colorInsufficientProbability),
      refreshPossible: results.some((r) => r.refreshUsed),
    };
  });
  return {
    status: 'REFERENCE' as const,
    basis: 'UNIFORM_REMAINDER_WITH_OBSERVED_TOP',
    knownTopCount: ctx.knownTop.length,
    remainingDeckCount: ctx.deckCount,
    totalCombinations,
    omittedCombinations: totalCombinations - rows.length,
    assumptions:
      '仅按当前可见修正与印刷判心，已知顶牌先消费，其余剩余牌假设均匀混合；未重建洗成员回底等历史牌群。范围来自同一LIVE组合可搭配的不同成员盖牌及最终盖牌数，包含先补抽后声援、至多一次刷新；不是置信区间或真实胜率。printedScore不含未来卡效/声援加分。未结算补心、追加/重做声援等卡效不计；0或1均仅在这些条件下成立。UNAVAILABLE只表示无法提供参考，不能据此排除动作；未展示组合不代表更差。',
    rows,
  };
}
