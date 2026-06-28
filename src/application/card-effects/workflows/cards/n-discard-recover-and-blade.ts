import {
  addAction,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { CardType } from '../../../../shared/types/enums.js';
import { and, groupAliasIs, typeIs } from '../../../effects/card-selectors.js';
import {
  createWaitingRoomToHandEffectState,
  createWaitingRoomToHandSelectionConfig,
  selectWaitingRoomCardIds,
} from '../../../effects/zone-selection.js';
import {
  N_BP1_005_LIVE_START_DISCARD_GAIN_ONE_BLADE_ABILITY_ID,
  N_BP5_022_ON_ENTER_DISCARD_RECOVER_NIJIGASAKI_LIVE_ABILITY_ID,
  N_SD1_004_LIVE_START_DISCARD_GAIN_TWO_BLADE_ABILITY_ID,
} from '../../ability-ids.js';
import {
  createOptionalDiscardHandToWaitingRoomActiveEffect,
  finishSkippedActiveEffect,
  startPendingActiveEffect,
} from '../../runtime/active-effect.js';
import { addBladeLiveModifierForSourceMember } from '../../runtime/actions.js';
import {
  discardOneHandCardToWaitingRoomAndEnqueueTriggers,
  type EnqueueTriggeredCardEffectsForEnterWaitingRoom,
} from '../../runtime/enter-waiting-room-triggers.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText } from '../../runtime/workflow-helpers.js';
import { finishWaitingRoomToHandWorkflow } from '../shared/waiting-room-to-hand.js';

export const N_SD1_004_SELECT_DISCARD_STEP_ID = 'N_SD1_004_SELECT_DISCARD_FOR_BLADE';
export const N_BP1_005_SELECT_DISCARD_STEP_ID = 'N_BP1_005_SELECT_DISCARD_FOR_BLADE';
export const N_BP5_022_SELECT_DISCARD_STEP_ID =
  'N_BP5_022_SELECT_DISCARD_FOR_NIJIGASAKI_LIVE_RECOVERY';
export const N_BP5_022_SELECT_RECOVERY_STEP_ID =
  'N_BP5_022_SELECT_NIJIGASAKI_LIVE_FROM_WAITING_ROOM';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

const nijigasakiLive = and(typeIs(CardType.LIVE), groupAliasIs('虹ヶ咲'));

interface DiscardGainBladeConfig {
  readonly abilityId: string;
  readonly stepId: string;
  readonly bladeAmount: number;
  readonly resolvedStep: string;
}

const DISCARD_GAIN_BLADE_CONFIGS: readonly DiscardGainBladeConfig[] = [
  {
    abilityId: N_SD1_004_LIVE_START_DISCARD_GAIN_TWO_BLADE_ABILITY_ID,
    stepId: N_SD1_004_SELECT_DISCARD_STEP_ID,
    bladeAmount: 2,
    resolvedStep: 'DISCARD_HAND_CARD_GAIN_TWO_BLADE',
  },
  {
    abilityId: N_BP1_005_LIVE_START_DISCARD_GAIN_ONE_BLADE_ABILITY_ID,
    stepId: N_BP1_005_SELECT_DISCARD_STEP_ID,
    bladeAmount: 1,
    resolvedStep: 'DISCARD_HAND_CARD_GAIN_ONE_BLADE',
  },
];

export function registerNDiscardRecoverAndBladeWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom;
}): void {
  for (const config of DISCARD_GAIN_BLADE_CONFIGS) {
    registerPendingAbilityStarterHandler(config.abilityId, (game, ability, options, context) =>
      startLiveStartDiscardGainBlade(
        game,
        ability,
        config,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      )
    );
    registerActiveEffectStepHandler(config.abilityId, config.stepId, (game, input, context) =>
      input.selectedCardId
        ? finishDiscardGainBlade(
            game,
            input.selectedCardId,
            config,
            context.continuePendingCardEffects,
            deps.enqueueTriggeredCardEffects
          )
        : finishSkippedActiveEffect(game, context.continuePendingCardEffects)
    );
  }

  registerPendingAbilityStarterHandler(
    N_BP5_022_ON_ENTER_DISCARD_RECOVER_NIJIGASAKI_LIVE_ABILITY_ID,
    (game, ability, options, context) =>
      startShiorikoOnEnterDiscardRecoverLive(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      )
  );
  registerActiveEffectStepHandler(
    N_BP5_022_ON_ENTER_DISCARD_RECOVER_NIJIGASAKI_LIVE_ABILITY_ID,
    N_BP5_022_SELECT_DISCARD_STEP_ID,
    (game, input, context) =>
      input.selectedCardId
        ? finishShiorikoDiscardCost(
            game,
            input.selectedCardId,
            context.continuePendingCardEffects,
            deps.enqueueTriggeredCardEffects
          )
        : finishSkippedActiveEffect(game, context.continuePendingCardEffects)
  );
  registerActiveEffectStepHandler(
    N_BP5_022_ON_ENTER_DISCARD_RECOVER_NIJIGASAKI_LIVE_ABILITY_ID,
    N_BP5_022_SELECT_RECOVERY_STEP_ID,
    (game, input, context) =>
      finishWaitingRoomToHandWorkflow(
        game,
        input.selectedCardId ?? null,
        input.selectedCardIds,
        context.continuePendingCardEffects
      )
  );
}

function startLiveStartDiscardGainBlade(
  game: GameState,
  ability: PendingAbilityState,
  config: DiscardGainBladeConfig,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }
  if (!isOwnStageMember(game, player.id, ability.sourceCardId)) {
    return finishPendingAbility(
      game,
      ability,
      player.id,
      orderedResolution,
      {
        step: 'NO_OP_DISCARD_GAIN_BLADE',
        reason: 'SOURCE_NOT_ON_STAGE',
      },
      continuePendingCardEffects
    );
  }
  if (player.hand.cardIds.length === 0) {
    return finishPendingAbility(
      game,
      ability,
      player.id,
      orderedResolution,
      {
        step: 'NO_OP_DISCARD_GAIN_BLADE',
        reason: 'NO_HAND',
      },
      continuePendingCardEffects
    );
  }

  return startPendingActiveEffect(game, {
    ability,
    playerId: player.id,
      activeEffect: createOptionalDiscardHandToWaitingRoomActiveEffect({
        ability,
        playerId: player.id,
        effectText: getAbilityEffectText(config.abilityId),
        stepId: config.stepId,
        selectableCardIds: player.hand.cardIds,
        orderedResolution,
      }),
    actionPayload: {
      sourceCardId: ability.sourceCardId,
      sourceSlot: ability.sourceSlot,
      step: 'START_SELECT_DISCARD_FOR_BLADE',
      selectableCardIds: player.hand.cardIds,
    },
  });
}

function finishDiscardGainBlade(
  game: GameState,
  selectedCardId: string,
  config: DiscardGainBladeConfig,
  continuePendingCardEffects: ContinuePendingCardEffects,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom
): GameState {
  const effect = game.activeEffect;
  const player = effect ? getPlayerById(game, effect.controllerId) : null;
  if (
    !effect ||
    effect.abilityId !== config.abilityId ||
    effect.stepId !== config.stepId ||
    !player ||
    effect.selectableCardIds?.includes(selectedCardId) !== true ||
    !player.hand.cardIds.includes(selectedCardId)
  ) {
    return game;
  }

  const discardResult = discardOneHandCardToWaitingRoomAndEnqueueTriggers(
    game,
    player.id,
    selectedCardId,
    {
      candidateCardIds: effect.selectableCardIds ?? [],
    },
    enqueueTriggeredCardEffects
  );
  if (!discardResult) {
    return game;
  }

  const bladeResult = addBladeLiveModifierForSourceMember(discardResult.gameState, {
    playerId: player.id,
    sourceCardId: effect.sourceCardId,
    abilityId: effect.abilityId,
    amount: config.bladeAmount,
  });
  if (!bladeResult) {
    return game;
  }

  return finishActiveEffect(
    {
      ...bladeResult.gameState,
      activeEffect: effect,
    },
    continuePendingCardEffects,
    {
      step: config.resolvedStep,
      discardedCardId: discardResult.discardedCardIds[0] ?? selectedCardId,
      discardedCardIds: discardResult.discardedCardIds,
      bladeBonus: bladeResult.bladeBonus,
    }
  );
}

function startShiorikoOnEnterDiscardRecoverLive(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }
  if (player.hand.cardIds.length === 0) {
    return finishPendingAbility(
      game,
      ability,
      player.id,
      orderedResolution,
      {
        step: 'NO_OP_DISCARD_RECOVER_NIJIGASAKI_LIVE',
        reason: 'NO_HAND',
      },
      continuePendingCardEffects
    );
  }

  return startPendingActiveEffect(game, {
    ability,
    playerId: player.id,
    activeEffect: createOptionalDiscardHandToWaitingRoomActiveEffect({
      ability,
      playerId: player.id,
      effectText: getAbilityEffectText(
        N_BP5_022_ON_ENTER_DISCARD_RECOVER_NIJIGASAKI_LIVE_ABILITY_ID
      ),
      stepId: N_BP5_022_SELECT_DISCARD_STEP_ID,
      stepText: '请选择1张手牌放置入休息室。也可以选择不发动此效果。',
      selectionLabel: '选择要放置入休息室的手牌',
      selectableCardIds: player.hand.cardIds,
      orderedResolution,
    }),
    actionPayload: {
      sourceCardId: ability.sourceCardId,
      sourceSlot: ability.sourceSlot,
      step: 'START_SELECT_DISCARD_FOR_NIJIGASAKI_LIVE_RECOVERY',
      selectableCardIds: player.hand.cardIds,
    },
  });
}

function finishShiorikoDiscardCost(
  game: GameState,
  selectedCardId: string,
  continuePendingCardEffects: ContinuePendingCardEffects,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom
): GameState {
  const effect = game.activeEffect;
  const player = effect ? getPlayerById(game, effect.controllerId) : null;
  if (
    !effect ||
    effect.abilityId !== N_BP5_022_ON_ENTER_DISCARD_RECOVER_NIJIGASAKI_LIVE_ABILITY_ID ||
    effect.stepId !== N_BP5_022_SELECT_DISCARD_STEP_ID ||
    !player ||
    effect.selectableCardIds?.includes(selectedCardId) !== true ||
    !player.hand.cardIds.includes(selectedCardId)
  ) {
    return game;
  }

  const discardResult = discardOneHandCardToWaitingRoomAndEnqueueTriggers(
    game,
    player.id,
    selectedCardId,
    {
      candidateCardIds: effect.selectableCardIds ?? [],
    },
    enqueueTriggeredCardEffects
  );
  if (!discardResult) {
    return game;
  }

  const stateAfterCost = addAction(discardResult.gameState, 'PAY_COST', player.id, {
    pendingAbilityId: effect.id,
    abilityId: effect.abilityId,
    sourceCardId: effect.sourceCardId,
    discardedHandCardIds: discardResult.discardedCardIds,
  });
  const selectableCardIds = selectWaitingRoomCardIds(stateAfterCost, player.id, nijigasakiLive);

  if (selectableCardIds.length === 0) {
    return finishActiveEffect(
      {
        ...stateAfterCost,
        activeEffect: effect,
      },
      continuePendingCardEffects,
      {
        step: 'DISCARD_COST_NO_NIJIGASAKI_LIVE_TARGET',
        discardedCardId: discardResult.discardedCardIds[0] ?? selectedCardId,
        discardedCardIds: discardResult.discardedCardIds,
        selectableCardIds,
        selectedCardIds: [],
      }
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
        stepId: N_BP5_022_SELECT_RECOVERY_STEP_ID,
        stepText: '请选择自己的休息室中1张『虹ヶ咲』LIVE卡加入手牌。',
        awaitingPlayerId: player.id,
        selectableCardIds,
        metadata: {
          ...effect.metadata,
          orderedResolution: effect.metadata?.orderedResolution === true,
          discardedHandCardIds: discardResult.discardedCardIds,
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
      step: 'DISCARD_SELECT_NIJIGASAKI_LIVE',
      discardedCardId: discardResult.discardedCardIds[0] ?? selectedCardId,
      discardedCardIds: discardResult.discardedCardIds,
      selectableCardIds,
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

function isOwnStageMember(game: GameState, playerId: string, sourceCardId: string): boolean {
  const player = getPlayerById(game, playerId);
  return Object.values(player?.memberSlots.slots ?? {}).some((cardId) => cardId === sourceCardId);
}
