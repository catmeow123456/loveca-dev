import { addAction, getPlayerById, type GameState } from '../../../../domain/entities/game.js';
import { addHeartLiveModifierForSourceMember } from '../../../../domain/rules/live-modifiers.js';
import { HeartColor, OrientationState } from '../../../../shared/types/enums.js';
import { setMemberOrientation } from '../../../effects/member-state.js';
import { PL_PB2_028_LIVE_START_WAIT_SELF_GAIN_YELLOW_HEART_ABILITY_ID as ABILITY_ID } from '../../ability-ids.js';
import { queryOptionSelection } from '../../runtime/selection-query.js';
import { startPendingActiveEffect } from '../../runtime/active-effect.js';
import {
  getAbilitySourceLifecycleId,
  getActiveEffectSourceLifecycleId,
  getPendingAbilitySourceLifecycleId,
} from '../../runtime/ability-source-lifecycle.js';
import {
  enqueueMemberStateChangedTriggersFromOrientationResult,
  type EnqueueTriggeredCardEffectsForMemberStateChanged,
} from '../../runtime/member-state-changed-triggers.js';
import { getSourceMemberSlot } from '../../runtime/source-member.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import {
  getAbilityEffectText,
  maybeStartConfirmablePendingAbilityConfirmation,
} from '../../runtime/workflow-helpers.js';

const STEP_ID = 'PL_PB2_028_WAIT_SELF_COST';
const OPTION_ID = 'WAIT_SOURCE';

export function registerPlPb2028HonokaWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForMemberStateChanged;
}): void {
  registerPendingAbilityStarterHandler(ABILITY_ID, (game, ability, options, context) => {
    const lifecycle = getPendingAbilitySourceLifecycleId(game, ability);
    if (!canPay(game, ability.controllerId, ability.sourceCardId, lifecycle)) {
      const confirmation = maybeStartConfirmablePendingAbilityConfirmation(game, ability, options, {
        stepText: '无法将此成员变为待机状态，确认后不处理。',
      });
      if (confirmation) return confirmation;
      return context.continuePendingCardEffects(
        addAction(
          {
            ...game,
            pendingAbilities: game.pendingAbilities.filter(
              (candidate) => candidate.id !== ability.id
            ),
          },
          'RESOLVE_ABILITY',
          ability.controllerId,
          {
            pendingAbilityId: ability.id,
            abilityId: ability.abilityId,
            sourceCardId: ability.sourceCardId,
            step: 'CANNOT_PAY_WAIT_SELF_COST',
          }
        ),
        options.orderedResolution === true
      );
    }
    return startPendingActiveEffect(game, {
      ability,
      playerId: ability.controllerId,
      activeEffect: {
        id: ability.id,
        abilityId: ability.abilityId,
        sourceCardId: ability.sourceCardId,
        sourceLifecycleId: lifecycle,
        controllerId: ability.controllerId,
        awaitingPlayerId: ability.controllerId,
        effectText: getAbilityEffectText(ABILITY_ID),
        stepId: STEP_ID,
        stepText: '可以将此成员变为待机状态。',
        selectableOptions: [{ id: OPTION_ID, label: '发动' }],
        canSkipSelection: true,
        skipSelectionLabel: '不发动',
        metadata: { orderedResolution: options.orderedResolution === true },
      },
      actionPayload: { sourceCardId: ability.sourceCardId, step: 'START_OPTIONAL_WAIT_SELF_COST' },
    });
  });
  registerActiveEffectStepHandler(
    ABILITY_ID,
    STEP_ID,
    (game, input, context) => {
      const effect = game.activeEffect;
      if (!effect || effect.abilityId !== ABILITY_ID) return game;
      const option = input.selectedOptionId ?? null;
      if (option !== null && option !== OPTION_ID) return game;
      const finish = (state: GameState, step: string) =>
        context.continuePendingCardEffects(
          addAction({ ...state, activeEffect: null }, 'RESOLVE_ABILITY', effect.controllerId, {
            pendingAbilityId: effect.id,
            abilityId: effect.abilityId,
            sourceCardId: effect.sourceCardId,
            step,
          }),
          effect.metadata?.orderedResolution === true
        );
      if (option === null) return finish(game, 'DECLINE_WAIT_SELF_COST');
      if (
        !canPay(
          game,
          effect.controllerId,
          effect.sourceCardId,
          getActiveEffectSourceLifecycleId(game, effect)
        )
      )
        return finish(game, 'CANNOT_PAY_WAIT_SELF_COST');
      const result = setMemberOrientation(
        game,
        effect.controllerId,
        effect.sourceCardId,
        OrientationState.WAITING,
        {
          kind: 'CARD_EFFECT',
          playerId: effect.controllerId,
          sourceCardId: effect.sourceCardId,
          abilityId: effect.abilityId,
          pendingAbilityId: effect.id,
        }
      );
      if (!result?.changed) return finish(game, 'CANNOT_PAY_WAIT_SELF_COST');
      const paid = enqueueMemberStateChangedTriggersFromOrientationResult(
        game,
        result,
        deps.enqueueTriggeredCardEffects,
        {
          prepareGameStateBeforeEnqueue: (state) =>
            addAction(state, 'PAY_COST', effect.controllerId, {
              pendingAbilityId: effect.id,
              abilityId: effect.abilityId,
              sourceCardId: effect.sourceCardId,
              waitedMemberCardId: effect.sourceCardId,
            }),
        }
      ).gameState;
      const bonus = addHeartLiveModifierForSourceMember(paid, {
        playerId: effect.controllerId,
        sourceCardId: effect.sourceCardId,
        abilityId: effect.abilityId,
        hearts: [{ color: HeartColor.YELLOW, count: 1 }],
      });
      return finish(bonus?.gameState ?? paid, 'WAIT_SELF_GAIN_YELLOW_HEART');
    },
    queryOptionSelection
  );
}

function canPay(
  game: GameState,
  playerId: string,
  sourceCardId: string,
  lifecycle: string
): boolean {
  return (
    getSourceMemberSlot(game, playerId, sourceCardId) !== null &&
    getPlayerById(game, playerId)?.memberSlots.cardStates.get(sourceCardId)?.orientation ===
      OrientationState.ACTIVE &&
    getAbilitySourceLifecycleId(game, ABILITY_ID, sourceCardId) === lifecycle
  );
}
