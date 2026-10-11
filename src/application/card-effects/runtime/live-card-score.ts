import type { GameState, LiveModifierState } from '../../../domain/entities/game.js';
import { replaceLiveModifier } from '../../../domain/rules/live-modifiers.js';

/** Replace this ability's self-score bonus and synchronize the judged score by its delta. */
export function replaceSourceLiveCardScoreModifierAndRefresh(
  game: GameState,
  context: {
    readonly abilityId: string;
    readonly controllerId: string;
    readonly sourceCardId: string;
  },
  scoreBonus: number
): GameState {
  const matches = (modifier: LiveModifierState) =>
    modifier.kind === 'SCORE' &&
    modifier.playerId === context.controllerId &&
    modifier.liveCardId === context.sourceCardId &&
    modifier.sourceCardId === context.sourceCardId &&
    modifier.abilityId === context.abilityId;
  const previousScoreBonus = game.liveResolution.liveModifiers
    .filter(matches)
    .reduce((total, modifier) => total + (modifier.kind === 'SCORE' ? modifier.countDelta : 0), 0);
  const replacement: Extract<LiveModifierState, { readonly kind: 'SCORE' }> | null =
    scoreBonus > 0
      ? {
          kind: 'SCORE',
          playerId: context.controllerId,
          countDelta: scoreBonus,
          liveCardId: context.sourceCardId,
          sourceCardId: context.sourceCardId,
          abilityId: context.abilityId,
        }
      : null;
  const state = replaceLiveModifier(
    game,
    {
      kind: 'SCORE',
      playerId: context.controllerId,
      liveCardId: context.sourceCardId,
      sourceCardId: context.sourceCardId,
      abilityId: context.abilityId,
    },
    replacement
  );
  const delta = scoreBonus - previousScoreBonus;
  if (delta === 0) return state;
  const playerScores = new Map(state.liveResolution.playerScores);
  playerScores.set(context.controllerId, (playerScores.get(context.controllerId) ?? 0) + delta);
  return { ...state, liveResolution: { ...state.liveResolution, playerScores } };
}
