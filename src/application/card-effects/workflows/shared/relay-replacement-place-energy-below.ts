import { isMemberCardData } from '../../../../domain/entities/card.js';
import {
  addAction,
  getCardById,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { findMemberSlot } from '../../../../domain/entities/player.js';
import { TriggerCondition, ZoneType } from '../../../../shared/types/enums.js';
import { groupAliasIs } from '../../../effects/card-selectors.js';
import { placeEnergyFromEnergyDeckBelowStageMember } from '../../../effects/energy-below.js';
import {
  N_BP7_019_AUTO_RELAY_NIJIGASAKI_PLACE_ENERGY_BELOW_REPLACEMENT_ABILITY_ID,
  N_BP8_024_AUTO_BATON_TOUCH_NIJIGASAKI_PLACE_ENERGY_UNDER_ENTERED_MEMBER_ABILITY_ID,
} from '../../ability-ids.js';
import {
  getAbilityEffectText,
  maybeStartConfirmablePendingAbilityConfirmation,
} from '../../runtime/workflow-helpers.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';

type Continue = (game: GameState, orderedResolution: boolean) => GameState;
const ABILITY_IDS = [
  N_BP7_019_AUTO_RELAY_NIJIGASAKI_PLACE_ENERGY_BELOW_REPLACEMENT_ABILITY_ID,
  N_BP8_024_AUTO_BATON_TOUCH_NIJIGASAKI_PLACE_ENERGY_UNDER_ENTERED_MEMBER_ABILITY_ID,
] as const;

export function registerRelayReplacementPlaceEnergyBelowWorkflowHandlers(): void {
  for (const abilityId of ABILITY_IDS) {
    registerPendingAbilityStarterHandler(abilityId, (game, ability, options, runtime) => {
      const context = getReplacementContext(game, ability);
      const count = context.valid
        ? Math.min(1, getPlayerById(game, ability.controllerId)?.energyDeck.cardIds.length ?? 0)
        : 0;
      const confirmation = maybeStartConfirmablePendingAbilityConfirmation(
        game,
        ability,
        {
          ...options,
          confirmBeforeResolution:
            options.orderedResolution !== true || options.confirmBeforeResolution === true,
        },
        {
          effectText:
            getAbilityEffectText(ability.abilityId) +
            (context.valid
              ? `（换手登场的『虹咲』成员仍在自己的舞台，实际放置${count}张能量卡。）`
              : '（没有符合条件的换手登场成员，不放置能量卡。）'),
          stepText: context.valid
            ? '确认后将能量卡组顶的1张能量卡放置于换手登场的成员下方。'
            : '没有符合条件的换手登场成员，确认后不处理。',
        }
      );
      return (
        confirmation ??
        resolve(
          game,
          ability,
          options.orderedResolution === true,
          runtime.continuePendingCardEffects
        )
      );
    });
  }
}

function getReplacementContext(game: GameState, ability: PendingAbilityState) {
  const player = getPlayerById(game, ability.controllerId);
  const eventIds = new Set(ability.eventIds);
  const leaveEntry = game.eventLog.find(
    ({ event }) =>
      eventIds.has(event.eventId) &&
      event.eventType === TriggerCondition.ON_LEAVE_STAGE &&
      event.cardInstanceId === ability.sourceCardId &&
      event.controllerId === ability.controllerId &&
      event.toZone === ZoneType.WAITING_ROOM
  );
  const event =
    leaveEntry?.event.eventType === TriggerCondition.ON_LEAVE_STAGE ? leaveEntry.event : null;
  const replacingCardId =
    event && 'replacingCardId' in event && typeof event.replacingCardId === 'string'
      ? event.replacingCardId
      : null;
  const replacement = replacingCardId ? getCardById(game, replacingCardId) : null;
  const targetSlot = player && replacingCardId ? findMemberSlot(player, replacingCardId) : null;
  // A relay emits the outgoing member's leave before the replacement's entry. The
  // replacement may enter normally after this event; only its later leave invalidates it.
  const replacementLeftAfterRelay =
    leaveEntry !== undefined &&
    game.eventLog.some(
      ({ sequence, event: later }) =>
        sequence > leaveEntry.sequence &&
        later.eventType === TriggerCondition.ON_LEAVE_STAGE &&
        later.cardInstanceId === replacingCardId
    );
  const valid =
    event !== null &&
    player !== null &&
    replacement !== null &&
    replacement.ownerId === player.id &&
    isMemberCardData(replacement.data) &&
    groupAliasIs('虹ヶ咲')(replacement) &&
    targetSlot !== null &&
    player.memberSlots.slots[targetSlot] === replacingCardId &&
    !replacementLeftAfterRelay;
  return { event, replacingCardId, targetSlot, replacementLeftAfterRelay, valid };
}

function resolve(
  game: GameState,
  ability: PendingAbilityState,
  ordered: boolean,
  next: Continue
): GameState {
  const context = getReplacementContext(game, ability);
  const placement =
    context.valid && context.replacingCardId
      ? placeEnergyFromEnergyDeckBelowStageMember(
          game,
          ability.controllerId,
          context.replacingCardId,
          1
        )
      : null;
  const resolved = placement?.gameState ?? game;
  return next(
    addAction(
      {
        ...resolved,
        pendingAbilities: resolved.pendingAbilities.filter((item) => item.id !== ability.id),
      },
      'RESOLVE_ABILITY',
      ability.controllerId,
      {
        pendingAbilityId: ability.id,
        abilityId: ability.abilityId,
        sourceCardId: ability.sourceCardId,
        step: placement
          ? 'PLACE_ENERGY_BELOW_RELAY_REPLACEMENT'
          : 'RELAY_REPLACEMENT_NOT_AVAILABLE',
        leaveStageEventId: context.event?.eventId ?? null,
        replacingCardId: context.replacingCardId,
        targetSlot: placement?.targetSlot ?? context.targetSlot,
        replacementLeftAfterRelay: context.replacementLeftAfterRelay,
        placedEnergyCardIds: placement?.placedEnergyCardIds ?? [],
      }
    ),
    ordered
  );
}
