import {
  addAction,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { addLiveModifier } from '../../../../domain/rules/live-modifiers.js';
import { CardType } from '../../../../shared/types/enums.js';
import { selectCurrentLiveRevealedCheerCardIds } from '../../../effects/cheer-selection.js';
import { HS_BP1_022_LIVE_SUCCESS_CHEER_HASUNOSORA_MEMBER_SCORE_ABILITY_ID } from '../../ability-ids.js';
import { startConfirmOnlyPendingAbilityEffect } from '../../runtime/active-effect.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { getAbilityEffectText } from '../../runtime/workflow-helpers.js';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerHsBp1022AwokeWorkflowHandlers(): void {
  registerPendingAbilityStarterHandler(
    HS_BP1_022_LIVE_SUCCESS_CHEER_HASUNOSORA_MEMBER_SCORE_ABILITY_ID,
    (game, ability, options, context) =>
      startHsBp1022AwokeLiveSuccess(
        game,
        ability,
        {
          orderedResolution: options.orderedResolution === true,
          manualConfirmation: options.manualConfirmation === true,
          skipManualConfirmation: options.skipManualConfirmation === true,
        },
        context.continuePendingCardEffects
      )
  );
}

function startHsBp1022AwokeLiveSuccess(
  game: GameState,
  ability: PendingAbilityState,
  options: {
    readonly orderedResolution: boolean;
    readonly manualConfirmation: boolean;
    readonly skipManualConfirmation: boolean;
  },
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  if (options.manualConfirmation && !options.skipManualConfirmation) {
    const hasunosoraCheerMemberCardIds = getOwnCheerRevealedHasunosoraMemberCardIds(
      game,
      player.id
    );
    const conditionMet = hasunosoraCheerMemberCardIds.length >= 10;
    return startConfirmOnlyPendingAbilityEffect(game, {
      ability,
      effectText: getAbilityEffectText(
        HS_BP1_022_LIVE_SUCCESS_CHEER_HASUNOSORA_MEMBER_SCORE_ABILITY_ID
      ),
      orderedResolution: options.orderedResolution,
      stepText: conditionMet
        ? `声援公开的自己『莲之空』成员卡 ${hasunosoraCheerMemberCardIds.length} 张，条件满足。确认后此 LIVE 分数 +1。`
        : `声援公开的自己『莲之空』成员卡 ${hasunosoraCheerMemberCardIds.length} 张，条件不满足。确认后不增加分数。`,
    });
  }

  return resolveHsBp1022AwokeLiveSuccess(
    game,
    ability,
    options.orderedResolution,
    continuePendingCardEffects
  );
}

function resolveHsBp1022AwokeLiveSuccess(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  const hasunosoraCheerMemberCardIds = getOwnCheerRevealedHasunosoraMemberCardIds(
    game,
    player.id
  );
  const conditionMet = hasunosoraCheerMemberCardIds.length >= 10;
  const scoreBonus = conditionMet ? 1 : 0;
  const stateAfterModifier = conditionMet
    ? addLiveModifier(game, {
        kind: 'SCORE',
        playerId: player.id,
        countDelta: scoreBonus,
        liveCardId: ability.sourceCardId,
        sourceCardId: ability.sourceCardId,
        abilityId: ability.abilityId,
      })
    : game;
  const stateAfterScoreRefresh = conditionMet
    ? refreshPlayerScoreDraft(stateAfterModifier, player.id, scoreBonus)
    : stateAfterModifier;
  const state: GameState = {
    ...stateAfterScoreRefresh,
    pendingAbilities: stateAfterScoreRefresh.pendingAbilities.filter(
      (candidate) => candidate.id !== ability.id
    ),
  };

  return continuePendingCardEffects(
    addAction(state, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: 'LIVE_SUCCESS_CHEER_HASUNOSORA_MEMBER_SCORE',
      hasunosoraCheerMemberCardIds,
      hasunosoraCheerMemberCount: hasunosoraCheerMemberCardIds.length,
      conditionMet,
      scoreBonus,
    }),
    orderedResolution
  );
}

function getOwnCheerRevealedHasunosoraMemberCardIds(
  game: GameState,
  playerId: string
): readonly string[] {
  return selectCurrentLiveRevealedCheerCardIds(game, playerId, {
    cardTypes: CardType.MEMBER,
    groupAliases: ['蓮ノ空'],
  });
}

function refreshPlayerScoreDraft(
  game: GameState,
  playerId: string,
  scoreBonus: number
): GameState {
  const playerScores = new Map(game.liveResolution.playerScores);
  playerScores.set(playerId, (playerScores.get(playerId) ?? 0) + scoreBonus);
  return {
    ...game,
    liveResolution: {
      ...game.liveResolution,
      playerScores,
    },
  };
}
