import { isMemberCardData } from '../../../../domain/entities/card.js';
import { addAction, getCardById, getPlayerById, type GameState, type PendingAbilityState } from '../../../../domain/entities/game.js';
import { OrientationState, SlotPosition } from '../../../../shared/types/enums.js';
import { cardCodeMatchesBase } from '../../../../shared/utils/card-code.js';
import { placeEnergyFromDeckToZoneByCardEffect } from '../../../effects/energy.js';
import { payImmediateEffectCosts } from '../../../effects/effect-costs.js';
import { drawCardsForPlayer } from '../../runtime/actions.js';
import { startPendingActiveEffect } from '../../runtime/active-effect.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText, recordPayCostAction } from '../../runtime/workflow-helpers.js';
import { SP_PB1_004_LIVE_START_PAY_TWO_ENERGY_PLACE_WAITING_ENERGY_ABILITY_ID, SP_PB1_004_LIVE_SUCCESS_PAY_THREE_ENERGY_DRAW_ONE_ABILITY_ID } from '../../ability-ids.js';

const START_STEP = 'SP_PB1_004_LIVE_START_PAY_TWO_ENERGY';
const SUCCESS_STEP = 'SP_PB1_004_LIVE_SUCCESS_PAY_THREE_ENERGY';
const PAY = 'pay';
type Continue = (game: GameState, ordered: boolean) => GameState;

export function registerSpPb1004SumireWorkflowHandlers(): void {
  register(SP_PB1_004_LIVE_START_PAY_TWO_ENERGY_PLACE_WAITING_ENERGY_ABILITY_ID, START_STEP, 2, '支付[E][E]');
  register(SP_PB1_004_LIVE_SUCCESS_PAY_THREE_ENERGY_DRAW_ONE_ABILITY_ID, SUCCESS_STEP, 3, '支付[E][E][E]');
}

function register(abilityId: string, stepId: string, cost: number, label: string): void {
  registerPendingAbilityStarterHandler(abilityId, (game, ability, options, context) =>
    start(game, ability, options.orderedResolution === true, context.continuePendingCardEffects, stepId, cost, label));
  registerActiveEffectStepHandler(abilityId, stepId, (game, input, context) =>
    finish(game, input.selectedOptionId ?? null, context.continuePendingCardEffects, stepId, cost));
}

function activeEnergyCount(game: GameState, playerId: string): number {
  const player = getPlayerById(game, playerId);
  return player?.energyZone.cardIds.filter((id) => player.energyZone.cardStates.get(id)?.orientation !== OrientationState.WAITING).length ?? 0;
}

function sourceIsValid(game: GameState, playerId: string, sourceCardId: string): boolean {
  const player = getPlayerById(game, playerId);
  const card = getCardById(game, sourceCardId);
  return Boolean(player && card && card.ownerId === playerId && isMemberCardData(card.data) &&
    cardCodeMatchesBase(card.data.cardCode, 'PL!SP-pb1-004') &&
    [SlotPosition.LEFT, SlotPosition.CENTER, SlotPosition.RIGHT].some((slot) => player.memberSlots.slots[slot] === sourceCardId));
}

function start(game: GameState, ability: PendingAbilityState, ordered: boolean, next: Continue, stepId: string, cost: number, label: string): GameState {
  const player = getPlayerById(game, ability.controllerId);
  const needsEnergyDeck = ability.abilityId === SP_PB1_004_LIVE_START_PAY_TWO_ENERGY_PLACE_WAITING_ENERGY_ABILITY_ID;
  if (!player || !sourceIsValid(game, ability.controllerId, ability.sourceCardId) || activeEnergyCount(game, ability.controllerId) < cost || (needsEnergyDeck && player.energyDeck.cardIds.length === 0)) {
    return consume(game, ability, ordered, next, { step: !player ? 'PLAYER_MISSING' : needsEnergyDeck && player.energyDeck.cardIds.length === 0 ? 'NO_ENERGY_DECK_CANDIDATE' : 'NO_ACTIVE_ENERGY' });
  }
  return startPendingActiveEffect(game, { ability, playerId: player.id, activeEffect: {
    id: ability.id, abilityId: ability.abilityId, sourceCardId: ability.sourceCardId,
    controllerId: ability.controllerId, effectText: getAbilityEffectText(ability.abilityId), stepId,
    stepText: needsEnergyDeck ? '可以支付[E][E]，放置1张待机能量。' : '可以支付[E][E][E]，抽1张卡。',
    awaitingPlayerId: player.id, selectableOptions: [{ id: PAY, label }], canSkipSelection: true,
    skipSelectionLabel: '不发动', metadata: { orderedResolution: ordered },
  }, actionPayload: { sourceCardId: ability.sourceCardId, step: 'START_OPTIONAL_ENERGY_PAYMENT' } });
}

function finish(game: GameState, option: string | null, next: Continue, stepId: string, cost: number): GameState {
  const effect = game.activeEffect;
  if (!effect || effect.stepId !== stepId) return game;
  const player = getPlayerById(game, effect.controllerId);
  if (!player) return game;
  if (option === null) return resolve({ ...game, activeEffect: null }, player.id, effect, next, { step: 'DECLINE', paidEnergyCardIds: [] });
  if (option !== PAY) return game;
  const needsEnergyDeck = effect.abilityId === SP_PB1_004_LIVE_START_PAY_TWO_ENERGY_PLACE_WAITING_ENERGY_ABILITY_ID;
  if (!sourceIsValid(game, player.id, effect.sourceCardId) || (needsEnergyDeck && player.energyDeck.cardIds.length === 0) || activeEnergyCount(game, player.id) < cost) {
    return resolve({ ...game, activeEffect: null }, player.id, effect, next, { step: 'CANDIDATE_STALE', paidEnergyCardIds: [] });
  }
  const payment = payImmediateEffectCosts(game, player.id, effect.sourceCardId, [{ kind: 'TAP_ACTIVE_ENERGY', count: cost }]);
  if (!payment) return resolve({ ...game, activeEffect: null }, player.id, effect, next, { step: 'PAYMENT_FAILED', paidEnergyCardIds: [] });
  let state = recordPayCostAction(payment.gameState, player.id, { pendingAbilityId: effect.id, abilityId: effect.abilityId, sourceCardId: effect.sourceCardId, energyCardIds: payment.paidEnergyCardIds, amount: payment.paidEnergyCardIds.length });
  if (needsEnergyDeck) {
    const placed = placeEnergyFromDeckToZoneByCardEffect(state, player.id, 1, OrientationState.WAITING, { kind: 'CARD_EFFECT', playerId: player.id, sourceCardId: effect.sourceCardId, abilityId: effect.abilityId, pendingAbilityId: effect.id });
    state = placed?.gameState ?? state;
    return resolve({ ...state, activeEffect: null }, player.id, effect, next, { step: 'PAY_TWO_PLACE_WAITING_ENERGY', paidEnergyCardIds: payment.paidEnergyCardIds, placedEnergyCardIds: placed?.placedEnergyCardIds ?? [] });
  }
  const drawn = drawCardsForPlayer(state, player.id, 1);
  return resolve({ ...(drawn?.gameState ?? state), activeEffect: null }, player.id, effect, next, { step: 'PAY_THREE_DRAW_ONE', paidEnergyCardIds: payment.paidEnergyCardIds, drawnCardIds: drawn?.drawnCardIds ?? [] });
}

function consume(game: GameState, ability: PendingAbilityState, ordered: boolean, next: Continue, payload: Record<string, unknown>): GameState {
  const state = { ...game, pendingAbilities: game.pendingAbilities.filter((item) => item.id !== ability.id) };
  const player = getPlayerById(game, ability.controllerId);
  return player ? next(addAction(state, 'RESOLVE_ABILITY', player.id, { pendingAbilityId: ability.id, abilityId: ability.abilityId, sourceCardId: ability.sourceCardId, ...payload }), ordered) : next(state, ordered);
}

function resolve(game: GameState, playerId: string, effect: NonNullable<GameState['activeEffect']>, next: Continue, payload: Record<string, unknown>): GameState {
  return next(addAction(game, 'RESOLVE_ABILITY', playerId, { pendingAbilityId: effect.id, abilityId: effect.abilityId, sourceCardId: effect.sourceCardId, ...payload }), effect.metadata?.orderedResolution === true);
}
