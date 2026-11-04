import { isLiveCardData } from '../../../../domain/entities/card.js';
import { addAction, getCardById, getPlayerById } from '../../../../domain/entities/game.js';
import { cardCodeMatchesBase } from '../../../../shared/utils/card-code.js';
import { PYHN_AD2_001_LIVE_START_DRAW_ONE_PLACE_HAND_TOP_ABILITY_ID } from '../../ability-ids.js';
import { drawCardsForPlayer, moveHandCardToDeckTopForPlayer } from '../../runtime/actions.js';
import { startPendingActiveEffect } from '../../runtime/active-effect.js';
import { queryCardSelection } from '../../runtime/selection-query.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import {
  getAbilityEffectText,
  maybeStartConfirmablePendingAbilityConfirmation,
} from '../../runtime/workflow-helpers.js';

const ABILITY_ID = PYHN_AD2_001_LIVE_START_DRAW_ONE_PLACE_HAND_TOP_ABILITY_ID;
const SELECT_HAND_STEP = 'PYHN_AD2_001_SELECT_HAND_CARD_TO_DECK_TOP';

export function registerPyhnAd2001DeepBlueWorkflowHandlers(): void {
  registerPendingAbilityStarterHandler(ABILITY_ID, (game, ability, options, runtime) => {
    const source = getCardById(game, ability.sourceCardId);
    const player = getPlayerById(game, ability.controllerId);
    if (
      !player ||
      !source ||
      source.ownerId !== player.id ||
      !isLiveCardData(source.data) ||
      !cardCodeMatchesBase(source.data.cardCode, 'PYHN-ad2-001')
    ) {
      return runtime.continuePendingCardEffects(
        {
          ...game,
          pendingAbilities: game.pendingAbilities.filter((pending) => pending.id !== ability.id),
        },
        options.orderedResolution === true
      );
    }
    const draw = drawCardsForPlayer(game, player.id, 1);
    if (!draw) return game;
    const handIds = getPlayerById(draw.gameState, player.id)?.hand.cardIds ?? [];
    if (handIds.length === 0) {
      const confirmation = maybeStartConfirmablePendingAbilityConfirmation(
        draw.gameState,
        ability,
        options
      );
      if (confirmation) return confirmation;
      return runtime.continuePendingCardEffects(
        addAction(
          {
            ...draw.gameState,
            pendingAbilities: draw.gameState.pendingAbilities.filter(
              (pending) => pending.id !== ability.id
            ),
          },
          'RESOLVE_ABILITY',
          player.id,
          {
            pendingAbilityId: ability.id,
            abilityId: ABILITY_ID,
            sourceCardId: ability.sourceCardId,
            step: 'NO_HAND_CARD_TO_DECK_TOP',
            drawnCardIds: draw.drawnCardIds,
          }
        ),
        options.orderedResolution === true
      );
    }
    return startPendingActiveEffect(draw.gameState, {
      ability,
      playerId: player.id,
      activeEffect: {
        id: ability.id,
        abilityId: ABILITY_ID,
        sourceCardId: ability.sourceCardId,
        sourceLifecycleId: ability.sourceLifecycleId,
        controllerId: player.id,
        effectText: getAbilityEffectText(ABILITY_ID),
        stepId: SELECT_HAND_STEP,
        stepText: '请选择1张手牌放置于卡组顶。',
        awaitingPlayerId: player.id,
        selectableCardIds: [...handIds],
        selectableCardVisibility: 'AWAITING_PLAYER_ONLY',
        selectableCardMode: 'SINGLE',
        selectionLabel: '选择要放置于卡组顶的手牌',
        confirmSelectionLabel: '放置于卡组顶',
        canSkipSelection: false,
        metadata: {
          orderedResolution: options.orderedResolution === true,
          drawnCardIds: draw.drawnCardIds,
        },
      },
      actionPayload: {
        sourceCardId: ability.sourceCardId,
        step: 'DRAW_ONE_SELECT_HAND_CARD_TO_DECK_TOP',
        drawnCardIds: draw.drawnCardIds,
      },
    });
  });
  registerActiveEffectStepHandler(
    ABILITY_ID,
    SELECT_HAND_STEP,
    (game, input, runtime) => {
      const effect = game.activeEffect;
      if (!effect || !input.selectedCardId) return game;
      const move = moveHandCardToDeckTopForPlayer(game, effect.controllerId, input.selectedCardId, {
        candidateCardIds: effect.selectableCardIds ?? [],
      });
      if (!move) return game;
      return runtime.continuePendingCardEffects(
        addAction(
          { ...move.gameState, activeEffect: null },
          'RESOLVE_ABILITY',
          effect.controllerId,
          {
            pendingAbilityId: effect.id,
            abilityId: ABILITY_ID,
            sourceCardId: effect.sourceCardId,
            step: 'HAND_CARD_TO_DECK_TOP',
            movedCardId: move.movedCardId,
          }
        ),
        effect.metadata?.orderedResolution === true
      );
    },
    queryCardSelection
  );
}
