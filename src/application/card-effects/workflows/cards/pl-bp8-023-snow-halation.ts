import { addAction, getCardById, type GameState } from '../../../../domain/entities/game.js';
import { addLiveModifier } from '../../../../domain/rules/live-modifiers.js';
import { HeartColor } from '../../../../shared/types/enums.js';
import { cardCodeMatchesBase } from '../../../../shared/utils/card-code.js';
import { PL_BP8_023_LIVE_START_LOW_COST_NO_BLADE_HEART_GAIN_ORANGE_ABILITY_ID } from '../../ability-ids.js';
import { registerManualConfirmablePendingAbilityStarterHandler } from '../../runtime/workflow-helpers.js';

const ABILITY_ID = PL_BP8_023_LIVE_START_LOW_COST_NO_BLADE_HEART_GAIN_ORANGE_ABILITY_ID;

export function registerPlBp8023SnowHalationWorkflowHandlers(): void {
  registerManualConfirmablePendingAbilityStarterHandler(
    ABILITY_ID,
    (game, ability, options, runtime) => {
      const source = getCardById(game, ability.sourceCardId);
      // This creates a player rule until LIVE end, rather than a self-reward.
      // An already triggered ability does not need its source to remain in play.
      const applied =
        source?.ownerId === ability.controllerId &&
        cardCodeMatchesBase(source.data.cardCode, 'PL!-bp8-023');
      let state: GameState = {
        ...game,
        pendingAbilities: game.pendingAbilities.filter((pending) => pending.id !== ability.id),
      };
      if (applied) {
        state = addLiveModifier(state, {
          kind: 'CHEER_CARD_BLADE_HEART_GRANT',
          playerId: ability.controllerId,
          maxMemberCost: 4,
          heartColor: HeartColor.ORANGE,
          sourceCardId: ability.sourceCardId,
          abilityId: ability.abilityId,
        });
      }
      return runtime.continuePendingCardEffects(
        addAction(state, 'RESOLVE_ABILITY', ability.controllerId, {
          pendingAbilityId: ability.id,
          abilityId: ability.abilityId,
          sourceCardId: ability.sourceCardId,
          step: 'LOW_COST_NO_BLADE_HEART_CHEER_GAIN_ORANGE',
          applied,
        }),
        options.orderedResolution === true
      );
    }
  );
}
