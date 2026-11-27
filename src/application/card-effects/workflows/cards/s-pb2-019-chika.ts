import { addAction, getOpponent } from '../../../../domain/entities/game.js';
import { HeartColor } from '../../../../shared/types/enums.js';
import { addHeartLiveModifierForSourceMember } from '../../../../domain/rules/live-modifiers.js';
import { S_PB2_019_ON_ENTER_OPPONENT_DRAW_TWO_GAIN_RED_HEARTS_ABILITY_ID as ABILITY } from '../../ability-ids.js';
import { getPendingAbilitySourceLifecycleId } from '../../runtime/ability-source-lifecycle.js';
import { drawCardsForPlayer } from '../../runtime/actions.js';
import { isCurrentStageMemberAbilitySource } from '../../runtime/source-member.js';
import { registerManualConfirmablePendingAbilityStarterHandler } from '../../runtime/workflow-helpers.js';

export function registerSPb2019ChikaWorkflowHandlers(): void {
  registerManualConfirmablePendingAbilityStarterHandler(
    ABILITY,
    (game, ability, options, context) => {
      const opponent = getOpponent(game, ability.controllerId);
      if (!opponent) return game;
      const sourceLifecycleId = getPendingAbilitySourceLifecycleId(game, ability);
      const draw = drawCardsForPlayer(game, opponent.id, 2);
      if (!draw) return game;
      const sourceIsCurrent = isCurrentStageMemberAbilitySource(draw.gameState, {
        ...ability,
        sourceLifecycleId,
      });
      const bonus =
        !draw.gameState.isEnded && sourceIsCurrent
          ? addHeartLiveModifierForSourceMember(draw.gameState, {
              playerId: ability.controllerId,
              sourceCardId: ability.sourceCardId,
              abilityId: ABILITY,
              hearts: [{ color: HeartColor.RED, count: 3 }],
            })
          : null;
      const state = bonus?.gameState ?? draw.gameState;
      return context.continuePendingCardEffects(
        addAction(
          {
            ...state,
            pendingAbilities: state.pendingAbilities.filter((pending) => pending.id !== ability.id),
          },
          'RESOLVE_ABILITY',
          ability.controllerId,
          {
            pendingAbilityId: ability.id,
            abilityId: ABILITY,
            sourceCardId: ability.sourceCardId,
            step: 'OPPONENT_DRAW_TWO_GAIN_RED_HEARTS',
            opponentId: opponent.id,
            drawnCount: draw.drawnCardIds.length,
            redHeartBonus: bonus ? 3 : 0,
          }
        ),
        options.orderedResolution === true
      );
    }
  );
}
