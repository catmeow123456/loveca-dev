import { isMemberCardData } from '../../../../domain/entities/card.js';
import {
  addAction,
  getCardById,
  getPlayerById,
  updatePlayer,
  type ActiveEffectState,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { addCardToZone } from '../../../../domain/entities/zone.js';
import { addLiveModifier } from '../../../../domain/rules/live-modifiers.js';
import { hasBladeHeart } from '../../../effects/card-selectors.js';
import { clearInspectionCards, inspectTopCards } from '../../../effects/look-top.js';
import { BP6_007_LIVE_SUCCESS_REVEAL_TOP_HAND_NO_BLADE_MEMBER_SCORE_ABILITY_ID } from '../../ability-ids.js';
import { startPendingActiveEffect } from '../../runtime/active-effect.js';
import { withPublicRevealDwell } from '../../runtime/public-reveal-dwell.js';
import { getSourceMemberSlot } from '../../runtime/source-member.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import {
  getAbilityEffectText,
  maybeStartConfirmablePendingAbilityConfirmation,
} from '../../runtime/workflow-helpers.js';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

const REVEAL_TOP_CARD_STEP_ID = 'BP6_007_REVEAL_TOP_CARD';

export function registerPlBp6007NozomiWorkflowHandlers(): void {
  registerPendingAbilityStarterHandler(
    BP6_007_LIVE_SUCCESS_REVEAL_TOP_HAND_NO_BLADE_MEMBER_SCORE_ABILITY_ID,
    (game, ability, options, context) => {
      const confirmation = maybeStartConfirmablePendingAbilityConfirmation(game, ability, options);
      if (confirmation) {
        return confirmation;
      }
      return resolvePlBp6007NozomiLiveSuccess(
        game,
        ability,
        options.orderedResolution === true,
        context.continuePendingCardEffects
      );
    }
  );
  registerActiveEffectStepHandler(
    BP6_007_LIVE_SUCCESS_REVEAL_TOP_HAND_NO_BLADE_MEMBER_SCORE_ABILITY_ID,
    REVEAL_TOP_CARD_STEP_ID,
    (game, _input, context) =>
      finishPlBp6007NozomiLiveSuccess(game, context.continuePendingCardEffects)
  );
}

function resolvePlBp6007NozomiLiveSuccess(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  const sourceSlot = player ? getSourceMemberSlot(game, player.id, ability.sourceCardId) : null;
  if (!player || sourceSlot === null) {
    return skipPendingAbility(
      game,
      ability,
      ability.controllerId,
      orderedResolution,
      continuePendingCardEffects,
      'SOURCE_NOT_ON_STAGE'
    );
  }

  if (player.mainDeck.cardIds.length === 0 && player.waitingRoom.cardIds.length === 0) {
    return continuePendingCardEffects(
      addAction(removePendingAbility(game, ability.id), 'RESOLVE_ABILITY', player.id, {
        pendingAbilityId: ability.id,
        abilityId: ability.abilityId,
        sourceCardId: ability.sourceCardId,
        sourceSlot,
        step: 'NO_TOP_CARD',
        revealedCardId: null,
        movedToHand: false,
        scoreBonus: 0,
      }),
      orderedResolution
    );
  }

  const inspection = inspectTopCards(game, player.id, { count: 1, reveal: true });
  if (!inspection) {
    return game;
  }

  const revealedCardId = inspection.inspectedCardIds[0] ?? null;
  const revealedCard = revealedCardId ? getCardById(inspection.gameState, revealedCardId) : null;
  const scoreBonus =
    revealedCard && isMemberCardData(revealedCard.data) && !hasBladeHeart()(revealedCard) ? 1 : 0;

  const activeEffect: ActiveEffectState = {
    id: ability.id,
    abilityId: ability.abilityId,
    sourceCardId: ability.sourceCardId,
    controllerId: ability.controllerId,
    effectText: getAbilityEffectText(ability.abilityId),
    stepId: REVEAL_TOP_CARD_STEP_ID,
    stepText:
      scoreBonus > 0
        ? '卡组顶1张已公开。展示结束后将其加入手牌，此卡的分数+1。'
        : '卡组顶1张已公开。展示结束后将其加入手牌。',
    awaitingPlayerId: player.id,
    inspectionCardIds: inspection.inspectedCardIds,
    revealedCardIds: revealedCardId ? [revealedCardId] : [],
    metadata: {
      orderedResolution,
      sourceSlot,
      revealedCardId,
      scoreBonus,
    },
  };
  return startPendingActiveEffect(inspection.gameState, {
    ability,
    playerId: player.id,
    activeEffect: withPublicRevealDwell(activeEffect),
    actionPayload: {
      sourceCardId: ability.sourceCardId,
      sourceSlot,
      step: 'REVEAL_TOP_CARD',
      revealedCardId,
      scoreBonus,
    },
  });
}

function finishPlBp6007NozomiLiveSuccess(
  game: GameState,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !== BP6_007_LIVE_SUCCESS_REVEAL_TOP_HAND_NO_BLADE_MEMBER_SCORE_ABILITY_ID ||
    effect.stepId !== REVEAL_TOP_CARD_STEP_ID
  ) {
    return game;
  }
  const player = getPlayerById(game, effect.controllerId);
  const revealedCardId =
    typeof effect.metadata?.revealedCardId === 'string' ? effect.metadata.revealedCardId : null;
  const scoreBonus = effect.metadata?.scoreBonus === 1 ? 1 : 0;
  if (!player || !revealedCardId || !effect.inspectionCardIds?.includes(revealedCardId)) {
    return game;
  }
  if (!game.inspectionZone.cardIds.includes(revealedCardId)) {
    const state = {
      ...clearInspectionCards(game, effect.inspectionCardIds),
      activeEffect: null,
    };
    return continuePendingCardEffects(
      addAction(state, 'RESOLVE_ABILITY', player.id, {
        pendingAbilityId: effect.id,
        abilityId: effect.abilityId,
        sourceCardId: effect.sourceCardId,
        sourceSlot: effect.metadata?.sourceSlot,
        step: 'REVEAL_TOP_CARD_STALE_NO_OP',
        revealedCardId,
        movedToHand: false,
        scoreBonus: 0,
      }),
      effect.metadata?.orderedResolution === true
    );
  }

  let state = updatePlayer(game, player.id, (currentPlayer) => ({
    ...currentPlayer,
    hand: revealedCardId ? addCardToZone(currentPlayer.hand, revealedCardId) : currentPlayer.hand,
  }));
  state = clearInspectionCards(state, effect.inspectionCardIds);
  state = { ...state, activeEffect: null };

  if (scoreBonus > 0) {
    state = addLiveModifier(state, {
      kind: 'SCORE',
      playerId: player.id,
      countDelta: scoreBonus,
      sourceCardId: effect.sourceCardId,
      abilityId: effect.abilityId,
    });
    state = refreshPlayerScoreDraft(state, player.id, scoreBonus);
  }

  return continuePendingCardEffects(
    addAction(state, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      sourceSlot: effect.metadata?.sourceSlot,
      step: 'REVEAL_TOP_CARD_TO_HAND',
      revealedCardId,
      movedToHand: revealedCardId !== null,
      scoreBonus,
    }),
    effect.metadata?.orderedResolution === true
  );
}

function skipPendingAbility(
  game: GameState,
  ability: PendingAbilityState,
  playerId: string,
  orderedResolution: boolean,
  continuePendingCardEffects: ContinuePendingCardEffects,
  step: string
): GameState {
  return continuePendingCardEffects(
    addAction(removePendingAbility(game, ability.id), 'RESOLVE_ABILITY', playerId, {
      pendingAbilityId: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      sourceSlot: ability.sourceSlot,
      step,
    }),
    orderedResolution
  );
}

function removePendingAbility(game: GameState, pendingAbilityId: string): GameState {
  return {
    ...game,
    pendingAbilities: game.pendingAbilities.filter(
      (candidate) => candidate.id !== pendingAbilityId
    ),
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
