import { isMemberCardData } from '../../../../domain/entities/card.js';
import {
  addAction,
  getCardById,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { findMemberSlot } from '../../../../domain/entities/player.js';
import { getMemberEffectiveCost } from '../../../effects/conditions.js';
import { TriggerCondition, ZoneType } from '../../../../shared/types/enums.js';
import {
  PR_AUTO_RELAY_REPLACEMENT_COST_NINE_GAIN_TWO_BLADE_ABILITY_ID,
  SP_PR_034_AUTO_RELAY_LOW_COST_TARGET_GAIN_BLADE_ABILITY_ID,
} from '../../ability-ids.js';
import { addBladeLiveModifierForTargetMember } from '../../runtime/actions.js';
import { getPendingLeaveStageEvent } from '../../runtime/events.js';
import {
  getAbilityEffectText,
  registerManualConfirmablePendingAbilityStarterHandler,
} from '../../runtime/workflow-helpers.js';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

interface RelayReplacementConfig {
  readonly abilityId: string;
  readonly minCost?: number;
  readonly maxCost?: number;
  readonly blade: number;
}
const CONFIGS: readonly RelayReplacementConfig[] = [
  {
    abilityId: PR_AUTO_RELAY_REPLACEMENT_COST_NINE_GAIN_TWO_BLADE_ABILITY_ID,
    minCost: 9,
    blade: 2,
  },
  { abilityId: SP_PR_034_AUTO_RELAY_LOW_COST_TARGET_GAIN_BLADE_ABILITY_ID, maxCost: 11, blade: 2 },
];

interface RelayReplacementContext {
  readonly leaveStageEventId: string | null;
  readonly replacingCardId: string | null;
  readonly replacingCardName: string | null;
  readonly replacingCardEffectiveCost: number | null;
  readonly replacementIsOwnCurrentStageTop: boolean;
  readonly eventMatches: boolean;
  readonly replacementLeftAfterRelay: boolean;
  readonly conditionMet: boolean;
}

export function registerRelayReplacementGainBladeWorkflowHandlers(): void {
  for (const config of CONFIGS) {
    registerManualConfirmablePendingAbilityStarterHandler(
      config.abilityId,
      (game, ability, options, context) =>
        resolveRelayReplacementGainBlade(
          game,
          ability,
          options.orderedResolution === true,
          context.continuePendingCardEffects,
          config
        ),
      (game, ability) => getConfirmationConfig(game, ability, config)
    );
  }
}

function getConfirmationConfig(
  game: GameState,
  ability: PendingAbilityState,
  config: RelayReplacementConfig
): { readonly effectText: string; readonly stepText: string } {
  const context = getRelayReplacementContext(game, ability, config);
  const replacementDescription =
    context.replacingCardName && context.replacingCardEffectiveCost !== null
      ? `换手登场成员为「${context.replacingCardName}」（费用${context.replacingCardEffectiveCost}）`
      : '没有可确认的换手登场成员';
  const blades = '[ブレード]'.repeat(config.blade);
  const costDescription =
    config.minCost !== undefined ? `大于等于${config.minCost}` : `小于等于${config.maxCost}`;
  const result = context.conditionMet
    ? `条件满足，实际获得${blades}`
    : '条件未满足，实际不获得[ブレード]';
  return {
    effectText: `${getAbilityEffectText(ability.abilityId)}（${replacementDescription}；${result}。）`,
    stepText: context.conditionMet
      ? `换手登场成员仍在自己的舞台且有效费用${costDescription}，确认后获得${blades}。`
      : '当前不满足换手登场成员的条件，确认后不获得[ブレード]。',
  };
}

function resolveRelayReplacementGainBlade(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects,
  config: RelayReplacementConfig
): GameState {
  const context = getRelayReplacementContext(game, ability, config);
  const stateWithoutPending: GameState = {
    ...game,
    pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
  };
  const player = getPlayerById(stateWithoutPending, ability.controllerId);
  const bladeResult =
    player && context.conditionMet && context.replacingCardId
      ? addBladeLiveModifierForTargetMember(stateWithoutPending, {
          playerId: player.id,
          sourceCardId: ability.sourceCardId,
          targetMemberCardId: context.replacingCardId,
          abilityId: ability.abilityId,
          amount: config.blade,
        })
      : null;
  const resolvedState = bladeResult?.gameState ?? stateWithoutPending;

  return continuePendingCardEffects(
    addAction(resolvedState, 'RESOLVE_ABILITY', ability.controllerId, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: bladeResult ? 'RELAY_REPLACEMENT_GAIN_TWO_BLADE' : 'RELAY_REPLACEMENT_NOT_AVAILABLE',
      ...context,
      bladeBonus: bladeResult?.bladeBonus ?? 0,
      targetMemberCardId: bladeResult ? context.replacingCardId : null,
    }),
    orderedResolution
  );
}

function getRelayReplacementContext(
  game: GameState,
  ability: PendingAbilityState,
  config: RelayReplacementConfig
): RelayReplacementContext {
  const player = getPlayerById(game, ability.controllerId);
  const event = getPendingLeaveStageEvent(game, ability);
  const replacingCardId = event?.replacingCardId ?? null;
  const replacement = replacingCardId ? getCardById(game, replacingCardId) : null;
  const replacementSlot =
    player && replacingCardId ? findMemberSlot(player, replacingCardId) : null;
  const eventMatches =
    event?.cardInstanceId === ability.sourceCardId &&
    event.controllerId === ability.controllerId &&
    event.toZone === ZoneType.WAITING_ROOM;
  const replacementIsOwnCurrentStageTop =
    player !== null &&
    replacement !== null &&
    replacement.ownerId === player.id &&
    replacementSlot !== null &&
    player.memberSlots.slots[replacementSlot] === replacingCardId;
  const effectiveCost =
    replacementIsOwnCurrentStageTop && replacingCardId
      ? getMemberEffectiveCost(game, ability.controllerId, replacingCardId)
      : null;
  const relaySequence = game.eventLog.find(
    (entry) => entry.event.eventId === event?.eventId
  )?.sequence;
  // The replacement enters after this leave event during normal relay. Only a later leave
  // ends that rules object; slot/orientation changes and the initial entry do not.
  const replacementLeftAfterRelay =
    relaySequence !== undefined &&
    game.eventLog.some(
      (entry) =>
        entry.sequence > relaySequence &&
        entry.event.eventType === TriggerCondition.ON_LEAVE_STAGE &&
        entry.event.cardInstanceId === replacingCardId
    );

  return {
    leaveStageEventId: event?.eventId ?? null,
    replacingCardId,
    replacingCardName:
      replacement && isMemberCardData(replacement.data) ? replacement.data.name : null,
    replacingCardEffectiveCost: effectiveCost,
    replacementIsOwnCurrentStageTop,
    eventMatches,
    replacementLeftAfterRelay,
    conditionMet:
      eventMatches &&
      replacementIsOwnCurrentStageTop &&
      !replacementLeftAfterRelay &&
      effectiveCost !== null &&
      (config.minCost === undefined || effectiveCost >= config.minCost) &&
      (config.maxCost === undefined || effectiveCost <= config.maxCost),
  };
}
