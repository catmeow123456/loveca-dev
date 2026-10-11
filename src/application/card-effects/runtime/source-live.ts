import { isLiveCardData } from '../../../domain/entities/card.js';
import { getCardById, getPlayerById, type GameState } from '../../../domain/entities/game.js';
import { FaceState } from '../../../shared/types/enums.js';
import { getAbilitySourceLifecycleId } from './ability-source-lifecycle.js';

/** A self-reward must still address the captured face-up LIVE rules object. */
export function isCurrentLiveCardAbilitySource(
  game: GameState,
  context: {
    readonly abilityId: string;
    readonly controllerId: string;
    readonly sourceCardId: string;
    readonly sourceLifecycleId?: string;
  }
): boolean {
  const player = getPlayerById(game, context.controllerId);
  const source = getCardById(game, context.sourceCardId);
  return (
    player !== null &&
    source !== null &&
    source.ownerId === context.controllerId &&
    isLiveCardData(source.data) &&
    player.liveZone.cardIds.includes(context.sourceCardId) &&
    player.liveZone.cardStates.get(context.sourceCardId)?.face === FaceState.FACE_UP &&
    (context.sourceLifecycleId === undefined ||
      getAbilitySourceLifecycleId(game, context.abilityId, context.sourceCardId) ===
        context.sourceLifecycleId)
  );
}
