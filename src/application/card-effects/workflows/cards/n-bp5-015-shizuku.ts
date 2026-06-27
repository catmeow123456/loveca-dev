import {
  addAction,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { getAllMemberCardIds } from '../../../../domain/entities/zone.js';
import {
  collectLiveModifiers,
  getMemberEffectiveHeartIcons,
} from '../../../../domain/rules/live-modifiers.js';
import { HeartColor } from '../../../../shared/types/enums.js';
import { N_BP5_015_LIVE_START_ALL_SIX_STAGE_HEARTS_GAIN_TWO_BLADE_ABILITY_ID } from '../../ability-ids.js';
import { addBladeLiveModifierForSourceMember } from '../../runtime/actions.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

const REQUIRED_STAGE_HEART_COLORS: readonly HeartColor[] = [
  HeartColor.PINK,
  HeartColor.RED,
  HeartColor.YELLOW,
  HeartColor.GREEN,
  HeartColor.BLUE,
  HeartColor.PURPLE,
];

export function registerNBp5015ShizukuWorkflowHandlers(): void {
  registerPendingAbilityStarterHandler(
    N_BP5_015_LIVE_START_ALL_SIX_STAGE_HEARTS_GAIN_TWO_BLADE_ABILITY_ID,
    (game, ability, options, context) =>
      resolveNBp5015ShizukuLiveStart(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      )
  );
}

function resolveNBp5015ShizukuLiveStart(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  const stateWithoutPending: GameState = {
    ...game,
    pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
  };
  const stageMemberCardIds = getAllMemberCardIds(player.memberSlots);
  const sourceOnStage = stageMemberCardIds.includes(ability.sourceCardId);
  const stageHeartColors = sourceOnStage
    ? getStageMemberEffectiveHeartColors(stateWithoutPending, player.id, stageMemberCardIds)
    : [];
  const conditionMet =
    sourceOnStage && REQUIRED_STAGE_HEART_COLORS.every((color) => stageHeartColors.includes(color));
  const bladeResult = conditionMet
    ? addBladeLiveModifierForSourceMember(stateWithoutPending, {
        playerId: player.id,
        sourceCardId: ability.sourceCardId,
        abilityId: ability.abilityId,
        amount: 2,
      })
    : null;
  const stateAfterModifier = bladeResult?.gameState ?? stateWithoutPending;

  return continuePendingCardEffects(
    addAction(stateAfterModifier, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: 'ALL_SIX_STAGE_HEARTS_GAIN_TWO_BLADE',
      sourceSlot: ability.sourceSlot,
      sourceOnStage,
      conditionMet,
      stageHeartColors,
      requiredStageHeartColors: REQUIRED_STAGE_HEART_COLORS,
      bladeBonus: bladeResult?.bladeBonus ?? 0,
    }),
    orderedResolution
  );
}

function getStageMemberEffectiveHeartColors(
  game: GameState,
  playerId: string,
  stageMemberCardIds: readonly string[]
): readonly HeartColor[] {
  const modifiers = collectLiveModifiers(game);
  const colors = new Set<HeartColor>();
  for (const memberCardId of stageMemberCardIds) {
    for (const heart of getMemberEffectiveHeartIcons(game, playerId, memberCardId, modifiers)) {
      if (REQUIRED_STAGE_HEART_COLORS.includes(heart.color)) {
        colors.add(heart.color);
      }
    }
  }
  return REQUIRED_STAGE_HEART_COLORS.filter((color) => colors.has(color));
}
