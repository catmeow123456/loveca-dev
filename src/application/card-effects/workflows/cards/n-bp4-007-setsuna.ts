import { isLiveCardData } from '../../../../domain/entities/card.js';
import {
  addAction,
  getCardById,
  getOpponent,
  getPlayerById,
  type ActiveEffectState,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { OrientationState } from '../../../../shared/types/enums.js';
import { placeEnergyFromDeckToZoneByCardEffect } from '../../../effects/energy.js';
import {
  PL_N_BP4_007_LIVE_SUCCESS_EACH_PLAYER_PLACE_WAITING_ENERGY_ABILITY_ID,
  PL_N_BP4_007_ON_ENTER_EACH_PLAYER_RECOVER_LIVE_ABILITY_ID,
} from '../../ability-ids.js';
import { recoverCardsFromWaitingRoomToHandForPlayer } from '../../runtime/actions.js';
import { getSourceMemberSlot } from '../../runtime/source-member.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import {
  getAbilityEffectText,
  registerManualConfirmablePendingAbilityStarterHandler,
} from '../../runtime/workflow-helpers.js';

const SELECT_WAITING_LIVE_STEP_ID = 'PL_N_BP4_007_SELECT_WAITING_ROOM_LIVE';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

interface SetsunaEffectContext {
  readonly id: string;
  readonly abilityId: string;
  readonly sourceCardId: string;
  readonly controllerId: string;
}

export function registerNBp4007SetsunaWorkflowHandlers(): void {
  registerPendingAbilityStarterHandler(
    PL_N_BP4_007_ON_ENTER_EACH_PLAYER_RECOVER_LIVE_ABILITY_ID,
    (game, ability, options, context) =>
      startSetsunaOnEnterRecovery(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      )
  );
  registerActiveEffectStepHandler(
    PL_N_BP4_007_ON_ENTER_EACH_PLAYER_RECOVER_LIVE_ABILITY_ID,
    SELECT_WAITING_LIVE_STEP_ID,
    (game, input, context) =>
      finishSetsunaWaitingLiveSelection(
        game,
        input.selectedCardId ?? null,
        context.continuePendingCardEffects
      )
  );
  registerManualConfirmablePendingAbilityStarterHandler(
    PL_N_BP4_007_LIVE_SUCCESS_EACH_PLAYER_PLACE_WAITING_ENERGY_ABILITY_ID,
    (game, ability, options, context) =>
      resolveSetsunaLiveSuccessEnergyPlacement(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      ),
    (game, ability) => {
      return {
        effectText: getAbilityEffectText(ability.abilityId),
        stepText: '确认后结算此效果。',
      };
    }
  );
}

function startSetsunaOnEnterRecovery(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  const opponent = player ? getOpponent(game, player.id) : null;
  if (!player || !opponent) {
    return game;
  }

  const stateWithoutPending: GameState = {
    ...game,
    pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
  };

  return startNextRecoveryStep(
    stateWithoutPending,
    ability,
    [player.id, opponent.id],
    0,
    {},
    orderedResolution,
    continuePendingCardEffects
  );
}

function startNextRecoveryStep(
  game: GameState,
  context: SetsunaEffectContext,
  playerIds: readonly string[],
  startIndex: number,
  recoveredCardIdsByPlayer: Readonly<Record<string, readonly string[]>>,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  for (let index = startIndex; index < playerIds.length; index += 1) {
    const targetPlayerId = playerIds[index];
    if (!targetPlayerId) {
      continue;
    }
    const selectableCardIds = getWaitingRoomLiveCardIds(game, targetPlayerId);
    if (selectableCardIds.length === 0) {
      continue;
    }

    const targetLabel = targetPlayerId === context.controllerId ? '自己' : '对方';
    return addAction(
      {
        ...game,
        activeEffect: {
          id: context.id,
          abilityId: context.abilityId,
          sourceCardId: context.sourceCardId,
          controllerId: context.controllerId,
          effectText: getAbilityEffectText(context.abilityId),
          stepId: SELECT_WAITING_LIVE_STEP_ID,
          stepText: `${targetLabel}从自己的休息室选择1张LIVE卡加入手牌。`,
          awaitingPlayerId: targetPlayerId,
          selectableCardIds,
          selectableCardVisibility: 'AWAITING_PLAYER_ONLY',
          selectableCardMode: 'SINGLE',
          selectionLabel: `${targetLabel}选择休息室的LIVE`,
          confirmSelectionLabel: '加入手牌',
          canSkipSelection: false,
          metadata: {
            orderedResolution,
            recoverPlayerIds: playerIds,
            recoverPlayerIndex: index,
            recoveredCardIdsByPlayer,
          },
        },
      },
      'RESOLVE_ABILITY',
      context.controllerId,
      {
        pendingAbilityId: context.id,
        abilityId: context.abilityId,
        sourceCardId: context.sourceCardId,
        step: 'START_SELECT_WAITING_ROOM_LIVE',
        targetPlayerId,
        selectableCardIds,
      }
    );
  }

  return finishOnEnterRecovery(
    game,
    context,
    recoveredCardIdsByPlayer,
    orderedResolution,
    continuePendingCardEffects
  );
}

function finishSetsunaWaitingLiveSelection(
  game: GameState,
  selectedCardId: string | null,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !== PL_N_BP4_007_ON_ENTER_EACH_PLAYER_RECOVER_LIVE_ABILITY_ID ||
    effect.stepId !== SELECT_WAITING_LIVE_STEP_ID ||
    selectedCardId === null
  ) {
    return game;
  }

  const targetPlayerId = effect.awaitingPlayerId;
  if (typeof targetPlayerId !== 'string') {
    return game;
  }
  const targetPlayer = getPlayerById(game, targetPlayerId);
  const selectableCardIds = effect.selectableCardIds ?? [];
  if (
    !targetPlayer ||
    !selectableCardIds.includes(selectedCardId) ||
    !getWaitingRoomLiveCardIds(game, targetPlayer.id).includes(selectedCardId)
  ) {
    return game;
  }

  const recoveryResult = recoverCardsFromWaitingRoomToHandForPlayer(
    game,
    targetPlayer.id,
    [selectedCardId],
    {
      candidateCardIds: selectableCardIds,
      exactCount: 1,
    }
  );
  if (!recoveryResult) {
    return game;
  }

  const recoveredCardIdsByPlayer = {
    ...getRecoveredCardIdsByPlayer(effect),
    [targetPlayer.id]: recoveryResult.movedCardIds,
  };
  const playerIds = getRecoveryPlayerIds(effect);
  const currentIndex = getRecoveryPlayerIndex(effect);
  const orderedResolution = effect.metadata?.orderedResolution === true;
  const stateAfterRecovery = addAction(
    {
      ...recoveryResult.gameState,
      activeEffect: null,
    },
    'RESOLVE_ABILITY',
    targetPlayer.id,
    {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'RECOVER_WAITING_ROOM_LIVE',
      targetPlayerId: targetPlayer.id,
      movedCardIds: recoveryResult.movedCardIds,
      recoveredCardIdsByPlayer,
    }
  );

  return startNextRecoveryStep(
    stateAfterRecovery,
    effect,
    playerIds,
    currentIndex + 1,
    recoveredCardIdsByPlayer,
    orderedResolution,
    continuePendingCardEffects
  );
}

function finishOnEnterRecovery(
  game: GameState,
  context: SetsunaEffectContext,
  recoveredCardIdsByPlayer: Readonly<Record<string, readonly string[]>>,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const movedCardIds = Object.values(recoveredCardIdsByPlayer).flat();
  const state = addAction(game, 'RESOLVE_ABILITY', context.controllerId, {
    pendingAbilityId: context.id,
    abilityId: context.abilityId,
    sourceCardId: context.sourceCardId,
    step: movedCardIds.length > 0 ? 'FINISH_EACH_PLAYER_RECOVERY' : 'NO_WAITING_ROOM_LIVE',
    recoveredCardIdsByPlayer,
  });
  return continuePendingCardEffects(state, orderedResolution);
}

function resolveSetsunaLiveSuccessEnergyPlacement(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  const opponent = player ? getOpponent(game, player.id) : null;
  if (!player || !opponent) {
    return game;
  }

  const context = getLiveSuccessContext(game, ability);
  let state: GameState = {
    ...game,
    pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
  };
  const placedEnergyCardIdsByPlayer: Record<string, readonly string[]> = {};

  if (context.sourceOnStage) {
    for (const targetPlayerId of [player.id, opponent.id]) {
      const target = getPlayerById(state, targetPlayerId);
      if (!target || target.energyDeck.cardIds.length === 0) {
        placedEnergyCardIdsByPlayer[targetPlayerId] = [];
        continue;
      }
      const placement = placeEnergyFromDeckToZoneByCardEffect(
        state,
        targetPlayerId,
        1,
        OrientationState.WAITING,
        {
          kind: 'CARD_EFFECT',
          playerId: player.id,
          sourceCardId: ability.sourceCardId,
          abilityId: ability.abilityId,
          pendingAbilityId: ability.id,
        }
      );
      if (!placement) {
        placedEnergyCardIdsByPlayer[targetPlayerId] = [];
        continue;
      }
      state = placement.gameState;
      placedEnergyCardIdsByPlayer[targetPlayerId] = placement.placedEnergyCardIds;
    }
  } else {
    placedEnergyCardIdsByPlayer[player.id] = [];
    placedEnergyCardIdsByPlayer[opponent.id] = [];
  }

  const placedEnergyCardIds = Object.values(placedEnergyCardIdsByPlayer).flat();
  return continuePendingCardEffects(
    addAction(state, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      sourceSlot: context.sourceSlot,
      step: !context.sourceOnStage
        ? 'SOURCE_NOT_ON_STAGE'
        : placedEnergyCardIds.length > 0
          ? 'PLACE_EACH_PLAYER_WAITING_ENERGY'
          : 'NO_ENERGY_TO_PLACE',
      sourceOnStage: context.sourceOnStage,
      ownEnergyDeckCount: context.ownEnergyDeckCount,
      opponentEnergyDeckCount: context.opponentEnergyDeckCount,
      placedEnergyCardIds,
      placedEnergyCardIdsByPlayer,
      orientation: OrientationState.WAITING,
    }),
    orderedResolution
  );
}

function getWaitingRoomLiveCardIds(game: GameState, playerId: string): readonly string[] {
  const player = getPlayerById(game, playerId);
  if (!player) {
    return [];
  }
  return player.waitingRoom.cardIds.filter((cardId) => {
    const card = getCardById(game, cardId);
    return card !== null && isLiveCardData(card.data);
  });
}

function getRecoveryPlayerIds(effect: ActiveEffectState): readonly string[] {
  const playerIds = Array.isArray(effect.metadata?.recoverPlayerIds)
    ? effect.metadata.recoverPlayerIds.filter((value): value is string => typeof value === 'string')
    : [effect.controllerId];
  return playerIds.length > 0 ? playerIds : [effect.controllerId];
}

function getRecoveryPlayerIndex(effect: ActiveEffectState): number {
  return typeof effect.metadata?.recoverPlayerIndex === 'number'
    ? Math.floor(effect.metadata.recoverPlayerIndex)
    : 0;
}

function getRecoveredCardIdsByPlayer(
  effect: ActiveEffectState
): Readonly<Record<string, readonly string[]>> {
  if (!effect.metadata?.recoveredCardIdsByPlayer) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(effect.metadata.recoveredCardIdsByPlayer).filter(
      (entry): entry is [string, readonly string[]] =>
        Array.isArray(entry[1]) && entry[1].every((value) => typeof value === 'string')
    )
  );
}

function getLiveSuccessContext(
  game: GameState,
  ability: Pick<PendingAbilityState, 'controllerId' | 'sourceCardId'>
): {
  readonly sourceSlot: ReturnType<typeof getSourceMemberSlot>;
  readonly sourceOnStage: boolean;
  readonly ownEnergyDeckCount: number;
  readonly opponentEnergyDeckCount: number;
} {
  const player = getPlayerById(game, ability.controllerId);
  const opponent = player ? getOpponent(game, player.id) : null;
  const sourceSlot = player
    ? getSourceMemberSlot(game, player.id, ability.sourceCardId)
    : null;

  return {
    sourceSlot,
    sourceOnStage: sourceSlot !== null,
    ownEnergyDeckCount: player?.energyDeck.cardIds.length ?? 0,
    opponentEnergyDeckCount: opponent?.energyDeck.cardIds.length ?? 0,
  };
}
