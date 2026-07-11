import { addAction, getPlayerById, type GameState, type LiveModifierState, type PendingAbilityState } from '../../../../domain/entities/game.js';
import { getAllMemberCardIds } from '../../../../domain/entities/zone.js';
import { replaceLiveModifier } from '../../../../domain/rules/live-modifiers.js';
import { OrientationState } from '../../../../shared/types/enums.js';
import { PL_N_BP3_031_LIVE_SUCCESS_WAITING_STAGE_MEMBERS_THIS_LIVE_SCORE_ABILITY_ID } from '../../ability-ids.js';
import { getAbilityEffectText, registerManualConfirmablePendingAbilityStarterHandler } from '../../runtime/workflow-helpers.js';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerNBp3031MonsterGirlsWorkflowHandlers(): void {
  registerManualConfirmablePendingAbilityStarterHandler(
    PL_N_BP3_031_LIVE_SUCCESS_WAITING_STAGE_MEMBERS_THIS_LIVE_SCORE_ABILITY_ID,
    (game, ability, options, context) => resolveMonsterGirls(game, ability, options.orderedResolution === true, context.continuePendingCardEffects),
    (game, ability) => {
      const evaluation = evaluateMonsterGirls(game, ability);
      return { effectText: `${getAbilityEffectText(ability.abilityId)}（当前自己舞台有${evaluation.waitingMemberCardIds.length}名待机成员，实际[スコア]+${evaluation.scoreBonus}。）` };
    }
  );
}

function resolveMonsterGirls(game: GameState, ability: PendingAbilityState, orderedResolution: boolean, continuePendingCardEffects: ContinuePendingCardEffects): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) return game;
  const stateWithoutPending = { ...game, pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id) };
  const evaluation = evaluateMonsterGirls(stateWithoutPending, ability);
  const stateAfterScore = replaceScoreModifierAndRefresh(stateWithoutPending, ability, player.id, evaluation.scoreBonus);
  return continuePendingCardEffects(addAction(stateAfterScore, 'RESOLVE_ABILITY', player.id, {
    pendingAbilityId: ability.id, abilityId: ability.abilityId, sourceCardId: ability.sourceCardId,
    step: 'WAITING_STAGE_MEMBERS_THIS_LIVE_SCORE', sourceInLiveZone: evaluation.sourceInLiveZone,
    waitingMemberCardIds: evaluation.waitingMemberCardIds, scoreBonus: evaluation.scoreBonus,
  }), orderedResolution);
}

function evaluateMonsterGirls(game: GameState, ability: Pick<PendingAbilityState, 'controllerId' | 'sourceCardId'>): { readonly sourceInLiveZone: boolean; readonly waitingMemberCardIds: readonly string[]; readonly scoreBonus: number } {
  const player = getPlayerById(game, ability.controllerId);
  const sourceInLiveZone = player?.liveZone.cardIds.includes(ability.sourceCardId) === true;
  const waitingMemberCardIds = sourceInLiveZone && player ? getAllMemberCardIds(player.memberSlots).filter((cardId) => player.memberSlots.cardStates.get(cardId)?.orientation === OrientationState.WAITING) : [];
  return { sourceInLiveZone, waitingMemberCardIds, scoreBonus: waitingMemberCardIds.length };
}

function replaceScoreModifierAndRefresh(game: GameState, ability: PendingAbilityState, playerId: string, scoreBonus: number): GameState {
  const matches = (modifier: LiveModifierState) => modifier.kind === 'SCORE' && modifier.playerId === playerId && modifier.liveCardId === ability.sourceCardId && modifier.sourceCardId === ability.sourceCardId && modifier.abilityId === ability.abilityId;
  const previous = game.liveResolution.liveModifiers.filter(matches).reduce((sum, modifier) => sum + (modifier.kind === 'SCORE' ? modifier.countDelta : 0), 0);
  const replacement: Extract<LiveModifierState, { readonly kind: 'SCORE' }> | null = scoreBonus > 0 ? { kind: 'SCORE', playerId, countDelta: scoreBonus, liveCardId: ability.sourceCardId, sourceCardId: ability.sourceCardId, abilityId: ability.abilityId } : null;
  const state = replaceLiveModifier(game, { kind: 'SCORE', playerId, liveCardId: ability.sourceCardId, sourceCardId: ability.sourceCardId, abilityId: ability.abilityId }, replacement);
  const delta = scoreBonus - previous;
  if (delta === 0) return state;
  const playerScores = new Map(state.liveResolution.playerScores);
  playerScores.set(playerId, (playerScores.get(playerId) ?? 0) + delta);
  return { ...state, liveResolution: { ...state.liveResolution, playerScores } };
}
