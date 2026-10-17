import {
  addAction,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { addHeartLiveModifierForSourceMember } from '../../../../domain/rules/live-modifiers.js';
import { CardType, HeartColor, SlotPosition } from '../../../../shared/types/enums.js';
import { typeIs } from '../../../effects/card-selectors.js';
import {
  getStageMemberCardIdsMatching,
  memberHasEnergyBelow,
} from '../../../effects/stage-targets.js';
import { N_BP5_013_LIVE_START_ENERGY_BELOW_MEMBER_GAIN_PINK_HEART_ABILITY_ID } from '../../ability-ids.js';
import { getSourceMemberSlot } from '../../runtime/source-member.js';
import {
  getAbilityEffectText,
  registerManualConfirmablePendingAbilityStarterHandler,
} from '../../runtime/workflow-helpers.js';
import type { PendingAbilityStarterOptions } from '../../runtime/starter-registry.js';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerNBp5013AyumuWorkflowHandlers(): void {
  registerManualConfirmablePendingAbilityStarterHandler(
    N_BP5_013_LIVE_START_ENERGY_BELOW_MEMBER_GAIN_PINK_HEART_ABILITY_ID,
    (game, ability, options, context) =>
      resolveAyumuEnergyBelowLiveStart(game, ability, options, context.continuePendingCardEffects),
    getAyumuConfirmationConfig
  );
}

function getAyumuConfirmationConfig(
  game: GameState,
  ability: PendingAbilityState
): {
  readonly effectText: string;
  readonly stepText: string;
} {
  const condition = evaluateAyumuCondition(game, ability);
  const previewText = getAyumuPreviewText(condition);
  return {
    effectText: `${getAbilityEffectText(ability.abilityId)}（${previewText}）`,
    stepText: previewText,
  };
}

function resolveAyumuEnergyBelowLiveStart(
  game: GameState,
  ability: PendingAbilityState,
  options: PendingAbilityStarterOptions,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  const condition = evaluateAyumuCondition(game, ability);
  let state: GameState = {
    ...game,
    pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
  };

  if (condition.willGainHeart) {
    const heartResult = addHeartLiveModifierForSourceMember(state, {
      playerId: player.id,
      sourceCardId: ability.sourceCardId,
      abilityId: ability.abilityId,
      hearts: [{ color: HeartColor.PINK, count: 1 }],
    });
    if (!heartResult) {
      return game;
    }
    state = heartResult.gameState;
  }

  return continuePendingCardEffects(
    addAction(state, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      sourceSlot: condition.sourceSlot,
      step: condition.willGainHeart
        ? 'ENERGY_BELOW_MEMBER_GAIN_PINK_HEART'
        : condition.sourceOnStage
          ? 'NO_ENERGY_BELOW_MEMBER'
          : 'SOURCE_NOT_ON_STAGE',
      hasEnergyBelowMember: condition.hasEnergyBelowMember,
      energyBelowMemberSlots: condition.energyBelowMemberSlots,
      gainedPinkHeart: condition.willGainHeart,
    }),
    options.orderedResolution === true
  );
}

function evaluateAyumuCondition(
  game: GameState,
  ability: Pick<PendingAbilityState, 'controllerId' | 'sourceCardId'>
): {
  readonly sourceSlot: SlotPosition | null;
  readonly sourceOnStage: boolean;
  readonly hasEnergyBelowMember: boolean;
  readonly energyBelowMemberSlots: readonly SlotPosition[];
  readonly willGainHeart: boolean;
} {
  const player = getPlayerById(game, ability.controllerId);
  const sourceSlot = player ? getSourceMemberSlot(game, player.id, ability.sourceCardId) : null;
  const energyBelowMemberSlots = getStageMemberCardIdsMatching(
    game,
    ability.controllerId,
    typeIs(CardType.MEMBER),
    memberHasEnergyBelow
  ).flatMap((cardId) => {
    const slot = getSourceMemberSlot(game, ability.controllerId, cardId);
    return slot === null ? [] : [slot];
  });
  const hasEnergyBelowMember = energyBelowMemberSlots.length > 0;
  const sourceOnStage = sourceSlot !== null;
  return {
    sourceSlot,
    sourceOnStage,
    hasEnergyBelowMember,
    energyBelowMemberSlots,
    willGainHeart: sourceOnStage && hasEnergyBelowMember,
  };
}

function getAyumuPreviewText(condition: ReturnType<typeof evaluateAyumuCondition>): string {
  if (!condition.sourceOnStage) {
    return '此成员已不在舞台，不获得[桃ハート]。';
  }
  if (!condition.hasEnergyBelowMember) {
    return '自己的舞台没有下方放有能量卡的成员，条件不满足，不获得[桃ハート]。';
  }
  return '当前自己的舞台有下方放有能量卡的成员。此成员获得[桃ハート]。';
}
