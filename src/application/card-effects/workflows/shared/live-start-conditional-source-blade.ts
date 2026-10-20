import {
  addAction,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { addBladeLiveModifierForSourceMember } from '../../runtime/actions.js';
import { getPendingAbilitySourceLifecycleId } from '../../runtime/ability-source-lifecycle.js';
import { isCurrentStageMemberAbilitySource } from '../../runtime/source-member.js';
import {
  getAbilityEffectText,
  registerManualConfirmablePendingAbilityStarterHandler,
} from '../../runtime/workflow-helpers.js';

export interface ConditionalSourceBladeContext {
  readonly conditionMet: boolean;
  readonly conditionText: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

interface ConditionalSourceBladeConfig {
  readonly abilityId: string;
  readonly bladeBonus: number;
  readonly bladeToken?: string;
  readonly actionStep: string;
  readonly getContext: (
    game: GameState,
    ability: PendingAbilityState
  ) => ConditionalSourceBladeContext;
}

/** No cost or target choice: evaluate a condition, grant source BLADE, then resume the timing. */
export function registerLiveStartConditionalSourceBladeWorkflowHandlers(
  configs: readonly ConditionalSourceBladeConfig[]
): void {
  for (const config of configs) {
    registerManualConfirmablePendingAbilityStarterHandler(
      config.abilityId,
      (game, ability, options, runtime) => {
        const context = config.getContext(game, ability);
        const sourceValid = isCurrentStageMemberAbilitySource(game, {
          ...ability,
          sourceLifecycleId: getPendingAbilitySourceLifecycleId(game, ability),
        });
        const state = {
          ...game,
          pendingAbilities: game.pendingAbilities.filter((pending) => pending.id !== ability.id),
        };
        const reward =
          context.conditionMet && sourceValid
            ? addBladeLiveModifierForSourceMember(state, {
                playerId: ability.controllerId,
                sourceCardId: ability.sourceCardId,
                abilityId: ability.abilityId,
                amount: config.bladeBonus,
              })
            : null;
        return runtime.continuePendingCardEffects(
          addAction(reward?.gameState ?? state, 'RESOLVE_ABILITY', ability.controllerId, {
            pendingAbilityId: ability.id,
            abilityId: ability.abilityId,
            sourceCardId: ability.sourceCardId,
            ...context.metadata,
            step: reward ? config.actionStep : 'CONDITION_NOT_MET',
            conditionMet: context.conditionMet && sourceValid,
            bladeBonus: reward?.bladeBonus ?? 0,
          }),
          options.orderedResolution === true
        );
      },
      (game, ability) => {
        const context = config.getContext(game, ability);
        const sourceValid = isCurrentStageMemberAbilitySource(game, {
          ...ability,
          sourceLifecycleId: getPendingAbilitySourceLifecycleId(game, ability),
        });
        const bonus = context.conditionMet && sourceValid ? config.bladeBonus : 0;
        return {
          effectText: `${getAbilityEffectText(ability.abilityId)}（${context.conditionText}；条件${context.conditionMet ? '满足' : '未满足'}；实际获得${bonus > 0 ? (config.bladeToken ?? '[ブレード]').repeat(bonus) : '0个BLADE'}。）`,
        };
      }
    );
  }
}
