import {
  addAction,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { CardType } from '../../../../shared/types/enums.js';
import {
  and,
  groupAliasIs,
  typeIs,
  unitAliasIs,
  type CardSelector,
} from '../../../effects/card-selectors.js';
import { selectWaitingRoomCardIds } from '../../../effects/zone-selection.js';
import {
  HS_BP2_007_ON_ENTER_LOWER_COST_CERISE_RELAY_RECOVER_HASUNOSORA_LIVE_ABILITY_ID,
  HS_BP8_011_ON_ENTER_LOWER_COST_RELAY_RECOVER_MIRACRA_LIVE_ABILITY_ID,
} from '../../ability-ids.js';
import { getPendingAbilitySourceLifecycleId } from '../../runtime/ability-source-lifecycle.js';
import { queryCardSelection } from '../../runtime/selection-query.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText } from '../../runtime/workflow-helpers.js';
import { evaluateRelayEnterLowerCostUnitCondition } from './relay-enter-lower-cost-unit.js';
import {
  finishWaitingRoomToHandWorkflow,
  startWaitingRoomToHandWorkflow,
} from './waiting-room-to-hand.js';

interface Config {
  readonly abilityId: string;
  readonly stepId: string;
  readonly replacementUnitAlias?: string;
  readonly recoverySelector: CardSelector;
  readonly recoveryLabel: string;
}
const CONFIGS: readonly Config[] = [
  {
    abilityId: HS_BP2_007_ON_ENTER_LOWER_COST_CERISE_RELAY_RECOVER_HASUNOSORA_LIVE_ABILITY_ID,
    stepId: 'HS_BP2_007_SELECT_WAITING_ROOM_LIVE',
    replacementUnitAlias: 'Cerise Bouquet',
    recoverySelector: and(typeIs(CardType.LIVE), groupAliasIs('蓮ノ空')),
    recoveryLabel: '莲之空',
  },
  {
    abilityId: HS_BP8_011_ON_ENTER_LOWER_COST_RELAY_RECOVER_MIRACRA_LIVE_ABILITY_ID,
    stepId: 'HS_BP8_011_SELECT_WAITING_ROOM_MIRACRA_LIVE',
    recoverySelector: and(typeIs(CardType.LIVE), unitAliasIs('Mira-Cra Park!')),
    recoveryLabel: 'Mira-Cra Park!',
  },
];

export function registerRelayEnterLowerCostRecoverLiveWorkflowHandlers(): void {
  for (const config of CONFIGS) {
    const candidates = (game: GameState, playerId: string) =>
      selectWaitingRoomCardIds(game, playerId, config.recoverySelector);
    registerPendingAbilityStarterHandler(config.abilityId, (game, ability, options, context) => {
      const sourceLifecycleId = getPendingAbilitySourceLifecycleId(game, ability);
      const condition = evaluateRelayEnterLowerCostUnitCondition(
        game,
        { ...ability, sourceLifecycleId, relayReplacements: ability.metadata?.relayReplacements },
        config.replacementUnitAlias
      );
      const ordered = options.orderedResolution === true;
      const ids = candidates(game, ability.controllerId);
      if (!condition.conditionMet || ids.length === 0)
        return consume(
          game,
          ability,
          !condition.conditionMet ? condition.reason : 'NO_WAITING_ROOM_LIVE_TARGET',
          condition,
          ordered,
          context.continuePendingCardEffects
        );
      const started = startWaitingRoomToHandWorkflow(game, {
        ability,
        effectText: getAbilityEffectText(config.abilityId),
        stepId: config.stepId,
        stepText: `请选择自己的休息室中1张『${config.recoveryLabel}』的LIVE卡加入手牌。`,
        selectionLabel: '选择要加入手牌的LIVE卡',
        confirmSelectionLabel: '加入手牌',
        candidateBuilder: candidates,
        countRule: { exactCount: 1 },
        optional: false,
        orderedResolution: ordered,
      });
      return started.activeEffect
        ? { ...started, activeEffect: { ...started.activeEffect, sourceLifecycleId } }
        : started;
    });
    registerActiveEffectStepHandler(
      config.abilityId,
      config.stepId,
      (game, input, context) =>
        finishWaitingRoomToHandWorkflow(
          game,
          input.selectedCardId ?? null,
          input.selectedCardIds,
          context.continuePendingCardEffects,
          { currentCandidateCardIds: candidates(game, game.activeEffect!.controllerId) }
        ),
      queryCardSelection
    );
  }
}

function consume(
  game: GameState,
  ability: PendingAbilityState,
  reason: string,
  condition: object,
  ordered: boolean,
  next: (game: GameState, ordered: boolean) => GameState
): GameState {
  return next(
    addAction(
      {
        ...game,
        pendingAbilities: game.pendingAbilities.filter((entry) => entry.id !== ability.id),
      },
      'RESOLVE_ABILITY',
      ability.controllerId,
      {
        pendingAbilityId: ability.id,
        abilityId: ability.abilityId,
        sourceCardId: ability.sourceCardId,
        step:
          reason === 'SOURCE_INFORMATION_UNAVAILABLE' ? 'SOURCE_INFORMATION_UNAVAILABLE' : 'NO_OP',
        ...condition,
        reason,
      }
    ),
    ordered
  );
}
