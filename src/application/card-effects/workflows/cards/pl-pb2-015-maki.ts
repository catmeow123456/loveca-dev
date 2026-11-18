import { appendTriggeredAbility, recordTriggeredAbility } from '../../runtime/enqueue-pending-ability.js';
import { isMemberCardData } from '../../../../domain/entities/card.js';
import {
  addAction,
  getCardById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { isMemberStateChangeByOwnCardEffect } from '../../../../domain/rules/member-state-change-queries.js';
import {
  OrientationState,
  SlotPosition,
  TriggerCondition,
} from '../../../../shared/types/enums.js';
import { cardCodeMatchesBase } from '../../../../shared/utils/card-code.js';
import { unitAliasIs } from '../../../effects/card-selectors.js';
import { PL_PB2_015_AUTO_BIBI_EFFECT_WAIT_OPPONENT_ACTIVATE_MEMBER_OR_ENERGY_ABILITY_ID as ABILITY_ID } from '../../ability-ids.js';
import { hasAbilityInstance } from '../../runtime/ability-instance.js';
import { getAbilitySourceLifecycleId } from '../../runtime/ability-source-lifecycle.js';
import { canUseAbilityThisTurn } from '../../runtime/ability-turn-limit.js';
import { registerMemberStateChangedObserver } from '../../runtime/member-state-changed-observers.js';

/** Only the card's event predicate lives here; the two-choice resolution is shared with Emma. */
export function registerPlPb2015MakiWorkflowHandlers(): void {
  registerMemberStateChangedObserver((game, { events }) => {
    let state: GameState = game;
    for (const event of events) {
      if (
        event.previousOrientation !== OrientationState.ACTIVE ||
        event.nextOrientation !== OrientationState.WAITING
      )
        continue;
      for (const player of state.players) {
        if (
          event.controllerId === player.id ||
          !isMemberStateChangeByOwnCardEffect(state, event, player.id, unitAliasIs('BiBi'))
        )
          continue;
        for (const slot of [SlotPosition.LEFT, SlotPosition.CENTER, SlotPosition.RIGHT]) {
          const sourceCardId = player.memberSlots.slots[slot];
          const source = sourceCardId ? getCardById(state, sourceCardId) : null;
          if (
            !sourceCardId ||
            !source ||
            !isMemberCardData(source.data) ||
            !cardCodeMatchesBase(source.data.cardCode, 'PL!-pb2-015')
          )
            continue;
          if (!canUseAbilityThisTurn(state, player.id, ABILITY_ID, sourceCardId)) continue;
          const id = `${ABILITY_ID}:${sourceCardId}:${event.eventId}`;
          if (hasAbilityInstance(state, id)) continue;
          const ability: PendingAbilityState = {
            id,
            abilityId: ABILITY_ID,
            sourceCardId,
            controllerId: player.id,
            sourceLifecycleId: getAbilitySourceLifecycleId(state, ABILITY_ID, sourceCardId, [
              event.eventId,
            ]),
            sourceSlot: slot,
            mandatory: true,
            timingId: TriggerCondition.ON_MEMBER_STATE_CHANGED,
            eventIds: [event.eventId],
          };
          state = recordTriggeredAbility(
            { ...state, pendingAbilities: appendTriggeredAbility(state, ability) },
            'TRIGGER_ABILITY',
            player.id,
            {
              pendingAbilityId: id,
              abilityId: ABILITY_ID,
              sourceCardId,
              sourceSlot: slot,
              sourceLifecycleId: ability.sourceLifecycleId,
              timingId: ability.timingId,
              eventIds: ability.eventIds,
            }
          );
        }
      }
    }
    return state;
  });
}
