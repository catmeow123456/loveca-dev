import {
  addAction,
  getCardById,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import type { WaitingRoomCardsMovedToMainDeckEvent } from '../../../../domain/events/game-events.js';
import { OrientationState, TriggerCondition, ZoneType } from '../../../../shared/types/enums.js';
import { unitAliasIs } from '../../../effects/card-selectors.js';
import { getEnergyCardIdsByOrientation } from '../../../effects/energy.js';
import {
  HS_BP8_001_AUTO_WAITING_ROOM_TO_DECK_GAIN_THREE_BLADE_ABILITY_ID,
  HS_BP8_001_ON_ENTER_MILL_THREE_ALL_CERISE_ACTIVATE_ENERGY_ABILITY_ID,
} from '../../ability-ids.js';
import {
  activateWaitingEnergyCardsForPlayer,
  addBladeLiveModifierForSourceMember,
} from '../../runtime/actions.js';
import { startPendingActiveEffect } from '../../runtime/active-effect.js';
import type { EnqueueTriggeredCardEffectsForEnterWaitingRoom } from '../../runtime/enter-waiting-room-triggers.js';
import { moveTopDeckCardsToWaitingRoomWithRefreshAndEnqueueTriggers } from '../../runtime/main-deck-waiting-room-triggers.js';
import {
  registerPendingAbilityStarterHandler,
  type PendingAbilityStarterOptions,
} from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import {
  getAbilityEffectText,
  maybeStartConfirmablePendingAbilityConfirmation,
  recordAbilityUseForContext,
} from '../../runtime/workflow-helpers.js';

const REVEAL_MILLED_STEP_ID = 'HS_BP8_001_REVEAL_MILLED_TOP_THREE';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerHsBp8001KahoWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom;
}): void {
  registerPendingAbilityStarterHandler(
    HS_BP8_001_ON_ENTER_MILL_THREE_ALL_CERISE_ACTIVATE_ENERGY_ABILITY_ID,
    (game, ability, options) =>
      startMillThree(
        game,
        ability,
        options.orderedResolution === true,
        deps.enqueueTriggeredCardEffects
      )
  );
  registerActiveEffectStepHandler(
    HS_BP8_001_ON_ENTER_MILL_THREE_ALL_CERISE_ACTIVATE_ENERGY_ABILITY_ID,
    REVEAL_MILLED_STEP_ID,
    (game, _input, context) => finishMillThree(game, context.continuePendingCardEffects)
  );
  registerPendingAbilityStarterHandler(
    HS_BP8_001_AUTO_WAITING_ROOM_TO_DECK_GAIN_THREE_BLADE_ABILITY_ID,
    (game, ability, options, context) =>
      startWaitingRoomToDeckBlade(game, ability, options, context.continuePendingCardEffects)
  );
}

function startMillThree(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) return game;
  const mill = moveTopDeckCardsToWaitingRoomWithRefreshAndEnqueueTriggers(
    game,
    player.id,
    3,
    enqueueTriggeredCardEffects,
    {
      cause: {
        kind: 'CARD_EFFECT',
        playerId: player.id,
        sourceCardId: ability.sourceCardId,
        abilityId: ability.abilityId,
        pendingAbilityId: ability.id,
      },
    }
  );
  if (!mill) return game;

  const milledCardIds = mill.movedCardIds;
  const allCeriseBouquet =
    milledCardIds.length > 0 &&
    milledCardIds.every((cardId) => {
      const card = getCardById(mill.gameState, cardId);
      return card !== null && unitAliasIs('Cerise Bouquet')(card);
    });
  return startPendingActiveEffect(mill.gameState, {
    ability,
    playerId: player.id,
    activeEffect: {
      id: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      controllerId: player.id,
      effectText: getAbilityEffectText(ability.abilityId),
      stepId: REVEAL_MILLED_STEP_ID,
      stepText: `已将卡组顶合计${milledCardIds.length}张放置入休息室。`,
      awaitingPlayerId: player.id,
      revealedCardIds: [...new Set(milledCardIds)],
      metadata: {
        sourceZone: ZoneType.MAIN_DECK,
        orderedResolution,
        milledCardIds,
        refreshCount: mill.refreshCount,
        allCeriseBouquet,
      },
    },
    actionPayload: {
      step: 'MILL_TOP_THREE',
      milledCardIds,
      refreshCount: mill.refreshCount,
      allCeriseBouquet,
    },
  });
}

function finishMillThree(
  game: GameState,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !== HS_BP8_001_ON_ENTER_MILL_THREE_ALL_CERISE_ACTIVATE_ENERGY_ABILITY_ID ||
    effect.stepId !== REVEAL_MILLED_STEP_ID
  ) {
    return game;
  }
  const player = getPlayerById(game, effect.controllerId);
  if (!player) return game;
  const milledCardIds = getStringArray(effect.metadata?.milledCardIds);
  const allCeriseBouquet = effect.metadata?.allCeriseBouquet === true;
  const waitingEnergyCount = getEnergyCardIdsByOrientation(
    game,
    player.id,
    OrientationState.WAITING
  ).length;
  const activationCount = allCeriseBouquet ? Math.min(2, waitingEnergyCount) : 0;
  const activation =
    activationCount > 0
      ? activateWaitingEnergyCardsForPlayer(game, player.id, activationCount)
      : null;
  const state = activation?.gameState ?? game;
  return continuePendingCardEffects(
    addAction({ ...state, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: allCeriseBouquet ? 'ALL_CERISE_ACTIVATE_ENERGY' : 'NOT_ALL_CERISE',
      milledCardIds,
      allCeriseBouquet,
      activatedEnergyCardIds: activation?.activatedEnergyCardIds ?? [],
      requestedActivationCount: 2,
    }),
    effect.metadata?.orderedResolution === true
  );
}

function startWaitingRoomToDeckBlade(
  game: GameState,
  ability: PendingAbilityState,
  options: PendingAbilityStarterOptions,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const confirmation = maybeStartConfirmablePendingAbilityConfirmation(game, ability, options);
  if (confirmation) return confirmation;

  const player = getPlayerById(game, ability.controllerId);
  if (!player) return game;
  let state: GameState = {
    ...game,
    pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
  };
  const event = game.eventLog
    .map((entry) => entry.event)
    .find(
      (candidate): candidate is WaitingRoomCardsMovedToMainDeckEvent =>
        ability.eventIds.includes(candidate.eventId) &&
        candidate.eventType === TriggerCondition.ON_WAITING_ROOM_CARDS_MOVED_TO_MAIN_DECK
    );
  const eventMatches =
    event !== undefined && event.playerId === player.id && event.movedCardIds.length > 0;
  let bladeBonus = 0;
  if (eventMatches) {
    state = recordAbilityUseForContext(state, player.id, {
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      sourceLifecycleId: ability.sourceLifecycleId,
      pendingAbilityId: ability.id,
    });
    const blade = addBladeLiveModifierForSourceMember(state, {
      playerId: player.id,
      sourceCardId: ability.sourceCardId,
      abilityId: ability.abilityId,
      amount: 3,
    });
    if (blade) {
      state = blade.gameState;
      bladeBonus = blade.bladeBonus;
    }
  }
  return continuePendingCardEffects(
    addAction(state, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: eventMatches ? 'WAITING_ROOM_TO_DECK_GAIN_THREE_BLADE' : 'TRIGGER_EVENT_INVALID',
      waitingRoomToDeckEventId: event?.eventId ?? null,
      movedCardIds: event?.movedCardIds ?? [],
      bladeBonus,
    }),
    options.orderedResolution === true
  );
}

function getStringArray(value: unknown): readonly string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : [];
}
