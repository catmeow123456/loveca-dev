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
import {
  getAbilityEffectText,
  registerManualConfirmablePendingAbilityStarterHandler,
} from '../../runtime/workflow-helpers.js';

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
  registerManualConfirmablePendingAbilityStarterHandler(
    N_BP5_015_LIVE_START_ALL_SIX_STAGE_HEARTS_GAIN_TWO_BLADE_ABILITY_ID,
    (game, ability, options, context) =>
      resolveNBp5015ShizukuLiveStart(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      ),
    getNBp5015ConfirmationConfig
  );
}

function getNBp5015ConfirmationConfig(
  game: GameState,
  ability: PendingAbilityState
): { readonly effectText: string } {
  const context = getNBp5015LiveStartContext(game, ability);
  return {
    effectText: `${getAbilityEffectText(ability.abilityId)}（当前舞台Heart颜色 ${context.stageHeartColors.length}/6种，${context.conditionMet ? '满足条件' : '未满足条件'}）`,
  };
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
  const { sourceOnStage, stageHeartColors, conditionMet } = getNBp5015LiveStartContext(
    stateWithoutPending,
    ability
  );
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

function getNBp5015LiveStartContext(
  game: GameState,
  ability: PendingAbilityState
): {
  readonly sourceOnStage: boolean;
  readonly stageHeartColors: readonly HeartColor[];
  readonly conditionMet: boolean;
} {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return { sourceOnStage: false, stageHeartColors: [], conditionMet: false };
  }

  const stageMemberCardIds = getAllMemberCardIds(player.memberSlots);
  const sourceOnStage = stageMemberCardIds.includes(ability.sourceCardId);
  const stageHeartColors = sourceOnStage
    ? getStageMemberEffectiveHeartColors(game, player.id, stageMemberCardIds)
    : [];
  return {
    sourceOnStage,
    stageHeartColors,
    conditionMet:
      sourceOnStage &&
      REQUIRED_STAGE_HEART_COLORS.every((color) => stageHeartColors.includes(color)),
  };
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
