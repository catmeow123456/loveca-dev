import { addAction, getCardById, getPlayerById, type GameState, type PendingAbilityState } from '../../../../domain/entities/game.js';
import { and, costLte, groupAliasIs, typeIs } from '../../../effects/card-selectors.js';
import { CardType } from '../../../../shared/types/enums.js';
import { PL_N_BP3_003_ON_ENTER_ACTIVATE_WAITING_LOW_COST_NIJIGASAKI_MEMBER_ON_ENTER_ABILITY_ID } from '../../ability-ids.js';
import { startPendingActiveEffect } from '../../runtime/active-effect.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText } from '../../runtime/workflow-helpers.js';
import { delegateWaitingRoomMemberOnEnterAbility, getWaitingRoomOnEnterTarget } from '../shared/activate-waiting-room-member-on-enter-ability.js';

const SELECT_TARGET = 'N_BP3_003_SELECT_WAITING_MEMBER';
const SELECT_ABILITY = 'N_BP3_003_SELECT_WAITING_MEMBER_ABILITY';
type ContinuePending = (game: GameState, orderedResolution: boolean) => GameState;
const isEligibleCard = and(typeIs(CardType.MEMBER), costLte(4), groupAliasIs('虹ヶ咲'));

export function registerNBp3003ShizukuWorkflowHandlers(): void {
  registerPendingAbilityStarterHandler(
    PL_N_BP3_003_ON_ENTER_ACTIVATE_WAITING_LOW_COST_NIJIGASAKI_MEMBER_ON_ENTER_ABILITY_ID,
    (game, ability, options, context) => start(game, ability, options.orderedResolution === true, context.continuePendingCardEffects)
  );
  registerActiveEffectStepHandler(
    PL_N_BP3_003_ON_ENTER_ACTIVATE_WAITING_LOW_COST_NIJIGASAKI_MEMBER_ON_ENTER_ABILITY_ID,
    SELECT_TARGET,
    (game, input, context) => selectTarget(game, input.selectedCardId ?? null, context.continuePendingCardEffects, context.delegatePendingAbility)
  );
  registerActiveEffectStepHandler(
    PL_N_BP3_003_ON_ENTER_ACTIVATE_WAITING_LOW_COST_NIJIGASAKI_MEMBER_ON_ENTER_ABILITY_ID,
    SELECT_ABILITY,
    (game, input, context) => selectAbility(game, input.selectedOptionId ?? null, context.continuePendingCardEffects, context.delegatePendingAbility)
  );
}

function candidates(game: GameState, playerId: string): readonly string[] {
  const player = getPlayerById(game, playerId);
  return player?.waitingRoom.cardIds.filter((id) => {
    const card = getCardById(game, id);
    return !!card && isEligibleCard(card) && getWaitingRoomOnEnterTarget(game, playerId, id) !== null;
  }) ?? [];
}

function start(game: GameState, ability: PendingAbilityState, orderedResolution: boolean, continuePending: ContinuePending): GameState {
  const ids = candidates(game, ability.controllerId);
  if (ids.length === 0) return finishNoop(game, ability, orderedResolution, continuePending);
  return startPendingActiveEffect(game, { ability, playerId: ability.controllerId, activeEffect: {
    id: ability.id, abilityId: ability.abilityId, sourceCardId: ability.sourceCardId, controllerId: ability.controllerId,
    effectText: getAbilityEffectText(ability.abilityId), stepId: SELECT_TARGET,
    stepText: '请选择休息室中1张费用4以下且拥有可发动【登场】能力的『虹ヶ咲』成员卡。', awaitingPlayerId: ability.controllerId,
    selectableCardIds: ids, selectableCardVisibility: 'PUBLIC', selectableCardMode: 'SINGLE', minSelectableCards: 1, maxSelectableCards: 1,
    canSkipSelection: false, selectionLabel: '选择成员', confirmSelectionLabel: '选择能力', metadata: { orderedResolution },
  }, actionPayload: { step: 'START_SELECT_WAITING_MEMBER', selectableCardIds: ids } });
}

function selectTarget(game: GameState, cardId: string | null, continuePending: ContinuePending, delegate: Parameters<typeof delegateWaitingRoomMemberOnEnterAbility>[2]): GameState {
  const effect = game.activeEffect;
  if (!effect || effect.stepId !== SELECT_TARGET || !cardId || !effect.selectableCardIds?.includes(cardId)) return game;
  const target = getWaitingRoomOnEnterTarget(game, effect.controllerId, cardId);
  if (!target) return finishStale(game, continuePending);
  if (target.definitions.length === 1) return delegateWaitingRoomMemberOnEnterAbility(game, delegationParams(effect, cardId, target.definitions[0].abilityId), delegate);
  return addAction({ ...game, activeEffect: { ...effect, stepId: SELECT_ABILITY, stepText: '请选择要发动的一项【登场】能力。', selectableCardIds: undefined, selectableCardVisibility: undefined,
    selectableCardMode: undefined, minSelectableCards: undefined, maxSelectableCards: undefined, canSkipSelection: false,
    selectableOptions: target.definitions.map((d) => ({ id: d.abilityId, label: `发动：${d.effectText}` })), selectionLabel: '选择能力', confirmSelectionLabel: '发动',
    metadata: { ...effect.metadata, delegatedTargetCardId: cardId, delegatedAbilityIds: target.definitions.map((d) => d.abilityId) } } }, 'RESOLVE_ABILITY', effect.controllerId, { abilityId: effect.abilityId, sourceCardId: effect.sourceCardId, step: 'SELECT_WAITING_MEMBER', delegatedTargetCardId: cardId });
}

function selectAbility(game: GameState, abilityId: string | null, continuePending: ContinuePending, delegate: Parameters<typeof delegateWaitingRoomMemberOnEnterAbility>[2]): GameState {
  const effect = game.activeEffect;
  const cardId = typeof effect?.metadata?.delegatedTargetCardId === 'string' ? effect.metadata.delegatedTargetCardId : null;
  if (!effect || effect.stepId !== SELECT_ABILITY || !cardId || !abilityId) return game;
  const target = getWaitingRoomOnEnterTarget(game, effect.controllerId, cardId);
  if (!target?.definitions.some((d) => d.abilityId === abilityId)) return finishStale(game, continuePending);
  return delegateWaitingRoomMemberOnEnterAbility(game, delegationParams(effect, cardId, abilityId), delegate);
}

function delegationParams(effect: NonNullable<GameState['activeEffect']>, cardId: string, abilityId: string) {
  return { controllerId: effect.controllerId, parentAbilityId: effect.abilityId, parentSourceCardId: effect.sourceCardId, parentEffectId: effect.id,
    targetCardId: cardId, delegatedAbilityId: abilityId, orderedResolution: effect.metadata?.orderedResolution === true };
}

function finishStale(game: GameState, continuePending: ContinuePending): GameState {
  const effect = game.activeEffect!;
  return continuePending(addAction({ ...game, activeEffect: null }, 'RESOLVE_ABILITY', effect.controllerId, { abilityId: effect.abilityId, sourceCardId: effect.sourceCardId, step: 'WAITING_MEMBER_OR_ABILITY_NOT_AVAILABLE' }), effect.metadata?.orderedResolution === true);
}

function finishNoop(game: GameState, ability: PendingAbilityState, orderedResolution: boolean, continuePending: ContinuePending): GameState {
  return continuePending(addAction({ ...game, pendingAbilities: game.pendingAbilities.filter((p) => p.id !== ability.id) }, 'RESOLVE_ABILITY', ability.controllerId, { pendingAbilityId: ability.id, abilityId: ability.abilityId, sourceCardId: ability.sourceCardId, step: 'NO_LEGAL_WAITING_MEMBER' }), orderedResolution);
}
