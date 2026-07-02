import { isMemberCardData } from '../../../../domain/entities/card.js';
import {
  addAction,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { cardBelongsToGroup } from '../../../../shared/utils/card-identity.js';
import { getPositionMovedStageMemberIdsMatching } from '../../../effects/conditions.js';
import { SP_SD2_025_LIVE_START_MOVED_LIELLA_MEMBERS_GAIN_BLADE_ABILITY_ID } from '../../ability-ids.js';
import { addBladeLiveModifierForSourceMember } from '../../runtime/actions.js';
import {
  getAbilityEffectText,
  registerManualConfirmablePendingAbilityStarterHandler,
} from '../../runtime/workflow-helpers.js';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerSpSd2025AspireWorkflowHandlers(): void {
  registerManualConfirmablePendingAbilityStarterHandler(
    SP_SD2_025_LIVE_START_MOVED_LIELLA_MEMBERS_GAIN_BLADE_ABILITY_ID,
    (game, ability, options, context) =>
      resolveSpSd2025AspireLiveStart(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      ),
    getSpSd2025AspireConfirmationConfig
  );
}

function getSpSd2025AspireConfirmationConfig(
  game: GameState,
  ability: PendingAbilityState
): { readonly effectText: string } {
  const targetMemberCardIds = getMovedLiellaStageMemberIds(game, ability.controllerId);
  return {
    effectText: `${getAbilityEffectText(ability.abilityId)}（本回合移动过的Liella!成员 ${targetMemberCardIds.length}名，各获得[BLADE]+1）`,
  };
}

function resolveSpSd2025AspireLiveStart(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  const targetMemberCardIds = getMovedLiellaStageMemberIds(game, player.id);
  let state: GameState = {
    ...game,
    pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
  };
  const appliedTargetMemberCardIds: string[] = [];

  for (const targetMemberCardId of targetMemberCardIds) {
    const bladeResult = addBladeLiveModifierForSourceMember(state, {
      playerId: player.id,
      sourceCardId: targetMemberCardId,
      abilityId: ability.abilityId,
      amount: 1,
    });
    if (!bladeResult) {
      continue;
    }
    state = bladeResult.gameState;
    appliedTargetMemberCardIds.push(targetMemberCardId);
  }

  return continuePendingCardEffects(
    addAction(state, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: 'MOVED_LIELLA_MEMBERS_GAIN_BLADE',
      targetMemberCardIds,
      appliedTargetMemberCardIds,
      bladeBonusPerMember: 1,
      targetCount: targetMemberCardIds.length,
    }),
    orderedResolution
  );
}

function getMovedLiellaStageMemberIds(game: GameState, playerId: string): readonly string[] {
  return getPositionMovedStageMemberIdsMatching(game, playerId, (card) => {
    return isMemberCardData(card.data) && cardBelongsToGroup(card.data, 'Liella!');
  });
}
