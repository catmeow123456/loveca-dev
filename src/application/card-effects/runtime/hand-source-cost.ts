import { isMemberCardData } from '../../../domain/entities/card.js';
import { getCardById, getPlayerById, type GameState } from '../../../domain/entities/game.js';
import { cardCodeMatchesBase } from '../../../shared/utils/card-code.js';
import { payImmediateEffectCosts } from '../../effects/effect-costs.js';
import {
  discardOneHandCardToWaitingRoomAndEnqueueTriggers,
  type EnqueueTriggeredCardEffectsForEnterWaitingRoom,
} from './enter-waiting-room-triggers.js';

/** Fixed hand source costs: revalidate before energy selection resumes, then commit both costs. */
export function payHandSourceEnergyAndDiscardCost(
  game: GameState,
  playerId: string,
  sourceCardId: string,
  options: { readonly baseCardCodes: readonly string[]; readonly energyCost: number },
  enqueue: EnqueueTriggeredCardEffectsForEnterWaitingRoom
) {
  const source = getCardById(game, sourceCardId);
  const player = getPlayerById(game, playerId);
  if (
    !source ||
    source.ownerId !== playerId ||
    !isMemberCardData(source.data) ||
    !options.baseCardCodes.some((base) => cardCodeMatchesBase(source.data.cardCode, base)) ||
    !player?.hand.cardIds.includes(sourceCardId)
  )
    return null;
  const payment = payImmediateEffectCosts(
    game,
    playerId,
    sourceCardId,
    options.energyCost === 0 ? [] : [{ kind: 'TAP_ACTIVE_ENERGY', count: options.energyCost }]
  );
  if (!payment || !getPlayerById(payment.gameState, playerId)?.hand.cardIds.includes(sourceCardId))
    return null;
  const discarded = discardOneHandCardToWaitingRoomAndEnqueueTriggers(
    payment.gameState,
    playerId,
    sourceCardId,
    { candidateCardIds: [sourceCardId] },
    enqueue
  );
  return discarded ? { ...discarded, paidEnergyCardIds: payment.paidEnergyCardIds } : null;
}
