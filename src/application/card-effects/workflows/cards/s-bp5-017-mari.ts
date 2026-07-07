import {
  addAction,
  getCardById,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { getAllMemberCardIds } from '../../../../domain/entities/zone.js';
import { isLiveCardData } from '../../../../domain/entities/card.js';
import {
  addHeartLiveModifierForMember,
  getLiveCardRequirementModifiers,
} from '../../../../domain/rules/live-modifiers.js';
import { applyHeartRequirementModifiers } from '../../../../domain/rules/live-requirement-modifiers.js';
import { HeartColor } from '../../../../shared/types/enums.js';
import { S_BP5_017_LIVE_START_BLUE_REQUIREMENT_GAIN_BLUE_HEART_ABILITY_ID } from '../../ability-ids.js';
import {
  getAbilityEffectText,
  registerManualConfirmablePendingAbilityStarterHandler,
} from '../../runtime/workflow-helpers.js';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

interface MariContext {
  readonly sourceOnStage: boolean;
  readonly blueRequirementTotal: number;
  readonly conditionMet: boolean;
}

export function registerSBp5017MariWorkflowHandlers(): void {
  registerManualConfirmablePendingAbilityStarterHandler(
    S_BP5_017_LIVE_START_BLUE_REQUIREMENT_GAIN_BLUE_HEART_ABILITY_ID,
    (game, ability, options, context) =>
      resolveSBp5017MariLiveStart(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      ),
    getSBp5017ConfirmationConfig
  );
}

function getSBp5017ConfirmationConfig(
  game: GameState,
  ability: PendingAbilityState
): { readonly effectText: string } {
  const context = getSBp5017Context(game, ability);
  return {
    effectText: `${getAbilityEffectText(ability.abilityId)}（当前LIVE卡区必要[青ハート]合计${
      context.blueRequirementTotal
    }，${context.blueRequirementTotal >= 4 ? '大于等于4' : '未达到4'}；实际${
      context.conditionMet ? '获得[青ハート]' : '不获得[青ハート]'
    }。）`,
  };
}

function resolveSBp5017MariLiveStart(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const stateWithoutPending: GameState = {
    ...game,
    pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
  };
  const player = getPlayerById(stateWithoutPending, ability.controllerId);
  if (!player) {
    return continuePendingCardEffects(stateWithoutPending, orderedResolution);
  }

  const context = getSBp5017Context(stateWithoutPending, ability);
  const heartResult = context.conditionMet
    ? addHeartLiveModifierForMember(stateWithoutPending, {
        playerId: player.id,
        memberCardId: ability.sourceCardId,
        sourceCardId: ability.sourceCardId,
        abilityId: ability.abilityId,
        hearts: [{ color: HeartColor.BLUE, count: 1 }],
      })
    : null;
  const stateAfterHeart = heartResult?.gameState ?? stateWithoutPending;

  return continuePendingCardEffects(
    addAction(stateAfterHeart, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      sourceOnStage: context.sourceOnStage,
      step: context.conditionMet ? 'BLUE_REQUIREMENT_GAIN_BLUE_HEART' : 'CONDITION_NOT_MET',
      blueRequirementTotal: context.blueRequirementTotal,
      conditionMet: context.conditionMet,
      heartBonus: heartResult?.heartBonus ?? [],
    }),
    orderedResolution
  );
}

function getSBp5017Context(game: GameState, ability: PendingAbilityState): MariContext {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return { sourceOnStage: false, blueRequirementTotal: 0, conditionMet: false };
  }

  const sourceOnStage = getAllMemberCardIds(player.memberSlots).includes(ability.sourceCardId);
  const blueRequirementTotal = player.liveZone.cardIds.reduce((total, liveCardId) => {
    const card = getCardById(game, liveCardId);
    if (!card || !isLiveCardData(card.data)) {
      return total;
    }
    const effectiveRequirement = applyHeartRequirementModifiers(
      card.data.requirements,
      getLiveCardRequirementModifiers(game.liveResolution, liveCardId)
    );
    return total + (effectiveRequirement.colorRequirements.get(HeartColor.BLUE) ?? 0);
  }, 0);

  return {
    sourceOnStage,
    blueRequirementTotal,
    conditionMet: sourceOnStage && blueRequirementTotal >= 4,
  };
}
