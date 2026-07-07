import {
  addAction,
  getCardById,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { findMemberSlot } from '../../../../domain/entities/player.js';
import { OrientationState } from '../../../../shared/types/enums.js';
import { groupAliasIs } from '../../../effects/card-selectors.js';
import { payImmediateEffectCosts } from '../../../effects/effect-costs.js';
import {
  createWaitingRoomToHandEffectState,
  createWaitingRoomToHandSelectionConfig,
  selectWaitingRoomCardIds,
} from '../../../effects/zone-selection.js';
import { PL_S_BP5_009_ON_ENTER_PAY_ENERGY_RECOVER_SAINTSNOW_GAIN_TWO_BLADE_ABILITY_ID } from '../../ability-ids.js';
import {
  addBladeLiveModifierForSourceMember,
  recoverCardsFromWaitingRoomToHandForPlayer,
} from '../../runtime/actions.js';
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

const PAY_STEP_ID = 'PL_S_BP5_009_PAY_ENERGY_OR_DECLINE';
const SELECT_WAITING_ROOM_STEP_ID = 'PL_S_BP5_009_SELECT_SAINTSNOW_FROM_WAITING_ROOM';
const ABILITY_ID = PL_S_BP5_009_ON_ENTER_PAY_ENERGY_RECOVER_SAINTSNOW_GAIN_TWO_BLADE_ABILITY_ID;

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerSBp5009RubyWorkflowHandlers(): void {
  registerPendingAbilityStarterHandler(ABILITY_ID, (game, ability, options, context) =>
    startSBp5009RubyOnEnter(game, ability, options, context.continuePendingCardEffects)
  );
  registerActiveEffectStepHandler(ABILITY_ID, PAY_STEP_ID, (game, input, context) =>
    input.selectedOptionId === 'pay'
      ? finishSBp5009RubyPayEnergy(game, context.continuePendingCardEffects)
      : finishSBp5009RubyDecline(game, context.continuePendingCardEffects)
  );
  registerActiveEffectStepHandler(ABILITY_ID, SELECT_WAITING_ROOM_STEP_ID, (game, input, context) =>
    finishSBp5009RubyRecover(
      game,
      input.selectedCardId ?? null,
      context.continuePendingCardEffects
    )
  );
}

function startSBp5009RubyOnEnter(
  game: GameState,
  ability: PendingAbilityState,
  options: PendingAbilityStarterOptions,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const orderedResolution = options.orderedResolution === true;
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  const selectableCardIds = getSaintSnowWaitingRoomCardIds(game, player.id);
  const activeEnergyCardIds = getActiveEnergyCardIds(player);
  if (selectableCardIds.length === 0 || activeEnergyCardIds.length === 0) {
    return consumePendingNoOp(
      game,
      ability,
      player.id,
      orderedResolution,
      continuePendingCardEffects,
      selectableCardIds.length === 0 ? 'NO_SAINTSNOW_TARGET' : 'NO_ACTIVE_ENERGY',
      {
        selectableCardIds,
        activeEnergyCardIds,
      }
    );
  }

  return startPendingActiveEffect(game, {
    ability,
    playerId: player.id,
    activeEffect: {
      id: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      controllerId: ability.controllerId,
      effectText: getAbilityEffectText(ABILITY_ID),
      stepId: PAY_STEP_ID,
      stepText:
        '可以支付[E]，从自己的休息室将1张『SaintSnow』的卡加入手牌。如此做时，LIVE结束时为止，获得[BLADE][BLADE]。',
      awaitingPlayerId: player.id,
      selectableOptions: [{ id: 'pay', label: '支付[E]' }],
      canSkipSelection: true,
      skipSelectionLabel: '不发动',
      metadata: {
        orderedResolution,
        activeEnergyCardIds,
        selectableCardIds,
      },
    },
    actionPayload: {
      sourceCardId: ability.sourceCardId,
      step: 'START_PAY_ENERGY_OPTION',
      activeEnergyCardIds,
      selectableCardIds,
    },
  });
}

function finishSBp5009RubyDecline(
  game: GameState,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  if (!effect || effect.abilityId !== ABILITY_ID || effect.stepId !== PAY_STEP_ID) {
    return game;
  }
  const player = getPlayerById(game, effect.controllerId);
  if (!player) {
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
        step: 'DECLINE_PAY_ENERGY_RECOVER_SAINTSNOW',
      }
    ),
    effect.metadata?.orderedResolution === true
  );
}

function finishSBp5009RubyPayEnergy(
  game: GameState,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  if (!effect || effect.abilityId !== ABILITY_ID || effect.stepId !== PAY_STEP_ID) {
    return game;
  }
  const player = getPlayerById(game, effect.controllerId);
  if (!player) {
    return game;
  }

  const costPayment = payImmediateEffectCosts(game, player.id, effect.sourceCardId, [
    { kind: 'TAP_ACTIVE_ENERGY', count: 1 },
  ]);
  if (!costPayment) {
    return finishNoOpActiveEffect(game, continuePendingCardEffects, 'PAY_ENERGY_FAILED', {
      activeEnergyCardIds: getActiveEnergyCardIds(player),
    });
  }

  const stateAfterCost = recordPayCostAction(costPayment.gameState, player.id, {
    pendingAbilityId: effect.id,
    abilityId: effect.abilityId,
    sourceCardId: effect.sourceCardId,
    energyCardIds: costPayment.paidEnergyCardIds,
    amount: costPayment.paidEnergyCardIds.length,
  });
  const selectableCardIds = getSaintSnowWaitingRoomCardIds(stateAfterCost, player.id);
  if (selectableCardIds.length === 0) {
    return continuePendingCardEffects(
      addAction(
        {
          ...stateAfterCost,
          activeEffect: null,
        },
        'RESOLVE_ABILITY',
        player.id,
        {
          pendingAbilityId: effect.id,
          abilityId: effect.abilityId,
          sourceCardId: effect.sourceCardId,
          step: 'NO_SAINTSNOW_TARGET_AFTER_PAY',
          paidEnergyCardIds: costPayment.paidEnergyCardIds,
        }
      ),
      effect.metadata?.orderedResolution === true
    );
  }

  return addAction(
    {
      ...stateAfterCost,
      activeEffect: createWaitingRoomToHandEffectState({
        id: effect.id,
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
        controllerId: effect.controllerId,
        effectText: effect.effectText,
        stepId: SELECT_WAITING_ROOM_STEP_ID,
        stepText: '请选择自己的休息室中1张『SaintSnow』的卡加入手牌。',
        awaitingPlayerId: player.id,
        selectableCardIds,
        canSkipSelection: false,
        metadata: {
          orderedResolution: effect.metadata?.orderedResolution === true,
          paidEnergyCardIds: costPayment.paidEnergyCardIds,
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
      step: 'PAY_ENERGY_SELECT_SAINTSNOW',
      paidEnergyCardIds: costPayment.paidEnergyCardIds,
      selectableCardIds,
    }
  );
}

function finishSBp5009RubyRecover(
  game: GameState,
  selectedCardId: string | null,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  if (!effect || effect.abilityId !== ABILITY_ID || effect.stepId !== SELECT_WAITING_ROOM_STEP_ID) {
    return game;
  }
  const player = getPlayerById(game, effect.controllerId);
  if (!player || selectedCardId === null) {
    return game;
  }

  const recoveryResult = recoverCardsFromWaitingRoomToHandForPlayer(
    game,
    player.id,
    [selectedCardId],
    {
      candidateCardIds: effect.selectableCardIds ?? [],
      exactCount: 1,
    }
  );
  if (!recoveryResult) {
    return game;
  }

  let state = recoveryResult.gameState;
  let bladeBonus = 0;
  if (sourceIsOnStage(state, player.id, effect.sourceCardId)) {
    const bladeResult = addBladeLiveModifierForSourceMember(state, {
      playerId: player.id,
      sourceCardId: effect.sourceCardId,
      abilityId: effect.abilityId,
      amount: 2,
    });
    if (bladeResult) {
      state = bladeResult.gameState;
      bladeBonus = bladeResult.bladeBonus;
    }
  }

  return continuePendingCardEffects(
    addAction(
      {
        ...state,
        activeEffect: null,
      },
      'RESOLVE_ABILITY',
      player.id,
      {
        pendingAbilityId: effect.id,
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
        step: 'RECOVER_SAINTSNOW_GAIN_BLADE',
        paidEnergyCardIds: effect.metadata?.paidEnergyCardIds ?? [],
        selectedCardId: recoveryResult.movedCardIds[0] ?? null,
        selectedCardIds: recoveryResult.movedCardIds,
        bladeBonus,
      }
    ),
    effect.metadata?.orderedResolution === true
  );
}

function finishNoOpActiveEffect(
  game: GameState,
  continuePendingCardEffects: ContinuePendingCardEffects,
  reason: string,
  payload: Readonly<Record<string, unknown>> = {}
): GameState {
  const effect = game.activeEffect;
  if (!effect || effect.abilityId !== ABILITY_ID) {
    return game;
  }
  const player = getPlayerById(game, effect.controllerId);
  if (!player) {
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
        step: 'NO_OP_PAY_ENERGY_RECOVER_SAINTSNOW',
        reason,
        ...payload,
      }
    ),
    effect.metadata?.orderedResolution === true
  );
}

function consumePendingNoOp(
  game: GameState,
  ability: PendingAbilityState,
  playerId: string,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects,
  reason: string,
  payload: Readonly<Record<string, unknown>> = {}
): GameState {
  const state = {
    ...game,
    pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
  };
  return continuePendingCardEffects(
    addAction(state, 'RESOLVE_ABILITY', playerId, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: 'NO_OP_PAY_ENERGY_RECOVER_SAINTSNOW',
      reason,
      ...payload,
    }),
    orderedResolution
  );
}

function getSaintSnowWaitingRoomCardIds(game: GameState, playerId: string): readonly string[] {
  return selectWaitingRoomCardIds(game, playerId, groupAliasIs('SaintSnow'));
}

function getActiveEnergyCardIds(player: NonNullable<ReturnType<typeof getPlayerById>>): string[] {
  return player.energyZone.cardIds.filter(
    (cardId) => player.energyZone.cardStates.get(cardId)?.orientation !== OrientationState.WAITING
  );
}

function sourceIsOnStage(game: GameState, playerId: string, sourceCardId: string): boolean {
  const player = getPlayerById(game, playerId);
  const sourceCard = getCardById(game, sourceCardId);
  return (
    !!player &&
    !!sourceCard &&
    sourceCard.ownerId === playerId &&
    !!findMemberSlot(player, sourceCardId)
  );
}
