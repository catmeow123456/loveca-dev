import { isLiveCardData, isMemberCardData } from '../../../../domain/entities/card.js';
import {
  addAction,
  getCardById,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { OrientationState } from '../../../../shared/types/enums.js';
import { cardCodeMatchesBase } from '../../../../shared/utils/card-code.js';
import { groupAliasIs } from '../../../effects/card-selectors.js';
import { placeEnergyFromDeckToZoneByCardEffect } from '../../../effects/energy.js';
import { PL_N_BP4_030_LIVE_SUCCESS_CHOOSE_ENERGY_OR_MEMBER_RECOVERY_ABILITY_ID } from '../../ability-ids.js';
import { recoverCardsFromWaitingRoomToHandForPlayer } from '../../runtime/actions.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText } from '../../runtime/workflow-helpers.js';

const SELECT_OPTION_STEP_ID = 'PL_N_BP4_030_SELECT_LIVE_SUCCESS_OPTION';
const SELECT_WAITING_MEMBER_STEP_ID = 'PL_N_BP4_030_SELECT_WAITING_ROOM_MEMBER';

const ENERGY_OPTION_ID = 'energy';
const MEMBER_RECOVERY_OPTION_ID = 'member-recovery';
const ENERGY_AND_MEMBER_RECOVERY_OPTION_ID = 'energy-and-member-recovery';

type ActiveEffect = NonNullable<GameState['activeEffect']>;
type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerNBp4030DaydreamMermaidWorkflowHandlers(): void {
  registerPendingAbilityStarterHandler(
    PL_N_BP4_030_LIVE_SUCCESS_CHOOSE_ENERGY_OR_MEMBER_RECOVERY_ABILITY_ID,
    (game, ability, options, context) =>
      startDaydreamMermaidLiveSuccess(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      )
  );
  registerActiveEffectStepHandler(
    PL_N_BP4_030_LIVE_SUCCESS_CHOOSE_ENERGY_OR_MEMBER_RECOVERY_ABILITY_ID,
    SELECT_OPTION_STEP_ID,
    (game, input, context) =>
      finishOptionSelection(
        game,
        input.selectedOptionId ?? null,
        context.continuePendingCardEffects
      )
  );
  registerActiveEffectStepHandler(
    PL_N_BP4_030_LIVE_SUCCESS_CHOOSE_ENERGY_OR_MEMBER_RECOVERY_ABILITY_ID,
    SELECT_WAITING_MEMBER_STEP_ID,
    (game, input, context) =>
      finishWaitingMemberSelection(
        game,
        input.selectedCardId ?? null,
        context.continuePendingCardEffects
      )
  );
}

function startDaydreamMermaidLiveSuccess(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  if (!isResolvableSource(game, player.id, ability.sourceCardId)) {
    return finishPendingAbility(
      game,
      player.id,
      ability,
      orderedResolution,
      {
        step: 'SOURCE_NOT_IN_LIVE_ZONE',
        selectedOptionIds: [],
        placedEnergyCardIds: [],
        movedCardIds: [],
      },
      continuePendingCardEffects
    );
  }

  const hasNijigasakiSuccessLive = hasNijigasakiSuccessZoneCard(game, player.id);
  const availableOptionIds = getAvailableOptionIds(game, player.id, hasNijigasakiSuccessLive);
  if (availableOptionIds.length === 0) {
    return finishPendingAbility(
      game,
      player.id,
      ability,
      orderedResolution,
      {
        step: 'NO_LEGAL_OPTIONS',
        hasNijigasakiSuccessLive,
        selectedOptionIds: [],
        placedEnergyCardIds: [],
        movedCardIds: [],
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
      stepId: SELECT_OPTION_STEP_ID,
      stepText: hasNijigasakiSuccessLive
        ? '请选择1个或多个LIVE成功效果。'
        : '请选择1个LIVE成功效果。',
      awaitingPlayerId: player.id,
      selectableOptions: availableOptionIds.map((optionId) => ({
        id: optionId,
        label: getOptionLabel(optionId),
      })),
      confirmSelectionLabel: '确定',
      canSkipSelection: false,
      metadata: {
        orderedResolution,
        sourceSlot: ability.sourceSlot,
        hasNijigasakiSuccessLive,
      },
    },
  };
}

function finishOptionSelection(
  game: GameState,
  selectedOptionId: string | null,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  const player = effect ? getPlayerById(game, effect.controllerId) : null;
  if (
    !effect ||
    effect.abilityId !== PL_N_BP4_030_LIVE_SUCCESS_CHOOSE_ENERGY_OR_MEMBER_RECOVERY_ABILITY_ID ||
    effect.stepId !== SELECT_OPTION_STEP_ID ||
    !player
  ) {
    return game;
  }

  if (!isResolvableSource(game, player.id, effect.sourceCardId)) {
    return finishActiveEffect(
      game,
      player.id,
      effect,
      {
        step: 'SOURCE_NOT_IN_LIVE_ZONE',
        selectedOptionIds: [],
        placedEnergyCardIds: [],
        movedCardIds: [],
      },
      continuePendingCardEffects
    );
  }

  const hasNijigasakiSuccessLive = hasNijigasakiSuccessZoneCard(game, player.id);
  const availableOptionIds = getAvailableOptionIds(game, player.id, hasNijigasakiSuccessLive);
  if (!selectedOptionId || !availableOptionIds.includes(selectedOptionId)) {
    return game;
  }

  const selectedOptionIds = getSelectedOptionIds(selectedOptionId);
  let state = game;
  let placedEnergyCardIds: readonly string[] = [];
  if (selectedOptionIds.includes(ENERGY_OPTION_ID)) {
    const energyResult = placeEnergyFromDeckToZoneByCardEffect(
      state,
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
    state = energyResult.gameState;
    placedEnergyCardIds = energyResult.placedEnergyCardIds;
  }

  const stateAfterEnergy = addAction(state, 'RESOLVE_ABILITY', player.id, {
    pendingAbilityId: effect.id,
    abilityId: effect.abilityId,
    sourceCardId: effect.sourceCardId,
    step: selectedOptionIds.includes(ENERGY_OPTION_ID) ? 'PLACE_WAITING_ENERGY' : 'SELECT_OPTION',
    hasNijigasakiSuccessLive,
    selectedOptionIds,
    placedEnergyCardIds,
  });

  if (!selectedOptionIds.includes(MEMBER_RECOVERY_OPTION_ID)) {
    return finishActiveEffect(
      stateAfterEnergy,
      player.id,
      effect,
      {
        step: 'FINISH',
        hasNijigasakiSuccessLive,
        selectedOptionIds,
        placedEnergyCardIds,
        movedCardIds: [],
      },
      continuePendingCardEffects
    );
  }

  const waitingMemberCardIds = getWaitingRoomMemberCardIds(stateAfterEnergy, player.id);
  if (waitingMemberCardIds.length === 0) {
    return game;
  }

  return {
    ...stateAfterEnergy,
    activeEffect: {
      ...effect,
      stepId: SELECT_WAITING_MEMBER_STEP_ID,
      stepText: '请选择自己休息室中的1张成员卡加入手牌。',
      awaitingPlayerId: player.id,
      selectableOptions: undefined,
      selectableCardIds: waitingMemberCardIds,
      selectableCardMode: 'SINGLE',
      selectableCardVisibility: 'PUBLIC',
      selectionLabel: '选择休息室成员卡',
      confirmSelectionLabel: '加入手牌',
      canSkipSelection: false,
      metadata: {
        ...effect.metadata,
        publicCardSelectionConfirmation: { destination: 'HAND' },
        hasNijigasakiSuccessLive,
        selectedOptionIds,
        placedEnergyCardIds,
      },
    },
  };
}

function finishWaitingMemberSelection(
  game: GameState,
  selectedCardId: string | null,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  const player = effect ? getPlayerById(game, effect.controllerId) : null;
  if (
    !effect ||
    effect.abilityId !== PL_N_BP4_030_LIVE_SUCCESS_CHOOSE_ENERGY_OR_MEMBER_RECOVERY_ABILITY_ID ||
    effect.stepId !== SELECT_WAITING_MEMBER_STEP_ID ||
    !player
  ) {
    return game;
  }

  if (!isResolvableSource(game, player.id, effect.sourceCardId)) {
    return finishActiveEffect(
      game,
      player.id,
      effect,
      {
        step: 'SOURCE_NOT_IN_LIVE_ZONE',
        selectedOptionIds: getMetadataStringArray(effect.metadata?.selectedOptionIds),
        placedEnergyCardIds: getMetadataStringArray(effect.metadata?.placedEnergyCardIds),
        movedCardIds: [],
      },
      continuePendingCardEffects
    );
  }

  const waitingMemberCardIds = getWaitingRoomMemberCardIds(game, player.id);
  if (
    !selectedCardId ||
    effect.selectableCardIds?.includes(selectedCardId) !== true ||
    !waitingMemberCardIds.includes(selectedCardId)
  ) {
    return game;
  }

  const recoveryResult = recoverCardsFromWaitingRoomToHandForPlayer(
    game,
    player.id,
    [selectedCardId],
    {
      candidateCardIds: waitingMemberCardIds,
      exactCount: 1,
    }
  );
  if (!recoveryResult) {
    return game;
  }

  const selectedOptionIds = getMetadataStringArray(effect.metadata?.selectedOptionIds);
  const placedEnergyCardIds = getMetadataStringArray(effect.metadata?.placedEnergyCardIds);
  const hasNijigasakiSuccessLive = effect.metadata?.hasNijigasakiSuccessLive === true;
  const stateAfterRecovery = addAction(recoveryResult.gameState, 'RESOLVE_ABILITY', player.id, {
    pendingAbilityId: effect.id,
    abilityId: effect.abilityId,
    sourceCardId: effect.sourceCardId,
    step: 'RECOVER_WAITING_ROOM_MEMBER',
    hasNijigasakiSuccessLive,
    selectedOptionIds,
    placedEnergyCardIds,
    movedCardIds: recoveryResult.movedCardIds,
  });

  return finishActiveEffect(
    stateAfterRecovery,
    player.id,
    effect,
    {
      step: 'FINISH',
      hasNijigasakiSuccessLive,
      selectedOptionIds,
      placedEnergyCardIds,
      movedCardIds: recoveryResult.movedCardIds,
    },
    continuePendingCardEffects
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

function finishActiveEffect(
  game: GameState,
  playerId: string,
  effect: ActiveEffect,
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

function isResolvableSource(game: GameState, playerId: string, sourceCardId: string): boolean {
  const player = getPlayerById(game, playerId);
  const sourceCard = getCardById(game, sourceCardId);
  return (
    player?.liveZone.cardIds.includes(sourceCardId) === true &&
    sourceCard !== null &&
    sourceCard.ownerId === playerId &&
    isLiveCardData(sourceCard.data) &&
    cardCodeMatchesBase(sourceCard.data.cardCode, 'PL!N-bp4-030')
  );
}

function hasNijigasakiSuccessZoneCard(game: GameState, playerId: string): boolean {
  const player = getPlayerById(game, playerId);
  if (!player) {
    return false;
  }
  const isNijigasaki = groupAliasIs('虹ヶ咲');
  return player.successZone.cardIds.some((cardId) => {
    const card = getCardById(game, cardId);
    return card ? isNijigasaki(card) : false;
  });
}

function getAvailableOptionIds(
  game: GameState,
  playerId: string,
  allowMultiple: boolean
): string[] {
  const player = getPlayerById(game, playerId);
  if (!player) {
    return [];
  }
  const options: string[] = [];
  if (player.energyDeck.cardIds.length > 0) {
    options.push(ENERGY_OPTION_ID);
  }
  if (getWaitingRoomMemberCardIds(game, playerId).length > 0) {
    options.push(MEMBER_RECOVERY_OPTION_ID);
  }
  if (
    allowMultiple &&
    options.includes(ENERGY_OPTION_ID) &&
    options.includes(MEMBER_RECOVERY_OPTION_ID)
  ) {
    options.push(ENERGY_AND_MEMBER_RECOVERY_OPTION_ID);
  }
  return options;
}

function getWaitingRoomMemberCardIds(game: GameState, playerId: string): string[] {
  const player = getPlayerById(game, playerId);
  if (!player) {
    return [];
  }
  return player.waitingRoom.cardIds.filter((cardId) => {
    const card = getCardById(game, cardId);
    return card?.ownerId === playerId && isMemberCardData(card.data);
  });
}

function getSelectedOptionIds(optionId: string): readonly string[] {
  return optionId === ENERGY_AND_MEMBER_RECOVERY_OPTION_ID
    ? [ENERGY_OPTION_ID, MEMBER_RECOVERY_OPTION_ID]
    : [optionId];
}

function getOptionLabel(optionId: string): string {
  if (optionId === ENERGY_OPTION_ID) {
    return '从能量卡组放置1张待机能量';
  }
  if (optionId === MEMBER_RECOVERY_OPTION_ID) {
    return '从休息室将1张成员卡加入手牌';
  }
  return '放置待机能量，并从休息室回收1张成员卡';
}

function getMetadataStringArray(value: unknown): readonly string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}
