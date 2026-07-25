import {
  addAction,
  getPlayerById,
  type GameState,
  type LiveModifierState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { replaceLiveModifier } from '../../../../domain/rules/live-modifiers.js';
import { CardType } from '../../../../shared/types/enums.js';
import { and, typeIs, unitAliasIs } from '../../../effects/card-selectors.js';
import { getStageMemberCardIdsMatching } from '../../../effects/stage-targets.js';
import { HS_BP5_021_LIVE_START_THREE_MIRACRA_STAGE_MEMBERS_SCORE_ABILITY_ID } from '../../ability-ids.js';
import {
  getAbilityEffectText,
  registerManualConfirmablePendingAbilityStarterHandler,
} from '../../runtime/workflow-helpers.js';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

const miraCraMember = and(typeIs(CardType.MEMBER), unitAliasIs('Mira-Cra Park!'));

export function registerHsBp5021JoshoKiryuWorkflowHandlers(): void {
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
