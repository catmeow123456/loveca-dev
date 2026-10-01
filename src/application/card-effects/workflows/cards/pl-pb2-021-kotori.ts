import { isMemberCardData } from '../../../../domain/entities/card.js';
import {
  addAction,
  getCardById,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { isMemberStateChangeByOwnCardEffect } from '../../../../domain/rules/member-state-change-queries.js';
import { OrientationState, TriggerCondition } from '../../../../shared/types/enums.js';
import { setMemberOrientation } from '../../../effects/member-state.js';
import { PL_PB2_021_AUTO_SELF_WAITED_ACTIVATE_GAIN_BLADE_ABILITY_ID as ABILITY_ID } from '../../ability-ids.js';
import {
  doesCardAbilityDefinitionMatchCardCode,
  findCardAbilityDefinitionById,
} from '../../definitions/lookup.js';
import { hasAbilityInstance } from '../../runtime/ability-instance.js';
import {
  getAbilitySourceLifecycleId,
  getPendingAbilitySourceLifecycleId,
  getStageMemberLifecycleId,
} from '../../runtime/ability-source-lifecycle.js';
import { canUseAbilityThisTurn } from '../../runtime/ability-turn-limit.js';
import { addBladeLiveModifierForSourceMember } from '../../runtime/actions.js';
import { registerMemberStateChangedObserver } from '../../runtime/member-state-changed-observers.js';
import {
  enqueueMemberStateChangedTriggersFromOrientationResult,
  type EnqueueTriggeredCardEffectsForMemberStateChanged,
} from '../../runtime/member-state-changed-triggers.js';
import { getSourceMemberSlot } from '../../runtime/source-member.js';
import {
  recordAbilityUseForContext,
  registerManualConfirmablePendingAbilityStarterHandler,
} from '../../runtime/workflow-helpers.js';

export function registerPlPb2021KotoriWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForMemberStateChanged;
}): void {
  registerMemberStateChangedObserver((game, { events }) => {
    let state = game;
    const definition = findCardAbilityDefinitionById(ABILITY_ID);
    if (!definition?.implemented) return state;
    for (const event of events) {
      const source = getCardById(state, event.cardInstanceId);
      const sourceSlot = getSourceMemberSlot(state, event.controllerId, event.cardInstanceId);
      const sourceLifecycleId = getAbilitySourceLifecycleId(
        state,
        ABILITY_ID,
        event.cardInstanceId,
        [event.eventId]
      );
      if (
        !source ||
        !isMemberCardData(source.data) ||
        source.ownerId !== event.controllerId ||
        sourceSlot === null ||
        sourceLifecycleId !== getStageMemberLifecycleId(state, event.cardInstanceId) ||
        !doesCardAbilityDefinitionMatchCardCode(definition, source.data.cardCode) ||
        event.previousOrientation !== OrientationState.ACTIVE ||
        event.nextOrientation !== OrientationState.WAITING ||
        !isMemberStateChangeByOwnCardEffect(state, event, event.controllerId) ||
        !canUseAbilityThisTurn(state, event.controllerId, ABILITY_ID, source.instanceId)
      )
        continue;
      const id = `${ABILITY_ID}:${source.instanceId}:${event.eventId}`;
      if (hasAbilityInstance(state, id)) continue;
      const ability: PendingAbilityState = {
        id,
        abilityId: ABILITY_ID,
        sourceCardId: source.instanceId,
        sourceLifecycleId,
        controllerId: event.controllerId,
        sourceSlot,
        mandatory: true,
        timingId: TriggerCondition.ON_MEMBER_STATE_CHANGED,
        eventIds: [event.eventId],
      };
      state = addAction(
        { ...state, pendingAbilities: [...state.pendingAbilities, ability] },
        'TRIGGER_ABILITY',
        event.controllerId,
        {
          pendingAbilityId: id,
          abilityId: ABILITY_ID,
          sourceCardId: source.instanceId,
          sourceSlot,
          sourceLifecycleId,
          eventIds: ability.eventIds,
          timingId: ability.timingId,
        }
      );
    }
    return state;
  });
  registerManualConfirmablePendingAbilityStarterHandler(
    ABILITY_ID,
    (game, ability, options, context) =>
      resolveSelfWaited(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects,
        deps.enqueueTriggeredCardEffects
      )
  );
}

function resolveSelfWaited(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: (game: GameState, orderedResolution: boolean) => GameState,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForMemberStateChanged
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) return game;
  let state = recordAbilityUseForContext(
    {
      ...game,
      pendingAbilities: game.pendingAbilities.filter((item) => item.id !== ability.id),
    },
    player.id,
    {
      abilityId: ABILITY_ID,
      sourceCardId: ability.sourceCardId,
      sourceLifecycleId: getPendingAbilitySourceLifecycleId(game, ability),
      pendingAbilityId: ability.id,
    }
  );
  const sourceValid =
    getSourceMemberSlot(state, player.id, ability.sourceCardId) !== null &&
    getPendingAbilitySourceLifecycleId(game, ability) ===
      getStageMemberLifecycleId(state, ability.sourceCardId);
  const orientation = sourceValid
    ? setMemberOrientation(state, player.id, ability.sourceCardId, OrientationState.ACTIVE, {
        kind: 'CARD_EFFECT',
        playerId: player.id,
        sourceCardId: ability.sourceCardId,
        abilityId: ABILITY_ID,
        pendingAbilityId: ability.id,
      })
    : null;
  state = orientation?.gameState ?? state;
  // The Blade grant is independent of whether activation changed the orientation.
  const blade = sourceValid
    ? addBladeLiveModifierForSourceMember(state, {
        playerId: player.id,
        sourceCardId: ability.sourceCardId,
        abilityId: ABILITY_ID,
        amount: 1,
      })
    : null;
  state = addAction(blade?.gameState ?? state, 'RESOLVE_ABILITY', player.id, {
    pendingAbilityId: ability.id,
    abilityId: ABILITY_ID,
    sourceCardId: ability.sourceCardId,
    step: sourceValid ? 'ACTIVATE_SELF_GAIN_BLADE' : 'SOURCE_UNAVAILABLE',
    activated: orientation?.changed ?? false,
    bladeBonus: blade?.bladeBonus ?? 0,
  });
  if (orientation) {
    state = enqueueMemberStateChangedTriggersFromOrientationResult(
      game,
      { ...orientation, gameState: state },
      enqueueTriggeredCardEffects
    ).gameState;
  }
  return continuePendingCardEffects(state, orderedResolution);
}
