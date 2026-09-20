import type { GameState } from '../../domain/entities/game.js';
import { GameCommandType, type GameCommand } from '../../application/game-commands.js';
import { queryActiveEffectSelection } from '../../application/card-effects/runtime/step-registry.js';
import { queryPendingAbilityOrder } from '../../application/card-effects/runtime/pending-order-query.js';
import { isConfirmOnlyPendingSelection } from '../../application/card-effects/runtime/selection-query.js';
import { getAbilityEffectText } from '../../application/card-effects/runtime/workflow-helpers.js';
import { createPublicObjectId } from '../../online/projector.js';
import type { PlayerViewState } from '../../online/types.js';
import {
  validateSelection,
  type AiCandidate,
  type AiDecision,
  type AiDecisionInput,
  type AiDecisionSpace,
} from './protocol.js';

type EffectInput = Omit<
  Extract<GameCommand, { type: GameCommandType.CONFIRM_EFFECT_STEP }>,
  'type' | 'effectId' | 'playerId' | 'timestamp'
>;

export type AiEffectDecisionPlan =
  | { readonly reason: string }
  | {
      readonly purpose: AiDecisionInput['purpose'];
      readonly space: AiDecisionSpace;
      readonly toCommand: AiDecision['toCommand'];
    };

/** Pure mapping for steps whose owning workflow has supplied the current input contract. */
export function buildAiEffectDecision(
  game: GameState,
  playerId: string,
  view: PlayerViewState
): AiEffectDecisionPlan {
  const effect = game.activeEffect!;
  const visible = view.activeEffect!;
  const command = (input: EffectInput, timestamp: number): GameCommand => ({
    type: GameCommandType.CONFIRM_EFFECT_STEP,
    playerId,
    timestamp,
    effectId: effect.id,
    ...input,
  });
  const candidates: AiCandidate[] = [];
  const commands = new Map<string, EffectInput>();
  const add = (facts: Omit<AiCandidate, 'ref'>, input: EffectInput) => {
    const ref = `a${candidates.length + 1}`;
    candidates.push({ ref, ...facts });
    commands.set(ref, input);
  };
  const actions = (purpose: AiDecisionInput['purpose']): AiEffectDecisionPlan => {
    const space: AiDecisionSpace = { kind: 'ACTION', candidates };
    return {
      purpose,
      space,
      toCommand(selection, timestamp) {
        validateSelection(space, selection);
        if (selection.kind !== 'ACTION') throw new Error('Expected action');
        return command(commands.get(selection.actionRef)!, timestamp);
      },
    };
  };

  const pending = queryPendingAbilityOrder(game);
  if (pending) {
    for (const ability of pending) {
      const objectId = createPublicObjectId(ability.sourceCardId);
      const option = visible.selectableOptions?.find((option) => option.id === ability.id);
      if (option) {
        add(
          {
            description: option.label,
            effectText: getAbilityEffectText(ability.abilityId),
            ...(view.objects[objectId]?.surface === 'FRONT' ? { objectId } : {}),
          },
          { selectedOptionId: option.id }
        );
      } else if (
        visible.selectableObjectIds?.includes(objectId) &&
        view.objects[objectId]?.surface === 'FRONT'
      ) {
        add(
          {
            description: `处理 ${describeCard(view, objectId)}`,
            objectId,
            effectText: getAbilityEffectText(ability.abilityId),
          },
          { selectedCardId: ability.sourceCardId }
        );
      } else return { reason: 'Pending ability lacks a visible selection reference' };
    }
    if (visible.canResolveInOrder)
      add({ description: '按当前队列顺序处理后续效果' }, { resolveInOrder: true });
    return candidates.length ? actions('PENDING_ORDER') : { reason: 'No pending ability choices' };
  }
  if (isConfirmOnlyPendingSelection(effect)) {
    add({ description: '继续处理当前效果', effectText: visible.effectText }, {});
    return actions('EFFECT_CONFIRM');
  }
  const selection = queryActiveEffectSelection(game);
  if (!selection)
    return { reason: `Missing effect selection query: ${effect.abilityId}/${effect.stepId}` };
  if (selection.kind === 'CONFIRM') {
    add({ description: '继续处理当前效果', effectText: visible.effectText }, {});
    return actions('EFFECT_CONFIRM');
  }
  if (selection.kind === 'SLOTS') {
    if (
      visible.selectableSlots?.length !== selection.slots.length ||
      !selection.slots.every((slot) => visible.selectableSlots?.includes(slot))
    )
      return { reason: 'Effect slot candidates are not visible to the acting seat' };
    for (const slot of selection.slots)
      add(
        { description: `${visible.selectionLabel ?? '选择成员区'}：${slot}`, targetSlot: slot },
        { selectedSlot: slot }
      );
    if (selection.canSkip)
      add({ description: visible.skipSelectionLabel ?? '不选择' }, { selectedSlot: null });
    return candidates.length ? actions('EFFECT') : { reason: 'No legal effect slot choices' };
  }
  if (selection.kind === 'OPTIONS') {
    if (!selection.structured && (selection.min !== 1 || selection.max !== 1))
      return { reason: 'Multiple unstructured effect branches are not supported' };
    const projected = selection.structured
      ? visible.effectChoice?.options
      : visible.selectableOptions;
    for (const option of selection.options) {
      if (!projected?.some((candidate) => candidate.id === option.id))
        return { reason: 'Effect option lacks a visible reference' };
    }
    if (selection.structured) {
      // Each action is a complete legal subset, ordered as printed for resolution.
      const addCombinations = (start: number, count: number, indices: number[]) => {
        if (count === 0) {
          const chosen = indices.map((index) => selection.options[index]!);
          add(
            { description: chosen.map((option) => option.text).join('\n') || '不选择效果' },
            { selectedEffectOptionIds: chosen.map((option) => option.id) }
          );
          return;
        }
        for (let index = start; index <= selection.options.length - count; index++) {
          addCombinations(index + 1, count - 1, [...indices, index]);
        }
      };
      for (
        let count = selection.min;
        count <= Math.min(selection.max, selection.options.length);
        count++
      ) {
        addCombinations(0, count, []);
      }
    } else {
      for (const option of selection.options) {
        add({ description: option.text }, { selectedOptionId: option.id });
      }
    }
    if (selection.canSkip)
      add({ description: visible.skipSelectionLabel ?? '不发动' }, { selectedCardId: null });
    return candidates.length ? actions('EFFECT') : { reason: 'No effect options' };
  }

  const cardIds = new Map<string, string>();
  const objectIds = visible.selectableObjectIds;
  if (!objectIds || objectIds.length !== selection.cardIds.length)
    return { reason: 'Effect card candidates are not visible to the acting seat' };
  for (let index = 0; index < objectIds.length; index++) {
    const objectId = objectIds[index]!;
    const ref = `c${index + 1}`;
    const cardId = selection.cardIds[index]!;
    if (objectId !== createPublicObjectId(cardId) || view.objects[objectId]?.surface !== 'FRONT')
      return { reason: 'Effect card identity is not visible' };
    candidates.push({ ref, objectId, description: describeCard(view, objectId) });
    cardIds.set(ref, cardId);
  }
  if (selection.min > candidates.length && !selection.canSkip)
    return { reason: 'Effect has no complete legal card selection' };
  const space: AiDecisionSpace = {
    kind: 'CARDS',
    candidates,
    min: selection.min,
    max: selection.max,
    ordered: selection.mode === 'ORDERED_MULTI',
    canSkip: selection.canSkip,
    ...(selection.groups
      ? {
          groups: selection.groups.map((group) => ({
            cardRefs: [...cardIds]
              .filter(([, id]) => group.cardIds.includes(id))
              .map(([ref]) => ref),
            min: group.min,
            max: group.max,
          })),
        }
      : {}),
    ...(selection.canSkip ? { skipDescription: visible.skipSelectionLabel ?? '不选择' } : {}),
  };
  return {
    purpose: 'EFFECT',
    space,
    toCommand(chosen, timestamp) {
      validateSelection(space, chosen);
      if (chosen.kind !== 'CARDS') throw new Error('Expected card selection');
      const ids = chosen.cardRefs.map((ref) => cardIds.get(ref)!);
      return command(
        ids.length === 0 && selection.canSkip
          ? { selectedCardId: null }
          : selection.mode === 'ORDERED_MULTI'
            ? { selectedCardIds: ids }
            : { selectedCardId: ids[0]! },
        timestamp
      );
    },
  };
}

function describeCard(view: PlayerViewState, objectId: string): string {
  const card = view.objects[objectId]!.frontInfo!;
  return `${card.cardCode} ${card.cost !== undefined ? `费用 ${card.cost}` : `分数 ${card.score}`}「${card.nameCn ?? card.nameJp ?? card.cardCode}」`;
}
