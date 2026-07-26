import { isMemberCardData } from '../../../../domain/entities/card.js';
import {
  addAction,
  getCardById,
  getOpponent,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { findMemberSlot } from '../../../../domain/entities/player.js';
import { hasPlayerSuccessfulLiveThisTurn } from '../../../../domain/rules/success-live-placement.js';
import { cardCodeMatchesBase } from '../../../../shared/utils/card-code.js';
import { PL_N_SD2_007_LIVE_SUCCESS_DRAW_ONE_OPPONENT_SUCCESS_DRAW_ONE_DISCARD_ONE_ABILITY_ID } from '../../ability-ids.js';
import { drawCardsForPlayer } from '../../runtime/actions.js';
import type { EnqueueTriggeredCardEffectsForEnterWaitingRoom } from '../../runtime/enter-waiting-room-triggers.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import {
  registerPendingAbilityStarterHandler,
  type PendingAbilityStarterOptions,
} from '../../runtime/starter-registry.js';
import {
  getAbilityEffectText,
  maybeStartConfirmablePendingAbilityConfirmation,
} from '../../runtime/workflow-helpers.js';
import {
  finishDrawThenDiscardCardsWorkflow,
  startDrawThenDiscardCardsWorkflow,
} from '../shared/draw-then-discard.js';

const BASE_CARD_CODE = 'PL!N-sd2-007';
const SELECT_DISCARD_STEP_ID = 'PL_N_SD2_007_LIVE_SUCCESS_SELECT_DISCARD_AFTER_DRAW';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerNSd2007SetsunaWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom;
}): void {
  registerPendingAbilityStarterHandler(
    PL_N_SD2_007_LIVE_SUCCESS_DRAW_ONE_OPPONENT_SUCCESS_DRAW_ONE_DISCARD_ONE_ABILITY_ID,
    (game, ability, options, context) =>
      startNSd2007LiveSuccess(game, ability, options, context.continuePendingCardEffects)
  );
  registerActiveEffectStepHandler(
    PL_N_SD2_007_LIVE_SUCCESS_DRAW_ONE_OPPONENT_SUCCESS_DRAW_ONE_DISCARD_ONE_ABILITY_ID,
    SELECT_DISCARD_STEP_ID,
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

function startNSd2007LiveSuccess(
  game: GameState,
  ability: PendingAbilityState,
  options: PendingAbilityStarterOptions,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  const sourceCard = getCardById(game, ability.sourceCardId);
  const sourceSlot = player ? findMemberSlot(player, ability.sourceCardId) : null;
  const sourceIsValid =
    player !== null &&
    sourceCard?.ownerId === player.id &&
    isMemberCardData(sourceCard.data) &&
    cardCodeMatchesBase(sourceCard.data.cardCode, BASE_CARD_CODE) &&
    sourceSlot !== null;
  if (!player || !sourceIsValid) {
    return consumePendingWithoutEffect(
      game,
      ability,
      options.orderedResolution === true,
      continuePendingCardEffects,
      {
        step: 'SOURCE_INVALID',
        sourceSlot,
      }
    );
  }

  const opponentSucceeded = hasOpponentSuccessfulLiveThisTurn(game, player.id);
  const effectText = formatEffectText(opponentSucceeded);
  if (opponentSucceeded) {
    return startDrawThenDiscardCardsWorkflow(game, {
      ability: { ...ability, sourceSlot },
      effectText,
      drawCount: 2,
      discardCount: 1,
      stepId: SELECT_DISCARD_STEP_ID,
      orderedResolution: options.orderedResolution === true,
    });
  }

  const confirmation = maybeStartConfirmablePendingAbilityConfirmation(game, ability, options, {
    effectText,
    stepText: '确认后抽1张卡。',
  });
  if (confirmation) {
    return confirmation;
  }

  const drawResult = drawCardsForPlayer(game, player.id, 1);
  if (!drawResult) {
    return game;
  }
  const stateWithoutPending: GameState = {
    ...drawResult.gameState,
    pendingAbilities: drawResult.gameState.pendingAbilities.filter(
      (candidate) => candidate.id !== ability.id
    ),
  };
  return continuePendingCardEffects(
    addAction(stateWithoutPending, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      step: 'DRAW_ONE_WITHOUT_OPPONENT_SUCCESS',
      sourceSlot,
      opponentSucceeded,
      drawCount: 1,
      drawnCardIds: drawResult.drawnCardIds,
    }),
    options.orderedResolution === true
  );
}

function hasOpponentSuccessfulLiveThisTurn(game: GameState, playerId: string): boolean {
  const opponent = getOpponent(game, playerId);
  return opponent !== null && hasPlayerSuccessfulLiveThisTurn(game, opponent.id);
}

function formatEffectText(opponentSucceeded: boolean): string {
  const conditionText = opponentSucceeded
    ? '本回合对方已成功LIVE，满足追加效果条件；实际抽2张卡，再将1张手牌放置入休息室。'
    : '本回合对方未成功LIVE，未满足追加效果条件；实际抽1张卡。';
  return `${getAbilityEffectText(
    PL_N_SD2_007_LIVE_SUCCESS_DRAW_ONE_OPPONENT_SUCCESS_DRAW_ONE_DISCARD_ONE_ABILITY_ID
  )}（${conditionText}）`;
}

function consumePendingWithoutEffect(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects,
  payload: Readonly<Record<string, unknown>>
): GameState {
  const state: GameState = {
    ...game,
    pendingAbilities: game.pendingAbilities.filter((candidate) => candidate.id !== ability.id),
  };
  return continuePendingCardEffects(
    addAction(state, 'RESOLVE_ABILITY', ability.controllerId, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      ...payload,
    }),
    orderedResolution
  );
}
