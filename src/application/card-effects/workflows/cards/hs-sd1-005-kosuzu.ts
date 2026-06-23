import { isMemberCardData } from '../../../../domain/entities/card.js';
import {
  addAction,
  getCardById,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { CardType } from '../../../../shared/types/enums.js';
import { cardNameAliasIs, groupAliasIs, typeIs } from '../../../effects/card-selectors.js';
import { selectWaitingRoomCardIds } from '../../../effects/zone-selection.js';
import { HS_SD1_005_ON_ENTER_RELAY_FROM_OTHER_HASUNOSORA_RECOVER_LIVE_ABILITY_ID } from '../../ability-ids.js';
import {
  registerPendingAbilityStarterHandler,
  type PendingAbilityStarterOptions,
} from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText } from '../../runtime/workflow-helpers.js';
import {
  finishWaitingRoomToHandWorkflow,
  startWaitingRoomToHandWorkflow,
} from '../shared/waiting-room-to-hand.js';

const HS_SD1_005_SELECT_WAITING_ROOM_LIVE_STEP_ID = 'HS_SD1_005_SELECT_WAITING_ROOM_LIVE';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerHsSd1005KosuzuWorkflowHandlers(): void {
  registerPendingAbilityStarterHandler(
    HS_SD1_005_ON_ENTER_RELAY_FROM_OTHER_HASUNOSORA_RECOVER_LIVE_ABILITY_ID,
    (game, ability, options, context) =>
      startHsSd1005OnEnterRelayRecoverLive(
        game,
        ability,
        options,
        context.continuePendingCardEffects
      )
  );
  registerActiveEffectStepHandler(
    HS_SD1_005_ON_ENTER_RELAY_FROM_OTHER_HASUNOSORA_RECOVER_LIVE_ABILITY_ID,
    HS_SD1_005_SELECT_WAITING_ROOM_LIVE_STEP_ID,
    (game, input, context) =>
      finishWaitingRoomToHandWorkflow(
        game,
        input.selectedCardId ?? null,
        input.selectedCardIds,
        context.continuePendingCardEffects
      )
  );
}

function startHsSd1005OnEnterRelayRecoverLive(
  game: GameState,
  ability: PendingAbilityState,
  options: PendingAbilityStarterOptions,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  const condition = getOtherHasunosoraRelayCondition(game, ability);
  if (!condition.conditionMet) {
    return finishWithoutEffect(
      game,
      ability,
      options.orderedResolution === true,
      continuePendingCardEffects,
      {
        conditionMet: false,
        reason: condition.reason,
        relayReplacementCardIds: condition.relayReplacementCardIds,
      }
    );
  }

  const selectableLiveCardIds = selectWaitingRoomCardIds(game, player.id, typeIs(CardType.LIVE));
  if (selectableLiveCardIds.length === 0) {
    return finishWithoutEffect(
      game,
      ability,
      options.orderedResolution === true,
      continuePendingCardEffects,
      {
        conditionMet: true,
        reason: 'NO_WAITING_ROOM_LIVE_TARGET',
        relayReplacementCardIds: condition.relayReplacementCardIds,
      }
    );
  }

  return startWaitingRoomToHandWorkflow(game, {
    ability,
    effectText: getAbilityEffectText(
      HS_SD1_005_ON_ENTER_RELAY_FROM_OTHER_HASUNOSORA_RECOVER_LIVE_ABILITY_ID
    ),
    stepId: HS_SD1_005_SELECT_WAITING_ROOM_LIVE_STEP_ID,
    stepText: '请选择自己的休息室中1张LIVE卡加入手牌。',
    candidateBuilder: (currentGame, playerId) =>
      selectWaitingRoomCardIds(currentGame, playerId, typeIs(CardType.LIVE)),
    countRule: { minCount: 0, maxCount: 1 },
    optional: true,
    selectionRequiredWhenHasTargets: true,
    orderedResolution: options.orderedResolution === true,
  });
}

function getOtherHasunosoraRelayCondition(
  game: GameState,
  ability: PendingAbilityState
):
  | {
      readonly conditionMet: true;
      readonly relayReplacementCardIds: readonly string[];
    }
  | {
      readonly conditionMet: false;
      readonly reason: string;
      readonly relayReplacementCardIds: readonly string[];
    } {
  const relayReplacementCardIds = getRelayReplacementCardIds(ability.metadata?.relayReplacements);
  if (relayReplacementCardIds.length === 0) {
    return {
      conditionMet: false,
      reason: 'NOT_RELAY_ENTER',
      relayReplacementCardIds,
    };
  }

  const hasOtherHasunosoraReplacement = relayReplacementCardIds.some((cardId) => {
    const card = getCardById(game, cardId);
    return (
      card !== null &&
      isMemberCardData(card.data) &&
      groupAliasIs('蓮ノ空')(card) &&
      !cardNameAliasIs('徒町小鈴')(card)
    );
  });
  if (!hasOtherHasunosoraReplacement) {
    return {
      conditionMet: false,
      reason: 'RELAY_REPLACEMENT_NOT_OTHER_HASUNOSORA_MEMBER',
      relayReplacementCardIds,
    };
  }

  return { conditionMet: true, relayReplacementCardIds };
}

function finishWithoutEffect(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects,
  payload: {
    readonly conditionMet: boolean;
    readonly reason: string;
    readonly relayReplacementCardIds: readonly string[];
  }
): GameState {
  const state = {
    ...game,
    pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
  };
  return continuePendingCardEffects(
    addAction(state, 'RESOLVE_ABILITY', ability.controllerId, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: 'CHECK_OTHER_HASUNOSORA_RELAY_RECOVER_LIVE',
      sourceSlot: ability.sourceSlot,
      ...payload,
    }),
    orderedResolution
  );
}

function getRelayReplacementCardIds(value: unknown): readonly string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((entry): string[] => {
    if (!entry || typeof entry !== 'object') {
      return [];
    }
    const cardId = (entry as { readonly cardId?: unknown }).cardId;
    return typeof cardId === 'string' ? [cardId] : [];
  });
}
