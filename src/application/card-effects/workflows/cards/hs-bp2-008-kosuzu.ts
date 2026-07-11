import {
  addAction,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { HS_BP2_008_ON_ENTER_LOWER_COST_DOLLCHESTRA_RELAY_GAIN_TWO_BLADE_ABILITY_ID } from '../../ability-ids.js';
import { addBladeLiveModifierForSourceMember } from '../../runtime/actions.js';
import { getSourceMemberSlot } from '../../runtime/source-member.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { evaluateRelayEnterLowerCostUnitCondition } from '../shared/relay-enter-lower-cost-unit.js';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerHsBp2008KosuzuWorkflowHandlers(): void {
  registerPendingAbilityStarterHandler(
    HS_BP2_008_ON_ENTER_LOWER_COST_DOLLCHESTRA_RELAY_GAIN_TWO_BLADE_ABILITY_ID,
    (game, ability, options, context) =>
      resolveHsBp2008KosuzuOnEnter(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      )
  );
}

function resolveHsBp2008KosuzuOnEnter(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  const sourceOnStage =
    player !== null &&
    getSourceMemberSlot(game, ability.controllerId, ability.sourceCardId) !== null;
  const condition = evaluateRelayEnterLowerCostUnitCondition(
    game,
    {
      sourceCardId: ability.sourceCardId,
      controllerId: ability.controllerId,
      relayReplacements: ability.metadata?.relayReplacements,
    },
    'DOLLCHESTRA'
  );

  let state: GameState = {
    ...game,
    pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
  };
  let bladeBonus = 0;
  if (sourceOnStage && condition.conditionMet) {
    const modifierResult = addBladeLiveModifierForSourceMember(state, {
      playerId: ability.controllerId,
      sourceCardId: ability.sourceCardId,
      abilityId: ability.abilityId,
      amount: 2,
    });
    if (modifierResult) {
      state = modifierResult.gameState;
      bladeBonus = modifierResult.bladeBonus;
    }
  }

  return continuePendingCardEffects(
    addAction(state, 'RESOLVE_ABILITY', ability.controllerId, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: 'CHECK_LOWER_COST_DOLLCHESTRA_RELAY_GAIN_TWO_BLADE',
      sourceOnStage,
      conditionMet: sourceOnStage && condition.conditionMet,
      reason: sourceOnStage ? condition.reason : 'SOURCE_LEFT_STAGE',
      sourceEffectiveCost: condition.sourceEffectiveCost,
      relayReplacementCardIds: condition.relayReplacementCardIds,
      matchingRelayReplacementCardIds: condition.matchingRelayReplacementCardIds,
      capturedReplacementEffectiveCosts: condition.capturedReplacementEffectiveCosts,
      bladeBonus,
    }),
    orderedResolution
  );
}
