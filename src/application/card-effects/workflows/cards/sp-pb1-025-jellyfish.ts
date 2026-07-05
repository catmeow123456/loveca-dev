import {
  addAction,
  getPlayerById,
  type GameState,
  type LiveModifierState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { replaceLiveModifier } from '../../../../domain/rules/live-modifiers.js';
import { CardType, HeartColor } from '../../../../shared/types/enums.js';
import { and, typeIs, unitAliasIs } from '../../../effects/card-selectors.js';
import { getMovedToStageOrPositionMovedStageMemberIdsMatching } from '../../../effects/conditions.js';
import { SP_PB1_025_LIVE_START_ENTERED_OR_MOVED_FIVEYNCRISE_REQUIREMENT_ABILITY_ID } from '../../ability-ids.js';
import {
  getAbilityEffectText,
  registerManualConfirmablePendingAbilityStarterHandler,
} from '../../runtime/workflow-helpers.js';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerSpPb1025JellyfishWorkflowHandlers(): void {
  registerManualConfirmablePendingAbilityStarterHandler(
    SP_PB1_025_LIVE_START_ENTERED_OR_MOVED_FIVEYNCRISE_REQUIREMENT_ABILITY_ID,
    (game, ability, options, context) =>
      resolveSpPb1025JellyfishLiveStart(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      ),
    (game, ability) => {
      const player = getPlayerById(game, ability.controllerId);
      if (!player) {
        return {};
      }
      const matchedMemberIds = getEnteredOrMovedFiveyncriseStageMemberIds(game, player.id);
      const reduction = matchedMemberIds.length;
      const effectText = `${getAbilityEffectText(ability.abilityId)}（当前${matchedMemberIds.length}名，减少${reduction}个[無ハート]）`;
      return {
        effectText,
        stepText: effectText,
      };
    }
  );
}

function resolveSpPb1025JellyfishLiveStart(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  const matchedMemberIds = getEnteredOrMovedFiveyncriseStageMemberIds(game, player.id);
  const reduction = matchedMemberIds.length;
  const stateWithModifier = replaceSourceRequirementModifier(
    {
      ...game,
      activeEffect: null,
    },
    ability,
    reduction > 0
      ? {
          kind: 'REQUIREMENT',
          liveCardId: ability.sourceCardId,
          modifiers: [{ color: HeartColor.RAINBOW, countDelta: -reduction }],
          sourceCardId: ability.sourceCardId,
          abilityId: ability.abilityId,
        }
      : null
  );
  const stateWithoutPending: GameState = {
    ...stateWithModifier,
    pendingAbilities: stateWithModifier.pendingAbilities.filter(
      (candidate) => candidate.id !== ability.id
    ),
  };

  return continuePendingCardEffects(
    addAction(stateWithoutPending, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: 'APPLY_ENTERED_OR_MOVED_FIVEYNCRISE_REQUIREMENT_REDUCTION',
      matchedMemberIds,
      requirementReduction: reduction,
      requirementReductionColor: HeartColor.RAINBOW,
    }),
    orderedResolution
  );
}

function getEnteredOrMovedFiveyncriseStageMemberIds(
  game: GameState,
  playerId: string
): readonly string[] {
  return getMovedToStageOrPositionMovedStageMemberIdsMatching(
    game,
    playerId,
    and(typeIs(CardType.MEMBER), unitAliasIs('5yncri5e!'))
  );
}

function replaceSourceRequirementModifier(
  game: GameState,
  effect: PendingAbilityState,
  replacement: LiveModifierState | null
): GameState {
  return replaceLiveModifier(
    game,
    {
      kind: 'REQUIREMENT',
      liveCardId: effect.sourceCardId,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
    },
    replacement
  );
}
