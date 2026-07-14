import { addAction, getPlayerById, type GameState, type PendingAbilityState } from '../../../../domain/entities/game.js';
import { CardType } from '../../../../shared/types/enums.js';
import { stackEnergyFromEnergyZoneBelowMember } from '../../../effects/energy-below.js';
import { typeIs } from '../../../effects/card-selectors.js';
import { getStageMemberCardIdsMatching } from '../../../effects/stage-targets.js';
import { PL_N_BP3_001_LIVE_START_STACK_ENERGY_DRAW_STAGE_GAIN_TWO_BLADE_ABILITY_ID } from '../../ability-ids.js';
import { finishSkippedActiveEffect, startPendingActiveEffect } from '../../runtime/active-effect.js';
import { addBladeLiveModifierForSourceMember, drawCardsForPlayer } from '../../runtime/actions.js';
import { getSourceMemberSlot } from '../../runtime/source-member.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText, recordPayCostAction } from '../../runtime/workflow-helpers.js';

const STEP_ID = 'PL_N_BP3_001_STACK_ENERGY_BELOW';
const ACTIVATE_OPTION_ID = 'stack-energy';
type ContinuePending = (game: GameState, orderedResolution: boolean) => GameState;

export function registerNBp3001AyumuWorkflowHandlers(): void {
  registerPendingAbilityStarterHandler(
    PL_N_BP3_001_LIVE_START_STACK_ENERGY_DRAW_STAGE_GAIN_TWO_BLADE_ABILITY_ID,
    (game, ability, options, context) => start(game, ability, options.orderedResolution === true, context.continuePendingCardEffects)
  );
  registerActiveEffectStepHandler(
    PL_N_BP3_001_LIVE_START_STACK_ENERGY_DRAW_STAGE_GAIN_TWO_BLADE_ABILITY_ID,
    STEP_ID,
    (game, input, context) => {
      if (input.selectedOptionId === ACTIVATE_OPTION_ID) return finish(game, context.continuePendingCardEffects);
      if (input.selectedOptionId !== undefined && input.selectedOptionId !== null) return game;
      return finishSkippedActiveEffect(game, context.continuePendingCardEffects, { step: 'DECLINE_STACK_ENERGY_BELOW' });
    }
  );
}

function start(game: GameState, ability: PendingAbilityState, orderedResolution: boolean, continuePending: ContinuePending): GameState {
  const player = getPlayerById(game, ability.controllerId);
  const sourceSlot = player ? getSourceMemberSlot(game, player.id, ability.sourceCardId) : null;
  if (!player || sourceSlot === null || player.energyZone.cardIds.length === 0) {
    return noOp(game, ability, orderedResolution, continuePending, sourceSlot === null ? 'SOURCE_NOT_ON_STAGE' : 'NO_ENERGY');
  }
  return startPendingActiveEffect(game, {
    ability,
    playerId: player.id,
    activeEffect: {
      id: ability.id, abilityId: ability.abilityId, sourceCardId: ability.sourceCardId,
      controllerId: player.id, effectText: getAbilityEffectText(ability.abilityId), stepId: STEP_ID,
      stepText: '可以将1张能量放到此成员下方。如此做时，抽1张卡，自己的舞台成员各获得[BLADE][BLADE]。',
      awaitingPlayerId: player.id,
      selectableOptions: [{ id: ACTIVATE_OPTION_ID, label: '将1张能量放到此成员下方' }],
      canSkipSelection: true, skipSelectionLabel: '不发动',
      metadata: { orderedResolution, sourceSlot },
    },
    actionPayload: { sourceCardId: ability.sourceCardId, sourceSlot, step: 'START_STACK_ENERGY_BELOW_OPTION' },
  });
}

function finish(game: GameState, continuePending: ContinuePending): GameState {
  const effect = game.activeEffect;
  if (!effect || effect.abilityId !== PL_N_BP3_001_LIVE_START_STACK_ENERGY_DRAW_STAGE_GAIN_TWO_BLADE_ABILITY_ID || effect.stepId !== STEP_ID) return game;
  const player = getPlayerById(game, effect.controllerId);
  const sourceSlot = player ? getSourceMemberSlot(game, player.id, effect.sourceCardId) : null;
  if (!player || sourceSlot === null || player.energyZone.cardIds.length === 0) {
    return finishStale(game, continuePending, sourceSlot === null ? 'SOURCE_NOT_ON_STAGE' : 'NO_ENERGY');
  }
  const stacked = stackEnergyFromEnergyZoneBelowMember(game, player.id, sourceSlot, 1);
  if (!stacked) return finishStale(game, continuePending, 'STACK_FAILED');
  let state = recordPayCostAction(stacked.gameState, player.id, {
    pendingAbilityId: effect.id, abilityId: effect.abilityId, sourceCardId: effect.sourceCardId,
    sourceSlot, costType: 'STACK_ENERGY_BELOW', stackedEnergyCardIds: stacked.stackedEnergyCardIds,
  });
  const drawn = drawCardsForPlayer(state, player.id, 1);
  if (drawn) state = drawn.gameState;
  const targetMemberCardIds = getStageMemberCardIdsMatching(state, player.id, typeIs(CardType.MEMBER));
  const appliedTargetMemberCardIds: string[] = [];
  for (const targetMemberCardId of targetMemberCardIds) {
    const result = addBladeLiveModifierForSourceMember(state, { playerId: player.id, sourceCardId: targetMemberCardId, abilityId: effect.abilityId, amount: 2 });
    if (result) { state = result.gameState; appliedTargetMemberCardIds.push(targetMemberCardId); }
  }
  return continuePending(addAction({ ...state, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
    pendingAbilityId: effect.id, abilityId: effect.abilityId, sourceCardId: effect.sourceCardId,
    sourceSlot, step: 'STACK_ENERGY_BELOW_DRAW_STAGE_GAIN_TWO_BLADE',
    stackedEnergyCardIds: stacked.stackedEnergyCardIds, drawnCardIds: drawn?.drawnCardIds ?? [],
    targetMemberCardIds, appliedTargetMemberCardIds, bladeBonusPerMember: 2,
  }), effect.metadata?.orderedResolution === true);
}

function finishStale(game: GameState, continuePending: ContinuePending, step: string): GameState {
  const effect = game.activeEffect!;
  return continuePending(addAction({ ...game, activeEffect: null }, 'RESOLVE_ABILITY', effect.controllerId, {
    pendingAbilityId: effect.id, abilityId: effect.abilityId, sourceCardId: effect.sourceCardId,
    step, stackedEnergyCardIds: [], drawnCardIds: [], targetMemberCardIds: [], appliedTargetMemberCardIds: [], bladeBonusPerMember: 2,
  }), effect.metadata?.orderedResolution === true);
}

function noOp(game: GameState, ability: PendingAbilityState, orderedResolution: boolean, continuePending: ContinuePending, step: string): GameState {
  const state = { ...game, pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id) };
  return continuePending(addAction(state, 'RESOLVE_ABILITY', ability.controllerId, { pendingAbilityId: ability.id, abilityId: ability.abilityId, sourceCardId: ability.sourceCardId, step }), orderedResolution);
}
