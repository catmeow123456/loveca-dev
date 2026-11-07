import { addAction } from '../../../../domain/entities/game.js';
import { TriggerCondition } from '../../../../shared/types/enums.js';
import { HS_BP8_018_AUTO_REVEALED_CHEER_MOVED_SOURCE_SCORE_ABILITY_ID as ABILITY_ID } from '../../ability-ids.js';
import { getPendingAbilitySourceLifecycleId } from '../../runtime/ability-source-lifecycle.js';
import { replaceSourceLiveCardScoreModifierAndRefresh } from '../../runtime/live-card-score.js';
import { isCurrentLiveCardAbilitySource } from '../../runtime/source-live.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import {
  maybeStartConfirmablePendingAbilityConfirmation,
  recordAbilityUseForContext,
} from '../../runtime/workflow-helpers.js';

export function registerHsBp8018HolidayHolidayWorkflowHandlers(): void {
  registerPendingAbilityStarterHandler(ABILITY_ID, (game, pending, options, runtime) => {
    const ordered = options.orderedResolution === true;
    const movement = game.eventLog.find(
      ({ event }) =>
        pending.eventIds.includes(event.eventId) &&
        'movedCardIds' in event &&
        event.eventType === TriggerCondition.ON_REVEALED_CHEER_CARDS_MOVED &&
        event.playerId === pending.controllerId &&
        event.controllerId === pending.controllerId &&
        event.cause.kind === 'CARD_EFFECT' &&
        event.cause.playerId === pending.controllerId &&
        event.movedCardIds.length > 0
    );
    const withoutPending = {
      ...game,
      pendingAbilities: game.pendingAbilities.filter((ability) => ability.id !== pending.id),
    };
    if (!movement) {
      return runtime.continuePendingCardEffects(withoutPending, ordered);
    }

    const sourceLifecycleId = getPendingAbilitySourceLifecycleId(game, pending);
    const sourceCurrent = isCurrentLiveCardAbilitySource(game, { ...pending, sourceLifecycleId });
    const confirmation = maybeStartConfirmablePendingAbilityConfirmation(game, pending, {
      ...options,
      confirmBeforeResolution: options.confirmBeforeResolution === true || !ordered,
    });
    if (confirmation) return confirmation;

    let state = recordAbilityUseForContext(withoutPending, pending.controllerId, {
      abilityId: ABILITY_ID,
      sourceCardId: pending.sourceCardId,
      sourceLifecycleId,
      pendingAbilityId: pending.id,
    });
    if (sourceCurrent) {
      const { liveResults, playerScores, scoreConfirmedBy } = state.liveResolution;
      const refreshPlayerScore =
        liveResults.get(pending.sourceCardId) === true &&
        playerScores.has(pending.controllerId) &&
        !scoreConfirmedBy.includes(pending.controllerId);
      state = replaceSourceLiveCardScoreModifierAndRefresh(state, pending, 1, {
        refreshPlayerScore,
      });
    }

    return runtime.continuePendingCardEffects(
      addAction(state, 'RESOLVE_ABILITY', pending.controllerId, {
        pendingAbilityId: pending.id,
        abilityId: ABILITY_ID,
        sourceCardId: pending.sourceCardId,
        sourceLifecycleId,
        step: 'REVEALED_CHEER_MOVEMENT_SOURCE_SCORE',
        eventId: movement.event.eventId,
        scoreBonus: sourceCurrent ? 1 : 0,
      }),
      ordered
    );
  });
}
