import {
  addAction,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { SlotPosition } from '../../../../shared/types/enums.js';
import { SP_BP5_015_ON_ENTER_CENTER_GAIN_TWO_BLADE_ABILITY_ID } from '../../ability-ids.js';
import { addBladeLiveModifierForSourceMember } from '../../runtime/actions.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { recordAbilityUseForContext } from '../../runtime/workflow-helpers.js';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerSpBp5015SumireWorkflowHandlers(): void {
  registerPendingAbilityStarterHandler(
    SP_BP5_015_ON_ENTER_CENTER_GAIN_TWO_BLADE_ABILITY_ID,
    (game, ability, options, context) =>
      resolveSpBp5015SumireOnEnter(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      )
  );
}

function resolveSpBp5015SumireOnEnter(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const stateWithoutPending: GameState = {
    ...game,
    pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
  };
  const player = getPlayerById(stateWithoutPending, ability.controllerId);
  if (!player) {
    return continuePendingCardEffects(stateWithoutPending, orderedResolution);
  }

  const sourceStillCenter =
    player.memberSlots.slots[SlotPosition.CENTER] === ability.sourceCardId &&
    ability.sourceSlot === SlotPosition.CENTER;
  const stateAfterUseRecord = recordAbilityUseForContext(stateWithoutPending, player.id, {
    abilityId: ability.abilityId,
    sourceCardId: ability.sourceCardId,
  });
  const bladeResult = sourceStillCenter
    ? addBladeLiveModifierForSourceMember(stateAfterUseRecord, {
        playerId: player.id,
        sourceCardId: ability.sourceCardId,
        abilityId: ability.abilityId,
        amount: 2,
      })
    : null;
  const stateAfterBlade = bladeResult?.gameState ?? stateAfterUseRecord;

  return continuePendingCardEffects(
    addAction(stateAfterBlade, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      sourceSlot: ability.sourceSlot,
      step: sourceStillCenter ? 'CENTER_GAIN_TWO_BLADE' : 'SOURCE_NOT_CENTER',
      sourceStillCenter,
      bladeBonus: bladeResult?.bladeBonus ?? 0,
    }),
    orderedResolution
  );
}
