import {
  addAction,
  getPlayerById,
  updatePlayer,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { CardType, ZoneType } from '../../../../shared/types/enums.js';
import { MAKI_ON_ENTER_ABILITY_ID } from '../../ability-ids.js';
import {
  finishSkippedActiveEffect,
  revealHandCardForActiveEffect,
  startPendingActiveEffect,
} from '../../runtime/active-effect.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText } from '../../runtime/workflow-helpers.js';
import { typeIs } from '../../../effects/card-selectors.js';
import { getCardIdsInZoneMatching } from '../../../effects/conditions.js';
import { startSuccessZoneReplacementEffect } from './bp6-024-success-replacement.js';
import { canLiveCardEnterSuccessZone } from '../../../../domain/rules/success-live-placement.js';

export const MAKI_SELECT_HAND_LIVE_STEP_ID = 'MAKI_SELECT_HAND_LIVE';
export const MAKI_SELECT_SUCCESS_LIVE_STEP_ID = 'MAKI_SELECT_SUCCESS_LIVE';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerMakiOnEnterWorkflowHandlers(): void {
  registerPendingAbilityStarterHandler(
    MAKI_ON_ENTER_ABILITY_ID,
    (game, ability, options, context) =>
      startMakiOnEnterSelection(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      )
  );
  registerActiveEffectStepHandler(
    MAKI_ON_ENTER_ABILITY_ID,
    MAKI_SELECT_HAND_LIVE_STEP_ID,
    (game, input, context) =>
      input.selectedCardId
        ? startMakiSelectSuccessLive(
            game,
            input.selectedCardId,
            context.continuePendingCardEffects
          )
        : finishSkippedActiveEffect(game, context.continuePendingCardEffects)
  );
  registerActiveEffectStepHandler(
    MAKI_ON_ENTER_ABILITY_ID,
    MAKI_SELECT_SUCCESS_LIVE_STEP_ID,
    (game, input, context) =>
      input.selectedCardId
        ? finishMakiOnEnter(game, input.selectedCardId, context.continuePendingCardEffects)
        : finishSkippedActiveEffect(game, context.continuePendingCardEffects)
  );
}

function startMakiOnEnterSelection(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }
  const selectableCardIds = getCardIdsInZoneMatching(
    game,
    player.id,
    ZoneType.HAND,
    typeIs(CardType.LIVE)
  ).filter((cardId) => canLiveCardEnterSuccessZone(game, player.id, cardId));

  return startPendingActiveEffect(game, {
    ability,
    playerId: player.id,
    activeEffect: {
      id: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      controllerId: ability.controllerId,
      effectText: getAbilityEffectText(MAKI_ON_ENTER_ABILITY_ID),
      stepId: MAKI_SELECT_HAND_LIVE_STEP_ID,
      stepText: getAbilityEffectText(MAKI_ON_ENTER_ABILITY_ID),
      awaitingPlayerId: player.id,
      selectableCardIds,
      selectableCardVisibility: 'AWAITING_PLAYER_ONLY',
      canSkipSelection: true,
      metadata: { orderedResolution },
    },
    actionPayload: {
      pendingAbilityId: ability.id,
      sourceCardId: ability.sourceCardId,
      step: 'START_SELECT_HAND_LIVE',
      selectableCardIds,
    },
  });
}

function startMakiSelectSuccessLive(
  game: GameState,
  handLiveCardId: string,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  if (!effect) {
    return game;
  }
  const player = getPlayerById(game, effect.controllerId);
  if (!player || !effect.selectableCardIds?.includes(handLiveCardId)) {
    return finishSkippedActiveEffect(game, continuePendingCardEffects);
  }
  const selectableSuccessLiveCardIds = getCardIdsInZoneMatching(
    game,
    player.id,
    ZoneType.SUCCESS_ZONE,
    typeIs(CardType.LIVE)
  );

  return revealHandCardForActiveEffect(game, {
    effect,
    playerId: player.id,
    selectedCardId: handLiveCardId,
    nextStepId: MAKI_SELECT_SUCCESS_LIVE_STEP_ID,
    nextStepText: '请选择要加入手牌的成功 Live。所公开的手牌 Live 会放置入成功 Live 卡区。',
    selectableCardIds: selectableSuccessLiveCardIds,
    selectableCardVisibility: 'PUBLIC',
    canSkipSelection: true,
    metadata: {
      handLiveCardId,
    },
    actionStep: 'REVEAL_HAND_LIVE',
    actionPayload: {
      handLiveCardId,
    },
  });
}

function finishMakiOnEnter(
  game: GameState,
  successLiveCardId: string,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  if (!effect) {
    return game;
  }
  const player = getPlayerById(game, effect.controllerId);
  const handLiveCardId =
    typeof effect.metadata?.handLiveCardId === 'string' ? effect.metadata.handLiveCardId : null;
  if (
    !player ||
    handLiveCardId === null ||
    !effect.selectableCardIds?.includes(successLiveCardId)
  ) {
    return finishSkippedActiveEffect(game, continuePendingCardEffects);
  }

  const replacementState = startSuccessZoneReplacementEffect(game, {
    controllerId: player.id,
    originalCardId: handLiveCardId,
    origin: 'MAKI_HAND_SUCCESS_SWAP',
    successLiveCardId,
  });
  if (replacementState !== null) {
    return replacementState;
  }

  let state = updatePlayer(game, player.id, (currentPlayer) => ({
    ...currentPlayer,
    hand: {
      ...currentPlayer.hand,
      cardIds: [
        ...currentPlayer.hand.cardIds.filter((cardId) => cardId !== handLiveCardId),
        successLiveCardId,
      ],
    },
    successZone: {
      ...currentPlayer.successZone,
      cardIds: [
        ...currentPlayer.successZone.cardIds.filter((cardId) => cardId !== successLiveCardId),
        handLiveCardId,
      ],
    },
  }));
  state = { ...state, activeEffect: null };
  return continuePendingCardEffects(
    addAction(state, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'FINISH',
      handLiveCardId,
      successLiveCardId,
    }),
    effect.metadata?.orderedResolution === true
  );
}
