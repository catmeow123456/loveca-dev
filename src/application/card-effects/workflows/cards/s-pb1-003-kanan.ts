import { isLiveCardData } from '../../../../domain/entities/card.js';
import {
  addAction,
  getPlayerById,
  type ActiveEffectState,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { replaceLiveModifier } from '../../../../domain/rules/live-modifiers.js';
import { HeartColor, OrientationState, SlotPosition } from '../../../../shared/types/enums.js';
import {
  moveRevealedCheerCards,
  selectRevealedCheerCardIds,
} from '../../../effects/cheer-selection.js';
import { payImmediateEffectCosts } from '../../../effects/effect-costs.js';
import {
  PL_S_PB1_003_LIVE_START_PAY_TWO_ENERGY_ORIGINAL_HEART_GREEN_ABILITY_ID,
  PL_S_PB1_003_LIVE_SUCCESS_RECOVER_REVEALED_CHEER_LIVE_ABILITY_ID,
} from '../../ability-ids.js';
import {
  finishSkippedActiveEffect,
  startPendingActiveEffect,
} from '../../runtime/active-effect.js';
import {
  registerPendingAbilityStarterHandler,
  type PendingAbilityStarterOptions,
} from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import {
  getAbilityEffectText,
  maybeStartManualPendingAbilityConfirmation,
  recordPayCostAction,
} from '../../runtime/workflow-helpers.js';

const PAY_TWO_ENERGY_STEP_ID = 'PL_S_PB1_003_PAY_TWO_ENERGY_ORIGINAL_HEART_GREEN';
const SELECT_LIVE_CHEER_STEP_ID = 'PL_S_PB1_003_SELECT_LIVE_CHEER_TO_HAND';
const ENERGY_COST = 2;

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerSPb1003KananWorkflowHandlers(): void {
  registerPendingAbilityStarterHandler(
    PL_S_PB1_003_LIVE_START_PAY_TWO_ENERGY_ORIGINAL_HEART_GREEN_ABILITY_ID,
    (game, ability, options, context) =>
      startPayTwoEnergyOriginalHeartGreen(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      )
  );
  registerActiveEffectStepHandler(
    PL_S_PB1_003_LIVE_START_PAY_TWO_ENERGY_ORIGINAL_HEART_GREEN_ABILITY_ID,
    PAY_TWO_ENERGY_STEP_ID,
    (game, input, context) =>
      input.selectedOptionId === 'pay'
        ? finishPayTwoEnergyOriginalHeartGreen(game, context.continuePendingCardEffects)
        : finishSkippedActiveEffect(game, context.continuePendingCardEffects, {
            step: 'DECLINE_PAY_TWO_ENERGY',
          })
  );

  registerPendingAbilityStarterHandler(
    PL_S_PB1_003_LIVE_SUCCESS_RECOVER_REVEALED_CHEER_LIVE_ABILITY_ID,
    (game, ability, options, context) =>
      startRecoverRevealedCheerLive(
        game,
        ability,
        options,
        context.continuePendingCardEffects
      )
  );
  registerActiveEffectStepHandler(
    PL_S_PB1_003_LIVE_SUCCESS_RECOVER_REVEALED_CHEER_LIVE_ABILITY_ID,
    SELECT_LIVE_CHEER_STEP_ID,
    (game, input, context) =>
      finishRecoverRevealedCheerLive(
        game,
        input.selectedCardId ?? null,
        context.continuePendingCardEffects
      )
  );
}

function startPayTwoEnergyOriginalHeartGreen(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player || findSourceStageSlot(game, player.id, ability.sourceCardId) === null) {
    return consumePendingNoOp(
      game,
      ability,
      ability.controllerId,
      orderedResolution,
      continuePendingCardEffects,
      'SOURCE_NOT_ON_STAGE'
    );
  }

  const activeEnergyCardIds = player.energyZone.cardIds.filter(
    (cardId) => player.energyZone.cardStates.get(cardId)?.orientation !== OrientationState.WAITING
  );
  const canPay = activeEnergyCardIds.length >= ENERGY_COST;

  return startPendingActiveEffect(game, {
    ability,
    playerId: player.id,
    activeEffect: {
      id: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      controllerId: ability.controllerId,
      effectText: getAbilityEffectText(ability.abilityId),
      stepId: PAY_TWO_ENERGY_STEP_ID,
      stepText: canPay
        ? '可以支付[E][E]；支付后，LIVE结束时为止，此成员原本持有的 Heart 全部变为[緑ハート]。'
        : '当前活跃能量不足，无法支付[E][E]，可以不发动。',
      awaitingPlayerId: player.id,
      selectableOptions: canPay
        ? [
            { id: 'pay', label: '支付[E][E]' },
            { id: 'decline', label: '不发动' },
          ]
        : [{ id: 'decline', label: '不发动' }],
      metadata: {
        orderedResolution,
        activeEnergyCardIds,
        energyCostCount: ENERGY_COST,
      },
    },
    actionPayload: {
      sourceCardId: ability.sourceCardId,
      step: 'START_PAY_TWO_ENERGY_OPTION',
      activeEnergyCardIds,
      canPay,
    },
  });
}

function finishPayTwoEnergyOriginalHeartGreen(
  game: GameState,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = getActiveEffect(
    game,
    PL_S_PB1_003_LIVE_START_PAY_TWO_ENERGY_ORIGINAL_HEART_GREEN_ABILITY_ID,
    PAY_TWO_ENERGY_STEP_ID
  );
  if (!effect) {
    return game;
  }
  const player = getPlayerById(game, effect.controllerId);
  if (!player || findSourceStageSlot(game, player.id, effect.sourceCardId) === null) {
    return game;
  }

  const costPayment = payImmediateEffectCosts(game, player.id, effect.sourceCardId, [
    { kind: 'TAP_ACTIVE_ENERGY', count: ENERGY_COST },
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
  const stateWithModifier = replaceLiveModifier(
    { ...stateAfterCost, activeEffect: null },
    {
      kind: 'MEMBER_ORIGINAL_HEART_REPLACEMENT',
      playerId: player.id,
      sourceCardId: effect.sourceCardId,
      abilityId: effect.abilityId,
    },
    {
      kind: 'MEMBER_ORIGINAL_HEART_REPLACEMENT',
      playerId: player.id,
      memberCardId: effect.sourceCardId,
      color: HeartColor.GREEN,
      sourceCardId: effect.sourceCardId,
      abilityId: effect.abilityId,
    }
  );

  return continuePendingCardEffects(
    addAction(stateWithModifier, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'PAY_TWO_ENERGY_REPLACE_ORIGINAL_HEART_GREEN',
      paidEnergyCardIds: costPayment.paidEnergyCardIds,
      heartColor: HeartColor.GREEN,
    }),
    effect.metadata?.orderedResolution === true
  );
}

function startRecoverRevealedCheerLive(
  game: GameState,
  ability: PendingAbilityState,
  options: PendingAbilityStarterOptions,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player || findSourceStageSlot(game, ability.controllerId, ability.sourceCardId) === null) {
    return consumePendingNoOp(
      game,
      ability,
      ability.controllerId,
      options.orderedResolution === true,
      continuePendingCardEffects,
      'SOURCE_NOT_ON_STAGE'
    );
  }

  const selectableCardIds = selectLiveRevealedCheerCardIds(game, player.id);
  if (selectableCardIds.length === 0) {
    const manualConfirmation = maybeStartManualPendingAbilityConfirmation(game, ability, options);
    if (manualConfirmation) {
      return manualConfirmation;
    }
    return consumePendingNoOp(
      game,
      ability,
      player.id,
      options.orderedResolution === true,
      continuePendingCardEffects,
      'NO_LIVE_REVEALED_CHEER_TARGET',
      { selectableCardIds }
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
      stepId: SELECT_LIVE_CHEER_STEP_ID,
      stepText: '请选择1张因自己的声援公开的自己的 LIVE 卡加入手牌。',
      awaitingPlayerId: player.id,
      selectableCardIds,
      selectableCardVisibility: 'PUBLIC',
      selectableCardMode: 'SINGLE',
      selectionLabel: '选择声援公开的 LIVE 卡',
      confirmSelectionLabel: '加入手牌',
      canSkipSelection: false,
      metadata: {
        orderedResolution: options.orderedResolution === true,
        publicCardSelectionConfirmation: {
          source: 'REVEALED_CHEER',
          destination: 'HAND',
        },
      },
    },
    actionPayload: {
      sourceCardId: ability.sourceCardId,
      step: 'START_SELECT_LIVE_REVEALED_CHEER_TO_HAND',
      selectableCardIds,
    },
  });
}

function finishRecoverRevealedCheerLive(
  game: GameState,
  selectedCardId: string | null,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = getActiveEffect(
    game,
    PL_S_PB1_003_LIVE_SUCCESS_RECOVER_REVEALED_CHEER_LIVE_ABILITY_ID,
    SELECT_LIVE_CHEER_STEP_ID
  );
  if (
    !effect ||
    selectedCardId === null ||
    effect.selectableCardIds?.includes(selectedCardId) !== true
  ) {
    return game;
  }
  const player = getPlayerById(game, effect.controllerId);
  if (!player || findSourceStageSlot(game, player.id, effect.sourceCardId) === null) {
    return consumeActiveEffectNoMove(
      game,
      effect,
      effect.controllerId,
      continuePendingCardEffects,
      'SOURCE_NOT_ON_STAGE'
    );
  }

  const currentSelectableCardIds = selectLiveRevealedCheerCardIds(game, player.id);
  if (!currentSelectableCardIds.includes(selectedCardId)) {
    return game;
  }
  const moveResult = moveRevealedCheerCards(game, player.id, [selectedCardId], 'HAND');
  if (!moveResult) {
    return game;
  }

  return continuePendingCardEffects(
    addAction({ ...moveResult.gameState, activeEffect: null }, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'MOVE_LIVE_REVEALED_CHEER_TO_HAND',
      selectedCardId,
      movedCardIds: moveResult.movedCardIds,
    }),
    effect.metadata?.orderedResolution === true
  );
}

function selectLiveRevealedCheerCardIds(game: GameState, playerId: string): readonly string[] {
  return selectRevealedCheerCardIds(game, playerId, (card) => {
    return isLiveCardData(card.data);
  });
}

function findSourceStageSlot(
  game: GameState,
  playerId: string,
  sourceCardId: string
): SlotPosition | null {
  const player = getPlayerById(game, playerId);
  if (!player) {
    return null;
  }
  return (
    (Object.values(SlotPosition).find(
      (slot) => player.memberSlots.slots[slot] === sourceCardId
    ) as SlotPosition | undefined) ?? null
  );
}

function getActiveEffect(
  game: GameState,
  abilityId: string,
  stepId: string
): ActiveEffectState | null {
  const effect = game.activeEffect;
  if (!effect || effect.abilityId !== abilityId || effect.stepId !== stepId) {
    return null;
  }
  return effect;
}

function consumePendingNoOp(
  game: GameState,
  ability: PendingAbilityState,
  playerId: string,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects,
  step: string,
  payload: Readonly<Record<string, unknown>> = {}
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
        step,
        ...payload,
      }
    ),
    orderedResolution
  );
}

function consumeActiveEffectNoMove(
  game: GameState,
  effect: ActiveEffectState,
  playerId: string,
  continuePendingCardEffects: ContinuePendingCardEffects,
  step: string
): GameState {
  return continuePendingCardEffects(
    addAction({ ...game, activeEffect: null }, 'RESOLVE_ABILITY', playerId, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step,
      selectedCardId: null,
      movedCardIds: [],
    }),
    effect.metadata?.orderedResolution === true
  );
}
