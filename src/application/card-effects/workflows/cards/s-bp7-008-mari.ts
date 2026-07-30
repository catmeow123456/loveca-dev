import {
  addAction,
  getCardById,
  getPlayerById,
  type GameState,
  type PendingAbilityState,
} from '../../../../domain/entities/game.js';
import { ZoneType } from '../../../../shared/types/enums.js';
import { cardNameAliasIs } from '../../../effects/card-selectors.js';
import { S_BP7_008_LIVE_START_MILL_BOTTOM_ONE_RECOVER_KANAN_OR_DIA_ABILITY_ID } from '../../ability-ids.js';
import { recoverCardsFromWaitingRoomToHandForPlayer } from '../../runtime/actions.js';
import type { EnqueueTriggeredCardEffectsForEnterWaitingRoom } from '../../runtime/enter-waiting-room-triggers.js';
import { moveBottomDeckCardsToWaitingRoomWithRefreshAndEnqueueTriggers } from '../../runtime/main-deck-waiting-room-triggers.js';
import { withPublicRevealDwell } from '../../runtime/public-reveal-dwell.js';
import { registerPendingAbilityStarterHandler } from '../../runtime/starter-registry.js';
import { registerActiveEffectStepHandler } from '../../runtime/step-registry.js';
import { startPendingActiveEffect } from '../../runtime/active-effect.js';
import { getAbilityEffectText } from '../../runtime/workflow-helpers.js';

const DECIDE_MILL_BOTTOM_STEP_ID = 'S_BP7_008_DECIDE_MILL_BOTTOM_ONE';
const REVEAL_MILLED_BOTTOM_STEP_ID = 'S_BP7_008_REVEAL_MILLED_BOTTOM_ONE';
const ACTIVATE_OPTION_ID = 'activate';

type ContinuePendingCardEffects = (game: GameState, orderedResolution: boolean) => GameState;

const kananName = cardNameAliasIs('松浦果南');
const diaName = cardNameAliasIs('黒澤ダイヤ');

export function registerSBp7008MariWorkflowHandlers(deps: {
  readonly enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom;
}): void {
  registerPendingAbilityStarterHandler(
    S_BP7_008_LIVE_START_MILL_BOTTOM_ONE_RECOVER_KANAN_OR_DIA_ABILITY_ID,
    (game, ability, options) =>
      startMillBottomDecision(game, ability, options.orderedResolution === true)
  );
  registerActiveEffectStepHandler(
    S_BP7_008_LIVE_START_MILL_BOTTOM_ONE_RECOVER_KANAN_OR_DIA_ABILITY_ID,
    DECIDE_MILL_BOTTOM_STEP_ID,
    (game, input, context) =>
      finishMillBottomDecision(
        game,
        input.selectedOptionId ?? null,
        context.continuePendingCardEffects,
        deps.enqueueTriggeredCardEffects
      )
  );
  registerActiveEffectStepHandler(
    S_BP7_008_LIVE_START_MILL_BOTTOM_ONE_RECOVER_KANAN_OR_DIA_ABILITY_ID,
    REVEAL_MILLED_BOTTOM_STEP_ID,
    (game, _input, context) => finishMilledBottomReveal(game, context.continuePendingCardEffects)
  );
}

function startMillBottomDecision(
  game: GameState,
  ability: PendingAbilityState,
  orderedResolution: boolean
): GameState {
  const player = getPlayerById(game, ability.controllerId);
  if (!player) return game;

  return startPendingActiveEffect(game, {
    ability,
    playerId: player.id,
    activeEffect: {
      id: ability.id,
      abilityId: ability.abilityId,
      sourceCardId: ability.sourceCardId,
      controllerId: player.id,
      effectText: getAbilityEffectText(ability.abilityId),
      stepId: DECIDE_MILL_BOTTOM_STEP_ID,
      stepText: '可以将自己的卡组底1张卡片放置入休息室。',
      awaitingPlayerId: player.id,
      selectableOptions: [{ id: ACTIVATE_OPTION_ID, label: '发动' }],
      canSkipSelection: true,
      skipSelectionLabel: '不发动',
      metadata: { orderedResolution },
    },
    actionPayload: {
      step: 'START_MILL_BOTTOM_DECISION',
    },
  });
}

function finishMillBottomDecision(
  game: GameState,
  selectedOptionId: string | null,
  continuePendingCardEffects: ContinuePendingCardEffects,
  enqueueTriggeredCardEffects: EnqueueTriggeredCardEffectsForEnterWaitingRoom
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !== S_BP7_008_LIVE_START_MILL_BOTTOM_ONE_RECOVER_KANAN_OR_DIA_ABILITY_ID ||
    effect.stepId !== DECIDE_MILL_BOTTOM_STEP_ID
  ) {
    return game;
  }
  if (selectedOptionId === null) {
    return finishWorkflow(game, effect, continuePendingCardEffects, {
      step: 'DECLINED',
      movedCardIds: [],
      recoveredCardIds: [],
    });
  }
  if (selectedOptionId !== ACTIVATE_OPTION_ID) return game;

  const player = getPlayerById(game, effect.controllerId);
  if (!player) return game;
  const moveResult = moveBottomDeckCardsToWaitingRoomWithRefreshAndEnqueueTriggers(
    game,
    player.id,
    1,
    enqueueTriggeredCardEffects,
    {
      cause: {
        kind: 'CARD_EFFECT',
        playerId: player.id,
        sourceCardId: effect.sourceCardId,
        abilityId: effect.abilityId,
        pendingAbilityId: effect.id,
      },
    }
  );
  if (!moveResult) return game;

  const movedCardId = moveResult.movedCardIds[0] ?? null;
  if (!movedCardId) {
    return finishWorkflow(moveResult.gameState, effect, continuePendingCardEffects, {
      step: 'NO_BOTTOM_CARD',
      movedCardIds: [],
      recoveredCardIds: [],
      refreshCount: moveResult.refreshCount,
    });
  }
  const movedCard = getCardById(moveResult.gameState, movedCardId);
  const identityMatched = movedCard !== null && (kananName(movedCard) || diaName(movedCard));
  const destinationText = identityMatched
    ? '展示结束后，若该卡仍在休息室，将其加入手牌。'
    : '该卡不是「松浦果南」或「黑泽黛雅」，展示结束后不加入手牌。';

  return addAction(
    {
      ...moveResult.gameState,
      activeEffect: withPublicRevealDwell({
        ...effect,
        stepId: REVEAL_MILLED_BOTTOM_STEP_ID,
        stepText: `已将卡组底1张卡片放置入休息室。${destinationText}`,
        selectableOptions: undefined,
        canSkipSelection: false,
        skipSelectionLabel: undefined,
        revealedCardIds: [movedCardId],
        metadata: {
          orderedResolution: effect.metadata?.orderedResolution === true,
          movedCardId,
          identityMatched,
          refreshCount: moveResult.refreshCount,
          sourceZone: ZoneType.MAIN_DECK,
        },
      }),
    },
    'RESOLVE_ABILITY',
    player.id,
    {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      step: 'MILL_BOTTOM_ONE',
      movedCardIds: [movedCardId],
      identityMatched,
      refreshCount: moveResult.refreshCount,
    }
  );
}

function finishMilledBottomReveal(
  game: GameState,
  continuePendingCardEffects: ContinuePendingCardEffects
): GameState {
  const effect = game.activeEffect;
  if (
    !effect ||
    effect.abilityId !== S_BP7_008_LIVE_START_MILL_BOTTOM_ONE_RECOVER_KANAN_OR_DIA_ABILITY_ID ||
    effect.stepId !== REVEAL_MILLED_BOTTOM_STEP_ID
  ) {
    return game;
  }
  const player = getPlayerById(game, effect.controllerId);
  const movedCardId =
    typeof effect.metadata?.movedCardId === 'string' ? effect.metadata.movedCardId : null;
  if (!player || !movedCardId) return game;

  const movedCard = getCardById(game, movedCardId);
  const canRecover =
    player.waitingRoom.cardIds.includes(movedCardId) &&
    movedCard !== null &&
    movedCard.ownerId === player.id &&
    (kananName(movedCard) || diaName(movedCard));
  const recovery = canRecover
    ? recoverCardsFromWaitingRoomToHandForPlayer(game, player.id, [movedCardId], {
        candidateCardIds: [movedCardId],
        exactCount: 1,
      })
    : null;
  const state = recovery?.gameState ?? game;

  return finishWorkflow(state, effect, continuePendingCardEffects, {
    step: 'FINISH_MILL_BOTTOM_ONE',
    movedCardIds: [movedCardId],
    recoveredCardIds: recovery?.movedCardIds ?? [],
    identityMatched: canRecover,
    refreshCount:
      typeof effect.metadata?.refreshCount === 'number' ? effect.metadata.refreshCount : 0,
  });
}

function finishWorkflow(
  game: GameState,
  effect: NonNullable<GameState['activeEffect']>,
  continuePendingCardEffects: ContinuePendingCardEffects,
  payload: Readonly<Record<string, unknown>>
): GameState {
  return continuePendingCardEffects(
    addAction({ ...game, activeEffect: null }, 'RESOLVE_ABILITY', effect.controllerId, {
      pendingAbilityId: effect.id,
      abilityId: effect.abilityId,
      sourceCardId: effect.sourceCardId,
      ...payload,
    }),
    effect.metadata?.orderedResolution === true
  );
}
