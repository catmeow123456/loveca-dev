import {
  addAction,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { getAllMemberCardIds } from '../../../../domain/entities/zone.js';
import { ZoneType } from '../../../../shared/types/enums.js';
import { S_BP6_006_ON_ENTER_DRAW_TWO_FROM_WAITING_GAIN_THREE_BLADE_ABILITY_ID } from '../../ability-ids.js';
import { addBladeLiveModifierForSourceMember, drawCardsForPlayer } from '../../runtime/actions.js';
import {
  consumeOnEnterSourceZoneMismatch,
  isOnEnterFromWaitingRoom,
} from '../../runtime/on-enter-source-zone.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerSBp6006YoshikoWorkflowHandlers(): void {
  registerPendingAbilityStarterHandler(
    S_BP6_006_ON_ENTER_DRAW_TWO_FROM_WAITING_GAIN_THREE_BLADE_ABILITY_ID,
    (game, ability, options, context) =>
      resolveSBp6006YoshikoWorkflow(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      )
  );
}

function resolveSBp6006YoshikoWorkflow(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  const drawResult = drawCardsForPlayer(game, player.id, 2);
  if (!drawResult) {
    return game;
  }

  if (!isOnEnterFromWaitingRoom(ability)) {
    return consumeOnEnterSourceZoneMismatch(drawResult.gameState, ability, {
      expectedFromZone: ZoneType.WAITING_ROOM,
      orderedResolution,
      continuePendingCardEffects,
      step: 'DRAW_TWO_SOURCE_ZONE_MISMATCH_NO_BLADE',
    });
  }

  const stateWithoutPending: GameState = {
    ...drawResult.gameState,
    pendingAbilities: drawResult.gameState.pendingAbilities.filter(
      (candidate) => candidate.id !== ability.id
    ),
  };
  const playerAfterDraw = getPlayerById(stateWithoutPending, player.id);
  const sourceOnStage =
    playerAfterDraw !== null &&
    playerAfterDraw !== undefined &&
    getAllMemberCardIds(playerAfterDraw.memberSlots).includes(ability.sourceCardId);
  const bladeResult = sourceOnStage
    ? addBladeLiveModifierForSourceMember(stateWithoutPending, {
        playerId: player.id,
        sourceCardId: ability.sourceCardId,
        abilityId: ability.abilityId,
        amount: 3,
      })
    : null;

  return continuePendingCardEffects(
    addAction(bladeResult?.gameState ?? stateWithoutPending, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      sourceSlot: ability.sourceSlot,
      step: bladeResult ? 'DRAW_TWO_GAIN_THREE_BLADE' : 'DRAW_TWO_SOURCE_NOT_ON_STAGE_NO_BLADE',
      expectedFromZone: ZoneType.WAITING_ROOM,
      actualFromZone: ZoneType.WAITING_ROOM,
      drawnCardIds: drawResult.drawnCardIds,
      bladeBonus: bladeResult?.bladeBonus ?? 0,
      sourceOnStage,
    }),
    orderedResolution
  );
}
