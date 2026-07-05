import { isMemberCardData } from '../../../../domain/entities/card.js';
import {
  addAction,
  getCardById,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { getMemberEffectiveCost } from '../../../../domain/rules/member-effective-cost.js';
import { OrientationState, ZoneType } from '../../../../shared/types/enums.js';
import { groupAliasIs, hasBladeHeart } from '../../../effects/card-selectors.js';
import { getEnergyCardIdsByOrientation } from '../../../effects/energy.js';
import { drawCardsForPlayer } from '../../runtime/actions.js';
import { activateWaitingEnergyCardsForPlayer } from '../../runtime/actions.js';
import { N_BP5_005_AUTO_RELAY_REPLACED_NIJIGASAKI_NO_BLADE_HEART_ACTIVATE_ENERGY_DRAW_ABILITY_ID } from '../../ability-ids.js';
import {
  registerPendingAbilityStarterHandler,
  type PendingAbilityStarterOptions,
} from '../../runtime/starter-registry.js';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerNBp5005AiWorkflowHandlers(): void {
  registerPendingAbilityStarterHandler(
    N_BP5_005_AUTO_RELAY_REPLACED_NIJIGASAKI_NO_BLADE_HEART_ACTIVATE_ENERGY_DRAW_ABILITY_ID,
    (game, ability, options, context) =>
      resolveAiRelayReplacedActivateEnergyDraw(
        game,
        ability,
        options,
        context.continuePendingCardEffects
      )
  );
}

function resolveAiRelayReplacedActivateEnergyDraw(
  game: GameState,
  ability: PendingAbilityState,
  options: PendingAbilityStarterOptions,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  const context = getAiRelayReplacementContext(game, ability);
  let state = removePendingAbility(game, ability.id);
  let activatedEnergyCardIds: readonly string[] = [];
  let drawnCardIds: readonly string[] = [];

  if (context.qualifiesForEnergy) {
    const activationCount = Math.min(
      2,
      getEnergyCardIdsByOrientation(state, player.id, OrientationState.WAITING).length
    );
    const activationResult = activateWaitingEnergyCardsForPlayer(state, player.id, activationCount);
    if (!activationResult) {
      return game;
    }
    state = activationResult.gameState;
    activatedEnergyCardIds = activationResult.activatedEnergyCardIds;
  }

  if (context.qualifiesForDraw) {
    const drawResult = drawCardsForPlayer(state, player.id, 1);
    if (!drawResult) {
      return game;
    }
    state = drawResult.gameState;
    drawnCardIds = drawResult.drawnCardIds;
  }

  return continuePendingCardEffects(
    addAction(state, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      sourceSlot: ability.sourceSlot,
      step: context.conditionMet ? 'ACTIVATE_ENERGY_DRAW_BY_RELAY_REPLACEMENT' : context.noOpStep,
      toZone: context.toZone,
      sourceInWaitingRoom: context.sourceInWaitingRoom,
      replacingCardId: context.replacingCardId,
      replacingCardCost: context.replacingCardCost,
      replacingCardIsMember: context.replacingCardIsMember,
      replacingCardIsNijigasaki: context.replacingCardIsNijigasaki,
      replacingCardHasBladeHeart: context.replacingCardHasBladeHeart,
      activatedEnergyCardIds,
      drawnCardIds,
    }),
    options.orderedResolution === true
  );
}

function getAiRelayReplacementContext(
  game: GameState,
  ability: PendingAbilityState
): {
  readonly toZone: ZoneType | null;
  readonly sourceInWaitingRoom: boolean;
  readonly replacingCardId: string | null;
  readonly replacingCardCost: number;
  readonly replacingCardIsMember: boolean;
  readonly replacingCardIsNijigasaki: boolean;
  readonly replacingCardHasBladeHeart: boolean;
  readonly conditionMet: boolean;
  readonly qualifiesForEnergy: boolean;
  readonly qualifiesForDraw: boolean;
  readonly noOpStep: string;
} {
  const player = getPlayerById(game, ability.controllerId);
  const toZone = ability.metadata?.toZone === ZoneType.WAITING_ROOM ? ZoneType.WAITING_ROOM : null;
  const sourceInWaitingRoom =
    player?.waitingRoom.cardIds.includes(ability.sourceCardId) === true;
  const replacingCardId =
    typeof ability.metadata?.replacingCardId === 'string' ? ability.metadata.replacingCardId : null;
  const replacingCard = replacingCardId ? getCardById(game, replacingCardId) : null;
  const replacingCardIsMember = replacingCard !== null && isMemberCardData(replacingCard.data);
  const replacingCardIsNijigasaki =
    replacingCard !== null && replacingCardIsMember && groupAliasIs('虹ヶ咲')(replacingCard);
  const replacingCardHasBladeHeart = replacingCard !== null && hasBladeHeart()(replacingCard);
  const replacingCardCost =
    player && replacingCardId && replacingCardIsMember
      ? getMemberEffectiveCost(game, player.id, replacingCardId)
      : 0;
  const validReplacement =
    replacingCardId !== null &&
    replacingCardIsMember &&
    replacingCardIsNijigasaki &&
    !replacingCardHasBladeHeart;
  const conditionMet =
    toZone === ZoneType.WAITING_ROOM &&
    sourceInWaitingRoom &&
    validReplacement &&
    replacingCardCost >= 10;
  const qualifiesForEnergy = conditionMet;
  const qualifiesForDraw = conditionMet && replacingCardCost >= 15;

  return {
    toZone,
    sourceInWaitingRoom,
    replacingCardId,
    replacingCardCost,
    replacingCardIsMember,
    replacingCardIsNijigasaki,
    replacingCardHasBladeHeart,
    conditionMet,
    qualifiesForEnergy,
    qualifiesForDraw,
    noOpStep: getNoOpStep({
      toZone,
      sourceInWaitingRoom,
      replacingCardId,
      replacingCardIsMember,
      replacingCardIsNijigasaki,
      replacingCardHasBladeHeart,
      replacingCardCost,
    }),
  };
}

function getNoOpStep(context: {
  readonly toZone: ZoneType | null;
  readonly sourceInWaitingRoom: boolean;
  readonly replacingCardId: string | null;
  readonly replacingCardIsMember: boolean;
  readonly replacingCardIsNijigasaki: boolean;
  readonly replacingCardHasBladeHeart: boolean;
  readonly replacingCardCost: number;
}): string {
  if (context.toZone !== ZoneType.WAITING_ROOM || !context.sourceInWaitingRoom) {
    return 'SOURCE_NOT_TO_WAITING_ROOM';
  }
  if (!context.replacingCardId || !context.replacingCardIsMember) {
    return 'NO_RELAY_REPLACEMENT_MEMBER';
  }
  if (!context.replacingCardIsNijigasaki) {
    return 'REPLACEMENT_NOT_NIJIGASAKI';
  }
  if (context.replacingCardHasBladeHeart) {
    return 'REPLACEMENT_HAS_BLADE_HEART';
  }
  if (context.replacingCardCost < 10) {
    return 'REPLACEMENT_COST_BELOW_TEN';
  }
  return 'CONDITION_NOT_MET';
}

function removePendingAbility(game: GameState, pendingAbilityId: string): GameState {
  return {
    ...game,
    pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== pendingAbilityId),
  };
}
