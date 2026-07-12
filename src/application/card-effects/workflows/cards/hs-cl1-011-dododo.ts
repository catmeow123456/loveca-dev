import {
  addAction,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { CardType, OrientationState } from '../../../../shared/types/enums.js';
import { and, groupAliasIs, typeIs } from '../../../effects/card-selectors.js';
import { payImmediateEffectCosts } from '../../../effects/effect-costs.js';
import {
  createWaitingRoomToHandEffectState,
  createWaitingRoomToHandSelectionConfig,
  selectWaitingRoomCardIds,
} from '../../../effects/zone-selection.js';
import { HS_CL1_011_LIVE_SUCCESS_PAY_ENERGY_RECOVER_MEMBER_OR_HASUNOSORA_LIVE_ABILITY_ID } from '../../ability-ids.js';
import { startPendingActiveEffect } from '../../runtime/active-effect.js';
import {
  registerPendingAbilityStarterHandler,
  type PendingAbilityStarterOptions,
} from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import {
  getAbilityEffectText,
  recordPayCostAction,
} from '../../runtime/workflow-helpers.js';
import { finishWaitingRoomToHandWorkflow } from '../shared/waiting-room-to-hand.js';

const PAY_ENERGY_STEP_ID = 'HS_CL1_011_PAY_ENERGY_FOR_RECOVERY_CHOICE';
const CHOOSE_RECOVERY_STEP_ID = 'HS_CL1_011_CHOOSE_RECOVERY_MODE';
const SELECT_RECOVERY_CARD_STEP_ID = 'HS_CL1_011_SELECT_WAITING_ROOM_CARD_TO_HAND';
const RECOVER_MEMBER_OPTION_ID = 'recover-member';
const RECOVER_HASUNOSORA_LIVE_OPTION_ID = 'recover-hasunosora-live';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerHsCl1011DododoWorkflowHandlers(): void {
  registerPendingAbilityStarterHandler(
    HS_CL1_011_LIVE_SUCCESS_PAY_ENERGY_RECOVER_MEMBER_OR_HASUNOSORA_LIVE_ABILITY_ID,
    (game, ability, options, context) =>
      startHsCl1011DododoLiveSuccess(
        game,
        ability,
        options,
        context.continuePendingCardEffects
      )
  );
  registerActiveEffectStepHandler(
    HS_CL1_011_LIVE_SUCCESS_PAY_ENERGY_RECOVER_MEMBER_OR_HASUNOSORA_LIVE_ABILITY_ID,
    PAY_ENERGY_STEP_ID,
    (game, input, context) =>
      input.selectedOptionId === 'pay'
        ? finishPayEnergy(game, context.continuePendingCardEffects)
        : finishActiveEffect(game, context.continuePendingCardEffects, {
            step: 'DECLINE_PAY_ENERGY_RECOVERY_CHOICE',
            paidEnergyCardIds: [],
          })
  );
  registerActiveEffectStepHandler(
    HS_CL1_011_LIVE_SUCCESS_PAY_ENERGY_RECOVER_MEMBER_OR_HASUNOSORA_LIVE_ABILITY_ID,
    CHOOSE_RECOVERY_STEP_ID,
    (game, input, context) =>
      finishChooseRecoveryMode(
        game,
        input.selectedOptionId ?? null,
        context.continuePendingCardEffects
      )
  );
  registerActiveEffectStepHandler(
    HS_CL1_011_LIVE_SUCCESS_PAY_ENERGY_RECOVER_MEMBER_OR_HASUNOSORA_LIVE_ABILITY_ID,
    SELECT_RECOVERY_CARD_STEP_ID,
    (game, input, context) =>
      finishWaitingRoomToHandWorkflow(
        game,
        input.selectedCardId ?? null,
        input.selectedCardIds,
        context.continuePendingCardEffects
      )
  );
}

function startHsCl1011DododoLiveSuccess(
  game: GameState,
  ability: PendingAbilityState,
  options: PendingAbilityStarterOptions,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return finishPendingAbility(
      game,
      ability,
      ability.controllerId,
      options.orderedResolution === true,
      {
        step: 'NO_OP_PAY_ENERGY_RECOVERY_CHOICE',
        reason: 'CONTROLLER_NOT_FOUND',
      },
      continuePendingCardEffects
    );
  }

  const activeEnergyCardIds = getActiveEnergyCardIds(player);
  if (activeEnergyCardIds.length === 0) {
    return finishPendingAbility(
      game,
      ability,
      player.id,
      options.orderedResolution === true,
      {
        step: 'NO_OP_PAY_ENERGY_RECOVERY_CHOICE',
        reason: 'NO_ACTIVE_ENERGY',
        activeEnergyCardIds,
      },
      continuePendingCardEffects
    );
  }

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
      stepText: '可以支付[E]；如此做时，选择一种方式从自己的休息室加入手牌。',
      awaitingPlayerId: player.id,
      selectableOptions: [{ id: 'pay', label: '支付[E]' }],
      canSkipSelection: true,
      skipSelectionLabel: '不发动',
      metadata: {
        orderedResolution: options.orderedResolution === true,
        activeEnergyCardIds,
      },
    },
    actionPayload: {
      sourceCardId: ability.sourceCardId,
      step: 'START_PAY_ENERGY_RECOVERY_CHOICE',
      activeEnergyCardIds,
    },
  });
}

function finishPayEnergy(
  game: GameState,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  const player = effect ? getPlayerById(game, effect.controllerId) : null;
  if (
    !effect ||
    !player ||
    effect.abilityId !== HS_CL1_011_LIVE_SUCCESS_PAY_ENERGY_RECOVER_MEMBER_OR_HASUNOSORA_LIVE_ABILITY_ID ||
    effect.stepId !== PAY_ENERGY_STEP_ID
  ) {
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
  const availableModes = getAvailableRecoveryModes(stateAfterCost, player.id);

  if (availableModes.length === 0) {
    return finishActiveEffect(
      {
        ...stateAfterCost,
        activeEffect: {
          ...effect,
          metadata: {
            ...effect.metadata,
            paidEnergyCardIds: costPayment.paidEnergyCardIds,
          },
        },
      },
      continuePendingCardEffects,
      {
        step: 'PAY_ENERGY_NO_RECOVERY_TARGET',
        paidEnergyCardIds: costPayment.paidEnergyCardIds,
      }
    );
  }

  return addAction(
    {
      ...stateAfterCost,
      activeEffect: {
        ...effect,
        stepId: CHOOSE_RECOVERY_STEP_ID,
        stepText: '请选择一种回收方式。',
        selectableOptions: availableModes.map((mode) => ({
          id: mode.optionId,
          label: mode.label,
        })),
        selectableCardIds: undefined,
        selectableCardMode: undefined,
        minSelectableCards: undefined,
        maxSelectableCards: undefined,
        canSkipSelection: false,
        metadata: {
          ...effect.metadata,
          paidEnergyCardIds: costPayment.paidEnergyCardIds,
          availableRecoveryModeIds: availableModes.map((mode) => mode.optionId),
        },
      },
    },
    'RESOLVE_ABILITY',
    player.id,
    {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'PAY_ENERGY_CHOOSE_RECOVERY_MODE',
      paidEnergyCardIds: costPayment.paidEnergyCardIds,
      availableRecoveryModeIds: availableModes.map((mode) => mode.optionId),
    }
  );
}

function finishChooseRecoveryMode(
  game: GameState,
  selectedOptionId: string | null,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  const player = effect ? getPlayerById(game, effect.controllerId) : null;
  if (
    !effect ||
    !player ||
    effect.abilityId !== HS_CL1_011_LIVE_SUCCESS_PAY_ENERGY_RECOVER_MEMBER_OR_HASUNOSORA_LIVE_ABILITY_ID ||
    effect.stepId !== CHOOSE_RECOVERY_STEP_ID ||
    !selectedOptionId ||
    effect.selectableOptions?.some((option) => option.id === selectedOptionId) !== true
  ) {
    return game;
  }

  const selectableCardIds = getRecoveryTargetIds(game, player.id, selectedOptionId);
  if (selectableCardIds.length === 0) {
    return finishActiveEffect(game, continuePendingCardEffects, {
      step: 'RECOVERY_MODE_NO_TARGET',
      selectedRecoveryMode: selectedOptionId,
      paidEnergyCardIds: effect.metadata?.paidEnergyCardIds ?? [],
    });
  }

  return addAction(
    {
      ...game,
      activeEffect: createWaitingRoomToHandEffectState({
        id: effect.id,
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
        controllerId: player.id,
        effectText: effect.effectText,
        stepId: SELECT_RECOVERY_CARD_STEP_ID,
        stepText: getRecoveryStepText(selectedOptionId),
        awaitingPlayerId: player.id,
        selectableCardIds,
        metadata: {
          ...effect.metadata,
          selectedRecoveryMode: selectedOptionId,
        },
        zoneSelection: createWaitingRoomToHandSelectionConfig({
          minCount: 1,
          maxCount: 1,
          optional: false,
        }),
      }),
    },
    'RESOLVE_ABILITY',
    player.id,
    {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'START_SELECT_RECOVERY_CARD',
      selectedRecoveryMode: selectedOptionId,
      selectableCardIds,
      paidEnergyCardIds: effect.metadata?.paidEnergyCardIds ?? [],
    }
  );
}

function finishActiveEffect(
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

function finishPendingAbility(
  game: GameState,
  ability: PendingAbilityState,
  playerId: string,
  orderedResolution: boolean,
  payload: Readonly<Record<string, unknown>>,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  return continuePendingCardEffects(
    addAction(
      {
        ...game,
        pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
      },
      'RESOLVE_ABILITY',
      playerId,
      {
        pendingAbilityId: ability.id,
        abilityId: ability.abilityId,
        sourceCardId: ability.sourceCardId,
        ...payload,
      }
    ),
    orderedResolution
  );
}

function getAvailableRecoveryModes(
  game: GameState,
  playerId: string
): readonly { readonly optionId: string; readonly label: string }[] {
  const modes: { readonly optionId: string; readonly label: string }[] = [];
  if (getMemberWaitingRoomCardIds(game, playerId).length > 0) {
    modes.push({ optionId: RECOVER_MEMBER_OPTION_ID, label: '回收成员卡' });
  }
  if (getHasunosoraLiveWaitingRoomCardIds(game, playerId).length > 0) {
    modes.push({ optionId: RECOVER_HASUNOSORA_LIVE_OPTION_ID, label: '回收『蓮ノ空』LIVE卡' });
  }
  return modes;
}

function getRecoveryTargetIds(
  game: GameState,
  playerId: string,
  selectedOptionId: string
): readonly string[] {
  if (selectedOptionId === RECOVER_MEMBER_OPTION_ID) {
    return getMemberWaitingRoomCardIds(game, playerId);
  }
  if (selectedOptionId === RECOVER_HASUNOSORA_LIVE_OPTION_ID) {
    return getHasunosoraLiveWaitingRoomCardIds(game, playerId);
  }
  return [];
}

function getRecoveryStepText(selectedOptionId: string): string {
  if (selectedOptionId === RECOVER_HASUNOSORA_LIVE_OPTION_ID) {
    return '请选择自己的休息室中1张『蓮ノ空』LIVE卡加入手牌。';
  }
  return '请选择自己的休息室中1张成员卡加入手牌。';
}

function getMemberWaitingRoomCardIds(game: GameState, playerId: string): readonly string[] {
  return selectWaitingRoomCardIds(game, playerId, typeIs(CardType.MEMBER));
}

function getHasunosoraLiveWaitingRoomCardIds(
  game: GameState,
  playerId: string
): readonly string[] {
  const player = getPlayerById(game, playerId);
  if (!player || player.liveZone.cardIds.length < 2) {
    return [];
  }
  return selectWaitingRoomCardIds(
    game,
    playerId,
    and(typeIs(CardType.LIVE), groupAliasIs('蓮ノ空'))
  );
}

function getActiveEnergyCardIds(player: NonNullable<ReturnType<typeof getPlayerById>>): string[] {
  return player.energyZone.cardIds.filter(
    (cardId) => player.energyZone.cardStates.get(cardId)?.orientation !== OrientationState.WAITING
  );
}
