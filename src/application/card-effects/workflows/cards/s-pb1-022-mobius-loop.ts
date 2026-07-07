import {
  addAction,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import {
  addSuccessLivePlacementRestrictionUntilLiveEnd,
  getLiveScoreTieState,
} from '../../../../domain/rules/success-live-placement.js';
import { PL_S_PB1_022_LIVE_SUCCESS_TIED_SCORE_PROHIBIT_SUCCESS_ZONE_ABILITY_ID } from '../../ability-ids.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import {
  getAbilityEffectText,
  maybeStartConfirmablePendingAbilityConfirmation,
} from '../../runtime/workflow-helpers.js';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerSPb1022MobiusLoopWorkflowHandlers(): void {
  registerPendingAbilityStarterHandler(
    PL_S_PB1_022_LIVE_SUCCESS_TIED_SCORE_PROHIBIT_SUCCESS_ZONE_ABILITY_ID,
    (game, ability, options, context) => {
      const confirmation = maybeStartConfirmablePendingAbilityConfirmation(game, ability, options, {
        effectText: getMobiusLoopConfirmationEffectText(game, ability),
        stepText: getMobiusLoopConfirmationStepText(game),
      });
      if (confirmation) {
        return confirmation;
      }

      return resolveMobiusLoopSuccessZoneRestriction(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      );
    }
  );
}

function getMobiusLoopConfirmationEffectText(
  game: GameState,
  ability: PendingAbilityState
): string {
  const tieState = getLiveScoreTieState(game);
  const scoresText = tieState
    ? `当前分数 ${tieState.firstScore}:${tieState.secondScore}`
    : '当前分数未知';
  const willRestrict = isSourceLiveStillInLiveZone(game, ability) && tieState?.scoresTied === true;
  return `${getAbilityEffectText(ability.abilityId)}（${scoresText}，${tieState?.scoresTied === true ? '分数相同' : '分数不同'}，${willRestrict ? '将限制双方放置成功LIVE' : '不会限制成功LIVE放置'}）`;
}

function getMobiusLoopConfirmationStepText(game: GameState): string {
  const tieState = getLiveScoreTieState(game);
  if (!tieState) {
    return '确认后结算效果。';
  }
  return tieState.scoresTied
    ? `当前双方 LIVE 合计分数同为 ${tieState.firstScore}。确认后本次 LIVE 结束前双方不能放置成功 LIVE。`
    : `当前双方 LIVE 合计分数为 ${tieState.firstScore}:${tieState.secondScore}，不相同。确认后不会限制成功 LIVE 放置。`;
}

function resolveMobiusLoopSuccessZoneRestriction(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  const sourceLiveStillInLiveZone = player.liveZone.cardIds.includes(ability.sourceCardId);
  const tieState = getLiveScoreTieState(game);
  const stateWithoutPending: GameState = {
    ...game,
    pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
  };
  const stateWithRestriction = sourceLiveStillInLiveZone
    ? addSuccessLivePlacementRestrictionUntilLiveEnd(stateWithoutPending, {
        playerId: player.id,
        sourceCardId: ability.sourceCardId,
        abilityId: ability.abilityId,
      })
    : stateWithoutPending;

  return continuePendingCardEffects(
    addAction(stateWithRestriction, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: 'TIED_SCORE_PROHIBIT_SUCCESS_ZONE',
      sourceLiveStillInLiveZone,
      firstScore: tieState?.firstScore ?? null,
      secondScore: tieState?.secondScore ?? null,
      scoresTied: tieState?.scoresTied ?? false,
      restrictionRegistered: sourceLiveStillInLiveZone,
      restrictionAppliesNow: sourceLiveStillInLiveZone && tieState?.scoresTied === true,
    }),
    orderedResolution
  );
}

function isSourceLiveStillInLiveZone(game: GameState, ability: PendingAbilityState): boolean {
  const player = getPlayerById(game, ability.controllerId);
  return player?.liveZone.cardIds.includes(ability.sourceCardId) === true;
}
