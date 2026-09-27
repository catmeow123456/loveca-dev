import type { GameState } from '../../domain/entities/game.js';
import { getPlayerById } from '../../domain/entities/game.js';
import { isMemberCardData } from '../../domain/entities/card.js';
import { costCalculator } from '../../domain/rules/cost-calculator.js';
import { buildPlayMemberCostResources } from '../../application/effects/play-member-cost.js';
import { getMemberPlayOptionsForHandCard } from '../../application/member-play-options.js';
import {
  createPendingSpecialMemberPlay,
  getSpecialMemberPlayPendingUiConfig,
  validateBeginSpecialMemberPlay,
  validateConfirmSpecialMemberPlay,
} from '../../application/special-member-play-procedures.js';
import {
  GameCommandType,
  type BeginSpecialMemberPlayCommand,
} from '../../application/game-commands.js';
import { createPublicObjectId } from '../../online/projector.js';
import type { PlayerViewState } from '../../online/types.js';
import type { AiCandidate } from './protocol.js';
import { validateSelection } from './protocol.js';
import type { AiEffectDecisionPlan } from './effect-decision.js';
import { describeAiMemberPlay, summarizeAiSelfResources } from './visible-resources.js';

interface SpecialPlayOption {
  readonly facts: Omit<AiCandidate, 'ref'>;
  readonly command: Omit<BeginSpecialMemberPlayCommand, 'playerId' | 'timestamp'>;
}

/** Adapt the existing confirm-only procedure shape, not individual card identities. */
export function queryAiSpecialMemberPlays(
  game: GameState,
  playerId: string,
  view: PlayerViewState
): readonly SpecialPlayOption[] | { readonly reason: string } {
  const player = getPlayerById(game, playerId)!;
  const choices: SpecialPlayOption[] = [];
  for (const cardId of player.hand.cardIds) {
    for (const option of getMemberPlayOptionsForHandCard(game, playerId, cardId)) {
      if (option.kind !== 'CARD_DEFINED' || !option.mode) continue;
      for (const targetSlot of option.targetSlots) {
        const begin: BeginSpecialMemberPlayCommand = {
          type: GameCommandType.BEGIN_SPECIAL_MEMBER_PLAY,
          playerId,
          timestamp: 0,
          cardId,
          targetSlot,
          mode: option.mode,
        };
        if (validateBeginSpecialMemberPlay(game, begin)) continue;
        // Pure procedure construction for its selection contract and cost; never execute a trial action.
        const pending = createPendingSpecialMemberPlay(game, begin, 'ai-special-play-query');
        if (!pending) return { reason: 'Missing special member play procedure' };
        const ui = getSpecialMemberPlayPendingUiConfig(pending);
        if (ui?.minSelectableObjects !== 0 || ui.maxSelectableObjects !== 0)
          return { reason: 'Special member play card selection is not yet adapted' };
        const card = game.cardRegistry.get(cardId)!;
        const resources = buildPlayMemberCostResources(game, playerId, cardId);
        if (!isMemberCardData(card.data) || !resources) continue;
        const replacedCardId = player.memberSlots.slots[targetSlot];
        const check = costCalculator.checkCanPayCost(card.data, targetSlot, resources, {
          specialPlayBaseCost: pending.specialPlayCost,
          ...(replacedCardId ? { relayMode: 'SINGLE' as const } : {}),
        });
        const plan = costCalculator.selectOptimalPlan(check.availablePlans);
        if (!plan) continue;
        const objectId = createPublicObjectId(cardId);
        const front = view.objects[objectId]?.frontInfo;
        const replacedObjectId = replacedCardId ? createPublicObjectId(replacedCardId) : undefined;
        const replaced = replacedObjectId ? view.objects[replacedObjectId]?.frontInfo : undefined;
        if (!front || (replacedCardId && !replaced))
          return { reason: 'Special member play lacks a visible card reference' };
        choices.push({
          facts: {
            objectId,
            targetSlot,
            energyCost: plan.actualEnergyCost,
            replacedObjectIds: replacedObjectId ? [replacedObjectId] : [],
            effectText: option.description,
            description: `${option.label}：${describeAiMemberPlay(front, replaced, {
              resources: summarizeAiSelfResources(view, view.match.viewerSeat),
              targetSlot,
              energyCost: plan.actualEnergyCost,
            })}；${option.description}`,
          },
          command: { type: begin.type, cardId, targetSlot, mode: option.mode },
        });
      }
    }
  }
  return choices;
}

export function buildAiSpecialMemberPlayConfirmation(
  game: GameState,
  playerId: string,
  view: PlayerViewState
): AiEffectDecisionPlan {
  const pending = game.pendingSpecialMemberPlay!;
  const visible = view.pendingSpecialMemberPlay;
  if (
    pending.playerId !== playerId ||
    visible?.id !== pending.id ||
    visible.playerSeat !== view.match.viewerSeat ||
    visible.minSelectableObjects !== 0 ||
    visible.maxSelectableObjects !== 0 ||
    visible.sourceObjectId !== createPublicObjectId(pending.sourceCardId) ||
    !view.objects[visible.sourceObjectId]?.frontInfo ||
    !pending.candidateCardIds.every((id) => {
      const objectId = createPublicObjectId(id);
      return visible.candidateObjectIds?.includes(objectId) && view.objects[objectId]?.frontInfo;
    })
  )
    return { reason: 'Special member play confirmation is not fully projected' };
  const command = {
    type: GameCommandType.CONFIRM_SPECIAL_MEMBER_PLAY as const,
    playerId,
    pendingId: pending.id,
    selectedCardIds: [],
  };
  if (validateConfirmSpecialMemberPlay(game, { ...command, timestamp: 0 }, pending))
    return { reason: 'Special member play confirmation is no longer valid' };
  const space = {
    kind: 'ACTION' as const,
    candidates: [
      {
        ref: 'a1',
        objectId: visible.sourceObjectId,
        description: visible.confirmSelectionLabel ?? '确认特殊登场',
        effectText: visible.stepText,
      },
    ],
  };
  return {
    purpose: 'EFFECT_CONFIRM',
    space,
    toCommand(selection, timestamp) {
      validateSelection(space, selection);
      return { ...command, timestamp };
    },
  };
}
