import {
  addAction,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import type { PlayerState } from '../../../../domain/entities/player.js';
import { OrientationState } from '../../../../shared/types/enums.js';
import { unitAliasIs } from '../../../effects/card-selectors.js';
import { payImmediateEffectCosts } from '../../../effects/effect-costs.js';
import {
  createWaitingRoomToHandEffectState,
  createWaitingRoomToHandSelectionConfig,
  selectWaitingRoomCardIds,
} from '../../../effects/zone-selection.js';
import { HS_CL1_002_ON_ENTER_PAY_ENERGY_RECOVER_DOLLCHESTRA_CARD_ABILITY_ID } from '../../ability-ids.js';
import { startPendingActiveEffect } from '../../runtime/active-effect.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText, recordPayCostAction } from '../../runtime/workflow-helpers.js';
import { finishWaitingRoomToHandWorkflow } from '../shared/waiting-room-to-hand.js';

const PAY_ENERGY_STEP_ID = 'HS_CL1_002_PAY_ENERGY_FOR_DOLLCHESTRA_RECOVERY';
const SELECT_DOLLCHESTRA_CARD_STEP_ID = 'HS_CL1_002_SELECT_DOLLCHESTRA_CARD_FROM_WAITING_ROOM';
const DOLLCHESTRA_UNIT_ALIAS = 'DOLLCHESTRA';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerHsCl1002SayakaWorkflowHandlers(): void {
  registerPendingAbilityStarterHandler(
    HS_CL1_002_ON_ENTER_PAY_ENERGY_RECOVER_DOLLCHESTRA_CARD_ABILITY_ID,
    (game, ability, options, context) =>
      startHsCl1002SayakaOnEnter(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      )
  );
  registerActiveEffectStepHandler(
    HS_CL1_002_ON_ENTER_PAY_ENERGY_RECOVER_DOLLCHESTRA_CARD_ABILITY_ID,
    PAY_ENERGY_STEP_ID,
    (game, input, context) =>
      input.selectedOptionId === 'pay'
        ? finishHsCl1002SayakaPayEnergy(game, context.continuePendingCardEffects)
        : finishHsCl1002SayakaDecline(game, context.continuePendingCardEffects)
  );
  registerActiveEffectStepHandler(
    HS_CL1_002_ON_ENTER_PAY_ENERGY_RECOVER_DOLLCHESTRA_CARD_ABILITY_ID,
    SELECT_DOLLCHESTRA_CARD_STEP_ID,
    (game, input, context) =>
      finishWaitingRoomToHandWorkflow(
        game,
        input.selectedCardId ?? null,
        input.selectedCardIds,
        context.continuePendingCardEffects
      )
  );
}

function startHsCl1002SayakaOnEnter(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  const sourceOnStage = Object.values(player.memberSlots.slots).includes(ability.sourceCardId);
  const activeEnergyCardIds = getActiveEnergyCardIds(player);
  const selectableCardIds = selectDollchestraWaitingRoomCardIds(game, player.id);
  if (!sourceOnStage || activeEnergyCardIds.length === 0 || selectableCardIds.length === 0) {
    return finishPendingAbility(
      game,
      ability,
      player.id,
      orderedResolution,
      {
        step: 'NO_OP_CHECK_PAY_ENERGY_DOLLCHESTRA_RECOVERY',
        reason: !sourceOnStage
          ? 'SOURCE_NOT_ON_STAGE'
          : activeEnergyCardIds.length === 0
            ? 'NO_ACTIVE_ENERGY'
            : 'NO_DOLLCHESTRA_TARGET',
        activeEnergyCardIds,
        selectableCardIds,
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
      controllerId: ability.controllerId,
      effectText: getAbilityEffectText(ability.abilityId),
      stepId: PAY_ENERGY_STEP_ID,
      stepText:
        '可以支付1张活跃能量；如此做时，从自己的休息室将1张『DOLLCHESTRA』卡片加入手牌。',
      awaitingPlayerId: player.id,
      selectableOptions: [{ id: 'pay', label: '支付1能量' }],
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
      step: 'START_PAY_ENERGY_DOLLCHESTRA_RECOVERY',
      activeEnergyCardIds,
      selectableCardIds,
    },
  });
}

function finishHsCl1002SayakaDecline(
  game: GameState,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  const player = effect ? getPlayerById(game, effect.controllerId) : null;
  if (
    !effect ||
    !player ||
    effect.abilityId !== HS_CL1_002_ON_ENTER_PAY_ENERGY_RECOVER_DOLLCHESTRA_CARD_ABILITY_ID ||
    effect.stepId !== PAY_ENERGY_STEP_ID
  ) {
    return game;
  }

  return continuePendingCardEffects(
    addAction({ ...game, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'DECLINE_PAY_ENERGY_DOLLCHESTRA_RECOVERY',
    }),
    effect.metadata?.orderedResolution === true
  );
}

function finishHsCl1002SayakaPayEnergy(
  game: GameState,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  const player = effect ? getPlayerById(game, effect.controllerId) : null;
  if (
    !effect ||
    !player ||
    effect.abilityId !== HS_CL1_002_ON_ENTER_PAY_ENERGY_RECOVER_DOLLCHESTRA_CARD_ABILITY_ID ||
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
  const selectableCardIds = selectDollchestraWaitingRoomCardIds(stateAfterCost, player.id);

  if (selectableCardIds.length === 0) {
    return continuePendingCardEffects(
      addAction({ ...stateAfterCost, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
        pendingAbilityId: effect.id,
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
        step: 'PAY_ENERGY_DOLLCHESTRA_RECOVERY_NO_TARGET_AFTER_COST',
        paidEnergyCardIds: costPayment.paidEnergyCardIds,
        selectableCardIds,
      }),
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
        controllerId: player.id,
        effectText: effect.effectText,
        stepId: SELECT_DOLLCHESTRA_CARD_STEP_ID,
        stepText: '请选择自己的休息室中1张『DOLLCHESTRA』卡片加入手牌。',
        awaitingPlayerId: player.id,
        selectableCardIds,
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
      step: 'PAY_ENERGY_SELECT_DOLLCHESTRA_CARD',
      paidEnergyCardIds: costPayment.paidEnergyCardIds,
      selectableCardIds,
    }
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

function selectDollchestraWaitingRoomCardIds(
  game: GameState,
  playerId: string
): readonly string[] {
  return selectWaitingRoomCardIds(game, playerId, unitAliasIs(DOLLCHESTRA_UNIT_ALIAS));
}

function getActiveEnergyCardIds(player: PlayerState): string[] {
  return player.energyZone.cardIds.filter(
    (cardId) =>
      player.energyZone.cardStates.get(cardId)?.orientation !== OrientationState.WAITING
  );
}
