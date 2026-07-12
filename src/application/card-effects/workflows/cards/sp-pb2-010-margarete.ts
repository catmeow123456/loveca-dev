import {
  addAction,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { OrientationState, TriggerCondition } from '../../../../shared/types/enums.js';
import {
  placeEnergyFromDeckToZoneByCardEffect,
} from '../../../effects/energy.js';
import {
  getEnergySelectionCandidates,
  resolveEnergySelectionForOperation,
  shouldSelectEnergyForOperation,
} from '../../../effects/energy-selection.js';
import {
  SP_PB2_010_LIVE_START_DISCARD_OR_RETURN_ENERGY_ABILITY_ID,
  SP_PB2_010_LIVE_SUCCESS_DRAW_TWO_OR_PLACE_WAITING_ENERGY_ABILITY_ID,
} from '../../ability-ids.js';
import { drawCardsForPlayer } from '../../runtime/actions.js';
import {
  discardOneHandCardToWaitingRoomAndEnqueueTriggers,
  type EnqueueTriggeredCardEffectsForEnterWaitingRoom,
} from '../../runtime/enter-waiting-room-triggers.js';
import {
  resolveEnergyReturnByCardEffect,
  type EnqueueTriggeredCardEffectsForEnergyReturn,
} from '../../runtime/energy-return.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText } from '../../runtime/workflow-helpers.js';

const LIVE_START_DECISION_STEP_ID = 'SP_PB2_010_LIVE_START_DECISION';
const LIVE_START_SELECT_DISCARD_STEP_ID = 'SP_PB2_010_SELECT_DISCARD';
const LIVE_START_SELECT_RETURN_ENERGY_STEP_ID = 'SP_PB2_010_SELECT_RETURN_ENERGY';
const LIVE_SUCCESS_SELECT_OPTION_STEP_ID = 'SP_PB2_010_LIVE_SUCCESS_SELECT_OPTION';

const DISCARD_OPTION_ID = 'discard';
const DECLINE_DISCARD_OPTION_ID = 'decline-discard';
const DRAW_TWO_OPTION_ID = 'draw-two';
const PLACE_WAITING_ENERGY_OPTION_ID = 'place-waiting-energy';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;
let enqueueEnergyReturnTriggers: EnqueueTriggeredCardEffectsForEnergyReturn = (game) => game;

export function registerSpPb2010MargareteWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom &
    EnqueueTriggeredCardEffectsForEnergyReturn;
}): void {
  enqueueEnergyReturnTriggers = deps.enqueueTriggeredCardEffects;
  registerPendingAbilityStarterHandler(
    SP_PB2_010_LIVE_START_DISCARD_OR_RETURN_ENERGY_ABILITY_ID,
    (game, ability, options, context) =>
      startLiveStartDiscardOrReturnEnergy(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      )
  );
  registerActiveEffectStepHandler(
    SP_PB2_010_LIVE_START_DISCARD_OR_RETURN_ENERGY_ABILITY_ID,
    LIVE_START_DECISION_STEP_ID,
    (game, input, context) =>
      finishLiveStartDecision(
        game,
        input.selectedOptionId ?? null,
        context.continuePendingCardEffects
      )
  );
  registerActiveEffectStepHandler(
    SP_PB2_010_LIVE_START_DISCARD_OR_RETURN_ENERGY_ABILITY_ID,
    LIVE_START_SELECT_RETURN_ENERGY_STEP_ID,
    (game, input, context) =>
      finishSelectedEnergyReturn(
        game,
        input.selectedCardId ?? null,
        context.continuePendingCardEffects
      )
  );
  registerActiveEffectStepHandler(
    SP_PB2_010_LIVE_START_DISCARD_OR_RETURN_ENERGY_ABILITY_ID,
    LIVE_START_SELECT_DISCARD_STEP_ID,
    (game, input, context) =>
      finishLiveStartDiscard(
        game,
        input.selectedCardId ?? null,
        context.continuePendingCardEffects,
        deps.enqueueTriggeredCardEffects
      )
  );

  registerPendingAbilityStarterHandler(
    SP_PB2_010_LIVE_SUCCESS_DRAW_TWO_OR_PLACE_WAITING_ENERGY_ABILITY_ID,
    (game, ability, options, context) =>
      startLiveSuccessOptionSelection(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      )
  );
  registerActiveEffectStepHandler(
    SP_PB2_010_LIVE_SUCCESS_DRAW_TWO_OR_PLACE_WAITING_ENERGY_ABILITY_ID,
    LIVE_SUCCESS_SELECT_OPTION_STEP_ID,
    (game, input, context) =>
      finishLiveSuccessOption(
        game,
        input.selectedOptionId ?? null,
        context.continuePendingCardEffects
      )
  );
}

function startLiveStartDiscardOrReturnEnergy(
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
    return finishLiveStartReturnEnergyOrNoop(
      game,
      ability,
      orderedResolution,
      true,
      false,
      continuePendingCardEffects
    );
  }

  return {
    ...game,
    activeEffect: {
      id: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      controllerId: player.id,
      effectText: getAbilityEffectText(ability.abilityId),
      stepId: LIVE_START_DECISION_STEP_ID,
      stepText: '可以弃1张手牌。若不弃手，则必须将自己的1张能量放回能量卡组。',
      awaitingPlayerId: player.id,
      selectableOptions: [
        { id: DISCARD_OPTION_ID, label: '弃1张手牌' },
        { id: DECLINE_DISCARD_OPTION_ID, label: '不弃手，返回1张能量' },
      ],
      confirmSelectionLabel: '确定',
      canSkipSelection: false,
      metadata: {
        orderedResolution,
        sourceSlot: ability.sourceSlot,
      },
    },
  };
}

function finishLiveStartDecision(
  game: GameState,
  selectedOptionId: string | null,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  const player = effect ? getPlayerById(game, effect.controllerId) : null;
  if (
    !effect ||
    effect.abilityId !== SP_PB2_010_LIVE_START_DISCARD_OR_RETURN_ENERGY_ABILITY_ID ||
    effect.stepId !== LIVE_START_DECISION_STEP_ID ||
    !player ||
    !selectedOptionId
  ) {
    return game;
  }

  if (selectedOptionId === DISCARD_OPTION_ID) {
    return {
      ...game,
      activeEffect: {
        ...effect,
        stepId: LIVE_START_SELECT_DISCARD_STEP_ID,
        stepText: '请选择1张手牌放置入休息室。',
        selectableOptions: undefined,
        selectableCardIds: player.hand.cardIds,
        selectableCardVisibility: 'AWAITING_PLAYER_ONLY',
        selectionLabel: '选择要放置入休息室的手牌',
        confirmSelectionLabel: '放置入休息室',
        canSkipSelection: false,
      },
    };
  }

  if (selectedOptionId === DECLINE_DISCARD_OPTION_ID) {
    return finishLiveStartReturnEnergyOrNoop(
      game,
      effectToPendingAbility(effect),
      effect.metadata?.orderedResolution === true,
      false,
      true,
      continuePendingCardEffects
    );
  }

  return game;
}

function finishLiveStartDiscard(
  game: GameState,
  selectedCardId: string | null,
  continuePendingCardEffects: ContinuePendingCardEffects,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom
): GameState {
  const effect = game.activeEffect;
  const player = effect ? getPlayerById(game, effect.controllerId) : null;
  if (
    !effect ||
    effect.abilityId !== SP_PB2_010_LIVE_START_DISCARD_OR_RETURN_ENERGY_ABILITY_ID ||
    effect.stepId !== LIVE_START_SELECT_DISCARD_STEP_ID ||
    !player ||
    !selectedCardId ||
    effect.selectableCardIds?.includes(selectedCardId) !== true
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

  return finishPendingEffect(
    discardResult.gameState,
    player.id,
    effect,
    {
      step: 'DISCARD_HAND_CARD',
      discardedCardId: discardResult.discardedCardIds[0] ?? selectedCardId,
      returnedEnergyCardId: null,
      declinedDiscard: false,
      noHand: false,
    },
    continuePendingCardEffects
  );
}

function finishLiveStartReturnEnergyOrNoop(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  noHand: boolean,
  declinedDiscard: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }
  const candidateEnergyCardIds = getEnergySelectionCandidates(
    game,
    player.id,
    'RETURN_TO_ENERGY_DECK'
  );
  if (candidateEnergyCardIds.length === 0) {
    return finishPendingAbility(
      game,
      player.id,
      ability,
      orderedResolution,
      {
        step: 'NO_OP_NO_ENERGY',
        discardedCardId: null,
        returnedEnergyCardId: null,
        declinedDiscard,
        noHand,
        reason: noHand ? 'NO_HAND_NO_ENERGY' : 'DECLINED_DISCARD_NO_ENERGY',
      },
      continuePendingCardEffects
    );
  }

  if (shouldSelectEnergyForOperation(game, player.id, 'RETURN_TO_ENERGY_DECK', 1)) {
    return {
      ...game,
      activeEffect: {
        id: ability.id,
        abilityId: ability.abilityId,
        sourceCardId: ability.sourceCardId,
        controllerId: player.id,
        effectText: getAbilityEffectText(ability.abilityId),
        stepId: LIVE_START_SELECT_RETURN_ENERGY_STEP_ID,
        stepText: '请选择1张能量放回能量卡组。',
        awaitingPlayerId: player.id,
        selectableCardIds: candidateEnergyCardIds,
        minSelectableCards: 1,
        maxSelectableCards: 1,
        confirmSelectionLabel: '放回能量卡组',
        canSkipSelection: false,
        metadata: { orderedResolution, noHand, declinedDiscard },
      },
    };
  }

  const selection = resolveEnergySelectionForOperation(
    game,
    player.id,
    'RETURN_TO_ENERGY_DECK',
    1
  );
  if (!selection) return game;
  const energyCardId = selection.selectedEnergyCardIds[0] ?? null;
  if (!energyCardId) return game;

  return resolveEnergyReturn(
    selection.gameState,
    player.id,
    ability,
    energyCardId,
    orderedResolution,
    noHand,
    declinedDiscard,
    continuePendingCardEffects
  );
}

function finishSelectedEnergyReturn(
  game: GameState,
  selectedCardId: string | null,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.stepId !== LIVE_START_SELECT_RETURN_ENERGY_STEP_ID ||
    !selectedCardId ||
    effect.selectableCardIds?.includes(selectedCardId) !== true
  )
    return game;
  return resolveEnergyReturn(
    game,
    effect.controllerId,
    effectToPendingAbility(effect),
    selectedCardId,
    effect.metadata?.orderedResolution === true,
    effect.metadata?.noHand === true,
    effect.metadata?.declinedDiscard === true,
    continuePendingCardEffects
  );
}

function resolveEnergyReturn(
  game: GameState,
  playerId: string,
  ability: PendingAbilityState,
  energyCardId: string,
  orderedResolution: boolean,
  noHand: boolean,
  declinedDiscard: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, playerId);
  if (!player || !player.energyZone.cardIds.includes(energyCardId)) return game;

  const returnResult = returnEnergyFromZoneToDeck(game, player.id, energyCardId, ability);
  if (!returnResult) {
    return game;
  }

  return finishPendingAbility(
    returnResult.gameState,
    player.id,
    ability,
    orderedResolution,
    {
      step: 'RETURN_ENERGY_TO_DECK',
      discardedCardId: null,
      returnedEnergyCardId: returnResult.returnedEnergyCardId,
      declinedDiscard,
      noHand,
    },
    continuePendingCardEffects
  );
}

function startLiveSuccessOptionSelection(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }
  const selectableOptions = [
    { id: DRAW_TWO_OPTION_ID, label: '抽2张卡' },
    ...(player.energyDeck.cardIds.length > 0
      ? [{ id: PLACE_WAITING_ENERGY_OPTION_ID, label: '放置1张待机能量' }]
      : []),
  ];
  if (selectableOptions.length === 0) {
    return finishPendingAbility(
      game,
      player.id,
      ability,
      orderedResolution,
      {
        step: 'NO_OP_NO_VALID_OPTIONS',
        selectedOptionId: null,
        drawnCardIds: [],
        placedEnergyCardIds: [],
      },
      continuePendingCardEffects
    );
  }

  return {
    ...game,
    activeEffect: {
      id: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      controllerId: player.id,
      effectText: getAbilityEffectText(ability.abilityId),
      stepId: LIVE_SUCCESS_SELECT_OPTION_STEP_ID,
      stepText: '请选择1个LIVE成功效果。',
      awaitingPlayerId: player.id,
      selectableOptions,
      confirmSelectionLabel: '确定',
      canSkipSelection: false,
      metadata: {
        orderedResolution,
        sourceSlot: ability.sourceSlot,
      },
    },
  };
}

function finishLiveSuccessOption(
  game: GameState,
  selectedOptionId: string | null,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  const player = effect ? getPlayerById(game, effect.controllerId) : null;
  if (
    !effect ||
    effect.abilityId !== SP_PB2_010_LIVE_SUCCESS_DRAW_TWO_OR_PLACE_WAITING_ENERGY_ABILITY_ID ||
    effect.stepId !== LIVE_SUCCESS_SELECT_OPTION_STEP_ID ||
    !player ||
    !selectedOptionId
  ) {
    return game;
  }

  if (selectedOptionId === DRAW_TWO_OPTION_ID) {
    const drawResult = drawCardsForPlayer(game, player.id, 2);
    if (!drawResult) {
      return game;
    }
    return finishPendingEffect(
      drawResult.gameState,
      player.id,
      effect,
      {
        step: 'DRAW_TWO',
        selectedOptionId,
        drawnCardIds: drawResult.drawnCardIds,
        placedEnergyCardIds: [],
      },
      continuePendingCardEffects
    );
  }

  if (selectedOptionId === PLACE_WAITING_ENERGY_OPTION_ID) {
    const energyResult = placeEnergyFromDeckToZoneByCardEffect(
      game,
      player.id,
      1,
      OrientationState.WAITING,
      {
        kind: 'CARD_EFFECT',
        playerId: player.id,
        sourceCardId: effect.sourceCardId,
        abilityId: effect.abilityId,
        pendingAbilityId: effect.id,
      }
    );
    if (!energyResult || energyResult.placedEnergyCardIds.length === 0) {
      return game;
    }
    return finishPendingEffect(
      energyResult.gameState,
      player.id,
      effect,
      {
        step: 'PLACE_WAITING_ENERGY',
        selectedOptionId,
        drawnCardIds: [],
        placedEnergyCardIds: energyResult.placedEnergyCardIds,
      },
      continuePendingCardEffects
    );
  }

  return game;
}

function returnEnergyFromZoneToDeck(
  game: GameState,
  playerId: string,
  energyCardId: string,
  ability: Pick<PendingAbilityState, 'id' | 'abilityId' | 'sourceCardId'>
): { readonly gameState: GameState; readonly returnedEnergyCardId: string } | null {
  const result = resolveEnergyReturnByCardEffect(game, {
    playerId,
    selectedEnergyCardIds: [energyCardId],
    cause: {
      kind: 'CARD_EFFECT',
      playerId,
      sourceCardId: ability.sourceCardId,
      abilityId: ability.abilityId,
      pendingAbilityId: ability.id,
    },
    exactCount: 1,
    enqueueTriggeredCardEffects: enqueueEnergyReturnTriggers,
  });
  if (!result) return null;
  return {
    gameState: result.gameState,
    returnedEnergyCardId: energyCardId,
  };
}

function finishPendingEffect(
  game: GameState,
  playerId: string,
  effect: NonNullable<GameState['activeEffect']>,
  payload: Record<string, unknown>,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  return continuePendingCardEffects(
    addAction(
      {
        ...game,
        activeEffect: null,
        pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== effect.id),
      },
      'RESOLVE_ABILITY',
      playerId,
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
  playerId: string,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  payload: Record<string, unknown>,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  return continuePendingCardEffects(
    addAction(
      {
        ...game,
        activeEffect: null,
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

function effectToPendingAbility(
  effect: NonNullable<GameState['activeEffect']>
): PendingAbilityState {
  return {
    id: effect.id,
    abilityId: effect.abilityId,
    sourceCardId: effect.sourceCardId,
    controllerId: effect.controllerId,
    mandatory: true,
    timingId: TriggerCondition.ON_LIVE_START,
    eventIds: [],
  };
}
