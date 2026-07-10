import {
  addAction,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { addLiveModifier } from '../../../../domain/rules/live-modifiers.js';
import { CardType } from '../../../../shared/types/enums.js';
import { countCurrentLiveRevealedDifferentNamedCheerCards } from '../../../effects/cheer-selection.js';
import {
  SP_BP4_026_LIVE_SUCCESS_DIFFERENT_LIELLA_CHEER_SCORE_ABILITY_ID,
  SP_BP4_026_LIVE_SUCCESS_ENERGY_ELEVEN_DRAW_TWO_DISCARD_ONE_ABILITY_ID,
} from '../../ability-ids.js';
import type { EnqueueTriggeredCardEffectsForEnterWaitingRoom } from '../../runtime/enter-waiting-room-triggers.js';
import {
  registerPendingAbilityStarterHandler,
  type PendingAbilityStarterOptions,
} from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import {
  getAbilityEffectText,
  maybeStartConfirmablePendingAbilityConfirmation,
} from '../../runtime/workflow-helpers.js';
import {
  finishDrawThenDiscardCardsWorkflow,
  startDrawThenDiscardCardsWorkflow,
} from '../shared/draw-then-discard.js';

const SELECT_DISCARD_AFTER_DRAW_STEP_ID = 'SP_BP4_026_SELECT_DISCARD_AFTER_DRAW';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerSpBp4026WishSongWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom;
}): void {
  registerPendingAbilityStarterHandler(
    SP_BP4_026_LIVE_SUCCESS_DIFFERENT_LIELLA_CHEER_SCORE_ABILITY_ID,
    (game, ability, options, context) => {
      const confirmation = maybeStartConfirmablePendingAbilityConfirmation(game, ability, options, {
        effectText: getScoreConfirmationEffectText(game, ability),
      });
      if (confirmation) {
        return confirmation;
      }
      return resolveDifferentLiellaCheerScore(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      );
    }
  );

  registerPendingAbilityStarterHandler(
    SP_BP4_026_LIVE_SUCCESS_ENERGY_ELEVEN_DRAW_TWO_DISCARD_ONE_ABILITY_ID,
    (game, ability, options, context) =>
      startEnergyElevenDrawDiscard(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects,
        options
      )
  );
  registerActiveEffectStepHandler(
    SP_BP4_026_LIVE_SUCCESS_ENERGY_ELEVEN_DRAW_TWO_DISCARD_ONE_ABILITY_ID,
    SELECT_DISCARD_AFTER_DRAW_STEP_ID,
    (game, input, context) =>
      finishDrawThenDiscardCardsWorkflow(
        game,
        input.selectedCardId ?? null,
        input.selectedCardIds,
        context.continuePendingCardEffects,
        deps.enqueueTriggeredCardEffects
      )
  );
}

function resolveDifferentLiellaCheerScore(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  const context = getDifferentLiellaCheerContext(game, player.id);
  const scoreBonus = context.conditionMet ? 1 : 0;
  const stateWithoutPending: GameState = {
    ...game,
    pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
  };
  const stateAfterModifier =
    scoreBonus > 0
      ? addLiveModifier(stateWithoutPending, {
          kind: 'SCORE',
          playerId: player.id,
          countDelta: scoreBonus,
          liveCardId: ability.sourceCardId,
          sourceCardId: ability.sourceCardId,
          abilityId: ability.abilityId,
        })
      : stateWithoutPending;
  const stateAfterScoreRefresh =
    scoreBonus > 0
      ? refreshPlayerScoreDraft(stateAfterModifier, player.id, scoreBonus)
      : stateAfterModifier;

  return continuePendingCardEffects(
    addAction(stateAfterScoreRefresh, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: 'DIFFERENT_LIELLA_CHEER_THIS_LIVE_SCORE',
      differentNameLiellaMemberCount: context.differentNameLiellaMemberCount,
      conditionMet: context.conditionMet,
      scoreBonus,
    }),
    orderedResolution
  );
}

function startEnergyElevenDrawDiscard(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects,
  options: PendingAbilityStarterOptions
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  const energyCount = player.energyZone.cardIds.length;
  const conditionMet = energyCount >= 11;
  if (!conditionMet) {
    const confirmation = maybeStartConfirmablePendingAbilityConfirmation(game, ability, options, {
      effectText: getEnergyElevenConfirmationEffectText(game, ability),
    });
    if (confirmation) {
      return confirmation;
    }
    return resolveEnergyElevenNoInteraction(
      game,
      ability,
      energyCount,
      orderedResolution,
      continuePendingCardEffects
    );
  }

  return startDrawThenDiscardCardsWorkflow(game, {
    ability,
    effectText: getAbilityEffectText(ability.abilityId),
    drawCount: 2,
    discardCount: 1,
    stepId: SELECT_DISCARD_AFTER_DRAW_STEP_ID,
    orderedResolution,
    continuePendingCardEffects,
  });
}

function resolveEnergyElevenNoInteraction(
  game: GameState,
  ability: PendingAbilityState,
  energyCount: number,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  const stateWithoutPending: GameState = {
    ...game,
    pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
  };
  return continuePendingCardEffects(
    addAction(stateWithoutPending, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: 'ENERGY_ELEVEN_CONDITION_NOT_MET',
      energyCount,
      conditionMet: false,
      drawnCardIds: [],
      discardedCardIds: [],
    }),
    orderedResolution
  );
}

function getScoreConfirmationEffectText(
  game: GameState,
  ability: PendingAbilityState
): string {
  const context = getDifferentLiellaCheerContext(game, ability.controllerId);
  return `${getAbilityEffectText(ability.abilityId)}（当前不同名Liella!成员 ${context.differentNameLiellaMemberCount}名，${
    context.conditionMet ? '满足条件，[スコア]+1' : '未满足条件，不增加[スコア]'
  }）`;
}

function getEnergyElevenConfirmationEffectText(
  game: GameState,
  ability: PendingAbilityState
): string {
  const player = getPlayerById(game, ability.controllerId);
  const energyCount = player?.energyZone.cardIds.length ?? 0;
  const conditionMet = energyCount >= 11;
  return `${getAbilityEffectText(ability.abilityId)}（当前能量 ${energyCount}张，${
    conditionMet ? '满足条件，将抽2弃1' : '未满足条件，不抽牌也不弃手'
  }）`;
}

function getDifferentLiellaCheerContext(
  game: GameState,
  playerId: string
): {
  readonly differentNameLiellaMemberCount: number;
  readonly conditionMet: boolean;
} {
  const differentNames = countCurrentLiveRevealedDifferentNamedCheerCards(game, playerId, {
    cardTypes: CardType.MEMBER,
    groupAliases: ['Liella!'],
  });
  return {
    differentNameLiellaMemberCount: differentNames.differentNameCount,
    conditionMet: differentNames.differentNameCount >= 5,
  };
}

function refreshPlayerScoreDraft(game: GameState, playerId: string, scoreBonus: number): GameState {
  const playerScores = new Map(game.liveResolution.playerScores);
  playerScores.set(playerId, (playerScores.get(playerId) ?? 0) + scoreBonus);
  return {
    ...game,
    liveResolution: {
      ...game.liveResolution,
      playerScores,
    },
  };
}
