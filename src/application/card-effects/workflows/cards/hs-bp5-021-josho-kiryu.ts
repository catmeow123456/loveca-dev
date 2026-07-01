import {
  addAction,
  getPlayerById,
  type GameState,
  type LiveModifierState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { replaceLiveModifier } from '../../../../domain/rules/live-modifiers.js';
import { CardType, HeartColor } from '../../../../shared/types/enums.js';
import { and, groupAliasIs, typeIs, unitAliasIs } from '../../../effects/card-selectors.js';
import { getStageMemberCardIdsMatching } from '../../../effects/stage-targets.js';
import {
  HS_BP5_021_LIVE_START_TARGET_HASUNOSORA_MEMBER_ORIGINAL_HEART_PINK_ABILITY_ID,
  HS_BP5_021_LIVE_START_THREE_MIRACRA_STAGE_MEMBERS_SCORE_ABILITY_ID,
} from '../../ability-ids.js';
import { startPendingActiveEffect } from '../../runtime/active-effect.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import {
  getAbilityEffectText,
  registerManualConfirmablePendingAbilityStarterHandler,
} from '../../runtime/workflow-helpers.js';

const SELECT_HASUNOSORA_MEMBER_STEP_ID = 'HS_BP5_021_SELECT_HASUNOSORA_MEMBER_ORIGINAL_HEART_PINK';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

const hasunosoraMember = and(typeIs(CardType.MEMBER), groupAliasIs('蓮ノ空'));
const miraCraMember = and(typeIs(CardType.MEMBER), unitAliasIs('Mira-Cra Park!'));

export function registerHsBp5021JoshoKiryuWorkflowHandlers(): void {
  registerPendingAbilityStarterHandler(
    HS_BP5_021_LIVE_START_TARGET_HASUNOSORA_MEMBER_ORIGINAL_HEART_PINK_ABILITY_ID,
    (game, ability, options, context) =>
      startTargetHasunosoraMemberOriginalHeartPink(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      )
  );
  registerActiveEffectStepHandler(
    HS_BP5_021_LIVE_START_TARGET_HASUNOSORA_MEMBER_ORIGINAL_HEART_PINK_ABILITY_ID,
    SELECT_HASUNOSORA_MEMBER_STEP_ID,
    (game, input, context) =>
      finishTargetHasunosoraMemberOriginalHeartPink(
        game,
        input.selectedCardId ?? null,
        context.continuePendingCardEffects
      )
  );
  registerManualConfirmablePendingAbilityStarterHandler(
    HS_BP5_021_LIVE_START_THREE_MIRACRA_STAGE_MEMBERS_SCORE_ABILITY_ID,
    (game, ability, options, context) =>
      resolveThreeMiraCraStageMembersScore(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      ),
    getThreeMiraCraStageMembersScoreConfirmationConfig
  );
}

function getThreeMiraCraStageMembersScoreConfirmationConfig(
  game: GameState,
  ability: PendingAbilityState
): { readonly effectText: string } {
  const miraCraMemberIds = getStageMemberCardIdsMatching(game, ability.controllerId, miraCraMember);
  const conditionMet = miraCraMemberIds.length >= 3;
  return {
    effectText: `${getAbilityEffectText(ability.abilityId)}（舞台みらくらぱーく！成员 ${miraCraMemberIds.length}名，${conditionMet ? '满足条件，分数+1' : '未满足条件，不增加分数'}）`,
  };
}

function startTargetHasunosoraMemberOriginalHeartPink(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  const selectableCardIds = getStageMemberCardIdsMatching(game, player.id, hasunosoraMember);
  if (selectableCardIds.length === 0) {
    return resolveAndContinue(
      game,
      ability,
      player.id,
      orderedResolution,
      continuePendingCardEffects,
      {
        sourceCardId: ability.sourceCardId,
        step: 'NO_HASUNOSORA_STAGE_MEMBER_TARGET',
        targetMemberCardIds: [],
        reason: 'NO_HASUNOSORA_STAGE_MEMBER_TARGET',
      }
    );
  }

  return startPendingActiveEffect(game, {
    ability,
    playerId: player.id,
    activeEffect: {
      id: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      controllerId: ability.controllerId,
      effectText: getAbilityEffectText(ability.abilityId),
      stepId: SELECT_HASUNOSORA_MEMBER_STEP_ID,
      stepText: '请选择1名自己舞台上的「莲之空」成员。',
      awaitingPlayerId: player.id,
      selectableCardIds,
      selectableCardVisibility: 'PUBLIC',
      canSkipSelection: false,
      metadata: {
        orderedResolution,
      },
    },
    actionPayload: {
      sourceCardId: ability.sourceCardId,
      step: 'START_SELECT_HASUNOSORA_STAGE_MEMBER',
      selectableCardIds,
    },
  });
}

function finishTargetHasunosoraMemberOriginalHeartPink(
  game: GameState,
  selectedCardId: string | null,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  if (!effect || effect.stepId !== SELECT_HASUNOSORA_MEMBER_STEP_ID) {
    return game;
  }
  const player = getPlayerById(game, effect.controllerId);
  if (!player || !selectedCardId) {
    return game;
  }

  const selectableCardIds = getStageMemberCardIdsMatching(game, player.id, hasunosoraMember);
  if (!selectableCardIds.includes(selectedCardId)) {
    return game;
  }

  const replacementModifier: LiveModifierState = {
    kind: 'MEMBER_ORIGINAL_HEART_REPLACEMENT',
    playerId: player.id,
    memberCardId: selectedCardId,
    color: HeartColor.PINK,
    sourceCardId: effect.sourceCardId,
    abilityId: effect.abilityId,
  };
  const state = replaceLiveModifier(
    { ...game, activeEffect: null },
    {
      kind: 'MEMBER_ORIGINAL_HEART_REPLACEMENT',
      playerId: player.id,
      sourceCardId: effect.sourceCardId,
      abilityId: effect.abilityId,
    },
    replacementModifier
  );

  return continuePendingCardEffects(
    addAction(state, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'APPLY_TARGET_ORIGINAL_HEART_PINK_REPLACEMENT',
      targetMemberCardId: selectedCardId,
      heartColor: HeartColor.PINK,
    }),
    effect.metadata?.orderedResolution === true
  );
}

function resolveThreeMiraCraStageMembersScore(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  const miraCraMemberIds = getStageMemberCardIdsMatching(game, player.id, miraCraMember);
  const conditionMet = miraCraMemberIds.length >= 3;
  const scoreModifier: LiveModifierState | null = conditionMet
    ? {
        kind: 'SCORE',
        playerId: player.id,
        liveCardId: ability.sourceCardId,
        countDelta: 1,
        sourceCardId: ability.sourceCardId,
        abilityId: ability.abilityId,
      }
    : null;
  const state = replaceLiveModifier(
    game,
    {
      kind: 'SCORE',
      playerId: player.id,
      liveCardId: ability.sourceCardId,
      sourceCardId: ability.sourceCardId,
      abilityId: ability.abilityId,
    },
    scoreModifier
  );

  return resolveAndContinue(
    state,
    ability,
    player.id,
    orderedResolution,
    continuePendingCardEffects,
    {
      sourceCardId: ability.sourceCardId,
      step: conditionMet
        ? 'APPLY_THREE_MIRACRA_STAGE_MEMBERS_SCORE'
        : 'NO_THREE_MIRACRA_STAGE_MEMBERS',
      conditionMet,
      miraCraStageMemberIds: miraCraMemberIds,
      miraCraStageMemberCount: miraCraMemberIds.length,
      scoreBonus: conditionMet ? 1 : 0,
      liveCardId: ability.sourceCardId,
    }
  );
}

function resolveAndContinue(
  game: GameState,
  ability: PendingAbilityState,
  playerId: string,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects,
  payload: Record<string, unknown>
): GameState {
  const state = {
    ...game,
    pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
  };
  return continuePendingCardEffects(
    addAction(state, 'RESOLVE_ABILITY', playerId, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      ...payload,
    }),
    orderedResolution
  );
}
