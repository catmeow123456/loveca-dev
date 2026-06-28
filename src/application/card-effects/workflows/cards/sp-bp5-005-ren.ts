import { isMemberCardData } from '../../../../domain/entities/card.js';
import {
  addAction,
  emitGameEvent,
  getCardById,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { createEnterWaitingRoomEvent } from '../../../../domain/events/game-events.js';
import { findMemberSlot } from '../../../../domain/entities/player.js';
import {
  GamePhase,
  OrientationState,
  TriggerCondition,
  ZoneType,
} from '../../../../shared/types/enums.js';
import { cardCodeMatchesBase } from '../../../../shared/utils/card-code.js';
import { cardBelongsToGroup } from '../../../../shared/utils/card-identity.js';
import { payImmediateEffectCosts } from '../../../effects/effect-costs.js';
import { moveTopDeckCardsToWaitingRoom } from '../../../effects/look-top.js';
import {
  SP_BP5_005_ACTIVATED_MILL_THREE_GAIN_BLADE_BY_LIELLA_MEMBER_ABILITY_ID,
  SP_BP5_005_AUTO_MAIN_PHASE_CARD_ENTER_WAITING_ROOM_PAY_ENERGY_RECOVER_ABILITY_ID,
} from '../../ability-ids.js';
import {
  addBladeLiveModifierForSourceMember,
  recoverCardsFromWaitingRoomToHandForPlayer,
} from '../../runtime/actions.js';
import { registerActivatedAbilityHandler } from '../../runtime/activated-registry.js';
import { startPendingActiveEffect } from '../../runtime/active-effect.js';
import type { EnqueueTriggeredCardEffectsForEnterWaitingRoom } from '../../runtime/enter-waiting-room-triggers.js';
import {
  registerPendingAbilityStarterHandler,
  type PendingAbilityStarterOptions,
} from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import {
  getAbilityEffectText,
  recordAbilityUseForContext,
  recordPayCostAction,
} from '../../runtime/workflow-helpers.js';

const MILL_COST_COUNT = 3;
const PAY_ENERGY_STEP_ID = 'SP_BP5_005_PAY_ENERGY_TO_RECOVER_MOVED_CARD';
const SELECT_MOVED_CARD_STEP_ID = 'SP_BP5_005_SELECT_MOVED_CARD_TO_HAND';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerSpBp5005RenWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom;
}): void {
  registerActivatedAbilityHandler(
    SP_BP5_005_ACTIVATED_MILL_THREE_GAIN_BLADE_BY_LIELLA_MEMBER_ABILITY_ID,
    (game, playerId, cardId) =>
      startSpBp5005RenActivated(game, playerId, cardId, deps.enqueueTriggeredCardEffects)
  );
  registerPendingAbilityStarterHandler(
    SP_BP5_005_AUTO_MAIN_PHASE_CARD_ENTER_WAITING_ROOM_PAY_ENERGY_RECOVER_ABILITY_ID,
    (game, ability, options, context) =>
      startSpBp5005RenAuto(game, ability, options, context.continuePendingCardEffects)
  );
  registerActiveEffectStepHandler(
    SP_BP5_005_AUTO_MAIN_PHASE_CARD_ENTER_WAITING_ROOM_PAY_ENERGY_RECOVER_ABILITY_ID,
    PAY_ENERGY_STEP_ID,
    (game, input, context) =>
      input.selectedOptionId === 'pay'
        ? finishPayEnergyForMovedCardRecovery(game, context.continuePendingCardEffects)
        : finishUnpaidActiveAutoEffect(game, context.continuePendingCardEffects, {
            step: 'DECLINE_PAY_ENERGY_RECOVER_MOVED_CARD',
            paidEnergyCardIds: [],
            selectedCardIds: [],
          })
  );
  registerActiveEffectStepHandler(
    SP_BP5_005_AUTO_MAIN_PHASE_CARD_ENTER_WAITING_ROOM_PAY_ENERGY_RECOVER_ABILITY_ID,
    SELECT_MOVED_CARD_STEP_ID,
    (game, input, context) =>
      finishRecoverMovedCard(
        game,
        input.selectedCardId ?? null,
        context.continuePendingCardEffects
      )
  );
}

function startSpBp5005RenActivated(
  game: GameState,
  playerId: string,
  cardId: string,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom
): GameState {
  if (game.activeEffect || game.currentPhase !== GamePhase.MAIN_PHASE) {
    return game;
  }

  const activePlayerId = game.players[game.activePlayerIndex]?.id ?? null;
  const player = getPlayerById(game, playerId);
  const sourceCard = getCardById(game, cardId);
  const sourceSlot = player ? findMemberSlot(player, cardId) : null;
  if (
    activePlayerId !== playerId ||
    !player ||
    !sourceCard ||
    sourceCard.ownerId !== playerId ||
    !cardCodeMatchesBase(sourceCard.data.cardCode, 'PL!SP-bp5-005') ||
    sourceSlot === null ||
    player.mainDeck.cardIds.length < MILL_COST_COUNT
  ) {
    return game;
  }

  let state = recordAbilityUseForContext(game, player.id, {
    abilityId: SP_BP5_005_ACTIVATED_MILL_THREE_GAIN_BLADE_BY_LIELLA_MEMBER_ABILITY_ID,
    sourceCardId: cardId,
  });
  const millResult = moveTopDeckCardsToWaitingRoom(state, player.id, MILL_COST_COUNT);
  if (!millResult || millResult.movedCardIds.length !== MILL_COST_COUNT) {
    return game;
  }
  state = recordPayCostAction(millResult.gameState, player.id, {
    abilityId: SP_BP5_005_ACTIVATED_MILL_THREE_GAIN_BLADE_BY_LIELLA_MEMBER_ABILITY_ID,
    sourceCardId: cardId,
    milledCardIds: millResult.movedCardIds,
    count: millResult.movedCardIds.length,
  });
  state = enqueueMilledCardsEnterWaitingRoomTriggers(
    state,
    player.id,
    millResult.movedCardIds,
    enqueueTriggeredCardEffects
  );

  const liellaMemberCount = millResult.movedCardIds.filter((movedCardId) =>
    isLiellaMemberCard(state, movedCardId)
  ).length;
  if (liellaMemberCount > 0) {
    const bladeResult = addBladeLiveModifierForSourceMember(state, {
      playerId: player.id,
      sourceCardId: cardId,
      abilityId: SP_BP5_005_ACTIVATED_MILL_THREE_GAIN_BLADE_BY_LIELLA_MEMBER_ABILITY_ID,
      amount: liellaMemberCount,
    });
    if (!bladeResult) {
      return game;
    }
    state = bladeResult.gameState;
  }

  return addAction(state, 'RESOLVE_ABILITY', player.id, {
    abilityId: SP_BP5_005_ACTIVATED_MILL_THREE_GAIN_BLADE_BY_LIELLA_MEMBER_ABILITY_ID,
    sourceCardId: cardId,
    step: 'MILL_THREE_GAIN_BLADE_BY_LIELLA_MEMBER',
    sourceSlot,
    milledCardIds: millResult.movedCardIds,
    liellaMemberCount,
    bladeBonus: liellaMemberCount,
  });
}

function startSpBp5005RenAuto(
  game: GameState,
  ability: PendingAbilityState,
  options: PendingAbilityStarterOptions,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player || !isOwnMainPhase(game, player.id)) {
    return consumePendingAutoAbilityWithoutUse(
      game,
      ability,
      ability.controllerId,
      options.orderedResolution === true,
      {
        step: 'NO_OP_AUTO_RECOVER_MOVED_CARD',
        reason: player ? 'NOT_OWN_MAIN_PHASE' : 'MISSING_PLAYER',
      },
      continuePendingCardEffects
    );
  }

  const movedCardIds = getMovedCardIdsFromPendingAbility(ability);
  const selectableCardIds = getRecoverableMovedWaitingRoomCardIds(game, player.id, movedCardIds);
  if (selectableCardIds.length === 0) {
    return consumePendingAutoAbilityWithoutUse(
      game,
      ability,
      player.id,
      options.orderedResolution === true,
      {
        step: 'NO_OP_AUTO_RECOVER_MOVED_CARD',
        reason: 'NO_LEGAL_MOVED_CARD',
        movedCardIds,
      },
      continuePendingCardEffects
    );
  }

  const activeEnergyCardIds = getActiveEnergyCardIds(player);
  return startPendingActiveEffect(game, {
    ability,
    playerId: player.id,
    activeEffect: {
      id: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      controllerId: player.id,
      effectText: getAbilityEffectText(ability.abilityId),
      stepId: PAY_ENERGY_STEP_ID,
      stepText:
        '可以支付1张活跃能量，从本次进入休息室的卡中选择1张加入手牌。',
      awaitingPlayerId: player.id,
      selectableOptions:
        activeEnergyCardIds.length > 0
          ? [
              { id: 'pay', label: '支付1能量' },
              { id: 'decline', label: '不发动' },
            ]
          : [{ id: 'decline', label: '不发动' }],
      metadata: {
        orderedResolution: options.orderedResolution === true,
        movedCardIds,
        selectableCardIds,
        activeEnergyCardIds,
      },
    },
    actionPayload: {
      sourceCardId: ability.sourceCardId,
      step: 'START_PAY_ENERGY_RECOVER_MOVED_CARD_OPTION',
      movedCardIds,
      selectableCardIds,
      activeEnergyCardIds,
    },
  });
}

function finishPayEnergyForMovedCardRecovery(
  game: GameState,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  const player = effect ? getPlayerById(game, effect.controllerId) : null;
  if (!effect || effect.stepId !== PAY_ENERGY_STEP_ID || !player) {
    return game;
  }

  const costPayment = payImmediateEffectCosts(game, player.id, effect.sourceCardId, [
    { kind: 'TAP_ACTIVE_ENERGY', count: 1 },
  ]);
  if (!costPayment) {
    return game;
  }

  const stateAfterCost = recordPayCostAction(costPayment.gameState, player.id, {
    pendingAbilityId: effect.id,
    abilityId: effect.abilityId,
    sourceCardId: effect.sourceCardId,
    energyCardIds: costPayment.paidEnergyCardIds,
    amount: costPayment.paidEnergyCardIds.length,
  });
  const movedCardIds = getMovedCardIdsFromActiveEffect(game);
  const selectableCardIds = getRecoverableMovedWaitingRoomCardIds(
    stateAfterCost,
    player.id,
    movedCardIds
  );
  if (selectableCardIds.length === 0) {
    return finishPaidActiveAutoEffect(
      { ...stateAfterCost, activeEffect: effect },
      continuePendingCardEffects,
      {
        step: 'PAY_ENERGY_NO_LEGAL_MOVED_CARD',
        movedCardIds,
        paidEnergyCardIds: costPayment.paidEnergyCardIds,
        selectedCardIds: [],
      }
    );
  }

  return addAction(
    {
      ...stateAfterCost,
      activeEffect: {
        ...effect,
        stepId: SELECT_MOVED_CARD_STEP_ID,
        stepText: '请选择本次进入休息室的1张卡加入手牌。',
        selectableOptions: undefined,
        selectableCardIds,
        selectableCardMode: 'SINGLE',
        minSelectableCards: 1,
        maxSelectableCards: 1,
        selectableCardVisibility: 'PUBLIC',
        selectionLabel: '选择要加入手牌的卡',
        confirmSelectionLabel: '加入手牌',
        canSkipSelection: false,
        metadata: {
          ...effect.metadata,
          movedCardIds,
          selectableCardIds,
          paidEnergyCardIds: costPayment.paidEnergyCardIds,
        },
      },
    },
    'RESOLVE_ABILITY',
    player.id,
    {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'PAY_ENERGY_SELECT_MOVED_CARD',
      movedCardIds,
      paidEnergyCardIds: costPayment.paidEnergyCardIds,
      selectableCardIds,
    }
  );
}

function finishRecoverMovedCard(
  game: GameState,
  selectedCardId: string | null,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  const player = effect ? getPlayerById(game, effect.controllerId) : null;
  if (
    !effect ||
    effect.stepId !== SELECT_MOVED_CARD_STEP_ID ||
    !player ||
    !selectedCardId ||
    effect.selectableCardIds?.includes(selectedCardId) !== true
  ) {
    return game;
  }

  const movedCardIds = getMovedCardIdsFromActiveEffect(game);
  const selectableCardIds = getRecoverableMovedWaitingRoomCardIds(game, player.id, movedCardIds);
  if (!selectableCardIds.includes(selectedCardId)) {
    return finishPaidActiveAutoEffect(game, continuePendingCardEffects, {
      step: 'SELECTED_MOVED_CARD_NO_LONGER_LEGAL',
      movedCardIds,
      paidEnergyCardIds: effect.metadata?.paidEnergyCardIds ?? [],
      selectedCardId,
      selectedCardIds: [],
    });
  }

  const recoveryResult = recoverCardsFromWaitingRoomToHandForPlayer(
    game,
    player.id,
    [selectedCardId],
    {
      candidateCardIds: selectableCardIds,
      exactCount: 1,
    }
  );
  if (!recoveryResult) {
    return finishPaidActiveAutoEffect(game, continuePendingCardEffects, {
      step: 'RECOVER_MOVED_CARD_FAILED',
      movedCardIds,
      paidEnergyCardIds: effect.metadata?.paidEnergyCardIds ?? [],
      selectedCardId,
      selectedCardIds: [],
    });
  }

  return finishPaidActiveAutoEffect(
    {
      ...recoveryResult.gameState,
      activeEffect: effect,
    },
    continuePendingCardEffects,
    {
      step: 'RECOVER_MOVED_CARD_TO_HAND',
      movedCardIds,
      paidEnergyCardIds: effect.metadata?.paidEnergyCardIds ?? [],
      selectedCardId: recoveryResult.movedCardIds[0] ?? null,
      selectedCardIds: recoveryResult.movedCardIds,
    }
  );
}

function consumePendingAutoAbilityWithoutUse(
  game: GameState,
  ability: PendingAbilityState,
  playerId: string,
  orderedResolution: boolean,
  payload: Readonly<Record<string, unknown>>,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  let state: GameState = {
    ...game,
    pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
  };
  return continuePendingCardEffects(
    addAction(state, 'RESOLVE_ABILITY', playerId, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      ...payload,
    }),
    orderedResolution
  );
}

function finishUnpaidActiveAutoEffect(
  game: GameState,
  continuePendingCardEffects: ContinuePendingCardEffects,
  payload: Readonly<Record<string, unknown>>
): GameState {
  const effect = game.activeEffect;
  const player = effect ? getPlayerById(game, effect.controllerId) : null;
  if (!effect || !player) {
    return game;
  }

  return continuePendingCardEffects(
    addAction(
      {
        ...game,
        activeEffect: null,
      },
      'RESOLVE_ABILITY',
      player.id,
      {
        pendingAbilityId: effect.id,
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
        ...payload,
      }
    ),
    effect.metadata?.orderedResolution === true
  );
}

function finishPaidActiveAutoEffect(
  game: GameState,
  continuePendingCardEffects: ContinuePendingCardEffects,
  payload: Readonly<Record<string, unknown>>
): GameState {
  const effect = game.activeEffect;
  const player = effect ? getPlayerById(game, effect.controllerId) : null;
  if (!effect || !player) {
    return game;
  }

  let state: GameState = {
    ...game,
    activeEffect: null,
  };
  state = recordAbilityUseForContext(state, player.id, {
    abilityId: effect.abilityId,
    sourceCardId: effect.sourceCardId,
  });
  return continuePendingCardEffects(
    addAction(state, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      ...payload,
    }),
    effect.metadata?.orderedResolution === true
  );
}

function isOwnMainPhase(game: GameState, playerId: string): boolean {
  return (
    game.currentPhase === GamePhase.MAIN_PHASE &&
    game.players[game.activePlayerIndex]?.id === playerId
  );
}

function enqueueMilledCardsEnterWaitingRoomTriggers(
  game: GameState,
  playerId: string,
  movedCardIds: readonly string[],
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom
): GameState {
  if (movedCardIds.length === 0) {
    return game;
  }

  const event = createEnterWaitingRoomEvent(
    movedCardIds,
    ZoneType.MAIN_DECK,
    playerId,
    playerId
  );
  const stateWithEvent = emitGameEvent(game, event);
  return enqueueTriggeredCardEffects(stateWithEvent, [TriggerCondition.ON_ENTER_WAITING_ROOM], {
    enterWaitingRoomEvents: [event],
  });
}

function isLiellaMemberCard(game: GameState, cardId: string): boolean {
  const card = getCardById(game, cardId);
  return !!card && isMemberCardData(card.data) && cardBelongsToGroup(card.data, 'Liella!');
}

function getMovedCardIdsFromPendingAbility(ability: PendingAbilityState): readonly string[] {
  const movedCardIds = ability.metadata?.movedCardIds;
  return Array.isArray(movedCardIds) ? movedCardIds.filter(isString) : [];
}

function getMovedCardIdsFromActiveEffect(game: GameState): readonly string[] {
  const movedCardIds = game.activeEffect?.metadata?.movedCardIds;
  return Array.isArray(movedCardIds) ? movedCardIds.filter(isString) : [];
}

function getRecoverableMovedWaitingRoomCardIds(
  game: GameState,
  playerId: string,
  movedCardIds: readonly string[]
): readonly string[] {
  const player = getPlayerById(game, playerId);
  if (!player) {
    return [];
  }
  return movedCardIds.filter((cardId) => player.waitingRoom.cardIds.includes(cardId));
}

function getActiveEnergyCardIds(
  player: NonNullable<ReturnType<typeof getPlayerById>>
): readonly string[] {
  return player.energyZone.cardIds.filter(
    (cardId) => player.energyZone.cardStates.get(cardId)?.orientation !== OrientationState.WAITING
  );
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}
