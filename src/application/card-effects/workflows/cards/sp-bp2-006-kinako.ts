import { addAction, getCardById, getPlayerById, type GameState, type PendingAbilityState } from '../../../../domain/entities/game.js';
import { isMemberCardData } from '../../../../domain/entities/card.js';
import { findMemberSlot } from '../../../../domain/entities/player.js';
import { CardType, GamePhase, SubPhase } from '../../../../shared/types/enums.js';
import { cardCodeMatchesBase } from '../../../../shared/utils/card-code.js';
import { and, costLte, groupAliasIs, typeIs } from '../../../effects/card-selectors.js';
import { SP_BP2_006_ACTIVATED_DISCARD_LOW_COST_LIELLA_MEMBER_ACTIVATE_ON_ENTER_ABILITY_ID, SP_BP2_006_ON_ENTER_RELAY_RECOVER_REPLACED_LIELLA_MEMBER_ABILITY_ID } from '../../ability-ids.js';
import { recoverCardsFromWaitingRoomToHandForPlayer } from '../../runtime/actions.js';
import { registerActivatedAbilityHandler } from '../../runtime/activated-registry.js';
import { startPendingActiveEffect } from '../../runtime/active-effect.js';
import { discardOneHandCardToWaitingRoomAndEnqueueTriggers, type EnqueueTriggeredCardEffectsForEnterWaitingRoom } from '../../runtime/enter-waiting-room-triggers.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getWaitingRoomDelegatableOnEnterDefinitions } from '../../runtime/delegatable-definitions.js';
import { getAbilityEffectText, recordAbilityUseForContext, recordPayCostAction } from '../../runtime/workflow-helpers.js';
import { delegateWaitingRoomMemberOnEnterAbility, getWaitingRoomOnEnterTarget } from '../shared/activate-waiting-room-member-on-enter-ability.js';

const SELECT_RELAY = 'SP_BP2_006_SELECT_RELAY_REPLACEMENT';
const SELECT_HAND = 'SP_BP2_006_SELECT_HAND_MEMBER';
const SELECT_ABILITY = 'SP_BP2_006_SELECT_DISCARDED_MEMBER_ABILITY';
type ContinuePending = (game: GameState, orderedResolution: boolean) => GameState;
const isEligibleLiella = and(typeIs(CardType.MEMBER), costLte(4), groupAliasIs('Liella!'));
const isLiellaMember = and(typeIs(CardType.MEMBER), groupAliasIs('Liella!'));

export function registerSpBp2006KinakoWorkflowHandlers(deps: { readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom }): void {
  registerPendingAbilityStarterHandler(SP_BP2_006_ON_ENTER_RELAY_RECOVER_REPLACED_LIELLA_MEMBER_ABILITY_ID, (game, ability, options, context) => startRelay(game, ability, options.orderedResolution === true, context.continuePendingCardEffects));
  registerActiveEffectStepHandler(SP_BP2_006_ON_ENTER_RELAY_RECOVER_REPLACED_LIELLA_MEMBER_ABILITY_ID, SELECT_RELAY, (game, input, context) => finishRelay(game, input.selectedCardId ?? null, context.continuePendingCardEffects));
  registerActivatedAbilityHandler(SP_BP2_006_ACTIVATED_DISCARD_LOW_COST_LIELLA_MEMBER_ACTIVATE_ON_ENTER_ABILITY_ID, (game, playerId, cardId) => startActivated(game, playerId, cardId));
  registerActiveEffectStepHandler(SP_BP2_006_ACTIVATED_DISCARD_LOW_COST_LIELLA_MEMBER_ACTIVATE_ON_ENTER_ABILITY_ID, SELECT_HAND, (game, input, context) => payDiscard(game, input.selectedCardId ?? null, context.delegatePendingAbility, deps.enqueueTriggeredCardEffects));
  registerActiveEffectStepHandler(SP_BP2_006_ACTIVATED_DISCARD_LOW_COST_LIELLA_MEMBER_ACTIVATE_ON_ENTER_ABILITY_ID, SELECT_ABILITY, (game, input, context) => delegateSelected(game, input.selectedOptionId ?? null, context.delegatePendingAbility, context.continuePendingCardEffects));
}

function relayCandidates(game: GameState, ability: PendingAbilityState): readonly string[] {
  const player = getPlayerById(game, ability.controllerId);
  const raw = Array.isArray(ability.metadata?.relayReplacements) ? ability.metadata.relayReplacements : [];
  const ids = raw.flatMap((item) => item && typeof item === 'object' && typeof (item as {cardId?: unknown}).cardId === 'string' ? [(item as {cardId:string}).cardId] : []);
  return ids.filter((id) => {
    const card = getCardById(game, id);
    return !!player && player.waitingRoom.cardIds.includes(id) && !!card && card.ownerId === player.id && isLiellaMember(card);
  });
}

function startRelay(game: GameState, ability: PendingAbilityState, orderedResolution: boolean, continuePending: ContinuePending): GameState {
  const ids = relayCandidates(game, ability);
  if (ids.length === 0) return finishPendingNoop(game, ability, orderedResolution, continuePending, 'NO_VALID_RELAY_REPLACEMENT');
  if (ids.length === 1) return recoverAndContinue(game, ability, ids[0], orderedResolution, continuePending, ids);
  return startPendingActiveEffect(game, { ability, playerId: ability.controllerId, activeEffect: { id: ability.id, abilityId: ability.abilityId, sourceCardId: ability.sourceCardId, controllerId: ability.controllerId,
    effectText: getAbilityEffectText(ability.abilityId), stepId: SELECT_RELAY, stepText: '请选择1张因本次换手放置入休息室的『Liella!』成员卡加入手牌。', awaitingPlayerId: ability.controllerId,
    selectableCardIds: ids, selectableCardVisibility: 'PUBLIC', selectableCardMode: 'SINGLE', minSelectableCards: 1, maxSelectableCards: 1, canSkipSelection: false,
    selectionLabel: '选择要加入手牌的成员', confirmSelectionLabel: '加入手牌', metadata: { orderedResolution } }, actionPayload: { step: 'START_SELECT_RELAY_REPLACEMENT', selectableCardIds: ids } });
}

function finishRelay(game: GameState, cardId: string | null, continuePending: ContinuePending): GameState {
  const effect = game.activeEffect;
  if (!effect || effect.stepId !== SELECT_RELAY || !cardId || !effect.selectableCardIds?.includes(cardId)) return game;
  const ability: PendingAbilityState = { id: effect.id, abilityId: effect.abilityId, sourceCardId: effect.sourceCardId, controllerId: effect.controllerId, mandatory: true, timingId: '', eventIds: [] };
  return recoverAndContinue(game, ability, cardId, effect.metadata?.orderedResolution === true, continuePending, effect.selectableCardIds);
}

function recoverAndContinue(game: GameState, ability: PendingAbilityState, cardId: string, orderedResolution: boolean, continuePending: ContinuePending, candidates: readonly string[]): GameState {
  const recovery = recoverCardsFromWaitingRoomToHandForPlayer(game, ability.controllerId, [cardId], { candidateCardIds: candidates, exactCount: 1 });
  if (!recovery) return finishPendingNoop({ ...game, activeEffect: null }, ability, orderedResolution, continuePending, 'RELAY_REPLACEMENT_NOT_AVAILABLE');
  return continuePending(addAction({ ...recovery.gameState, activeEffect: null, pendingAbilities: recovery.gameState.pendingAbilities.filter((p) => p.id !== ability.id) }, 'RESOLVE_ABILITY', ability.controllerId, { pendingAbilityId: ability.id, abilityId: ability.abilityId, sourceCardId: ability.sourceCardId, step: 'RECOVER_RELAY_REPLACEMENT', recoveredCardId: cardId, enterHandEventIds: recovery.enterHandEvents.map((e) => e.eventId) }), orderedResolution);
}

function handCandidates(game: GameState, playerId: string): readonly string[] {
  const player = getPlayerById(game, playerId);
  return player?.hand.cardIds.filter((id) => { const card = getCardById(game, id); return !!card && isEligibleLiella(card) && getWaitingRoomDelegatableOnEnterDefinitions(card.data.cardCode).length > 0; }) ?? [];
}

function startActivated(game: GameState, playerId: string, cardId: string): GameState {
  const player = getPlayerById(game, playerId);
  const sourceCard = getCardById(game, cardId);
  const ids = handCandidates(game, playerId);
  if (
    game.activeEffect ||
    game.currentPhase !== GamePhase.MAIN_PHASE ||
    game.currentSubPhase !== SubPhase.NONE ||
    game.players[game.activePlayerIndex]?.id !== playerId ||
    !player ||
    !sourceCard ||
    sourceCard.ownerId !== playerId ||
    !isMemberCardData(sourceCard.data) ||
    !cardCodeMatchesBase(sourceCard.data.cardCode, 'PL!SP-bp2-006') ||
    findMemberSlot(player, cardId) === null ||
    ids.length === 0
  ) return game;
  return addAction({ ...game, activeEffect: { id: `sp-bp2-006:${game.turnCount}:${cardId}`, abilityId: SP_BP2_006_ACTIVATED_DISCARD_LOW_COST_LIELLA_MEMBER_ACTIVATE_ON_ENTER_ABILITY_ID, sourceCardId: cardId, controllerId: playerId,
    effectText: getAbilityEffectText(SP_BP2_006_ACTIVATED_DISCARD_LOW_COST_LIELLA_MEMBER_ACTIVATE_ON_ENTER_ABILITY_ID), stepId: SELECT_HAND, stepText: '请选择手牌中1张费用4以下且拥有可发动【登场】能力的『Liella!』成员卡放置入休息室。', awaitingPlayerId: playerId,
    selectableCardIds: ids, selectableCardVisibility: 'AWAITING_PLAYER_ONLY', selectableCardMode: 'SINGLE', minSelectableCards: 1, maxSelectableCards: 1, canSkipSelection: false, selectionLabel: '选择要放置入休息室的成员', confirmSelectionLabel: '支付费用' } }, 'RESOLVE_ABILITY', playerId, { abilityId: SP_BP2_006_ACTIVATED_DISCARD_LOW_COST_LIELLA_MEMBER_ACTIVATE_ON_ENTER_ABILITY_ID, sourceCardId: cardId, step: 'START_SELECT_HAND_MEMBER' });
}

function payDiscard(game: GameState, cardId: string | null, delegate: Parameters<typeof delegateWaitingRoomMemberOnEnterAbility>[2], enqueue: EnqueueTriggeredCardEffectsForEnterWaitingRoom): GameState {
  const effect = game.activeEffect;
  if (!effect || effect.stepId !== SELECT_HAND || !cardId || !effect.selectableCardIds?.includes(cardId) || !handCandidates(game, effect.controllerId).includes(cardId)) return game;
  const discard = discardOneHandCardToWaitingRoomAndEnqueueTriggers(game, effect.controllerId, cardId, { candidateCardIds: effect.selectableCardIds }, enqueue);
  if (!discard) return game;
  const target = getWaitingRoomOnEnterTarget(discard.gameState, effect.controllerId, cardId);
  if (!target) return game;
  let state = recordPayCostAction(discard.gameState, effect.controllerId, { abilityId: effect.abilityId, sourceCardId: effect.sourceCardId, discardedCardIds: [cardId] });
  state = recordAbilityUseForContext(state, effect.controllerId, { abilityId: effect.abilityId, sourceCardId: effect.sourceCardId });
  if (target.definitions.length === 1) return delegateWaitingRoomMemberOnEnterAbility(state, params(effect, cardId, target.definitions[0].abilityId), delegate);
  return addAction({ ...state, activeEffect: { ...effect, stepId: SELECT_ABILITY, stepText: '请选择要发动的一项【登场】能力。', selectableCardIds: undefined, selectableCardVisibility: undefined,
    selectableCardMode: undefined, minSelectableCards: undefined, maxSelectableCards: undefined, canSkipSelection: false,
    selectableOptions: target.definitions.map((d) => ({ id: d.abilityId, label: `发动：${d.effectText}` })), selectionLabel: '选择能力', confirmSelectionLabel: '发动', metadata: { delegatedTargetCardId: cardId } } }, 'RESOLVE_ABILITY', effect.controllerId, { abilityId: effect.abilityId, sourceCardId: effect.sourceCardId, step: 'PAY_DISCARD_COST', discardedCardId: cardId });
}

function delegateSelected(game: GameState, abilityId: string | null, delegate: Parameters<typeof delegateWaitingRoomMemberOnEnterAbility>[2], continuePending: ContinuePending): GameState {
  const effect = game.activeEffect; const cardId = typeof effect?.metadata?.delegatedTargetCardId === 'string' ? effect.metadata.delegatedTargetCardId : null;
  if (!effect || effect.stepId !== SELECT_ABILITY || !abilityId || !cardId) return game;
  if (!getWaitingRoomOnEnterTarget(game, effect.controllerId, cardId)?.definitions.some((d) => d.abilityId === abilityId)) {
    return continuePending(
      addAction({ ...game, activeEffect: null }, 'RESOLVE_ABILITY', effect.controllerId, {
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
        step: 'DISCARDED_MEMBER_ABILITY_NOT_AVAILABLE',
        delegatedTargetCardId: cardId,
        selectedAbilityId: abilityId,
        costRemainsPaid: true,
      }),
      false
    );
  }
  return delegateWaitingRoomMemberOnEnterAbility(game, params(effect, cardId, abilityId), delegate);
}
function params(effect: NonNullable<GameState['activeEffect']>, cardId: string, abilityId: string) { return { controllerId: effect.controllerId, parentAbilityId: effect.abilityId, parentSourceCardId: effect.sourceCardId, parentEffectId: effect.id, targetCardId: cardId, delegatedAbilityId: abilityId, orderedResolution: false }; }
function finishPendingNoop(game: GameState, ability: PendingAbilityState, orderedResolution: boolean, continuePending: ContinuePending, step: string): GameState { return continuePending(addAction({ ...game, pendingAbilities: game.pendingAbilities.filter((p) => p.id !== ability.id) }, 'RESOLVE_ABILITY', ability.controllerId, { pendingAbilityId: ability.id, abilityId: ability.abilityId, sourceCardId: ability.sourceCardId, step }), orderedResolution); }
