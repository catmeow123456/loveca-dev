import {
  addAction,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { CardType, ZoneType } from '../../../../shared/types/enums.js';
import { NOZOMI_ON_ENTER_ABILITY_ID } from '../../ability-ids.js';
import { startPendingActiveEffect } from '../../runtime/active-effect.js';
import { drawCardsForPlayer } from '../../runtime/actions.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { getAbilityEffectText } from '../../runtime/workflow-helpers.js';
import { typeIs } from '../../../effects/card-selectors.js';
import { hasCardIdsMatchingSelector } from '../../../effects/conditions.js';
import {
  inspectTopCards,
  moveInspectedCardsToWaitingRoom,
} from '../../../effects/look-top.js';

const NOZOMI_REVEAL_STEP_ID = 'NOZOMI_REVEAL_TOP_FIVE';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

export function registerNozomiOnEnterWorkflowHandlers(): void {
  registerPendingAbilityStarterHandler(
    NOZOMI_ON_ENTER_ABILITY_ID,
    (game, ability, options) =>
      startNozomiOnEnterInspection(game, ability, options.orderedResolution === true)
  );
  registerActiveEffectStepHandler(
    NOZOMI_ON_ENTER_ABILITY_ID,
    NOZOMI_REVEAL_STEP_ID,
    (game, _input, context) => finishNozomiOnEnter(game, context.continuePendingCardEffects)
  );
}

function startNozomiOnEnterInspection(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) {
    return game;
  }

  const inspection = inspectTopCards(game, player.id, {
    count: 5,
    reveal: true,
  });
  if (!inspection) {
    return game;
  }

  const { gameState, inspectedCardIds } = inspection;
  return startPendingActiveEffect(gameState, {
    ability,
    playerId: player.id,
    activeEffect: {
      id: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      controllerId: ability.controllerId,
      effectText: getAbilityEffectText(NOZOMI_ON_ENTER_ABILITY_ID),
      stepId: NOZOMI_REVEAL_STEP_ID,
      stepText: '卡组顶5张已公开。确认后将这些牌放入休息室，并在其中有LIVE卡时抽1张。',
      awaitingPlayerId: player.id,
      inspectionCardIds: inspectedCardIds,
      metadata: {
        sourceZone: ZoneType.MAIN_DECK,
        orderedResolution,
      },
    },
    actionPayload: {
      sourceCardId: ability.sourceCardId,
      step: 'START_INSPECTION',
      inspectedCardIds,
    },
  });
}

function finishNozomiOnEnter(
  game: GameState,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !== NOZOMI_ON_ENTER_ABILITY_ID ||
    effect.stepId !== NOZOMI_REVEAL_STEP_ID
  ) {
    return game;
  }

  const player = getPlayerById(game, effect.controllerId);
  if (!player) {
    return game;
  }

  const inspectedCardIds = effect.inspectionCardIds ?? [];
  const hasMilledLiveCard = hasCardIdsMatchingSelector(
    game,
    inspectedCardIds,
    typeIs(CardType.LIVE)
  );
  const moveResult = moveInspectedCardsToWaitingRoom(game, player.id, inspectedCardIds);
  if (!moveResult) {
    return game;
  }

  let state = moveResult.gameState;
  let drawnCardId: string | null = null;
  if (hasMilledLiveCard) {
    const drawResult = drawCardsForPlayer(state, player.id, 1);
    if (!drawResult) {
      return game;
    }
    state = drawResult.gameState;
    drawnCardId = drawResult.drawnCardIds[0] ?? null;
  }

  state = {
    ...state,
    inspectionContext: state.inspectionZone.cardIds.length > 0 ? state.inspectionContext : null,
    activeEffect: null,
  };

  return continuePendingCardEffects(
    addAction(state, 'RESOLVE_ABILITY', player.id, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'FINISH',
      milledCardIds: moveResult.movedCardIds,
      hasMilledLiveCard,
      drawnCardId,
    }),
    effect.metadata?.orderedResolution === true
  );
}
