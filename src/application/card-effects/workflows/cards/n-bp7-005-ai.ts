import { addAction, getCardById, getPlayerById, type GameState, type PendingAbilityState } from '../../../../domain/entities/game.js';
import { selectDifferentNamedCards } from '../../../../shared/utils/card-identity.js';
import { CardType, OrientationState } from '../../../../shared/types/enums.js';
import { groupAliasIs, typeIs, unitAliasIs } from '../../../effects/card-selectors.js';
import { placeEnergyFromEnergyDeckBelowStageMember } from '../../../effects/energy-below.js';
import { getEnergyCardIdsByOrientation } from '../../../effects/energy.js';
import { getStageMemberCardIdsMatching } from '../../../effects/stage-targets.js';
import { N_BP7_005_ON_ENTER_DIVERDIVA_CHOOSE_ACTIVATE_TWO_OR_PLACE_ENERGY_BELOW_ABILITY_ID } from '../../ability-ids.js';
import { startPendingActiveEffect } from '../../runtime/active-effect.js';
import { activateWaitingEnergyCardsForPlayer } from '../../runtime/actions.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText } from '../../runtime/workflow-helpers.js';

const CHOOSE_BRANCH_STEP_ID = 'N_BP7_005_CHOOSE_BRANCH';
const SELECT_TARGET_STEP_ID = 'N_BP7_005_SELECT_ENERGY_BELOW_TARGET';
const ACTIVATE_OPTION = 'activate-two-energy';
const PLACE_OPTION = 'place-energy-below';
type Continue = (game: GameState, orderedResolution: boolean) => GameState;

export function registerNBp7005AiWorkflowHandlers(): void {
  registerPendingAbilityStarterHandler(
    N_BP7_005_ON_ENTER_DIVERDIVA_CHOOSE_ACTIVATE_TWO_OR_PLACE_ENERGY_BELOW_ABILITY_ID,
    (game, ability, options, context) => start(game, ability, options.orderedResolution === true, context.continuePendingCardEffects)
  );
  registerActiveEffectStepHandler(
    N_BP7_005_ON_ENTER_DIVERDIVA_CHOOSE_ACTIVATE_TWO_OR_PLACE_ENERGY_BELOW_ABILITY_ID,
    CHOOSE_BRANCH_STEP_ID,
    (game, input, context) => chooseBranch(game, input.selectedOptionId ?? null, context.continuePendingCardEffects)
  );
  registerActiveEffectStepHandler(
    N_BP7_005_ON_ENTER_DIVERDIVA_CHOOSE_ACTIVATE_TWO_OR_PLACE_ENERGY_BELOW_ABILITY_ID,
    SELECT_TARGET_STEP_ID,
    (game, input, context) => placeBelow(game, input.selectedCardId ?? null, context.continuePendingCardEffects)
  );
}

function start(game: GameState, ability: PendingAbilityState, ordered: boolean, next: Continue): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player || getDifferentDiverDivaMemberIds(game, player.id).length < 2) {
    return finish(game, ability, ordered, next, { step: 'DIVERDIVA_CONDITION_NOT_MET' });
  }
  const branches = getExecutableBranches(game, player.id);
  if (branches.length === 0) return finish(game, ability, ordered, next, { step: 'NO_EXECUTABLE_BRANCH' });
  if (branches.length === 1) {
    return branches[0] === ACTIVATE_OPTION
      ? activateEnergy(game, ability, ordered, next)
      : beginPlacement(game, ability, ordered, next);
  }
  return startPendingActiveEffect(game, {
    ability,
    playerId: player.id,
    activeEffect: {
      id: ability.id, abilityId: ability.abilityId, sourceCardId: ability.sourceCardId,
      controllerId: player.id, effectText: getAbilityEffectText(ability.abilityId),
      stepId: CHOOSE_BRANCH_STEP_ID, stepText: '请选择要执行的效果。', awaitingPlayerId: player.id,
      selectableOptions: [
        { id: ACTIVATE_OPTION, label: '将2张能量变为活跃状态' },
        { id: PLACE_OPTION, label: '将能量放置于『虹ヶ咲』成员下方' },
      ],
      canSkipSelection: false,
      metadata: { orderedResolution: ordered },
    },
    actionPayload: { sourceCardId: ability.sourceCardId, step: 'CHOOSE_EXECUTABLE_BRANCH' },
  });
}

function chooseBranch(game: GameState, option: string | null, next: Continue): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.stepId !== CHOOSE_BRANCH_STEP_ID ||
    !option ||
    effect.selectableOptions?.some((candidate) => candidate.id === option) !== true
  ) return game;
  const ability = pendingFromEffect(effect);
  return option === ACTIVATE_OPTION
    ? activateEnergy(game, ability, effect.metadata?.orderedResolution === true, next)
    : beginPlacement(game, ability, effect.metadata?.orderedResolution === true, next);
}

function activateEnergy(game: GameState, ability: PendingAbilityState, ordered: boolean, next: Continue): GameState {
  const waitingCount = getEnergyCardIdsByOrientation(game, ability.controllerId, OrientationState.WAITING).length;
  if (waitingCount === 0) return finish(game, ability, ordered, next, { step: 'ACTIVATE_BRANCH_STALE', activatedEnergyCardIds: [] });
  const result = activateWaitingEnergyCardsForPlayer(game, ability.controllerId, Math.min(2, waitingCount));
  if (!result) return game;
  return finish(result.gameState, ability, ordered, next, {
    step: 'ACTIVATE_TWO_ENERGY', activatedEnergyCardIds: result.activatedEnergyCardIds,
  });
}

function beginPlacement(game: GameState, ability: PendingAbilityState, ordered: boolean, next: Continue): GameState {
  const targets = getNijigasakiTargets(game, ability.controllerId);
  const player = getPlayerById(game, ability.controllerId);
  if (!player || player.energyDeck.cardIds.length === 0 || targets.length === 0) {
    return finish(game, ability, ordered, next, { step: 'PLACE_BRANCH_STALE', placedEnergyCardIds: [] });
  }
  if (targets.length === 1) return resolvePlacement(game, ability, targets[0]!, ordered, next);
  return {
    ...game,
    activeEffect: {
      id: ability.id, abilityId: ability.abilityId, sourceCardId: ability.sourceCardId,
      controllerId: ability.controllerId, effectText: getAbilityEffectText(ability.abilityId),
      stepId: SELECT_TARGET_STEP_ID, stepText: '请选择放置能量的成员。', awaitingPlayerId: ability.controllerId,
      selectableCardIds: targets, selectionLabel: '选择放置能量的成员', confirmSelectionLabel: '放置能量',
      canSkipSelection: false, metadata: { orderedResolution: ordered },
    },
  };
}

function placeBelow(game: GameState, targetCardId: string | null, next: Continue): GameState {
  const effect = game.activeEffect;
  if (!effect || effect.stepId !== SELECT_TARGET_STEP_ID || !targetCardId || effect.selectableCardIds?.includes(targetCardId) !== true) return game;
  return resolvePlacement(game, pendingFromEffect(effect), targetCardId, effect.metadata?.orderedResolution === true, next);
}

function resolvePlacement(game: GameState, ability: PendingAbilityState, targetCardId: string, ordered: boolean, next: Continue): GameState {
  const placement = placeEnergyFromEnergyDeckBelowStageMember(game, ability.controllerId, targetCardId, 1);
  if (!placement) return finish(game, ability, ordered, next, { step: 'PLACE_TARGET_STALE', targetMemberCardId: targetCardId, placedEnergyCardIds: [] });
  return finish(placement.gameState, ability, ordered, next, {
    step: 'PLACE_ENERGY_BELOW_NIJIGASAKI_MEMBER', targetMemberCardId: targetCardId,
    targetSlot: placement.targetSlot, placedEnergyCardIds: placement.placedEnergyCardIds,
  });
}

function finish(game: GameState, ability: PendingAbilityState, ordered: boolean, next: Continue, payload: Record<string, unknown>): GameState {
  const state = { ...game, activeEffect: null, pendingAbilities: game.pendingAbilities.filter((item) => item.id !== ability.id) };
  return next(addAction(state, 'RESOLVE_ABILITY', ability.controllerId, {
    pendingAbilityId: ability.id, abilityId: ability.abilityId, sourceCardId: ability.sourceCardId, ...payload,
  }), ordered);
}

function getExecutableBranches(game: GameState, playerId: string): readonly string[] {
  const player = getPlayerById(game, playerId);
  if (!player) return [];
  const branches: string[] = [];
  if (getEnergyCardIdsByOrientation(game, playerId, OrientationState.WAITING).length > 0) branches.push(ACTIVATE_OPTION);
  if (player.energyDeck.cardIds.length > 0 && getNijigasakiTargets(game, playerId).length > 0) branches.push(PLACE_OPTION);
  return branches;
}

function getDifferentDiverDivaMemberIds(game: GameState, playerId: string): readonly string[] {
  const ids = getStageMemberCardIdsMatching(game, playerId, unitAliasIs('DiverDiva'));
  return selectDifferentNamedCards(ids, (id) => getCardById(game, id)?.data ?? null, { minCount: 2, maxCount: 2 }).map((entry) => entry.item);
}

function getNijigasakiTargets(game: GameState, playerId: string): readonly string[] {
  return getStageMemberCardIdsMatching(game, playerId, (card) => typeIs(CardType.MEMBER)(card) && groupAliasIs('虹ヶ咲')(card));
}

function pendingFromEffect(effect: NonNullable<GameState['activeEffect']>): PendingAbilityState {
  return { id: effect.id, abilityId: effect.abilityId, sourceCardId: effect.sourceCardId, controllerId: effect.controllerId, mandatory: true, timingId: '', eventIds: [] };
}
