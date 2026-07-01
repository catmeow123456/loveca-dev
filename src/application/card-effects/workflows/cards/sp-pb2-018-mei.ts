import { isMemberCardData } from '../../../../domain/entities/card.js';
import {
  addAction,
  getCardById,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { OrientationState, SlotPosition } from '../../../../shared/types/enums.js';
import { normalizeCardName, unitAliasIs } from '../../../effects/card-selectors.js';
import { getEnergyCardIdsByOrientation } from '../../../effects/energy.js';
import { SP_PB2_018_LIVE_START_DIFFERENT_NAME_CATCHU_ACTIVATE_ENERGY_ABILITY_ID } from '../../ability-ids.js';
import { activateWaitingEnergyCardsForPlayer } from '../../runtime/actions.js';
import {
  getAbilityEffectText,
  registerManualConfirmablePendingAbilityStarterHandler,
} from '../../runtime/workflow-helpers.js';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

const STAGE_SLOTS: readonly SlotPosition[] = [
  SlotPosition.LEFT,
  SlotPosition.CENTER,
  SlotPosition.RIGHT,
];

export function registerSpPb2018MeiWorkflowHandlers(): void {
  registerManualConfirmablePendingAbilityStarterHandler(
    SP_PB2_018_LIVE_START_DIFFERENT_NAME_CATCHU_ACTIVATE_ENERGY_ABILITY_ID,
    (game, ability, options, context) =>
      resolveSpPb2018MeiLiveStart(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      ),
    getSpPb2018MeiConfirmationConfig
  );
}

function getSpPb2018MeiConfirmationConfig(
  game: GameState,
  ability: PendingAbilityState
): { readonly effectText: string } {
  const context = getSpPb2018MeiContext(game, ability);
  return {
    effectText: `${getAbilityEffectText(ability.abilityId)}（不同名CatChu!成员 ${context.differentNamedCatchuMemberIds.length}名，等待能量 ${context.waitingEnergyCount}张，激活${context.activationCount}张）`,
  };
}

function resolveSpPb2018MeiLiveStart(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  const sourceCard = getCardById(game, ability.sourceCardId);
  if (!player || !sourceCard || !isMemberCardData(sourceCard.data)) {
    return game;
  }

  const { differentNamedCatchuMemberIds, activationCount } = getSpPb2018MeiContext(game, ability);
  const activationResult = activateWaitingEnergyCardsForPlayer(game, player.id, activationCount);
  if (!activationResult) {
    return game;
  }

  const stateWithoutPending: GameState = {
    ...activationResult.gameState,
    pendingAbilities: activationResult.gameState.pendingAbilities.filter(
      (candidate) => candidate.id !== ability.id
    ),
  };

  return continuePendingCardEffects(
    addAction(stateWithoutPending, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: 'DIFFERENT_NAME_CATCHU_ACTIVATE_ENERGY',
      differentNamedCatchuMemberIds,
      differentNamedCatchuMemberCount: differentNamedCatchuMemberIds.length,
      requestedActivationCount: differentNamedCatchuMemberIds.length,
      activatedEnergyCardIds: activationResult.activatedEnergyCardIds,
      previousOrientations: activationResult.previousOrientations,
      nextOrientation: activationResult.nextOrientation,
    }),
    orderedResolution
  );
}

function getSpPb2018MeiContext(
  game: GameState,
  ability: PendingAbilityState
): {
  readonly differentNamedCatchuMemberIds: readonly string[];
  readonly waitingEnergyCount: number;
  readonly activationCount: number;
} {
  const player = getPlayerById(game, ability.controllerId);
  const sourceCard = getCardById(game, ability.sourceCardId);
  if (!player || !sourceCard || !isMemberCardData(sourceCard.data)) {
    return { differentNamedCatchuMemberIds: [], waitingEnergyCount: 0, activationCount: 0 };
  }

  const differentNamedCatchuMemberIds = getDifferentNamedCatchuStageMemberIds(
    game,
    player.id,
    normalizeCardName(sourceCard.data.name)
  );
  const waitingEnergyCount = getEnergyCardIdsByOrientation(
    game,
    player.id,
    OrientationState.WAITING
  ).length;
  return {
    differentNamedCatchuMemberIds,
    waitingEnergyCount,
    activationCount: Math.min(differentNamedCatchuMemberIds.length, waitingEnergyCount),
  };
}

function getDifferentNamedCatchuStageMemberIds(
  game: GameState,
  playerId: string,
  sourceNormalizedName: string
): readonly string[] {
  const player = getPlayerById(game, playerId);
  if (!player) {
    return [];
  }

  const isCatchu = unitAliasIs('CatChu!');
  return STAGE_SLOTS.flatMap((slot) => {
    const cardId = player.memberSlots.slots[slot];
    if (cardId === null) {
      return [];
    }
    const card = cardId ? getCardById(game, cardId) : null;
    if (
      !card ||
      card.ownerId !== playerId ||
      !isMemberCardData(card.data) ||
      !isCatchu(card) ||
      normalizeCardName(card.data.name) === sourceNormalizedName
    ) {
      return [];
    }
    return [cardId];
  });
}
