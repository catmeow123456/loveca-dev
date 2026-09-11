import type { GameState } from '../../domain/entities/game.js';
import type { PlayerViewState } from '../../online/types.js';
import { createPublicObjectId } from '../../online/projector.js';
import type { SlotPosition } from '../../shared/types/enums.js';
import {
  queryActivatedAbilityResources,
  queryMemberEntryResources,
} from '../../application/card-effects/runtime/ability-resource-query.js';
import type { AiCandidate, AiMemberEntryResources } from './protocol.js';
import { summarizeAiSelfResources, summarizeAiStageAfterEntry } from './visible-resources.js';

export function visibleMemberEntryResources(
  game: GameState,
  playerId: string,
  cardId: string,
  slot: SlotPosition,
  leavingCardIds: readonly string[],
  view: PlayerViewState
): readonly AiMemberEntryResources[] {
  const visible = (id: string) => view.objects[createPublicObjectId(id)]?.surface === 'FRONT';
  return queryMemberEntryResources(game, playerId, cardId, slot, leavingCardIds)
    .filter((facts) => facts.conditionCardIds.every(visible))
    .map((facts) => ({
      abilityId: facts.abilityId,
      conditionMet: facts.conditionMet,
      conditionObjectIds: facts.conditionCardIds.map(createPublicObjectId),
      activateEnergyUpTo: facts.activateEnergyUpTo,
      recoverLiveObjectIds: facts.recoverLiveCardIds.filter(visible).map(createPublicObjectId),
    }));
}

export function visibleActivationResources(
  game: GameState,
  playerId: string,
  cardId: string,
  abilityId: string,
  view: PlayerViewState
): Pick<AiCandidate, 'activation' | 'energyCost'> {
  const facts = queryActivatedAbilityResources(game, playerId, cardId, abilityId);
  if (!facts) return {};
  const resources = summarizeAiSelfResources(view, view.match.viewerSeat);
  return {
    energyCost: facts.costs.reduce(
      (sum, cost) => sum + (cost.kind === 'TAP_ACTIVE_ENERGY' ? cost.count : 0),
      0
    ),
    activation: {
      costs: facts.costs,
      destination: facts.destination,
      ...(facts.sourceSlot ? { sourceSlot: facts.sourceSlot } : {}),
      targets: facts.targetCardIds
        .filter((id) => view.objects[createPublicObjectId(id)]?.surface === 'FRONT')
        .map((id) => ({
          objectId: createPublicObjectId(id),
          ...(facts.destination === 'SOURCE_MEMBER_SLOT' && facts.sourceSlot && id !== cardId
            ? {
                stageAfterEntry: summarizeAiStageAfterEntry(
                  resources,
                  facts.sourceSlot,
                  view.objects[createPublicObjectId(id)]!.frontInfo!
                ),
              }
            : {}),
          ...(facts.destination === 'SOURCE_MEMBER_SLOT' && facts.sourceSlot
            ? {
                entryResources: visibleMemberEntryResources(
                  game,
                  playerId,
                  id,
                  facts.sourceSlot,
                  [cardId],
                  view
                ),
              }
            : {}),
        })),
    },
  };
}
